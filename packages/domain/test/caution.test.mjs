import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// ADR 0035 — a card authorization lives ~7 days; the carnet's standard tier
// starts at 15 days out. The moment the caution can be placed and still be
// alive at the signing is therefore a PRODUCT number, not a literal buried in
// the billing layer.

test('the caution lead is a domain constant, and it fits inside a Stripe authorization', () => {
  assert.equal(typeof D.CAUTION_LEAD_DAYS, 'number');
  assert.ok(D.CAUTION_LEAD_DAYS >= 1, 'placing it the very morning of the signing leaves no room to react');
  // The whole point: the authorization must still be alive at the signing.
  assert.ok(D.CAUTION_LEAD_DAYS < 7, 'a Stripe authorization expires in ~7 days');
});

test('the standard tier is far beyond the authorization window — the defect this ADR fixes', () => {
  // The tier the carnet calls « standard » begins one day past `rapide`, i.e.
  // at 15 days: an authorization posted at publication is dead long before the
  // signing on every standard date, which is most of the carnet.
  const rapide = D.TIERS.find((t) => t.id === 'rapide');
  assert.ok(rapide, 'the rapide tier exists');
  assert.ok(rapide.maxJours + 1 > 7, 'standard starts past a Stripe authorization’s ~7-day life');
});

test('cautionDue opens exactly CAUTION_LEAD_DAYS before the signing', () => {
  const today = '2026-09-10';
  const at = (n) => D.addDays(today, n);
  assert.equal(D.cautionDue(at(D.CAUTION_LEAD_DAYS + 1), today), false, 'still too early — the hold would rot');
  assert.equal(D.cautionDue(at(D.CAUTION_LEAD_DAYS), today), true);
  assert.equal(D.cautionDue(at(1), today), true);
  assert.equal(D.cautionDue(today, today), true, 'a signing today still needs its caution');
});

test('cautionDue closes once the signing date is past — a stale offer is never retried forever', () => {
  const today = '2026-09-10';
  assert.equal(D.cautionDue('2026-09-09', today), false);
  assert.equal(D.cautionDue('2026-08-01', today), false);
});

test('cautionDue answers false on garbage rather than guessing', () => {
  assert.equal(D.cautionDue(null, '2026-09-10'), false);
  assert.equal(D.cautionDue('2026-09-10', 'demain'), false);
  assert.equal(D.cautionDue('pas-une-date', '2026-09-10'), false);
});

// --- La durée de vie d'une caution posée ------------------------------------
// L'autre moitié de la règle : poser la caution ne suffit pas, il faut savoir
// jusqu'à quand la chose posée est encore une garantie. Sans cela, une offre
// héritée du modèle d'avant — autorisée à la publication pour une date à J+30 —
// se lit « la somme est réservée » sur une autorisation morte depuis des
// semaines.

test('la vie d’une caution dépasse le délai de pose — sinon elle serait morte à la signature', () => {
  assert.equal(typeof D.CAUTION_VIE_JOURS, 'number');
  assert.ok(
    D.CAUTION_VIE_JOURS > D.CAUTION_LEAD_DAYS,
    'poser la caution à J-' + D.CAUTION_LEAD_DAYS + ' n’a de sens que si elle vit plus longtemps que cela'
  );
});

test('cautionVivante ferme la fenêtre au bout de CAUTION_VIE_JOURS', () => {
  const today = '2026-09-10';
  const at = (n) => D.addDays(today, n);
  assert.equal(D.cautionVivante(today, today), true, 'posée ce matin');
  assert.equal(D.cautionVivante(at(-D.CAUTION_VIE_JOURS), today), true, 'le dernier jour tient encore');
  assert.equal(D.cautionVivante(at(-D.CAUTION_VIE_JOURS - 1), today), false, 'un jour de trop, et ce n’est plus une garantie');
  assert.equal(D.cautionVivante(at(-35), today), false, 'l’offre héritée : autorisée il y a cinq semaines');
});

test('cautionVivante lit un horodatage complet comme une date', () => {
  assert.equal(D.cautionVivante('2026-09-10T14:00:00.000Z', '2026-09-11'), true);
  assert.equal(D.cautionVivante('2026-08-01T14:00:00.000Z', '2026-09-10'), false);
});

test('cautionVivante n’invente pas de mauvaise nouvelle quand la date de pose est inconnue', () => {
  assert.equal(D.cautionVivante(null, '2026-09-10'), true);
  assert.equal(D.cautionVivante('', '2026-09-10'), true);
  assert.equal(D.cautionVivante('pas-une-date', '2026-09-10'), true);
});
