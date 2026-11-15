'use strict';
// ---------- normalization (must match build.py norm()) ----------
const DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const HAMZA = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ء': 'ا', 'ؤ': 'ا', 'ئ': 'ا', 'ى': 'ي', 'ة': 'ه', 'ک': 'ك', 'ی': 'ي' };
const norm = s => s.replace(DIAC, '').replace(/[أإآٱءؤئىةکی]/g, c => HAMZA[c]).trim();
const isAr = s => /[؀-ۿ]/.test(s);
const latin = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’‘ʿʾ'`\-\s]/g, '').replace(/ḡ|ğ/g, 'g');
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- state ----------
let IDX = [], HW = null, M = null;
let byId = new Map(), kids = new Map(), formsBy = new Map(), hwNorm = new Map(), formNorm = new Map();
let AB, AC, BC, plainDefs = null;
let W = null, wForm = new Map(), laneIdx = new Map(), laneRoots = null, laneShards = new Map();

const $ = s => document.querySelector(s);
const qEl = $('#q'), sug = $('#suggest'), main = $('#main');

// ---------- sync config ----------
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
// The sync Worker's URL. Empty = local-only mode (no login UI). The localStorage key
// `qamus.syncUrl` overrides it for local dev and tests (e.g. http://localhost:8787).
const SYNC_URL = lsGet('qamus.syncUrl') ?? 'https://qamus-sync.subhansajid360.workers.dev';
const Store = window.QamusStore, Sync = window.QamusSync;

async function load() {
  const j = u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
  IDX = await j('data/index.json');
  setStatus('');
  route();
  const [hw, m] = await Promise.all([j('data/hw.json'), j('data/morph.json')]);
  HW = hw; M = m;
  for (const e of HW.entries) {
    byId.set(e[0], e);
    if (!kids.has(e[4])) kids.set(e[4], []);
    if (e[0] !== e[4]) kids.get(e[4]).push(e);
    push(hwNorm, norm(e[1]), e);
  }
  HW.forms.forEach((f, i) => {
    push(formsBy, f[0], f);
    if (f[2]) push(formNorm, norm(f[2]), f);
  });
  AB = new Set(M.AB); AC = new Set(M.AC); BC = new Set(M.BC);
  for (const r of IDX) if (r[2] === 'l') push(laneIdx, r[0], r[3]);
  route();
  // second wave: Wiktionary and the Lane root list
  const [w, lr] = await Promise.all([j('data/wikt.json'), j('data/lane/roots.json').catch(() => [])]);
  laneRoots = new Set(lr);
  w.entries.forEach((e, k) => {
    push(wForm, norm(e[0]), k);
    if (w.forms[k]) for (const f of w.forms[k].split(' ')) push(wForm, f, k);
  });
  W = w;
  if (main.dataset.empty === '1') route();   // a search that found nothing may succeed now
}
const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
const setStatus = t => { const s = $('#status'); if (s) s.textContent = t; };

// ---------- morphology (Buckwalter) ----------
function analyze(w) {
  const n = norm(w), out = [], seen = new Set();
  for (let i = 0; i <= Math.min(5, n.length - 1); i++) {
    const P = M.prefixes[n.slice(0, i)]; if (!P) continue;
    for (let j = n.length; j > i; j--) {
      const sk = n.slice(j); if (sk.length > 7) break;
      const S = M.suffixes[sk]; if (!S) continue;
      const St = M.stems[n.slice(i, j)]; if (!St) continue;
      for (const p of P) for (const s of St) {
        if (!AB.has(p[1] + ' ' + s[1])) continue;
        for (const x of S) {
          if (!AC.has(p[1] + ' ' + x[1]) || !BC.has(s[1] + ' ' + x[1])) continue;
          const key = s[0] + '|' + s[2] + '|' + p[0] + '|' + x[0];
          if (seen.has(key)) continue; seen.add(key);
          out.push({ pre: p, stem: s, suf: x, affixLen: i + sk.length });
        }
      }
    }
  }
  // prefer parses whose hamza spelling matches what was typed (مؤمنين -> مُؤْمِن, not مَأْمَن)
  const raw = w.replace(DIAC, '').replace(/ٱ/g, 'ا');
  for (const a of out) {
    const c = (a.pre[0] + a.stem[0] + a.suf[0]).replace(DIAC, '').replace(/ٱ/g, 'ا');
    let pen = 0;
    if (c.length !== raw.length) pen = 0.5;
    else for (let i = 0; i < raw.length; i++) if ('أإآءؤئى'.includes(raw[i]) && c[i] !== raw[i]) pen++;
    a.pen = pen;
  }
  out.sort((a, b) => a.pen - b.pen || a.affixLen - b.affixLen);
  return out;
}

// ---------- autocomplete ----------
function lowerBound(key) {
  let lo = 0, hi = IDX.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (IDX[mid][0] < key) lo = mid + 1; else hi = mid; }
  return lo;
}
function suggestions(q) {
  const n = norm(q).replace(/\s+/g, '');
  if (!n) return [];
  if (!isAr(n)) return latinSuggest(q);
  const out = [];
  for (let i = lowerBound(n); i < IDX.length && IDX[i][0].startsWith(n) && out.length < 400; i++) out.push(IDX[i]);
  const pri = { h: 0, f: 1, b: 2 };
  out.sort((a, b) => (a[0] !== n) - (b[0] !== n) || a[0].length - b[0].length || pri[a[2]] - pri[b[2]]);
  // dedupe identical displays (same word under several roots stays; exact dup rows go)
  const seen = new Set(), res = [];
  for (const r of out) { const k = r[1] + r[2] + r[3]; if (!seen.has(k)) { seen.add(k); res.push(r); } if (res.length >= 12) break; }
  return res;
}
function latinSuggest(q) {
  if (!HW) return [];
  const l = latin(q); if (l.length < 2) return [];
  const res = [];
  for (const e of HW.entries) if (e[6] && latin(e[6]).startsWith(l)) { res.push([norm(e[1]), e[1], 'h', String(e[0])]); if (res.length > 40) break; }
  res.sort((a, b) => latin(byId.get(+a[3])[6]).length - latin(byId.get(+b[3])[6]).length);
  return res.slice(0, 10);
}
function glossFor(r) {
  if (!HW) return '';
  if (r[2] === 'h') { const e = byId.get(+r[3]); if (!e) return ''; let d = plain(stripHead(e)); if (e[6] && d.startsWith(e[6])) d = d.slice(e[6].length).trim(); return (e[6] ? e[6] + ' · ' : '') + d.slice(0, 80); }
  if (r[2] === 'f') { const f = HW.forms[+r[3]]; return 'Form ' + f[1] + ' · ' + plain(f[3]).slice(0, 70); }
  if (r[2] === 'b') { const s = (M.stems[r[3]] || [])[0]; return s ? s[2].replace(/;/g, '; ') : ''; }
  if (r[2] === 'w') { const e = W?.entries[+r[3]]; return e ? (e[1] ? e[1] + ' · ' : '') + wGloss(e) : 'Wiktionary'; }
  if (r[2] === 'l') return 'Lane’s Lexicon · root ' + [...r[3]].join(' ');
  return '';
}
let sel = -1, cur = [];
function renderSuggest() {
  const q = qEl.value;
  $('#clear').hidden = !q;
  cur = suggestions(q); sel = -1;
  if (!cur.length || document.activeElement !== qEl) { sug.hidden = true; return; }
  sug.innerHTML = cur.map((r, i) => {
    const isRoot = r[2] === 'h' && HW && byId.get(+r[3])?.[3];
    const tag = r[2] === 'f' ? `<span class="tag">Form ${HW.forms[+r[3]][1]}</span>` : isRoot ? '<span class="tag root">root</span>' : r[2] === 'b' ? '<span class="tag">lexicon</span>' : r[2] === 'w' ? '<span class="tag">wiktionary</span>' : r[2] === 'l' ? '<span class="tag">lane</span>' : '';
    return `<li role="option" data-i="${i}"><span class="w" lang="ar">${esc(r[1])}</span><span class="g">${esc(glossFor(r))}</span>${tag}</li>`;
  }).join('');
  sug.hidden = false;
}
function pick(r) {
  sug.hidden = true; qEl.blur();
  if (r[2] === 'h') go({ e: r[3], q: r[1] });
  else if (r[2] === 'f') go({ f: r[3], q: r[1] });
  else if (r[2] === 'w') go({ w: r[3], q: r[1] });
  else go({ q: r[1] });
}

