import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Asset } from '../api';
import { formatBytes, timeAgo } from '../lib';
import { IconFile, IconSearch, IconX } from './icons';

// Everything uploaded or imported to this board (or its whole project), kept even after the card
// is deleted, so a file can be found and reused instead of uploaded again.

export const ASSET_MIME = 'application/x-rb-asset';

type Kind = 'all' | 'image' | 'video' | 'audio' | 'file';

export function assetKind(a: Pick<Asset, 'mime' | 'name'>): Exclude<Kind, 'all'> {
  if (a.mime.startsWith('image/') || /\.(gif|webp|png|jpe?g|avif)$/i.test(a.name)) return 'image';
  if (a.mime.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(a.name)) return 'video';
  if (a.mime.startsWith('audio/') || /\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(a.name)) return 'audio';
  return 'file';
}

interface Props {
  boardId: string;
  hasProject: boolean;
  onAdd: (a: Asset) => void;
  onClose: () => void;
}

export function AssetsPanel({ boardId, hasProject, onAdd, onClose }: Props) {
  const [scope, setScope] = useState<'board' | 'project'>('board');
  const [kind, setKind] = useState<Kind>('all');
  const [q, setQ] = useState('');
  const [list, setList] = useState<Asset[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.assets(boardId, scope).then(setList).catch((err) => setError(err.message));
  }, [boardId, scope]);
  useEffect(() => { setList(null); load(); }, [load]);

  const shown = useMemo(() => (list || []).filter((a) =>
    (kind === 'all' || assetKind(a) === kind) && (!q.trim() || a.name.toLowerCase().includes(q.trim().toLowerCase()))), [list, kind, q]);

  return (
    <aside className="assets-panel" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="assets-head">
        <b>Assets</b>
        <div className="grow" />
        <button className="icon-btn" onClick={onClose} aria-label="Close assets"><IconX size={15} /></button>
      </div>
      <div className="assets-controls">
        {hasProject && (
          <div className="seg">
            <button className={scope === 'board' ? 'is-on' : ''} onClick={() => setScope('board')}>This board</button>
            <button className={scope === 'project' ? 'is-on' : ''} onClick={() => setScope('project')}>Whole project</button>
          </div>
        )}
        <div className="assets-search">
          <IconSearch size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files" />
        </div>
        <div className="assets-kinds">
          {(['all', 'image', 'video', 'audio', 'file'] as Kind[]).map((k) => (
            <button key={k} className={`chip ${kind === k ? 'is-on' : ''}`} onClick={() => setKind(k)}>
              {{ all: 'All', image: 'Images', video: 'Video', audio: 'Audio', file: 'Files' }[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="assets-grid wheel-scroll">
        {list === null && !error && <div className="assets-empty">Loading…</div>}
        {error && <div className="assets-empty">{error}</div>}
        {list && !shown.length && (
          <div className="assets-empty">{list.length ? 'Nothing matches.' : 'Files you upload or paste onto this board will be kept here.'}</div>
        )}
        {shown.map((a) => {
          const k = assetKind(a);
          return (
            <div
              key={a.url}
              className="asset"
              draggable
              title={`${a.name}\n${a.boardTitle}${a.by ? ` · added by ${a.by}` : ''} · ${timeAgo(a.at || 0)}\nClick to add, or drag onto the board`}
              onDragStart={(e) => { e.dataTransfer.setData(ASSET_MIME, JSON.stringify(a)); e.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => onAdd(a)}
            >
              <div className="asset-thumb">
                {k === 'image' && <img src={a.url} alt="" loading="lazy" draggable={false} />}
                {k === 'video' && <video src={`${a.url}#t=0.5`} muted preload="metadata" />}
                {(k === 'audio' || k === 'file') && <IconFile size={26} />}
                {!a.onBoard && a.boardId === boardId && <span className="asset-badge" title="Not on the board any more">removed</span>}
              </div>
              <div className="asset-name">{a.name}</div>
              <div className="asset-meta">{a.size ? formatBytes(a.size) : k}{scope === 'project' ? ` · ${a.boardTitle}` : ''}</div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
