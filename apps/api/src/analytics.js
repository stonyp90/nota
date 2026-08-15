'use strict';

/**
 * Admin analytics use-case — computed WITHOUT a Scan.
 *
 * Two data sources, both bounded:
 *   - HISTORY (offers/retenues/actes/commission over a date range) is read back
 *     from the STATS# rollup counters that the write paths ADD to as facts
 *     happen — a handful of range Queries, no table walk.
 *   - PRESENT-TENSE inventory (open vs retained right now) is computed LIVE from
 *     the same per-month Query the public carnet already uses, so it is always
 *     exact and never drifts. Notary gauge totals come from the running GAUGE
 *     counter (approximate; a phase-4 reconcile heals drift).
 *
 * Pure projection math over the repo read ports; the clock is injected.
 */
const domain = require('@nota/domain');
const { STATS_SHARDS, statsGlobalPK, statsServicePK, statsDaySK } = require('./keys');

// Inclusive list of YYYY-MM-DD dates from `fromISO` to `toISO`, capped so a
// pathological range can never build an unbounded array.
function dateRange(fromISO, toISO, cap = 366) {
  const out = [];
  let cur = Date.parse(fromISO + 'T00:00:00Z');
  const end = Date.parse(toISO + 'T00:00:00Z');
  if (!Number.isFinite(cur) || !Number.isFinite(end) || end < cur) return out;
  while (cur <= end && out.length < cap) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86400000;
  }
  return out;
}

function monthWindow(startMonth, count) {
  const [y, m] = startMonth.split('-').map(Number);
  const months = [];
  for (let i = 0; i < count; i += 1) {
    months.push(new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7));
  }
  return months;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function createAnalytics({ repo, now, gaugeHorizonMonths } = {}) {
  if (!repo) throw new Error('createAnalytics: repo is required');
  const today = now || (() => new Date().toISOString().slice(0, 10));
  const HORIZON = gaugeHorizonMonths || 4;

  // Sum a counter family's day items over [fromISO,toISO] ACROSS ALL SHARDS,
  // returning a map of day -> { offers, retenues, actes, commissionCents }. The
  // K shard partitions are range-Queried in parallel and their per-day counters
  // added together (a day exists in every shard that received a write that day).
  async function readShardedDays(shardPKs, fromISO, toISO) {
    const skStart = statsDaySK(fromISO);
    const skEnd = statsDaySK(toISO);
    const perShard = await Promise.all(shardPKs.map((pk) => repo.queryStats(pk, skStart, skEnd)));
    const byDay = new Map();
    for (const items of perShard) {
      for (const it of items || []) {
        const day = String(it.sk || it.SK || '').replace(/^D#/, '') || it.day;
        const cur = byDay.get(day) || { offers: 0, retenues: 0, actes: 0, commissionCents: 0 };
        cur.offers += num(it.offers);
        cur.retenues += num(it.retenues);
        cur.actes += num(it.actes);
        cur.commissionCents += num(it.commissionCents);
        byDay.set(day, cur);
      }
    }
    return byDay;
  }

  const globalShardPKs = Array.from({ length: STATS_SHARDS }, (_, s) => statsGlobalPK(s));
  const serviceShardPKs = (serviceId) => Array.from({ length: STATS_SHARDS }, (_, s) => statsServicePK(serviceId, s));

  // Present-tense open/retained across the forward month window (bounded Query
  // per month — no Scan). Exact, so the "offres ouvertes" tile never drifts.
  async function liveInventory() {
    const months = monthWindow(today().slice(0, 7), HORIZON);
    let open = 0;
    let retained = 0;
    const seen = new Set();
    for (const month of months) {
      const bids = await repo.listByMonth(month);
      for (const b of bids) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        // Match the public carnet: pending/void (unauthorized-card) offers are not live.
        if (b.paymentStatus === 'pending' || b.paymentStatus === 'void') continue;
        if (b.status === domain.STATUS.RETENUE) retained += 1;
        else open += 1;
      }
    }
    return { open, retained };
  }

  /**
   * The Overview payload for GET /admin/metrics/overview. `range` is
   * { from, to } (YYYY-MM-DD); defaults to the trailing 30 days ending today.
   */
  async function overview(range = {}) {
    const to = domain.isISODate(range.to) ? range.to : today();
    const from =
      domain.isISODate(range.from) && range.from <= to ? range.from : domain.addDays(to, -29);
    const days = dateRange(from, to);

    const global = await readShardedDays(globalShardPKs, from, to);
    let offersPosted = 0;
    let offersRetained = 0;
    let actsCompleted = 0;
    let commissionCents = 0;
    for (const d of global.values()) {
      offersPosted += d.offers;
      offersRetained += d.retenues;
      actsCompleted += d.actes;
      commissionCents += d.commissionCents;
    }

    const offersPerDay = days.map((date) => ({ date, count: global.get(date)?.offers || 0 }));

    const byService = [];
    for (const svc of domain.SERVICES) {
      const svcDays = await readShardedDays(serviceShardPKs(svc.id), from, to);
      let offers = 0;
      let retained = 0;
      for (const d of svcDays.values()) {
        offers += d.offers;
        retained += d.retenues;
      }
      byService.push({ serviceId: svc.id, nom: svc.nom, offers, retained });
    }

    const inv = await liveInventory();
    let gaugeCounters = {};
    try {
      gaugeCounters = (await repo.getGauge()) || {};
    } catch {
      gaugeCounters = {};
    }

    return {
      range: { from, to, days: days.length },
      kpis: {
        offersPosted,
        offersRetained,
        retentionRate: offersPosted > 0 ? Math.round((offersRetained / offersPosted) * 1000) / 1000 : 0,
        commissionCents,
        actsCompleted,
      },
      gauge: {
        open: inv.open,
        retained: inv.retained,
        activeNotaries: Math.max(0, num(gaugeCounters.active)),
        onboardingNotaries: Math.max(0, num(gaugeCounters.onboarding)),
      },
      series: { offersPerDay, byService },
    };
  }

  return { overview, liveInventory };
}

module.exports = { createAnalytics, dateRange };
