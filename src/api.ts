import type { Board, BoardSharing, BoardSummary, GlobalRole, LinkMode, MemberRole, Patch, Project, Thread } from './types';

export const clientId = crypto.randomUUID();

// Without sign-in (password/open mode) the server only knows your name from this header.
let actorName = '';
export function setActorName(name: string) { actorName = name; }

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-client-id': clientId, 'x-user-name': encodeURIComponent(actorName), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
  }
  return res.json();
}

export interface Session {
  mode: 'cloudflare' | 'password' | 'open';
  authRequired: boolean;
  authed: boolean;
  /** Set when signed in through Cloudflare Access. */
  user: { email: string; name: string; role: GlobalRole } | null;
  role: GlobalRole | null;
  publicUrl: string;
  /** False when share links can't work yet (Cloudflare mode without SHARE_URL). */
  shareLinks?: boolean;
}

/** What someone opening a share link gets told about it. */
export interface ShareInfo {
  boardId: string;
  title: string;
  mode: Exclude<LinkMode, 'off'>;
  requireIdentity: boolean;
  visitor: { name: string; email: string } | null;
  /** Set when the person is signed in and has their own access to the board. */
  member: string | null;
}

export interface AdminVisitor {
  id: string;
  name: string;
  email: string;
  createdAt: number;
  lastSeen: number;
  boards: { id: string; name: string; at: number; link: LinkMode }[];
}

export interface AdminPerson {
  email: string;
  name: string | null;
  role: GlobalRole;
  lastSeen: number;
  createdAt: number;
  pending?: boolean;
  removedForInactivity: { at: number; projects: string[] } | null;
  projects: { id: string; name: string; role: MemberRole }[];
  boards: { id: string; name: string; role: MemberRole }[];
}

export interface AdminData {
  people: AdminPerson[];
  visitors: AdminVisitor[];
  settings: { inactiveDays: number };
  adminEmails: string[];
  teamDomains: string[];
  stats: { projects: number; boards: number; files: number; storage: string; activeLast7Days: number };
}

export interface UploadResult { url: string; name: string; size: number; mime: string }
export interface LinkMeta { url: string; title: string; description: string; image: string; siteName: string }

