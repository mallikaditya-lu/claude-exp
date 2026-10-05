import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { unfurl } from './unfurl.js';
import { seedWelcomeBoard } from './seed.js';
import { seedDemoProject } from './demo.js';
import { Drive } from './drive.js';
import { Files, safeHeaders } from './files.js';
import { AccessVerifier } from './access.js';
import { Users, ROLES, ADMIN_EMAILS, TEAM_DOMAINS } from './users.js';
import { Permissions, MEMBER_ROLES, atLeast, isOwnComment } from './permissions.js';
import { Visitors } from './visitors.js';
import { importMedia } from './importer.js';
import { Templates } from './templates.js';
import { OAuth, validRedirect } from './oauth.js';
import { createMcp } from './mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3001;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PASSWORD = process.env.APP_PASSWORD || '';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 500;
const AUTH_COOKIE = 'rb_auth';
// Cloudflare Access (per-person Google/email login). When set, it replaces APP_PASSWORD.
const access = process.env.CF_ACCESS_TEAM_DOMAIN && process.env.CF_ACCESS_AUD
  ? new AccessVerifier(process.env.CF_ACCESS_TEAM_DOMAIN, process.env.CF_ACCESS_AUD)
  : null;
const PUBLIC_URL = process.env.PUBLIC_URL || '';
// Share links (no sign-in) are built on this address. It must NOT be behind Cloudflare Access.
const SHARE_URL = (process.env.SHARE_URL || '').replace(/\/$/, '');
const SHARES_COOKIE = 'rb_shares';
const VISITOR_COOKIE = 'rb_visitor';
const AUTH_MODE = access ? 'cloudflare' : PASSWORD ? 'password' : 'open';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });
const store = new Store(DATA_DIR);
const users = new Users(DATA_DIR);
const perms = new Permissions(store, users);
const visitors = new Visitors(DATA_DIR);
const templates = new Templates(DATA_DIR);

// Google Drive storage is used when both variables are set; otherwise files stay on local disk.
let drive = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_ID) {
  try {
    drive = new Drive(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, process.env.GOOGLE_DRIVE_ID);
  } catch (err) {
    console.error('Google Drive disabled:', err.message);
  }
}
const files = new Files({ dataDir: DATA_DIR, uploadDir: UPLOAD_DIR, drive, cacheMb: Number(process.env.CACHE_MB) || 2048 });
if (drive) {
  drive.check()
    .then((d) => console.log(`Google Drive connected: “${d.name}” as ${drive.email}`))
    .catch((err) => console.error('Google Drive check FAILED — uploads will error until fixed:', err.message));
}
if (store.boards.size === 0) {
  seedWelcomeBoard(store);
  seedDemoProject(store, UPLOAD_DIR);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // behind Railway / Cloudflare: honour X-Forwarded-Proto for secure cookies
app.use(express.json({ limit: '5mb' }));

// ---------- optional shared-password auth ----------
const authToken = PASSWORD ? crypto.createHmac('sha256', PASSWORD).update('reference-board').digest('hex') : '';

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

function passwordOk(req) {
  const token = readCookie(req, AUTH_COOKIE);
  return token.length === authToken.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(authToken));
}

function setCookie(req, res, name, value, maxAgeDays) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(maxAgeDays * 86400)}${secure ? '; Secure' : ''}`);
}

/** Share-link tokens this browser has opened (most recent first). */
const shareTokens = (req) => readCookie(req, SHARES_COOKIE).split('.').filter((t) => /^[\w-]{20,64}$/.test(t)).slice(0, 20);

/** Signed-in team member or invited guest: { email, name, role } (Cloudflare), { anon: true } (password/open), or null. */
async function identifyMember(req) {
  if (access) {
    try {
      const id = await access.verify(AccessVerifier.tokenFrom(req));
      if (!id) return null;
      const u = users.touch(id.email);
      return { email: u.email, name: u.name, role: users.roleOf(u.email) };
    } catch (err) {
      console.error('Access verification error:', err.message);
      return null;
    }
  }
  if (PASSWORD && !passwordOk(req)) return null;
  return { anon: true, role: 'team' };
}

/** A person who came in through share links, with the name and email they gave (if any). */
function identifyVisitor(req) {
  const tokens = shareTokens(req);
  if (!tokens.length) return null;
  const v = visitors.fromCookie(readCookie(req, VISITOR_COOKIE));
  const user = { visitor: true, tokens, visitorId: v?.id || null, name: v?.name || 'Guest', email: v?.email || '', identified: Boolean(v), role: 'visitor' };
  return perms.linkShares(user).length ? user : null;
}

/** Who is making this request: a member (see identifyMember), a link visitor, or null. */
async function identify(req) {
  return (await identifyMember(req)) || identifyVisitor(req);
}

// Unauthenticated health check for the host (Railway) to know the app is up.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, storage: files.mode, boards: store.boards.size });
});

app.get('/api/session', async (req, res) => {
  const user = await identifyMember(req);
  res.json({
    mode: AUTH_MODE,
    authRequired: AUTH_MODE !== 'open',
    authed: Boolean(user),
    user: user?.email ? user : null,
    role: user?.role || null,
    publicUrl: PUBLIC_URL,
    shareLinks: Boolean(SHARE_URL) || AUTH_MODE !== 'cloudflare',
  });
});

// ---------- share links (no sign-in) ----------
// Opening /s/<token> calls this first. It remembers the token in a cookie (so images and the live
// connection work too) and says whether the visitor still needs to give a name and email.
function shareInfo(found, visitor, member) {
  const { board, share } = found;
  return {
    boardId: board.id,
    title: board.title,
    mode: share.mode,
    requireIdentity: share.requireIdentity !== false,
    visitor: visitor ? { name: visitor.name, email: visitor.email } : null,
    // Signed-in people with their own access are sent to the full app instead.
    member,
  };
}

app.get('/api/share/:token', async (req, res) => {
  const found = store.findShare(req.params.token);
  if (!found) return res.status(404).json({ error: 'This link isn’t active any more. Ask Little Unusual for a new one.' });
  const tokens = [found.share.token, ...shareTokens(req).filter((t) => t !== found.share.token)].slice(0, 20);
  setCookie(req, res, SHARES_COOKIE, tokens.join('.'), 180);
  const member = await identifyMember(req);
  const memberLevel = member ? perms.boardLevel(member, found.board) : null;
  const v = visitors.fromCookie(readCookie(req, VISITOR_COOKIE));
  if (v) visitors.touch(v, found.board.id);
  res.json(shareInfo(found, v, memberLevel));
});

app.post('/api/share/:token/identify', (req, res) => {
  const found = store.findShare(req.params.token);
  if (!found) return res.status(404).json({ error: 'This link isn’t active any more.' });
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
  if (!name) return res.status(400).json({ error: 'Please enter your name' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
  const v = visitors.identify(name, email);
  visitors.touch(v, found.board.id);
  setCookie(req, res, VISITOR_COOKIE, visitors.sign(v.id), 365);
  const tokens = [found.share.token, ...shareTokens(req).filter((t) => t !== found.share.token)].slice(0, 20);
  setCookie(req, res, SHARES_COOKIE, tokens.join('.'), 180);
  res.json(shareInfo(found, v, null));
});

// "Not you?": forget the name and email on this browser.
app.post('/api/share-forget', (req, res) => {
  setCookie(req, res, VISITOR_COOKIE, '', 0);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ ok: true });
  const given = String(req.body?.password || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Wrong password' });
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${authToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

// ---------- MCP connector (Claude and other MCP clients) ----------
// The MCP endpoint and token/registration endpoints live on an address that isn't behind
// Cloudflare Access (SHARE_URL, e.g. share.littleunusual.xyz), because Claude's servers call them.
// The sign-in page (/oauth/authorize) lives on the main address (PUBLIC_URL), behind the normal
// login, so the person approving is who they say they are.
const oauth = new OAuth(DATA_DIR, visitors.secret);
const origin = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const reqOrigin = (req) => `${req.protocol}://${req.get('host')}`;
const mcpBase = (req) => origin(process.env.MCP_URL || '') || SHARE_URL || origin(PUBLIC_URL) || reqOrigin(req);
const authBase = (req) => origin(PUBLIC_URL) || reqOrigin(req);
const appUrl = () => origin(PUBLIC_URL) || SHARE_URL || '';

