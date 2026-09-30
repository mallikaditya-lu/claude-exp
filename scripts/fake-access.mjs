// Stand-in for Cloudflare Access, for testing sign-in without a real Cloudflare account.
// Serves the team's public keys and mints login tokens:
//   node scripts/fake-access.mjs 4020
//   curl localhost:4020/token?email=alice@example.com      → a CF_Authorization token
// Run the app with:
//   CF_ACCESS_TEAM_DOMAIN=test.cloudflareaccess.com CF_ACCESS_AUD=test-aud \
//   CF_ACCESS_CERTS_URL=http://localhost:4020/cdn-cgi/access/certs npm start
import http from 'node:http';
import crypto from 'node:crypto';

const port = Number(process.argv[2]) || 4020;
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = crypto.randomBytes(8).toString('hex');
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function mint({ email, aud = 'test-aud', iss = 'https://test.cloudflareaccess.com', ttl = 3600 }) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64({ email, aud: [aud], iss, iat: now, exp: now + ttl, sub: crypto.randomUUID() });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/cdn-cgi/access/certs') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ keys: [jwk] }));
  }
  if (url.pathname === '/token') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(mint({
      email: url.searchParams.get('email') || 'someone@example.com',
      aud: url.searchParams.get('aud') || undefined,
      iss: url.searchParams.get('iss') || undefined,
      ttl: url.searchParams.has('ttl') ? Number(url.searchParams.get('ttl')) : undefined,
    }));
  }
  res.writeHead(404);
  res.end();
}).listen(port, () => console.log(`fake Cloudflare Access on http://localhost:${port}`));
