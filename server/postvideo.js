import { assertPublic } from './unfurl.js';

// Finds the video file behind a post on X or a Pinterest pin, so the side player can play it
// straight away. (The embeds those sites offer don't play video inline: their play button sends
// you to the site.) Only fixed, known hosts are asked, and only video addresses on the sites' own
// video hosts are returned. Anything not found returns null and the player shows the embed.

const cache = new Map();
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const VIDEO_HOSTS = ['v1.pinimg.com', 'video.twimg.com'];

// Overridable for tests (pointed at a local stand-in).
const BASE = {
  pinterestApi: process.env.PINTEREST_API_BASE || 'https://widgets.pinterest.com',
  pinterest: process.env.PINTEREST_BASE || 'https://www.pinterest.com',
  fx: process.env.FXTWITTER_BASE || 'https://api.fxtwitter.com',
  vx: process.env.VXTWITTER_BASE || 'https://api.vxtwitter.com',
};

async function get(url, accept) {
  const u = new URL(url);
  await assertPublic(u);
  const res = await fetch(u, { signal: AbortSignal.timeout(7000), headers: { 'user-agent': UA, accept, 'accept-language': 'en' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).slice(0, 4 * 1024 * 1024);
}

const okVideo = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && (VIDEO_HOSTS.includes(u.hostname) || process.env.TEST_ALLOW_PRIVATE_FETCH === '1');
  } catch { return false; }
};

/** The best MP4 in a Pinterest page or API answer (an HLS-only pin maps to its 720p MP4). */
export function pickPinterest(text) {
  const t = text.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const mp4 = [...new Set(t.match(/https:\/\/v1\.pinimg\.com\/videos\/[^"'\s\\<>]+?\.mp4/g) || [])];
  if (mp4.length) return mp4.find((u) => /\/720p\//.test(u)) || mp4.find((u) => /expmp4/i.test(u)) || mp4[0];
  // Pinterest keeps the same path for its HLS stream and its 720p MP4.
  const hls = t.match(/https:\/\/v1\.pinimg\.com\/videos\/(?:mc|iht)\/hls\/([0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32})[^"'\s\\<>]*?\.m3u8/i);
  return hls ? `https://v1.pinimg.com/videos/mc/720p/${hls[1]}.mp4` : null;
}

async function pinterest(id) {
  for (const url of [`${BASE.pinterestApi}/v3/pidgets/pins/info/?pin_ids=${id}`, `${BASE.pinterest}/pin/${id}/`]) {
    try {
      const v = pickPinterest(await get(url, url.includes('pidgets') ? 'application/json' : 'text/html'));
      if (v) return { video: v, gif: false };
    } catch { /* try the next source */ }
  }
  return null;
}

async function tweet(id) {
  try {
    const d = JSON.parse(await get(`${BASE.fx}/status/${id}`, 'application/json'));
    const v = d?.tweet?.media?.videos?.[0];
    if (v?.url) return { video: v.url, gif: v.type === 'gif' };
  } catch { /* try the other service */ }
  try {
    const d = JSON.parse(await get(`${BASE.vx}/Twitter/status/${id}`, 'application/json'));
    const v = (d?.media_extended || []).find((m) => m.type === 'video' || m.type === 'gif');
    if (v?.url) return { video: v.url, gif: v.type === 'gif' };
  } catch { /* nothing found */ }
  return null;
}

/** { video, gif } for a post or pin with a video, or { video: null }. */
export async function postVideo(rawUrl) {
  const u = new URL(rawUrl);
  const host = u.hostname.replace(/^(www|m|mobile)\./, '');
  let key = null;
  let find = null;
  const pin = /(^|\.)pinterest\.[a-z]{2,3}(\.[a-z]{2})?$/.test(u.hostname) && u.pathname.match(/^\/pin\/(?:[^/]*--)?(\d+)/)?.[1];
  const status = ['x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com'].includes(host) && u.pathname.match(/^\/(?:\w+|i(?:\/web)?)\/status(?:es)?\/(\d+)/)?.[1];
  if (pin) { key = `p:${pin}`; find = () => pinterest(pin); }
  if (status) { key = `x:${status}`; find = () => tweet(status); }
  if (!key) return { video: null };
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - 6 * 3600 * 1000) return hit.value;
  const found = await find();
  const value = found && okVideo(found.video) ? found : { video: null };
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}
