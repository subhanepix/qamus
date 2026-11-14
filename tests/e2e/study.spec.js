// SPEC §6: study mode — Browse (flip card + marks, after the owner's flashcard page) and Review (SM-2).
const { test, expect, newDevice, SYNC } = require('./fixtures');

const CARDS = [
  { id: 'c1', word: 'طِبْ نَفْسًا', gloss: 'Be content\nat peace in your heart', arGloss: 'كن راضيًا مطمئن القلب', translit: 'ṭib nafsan',
    note: 'Imperative of طاب', context: 'دَعِ الأَيَّامَ تَفْعَلُ مَا تَشَاءُ وَطِبْ نَفْسًا إِذَا حَكَمَ الْقَضَاءُ', highlight: 'طِبْ نَفْسًا', root: 'ط ي ب' },
  { id: 'c2', word: 'دَعْ', gloss: 'leave it alone', context: 'دَعِ الأَيَّامَ تَفْعَلُ مَا تَشَاءُ', highlight: 'دَعِ' },
  { id: 'c3', word: 'الليالي', gloss: 'the nights' },
];

async function boot(page, path = '/') {
  await page.goto(path);
  await page.evaluate(() => QamusStore.init());
  await page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null);
}
// folders: [{id, name, parent}], cards: [{..., folder}], reviews: {id: {...}}
async function seed(page, { folders = [{ id: 'f_a', name: 'دع الأيام' }], cards = CARDS.map(c => ({ ...c, folder: 'f_a' })), reviews = {} } = {}) {
  await page.evaluate(({ folders, cards, reviews }) => QamusStore.mutate(d => {
    const now = Date.now();
    for (const f of folders) d.folders.push({ parent: null, createdAt: now, updatedAt: now, deleted: false, ...f });
    cards.forEach((c, i) => d.cards.push({ key: norm(c.word), gloss: '', tags: [], source: 'custom', ref: '', createdAt: now + i, updatedAt: now, deleted: false, ...c }));
    for (const [id, r] of Object.entries(reviews)) d.reviews[id] = { updatedAt: now, ...r };
  }), { folders, cards, reviews });
}
const study = (page, ids, mode = 'browse') => page.evaluate(([ids, mode]) => go(studyHash(ids, mode)), [ids, mode]);
const meta = page => page.locator('#st-card .st-front .st-meta span').first();
const card = page => page.locator('#st-card');
const review = (page, id) => page.evaluate(id => QamusStore.doc.reviews[id] || null, id);

