// SPEC §7: tab bar / header tabs, routes (incl. #account and the memory router), keyboard, titles, update notice.
const { test, expect } = require('./fixtures');

async function boot(page, path = '/') {
  await page.goto(path);
  await page.evaluate(() => QamusStore.init());
  await page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null);
}
async function seed(page, { folders = [{ id: 'f_a', name: 'Poem' }], cards = [] } = {}) {
  await page.evaluate(({ folders, cards }) => QamusStore.mutate(d => {
    const now = Date.now();
    for (const f of folders) d.folders.push({ parent: null, createdAt: now, updatedAt: now, deleted: false, ...f });
    cards.forEach((c, i) => d.cards.push({ folder: 'f_a', key: norm(c.word), gloss: '', tags: [], source: 'custom', ref: '', createdAt: now + i, updatedAt: now, deleted: false, ...c }));
  }), { folders, cards });
}
const tab = (page, name) => page.locator(`#tabs [data-tab="${name}"]`);
const isCurrent = (page, name) => expect(tab(page, name)).toHaveAttribute('aria-current', 'page');   // waits for route()
const TWO = [{ id: 'c1', word: 'كتاب', gloss: 'book' }, { id: 'c2', word: 'قلم', gloss: 'pen' }];

test.describe('navigation (local)', () => {
  test.use({ syncUrl: false });

  test('phone: bottom tab bar follows the route, hides in study, never covers content', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await seed(page, { folders: Array.from({ length: 30 }, (_, i) => ({ id: 'f_' + i, name: 'Folder ' + String(i).padStart(2, '0') })).concat([{ id: 'f_a', name: 'Poem' }]), cards: TWO });
    const bar = page.locator('#tabs');
    await expect(bar).toBeVisible();
    await expect(page.locator('#tabs .tab')).toHaveCount(3);
    const box = await bar.boundingBox();
    expect(Math.round(box.y + box.height)).toBe(844);
    await isCurrent(page, 'search');

    await page.evaluate(() => go({ q: 'كتاب' }));
    await expect(page.locator('main details.root').first()).toBeVisible();
    await isCurrent(page, 'search');
    await tab(page, 'vocab').click();
    await expect(page).toHaveURL(/#vocab$/);
    await isCurrent(page, 'vocab');

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = await page.locator('.folder-row').last().boundingBox();
    const barTop = (await bar.boundingBox()).y;
    expect(last.y + last.height).toBeLessThanOrEqual(barTop + 1);

    await page.locator('.folder-row', { hasText: 'Poem' }).locator('.fr-open').click();
    await expect(page).toHaveURL(/#folder=f_a$/);
    await isCurrent(page, 'vocab');
    await page.getByRole('button', { name: 'Study', exact: true }).click();
    await expect(page.locator('#st-card')).toBeVisible();
    await expect(bar).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#folder=f_a$/);
    await expect(bar).toBeVisible();
    await tab(page, 'history').click();
    await expect(page).toHaveURL(/#history$/);
    await isCurrent(page, 'history');
  });

  test('iPad / desktop: tabs sit in the header, nothing fixed at the bottom', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await boot(page);
    const box = await page.locator('#tabs').boundingBox();
    expect(box.y).toBeLessThan(80);
    expect(await page.locator('#tabs').evaluate(el => getComputedStyle(el).position)).not.toBe('fixed');
    await expect(tab(page, 'vocab')).toContainText('Vocab');
    await page.setViewportSize({ width: 768, height: 1024 });                       // iPad portrait: icon-only, still labelled
    await expect(tab(page, 'history')).toHaveAccessibleName('History');
  });

  test('Search tab returns to a fresh home, then focuses the field; search works from other tabs', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => go({ q: 'كتاب' }));
    await expect(page.locator('#q')).toHaveValue('كتاب');
    await tab(page, 'search').click();
    await expect(page.locator('main .empty')).toBeVisible();
    await expect(page.locator('#q')).toHaveValue('');
    await tab(page, 'search').click();
    await expect(page.locator('#q')).toBeFocused();

    await tab(page, 'history').click();
    await expect(page.locator('#q')).toHaveValue('');
    await page.locator('#q').fill('مدرس');
    await expect(page.locator('#suggest li').first()).toBeVisible();
    await page.locator('#q').press('Enter');
    await expect(page).toHaveURL(/#q=/);
    await isCurrent(page, 'search');
  });

  test('Vocab tab badge shows the due count and updates after a review', async ({ page }) => {
    await boot(page);
    await seed(page, { cards: TWO });
    const badge = page.locator('#tabs .tab-badge');
    await expect(badge).toHaveText('2');
    await expect(tab(page, 'vocab')).toHaveAccessibleName('Vocab, 2 due');
    await page.evaluate(() => go(studyHash(['f_a'], 'review')));
    await page.locator('#st-show').click();
    await page.locator('#st-g2').click();
    await expect(badge).toHaveText('1');
  });

  test('#account without sync shows home', async ({ page }) => {
    await boot(page, '/#account');
    await expect(page.locator('main .empty')).toBeVisible();
    await expect(page.locator('.sheet')).toHaveCount(0);
  });

  test('keyboard: "/" focuses search unless typing; Esc steps out of study and folders', async ({ page }) => {
    await boot(page);
    await seed(page, { cards: TWO });
    await page.locator('body').press('/');
    await expect(page.locator('#q')).toBeFocused();
    await page.evaluate(() => { document.activeElement.blur(); go('folder=f_a'); });
    await page.locator('#vf-filter').click();
    await page.keyboard.type('a/b');
    await expect(page.locator('#vf-filter')).toHaveValue('a/b');
    await page.locator('#vf-filter').fill('');
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Control+k');
    await expect(page.locator('#q')).toBeFocused();
    await page.evaluate(() => { document.activeElement.blur(); go(studyHash(['f_a'], 'browse')); });
    await expect(page.locator('#st-card')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.folder-title')).toHaveText('Poem');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#vocab$/);
  });

  test('document.title follows the view', async ({ page }) => {
    await boot(page);
    await seed(page, { cards: TWO });
    await expect(page).toHaveTitle('Qamus');
    await page.evaluate(() => go({ q: 'كتاب' }));
    await expect(page).toHaveTitle('كتاب · Qamus');
    await page.evaluate(() => go('vocab'));
    await expect(page).toHaveTitle('Vocab · Qamus');
    await page.evaluate(() => go('folder=f_a'));
    await expect(page).toHaveTitle('Poem · Qamus');
    await page.evaluate(() => go(studyHash(['f_a'], 'browse')));
    await expect(page).toHaveTitle('Study · Poem · Qamus');
    await page.evaluate(() => go('history'));
    await expect(page).toHaveTitle('History · Qamus');
  });

  test('refocusing the search right after Enter keeps the new suggestions', async ({ page }) => {
    await boot(page);
    const q = page.locator('#q');
    await q.fill('كتاب');
    await q.press('Enter');                       // blurs the field and starts its 150 ms hide timer
    await q.fill('قلم');                          // refocus + type immediately
    await page.waitForTimeout(300);
    await expect(page.locator('#suggest li').first()).toBeVisible();
  });

  test('update notice: Reload and dismiss', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => onSWUpdate());
    const b = page.locator('#update-banner');
    await expect(b).toHaveAttribute('role', 'status');
    await expect(b).toContainText('Qamus was updated.');
    await page.setViewportSize({ width: 375, height: 812 });
    expect((await b.boundingBox()).height).toBeLessThan(70);                       // one line on a phone, not squeezed to half width
    await page.getByRole('button', { name: 'Dismiss update notice' }).click();
    await expect(b).toHaveCount(0);
    await page.evaluate(() => { onSWUpdate(); window.__marker = 1; });
    await Promise.all([page.waitForEvent('load'), page.locator('#ub-reload').click()]);
    expect(await page.evaluate(() => window.__marker)).toBeUndefined();
  });

  for (const scheme of ['light', 'dark']) {
    test(`tabs fit 400px with 44px targets (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width: 400, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await boot(page);
      await seed(page, { cards: TWO });
      for (const path of ['', 'vocab', 'history']) {
        await page.evaluate(p => go(p), path);
        const m = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        expect(m[0]).toBeLessThanOrEqual(m[1]);
        for (const h of await page.locator('#tabs .tab').evaluateAll(ts => ts.map(t => Math.round(t.getBoundingClientRect().height)))) expect(h).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test('memory router: no hash changes, back button walks the in-page history', async ({ page }) => {
    await page.addInitScript(() => { window.QAMUS_MEMORY_ROUTER = true; });
    await boot(page);
    await seed(page, { cards: TWO });
    const q = page.locator('#q');
    await q.fill('كتاب'); await q.press('Enter');
    await expect(page.locator('main details.root').first()).toBeVisible();
    await tab(page, 'vocab').click();
    await page.locator('.folder-row .fr-open').first().click();
    await expect(page.locator('.folder-title')).toHaveText('Poem');
    await page.getByRole('button', { name: 'Study', exact: true }).click();
    await expect(page.locator('#st-card')).toBeVisible();
    await tab(page, 'history').click();
    await expect(page.locator('main h2.sec')).toContainText('History');
    expect(await page.evaluate(() => location.hash)).toBe('');

    const back = page.locator('#back');
    await expect(back).toBeVisible();
    await back.click(); await expect(page.locator('#st-card')).toBeVisible();
    await back.click(); await expect(page.locator('.folder-title')).toHaveText('Poem');
    await back.click(); await expect(page.locator('main h2.sec')).toContainText('Vocab');
    await back.click(); await expect(page.locator('main details.root').first()).toBeVisible();
    await back.click(); await expect(page.locator('main .empty')).toBeVisible();
    await expect(back).toBeHidden();
    expect(await page.evaluate(() => location.hash)).toBe('');
  });
});

test.describe('navigation (synced)', () => {
  async function device(page, user, path = '/') {
    await page.addInitScript(() => { try { localStorage.setItem('qamus.syncSkipped', '1'); } catch {} });
    await boot(page, path);
    await expect(page.locator('#acct')).toBeVisible();
    await page.evaluate(u => QamusSync.signIn(u), user);
  }

  test('#account opens the sheet over the current view; closing returns', async ({ page, user }) => {
    await device(page, user);
    await page.evaluate(() => go('vocab'));
    await page.locator('#acct').click();
    await expect(page).toHaveURL(/#account$/);
    await expect(page.locator('.sheet')).toContainText(user);
    await expect(page.locator('main h2.sec')).toContainText('Vocab');            // still underneath
    await page.keyboard.press('Escape');
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page).toHaveURL(/#vocab$/);

    await page.locator('#acct').click();
    await page.locator('.sheet').getByRole('button', { name: 'Search history' }).click();
    await expect(page).toHaveURL(/#history$/);
    await expect(page.locator('.sheet')).toHaveCount(0);
  });

  test('a deep link to #account closes to home without a dead history entry', async ({ page, user }) => {
    await device(page, user);
    await page.goto('/#account');
    await page.evaluate(() => QamusStore.init());
    await expect(page.locator('.sheet')).toContainText(user);
    const before = await page.evaluate(() => history.length);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sheet')).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe('');
    expect(await page.evaluate(() => history.length)).toBe(before);
    await expect(page.locator('main .empty')).toBeVisible();
  });
});
