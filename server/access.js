import crypto from 'node:crypto';

// Cloudflare Access puts a signed JWT on every request that passed its login
// (header Cf-Access-Jwt-Assertion, cookie CF_Authorization). We verify it against the team's public
// keys so the app knows *who* is signed in — and so nobody can skip the login by going straight to
// the Railway URL.
//
// Env: CF_ACCESS_TEAM_DOMAIN  e.g. littleunusual.cloudflareaccess.com
//      CF_ACCESS_AUD          the application's "Audience (AUD) tag" from the Access dashboard

export class AccessVerifier {
  constructor(teamDomain, aud) {
    this.team = teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    this.issuer = `https://${this.team}`;
    this.aud = aud;
    this.certsUrl = process.env.CF_ACCESS_CERTS_URL || `${this.issuer}/cdn-cgi/access/certs`;
    this.keys = new Map();
    this.fetchedAt = 0;
    this.fetching = null;
  }

  async loadKeys(force = false) {
    if (!force && this.keys.size && Date.now() - this.fetchedAt < 3600_000) return;
    if (!this.fetching) {
      this.fetching = (async () => {
        const res = await fetch(this.certsUrl, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`Access certs ${res.status}`);
        const { keys = [] } = await res.json();
        this.keys = new Map(keys.map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })]));
        this.fetchedAt = Date.now();
      })().finally(() => { this.fetching = null; });
    }
    return this.fetching;
  }

  static tokenFrom(req) {
    const header = req.headers['cf-access-jwt-assertion'];
    if (header) return String(header);
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /** Returns { email } for a valid token, or null. */
  async verify(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let header;
    let claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    } catch {
      return null;
    }
    if (header.alg !== 'RS256') return null;
    await this.loadKeys();
    if (!this.keys.has(header.kid)) await this.loadKeys(true); // keys rotate
    const key = this.keys.get(header.kid);
    if (!key) return null;
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) return null;
    const now = Math.floor(Date.now() / 1000);
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(this.aud)) return null;
    if (claims.iss !== this.issuer) return null;
    if (typeof claims.exp !== 'number' || claims.exp < now - 30) return null;
    if (typeof claims.email !== 'string' || !claims.email) return null;
    return { email: claims.email.toLowerCase() };
  }
}
