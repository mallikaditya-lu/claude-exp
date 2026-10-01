import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { timeAgo } from '../lib';
import type { Access, Board, CommentEntry, Patch, Rect, Thread } from '../types';
import { Avatar } from './items/TextCards';
import { IconCheck, IconComment, IconMore, IconX } from './icons';

// Figma-style comments: pins on the canvas, a thread popover, and a panel listing every thread.
// Threads are saved through their own API (one request per reply/edit/resolve), never through
// the board's card patches, so they don't take part in undo and can't be overwritten by a
// teammate's unsaved board state.

export interface Identity {
  name: string;
  /** null without sign-in (password/open mode). */
  email: string | null;
  /** Came in through a share link. */
  visitor: boolean;
}

export interface Place { x: number; y: number; itemId?: string | null; dx?: number | null; dy?: number | null }

export interface CommentUi {
  /** Comment mode: clicking the board drops a new pin. */
  mode: boolean;
  openId: string | null;
  draft: Place | null;
  panel: boolean;
  filter: 'open' | 'resolved';
  mineOnly: boolean;
  /** Bumped to pan the canvas to the open thread. */
  focus: number;
}

export const initialCommentUi: CommentUi = { mode: false, openId: null, draft: null, panel: false, filter: 'open', mineOnly: false, focus: 0 };

export const canCommentOn = (access: Access) => access !== 'view';
const canModerate = (access: Access) => access === 'edit' || access === 'manage';

export function isOwn(c: CommentEntry, me: Identity) {
  if (c.authorEmail) return Boolean(me.email) && c.authorEmail === me.email && Boolean(c.viaLink) === me.visitor;
  return c.author === me.name;
}

/** Where a pin's point is on the board: on its card if the card is still there. */
export function pinPoint(t: Thread | Place, rects: Record<string, Rect>) {
  const r = t.itemId ? rects[t.itemId] : null;
  // Kept on the card even if it has been resized smaller since.
  if (r && t.dx != null && t.dy != null) return { x: r.x + Math.min(t.dx, r.w), y: r.y + Math.min(t.dy, r.h) };
  return { x: t.x, y: t.y };
}

export function sortedThreads(board: Board | null) {
  return Object.values(board?.threads || {}).sort((a, b) => lastAt(b) - lastAt(a));
}
const lastAt = (t: Thread) => Math.max(t.createdAt, ...t.comments.map((c) => c.at));

/** Comment actions that apply the server's answer to the board straight away. */
export function useCommentActions(boardId: string, applyServerPatch: (p: Patch) => void, notify: (msg: string) => void) {
  return useMemo(() => {
    const thread = async (p: Promise<Thread>) => {
      try {
        const t = await p;
        applyServerPatch({ upsertThreads: [t] });
        return t;
      } catch (err) {
        notify((err as Error).message);
        return null;
      }
    };
    const gone = async (p: Promise<unknown>, id: string) => {
      try {
        const r = await p;
        if (r && typeof r === 'object' && 'comments' in r) applyServerPatch({ upsertThreads: [r as Thread] });
        else applyServerPatch({ removeThreads: [id] });
        return true;
      } catch (err) {
        notify((err as Error).message);
        return false;
      }
    };
    return {
      start: (place: Place, text: string) => thread(api.comments.start(boardId, place, text)),
      reply: (id: string, text: string) => thread(api.comments.reply(boardId, id, text)),
      resolve: (id: string, resolved: boolean) => thread(api.comments.resolve(boardId, id, resolved)),
      move: (id: string, place: Place) => thread(api.comments.move(boardId, id, place)),
      edit: (id: string, commentId: string, text: string) => thread(api.comments.edit(boardId, id, commentId, text)),
      remove: (id: string, commentId: string) => gone(api.comments.remove(boardId, id, commentId), id),
      removeThread: (id: string) => gone(api.comments.removeThread(boardId, id), id),
    };
  }, [boardId, applyServerPatch, notify]);
}
export type CommentActions = ReturnType<typeof useCommentActions>;

export interface CommentsProps {
  ui: CommentUi;
  setUi: (fn: (u: CommentUi) => CommentUi) => void;
  me: Identity;
  actions: CommentActions;
}

// ---------------------------------------------------------------------------------------------
// On the canvas: pins, the new-comment composer, and the open thread.
// ---------------------------------------------------------------------------------------------

