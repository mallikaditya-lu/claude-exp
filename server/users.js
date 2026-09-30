import fs from 'node:fs';
import path from 'node:path';

// People who have signed in (via Cloudflare Access). Keyed by email; each person can set the
// display name shown on comments, cursors and presence.

export class Users {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'users.json');
    try {
      this.users = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.users = {};
    }
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.users, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** Fetch or create the profile for a signed-in email. */
  touch(email) {
    let u = this.users[email];
    const now = Date.now();
    if (!u) {
      const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
      const name = local.replace(/\b\w/g, (c) => c.toUpperCase()) || email;
      u = this.users[email] = { email, name, createdAt: now, lastSeen: now };
      this.save();
    } else if (now - u.lastSeen > 10 * 60 * 1000) {
      u.lastSeen = now;
      this.save();
    }
    return u;
  }

  rename(email, name) {
    const u = this.touch(email);
    u.name = String(name).trim().slice(0, 60) || u.name;
    this.save();
    return u;
  }

  list() {
    return Object.values(this.users).sort((a, b) => b.lastSeen - a.lastSeen);
  }
}