// ---------- routing ----------
// In the Claude preview the hash can't carry state, so keep a small in-page history instead.
const MEM = !!window.QAMUS_MEMORY_ROUTER;
let memStack = [], memCur = '';
let navDepth = 0;   // in-app navigations so far; tells #account whether "back" stays inside the app
function go(params) {   // params: object of hash params, or a bare route name like 'history'
  const h = typeof params === 'string' ? params : new URLSearchParams(params).toString();
  navDepth++;
  if (MEM) { if (memCur && memCur !== h) memStack.push(memCur); memCur = h; return route(); }
  if (location.hash === '#' + h) route(); else location.hash = '#' + h;
}
function back() { if (memStack.length) { memCur = memStack.pop(); route(); } else { memCur = ''; qEl.value = ''; route(); } }
if (!MEM) window.addEventListener('hashchange', route);
function route() {
  const p = new URLSearchParams(MEM ? memCur : location.hash.slice(1));
  const bk = document.getElementById('back'); if (bk) bk.hidden = !memCur;
  const q = p.get('q') || '';
  const name = routeName(p);
  if (q && qEl.value !== q && document.activeElement !== qEl) qEl.value = q;
  if (!q && name !== 'account' && document.activeElement !== qEl) qEl.value = '';   // no stale lookup on other screens
  $('#clear').hidden = !qEl.value;
  setTab(name);
  renderSide();
  document.title = pageTitle(name, p);
  document.body.classList.toggle('studying', name === 'study');
  if (!p.has('history')) histConfirm = false;
  if (name === 'account') return accountRoute();
  if (p.has('settings')) return settingsView();
  if (p.has('history') && Store) return historyView();
  if (p.has('vocab') && hasVocab()) return vocabView();
  if (p.get('folder') && hasVocab()) return folderView(p.get('folder'));
  if (p.get('study') && hasVocab() && typeof studyView === 'function') return studyView(p.get('study').split(','), p.get('mode'));
  if (!HW) { if (q || p.get('e') || p.get('f') || p.get('w')) { view = 'loading'; main.innerHTML = '<p class="muted">Loading dictionary…</p>'; } else home(); return; }
  view = 'result';
  if (p.get('e')) showEntry(+p.get('e'));
  else if (p.get('f')) { const f = HW.forms[+p.get('f')]; showRoots([f[0]], { forms: [f], force: 'hw' }, q); }
  else if (p.get('w')) { if (!W) { view = 'loading'; main.innerHTML = '<p class="muted">Loading Wiktionary…</p>'; return; } const k = +p.get('w'); showRoots(wRoots(k), { wikt: [k], force: 'wikt' }, q); }
  else if (q.trim()) search(q);
  else return home();
  if (q) recordSearch(q);   // a result view is on screen: record it (never on keystrokes)
}

function routeName(p) {
  if (p.has('history')) return 'history';
  if (p.has('settings')) return 'settings';
  if (p.has('vocab')) return 'vocab';
  if (p.get('folder')) return 'folder';
  if (p.get('study')) return 'study';
  if (p.has('account')) return 'account';
  if (p.get('q') || p.get('e') || p.get('f') || p.get('w')) return 'result';
  return 'home';
}
function pageTitle(name, p) {
  const fname = id => (typeof folderById === 'function' && Store ? folderById(id)?.name : '') || '';
  const ids = (p.get('study') || '').split(',').filter(Boolean);
  const t = {
    result: p.get('q') || '',
    vocab: 'Vocab', history: 'History', account: 'Account', settings: 'Settings',
    folder: fname(p.get('folder')),
    study: 'Study · ' + (ids.length > 1 ? `${ids.length} folders` : fname(ids[0])),
  }[name];
  return t ? `${t} · Qamus` : 'Qamus';
}

// ---------- settings page ----------
function settingsView() {
  main.dataset.empty = '';
  const pr = resultPrefs(), n = pr.order.length;
  const row = (id, i) => {
    const d = DICTS.find(x => x.id === id), isOn = !pr.off.has(id);
    return `<li class="set-row${isOn ? '' : ' off'}" data-dict="${id}">
      <span class="set-pos" aria-hidden="true">${i + 1}</span>
      <label class="switch set-switch"><input type="checkbox" data-dict-on="${id}" ${isOn ? 'checked' : ''}><span class="track" aria-hidden="true"></span>
        <span class="set-text"><span class="set-name">${esc(d.name)}</span><span class="set-desc">${esc(d.desc)}</span></span></label>
      <button type="button" class="set-drag" data-id="${id}" aria-label="Reorder ${esc(d.name)}, position ${i + 1} of ${n}. Drag, or use the up and down arrow keys."
        title="Drag to reorder"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></button></li>`;
  };
  const allOff = pr.order.every(id => pr.off.has(id));
  renderKeepingFocus('settings', `<nav class="crumbs" aria-label="Breadcrumb"><button type="button" class="crumb" data-go="">Search</button></nav>
    <h2 class="sec">Dictionaries</h2>
    <p class="set-note muted">Results show in this order; drag a row by its handle to change it. Turn a dictionary off to hide it from search results. An entry you open from Vocab or a link still shows.</p>
    <ol class="set-list" id="set-dicts">${pr.order.map(row).join('')}</ol>
    ${allOff ? '<p class="form-msg err set-warn">Every dictionary is off, so searches will only show the word analysis.</p>' : ''}
    <h2 class="sec">Word analysis</h2>
    <ul class="set-list"><li class="set-row"><label class="switch set-switch"><input type="checkbox" id="set-parse" ${pr.parse ? 'checked' : ''}><span class="track" aria-hidden="true"></span>
      <span class="set-text"><span class="set-name">Show the “Parsed” breakdown</span><span class="set-desc">Prefix · stem · suffix, with what each part means</span></span></label></li></ul>
    <div class="actions"><button type="button" class="btn quiet" id="set-reset">Reset to defaults</button></div>
    ${Store ? (SYNC_URL ? '<p class="set-note muted">These settings sync to your other devices.</p>' : '') : '<p class="set-note muted">Settings can’t be saved in this preview.</p>'}`);
}
main.addEventListener('change', e => {
  if (view !== 'settings') return;
  const t = e.target, pr = resultPrefs();
  if (t.dataset.dictOn) { const off = new Set(pr.off); if (t.checked) off.delete(t.dataset.dictOn); else off.add(t.dataset.dictOn); setResultPrefs({ off }); main.querySelector(`[data-dict-on="${t.dataset.dictOn}"]`)?.focus(); }
  else if (t.id === 'set-parse') { setResultPrefs({ parse: t.checked }); $('#set-parse')?.focus(); }
});
main.addEventListener('click', e => {
  if (view !== 'settings') return;
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'set-reset') {
    setResultPrefs({ order: DICT_IDS, off: new Set(), parse: true });
    $('#set-reset')?.focus();
  }
});

// Reorder dictionaries: drag a row by its handle (touch, pen or mouse), or arrow keys on the handle.
function moveDict(id, to) {
  const order = resultPrefs().order.filter(x => x !== id);
  order.splice(Math.max(0, Math.min(to, order.length)), 0, id);
  setResultPrefs({ order });
  main.querySelector(`.set-drag[data-id="${id}"]`)?.focus();
}
main.addEventListener('keydown', e => {
  const h = view === 'settings' && e.target.closest?.('.set-drag');
  if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault();
  const i = resultPrefs().order.indexOf(h.dataset.id);
  moveDict(h.dataset.id, i + (e.key === 'ArrowUp' ? -1 : 1));
});
let dictDrag = null;
main.addEventListener('pointerdown', e => {
  const h = view === 'settings' && e.target.closest('.set-drag');
  if (!h || e.button !== 0) return;
  e.preventDefault();
  const row = h.closest('.set-row');
  dictDrag = { row, list: row.parentElement, handle: h, pid: e.pointerId, y0: e.clientY, top0: row.getBoundingClientRect().top, shift: 0 };
  row.classList.add('dragging');
  try { h.setPointerCapture(e.pointerId); } catch {}
});
main.addEventListener('pointermove', e => {
  const d = dictDrag;
  if (!d || e.pointerId !== d.pid) return;
  e.preventDefault();
  // put the row before the first sibling whose middle is below the pointer
  const before = [...d.list.children].find(r => r !== d.row && e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2) || null;
  if (before !== d.row.nextElementSibling) d.list.insertBefore(d.row, before);
  // then keep it under the pointer: offset from where the row now sits without its transform
  const natural = d.row.getBoundingClientRect().top - d.shift;
  d.shift = e.clientY - d.y0 - (natural - d.top0);
  d.row.style.transform = `translateY(${d.shift}px)`;
});
function endDictDrag(e) {
  const d = dictDrag;
  if (!d || e.pointerId !== d.pid) return;
  dictDrag = null;
  d.row.style.transform = '';
  d.row.classList.remove('dragging');
  const order = [...d.list.children].map(r => r.dataset.dict);
  if (order.join() !== resultPrefs().order.join()) setResultPrefs({ order });
  main.querySelector(`.set-drag[data-id="${d.handle.dataset.id}"]`)?.focus({ preventScroll: true });
}
main.addEventListener('pointerup', endDictDrag);
main.addEventListener('pointercancel', endDictDrag);

