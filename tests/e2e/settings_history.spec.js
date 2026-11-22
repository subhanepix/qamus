// Settings (themes, Arabic fonts, text sizes, dictionary toggles), History, and Mobile 390px layout.
const { test, expect } = require('./fixtures');

test.use({ syncUrl: false });

test('Settings: switch themes, Arabic fonts, text size steppers, and toggle dictionaries', async ({ page }) => {
  await page.goto('/#settings');
  await expect(page.locator('.page-title')).toHaveText('Settings & Appearance');

  // Theme switches
  await page.locator('[data-set-theme="sepia"]').click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('sepia');
  await page.locator('[data-set-theme="night"]').click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('night');

  // Arabic font switches
  await page.locator('[data-set-font="scheherazade"]').click();
  expect(await page.evaluate(() => document.documentElement.dataset.arFont)).toBe('scheherazade');

  // Text size stepper
  await page.locator('[data-step="ar"][data-d="1"]').click();
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--t-ar'))).toBe('1.1');

  // Disable al-Mufradāt and verify it hides on lookup
  await page.locator('[data-dict-toggle="mufradat"]').uncheck();
  await page.waitForFunction(() => document.documentElement.dataset.engineStage === 'full');
  await page.evaluate(() => { location.hash = new URLSearchParams({ q: 'كتب' }).toString(); });
  await expect(page.locator('section[data-sec="hw"]')).toBeVisible();
  await expect(page.locator('section[data-sec="mufradat"]')).toHaveCount(0);
});

test('History records lookups, pauses, deletes, and clears', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.engineStage === 'full');

  await page.evaluate(() => { location.hash = new URLSearchParams({ q: 'كتاب' }).toString(); });
  await expect(page.locator('.result-hero')).toBeVisible();
  await page.evaluate(() => { location.hash = new URLSearchParams({ q: 'مدرسة' }).toString(); });
  await expect(page.locator('.result-hero')).toBeVisible();

  await page.evaluate(() => { location.hash = 'history'; });
  await expect(page.locator('main')).toContainText('2 recorded lookups');

  // Pause recording
  await page.locator('#hist-pause').check();
  await page.evaluate(() => { location.hash = new URLSearchParams({ q: 'قلم' }).toString(); });
  await expect(page.locator('.result-hero')).toBeVisible();
  await page.evaluate(() => { location.hash = 'history'; });
  await expect(page.locator('main')).toContainText('2 recorded lookups');

  // Clear all
  await page.locator('#hist-clear-ask').click();
  await page.locator('#hist-clear-yes').click();
  await expect(page.locator('main')).toContainText('No searches recorded yet');
});

test('Mobile 390px has no horizontal overflow and clean placeholder', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.engineStage === 'full');
  expect(await page.locator('#q').getAttribute('placeholder')).toBe('Search Qamus…');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);

  await page.evaluate(() => { location.hash = new URLSearchParams({ q: 'ك ت ب' }).toString(); });
  await expect(page.locator('section[data-sec="hw"]')).toBeVisible();
  const resOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(resOverflow).toBe(false);
});
