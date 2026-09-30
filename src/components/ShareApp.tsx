import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, clientId, socket, type ShareInfo } from '../api';
import { background, timeAgo } from '../lib';
import type { BoardSummary, Item } from '../types';
import { useBoard } from '../useBoard';
import { Canvas } from './Canvas';
import { Avatar } from './items/TextCards';
import { IconChevron, IconX } from './icons';

/**
 * What someone sees when they open a share link (/s/<token>): no sign-in, just a name and email
 * (when the link asks for it), then the shared board and the boards inside it.
 */
export function ShareApp({ token }: { token: string }) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    api.openShare(token)
      .then((i) => {
        // Signed in with their own access (e.g. the team): open the full app instead.
        if (i.member) { location.replace(`/#/b/${i.boardId}`); return; }
        setInfo(i);
      })
      .catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    document.title = info ? `${info.title} · Little Unusual` : 'Little Unusual';
  }, [info]);

  if (error) {
    return (
      <div className="gate">
        <div className="gate-card">
          <img src="/favicon.svg" width={40} height={40} alt="" />
          <h1>Link not available</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }
  if (!info) return <div className="splash"><div className="spinner" /></div>;

  const identified = (next: ShareInfo) => {
    setInfo(next);
    setAsking(false);
    socket.reconnect(); // the live connection picks up the new name
  };

  if (info.requireIdentity && !info.visitor) return <IdentityGate token={token} info={info} onDone={identified} />;

  return (
    <>
      <ShareBoard
        info={info}
        onAskIdentity={() => setAsking(true)}
        onForget={async () => {
          await api.forgetMe().catch(() => {});
          location.reload();
        }}
      />
      {asking && <IdentityGate token={token} info={info} onDone={identified} onCancel={() => setAsking(false)} />}
    </>
  );
}