$('#settings-btn')?.addEventListener('click', () => go('settings'));

// ---------- side panel (wide screens): recent searches and the folder tree ----------
const sideEl = $('#side');
function shortTime(t) {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h'
    : s < 86400 * 30 ? Math.round(s / 86400) + 'd' : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function renderSide() {
  if (!sideEl || !Store || sideEl.hidden) return;
  const p = new URLSearchParams(MEM ? memCur : location.hash.slice(1));
  const curQ = p.get('q') || '', curF = p.get('folder') || '';
  const cur = on => (on ? ' on" aria-current="true' : '');
  const recent = liveHistory().slice(0, 14);
  let h = `<section class="side-sec" aria-label="Recent searches"><div class="side-h"><span>Recent</span>${recent.length ? '<a class="side-more" href="#history" data-sgo="history">All</a>' : ''}</div>` +
    (recent.length ? `<ul class="side-list">${recent.map(({ q, t }) => `<li><a class="side-item${cur(q === curQ)}" href="#q=${encodeURIComponent(q)}" data-sq="${esc(q)}"><span class="side-w" ${qAttr(q)}>${esc(q)}</span><span class="side-n">${shortTime(t)}</span></a></li>`).join('')}</ul>`
      : '<p class="side-empty">Words you look up appear here.</p>') + '</section>';
  if (hasVocab()) {
    const rows = tree(), due = dueCount(liveCards());
    h += `<section class="side-sec" aria-label="Folders"><div class="side-h"><span>Folders</span>${due ? `<span class="side-due">${due} due</span>` : ''}</div>` +
      (rows.length ? `<ul class="side-list">${rows.map(({ f, depth }) => {
        const cs = cardsDeep(f.id), d = dueCount(cs);
        return `<li><a class="side-item${cur(f.id === curF)}" style="--depth:${depth}" href="#folder=${encodeURIComponent(f.id)}" data-sgo="folder=${esc(f.id)}"><span class="side-w" dir="auto">${esc(f.name)}</span><span class="side-n${d ? ' due' : ''}">${d ? d + ' due' : cs.length}</span></a></li>`;
      }).join('')}</ul>` : '<p class="side-empty">Save a word with the bookmark to start a folder.</p>') + '</section>';
  }
  sideEl.innerHTML = h;
}
sideEl?.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  if (a.dataset.sq != null) go({ q: a.dataset.sq }); else if (a.dataset.sgo) go(a.dataset.sgo);
});

// ---------- status bar (wide screens): where your data is, and the keys that work here ----------
function renderStat(st) {
  const dot = $('#stat-dot'), text = $('#stat-text');
  if (!dot || !text) return;
  const user = SYNC_URL && st?.user;
  dot.className = 'sdot ' + (user ? st.status : 'local');
  text.textContent = !SYNC_URL ? 'Saved on this device · sync is off' : !user ? 'Saved on this device · not signed in'
    : `${st.user} · ` + ({ synced: st.lastSync ? `synced ${relTime(st.lastSync)}` : 'synced', syncing: 'syncing…', offline: 'offline, changes saved here', error: 'sync problem' }[st.status] || st.status)
      + (st.dirty && st.status !== 'syncing' ? ' · unsynced changes' : '');
}

// ---------- tabs: Search · Vocab · History ----------
const tabsEl = $('#tabs');
const TAB_OF = { home: 'search', result: 'search', settings: 'search', account: null, vocab: 'vocab', folder: 'vocab', study: 'vocab', history: 'history' };
const setBtn = $('#settings-btn');
function setTab(name) {
  if (setBtn) {
    setBtn.hidden = !['home', 'result', 'settings'].includes(name);
    if (name === 'settings') setBtn.setAttribute('aria-current', 'page'); else setBtn.removeAttribute('aria-current');
  }
  if (!tabsEl) return;
  const on = hasVocab();
  tabsEl.hidden = !on;
  document.body.classList.toggle('has-tabs', on);
  if (!on) return;
  const active = TAB_OF[name];
  if (active !== null) for (const b of tabsEl.querySelectorAll('[data-tab]')) {
    if (b.dataset.tab === active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  updateTabBadge();
}
function updateTabBadge() {
  if (!tabsEl || !hasVocab()) return;
  const n = dueCount(liveCards());
  const badge = tabsEl.querySelector('.tab-badge'), tab = badge.closest('.tab');
  badge.hidden = !n;
  badge.textContent = n > 99 ? '99+' : String(n);
  tab.setAttribute('aria-label', n ? `Vocab, ${n} due` : 'Vocab');
}
tabsEl?.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  const t = b.dataset.tab;
  if (t !== 'search') return go(t);
  if (view === 'home') { qEl.focus(); qEl.select(); }
  else { qEl.value = ''; go(''); }
});

// ---------- #account: the account sheet as a route ----------
let accountOpen = false;
function accountRoute() {
  if (!SYNC_URL || !Sync) return home();   // local-only mode has no login UI
  if (!view || view === 'loading') home();
  if (accountOpen) return;
  accountOpen = true;
  accountSheet({ onClose: leaveAccount });
}
function leaveAccount() {
  accountOpen = false;
  const p = new URLSearchParams(MEM ? memCur : location.hash.slice(1));
  if (!p.has('account')) return;           // the sheet closed because we navigated elsewhere
  if (MEM) return back();
  if (navDepth > 0) return history.back();
  history.replaceState(null, '', location.pathname + location.search);   // deep link: don't leave a dead entry
  route();
}

// ---------- views ----------
const qAttr = q => isAr(q) ? 'lang="ar"' : 'dir="auto"';
// Home greeting: "Welcome back, <username>" when signed in, plus the time of day and the last lookup.
let greetedUser = '';
function welcomeBanner(last) {
  const user = (SYNC_URL && Sync?.state.user) || '';
  greetedUser = user;
  const hr = new Date().getHours();
  const tod = hr >= 5 && hr < 12 ? 'Good morning' : hr >= 12 && hr < 18 ? 'Good afternoon' : 'Good evening';
  const title = user ? `Welcome back, <span class="wb-name">${esc(user)}</span>` : last ? 'Welcome back' : 'Welcome to Qamus';
  let sub = `${tod}.`;
  if (last) {
    const rt = relTime(last.t);
    sub += ` You last looked up <span ${qAttr(last.q)}>${esc(last.q)}</span> ${/ago|now/.test(rt) ? rt : 'on ' + rt}.`;
  } else sub += ' Look up a word to get started.';
  return `<section class="welcome" aria-labelledby="wb-title"><div class="wb-row"><h1 class="wb-title" id="wb-title">${title}</h1><span class="wb-ar" lang="ar">أهلًا وسهلًا</span></div>
    <p class="wb-sub">${sub}</p></section>`;
}
function home() {
  view = 'home';
  const h = liveHistory().slice(0, HIST_HOME);
  main.innerHTML = `${welcomeBanner(h[0])}
    ${hasVocab() && dueCount(liveCards()) ? `<h2 class="sec">Study</h2>${vocabLink()}` : ''}
    ${h.length ? `<div class="sec-row home-recent"><h2 class="sec">Recent</h2>${Store ? '<button type="button" class="see-all" data-go="history">See all</button>' : ''}</div>
    <div class="history home-recent">${h.map(({ q, t }) => `<div class="h-row"><button ${qAttr(q)} data-q="${esc(q)}">${esc(q)}</button><span class="hist-time">${relTime(t)}</span></div>`).join('')}</div>` : ''}
    <h2 class="sec">How to search</h2>
    <div class="empty home-help"><dl class="howto">
      <dt lang="ar">كتاب · يكتبون</dt><dd>An Arabic word in any inflection. Prefixes and suffixes are stripped automatically.</dd>
      <dt lang="ar">ك ت ب</dt><dd>A root, with spaces or dashes between the letters.</dd>
      <dt>book · kitab</dt><dd>English, or a transliteration.</dd></dl>
      <p class="muted howto-note">Hamzas, harakat, ة/ه and ى/ي don’t matter.</p></div>`;
}

