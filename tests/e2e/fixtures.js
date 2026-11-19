// Shared Playwright fixtures: console-error guard, sync URL wiring, random usernames.
const base = require('@playwright/test');
const config = require('../../playwright.config.js');

const { SITE, SYNC } = config.metadata;

// Same folding as app.js norm(): drop harakat/tatweel/spaces, unify hamza seats, ة→ه, ى→ي.
const DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭـ\s]/g;
const fold = s => s.replace(DIAC, '').replace(/[أإآٱءؤئ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const bare = s => s.replace(DIAC, '');

const randUser = () => 'e2e-' + Math.random().toString(36).slice(2, 10);

// Chrome logs every failed fetch (including expected 404s from HEAD /u/new-name, and
// offline failures) as a console error. Those are filtered here; real failures are
// caught by the same-origin response check and by pageerror.
const NOISE = /Failed to load resource|net::ERR_/;

function guard(page, errors) {
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
  // Tests must never reach the deployed Worker.
  page.on('request', r => { if (/workers\.dev/.test(r.url())) errors.push('production request: ' + r.url()); });
  page.on('response', r => {
    if (r.url().startsWith(SITE) && r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
}

const test = base.test.extend({
  // Set to false in a describe block to run the app in local-only mode.
  syncUrl: [SYNC, { option: true }],
  // The first-visit intro tour is off unless a test turns it on.
  intro: [false, { option: true }],
  user: async ({}, use) => { await use(randUser()); },
  errors: async ({}, use) => { await use([]); },
  context: async ({ context, syncUrl, intro }, use) => {
    await context.addInitScript(u => { try { localStorage.setItem('qamus.syncUrl', u); } catch {} }, syncUrl || '');
    if (!intro) await context.addInitScript(() => { try { localStorage.setItem('qamus.introDone', '1'); } catch {} });
    await use(context);
  },
  page: async ({ page, errors }, use) => {
    guard(page, errors);
    await use(page);
    base.expect(errors, 'no console errors / failed app requests').toEqual([]);
  },
});

// A second, independent "device" with the same guards.
async function newDevice(browser, { syncUrl = SYNC } = {}) {
  const context = await browser.newContext();
  await context.addInitScript(u => { try { localStorage.setItem('qamus.syncUrl', u); } catch {} }, syncUrl || '');
  await context.addInitScript(() => { try { localStorage.setItem('qamus.introDone', '1'); } catch {} });
  const page = await context.newPage();
  const errors = [];
  guard(page, errors);
  return { context, page, errors };
}

module.exports = { test, expect: base.expect, SITE, SYNC, fold, bare, randUser, newDevice };
