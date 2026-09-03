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
const { FUNNEL_COUNTER_PREFIX } = require('./stats');

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
  // Default clock = the Québec civil day, matching the handler that feeds the
  // STATS# counters — a UTC day here would misalign the live gauge every evening.
  const today = now || (() => domain.businessDay(null, process.env.NOTA_TIMEZONE));
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
        const cur = byDay.get(day) || { offers: 0, retenues: 0, actes: 0, commissionCents: 0, funnel: {} };
        cur.offers += num(it.offers);
        cur.retenues += num(it.retenues);
        cur.actes += num(it.actes);
        cur.commissionCents += num(it.commissionCents);
        // The funnel steps (stats.statsDeltasForFunnel): every `funnel_<id>`
        // key on the item, folded by id — the catalogue decides below which
        // ids are reported, so a stale key can never invent a step.
        for (const k of Object.keys(it)) {
          if (k.startsWith(FUNNEL_COUNTER_PREFIX)) {
            const id = k.slice(FUNNEL_COUNTER_PREFIX.length);
            cur.funnel[id] = (cur.funnel[id] || 0) + num(it[k]);
          }
        }
        byDay.set(day, cur);
      }
    }
    return byDay;
  }

  const globalShardPKs = Array.from({ length: STATS_SHARDS }, (_, s) => statsGlobalPK(s));
  const serviceShardPKs = (serviceId) => Array.from({ length: STATS_SHARDS }, (_, s) => statsServicePK(serviceId, s));

  // Present-tense open/retained across the forward month window (bounded Query
  // per month — no Scan). Exact, so the "offres ouvertes" tile never drifts.
  // The same walk also collects what the referral ledger needs (ADR 0011) at
  // zero extra Queries: the REFERRED bids (those carrying a `parrain` code)
  // and the ids of the notaries who retained anything — the raw material for
  // the notary reward track below.
  async function liveInventory() {
    const months = monthWindow(today().slice(0, 7), HORIZON);
    let open = 0;
    let retained = 0;
    const seen = new Set();
    const referred = [];
    const retainedBy = new Set();
    for (const month of months) {
      const bids = await repo.listByMonth(month);
      for (const b of bids) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        // Match the public carnet: pending/void (unauthorized-card) offers are not live.
        if (b.paymentStatus === 'pending' || b.paymentStatus === 'void') continue;
        if (b.status === domain.STATUS.RETENUE) {
          retained += 1;
          if (b.notaryId) retainedBy.add(String(b.notaryId));
        } else {
          open += 1;
        }
        if (domain.isReferralCode(b.parrain)) referred.push(b);
      }
    }
    return { open, retained, referred, retainedBy };
  }

  // The partner referral ledger (ADR 0011). The amounts DUE come from the
  // DURABLE earning events the retain path records at event time (write-once
  // per (code, track, ref) — see keys.js EARN#/REFEARN), so `du` is ALL-TIME
  // and monotonic: a signing date scrolling out of the live month window can
  // never shrink what a partner is owed. Two reward tracks:
  //   • client (REFERRAL.client): earned the moment a referred demand is
  //     RETAINED — one durable event per bid;
  //   • notaire (REFERRAL.notaire): earned once ever, when a referred notary
  //     retains their FIRST act — one durable event per notary.
  // The live window still enriches the softer columns (demandes, completes)
  // and doubles as a SAFETY NET: the earned counts are the MAX of the durable
  // and window-derived views, never their sum — so a best-effort durable write
  // that failed still shows while its bid is in the window, and nothing is
  // ever counted twice. Completions are joined on (getActCompletion, ONLY for
  // bids that carry a parrain code — a lookup per referred bid, fired
  // concurrently, never one per carnet bid) as honest information, not a
  // trigger. Registered partners with ZERO referrals are folded in from
  // listPartners so the operator sees every claimed code. An older repo
  // without any of these methods degrades gracefully rather than breaking the
  // overview.
  async function referralSection(referred, retainedBy) {
    const joined = await Promise.all(
      (referred || []).map(async (b) => {
        if (typeof repo.getActCompletion !== 'function') return b;
        try {
          const acte = await repo.getActCompletion(b.id);
          return acte ? { ...b, acte } : b;
        } catch {
          return b;
        }
      })
    );
    // The referred-notary records: every notary who retained a bid in the
    // window, kept when their profile carries a valid parrain code. Each has
    // retained at least one act (that is how we found them) -> premierActe.
    let notaires = [];
    if (typeof repo.getNotary === 'function') {
      const profiles = await Promise.all(
        [...(retainedBy || [])].map(async (id) => {
          try {
            return await repo.getNotary(id);
          } catch {
            return null;
          }
        })
      );
      notaires = profiles
        .filter((n) => n && domain.isReferralCode(n.parrain))
        .map((n) => ({ parrain: n.parrain, premierActe: true }));
    }
    // The durable earning events — the ledger's all-time truth. Folded into
    // per-code per-track counts; a repo without the method (or a failed read)
    // leaves the map empty and the window-derived view stands alone.
    let earnings = [];
    if (typeof repo.listReferralEarnings === 'function') {
      try {
        earnings = (await repo.listReferralEarnings()) || [];
      } catch {
        earnings = [];
      }
    }
    const durable = new Map(); // CODE -> { client, notaire } earned-event counts
    for (const e of earnings) {
      if (!e || !domain.isReferralCode(e.code)) continue;
      const code = domain.normalizeReferralCode(e.code);
      const d = durable.get(code) || { client: 0, notaire: 0 };
      if (e.track === 'client') d.client += 1;
      else if (e.track === 'notaire') d.notaire += 1;
      durable.set(code, d);
    }
    // Fold the live window through the domain as before, then reconcile each
    // row's earned counts against the durable events: MAX per track (a bid can
    // be seen by both sources — reconcile, never add), and `du` recomputed
    // from the reconciled counts so it can only grow as time passes.
    const windowRows = domain.referralLedger(joined, notaires);
    const byCode = new Map(windowRows.map((r) => [r.code, r]));
    const emptyRow = (code) => ({ code, demandes: 0, retenues: 0, completes: 0, notaires: 0, notairesActifs: 0, du: 0 });
    for (const [code, d] of durable) {
      const row = byCode.get(code) || emptyRow(code);
      row.retenues = Math.max(row.retenues, d.client);
      row.notairesActifs = Math.max(row.notairesActifs, d.notaire);
      row.notaires = Math.max(row.notaires, row.notairesActifs);
      byCode.set(code, row);
    }
    for (const row of byCode.values()) {
      row.du = row.retenues * domain.REFERRAL.client + row.notairesActifs * domain.REFERRAL.notaire;
    }
    // Every CONFIRMED code is a row, even with zero referrals — the operator
    // must see a partner the moment they confirm, not the day they earn. A
    // pending/unconfirmed claim is NOT a partner of record (ADR 0011
    // fraud-hardening): a squatted-but-unconfirmed code must never appear as
    // owned, so only records stamped `confirmedAt` are folded in.
    // (Partners claimed before the sparse GSI overload are not listed until
    // their item is rewritten; their rows still appear from activity above.)
    if (typeof repo.listPartners === 'function') {
      try {
        for (const p of (await repo.listPartners()) || []) {
          if (!p || !p.confirmedAt) continue;
          const code = domain.normalizeReferralCode(p.code);
          if (domain.isReferralCode(code) && !byCode.has(code)) byCode.set(code, emptyRow(code));
        }
      } catch {
        /* enumeration is a visibility nicety — never break the overview */
      }
    }
    // Join the partner REGISTRY (POST /partenaires + verify) onto each ledger
    // row so the operator sees WHO to pay — type + courriel when the code was
    // CONFIRMED. Attribution works without registration (an unclaimed code still
    // tallies, with null identity), and a pending/unconfirmed claim binds NO
    // identity either — only a confirmed (`confirmedAt`) partner is the owner of
    // record. One GetItem per code actually in the ledger, fired concurrently.
    // Same sort as the domain fold: dollars owed first, then code.
    const rows = [...byCode.values()].sort((a, b) => b.du - a.du || a.code.localeCompare(b.code));
    const codes = await Promise.all(
      rows.map(async (row) => {
        let partenaire = null;
        if (typeof repo.getPartner === 'function') {
          try {
            const p = await repo.getPartner(row.code);
            // Only a CONFIRMED partner is bound as the owner of record; an
            // unconfirmed claim is treated as no registered partner for payout.
            partenaire = p && p.confirmedAt ? p : null;
          } catch {
            partenaire = null;
          }
        }
        // The partner-type LABELS come from the domain alongside the id, so
        // the admin UI never re-hardcodes domain data. Unregistered codes omit
        // the label fields entirely (their identity is unknown, not blank).
        const partnerType = partenaire
          ? domain.REFERRAL.partners.find((p) => p.id === partenaire.type) || null
          : null;
        return {
          ...row,
          type: (partenaire && partenaire.type) || null,
          courriel: (partenaire && partenaire.courriel) || null,
          ...(partnerType ? { typeNom: partnerType.nom, typeNomEn: partnerType.nomEn } : {}),
        };
      })
    );
    return {
      // The flat per-track amounts, surfaced so the admin UI never hardcodes them.
      client: domain.REFERRAL.client,
      notaire: domain.REFERRAL.notaire,
      codes,
    };
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
    const funnelTotals = {};
    for (const d of global.values()) {
      offersPosted += d.offers;
      offersRetained += d.retenues;
      actsCompleted += d.actes;
      commissionCents += d.commissionCents;
      for (const [id, n] of Object.entries(d.funnel || {})) funnelTotals[id] = (funnelTotals[id] || 0) + n;
    }
    // The conversion funnel (2026-09-02): every step of the domain catalogue,
    // in its order, with the range's total — zero included, so the operator
    // reads WHERE leads drop, not only where they happened.
    const entonnoir = domain.FUNNEL_EVENTS.map((e) => ({
      id: e.id, nom: e.nom, nomEn: e.nomEn, total: Math.max(0, num(funnelTotals[e.id])),
    }));

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
    const parrainages = await referralSection(inv.referred, inv.retainedBy);
    // Notaries waiting for the operator's activation (2026-09-02) — counted
    // LIVE from the roster (one bounded GSI Query, never a Scan), so the tile
    // is exact the moment a signup lands or an activation clears it.
    let pendingNotaries = 0;
    if (typeof repo.listNotaries === 'function') {
      try {
        pendingNotaries = ((await repo.listNotaries()) || []).filter((n) => n && n.status === 'en_attente' && !n.approuveLe).length;
      } catch {
        pendingNotaries = 0;
      }
    }

    return {
      range: { from, to, days: days.length },
      kpis: {
        offersPosted,
        offersRetained,
        retentionRate: offersPosted > 0 ? Math.round((offersRetained / offersPosted) * 1000) / 1000 : 0,
        // ADR 0031 — les cents que Nota a facturés pour SON service. Aucun
        // taux ne les accompagne : il n'y en a plus, et en publier un
        // décrirait une part des honoraires du notaire (art. 32 C.déont.).
        commissionCents,
        actsCompleted,
      },
      gauge: {
        open: inv.open,
        retained: inv.retained,
        activeNotaries: Math.max(0, num(gaugeCounters.active)),
        onboardingNotaries: Math.max(0, num(gaugeCounters.onboarding)),
        pendingNotaries,
      },
      series: { offersPerDay, byService },
      entonnoir,
      // Per-code referral totals (demandes / retenues / complétés / dû) plus
      // the flat commission amount — see ADR 0011.
      parrainages,
    };
  }

  return { overview, liveInventory };
}

module.exports = { createAnalytics, dateRange };
