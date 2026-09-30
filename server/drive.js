import crypto from 'node:crypto';
import fs from 'node:fs';

// Minimal Google Drive v3 client for a service account, with no SDK dependency.
// Auth: signed JWT → OAuth access token (cached). Uploads use the resumable protocol in chunks,
// downloads pass HTTP Range through so video seeking works.

const API = process.env.GOOGLE_API_BASE || 'https://www.googleapis.com';
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const CHUNK = 32 * 1024 * 1024; // must be a multiple of 256 KiB

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Resumable-upload progress: the "Range: bytes=0-N" header says bytes 0..N are stored. */
const nextOffset = (res) => { const r = res.headers.get('range'); return r ? Number(r.split('-')[1]) + 1 : 0; };

/** Accepts the key file's JSON as-is, or base64-encoded (a single line, easier to paste into env settings). */
function parseCredentials(value) {
  const v = value.trim();
  try {
    return JSON.parse(v.startsWith('{') ? v : Buffer.from(v, 'base64').toString('utf8'));
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON');
  }
}

export class Drive {
  constructor(credentialsJson, driveId) {
    const creds = typeof credentialsJson === 'string' ? parseCredentials(credentialsJson) : credentialsJson;
    if (!creds.client_email || !creds.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email / private_key');
    this.email = creds.client_email;
    this.key = creds.private_key;
    this.driveId = driveId;
    this.token = null;
    this.tokenExpires = 0;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExpires - 60_000) return this.token;
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: this.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
    const sig = b64url(crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claims}`), this.key));
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }),
    });
    if (!res.ok) throw new Error(`Google auth failed (${res.status}): ${await res.text()}`);
    const json = await res.json();
    this.token = json.access_token;
    this.tokenExpires = Date.now() + (json.expires_in || 3600) * 1000;
    return this.token;
  }

  /** fetch with auth, retrying rate limits and server errors with backoff. */
  async request(url, init = {}, { retries = 4, raw = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
        ...init,
        headers: { authorization: `Bearer ${await this.accessToken()}`, ...(init.headers || {}) },
      });
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit/i.test(res.statusText));
      if (retryable && attempt < retries) {
        await res.body?.cancel();
        await sleep(500 * 2 ** attempt + Math.random() * 250);
        continue;
      }
      if (raw) return res;
      if (!res.ok) throw new Error(`Drive ${init.method || 'GET'} ${url} → ${res.status}: ${await res.text()}`);
      return res.status === 204 ? null : res.json();
    }
  }

  /** Checks the credentials and that the service account can see the Shared Drive. */
  async check() {
    const d = await this.request(`/drive/v3/drives/${this.driveId}?fields=id,name`);
    return d;
  }

  async findFolder(name, parent) {
    const q = `name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and '${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const params = new URLSearchParams({
      q, fields: 'files(id,name)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'drive', driveId: this.driveId,
    });
    const r = await this.request(`/drive/v3/files?${params}`);
    return r.files?.[0]?.id || null;
  }

  async createFolder(name, parent) {
    const r = await this.request('/drive/v3/files?supportsAllDrives=true&fields=id', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
    });
    return r.id;
  }

  async ensureFolder(name, parent = this.driveId) {
    return (await this.findFolder(name, parent)) || this.createFolder(name, parent);
  }

  /** Upload a local file (any size) with the resumable protocol. Returns the Drive file id. */
  async upload(localPath, { name, mime, parent }) {
    const size = fs.statSync(localPath).size;
    const init = await this.request('/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': mime || 'application/octet-stream',
        'x-upload-content-length': String(size),
      },
      body: JSON.stringify({ name, parents: [parent || this.driveId] }),
    }, { raw: true });
    if (!init.ok) throw new Error(`Drive upload init failed (${init.status}): ${await init.text()}`);
    const session = init.headers.get('location');
    await init.body?.cancel();

    if (size === 0) {
      const r = await this.request(session, { method: 'PUT', headers: { 'content-length': '0' } }, { raw: true });
      return (await r.json()).id;
    }

    const fd = fs.openSync(localPath, 'r');
    try {
      let offset = 0;
      let failures = 0;
      while (offset < size) {
        const len = Math.min(CHUNK, size - offset);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, offset);
        let res = null;
        try {
          res = await this.request(session, {
            method: 'PUT',
            headers: { 'content-length': String(len), 'content-range': `bytes ${offset}-${offset + len - 1}/${size}` },
            body: buf,
          }, { raw: true, retries: 3 });
        } catch {
          res = null; // network error: fall through to resume
        }
        if (res?.ok) return (await res.json()).id;
        if (res?.status === 308) {
          offset = nextOffset(res);
          await res.body?.cancel();
          failures = 0;
          continue;
        }
        if (res && res.status < 500 && res.status !== 429) throw new Error(`Drive upload failed (${res.status}): ${await res.text()}`);
        await res?.body?.cancel();
        if (++failures > 5) throw new Error('Drive upload failed after repeated errors');
        await sleep(1000 * 2 ** failures);
        // Ask the session how much it already has, then resume from there.
        const probe = await this.request(session, { method: 'PUT', headers: { 'content-range': `bytes */${size}` } }, { raw: true, retries: 3 });
        if (probe.ok) return (await probe.json()).id;
        offset = probe.status === 308 ? nextOffset(probe) : 0;
        await probe.body?.cancel();
      }
      throw new Error('Drive upload ended without a file id');
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Raw download response; pass `range` straight through for seeking. */
  download(fileId, { range, signal } = {}) {
    return this.request(`/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
      headers: range ? { range } : {},
      signal,
    }, { raw: true, retries: 2 });
  }

  async list(parent, { orderBy = 'createdTime desc', pageSize = 100 } = {}) {
    const params = new URLSearchParams({
      q: `'${parent}' in parents and trashed = false`, orderBy, pageSize: String(pageSize),
      fields: 'files(id,name,createdTime,size)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'drive', driveId: this.driveId,
    });
    return (await this.request(`/drive/v3/files?${params}`)).files || [];
  }

  /** Moves a file to the Shared Drive's trash (recoverable for 30 days). */
  trash(fileId) {
    return this.request(`/drive/v3/files/${fileId}?supportsAllDrives=true`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }
}
