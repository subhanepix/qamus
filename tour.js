// First-time guided demo: a welcome card, then a few steps that use the real app (a sample search for كتاب,
// the highlighted result, the bookmark, Vocab, a sample flashcard, Settings), then a closing card.
// Skippable at any point with Skip or Esc, and replayable from Settings. Runs once per device:
// localStorage 'qamus.introDone'. app.js passes in what the tour needs (ctx), so this module has no globals.

let on = false;   // while true, the demo search isn't recorded in history
export const isTouring = () => on;

// ctx: { lsGet, lsSet, oldHome, used(), sync, go(hash), view(), intervalLabel(prev, grade) }
export function shouldTour(ctx) {
  if (ctx.lsGet('qamus.introDone') || ctx.oldHome) return false;   // the old address only points to the new one
  if (location.hash.length > 1) return false;                         // opened on a link: don't get in the way
  return !ctx.used();
}

export function startTour(ctx, { onDone } = {}) {
  if (on || document.getElementById('tour')) return;
  on = true;
  const sync = !!ctx.sync;
  const wait = (test, ms = 8000) => new Promise(res => {
    const t0 = Date.now();
    const tick = () => { const el = test(); if (el || Date.now() - t0 > ms) res(el); else setTimeout(tick, 80); };
    tick();
  });
  const visible = sel => [...document.querySelectorAll(sel)].find(el => el.offsetParent !== null && el.getBoundingClientRect().width);
  const label = k => ctx.intervalLabel ? ctx.intervalLabel(null, k) : ['<10m', '1d', '1d', '4d'][k];
  const STEPS = [
    { card: true, title: 'أهلًا وسهلًا', body: 'Qamus looks words up in Hans Wehr, Lane’s Lexicon, Wiktionary, al-Mufradāt and Mukhtār al-Ṣiḥāḥ, all from one search. Here’s a 30-second tour.', next: 'Show me', back: 'Skip tour' },
    { target: () => visible('#q'), title: 'Search anything', body: 'Type an Arabic word in any form: prefixes and endings come off by themselves, and harakat put the reading you mean first. A root like ك ت ب or an English word works too. Let’s look up <span lang="ar">كتاب</span>.', next: 'Search كتاب' },
    { before: async () => { ctx.go('q=' + encodeURIComponent('كتاب')); await wait(() => visible('main .entry-row.hit')); },
      target: () => visible('main .entry-row.hit') || visible('main .entry-row'), title: 'Results by root', body: 'Words are grouped under their root, and the one you searched is highlighted. Tap any Arabic word in a definition to look it up.' },
    { target: () => visible('main .entry-row.hit .bm-btn') || visible('main .bm-btn'), title: 'Save words', body: 'The bookmark saves a word to a folder, with its meaning and root filled in.' },
    { target: () => visible('[data-nav-tab="vocab"]'), title: 'Study them', body: 'Your saved words live in Vocab, in folders you make. Open a folder to study it, or review everything that’s due.' },
    // A working sample flashcard, so a new user sees review before they've saved anything (nothing is stored)
    { center: true, title: 'Flashcards, like Anki', body: 'Tap the card to see the meaning, then say how well you knew it. Spaced review brings each word back just before you’d forget it.',
      extra: () => `<div class="tf">
        <button type="button" class="tf-card" id="tf-card" aria-pressed="false" aria-label="Sample flashcard: كِتَاب. Tap to show the meaning.">
          <span class="tf-face tf-front"><span class="tf-w" lang="ar">كِتَاب</span><small>Tap to show the meaning</small></span>
          <span class="tf-face tf-back"><span class="tf-gl">book; piece of writing, letter</span><small>root <span lang="ar">ك ت ب</span> · pl. <span lang="ar">كُتُب</span></small></span>
        </button>
        <div class="tf-grades" id="tf-grades" hidden>${['Again', 'Hard', 'Good', 'Easy'].map((g, k) =>
          `<button type="button" class="tf-g" data-g="${k}">${g}<small>${label(k)}</small></button>`).join('')}</div>
        <p class="tf-note" id="tf-note" aria-live="polite"></p></div>` },
    { target: () => visible('[data-nav-tab="settings"]'), title: 'Make it yours', body: 'Pick a theme and an Arabic typeface, change the text size, and turn dictionaries on or off or put them in your order.' },
    sync
      ? { card: true, before: async () => { ctx.go(''); }, title: 'Keep your words everywhere', body: 'Pick a username to sync your words across your devices. No password: we’ll suggest one that’s hard to guess.', next: 'Choose a username', back: 'Maybe later', last: true }
      : { card: true, before: async () => { ctx.go(''); }, title: 'That’s it', body: 'Search for a word to get started.', next: 'Start searching', last: true },
  ];

  const root = document.createElement('div');
  root.id = 'tour';
  root.innerHTML = `<div class="tour-hole" aria-hidden="true"></div>
    <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <p class="tour-count"></p><h2 id="tour-title" class="tour-title"></h2><p id="tour-body" class="tour-body"></p><div id="tour-extra"></div>
      <div class="tour-actions"><button type="button" class="btn quiet" id="tour-back"></button><button type="button" class="btn primary" id="tour-next"></button></div>
      <button type="button" class="tour-x" id="tour-skip" aria-label="Skip the tour">✕</button></div>`;
  document.body.appendChild(root);
  document.body.classList.add('touring');
  const hole = root.querySelector('.tour-hole'), pop = root.querySelector('.tour-pop');
  const lastFocus = document.activeElement;
  let i = 0, target = null, busy = false;

  const place = () => {
    const vw = window.innerWidth, vh = window.innerHeight, m = 12;
    root.classList.toggle('card', !target);
    if (!target) {
      hole.hidden = true;
      pop.classList.add('center');
      pop.style.left = pop.style.top = pop.style.width = '';
      return;
    }
    const r = target.getBoundingClientRect(), pad = 6;
    hole.hidden = false;
    Object.assign(hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    pop.classList.remove('center');
    const pw = Math.min(360, vw - m * 2);
    pop.style.width = pw + 'px';
    const ph = pop.offsetHeight;
    const below = r.bottom + pad + 10, above = r.top - pad - 10 - ph;
    const top = below + ph <= vh - m ? below : above >= m ? above : Math.max(m, vh - ph - m);
    const left = Math.min(Math.max(m, r.left + r.width / 2 - pw / 2), vw - pw - m);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  };
  const finish = openSignIn => {
    ctx.lsSet('qamus.introDone', '1');
    on = false;
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    document.body.classList.remove('touring');
    if (ctx.view() === 'result') ctx.go('');            // leave the demo search; nothing was recorded
    else lastFocus?.focus?.();
    onDone?.({ signIn: !!openSignIn });
  };
  const show = async k => {
    if (busy) return;
    busy = true;
    i = k;
    const s = STEPS[i];
    if (s.before) {   // e.g. the sample search loading: Next is disabled meanwhile, so a tap isn't lost silently
      pop.classList.add('busy');
      pop.querySelectorAll('button').forEach(b => { b.disabled = true; });
      await s.before();
      pop.classList.remove('busy');
      pop.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
    target = s.card || s.center ? null : (s.target?.() || null);
    if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' });
    const n = STEPS.filter(x => !x.card).length, pos = STEPS.slice(0, i + 1).filter(x => !x.card).length;
    root.querySelector('.tour-count').textContent = s.card ? '' : `${pos} of ${n}`;
    root.querySelector('#tour-title').innerHTML = s.title;
    root.querySelector('#tour-title').lang = /[؀-ۿ]/.test(s.title) && !/[a-z]/i.test(s.title) ? 'ar' : '';
    root.querySelector('#tour-body').innerHTML = s.body;
    root.querySelector('#tour-extra').innerHTML = s.extra ? s.extra() : '';
    const back = root.querySelector('#tour-back'), next = root.querySelector('#tour-next');
    next.textContent = s.next || 'Next';
    back.textContent = s.back || 'Back';
    back.hidden = !s.back && i === 0;
    root.querySelector('#tour-skip').hidden = !!s.card;
    place();
    busy = false;
    next.focus();
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    else if (e.key === 'Tab') {   // keep focus inside the card
      const f = [...pop.querySelectorAll('button')].filter(b => !b.hidden);
      const at = f.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && at === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
    else if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) e.stopPropagation();   // no search shortcut mid-tour
  };
  root.addEventListener('click', e => {
    const id = e.target.closest('button')?.id;
    // the sample flashcard: flip, then grade
    if (id === 'tf-card') {
      const c = e.target.closest('#tf-card'), flipped = c.getAttribute('aria-pressed') !== 'true';
      c.setAttribute('aria-pressed', String(flipped));
      c.classList.toggle('flipped', flipped);
      root.querySelector('#tf-grades').hidden = !flipped;
      place();
      return;
    }
    const g = e.target.closest('[data-g]');
    if (g) {
      const k = +g.dataset.g;
      root.querySelectorAll('.tf-g').forEach(b => b.setAttribute('aria-pressed', String(b === g)));
      root.querySelector('#tf-note').innerHTML = ['Again: you’ll see <span lang="ar">كِتَاب</span> again in a few minutes.',
        'Hard: it comes back tomorrow.', 'Good: it comes back tomorrow, then less and less often.', 'Easy: it comes back in a few days.'][k];
      place();
      return;
    }
    const s = STEPS[i];
    if (id === 'tour-skip') finish(false);
    else if (id === 'tour-next') s.last ? finish(sync) : show(i + 1);
    else if (id === 'tour-back') s.back ? finish(false) : show(i - 1);
  });
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  document.addEventListener('keydown', onKey, true);
  show(0);
}
