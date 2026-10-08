import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, socket, type AdminData, type AdminPerson, type AiAdmin } from '../api';
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

  const [mcp, setMcp] = useState<Awaited<ReturnType<typeof api.adminMcp>> | null>(null);
  const load = useCallback(() => {
    api.admin().then(setData).catch((err) => notify(err.message));
    api.adminMcp().then(setMcp).catch(() => {});
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
    if (role === 'admin' && (person.projects.length || person.boards.length) && !window.confirm(`${person.email} will see every project as an admin. Their project and board invites become unnecessary and will be removed. Continue?`)) return;
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
              <tr><th>Person</th><th>Role</th><th>Access</th><th>Last active</th><th /></tr>
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
                      {p.role !== 'guest' ? <span className="muted">All projects</span> : p.projects.length || p.boards?.length ? (
                        <div className="chips">
                          {p.projects.map((x) => (
                            <button key={x.id} className="chip" title="Project" onClick={() => onOpenProject(x.id)}>
                              {x.name} · {MEMBER_LABEL[x.role]}
                            </button>
                          ))}
                          {(p.boards || []).map((x) => (
                            <button key={x.id} className="chip is-board" title="Single board" onClick={() => { location.hash = `/b/${x.id}`; }}>
                              {x.name} · {MEMBER_LABEL[x.role]}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">
                          No access
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
            Invite freelancers and clients from a project’s or board’s <b>Share</b> button.
          </p>
        </section>

        <AiSection notify={notify} />

        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Claude connector</h2>
          </div>
          <p>
            Lets Claude (and other apps that support MCP connectors) read and build boards for whoever connects it,
            with that person’s own access. In Claude: <b>Settings → Connectors → Add custom connector</b>, paste this address, then sign in.
          </p>
          {mcp && (
            <>
              <div className="mcp-url">
                <code>{mcp.url}</code>
                <button className="btn" onClick={() => navigator.clipboard?.writeText(mcp.url).then(() => notify('Connector address copied'))}>Copy</button>
              </div>
              {mcp.warnings.map((w) => <div key={w} className="form-error">{w}</div>)}
              {mcp.connections.length ? (
                <div className="people-wrap">
                  <table className="people">
                    <thead><tr><th>Person</th><th>App</th><th>Last used</th><th /></tr></thead>
                    <tbody>
                      {mcp.connections.map((c) => (
                        <tr key={`${c.email}|${c.clientId}`}>
                          <td><div className="person"><Avatar name={c.name || c.email || 'Team'} size={26} /><div><b>{c.name || c.email || 'Team'}</b><span>{c.email || ''}</span></div></div></td>
                          <td>{c.clientName}</td>
                          <td className="muted">{timeAgo(c.lastUsed)}</td>
                          <td>
                            <button className="text-btn" onClick={() => window.confirm(`Disconnect ${c.clientName} for ${c.name || c.email}? It will need to sign in again.`) && run(api.disconnectMcp(c.email, c.clientId), 'Disconnected')}>Disconnect</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="share-empty">No one has connected an app yet.</div>}
            </>
          )}
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Link visitors</h2>
            <div className="grow" />
            <span className="muted">{data.visitors.length} {data.visitors.length === 1 ? 'person' : 'people'}</span>
          </div>
          <p>
            People who opened a share link and gave their name and email (not verified). The link is what gives them access:
            to stop it, switch the link off or reset it from the board’s <b>Share</b> button.
          </p>
          {data.visitors.length ? (
            <div className="people-wrap">
              <table className="people">
                <thead><tr><th>Visitor</th><th>Boards opened</th><th>Last active</th><th /></tr></thead>
                <tbody>
                  {data.visitors.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <div className="person">
                          <Avatar name={v.name} size={30} />
                          <div><b>{v.name}</b><span>{v.email}</span></div>
                        </div>
                      </td>
                      <td>
                        <div className="chips">
                          {v.boards.map((b) => (
                            <button key={b.id} className={`chip is-board ${b.link === 'off' ? 'is-off' : ''}`} title={b.link === 'off' ? 'Link is off now' : `Link: can ${b.link}`} onClick={() => { location.hash = `/b/${b.id}`; }}>
                              {b.name}{b.link === 'off' ? ' · link off' : ''}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="muted">{timeAgo(v.lastSeen)}</td>
                      <td>
                        <button
                          className="icon-btn danger"
                          title="Forget this visitor’s name and email"
                          onClick={() => window.confirm(`Forget ${v.email}? Their comments stay. If they open the link again they’ll be asked for their name.`) && run(api.removeVisitor(v.id), `${v.email} forgotten`)}
                        >
                          <IconTrash size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="share-empty">No one has opened a share link yet.</div>}
        </section>
      </div>
    </div>
  );
}

/** Claude in boards: who may use it, the monthly cap, and this month's spending. */
function AiSection({ notify }: { notify: (msg: string) => void }) {
  const [ai, setAi] = useState<AiAdmin | null>(null);
  const [email, setEmail] = useState('');
  const [cap, setCap] = useState('');
  const load = useCallback(() => { api.ai.admin().then((a) => { setAi(a); setCap(String(a.cap)); }).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  if (!ai) return null;
  const save = (patch: Parameters<typeof api.ai.setAdmin>[0], msg: string) => api.ai.setAdmin(patch).then(() => { notify(msg); load(); }).catch((err) => notify(err.message));
  const pct = ai.cap > 0 ? Math.min(100, (ai.spend / ai.cap) * 100) : 100;

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <h2>Claude in boards</h2>
        <span className={`pill ${ai.enabled ? 'is-ok' : 'is-warn'}`}>{ai.enabled ? 'On' : 'API key missing'}</span>
      </div>
      <p>
        A Claude panel beside every board: people ask about the board and its context, and Claude builds on the board as them,
        with their access. Uses Little Unusual’s Anthropic API key ({ai.model}).
      </p>
      {!ai.enabled && <div className="form-error">Add <code>ANTHROPIC_API_KEY</code> to the app’s variables on Railway (never paste it in chat or commit it), then redeploy.</div>}

      <div className="ai-spend">
        <div className="ai-spend-bar"><div style={{ width: `${pct}%` }} className={pct >= 90 ? 'is-high' : ''} /></div>
        <span><b>${ai.spend.toFixed(2)}</b> of ${ai.cap} used in {ai.month}</span>
        <form className="ai-cap" onSubmit={(e) => { e.preventDefault(); save({ cap: Number(cap) }, 'Monthly cap saved'); }}>
          <label>Monthly cap $ <input value={cap} inputMode="decimal" onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ''))} /></label>
          <button className="btn small" type="submit" disabled={Number(cap) === ai.cap}>Save</button>
        </form>
      </div>
      <p className="admin-note">When the cap is reached, Claude stops answering until next month (or until you raise it).</p>

      <h3 className="ai-h3">Who can use it</h3>
      <label className="check-row">
        <input type="checkbox" checked={ai.allTeam} onChange={(e) => save({ allTeam: e.target.checked }, e.target.checked ? 'Everyone on the core team can use Claude' : 'Only the people listed can use Claude')} />
        <span>Everyone on the core team<small>Otherwise only admins and the people below.</small></span>
      </label>
      <form className="invite-row" onSubmit={(e) => {
        e.preventDefault();
        const add = email.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
        if (add.length) save({ people: [...ai.people.map((p) => p.email), ...add] }, `${add.length === 1 ? add[0] : `${add.length} people`} can now use Claude`).then(() => setEmail(''));
      }}>
        <input value={email} placeholder="Give access by email, separated by commas" onChange={(e) => setEmail(e.target.value)} />
        <button className="btn" type="submit" disabled={!email.trim()}>Give access</button>
      </form>
      {ai.people.length > 0 && (
        <div className="people-wrap">
          <table className="people">
            <thead><tr><th>Person</th><th>This month</th><th /></tr></thead>
            <tbody>
              {ai.people.map((p) => (
                <tr key={p.email}>
                  <td><div className="person"><Avatar name={p.name || p.email} size={26} /><div><b>{p.name || p.email}</b><span>{p.name ? p.email : 'hasn’t signed in yet'}</span></div></div></td>
                  <td className="muted">${p.spend.toFixed(2)}</td>
                  <td><button className="text-btn" onClick={() => save({ people: ai.people.map((x) => x.email).filter((x) => x !== p.email) }, `${p.email} can no longer use Claude`)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ai.usage.length > 0 && (
        <p className="admin-note">Spending this month: {ai.usage.map((u) => `${u.name || u.email} $${u.spend.toFixed(2)}`).join(' · ')}</p>
      )}
    </section>
  );
}
