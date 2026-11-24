import {
  state,
  DICTS,
  DICT_IDS,
  AR_DICTS,
  AR_IDS,
  VERB_PATTERNS,
  PARTICLES,
  DIAC,
  norm,
  isAr,
  esc,
  plain,
  hasTashkeel,
  hasExplicitHamza,
  initEngine,
  onEngineUpdate,
  hwHave,
  loadHw,
  loadAllHw,
  formIdx,
  stripHead,
  analyze,
  uniqParses,
  rootLabel,
  wRoots,
  laneKey,
  loadLaneEntries,
  arKeysFor,
  arShard,
  arHead,
  arEntry,
  resolveQuery,
  suggestions,
  glossFor,
  nearestMatches,
  searchEnglish,
  defHtml,
  arHtml,
  bwRoot,
  tokenIs,
  snippet,
  shortGloss,
} from './engine.js';
import { shouldTour, startTour, isTouring } from './tour.js';

// ---------- Storage & Sync Setup (reuses root ../merge.js & ../sync.js) ----------
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const Store = window.QamusStore;
const Sync = window.QamusSync;
const QM = window.QamusMerge;
const SYNC_URL = lsGet('qamus.syncUrl') ?? 'https://qamus-sync.subhansajid360.workers.dev';

const INBOX = 'f_inbox';
const CARD_SOURCES = ['hw', 'wikt', 'lane', 'lexicon', 'mufradat', 'mukhtar', 'custom'];
const TEXT_FIELDS = ['word', 'gloss', 'arGloss', 'root', 'translit', 'context', 'highlight', 'note'];
const CSV_FIELDS = ['word', 'gloss', 'arGloss', 'root', 'translit', 'context', 'note', 'tags'];
const MARK_GOT = 1;
const MARK_AGAIN = 2;
const AGAIN_MS = 10 * 60000;
const SIZE_MIN = 80, SIZE_MAX = 160, SIZE_STEP = 10;

const BOOKMARK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.3.3 0 0 1-.48.24L12 16l-6.02 4.44a.3.3 0 0 1-.48-.24V4a.5.5 0 0 1 .5-.5z"/></svg>';
const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const $ = s => document.querySelector(s);
const main = $('#main');
const qEl = $('#q');
const sugEl = $('#suggest');
const clearBtn = $('#clear');
const loadPill = $('#load-pill');
const railScroll = $('#rail-scroll');

// ---------- Theme & Typography Preferences ----------
const THEMES = ['paper', 'sepia', 'night'];
const THEME_LABELS = { paper: 'Paper', sepia: 'Sepia', night: 'Night' };
const AR_FONTS = [
  { id: 'amiri', name: 'Amiri', desc: 'Classical book Naskh', sample: 'الكِتَابُ وَالقَلَمُ' },
  { id: 'scheherazade', name: 'Scheherazade New', desc: 'Crisp scholarly marks', sample: 'الكِتَابُ وَالقَلَمُ' },
  { id: 'noto', name: 'Noto Naskh Arabic', desc: 'Clean modern reading', sample: 'الكِتَابُ وَالقَلَمُ' },
];

function getTheme() {
  const saved = lsGet('qamus.ui.theme');
  if (THEMES.includes(saved)) return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'paper';
}
function applyTheme(t) {
  const next = THEMES.includes(t) ? t : 'paper';
  document.documentElement.dataset.theme = next;
  lsSet('qamus.ui.theme', next);
  const lbl = $('#theme-label');
  if (lbl) lbl.textContent = THEME_LABELS[next];
}
function getArFont() {
  const f = lsGet('qamus.ui.arFont');
  return AR_FONTS.some(x => x.id === f) ? f : 'amiri';
}
function applyArFont(f) {
  const next = AR_FONTS.some(x => x.id === f) ? f : 'amiri';
  document.documentElement.dataset.arFont = next;
  lsSet('qamus.ui.arFont', next);
}

applyTheme(getTheme());
applyArFont(getArFont());

// ---------- App View State ----------
let curView = 'boot';
let activeSourceTab = 'all';
let lastSearchedRaw = '';
let resultSeq = 0;
let suggestItems = [];
let suggestIdx = -1;
let openSheetApi = null;
let toastTimer = 0;

// Vocab / Folder UI state
const vocabUi = {
  selectFolders: false,
  pickedFolders: new Set(),
  folderId: null,
  filter: '',
  selectCards: false,
  pickedCards: new Set(),
  confirmDelCards: false,
};

// Study state
let study = null;

// ---------- Helpers ----------
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const qAttr = q => (isAr(q) ? 'lang="ar"' : 'dir="auto"');
const cleanQ = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 200);
const clip = (s, n = 2048) => String(s ?? '').slice(0, n);
const cleanTags = t => [...new Set((Array.isArray(t) ? t : String(t ?? '').split(/[\s,;]+/))
  .map(x => String(x).trim().slice(0, 64)).filter(Boolean))].slice(0, 50);

function uid(prefix) {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return prefix + '_' + Date.now().toString(36) + [...a].map(b => (b % 36).toString(36)).join('');
}

function relTime(t) {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast('Clipboard unavailable');
  }
}

function toast(html, action) {
  document.getElementById('toast')?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.id = 'toast';
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${html}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) {
    el.querySelector('button').addEventListener('click', () => {
      clearTimeout(toastTimer);
      el.remove();
      action.run();
    });
  }
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 4800);
}

// ---------- Store Data Model (compatible with root QamusStore) ----------
const vdoc = () => Store.doc;
const liveFolders = () => vdoc().folders.filter(f => !f.deleted);
const liveCards = () => vdoc().cards.filter(c => !c.deleted);
const liveHistory = () => vdoc().history.filter(h => !h.deleted).sort((a, b) => b.t - a.t);
const historyPaused = () => !!vdoc().settings.pauseHistory;

const VIRTUAL_INBOX = { id: INBOX, name: 'Inbox', parent: null, virtual: true };
function folderById(id) {
  return vdoc().folders.find(f => f.id === id && !f.deleted) || (id === INBOX ? VIRTUAL_INBOX : null);
}
const parentOf = f => (f.parent && f.parent !== f.id && folderById(f.parent) ? f.parent : null);
const cardFolder = c => (folderById(c.folder) ? c.folder : INBOX);
const byFolderName = (a, b) => (a.id === INBOX ? -1 : b.id === INBOX ? 1 : a.name.localeCompare(b.name, ['ar', 'en']));

function allFolders() {
  const fs = liveFolders();
  if (!fs.some(f => f.id === INBOX) && liveCards().some(c => cardFolder(c) === INBOX)) fs.push(VIRTUAL_INBOX);
  return fs;
}
function childrenOf(id) { return allFolders().filter(f => parentOf(f) === (id || null)).sort(byFolderName); }
function tree() {
  const out = [], seen = new Set();
  const walk = (id, depth) => {
    for (const f of childrenOf(id)) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
function descendants(id) {
  const out = new Set(), stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const f of allFolders()) {
      if (parentOf(f) === cur && !out.has(f.id) && f.id !== id) { out.add(f.id); stack.push(f.id); }
    }
  }
  return out;
}
function folderPathList(id) {
  const out = [], seen = new Set();
  let f = folderById(id);
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    out.unshift(f);
    f = parentOf(f) ? folderById(f.parent) : null;
  }
  return out;
}
const folderPath = id => folderPathList(id).map(f => f.name).join(' / ');
const cardsIn = id => liveCards().filter(c => cardFolder(c) === id);
function cardsDeep(id) {
  const ids = new Set([id, ...descendants(id)]);
  return liveCards().filter(c => ids.has(cardFolder(c)));
}

const dayStart = (t, add = 0) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + add); return d.getTime(); };
const endOfDay = (t, add = 0) => dayStart(t, add + 1) - 1;

function isPaused(id) { return folderPathList(id).some(x => x.paused); }
const cardPaused = c => isPaused(cardFolder(c));

function cardStatus(card, now = Date.now()) {
  if (cardPaused(card)) return { k: 'paused', label: 'Paused' };
  const r = vdoc().reviews[card.id];
  if (!r || !r.last) return { k: 'new', label: 'New' };
  if (r.due <= endOfDay(now)) return { k: 'due', label: 'Due' };
  const d = Math.max(1, Math.round((dayStart(r.due) - dayStart(now)) / 86400000));
  return { k: 'later', label: `in ${d}d`, days: d };
}
const isDue = c => { const k = cardStatus(c).k; return k === 'new' || k === 'due'; };
const dueCount = cards => cards.filter(isDue).length;

function masteryStats(cards) {
  let mastered = 0, due = 0, fresh = 0;
  for (const c of cards) {
    const st = cardStatus(c);
    if (st.k === 'later') mastered++;
    else if (st.k === 'due') due++;
    else fresh++;
  }
  return { total: cards.length, mastered, due, fresh };
}

function savedIndex() {
  const m = new Map();
  for (const c of liveCards()) {
    if (!c.source || c.source === 'custom' || !c.ref) continue;
    const k = c.source + '|' + c.ref;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  }
  return m;
}
function savedWordKeys() {
  return new Set(liveCards().map(c => c.key).filter(Boolean));
}

function lastFolder() {
  const id = lsGet('qamus.lastFolder');
  return id && folderById(id) ? id : INBOX;
}

// Result & text size preferences stored in Store.doc.settings
const textSize = v => (Number.isFinite(v) ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(v / SIZE_STEP) * SIZE_STEP)) : 100);
function resultPrefs() {
  const st = vdoc().settings || {};
  const order = String(st.dictOrder || '').split(',').filter((id, i, a) => DICT_IDS.includes(id) && a.indexOf(id) === i);
  for (const id of DICT_IDS) if (!order.includes(id)) order.push(id);
  const off = new Set(String(st.dictOff || '').split(',').filter(id => DICT_IDS.includes(id)));
  return { order, off, parse: st.showParse !== false, size: { en: textSize(st.textEn), ar: textSize(st.textAr) } };
}
function applyTextSizes() {
  const { size } = resultPrefs();
  document.documentElement.style.setProperty('--t-en', size.en / 100);
  document.documentElement.style.setProperty('--t-ar', size.ar / 100);
}
function setResultPrefs({ order, off, parse, size }) {
  Store.mutate(d => {
    const next = { ...d.settings, updatedAt: Date.now() };
    if (order) next.dictOrder = order.join(',');
    if (off) next.dictOff = [...off].join(',');
    if (parse !== undefined) next.showParse = !!parse;
    if (size) { next.textEn = textSize(size.en); next.textAr = textSize(size.ar); }
    d.settings = next;
  });
}

// Mutations
function ensureInbox(d) {
  if (d.folders.some(f => f.id === INBOX && !f.deleted)) return;
  const now = Date.now();
  const rec = { id: INBOX, name: 'Inbox', parent: null, createdAt: now, updatedAt: now, deleted: false };
  const i = d.folders.findIndex(f => f.id === INBOX);
  if (i >= 0) d.folders[i] = rec;
  else d.folders.push(rec);
}
function newFolderRec(name, parent, now) {
  return { id: uid('f'), name: clip(name, 100).trim(), parent: parent || null, createdAt: now, updatedAt: now, deleted: false };
}
function cardRec(fields, folder, now) {
  const c = { id: uid('c'), folder };
  for (const k of TEXT_FIELDS) c[k] = clip(fields[k]).trim();
  c.key = clip(norm(c.word));
  c.source = CARD_SOURCES.includes(fields.source) ? fields.source : 'custom';
  c.ref = c.source === 'custom' ? '' : clip(fields.ref, 200);
  c.tags = cleanTags(fields.tags);
  c.createdAt = now;
  c.updatedAt = now;
  c.deleted = false;
  return c;
}
const tombstone = (c, now) => ({ id: c.id, folder: c.folder, word: '', updatedAt: now, deleted: true });

function addCard(fields, folder, newFolderName) {
  let id;
  Store.mutate(d => {
    const now = Date.now();
    ensureInbox(d);
    if (newFolderName) { const f = newFolderRec(newFolderName, null, now); d.folders.push(f); folder = f.id; }
    const c = cardRec(fields, folder || INBOX, now);
    d.cards.push(c);
    id = c.id;
  });
  lsSet('qamus.lastFolder', folder || INBOX);
  return id;
}
function updateCard(id, patch, newFolderName) {
  Store.mutate(d => {
    const now = Date.now();
    const c = d.cards.find(x => x.id === id && !x.deleted);
    if (!c) return;
    if (newFolderName) { const f = newFolderRec(newFolderName, null, now); d.folders.push(f); patch = { ...patch, folder: f.id }; }
    for (const k of TEXT_FIELDS) if (k in patch) c[k] = clip(patch[k]).trim();
    if ('tags' in patch) c.tags = cleanTags(patch.tags);
    if (patch.folder) { if (patch.folder === INBOX) ensureInbox(d); c.folder = patch.folder; }
    c.key = clip(norm(c.word));
    c.updatedAt = now;
  });
}
function deleteCards(ids) {
  const set = new Set(ids);
  Store.mutate(d => {
    const now = Date.now();
    d.cards = d.cards.map(c => (set.has(c.id) && !c.deleted ? tombstone(c, now) : c));
    for (const id of set) delete d.reviews[id];
  });
}
function moveCards(ids, folder) {
  const set = new Set(ids);
  Store.mutate(d => {
    const now = Date.now();
    if (folder === INBOX) ensureInbox(d);
    for (const c of d.cards) if (set.has(c.id) && !c.deleted) { c.folder = folder; c.updatedAt = now; }
  });
}
function createFolder(name, parent) {
  let id;
  Store.mutate(d => {
    const f = newFolderRec(name, parent, Date.now());
    if (parent === INBOX) ensureInbox(d);
    d.folders.push(f);
    id = f.id;
  });
  return id;
}
function renameFolder(id, name) {
  Store.mutate(d => {
    if (id === INBOX) ensureInbox(d);
    const f = d.folders.find(x => x.id === id && !x.deleted);
    if (f) { f.name = clip(name, 100).trim(); f.updatedAt = Date.now(); }
  });
}
function setFolderPaused(id, on) {
  Store.mutate(d => {
    if (id === INBOX) ensureInbox(d);
    const f = d.folders.find(x => x.id === id && !x.deleted);
    if (!f) return;
    if (on) f.paused = true; else delete f.paused;
    f.updatedAt = Date.now();
  });
}
function deleteFolder(id, mode) {
  if (id === INBOX) return;
  const ids = new Set([id, ...descendants(id)]);
  ids.delete(INBOX);
  Store.mutate(d => {
    const now = Date.now();
    if (mode === 'inbox') ensureInbox(d);
    d.folders = d.folders.map(f => (ids.has(f.id) && !f.deleted
      ? { id: f.id, name: '', parent: null, createdAt: f.createdAt || 0, updatedAt: now, deleted: true } : f));
    d.cards = d.cards.map(c => {
      if (c.deleted || !ids.has(c.folder)) return c;
      if (mode === 'inbox') return { ...c, folder: INBOX, updatedAt: now };
      delete d.reviews[c.id];
      return tombstone(c, now);
    });
  });
}

// History mutations
const maxT = (hist, q) => hist.reduce((m, h) => (h.q === q && h.t > m ? h.t : m), 0);
function recordSearch(raw) {
  const q = cleanQ(raw);
  if (!q || historyPaused() || isTouring()) return;   // the intro's sample search isn't yours
  if (liveHistory()[0]?.q === q) return;
  Store.mutate(d => {
    const t = Math.max(Date.now(), (d.settings.historyClearedAt || 0) + 1, maxT(d.history, q) + 1);
    d.history = [{ q, t }, ...d.history.filter(h => h.q !== q)];
    let live = 0;
    d.history = d.history.filter(h => h.deleted || ++live <= 500);
  }, { quiet: true });
}
function deleteSearch(q) {
  Store.mutate(d => {
    const t = Math.max(Date.now(), maxT(d.history, q) + 1);
    d.history = [...d.history.filter(h => h.q !== q), { q, t, deleted: true }];
  });
}
function clearHistory() {
  Store.mutate(d => {
    const now = Math.max(Date.now(), ...d.history.map(h => h.t + 1));
    d.history = [];
    d.settings = { ...d.settings, historyClearedAt: now, updatedAt: now };
  });
}

// ---------- SM-2 Scheduler ----------
function schedule(prev, grade, now = Date.now()) {
  const r = { due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, last: 0, ...(prev || {}) };
  const out = { ...r, last: now, updatedAt: now };
  const ease2 = x => Math.round(x * 100) / 100;
  if (grade === 0) {
    return { ...out, reps: 0, lapses: r.lapses + 1, ease: ease2(Math.max(1.3, r.ease - 0.2)), interval: 0, due: now + AGAIN_MS };
  }
  const raw = g => {
    if (r.reps === 0) return [1, 1, 4][g - 1];
    if (r.reps === 1) return [3, 6, 8][g - 1];
    return Math.round(Math.max(1, r.interval) * [1.2, r.ease, r.ease * 1.3][g - 1]);
  };
  const hard = Math.max(1, raw(1)), good = Math.max(hard, raw(2)), easy = Math.max(good + 1, raw(3));
  const interval = [hard, good, easy][grade - 1];
  const ease = grade === 1 ? Math.max(1.3, r.ease - 0.15) : grade === 3 ? r.ease + 0.15 : r.ease;
  return { ...out, reps: r.reps + 1, interval, ease: ease2(ease), due: dayStart(now, interval) };
}
function intervalLabel(prev, grade, now = Date.now()) {
  if (grade === 0) return '<10m';
  const d = schedule(prev, grade, now).interval;
  return d >= 365 ? `${Math.round(d / 36.5) / 10}y` : d >= 30 ? `${Math.round(d / 3) / 10}mo` : `${d}d`;
}

