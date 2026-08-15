import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../index.js');
const { computeBasePrice, validateOffer, serviceById, recommendedAmount } = domain;

test('with NO answers a service returns its flat base (== prixDepart) — full back-compat', () => {
  for (const svc of domain.SERVICES) {
    assert.equal(computeBasePrice(svc.id, {}), svc.prixDepart, svc.id);
    assert.equal(computeBasePrice(svc.id, undefined), svc.prixDepart, svc.id);
    assert.equal(svc.pricing.base, svc.prixDepart, svc.id + ' base mirrors prixDepart');
  }
});

test('flag criteria add their flat amount when truthy (testament)', () => {
  assert.equal(computeBasePrice('testament', { couple: true }), 650 + 350);
  assert.equal(computeBasePrice('testament', { enfants_mineurs: true }), 650 + 75);
  assert.equal(computeBasePrice('testament', { couple: true, enfants_mineurs: true, entreprise_fiducie: true }), 650 + 350 + 75 + 250);
  assert.equal(computeBasePrice('testament', { couple: false }), 650); // falsy = no add
});

test('choice criteria add the chosen option (procuration portée)', () => {
  assert.equal(computeBasePrice('procuration', { portee: 'speciale' }), 295);
  assert.equal(computeBasePrice('procuration', { portee: 'generale' }), 295 + 40);
  assert.equal(computeBasePrice('procuration', { portee: 'generale', protection: true }), 295 + 40 + 150);
  assert.equal(computeBasePrice('procuration', { portee: 'inconnu' }), 295); // unknown option = no add
});

test('bracket criteria add the first bracket the value falls in (refinancement loan value)', () => {
  assert.equal(computeBasePrice('refinancement', { valeur_pret: 250000 }), 950);          // <=300k -> +0
  assert.equal(computeBasePrice('refinancement', { valeur_pret: 300000 }), 950);          // boundary inclusive
  assert.equal(computeBasePrice('refinancement', { valeur_pret: 450000 }), 950 + 150);    // <=600k
  assert.equal(computeBasePrice('refinancement', { valeur_pret: 900000 }), 950 + 350);    // open top bracket
  assert.equal(computeBasePrice('refinancement', { valeur_pret: 900000, coemprunteur: true }), 950 + 350 + 75);
  assert.equal(computeBasePrice('refinancement', {}), 950);                                // unanswered -> base bracket
});

test('unknown service returns null; a bad bracket value is ignored, not NaN', () => {
  assert.equal(computeBasePrice('inconnu', {}), null);
  assert.equal(computeBasePrice('refinancement', { valeur_pret: 'oops' }), 950);
});

test('validateOffer enforces the DYNAMIC floor (a complex act raises the minimum)', () => {
  const today = '2026-08-14';
  // A couple testament floor is 1000; an offer of 900 is now below the floor.
  const low = validateOffer({ serviceId: 'testament', dateISO: '2026-09-20', montant: 900, todayISO: today, pricing: { couple: true } });
  assert.equal(low.ok, false);
  assert.ok(low.errors.some((e) => e.code === 'sous_prix_depart'));
  assert.equal(low.basePrice, 1000);

  // The same 900 is fine with no criteria (floor stays 650).
  const ok = validateOffer({ serviceId: 'testament', dateISO: '2026-09-20', montant: 900, todayISO: today });
  assert.equal(ok.ok, true);
  assert.equal(ok.basePrice, 650);
});

test('validateOffer premium cap scales with the dynamic base', () => {
  const today = '2026-08-14';
  // refinancement with a big loan: base 1300; cap = 13000; 13001 must fail.
  const over = validateOffer({ serviceId: 'refinancement', dateISO: '2026-09-20', montant: 13001, todayISO: today, pricing: { valeur_pret: 900000 } });
  assert.ok(over.errors.some((e) => e.code === 'plafond_depasse'));
  const under = validateOffer({ serviceId: 'refinancement', dateISO: '2026-09-20', montant: 13000, todayISO: today, pricing: { valeur_pret: 900000 } });
  assert.equal(under.ok, true);
});

test('recommendedAmount anchors on the dynamic base (higher base -> higher suggestion)', () => {
  const plain = recommendedAmount('testament', '2026-09-20', '2026-08-14');
  const couple = recommendedAmount('testament', '2026-09-20', '2026-08-14', { couple: true });
  assert.ok(couple > plain, 'a couple testament recommends a higher offer');
  assert.ok(couple >= 1000); // at least the couple floor
});
