// Run: node --test tests/
// Exercises worker/src/index.js directly with an in-memory KV.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ORIGIN = 'https://owner.github.io';
const BASE = 'https://sync.example';
let worker;

test.before(async () => {
  worker = (await import(pathToFileURL(path.join(__dirname, '../worker/src/index.js')))).default;
});

function makeEnv() {
  const store = new Map();
  return {
    store,
    ALLOWED_ORIGIN: ORIGIN,
    QAMUS: {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, v); },
    },
  };
}

function req(method, p, { body, origin = ORIGIN, headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  return new Request(BASE + p, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
}

const empty = () => ({ v: 1, updatedAt: 0, history: [], folders: [], cards: [], reviews: {}, settings: { updatedAt: 0 } });
const card = (id, updatedAt, extra = {}) => ({ id, folder: 'f_inbox', word: 'كتاب', updatedAt, deleted: false, ...extra });

test('HEAD 404 → PUT creates → HEAD 200 → GET returns doc', async () => {
  const env = makeEnv();
  let r = await worker.fetch(req('HEAD', '/u/test-abcd'), env);
  assert.equal(r.status, 404);
  const d = empty(); d.cards.push(card('c1', Date.now()));
  r = await worker.fetch(req('PUT', '/u/test-abcd', { body: d }), env);
  assert.equal(r.status, 200);
  const merged = await r.json();
  assert.equal(merged.cards.length, 1);
  assert.ok(merged.updatedAt > 0);
  r = await worker.fetch(req('HEAD', '/u/TEST-abcd'), env);   // case-folded
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '');
  r = await worker.fetch(req('GET', '/u/test-abcd'), env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await r.json(), merged);
  assert.ok(env.store.has('user:test-abcd'));
});

test('PUT merges with the stored document', async () => {
  const env = makeEnv();
  const t = Date.now();
  const a = empty(); a.cards.push(card('c1', t, { gloss: 'A' }), card('c2', t));
  const b = empty(); b.cards.push(card('c1', t + 10, { gloss: 'B' }), card('c3', t));
  await worker.fetch(req('PUT', '/u/user1', { body: a }), env);
  const r = await worker.fetch(req('PUT', '/u/user1', { body: b }), env);
  const m = await r.json();
  assert.deepEqual(m.cards.map(c => c.id), ['c1', 'c2', 'c3']);
  assert.equal(m.cards[0].gloss, 'B');
});

test('400 for invalid username and invalid JSON', async () => {
  const env = makeEnv();
  for (const u of ['ab', 'a'.repeat(33), 'bad%20name', 'x.y.z']) {
    const r = await worker.fetch(req('GET', '/u/' + u), env);
    assert.equal(r.status, 400, u);
  }
  const r = await worker.fetch(req('PUT', '/u/user1', { body: '{not json' }), env);
  assert.equal(r.status, 400);
});

test('413 for bodies over 1 MB', async () => {
  const env = makeEnv();
  const r = await worker.fetch(req('PUT', '/u/user1', { body: 'x'.repeat(1048577) }), env);
  assert.equal(r.status, 413);
});

test('422 for bad shape and too many cards', async () => {
  const env = makeEnv();
  let r = await worker.fetch(req('PUT', '/u/user1', { body: { ...empty(), extra: true } }), env);
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /unknown field/);
  const d = empty();
  for (let i = 0; i < 5001; i++) d.cards.push({ id: 'c' + i, folder: 'f', word: 'w', updatedAt: 1 });
  r = await worker.fetch(req('PUT', '/u/user1', { body: d }), env);
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /too many cards/);
  assert.equal(env.store.has('user:user1'), false);
});

test('422 when the merged result exceeds limits', async () => {
  const env = makeEnv();
  const t = Date.now();
  const a = empty(), b = empty();
  for (let i = 0; i < 3000; i++) a.cards.push({ id: 'a' + i, folder: 'f', word: 'w', updatedAt: t });
  for (let i = 0; i < 3000; i++) b.cards.push({ id: 'b' + i, folder: 'f', word: 'w', updatedAt: t });
  assert.equal((await worker.fetch(req('PUT', '/u/user1', { body: a }), env)).status, 200);
  assert.equal((await worker.fetch(req('PUT', '/u/user1', { body: b }), env)).status, 422);
});

