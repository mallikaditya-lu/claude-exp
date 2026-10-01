import { useCallback, useEffect, useRef, useState } from 'react';
import { api, socket } from './api';
import { applyPatch, diffBoards } from './lib';
import type { Board, Patch, PresenceUser } from './types';

export type SaveStatus = 'loading' | 'saved' | 'saving' | 'offline' | 'missing';

type Snapshot = Pick<Board, 'title' | 'items' | 'connections'>;
const snap = (b: Board): Snapshot => ({ title: b.title, items: b.items, connections: b.connections });

/**
 * Local-first board state.
 * Edits apply immediately; a debounced flush diffs against the last state the server
 * acknowledged and sends only changed cards. Remote patches from teammates are applied
 * to both copies, so local unsaved edits survive them.
 */
export function useBoard(boardId: string) {
  const [board, setBoard] = useState<Board | null>(null);
  const [status, setStatus] = useState<SaveStatus>('loading');
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const current = useRef<Board | null>(null);
  const saved = useRef<Board | null>(null);
  const history = useRef({ past: [] as Snapshot[], future: [] as Snapshot[], lastKey: '', lastAt: 0 });
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef(false);
  const again = useRef(false);

  const flush = useCallback(async (keepalive = false) => {
    window.clearTimeout(timer.current);
    const cur = current.current;
    const base = saved.current;
    if (!cur || !base) return;
    if (inflight.current) { again.current = true; return; }
    const patch = diffBoards(base, cur);
    if (!patch) { setStatus('saved'); return; }
    inflight.current = true;
    setStatus('saving');
    saved.current = cur;
    try {
      await api.patchBoard(cur.id, patch, keepalive);
      setStatus('saved');
    } catch {
      saved.current = base;
      setStatus('offline');
      timer.current = window.setTimeout(() => flush(), 3000);
    } finally {
      inflight.current = false;
      if (again.current) { again.current = false; flush(); }
    }
  }, []);

  const commit = useCallback((next: Board) => {
    current.current = next;
    setBoard(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(), 350);
  }, [flush]);

  // Load + subscribe
  useEffect(() => {
    let alive = true;
    current.current = null;
    saved.current = null;
    history.current = { past: [], future: [], lastKey: '', lastAt: 0 };
    setBoard(null);
    setPresence([]);
    setStatus('loading');

    const load = async () => {
      try {
        const server = await api.getBoard(boardId);
        if (!alive) return;
        // Re-apply anything we changed locally but the server never received.
        const pending = current.current && saved.current ? diffBoards(saved.current, current.current) : null;
        saved.current = server;
        const next = pending ? applyPatch(server, pending) : server;
        current.current = next;
        setBoard(next);
        setStatus('saved');
        if (pending) flush();
      } catch (err) {
        if (alive && (err as { status?: number }).status === 404) setStatus('missing');
        else if (alive) setStatus('offline');
      }
    };
    load();
    socket.join(boardId);

    let opened = false;
    const off = socket.on((msg) => {
      if (msg.t === 'open') {
        if (opened) load(); // reconnected: catch up on anything we missed
        opened = true;
      } else if (msg.t === 'patch' && msg.boardId === boardId && current.current && saved.current) {
        saved.current = applyPatch(saved.current, msg.patch);
        current.current = applyPatch(current.current, msg.patch);
        setBoard(current.current);
      } else if (msg.t === 'presence' && msg.boardId === boardId) {
        setPresence(msg.users);
      } else if (msg.t === 'deleted' && msg.boardId === boardId) {
        setStatus('missing');
      }
    });

    const beforeUnload = () => { flush(true); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      alive = false;
      off();
      window.removeEventListener('beforeunload', beforeUnload);
      flush(true);
      socket.join(null);
    };
  }, [boardId, flush]);

  /**
   * Apply an edit. Edits sharing the same `key` within 1.5s collapse into one undo step
   * (typing in a card, a drag gesture).
   */
  const change = useCallback((recipe: (b: Board) => Board, key?: string) => {
    const cur = current.current;
    if (!cur) return;
    const next = recipe(cur);
    if (next === cur) return;
    const h = history.current;
    const now = Date.now();
    if (!(key && key === h.lastKey && now - h.lastAt < 1500)) {
      h.past.push(snap(cur));
      if (h.past.length > 150) h.past.shift();
    }
    h.lastKey = key || '';
    h.lastAt = now;
    h.future = [];
    commit(next);
  }, [commit]);

  const undo = useCallback(() => {
    const cur = current.current;
    const h = history.current;
    const prev = h.past.pop();
    if (!cur || !prev) return;
    h.future.push(snap(cur));
    h.lastKey = '';
    commit({ ...cur, ...prev });
  }, [commit]);

  const redo = useCallback(() => {
    const cur = current.current;
    const h = history.current;
    const next = h.future.pop();
    if (!cur || !next) return;
    h.past.push(snap(cur));
    h.lastKey = '';
    commit({ ...cur, ...next });
  }, [commit]);

  const getBoard = useCallback(() => current.current, []);

  /** Apply something the server already saved (comment threads), without sending it back. */
  const applyServerPatch = useCallback((patch: Patch) => {
    if (!current.current || !saved.current) return;
    saved.current = applyPatch(saved.current, patch);
    current.current = applyPatch(current.current, patch);
    setBoard(current.current);
  }, []);

  return { board, status, presence, change, undo, redo, getBoard, applyServerPatch };
}