test.describe('study (local)', () => {
  test.use({ syncUrl: false });

  test('browse: front, flip to the full back, Space and arrows', async ({ page }) => {
    await boot(page); await seed(page); await study(page, ['f_a']);
    await expect(page.locator('.st-title')).toHaveText('دع الأيام');
    await expect(meta(page)).toHaveText('1 / 3');
    await expect(page.locator('.st-front .st-word')).toHaveText('طِبْ نَفْسًا');
    await expect(page.locator('.st-front .st-intext')).toHaveCount(0);          // highlight == word
    await expect(page.locator('#st-prev')).toBeDisabled();

    await card(page).click();
    await expect(card(page)).toHaveClass(/flipped/);
    const back = page.locator('.st-back');
    await expect(back.locator('.st-argloss')).toHaveText('كن راضيًا مطمئن القلب');
    await expect(back.locator('.st-en')).toHaveText(['Be content', 'at peace in your heart']);
    await expect(back.locator('.st-lit')).toContainText('ṭib nafsan');
    await expect(back.locator('.st-note')).toContainText('Imperative of');
    await expect(back.locator('.st-ctx mark')).toHaveText('طِبْ نَفْسًا');
    await expect(back.locator('.st-rootlink')).toHaveText('ط ي ب');

    await page.locator('body').press(' ');
    await expect(card(page)).not.toHaveClass(/flipped/);
    await page.keyboard.press('ArrowRight');
    await expect(meta(page)).toHaveText('2 / 3');
    await expect(page.locator('.st-front .st-intext')).toContainText('دَعِ');   // "In the text"
    await page.keyboard.press('ArrowLeft');
    await expect(meta(page)).toHaveText('1 / 3');

    await card(page).click();
    await back.locator('.st-rootlink').click();
    await expect(page).toHaveURL(/#q=/);
    await expect(page.locator('main details.root').first()).toBeVisible();
  });

  test('marks: got it / again advance, toggle off, tally, stored in reviews, survive reload', async ({ page }) => {
    await boot(page); await seed(page); await study(page, ['f_a']);
    await page.locator('#st-got').click();
    await expect(page.locator('#st-got')).toHaveAttribute('aria-pressed', 'true');
    await expect(meta(page)).toHaveText('2 / 3');                                // auto-advance after ~260 ms
    await page.locator('#st-again').click();
    await expect(meta(page)).toHaveText('3 / 3');
    await expect(page.locator('#st-tally')).toContainText('1 got it');
    await expect(page.locator('#st-tally')).toContainText('1 again');
    expect((await review(page, 'c1')).mark).toBe(1);
    expect((await review(page, 'c2')).mark).toBe(2);

    await page.locator('#st-prev').click();
    await expect(page.locator('.st-front .st-badge')).toHaveText('Again');
    await page.locator('#st-again').click();                                       // tap again → clears
    await expect(page.locator('#st-again')).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(350);
    await expect(meta(page)).toHaveText('2 / 3');                                // no advance when clearing
    await expect(page.locator('#st-tally')).toContainText('0 again');
    expect((await review(page, 'c2')).mark).toBeUndefined();

    await page.evaluate(() => QamusStore.whenSaved());
    await page.reload();
    await page.evaluate(() => QamusStore.init());
    await expect(meta(page)).toHaveText('2 / 3');                                // current card remembered
    expect((await review(page, 'c1')).mark).toBe(1);
  });

  test('filters: only again / hide got it (exclusive), folder chips, remembered', async ({ page }) => {
    await boot(page);
    await seed(page, {
      folders: [{ id: 'f_a', name: 'Poem' }, { id: 'f_b', name: 'Verse 2', parent: 'f_a' }],
      cards: [{ ...CARDS[0], folder: 'f_a' }, { ...CARDS[1], folder: 'f_a' }, { ...CARDS[2], folder: 'f_b' }],
      reviews: { c1: { mark: 1 }, c2: { mark: 2 } },
    });
    await study(page, ['f_a']);
    await expect(meta(page)).toHaveText('1 / 3 · Poem');
    await page.locator('#st-onlyagain').click();
    await expect(meta(page)).toHaveText('1 / 1 · Poem');
    await expect(page.locator('.st-front .st-word')).toHaveText('دَعْ');
    await page.locator('#st-hidegot').click();
    await expect(page.locator('#st-onlyagain')).toHaveAttribute('aria-pressed', 'false');
    await expect(meta(page)).toHaveText(/ \/ 2/);
    await page.locator('#st-grp-f_b').click();                                     // sub-folder chip
    await expect(meta(page)).toHaveText('1 / 1 · Verse 2');
    await page.locator('#st-got').click();                                         // hidden by "Hide got it" → leaves the deck
    await expect(page.locator('.st-empty')).toContainText('Every card here is marked “got it”.');

    await page.reload();
    await page.evaluate(() => QamusStore.init());
    await expect(page.locator('#st-grp-f_b')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#st-hidegot')).toHaveAttribute('aria-pressed', 'true');
  });

  test('shuffle keeps the same cards in a new order', async ({ page }) => {
    await boot(page);
    await seed(page, { cards: Array.from({ length: 20 }, (_, i) => ({ id: 'k' + i, word: 'كلمة' + i, folder: 'f_a' })) });
    await study(page, ['f_a']);
    const before = await page.evaluate(() => ss.deck.slice());
    await page.locator('#st-shuffle').click();
    await expect(page.locator('#st-shuffle')).toHaveAttribute('aria-pressed', 'true');
    const after = await page.evaluate(() => ss.deck.slice());
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);
  });

  test('clear all marks: Keep, then Clear', async ({ page }) => {
    await boot(page); await seed(page, { reviews: { c1: { mark: 1 }, c2: { mark: 2 } } }); await study(page, ['f_a']);
    await page.getByRole('button', { name: 'Clear all marks' }).click();
    await expect(page.locator('.st-confirm')).toContainText('Clear every mark?');
    await page.getByRole('button', { name: 'Keep' }).click();
    expect((await review(page, 'c1')).mark).toBe(1);
    await page.getByRole('button', { name: 'Clear all marks' }).click();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator('#st-tally')).toContainText('0 got it');
    expect((await review(page, 'c1')).mark).toBeUndefined();
    expect((await review(page, 'c2')).mark).toBeUndefined();
  });

  test('direction toggle puts the English meaning on the front', async ({ page }) => {
    await boot(page); await seed(page); await study(page, ['f_a']);
    await page.locator('#st-dir').click();
    await expect(page.locator('#st-dir')).toHaveText('English → Arabic');
    await expect(page.locator('.st-front .st-front-en')).toContainText('Be content');
    await expect(page.locator('.st-front .st-word')).toHaveCount(0);
  });

  test('review: show answer, grades schedule SM-2, Again re-queues, done screen', async ({ page }) => {
    await boot(page); await seed(page); await study(page, ['f_a'], 'review');
    await expect(page.locator('#st-tally')).toContainText('3 cards left');
    await expect(page.locator('.st-grade, #st-g0')).toHaveCount(0);
    await page.locator('#st-show').click();
    await expect(page.locator('.st-inner button small')).toHaveText(['<10m', '1d', '1d', '4d']);
    await page.locator('#st-g2').click();                                          // Good
    const r1 = await review(page, 'c1');
    expect(r1).toMatchObject({ reps: 1, interval: 1, lapses: 0, ease: 2.5 });
    expect(r1.due).toBe(await page.evaluate(() => dayStart(Date.now(), 1)));

    await expect(meta(page)).toHaveText('2 / 3');
    await page.keyboard.press(' ');                                                // Space shows the answer
    await page.locator('#st-g0').click();                                          // Again
    const r2 = await review(page, 'c2');
    expect(r2).toMatchObject({ reps: 0, lapses: 1, interval: 0 });
    expect(r2.due - Date.now()).toBeLessThanOrEqual(10 * 60000);
    await expect(meta(page)).toHaveText('3 / 4');                                  // c2 re-queued at the end

    await page.locator('#st-show').click();
    await page.locator('#st-g3').click();                                          // Easy
    expect((await review(page, 'c3')).interval).toBe(4);
    await expect(page.locator('.st-front .st-word')).toHaveText('دَعْ');
    await page.locator('#st-show').click();
    await page.keyboard.press('3');                                                // Good via keyboard
    await expect(page.locator('.st-done h2')).toHaveText('Done for today');
    await expect(page.locator('.st-done')).toContainText('3 cards reviewed · 1 again');
    await expect(page.locator('#st-tomorrow')).toHaveText('2');
    await expect(page.locator('.st-controls')).toBeHidden();                       // no empty bar on the done screen

    await page.locator('.st-done').getByRole('button', { name: 'Back to folder' }).click();
    await expect(page.locator('#vf-review')).toHaveText('Review · 0 due');
  });

  test('schedule(): Good ×3 → 1, 6, 15 days; ease floor; Hard ≤ Good < Easy', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      const t = Date.now();
      let r = null; const ivs = [];
      for (let i = 0; i < 3; i++) { r = schedule(r, 2, t); ivs.push(r.interval); }
      let a = null; for (let i = 0; i < 12; i++) a = schedule(a, 0, t);
      const order = [];
      for (const prev of [null, { reps: 1, interval: 1, ease: 2.5 }, { reps: 4, interval: 20, ease: 1.3 }, { reps: 3, interval: 2, ease: 3 }]) {
        order.push([1, 2, 3].map(g => schedule(prev, g, t).interval));
      }
      return { ivs, floor: a.ease, lapses: a.lapses, order };
    });
    expect(out.ivs).toEqual([1, 6, 15]);
    expect(out.floor).toBe(1.3);
    expect(out.lapses).toBe(12);
    for (const [h, g, e] of out.order) { expect(h).toBeLessThanOrEqual(g); expect(g).toBeLessThan(e); expect(h).toBeGreaterThanOrEqual(1); }
  });

  test('study several folders at once from the Vocab list', async ({ page }) => {
    await boot(page);
    await seed(page, {
      folders: [{ id: 'f_a', name: 'A' }, { id: 'f_b', name: 'B' }, { id: 'f_c', name: 'C' }],
      cards: [{ ...CARDS[0], folder: 'f_a' }, { ...CARDS[1], folder: 'f_b' }, { ...CARDS[2], folder: 'f_c' }],
    });
    await page.evaluate(() => go('vocab'));
    await page.getByRole('button', { name: 'Select to study' }).click();
    await page.getByRole('checkbox', { name: 'Select A' }).check();
    await page.getByRole('checkbox', { name: 'Select C' }).check();
    await expect(page.locator('.select-bar')).toContainText('2 folders selected');
    await page.locator('.select-bar').getByRole('button', { name: 'Study' }).click();
    await expect(page).toHaveURL(/#study=f_a,f_c&mode=browse$/);
    await expect(page.locator('.st-title')).toHaveText('2 folders');
    await expect(page.locator('#st-tally')).toContainText('2 cards');
    await expect(page.locator('#st-grp-f_a')).toBeVisible();
  });

  test('keyboard marks in browse; swipe moves without flipping', async ({ page }) => {
    await boot(page); await seed(page); await study(page, ['f_a']);
    await page.keyboard.press('2');
    expect((await review(page, 'c1')).mark).toBe(1);
    await expect(meta(page)).toHaveText('2 / 3');
    await page.keyboard.press('1');
    expect((await review(page, 'c2')).mark).toBe(2);
    await expect(meta(page)).toHaveText('3 / 3');

    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(meta(page)).toHaveText('1 / 3');
    const box = await card(page).boundingBox();
    const y = box.y + 120, x = box.x + box.width / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - 160, y, { steps: 6 }); await page.mouse.up();
    await expect(meta(page)).toHaveText('2 / 3');
    await expect(card(page)).not.toHaveClass(/flipped/);
  });

  test('flip animates normally and not at all under reduced motion', async ({ page }) => {
    await boot(page); await seed(page); await study(page, ['f_a']);
    expect(await card(page).evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0.45s');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await card(page).evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  });

  for (const scheme of ['light', 'dark']) {
    test(`study fits 400px with the control bar clear of the card (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width: 400, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await boot(page);
      await seed(page, { folders: [{ id: 'f_a', name: 'Poem' }, { id: 'f_b', name: 'Sub', parent: 'f_a' }],
        cards: [{ ...CARDS[0], folder: 'f_a' }, { ...CARDS[1], folder: 'f_b' }] });
      for (const mode of ['browse', 'review']) {
        await study(page, ['f_a'], mode);
        await card(page).click();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const m = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          cardBottom: document.querySelector('#st-card').getBoundingClientRect().bottom,
          barTop: document.querySelector('.st-controls').getBoundingClientRect().top,
        }));
        expect(m.sw).toBeLessThanOrEqual(m.cw);
        expect(m.cardBottom).toBeLessThanOrEqual(m.barTop);
        const hs = await page.locator('main button:visible').evaluateAll(bs => bs.map(b => [b.id || b.textContent.trim().slice(0, 12), Math.round(b.getBoundingClientRect().height)]));
        for (const [label, h] of hs) expect(h, label).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe('study (synced)', () => {
  async function device(page, user) {
    await page.addInitScript(() => { try { localStorage.setItem('qamus.syncSkipped', '1'); } catch {} });
    await boot(page);
    await expect(page.locator('#acct')).toBeVisible();
    await page.evaluate(u => QamusSync.signIn(u), user);
  }

  test('studying works offline and syncs; marks show on another device', async ({ page, context, user, browser }) => {
    await device(page, user);
    await seed(page);
    await page.evaluate(() => QamusSync.syncNow());
    await study(page, ['f_a']);
    await context.setOffline(true);
    await page.locator('#st-got').click();                                         // browse mark offline
    await study(page, ['f_a'], 'review');
    await page.locator('#st-show').click();
    await page.locator('#st-g2').click();                                          // review offline
    await page.evaluate(() => QamusSync.syncNow());
    await expect(page.locator('#acct')).toHaveAttribute('data-status', 'offline');
    await context.setOffline(false);
    await expect(page.locator('#acct')).toHaveAttribute('data-status', 'synced');
    const srv = await (await fetch(`${SYNC}/u/${user}`)).json();
    expect(srv.reviews.c1).toMatchObject({ mark: 1, reps: 1, interval: 1 });

    const B = await newDevice(browser);
    await device(B.page, user);
    await study(B.page, ['f_a']);
    await expect(B.page.locator('.st-front .st-badge')).toHaveText('Got it');
    expect(B.errors).toEqual([]);
    await B.context.close();
  });
});