// ---------- Routing ----------
let lastHash = '', beforeSettings = null;   // the screen Settings was opened from: { hash, scroll }
function settingsBackLabel() {
  const p = new URLSearchParams(beforeSettings?.hash || '');
  const q = p.get('q');
  if (!beforeSettings) return 'Search';
  if (q) return isAr(q) ? `<span lang="ar">${esc(q)}</span>` : esc(q);
  if (p.has('vocab')) return 'Vocab';
  if (p.get('folder')) return esc(folderById(p.get('folder'))?.name || 'folder');
  if (p.get('study')) return 'study';
  if (p.has('history')) return 'History';
  return 'Home';
}
function leaveSettings() {
  const from = beforeSettings;
  if (!from) return go('');                       // opened from a link: nothing to go back to
  // Results fill in a moment after they render; put the position back until it holds, unless you scroll.
  const restore = () => {
    const t0 = Date.now();
    let set = null;
    const tick = () => {
      if (set !== null && Math.abs(window.scrollY - set) > 4) return;   // you scrolled: leave it
      window.scrollTo(0, from.scroll);
      set = window.scrollY;
      if (Math.abs(set - from.scroll) > 4 && Date.now() - t0 < 2500) setTimeout(tick, 100);
    };
    setTimeout(tick, 50);
  };
  window.addEventListener('hashchange', restore, { once: true });
  history.back();                                  // back to where you were, without a new history entry
}

function go(params) {
  const h = typeof params === 'string' ? params : new URLSearchParams(params).toString();
  if (location.hash === '#' + h || (!h && !location.hash)) route();
  else location.hash = h ? '#' + h : '';
}
const studyHash = (ids, mode) => `study=${ids.map(encodeURIComponent).join(',')}&mode=${mode}`;

function updateNavChrome(tabName) {
  document.querySelectorAll('[data-nav-tab]').forEach(el => {
    if (el.dataset.navTab === tabName) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  const due = dueCount(liveCards());
  const txt = due > 99 ? '99+' : String(due);
  for (const id of ['rail-due-badge', 'bnav-due-badge']) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.hidden = !due;
    b.textContent = txt;
  }
}

function renderRail() {
  if (!railScroll) return;
  const p = new URLSearchParams(location.hash.slice(1));
  const curQ = p.get('q') || '', curF = p.get('folder') || '';
  const folders = tree();
  const recent = liveHistory().slice(0, 8);
  const due = dueCount(liveCards());

  let h = `<section class="rail-sec">
    <div class="rail-sec-h"><span>Folders</span>${due ? `<button type="button" class="rail-sec-link" data-go="${esc(studyHash([...new Set(liveCards().filter(isDue).map(cardFolder))], 'review'))}">${due} due</button>` : ''}</div>`;
  if (folders.length) {
    h += `<ul class="rail-list">${folders.map(({ f, depth }) => {
      const cs = cardsDeep(f.id), d = dueCount(cs);
      const cls = f.id === curF ? ' on' : '';
      return `<li><button type="button" class="rail-item${cls}" style="--depth:${depth}" data-go="folder=${esc(f.id)}">
        <span class="rail-item-w" dir="auto">${esc(f.name)}</span>
        <span class="rail-item-meta${d ? ' due' : ''}">${isPaused(f.id) ? 'paused' : d ? d + ' due' : cs.length}</span>
      </button></li>`;
    }).join('')}</ul>`;
  } else {
    h += `<p class="rail-empty">Bookmark any word to build your personal folders.</p>`;
  }
  h += `</section>`;

  h += `<section class="rail-sec">
    <div class="rail-sec-h"><span>Recent</span>${recent.length ? '<button type="button" class="rail-sec-link" data-go="history">All</button>' : ''}</div>`;
  if (recent.length) {
    h += `<ul class="rail-list">${recent.map(({ q, t }) => {
      const cls = q === curQ ? ' on' : '';
      return `<li><button type="button" class="rail-item${cls}" data-q="${esc(q)}">
        <span class="rail-item-w" ${qAttr(q)}>${esc(q)}</span>
        <span class="rail-item-meta">${relTime(t).replace(' ago', '')}</span>
      </button></li>`;
    }).join('')}</ul>`;
  } else {
    h += `<p class="rail-empty">Lookups appear here.</p>`;
  }
  h += `</section>`;

  railScroll.innerHTML = h;
}

function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  const q = p.get('q') || '';
  if (q && qEl.value !== q && document.activeElement !== qEl) qEl.value = q;
  if (!q && !p.has('e') && !p.has('f') && !p.has('w') && document.activeElement !== qEl) qEl.value = '';
  clearBtn.hidden = !qEl.value;

  document.body.classList.remove('studying', 'wide-view');
  if (p.has('settings')) {   // remember where Settings was opened from, for its back button
    if (curView !== 'settings') beforeSettings = curView === 'boot' ? null : { hash: lastHash, scroll: window.scrollY };
  } else if (!p.has('account')) lastHash = location.hash.slice(1);
  window.scrollTo(0, 0);

  if (p.has('account')) {
    if (curView === 'boot') { curView = 'home'; renderHomeView(); }
    updateNavChrome('search');
    renderRail();
    if (SYNC_URL && Sync) accountSheet({ onClose: () => { if (location.hash === '#account') history.back(); } });
    return;
  }
  if (p.has('settings')) {
    curView = 'settings';
    document.title = 'Settings · Qamus';
    updateNavChrome('settings');
    renderRail();
    return renderSettingsView();
  }
  if (p.has('history')) {
    curView = 'history';
    document.title = 'History · Qamus';
    updateNavChrome('history');
    renderRail();
    return renderHistoryView();
  }
  if (p.has('vocab')) {
    curView = 'vocab';
    document.title = 'Vocab · Qamus';
    updateNavChrome('vocab');
    renderRail();
    return renderVocabView();
  }
  if (p.get('folder')) {
    curView = 'folder';
    vocabUi.folderId = p.get('folder');
    document.title = `${folderById(vocabUi.folderId)?.name || 'Folder'} · Qamus`;
    updateNavChrome('vocab');
    renderRail();
    return renderFolderView(vocabUi.folderId);
  }
  if (p.get('study')) {
    curView = 'study';
    document.body.classList.add('studying');
    document.title = 'Study · Qamus';
    updateNavChrome('vocab');
    renderRail();
    return renderStudyRoute(p.get('study').split(','), p.get('mode'));
  }

  updateNavChrome('search');
  renderRail();

  if (p.get('e') || p.get('f') || p.get('w') || q.trim()) {
    curView = 'result';
    activeSourceTab = 'all';
    if (!state.HW) {
      main.innerHTML = `<div class="boot-state"><div class="boot-seal" lang="ar">قاموس</div><p class="muted">Loading dictionary index…</p></div>`;
      return;
    }
    if (p.get('e')) {
      const e = state.byId.get(+p.get('e'));
      if (!e) return renderHomeView();
      lastSearchedRaw = e[1];
      document.title = `${e[1]} · Qamus`;
      return renderRootsResult([e[4]], { hits: new Set([e[0]]), force: 'hw' }, e[1]);
    }
    if (p.get('f')) {
      const f = state.HW.forms[+p.get('f')];
      if (!f) return renderHomeView();
      lastSearchedRaw = f[2];
      document.title = `${f[2]} · Qamus`;
      return renderRootsResult([f[0]], { forms: [f], force: 'hw' }, q || f[2]);
    }
    if (p.get('w')) {
      if (!state.W) {
        main.innerHTML = `<div class="boot-state"><p class="muted">Loading Wiktionary…</p></div>`;
        return;
      }
      const k = +p.get('w');
      lastSearchedRaw = q || state.W.entries[k]?.[0] || '';
      document.title = `${lastSearchedRaw} · Qamus`;
      return renderRootsResult(wRoots(k), { wikt: [k], force: 'wikt' }, lastSearchedRaw);
    }
    lastSearchedRaw = q.trim();
    document.title = `${lastSearchedRaw} · Qamus`;
    recordSearch(lastSearchedRaw);
    renderRail();
    return runSearch(lastSearchedRaw);
  }

  curView = 'home';
  document.title = 'Qamus · قاموس';
  renderHomeView();
}

// ==========================================================================
// 1. HOME VIEW
// ==========================================================================
const NEW_HOME = 'https://alqamus.pages.dev';
const OLD_HOME = location.hostname === 'subhanepix.github.io' || !!window.QAMUS_FORCE_MOVED;
function movedBannerHtml() {
  if (!OLD_HOME) return '';
  const user = (SYNC_URL && Sync?.state.user) || '';
  const how = user
    ? `Sign in there with <code>${esc(user)}</code> and your words come with you.`
    : 'Turn on sync first, then sign in there with the same username to bring your words across.';
  return `<section class="moved-banner" role="status">
    <p><strong>Qamus has a new home:</strong> <a href="${NEW_HOME}/">${NEW_HOME.replace('https://', '')}</a></p>
    <p>${how}</p>
    <a class="btn primary sm" href="${NEW_HOME}/">Open alqamus.pages.dev</a>
  </section>`;
}

function renderHomeView() {
  const user = (SYNC_URL && Sync?.state.user) || '';
  const hr = new Date().getHours();
  const tod = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const recent = liveHistory().slice(0, 12);
  const cards = liveCards();
  const dueCards = cards.filter(isDue);
  const dueIds = [...new Set(dueCards.map(cardFolder))];

  const studyBanner = cards.length ? `
    <section class="study-banner ${dueCards.length ? '' : 'calm'}">
      <div>
        <div class="sb-num">${dueCards.length ? `<b>${dueCards.length}</b> ${dueCards.length === 1 ? 'card' : 'cards'} due today` : 'All caught up'}</div>
        <p class="sb-meta">${plural(cards.length, 'saved word')} across ${plural(allFolders().length, 'folder')}${dueCards.length ? ' · SM-2 spaced repetition ready' : ''}</p>
      </div>
      <div class="toolbar-row">
        ${dueCards.length ? `<button type="button" class="btn primary" data-go="${esc(studyHash(dueIds, 'review'))}">Review now</button>` : ''}
        <button type="button" class="btn soft" data-go="vocab">Open Vocab</button>
      </div>
    </section>` : '';

  const samples = [
    { q: 'إِنَّ', hint: 'Particle' },
    { q: 'عِلْم', hint: 'Tashkeel' },
    { q: 'وسيكتبونها', hint: 'Morphology' },
    { q: 'ك ت ب', hint: 'Root' },
    { q: 'لِ', hint: 'Harf Jarr' },
    { q: 'wisdom', hint: 'English' },
  ];

  main.innerHTML = `
    ${movedBannerHtml()}
    <section class="home-hero">
      <div class="home-eyebrow"><span lang="ar">أهلًا وسهلًا</span><span>${tod}</span></div>
      <h1 class="home-title">${user ? `Welcome back, <em>${esc(user)}</em>.` : 'Five Arabic lexicons, <em>one quiet desk</em>.'}</h1>
      <p class="home-sub">
        Look up any inflected word, spaced root, or English term across Hans Wehr, Lane’s Lexicon, Wiktionary, al-Mufradāt, and Mukhtār al-Ṣiḥāḥ — offline-first and synced across devices.
      </p>
      <div class="home-cta-row">
        <button type="button" class="btn primary" id="home-focus-search">Search dictionary <kbd class="key-hint-kbd">/</kbd></button>
        <button type="button" class="btn" data-go="vocab">Vocabulary folders</button>
      </div>
    </section>
    <p class="credit">inspired by Youssef Z.</p>

    ${studyBanner}

    <div class="panel-head">
      <h2 class="panel-title">Try a lookup</h2>
    </div>
    <div class="explore-chips">
      ${samples.map(s => `<button type="button" class="explore-chip" data-q="${esc(s.q)}">
        <span ${qAttr(s.q)}>${esc(s.q)}</span><small>${s.hint}</small>
      </button>`).join('')}
    </div>

    ${recent.length ? `
      <div class="panel-head">
        <h2 class="panel-title">Recent lookups</h2>
        <button type="button" class="btn quiet sm" data-go="history">View all</button>
      </div>
      <ul class="recent-cards">
        ${recent.map(({ q, t }) => `<li><button type="button" class="recent-card" data-q="${esc(q)}">
          <span class="rc-word" ${qAttr(q)}>${esc(q)}</span>
          <span class="rc-time">${relTime(t)}</span>
        </button></li>`).join('')}
      </ul>` : ''}

    <div class="panel-head">
      <h2 class="panel-title">Search tips</h2>
    </div>
    <section class="card howto-card">
      <div class="howto-grid">
        <div class="howto-item">
          <span class="howto-sample" lang="ar">وسيكتبونها</span>
          <span class="howto-desc">Type any inflected Arabic word — prefixes, suffixes & pronouns strip automatically.</span>
        </div>
        <div class="howto-item">
          <span class="howto-sample" lang="ar">ك ت ب</span>
          <span class="howto-desc">Enter root letters separated by spaces to jump straight to all verb forms (I–X) & derivatives.</span>
        </div>
        <div class="howto-item">
          <span class="howto-sample">book · kitab</span>
          <span class="howto-desc">Search in English or Latin transliteration. Hamzas, harakat, ة/ه and ى/ي are normalized.</span>
        </div>
      </div>
    </section>
  `;
}

// ==========================================================================
// 2. SEARCH & DICTIONARY RESULTS
// ==========================================================================
function runSearch(q) {
  const res = resolveQuery(q);
  if (res.kind === 'empty') return renderHomeView();
  if (res.kind === 'english') return renderEnglishSearch(res.q);
  if (res.kind === 'passage') {
    // Offer direct handoff to Reader or inline word breakdown!
    return renderMultiWordResult(res.words, res.q);
  }
  if (res.kind === 'roots') return renderRootsResult(res.roots, res.opt, res.q);
  return renderFallbackResult(res.q, res.n);
}

function renderMultiWordResult(words, fullText) {
  main.innerHTML = `
    <div class="result-hero">
      <div class="rh-top">
        <div>
          <span class="badge-pill gold">Multi-word lookup</span>
          <h1 class="rh-word" lang="ar">${esc(fullText)}</h1>
        </div>
      </div>
      <p class="muted" style="margin:8px 0 0;font-family:var(--ui);font-size:13.5px;">Tap any word below to open its full dictionary entry.</p>
    </div>
    <div class="en-list">
      ${words.map(w => {
        const a = analyze(w)[0];
        const g = a ? a.stem[2].replace(/;/g, '; ') : (state.hwNorm.get(norm(w))?.[0] ? plain(stripHead(state.hwNorm.get(norm(w))[0])).slice(0, 100) : 'Tap to look up');
        return `<div class="en-item" data-q="${esc(w)}">
          <span class="en-item-w" lang="ar">${esc(w)}</span>
          <span class="en-item-g">${esc(g)}</span>
        </div>`;
      }).join('')}
    </div>
  `;
}

function renderFallbackResult(q, n) {
  const near = nearestMatches(n);
  main.innerHTML = `
    <div class="result-hero">
      <span class="badge-pill again">No exact match</span>
      <h1 class="rh-word" lang="ar">${esc(q)}</h1>
      <p class="muted" style="margin:6px 0 0;font-family:var(--ui);font-size:14px;">
        ${state.W ? 'Check spelling or try one of the closest headwords below.' : 'Wiktionary is still loading — results may appear momentarily.'}
      </p>
    </div>
    ${near.length ? `<div class="panel-head"><h2 class="panel-title">Closest headwords</h2></div>
      <div class="en-list">${near.map(r => `<div class="en-item" data-pick='${esc(JSON.stringify(r))}'>
        <span class="en-item-w" lang="ar">${esc(r[1])}</span>
        <span class="en-item-g">${esc(glossFor(r))}</span>
      </div>`).join('')}</div>` : ''}
  `;
}

async function renderEnglishSearch(q) {
  const seq = ++resultSeq;
  if (!hwHave(state.HW.chunks)) {
    main.innerHTML = `<div class="boot-state"><p class="muted">Loading full Hans Wehr index for English search…</p></div>`;
    try {
      await loadAllHw();
    } catch {
      if (seq === resultSeq) main.innerHTML = `<div class="card" style="padding:24px"><p class="muted">Could not load Hans Wehr definitions. Check connection and try again.</p></div>`;
      return;
    }
    if (seq !== resultSeq || curView !== 'result') return;
  }
  const { tr, scored, total, terms } = searchEnglish(q);
  const hl = s => {
    let h = esc(s);
    for (const t of terms) h = h.replace(new RegExp(`\\b(${t})`, 'gi'), '<mark>$1</mark>');
    return h;
  };
  const itemHtml = e => `<div class="en-item" data-e="${e[0]}">
    <span class="en-item-w" lang="ar">${esc(e[1])}</span>
    <span class="en-item-g">${e[6] ? `<i class="muted" style="margin-right:8px">${esc(e[6])}</i>` : ''}${hl(plain(stripHead(e)).slice(0, 220))}</span>
  </div>`;

  main.innerHTML = `
    <div class="result-hero">
      <span class="badge-pill root">English & Transliteration</span>
      <h1 style="margin:6px 0 0;font:600 30px/1.2 var(--en)">“${esc(q)}”</h1>
      <p class="muted" style="margin:6px 0 0;font:13.5px var(--ui)">${plural(total, 'Hans Wehr definition')}${tr.length ? ` · ${tr.length} exact transliteration` : ''}</p>
    </div>
    ${tr.length ? `<div class="panel-head"><h2 class="panel-title">Exact Transliteration</h2></div><div class="en-list">${tr.map(itemHtml).join('')}</div>` : ''}
    <div class="panel-head"><h2 class="panel-title">English Matches</h2></div>
    ${scored.length ? `<div class="en-list">${scored.map(x => itemHtml(x[1])).join('')}</div>` : `<div class="card" style="padding:20px"><p class="muted" style="margin:0">No English definitions matched “${esc(q)}”.</p></div>`}
  `;
}

