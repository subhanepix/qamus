// SPEC §8 regression lookups, Arabic dictionaries, Particles & Harf Jarr, and Tashkeel prioritization.
const { test, expect, fold, bare } = require('./fixtures');

test.use({ syncUrl: false });

async function bootFull(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.engineStage === 'full');
}

async function lookup(page, q) {
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

test('SPEC §8 root lookups all resolve cleanly', async ({ page }) => {
  await bootFull(page);
  for (const [q, root] of ROOTS) {
    await lookup(page, q);
    const first = page.locator('main details.root-folio .rf-letters').first();
    await expect(first).toBeVisible();
    expect(fold(await first.textContent()), `${q} -> ${root}`).toBe(fold(root));
  }
});

test('كتاتيب → Wiktionary card for كتاب & ك ت ب → Lane + Arabic dictionaries load', async ({ page }) => {
  await bootFull(page);
  await lookup(page, 'كتاتيب');
  const wiktSec = page.locator('section[data-sec="wikt"]');
  await expect(wiktSec).toBeVisible();
  const words = await wiktSec.locator('.entry-hw').allTextContents();
  expect(words.map(bare)).toContain('كتاب');

  await lookup(page, 'ك ت ب');
  const muf = page.locator('details.ar-details[data-ar-dict="mufradat"]').first();
  const mux = page.locator('details.ar-details[data-ar-dict="mukhtar"]').first();
  await expect(muf.locator('.ar-ms-text').first()).toContainText('الْكَتْبُ');
  await expect(mux.locator('.ar-ms-text').first()).toContainText('مِنْ بَابِ نَصَرَ');

  const lane = page.locator('details.lane-details').first();
  await lane.locator('summary').click();
  await expect(lane.locator('.entry-row').first()).toBeVisible();
});

test('ال and emphatic نّ retries + المؤمنين ranking', async ({ page }) => {
  await bootFull(page);
  await lookup(page, 'تغرنكم');
  await expect(page.locator('.retry-banner')).toContainText('تغركم');

  await lookup(page, 'التّناوُشُ');
  await expect(page.locator('.retry-banner')).toContainText('تناوش');
  await expect(page.locator('#lead-slot .lead-card').first()).toBeVisible();

  await lookup(page, 'المؤمنين');
  await expect(page.locator('.morph-summary').first()).toContainText('believer');
});

test('Curated Particles & Harf Jarr render above roots with grammar effects', async ({ page }) => {
  await bootFull(page);
  await lookup(page, 'إِنَّ');
  const firstCard = page.locator('section[data-sec="particles"] .particle-card').first();
  await expect(firstCard).toBeVisible();
  await expect(firstCard.locator('.pc-word')).toHaveText('إِنَّ');
  await expect(firstCard).toContainText('Exact match');
  await expect(firstCard).toContainText('حرف توكيد ونصب');

  await lookup(page, 'لِ');
  const liCard = page.locator('section[data-sec="particles"] .particle-card').first();
  await expect(liCard.locator('.pc-word')).toHaveText('لِ');
  await expect(liCard).toContainText('Harf Jarr');

  await lookup(page, 'ان');
  expect(await page.locator('section[data-sec="particles"] .particle-card').count()).toBeGreaterThanOrEqual(4);
});

test('Soft tashkeel prioritization promotes exact match and falls back gracefully on wrong tashkeel', async ({ page }) => {
  await bootFull(page);
  await lookup(page, 'عِلْم');
  const firstEntry = page.locator('section[data-sec="hw"] .entry-row').first();
  await expect(firstEntry).toContainText('‘ilm');
  await expect(firstEntry).toContainText('Exact match');

  await lookup(page, 'عَلَم');
  const alamEntry = page.locator('section[data-sec="hw"] .entry-row').first();
  await expect(alamEntry).toContainText('‘alam');

  await lookup(page, 'عُلْم');
  await expect(page.locator('.result-hero')).toContainText('No exact harakat match');
  await expect(page.locator('section[data-sec="hw"] details.root-folio')).toBeVisible();
});
