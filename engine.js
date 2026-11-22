// Qamus Lexicographic Engine (ES Module)
// Cleanly wraps normalization, Buckwalter morphological analysis, Hans Wehr chunking,
// Wiktionary, Lane's Lexicon, al-Mufradāt, Mukhtār al-Ṣiḥāḥ, curated Particles (حروف),
// and soft tashkeel-aware prioritization.

import { PARTICLES } from './particles.js';
export { PARTICLES };

export const DATA_ROOT = 'data/';

export const DIAC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const HAMZA = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ء': 'ا', 'ؤ': 'ا', 'ئ': 'ا',
  'ى': 'ي', 'ة': 'ه', 'ک': 'ك', 'ی': 'ي',
};

export const norm = s => String(s || '').replace(DIAC, '').replace(/[أإآٱءؤئىةکی]/g, c => HAMZA[c]).trim();
export const isAr = s => /[\u0600-\u06FF]/.test(String(s || ''));
export const latin = s => String(s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[’‘ʿʾ'`\-\s]/g, '')
  .replace(/ḡ|ğ/g, 'g');

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const plain = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// ---------- Soft Tashkeel & Hamza Prioritization ----------
const TASHKEEL_RE = /[\u064B-\u0652\u0670]/;
const EXPLICIT_HAMZA_RE = /[أإآؤئ]/;
export const hasTashkeel = s => TASHKEEL_RE.test(String(s || ''));
export const hasExplicitHamza = s => EXPLICIT_HAMZA_RE.test(String(s || ''));

const VOWEL_MAP = {
  '\u064E': 'a', '\u064B': 'a', '\u0670': 'a', // fatha, fathatan, dagger alif
  '\u0650': 'i', '\u064D': 'i',                // kasra, kasratan
  '\u064F': 'u', '\u064C': 'u',                // damma, dammatan
  '\u0652': '0',                               // sukun
};

export function splitArabicSlots(word) {
  const slots = [];
  for (const ch of String(word || '').trim()) {
    if (ch === '\u0640') continue; // skip tatweel
    if (ch === '\u0651') {
      if (slots.length) slots[slots.length - 1].shadda = true;
    } else if (VOWEL_MAP[ch]) {
      if (slots.length) slots[slots.length - 1].vowel = VOWEL_MAP[ch];
    } else if (DIAC.test(ch)) {
      continue;
    } else {
      slots.push({ raw: ch, base: norm(ch), vowel: '', shadda: false });
    }
  }
  return slots;
}

// Compare two Arabic words (e.g. query vs vocalized particle or Buckwalter stem).
// Missing marks in the query are wildcards (partial tashkeel works cleanly);
// matching marks boost, conflicting marks penalize, and nothing is ever filtered out.
export function arabicTashkeelScore(query, candidate) {
  const qs = splitArabicSlots(query);
  const cs = splitArabicSlots(candidate);
  if (!qs.length || !cs.length) return { score: 0, exact: false };
  const len = Math.min(qs.length, cs.length);
  let score = 0, checks = 0, conflicts = 0;

  if (qs.length !== cs.length) score -= Math.abs(qs.length - cs.length) * 4;

  for (let i = 0; i < len; i++) {
    const q = qs[i], c = cs[i];
    if (q.base !== c.base) { conflicts++; score -= 12; continue; }
    if (EXPLICIT_HAMZA_RE.test(q.raw)) {
      checks++;
      if (q.raw === c.raw) score += 8;
      else { conflicts++; score -= 8; }
    }
    if (q.shadda) {
      checks++;
      if (c.shadda) score += 10;
      else { conflicts++; score -= 10; }
    } else if (c.shadda && q.vowel === '0') {
      // User typed sukun where candidate has shadda (e.g. إِنْ vs إِنَّ)
      checks++; conflicts++; score -= 8;
    }
    if (q.vowel) {
      checks++;
      if (c.vowel === q.vowel) score += 10;
      else if (c.vowel) { conflicts++; score -= 10; }
    }
  }
  const exact = checks > 0 && conflicts === 0 && qs.length === cs.length;
  if (exact) score += 30;
  return { score, exact };
}

// Match a vocalized Arabic query against a Latin transliteration (Hans Wehr e[6] / Wiktionary e[1]).
// Works for both full tashkeel (عِلْم -> ilm) and partial tashkeel (عِلم -> i...).
const SLOT_LAT = {
  'ب': 'b', 'ت': 't', 'ث': '(?:th|t)', 'ج': 'j', 'ح': 'h', 'خ': '(?:kh|k|h)',
  'د': 'd', 'ذ': '(?:dh|d)', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': '(?:sh|s)',
  'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': '', 'غ': '(?:gh|g)',
  'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h?',
  'ة': 'a?h?t?', 'ا': '[a]?', 'و': '[wu]?', 'ي': '[yi]?', 'ى': '[a]?',
};

export function translitTashkeelScore(query, translit) {
  if (!translit || (!hasTashkeel(query) && !hasExplicitHamza(query))) return { score: 0, exact: false };
  const slots = splitArabicSlots(query);
  if (!slots.length) return { score: 0, exact: false };

  // Build strict phonetic pattern from user's explicit vowels/shaddas
  let pat = '^';
  let constraints = 0;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const cPat = SLOT_LAT[s.base] ?? '';
    if (s.shadda) {
      constraints++;
      pat += cPat ? `(${cPat})\\1` : '';
    } else {
      pat += cPat;
    }
    // Check explicit hamza-below إ (implies initial 'i') or hamza-above أ (implies 'a' or 'u')
    let v = s.vowel;
    if (!v && s.raw === 'إ') v = 'i';
    if (v === '0') {
      constraints++;
      // sukun: no short vowel right after this consonant (except final/long glide)
      pat += '';
    } else if (v) {
      constraints++;
      pat += v + '+';
    } else {
      // unconstrained slot: allow optional vowel(s)
      pat += '[aiu]*';
    }
  }
  pat += '[aiu]*$';

  if (!constraints) return { score: 0, exact: false };

  const variants = String(translit).split(/[,;/]| or /).map(t => latin(t)).filter(Boolean);
  if (!variants.length) return { score: 0, exact: false };

  let re;
  try { re = new RegExp(pat); } catch { return { score: 0, exact: false }; }

  // Also check full vocLatin exact equality for high confidence
  const vRaw = vocLatin(query);
  const vFull = trimV(vRaw);

  let best = -20;
  let exact = false;
  for (const cand of variants) {
    const cTrim = trimV(cand);
    if (hasTashkeel(query) && vRaw && cand === vRaw) {
      return { score: 120, exact: true };
    }
    if (hasTashkeel(query) && vFull && cTrim === vFull && !slots[slots.length - 1].vowel) {
      best = Math.max(best, 100);
      exact = true;
      continue;
    }
    if (re.test(cand)) {
      best = Math.max(best, 70);
      exact = true;
    } else if (re.test(cTrim) && !slots[slots.length - 1].vowel) {
      best = Math.max(best, 55);
      exact = true;
    }
  }
  return { score: best, exact };
}

// ---------- Curated Particles Index ----------
const particleNorm = new Map();
for (const p of PARTICLES) {
  const keys = new Set([norm(p.ar), ...(p.aliases || []).map(a => norm(a))]);
  for (const k of keys) {
    if (!k) continue;
    if (!particleNorm.has(k)) particleNorm.set(k, []);
    if (!particleNorm.get(k).includes(p)) particleNorm.get(k).push(p);
  }
}

export function lookupParticles(q) {
  const n = norm(q);
  if (!n) return [];
  const list = particleNorm.get(n);
  if (!list || !list.length) return [];
  if (!hasTashkeel(q) && !hasExplicitHamza(q)) return list.slice();
  return list
    .map(p => ({ p, ts: arabicTashkeelScore(q, p.ar) }))
    .sort((a, b) => b.ts.score - a.ts.score)
    .map(x => ({ ...x.p, _exact: x.ts.exact, _score: x.ts.score }));
}

export const DICTS = [
  { id: 'hw', name: 'Hans Wehr', short: 'Hans Wehr', desc: 'Roots, verb forms (I–X) & derived words', kind: 'en' },
  { id: 'wikt', name: 'Wiktionary', short: 'Wiktionary', desc: 'Modern usage, inflected forms & broken plurals', kind: 'en' },
  { id: 'lexicon', name: 'Buckwalter Lexicon', short: 'Lexicon', desc: 'Morphological stems missing from Hans Wehr', kind: 'en' },
  { id: 'lane', name: 'Lane’s Lexicon', short: 'Lane', desc: 'Classical Arabic in depth; loads on demand', kind: 'en' },
  { id: 'mufradat', name: 'al-Mufradāt', short: 'al-Mufradāt', desc: 'al-Rāghib al-Iṣfahānī on Qur’anic vocabulary', kind: 'ar' },
  { id: 'mukhtar', name: 'Mukhtār al-Ṣiḥāḥ', short: 'Mukhtār', desc: 'al-Rāzī’s classical Arabic lexicon', kind: 'ar' },
];
export const DICT_IDS = DICTS.map(d => d.id);

export const AR_DICTS = {
  mufradat: { name: 'al-Mufradāt', full: 'al-Mufradāt fī gharīb al-Qur’ān', dir: DATA_ROOT + 'mufradat/' },
  mukhtar: { name: 'Mukhtār al-Ṣiḥāḥ', full: 'Mukhtār al-Ṣiḥāḥ', dir: DATA_ROOT + 'mukhtar/' },
};
export const AR_IDS = Object.keys(AR_DICTS);

// Classical Arabic verb form templates (الأوزان) to enrich Hans Wehr's Roman numerals
export const VERB_PATTERNS = {
  I: { wazn: 'فَعَلَ', sense: 'Base root' },
  II: { wazn: 'فَعَّلَ', sense: 'Causative · Intensive' },
  III: { wazn: 'فَاعَلَ', sense: 'Associative · Attemptive' },
  IV: { wazn: 'أَفْعَلَ', sense: 'Causative · Transitive' },
  V: { wazn: 'تَفَعَّلَ', sense: 'Reflexive of II' },
  VI: { wazn: 'تَفَاعَلَ', sense: 'Reciprocal · Pretending' },
  VII: { wazn: 'اِنْفَعَلَ', sense: 'Passive · Medio-passive' },
  VIII: { wazn: 'اِفْتَعَلَ', sense: 'Reflexive · Middle voice' },
  IX: { wazn: 'اِفْعَلَّ', sense: 'Colors · Physical traits' },
  X: { wazn: 'اِسْتَفْعَلَ', sense: 'Seeking · Estimating' },
  XI: { wazn: 'اِفْعَالَّ', sense: 'Intense colors' },
};

// ---------- Engine State ----------
export const state = {
  IDX: [],
  HW: null,
  M: null,
  W: null,
  byId: new Map(),
  kids: new Map(),
  formsBy: new Map(),
  hwNorm: new Map(),
  formNorm: new Map(),
  formIdxMap: null,
  wForm: new Map(),
  laneIdx: new Map(),
  laneRoots: null,
  laneShards: new Map(),
  arRoots: {},
  arShards: new Map(),
  hwChunks: new Map(),
  AB: null,
  AC: null,
  BC: null,
  plainDefs: null,
  hwLat: null,
  readyStage: 'boot', // 'boot' | 'index' | 'hw' | 'morph' | 'full'
};

const listeners = new Set();
export function onEngineUpdate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(stage) {
  state.readyStage = stage;
  for (const fn of listeners) {
    try { fn(stage); } catch (e) { console.error(e); }
  }
}

const pushMap = (m, k, v) => {
  if (!m.has(k)) m.set(k, []);
  m.get(k).push(v);
};

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

export async function initEngine() {
  state.IDX = await fetchJson(DATA_ROOT + 'index.json');
  notify('index');

  const [hi, lr, ...ar] = await Promise.all([
    fetchJson(DATA_ROOT + 'hw/index.json'),
    fetchJson(DATA_ROOT + 'lane/roots.json').catch(() => []),
    ...AR_IDS.map(id => fetchJson(AR_DICTS[id].dir + 'roots.json').catch(() => [])),
  ]);

  state.HW = {
    entries: hi.e.map(([id, w, isRoot, root, quran, tr]) => [id, w, null, isRoot, root, quran, tr]),
    forms: hi.f.map(([root, n, verb]) => [root, n, verb, null]),
    chunks: hi.chunks,
  };
  state.laneRoots = new Set(lr);
  AR_IDS.forEach((id, i) => { state.arRoots[id] = new Set(ar[i]); });

  for (const e of state.HW.entries) {
    state.byId.set(e[0], e);
    if (!state.kids.has(e[4])) state.kids.set(e[4], []);
    if (e[0] !== e[4]) state.kids.get(e[4]).push(e);
    pushMap(state.hwNorm, norm(e[1]), e);
  }
  state.HW.forms.forEach(f => {
    pushMap(state.formsBy, f[0], f);
    if (f[2]) pushMap(state.formNorm, norm(f[2]), f);
  });
  for (const r of state.IDX) {
    if (r[2] === 'l') pushMap(state.laneIdx, r[0], r[3]);
  }
  notify('hw');

  // Let any on-screen chunk finish before pulling morph.json
  await Promise.allSettled([...state.hwChunks.values()]);

  const m = await fetchJson(DATA_ROOT + 'morph.json');
  state.AB = new Set(m.AB);
  state.AC = new Set(m.AC);
  state.BC = new Set(m.BC);
  state.M = m;
  notify('morph');

  const w = await fetchJson(DATA_ROOT + 'wikt.json');
  w.entries.forEach((e, k) => {
    pushMap(state.wForm, norm(e[0]), k);
    if (w.forms[k]) {
      for (const f of w.forms[k].split(' ')) pushMap(state.wForm, f, k);
    }
  });
  state.W = w;
  notify('full');

  prefetchHw();
}

// ---------- Hans Wehr Chunks ----------
export function chunkOf(rootId) {
  const c = state.HW.chunks;
  let lo = 0, hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c[mid] <= rootId) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function loadChunk(k) {
  if (!state.hwChunks.has(k)) {
    const p = fetchJson(`${DATA_ROOT}hw/c${String(k).padStart(3, '0')}.json`)
      .then(c => {
        for (const id in c.e) {
          const e = state.byId.get(+id);
          if (e) e[2] = c.e[id];
        }
        for (const i in c.f) {
          const f = state.HW.forms[+i];
          if (f) f[3] = c.f[i];
        }
        state.plainDefs = null;
        p.done = true;
      })
      .catch(err => {
        state.hwChunks.delete(k);
        throw err;
      });
    state.hwChunks.set(k, p);
  }
  return state.hwChunks.get(k);
}

export const hwChunksFor = rootIds => [...new Set(rootIds.filter(r => r != null).map(chunkOf))];
export const hwHave = rootIds => !!state.HW && hwChunksFor(rootIds).every(k => state.hwChunks.get(k)?.done);
export function loadHw(rootIds) {
  return Promise.all(hwChunksFor(rootIds).map(k => loadChunk(k)));
}
export const loadAllHw = () => loadHw(state.HW.chunks.map(start => start));

function prefetchHw() {
  if (navigator.connection?.saveData) return;
  const idle = window.requestIdleCallback || (f => setTimeout(f, 300));
  let k = 0;
  const next = () => {
    while (k < state.HW.chunks.length && state.hwChunks.get(k)?.done) k++;
    if (k >= state.HW.chunks.length) return;
    const n = k++;
    loadChunk(n).catch(() => {}).then(() => idle(next));
  };
  setTimeout(() => idle(next), 3000);
}

export function formIdx(f) {
  if (!state.formIdxMap) state.formIdxMap = new Map(state.HW.forms.map((x, i) => [x, i]));
  return state.formIdxMap.get(f);
}

export function stripHead(e) {
  const d = e[2] || '';
  return d.startsWith(e[1]) ? d.slice(e[1].length).trim() : d;
}

// ---------- Morphology (Buckwalter) ----------
const AR_LAT = {
  'ب': 'b', 'ت': 't', 'ث': 't', 'ج': 'j', 'ح': 'h', 'خ': 'k', 'د': 'd', 'ذ': 'd',
  'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 's', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z',
  'غ': 'g', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
};

function vocLatin(w) {
  let out = '', prev = '';
  for (const c of w) {
    if (c === '\u064E') out += 'a';
    else if (c === '\u0650') out += 'i';
    else if (c === '\u064F') out += 'u';
    else if (c === '\u0651') out = /[aiu]$/.test(out) ? out.slice(0, -1) + prev + out.slice(-1) : out + prev;
    else if (c === 'ا' || c === 'ى' || c === 'آ') out += 'a';
    else if (c === 'و') out += /[u]$/.test(out) ? 'u' : 'w';
    else if (c === 'ي') out += /[i]$/.test(out) ? 'i' : 'y';
    else if (c === 'ة') out += /a$/.test(out) ? '' : 'a';
    else if (AR_LAT[c]) { out += AR_LAT[c]; prev = AR_LAT[c]; continue; }
  }
  return out.replace(/([aiu])\1+/g, '$1');
}

const trimV = s => s.replace(/[aiu]+$/, '');

function hwHasWord(stem) {
  if (!state.HW || !stem[5].length) return 2;
  if (!state.hwLat) {
    state.hwLat = new Map();
    for (const e of state.HW.entries) {
      if (!e[6]) continue;
      if (!state.hwLat.has(e[4])) state.hwLat.set(e[4], new Map());
      const m = state.hwLat.get(e[4]);
      const single = !/\s/.test(e[1].trim());
      String(e[6]).split(/[,;/]| or /).forEach((t, i) => {
        const l = trimV(latin(t));
        if (!l) return;
        const sc = single && i === 0 && !/\s/.test(t.trim()) ? 0 : 1;
        if (!m.has(l) || m.get(l) > sc) m.set(l, sc);
      });
    }
  }
  const v = trimV(vocLatin(stem[4] || stem[0]));
  return Math.min(2, ...stem[5].map(id => state.hwLat.get(id)?.get(v) ?? 2));
}

export function analyze(w) {
  const M = state.M;
  if (!M) return [];
  const n = norm(w), out = [], seen = new Set();
  for (let i = 0; i <= Math.min(5, n.length - 1); i++) {
    const P = M.prefixes[n.slice(0, i)];
    if (!P) continue;
    for (let j = n.length; j > i; j--) {
      const sk = n.slice(j);
      if (sk.length > 7) break;
      const S = M.suffixes[sk];
      if (!S) continue;
      const St = M.stems[n.slice(i, j)];
      if (!St) continue;
      for (const p of P) {
        for (const s of St) {
          if (!state.AB.has(p[1] + ' ' + s[1])) continue;
          for (const x of S) {
            if (!state.AC.has(p[1] + ' ' + x[1]) || !state.BC.has(s[1] + ' ' + x[1])) continue;
            const key = s[0] + '|' + s[2] + '|' + p[0] + '|' + x[0];
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ pre: p, stem: s, suf: x, affixLen: i + sk.length });
          }
        }
      }
    }
  }
  const raw = String(w || '').replace(DIAC, '').replace(/ٱ/g, 'ا');
  const checkTashkeel = hasTashkeel(w) || hasExplicitHamza(w);
  for (const a of out) {
    const fullAr = a.pre[0] + a.stem[0] + a.suf[0];
    const c = fullAr.replace(DIAC, '').replace(/ٱ/g, 'ا');
    let pen = 0;
    if (c.length !== raw.length) pen = 0.5;
    else {
      for (let i = 0; i < raw.length; i++) {
        if ('أإآءؤئى'.includes(raw[i]) && c[i] !== raw[i]) pen++;
      }
    }
    a.pen = pen;
    a.tScore = checkTashkeel ? arabicTashkeelScore(w, fullAr).score : 0;
    a.hw = hwHasWord(a.stem);
    a.qc = Math.max(0, ...a.stem[5].map(id => state.byId.get(id)?.[5] || 0));
  }
  out.sort((a, b) => (b.tScore - a.tScore) || (a.pen - b.pen) || (a.affixLen - b.affixLen) || (a.hw - b.hw) || (b.qc - a.qc));
  return out;
}

