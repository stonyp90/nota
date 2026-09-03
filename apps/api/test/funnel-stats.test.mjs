// The conversion funnel's counters (2026-09-02): one per-day GLOBAL counter
// per catalogue step, and the admin overview reading them back in the
// domain's order — plus the live count of notaries waiting for activation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const stats = require('../src/stats.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-14';

// A funnel step is a per-day GLOBAL counter keyed `funnel_<id>`, sharded like
// the offers counter. Only the domain's FUNNEL_EVENTS ids are ever written —
// an unknown id or an unusable day yields nothing, never a mis-keyed item.
test('a funnel event is a per-day global counter keyed funnel_<id>; unknown ids and bad days yield nothing', () => {
  const deltas = stats.statsDeltasForFunnel('visite', '2026-08-14');
  assert.equal(deltas.length, 1);
  assert.match(deltas[0].pk, /^STATS#GLOBAL#\d+$/);
  assert.equal(deltas[0].sk, 'D#2026-08-14');
  assert.deepEqual(deltas[0].adds, { funnel_visite: 1 });
  assert.deepEqual(stats.statsDeltasForFunnel('inconnu', '2026-08-14'), []);
  assert.deepEqual(stats.statsDeltasForFunnel('visite', 'not-a-day'), []);
  assert.deepEqual(stats.statsDeltasForFunnel(null, '2026-08-14'), []);
});

test('overview carries the funnel in FUNNEL_EVENTS order, totalled within the range, plus the pending-approval count', async () => {
  const repo = createMemoryRepo([]);
  await repo.applyStatsDeltas(stats.statsDeltasForFunnel('visite', '2026-08-10'));
  await repo.applyStatsDeltas(stats.statsDeltasForFunnel('visite', '2026-08-12'));
  await repo.applyStatsDeltas(stats.statsDeltasForFunnel('publie', '2026-08-12'));
  await repo.applyStatsDeltas(stats.statsDeltasForFunnel('visite', '2026-06-01')); // outside the window
  await repo.putNotary({ id: 'n1', email: 'a@etude.ca', status: 'en_attente', inscritLe: '2026-08-13T10:00:00.000Z' });
  await repo.putNotary({ id: 'n2', email: 'b@etude.ca', status: 'active', approuveLe: '2026-08-13T10:00:00.000Z' });
  const o = await createAnalytics({ repo, now: () => TODAY }).overview();

  assert.deepEqual(o.entonnoir.map((e) => e.id), domain.FUNNEL_EVENTS.map((e) => e.id), 'same order as the domain catalogue');
  const byId = Object.fromEntries(o.entonnoir.map((e) => [e.id, e]));
  assert.equal(byId.visite.total, 2);
  assert.equal(byId.publie.total, 1);
  assert.equal(byId.notaire_inscrit.total, 0);
  assert.equal(byId.visite.nom, 'Visites');
  assert.equal(byId.visite.nomEn, 'Visits');
  assert.equal(o.gauge.pendingNotaries, 1, 'only the en_attente notary waits for activation');
});

test('an overview with nothing counted still lists every step at zero', async () => {
  const o = await createAnalytics({ repo: createMemoryRepo([]), now: () => TODAY }).overview();
  assert.equal(o.entonnoir.length, domain.FUNNEL_EVENTS.length);
  assert.ok(o.entonnoir.every((e) => e.total === 0));
  assert.equal(o.gauge.pendingNotaries, 0);
});
