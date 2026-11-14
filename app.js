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
const SYNC_URL = lsGet('qamus.syncUrl') ?? '';
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
function go(params) {
  const h = new URLSearchParams(params).toString();
  if (MEM) { if (memCur && memCur !== h) memStack.push(memCur); memCur = h; return route(); }
  if (location.hash === '#' + h) route(); else location.hash = '#' + h;
}
function back() { if (memStack.length) { memCur = memStack.pop(); route(); } else { memCur = ''; qEl.value = ''; route(); } }
if (!MEM) window.addEventListener('hashchange', route);
function route() {
  const p = new URLSearchParams(MEM ? memCur : location.hash.slice(1));
  const bk = document.getElementById('back'); if (bk) bk.hidden = !memCur;
  const q = p.get('q') || '';
  if (q && qEl.value !== q && document.activeElement !== qEl) qEl.value = q;
  $('#clear').hidden = !qEl.value;
  if (!HW) { if (q || p.get('e') || p.get('f') || p.get('w')) main.innerHTML = '<p class="muted">Loading dictionary…</p>'; else home(); return; }
  if (p.get('e')) return showEntry(+p.get('e'));
  if (p.get('f')) { const f = HW.forms[+p.get('f')]; return showRoots([f[0]], { forms: [f] }, q); }
  if (p.get('w')) { if (!W) { main.innerHTML = '<p class="muted">Loading Wiktionary…</p>'; return; } const k = +p.get('w'); return showRoots(wRoots(k), { wikt: [k] }, q); }
  if (q) return search(q);
  home();
}

// ---------- views ----------
function home() {
  const h = history_();
  main.innerHTML = `<div class="empty muted"><p>Type an Arabic word, a root like <span lang="ar">ك ت ب</span>, or an English word.</p>
    <p style="font-size:14px">Hamzas, harakat, ة/ه and ى/ي don’t matter. Prefixes and suffixes are stripped automatically.</p></div>
    ${h.length ? `<h2 class="sec">Recent</h2><div class="history">${h.map(w => `<button lang="ar" data-q="${esc(w)}">${esc(w)}</button>`).join('')}</div>` : ''}`;
}
function history_() { try { return JSON.parse(localStorage.getItem('hist') || '[]'); } catch { return []; } }
function remember(w) {
  try { const h = history_().filter(x => x !== w); h.unshift(w); localStorage.setItem('hist', JSON.stringify(h.slice(0, 30))); } catch {}
}