function saveBtnHtml(payload, word) {
  return `<button type="button" class="bm-btn" data-save="${esc(JSON.stringify(payload))}" data-word="${esc(word)}" aria-pressed="false" aria-label="Save ${esc(word)}" title="Save to vocab">${BOOKMARK_SVG}</button>`;
}

function syncBookmarkStates(rootEl = main) {
  const idx = savedIndex();
  for (const b of rootEl.querySelectorAll('.bm-btn[data-save]')) {
    let p;
    try { p = JSON.parse(b.dataset.save); } catch { continue; }
    const on = idx.has(p.s + '|' + p.r);
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Saved — click to manage folders' : 'Save to vocab';
  }
}

function renderMorphStrip(parses) {
  const list = uniqParses(parses).slice(0, 3);
  if (!list.length) return '';
  return `<div class="morph-strip">
    ${list.map(a => {
      const segs = [];
      if (a.pre[0]) segs.push(`<span class="m-seg"><span class="m-ar" lang="ar">${esc(a.pre[0])}</span><span class="m-gl">${esc(a.pre[2] || 'prefix')}</span></span>`);
      segs.push(`<span class="m-seg stem"><span class="m-ar" lang="ar">${esc(a.stem[0])}</span><span class="m-gl">${esc(a.stem[2].split(';')[0] || 'stem')}</span></span>`);
      if (a.suf[0]) segs.push(`<span class="m-seg"><span class="m-ar" lang="ar">${esc(a.suf[0])}</span><span class="m-gl">${esc(a.suf[2] || 'suffix')}</span></span>`);
      const R = rootLabel(a.stem);
      const gl = [a.pre[2], a.stem[2].replace(/;/g, '; '), a.suf[2]].filter(Boolean).join(' + ');
      return `<div class="morph-row">
        <div class="morph-pills">${segs.join('<span class="m-plus">+</span>')}</div>
        <div class="morph-summary">${esc(gl)}${R ? ` · <button type="button" class="btn quiet sm" data-q="${esc(R)}" style="padding:0 6px;min-height:24px"><span lang="ar" style="font-size:17px">${esc(R)}</span></button>` : ''}</div>
      </div>`;
    }).join('')}
  </div>`;
}

async function renderRootsResult(rootIds, opt, q) {
  const seq = ++resultSeq;
  const {
    particles = [],
    hits = new Set(),
    exactHits = new Set(),
    forms = [],
    parses = [],
    bwOnly = [],
    wikt = [],
    laneOnly = [],
    laneWord = '',
    arWord = '',
    force = '',
    retry = null,
  } = opt;

  if (state.HW && rootIds.length && (force === 'hw' || !resultPrefs().off.has('hw')) && !hwHave(rootIds)) {
    main.innerHTML = `<div class="boot-state"><p class="muted">Fetching Hans Wehr root definitions…</p></div>`;
    try {
      await loadHw(rootIds);
    } catch {
      if (seq === resultSeq) main.innerHTML = `<div class="card" style="padding:24px"><p class="muted">Could not load Hans Wehr chunk. Check connection and try again.</p></div>`;
      return;
    }
    if (seq !== resultSeq || curView !== 'result') return;
  }

  const pr = resultPrefs();
  const isOn = id => id === force || !pr.off.has(id);
  const extra = uniqParses(bwOnly).slice(0, 6);
  const arKeys = arKeysFor(rootIds, [...laneOnly, arWord]);
  const primaryRoot = rootIds.length ? state.byId.get(rootIds[0]) : null;
  const exactEntry = [...exactHits].map(id => state.byId.get(id)).find(Boolean);
  const primaryHit = exactEntry || [...hits].map(id => state.byId.get(id)).find(Boolean) || primaryRoot;
  const topParticle = particles[0] || null;
  const heroWord = topParticle ? (topParticle._exact ? topParticle.ar : q) : (hasTashkeel(q) ? q : (primaryHit ? primaryHit[1] : q));
  const heroTr = topParticle ? topParticle.tr : (primaryHit?.[6] || (wikt.length ? state.W?.entries[wikt[0]]?.[1] : '') || '');
  const userTypedHarakat = hasTashkeel(q);
  const hasAnyExactHarakat = exactHits.size > 0 || particles.some(p => p._exact);

  // Count entries per source for the sticky Source Switcher Bar
  const laneKeysAll = [...new Set([
    ...rootIds.map(rid => laneKey(norm(state.byId.get(rid)?.[1] || ''))),
    ...laneOnly.map(lr => laneKey(lr)),
  ].filter(Boolean))];
  const totalForms = rootIds.reduce((acc, rid) => acc + (state.formsBy.get(rid)?.length || 0), 0);
  const totalHwWords = rootIds.reduce((acc, rid) => acc + (state.kids.get(rid)?.length || 0) + 1, 0);

  const availTabs = [{ id: 'all', label: 'All Sources', count: null }];
  if (particles.length) availTabs.push({ id: 'particles', label: 'Particles', count: particles.length });
  if (rootIds.length && isOn('hw')) availTabs.push({ id: 'hw', label: 'Hans Wehr', count: totalHwWords });
  if (totalForms && isOn('hw')) availTabs.push({ id: 'forms', label: 'Verb Forms', count: totalForms });
  if (wikt.length && isOn('wikt')) availTabs.push({ id: 'wikt', label: 'Wiktionary', count: wikt.length });
  if (extra.length && isOn('lexicon')) availTabs.push({ id: 'lexicon', label: 'Lexicon', count: extra.length });
  if (laneKeysAll.length && isOn('lane')) availTabs.push({ id: 'lane', label: 'Lane’s Lexicon', count: laneKeysAll.length });
  for (const id of AR_IDS) {
    if (arKeys[id].length && isOn(id)) availTabs.push({ id, label: AR_DICTS[id].name, count: arKeys[id].length });
  }

  // Hero card
  const heroHtml = `
    ${retry ? `<div class="retry-banner">
      <span>No direct match for <strong lang="ar">${esc(retry.from)}</strong> — showing <strong lang="ar">${esc(retry.word)}</strong> (${retry.why === 'al' ? 'without leading ال' : 'without emphatic نّ'}).</span>
    </div>` : ''}
    <section class="result-hero">
      <div class="rh-top">
        <div class="rh-word-group">
          <h1 class="rh-word" lang="ar">${esc(heroWord)}</h1>
          ${heroTr ? `<span class="rh-tr">${esc(heroTr)}</span>` : ''}
        </div>
        <div class="rh-actions">
          <button type="button" class="btn sm quiet" data-copy="${esc(heroWord)}" title="Copy Arabic word">${COPY_SVG} Copy</button>
        </div>
      </div>
      <div class="rh-meta">
        ${topParticle ? `<span class="badge-pill gold"><span lang="ar" style="font-size:15px">${esc(topParticle.arCat)}</span> · ${esc(topParticle.enCat)}</span>` : ''}
        ${!topParticle ? rootIds.map(rid => {
          const r = state.byId.get(rid);
          if (!r) return '';
          const spaced = [...r[1]].join(' ');
          return `<button type="button" class="root-chip" data-q="${esc(spaced)}" title="Open root">
            <span>Root</span><span lang="ar">${esc(spaced)}</span>
          </button>${r[5] ? `<span class="badge-pill gold">Qur’an ${r[5]}×</span>` : ''}`;
        }).join('') : ''}
        ${!topParticle && totalForms ? `<span class="badge-pill">${plural(totalForms, 'verb form')}</span>` : ''}
        ${userTypedHarakat && hasAnyExactHarakat ? `<span class="badge-pill good">Exact harakat prioritized</span>` : ''}
        ${userTypedHarakat && !hasAnyExactHarakat ? `<span class="badge-pill">No exact harakat match · showing all forms</span>` : ''}
      </div>
      ${pr.parse && parses.length ? renderMorphStrip(parses) : ''}
    </section>
    <div id="lead-slot"></div>
  `;

  // Source tabs bar
  const tabsHtml = availTabs.length > 2 ? `
    <nav class="source-tabs" aria-label="Filter dictionary sources">
      ${availTabs.map(t => `<button type="button" class="src-tab" data-src-tab="${t.id}" aria-pressed="${activeSourceTab === t.id}">
        <span>${esc(t.label)}</span>${t.count != null ? `<span class="cnt">${t.count}</span>` : ''}
      </button>`).join('')}
    </nav>` : '';

  // Sections in user order
  const sections = [];
  const showSection = id => activeSourceTab === 'all' || activeSourceTab === id;

  // Curated Grammar & Particles section (always prioritized above roots!)
  if (particles.length && showSection('particles')) {
    sections.push(`<section class="dict-section" data-sec="particles">
      <div class="dict-head"><h2 class="dict-title ar-kind">Particles & Grammar (حروف وأدوات)</h2></div>
      <div class="particle-list">
        ${particles.map(p => `<article class="particle-card${p._exact ? ' exact' : ''}">
          <div class="pc-head">
            <div>
              <div class="pc-word-wrap">
                <span class="pc-word" lang="ar">${esc(p.ar)}</span>
                <span class="pc-tr">${esc(p.tr)}</span>
                ${p._exact ? `<span class="badge-pill good">Exact match</span>` : ''}
              </div>
              <div class="pc-cats">
                <span class="badge-pill gold" lang="ar" style="font-size:14px;text-transform:none;letter-spacing:0">${esc(p.arCat)}</span>
                <span class="badge-pill">${esc(p.enCat)}</span>
              </div>
            </div>
            ${saveBtnHtml({ s: 'custom', r: 'p:' + p.ar, w: p.ar, g: `${p.enCat}: ${p.meaning}`, tr: p.tr, note: p.effect }, p.ar)}
          </div>
          <div class="pc-effect"><strong>Grammar effect (عمل):</strong> ${esc(p.effect)}</div>
          <p class="pc-meaning">${esc(p.meaning)}</p>
          ${p.example ? `<p class="pc-example">${defHtml(p.example)}</p>` : ''}
          ${p.note ? `<p class="pc-note">${defHtml(p.note)}</p>` : ''}
        </article>`).join('')}
      </div>
    </section>`);
  }

  // Special focused Verb Forms tab
  if (activeSourceTab === 'forms' && totalForms) {
    sections.push(`<section class="dict-section">
      <div class="dict-head"><h2 class="dict-title">Verb Forms (الأوزان)</h2></div>
      ${rootIds.map(rid => {
        const fs = state.formsBy.get(rid) || [];
        if (!fs.length) return '';
        const root = state.byId.get(rid);
        return `<div class="root-folio"><div class="forms-wrap" style="border-bottom:0">
          <p class="sub-kicker">Root <span lang="ar" style="font-size:18px;color:var(--accent)">${esc([...root[1]].join(' '))}</span></p>
          ${renderVerbForms(fs, forms)}
        </div></div>`;
      }).join('')}
    </section>`);
  }

  let hiddenAny = false;
  for (const id of pr.order) {
    if (id === 'hw' && rootIds.length) {
      if (!isOn('hw')) { hiddenAny = true; continue; }
      if (!showSection('hw')) continue;
      // When particles matched a 1-letter or core particle, start Hans Wehr collapsed so grammar card shines first
      const openByDefault = k => (particles.length ? false : (k === 0 || rootIds.length <= 2));
      sections.push(`<section class="dict-section" data-sec="hw">
        <div class="dict-head"><h2 class="dict-title">Hans Wehr · ${plural(rootIds.length, 'root')}</h2></div>
        ${rootIds.map((rid, k) => renderRootFolio(rid, hits, forms, openByDefault(k), exactHits)).join('')}
      </section>`);
    } else if (id === 'wikt' && wikt.length) {
      if (!isOn('wikt')) { hiddenAny = true; continue; }
      if (!showSection('wikt')) continue;
      sections.push(`<section class="dict-section" data-sec="wikt">
        <div class="dict-head"><h2 class="dict-title">Wiktionary</h2></div>
        <div class="card"><div class="entry-list">${wikt.map(renderWiktEntry).join('')}</div></div>
      </section>`);
    } else if (id === 'lexicon' && extra.length) {
      if (!isOn('lexicon')) { hiddenAny = true; continue; }
      if (!showSection('lexicon')) continue;
      sections.push(`<section class="dict-section" data-sec="lexicon">
        <div class="dict-head"><h2 class="dict-title">Buckwalter Morphological Lexicon</h2></div>
        <div class="card"><div class="entry-list">${extra.map(renderBwEntry).join('')}</div></div>
      </section>`);
    } else if (id === 'lane' && laneKeysAll.length) {
      if (!isOn('lane')) { hiddenAny = true; continue; }
      if (!showSection('lane')) continue;
      const autoOpen = activeSourceTab === 'lane' || laneOnly.length > 0 || !!(laneWord && (state.laneIdx.get(laneWord) || []).some(k => laneKeysAll.includes(laneKey(k))));
      sections.push(`<section class="dict-section" data-sec="lane">
        <div class="dict-head"><h2 class="dict-title">Lane’s Lexicon</h2></div>
        ${laneKeysAll.map((k, j) => `<details class="root-folio lane-details" data-lane-root="${esc(k)}" data-lane-word="${esc(laneWord)}" ${autoOpen && j === 0 ? 'open' : ''}>
          <summary class="rf-summary">
            <span class="rf-chevron">▸</span>
            <span class="rf-letters" lang="ar">${esc([...k].join(' '))}</span>
            <span class="rf-badges"><span class="badge-pill">Lane’s Lexicon</span></span>
          </summary>
          <div class="lane-body" style="padding:14px 20px"><span class="muted">Loading classical entries…</span></div>
        </details>`).join('')}
      </section>`);
    } else if (AR_DICTS[id] && arKeys[id].length) {
      if (!isOn(id)) { hiddenAny = true; continue; }
      if (!showSection(id)) continue;
      sections.push(`<section class="dict-section" data-sec="${id}">
        <div class="dict-head"><h2 class="dict-title ar-kind">${AR_DICTS[id].name}</h2></div>
        ${arKeys[id].map((k, j) => `<details class="ar-manuscript ar-details" data-ar-dict="${id}" data-ar-root="${esc(k)}" data-ar-want="${esc(norm(q))}" ${j === 0 ? 'open' : ''}>
          <summary class="ar-ms-head">
            <span>${AR_DICTS[id].full}</span>
            <span lang="ar" style="font:700 22px/1.2 var(--ar);color:var(--gold);letter-spacing:0.1em">${esc([...k].join(' '))}</span>
          </summary>
          <div class="ar-ms-body" style="padding:16px 22px"><span class="muted">Loading manuscript entry…</span></div>
        </details>`).join('')}
      </section>`);
    }
  }

  main.innerHTML = heroHtml + tabsHtml + (sections.join('') || `<div class="card" style="padding:24px"><p class="muted" style="margin:0">Nothing to display with your current dictionary filter.</p></div>`)
    + (hiddenAny ? `<p class="muted" style="font:13px var(--ui);margin-top:12px">Some dictionaries are turned off in <a href="#settings">Settings</a>.</p>` : '');

  syncBookmarkStates(main);

  // Wire source tabs
  main.querySelectorAll('[data-src-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSourceTab = btn.dataset.srcTab;
      renderRootsResult(rootIds, opt, q);
    });
  });

  // Wire in-root instant filter inputs
  main.querySelectorAll('.rf-filter').forEach(inp => {
    inp.addEventListener('input', () => {
      const needle = inp.value.trim().toLowerCase();
      const nAr = norm(needle);
      const folio = inp.closest('.root-folio');
      folio.querySelectorAll('.entry-row, .form-row').forEach(row => {
        if (!needle) { row.hidden = false; return; }
        const txt = row.textContent.toLowerCase();
        const arMatch = nAr && norm(row.textContent).includes(nAr);
        row.hidden = !(txt.includes(needle) || arMatch);
      });
    });
  });

  // Load any open Lane / Arabic shards
  main.querySelectorAll('details.lane-details[open]').forEach(fillLaneCard);
  main.querySelectorAll('details.ar-details[open]').forEach(fillArCard);

  // Lead snippet for ال-stripped classical nouns
  if (retry && retry.why === 'al' && !hits.size && !forms.length) {
    fillLeadSlot($('#lead-slot'), retry, arKeys, laneWord);
  }
}

function renderVerbForms(fs, hitForms) {
  return `<div class="form-list">
    ${fs.map(f => {
      const pat = VERB_PATTERNS[f[1]] || { wazn: '', sense: '' };
      const isHit = hitForms.includes(f);
      return `<div class="form-row${isHit ? ' hit' : ''}">
        <div class="form-badge-col">
          <span class="form-num">${esc(f[1])}</span>
          ${pat.wazn ? `<span class="form-wazn" lang="ar">${pat.wazn}</span>` : ''}
        </div>
        <div class="form-main">
          <div class="form-head">
            <span class="form-verb" lang="ar">${esc(f[2])}</span>
            ${pat.sense ? `<span class="form-sense">${pat.sense}</span>` : ''}
          </div>
          <div class="def-text">${defHtml(f[3] || '')}</div>
        </div>
        ${saveBtnHtml({ s: 'hw', r: 'f' + formIdx(f) }, f[2])}
      </div>`;
    }).join('')}
  </div>`;
}

