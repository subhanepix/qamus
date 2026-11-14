// SPEC §8 regression table: these lookups must keep resolving exactly as before.
const { test, expect, fold, bare } = require('./fixtures');

// Run in local-only mode so nothing but the dictionary is involved.
test.use({ syncUrl: false });

// Results depend on which data files have loaded (Wiktionary arrives last), so wait for
// all of them — HW, morphology, Wiktionary, Lane root list — and then search.
async function lookup(page, q) {
  await page.goto('/');
  await page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null);
  await page.evaluate(q => { location.hash = new URLSearchParams({ q }).toString(); }, q);
}

const ROOTS = [
  ['كتاب', 'ك ت ب'],
  ['ءكل', 'ا ك ل'],
  ['مسءلة', 'س ا ل'],
  ['سءال', 'س ا ل'],
  ['وسيكتبونها', 'ك ت ب'],
  ['بالكتاب', 'ك ت ب'],
  ['فقالوا', 'ق و ل'],
  ['يستغفرون', 'غ ف ر'],
  ['علمتموهن', 'ع ل م'],
  ['اخذتموه', 'ا خ ذ'],
  ['مدرسة', 'د ر س'],
];

for (const [q, root] of ROOTS) {
  test(`${q} → root ${root}`, async ({ page }) => {
    await lookup(page, q);
    const first = page.locator('main details.root .root-letters').first();
    await expect(first).toBeVisible();
    expect(fold(await first.textContent())).toBe(fold(root));
  });
}

test('هءلاء → هؤلاء', async ({ page }) => {
  await lookup(page, 'هءلاء');
  await expect(page.locator('main .hw, main .bw .w, main .list-item .w').first()).toBeVisible();
  await expect.poll(async () => {
    const words = await page.locator('main .hw, main .bw .w, main .list-item .w').allTextContents();
    return words.map(bare).includes('هؤلاء');
  }).toBe(true);
});

test('كتاتيب → Wiktionary card for كتاب', async ({ page }) => {
  await lookup(page, 'كتاتيب');
  const sec = page.locator('main h2.sec', { hasText: 'Wiktionary' });
  await expect(sec).toBeVisible();
  const words = await page.locator('main .bw .w').allTextContents();
  expect(words.map(bare)).toContain('كتاب');
});

test('ك ت ب → root card + Lane section loads', async ({ page }) => {
  await lookup(page, 'ك ت ب');
  const card = page.locator('main details.root').first();
  await expect(card.locator('.root-letters')).toBeVisible();
  expect(fold(await card.locator('.root-letters').textContent())).toBe(fold('ك ت ب'));
  const lane = card.locator('details.lane');
  await lane.locator('summary').click();
  await expect(lane.locator('.lane-entry').first()).toBeVisible();
});