function search(q) {
  q = q.trim(); if (!q) return home();
  if (!isAr(q)) return englishSearch(q);

  // root syntax: letters separated by spaces/hyphens/dots, e.g. ك ت ب
  const letters = q.split(/[\s\-–.،,]+/).filter(Boolean);
  if (letters.length >= 2 && letters.every(x => norm(x).length === 1)) {
    const r = rootIdsFor(norm(letters.join('')));
    if (r.length) return showRoots(r, {}, q);
  }

  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) return multiWord(words);

  const n = norm(q);
  const hits = new Set(), forms = [], roots = [];
  const addRoot = id => { if (id != null && !roots.includes(id)) roots.push(id); };
  for (const e of hwNorm.get(n) || []) { if (e[3]) addRoot(e[0]); }
  for (const e of hwNorm.get(n) || []) { hits.add(e[0]); addRoot(e[4]); }
  for (const f of formNorm.get(n) || []) { forms.push(f); addRoot(f[0]); }
  const wikt = [...new Set(wForm.get(n) || [])].slice(0, 8);
  for (const k of wikt) wRoots(k).forEach(addRoot);
  const laneOnly = [], laneHit = new Set(laneIdx.get(n) || []);
  for (const lr of laneHit) { const ids = rootIdsFor(lr); if (ids.length) ids.forEach(addRoot); else laneOnly.push(lr); }

  const parses = analyze(q);
  const bwOnly = [];
  for (const a of parses) {
    if (a.stem[5].length) a.stem[5].forEach(addRoot);
    else bwOnly.push(a);
  }
  // mark HW words matching the parsed stems/lemmas
  for (const a of parses) for (const k of [norm(a.stem[0]), norm(a.stem[4] || '')]) for (const e of hwNorm.get(k) || []) if (roots.includes(e[4])) hits.add(e[0]);

  if (!roots.length && !bwOnly.length && !wikt.length && !laneOnly.length) return fallback(q, n);
  const directHit = hits.size || forms.length || wikt.length;
  showRoots(roots, { hits, forms, parses: directHit && !parses.some(a => a.affixLen) ? [] : parses, bwOnly, wikt, laneOnly, laneWord: laneHit.size ? n : '' }, q);
}

function rootVariants(n) {
  const out = [n];
  if (n.length === 3 && n[1] === n[2]) out.push(n.slice(0, 2));
  if (n.length === 2) out.push(n + n[1]);
  const alt = { 'ا': 'وي', 'و': 'يا', 'ي': 'وا' };
  [...n].forEach((c, i) => { for (const a of alt[c] || '') out.push(n.slice(0, i) + a + n.slice(i + 1)); });
  return out;
}
function rootIdsFor(n) {
  for (const v of rootVariants(n)) {
    const ids = (hwNorm.get(v) || []).filter(e => e[3]).map(e => e[0]);
    if (ids.length) return ids;
  }
  return [];
}

function multiWord(words) {
  main.innerHTML = `<h2 class="sec">Words</h2>` + words.map(w => {
    const a = analyze(w)[0];
    const g = a ? a.stem[2].replace(/;/g, '; ') : (hwNorm.get(norm(w))?.[0] ? plain(stripHead(hwNorm.get(norm(w))[0])).slice(0, 90) : '—');
    return `<div class="list-item" data-q="${esc(w)}"><span class="w" lang="ar">${esc(w)}</span><span class="g">${esc(g)}</span></div>`;
  }).join('');
}

function fallback(q, n) {
  // nearest keys within edit distance 1 (plus prefix completions)
  const near = [];
  const seen = new Set();
  const consider = r => { if (!seen.has(r[0])) { seen.add(r[0]); near.push(r); } };
  for (const r of IDX) {
    if (Math.abs(r[0].length - n.length) <= 1 && ed1(r[0], n)) consider(r);
    if (near.length > 30) break;
  }
  for (let i = lowerBound(n); i < IDX.length && IDX[i][0].startsWith(n) && near.length < 40; i++) consider(IDX[i]);
  main.dataset.empty = W ? '' : '1';
  main.innerHTML = `<p class="muted">No exact match for <span lang="ar">${esc(q)}</span>.</p>` +
    (near.length ? `<h2 class="sec">Closest</h2>` + near.slice(0, 25).map(r => `<div class="list-item" data-pick='${esc(JSON.stringify(r))}'><span class="w" lang="ar">${esc(r[1])}</span><span class="g">${esc(glossFor(r))}</span></div>`).join('') : '');
}
function ed1(a, b) {
  if (a === b) return true;
  if (a.length === b.length) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false; return true; }
  if (a.length < b.length) [a, b] = [b, a];
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; } else { if (++d > 1) return false; i++; } }
  return true;
}

function englishSearch(q) {
  const l = latin(q);
  // transliteration exact matches first
  const tr = HW.entries.filter(e => e[6] && latin(e[6]) === l);
  if (!plainDefs) plainDefs = HW.entries.map(e => plain(stripHead(e)).toLowerCase());
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(terms.map(t => `(?=[\\s\\S]*\\b${t})`).join(''), '');
  const first = new RegExp('\\b' + terms[0]);
  const scored = [];
  HW.entries.forEach((e, i) => {
    const d = plainDefs[i];
    if (!re.test(d)) return;
    const pos = d.search(first);
    // prefer early matches and matches before the first ';'
    const semi = d.indexOf(';');
    scored.push([pos + (semi >= 0 && pos > semi ? 200 : 0) + (e[3] ? 0 : 5), e]);
  });
  scored.sort((a, b) => a[0] - b[0]);
  const hl = s => { let h = esc(s); for (const t of terms) h = h.replace(new RegExp(`\\b(${t})`, 'gi'), '<mark>$1</mark>'); return h; };
  const item = e => `<div class="list-item" data-e="${e[0]}"><span class="w" lang="ar">${esc(e[1])}</span><span class="g"><i class="muted">${esc(e[6] || '')}</i> ${hl(plain(stripHead(e)).slice(0, 220))}</span></div>`;
  main.innerHTML =
    (tr.length ? `<h2 class="sec">Transliteration</h2>` + tr.slice(0, 20).map(item).join('') : '') +
    `<h2 class="sec">English · ${scored.length} matches</h2>` +
    (scored.length ? scored.slice(0, 80).map(x => item(x[1])).join('') : '<p class="muted">Nothing found.</p>');
}

// ---------- result preferences: which dictionaries show, in what order, and the word analysis ----------
const DICTS = [
  { id: 'wikt', name: 'Wiktionary', desc: 'Modern words, inflected forms and broken plurals' },
  { id: 'hw', name: 'Hans Wehr', desc: 'Roots, verb forms and derived words' },
  { id: 'lexicon', name: 'Buckwalter lexicon', desc: 'Short glosses for words missing from Hans Wehr' },
  { id: 'lane', name: 'Lane’s Lexicon', desc: 'Classical Arabic, in depth; loads on demand' },
];
const DICT_IDS = DICTS.map(d => d.id);
function resultPrefs() {
  const st = (Store && Store.doc && Store.doc.settings) || {};
  const order = String(st.dictOrder || '').split(',').filter((id, i, a) => DICT_IDS.includes(id) && a.indexOf(id) === i);
  for (const id of DICT_IDS) if (!order.includes(id)) order.push(id);
  const off = new Set(String(st.dictOff || '').split(',').filter(id => DICT_IDS.includes(id)));
  return { order, off, parse: st.showParse !== false };
}
function setResultPrefs({ order, off, parse }) {
  if (!Store) return;
  Store.mutate(d => {
    const next = { ...d.settings, updatedAt: Date.now() };
    if (order) next.dictOrder = order.join(',');
    if (off) next.dictOff = [...off].join(',');
    if (parse !== undefined) next.showParse = !!parse;
    d.settings = next;
  });
}

