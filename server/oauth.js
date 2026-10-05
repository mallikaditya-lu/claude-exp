import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertPublic } from './unfurl.js';

// OAuth 2.1 for the MCP connector (Claude and other MCP clients).
//
// The client (e.g. Claude) registers itself (RFC 7591 dynamic registration, or a client ID
// metadata document URL), sends the person's browser to /oauth/authorize — which sits behind the
// app's normal sign-in, so it knows who they are — and gets a code it swaps for tokens at
// /oauth/token (PKCE S256 required). Tokens act as that person, with their normal permissions.
// Only SHA-256 hashes of tokens are stored.

const ACCESS_TTL = 60 * 60 * 1000; // 1 hour
const REFRESH_TTL = 60 * 24 * 3600 * 1000; // 60 days (rotated on every use)
const CODE_TTL = 10 * 60 * 1000;

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Redirects allowed for a client: https anywhere, or http only back to this computer (CLI apps). */
export function validRedirect(uri) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

export class OAuth {
  constructor(dataDir, secret) {
    this.file = path.join(dataDir, 'oauth.json');
    this.secret = secret;
    let data = {};
    try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run */ }
    this.clients = data.clients || {};
    this.tokens = data.tokens || {};
    this.codes = new Map();
    this.metadataCache = new Map();
    this.timer = null;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const now = Date.now();
      for (const [h, t] of Object.entries(this.tokens)) if (t.expiresAt < now) delete this.tokens[h];
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ clients: this.clients, tokens: this.tokens }));
      fs.renameSync(tmp, this.file);
    }, 500);
  }

  /** RFC 7591 dynamic client registration (public clients only). */
  register(body) {
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10 || !uris.every(validRedirect)) {
      const err = new Error('redirect_uris must be https URLs (or http://localhost)');
      err.code = 'invalid_redirect_uri';
      throw err;
    }
    const id = `rb_${crypto.randomBytes(16).toString('base64url')}`;
    const client = {
      client_id: id,
      client_name: String(body.client_name || 'MCP client').slice(0, 100),
      client_uri: typeof body.client_uri === 'string' ? body.client_uri.slice(0, 300) : undefined,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients[id] = client;
    this.save();
    return client;
  }

  /**
   * A registered client, or a client ID metadata document (the client_id is an https URL whose
   * JSON lists its name and redirect URIs; newer MCP clients use this instead of registering).
   */
  async client(clientId) {
    if (this.clients[clientId]) return this.clients[clientId];
    if (!/^https:\/\//.test(clientId || '')) return null;
    const cached = this.metadataCache.get(clientId);
    if (cached && cached.at > Date.now() - 3600 * 1000) return cached.client;
    try {
      const url = new URL(clientId);
      await assertPublic(url);
      const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
      if (!res.ok) return null;
      const text = (await res.text()).slice(0, 64 * 1024);
      const doc = JSON.parse(text);
      const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.map(String).filter(validRedirect) : [];
      if (doc.client_id !== clientId || !uris.length) return null;
      const client = { client_id: clientId, client_name: String(doc.client_name || url.hostname).slice(0, 100), client_uri: doc.client_uri, redirect_uris: uris, metadataDocument: true };
      this.metadataCache.set(clientId, { at: Date.now(), client });
      return client;
    } catch {
      return null;
    }
  }

  /** Signed value for the consent form, so another site can't submit it for you. */
  csrf(identityKey, params) {
    return crypto.createHmac('sha256', this.secret).update(`consent:${identityKey}:${params.client_id}:${params.code_challenge}:${params.redirect_uri}`).digest('base64url');
  }

  issueCode({ clientId, redirectUri, codeChallenge, resource, scope, person }) {
    const code = token();
    this.codes.set(hash(code), { clientId, redirectUri, codeChallenge, resource, scope, person, expiresAt: Date.now() + CODE_TTL });
    return code;
  }

  issueTokens({ clientId, person, resource, scope }) {
    const access = token();
    const refresh = token();
    const now = Date.now();
    const base = { clientId, email: person.email || null, name: person.name || null, resource, scope, createdAt: now };
    this.tokens[hash(access)] = { ...base, kind: 'access', expiresAt: now + ACCESS_TTL };
    this.tokens[hash(refresh)] = { ...base, kind: 'refresh', expiresAt: now + REFRESH_TTL };
    this.save();
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: scope || 'boards' };
  }

  /** Authorization code (with PKCE) or refresh token → new tokens. Throws { code } on failure. */
  exchange(body) {
    const fail = (code, msg) => { const e = new Error(msg); e.code = code; throw e; };
    if (body.grant_type === 'authorization_code') {
      const entry = this.codes.get(hash(String(body.code || '')));
      this.codes.delete(hash(String(body.code || '')));
      if (!entry || entry.expiresAt < Date.now()) fail('invalid_grant', 'The code is invalid or expired');
      if (entry.clientId !== body.client_id) fail('invalid_grant', 'The code was issued to another client');
      if (entry.redirectUri !== body.redirect_uri) fail('invalid_grant', 'redirect_uri does not match');
      const verifier = String(body.code_verifier || '');
      if (!/^[\w.~-]{43,128}$/.test(verifier)) fail('invalid_grant', 'code_verifier is missing or malformed');
      if (b64url(crypto.createHash('sha256').update(verifier).digest()) !== entry.codeChallenge) fail('invalid_grant', 'PKCE check failed');
      return this.issueTokens({ clientId: entry.clientId, person: entry.person, resource: entry.resource, scope: entry.scope });
    }
    if (body.grant_type === 'refresh_token') {
      const h = hash(String(body.refresh_token || ''));
      const t = this.tokens[h];
      if (!t || t.kind !== 'refresh' || t.expiresAt < Date.now()) fail('invalid_grant', 'The refresh token is invalid or expired');
      if (body.client_id && body.client_id !== t.clientId) fail('invalid_grant', 'The refresh token was issued to another client');
      delete this.tokens[h]; // rotate
      return this.issueTokens({ clientId: t.clientId, person: { email: t.email, name: t.name }, resource: t.resource, scope: t.scope });
    }
    fail('unsupported_grant_type', 'Use authorization_code or refresh_token');
  }

  /** The token record for a bearer access token, or null. */
  check(bearer) {
    const t = bearer ? this.tokens[hash(bearer)] : null;
    if (!t || t.kind !== 'access' || t.expiresAt < Date.now()) return null;
    if (Date.now() - (t.lastUsed || 0) > 5 * 60 * 1000) { t.lastUsed = Date.now(); this.save(); }
    return t;
  }

  revoke(value) {
    const h = hash(String(value || ''));
    if (!this.tokens[h]) return false;
    delete this.tokens[h];
    this.save();
    return true;
  }

  /** Remove every token for a person (e.g. when an admin removes them), optionally for one client. */
  revokePerson(email, clientId = null) {
    let n = 0;
    for (const [h, t] of Object.entries(this.tokens)) {
      if (t.email === email && (!clientId || t.clientId === clientId)) { delete this.tokens[h]; n++; }
    }
    if (n) this.save();
    return n;
  }

  /** Connected apps: one row per person and client with a live refresh token. */
  connections() {
    const rows = new Map();
    const now = Date.now();
    for (const t of Object.values(this.tokens)) {
      if (t.expiresAt < now) continue;
      const key = `${t.email}|${t.clientId}`;
      const row = rows.get(key) || { email: t.email, name: t.name, clientId: t.clientId, clientName: this.clients[t.clientId]?.client_name || t.clientId, since: t.createdAt, lastUsed: 0 };
      row.since = Math.min(row.since, t.createdAt);
      row.lastUsed = Math.max(row.lastUsed, t.lastUsed || t.createdAt);
      rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => b.lastUsed - a.lastUsed);
  }
}
