import { useState } from 'react';
import { color, hueFor, initials, timeAgo, uid } from '../../lib';
import { useCanvas, type CardProps } from '../CanvasContext';
import { AutoTextarea, Editable } from './Editable';
import { IconX } from '../icons';

export function NoteCard({ item, editing, update, setEditing }: CardProps) {
  return (
    <div className="note" style={{ background: color(item.color, 'tint') }}>
      <Editable
        value={item.text}
        editing={editing}
        placeholder="Start typing…"
        onChange={(text) => update({ text }, `text-${item.id}`)}
        onDone={() => setEditing(false)}
      />
    </div>
  );
}

export function HeadingCard({ item, editing, update, setEditing }: CardProps) {
  return (
    <div className="heading" style={{ background: color(item.color || 'purple', 'solid') }}>
      <Editable
        plain
        value={item.text}
        editing={editing}
        placeholder="Heading"
        onChange={(text) => update({ text }, `text-${item.id}`)}
        onDone={() => setEditing(false)}
      />
    </div>
  );
}

export function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <span className="avatar" title={name} style={{ background: hueFor(name), width: size, height: size, fontSize: size * 0.42 }}>
      {initials(name)}
    </span>
  );
}

export function CommentCard({ item, update }: CardProps) {
  const { me } = useCanvas();
  const [draft, setDraft] = useState('');
  const comments = item.comments || [];

  const post = () => {
    const text = draft.trim();
    if (!text) return;
    update({ comments: [...comments, { id: uid(), author: me, text, at: Date.now() }] });
    setDraft('');
  };

  return (
    <div className="comment-card" style={{ background: color(item.color || 'yellow', 'tint') }}>
      {comments.map((c) => (
        <div className="comment" key={c.id}>
          <Avatar name={c.author} />
          <div className="comment-main">
            <div className="comment-meta">
              <b>{c.author}</b>
              {c.viaLink && <span className="via-link" title={`Commented through a share link${c.authorEmail ? ` as ${c.authorEmail}` : ''}`}>guest</span>}
              <span>{timeAgo(c.at)}</span>
            </div>
            <div className="comment-text">{c.text}</div>
          </div>
          {c.author === me && (
            <button
              className="icon-btn comment-del"
              title="Delete comment"
              onClick={() => update({ comments: comments.filter((x) => x.id !== c.id) })}
            >
              <IconX size={14} />
            </button>
          )}
        </div>
      ))}
      <AutoTextarea
        className="comment-input"
        placeholder={comments.length ? 'Reply…' : 'Write a comment…'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            post();
          }
        }}
      />
    </div>
  );
}
