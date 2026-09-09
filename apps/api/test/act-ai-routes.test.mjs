import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('@nota/domain');
const { createApp } = require('../src/handler');
const { createMemoryRepo } = require('../src/repo-memory');
const { signToken, SCOPES } = require('../src/notary-auth');
const { actRequestIdentity } = require('../src/financing-ai');
const { loadContract, specPath } = require('./contract/openapi-contract');
const contract = loadContract(specPath('openapi.yaml'));

const now = Date.parse('2026-09-09T14:00:00Z');
const bid = {
  id: 'act-1', dateISO: '2026-09-18', serviceId: 'testament',
  status: D.STATUS.RETENUE, notaryId: 'owner', montant: 2500,
  pricing: { nombre_testateurs: 1, situation_familiale: 'celibataire', enfants: 'aucun', testament_existant: 'non' },
};
const page = { documentId: 'will', page: 1, text: 'Testatrice : Marie Roy. Bénéficiaires : Alice Roy.' };
const extraction = { fields: [
  { fieldId: 'testator_names', value: 'Marie Roy', evidence: [{ documentId: 'will', page: 1, quote: 'Testatrice : Marie Roy' }] },
  { fieldId: 'beneficiaries', value: 'Alice Roy', evidence: [{ documentId: 'will', page: 1, quote: 'Bénéficiaires : Alice Roy' }] },
] };

function setup() {
  const repo = createMemoryRepo([{ ...bid }]);
  repo.markActCompleted(bid.id, { bidId: bid.id, notaryId: 'owner', paye: true, netCents: 1,
    transferId: 'test-paid', completedAt: '2026-09-09T14:00:00.000Z' });
  const calls = [];
  const app = createApp(repo, {
    now: () => '2026-09-09',
    nowMs: () => now,
    env: { NOTA_ACT_AI_ENABLED: 'true' },
    actAIPort: { model: 'test-act-model', async extract(input) { calls.push(input); return { extraction }; } },
  });
  const request = async (path, body = {}, owner = 'owner', method = 'POST', scope = SCOPES.SESSION) => {
    const result = await app.handle({
      path, method,
      headers: owner ? { authorization: 'Bearer ' + signToken(owner, now + 60000, scope) } : {},
      query: { id: bid.id, dateISO: bid.dateISO },
      body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, pages: [page], processingAuthorized: true, ...body }),
    });
    return { ...result, data: JSON.parse(result.body) };
  };
  return { repo, calls, request };
}

test('testament AI prepares an evidence-first packet and persists a notary-reviewed result', async () => {
  const a = setup();
  const generated = await a.request('/notary/acts/preparation');
  assert.equal(generated.statusCode, 200);
  const preparationValidator = contract.validatorForResponse('/notary/acts/preparation', 'post', 200);
  assert.equal(preparationValidator.validate(generated.data), true, JSON.stringify(preparationValidator.validate.errors));
  assert.equal(generated.data.analysis.serviceId, 'testament');
  assert.equal(generated.data.analysis.preparation.status, 'needs_notary_review');
  assert.equal(generated.data.analysis.preparation.fields.length, 2);
  assert.equal(generated.data.analysis.preparation.fields[0].evidence[0].quote, 'Testatrice : Marie Roy');
  assert.equal(generated.data.workPacket.serviceId, 'testament');
  assert.ok(generated.data.workPacket.controls.some(control => control.id === 'testament_register'));
  const responseValidator = contract.validatorForResponse('/notary/acts/preparation', 'post', 200);
  assert.equal(responseValidator.validate(generated.data), true, JSON.stringify(responseValidator.validate.errors));
  assert.equal(a.calls.length, 1);

  const stored = await a.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.actAnalysis.pages, undefined, 'source pages do not persist in analysis');
  assert.equal(stored.actAnalysis.preparedBy, 'owner');

  const review = await a.request('/notary/acts/review', {
    analysisId: generated.data.analysis.id,
    decisions: [
      { index: 0, decision: 'accepted', reason: 'Pièce lisible et quote exacte' },
      { index: 1, decision: 'corrected', value: 'Alice Roy', reason: 'Confirmation au rendez-vous' },
    ],
    activeReviewSeconds: 35,
    reviewerId: 'forged',
  });
  assert.equal(review.statusCode, 200);
  const reviewValidator = contract.validatorForResponse('/notary/acts/review', 'post', 200);
  assert.equal(reviewValidator.validate(review.data), true, JSON.stringify(reviewValidator.validate.errors));
  assert.equal(review.data.review.reviewerId, 'owner');
  assert.equal(review.data.review.trainingEligible, false);
  assert.equal(review.data.review.reviewerId, 'owner');
});

test('act AI stays behind the retaining session, consent, service and evidence gates', async () => {
  const a = setup();
  assert.equal((await a.request('/notary/acts/preparation', {}, null)).statusCode, 401);
  assert.equal((await a.request('/notary/acts/preparation', {}, 'other')).statusCode, 403);
  assert.equal((await a.request('/notary/acts/preparation', { processingAuthorized: false })).statusCode, 422);
  assert.equal((await a.request('/notary/acts/preparation', { pages: [{ ...page, page: 0 }] })).statusCode, 422);
  assert.equal((await a.request('/notary/acts/preparation', {}, 'owner', 'POST', SCOPES.FEED)).statusCode, 401);
  assert.equal(a.calls.length, 0);
});

test('act AI reuse identity trims generation settings and rejects incomplete Bedrock settings', () => {
  const input = { serviceId: 'procuration', pages: [{ documentId: 'mandate', page: 1, text: 'Mandant : Marie Roy.' }] };
  const identity = actRequestIdentity(input, { provider: ' injected ', region: '  ', model: ' model-a ' });
  assert.equal(identity.provenance.model, 'model-a');
  const same = actRequestIdentity(input, { provider: 'injected', region: '', model: 'model-a' });
  assert.equal(identity.fingerprint, same.fingerprint);
  assert.equal(actRequestIdentity(input, { provider: 'bedrock', region: 'ca-central-1' }), null);
  assert.equal(actRequestIdentity(input, { provider: 'bedrock', region: ' ca-central-1 ', model: ' model-a ' }).provenance.model, 'model-a');
});

test('act AI fails closed on malformed shared counters before provider work', async () => {
  const a = setup();
  a.repo.incrNotaryRateCounter = async () => undefined;
  const result = await a.request('/notary/acts/preparation');
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.data, { errors: [{ code: 'act_ai_unavailable' }] });
  assert.equal(a.calls.length, 0);
});
