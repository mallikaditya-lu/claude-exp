import dns from 'node:dns/promises';
import net from 'node:net';

// Fetches Open Graph metadata for link cards. Only public http(s) hosts are allowed,
// and every redirect hop is re-checked, so the server can't be used to probe the internal network.

const cache = new Map();
const MAX_BYTES = 512 * 1024;

export async function unfurl(rawUrl) {
  if (cache.has(rawUrl)) return cache.get(rawUrl);
  let url = new URL(rawUrl);
  let res;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; ReferenceBoardBot/1.0; +link-preview)',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en',
      },
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url);
      continue;
    }
    break;
  }
  const type = res.headers.get('content-type') || '';
  const meta = { url: url.href, title: '', description: '', image: '', siteName: url.hostname.replace(/^www\./, '') };
  if (type.includes('text/html')) {
    const html = await readCapped(res);
    const tags = parseMeta(html);
    meta.title = tags['og:title'] || tags['twitter:title'] || matchTitle(html) || '';
    meta.description = tags['og:description'] || tags['twitter:description'] || tags.description || '';
    const img = tags['og:image'] || tags['og:image:url'] || tags['twitter:image'] || '';
    if (img) {
      try { meta.image = new URL(img, url).href; } catch { /* ignore bad image urls */ }
    }
    if (tags['og:site_name']) meta.siteName = tags['og:site_name'];
  } else {
    await res.body?.cancel();
  }
  for (const k of ['title', 'description', 'siteName']) meta[k] = decode(meta[k]).trim().slice(0, 400);
  cache.set(rawUrl, meta);
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return meta;
}

async function assertPublic(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) links can be previewed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error('Host is not public');
}

function isPrivate(ip) {
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8')
    || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

async function readCapped(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

function parseMeta(html) {
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = attr(tag, 'property') || attr(tag, 'name');
    const content = attr(tag, 'content');
    if (key && content && !(key.toLowerCase() in out)) out[key.toLowerCase()] = content;
  }
  return out;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4]) : '';
}

function matchTitle(html) {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '';
}

function decode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