export function uniqParses(ps) {
  const seen = new Set(), out = [];
  for (const a of ps) {
    const k = a.pre[0] + a.stem[0] + a.suf[0];
    if (!seen.has(k)) { seen.add(k); out.push(a); }
  }
  return out;
}

export function rootLabel(stem) {
  if (stem[5].length) return [...state.byId.get(stem[5][0])[1]].join(' ');
  if (stem[3] >= 0) return [...state.M.roots[stem[3]][0].replace(/\(\d\)|\/.*$|-/g, '')].join(' ');
  return '';
}

// ---------- Root & Dictionary Lookup ----------
export function rootVariants(n) {
  const out = [n];
  if (n.length === 3 && n[1] === n[2]) out.push(n.slice(0, 2));
  if (n.length === 2) out.push(n + n[1]);
  const alt = { 'ا': 'وي', 'و': 'يا', 'ي': 'وا' };
  [...n].forEach((c, i) => {
    for (const a of alt[c] || '') out.push(n.slice(0, i) + a + n.slice(i + 1));
  });
  return out;
}

export function rootIdsFor(n) {
  for (const v of rootVariants(n)) {
    const ids = (state.hwNorm.get(v) || []).filter(e => e[3]).map(e => e[0]);
    if (ids.length) return ids;
  }
  return [];
}

