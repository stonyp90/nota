import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const stats = require('../src/stats.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-14';

async function seed() {
  const repo = createMemoryRepo([
    { id: 'b1', serviceId: 'refinancement', dateISO: '2026-08-20', status: 'ouverte' },
    { id: 'b2', serviceId: 'refinancement', dateISO: '2026-09-05', status: 'ouverte' },
    { id: 'b3', serviceId: 'refinancement', dateISO: '2026-08-25', status: 'retenue' },
  ]);
  // History rollups (event days inside the trailing-30 window ending TODAY).
  for (let i = 0; i < 5; i += 1) {
    await repo.applyStatsDeltas(stats.statsDeltasForOffer({ serviceId: 'refinancement', createdAt: i < 3 ? '2026-08-10' : '2026-08-12' }));
  }
  await repo.applyStatsDeltas(stats.statsDeltasForRetain({ serviceId: 'refinancement', createdAt: '2026-08-10' }, '2026-08-13'));
  await repo.applyStatsDeltas(stats.statsDeltasForComplete({ serviceId: 'refinancement', completedAt: '2026-08-13', commissionCents: 9500 }));
  // An offer OUTSIDE the default window must be excluded from the trailing-30 KPIs.
  await repo.applyStatsDeltas(stats.statsDeltasForOffer({ serviceId: 'refinancement', createdAt: '2026-06-01' }));
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

test('the overview surfaces the configured commission rate next to the cents collected', async () => {
  const repo = await seed();
  // Default: the same DEFAULT_COMMISSION_RATE billing charges with.
  const { DEFAULT_COMMISSION_RATE } = require('../src/billing.js');
  const o1 = await createAnalytics({ repo, now: () => TODAY }).overview();
  assert.equal(o1.kpis.commissionRate, DEFAULT_COMMISSION_RATE);
  // Configured: the injected knob wins (mirrors NOTA_COMMISSION_RATE wiring).
  const o2 = await createAnalytics({ repo, now: () => TODAY, commissionRate: 0.15 }).overview();
  assert.equal(o2.kpis.commissionRate, 0.15);
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

test('byService iterates the financing catalogue with per-service offers and retenues', async () => {
  const repo = await seed();
  const a = createAnalytics({ repo, now: () => TODAY });
  const o = await a.overview();
  const byId = Object.fromEntries(o.series.byService.map((s) => [s.serviceId, s]));
  // ADR 0010: the catalogue is the financing family — both acts, no retired act row.
  assert.deepEqual(Object.keys(byId), ['refinancement', 'financement']);
  assert.equal(byId.refinancement.offers, 5);
  assert.equal(byId.refinancement.retained, 1);
  assert.ok(byId.refinancement.nom); // human label present for the UI
  assert.equal(byId.financement.offers, 0); // second act present even with no offers yet
  assert.equal(byId.financement.retained, 0);
  assert.ok(byId.financement.nom);
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
  // No referred records -> an empty ledger, but the flat per-track amounts are
  // still surfaced so the admin UI never hardcodes them.
  assert.deepEqual(o.parrainages, { client: domain.REFERRAL.client, notaire: domain.REFERRAL.notaire, codes: [] });
});

// --- Partner referral ledger (ADR 0011) --------------------------------------

test('parrainages: a referred demand earns at RETENTION; a referred notary earns once on their first retained act', async () => {
  const repo = createMemoryRepo([
    // EVEROY referred two demands; the retained one earns REFERRAL.client NOW
    // (completion is information, not the trigger).
    { id: 'r1', serviceId: 'refinancement', dateISO: '2026-08-20', status: 'retenue', notaryId: 'N1', parrain: 'EVEROY' },
    { id: 'r2', serviceId: 'refinancement', dateISO: '2026-09-02', status: 'ouverte', parrain: 'EVEROY' },
    // BROKER1's referral was retained (earns) but the act has not completed yet.
    { id: 'r3', serviceId: 'refinancement', dateISO: '2026-08-22', status: 'retenue', notaryId: 'N2', parrain: 'BROKER1' },
    // An organic (unreferred) bid must not appear in the ledger at all.
    { id: 'r4', serviceId: 'refinancement', dateISO: '2026-08-23', status: 'ouverte' },
  ]);
  // The notary track: N1 was referred by EVEROY (private `parrain` on the
  // profile, stored at signup) and has retained their first act (r1) -> +250.
  // N2 signed up organically: no notary reward for anyone.
  await repo.putNotary({ id: 'N1', email: 'n1@notaire.ca', status: 'active', parrain: 'EVEROY' });
  await repo.putNotary({ id: 'N2', email: 'n2@notaire.ca', status: 'active' });
  // The act ledger still feeds the informational `completes` column.
  await repo.markActCompleted('r1', { bidId: 'r1', commissionCents: 20000, completedAt: TODAY });
  // EVEROY claimed AND confirmed their code (email-verified, ADR 0011); BROKER1
  // never registered. Only a `confirmedAt` partner binds identity in the ledger.
  await repo.createPartner({ code: 'EVEROY', type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', createdAt: TODAY, confirmedAt: TODAY });

  // Count the completion joins: ONLY the bids that carry a parrain code may be
  // looked up (efficiency is part of the contract — never one read per carnet bid).
  let lookups = 0;
  const counting = { ...repo, getActCompletion: (bidId) => (lookups += 1, repo.getActCompletion(bidId)) };

  const a = createAnalytics({ repo: counting, now: () => TODAY });
  const o = await a.overview();

  assert.equal(lookups, 3, 'only the 3 referred bids are joined against the act ledger');
  assert.equal(o.parrainages.client, domain.REFERRAL.client);
  assert.equal(o.parrainages.notaire, domain.REFERRAL.notaire);
  // Sorted by dollars owed first. EVEROY: one retained demand (50) + one
  // active referred notary (250). BROKER1: one retained demand (50), never
  // registered — the registry join reports null identity, but attribution
  // still works without registration.
  assert.deepEqual(o.parrainages.codes, [
    {
      code: 'EVEROY', demandes: 2, retenues: 1, completes: 1, notaires: 1, notairesActifs: 1,
      du: domain.REFERRAL.client + domain.REFERRAL.notaire,
      type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca',
      // The fr/en labels ride along from the domain so the admin UI renders
      // them without re-hardcoding; unregistered codes omit them (BROKER1).
      typeNom: 'Courtier hypothécaire', typeNomEn: 'Mortgage broker',
    },
    {
      code: 'BROKER1', demandes: 1, retenues: 1, completes: 0, notaires: 0, notairesActifs: 0,
      du: domain.REFERRAL.client, type: null, courriel: null,
    },
  ]);
});

test('parrainages: durable earnings recorded at event time survive the window (all-time, monotonic)', async () => {
  // NOTHING lives in the forward month window — the earnings happened long ago
  // and the durable ledger is the only trace left. `du` must not shrink to 0.
  const repo = createMemoryRepo([]);
  await repo.recordReferralEarning({ code: 'EVEROY', track: 'client', refId: 'old-bid', montant: domain.REFERRAL.client, at: '2026-01-10' });
  await repo.recordReferralEarning({ code: 'EVEROY', track: 'notaire', refId: 'N9', montant: domain.REFERRAL.notaire, at: '2026-02-01' });
  const o = await createAnalytics({ repo, now: () => TODAY }).overview();
  assert.deepEqual(o.parrainages.codes, [
    {
      code: 'EVEROY', demandes: 0, retenues: 1, completes: 0, notaires: 1, notairesActifs: 1,
      du: domain.REFERRAL.client + domain.REFERRAL.notaire, type: null, courriel: null,
    },
  ]);
});

test('parrainages: an earning seen BOTH live and durably counts once (max, never sum)', async () => {
  // The normal live case: the retained referred bid is inside the window AND
  // its event-time earning was recorded. The two sources must reconcile, not add.
  const repo = createMemoryRepo([
    { id: 'r1', serviceId: 'refinancement', dateISO: '2026-08-20', status: 'retenue', notaryId: 'N1', parrain: 'EVEROY' },
  ]);
  await repo.putNotary({ id: 'N1', email: 'n1@notaire.ca', status: 'active', parrain: 'EVEROY' });
  await repo.recordReferralEarning({ code: 'EVEROY', track: 'client', refId: 'r1', montant: domain.REFERRAL.client, at: TODAY });
  await repo.recordReferralEarning({ code: 'EVEROY', track: 'notaire', refId: 'N1', montant: domain.REFERRAL.notaire, at: TODAY });
  const o = await createAnalytics({ repo, now: () => TODAY }).overview();
  assert.deepEqual(o.parrainages.codes, [
    {
      code: 'EVEROY', demandes: 1, retenues: 1, completes: 0, notaires: 1, notairesActifs: 1,
      du: domain.REFERRAL.client + domain.REFERRAL.notaire, type: null, courriel: null,
    },
  ]);
});

test('recordReferralEarning is write-once per (code, track, ref): the replay returns false and counts once', async () => {
  const repo = createMemoryRepo([]);
  const earn = { code: 'eve-roy', track: 'client', refId: 'b1', montant: 50, at: TODAY };
  assert.equal(await repo.recordReferralEarning(earn), true, 'the first write earns');
  assert.equal(await repo.recordReferralEarning(earn), false, 'the replay is a no-op');
  const events = await repo.listReferralEarnings();
  assert.equal(events.length, 1);
  assert.equal(events[0].code, 'EVEROY', 'the code is stored NORMALIZED');
});

test('parrainages degrades gracefully on a repo without the act-ledger or registry reads', async () => {
  const repo = createMemoryRepo([
    { id: 'r1', serviceId: 'refinancement', dateISO: '2026-08-20', status: 'retenue', parrain: 'EVEROY' },
  ]);
  const stripped = { ...repo };
  delete stripped.getActCompletion;
  delete stripped.getPartner;
  const a = createAnalytics({ repo: stripped, now: () => TODAY });
  const o = await a.overview();
  assert.deepEqual(o.parrainages.codes, [
    { code: 'EVEROY', demandes: 1, retenues: 1, completes: 0, notaires: 0, notairesActifs: 0, du: domain.REFERRAL.client, type: null, courriel: null },
  ]);
});