function showEntry(id) {
  const e = byId.get(id); if (!e) return home();
  showRoots([e[4]], { hits: new Set([id]), force: 'hw' }, e[1]);   // an entry you opened always shows
}

function showRoots(rootIds, opt, q) {
  const { hits = new Set(), forms = [], parses = [], bwOnly = [], wikt = [], laneOnly = [], laneWord = '', force = '' } = opt;
  main.dataset.empty = '';
  lastLaneWord = laneWord;
  const pr = resultPrefs();
  const on = id => id === force || !pr.off.has(id);
  const extra = uniqParses(bwOnly).slice(0, 6);
  const has = { wikt: wikt.length, hw: rootIds.length, lexicon: extra.length, lane: laneOnly.length };
  let h = '', rootsShown = false, hidden = false;
  pr.order.forEach((id, i) => {
    if (!has[id]) { /* nothing from this dictionary */ }
    else if (!on(id)) hidden = true;
    else if (id === 'wikt') h += `<h2 class="sec">Wiktionary</h2>` + wikt.map(wCard).join('');
    else if (id === 'hw') {
      h += `<h2 class="sec">${rootIds.length > 1 ? 'Roots' : 'Root'}</h2>`;
      rootIds.forEach((rid, k) => { h += rootCard(rid, hits, forms, k === 0 || rootIds.length <= 2, on('lane')); });
      rootsShown = true;
    }
    else if (id === 'lexicon') h += `<h2 class="sec">${rootsShown ? 'Also in lexicon' : 'Lexicon'}</h2>` + extra.map(bwCard).join('');
    else if (id === 'lane') h += `<h2 class="sec">Lane’s Lexicon</h2>` + laneOnly.map(lr => laneBlock(lr, true)).join('');
    // the word analysis sits after the first dictionary in your order, as it did after Wiktionary by default
    if (i === 0 && pr.parse && parses.length) h += `<h2 class="sec">Parsed</h2>` + uniqParses(parses).slice(0, 4).map(parseHtml).join('');
  });
  if (hidden) h += `<p class="muted hidden-note">Some results are hidden by your <a href="#settings" data-go="settings">dictionary settings</a>.</p>`;
  main.innerHTML = h || '<p class="muted">Nothing found.</p>';
  if (hasVocab()) markSaved(main);
  main.querySelectorAll('details.lane[open]').forEach(fillLane);
  const first = main.querySelector('.word.hit, .forms tr.hit');
  if (first) requestAnimationFrame(() => first.scrollIntoView({ block: 'center' }));
  else window.scrollTo(0, 0);
}
function uniqParses(ps) {
  const seen = new Set(), out = [];
  for (const a of ps) { const k = a.pre[0] + a.stem[0] + a.suf[0]; if (!seen.has(k)) { seen.add(k); out.push(a); } }
  return out;
}
function parseHtml(a) {
  const parts = [];
  const pre = a.pre[0], suf = a.suf[0];
  if (pre) parts.push(`<span>${esc(pre)}</span>`);
  parts.push(`<span class="stem">${esc(a.stem[0])}</span>`);
  if (suf) parts.push(`<span>${esc(suf)}</span>`);
  const gl = [a.pre[2], a.stem[2].replace(/;/g, '; '), a.suf[2]].filter(Boolean).join(' + ');
  const R = rootLabel(a.stem);
  return `<div class="parse"><div class="segs" lang="ar">${parts.join('<span class="seg-sep">·</span>')}</div>
    <div class="gl">${esc(gl)}${R ? ` · root <span lang="ar">${esc(R)}</span>` : ''}</div></div>`;
}
function rootLabel(stem) {
  if (stem[5].length) return [...byId.get(stem[5][0])[1]].join(' ');
  if (stem[3] >= 0) return [...M.roots[stem[3]][0].replace(/\(\d\)|\/.*$|-/g, '')].join(' ');
  return '';
}
function bwCard(a) {
  const R = rootLabel(a.stem);
  const w = a.stem[4] || a.stem[0];
  return `<div class="bw"><div class="e-hw"><span class="w" lang="ar">${esc(w)}</span></div>
    <div class="e-body"><div class="def">${esc(a.stem[2].replace(/;/g, '; '))}</div>
    <div class="e-meta muted">${R ? `root <span lang="ar">${esc(R)}</span> · ` : ''}not in Hans Wehr</div></div>${SB({ s: 'lexicon', r: w, w, g: a.stem[2].replace(/;/g, '; '), root: R }, w)}</div>`;
}

