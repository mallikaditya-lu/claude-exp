import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertPublic, parseMeta } from './unfurl.js';

// Fetches media from the web so a pasted GIF stays an animated GIF (browsers put a still PNG on
// the clipboard), and links to images or GIF pages (Giphy, Tenor…) become image/video cards.
// Same rules as link previews: public http(s) hosts only, every redirect re-checked.

const MAX_PAGE = 768 * 1024;
const MEDIA = /^(image|video)\//;

async function get(rawUrl, accept) {
  let url = new URL(rawUrl);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ReferenceBoardBot/1.0)', accept, referer: `${url.origin}/` },
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url); continue; }
    if (!res.ok) throw new Error(`The site answered ${res.status}`);
    return { res, url };
  }
  throw new Error('Too many redirects');
}

/** The bytes of an image on the web (public hosts only), up to maxBytes. */
export async function fetchImage(rawUrl, maxBytes = 15 * 1024 * 1024) {
  const { res } = await get(rawUrl, 'image/*');
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!type.startsWith('image/')) { await res.body?.cancel(); throw new Error('Not an image'); }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Image too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The media a web page is about (Giphy/Tenor-style pages): animated image first, then video. */
function mediaFromPage(html, base) {
  const tags = parseMeta(html);
  const abs = (u) => { try { return u ? new URL(u, base).href : ''; } catch { return ''; } };
  const image = abs(tags['og:image'] || tags['og:image:url'] || tags['twitter:image']);
  const video = abs(tags['og:video:secure_url'] || tags['og:video:url'] || tags['og:video'] || tags['twitter:player:stream']);
  if (/\.(gif|webp)(\?|$)/i.test(image)) return image;
  if (/\.(mp4|webm)(\?|$)/i.test(video)) return video;
  return null;
}

/**
 * Download `rawUrl` into `tmpDir` if it is (or a page about) an image or video.
 * Returns { path, mime, size, name, sourceUrl } or null when it's an ordinary web page.
 */
export async function importMedia(rawUrl, tmpDir, maxBytes) {
  let { res, url } = await get(rawUrl, 'image/*,video/*,text/html;q=0.8,*/*;q=0.5');
  let mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (mime === 'text/html') {
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < MAX_PAGE) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    const media = mediaFromPage(Buffer.concat(chunks).toString('utf8'), url);
    if (!media) return null;
    ({ res, url } = await get(media, 'image/*,video/*'));
    mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  }
  if (!MEDIA.test(mime) || mime === 'image/svg+xml') { await res.body?.cancel(); return null; }
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > maxBytes) { await res.body?.cancel(); throw new Error('That file is too large to import'); }
  const file = path.join(tmpDir, `import-${crypto.randomUUID()}`);
  const out = fs.createWriteStream(file);
  let size = 0;
  try {
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('That file is too large to import');
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    fs.rm(file, { force: true }, () => {});
    throw err;
  }
  const ext = { 'image/gif': 'gif', 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }[mime] || mime.split('/')[1] || 'bin';
  let base = decodeURIComponent(url.pathname.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '') || 'image';
  if (/^(giphy|tenor|200|source)$/i.test(base)) base = url.hostname.replace(/^(www|media\d*|i|c)\./, '').split('.')[0] + '-' + base;
  return { path: file, mime, size, name: `${base.slice(0, 80)}.${ext}`, sourceUrl: url.href };
}
