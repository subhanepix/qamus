// Qamus Mobile · Claude Preview
// Pure static, device-only, zero-account mobile version of the Qamus Mac Desk.
// Reuses ../engine.js and ../data/ unchanged; powers Grammar-in-Context and Vision OCR
// directly from the browser via ./claude-harness.js (BYOK API key stored only on this device).

import {
  initEngine, onEngineUpdate, state, resolveQuery, suggestions, glossFor, loadHw,
  uniqParses, rootLabel, stripHead, defHtml, arHtml, esc, plain, norm, isAr,
  laneKey, loadLaneEntries, arKeysFor, arShard, arHead, AR_IDS, AR_DICTS, VERB_PATTERNS,
  searchEnglish, shortGloss, hasTashkeel, nearestMatches,
} from './engine.js';

import {
  MODEL_PRESETS, sessionStats,
  getApiKey, setApiKey, clearApiKey, hasApiKey,
  getKeyStorageMode, setKeyStorageMode,
  getAiPrefs, saveAiPrefs, clearAnalysisCache,
  testApiKey, analyzeWordWithClaude, compressImageToJpeg, scanImageWithClaude,
} from './claude-harness.js';

import {
  listBooks, importPdfFile, deleteBook, updateBookProgress,
  getBookOutline, renderPdfPageToCanvas, renderPdfPageToJpeg,
  getCachedPageText, saveCachedPageText,
} from './pdf-books.js';

// Resolve engine's relative `data/…` fetches against ../ (one directory up).
const ENGINE_BASE = new URL('./', import.meta.url);
const nativeFetch = window.fetch.bind(window);
window.fetch = (u, o) => nativeFetch(
  typeof u === 'string' && u.startsWith('data/') ? new URL(u, ENGINE_BASE).href : u,
  o
);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view'), insp = $('#insp'), desk = $('#desk'), grammarTray = $('#grammar-tray');

// ---------- Local Device-Only Store (Zero Account / Zero Cloud Sync) ----------
const KEY = 'qamus.mobile.claude.v1';
const INBOX = 'f_inbox';
const DAY = 86400000;
const clip = (s, max = 2048) => String(s || '').trim().slice(0, max);
const uid = (p = '') => (p ? p + '_' : '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const SAMPLES = [
  {
    title: 'الداء والدواء · حديث الرقية',
    note: 'Sample · Classical Arabic + Footnotes (Ibn al-Qayyim, p. 7)',
    body: `وقد ثبت في الصحيحين (١) من حديث أبي سعيد قال: انطلق نفر من أصحاب النبي ﷺ (٢) في سَفْرة سافروها حتى نزلوا على حيّ من أحياء العرب، فاستضافوهم، فأبوا أن يُضَيّفوهم (٣). فلُدِغَ سيّدُ ذلك الحي، فسعوا له بكل شيء، لا ينفعه شيء، فقال بعضهم: لو أتيتم هؤلاء الرهط الذين نزلوا، لعلّه أن يكون عند بعضهم شيء (٤).

فانطلق يتفُل عليه، ويقرأ ﴿ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ ﴾ [الفاتحة/ ٢]. فكأنما نُشِطَ من عِقال، فانطلق يمشي، وما به قَلَبة (٦).

---

(١) أخرجه البخاري (٢٢٧٦) ومسلم (٢٢٠١).
(٢) ف: «رسول الله ﷺ».
(٣) س: «فلم يضيفوهم».
(٤) ل: «عندهم بعض شيء».
(٦) القلبة: الألم والعلّة. انظر النهاية (٤/ ٩٨).`,
  },
  {
    title: 'فصل في حسن الظن والغرور',
    note: 'Sample · Classical Arabic (Ibn al-Qayyim, p. 86)',
    body: `فصل

فقد تبين (١) الفرق بين حسن الظن والغرور، وأنّ حسن الظن إن حمل على العمل، وحثَّ عليه، وساق إليه، فهو صحيح. وإن دعا إلى البطالة والانهماك في المعاصي، فهو غرور.

ولو أن رجلاً له أرض يؤمّل أن يعود عليه من مُغَلِّها ما ينفعه فأهملها، ولم يبذُرها، ولم يحرثها، وأحسن ظنه بأنه يأتي من مغلّها ما يأتي مَن حَرَث (٣)، وبَذَر، وسقَى، وتعاهَد الأرضَ، لعدّه الناس من أسفه السفهاء.`,
  },
  {
    title: 'سورة الفاتحة',
    note: 'Sample · Qur’an 1',
    body: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ﴿١﴾ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ ﴿٢﴾ الرَّحْمَٰنِ الرَّحِيمِ ﴿٣﴾ مَالِكِ يَوْمِ الدِّينِ ﴿٤﴾ إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ ﴿٥﴾ اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ ﴿٦﴾ صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ ﴿٧﴾',
  },
];

function loadDb() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && Array.isArray(d.texts)) {
      d.settings ||= { theme: 'system', arFont: 'amiri', size: 'm' };
      d.cards ||= [];
      d.folders ||= [{ id: INBOX, name: 'Inbox', created: Date.now() }];
      if (!d.folders.some(f => f.id === INBOX)) d.folders.unshift({ id: INBOX, name: 'Inbox', created: Date.now() });
      d.history ||= [];
      return d;
    }
  } catch {}
  const now = Date.now();
  return {
    texts: SAMPLES.map((s, i) => ({
      id: uid('tx') + i, title: s.title, note: s.note, body: s.body,
      source: 'sample', imageUrl: '', created: now - i * 1000, opened: now - i * 1000, looked: [],
    })),
    folders: [{ id: INBOX, name: 'Inbox', created: now }],
    cards: [],
    history: [],
    settings: { theme: 'system', arFont: 'amiri', size: 'm' },
  };
}

const db = loadDb();
let saveTimer = 0;
function flush() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 140);
}
window.addEventListener('pagehide', () => { if (saveTimer) flush(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) flush(); });

// ---------- Icons ----------
const ICON = {
  plus: `<svg viewBox="0 0 20 20"><path d="M10 4.5v11M4.5 10h11"/></svg>`,
  search: `<svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>`,
  save: `<svg viewBox="0 0 20 20"><path d="M5.5 3h9a.5.5 0 0 1 .5.5v13.3a.3.3 0 0 1-.47.25L10 14l-4.53 3.05a.3.3 0 0 1-.47-.25V3.5a.5.5 0 0 1 .5-.5z"/></svg>`,
  expand: `<svg viewBox="0 0 20 20"><path d="M12 4h4v4M16 4l-5.5 5.5M8 16H4v-4M4 16l5.5-5.5"/></svg>`,
  back: `<svg viewBox="0 0 20 20"><path d="M12.5 5 7.5 10l5 5"/></svg>`,
  edit: `<svg viewBox="0 0 20 20"><path d="m13.5 4.5 2 2-8.5 8.5-3 1 1-3z"/></svg>`,
  trash: `<svg viewBox="0 0 20 20"><path d="M4.5 6h11M7.5 6V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V6M6.5 6l.7 10a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.7-10"/></svg>`,
  copy: `<svg viewBox="0 0 20 20"><rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7"/></svg>`,
  text: `<svg viewBox="0 0 20 20"><path d="M5 3.5h7l3 3v10H5z"/><path d="M8 9.5h5M8 12.5h5"/></svg>`,
  review: `<svg viewBox="0 0 20 20"><rect x="3.5" y="5" width="13" height="10" rx="1.5"/><path d="M6.5 3h7"/></svg>`,
  camera: `<svg viewBox="0 0 20 20"><path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h2l1.2-1.8a1 1 0 0 1 .83-.45h1.94a1 1 0 0 1 .83.45L13 6h2a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 15 16H5a1.5 1.5 0 0 1-1.5-1.5z"/><circle cx="10" cy="10.8" r="2.6"/></svg>`,
  image: `<svg viewBox="0 0 20 20"><rect x="3.5" y="4.5" width="13" height="11" rx="1.5"/><circle cx="7.5" cy="8.2" r="1.2"/><path d="m4.5 14 3.5-3.5 2.5 2.5 2-2 3 3"/></svg>`,
  book: `<svg viewBox="0 0 20 20"><path d="M4.5 4.5A2 2 0 0 1 6.5 3H16v13.5H6.5a2 2 0 0 0-2 1.5z"/><path d="M4.5 16a2 2 0 0 1 2-1.5H16"/></svg>`,
  spark: `<svg viewBox="0 0 20 20"><path d="M10 2.5 11.8 8.2 17.5 10l-5.7 1.8L10 17.5l-1.8-5.7L2.5 10l5.7-1.8z"/></svg>`,
};

// ---------- Formatting Helpers ----------
const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;
function ago(t) {
  const s = Math.max(0, (Date.now() - (t || 0)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 14) return Math.round(s / 86400) + 'd ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function dueLabel(c) {
  if (!c.reps && !c.last) return 'New';
  const d = c.due - Date.now();
  if (d <= 0) return 'Due';
  const h = d / 3600000;
  return h < 36 ? `in ${Math.max(1, Math.round(h))}h` : `in ${Math.round(d / DAY)}d`;
}
function isDue(c) { return (!c.reps && !c.last) || (c.due || 0) <= Date.now(); }

let toastTimer = 0;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.run(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 4800 : 2600);
}

// ---------- Appearance & AI Status UI ----------
function applySettings() {
  const s = db.settings || {};
  const r = document.documentElement;
  if (s.theme && s.theme !== 'system') r.dataset.theme = s.theme; else delete r.dataset.theme;
  if (s.arFont && s.arFont !== 'amiri') r.dataset.arFont = s.arFont; else delete r.dataset.arFont;
  if (s.size && s.size !== 'm') r.dataset.size = s.size; else delete r.dataset.size;
  $$('#settings-modal .seg[data-setting]').forEach(g => {
    const curVal = s[g.dataset.setting] || (g.dataset.setting === 'theme' ? 'system' : g.dataset.setting === 'arFont' ? 'amiri' : 'm');
    $$('button', g).forEach(b => b.setAttribute('aria-pressed', b.dataset.v === curVal));
  });
}

function renderAiStatusChrome() {
  const ok = hasApiKey();
  const prefs = getAiPrefs();
  const preset = MODEL_PRESETS[prefs.preset] || MODEL_PRESETS.haiku_fast;
  const sideBtn = $('#ai-status-side');
  if (sideBtn) {
    sideBtn.classList.toggle('ready', ok);
    sideBtn.querySelector('.ai-lbl').textContent = ok ? `Claude · ${preset.short}` : 'Set Claude API Key';
  }
  const topBtn = $('#ai-status-top');
  if (topBtn) {
    topBtn.classList.toggle('ready', ok);
    topBtn.querySelector('.ai-top-lbl').textContent = ok ? preset.short : 'API Key';
  }
}

function renderSettingsModal() {
  const ok = hasApiKey();
  const mode = getKeyStorageMode();
  const prefs = getAiPrefs();

  const badge = $('#key-state-badge');
  if (badge) {
    badge.textContent = ok ? (mode === 'session' ? 'Active (Tab only)' : 'Active (Device)') : 'Not set';
    badge.classList.toggle('ok', ok);
  }
  const inp = $('#claude-key-input');
  if (inp) {
    inp.value = getApiKey();
    inp.type = 'password';
    const vis = $('#toggle-key-vis');
    if (vis) vis.textContent = 'Show';
  }
  $$('#key-mode-seg button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.mode === mode);
  });

  const plist = $('#preset-list');
  if (plist) {
    plist.innerHTML = Object.values(MODEL_PRESETS).map(p => {
      const active = p.id === prefs.preset;
      return `<button type="button" class="preset-opt" data-preset="${esc(p.id)}" aria-pressed="${active}">
        <span class="p-top"><span>${esc(p.label)}</span>${active ? '<span class="pill accent" style="height:18px;font-size:10.5px">Active</span>' : ''}</span>
        <span class="p-sub">${esc(p.desc)}</span>
      </button>`;
    }).join('');
  }

  const autoTog = $('#auto-analyze-toggle');
  if (autoTog) autoTog.checked = prefs.autoAnalyze;

  const usageEl = $('#usage-strip');
  if (usageEl) {
    const costStr = sessionStats.estCostUsd < 0.0001 && sessionStats.taps + sessionStats.scans === 0
      ? '$0.0000'
      : `$${sessionStats.estCostUsd.toFixed(4)}`;
    usageEl.textContent = `Session: ${sessionStats.taps} grammar taps (${sessionStats.cacheHits} prompt-cache hits) · ${sessionStats.scans} page scans · est. ${costStr}`;
  }
  applySettings();
}

function openSettingsModal() {
  renderSettingsModal();
  $('#settings-modal').hidden = false;
}
function closeSettingsModal() {
  $('#settings-modal').hidden = true;
  $('#key-test-status').hidden = true;
}