const mcp = createMcp({
  store, perms, files, tmpDir: TMP_DIR, maxUpload: MAX_UPLOAD_MB * 1024 * 1024, appUrl,
  broadcastPatch: (boardId, patch, version) => broadcast(boardId, { t: 'patch', boardId, patch, version }),
  broadcastThread: (boardId, thread) => {
    const b = store.saveThread(boardId, thread);
    broadcast(boardId, { t: 'patch', boardId, patch: { upsertThreads: [thread] }, version: b.version });
    scheduleIndexBroadcast();
  },
  sendNotes: (boardId, patch) => sendNotes(boardId, patch),
  indexChanged: () => scheduleIndexBroadcast(),
});

// Claude and other clients call these from servers and browsers.
app.use(['/mcp', '/oauth/token', '/oauth/register', '/oauth/revoke', '/.well-known'], (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use('/oauth', express.urlencoded({ extended: false, limit: '64kb' }));

function protectedResource(req) {
  return {
    resource: `${mcpBase(req)}/mcp`,
    authorization_servers: [mcpBase(req)],
    bearer_methods_supported: ['header'],
    scopes_supported: ['boards'],
    resource_name: 'Reference Board',
  };
}
function authServer(req) {
  const base = mcpBase(req);
  return {
    issuer: base,
    authorization_endpoint: `${authBase(req)}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['boards'],
    client_id_metadata_document_supported: true,
  };
}
app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (req, res) => res.json(protectedResource(req)));
app.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp', '/.well-known/openid-configuration'], (req, res) => res.json(authServer(req)));

app.post('/oauth/register', (req, res) => {
  try {
    res.status(201).json(oauth.register(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.code || 'invalid_client_metadata', error_description: err.message });
  }
});

app.post('/oauth/token', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json(oauth.exchange(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.code || 'invalid_request', error_description: err.message });
  }
});

app.post('/oauth/revoke', (req, res) => {
  oauth.revoke(req.body?.token);
  res.status(200).end();
});

/** The consent page (and its error pages), in the app's look. */
function consentPage(res, status, title, body) {
  res.status(status).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Reference Board</title><link rel="icon" href="/favicon.svg">
<style>
:root{--bg:#f4f5f7;--panel:#fff;--text:#1f2330;--muted:#6b7180;--border:#e3e6eb;--accent:#6d4aff;--soft:#efeaff}
@media (prefers-color-scheme:dark){:root{--bg:#15171c;--panel:#20232a;--text:#e8eaf0;--muted:#a0a6b3;--border:#333844;--accent:#8b6dff;--soft:#2c2648}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.card{width:100%;max-width:440px;background:var(--panel);border-radius:14px;padding:28px;box-shadow:0 8px 28px rgba(20,24,36,.16)}
h1{font-size:20px;margin:12px 0 6px}p{color:var(--muted);margin:0 0 12px}ul{margin:0 0 16px;padding-left:20px;color:var(--muted)}b{color:var(--text)}
.who{display:flex;align-items:center;gap:10px;background:var(--soft);border-radius:10px;padding:10px 12px;margin:14px 0}
.row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}button,a.btn{font:inherit;font-weight:600;border:0;border-radius:8px;padding:9px 16px;cursor:pointer;text-decoration:none}
.primary{background:var(--accent);color:#fff}.secondary{background:var(--border);color:var(--text)}small{color:var(--muted);display:block;margin-top:14px;font-size:12px}
</style></head><body><div class="card"><img src="/favicon.svg" width="36" height="36" alt="">${body}</div></body></html>`);
}

const authParams = (src) => ({
  response_type: String(src.response_type || ''), client_id: String(src.client_id || ''), redirect_uri: String(src.redirect_uri || ''),
  code_challenge: String(src.code_challenge || ''), code_challenge_method: String(src.code_challenge_method || ''),
  state: src.state === undefined ? undefined : String(src.state), scope: String(src.scope || 'boards'), resource: String(src.resource || ''),
});

/** Validate an authorization request. Returns { client, params } or sends an error page. */
async function checkAuthorize(req, res, src) {
  const params = authParams(src);
  const client = await oauth.client(params.client_id);
  if (!client) { consentPage(res, 400, 'Unknown app', '<h1>Unknown app</h1><p>This app isn’t registered with Reference Board. Try connecting it again.</p>'); return null; }
  if (!client.redirect_uris.includes(params.redirect_uri) || !validRedirect(params.redirect_uri)) {
    consentPage(res, 400, 'Invalid request', '<h1>Invalid request</h1><p>The app sent a return address it didn’t register.</p>');
    return null;
  }
  const back = (error, description) => {
    const u = new URL(params.redirect_uri);
    u.searchParams.set('error', error);
    if (description) u.searchParams.set('error_description', description);
    if (params.state !== undefined) u.searchParams.set('state', params.state);
    res.redirect(302, u.href);
    return null;
  };
  if (params.response_type !== 'code') return back('unsupported_response_type');
  if (params.code_challenge_method !== 'S256' || !/^[\w-]{43,128}$/.test(params.code_challenge)) return back('invalid_request', 'PKCE with S256 is required');
  if (params.resource && params.resource.replace(/\/$/, '') !== `${mcpBase(req)}/mcp`) return back('invalid_target', 'Unknown resource');
  return { client, params };
}

app.get('/oauth/authorize', async (req, res) => {
  const member = await identifyMember(req);
  if (!member) {
    // Arrived on an address without sign-in (e.g. the share host): continue on the main address.
    const main = origin(PUBLIC_URL);
    if (main && main !== reqOrigin(req)) return res.redirect(302, `${main}${req.originalUrl}`);
    return consentPage(res, 401, 'Sign in', `<h1>Sign in to Reference Board first</h1><p>Open Reference Board, sign in, then connect the app again.</p><div class="row"><a class="btn primary" href="/">Open Reference Board</a></div>`);
  }
  const ok = await checkAuthorize(req, res, req.query);
  if (!ok) return;
  const { client, params } = ok;
  const who = member.email ? `${esc(member.name)} <span style="color:var(--muted)">(${esc(member.email)})</span>` : 'the Reference Board team';
  const hidden = Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('');
  const csrf = oauth.csrf(member.email || 'team', params);
  consentPage(res, 200, 'Connect an app', `<h1>Connect ${esc(client.client_name)} to Reference Board?</h1>
<div class="who">Signed in as <b>${who}</b></div>
<p>${esc(client.client_name)} will be able to, as you:</p>
<ul><li>see the projects and boards you have access to</li><li>add, change and arrange cards, and comment, wherever you can</li></ul>
<p>It can’t do anything you can’t do yourself, and an admin can disconnect it at any time.</p>
<form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${csrf}">
<div class="row"><button class="secondary" name="decision" value="deny">Cancel</button><button class="primary" name="decision" value="allow">Allow</button></div></form>
<small>After you allow it, you’ll return to ${esc(new URL(params.redirect_uri).host)}.</small>`);
});

app.post('/oauth/authorize', async (req, res) => {
  const member = await identifyMember(req);
  if (!member) return consentPage(res, 401, 'Sign in', '<h1>Your sign-in expired</h1><p>Sign in to Reference Board, then connect the app again.</p>');
  const ok = await checkAuthorize(req, res, req.body || {});
  if (!ok) return;
  const { params } = ok;
  const expected = oauth.csrf(member.email || 'team', params);
  if (String(req.body?.csrf || '') !== expected) return consentPage(res, 400, 'Expired', '<h1>This page expired</h1><p>Go back to the app and connect again.</p>');
  const u = new URL(params.redirect_uri);
  if (params.state !== undefined) u.searchParams.set('state', params.state);
  u.searchParams.set('iss', mcpBase(req));
  if (req.body.decision !== 'allow') {
    u.searchParams.set('error', 'access_denied');
    return res.redirect(302, u.href);
  }
  const code = oauth.issueCode({
    clientId: params.client_id, redirectUri: params.redirect_uri, codeChallenge: params.code_challenge,
    resource: `${mcpBase(req)}/mcp`, scope: 'boards', person: { email: member.email || null, name: member.name || 'Team' },
  });
  u.searchParams.set('code', code);
  res.redirect(302, u.href);
});

/** The person a bearer token acts for, with their current role and name. */
function mcpUser(t) {
  if (!t.email) return { anon: true, role: 'team', name: t.name || 'Team' };
  const u = users.touch(t.email);
  return { email: u.email, name: u.name, role: users.roleOf(u.email) };
}

app.post('/mcp', async (req, res) => {
  const bearer = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  const t = oauth.check(bearer);
  if (!t || (t.resource && t.resource !== `${mcpBase(req)}/mcp`)) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${mcpBase(req)}/.well-known/oauth-protected-resource", error="invalid_token"`);
    return res.status(401).json({ error: 'invalid_token', error_description: 'Connect Reference Board again' });
  }
  const user = mcpUser(t);
  const via = `${user.name} (via ${oauth.clients[t.clientId]?.client_name || 'an app'})`;
  const body = req.body;
  const batch = Array.isArray(body);
  const replies = [];
  for (const msg of batch ? body : [body]) {
    const r = await mcp.handle(msg, user, via);
    if (r) replies.push(r);
  }
  if (!replies.length) return res.status(202).end();
  res.json(batch ? replies : replies[0]);
});
// No server-to-client stream: everything is request/response.
app.get('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').end());
app.delete('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').end());

