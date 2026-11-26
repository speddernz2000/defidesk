// Sync API. Cloudflare Access guards the whole site; this Worker still verifies the Access token itself
// before touching the database, and every row is keyed by the signed-in email.
const KEYS = new Set(['wallets', 'watched', 'paper']);
const MAX_BYTES = 500_000;

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const part = (s) => JSON.parse(new TextDecoder().decode(b64(s)));

let certs = { at: 0, keys: [] };
async function signingKey(team, kid) {
  let k = certs.keys.find((x) => x.kid === kid);
  if (!k || Date.now() - certs.at > 3600_000) {
    const r = await fetch(`${team}/cdn-cgi/access/certs`);
    if (!r.ok) throw new Error('certs unavailable');
    certs = { at: Date.now(), keys: (await r.json()).keys };
    k = certs.keys.find((x) => x.kid === kid);
  }
  return k && crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/** The signed-in person's email, or null. Fails closed on anything unexpected. */
async function userEmail(req, env) {
  try {
    const token = req.headers.get('Cf-Access-Jwt-Assertion');
    if (!token || !env.ACCESS_AUD || !env.ACCESS_TEAM) return null;
    const [head, body, sig] = token.split('.');
    const h = part(head), c = part(body);
    if (h.alg !== 'RS256') return null;
    const key = await signingKey(env.ACCESS_TEAM, h.kid);
    if (!key || !(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(sig), new TextEncoder().encode(`${head}.${body}`)))) return null;
    const now = Date.now() / 1000;
    if (c.iss !== env.ACCESS_TEAM || !(c.exp > now) || (c.nbf && c.nbf > now + 60)) return null;
    if (![c.aud].flat().includes(env.ACCESS_AUD)) return null;
    return typeof c.email === 'string' && c.email ? c.email.toLowerCase() : null;
  } catch { return null; }
}

let ready = false;
async function ensureTable(db) {
  if (ready) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS docs (owner TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, version INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (owner, key))').run();
  ready = true;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const owner = await userEmail(req, env);
    if (!owner) return json({ error: 'Not signed in' }, 401);
    await ensureTable(env.DB);

    if (url.pathname === '/api/data' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT key, value, version FROM docs WHERE owner = ?').bind(owner).all();
      return json({ user: owner, docs: Object.fromEntries(results.map((r) => [r.key, { value: JSON.parse(r.value), version: r.version }])) });
    }

    const key = url.pathname.match(/^\/api\/data\/([a-z]+)$/)?.[1];
    if (req.method !== 'PUT' || !KEYS.has(key)) return json({ error: 'Not found' }, 404);
    // Only the app's own pages may write.
    if (req.headers.get('Origin') !== url.origin || !req.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'Forbidden' }, 403);
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: 'Too large' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'Bad JSON' }, 400); }
    if (!body || typeof body.value !== 'object' || body.value === null || !Number.isInteger(body.version)) return json({ error: 'Bad request' }, 400);

    // Write only if nobody else has written since the caller last read (version 0 = no row yet).
    const value = JSON.stringify(body.value), now = Date.now();
    const stmt = body.version === 0
      ? env.DB.prepare('INSERT OR IGNORE INTO docs (owner, key, value, version, updated) VALUES (?, ?, ?, 1, ?)').bind(owner, key, value, now)
      : env.DB.prepare('UPDATE docs SET value = ?, version = version + 1, updated = ? WHERE owner = ? AND key = ? AND version = ?').bind(value, now, owner, key, body.version);
    const { meta } = await stmt.run();
    return meta.changes ? json({ version: body.version + 1 }) : json({ error: 'Conflict' }, 409);
  },
};
