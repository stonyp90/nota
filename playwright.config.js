'use strict';

/**
 * Playwright E2E config for the Nota web app.
 *
 * Boots BOTH demo servers on fixed test ports (the API first, then the web
 * server that points at it) and drives the critical user journeys through a
 * Chromium plus a compatibility matrix. The demo API runs on in-memory fixtures with the
 * magic-link dev echo enabled (NOTA_DEMO_OPEN=true, non-production), so the
 * notary and partner link flows complete with no mailbox.
 *
 * Ports are dedicated to E2E (and deliberately off the common 8788/4173 dev
 * ports) so a running `npm run dev` never collides with a test run.
 */
const { defineConfig, devices } = require('@playwright/test');

// Dedicated, overridable E2E ports. Keep them off the usual dev ports so a
// developer's running app is never mistaken for (or clobbered by) the test app.
const API_PORT = Number(process.env.E2E_API_PORT || 8811);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 4311);
const ADMIN_PORT = Number(process.env.E2E_ADMIN_PORT || 4312);
const DOCS_PORT = Number(process.env.E2E_DOCS_PORT || 4313);
const API_BASE = `http://localhost:${API_PORT}`;
const WEB_BASE = `http://localhost:${WEB_PORT}`;

module.exports = defineConfig({
  testDir: './e2e',
  // The *.test.mjs signing journeys use node:test and own their servers.
  // Importing them during Playwright discovery starts untracked browsers.
  testMatch: '**/*.spec.js',
  // Keep the whole suite fast and independent — every spec file runs in parallel.
  fullyParallel: true,
  // A stray test.only must fail the CI run rather than silently shrink coverage.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The suite opens real media peers and several browser engines. Keep the
  // default local run bounded too; opt into more workers with --workers=N.
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: WEB_BASE,
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testMatch: /(compatibility|every-surface|client-calendar-guide)\.spec\.js/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: /(compatibility|every-surface|client-calendar-guide)\.spec\.js/, use: { ...devices['Desktop Safari'] } },
    { name: 'iphone', testMatch: /(compatibility|every-surface|client-calendar-guide)\.spec\.js/, use: { ...devices['iPhone 13'] } },
    { name: 'android', testMatch: /(compatibility|every-surface|client-calendar-guide)\.spec\.js/, use: { ...devices['Pixel 7'] } },
    { name: 'ipad', testMatch: /(compatibility|every-surface|client-calendar-guide)\.spec\.js/, use: { ...devices['iPad (gen 7)'] } },
  ],
  // Start the API first (its /health gate), then the web app that proxies to it.
  // reuseExistingServer keeps local iteration instant; CI always boots clean.
  webServer: [
    {
      // A test-only wrapper around the same demo stack, with the notary/partner
      // rate limits raised so the shared-IP suite never trips the 429 throttle.
      command: `node e2e/servers/api-server.js`,
      // The signing room is a shipped surface: the suite measures and drives
      // it, so the beta flag its routes read is on for the test stack.
      env: { NOTA_DEMO_OPEN: 'true', NOTA_SITE_URL: WEB_BASE, PORT: String(API_PORT), NODE_ENV: 'test', NOTA_SIGNING_BETA_ENABLED: 'true' },
      url: `${API_BASE}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `node apps/web/run-local.mjs`,
      env: { NOTA_API_BASE: API_BASE, PORT: String(WEB_PORT) },
      url: WEB_BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // docs/ as the deploy ships it (pitch deck, business plan): the layout
      // spec measures those two surfaces like any other page.
      command: `node e2e/servers/docs-server.js`,
      env: { PORT: String(DOCS_PORT) },
      url: `http://localhost:${DOCS_PORT}/business-plan.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `node apps/admin/run-local.mjs`,
      env: { NOTA_ADMIN_API: API_BASE, PORT: String(ADMIN_PORT) },
      url: `http://localhost:${ADMIN_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
