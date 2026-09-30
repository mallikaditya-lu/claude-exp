// Who may do what. Everything goes through these functions so the rules live in one place.
//
// Access levels, from most to least: manage > edit > comment > view.
//   manage  – team/admin: everything, including sharing and deleting
//   edit    – project editor: add, move, change and delete cards; upload; create boards in the project
//   comment – project commenter: view, add comment cards and reply
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
        const out = { id: p.id, name: p.name, color: p.color, createdAt: p.createdAt, myLevel: this.projectLevel(user, p.id) };
        // Only the team sees who else is in a project.
        if (team) out.members = Object.entries(p.members || {}).map(([email, m]) => ({ email, ...m, name: this.users.get(email)?.name || null, lastSeen: this.users.get(email)?.lastSeen || 0 }));
        return out;
      });
  }

  /** Uploaded files: guests may load a file only if it's used on a board they can see. */
  canReadFile(user, url) {
    if (this.isTeam(user)) return true;
    for (const b of this.store.boards.values()) {
      if (!this.boardLevel(user, b)) continue;
      for (const it of Object.values(b.items)) if (it.url === url || it.thumb === url) return true;
    }
    return false;
  }

  /**
   * Commenters may only add comment cards and add/remove their own comments on comment cards.
   * Returns an error message, or null if the patch is allowed.
   */
  checkCommentPatch(user, board, patch) {
    if (patch.title !== undefined || patch.background !== undefined || patch.projectId !== undefined) return 'Commenters can’t change board settings';
    if (patch.removeItems?.length || patch.upsertConnections?.length || patch.removeConnections?.length) return 'Commenters can only add comments';
    for (const it of patch.upsertItems || []) {
      if (it.type !== 'comment') return 'Commenters can only add comments';
      const prev = board.items[it.id];
      if (!prev) continue; // a new comment card
      const { comments: a = [], ...restNew } = it;
      const { comments: b = [], ...restOld } = prev;
      if (JSON.stringify(restNew) !== JSON.stringify(restOld)) return 'Commenters can’t move or restyle cards';
      const before = new Map(b.map((c) => [c.id, c]));
      const after = new Map(a.map((c) => [c.id, c]));
      for (const [id, c] of before) {
        if (!after.has(id) && !isOwnComment(user, c)) return 'You can only delete your own comments';
        if (after.has(id) && JSON.stringify(after.get(id)) !== JSON.stringify(c)) return 'Comments can’t be edited';
      }
    }
    return null;
  }
}

/** Comments carry who wrote them; link visitors' comments are marked so they can't pass as a signed-in person's. */
function isOwnComment(user, c) {
  if (c.authorEmail) return c.authorEmail === user.email && Boolean(c.viaLink) === Boolean(user.visitor);
  return c.author === user.name;
}

/** New comments are always credited to the signed-in person (or named visitor), whatever the browser sent. */
export function stampCommentAuthors(user, board, patch) {
  if (!user?.email) return;
  for (const it of patch.upsertItems || []) {
    if (!Array.isArray(it.comments)) continue;
    const before = new Map((board.items[it.id]?.comments || []).map((c) => [c.id, c]));
    it.comments = it.comments.map((c) => {
      if (before.has(c.id)) return before.get(c.id); // existing comments can't be re-attributed
      const out = { ...c, author: user.name, authorEmail: user.email };
      if (user.visitor) out.viaLink = true;
      else delete out.viaLink;
      return out;
    });
  }
}
