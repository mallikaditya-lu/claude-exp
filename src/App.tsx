import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, socket } from './api';
import { BoardView } from './components/BoardView';
import { Home } from './components/Home';
import { Sidebar } from './components/Sidebar';
import type { BoardSummary } from './types';

function useHashRoute() {
  const read = () => location.hash.match(/^#\/b\/([\w-]+)/)?.[1] ?? null;
  const [boardId, setBoardId] = useState(read);
  useEffect(() => {
    const on = () => setBoardId(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((id: string | null) => { location.hash = id ? `/b/${id}` : '/'; }, []);
  return [boardId, go] as const;
}

function storedName() {
  try { return localStorage.getItem('rb-name') || ''; } catch { return ''; }
}

export default function App() {
  const [session, setSession] = useState<{ authRequired: boolean; authed: boolean } | null>(null);
  const [name, setName] = useState(storedName);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [boardId, go] = useHashRoute();
  const [toast, setToast] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 900);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((notify as unknown as { t?: number }).t);
    (notify as unknown as { t?: number }).t = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    api.session().then(setSession).catch(() => setSession({ authRequired: false, authed: true }));
  }, []);

  const ready = session?.authed && name;

  useEffect(() => {
    if (!ready) return;
    socket.start(name);
    api.listBoards().then(setBoards).catch((err) => notify(err.message));
    return socket.on((msg) => {
      if (msg.t === 'index') setBoards(msg.boards);
    });
  }, [ready, name, notify]);

  const byId = useMemo(() => Object.fromEntries(boards.map((b) => [b.id, b])), [boards]);

  const createBoard = useCallback(async (parentId: string | null = null) => {
    try {
      const b = await api.createBoard('Untitled board', parentId);
      setBoards((list) => (list.some((x) => x.id === b.id) ? list : [...list, { ...b, itemCount: 0, cover: null }]));
      go(b.id);
    } catch (err) {
      notify((err as Error).message);
    }
  }, [go, notify]);

  const deleteBoard = useCallback(async (id: string) => {
    const b = byId[id];
    if (!window.confirm(`Delete “${b?.title || 'this board'}” and everything inside? This can’t be undone.`)) return;
    try {
      const { deleted } = await api.deleteBoard(id);
      setBoards((list) => list.filter((x) => !deleted.includes(x.id)));
      if (boardId && deleted.includes(boardId)) go(b?.parentId ?? null);
    } catch (err) {
      notify((err as Error).message);
    }
  }, [boardId, byId, go, notify]);

  if (!session) return <div className="splash"><div className="spinner" /></div>;
  if (!session.authed) return <Login onDone={() => setSession({ ...session, authed: true })} />;
  if (!name) return <NamePrompt onDone={(n) => { try { localStorage.setItem('rb-name', n); } catch { /* ignore */ } setName(n); }} />;

  return (
    <div className={`app ${sidebar ? 'with-sidebar' : ''}`}>
      {sidebar && (
        <Sidebar
          boards={boards}
          current={boardId}
          me={name}
          onOpen={go}
          onCreate={createBoard}
          onRename={() => {
            const n = window.prompt('Your display name', name)?.trim();
            if (n) { try { localStorage.setItem('rb-name', n); } catch { /* ignore */ } setName(n); }
          }}
          onClose={() => setSidebar(false)}
        />
      )}
      <main className="main">
        {boardId ? (
          <BoardView
            key={boardId}
            boardId={boardId}
            boards={byId}
            me={name}
            go={go}
            notify={notify}
            sidebarOpen={sidebar}
            toggleSidebar={() => setSidebar((s) => !s)}
          />
        ) : (
          <Home
            boards={boards}
            me={name}
            onOpen={go}
            onCreate={() => createBoard(null)}
            onDelete={deleteBoard}
            sidebarOpen={sidebar}
            toggleSidebar={() => setSidebar((s) => !s)}
          />
        )}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="gate">
      <form
        className="gate-card"
        onSubmit={async (e) => {
          e.preventDefault();
          try { await api.login(pw); onDone(); } catch (x) { setErr((x as Error).message); }
        }}
      >
        <img src="/favicon.svg" width={40} height={40} alt="" />
        <h1>Reference Board</h1>
        <p>Enter the team password to continue.</p>
        <input type="password" autoFocus value={pw} onChange={(e) => { setPw(e.target.value); setErr(''); }} placeholder="Password" />
        {err && <div className="form-error">{err}</div>}
        <button className="btn primary" type="submit">Sign in</button>
      </form>
    </div>
  );
}

function NamePrompt({ onDone }: { onDone: (name: string) => void }) {
  const [n, setN] = useState('');
  return (
    <div className="gate">
      <form className="gate-card" onSubmit={(e) => { e.preventDefault(); if (n.trim()) onDone(n.trim()); }}>
        <img src="/favicon.svg" width={40} height={40} alt="" />
        <h1>Welcome</h1>
        <p>What should your team see you as? Your name shows on comments and live cursors.</p>
        <input autoFocus value={n} onChange={(e) => setN(e.target.value)} placeholder="Your name" maxLength={60} />
        <button className="btn primary" type="submit" disabled={!n.trim()}>Continue</button>
      </form>
    </div>
  );
}
