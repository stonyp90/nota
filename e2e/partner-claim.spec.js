'use strict';

/**
 * partner-claim.spec — a referral partner claims a code.
 *
 * A real-estate agent picks their profession, enters a professional email and a
 * desired code, and submits. In production the claim only PENDS until the
 * emailed link is opened; outside production the API echoes the devToken and the
 * app confirms in place, revealing the shareable "?ref=CODE" link.
 *
 * The code is unique per run so a re-run never trips the 409 "code already
 * claimed" path against the long-lived in-memory demo repo.
 */
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

function uniqueCode() {
  // 4–12 alphanumerics (domain rule). "E2E" + base36 time tail stays inside it.
  return ('E2E' + Date.now().toString(36)).toUpperCase().slice(0, 12);
}

test('a partner claims a referral code and gets a share link', async ({ page }) => {
  await gotoHome(page, { suppressOnboarding: true });
  const code = uniqueCode();

  // Open the Partners door and fill the claim form.
  await page.locator('#tab-partenaires').click();
  await page.locator('#partner-type button[data-type="agent_immobilier"]').click();
  await page.locator('#partner-courriel').fill('e2e.partner@agence.demo');
  await page.locator('#partner-code').fill(code);

  const submit = page.locator('#partner-submit');
  await expect(submit).toBeEnabled();

  // Submit and read the /partenaires acknowledgement (the dev echo).
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/partenaires') && r.request().method() === 'POST'),
    submit.click(),
  ]);
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.ok).toBe(true);
  expect(body.devToken, 'non-prod dev echo carries the confirmation token').toBeTruthy();
  expect(body.devLink, 'dev link is the #pauth confirmation link').toContain('#pauth=');

  // The app redeems the echoed token and reveals the confirmed share link.
  const success = page.locator('#partner-success');
  await expect(success).toBeVisible();
  const link = page.locator('#partner-link');
  await expect(link).toContainText(`?ref=${code}`);
});
