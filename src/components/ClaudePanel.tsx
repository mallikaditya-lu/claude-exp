import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, socket, type AiChat, type AiChatSummary, type AiLogEntry, type ContextDoc } from '../api';
import { formatBytes, markdownToHtml, timeAgo } from '../lib';
import { IconFile, IconPlus, IconSend, IconSparkle, IconStop, IconTrash, IconX } from './icons';

// Claude beside the board: chats that read the board and its context (research kept with it),
// look at its images, search the web, and build on the board as the person chatting.
// Context documents are managed here too.

const SUGGESTIONS = [
  'Summarise this board in a few lines',
  'Give me 5 ideas based on this research, as a group on the board',
  'Write a blog post from this board and put it on the board',
  'Find 6 fresh references that fit this board',
];
const CONTEXT_ACCEPT = '.md,.markdown,.txt,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.pdf,text/*,application/pdf';

interface Props {
  boardId: string;
  canEdit: boolean;
  enabled: boolean;
  myEmail?: string;
  title: React.ReactNode;
  notify: (msg: string) => void;
  onClose: () => void;
  /** Put a reply on the board as a text card. */
  onAddToBoard?: (markdown: string) => void;
}

export function ClaudePanel({ boardId, canEdit, enabled, myEmail, title, notify, onClose, onAddToBoard }: Props) {
  const [chats, setChats] = useState<AiChatSummary[]>([]);
  const [spend, setSpend] = useState<{ spend: number; cap: number } | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chat, setChat] = useState<AiChat | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // What streams in while Claude answers (cleared when the saved chat is reloaded).
  const [live, setLive] = useState<{ text: string; tool: string | null } | null>(null);
  const [showContext, setShowContext] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadList = useCallback(() => {
    api.ai.info(boardId).then((i) => { setChats(i.chats); setSpend({ spend: i.spend, cap: i.cap }); }).catch(() => {});
  }, [boardId]);
  const loadChat = useCallback((id: string) => {
    api.ai.chat(boardId, id).then((c) => { setChat(c); setLive(null); }).catch(() => { setChat(null); setChatId(null); });
  }, [boardId]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (chatId) loadChat(chatId); else setChat(null); }, [chatId, loadChat]);
  // Someone else chatting on this board: keep the list (and an open chat) current.
  useEffect(() => socket.on((m) => {
    if (m.t === 'ai' && m.boardId === boardId) {
      loadList();
      if (chatId && !busy) loadChat(chatId);
    }
  }), [boardId, busy, chatId, loadChat, loadList]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, live]);

  const send = async (textIn?: string) => {
    const text = (textIn ?? draft).trim();
    if (!text || busy) return;
    setDraft('');
    setBusy(true);
    const mine: AiLogEntry = { role: 'user', text, by: 'You', at: Date.now() };
    setChat((c) => (c ? { ...c, log: [...c.log, mine] } : { id: '', title: text, byName: 'You', by: myEmail || null, createdAt: Date.now(), updatedAt: Date.now(), running: true, cost: 0, log: [mine] }));
    setLive({ text: '', tool: null });
    let id = chatId;
    try {
      await api.ai.send(boardId, chatId, text, (e) => {
        if (e.t === 'chat') { id = e.id; setChatId(e.id); }
        else if (e.t === 'text') setLive((l) => ({ text: (l?.text || '') + e.d, tool: null }));
        else if (e.t === 'tool') setLive((l) => ({ text: l?.text || '', tool: e.label }));
        else if (e.t === 'tool_done' && !e.ok && e.error) notify(e.error);
        else if (e.t === 'error') notify(e.message);
        else if (e.t === 'done' && e.cap !== undefined) setSpend({ spend: e.spend ?? 0, cap: e.cap });
      });
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
      if (id) loadChat(id); else setLive(null);
      loadList();
      inputRef.current?.focus();
    }
  };

  const stop = () => { if (chatId) api.ai.stop(boardId, chatId).catch(() => {}); };
  const running = busy || Boolean(chat?.running);

  return (
    <aside className="comments-panel claude-panel">
      <div className="comments-head">
        {title}
        <div className="grow" />
        <button className="icon-btn" title="New chat" onClick={() => { setChatId(null); setChat(null); setLive(null); inputRef.current?.focus(); }}><IconPlus size={15} /></button>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><IconX size={15} /></button>
      </div>

      <ContextSection boardId={boardId} canEdit={canEdit} open={showContext} setOpen={setShowContext} notify={notify} />

      {!enabled ? (
        <div className="share-empty claude-empty">
          Claude isn’t set up on this server yet. An admin needs to add the Anthropic API key (<code>ANTHROPIC_API_KEY</code>) to the app’s settings on Railway.
        </div>
      ) : (
        <>
          {chats.length > 0 && (
            <div className="claude-chats">
              <select value={chatId || ''} onChange={(e) => setChatId(e.target.value || null)} aria-label="Chats on this board">
                <option value="">New chat</option>
                {chats.map((c) => <option key={c.id} value={c.id}>{c.title} · {c.byName} · {timeAgo(c.updatedAt)}</option>)}
              </select>
              {chat && chat.id && (chat.by === (myEmail || null) || canEdit) && (
                <button className="icon-btn danger" title="Delete this chat" onClick={() => {
                  if (!window.confirm('Delete this chat? What Claude added to the board stays.')) return;
                  api.ai.remove(boardId, chat.id).then(() => { setChatId(null); loadList(); }).catch((err) => notify(err.message));
                }}><IconTrash size={14} /></button>
              )}
            </div>
          )}

          <div className="claude-log" ref={listRef}>
            {!chat && !live && (
              <div className="claude-welcome">
                <span className="claude-mark"><IconSparkle size={22} /></span>
                <b>Ask Claude about this board</b>
                <p>Claude reads the board, its images and its context, can search the web, and can add cards for you. Changes show up live, signed with your name “via Claude”.</p>
                <div className="claude-suggest">
                  {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {chat?.log.map((e, i) => <LogEntry key={i} e={e} onAddToBoard={canEdit ? onAddToBoard : undefined} />)}
            {live && (
              <>
                {live.text && <div className="claude-msg is-claude"><div className="claude-md" dangerouslySetInnerHTML={{ __html: markdownToHtml(live.text) }} /></div>}
                <div className="claude-working"><span className="dots" /> {live.tool || (live.text ? 'Writing…' : 'Thinking…')}</div>
              </>
            )}
            {!live && chat?.running && <div className="claude-working"><span className="dots" /> Claude is working on this chat…</div>}
          </div>

          <div className="claude-input">
            <textarea
              ref={inputRef}
              rows={2}
              value={draft}
              placeholder={chat ? 'Reply to Claude…' : 'Ask about this board, or ask Claude to make something…'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
              }}
            />
            {running ? (
              <button className="btn small" title="Stop Claude" onClick={stop}><IconStop size={12} /> Stop</button>
            ) : (
              <button className="btn primary small" title="Send (Enter)" disabled={!draft.trim()} onClick={() => send()}><IconSend size={13} /></button>
            )}
          </div>
          {spend && <div className="claude-spend" title="Spending on Claude across the whole app this month">${spend.spend.toFixed(2)} of ${spend.cap} this month</div>}
        </>
      )}
    </aside>
  );
}

function LogEntry({ e, onAddToBoard }: { e: AiLogEntry; onAddToBoard?: (md: string) => void }) {
  const html = useMemo(() => (e.role === 'assistant' ? markdownToHtml(e.text) : ''), [e]);
  if (e.role === 'user') return <div className="claude-msg is-user"><span className="claude-by">{e.by}</span><div>{e.text}</div></div>;
  if (e.role === 'tool') return <div className={`claude-tool ${e.error ? 'is-error' : ''}`} title={e.error}>{e.error ? '⚠' : '✓'} {e.label}</div>;
  if (e.role === 'error') return <div className="claude-tool is-error">⚠ {e.text}</div>;
  return (
    <div className="claude-msg is-claude">
      <div className="claude-md" dangerouslySetInnerHTML={{ __html: html }} />
      {onAddToBoard && e.text.length > 60 && <button className="text-btn claude-add" onClick={() => onAddToBoard(e.text)}>+ Add to board</button>}
    </div>
  );
}

/** The board's context: research Claude reads with the board (own documents, and parent boards'). */
function ContextSection({ boardId, canEdit, open, setOpen, notify }: { boardId: string; canEdit: boolean; open: boolean; setOpen: (o: boolean) => void; notify: (m: string) => void }) {
  const [docs, setDocs] = useState<ContextDoc[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(0);
  const [viewing, setViewing] = useState<(ContextDoc & { text: string | null }) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => { api.context.list(boardId).then(setDocs).catch(() => {}); }, [boardId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => socket.on((m) => { if (m.t === 'context' && m.boardId === boardId) load(); }), [boardId, load]);

  const saveText = async () => {
    try {
      await api.context.addText(boardId, title.trim(), text);
      setTitle(''); setText(''); setAdding(false); load();
    } catch (err) { notify((err as Error).message); }
  };
  const upload = async (files: File[]) => {
    for (const f of files) {
      setUploading((n) => n + 1);
      try {
        const r = await api.upload(f, undefined, boardId);
        await api.context.addFile(boardId, { url: r.url, name: r.name, mime: r.mime, size: r.size });
      } catch (err) { notify(`${f.name}: ${(err as Error).message}`); }
      setUploading((n) => n - 1);
    }
    load();
  };

  return (
    <div className={`claude-context ${open ? 'is-open' : ''}`}>
      <button className="claude-context-head" onClick={() => setOpen(!open)}>
        <IconFile size={14} /> Context <span className="muted">{docs.length ? `${docs.length} document${docs.length === 1 ? '' : 's'}` : 'none yet'}</span>
        <span className="grow" /> {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="claude-context-body">
          <p className="claude-hint">Research Claude reads with this board (and the boards inside it): briefs, findings, sources, project files. Claude can also save research here from your own Claude chats through the connector.</p>
          {docs.map((d) => (
            <div key={d.id} className="ctx-row">
              <button className="ctx-main" onClick={() => api.context.get(boardId, d.id).then(setViewing).catch((err) => notify(err.message))}>
                <b>{d.title}</b>
                <span>{d.kind === 'file' ? `${d.name} · ${formatBytes(d.size)}` : `${(d.chars || 0).toLocaleString()} characters`} · {d.own ? d.by : `from “${d.board.title}”`}</span>
              </button>
              {canEdit && d.own && (
                <button className="icon-btn small danger" title="Remove from context" onClick={() => {
                  if (window.confirm(`Remove “${d.title}” from this board’s context?`)) api.context.remove(boardId, d.id).then(load).catch((err) => notify(err.message));
                }}><IconX size={13} /></button>
              )}
            </div>
          ))}
          {canEdit && !adding && (
            <div className="ctx-actions">
              <button className="btn small" onClick={() => setAdding(true)}><IconPlus size={13} /> Paste text</button>
              <button className="btn small" onClick={() => fileRef.current?.click()} disabled={uploading > 0}>{uploading ? 'Uploading…' : 'Upload files'}</button>
              <input ref={fileRef} type="file" multiple hidden accept={CONTEXT_ACCEPT} onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) upload(f); }} />
            </div>
          )}
          {adding && (
            <div className="ctx-add">
              <input value={title} placeholder="Title (e.g. ZeliCash market research)" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <textarea rows={6} value={text} placeholder="Paste research, notes, a brief…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <div className="ctx-actions">
                <button className="btn primary small" disabled={!text.trim()} onClick={saveText}>Save</button>
                <button className="btn small" onClick={() => { setAdding(false); setText(''); setTitle(''); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      {viewing && (
        <div className="modal-backdrop" onPointerDown={() => setViewing(null)}>
          <div className="modal ctx-view" onPointerDown={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2>{viewing.title}</h2><button className="icon-btn" onClick={() => setViewing(null)}><IconX size={16} /></button></div>
            {viewing.text !== null
              ? <div className="claude-md ctx-text" dangerouslySetInnerHTML={{ __html: markdownToHtml(viewing.text || '') }} />
              : <p>This PDF goes to Claude as it is. <a href={viewing.url} target="_blank" rel="noopener noreferrer">Open the file</a></p>}
          </div>
        </div>
      )}
    </div>
  );
}
