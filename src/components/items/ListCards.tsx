import { useEffect, useRef, useState } from 'react';
import { color, uid } from '../../lib';
import type { TodoEntry } from '../../types';
import type { CardProps } from '../CanvasContext';
import { AutoTextarea } from './Editable';
import { IconPlus, IconTrash } from '../icons';

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

export function TableCard({ item, update }: CardProps) {
  const data = item.table?.length ? item.table : [['', ''], ['', '']];
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const cols = data[0].length;

  const set = (next: string[][], key?: string) => update({ table: next }, key);
  const setCell = (r: number, c: number, v: string) =>
    set(data.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row)), `table-${item.id}`);
  const addRow = (after = data.length - 1) => {
    const next = data.map((r) => [...r]);
    next.splice(after + 1, 0, Array(cols).fill(''));
    set(next);
  };
  const addCol = (after = cols - 1) => set(data.map((r) => { const n = [...r]; n.splice(after + 1, 0, ''); return n; }));
  const delRow = (r: number) => data.length > 1 && set(data.filter((_, i) => i !== r));
  const delCol = (c: number) => cols > 1 && set(data.map((r) => r.filter((_, i) => i !== c)));
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the cell focused while clicking tools

  return (
    <div className="table-card" style={{ ['--head' as string]: color(item.color, 'tint') }}>
      <div className="card-grip">
        <input
          className="table-title"
          size={Math.max(6, (item.title || '').length + 1)}
          value={item.title || ''}
          placeholder="Table"
          onChange={(e) => update({ title: e.target.value }, `title-${item.id}`)}
        />
        {focus && (
          <div className="table-tools">
            <button className="text-btn" onMouseDown={keep} onClick={() => addRow(focus[0])}>+ Row</button>
            <button className="text-btn" onMouseDown={keep} onClick={() => addCol(focus[1])}>+ Col</button>
            <button className="text-btn danger" onMouseDown={keep} onClick={() => delRow(focus[0])} title="Delete row">
              <IconTrash size={13} /> Row
            </button>
            <button className="text-btn danger" onMouseDown={keep} onClick={() => delCol(focus[1])} title="Delete column">
              <IconTrash size={13} /> Col
            </button>
          </div>
        )}
      </div>
      <table>
        <tbody>
          {data.map((row, r) => (
            <tr key={r} className={r === 0 ? 'is-head' : ''}>
              {row.map((cell, c) => (
                <td key={c}>
                  <AutoTextarea
                    value={cell}
                    placeholder={r === 0 ? `Column ${c + 1}` : ''}
                    onChange={(e) => setCell(r, c, e.target.value)}
                    onFocus={() => setFocus([r, c])}
                    onBlur={() => setFocus(null)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-add">
        <button className="text-btn" onClick={() => addRow()}><IconPlus size={13} /> Row</button>
        <button className="text-btn" onClick={() => addCol()}><IconPlus size={13} /> Column</button>
      </div>
    </div>
  );
}
