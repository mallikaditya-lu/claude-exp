import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

// Where uploaded files live.
//  - Local mode (no Google credentials): files sit in DATA_DIR/uploads, as before.
//  - Drive mode: files go to the Google Shared Drive, one folder per project. The app keeps an index
//    (files.json) from its own file names to Drive ids, plus a size-capped local cache of small files
//    so boards full of images open fast. Large files (video) stream from Drive with Range support.
// URLs are always /uploads/<name>, so cards never need to know which backend holds the file.

const ACTIVE_EXT = new Set(['.html', '.htm', '.xhtml', '.svg', '.xml', '.js', '.mjs']);
const CACHE_FILE_MAX = 25 * 1024 * 1024;

export function safeHeaders(res, name) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Uploaded files share our origin, so anything a browser could execute is served as a download.
  if (ACTIVE_EXT.has(path.extname(name).toLowerCase())) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    if (path.extname(name).toLowerCase() !== '.svg') res.setHeader('Content-Disposition', 'attachment');
  }
}

export function makeFileName(original) {
  const ext = path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
  const base = path.basename(original, path.extname(original)).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${base}${ext}`;
}

export class Files {
  constructor({ dataDir, uploadDir, drive = null, cacheMb = 2048 }) {
    this.uploadDir = uploadDir;
    this.drive = drive;
    this.cacheDir = path.join(dataDir, 'cache');
    this.indexFile = path.join(dataDir, 'files.json');
    this.cacheMax = cacheMb * 1024 * 1024;
    this.pending = new Map();
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.mkdirSync(this.cacheDir, { recursive: true });
    try {
      this.index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch {
      this.index = { files: {}, folders: {} };
    }
  }

  get mode() {
    return this.drive ? 'drive' : 'local';
  }

  saveIndex() {
    const tmp = `${this.indexFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.index));
    fs.renameSync(tmp, this.indexFile);
  }

  async folderFor(key, name) {
    if (this.index.folders[key]) return this.index.folders[key];
    if (!this.pending.has(`folder:${key}`)) {
      this.pending.set(`folder:${key}`, this.drive.ensureFolder(name.replace(/[/\\]/g, '-').slice(0, 120)).then((id) => {
        this.index.folders[key] = id;
        this.saveIndex();
        return id;
      }).finally(() => this.pending.delete(`folder:${key}`)));
    }
    return this.pending.get(`folder:${key}`);
  }

  /** Take ownership of a finished upload in `tmpPath`. Returns the card metadata. */
  async store(tmpPath, { original, mime, size, folderKey = 'unfiled', folderName = 'Unfiled' }) {
    const name = makeFileName(original);
    const meta = { url: `/uploads/${name}`, name: original, size, mime };
    if (!this.drive) {
      fs.renameSync(tmpPath, path.join(this.uploadDir, name));
      return meta;
    }
    const parent = await this.folderFor(folderKey, folderName);
    const driveId = await this.drive.upload(tmpPath, { name: original, mime, parent });
    this.index.files[name] = { driveId, size, mime, original, createdAt: Date.now() };
    this.saveIndex();
    if (size <= CACHE_FILE_MAX) this.addToCache(name, tmpPath);
    else fs.rm(tmpPath, { force: true }, () => {});
    return meta;
  }

  addToCache(name, fromPath) {
    const dest = path.join(this.cacheDir, name);
    try {
      fs.renameSync(fromPath, dest);
    } catch {
      fs.copyFileSync(fromPath, dest);
      fs.rmSync(fromPath, { force: true });
    }
    this.trimCache();
  }

  trimCache() {
    const files = fs.readdirSync(this.cacheDir).map((f) => {
      const p = path.join(this.cacheDir, f);
      const st = fs.statSync(p);
      return { p, size: st.size, t: st.atimeMs || st.mtimeMs };
    });
    let total = files.reduce((s, f) => s + f.size, 0);
    if (total <= this.cacheMax) return;
    files.sort((a, b) => a.t - b.t);
    for (const f of files) {
      if (total <= this.cacheMax * 0.8) break;
      fs.rmSync(f.p, { force: true });
      total -= f.size;
    }
  }

  /** Express handler for /uploads/:name (local files are served by express.static before this). */
  async serve(req, res) {
    const name = path.basename(req.params.name);
    const entry = this.index.files[name];
    if (!entry || !this.drive) return res.status(404).json({ error: 'File not found' });
    safeHeaders(res, name);
    res.setHeader('Cache-Control', 'private, max-age=604800');
    const cached = path.join(this.cacheDir, name);

    if (entry.size <= CACHE_FILE_MAX) {
      try {
        if (!fs.existsSync(cached)) {
          if (!this.pending.has(name)) {
            this.pending.set(name, this.fetchToCache(entry, cached).finally(() => this.pending.delete(name)));
          }
          await this.pending.get(name);
        } else {
          const now = new Date();
          fs.utimes(cached, now, now, () => {});
        }
        res.type(entry.mime || path.extname(name));
        return res.sendFile(cached);
      } catch (err) {
        console.error(`Drive fetch failed for ${name}:`, err.message);
        return res.status(502).json({ error: 'Could not load file from Google Drive' });
      }
    }

    // Large files: stream straight through, passing Range so video seeking works.
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    try {
      const up = await this.drive.download(entry.driveId, { range: req.headers.range, signal: abort.signal });
      if (!up.ok && up.status !== 206) {
        res.status(up.status === 416 ? 416 : 502).json({ error: 'Could not load file from Google Drive' });
        await up.body?.cancel();
        return;
      }
      res.status(up.status);
      res.setHeader('Content-Type', entry.mime || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      for (const h of ['content-length', 'content-range']) {
        const v = up.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error(`Drive stream failed for ${name}:`, err.message);
      if (!res.headersSent) res.status(502).json({ error: 'Could not load file from Google Drive' });
      else res.destroy();
    }
  }

  /** The bytes of an uploaded file (local, cached, or from Drive). Throws if missing or too large. */
  async read(name, maxBytes = 40 * 1024 * 1024) {
    name = path.basename(name);
    const local = path.join(this.uploadDir, name);
    if (fs.existsSync(local)) {
      if (fs.statSync(local).size > maxBytes) throw new Error('File too large');
      return fs.readFileSync(local);
    }
    const entry = this.index.files[name];
    if (!entry || !this.drive) throw new Error('File not found');
    if (entry.size > maxBytes) throw new Error('File too large');
    const cached = path.join(this.cacheDir, name);
    if (entry.size <= CACHE_FILE_MAX) {
      if (!fs.existsSync(cached)) {
        if (!this.pending.has(name)) this.pending.set(name, this.fetchToCache(entry, cached).finally(() => this.pending.delete(name)));
        await this.pending.get(name);
      }
      return fs.readFileSync(cached);
    }
    const up = await this.drive.download(entry.driveId);
    if (!up.ok) throw new Error(`Drive download ${up.status}`);
    return Buffer.from(await up.arrayBuffer());
  }

  async fetchToCache(entry, dest) {
    const up = await this.drive.download(entry.driveId);
    if (!up.ok) throw new Error(`Drive download ${up.status}`);
    const tmp = `${dest}.${process.pid}.part`;
    fs.writeFileSync(tmp, Buffer.from(await up.arrayBuffer()));
    fs.renameSync(tmp, dest);
    this.trimCache();
  }

  // ---------- backups of board data ----------
  /** Daily snapshot of every board + project. Drive mode: into "_Backups" on the Shared Drive. */
  async backup(snapshot, { keep = 30 } = {}) {
    const stamp = new Date().toISOString().slice(0, 10);
    const gz = zlib.gzipSync(JSON.stringify(snapshot));
    const fileName = `boards-${stamp}.json.gz`;
    if (!this.drive) {
      const dir = path.join(path.dirname(this.indexFile), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, fileName), gz);
      const old = fs.readdirSync(dir).sort().reverse().slice(keep);
      for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
      return fileName;
    }
    const folder = await this.folderFor('_backups', '_Backups (board data)');
    const existing = await this.drive.list(folder);
    if (existing.some((f) => f.name === fileName)) return null; // already backed up today
    const tmp = path.join(this.cacheDir, `.${fileName}.${process.pid}`);
    fs.writeFileSync(tmp, gz);
    try {
      await this.drive.upload(tmp, { name: fileName, mime: 'application/gzip', parent: folder });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    for (const f of existing.slice(keep - 1)) await this.drive.trash(f.id).catch(() => {});
    return fileName;
  }
}
