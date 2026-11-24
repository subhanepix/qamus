// Vocab bookmarks, folders, mastery bars, manual cards, and Study mode (Review SM-2 + Undo + Browse).
const { test, expect } = require('./fixtures');

test.use({ syncUrl: false });

test('Save word -> Vocab folder & mastery bar -> Study Review + Undo + Browse', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.engineStage === 'full');

  // Search عِلْم and bookmark it into Inbox
  await page.evaluate(() => { location.hash = new URLSearchParams({ q: 'عِلْم' }).toString(); });
  const bm = page.locator('section[data-sec="hw"] .entry-row').first().locator('.bm-btn');
  await expect(bm).toBeVisible();
  await bm.click();
  await page.locator('.sheet .pick-folder-btn', { hasText: 'Inbox' }).click();
  await expect(bm).toHaveAttribute('aria-pressed', 'true');

  // Reload to verify IndexedDB persistence
  await page.evaluate(() => QamusStore.whenSaved());
  await page.reload();
  await page.evaluate(() => { location.hash = 'vocab'; });
  const inboxCard = page.locator('.folder-card', { hasText: 'Inbox' });
  await expect(inboxCard).toBeVisible();
  await expect(inboxCard).toContainText('1 card');
  await expect(inboxCard).toContainText('1 due');
  await expect(inboxCard.locator('.mastery-bar')).toBeVisible();

  // Open Inbox folder and add a manual card
  await inboxCard.locator('.fc-open').click();
  await expect(page.locator('.vcard-row')).toHaveCount(1);
  await page.locator('#vf-add-card').click();
  await page.locator('#cs-word').fill('قَلَم');
  await page.locator('#cs-gloss').fill('pen');
  await page.locator('#cs-form button[type="submit"]').click();
  await expect(page.locator('.vcard-row')).toHaveCount(2);

  // Enter Study Review mode
  await page.getByRole('button', { name: /Review/ }).click();
  await expect(page.locator('#fc-card')).toBeVisible();
  await page.locator('#st-flip').click();
  await expect(page.locator('#fc-card')).toHaveClass(/flipped/);

  // Grade Good, then test Undo!
  await page.locator('[data-grade="2"]').click();
  await expect(page.locator('#st-undo')).toBeVisible();
  await page.locator('#st-undo').click();
  await expect(page.locator('#fc-card')).toHaveClass(/flipped/);

  // Grade both cards to finish session
  await page.locator('[data-grade="2"]').click();
  await page.locator('#st-flip').click();
  await page.locator('[data-grade="3"]').click();
  await expect(page.locator('main')).toContainText('Session complete');

  // Switch to Browse mode
  await page.getByRole('button', { name: 'Browse all cards' }).click();
  await expect(page.locator('#st-got')).toBeVisible();
});

test('A card saved with its sentence shows the sentence as a hint on the front (AR → EN only)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.engineStage === 'full');

  // Make the Inbox by bookmarking a word, then add a card with a context sentence
  await page.evaluate(() => { location.hash = new URLSearchParams({ q: 'عِلْم' }).toString(); });
  const bm = page.locator('section[data-sec="hw"] .entry-row').first().locator('.bm-btn');
  await bm.click();
  await page.locator('.sheet .pick-folder-btn', { hasText: 'Inbox' }).click();
  await page.evaluate(() => { location.hash = 'vocab'; });
  await page.locator('.folder-card', { hasText: 'Inbox' }).locator('.fc-open').click();
  await page.locator('#vf-add-card').click();
  await page.locator('#cs-word').fill('مِفْتَاح');
  await page.locator('#cs-gloss').fill('key');
  await page.locator('#cs-context').fill('إنّ معرفةَ الكلماتِ مفتاحُ الفهمِ');
  await page.locator('#cs-form button[type="submit"]').click();
  await expect(page.locator('.vcard-row')).toHaveCount(2);

  // Browse until the مفتاح card is up
  await page.getByRole('button', { name: /Browse/ }).click();
  const word = page.locator('.fc-front .fc-word');
  for (let i = 0; i < 2 && !(await word.textContent()).includes('مِفْتَاح'); i++) await page.locator('#st-next').click();
  await expect(word).toHaveText('مِفْتَاح');

  // Front: the sentence, with the word (as written, vowels and all) marked
  const hint = page.locator('.fc-front .fc-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('معرفةَ الكلماتِ');
  await expect(hint.locator('mark')).toHaveText('مفتاحُ');

  // EN → AR: the sentence would give the answer away, so it stays off the front
  await page.locator('#st-dir').click();
  await expect(page.locator('.fc-front .fc-en-front')).toBeVisible();
  await expect(page.locator('.fc-front .fc-hint')).toHaveCount(0);
});
