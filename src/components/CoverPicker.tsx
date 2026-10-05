import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { IconUpload, IconX } from './icons';

// Choose the cover image of a project or a board: any image already in the project, a new
// upload, or back to automatic (the first image on its boards).

interface Props {
  title: string;
  projectId: string | null;
  current: string | null;
  onPick: (url: string | null) => Promise<unknown>;
  onClose: () => void;
  notify: (msg: string) => void;
}

export function CoverPicker({ title, projectId, current, onPick, onClose, notify }: Props) {
  const [images, setImages] = useState<{ url: string; name: string; boardTitle: string }[] | null>(projectId ? null : []);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (projectId) api.projectImages(projectId).then(setImages).catch(() => setImages([]));
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = async (url: string | null) => {
    setBusy(true);
    try { await onPick(url); onClose(); } catch (err) { notify((err as Error).message); setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal cover-picker" role="dialog" aria-label="Choose cover" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Cover for “{title}”</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><IconX size={16} /></button>
        </div>
        <div className="cover-actions">
          <button className="btn primary" disabled={busy} onClick={() => fileRef.current?.click()}><IconUpload size={15} /> Upload an image</button>
          <button className="btn" disabled={busy || !current} onClick={() => pick(null)}>Use automatic cover</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              try { const r = await api.upload(f); await pick(r.url); } catch (err) { notify((err as Error).message); setBusy(false); }
            }}
          />
        </div>
        <div className="cover-grid">
          {images === null && <div className="assets-empty">Loading images…</div>}
          {images?.map((img) => (
            <button key={img.url} className={`cover-option ${img.url === current ? 'is-on' : ''}`} title={`${img.name} · ${img.boardTitle}`} disabled={busy} onClick={() => pick(img.url)}>
              <img src={img.url} alt="" loading="lazy" />
            </button>
          ))}
          {images && !images.length && <div className="assets-empty">No images in {projectId ? 'this project' : 'these boards'} yet. Upload one instead.</div>}
        </div>
      </div>
    </div>
  );
}