// ---------- Engine Ready State ----------
const STAGE_ORDER = { idle: 0, morph: 1, index: 2, full: 3 };
const STAGE_LABEL = { idle: 'Loading lexicons…', morph: 'Morphology ready', index: 'Loading Wiktionary…', full: 'Offline lexicons ready' };
const atLeast = s => (STAGE_ORDER[state.readyStage] || 0) >= STAGE_ORDER[s];
const waiters = [];
const ready = s => (atLeast(s) ? Promise.resolve() : new Promise(r => waiters.push([s, r])));
onEngineUpdate(stage => {
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (atLeast(waiters[i][0])) waiters.splice(i, 1)[0][1]();
  }
  const el = $('#engine-status');
  if (el) {
    el.classList.toggle('ready', stage === 'full');
    el.lastElementChild.textContent = STAGE_LABEL[stage] || stage;
  }
  if (stage === 'full' && cur?.stage && cur.stage !== 'full') lookup(cur.q, cur.ctx, { quiet: true, keepStack: true });
});

// ---------- Known Words & Vocabulary Helpers (100% Local) ----------
let knownSet = new Set();
function refreshKnown() {
  knownSet = new Set((db.cards || []).map(c => norm(c.w || c.head || '')).filter(Boolean));
  const due = (db.cards || []).filter(isDue).length;
  const dc = $('#due-count'); if (dc) { dc.hidden = !due; dc.textContent = due; }
  const td = $('#tab-due'); if (td) { td.hidden = !due; td.textContent = due; }
  const vc = $('#vocab-count'); if (vc) { vc.hidden = !db.cards.length; vc.textContent = db.cards.length; }
  const tc = $('#texts-count'); if (tc) { tc.hidden = !db.texts.length; tc.textContent = db.texts.length; }
  $$('.passage .w').forEach(el => {
    const tk = tokens[+el.dataset.i];
    if (tk) el.classList.toggle('known', isKnown(tk.w));
  });
}
const isKnown = w => knownSet.has(norm(w));

function isSaved(target, fallbackWord = '') {
  if (!target) return false;
  const key = target.key || norm(target.head || fallbackWord);
  return db.cards.some(c => c.ref === key || norm(c.head) === norm(target.head || fallbackWord));
}

function saveAnswer(target) {
  if (!target) return;
  const word = cur?.ctx?.word || cur?.q || target.head || '';
  const ref = target.key || norm(target.head || word);
  const existing = db.cards.find(c => c.ref === ref || (norm(c.head) === norm(target.head || word) && c.gloss === target.gloss));
  if (existing) {
    db.cards = db.cards.filter(c => c.id !== existing.id);
    persist(); refreshKnown(); renderInspector();
    toast(`Removed ${existing.head || existing.w}`);
    return;
  }
  const card = {
    id: uid('c'),
    folder: vocabUi.at || INBOX,
    ref,
    w: word,
    head: target.head || word,
    gloss: clip(plain(target.gloss || target.html || ''), 300),
    tr: target.tr || '',
    root: target.root || '',
    ctx: clip(cur?.ctx?.sentence || '', 400),
    src: target.source || 'hw',
    created: Date.now(),
    due: 0, ivl: 0, ease: 2.5, reps: 0, lapses: 0, last: 0,
  };
  db.cards.unshift(card);
  persist(); refreshKnown(); renderInspector();
  toast(`Saved ${card.head}`);
}

function primarySaveTarget() {
  if (!cur?.model) return null;
  const a = cur.analysis;
  const ctx = cur.ctx || {};
  const answers = cur.model.answers || [];
  if (a && typeof a === 'object' && !a.error && a.meaningHere) {
    const head = a.vocalized || ctx.word || cur.q;
    return {
      source: 'custom',
      key: `ctx:${norm(head)}:${norm(ctx.sentence || '').slice(0, 24)}`,
      head,
      tr: cur.model.tr || '',
      root: a.root || cur.model.roots?.[0]?.letters || '',
      gloss: a.meaningHere,
    };
  }
  return answers[0] || null;
}

// ---------- Lookup Model + Hamza Fallback + Claude Auto-Analysis ----------
let cur = null; // { q, ctx, model, stage, loading, analysis }
let lookSeq = 0;
let inspStack = [];
const saveables = new Map();
let saveSeq = 0;
let activeAiAbort = null;
let trayCollapsed = false;

function formICut(e) {
  const s = stripHead(e);
  const cut = s.search(/<b>\s*(I{1,3}|IV|VI{0,3}|IX|X)\s*<\/b>/);
  return cut >= 0 ? s.slice(0, cut).trim() : s;
}
function rootLetters(rid) {
  const r = state.byId.get(rid);
  return r ? [...r[1]].join(' ') : '';
}

function resolveWithHamzaFallback(q) {
  let res = resolveQuery(q);
  if (res.kind !== 'fallback') return res;
  const stripped = norm(q);
  const cands = new Set();
  const baseNoAl = stripped.replace(/^(?:وال|فال|بال|كال|لل|ال|و|ف|ب|ل|ك)/, '');
  for (const s of [stripped, baseNoAl].filter(Boolean)) {
    const noSuf = s.replace(/(?:ين|ون|ان|ات|هما|هم|هن|كم|كن|ها|ه|ة)$/, '');
    if (noSuf && noSuf !== s) {
      cands.add(noSuf);
      if (noSuf.endsWith('ئ')) { cands.add(noSuf.slice(0, -1) + 'أ'); cands.add(noSuf.slice(0, -1) + 'ء'); }
      if (noSuf.startsWith('م') && noSuf.length >= 4) {
        const v = noSuf.slice(1);
        cands.add(v);
        if (v.endsWith('ئ')) { cands.add(v.slice(0, -1) + 'أ'); cands.add(v.slice(0, -1) + 'ء'); }
      }
    }
    if (s.includes('ئ')) { cands.add(s.replace(/ئ/g, 'أ')); cands.add(s.replace(/ئ/g, 'ء')); }
  }
  for (const cand of cands) {
    if (!cand || cand.length < 2) continue;
    const alt = resolveQuery(cand);
    if (alt.kind === 'roots' && alt.roots?.length) return { ...alt, q };
  }
  return res;
}

function buildModel(q, res) {
  const m = { query: q, kind: res.kind, word: q, tr: '', parses: [], roots: [], answers: [], sources: {}, retry: null };
  if (res.kind === 'english') {
    const r = searchEnglish(q);
    m.english = [...r.tr, ...r.scored.map(x => x[1]).filter(e => !r.tr.includes(e))].slice(0, 40);
    m.total = r.total || 0;
    return m;
  }
  if (res.kind === 'fallback') { m.near = nearestMatches(res.n).slice(0, 14); return m; }
  if (res.kind === 'passage') return m;

  const roots = res.roots || [];
  const o = res.opt || {};
  const particles = o.particles || [];
  const particlePrefix = particles[0]?._prefix || '';
  const hits = o.exactHits?.size ? o.exactHits : (o.hits || new Set());
  m.retry = o.retry || null;

  m.parses = uniqParses(o.parses || []).slice(0, 3).map(a => ({
    segments: [
      a.pre[0] && { role: 'prefix', ar: a.pre[0], gloss: a.pre[2] || 'prefix' },
      { role: 'stem', ar: a.stem[0], gloss: (a.stem[2] || '').split(';')[0] },
      a.suf[0] && { role: 'suffix', ar: a.suf[0], gloss: a.suf[2] || 'suffix' },
    ].filter(Boolean),
    root: rootLabel(a.stem),
    gloss: [a.pre[2], (a.stem[2] || '').replace(/;/g, '; '), a.suf[2]].filter(Boolean).join(' + '),
  }));

  m.roots = roots.map(rid => {
    const r = state.byId.get(rid);
    return r && { id: rid, letters: [...r[1]].join(' '), quran: r[5] || 0, words: (state.kids.get(rid)?.length || 0) + 1, forms: state.formsBy.get(rid)?.length || 0 };
  }).filter(Boolean);

  for (const p of particles.slice(0, 2)) {
    m.answers.push({ source: 'particle', key: 'p:' + p.ar, head: p.ar, tr: p.tr, label: particlePrefix ? `${particlePrefix} + ${p.enCat}` : p.enCat, html: esc(p.meaning) + (p.effect ? `<div class="muted" style="margin-top:4px;font-size:12.5px">عمل · ${esc(p.effect)}</div>` : ''), gloss: `${p.enCat}: ${p.meaning}` });
  }
  const topParse = (o.parses || [])[0];
  const verbal = !!topParse && /^(PV|IV|CV)/.test(topParse.stem[1]);
  for (const e of [...hits].map(id => state.byId.get(id)).filter(Boolean).slice(0, 3)) {
    const html = e[3] ? formICut(e) : stripHead(e);
    m.answers.push({ source: 'hw', key: 'hw:' + e[0], head: e[1], tr: e[6] || '', label: e[3] && verbal ? 'Form I' : 'Hans Wehr', html: defHtml(html), gloss: shortGloss(html, 140), root: rootLetters(e[4]) });
  }
  for (const f of (o.forms || []).slice(0, 2)) {
    if (!f[3]) continue;
    m.answers.push({ source: 'form', key: `form:${f[0]}:${f[1]}`, head: f[2] || '', tr: '', label: `Form ${f[1]}`, html: defHtml(f[3]), gloss: shortGloss(f[3], 140), root: rootLetters(f[0]) });
  }
  if (!m.answers.length && state.W) {
    for (const k of (o.wikt || []).slice(0, 2)) {
      const e = state.W.entries[k];
      m.answers.push({ source: 'wikt', key: 'wikt:' + k, head: e[0], tr: e[1] || '', label: 'Wiktionary', html: defHtml(e[2], ['i', 'br', 'ol', 'li']), gloss: shortGloss(e[2], 140) });
    }
  }
  if (!m.answers.length) {
    for (const a of uniqParses(o.bwOnly || []).slice(0, 2)) {
      const w = a.stem[4] || a.stem[0];
      m.answers.push({ source: 'lexicon', key: 'lex:' + w, head: w, tr: '', label: 'Lexicon', html: esc(a.stem[2].replace(/;/g, '; ')), gloss: a.stem[2].replace(/;/g, '; '), root: rootLabel(a.stem) });
    }
  }
  if (!m.answers.length && roots.length) {
    const r = state.byId.get(roots[0]);
    if (r) m.answers.push({ source: 'hw', key: 'hw:' + r[0], head: r[1], tr: r[6] || '', label: 'Root', html: defHtml(formICut(r)), gloss: shortGloss(formICut(r), 140), root: rootLetters(r[0]) });
  }
  const seenAnswers = new Set();
  m.answers = m.answers.filter(a => {
    const k = norm(a.head) + '|' + plain(a.html).slice(0, 120);
    if (seenAnswers.has(k)) return false;
    seenAnswers.add(k); return true;
  });

  const lead = m.answers[0];
  m.word = particles[0] ? (particles[0]._exact || particlePrefix ? particles[0].ar : q) : hasTashkeel(q) ? q : (lead?.head || q);
  m.tr = lead?.tr || '';
  m.exactHarakat = hasTashkeel(q) && ((o.exactHits?.size || 0) > 0 || particles.some(p => p._exact));
  const laneKeys = [...new Set([...roots.map(rid => laneKey(norm(state.byId.get(rid)?.[1] || ''))), ...(o.laneOnly || []).map(lr => laneKey(lr))].filter(Boolean))];
  const arKeys = arKeysFor(roots, [...(o.laneOnly || []), o.arWord || '']);
  m.sources = { roots, hits: new Set([...hits, ...(o.hits || [])]), particles, wikt: o.wikt || [], laneKeys, laneWant: o.laneWord || norm(q), arKeys, arWant: norm(q).replace(/^ال/, '') };
  return m;
}

function pushHistory(q) {
  const clean = clip(q, 200);
  if (!clean) return;
  const n = norm(clean);
  db.history = (db.history || []).filter(h => norm(h.q) !== n);
  db.history.unshift({ q: clean, t: Date.now() });
  db.history.length = Math.min(db.history.length, 300);
  persist();
}

function currentActivePageText() {
  if (curText?.body) return curText.body;
  if (curBook?.pageText) return curBook.pageText;
  return cur?.ctx?.surrounding || cur?.ctx?.sentence || '';
}

