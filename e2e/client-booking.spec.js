'use strict';

/**
 * client-booking.spec — the headline journey.
 *
 * From the home page: pass the first-visit onboarding gate as a CLIENT, land in
 * the booking sheet, choose the FINANCING act, answer the notary's required
 * questions, accept the pre-filled offer (a valid amount within the act's range)
 * and publish — then assert the confirmation state.
 *
 * The sheet is FOUR SCREENS since ADR 0040 — 1 the act · 2 the answers · 3 the
 * price · 4 the contact details — and only the current one is on screen: the
 * others keep their answers but are `display: none`, so nothing on them can be
 * typed into. This journey therefore walks the rail with « Continuer »
 * (`#book-next`), exactly as a client does. That walk is itself part of what is
 * under test: if « Continuer » stopped advancing, a client could no longer book,
 * and the spec has to fail for that.
 *
 * Every assertion here keys on STATE (a dialog open, a gate lifted, a hidden
 * card revealed, a 201 from POST /bids) or on ids and data attributes — never on
 * a frozen sentence. The copy in this journey is bilingual and is being rewritten
 * as the two-line quote lands (ADR 0031); a spec that pins the wording breaks on
 * an edit that changed nothing about whether a client can book.
 */
const { test, expect } = require('@playwright/test');
const D = require('@nota/domain');
const { gotoHome, parseMoney } = require('./helpers');

// The lowest fees a notary may be offered for a financement, read from the
// domain catalogue rather than restated here.
const FIN_FLOOR = D.serviceById('financement').prixDepart;

