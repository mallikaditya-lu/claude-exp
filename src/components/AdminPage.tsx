import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, socket, type AdminData, type AdminPerson } from '../api';
import { timeAgo } from '../lib';
import type { GlobalRole } from '../types';
import { Avatar } from './items/TextCards';
import { IconSidebar, IconTrash } from './icons';

interface Props {
  me: string;
  notify: (msg: string) => void;
  onOpenProject: (id: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

const ROLE_LABEL: Record<GlobalRole, string> = { admin: 'Admin', team: 'Core team', guest: 'Guest' };
const MEMBER_LABEL = { editor: 'edit', commenter: 'comment', viewer: 'view' } as const;

/** People, roles and inactivity settings. Admins only (the server enforces it too). */
export function AdminPage({ notify, onOpenProject, sidebarOpen, toggleSidebar }: Props) {
  const [data, setData] = useState<AdminData | null>(null);
  const [filter, setFilter] = useState<'all' | GlobalRole>('all');
  const [q, setQ] = useState('');
  const [newTeam, setNewTeam] = useState('');

  const load = useCallback(() => {
    api.admin().then(setData).catch((err) => notify(err.message));
  }, [notify]);

  useEffect(() => {
    load();
    // Any change to people or projects re-broadcasts the index; refresh then.
    return socket.on((msg) => { if (msg.t === 'index') load(); });
  }, [load]);

  const people = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.people.filter((p) =>
      (filter === 'all' || p.role === filter) &&
      (!needle || p.email.includes(needle) || (p.name || '').toLowerCase().includes(needle)));
  }, [data, filter, q]);

  if (!data) return <div className="splash"><div className="spinner" /></div>;

  const counts = { admin: 0, team: 0, guest: 0 } as Record<GlobalRole, number>;
  data.people.forEach((p) => { counts[p.role]++; });

  const run = (p: Promise<unknown>, msg: string) => p.then(() => { notify(msg); load(); }).catch((err) => notify(err.message));

  const setRole = (person: AdminPerson, role: GlobalRole) => {
    if (role !== 'guest' && person.projects.length && !window.confirm(`${person.email} will see every project as ${ROLE_LABEL[role]}. Their project invites become unnecessary and will be removed. Continue?`)) return;
    run(api.setPersonRole(person.email, role), `${person.email} is now ${ROLE_LABEL[role]}`);
  };

  const remove = (person: AdminPerson) => {
    if (!window.confirm(`Remove ${person.email}? They lose access to every project. (To block sign-in completely, also remove them from the Cloudflare Access policy.)`)) return;
    run(api.removePerson(person.email), `${person.email} removed`);
  };

  return (
    <div className="home admin">
      <header className="topbar">
        {!sidebarOpen && <button className="icon-btn" title="Show sidebar" onClick={toggleSidebar}><IconSidebar size={18} /></button>}
        <div className="crumbs"><span className="crumb-current">Admin</span></div>
      </header>
      <div className="home-body">
        <h1 className="home-title">Admin</h1>
        <p className="home-sub">Who has access, what they can do, and when inactive guests are removed.</p>

        <div className="stat-row">
          <div className="stat"><b>{counts.team + counts.admin}</b><span>Core team</span></div>
          <div className="stat"><b>{counts.guest}</b><span>Guests (freelancers &amp; clients)</span></div>
          <div className="stat"><b>{data.stats.activeLast7Days}</b><span>Active in the last 7 days</span></div>
          <div className="stat"><b>{data.stats.projects}</b><span>Projects · {data.stats.boards} boards</span></div>
          <div className="stat"><b>{data.stats.files}</b><span>Files in {data.stats.storage === 'drive' ? 'Google Drive' : 'local storage'}</span></div>
        </div>

        <section className="admin-card">
          <h2>Automatic removal of inactive guests</h2>
          <p>
            Guests who haven’t opened the board for this long lose access to their projects, including invites that were never used.
            The core team is never removed.
          </p>
          <select
            value={data.settings.inactiveDays}
            onChange={(e) => run(api.updateSettings({ inactiveDays: Number(e.target.value) }), 'Inactivity setting saved')}
          >
            <option value={0}>Never remove</option>
            <option value={14}>After 14 days</option>
            <option value={30}>After 30 days</option>
            <option value={60}>After 60 days</option>
            <option value={90}>After 90 days</option>
            <option value={180}>After 180 days</option>
          </select>
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2>People</h2>
            <div className="grow" />
            <div className="seg">
              {(['all', 'admin', 'team', 'guest'] as const).map((f) => (
                <button key={f} className={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>
                  {f === 'all' ? `All ${data.people.length}` : `${ROLE_LABEL[f]} ${counts[f]}`}
                </button>
              ))}
            </div>
            <input className="admin-search" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          <div className="people-wrap">
          <table className="people">
            <thead>
              <tr><th>Person</th><th>Role</th><th>Projects</th><th>Last active</th><th /></tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const locked = data.adminEmails.includes(p.email);
                return (
                  <tr key={p.email}>
                    <td>
                      <div className="person">
                        <Avatar name={p.name || p.email} size={30} />
                        <div>
                          <b>{p.name || p.email}</b>
                          <span>{p.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <select value={p.role} disabled={locked} title={locked ? 'Set as admin in ADMIN_EMAILS' : undefined} onChange={(e) => setRole(p, e.target.value as GlobalRole)}>
                        <option value="admin">Admin</option>
                        <option value="team">Core team</option>
                        <option value="guest">Guest</option>
                      </select>
                    </td>
                    <td>
                      {p.role !== 'guest' ? <span className="muted">All projects</span> : p.projects.length ? (
                        <div className="chips">
                          {p.projects.map((x) => (
                            <button key={x.id} className="chip" onClick={() => onOpenProject(x.id)}>
                              {x.name} · {MEMBER_LABEL[x.role]}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">
                          No projects
                          {p.removedForInactivity && ` · removed for inactivity ${timeAgo(p.removedForInactivity.at)}`}
                        </span>
                      )}
                    </td>
                    <td className="muted">{p.pending || !p.lastSeen ? 'Invited, never signed in' : timeAgo(p.lastSeen)}</td>
                    <td>
                      {!locked && (
                        <button className="icon-btn danger" title="Remove person" onClick={() => remove(p)}><IconTrash size={15} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {!people.length && <div className="share-empty">No one matches.</div>}

          <form
            className="invite-row"
            onSubmit={(e) => {
              e.preventDefault();
              const email = newTeam.trim().toLowerCase();
              if (!email) return;
              run(api.setPersonRole(email, 'team'), `${email} added to the core team`).then(() => setNewTeam(''));
            }}
          >
            <input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="Add someone outside @littleunusual to the core team (email)" />
            <button className="btn" type="submit" disabled={!newTeam.trim()}>Add to core team</button>
          </form>
          <p className="admin-note">
            Anyone with a {data.teamDomains.map((d) => `@${d}`).join(' or ')} email is core team automatically.
            Invite freelancers and clients from a project’s <b>Share</b> button.
          </p>
        </section>
      </div>
    </div>
  );
}
