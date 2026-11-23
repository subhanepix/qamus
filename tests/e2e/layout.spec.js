// Settings back button, no sideways scroll on phones, and keyboard hints only where there's a keyboard.
const { test, expect } = require('./fixtures');

test.use({ syncUrl: false });

const ready = page => page.waitForFunction(() => document.querySelector('main .entry-row, main .particle-card, main .result-hero'));

test.describe('Settings back button', () => {
  test('goes back to the search you had open, at the same place', async ({ page }) => {
    await page.goto('/#q=' + encodeURIComponent('كتاب'));
    await expect(page.locator('main .entry-row.hit').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForFunction(() => Math.abs(window.scrollY - 1200) < 4);
    await page.locator('[data-nav-tab="settings"]:visible').first().click();
    const back = page.locator('#set-back');
    await expect(back).toHaveText('Back to كتاب');
    await back.click();
    await expect(page).toHaveURL(/#q=/);
    await page.waitForFunction(() => Math.abs(window.scrollY - 1200) < 4);
  });

  test('names Vocab and History; the gear and Esc also go back', async ({ page }) => {
    await page.goto('/#vocab');
    await page.locator('[data-nav-tab="settings"]:visible').first().click();
    await expect(page.locator('#set-back')).toHaveText('Back to Vocab');
    await page.locator('[data-nav-tab="settings"]:visible').first().click();   // the gear again
    await expect(page).toHaveURL(/#vocab$/);
    await page.goto('/#history');
    await page.locator('[data-nav-tab="settings"]:visible').first().click();
    await expect(page.locator('#set-back')).toHaveText('Back to History');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#history$/);
  });

  test('opened from a link, it goes to the search home', async ({ page }) => {
    await page.goto('/#settings');
    await expect(page.locator('#set-back')).toHaveText('Back to Search');
    await page.locator('#set-back').click();
    await expect(page.locator('main .home-hero')).toBeVisible();
  });
});

test('no sideways scroll on a 360px phone, particle pages included', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  for (const q of ['إنّ', 'لِ', 'أنْ', 'مِنْ', 'كتاب', 'عِلم', 'وسيكتبونها', 'library']) {
    await page.evaluate(q => { location.hash = '#q=' + encodeURIComponent(q); }, q);
    await ready(page);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), q).toBeLessThanOrEqual(360);
  }
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('keyboard hints are hidden', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#home-focus-search kbd')).toBeHidden();
  });
});

test('with a mouse and keyboard, the / hint shows', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#home-focus-search kbd')).toBeVisible();
});
