import DOMPurify from 'dompurify';
import type { Board, Item, Patch } from './types';

export const uid = () => crypto.randomUUID();

// ---------- colours ----------
export const COLORS: Record<string, { tint: string; solid: string; label: string }> = {
  default: { tint: 'var(--card)', solid: '#3b3f4a', label: 'Default' },
  yellow: { tint: 'var(--tint-yellow)', solid: '#e0a100', label: 'Yellow' },
  orange: { tint: 'var(--tint-orange)', solid: '#f06a1d', label: 'Orange' },
  red: { tint: 'var(--tint-red)', solid: '#f0414b', label: 'Red' },
  pink: { tint: 'var(--tint-pink)', solid: '#e0428f', label: 'Pink' },
  purple: { tint: 'var(--tint-purple)', solid: '#a35bf5', label: 'Purple' },
  blue: { tint: 'var(--tint-blue)', solid: '#3a7bf2', label: 'Blue' },
  teal: { tint: 'var(--tint-teal)', solid: '#10a3a0', label: 'Teal' },
  green: { tint: 'var(--tint-green)', solid: '#2e9e55', label: 'Green' },
};

// ---------- canvas backgrounds ----------
// `dark` switches cards, toolbars and text on that board to the dark palette.
export const BACKGROUNDS: { id: string; label: string; canvas: string; dot: string; dark: boolean }[] = [
  { id: 'default', label: 'Light grey', canvas: '#eceef1', dot: '#d3d7de', dark: false },
  { id: 'white', label: 'White', canvas: '#ffffff', dot: '#e3e6eb', dark: false },
  { id: 'warm', label: 'Warm', canvas: '#f3efe8', dot: '#dcd5c8', dark: false },
  { id: 'mint', label: 'Mint', canvas: '#e7f2ee', dot: '#cbe0d8', dark: false },
  { id: 'lilac', label: 'Lilac', canvas: '#efecf8', dot: '#d8d2ec', dark: false },
  { id: 'graphite', label: 'Graphite', canvas: '#2c2c2c', dot: '#3d3d3d', dark: true },
  { id: 'charcoal', label: 'Charcoal', canvas: '#1e1e1e', dot: '#303030', dark: true },
  { id: 'midnight', label: 'Midnight', canvas: '#161b2b', dot: '#262d44', dark: true },
  { id: 'forest', label: 'Forest', canvas: '#172420', dot: '#253631', dark: true },
];

export const background = (id?: string | null) => BACKGROUNDS.find((b) => b.id === id) || BACKGROUNDS[0];

export const color = (name: string | undefined, kind: 'tint' | 'solid') => (COLORS[name || 'default'] || COLORS.default)[kind];

// ---------- formatting ----------
export function formatBytes(n?: number) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatTime(sec: number) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function timeAgo(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
}