async function runClaudeAnalysis({ presetOverride = null, force = false } = {}) {
  if (!cur?.ctx?.sentence) return;
  if (!hasApiKey()) {
    openSettingsModal();
    toast('Add your Anthropic API key (stored only on this device)');
    return;
  }
  if (activeAiAbort) { try { activeAiAbort.abort(); } catch {} }
  const ctrl = new AbortController();
  activeAiAbort = ctrl;
  const targetSeq = lookSeq;
  const snapCur = cur;

  trayCollapsed = false;
  cur.analysis = { pending: true, label: presetOverride ? MODEL_PRESETS[presetOverride]?.short : MODEL_PRESETS[getAiPrefs().preset]?.short };
  renderGrammarTray();
  renderInspector();

  try {
    const res = await analyzeWordWithClaude({
      word: snapCur.ctx.word || snapCur.q,
      sentence: snapCur.ctx.sentence,
      surrounding: snapCur.ctx.surrounding || snapCur.ctx.sentence,
      occurrence: snapCur.ctx.occurrence || 1,
      pageText: currentActivePageText(),
      model: snapCur.model,
      loaders: { loadLaneEntries, arShard },
      presetOverride,
      force,
      signal: ctrl.signal,
    });
    if (targetSeq !== lookSeq || !cur) return;
    cur.analysis = res;
    renderGrammarTray();
    renderInspector();

    // Auto-heal "No entry found" dictionary lookups using Claude's verified vocalized word / root!
    if (cur.model?.kind === 'fallback') {
      const cands = [];
      if (res.vocalized && norm(res.vocalized) !== norm(cur.q)) cands.push(res.vocalized);
      if (res.root) {
        const compact = res.root.replace(/\s+/g, '');
        if (compact.length >= 2) cands.push(compact);
      }
      for (const cand of cands) {
        const alt = resolveWithHamzaFallback(cand);
        if (alt.kind === 'roots' && alt.roots?.length) {
          await loadHw(alt.roots).catch(() => {});
          if (targetSeq !== lookSeq || !cur) return;
          cur = { ...cur, model: buildModel(cand, alt), analysis: res };
          renderInspector();
          break;
        }
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError' || targetSeq !== lookSeq || !cur) return;
    cur.analysis = { error: err?.message === 'NO_KEY' ? 'No API key set.' : (err?.message || String(err)) };
    renderGrammarTray();
    renderInspector();
  } finally {
    if (activeAiAbort === ctrl) activeAiAbort = null;
  }
}

async function lookup(q, ctx = {}, opts = {}) {
  q = String(q || '').trim();
  if (!q) return;
  if (!opts.keepStack && !opts.fromLink) inspStack = [];
  if (opts.fromLink && cur?.model) inspStack.push({ q: cur.q, ctx: cur.ctx });
  if (activeAiAbort) { try { activeAiAbort.abort(); } catch {} activeAiAbort = null; }
  const seq = ++lookSeq;
  if (!opts.quiet) {
    cur = { q, ctx, loading: true, analysis: null };
    renderInspector();
  }
  await ready('morph');
  const res = resolveWithHamzaFallback(q);
  if (res.kind === 'roots' && res.roots.length) {
    try { await loadHw(res.roots); } catch {}
  }
  if (seq !== lookSeq) return;
  const model = buildModel(res.q || q, res);
  cur = { q, ctx, model, stage: state.readyStage, loading: false, analysis: opts.quiet ? cur?.analysis : null };
  if (!opts.quiet && model.kind === 'roots') pushHistory(q);
  renderInspector();
  renderGrammarTray();
  if (route().name === 'entry' && route().arg === q) renderEntry(q);

  // Trigger Claude Grammar-in-Context automatically when tapping a word in a passage/book
  if (!opts.quiet && ctx?.sentence && hasApiKey() && getAiPrefs().autoAnalyze) {
    runClaudeAnalysis({ force: false });
  }
}

// ---------- Grammar Card Renderer (shared between Mobile Sheet & Desktop Bottom Tray) ----------
const isPhoneLayout = () => matchMedia('(max-width: 760px)').matches;

function inlineGrammarCardHtml() {
  const ctx = cur?.ctx || {};
  if (!ctx.sentence) return '';
  const a = cur?.analysis;
  const word = ctx.word || cur?.q || '';
  const keyOk = hasApiKey();

  if (!keyOk) {
    return `<div class="insp-grammar">
      <div class="ig-head">
        <span class="ig-kicker">Grammar in Context</span>
        <div class="ig-actions">
          <button type="button" class="btn sm primary" data-act="open-settings">Set API Key</button>
        </div>
      </div>
      <p class="muted" style="margin:0;font-size:12.5px">Paste your Anthropic API key (stored on this device only) for instant classical Arabic iʿrāb &amp; contextual meaning.</p>
    </div>`;
  }

  if (a?.pending) {
    return `<div class="insp-grammar">
      <div class="ig-head">
        <span class="ig-kicker">Grammar · ${esc(a.label || 'Claude')}</span>
        <span class="ig-meta">Analyzing…</span>
      </div>
      <div class="ig-word-row"><span class="ig-voc" lang="ar">${esc(word)}</span></div>
    </div>`;
  }

  if (a?.error) {
    return `<div class="insp-grammar err">
      <div class="ig-head">
        <span class="ig-kicker">Grammar Error</span>
        <div class="ig-actions">
          <button type="button" class="btn sm" data-act="analyze">Retry</button>
        </div>
      </div>
      <p class="ig-warn" style="margin:0">${esc(a.error)}</p>
    </div>`;
  }

  if (a && typeof a === 'object') {
    const metaBits = [
      a.presetLabel || 'Claude',
      a.localCacheHit ? 'cached' : (a.wallSec ? `${a.wallSec.toFixed(1)}s` : ''),
      a.cachedPrompt ? '⚡ prompt cache' : '',
    ].filter(Boolean).join(' · ');
    const isSonnet = /sonnet/i.test(a.modelId || '');
    const mods = (a.actingOnIt || []).map(g => `<div class="ig-chip">
      ${g.particle ? `<span class="ar" lang="ar">${esc(g.particle)}</span>` : ''}
      <span class="rel">${esc(g.role || '')}</span>
      ${g.effect ? `<span class="note">${esc(g.effect)}</span>` : ''}
    </div>`).join('');
    const args = (a.arguments || []).map(g => `<div class="ig-chip">
      <span class="rel">${esc(g.relation || '')}</span>
      ${g.arabic ? `<span class="ar" lang="ar">${esc(g.arabic)}</span>` : ''}
      ${g.note ? `<span class="note">${esc(g.note)}</span>` : ''}
    </div>`).join('');

    return `<div class="insp-grammar">
      <div class="ig-head">
        <span class="ig-kicker">Grammar</span>
        <span class="ig-meta">${esc(metaBits)}</span>
        <div class="ig-actions">
          ${!isSonnet ? `<button type="button" class="btn sm" data-act="analyze-sonnet" title="Re-analyze this word with Claude Sonnet">Deep</button>` : ''}
          <button type="button" class="btn sm ghost" data-act="analyze">Re-run</button>
        </div>
      </div>
      <div class="ig-word-row">
        <span class="ig-voc" lang="ar">${esc(a.vocalized || word)}</span>
        <span class="ig-pos">${esc(a.partOfSpeech || '')}${a.arabicTag ? ` · <span class="ar" lang="ar">${esc(a.arabicTag)}</span>` : ''}</span>
      </div>
      <p class="ig-meaning">${esc(a.meaningHere || '—')}</p>
      ${(a.diacritizedLine || a.clauseTranslation) ? `<div class="ig-clause-box">
        ${a.diacritizedLine ? `<p class="ig-diac" lang="ar">${esc(a.diacritizedLine)}</p>` : ''}
        ${a.clauseTranslation ? `<p class="ig-trans">“${esc(a.clauseTranslation)}”</p>` : ''}
      </div>` : ''}
      ${a.syntaxRole ? `<p class="ig-role"><strong>Iʿrāb:</strong> ${esc(a.syntaxRole)}</p>` : ''}
      ${(mods || args) ? `<div class="ig-chips">${mods}${args}</div>` : ''}
      ${a.ambiguityNote ? `<p class="ig-warn">⚠ ${esc(a.ambiguityNote)}</p>` : ''}
    </div>`;
  }

  return `<div class="insp-grammar">
    <div class="ig-head">
      <span class="ig-kicker">Grammar in Context</span>
      <div class="ig-actions">
        <button type="button" class="btn sm primary" data-act="analyze">Explain</button>
      </div>
    </div>
    <p class="muted" style="margin:0;font-size:12.5px">Tap Explain for classical Arabic syntax &amp; contextual meaning.</p>
  </div>`;
}

function renderGrammarTray() {
  if (!grammarTray) return;
  const inReader = route().name === 'text' || route().name === 'book';
  const ctx = cur?.ctx || {};
  if (!inReader || !ctx.sentence || isPhoneLayout()) {
    grammarTray.hidden = true;
    grammarTray.innerHTML = '';
    return;
  }
  grammarTray.hidden = false;
  grammarTray.classList.toggle('collapsed', trayCollapsed);
  const a = cur?.analysis;
  const word = ctx.word || cur?.q || '';
  const chev = trayCollapsed ? '▴' : '▾';

  if (a?.pending) {
    grammarTray.innerHTML = `<div class="gt-inner"><div class="gt-bar" data-act="toggle-tray">
      <span class="gt-title">Grammar</span><span class="gt-word" lang="ar">${esc(word)}</span>
      <span class="gt-pos muted">Analyzing with ${esc(a.label || 'Claude')}…</span>
      <div class="gt-bar-right"><span class="muted" style="font-size:12px">${chev}</span></div>
    </div></div>`;
    return;
  }
  if (a?.error) {
    grammarTray.innerHTML = `<div class="gt-inner"><div class="gt-bar" data-act="toggle-tray">
      <span class="gt-title">Grammar</span><span class="gt-word" lang="ar">${esc(word)}</span>
      <div class="gt-bar-right"><button type="button" class="btn sm" data-act="analyze">Retry</button><span class="muted">${chev}</span></div>
    </div>${trayCollapsed ? '' : `<div class="gt-body"><p class="gt-warn">${esc(a.error)}</p></div>`}</div>`;
    return;
  }
  if (a && typeof a === 'object') {
    const posLine = [a.partOfSpeech && esc(a.partOfSpeech), a.arabicTag && `<span class="ar" style="font-size:15px">${esc(a.arabicTag)}</span>`].filter(Boolean).join(' · ');
    const isSonnet = /sonnet/i.test(a.modelId || '');
    const badge = `<span class="pill ${a.cachedPrompt || a.localCacheHit ? 'good' : 'accent'}" style="height:20px">${esc(a.presetLabel || 'Claude')}${a.wallSec ? ` · ${a.wallSec.toFixed(1)}s` : ''}${a.localCacheHit ? ' · cached' : ''}</span>`;
    const mods = (a.actingOnIt || []).map(g => `<div class="gt-item">${g.particle ? `<span class="gt-ar" lang="ar">${esc(g.particle)}</span>` : ''}<span class="gt-rel">${esc(g.role || '')}</span><span class="gt-eff">${esc(g.effect || '')}</span></div>`).join('');
    const args = (a.arguments || []).map(g => `<div class="gt-item"><span class="gt-rel">${esc(g.relation || '')}</span><span class="gt-ar" lang="ar">${esc(g.arabic || '')}</span>${g.note ? `<span class="gt-eff">${esc(g.note)}</span>` : ''}</div>`).join('');

    grammarTray.innerHTML = `<div class="gt-inner">
      <div class="gt-bar" data-act="toggle-tray">
        <span class="gt-title">Grammar</span>
        <span class="gt-word" lang="ar">${esc(a.vocalized || word)}</span>
        ${posLine ? `<span class="gt-pos">${posLine}</span>` : ''}
        ${badge}
        <div class="gt-bar-right">
          ${!isSonnet ? `<button type="button" class="btn sm" data-act="analyze-sonnet" title="Upgrade with Claude Sonnet">Deep (Sonnet)</button>` : ''}
          <button type="button" class="btn ghost sm" data-act="analyze">Re-run</button>
          <span class="muted" style="font-size:13px">${chev}</span>
        </div>
      </div>
      ${trayCollapsed ? '' : `<div class="gt-body">
        ${(a.diacritizedLine || a.clauseTranslation) ? `<div class="gt-band">
          ${a.diacritizedLine ? `<p class="gt-diac" lang="ar">${esc(a.diacritizedLine)}</p>` : ''}
          ${a.clauseTranslation ? `<p class="gt-clause">“${esc(a.clauseTranslation)}”</p>` : ''}
        </div>` : ''}
        <div class="gt-grid">
          <div class="gt-col">
            <div><p class="gt-sec-lbl">Meaning here</p><p class="gt-meaning">${esc(a.meaningHere || '—')}</p></div>
            ${mods ? `<div><p class="gt-sec-lbl">Acting on it · العوامل</p><div class="gt-chips">${mods}</div></div>` : ''}
          </div>
          <div class="gt-col">
            <div><p class="gt-sec-lbl">Iʿrāb &amp; role · الإعراب</p>${a.syntaxRole ? `<p class="gt-role">${esc(a.syntaxRole)}</p>` : ''}${args ? `<div class="gt-chips">${args}</div>` : ''}</div>
          </div>
        </div>
        ${a.ambiguityNote ? `<p class="gt-note">⚠ ${esc(a.ambiguityNote)}</p>` : ''}
      </div>`}
    </div>`;
    return;
  }
  grammarTray.innerHTML = `<div class="gt-inner"><div class="gt-bar" data-act="toggle-tray">
    <span class="gt-title">Grammar in context</span><span class="gt-word" lang="ar">${esc(word)}</span>
    <div class="gt-bar-right">
      ${hasApiKey() ? `<button type="button" class="btn sm primary" data-act="analyze">Explain</button>` : `<button type="button" class="btn sm primary" data-act="open-settings">Set API Key</button>`}
      <span class="muted">${chev}</span>
    </div>
  </div></div>`;
}

// ---------- Inspector & Full Entry Rendering ----------
function renderInspector() {
  if (!cur) {
    insp.innerHTML = `<div class="insp-empty"><div class="big-ar" lang="ar">ق</div><p>Tap any word in a passage or scanned page to see its root, classical lexicons, and Claude grammar analysis.</p></div>`;
    return;
  }
  if (cur.loading) {
    insp.innerHTML = `<div class="hw-head"><h2 class="hw-word" lang="ar">${esc(cur.q)}</h2></div><p class="muted">${atLeast('morph') ? 'Looking up…' : 'Loading lexicons…'}</p>`;
    return;
  }
  const phoneGrammar = isPhoneLayout() ? inlineGrammarCardHtml() : '';
  insp.innerHTML = phoneGrammar + entryHtml(cur.model, { full: false });
  openDefaultSources(insp);
}

function entryHtml(m, { full }) {
  const ctx = cur?.q === m.query || cur?.model === m ? (cur.ctx || {}) : {};
  const back = !full && inspStack.length
    ? `<button type="button" class="btn ghost sm" data-act="insp-back" style="margin:-4px 0 8px -8px">${ICON.back}<span>${esc(inspStack[inspStack.length - 1].q)}</span></button>` : '';

  if (m.kind === 'english') {
    return `${back}<p class="kicker">English · ${plural(m.total, 'match')}</p>
      <h2 style="margin:0 0 14px;font-size:22px">“${esc(m.query)}”</h2>
      ${m.english.length ? `<div>${m.english.map(e => `<div class="entry">
        <div class="entry-h"><span class="ar lk" data-q="${esc(e[1])}">${esc(e[1])}</span>${e[6] ? `<span class="tr">${esc(e[6])}</span>` : ''}</div>
        <div class="def">${esc(shortGloss(stripHead(e), 160))}</div></div>`).join('')}</div>` : `<p class="empty">No Hans Wehr definitions mention that.</p>`}`;
  }
  if (m.kind === 'fallback') {
    return `${back}<div class="hw-head"><h2 class="hw-word" lang="ar">${esc(m.query)}</h2></div>
      <p class="muted">No offline entry found. Closest spellings:</p>
      <div class="chips">${m.near.map(r => `<button type="button" class="chip" data-q="${esc(r[1])}"><span class="ar">${esc(r[1])}</span></button>`).join('') || '<span class="muted">None</span>'}</div>`;
  }
  if (m.kind === 'passage') {
    return `${back}<p class="kicker">That’s a passage</p><p class="context-quote">${esc(m.query)}</p>
      <div class="insp-foot"><button type="button" class="btn primary" data-act="passage-to-text">${ICON.text}<span>Open as a text</span></button></div>`;
  }

  const primaryTarget = primarySaveTarget() || m.answers[0];
  const primarySaved = primaryTarget ? isSaved(primaryTarget, cur?.ctx?.word || cur?.q || primaryTarget.head) : false;
  const asWritten = ctx.word && norm(ctx.word) !== norm(m.word) ? ctx.word : '';
  const parts = [];

  parts.push(`${back}<div class="hw-head">
    <div><h2 class="hw-word" lang="ar">${esc(m.word)}</h2>${m.tr ? `<div class="hw-tr">${esc(m.tr)}</div>` : ''}</div>
    <div class="hw-actions">
      ${primaryTarget ? `<button type="button" class="btn sm${primarySaved ? ' saved on' : ''}" data-act="save-primary">${ICON.save}<span class="lbl">${primarySaved ? 'Saved' : 'Save'}</span></button>` : ''}
      ${!full ? `<button type="button" class="btn sm ghost" data-act="open-entry" title="Open full entry">${ICON.expand}</button>` : `<button type="button" class="btn sm ghost" data-copy="${esc(m.word)}" title="Copy">${ICON.copy}</button>`}
    </div>
  </div>`);

  const pills = [];
  if (asWritten) pills.push(`<span class="pill">as written <span class="ar">${esc(asWritten)}</span></span>`);
  for (const r of m.roots) pills.push(`<button type="button" class="pill accent" data-q="${esc(r.letters)}">root <span class="ar">${esc(r.letters)}</span></button>`);
  if (m.roots[0]?.quran) pills.push(`<span class="pill gold">Qur’an ${m.roots[0].quran}×</span>`);
  if (m.exactHarakat) pills.push(`<span class="pill good">exact harakat</span>`);
  if (pills.length) parts.push(`<div class="hw-meta">${pills.join('')}</div>`);

  if (m.parses.length) {
    parts.push(`<div class="morph">${m.parses.slice(0, full ? 3 : 1).map(p => `<div class="morph-row">${p.segments.map(s => `<span class="seg-tok ${s.role}"><span class="ar" lang="ar">${esc(s.ar)}</span><small>${esc(s.gloss)}</small></span>`).join('<span class="plus">+</span>')}</div>`).join('')}</div>`);
  }

  if (m.answers.length) {
    parts.push(`<div class="answers">${m.answers.slice(0, full ? 6 : 3).map(a => {
      const sid = 's' + (++saveSeq);
      saveables.set(sid, a);
      const saved = isSaved(a, a.head);
      return `<div class="answer clamp">
        <div class="ans-head"><span class="ar" lang="ar">${esc(a.head)}</span>${a.tr ? `<span class="tr">${esc(a.tr)}</span>` : ''}<span class="ans-lbl">${esc(a.label)}</span>
          <button type="button" class="save-mini${saved ? ' on' : ''}" data-save="${sid}" title="Save card">${ICON.save}</button>
        </div>
        <div class="def">${a.html}</div>
      </div>`;
    }).join('')}</div>`);
  }

  // Secondary classical dictionaries (lazy-loaded on expand!)
  const s = m.sources || {};
  const secs = [];
  if (s.roots?.length) {
    secs.push(`<details class="src" data-src="hw" data-roots="${esc(s.roots.join(','))}" ${full ? 'open' : ''}>
      <summary><span>Hans Wehr · Root Family</span><span class="n">${s.roots.length}</span></summary><div class="src-body"></div></details>`);
  }
  if (s.wikt?.length) {
    secs.push(`<details class="src" data-src="wikt" data-keys="${esc(s.wikt.join(','))}">
      <summary><span>Wiktionary</span><span class="n">${s.wikt.length}</span></summary><div class="src-body"></div></details>`);
  }
  if (s.laneKeys?.length) {
    secs.push(`<details class="src" data-src="lane" data-keys="${esc(s.laneKeys.join(','))}" data-want="${esc(s.laneWant || '')}">
      <summary><span>Lane’s Lexicon</span><span class="n">${s.laneKeys.length}</span></summary><div class="src-body"></div></details>`);
  }
  for (const id of AR_IDS) {
    const keys = s.arKeys?.[id];
    if (keys?.length) {
      secs.push(`<details class="src" data-src="ar" data-dict="${esc(id)}" data-keys="${esc(keys.join(','))}" data-want="${esc(s.arWant || '')}">
        <summary><span>${esc(AR_DICTS[id]?.name || id)}</span><span class="n">${keys.length}</span></summary><div class="src-body"></div></details>`);
    }
  }
  if (secs.length) parts.push(`<div style="margin-top:12px">${secs.join('')}</div>`);
  return parts.join('');
}

function openDefaultSources(rootEl) {
  $$('details.src', rootEl).forEach(det => {
    const fill = async () => {
      if (det.dataset.filled) return;
      det.dataset.filled = '1';
      const body = $('.src-body', det);
      const kind = det.dataset.src;
      if (kind === 'hw') {
        const rids = det.dataset.roots.split(',').map(Number).filter(Boolean);
        await loadHw(rids).catch(() => {});
        body.innerHTML = rids.map(rid => {
          const r = state.byId.get(rid);
          if (!r) return '';
          const kids = [r, ...(state.kids.get(rid) || []).map(id => state.byId.get(id)).filter(Boolean)].slice(0, 14);
          return kids.map(e => `<div class="entry"><div class="entry-h"><span class="ar lk" data-q="${esc(e[1])}">${esc(e[1])}</span>${e[6] ? `<span class="tr">${esc(e[6])}</span>` : ''}</div><div class="def">${defHtml(stripHead(e))}</div></div>`).join('');
        }).join('') || '<p class="muted">No entries.</p>';
      } else if (kind === 'wikt' && state.W) {
        const keys = det.dataset.keys.split(',').filter(Boolean);
        body.innerHTML = keys.map(k => {
          const e = state.W.entries[k];
          return e ? `<div class="entry"><div class="entry-h"><span class="ar">${esc(e[0])}</span>${e[1] ? `<span class="tr">${esc(e[1])}</span>` : ''}</div><div class="def">${defHtml(e[2], ['i', 'br', 'ol', 'li'])}</div></div>` : '';
        }).join('');
      } else if (kind === 'lane') {
        body.innerHTML = '<p class="muted">Loading Lane’s Lexicon…</p>';
        const keys = det.dataset.keys.split(',').filter(Boolean);
        const want = det.dataset.want || '';
        const chunks = [];
        for (const k of keys.slice(0, 2)) {
          const entries = await loadLaneEntries(k).catch(() => []);
          for (const it of (entries || []).slice(0, 6)) {
            const hw = Array.isArray(it) ? it[0] : '';
            const txt = Array.isArray(it) ? it[1] : String(it);
            const hit = want && norm(hw).includes(want);
            chunks.push(`<div class="entry${hit ? ' hit' : ''}"><div class="entry-h"><span class="ar">${esc(hw)}</span></div><div class="def">${defHtml(txt)}</div></div>`);
          }
        }
        body.innerHTML = chunks.join('') || '<p class="muted">No Lane entries.</p>';
      } else if (kind === 'ar') {
        body.innerHTML = '<p class="muted">Loading…</p>';
        const dictId = det.dataset.dict;
        const keys = det.dataset.keys.split(',').filter(Boolean);
        const want = det.dataset.want || '';
        const chunks = [];
        for (const k of keys.slice(0, 2)) {
          const shard = await arShard(dictId, k).catch(() => null);
          const entries = shard?.[k] || [];
          for (const html of entries.slice(0, 4)) {
            chunks.push(`<div class="entry ar-dict" lang="ar">${arHtml(html, want)}</div>`);
          }
        }
        body.innerHTML = chunks.join('') || '<p class="muted">No entries.</p>';
      }
    };
    det.addEventListener('toggle', () => { if (det.open) fill(); });
    if (det.open) fill();
  });
}

// ---------- Rich Arabic Passage Tokenizer ----------
let tokens = [];
let selIndex = -1;
let curText = null;
let curBook = null;

const AR_WORD_RE = /[\u0621-\u064A\u0671\u067E\u0686\u0698\u06AF\u064B-\u065F\u0670\u0640]+/g;

function cleanForContext(line) {
  return String(line || '')
    .replace(/\$\^\{?[\(\[（]?[٠-٩0-9]+[\)\]）]?\}?\$/g, '')
    .replace(/<sup>.*?<\/sup>/gi, '')
    .replace(/\*\*|__/g, '')
    .replace(/^#{1,6}\s+/, '')
    .trim();
}

function tokenize(body) {
  const out = [];
  const rawParas = String(body || '').split(/\n{2,}/);
  const cleanParas = rawParas.map(p => cleanForContext(p.replace(/\n+/g, ' ')));
  let inFootnotes = false;
  let openedFnWrap = false;
  const parts = [];

  function renderRichLine(raw, paraClean, pIdx, isFn) {
    const lineClean = cleanForContext(raw);
    const surrounding = [cleanParas[pIdx - 1], paraClean, cleanParas[pIdx + 1]].filter(Boolean).join(' ').slice(0, 480);
    const occCounts = new Map();

    // Tokenize superscript footnote refs, ornate brackets, bold, and Arabic words cleanly
    const segRe = /(\$\^\{?[\(\[（]?[٠-٩0-9]+[\)\]）]?\}?\$|<sup>[^<]*<\/sup>|\(\s*[٠-٩0-9]+\s*\)|[﴿﴾]|[\u0621-\u064A\u0671\u067E\u0686\u0698\u06AF\u064B-\u065F\u0670\u0640]+)/g;
    let html = '', last = 0, m;
    while ((m = segRe.exec(raw))) {
      if (m.index > last) html += esc(raw.slice(last, m.index));
      const tok = m[0];
      last = m.index + tok.length;

      if (tok.startsWith('$^') || tok.startsWith('<sup>')) {
        const inner = tok.replace(/^\$\^\{?|\}?\$$|^<sup>|<\/sup>$/gi, '');
        html += `<sup class="fn-ref">${esc(inner)}</sup>`;
      } else if (/^\(\s*[٠-٩0-9]+\s*\)$/.test(tok)) {
        html += isFn ? `<span class="fn-num">${esc(tok)}</span>` : `<sup class="fn-ref">${esc(tok)}</sup>`;
      } else if (tok === '﴿' || tok === '﴾') {
        html += `<span class="q-bracket">${tok}</span>`;
      } else if (AR_WORD_RE.test(tok)) {
        AR_WORD_RE.lastIndex = 0;
        const n = norm(tok);
        const occ = (occCounts.get(n) || 0) + 1;
        occCounts.set(n, occ);
        const idx = out.length;
        out.push({ w: tok, sentence: lineClean, surrounding, occurrence: occ, el: null });
        html += `<span class="w" data-i="${idx}">${esc(tok)}</span>`;
      } else {
        html += esc(tok);
      }
    }
    if (last < raw.length) html += esc(raw.slice(last));
    return html;
  }

  rawParas.forEach((rawP, pIdx) => {
    const p = rawP.trim();
    if (!p) return;
    if (/^[-_—─]{3,}$/.test(p)) {
      inFootnotes = true;
      parts.push('<hr class="fn-rule">');
      if (!openedFnWrap) { parts.push('<div class="fn-block">'); openedFnWrap = true; }
      return;
    }
    if (!inFootnotes && /^[\(\[（]?[٠-٩0-9]+[\)\]）]\s*\S/.test(p)) {
      inFootnotes = true;
      parts.push('<hr class="fn-rule">');
      if (!openedFnWrap) { parts.push('<div class="fn-block">'); openedFnWrap = true; }
    }
    const headMatch = p.match(/^#{1,6}\s+(.+)$/);
    if (headMatch) {
      parts.push(`<h3 class="passage-h">${renderRichLine(headMatch[1], cleanParas[pIdx], pIdx, inFootnotes)}</h3>`);
      return;
    }
    if (!inFootnotes && /^(?:\*\*)?(?:فصل|فصلٌ|باب|بابٌ|مسألة|تتمة|تنبيه|فائدة)(?:\*\*)?$/.test(p)) {
      parts.push(`<h3 class="passage-h">${renderRichLine(p.replace(/\*\*/g, ''), cleanParas[pIdx], pIdx, false)}</h3>`);
      return;
    }
    const lines = p.split(/\n/);
    parts.push(`<p>${lines.map(l => renderRichLine(l, cleanParas[pIdx], pIdx, inFootnotes)).join('<br>')}</p>`);
  });
  if (openedFnWrap) parts.push('</div>');
  return { html: parts.join(''), toks: out };
}

function selectToken(i, { scroll = false } = {}) {
  const tk = tokens[i];
  if (!tk) return;
  if (tokens[selIndex]?.el) tokens[selIndex].el.classList.remove('on');
  selIndex = i;
  tk.el?.classList.add('on', 'seen');
  if (scroll) tk.el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (curText) {
    const n = norm(tk.w);
    if (!curText.looked.includes(n)) { curText.looked.push(n); persist(); }
    const ls = $('#looked-stat'); if (ls) ls.textContent = `${curText.looked.length} looked up`;
  }
  openInspector();
  lookup(tk.w, {
    word: tk.w,
    sentence: tk.sentence,
    surrounding: tk.surrounding,
    occurrence: tk.occurrence || 1,
    textId: curText ? curText.id : (curBook ? `book:${curBook.book.id}:${curBook.page}` : undefined),
    index: i,
  });
}

// ---------- Routing & Chrome ----------
function route() {
  const h = (location.hash || '#/desk').replace(/^#\/?/, '');
  const i = h.indexOf('/');
  return i < 0 ? { name: h || 'desk', arg: '' } : { name: h.slice(0, i), arg: decodeURIComponent(h.slice(i + 1)) };
}
function go(hash) {
  desk.classList.remove('side-open');
  syncScrim();
  if (location.hash === hash) render();
  else location.hash = hash;
}
function setBar(title, sub = '', actions = '', arTitle = false) {
  $('#crumbs').innerHTML = `<h1${arTitle ? ' lang="ar" dir="rtl"' : ''}>${title}</h1>${sub ? `<span class="sub">${sub}</span>` : ''}`;
  $('#stage-actions').innerHTML = actions;
}

function renderTextList() {
  const ul = $('#text-list');
  if (!ul) return;
  const r = route();
  const list = [...db.texts].sort((a, b) => (b.opened || b.created) - (a.opened || a.created)).slice(0, 7);
  ul.innerHTML = list.map(t => {
    const active = r.name === 'text' && r.arg === t.id ? ' aria-current="page"' : '';
    return `<li><a href="#/text/${encodeURIComponent(t.id)}"${active}><span class="t-title"${isAr(t.title) ? ' lang="ar"' : ''}>${esc(t.title)}</span><span class="t-meta">${esc(t.source === 'scan' ? 'Scan' : t.source === 'sample' ? 'Sample' : 'Text')} · ${ago(t.opened || t.created)}</span></a></li>`;
  }).join('') + (db.texts.length > 7 ? `<li><a href="#/texts" class="t-all">All texts (${db.texts.length}) →</a></li>` : '');
}

function render() {
  const r = route();
  const reading = r.name === 'text' || r.name === 'book';
  desk.classList.toggle('reading', reading);
  if (!reading) closeInspector();
  $$('.nav-item, .tab-item').forEach(el => {
    const dr = el.dataset.route;
    const match = dr === r.name || (dr === 'books' && r.name === 'book') || (dr === 'texts' && r.name === 'text');
    el.setAttribute('aria-current', match ? 'page' : 'false');
  });
  renderTextList();
  renderAiStatusChrome();

  if (r.name === 'desk') renderDesk();
  else if (r.name === 'scan') renderScanView();
  else if (r.name === 'new') renderComposer();
  else if (r.name === 'texts') renderTexts();
  else if (r.name === 'text') renderReader(r.arg);
  else if (r.name === 'books') renderBooks();
  else if (r.name === 'book') renderBookReader(r.arg);
  else if (r.name === 'entry') renderEntry(r.arg);
  else if (r.name === 'vocab') renderVocab(r.arg);
  else if (r.name === 'review') renderReview();
  else if (r.name === 'history') renderHistory();
  else renderDesk();

  renderGrammarTray();
}

// ---------- Views: Desk ----------
function renderDesk() {
  curText = null; curBook = null;
  setBar('Desk', 'Device-only · Claude Preview', `<button type="button" class="btn primary sm" data-act="go-scan">${ICON.camera}<span class="lbl">Scan Page</span></button>`);
  const due = db.cards.filter(isDue).length;
  const recent = [...db.texts].sort((a, b) => (b.opened || b.created) - (a.opened || a.created));
  const last = recent[0];
  const keyOk = hasApiKey();
  const preset = MODEL_PRESETS[getAiPrefs().preset] || MODEL_PRESETS.haiku_fast;

  view.innerHTML = `<div class="wrap">
    <div class="desk-hero">
      <h2>Qamus <span class="ar" lang="ar">قاموس</span></h2>
      <button type="button" class="big-search" data-act="palette">
        ${ICON.search}
        <span class="ph-long">Look up any Arabic word, root (ك ت ب), or English…</span>
        <span class="ph-short">Look up Arabic, root, or English…</span>
        <kbd>⌘K</kbd>
      </button>
    </div>

    ${!keyOk ? `<div class="note-bar" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span><strong>Claude AI ready:</strong> Paste your Anthropic API key (stored only on this device) for 3s page OCR &amp; classical Arabic grammar.</span>
      <button type="button" class="btn sm primary" data-act="open-settings">Set API Key</button>
    </div>` : ''}

    <div class="tiles">
      <button type="button" class="tile accent" data-go="#/scan">
        <div class="num" style="display:flex;align-items:center;gap:8px">${ICON.camera}<span>Scan</span></div>
        <div class="lbl">Camera, photo, or screenshot → clickable Arabic (Haiku 5.5 · ~3s)</div>
      </button>
      <button type="button" class="tile" data-go="#/books">
        <div class="num">${pdfBooks.length}</div>
        <div class="lbl">PDF Books · read &amp; scan on this device</div>
      </button>
      <button type="button" class="tile" data-go="#/review">
        <div class="num">${due}</div>
        <div class="lbl">${due ? 'Cards due for review' : 'Vocabulary flashcards'}</div>
      </button>
      ${last ? `<button type="button" class="tile" data-go="#/text/${encodeURIComponent(last.id)}">
        <div class="lbl">Continue reading</div>
        <div class="t-ar" lang="ar">${esc(last.title)}</div>
      </button>` : ''}
    </div>

    <div class="desk-texts">
      <div class="side-label" style="padding-left:0;margin-bottom:6px"><span>Recent texts</span><a href="#/new" style="font-size:12px;text-transform:none">+ Paste text</a></div>
      <div class="tx-list">${recent.slice(0, 5).map(t => `<a class="dt-row" href="#/text/${encodeURIComponent(t.id)}">
        <span class="dt-title"${isAr(t.title) ? ' lang="ar"' : ''}>${esc(t.title)}</span>
        <span class="dt-meta">${esc(t.note || ago(t.opened || t.created))}</span>
      </a>`).join('')}</div>
    </div>

    ${db.history.length ? `<p class="kicker">Recent lookups</p>
      <div class="chips">${db.history.slice(0, 12).map(h => `<button type="button" class="chip" data-q="${esc(h.q)}"><span class="ar" lang="ar">${esc(h.q)}</span></button>`).join('')}</div>` : ''}

    <p class="muted" style="font-size:12px;margin-top:26px">
      Active grammar model: <strong>${esc(preset.label)}</strong> · All vocabulary, texts, PDFs, and your API key stay strictly on this device.
    </p>
  </div>`;
}

// ---------- Views: Scan Page (Camera / Photo / PDF / Paste) ----------
let scanBusy = false;
let scanPreviewUrl = '';
let scanStatusMsg = '';

function renderScanView() {
  curText = null; curBook = null;
  setBar('Scan Page', 'Haiku 5.5 Direct Vision (~3s)');
  const keyOk = hasApiKey();

  view.innerHTML = `<div class="wrap">
    ${!keyOk ? `<div class="note-bar" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span>Add your device-only Anthropic API key to scan Arabic pages with Haiku 5.5 Vision (~0.08¢/page).</span>
      <button type="button" class="btn sm primary" data-act="open-settings">Set API Key</button>
    </div>` : ''}

    ${scanBusy ? `<div class="scan-progress">
      ${scanPreviewUrl ? `<img src="${esc(scanPreviewUrl)}" alt="Scanning page">` : ''}
      <strong>${esc(scanStatusMsg || 'Transcribing with Claude Haiku 5.5…')}</strong>
      <span class="muted" style="font-size:12.5px">Preserving Qur’anic script, printed harakat, poetry columns, and footnotes…</span>
    </div>` : `<div class="scan-grid">
      <button type="button" class="scan-card-btn primary-card" data-act="pick-camera">
        ${ICON.camera}
        <strong>Take Photo</strong>
        <span>Snap a page from a physical Arabic book with your phone camera</span>
      </button>
      <button type="button" class="scan-card-btn" data-act="pick-photo">
        ${ICON.image}
        <strong>Choose Photo / Screenshot</strong>
        <span>Pick any screenshot or saved book scan from your Photo Library</span>
      </button>
      <button type="button" class="scan-card-btn" data-act="pick-pdf">
        ${ICON.book}
        <strong>Import PDF Book</strong>
        <span>Load a full Arabic PDF locally and scan any page on demand</span>
      </button>
      <button type="button" class="scan-card-btn" data-go="#/new">
        ${ICON.text}
        <strong>Paste Arabic Text</strong>
        <span>Open any copied passage or article directly in the tap-to-lookup reader</span>
      </button>
    </div>
    <p class="muted" style="font-size:12.5px;text-align:center">
      Tip: Photos are resized cleanly on-device before sending straight to Anthropic (~3s, 0.20% CER, ~1,300 pages per $1).
    </p>`}
  </div>`;
}

async function handleImageFileScan(file) {
  if (!file) return;
  if (!hasApiKey()) {
    openSettingsModal();
    toast('Set your Anthropic API key first');
    return;
  }
  scanBusy = true;
  scanStatusMsg = 'Preparing image on-device…';
  scanPreviewUrl = '';
  go('#/scan');
  try {
    const img = await compressImageToJpeg(file, 1650, 0.86);
    scanPreviewUrl = img.dataUrl;
    scanStatusMsg = 'Transcribing with Claude Haiku 5.5 Vision…';
    renderScanView();
    const res = await scanImageWithClaude({ base64: img.base64, mediaType: img.mediaType });
    const firstLine = res.text.split(/\n/).find(l => l.trim().length > 2) || 'Scanned page';
    const title = firstLine.replace(/^#+\s*/, '').trim().slice(0, 46);
    // Keep a compact thumbnail for "Original" toggle so localStorage stays lean
    const thumb = await compressImageToJpeg(file, 900, 0.72);
    const tx = addText(res.text, {
      title,
      note: `Scan · Haiku 5.5 (${res.wallSec.toFixed(1)}s)`,
      source: 'scan',
      imageUrl: thumb.dataUrl,
    });
    scanBusy = false;
    scanPreviewUrl = '';
    toast(`Scanned in ${res.wallSec.toFixed(1)}s`);
    if (tx) go('#/text/' + encodeURIComponent(tx.id));
  } catch (err) {
    scanBusy = false;
    scanPreviewUrl = '';
    renderScanView();
    toast('Scan failed: ' + (err?.message || err));
  }
}

// ---------- Views: Texts & Composer & Reader ----------
function addText(body, meta = {}) {
  body = String(body || '').trim();
  if (!body) return null;
  const firstLine = body.split(/\n/).find(l => l.trim()) || 'Untitled';
  const tx = {
    id: uid('tx'),
    title: clip(meta.title || firstLine.slice(0, 48), 90),
    note: clip(meta.note || '', 120),
    body,
    source: meta.source || 'paste',
    imageUrl: meta.imageUrl || '',
    created: Date.now(),
    opened: Date.now(),
    looked: [],
  };
  db.texts.unshift(tx);
  persist(); refreshKnown(); renderTextList();
  return tx;
}

function renderComposer(editTx = null) {
  curText = null; curBook = null;
  setBar(editTx ? 'Edit text' : 'New text');
  view.innerHTML = `<div class="wrap">
    <div class="compose">
      <input id="c-title" class="field" placeholder="Title (optional)" dir="auto" value="${esc(editTx?.title || '')}">
      <textarea id="c-body" class="field" rows="12" dir="rtl" lang="ar" placeholder="الصق نصًا عربيًا هنا…" style="height:auto;padding:14px;font-family:var(--ar);font-size:22px;line-height:1.9">${esc(editTx?.body || '')}</textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button type="button" class="btn ghost" data-act="cancel-compose">Cancel</button>
        <button type="button" class="btn primary" data-act="${editTx ? 'save-edit' : 'create-text'}"${editTx ? ` data-id="${esc(editTx.id)}"` : ''}>${editTx ? 'Save changes' : 'Open in reader'}</button>
      </div>
    </div>
  </div>`;
  $('#c-body')?.focus();
}

function renderTexts() {
  curText = null; curBook = null;
  setBar('Texts', plural(db.texts.length, 'text'),
    `<button type="button" class="btn sm" data-go="#/scan">${ICON.camera}<span class="lbl">Scan</span></button>
     <button type="button" class="btn sm primary" data-go="#/new">${ICON.plus}<span class="lbl">New</span></button>`);
  const list = [...db.texts].sort((a, b) => (b.opened || b.created) - (a.opened || a.created));
  view.innerHTML = `<div class="wrap">
    ${list.length ? `<div class="tx-list">${list.map(t => `<div class="tx-row" data-go="#/text/${encodeURIComponent(t.id)}" tabindex="0">
      <div class="tx-head">
        <span class="tx-title"${isAr(t.title) ? ' lang="ar"' : ''}>${esc(t.title)}</span>
        <span class="tx-kind ${t.source === 'scan' ? 'k-scan' : ''}">${esc(t.source === 'scan' ? 'Scan' : t.source === 'sample' ? 'Sample' : 'Text')}</span>
        <div class="tx-actions"><button type="button" class="icon-btn" data-act="del-text" data-id="${esc(t.id)}" title="Delete">${ICON.trash}</button></div>
      </div>
      <div class="tx-snippet" lang="ar">${esc(t.body.slice(0, 180))}</div>
      <div class="tx-meta">${esc(t.note || ago(t.opened || t.created))}</div>
    </div>`).join('')}</div>` : `<div class="empty">No texts yet. Tap Scan or New to add a passage.</div>`}
  </div>`;
}

function renderReader(id) {
  const t = db.texts.find(x => x.id === id);
  if (!t) return go('#/desk');
  curText = t; curBook = null;
  t.opened = Date.now();
  t.looked ||= [];
  persist();
  const { html, toks } = tokenize(t.body);
  tokens = toks;
  selIndex = -1;
  const uniq = new Set(toks.map(x => norm(x.w)));
  const known = [...uniq].filter(n => isKnown(n)).length;
  const hasImg = !!t.imageUrl;
  const showImg = hasImg && db.settings.showScanImage !== false;

  setBar(esc(t.title), esc(t.note || ago(t.created)),
    `${hasImg ? `<button type="button" class="btn sm ghost${showImg ? ' on' : ''}" data-act="toggle-scan-img"><span class="lbl">${showImg ? 'Hide Scan' : 'Scan'}</span></button>` : ''}
     <button type="button" class="btn sm ghost" data-act="edit-text" title="Edit">${ICON.edit}<span class="lbl">Edit</span></button>
     <button type="button" class="btn sm ghost" data-act="delete-text" title="Delete">${ICON.trash}</button>`, isAr(t.title));

  const scanFigure = showImg
    ? `<figure class="source-scan"><img src="${esc(t.imageUrl)}" alt="Original scanned page" data-act="zoom-scan-img"><figcaption>Original scan · tap to enlarge</figcaption></figure>` : '';

  view.innerHTML = `<div class="reader-wrap">
    <article class="page">
      <div class="page-meta"><span class="stats"><span>${plural(toks.length, 'word')}</span><span id="looked-stat">${t.looked.length} looked up</span><span>${known} saved</span></span><span>${ago(t.created)}</span></div>
      ${scanFigure}
      <div class="passage" lang="ar" dir="rtl">${html}</div>
    </article>
    <div class="reader-legend">
      <span><span class="sw on"></span>selected</span>
      <span><span class="sw known"></span>saved</span>
      <span>Tap any word for instant dictionary + Claude grammar</span>
    </div>
  </div>`;

  const looked = new Set(t.looked);
  $$('.passage .w', view).forEach(el => {
    const tk = tokens[+el.dataset.i];
    tk.el = el;
    if (isKnown(tk.w)) el.classList.add('known');
    if (looked.has(norm(tk.w))) el.classList.add('seen');
  });
}

// ---------- Views: Client-Side PDF Bookshelf & Interactive Reader ----------
let pdfBooks = [];
let bookRenderToken = 0;

async function refreshBooks() {
  try { pdfBooks = await listBooks(); } catch { pdfBooks = []; }
  const bc = $('#books-count');
  if (bc) { bc.hidden = !pdfBooks.length; bc.textContent = pdfBooks.length; }
  return pdfBooks;
}

const PDF_FILTERS = [{ id: 'original', label: 'Original' }, { id: 'sepia', label: 'Sepia' }, { id: 'night', label: 'Night' }];
const currentPdfFilter = () => PDF_FILTERS.some(x => x.id === db.settings.pdfFilter) ? db.settings.pdfFilter : 'original';

async function renderBooks() {
  curText = null; curBook = null;
  setBar('Books (PDF)', '', `<button type="button" class="btn sm primary" data-act="pick-pdf">${ICON.plus}<span class="lbl">Import PDF</span></button>`);
  await refreshBooks();
  if (route().name !== 'books') return;
  setBar('Books (PDF)', pdfBooks.length ? plural(pdfBooks.length, 'book') : '', `<button type="button" class="btn sm primary" data-act="pick-pdf">${ICON.plus}<span class="lbl">Import PDF</span></button>`);

  if (!pdfBooks.length) {
    view.innerHTML = `<div class="wrap"><div class="books-empty">
      <div class="big-ar" lang="ar">كتاب</div>
      <h2>Mobile Arabic PDF Bookshelf</h2>
      <p class="muted">Import any scanned or digital Arabic PDF onto this device. Read pages with Sepia/Night mode, and tap <strong>Scan Page</strong> anytime to transcribe a page with Haiku 5.5 Vision (~3s, cached permanently on this device).</p>
      <div style="margin-top:16px"><button type="button" class="btn primary" data-act="pick-pdf">${ICON.plus}<span>Import PDF Book…</span></button></div>
    </div></div>`;
    return;
  }

  view.innerHTML = `<div class="wrap"><div class="book-grid">${pdfBooks.map(b => {
    const pct = Math.max(1, Math.min(100, Math.round(((b.lastPage || 1) / Math.max(1, b.pageCount)) * 100)));
    const vCount = (b.verifiedPages || []).length;
    return `<article class="book-card" data-go="#/book/${encodeURIComponent(b.id)}/${b.lastPage || 1}" tabindex="0">
      <div class="book-cover">${b.coverDataUrl ? `<img src="${esc(b.coverDataUrl)}" alt="" loading="lazy">` : `<span class="ar" lang="ar">ق</span>`}</div>
      <div class="book-info">
        <h3 class="book-title"${isAr(b.title) ? ' lang="ar"' : ''}>${esc(b.title)}</h3>
        <div class="book-meta">Page ${b.lastPage || 1} of ${b.pageCount}${vCount ? ` · ${vCount} scanned` : ''}</div>
        <div class="book-prog"><i style="width:${pct}%"></i></div>
        <div class="book-foot">
          <span class="muted">${ago(b.lastOpenedAt || b.addedAt)}</span>
          <button type="button" class="icon-btn sm danger" data-act="delete-book" data-id="${esc(b.id)}" title="Remove book">${ICON.trash}</button>
        </div>
      </div>
    </article>`;
  }).join('')}</div></div>`;
}

async function renderBookReader(arg) {
  const myTok = ++bookRenderToken;
  curText = null;
  const parts = String(arg || '').split('/');
  const bookId = parts[0];
  let reqPage = parseInt(parts[1] || '0', 10);

  if (!pdfBooks.length) await refreshBooks();
  const book = pdfBooks.find(b => b.id === bookId);
  if (!book) return go('#/books');
  reqPage = Math.max(1, Math.min(book.pageCount, reqPage || book.lastPage || 1));

  const prevSame = curBook && curBook.book.id === book.id;
  const cached = await getCachedPageText(book.id, reqPage).catch(() => null);
  if (myTok !== bookRenderToken) return;

  const pageText = cached?.text || '';
  const showMode = pageText ? 'text' : 'pdf';
  curBook = {
    book, page: reqPage, pageText, showMode,
    outline: prevSame ? curBook.outline : null,
    tocOpen: prevSame ? curBook.tocOpen : false,
    scanning: false,
  };
  book.lastPage = reqPage;
  book.lastOpenedAt = Date.now();
  updateBookProgress(book.id, reqPage).catch(() => {});

  setBar(
    esc(book.title),
    `Page ${reqPage} of ${book.pageCount}`,
    `<button type="button" class="btn ghost sm" data-go="#/books" title="Back to Books">${ICON.back}<span class="lbl">Books</span></button>`,
    isAr(book.title)
  );

  renderCurrentBookStage(myTok);

  if (!curBook.outline) {
    getBookOutline(book.id).then(list => {
      if (myTok !== bookRenderToken || !curBook) return;
      curBook.outline = list;
      const tocBtn = $('#book-toc-btn');
      if (tocBtn) tocBtn.hidden = !list.length;
    }).catch(() => {});
  }
}

function bookToolbarHtml() {
  if (!curBook) return '';
  const { book, page, pageText, outline, tocOpen } = curBook;
  const filterLabel = PDF_FILTERS.find(x => x.id === currentPdfFilter())?.label || 'Original';
  return `<div class="book-nav-bar">
    <div class="book-pager-grp">
      <button type="button" class="btn sm book-nav-btn" data-act="pdf-prev" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹ Prev</button>
      <label class="book-page-jump">
        <input type="number" inputmode="numeric" id="pdf-page-input" class="pdf-page-inp" min="1" max="${book.pageCount}" value="${page}" aria-label="Page number">
        <span class="muted">/ ${book.pageCount}</span>
      </label>
      <button type="button" class="btn sm book-nav-btn" data-act="pdf-next" ${page >= book.pageCount ? 'disabled' : ''} aria-label="Next page">Next ›</button>
    </div>
    <div class="book-tools-grp">
      <button type="button" class="btn sm ghost" id="book-toc-btn" data-act="toggle-book-toc" ${outline && outline.length ? '' : 'hidden'}>${tocOpen ? '✕ TOC' : 'Contents'}</button>
      <button type="button" class="btn sm" data-act="cycle-pdf-filter" title="Page color filter">${filterLabel}</button>
      <button type="button" class="btn sm ${pageText ? 'verified-pill' : 'primary'}" id="pdf-scan-btn" data-act="scan-book-page">
        ${ICON.spark}<span class="lbl">${pageText ? '✓ Scanned' : 'Scan'}</span>
      </button>
    </div>
  </div>
  ${tocOpen && outline?.length ? `<div class="book-toc-panel">
    <ul class="pdf-toc-list">${outline.map(it => `<li style="--d:${Math.min(3, it.depth || 0)}"><a href="#/book/${encodeURIComponent(book.id)}/${it.page}"${it.page === page ? ' aria-current="page"' : ''}${isAr(it.title) ? ' lang="ar" dir="rtl"' : ''}><span class="toc-t">${esc(it.title)}</span><span class="toc-p">${it.page}</span></a></li>`).join('')}</ul>
  </div>` : ''}`;
}

function bookFooterPagerHtml() {
  if (!curBook) return '';
  const { book, page } = curBook;
  return `<div class="book-foot-pager">
    <button type="button" class="btn" data-act="pdf-prev" ${page <= 1 ? 'disabled' : ''}>‹ Previous Page</button>
    <span class="muted" style="font-size:12.5px">${page} / ${book.pageCount}</span>
    <button type="button" class="btn primary" data-act="pdf-next" ${page >= book.pageCount ? 'disabled' : ''}>Next Page ›</button>
  </div>`;
}

function wireBookPageInput() {
  if (!curBook) return;
  const { book, page } = curBook;
  const pageInp = $('#pdf-page-input');
  if (pageInp) {
    pageInp.onchange = () => {
      const target = Math.max(1, Math.min(book.pageCount, parseInt(pageInp.value || '1', 10) || 1));
      if (target !== page) go(`#/book/${encodeURIComponent(book.id)}/${target}`);
    };
    pageInp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); pageInp.blur(); pageInp.onchange(); }
    };
  }
}

async function renderCurrentBookStage(myTok) {
  if (!curBook) return;
  const { book, page, pageText, showMode } = curBook;
  tokens = [];
  selIndex = -1;
  view.scrollTop = 0;

  const topNav = bookToolbarHtml();
  const footNav = bookFooterPagerHtml();

  const modeBar = pageText
    ? `<div class="pdf-mode-bar">
        <div class="segmented">
          <button type="button" data-act="book-mode" data-mode="text" aria-pressed="${showMode === 'text'}">Clickable Text</button>
          <button type="button" data-act="book-mode" data-mode="pdf" aria-pressed="${showMode === 'pdf'}">Original PDF Page</button>
        </div>
        <button type="button" class="btn sm ghost" data-act="scan-book-page" title="Re-scan this page">Re-scan</button>
      </div>`
    : `<div class="pdf-mode-bar">
        <button type="button" class="btn primary" data-act="scan-book-page">${ICON.spark}<span>Scan this page with Haiku 5.5 (~3s) to tap words</span></button>
      </div>`;

  if (showMode === 'text' && pageText) {
    const { html, toks } = tokenize(pageText);
    tokens = toks;
    view.innerHTML = `${topNav}<div class="reader-wrap book-reader-wrap">
      ${modeBar}
      <article class="page">
        <div class="page-meta"><span>Page ${page} of ${book.pageCount} · Haiku 5.5 OCR (cached)</span><span>${plural(toks.length, 'word')}</span></div>
        <div class="passage" lang="ar" dir="rtl">${html}</div>
      </article>
      ${footNav}
    </div>`;
    wireBookPageInput();
    $$('.passage .w', view).forEach(el => {
      const tk = tokens[+el.dataset.i];
      tk.el = el;
      if (isKnown(tk.w)) el.classList.add('known');
    });
    return;
  }

  const f = currentPdfFilter();
  const fCls = f === 'sepia' ? ' pdf-filter-sepia' : f === 'night' ? ' pdf-filter-night' : '';
  view.innerHTML = `${topNav}<div class="reader-wrap book-reader-wrap">
    ${modeBar}
    <div class="pdf-sheet${fCls}" style="max-width:780px;margin:0 auto">
      <div class="pdf-canvas-wrap"><canvas class="pdf-canvas" id="pdf-canvas"></canvas></div>
    </div>
    ${footNav}
  </div>`;
  wireBookPageInput();

  const canvas = $('#pdf-canvas');
  if (canvas) {
    try {
      await renderPdfPageToCanvas(book.id, page, canvas, Math.min(900, window.innerWidth - 32));
    } catch (err) {
      if (myTok === bookRenderToken) toast('Could not render PDF page: ' + (err?.message || err));
    }
  }
}

async function scanCurrentBookPage() {
  if (!curBook || curBook.scanning) return;
  if (!hasApiKey()) {
    openSettingsModal();
    toast('Set your Anthropic API key to scan PDF pages');
    return;
  }
  const { book, page } = curBook;
  curBook.scanning = true;
  const btn = $('#pdf-scan-btn');
  if (btn) { btn.disabled = true; const l = btn.querySelector('.lbl'); if (l) l.textContent = 'Scanning…'; }
  try {
    const jpeg = await renderPdfPageToJpeg(book.id, page, 1650);
    const res = await scanImageWithClaude({ base64: jpeg.base64, mediaType: jpeg.mediaType });
    await saveCachedPageText(book.id, page, res.text, { wallSec: res.wallSec, modelId: res.modelId });
    await refreshBooks();
    if (curBook && curBook.book.id === book.id && curBook.page === page) {
      curBook.pageText = res.text;
      curBook.showMode = 'text';
      curBook.scanning = false;
      if (btn) { btn.disabled = false; btn.classList.remove('primary'); btn.classList.add('verified-pill'); const l = btn.querySelector('.lbl'); if (l) l.textContent = '✓ Scanned'; }
      renderCurrentBookStage(bookRenderToken);
      toast(`Page ${page} scanned in ${res.wallSec.toFixed(1)}s (cached)`);
    }
  } catch (err) {
    if (curBook) curBook.scanning = false;
    if (btn) { btn.disabled = false; const l = btn.querySelector('.lbl'); if (l) l.textContent = 'Scan Page'; }
    toast('Page scan failed: ' + (err?.message || err));
  }
}

// ---------- Views: Entry, Vocabulary, Review (SM-2), History ----------
async function renderEntry(q) {
  curText = null; curBook = null;
  setBar(esc(q), 'Dictionary entry', `<button type="button" class="btn sm ghost" data-act="back">${ICON.back}<span>Back</span></button>`, isAr(q));
  await ready('morph');
  const res = resolveWithHamzaFallback(q);
  if (res.kind === 'roots' && res.roots?.length) await loadHw(res.roots).catch(() => {});
  const model = buildModel(res.q || q, res);
  view.innerHTML = `<div class="wrap entry-view">${entryHtml(model, { full: true })}</div>`;
  openDefaultSources(view);
}

const vocabUi = { at: INBOX, filter: '' };
function renderVocab(folderArg) {
  curText = null; curBook = null;
  if (folderArg) vocabUi.at = folderArg;
  const due = db.cards.filter(isDue).length;
  setBar('Vocabulary', `${db.cards.length} saved`,
    `${due ? `<button type="button" class="btn sm primary" data-go="#/review">${ICON.review}<span>Review (${due})</span></button>` : ''}
     <button type="button" class="btn sm ghost" data-act="export">CSV</button>`);
  const q = vocabUi.filter.trim().toLowerCase();
  const list = db.cards.filter(c => !q || norm(c.w).includes(norm(q)) || norm(c.head).includes(norm(q)) || (c.gloss || '').toLowerCase().includes(q));
  view.innerHTML = `<div class="wrap">
    <div class="toolbar">
      <input id="v-filter" class="field grow" type="search" placeholder="Filter saved words…" value="${esc(vocabUi.filter)}">
    </div>
    ${list.length ? `<div class="vocab-list">${list.map(c => `<div class="v-row">
      <div class="v-word" lang="ar" data-q="${esc(c.head || c.w)}">${esc(c.head || c.w)}</div>
      <div class="v-main">
        <div class="v-gloss">${esc(c.gloss || '—')}</div>
        ${c.ctx ? `<div class="v-ctx" lang="ar">${esc(c.ctx)}</div>` : ''}
      </div>
      <div class="v-side">
        <span class="st ${isDue(c) ? 'st-due' : 'st-later'}">${esc(dueLabel(c))}</span>
        <button type="button" class="icon-btn sm" data-act="del-card" data-id="${esc(c.id)}" title="Delete">${ICON.trash}</button>
      </div>
    </div>`).join('')}</div>` : `<div class="empty">No saved words on this device yet. Tap any word while reading and press <strong>Save</strong>.</div>`}
  </div>`;
  const vf = $('#v-filter');
  if (vf) vf.oninput = e => { vocabUi.filter = e.target.value; renderVocab(); };
}

let session = null;
function renderReview() {
  curText = null; curBook = null;
  setBar('Review', 'Spaced repetition');
  if (!session || session.done) {
    const queue = db.cards.filter(isDue);
    if (!queue.length) {
      view.innerHTML = `<div class="review"><div class="done-card"><div class="num">✓</div><h3>All caught up</h3><p class="muted">No cards due right now. Save words while reading to build your review deck.</p><div class="done-actions" style="margin-top:16px"><a class="btn primary" href="#/desk">Back to Desk</a></div></div></div>`;
      return;
    }
    session = { queue, idx: 0, flipped: false, done: false };
  }
  const c = session.queue[session.idx];
  const pct = Math.round((session.idx / session.queue.length) * 100);
  view.innerHTML = `<div class="review">
    <div class="progress"><i style="width:${pct}%"></i></div>
    <div class="card" data-act="flip">
      <div class="c-word" lang="ar">${esc(c.head || c.w)}</div>
      ${c.ctx ? `<div class="c-ctx" lang="ar">${esc(c.ctx)}</div>` : ''}
      ${session.flipped ? `<div class="c-back"><div class="c-gloss">${esc(c.gloss || '—')}</div>${c.root ? `<div class="c-root">Root: <span class="ar" lang="ar">${esc(c.root)}</span></div>` : ''}</div>` : `<div class="c-hint">Tap card to reveal meaning</div>`}
    </div>
    ${session.flipped ? `<div class="grades">
      <button type="button" class="btn grade again" data-grade="1">Again<small>10m</small></button>
      <button type="button" class="btn grade" data-grade="2">Hard<small>1d</small></button>
      <button type="button" class="btn grade good" data-grade="3">Good<small>${Math.max(1, Math.round((c.ivl || 1) * (c.ease || 2.5)))}d</small></button>
      <button type="button" class="btn grade" data-grade="4">Easy<small>${Math.max(4, Math.round((c.ivl || 1) * (c.ease || 2.5) * 1.3))}d</small></button>
    </div>` : ''}
  </div>`;
}

function gradeCard(q) {
  if (!session || session.done) return;
  const c = session.queue[session.idx];
  const real = db.cards.find(x => x.id === c.id);
  if (real) {
    real.last = Date.now();
    if (q === 1) { real.reps = 0; real.ivl = 0; real.lapses = (real.lapses || 0) + 1; real.due = Date.now() + 600000; }
    else {
      real.reps = (real.reps || 0) + 1;
      const mult = q === 2 ? 1.2 : q === 4 ? (real.ease || 2.5) * 1.3 : (real.ease || 2.5);
      real.ivl = real.reps === 1 ? (q === 4 ? 4 : 1) : Math.max(1, Math.round((real.ivl || 1) * mult));
      real.ease = Math.max(1.3, (real.ease || 2.5) + (q === 4 ? 0.15 : q === 2 ? -0.15 : 0));
      real.due = Date.now() + real.ivl * DAY;
    }
    persist(); refreshKnown();
  }
  session.idx += 1;
  session.flipped = false;
  if (session.idx >= session.queue.length) { session.done = true; toast('Review session complete'); }
  renderReview();
}

function renderHistory() {
  curText = null; curBook = null;
  setBar('History', plural(db.history.length, 'lookup'),
    db.history.length ? `<button type="button" class="btn sm ghost" data-act="clear-history">Clear</button>` : '');
  view.innerHTML = `<div class="wrap">
    ${db.history.length ? `<ul class="h-list">${db.history.map(h => `<li data-q="${esc(h.q)}"><span class="ar" lang="ar">${esc(h.q)}</span><span class="g"></span><span class="t">${ago(h.t)}</span></li>`).join('')}</ul>` : `<div class="empty">No lookups yet.</div>`}
  </div>`;
}

// ---------- Command Palette ----------
let palItems = [], palSel = 0;
function openPalette() {
  $('#palette').hidden = false;
  const inp = $('#palette-q');
  inp.value = '';
  updatePalette();
  inp.focus();
}
function closePalette() { $('#palette').hidden = true; }
function updatePalette() {
  const q = ($('#palette-q').value || '').trim();
  palItems = [];
  if (!q) {
    palItems.push(
      { label: 'Scan a book page (Camera / Photo)', hint: 'Haiku 5.5 Vision', run: () => go('#/scan') },
      { label: 'Import Arabic PDF book', hint: 'Client-side reader', run: () => $('#pdf-input').click() },
      { label: 'Paste a new Arabic passage', hint: 'Reader', run: () => go('#/new') },
      { label: 'Claude AI & API Key Settings', hint: 'Device-only', run: () => openSettingsModal() },
    );
  } else {
    palItems.push({ ar: isAr(q) ? q : '', label: isAr(q) ? '' : `Look up “${q}”`, hint: 'Dictionary', run: () => { openInspector(); lookup(q); } });
    if (atLeast('morph')) {
      for (const s of suggestions(q).slice(0, 7)) {
        const w = typeof s === 'string' ? s : (s.ar || s.w || s[1] || '');
        if (w && norm(w) !== norm(q)) palItems.push({ ar: w, hint: typeof s === 'object' ? (s.g || '') : '', run: () => { openInspector(); lookup(w); } });
      }
    }
  }
  palSel = 0;
  $('#palette-list').innerHTML = palItems.map((it, i) => `<li data-pi="${i}" aria-selected="${i === 0}">
    ${it.ar ? `<span class="p-ar" lang="ar">${esc(it.ar)}</span>` : ''}
    <span class="p-main"><span class="p-g">${esc(it.label || it.hint)}</span></span>
    ${it.label && it.hint ? `<span class="p-k">${esc(it.hint)}</span>` : ''}
  </li>`).join('');
}
function runPal(i) {
  const it = palItems[i];
  closePalette();
  if (it) it.run();
}

// ---------- Inspector Sheet Open/Close ----------
const narrowInsp = () => matchMedia('(max-width: 1100px)').matches;
function openInspector() { if (narrowInsp()) { desk.classList.add('insp-open'); syncScrim(); } }
function closeInspector() { desk.classList.remove('insp-open'); syncScrim(); }
function syncScrim() { $('#scrim').hidden = !(desk.classList.contains('insp-open') || desk.classList.contains('side-open')); }

function exportCsv() {
  const q = s => `"${String(s || '').replace(/"/g, '""')}"`;
  const rows = [['word', 'headword', 'meaning', 'root', 'transliteration', 'sentence'], ...db.cards.map(c => [c.w, c.head, c.gloss, c.root, c.tr, c.ctx])];
  const blob = new Blob(['\uFEFF' + rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'qamus-mobile-vocabulary.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Global Event Wiring ----------
document.addEventListener('click', e => {
  const t = e.target;

  const w = t.closest('.passage .w');
  if (w) return selectToken(+w.dataset.i);

  const cl = t.closest('.answer.clamp .def');
  if (cl && !t.closest('[data-q]')) { cl.parentElement.classList.toggle('open'); return; }

  const sv = t.closest('[data-save]');
  if (sv) return saveAnswer(saveables.get(sv.dataset.save));

  const cp = t.closest('[data-copy]');
  if (cp) { navigator.clipboard?.writeText(cp.dataset.copy).then(() => toast('Copied')); return; }

  const pi = t.closest('#palette-list li[data-pi]');
  if (pi) return runPal(+pi.dataset.pi);
  if (t.id === 'palette') return closePalette();
  if (t.id === 'settings-modal') return closeSettingsModal();

  const pr = t.closest('#preset-list .preset-opt');
  if (pr) {
    saveAiPrefs({ preset: pr.dataset.preset });
    renderSettingsModal();
    renderAiStatusChrome();
    toast(`Switched to ${MODEL_PRESETS[pr.dataset.preset]?.label}`);
    return;
  }

  const km = t.closest('#key-mode-seg button');
  if (km) {
    setKeyStorageMode(km.dataset.mode);
    renderSettingsModal();
    toast(km.dataset.mode === 'session' ? 'Key will clear when this tab closes' : 'Key saved only on this device');
    return;
  }

  const gr = t.closest('[data-grade]');
  if (gr) return gradeCard(+gr.dataset.grade);

  const q = t.closest('[data-q]');
  if (q) {
    e.preventDefault();
    if (q.closest('#inspector')) { lookup(q.dataset.q, {}, { fromLink: true }); return; }
    if (q.closest('.entry-view')) { go('#/entry/' + encodeURIComponent(q.dataset.q)); return; }
    openInspector(); lookup(q.dataset.q); return;
  }

  const a = t.closest('[data-act]');
  const dg = !a && t.closest('[data-go]');
  if (dg && !t.closest('a, button, input, select, textarea')) { go(dg.dataset.go); return; }
  if (!a) return;

  const act = a.dataset.act;
  if (act === 'palette') openPalette();
  else if (act === 'open-settings') openSettingsModal();
  else if (act === 'go-scan') go('#/scan');
  else if (act === 'pick-camera') $('#camera-input').click();
  else if (act === 'pick-photo') $('#photo-input').click();
  else if (act === 'pick-pdf') $('#pdf-input').click();
  else if (act === 'cancel-compose') history.length > 1 ? history.back() : go('#/desk');
  else if (act === 'create-text') {
    const tx = addText($('#c-body').value, { title: $('#c-title').value });
    if (tx) go('#/text/' + encodeURIComponent(tx.id));
  } else if (act === 'save-edit') {
    const tx = db.texts.find(x => x.id === a.dataset.id);
    if (tx) { tx.body = $('#c-body').value.trim() || tx.body; tx.title = $('#c-title').value.trim() || tx.title; persist(); go('#/text/' + encodeURIComponent(tx.id)); }
  } else if (act === 'edit-text' && curText) renderComposer(curText);
  else if (act === 'delete-text' && curText) {
    db.texts = db.texts.filter(x => x.id !== curText.id);
    persist(); refreshKnown(); renderTextList(); go('#/texts'); toast('Text deleted');
  } else if (act === 'del-text') {
    db.texts = db.texts.filter(x => x.id !== a.dataset.id);
    persist(); refreshKnown(); renderTextList(); renderTexts(); toast('Text deleted');
  } else if (act === 'toggle-scan-img' && curText) {
    db.settings.showScanImage = db.settings.showScanImage === false;
    persist(); renderReader(curText.id);
  } else if (act === 'zoom-scan-img' && curText?.imageUrl) {
    $('#scan-lightbox')?.remove();
    const ov = document.createElement('div');
    ov.id = 'scan-lightbox'; ov.className = 'scan-lightbox'; ov.dataset.act = 'close-lightbox';
    ov.innerHTML = `<div class="scan-lightbox-inner" data-act="close-lightbox"><img src="${esc(curText.imageUrl)}" alt="Original scan"><span class="scan-lightbox-hint">Tap anywhere to close</span></div>`;
    document.body.appendChild(ov);
  } else if (act === 'close-lightbox') $('#scan-lightbox')?.remove();
  else if (act === 'delete-book') {
    if (confirm('Remove this PDF book from this device?')) {
      deleteBook(a.dataset.id).then(() => { refreshBooks().then(() => renderBooks()); toast('Book removed'); });
    }
  } else if (act === 'pdf-prev' && curBook && curBook.page > 1) {
    go(`#/book/${encodeURIComponent(curBook.book.id)}/${curBook.page - 1}`);
  } else if (act === 'pdf-next' && curBook && curBook.page < curBook.book.pageCount) {
    go(`#/book/${encodeURIComponent(curBook.book.id)}/${curBook.page + 1}`);
  } else if (act === 'cycle-pdf-filter') {
    const i = PDF_FILTERS.findIndex(x => x.id === currentPdfFilter());
    db.settings.pdfFilter = PDF_FILTERS[(i + 1) % PDF_FILTERS.length].id;
    persist(); renderBookReader(`${curBook.book.id}/${curBook.page}`);
  } else if (act === 'toggle-book-toc' && curBook) {
    curBook.tocOpen = !curBook.tocOpen;
    renderCurrentBookStage(bookRenderToken);
  } else if (act === 'book-mode' && curBook) {
    curBook.showMode = a.dataset.mode;
    renderCurrentBookStage(bookRenderToken);
  } else if (act === 'scan-book-page') {
    scanCurrentBookPage();
  } else if (act === 'save-primary') {
    const target = primarySaveTarget();
    if (target) saveAnswer(target);
  } else if (act === 'open-entry' && cur) {
    closeInspector(); go('#/entry/' + encodeURIComponent(cur.q));
  } else if (act === 'insp-back') {
    const p = inspStack.pop(); if (p) lookup(p.q, p.ctx, { keepStack: true });
  } else if (act === 'back') history.length > 1 ? history.back() : go('#/desk');
  else if (act === 'passage-to-text' && cur) { const tx = addText(cur.q); if (tx) go('#/text/' + encodeURIComponent(tx.id)); }
  else if (act === 'flip' && session) { session.flipped = !session.flipped; renderReview(); }
  else if (act === 'del-card') {
    db.cards = db.cards.filter(x => x.id !== a.dataset.id);
    persist(); refreshKnown(); renderVocab(); toast('Card removed');
  } else if (act === 'export') exportCsv();
  else if (act === 'clear-history') { db.history = []; persist(); renderHistory(); toast('History cleared'); }
  else if (act === 'toggle-tray') { trayCollapsed = !trayCollapsed; renderGrammarTray(); }
  else if (act === 'analyze') runClaudeAnalysis({ force: true });
  else if (act === 'analyze-sonnet') runClaudeAnalysis({ presetOverride: 'sonnet_deep', force: true });
});

// Controls & Settings Modal Wiring
$('#open-palette').onclick = () => openPalette();
$('#home-link').onclick = e => { e.preventDefault(); closePalette(); go('#/desk'); };
$('#new-text').onclick = () => go('#/new');
$('#toggle-side').onclick = () => { desk.classList.toggle('side-open'); syncScrim(); };
$('#scrim').onclick = () => { desk.classList.remove('side-open'); closeInspector(); };
$('#close-inspector-btn').onclick = () => closeInspector();
$('#open-settings').onclick = () => openSettingsModal();
$('#ai-status-side').onclick = () => openSettingsModal();
$('#ai-status-top').onclick = () => openSettingsModal();
$('#close-settings').onclick = () => closeSettingsModal();

$('#toggle-key-vis').onclick = () => {
  const inp = $('#claude-key-input');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('#toggle-key-vis').textContent = show ? 'Hide' : 'Show';
};
$('#save-key-btn').onclick = () => {
  const val = ($('#claude-key-input').value || '').trim();
  if (!val) { toast('Paste your sk-ant-… key first'); return; }
  setApiKey(val, getKeyStorageMode());
  renderSettingsModal();
  renderAiStatusChrome();
  renderInspector();
  renderGrammarTray();
  toast('API key saved on this device only');
};
$('#clear-key-btn').onclick = () => {
  clearApiKey();
  renderSettingsModal();
  renderAiStatusChrome();
  renderInspector();
  renderGrammarTray();
  toast('API key removed from this device');
};
$('#test-key-btn').onclick = async () => {
  const st = $('#key-test-status');
  const raw = ($('#claude-key-input').value || '').trim() || getApiKey();
  st.hidden = false;
  st.className = 'cfg-status';
  st.textContent = 'Testing connection directly to api.anthropic.com…';
  try {
    const info = await testApiKey(raw);
    if (raw && raw !== getApiKey()) setApiKey(raw, getKeyStorageMode());
    st.className = 'cfg-status ok';
    st.textContent = `Connected! Haiku 5.5 ${info.hasHaiku55 ? 'available' : 'checked'} · Sonnet set to ${info.latestSonnet}.`;
    renderSettingsModal();
    renderAiStatusChrome();
  } catch (err) {
    st.className = 'cfg-status err';
    st.textContent = `Connection failed: ${err?.message || err}`;
  }
};
$('#auto-analyze-toggle').onchange = e => {
  saveAiPrefs({ autoAnalyze: e.target.checked });
};
$('#clear-ai-cache-btn').onclick = () => {
  clearAnalysisCache();
  toast('Cleared cached grammar analyses');
};
$$('#settings-modal .seg[data-setting] button').forEach(b => {
  b.onclick = () => {
    db.settings[b.closest('.seg').dataset.setting] = b.dataset.v;
    applySettings(); persist();
  };
});

// File Inputs (Camera, Photo Library, PDF Book)
$('#camera-input').onchange = e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleImageFileScan(f); };
$('#photo-input').onchange = e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleImageFileScan(f); };
$('#pdf-input').onchange = async e => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  toast(`Importing ${f.name}…`);
  try {
    const meta = await importPdfFile(f);
    await refreshBooks();
    toast(`Imported “${meta.title}” (${meta.pageCount} pages)`);
    go(`#/book/${encodeURIComponent(meta.id)}/1`);
  } catch (err) {
    toast('PDF import failed: ' + (err?.message || err));
  }
};

$('#palette-q').addEventListener('input', updatePalette);
$('#palette-q').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); $$('#palette-list li').forEach((li, i) => li.setAttribute('aria-selected', i === palSel)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); $$('#palette-list li').forEach((li, i) => li.setAttribute('aria-selected', i === palSel)); }
  else if (e.key === 'Enter') { e.preventDefault(); runPal(palSel); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
});