export function wRoots(k) {
  const e = state.W?.entries[k];
  if (!e) return [];
  if (e[3].length) return e[3];
  const a = analyze(e[0]).find(x => x.stem[5].length);
  return a ? a.stem[5] : [];
}

export function wGloss(e) {
  const m = e[2].match(/<li>(.*?)<\/li>/);
  return plain(m ? m[1] : e[2]).slice(0, 90);
}

export function laneKey(n) {
  if (!state.laneRoots) return n;
  for (const v of rootVariants(n)) if (state.laneRoots.has(v)) return v;
  return null;
}

export async function loadLaneEntries(k) {
  const name = k.codePointAt(0).toString(16).padStart(4, '0') + '.json';
  if (!state.laneShards.has(name)) {
    state.laneShards.set(name, fetchJson(DATA_ROOT + 'lane/' + name).catch(err => {
      state.laneShards.delete(name);
      throw err;
    }));
  }
  const shard = await state.laneShards.get(name);
  return shard[k] || [];
}

export function arKey(id, n) {
  const rs = state.arRoots[id];
  if (!rs || !n) return null;
  for (const v of rootVariants(n)) if (rs.has(v)) return v;
  return null;
}

export function arKeysFor(rootIds, more = []) {
  const out = {};
  for (const id of AR_IDS) {
    const ks = [];
    for (const n of [
      ...rootIds.map(r => norm(state.byId.get(r)?.[1] || '')),
      ...more.map(m => norm(m).replace(/\s+/g, '')),
    ]) {
      const k = arKey(id, n);
      if (k && !ks.includes(k)) ks.push(k);
    }
    out[id] = ks;
  }
  return out;
}