test('a sync costs exactly one KV write (rate limiting stays out of KV)', async () => {
  const env = makeEnv();
  let puts = 0;
  const put = env.QAMUS.put; env.QAMUS.put = async (k, v) => { puts++; return put(k, v); };
  for (let i = 0; i < 3; i++) assert.equal((await worker.fetch(req('PUT', '/u/one-write', { body: empty() }), env)).status, 200);
  assert.equal(puts, 3);
  assert.deepEqual([...env.store.keys()], ['user:one-write']);
});

test('uses the WRITES rate-limit binding when present: 429 when it says no, fails open if it throws', async () => {
  const env = makeEnv();
  const calls = [];
  let allow = true;
  env.WRITES = { async limit(o) { calls.push(o.key); if (allow === 'throw') throw new Error('limiter down'); return { success: allow }; } };
  assert.equal((await worker.fetch(req('PUT', '/u/bound-user', { body: empty() }), env)).status, 200);
  assert.deepEqual(calls, ['bound-user']);
  allow = false;
  const before = env.store.get('user:bound-user');
  const r = await worker.fetch(req('PUT', '/u/bound-user', { body: { ...empty(), cards: [card('c1', 5)] } }), env);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('Retry-After'), '60');
  assert.equal(env.store.get('user:bound-user'), before);   // nothing written
  allow = 'throw';
  assert.equal((await worker.fetch(req('PUT', '/u/bound-user', { body: empty() }), env)).status, 200);
});

test('429 on the 61st write in a minute (fallback counter, no binding)', async () => {
  const env = makeEnv();
  // Pin the clock mid-minute so the test never straddles a window boundary.
  const realNow = Date.now;
  const t0 = Math.floor(realNow() / 60000) * 60000 + 1000;
  Date.now = () => t0;
  try {
    for (let i = 0; i < 60; i++) {
      const r = await worker.fetch(req('PUT', '/u/busy-user', { body: empty() }), env);
      assert.equal(r.status, 200, `write ${i + 1}`);
    }
    const r = await worker.fetch(req('PUT', '/u/busy-user', { body: empty() }), env);
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('Retry-After')) > 0);
    // Other users are unaffected.
    assert.equal((await worker.fetch(req('PUT', '/u/other-user', { body: empty() }), env)).status, 200);
    // Next minute is a fresh window.
    Date.now = () => t0 + 60000;
    assert.equal((await worker.fetch(req('PUT', '/u/busy-user', { body: empty() }), env)).status, 200);
  } finally {
    Date.now = realNow;
  }
});

test('CORS: allowed origin, localhost any port, foreign origin blocked', async () => {
  const env = makeEnv();
  const acao = async origin => (await worker.fetch(req('HEAD', '/u/user1', { origin }), env)).headers.get('Access-Control-Allow-Origin');
  assert.equal(await acao(ORIGIN), ORIGIN);
  assert.equal(await acao('http://localhost:5500'), 'http://localhost:5500');
  assert.equal(await acao('http://localhost'), 'http://localhost');
  assert.equal(await acao('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(await acao('https://evil.example'), null);
  assert.equal(await acao('http://localhost.evil.example'), null);
  assert.equal(await acao('https://owner.github.io.evil.example'), null);
  const r = await worker.fetch(req('HEAD', '/u/user1', { origin: 'https://evil.example' }), env);
  assert.equal(r.headers.get('Vary'), 'Origin');
});

test('OPTIONS preflight', async () => {
  const env = makeEnv();
  const r = await worker.fetch(req('OPTIONS', '/u/user1', { headers: { 'Access-Control-Request-Method': 'PUT' } }), env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(r.headers.get('Access-Control-Allow-Methods'), /PUT/);
  assert.match(r.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
});

test('404 for other paths, 405 for other methods', async () => {
  const env = makeEnv();
  assert.equal((await worker.fetch(req('GET', '/'), env)).status, 404);
  assert.equal((await worker.fetch(req('GET', '/u/a/b'), env)).status, 404);
  const r = await worker.fetch(req('DELETE', '/u/user1'), env);
  assert.equal(r.status, 405);
});
