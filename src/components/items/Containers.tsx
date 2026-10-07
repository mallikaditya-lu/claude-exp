import { Fragment, useEffect, useState } from 'react';
import { color, groupCols } from '../../lib';
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

/**
 * A group (stored as type 'column'): a titled area for cards.
 * Magnet on (default): the cards pack into columns like a masonry wall — each card goes into the
 * shortest column, so a short image never leaves a hole beside a tall one. "Auto" fits as many
 * columns as the width allows. Magnet off (`free`): cards stay exactly where they're put.
 */
export function ColumnCard({ item, editing, update, setEditing }: CardProps) {
  const { items, dropTarget, renderChild, rects } = useCanvas();
  const children = (item.childIds || []).map((id) => items[id]).filter((c) => c && c.parentId === item.id);
  const drop = dropTarget?.col === item.id ? dropTarget.index : -1;
  const cols = groupCols(item);

  let body: React.ReactNode;
  if (item.free) {
    // Tall enough for the lowest card (rotated cards count by their outline).
    const bottom = Math.max(60, ...children.map((c) => c.y + (rects[c.id]?.h ?? 120) + 10));
    body = (
      <div className="column-body is-free" style={{ height: bottom }}>
        {children.map((c) => <Fragment key={c.id}>{renderChild(c)}</Fragment>)}
        {!children.length && <div className="column-empty">Drag cards here and put them anywhere</div>}
      </div>
    );
  } else {
    // Masonry: in order, each card (and the drop slot) goes into the currently shortest column.
    const lanes: { h: number; nodes: React.ReactNode[] }[] = Array.from({ length: cols }, () => ({ h: 0, nodes: [] }));
    const place = (node: React.ReactNode, h: number) => {
      const lane = lanes.reduce((a, b) => (b.h < a.h - 0.5 ? b : a));
      lane.nodes.push(node);
      lane.h += h + 10;
    };
    children.forEach((c, i) => {
      if (drop === i) place(<div key="drop" className="drop-slot" />, 64);
      place(<Fragment key={c.id}>{renderChild(c)}</Fragment>, rects[c.id]?.h ?? 160);
    });
    if (drop === children.length) place(<div key="drop" className="drop-slot" />, 64);
    body = (
      <div className="column-body">
        {children.length || drop >= 0
          ? lanes.map((lane, i) => <div key={i} className="column-lane">{lane.nodes}</div>)
          : <div className="column-empty">Drag cards here, or select cards and press ⌘G</div>}
      </div>
    );
  }

  return (
    <div className={`column ${drop >= 0 ? 'is-drop' : ''} ${item.free ? 'is-free' : ''}`} style={{ ['--col' as string]: color(item.color, 'solid'), ['--cols' as string]: cols }}>
      <div className="column-head">
        {editing ? (
          <input
            className="column-title-input"
            autoFocus
            value={item.title || ''}
            placeholder="Group title"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => update({ title: e.target.value }, `title-${item.id}`)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
          />
        ) : (
          <div className={`column-title ${item.title ? '' : 'is-empty'}`}>{item.title || 'Group'}</div>
        )}
        <span className="column-count">{children.length}</span>
      </div>
      {body}
    </div>
  );
}
