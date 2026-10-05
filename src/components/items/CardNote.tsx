import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCanvas, type CardProps } from '../CanvasContext';

/**
 * The line under a link, video, audio or file card: your own note about it (not the URL).
 * Empty and unselected: nothing shows. Selected: "Add a note" to write one.
 */
export function CardNote({ item, selected, update }: Pick<CardProps, 'item' | 'selected' | 'update'>) {
  const { canEdit } = useCanvas();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.caption || '');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing) setText(item.caption || ''); }, [item.caption, editing]);
  useEffect(() => { if (!selected) setEditing(false); }, [selected]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  });

  if (editing && canEdit) {
    return (
      <div className="card-note nodrag">
        <textarea
          ref={ref}
          autoFocus
          rows={1}
          value={text}
          placeholder="Add a note about this…"
          onChange={(e) => { setText(e.target.value); update({ caption: e.target.value }, `caption-${item.id}`); }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); e.currentTarget.blur(); }
          }}
        />
      </div>
    );
  }
  if (item.caption) {
    return <div className={`card-note ${canEdit ? 'is-editable' : ''}`} onDoubleClick={(e) => { if (canEdit) { e.stopPropagation(); setEditing(true); } }}>{item.caption}</div>;
  }
  if (selected && canEdit) {
    return <button className="card-note-add nodrag" onClick={() => setEditing(true)}>+ Add a note</button>;
  }
  return null;
}
