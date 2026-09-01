import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// A retained offer carrying the realized premium — the only shape the tuner
// reads. Everything else on a bid is noise to it.
function settled(tier, premium, status) {
  return { tier, premium, status: status || D.STATUS.RETENUE };
}

test('tuning: with no history the tuned ladder IS the default ladder', () => {
  for (const empty of [undefined, null, [], {}]) {
    const tuned = D.tunedTierMultipliers(empty);
    for (const t of D.TIERS) {
      assert.equal(tuned[t.id], D.tierMultiplier(t.id), t.id + ' falls back to the static midpoint');
    }
  }
});

test('tuning: retained premiums pull a tier toward what the market actually paid', () => {
  // Six retained prioritaire deals all cleared at 3.25x — near the top of the
  // band, above the 3.0x midpoint. The tuned value must move up, but not all
  // the way (the prior still counts), and stay inside the advertised band.
  const bids = Array.from({ length: 6 }, () => settled('prioritaire', 3.25));
  const tuned = D.tunedTierMultipliers(bids);
  const prior = D.tierMultiplier('prioritaire');
  assert.ok(tuned.prioritaire > prior, 'moves above the prior');
  assert.ok(tuned.prioritaire < 3.25, 'shrinkage keeps it below the raw observation');
  const t = D.tierById('prioritaire');
  assert.ok(tuned.prioritaire >= t.apercuMin && tuned.prioritaire <= t.apercuMax, 'stays in band');
});

test('tuning: more data moves the estimate further (converges on the observed median)', () => {
  const few = D.tunedTierMultipliers(Array.from({ length: 3 }, () => settled('urgence', 3.65)));
  const many = D.tunedTierMultipliers(Array.from({ length: 60 }, () => settled('urgence', 3.65)));
  assert.ok(many.urgence > few.urgence, 'a bigger sample outweighs the prior');
  assert.ok(Math.abs(many.urgence - 3.65) < 0.1, 'a large sample lands near the observed premium');
});

test('tuning: only RETAINED offers teach — open asks are wishes, not prices', () => {
  const openOnly = Array.from({ length: 20 }, () => settled('rapide', 1.2, D.STATUS.OUVERTE));
  const tuned = D.tunedTierMultipliers(openOnly);
  assert.equal(tuned.rapide, D.tierMultiplier('rapide'), 'open offers are ignored');
});

test('tuning: outliers cannot drag a tier out of its band or past the cap', () => {
  // Median resists the outlier; band + cap clamp whatever survives. An outlier
  // at the hard cap (3x, above the extreme band) proves the band clamp bites.
  const bids = [
    settled('extreme', 3), settled('extreme', 3), settled('extreme', 3),
    settled('extreme', 3), settled('extreme', 3), settled('extreme', 3),
    settled('standard', 1.0), settled('standard', 1.0),
  ];
  const tuned = D.tunedTierMultipliers(bids);
  assert.ok(tuned.extreme <= D.PREMIUM_CAP, 'never above the hard cap');
  const ext = D.tierById('extreme');
  assert.ok(tuned.extreme <= ext.apercuMax, 'never above the tier band');
  const std = D.tierById('standard');
  assert.ok(tuned.standard >= std.apercuMin, 'never below the tier floor');
});

test('tuning: the tuned ladder stays strictly ascending whatever the data says', () => {
  // Adversarial history: cheap urgent deals, expensive calm ones — all within
  // the [1, cap] range so every row is a signal the tuner must reconcile.
  const bids = [
    ...Array.from({ length: 30 }, () => settled('standard', 2.5)),
    ...Array.from({ length: 30 }, () => settled('rapide', 2.5)),
    ...Array.from({ length: 30 }, () => settled('urgence', 1.5)),
    ...Array.from({ length: 30 }, () => settled('extreme', 1.6)),
  ];
  const tuned = D.tunedTierMultipliers(bids);
  const mults = D.TIERS.map((t) => tuned[t.id]);
  for (let i = 1; i < mults.length; i++) {
    assert.ok(mults[i] > mults[i - 1], D.TIERS[i].id + ' must stay above ' + D.TIERS[i - 1].id);
  }
});

test('tuning: garbage rows are skipped, never crash', () => {
  const bids = [
    null, {}, { tier: 'nope', premium: 3 },
    settled('prioritaire', NaN), settled('prioritaire', -2),
    settled('prioritaire', 999), // impossible premium (over cap) — not a signal
    settled('prioritaire', 3.8),
  ];
  const tuned = D.tunedTierMultipliers(bids);
  assert.ok(Number.isFinite(tuned.prioritaire));
  for (const t of D.TIERS) assert.ok(Number.isFinite(tuned[t.id]), t.id + ' always numeric');
});

test('tuning: tierMultiplier(id, bids) is the tuned value — one definition for the UI', () => {
  const bids = Array.from({ length: 10 }, () => settled('prioritaire', 1.44));
  assert.equal(D.tierMultiplier('prioritaire', bids), D.tunedTierMultipliers(bids).prioritaire);
  assert.equal(D.tierMultiplier('nope', bids), null);
});

test('tuning: recommendedAmount follows the tuned multiplier when history is supplied', () => {
  const TODAY = '2026-08-12';
  const bids = Array.from({ length: 40 }, () => settled('prioritaire', 3.25));
  const plain = D.recommendedAmount('refinancement', '2026-08-14', TODAY);   // 2 days = prioritaire
  const tunedRec = D.recommendedAmount('refinancement', '2026-08-14', TODAY, null, bids);
  assert.ok(tunedRec > plain, 'a hotter observed market recommends a higher offer');
  const svc = D.serviceById('refinancement');
  assert.ok(tunedRec <= svc.prixDepart * D.PREMIUM_CAP, 'still capped at 5x');
});