export const arHas = n => AR_IDS.some(id => arKey(id, n));

export async function arShard(id, k) {
  const name = AR_DICTS[id].dir + k.codePointAt(0).toString(16).padStart(4, '0') + '.json';
  if (!state.arShards.has(name)) {
    state.arShards.set(name, fetchJson(name).catch(err => {
      state.arShards.delete(name);
      throw err;
    }));
  }
  return state.arShards.get(name);
}

export function arHead(id, html, k) {
  const bs = [...html.matchAll(/<b>(.*?)<\/b>/g)].map(m => m[1]);
  return (id === 'mukhtar' ? bs[1] : bs[0]) || bs[0] || k;
}

export async function arEntry(id, ref) {
  const at = ref.lastIndexOf(':');
  const k = ref.slice(0, at);
  const html = (await arShard(id, k))[k][+ref.slice(at + 1)];
  return { head: arHead(id, html, k), html };
}

const AL_PREFIXES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال'];
const isNominal = a => !/^(PV|IV|CV)/.test(a.stem[1]);
const PRON_END = /ن(كما|كم|كن|ك|هما|هم|هن|ها|ه|ني|نا)$/;

export function retryForms(q) {
  const w = String(q || '').replace(DIAC, '').replace(/ٱ/g, 'ا');
  const out = [];
  const add = (word, why) => {
    if (word.length >= 2 && word !== w && !out.some(o => o.word === word)) out.push({ word, why });
  };
  const p = AL_PREFIXES.find(x => w.startsWith(x));
  if (p) add(w.slice(p.length), 'al');
  const m = w.match(PRON_END);
  if (m) add(w.slice(0, m.index) + m[1], 'nun');
  if (w.endsWith('ن')) add(w.slice(0, -1), 'nun');
  return out;
}