app.use(['/api', '/uploads'], async (req, res, next) => {
  const user = await identify(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
});

// ---------- people ----------
app.patch('/api/me', (req, res) => {
  if (req.user.visitor) return res.status(403).json({ error: 'Not available on shared links' });
  if (!req.user.email) return res.status(400).json({ error: 'Names are set in the browser when not using Cloudflare sign-in' });
  const u = users.rename(req.user.email, req.body?.name || '');
  // Update live presence and cursors everywhere this person is connected.
  const boards = new Set();
  for (const info of clients.values()) {
    if (info.email === u.email) { info.name = u.name; if (info.boardId) boards.add(info.boardId); }
  }
  boards.forEach(sendPresence);
  res.json({ email: u.email, name: u.name });
});

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const needTeam = (req, res, next) => (perms.isTeam(req.user) ? next() : res.status(403).json({ error: 'Only the core team can do that' }));
const needAdmin = (req, res, next) => (perms.isAdmin(req.user) ? next() : res.status(403).json({ error: 'Admins only' }));

// ---------- boards ----------
app.get('/api/boards', (req, res) => {
  res.json(perms.visibleBoards(req.user));
});

app.post('/api/boards', (req, res) => {
  const parent = req.body?.parentId ? store.get(req.body.parentId) : null;
  const projectId = parent ? parent.projectId : req.body?.projectId || null;
  // Team can create anywhere; editors can create boards inside their project, or inside a board they can edit.
  const allowed = perms.isTeam(req.user) || (parent ? perms.can(req.user, parent, 'edit') : atLeast(perms.projectLevel(req.user, projectId), 'edit'));
  if (!allowed) {
    return res.status(403).json({ error: 'You can’t create boards here' });
  }
  const board = store.create({ title: req.body?.title, parentId: req.body?.parentId || null, projectId });
  broadcastIndex();
  res.status(201).json(board);
});

// ---------- projects ----------
app.get('/api/projects', (req, res) => {
  res.json(perms.visibleProjects(req.user));
});

app.post('/api/projects', needTeam, (req, res) => {
  const project = store.createProject(req.body || {});
  broadcastIndex();
  res.status(201).json(project);
});

app.patch('/api/projects/:id', needTeam, (req, res) => {
  const project = store.updateProject(req.params.id, req.body || {});
  if (!project) return res.status(404).json({ error: 'Project not found' });
  broadcastIndex();
  res.json(project);
});

// Deleting a project moves it, with all of its boards, to the trash for 30 days.
app.delete('/api/projects/:id', needTeam, (req, res) => {
  const ids = store.trashProject(req.params.id, req.user.name || req.user.email || 'team');
  if (!ids) return res.status(404).json({ error: 'Project not found' });
  for (const id of ids) broadcast(id, { t: 'deleted', boardId: id });
  accessChanged();
  res.json({ ok: true, boards: ids.length });
});

// Invite someone to a project (or change their role there). Team only.
app.put('/api/projects/:id/members/:email', needTeam, (req, res) => {
  const email = decodeURIComponent(req.params.email).trim().toLowerCase();
  const role = req.body?.role;
  if (!isEmail(email)) return res.status(400).json({ error: 'That doesn’t look like an email address' });
  if (!MEMBER_ROLES.includes(role)) return res.status(400).json({ error: 'Role must be editor, commenter or viewer' });
  if (users.roleOf(email) !== 'guest') return res.status(400).json({ error: 'That person is on the core team and already has access to every project' });
  const p = store.setMember(req.params.id, email, role, req.user.email || 'team');
  if (!p) return res.status(404).json({ error: 'Project not found' });
  accessChanged();
  res.json(perms.visibleProjects(req.user).find((x) => x.id === p.id));
});

app.delete('/api/projects/:id/members/:email', needTeam, (req, res) => {
  const email = decodeURIComponent(req.params.email).trim().toLowerCase();
  if (!store.removeMember(req.params.id, email)) return res.status(404).json({ error: 'Not a member' });
  accessChanged();
  res.json({ ok: true });
});

// ---------- sharing one board ----------
const shareBase = (req) => SHARE_URL || `${req.protocol}://${req.get('host')}`;
const peopleInfo = (email) => ({ name: users.get(email)?.name || null, lastSeen: users.get(email)?.lastSeen || 0 });

/** Everything the Share dialog shows for a board. Team only: it includes the secret link. */
function sharingInfo(req, board) {
  const project = board.projectId ? store.projects.get(board.projectId) : null;
  const members = Object.entries(board.members || {}).map(([email, m]) => ({ email, ...m, ...peopleInfo(email) }));
  const inherited = [];
  for (const a of store.ancestors(board.id)) {
    for (const [email, m] of Object.entries(a.members || {})) inherited.push({ email, role: m.role, ...peopleInfo(email), from: { type: 'board', id: a.id, name: a.title } });
  }
  for (const [email, m] of Object.entries(project?.members || {})) inherited.push({ email, role: m.role, ...peopleInfo(email), from: { type: 'project', id: project.id, name: project.name } });
  const share = board.share || { mode: 'off', requireIdentity: true };
  const parentLinks = store.ancestors(board.id).filter((a) => a.share && a.share.mode !== 'off').map((a) => ({ id: a.id, title: a.title, mode: a.share.mode }));
  const linkVisitors = visitors.list()
    .map((v) => ({ name: v.name, email: v.email, lastSeen: Math.max(0, ...Object.entries(v.boards).filter(([id]) => store.isWithin(id, board.id)).map(([, at]) => at)) }))
    .filter((v) => v.lastSeen > 0);
  return {
    boardId: board.id,
    project: project ? { id: project.id, name: project.name } : null,
    members,
    inherited,
    link: { mode: share.mode, requireIdentity: share.requireIdentity !== false, url: board.share ? `${shareBase(req)}/s/${board.share.token}` : null },
    parentLinks,
    linkVisitors,
    // In Cloudflare mode, links only work from a hostname that isn't behind Access.
    shareHostMissing: AUTH_MODE === 'cloudflare' && !SHARE_URL,
  };
}

const teamBoard = (req, res) => {
  const board = store.get(req.params.id);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return null; }
  return board;
};

