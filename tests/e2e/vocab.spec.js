// SPEC §5: saving words, folders, vocab/folder views, CSV/JSON import & export.
const fs = require('node:fs');
const { test, expect, newDevice, SYNC } = require('./fixtures');

// ---------- helpers ----------
// Waits for the dictionary data too: load() re-runs route() as each file arrives, which re-renders the view.
async function boot(page, path = '/') {
  await page.goto(path);
  await page.evaluate(() => QamusStore.init());
  await page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null);
}
const dataReady = page => page.waitForFunction(() => typeof W !== 'undefined' && W !== null && laneRoots !== null);
async function lookup(page, q) {
  await page.evaluate(q => go({ q }), q);
  await expect(page.locator('main .save-btn').first()).toBeVisible();
}
const cards = page => page.evaluate(() => QamusStore.doc.cards.filter(c => !c.deleted));
const sheet = page => page.locator('.sheet');
const hitSave = page => page.locator('main .word.hit > .save-btn').first();
async function seed(page, { folders = [], cards: cs = [] }) {
  await page.evaluate(({ folders, cs }) => QamusStore.mutate(d => {
    const now = Date.now();
    for (const f of folders) d.folders.push({ parent: null, createdAt: now, updatedAt: now, deleted: false, ...f });
    cs.forEach((c, i) => d.cards.push({ id: 'c_seed' + i + '_' + now.toString(36), folder: 'f_inbox', key: norm(c.word), gloss: '', tags: [], source: 'custom', ref: '', createdAt: now - i, updatedAt: now, deleted: false, ...c }));
  }), { folders, cs });
}
const INBOX = { id: 'f_inbox', name: 'Inbox' };

