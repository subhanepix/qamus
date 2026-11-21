// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../merge.js');

const NOW = 1_800_000_000_000;
const DAY = 86400000;

function doc(parts = {}) { return { ...M.emptyDoc(), ...parts }; }
const card = (id, updatedAt, extra = {}) => ({ id, folder: 'f_inbox', word: 'كتاب', updatedAt, deleted: false, ...extra });
const folder = (id, updatedAt, extra = {}) => ({ id, name: id, parent: null, createdAt: 0, updatedAt, deleted: false, ...extra });
const live = d => d.history.filter(h => !h.deleted);

test('globalThis.QamusMerge is set', () => {
  assert.equal(globalThis.QamusMerge, M);
});

test('cards/folders: union by id, newer updatedAt wins', () => {
  const a = doc({ cards: [card('c1', 10, { gloss: 'old' }), card('c2', 5)], folders: [folder('f1', 3, { name: 'A' })] });
  const b = doc({ cards: [card('c1', 20, { gloss: 'new' }), card('c3', 1)], folders: [folder('f1', 1, { name: 'B' }), folder('f2', 1)] });
  const m = M.merge(a, b, NOW);
  assert.deepEqual(m.cards.map(c => c.id), ['c1', 'c2', 'c3']);
  assert.equal(m.cards.find(c => c.id === 'c1').gloss, 'new');
  assert.equal(m.folders.find(f => f.id === 'f1').name, 'A');
  assert.equal(m.folders.length, 2);
});

test('tombstones: beat older live, lose to newer live, tie goes to tombstone', () => {
  const t = NOW - DAY;
  let m = M.merge(doc({ cards: [card('c1', t - 5)] }), doc({ cards: [card('c1', t, { deleted: true })] }), NOW);
  assert.equal(m.cards[0].deleted, true);
  m = M.merge(doc({ cards: [card('c1', t + 5)] }), doc({ cards: [card('c1', t, { deleted: true })] }), NOW);
  assert.equal(m.cards[0].deleted, false);
  m = M.merge(doc({ cards: [card('c1', t)] }), doc({ cards: [card('c1', t, { deleted: true })] }), NOW);
  assert.equal(m.cards[0].deleted, true);
  m = M.merge(doc({ cards: [card('c1', t, { deleted: true })] }), doc({ cards: [card('c1', t)] }), NOW);
  assert.equal(m.cards[0].deleted, true);
});

test('tombstones older than 30 days are dropped, with their reviews', () => {
  const old = NOW - 31 * DAY, recent = NOW - 29 * DAY;
  const a = doc({
    cards: [card('c_old', old, { deleted: true }), card('c_recent', recent, { deleted: true }), card('c_live', old)],
    folders: [folder('f_old', old, { deleted: true })],
    reviews: { c_old: { due: 1, updatedAt: 1 }, c_live: { due: 2, updatedAt: 1 }, c_gone: { due: 3, updatedAt: 1 } },
  });
  const m = M.merge(a, null, NOW);
  assert.deepEqual(m.cards.map(c => c.id), ['c_live', 'c_recent']);
  assert.equal(m.folders.length, 0);
  assert.deepEqual(Object.keys(m.reviews), ['c_live']);
});

test('reviews: per card, newer updatedAt wins', () => {
  const cards = [card('c1', 1), card('c2', 1)];
  const a = doc({ cards, reviews: { c1: { due: 100, updatedAt: 5 }, c2: { due: 200, updatedAt: 9 } } });
  const b = doc({ cards, reviews: { c1: { due: 111, updatedAt: 6 }, c2: { due: 222, updatedAt: 8 } } });
  const m = M.merge(a, b, NOW);
  assert.equal(m.reviews.c1.due, 111);
  assert.equal(m.reviews.c2.due, 200);
});

test('history: newest entry per q, sorted newest first', () => {
  const a = doc({ history: [{ q: 'كتاب', t: 10 }, { q: 'مدرسة', t: 30 }] });
  const b = doc({ history: [{ q: 'كتاب', t: 40 }, { q: 'قلم', t: 20 }] });
  const m = M.merge(a, b, NOW);
  assert.deepEqual(m.history, [{ q: 'كتاب', t: 40 }, { q: 'مدرسة', t: 30 }, { q: 'قلم', t: 20 }]);
});

test('history: tombstone hides a query; a later re-search beats it', () => {
  const t = NOW - DAY;
  const a = doc({ history: [{ q: 'x', t }] });
  const b = doc({ history: [{ q: 'x', t: t + 1, deleted: true }] });
  let m = M.merge(a, b, NOW);
  assert.equal(live(m).length, 0);
  assert.equal(m.history[0].deleted, true);
  m = M.merge(m, doc({ history: [{ q: 'x', t: t + 2 }] }), NOW);
  assert.deepEqual(m.history, [{ q: 'x', t: t + 2 }]);
  // tie: tombstone wins
  m = M.merge(doc({ history: [{ q: 'y', t }] }), doc({ history: [{ q: 'y', t, deleted: true }] }), NOW);
  assert.equal(m.history[0].deleted, true);
});

