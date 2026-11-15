// Settings: which dictionaries show in results, their order, and the word analysis ("Parsed").
const { test, expect } = require('./fixtures');

async function boot(page, path = '/') {
  await page.goto(path);
  await page.evaluate(() => QamusStore.init());
  await page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null);
}
const heads = page => page.locator('main h2.sec').allTextContents();
async function search(page, q) {
  await page.evaluate(q => go({ q }), q);
  await expect(page.locator('main h2.sec').first()).toBeVisible();
}
const row = (page, name) => page.locator('.set-row', { has: page.locator('.set-name', { hasText: name }) });
const openSettings = page => page.evaluate(() => go('settings'));

test.describe('settings (local)', () => {
  test.use({ syncUrl: false });

  test('a header gear opens Settings from home and result pages only; the page lists the dictionaries in default order', async ({ page }) => {
    await boot(page);
    const gear = page.locator('#settings-btn');
    await expect(gear).toBeVisible();
    await search(page, 'كتاب');
    await expect(gear).toBeVisible();
    const [gb, qb] = [await gear.boundingBox(), await page.locator('#q').boundingBox()];
    expect(Math.abs((gb.y + gb.height / 2) - (qb.y + qb.height / 2))).toBeLessThan(2);   // beside the search field
    for (const r of ['vocab', 'history']) { await page.evaluate(r => go(r), r); await expect(gear).toBeHidden(); }
    await page.evaluate(() => go(''));
    await gear.click();
    await expect(page).toHaveURL(/#settings$/);
    await expect(page).toHaveTitle('Settings · Qamus');
    await expect(page.locator('#tabs [data-tab="search"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#set-dicts .set-name')).toHaveText(['Wiktionary', 'Hans Wehr', 'Buckwalter lexicon', 'Lane’s Lexicon']);
    await expect(page.locator('#set-dicts input[type=checkbox]')).toHaveCount(4);
    for (const cb of await page.locator('#set-dicts input[type=checkbox]').all()) await expect(cb).toBeChecked();
    await expect(page.locator('#set-parse')).toBeChecked();
    await expect(gear).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main .settings-link')).toHaveCount(0);   // no longer a row at the bottom of home
    await page.locator('main .crumb', { hasText: 'Search' }).click();
    await expect(page.locator('main .welcome')).toBeVisible();
  });

  test('reordering, turning dictionaries and the analysis off change results; Reset restores them', async ({ page }) => {
    await boot(page);
    await search(page, 'مكتبة');
    expect(await heads(page)).toEqual(['Wiktionary', 'Parsed', 'Root']);   // defaults: unchanged from before
    await expect(page.locator('main .hidden-note')).toHaveCount(0);

    await openSettings(page);
    const handle = row(page, 'Hans Wehr').locator('.set-drag');
    await handle.focus();
    await page.keyboard.press('ArrowUp');                                   // keyboard alternative to dragging
    await expect(page.locator('#set-dicts .set-name')).toHaveText(['Hans Wehr', 'Wiktionary', 'Buckwalter lexicon', 'Lane’s Lexicon']);
    await expect(row(page, 'Hans Wehr').locator('.set-drag')).toBeFocused();
    await expect(row(page, 'Hans Wehr').locator('.set-drag')).toHaveAttribute('aria-label', /position 1 of 4/);
    await page.keyboard.press('ArrowUp');                                   // already first: stays put
    await expect(page.locator('#set-dicts .set-name').first()).toHaveText('Hans Wehr');
    await search(page, 'مكتبة');
    expect(await heads(page)).toEqual(['Root', 'Parsed', 'Wiktionary']);   // analysis follows the first dictionary

    await openSettings(page);
    await row(page, 'Wiktionary').locator('input[type=checkbox]').uncheck();
    await expect(row(page, 'Wiktionary')).toHaveClass(/off/);
    await page.locator('#set-parse').uncheck();
    await search(page, 'مكتبة');
    expect(await heads(page)).toEqual(['Root']);
    await expect(page.locator('main .hidden-note')).toContainText('hidden by your dictionary settings');
    await page.locator('main .hidden-note a').click();
    await expect(page).toHaveURL(/#settings$/);

    await row(page, 'Lane').locator('input[type=checkbox]').uncheck();
    await search(page, 'كتب');
    await expect(page.locator('main details.root').first()).toBeVisible();
    await expect(page.locator('main details.lane')).toHaveCount(0);       // Lane links inside root entries go too

    const st = await page.evaluate(() => QamusStore.doc.settings);
    expect(st).toMatchObject({ dictOrder: 'hw,wikt,lexicon,lane', showParse: false });
    expect(st.dictOff.split(',').sort()).toEqual(['lane', 'wikt']);

    await page.reload();
    await page.evaluate(() => QamusStore.init());
    await openSettings(page);
    await expect(page.locator('#set-dicts .set-name').first()).toHaveText('Hans Wehr');   // survives a reload
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(page.locator('#set-dicts .set-name')).toHaveText(['Wiktionary', 'Hans Wehr', 'Buckwalter lexicon', 'Lane’s Lexicon']);
    await expect(page.locator('#set-parse')).toBeChecked();
    await page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null);
    await search(page, 'مكتبة');
    expect(await heads(page)).toEqual(['Wiktionary', 'Parsed', 'Root']);
  });

  test('drag a row by its handle to reorder (mouse and touch-style pointer)', async ({ page }) => {
    await boot(page);
    await openSettings(page);
    const names = () => page.locator('#set-dicts .set-name').allTextContents();
    const drag = async (fromName, toName, after) => {
      const h = await row(page, fromName).locator('.set-drag').boundingBox();
      const t = await row(page, toName).boundingBox();
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      const y = after ? t.y + t.height - 4 : t.y + 4;
      for (let k = 1; k <= 8; k++) await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + (y - h.y - h.height / 2) * k / 8);
      await expect(row(page, fromName)).toHaveClass(/dragging/);
      await page.mouse.up();
    };
    await drag('Lane', 'Wiktionary', false);                                // last → first
    await expect.poll(names).toEqual(['Lane’s Lexicon', 'Wiktionary', 'Hans Wehr', 'Buckwalter lexicon']);
    await expect(page.locator('.set-row.dragging')).toHaveCount(0);
    expect(await page.evaluate(() => QamusStore.doc.settings.dictOrder)).toBe('lane,wikt,hw,lexicon');
    await drag('Wiktionary', 'Buckwalter lexicon', true);                   // second → last
    await expect.poll(names).toEqual(['Lane’s Lexicon', 'Hans Wehr', 'Buckwalter lexicon', 'Wiktionary']);
    await expect(page.locator('#set-dicts .set-pos')).toHaveText(['1', '2', '3', '4']);
    await search(page, 'مكتبة');
    expect(await heads(page)).toEqual(['Parsed', 'Root', 'Wiktionary']);   // Lane has nothing for this word; Parsed follows it
  });

  test('an entry you open directly still shows when its dictionary is off; all-off shows a warning', async ({ page }) => {
    await boot(page);
    await search(page, 'كتاب');
    const id = await page.locator('main .word.hit').first().getAttribute('id');   // "w<entry id>"
    await openSettings(page);
    for (const id of ['wikt', 'hw', 'lexicon', 'lane']) await page.locator(`[data-dict-on="${id}"]`).uncheck();
    await expect(page.locator('.set-warn')).toBeVisible();
    await page.evaluate(() => go({ q: 'كتاب' }));
    await expect(page.locator('main .hidden-note')).toBeVisible();
    await expect(page.locator('main details.root')).toHaveCount(0);
    await page.evaluate(e => go({ e, q: 'كتاب' }), id.slice(1));
    await expect(page.locator('main details.root').first()).toBeVisible();
    await expect(page.locator('main .word.hit')).toHaveCount(1);
  });

  for (const scheme of ['light', 'dark']) {
    test(`settings fits 400px with 44px targets (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width: 400, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await boot(page, '/#settings');
      await expect(page.locator('#set-dicts .set-row')).toHaveCount(4);
      const m = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(m[0]).toBeLessThanOrEqual(m[1]);
      const hs = await page.locator('main button:visible, main .switch:visible').evaluateAll(bs => bs.map(b => [b.textContent.trim().slice(0, 20), Math.round(b.getBoundingClientRect().height)]));
      for (const [label, h] of hs) expect(h, label).toBeGreaterThanOrEqual(44);
    });
  }
});
