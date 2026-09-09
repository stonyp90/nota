import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('@nota/domain');
const { buildNotaryPreferenceDataset, createNotaryLearning } = require('../src/notary-learning');

const NOW = Date.parse('2026-09-09T14:00:00.000Z');
const bid = { id: 'learning-bid', dateISO: '2026-09-18', serviceId: 'refinancement', notaryId: 'notary-1' };
const input = {
  serviceId: 'refinancement',
  pages: [{ documentId: 'payout-01', page: 1, text: 'Prêteur : Banque A. Correction vérifiée : Prêteur : Banque B.' }],
};
const candidate = {
  fields: [{ fieldId: 'lender_name', value: 'Banque A', evidence: [{ documentId: 'payout-01', page: 1, quote: 'Prêteur : Banque A' }] }],
};
const verified = {
  fields: [{ fieldId: 'lender_name', value: 'Banque B', evidence: [{ documentId: 'payout-01', page: 1, quote: 'Prêteur : Banque B' }] }],
};

test('learning events keep lifecycle signals metadata-only and separate weak from strong labels', async () => {
  const events = [];
  const learning = createNotaryLearning({
    nowMs: () => NOW,
    newId: (() => { let n = 0; return () => 'learning-event-' + (++n); })(),
    append: async (event, actor) => events.push({ event, actor }),
  });
  const analysis = {
    id: 'analysis-1',
    preparation: {
      fields: candidate.fields,
      missing: ['borrower_names'], conflicts: [], status: 'needs_notary_review',
    },
    provenance: { model: 'fixture', promptSha256: 'sha256:prompt', inputSha256: 'sha256:input', knowledgeVersion: D.FINANCING_KNOWLEDGE.version },
    performance: { provider: 'injected', region: '', latencyMs: 24, usage: { in: 10, out: 8, reported: true } },
  };
  await learning.aiOutput({ bid, analysis, input, owner: bid.notaryId });
  await learning.notaryReview({ bid, analysis, review: {
    decisions: [{ index: 0, decision: 'corrected', value: 'Banque secrète', reason: 'Correction confidentielle' }],
    activeReviewSeconds: 12,
  }, owner: bid.notaryId });
  await learning.customerInput({ bid, before: { adresse: 'Adresse secrète' }, after: { adresse: 'Adresse nouvelle', offre_preteur: 'fichier.pdf' },
    beforeReadiness: { total: 3, done: 1, missing: ['offre_preteur'], requis: ['offre_preteur'], consent: false, ready: false },
    readiness: { total: 3, done: 2, missing: [], requis: [], consent: true, ready: true },
  });
  await learning.customerBehavior({ bid, behavior: 'document_upload', metadata: { documentCount: 2 } });
  await learning.communication({ bid, direction: 'client_to_notary', message: 'Message confidentiel du client',
    createdAt: new Date(NOW).toISOString(), priorMessages: [{ de: D.CHAT_FROM.NOTAIRE, createdAt: new Date(NOW - 60000).toISOString() }], locale: 'fr-CA' });
  await learning.officialOutcome({ bid, owner: bid.notaryId, outcome: { status: 'completed', completed: true, paid: true, reconciled: true } });
  await learning.clientFeedback({ bid, evaluation: { note: 5, commentaire: 'Commentaire privé' } });

  assert.deepEqual(events.map(item => item.event.kind), [
    'ai_output', 'notary_review', 'customer_input', 'customer_behavior',
    'communication', 'official_outcome', 'client_feedback',
  ]);
  const serialized = JSON.stringify(events);
  for (const raw of ['Banque secrète', 'Correction confidentielle', 'Adresse secrète', 'Message confidentiel', 'Commentaire privé']) {
    assert.equal(serialized.includes(raw), false, raw);
  }
  const weak = events.find(item => item.event.kind === 'customer_input').event;
  assert.equal(weak.signalPolicy.strength, 'weak');
  assert.equal(weak.signalPolicy.labelFields, false);
  assert.equal(weak.training.eligible, false);
  assert.equal(weak.training.reason, 'requires_authorized_deidentified_notary_label');
  assert.deepEqual(weak.data.changedFieldIds, ['adresse', 'offre_preteur']);
  const strong = events.find(item => item.event.kind === 'notary_review').event;
  assert.equal(strong.signalPolicy.strength, 'strong');
  assert.equal(strong.data.preference.labelScope, 'extraction_preference_only');
  assert.equal(strong.data.decisions[0].fieldId, 'lender_name');
  assert.equal(events.find(item => item.event.kind === 'communication').event.data.responseLatencySeconds, 60);
  assert.ok(events.every(item => item.actor && item.actor.type));
});