interface LayerProps extends CommentsProps {
  board: Board;
  access: Access;
  view: { x: number; y: number; zoom: number };
  rects: Record<string, Rect>;
  size: { width: number; height: number };
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** Where a pin dropped at this board point attaches. */
  placeAt: (p: { x: number; y: number }) => Place;
}

const PIN = 32;
const POP_W = 340;

export function CommentLayer({ board, access, view, rects, size, toWorld, placeAt, ui, setUi, me, actions }: LayerProps) {
  const threads = board.threads || {};
  const open = ui.openId ? threads[ui.openId] : null;
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const moderator = canModerate(access);

  const screen = (p: { x: number; y: number }) => ({ x: view.x + p.x * view.zoom, y: view.y + p.y * view.zoom });

  // A thread that was deleted (by someone else) closes.
  useEffect(() => {
    if (ui.openId && !threads[ui.openId]) setUi((u) => ({ ...u, openId: null }));
  }, [threads, ui.openId, setUi]);

  const onPinDown = (e: React.PointerEvent, t: Thread) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const canMove = moderator || isOwn(t.comments[0] || { id: '', author: '', text: '', at: 0 }, me);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!canMove) return;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      const p = toWorld(ev.clientX, ev.clientY + PIN / 2);
      setDrag({ id: t.id, x: p.x, y: p.y });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (moved) {
        actions.move(t.id, placeAt(toWorld(ev.clientX, ev.clientY + PIN / 2)));
        return;
      }
      setUi((u) => ({ ...u, openId: u.openId === t.id ? null : t.id, draft: null }));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const visible = Object.values(threads).filter((t) => !t.resolved || t.id === ui.openId);

  const popoverPos = (p: { x: number; y: number }) => {
    const s = screen(p);
    let left = s.x + PIN + 12;
    if (left + POP_W > size.width - 12) left = s.x - POP_W - 12;
    left = Math.max(12, Math.min(left, size.width - POP_W - 12));
    const top = Math.max(12, Math.min(s.y - PIN - 8, size.height - 360));
    return { left, top };
  };

  return (
    <div className="comment-layer">
      {visible.map((t) => {
        const p = drag?.id === t.id ? drag : pinPoint(t, rects);
        const s = screen(p);
        const first = t.comments[0];
        return (
          <button
            key={t.id}
            className={`comment-pin ${ui.openId === t.id ? 'is-open' : ''} ${t.resolved ? 'is-resolved' : ''} ${drag?.id === t.id ? 'is-dragging' : ''}`}
            style={{ left: s.x, top: s.y - PIN }}
            title={first ? `${first.author}: ${first.text.slice(0, 80)}` : ''}
            onPointerDown={(e) => onPinDown(e, t)}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {first && <Avatar name={first.author} size={PIN - 8} />}
            {t.comments.length > 1 && <span className="pin-count">{t.comments.length}</span>}
          </button>
        );
      })}

      {ui.draft && (() => {
        const s = screen(pinPoint(ui.draft, rects));
        return (
          <>
            <div className="comment-pin is-draft" style={{ left: s.x, top: s.y - PIN }}><Avatar name={me.name} size={PIN - 8} /></div>
            <div className="comment-pop is-new" style={popoverPos(pinPoint(ui.draft, rects))} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <Composer
                me={me}
                autoFocus
                placeholder="Add a comment"
                onCancel={() => setUi((u) => ({ ...u, draft: null }))}
                onSend={async (text) => {
                  const t = await actions.start(ui.draft!, text);
                  if (t) setUi((u) => ({ ...u, mode: false, draft: null, openId: t.id, panel: true, filter: 'open' }));
                  return Boolean(t);
                }}
              />
            </div>
          </>
        );
      })()}

      {open && (
        <div className="comment-pop" style={popoverPos(drag?.id === open.id ? drag : pinPoint(open, rects))} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <ThreadView thread={open} access={access} me={me} actions={actions} onClose={() => setUi((u) => ({ ...u, openId: null }))} />
        </div>
      )}
    </div>
  );
}