function search(q) {
  q = q.trim(); if (!q) return home();
  remember(q);
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

function showEntry(id) {
  const e = byId.get(id); if (!e) return home();
  showRoots([e[4]], { hits: new Set([id]) }, e[1]);
}

function showRoots(rootIds, opt, q) {
  const { hits = new Set(), forms = [], parses = [], bwOnly = [], wikt = [], laneOnly = [], laneWord = '' } = opt;
  main.dataset.empty = '';
  lastLaneWord = laneWord;
  let h = '';
  if (wikt.length) h += `<h2 class="sec">Wiktionary</h2>` + wikt.map(wCard).join('');
  if (parses.length) {
    h += `<h2 class="sec">Parsed</h2>` + uniqParses(parses).slice(0, 4).map(parseHtml).join('');
  }
  const extra = uniqParses(bwOnly).slice(0, 6);
  if (extra.length && !rootIds.length) h += `<h2 class="sec">Lexicon</h2>` + extra.map(bwCard).join('');
  if (rootIds.length) h += `<h2 class="sec">${rootIds.length > 1 ? 'Roots' : 'Root'}</h2>`;
  rootIds.forEach((rid, k) => { h += rootCard(rid, hits, forms, k === 0 || rootIds.length <= 2); });
  if (extra.length && rootIds.length) h += `<h2 class="sec">Also in lexicon</h2>` + extra.map(bwCard).join('');
  if (laneOnly.length) h += `<h2 class="sec">Lane’s Lexicon</h2>` + laneOnly.map(lr => laneBlock(lr, true)).join('');
  main.innerHTML = h || '<p class="muted">Nothing found.</p>';
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
  return `<div class="bw"><span class="w" lang="ar">${esc(a.stem[4] || a.stem[0])}</span> ${esc(a.stem[2].replace(/;/g, '; '))}
    <div class="muted" style="font-size:14px">${R ? `root <span lang="ar">${esc(R)}</span> · ` : ''}not in Hans Wehr</div></div>`;
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
  return `<div class="bw"><span class="w" lang="ar">${esc(e[0])}</span>${e[1] ? ` <i class="muted">${esc(e[1])}</i>` : ''}
    <div class="def wk">${defHtml(e[2], ['i', 'br', 'ol', 'li'])}</div>
    ${R ? `<div class="muted" style="font-size:14px">root <span lang="ar">${esc(R)}</span></div>` : ''}</div>`;
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
    body.innerHTML = items.length ? items.map(([w, def]) => {
      const hit = lastLaneWord && (norm(w) === lastLaneWord || norm((def.match(/^[\u0600-\u06FF\u064B-\u0652 ]+/) || [''])[0]) === lastLaneWord);
      return `<div class="word lane-entry ${hit ? 'hit' : ''}"><span class="def">${defHtml(def, ['i', 'br', 'table', 'tbody', 'tr', 'td', 'center'])}</span></div>`;
    }).join('') : '<p class="muted">No entries.</p>';
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
function rootCard(rid, hits, hitForms, open) {
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
    h += `<div class="word ${hits.has(rid) ? 'hit' : ''}" id="w${rid}"><span class="hw" lang="ar">${esc(root[1])}</span> <span class="def">${defHtml(formI)}</span></div>`;
  }
  if (fs.length) {
    h += `<table class="forms">` + fs.map(f => `<tr class="${hitForms.includes(f) ? 'hit' : ''}"><td class="num">${f[1]}</td><td class="verb" lang="ar">${esc(f[2])}</td><td class="def">${defHtml(f[3])}</td></tr>`).join('') + `</table>`;
  }
  h += ks.map(k => `<div class="word ${hits.has(k[0]) ? 'hit' : ''}" id="w${k[0]}"><span class="hw" lang="ar">${esc(k[1])}</span><span class="def">${defHtml(stripHead(k))}</span></div>`).join('');
  h += laneBlock(norm(root[1]), false);
  const lat = bwRoot(rid);
  h += `<div class="links"><a href="https://ejtaal.net/aa/#q=${encodeURIComponent(lat)}" target="_blank" rel="noopener">Lane &amp; others (ejtaal)</a>
    <a href="https://corpus.quran.com/qurandictionary.jsp?q=${encodeURIComponent(lat)}" target="_blank" rel="noopener">Qur’an corpus</a></div>`;
  return h + `</div></details>`;
}

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
}

function loginSheet() {
  sheet({
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

function accountSheet() {
  const st = Sync.state;
  if (!st.user) return loginSheet();
  let off = null;
  sheet({
    title: 'Account',
    body: `<p class="acct-user"><span class="muted">Signed in as</span> <b>${esc(st.user)}</b></p>
      <p class="form-msg" id="ac-status" role="status" aria-live="polite"></p>
      <div class="actions" id="ac-main">
        <button type="button" class="btn primary" id="ac-sync">Sync now</button>
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
        api.close();
        route();
      };
      p.addEventListener('click', e => {
        const id = e.target.closest('button')?.id;
        if (id === 'ac-sync') Sync.syncNow();
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
    onClose() { off?.(); },
  });
}

function initSync() {
  if (!Store || !Sync) return;   // sync.js not loaded (e.g. a single-file preview build)
  Store.init().then(() => {
    if (!SYNC_URL) return;
    Sync.on('status', renderAcct);
    Sync.init({ url: SYNC_URL });
    renderAcct(Sync.state);
    acctEl.hidden = false;
    acctEl.addEventListener('click', accountSheet);
    if (!Sync.state.user && !lsGet('qamus.syncSkipped')) loginSheet();
  });
}

// ---------- events ----------
let t;
qEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderSuggest, 60); });
qEl.addEventListener('focus', renderSuggest);
qEl.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 150));
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
if (!MEM && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
load().catch(err => { main.innerHTML = `<p>Couldn’t load the dictionary data (${esc(String(err.message || err))}).</p>`; });
initSync();
