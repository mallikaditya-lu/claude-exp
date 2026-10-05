import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  IconBoard, IconColumn, IconComment, IconFolder, IconMore, IconImage, IconLine, IconLink, IconNote, IconTable, IconTodo, IconUpload,
} from './icons';

export type Tool =
  | 'note' | 'heading' | 'link' | 'todo' | 'line' | 'board' | 'column' | 'table' | 'comment' | 'image' | 'upload';

export const TOOL_MIME = 'application/x-rb-tool';

export const TOOLS: { id: Tool; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'note', label: 'Text', icon: <IconNote />, hint: 'Text: paragraph, heading or label; change the style in the selection bar (N, or H for a heading)' },
  { id: 'link', label: 'Link', icon: <IconLink />, hint: 'Web link or embed: YouTube, Spotify, Figma… (L)' },
  { id: 'todo', label: 'To-do', icon: <IconTodo />, hint: 'Checklist (T)' },
  { id: 'line', label: 'Line', icon: <IconLine />, hint: 'Connect two cards (C)' },
  { id: 'board', label: 'Board', icon: <IconBoard />, hint: 'Nested board (B)' },
  { id: 'column', label: 'Group', icon: <IconColumn />, hint: 'Group: cards side by side in a resizable area (select cards and press ⌘G)' },
  { id: 'table', label: 'Table', icon: <IconTable />, hint: 'Table, e.g. a script or shot list' },
  { id: 'comment', label: 'Comment', icon: <IconComment />, hint: 'Comment: click anywhere to pin one (M)' },
  { id: 'image', label: 'Add image', icon: <IconImage />, hint: 'Upload images' },
  { id: 'upload', label: 'Upload', icon: <IconUpload />, hint: 'Upload video, audio, PDFs or any file' },
];

export type DockPosition = 'bottom' | 'left' | 'right' | 'top';
const DOCK_KEY = 'rb-dock';

/** Where this person keeps the toolbar (bottom by default), remembered in this browser. */
export function useDockPosition() {
  const [pos, setPos] = useState<DockPosition>(() => {
    try {
      const v = localStorage.getItem(DOCK_KEY);
      return v === 'left' || v === 'right' || v === 'top' ? v : 'bottom';
    } catch { return 'bottom'; }
  });
  const set = useCallback((p: DockPosition) => {
    setPos(p);
    try { localStorage.setItem(DOCK_KEY, p); } catch { /* storage unavailable */ }
  }, []);
  return [pos, set] as const;
}

/**
 * macOS-dock magnification: icons near the pointer grow (and push their neighbours apart),
 * falling off smoothly with distance.
 */
function useMagnify(vertical: boolean) {
  const ref = useRef<HTMLElement>(null);
  const frame = useRef(0);
  const onMouseMove = (e: React.MouseEvent) => {
    const nav = ref.current;
    if (!nav) return;
    const p = vertical ? e.clientY : e.clientX;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const box = nav.getBoundingClientRect();
      for (const el of nav.querySelectorAll<HTMLElement>('.tool')) {
        const c = vertical ? box.top + el.offsetTop + el.offsetHeight / 2 : box.left + el.offsetLeft + el.offsetWidth / 2;
        const d = Math.abs(p - c);
        const t = Math.max(0, 1 - d / 130);
        el.style.setProperty('--mag', (1 + 0.6 * (t * t * (3 - 2 * t))).toFixed(3));
      }
    });
  };
  const onMouseLeave = () => {
    cancelAnimationFrame(frame.current);
    ref.current?.querySelectorAll<HTMLElement>('.tool').forEach((el) => el.style.setProperty('--mag', '1'));
  };
  return { ref, onMouseMove, onMouseLeave };
}

const POSITIONS: [DockPosition, string][] = [['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right'], ['top', 'Top']];

export function DockPositionMenu({ pos, onChange }: { pos: DockPosition; onChange: (p: DockPosition) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="dock-pos" ref={ref}>
      <button className="dock-pos-btn" title="Move the toolbar" onClick={() => setOpen((o) => !o)}><IconMore size={16} /></button>
      {open && (
        <div className="menu dock-pos-menu">
          <div className="menu-label">Toolbar position</div>
          {POSITIONS.map(([p, label]) => (
            <button key={p} className={`menu-item ${p === pos ? 'is-active' : ''}`} onClick={() => { onChange(p); setOpen(false); }}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toolbar({ onTool, lineMode, commentMode, assetsOpen, onAssets, position, onPosition }: {
  onTool: (t: Tool) => void; lineMode: boolean; commentMode: boolean; assetsOpen: boolean; onAssets: () => void;
  position: DockPosition; onPosition: (p: DockPosition) => void;
}) {
  const mag = useMagnify(position === 'left' || position === 'right');
  return (
    <nav
      ref={mag.ref}
      className={`toolbar dock dock-${position}`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseMove={mag.onMouseMove}
      onMouseLeave={mag.onMouseLeave}
    >
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool ${(t.id === 'line' && lineMode) || (t.id === 'comment' && commentMode) ? 'is-active' : ''}`}
          title={t.hint}
          draggable={t.id !== 'line' && t.id !== 'image' && t.id !== 'upload' && t.id !== 'comment'}
          onDragStart={(e) => {
            e.dataTransfer.setData(TOOL_MIME, t.id);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => onTool(t.id)}
        >
          <span className="tool-icon">{t.icon}</span>
          <span className="tool-label">{t.label}</span>
        </button>
      ))}
      <div className="tool-sep" />
      <button className={`tool ${assetsOpen ? 'is-active' : ''}`} title="Assets: every file added to this board" onClick={onAssets}>
        <span className="tool-icon"><IconFolder /></span>
        <span className="tool-label">Assets</span>
      </button>
      <DockPositionMenu pos={position} onChange={onPosition} />
    </nav>
  );
}
