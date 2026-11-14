// SPEC §4: synced search history — recording, home chips, History view, migration, sync.
const { test, expect, newDevice, fold } = require('./fixtures');

const live = page => page.evaluate(() => liveHistory().map(h => h.q));
const seed = (page, entries) => page.evaluate(es => QamusStore.mutate(d => { d.history = es; }), entries);
async function boot(page, path = '/') {
  await page.goto(path);
  await page.evaluate(() => QamusStore.init());
}
async function dataReady(page) {
  await page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null);
}
async function searchFor(page, q) {
  await page.evaluate(q => go({ q }), q);
  await expect.poll(() => live(page)).toContain(q);
  await expect(page.locator('main details.root, main .bw, main .list-item').first()).toBeVisible();
}

test.describe('local history', () => {
  test.use({ syncUrl: false });

  test('a cold load of #q= records exactly one entry despite re-renders', async ({ page }) => {
    await boot(page, '/#q=' + encodeURIComponent('كتاب'));
    await dataReady(page);
    await expect.poll(() => live(page)).toEqual(['كتاب']);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => QamusStore.doc.history.length)).toBe(1);
  });

  test('consecutive repeats dedupe; re-searching moves to the top', async ({ page }) => {
    await boot(page); await dataReady(page);
    await searchFor(page, 'كتاب');
    const t1 = await page.evaluate(() => QamusStore.doc.history[0].t);
    await page.evaluate(() => go({ q: 'كتاب' }));   // same search again
    await page.waitForTimeout(200);
    expect(await live(page)).toEqual(['كتاب']);
    expect(await page.evaluate(() => QamusStore.doc.history[0].t)).toBe(t1);
    await searchFor(page, 'قلم');
    expect(await live(page)).toEqual(['قلم', 'كتاب']);
    await page.evaluate(() => go({ q: 'كتاب' }));
    await expect.poll(() => live(page)).toEqual(['كتاب', 'قلم']);
  });

  test('typing does not record; Enter does; picking a suggestion does', async ({ page }) => {
    await boot(page); await dataReady(page);
    const q = page.locator('#q');
    await q.fill('مدرسة');
    await expect(page.locator('#suggest li').first()).toBeVisible();
    await page.waitForTimeout(400);
    expect(await live(page)).toEqual([]);
    await q.press('Enter');
    await expect.poll(() => live(page)).toEqual(['مدرسة']);
    await page.waitForTimeout(200);   // Enter blurs the field; its 150 ms hide-suggestions timer must fire first

    await q.fill('');
    await q.fill('قلم');
    const first = page.locator('#suggest li').first();
    await expect.poll(async () => fold((await first.locator('.w').textContent()) || '')).toMatch(/^قلم/);   // refreshed list
    const word = (await first.locator('.w').textContent()).trim();
    await first.click();
    await expect(page).toHaveURL(/#e=/);
    await expect.poll(() => live(page)).toEqual([word, 'مدرسة']);
  });

  test('home shows the 12 most recent as chips; "See all" opens History', async ({ page }) => {
    await boot(page);
    const now = Date.now();
    await seed(page, Array.from({ length: 15 }, (_, i) => ({ q: 'w' + i, t: now - i * 1000 })));
    await expect(page.locator('main .history button')).toHaveCount(12);
    await expect(page.locator('main .history button').first()).toHaveText('w0');
    await page.getByRole('button', { name: 'See all' }).click();
    await expect(page).toHaveURL(/#history$/);
    await expect(page.locator('main h2.sec')).toHaveText('History · 15 searches');
  });

  test('History view: relative times, tap re-runs the search, ✕ deletes', async ({ page }) => {
    await boot(page, '/#history');
    const now = Date.now();
    await seed(page, [{ q: 'قلم', t: now - 5000 }, { q: 'كتاب', t: now - 2 * 3600e3 }, { q: 'مدرسة', t: now - 3 * 86400e3 }]);
    const rows = page.locator('.hist-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator('.hist-time')).toHaveText('just now');
    await expect(rows.nth(1).locator('.hist-time')).toHaveText('2 h ago');

    await page.getByRole('button', { name: 'Delete قلم' }).click();
    await expect(rows).toHaveCount(2);
    expect(await live(page)).toEqual(['كتاب', 'مدرسة']);
    expect(await page.evaluate(() => QamusStore.doc.history.find(h => h.q === 'قلم'))).toMatchObject({ deleted: true });

    await dataReady(page);
    await rows.filter({ hasText: 'كتاب' }).locator('.hist-q').click();
    await expect(page).toHaveURL(new RegExp('#q=' + encodeURIComponent('كتاب')));
    await expect(page.locator('main details.root').first()).toBeVisible();
  });

  test('swipe left deletes; a short drag snaps back without navigating', async ({ page }) => {
    await boot(page, '/#history');
    const now = Date.now();
    await seed(page, [{ q: 'قلم', t: now - 1000 }, { q: 'كتاب', t: now - 2000 }]);
    const row = page.locator('.hist-row').first();
    const box = await row.boundingBox();
    const y = box.y + box.height / 2, x = box.x + box.width / 2;

    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - 40, y, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(250);
    await expect(page.locator('.hist-row')).toHaveCount(2);
    await expect(page).toHaveURL(/#history$/);

    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - 160, y, { steps: 8 }); await page.mouse.up();
    await expect(page.locator('.hist-row')).toHaveCount(1);
    await expect(page).toHaveURL(/#history$/);
    expect(await live(page)).toEqual(['كتاب']);
  });

  test('keyboard: Enter on ✕ deletes and focus moves to the next row', async ({ page }) => {
    await boot(page, '/#history');
    const now = Date.now();
    await seed(page, [{ q: 'a1', t: now - 1000 }, { q: 'a2', t: now - 2000 }, { q: 'a3', t: now - 3000 }]);
    await page.getByRole('button', { name: 'Delete a1' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.hist-row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Delete a2' })).toBeFocused();
  });

  test('Clear history: inline confirm, Cancel keeps, Clear empties and persists', async ({ page }) => {
    await boot(page, '/#history');
    const now = Date.now();
    await seed(page, [{ q: 'a1', t: now - 1000 }, { q: 'a2', t: now - 2000 }, { q: 'a3', t: now - 3000 }]);
    await page.getByRole('button', { name: 'Clear history' }).click();
    await expect(page.locator('#hist-confirm')).toContainText('Clear all 3 searches on all your devices?');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#hist-confirm')).toHaveCount(0);
    await expect(page.locator('.hist-row')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Clear history' })).toBeFocused();

    await page.getByRole('button', { name: 'Clear history' }).click();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator('main')).toContainText('No searches yet.');
    await page.evaluate(() => QamusStore.whenSaved());
    await page.reload();
    await page.evaluate(() => QamusStore.init());
    await expect(page.locator('main')).toContainText('No searches yet.');
    expect(await page.evaluate(() => QamusStore.doc.settings.historyClearedAt)).toBeGreaterThan(0);
  });

  test('Pause recording: searches are not saved, setting survives reload', async ({ page }) => {
    await boot(page, '/#history');
    await page.locator('.switch').click();
    await expect(page.locator('#hist-pause')).toBeChecked();
    await expect(page.locator('main')).toContainText('Recording is paused');
    await dataReady(page);
    await page.evaluate(() => go({ q: 'كتاب' }));
    await expect(page.locator('main details.root').first()).toBeVisible();
    await page.waitForTimeout(300);
    expect(await live(page)).toEqual([]);
    await page.evaluate(() => QamusStore.whenSaved());
    await page.goto('/#history');
    await page.evaluate(() => QamusStore.init());
    await expect(page.locator('#hist-pause')).toBeChecked();
    await page.locator('.switch').click();
    await expect(page.locator('#hist-pause')).not.toBeChecked();
    expect(await page.evaluate(() => QamusStore.doc.settings.pauseHistory)).toBe(false);
  });

  test('migrates the old localStorage "hist" list once, keeping its order', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('hist', JSON.stringify(['كتاب', 'قلم', 'مدرسة']));
        sessionStorage.setItem('seeded', '1');
      }
    });
    await boot(page, '/#history');
    await expect(page.locator('.hist-row .w')).toHaveText(['كتاب', 'قلم', 'مدرسة']);
    expect(await page.evaluate(() => localStorage.getItem('hist'))).toBeNull();
    await page.evaluate(() => QamusStore.whenSaved());
    await page.reload();
    await page.evaluate(() => QamusStore.init());
    await expect(page.locator('.hist-row .w')).toHaveText(['كتاب', 'قلم', 'مدرسة']);
    await page.goto('/');
    await expect(page.locator('main .history button')).toHaveText(['كتاب', 'قلم', 'مدرسة']);
  });

  for (const scheme of ['light', 'dark']) {
    test(`History view fits 400px without horizontal scroll (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width: 400, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await boot(page, '/#history');
      const now = Date.now();
      await seed(page, [{ q: 'كتاب', t: now }, { q: 'a fairly long English search phrase that should be truncated nicely', t: now - 1000 }]);
      await page.getByRole('button', { name: 'Clear history' }).click();
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(m.sw).toBeLessThanOrEqual(m.cw);
      for (const h of await page.locator('.hist-del, .switch, #hist-clear-yes').evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().height)))) {
        expect(h).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe('synced history', () => {
  const signIn = (page, user) => page.evaluate(u => QamusSync.signIn(u), user);
  const syncNow = page => page.evaluate(() => QamusSync.syncNow());
  async function device(page) {
    await page.addInitScript(() => { try { localStorage.setItem('qamus.syncSkipped', '1'); } catch {} });
    await boot(page);
    await expect(page.locator('#acct')).toBeVisible();
    await dataReady(page);
  }

  test('search, delete, re-search and clear propagate between devices', async ({ page, user, browser }) => {
    await device(page);
    await signIn(page, user);
    await searchFor(page, 'كتاب');
    await searchFor(page, 'قلم');
    await syncNow(page);

    const B = await newDevice(browser);
    await device(B.page);
    await signIn(B.page, user);
    expect(await live(B.page)).toEqual(['قلم', 'كتاب']);

    await page.evaluate(() => deleteSearch('كتاب'));
    await syncNow(page); await syncNow(B.page);
    expect(await live(B.page)).toEqual(['قلم']);

    await searchFor(B.page, 'كتاب');   // searching again after a delete brings it back
    await syncNow(B.page); await syncNow(page);
    expect(await live(page)).toEqual(['كتاب', 'قلم']);

    await page.evaluate(() => clearHistory());
    await syncNow(page); await syncNow(B.page);
    expect(await live(B.page)).toEqual([]);
    expect(B.errors).toEqual([]);
    await B.context.close();
  });

  test('account sheet links to History', async ({ page, user }) => {
    await device(page);
    await signIn(page, user);
    await page.locator('#acct').click();
    await page.locator('.sheet').getByRole('button', { name: 'Search history' }).click();
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page).toHaveURL(/#history$/);
    await expect(page.locator('main h2.sec')).toContainText('History');
  });
});