document.addEventListener('keydown', e => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape') {
    if ($('#scan-lightbox')) { $('#scan-lightbox').remove(); return; }
    if (!$('#settings-modal').hidden) { closeSettingsModal(); return; }
    if (!$('#palette').hidden) { closePalette(); return; }
    if (desk.classList.contains('insp-open') || desk.classList.contains('side-open')) { desk.classList.remove('side-open'); closeInspector(); return; }
  }
  if (typing) return;
  const r = route().name;
  if ((r === 'text' || r === 'book') && tokens.length && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); selectToken(Math.min(tokens.length - 1, selIndex + 1), { scroll: true }); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); selectToken(Math.max(0, selIndex < 0 ? 0 : selIndex - 1), { scroll: true }); }
    else if (e.key.toLowerCase() === 's') { const tgt = primarySaveTarget(); if (tgt) { e.preventDefault(); saveAnswer(tgt); } }
  }
});

// Re-render layout smoothly if viewport crosses mobile/tablet threshold
window.addEventListener('resize', () => { renderInspector(); renderGrammarTray(); });

// ---------- Boot ----------
applySettings();
refreshKnown();
refreshBooks().then(() => { if (route().name === 'desk') renderDesk(); });
renderAiStatusChrome();
window.addEventListener('hashchange', render);
render();
renderInspector();
initEngine().catch(err => {
  console.error(err);
  const el = $('#engine-status');
  if (el) el.lastElementChild.textContent = 'Couldn’t load offline lexicons';
});
