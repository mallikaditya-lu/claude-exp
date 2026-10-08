import type { Board, BoardNote, BoardSharing, BoardSummary, Connection, GlobalRole, Item, LinkMode, MemberRole, Patch, Project, Thread } from './types';
import type { TemplateSummary } from './components/QuickAdd';

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
  /** Claude in boards: set when this person may use it (`enabled`: the server has an API key). */
  ai?: { enabled: boolean } | null;
}

/** A document kept as a board's context (research Claude reads with the board). */
export interface ContextDoc {
  id: string; title: string; kind: 'text' | 'file'; url?: string; name?: string; mime?: string; size: number;
  chars?: number; preview?: string; by: string; at: number; board: { id: string; title: string }; own: boolean;
}

export interface AiChatSummary { id: string; title: string; byName: string; by: string | null; createdAt: number; updatedAt: number; running: boolean; cost: number }
export type AiLogEntry =
  | { role: 'user'; text: string; by: string; at: number }
  | { role: 'assistant'; text: string; at: number }
  | { role: 'tool'; name: string; label: string; error?: string; at: number }
  | { role: 'error'; text: string; at: number };
export interface AiChat extends AiChatSummary { log: AiLogEntry[] }
export type AiEvent =
  | { t: 'chat'; id: string; title: string }
  | { t: 'text'; d: string }
  | { t: 'tool'; name: string; label: string }
  | { t: 'tool_done'; name: string; ok: boolean; error?: string }
  | { t: 'error'; message: string }
  | { t: 'done'; cost?: number; spend?: number; cap?: number };