export function lookupWord(q) {
  const n = norm(q);
  const particles = lookupParticles(q);
  const hits = new Set(), forms = [], roots = [];
  const addRoot = id => { if (id != null && !roots.includes(id)) roots.push(id); };
  for (const e of state.hwNorm.get(n) || []) { if (e[3]) addRoot(e[0]); }
  for (const e of state.hwNorm.get(n) || []) { hits.add(e[0]); addRoot(e[4]); }
  for (const f of state.formNorm.get(n) || []) { forms.push(f); addRoot(f[0]); }
  let wikt = [...new Set(state.wForm.get(n) || [])].slice(0, 8);
  for (const k of wikt) wRoots(k).forEach(addRoot);
  const laneOnly = [];
  const laneHit = new Set(state.laneIdx.get(n) || []);
  for (const lr of laneHit) {
    const ids = rootIdsFor(lr);
    if (ids.length) ids.forEach(addRoot);
    else laneOnly.push(lr);
  }

  const parses = analyze(q);
  const bwOnly = [];
  for (const a of parses) {
    if (a.stem[5].length) a.stem[5].forEach(addRoot);
    else bwOnly.push(a);
  }
  for (const a of parses) {
    for (const k of [norm(a.stem[0]), norm(a.stem[4] || '')]) {
      for (const e of state.hwNorm.get(k) || []) if (roots.includes(e[4])) hits.add(e[0]);
    }
  }
  const typed = String(q || '').replace(DIAC, '').trim();
  const exactSpelling = [...hits].filter(id => state.byId.get(id)?.[1] === typed);
  if (exactSpelling.length && exactSpelling.length < hits.size) {
    hits.clear();
    exactSpelling.forEach(id => hits.add(id));
  }

  // Soft tashkeel-aware prioritization: never drops results on wrong tashkeel,
  // but boosts & pins exact harakat/transliteration matches to the very top.
  const exactHits = new Set();
  const hitScores = new Map();
  if (hasTashkeel(q) || hasExplicitHamza(q)) {
    for (const id of hits) {
      const e = state.byId.get(id);
      if (!e) continue;
      const ts = translitTashkeelScore(q, e[6]);
      hitScores.set(id, ts.score);
      if (ts.exact) exactHits.add(id);
    }
    // If any exact harakat match exists among hits, narrow highlight to those exact hits
    // and sort roots so the exact-matching root comes first!
    if (exactHits.size) {
      const exactRootSet = new Set([...exactHits].map(id => state.byId.get(id)?.[4]));
      roots.sort((a, b) => (exactRootSet.has(b) ? 1 : 0) - (exactRootSet.has(a) ? 1 : 0));
    }
    // Also prioritize Wiktionary entries matching the user's tashkeel
    if (wikt.length > 1 && state.W) {
      wikt = wikt
        .map(k => ({ k, sc: translitTashkeelScore(q, state.W.entries[k]?.[1]).score }))
        .sort((a, b) => b.sc - a.sc)
        .map(x => x.k);
    }
  }

  const arWord = roots.length ? '' : n;
  if (!particles.length && !roots.length && !bwOnly.length && !wikt.length && !laneOnly.length && !arHas(n)) return null;
  const directHit = hits.size || forms.length || wikt.length || particles.length;
  return {
    roots,
    opt: {
      particles,
      hits,
      exactHits,
      hitScores,
      forms,
      parses: directHit && !parses.some(a => a.affixLen) ? [] : parses,
      bwOnly,
      wikt,
      laneOnly,
      laneWord: laneHit.size ? n : '',
      arWord,
    },
  };
}

