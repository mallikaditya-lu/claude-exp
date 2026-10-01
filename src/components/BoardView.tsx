import { useEffect, useMemo, useRef, useState } from 'react';
import { clientId } from '../api';
import { BACKGROUNDS, background, color } from '../lib';
import type { BoardSummary, Project } from '../types';
import { useBoard } from '../useBoard';
import { Canvas } from './Canvas';
import { CommentsPanel, useCommentActions, useCommentUi, type Identity } from './Comments';
import { NotesPanel } from './NotesPanel';
import { Avatar } from './items/TextCards';
import { IconChevron, IconComment, IconNote, IconPalette, IconRedo, IconShare, IconSidebar, IconUndo } from './icons';

interface Props {
  boardId: string;
  boards: Record<string, BoardSummary>;
  projects: Record<string, Project>;
  me: string;
  /** Signed-in email (Cloudflare mode), for recognising your own comments. */
  myEmail: string | null;
  go: (id: string | null) => void;
  goProject: (id: string | null) => void;
  notify: (msg: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  isTeam: boolean;
  onShare: (boardId: string) => void;
}

const STATUS_LABEL = { loading: 'Loading…', saved: 'Saved', saving: 'Saving…', offline: 'Offline — retrying', missing: '' };

export function BoardView({ boardId, boards, projects, me, myEmail, go, goProject, notify, sidebarOpen, toggleSidebar, isTeam, onShare }: Props) {
  const { board, status, presence, change, undo, redo, getBoard, applyServerPatch } = useBoard(boardId);
  const [comments, setComments] = useCommentUi();
  const actions = useCommentActions(boardId, applyServerPatch, notify);
  const identity: Identity = useMemo(() => ({ name: me, email: myEmail, visitor: false }), [me, myEmail]);
  const [title, setTitle] = useState('');
  useEffect(() => { if (board) setTitle(board.title); }, [board?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.title = board ? `${board.title} · Reference Board` : 'Reference Board';
  }, [board?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const crumbs: BoardSummary[] = [];
  let parent = board?.parentId ? boards[board.parentId] : undefined;
  while (parent && crumbs.length < 8) {
    crumbs.unshift(parent);
    parent = parent.parentId ? boards[parent.parentId] : undefined;
  }

  const others = presence.filter((p) => p.clientId !== clientId);
  const project = board?.projectId ? projects[board.projectId] : undefined;
  const bg = background(board?.background);
  const access = board?.access || 'manage';
  const canEdit = access === 'manage' || access === 'edit';
  const openCount = Object.values(board?.threads || {}).filter((t) => !t.resolved).length;
  const noteCount = Object.keys(board?.notes || {}).length;
  // One column on the right: Comments or Notes (notes are for editors only).
  const [tab, setTabState] = useState<'comments' | 'notes'>(() => {
    try { return localStorage.getItem('rb-side-tab') === 'notes' ? 'notes' : 'comments'; } catch { return 'comments'; }
  });
  const setTab = (t: 'comments' | 'notes') => {
    setTabState(t);
    try { localStorage.setItem('rb-side-tab', t); } catch { /* storage unavailable */ }
  };
  const side = canEdit ? tab : 'comments';
  const toggleSide = (t: 'comments' | 'notes') => {
    if (comments.panel && side === t) { setComments((u) => ({ ...u, panel: false })); return; }
    setTab(t);
    setComments((u) => ({ ...u, panel: true }));
  };
  // Commenting (M, or a pin) brings the comments column forward.
  useEffect(() => {
    if (comments.mode || comments.openId) setTabState('comments');
  }, [comments.mode, comments.openId]);
  const tabs = canEdit ? (
    <div className="panel-tabs">
      <button className={side === 'comments' ? 'is-on' : ''} onClick={() => setTab('comments')}>
        Comments{openCount ? <span className="badge-inline">{openCount}</span> : null}
      </button>
      <button className={side === 'notes' ? 'is-on' : ''} onClick={() => setTab('notes')}>
        Notes{noteCount ? <span className="badge-inline">{noteCount}</span> : null}
      </button>
    </div>
  ) : undefined;

  if (status === 'missing') {
    return (
      <div className="board-missing">
        <h2>This board isn’t available</h2>
        <p>It may have been deleted, or your access to it has changed.</p>
        <button className="btn primary" onClick={() => go(null)}>Back to all boards</button>
      </div>
    );
  }

  return (
    <div className="board-view">
      <header className="topbar">
        {!sidebarOpen && <button className="icon-btn" title="Show sidebar" onClick={toggleSidebar}><IconSidebar size={18} /></button>}
        <nav className="crumbs">
          <button className="crumb" onClick={() => go(null)}>{isTeam ? 'All boards' : 'Shared with you'}</button>
          {project && (
            <span className="crumb-wrap">
              <IconChevron size={12} />
              <button className="crumb crumb-project" onClick={() => goProject(project.id)}>
                <span className="project-dot" style={{ background: color(project.color, 'solid') }} />
                {project.name}
              </button>
            </span>
          )}
          {crumbs.map((c) => (
            <span key={c.id} className="crumb-wrap">
              <IconChevron size={12} />
              <button className="crumb" onClick={() => go(c.id)}>{c.title}</button>
            </span>
          ))}
          <IconChevron size={12} />
          <input
            className="title-input"
            value={title}
            size={Math.max(8, title.length + 1)}
            disabled={!board || !canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const t = title.trim() || 'Untitled board';
              setTitle(t);
              if (board && t !== board.title) change((b) => ({ ...b, title: t }));
            }}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
          />
        </nav>
        <div className="grow" />
        <span className={`save-status is-${status}`}>{STATUS_LABEL[status]}</span>
        <div className="presence">
          {others.slice(0, 5).map((p) => <Avatar key={p.clientId} name={p.name} size={28} />)}
          {others.length > 5 && <span className="avatar more">+{others.length - 5}</span>}
        </div>
        {!canEdit && board && (
          <span className="access-pill" title={access === 'comment' ? 'You can view this board and leave comments' : 'You can view this board'}>
            {access === 'comment' ? 'Can comment' : 'View only'}
          </span>
        )}
        {board && canEdit && (
          <BackgroundPicker
            value={bg.id}
            onChange={(id) => change((b) => ({ ...b, background: id === 'default' ? null : id }))}
          />
        )}
        <button
          className={`icon-btn comments-toggle ${comments.panel && side === 'comments' ? 'is-on' : ''}`}
          title="Comments"
          onClick={() => toggleSide('comments')}
        >
          <IconComment size={17} />
          {openCount > 0 && <span className="badge">{openCount}</span>}
        </button>
        {canEdit && (
          <button
            className={`icon-btn comments-toggle ${comments.panel && side === 'notes' ? 'is-on' : ''}`}
            title="Notes: this board's scratchpad (editors only)"
            onClick={() => toggleSide('notes')}
          >
            <IconNote size={17} />
            {noteCount > 0 && <span className="badge is-quiet">{noteCount}</span>}
          </button>
        )}
        {canEdit && <button className="icon-btn" title="Undo (⌘Z)" onClick={undo}><IconUndo size={17} /></button>}
        {canEdit && <button className="icon-btn" title="Redo (⇧⌘Z)" onClick={redo}><IconRedo size={17} /></button>}
        <button
          className="btn primary"
          onClick={() => {
            // The team shares the board (invites and links); everyone else copies the address.
            if (isTeam) { onShare(boardId); return; }
            navigator.clipboard?.writeText(location.href).then(
              () => notify('Board link copied'),
              () => notify(location.href),
            );
          }}
        >
          <IconShare size={15} /> Share
        </button>
      </header>
      <div className="board-body">
      <div
        className={`board-stage ${bg.dark ? 'theme-dark' : 'theme-light'}`}
        style={{ ['--canvas' as string]: bg.canvas, ['--dot' as string]: bg.dot }}
      >
        {board ? (
          <Canvas
            key={board.id}
            board={board}
            change={change}
            undo={undo}
            redo={redo}
            getBoard={getBoard}
            boards={boards}
            me={me}
            openBoard={(id) => go(id)}
            notify={notify}
            access={access}
            comments={{ ui: comments, setUi: setComments, me: identity, actions }}
          />
        ) : (
          <div className="splash"><div className="spinner" /></div>
        )}
      </div>
      {comments.panel && side === 'comments' && <CommentsPanel board={board} access={access} ui={comments} setUi={setComments} me={identity} actions={actions} title={tabs} />}
      {comments.panel && side === 'notes' && board && (
        <NotesPanel board={board} applyServerPatch={applyServerPatch} notify={notify} title={tabs} onClose={() => setComments((u) => ({ ...u, panel: false }))} />
      )}
      </div>
    </div>
  );
}

function BackgroundPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="bg-picker" ref={ref}>
      <button className={`icon-btn ${open ? 'is-on' : ''}`} title="Board background" onClick={() => setOpen((o) => !o)}>
        <IconPalette size={17} />
      </button>
      {open && (
        <div className="menu bg-menu">
          <div className="menu-label">Background</div>
          <div className="bg-grid">
            {BACKGROUNDS.map((b) => (
              <button
                key={b.id}
                className={`bg-swatch ${b.id === value ? 'is-active' : ''}`}
                title={b.label}
                onClick={() => onChange(b.id)}
              >
                <span className="bg-chip" style={{ background: b.canvas }}>
                  <span className="bg-chip-card" style={{ background: b.dark ? '#3a3a3a' : '#fff' }} />
                </span>
                <span className="bg-name">{b.label}</span>
              </button>
            ))}
          </div>
          <div className="menu-note">Dark backgrounds switch the cards to dark too. Everyone on the board sees the change.</div>
        </div>
      )}
    </div>
  );
}
