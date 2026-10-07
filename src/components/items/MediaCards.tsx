import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { formatBytes, formatTime } from '../../lib';
import { useCanvas, type CardProps } from '../CanvasContext';
import type { Item } from '../../types';
import { IconDownload, IconExpand, IconFile, IconPause, IconPlay } from '../icons';
import { CardNote } from './CardNote';

function Uploading({ id, name }: { id: string; name?: string }) {
  const { uploadProgress } = useCanvas();
  const p = uploadProgress[id];
  return (
    <div className="uploading">
      <div className="spinner" />
      <div className="uploading-name">{p === undefined ? (name?.startsWith('Importing') ? `${name}…` : 'Waiting for upload…') : `Uploading ${name || 'file'}`}</div>
      {p !== undefined && <div className="uploading-bar"><div style={{ width: `${Math.round(p * 100)}%` }} /></div>}
    </div>
  );
}

function FileFooter({ url, name, size }: { url?: string; name?: string; size?: number }) {
  return (
    <div className="file-footer">
      <div className="file-footer-name" title={name}>{name || 'Untitled'}</div>
      <div className="file-footer-meta">
        {url && <a href={url} download={name} className="link-btn">Download</a>}
        {size ? <span>· {formatBytes(size)}</span> : null}
      </div>
    </div>
  );
}

type MediaFn = (style: CSSProperties, onSize: (ar: number) => void, plain?: boolean) => ReactNode;
type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

