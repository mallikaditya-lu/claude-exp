// Who may do what. Everything goes through these functions so the rules live in one place.
//
// Access levels, from most to least: manage > edit > comment > view.
//   manage  – team/admin: everything, including sharing and deleting
//   edit    – project editor: add, move, change and delete cards; upload; create boards in the project
//   comment – commenter: view, start comment threads, reply, resolve; edit/delete their own comments
//             (editors can also delete anyone's)
//   view    – project viewer: look only
//
// Guests get a level from project invites and from board invites (a board invite covers the
// boards nested inside it too); the higher one wins.
// Link visitors (no sign-in, see visitors.js) get the link's level on the shared board and the
// boards inside it, and nothing else. Their email is typed in, not verified, so it never grants
// anything by itself.

const LEVEL = { view: 1, comment: 2, edit: 3, manage: 4 };
const higher = (a, b) => ((LEVEL[b] || 0) > (LEVEL[a] || 0) ? b : a);
const MEMBER_LEVEL = { viewer: 'view', commenter: 'comment', editor: 'edit' };
export const MEMBER_ROLES = Object.keys(MEMBER_LEVEL);

export const atLeast = (level, needed) => Boolean(level) && LEVEL[level] >= LEVEL[needed];

export class Permissions {
  constructor(store, users) {
    this.store = store;
    this.users = users;
  }

  /** The request's person: { email, name, role }, a link visitor, or password/open mode (acts as team). */
  role(user) {
    if (!user) return null;
    if (user.visitor) return 'visitor';
    if (!user.email) return 'team';
    return this.users.roleOf(user.email);
  }

  isTeam(user) {
    const r = this.role(user);
    return r === 'team' || r === 'admin';
  }

  isAdmin(user) {
    return this.role(user) === 'admin';
  }

  projectLevel(user, projectId) {
    if (this.isTeam(user)) return 'manage';
    if (!user?.email || user.visitor) return null;
    const p = projectId ? this.store.projects.get(projectId) : null;
    const m = p?.members?.[user?.email];
    return m ? MEMBER_LEVEL[m.role] || null : null;
  }

  /**
   * Boards inherit access from their project and from invites to the board or any board it sits in.
   * Boards with neither are team-only.
   */
  boardLevel(user, board) {
    if (!board || !user) return null;
    if (this.isTeam(user)) return 'manage';
    if (user.visitor) return this.linkLevel(user, board);
    let level = this.projectLevel(user, board.projectId);
    for (const b of [board, ...this.store.ancestors(board.id)]) {
      const m = b.members?.[user.email];
      if (m) level = higher(level, MEMBER_LEVEL[m.role]);
    }
    return level || null;
  }

  /** The live share links this visitor has opened: [{ board, share }]. Checked on every request. */
  linkShares(user) {
    const out = [];
    for (const token of user?.tokens || []) {
      const found = this.store.findShare(token);
      if (found && found.share.mode !== 'off' && (user.identified || !found.share.requireIdentity)) out.push(found);
    }
    return out;
  }

  /** A link visitor's level: the link's mode inside the shared board. Commenting needs a name. */
  linkLevel(user, board) {
    let level = null;
    for (const { board: root, share } of this.linkShares(user)) {
      if (!this.store.isWithin(board.id, root.id)) continue;
      level = higher(level, share.mode === 'comment' && user.identified ? 'comment' : 'view');
    }
    return level;
  }

  can(user, board, needed) {
    return atLeast(this.boardLevel(user, board), needed);
  }

  visibleBoards(user) {
    if (this.isTeam(user)) return this.store.list();
    return [...this.store.boards.values()].filter((b) => this.boardLevel(user, b)).map((b) => this.store.summary(b));
  }

  /** Projects the person was invited to, plus projects holding boards shared with them (myLevel null). */
  visibleProjects(user) {
    if (user?.visitor) return [];
    const all = this.store.listProjects();
    const team = this.isTeam(user);
    const viaBoards = team ? null : new Set(this.visibleBoards(user).map((b) => b.projectId).filter(Boolean));
    return all
      .filter((p) => team || p.members?.[user?.email] || viaBoards.has(p.id))
      .map((p) => {
        const out = { id: p.id, name: p.name, color: p.color, cover: p.cover || null, createdAt: p.createdAt, myLevel: this.projectLevel(user, p.id) };
        // Only the team sees who else is in a project.
        if (team) out.members = Object.entries(p.members || {}).map(([email, m]) => ({ email, ...m, name: this.users.get(email)?.name || null, lastSeen: this.users.get(email)?.lastSeen || 0 }));
        return out;
      });
  }

  /** Uploaded files: guests may load a file only if it's used on a board they can see. */
  canReadFile(user, url) {
    if (this.isTeam(user)) return true;
    // A project's cover image, for anyone who can see the project.
    if (!user?.visitor && this.visibleProjects(user).some((p) => p.cover === url)) return true;
    for (const b of this.store.boards.values()) {
      if (!this.boardLevel(user, b)) continue;
      for (const it of Object.values(b.items)) {
        if (it.url === url || it.thumb === url) return true;
        // Images and videos inside table cells.
        if (it.table && JSON.stringify(it.table).includes(url)) return true;
      }
      if (b.cover === url) return true;
      // Files once added to the board (the Assets panel keeps them after their card is deleted).
      if (b.assets?.some((a) => a.url === url)) return true;
    }
    return false;
  }
}

/**
 * Whose comment is this? Signed-in people and named link visitors are matched by email (a visitor's
 * comment never counts as a signed-in person's with the same email). Without sign-in (password or
 * open mode) only the display name is known.
 */
export function isOwnComment(user, c) {
  if (c.authorEmail) return Boolean(user.email) && c.authorEmail === user.email && Boolean(c.viaLink) === Boolean(user.visitor);
  return Boolean(user.name) && c.author === user.name;
}
