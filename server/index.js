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

app.delete('/api/projects/:id', needTeam, (req, res) => {
  if (!store.deleteProject(req.params.id)) return res.status(404).json({ error: 'Project not found' });
  broadcastIndex();
  res.json({ ok: true });
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
  const { members: _m, share: _s, assets: _a, ...rest } = board;
  res.json({ ...rest, access: perms.boardLevel(req.user, board) });
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
  const result = store.applyPatch(req.params.id, patch);
  const origin = String(req.headers['x-client-id'] || '');
  broadcast(req.params.id, { t: 'patch', boardId: req.params.id, patch: result.patch, version: result.board.version }, origin);
  scheduleIndexBroadcast();
  res.json({ version: result.board.version });
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

app.delete('/api/boards/:id', needTeam, (req, res) => {
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
