import type { Board, BoardSummary, Patch } from './types';

export const clientId = crypto.randomUUID();

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-client-id': clientId, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
  }
  return res.json();
}

export interface UploadResult { url: string; name: string; size: number; mime: string }
export interface LinkMeta { url: string; title: string; description: string; image: string; siteName: string }

export const api = {
  session: () => req<{ authRequired: boolean; authed: boolean }>('/api/session'),
  login: (password: string) => req<{ ok: boolean }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),
  listBoards: () => req<BoardSummary[]>('/api/boards'),
  getBoard: (id: string) => req<Board>(`/api/boards/${id}`),
  createBoard: (title: string, parentId: string | null = null) =>
    req<Board>('/api/boards', { method: 'POST', body: JSON.stringify({ title, parentId }) }),
  patchBoard: (id: string, patch: Patch, keepalive = false) =>
    req<{ version: number }>(`/api/boards/${id}/patch`, { method: 'POST', body: JSON.stringify(patch), keepalive }),
  deleteBoard: (id: string) => req<{ deleted: string[] }>(`/api/boards/${id}`, { method: 'DELETE' }),
  unfurl: (url: string) => req<LinkMeta>(`/api/unfurl?url=${encodeURIComponent(url)}`),
  upload(file: File, onProgress?: (fraction: number) => void): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      xhr.open('POST', '/api/upload');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let body: { error?: string } & Partial<UploadResult> = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadResult);
        else reject(new Error(body.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
      xhr.send(form);
    });
  },
};

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
