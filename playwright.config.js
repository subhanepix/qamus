// Browser tests. Run: npm run test:e2e  (first time: npx playwright install chromium)
const { defineConfig, devices } = require('@playwright/test');

const SITE = 'http://127.0.0.1:8100';
const SYNC = 'http://127.0.0.1:8788';

module.exports = defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: { baseURL: SITE, ...devices['Desktop Chrome'], headless: true },
  projects: [{ name: 'chromium' }],
  webServer: [
    { command: 'node tests/serve.js 8100', url: SITE + '/index.html', reuseExistingServer: !process.env.CI },
    // /u/x is an invalid username → 400, which Playwright treats as "up".
    { command: 'npm --prefix worker run dev -- --port 8788 --ip 127.0.0.1', url: SYNC + '/u/x', reuseExistingServer: !process.env.CI, timeout: 60000 },
  ],
  metadata: { SITE, SYNC },
});
