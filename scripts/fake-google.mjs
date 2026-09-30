// A small stand-in for Google's OAuth + Drive v3 endpoints, for testing the Drive storage
// without real credentials. FAIL_RATE=0.2 makes 20% of upload chunks fail to exercise resume.
//   node scripts/fake-google.mjs 4010
import http from 'node:http';
import crypto from 'node:crypto';

const port = Number(process.argv[2]) || 4010;
const failRate = Number(process.env.FAIL_RATE) || 0;
const files = new Map(); // id -> { name, parents, mimeType, data: Buffer, trashed }
const sessions = new Map(); // id -> { meta, size, chunks: Buffer[], received }
const stats = { chunkPuts: 0, injectedFailures: 0, rangeReads: 0 };

const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const body = await readBody(req);
  if (url.pathname === '/__stats') return json(res, 200, { ...stats, files: [...files.values()].map((f) => ({ name: f.name, size: f.data.length, parents: f.parents, trashed: f.trashed })) });
  if (url.pathname === '/token') return json(res, 200, { access_token: 'fake-token', expires_in: 3600 });
  if (req.headers.authorization !== 'Bearer fake-token') return json(res, 401, { error: 'unauthenticated' });

  let m;
  if ((m = url.pathname.match(/^\/drive\/v3\/drives\/([^/]+)$/))) return json(res, 200, { id: m[1], name: 'Reference Board (fake)' });

  if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const name = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\'/g, "'");
    const parent = q.match(/'([^']+)' in parents/)?.[1];
    const folderOnly = q.includes('google-apps.folder');
    const list = [...files.entries()]
      .filter(([, f]) => !f.trashed && (!parent || f.parents.includes(parent)) && (!name || f.name === name) && (!folderOnly || f.mimeType === 'application/vnd.google-apps.folder'))
      .map(([id, f]) => ({ id, name: f.name, createdTime: new Date(f.created).toISOString(), size: String(f.data.length) }))
      .sort((a, b) => b.createdTime.localeCompare(a.createdTime));
    return json(res, 200, { files: list });
  }
  if (url.pathname === '/drive/v3/files' && req.method === 'POST') {
    const meta = JSON.parse(body);
    const id = crypto.randomUUID();
    files.set(id, { ...meta, data: Buffer.alloc(0), created: Date.now() });
    return json(res, 200, { id });
  }
  if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
    const id = crypto.randomUUID();
    sessions.set(id, { meta: JSON.parse(body), size: Number(req.headers['x-upload-content-length']), mime: req.headers['x-upload-content-type'], chunks: [], received: 0 });
    res.writeHead(200, { location: `http://localhost:${port}/upload/session/${id}` });
    return res.end();
  }
  if ((m = url.pathname.match(/^\/upload\/session\/(.+)$/)) && req.method === 'PUT') {
    const s = sessions.get(m[1]);
    if (!s) return json(res, 404, { error: 'no session' });
    const cr = String(req.headers['content-range'] || '');
    const done = () => {
      const id = crypto.randomUUID();
      files.set(id, { name: s.meta.name, parents: s.meta.parents, mimeType: s.mime, data: Buffer.concat(s.chunks), created: Date.now() });
      sessions.delete(m[1]);
      return json(res, 200, { id });
    };
    const progress = () => { res.writeHead(308, s.received ? { range: `bytes=0-${s.received - 1}` } : {}); res.end(); };
    if (cr.startsWith('bytes */')) return s.received === s.size ? done() : progress();
    stats.chunkPuts++;
    if (Math.random() < failRate) { stats.injectedFailures++; return json(res, 503, { error: 'injected failure' }); }
    const [, start] = cr.match(/bytes (\d+)-(\d+)\/(\d+)/) || [];
    if (Number(start) !== s.received) return progress();
    s.chunks.push(body);
    s.received += body.length;
    return s.received >= s.size ? done() : progress();
  }
  if ((m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
    const f = files.get(m[1]);
    if (!f) return json(res, 404, { error: 'not found' });
    if (req.method === 'PATCH') { Object.assign(f, JSON.parse(body)); return json(res, 200, { id: m[1] }); }
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (range) {
      stats.rangeReads++;
      const s = Number(range[1]);
      const e = range[2] ? Math.min(Number(range[2]), f.data.length - 1) : f.data.length - 1;
      res.writeHead(206, { 'content-type': f.mimeType, 'content-length': e - s + 1, 'content-range': `bytes ${s}-${e}/${f.data.length}` });
      return res.end(f.data.subarray(s, e + 1));
    }
    res.writeHead(200, { 'content-type': f.mimeType, 'content-length': f.data.length });
    return res.end(f.data);
  }
  json(res, 404, { error: `fake: no route ${req.method} ${url.pathname}` });
}).listen(port, () => console.log(`fake Google on http://localhost:${port}`));