export function resolveQuery(rawQ) {
  const q = String(rawQ || '').trim();
  if (!q) return { kind: 'empty' };
  if (!isAr(q)) return { kind: 'english', q };

  const letters = q.split(/[\s\-–.،,]+/).filter(Boolean);
  if (letters.length >= 2 && letters.every(x => norm(x).length === 1)) {
    const joined = norm(letters.join(''));
    const r = rootIdsFor(joined);
    if (r.length) return { kind: 'roots', roots: r, opt: {}, q };
    if (arHas(joined)) return { kind: 'roots', roots: [], opt: { arWord: letters.join('') }, q };
  }

  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) return { kind: 'passage', words, q };

  const direct = lookupWord(q);
  if (direct) return { kind: 'roots', roots: direct.roots, opt: direct.opt, q };

  for (const v of retryForms(q)) {
    const rv = lookupWord(v.word);
    if (!rv) continue;
    if (v.why === 'al') {
      rv.opt.parses = rv.opt.parses.filter(isNominal);
      rv.opt.bwOnly = rv.opt.bwOnly.filter(isNominal);
    }
    return { kind: 'roots', roots: rv.roots, opt: { ...rv.opt, retry: { from: q, ...v } }, q: v.word };
  }
  return { kind: 'fallback', q, n: norm(q) };
}

