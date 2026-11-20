// Settings: which dictionaries show in results, their order, and the word analysis ("Parsed").
const { test, expect } = require('./fixtures');

async function boot(page, path = '/') {
  await page.goto(path);
  await page.evaluate(() => QamusStore.init());
  await page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null && !!arRoots.mukhtar);
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
    await expect(page.locator('#set-dicts .set-name')).toHaveText(['Wiktionary', 'Hans Wehr', 'Buckwalter lexicon', 'Lane’s Lexicon', 'al-Mufradāt', 'Mukhtār al-Ṣiḥāḥ']);
    await expect(page.locator('#set-dicts input[type=checkbox]')).toHaveCount(6);
    for (const cb of await page.locator('#set-dicts input[type=checkbox]').all()) await expect(cb).toBeChecked();
    await expect(page.locator('#set-parse')).toBeChecked();
    await expect(gear).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main .settings-link')).toHaveCount(0);   // no longer a row at the bottom of home
    await expect(page.locator('#set-back')).toHaveText('Back to Search');     // opened from home
    await page.locator('#set-back').click();
    await expect(page.locator('main .welcome')).toBeVisible();
  });

  test('reordering, turning dictionaries and the analysis off change results; Reset restores them', async ({ page }) => {
    await boot(page);
    await search(page, 'مكتبة');
    expect(await heads(page)).toEqual(['Wiktionary', 'Parsed', 'Root', 'al-Mufradāt', 'Mukhtār al-Ṣiḥāḥ']);   // defaults: unchanged from before
    await expect(page.locator('main .hidden-note')).toHaveCount(0);

    await openSettings(page);
    const handle = row(page, 'Hans Wehr').locator('.set-drag');
    await handle.focus();
    await page.keyboard.press('ArrowUp');                                   // keyboard alternative to dragging
    await expect(page.locator('#set-dicts .set-name')).toHaveText(['Hans Wehr', 'Wiktionary', 'Buckwalter lexicon', 'Lane’s Lexicon', 'al-Mufradāt', 'Mukhtār al-Ṣiḥāḥ']);
    await expect(row(page, 'Hans Wehr').locator('.set-drag')).toBeFocused();
    await expect(row(page, 'Hans Wehr').locator('.set-drag')).toHaveAttribute('aria-label', /position 1 of 6/);
    await page.keyboard.press('ArrowUp');                                   // already first: stays put
    await expect(page.locator('#set-dicts .set-name').first()).toHaveText('Hans Wehr');
    await search(page, 'مكتبة');
    expect(await heads(page)).toEqual(['Root', 'Parsed', 'Wiktionary', 'al-Mufradāt', 'Mukhtār al-Ṣiḥāḥ']);   // analysis follows the first dictionary

    await openSettings(page);
    await row(page, 'Wiktionary').locator('input[type=checkbox]').uncheck();
    await expect(row(page, 'Wiktionary')).toHaveClass(/off/);
    await page.locator('#set-parse').uncheck();
    await search(page, 'مكتبة');
    expect(await heads(page)).toEqual(['Root', 'al-Mufradāt', 'Mukhtār al-Ṣiḥāḥ']);
    await expect(page.locator('main .hidden-note')).toContainText('hidden by your dictionary settings');
    await page.locator('main .hidden-note a').click();
    await expect(page).toHaveURL(/#settings$/);

    await row(page, 'Lane').locator('input[type=checkbox]').uncheck();
    await search(page, 'كتب');
    await expect(page.locator('main details.root').first()).toBeVisible();
    await expect(page.locator('main details.lane')).toHaveCount(0);       // Lane links inside root entries go too

    const st = await page.evaluate(() => QamusStore.doc.settings);
    expect(st).toMatchObject({ dictOrder: 'hw,wikt,lexicon,lane,mufradat,mukhtar', showParse: false });
    expect(st.dictOff.split(',').sort()).toEqual(['lane', 'wikt']);

    await page.reload();
    await page.evaluate(() => QamusStore.init());
    await openSettings(page);
    await expect(page.locator('#set-dicts .set-name').first()).toHaveText('Hans Wehr');   // survives a reload
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(page.locator('#set-dicts .set-name')).toHaveText(['Wiktionary', 'Hans Wehr', 'Buckwalter lexicon', 'Lane’s Lexicon', 'al-Mufradāt', 'Mukhtār al-Ṣiḥāḥ']);
    await expect(page.locator('#set-parse')).toBeChecked();
    await page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null && !!arRoots.mukhtar);
    await search(page, 'مكتبة');
    expect(await heads(page)).toEqual(['Wiktionary', 'Parsed', 'Root', 'al-Mufradāt', 'Mukhtār al-Ṣiḥāḥ']);
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
    await expect.poll(names).toEqual(['Lane’s Lexicon', 'Wiktionary', 'Hans Wehr', 'Buckwalter lexicon', 'al-Mufradāt', 'Mukhtār al-Ṣiḥāḥ']);
    await expect(page.locator('.set-row.dragging')).toHaveCount(0);
    expect(await page.evaluate(() => QamusStore.doc.settings.dictOrder)).toBe('lane,wikt,hw,lexicon,mufradat,mukhtar');
    await drag('Wiktionary', 'Buckwalter lexicon', true);                   // second → last
    await expect.poll(names).toEqual(['Lane’s Lexicon', 'Hans Wehr', 'Buckwalter lexicon', 'Wiktionary', 'al-Mufradāt', 'Mukhtār al-Ṣiḥāḥ']);
    await expect(page.locator('#set-dicts .set-pos')).toHaveText(['1', '2', '3', '4', '5', '6']);
    await search(page, 'مكتبة');
    expect(await heads(page)).toEqual(['Parsed', 'Root', 'Wiktionary', 'al-Mufradāt', 'Mukhtār al-Ṣiḥāḥ']);   // Lane has nothing for this word; Parsed follows it
  });

  test('an entry you open directly still shows when its dictionary is off; all-off shows a warning', async ({ page }) => {
    await boot(page);
    await search(page, 'كتاب');
    const id = await page.locator('main .word.hit').first().getAttribute('id');   // "w<entry id>"
    await openSettings(page);
    for (const id of ['wikt', 'hw', 'lexicon', 'lane', 'mufradat', 'mukhtar']) await page.locator(`[data-dict-on="${id}"]`).uncheck();
    await expect(page.locator('.set-warn')).toBeVisible();
    await page.evaluate(() => go({ q: 'كتاب' }));
    await expect(page.locator('main .hidden-note')).toBeVisible();
    await expect(page.locator('main details.root')).toHaveCount(0);
    await page.evaluate(e => go({ e, q: 'كتاب' }), id.slice(1));
    await expect(page.locator('main details.root').first()).toBeVisible();
    await expect(page.locator('main .word.hit')).toHaveCount(1);
  });

  test('text size: English and Arabic dictionaries each step from 80% to 160%, persist, and reset', async ({ page }) => {
    await boot(page);
    await search(page, 'كتب');
    const px = sel => page.locator(sel).first().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
    const en0 = await px('main .word > .def'), ar0 = await px('main .ard-text');
    expect([en0, ar0]).toEqual([16, 22]);

    await openSettings(page);
    const step = (k, d) => page.locator(`[data-size-step="${k}"][data-d="${d}"]`);
    await expect(page.locator('#size-en')).toHaveText('100%');
    await step('en', 1).click(); await step('en', 1).click();
    await expect(page.locator('#size-en')).toHaveText('120%');
    await expect(step('en', 1)).toBeFocused();                                   // focus stays put after the re-render
    for (let k = 0; k < 2; k++) await step('ar', -1).click();
    await expect(page.locator('#size-ar')).toHaveText('80%');
    await expect(step('ar', -1)).toBeDisabled();                                 // the smallest size
    await expect(step('ar', 1)).toBeFocused();
    expect(await page.evaluate(() => QamusStore.doc.settings)).toMatchObject({ textEn: 120, textAr: 80 });

    await search(page, 'كتب');
    expect(await px('main .word > .def')).toBeCloseTo(19.2, 1);                  // English definitions only
    expect(await px('main .ard-text')).toBeCloseTo(17.6, 1);                     // Arabic dictionary text only
    expect(await px('main .word > .hw')).toBe(28);                               // headwords keep their size

    await page.reload();
    await page.evaluate(() => QamusStore.init());
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--t-en').trim() === '1.2');
    await openSettings(page);
    for (let k = 0; k < 10; k++) if (await step('en', 1).isEnabled()) await step('en', 1).click();
    await expect(page.locator('#size-en')).toHaveText('160%');
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(page.locator('#size-en')).toHaveText('100%');
    await expect(page.locator('#size-ar')).toHaveText('100%');
  });

  test('Back returns to the search you had open, at the same scroll position; Esc and the gear do too', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await boot(page);
    await search(page, 'كتب');
    await page.evaluate(() => window.scrollTo(0, 900));
    const len = await page.evaluate(() => history.length);
    await page.locator('#settings-btn').click();
    await expect(page).toHaveURL(/#settings$/);
    const back = page.locator('#set-back');
    await expect(back).toHaveText('Back to كتب');
    await page.locator('[data-size-step="ar"][data-d="1"]').click();           // changing a setting doesn't lose the way back (Arabic text sits below this point, so the page above doesn't shift)
    await back.click();
    await expect(page).toHaveURL(/#q=/);
    expect(decodeURIComponent(page.url().split('#q=')[1])).toBe('كتب');
    await expect.poll(() => page.evaluate(() => Math.abs(window.scrollY - 900))).toBeLessThan(5);   // same place (the browser may nudge it a pixel or two to keep the same text in view)
    expect(await page.evaluate(() => history.length)).toBe(len + 1);         // went back, didn't stack a new entry

    await page.locator('#settings-btn').click();
    await page.locator('[data-dict-on="wikt"]').focus();
    await page.keyboard.press('Escape');                                      // Esc, even with a switch focused
    await expect(page).toHaveURL(/#q=/);
    await page.locator('#settings-btn').click();
    await expect(back).toBeVisible();
    await page.locator('#settings-btn').click();                              // the gear toggles back
    await expect(page).toHaveURL(/#q=/);

    await page.goto('/#settings');                                            // a direct link: back goes to search home
    await expect(back).toHaveText('Back to Search');
    await back.click();
    await expect(page.locator('main .welcome')).toBeVisible();
  });

  for (const scheme of ['light', 'dark']) {
    test(`settings fits 400px with 44px targets (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width: 400, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await boot(page, '/#settings');
      await expect(page.locator('#set-dicts .set-row')).toHaveCount(6);
      const m = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(m[0]).toBeLessThanOrEqual(m[1]);
      const hs = await page.locator('main button:visible, main .switch:visible').evaluateAll(bs => bs.map(b => [b.textContent.trim().slice(0, 20), Math.round(b.getBoundingClientRect().height)]));
      for (const [label, h] of hs) expect(h, label).toBeGreaterThanOrEqual(44);
    });
  }
});