function renderRootFolio(rid, hits, hitForms, open, exactHits = new Set()) {
  const root = state.byId.get(rid);
  if (!root) return '';
  const fs = state.formsBy.get(rid) || [];
  const s = stripHead(root);
  const cut = s.search(/<b>\s*(I{1,3}|IV|VI{0,3}|IX|X)\s*<\/b>/);
  const formI = cut >= 0 ? s.slice(0, cut).trim() : s;
  const rawKids = state.kids.get(rid) || [];
  // When user typed tashkeel and matched specific derived entry/entries, bubble exact matches to the very top!
  const hasExact = exactHits.size > 0;
  const activeHits = hasExact ? exactHits : hits;
  const ks = hasExact
    ? [...rawKids.filter(k => exactHits.has(k[0])), ...rawKids.filter(k => !exactHits.has(k[0]))]
    : rawKids;
  const anyHit = ks.some(k => activeHits.has(k[0])) || activeHits.has(rid) || fs.some(f => hitForms.includes(f));
  const gist = plain(formI).replace(/^\S+\s/, '').slice(0, 120);
  const lat = bwRoot(rid);

  // If a derived entry is an exact harakat match (e.g. عِلْم or عَلَم) and the root itself isn't,
  // put that exact match above the Verb Forms table so it's the very first thing you read!
  const promotedExactKids = hasExact && !exactHits.has(rid) ? ks.filter(k => exactHits.has(k[0])) : [];
  const remainingKids = promotedExactKids.length ? ks.filter(k => !exactHits.has(k[0])) : ks;

  const entryRow = (k, isExact) => `<div class="entry-row${activeHits.has(k[0]) ? ' hit' : ''}" id="w${k[0]}">
    <div class="entry-head">
      <div class="entry-hw-group">
        <span class="entry-hw" lang="ar">${esc(k[1])}</span>
        ${k[6] ? `<span class="entry-tr">${esc(k[6])}</span>` : ''}
        ${isExact ? `<span class="badge-pill good">Exact match</span>` : ''}
      </div>
      <div class="entry-actions">${saveBtnHtml({ s: 'hw', r: String(k[0]) }, k[1])}</div>
    </div>
    <div class="def-text">${defHtml(stripHead(k))}</div>
  </div>`;

  return `<details class="root-folio" ${open || anyHit ? 'open' : ''}>
    <summary class="rf-summary">
      <span class="rf-chevron" aria-hidden="true">▸</span>
      <span class="rf-letters" lang="ar">${esc([...root[1]].join(' '))}</span>
      <span class="rf-gist">${esc(gist)}</span>
      <span class="rf-badges">
        ${root[5] ? `<span class="badge-pill gold">Qur’an ${root[5]}×</span>` : ''}
        <span class="badge-pill">${rawKids.length + 1} words</span>
      </span>
    </summary>
    <div class="rf-toolbar">
      ${rawKids.length >= 6 ? `<input type="search" class="rf-filter" placeholder="Filter ${rawKids.length + 1} entries in this root…" dir="auto">` : `<span class="muted" style="font:12.5px var(--ui)">Hans Wehr 4th ed.</span>`}
      <div class="rf-ext-links">
        <a href="https://ejtaal.net/aa/#q=${encodeURIComponent(lat)}" target="_blank" rel="noopener">Ejtaal ↗</a>
        <a href="https://corpus.quran.com/qurandictionary.jsp?q=${encodeURIComponent(lat)}" target="_blank" rel="noopener">Qur’an Corpus ↗</a>
      </div>
    </div>
    ${promotedExactKids.length ? `<div class="entry-list" style="border-bottom:1px solid var(--border)">
      ${promotedExactKids.map(k => entryRow(k, true)).join('')}
    </div>` : ''}
    ${root[3] && formI ? `<div class="entry-list" style="border-bottom:1px solid var(--border)">
      <div class="entry-row${activeHits.has(rid) ? ' hit' : ''}" id="w${rid}">
        <div class="entry-head">
          <div class="entry-hw-group">
            <span class="entry-hw" lang="ar">${esc(root[1])}</span>
            ${root[6] ? `<span class="entry-tr">${esc(root[6])}</span>` : ''}
            <span class="badge-pill root">Form I / Root</span>
            ${exactHits.has(rid) ? `<span class="badge-pill good">Exact match</span>` : ''}
          </div>
          <div class="entry-actions">${saveBtnHtml({ s: 'hw', r: String(rid) }, root[1])}</div>
        </div>
        <div class="def-text">${defHtml(formI)}</div>
      </div>
    </div>` : ''}
    ${fs.length ? `<div class="forms-wrap"><p class="sub-kicker">Derived Verb Forms (${fs.length})</p>${renderVerbForms(fs, hitForms)}</div>` : ''}
    ${remainingKids.length ? `<div class="entry-list">
      ${remainingKids.map(k => entryRow(k, exactHits.has(k[0]))).join('')}
    </div>` : ''}
  </details>`;
}

function renderWiktEntry(k) {
  const e = state.W.entries[k];
  const rs = wRoots(k);
  const R = rs.length ? [...state.byId.get(rs[0])[1]].join(' ') : '';
  return `<div class="entry-row">
    <div class="entry-head">
      <div class="entry-hw-group">
        <span class="entry-hw" lang="ar">${esc(e[0])}</span>
        ${e[1] ? `<span class="entry-tr">${esc(e[1])}</span>` : ''}
        ${R ? `<button type="button" class="badge-pill root" data-q="${esc(R)}" style="cursor:pointer">Root <span lang="ar" style="font-size:15px">${esc(R)}</span></button>` : ''}
      </div>
      <div class="entry-actions">${saveBtnHtml({ s: 'wikt', r: String(k) }, e[0])}</div>
    </div>
    <div class="def-text">${defHtml(e[2], ['i', 'br', 'ol', 'li'])}</div>
  </div>`;
}

function renderBwEntry(a) {
  const R = rootLabel(a.stem);
  const w = a.stem[4] || a.stem[0];
  const g = a.stem[2].replace(/;/g, '; ');
  return `<div class="entry-row">
    <div class="entry-head">
      <div class="entry-hw-group">
        <span class="entry-hw" lang="ar">${esc(w)}</span>
        ${R ? `<span class="badge-pill">root <span lang="ar" style="font-size:15px">${esc(R)}</span></span>` : ''}
      </div>
      <div class="entry-actions">${saveBtnHtml({ s: 'lexicon', r: w, w, g, root: R }, w)}</div>
    </div>
    <div class="def-text">${esc(g)}</div>
  </div>`;
}

async function fillLaneCard(d) {
  if (d.dataset.filled) return;
  d.dataset.filled = '1';
  const k = d.dataset.laneRoot;
  const want = d.dataset.laneWord;
  const body = d.querySelector('.lane-body');
  try {
    const items = await loadLaneEntries(k);
    body.style.padding = '0';
    body.innerHTML = items.length ? `<div class="entry-list">${items.map(([w, def], i) => {
      const hit = want && (norm(w) === want || norm((def.match(/^[\u0600-\u06FF\u064B-\u0652 ]+/) || [''])[0]) === want);
      return `<div class="entry-row${hit ? ' hit' : ''}">
        <div class="entry-head">
          <span class="entry-hw" lang="ar">${esc(w)}</span>
          ${saveBtnHtml({ s: 'lane', r: `${k}:${i}` }, w)}
        </div>
        <div class="def-text">${defHtml(def, ['i', 'br', 'table', 'tbody', 'tr', 'td', 'center'])}</div>
      </div>`;
    }).join('')}</div>` : `<p class="muted" style="padding:16px 20px">No Lane entries.</p>`;
    syncBookmarkStates(body);
  } catch {
    delete d.dataset.filled;
    body.innerHTML = `<p class="muted">Could not load Lane’s Lexicon shard.</p>`;
  }
}

async function fillArCard(d) {
  if (d.dataset.filled) return;
  d.dataset.filled = '1';
  const id = d.dataset.arDict;
  const k = d.dataset.arRoot;
  const want = d.dataset.arWant;
  const body = d.querySelector('.ar-ms-body');
  try {
    const shard = await arShard(id, k);
    const items = shard[k] || [];
    body.style.padding = '0';
    body.innerHTML = items.length
      ? items.map((html, i) => {
          const head = arHead(id, html, k);
          return `<div class="ar-ms-entry">
            <div class="ar-ms-bar">
              <span class="badge-pill gold">${AR_DICTS[id].name}</span>
              ${saveBtnHtml({ s: id, r: `${k}:${i}` }, head)}
            </div>
            <div class="ar-ms-text" lang="ar" dir="rtl">${arHtml(html, want)}</div>
          </div>`;
        }).join('') + `<p class="ar-ms-src">${AR_DICTS[id].full} — text & harakat via al-Maktaba al-Shāmila.</p>`
      : `<p class="muted" style="padding:16px 20px">No entries.</p>`;
    syncBookmarkStates(body);
  } catch {
    delete d.dataset.filled;
    body.innerHTML = `<p class="muted">Could not load Arabic dictionary shard.</p>`;
  }
}

async function fillLeadSlot(slot, retry, arKeys, laneWord) {
  if (!slot) return;
  const w = norm(retry.word), exact = norm(retry.from);
  const found = [];
  for (const id of AR_IDS) {
    for (const k of arKeys[id] || []) {
      try {
        const items = (await arShard(id, k))[k] || [];
        for (const html of items) {
          const sn = snippet(plain(html.replace(/<br\s*\/?>/g, '\n')), w, exact, 70, 150);
          if (sn) { found.push({ name: AR_DICTS[id].name, sn, ar: true }); break; }
        }
      } catch {}
      if (found.length) break;
    }
    if (found.length >= 2) break;
  }
  if (!found.length && laneWord) {
    for (const k of state.laneIdx.get(laneWord) || []) {
      const lk = laneKey(k);
      if (!lk) continue;
      try {
        const items = await loadLaneEntries(lk);
        for (const [, def] of items) {
          const sn = snippet(plain(def.replace(/<br\s*\/?>/g, '\n')), w, '', 220, 60, /\n/);
          if (sn) { found.push({ name: 'Lane’s Lexicon', sn, ar: false }); break; }
        }
      } catch {}
      if (found.length) break;
    }
  }
  if (!slot.isConnected || !found.length) return;
  slot.innerHTML = found.map(({ name, sn, ar }) => `<div class="lead-card">
    <span class="badge-pill gold" style="margin-bottom:8px">${esc(name)} excerpt</span>
    <p class="lead-text${ar ? '' : ' en'}" ${ar ? 'lang="ar" dir="rtl"' : ''}>${esc(sn.pre)}<mark lang="ar">${esc(sn.hit)}</mark>${esc(sn.post)}</p>
  </div>`).join('');
}

