import { useEffect, useState } from 'react';
import { clientId } from '../api';
import type { BoardSummary } from '../types';
import { useBoard } from '../useBoard';
import { Canvas } from './Canvas';
import { Avatar } from './items/TextCards';
import { IconChevron, IconRedo, IconShare, IconSidebar, IconUndo } from './icons';

interface Props {
  boardId: string;
  boards: Record<string, BoardSummary>;
  me: string;
  go: (id: string | null) => void;
  notify: (msg: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

const STATUS_LABEL = { loading: 'Loading…', saved: 'Saved', saving: 'Saving…', offline: 'Offline — retrying', missing: '' };

export function BoardView({ boardId, boards, me, go, notify, sidebarOpen, toggleSidebar }: Props) {
  const { board, status, presence, change, undo, redo, getBoard } = useBoard(boardId);
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

  if (status === 'missing') {
    return (
      <div className="board-missing">
        <h2>This board doesn’t exist anymore</h2>
        <p>It may have been deleted by a teammate.</p>
        <button className="btn primary" onClick={() => go(null)}>Back to all boards</button>
      </div>
    );
  }

  return (
    <div className="board-view">
      <header className="topbar">
        {!sidebarOpen && <button className="icon-btn" title="Show sidebar" onClick={toggleSidebar}><IconSidebar size={18} /></button>}
        <nav className="crumbs">
          <button className="crumb" onClick={() => go(null)}>All boards</button>
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
            disabled={!board}
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
        <button className="icon-btn" title="Undo (⌘Z)" onClick={undo}><IconUndo size={17} /></button>
        <button className="icon-btn" title="Redo (⇧⌘Z)" onClick={redo}><IconRedo size={17} /></button>
        <button
          className="btn primary"
          onClick={() => {
            navigator.clipboard?.writeText(location.href).then(
              () => notify('Board link copied — share it with your team'),
              () => notify(location.href),
            );
          }}
        >
          <IconShare size={15} /> Share
        </button>
      </header>
      <div className="board-stage">
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
          />
        ) : (
          <div className="splash"><div className="spinner" /></div>
        )}
      </div>
    </div>
  );
}
