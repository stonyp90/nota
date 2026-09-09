import test from 'node:test';
import assert from 'node:assert/strict';
import D from '../index.js';

const pricing = { valeur_pret: 250000, preteur: 'rbc', succession: 'non', approbation_bancaire: 'obtenue', deplacement: 'client_50' };
function bid(extra = {}) {
  return { serviceId: 'refinancement', notaryId: 'owner', dateISO: '2026-09-18', pricing,
    dossier: { adresse: '12 rue Exemple', parties_signature: 'Propriétaire et personne absente', date_echeance_taux: '2026-09-17', offre_preteur: 'offre.pdf' }, ...extra };
}
const field = (fieldId, value) => ({ fieldId, value, evidence: [{ documentId: 'offer', page: 1, quote: value }] });
test('customer context is reused and supplied items are omitted from follow-up drafts', () => {
  const packet = D.financingWorkPacket(bid(), { todayISO: '2026-09-09' });
  assert.equal(packet.customerContext.find(c => c.id === 'valeur_pret').value, D.money(250000));
  assert.equal(packet.customerContext.find(c => c.id === 'valeur_pret').valueEn, D.moneyEn(250000));
  assert.equal(packet.draftFields.find(f => f.fieldId === 'property_address').value, '12 rue Exemple');
  assert.ok(!packet.clientRequestDraft.items.some(i => ['adresse', 'parties_signature', 'offre_preteur'].includes(i.id)));
  assert.ok(packet.clientRequestDraft.items.some(i => i.id === 'contact_preteur'));
  assert.ok(!packet.draftFields.some(f => f.fieldId === 'borrower_names'), 'signing parties are not automatically borrowers');
  assert.equal(packet.documentInventory.find(d => d.id === 'offre_preteur').status, 'listed');
  assert.equal(packet.measurement.measuredReduction, null);
  assert.equal(packet.measurement.target, D.FINANCING_AUTOMATION_TARGET);
  assert.equal(packet.measurement.target, 0.9);
});
test('conditional documents and completed declarations do not generate repeated requests', () => {
  const dossier = Object.fromEntries(D.dossierItems('refinancement', pricing).filter(i => i.kind !== 'note').map(i => [i.id, i.kind === 'doc' ? D.DOSSIER_TRANSMIS : 'Déclaré']));
  const packet = D.financingWorkPacket(bid({ dossier }));
  assert.equal(packet.clientRequestDraft, null);
  assert.ok(!packet.documentInventory.some(i => i.id === 'testament_transmission'));
  assert.ok(packet.checks.every(c => c.status === 'pending'));
  assert.equal(packet.measurement.measuredReduction, null);
});
test('confirmed corrections, unreviewed proposals and rejected fields remain distinct', () => {
  const analysis = { id: 'a1', preparation: { fields: [field('property_address', '14 rue Exemple'), field('lender_name', 'Banque secondaire'), field('loan_amount', '300 000 $')] },
    review: { reviewerId: 'owner', decisions: [
      { index: 0, decision: 'corrected', value: '16 rue Exemple', reason: 'Vérifié dans le mandat' },
      { index: 1, decision: 'rejected', reason: 'Ancien prêteur' },
      { index: 2, decision: 'accepted' },
    ], activeReviewSeconds: 90 } };
  const packet = D.financingWorkPacket(bid({ financingAnalysis: analysis }));
  const corrected = packet.draftFields.find(f => f.source === 'notary_corrected');
  assert.equal(corrected.value, '16 rue Exemple');
  assert.equal(corrected.originalValue, '14 rue Exemple');
  assert.equal(corrected.evidence[0].quote, '14 rue Exemple');
  assert.ok(!packet.draftFields.some(f => f.value === 'Banque secondaire'));
  assert.equal(packet.comparisons.find(c => c.fieldId === 'property_address').customerValue, '12 rue Exemple');
  assert.equal(packet.measurement.reviewSeconds, 90);
  assert.equal(packet.measurement.measuredReduction, null);
  const transferred = D.financingWorkPacket(bid({ financingAnalysis: analysis, notaryId: 'new-owner' }));
  assert.ok(transferred.draftFields.filter(f => f.source !== 'customer').every(f => f.source === 'ai_proposal'));
  assert.equal(transferred.measurement.reviewSeconds, null);
});
test('customer edits refresh packet and comparisons without copying rejected evidence into customer fields', () => {
  const analysis = { id: 'a1', preparation: { fields: [field('property_address', '14 rue Exemple')] } };
  const before = D.financingWorkPacket(bid({ financingAnalysis: analysis }));
  assert.equal(before.comparisons.length, 1);
  const after = D.financingWorkPacket(bid({ financingAnalysis: analysis, dossier: { adresse: '14 rue Exemple' } }));
  assert.equal(after.comparisons.length, 0);
  assert.ok(after.draftFields.some(f => f.source === 'ai_proposal'));
});
test('date risks use strict ISO dates and never constitute a signing decision', () => {
  const past = D.financingWorkPacket(bid(), { todayISO: '2026-09-19' });
  assert.deepEqual(past.dateFlags.map(f => f.id), ['expiry_past', 'signing_after_expiry']);
  const unclear = D.financingWorkPacket(bid({ dossier: { date_echeance_taux: 'Je ne sais pas' } }));
  assert.equal(unclear.dateFlags[0].id, 'expiry_unclear');
  assert.ok(past.checks.every(c => c.status === 'pending'));
});
test('private context is bounded, unknown fields are ignored and erased files have no packet', () => {
  const packet = D.financingWorkPacket(bid({ dossier: { adresse: 'a'.repeat(9000), secret: 'never-include-me' } }));
  assert.equal(packet.customerContext.find(c => c.id === 'adresse').value.length, D.DOSSIER_VALUE_MAX);
  assert.ok(!JSON.stringify(packet).includes('never-include-me'));
  assert.equal(D.financingWorkPacket(bid({ efface: true })), null);
  assert.equal(D.financingWorkPacket(null), null);
});