function IdentityGate({ token, info, onDone, onCancel }: {
  token: string; info: ShareInfo; onDone: (i: ShareInfo) => void; onCancel?: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(await api.identify(token, name.trim(), email.trim()));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const form = (
    <form className="gate-card share-gate" onSubmit={submit} onPointerDown={(e) => e.stopPropagation()}>
      {onCancel && <button type="button" className="icon-btn gate-close" onClick={onCancel} aria-label="Close"><IconX size={16} /></button>}
      <span className="lu-mark">LU</span>
      <div className="gate-eyebrow">Little Unusual shared a board with you</div>
      <h1>{info.title}</h1>
      <p>
        {info.mode === 'comment'
          ? 'Add your name and email so the team knows who left each comment.'
          : 'Add your name and email so the team knows who’s looking.'}
        {' '}We’ll remember you on this device.
      </p>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={60} autoComplete="name" />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" autoComplete="email" />
      {error && <div className="form-error">{error}</div>}
      <button className="btn primary" type="submit" disabled={busy || !name.trim() || !email.trim()}>
        {info.mode === 'comment' ? 'Open and comment' : 'Open board'}
      </button>
      <div className="gate-small">On another device? Use the same email to pick up your comments.</div>
    </form>
  );
  return onCancel ? <div className="modal-backdrop" onPointerDown={onCancel}>{form}</div> : <div className="gate">{form}</div>;
}

const hashBoard = (fallback: string) => location.hash.match(/^#\/b\/([\w-]+)/)?.[1] ?? fallback;

function useShareRoute(rootId: string) {
  const [id, setId] = useState(() => hashBoard(rootId));
  useEffect(() => {
    const on = () => setId(hashBoard(rootId));
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, [rootId]);
  const go = useCallback((next: string) => {
    if (next === rootId) history.pushState(null, '', location.pathname);
    else location.hash = `/b/${next}`;
    setId(next);
  }, [rootId]);
  return [id, go] as const;
}

function ShareBoard({ info, onAskIdentity, onForget }: { info: ShareInfo; onAskIdentity: () => void; onForget: () => void }) {
  const me = info.visitor?.name || 'Guest';
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [boardId, go] = useShareRoute(info.boardId);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((notify as unknown as { t?: number }).t);
    (notify as unknown as { t?: number }).t = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    socket.start(me);
    api.listBoards().then(setBoards).catch(() => {});
    return socket.on((msg) => { if (msg.t === 'index') setBoards(msg.boards); });
  }, [me]);

  const byId = useMemo(() => Object.fromEntries(boards.map((b) => [b.id, b])), [boards]);

  return (
    <div className="app share-app">
      <main className="main">
        <BoardPane
          key={boardId}
          boardId={boardId}
          rootId={info.boardId}
          boards={byId}
          me={me}
          info={info}
          go={(id) => (byId[id] ? go(id) : notify('That board isn’t part of what was shared with you'))}
          notify={notify}
          onAskIdentity={onAskIdentity}
          onForget={onForget}
        />
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

const STATUS_LABEL = { loading: 'Loading…', saved: '', saving: 'Saving…', offline: 'Offline — retrying', missing: '' };

function BoardPane({ boardId, rootId, boards, me, info, go, notify, onAskIdentity, onForget }: {
  boardId: string; rootId: string; boards: Record<string, BoardSummary>; me: string; info: ShareInfo;
  go: (id: string) => void; notify: (msg: string) => void; onAskIdentity: () => void; onForget: () => void;
}) {
  const { board, status, presence, change, undo, redo, getBoard } = useBoard(boardId);
  const [panel, setPanel] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [menu, setMenu] = useState(false);

  // Breadcrumbs stop at the shared board: nothing above it was shared.
  const crumbs: BoardSummary[] = [];
  if (boardId !== rootId) {
    let cur = board?.parentId ? boards[board.parentId] : undefined;
    while (cur && crumbs.length < 8) {
      crumbs.unshift(cur);
      if (cur.id === rootId) break;
      cur = cur.parentId ? boards[cur.parentId] : undefined;
    }
  }

  const threads = useMemo(() => {
    if (!board) return [];
    const email = info.visitor?.email;
    return Object.values(board.items)
      .filter((it): it is Item & { comments: NonNullable<Item['comments']> } => it.type === 'comment' && Boolean(it.comments?.length))
      .map((it) => ({
        item: it,
        mine: it.comments.some((c) => (email && c.authorEmail === email && c.viaLink) || (!c.authorEmail && c.author === me)),
        last: Math.max(...it.comments.map((c) => c.at)),
      }))
      .sort((a, b) => b.last - a.last);
  }, [board, info.visitor, me]);
  const shown = mineOnly ? threads.filter((t) => t.mine) : threads;
  const mineCount = threads.filter((t) => t.mine).length;

  const others = presence.filter((p) => p.clientId !== clientId);
  const access = board?.access || 'view';
  const bg = background(board?.background);

  if (status === 'missing') {
    return (
      <div className="board-missing">
        <h2>This board isn’t shared any more</h2>
        <p>The link may have been switched off or replaced. Ask Little Unusual for a new one.</p>
        {boardId !== rootId && <button className="btn primary" onClick={() => go(rootId)}>Back to the shared board</button>}
      </div>
    );
  }

  return (
    <div className="board-view">
      <header className="topbar">
        <span className="lu-mark small" title="Little Unusual">LU</span>
        <nav className="crumbs">
          {crumbs.map((c) => (
            <span key={c.id} className="crumb-wrap">
              <button className="crumb" onClick={() => go(c.id)}>{c.title}</button>
              <IconChevron size={12} />
            </span>
          ))}
          <span className="crumb-current">{board?.title || info.title}</span>
        </nav>
        <div className="grow" />
        {STATUS_LABEL[status] && <span className={`save-status is-${status}`}>{STATUS_LABEL[status]}</span>}
        <div className="presence">
          {others.slice(0, 5).map((p) => <Avatar key={p.clientId} name={p.name} size={28} />)}
          {others.length > 5 && <span className="avatar more">+{others.length - 5}</span>}
        </div>
        <span className="access-pill" title={access === 'comment' ? 'You can view this board and leave comments' : 'You can view this board'}>
          {access === 'comment' ? 'Can comment' : 'View only'}
        </span>
        <button className={`btn ${panel ? 'is-on' : ''}`} onClick={() => setPanel((p) => !p)}>
          Comments{threads.length ? ` · ${threads.length}` : ''}
        </button>
        {info.mode === 'comment' && !info.visitor && (
          <button className="btn primary" onClick={onAskIdentity}>Add your name to comment</button>
        )}
        {info.visitor ? (
          <div className="me-menu">
            <button className="me-chip" onClick={() => setMenu((m) => !m)} title={info.visitor.email}>
              <Avatar name={me} size={26} />
              <span>{me}</span>
            </button>
            {menu && (
              <div className="menu" onPointerLeave={() => setMenu(false)}>
                <div className="menu-label plain">{info.visitor.email}</div>
                <button className="menu-item" onClick={onForget}>Not you? Switch person</button>
              </div>
            )}
          </div>
        ) : info.mode === 'view' && (
          <button className="btn" onClick={onAskIdentity}>Add your name</button>
        )}
      </header>
      <div className="share-body">
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
              openBoard={go}
              notify={notify}
              access={access}
              focus={focus}
            />
          ) : (
            <div className="splash"><div className="spinner" /></div>
          )}
        </div>
        {panel && (
          <aside className="comments-panel">
            <div className="comments-head">
              <b>Comments</b>
              <div className="seg">
                <button className={mineOnly ? '' : 'is-on'} onClick={() => setMineOnly(false)}>All {threads.length}</button>
                <button className={mineOnly ? 'is-on' : ''} onClick={() => setMineOnly(true)}>Yours {mineCount}</button>
              </div>
              <button className="icon-btn" onClick={() => setPanel(false)} aria-label="Close"><IconX size={15} /></button>
            </div>
            <div className="comments-list">
              {shown.map(({ item, last }) => {
                const first = item.comments[0];
                return (
                  <button key={item.id} className="thread-row" onClick={() => setFocus((f) => ({ id: item.id, n: (f?.n || 0) + 1 }))}>
                    <Avatar name={first.author} size={26} />
                    <span className="thread-main">
                      <span className="thread-meta"><b>{first.author}</b> · {timeAgo(last)}</span>
                      <span className="thread-text">{first.text}</span>
                      {item.comments.length > 1 && <span className="thread-replies">{item.comments.length - 1} repl{item.comments.length === 2 ? 'y' : 'ies'}</span>}
                    </span>
                  </button>
                );
              })}
              {!shown.length && (
                <div className="share-empty">
                  {mineOnly ? 'You haven’t commented on this board yet.' : 'No comments on this board yet.'}
                  {access === 'comment' && <> Use the <b>Comment</b> tool at the bottom, or press <kbd>M</kbd>.</>}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
