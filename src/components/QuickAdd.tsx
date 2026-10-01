import { useEffect, useMemo, useRef, useState } from 'react';
import { isUrl } from '../lib';
import { TOOLS, type Tool } from './Toolbar';
import { IconLink, IconNote, IconTrash } from './icons';

// The add menu that opens right on the canvas: drag a line from a card into empty space, or press
// ⇧A (as in Blender). Type to filter; paste a link to add it; type anything else to make a note.

export interface TemplateSummary { id: string; name: string; category: string; count: number }

export type QuickPick =
  | { kind: 'tool'; tool: Tool }
  | { kind: 'link'; url: string }
  | { kind: 'note'; text: string }
  | { kind: 'template'; id: string };

interface Props {
  left: number;
  top: number;
  /** Tools that make sense here (e.g. no Comment when connecting a line). */
  tools: Tool[];
  templates: TemplateSummary[] | null;
  onPick: (p: QuickPick) => void;
  onDeleteTemplate?: (t: TemplateSummary) => void;
  onClose: () => void;
}

const KEYS: Partial<Record<Tool, string>> = { note: 'N', heading: 'H', link: 'L', todo: 'T', board: 'B', comment: 'M' };

export function QuickAdd({ left, top, tools, templates, onPick, onDeleteTemplate, onClose }: Props) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: { key: string; label: string; hint?: string; icon?: React.ReactNode; pick: QuickPick; section?: string; tpl?: TemplateSummary }[] = [];
    if (isUrl(q.trim())) out.push({ key: 'url', label: `Add ${q.trim()}`, icon: <IconLink size={16} />, pick: { kind: 'link', url: q.trim() } });
    for (const t of TOOLS) {
      if (!tools.includes(t.id)) continue;
      if (needle && !t.label.toLowerCase().includes(needle) && !t.id.includes(needle)) continue;
      out.push({ key: t.id, label: t.label, hint: KEYS[t.id], icon: t.icon, pick: { kind: 'tool', tool: t.id } });
    }
    for (const t of templates || []) {
      if (needle && !`${t.name} ${t.category}`.toLowerCase().includes(needle)) continue;
      out.push({ key: `tpl-${t.id}`, label: t.name, hint: `${t.count} card${t.count === 1 ? '' : 's'}`, pick: { kind: 'template', id: t.id }, section: t.category, tpl: t });
    }
    if (needle && !isUrl(q.trim()) && !out.length) out.push({ key: 'note', label: `Note: “${q.trim().slice(0, 40)}”`, icon: <IconNote size={16} />, pick: { kind: 'note', text: q.trim() } });
    return out;
  }, [q, tools, templates]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [onClose]);

  let lastSection = '';
  return (
    <div
      ref={ref}
      className="quick-add"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        value={q}
        placeholder="Add… type to search, or paste a link"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === 'Enter' && rows[active]) { e.preventDefault(); onPick(rows[active].pick); }
        }}
      />
      <div className="quick-list wheel-scroll" ref={listRef}>
        {rows.map((r, i) => {
          const head = r.section && r.section !== lastSection ? r.section : null;
          if (r.section) lastSection = r.section;
          return (
            <div key={r.key}>
              {head && <div className="quick-section">Templates · {head}</div>}
              <div
                className={`quick-row ${i === active ? 'is-active' : ''}`}
                role="button"
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(r.pick)}
              >
                <span className="quick-icon">{r.icon || <span className="tpl-dot" />}</span>
                <span className="quick-label">{r.label}</span>
                {r.hint && <span className="quick-hint">{r.hint}</span>}
                {r.tpl && onDeleteTemplate && (
                  <button
                    className="icon-btn quick-del"
                    title="Delete template"
                    onClick={(e) => { e.stopPropagation(); onDeleteTemplate(r.tpl!); }}
                  >
                    <IconTrash size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!rows.length && <div className="quick-empty">Nothing matches</div>}
        {templates && !templates.length && !q && <div className="quick-empty small">Save cards as a template from the selection bar to see them here.</div>}
      </div>
    </div>
  );
}
