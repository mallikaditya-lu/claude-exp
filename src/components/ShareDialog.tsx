import { useEffect, useState } from 'react';
import { api } from '../api';
import { color, timeAgo } from '../lib';
import type { MemberRole, Project } from '../types';
import { Avatar } from './items/TextCards';
import { IconX } from './icons';

const ROLE_INFO: Record<MemberRole, { label: string; hint: string }> = {
  editor: { label: 'Can edit', hint: 'Add, move and change cards, upload files' },
  commenter: { label: 'Can comment', hint: 'View and leave comments' },
  viewer: { label: 'Can view', hint: 'Look only' },
};

interface Props {
  project: Project;
  teamDomains?: string[];
  onClose: () => void;
  notify: (msg: string) => void;
}

/** Invite freelancers and clients to one project. The core team already sees everything. */
export function ShareDialog({ project, onClose, notify }: Props) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const members = [...(project.members || [])].sort((a, b) => (a.invitedAt || 0) - (b.invitedAt || 0));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const addresses = email.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!addresses.length) return;
    setBusy(true);
    setError('');
    for (const addr of addresses) {
      try {
        await api.setMember(project.id, addr, role);
      } catch (err) {
        setError(`${addr}: ${(err as Error).message}`);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setEmail('');
    notify(addresses.length === 1 ? `${addresses[0]} can now ${ROLE_INFO[role].label.toLowerCase().replace('can ', '')} “${project.name}”` : `${addresses.length} people invited`);
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(`${location.origin}/#/p/${project.id}`).then(() => notify('Project link copied'));
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal share-dialog" role="dialog" aria-label="Share project" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="project-dot" style={{ background: color(project.color, 'solid') }} />
          <h2>Share “{project.name}”</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><IconX size={16} /></button>
        </div>

        <form className="invite-row" onSubmit={invite}>
          <input
            autoFocus
            value={email}
            placeholder="Email addresses, separated by commas"
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} aria-label="Role">
            {(Object.keys(ROLE_INFO) as MemberRole[]).map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
          </select>
          <button className="btn primary" type="submit" disabled={busy || !email.trim()}>Invite</button>
        </form>
        <div className="share-hint">{error ? <span className="form-error">{error}</span> : ROLE_INFO[role].hint}</div>

        <div className="share-list">
          <div className="share-row is-team">
            <span className="avatar team-avatar">LU</span>
            <div className="share-who">
              <b>Little Unusual core team</b>
              <span>Everyone on the team can see and edit all projects</span>
            </div>
            <span className="share-role-fixed">Full access</span>
          </div>
          {members.map((m) => (
            <div className="share-row" key={m.email}>
              <Avatar name={m.name || m.email} size={30} />
              <div className="share-who">
                <b>{m.name || m.email}</b>
                <span>
                  {m.name ? `${m.email} · ` : ''}
                  {m.lastSeen ? `active ${timeAgo(m.lastSeen)}` : 'invited — hasn’t signed in yet'}
                </span>
              </div>
              <select
                value={m.role}
                aria-label={`Role for ${m.email}`}
                onChange={(e) => api.setMember(project.id, m.email, e.target.value as MemberRole).catch((err) => notify(err.message))}
              >
                {(Object.keys(ROLE_INFO) as MemberRole[]).map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
              </select>
              <button
                className="icon-btn danger"
                title="Remove access"
                onClick={() => api.removeMember(project.id, m.email).catch((err) => notify(err.message))}
              >
                <IconX size={15} />
              </button>
            </div>
          ))}
          {!members.length && <div className="share-empty">No one outside the core team has access yet.</div>}
        </div>

        <div className="modal-foot">
          <span className="share-foot-note">Invited people sign in with a one-time code sent to their email. They only see this project.</span>
          <button className="btn" onClick={copyLink}>Copy link</button>
        </div>
      </div>
    </div>
  );
}