/** An image or video with its crop and flips applied; shows the crop editor while cropping. */
function Picture({ item, update, media }: { item: Item; update: CardProps['update']; media: MediaFn }) {
  const { cropping } = useCanvas();
  const [ar, setAr] = useState(item.crop?.ar || 0);
  const flip = [item.flipX && 'scaleX(-1)', item.flipY && 'scaleY(-1)'].filter(Boolean).join(' ') || undefined;
  const c = item.crop;
  if (cropping === item.id && ar) return <CropEditor item={item} ar={ar} update={update} media={media} flip={flip} />;
  if (!c) return <div className="pic" style={{ transform: flip }}>{media({ width: '100%', display: 'block' }, setAr)}</div>;
  return (
    <div className="pic is-cropped" style={{ aspectRatio: `${(c.ar * c.w) / c.h}`, transform: flip }}>
      {media({ position: 'absolute', width: `${100 / c.w}%`, left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%`, maxWidth: 'none' }, setAr)}
    </div>
  );
}

/**
 * Crop in place: the whole picture shows around the card (dimmed outside the crop); drag the frame
 * or its edges. Applied when you click Done, press Enter or Esc, or click away; Cancel discards.
 */
function CropEditor({ item, ar, update, media, flip }: { item: Item; ar: number; update: CardProps['update']; media: MediaFn; flip?: string }) {
  const { endCrop, zoom } = useCanvas();
  const c0 = item.crop || { x: 0, y: 0, w: 1, h: 1, ar };
  const [d, setD] = useState({ x: c0.x, y: c0.y, w: c0.w, h: c0.h });
  const dRef = useRef(d);
  dRef.current = d;
  const fullRef = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const latest = useRef({ item, update });
  latest.current = { item, update };

  // Apply on the way out (Done, Enter, Esc, or clicking away), unless cancelled.
  useEffect(() => () => {
    if (cancelled.current) return;
    const { item: it, update: up } = latest.current;
    const n = dRef.current;
    const F = it.w / c0.w; // the full picture's width, in board units
    const whole = n.x < 0.001 && n.y < 0.001 && n.w > 0.999 && n.h > 0.999;
    // Keep the kept part where it was on the board (mirrored when flipped).
    const sx = it.flipX ? (c0.x + c0.w) - (n.x + n.w) : n.x - c0.x;
    const sy = it.flipY ? (c0.y + c0.h) - (n.y + n.h) : n.y - c0.y;
    up({
      crop: whole ? undefined : { x: +n.x.toFixed(4), y: +n.y.toFixed(4), w: +n.w.toFixed(4), h: +n.h.toFixed(4), ar },
      w: Math.round(F * n.w),
      x: Math.round(it.x + sx * F),
      y: Math.round(it.y + (sy * F) / ar),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); endCrop(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endCrop]);

  const drag = (e: React.PointerEvent, h: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    const el = fullRef.current;
    if (!el) return;
    const W = el.offsetWidth;
    const H = el.offsetHeight;
    const turn = ((item.rotation || 0) * Math.PI) / 180;
    const sx = e.clientX;
    const sy = e.clientY;
    const s0 = dRef.current;
    const MIN = 0.04;
    const onMove = (ev: PointerEvent) => {
      // Screen movement → the picture's own axes (undo board zoom, rotation and flips).
      const mx = (ev.clientX - sx) / zoom;
      const my = (ev.clientY - sy) / zoom;
      let dx = (mx * Math.cos(turn) + my * Math.sin(turn)) / W;
      let dy = (-mx * Math.sin(turn) + my * Math.cos(turn)) / H;
      if (item.flipX) dx = -dx;
      if (item.flipY) dy = -dy;
      let { x, y, w, h: hh } = s0;
      if (h === 'move') {
        x = Math.min(Math.max(0, s0.x + dx), 1 - s0.w);
        y = Math.min(Math.max(0, s0.y + dy), 1 - s0.h);
      } else {
        if (h.includes('w')) { x = Math.min(Math.max(0, s0.x + dx), s0.x + s0.w - MIN); w = s0.x + s0.w - x; }
        if (h.includes('e')) w = Math.min(Math.max(MIN, s0.w + dx), 1 - s0.x);
        if (h.includes('n')) { y = Math.min(Math.max(0, s0.y + dy), s0.y + s0.h - MIN); hh = s0.y + s0.h - y; }
        if (h.includes('s')) hh = Math.min(Math.max(MIN, s0.h + dy), 1 - s0.y);
      }
      setD({ x, y, w, h: hh });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const full = { width: `${100 / c0.w}%`, left: `${(-c0.x / c0.w) * 100}%`, top: `${(-c0.y / c0.h) * 100}%`, aspectRatio: `${ar}`, transform: flip };
  const frame = { left: `${d.x * 100}%`, top: `${d.y * 100}%`, width: `${d.w * 100}%`, height: `${d.h * 100}%` };
  return (
    <div className="pic crop-editor" style={{ aspectRatio: `${(ar * c0.w) / c0.h}` }}>
      {/* The picture, dimmed outside the crop (clipped to the picture)… */}
      <div ref={fullRef} className="crop-full" style={full}>
        {media({ width: '100%', height: '100%', display: 'block' }, () => {}, true)}
        <div className="crop-dim" style={frame} />
      </div>
      {/* …and the frame and handles on top, unclipped so the corners are easy to grab. */}
      <div className="crop-full is-handles" style={full}>
        <div className="crop-rect nodrag" style={frame} onPointerDown={(e) => drag(e, 'move')}>
          {HANDLES.map((h) => <div key={h} className={`crop-h is-${h}`} onPointerDown={(e) => drag(e, h)} />)}
        </div>
      </div>
      <div className="crop-actions nodrag" onPointerDown={(e) => e.stopPropagation()}>
        <button className="btn small" onClick={() => setD({ x: 0, y: 0, w: 1, h: 1 })}>Full</button>
        <button className="btn small" onClick={() => { cancelled.current = true; endCrop(); }}>Cancel</button>
        <button className="btn primary small" onClick={endCrop}>Done</button>
      </div>
    </div>
  );
}

export function ImageCard({ item, editing, update, setEditing }: CardProps) {
  if (item.uploading || !item.url) return <Uploading id={item.id} name={item.fileName} />;
  return (
    <div className="image-card">
      <Picture
        item={item}
        update={update}
        media={(style, onSize) => (
          <img
            src={item.url}
            alt={item.caption || item.fileName || ''}
            draggable={false}
            loading="lazy"
            style={style}
            onLoad={(e) => onSize(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          />
        )}
      />
      {editing ? (
        <input
          className="caption-input"
          autoFocus
          value={item.caption || ''}
          placeholder="Add a caption"
          onChange={(e) => update({ caption: e.target.value }, `caption-${item.id}`)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
        />
      ) : item.caption ? (
        <div className="caption">{item.caption}</div>
      ) : null}
    </div>
  );
}

export function VideoCard({ item, selected, update }: CardProps) {
  const { play } = useCanvas();
  if (item.uploading || !item.url) return <Uploading id={item.id} name={item.fileName} />;
  // GIF-style video: plays silently on a loop, like the GIF it came from.
  if (item.loop) {
    return (
      <div className="image-card">
        <Picture
          item={item}
          update={update}
          media={(style, onSize) => (
            <video src={item.url} autoPlay muted loop playsInline preload="auto" style={style} onLoadedMetadata={(e) => onSize(e.currentTarget.videoWidth / e.currentTarget.videoHeight)} />
          )}
        />
        <CardNote item={item} selected={selected} update={update} />
      </div>
    );
  }
  return (
    <div className="video-card">
      <div className="video-wrap">
        <Picture
          item={item}
          update={update}
          media={(style, onSize, plain) => (
            // Cropped videos would cut off the player's controls: click plays and pauses instead.
            <video
              src={item.url}
              controls={!plain && !item.crop}
              preload="metadata"
              playsInline
              style={style}
              title={item.crop ? 'Click to play or pause' : undefined}
              onClick={(e) => { if (item.crop && !plain) { const v = e.currentTarget; if (v.paused) v.play(); else v.pause(); } }}
              onLoadedMetadata={(e) => onSize(e.currentTarget.videoWidth / e.currentTarget.videoHeight)}
            />
          )}
        />
        {play && (
          <button className="video-big nodrag" title="Watch large, beside the board" onClick={() => play({ title: item.fileName || 'Video', provider: 'Video', video: item.url! })}>
            <IconExpand size={14} />
          </button>
        )}
      </div>
      <FileFooter url={item.url} name={item.fileName} size={item.size} />
      <CardNote item={item} selected={selected} update={update} />
    </div>
  );
}

// Only one audio card plays at a time.
const PLAY_EVENT = 'rb-audio-play';

export function AudioPlayer({ src, name, size, download = true }: { src: string; name?: string; size?: number; download?: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== ref.current) ref.current?.pause();
    };
    window.addEventListener(PLAY_EVENT, onOther);
    return () => window.removeEventListener(PLAY_EVENT, onOther);
  }, []);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: a }));
      a.play();
    } else a.pause();
  };

  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = ref.current;
    if (!a || !duration) return;
    const bar = e.currentTarget;
    const move = (clientX: number) => {
      const r = bar.getBoundingClientRect();
      a.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
    };
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="audio">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
      <div className="audio-top">
        <button className="play-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
        </button>
        <div className="audio-bar nodrag" onPointerDown={seek}>
          <div className="audio-bar-fill" style={{ width: duration ? `${(time / duration) * 100}%` : 0 }} />
        </div>
        <span className="audio-time">{formatTime(time)} / {formatTime(duration)}</span>
      </div>
      <div className="audio-info">
        <div className="audio-name" title={name}>{name}</div>
        <div className="file-footer-meta">
          {download && <a href={src} download={name} className="link-btn">Download</a>}
          {size ? <span>· {formatBytes(size)}</span> : null}
        </div>
      </div>
    </div>
  );
}

export function AudioCard({ item, selected, update }: CardProps) {
  if (item.uploading || !item.url) return <Uploading id={item.id} name={item.fileName} />;
  return (
    <div className="audio-link">
      <AudioPlayer src={item.url} name={item.fileName} size={item.size} />
      <CardNote item={item} selected={selected} update={update} />
    </div>
  );
}

export function FileCard({ item, selected, update }: CardProps) {
  if (item.uploading || !item.url) return <Uploading id={item.id} name={item.fileName} />;
  const ext = (item.fileName?.split('.').pop() || 'file').slice(0, 4).toUpperCase();
  const isPdf = item.mime === 'application/pdf' || ext === 'PDF';
  return (
    <div>
    <div className="file-card">
      <div className="file-icon">
        <IconFile size={30} />
        <span>{ext}</span>
      </div>
      <div className="file-main">
        <div className="file-name" title={item.fileName}>{item.fileName}</div>
        <div className="file-footer-meta">
          <a href={item.url} download={item.fileName} className="link-btn"><IconDownload size={13} /> Download</a>
          {isPdf && <a href={item.url} target="_blank" rel="noreferrer" className="link-btn">Open</a>}
          <span>· {formatBytes(item.size)}</span>
        </div>
      </div>
    </div>
    <CardNote item={item} selected={selected} update={update} />
    </div>
  );
}
