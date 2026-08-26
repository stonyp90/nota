'use strict';

/**
 * notary-signin.spec — the passwordless notary sign-in.
 *
 * Outside production the API is enumeration-safe but echoes the challenge token
 * (devToken / devLink "#nauth=…") so the handshake completes with no mailbox.
 * Two ways in, both covered:
 *   1. The gate form — request a link; the app redeems the echoed token in place
 *      and the console opens.
 *   2. The emailed link — boot with "#nauth=<token>" and the app consumes it.
 */
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

const NOTARY_EMAIL = 'notaire.demo@etude.ca';

test('gate form: request a link and the console opens (devToken echoed)', async ({ page }) => {
  await gotoHome(page, { suppressOnboarding: true });

  // Enter the notary space and submit the professional email.
  await page.locator('#tab-notaires').click();
  await page.locator('#nc-email').fill(NOTARY_EMAIL);

  // Capture the /notary/session/request response so we assert on the real dev
  // echo the app then redeems (in prod this same submit would show "check your
  // inbox" instead — no token in the body).
  const [reqResp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/notary/session/request') && r.request().method() === 'POST'),
    page.locator('#notary-console-signin').click(),
  ]);
  expect(reqResp.status()).toBe(200);
  const body = await reqResp.json();
  expect(body.ok, 'request is always a generic ok').toBe(true);
  expect(body.devToken, 'non-prod dev echo carries the challenge token').toBeTruthy();
  expect(body.devLink, 'dev link is the #nauth magic link').toContain('#nauth=');

  // The app redeems the echoed token and the authenticated console renders.
  await expect(page.locator('#notary-authed')).toBeVisible();
  await expect(page.locator('#notary-email-label')).toHaveText(NOTARY_EMAIL);

  // The open agenda is the point of the console: real demands (grouped into
  // per-date sections), each funnelling into a retain control ("Take on").
  const openList = page.locator('#notary-open-list');
  await expect(openList.locator('section.nc-day').first()).toBeVisible();
  const takeOn = openList.getByRole('button', { name: /Take on/i }).first();
  await expect(takeOn, 'each open demand funnels into a retain action').toBeVisible();
});

test('magic link: booting with #nauth=<token> opens the console', async ({ page }) => {
  // Land first so we can read the app's configured API base, then mint a FRESH
  // challenge token straight from the API (so the UI has not already consumed
  // it) and boot the app with the emailed-link hash.
  await gotoHome(page, { suppressOnboarding: true });
  const apiBase = await page.evaluate(() => window.__NOTA_API__);
  expect(apiBase, 'the web app must be pointed at the demo API').toBeTruthy();

  const resp = await page.request.post(`${apiBase}/notary/session/request`, {
    data: { email: NOTARY_EMAIL },
    headers: { 'content-type': 'application/json' },
  });
  const { devToken } = await resp.json();
  expect(devToken, 'need a challenge token to simulate the emailed link').toBeTruthy();

  // The app consumes "#nauth=" on load, lands on the notary tab and verifies.
  // A unique query param forces a FULL document load — a hash-only change from
  // the current URL would be same-document and never re-run the boot consumer.
  await page.goto(`/?lang=en&e2e=${Date.now()}#nauth=${encodeURIComponent(devToken)}`);

  await expect(page.locator('#notary-authed')).toBeVisible();
  await expect(page.locator('#notary-email-label')).toHaveText(NOTARY_EMAIL);
  // The single-use token is stripped from the URL so a refresh can't replay it.
  await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('nauth');
});