// ==========================================================================
// 3. VOCAB & FOLDERS VIEWS
// ==========================================================================
function renderVocabView() {
  const rows = tree();
  const total = liveCards().length;
  const due = dueCount(liveCards());
  const liveIds = new Set(rows.map(r => r.f.id));
  vocabUi.pickedFolders = new Set([...vocabUi.pickedFolders].filter(id => liveIds.has(id)));
  if (!rows.length) vocabUi.selectFolders = false;

  const pickedCount = vocabUi.pickedFolders.size;

  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Vocabulary</h1>
        <p class="page-sub">${plural(total, 'saved card')} · ${due ? `${due} due for review` : 'all caught up'}</p>
      </div>
      <div class="toolbar-row">
        <button type="button" class="btn primary" id="v-new-folder">New folder</button>
        ${rows.length ? `<button type="button" class="btn ${vocabUi.selectFolders ? 'soft' : ''}" id="v-select-folders">${vocabUi.selectFolders ? 'Cancel select' : 'Multi-study'}</button>` : ''}
        ${total ? `<button type="button" class="btn" id="v-export-all">Export</button>` : ''}
      </div>
    </div>

    ${rows.length ? `<ul class="folder-grid">
      ${rows.map(({ f, depth }) => {
        const cs = cardsDeep(f.id);
        const st = masteryStats(cs);
        const paused = isPaused(f.id);
        const picked = vocabUi.selectFolders && vocabUi.pickedFolders.has(f.id);
        const pctM = st.total ? (st.mastered / st.total) * 100 : 0;
        const pctD = st.total ? (st.due / st.total) * 100 : 0;
        const pctN = st.total ? (st.fresh / st.total) * 100 : 0;
        return `<li class="folder-card${picked ? ' picked' : ''}">
          <div class="fc-top">
            <button type="button" class="fc-open" ${vocabUi.selectFolders ? `data-toggle-f="${esc(f.id)}"` : `data-go="folder=${esc(f.id)}"`}>
              ${depth > 0 ? `<span class="fc-path">${esc(folderPath(parentOf(f)))} /</span>` : ''}
              <span class="fc-name" dir="auto">${esc(f.name)}</span>
            </button>
            ${vocabUi.selectFolders
              ? `<input type="checkbox" data-toggle-f="${esc(f.id)}" ${picked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);cursor:pointer">`
              : `<button type="button" class="btn quiet sm" data-folder-menu="${esc(f.id)}" aria-label="Folder options">⋯</button>`}
          </div>
          <div class="mastery-bar" title="${st.mastered} mastered · ${st.due} due · ${st.fresh} new">
            <span class="mb-mastered" style="width:${pctM}%"></span>
            <span class="mb-due" style="width:${pctD}%"></span>
            <span class="mb-new" style="width:${pctN}%"></span>
          </div>
          <div class="fc-stats">
            <span>${plural(st.total, 'card')}</span>
            ${paused ? `<span class="badge-pill">Paused</span>` : (st.due + st.fresh) ? `<span class="badge-pill root">${st.due + st.fresh} due</span>` : `<span class="badge-pill good">Done</span>`}
            ${!vocabUi.selectFolders && st.total ? `<button type="button" class="btn quiet sm" style="margin-left:auto" data-go="${esc(studyHash([f.id], (st.due + st.fresh) && !paused ? 'review' : 'browse'))}">Study →</button>` : ''}
          </div>
        </li>`;
      }).join('')}
    </ul>` : `<div class="card" style="padding:32px;text-align:center">
      <p style="margin:0 0 8px;font:600 18px var(--en)">No saved words yet</p>
      <p class="muted" style="margin:0 0 18px;font:14px var(--ui)">Tap the bookmark icon next to any dictionary entry to save it to a folder, or create your first folder now.</p>
      <button type="button" class="btn primary" id="v-empty-new-folder">Create a folder</button>
    </div>`}

    ${vocabUi.selectFolders ? `<div class="select-dock">
      <span style="font:600 14px var(--ui)">${plural(pickedCount, 'folder')} selected</span>
      <div class="toolbar-row">
        <button type="button" class="btn sm" id="vs-browse" ${pickedCount ? '' : 'disabled'}>Browse</button>
        <button type="button" class="btn sm primary" id="vs-review" ${pickedCount ? '' : 'disabled'}>Review due</button>
      </div>
    </div>` : ''}
  `;

  $('#v-new-folder')?.addEventListener('click', () => newFolderSheet(null));
  $('#v-empty-new-folder')?.addEventListener('click', () => newFolderSheet(null));
  $('#v-select-folders')?.addEventListener('click', () => {
    vocabUi.selectFolders = !vocabUi.selectFolders;
    if (!vocabUi.selectFolders) vocabUi.pickedFolders.clear();
    renderVocabView();
  });
  $('#v-export-all')?.addEventListener('click', () => exportSheet(liveCards(), 'qamus-all'));
  $('#vs-browse')?.addEventListener('click', () => go(studyHash([...vocabUi.pickedFolders], 'browse')));
  $('#vs-review')?.addEventListener('click', () => go(studyHash([...vocabUi.pickedFolders], 'review')));
  main.querySelectorAll('[data-toggle-f]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const id = el.dataset.toggleF;
      if (vocabUi.pickedFolders.has(id)) vocabUi.pickedFolders.delete(id);
      else vocabUi.pickedFolders.add(id);
      renderVocabView();
    });
  });
  main.querySelectorAll('[data-folder-menu]').forEach(b => {
    b.addEventListener('click', () => folderActionsSheet(b.dataset.folderMenu));
  });
}

function renderFolderView(id) {
  const f = folderById(id);
  if (!f) {
    main.innerHTML = `<div class="card" style="padding:24px"><p class="muted">Folder not found.</p><button type="button" class="btn" data-go="vocab">Back to Vocab</button></div>`;
    return;
  }
  const subs = childrenOf(id);
  const direct = cardsIn(id).sort((a, b) => b.createdAt - a.createdAt);
  const deep = cardsDeep(id);
  const due = dueCount(deep);
  const paused = isPaused(id);
  const flt = vocabUi.filter.trim().toLowerCase();
  const fltAr = norm(flt);
  const shown = flt
    ? direct.filter(c => c.word.toLowerCase().includes(flt) || c.gloss.toLowerCase().includes(flt) || c.note.toLowerCase().includes(flt) || (fltAr && c.key.includes(fltAr)))
    : direct;

  main.innerHTML = `
    <div style="margin-bottom:8px">
      <button type="button" class="btn quiet sm" data-go="vocab">‹ All Folders</button>
    </div>
    <div class="page-header">
      <div>
        <h1 class="page-title" dir="auto">${esc(f.name)}</h1>
        <p class="page-sub">${plural(deep.length, 'card')}${paused ? ' · Reviews paused' : due ? ` · ${due} due today` : ' · All caught up'}</p>
      </div>
      <div class="toolbar-row">
        ${deep.length && !paused ? `<button type="button" class="btn primary" data-go="${esc(studyHash([id], 'review'))}">Review${due ? ` (${due})` : ''}</button>` : ''}
        ${deep.length ? `<button type="button" class="btn soft" data-go="${esc(studyHash([id], 'browse'))}">Browse</button>` : ''}
        <button type="button" class="btn" id="vf-add-card">+ Add card</button>
        <button type="button" class="btn quiet" id="vf-import">Import</button>
        ${deep.length ? `<button type="button" class="btn quiet" id="vf-export">Export</button>` : ''}
        <button type="button" class="btn quiet" id="vf-menu">⋯</button>
      </div>
    </div>

    ${subs.length ? `<div class="panel-head"><h2 class="panel-title">Sub-folders</h2></div>
      <ul class="folder-grid" style="margin-bottom:18px">${subs.map(sf => {
        const sc = cardsDeep(sf.id), sd = dueCount(sc);
        return `<li class="folder-card"><div class="fc-top">
          <button type="button" class="fc-open" data-go="folder=${esc(sf.id)}"><span class="fc-name" dir="auto">${esc(sf.name)}</span></button>
          <span class="badge-pill">${sc.length}</span>
        </div><div class="fc-stats">${sd ? `<span class="badge-pill root">${sd} due</span>` : '<span>Caught up</span>'}</div></li>`;
      }).join('')}</ul>` : ''}

    ${direct.length ? `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <input type="search" id="vf-filter" class="inp" value="${esc(vocabUi.filter)}" placeholder="Filter cards in ${esc(f.name)}…" style="max-width:360px">
        <button type="button" class="btn sm ${vocabUi.selectCards ? 'soft' : 'quiet'}" id="vf-select">${vocabUi.selectCards ? 'Done' : 'Select'}</button>
      </div>
      <ul class="vocab-card-list">
        ${shown.map(c => {
          const st = cardStatus(c);
          const picked = vocabUi.pickedCards.has(c.id);
          return `<li class="vcard-row${picked ? ' picked' : ''}">
            ${vocabUi.selectCards ? `<input type="checkbox" data-pick-c="${esc(c.id)}" ${picked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);cursor:pointer">` : ''}
            <button type="button" class="vc-word" data-open-card="${esc(c.id)}" lang="ar" title="Open in dictionary">${esc(c.word)}</button>
            <button type="button" class="vc-body" data-edit-card="${esc(c.id)}">
              <div class="vc-gloss">${esc(c.gloss || '(no meaning)')}</div>
              ${c.context ? `<div class="vc-ctx" lang="ar" dir="rtl">${esc(c.context)}</div>` : ''}
            </button>
            <span class="badge-pill ${st.k === 'due' || st.k === 'new' ? 'root' : st.k === 'later' ? 'good' : ''}">${esc(st.label)}</span>
          </li>`;
        }).join('')}
      </ul>` : `<div class="card" style="padding:28px;text-align:center"><p class="muted" style="margin:0 0 12px">This folder has no cards yet.</p><button type="button" class="btn primary" id="vf-add-empty">Add your first card</button></div>`}

    ${vocabUi.selectCards && vocabUi.pickedCards.size ? `<div class="select-dock">
      <span style="font:600 14px var(--ui)">${plural(vocabUi.pickedCards.size, 'card')} selected</span>
      <div class="toolbar-row">
        <button type="button" class="btn sm" id="vf-bulk-move">Move</button>
        <button type="button" class="btn sm danger" id="vf-bulk-del">Delete</button>
      </div>
    </div>` : ''}
  `;

  $('#vf-add-card')?.addEventListener('click', () => cardSheet({ mode: 'add', folder: id }));
  $('#vf-add-empty')?.addEventListener('click', () => cardSheet({ mode: 'add', folder: id }));
  $('#vf-menu')?.addEventListener('click', () => folderActionsSheet(id));
  $('#vf-export')?.addEventListener('click', () => exportSheet(deep, f.name));
  $('#vf-import')?.addEventListener('click', () => importSheet(id));
  $('#vf-filter')?.addEventListener('input', e => {
    vocabUi.filter = e.target.value;
    renderFolderView(id);
    const inp = $('#vf-filter');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  });
  $('#vf-select')?.addEventListener('click', () => {
    vocabUi.selectCards = !vocabUi.selectCards;
    if (!vocabUi.selectCards) vocabUi.pickedCards.clear();
    renderFolderView(id);
  });
  main.querySelectorAll('[data-pick-c]').forEach(cb => {
    cb.addEventListener('change', () => {
      const cid = cb.dataset.pickC;
      if (cb.checked) vocabUi.pickedCards.add(cid);
      else vocabUi.pickedCards.delete(cid);
      renderFolderView(id);
    });
  });
  main.querySelectorAll('[data-open-card]').forEach(b => {
    b.addEventListener('click', () => {
      const c = liveCards().find(x => x.id === b.dataset.openCard);
      if (c) openCardInDict(c);
    });
  });
  main.querySelectorAll('[data-edit-card]').forEach(b => {
    b.addEventListener('click', () => {
      const c = liveCards().find(x => x.id === b.dataset.editCard);
      if (c) cardSheet({ mode: 'edit', card: c });
    });
  });
  $('#vf-bulk-del')?.addEventListener('click', () => {
    const ids = [...vocabUi.pickedCards];
    deleteCards(ids);
    vocabUi.pickedCards.clear();
    vocabUi.selectCards = false;
    toast(`Deleted ${plural(ids.length, 'card')}`);
  });
  $('#vf-bulk-move')?.addEventListener('click', () => moveCardsSheet([...vocabUi.pickedCards], id));
}

function openCardInDict(c) {
  const r = c.ref || '';
  if (c.source === 'hw' && /^\d+$/.test(r) && state.byId.has(+r)) go({ e: r, q: c.word });
  else if (c.source === 'hw' && /^f\d+$/.test(r) && state.HW?.forms[+r.slice(1)]) go({ f: r.slice(1), q: c.word });
  else if (c.source === 'wikt' && /^\d+$/.test(r) && state.W?.entries[+r]) go({ w: r, q: c.word });
  else if ((c.source === 'lane' || c.source === 'mufradat' || c.source === 'mukhtar') && r.includes(':')) {
    go({ q: [...r.slice(0, r.lastIndexOf(':'))].join(' ') });
  } else {
    go({ q: c.word });
  }
}

// ==========================================================================
// 5. DISTRACTION-FREE STUDY MODE (with Undo!)
// ==========================================================================
function shuffled(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderStudyRoute(rawIds, rawMode) {
  const mode = rawMode === 'review' ? 'review' : 'browse';
  const ids = [...new Set(rawIds)].filter(id => folderById(id));
  if (!ids.length) {
    main.innerHTML = `<div class="card" style="padding:24px"><p class="muted">Those folders no longer exist.</p><button type="button" class="btn" data-go="vocab">Back to Vocab</button></div>`;
    return;
  }
  const key = ids.slice().sort().join(',') + '|' + mode;
  if (!study || study.key !== key) {
    const scope = new Set(ids.flatMap(id => [id, ...descendants(id)]));
    study = {
      ids, mode, key, scope,
      dir: 'ar',
      shuffle: false,
      onlyAgain: false,
      hideGot: false,
      deck: [],
      idx: 0,
      flipped: false,
      reviewed: new Set(),
      again: 0,
      done: false,
      undoStack: [], // NEW: undo support!
    };
    rebuildStudyDeck();
  }
  renderStudyView();
}

function studyScopeCards() {
  return liveCards()
    .filter(c => study.scope.has(cardFolder(c)))
    .sort((a, b) => a.createdAt - b.createdAt);
}

function rebuildStudyDeck() {
  if (study.mode === 'browse') {
    let list = studyScopeCards();
    if (study.onlyAgain) list = list.filter(c => vdoc().reviews[c.id]?.mark === MARK_AGAIN);
    if (study.hideGot) list = list.filter(c => vdoc().reviews[c.id]?.mark !== MARK_GOT);
    study.deck = (study.shuffle ? shuffled(list) : list).map(c => c.id);
    study.idx = 0;
    study.done = false;
  } else {
    const eod = endOfDay(Date.now());
    const cards = studyScopeCards().filter(c => !cardPaused(c));
    const due = cards.filter(c => vdoc().reviews[c.id]?.last && vdoc().reviews[c.id].due <= eod)
      .sort((a, b) => vdoc().reviews[a.id].due - vdoc().reviews[b.id].due);
    const fresh = cards.filter(c => !vdoc().reviews[c.id]?.last);
    const q = [...due, ...fresh].map(c => c.id);
    study.deck = study.shuffle ? shuffled(q) : q;
    study.idx = 0;
    study.reviewed = new Set();
    study.again = 0;
    study.done = !study.deck.length;
  }
  study.flipped = false;
}

function markContextHtml(c) {
  const t = c.context || '';
  const target = norm(c.highlight || c.word || '');
  if (!target) return esc(t);
  const skip = new RegExp(DIAC.source);
  const map = [];
  let flat = '';
  for (let i = 0; i < t.length; i++) {
    if (skip.test(t[i])) continue;
    flat += norm(t[i]) || t[i];
    map.push(i);
  }
  const at = flat.indexOf(target);
  if (at < 0) return esc(t);
  let end = map[at + target.length - 1] + 1;
  while (end < t.length && skip.test(t[end])) end++;
  return esc(t.slice(0, map[at])) + '<mark>' + esc(t.slice(map[at], end)) + '</mark>' + esc(t.slice(end));
}

function renderStudyView() {
  const title = study.ids.length > 1 ? `${study.ids.length} folders` : folderById(study.ids[0])?.name || 'Study';
  const backDest = study.ids.length > 1 ? 'vocab' : 'folder=' + study.ids[0];
  const total = study.deck.length;
  const pct = total ? Math.round(((study.done ? total : study.idx) / total) * 100) : 100;
  const card = !study.done && total ? liveCards().find(c => c.id === study.deck[study.idx]) : null;
  const prevRev = card ? vdoc().reviews[card.id] : null;

  let stageHtml = '';
  if (study.mode === 'review' && study.done) {
    const eodT = endOfDay(Date.now(), 1);
    const tomorrow = studyScopeCards().filter(c => {
      if (cardPaused(c)) return false;
      const r = vdoc().reviews[c.id];
      return !r?.last || r.due <= eodT;
    }).length;
    stageHtml = `<div class="card" style="padding:40px 26px;text-align:center">
      <div style="font:700 42px/1.4 var(--ar);color:var(--accent)">أحسنت</div>
      <h2 style="margin:6px 0 8px;font:600 24px var(--en)">${study.reviewed.size ? 'Session complete' : 'Nothing due today'}</h2>
      <p class="muted" style="margin:0 0 6px;font:14.5px var(--ui)">
        ${study.reviewed.size ? `${plural(study.reviewed.size, 'card')} reviewed${study.again ? ` · ${study.again} repeated` : ''}. ` : ''}
        <strong>${tomorrow}</strong> due tomorrow.
      </p>
      <div class="toolbar-row" style="justify-content:center;margin-top:20px">
        <button type="button" class="btn" data-go="${esc(backDest)}">Done</button>
        <button type="button" class="btn primary" data-go="${esc(studyHash(study.ids, 'browse'))}">Browse all cards</button>
      </div>
    </div>`;
  } else if (!card) {
    stageHtml = `<div class="card" style="padding:36px 24px;text-align:center"><p class="muted">No cards match the current filter.</p></div>`;
  } else {
    const lines = (card.gloss || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
    const front = study.dir === 'en'
      ? `<p class="fc-en-front">${lines.length ? lines.map(esc).join('<br>') : '(no meaning)'}</p>`
      // Arabic → English: the sentence you saved the word from is a hint on the front, with the word marked.
      // (Not on English → Arabic cards, where it would give the answer away.)
      : `<p class="fc-word" lang="ar">${esc(card.word)}</p>
         ${card.context?.trim()
           ? `<div class="fc-hint" lang="ar" dir="rtl">${markContextHtml(card)}</div>`
           : card.highlight && card.highlight.trim() !== card.word.trim() ? `<div class="muted" style="font:22px/1.6 var(--ar)">${esc(card.highlight)}</div>` : ''}`;

    stageHtml = `<div class="fc-stage">
      <div class="fc-card${study.flipped ? ' flipped' : ''}" id="fc-card" role="button" tabindex="0">
        <div class="fc-face fc-front">
          <div class="fc-meta">
            <span>${study.idx + 1} / ${total}</span>
            <span class="badge-pill">${esc(folderById(cardFolder(card))?.name || '')}</span>
          </div>
          <div class="fc-front-center">${front}</div>
          <div class="muted" style="text-align:center;font:12.5px var(--ui)">Tap card<span class="key-hint-kbd"> or press <kbd>Space</kbd></span> to reveal</div>
        </div>
        <div class="fc-face fc-back">
          <div class="fc-meta">
            <span>${study.idx + 1} / ${total}</span>
            <span class="badge-pill">${esc(folderById(cardFolder(card))?.name || '')}</span>
          </div>
          <p class="fc-back-word" lang="ar">${esc(card.word)}</p>
          ${card.arGloss ? `<p class="fc-argloss" lang="ar">${esc(card.arGloss)}</p>` : ''}
          ${lines.map(l => `<p class="fc-gloss">${esc(l)}</p>`).join('')}
          ${card.translit ? `<p class="muted" style="margin:0;font:italic 15px var(--en)">${esc(card.translit)}</p>` : ''}
          ${card.note ? `<p class="muted" style="margin:0;font:14px/1.5 var(--ui)">Note: ${esc(card.note)}</p>` : ''}
          ${card.context ? `<div class="fc-ctx-block" lang="ar" dir="rtl">${markContextHtml(card)}</div>` : ''}
          ${card.root ? `<div style="margin-top:auto;padding-top:8px"><button type="button" class="root-chip" data-q="${esc(card.root)}"><span>Root</span><span lang="ar">${esc(card.root)}</span></button></div>` : ''}
        </div>
      </div>
    </div>`;
  }

  let dockHtml = '';
  if (card) {
    if (study.mode === 'review') {
      if (!study.flipped) {
        dockHtml = `<div class="study-dock"><div class="study-dock-inner review single">
          <button type="button" class="grade-btn primary" id="st-flip">Show answer <small style="opacity:.85">Space</small></button>
        </div></div>`;
      } else {
        dockHtml = `<div class="study-dock"><div class="study-dock-inner review">
          ${['Again', 'Hard', 'Good', 'Easy'].map((lbl, g) => `<button type="button" class="grade-btn g${g}" data-grade="${g}">
            <span>${lbl}</span><small>${intervalLabel(prevRev, g)} · ${g + 1}</small>
          </button>`).join('')}
        </div></div>`;
      }
    } else {
      const m = vdoc().reviews[card.id]?.mark || 0;
      dockHtml = `<div class="study-dock"><div class="study-dock-inner browse">
        <button type="button" class="grade-btn" id="st-prev" ${study.idx > 0 ? '' : 'disabled'}>‹</button>
        <button type="button" class="grade-btn ${m === MARK_AGAIN ? 'g0' : ''}" id="st-again">Again</button>
        <button type="button" class="grade-btn ${m === MARK_GOT ? 'g2' : ''}" id="st-got">Got it</button>
        <button type="button" class="grade-btn" id="st-next" ${study.idx < total - 1 ? '' : 'disabled'}>›</button>
      </div></div>`;
    }
  }

  main.innerHTML = `<div class="study-wrap">
    <div class="study-top">
      <button type="button" class="btn quiet sm" data-go="${esc(backDest)}">‹ Exit</button>
      <strong style="font:600 17px var(--en)" dir="auto">${esc(title)}</strong>
      <div class="toolbar-row">
        ${study.undoStack.length ? `<button type="button" class="btn sm quiet" id="st-undo" title="Undo last grade (Z)">↩ Undo</button>` : ''}
        <button type="button" class="btn sm quiet" id="st-dir">${study.dir === 'ar' ? 'AR → EN' : 'EN → AR'}</button>
      </div>
    </div>

    <div class="study-progress-track"><div class="study-progress-fill" style="width:${pct}%"></div></div>

    <div class="study-pills">
      <div class="seg-ctrl" role="group" aria-label="Study mode">
        <button type="button" class="seg-btn" data-st-mode="review" aria-pressed="${study.mode === 'review'}">Review (SRS)</button>
        <button type="button" class="seg-btn" data-st-mode="browse" aria-pressed="${study.mode === 'browse'}">Browse</button>
      </div>
      <button type="button" class="btn sm pill ${study.shuffle ? 'soft' : ''}" id="st-shuffle">Shuffle</button>
      ${study.mode === 'browse' ? `
        <button type="button" class="btn sm pill ${study.onlyAgain ? 'soft' : ''}" id="st-only-again">Only “Again”</button>
        <button type="button" class="btn sm pill ${study.hideGot ? 'soft' : ''}" id="st-hide-got">Hide “Got it”</button>
      ` : ''}
    </div>

    ${stageHtml}
    ${dockHtml}
  </div>`;

  $('#fc-card')?.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    flipStudyCard();
  });
  $('#st-flip')?.addEventListener('click', flipStudyCard);
  $('#st-prev')?.addEventListener('click', () => moveStudy(-1));
  $('#st-next')?.addEventListener('click', () => moveStudy(1));
  $('#st-again')?.addEventListener('click', () => markStudyCard(MARK_AGAIN));
  $('#st-got')?.addEventListener('click', () => markStudyCard(MARK_GOT));
  $('#st-undo')?.addEventListener('click', undoStudyGrade);
  $('#st-dir')?.addEventListener('click', () => { study.dir = study.dir === 'ar' ? 'en' : 'ar'; study.flipped = false; renderStudyView(); });
  $('#st-shuffle')?.addEventListener('click', () => { study.shuffle = !study.shuffle; rebuildStudyDeck(); renderStudyView(); });
  $('#st-only-again')?.addEventListener('click', () => { study.onlyAgain = !study.onlyAgain; if (study.onlyAgain) study.hideGot = false; rebuildStudyDeck(); renderStudyView(); });
  $('#st-hide-got')?.addEventListener('click', () => { study.hideGot = !study.hideGot; if (study.hideGot) study.onlyAgain = false; rebuildStudyDeck(); renderStudyView(); });
  main.querySelectorAll('[data-st-mode]').forEach(b => {
    b.addEventListener('click', () => go(studyHash(study.ids, b.dataset.stMode)));
  });
  main.querySelectorAll('[data-grade]').forEach(b => {
    b.addEventListener('click', () => gradeStudyCard(+b.dataset.grade));
  });
}

function flipStudyCard() {
  if (!study || study.done || !study.deck.length) return;
  study.flipped = !study.flipped;
  const el = $('#fc-card');
  if (el) el.classList.toggle('flipped', study.flipped);
  // Swap dock smoothly without nuking the card element so 3D flip finishes cleanly!
  const dock = main.querySelector('.study-dock');
  if (dock && study.mode === 'review') {
    const card = liveCards().find(c => c.id === study.deck[study.idx]);
    const prevRev = card ? vdoc().reviews[card.id] : null;
    if (!study.flipped) {
      dock.innerHTML = `<div class="study-dock-inner review single"><button type="button" class="grade-btn primary" id="st-flip">Show answer <small>Space</small></button></div>`;
      $('#st-flip')?.addEventListener('click', flipStudyCard);
    } else {
      dock.innerHTML = `<div class="study-dock-inner review">${['Again', 'Hard', 'Good', 'Easy'].map((lbl, g) =>
        `<button type="button" class="grade-btn g${g}" data-grade="${g}"><span>${lbl}</span><small>${intervalLabel(prevRev, g)} · ${g + 1}</small></button>`).join('')}</div>`;
      dock.querySelectorAll('[data-grade]').forEach(b => b.addEventListener('click', () => gradeStudyCard(+b.dataset.grade)));
    }
  }
}

function moveStudy(d) {
  if (!study || study.mode !== 'browse') return;
  const n = study.idx + d;
  if (n < 0 || n >= study.deck.length) return;
  study.idx = n;
  study.flipped = false;
  renderStudyView();
}

function markStudyCard(kind) {
  if (!study || !study.deck.length) return;
  const id = study.deck[study.idx];
  const cur = vdoc().reviews[id]?.mark || 0;
  const next = cur === kind ? 0 : kind;
  Store.mutate(d => {
    const r = { ...(d.reviews[id] || {}), updatedAt: Date.now() };
    if (next) r.mark = next; else delete r.mark;
    d.reviews[id] = r;
  });
  if (next && study.idx < study.deck.length - 1) study.idx++;
  study.flipped = false;
  renderStudyView();
}

function gradeStudyCard(g) {
  if (!study || study.mode !== 'review' || study.done || !study.flipped) return;
  const id = study.deck[study.idx];
  const prevReview = vdoc().reviews[id] ? structuredClone(vdoc().reviews[id]) : null;
  study.undoStack.push({
    id,
    prevReview,
    deck: study.deck.slice(),
    idx: study.idx,
    again: study.again,
    wasReviewed: study.reviewed.has(id),
  });
  Store.mutate(d => { d.reviews[id] = schedule(d.reviews[id], g, Date.now()); });
  study.reviewed.add(id);
  if (g === 0) {
    study.again++;
    study.deck.splice(Math.min(study.deck.length, study.idx + 4), 0, id);
  }
  study.idx++;
  study.flipped = false;
  if (study.idx >= study.deck.length) study.done = true;
  renderStudyView();
}

function undoStudyGrade() {
  if (!study || !study.undoStack.length) return;
  const snap = study.undoStack.pop();
  Store.mutate(d => {
    if (snap.prevReview) d.reviews[snap.id] = snap.prevReview;
    else delete d.reviews[snap.id];
  });
  study.deck = snap.deck;
  study.idx = snap.idx;
  study.again = snap.again;
  if (!snap.wasReviewed) study.reviewed.delete(snap.id);
  study.done = false;
  study.flipped = true;
  toast('Undid last grade');
  renderStudyView();
}

// ==========================================================================
// 6. HISTORY VIEW
// ==========================================================================
let histConfirmClear = false;
function renderHistoryView() {
  const items = liveHistory();
  const paused = historyPaused();
  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Search History</h1>
        <p class="page-sub">${plural(items.length, 'recorded lookup')}</p>
      </div>
      <div class="toolbar-row">
        <label class="switch"><input type="checkbox" id="hist-pause" ${paused ? 'checked' : ''}><span class="track"></span>Pause recording</label>
        ${items.length && !histConfirmClear ? `<button type="button" class="btn danger-ghost" id="hist-clear-ask">Clear all</button>` : ''}
      </div>
    </div>

    ${histConfirmClear ? `<div class="card" style="padding:16px 20px;margin-bottom:14px;border-color:var(--danger)">
      <p style="margin:0 0 10px;font:500 14.5px var(--ui)">Clear all ${items.length} searches across your synced devices?</p>
      <div class="toolbar-row">
        <button type="button" class="btn danger sm" id="hist-clear-yes">Clear history</button>
        <button type="button" class="btn quiet sm" id="hist-clear-no">Cancel</button>
      </div>
    </div>` : ''}

    ${items.length ? `<div class="card"><div class="entry-list">
      ${items.map(h => `<div class="entry-row" style="padding:8px 16px;flex-direction:row;align-items:center;justify-content:space-between">
        <button type="button" class="fc-open" data-q="${esc(h.q)}" style="display:flex;align-items:baseline;gap:14px">
          <span ${qAttr(h.q)} style="font-size:${isAr(h.q) ? '24px' : '16px'};font-weight:600">${esc(h.q)}</span>
          <span class="muted" style="font:12.5px var(--ui)">${relTime(h.t)}</span>
        </button>
        <button type="button" class="btn quiet sm" data-del-q="${esc(h.q)}" aria-label="Remove">×</button>
      </div>`).join('')}
    </div></div>` : `<div class="card" style="padding:28px;text-align:center"><p class="muted" style="margin:0">No searches recorded yet.</p></div>`}
  `;

  $('#hist-pause')?.addEventListener('change', e => {
    Store.mutate(d => { d.settings = { ...d.settings, pauseHistory: e.target.checked, updatedAt: Date.now() }; });
  });
  $('#hist-clear-ask')?.addEventListener('click', () => { histConfirmClear = true; renderHistoryView(); });
  $('#hist-clear-no')?.addEventListener('click', () => { histConfirmClear = false; renderHistoryView(); });
  $('#hist-clear-yes')?.addEventListener('click', () => { histConfirmClear = false; clearHistory(); toast('History cleared'); });
  main.querySelectorAll('[data-del-q]').forEach(b => {
    b.addEventListener('click', () => deleteSearch(b.dataset.delQ));
  });
}

