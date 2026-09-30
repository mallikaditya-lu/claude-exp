import { useMemo, useState } from 'react';
import { color } from '../lib';
import type { BoardSummary, Project } from '../types';
import { Avatar } from './items/TextCards';
import { IconBoard, IconChevron, IconFolder, IconHome, IconPlus, IconSearch, IconSidebar, IconUsers } from './icons';

interface Props {
  boards: BoardSummary[];
  projects: Project[];
  current: string | null;
  currentProject: string | null;
  me: string;
  onOpen: (id: string | null) => void;
  onOpenProject: (id: string | null) => void;
  onCreate: (projectId: string | null) => void;
  onCreateProject: () => void;
  onRename: () => void;
  onClose: () => void;
  isTeam: boolean;
  isAdmin: boolean;
  adminOpen: boolean;
  onOpenAdmin: () => void;
  email?: string;
  onSignOut?: () => void;
}

const UNFILED = '__unfiled';

export function Sidebar(props: Props) {
  const { boards, projects, current, currentProject, me, email, onOpen, onOpenProject, onCreate, onCreateProject, onRename, onClose, onSignOut, isTeam, isAdmin, adminOpen, onOpenAdmin } = props;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const byId = useMemo(() => Object.fromEntries(boards.map((b) => [b.id, b])), [boards]);

  const children = useMemo(() => {
    const map: Record<string, BoardSummary[]> = {};
    for (const b of boards) {
      const key = b.parentId || (b.projectId && projects.some((p) => p.id === b.projectId) ? `p:${b.projectId}` : UNFILED);
      (map[key] ||= []).push(b);
    }
    for (const k in map) map[k].sort((a, b) => a.title.localeCompare(b.title));
    return map;
  }, [boards, projects]);

  // Expand the open board's ancestors and project.
  const ancestors = useMemo(() => {
    const set = new Set<string>();
    let cur = current ? byId[current] : undefined;
    if (cur) set.add(cur.projectId ? `p:${cur.projectId}` : UNFILED);
    while (cur?.parentId) { set.add(cur.parentId); cur = byId[cur.parentId]; }
    if (currentProject) set.add(`p:${currentProject}`);
    return set;
  }, [byId, current, currentProject]);

  const isOpen = (key: string) => open[key] ?? ancestors.has(key);
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !isOpen(key) }));

  const matches = q.trim() ? boards.filter((b) => b.title.toLowerCase().includes(q.trim().toLowerCase())) : null;
  const activeProject = currentProject || (current ? byId[current]?.projectId : null) || null;

  const renderBoard = (b: BoardSummary, depth: number) => {
    const kids = children[b.id] || [];
    const expanded = isOpen(b.id);
    return (
      <div key={b.id}>
        <div className={`tree-row ${current === b.id ? 'is-active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
          <button
            className={`tree-toggle ${kids.length ? '' : 'is-hidden'} ${expanded ? 'is-open' : ''}`}
            onClick={() => toggle(b.id)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <IconChevron size={12} />
          </button>
          <button className="tree-label" onClick={() => onOpen(b.id)} title={b.title}>
            <IconBoard size={14} />
            <span>{b.title}</span>
          </button>
        </div>
        {expanded && kids.map((k) => renderBoard(k, depth + 1))}
      </div>
    );
  };

  const renderGroup = (key: string, label: string, dot: string | null, onLabel: () => void, active: boolean) => {
    const kids = children[key] || [];
    const expanded = isOpen(key);
    return (
      <div key={key}>
        <div className={`tree-row project-row ${active ? 'is-active' : ''}`}>
          <button className={`tree-toggle ${expanded ? 'is-open' : ''}`} onClick={() => toggle(key)} aria-label={expanded ? 'Collapse' : 'Expand'}>
            <IconChevron size={12} />
          </button>
          <button className="tree-label" onClick={onLabel} title={label}>
            {dot ? <IconFolder size={15} style={{ color: dot }} /> : <IconFolder size={15} />}
            <span>{label}</span>
          </button>
          <span className="tree-count">{kids.length}</span>
        </div>
        {expanded && (kids.length
          ? kids.map((b) => renderBoard(b, 1))
          : <div className="tree-empty indent">No boards yet</div>)}
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
      <button className={`tree-row home-row ${current || currentProject || adminOpen ? '' : 'is-active'}`} onClick={() => onOpen(null)}>
        <IconHome size={15} /> <span>{isTeam ? 'All boards' : 'Shared with you'}</span>
      </button>
      {isAdmin && (
        <button className={`tree-row home-row ${adminOpen ? 'is-active' : ''}`} onClick={onOpenAdmin}>
          <IconUsers size={15} /> <span>Admin</span>
        </button>
      )}
      <div className="tree">
        {matches ? (
          <>
            {matches.map((b) => (
              <div key={b.id} className={`tree-row ${current === b.id ? 'is-active' : ''}`}>
                <button className="tree-label" onClick={() => onOpen(b.id)}><IconBoard size={14} /><span>{b.title}</span></button>
              </div>
            ))}
            {!matches.length && <div className="tree-empty">No boards match “{q}”</div>}
          </>
        ) : (
          <>
            <div className="tree-heading">
              <span>Projects</span>
              {isTeam && <button className="icon-btn small" title="New project" onClick={onCreateProject}><IconPlus size={14} /></button>}
            </div>
            {projects.map((p) =>
              renderGroup(`p:${p.id}`, p.name, color(p.color, 'solid'), () => onOpenProject(p.id), currentProject === p.id))}
            {!projects.length && (isTeam
              ? <button className="tree-empty link" onClick={onCreateProject}>+ Create your first project</button>
              : <div className="tree-empty">Nothing shared with you yet</div>)}
            {(children[UNFILED] || []).length > 0 && renderGroup(UNFILED, 'No project', null, () => onOpen(null), false)}
          </>
        )}
      </div>
      {(isTeam || (activeProject && ['edit', 'manage'].includes(projects.find((p) => p.id === activeProject)?.myLevel || ''))) && (
        <button className="btn new-board" onClick={() => onCreate(activeProject)}><IconPlus size={15} /> New board</button>
      )}
      <div className="me-row">
        <button className="me" onClick={onRename} title="Change your display name">
          <Avatar name={me} size={24} />
          <span className="me-text">
            <span className="me-name">{me}</span>
            {email && <span className="me-email">{email}</span>}
          </span>
        </button>
        {onSignOut && <button className="text-btn" onClick={onSignOut} title="Sign out">Sign out</button>}
      </div>
    </aside>
  );
}
