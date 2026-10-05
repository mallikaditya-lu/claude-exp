import { useEffect, useState } from 'react';
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
        {media.url && <a className="icon-btn" href={media.url} target="_blank" rel="noopener noreferrer" title={`Open on ${media.provider}`}><IconExternal size={15} /></a>}
        <button className="icon-btn" onClick={onClose} title="Close player (Esc)"><IconX size={16} /></button>
      </div>
      <div className="player-body">
        {media.iframe ? (
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