test('history: old tombstones pruned', () => {
  const m = M.merge(doc({ history: [{ q: 'x', t: NOW - 31 * DAY, deleted: true }, { q: 'y', t: NOW - 31 * DAY }] }), null, NOW);
  assert.deepEqual(m.history, [{ q: 'y', t: NOW - 31 * DAY }]);
});

test('history: historyClearedAt drops older entries and merges by max', () => {
  const a = doc({ history: [{ q: 'a', t: 10 }, { q: 'b', t: 50 }], settings: { updatedAt: 1 } });
  const b = doc({ history: [{ q: 'c', t: 20 }], settings: { updatedAt: 0, historyClearedAt: 20 } });
  const m = M.merge(a, b, NOW);
  assert.deepEqual(m.history, [{ q: 'b', t: 50 }]);
  assert.equal(m.settings.historyClearedAt, 20);
  assert.equal(m.settings.updatedAt, 1);
});

test('history: capped at 500 live entries (tombstones extra)', () => {
  const h = [];
  for (let i = 0; i < 600; i++) h.push({ q: 'q' + i, t: NOW - i * 1000 });
  h.push({ q: 'dead', t: NOW - 500, deleted: true });
  const m = M.merge(doc({ history: h }), null, NOW);
  assert.equal(live(m).length, 500);
  assert.equal(m.history.length, 501);
  assert.equal(live(m)[0].q, 'q0');
  assert.equal(live(m)[499].q, 'q499');
});

test('settings: newer object wins as a whole', () => {
  const m = M.merge(doc({ settings: { updatedAt: 5, pauseHistory: true } }), doc({ settings: { updatedAt: 9, theme: 'dark' } }), NOW);
  assert.deepEqual(m.settings, { updatedAt: 9, theme: 'dark' });
});

test('merge is commutative, idempotent, and pure', () => {
  const a = doc({
    updatedAt: 3,
    history: [{ q: 'x', t: 5 }, { q: 'y', t: 7, deleted: true }],
    folders: [folder('f1', 2)],
    cards: [card('c1', 4), card('c2', 6, { deleted: true })],
    reviews: { c1: { due: 1, updatedAt: 2 } },
    settings: { updatedAt: 2, historyClearedAt: 1 },
  });
  const b = doc({
    updatedAt: 8,
    history: [{ q: 'x', t: 9 }, { q: 'z', t: 2 }],
    folders: [folder('f1', 3, { name: 'renamed' }), folder('f2', 1)],
    cards: [card('c1', 1), card('c3', 2)],
    reviews: { c1: { due: 9, updatedAt: 3 }, c3: { due: 4, updatedAt: 1 } },
    settings: { updatedAt: 1 },
  });
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  const ab = M.merge(a, b, NOW), ba = M.merge(b, a, NOW);
  assert.deepEqual(ab, ba);
  assert.deepEqual(M.merge(ab, ab, NOW), ab);
  assert.deepEqual(M.merge(ab, a, NOW), ab);
  assert.equal(JSON.stringify(a), sa);
  assert.equal(JSON.stringify(b), sb);
  assert.equal(ab.updatedAt, 8);
  ab.cards[0].word = 'mutated';
  assert.notEqual(a.cards[0].word, 'mutated');
});

test('null / missing sides', () => {
  assert.deepEqual(M.merge(null, null, NOW), M.emptyDoc());
  const a = doc({ cards: [card('c1', 1)] });
  assert.deepEqual(M.merge(a, undefined, NOW).cards, a.cards);
  assert.deepEqual(M.merge(undefined, a, NOW).cards, a.cards);
});

// ---------- validation ----------

const SPEC_DOC = {
  v: 1,
  updatedAt: 1731600000000,
  history: [{ q: 'مسءلة', t: 1731600000000 }],
  folders: [{ id: 'f_x', name: 'دع الأيام', parent: null, createdAt: 0, updatedAt: 0, deleted: false }],
  cards: [{
    id: 'c_x', folder: 'f_x', word: 'كِتَاب', key: 'كتاب', root: 'ك ت ب', source: 'hw', ref: '123',
    gloss: 'book', arGloss: '', translit: 'kitāb', context: '', highlight: '', note: '', tags: ['noun'],
    createdAt: 0, updatedAt: 0, deleted: false,
  }],
  reviews: { c_x: { due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, last: 0, updatedAt: 0 } },
  settings: { updatedAt: 0 },
};

test('validateDoc accepts the spec document and emptyDoc', () => {
  assert.equal(M.validateDoc(SPEC_DOC).ok, true);
  assert.equal(M.validateDoc(M.emptyDoc()).ok, true);
});

test('validateDoc accepts cards saved from every dictionary, including the Arabic ones', () => {
  for (const source of ['hw', 'wikt', 'lane', 'lexicon', 'mufradat', 'mukhtar', 'custom']) {
    const d = JSON.parse(JSON.stringify(SPEC_DOC));
    d.cards[0].source = source;
    assert.equal(M.validateDoc(d).ok, true, source);
  }
});

