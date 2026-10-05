import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, clientId, socket, type ShareInfo } from '../api';
import { background } from '../lib';
import type { BoardSummary } from '../types';
import { useBoard } from '../useBoard';
import { Canvas } from './Canvas';
import { Avatar } from './items/TextCards';
import { PlayerPanel } from './PlayerPanel';
import type { PlayMedia } from './CanvasContext';
import { CommentsPanel, useCommentActions, useCommentUi, type Identity } from './Comments';
import { IconChevron, IconComment, IconX } from './icons';

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
  const { board, status, presence, change, undo, redo, getBoard, applyServerPatch } = useBoard(boardId);
  const [menu, setMenu] = useState(false);
  const [playing, setPlaying] = useState<PlayMedia | null>(null);

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

  const [comments, setComments] = useCommentUi();
  const actions = useCommentActions(boardId, applyServerPatch, notify);
  const identity: Identity = useMemo(() => ({ name: me, email: info.visitor?.email || null, visitor: true }), [me, info.visitor]);
  const openCount = Object.values(board?.threads || {}).filter((t) => !t.resolved).length;

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
        <button className={`btn ${comments.panel ? 'is-on' : ''}`} onClick={() => setComments((u) => ({ ...u, panel: !u.panel }))}>
          <IconComment size={15} /> Comments{openCount ? ` · ${openCount}` : ''}
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
              openBoard={go}
              notify={notify}
              access={access}
              comments={{ ui: comments, setUi: setComments, me: identity, actions }}
              onPlay={setPlaying}
            />
          ) : (
            <div className="splash"><div className="spinner" /></div>
          )}
        </div>
        {playing && <PlayerPanel media={playing} onClose={() => setPlaying(null)} />}
        {comments.panel && (
          <CommentsPanel
            board={board}
            access={access}
            ui={comments}
            setUi={setComments}
            me={identity}
            actions={actions}
            hint={info.mode === 'comment' && !info.visitor && (
              <div><button className="btn primary small panel-cta" onClick={onAskIdentity}>Add your name to comment</button></div>
            )}
          />
        )}
      </div>
    </div>
  );
}
