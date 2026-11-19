// Qamus sync Worker: one document per username, merged on every PUT.
// Stored in D1 (table docs) when the DB binding is present; accounts saved before the move to D1 are still in KV
// (key user:<name>) and are read from there until their next write, which puts them in D1.
import QamusMerge from '../../merge.js';

const { merge, validateDoc, checkLimits, normUsername, LIMITS } = QamusMerge;

const RATE_PER_MIN = 60;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin');
  const h = { Vary: 'Origin' };
  // ALLOWED_ORIGIN may list several sites, comma-separated (the new address and the old one during a move)
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (origin && (allowed.includes(origin) || LOCAL_ORIGIN.test(origin))) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, HEAD, PUT, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(status, body, cors, extra = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors, ...extra },
  });
}

async function readBody(req) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > LIMITS.bytes) return { tooBig: true };
  const buf = await req.arrayBuffer();
  if (buf.byteLength > LIMITS.bytes) return { tooBig: true };
  return { text: new TextDecoder().decode(buf) };
}

// Rate limiting never touches storage: each sync costs exactly one write (KV's free plan allows 1,000 a day,
// D1's 100,000 rows written a day). Production uses the Workers rate-limiting binding (WRITES in
// wrangler.toml). Without it (unit tests, local runtimes lacking the binding) a per-isolate counter
// gives best-effort limiting.
const memWindows = new Map();
async function rateLimited(env, user, now) {
  if (env.WRITES && typeof env.WRITES.limit === 'function') {
    try {
      const { success } = await env.WRITES.limit({ key: user });
      return success ? 0 : 60;
    } catch { return 0; }   // fail open: a limiter hiccup must not block sync
  }
  const win = Math.floor(now / 60000);
  const e = memWindows.get(user);
  const n = e && e.win === win ? e.n : 0;
  if (n >= RATE_PER_MIN) return Math.ceil((60000 - (now % 60000)) / 1000) || 1;
  memWindows.set(user, { win, n: n + 1 });
  if (memWindows.size > 5000) for (const [k, v] of memWindows) if (v.win < win) memWindows.delete(k);
  return 0;
}

// ---- storage ----
async function load(env, user) {
  if (env.DB) {
    const row = await env.DB.prepare('SELECT doc FROM docs WHERE user = ?1').bind(user).first();
    if (row) return row.doc;
  }
  return env.QAMUS ? env.QAMUS.get('user:' + user) : null;   // not moved to D1 yet (or no D1 at all)
}
async function save(env, user, text, now) {
  if (env.DB) {
    await env.DB.prepare('INSERT INTO docs (user, doc, updated_at) VALUES (?1, ?2, ?3) ' +
      'ON CONFLICT(user) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at').bind(user, text, now).run();
    return;
  }
  await env.QAMUS.put('user:' + user, text);
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/u\/([^/]+)\/?$/);
    if (!m) return json(404, { error: 'not found' }, cors);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    let raw;
    try { raw = decodeURIComponent(m[1]); } catch { raw = ''; }
    const user = normUsername(raw);
    if (!user) return json(400, { error: 'invalid username (3–32 chars, a-z 0-9 _ -)' }, cors);

    if (req.method === 'GET' || req.method === 'HEAD') {
      const stored = await load(env, user);
      if (stored === null) return json(404, req.method === 'HEAD' ? null : { error: 'no such user' }, cors);
      if (req.method === 'HEAD') return json(200, null, cors);
      return new Response(stored, {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
      });
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (body.tooBig) return json(413, { error: 'body too large (max 1 MB)' }, cors);
      let doc;
      try { doc = JSON.parse(body.text); } catch { return json(400, { error: 'invalid JSON' }, cors); }
      const v = validateDoc(doc);
      if (!v.ok) return json(422, { error: v.error }, cors);
      const lim = checkLimits(doc);
      if (lim) return json(422, { error: lim }, cors);

      const now = Date.now();
      const wait = await rateLimited(env, user, now);
      if (wait) return json(429, { error: 'too many writes, slow down' }, cors, { 'Retry-After': String(wait) });

      const storedText = await load(env, user);
      let stored = null;
      if (storedText !== null) { try { stored = JSON.parse(storedText); } catch { stored = null; } }
      const merged = merge(stored, doc, now);
      merged.updatedAt = now;
      const lim2 = checkLimits(merged);
      if (lim2) return json(422, { error: lim2 }, cors);
      const out = JSON.stringify(merged);
      if (new TextEncoder().encode(out).byteLength > LIMITS.bytes) return json(413, { error: 'merged document too large (max 1 MB)' }, cors);
      await save(env, user, out, now);
      return new Response(out, {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
      });
    }

    return json(405, { error: 'method not allowed' }, cors, { Allow: 'GET, HEAD, PUT, OPTIONS' });
  },
};