function ThreadView({ thread, access, me, actions, onClose }: {
  thread: Thread; access: Access; me: Identity; actions: CommentActions; onClose: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const canComment = canCommentOn(access);
  const moderator = canModerate(access);
  const ownsThread = Boolean(thread.comments[0]) && isOwn(thread.comments[0], me);
  const listRef = useRef<HTMLDivElement>(null);
  const count = thread.comments.length;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('.comment-pop textarea')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="thread">
      <div className="thread-head">
        <b>Comment</b>
        <div className="grow" />
        {(ownsThread || moderator) && (
          <div className="pop-menu-wrap">
            <button className="icon-btn" title="More" onClick={() => setMenu((m) => !m)}><IconMore size={18} /></button>
            {menu && (
              <div className="menu" onPointerLeave={() => setMenu(false)}>
                <button
                  className="menu-item danger"
                  onClick={() => { setMenu(false); if (window.confirm('Delete this thread and all its replies?')) actions.removeThread(thread.id); }}
                >
                  Delete thread
                </button>
              </div>
            )}
          </div>
        )}
        {canComment && (
          <button
            className={`icon-btn resolve-btn ${thread.resolved ? 'is-on' : ''}`}
            title={thread.resolved ? 'Reopen' : 'Resolve'}
            onClick={() => { actions.resolve(thread.id, !thread.resolved); if (!thread.resolved) onClose(); }}
          >
            <IconCheck size={18} />
          </button>
        )}
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}><IconX size={18} /></button>
      </div>
      {thread.resolved && <div className="thread-resolved">Resolved by {thread.resolved.by} · {timeAgo(thread.resolved.at)}</div>}
      <div className="thread-list wheel-scroll" ref={listRef}>
        {thread.comments.map((c, i) => (
          <CommentRow
            key={c.id}
            c={c}
            mine={isOwn(c, me)}
            canDelete={isOwn(c, me) || moderator}
            onEdit={(text) => actions.edit(thread.id, c.id, text)}
            onDelete={() => {
              if (i === 0 && thread.comments.length > 1 && !window.confirm('Deleting the first comment deletes the whole thread, including replies. Continue?')) return;
              actions.remove(thread.id, c.id);
            }}
          />
        ))}
      </div>
      {canComment && (
        <div className="thread-reply">
          <Composer me={me} placeholder="Reply" onSend={async (text) => Boolean(await actions.reply(thread.id, text))} />
        </div>
      )}
    </div>
  );
}

function CommentRow({ c, mine, canDelete, onEdit, onDelete }: {
  c: CommentEntry; mine: boolean; canDelete: boolean; onEdit: (text: string) => Promise<unknown>; onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.text);

  return (
    <div className="thread-comment">
      <Avatar name={c.author} size={32} />
      <div className="thread-comment-main">
        <div className="thread-comment-meta">
          <b>{c.author}</b>
          {c.viaLink && <span className="via-link" title={`Commented through a share link${c.authorEmail ? ` as ${c.authorEmail}` : ''}`}>guest</span>}
          <span>{timeAgo(c.at)}{c.editedAt ? ' · edited' : ''}</span>
          <div className="grow" />
          {(mine || canDelete) && !editing && (
            <div className="pop-menu-wrap">
              <button className="icon-btn comment-more" title="More" onClick={() => setMenu((m) => !m)}><IconMore size={16} /></button>
              {menu && (
                <div className="menu" onPointerLeave={() => setMenu(false)}>
                  {mine && <button className="menu-item" onClick={() => { setMenu(false); setText(c.text); setEditing(true); }}>Edit</button>}
                  {canDelete && <button className="menu-item danger" onClick={() => { setMenu(false); onDelete(); }}>Delete</button>}
                </div>
              )}
            </div>
          )}
        </div>
        {editing ? (
          <div className="thread-edit">
            <textarea
              autoFocus
              value={text}
              rows={Math.min(8, text.split('\n').length + 1)}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) onEdit(text).then(() => setEditing(false)); }
              }}
            />
            <div className="thread-edit-actions">
              <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn primary" disabled={!text.trim()} onClick={() => onEdit(text).then(() => setEditing(false))}>Save</button>
            </div>
          </div>
        ) : (
          <div className="thread-comment-text">{c.text}</div>
        )}
      </div>
    </div>
  );
}

function Composer({ me, placeholder, autoFocus, onSend, onCancel }: {
  me: Identity; placeholder: string; autoFocus?: boolean; onSend: (text: string) => Promise<boolean>; onCancel?: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Focus once the click that opened this has finished (the browser moves focus on mouse-down).
  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => ref.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [autoFocus]);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const ok = await onSend(t);
    setBusy(false);
    if (ok) setText('');
  };
  return (
    <div className="composer">
      <Avatar name={me.name} size={32} />
      <div className="composer-box">
        <textarea
          ref={ref}
          value={text}
          rows={Math.min(6, text.split('\n').length)}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); }
          }}
        />
        <button className="send-btn" title="Send (Enter)" disabled={!text.trim() || busy} onClick={send}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Right-hand panel: every thread on the board, open or resolved.