app.get('/api/boards/:id/sharing', needTeam, (req, res) => {
  const board = teamBoard(req, res);
  if (board) res.json(sharingInfo(req, board));
});

app.put('/api/boards/:id/share', needTeam, (req, res) => {
  const board = teamBoard(req, res);
  if (!board) return;
  const { mode, requireIdentity } = req.body || {};
  if (mode !== undefined && !['off', 'view', 'comment'].includes(mode)) return res.status(400).json({ error: 'Link access must be off, view or comment' });
  store.setShare(board.id, { mode, requireIdentity }, req.user.email || 'team');
  accessChanged();
  res.json(sharingInfo(req, board));
});

app.post('/api/boards/:id/share/reset', needTeam, (req, res) => {
  const board = teamBoard(req, res);
  if (!board) return;
  store.resetShareToken(board.id);
  accessChanged();
  res.json(sharingInfo(req, board));
});

app.put('/api/boards/:id/members/:email', needTeam, (req, res) => {
  const board = teamBoard(req, res);
  if (!board) return;
  const email = decodeURIComponent(req.params.email).trim().toLowerCase();
  const role = req.body?.role;
  if (!isEmail(email)) return res.status(400).json({ error: 'That doesn’t look like an email address' });
  if (!MEMBER_ROLES.includes(role)) return res.status(400).json({ error: 'Role must be editor, commenter or viewer' });
  if (users.roleOf(email) !== 'guest') return res.status(400).json({ error: 'That person is on the core team and already has access to every board' });
  store.setBoardMember(board.id, email, role, req.user.email || 'team');
  accessChanged();
  res.json(sharingInfo(req, board));
});

app.delete('/api/boards/:id/members/:email', needTeam, (req, res) => {
  const board = teamBoard(req, res);
  if (!board) return;
  const email = decodeURIComponent(req.params.email).trim().toLowerCase();
  if (!store.removeBoardMember(board.id, email)) return res.status(404).json({ error: 'Not invited to this board' });
  accessChanged();
  res.json(sharingInfo(req, board));
});

// ---------- admin dashboard ----------
app.get('/api/admin', needAdmin, (_req, res) => {
  const projects = store.listProjects();
  const boardsWithMembers = [...store.boards.values()].filter((b) => b.members && Object.keys(b.members).length);
  const people = users.list().map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    lastSeen: u.lastSeen,
    createdAt: u.createdAt,
    removedForInactivity: u.removedForInactivity || null,
    projects: projects.filter((p) => p.members?.[u.email]).map((p) => ({ id: p.id, name: p.name, role: p.members[u.email].role })),
    boards: boardsWithMembers.filter((b) => b.members[u.email]).map((b) => ({ id: b.id, name: b.title, role: b.members[u.email].role })),
  }));
  // People invited to projects who haven't signed in yet.
  for (const p of projects) {
    for (const [email, m] of Object.entries(p.members || {})) {
      let row = people.find((x) => x.email === email);
      if (!row) {
        row = { email, name: null, role: users.roleOf(email), lastSeen: 0, createdAt: m.invitedAt, pending: true, removedForInactivity: null, projects: [], boards: [] };
        people.push(row);
      }
      if (row.pending) row.projects.push({ id: p.id, name: p.name, role: m.role });
    }
  }
  for (const b of boardsWithMembers) {
    for (const [email, m] of Object.entries(b.members)) {
      let row = people.find((x) => x.email === email);
      if (!row) {
        row = { email, name: null, role: users.roleOf(email), lastSeen: 0, createdAt: m.invitedAt, pending: true, removedForInactivity: null, projects: [], boards: [] };
        people.push(row);
      }
      if (row.pending) row.boards.push({ id: b.id, name: b.title, role: m.role });
    }
  }
  const linkVisitors = visitors.list().map((v) => ({
    id: v.id,
    name: v.name,
    email: v.email,
    createdAt: v.createdAt,
    lastSeen: v.lastSeen,
    boards: Object.entries(v.boards).filter(([id]) => store.get(id)).map(([id, at]) => ({ id, name: store.get(id).title, at, link: store.get(id).share?.mode || 'off' })),
  }));
  people.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  res.json({
    people,
    visitors: linkVisitors,
    settings: users.settings,
    adminEmails: ADMIN_EMAILS,
    teamDomains: TEAM_DOMAINS,
    stats: {
      projects: projects.length,
      boards: store.boards.size,
      files: Object.keys(files.index.files).length,
      storage: files.mode,
      activeLast7Days: people.filter((u) => Date.now() - (u.lastSeen || 0) < 7 * 24 * 3600 * 1000).length,
    },
  });
});

// The Claude connector: its address, whether it's set up, and who has connected which app.
app.get('/api/admin/mcp', needAdmin, (req, res) => {
  const warnings = [];
  if (AUTH_MODE === 'cloudflare' && !SHARE_URL && !process.env.MCP_URL) warnings.push('Set SHARE_URL (an address not behind Cloudflare Access) so Claude can reach the connector.');
  if (AUTH_MODE === 'cloudflare' && !PUBLIC_URL) warnings.push('Set PUBLIC_URL (the main address) so people can sign in when connecting.');
  res.json({ url: `${mcpBase(req)}/mcp`, warnings, connections: oauth.connections() });
});

app.delete('/api/admin/mcp/connections', needAdmin, (req, res) => {
  const email = String(req.query.email || '') || null;
  const n = oauth.revokePerson(email, String(req.query.client || '') || null);
  res.json({ ok: true, revoked: n });
});

