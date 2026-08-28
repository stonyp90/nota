import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../index.js');
const { computeBasePrice, validateOffer, complexity, missingRequired } = domain;

const TODAY = '2026-08-14';
// Fully-answered mandatory params that keep each act at its BASE price.
// (The catalogue is the financing family only — ADR 0010.)
const BASE_ANSWERS = {
  refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
  financement: { valeur_pret: 250000, contexte: 'propriete_detenue', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
};

test('with NO answers a service returns its flat base (== prixDepart)', () => {
  for (const svc of domain.SERVICES) {
    assert.equal(computeBasePrice(svc.id, {}), svc.prixDepart, svc.id);
    assert.equal(svc.pricing.base, svc.prixDepart, svc.id + ' base mirrors prixDepart');
  }
});

test('the floors are the financing family’s — 2 000 $ refi, 1 800 $ financement; retired acts do not price', () => {
  // testament (1 250 $) and procuration (750 $) left with their acts; a bid on
  // a retired act must not price — it must fail as an unknown service.
  assert.equal(computeBasePrice('refinancement', {}), 2000);
  assert.equal(computeBasePrice('financement', {}), 1800);
  assert.equal(computeBasePrice('testament', {}), null);
  assert.equal(computeBasePrice('procuration', {}), null);
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

test('refinancement: the add-ons stack — a hard file prices every factor at once', () => {
  const answers = { valeur_pret: 800000, succession: 'oui', approbation_bancaire: 'en_cours', certificat_localisation: 'perime' };
  assert.equal(computeBasePrice('refinancement', answers), 2000 + 350 + 400 + 100 + 100);
  // Insurance status informs complexity, never the price — the lender's
  // requirement is the client's cost, not the notary's work.
  assert.equal(computeBasePrice('refinancement', { ...BASE_ANSWERS.refinancement, assurance_habitation: 'non' }), 2000);
});

test('financement: the loan act for a NEW hypothec — same bracket ladder, achat coordinates a purchase', () => {
  assert.equal(computeBasePrice('financement', {}), 1800);
  assert.equal(computeBasePrice('financement', { valeur_pret: 250000 }), 1800);
  assert.equal(computeBasePrice('financement', { valeur_pret: 500000 }), 1800 + 150);
  assert.equal(computeBasePrice('financement', { valeur_pret: 800000 }), 1800 + 350);
  assert.equal(computeBasePrice('financement', { valeur_pret: 1500000 }), 1800 + 600);
  // A purchase must be coordinated with the sale at the instrumenting notary.
  assert.equal(computeBasePrice('financement', { contexte: 'achat' }), 1800 + 200);
  assert.equal(computeBasePrice('financement', { contexte: 'propriete_detenue' }), 1800);
  assert.equal(
    computeBasePrice('financement', { valeur_pret: 500000, contexte: 'achat', approbation_bancaire: 'obtenue' }),
    2150,
    'achat + 500 k + approval obtained = 1800 + 200 + 150',
  );
  // The optional criteria are the same knobs as refinancement's.
  assert.equal(computeBasePrice('financement', { ...BASE_ANSWERS.financement, coemprunteur: true }), 1800 + 150);
});

// --- Mandatory parameters ----------------------------------------------------

test('missingRequired lists the unanswered mandatory params', () => {
  // Layout order: the questions that genuinely vary first, the zero-cost
  // defaults (succession, déplacement) close the block.
  assert.deepEqual(missingRequired('refinancement', {}).map((m) => m.id), ['valeur_pret', 'approbation_bancaire', 'preteur', 'succession', 'deplacement']);
  assert.deepEqual(missingRequired('financement', {}).map((m) => m.id), ['valeur_pret', 'contexte', 'approbation_bancaire', 'preteur', 'deplacement']);
  // A loan value must be a real positive number — a crafted blank cannot skip it.
  assert.deepEqual(missingRequired('refinancement', { ...BASE_ANSWERS.refinancement, valeur_pret: '' }).map((m) => m.id), ['valeur_pret']);
  // Fully answered -> nothing missing.
  for (const svc of domain.SERVICES) assert.deepEqual(missingRequired(svc.id, BASE_ANSWERS[svc.id]), []);
});

test('validateOffer BLOCKS a bid until the mandatory params are answered', () => {
  const noParams = validateOffer({ serviceId: 'refinancement', dateISO: '2026-09-20', montant: 2500, todayISO: TODAY });
  assert.equal(noParams.ok, false);
  assert.ok(noParams.errors.some((e) => e.code === 'parametre_requis' && e.param === 'succession'));

  const ok = validateOffer({ serviceId: 'refinancement', dateISO: '2026-09-20', montant: 2500, todayISO: TODAY, pricing: BASE_ANSWERS.refinancement, prefixe: 'G1R' });
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
  const big = complexity('refinancement', { valeur_pret: 800000, succession: 'non', approbation_bancaire: 'obtenue' });
  assert.equal(big.level, 'standard'); // large loan alone = score 1
  const pending = complexity('refinancement', { ...BASE_ANSWERS.refinancement, approbation_bancaire: 'en_cours' });
  assert.equal(pending.level, 'standard'); // approval in progress = score 1
});

test('recommendedAmount anchors on the dynamic base', () => {
  const plain = domain.recommendedAmount('refinancement', '2026-09-20', TODAY, BASE_ANSWERS.refinancement);
  const heavy = domain.recommendedAmount('refinancement', '2026-09-20', TODAY, { valeur_pret: 1500000, succession: 'oui', approbation_bancaire: 'obtenue' });
  assert.ok(heavy > plain);
});
