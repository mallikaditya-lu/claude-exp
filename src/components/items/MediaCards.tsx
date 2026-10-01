import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatTime } from '../../lib';
import { useCanvas, type CardProps } from '../CanvasContext';
import { IconDownload, IconFile, IconPause, IconPlay } from '../icons';

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

export function ImageCard({ item, editing, update, setEditing }: CardProps) {
  if (item.uploading || !item.url) return <Uploading id={item.id} name={item.fileName} />;
  return (
    <div className="image-card">
      <img src={item.url} alt={item.caption || item.fileName || ''} draggable={false} loading="lazy" />
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

export function VideoCard({ item }: CardProps) {
  if (item.uploading || !item.url) return <Uploading id={item.id} name={item.fileName} />;
  // GIF-style video: plays silently on a loop, like the GIF it came from.
  if (item.loop) {
    return (
      <div className="image-card">
        <video src={item.url} autoPlay muted loop playsInline preload="auto" />
      </div>
    );
  }
  return (
    <div className="video-card">
      <video src={item.url} controls preload="metadata" playsInline />
      <FileFooter url={item.url} name={item.fileName} size={item.size} />
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

export function AudioCard({ item }: CardProps) {
  if (item.uploading || !item.url) return <Uploading id={item.id} name={item.fileName} />;
  return <AudioPlayer src={item.url} name={item.fileName} size={item.size} />;
}

export function FileCard({ item }: CardProps) {
  if (item.uploading || !item.url) return <Uploading id={item.id} name={item.fileName} />;
  const ext = (item.fileName?.split('.').pop() || 'file').slice(0, 4).toUpperCase();
  const isPdf = item.mime === 'application/pdf' || ext === 'PDF';
  return (
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
  );
}
