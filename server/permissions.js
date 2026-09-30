// Who may do what. Everything goes through these functions so the rules live in one place.
//
// Access levels, from most to least: manage > edit > comment > view.
//   manage  – team/admin: everything, including sharing and deleting
//   edit    – project editor: add, move, change and delete cards; upload; create boards in the project
//   comment – project commenter: view, add comment cards and reply
//   view    – project viewer: look only

const LEVEL = { view: 1, comment: 2, edit: 3, manage: 4 };
const MEMBER_LEVEL = { viewer: 'view', commenter: 'comment', editor: 'edit' };
export const MEMBER_ROLES = Object.keys(MEMBER_LEVEL);

export const atLeast = (level, needed) => Boolean(level) && LEVEL[level] >= LEVEL[needed];

export class Permissions {
  constructor(store, users) {
    this.store = store;
    this.users = users;
  }

  /** The request's person: { email, name, role } — or password/open mode, which acts as team. */
  role(user) {
    if (!user) return null;
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
    const p = projectId ? this.store.projects.get(projectId) : null;
    const m = p?.members?.[user?.email];
    return m ? MEMBER_LEVEL[m.role] || null : null;
  }

  /** Boards inherit access from their project; boards outside any project are team-only. */
  boardLevel(user, board) {
    if (!board) return null;
    if (this.isTeam(user)) return 'manage';
    return this.projectLevel(user, board.projectId);
  }

  can(user, board, needed) {
    return atLeast(this.boardLevel(user, board), needed);
  }

  visibleBoards(user) {
    const all = this.store.list();
    if (this.isTeam(user)) return all;
    return all.filter((b) => this.projectLevel(user, b.projectId));
  }

  visibleProjects(user) {
    const all = this.store.listProjects();
    const team = this.isTeam(user);
    return all
      .filter((p) => team || p.members?.[user?.email])
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
      if (!this.projectLevel(user, b.projectId)) continue;
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
        if (!after.has(id) && c.author !== user.name) return 'You can only delete your own comments';
        if (after.has(id) && JSON.stringify(after.get(id)) !== JSON.stringify(c)) return 'Comments can’t be edited';
      }
    }
    return null;
  }
}

/** New comments are always credited to the signed-in person, whatever the browser sent. */
export function stampCommentAuthors(user, board, patch) {
  if (!user?.email) return;
  for (const it of patch.upsertItems || []) {
    if (!Array.isArray(it.comments)) continue;
    const before = new Set((board.items[it.id]?.comments || []).map((c) => c.id));
    for (const c of it.comments) if (!before.has(c.id)) c.author = user.name;
  }
}