test.describe('local vocab', () => {
  test.use({ syncUrl: false });

  test('every dictionary row type has a bookmark; picking a folder saves it with the row\'s meaning', async ({ page }) => {
    await boot(page); await dataReady(page);
    const check = async (btn, word) => {
      const before = (await cards(page)).length;
      await btn.click();
      await expect(sheet(page).locator('.pick-word [lang=ar]')).toBeVisible();
      if (word) await expect(sheet(page).locator('.pick-word [lang=ar]')).toHaveText(word);
      await sheet(page).getByRole('button', { name: 'Save to Inbox' }).click();
      await expect(sheet(page)).toHaveCount(0);
      const cs = await cards(page);
      expect(cs).toHaveLength(before + 1);
      const g = cs[cs.length - 1].gloss;
      expect(g.length).toBeGreaterThan(0);
      expect(g.length).toBeLessThanOrEqual(121);
      expect(g).not.toMatch(/[<>]/);
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
    };
    await lookup(page, 'كتاب');
    await check(hitSave(page));                                              // HW word row
    await check(page.locator('main .forms .save-btn').first());              // verb-form row
    await lookup(page, 'كتاتيب');
    await check(page.locator('main .bw > .save-btn').first(), 'كتاب');       // Wiktionary card
    await lookup(page, 'كمبيوتر');
    await expect(page.locator('main h2.sec', { hasText: 'Lexicon' })).toBeVisible();
    await check(page.locator('main .bw', { hasText: 'not in Hans Wehr' }).locator('.save-btn').first());   // lexicon card
    await lookup(page, 'ك ت ب');
    const lane = page.locator('main details.root').first().locator('details.lane');
    await lane.locator('summary').click();
    await check(lane.locator('.lane-entry > .save-btn').nth(1));              // Lane entry
  });

  test('save a word in two taps: bookmark, then a folder; toast confirms; Vocab lists it after reload', async ({ page }) => {
    await boot(page); await dataReady(page);
    await lookup(page, 'كتاب');
    const btn = hitSave(page);
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await btn.click();
    await expect(sheet(page).locator('.sheet-head h2')).toHaveText('Save to folder');
    await expect(sheet(page).locator('#sp-gloss')).toHaveText(/^piece of writing/);   // "pl. كتب kutub" stripped
    await expect(sheet(page).getByRole('button', { name: 'Save to Inbox' })).toBeFocused();   // last-used (default) folder
    await sheet(page).getByRole('button', { name: 'Save to Inbox' }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('#toast')).toContainText('Saved to Inbox');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    const [c] = await cards(page);
    expect(c).toMatchObject({ word: 'كتاب', key: 'كتاب', root: 'ك ت ب', source: 'hw', folder: 'f_inbox', translit: 'kitāb' });
    await page.evaluate(() => QamusStore.whenSaved());
    await page.goto('/#vocab');
    await expect(page.locator('.folder-row')).toHaveCount(1);
    await expect(page.locator('.folder-row')).toContainText('Inbox');
    await expect(page.locator('.folder-row')).toContainText('1 card');
    await page.reload();
    await expect(page.locator('.folder-row')).toContainText('1 card');
  });

  test('new folder from the picker saves into it; that folder is focused next time; Edit opens the full form', async ({ page }) => {
    await boot(page); await dataReady(page);
    await lookup(page, 'مدرسة');
    await hitSave(page).click();
    await sheet(page).getByRole('button', { name: 'New folder' }).click();
    await expect(sheet(page).locator('#sp-newf-name')).toBeFocused();
    await sheet(page).getByRole('button', { name: 'Create and save' }).click();
    await expect(sheet(page).locator('#sp-msg')).toHaveText('Enter a name.');
    await sheet(page).locator('#sp-newf-name').fill('دع الأيام');
    await page.keyboard.press('Enter');
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('#toast')).toContainText('Saved to دع الأيام');
    const folder = await page.evaluate(() => QamusStore.doc.folders.find(f => f.name === 'دع الأيام'));
    expect(folder).toBeTruthy();
    expect((await cards(page))[0].folder).toBe(folder.id);

    await page.locator('#toast').getByRole('button', { name: 'Edit' }).click();
    await expect(sheet(page).locator('.sheet-head h2')).toHaveText('Edit card');
    await sheet(page).locator('#cf-note').fill('from the poem');
    await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet(page)).toHaveCount(0);
    expect((await cards(page))[0].note).toBe('from the poem');

    await lookup(page, 'قلم');
    await hitSave(page).click();
    await expect(sheet(page).getByRole('button', { name: 'Save to دع الأيام' })).toBeFocused();
  });

  test('a ticked folder means saved there: tapping it removes, Undo restores; a word can live in two folders', async ({ page }) => {
    await boot(page); await dataReady(page);
    await seed(page, { folders: [INBOX, { id: 'f_b', name: 'Poem' }] });
    await lookup(page, 'كتاب');
    const btn = hitSave(page);
    await btn.click();
    await sheet(page).getByRole('button', { name: 'Save to Inbox' }).click();
    await btn.click();   // second tap: the same picker, Inbox ticked
    const inbox = sheet(page).getByRole('button', { name: 'Remove from Inbox' });
    await expect(inbox).toHaveAttribute('aria-pressed', 'true');
    await expect(inbox).toContainText('Saved');
    await sheet(page).getByRole('button', { name: 'Save to Poem' }).click();
    expect((await cards(page)).map(c => c.folder).sort()).toEqual(['f_b', 'f_inbox']);

    await btn.click();
    await sheet(page).getByRole('button', { name: 'Remove from Inbox' }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('#toast')).toContainText('Removed from Inbox');
    expect((await cards(page)).map(c => c.folder)).toEqual(['f_b']);
    await expect(btn).toHaveAttribute('aria-pressed', 'true');   // still in Poem
    await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
    expect((await cards(page)).map(c => c.folder).sort()).toEqual(['f_b', 'f_inbox']);
    const restored = (await cards(page)).find(c => c.folder === 'f_inbox');
    expect(restored).toMatchObject({ word: 'كتاب', root: 'ك ت ب', source: 'hw' });

    await btn.click();
    await sheet(page).getByRole('button', { name: 'Remove from Inbox' }).click();
    await btn.click();
    await sheet(page).getByRole('button', { name: 'Remove from Poem' }).click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  test('folders: create, nest, rename, move (not into a descendant), delete both ways', async ({ page }) => {
    await boot(page, '/#vocab');
    const create = async (name, parentLabel) => {
      if (parentLabel) await page.locator('.folder-row', { hasText: parentLabel }).getByRole('button', { name: /Folder actions/ }).click();
      if (parentLabel) await sheet(page).getByRole('button', { name: 'New sub-folder' }).click();
      else await page.getByRole('button', { name: 'New folder' }).click();
      await sheet(page).locator('#nf-name').fill(name);
      await sheet(page).getByRole('button', { name: 'Create' }).click();
      await expect(sheet(page)).toHaveCount(0);
    };
    await create('Alpha');
    await create('Beta');
    await create('Beta1', 'Beta');
    await expect(page.locator('.folder-row .fr-name')).toHaveText(['Alpha', 'Beta', 'Beta1']);
    await expect(page.locator('.folder-row').nth(2)).toHaveAttribute('style', /--depth:1/);

    const actions = label => page.locator('.folder-row', { hasText: label }).first().getByRole('button', { name: /Folder actions/ });
    await actions('Alpha').click();
    await sheet(page).locator('#fa-name').fill('Alpha2');
    await sheet(page).getByRole('button', { name: 'Rename' }).click();
    await expect(sheet(page).locator('#fa-msg')).toHaveText('Renamed.');
    await page.keyboard.press('Escape');

    await actions('Beta').click();
    await sheet(page).locator('#fa-parent').selectOption({ label: 'Alpha2' });
    await sheet(page).getByRole('button', { name: 'Move' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.folder-row .fr-name')).toHaveText(['Alpha2', 'Beta', 'Beta1']);
    await expect(page.locator('.folder-row').nth(2)).toHaveAttribute('style', /--depth:2/);

    await actions('Alpha2').click();   // can't move into its own descendants
    const opts = await sheet(page).locator('#fa-parent option').allTextContents();
    expect(opts.map(o => o.trim())).not.toContain('Beta1');
    expect(opts.map(o => o.trim())).not.toContain('Alpha2');
    await page.keyboard.press('Escape');

    const ids = await page.evaluate(() => Object.fromEntries(QamusStore.doc.folders.map(f => [f.name, f.id])));
    await seed(page, { cards: [{ id: 'c_b1', word: 'قلم', folder: ids.Beta1 }, { id: 'c_a', word: 'باب', folder: ids.Alpha2 }] });

    await actions('Beta').click();
    await sheet(page).getByRole('button', { name: 'Delete folder…' }).click();
    await expect(sheet(page).locator('#fa-confirm')).toContainText('and its 1 sub-folder');
    await sheet(page).getByRole('button', { name: 'Delete folder, move 1 card to Inbox' }).click();
    await expect(page.locator('.folder-row .fr-name')).toHaveText(['Inbox', 'Alpha2']);
    expect((await cards(page)).find(c => c.id === 'c_b1').folder).toBe('f_inbox');

    await actions('Alpha2').click();
    await sheet(page).getByRole('button', { name: 'Delete folder…' }).click();
    await sheet(page).getByRole('button', { name: 'Delete folder and 1 card' }).click();
    await expect(page.locator('.folder-row .fr-name')).toHaveText(['Inbox']);
    expect((await cards(page)).map(c => c.id)).toEqual(['c_b1']);

    await actions('Inbox').click();
    await expect(sheet(page).getByRole('button', { name: 'Delete folder…' })).toHaveCount(0);
  });

  test('folder view: add card, filter, open in dictionary, edit, select → move / delete', async ({ page }) => {
    await boot(page);
    await seed(page, {
      folders: [INBOX, { id: 'f_other', name: 'Other' }],
      cards: [{ id: 'c1', word: 'كتاب', gloss: 'book', source: 'hw', ref: '' }, { id: 'c2', word: 'قلم', gloss: 'pen' }, { id: 'c3', word: 'باب', gloss: 'door' }],
    });
    await dataReady(page);   // then point c1 at the real Hans Wehr entry for كتاب
    await page.evaluate(() => QamusStore.mutate(d => { const e = [...byId.values()].find(x => x[1] === 'كتاب'); d.cards.find(c => c.id === 'c1').ref = String(e[0]); }));
    await page.goto('/#folder=f_inbox');
    await expect(page.locator('.card-row')).toHaveCount(3);

    await page.getByRole('button', { name: 'Add card' }).click();
    await sheet(page).locator('#cf-word').fill('سبورة');
    await sheet(page).locator('#cf-gloss').fill('blackboard');
    await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.card-row')).toHaveCount(4);
    expect((await cards(page)).find(c => c.word === 'سبورة')).toMatchObject({ source: 'custom', key: 'سبوره', folder: 'f_inbox' });

    await page.locator('#vf-filter').fill('black');
    await expect(page.locator('.card-row')).toHaveCount(1);
    await expect(page.locator('#vf-filter')).toBeFocused();
    await page.locator('#vf-filter').fill('');
    await expect(page.locator('.card-row')).toHaveCount(4);

    await page.locator('.card-row', { hasText: 'pen' }).locator('.cg').click();
    await sheet(page).locator('#cf-gloss').fill('pen, quill');
    await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.card-row', { hasText: 'pen, quill' })).toHaveCount(1);

    await page.locator('.card-row', { hasText: 'book' }).locator('.cw').click();
    await expect(page).toHaveURL(/#e=\d+/);
    await expect(page.locator('main .word.hit')).toBeVisible();
    await page.goBack();
    await expect(page.locator('.card-row')).toHaveCount(4);

    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('checkbox', { name: 'Select قلم' }).check();
    await page.getByRole('checkbox', { name: 'Select باب' }).check();
    await expect(page.locator('.select-bar')).toContainText('2 selected');
    await page.locator('.select-bar').getByRole('button', { name: 'Move…' }).click();
    await sheet(page).locator('#mv-folder').selectOption('f_other');
    await sheet(page).getByRole('button', { name: 'Move', exact: true }).click();
    await expect(page.locator('.card-row')).toHaveCount(2);
    await expect(page.locator('.select-bar')).toHaveCount(0);
    expect((await cards(page)).filter(c => c.folder === 'f_other').map(c => c.id).sort()).toEqual(['c2', 'c3']);

    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('checkbox', { name: 'Select سبورة' }).check();
    await page.locator('.select-bar').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.select-bar')).toContainText('Delete 1 card?');
    await page.locator('.select-bar').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('.card-row')).toHaveCount(1);
  });

  test('export CSV (BOM, header, quoting) and JSON', async ({ page }) => {
    await boot(page);
    await seed(page, { folders: [INBOX], cards: [
      { word: 'كتاب', gloss: 'book, "volume"\nsecond line', tags: ['noun', 'l1'], root: 'ك ت ب' },
      { word: 'قلم', gloss: 'pen' },
    ] });
    await page.goto('/#folder=f_inbox');
    await page.getByRole('button', { name: 'Export' }).click();
    const [csv] = await Promise.all([page.waitForEvent('download'), sheet(page).getByRole('button', { name: 'Download CSV' }).click()]);
    expect(csv.suggestedFilename()).toMatch(/^qamus-Inbox-\d{4}-\d\d-\d\d\.csv$/);
    const text = fs.readFileSync(await csv.path(), 'utf8');
    expect(text.startsWith('﻿word,gloss,arGloss,root,translit,context,note,tags\r\n')).toBe(true);
    expect(text).toContain('"book, ""volume""\nsecond line"');
    const back = await page.evaluate(t => parseImport(t, 'x.csv'), text);
    expect(back.items.map(i => i.word)).toEqual(['قلم', 'كتاب'].sort((a, b) => text.indexOf(a) - text.indexOf(b)));
    expect(back.items.find(i => i.word === 'كتاب')).toMatchObject({ gloss: 'book, "volume"\nsecond line', tags: ['noun', 'l1'], root: 'ك ت ب' });

    await page.getByRole('button', { name: 'Export' }).click();
    const [js] = await Promise.all([page.waitForEvent('download'), sheet(page).getByRole('button', { name: 'Download JSON' }).click()]);
    const j = JSON.parse(fs.readFileSync(await js.path(), 'utf8'));
    expect(j.qamus).toBe(1);
    expect(j.cards).toHaveLength(2);
    expect(j.cards[0]).toHaveProperty('folder', 'Inbox');
  });

  test('import CSV (header, quotes, CRLF, duplicates), Anki TSV, and JSON round-trip', async ({ page }) => {
    await boot(page);
    await seed(page, { folders: [INBOX, { id: 'f_b', name: 'B' }], cards: [{ word: 'قلم', gloss: 'pen' }] });
    await page.goto('/#folder=f_inbox');
    const importFile = async (name, content) => {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import' }).click()]);
      await chooser.setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content, 'utf8') });
      await expect(sheet(page).getByRole('heading', { name: 'Import cards' })).toBeVisible();
    };

    await importFile('words.csv', '﻿word,gloss,tags\r\n"كِتَاب","book, volume",noun\r\nقلم,pen\r\n,orphan row\r\nباب,door\r\n');
    await expect(sheet(page)).toContainText('words.csv — 3 cards · 1 row without a word skipped');
    await expect(sheet(page).locator('#im-dupn')).toHaveText('1');
    await expect(sheet(page).locator('#im-go')).toHaveText('Import 2 cards');
    await sheet(page).locator('#im-go').click();
    await expect(page.locator('.card-row')).toHaveCount(3);
    expect((await cards(page)).find(c => c.word === 'كِتَاب')).toMatchObject({ gloss: 'book, volume', tags: ['noun'], key: 'كتاب', source: 'custom' });

    await importFile('anki.txt', '#separator:tab\n#html:false\nشمس\tsun\nقمر\tmoon\n');
    await expect(sheet(page)).toContainText('2 cards');
    await sheet(page).locator('#im-go').click();
    await expect(page.locator('.card-row')).toHaveCount(5);
    expect((await cards(page)).find(c => c.word === 'قمر').gloss).toBe('moon');

    await page.getByRole('button', { name: 'Export' }).click();
    const [js] = await Promise.all([page.waitForEvent('download'), sheet(page).getByRole('button', { name: 'Download JSON' }).click()]);
    await importFile('export.json', fs.readFileSync(await js.path(), 'utf8'));
    await expect(sheet(page)).toContainText('5 cards');
    await sheet(page).locator('#im-folder').selectOption('f_b');
    await expect(sheet(page).locator('#im-dupn')).toHaveText('0');
    await sheet(page).locator('#im-go').click();
    await expect(page).toHaveURL(/#folder=f_b$/);
    await expect(page.locator('.card-row')).toHaveCount(5);
  });

  test('vocab screens and the save-to-folder picker fit 400px in both themes', async ({ page }) => {
    for (const scheme of ['light', 'dark']) {
      await page.setViewportSize({ width: 400, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await boot(page);
      if (scheme === 'light') {
        await seed(page, { folders: [INBOX, { id: 'f_long', name: 'A rather long folder name that should wrap or truncate' }, { id: 'f_sub', name: 'Sub', parent: 'f_long' }],
          cards: [{ word: 'استخدامات', gloss: 'uses; usages; applications of something quite long to force wrapping in the row' }, { word: 'قلم', gloss: 'pen' }] });
      }
      const noScroll = async () => {
        const m = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        expect(m[0]).toBeLessThanOrEqual(m[1]);
        const hs = await page.locator('main button:visible, .sheet button:visible').evaluateAll(bs => bs.map(b => [b.textContent.trim().slice(0, 20), Math.round(b.getBoundingClientRect().height)]));
        for (const [label, h] of hs) expect(h, label).toBeGreaterThanOrEqual(44);
      };
      await page.goto('/#vocab'); await expect(page.locator('.folder-row').first()).toBeVisible(); await noScroll();
      await page.goto('/#folder=f_inbox'); await page.getByRole('button', { name: 'Select' }).click(); await noScroll();
      await dataReady(page);
      await lookup(page, 'كتاب');
      await noScroll();
      await hitSave(page).click(); await noScroll();
      await page.keyboard.press('Escape');
    }
  });
});

test.describe('synced vocab', () => {
  async function device(page, user) {
    await page.addInitScript(() => { try { localStorage.setItem('qamus.syncSkipped', '1'); } catch {} });
    await boot(page);
    await expect(page.locator('#acct')).toBeVisible();
    await dataReady(page);
    await page.evaluate(u => QamusSync.signIn(u), user);
  }

  test('a word saved through the UI on A appears on B', async ({ page, user, browser }) => {
    await device(page, user);
    await lookup(page, 'كتاب');
    await hitSave(page).click();
    await sheet(page).getByRole('button', { name: 'Save to Inbox' }).click();
    await page.evaluate(() => QamusSync.syncNow());

    const B = await newDevice(browser);
    await device(B.page, user);
    await B.page.evaluate(() => go('vocab'));
    await expect(B.page.locator('.folder-row')).toContainText('Inbox');
    await expect(B.page.locator('.folder-row')).toContainText('1 card');
    await lookup(B.page, 'كتاب');
    await expect(hitSave(B.page)).toHaveAttribute('aria-pressed', 'true');
    expect(B.errors).toEqual([]);
    await B.context.close();
  });

  test('saving works offline and syncs on reconnect', async ({ page, context, user }) => {
    await device(page, user);
    await lookup(page, 'كتاب');
    await context.setOffline(true);
    await hitSave(page).click();
    await sheet(page).getByRole('button', { name: 'Save to Inbox' }).click();
    await expect(hitSave(page)).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => QamusSync.syncNow());
    await expect(page.locator('#acct')).toHaveAttribute('data-status', 'offline');
    await context.setOffline(false);
    await expect(page.locator('#acct')).toHaveAttribute('data-status', 'synced');
    const r = await (await fetch(`${SYNC}/u/${user}`)).json();
    expect(r.cards.filter(c => !c.deleted).map(c => c.word)).toEqual(['كتاب']);
  });
});