// ==========================================================================
// 7. APPEARANCE & SETTINGS STUDIO
// ==========================================================================
function renderSettingsView() {
  const pr = resultPrefs();
  const curTheme = getTheme();
  const curFont = getArFont();

  main.innerHTML = `
    <button type="button" class="set-back" id="set-back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Back to ${settingsBackLabel()}</span></button>
    <div class="page-header">
      <div>
        <h1 class="page-title">Settings & Appearance</h1>
        <p class="page-sub">Tune your reading canvas, Arabic typeface, text scale, and dictionary priority.</p>
      </div>
    </div>

    <div class="settings-stack">
      <section class="card settings-card">
        <h3>Reading Theme</h3>
        <p class="sub">Choose a surface comfortable for long Arabic reading sessions.</p>
        <div class="theme-swatches">
          <button type="button" class="swatch-btn" data-set-theme="paper" aria-pressed="${curTheme === 'paper'}">
            <span class="swatch-preview sw-paper" lang="ar">قاموس</span>
            <span>Paper Light</span>
          </button>
          <button type="button" class="swatch-btn" data-set-theme="sepia" aria-pressed="${curTheme === 'sepia'}">
            <span class="swatch-preview sw-sepia" lang="ar">قاموس</span>
            <span>Parchment Sepia</span>
          </button>
          <button type="button" class="swatch-btn" data-set-theme="night" aria-pressed="${curTheme === 'night'}">
            <span class="swatch-preview sw-night" lang="ar">قاموس</span>
            <span>Obsidian Night</span>
          </button>
        </div>
      </section>

      <section class="card settings-card">
        <h3>Arabic Typeface</h3>
        <p class="sub">Switch the Naskh script used for headwords, passages, and flashcards.</p>
        <div class="font-grid">
          ${AR_FONTS.map(f => `<button type="button" class="font-btn" data-set-font="${f.id}" aria-pressed="${curFont === f.id}">
            <span class="sample" lang="ar" style="font-family:'${f.name}',serif">${f.sample}</span>
            <span class="fname">${f.name} · ${f.desc}</span>
          </button>`).join('')}
        </div>
      </section>

      <section class="card settings-card">
        <h3>Text Size</h3>
        <p class="sub">Scale English and classical Arabic dictionaries independently (syncs with your account).</p>
        <div class="setting-row">
          <div>
            <div style="font:600 14.5px var(--ui)">English definitions</div>
            <div class="def-text" style="margin-top:2px">to write; to record, put down in writing <span class="ar">كَتَبَ</span></div>
          </div>
          <span class="stepper">
            <button type="button" data-step="en" data-d="-1" ${pr.size.en <= SIZE_MIN ? 'disabled' : ''}>A−</button>
            <output>${pr.size.en}%</output>
            <button type="button" data-step="en" data-d="1" ${pr.size.en >= SIZE_MAX ? 'disabled' : ''}>A+</button>
          </span>
        </div>
        <div class="setting-row">
          <div>
            <div style="font:600 14.5px var(--ui)">Arabic dictionaries</div>
            <div style="font:calc(22px * var(--t-ar))/1.7 var(--ar);margin-top:2px" lang="ar">الكِتَابُ في الأصلِ مَصدَرٌ ثُمَّ سُمِّيَ بِهِ المَكتُوبُ</div>
          </div>
          <span class="stepper">
            <button type="button" data-step="ar" data-d="-1" ${pr.size.ar <= SIZE_MIN ? 'disabled' : ''}>A−</button>
            <output>${pr.size.ar}%</output>
            <button type="button" data-step="ar" data-d="1" ${pr.size.ar >= SIZE_MAX ? 'disabled' : ''}>A+</button>
          </span>
        </div>
      </section>

      <section class="card settings-card">
        <h3>Dictionaries & Order</h3>
        <p class="sub">Toggle which lexicons appear and reorder their priority in “All Sources”.</p>
        ${pr.order.map((id, i) => {
          const d = DICTS.find(x => x.id === id);
          const on = !pr.off.has(id);
          return `<div class="setting-row">
            <label class="switch" style="flex:1">
              <input type="checkbox" data-dict-toggle="${id}" ${on ? 'checked' : ''}>
              <span class="track"></span>
              <span><strong>${esc(d.name)}</strong><br><span class="muted" style="font-size:12.5px">${esc(d.desc)}</span></span>
            </label>
            <div class="toolbar-row">
              <button type="button" class="btn quiet sm" data-dict-move="${id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
              <button type="button" class="btn quiet sm" data-dict-move="${id}" data-dir="1" ${i === pr.order.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
            </div>
          </div>`;
        }).join('')}
        <div class="setting-row">
          <label class="switch">
            <input type="checkbox" id="set-parse" ${pr.parse ? 'checked' : ''}>
            <span class="track"></span>
            <span><strong>Morphological Breakdown</strong><br><span class="muted" style="font-size:12.5px">Show prefix · stem · suffix pills in the result header</span></span>
          </label>
        </div>
        <div style="margin-top:14px">
          <button type="button" class="btn quiet sm" id="set-reset">Reset dictionary settings</button>
        </div>
      </section>

      <section class="card settings-card">
        <h3>Help</h3>
        <p class="sub">A short walk through searching, saving and studying.</p>
        <button type="button" class="btn" id="set-tour">Show the intro again</button>
      </section>
    </div>
  `;

  main.querySelectorAll('[data-set-theme]').forEach(b => {
    b.addEventListener('click', () => { applyTheme(b.dataset.setTheme); renderSettingsView(); });
  });
  main.querySelectorAll('[data-set-font]').forEach(b => {
    b.addEventListener('click', () => { applyArFont(b.dataset.setFont); renderSettingsView(); });
  });
  main.querySelectorAll('[data-step]').forEach(b => {
    b.addEventListener('click', () => {
      const k = b.dataset.step, d = +b.dataset.d;
      const size = { ...resultPrefs().size };
      size[k] = textSize(size[k] + d * SIZE_STEP);
      setResultPrefs({ size });
    });
  });
  main.querySelectorAll('[data-dict-toggle]').forEach(inp => {
    inp.addEventListener('change', () => {
      const off = new Set(resultPrefs().off);
      if (inp.checked) off.delete(inp.dataset.dictToggle);
      else off.add(inp.dataset.dictToggle);
      setResultPrefs({ off });
    });
  });
  main.querySelectorAll('[data-dict-move]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.dictMove, dir = +b.dataset.dir;
      const order = resultPrefs().order.slice();
      const i = order.indexOf(id);
      const j = i + dir;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      setResultPrefs({ order });
    });
  });
  $('#set-parse')?.addEventListener('change', e => setResultPrefs({ parse: e.target.checked }));
  $('#set-tour')?.addEventListener('click', () => runTour());
  $('#set-back')?.addEventListener('click', leaveSettings);
  $('#set-reset')?.addEventListener('click', () => {
    setResultPrefs({ order: DICT_IDS, off: new Set(), parse: true, size: { en: 100, ar: 100 } });
    toast('Dictionary settings reset');
  });
}

