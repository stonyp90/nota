import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../index.js');
const { computeBasePrice, validateOffer, complexity, missingRequired } = domain;

const TODAY = '2026-08-14';
// Fully-answered mandatory params, per service, that keep each at its BASE price.
const BASE_ANSWERS = {
  testament: { who_for: 'solo', fiducie_needed: 'non' },
  procuration: { scope: 'specifique', realEstate: 'non' },
  refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' },
};

test('with NO answers a service returns its flat base (== prixDepart)', () => {
  for (const svc of domain.SERVICES) {
    assert.equal(computeBasePrice(svc.id, {}), svc.prixDepart, svc.id);
    assert.equal(svc.pricing.base, svc.prixDepart, svc.id + ' base mirrors prixDepart');
  }
});

test('testament: who_for scales, fiducie_needed is the complexity jump', () => {
  assert.equal(computeBasePrice('testament', { who_for: 'couple' }), 650 + 450);
  assert.equal(computeBasePrice('testament', { fiducie_needed: 'oui' }), 650 + 600);
  assert.equal(computeBasePrice('testament', { who_for: 'couple', fiducie_needed: 'oui' }), 650 + 450 + 600);
  assert.equal(computeBasePrice('testament', { business_assets: true }), 650 + 300);
  assert.equal(computeBasePrice('testament', { include_mandate: 'non' }), 650 - 150); // will only
});

test('procuration: scope scales, realEstate is the complexity jump', () => {
  assert.equal(computeBasePrice('procuration', { scope: 'generale' }), 295 + 100);
  assert.equal(computeBasePrice('procuration', { realEstate: 'oui' }), 295 + 200);
  assert.equal(computeBasePrice('procuration', { usage: 'etranger' }), 295 + 150);
});

test('refinancement: loan-value brackets + succession + bank approval + optionals', () => {
  assert.equal(computeBasePrice('refinancement', { valeur_pret: 250000 }), 2000);
  assert.equal(computeBasePrice('refinancement', { valeur_pret: 450000 }), 2000 + 150);
  assert.equal(computeBasePrice('refinancement', { valeur_pret: 800000 }), 2000 + 350);
  assert.equal(computeBasePrice('refinancement', { valeur_pret: 1500000 }), 2000 + 600);
  assert.equal(computeBasePrice('refinancement', { succession: 'oui' }), 2000 + 400);
  assert.equal(computeBasePrice('refinancement', { approbation_bancaire: 'non' }), 2000 + 200);
  assert.equal(computeBasePrice('refinancement', { coemprunteur: true }), 2000 + 150);
});

// --- Mandatory parameters ----------------------------------------------------

test('missingRequired lists the unanswered mandatory params per service', () => {
  assert.deepEqual(missingRequired('refinancement', {}).map((m) => m.id), ['valeur_pret', 'succession', 'approbation_bancaire']);
  assert.deepEqual(missingRequired('testament', {}).map((m) => m.id), ['who_for', 'fiducie_needed']);
  assert.deepEqual(missingRequired('procuration', {}).map((m) => m.id), ['scope', 'realEstate']);
  // Fully answered -> nothing missing.
  for (const svc of domain.SERVICES) assert.deepEqual(missingRequired(svc.id, BASE_ANSWERS[svc.id]), []);
});

test('validateOffer BLOCKS a bid until the mandatory params are answered', () => {
  const noParams = validateOffer({ serviceId: 'refinancement', dateISO: '2026-09-20', montant: 2500, todayISO: TODAY });
  assert.equal(noParams.ok, false);
  assert.ok(noParams.errors.some((e) => e.code === 'parametre_requis' && e.param === 'succession'));

  const ok = validateOffer({ serviceId: 'refinancement', dateISO: '2026-09-20', montant: 2500, todayISO: TODAY, pricing: BASE_ANSWERS.refinancement });
  assert.equal(ok.ok, true);
  assert.equal(ok.basePrice, 2000);
});

// --- Case complexity (the notary's easy/hard signal) -------------------------

test('complexity: succession + no bank approval flag a refinancement as complexe', () => {
  const c = complexity('refinancement', { valeur_pret: 250000, succession: 'oui', approbation_bancaire: 'non' });
  assert.equal(c.level, 'complexe'); // 2 (succession) + 2 (pas encore) = 4
  assert.ok(c.factors.some((f) => /succession/i.test(f)));
  assert.ok(c.factors.some((f) => /Approbation/i.test(f)));
});

test('complexity: a clean file is simple; a single hardener is standard', () => {
  assert.equal(complexity('refinancement', BASE_ANSWERS.refinancement).level, 'simple');
  assert.equal(complexity('testament', { who_for: 'couple', fiducie_needed: 'non' }).level, 'simple'); // score 1
  assert.equal(complexity('testament', { fiducie_needed: 'oui' }).level, 'standard'); // score 2
  assert.equal(complexity('procuration', { scope: 'generale', realEstate: 'oui' }).level, 'standard'); // scope=scale(0) + realEstate(2) = 2
});

test('recommendedAmount anchors on the dynamic base', () => {
  const plain = domain.recommendedAmount('testament', '2026-09-20', TODAY, BASE_ANSWERS.testament);
  const couple = domain.recommendedAmount('testament', '2026-09-20', TODAY, { who_for: 'couple', fiducie_needed: 'non' });
  assert.ok(couple > plain);
});
