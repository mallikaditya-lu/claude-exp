import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { COLORS, color, timeAgo } from '../lib';
import type { BoardSummary, Project } from '../types';
import { CoverPicker } from './CoverPicker';
import { IconBoard, IconChevron, IconFolder, IconImage, IconMore, IconPlus, IconSidebar, IconTrash, IconUsers } from './icons';

export const ACCESS_LABEL = { manage: 'Full access', edit: 'Can edit', comment: 'Can comment', view: 'View only' } as const;

interface Props {
  boards: BoardSummary[];
  projects: Project[];
  /** null = overview of everything; otherwise a single project's view. */
  projectId: string | null;
  me: string;
  onOpen: (id: string) => void;
  onOpenProject: (id: string | null) => void;
  onCreate: (projectId: string | null) => void;
  onCreateProject: () => void;
  onMove: (boardId: string, projectId: string | null) => void;
  onDelete: (id: string) => void;
  notify: (msg: string) => void;
  isTeam: boolean;
  onShare: (projectId: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

type CoverTarget = { kind: 'project' | 'board'; id: string } | null;

export function Home(props: Props) {
  const [coverFor, setCoverFor] = useState<CoverTarget>(null);
  return (
    <>
      <HomeInner {...props} onCover={setCoverFor} />
      {coverFor && (() => {
        const p = coverFor.kind === 'project' ? props.projects.find((x) => x.id === coverFor.id) : null;
        const b = coverFor.kind === 'board' ? props.boards.find((x) => x.id === coverFor.id) : null;
        if (!p && !b) return null;
        return (
          <CoverPicker
            title={p ? p.name : b!.title}
            projectId={p ? p.id : b!.projectId}
            current={p ? p.cover || null : b!.cover}
            notify={props.notify}
            onClose={() => setCoverFor(null)}
            onPick={(url) => (p ? api.updateProject(p.id, { cover: url }) : api.patchBoard(b!.id, { cover: url }))}
          />
        );
      })()}
    </>
  );
}

function HomeInner(props: Props & { onCover: (t: CoverTarget) => void }) {
  const { boards, projects, projectId, me, onOpenProject, onCreate, onCreateProject, sidebarOpen, toggleSidebar, isTeam, onShare } = props;
  const project = projectId ? projects.find((p) => p.id === projectId) : null;
  // Top level = boards whose parent this person can't see (for guests invited to a sub-board, that board).
  const visible = new Set(boards.map((b) => b.id));
  const topLevel = boards.filter((b) => !b.parentId || !visible.has(b.parentId)).sort((a, b) => b.updatedAt - a.updatedAt);
  const nestedCount = (id: string) => boards.filter((b) => b.parentId === id).length;

  const tile = (b: BoardSummary) => (
    <BoardTile key={b.id} board={b} {...props} subCount={nestedCount(b.id)} showProject={!projectId} />
  );
  const deleteProject = async (p: Project) => {
    if (!window.confirm(`Move the project “${p.name}” and its boards to the trash? You can restore it from Trash for 30 days.`)) return;
    await api.deleteProject(p.id).then(() => props.notify(`“${p.name}” moved to the trash`)).catch((err) => props.notify(err.message));
    if (projectId === p.id) onOpenProject(null);
  };

  if (projectId && !project) {
    return (
      <div className="home">
        <Topbar sidebarOpen={sidebarOpen} toggleSidebar={toggleSidebar}>
          <button className="crumb" onClick={() => onOpenProject(null)}>All boards</button>
        </Topbar>
        <div className="board-missing">
          <h2>This project doesn’t exist anymore</h2>
          <button className="btn primary" onClick={() => onOpenProject(null)}>Back to all boards</button>
        </div>
      </div>
    );
  }

  // ---------- single project ----------
  if (project) {
    const inProject = topLevel.filter((b) => b.projectId === project.id);
    const canCreate = isTeam || project.myLevel === 'edit' || project.myLevel === 'manage';
    return (
      <div className="home">
        <Topbar
          sidebarOpen={sidebarOpen}
          toggleSidebar={toggleSidebar}
          actions={<>
            {!isTeam && project.myLevel && <span className="access-pill">{ACCESS_LABEL[project.myLevel]}</span>}
            {isTeam && (
              <button className="btn" onClick={() => onShare(project.id)}>
                <IconUsers size={15} /> Share{project.members?.length ? ` · ${project.members.length}` : ''}
              </button>
            )}
            {canCreate && <button className="btn primary" onClick={() => onCreate(project.id)}><IconPlus size={15} /> New board</button>}
          </>}
        >
          <button className="crumb" onClick={() => onOpenProject(null)}>{isTeam ? 'All boards' : 'Shared with you'}</button>
          <IconChevron size={12} />
          <span className="crumb-current">{project.name}</span>
        </Topbar>
        <div className="home-body">
          <ProjectHeader project={project} count={inProject.length} {...props} onDeleteProject={() => deleteProject(project)} />
          <div className="board-grid">
            {inProject.map(tile)}
            {canCreate && (
              <button className="board-tile is-new" onClick={() => onCreate(project.id)}>
                <IconPlus size={26} />
                <span>New board</span>
              </button>
            )}
          </div>
          {!inProject.length && isTeam && (
            <p className="home-hint">Create a board here, or move an existing one in with the ⋯ menu on any board.</p>
          )}
        </div>
      </div>
    );
  }

  // ---------- overview ----------
  const recent = [...boards].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const unfiled = topLevel.filter((b) => !b.projectId || !projects.some((p) => p.id === b.projectId));

  return (
    <div className="home">
      <Topbar
        sidebarOpen={sidebarOpen}
        toggleSidebar={toggleSidebar}
        actions={isTeam ? <>
          <button className="btn" onClick={onCreateProject}><IconFolder size={15} /> New project</button>
          <button className="btn primary" onClick={() => onCreate(null)}><IconPlus size={15} /> New board</button>
        </> : undefined}
      >
        <span className="crumb-current">{isTeam ? 'All boards' : 'Shared with you'}</span>
      </Topbar>
      <div className="home-body">
        <h1 className="home-title">Hi {me.split(' ')[0]} 👋</h1>
        <p className="home-sub">
          {isTeam
            ? 'Collect references, structure research and share it with the team — notes, links, video, music, tables and to-dos on one canvas.'
            : projects.length || unfiled.length
              ? 'These are the projects and boards Little Unusual has shared with you.'
              : 'Nothing has been shared with you yet. When the Little Unusual team invites you to a project or board, it will appear here.'}
        </p>

        {(isTeam || projects.length > 0) && <h2 className="home-h2">{isTeam ? 'Projects' : 'Projects shared with you'}</h2>}
        <div className="project-grid">
          {projects.map((p) => {
            const list = topLevel.filter((b) => b.projectId === p.id);
            const covers = list.map((b) => b.cover).filter(Boolean).slice(0, 3) as string[];
            const updated = Math.max(0, ...list.map((b) => b.updatedAt));
            return (
              <div
                key={p.id}
                className="project-tile"
                role="button"
                tabIndex={0}
                style={{ ['--proj' as string]: color(p.color, 'solid') }}
                onClick={() => onOpenProject(p.id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpenProject(p.id)}
              >
                <div className="project-cover">
                  {p.cover
                    ? <img src={p.cover} alt="" loading="lazy" />
                    : covers.length
                      ? covers.map((c) => <img key={c} src={c} alt="" loading="lazy" />)
                      : <IconFolder size={36} />}
                </div>
                {isTeam && (
                  <TileMenu label="Project options">
                    {(close) => (
                      <>
                        <button className="menu-item" onClick={() => { close(); props.onCover({ kind: 'project', id: p.id }); }}><IconImage size={14} /> Change cover…</button>
                        <div className="menu-sep" />
                        <button className="menu-item danger" onClick={() => { close(); deleteProject(p); }}><IconTrash size={14} /> Delete project</button>
                      </>
                    )}
                  </TileMenu>
                )}
                <div className="board-tile-body">
                  <div className="board-tile-title">{p.name}</div>
                  <div className="board-tile-meta">
                    {list.length} board{list.length === 1 ? '' : 's'}{updated ? ` · ${timeAgo(updated)}` : ''}
                    {isTeam && p.members?.length ? ` · shared with ${p.members.length}` : ''}
                    {!isTeam && p.myLevel ? ` · ${ACCESS_LABEL[p.myLevel].toLowerCase()}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
          {isTeam && (
            <button className="project-tile is-new" onClick={onCreateProject}>
              <IconPlus size={26} />
              <span>New project</span>
            </button>
          )}
        </div>

        {!isTeam && unfiled.length > 0 && (
          <>
            <h2 className="home-h2">Boards shared with you</h2>
            <div className="board-grid">{unfiled.map(tile)}</div>
          </>
        )}

        {recent.length > 0 && (
          <>
            <h2 className="home-h2">Recently updated</h2>
            <div className="board-grid">{recent.map(tile)}</div>
          </>
        )}

        {isTeam && (
          <>
            <h2 className="home-h2">Boards without a project</h2>
            <div className="board-grid">
              {unfiled.map(tile)}
              <button className="board-tile is-new" onClick={() => onCreate(null)}>
                <IconPlus size={26} />
                <span>New board</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Topbar({ children, actions, sidebarOpen, toggleSidebar }: {
  children: React.ReactNode; actions?: React.ReactNode; sidebarOpen: boolean; toggleSidebar: () => void;
}) {
  return (
    <header className="topbar">
      {!sidebarOpen && <button className="icon-btn" title="Show sidebar" onClick={toggleSidebar}><IconSidebar size={18} /></button>}
      <div className="crumbs">{children}</div>
      <div className="grow" />
      {actions}
    </header>
  );
}

/** The ⋯ menu on a tile. */
function TileMenu({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="tile-menu" ref={ref} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button className="icon-btn tile-menu-btn" title={label} onClick={() => setOpen((o) => !o)}><IconMore size={16} /></button>
      {open && <div className="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

function ProjectHeader({ project, count, notify, isTeam, onDeleteProject, onCover }: Props & { project: Project; count: number; onDeleteProject: () => void; onCover: (t: CoverTarget) => void }) {
  const [name, setName] = useState(project.name);
  useEffect(() => setName(project.name), [project.name]);
  const save = (fields: Partial<Project>) => api.updateProject(project.id, fields).catch((err) => notify(err.message));

  return (
    <div className="project-head">
      <span className="project-dot" style={{ background: color(project.color, 'solid') }} />
      <input
        className="project-name"
        readOnly={!isTeam}
        value={name}
        size={Math.max(6, name.length + 1)}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim() || 'Untitled project';
          setName(n);
          if (n !== project.name) save({ name: n });
        }}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
      />
      <span className="project-count">{count} board{count === 1 ? '' : 's'}</span>
      <div className="grow" />
      {isTeam && <div className="swatches">
        {Object.entries(COLORS).filter(([k]) => k !== 'default').map(([k, c]) => (
          <button
            key={k}
            className={`swatch ${project.color === k ? 'is-active' : ''}`}
            title={c.label}
            style={{ background: c.solid }}
            onClick={() => save({ color: k })}
          />
        ))}
      </div>}
      {isTeam && (
        <button className="btn" title="Choose this project’s cover image" onClick={() => onCover({ kind: 'project', id: project.id })}>
          <IconImage size={15} /> Cover
        </button>
      )}
      {isTeam && (
        <button className="icon-btn danger" title="Delete project (to the trash, restorable for 30 days)" onClick={onDeleteProject}>
          <IconTrash size={16} />
        </button>
      )}
    </div>
  );
}

function BoardTile({ board: b, projects, subCount, showProject, onOpen, onOpenProject, onMove, onDelete, isTeam, onCover }: Props & { board: BoardSummary; subCount: number; showProject: boolean; onCover: (t: CoverTarget) => void }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const project = projects.find((p) => p.id === b.projectId);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  return (
    <div className="board-tile" role="button" tabIndex={0} onClick={() => onOpen(b.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(b.id)}>
      <div className="board-tile-cover">
        {b.cover ? <img src={b.cover} alt="" loading="lazy" /> : <IconBoard size={36} />}
      </div>
      <div className="board-tile-body">
        <div className="board-tile-title">{b.title}</div>
        <div className="board-tile-meta">
          {b.itemCount} cards{subCount ? ` · ${subCount} sub-board${subCount === 1 ? '' : 's'}` : ''} · {timeAgo(b.updatedAt)}
        </div>
        {showProject && project && !b.parentId && (
          <button
            className="project-chip"
            style={{ ['--proj' as string]: color(project.color, 'solid') }}
            onClick={(e) => { e.stopPropagation(); onOpenProject(project.id); }}
          >
            {project.name}
          </button>
        )}
      </div>
      {!b.parentId && isTeam && (
        <div className="tile-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn tile-menu-btn" title="Board options" onClick={() => setMenu((m) => !m)}>
            <IconMore size={16} />
          </button>
          {menu && (
            <div className="menu">
              <div className="menu-label">Move to project</div>
              {projects.map((p) => (
                <button key={p.id} className={`menu-item ${p.id === b.projectId ? 'is-active' : ''}`} onClick={() => { onMove(b.id, p.id); setMenu(false); }}>
                  <span className="project-dot" style={{ background: color(p.color, 'solid') }} /> {p.name}
                </button>
              ))}
              <button className={`menu-item ${!b.projectId ? 'is-active' : ''}`} onClick={() => { onMove(b.id, null); setMenu(false); }}>
                <span className="project-dot is-none" /> No project
              </button>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => { setMenu(false); onCover({ kind: 'board', id: b.id }); }}>
                <IconImage size={14} /> Change cover…
              </button>
              <button className="menu-item danger" onClick={() => { setMenu(false); onDelete(b.id); }}>
                <IconTrash size={14} /> Delete board
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