test('validateDoc rejects bad shapes', () => {
  const bad = (mut, re) => {
    const d = JSON.parse(JSON.stringify(SPEC_DOC));
    mut(d);
    const r = M.validateDoc(d);
    assert.equal(r.ok, false, `expected failure: ${re}`);
    assert.match(r.error, re);
  };
  bad(d => { d.extra = 1; }, /unknown field "extra"/);
  bad(d => { d.v = 2; }, /v must be 1/);
  bad(d => { d.history = {}; }, /history: not an array/);
  bad(d => { d.history[0].t = 'x'; }, /history\[0\]: bad "t"/);
  bad(d => { d.folders[0].parent = 5; }, /bad "parent"/);
  bad(d => { d.folders[0].paused = 'yes'; }, /bad "paused"/);
  bad(d => { d.cards[0].tags = 'noun'; }, /bad "tags"/);
  bad(d => { d.cards[0].gloss = 'x'.repeat(5000); }, /bad "gloss"/);
  bad(d => { d.cards[0].source = 'web'; }, /bad "source"/);
  bad(d => { d.cards[0].evil = 1; }, /unknown field "evil"/);
  bad(d => { delete d.cards[0].folder; }, /missing "folder"/);
  bad(d => { d.cards.push({ ...d.cards[0] }); }, /duplicate id/);
  bad(d => { d.reviews.c_x.ease = Infinity; }, /bad "ease"/);
  bad(d => { d.reviews.c_x.foo = 1; }, /unknown field "foo"/);
  bad(d => { d.settings = { theme: 'dark' }; }, /settings: bad updatedAt/);
  bad(d => { d.settings.nested = {}; }, /settings: bad "nested"/);
  assert.equal(M.validateDoc(null).ok, false);
  assert.equal(M.validateDoc([]).ok, false);
});

test('checkLimits', () => {
  const d = M.emptyDoc();
  for (let i = 0; i < 5001; i++) d.cards.push(card('c' + i, 1));
  assert.match(M.checkLimits(d), /too many cards/);
  d.cards.length = 5000;
  assert.equal(M.checkLimits(d), null);
});

test('normUsername', () => {
  assert.equal(M.normUsername('  Subhan-X9_ '), 'subhan-x9_');
  assert.equal(M.normUsername('ab'), null);
  assert.equal(M.normUsername('abc'), 'abc');
  assert.equal(M.normUsername('a'.repeat(32)), 'a'.repeat(32));
  assert.equal(M.normUsername('a'.repeat(33)), null);
  assert.equal(M.normUsername('has space'), null);
  assert.equal(M.normUsername('ünï'), null);
  assert.equal(M.normUsername(42), null);
});

test('sameContent ignores top-level updatedAt and key order', () => {
  const a = doc({ updatedAt: 1, cards: [card('c1', 5)], reviews: { c1: { due: 1, updatedAt: 2 } } });
  const b = JSON.parse(JSON.stringify(a));
  b.updatedAt = 999;
  b.reviews = { c1: { updatedAt: 2, due: 1 } };
  assert.equal(M.sameContent(a, b), true);
  b.cards[0].gloss = 'x';
  assert.equal(M.sameContent(a, b), false);
  assert.equal(M.sameContent(null, M.emptyDoc()), true);
  // merge(local, response) where response already contains local → same content
  const resp = M.merge(a, doc({ cards: [card('c2', 3)] }), NOW);
  assert.equal(M.sameContent(M.merge(a, resp, NOW), resp), true);
  assert.equal(M.sameContent(a, resp), false);
});

test('reviews may carry a browse mark; merge keeps the newer record', () => {
  const d = JSON.parse(JSON.stringify(SPEC_DOC));
  d.reviews.c_x = { mark: 2, updatedAt: 5 };
  assert.equal(M.validateDoc(d).ok, true);
  d.reviews.c_x.mark = 'again';
  assert.match(M.validateDoc(d).error, /bad "mark"/);
  const cards = [card('c1', 1)];
  const a = doc({ cards, reviews: { c1: { mark: 1, updatedAt: 10 } } });
  const b = doc({ cards, reviews: { c1: { due: 5, interval: 1, ease: 2.5, reps: 1, lapses: 0, last: 4, mark: 1, updatedAt: 20 } } });
  assert.deepEqual(M.merge(a, b, NOW).reviews.c1, b.reviews.c1);
});

test('folders may be paused; the newer folder record carries the pause', () => {
  const on = doc({ folders: [folder('f1', 20, { paused: true })] });
  assert.equal(M.validateDoc(on).ok, true);
  const off = doc({ folders: [folder('f1', 10)] });
  assert.equal(M.merge(on, off, NOW).folders[0].paused, true);
  assert.equal('paused' in M.merge(on, doc({ folders: [folder('f1', 30)] }), NOW).folders[0], false);
});
