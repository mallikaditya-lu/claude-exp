import express from 'express';
import multer from 'multer';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3001;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PASSWORD = process.env.APP_PASSWORD || '';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 500;
const AUTH_COOKIE = 'rb_auth';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const store = new Store(DATA_DIR);
if (store.boards.size === 0) {
  seedWelcomeBoard(store);
  seedDemoProject(store, UPLOAD_DIR);
}

const app = express();
app.disable('x-powered-by');
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

function isAuthed(req) {
  if (!PASSWORD) return true;
  const token = readCookie(req, AUTH_COOKIE);
  return token.length === authToken.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(authToken));
}

app.get('/api/session', (req, res) => {
  res.json({ authRequired: Boolean(PASSWORD), authed: isAuthed(req) });
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

app.use(['/api', '/uploads'], (req, res, next) => {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Not signed in' });
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
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      // multer decodes names as latin1; re-decode so non-ASCII file names survive.
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
      file.originalname = original;
      const ext = path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
      const base = path.basename(original, path.extname(original)).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
      cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${base}${ext}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
  });
});

const ACTIVE_EXT = new Set(['.html', '.htm', '.xhtml', '.svg', '.xml', '.js', '.mjs']);
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Uploaded files share our origin, so anything a browser could execute is served as a download.
    if (ACTIVE_EXT.has(path.extname(filePath).toLowerCase())) {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    }
  },
}));

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

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws') || !isAuthed(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
  clients.set(ws, { clientId: '', name: '', boardId: null });
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const info = clients.get(ws);
    if (msg.t === 'hello') {
      info.clientId = String(msg.clientId || '').slice(0, 64);
      info.name = String(msg.name || 'Someone').slice(0, 60);
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
  console.log(`Reference Board API on http://localhost:${PORT}  (data: ${DATA_DIR}${PASSWORD ? ', password protected' : ''})`);
});
