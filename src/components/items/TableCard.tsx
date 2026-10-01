import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { color, hostname, imageFromHtml, isMediaUrl } from '../../lib';
import { useCanvas, type CardProps } from '../CanvasContext';
import { IconPlus, IconTrash } from '../icons';

// Tables whose cells can hold more than text: a line that is a link to an image, GIF or video shows
// the media; other links become clickable chips. Paste or drop files and web images into a cell.
// Columns can be resized by dragging the header borders; Tab moves to the next cell.

const IMAGE = /\.(gif|webp|png|jpe?g|avif|svg)(\?|#|$)/i;
const VIDEO = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const URL_RE = /(https?:\/\/[^\s]+|\/uploads\/[^\s]+)/g;

function isRich(text: string) {
  return /https?:\/\/|\/uploads\//.test(text);
}

function CellView({ text }: { text: string }) {
  return (
    <div className="cell-view">
      {text.split('\n').map((line, i) => {
        const t = line.trim();
        if (/^(https?:\/\/\S+|\/uploads\/\S+)$/.test(t)) {
          if (IMAGE.test(t)) return <img key={i} className="cell-media" src={t} alt="" draggable={false} loading="lazy" />;
          if (VIDEO.test(t)) return <video key={i} className="cell-media" src={t} autoPlay muted loop playsInline />;
          return (
            <a key={i} className="cell-link" href={t} target="_blank" rel="noopener noreferrer">
              {t.startsWith('/uploads/') ? t.split('/').pop() : hostname(t) || t}
            </a>
          );
        }
        // Text with links inside it.
        const parts = line.split(URL_RE);
        return (
          <div key={i} className="cell-line">
            {parts.map((p, j) => (j % 2 ? <a key={j} href={p} target="_blank" rel="noopener noreferrer">{hostname(p) || p}</a> : <Fragment key={j}>{p}</Fragment>))}
            {!line && ' '}
          </div>
        );
      })}
    </div>
  );
}

function Cell({ value, head, placeholder, onChange, onFocus, onBlur, onTab, register }: {
  value: string; head: boolean; placeholder: string;
  onChange: (v: string) => void; onFocus: () => void; onBlur: () => void; onTab: (back: boolean) => void;
  register: (el: HTMLTextAreaElement | null) => void;
}) {
  const { boardId, notify } = useCanvas();
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(0);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  });

  const append = (line: string) => {
    const cur = valueRef.current;
    onChange(cur.trim() ? `${cur.replace(/\s+$/, '')}\n${line}` : line);
  };

  const addFiles = (files: File[]) => {
    for (const f of files) {
      setBusy((n) => n + 1);
      api.upload(f, undefined, boardId)
        .then((r) => append(r.url))
        .catch((err) => notify(`${f.name}: ${err.message}`))
        .finally(() => setBusy((n) => n - 1));
    }
  };

  const addWeb = (url: string, fallback?: File) => {
    setBusy((n) => n + 1);
    api.importUrl(url, boardId)
      .then((r) => { if (r.media) append(r.url); else if (fallback) addFiles([fallback]); else append(url); })
      .catch(() => (fallback ? addFiles([fallback]) : append(url)))
      .finally(() => setBusy((n) => n - 1));
  };

  const take = (dt: DataTransfer | null, e: React.SyntheticEvent) => {
    if (!dt) return;
    const files = [...dt.files];
    const web = imageFromHtml(dt.getData('text/html'));
    const text = dt.getData('text/plain').trim();
    if (web) { e.preventDefault(); addWeb(web, files[0]); return; }
    if (files.length) { e.preventDefault(); addFiles(files); return; }
    if (text && isMediaUrl(text) && !/\s/.test(text)) { e.preventDefault(); addWeb(text); }
  };

  const rich = !focused && isRich(value);
  return (
    <div
      className={`cell ${busy ? 'is-busy' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.stopPropagation(); take(e.dataTransfer, e); }}
    >
      {rich && (
        <div className="cell-rich" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('a')) { e.preventDefault(); ref.current?.focus(); } }}>
          <CellView text={value} />
        </div>
      )}
      <textarea
        ref={(el) => { ref.current = el; register(el); }}
        rows={1}
        className={rich ? 'is-hidden' : ''}
        value={value}
        placeholder={placeholder}
        style={head ? { fontWeight: 650 } : undefined}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { setFocused(true); onFocus(); }}
        onBlur={() => { setFocused(false); onBlur(); }}
        onPaste={(e) => take(e.clipboardData, e)}
        onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); onTab(e.shiftKey); } }}
      />
      {busy > 0 && <div className="cell-busy">Adding…</div>}
    </div>
  );
}

export function TableCard({ item, update }: CardProps) {
  const data = item.table?.length ? item.table : [['', ''], ['', '']];
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const cells = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const tableRef = useRef<HTMLTableElement>(null);
  const cols = data[0].length;
  const widths = item.colWidths?.length === cols ? item.colWidths : null;
  // Latest data for async cell updates (uploads finish after other edits).
  const dataRef = useRef(data);
  dataRef.current = data;

  const set = (next: string[][], key?: string) => update({ table: next }, key);
  const setCell = (r: number, c: number, v: string) =>
    set(dataRef.current.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row)), `table-${item.id}`);
  const addRow = (after = data.length - 1) => {
    const next = data.map((r) => [...r]);
    next.splice(after + 1, 0, Array(cols).fill(''));
    set(next);
  };
  const addCol = (after = cols - 1) => {
    set(data.map((r) => { const n = [...r]; n.splice(after + 1, 0, ''); return n; }));
    if (widths) update({ colWidths: undefined });
  };
  const delRow = (r: number) => data.length > 1 && set(data.filter((_, i) => i !== r));
  const delCol = (c: number) => {
    if (cols <= 1) return;
    set(data.map((r) => r.filter((_, i) => i !== c)));
    if (widths) update({ colWidths: undefined });
  };
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the cell focused while clicking tools

  const moveFocus = (r: number, c: number, back: boolean) => {
    let nr = r;
    let nc = c + (back ? -1 : 1);
    if (nc >= cols) { nc = 0; nr += 1; }
    if (nc < 0) { nc = cols - 1; nr -= 1; }
    if (nr < 0) return;
    if (nr >= data.length) { addRow(); setTimeout(() => cells.current[`${nr}:${nc}`]?.focus(), 30); return; }
    cells.current[`${nr}:${nc}`]?.focus();
  };

  // Drag a header border to resize the columns on either side of it.
  const startColResize = (e: React.PointerEvent, c: number) => {
    e.preventDefault();
    e.stopPropagation();
    const table = tableRef.current;
    if (!table) return;
    const total = table.getBoundingClientRect().width;
    const start = widths || Array(cols).fill(100 / cols);
    const sx = e.clientX;
    const key = `colw-${item.id}-${Date.now()}`;
    const onMove = (ev: PointerEvent) => {
      const d = ((ev.clientX - sx) / total) * 100;
      const a = Math.max(6, Math.min(start[c] + start[c + 1] - 6, start[c] + d));
      const next = [...start];
      next[c] = Math.round(a * 10) / 10;
      next[c + 1] = Math.round((start[c] + start[c + 1] - a) * 10) / 10;
      update({ colWidths: next }, key);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

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
      <table ref={tableRef}>
        {widths && <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>}
        <tbody>
          {data.map((row, r) => (
            <tr key={r} className={r === 0 ? 'is-head' : ''}>
              {row.map((cell, c) => (
                <td key={c}>
                  <Cell
                    value={cell}
                    head={r === 0}
                    placeholder={r === 0 ? `Column ${c + 1}` : ''}
                    register={(el) => { cells.current[`${r}:${c}`] = el; }}
                    onChange={(v) => setCell(r, c, v)}
                    onFocus={() => setFocus([r, c])}
                    onBlur={() => setFocus(null)}
                    onTab={(back) => moveFocus(r, c, back)}
                  />
                  {r === 0 && c < cols - 1 && <div className="col-resize nodrag" title="Drag to resize columns" onPointerDown={(e) => startColResize(e, c)} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-add">
        <button className="text-btn" onClick={() => addRow()}><IconPlus size={13} /> Row</button>
        <button className="text-btn" onClick={() => addCol()}><IconPlus size={13} /> Column</button>
        <span className="table-hint">Paste images, GIFs or links into cells</span>
      </div>
    </div>
  );
}
