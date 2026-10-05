import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { GifReader } from 'omggif';

// Small JPEG previews of board images, so the Claude connector can show them to the model.
// Pure JavaScript (no native image libraries). Results are cached on disk.

const MAX_SIDE = 1024;
const SEND_AS_IS = 350 * 1024; // small files go as they are
const MODEL_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** RGBA pixels → at most MAX_SIDE on the long side (box filter), flattened onto white. */
function shrink({ width, height, data }) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = Buffer.alloc(w * h * 4);
  const sx = width / w;
  const sy = height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 4;
          const a = data[i + 3] / 255;
          r += data[i] * a + 255 * (1 - a);
          g += data[i + 1] * a + 255 * (1 - a);
          b += data[i + 2] * a + 255 * (1 - a);
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

function decode(buf, type) {
  if (type === 'image/jpeg') return jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
  if (type === 'image/png') return PNG.sync.read(buf);
  if (type === 'image/gif') {
    const g = new GifReader(new Uint8Array(buf));
    const data = Buffer.alloc(g.width * g.height * 4);
    g.decodeAndBlitFrameRGBA(0, data); // first frame
    return { width: g.width, height: g.height, data };
  }
  return null;
}

export class Thumbs {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'thumbs');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * An image the model can look at: { data (base64), mimeType, note? } or null with a reason.
   * `key` identifies the source (for the cache); `load` returns the original bytes.
   */
  async preview(key, load) {
    const cached = path.join(this.dir, `${crypto.createHash('sha1').update(key).digest('hex')}.jpg`);
    if (fs.existsSync(cached)) return { data: fs.readFileSync(cached).toString('base64'), mimeType: 'image/jpeg' };
    const buf = await load();
    const type = sniff(buf);
    if (!type) return { error: 'not an image the model can read' };
    if (buf.length <= SEND_AS_IS && MODEL_TYPES.has(type)) return { data: buf.toString('base64'), mimeType: type };
    const pixels = decode(buf, type);
    if (!pixels) {
      // WebP (no pure-JS decoder): send it as it is if it isn't too big.
      if (buf.length <= 3.5 * 1024 * 1024) return { data: buf.toString('base64'), mimeType: type };
      return { error: 'too large to preview' };
    }
    const small = jpeg.encode(shrink(pixels), 82).data;
    fs.writeFileSync(cached, small);
    return { data: Buffer.from(small).toString('base64'), mimeType: 'image/jpeg' };
  }
}