let lastLaneWord = '';
function wGloss(e) {
  const m = e[2].match(/<li>(.*?)<\/li>/);
  return plain(m ? m[1] : e[2]).slice(0, 90);
}
function wRoots(k) {  // build-time link to Hans Wehr, else the morphological analyzer's root
  const e = W.entries[k];
  if (e[3].length) return e[3];
  const a = analyze(e[0]).find(x => x.stem[5].length);
  return a ? a.stem[5] : [];
}
function wCard(k) {
  const e = W.entries[k], rs = wRoots(k);
  const R = rs.length ? [...byId.get(rs[0])[1]].join(' ') : '';
  return `<div class="bw"><div class="e-hw"><span class="w" lang="ar">${esc(e[0])}</span>${e[1] ? ` <i class="tr muted">${esc(e[1])}</i>` : ''}</div>
    <div class="e-body"><div class="def wk">${defHtml(e[2], ['i', 'br', 'ol', 'li'])}</div>
    ${R ? `<div class="e-meta muted">root <span lang="ar">${esc(R)}</span></div>` : ''}</div>${SB({ s: 'wikt', r: String(k) }, e[0])}</div>`;
}
function laneKey(n) {
  if (!laneRoots) return n;
  for (const v of rootVariants(n)) if (laneRoots.has(v)) return v;
  return null;
}
function laneBlock(n, open) {
  const k = laneKey(n);
  if (!k) return '';
  const auto = open || (lastLaneWord && (laneIdx.get(lastLaneWord) || []).includes(k));
  return `<details class="lane" data-root="${esc(k)}" ${auto ? 'open' : ''}><summary>Lane’s Lexicon <span class="muted">· <span lang="ar">${esc([...k].join(' '))}</span></span></summary><div class="lane-body muted">Loading…</div></details>`;
}
async function fillLane(d) {
  if (d.dataset.filled) return; d.dataset.filled = '1';
  const k = d.dataset.root, body = d.querySelector('.lane-body');
  try {
    const name = k.codePointAt(0).toString(16).padStart(4, '0') + '.json';
    if (!laneShards.has(name)) laneShards.set(name, fetch('data/lane/' + name).then(r => { if (!r.ok) throw new Error(name); return r.json(); }));
    const shard = await laneShards.get(name);
    const items = shard[k] || [];
    body.classList.remove('muted');
    body.innerHTML = items.length ? items.map(([w, def], i) => {
      const hit = lastLaneWord && (norm(w) === lastLaneWord || norm((def.match(/^[\u0600-\u06FF\u064B-\u0652 ]+/) || [''])[0]) === lastLaneWord);
      return `<div class="word lane-entry ${hit ? 'hit' : ''}">${SB({ s: 'lane', r: k + ':' + i }, w)}<span class="def">${defHtml(def, ['i', 'br', 'table', 'tbody', 'tr', 'td', 'center'])}</span></div>`;
    }).join('') : '<p class="muted">No entries.</p>';
    if (hasVocab()) markSaved(body);
    const hit = body.querySelector('.hit'); if (hit) hit.scrollIntoView({ block: 'center' });
  } catch (err) { body.textContent = 'Couldn’t load Lane’s entry. Check your connection and try again.'; delete d.dataset.filled; }
}
function stripHead(e) { const d = e[2]; return d.startsWith(e[1]) ? d.slice(e[1].length).trim() : d; }
function plain(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function defHtml(s, tags = ['b', 'i']) {
  let h = esc(s);
  for (const t of tags) h = h.replace(new RegExp(`&lt;(/?)${t}&gt;`, 'g'), `<$1${t}>`);
  // make Arabic runs tappable
  h = h.replace(/[؀-ۿ][؀-ۿً-ْ ]*[؀-ۿ]|[؀-ۿ]/g,
    m => `<span class="ar lk" data-q="${m.trim()}">${m}</span>`);
  return h;
}
function bwRoot(rid) { // HW root -> Buckwalter-ish latin for ejtaal
  const e = byId.get(rid); if (!e) return '';
  const T = { 'ا': 'A', 'أ': 'A', 'ب': 'b', 'ت': 't', 'ث': 'v', 'ج': 'j', 'ح': 'H', 'خ': 'x', 'د': 'd', 'ذ': '*', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': '$', 'ص': 'S', 'ض': 'D', 'ط': 'T', 'ظ': 'Z', 'ع': 'E', 'غ': 'g', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'y', 'ء': 'A' };
  return [...norm(e[1])].map(c => T[c] || '').join('');
}
// Save (bookmark) buttons come from vocab.js; without it (single-file preview) rows render as before.
const hasVocab = () => !!Store && typeof vocabView === 'function';
const SB = (payload, word) => (hasVocab() ? saveBtn(payload, word) : '');
let formIdxMap = null;
const formIdx = f => { if (!formIdxMap) formIdxMap = new Map(HW.forms.map((x, i) => [x, i])); return formIdxMap.get(f); };
function rootCard(rid, hits, hitForms, open, lane = true) {
  const root = byId.get(rid); if (!root) return '';
  const fs = formsBy.get(rid) || [];
  const s = stripHead(root);
  const cut = s.search(/<b>\s*(I{1,3}|IV|VI{0,3}|IX|X)\s*<\/b>/);
  const formI = cut >= 0 ? s.slice(0, cut).trim() : s;
  const ks = kids.get(rid) || [];
  const anyHit = ks.some(k => hits.has(k[0])) || hits.has(rid) || fs.some(f => hitForms.includes(f));
  const gist = plain(formI).replace(/^\S+\s/, '').slice(0, 120);
  let h = `<details class="root" ${open || anyHit ? 'open' : ''}><summary>
    <span class="root-letters" lang="ar">${esc([...root[1]].join(' '))}</span>
    <span class="meta">${root[5] ? `<span class="tag">Qur’an ${root[5]}×</span>` : ''}<span class="tag">${ks.length + 1} words</span></span>
    <span class="gist">${esc(gist)}</span></summary><div class="body">`;
  if (root[3] && formI) {
    h += `<div class="word ${hits.has(rid) ? 'hit' : ''}" id="w${rid}">${SB({ s: 'hw', r: String(rid) }, root[1])}<span class="hw" lang="ar">${esc(root[1])}</span> <span class="def">${defHtml(formI)}</span></div>`;
  }
  if (fs.length) {
    h += `<table class="forms">` + fs.map(f => `<tr class="${hitForms.includes(f) ? 'hit' : ''}"><td class="num">${f[1]}</td><td class="verb" lang="ar">${esc(f[2])}</td><td class="def">${defHtml(f[3])}</td><td class="sv">${SB({ s: 'hw', r: 'f' + formIdx(f) }, f[2])}</td></tr>`).join('') + `</table>`;
  }
  h += ks.map(k => `<div class="word ${hits.has(k[0]) ? 'hit' : ''}" id="w${k[0]}">${SB({ s: 'hw', r: String(k[0]) }, k[1])}<span class="hw" lang="ar">${esc(k[1])}</span><span class="def">${defHtml(stripHead(k))}</span></div>`).join('');
  if (lane) h += laneBlock(norm(root[1]), false);
  const lat = bwRoot(rid);
  h += `<div class="links"><a href="https://ejtaal.net/aa/#q=${encodeURIComponent(lat)}" target="_blank" rel="noopener">Lane &amp; others (ejtaal)</a>
    <a href="https://corpus.quran.com/qurandictionary.jsp?q=${encodeURIComponent(lat)}" target="_blank" rel="noopener">Qur’an corpus</a></div>`;
  return h + `</div></details>`;
}

// ---------- search history (synced: Store.doc.history) ----------
const HIST_HOME = 12, HIST_MAX = 500;
let view = '';              // 'home' | 'history' | 'result' | 'loading' — what #main shows
let histConfirm = false;    // "Clear history" inline confirm is open
const cleanQ = s => String(s).trim().replace(/\s+/g, ' ').slice(0, 200);
function legacyHist() {     // the pre-sync localStorage list (newest first)
  try { const h = JSON.parse(localStorage.getItem('hist') || '[]'); return Array.isArray(h) ? h.filter(x => typeof x === 'string') : []; }
  catch { return []; }
}
function liveHistory() {
  if (!Store) return legacyHist().map(q => ({ q, t: 0 }));
  return Store.doc.history.filter(h => !h.deleted).sort((a, b) => b.t - a.t);
}
const historyPaused = () => !!Store?.doc.settings.pauseHistory;
const maxT = (hist, q) => hist.reduce((m, h) => (h.q === q && h.t > m ? h.t : m), 0);

function recordSearch(raw) {
  const q = cleanQ(raw);
  if (!q) return;
  if (!Store) {   // no store (single-file preview): keep the old local list working
    try { const h = legacyHist().filter(x => x !== q); h.unshift(q); localStorage.setItem('hist', JSON.stringify(h.slice(0, 30))); } catch {}
    return;
  }
  Store.init().then(() => {
    if (historyPaused()) return;
    if (liveHistory()[0]?.q === q) return;   // consecutive repeat (and route() re-renders)
    Store.mutate(d => {
      const t = Math.max(Date.now(), (d.settings.historyClearedAt || 0) + 1, maxT(d.history, q) + 1);
      d.history = [{ q, t }, ...d.history.filter(h => h.q !== q)];
      let live = 0;
      d.history = d.history.filter(h => h.deleted || ++live <= HIST_MAX);
    });
  });
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
function setPauseHistory(on) {
  Store.mutate(d => { d.settings = { ...d.settings, pauseHistory: !!on, updatedAt: Date.now() }; });
}
// One-time move of the old localStorage list into the synced document.
function migrateHist() {
  let raw = null;
  try { raw = localStorage.getItem('hist'); } catch { return; }
  if (raw === null) return;
  const have = new Set(Store.doc.history.map(h => h.q));
  const add = [...new Set(legacyHist().map(cleanQ))].filter(q => q && !have.has(q));
  if (add.length) {
    const now = Date.now();
    Store.mutate(d => { d.history = [...d.history, ...add.map((q, i) => ({ q, t: now - (i + 1) * 1000 }))]; });
  }
  if (Store.persistent) { try { localStorage.removeItem('hist'); } catch {} }
}

// Re-renders (data loading, sync) must not steal focus or scroll position.
function focusKey() {
  const a = document.activeElement;
  if (!a || !main.contains(a)) return null;
  if (a.id) return '#' + CSS.escape(a.id);
  const row = a.closest('[data-hq], [data-card]');
  if (!row) return null;
  const rk = row.dataset.hq != null ? `[data-hq="${CSS.escape(row.dataset.hq)}"]` : `[data-card="${CSS.escape(row.dataset.card)}"]`;
  const cls = [...a.classList].find(c => ['hist-del', 'hist-q', 'cw', 'cg'].includes(c));
  return cls ? `${rk} .${cls}` : (a.matches('input') ? `${rk} input` : null);
}
function renderKeepingFocus(next, html) {
  const entering = view !== next;
  const key = entering ? null : focusKey();
  view = next;
  main.innerHTML = html;
  if (entering) window.scrollTo(0, 0);
  else if (key) main.querySelector(key)?.focus({ preventScroll: true });
}
function historyView() {
  main.dataset.empty = '';
  const items = liveHistory(), paused = historyPaused(), n = items.length;
  if (!n) histConfirm = false;
  renderKeepingFocus('history', `<h2 class="sec">History${n ? ` · ${n} search${n === 1 ? '' : 'es'}` : ''}</h2>
    <div class="hist-controls">
      <label class="switch"><input type="checkbox" id="hist-pause" ${paused ? 'checked' : ''}><span class="track" aria-hidden="true"></span>Pause recording</label>
      ${n ? `<button type="button" class="btn" id="hist-clear" ${histConfirm ? 'hidden' : ''}>Clear history</button>` : ''}
    </div>
    ${histConfirm ? `<div class="confirm" id="hist-confirm"><p>Clear all ${n} search${n === 1 ? '' : 'es'} on all your devices?</p>
      <div class="actions"><button type="button" class="btn danger" id="hist-clear-yes">Clear</button><button type="button" class="btn quiet" id="hist-clear-no">Cancel</button></div></div>` : ''}
    ${paused ? '<p class="muted hist-note">Recording is paused. New searches won’t be saved.</p>' : ''}
    ${n ? `<ul class="hist-list">${items.map(h => `<li class="hist-row" data-hq="${esc(h.q)}">
      <button type="button" class="hist-q" data-q="${esc(h.q)}"><span class="w" ${qAttr(h.q)}>${esc(h.q)}</span><span class="hist-time">${relTime(h.t)}</span></button>
      <button type="button" class="hist-del" aria-label="Delete ${esc(h.q)}" title="Delete">×</button></li>`).join('')}</ul>`
      : '<p class="muted">No searches yet.</p>'}`);
}
const rowSel = q => `.hist-row[data-hq="${CSS.escape(q)}"]`;
function deleteRow(row, { refocus } = {}) {
  const q = row.dataset.hq;
  const next = row.nextElementSibling?.dataset.hq ?? row.previousElementSibling?.dataset.hq;
  deleteSearch(q);   // re-renders synchronously via Store 'change'
  if (refocus) (next != null ? main.querySelector(rowSel(next) + ' .hist-del') : main.querySelector('#hist-pause'))?.focus();
}

// Registered before the generic #main click handler, so these win.
main.addEventListener('click', e => {
  const t = e.target;
  const goEl = t.closest('[data-go]');
  if (goEl) { e.stopImmediatePropagation(); go(goEl.dataset.go); return; }
  const del = t.closest('.hist-del');
  if (del) { e.stopImmediatePropagation(); deleteRow(del.closest('.hist-row'), { refocus: e.detail === 0 || document.activeElement === del }); return; }
  const id = t.closest('button')?.id;
  if (id === 'hist-clear') { e.stopImmediatePropagation(); histConfirm = true; historyView(); $('#hist-clear-no')?.focus(); }
  else if (id === 'hist-clear-no') { e.stopImmediatePropagation(); histConfirm = false; historyView(); $('#hist-clear')?.focus(); }
  else if (id === 'hist-clear-yes') { e.stopImmediatePropagation(); histConfirm = false; clearHistory(); $('#hist-pause')?.focus(); }
});
main.addEventListener('change', e => { if (e.target.id === 'hist-pause') { setPauseHistory(e.target.checked); $('#hist-pause')?.focus(); } });

// Swipe a history row left to delete it (pointer events: touch, pen and mouse).
let swipe = null, swallowClick = false;
main.addEventListener('pointerdown', e => {
  const row = e.target.closest('.hist-row');
  if (!row || e.button !== 0 || e.target.closest('.hist-del')) return;
  swipe = { row, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false };
});
main.addEventListener('pointermove', e => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { swipe = null; return; }
    if (dx > -10) return;
    swipe.active = true;
    swipe.row.classList.add('swiping');
    try { swipe.row.setPointerCapture(e.pointerId); } catch {}
  }
  swipe.dx = Math.min(0, dx);
  swipe.row.style.transform = `translateX(${swipe.dx}px)`;
});
function endSwipe(e) {
  if (!swipe || e.pointerId !== swipe.id) return;
  const s = swipe; swipe = null;
  if (!s.active) return;
  swallowClick = true; setTimeout(() => { swallowClick = false; }, 300);
  s.row.classList.remove('swiping');
  if (s.dx < -80 && e.type === 'pointerup') {
    s.row.classList.add('gone');
    s.row.style.transform = 'translateX(-110%)';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => { if (s.row.isConnected) deleteRow(s.row); }, reduce ? 0 : 160);
  } else s.row.style.transform = '';
}
main.addEventListener('pointerup', endSwipe);
main.addEventListener('pointercancel', endSwipe);
main.addEventListener('click', e => { if (swallowClick) { swallowClick = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);

// ---------- sheets (in-page dialogs; never alert/confirm/prompt) ----------
let openSheet = null;
function sheet({ title, body, onMount, onClose }) {
  if (openSheet) openSheet.close();
  const prev = document.activeElement;
  const id = 'sheet-' + Math.random().toString(36).slice(2, 8);
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="sheet-head"><h2 id="${id}">${title}</h2><button type="button" class="sheet-x" aria-label="Close">×</button></div>
    <div class="sheet-body">${body}</div></div>`;
  const panel = wrap.firstElementChild;
  const focusables = () => [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); api.close(); }
    else if (e.key === 'Tab') {
      const f = focusables(); if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  const api = {
    el: panel,
    close() {
      if (openSheet !== api) return;
      openSheet = null;
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      document.body.classList.remove('sheet-open');
      onClose?.();
      if (prev && prev.isConnected) prev.focus({ preventScroll: true });
    },
  };
  wrap.addEventListener('click', e => { if (e.target === wrap) api.close(); });
  panel.querySelector('.sheet-x').addEventListener('click', () => api.close());
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(wrap);
  document.body.classList.add('sheet-open');
  openSheet = api;
  onMount?.(panel, api);
  const first = panel.querySelector('[autofocus]') || focusables().find(el => !el.classList.contains('sheet-x'));
  first?.focus();
  return api;
}

function relTime(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString();
}

// ---------- login + account ----------
const acctEl = $('#acct');
function randName() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return 'qamus-' + [...a].map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}
const statusLabel = st => ({
  synced: st.lastSync ? `Synced ${relTime(st.lastSync)}` : 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline — changes are saved on this device and will sync when you reconnect.',
  error: 'Sync problem: ' + (st.error || 'unknown error'),
  local: 'Not syncing',
}[st.status] || st.status);

function renderAcct(st) {
  if (!acctEl) return;
  acctEl.querySelector('.dot').className = 'dot ' + (st.user ? st.status : 'local');
  acctEl.querySelector('.acct-name').textContent = st.user || 'Sign in';
  const label = st.user ? `Account ${st.user} · ${statusLabel(st)}` : 'Sign in to sync';
  acctEl.setAttribute('aria-label', label);
  acctEl.title = label;
  acctEl.dataset.status = st.user ? st.status : 'local';
  renderStat(st);
}

function loginSheet({ onClose } = {}) {
  sheet({
    onClose,
    title: 'Choose a username to sync across devices',
    body: `<p class="muted sheet-note">No password: the username is the key, so pick something hard to guess and use the same one on your other devices.</p>
      <label class="lbl" for="lg-name">Username</label>
      <div class="field-row">
        <input id="lg-name" class="inp" value="${randName()}" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="40" enterkeyhint="go" autofocus>
        <button type="button" class="btn" id="lg-regen" aria-label="Suggest another username" title="Suggest another">↻</button>
      </div>
      <p class="form-msg" id="lg-msg" role="status" aria-live="polite"></p>
      <div class="actions" id="lg-actions"></div>`,
    onMount(p, api) {
      const inp = p.querySelector('#lg-name'), msg = p.querySelector('#lg-msg'), acts = p.querySelector('#lg-actions');
      let checked = null, busy = false;
      const say = (html, err) => { msg.innerHTML = html; msg.classList.toggle('err', !!err); };
      const buttons = list => {
        acts.innerHTML = list.map(([id, label, cls]) => `<button type="button" class="btn ${cls || ''}" id="${id}">${label}</button>`).join('');
      };
      const idle = () => {
        checked = null;
        buttons([['lg-go', 'Continue', 'primary'], ['lg-skip', 'Use without syncing', 'quiet']]);
      };
      const confirmState = (name, kind) => {
        checked = name;
        say(kind === 'existing'
          ? `Welcome back — data on this device will be merged into <b>${esc(name)}</b>.`
          : `New account — nothing is saved under <b>${esc(name)}</b> yet.`);
        p.dataset.check = kind;
        buttons([['lg-confirm', kind === 'existing' ? 'Sign in' : 'Create account', 'primary'], ['lg-change', 'Change name', 'quiet']]);
        p.querySelector('#lg-confirm').focus();
      };
      const go = async () => {
        if (busy) return;
        const name = QamusMerge.normUsername(inp.value);
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
      acts.addEventListener('click', e => {
        const id = e.target.closest('button')?.id;
        if (id === 'lg-go') go();
        else if (id === 'lg-skip') { lsSet('qamus.syncSkipped', '1'); api.close(); }
        else if (id === 'lg-change') { idle(); say(''); delete p.dataset.check; inp.focus(); inp.select(); }
        else if (id === 'lg-confirm' && checked) { Sync.signIn(checked); api.close(); }
      });
      inp.addEventListener('input', () => { if (checked) { idle(); say(''); delete p.dataset.check; } });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checked ? p.querySelector('#lg-confirm')?.click() : go(); } });
      p.querySelector('#lg-regen').addEventListener('click', () => { inp.value = randName(); inp.dispatchEvent(new Event('input')); inp.focus(); });
      idle();
      inp.select();
    },
  });
}

function accountSheet({ onClose } = {}) {
  const st = Sync.state;
  if (!st.user) return loginSheet({ onClose });
  let off = null;
  sheet({
    title: 'Account',
    body: `<p class="acct-user"><span class="muted">Signed in as</span> <b>${esc(st.user)}</b></p>
      <p class="form-msg" id="ac-status" role="status" aria-live="polite"></p>
      <div class="actions" id="ac-main">
        <button type="button" class="btn primary" id="ac-sync">Sync now</button>
        <button type="button" class="btn" id="ac-hist">Search history</button>
        <button type="button" class="btn quiet" id="ac-out">Sign out</button>
      </div>
      <div class="confirm" id="ac-confirm" hidden>
        <p id="ac-q"></p>
        <div class="actions col">
          <button type="button" class="btn danger" id="ac-clear">Sign out and remove data from this device</button>
          <button type="button" class="btn" id="ac-keep">Sign out, keep data here</button>
          <button type="button" class="btn quiet" id="ac-cancel">Cancel</button>
        </div>
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
      const ask = (text, clearLabel) => {
        q.innerHTML = text;
        p.querySelector('#ac-clear').textContent = clearLabel;
        conf.hidden = false;
        p.querySelector('#ac-main').hidden = true;
        p.querySelector('#ac-cancel').focus();
      };
      let force = false;
      const out = async keepData => {
        conf.querySelectorAll('button').forEach(b => { b.disabled = true; });
        q.textContent = 'Signing out…';
        const r = await Sync.signOut({ keepData, force });
        conf.querySelectorAll('button').forEach(b => { b.disabled = false; });
        if (!r.done) {
          force = true;
          return ask('<b>Your latest changes couldn’t be synced.</b> Removing the data now will lose them. Keep it on this device instead, or remove it anyway?', 'Remove anyway');
        }
        api.close();   // the Store 'change' from clearing data redraws the view
      };
      p.addEventListener('click', e => {
        const id = e.target.closest('button')?.id;
        if (id === 'ac-sync') Sync.syncNow();
        else if (id === 'ac-hist') { go('history'); api.close(); }
        else if (id === 'ac-out') {
          const s = Sync.state;
          ask((s.dirty ? '<b>Some changes on this device haven’t synced yet</b>; they’ll be sent first. ' : '') +
            'Remove your words and history from this device? They stay in your account.', 'Sign out and remove data from this device');
        }
        else if (id === 'ac-cancel') { conf.hidden = true; force = false; p.querySelector('#ac-main').hidden = false; p.querySelector('#ac-out').focus(); }
        else if (id === 'ac-clear') out(false);
        else if (id === 'ac-keep') out(true);
      });
    },
    onClose() { off?.(); onClose?.(); },
  });
}

