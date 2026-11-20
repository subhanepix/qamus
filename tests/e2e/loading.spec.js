// First load: the search index first, Hans Wehr as headwords plus definition chunks fetched as roots open,
// the rest of the chunks fetched quietly afterwards for offline use.
const { test, expect } = require('./fixtures');

test.use({ syncUrl: false });

const ready = page => page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null);

test('a search fetches only the headword index and its root’s chunk, never the whole of Hans Wehr', async ({ page }) => {
  const got = [];
  page.on('request', r => { const m = r.url().match(/\/data\/(.+)$/); if (m) got.push(m[1]); });
  await page.goto('/');
  await ready(page);
  const before = got.filter(u => u.startsWith('hw'));
  expect(got).not.toContain('hw.json');
  expect(before).toEqual(['hw/index.json']);                                  // nothing else from Hans Wehr yet
  expect(got.indexOf('index.json')).toBeLessThan(got.indexOf('hw/index.json'));   // the search index comes first
  await page.evaluate(() => go({ q: 'كتاب' }));
  await expect(page.locator('main .word.hit').first()).toContainText('piece of writing');
  const chunks = got.filter(u => /^hw\/c\d+\.json$/.test(u));
  expect(chunks.length).toBe(1);                                              // one ~200-root chunk for كتب
  await page.evaluate(() => go({ q: 'قلم' }));
  await expect(page.locator('main details.root').first()).toBeVisible();
  expect(got.filter(u => /^hw\/c\d+\.json$/.test(u)).length).toBeLessThanOrEqual(2);
});

test('English search loads every definition first; autocomplete fills in glosses as they arrive', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.evaluate(() => go({ q: 'library' }));
  await expect(page.locator('main h2.sec', { hasText: 'English' })).toBeVisible();
  await expect(page.locator('main .list-item').first()).toBeVisible();
  expect(await page.evaluate(() => hwHave(HW.chunks))).toBe(true);
});

test('autocomplete shows a gloss once its chunk has arrived', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('#q').fill('مكتب');
  await expect(page.locator('#suggest li').first()).toBeVisible();
  await expect(page.locator('#suggest li .g').first()).toContainText(/office|desk|bureau/);
});

test('after the first visit, the remaining chunks are fetched in the background for offline use', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.waitForFunction(() => hwHave(HW.chunks), null, { timeout: 25000 });
  const n = await page.evaluate(() => HW.chunks.length);
  expect(n).toBeGreaterThan(20);
  expect(await page.evaluate(() => HW.entries.every(e => typeof e[2] === 'string'))).toBe(true);
});

test.describe('slow network', () => {
  test.use({ serviceWorkers: 'block' });   // so the delay below applies to every chunk request
  test('a slow chunk shows "Loading Hans Wehr…", then the entry', async ({ page }) => {
  await page.route('**/data/hw/c*.json', async r => { await new Promise(res => setTimeout(res, 800)); await r.continue(); });
  await page.goto('/');
  await ready(page);
  await page.evaluate(() => go({ q: 'كتاب' }));
  await expect(page.locator('main')).toContainText('Loading Hans Wehr…');
  await expect(page.locator('main .word.hit').first()).toContainText('piece of writing');
});
});
