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
    // Recycle bin: deleted boards and projects live here (not in the maps above) for 30 days,
    // so every normal lookup ignores them without extra checks.
    this.trash = new Map();
    this.trashedProjects = new Map();
    try {
      for (const p of JSON.parse(fs.readFileSync(this.projectsFile, 'utf8'))) (p.deletedAt ? this.trashedProjects : this.projects).set(p.id, p);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Could not read projects:', err.message);
    }
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const b = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        if (b && b.id) {
          if (b.deletedAt) { this.trash.set(b.id, b); continue; }
          this.boards.set(b.id, b);
          if (migrateComments(b).items.length) this.persist(b.id);
        }
      } catch (err) {
        console.error(`Could not read board ${f}:`, err.message);
      }
    }
  }

  summary(b) {
    const items = Object.values(b.items);
    // A chosen cover wins; otherwise the first image (or link preview) on the board.
    const cover = b.cover || items.find((i) => i.type === 'image' && i.url)?.url
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
      openComments: Object.values(b.threads || {}).filter((t) => !t.resolved).length,
    };
  }

  list() {
    return [...this.boards.values()].map((b) => this.summary(b));
  }

  get(id) {
    return this.boards.get(id) || null;
  }

  /** `by`: the creator's email. A board outside any project starts out shared with them alone. */
  create({ title, parentId = null, projectId = null, items = {}, connections = {}, by = null }) {
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
      threads: {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (by) board.createdBy = by;
    if (by && !board.parentId && !board.projectId) board.members = { [by]: { role: 'editor', invitedBy: by, invitedAt: now } };
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
    if (patch.cover === null || (typeof patch.cover === 'string' && /^(\/uploads\/|https:\/\/)/.test(patch.cover))) {
      board.cover = patch.cover ? patch.cover.slice(0, 500) : null;
      clean.cover = board.cover;
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
    // Old-style comment cards (seed data, or a browser still running the old app) become pinned threads.
    const migrated = migrateComments(board);
    if (migrated.items.length) {
      const gone = new Set(migrated.items);
      clean.upsertItems = (clean.upsertItems || []).filter((it) => !gone.has(it.id));
      clean.upsertThreads = migrated.threads;
      clean.removeItems = [...(clean.removeItems || []), ...migrated.items];
      clean.removeConnections = [...(clean.removeConnections || []), ...migrated.connections];
    }
    board.version += 1;
    board.updatedAt = Date.now();
    this.persist(id);
    return { board, patch: clean };
  }

  // ---------- assets (every file uploaded or imported to a board, kept after its card is deleted) ----------
  addAsset(boardId, asset) {
    const board = this.boards.get(boardId);
    if (!board) return;
    board.assets = [...(board.assets || []).filter((a) => a.url !== asset.url), asset].slice(-2000);
    this.persist(boardId);
  }

  // ---------- context: research and documents Claude reads with the board ----------
  // board.context: [{ id, title, kind: 'text' | 'file', text?, url?, name?, mime?, size, by, byEmail, at }]
  // Boards inside a board see its context too (see contextFor).
  addContext(boardId, doc) {
    const board = this.boards.get(boardId);
    if (!board) return null;
    board.context = [...(board.context || []), doc].slice(-100);
    board.contextVersion = (board.contextVersion || 0) + 1;
    this.persist(boardId);
    return doc;
  }

  removeContext(boardId, docId) {
    const board = this.boards.get(boardId);
    if (!board?.context?.some((d) => d.id === docId)) return false;
    board.context = board.context.filter((d) => d.id !== docId);
    board.contextVersion = (board.contextVersion || 0) + 1;
    this.persist(boardId);
    return true;
  }

  /** A board's context and its parents' (nearest first), each with the board it belongs to. */
  contextFor(boardId) {
    const out = [];
    const b = this.boards.get(boardId);
    for (const x of b ? [b, ...this.ancestors(b.id)] : []) {
      for (const d of x.context || []) out.push({ ...d, board: { id: x.id, title: x.title } });
    }
    return out;
  }

  // ---------- board notes (editors' scratchpad, shown beside the canvas) ----------
  saveNote(boardId, note) {
    const board = this.boards.get(boardId);
    if (!board) return null;
    board.notes ||= {};
    board.notes[note.id] = note;
    this.persist(boardId);
    return board;
  }

  removeNote(boardId, noteId) {
    const board = this.boards.get(boardId);
    if (!board?.notes?.[noteId]) return null;
    delete board.notes[noteId];
    this.persist(boardId);
    return board;
  }

  // ---------- comment threads (pinned on the canvas, saved separately from cards) ----------
  // board.threads: { [id]: { id, x, y, itemId?, dx?, dy?, createdAt, resolved: { by, at } | null, comments: [...] } }
  saveThread(boardId, thread) {
    const board = this.boards.get(boardId);
    if (!board) return null;
    board.threads ||= {};
    board.threads[thread.id] = thread;
    board.version += 1;
    this.persist(boardId);
    return board;
  }

  removeThread(boardId, threadId) {
    const board = this.boards.get(boardId);
    if (!board?.threads?.[threadId]) return null;
    delete board.threads[threadId];
    board.version += 1;
    this.persist(boardId);
    return board;
  }

  /**
   * Copy a board and every board nested in it. The copy goes under `parentId` (or the top level
   * of the same project). Comments, notes, invites and share links are not copied.
   */
  duplicate(id, parentId = null, by = null) {
    const src = this.boards.get(id);
    if (!src) return null;
    const ids = this.subtree(id);
    const map = new Map(ids.map((old) => [old, crypto.randomUUID()]));
    const now = Date.now();
    const parent = parentId ? this.boards.get(parentId) : null;
    for (const old of ids) {
      const b = this.boards.get(old);
      const copy = {
        id: map.get(old),
        title: old === id ? `${b.title} (copy)`.slice(0, 200) : b.title,
        parentId: old === id ? (parent ? parent.id : null) : map.get(b.parentId) || null,
        projectId: old === id ? (parent ? parent.projectId || null : b.projectId || null) : null,
        background: b.background || null,
        cover: b.cover || null,
        items: structuredClone(b.items),
        connections: structuredClone(b.connections),
        threads: {},
        assets: structuredClone(b.assets || []),
        context: structuredClone(b.context || []),
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      // Board cards inside the copy point at the copied boards.
      for (const it of Object.values(copy.items)) if (it.type === 'board' && map.has(it.boardId)) it.boardId = map.get(it.boardId);
      this.boards.set(copy.id, copy);
    }
    const root = this.boards.get(map.get(id));
    // A copy outside any project would otherwise be admin-only: share it with whoever made it.
    if (by && !root.parentId && !root.projectId) root.members = { [by]: { role: 'editor', invitedBy: by, invitedAt: now } };
    for (const nid of map.values()) {
      const b = this.boards.get(nid);
      if (nid !== root.id) b.projectId = root.projectId;
      this.persist(nid);
    }
    return root;
  }

  // ---------- recycle bin ----------
  /** Move boards to the trash. `root` is what restores them together (a board id, or "project:<id>"). */
  trashBoards(ids, root, by) {
    const now = Date.now();
    for (const id of ids) {
      const b = this.boards.get(id);
      if (!b) continue;
      Object.assign(b, { deletedAt: now, deletedBy: by, trashRoot: root });
      this.boards.delete(id);
      this.trash.set(id, b);
      this.persist(id);
    }
  }

  /** A board and every board nested in it. */
  subtree(id) {
    const ids = [id];
    for (let i = 0; i < ids.length; i++) {
      for (const b of this.boards.values()) if (b.parentId === ids[i]) ids.push(b.id);
    }
    return ids;
  }

  /** Delete a board (and its nested boards) into the trash. Returns the ids. */
  trashBoard(id, by) {
    if (!this.boards.has(id)) return [];
    const ids = this.subtree(id);
    this.trashBoards(ids, id, by);
    return ids;
  }

  /** Delete a project into the trash, together with all of its boards. */
  trashProject(id, by) {
    const p = this.projects.get(id);
    if (!p) return null;
    const ids = [...this.boards.values()].filter((b) => b.projectId === id).map((b) => b.id);
    this.trashBoards(ids, `project:${id}`, by);
    Object.assign(p, { deletedAt: Date.now(), deletedBy: by });
    this.projects.delete(id);
    this.trashedProjects.set(id, p);
    this.saveProjects();
    return ids;
  }

  /** Bring boards back from the trash. Returns the restored boards. */
  restoreRoot(root) {
    const back = [...this.trash.values()].filter((b) => b.trashRoot === root);
    for (const b of back) {
      delete b.deletedAt; delete b.deletedBy; delete b.trashRoot;
      this.trash.delete(b.id);
      this.boards.set(b.id, b);
    }
    for (const b of back) {
      // Its parent or project may be gone for good (or still in the trash): then it goes to the top level.
      if (b.parentId && !this.boards.has(b.parentId)) b.parentId = null;
      if (b.projectId && !this.projects.has(b.projectId)) b.projectId = null;
      this.persist(b.id);
    }
    return back;
  }

  restoreProject(id) {
    const p = this.trashedProjects.get(id);
    if (!p) return null;
    delete p.deletedAt; delete p.deletedBy;
    this.trashedProjects.delete(id);
    this.projects.set(id, p);
    this.saveProjects();
    return this.restoreRoot(`project:${id}`);
  }

  /** Delete forever: boards in the trash under this root. */
  purgeRoot(root) {
    for (const b of [...this.trash.values()]) {
      if (b.trashRoot !== root) continue;
      this.trash.delete(b.id);
      clearTimeout(this.timers.get(b.id));
      this.timers.delete(b.id);
      fs.rm(this.file(b.id), { force: true }, () => {});
    }
  }

  purgeProject(id) {
    if (!this.trashedProjects.delete(id)) return false;
    this.purgeRoot(`project:${id}`);
    this.saveProjects();
    return true;
  }

  /** Empty anything that has been in the trash longer than `days`. */
  purgeOld(days = 30, now = Date.now()) {
    const cutoff = now - days * 24 * 3600 * 1000;
    let n = 0;
    for (const p of [...this.trashedProjects.values()]) if (p.deletedAt < cutoff) { this.purgeProject(p.id); n++; }
    const roots = new Set([...this.trash.values()].filter((b) => b.deletedAt < cutoff).map((b) => b.trashRoot));
    for (const r of roots) { this.purgeRoot(r); n++; }
    return n;
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

  /** `by`: the creator's email; they become the project's first editor. */
  createProject({ name, color }, by = null) {
    const now = Date.now();
    const project = {
      id: crypto.randomUUID(),
      name: String(name || 'Untitled project').slice(0, 120),
      color: typeof color === 'string' ? color.slice(0, 20) : 'purple',
      createdAt: now,
    };
    if (by) {
      project.createdBy = by;
      project.members = { [by]: { role: 'editor', invitedBy: by, invitedAt: now } };
    }
    this.projects.set(project.id, project);
    this.saveProjects();
    return project;
  }

  updateProject(id, { name, color, cover }) {
    const p = this.projects.get(id);
    if (!p) return null;
    if (typeof name === 'string') p.name = name.slice(0, 120) || 'Untitled project';
    if (typeof color === 'string') p.color = color.slice(0, 20);
    if (cover === null || (typeof cover === 'string' && /^(\/uploads\/|https:\/\/)/.test(cover))) p.cover = cover ? cover.slice(0, 500) : null;
    this.saveProjects();
    return p;
  }

  // ---------- project members (anyone but admins, who see every project) ----------
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
    fs.writeFileSync(tmp, JSON.stringify([...this.listProjects(), ...this.trashedProjects.values()], null, 2));
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
    const board = this.boards.get(id) || this.trash.get(id);
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

/**
 * Turns comment cards into pinned comment threads. A card connected to another card by a line is
 * pinned to that card (and the line removed); otherwise the pin goes where the card was.
 * Returns what changed: { threads, items (removed ids), connections (removed ids) }.
 */
export function migrateComments(board) {
  const out = { threads: [], items: [], connections: [] };
  board.threads ||= {};
  for (const it of Object.values(board.items || {})) {
    if (it.type !== 'comment') continue;
    const lines = Object.values(board.connections || {}).filter((c) => c.from === it.id || c.to === it.id);
    const target = lines.map((c) => board.items[c.from === it.id ? c.to : c.from]).find((t) => t && t.type !== 'comment');
    const thread = {
      id: it.id,
      x: Math.round(it.x),
      y: Math.round(it.y),
      createdAt: it.createdAt || it.comments?.[0]?.at || Date.now(),
      resolved: null,
      comments: (it.comments || []).filter((c) => c && typeof c.text === 'string'),
    };
    if (target && !target.parentId) {
      thread.itemId = target.id;
      thread.dx = Math.max(16, (target.w || 260) - 16);
      thread.dy = Math.min(320, Math.max(16, Math.round(it.y - target.y) + 24));
      thread.x = Math.round(target.x + thread.dx);
      thread.y = Math.round(target.y + thread.dy);
    }
    delete board.items[it.id];
    out.items.push(it.id);
    for (const c of lines) { delete board.connections[c.id]; out.connections.push(c.id); }
    for (const other of Object.values(board.items)) {
      if (other.childIds?.includes(it.id)) other.childIds = other.childIds.filter((x) => x !== it.id);
    }
    if (thread.comments.length) {
      board.threads[thread.id] = thread;
      out.threads.push(thread);
    }
  }
  return out;
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