function initSync() {
  if (!Store || !Sync) return;   // sync.js not loaded (e.g. a single-file preview build)
  Store.init().then(() => {
    migrateHist();
    const refresh = () => {
      if (view === 'home') home();
      else if (view === 'history') historyView();
      else if (view === 'settings') settingsView();
      else if (view === 'vocab' || view === 'folder') route();
      // 'study' renders itself; a store change must not flip the card back mid-session
      else if (view === 'result' && hasVocab()) markSaved(main);
      updateTabBadge();
      renderSide();
    };
    Store.on('change', refresh);
    if (sideEl) sideEl.hidden = false;
    const statEl = $('#statusbar'); if (statEl) statEl.hidden = false;
    renderStat(null);
    refresh();
    if (!SYNC_URL) return;
    // re-greet on home when the signed-in user changes (sign-in, sign-out)
    const regreet = st => { if (view === 'home' && (st.user || '') !== greetedUser) home(); };
    Sync.on('status', st => { renderAcct(st); regreet(st); });
    Sync.init({ url: SYNC_URL });
    renderAcct(Sync.state);
    regreet(Sync.state);
    acctEl.hidden = false;
    acctEl.addEventListener('click', () => go('account'));
    if (!Sync.state.user && !lsGet('qamus.syncSkipped')) loginSheet();
  });
}

