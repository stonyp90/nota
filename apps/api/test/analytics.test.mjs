import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const stats = require('../src/stats.js');

const TODAY = '2026-08-14';

async function seed() {
  const repo = createMemoryRepo([
    { id: 'b1', serviceId: 'testament', dateISO: '2026-08-20', status: 'ouverte' },
    { id: 'b2', serviceId: 'procuration', dateISO: '2026-09-05', status: 'ouverte' },
    { id: 'b3', serviceId: 'testament', dateISO: '2026-08-25', status: 'retenue' },
  ]);
  // History rollups (event days inside the trailing-30 window ending TODAY).
  for (let i = 0; i < 3; i += 1) {
    await repo.applyStatsDeltas(stats.statsDeltasForOffer({ serviceId: 'testament', createdAt: '2026-08-10' }));
  }
  for (let i = 0; i < 2; i += 1) {
    await repo.applyStatsDeltas(stats.statsDeltasForOffer({ serviceId: 'refinancement', createdAt: '2026-08-12' }));
  }
  await repo.applyStatsDeltas(stats.statsDeltasForRetain({ serviceId: 'testament', createdAt: '2026-08-10' }, '2026-08-13'));
  await repo.applyStatsDeltas(stats.statsDeltasForComplete({ serviceId: 'testament', completedAt: '2026-08-13', commissionCents: 9500 }));
  // An offer OUTSIDE the default window must be excluded from the trailing-30 KPIs.
  await repo.applyStatsDeltas(stats.statsDeltasForOffer({ serviceId: 'testament', createdAt: '2026-06-01' }));
  // Notary gauge counters.
  await repo.applyStatsDeltas(stats.statsDeltasForNotaryOnboarding());
  await repo.applyStatsDeltas(stats.statsDeltasForNotaryOnboarding());
  await repo.applyStatsDeltas(stats.statsDeltasForNotaryOnboarding());
  await repo.applyStatsDeltas(stats.statsDeltasForNotaryActive());
  return repo;
}

test('overview KPIs sum the rollups within the trailing-30-day window only', async () => {
  const repo = await seed();
  const a = createAnalytics({ repo, now: () => TODAY });
  const o = await a.overview();

  assert.equal(o.range.to, TODAY);
  assert.equal(o.range.from, '2026-07-16');
  assert.equal(o.kpis.offersPosted, 5); // 3 + 2, the June offer excluded
  assert.equal(o.kpis.offersRetained, 1);
  assert.equal(o.kpis.actsCompleted, 1);
  assert.equal(o.kpis.commissionCents, 9500);
  assert.equal(o.kpis.retentionRate, 0.2);
});

test('offersPerDay is zero-filled across the range and carries the counts on their days', async () => {
  const repo = await seed();
  const a = createAnalytics({ repo, now: () => TODAY });
  const o = await a.overview();
  assert.equal(o.series.offersPerDay.length, 30);
  const byDate = Object.fromEntries(o.series.offersPerDay.map((d) => [d.date, d.count]));
  assert.equal(byDate['2026-08-10'], 3);
  assert.equal(byDate['2026-08-12'], 2);
  assert.equal(byDate['2026-08-11'], 0);
});

test('byService breaks offers and retenues down per service', async () => {
  const repo = await seed();
  const a = createAnalytics({ repo, now: () => TODAY });
  const o = await a.overview();
  const byId = Object.fromEntries(o.series.byService.map((s) => [s.serviceId, s]));
  assert.equal(byId.testament.offers, 3);
  assert.equal(byId.testament.retained, 1);
  assert.equal(byId.refinancement.offers, 2);
  assert.equal(byId.procuration.offers, 0);
  assert.ok(byId.testament.nom); // human label present for the UI
});

test('the live gauge counts present open/retained from the month window; notary tiles from the running counter', async () => {
  const repo = await seed();
  const a = createAnalytics({ repo, now: () => TODAY });
  const o = await a.overview();
  assert.equal(o.gauge.open, 2); // b1 (Aug) + b2 (Sep) within the forward window
  assert.equal(o.gauge.retained, 1); // b3
  assert.equal(o.gauge.activeNotaries, 1);
  assert.equal(o.gauge.onboardingNotaries, 2); // 3 onboarding − 1 graduated
});

test('a custom range narrows the KPIs', async () => {
  const repo = await seed();
  const a = createAnalytics({ repo, now: () => TODAY });
  const o = await a.overview({ from: '2026-08-11', to: '2026-08-13' });
  assert.equal(o.kpis.offersPosted, 2); // only 2026-08-12
  assert.equal(o.range.days, 3);
});

test('an empty marketplace reports honest zeros, never fabricated numbers', async () => {
  const repo = createMemoryRepo();
  const a = createAnalytics({ repo, now: () => TODAY });
  const o = await a.overview();
  assert.equal(o.kpis.offersPosted, 0);
  assert.equal(o.kpis.retentionRate, 0);
  assert.equal(o.gauge.open, 0);
  assert.equal(o.gauge.activeNotaries, 0);
});
