// First-visit guided tour, and the "key"-style username suggestions in the sign-in sheet.
const { test, expect } = require('./fixtures');

const pop = page => page.locator('#tour .tour-pop');
const next = page => page.locator('#tour-next');

test.describe('intro tour (local)', () => {
  test.use({ syncUrl: false, intro: true });

  test('a first visit walks through search, results, saving, Vocab and Settings, records nothing, and runs once', async ({ page }) => {
    await page.goto('/');
    await expect(pop(page)).toBeVisible();
    await expect(page.locator('#tour-title')).toHaveText('أهلًا وسهلًا');
    await expect(next(page)).toBeFocused();
    await next(page).click();                                                   // Show me
    await expect(page.locator('#tour .tour-count')).toHaveText('1 of 5');
    await expect(page.locator('#tour-title')).toHaveText('Search anything');
    const hole = await page.locator('.tour-hole').boundingBox(), q = await page.locator('#q').boundingBox();
    expect(Math.abs(hole.x + hole.width / 2 - (q.x + q.width / 2))).toBeLessThan(2);   // spotlight sits on the search field
    await next(page).click();                                                   // Search كتاب
    await expect(page.locator('#tour-title')).toHaveText('Results by root');
    await expect(page).toHaveURL(/#q=/);
    await expect(page.locator('main .word.hit').first()).toBeVisible();
    for (const t of ['Save words', 'Study them', 'Make it yours']) { await next(page).click(); await expect(page.locator('#tour-title')).toHaveText(t); }
    await page.locator('#tour-back').click();
    await expect(page.locator('#tour-title')).toHaveText('Study them');
    await next(page).click(); await next(page).click();
    await expect(page.locator('#tour-title')).toHaveText('That’s it');
    await expect(page.locator('main .welcome')).toBeVisible();                 // back home for the last card
    await next(page).click();
    await expect(page.locator('#tour')).toHaveCount(0);
    expect(await page.evaluate(() => [QamusStore.doc.history.length, localStorage.getItem('qamus.introDone')])).toEqual([0, '1']);
    await page.reload();
    await page.waitForFunction(() => window.QamusStore?.doc);
    await page.waitForTimeout(300);
    await expect(page.locator('#tour')).toHaveCount(0);                         // only once
  });

  test('Esc skips it; Settings can show it again; links and returning users never see it', async ({ page }) => {
    await page.goto('/');
    await expect(pop(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#tour')).toHaveCount(0);
    await page.evaluate(() => go('settings'));
    await page.getByRole('button', { name: 'Show the intro again' }).click();
    await expect(pop(page)).toBeVisible();
    await page.locator('#tour-back').click();                                   // Skip tour
    await expect(page.locator('#tour')).toHaveCount(0);

    await page.evaluate(() => localStorage.removeItem('qamus.introDone'));
    await page.goto('/#q=' + encodeURIComponent('قلم'));                       // opened on a link
    await expect(page.locator('main details.root').first()).toBeVisible();
    await expect(page.locator('#tour')).toHaveCount(0);
    await page.goto('/');                                                       // has history now: not a first visit
    await page.waitForFunction(() => window.QamusStore?.doc?.history.length);
    await page.waitForTimeout(300);
    await expect(page.locator('#tour')).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark']) {
    test(`the tour fits a 390px phone with 44px buttons (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 780 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      for (let k = 0; k < 7; k++) {
        await expect(pop(page)).toBeVisible();
        const b = await pop(page).boundingBox();
        expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(390);
        expect(b.y).toBeGreaterThanOrEqual(0); expect(b.y + b.height).toBeLessThanOrEqual(780);
        for (const h of await page.locator('#tour button:visible').evaluateAll(bs => bs.map(x => x.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
        if (k < 6) await next(page).click();
      }
    });
  }
});

test.describe('intro tour (synced)', () => {
  test.use({ intro: true });

  test('the tour comes before the sign-in sheet and ends by offering it', async ({ page }) => {
    await page.goto('/');
    await expect(pop(page)).toBeVisible();
    await expect(page.locator('.sheet')).toHaveCount(0);                        // not both at once
    for (const t of ['Search anything', 'Results by root', 'Save words', 'Study them', 'Make it yours', 'Keep your words everywhere']) {
      await next(page).click();
      await expect(page.locator('#tour-title')).toHaveText(t);
    }
    await next(page).click();                                                   // Choose a username
    await expect(page.locator('.sheet #lg-name')).toBeVisible();
  });

  test('a slow network: the tour still starts when tour.js arrives after the saved data', async ({ page }) => {
    await page.route('**/tour.js', async r => { await new Promise(res => setTimeout(res, 1500)); await r.continue(); });
    await page.goto('/');
    await expect(pop(page)).toBeVisible();
    await expect(page.locator('.sheet')).toHaveCount(0);
  });

  test('sign-in suggests word+number keys, copies them, and nudges easy-to-guess names', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await page.keyboard.press('Escape');                                        // skip the tour
    await page.locator('#acct').click();
    const inp = page.locator('.sheet #lg-name');
    await expect(inp).toHaveValue(/^[a-z]+-\d{4}$/);
    await expect(page.locator('#lg-hint')).toHaveText('Looks unique.');
    const first = await inp.inputValue();
    await page.locator('#lg-regen').click();
    await expect(inp).not.toHaveValue(first);
    await page.locator('#lg-copy').click();
    await expect(page.locator('#lg-copy')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await inp.inputValue());
    await inp.fill('sam');
    await expect(page.locator('#lg-hint')).toHaveClass(/weak/);
    await expect(page.locator('#lg-hint')).toContainText('Easy to guess. Add a few digits, like');
    await inp.fill('sam-ruler-2207');
    await expect(page.locator('#lg-hint')).toHaveText('Looks unique.');
  });
});

test.describe('old address (synced)', () => {
  test.use({ intro: true });

  test('the old github.io copy points to the new home, shows a signed-in user their key, and skips the tour', async ({ page, user }) => {
    await page.addInitScript(() => { window.QAMUS_FORCE_MOVED = true; });
    await page.goto('/');
    const mv = page.locator('main .moved');
    await expect(mv).toContainText('Qamus has a new home: alqamus.pages.dev');
    await expect(mv.getByRole('link', { name: 'Open the new site' })).toHaveAttribute('href', 'https://alqamus.pages.dev/');
    await expect(mv).toContainText('turn on sync, then sign in there with the same username');
    await expect(page.locator('#tour')).toHaveCount(0);
    await page.keyboard.press('Escape');                                         // close the sign-in sheet
    await page.evaluate(u => QamusSync.signIn(u), user);
    await page.evaluate(() => go(''));
    await expect(mv.locator('code.key')).toHaveText(user);
    await expect(mv).toContainText('and your words come with you');
  });
});
