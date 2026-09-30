import { Fragment, useEffect, useState } from 'react';
import { color } from '../../lib';
import { useCanvas, type CardProps } from '../CanvasContext';
import { IconBoard } from '../icons';

export function BoardCard({ item, editing, setEditing }: CardProps) {
  const { boards, renameBoard } = useCanvas();
  const summary = item.boardId ? boards[item.boardId] : undefined;
  const [title, setTitle] = useState(summary?.title || '');
  useEffect(() => setTitle(summary?.title || ''), [summary?.title]);

  return (
    <div className="board-card">
      <div className="board-icon" style={{ background: color(item.color || 'blue', 'solid') }}>
        {summary?.cover ? <img src={summary.cover} alt="" draggable={false} /> : <IconBoard size={34} />}
      </div>
      {editing && summary ? (
        <input
          className="board-title-input"
          autoFocus
          value={title}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const t = title.trim() || 'Untitled board';
            if (t !== summary.title) renameBoard(summary.id, t);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { setTitle(summary.title); setEditing(false); }
          }}
        />
      ) : (
        <div className="board-title">{summary?.title ?? 'Board not found'}</div>
      )}
      <div className="board-meta">{summary ? `${summary.itemCount} card${summary.itemCount === 1 ? '' : 's'}` : 'It may have been deleted'}</div>
    </div>
  );
}

export function ColumnCard({ item, editing, update, setEditing }: CardProps) {
  const { items, dropTarget, renderChild } = useCanvas();
  const children = (item.childIds || []).map((id) => items[id]).filter((c) => c && c.parentId === item.id);
  const drop = dropTarget?.col === item.id ? dropTarget.index : -1;

  return (
    <div className={`column ${drop >= 0 ? 'is-drop' : ''}`} style={{ ['--col' as string]: color(item.color, 'solid') }}>
      <div className="column-head">
        {editing ? (
          <input
            className="column-title-input"
            autoFocus
            value={item.title || ''}
            placeholder="Column title"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => update({ title: e.target.value }, `title-${item.id}`)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
          />
        ) : (
          <div className="column-title">{item.title || 'Untitled column'}</div>
        )}
        <span className="column-count">{children.length}</span>
      </div>
      <div className="column-body">
        {children.map((c, i) => (
          <Fragment key={c.id}>
            {drop === i && <div className="drop-line" />}
            {renderChild(c)}
          </Fragment>
        ))}
        {drop === children.length && <div className="drop-line" />}
        {!children.length && drop < 0 && <div className="column-empty">Drag cards here</div>}
      </div>
    </div>
  );
}
