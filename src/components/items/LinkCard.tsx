import { useEffect, useState } from 'react';
import { api } from '../../api';
import { hostname, resolveEmbed } from '../../lib';
import type { CardProps } from '../CanvasContext';
import { IconExternal, IconLink } from '../icons';
import { AudioPlayer } from './MediaCards';

const unfurling = new Set<string>();

function normalizeUrl(s: string) {
  const t = s.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(t)) return `https://${t}`;
  return '';
}

function Favicon({ url }: { url?: string }) {
  const host = hostname(url);
  if (!host) return null;
  return <img className="favicon" src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" draggable={false} />;
}

export function LinkCard({ item, selected, editing, update, setEditing }: CardProps) {
  const [draft, setDraft] = useState(item.url || '');
  const [error, setError] = useState('');
  const embed = resolveEmbed(item.url);

  useEffect(() => {
    if (!item.url || item.unfurled || unfurling.has(item.id)) return;
    unfurling.add(item.id);
    api.unfurl(item.url)
      .then((m) => update({
        unfurled: true,
        title: m.title || item.title,
        description: m.description,
        thumb: m.image,
        siteName: m.siteName,
      }, `unfurl-${item.id}`))
      .catch(() => update({ unfurled: true }, `unfurl-${item.id}`))
      .finally(() => unfurling.delete(item.id));
  }, [item.url, item.unfurled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item.url || editing) {
    return (
      <form
        className="link-form"
        onSubmit={(e) => {
          e.preventDefault();
          const url = normalizeUrl(draft);
          if (!url) { setError('That doesn’t look like a link'); return; }
          update({ url, unfurled: false, title: '', description: '', thumb: '', siteName: '' });
          setEditing(false);
        }}
      >
        <div className="link-form-row">
          <IconLink size={16} />
          <input
            autoFocus={editing || !item.url}
            value={draft}
            placeholder="Paste a link: YouTube, Vimeo, Spotify, SoundCloud, Figma, any site…"
            onChange={(e) => { setDraft(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Escape' && item.url && setEditing(false)}
          />
        </div>
        {error && <div className="form-error">{error}</div>}
      </form>
    );
  }

  const openBtn = (
    <a className="icon-btn" href={item.url} target="_blank" rel="noopener noreferrer" title="Open link">
      <IconExternal size={14} />
    </a>
  );

  if (embed?.kind === 'iframe') {
    return (
      <div className="link-card is-embed">
        <div className="embed-frame" style={embed.aspect ? { aspectRatio: embed.aspect } : { height: embed.height }}>
          <iframe
            src={embed.src}
            title={item.title || embed.provider}
            loading="lazy"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
          {!selected && <div className="embed-shield" />}
        </div>
        <div className="link-meta">
          <Favicon url={item.url} />
          <div className="link-meta-text">
            <div className="link-title">{item.title || embed.provider}</div>
            <div className="link-host">{embed.provider}</div>
          </div>
          {openBtn}
        </div>
      </div>
    );
  }

  if (embed?.kind === 'image') {
    return (
      <div className="image-card">
        <img src={embed.src} alt="" draggable={false} loading="lazy" />
        <div className="link-meta"><Favicon url={item.url} /><div className="link-host grow">{hostname(item.url)}</div>{openBtn}</div>
      </div>
    );
  }
  if (embed?.kind === 'video') {
    return (
      <div className="video-card">
        <video src={embed.src} controls preload="metadata" playsInline />
        <div className="link-meta"><Favicon url={item.url} /><div className="link-host grow">{hostname(item.url)}</div>{openBtn}</div>
      </div>
    );
  }
  if (embed?.kind === 'audio') {
    return <AudioPlayer src={embed.src} name={decodeURIComponent(item.url.split('/').pop() || '')} download={false} />;
  }

  return (
    <div className="link-card">
      {item.thumb && (
        <div className="link-thumb">
          <img
            src={item.thumb}
            alt=""
            draggable={false}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
          />
        </div>
      )}
      <div className="link-body">
        <div className="link-title">{item.title || hostname(item.url)}</div>
        {item.description && <div className="link-desc">{item.description}</div>}
        <div className="link-meta">
          <Favicon url={item.url} />
          <div className="link-host grow">{item.siteName || hostname(item.url)}</div>
          {openBtn}
        </div>
      </div>
    </div>
  );
}
