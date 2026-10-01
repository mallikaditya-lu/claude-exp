import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, socket } from '../api';
import { COLORS, color, imageFromHtml, isInColumn, isMediaUrl, isUrl, kindForMime, maxZ, textToHtml, uid } from '../lib';
import { SIDES, STROKE, route, sideForPoint, type SegmentHandle } from '../connectors';
import type { Access, Board, BoardSummary, Connection, Item, ItemType, Rect, Side } from '../types';
import { ConnectorToolbar } from './ConnectorToolbar';
import { CanvasContext, type CanvasCtx } from './CanvasContext';
import { ItemBody } from './items';
import { TOOL_MIME, Toolbar, type Tool } from './Toolbar';
import { CommentLayer, pinPoint, type CommentsProps, type Place } from './Comments';
import { QuickAdd, type QuickPick, type TemplateSummary } from './QuickAdd';
import {
  IconBold, IconCopy, IconExternal, IconFit, IconFront, IconH, IconItalic, IconLink, IconList, IconMinus, IconOList,
  IconPlus, IconStrike, IconTrash, IconUnderline, IconEdit, IconComment, IconTemplate,
} from './icons';

interface Props {
  board: Board;
  change: (recipe: (b: Board) => Board, key?: string) => void;
  undo: () => void;
  redo: () => void;
  getBoard: () => Board | null;
  boards: Record<string, BoardSummary>;
  me: string;
  openBoard: (id: string) => void;
  notify: (msg: string) => void;
  /** What the current person may do here (the server enforces the same rules). */
  access?: Access;
  /** Comment pins, popovers and comment mode (state lives with the page, shared with the panel). */
  comments?: CommentsProps;
}

interface View { x: number; y: number; zoom: number }

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const CLIP_PREFIX = 'RB_CARDS:';
const INTERACTIVE = 'input, textarea, button, a, select, video, audio, iframe, label, [contenteditable="true"], [contenteditable="plaintext-only"], .nodrag';
const EDITABLE: ItemType[] = ['note', 'heading', 'link', 'column', 'board', 'image'];
const EDIT_ON_CREATE: ItemType[] = ['note', 'heading', 'link', 'column', 'board'];
const COLORABLE: ItemType[] = ['note', 'heading', 'column', 'board', 'todo', 'table'];
const MIN_W: Partial<Record<ItemType, number>> = { heading: 90, image: 60, video: 120, link: 160, board: 120 };
const TEXT_SIZED: ItemType[] = ['note', 'heading', 'todo', 'table'];
const TEXT_SIZES: [string, number][] = [['S', 12], ['M', 14], ['L', 18], ['XL', 24], ['2XL', 34]];
const MEDIA_SIZED: ItemType[] = ['image', 'video', 'link', 'audio', 'file'];
const MEDIA_SIZES: [string, number][] = [['S', 220], ['M', 380], ['L', 620], ['XL', 960]];

function defaults(type: ItemType): Partial<Item> {
  switch (type) {
    case 'note': return { w: 240, text: '' };
    case 'heading': return { w: 220, text: '', color: 'purple' };
    case 'link': return { w: 320 };
    case 'todo': return { w: 260, title: '', todos: [{ id: uid(), text: '', done: false }] };
    case 'table': return { w: 480, title: '', table: [['', '', ''], ['', '', ''], ['', '', '']] };
    case 'board': return { w: 170 };
    case 'column': return { w: 640, title: '', childIds: [], cols: 0 };
    case 'image': return { w: 320 };
    case 'video': return { w: 440 };
    case 'audio': return { w: 320 };
    default: return { w: 280 };
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && Boolean(el.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]'));

function sameRects(a: Record<string, Rect>, b: Record<string, Rect>) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const r1 = a[k];
    const r2 = b[k];
    if (!r2 || Math.abs(r1.x - r2.x) > 0.5 || Math.abs(r1.y - r2.y) > 0.5 || Math.abs(r1.w - r2.w) > 0.5 || Math.abs(r1.h - r2.h) > 0.5) return false;
  }
  return true;
}

function loadView(id: string): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(`rb-view-${id}`) || 'null');
    return v && typeof v.zoom === 'number' ? v : null;
  } catch { return null; }
}

