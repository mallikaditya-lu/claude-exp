import { useCallback, useEffect, useState } from 'react';
import { api, socket } from '../api';
import { timeAgo } from '../lib';
import type { BoardSharing, LinkMode, MemberRole } from '../types';
import { Avatar } from './items/TextCards';
import { IconX } from './icons';

const ROLE_INFO: Record<MemberRole, { label: string; hint: string }> = {
  editor: { label: 'Can edit', hint: 'Add, move and change cards, upload files. They sign in with a one-time code sent to their email.' },
  commenter: { label: 'Can comment', hint: 'View and leave comments. They sign in with a one-time code sent to their email.' },
  viewer: { label: 'Can view', hint: 'Look only. They sign in with a one-time code sent to their email.' },
};

const LINK_LABEL: Record<LinkMode, string> = {
  off: 'Only people invited',
  view: 'Anyone with the link can view',
  comment: 'Anyone with the link can comment',
};

interface Props {
  boardId: string;
  title: string;
  onClose: () => void;
  onOpenProjectShare: (projectId: string) => void;
  notify: (msg: string) => void;
}

/** Share one board: invite people by email, or turn on a link that works without signing in. */
export function BoardShareDialog({ boardId, title, onClose, onOpenProjectShare, notify }: Props) {
  const [data, setData] = useState<BoardSharing | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('commenter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.sharing(boardId).then(setData).catch((err) => notify(err.message));
  }, [boardId, notify]);

  useEffect(() => {
    load();
    return socket.on((msg) => { if (msg.t === 'index') load(); });
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = (p: Promise<BoardSharing>) => p.then(setData).catch((err) => notify(err.message));

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const addresses = email.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!addresses.length) return;
    setBusy(true);
    setError('');
    for (const addr of addresses) {
      try {
        setData(await api.setBoardMember(boardId, addr, role));
      } catch (err) {
        setError(`${addr}: ${(err as Error).message}`);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setEmail('');
    notify(addresses.length === 1 ? `${addresses[0]} invited to “${title}”` : `${addresses.length} people invited`);
  };

  const setMode = async (mode: LinkMode) => {
    const next = await api.setLink(boardId, { mode }).catch((err) => { notify(err.message); return null; });
    if (!next) return;
    setData(next);
    if (mode !== 'off' && next.link.url && !next.shareHostMissing) copy(next.link.url);
  };

  const copy = (url: string) => {
    navigator.clipboard?.writeText(url).then(() => notify('Link copied'), () => notify(url));
  };

  const link = data?.link;

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal share-dialog" role="dialog" aria-label="Share board" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Share “{title}”</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><IconX size={16} /></button>
        </div>

        {!data ? <div className="splash small"><div className="spinner" /></div> : (
          <>
            <section className="share-section">
              <div className="share-section-title">Link sharing</div>
              <div className={`link-row is-${link!.mode}`}>
                <select value={link!.mode} onChange={(e) => setMode(e.target.value as LinkMode)} aria-label="Link access">
                  {(Object.keys(LINK_LABEL) as LinkMode[]).map((m) => <option key={m} value={m}>{LINK_LABEL[m]}</option>)}
                </select>
                {link!.mode !== 'off' && link!.url && (
                  <button className="btn primary" onClick={() => copy(link!.url!)} disabled={data.shareHostMissing}>Copy link</button>
                )}
              </div>
              {link!.mode !== 'off' && (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={link!.requireIdentity}
                      onChange={(e) => run(api.setLink(boardId, { requireIdentity: e.target.checked }))}
                    />
                    <span>
                      Ask for name and email before opening
                      <small>{link!.mode === 'comment' ? 'Commenting always asks for a name and email.' : 'Off: anyone with the link can look without saying who they are.'}</small>
                    </span>
                  </label>
                  <div className="share-hint">
                    No sign-in needed. Covers this board and the boards inside it. To let someone edit, invite them by email below.
                    {' '}
                    <button
                      className="text-btn"
                      onClick={() => {
                        if (window.confirm('Make a new link? The current link stops working for everyone who has it.')) run(api.resetLink(boardId)).then(() => notify('New link made. The old one no longer works.'));
                      }}
                    >
                      Reset link
                    </button>
                  </div>
                  {data.shareHostMissing && (
                    <div className="form-error">
                      Links can’t be opened yet: this app is behind Cloudflare sign-in. Set <code>SHARE_URL</code> to a web address that isn’t behind Cloudflare Access.
                    </div>
                  )}
                </>
              )}
              {data.parentLinks.map((p) => (
                <div className="share-hint" key={p.id}>The link to “{p.title}” also covers this board ({p.mode === 'comment' ? 'can comment' : 'can view'}).</div>
              ))}
              {data.linkVisitors.length > 0 && (
                <div className="visitor-list">
                  <div className="share-section-sub">Opened through a link</div>
                  {data.linkVisitors.map((v) => (
                    <div className="share-row compact" key={v.email}>
                      <Avatar name={v.name} size={24} />
                      <div className="share-who"><b>{v.name}</b><span>{v.email} · {timeAgo(v.lastSeen)}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="share-section">
              <div className="share-section-title">People with access</div>
              <form className="invite-row" onSubmit={invite}>
                <input
                  value={email}
                  placeholder="Invite by email, separated by commas"
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                />
                <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} aria-label="Role">
                  {(Object.keys(ROLE_INFO) as MemberRole[]).map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
                </select>
                <button className="btn" type="submit" disabled={busy || !email.trim()}>Invite</button>
              </form>
              <div className="share-hint">{error ? <span className="form-error">{error}</span> : `${ROLE_INFO[role].hint} They only see this board and the boards inside it.`}</div>

              <div className="share-list">
                <div className="share-row is-team">
                  <span className="avatar team-avatar">LU</span>
                  <div className="share-who">
                    <b>Little Unusual core team</b>
                    <span>Everyone on the team can see and edit every board</span>
                  </div>
                  <span className="share-role-fixed">Full access</span>
                </div>
                {data.members.map((m) => (
                  <div className="share-row" key={m.email}>
                    <Avatar name={m.name || m.email} size={30} />
                    <div className="share-who">
                      <b>{m.name || m.email}</b>
                      <span>{m.name ? `${m.email} · ` : ''}{m.lastSeen ? `active ${timeAgo(m.lastSeen)}` : 'invited, hasn’t signed in yet'}</span>
                    </div>
                    <select
                      value={m.role}
                      aria-label={`Role for ${m.email}`}
                      onChange={(e) => run(api.setBoardMember(boardId, m.email, e.target.value as MemberRole))}
                    >
                      {(Object.keys(ROLE_INFO) as MemberRole[]).map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
                    </select>
                    <button className="icon-btn danger" title="Remove access" onClick={() => run(api.removeBoardMember(boardId, m.email))}>
                      <IconX size={15} />
                    </button>
                  </div>
                ))}
                {data.inherited.map((m) => (
                  <div className="share-row is-inherited" key={`${m.from.type}:${m.from.id}:${m.email}`}>
                    <Avatar name={m.name || m.email} size={30} />
                    <div className="share-who">
                      <b>{m.name || m.email}</b>
                      <span>via {m.from.type === 'project' ? 'project' : 'board'} “{m.from.name}”</span>
                    </div>
                    <span className="share-role-fixed">{ROLE_INFO[m.role].label}</span>
                  </div>
                ))}
              </div>
              {data.project && (
                <div className="share-hint">
                  To share every board in “{data.project.name}”, <button className="text-btn" onClick={() => onOpenProjectShare(data.project!.id)}>share the whole project</button>.
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
