// First-time guided demo: a welcome card, then a few steps that use the real app (a sample search for كتاب,
// the highlighted result, the bookmark, Vocab, Settings), then a closing card. Skippable at any point with
// Skip or Esc, and replayable from Settings. Runs once per device: localStorage 'qamus.introDone'.
'use strict';

let tourOn = false;   // while true, the demo search isn't recorded in history

function shouldTour() {
  if (lsGet('qamus.introDone') || OLD_HOME) return false;   // the old address only points to the new one
  if (location.hash.length > 1) return false;                     // opened on a link: don't get in the way
  const used = (Store && Store.doc && (liveHistory().length || (hasVocab() && liveCards().length))) || (Sync && Sync.state.user);
  return !used;
}

function startTour({ onDone } = {}) {
  if (tourOn || document.getElementById('tour')) return;
  tourOn = true;
  const sync = !!SYNC_URL && !!Sync;
  const wait = (test, ms = 8000) => new Promise(res => {
    const t0 = Date.now();
    const tick = () => { const el = test(); if (el || Date.now() - t0 > ms) res(el); else setTimeout(tick, 80); };
    tick();
  });
  const visible = sel => [...document.querySelectorAll(sel)].find(el => el.offsetParent !== null && el.getBoundingClientRect().width);
  const STEPS = [
    { card: true, title: 'أهلًا وسهلًا', body: 'Qamus looks words up in Hans Wehr, Lane’s Lexicon, Wiktionary, al-Mufradāt and Mukhtār al-Ṣiḥāḥ, all from one search. Here’s a 30-second tour.', next: 'Show me', back: 'Skip tour' },
    { target: () => visible('#q'), title: 'Search anything', body: 'Type an Arabic word in any form: prefixes and endings come off by themselves. A root like ك ت ب or an English word works too. Let’s look up <span lang="ar">كتاب</span>.', next: 'Search كتاب' },
    { before: async () => { go({ q: 'كتاب' }); await wait(() => visible('main .word.hit')); },
      target: () => visible('main .word.hit') || visible('main details.root'), title: 'Results by root', body: 'Words are grouped under their root, and the one you searched is highlighted. Tap any Arabic word in a definition to look it up.' },
    { target: () => visible('main .word.hit > .save-btn') || visible('main .save-btn'), title: 'Save words', body: 'The bookmark saves a word to a folder, with its meaning and root filled in.' },
    { target: () => visible('#tabs [data-tab="vocab"]'), title: 'Study them', body: 'Your saved words live in Vocab. Study them as flashcards: browse, or let spaced review pick what’s due.' },
    { target: () => visible('#settings-btn'), title: 'Make it yours', body: 'Turn dictionaries on or off, put them in your order, and change the text size.' },
    sync
      ? { card: true, before: async () => { go(''); }, title: 'Keep your words everywhere', body: 'Pick a username to sync your words across your devices. No password: we’ll suggest one that’s hard to guess.', next: 'Choose a username', back: 'Maybe later', last: true }
      : { card: true, before: async () => { go(''); }, title: 'That’s it', body: 'Search for a word to get started.', next: 'Start searching', last: true },
  ];

  const root = document.createElement('div');
  root.id = 'tour';
  root.innerHTML = `<div class="tour-hole" aria-hidden="true"></div>
    <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <p class="tour-count"></p><h2 id="tour-title" class="tour-title"></h2><p id="tour-body" class="tour-body"></p>
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
      pop.style.left = pop.style.top = '';
      return;
    }
    const r = target.getBoundingClientRect(), pad = 6;
    hole.hidden = false;
    Object.assign(hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    pop.classList.remove('center');
    const pw = Math.min(360, vw - m * 2), ph = pop.offsetHeight;
    pop.style.width = pw + 'px';
    const below = r.bottom + pad + 10, above = r.top - pad - 10 - ph;
    const top = below + ph <= vh - m ? below : above >= m ? above : Math.max(m, vh - ph - m);
    const left = Math.min(Math.max(m, r.left + r.width / 2 - pw / 2), vw - pw - m);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  };
  const finish = openSignIn => {
    lsSet('qamus.introDone', '1');
    tourOn = false;
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    document.body.classList.remove('touring');
    if (view === 'result') go('');                   // leave the demo search; nothing was recorded
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
    target = s.card ? null : (s.target?.() || null);
    if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' });
    const n = STEPS.filter(x => !x.card).length, pos = STEPS.slice(0, i + 1).filter(x => !x.card).length;
    root.querySelector('.tour-count').textContent = s.card ? '' : `${pos} of ${n}`;
    root.querySelector('#tour-title').innerHTML = s.title;
    root.querySelector('#tour-title').lang = /[؀-ۿ]/.test(s.title) && !/[a-z]/i.test(s.title) ? 'ar' : '';
    root.querySelector('#tour-body').innerHTML = s.body;
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
  };
  root.addEventListener('click', e => {
    const id = e.target.closest('button')?.id;
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
