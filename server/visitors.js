import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// People who open a board through a share link, without signing in.
//
// They type a name and email (not verified: a share link is for light-touch client review, and
// the link itself is what grants access). The browser keeps a signed cookie so they're recognised
// when they come back; entering the same email on another device finds the same record, so their
// comments stay theirs.

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** SESSION_SECRET, or a random one generated once and kept in the data folder. */
function loadSecret(dataDir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, 'secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

export class Visitors {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'visitors.json');
    this.visitors = readJson(this.file, {});
    this.secret = loadSecret(dataDir);
    this.timer = null;
  }

  save(now = false) {
    clearTimeout(this.timer);
    const write = () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.visitors, null, 2));
      fs.renameSync(tmp, this.file);
    };
    if (now) write();
    else this.timer = setTimeout(write, 1000);
  }

  sign(id) {
    return `${id}.${crypto.createHmac('sha256', this.secret).update(`visitor:${id}`).digest('base64url')}`;
  }

  /** The visitor a signed cookie value belongs to, or null. */
  fromCookie(value) {
    const [id, mac] = String(value || '').split('.');
    if (!id || !mac) return null;
    const want = this.sign(id).split('.')[1];
    if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
    return this.visitors[id] || null;
  }

  byEmail(email) {
    return Object.values(this.visitors).find((v) => v.email === email) || null;
  }

  /** Find (by email) or create the visitor, updating their name. */
  identify(name, email) {
    const now = Date.now();
    let v = this.byEmail(email);
    if (!v) {
      const id = crypto.randomBytes(12).toString('base64url');
      v = this.visitors[id] = { id, name, email, createdAt: now, lastSeen: now, boards: {} };
    }
    v.name = name;
    v.lastSeen = now;
    this.save(true);
    return v;
  }

  /** Note that this visitor opened a shared board. */
  touch(v, boardId) {
    const now = Date.now();
    if (now - (v.boards[boardId] || 0) < 10 * 60 * 1000 && now - v.lastSeen < 10 * 60 * 1000) return;
    v.lastSeen = now;
    v.boards[boardId] = now;
    this.save();
  }

  remove(id) {
    if (!this.visitors[id]) return false;
    delete this.visitors[id];
    this.save(true);
    return true;
  }

  list() {
    return Object.values(this.visitors).sort((a, b) => b.lastSeen - a.lastSeen);
  }
}
