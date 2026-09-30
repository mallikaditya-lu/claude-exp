import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Boards are kept in memory and persisted as one JSON file each.
// Writes are debounced per board and done atomically (tmp file + rename).
export class Store {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'boards');
    fs.mkdirSync(this.dir, { recursive: true });
    this.boards = new Map();
    this.timers = new Map();
    this.projectsFile = path.join(dataDir, 'projects.json');
    this.projects = new Map();
    try {
      for (const p of JSON.parse(fs.readFileSync(this.projectsFile, 'utf8'))) this.projects.set(p.id, p);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Could not read projects:', err.message);
    }
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const b = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        if (b && b.id) this.boards.set(b.id, b);
      } catch (err) {
        console.error(`Could not read board ${f}:`, err.message);
      }
    }
  }

  summary(b) {
    const items = Object.values(b.items);
    const cover = items.find((i) => i.type === 'image' && i.url)?.url
      || items.find((i) => i.type === 'link' && i.thumb)?.thumb
      || null;
    return {
      id: b.id,
      title: b.title,
      parentId: b.parentId,
      projectId: b.projectId || null,
      background: b.background || null,
      updatedAt: b.updatedAt,
      createdAt: b.createdAt,
      itemCount: items.length,
      cover,
    };
  }

  list() {
    return [...this.boards.values()].map((b) => this.summary(b));
  }

  get(id) {
    return this.boards.get(id) || null;
  }

  create({ title, parentId = null, projectId = null, items = {}, connections = {} }) {
    const now = Date.now();
    const parent = parentId ? this.boards.get(parentId) : null;
    const board = {
      id: crypto.randomUUID(),
      title: String(title || 'Untitled board').slice(0, 200),
      parentId: parent ? parentId : null,
      // Nested boards live in their parent's project.
      projectId: parent ? parent.projectId || null : this.projects.has(projectId) ? projectId : null,
      background: parent?.background || null,
      items,
      connections,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.boards.set(board.id, board);
    this.persist(board.id);
    return board;
  }

  // Patches are item-level so two people editing different cards never clobber each other.
  applyPatch(id, patch) {
    const board = this.boards.get(id);
    if (!board) return null;
    const clean = {};
    if (typeof patch.title === 'string') {
      board.title = patch.title.slice(0, 200);
      clean.title = board.title;
    }
    if (patch.background === null || typeof patch.background === 'string') {
      board.background = patch.background ? patch.background.slice(0, 40) : null;
      clean.background = board.background;
    }
    if (patch.projectId === null || typeof patch.projectId === 'string') {
      const pid = patch.projectId && this.projects.has(patch.projectId) ? patch.projectId : null;
      this.setProject(id, pid);
      clean.projectId = pid;
    }
    if (Array.isArray(patch.upsertItems)) {
      clean.upsertItems = [];
      for (const item of patch.upsertItems) {
        if (!isRecord(item) || typeof item.id !== 'string' || typeof item.type !== 'string') continue;
        board.items[item.id] = item;
        clean.upsertItems.push(item);
      }
    }
    if (Array.isArray(patch.removeItems)) {
      clean.removeItems = patch.removeItems.filter((x) => typeof x === 'string');
      for (const itemId of clean.removeItems) delete board.items[itemId];
    }
    if (Array.isArray(patch.upsertConnections)) {
      clean.upsertConnections = [];
      for (const c of patch.upsertConnections) {
        if (!isRecord(c) || typeof c.id !== 'string' || typeof c.from !== 'string' || typeof c.to !== 'string') continue;
        board.connections[c.id] = c;
        clean.upsertConnections.push(c);
      }
    }
    if (Array.isArray(patch.removeConnections)) {
      clean.removeConnections = patch.removeConnections.filter((x) => typeof x === 'string');
      for (const cid of clean.removeConnections) delete board.connections[cid];
    }
    board.version += 1;
    board.updatedAt = Date.now();
    this.persist(id);
    return { board, patch: clean };
  }

  // Deletes a board and every board nested beneath it. Returns the deleted ids.
  delete(id) {
    const board = this.boards.get(id);
    if (!board) return [];
    const doomed = [id];
    for (let i = 0; i < doomed.length; i++) {
      for (const b of this.boards.values()) {
        if (b.parentId === doomed[i]) doomed.push(b.id);
      }
    }
    for (const bid of doomed) {
      this.boards.delete(bid);
      clearTimeout(this.timers.get(bid));
      this.timers.delete(bid);
      fs.rm(this.file(bid), { force: true }, () => {});
    }
    return doomed;
  }

  // Moves a top-level board (and every board nested in it) into a project.
  setProject(id, projectId) {
    const ids = [id];
    for (let i = 0; i < ids.length; i++) {
      const b = this.boards.get(ids[i]);
      if (!b) continue;
      if (b.projectId !== projectId) {
        b.projectId = projectId;
        if (i > 0) this.persist(b.id);
      }
      for (const c of this.boards.values()) if (c.parentId === ids[i]) ids.push(c.id);
    }
  }

  // ---------- projects (folders of boards) ----------
  listProjects() {
    return [...this.projects.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  createProject({ name, color }) {
    const project = {
      id: crypto.randomUUID(),
      name: String(name || 'Untitled project').slice(0, 120),
      color: typeof color === 'string' ? color.slice(0, 20) : 'purple',
      createdAt: Date.now(),
    };
    this.projects.set(project.id, project);
    this.saveProjects();
    return project;
  }

  updateProject(id, { name, color }) {
    const p = this.projects.get(id);
    if (!p) return null;
    if (typeof name === 'string') p.name = name.slice(0, 120) || 'Untitled project';
    if (typeof color === 'string') p.color = color.slice(0, 20);
    this.saveProjects();
    return p;
  }

  // ---------- project members (people outside the core team) ----------
  // project.members: { [email]: { role: 'editor' | 'commenter' | 'viewer', invitedBy, invitedAt } }
  setMember(projectId, email, role, invitedBy) {
    const p = this.projects.get(projectId);
    if (!p) return null;
    p.members ||= {};
    const prev = p.members[email];
    p.members[email] = { role, invitedBy: prev?.invitedBy || invitedBy, invitedAt: prev?.invitedAt || Date.now() };
    this.saveProjects();
    return p;
  }

  removeMember(projectId, email) {
    const p = this.projects.get(projectId);
    if (!p?.members?.[email]) return false;
    delete p.members[email];
    this.saveProjects();
    return true;
  }

  /** Removes someone from every project and board. Returns the names of what they were in. */
  removeMemberEverywhere(email) {
    const removed = [];
    for (const p of this.projects.values()) {
      if (p.members?.[email]) {
        delete p.members[email];
        removed.push(p.name);
      }
    }
    if (removed.length) this.saveProjects();
    for (const b of this.boards.values()) {
      if (b.members?.[email]) {
        delete b.members[email];
        removed.push(b.title);
        this.persist(b.id);
      }
    }
    return removed;
  }

  // ---------- board members (people invited to one board and the boards inside it) ----------
  // board.members: { [email]: { role, invitedBy, invitedAt } }, same shape as project members.
  setBoardMember(boardId, email, role, invitedBy) {
    const b = this.boards.get(boardId);
    if (!b) return null;
    b.members ||= {};
    const prev = b.members[email];
    b.members[email] = { role, invitedBy: prev?.invitedBy || invitedBy, invitedAt: prev?.invitedAt || Date.now() };
    this.persist(b.id);
    return b;
  }

  removeBoardMember(boardId, email) {
    const b = this.boards.get(boardId);
    if (!b?.members?.[email]) return false;
    delete b.members[email];
    this.persist(b.id);
    return true;
  }

  /** The board's parent, grandparent, … (nearest first). */
  ancestors(id) {
    const out = [];
    let cur = this.boards.get(id);
    while (cur?.parentId && out.length < 50) {
      cur = this.boards.get(cur.parentId);
      if (!cur) break;
      out.push(cur);
    }
    return out;
  }

  /** True when `id` is `rootId` or nested (at any depth) inside it. */
  isWithin(id, rootId) {
    if (id === rootId) return true;
    return this.ancestors(id).some((b) => b.id === rootId);
  }

  // ---------- share links ----------
  // board.share: { token, mode: 'off' | 'view' | 'comment', requireIdentity, createdAt, createdBy }
  setShare(boardId, { mode, requireIdentity }, by) {
    const b = this.boards.get(boardId);
    if (!b) return null;
    b.share ||= { token: newToken(), mode: 'off', requireIdentity: true, createdAt: Date.now(), createdBy: by };
    if (['off', 'view', 'comment'].includes(mode)) b.share.mode = mode;
    if (typeof requireIdentity === 'boolean') b.share.requireIdentity = requireIdentity;
    this.persist(b.id);
    return b.share;
  }

  /** A new link; the old one stops working. */
  resetShareToken(boardId) {
    const b = this.boards.get(boardId);
    if (!b?.share) return null;
    b.share.token = newToken();
    this.persist(b.id);
    return b.share;
  }

  /** The board a share token belongs to, if the link is switched on. */
  findShare(token) {
    if (typeof token !== 'string' || token.length < 20) return null;
    for (const b of this.boards.values()) {
      if (b.share?.token && b.share.mode !== 'off' && safeEqual(b.share.token, token)) return { board: b, share: b.share };
    }
    return null;
  }

  // Deleting a project keeps its boards; they become unfiled.
  deleteProject(id) {
    if (!this.projects.delete(id)) return false;
    for (const b of this.boards.values()) {
      if (b.projectId === id) {
        b.projectId = null;
        this.persist(b.id);
      }
    }
    this.saveProjects();
    return true;
  }

  saveProjects() {
    const tmp = `${this.projectsFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.listProjects(), null, 2));
    fs.renameSync(tmp, this.projectsFile);
  }

  file(id) {
    return path.join(this.dir, `${id}.json`);
  }

  persist(id) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.writeNow(id), 250));
  }

  writeNow(id) {
    this.timers.delete(id);
    const board = this.boards.get(id);
    if (!board) return;
    const tmp = `${this.file(id)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(board));
    fs.renameSync(tmp, this.file(id));
  }

  flushAll() {
    for (const id of [...this.timers.keys()]) {
      clearTimeout(this.timers.get(id));
      this.writeNow(id);
    }
  }
}

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function safeEqual(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isRecord(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}
