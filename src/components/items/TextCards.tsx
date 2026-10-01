import { color, hueFor, initials } from '../../lib';
import type { CardProps } from '../CanvasContext';
import { Editable } from './Editable';

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

