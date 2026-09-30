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
import { Users } from './users.js';

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
const AUTH_MODE = access ? 'cloudflare' : PASSWORD ? 'password' : 'open';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });
const store = new Store(DATA_DIR);
const users = new Users(DATA_DIR);

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

/** Who is making this request: { email, name } (Cloudflare), { anon: true } (password/open), or null. */
async function identify(req) {
  if (access) {
    try {
      const id = await access.verify(AccessVerifier.tokenFrom(req));
      if (!id) return null;
      const u = users.touch(id.email);
      return { email: u.email, name: u.name };
    } catch (err) {
      console.error('Access verification error:', err.message);
      return null;
    }
  }
  if (PASSWORD && !passwordOk(req)) return null;
  return { anon: true };
}

// Unauthenticated health check for the host (Railway) to know the app is up.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, storage: files.mode, boards: store.boards.size });
});

app.get('/api/session', async (req, res) => {
  const user = await identify(req);
  res.json({
    mode: AUTH_MODE,
    authRequired: AUTH_MODE !== 'open',
    authed: Boolean(user),
    user: user?.email ? user : null,
    publicUrl: PUBLIC_URL,
  });
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

app.use(['/api', '/uploads'], async (req, res, next) => {
  const user = await identify(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
});

// ---------- people ----------
app.patch('/api/me', (req, res) => {
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

app.get('/api/users', (_req, res) => {
  res.json(users.list().map(({ email, name, lastSeen }) => ({ email, name, lastSeen })));
});

// ---------- boards ----------
app.get('/api/boards', (_req, res) => {
  res.json(store.list());
});

app.post('/api/boards', (req, res) => {
  const board = store.create({ title: req.body?.title, parentId: req.body?.parentId || null, projectId: req.body?.projectId || null });
  broadcastIndex();
  res.status(201).json(board);
});

// ---------- projects ----------
app.get('/api/projects', (_req, res) => {
  res.json(store.listProjects());
});

app.post('/api/projects', (req, res) => {
  const project = store.createProject(req.body || {});
  broadcastIndex();
  res.status(201).json(project);
});

app.patch('/api/projects/:id', (req, res) => {
  const project = store.updateProject(req.params.id, req.body || {});
  if (!project) return res.status(404).json({ error: 'Project not found' });
  broadcastIndex();
  res.json(project);
});

app.delete('/api/projects/:id', (req, res) => {
  if (!store.deleteProject(req.params.id)) return res.status(404).json({ error: 'Project not found' });
  broadcastIndex();
  res.json({ ok: true });
});

app.get('/api/boards/:id', (req, res) => {
  const board = store.get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  res.json(board);
});

app.post('/api/boards/:id/patch', (req, res) => {
  const result = store.applyPatch(req.params.id, req.body || {});
  if (!result) return res.status(404).json({ error: 'Board not found' });
  const origin = String(req.headers['x-client-id'] || '');
  broadcast(req.params.id, { t: 'patch', boardId: req.params.id, patch: result.patch, version: result.board.version }, origin);
  scheduleIndexBroadcast();
  res.json({ version: result.board.version });
});

app.delete('/api/boards/:id', (req, res) => {
  const board = store.get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  // Remove any board cards that point at this board from its parent.
  const parent = board.parentId ? store.get(board.parentId) : null;
  const deleted = store.delete(req.params.id);
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

// ---------- uploads ----------
// Files are sent in chunks (≤ 16 MB each) so large videos get past proxy request limits
// (Cloudflare rejects single requests over 100 MB) and a flaky connection only retries one chunk.
const MAX_UPLOAD = MAX_UPLOAD_MB * 1024 * 1024;
const sessions = new Map(); // id -> { path, size, received, name, mime, boardId, at }

app.post('/api/uploads', (req, res) => {
  const size = Number(req.body?.size);
  const name = String(req.body?.name || 'file').slice(0, 200);
  if (!Number.isFinite(size) || size < 0) return res.status(400).json({ error: 'Missing file size' });
  if (size > MAX_UPLOAD) return res.status(413).json({ error: `File is larger than ${MAX_UPLOAD_MB} MB` });
  const id = crypto.randomUUID();
  const file = path.join(TMP_DIR, id);
  fs.writeFileSync(file, '');
  sessions.set(id, { path: file, size, received: 0, name, mime: String(req.body?.mime || 'application/octet-stream').slice(0, 100), boardId: req.body?.boardId || null, at: Date.now() });
  res.status(201).json({ id, chunkSize: 16 * 1024 * 1024 });
});

app.put('/api/uploads/:id', express.raw({ type: () => true, limit: '17mb' }), (req, res) => {
  const s = sessions.get(req.params.id);
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
  const s = sessions.get(req.params.id);
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
    res.json(meta);
  } catch (err) {
    fs.rm(s.path, { force: true }, () => {});
    console.error('Upload failed:', err.message);
    res.status(502).json({ error: files.mode === 'drive' ? 'Could not save to Google Drive — try again' : 'Could not save the file' });
  }
});

app.delete('/api/uploads/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (s) { sessions.delete(req.params.id); fs.rm(s.path, { force: true }, () => {}); }
  res.json({ ok: true });
});

// Abandoned uploads are cleaned up after a day.
setInterval(() => {
  for (const [id, s] of sessions) {
    if (Date.now() - s.at > 24 * 3600 * 1000) { sessions.delete(id); fs.rm(s.path, { force: true }, () => {}); }
  }
}, 3600 * 1000).unref();

app.get('/api/storage', (_req, res) => {
  res.json({ mode: files.mode, files: Object.keys(files.index.files).length });
});

// Local files first (also everything uploaded before Drive was switched on), then Drive.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', setHeaders: (res, filePath) => safeHeaders(res, filePath) }));
app.get('/uploads/:name', (req, res) => files.serve(req, res));

// ---------- backups ----------
async function runBackup() {
  try {
    store.flushAll();
    const name = await files.backup({ at: new Date().toISOString(), projects: store.listProjects(), boards: [...store.boards.values()] });
    if (name) console.log(`Backup saved: ${name} (${files.mode})`);
  } catch (err) {
    console.error('Backup failed:', err.message);
  }
}
setTimeout(runBackup, 60 * 1000).unref();
setInterval(runBackup, 6 * 3600 * 1000).unref(); // at most one file per day; re-checks every 6h

// ---------- link previews ----------
app.get('/api/unfurl', async (req, res) => {
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
  clients.set(ws, { clientId: '', name: user?.name || '', email: user?.email || '', boardId: null });
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
      info.boardId = typeof msg.boardId === 'string' ? msg.boardId : null;
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

function broadcastIndex() {
  const msg = { t: 'index', boards: store.list(), projects: store.listProjects() };
  for (const ws of clients.keys()) send(ws, msg);
}

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