export function Canvas({ board, change: rawChange, undo, redo, getBoard, boards, me, openBoard, notify, access = 'manage', comments }: Props) {
  const canEdit = access === 'manage' || access === 'edit';
  const canComment = canEdit || access === 'comment';
  // Only editors change cards. Comments are saved separately (see Comments.tsx).
  const change = useCallback((recipe: (b: Board) => Board, key?: string) => {
    if (canEdit) rawChange(recipe, key);
  }, [rawChange, canEdit]);
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingFilePos = useRef<{ x: number; y: number } | null>(null);
  const savedView = useMemo(() => loadView(board.id), [board.id]);
  const needsFit = useRef(!savedView);
  const [view, setView] = useState<View>(savedView || { x: 120, y: 100, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selConn, setSelConn] = useState<string | null>(null);
  const [editing, setEditingId] = useState<string | null>(null);
  const [lineMode, setLineMode] = useState(false);
  const [lineFrom, setLineFrom] = useState<string | null>(null);
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const rectsRef = useRef(rects);
  const [dropTarget, setDropTarget] = useState<{ col: string; index: number } | null>(null);
  const dropRef = useRef(dropTarget);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [linking, setLinking] = useState<{ from: string; side: Side; x: number; y: number } | null>(null);
  // The add menu on the canvas: screen position, board point, and the card a new line starts from.
  const [quickAdd, setQuickAdd] = useState<{ left: number; top: number; at: { x: number; y: number }; from?: { id: string; side: Side } } | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  // A line waiting for the card that a file picker / upload will create.
  const pendingConnect = useRef<{ id: string; side: Side } | null>(null);
  const isTeamHere = access === 'manage';
  // Dragging one end of a selected line to re-attach it.
  const [reattach, setReattach] = useState<{ conn: string; end: 'from' | 'to'; x: number; y: number } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [cursors, setCursors] = useState<Record<string, { name: string; x: number; y: number; at: number }>>({});
  const cascade = useRef(0);

  const items = board.items;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // ---------- coordinates ----------
  const toWorld = useCallback((cx: number, cy: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
  }, []);

  const viewportCenter = useCallback(() => {
    const r = rootRef.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2.4);
  }, [toWorld]);

  /** Nearest spot to `c` (spiralling outwards) where a w×h card doesn't overlap an existing card. */
  const freeSpot = useCallback((c: { x: number; y: number }, w: number, h = 140) => {
    const taken = Object.values(rectsRef.current);
    const fits = (x: number, y: number) =>
      !taken.some((r) => x - 16 < r.x + r.w && x + w + 16 > r.x && y - 16 < r.y + r.h && y + h + 16 > r.y);
    const step = 48;
    for (let ring = 0; ring < 14; ring++) {
      for (let i = -ring; i <= ring; i++) {
        for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
          const x = c.x - w / 2 + dx * step;
          const y = c.y - 30 + dy * step;
          if (fits(x, y)) return { x: x + w / 2, y: y + 30 };
        }
      }
    }
    const off = (cascade.current++ % 6) * 24;
    return { x: c.x + off, y: c.y + off };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(`rb-view-${board.id}`, JSON.stringify(view)); } catch { /* storage unavailable */ }
    }, 300);
    return () => clearTimeout(t);
  }, [view, board.id]);

  // ---------- measuring card sizes (for lines, columns, selection bar) ----------
  const measure = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const wr = world.getBoundingClientRect();
    const z = viewRef.current.zoom;
    const next: Record<string, Rect> = {};
    world.querySelectorAll<HTMLElement>('[data-item-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      next[el.dataset.itemId!] = { x: (r.left - wr.left) / z, y: (r.top - wr.top) / z, w: r.width / z, h: r.height / z };
    });
    if (!sameRects(rectsRef.current, next)) {
      rectsRef.current = next;
      setRects(next);
    }
  }, []);

  const observer = useMemo(() => new ResizeObserver(() => measure()), [measure]);
  useEffect(() => () => observer.disconnect(), [observer]);
  useLayoutEffect(() => {
    measure();
    worldRef.current?.querySelectorAll('[data-item-id]').forEach((el) => observer.observe(el));
  });

  const fit = useCallback(() => {
    const all = Object.values(rectsRef.current);
    const root = rootRef.current;
    if (!root) return;
    if (!all.length) { setView({ x: 120, y: 100, zoom: 1 }); return; }
    const x0 = Math.min(...all.map((r) => r.x));
    const y0 = Math.min(...all.map((r) => r.y));
    const x1 = Math.max(...all.map((r) => r.x + r.w));
    const y1 = Math.max(...all.map((r) => r.y + r.h));
    const { width, height } = root.getBoundingClientRect();
    const zoom = clamp(Math.min((width - 200) / (x1 - x0), (height - 120) / (y1 - y0)), MIN_ZOOM, 1);
    setView({ zoom, x: (width - (x1 - x0) * zoom) / 2 - x0 * zoom + 40, y: (height - (y1 - y0) * zoom) / 2 - y0 * zoom });
  }, []);

  // The comments panel asks to show a thread: bring its pin into view, leaving room for the popover.
  const focusN = comments?.ui.focus ?? 0;
  useEffect(() => {
    const t = comments?.ui.openId ? board.threads?.[comments.ui.openId] : null;
    const root = rootRef.current;
    if (!focusN || !t || !root) return;
    needsFit.current = false;
    const p = pinPoint(t, rectsRef.current);
    const { width, height } = root.getBoundingClientRect();
    const zoom = Math.max(viewRef.current.zoom, 0.8);
    setView({ zoom, x: width * 0.38 - p.x * zoom, y: height * 0.45 - p.y * zoom });
  }, [focusN]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A new pin at this board point attaches to the smallest card under it, if any. */
  const placeAt = useCallback((p: { x: number; y: number }): Place => {
    let best: string | null = null;
    let area = Infinity;
    for (const [id, r] of Object.entries(rectsRef.current)) {
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h && r.w * r.h < area) { best = id; area = r.w * r.h; }
    }
    const place: Place = { x: Math.round(p.x), y: Math.round(p.y) };
    if (best) {
      const r = rectsRef.current[best];
      Object.assign(place, { itemId: best, dx: Math.round(p.x - r.x), dy: Math.round(p.y - r.y) });
    }
    return place;
  }, []);

  // The canvas's own size (it shrinks when the comments panel opens), for placing popovers.
  const [size, setSize] = useState({ width: 1200, height: 800 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const commentMode = Boolean(comments?.ui.mode && canComment);
  const setCommentUi = comments?.setUi;
  const toggleCommentMode = useCallback(() => {
    setCommentUi?.((u) => ({ ...u, mode: !u.mode, draft: null, panel: u.mode ? u.panel : true }));
  }, [setCommentUi]);

  useEffect(() => {
    if (needsFit.current && Object.keys(rects).length) {
      needsFit.current = false;
      fit();
    }
  }, [rects, fit]);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    setView((v) => {
      const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const px = cx - r.left;
      const py = cy - r.top;
      return { zoom, x: px - (px - v.x) * (zoom / v.zoom), y: py - (py - v.y) * (zoom / v.zoom) };
    });
  }, []);

  const zoomCenter = (factor: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  };

  // Wheel: scroll pans, ctrl/cmd + scroll (and trackpad pinch) zooms.
  useEffect(() => {
    const el = rootRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) && (e.target as HTMLElement).closest?.('.wheel-scroll')) return; // scrolling a comment thread
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-clamp(e.deltaY * k, -30, 30) * 0.01));
      else setView((v) => ({ ...v, x: v.x - e.deltaX * k, y: v.y - e.deltaY * k }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ---------- mutations ----------
  const updateItem = useCallback((id: string, partial: Partial<Item>, key?: string) => {
    change((b) => (b.items[id] ? { ...b, items: { ...b.items, [id]: { ...b.items[id], ...partial } } } : b), key);
  }, [change]);

  const setEditing = useCallback((id: string, on: boolean) => {
    setEditingId((cur) => (on ? id : cur === id ? null : cur));
  }, []);

  const addItem = useCallback((type: ItemType, at?: { x: number; y: number }, extra: Partial<Item> = {}) => {
    const b = getBoard();
    if (!b) return '';
    const base = defaults(type);
    const w = extra.w ?? base.w ?? 260;
    const pos = at ?? freeSpot(viewportCenter(), w);
    const item: Item = {
      id: uid(), type, x: Math.round(pos.x - w / 2), y: Math.round(pos.y - 30), z: maxZ(b.items) + 1,
      createdBy: me, createdAt: Date.now(), ...base, ...extra, w,
    };
    change((bb) => ({ ...bb, items: { ...bb.items, [item.id]: item } }));
    setSelection(new Set([item.id]));
    setSelConn(null);
    setEditingId(EDIT_ON_CREATE.includes(type) ? item.id : null);
    return item.id;
  }, [change, freeSpot, getBoard, me, viewportCenter]);

  const addBoard = useCallback(async (at?: { x: number; y: number }) => {
    const pos = at ?? freeSpot(viewportCenter(), 170);
    try {
      const nb = await api.createBoard('Untitled board', board.id);
      return addItem('board', pos, { boardId: nb.id });
    } catch (err) {
      notify((err as Error).message);
      return '';
    }
  }, [addItem, board.id, freeSpot, notify, viewportCenter]);

  const addFiles = useCallback((files: File[], at?: { x: number; y: number }) => {
    const origin = at ?? freeSpot(viewportCenter(), 360, 260);
    // Lay multiple files out side by side, four per row.
    let x = origin.x;
    let y = origin.y;
    files.forEach((file, i) => {
      const type = kindForMime(file.type, file.name);
      const w = defaults(type).w ?? 280;
      if (i && i % 4 === 0) { x = origin.x; y += 300; }
      const id = addItem(type, { x: x + w / 2, y }, {
        uploading: true, fileName: file.name, size: file.size, mime: file.type,
      });
      x += w + 24;
      if (i === 0 && pendingConnect.current) {
        const from = pendingConnect.current;
        pendingConnect.current = null;
        setTimeout(() => addConnection(from.id, id, from.side), 0);
      }
      setUploads((u) => ({ ...u, [id]: 0 }));
      api.upload(file, (p) => setUploads((u) => ({ ...u, [id]: p })), board.id)
        .then((r) => updateItem(id, { uploading: false, url: r.url, size: r.size, mime: r.mime, fileName: r.name }))
        .catch((err) => {
          notify(`${file.name}: ${err.message}`);
          change((b) => { const next = { ...b.items }; delete next[id]; return { ...b, items: next }; });
        })
        .finally(() => setUploads((u) => { const n = { ...u }; delete n[id]; return n; }));
    });
  }, [addItem, board.id, change, freeSpot, notify, updateItem, viewportCenter]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Bring in an image/GIF/video from the web by its original address, so GIFs stay animated.
   * Falls back to the still image the browser offered (if any), or to a link card.
   */
  const importFromWeb = useCallback((url: string, at?: { x: number; y: number }, fallback?: File) => {
    // Our own files (copied from another board) need no import.
    if (url.startsWith(`${location.origin}/uploads/`)) {
      const own = addItem('image', at, { url: url.slice(location.origin.length) });
      setEditingId(null);
      return own;
    }
    const pos = at ?? freeSpot(viewportCenter(), 360, 260);
    const looksVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
    const id = addItem(looksVideo ? 'video' : 'image', pos, { uploading: true, fileName: `Importing from ${new URL(url).hostname.replace(/^www\./, '')}` });
    setEditingId(null);
    const drop = () => change((b) => { const next = { ...b.items }; delete next[id]; return { ...b, items: next }; });
    api.importUrl(url, board.id)
      .then((r) => {
        if (!r.media) {
          drop();
          if (fallback) addFiles([fallback], pos);
          else addItem('link', pos, { url });
          return;
        }
        const type = kindForMime(r.mime, r.name);
        // A GIF that arrives as video (Giphy, Tenor) keeps behaving like a GIF.
        const loop = type === 'video' && !looksVideo;
        updateItem(id, { type, uploading: false, url: r.url, size: r.size, mime: r.mime, fileName: r.name, source: r.sourceUrl, ...(loop ? { loop: true } : {}) });
      })
      .catch((err) => {
        drop();
        if (fallback) addFiles([fallback], pos);
        // The site refused our server (hotlink protection etc.): show it straight from the site.
        else if (/\.(gif|webp|png|jpe?g|avif)(\?|$)/i.test(url)) { addItem('image', pos, { url, source: url }); notify('Couldn’t save a copy, so this image loads from the original site'); }
        else { addItem('link', pos, { url }); notify(err.message); }
      });
    return id;
  }, [addFiles, addItem, board.id, change, freeSpot, notify, updateItem, viewportCenter]);

  const pickFiles = (accept: string, at?: { x: number; y: number }) => {
    pendingFilePos.current = at ?? null;
    const input = fileRef.current!;
    input.accept = accept;
    input.value = '';
    input.click();
  };

  const applyTool = useCallback((tool: Tool, at?: { x: number; y: number }) => {
    if (tool === 'line') {
      setLineMode((m) => !m);
      setLineFrom(null);
      return;
    }
    if (tool === 'comment') {
      setLineMode(false);
      if (at) setCommentUi?.((u) => ({ ...u, mode: true, panel: true, openId: null, draft: placeAt(at) }));
      else toggleCommentMode();
      return;
    }
    setLineMode(false);
    if (tool === 'image') return pickFiles('image/*', at);
    if (tool === 'upload') return pickFiles('', at);
    if (tool === 'board') { addBoard(at); return; }
    addItem(tool, at);
  }, [addBoard, addItem, placeAt, setCommentUi, toggleCommentMode]);

  const addConnection = useCallback((from: string, to: string, fromSide?: Side, toSide?: Side) => {
    if (from === to) return;
    const b = getBoard();
    if (!b) return;
    const exists = Object.values(b.connections).some((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from));
    if (exists) return;
    const conn: Connection = { id: uid(), from, to, shape: 'elbow' };
    if (fromSide) conn.fromSide = fromSide;
    if (toSide) conn.toSide = toSide;
    change((bb) => ({ ...bb, connections: { ...bb.connections, [conn.id]: conn } }));
    setSelConn(conn.id);
    setSelection(new Set());
  }, [change, getBoard]);

  const updateConn = useCallback((id: string, partial: Partial<Connection>, key?: string) => {
    change((b) => (b.connections[id] ? { ...b, connections: { ...b.connections, [id]: { ...b.connections[id], ...partial } } } : b), key);
  }, [change]);

  /** Card under a screen point, and which of its sides the point is nearest to. */
  const cardAt = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-item-id]');
    const id = el?.dataset.itemId;
    if (!id || !rectsRef.current[id]) return null;
    return { id, side: sideForPoint(rectsRef.current[id], toWorld(clientX, clientY)) };
  };

  const deleteSelection = useCallback(() => {
    const b = getBoard();
    if (!b) return;
    const sel = selectionRef.current;
    if (!sel.size) {
      if (selConn) {
        change((bb) => { const c = { ...bb.connections }; delete c[selConn]; return { ...bb, connections: c }; });
        setSelConn(null);
      }
      return;
    }
    const ids = new Set([...sel].filter((id) => b.items[id]));
    const boardCards = [...ids].map((id) => b.items[id]).filter((it) => it.type === 'board' && it.boardId);
    if (boardCards.length) {
      const names = boardCards.map((it) => `“${boards[it.boardId!]?.title || 'Untitled'}”`).join(', ');
      if (!window.confirm(`Delete ${names} and everything inside? This can’t be undone.`)) return;
    }
    change((bb) => {
      const next = { ...bb.items };
      for (const id of ids) {
        const it = next[id];
        if (!it) continue;
        if (it.type === 'column') {
          // Cards inside a deleted column are released onto the board, not deleted.
          for (const cid of it.childIds || []) {
            const child = next[cid];
            if (!child || ids.has(cid)) continue;
            const r = rectsRef.current[cid];
            next[cid] = { ...child, parentId: null, x: Math.round(r?.x ?? it.x), y: Math.round(r?.y ?? it.y), w: Math.round(r?.w ?? child.w) };
          }
        }
        if (it.parentId && next[it.parentId]?.type === 'column') {
          const col = next[it.parentId];
          next[col.id] = { ...col, childIds: (col.childIds || []).filter((x) => x !== id) };
        }
        delete next[id];
      }
      const conns = Object.fromEntries(Object.entries(bb.connections).filter(([, c]) => !ids.has(c.from) && !ids.has(c.to)));
      return { ...bb, items: next, connections: conns };
    });
    for (const it of boardCards) api.deleteBoard(it.boardId!).catch(() => {});
    setSelection(new Set());
    setEditingId(null);
  }, [boards, change, getBoard, selConn]);

  /** Clone cards (and their column children and the lines between them) into this board. */
  const insertClones = useCallback((srcItems: Item[], srcConns: Connection[], offset: { x: number; y: number }) => {
    const b = getBoard();
    if (!b) return;
    const idMap = new Map<string, string>();
    const src = new Map(srcItems.map((it) => [it.id, it]));
    for (const it of srcItems) if (it.type !== 'board') idMap.set(it.id, uid());
    let z = maxZ(b.items);
    const clones: Item[] = [];
    for (const it of srcItems) {
      const nid = idMap.get(it.id);
      if (!nid) continue;
      const inCol = it.parentId && src.has(it.parentId) && idMap.has(it.parentId);
      clones.push({
        ...structuredClone(it),
        id: nid,
        x: inCol ? it.x : Math.round(it.x + offset.x),
        y: inCol ? it.y : Math.round(it.y + offset.y),
        z: ++z,
        parentId: inCol ? idMap.get(it.parentId!) : null,
        childIds: it.childIds?.map((c) => idMap.get(c)).filter((c): c is string => Boolean(c)),
        createdBy: me,
        createdAt: Date.now(),
      });
    }
    const conns: Connection[] = srcConns
      .filter((c) => idMap.has(c.from) && idMap.has(c.to))
      .map((c) => ({ ...c, id: uid(), from: idMap.get(c.from)!, to: idMap.get(c.to)! }));
    change((bb) => ({
      ...bb,
      items: { ...bb.items, ...Object.fromEntries(clones.map((c) => [c.id, c])) },
      connections: { ...bb.connections, ...Object.fromEntries(conns.map((c) => [c.id, c])) },
    }));
    const top = clones.filter((c) => !c.parentId).map((c) => c.id);
    setSelection(new Set(top));
    return top;
  }, [change, getBoard, me]);

  const collectSelection = useCallback(() => {
    const b = getBoard();
    if (!b) return null;
    const ids = new Set<string>();
    for (const id of selectionRef.current) {
      const it = b.items[id];
      if (!it) continue;
      ids.add(id);
      it.childIds?.forEach((c) => b.items[c] && ids.add(c));
    }
    const list = [...ids].map((id) => b.items[id]);
    const conns = Object.values(b.connections).filter((c) => ids.has(c.from) && ids.has(c.to));
    return { items: list, connections: conns };
  }, [getBoard]);

  // ---------- quick-add menu ----------
  const openQuickAdd = useCallback((clientX: number, clientY: number, from?: { id: string; side: Side }) => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const at = toWorld(clientX, clientY);
    setQuickAdd({
      left: clamp(clientX - r.left + 8, 8, r.width - 280),
      top: clamp(clientY - r.top + 8, 8, r.height - 400),
      at,
      from,
    });
    if (isTeamHere) api.templates().then(setTemplates).catch(() => setTemplates([]));
  }, [isTeamHere, toWorld]);

  const closeQuickAdd = useCallback(() => {
    setQuickAdd(null);
    setLinking(null);
  }, []);

  /** Insert a saved template with its top-left corner at a board point. Returns the new top-level card ids. */
  const insertTemplate = useCallback(async (id: string, at: { x: number; y: number }) => {
    try {
      const t = await api.template(id);
      return insertClones(t.items, t.connections, { x: Math.round(at.x), y: Math.round(at.y) }) || [];
    } catch (err) {
      notify((err as Error).message);
      return [];
    }
  }, [insertClones, notify]);

  const pickQuick = useCallback(async (pick: QuickPick) => {
    const q = quickAdd;
    setQuickAdd(null);
    setLinking(null);
    if (!q) return;
    const { from } = q;
    // A card made from a line sits beside the point it was dropped at, facing the line.
    const at = { ...q.at };
    if (from?.side === 'right') at.x += 140;
    if (from?.side === 'left') at.x -= 140;
    if (from?.side === 'bottom') at.y += 30;
    if (from?.side === 'top') at.y -= 120;
    let id = '';
    if (pick.kind === 'tool') {
      const tool = pick.tool;
      if (tool === 'comment' || tool === 'line') { applyTool(tool, q.at); return; }
      if (tool === 'image' || tool === 'upload') {
        pendingConnect.current = from || null;
        pickFiles(tool === 'image' ? 'image/*' : '', at);
        return;
      }
      if (tool === 'board') id = (await addBoard(at)) || '';
      else id = addItem(tool, at);
    } else if (pick.kind === 'link') {
      id = isMediaUrl(pick.url) ? importFromWeb(pick.url, at) || '' : addItem('link', at, { url: pick.url });
      setEditingId(null);
    } else if (pick.kind === 'note') {
      id = addItem('note', at, { text: textToHtml(pick.text) });
      setEditingId(null);
    } else if (pick.kind === 'template') {
      const ids = await insertTemplate(pick.id, from ? at : q.at);
      id = ids[0] || '';
    }
    if (from && id) addConnection(from.id, id, from.side);
  }, [addBoard, addConnection, addItem, applyTool, importFromWeb, insertTemplate, quickAdd]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Save the selection as a template (team only). */
  const saveTemplate = useCallback(async () => {
    const data = collectSelection();
    if (!data?.items.length) return;
    const name = window.prompt('Template name', data.items.length === 1 ? (data.items[0].title || '') : '')?.trim();
    if (name === undefined) return;
    try {
      const t = await api.saveTemplate(name, data.items, data.connections);
      notify(`Saved “${t.name}” in ${t.category}. Press ⇧A on any board to use it.`);
    } catch (err) {
      notify((err as Error).message);
    }
  }, [notify]); // eslint-disable-line react-hooks/exhaustive-deps

  /** ⌘G: put the selected cards into a new group, keeping their reading order. */
  const groupSelection = useCallback(() => {
    const b = getBoard();
    if (!b) return;
    const picked = [...selectionRef.current].map((id) => b.items[id])
      .filter((it): it is Item => Boolean(it) && it.type !== 'column' && !isInColumn(it, b.items) && Boolean(rectsRef.current[it.id]));
    if (!picked.length) { notify('Select some cards first, then press ⌘G'); return; }
    const rs = picked.map((it) => rectsRef.current[it.id]);
    const x0 = Math.min(...rs.map((r) => r.x));
    const y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w));
    const avgW = rs.reduce((s, r) => s + r.w, 0) / rs.length;
    const avgH = rs.reduce((s, r) => s + r.h, 0) / rs.length;
    // Rows: cards whose tops are within half a card of each other; then left to right.
    const rows: Item[][] = [];
    for (const it of [...picked].sort((a, c) => rectsRef.current[a.id].y - rectsRef.current[c.id].y)) {
      const row = rows[rows.length - 1];
      if (row && rectsRef.current[it.id].y - rectsRef.current[row[0].id].y < avgH / 2) row.push(it);
      else rows.push([it]);
    }
    const order = rows.flatMap((row) => row.sort((a, c) => rectsRef.current[a.id].x - rectsRef.current[c.id].x));
    const cols = Math.max(1, Math.min(6, Math.round((x1 - x0) / (avgW + 10))));
    const w = Math.round(Math.max(300, cols * (avgW + 10) + 18));
    const group: Item = {
      id: uid(), type: 'column', title: '', cols, x: Math.round(x0 - 9), y: Math.round(y0 - 46), w,
      z: maxZ(b.items) + 1, childIds: order.map((it) => it.id), createdBy: me, createdAt: Date.now(),
    };
    change((bb) => {
      const next = { ...bb.items, [group.id]: group };
      for (const it of order) next[it.id] = { ...next[it.id], parentId: group.id };
      return { ...bb, items: next };
    });
    setSelection(new Set([group.id]));
    setEditingId(group.id);
  }, [change, getBoard, me, notify]);

  /** ⇧⌘G: release a group's cards where they are and remove the group. */
  const ungroupSelection = useCallback(() => {
    const b = getBoard();
    if (!b) return;
    const groups = [...selectionRef.current].map((id) => b.items[id]).filter((it) => it?.type === 'column');
    if (!groups.length) return;
    const released: string[] = [];
    change((bb) => {
      const next = { ...bb.items };
      let z = maxZ(next);
      for (const g of groups) {
        for (const cid of g.childIds || []) {
          const child = next[cid];
          if (!child) continue;
          const r = rectsRef.current[cid];
          next[cid] = { ...child, parentId: null, x: Math.round(r?.x ?? g.x), y: Math.round(r?.y ?? g.y), w: Math.round(r?.w ?? child.w), z: ++z };
          released.push(cid);
        }
        delete next[g.id];
      }
      const gone = new Set(groups.map((g) => g.id));
      const conns = Object.fromEntries(Object.entries(bb.connections).filter(([, c]) => !gone.has(c.from) && !gone.has(c.to)));
      return { ...bb, items: next, connections: conns };
    });
    setSelection(new Set(released));
  }, [change, getBoard]);

  const duplicate = useCallback(() => {
    const data = collectSelection();
    if (data?.items.length) insertClones(data.items, data.connections, { x: 32, y: 32 });
  }, [collectSelection, insertClones]);

  const bringToFront = useCallback(() => {
    change((b) => {
      let z = maxZ(b.items);
      const next = { ...b.items };
      for (const id of selectionRef.current) if (next[id]) next[id] = { ...next[id], z: ++z };
      return { ...b, items: next };
    });
  }, [change]);

  // ---------- dragging cards ----------
  const onItemPointerDown = (e: React.PointerEvent, item: Item) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (spaceRef.current) { startPan(e); return; }
    const target = e.target as HTMLElement;
    if (commentMode) {
      e.preventDefault();
      setCommentUi?.((u) => ({ ...u, openId: null, draft: placeAt(toWorld(e.clientX, e.clientY)) }));
      return;
    }
    if (lineMode) {
      if (!lineFrom) setLineFrom(item.id);
      else { addConnection(lineFrom, item.id); setLineFrom(null); setLineMode(false); }
      return;
    }
    if (editing === item.id) return;
    if (editing) setEditingId(null);
    setSelConn(null);
    const already = selection.has(item.id);
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const next = new Set(selection);
      if (already) next.delete(item.id); else next.add(item.id);
      setSelection(next);
      return;
    }
    const sel = already ? selection : new Set([item.id]);
    if (!already) setSelection(sel);
    if (target.closest(INTERACTIVE)) return;
    if (!canEdit) return; // viewers and commenters can select and click, but not move things

    const b0 = getBoard()!;
    const child = isInColumn(item, b0.items);
    let ids = child ? [item.id] : [...sel].filter((id) => b0.items[id] && !isInColumn(b0.items[id], b0.items));
    if (!ids.includes(item.id)) ids = [item.id];
    const start = toWorld(e.clientX, e.clientY);
    const sx = e.clientX;
    const sy = e.clientY;
    const key = `drag-${uid()}`;
    let moved = false;
    let origins: Record<string, { x: number; y: number }> = {};
    // Any cards except groups can be dropped into a group, several at once.
    const canDrop = ids.every((id) => b0.items[id]?.type !== 'column');

    const onMove = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        moved = true;
        setDragging(true);
        change((b) => {
          const next = { ...b.items };
          let z = maxZ(next);
          if (child) {
            const r = rectsRef.current[item.id];
            const col = next[item.parentId!];
            next[col.id] = { ...col, childIds: (col.childIds || []).filter((x) => x !== item.id) };
            next[item.id] = { ...next[item.id], parentId: null, x: r?.x ?? start.x, y: r?.y ?? start.y, w: Math.round(r?.w ?? item.w) };
          }
          for (const id of ids) next[id] = { ...next[id], z: ++z };
          origins = Object.fromEntries(ids.map((id) => [id, { x: next[id].x, y: next[id].y }]));
          return { ...b, items: next };
        }, key);
      }
      const p = toWorld(ev.clientX, ev.clientY);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      change((b) => {
        const next = { ...b.items };
        for (const id of ids) if (next[id]) next[id] = { ...next[id], x: Math.round(origins[id].x + dx), y: Math.round(origins[id].y + dy) };
        return { ...b, items: next };
      }, key);

      let target: { col: string; index: number } | null = null;
      if (canDrop) {
        const b = getBoard()!;
        const cols = Object.values(b.items).filter((it) => it.type === 'column' && it.id !== item.id).sort((a, c) => c.z - a.z);
        for (const col of cols) {
          const r = rectsRef.current[col.id];
          if (!r || p.x < r.x || p.x > r.x + r.w || p.y < r.y - 10 || p.y > r.y + r.h + 10) continue;
          const kids = (col.childIds || []).filter((c) => !ids.includes(c) && rectsRef.current[c]);
          // Reading order in the grid: rows above the pointer, then cards to its left in the same row.
          const index = kids.filter((c) => {
            const cr = rectsRef.current[c];
            if (cr.y + cr.h < p.y) return true;
            return cr.y <= p.y && cr.x + cr.w / 2 < p.x;
          }).length;
          target = { col: col.id, index };
          break;
        }
      }
      if (target?.col !== dropRef.current?.col || target?.index !== dropRef.current?.index) {
        dropRef.current = target;
        setDropTarget(target);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragging(false);
      const t = dropRef.current;
      dropRef.current = null;
      setDropTarget(null);
      if (moved && t) {
        change((b) => {
          const col = b.items[t.col];
          if (!col) return b;
          const moving = ids.filter((id) => b.items[id]).sort((a, c) => (b.items[a].y - b.items[c].y) || (b.items[a].x - b.items[c].x));
          const kids = (col.childIds || []).filter((x) => !moving.includes(x));
          kids.splice(t.index, 0, ...moving);
          const next = { ...b.items, [col.id]: { ...col, childIds: kids } };
          for (const id of moving) next[id] = { ...next[id], parentId: col.id };
          return { ...b, items: next };
        }, key);
        setSelection(new Set(ids));
      }
      if (!moved && already && ['note', 'heading'].includes(item.type)) setEditingId(item.id);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onItemDoubleClick = (e: React.MouseEvent, item: Item) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    if (item.type === 'board' && item.boardId) openBoard(item.boardId);
    else if (canEdit && EDITABLE.includes(item.type)) setEditingId(item.id);
  };

  /** Resize from the right edge/corner, or from the left edge (which also moves the card). */
  const startResize = (e: React.PointerEvent, item: Item, side: 'left' | 'right' = 'right') => {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const w0 = item.w;
    const x0 = item.x;
    const key = `resize-${uid()}`;
    const min = MIN_W[item.type] ?? 160;
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      const d = (ev.clientX - sx) / viewRef.current.zoom;
      const w = Math.round(clamp(side === 'left' ? w0 - d : w0 + d, min, 4000));
      updateItem(item.id, side === 'left' ? { w, x: Math.round(x0 + w0 - w) } : { w }, key);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startLinking = (e: React.PointerEvent, item: Item, side: Side) => {
    e.stopPropagation();
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    setLinking({ from: item.id, side, ...p });
    setDragging(true);
    const onMove = (ev: PointerEvent) => setLinking({ from: item.id, side, ...toWorld(ev.clientX, ev.clientY) });
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragging(false);
      const hit = cardAt(ev.clientX, ev.clientY);
      if (hit) { setLinking(null); addConnection(item.id, hit.id, side, hit.side); return; }
      // Dropped on empty board: offer to add a card there, connected to this one.
      const moved = Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 24;
      if (!moved || !canEdit) { setLinking(null); return; }
      openQuickAdd(ev.clientX, ev.clientY, { id: item.id, side });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startReattach = (e: React.PointerEvent, c: Connection, end: 'from' | 'to') => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(true);
    setReattach({ conn: c.id, end, ...toWorld(e.clientX, e.clientY) });
    const onMove = (ev: PointerEvent) => setReattach({ conn: c.id, end, ...toWorld(ev.clientX, ev.clientY) });
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setReattach(null);
      setDragging(false);
      const hit = cardAt(ev.clientX, ev.clientY);
      const other = end === 'from' ? c.to : c.from;
      if (!hit || hit.id === other) return;
      updateConn(c.id, end === 'from'
        ? { from: hit.id, fromSide: hit.side, fromShift: undefined, bend: undefined }
        : { to: hit.id, toSide: hit.side, toShift: undefined, bend: undefined });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** Drag any segment of an elbow line: the middle one sets `bend`, end segments slide along their card. */
  const startSegment = (e: React.PointerEvent, c: Connection, h: SegmentHandle) => {
    e.stopPropagation();
    e.preventDefault();
    const key = `seg-${uid()}`;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      // Only enter drag mode once the pointer moves, so a double-click to reset still lands on the handle.
      if (!moved) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
        moved = true;
        setDragging(true);
      }
      const p = toWorld(ev.clientX, ev.clientY);
      const v = h.axis === 'x' ? p.x : p.y;
      if (h.kind === 'mid') {
        updateConn(c.id, { bend: clamp((v - h.from!) / (h.to! - h.from!), -3, 4) }, key);
      } else {
        let shift = Math.round(v - h.origin!);
        if (Math.abs(shift) < 6) shift = 0; // snap back to the centre of the side
        updateConn(c.id, h.kind === 'from' ? { fromShift: shift || undefined } : { toShift: shift || undefined }, key);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startPan = (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const v0 = viewRef.current;
    setDragging(true);
    const onMove = (ev: PointerEvent) => setView({ ...v0, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy });
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ---------- background: select / pan ----------
  // Figma-style: drag selects; middle mouse or space + drag pans (scroll / trackpad also pans).
  const onBgPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) { startPan(e); return; }
    if (e.button !== 0) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (commentMode) {
      e.preventDefault();
      setCommentUi?.((u) => ({ ...u, openId: null, draft: placeAt(toWorld(e.clientX, e.clientY)) }));
      return;
    }
    if (comments?.ui.openId || comments?.ui.draft) setCommentUi?.((u) => ({ ...u, openId: null, draft: null }));
    setEditingId(null);
    setSelConn(null);
    if (lineMode) setLineFrom(null);
    const sx = e.clientX;
    const sy = e.clientY;
    const start = toWorld(sx, sy);
    const base = e.shiftKey ? new Set(selection) : new Set<string>();
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      moved = true;
      const p = toWorld(ev.clientX, ev.clientY);
      const m = { x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      setMarquee(m);
      const b = getBoard()!;
      const hit = new Set(base);
      for (const it of Object.values(b.items)) {
        if (isInColumn(it, b.items)) continue;
        const r = rectsRef.current[it.id];
        if (r && r.x < m.x + m.w && r.x + r.w > m.x && r.y < m.y + m.h && r.y + r.h > m.y) hit.add(it.id);
      }
      setSelection(hit);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMarquee(null);
      if (!moved && !e.shiftKey) setSelection(new Set());
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Hold space to pan.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return;
      e.preventDefault();
      if (!spaceRef.current) { spaceRef.current = true; setSpaceHeld(true); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (!isTyping(e.target)) e.preventDefault();
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    const reset = () => { spaceRef.current = false; setSpaceHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const onBgDoubleClick = (e: React.MouseEvent) => {
    if (!canEdit) return;
    if (e.target !== rootRef.current && !(e.target as HTMLElement).classList.contains('world')) return;
    addItem('note', toWorld(e.clientX, e.clientY + 30));
  };

  // ---------- drag & drop from toolbar / desktop ----------
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    const p = toWorld(e.clientX, e.clientY);
    const tool = e.dataTransfer.getData(TOOL_MIME) as Tool;
    if (tool) { applyTool(tool, p); return; }
    const files = [...e.dataTransfer.files];
    // Dragged from a website: use the original image (keeps GIFs animated).
    const webImage = imageFromHtml(e.dataTransfer.getData('text/html'));
    if (webImage) { importFromWeb(webImage, p, files[0]); return; }
    if (files.length) { addFiles(files, p); return; }
    const uri = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split('\n')[0]?.trim();
    if (uri && isUrl(uri) && isMediaUrl(uri)) importFromWeb(uri, p);
    else if (uri && isUrl(uri)) addItem('link', p, { url: uri });
    else if (uri) addItem('note', p, { text: textToHtml(uri) });
  };

  // ---------- clipboard ----------
  useEffect(() => {
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (isTyping(e.target) || isTyping(document.activeElement)) return;
      const data = collectSelection();
      if (!data?.items.length) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', CLIP_PREFIX + JSON.stringify(data));
      if (cut) deleteSelection();
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const paste = (e: ClipboardEvent) => {
      if (!canEdit || isTyping(e.target) || isTyping(document.activeElement)) return;
      const files = [...(e.clipboardData?.files || [])];
      // "Copy image" on a website puts a still PNG on the clipboard, plus HTML pointing at the
      // original. Import the original so GIFs and WebPs stay animated; the PNG is the fallback.
      const webImage = imageFromHtml(e.clipboardData?.getData('text/html') || '');
      if (webImage) { e.preventDefault(); importFromWeb(webImage, undefined, files[0]); return; }
      if (files.length) { e.preventDefault(); addFiles(files); return; }
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (!text) return;
      e.preventDefault();
      if (text.startsWith(CLIP_PREFIX)) {
        try {
          const data = JSON.parse(text.slice(CLIP_PREFIX.length)) as { items: Item[]; connections: Connection[] };
          const free = data.items.filter((it) => !it.parentId || !data.items.some((p) => p.id === it.parentId));
          const x0 = Math.min(...free.map((it) => it.x));
          const y0 = Math.min(...free.map((it) => it.y));
          const c = viewportCenter();
          insertClones(data.items, data.connections, { x: c.x - x0 - 120, y: c.y - y0 - 60 });
        } catch { notify('Could not paste those cards'); }
        return;
      }
      if (isUrl(text) && isMediaUrl(text)) importFromWeb(text);
      else if (isUrl(text)) addItem('link', undefined, { url: text });
      else addItem('note', undefined, { text: textToHtml(text) });
      setEditingId(null);
    };
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', paste);
    };
  }, [addFiles, addItem, collectSelection, deleteSelection, importFromWeb, insertClones, notify, viewportCenter]);

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTyping(e.target);
      const key = e.key.toLowerCase();
      if (!canEdit && mod && (key === 'z' || key === 'y')) return;
      if (mod && key === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && key === 'y' && !typing) { e.preventDefault(); redo(); return; }
      if (typing) return;
      if (document.querySelector('.modal')) return;
      if (key === 'escape') {
        setSelection(new Set()); setSelConn(null); setLineMode(false); setLineFrom(null);
        setCommentUi?.((u) => (u.draft ? { ...u, draft: null } : u.openId ? { ...u, openId: null } : { ...u, mode: false }));
        return;
      }
      if (canComment && comments && !mod && key === 'm') { e.preventDefault(); toggleCommentMode(); return; } // M = comment mode
      if (!canEdit) return;
      if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteSelection(); return; }
      if (mod && key === 'd') { e.preventDefault(); duplicate(); return; }
      if (e.shiftKey && !mod && key === 'a') {
        e.preventDefault();
        const r = rootRef.current!.getBoundingClientRect();
        const p = lastPointer.current;
        const inside = p && p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
        openQuickAdd(inside ? p.x : r.left + r.width / 2, inside ? p.y : r.top + r.height / 2);
        return;
      }
      if (mod && key === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection(); return; }
      if (mod && key === 'a') {
        e.preventDefault();
        const b = getBoard()!;
        setSelection(new Set(Object.values(b.items).filter((it) => !isInColumn(it, b.items)).map((it) => it.id)));
        return;
      }
      if (mod && (key === '=' || key === '+')) { e.preventDefault(); zoomCenter(1.2); return; }
      if (mod && key === '-') { e.preventDefault(); zoomCenter(1 / 1.2); return; }
      if (mod && key === '0') { e.preventDefault(); setView((v) => ({ ...v, zoom: 1 })); return; }
      if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fit(); return; }
      if (key === 'enter' && selectionRef.current.size === 1) {
        const id = [...selectionRef.current][0];
        const it = getBoard()!.items[id];
        if (it && EDITABLE.includes(it.type)) { e.preventDefault(); setEditingId(id); }
        return;
      }
      if (key.startsWith('arrow') && selectionRef.current.size) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        change((b) => {
          const next = { ...b.items };
          for (const id of selectionRef.current) if (next[id] && !isInColumn(next[id], next)) next[id] = { ...next[id], x: next[id].x + dx, y: next[id].y + dy };
          return { ...b, items: next };
        }, 'nudge');
        return;
      }
      if (mod || e.altKey) return;
      const shortcuts: Record<string, Tool> = { n: 'note', h: 'heading', l: 'link', t: 'todo', c: 'line', b: 'board' };
      if (shortcuts[key]) { e.preventDefault(); applyTool(shortcuts[key]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- live cursors ----------
  const lastCursor = useRef(0);
  const onPointerMove = (e: React.PointerEvent) => {
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const now = performance.now();
    if (now - lastCursor.current < 60) return;
    lastCursor.current = now;
    const p = toWorld(e.clientX, e.clientY);
    socket.send({ t: 'cursor', x: Math.round(p.x), y: Math.round(p.y) });
  };
  useEffect(() => {
    const off = socket.on((msg) => {
      if (msg.t === 'cursor') setCursors((c) => ({ ...c, [msg.clientId]: { name: msg.name, x: msg.x, y: msg.y, at: Date.now() } }));
    });
    const timer = setInterval(() => {
      setCursors((c) => {
        const fresh = Object.fromEntries(Object.entries(c).filter(([, v]) => Date.now() - v.at < 8000));
        return Object.keys(fresh).length === Object.keys(c).length ? c : fresh;
      });
    }, 2000);
    return () => { off(); clearInterval(timer); };
  }, []);

  // ---------- rendering ----------
  const renderCard = (item: Item, inColumn: boolean): ReactNode => {
    const selected = selection.has(item.id);
    const isEditing = editing === item.id;
    const single = selected && selection.size === 1;
    return (
      <div
        key={item.id}
        data-item-id={item.id}
        className={[
          'card', `card-${item.type}`,
          selected && 'is-selected', isEditing && 'is-editing', inColumn && 'in-column',
          lineFrom === item.id && 'is-line-source',
        ].filter(Boolean).join(' ')}
        style={inColumn ? (item.fontSize ? { fontSize: item.fontSize } : undefined) : { left: item.x, top: item.y, width: item.w, zIndex: item.z, ...(item.fontSize ? { fontSize: item.fontSize } : {}) }}
        onPointerDown={(e) => onItemPointerDown(e, item)}
        onDoubleClick={(e) => onItemDoubleClick(e, item)}
      >
        <ItemBody
          item={item}
          selected={selected}
          editing={isEditing}
          update={(partial, key) => updateItem(item.id, partial, key)}
          setEditing={(on) => setEditing(item.id, on)}
        />
        {canEdit && single && !inColumn && !dragging && (
          <div className="resize-handle" title="Drag to resize" onPointerDown={(e) => startResize(e, item)} />
        )}
        {canEdit && !inColumn && !dragging && (item.type === 'column' || single) && (
          <>
            <div className="edge-handle is-left" title="Drag to resize the group" onPointerDown={(e) => startResize(e, item, 'left')} />
            <div className="edge-handle is-right" title="Drag to resize the group" onPointerDown={(e) => startResize(e, item, 'right')} />
          </>
        )}
        {canEdit && single && !dragging && !isEditing && SIDES.map((side) => (
          <div
            key={side}
            className={`connect-handle is-${side}`}
            title="Drag onto another card to connect"
            onPointerDown={(e) => startLinking(e, item, side)}
          />
        ))}
      </div>
    );
  };

  const ctx: CanvasCtx = {
    me,
    items,
    boards,
    uploadProgress: uploads,
    dropTarget,
    openBoard,
    renameBoard: (id, title) => { api.patchBoard(id, { title }).catch((err) => notify(err.message)); },
    renderChild: (child) => renderCard(child, true),
  };

  const free = Object.values(items).filter((it) => !isInColumn(it, items)).sort((a, b) => a.z - b.z);

  // Floating bar above the current selection
  const selBox = (() => {
    const rs = [...selection].map((id) => rects[id]).filter(Boolean);
    if (!rs.length) return null;
    const x0 = Math.min(...rs.map((r) => r.x));
    const y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w));
    const y1 = Math.max(...rs.map((r) => r.y + r.h));
    const cx = ((x0 + x1) / 2) * view.zoom + view.x;
    const top = y0 * view.zoom + view.y;
    const bottom = y1 * view.zoom + view.y;
    return top > 90 ? { left: cx, top: top - 32, below: false } : { left: cx, top: bottom + 32, below: true };
  })();

  const selItems = [...selection].map((id) => items[id]).filter(Boolean);
  const single = selItems.length === 1 ? selItems[0] : null;
  const editingItem = editing ? items[editing] : null;

  const exec = (cmd: string, arg?: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.execCommand(cmd, false, arg);
  };

  const conn = selConn ? board.connections[selConn] : null;
  const connectionPaths = Object.values(board.connections).map((c) => {
    let a = rects[c.from];
    let b = rects[c.to];
    let shown = c;
    // While an end is being dragged, draw that end at the pointer.
    if (reattach?.conn === c.id) {
      const pt = { x: reattach.x, y: reattach.y, w: 0, h: 0 };
      if (reattach.end === 'from') { a = pt; shown = { ...c, fromSide: undefined, fromShift: undefined, bend: undefined }; }
      else { b = pt; shown = { ...c, toSide: undefined, toShift: undefined, bend: undefined }; }
    }
    if (!a || !b) return null;
    return { c, r: route(shown, a, b) };
  }).filter(Boolean) as { c: Connection; r: ReturnType<typeof route> }[];

  const selPath = conn ? connectionPaths.find((p) => p.c.id === conn.id) : null;
  const connBar = selPath && !dragging ? (() => {
    const top = Math.min(selPath.r.start.y, selPath.r.end.y, selPath.r.mid.y);
    return { x: selPath.r.mid.x * view.zoom + view.x, y: top * view.zoom + view.y - 18 };
  })() : null;

  return (
    <CanvasContext.Provider value={ctx}>
      <div
        ref={rootRef}
        className={`canvas ${dragging ? 'is-dragging' : ''} ${lineMode ? 'is-line-mode' : ''} ${commentMode ? 'is-comment-mode' : ''} ${spaceHeld ? 'is-space' : ''} ${canEdit ? '' : `is-readonly is-${access}`}`}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px` }}
        onPointerDown={onBgPointerDown}
        onPointerMove={onPointerMove}
        onDoubleClick={onBgDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div ref={worldRef} className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <svg className="connections" width="1" height="1">
            {connectionPaths.map(({ c, r }) => {
              const selected = selConn === c.id;
              const w = STROKE[c.weight || 1] + (selected ? 0.6 : 0);
              const stroke = selected ? 'var(--accent)' : c.color ? color(c.color, 'solid') : 'var(--line)';
              const arrow = c.arrow || 'end';
              return (
                <g key={c.id} className={`conn ${selected ? 'is-selected' : ''}`}>
                  <path
                    className="conn-hit"
                    d={r.d}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || spaceRef.current || !canEdit) return;
                      e.stopPropagation();
                      setSelConn(c.id);
                      setSelection(new Set());
                      setEditingId(null);
                    }}
                  />
                  <path className="conn-line" d={r.d} style={{ stroke, strokeWidth: w, strokeDasharray: c.dash ? `${w * 3.5} ${w * 3}` : undefined }} />
                  {arrow !== 'none' && <path className="conn-line" d={r.endArrow} style={{ stroke, strokeWidth: w }} />}
                  {arrow === 'both' && <path className="conn-line" d={r.startArrow} style={{ stroke, strokeWidth: w }} />}
                </g>
              );
            })}
            {linking && rects[linking.from] && (() => {
              const r = route({ shape: 'elbow', fromSide: linking.side }, rects[linking.from], { x: linking.x, y: linking.y, w: 0, h: 0 });
              return (
                <g className="conn">
                  <path className="conn-line is-temp" d={r.d} />
                  <path className="conn-line is-temp" d={r.endArrow} />
                </g>
              );
            })()}
          </svg>
          {connectionPaths.filter(({ c }) => c.label).map(({ c, r: { mid } }) => (
            <div
              key={c.id}
              className="conn-label"
              style={{ left: mid.x, top: mid.y }}
              onPointerDown={(e) => { e.stopPropagation(); setSelConn(c.id); setSelection(new Set()); }}
            >
              {c.label}
            </div>
          ))}
          {free.map((it) => renderCard(it, false))}
          {selPath && conn && (
            <>
              {(['from', 'to'] as const).map((end) => {
                const p = end === 'from' ? selPath.r.start : selPath.r.end;
                return (
                  <div
                    key={end}
                    className="conn-end"
                    title="Drag to another card or side"
                    style={{ left: p.x, top: p.y, transform: `translate(-50%, -50%) scale(${1 / view.zoom})` }}
                    onPointerDown={(e) => startReattach(e, conn, end)}
                  />
                );
              })}
              {!reattach && selPath.r.handles.map((h) => (
                <div
                  key={h.kind}
                  className={`conn-bend is-${h.axis}`}
                  title="Drag to move this segment · double-click to reset"
                  style={{ left: h.x, top: h.y, transform: `translate(-50%, -50%) scale(${1 / view.zoom})` }}
                  onPointerDown={(e) => startSegment(e, conn, h)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    updateConn(conn.id, h.kind === 'mid' ? { bend: undefined } : h.kind === 'from' ? { fromShift: undefined } : { toShift: undefined });
                  }}
                />
              ))}
            </>
          )}
          {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
          {Object.entries(cursors).map(([id, c]) => (
            <div key={id} className="cursor" style={{ transform: `translate(${c.x}px, ${c.y}px) scale(${1 / view.zoom})` }}>
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M1 1l6 15 2.5-6.5L16 7z" fill="var(--accent)" stroke="#fff" strokeWidth="1.2" /></svg>
              <span>{c.name}</span>
            </div>
          ))}
        </div>

        {!free.length && (
          <div className="empty-hint">
            <b>This board is empty</b>
            <span>{canEdit ? 'Drag cards from the toolbar, double-click to add a note, paste a link, or drop files here.' : 'Nothing has been added here yet.'}</span>
          </div>
        )}

        {lineMode && (
          <div className="mode-banner" onPointerDown={(e) => e.stopPropagation()}>
            {lineFrom ? 'Now click the card to connect to' : 'Click the card where the line starts'}
            <button className="text-btn" onClick={() => { setLineMode(false); setLineFrom(null); }}>Cancel</button>
          </div>
        )}

        {canEdit && selBox && !dragging && (
          <div
            className={`context-bar ${selBox.below ? 'is-below' : ''}`}
            style={{ left: selBox.left, top: selBox.top }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {editingItem?.type === 'note' ? (
              <>
                <button className="icon-btn" title="Bold (⌘B)" onMouseDown={exec('bold')}><IconBold size={16} /></button>
                <button className="icon-btn" title="Italic (⌘I)" onMouseDown={exec('italic')}><IconItalic size={16} /></button>
                <button className="icon-btn" title="Underline (⌘U)" onMouseDown={exec('underline')}><IconUnderline size={16} /></button>
                <button className="icon-btn" title="Strikethrough" onMouseDown={exec('strikeThrough')}><IconStrike size={16} /></button>
                <span className="sep" />
                <button className="icon-btn" title="Heading" onMouseDown={exec('formatBlock', 'h2')}><IconH size={16} /></button>
                <button className="icon-btn" title="Bulleted list" onMouseDown={exec('insertUnorderedList')}><IconList size={16} /></button>
                <button className="icon-btn" title="Numbered list" onMouseDown={exec('insertOrderedList')}><IconOList size={16} /></button>
                <button
                  className="icon-btn"
                  title="Link"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const url = window.prompt('Link URL');
                    if (url) document.execCommand('createLink', false, /^https?:\/\//.test(url) ? url : `https://${url}`);
                  }}
                >
                  <IconLink size={16} />
                </button>
                <button className="text-btn" onMouseDown={exec('removeFormat')}>Clear</button>
              </>
            ) : (
              <>
                {selItems.some((it) => COLORABLE.includes(it.type)) && (
                  <div className="swatches">
                    {Object.entries(COLORS).map(([name, c]) => (
                      <button
                        key={name}
                        className="swatch"
                        title={c.label}
                        style={{ background: name === 'default' ? 'var(--card)' : c.solid }}
                        onClick={() => change((b) => {
                          const next = { ...b.items };
                          for (const it of selItems) if (COLORABLE.includes(it.type)) next[it.id] = { ...next[it.id], color: name === 'default' ? undefined : name };
                          return { ...b, items: next };
                        })}
                      />
                    ))}
                    <span className="sep" />
                  </div>
                )}
                {single?.type === 'column' && (
                  <>
                    <span className="bar-label">Columns</span>
                    <div className="seg compact">
                      {[0, 1, 2, 3, 4].map((n) => (
                        <button
                          key={n}
                          className={(single.cols ?? 1) === n ? 'is-on' : ''}
                          title={n === 0 ? 'Auto: as many as fit; widen the group for more' : `${n} column${n === 1 ? '' : 's'}`}
                          onClick={() => updateItem(single.id, { cols: n })}
                        >
                          {n === 0 ? 'Auto' : n}
                        </button>
                      ))}
                    </div>
                    <button className="text-btn" title="Ungroup (⇧⌘G)" onClick={ungroupSelection}>Ungroup</button>
                    <span className="sep" />
                  </>
                )}
                {!single && selItems.length > 1 && selItems.every((it) => it.type !== 'column') && (
                  <>
                    <button className="text-btn strong" title="Group (⌘G)" onClick={groupSelection}>Group</button>
                    <span className="sep" />
                  </>
                )}
                {selItems.length > 0 && selItems.every((it) => TEXT_SIZED.includes(it.type)) && (
                  <>
                    <span className="bar-label">Text</span>
                    <div className="seg compact">
                      {TEXT_SIZES.map(([label, px]) => (
                        <button
                          key={label}
                          className={(selItems[0].fontSize ?? 14) === px ? 'is-on' : ''}
                          title={`${px}px`}
                          onClick={() => change((b) => {
                            const next = { ...b.items };
                            for (const it of selItems) next[it.id] = { ...next[it.id], fontSize: px === 14 ? undefined : px };
                            return { ...b, items: next };
                          })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <span className="sep" />
                  </>
                )}
                {single && MEDIA_SIZED.includes(single.type) && !isInColumn(single, items) && (
                  <>
                    <span className="bar-label">Size</span>
                    <div className="seg compact">
                      {MEDIA_SIZES.map(([label, w]) => (
                        <button key={label} className={Math.abs(single.w - w) < 2 ? 'is-on' : ''} title={`${w}px wide (or drag the edges)`} onClick={() => updateItem(single.id, { w })}>{label}</button>
                      ))}
                    </div>
                    <span className="sep" />
                  </>
                )}
                {single?.type === 'board' && single.boardId && (
                  <button className="text-btn strong" onClick={() => openBoard(single.boardId!)}>Open</button>
                )}
                {single && EDITABLE.includes(single.type) && single.type !== 'board' && (
                  <button className="icon-btn" title={single.type === 'link' ? 'Change link' : single.type === 'image' ? 'Edit caption' : 'Edit'} onClick={() => setEditingId(single.id)}>
                    <IconEdit size={16} />
                  </button>
                )}
                {single?.type === 'board' && (
                  <button className="icon-btn" title="Rename" onClick={() => setEditingId(single.id)}><IconEdit size={16} /></button>
                )}
                {single?.url && (
                  <a className="icon-btn" title="Open in new tab" href={single.url} target="_blank" rel="noopener noreferrer"><IconExternal size={16} /></a>
                )}
                {isTeamHere && (
                  <button className="icon-btn" title="Save as template" onClick={saveTemplate}><IconTemplate size={16} /></button>
                )}
                <button className="icon-btn" title="Bring to front" onClick={bringToFront}><IconFront size={16} /></button>
                <button className="icon-btn" title="Duplicate (⌘D)" onClick={duplicate}><IconCopy size={16} /></button>
                <button className="icon-btn danger" title="Delete (⌫)" onClick={deleteSelection}><IconTrash size={16} /></button>
              </>
            )}
          </div>
        )}

        {conn && connBar && (
          <div
            className="context-bar conn-bar"
            style={{ left: connBar.x, top: connBar.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <ConnectorToolbar
              key={conn.id}
              conn={conn}
              update={(partial, key) => updateConn(conn.id, partial, key)}
              onDelete={deleteSelection}
            />
          </div>
        )}

        {quickAdd && (
          <QuickAdd
            left={quickAdd.left}
            top={quickAdd.top}
            tools={(['note', 'heading', 'link', 'todo', 'table', 'column', 'board', 'image', 'upload', ...(quickAdd.from || !comments ? [] : ['comment'])] as Tool[])}
            templates={isTeamHere ? templates : null}
            onPick={pickQuick}
            onDeleteTemplate={isTeamHere ? (t) => {
              if (!window.confirm(`Delete the template “${t.name}”? Boards that used it keep their cards.`)) return;
              api.deleteTemplate(t.id).then(() => setTemplates((l) => (l || []).filter((x) => x.id !== t.id))).catch((err) => notify(err.message));
            } : undefined}
            onClose={closeQuickAdd}
          />
        )}

        {comments && (
          <CommentLayer
            {...comments}
            board={board}
            access={access}
            view={view}
            rects={rects}
            size={size}
            toWorld={toWorld}
            placeAt={placeAt}
          />
        )}

        {commentMode && !comments?.ui.draft && (
          <div className="mode-banner" onPointerDown={(e) => e.stopPropagation()}>
            Click anywhere on the board, or on a card, to leave a comment
            <button className="text-btn" onClick={toggleCommentMode}>Done</button>
          </div>
        )}

        <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
          <button className="icon-btn" title="Zoom out (⌘−)" onClick={() => zoomCenter(1 / 1.2)}><IconMinus size={16} /></button>
          <button className="zoom-level" title="Reset to 100% (⌘0)" onClick={() => setView((v) => ({ ...v, zoom: 1 }))}>{Math.round(view.zoom * 100)}%</button>
          <button className="icon-btn" title="Zoom in (⌘+)" onClick={() => zoomCenter(1.2)}><IconPlus size={16} /></button>
          <button className="icon-btn" title="Fit to screen (⇧1)" onClick={fit}><IconFit size={16} /></button>
        </div>
      </div>

      {canEdit && <Toolbar onTool={(t) => applyTool(t)} lineMode={lineMode} commentMode={commentMode} />}
      {!canEdit && canComment && comments && (
        <nav className="toolbar is-compact" onPointerDown={(e) => e.stopPropagation()}>
          <button className={`tool ${commentMode ? 'is-active' : ''}`} title="Comment (M)" onClick={toggleCommentMode}>
            <span className="tool-icon"><IconComment /></span>
            <span className="tool-label">Comment</span>
          </button>
        </nav>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          if (files.length) addFiles(files, pendingFilePos.current ?? undefined);
        }}
      />
    </CanvasContext.Provider>
  );
}
