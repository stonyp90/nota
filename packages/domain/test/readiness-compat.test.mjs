import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// Backward compatibility of the readiness gate (review of f45a2e1, 2026-09-04):
// `succession` became REQUIRED on financement, and `deplacement` has always
// been required with a default. Offers already published without those
// answers must NOT flip to « dossier incomplet » on the notary's screen: when
// the caller passes the bid's OWN answers, a required criterion that carries a
// `defaut` reads as its default. A dossier still being filled (no `pricing`
// argument) keeps listing every unanswered question, and publishing stays
// strict — validateOffer never applies a default.

const FIN_OLD = { valeur_pret: 300000, contexte: 'achat', approbation_bancaire: 'obtenue', preteur: 'desjardins' };

test('leadReadiness: a financement published before `succession` existed is not missing it (bid answers passed)', () => {
  const r = D.leadReadiness('financement', { __consent: true }, FIN_OLD);
  assert.deepEqual(r.requis, [], 'defaults stand in for absent answers on the bid’s own answers');
  assert.equal(r.ready, true);
});

test('leadReadiness: an absent answer WITHOUT a default is still required, even on the bid’s own answers', () => {
  const r = D.leadReadiness('financement', { __consent: true }, { ...FIN_OLD, preteur: undefined });
  assert.ok(r.requis.length >= 1, r.requis);
});

test('leadReadiness: a dossier still being filled (no bid answers) keeps listing every unanswered question', () => {
  const r = D.leadReadiness('financement', { __consent: true, __pricing: FIN_OLD });
  assert.ok(r.requis.some((l) => /succession/i.test(l)), r.requis);
});

test('leadReadiness: when the bid’s answers are passed they feed BOTH gates — checklist and questions', () => {
  const pricing = { ...FIN_OLD, succession: 'oui' };
  // A stale dossier copy must not win over the bid's own answers.
  const r = D.leadReadiness('financement', { __consent: true, __pricing: { ...FIN_OLD, succession: 'non' } }, pricing);
  assert.deepEqual(r.requis, []);
  assert.ok(r.missing.some((n) => /testament/i.test(n)), 'succession=oui pulls the estate papers into the checklist');
});

test('validateOffer stays strict: a NEW financement offer must answer succession explicitly', () => {
  const v = D.validateOffer({ serviceId: 'financement', dateISO: '2026-09-20', todayISO: '2026-09-04', montant: 2500, prefixe: 'G1R', pricing: FIN_OLD });
  assert.ok(v.errors.some((e) => e.code === 'parametre_requis' && e.param === 'succession'), JSON.stringify(v.errors));
});
