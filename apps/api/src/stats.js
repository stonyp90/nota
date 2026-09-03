'use strict';

/**
 * Pure builders for the analytics rollup deltas (see keys.js STATS#). Each
 * builder turns one marketplace fact into a list of atomic-ADD instructions
 *
 *   { pk, sk, adds: { <counter>: <integer> } }
 *
 * that the repo applies with a DynamoDB `UpdateItem ... ADD` (or an in-memory
 * increment). ADD is commutative and needs no read-modify-write, so concurrent
 * writers never race and a delta can be re-applied idempotently ONLY if paired
 * with an idempotency guard on the fact itself (the caller's job — e.g. the
 * conditional retain / the ACT# write-once). These functions are side-effect
 * free and injected nothing: they just describe the arithmetic.
 *
 * Kept out of @nota/domain: the domain package is pure product rules and knows
 * nothing about storage keys. This is an API-layer (persistence-shape) concern.
 */
const domain = require('@nota/domain');
const {
  STATS_SHARDS,
  statsGlobalPK,
  statsServicePK,
  statsDaySK,
  STATS_GAUGE_PK,
  STATS_GAUGE_SK,
} = require('./keys');

// A random shard 0..K-1 for this fact, so writes spread across shard partitions
// instead of hammering one hot item. Read side sums all shards.
function pickShard() {
  return Math.floor(Math.random() * STATS_SHARDS);
}

// Normalize any date/datetime string to a YYYY-MM-DD event day. Returns '' when
// unusable so callers can drop a malformed delta rather than key it wrong.
function dayOf(value) {
  const s = String(value == null ? '' : value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// A non-negative integer, or 0 — keeps a bad amount from poisoning a counter.
function intOf(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : 0;
}

// A bid was POSTED. Event day is when it was created (createdAt), falling back
// to the signing date. Bumps the global and per-service "offers" day counters.
function statsDeltasForOffer(bid) {
  if (!bid) return [];
  const day = dayOf(bid.createdAt) || dayOf(bid.dateISO);
  if (!day) return [];
  const shard = pickShard();
  const deltas = [{ pk: statsGlobalPK(shard), sk: statsDaySK(day), adds: { offers: 1 } }];
  if (bid.serviceId) deltas.push({ pk: statsServicePK(bid.serviceId, shard), sk: statsDaySK(day), adds: { offers: 1 } });
  return deltas;
}

// A bid was RETAINED by a notary. Event day is the day of retention (the caller
// passes it — usually "today"), falling back to the bid's createdAt. Bumps the
// "retenues" day counters, the throughput of retentions in a period.
function statsDeltasForRetain(bid, retainedAtISO) {
  if (!bid) return [];
  const day = dayOf(retainedAtISO) || dayOf(bid.createdAt) || dayOf(bid.dateISO);
  if (!day) return [];
  const shard = pickShard();
  const deltas = [{ pk: statsGlobalPK(shard), sk: statsDaySK(day), adds: { retenues: 1 } }];
  if (bid.serviceId) deltas.push({ pk: statsServicePK(bid.serviceId, shard), sk: statsDaySK(day), adds: { retenues: 1 } });
  return deltas;
}

// A retained act COMPLETED and Nota collected its commission. Event day is the
// completion day. Bumps the "actes" count and the "commissionCents" total.
function statsDeltasForComplete(act) {
  if (!act) return [];
  const day = dayOf(act.completedAt) || dayOf(act.dateISO);
  if (!day) return [];
  const cents = intOf(act.commissionCents);
  const shard = pickShard();
  const deltas = [
    { pk: statsGlobalPK(shard), sk: statsDaySK(day), adds: { actes: 1, commissionCents: cents } },
  ];
  if (act.serviceId) {
    deltas.push({ pk: statsServicePK(act.serviceId, shard), sk: statsDaySK(day), adds: { actes: 1, commissionCents: cents } });
  }
  return deltas;
}

// A notary began FREE onboarding: +1 to the present-tense "en intégration"
// gauge. (Approximate running total; a phase-4 reconcile heals any drift.)
function statsDeltasForNotaryOnboarding() {
  return [{ pk: STATS_GAUGE_PK, sk: STATS_GAUGE_SK, adds: { onboarding: 1 } }];
}

// A notary's Connect account became chargeable (ACTIVE): +1 active, -1 the
// onboarding gauge it graduated from.
function statsDeltasForNotaryActive() {
  return [{ pk: STATS_GAUGE_PK, sk: STATS_GAUGE_SK, adds: { active: 1, onboarding: -1 } }];
}

// Generic present-tense gauge adjustment — the caller (billing) decides which
// counters move for a given status transition (e.g. active->onboarding on a
// charges-disabled toggle, or -1 active when an active notary is deauthorized),
// keeping the transition logic in the billing layer and the key shape here.
function statsDeltasForGauge(adds) {
  return adds && Object.keys(adds).length ? [{ pk: STATS_GAUGE_PK, sk: STATS_GAUGE_SK, adds: { ...adds } }] : [];
}

// One step of the conversion funnel happened on `dayISO` (2026-09-02). The
// catalogue of steps is the domain's (FUNNEL_EVENTS) — an id outside it is
// dropped here, so a beacon can never mint a counter of its own. Stored as a
// per-day GLOBAL counter named `funnel_<id>`, sharded like the offers counter;
// the admin overview reads every `funnel_*` key back in catalogue order.
const FUNNEL_COUNTER_PREFIX = 'funnel_';
function statsDeltasForFunnel(id, dayISO) {
  if (!domain.isFunnelEvent(id)) return [];
  const day = dayOf(dayISO);
  if (!day) return [];
  return [{ pk: statsGlobalPK(pickShard()), sk: statsDaySK(day), adds: { [FUNNEL_COUNTER_PREFIX + id]: 1 } }];
}

module.exports = {
  dayOf,
  FUNNEL_COUNTER_PREFIX,
  statsDeltasForOffer,
  statsDeltasForRetain,
  statsDeltasForComplete,
  statsDeltasForNotaryOnboarding,
  statsDeltasForNotaryActive,
  statsDeltasForGauge,
  statsDeltasForFunnel,
};