export function hueFor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 65% 48%)`;
}

export function hostname(url?: string) {
  try { return new URL(url || '').hostname.replace(/^www\./, ''); } catch { return url || ''; }
}

export function isUrl(s: string) {
  return /^https?:\/\/\S+$/i.test(s.trim());
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function sanitize(html: string | undefined) {
  return DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS: ['b', 'i', 'u', 's', 'strike', 'strong', 'em', 'br', 'p', 'div', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'a', 'span', 'blockquote', 'code'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });
}

export function textToHtml(text: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split(/\n/).map((l) => `<p>${esc(l) || '<br>'}</p>`).join('');
}

/** Links that are (or lead straight to) an image, GIF or video: these get imported, not shown as link cards. */
export function isMediaUrl(s: string) {
  try {
    const u = new URL(s.trim());
    if (/\.(gif|webp|png|jpe?g|avif|mp4|webm|mov|m4v)$/i.test(u.pathname)) return true;
    return /(^|\.)(giphy\.com|tenor\.com|gfycat\.com)$/i.test(u.hostname) || /^i\.imgur\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** The original image a website put on the clipboard / drag (browsers also add a re-encoded PNG). */
export function imageFromHtml(html: string) {
  if (!html || !/<img/i.test(html)) return '';
  const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
  const src = img?.getAttribute('src') || img?.getAttribute('data-src') || '';
  return /^https?:\/\//i.test(src) ? src : '';
}

export function kindForMime(mime: string, name = ''): Item['type'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].includes(ext)) return 'audio';
  return 'file';
}

// ---------- embeds ----------
export type Embed =
  | { kind: 'iframe'; src: string; aspect?: number; height?: number; provider: string; post?: boolean }
  | { kind: 'image' | 'video' | 'audio'; src: string; provider: string };

/** A still image for a video link (YouTube has fixed thumbnail URLs; others come from the link preview). */
export function videoThumb(raw?: string) {
  const src = resolveEmbed(raw);
  const yt = src?.kind === 'iframe' && src.provider === 'YouTube' ? src.src.match(/\/embed\/([\w-]+)/)?.[1] : null;
  return yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null;
}

/** Video sites shown as a poster that opens the side player, rather than a tiny inline player. */
export const PLAYER_PROVIDERS = ['YouTube', 'Vimeo', 'Loom'];

export function withAutoplay(src: string) {
  try { const u = new URL(src); u.searchParams.set('autoplay', '1'); return u.href; } catch { return src; }
}

export function resolveEmbed(raw?: string): Embed | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  const path = u.pathname;

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let vid = '';
    if (host === 'youtu.be') vid = path.slice(1);
    else if (path === '/watch') vid = u.searchParams.get('v') || '';
    else vid = path.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1] || '';
    if (vid) {
      const t = u.searchParams.get('t');
      const start = t ? `?start=${parseInt(t, 10) || 0}` : '';
      const short = path.startsWith('/shorts/');
      return { kind: 'iframe', src: `https://www.youtube.com/embed/${vid}${start}`, aspect: short ? 9 / 16 : 16 / 9, provider: 'YouTube' };
    }
  }
  if (host === 'vimeo.com') {
    const vid = path.match(/^\/(?:video\/)?(\d+)(?:\/(\w+))?/);
    if (vid) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vid[1]}${vid[2] ? `?h=${vid[2]}` : ''}`, aspect: 16 / 9, provider: 'Vimeo' };
  }
  if (host === 'loom.com') {
    const vid = path.match(/^\/(?:share|embed)\/(\w+)/)?.[1];
    if (vid) return { kind: 'iframe', src: `https://www.loom.com/embed/${vid}`, aspect: 16 / 9, provider: 'Loom' };
  }
  if (host === 'open.spotify.com') {
    const m = path.match(/^\/(?:intl-[\w-]+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/);
    if (m) {
      const compact = m[1] === 'track' || m[1] === 'episode';
      return { kind: 'iframe', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: compact ? 152 : 352, provider: 'Spotify' };
    }
  }
  if (host === 'soundcloud.com' && path.split('/').filter(Boolean).length >= 2) {
    const set = path.includes('/sets/');
    return {
      kind: 'iframe',
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.href)}&color=%236d4aff&visual=${set}`,
      height: set ? 300 : 166,
      provider: 'SoundCloud',
    };
  }
  if (u.hostname === 'music.apple.com') {
    const song = u.searchParams.has('i') || path.includes('/song/');
    return { kind: 'iframe', src: `https://embed.music.apple.com${path}${u.search}`, height: song ? 175 : 450, provider: 'Apple Music' };
  }
  if (host === 'figma.com' && /^\/(file|design|proto|board)\//.test(path)) {
    return { kind: 'iframe', src: `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(u.href)}`, aspect: 16 / 10, provider: 'Figma' };
  }
  if (host === 'docs.google.com' && /^\/(document|spreadsheets|presentation)\/d\//.test(path)) {
    const src = u.href.replace(/\/(edit|view)([?#].*)?$/, '/preview');
    return { kind: 'iframe', src, aspect: 4 / 3, provider: 'Google Docs' };
  }
  // Posts on X (Twitter): X's own post embed, which plays videos and GIFs inside it.
  if (['x.com', 'twitter.com', 'mobile.twitter.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com'].includes(host)) {
    const id = path.match(/^\/(?:\w+|i(?:\/web)?)\/status(?:es)?\/(\d+)/)?.[1];
    if (id) return { kind: 'iframe', src: `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true`, height: 560, provider: 'X', post: true };
  }
  if (host === 'drive.google.com') {
    const fid = path.match(/\/file\/d\/([\w-]+)/)?.[1];
    if (fid) return { kind: 'iframe', src: `https://drive.google.com/file/d/${fid}/preview`, aspect: 16 / 9, provider: 'Google Drive' };
  }

  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'].includes(ext)) return { kind: 'image', src: u.href, provider: hostname(raw) };
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return { kind: 'video', src: u.href, provider: hostname(raw) };
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return { kind: 'audio', src: u.href, provider: hostname(raw) };
  return null;
}

// ---------- board helpers ----------
/** How many grid columns a group shows at its current width. */
export function groupCols(item: Item) {
  if (item.cols === undefined) return 1;
  if (item.cols > 0) return Math.min(8, item.cols);
  return Math.max(1, Math.min(8, Math.floor((item.w - 16) / 250)));
}

export function isInColumn(item: Item, items: Record<string, Item>) {
  if (!item.parentId) return false;
  const parent = items[item.parentId];
  return Boolean(parent && parent.type === 'column' && parent.childIds?.includes(item.id));
}

export function maxZ(items: Record<string, Item>) {
  let z = 0;
  for (const it of Object.values(items)) z = Math.max(z, it.z || 0);
  return z;
}

export function diffBoards(a: Board, b: Board): Patch | null {
  const patch: Patch = {};
  if (a.title !== b.title) patch.title = b.title;
  if ((a.background || null) !== (b.background || null)) patch.background = b.background || null;
  const up = Object.values(b.items).filter((it) => a.items[it.id] !== it);
  const rm = Object.keys(a.items).filter((id) => !b.items[id]);
  const cup = Object.values(b.connections).filter((c) => a.connections[c.id] !== c);
  const crm = Object.keys(a.connections).filter((id) => !b.connections[id]);
  if (up.length) patch.upsertItems = up;
  if (rm.length) patch.removeItems = rm;
  if (cup.length) patch.upsertConnections = cup;
  if (crm.length) patch.removeConnections = crm;
  return Object.keys(patch).length ? patch : null;
}

export function applyPatch(board: Board, patch: Patch): Board {
  const items = { ...board.items };
  const connections = { ...board.connections };
  for (const it of patch.upsertItems || []) items[it.id] = it;
  for (const id of patch.removeItems || []) delete items[id];
  for (const c of patch.upsertConnections || []) connections[c.id] = c;
  for (const id of patch.removeConnections || []) delete connections[id];
  let threads = board.threads;
  if (patch.upsertThreads?.length || patch.removeThreads?.length) {
    threads = { ...(board.threads || {}) };
    for (const t of patch.upsertThreads || []) threads[t.id] = t;
    for (const id of patch.removeThreads || []) delete threads[id];
  }
  let notes = board.notes;
  if (patch.upsertNotes?.length || patch.removeNotes?.length) {
    notes = { ...(board.notes || {}) };
    for (const n of patch.upsertNotes || []) notes[n.id] = n;
    for (const id of patch.removeNotes || []) delete notes[id];
  }
  return {
    ...board,
    notes,
    title: patch.title ?? board.title,
    background: patch.background !== undefined ? patch.background : board.background,
    projectId: patch.projectId !== undefined ? patch.projectId : board.projectId,
    items,
    connections,
    threads,
  };
}
