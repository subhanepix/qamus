// SPEC §2/§3: IndexedDB store, sync with the Worker (wrangler dev), login sheet, account menu.
const { test, expect, SYNC, randUser, newDevice } = require('./fixtures');

// ---------- helpers ----------
async function open(page, { skipLogin = true } = {}) {
  if (skipLogin) await page.addInitScript(() => { try { localStorage.setItem('qamus.syncSkipped', '1'); } catch {} });
  await page.goto('/');
  await page.evaluate(() => QamusStore.init());
}
const ready = page => expect(page.locator('#acct')).toBeVisible();
const signIn = (page, user) => page.evaluate(u => QamusSync.signIn(u), user);
const syncNow = page => page.evaluate(() => QamusSync.syncNow());
const status = page => page.evaluate(() => QamusSync.state.status);
const cards = page => page.evaluate(() => QamusStore.doc.cards);
const card = (list, id) => list.find(c => c.id === id);

function putCard(page, c) {
  return page.evaluate(c => QamusStore.mutate(d => {
    const now = Date.now();
    if (!d.folders.some(f => f.id === 'f_inbox')) d.folders.push({ id: 'f_inbox', name: 'Inbox', parent: null, createdAt: now, updatedAt: now, deleted: false });
    const full = { folder: 'f_inbox', word: 'كتاب', gloss: '', tags: [], createdAt: now, updatedAt: now, deleted: false, ...c };
    const i = d.cards.findIndex(x => x.id === c.id);
    if (i >= 0) d.cards[i] = { ...d.cards[i], ...full }; else d.cards.push(full);
  }), c);
}
async function remote(user) {
  const r = await fetch(`${SYNC}/u/${user}`);
  return r.status === 200 ? r.json() : null;
}
async function seedRemote(user, cardList) {
  const now = Date.now();
  const doc = {
    v: 1, updatedAt: now, history: [], reviews: {}, settings: { updatedAt: 0 },
    folders: [{ id: 'f_inbox', name: 'Inbox', parent: null, createdAt: now, updatedAt: now, deleted: false }],
    cards: cardList.map(c => ({ folder: 'f_inbox', word: 'قلم', updatedAt: now, deleted: false, ...c })),
  };
  const r = await fetch(`${SYNC}/u/${user}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
  expect(r.status).toBe(200);
}
async function closeDevice(dev) {
  expect(dev.errors, 'device B: no console errors').toEqual([]);
  await dev.context.close();
}

// ---------- local-only mode ----------
test.describe('without SYNC_URL', () => {
  test.use({ syncUrl: false });

  test('no account button, no login sheet; data still persists in IndexedDB', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => QamusStore.init());
    await expect(page.locator('#acct')).toBeHidden();
    await expect(page.locator('.sheet')).toHaveCount(0);
    expect(await page.evaluate(() => QamusStore.persistent)).toBe(true);
    await putCard(page, { id: 'c_local', gloss: 'book' });
    await page.evaluate(() => QamusStore.whenSaved());
    await page.reload();
    await page.evaluate(() => QamusStore.init());
    expect(card(await cards(page), 'c_local').gloss).toBe('book');
  });
});

// ---------- login sheet ----------
test.describe('login sheet', () => {
  test('new account: validates, says "New account", creates it', async ({ page, user }) => {
    await open(page, { skipLogin: false });
    const sheet = page.locator('.sheet');
    await expect(sheet.getByRole('heading', { name: 'Choose a username to sync across devices' })).toBeVisible();
    const inp = sheet.locator('#lg-name');
    await expect(inp).toHaveValue(/^[a-z]+-\d{4}$/);
    await expect(inp).toBeFocused();

    await inp.fill('ab');
    await inp.press('Enter');
    await expect(sheet.locator('#lg-msg')).toHaveText(/3–32 characters/);

    await inp.fill(user.toUpperCase());
    await sheet.getByRole('button', { name: 'Continue' }).click();
    await expect(sheet.locator('#lg-msg')).toContainText('New account');
    await expect(inp).toHaveValue(user);   // lowercased
    await sheet.getByRole('button', { name: 'Create account' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('#acct')).toHaveAttribute('data-status', 'synced');
    expect(await remote(user)).not.toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('qamus.user'))).toBe(user);
  });

  test('existing account says "Welcome back" and pulls its data', async ({ page, user }) => {
    await seedRemote(user, [{ id: 'c_srv', gloss: 'pen' }]);
    await open(page, { skipLogin: false });
    const sheet = page.locator('.sheet');
    await sheet.locator('#lg-name').fill(user);
    await sheet.locator('#lg-name').press('Enter');
    await expect(sheet.locator('#lg-msg')).toContainText('Welcome back');
    await sheet.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#acct')).toHaveAttribute('data-status', 'synced');
    expect(card(await cards(page), 'c_srv').gloss).toBe('pen');
  });

  test('"Use without syncing" stays dismissed after reload; Esc closes', async ({ page }) => {
    await open(page, { skipLogin: false });
    await page.locator('.sheet').getByRole('button', { name: 'Use without syncing' }).click();
    await expect(page.locator('.sheet')).toHaveCount(0);
    await page.reload();
    await ready(page);
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.locator('#acct')).toHaveAttribute('data-status', 'local');
    await page.locator('#acct').click();          // opens the login form again
    await expect(page.locator('#lg-name')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.locator('#acct')).toBeFocused();
  });

  test('unreachable server is reported, not treated as a new account', async ({ page, context }) => {
    await open(page, { skipLogin: false });
    await context.setOffline(true);
    await page.locator('.sheet').getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('#lg-msg')).toContainText('Can’t reach the sync server');
    await expect(page.locator('.sheet').getByRole('button', { name: 'Retry' })).toBeVisible();
    await context.setOffline(false);
  });
});

// ---------- store + sync ----------
test('changes persist across reload (IndexedDB) and reach the server', async ({ page, user }) => {
  await open(page);
  await ready(page);
  await signIn(page, user);
  await putCard(page, { id: 'c1', gloss: 'book' });
  await page.evaluate(() => QamusStore.whenSaved());
  await page.reload();
  await page.evaluate(() => QamusStore.init());
  expect(card(await cards(page), 'c1').gloss).toBe('book');
  await syncNow(page);
  expect(card((await remote(user)).cards, 'c1').gloss).toBe('book');
  expect(await status(page)).toBe('synced');
});

test('debounced push sends a change without Sync now', async ({ page, user }) => {
  await open(page);
  await ready(page);
  await signIn(page, user);
  await putCard(page, { id: 'c_auto', gloss: 'auto' });
  await expect.poll(async () => card((await remote(user))?.cards || [], 'c_auto')?.gloss, { timeout: 8000 }).toBe('auto');
  await expect.poll(() => status(page)).toBe('synced');
});

test('two devices: save on A appears on B; deletes propagate as tombstones', async ({ page, user, browser }) => {
  await open(page); await ready(page);
  await signIn(page, user);
  await putCard(page, { id: 'c_a', gloss: 'from A' });
  await syncNow(page);

  const B = await newDevice(browser);
  await open(B.page); await ready(B.page);
  await signIn(B.page, user);
  expect(card(await cards(B.page), 'c_a').gloss).toBe('from A');

  await page.evaluate(() => QamusStore.mutate(d => { const c = d.cards.find(x => x.id === 'c_a'); c.deleted = true; c.updatedAt = Date.now(); }));
  await syncNow(page);
  await syncNow(B.page);
  expect(card(await cards(B.page), 'c_a').deleted).toBe(true);
  await closeDevice(B);
});

test('offline edits on both devices: newer updatedAt wins, nothing lost', async ({ page, context, user, browser }) => {
  await open(page); await ready(page);
  await signIn(page, user);
  await putCard(page, { id: 'c_x', gloss: 'original' });
  await syncNow(page);
  const B = await newDevice(browser);
  await open(B.page); await ready(B.page);
  await signIn(B.page, user);

  await context.setOffline(true);
  await B.context.setOffline(true);
  const t = Date.now();
  await putCard(page, { id: 'c_x', gloss: 'edited on A', updatedAt: t });
  await putCard(page, { id: 'c_only_a', gloss: 'A' });
  await putCard(B.page, { id: 'c_x', gloss: 'edited on B (newer)', updatedAt: t + 5000 });
  await putCard(B.page, { id: 'c_only_b', gloss: 'B' });
  await syncNow(page);
  expect(await status(page)).toBe('offline');
  await expect(page.locator('#acct')).toHaveAttribute('data-status', 'offline');

  await context.setOffline(false);
  await B.context.setOffline(false);
  await syncNow(page);
  await syncNow(B.page);
  await syncNow(page);
  for (const p of [page, B.page]) {
    const cs = await cards(p);
    expect(card(cs, 'c_x').gloss).toBe('edited on B (newer)');
    expect(card(cs, 'c_only_a').gloss).toBe('A');
    expect(card(cs, 'c_only_b').gloss).toBe('B');
    expect(await status(p)).toBe('synced');
  }
  const srv = await remote(user);
  expect(srv.cards.map(c => c.id).sort()).toEqual(['c_only_a', 'c_only_b', 'c_x']);
  await closeDevice(B);
});

test('offline: saving still works, status shows offline, reconnect syncs', async ({ page, context, user }) => {
  await open(page); await ready(page);
  await signIn(page, user);
  await context.setOffline(true);
  await putCard(page, { id: 'c_off', gloss: 'saved offline' });
  await syncNow(page);
  await expect(page.locator('#acct')).toHaveAttribute('data-status', 'offline');
  expect(card(await cards(page), 'c_off').gloss).toBe('saved offline');
  expect(await page.evaluate(() => QamusStore.dirty)).toBe(true);
  await context.setOffline(false);   // the 'online' event triggers a sync by itself
  await expect(page.locator('#acct')).toHaveAttribute('data-status', 'synced');
  expect(card((await remote(user)).cards, 'c_off').gloss).toBe('saved offline');
});

test('signing in on a device with local data merges it into the account', async ({ page, user }) => {
  await seedRemote(user, [{ id: 'c_srv', gloss: 'server' }]);
  await open(page); await ready(page);
  await putCard(page, { id: 'c_dev', gloss: 'device' });   // local-only so far
  await signIn(page, user);
  const ids = (await cards(page)).map(c => c.id).sort();
  expect(ids).toEqual(['c_dev', 'c_srv']);
  expect((await remote(user)).cards.map(c => c.id).sort()).toEqual(['c_dev', 'c_srv']);
});

// ---------- account sheet / sign out ----------
test('account sheet: Sync now, sign out and remove data', async ({ page, user }) => {
  await open(page); await ready(page);
  await signIn(page, user);
  await putCard(page, { id: 'c1' });
  await syncNow(page);
  await page.locator('#acct').click();
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText(user);
  await expect(sheet.locator('#ac-status')).toContainText('Synced');
  await sheet.getByRole('button', { name: 'Sync now' }).click();
  await expect(sheet.locator('#ac-status')).toContainText('Synced');
  await sheet.getByRole('button', { name: 'Sign out' }).click();
  await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await sheet.getByRole('button', { name: 'Sign out and remove data from this device' }).click();
  await expect(sheet).toHaveCount(0);
  expect(await cards(page)).toEqual([]);
  await expect(page.locator('#acct')).toHaveAttribute('data-status', 'local');
  expect(await page.evaluate(() => localStorage.getItem('qamus.user'))).toBeNull();
  expect((await remote(user)).cards.length).toBe(1);   // account untouched
});

test('sign out, keep data here', async ({ page, user }) => {
  await open(page); await ready(page);
  await signIn(page, user);
  await putCard(page, { id: 'c1' });
  await syncNow(page);
  await page.locator('#acct').click();
  await page.locator('.sheet').getByRole('button', { name: 'Sign out' }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Sign out, keep data here' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  expect((await cards(page)).length).toBe(1);
  await expect(page.locator('#acct')).toHaveAttribute('data-status', 'local');
});

test('sign out with unsynced changes offline asks again instead of losing them', async ({ page, context, user }) => {
  await open(page); await ready(page);
  await signIn(page, user);
  await context.setOffline(true);
  await putCard(page, { id: 'c_unsynced' });
  await page.locator('#acct').click();
  const sheet = page.locator('.sheet');
  await sheet.getByRole('button', { name: 'Sign out' }).click();
  await expect(sheet.locator('#ac-q')).toContainText('haven’t synced yet');
  await sheet.getByRole('button', { name: 'Sign out and remove data from this device' }).click();
  await expect(sheet.locator('#ac-q')).toContainText('couldn’t be synced', { timeout: 10000 });
  await sheet.getByRole('button', { name: 'Sign out, keep data here' }).click();
  await expect(sheet).toHaveCount(0);
  expect(card(await cards(page), 'c_unsynced')).toBeTruthy();
  await context.setOffline(false);
});

// ---------- layout ----------
for (const scheme of ['light', 'dark']) {
  test(`sheet fits at 400px with no horizontal scroll (${scheme})`, async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, { skipLogin: false });
    await expect(page.locator('.sheet')).toBeVisible();
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      sheetW: document.querySelector('.sheet').getBoundingClientRect().width,
      bg: getComputedStyle(document.querySelector('.sheet')).backgroundColor,
      ink: getComputedStyle(document.querySelector('.sheet')).color,
    }));
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    expect(m.sheetW).toBeLessThanOrEqual(400);
    expect(m.bg).toBe(scheme === 'dark' ? 'rgb(30, 33, 37)' : 'rgb(255, 253, 248)');
    expect(m.ink).toBe(scheme === 'dark' ? 'rgb(235, 231, 223)' : 'rgb(29, 29, 27)');
    const btns = await page.locator('.sheet button').evaluateAll(bs => bs.map(b => Math.round(b.getBoundingClientRect().height)));
    for (const h of btns) expect(h).toBeGreaterThanOrEqual(44);
  });
}