export const api = {
  session: () => req<Session>('/api/session'),
  rename: (name: string) => req<{ email: string; name: string }>('/api/me', { method: 'PATCH', body: JSON.stringify({ name }) }),
  login: (password: string) => req<{ ok: boolean }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),
  listBoards: () => req<BoardSummary[]>('/api/boards'),
  getBoard: (id: string) => req<Board>(`/api/boards/${id}`),
  createBoard: (title: string, parentId: string | null = null, projectId: string | null = null) =>
    req<Board>('/api/boards', { method: 'POST', body: JSON.stringify({ title, parentId, projectId }) }),
  listProjects: () => req<Project[]>('/api/projects'),
  createProject: (name: string, color = 'purple') =>
    req<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ name, color }) }),
  updateProject: (id: string, fields: Partial<Pick<Project, 'name' | 'color'>>) =>
    req<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  deleteProject: (id: string) => req<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  setMember: (projectId: string, email: string, role: MemberRole) =>
    req<Project>(`/api/projects/${projectId}/members/${encodeURIComponent(email)}`, { method: 'PUT', body: JSON.stringify({ role }) }),
  removeMember: (projectId: string, email: string) =>
    req<{ ok: boolean }>(`/api/projects/${projectId}/members/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  admin: () => req<AdminData>('/api/admin'),
  setPersonRole: (email: string, role: GlobalRole) =>
    req<{ ok: boolean }>(`/api/admin/people/${encodeURIComponent(email)}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removePerson: (email: string) => req<{ ok: boolean }>(`/api/admin/people/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  updateSettings: (settings: Partial<AdminData['settings']>) =>
    req<AdminData['settings']>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(settings) }),
  sharing: (boardId: string) => req<BoardSharing>(`/api/boards/${boardId}/sharing`),
  setLink: (boardId: string, fields: { mode?: LinkMode; requireIdentity?: boolean }) =>
    req<BoardSharing>(`/api/boards/${boardId}/share`, { method: 'PUT', body: JSON.stringify(fields) }),
  resetLink: (boardId: string) => req<BoardSharing>(`/api/boards/${boardId}/share/reset`, { method: 'POST' }),
  setBoardMember: (boardId: string, email: string, role: MemberRole) =>
    req<BoardSharing>(`/api/boards/${boardId}/members/${encodeURIComponent(email)}`, { method: 'PUT', body: JSON.stringify({ role }) }),
  removeBoardMember: (boardId: string, email: string) =>
    req<BoardSharing>(`/api/boards/${boardId}/members/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  openShare: (token: string) => req<ShareInfo>(`/api/share/${encodeURIComponent(token)}`),
  identify: (token: string, name: string, email: string) =>
    req<ShareInfo>(`/api/share/${encodeURIComponent(token)}/identify`, { method: 'POST', body: JSON.stringify({ name, email }) }),
  forgetMe: () => req<{ ok: boolean }>('/api/share-forget', { method: 'POST' }),
  removeVisitor: (id: string) => req<{ ok: boolean }>(`/api/admin/visitors/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  comments: {
    start: (boardId: string, place: Pick<Thread, 'x' | 'y' | 'itemId' | 'dx' | 'dy'>, text: string) =>
      req<Thread>(`/api/boards/${boardId}/threads`, { method: 'POST', body: JSON.stringify({ ...place, text }) }),
    reply: (boardId: string, threadId: string, text: string) =>
      req<Thread>(`/api/boards/${boardId}/threads/${threadId}/comments`, { method: 'POST', body: JSON.stringify({ text }) }),
    resolve: (boardId: string, threadId: string, resolved: boolean) =>
      req<Thread>(`/api/boards/${boardId}/threads/${threadId}`, { method: 'PATCH', body: JSON.stringify({ resolved }) }),
    move: (boardId: string, threadId: string, place: Pick<Thread, 'x' | 'y' | 'itemId' | 'dx' | 'dy'>) =>
      req<Thread>(`/api/boards/${boardId}/threads/${threadId}`, { method: 'PATCH', body: JSON.stringify(place) }),
    removeThread: (boardId: string, threadId: string) =>
      req<{ ok: boolean }>(`/api/boards/${boardId}/threads/${threadId}`, { method: 'DELETE' }),
    edit: (boardId: string, threadId: string, commentId: string, text: string) =>
      req<Thread>(`/api/boards/${boardId}/threads/${threadId}/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify({ text }) }),
    remove: (boardId: string, threadId: string, commentId: string) =>
      req<Thread | { ok: boolean }>(`/api/boards/${boardId}/threads/${threadId}/comments/${commentId}`, { method: 'DELETE' }),
  },
  patchBoard: (id: string, patch: Patch, keepalive = false) =>
    req<{ version: number }>(`/api/boards/${id}/patch`, { method: 'POST', body: JSON.stringify(patch), keepalive }),
  deleteBoard: (id: string) => req<{ deleted: string[] }>(`/api/boards/${id}`, { method: 'DELETE' }),
  unfurl: (url: string) => req<LinkMeta>(`/api/unfurl?url=${encodeURIComponent(url)}`),
  /**
   * Upload in chunks: small requests get past proxy size limits, and a dropped connection
   * only retries the chunk that failed.
   */
  async upload(file: File, onProgress?: (fraction: number) => void, boardId?: string): Promise<UploadResult> {
    const { id, chunkSize } = await req<{ id: string; chunkSize: number }>('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, size: file.size, mime: file.type || 'application/octet-stream', boardId }),
    });
    let offset = 0;
    try {
      while (offset < file.size) {
        const chunk = file.slice(offset, offset + chunkSize);
        let attempt = 0;
        for (;;) {
          try {
            const r = await sendChunk(`/api/uploads/${id}?offset=${offset}`, chunk, (loaded) => onProgress?.((offset + loaded) / file.size));
            offset = r.received;
            break;
          } catch (err) {
            const status = (err as { status?: number }).status;
            if (status === 409 && (err as { received?: number }).received !== undefined) { offset = (err as { received: number }).received; break; }
            if ((status && status < 500 && status !== 408) || ++attempt > 4) throw err;
            await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
          }
        }
      }
      onProgress?.(1);
      return await req<UploadResult>(`/api/uploads/${id}/complete`, { method: 'POST' });
    } catch (err) {
      fetch(`/api/uploads/${id}`, { method: 'DELETE' }).catch(() => {});
      throw err;
    }
  },
};

function sendChunk(url: string, body: Blob, onProgress: (loaded: number) => void): Promise<{ received: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let json: { error?: string; received?: number } = {};
      try { json = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json as { received: number });
      else reject(Object.assign(new Error(json.error || `Upload failed (${xhr.status})`), { status: xhr.status, received: json.received }));
    };
    xhr.onerror = () => reject(Object.assign(new Error('Upload failed — check your connection'), { status: 0 }));
    xhr.send(body);
  });
}

// ---------- realtime socket with auto-reconnect ----------
type Listener = (msg: any) => void;

class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private boardId: string | null = null;
  private name = '';
  private retry = 0;
  private started = false;

  start(name: string) {
    this.name = name;
    if (this.started) {
      this.send({ t: 'hello', clientId, name });
      return;
    }
    this.started = true;
    this.connect();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.send({ t: 'hello', clientId, name: this.name });
      if (this.boardId) this.send({ t: 'join', boardId: this.boardId });
      this.emit({ t: 'open' });
    };
    ws.onmessage = (e) => {
      try { this.emit(JSON.parse(e.data)); } catch { /* ignore malformed */ }
    };
    ws.onclose = () => {
      this.emit({ t: 'closed' });
      const delay = Math.min(10000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  private emit(msg: any) {
    for (const l of this.listeners) l(msg);
  }

  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Reconnect so the server re-reads who this is (after a link visitor gives their name). */
  reconnect() {
    this.ws?.close();
  }

  join(boardId: string | null) {
    this.boardId = boardId;
    this.send({ t: 'join', boardId });
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}

export const socket = new Socket();