// ---------- Autocomplete & Fallback ----------
function lowerBound(key) {
  let lo = 0, hi = state.IDX.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (state.IDX[mid][0] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function suggestTashkeelScore(q, r) {
  if (r[2] === 'p') return arabicTashkeelScore(q, r[1]).score;
  if (r[2] === 'h') {
    const e = state.byId.get(+r[3]);
    return e ? translitTashkeelScore(q, e[6]).score : 0;
  }
  if (r[2] === 'w') {
    const e = state.W?.entries[+r[3]];
    return e ? translitTashkeelScore(q, e[1]).score : 0;
  }
  if (r[2] === 'b') {
    const s = state.M ? (state.M.stems[r[3]] || [])[0] : null;
    return s ? arabicTashkeelScore(q, s[4] || s[0]).score : 0;
  }
  return 0;
}

export function suggestions(q) {
  const n = norm(q).replace(/\s+/g, '');
  if (!n) return [];
  if (!isAr(n)) return latinSuggest(q);
  const out = [];

  // Include matching curated particles first (exact or prefix match)
  for (const p of PARTICLES) {
    const pn = norm(p.ar);
    if (pn.startsWith(n)) out.push([pn, p.ar, 'p', p.ar]);
  }

  for (let i = lowerBound(n); i < state.IDX.length && state.IDX[i][0].startsWith(n) && out.length < 400; i++) {
    out.push(state.IDX[i]);
  }

  const useTashkeel = hasTashkeel(q) || hasExplicitHamza(q);
  const pri = { p: 0, h: 1, f: 2, b: 3, w: 4, l: 5 };
  const scores = useTashkeel ? new Map(out.map(r => [r, suggestTashkeelScore(q, r)])) : null;

  out.sort((a, b) => {
    const exactKey = (a[0] !== n) - (b[0] !== n);
    if (exactKey) return exactKey;
    if (scores) {
      const ds = (scores.get(b) || 0) - (scores.get(a) || 0);
      if (ds) return ds;
    }
    return a[0].length - b[0].length || (pri[a[2]] ?? 9) - (pri[b[2]] ?? 9);
  });

  const seen = new Set(), res = [];
  for (const r of out) {
    const k = r[1] + r[2] + r[3];
    if (!seen.has(k)) { seen.add(k); res.push(r); }
    if (res.length >= 10) break;
  }
  return res;
}

function latinSuggest(q) {
  if (!state.HW) return [];
  const l = latin(q);
  if (l.length < 2) return [];
  const res = [];
  for (const e of state.HW.entries) {
    if (e[6] && latin(e[6]).startsWith(l)) {
      res.push([norm(e[1]), e[1], 'h', String(e[0])]);
      if (res.length > 40) break;
    }
  }
  res.sort((a, b) => latin(state.byId.get(+a[3])[6]).length - latin(state.byId.get(+b[3])[6]).length);
  return res.slice(0, 8);
}

export function glossFor(r, onChunkLoaded) {
  if (r[2] === 'p') {
    const p = PARTICLES.find(x => x.ar === r[3]);
    return p ? `${p.tr} · ${p.arCat} — ${p.meaning.slice(0, 75)}` : '';
  }
  if (!state.HW) return '';
  if (r[2] === 'h' || r[2] === 'f') {
    const rid = r[2] === 'h' ? state.byId.get(+r[3])?.[4] : state.HW.forms[+r[3]]?.[0];
    if (rid != null && !hwHave([rid])) {
      loadHw([rid]).then(() => onChunkLoaded?.()).catch(() => {});
    }
  }
  if (r[2] === 'h') {
    const e = state.byId.get(+r[3]);
    if (!e) return '';
    let d = plain(stripHead(e));
    if (e[6] && d.startsWith(e[6])) d = d.slice(e[6].length).trim();
    return (e[6] ? e[6] + (d ? ' · ' : '') : '') + d.slice(0, 80);
  }
  if (r[2] === 'f') {
    const f = state.HW.forms[+r[3]];
    return 'Form ' + f[1] + (f[3] ? ' · ' + plain(f[3]).slice(0, 70) : '');
  }
  if (r[2] === 'b') {
    const s = state.M ? (state.M.stems[r[3]] || [])[0] : null;
    return s ? s[2].replace(/;/g, '; ') : '';
  }
  if (r[2] === 'w') {
    const e = state.W?.entries[+r[3]];
    return e ? (e[1] ? e[1] + ' · ' : '') + wGloss(e) : 'Wiktionary';
  }
  if (r[2] === 'l') return 'Lane’s Lexicon · root ' + [...r[3]].join(' ');
  return '';
}

function ed1(a, b) {
  if (a === b) return true;
  if (a.length === b.length) {
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false;
    return true;
  }
  if (a.length < b.length) [a, b] = [b, a];
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; }
    else { if (++d > 1) return false; i++; }
  }
  return true;
}

export function nearestMatches(n) {
  const near = [], seen = new Set();
  const consider = r => { if (!seen.has(r[0])) { seen.add(r[0]); near.push(r); } };
  for (const r of state.IDX) {
    if (Math.abs(r[0].length - n.length) <= 1 && ed1(r[0], n)) consider(r);
    if (near.length > 30) break;
  }
  for (let i = lowerBound(n); i < state.IDX.length && state.IDX[i][0].startsWith(n) && near.length < 40; i++) {
    consider(state.IDX[i]);
  }
  return near.slice(0, 24);
}

export function searchEnglish(q) {
  const l = latin(q);
  const tr = state.HW.entries.filter(e => e[6] && latin(e[6]) === l);
  if (!state.plainDefs) state.plainDefs = state.HW.entries.map(e => plain(stripHead(e)).toLowerCase());
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return { tr, scored: [], terms };
  const re = new RegExp(terms.map(t => `(?=[\\s\\S]*\\b${t})`).join(''), '');
  const first = new RegExp('\\b' + terms[0]);
  const scored = [];
  state.HW.entries.forEach((e, i) => {
    const d = state.plainDefs[i];
    if (!re.test(d)) return;
    const pos = d.search(first);
    const semi = d.indexOf(';');
    scored.push([pos + (semi >= 0 && pos > semi ? 200 : 0) + (e[3] ? 0 : 5), e]);
  });
  scored.sort((a, b) => a[0] - b[0]);
  return { tr: tr.slice(0, 20), scored: scored.slice(0, 80), total: scored.length, terms };
}

