// Qamus sync Worker: one KV document per username, merged on every PUT.
import QamusMerge from '../../merge.js';

const { merge, validateDoc, checkLimits, normUsername, LIMITS } = QamusMerge;

const RATE_PER_MIN = 60;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin');
  const h = { Vary: 'Origin' };
  if (origin && (origin === env.ALLOWED_ORIGIN || LOCAL_ORIGIN.test(origin))) {
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

async function rateLimited(env, user, now) {
  const key = `rl:${user}:${Math.floor(now / 60000)}`;
  const n = Number(await env.QAMUS.get(key)) || 0;
  if (n >= RATE_PER_MIN) return Math.ceil((60000 - (now % 60000)) / 1000) || 1;
  await env.QAMUS.put(key, String(n + 1), { expirationTtl: 120 });
  return 0;
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
    const key = `user:${user}`;

    if (req.method === 'GET' || req.method === 'HEAD') {
      const stored = await env.QAMUS.get(key);
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

      const storedText = await env.QAMUS.get(key);
      let stored = null;
      if (storedText !== null) { try { stored = JSON.parse(storedText); } catch { stored = null; } }
      const merged = merge(stored, doc, now);
      merged.updatedAt = now;
      const lim2 = checkLimits(merged);
      if (lim2) return json(422, { error: lim2 }, cors);
      const out = JSON.stringify(merged);
      if (new TextEncoder().encode(out).byteLength > LIMITS.bytes) return json(413, { error: 'merged document too large (max 1 MB)' }, cors);
      await env.QAMUS.put(key, out);
      return new Response(out, {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
      });
    }

    return json(405, { error: 'method not allowed' }, cors, { Allow: 'GET, HEAD, PUT, OPTIONS' });
  },
};