// ==========================================================================
// 8. SHEETS: Save to Folder, Card Edit/Add, Folder Actions, Export/Import, Account
// ==========================================================================
function openSheet({ title, body, onMount, onClose }) {
  if (openSheetApi) openSheetApi.close();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-head"><h2>${title}</h2><button type="button" class="sheet-x" aria-label="Close">×</button></div>
    <div>${body}</div>
  </div>`;
  const panel = wrap.firstElementChild;
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); api.close(); } };
  const api = {
    el: panel,
    close() {
      if (openSheetApi !== api) return;
      openSheetApi = null;
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      document.body.classList.remove('sheet-open');
      onClose?.();
    },
  };
  wrap.addEventListener('click', e => { if (e.target === wrap) api.close(); });
  panel.querySelector('.sheet-x').addEventListener('click', () => api.close());
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(wrap);
  document.body.classList.add('sheet-open');
  openSheetApi = api;
  onMount?.(panel, api);
  panel.querySelector('[autofocus]')?.focus();
  return api;
}

async function prefillFromPayload(p) {
  const f = { word: '', gloss: '', arGloss: '', root: '', translit: '', context: '', highlight: '', note: '', tags: [], source: p.s, ref: String(p.r ?? '') };
  const rootOf = rid => { const r = state.byId.get(rid); return r ? [...r[1]].join(' ') : ''; };
  if (p.s === 'hw' && /^f\d+$/.test(f.ref)) {
    const x = state.HW.forms[+f.ref.slice(1)];
    if (!hwHave([x[0]])) await loadHw([x[0]]);
    f.word = x[2]; f.gloss = shortGloss(x[3]); f.root = rootOf(x[0]);
  } else if (p.s === 'hw') {
    const e = state.byId.get(+f.ref);
    if (!hwHave([e[4]])) await loadHw([e[4]]);
    let d = plain(stripHead(e));
    if (e[6] && d.startsWith(e[6])) d = d.slice(e[6].length).trim();
    f.word = e[1]; f.gloss = shortGloss(d); f.root = rootOf(e[4]); f.translit = e[6] || '';
  } else if (p.s === 'wikt') {
    const e = state.W.entries[+f.ref];
    const m = e[2].match(/<li>([\s\S]*?)<\/li>/);
    const rs = wRoots(+f.ref);
    f.word = e[0]; f.translit = e[1] || ''; f.gloss = shortGloss(m ? m[1] : e[2]); f.root = rs.length ? rootOf(rs[0]) : '';
  } else if (p.s === 'lane') {
    const at = f.ref.lastIndexOf(':'), k = f.ref.slice(0, at), i = +f.ref.slice(at + 1);
    const items = await loadLaneEntries(k);
    const [w, def] = items[i];
    f.word = w; f.root = [...k].join(' ');
    f.gloss = shortGloss(def.startsWith(w) ? def.slice(w.length) : def);
  } else if (AR_DICTS[p.s]) {
    const at = f.ref.lastIndexOf(':'), { head, html } = await arEntry(p.s, f.ref);
    f.word = head; f.root = [...f.ref.slice(0, at)].join(' ');
    f.arGloss = shortGloss(plain(html.replace(/^<b>.*?<\/b>(:\s*|<br>)/, '')));
  } else if (p.s === 'lexicon') {
    f.word = p.w || ''; f.gloss = shortGloss(p.g || ''); f.root = p.root || '';
  } else if (p.s === 'custom') {
    f.word = p.w || ''; f.gloss = p.g || ''; f.translit = p.tr || ''; f.note = p.note || '';
  }
  // Smart enhancement: if the user searched an inflected form (e.g. يكتبون) different from headword, preserve it as highlight!
  if (lastSearchedRaw && isAr(lastSearchedRaw) && norm(lastSearchedRaw) !== norm(f.word)) {
    f.highlight = lastSearchedRaw;
  }
  return f;
}

function saveToFolderSheet(payload, word) {
  const key = payload.s + '|' + payload.r;
  const fieldsP = prefillFromPayload(payload).catch(() => ({ word, source: payload.s, ref: String(payload.r ?? '') }));
  const savedHere = id => (savedIndex().get(key) || []).filter(c => cardFolder(c) === id);
  const rows = tree();
  if (!rows.some(({ f }) => f.id === INBOX)) rows.unshift({ f: VIRTUAL_INBOX, depth: 0 });

  openSheet({
    title: 'Save to folder',
    body: `
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:10px">
        <span lang="ar" style="font:700 30px/1.4 var(--ar)">${esc(word)}</span>
        <span id="sf-gloss" class="muted" style="font:14px var(--en);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input id="sf-new-name" class="inp" placeholder="Or type a new folder name…" dir="auto">
        <button type="button" class="btn primary" id="sf-new-go">Create</button>
      </div>
      <ul class="pick-folder-list">
        ${rows.map(({ f, depth }) => {
          const on = savedHere(f.id).length > 0;
          return `<li><button type="button" class="pick-folder-btn" data-f="${esc(f.id)}" aria-pressed="${on}" style="padding-left:${14 + depth * 16}px">
            <span dir="auto">${esc(f.name)}</span>
            <span class="badge-pill ${on ? 'root' : ''}">${on ? 'Saved ✓' : cardsIn(f.id).length}</span>
          </button></li>`;
        }).join('')}
      </ul>
      <div style="margin-top:12px;text-align:right">
        <button type="button" class="btn quiet sm" id="sf-full-form">Add notes / context before saving…</button>
      </div>
    `,
    onMount(p, api) {
      fieldsP.then(f => { const g = p.querySelector('#sf-gloss'); if (g) g.textContent = f.gloss || f.arGloss || ''; });
      const commit = async (folderId, newName) => {
        const fields = await fieldsP;
        const id = addCard(fields, folderId, newName);
        const card = liveCards().find(c => c.id === id);
        api.close();
        toast(`Saved to <strong>${esc(folderPath(cardFolder(card || { folder: folderId })))}</strong>`, {
          label: 'Edit',
          run: () => { if (card) cardSheet({ mode: 'edit', card }); },
        });
      };
      p.querySelectorAll('[data-f]').forEach(btn => {
        btn.addEventListener('click', () => {
          const fid = btn.dataset.f;
          const here = savedHere(fid);
          if (!here.length) return commit(fid, null);
          deleteCards(here.map(c => c.id));
          api.close();
          toast(`Removed from <strong>${esc(folderPath(fid))}</strong>`);
        });
      });
      p.querySelector('#sf-new-go').addEventListener('click', () => {
        const n = p.querySelector('#sf-new-name').value.trim();
        if (!n) return p.querySelector('#sf-new-name').focus();
        commit(null, n);
      });
      p.querySelector('#sf-full-form').addEventListener('click', async () => {
        const fields = await fieldsP;
        api.close();
        cardSheet({ mode: 'save', fields });
      });
    },
  });
}

function folderSelectOptions(selected, exclude = new Set(), includeTop = false) {
  const rows = tree().filter(({ f }) => !exclude.has(f.id));
  if (!rows.some(({ f }) => f.id === INBOX) && !exclude.has(INBOX)) rows.unshift({ f: VIRTUAL_INBOX, depth: 0 });
  return (includeTop ? '<option value="">Top level</option>' : '') +
    rows.map(({ f, depth }) => `<option value="${esc(f.id)}" ${f.id === selected ? 'selected' : ''}>${'— '.repeat(depth)}${esc(f.name)}</option>`).join('');
}

function cardSheet({ mode, fields = {}, card = null, folder = null }) {
  const f = { word: '', gloss: '', arGloss: '', root: '', translit: '', context: '', highlight: '', note: '', tags: [], source: 'custom', ref: '', ...fields, ...(card || {}) };
  const startFolder = card ? cardFolder(card) : folder || lastFolder();
  const title = { save: 'Save card', add: 'Add card', edit: 'Edit card' }[mode];

  openSheet({
    title,
    body: `<form id="cs-form">
      <label class="lbl" for="cs-word">Arabic Word</label>
      <input id="cs-word" class="inp ar-inp" lang="ar" dir="rtl" value="${esc(f.word)}" required ${mode === 'add' ? 'autofocus' : ''}>

      <label class="lbl" for="cs-folder">Folder</label>
      <select id="cs-folder" class="inp">${folderSelectOptions(startFolder)}</select>

      <label class="lbl" for="cs-gloss">English Meaning</label>
      <textarea id="cs-gloss" class="inp" rows="2" dir="auto" ${mode === 'save' ? 'autofocus' : ''}>${esc(f.gloss)}</textarea>

      <label class="lbl" for="cs-context">
        <span>Context sentence <small>(optional)</small></span>
        <button type="button" class="btn quiet sm" id="cs-paste-ctx" style="min-height:24px;padding:0 8px">Paste clipboard</button>
      </label>
      <textarea id="cs-context" class="inp" rows="2" dir="auto" placeholder="Sentence or verse where you saw this word">${esc(f.context)}</textarea>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label class="lbl" for="cs-root">Root</label>
          <input id="cs-root" class="inp ar-inp" lang="ar" dir="rtl" value="${esc(f.root)}" placeholder="ك ت ب">
        </div>
        <div>
          <label class="lbl" for="cs-tr">Transliteration</label>
          <input id="cs-tr" class="inp" value="${esc(f.translit)}">
        </div>
      </div>

      <label class="lbl" for="cs-note">Personal Note <small>(optional)</small></label>
      <input id="cs-note" class="inp" dir="auto" value="${esc(f.note)}">

      <label class="lbl" for="cs-hl">Highlight phrase <small>(optional)</small></label>
      <input id="cs-hl" class="inp ar-inp" lang="ar" dir="rtl" value="${esc(f.highlight)}">

      <div class="toolbar-row" style="margin-top:18px;justify-content:space-between">
        <div class="toolbar-row">
          <button type="submit" class="btn primary">Save card</button>
          <button type="button" class="btn quiet" id="cs-cancel">Cancel</button>
        </div>
        ${mode === 'edit' ? `<button type="button" class="btn danger-ghost sm" id="cs-del">Delete</button>` : ''}
      </div>
    </form>`,
    onMount(p, api) {
      p.querySelector('#cs-cancel').addEventListener('click', () => api.close());
      p.querySelector('#cs-paste-ctx').addEventListener('click', async () => {
        try {
          const txt = await navigator.clipboard.readText();
          if (txt) p.querySelector('#cs-context').value = txt.trim();
        } catch { toast('Clipboard permission denied.'); }
      });
      p.querySelector('#cs-del')?.addEventListener('click', () => {
        deleteCards([card.id]);
        api.close();
        toast('Card deleted');
      });
      p.querySelector('#cs-form').addEventListener('submit', e => {
        e.preventDefault();
        const word = p.querySelector('#cs-word').value.trim();
        if (!word) return p.querySelector('#cs-word').focus();
        const vals = {
          word,
          gloss: p.querySelector('#cs-gloss').value,
          context: p.querySelector('#cs-context').value,
          root: p.querySelector('#cs-root').value,
          translit: p.querySelector('#cs-tr').value,
          note: p.querySelector('#cs-note').value,
          highlight: p.querySelector('#cs-hl').value,
          arGloss: f.arGloss,
          tags: f.tags,
          source: f.source,
          ref: f.ref,
        };
        const folderId = p.querySelector('#cs-folder').value;
        if (mode === 'edit') updateCard(card.id, { ...vals, folder: folderId });
        else addCard(vals, folderId);
        api.close();
        toast(mode === 'edit' ? 'Card updated' : `Saved to <strong>${esc(folderPath(folderId))}</strong>`);
      });
    },
  });
}

function newFolderSheet(parent) {
  openSheet({
    title: 'New folder',
    body: `<form id="nf-form">
      <label class="lbl" for="nf-name">Folder name</label>
      <input id="nf-name" class="inp" dir="auto" maxlength="100" required autofocus placeholder="e.g. Al-Mutanabbi Poems">
      <label class="lbl" for="nf-parent">Inside</label>
      <select id="nf-parent" class="inp">${folderSelectOptions(parent || '', new Set(), true)}</select>
      <div class="toolbar-row" style="margin-top:16px">
        <button type="submit" class="btn primary">Create folder</button>
        <button type="button" class="btn quiet" id="nf-x">Cancel</button>
      </div>
    </form>`,
    onMount(p, api) {
      p.querySelector('#nf-x').addEventListener('click', () => api.close());
      p.querySelector('#nf-form').addEventListener('submit', e => {
        e.preventDefault();
        const name = p.querySelector('#nf-name').value.trim();
        if (!name) return;
        createFolder(name, p.querySelector('#nf-parent').value || null);
        api.close();
        toast(`Created folder <strong>${esc(name)}</strong>`);
      });
    },
  });
}

function folderActionsSheet(id) {
  const f = folderById(id);
  if (!f) return;
  const paused = !!f.paused;
  openSheet({
    title: f.name,
    body: `
      <label class="lbl" for="fa-name">Rename folder</label>
      <div style="display:flex;gap:8px">
        <input id="fa-name" class="inp" value="${esc(f.name)}" dir="auto">
        <button type="button" class="btn" id="fa-ren">Save</button>
      </div>
      <div class="toolbar-row" style="margin-top:16px">
        <button type="button" class="btn" id="fa-sub">+ Sub-folder</button>
        <button type="button" class="btn" id="fa-pause">${paused ? 'Resume reviews' : 'Pause reviews'}</button>
        ${id !== INBOX ? `<button type="button" class="btn danger-ghost" id="fa-del">Delete folder</button>` : ''}
      </div>
      <div id="fa-del-box" hidden style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
        <p style="margin:0 0 10px;font:14px var(--ui)">What should happen to cards inside “${esc(f.name)}”?</p>
        <div class="toolbar-row">
          <button type="button" class="btn sm" id="fa-del-inbox">Move cards to Inbox</button>
          <button type="button" class="btn sm danger" id="fa-del-all">Delete cards too</button>
        </div>
      </div>
    `,
    onMount(p, api) {
      p.querySelector('#fa-ren').addEventListener('click', () => {
        const name = p.querySelector('#fa-name').value.trim();
        if (!name) return;
        renameFolder(id, name);
        api.close();
        toast('Folder renamed');
      });
      p.querySelector('#fa-sub').addEventListener('click', () => { api.close(); newFolderSheet(id); });
      p.querySelector('#fa-pause').addEventListener('click', () => {
        setFolderPaused(id, !paused);
        api.close();
        toast(!paused ? `Paused ${esc(f.name)}` : `Resumed ${esc(f.name)}`);
      });
      p.querySelector('#fa-del')?.addEventListener('click', () => { p.querySelector('#fa-del-box').hidden = false; });
      p.querySelector('#fa-del-inbox')?.addEventListener('click', () => { deleteFolder(id, 'inbox'); api.close(); go('vocab'); });
      p.querySelector('#fa-del-all')?.addEventListener('click', () => { deleteFolder(id, 'delete'); api.close(); go('vocab'); });
    },
  });
}

function moveCardsSheet(ids, from) {
  openSheet({
    title: `Move ${plural(ids.length, 'card')}`,
    body: `<label class="lbl" for="mc-f">Destination folder</label>
      <select id="mc-f" class="inp">${folderSelectOptions(from === INBOX ? '' : INBOX)}</select>
      <div class="toolbar-row" style="margin-top:16px">
        <button type="button" class="btn primary" id="mc-go">Move</button>
      </div>`,
    onMount(p, api) {
      p.querySelector('#mc-go').addEventListener('click', () => {
        moveCards(ids, p.querySelector('#mc-f').value);
        vocabUi.pickedCards.clear();
        vocabUi.selectCards = false;
        api.close();
        toast(`Moved ${plural(ids.length, 'card')}`);
      });
    },
  });
}

function downloadBlob(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function exportSheet(cards, baseName) {
  const safe = baseName.replace(/[^\w\u0600-\u06FF-]+/g, '-').toLowerCase() || 'qamus';
  openSheet({
    title: `Export ${plural(cards.length, 'card')}`,
    body: `<p class="muted" style="margin:0 0 14px;font:14px var(--ui)">Download your vocabulary for Anki (CSV) or full backup (JSON).</p>
      <div class="toolbar-row">
        <button type="button" class="btn primary" id="ex-csv">Download CSV (Anki)</button>
        <button type="button" class="btn" id="ex-json">Download JSON</button>
      </div>`,
    onMount(p, api) {
      p.querySelector('#ex-csv').addEventListener('click', () => {
        const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [CSV_FIELDS.join(','), ...cards.map(c => CSV_FIELDS.map(k => cell(k === 'tags' ? (c.tags || []).join(' ') : c[k])).join(','))];
        downloadBlob(`${safe}.csv`, 'text/csv;charset=utf-8', '\uFEFF' + rows.join('\n'));
        api.close();
      });
      p.querySelector('#ex-json').addEventListener('click', () => {
        downloadBlob(`${safe}.json`, 'application/json;charset=utf-8', JSON.stringify(cards, null, 2));
        api.close();
      });
    },
  });
}

function importSheet(folderId) {
  openSheet({
    title: 'Import cards',
    body: `<p class="muted" style="margin:0 0 12px;font:14px var(--ui)">Import a JSON array of cards or a CSV/TSV file with <code>word</code> and <code>gloss</code> columns.</p>
      <input type="file" id="imp-file" accept=".json,.csv,.tsv,.txt" class="inp">
      <p id="imp-status" class="muted" style="font:13.5px var(--ui);margin-top:10px"></p>
      <div class="toolbar-row" style="margin-top:14px">
        <button type="button" class="btn primary" id="imp-go" disabled>Import</button>
      </div>`,
    onMount(p, api) {
      let parsed = [];
      p.querySelector('#imp-file').addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const txt = await file.text();
        try {
          if (file.name.endsWith('.json')) {
            const j = JSON.parse(txt);
            parsed = (Array.isArray(j) ? j : j.cards || []).filter(x => x && x.word);
          } else {
            const lines = txt.split(/\r?\n/).filter(Boolean);
            const sep = lines[0].includes('\t') ? '\t' : ',';
            const rows = lines.map(l => l.split(sep).map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim()));
            const hasHeader = /^word$/i.test(rows[0][0]);
            const body = hasHeader ? rows.slice(1) : rows;
            parsed = body.filter(r => r[0]).map(r => ({ word: r[0], gloss: r[1] || '', arGloss: r[2] || '', root: r[3] || '', translit: r[4] || '', context: r[5] || '', note: r[6] || '' }));
          }
          p.querySelector('#imp-status').textContent = `Ready to import ${plural(parsed.length, 'card')}.`;
          p.querySelector('#imp-go').disabled = !parsed.length;
        } catch {
          p.querySelector('#imp-status').textContent = 'Could not parse that file.';
        }
      });
      p.querySelector('#imp-go').addEventListener('click', () => {
        parsed.forEach(item => addCard(item, folderId));
        api.close();
        toast(`Imported ${plural(parsed.length, 'card')}`);
      });
    },
  });
}

const NAME_WORDS = ['qalam', 'noor', 'sahab', 'kitab', 'bayt', 'qamar', 'shams', 'najm', 'bahr', 'jabal', 'ward', 'nakhl',
  'reeh', 'matar', 'nahr', 'sabr', 'fajr', 'layl', 'hilal', 'dalil', 'rihla', 'hikma', 'midad', 'safar', 'zaytun', 'diwan', 'manar', 'ufuq'];
function randName() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return NAME_WORDS[a[0] % NAME_WORDS.length] + '-' + (1000 + (a[1] % 9000));
}
const easyName = n => n.length < 8 || !/\d/.test(n) || /^(test|admin|user|qamus|hello|abc|guest)/.test(n);
const statusLabel = st => ({
  synced: st.lastSync ? `Synced ${relTime(st.lastSync)}` : 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline — changes are saved on this device and will sync when you reconnect.',
  error: 'Sync problem: ' + (st.error || 'unknown error'),
  local: 'Not syncing',
}[st.status] || st.status);

function loginSheet({ onClose } = {}) {
  openSheet({
    onClose,
    title: 'Choose a username to sync across devices',
    body: `<p class="muted" style="margin:0 0 12px;font:14px/1.55 var(--ui)">Your username is your key: there’s no password, so anyone who types it sees your words. Keep the suggestion below or pick your own with digits, and use it on your other devices.</p>
      <label class="lbl" for="lg-name">Username</label>
      <div style="display:flex;gap:8px">
        <input id="lg-name" class="inp" value="${randName()}" style="font-family:var(--mono);font-weight:600" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="40" enterkeyhint="go" autofocus>
        <button type="button" class="btn" id="lg-regen" aria-label="Suggest another username" title="Suggest another">↻</button>
        <button type="button" class="btn" id="lg-copy" aria-label="Copy username" title="Copy">Copy</button>
      </div>
      <p class="key-hint" id="lg-hint" aria-live="polite"></p>
      <p class="form-msg" id="lg-msg" role="status" aria-live="polite"></p>
      <div class="toolbar-row" id="lg-actions" style="margin-top:14px"></div>`,
    onMount(p, api) {
      const inp = p.querySelector('#lg-name'), msg = p.querySelector('#lg-msg'), acts = p.querySelector('#lg-actions'), hint = p.querySelector('#lg-hint');
      let checked = null, busy = false;
      const say = (html, err) => { msg.innerHTML = html; msg.classList.toggle('err', !!err); };
      const buttons = list => {
        acts.innerHTML = list.map(([id, label, cls]) => `<button type="button" class="btn ${cls || ''}" id="${id}">${label}</button>`).join('');
      };
      const idle = () => { checked = null; buttons([['lg-go', 'Continue', 'primary'], ['lg-skip', 'Use without syncing', 'quiet']]); };
      const confirmState = (name, kind) => {
        checked = name;
        say(kind === 'existing'
          ? `Welcome back — data on this device will be merged into <strong>${esc(name)}</strong>.`
          : `New account — nothing is saved under <strong>${esc(name)}</strong> yet.`);
        buttons([['lg-confirm', kind === 'existing' ? 'Sign in' : 'Create account', 'primary'], ['lg-change', 'Change name', 'quiet']]);
        p.querySelector('#lg-confirm')?.focus();
      };
      const checkName = async () => {
        if (busy) return;
        const name = QM.normUsername(inp.value);
        if (!name) { say('Use 3–32 characters: letters a–z, digits, “-” or “_”.', true); inp.focus(); return; }
        inp.value = name;
        busy = true; say('Checking…');
        acts.querySelectorAll('button').forEach(b => { b.disabled = true; });
        const kind = await Sync.check(name);
        busy = false;
        if (kind === 'existing' || kind === 'new') return confirmState(name, kind);
        idle();
        if (kind === 'invalid') say('Use 3–32 characters: letters a–z, digits, “-” or “_”.', true);
        else { say('Can’t reach the sync server. Check your connection and try again.', true); p.querySelector('#lg-go').textContent = 'Retry'; }
      };
      const showHint = () => {
        const n = QM.normUsername(inp.value);
        hint.className = 'key-hint' + (n && easyName(n) ? ' weak' : '');
        hint.textContent = !n ? '' : easyName(n) ? 'Easy to guess. Add a few digits, like ' + randName() + '.' : 'Looks unique.';
      };
      acts.addEventListener('click', e => {
        const id = e.target.closest('button')?.id;
        if (id === 'lg-go') checkName();
        else if (id === 'lg-skip') { lsSet('qamus.syncSkipped', '1'); api.close(); }
        else if (id === 'lg-change') { idle(); say(''); inp.focus(); inp.select(); }
        else if (id === 'lg-confirm' && checked) { Sync.signIn(checked); api.close(); toast(`Signed in as <strong>${esc(checked)}</strong>`); }
      });
      inp.addEventListener('input', () => { showHint(); if (checked) { idle(); say(''); } });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checked ? p.querySelector('#lg-confirm')?.click() : checkName(); } });
      p.querySelector('#lg-regen').addEventListener('click', () => { inp.value = randName(); inp.dispatchEvent(new Event('input')); inp.focus(); });
      p.querySelector('#lg-copy').addEventListener('click', () => copyText(inp.value.trim(), 'Username copied'));
      showHint();
      idle();
      inp.select();
    },
  });
}

function accountSheet({ onClose } = {}) {
  const st = Sync?.state || { user: null, status: 'local' };
  if (!SYNC_URL || !Sync) {
    openSheet({
      onClose,
      title: 'Local Storage',
      body: `<p style="font:14.5px/1.6 var(--ui)">Sync is disabled in this environment. Your folders, cards, and history are stored locally in IndexedDB.</p>`,
    });
    return;
  }
  if (!st.user) return loginSheet({ onClose });

  let off = null;
  openSheet({
    title: 'Sync Account',
    body: `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="muted" style="font:14px var(--ui)">Signed in as</span>
        <code style="padding:4px 10px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border);font:600 15px var(--mono)">${esc(st.user)}</code>
        <button type="button" class="btn quiet sm" id="ac-copy">Copy</button>
      </div>
      <p class="muted" style="font:13.5px/1.5 var(--ui);margin:8px 0 0">Use this same username on your iPad or phone to keep your words synced.</p>
      <p class="form-msg" id="ac-status" role="status" aria-live="polite"></p>
      <div class="toolbar-row" id="ac-main" style="margin-top:16px">
        <button type="button" class="btn primary" id="ac-sync">Sync now</button>
        <button type="button" class="btn" id="ac-hist">Search history</button>
        <button type="button" class="btn danger-ghost" id="ac-out">Sign out</button>
      </div>
      <div class="confirm-box" id="ac-confirm" hidden>
        <p id="ac-q" style="margin:0;font:14px/1.5 var(--ui)"></p>
        <button type="button" class="btn danger" id="ac-clear">Sign out and remove data from this device</button>
        <button type="button" class="btn" id="ac-keep">Sign out, keep data here</button>
        <button type="button" class="btn quiet" id="ac-cancel">Cancel</button>
      </div>`,
    onMount(p, api) {
      const stEl = p.querySelector('#ac-status'), conf = p.querySelector('#ac-confirm'), q = p.querySelector('#ac-q');
      const show = s => {
        stEl.textContent = statusLabel(s) + (s.dirty && s.status !== 'syncing' ? ' · Unsynced changes on this device.' : '');
        stEl.classList.toggle('err', s.status === 'error');
        p.querySelector('#ac-sync').disabled = s.status === 'syncing';
      };
      show(st);
      off = Sync.on('status', show);
      let force = false;
      const ask = (html, clearLabel) => {
        q.innerHTML = html;
        p.querySelector('#ac-clear').textContent = clearLabel;
        conf.hidden = false;
        p.querySelector('#ac-main').hidden = true;
      };
      const doOut = async keepData => {
        conf.querySelectorAll('button').forEach(b => { b.disabled = true; });
        q.textContent = 'Signing out…';
        const r = await Sync.signOut({ keepData, force });
        conf.querySelectorAll('button').forEach(b => { b.disabled = false; });
        if (!r.done) {
          force = true;
          return ask('<strong>Your latest changes couldn’t be synced.</strong> Removing data now will lose them. Keep it on this device instead, or remove it anyway?', 'Remove anyway');
        }
        api.close();
        toast(keepData ? 'Signed out (local data kept)' : 'Signed out');
      };
      p.addEventListener('click', e => {
        const id = e.target.closest('button')?.id;
        if (id === 'ac-sync') Sync.syncNow();
        else if (id === 'ac-copy') copyText(st.user, 'Username copied');
        else if (id === 'ac-hist') { api.close(); go('history'); }
        else if (id === 'ac-out') {
          const s = Sync.state;
          ask((s.dirty ? '<strong>Some changes haven’t synced yet</strong>; they’ll be sent first. ' : '') +
            'Remove your words and history from this device? They stay in your account.', 'Sign out and remove data from this device');
        }
        else if (id === 'ac-cancel') { conf.hidden = true; force = false; p.querySelector('#ac-main').hidden = false; }
        else if (id === 'ac-clear') doOut(false);
        else if (id === 'ac-keep') doOut(true);
      });
    },
    onClose() { off?.(); onClose?.(); },
  });
}

function updateSyncUi(st) {
  const status = st?.user ? st.status : 'local';
  for (const id of ['rail-sync-dot', 'mobile-sync-dot']) {
    const d = document.getElementById(id);
    if (d) d.className = 'sync-dot ' + status;
  }
  const name = $('#rail-acct-name');
  if (name) name.textContent = st?.user ? `${st.user} · ${st.status}` : (SYNC_URL ? 'Sign in to sync' : 'Local only');
}

// ==========================================================================
// 9. AUTOCOMPLETE & GLOBAL EVENTS
// ==========================================================================
let sugTimer = 0, blurTimer = 0;

function renderSuggest() {
  const q = qEl.value;
  clearBtn.hidden = !q;
  suggestItems = suggestions(q);
  suggestIdx = -1;
  if (!suggestItems.length || document.activeElement !== qEl) {
    sugEl.hidden = true;
    return;
  }
  sugEl.innerHTML = suggestItems.map((r, i) => {
    const isRoot = r[2] === 'h' && state.HW && state.byId.get(+r[3])?.[3];
    const badge = r[2] === 'p' ? `<span class="badge-pill gold">particle</span>`
      : r[2] === 'f' ? `<span class="badge-pill">Form ${state.HW.forms[+r[3]][1]}</span>`
      : isRoot ? `<span class="badge-pill root">root</span>`
      : r[2] === 'w' ? `<span class="badge-pill">wikt</span>`
      : r[2] === 'l' ? `<span class="badge-pill gold">lane</span>`
      : r[2] === 'b' ? `<span class="badge-pill">lex</span>` : '';
    const gl = glossFor(r, () => { if (!sugEl.hidden) renderSuggest(); });
    return `<li role="option" data-si="${i}"><span class="sw" lang="ar">${esc(r[1])}</span><span class="sg">${esc(gl)}</span>${badge}</li>`;
  }).join('');
  sugEl.hidden = false;
}

function pickSuggestion(r) {
  sugEl.hidden = true;
  qEl.blur();
  if (r[2] === 'h') go({ e: r[3], q: r[1] });
  else if (r[2] === 'f') go({ f: r[3], q: r[1] });
  else if (r[2] === 'w') go({ w: r[3], q: r[1] });
  else go({ q: r[1] });
}

qEl.addEventListener('input', () => { clearTimeout(blurTimer); clearTimeout(sugTimer); sugTimer = setTimeout(renderSuggest, 50); });
qEl.addEventListener('focus', () => { clearTimeout(blurTimer); renderSuggest(); });
qEl.addEventListener('blur', () => { clearTimeout(blurTimer); blurTimer = setTimeout(() => { sugEl.hidden = true; }, 140); });
qEl.addEventListener('keydown', e => {
  const lis = sugEl.querySelectorAll('li');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!lis.length) return;
    e.preventDefault();
    suggestIdx = (suggestIdx + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % lis.length;
    lis.forEach((li, i) => li.classList.toggle('on', i === suggestIdx));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (suggestIdx >= 0 && suggestItems[suggestIdx]) pickSuggestion(suggestItems[suggestIdx]);
    else {
      sugEl.hidden = true;
      qEl.blur();
      const val = qEl.value.trim();
      go(val ? { q: val } : '');
    }
  } else if (e.key === 'Escape') {
    sugEl.hidden = true;
    qEl.blur();
  }
});
sugEl.addEventListener('pointerdown', e => {
  const li = e.target.closest('li');
  if (li) { e.preventDefault(); pickSuggestion(suggestItems[+li.dataset.si]); }
});
clearBtn.addEventListener('click', () => { qEl.value = ''; clearBtn.hidden = true; qEl.focus(); renderSuggest(); });

// Global delegated clicks
document.addEventListener('click', e => {
  const navTab = e.target.closest('[data-nav-tab]');
  if (navTab) {
    const t = navTab.dataset.navTab;
    if (t === 'settings' && curView === 'settings') { leaveSettings(); return; }   // the gear toggles Settings
    if (t === 'search') {
      if (curView === 'home') { qEl.focus(); qEl.select(); }
      else go('');
    } else go(t);
    return;
  }
  const navHome = e.target.closest('[data-nav]');
  if (navHome) { e.preventDefault(); go(navHome.dataset.nav); return; }

  const goBtn = e.target.closest('[data-go]');
  if (goBtn) { go(goBtn.dataset.go); return; }

  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) { e.stopPropagation(); copyText(copyBtn.dataset.copy, 'Word copied'); return; }

  const bm = e.target.closest('.bm-btn[data-save]');
  if (bm) {
    e.stopPropagation();
    try { saveToFolderSheet(JSON.parse(bm.dataset.save), bm.dataset.word); } catch {}
    return;
  }

  if (e.target.closest('#home-focus-search')) { qEl.focus(); qEl.select(); return; }

  const pickEl = e.target.closest('[data-pick]');
  if (pickEl) { pickSuggestion(JSON.parse(pickEl.dataset.pick)); return; }

  const eEl = e.target.closest('[data-e]');
  if (eEl) { go({ e: eEl.dataset.e, q: state.byId.get(+eEl.dataset.e)?.[1] || '' }); return; }

  const qLink = e.target.closest('[data-q]');
  if (qLink) {
    const val = qLink.dataset.q;
    qEl.value = val;
    go({ q: val });
  }
});

// Lazy-load Lane / Arabic details when opened
main.addEventListener('toggle', e => {
  if (!e.target.open) return;
  if (e.target.matches('details.lane-details')) fillLaneCard(e.target);
  else if (e.target.matches('details.ar-details')) fillArCard(e.target);
}, true);

// Theme cycle & Account buttons
function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
  applyTheme(next);
  toast(`Theme: ${THEME_LABELS[next]}`);
  if (curView === 'settings') renderSettingsView();
}
$('#theme-cycle')?.addEventListener('click', cycleTheme);
$('#rail-acct')?.addEventListener('click', accountSheet);
$('#mobile-acct')?.addEventListener('click', accountSheet);

// Keep search placeholder clean on narrow phone viewports
const compactMq = matchMedia('(max-width: 540px)');
const syncPlaceholder = () => {
  qEl.placeholder = compactMq.matches ? 'Search Qamus…' : 'Search Arabic, root (ك ت ب), or English';
};
syncPlaceholder();
compactMq.addEventListener('change', syncPlaceholder);

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (openSheetApi || e.defaultPrevented) return;
  const typing = e.target.matches?.('input, textarea, select, [contenteditable="true"]');

  if ((e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault();
    qEl.focus();
    qEl.select();
    return;
  }

  if (curView === 'study' && study && !typing) {
    if (e.key === ' ') { e.preventDefault(); flipStudyCard(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveStudy(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); moveStudy(-1); }
    else if (e.key.toLowerCase() === 'z') { e.preventDefault(); undoStudyGrade(); }
    else if (study.mode === 'review' && /^[1-4]$/.test(e.key)) gradeStudyCard(+e.key - 1);
    else if (study.mode === 'browse' && e.key === '1') markStudyCard(MARK_AGAIN);
    else if (study.mode === 'browse' && e.key === '2') markStudyCard(MARK_GOT);
    else if (e.key === 'Escape') go(study.ids.length > 1 ? 'vocab' : 'folder=' + study.ids[0]);
    return;
  }

  if (e.key === 'Escape' && !typing) {
    if (curView === 'folder') go('vocab');
    else if (curView === 'settings') leaveSettings();
  }
});

// Touch swipe left/right on flashcard stage in Browse mode
let stSwipe = null;
main.addEventListener('pointerdown', e => {
  if (curView !== 'study' || !e.target.closest('.fc-stage')) return;
  stSwipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
main.addEventListener('pointerup', e => {
  if (!stSwipe || e.pointerId !== stSwipe.id) return;
  const dx = e.clientX - stSwipe.x, dy = e.clientY - stSwipe.y;
  stSwipe = null;
  if (!study || study.mode !== 'browse' || Math.abs(dx) <= 60 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
  moveStudy(dx < 0 ? 1 : -1);
});
main.addEventListener('pointercancel', () => { stSwipe = null; });

window.addEventListener('hashchange', route);

// One-time migration of legacy localStorage `hist` into synced Store.doc.history
function migrateLegacyHist() {
  let raw = null;
  try { raw = localStorage.getItem('hist'); } catch { return; }
  if (raw === null) return;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      const have = new Set(Store.doc.history.map(h => h.q));
      const add = [...new Set(arr.filter(x => typeof x === 'string').map(cleanQ))].filter(q => q && !have.has(q));
      if (add.length) {
        const now = Date.now();
        Store.mutate(d => { d.history = [...d.history, ...add.map((q, i) => ({ q, t: now - (i + 1) * 1000 }))]; });
      }
    }
    if (Store.persistent) localStorage.removeItem('hist');
  } catch {}
}

// Service worker registration + live update banner
const hadSW = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  const b = document.createElement('div');
  b.id = 'update-banner';
  b.className = 'update-banner';
  b.setAttribute('role', 'status');
  b.innerHTML = `<span>Qamus was updated.</span>
    <button type="button" class="btn primary sm" id="ub-reload">Reload</button>
    <button type="button" class="btn quiet sm" id="ub-x" aria-label="Dismiss">×</button>`;
  b.querySelector('#ub-reload').addEventListener('click', () => location.reload());
  b.querySelector('#ub-x').addEventListener('click', () => b.remove());
  document.body.appendChild(b);
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadSW) showUpdateBanner(); });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ==========================================================================
// 10. BOOTSTRAP
// ==========================================================================
onEngineUpdate(stage => {
  document.documentElement.dataset.engineStage = stage;
  if (stage === 'index') {
    loadPill.hidden = false;
    loadPill.textContent = 'Indexing…';
  } else if (stage === 'hw') {
    loadPill.textContent = 'Morphology…';
    if (curView === 'result' || curView === 'boot') route();
  } else if (stage === 'morph') {
    loadPill.textContent = 'Wiktionary…';
    if (curView === 'result' && window.scrollY < 100) route();
  } else if (stage === 'full') {
    loadPill.hidden = true;
    if (curView === 'result' && main.textContent.includes('No exact match')) route();
  }
});

// ---------- First-visit tour (tour.js) ----------
const tourCtx = {
  lsGet, lsSet,
  oldHome: OLD_HOME,
  used: () => !!(liveHistory().length || liveCards().length || (SYNC_URL && Sync?.state.user)),
  sync: !!(SYNC_URL && Sync),
  go,
  view: () => curView,
  intervalLabel,
};
function runTour() {
  startTour(tourCtx, { onDone: ({ signIn }) => { if (signIn && !Sync?.state.user) loginSheet(); } });
}

async function boot() {
  await Store.init();
  migrateLegacyHist();
  applyTextSizes();
  Store.on('change', () => {
    applyTextSizes();
    renderRail();
    updateNavChrome(curView === 'folder' || curView === 'study' ? 'vocab' : curView === 'home' || curView === 'result' ? 'search' : curView);
    if (curView === 'home') renderHomeView();
    else if (curView === 'vocab') renderVocabView();
    else if (curView === 'folder') renderFolderView(vocabUi.folderId);
    else if (curView === 'history') renderHistoryView();
    else if (curView === 'settings') renderSettingsView();
    else if (curView === 'result') syncBookmarkStates(main);
  });

  if (SYNC_URL && Sync) {
    Sync.on('status', st => {
      updateSyncUi(st);
      if (curView === 'home') renderHomeView();
    });
    Sync.init({ url: SYNC_URL, quietDelay: window.QAMUS_TEST_QUIET_DELAY });
    updateSyncUi(Sync.state);
  } else {
    updateSyncUi(null);
  }

  route();
  if (shouldTour(tourCtx)) runTour();

  initEngine().catch(err => {
    loadPill.hidden = true;
    main.innerHTML = `<div class="card" style="padding:24px">
      <h2 style="margin:0 0 8px">Could not load dictionary data</h2>
      <p class="muted" style="margin:0;font:14px var(--ui)">${esc(err.message)}. Serve the project root with <code>node tests/serve.js 8000</code>.</p>
    </div>`;
  });
}

boot();
