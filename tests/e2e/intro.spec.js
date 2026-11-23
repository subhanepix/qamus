// First-visit guided tour (tour.js), the Settings button that replays it, and the home page credit line.
const { test, expect } = require('./fixtures');

const pop = page => page.locator('#tour .tour-pop');
const next = page => page.locator('#tour-next');
const title = page => page.locator('#tour-title');

test.describe('intro tour (local)', () => {
  test.use({ syncUrl: false, intro: true });

  test('a first visit walks through search, results, saving, Vocab, a flashcard and Settings, records nothing, and runs once', async ({ page }) => {
    await page.goto('/');
    await expect(pop(page)).toBeVisible();
    await expect(title(page)).toHaveText('أهلًا وسهلًا');
    await expect(next(page)).toBeFocused();
    await next(page).click();                                                   // Show me
    await expect(page.locator('#tour .tour-count')).toHaveText('1 of 6');
    await expect(title(page)).toHaveText('Search anything');
    await next(page).click();                                                   // Search كتاب
    await expect(title(page)).toHaveText('Results by root');
    await expect(page).toHaveURL(/#q=/);
    await expect(page.locator('main .entry-row.hit').first()).toBeVisible();
    for (const t of ['Save words', 'Study them', 'Flashcards, like Anki']) { await next(page).click(); await expect(title(page)).toHaveText(t); }
    const card = page.locator('#tf-card');
    await expect(page.locator('#tf-grades')).toBeHidden();
    await card.click();                                                         // flip
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.tf-g')).toHaveText([/^Again/, /^Hard/, /^Good/, /^Easy/]);
    await expect(page.locator('.tf-g[data-g="3"] small')).toHaveText('4d');     // the real review schedule
    await page.locator('.tf-g[data-g="2"]').click();
    await expect(page.locator('#tf-note')).toContainText('Good: it comes back tomorrow');
    await next(page).click();
    await expect(title(page)).toHaveText('Make it yours');
    await next(page).click();
    await expect(title(page)).toHaveText('That’s it');
    await next(page).click();
    await expect(page.locator('#tour')).toHaveCount(0);
    expect(await page.evaluate(() => [QamusStore.doc.history.length, QamusStore.doc.cards.length, localStorage.getItem('qamus.introDone')])).toEqual([0, 0, '1']);
    await page.reload();
    await page.waitForTimeout(500);
    await expect(page.locator('#tour')).toHaveCount(0);                         // only once
  });

  test('Esc skips it; Settings shows it again; a link never shows it', async ({ page }) => {
    await page.goto('/');
    await expect(pop(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#tour')).toHaveCount(0);
    await page.goto('/#settings');
    await page.getByRole('button', { name: 'Show the intro again' }).click();
    await expect(pop(page)).toBeVisible();
    await page.locator('#tour-back').click();                                   // Skip tour
    await expect(page.locator('#tour')).toHaveCount(0);

    await page.evaluate(() => localStorage.removeItem('qamus.introDone'));
    await page.goto('/#q=' + encodeURIComponent('قلم'));                       // opened on a link
    await expect(page.locator('main .entry-row').first()).toBeVisible();
    await expect(page.locator('#tour')).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark']) {
    test(`the tour fits a 390px phone (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 780 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      for (let k = 0; k < 8; k++) {
        await expect(pop(page)).toBeVisible();
        if (k === 5) { await page.locator('#tf-card').click(); await expect(page.locator('#tf-grades')).toBeVisible(); }   // flipped: the tallest step
        const b = await pop(page).boundingBox();
        expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(390);
        expect(b.y).toBeGreaterThanOrEqual(0); expect(b.y + b.height).toBeLessThanOrEqual(780);
        if (k < 7) await next(page).click();
      }
    });
  }
});

test.describe('intro tour (synced)', () => {
  test.use({ intro: true });

  test('ends by offering a username', async ({ page }) => {
    await page.goto('/');
    await expect(pop(page)).toBeVisible();
    await expect(page.locator('.sheet')).toHaveCount(0);                        // not both at once
    for (let k = 0; k < 7; k++) await next(page).click();
    await expect(title(page)).toHaveText('Keep your words everywhere');
    await next(page).click();                                                   // Choose a username
    await expect(page.locator('.sheet #lg-name')).toBeVisible();
  });
});

test.describe('home', () => {
  test.use({ syncUrl: false });
  test('the credit line sits under the welcome', async ({ page }) => {
    await page.goto('/');
    const credit = page.locator('main .credit');
    await expect(credit).toHaveText('inspired by Youssef Z.');
    const hero = await page.locator('main .home-hero').boundingBox(), c = await credit.boundingBox();
    expect(c.y).toBeGreaterThan(hero.y + hero.height - 1);
  });
});
