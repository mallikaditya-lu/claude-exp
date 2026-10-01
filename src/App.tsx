import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, setActorName, socket, type Session } from './api';
import { AdminPage } from './components/AdminPage';
import { BoardShareDialog } from './components/BoardShareDialog';
import { BoardView } from './components/BoardView';
import { Home } from './components/Home';
import { ShareDialog } from './components/ShareDialog';
import { Sidebar } from './components/Sidebar';
import type { BoardSummary, Project } from './types';

type Route = { board: string | null; project: string | null; admin: boolean };

function useHashRoute() {
  const read = (): Route => ({
    board: location.hash.match(/^#\/b\/([\w-]+)/)?.[1] ?? null,
    project: location.hash.match(/^#\/p\/([\w-]+)/)?.[1] ?? null,
    admin: location.hash === '#/admin',
  });
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((id: string | null) => { location.hash = id ? `/b/${id}` : '/'; }, []);
  const goProject = useCallback((id: string | null) => { location.hash = id ? `/p/${id}` : '/'; }, []);
  return [route, go, goProject] as const;
}

function storedName() {
  try { return localStorage.getItem('rb-name') || ''; } catch { return ''; }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [name, setName] = useState(storedName);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [route, go, goProject] = useHashRoute();
  const boardId = route.board;
  const [toast, setToast] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 900);
  const [shareProjectId, setShareProjectId] = useState<string | null>(null);
  const [shareBoardId, setShareBoardId] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((notify as unknown as { t?: number }).t);
    (notify as unknown as { t?: number }).t = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    api.session()
      .then((s) => {
        setSession(s);
        if (s.user) setName(s.user.name); // signed-in accounts carry their own name
      })
      .catch(() => setSession({ mode: 'open', authRequired: false, authed: true, user: null, role: 'team', publicUrl: '' }));
  }, []);

  const ready = session?.authed && name;
  useEffect(() => { setActorName(name); }, [name]);

  useEffect(() => {
    if (!ready) return;
    socket.start(name);
    api.listBoards().then(setBoards).catch((err) => notify(err.message));
    api.listProjects().then(setProjects).catch((err) => notify(err.message));
    return socket.on((msg) => {
      if (msg.t === 'index') {
        setBoards(msg.boards);
        if (msg.projects) setProjects(msg.projects);
      }
    });
  }, [ready, name, notify]);

  const byId = useMemo(() => Object.fromEntries(boards.map((b) => [b.id, b])), [boards]);

  const projectsById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

  const createBoard = useCallback(async (projectId: string | null = null) => {
    try {
      const b = await api.createBoard('Untitled board', null, projectId);
      setBoards((list) => (list.some((x) => x.id === b.id) ? list : [...list, {
        ...b, projectId: b.projectId ?? null, background: b.background ?? null, itemCount: 0, cover: null,
      }]));
      go(b.id);
    } catch (err) {
      notify((err as Error).message);
    }
  }, [go, notify]);

  const createProject = useCallback(async () => {
    const name = window.prompt('Project name', 'New project')?.trim();
    if (!name) return;
    try {
      const p = await api.createProject(name, ['purple', 'blue', 'teal', 'orange', 'pink', 'green', 'red'][projects.length % 7]);
      setProjects((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]));
      goProject(p.id);
    } catch (err) {
      notify((err as Error).message);
    }
  }, [goProject, notify, projects.length]);

  const moveBoard = useCallback(async (id: string, projectId: string | null) => {
    setBoards((list) => list.map((b) => (b.id === id ? { ...b, projectId } : b)));
    try {
      await api.patchBoard(id, { projectId });
    } catch (err) {
      notify((err as Error).message);
    }
  }, [notify]);

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
  if (!session.authed && session.mode === 'cloudflare') return <SignInElsewhere url={session.publicUrl} />;
  if (!session.authed) return <Login onDone={() => setSession({ ...session, authed: true })} />;
  if (!name) return <NamePrompt onDone={(n) => { try { localStorage.setItem('rb-name', n); } catch { /* ignore */ } setName(n); }} />;

  const role = session.user?.role || session.role || 'team';
  const isTeam = role === 'team' || role === 'admin';
  const isAdmin = role === 'admin';
  const shareProject = shareProjectId ? projectsById[shareProjectId] : null;

  return (
    <div className={`app ${sidebar ? 'with-sidebar' : ''}`}>
      {sidebar && (
        <Sidebar
          boards={boards}
          projects={projects}
          current={boardId}
          currentProject={route.project}
          onOpenProject={goProject}
          onCreateProject={createProject}
          isTeam={isTeam}
          isAdmin={isAdmin}
          adminOpen={route.admin}
          onOpenAdmin={() => { location.hash = '/admin'; }}
          me={name}
          onOpen={go}
          onCreate={createBoard}
          email={session.user?.email}
          onSignOut={session.mode === 'cloudflare' ? () => { location.href = '/cdn-cgi/access/logout'; } : undefined}
          onRename={async () => {
            const n = window.prompt('Your display name', name)?.trim();
            if (!n) return;
            if (session.user) {
              try {
                const u = await api.rename(n);
                setName(u.name);
              } catch (err) {
                notify((err as Error).message);
              }
              return;
            }
            try { localStorage.setItem('rb-name', n); } catch { /* ignore */ }
            setName(n);
          }}
          onClose={() => setSidebar(false)}
        />
      )}
      <main className="main">
        {route.admin && isAdmin ? (
          <AdminPage
            me={name}
            notify={notify}
            onOpenProject={goProject}
            sidebarOpen={sidebar}
            toggleSidebar={() => setSidebar((s) => !s)}
          />
        ) : boardId ? (
          <BoardView
            key={boardId}
            boardId={boardId}
            boards={byId}
            projects={projectsById}
            me={name}
            myEmail={session.user?.email || null}
            go={go}
            goProject={goProject}
            notify={notify}
            isTeam={isTeam}
            onShare={setShareBoardId}
            sidebarOpen={sidebar}
            toggleSidebar={() => setSidebar((s) => !s)}
          />
        ) : (
          <Home
            key={route.project || 'all'}
            boards={boards}
            projects={projects}
            projectId={route.project}
            me={name}
            onOpen={go}
            onOpenProject={goProject}
            onCreate={createBoard}
            onCreateProject={createProject}
            onMove={moveBoard}
            onDelete={deleteBoard}
            notify={notify}
            isTeam={isTeam}
            onShare={setShareProjectId}
            sidebarOpen={sidebar}
            toggleSidebar={() => setSidebar((s) => !s)}
          />
        )}
      </main>
      {shareProject && isTeam && (
        <ShareDialog project={shareProject} onClose={() => setShareProjectId(null)} notify={notify} />
      )}
      {shareBoardId && isTeam && (
        <BoardShareDialog
          boardId={shareBoardId}
          title={byId[shareBoardId]?.title || 'this board'}
          onClose={() => setShareBoardId(null)}
          onOpenProjectShare={(id) => { setShareBoardId(null); setShareProjectId(id); }}
          notify={notify}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function SignInElsewhere({ url }: { url: string }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <img src="/favicon.svg" width={40} height={40} alt="" />
        <h1>Sign in to continue</h1>
        <p>Reference Board uses your company Google account. Open it from its main address to sign in.</p>
        {url && <a className="btn primary" href={url}>Go to {url.replace(/^https?:\/\//, '')}</a>}
      </div>
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
