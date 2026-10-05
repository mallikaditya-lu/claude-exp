// Who may do what. Everything goes through these functions so the rules live in one place.
//
// Access levels, from most to least: manage > edit > comment > view.
//   manage  – admins everywhere; core-team editors of a project or board (its creator is one):
//             everything, including sharing, covers, moving and deleting
//   edit    – guest editor: add, move, change and delete cards; upload; create boards in the project
//   comment – commenter: view, start comment threads, reply, resolve; edit/delete their own comments
//             (editors can also delete anyone's)
//   view    – project viewer: look only
//
// Only admins see every project. Everyone else, core team included, gets a level from project
// invites and from board invites (a board invite covers the boards nested inside it too); the
// higher one wins. Creating a project, or a board outside any project, makes you its editor.
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

  /** Admins see every project and board. So does password/open mode, which has no emails to invite. */
  seesAll(user) {
    return this.isAdmin(user) || (this.role(user) === 'team' && !user.email);
  }

  /** An invite's level. Core-team editors also manage (share, rename, delete); guest editors only edit. */
  memberLevel(user, m) {
    if (!m) return null;
    if (m.role === 'editor' && this.isTeam(user)) return 'manage';
    return MEMBER_LEVEL[m.role] || null;
  }

  projectLevel(user, projectId) {
    return this.projectLevelOf(user, projectId ? this.store.projects.get(projectId) : null);
  }

  /** Same, for a project object (also one in the trash). */
  projectLevelOf(user, p) {
    if (this.seesAll(user)) return 'manage';
    if (!user?.email || user.visitor) return null;
    return this.memberLevel(user, p?.members?.[user.email]);
  }

  /**
   * Boards inherit access from their project and from invites to the board or any board it sits in.
   * Boards with neither are admin-only.
   */
  boardLevel(user, board) {
    if (!board || !user) return null;
    if (this.seesAll(user)) return 'manage';
    if (user.visitor) return this.linkLevel(user, board);
    let level = this.projectLevel(user, board.projectId);
    for (const b of [board, ...this.store.ancestors(board.id)]) level = higher(level, this.memberLevel(user, b.members?.[user.email]));
    return level || null;
  }

  /** A board in the trash: from its (possibly trashed) project, its own invites and its live parents. */
  trashedBoardLevel(user, board) {
    if (this.seesAll(user)) return 'manage';
    if (!user?.email || user.visitor) return null;
    let level = this.projectLevelOf(user, this.store.projects.get(board.projectId) || this.store.trashedProjects.get(board.projectId));
    const parent = board.parentId ? this.store.get(board.parentId) : null;
    const chain = [board, ...(parent ? [parent, ...this.store.ancestors(parent.id)] : [])];
    for (const b of chain) level = higher(level, this.memberLevel(user, b.members?.[user.email]));
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

  /** Board summaries this person can see, each with their access level. */
  visibleBoards(user) {
    if (this.seesAll(user)) return this.store.list().map((b) => ({ ...b, access: 'manage' }));
    const out = [];
    for (const b of this.store.boards.values()) {
      const access = this.boardLevel(user, b);
      if (access) out.push({ ...this.store.summary(b), access });
    }
    return out;
  }

  /** Projects the person was invited to, plus projects holding boards shared with them (myLevel null). */
  visibleProjects(user) {
    if (user?.visitor) return [];
    const all = this.store.listProjects();
    const everything = this.seesAll(user);
    const viaBoards = everything ? null : new Set(this.visibleBoards(user).map((b) => b.projectId).filter(Boolean));
    return all
      .filter((p) => everything || p.members?.[user?.email] || viaBoards.has(p.id))
      .map((p) => {
        const myLevel = this.projectLevel(user, p.id);
        const out = { id: p.id, name: p.name, color: p.color, cover: p.cover || null, createdAt: p.createdAt, createdBy: p.createdBy || null, myLevel };
        // Only the people who manage a project see who else is in it.
        if (myLevel === 'manage') out.members = Object.entries(p.members || {}).map(([email, m]) => ({ email, ...m, team: this.users.roleOf(email) !== 'guest', name: this.users.get(email)?.name || null, lastSeen: this.users.get(email)?.lastSeen || 0 }));
        return out;
      });
  }

  /** Uploaded files: people may load a file only if it's used on a board they can see. */
  canReadFile(user, url, templates) {
    if (this.seesAll(user)) return true;
    // Images in templates, which the whole core team shares.
    if (this.isTeam(user) && templates?.usesFile(url)) return true;
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
