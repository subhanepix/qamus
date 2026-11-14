/* Qamus sync document: merge + validation.
 * Shared by the browser (classic <script>), the Cloudflare Worker (bundled import),
 * and Node tests (require). Exposes globalThis.QamusMerge. Pure functions only. */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const TOMBSTONE_MS = 30 * DAY;
  const LIMITS = { bytes: 1048576, cards: 5000, folders: 500, history: 500 };
  const MAX_STR = 2048;     // per text field
  const MAX_ID = 64;
  const MAX_TAGS = 50;

  function emptyDoc() {
    return { v: 1, updatedAt: 0, history: [], folders: [], cards: [], reviews: {}, settings: { updatedAt: 0 } };
  }

  function normUsername(s) {
    if (typeof s !== 'string') return null;
    const u = s.trim().toLowerCase();
    return /^[a-z0-9_-]{3,32}$/.test(u) ? u : null;
  }

  const num = x => (typeof x === 'number' && isFinite(x) ? x : 0);
  const clone = x => JSON.parse(JSON.stringify(x));

  // Newer updatedAt wins; on a tie a tombstone wins, otherwise keep a.
  function pick(a, b) {
    const ta = num(a.updatedAt), tb = num(b.updatedAt);
    if (tb > ta) return b;
    if (tb < ta) return a;
    return (b.deleted && !a.deleted) ? b : a;
  }

  function mergeById(a, b, cutoff) {
    const m = new Map();
    for (const x of a || []) m.set(x.id, x);
    for (const x of b || []) m.set(x.id, m.has(x.id) ? pick(m.get(x.id), x) : x);
    const out = [];
    for (const x of m.values()) if (!(x.deleted && num(x.updatedAt) < cutoff)) out.push(x);
    out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    return out;
  }

  // History: newest entry per q (tombstone wins a tie); drop entries at or before
  // historyClearedAt; prune old tombstones; newest first; cap live entries.
  function mergeHistory(a, b, clearedAt, cutoff) {
    const m = new Map();
    for (const h of [...(a || []), ...(b || [])]) {
      const cur = m.get(h.q);
      if (!cur || h.t > cur.t || (h.t === cur.t && h.deleted && !cur.deleted)) m.set(h.q, h);
    }
    const all = [...m.values()]
      .filter(h => h.t > clearedAt && !(h.deleted && h.t < cutoff))
      .sort((x, y) => y.t - x.t || (x.q < y.q ? -1 : x.q > y.q ? 1 : 0));
    const out = [];
    let live = 0;
    for (const h of all) {
      if (h.deleted) out.push(h);
      else if (live < LIMITS.history) { out.push(h); live++; }
    }
    return out;
  }

  function merge(a, b, now) {
    if (now === undefined) now = Date.now();
    a = a || emptyDoc();
    b = b || emptyDoc();
    const cutoff = now - TOMBSTONE_MS;

    const sa = a.settings || { updatedAt: 0 }, sb = b.settings || { updatedAt: 0 };
    const settings = clone(num(sb.updatedAt) > num(sa.updatedAt) ? sb : sa);
    const clearedAt = Math.max(num(sa.historyClearedAt), num(sb.historyClearedAt));
    if (clearedAt) settings.historyClearedAt = clearedAt;

    const folders = mergeById(a.folders, b.folders, cutoff);
    const cards = mergeById(a.cards, b.cards, cutoff);

    const cardIds = new Set(cards.map(c => c.id));
    const reviews = {};
    const ra = a.reviews || {}, rb = b.reviews || {};
    for (const id of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if (!cardIds.has(id)) continue;
      const x = ra[id], y = rb[id];
      reviews[id] = !x ? y : !y ? x : (num(y.updatedAt) > num(x.updatedAt) ? y : x);
    }

    return clone({
      v: 1,
      updatedAt: Math.max(num(a.updatedAt), num(b.updatedAt)),
      history: mergeHistory(a.history, b.history, clearedAt, cutoff),
      folders,
      cards,
      reviews,
      settings,
    });
  }

  // ---------- validation ----------

  const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const isNum = x => typeof x === 'number' && isFinite(x);
  const isId = x => typeof x === 'string' && x.length > 0 && x.length <= MAX_ID;
  const isStr = x => typeof x === 'string' && x.length <= MAX_STR;

  const DOC_KEYS = ['v', 'updatedAt', 'history', 'folders', 'cards', 'reviews', 'settings'];
  const FOLDER_KEYS = { id: 'id', name: 'str', parent: 'parent', createdAt: 'num', updatedAt: 'num', deleted: 'bool' };
  const CARD_KEYS = {
    id: 'id', folder: 'id', word: 'str', key: 'str', root: 'str', source: 'source', ref: 'str',
    gloss: 'str', arGloss: 'str', translit: 'str', context: 'str', highlight: 'str', note: 'str',
    tags: 'tags', createdAt: 'num', updatedAt: 'num', deleted: 'bool',
  };
  const CARD_REQUIRED = ['id', 'folder', 'word', 'updatedAt'];
  const REVIEW_KEYS = ['due', 'interval', 'ease', 'reps', 'lapses', 'last', 'updatedAt'];
  const SOURCES = ['hw', 'wikt', 'lane', 'lexicon', 'custom'];

  function checkField(kind, v) {
    switch (kind) {
      case 'id': return isId(v);
      case 'str': return isStr(v);
      case 'num': return isNum(v);
      case 'bool': return typeof v === 'boolean';
      case 'parent': return v === null || isId(v);
      case 'source': return SOURCES.includes(v);
      case 'tags': return Array.isArray(v) && v.length <= MAX_TAGS && v.every(t => typeof t === 'string' && t.length <= 64);
    }
    return false;
  }

  function checkRecord(rec, spec, required, label) {
    if (!isObj(rec)) return `${label}: not an object`;
    for (const k of Object.keys(rec)) {
      if (!(k in spec)) return `${label}: unknown field "${k}"`;
      if (!checkField(spec[k], rec[k])) return `${label}: bad "${k}"`;
    }
    for (const k of required) if (!(k in rec)) return `${label}: missing "${k}"`;
    return null;
  }

  function validateDoc(doc) {
    const fail = error => ({ ok: false, error });
    if (!isObj(doc)) return fail('doc: not an object');
    for (const k of Object.keys(doc)) if (!DOC_KEYS.includes(k)) return fail(`doc: unknown field "${k}"`);
    if (doc.v !== 1) return fail('doc: v must be 1');
    if (!isNum(doc.updatedAt)) return fail('doc: bad updatedAt');

    if (!Array.isArray(doc.history)) return fail('history: not an array');
    for (const [i, h] of doc.history.entries()) {
      if (!isObj(h)) return fail(`history[${i}]: not an object`);
      for (const k of Object.keys(h)) if (!['q', 't', 'deleted'].includes(k)) return fail(`history[${i}]: unknown field "${k}"`);
      if (typeof h.q !== 'string' || !h.q || h.q.length > 200) return fail(`history[${i}]: bad "q"`);
      if (!isNum(h.t)) return fail(`history[${i}]: bad "t"`);
      if ('deleted' in h && typeof h.deleted !== 'boolean') return fail(`history[${i}]: bad "deleted"`);
    }

    if (!Array.isArray(doc.folders)) return fail('folders: not an array');
    const fids = new Set();
    for (const [i, f] of doc.folders.entries()) {
      const e = checkRecord(f, FOLDER_KEYS, ['id', 'name', 'parent', 'updatedAt'], `folders[${i}]`);
      if (e) return fail(e);
      if (fids.has(f.id)) return fail(`folders[${i}]: duplicate id`);
      fids.add(f.id);
    }

    if (!Array.isArray(doc.cards)) return fail('cards: not an array');
    const cids = new Set();
    for (const [i, c] of doc.cards.entries()) {
      const e = checkRecord(c, CARD_KEYS, CARD_REQUIRED, `cards[${i}]`);
      if (e) return fail(e);
      if (cids.has(c.id)) return fail(`cards[${i}]: duplicate id`);
      cids.add(c.id);
    }

    if (!isObj(doc.reviews)) return fail('reviews: not an object');
    for (const [id, r] of Object.entries(doc.reviews)) {
      if (!isId(id)) return fail('reviews: bad card id');
      if (!isObj(r)) return fail(`reviews.${id}: not an object`);
      for (const k of Object.keys(r)) {
        if (!REVIEW_KEYS.includes(k)) return fail(`reviews.${id}: unknown field "${k}"`);
        if (!isNum(r[k])) return fail(`reviews.${id}: bad "${k}"`);
      }
      if (!('updatedAt' in r)) return fail(`reviews.${id}: missing "updatedAt"`);
    }

    if (!isObj(doc.settings)) return fail('settings: not an object');
    if (!isNum(doc.settings.updatedAt)) return fail('settings: bad updatedAt');
    for (const [k, v] of Object.entries(doc.settings)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) return fail(`settings: bad key "${k}"`);
      const ok = isNum(v) || typeof v === 'boolean' || isStr(v) || v === null;
      if (!ok) return fail(`settings: bad "${k}"`);
    }
    if (Object.keys(doc.settings).length > 50) return fail('settings: too many keys');

    return { ok: true, doc };
  }

  // Count limits (tombstones included: they occupy storage).
  function checkLimits(doc) {
    if (doc.cards.length > LIMITS.cards) return `too many cards (max ${LIMITS.cards})`;
    if (doc.folders.length > LIMITS.folders) return `too many folders (max ${LIMITS.folders})`;
    return null;
  }

  const api = { emptyDoc, merge, validateDoc, checkLimits, normUsername, LIMITS, TOMBSTONE_MS };
  root.QamusMerge = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
