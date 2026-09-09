import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('@nota/domain');
const { createMemoryRepo } = require('../src/repo-memory');
const { statsGlobalPK, statsDaySK } = require('../src/keys');
const { completeDaysBefore, decide, readWindow, runCustomerImprovement } = require('../src/customer-improvement');

const TODAY = '2026-09-09';

function highFrictionMetrics() {
  return D.experienceMetrics({
    formStarts: 20,
    publicationAttempts: 10,
    publications: 10,
    blockedAttempts: 6,
    publicationFailures: 0,
    publicationProxy: 0.5,
    blockedRate: 0.3,
  });
}

test('complete windows exclude today and autonomous decisions stay inside the UX policy', () => {
  assert.deepEqual(completeDaysBefore(TODAY, 3), ['2026-09-06', '2026-09-07', '2026-09-08']);
  const plan = decide({ recent: highFrictionMetrics(), previous: {}, nowISO: TODAY });
  assert.equal(plan.action, 'enable_guided_intake');
  assert.equal(plan.mode, 'guided');
  assert.equal(plan.primaryMetric, 'blockedRate');
  assert.ok(D.CUSTOMER_IMPROVEMENT_POLICY.protectedDecisions.includes('model_weights'));
  assert.ok(D.CUSTOMER_IMPROVEMENT_POLICY.protectedDecisions.includes('legal_rules'));
});

test('guided experience rolls back when the publication proxy regresses', () => {
  const plan = decide({
    config: { mode: 'guided', baseline: { formStarts: 20, publications: 10, publicationProxy: 0.5 } },
    recent: { formStarts: 20, publicationAttempts: 10, publications: 3, publicationProxy: 0.15 },
    previous: {}, nowISO: TODAY,
  });
  assert.equal(plan.action, 'rollback_guided_intake');
  assert.equal(plan.mode, 'standard');
  assert.equal(plan.reason, 'publication_proxy_regressed');
});

test('daily worker applies one reversible policy item and records the decision without raw customer text', async () => {
  const repo = createMemoryRepo([]);
  const days = completeDaysBefore(TODAY, 7);
  await repo.applyStatsDeltas(days.flatMap((day, index) => [{
    pk: statsGlobalPK(0), sk: statsDaySK(day), adds: {
      funnel_formulaire: index === 0 ? 8 : 2,
      funnel_publication_tentee: index === 0 ? 4 : 1,
      funnel_publie: index === 0 ? 4 : 1,
      funnel_formulaire_bloque: index === 0 ? 4 : 1,
    },
  }]));
  await repo.appendLearningSignal({
    id: 'learning-1', ts: '2026-09-08T12:00:00.000Z', day: '2026-09-08', action: 'notary_learning_signal',
    meta: { kind: 'communication', data: { responseLatencySeconds: 120 } },
  });
  await repo.appendLearningSignal({
    id: 'learning-2', ts: '2026-09-08T12:01:00.000Z', day: '2026-09-08', action: 'notary_learning_signal',
    meta: { kind: 'client_feedback', data: { rating: 5, comment: { value: 'secret client text' } } },
  });

  const result = await runCustomerImprovement({
    repo, now: () => TODAY, nowMs: () => Date.parse('2026-09-09T13:15:00.000Z'),
    newId: () => 'improvement-1', enabled: true,
  });
  assert.equal(result.applied, true);
  assert.equal(result.auditRecorded, true);
  assert.equal(result.config.mode, 'guided');
  assert.equal(result.config.revision, 1);
  assert.equal(result.publicExperience.mode, 'guided');
  const stored = await repo.getExperienceConfig();
  assert.equal(stored.mode, 'guided');
  const audit = await repo.queryTxAuditByDay(TODAY);
  const decision = audit.find((entry) => entry.action === 'customer_improvement_applied');
  assert.ok(decision);
  assert.equal(JSON.stringify(decision).includes('secret client text'), false);
});

test('dry run observes a candidate without mutating the experience policy', async () => {
  const repo = createMemoryRepo([]);
  const days = completeDaysBefore(TODAY, 7);
  await repo.applyStatsDeltas(days.map((day) => ({
    pk: statsGlobalPK(0), sk: statsDaySK(day), adds: {
      funnel_formulaire: 3, funnel_publication_tentee: 2, funnel_publie: 2,
      funnel_formulaire_bloque: 2,
    },
  })));
  const result = await runCustomerImprovement({ repo, now: TODAY, nowMs: Date.now, enabled: false });
  assert.equal(result.decision.action, 'enable_guided_intake');
  assert.equal(result.applied, false);
  assert.equal(await repo.getExperienceConfig(), null);
});

test('concurrent scheduler retries use compare-and-set and publish one revision', async () => {
  const repo = createMemoryRepo([]);
  const days = completeDaysBefore(TODAY, 7);
  await repo.applyStatsDeltas(days.map((day) => ({
    pk: statsGlobalPK(0), sk: statsDaySK(day), adds: {
      funnel_formulaire: 3, funnel_publication_tentee: 2, funnel_publie: 2,
      funnel_formulaire_bloque: 2,
    },
  })));
  const results = await Promise.all([
    runCustomerImprovement({ repo, now: TODAY, nowMs: () => Date.parse('2026-09-09T13:15:00.000Z'), newId: () => 'improvement-a', enabled: true }),
    runCustomerImprovement({ repo, now: TODAY, nowMs: () => Date.parse('2026-09-09T13:15:00.000Z'), newId: () => 'improvement-b', enabled: true }),
  ]);
  assert.equal(results.filter(result => result.applied).length, 1);
  assert.equal(results.filter(result => result.decision.conflict === 'concurrent_policy_update').length, 1);
  assert.equal((await repo.getExperienceConfig()).revision, 1);
  assert.equal((await repo.queryTxAuditByDay(TODAY)).filter(entry => entry.action === 'customer_improvement_applied').length, 1);
});

test('learning reads stay within the per-window budget and mark truncation', async () => {
  const days = completeDaysBefore(TODAY, 7);
  const limits = [];
  const repo = {
    queryStats: async () => [],
    queryNotaryLearningByDay: async (day, limit) => {
      limits.push({ day, limit });
      return Array.from({ length: limit }, (_, i) => ({
        id: `${day}-${i}`, action: 'notary_learning_signal',
        meta: { kind: 'customer_input', data: {} },
      }));
    },
  };
  const result = await readWindow(repo, days);
  assert.equal(result.learningSignalEvents, 20000);
  assert.equal(result.learningSignalsTruncated, true);
  assert.equal(limits.length, 1, 'once the cap is reached, no later day is queried');
  assert.equal(limits[0].limit, 20000);
});