app.patch('/api/admin/people/:email', needAdmin, (req, res) => {
  const email = decodeURIComponent(req.params.email).trim().toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: 'Invalid email' });
  try {
    if (!ROLES.includes(req.body?.role)) return res.status(400).json({ error: 'Role must be admin, team or guest' });
    users.setRole(email, req.body.role);
    // Team members see everything, so project-level entries become redundant.
    if (req.body.role !== 'guest') store.removeMemberEverywhere(email);
    accessChanged();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Remove someone completely: their profile and every project invite.
app.delete('/api/admin/people/:email', needAdmin, (req, res) => {
  const email = decodeURIComponent(req.params.email).trim().toLowerCase();
  try {
    store.removeMemberEverywhere(email);
    if (users.get(email)) users.remove(email);
    oauth.revokePerson(email);
    accessChanged();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Forget a link visitor's name and email. (Their access comes from the link: turn it off or reset it to stop it.)
app.delete('/api/admin/visitors/:id', needAdmin, (req, res) => {
  if (!visitors.remove(req.params.id)) return res.status(404).json({ error: 'Visitor not found' });
  res.json({ ok: true });
});

app.patch('/api/admin/settings', needAdmin, (req, res) => {
  try {
    const settings = users.updateSettings(req.body || {});
    sweepInactive();
    res.json(settings);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/boards/:id', (req, res) => {
  const board = store.get(req.params.id);
  // Same answer for "missing" and "not yours", so board ids can't be probed.
  if (!board || !perms.can(req.user, board, 'view')) return res.status(404).json({ error: 'Board not found' });
  // Invites and the secret link are only for the Share dialog; assets have their own endpoint.
  const { members: _m, share: _s, assets: _a, notes, ...rest } = board;
  const access = perms.boardLevel(req.user, board);
  // Notes are the editors' scratchpad: clients and viewers never get them.
  res.json({ ...rest, ...(atLeast(access, 'edit') ? { notes: notes || {} } : {}), access });
});

app.post('/api/boards/:id/patch', (req, res) => {
  const board = store.get(req.params.id);
  const level = perms.boardLevel(req.user, board);
  if (!board || !level) return res.status(404).json({ error: 'Board not found' });
  const patch = req.body || {};
  if (level === 'view') return res.status(403).json({ error: 'You have view-only access to this board' });
  if (level === 'comment') return res.status(403).json({ error: 'You can comment on this board, but not change it' });
  // Moving boards between projects changes who can see them: team only.
  if (patch.projectId !== undefined && level !== 'manage') return res.status(403).json({ error: 'Only the core team can move boards between projects' });
  if (patch.cover !== undefined && level !== 'manage') return res.status(403).json({ error: 'Only the core team can change board covers' });
  const result = store.applyPatch(req.params.id, patch);
  const origin = String(req.headers['x-client-id'] || '');
  broadcast(req.params.id, { t: 'patch', boardId: req.params.id, patch: result.patch, version: result.board.version }, origin);
  scheduleIndexBroadcast();
  res.json({ version: result.board.version });
});

// ---------- assets: every file uploaded or imported to a board (the Assets panel) ----------
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'file']);

function boardAssets(board) {
  const out = new Map();
  for (const a of board.assets || []) out.set(a.url, { url: a.url, name: a.name, mime: a.mime, size: a.size, at: a.at, by: a.by || null });
  for (const it of Object.values(board.items)) {
    if (MEDIA_TYPES.has(it.type) && typeof it.url === 'string' && it.url.startsWith('/uploads/') && !out.has(it.url)) {
      out.set(it.url, { url: it.url, name: it.fileName || it.url.split('/').pop(), mime: it.mime || '', size: it.size || 0, at: it.createdAt || board.createdAt, by: it.createdBy || null });
    }
  }
  const used = new Set(Object.values(board.items).map((it) => it.url).filter(Boolean));
  return [...out.values()].map((a) => ({ ...a, onBoard: used.has(a.url), boardId: board.id, boardTitle: board.title }));
}

// Rename a file: its entry in the board's assets and every card on that board that shows it.
app.patch('/api/boards/:id/assets', (req, res) => {
  const board = store.get(req.params.id);
  if (!board || !perms.can(req.user, board, 'edit')) return res.status(404).json({ error: 'Board not found' });
  const url = String(req.body?.url || '');
  const name = String(req.body?.name || '').trim().replace(/[\\/]/g, '-').slice(0, 200);
  if (!url || !name) return res.status(400).json({ error: 'A name is needed' });
  const asset = (board.assets || []).find((a) => a.url === url);
  if (asset) { asset.name = name; store.persist(board.id); }
  const cards = Object.values(board.items).filter((it) => it.url === url && it.fileName !== undefined);
  if (cards.length) {
    const result = store.applyPatch(board.id, { upsertItems: cards.map((it) => ({ ...it, fileName: name })) });
    broadcast(board.id, { t: 'patch', boardId: board.id, patch: result.patch, version: result.board.version });
  }
  if (!asset && !cards.length) return res.status(404).json({ error: 'File not found on this board' });
  res.json({ ok: true, name });
});

app.get('/api/boards/:id/assets', (req, res) => {
  const board = store.get(req.params.id);
  if (!board || !perms.can(req.user, board, 'edit')) return res.status(404).json({ error: 'Board not found' });
  const boards = req.query.scope === 'project' && board.projectId
    ? [...store.boards.values()].filter((b) => b.projectId === board.projectId && perms.can(req.user, b, 'view'))
    : [board];
  const seen = new Set();
  const list = boards.flatMap(boardAssets).sort((a, b) => (b.at || 0) - (a.at || 0)).filter((a) => !seen.has(a.url) && seen.add(a.url));
  res.json(list);
});

// ---------- notes (editors' scratchpad beside the canvas; never sent to commenters/viewers) ----------
// Kept as typed (no trimming: notes are saved while you type).
const noteText = (v) => String(v ?? '').replace(/\r\n/g, '\n').slice(0, 20000);

function noteAccess(req, res) {
  const board = store.get(req.params.id);
  if (!board || !perms.can(req.user, board, 'view')) { res.status(404).json({ error: 'Board not found' }); return null; }
  if (!perms.can(req.user, board, 'edit')) { res.status(403).json({ error: 'Only editors can use board notes' }); return null; }
  return board;
}

function sendNotes(boardId, patch) {
  // Only people who can edit the board receive notes.
  for (const [ws, info] of clients) {
    if (info.boardId === boardId && perms.can(info.user, store.get(boardId), 'edit')) send(ws, { t: 'patch', boardId, patch });
  }
}

app.post('/api/boards/:id/notes', (req, res) => {
  const board = noteAccess(req, res);
  if (!board) return;
  const user = actor(req);
  const note = { id: crypto.randomUUID(), text: noteText(req.body?.text), color: typeof req.body?.color === 'string' ? req.body.color.slice(0, 20) : 'yellow', author: user.name, authorEmail: user.email || null, createdAt: Date.now(), updatedAt: Date.now() };
  store.saveNote(board.id, note);
  sendNotes(board.id, { upsertNotes: [note] });
  res.status(201).json(note);
});

app.patch('/api/boards/:id/notes/:nid', (req, res) => {
  const board = noteAccess(req, res);
  if (!board) return;
  const prev = board.notes?.[req.params.nid];
  if (!prev) return res.status(404).json({ error: 'This note was deleted' });
  const note = { ...prev, updatedAt: Date.now(), editedBy: actor(req).name };
  if (req.body?.text !== undefined) note.text = noteText(req.body.text);
  if (typeof req.body?.color === 'string') note.color = req.body.color.slice(0, 20);
  store.saveNote(board.id, note);
  sendNotes(board.id, { upsertNotes: [note] });
  res.json(note);
});

app.delete('/api/boards/:id/notes/:nid', (req, res) => {
  const board = noteAccess(req, res);
  if (!board) return;
  if (!store.removeNote(board.id, req.params.nid)) return res.status(404).json({ error: 'This note was deleted' });
  sendNotes(board.id, { removeNotes: [req.params.nid] });
  res.json({ ok: true });
});

// ---------- templates (team only: they can hold content from any project) ----------
app.get('/api/templates', needTeam, (_req, res) => res.json(templates.summaries()));

app.get('/api/templates/:id', needTeam, (req, res) => {
  const t = templates.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json(t);
});

app.post('/api/templates', needTeam, (req, res) => {
  try {
    const t = templates.create(req.body || {}, req.user.name || req.user.email || 'team');
    res.status(201).json({ id: t.id, name: t.name, category: t.category });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/templates/:id', needTeam, (req, res) => {
  if (!templates.remove(req.params.id)) return res.status(404).json({ error: 'Template not found' });
  res.json({ ok: true });
});

// ---------- comments (Figma-style pinned threads) ----------
// Each change is its own request applied on the server, so two people replying at once can't
// overwrite each other. Everyone on the board gets the updated thread over the WebSocket.
const MAX_COMMENT = 5000;
const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

/** Who is acting. Without sign-in (password/open mode) the browser says its display name. */
function actor(req) {
  if (req.user.email) return req.user;
  let name = '';
  try { name = decodeURIComponent(String(req.headers['x-user-name'] || '')); } catch { /* bad encoding */ }
  return { ...req.user, name: name.trim().slice(0, 60) || 'Someone' };
}

function newComment(user, text) {
  const c = { id: crypto.randomUUID(), author: user.name, text, at: Date.now() };
  if (user.email) c.authorEmail = user.email;
  if (user.visitor) c.viaLink = true;
  return c;
}

const cleanText = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_COMMENT);

/** Where a pin sits: on a card (moves with it) or at a spot on the board. */
function pinPlace(board, body) {
  const x = num(body.x);
  const y = num(body.y);
  if (x === null || y === null) return null;
  const place = { x, y, itemId: null, dx: null, dy: null };
  const item = typeof body.itemId === 'string' ? board.items[body.itemId] : null;
  if (item && num(body.dx) !== null && num(body.dy) !== null) Object.assign(place, { itemId: item.id, dx: num(body.dx), dy: num(body.dy) });
  return place;
}

/** Load the board and thread, check the person may comment. Sends the error response itself. */
function threadAccess(req, res, needThread = true) {
  const board = store.get(req.params.id);
  const level = perms.boardLevel(req.user, board);
  if (!board || !level) { res.status(404).json({ error: 'Board not found' }); return null; }
  if (!atLeast(level, 'comment')) { res.status(403).json({ error: 'You have view-only access to this board' }); return null; }
  const thread = needThread ? board.threads?.[req.params.tid] : null;
  if (needThread && !thread) { res.status(404).json({ error: 'This comment was deleted' }); return null; }
  return { board, thread, level, user: actor(req), moderator: atLeast(level, 'edit') };
}

function sendThread(res, boardId, thread) {
  const board = store.saveThread(boardId, thread);
  broadcast(boardId, { t: 'patch', boardId, patch: { upsertThreads: [thread] }, version: board.version });
  scheduleIndexBroadcast();
  res.json(thread);
}

function dropThread(res, boardId, threadId) {
  const board = store.removeThread(boardId, threadId);
  broadcast(boardId, { t: 'patch', boardId, patch: { removeThreads: [threadId] }, version: board.version });
  scheduleIndexBroadcast();
  res.json({ ok: true });
}

// Start a thread: a pin plus its first comment.
app.post('/api/boards/:id/threads', (req, res) => {
  const a = threadAccess(req, res, false);
  if (!a) return;
  const text = cleanText(req.body?.text);
  if (!text) return res.status(400).json({ error: 'Write something first' });
  const place = pinPlace(a.board, req.body || {});
  if (!place) return res.status(400).json({ error: 'Missing position' });
  const thread = { id: crypto.randomUUID(), ...place, createdAt: Date.now(), resolved: null, comments: [newComment(a.user, text)] };
  sendThread(res, a.board.id, thread);
});

app.post('/api/boards/:id/threads/:tid/comments', (req, res) => {
  const a = threadAccess(req, res);
  if (!a) return;
  const text = cleanText(req.body?.text);
  if (!text) return res.status(400).json({ error: 'Write something first' });
  sendThread(res, a.board.id, { ...a.thread, comments: [...a.thread.comments, newComment(a.user, text)] });
});

// Resolve / reopen (anyone who can comment), or move the pin (its author, or an editor).
app.patch('/api/boards/:id/threads/:tid', (req, res) => {
  const a = threadAccess(req, res);
  if (!a) return;
  const next = { ...a.thread };
  if (typeof req.body?.resolved === 'boolean') {
    next.resolved = req.body.resolved ? { by: a.user.name, byEmail: a.user.email || null, at: Date.now() } : null;
  }
  if (req.body?.x !== undefined) {
    if (!a.moderator && !isOwnComment(a.user, a.thread.comments[0] || {})) return res.status(403).json({ error: 'Only the person who started this thread can move it' });
    const place = pinPlace(a.board, req.body);
    if (!place) return res.status(400).json({ error: 'Missing position' });
    Object.assign(next, place);
  }
  sendThread(res, a.board.id, next);
});

// Deleting a thread removes its replies too, so only its author or an editor may.
app.delete('/api/boards/:id/threads/:tid', (req, res) => {
  const a = threadAccess(req, res);
  if (!a) return;
  if (!a.moderator && !isOwnComment(a.user, a.thread.comments[0] || {})) return res.status(403).json({ error: 'Only the person who started this thread can delete it' });
  dropThread(res, a.board.id, a.thread.id);
});

app.patch('/api/boards/:id/threads/:tid/comments/:cid', (req, res) => {
  const a = threadAccess(req, res);
  if (!a) return;
  const c = a.thread.comments.find((x) => x.id === req.params.cid);
  if (!c) return res.status(404).json({ error: 'This comment was deleted' });
  if (!isOwnComment(a.user, c)) return res.status(403).json({ error: 'You can only edit your own comments' });
  const text = cleanText(req.body?.text);
  if (!text) return res.status(400).json({ error: 'A comment can’t be empty' });
  const comments = a.thread.comments.map((x) => (x.id === c.id ? { ...x, text, editedAt: Date.now() } : x));
  sendThread(res, a.board.id, { ...a.thread, comments });
});

app.delete('/api/boards/:id/threads/:tid/comments/:cid', (req, res) => {
  const a = threadAccess(req, res);
  if (!a) return;
  const idx = a.thread.comments.findIndex((x) => x.id === req.params.cid);
  if (idx < 0) return res.status(404).json({ error: 'This comment was deleted' });
  if (!a.moderator && !isOwnComment(a.user, a.thread.comments[idx])) return res.status(403).json({ error: 'You can only delete your own comments' });
  // The first comment is the thread, as in Figma: deleting it deletes the thread.
  if (idx === 0) return dropThread(res, a.board.id, a.thread.id);
  sendThread(res, a.board.id, { ...a.thread, comments: a.thread.comments.filter((_, i) => i !== idx) });
});

// Copy a board (and the boards inside it): from a tile menu, or Alt-dragging a board card.
app.post('/api/boards/:id/duplicate', (req, res) => {
  const board = store.get(req.params.id);
  if (!board || !perms.can(req.user, board, 'view')) return res.status(404).json({ error: 'Board not found' });
  const parent = req.body?.parentId ? store.get(req.body.parentId) : null;
  // Copying into a board needs edit access there; a new top-level board is for the team.
  const allowed = parent ? perms.can(req.user, parent, 'edit') : perms.isTeam(req.user);
  if (!allowed) return res.status(403).json({ error: 'You can’t copy boards here' });
  const copy = store.duplicate(board.id, parent?.id || null);
  broadcastIndex();
  res.status(201).json(store.summary(copy));
});

app.delete('/api/boards/:id', needTeam, (req, res) => {
  const board = store.get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  // Remove any board cards that point at this board from its parent.
  const parent = board.parentId ? store.get(board.parentId) : null;
  // To the trash (restorable for 30 days), with the boards nested inside it.
  const deleted = store.trashBoard(req.params.id, req.user.name || req.user.email || 'team');
  if (parent) {
    const stale = Object.values(parent.items).filter((i) => i.type === 'board' && deleted.includes(i.boardId)).map((i) => i.id);
    if (stale.length) {
      const result = store.applyPatch(parent.id, { removeItems: stale });
      broadcast(parent.id, { t: 'patch', boardId: parent.id, patch: result.patch, version: result.board.version });
    }
  }
  for (const id of deleted) broadcast(id, { t: 'deleted', boardId: id });
  broadcastIndex();
  res.json({ deleted });
});

// Every image in a project's boards, for picking a cover.
app.get('/api/projects/:id/images', needTeam, (req, res) => {
  const seen = new Set();
  const out = [];
  for (const b of store.boards.values()) {
    if (b.projectId !== req.params.id) continue;
    const add = (url, name) => { if (url && !seen.has(url)) { seen.add(url); out.push({ url, name: name || url.split('/').pop(), boardTitle: b.title }); } };
    for (const it of Object.values(b.items)) {
      if (it.type === 'image') add(it.url, it.fileName || it.caption);
      if (it.type === 'link' && it.thumb) add(it.thumb, it.title);
    }
    for (const a of b.assets || []) if ((a.mime || '').startsWith('image/')) add(a.url, a.name);
  }
  res.json(out);
});

// ---------- recycle bin (team only) ----------
const TRASH_DAYS = 30;

app.get('/api/trash', needTeam, (_req, res) => {
  const all = [...store.trash.values()];
  const count = (root) => all.filter((b) => b.trashRoot === root).length;
  const projectName = (id) => (store.projects.get(id) || store.trashedProjects.get(id))?.name || null;
  const purgeAt = (at) => at + TRASH_DAYS * 24 * 3600 * 1000;
  res.json({
    days: TRASH_DAYS,
    projects: [...store.trashedProjects.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, deletedAt: p.deletedAt, deletedBy: p.deletedBy || null, purgeAt: purgeAt(p.deletedAt), boards: count(`project:${p.id}`) })),
    boards: all.filter((b) => b.trashRoot === b.id).map((b) => ({
      id: b.id, title: b.title, deletedAt: b.deletedAt, deletedBy: b.deletedBy || null, purgeAt: purgeAt(b.deletedAt),
      boards: count(b.id), projectName: b.projectId ? projectName(b.projectId) : null, cover: store.summary(b).cover,
    })),
  });
});

app.post('/api/trash/boards/:id/restore', needTeam, (req, res) => {
  const back = store.restoreRoot(req.params.id);
  if (!back.length) return res.status(404).json({ error: 'Not in the trash' });
  // Put a card for it back on its parent board.
  const root = back.find((b) => b.id === req.params.id);
  const parent = root?.parentId ? store.get(root.parentId) : null;
  if (parent && !Object.values(parent.items).some((i) => i.type === 'board' && i.boardId === root.id)) {
    const items = Object.values(parent.items);
    const z = Math.max(0, ...items.map((i) => i.z || 0)) + 1;
    const y = items.length ? Math.max(...items.map((i) => (i.y || 0))) + 260 : 100;
    const result = store.applyPatch(parent.id, { upsertItems: [{ id: crypto.randomUUID(), type: 'board', boardId: root.id, x: 80, y, w: 180, z, createdAt: Date.now() }] });
    broadcast(parent.id, { t: 'patch', boardId: parent.id, patch: result.patch, version: result.board.version });
  }
  broadcastIndex();
  res.json({ ok: true, restored: back.map((b) => b.id) });
});

app.post('/api/trash/projects/:id/restore', needTeam, (req, res) => {
  const back = store.restoreProject(req.params.id);
  if (!back) return res.status(404).json({ error: 'Not in the trash' });
  accessChanged();
  res.json({ ok: true, restored: back.map((b) => b.id) });
});

app.delete('/api/trash/boards/:id', needTeam, (req, res) => {
  if (![...store.trash.values()].some((b) => b.trashRoot === req.params.id)) return res.status(404).json({ error: 'Not in the trash' });
  store.purgeRoot(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/trash/projects/:id', needTeam, (req, res) => {
  if (!store.purgeProject(req.params.id)) return res.status(404).json({ error: 'Not in the trash' });
  res.json({ ok: true });
});

function emptyOldTrash() {
  const n = store.purgeOld(TRASH_DAYS);
  if (n) console.log(`Trash: permanently deleted ${n} item(s) older than ${TRASH_DAYS} days`);
}
setTimeout(emptyOldTrash, 45 * 1000).unref();
setInterval(emptyOldTrash, 6 * 3600 * 1000).unref();

// ---------- uploads ----------
// Files are sent in chunks (≤ 16 MB each) so large videos get past proxy request limits
// (Cloudflare rejects single requests over 100 MB) and a flaky connection only retries one chunk.
const MAX_UPLOAD = MAX_UPLOAD_MB * 1024 * 1024;
const sessions = new Map(); // id -> { path, size, received, name, mime, boardId, at }
// Files each person uploaded this server run, so they can load them before the card is saved.
const recentUploads = new Map(); // owner -> Set(url)
const ownerKey = (user) => (user.visitor ? `visitor:${user.visitorId}` : user.email || 'team');

app.post('/api/uploads', (req, res) => {
  const size = Number(req.body?.size);
  const name = String(req.body?.name || 'file').slice(0, 200);
  if (!Number.isFinite(size) || size < 0) return res.status(400).json({ error: 'Missing file size' });
  if (size > MAX_UPLOAD) return res.status(413).json({ error: `File is larger than ${MAX_UPLOAD_MB} MB` });
  const target = req.body?.boardId ? store.get(req.body.boardId) : null;
  if (!perms.isTeam(req.user) && !perms.can(req.user, target, 'edit')) return res.status(403).json({ error: 'You can’t upload to this board' });
  const id = crypto.randomUUID();
  const file = path.join(TMP_DIR, id);
  fs.writeFileSync(file, '');
  sessions.set(id, { owner: ownerKey(req.user), path: file, size, received: 0, name, mime: String(req.body?.mime || 'application/octet-stream').slice(0, 100), boardId: req.body?.boardId || null, at: Date.now() });
  res.status(201).json({ id, chunkSize: 16 * 1024 * 1024 });
});

const ownSession = (req) => {
  const s = sessions.get(req.params.id);
  return s && s.owner === ownerKey(req.user) ? s : null;
};

app.put('/api/uploads/:id', express.raw({ type: () => true, limit: '17mb' }), (req, res) => {
  const s = ownSession(req);
  if (!s) return res.status(404).json({ error: 'Upload not found — please retry' });
  const offset = Number(req.query.offset);
  // A retried chunk the server already has is fine; anything else out of order is not.
  if (offset + req.body.length <= s.received) return res.json({ received: s.received });
  if (offset !== s.received) return res.status(409).json({ error: 'Out-of-order chunk', received: s.received });
  if (s.received + req.body.length > s.size) return res.status(400).json({ error: 'More data than announced' });
  fs.appendFileSync(s.path, req.body);
  s.received += req.body.length;
  s.at = Date.now();
  res.json({ received: s.received });
});

app.post('/api/uploads/:id/complete', async (req, res) => {
  const s = ownSession(req);
  if (!s) return res.status(404).json({ error: 'Upload not found — please retry' });
  if (s.received !== s.size) return res.status(400).json({ error: 'Upload incomplete', received: s.received });
  sessions.delete(req.params.id);
  // Drive folder per project, so files are easy to find in Google Drive too.
  const board = s.boardId ? store.get(s.boardId) : null;
  const project = board?.projectId ? store.projects.get(board.projectId) : null;
  try {
    const meta = await files.store(s.path, {
      original: s.name,
      mime: s.mime,
      size: s.size,
      folderKey: project ? project.id : 'unfiled',
      folderName: project ? project.name : 'Unfiled',
    });
    stored(req, board, meta);
    res.json(meta);
  } catch (err) {
    fs.rm(s.path, { force: true }, () => {});
    console.error('Upload failed:', err.message);
    res.status(502).json({ error: files.mode === 'drive' ? 'Could not save to Google Drive — try again' : 'Could not save the file' });
  }
});

/** After a file is saved: the uploader can load it straight away, and the board remembers it. */
function stored(req, board, meta) {
  const owner = ownerKey(req.user);
  if (!recentUploads.has(owner)) recentUploads.set(owner, new Set());
  recentUploads.get(owner).add(meta.url);
  if (board) store.addAsset(board.id, { ...meta, at: Date.now(), by: req.user.name || req.user.email || 'Someone' });
}

// Paste/drop from a website, or a pasted image link: fetch the original file (so GIFs stay
// animated) and store it like an upload. Answers { media: false } for ordinary web pages.
app.post('/api/import-url', async (req, res) => {
  const board = req.body?.boardId ? store.get(req.body.boardId) : null;
  if (!board || !perms.can(req.user, board, 'edit')) return res.status(403).json({ error: 'You can’t add files to this board' });
  let url;
  try { url = new URL(String(req.body?.url || '')); } catch { return res.status(400).json({ error: 'That isn’t a link' }); }
  let got = null;
  try {
    got = await importMedia(url.href, TMP_DIR, MAX_UPLOAD);
  } catch (err) {
    return res.status(422).json({ error: `Couldn’t fetch that file: ${err.message}` });
  }
  if (!got) return res.json({ media: false });
  const project = board.projectId ? store.projects.get(board.projectId) : null;
  try {
    const meta = await files.store(got.path, {
      original: got.name, mime: got.mime, size: got.size,
      folderKey: project ? project.id : 'unfiled', folderName: project ? project.name : 'Unfiled',
    });
    stored(req, board, meta);
    res.json({ media: true, ...meta, sourceUrl: got.sourceUrl });
  } catch (err) {
    fs.rm(got.path, { force: true }, () => {});
    console.error('Import failed:', err.message);
    res.status(502).json({ error: 'Could not save the file' });
  }
});

app.delete('/api/uploads/:id', (req, res) => {
  const s = ownSession(req);
  if (s) { sessions.delete(req.params.id); fs.rm(s.path, { force: true }, () => {}); }
  res.json({ ok: true });
});

// Abandoned uploads are cleaned up after a day.
setInterval(() => {
  for (const [id, s] of sessions) {
    if (Date.now() - s.at > 24 * 3600 * 1000) { sessions.delete(id); fs.rm(s.path, { force: true }, () => {}); }
  }
}, 3600 * 1000).unref();

app.get('/api/storage', needTeam, (_req, res) => {
  res.json({ mode: files.mode, files: Object.keys(files.index.files).length });
});

// Guests can only load files that appear on boards they can see.
app.use('/uploads', (req, res, next) => {
  const url = `/uploads/${path.basename(decodeURIComponent(req.path))}`;
  if (recentUploads.get(ownerKey(req.user))?.has(url) || perms.canReadFile(req.user, url)) return next();
  res.status(404).json({ error: 'File not found' });
});

// Local files first (also everything uploaded before Drive was switched on), then Drive.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', setHeaders: (res, filePath) => safeHeaders(res, filePath) }));
app.get('/uploads/:name', (req, res) => files.serve(req, res));

// ---------- backups ----------
async function runBackup() {
  try {
    store.flushAll();
    const name = await files.backup({ at: new Date().toISOString(), projects: [...store.listProjects(), ...store.trashedProjects.values()], boards: [...store.boards.values(), ...store.trash.values()] });
    if (name) console.log(`Backup saved: ${name} (${files.mode})`);
  } catch (err) {
    console.error('Backup failed:', err.message);
  }
}
setTimeout(runBackup, 60 * 1000).unref();
setInterval(runBackup, 6 * 3600 * 1000).unref(); // at most one file per day; re-checks every 6h

// ---------- link previews ----------
app.get('/api/unfurl', async (req, res) => {
  if (req.user.visitor) return res.status(403).json({ error: 'Not available on shared links' });
  try {
    res.json(await unfurl(String(req.query.url || '')));
  } catch (err) {
    res.status(422).json({ error: err.message || 'Could not preview link' });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 413 ? `File is larger than ${MAX_UPLOAD_MB} MB` : err.message });
});

// ---------- production static hosting ----------
const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: 'index.html' }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// ---------- realtime: presence + patch fan-out ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const clients = new Map(); // ws -> { clientId, name, boardId }

