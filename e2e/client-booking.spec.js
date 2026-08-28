'use strict';

/**
 * client-booking.spec — the headline journey.
 *
 * From the home page: pass the first-visit onboarding gate as a CLIENT, land in
 * the booking sheet, choose the FINANCING act, answer the notary's required
 * questions, accept the pre-filled offer (a valid amount within the act's range)
 * and publish — then assert the confirmation state.
 */
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

const FIN_FLOOR = 1800;

test('a client publishes a financing offer end to end', async ({ page }) => {
  // Deliberately DO NOT suppress onboarding — passing the gate is part of the journey.
  await gotoHome(page);

  // --- Onboarding gate: choose "I'm looking for a notary", then continue. -----
  const onb = page.locator('#onboarding-dialog');
  await expect(onb).toBeVisible();
  await expect(page.locator('#onb-title')).toHaveText(/Welcome to Nota/i);

  await onb.locator('.onb-choice[data-role="client"]').click();
  const cta = page.locator('#onb-cta');
  await expect(cta).toBeVisible();
  // The client CTA reads "Post my request →" and chains into the booking sheet.
  await cta.click();

  // --- Booking sheet ----------------------------------------------------------
  const sheet = page.locator('#day-dialog');
  await expect(sheet).toBeVisible();

  // Step 1 — pick the Financing act.
  await sheet.locator('#o-service-chips button[data-svc="financement"]').click();
  await expect(sheet.locator('#o-service-chips button[data-svc="financement"]')).toHaveAttribute('aria-pressed', 'true');

  // Step 2 — the notary's REQUIRED questions for financement: loan amount,
  // what the loan finances, the bank-approval stage, the LENDER (the
  // catalogue select) and the TRAVEL band for the in-person signature
  // (ADR 0017 — the second catalogue select). Answering all five is what
  // lifts the submit gate (D.validateOffer → parametre_requis).
  await sheet.locator('#crit-valeur_pret').fill('350000');
  await sheet.locator('#crit-contexte__propriete_detenue').click();
  await sheet.locator('#crit-approbation_bancaire__obtenue').click();
  await sheet.locator('#crit-preteur').selectOption('banque_nationale');
  await sheet.locator('#crit-deplacement').selectOption('client_50');

  // The REQUIRED postal sector (domain: prefixe_requis) — the last gate.
  const submit = sheet.locator('#offer-submit');
  await expect(submit).toBeDisabled();
  await sheet.locator('#o-prefix').fill('G1R');

  // Step 3 — the offer is pre-filled to a valid amount within the act's range.
  await expect(submit).toBeEnabled();

  // Sanity-check the pre-filled amount really is a valid, above-floor offer.
  const amount = Number(await sheet.locator('#o-amount').inputValue());
  const amountMax = Number(await sheet.locator('#o-amount').getAttribute('max'));
  expect(amount, 'pre-filled offer must clear the financement floor').toBeGreaterThanOrEqual(FIN_FLOOR);
  expect(amount, 'pre-filled offer must sit within the slider ceiling').toBeLessThanOrEqual(amountMax);

  // --- Publish and confirm ----------------------------------------------------
  // The demand is created by POST /bids; catch the 200 so the assertion is on
  // the real server acknowledgement, not just optimistic UI.
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/bids') && r.request().method() === 'POST'),
    submit.click(),
  ]);
  // POST /bids answers 201 Created on success.
  expect(resp.ok(), `POST /bids should succeed, got ${resp.status()}: ${await resp.text()}`).toBeTruthy();

  // The success card unhides, the CTA flips to its confirmed label, and a toast
  // reports the published amount.
  await expect(sheet.locator('#offer-success')).toBeVisible();
  await expect(sheet.locator('#offer-success')).toContainText(/Offer published/i);
  await expect(submit).toContainText(/Offer published/i);
  await expect(page.locator('#toast')).toContainText(/Offer published/i);
});
