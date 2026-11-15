// Arabic–Arabic dictionaries: al-Rāghib's al-Mufradāt and al-Rāzī's Mukhtār al-Ṣiḥāḥ.
const { test, expect } = require('./fixtures');

async function boot(page, path = '/') {
  await page.goto(path);
  await page.evaluate(() => QamusStore.init());
  await page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null && !!arRoots.mukhtar);
}
async function search(page, q) {
  await page.evaluate(q => go({ q }), q);
  await expect(page.locator('main h2.sec').first()).toBeVisible();
}
const section = (page, id) => page.locator(`main details.ard[data-dict="${id}"]`);
const cards = page => page.evaluate(() => QamusStore.doc.cards.filter(c => !c.deleted));

test.describe('Arabic dictionaries (local)', () => {
  test.use({ syncUrl: false });

  test('a root shows both dictionaries after the others, open, right to left, with Qur’an quotes marked', async ({ page }) => {
    await boot(page);
    await search(page, 'كتب');
    expect(await page.locator('main h2.sec').allTextContents()).toEqual(['Wiktionary', 'Root', 'al-Mufradāt', 'Mukhtār al-Ṣiḥāḥ']);
    const muf = section(page, 'mufradat').first(), mux = section(page, 'mukhtar').first();
    await expect(muf).toHaveAttribute('open', '');
    await expect(muf.locator('.ard-text').first()).toContainText('الكتب ضم أديم إلى أديم');
    await expect(muf.locator('.ard-text').first()).toHaveAttribute('dir', 'rtl');
    await expect(muf.locator('.ard-text q').first()).toHaveText('الم ذلك الكتاب');
    await expect(mux.locator('.ard-text').first()).toContainText('من باب نصر');
    await expect(mux.locator('.ard-text b', { hasText: 'الكتيبة' }).first()).toBeVisible();   // Mukhtār's headwords in bold
    await expect(mux.locator('.ard-src')).toContainText('OpenITI');
  });

  test('the searched word is marked in the entry, and tapping any word looks it up', async ({ page }) => {
    await boot(page);
    await search(page, 'كتيبة');
    const mux = section(page, 'mukhtar').first();
    await expect(mux.locator('b.hit')).toHaveText(['الكتيبة']);
    await expect(mux.locator('.ard-text > b').first()).not.toHaveClass(/hit/);   // the root heading itself is never marked
    await section(page, 'mufradat').first().locator('.lk', { hasText: /^السقاء$/ }).first().click();
    await expect(page).toHaveURL(/#q=/);
    expect(decodeURIComponent(page.url().split('#q=')[1])).toBe('السقاء');
  });

  test('a root only Mukhtār has still finds it, typed as letters', async ({ page }) => {
    await boot(page);
    await search(page, 'ب خ ق');
    expect(await page.locator('main h2.sec').allTextContents()).toEqual(['Mukhtār al-Ṣiḥāḥ']);
    await expect(section(page, 'mukhtar').locator('.ard-text')).not.toHaveText('');
  });

  test('an entry saves to a folder with its Arabic explanation, and the card opens the root again', async ({ page }) => {
    await boot(page);
    await search(page, 'كتب');
    const btn = section(page, 'mukhtar').first().locator('.ard-entry > .save-btn').first();
    await btn.click();
    await expect(page.locator('.sheet .pick-word [lang=ar]')).toHaveText('كتب');
    await page.locator('.sheet').getByRole('button', { name: 'Save to Inbox' }).click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    const [c] = await cards(page);
    expect(c).toMatchObject({ source: 'mukhtar', ref: 'كتب:0', word: 'كتب', root: 'ك ت ب' });
    expect(c.arGloss).toMatch(/^كتب من باب نصر/);
    expect(c.arGloss).not.toMatch(/[<>]/);
    await page.evaluate(() => go('vocab'));
    await page.evaluate(id => openCard(QamusStore.doc.cards.find(c => c.id === id)), c.id);
    await expect(section(page, 'mukhtar').first()).toBeVisible();
    await expect(section(page, 'mukhtar').locator('.ard-entry > .save-btn').first()).toHaveAttribute('aria-pressed', 'true');
  });

  test('each can be turned off in Settings', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => go('settings'));
    await page.locator('[data-dict-on="mufradat"]').uncheck();
    await search(page, 'كتب');
    await expect(section(page, 'mufradat')).toHaveCount(0);
    await expect(section(page, 'mukhtar').first()).toBeVisible();
    await expect(page.locator('main .hidden-note')).toBeVisible();
  });
});
