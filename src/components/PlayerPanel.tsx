import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { PlayMedia } from './CanvasContext';
import { IconExternal, IconX } from './icons';

/**
 * A big player beside the board: videos open here instead of in their small card, so you can
 * keep scrolling and working on the board while watching. Drag its left edge to resize.
 */
export function PlayerPanel({ media, onClose }: { media: PlayMedia; onClose: () => void }) {
  const [width, setWidth] = useState(() => {
    try { return Number(localStorage.getItem('rb-player-w')) || Math.min(760, Math.round(window.innerWidth * 0.45)); } catch { return 640; }
  });
  useEffect(() => {
    try { localStorage.setItem('rb-player-w', String(width)); } catch { /* storage unavailable */ }
  }, [width]);
  // Posts (X, Pinterest): play the post's own video file straight away when there is one; their
  // embeds only link out to the site. 'post' shows the embed (the text, or a picture-only pin).
  const [view, setView] = useState<'loading' | 'video' | 'post'>(media.postUrl ? 'loading' : 'post');
  const [postVideo, setPostVideo] = useState<{ src: string; gif: boolean } | null>(null);
  useEffect(() => {
    setPostVideo(null);
    if (!media.postUrl) { setView('post'); return; }
    let live = true;
    setView('loading');
    api.postVideo(media.postUrl)
      .then((r) => { if (!live) return; if (r.video) { setPostVideo({ src: r.video, gif: Boolean(r.gif) }); setView('video'); } else setView('post'); })
      .catch(() => { if (live) setView('post'); });
    return () => { live = false; };
  }, [media.postUrl]);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Start playing as soon as it can; browsers that refuse sound without a click start it muted.
  const autoplay = (v: HTMLVideoElement) => {
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    const w0 = width;
    document.body.classList.add('is-resizing');
    const onMove = (ev: PointerEvent) => setWidth(Math.max(320, Math.min(window.innerWidth - 360, w0 - (ev.clientX - sx))));
    const onUp = () => {
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <aside className="player-panel" style={{ width }}>
      <div className="player-resize" title="Drag to resize" onPointerDown={startResize} />
      <div className="player-head">
        <div className="player-title">
          <b title={media.title}>{media.title}</b>
          <span>{media.provider}</span>
        </div>
        {media.post && postVideo && (
          <div className="seg compact player-switch">
            <button className={view === 'video' ? 'is-on' : ''} onClick={() => setView('video')}>Video</button>
            <button className={view === 'post' ? 'is-on' : ''} onClick={() => setView('post')}>Post</button>
          </div>
        )}
        {media.url && <a className="icon-btn" href={media.url} target="_blank" rel="noopener noreferrer" title={`Open on ${media.provider}`}><IconExternal size={15} /></a>}
        <button className="icon-btn" onClick={onClose} title="Close player (Esc)"><IconX size={16} /></button>
      </div>
      <div className="player-body">
        {media.post && view === 'loading' ? (
          <div className="player-loading"><div className="spinner" /></div>
        ) : media.post && view === 'video' && postVideo ? (
          <video
            ref={videoRef}
            key={postVideo.src}
            src={postVideo.src}
            poster={media.poster}
            className="player-video"
            controls={!postVideo.gif}
            loop={postVideo.gif}
            muted={postVideo.gif}
            autoPlay
            playsInline
            onLoadedData={(e) => autoplay(e.currentTarget)}
            // The site refused the file: show its embed instead.
            onError={() => { setPostVideo(null); setView('post'); }}
          />
        ) : media.iframe && media.post ? (
          <div className="player-post">
            <iframe key={media.iframe} src={media.iframe} title={media.title} allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write" allowFullScreen />
          </div>
        ) : media.iframe ? (
          <div className="player-frame" style={{ aspectRatio: media.aspect || 16 / 9 }}>
            <iframe key={media.iframe} src={media.iframe} title={media.title} allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write" allowFullScreen />
          </div>
        ) : (
          <video key={media.video} src={media.video} controls autoPlay playsInline className="player-video" />
        )}
      </div>
    </aside>
  );
}