test('preference dataset remains blocked until authorization, deidentification and qualification gates pass', () => {
  const record = {
    serviceId: 'refinancement', input,
    candidateExtraction: candidate, verifiedExtraction: verified,
    review: {
      notaryVerified: true, verifiedBy: 'notary-1',
      decisions: [{ index: 0, decision: 'corrected', value: 'Banque B', reason: 'Vérifié sur la pièce source.' }],
    },
    provenance: { model: 'fixture', knowledgeVersion: D.FINANCING_KNOWLEDGE.version },
  };
  const blocked = buildNotaryPreferenceDataset([record]);
  assert.equal(blocked.trainingEligible, false);
  assert.equal(blocked.weightUpdate, 'not_started');
  assert.ok(blocked.gateFailures.includes('authorizedDataUse'));
  assert.equal(blocked.examples.length, 0);

  const eligible = buildNotaryPreferenceDataset([record], {
    authorizedDataUse: true, deidentified: true, approvedBy: 'review-board-1',
    frozenQualificationSet: true, qualificationPassed: true, rollbackPlan: true,
  });
  assert.equal(eligible.trainingEligible, true);
  assert.equal(eligible.learningMethod, 'offline_preference_optimization');
  assert.equal(eligible.reinforcementSignals, 'collected');
  assert.equal(eligible.weightUpdate, 'not_started');
  assert.equal(eligible.examples.length, 1);
  assert.equal(eligible.examples[0].chosen.fields[0].value, 'Banque B');
  assert.equal(eligible.examples[0].rejected.fields[0].value, 'Banque A');
  assert.equal(eligible.examples[0].labels[0].decision, 'corrected');
  assert.equal(eligible.authorization.approvedByPresent, true);
  assert.ok(eligible.authorization.approvedBySha256.startsWith('sha256:'));
});

test('preference dataset rejects a record without a separate notary-verified extraction', () => {
  const result = buildNotaryPreferenceDataset([{
    serviceId: 'testament',
    input: { serviceId: 'testament', pages: [{ documentId: 'will', page: 1, text: 'Testateur : Alex Exemple.' }] },
    candidateExtraction: { fields: [{ fieldId: 'testator_names', value: 'Alex Exemple', evidence: [{ documentId: 'will', page: 1, quote: 'Testateur : Alex Exemple' }] }] },
    verifiedExtraction: { fields: [{ fieldId: 'testator_names', value: 'Alex Exemple', evidence: [{ documentId: 'will', page: 1, quote: 'Testateur : Alex Exemple' }] }] },
    review: { decisions: [{ index: 0, decision: 'accepted' }] },
  }], {
    authorizedDataUse: true, deidentified: true, approvedBy: 'board',
    frozenQualificationSet: true, qualificationPassed: true, rollbackPlan: true,
  });
  assert.equal(result.trainingEligible, false);
  assert.equal(result.rejectedRecords[0].reasons.includes('notary_verification_required'), true);
});

test('learning write failures are swallowed so the product path remains available', async () => {
  const learning = createNotaryLearning({ append: async () => { throw new Error('audit unavailable'); } });
  const result = await learning.customerBehavior({ bid, behavior: 'read_receipt' });
  assert.equal(result, null);
});
