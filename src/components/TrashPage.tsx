import { useCallback, useEffect, useState } from 'react';
import { api, socket, type TrashData } from '../api';
import { color, timeAgo } from '../lib';
import { IconBoard, IconFolder, IconSidebar, IconTrash } from './icons';

/** The recycle bin: deleted boards and projects, restorable until they're purged after 30 days. */
export function TrashPage({ notify, sidebarOpen, toggleSidebar }: { notify: (msg: string) => void; sidebarOpen: boolean; toggleSidebar: () => void }) {
  const [data, setData] = useState<TrashData | null>(null);
  const load = useCallback(() => { api.trash().then(setData).catch((err) => notify(err.message)); }, [notify]);
  useEffect(() => {
    load();
    return socket.on((msg) => { if (msg.t === 'index') load(); });
  }, [load]);

  const run = (p: Promise<unknown>, msg: string) => p.then(() => { notify(msg); load(); }).catch((err) => notify(err.message));
  const left = (at: number) => {
    const days = Math.max(0, Math.ceil((at - Date.now()) / 86400000));
    return days <= 1 ? 'deleted for good within a day' : `${days} days left`;
  };

  const empty = data && !data.projects.length && !data.boards.length;
  return (
    <div className="home">
      <header className="topbar">
        {!sidebarOpen && <button className="icon-btn" title="Show sidebar" onClick={toggleSidebar}><IconSidebar size={18} /></button>}
        <div className="crumbs"><span className="crumb-current">Trash</span></div>
      </header>
      <div className="home-body">
        <h1 className="home-title">Trash</h1>
        <p className="home-sub">Deleted boards and projects stay here for {data?.days ?? 30} days, then they’re deleted for good. Restoring a project brings back its boards too.</p>
        {!data && <div className="splash small"><div className="spinner" /></div>}
        {empty && <div className="share-empty">The trash is empty.</div>}
        {data && (data.projects.length > 0 || data.boards.length > 0) && (
          <div className="trash-list">
            {data.projects.map((p) => (
              <div className="trash-row" key={`p-${p.id}`}>
                <span className="trash-icon" style={{ color: color(p.color, 'solid') }}><IconFolder size={22} /></span>
                <div className="trash-main">
                  <b>{p.name}</b>
                  <span>Project · {p.boards} board{p.boards === 1 ? '' : 's'} · deleted {timeAgo(p.deletedAt)}{p.deletedBy ? ` by ${p.deletedBy}` : ''} · {left(p.purgeAt)}</span>
                </div>
                <button className="btn" onClick={() => run(api.restoreProject(p.id), `“${p.name}” restored`)}>Restore</button>
                <button className="icon-btn danger" title="Delete forever" onClick={() => window.confirm(`Delete “${p.name}” and its ${p.boards} board(s) forever? This can’t be undone.`) && run(api.purgeProject(p.id), `“${p.name}” deleted forever`)}><IconTrash size={16} /></button>
              </div>
            ))}
            {data.boards.map((b) => (
              <div className="trash-row" key={`b-${b.id}`}>
                <span className="trash-icon">{b.cover ? <img src={b.cover} alt="" /> : <IconBoard size={22} />}</span>
                <div className="trash-main">
                  <b>{b.title}</b>
                  <span>Board{b.boards > 1 ? ` + ${b.boards - 1} inside` : ''}{b.projectName ? ` · ${b.projectName}` : ''} · deleted {timeAgo(b.deletedAt)}{b.deletedBy ? ` by ${b.deletedBy}` : ''} · {left(b.purgeAt)}</span>
                </div>
                <button className="btn" onClick={() => run(api.restoreBoard(b.id), `“${b.title}” restored`)}>Restore</button>
                <button className="icon-btn danger" title="Delete forever" onClick={() => window.confirm(`Delete “${b.title}” forever? This can’t be undone.`) && run(api.purgeBoard(b.id), `“${b.title}” deleted forever`)}><IconTrash size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
