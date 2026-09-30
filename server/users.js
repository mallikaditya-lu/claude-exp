import fs from 'node:fs';
import path from 'node:path';

// People who have signed in (via Cloudflare Access), their global role, and app-wide settings.
//
// Global roles:
//   admin  – everything, plus the admin dashboard (people, roles, inactivity settings)
//   team   – core team: sees and edits every project, can invite people to projects
//   guest  – freelancers and clients: only sees projects they've been invited to, with the
//            role given there (editor / commenter / viewer)
//
// ADMIN_EMAILS are always admins (so nobody can lock the owner out). Emails in TEAM_DOMAINS start
// as team; everyone else starts as guest. Admins can change anyone else's role.

const list = (v, fallback) => (v ?? fallback).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const ADMIN_EMAILS = list(process.env.ADMIN_EMAILS, 'admin@littleunusual.com');
export const TEAM_DOMAINS = list(process.env.TEAM_DOMAINS, 'littleunusual.co,littleunusual.com').map((d) => d.replace(/^@/, ''));
export const ROLES = ['admin', 'team', 'guest'];

function defaultRole(email) {
  if (ADMIN_EMAILS.includes(email)) return 'admin';
  if (TEAM_DOMAINS.includes(email.split('@')[1] || '')) return 'team';
  return 'guest';
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export class Users {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'users.json');
    this.settingsFile = path.join(dataDir, 'settings.json');
    this.users = readJson(this.file, {});
    // inactiveDays: guests not seen for this long lose their project access (0 = never).
    this.settings = { inactiveDays: 60, ...readJson(this.settingsFile, {}) };
  }

  save() {
    writeJson(this.file, this.users);
  }

  get(email) {
    return this.users[email] || null;
  }

  roleOf(email) {
    if (ADMIN_EMAILS.includes(email)) return 'admin';
    return this.users[email]?.role || defaultRole(email);
  }

  /** Fetch or create the profile for a signed-in email, updating last-seen. */
  touch(email) {
    let u = this.users[email];
    const now = Date.now();
    if (!u) {
      const local = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim();
      const name = local.replace(/\b\w/g, (c) => c.toUpperCase()) || email;
      u = this.users[email] = { email, name, role: defaultRole(email), createdAt: now, lastSeen: now };
      this.save();
    } else if (now - u.lastSeen > 10 * 60 * 1000) {
      u.lastSeen = now;
      this.save();
    }
    if (!u.role) u.role = defaultRole(email);
    if (ADMIN_EMAILS.includes(email)) u.role = 'admin';
    return u;
  }

  rename(email, name) {
    const u = this.touch(email);
    u.name = String(name).trim().slice(0, 60) || u.name;
    this.save();
    return u;
  }

  /** Set someone's global role. Creates a placeholder profile for people who haven't signed in yet. */
  setRole(email, role) {
    if (!ROLES.includes(role)) throw new Error('Unknown role');
    if (ADMIN_EMAILS.includes(email) && role !== 'admin') throw new Error('This account is always an admin (ADMIN_EMAILS)');
    const u = this.users[email] || (this.users[email] = { email, name: email.split('@')[0], createdAt: Date.now(), lastSeen: 0 });
    u.role = role;
    this.save();
    return u;
  }

  remove(email) {
    if (ADMIN_EMAILS.includes(email)) throw new Error('This account is always an admin (ADMIN_EMAILS)');
    delete this.users[email];
    this.save();
  }

  list() {
    return Object.values(this.users).map((u) => ({ ...u, role: this.roleOf(u.email) }));
  }

  updateSettings(patch) {
    if (patch.inactiveDays !== undefined) {
      const d = Number(patch.inactiveDays);
      if (!Number.isFinite(d) || d < 0 || d > 3650) throw new Error('inactiveDays must be 0–3650');
      this.settings.inactiveDays = Math.round(d);
    }
    writeJson(this.settingsFile, this.settings);
    return this.settings;
  }

  /**
   * Remove guests' project and board access after a period of inactivity, including invites that were
   * never used. Team and admins are never removed. Returns what was removed.
   */
  sweepInactive(store, now = Date.now()) {
    const days = this.settings.inactiveDays;
    if (!days) return [];
    const cutoff = now - days * 24 * 3600 * 1000;
    const removed = [];
    for (const p of store.projects.values()) {
      for (const [email, m] of Object.entries(p.members || {})) {
        if (this.roleOf(email) !== 'guest') continue;
        const u = this.users[email];
        const lastActive = Math.max(u?.lastSeen || 0, m.invitedAt || 0);
        if (lastActive < cutoff) {
          store.removeMember(p.id, email);
          removed.push({ email, project: p.name });
          if (u) {
            u.removedForInactivity = { at: now, projects: [...(u.removedForInactivity?.projects || []), p.name] };
          }
        }
      }
    }
    // Board invites work the same way.
    for (const b of store.boards.values()) {
      for (const [email, m] of Object.entries(b.members || {})) {
        if (this.roleOf(email) !== 'guest') continue;
        const u = this.users[email];
        if (Math.max(u?.lastSeen || 0, m.invitedAt || 0) < cutoff) {
          store.removeBoardMember(b.id, email);
          removed.push({ email, project: b.title });
          if (u) u.removedForInactivity = { at: now, projects: [...(u.removedForInactivity?.projects || []), b.title] };
        }
      }
    }
    if (removed.length) this.save();
    return removed;
  }
}