// ---------- Formatting Helpers ----------
export function defHtml(s, tags = ['b', 'i']) {
  let h = esc(s);
  for (const t of tags) h = h.replace(new RegExp(`&lt;(/?)${t}&gt;`, 'g'), `<$1${t}>`);
  h = h.replace(/[\u0600-\u06FF][\u0600-\u06FF\u064B-\u0652 ]*[\u0600-\u06FF]|[\u0600-\u06FF]/g,
    m => `<bdi class="ar lk" dir="rtl" data-q="${esc(m.trim())}">${m}</bdi>`);
  return h;
}

export function arHtml(html, wantNorm = '') {
  return html
    .replace(/<b>([^<]*)<\/b>/g, (m, w, at) => {
      const n = norm(w).replace(/\s+/g, '');
      return at > 0 && wantNorm && (n === wantNorm || n === 'ال' + wantNorm || 'ال' + n === wantNorm)
        ? `<b class="hit">${w}</b>` : m;
    })
    .replace(/<i>[^<]*<\/i>|(^|>)([^<]+)/g, (m, a, t) => (t === undefined ? m
      : a + t.replace(/[\u0621-\u063A\u0641-\u064A\u064B-\u0652\u0670]+/g,
        w => `<span class="lk" data-q="${esc(w.replace(/[\u064B-\u0652\u0670]/g, ''))}">${w}</span>`)));
}

export function bwRoot(rid) {
  const e = state.byId.get(rid);
  if (!e) return '';
  const T = {
    'ا': 'A', 'أ': 'A', 'ب': 'b', 'ت': 't', 'ث': 'v', 'ج': 'j', 'ح': 'H', 'خ': 'x',
    'د': 'd', 'ذ': '*', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': '$', 'ص': 'S', 'ض': 'D',
    'ط': 'T', 'ظ': 'Z', 'ع': 'E', 'غ': 'g', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l',
    'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'y', 'ء': 'A',
  };
  return [...norm(e[1])].map(c => T[c] || '').join('');
}

export const tokenIs = (tok, w) => {
  const t = norm(tok).replace(/[^ء-ي]/g, '');
  return t === w || ['ال', 'وال', 'فال', 'بال', 'كال', 'لل', 'و', 'ف'].some(p => t === p + w);
};

export function snippet(text, w, exact, before, after, stop = /[.؟!\n]/) {
  const re = /[ء-ْٰ]+/g;
  let m, at = -1, len = 0;
  while ((m = re.exec(text))) {
    const t = norm(m[0]).replace(/[^ء-ي]/g, '');
    if (exact && t === exact) { at = m.index; len = m[0].length; break; }
    if (at < 0 && tokenIs(m[0], w)) { at = m.index; len = m[0].length; }
  }
  if (at < 0) return null;
  let s = Math.max(0, at - before), e = Math.min(text.length, at + len + after);
  for (let i = at - 1; i >= s; i--) if (stop.test(text[i])) { s = i + 1; break; }
  for (let i = at + len; i < e; i++) if (stop.test(text[i])) { e = i + 1; break; }
  if (s > 0 && s !== at) { const sp = text.indexOf(' ', s); if (sp >= 0 && sp < at) s = sp + 1; }
  if (e < text.length) { const sp = text.lastIndexOf(' ', e); if (sp > at + len) e = sp; }
  return {
    pre: (s > 0 && !stop.test(text[s - 1]) ? '…' : '') + text.slice(s, at),
    hit: text.slice(at, at + len),
    post: text.slice(at + len, e).trimEnd() + (e < text.length && !stop.test(text[e - 1]) ? '…' : ''),
  };
}

export function stripGrammar(s) {
  const AR = '[\\u0600-\\u06FF\\u064B-\\u0652]+';
  const lead = new RegExp(`^(?:(?:pl\\.|coll\\.|n\\. un\\.|f\\.|dual)\\s*)?(?:${AR}(?:\\s+${AR})*\\s+[^\\s,;]+|-[^\\s,;]+)\\s*(?:[,;]\\s*|\\s+)`);
  if (!/^(pl\.|coll\.|n\. un\.|f\.|dual)\s/.test(s)) return s;
  for (let i = 0; i < 5; i++) {
    const m = s.match(lead);
    if (!m || m[0].length >= s.length) break;
    s = s.slice(m[0].length);
  }
  return s;
}

export function shortGloss(s, n = 120) {
  s = stripGrammar(plain(String(s || '')));
  const semi = s.indexOf(';');
  if (semi > 0 && semi <= n) s = s.slice(0, semi);
  if (s.length > n) {
    const cut = s.lastIndexOf(' ', n);
    s = s.slice(0, cut > n * 0.6 ? cut : n).replace(/[\s,;:.(–-]+$/, '') + '…';
  }
  return s.trim();
}
