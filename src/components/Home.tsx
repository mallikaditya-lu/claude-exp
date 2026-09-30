import { timeAgo } from '../lib';
import type { BoardSummary } from '../types';
import { IconBoard, IconPlus, IconSidebar, IconTrash } from './icons';

interface Props {
  boards: BoardSummary[];
  me: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export function Home({ boards, me, onOpen, onCreate, onDelete, sidebarOpen, toggleSidebar }: Props) {
  const top = boards.filter((b) => !b.parentId).sort((a, b) => b.updatedAt - a.updatedAt);
  const recent = [...boards].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const titleOf = (id: string | null) => boards.find((b) => b.id === id)?.title;

  const card = (b: BoardSummary) => (
    <div key={b.id} className="board-tile" role="button" tabIndex={0} onClick={() => onOpen(b.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(b.id)}>
      <div className="board-tile-cover">
        {b.cover ? <img src={b.cover} alt="" loading="lazy" /> : <IconBoard size={36} />}
      </div>
      <div className="board-tile-body">
        <div className="board-tile-title">{b.title}</div>
        <div className="board-tile-meta">
          {b.parentId && titleOf(b.parentId) ? `in ${titleOf(b.parentId)} · ` : ''}
          {b.itemCount} cards · {timeAgo(b.updatedAt)}
        </div>
      </div>
      <button
        className="icon-btn board-tile-delete"
        title="Delete board"
        onClick={(e) => { e.stopPropagation(); onDelete(b.id); }}
      >
        <IconTrash size={15} />
      </button>
    </div>
  );

  return (
    <div className="home">
      <header className="topbar">
        {!sidebarOpen && <button className="icon-btn" title="Show sidebar" onClick={toggleSidebar}><IconSidebar size={18} /></button>}
        <div className="crumbs"><span className="crumb-current">All boards</span></div>
        <div className="grow" />
        <button className="btn primary" onClick={onCreate}><IconPlus size={15} /> New board</button>
      </header>
      <div className="home-body">
        <h1 className="home-title">Hi {me.split(' ')[0]} 👋</h1>
        <p className="home-sub">Collect references, structure research and share it with the team — notes, links, video, music, tables and to-dos on one canvas.</p>

        {recent.length > 0 && (
          <>
            <h2 className="home-h2">Recently updated</h2>
            <div className="board-grid">{recent.map(card)}</div>
          </>
        )}

        <h2 className="home-h2">Projects</h2>
        <div className="board-grid">
          {top.map(card)}
          <button className="board-tile is-new" onClick={onCreate}>
            <IconPlus size={26} />
            <span>New board</span>
          </button>
        </div>
      </div>
    </div>
  );
}
