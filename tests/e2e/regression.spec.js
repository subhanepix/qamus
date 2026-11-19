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

// When a word matches nothing, search tries it again without a leading ال (وال, بال, فال, كال, لل) and then
// without an emphatic نّ. Words that already match are untouched (the table above).
const RETRIES = [
  ['تغرنكم', 'تغركم', 'غ ر', 'emphatic نّ'],        // نّ before the pronoun ending
  ['ليسجنن', 'ليسجن', 'س ج ن', 'emphatic نّ'],      // final ن
  ['ولنبلونكم', 'ولنبلوكم', 'ب ل و', 'emphatic نّ'],
  ['فلنسألن', 'فلنسأل', 'س ا ل', 'emphatic نّ'],
];
for (const [q, shown, root, why] of RETRIES) {
  test(`${q} → no match, so shows ${shown} (${why})`, async ({ page }) => {
    await lookup(page, q);
    const note = page.locator('main .retry-note');
    await expect(note).toContainText(`No match for ${q}. Showing ${shown}, without the ${why}.`);
    const roots = (await page.locator('main details.root .root-letters').allTextContents()).map(fold);
    expect(roots).toContain(fold(root));
    expect(decodeURIComponent(page.url().split('#q=')[1])).toBe(q);       // the address and history keep what you typed
  });
}

test('الآيوا → no match, so shows آيوا without ال (a Wiktionary word the analyser doesn’t know)', async ({ page }) => {
  await lookup(page, 'الآيوا');
  await expect(page.locator('main .retry-note')).toContainText('Showing آيوا, without the ال at the start.');
  await expect(page.locator('main h2.sec', { hasText: 'Wiktionary' })).toBeVisible();
  for (const q of ['والآيوا', 'بالآيوا']) {
    await page.evaluate(q => go({ q }), q);
    await expect(page.locator('main .retry-note')).toContainText(`No match for ${q}. Showing آيوا`);
  }
});

test('a word that already matches shows no retry note, and a word that still matches nothing falls back as before', async ({ page }) => {
  await lookup(page, 'ليكتبن');                                       // the analyser handles it already
  await expect(page.locator('main details.root').first()).toBeVisible();
  await expect(page.locator('main .retry-note')).toHaveCount(0);
  await page.evaluate(() => go({ q: 'الزززن' }));
  await expect(page.locator('main')).toContainText('No exact match for الزززن');
  await expect(page.locator('main .retry-note')).toHaveCount(0);
});

// A word found only after taking off ال is a noun, so the result shows no verb reading, and the dictionaries'
// own sentence for it comes first (التناوش: Hans Wehr has only form III ناوش; Mukhtār and al-Mufradāt define it).
test('التناوش → no verb reading, and the dictionaries’ sentence for it leads', async ({ page }) => {
  await lookup(page, 'التّناوُشُ');
  await expect(page.locator('main .retry-note')).toContainText('Showing تناوش, without the ال at the start.');
  const lead = page.locator('main .lead');
  await expect(lead).toBeVisible();
  await expect(lead.locator('.lead-item').first()).toBeVisible();
  expect(fold(await lead.locator('mark').first().textContent())).toBe('التناوش');
  await expect(lead.locator('.lead-src')).toHaveText([/al-Mufradāt/, /Mukhtār al-Ṣiḥāḥ/]);   // in your dictionary order
  for (const g of await page.locator('main .parse .gl').allTextContents()) expect(g).not.toContain('it/they/she');
  await lead.locator('.lead-src').nth(1).click();
  await expect(page.locator('main details.ard[data-dict="mukhtar"][open] b.hit').first()).toBeVisible();
});

test('with the Arabic dictionaries off, the lead quotes Lane, and Lane opens at the word', async ({ page }) => {
  await lookup(page, 'كتاب');
  await page.evaluate(() => { setResultPrefs({ off: ['mufradat', 'mukhtar'] }); go({ q: 'التناوش' }); });
  const lead = page.locator('main .lead');
  await expect(lead.locator('.lead-src')).toHaveText(/Lane’s Lexicon/);
  expect(fold(await lead.locator('mark').textContent())).toMatch(/تناوش$/);
  await expect(page.locator('main details.lane[open] .lane-entry.hit').first()).toBeVisible();
});

test('a word that matches as typed gets no lead', async ({ page }) => {
  await lookup(page, 'الكتاب');
  await expect(page.locator('main details.root').first()).toBeVisible();
  await expect(page.locator('main .lead')).toHaveCount(0);
});

test.describe('cold load', () => {
  test.use({ serviceWorkers: 'block' });   // so the delayed Wiktionary can't come from the offline cache
  test('a search opened straight from a link shows the Arabic dictionaries without waiting for Wiktionary', async ({ page }) => {
  await page.route('**/data/wikt.json', async r => { await new Promise(res => setTimeout(res, 4000)); await r.continue(); });
  await page.goto('/#q=' + encodeURIComponent('التناوش'));
  await expect(page.locator('main details.ard[data-dict="mukhtar"]')).toBeVisible();
  await expect(page.locator('main .lead .lead-src').first()).toBeVisible();
  expect(await page.evaluate(() => W === null)).toBe(true);                // Wiktionary still on its way
  });
});