test('a client publishes a financing offer end to end', async ({ page }) => {
  // Deliberately DO NOT suppress onboarding — passing the gate is part of the journey.
  await gotoHome(page);

  // --- Onboarding gate: choose "I'm looking for a notary", then continue. -----
  const onb = page.locator('#onboarding-dialog');
  await expect(onb).toBeVisible();
  // The gate rendered its heading — whatever that heading currently says.
  await expect(page.locator('#onb-title')).not.toBeEmpty();

  await onb.locator('.onb-choice[data-role="client"]').click();
  const cta = page.locator('#onb-cta');
  await expect(cta).toBeVisible();
  // The client explicitly chooses a date after the guide.
  await cta.click();
  await page.locator('#cal-grid .client-walk-target').click();
  await page.locator('#client-walk-skip').click();

  // --- Booking sheet ----------------------------------------------------------
  const sheet = page.locator('#day-dialog');
  await expect(sheet).toBeVisible();

  // The form says which screen it is on; « Continuer » is what moves it.
  const form = sheet.locator('#offer-form');
  const next = sheet.locator('#book-next');
  // The publish button is the LAST screen's action, so it is off screen until
  // then (bookPaint hides it). `toBeDisabled` reads the gate itself, not the
  // layout, so it is still the right assertion while screens 1-3 are showing.
  const submit = sheet.locator('#offer-submit');

  // --- Screen 1 · the act -----------------------------------------------------
  await expect(form).toHaveAttribute('data-at', '1');
  await sheet.locator('#o-service-chips button[data-svc="financement"]').click();
  await expect(sheet.locator('#o-service-chips button[data-svc="financement"]')).toHaveAttribute('aria-pressed', 'true');
  await next.click();

  // --- Screen 2 · the notary's questions --------------------------------------
  // The REQUIRED questions for financement: loan amount, what the loan
  // finances, the bank-approval stage, the LENDER (the catalogue select) and
  // the TRAVEL band for the in-person signature (ADR 0017 — the second
  // catalogue select). Answering all five is what lifts the submit gate
  // (D.validateOffer → parametre_requis), and what lets « Continuer » through:
  // ADR 0040 §4 says the rail never skips over a question the notary asked.
  await expect(form).toHaveAttribute('data-at', '2');
  await sheet.locator('#crit-valeur_pret').fill('350000');
  await sheet.locator('#crit-contexte__propriete_detenue').click();
  await sheet.locator('#crit-approbation_bancaire__obtenue').click();
  await sheet.locator('#crit-preteur').selectOption('banque_nationale');
  await sheet.locator('#crit-deplacement').selectOption('client_50');
  await next.click();

  // --- Screen 3 · the price ---------------------------------------------------
  // The offer is pre-filled to a valid amount within the act's range, so this
  // screen asks nothing and « Continuer » always passes it.
  await expect(form).toHaveAttribute('data-at', '3');

  // Sanity-check the pre-filled amount really is a valid, above-floor offer.
  const amount = Number(await sheet.locator('#o-amount').inputValue());
  const amountMax = Number(await sheet.locator('#o-amount').getAttribute('max'));
  expect(amount, 'pre-filled offer must clear the financement floor').toBeGreaterThanOrEqual(FIN_FLOOR);
  expect(amount, 'pre-filled offer must sit within the slider ceiling').toBeLessThanOrEqual(amountMax);

  // --- The quote, before the client commits (ADR 0031) ------------------------
  // Two lines, never a split: the notary's fees — which reach them in full —
  // and Nota's own price, charged to the client beside them. Art. 68 of the
  // Code de déontologie forbids "incomplete" advertising, and a surcharge first
  // met on the payment page is the textbook case, so the total the card will
  // authorize has to be on screen here.
  //
  // Checked only while the block is on screen: the quote lives on screen 3
  // (ADR 0040 moved the market context and the delay line there beside it), but
  // this journey's subject is the booking, not the quote's placement. Read
  // positionally, in money the parser handles in either language.
  const devis = sheet.locator('#offer-devis');
  if (await devis.isVisible()) {
    const honoraires = parseMoney(await sheet.locator('#devis-hon').innerText());
    const prixNota = parseMoney(await sheet.locator('#devis-nota').innerText());
    const total = parseMoney(await sheet.locator('#devis-total').innerText());
    expect(honoraires, 'the quote states the offer the notary receives').toBe(amount);
    // Offline (fixtures), the server price is unknown and the row renders an
    // em dash rather than inventing one — then there is no total to check.
    if (!Number.isNaN(prixNota)) {
      expect(prixNota, "Nota's price is charged beside the fees, never taken from them").toBeGreaterThan(0);
      expect(total, 'the card is authorized for the sum of the two lines').toBe(honoraires + prixNota);
    }
  }

  await next.click();

  // --- Screen 4 · the contact details -----------------------------------------
  await expect(form).toHaveAttribute('data-at', '4');

  // The REQUIRED postal sector (domain: prefixe_requis).
  await expect(submit).toBeDisabled();
  await sheet.locator('#o-prefix').fill('G1R');

  // ADR 0033 — the mise en relation is complete: the retaining notary must be
  // able to name and write to the client, so the name and the courriel are
  // the last gate. Both stay private (never on the carnet).
  await expect(submit).toBeDisabled();
  await sheet.locator('#o-name').fill('Prénom Nom');
  await sheet.locator('#o-courriel').fill('client@exemple.ca');

  // Every required answer is in — across all four screens, since the guard
  // judges the WHOLE form and not the screen showing (ADR 0040 §2).
  await expect(submit).toBeEnabled();

  // --- Publish and confirm ----------------------------------------------------
  // The demand is created by POST /bids; catch the 200 so the assertion is on
  // the real server acknowledgement, not just optimistic UI.
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/bids') && r.request().method() === 'POST'),
    submit.click(),
  ]);
  // POST /bids answers 201 Created on success.
  expect(resp.ok(), `POST /bids should succeed, got ${resp.status()}: ${await resp.text()}`).toBeTruthy();

  // The success card unhides (it ships `hidden`, so being visible IS the
  // confirmation) and the toast reports the publication.
  await expect(sheet.locator('#offer-success')).toBeVisible();
  await expect(sheet.locator('#offer-success')).not.toBeEmpty();
  await expect(page.locator('#toast')).not.toBeEmpty();
});
