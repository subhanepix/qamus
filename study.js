'use strict';
/* Study mode. Browse = the owner's "دع الأيام Vocabulary" flashcard page (flip card, Again / Got it marks, filter chips);
 * Review = SM-2 spaced repetition over cards due today. Marks and reviews live in Store.doc.reviews and sync.
 * Classic script loaded after vocab.js; uses its helpers (folderById, cardsDeep, cardFolder, dayStart, endOfDay, …). */

const MARK_GOT = 1, MARK_AGAIN = 2;
const AGAIN_MS = 10 * 60000;

// ---------- SM-2 scheduling (pure) ----------
// grade: 0 Again, 1 Hard, 2 Good, 3 Easy. Due dates land on local midnight `interval` days from today.
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

// ---------- session ----------
let ss = null;   // the open study session
const studyKey = ids => 'qamus.study.' + [...ids].sort().join(',');
function loadStudyState(key) {
  try { const s = JSON.parse(localStorage.getItem(key) || '{}'); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}
function saveStudyState() {
  if (!ss) return;
  const { group, shuffle, onlyAgain, hideGot, dir } = ss.st;
  const currentId = ss.mode === 'browse' ? ss.deck[ss.idx] || null : ss.st.currentId || null;
  try { localStorage.setItem(ss.key, JSON.stringify({ group, shuffle, onlyAgain, hideGot, dir, currentId })); } catch {}
}
const reviewOf = id => vdoc().reviews[id] || null;
const markOf = id => reviewOf(id)?.mark || 0;
const cardById = id => liveCards().find(c => c.id === id) || null;
function shuffled(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function scopeCards() {   // cards in the chosen group (a folder chip, with its sub-folders), oldest first
  const groupIds = ss.st.group && ss.groups.some(g => g.id === ss.st.group)
    ? new Set([ss.st.group, ...descendants(ss.st.group)]) : ss.scope;
  return liveCards().filter(c => groupIds.has(cardFolder(c))).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}
function buildDeck(keepId) {
  if (ss.mode === 'browse') {
    let list = scopeCards();
    if (ss.st.onlyAgain) list = list.filter(c => markOf(c.id) === MARK_AGAIN);
    if (ss.st.hideGot) list = list.filter(c => markOf(c.id) !== MARK_GOT);
    ss.deck = (ss.st.shuffle ? shuffled(list) : list).map(c => c.id);
    const at = keepId ? ss.deck.indexOf(keepId) : -1;
    ss.idx = at >= 0 ? at : 0;
  } else {
    const eod = endOfDay(Date.now());
    const cards = scopeCards().filter(c => !cardPaused(c));
    const due = cards.filter(c => reviewOf(c.id)?.last && reviewOf(c.id).due <= eod).sort((a, b) => reviewOf(a.id).due - reviewOf(b.id).due);
    const fresh = cards.filter(c => !reviewOf(c.id)?.last);
    const q = [...due, ...fresh].map(c => c.id);
    ss.deck = ss.st.shuffle ? shuffled(q) : q;
    ss.idx = 0; ss.reviewed = new Set(); ss.again = 0;
    ss.done = !ss.deck.length;
  }
  ss.flipped = false;
}

function studyView(rawIds, rawMode) {
  const mode = rawMode === 'review' ? 'review' : 'browse';
  const ids = [...new Set(rawIds)].filter(id => folderById(id));
  if (!ids.length) {
    renderKeepingFocus('study-missing', `<p class="muted">Those folders no longer exist.</p><button type="button" class="btn" data-go="vocab">Back to Vocab</button>`);
    return;
  }
  const key = studyKey(ids);
  if (!ss || ss.key !== key || ss.mode !== mode || view !== 'study') {
    const scope = new Set(ids.flatMap(id => [id, ...descendants(id)]));
    const groups = [...scope].map(folderById).filter(Boolean)
      .filter(f => cardsDeep(f.id).length).sort((a, b) => folderPath(a.id).localeCompare(folderPath(b.id), ['ar', 'en']));
    const saved = loadStudyState(key);
    ss = {
      ids, mode, key, scope, groups, deck: [], idx: 0, flipped: false, reviewed: new Set(), again: 0, done: false,
      st: { group: saved.group || '', shuffle: !!saved.shuffle, onlyAgain: !!saved.onlyAgain, hideGot: !!saved.hideGot,
        dir: saved.dir === 'en' ? 'en' : 'ar', currentId: saved.currentId || null },
      confirmClear: false, suppress: false,
    };
    buildDeck(ss.st.currentId);
  }
  renderStudy();
}

// ---------- rendering ----------
const AR_RUN = /([؀-ۿ«»][؀-ۿً-ٟ\s«»،.=]*[؀-ۿ«»])/g;
const arabicify = s => esc(s).replace(AR_RUN, '<span lang="ar">$1</span>');
// Find `phrase` in `text` ignoring harakat, tatweel and hamza spelling; returns [start, end) in `text`.
function looseFind(text, phrase) {
  const target = norm(phrase || '');
  if (!target) return null;
  const skip = new RegExp(DIAC.source);
  const map = [];
  let flat = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (skip.test(ch)) continue;
    flat += norm(ch) || ch;
    map.push(i);
  }
  const at = flat.indexOf(target);
  if (at < 0) return null;
  let end = map[at + target.length - 1] + 1;
  while (end < text.length && skip.test(text[end])) end++;
  return [map[at], end];
}
function markedContext(c) {
  const t = c.context || '';
  const hit = looseFind(t, c.highlight) || looseFind(t, c.word);
  return hit ? esc(t.slice(0, hit[0])) + '<mark>' + esc(t.slice(hit[0], hit[1])) + '</mark>' + esc(t.slice(hit[1])) : esc(t);
}
function badgeFor(c) {
  if (ss.mode === 'browse') {
    const m = markOf(c.id);
    return m === MARK_GOT ? '<span class="st-badge got">Got it</span>' : m === MARK_AGAIN ? '<span class="st-badge again">Again</span>' : '<span></span>';
  }
  const st = cardStatus(c);
  return st.k === 'new' ? '<span class="st-badge new">New</span>' : '<span class="st-badge due">Due</span>';
}
function cardHtml(c) {
  const pos = `${ss.idx + 1} / ${ss.deck.length}`;
  const where = ss.groups.length > 1 ? ' · ' + esc(folderById(cardFolder(c))?.name || '') : '';
  const meta = `<div class="st-meta"><span>${pos}${where}</span>${badgeFor(c)}</div>`;
  const lines = (c.gloss || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  const inText = c.highlight && c.highlight.trim() !== c.word.trim()   // like the reference: any written difference (e.g. case ending) counts
    ? `<div class="st-intext"><span class="k">In the text</span><span lang="ar">${esc(c.highlight)}</span></div>` : '';
  const front = ss.st.dir === 'en'
    ? `<p class="st-front-en" dir="auto">${lines.length ? lines.map(esc).join('<br>') : '<span class="muted">(no meaning saved)</span>'}</p>`
    : `<p class="st-word" lang="ar">${esc(c.word)}</p>${inText}`;
  const back = `
    <p class="st-bword" lang="ar">${esc(c.word)}</p>
    ${c.arGloss ? `<p class="st-argloss" lang="ar">${esc(c.arGloss)}</p>` : ''}
    ${lines.map(l => `<p class="st-en" dir="auto">${esc(l)}</p>`).join('')}
    ${c.translit ? `<p class="st-lit"><span class="k">Transliteration</span>${esc(c.translit)}</p>` : ''}
    ${c.note ? `<div class="st-note"><span class="k">Note.</span> ${arabicify(c.note)}</div>` : ''}
    ${c.context ? `<div class="st-context"><span class="k">In the text</span><div class="st-ctx" dir="auto">${markedContext(c)}</div></div>` : ''}
    ${c.root ? `<p class="st-root">Root <a class="st-rootlink" lang="ar" href="#${esc(new URLSearchParams({ q: c.root }).toString())}" data-root="${esc(c.root)}" tabindex="${ss.flipped ? 0 : -1}">${esc(c.root)}</a></p>` : ''}`;
  return `<div class="st-card ${ss.flipped ? 'flipped' : ''}" id="st-card" role="button" tabindex="0" aria-label="Flashcard ${pos}, tap to flip">
    <div class="st-face st-front" aria-hidden="${ss.flipped}">${meta}<div class="st-front-body">${front}</div>
      <div class="st-hint">${ss.mode === 'review' ? 'Tap to show the answer' : 'Tap to see the meaning'}</div></div>
    <div class="st-face st-back" aria-hidden="${!ss.flipped}">${meta}${back}</div></div>`;
}
function stageHtml() {
  if (ss.mode === 'review' && ss.done) {
    const now = Date.now(), eodT = endOfDay(now, 1);
    const tomorrow = scopeCards().filter(c => { if (cardPaused(c)) return false; const r = reviewOf(c.id); return !r?.last || r.due <= eodT; }).length;
    const n = ss.reviewed.size;
    return `<div class="st-done">
      <h2>${n ? 'Done for today' : scopeCards().length && scopeCards().every(cardPaused) ? 'Reviews are paused here' : 'Nothing due today'}</h2>
      ${n ? `<p>${plural(n, 'card')} reviewed${ss.again ? ` · ${ss.again} again` : ''}.</p>` : ''}
      <p><b id="st-tomorrow">${tomorrow}</b> due tomorrow.</p>
      <div class="actions"><button type="button" class="btn" data-go="${esc(backHash())}">${ss.ids.length > 1 ? 'Back to Vocab' : 'Back to folder'}</button>
      <button type="button" class="btn primary" data-st-mode="browse">Browse all</button></div></div>`;
  }
  if (!ss.deck.length) {
    const msg = ss.st.onlyAgain ? 'No cards marked “again” here yet.' : ss.st.hideGot ? 'Every card here is marked “got it”.' : 'No cards here yet.';
    return `<div class="st-empty">${msg}<br>${ss.st.onlyAgain || ss.st.hideGot ? 'Change a filter above to see more.' : 'Save words from the dictionary to study them.'}</div>`;
  }
  const c = cardById(ss.deck[ss.idx]);
  return c ? cardHtml(c) : '<div class="st-empty">This card was deleted.</div>';
}
function controlsHtml() {
  const has = ss.deck.length && !(ss.mode === 'review' && ss.done);
  if (ss.mode === 'browse') {
    const m = has ? markOf(ss.deck[ss.idx]) : 0;
    return `<button type="button" class="st-btn nav" id="st-prev" data-key="←" aria-label="Previous card" ${has && ss.idx > 0 ? '' : 'disabled'}>‹</button>
      <button type="button" class="st-btn again" id="st-again" data-key="1" aria-pressed="${m === MARK_AGAIN}" ${has ? '' : 'disabled'}>Again</button>
      <button type="button" class="st-btn got" id="st-got" data-key="2" aria-pressed="${m === MARK_GOT}" ${has ? '' : 'disabled'}>Got it</button>
      <button type="button" class="st-btn nav" id="st-next" data-key="→" aria-label="Next card" ${has && ss.idx < ss.deck.length - 1 ? '' : 'disabled'}>›</button>`;
  }
  if (!has) return '';
  if (!ss.flipped) return `<button type="button" class="st-btn show" id="st-show" data-key="Space">Show answer</button>`;
  const prev = reviewOf(ss.deck[ss.idx]);
  return ['Again', 'Hard', 'Good', 'Easy'].map((l, g) => `<button type="button" class="st-btn grade g${g}" id="st-g${g}" data-key="${g + 1}">
    <span>${l}</span><small>${esc(intervalLabel(prev, g))}</small></button>`).join('');
}
function tallyHtml() {
  if (ss.mode === 'review') {
    const left = ss.done ? 0 : ss.deck.length - ss.idx;
    return `<span>${plural(left, 'card')} left</span><span class="t-good"><b>${ss.reviewed.size}</b> reviewed</span><span class="t-again"><b>${ss.again}</b> again</span>`;
  }
  const scope = scopeCards();
  const got = scope.filter(c => markOf(c.id) === MARK_GOT).length, again = scope.filter(c => markOf(c.id) === MARK_AGAIN).length;
  return `<span>${plural(scope.length, 'card')}</span><span class="t-good"><b>${got}</b> got it</span><span class="t-again"><b>${again}</b> again</span>`;
}
const backHash = () => (ss.ids.length > 1 ? 'vocab' : 'folder=' + ss.ids[0]);
function chip(id, label, pressed, extra = '') {
  return `<button type="button" class="st-chip" id="${id}" aria-pressed="${pressed}" ${extra}>${label}</button>`;
}
function renderStudy() {
  const title = ss.ids.length > 1 ? `${ss.ids.length} folders` : folderById(ss.ids[0]).name;
  const browse = ss.mode === 'browse';
  renderKeepingFocus('study', `<div class="study ${ss.mode}">
    <header class="st-head">
      <button type="button" class="crumb st-backlink" data-go="${esc(backHash())}">‹ ${ss.ids.length > 1 ? 'Vocab' : esc(title)}</button>
      <h2 class="st-title" dir="auto">${esc(title)}</h2>
      <div class="st-sub"><span>${browse ? 'Browse' : 'Review · spaced repetition'}</span><span class="st-tally" id="st-tally">${tallyHtml()}</span></div>
    </header>
    <section class="st-filters" aria-label="Study options">
      <div class="st-row st-modes" role="group" aria-label="Mode"><span class="st-seg">
        ${chip('st-mode-browse', 'Browse', browse, 'data-st-mode="browse"')}${chip('st-mode-review', 'Review', !browse, 'data-st-mode="review"')}</span>
        <button type="button" class="st-chip" id="st-dir" aria-label="Direction: ${ss.st.dir === 'en' ? 'English to Arabic' : 'Arabic to English'}. Switch">${ss.st.dir === 'en' ? 'English → Arabic' : 'Arabic → English'}</button>
      </div>
      ${ss.groups.length > 1 ? `<div class="st-row" role="group" aria-label="Filter by folder">
        ${chip('st-grp-all', 'All', !ss.st.group, 'data-st-group=""')}
        ${ss.groups.map(g => chip('st-grp-' + g.id, `<span dir="auto">${esc(g.name)}</span>`, ss.st.group === g.id, `data-st-group="${esc(g.id)}"`)).join('')}</div>` : ''}
      <div class="st-row"><span class="st-label">Show</span>
        ${chip('st-shuffle', 'Shuffle', ss.st.shuffle)}
        ${browse ? chip('st-onlyagain', 'Only “again”', ss.st.onlyAgain) + chip('st-hidegot', 'Hide “got it”', ss.st.hideGot) : ''}</div>
    </section>
    <div class="st-stage" id="st-stage">${stageHtml()}</div>
    <div class="st-foot"><span class="st-hint">Tap the card to flip · ← → to move · space to flip${browse ? ' · 1 again · 2 got it' : ' · 1–4 to grade'}</span>
      ${browse ? `<span id="st-reset">${ss.confirmClear
        ? `<span class="st-confirm">Clear every mark? <button type="button" class="danger" id="st-clear-yes">Clear</button><button type="button" id="st-clear-no">Keep</button></span>`
        : '<button type="button" class="st-linkish" id="st-clear">Clear all marks</button>'}</span>` : ''}</div>
    <p class="sr-only" aria-live="polite" id="st-live">${ss.deck.length && !ss.done ? `Card ${ss.idx + 1} of ${ss.deck.length}` : ''}</p>
    <nav class="st-controls" aria-label="Card controls"><div class="st-inner ${ss.mode}">${controlsHtml()}</div></nav>
  </div>`);
  saveStudyState();
}

// ---------- actions ----------
function flip() {
  if (!ss || ss.suppress || !ss.deck.length || ss.done) return;
  ss.flipped = !ss.flipped;
  const el = $('#st-card');
  if (!el) return;
  el.classList.toggle('flipped', ss.flipped);
  el.querySelector('.st-front').setAttribute('aria-hidden', ss.flipped);
  el.querySelector('.st-back').setAttribute('aria-hidden', !ss.flipped);
  el.querySelector('.st-rootlink')?.setAttribute('tabindex', ss.flipped ? '0' : '-1');
  if (ss.mode === 'review') {   // Show answer ⇄ grade buttons
    const inner = main.querySelector('.st-inner');
    const hadFocus = inner.contains(document.activeElement);
    inner.innerHTML = controlsHtml();
    if (hadFocus) inner.querySelector('button')?.focus();
  }
}
function move(d) {
  if (!ss || ss.mode !== 'browse') return;
  const n = ss.idx + d;
  if (n < 0 || n >= ss.deck.length) return;
  ss.idx = n; ss.flipped = false;
  renderStudy();
}
function setMark(kind) {
  if (!ss.deck.length) return;
  const id = ss.deck[ss.idx];
  const next = markOf(id) === kind ? 0 : kind;
  Store.mutate(d => {
    const r = { ...(d.reviews[id] || {}), updatedAt: Date.now() };
    if (next) r.mark = next; else delete r.mark;
    d.reviews[id] = r;
  });
  const gone = (ss.st.onlyAgain && next !== MARK_AGAIN) || (ss.st.hideGot && next === MARK_GOT);
  if (gone) {
    ss.deck.splice(ss.idx, 1);
    if (ss.idx >= ss.deck.length) ss.idx = Math.max(0, ss.deck.length - 1);
    ss.flipped = false;
    return renderStudy();
  }
  renderStudy();
  if (next && ss.idx < ss.deck.length - 1) {
    const s = ss;
    setTimeout(() => { if (ss === s && view === 'study' && ss.deck[ss.idx] === id) move(1); }, 260);
  }
}
function gradeCard(g) {
  if (!ss || ss.mode !== 'review' || ss.done || !ss.flipped) return;
  const id = ss.deck[ss.idx], now = Date.now();
  Store.mutate(d => { d.reviews[id] = schedule(d.reviews[id], g, now); });
  ss.reviewed.add(id);
  if (g === 0) { ss.again++; ss.deck.splice(Math.min(ss.deck.length, ss.idx + 4), 0, id); }
  ss.idx++; ss.flipped = false;
  if (ss.idx >= ss.deck.length) ss.done = true;
  renderStudy();
  (main.querySelector('#st-show') || main.querySelector('.st-done button.primary'))?.focus({ preventScroll: true });
}
function clearMarks() {
  const ids = new Set(liveCards().filter(c => ss.scope.has(cardFolder(c))).map(c => c.id));
  Store.mutate(d => {
    const now = Date.now();
    for (const id of ids) if (d.reviews[id]?.mark) { const r = { ...d.reviews[id], updatedAt: now }; delete r.mark; d.reviews[id] = r; }
  });
  ss.confirmClear = false;
  buildDeck(ss.deck[ss.idx]);
  renderStudy();
}

// ---------- events ----------
main.addEventListener('click', e => {
  if (view !== 'study' || !ss) return;
  const t = e.target;
  const rl = t.closest('.st-rootlink');
  if (rl) { e.preventDefault(); qEl.value = rl.dataset.root; go({ q: rl.dataset.root }); return; }
  if (t.closest('#st-card')) { flip(); return; }
  const modeB = t.closest('[data-st-mode]');
  if (modeB) { if (modeB.dataset.stMode !== ss.mode) go(studyHash(ss.ids, modeB.dataset.stMode)); return; }
  const grp = t.closest('[data-st-group]');
  if (grp) { ss.st.group = grp.dataset.stGroup; buildDeck(); renderStudy(); return; }
  const id = t.closest('button')?.id;
  const keep = () => ss.deck[ss.idx];
  switch (id) {
    case 'st-prev': return move(-1);
    case 'st-next': return move(1);
    case 'st-again': return setMark(MARK_AGAIN);
    case 'st-got': return setMark(MARK_GOT);
    case 'st-show': return flip();
    case 'st-g0': case 'st-g1': case 'st-g2': case 'st-g3': return gradeCard(+id.slice(-1));
    case 'st-dir': ss.st.dir = ss.st.dir === 'en' ? 'ar' : 'en'; ss.flipped = false; return renderStudy();
    case 'st-shuffle': ss.st.shuffle = !ss.st.shuffle; buildDeck(keep()); return renderStudy();
    case 'st-onlyagain': ss.st.onlyAgain = !ss.st.onlyAgain; if (ss.st.onlyAgain) ss.st.hideGot = false; buildDeck(keep()); return renderStudy();
    case 'st-hidegot': ss.st.hideGot = !ss.st.hideGot; if (ss.st.hideGot) ss.st.onlyAgain = false; buildDeck(keep()); return renderStudy();
    case 'st-clear': ss.confirmClear = true; renderStudy(); return $('#st-clear-no')?.focus();
    case 'st-clear-no': ss.confirmClear = false; renderStudy(); return $('#st-clear')?.focus();
    case 'st-clear-yes': clearMarks(); return $('#st-clear')?.focus();
  }
});
document.addEventListener('keydown', e => {
  if (view !== 'study' || !ss || openSheet) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  const onButton = t.closest?.('button, a');
  if (onButton && (e.key === ' ' || e.key === 'Enter')) return;   // let the focused control act
  const k = e.key;
  if (k === 'ArrowRight') { e.preventDefault(); move(1); }
  else if (k === 'ArrowLeft') { e.preventDefault(); move(-1); }
  else if (k === ' ' || (k === 'Enter' && t.id === 'st-card')) { e.preventDefault(); flip(); }
  else if (ss.mode === 'browse' && (k === '1' || k === '2')) setMark(k === '1' ? MARK_AGAIN : MARK_GOT);
  else if (ss.mode === 'review' && /^[1-4]$/.test(k)) gradeCard(+k - 1);
});
// Swipe the card left/right to move (touch, pen or mouse), as on the reference page.
let stSwipe = null;
main.addEventListener('pointerdown', e => {
  if (view !== 'study' || !e.target.closest('#st-stage')) return;
  stSwipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
main.addEventListener('pointerup', e => {
  if (!stSwipe || e.pointerId !== stSwipe.id) return;
  const dx = e.clientX - stSwipe.x, dy = e.clientY - stSwipe.y;
  stSwipe = null;
  if (!ss || ss.mode !== 'browse' || Math.abs(dx) <= 60 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
  ss.suppress = true;
  setTimeout(() => { if (ss) ss.suppress = false; }, 450);
  move(dx < 0 ? 1 : -1);
});
main.addEventListener('pointercancel', () => { stSwipe = null; });
