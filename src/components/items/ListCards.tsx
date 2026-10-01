import { useEffect, useRef, useState } from 'react';
import { color, uid } from '../../lib';
import type { TodoEntry } from '../../types';
import type { CardProps } from '../CanvasContext';
import { IconPlus } from '../icons';

export function TodoCard({ item, update }: CardProps) {
  const todos = item.todos || [];
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (focusId && inputs.current[focusId]) {
      inputs.current[focusId]!.focus();
      setFocusId(null);
    }
  }, [focusId, todos]);

  const set = (next: TodoEntry[]) => update({ todos: next }, `todos-${item.id}`);
  const done = todos.filter((t) => t.done).length;

  const insertAfter = (index: number) => {
    const entry = { id: uid(), text: '', done: false };
    const next = [...todos];
    next.splice(index + 1, 0, entry);
    update({ todos: next });
    setFocusId(entry.id);
  };

  return (
    <div className="todo" style={{ background: color(item.color, 'tint') }}>
      <div className="todo-head">
        <input
          className="todo-title"
          value={item.title || ''}
          placeholder="To-do list"
          onChange={(e) => update({ title: e.target.value }, `title-${item.id}`)}
        />
        {todos.length > 0 && <span className="todo-count">{done}/{todos.length}</span>}
      </div>
      {todos.length > 0 && (
        <div className="todo-progress"><div style={{ width: `${(done / todos.length) * 100}%` }} /></div>
      )}
      {todos.map((t, i) => (
        <div className={`todo-row ${t.done ? 'is-done' : ''}`} key={t.id}>
          <input
            type="checkbox"
            checked={t.done}
            onChange={() => update({ todos: todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) })}
          />
          <input
            className="todo-text"
            ref={(el) => { inputs.current[t.id] = el; }}
            value={t.text}
            placeholder="Task"
            onChange={(e) => set(todos.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                insertAfter(i);
              } else if (e.key === 'Backspace' && !t.text) {
                e.preventDefault();
                update({ todos: todos.filter((x) => x.id !== t.id) });
                if (i > 0) setFocusId(todos[i - 1].id);
              }
            }}
          />
        </div>
      ))}
      <button className="text-btn todo-add" onClick={() => insertAfter(todos.length - 1)}>
        <IconPlus size={14} /> Add task
      </button>
    </div>
  );
}
