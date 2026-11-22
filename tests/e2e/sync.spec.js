// Two-device sync via the local Cloudflare Worker: 2-step HEAD login, merge, and safe sign-out.
const { test, expect, newDevice } = require('./fixtures');

test('Two-device login, card sync, and safe sign-out', async ({ browser, page, user }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.engineStage === 'full');

  // Sign in on Device A (2-step HEAD check -> New account -> Create account)
  await page.locator('#rail-acct').click();
  await page.locator('#lg-name').fill(user);
  await page.locator('#lg-go').click();
  await expect(page.locator('#lg-msg')).toContainText('New account');
  await page.locator('#lg-confirm').click();
  await expect.poll(() => page.evaluate(() => QamusSync.state.status)).toBe('synced');

  // Save a card on Device A
  await page.evaluate(() => { location.hash = new URLSearchParams({ q: 'كتاب' }).toString(); });
  await page.locator('section[data-sec="hw"] .entry-row').first().locator('.bm-btn').click();
  await page.locator('.sheet .pick-folder-btn', { hasText: 'Inbox' }).click();
  await page.evaluate(() => QamusSync.syncNow());

  // Sign in with same username on Device B (HEAD check -> Welcome back -> Sign in)
  const devB = await newDevice(browser);
  try {
    await devB.page.goto('/');
    await devB.page.locator('#rail-acct').click();
    await devB.page.locator('#lg-name').fill(user);
    await devB.page.locator('#lg-go').click();
    await expect(devB.page.locator('#lg-msg')).toContainText('Welcome back');
    await devB.page.locator('#lg-confirm').click();
    await expect.poll(() => devB.page.evaluate(() => QamusSync.state.status)).toBe('synced');

    await devB.page.evaluate(() => { location.hash = 'vocab'; });
    await expect(devB.page.locator('.folder-card', { hasText: 'Inbox' })).toContainText('1 card');

    // Safe sign-out on Device B (remove local data)
    await devB.page.locator('#rail-acct').click();
    await devB.page.locator('#ac-out').click();
    await devB.page.locator('#ac-clear').click();
    await expect.poll(() => devB.page.evaluate(() => QamusSync.state.user)).toBe(null);
    await expect(devB.page.locator('main')).toContainText('No saved words yet');
    expect(devB.errors).toEqual([]);
  } finally {
    await devB.context.close();
  }
});