// ---------- events ----------
let t, blurT;
qEl.addEventListener('input', () => { clearTimeout(blurT); clearTimeout(t); t = setTimeout(renderSuggest, 60); });
qEl.addEventListener('focus', () => { clearTimeout(blurT); renderSuggest(); });   // a pending blur-hide must not hide a fresh list
qEl.addEventListener('blur', () => { clearTimeout(blurT); blurT = setTimeout(() => { sug.hidden = true; }, 150); });
qEl.addEventListener('keydown', e => {
  const lis = sug.querySelectorAll('li');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!lis.length) return; e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % lis.length;
    lis.forEach((li, i) => li.classList.toggle('on', i === sel));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (sel >= 0 && cur[sel]) pick(cur[sel]);
    else { sug.hidden = true; qEl.blur(); go({ q: qEl.value.trim() }); }
  } else if (e.key === 'Escape') sug.hidden = true;
});
sug.addEventListener('pointerdown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); pick(cur[+li.dataset.i]); } });
$('#clear').addEventListener('click', () => { qEl.value = ''; $('#clear').hidden = true; qEl.focus(); renderSuggest(); });
main.addEventListener('click', e => {
  const el = e.target.closest('[data-q],[data-e],[data-pick]'); if (!el) return;
  if (el.dataset.pick) return pick(JSON.parse(el.dataset.pick));
  if (el.dataset.e) return go({ e: el.dataset.e, q: byId.get(+el.dataset.e)?.[1] || '' });
  qEl.value = el.dataset.q; go({ q: el.dataset.q });
});

main.addEventListener('toggle', e => { if (e.target.matches?.('details.lane') && e.target.open) fillLane(e.target); }, true);
document.getElementById('back')?.addEventListener('click', back);

// Hardware keyboard: "/" or ⌘K/Ctrl+K focuses search; Esc steps out of study and folders.
// (Sheets handle their own Esc in the capture phase and call preventDefault, so they win.)
document.addEventListener('keydown', e => {
  if (openSheet || e.defaultPrevented) return;
  const typing = e.target.matches?.('input, textarea, select, [contenteditable="true"]');
  if ((e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault(); qEl.focus(); qEl.select(); return;
  }
  if (e.key !== 'Escape' || typing) return;
  if (view === 'study' && typeof backHash === 'function' && ss) go(backHash());
  else if (view === 'folder') go('vocab');
});

// Service worker. A new version takes over in the background (skipWaiting + clients.claim);
// tell the user instead of reloading under them.
const hadSW = !MEM && 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
function onSWUpdate() {
  if (document.getElementById('update-banner')) return;
  const b = document.createElement('div');
  b.id = 'update-banner'; b.className = 'update-banner'; b.setAttribute('role', 'status');
  b.innerHTML = `<span>Qamus was updated.</span><button type="button" class="btn primary" id="ub-reload">Reload</button>
    <button type="button" class="ub-x" aria-label="Dismiss update notice">×</button>`;
  b.querySelector('#ub-reload').addEventListener('click', () => location.reload());
  b.querySelector('.ub-x').addEventListener('click', () => b.remove());
  document.body.appendChild(b);
}
if (!MEM && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadSW) onSWUpdate(); });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
load().catch(err => { main.innerHTML = `<p>Couldn’t load the dictionary data (${esc(String(err.message || err))}).</p>`; });
initSync();
