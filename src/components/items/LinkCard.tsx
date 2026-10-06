import { useEffect, useState } from 'react';
import { api } from '../../api';
import { PLAYER_PROVIDERS, hostname, resolveEmbed, videoThumb, withAutoplay } from '../../lib';
import { useCanvas, type CardProps } from '../CanvasContext';
import { CardNote } from './CardNote';
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
  const { play } = useCanvas();

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

  const note = <CardNote item={item} selected={selected} update={update} />;

  // Posts on X: the usual preview card, but opening it shows the post (and plays its video)
  // in the panel beside the board instead of a new tab.
  if (embed?.kind === 'iframe' && embed.post && play) {
    const title = item.title || 'Post on X';
    const open = () => play({ title, provider: embed.provider, url: item.url, iframe: embed.src, post: true });
    const playBtn = (
      <button className="poster-play nodrag" title="Play here (opens beside the board)" onClick={open}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
      </button>
    );
    return (
      <div className="link-card">
        {item.thumb && (
          <div className="link-thumb is-playable">
            <img src={item.thumb} alt="" draggable={false} loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
            {playBtn}
          </div>
        )}
        <div className="link-body">
          <button className="link-title as-button nodrag" onClick={open} title={item.hideDesc && item.description ? item.description : 'Open beside the board'}>{title}</button>
          {item.description && !item.hideDesc && <div className="link-desc">{item.description}</div>}
          <div className="link-meta">
            <Favicon url={item.url} />
            <div className="link-host grow">{item.siteName || hostname(item.url)}</div>
            <a className="link-open nodrag" href={item.url} target="_blank" rel="noopener noreferrer" title="Open on X"><IconExternal size={14} /></a>
          </div>
        </div>
        {note}
      </div>
    );
  }

  // Video sites: a poster with a play button; playing opens the big player beside the board.
  if (embed?.kind === 'iframe' && PLAYER_PROVIDERS.includes(embed.provider) && play) {
    const poster = videoThumb(item.url) || item.thumb;
    const title = item.title || embed.provider;
    return (
      <div className="link-card is-embed">
        <div className="video-poster" style={{ aspectRatio: embed.aspect || 16 / 9 }}>
          {poster ? <img src={poster} alt="" draggable={false} loading="lazy" referrerPolicy="no-referrer" /> : <div className="poster-blank" />}
          <div className="poster-shade" />
          <div className="poster-title">{title}</div>
          <button
            className="poster-play nodrag"
            title={`Play (opens beside the board)`}
            onClick={() => play({ title, provider: embed.provider, url: item.url, iframe: withAutoplay(embed.src), aspect: embed.aspect })}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
          </button>
          <a className="poster-open nodrag" href={item.url} target="_blank" rel="noopener noreferrer" title={`Open on ${embed.provider}`}><IconExternal size={14} /></a>
        </div>
        {note}
      </div>
    );
  }

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
        {note}
      </div>
    );
  }

  if (embed?.kind === 'image') {
    return (
      <div className="image-card">
        <img src={embed.src} alt="" draggable={false} loading="lazy" />
        {note}
      </div>
    );
  }
  if (embed?.kind === 'video') {
    return (
      <div className="video-card">
        <video src={embed.src} controls preload="metadata" playsInline />
        {note}
      </div>
    );
  }
  if (embed?.kind === 'audio') {
    return (
      <div className="audio-link">
        <AudioPlayer src={embed.src} name={item.title || decodeURIComponent(item.url.split('/').pop() || '')} download={false} />
        {note}
      </div>
    );
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
        <a className="link-title nodrag" href={item.url} target="_blank" rel="noopener noreferrer" title={item.hideDesc ? item.description : undefined}>{item.title || hostname(item.url)}</a>
        {item.description && !item.hideDesc && <div className="link-desc">{item.description}</div>}
        <div className="link-meta">
          <Favicon url={item.url} />
          <div className="link-host grow">{item.siteName || hostname(item.url)}</div>
        </div>
      </div>
      {note}
    </div>
  );
}
