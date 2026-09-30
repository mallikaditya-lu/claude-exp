import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, socket } from '../api';
import { COLORS, color, isInColumn, isUrl, kindForMime, maxZ, textToHtml, uid } from '../lib';
import { SIDES, STROKE, route, sideForPoint, type SegmentHandle } from '../connectors';
import type { Access, Board, BoardSummary, Connection, Item, ItemType, Rect, Side } from '../types';
import { ConnectorToolbar } from './ConnectorToolbar';
import { CanvasContext, type CanvasCtx } from './CanvasContext';
import { ItemBody } from './items';
import { TOOL_MIME, Toolbar, type Tool } from './Toolbar';
import {
  IconBold, IconCopy, IconExternal, IconFit, IconFront, IconH, IconItalic, IconLink, IconList, IconMinus, IconOList,
  IconPlus, IconStrike, IconTrash, IconUnderline, IconEdit, IconComment,
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
}

interface View { x: number; y: number; zoom: number }

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const CLIP_PREFIX = 'RB_CARDS:';
const INTERACTIVE = 'input, textarea, button, a, select, video, audio, iframe, label, [contenteditable="true"], [contenteditable="plaintext-only"], .nodrag';
const EDITABLE: ItemType[] = ['note', 'heading', 'link', 'column', 'board', 'image'];
const EDIT_ON_CREATE: ItemType[] = ['note', 'heading', 'link', 'column', 'board'];
const COLORABLE: ItemType[] = ['note', 'heading', 'column', 'board', 'todo', 'comment', 'table'];
const MIN_W: Partial<Record<ItemType, number>> = { heading: 90, image: 80, board: 120 };