server.on('upgrade', async (req, socket, head) => {
  const user = req.url?.startsWith('/ws') ? await identify(req) : null;
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, user));
});

wss.on('connection', (ws, user) => {
  // With Cloudflare sign-in the name comes from the verified account, not from the browser.
  clients.set(ws, { clientId: '', name: user?.name || '', email: user?.email || '', user, boardId: null });
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const info = clients.get(ws);
    if (msg.t === 'hello') {
      info.clientId = String(msg.clientId || '').slice(0, 64);
      if (!info.email) info.name = String(msg.name || 'Someone').slice(0, 60);
    } else if (msg.t === 'join') {
      const prev = info.boardId;
      const wanted = typeof msg.boardId === 'string' ? msg.boardId : null;
      // Only join boards this person may see; otherwise they'd receive its live updates.
      info.boardId = wanted && perms.can(info.user, store.get(wanted), 'view') ? wanted : null;
      if (prev) sendPresence(prev);
      if (info.boardId) sendPresence(info.boardId);
    } else if (msg.t === 'cursor' && info.boardId) {
      broadcast(info.boardId, { t: 'cursor', clientId: info.clientId, name: info.name, x: msg.x, y: msg.y }, info.clientId);
    }
  });
  ws.on('close', () => {
    const info = clients.get(ws);
    clients.delete(ws);
    if (info?.boardId) sendPresence(info.boardId);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000).unref();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(boardId, msg, exceptClientId = '') {
  for (const [ws, info] of clients) {
    if (info.boardId === boardId && (!exceptClientId || info.clientId !== exceptClientId)) send(ws, msg);
  }
}

function sendPresence(boardId) {
  const seen = new Map();
  for (const info of clients.values()) {
    if (info.boardId === boardId && info.clientId) seen.set(info.clientId, { clientId: info.clientId, name: info.name });
  }
  broadcast(boardId, { t: 'presence', boardId, users: [...seen.values()] });
}

// Everyone gets their own filtered view of boards and projects.
function broadcastIndex() {
  for (const [ws, info] of clients) {
    send(ws, { t: 'index', boards: perms.visibleBoards(info.user), projects: perms.visibleProjects(info.user) });
  }
}

/** After invites, removals or role changes: refresh everyone's lists and drop access that's gone. */
function accessChanged() {
  for (const [ws, info] of clients) {
    if (info.boardId && !perms.can(info.user, store.get(info.boardId), 'view')) {
      send(ws, { t: 'deleted', boardId: info.boardId });
      const was = info.boardId;
      info.boardId = null;
      sendPresence(was);
    }
    // Refresh the verified role so changes apply without signing out.
    if (info.user?.email && !info.user.visitor) info.user.role = users.roleOf(info.user.email);
  }
  broadcastIndex();
}

// ---------- inactivity ----------
function sweepInactive() {
  const removed = users.sweepInactive(store);
  if (removed.length) {
    console.log(`Removed ${removed.length} inactive guest invite(s):`, removed.map((r) => `${r.email} → ${r.project}`).join(', '));
    accessChanged();
  }
}
setTimeout(sweepInactive, 30 * 1000).unref();
setInterval(sweepInactive, 6 * 3600 * 1000).unref();

let indexTimer = null;
function scheduleIndexBroadcast() {
  if (indexTimer) return;
  indexTimer = setTimeout(() => { indexTimer = null; broadcastIndex(); }, 1000);
}

function shutdown() {
  store.flushAll();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  const auth = access ? `, Cloudflare Access (${access.team})` : PASSWORD ? ', password protected' : ', NO LOGIN';
  console.log(`Reference Board API on http://localhost:${PORT}  (data: ${DATA_DIR}${auth})`);
});