export interface AiAdmin {
  enabled: boolean; model: string; month: string; spend: number; cap: number; allTeam: boolean;
  people: { email: string; name: string | null; spend: number }[];
  usage: { email: string; name: string | null; spend: number }[];
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

export interface TrashData {
  days: number;
  projects: { id: string; name: string; color: string; deletedAt: number; deletedBy: string | null; purgeAt: number; boards: number }[];
  boards: { id: string; title: string; deletedAt: number; deletedBy: string | null; purgeAt: number; boards: number; projectName: string | null; cover: string | null }[];
}

export interface UploadResult { url: string; name: string; size: number; mime: string }
export interface Asset { url: string; name: string; mime: string; size: number; at: number; by: string | null; onBoard: boolean; boardId: string; boardTitle: string }
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
  updateProject: (id: string, fields: Partial<Pick<Project, 'name' | 'color' | 'cover'>>) =>
    req<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  deleteProject: (id: string) => req<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  setMember: (projectId: string, email: string, role: MemberRole) =>
    req<Project>(`/api/projects/${projectId}/members/${encodeURIComponent(email)}`, { method: 'PUT', body: JSON.stringify({ role }) }),
  removeMember: (projectId: string, email: string) =>
    req<{ ok: boolean }>(`/api/projects/${projectId}/members/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  admin: () => req<AdminData>('/api/admin'),
  adminMcp: () => req<{ url: string; warnings: string[]; connections: { email: string | null; name: string | null; clientId: string; clientName: string; since: number; lastUsed: number }[] }>('/api/admin/mcp'),
  disconnectMcp: (email: string | null, client: string) =>
    req<{ ok: boolean }>(`/api/admin/mcp/connections?email=${encodeURIComponent(email || '')}&client=${encodeURIComponent(client)}`, { method: 'DELETE' }),
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
  duplicateBoard: (id: string, parentId: string | null = null) =>
    req<BoardSummary>(`/api/boards/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ parentId }) }),
  deleteBoard: (id: string) => req<{ deleted: string[] }>(`/api/boards/${id}`, { method: 'DELETE' }),
  renameAsset: (boardId: string, url: string, name: string) =>
    req<{ ok: boolean; name: string }>(`/api/boards/${boardId}/assets`, { method: 'PATCH', body: JSON.stringify({ url, name }) }),
  assets: (boardId: string, scope: 'board' | 'project') => req<Asset[]>(`/api/boards/${boardId}/assets?scope=${scope}`),
  notes: {
    add: (boardId: string, text = '') => req<BoardNote>(`/api/boards/${boardId}/notes`, { method: 'POST', body: JSON.stringify({ text }) }),
    edit: (boardId: string, id: string, fields: { text?: string; color?: string }) =>
      req<BoardNote>(`/api/boards/${boardId}/notes/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
    remove: (boardId: string, id: string) => req<{ ok: boolean }>(`/api/boards/${boardId}/notes/${id}`, { method: 'DELETE' }),
  },
  context: {
    list: (boardId: string) => req<ContextDoc[]>(`/api/boards/${boardId}/context`),
    get: (boardId: string, id: string) => req<ContextDoc & { text: string | null }>(`/api/boards/${boardId}/context/${id}`),
    addText: (boardId: string, title: string, text: string) => req<ContextDoc>(`/api/boards/${boardId}/context`, { method: 'POST', body: JSON.stringify({ title, text }) }),
    addFile: (boardId: string, f: { url: string; name: string; mime: string; size: number }) => req<ContextDoc>(`/api/boards/${boardId}/context`, { method: 'POST', body: JSON.stringify(f) }),
    remove: (boardId: string, id: string) => req<{ ok: boolean }>(`/api/boards/${boardId}/context/${id}`, { method: 'DELETE' }),
  },
  ai: {
    info: (boardId: string) => req<{ enabled: boolean; model: string; chats: AiChatSummary[]; spend: number; cap: number }>(`/api/boards/${boardId}/ai`),
    chat: (boardId: string, id: string) => req<AiChat>(`/api/boards/${boardId}/ai/chats/${id}`),
    remove: (boardId: string, id: string) => req<{ ok: boolean }>(`/api/boards/${boardId}/ai/chats/${id}`, { method: 'DELETE' }),
    stop: (boardId: string, id: string) => req<{ ok: boolean }>(`/api/boards/${boardId}/ai/chats/${id}/stop`, { method: 'POST' }),
    admin: () => req<AiAdmin>('/api/admin/ai'),
    setAdmin: (patch: { cap?: number; allTeam?: boolean; people?: string[] }) => req<{ ok: boolean }>('/api/admin/ai', { method: 'PATCH', body: JSON.stringify(patch) }),
    /** Send a message; `onEvent` gets the reply as it streams. Resolves when Claude is done. */
    async send(boardId: string, chatId: string | null, text: string, onEvent: (e: AiEvent) => void) {
      const res = await fetch(`/api/boards/${boardId}/ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client-id': clientId, 'x-user-name': encodeURIComponent(actorName) },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) { try { onEvent(JSON.parse(line.slice(6))); } catch { /* ignore malformed */ } }
        }
      }
    },
  },
  projectImages: (id: string) => req<{ url: string; name: string; boardTitle: string }[]>(`/api/projects/${id}/images`),
  trash: () => req<TrashData>('/api/trash'),
  restoreBoard: (id: string) => req<{ ok: boolean }>(`/api/trash/boards/${id}/restore`, { method: 'POST' }),
  restoreProject: (id: string) => req<{ ok: boolean }>(`/api/trash/projects/${id}/restore`, { method: 'POST' }),
  purgeBoard: (id: string) => req<{ ok: boolean }>(`/api/trash/boards/${id}`, { method: 'DELETE' }),
  purgeProject: (id: string) => req<{ ok: boolean }>(`/api/trash/projects/${id}`, { method: 'DELETE' }),
  templates: () => req<TemplateSummary[]>('/api/templates'),
  template: (id: string) => req<{ id: string; name: string; items: Item[]; connections: Connection[] }>(`/api/templates/${id}`),
  saveTemplate: (name: string, items: Item[], connections: Connection[], category = '') =>
    req<{ id: string; name: string; category: string }>('/api/templates', { method: 'POST', body: JSON.stringify({ name, category, items, connections }) }),
  deleteTemplate: (id: string) => req<{ ok: boolean }>(`/api/templates/${id}`, { method: 'DELETE' }),
  importUrl: (url: string, boardId: string) =>
    req<{ media: false } | ({ media: true; sourceUrl: string } & UploadResult)>('/api/import-url', { method: 'POST', body: JSON.stringify({ url, boardId }) }),
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
