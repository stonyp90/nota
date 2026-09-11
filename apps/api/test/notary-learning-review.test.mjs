import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('@nota/domain');
const { summarizeLearningSignals, runNotaryLearningReview } = require('../src/notary-learning-review');

test('scheduled learning review counts notary feedback without turning it into online training', () => {
  const report = summarizeLearningSignals([
    { meta: { kind: 'ai_output' } },
    { meta: { kind: 'notary_review', data: { decisions: [
      { decision: 'accepted' }, { decision: 'corrected' }, { decision: 'rejected' },
    ] } } },
    { meta: { kind: 'customer_behavior', data: { message: 'must not be surfaced' } } },
  ], { days: ['2026-09-08'] });
  assert.equal(report.version, D.NOTARY_LEARNING_POLICY_VERSION);
  assert.equal(report.eventCounts.notary_review, 1);
  assert.deepEqual(report.reviewDecisions, { accepted: 1, corrected: 1, rejected: 1 });
  assert.equal(report.training.weightUpdate, 'not_started');
  assert.equal(report.training.automaticPromotion, false);
  assert.equal(JSON.stringify(report).includes('must not be surfaced'), false);
});

test('scheduled learning review reads complete days only and remains a dry-run', async () => {
  const calls = [];
  const result = await runNotaryLearningReview({
    now: '2026-09-10',
    repo: { queryNotaryLearningByDay: async (day, limit) => {
      calls.push({ day, limit });
      return day === '2026-09-09' ? [{ meta: { kind: 'notary_review', data: { decisions: [] } } }] : [];
    } },
    days: 2,
  });
  assert.deepEqual(result.days, ['2026-09-08', '2026-09-09']);
  assert.equal(result.eventCount, 1);
  assert.equal(result.training.weightUpdate, 'not_started');
  assert.ok(calls.every(call => call.limit > 0));
});
