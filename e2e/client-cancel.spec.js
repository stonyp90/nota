'use strict';

/**
 * client-cancel.spec — the withdrawal journey (ADR 0023).
 *
 * Publish a financing offer through the real booking sheet, then cancel it
 * from the account panel: the confirm dialog opens, the API answers 200 and
 * the offer ends `annulee`. The local stack runs WITHOUT Stripe, so this
 * journey exercises the free path and asserts the fee note stays hidden —
 * the fee arithmetic and its disclosure are covered by the BDD suite
 * (annulation.feature) and the DOM tests (cancel-fee.test.mjs).
 */
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

test('a client cancels their published offer end to end', async ({ page }) => {
  await gotoHome(page, { suppressOnboarding: true });

  // --- Publish, on the same rails as client-booking.spec ---------------------
  await page
    .locator('.pulse-row[data-svc="financement"]')
    .locator('xpath=..')
    .locator('.mini-reserver')
    .click();
  const sheet = page.locator('#day-dialog');
  await expect(sheet).toBeVisible();

  await sheet.locator('#crit-valeur_pret').fill('350000');
  await sheet.locator('#crit-contexte__propriete_detenue').click();
  await sheet.locator('#crit-approbation_bancaire__obtenue').click();
  await sheet.locator('#crit-preteur').selectOption('banque_nationale');
  await sheet.locator('#crit-deplacement').selectOption('client_50');

  const submit = sheet.locator('#offer-submit');
  await expect(submit).toBeEnabled();
  const [posted] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/bids') && r.request().method() === 'POST'),
    submit.click(),
  ]);
  expect(posted.status(), await posted.text()).toBe(201);
  await expect(sheet.locator('#offer-success')).toBeVisible();
  await page.keyboard.press('Escape');

  // --- Cancel from « My offers » ----------------------------------------------
  // The bell opens the account panel; its « My offers » door lands on the
  // profil tab, where the offer card carries « Annuler cette offre ».
  await page.locator('#notif-bell').click();
  await page.locator('#notif-panel .acct-action', { hasText: 'My offers' }).click();
  const cancelBtn = page.locator('.btn-offer-cancel').first();
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();

  const dlg = page.locator('#cancel-dialog');
  await expect(dlg).toBeVisible();
  // No Stripe locally → no live hold → the withdrawal is free and says so by
  // NOT announcing a fee (ADR 0023 §5: never a fee outside the Stripe consent).
  await expect(dlg.locator('#cancel-fee')).toBeHidden();

  const [cancelled] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/client/bid/cancel') && r.request().method() === 'POST'),
    dlg.locator('#cancel-confirm').click(),
  ]);
  expect(cancelled.status(), await cancelled.text()).toBe(200);
  const body = await cancelled.json();
  expect(body.bid.status).toBe('annulee');
  expect(body.bid.annulation).toBeNull();
});
