import { useMemo, useState } from 'react';
import type { BoardSummary } from '../types';
import { Avatar } from './items/TextCards';
import { IconBoard, IconChevron, IconHome, IconPlus, IconSearch, IconSidebar } from './icons';

interface Props {
  boards: BoardSummary[];
  current: string | null;
  me: string;
  onOpen: (id: string | null) => void;
  onCreate: (parentId?: string | null) => void;
  onRename: () => void;
  onClose: () => void;
}

export function Sidebar({ boards, current, me, onOpen, onCreate, onRename, onClose }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const children = useMemo(() => {
    const map: Record<string, BoardSummary[]> = {};
    for (const b of boards) (map[b.parentId || 'root'] ||= []).push(b);
    for (const k in map) map[k].sort((a, b) => a.title.localeCompare(b.title));
    return map;
  }, [boards]);

  // Expand ancestors of the open board.
  const ancestors = useMemo(() => {
    const set = new Set<string>();
    const byId = Object.fromEntries(boards.map((b) => [b.id, b]));
    let cur = current ? byId[current] : undefined;
    while (cur?.parentId) { set.add(cur.parentId); cur = byId[cur.parentId]; }
    return set;
  }, [boards, current]);

  const matches = q.trim()
    ? boards.filter((b) => b.title.toLowerCase().includes(q.trim().toLowerCase()))
    : null;

  const renderNode = (b: BoardSummary, depth: number) => {
    const kids = children[b.id] || [];
    const expanded = open[b.id] ?? ancestors.has(b.id);
    return (
      <div key={b.id}>
        <div className={`tree-row ${current === b.id ? 'is-active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
          <button
            className={`tree-toggle ${kids.length ? '' : 'is-hidden'} ${expanded ? 'is-open' : ''}`}
            onClick={() => setOpen((o) => ({ ...o, [b.id]: !expanded }))}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <IconChevron size={12} />
          </button>
          <button className="tree-label" onClick={() => onOpen(b.id)} title={b.title}>
            <IconBoard size={14} />
            <span>{b.title}</span>
          </button>
        </div>
        {expanded && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button className="brand" onClick={() => onOpen(null)}>
          <img src="/favicon.svg" width={22} height={22} alt="" />
          <span>Reference Board</span>
        </button>
        <button className="icon-btn" title="Hide sidebar" onClick={onClose}><IconSidebar size={16} /></button>
      </div>
      <div className="sidebar-search">
        <IconSearch size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a board" />
      </div>
      <button className={`tree-row home-row ${current ? '' : 'is-active'}`} onClick={() => onOpen(null)}>
        <IconHome size={15} /> <span>All boards</span>
      </button>
      <div className="tree">
        {matches
          ? matches.map((b) => (
            <div key={b.id} className={`tree-row ${current === b.id ? 'is-active' : ''}`}>
              <button className="tree-label" onClick={() => onOpen(b.id)}><IconBoard size={14} /><span>{b.title}</span></button>
            </div>
          ))
          : (children.root || []).map((b) => renderNode(b, 0))}
        {matches && !matches.length && <div className="tree-empty">No boards match “{q}”</div>}
      </div>
      <button className="btn new-board" onClick={() => onCreate(null)}><IconPlus size={15} /> New board</button>
      <button className="me" onClick={onRename} title="Change your display name">
        <Avatar name={me} size={24} />
        <span>{me}</span>
      </button>
    </aside>
  );
}
