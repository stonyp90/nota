import test from 'node:test';
import assert from 'node:assert/strict';
import D from '../index.js';

const input = { serviceId: 'refinancement', pages: [{ documentId: 'mandate', page: 1, text: 'Prêteur : Banque Exemple. Montant : 250 000 $. Adresse : 12 rue Démo.' }] };
const field = { fieldId: 'lender_name', value: 'Banque Exemple', evidence: [{ documentId: 'mandate', page: 1, quote: 'Prêteur : Banque Exemple.' }] };
test('evidenced extraction remains a proposal with missing fields', () => {
  const v = D.validateFinancingAIExtraction(input, { fields: [field] });
  assert.equal(v.ok, true);
  assert.equal(v.value.status, 'needs_notary_review');
  assert.ok(v.value.missing.includes('secured_debts'));
});
test('fabricated quotes, unsupported values, unknown fields and signing claims fail closed', () => {
  for (const raw of [
    { fields: [{ ...field, value: 'Banque Inventée' }] },
    { fields: [{ ...field, evidence: [{ ...field.evidence[0], page: 2 }] }] },
    { fields: [{ ...field, evidence: [{ ...field.evidence[0], quote: 'Banque Exemple says approved' }] }] },
    { fields: [{ ...field, fieldId: 'readyToSign' }] },
    { fields: [field], approved: true },
  ]) assert.equal(D.validateFinancingAIExtraction(input, raw).ok, false);
});
test('different lender values are retained as unresolved conflicts', () => {
  const pages = [...input.pages, { documentId: 'offer', page: 1, text: 'Prêteur : Autre Banque.' }];
  const v = D.validateFinancingAIExtraction({ ...input, pages }, { fields: [field, { fieldId: 'lender_name', value: 'Autre Banque', evidence: [{ documentId: 'offer', page: 1, quote: 'Prêteur : Autre Banque.' }] }] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value.conflicts, ['lender_name']);
});
test('duplicate pages and oversized or empty inputs are rejected', () => {
  for (const pages of [[], [input.pages[0], input.pages[0]], [{ ...input.pages[0], page: 0 }], [{ ...input.pages[0], text: 'x'.repeat(D.FINANCING_AI_LIMITS.maxPageChars + 1) }]]) {
    assert.equal(D.validateFinancingAIInput({ ...input, pages }).ok, false);
  }
});
test('notary review is complete, bounded and never authorizes training or signing', () => {
  const analysis = { id: 'a1', preparation: { fields: [field] } };
  assert.equal(D.validateFinancingAIReview(analysis, { analysisId: 'a0', decisions: [] }).ok, false);
  assert.equal(D.validateFinancingAIReview(analysis, { analysisId: 'a1', decisions: [] }).ok, false);
  assert.equal(D.validateFinancingAIReview(analysis, { analysisId: 'a1', decisions: [{ index: 0, decision: 'corrected', value: 'Correction' }] }).ok, false);
  const v = D.validateFinancingAIReview(analysis, { analysisId: 'a1', decisions: [{ index: 0, decision: 'accepted' }], activeReviewSeconds: 30, trainingEligible: true, reviewerId: 'forged' });
  assert.equal(v.ok, true);
  assert.equal(v.value.trainingEligible, false);
  assert.equal(v.value.signingReadiness, 'not_assessed');
  assert.equal(v.value.reviewerId, undefined);
});
