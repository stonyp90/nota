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