// ---------------------------------------------------------------------------------------------

export function CommentsPanel({ board, access, ui, setUi, me, actions, hint, title }: CommentsProps & {
  board: Board | null; access: Access; hint?: React.ReactNode;
  /** Replaces the "Comments" heading (e.g. Comments | Notes tabs). */
  title?: React.ReactNode;
}) {
  const all = sortedThreads(board);
  const mine = (t: Thread) => t.comments.some((c) => isOwn(c, me));
  const base = ui.mineOnly ? all.filter(mine) : all;
  const openList = base.filter((t) => !t.resolved);
  const resolvedList = base.filter((t) => t.resolved);
  const list = ui.filter === 'open' ? openList : resolvedList;
  const canComment = canCommentOn(access);

  const openThread = useCallback((id: string) => setUi((u) => ({ ...u, openId: id, draft: null, focus: u.focus + 1 })), [setUi]);

  return (
    <aside className="comments-panel">
      <div className="comments-head">
        {title || <b>Comments</b>}
        <div className="grow" />
        {canComment && (
          <button className={`btn small ${ui.mode ? 'is-on' : ''}`} title="Add a comment (M)" onClick={() => setUi((u) => ({ ...u, mode: !u.mode, draft: null }))}>
            <IconComment size={14} /> {ui.mode ? 'Cancel' : 'Add'}
          </button>
        )}
        <button className="icon-btn" onClick={() => setUi((u) => ({ ...u, panel: false, mode: false, draft: null }))} aria-label="Close comments"><IconX size={15} /></button>
      </div>
      <div className="comments-filters">
        <div className="seg">
          <button className={ui.filter === 'open' ? 'is-on' : ''} onClick={() => setUi((u) => ({ ...u, filter: 'open' }))}>Open {openList.length}</button>
          <button className={ui.filter === 'resolved' ? 'is-on' : ''} onClick={() => setUi((u) => ({ ...u, filter: 'resolved' }))}>Resolved {resolvedList.length}</button>
        </div>
        <label className="mine-toggle">
          <input type="checkbox" checked={ui.mineOnly} onChange={(e) => setUi((u) => ({ ...u, mineOnly: e.target.checked }))} />
          Only yours
        </label>
      </div>
      <div className="comments-list">
        {list.map((t) => {
          const first = t.comments[0];
          if (!first) return null;
          const replies = t.comments.length - 1;
          return (
            <div
              key={t.id}
              className={`thread-row ${ui.openId === t.id ? 'is-active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => openThread(t.id)}
              onKeyDown={(e) => e.key === 'Enter' && openThread(t.id)}
            >
              <Avatar name={first.author} size={28} />
              <div className="thread-main">
                <span className="thread-meta"><b>{first.author}</b>{first.viaLink && <span className="via-link">guest</span>} <span>{timeAgo(lastAt(t))}</span></span>
                <span className="thread-text">{first.text}</span>
                {replies > 0 && <span className="thread-replies">{replies} repl{replies === 1 ? 'y' : 'ies'}</span>}
                {t.resolved && <span className="thread-resolved-note">Resolved by {t.resolved.by}</span>}
              </div>
              {canComment && (
                <button
                  className={`icon-btn resolve-btn ${t.resolved ? 'is-on' : ''}`}
                  title={t.resolved ? 'Reopen' : 'Resolve'}
                  onClick={(e) => { e.stopPropagation(); actions.resolve(t.id, !t.resolved); }}
                >
                  <IconCheck size={16} />
                </button>
              )}
            </div>
          );
        })}
        {!list.length && (
          <div className="share-empty">
            {ui.filter === 'resolved'
              ? 'No resolved comments.'
              : ui.mineOnly ? 'You haven’t commented on this board yet.' : 'No open comments.'}
            {ui.filter === 'open' && canComment && <> Press <kbd>M</kbd> or <b>Add</b>, then click anywhere on the board or on a card.</>}
            {hint}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Comment UI state for a board page. The panel's open/closed state is remembered per browser. */
export function useCommentUi() {
  const [ui, setUi] = useState<CommentUi>(() => {
    let panel = false;
    try { panel = localStorage.getItem('rb-comments-panel') === '1'; } catch { /* storage unavailable */ }
    return { ...initialCommentUi, panel };
  });
  useEffect(() => {
    try { localStorage.setItem('rb-comments-panel', ui.panel ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [ui.panel]);
  return [ui, setUi] as const;
}
