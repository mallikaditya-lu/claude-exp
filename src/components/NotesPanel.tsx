import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { color, timeAgo } from '../lib';
import type { Board, BoardNote, Patch } from '../types';
import { IconPlus, IconTrash, IconX } from './icons';

// The board's scratchpad: rough notes kept beside the canvas, not on it. Shared live with everyone
// who can edit the board (never shown to clients or viewers). Drag a note onto the board to make
// it a card.

export const NOTE_MIME = 'application/x-rb-note';
const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple'];

interface Props {
  board: Board;
  applyServerPatch: (p: Patch) => void;
  notify: (msg: string) => void;
  title: React.ReactNode;
  onClose: () => void;
}

export function NotesPanel({ board, applyServerPatch, notify, title, onClose }: Props) {
  const notes = useMemo(() => Object.values(board.notes || {}).sort((a, b) => b.createdAt - a.createdAt), [board.notes]);
  const [fresh, setFresh] = useState<string | null>(null);

  const add = async () => {
    try {
      const n = await api.notes.add(board.id);
      applyServerPatch({ upsertNotes: [n] });
      setFresh(n.id);
    } catch (err) {
      notify((err as Error).message);
    }
  };

  return (
    <aside className="comments-panel notes-panel">
      <div className="comments-head">
        {title}
        <div className="grow" />
        <button className="btn small" onClick={add}><IconPlus size={14} /> New note</button>
        <button className="icon-btn" onClick={onClose} aria-label="Close notes"><IconX size={15} /></button>
      </div>
      <div className="notes-list">
        {notes.map((n) => (
          <NoteRow key={n.id} boardId={board.id} note={n} autoFocus={fresh === n.id} applyServerPatch={applyServerPatch} notify={notify} />
        ))}
        {!notes.length && (
          <div className="share-empty">
            Rough notes for this board: ideas, to-dos, things to remember. Only people who can edit the board see them.
            Drag a note onto the board to turn it into a card.
            <div><button className="btn primary small panel-cta" onClick={add}><IconPlus size={14} /> New note</button></div>
          </div>
        )}
      </div>
    </aside>
  );
}

function NoteRow({ boardId, note, autoFocus, applyServerPatch, notify }: {
  boardId: string; note: BoardNote; autoFocus: boolean; applyServerPatch: (p: Patch) => void; notify: (msg: string) => void;
}) {
  const [text, setText] = useState(note.text);
  const focused = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Someone else's edit arrives: take it, unless you're typing in this note.
  useEffect(() => { if (!focused.current) setText(note.text); }, [note.text]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(64, el.scrollHeight)}px`;
  });

  const save = (value: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.notes.edit(boardId, note.id, { text: value }).catch((err) => notify(err.message));
    }, 500);
  };

  return (
    <div
      className="note-row"
      style={{ background: color(note.color || 'yellow', 'tint') }}
      draggable
      onDragStart={(e) => {
        if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
        e.dataTransfer.setData(NOTE_MIME, text);
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <textarea
        ref={ref}
        value={text}
        placeholder="Write a note…"
        onFocus={() => { focused.current = true; }}
        onBlur={() => {
          focused.current = false;
          window.clearTimeout(timer.current);
          if (text !== note.text) api.notes.edit(boardId, note.id, { text }).then((n) => applyServerPatch({ upsertNotes: [n] })).catch((err) => notify(err.message));
        }}
        onChange={(e) => { setText(e.target.value); save(e.target.value); }}
        onPaste={(e) => e.stopPropagation()}
      />
      <div className="note-row-foot">
        <span className="note-grip" title="Drag onto the board">⠿</span>
        <span>{note.editedBy && note.editedBy !== note.author ? `${note.author}, edited by ${note.editedBy}` : note.author} · {timeAgo(note.updatedAt)}</span>
        <div className="grow" />
        {NOTE_COLORS.map((c) => (
          <button key={c} className={`note-swatch ${note.color === c ? 'is-on' : ''}`} style={{ background: color(c, 'solid') }} title={c}
            onClick={() => api.notes.edit(boardId, note.id, { color: c }).then((n) => applyServerPatch({ upsertNotes: [n] })).catch((err) => notify(err.message))} />
        ))}
        <button
          className="icon-btn"
          title="Delete note"
          onClick={() => {
            if (text.trim() && !window.confirm('Delete this note?')) return;
            api.notes.remove(boardId, note.id).then(() => applyServerPatch({ removeNotes: [note.id] })).catch((err) => notify(err.message));
          }}
        >
          <IconTrash size={14} />
        </button>
      </div>
    </div>
  );
}