function defaults(type: ItemType): Partial<Item> {
  switch (type) {
    case 'note': return { w: 240, text: '' };
    case 'heading': return { w: 220, text: '', color: 'purple' };
    case 'link': return { w: 320 };
    case 'todo': return { w: 260, title: '', todos: [{ id: uid(), text: '', done: false }] };
    case 'table': return { w: 480, title: '', table: [['', '', ''], ['', '', ''], ['', '', '']] };
    case 'comment': return { w: 260, comments: [] };
    case 'board': return { w: 170 };
    case 'column': return { w: 300, title: '', childIds: [] };
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

export function Canvas({ board, change: rawChange, undo, redo, getBoard, boards, me, openBoard, notify, access = 'manage' }: Props) {
  const canEdit = access === 'manage' || access === 'edit';
  const canComment = canEdit || access === 'comment';
  // Viewers can't change anything; commenters only add comment cards and write in them.
  const change = useCallback((recipe: (b: Board) => Board, key?: string) => {
    if (canEdit) return rawChange(recipe, key);
    if (!canComment) return;
    rawChange((b) => {
      const next = recipe(b);
      const onlyComments = Object.values(next.items).every((it) => {
        const prev = b.items[it.id];
        if (prev === it) return true;
        if (it.type !== 'comment') return false;
        if (!prev) return true;
        const { comments: _a, ...restA } = it;
        const { comments: _b, ...restB } = prev;
        return JSON.stringify(restA) === JSON.stringify(restB);
      }) && Object.keys(b.items).every((id) => next.items[id]) && next.connections === b.connections && next.title === b.title && next.background === b.background;
      return onlyComments ? next : b;
    }, key);
  }, [rawChange, canEdit, canComment]);
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
      addItem('board', pos, { boardId: nb.id });
    } catch (err) {
      notify((err as Error).message);
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
      setUploads((u) => ({ ...u, [id]: 0 }));
      api.upload(file, (p) => setUploads((u) => ({ ...u, [id]: p })), board.id)
        .then((r) => updateItem(id, { uploading: false, url: r.url, size: r.size, mime: r.mime, fileName: r.name }))
        .catch((err) => {
          notify(`${file.name}: ${err.message}`);
          change((b) => { const next = { ...b.items }; delete next[id]; return { ...b, items: next }; });
        })
        .finally(() => setUploads((u) => { const n = { ...u }; delete n[id]; return n; }));
    });
  }, [addItem, board.id, change, freeSpot, notify, updateItem, viewportCenter]);

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
    setLineMode(false);
    if (tool === 'image') return pickFiles('image/*', at);
    if (tool === 'upload') return pickFiles('', at);
    if (tool === 'board') { addBoard(at); return; }
    addItem(tool, at);
  }, [addBoard, addItem]);

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
    setSelection(new Set(clones.filter((c) => !c.parentId).map((c) => c.id)));
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
    const canDrop = ids.length === 1 && !['column', 'board'].includes(item.type);

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
          const kids = (col.childIds || []).filter((c) => c !== item.id && rectsRef.current[c]);
          const index = kids.filter((c) => { const cr = rectsRef.current[c]; return cr.y + cr.h / 2 < p.y; }).length;
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
          const kids = (col.childIds || []).filter((x) => x !== item.id);
          kids.splice(t.index, 0, item.id);
          return { ...b, items: { ...b.items, [col.id]: { ...col, childIds: kids }, [item.id]: { ...b.items[item.id], parentId: col.id } } };
        }, key);
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

  const startResize = (e: React.PointerEvent, item: Item) => {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const w0 = item.w;
    const key = `resize-${uid()}`;
    const min = MIN_W[item.type] ?? 160;
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      const w = Math.round(clamp(w0 + (ev.clientX - sx) / viewRef.current.zoom, min, 2400));
      updateItem(item.id, { w }, key);
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
      setLinking(null);
      setDragging(false);
      const hit = cardAt(ev.clientX, ev.clientY);
      if (hit) addConnection(item.id, hit.id, side, hit.side);
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
    if (files.length) { addFiles(files, p); return; }
    const uri = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split('\n')[0]?.trim();
    if (uri && isUrl(uri)) addItem('link', p, { url: uri });
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
      if (isUrl(text)) addItem('link', undefined, { url: text });
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
  }, [addFiles, addItem, collectSelection, deleteSelection, insertClones, notify, viewportCenter]);

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
      if (key === 'escape') { setSelection(new Set()); setSelConn(null); setLineMode(false); setLineFrom(null); return; }
      if (!canEdit) {
        if (canComment && !mod && key === 'm') { e.preventDefault(); addItem('comment'); } // M = new comment
        return;
      }
      if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteSelection(); return; }
      if (mod && key === 'd') { e.preventDefault(); duplicate(); return; }
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
        style={inColumn ? undefined : { left: item.x, top: item.y, width: item.w, zIndex: item.z }}
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
        className={`canvas ${dragging ? 'is-dragging' : ''} ${lineMode ? 'is-line-mode' : ''} ${spaceHeld ? 'is-space' : ''} ${canEdit ? '' : `is-readonly is-${access}`}`}
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

        <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
          <button className="icon-btn" title="Zoom out (⌘−)" onClick={() => zoomCenter(1 / 1.2)}><IconMinus size={16} /></button>
          <button className="zoom-level" title="Reset to 100% (⌘0)" onClick={() => setView((v) => ({ ...v, zoom: 1 }))}>{Math.round(view.zoom * 100)}%</button>
          <button className="icon-btn" title="Zoom in (⌘+)" onClick={() => zoomCenter(1.2)}><IconPlus size={16} /></button>
          <button className="icon-btn" title="Fit to screen (⇧1)" onClick={fit}><IconFit size={16} /></button>
        </div>
      </div>

      {canEdit && <Toolbar onTool={(t) => applyTool(t)} lineMode={lineMode} />}
      {!canEdit && canComment && (
        <nav className="toolbar is-compact" onPointerDown={(e) => e.stopPropagation()}>
          <button className="tool" title="Add a comment (M)" onClick={() => addItem('comment')}>
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
