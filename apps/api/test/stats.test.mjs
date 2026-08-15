import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  statsDeltasForOffer,
  statsDeltasForRetain,
  statsDeltasForComplete,
  statsDeltasForNotaryOnboarding,
  statsDeltasForNotaryActive,
} = require('../src/stats.js');

test('an offer bumps the global + per-service "offers" counter (sharded), keyed by the day it was posted', () => {
  const deltas = statsDeltasForOffer({ serviceId: 'testament', createdAt: '2026-08-14', dateISO: '2026-08-20' });
  assert.equal(deltas.length, 2);
  assert.match(deltas[0].pk, /^STATS#GLOBAL#\d+$/);
  assert.match(deltas[1].pk, /^STATS#SVC#testament#\d+$/);
  // Both counters for one fact land on the SAME shard (so a summed read is exact).
  assert.equal(deltas[0].pk.split('#').pop(), deltas[1].pk.split('#').pop());
  assert.equal(deltas[0].sk, 'D#2026-08-14');
  assert.deepEqual(deltas[0].adds, { offers: 1 });
  assert.deepEqual(deltas[1].adds, { offers: 1 });
});

test('offer day falls back to the signing date when createdAt is absent', () => {
  const deltas = statsDeltasForOffer({ serviceId: 'procuration', dateISO: '2026-09-01' });
  assert.equal(deltas[0].sk, 'D#2026-09-01');
});

test('an offer with no serviceId only bumps the global counter; a malformed date yields nothing', () => {
  assert.equal(statsDeltasForOffer({ createdAt: '2026-08-14' }).length, 1);
  assert.deepEqual(statsDeltasForOffer({ serviceId: 'testament', createdAt: 'not-a-date' }), []);
  assert.deepEqual(statsDeltasForOffer(null), []);
});

test('a retain is keyed by the retention day, not the offer day', () => {
  const deltas = statsDeltasForRetain(
    { serviceId: 'refinancement', createdAt: '2026-08-01', dateISO: '2026-08-20' },
    '2026-08-15'
  );
  assert.equal(deltas[0].sk, 'D#2026-08-15');
  assert.deepEqual(deltas[0].adds, { retenues: 1 });
});

test('a completed act adds one acte and the commission cents, globally and per service (sharded)', () => {
  const deltas = statsDeltasForComplete({ serviceId: 'testament', completedAt: '2026-08-14', commissionCents: 9500 });
  assert.match(deltas[0].pk, /^STATS#GLOBAL#\d+$/);
  assert.equal(deltas[0].sk, 'D#2026-08-14');
  assert.deepEqual(deltas[0].adds, { actes: 1, commissionCents: 9500 });
  assert.match(deltas[1].pk, /^STATS#SVC#testament#\d+$/);
  assert.deepEqual(deltas[1].adds, { actes: 1, commissionCents: 9500 });
});

test('a non-numeric commission never poisons the counter (coerces to 0)', () => {
  const deltas = statsDeltasForComplete({ completedAt: '2026-08-14', commissionCents: 'oops' });
  assert.equal(deltas[0].adds.commissionCents, 0);
});

test('notary gauge deltas: onboarding +1, then active +1 / onboarding -1 on graduation', () => {
  assert.deepEqual(statsDeltasForNotaryOnboarding(), [{ pk: 'STATS#GAUGE', sk: 'GAUGE', adds: { onboarding: 1 } }]);
  assert.deepEqual(statsDeltasForNotaryActive(), [{ pk: 'STATS#GAUGE', sk: 'GAUGE', adds: { active: 1, onboarding: -1 } }]);
});
