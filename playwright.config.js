'use strict';

/**
 * Playwright E2E config for the Nota web app.
 *
 * Boots BOTH demo servers on fixed test ports (the API first, then the web
 * server that points at it) and drives the critical user journeys through a
 * single headless Chromium. The demo API runs on in-memory fixtures with the
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
const API_BASE = `http://localhost:${API_PORT}`;
const WEB_BASE = `http://localhost:${WEB_PORT}`;

module.exports = defineConfig({
  testDir: './e2e',
  // Keep the whole suite fast and independent — every spec file runs in parallel.
  fullyParallel: true,
  // A stray test.only must fail the CI run rather than silently shrink coverage.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker on CI keeps the shared in-memory API deterministic; local dev
  // fans out. Specs are written to be mutation-safe either way (unique codes,
  // additive bookings), so this is a determinism nicety, not a correctness need.
  workers: process.env.CI ? 1 : undefined,
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
  ],
  // Start the API first (its /health gate), then the web app that proxies to it.
  // reuseExistingServer keeps local iteration instant; CI always boots clean.
  webServer: [
    {
      // A test-only wrapper around the same demo stack, with the notary/partner
      // rate limits raised so the shared-IP suite never trips the 429 throttle.
      command: `node e2e/servers/api-server.js`,
      env: { NOTA_DEMO_OPEN: 'true', PORT: String(API_PORT), NODE_ENV: 'test' },
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
  ],
});
