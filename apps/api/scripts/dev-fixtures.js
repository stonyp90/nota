'use strict';

/**
 * THE local demo data set — ONE definition, three consumers.
 *
 * Until now the fixtures lived twice: `local-server.js` seeded a memory repo,
 * `admin-local-server.js` seeded a *different* memory repo with the same bids
 * plus four notaries and an analytics history — and the DOCKER path seeded
 * nothing at all, because `useDynamo = !!TABLE_NAME` skipped both branches and
 * `create-table.js` only ever issued CreateTable. A cold `docker compose up`
 * therefore served an empty carnet and an empty admin console.
 *
 * So the data moves here, behind a repo PORT: `seedInto(repo)` writes the same
 * items whether `repo` is the memory adapter or the DynamoDB one. The two dev
 * servers call it for their in-memory mode; `scripts/seed.js` calls it against
 * DynamoDB Local for the docker path. There is no second, divergent set.
 *
 * IDEMPOTENCE. Bids and notaries are full-item writes (last write wins), and
 * `createPartner` is conditional and answers `false` when the code is already
 * claimed — all three can be replayed. The analytics history CANNOT: it is a
 * list of atomic ADD counters, so replaying it doubles every KPI. It is
 * therefore guarded by the ledger that already exists for exactly this shape of
 * problem (`wasEventProcessed` / `markEventProcessed`), keyed on
 * `domain.seedSignature()` — the domain's own fingerprint of the fixture shape,
 * which changes the day a pricing criterion is added — plus the business day the
 * history is drawn around. Same shape, same day → written once.
 *
 * `{ force: true }` (or `--force`) RÉÉCRIT cet historique, au sens strict : il
 * retire d'abord celui qui est déjà écrit, puis le réécrit. Sans ce retrait, le
 * forçage ne « réécrivait » rien du tout — il ADDitionnait une seconde fois, et
 * la console admin rendait 68 offres publiées pour 34 offres réelles, 6 notaires
 * actifs pour 3. Un outil de remise à plat qui double les chiffres qu'il
 * prétend remettre à plat est pire que pas d'outil : la pile reste verte et
 * ment. Les compteurs étant des ADD atomiques, leur inverse exact est le MÊME
 * jeu de deltas négativé — même liste, donc mêmes shards : chaque compteur
 * redescend à sa valeur d'avant puis remonte, et aucun ne peut passer négatif.
 */
const { createHash } = require('node:crypto');
const domain = require('@nota/domain');
const { statsDeltasForOffer, statsDeltasForRetain, statsDeltasForGauge } = require('../src/stats');

// A deterministic slice of the fixtures arrives through a partner link, so the
// referral ledger (client 50 $ / notary 250 $, ADR 0010/0011) renders populated
// on both surfaces — the admin card hides itself when the program is empty.
const REFERRAL_EVERY = 5;
const REFERRAL_NOTARY_EVERY = 10;

// Both codes are seeded CONFIRMED (email-verified, ADR 0011): an owned code
// answers 409 to a foreign claim and appears as a payee in the ledger.
const DEMO_PARTNERS = [
  { code: 'EVEROY', type: 'agent_immobilier', courriel: 'eve.roy@agence.demo' },
  { code: 'COURTIER1', type: 'courtier_hypothecaire', courriel: 'marc.courtier@hypotheque.demo' },
];

// The notary gauge needs a small fixed population or the overview's gauge card
// renders on nothing.
const DEMO_GAUGE = { active: 3, onboarding: 1 };

/** The business day the whole demo set is drawn around (Québec, never a UTC slice). */
function devToday(today) {
  return today || domain.businessDay(null, process.env.NOTA_TIMEZONE);
}

/** The carnet: the domain fixtures, with the deterministic referral slice. */
function devBids(todayISO) {
  return domain.makeFixtures(todayISO).map((b, i) =>
    i % REFERRAL_EVERY === 0
      ? { ...b, parrain: i % REFERRAL_NOTARY_EVERY === 0 ? DEMO_PARTNERS[0].code : DEMO_PARTNERS[1].code }
      : b,
  );
}

/** The two demo partner codes, confirmed on the seeding day. */
function devPartners(todayISO) {
  return DEMO_PARTNERS.map((p) => ({ ...p, createdAt: todayISO, confirmedAt: todayISO }));
}

// Quatre notaires de démonstration, étalés sur toute l'échelle de la cote
// (ADR 0028) : le registre et le journal d'audit ne se jugent pas sur un
// tableau vide. Les dates sont dérivées du jour ouvrable, donc le rendu est
// stable d'une exécution à l'autre.
function devNotaries(todayISO) {
  const jours = (n) => new Date(Date.parse(todayISO + 'T12:00:00.000Z') - n * 86400000).toISOString();
  const profils = [
    {
      id: 'Ndemo-chevronne', email: 'chevronne@etude.demo', label: 'Étude Bourassa & Associés',
      ratingSum: 4.9 * 40, ratingCount: 40,
      actsCompleted: 80, actsByService: { refinancement: 50, financement: 30 },
      proposalsCount: 58, acceptsCount: 22, declinesCount: 3,
      rayonKm: 50, urgences: true, lienCNQ: 'https://www.cnq.org/trouver-un-notaire/', prefixe: 'G1R',
      commissionCentsCollected: 1_284_00,
      createdAt: jours(520), lastSeenAt: jours(0),
    },
    {
      id: 'Ndemo-etabli', email: 'etabli@etude.demo', label: 'Notaires du Vieux-Port',
      ratingSum: 4.7 * 18, ratingCount: 18,
      actsCompleted: 25, actsByService: { refinancement: 18, financement: 7 },
      proposalsCount: 24, acceptsCount: 8, declinesCount: 6,
      rayonKm: 50, urgences: false, lienCNQ: 'https://www.cnq.org/trouver-un-notaire/', prefixe: 'G1K',
      commissionCentsCollected: 402_00, commissionCentsDue: 168_00,
      createdAt: jours(210), lastSeenAt: jours(1),
    },
    {
      id: 'Ndemo-jeune', email: 'jeune@etude.demo', label: 'Me Sophie Bergeron',
      ratingSum: 4.6 * 6, ratingCount: 6,
      actsCompleted: 8, actsByService: { refinancement: 8 },
      proposalsCount: 11, acceptsCount: 3, declinesCount: 3,
      rayonKm: 25, urgences: false, lienCNQ: 'https://www.cnq.org/trouver-un-notaire/', prefixe: 'G2B',
      commissionCentsCollected: 96_00,
      createdAt: jours(95), lastSeenAt: jours(2),
    },
    {
      id: 'Ndemo-nouveau', email: 'nouveau@etude.demo', label: 'Me Luc Gagné',
      status: 'onboarding', chargesEnabled: false,
      createdAt: jours(2), lastSeenAt: jours(2),
    },
  ];
  return profils.map((p) => ({
    status: 'active', chargesEnabled: true, connectAccountId: 'acct_' + p.id, role: 'notary', ...p,
  }));
}

/**
 * Deterministic dev analytics: spread the fixture bids' "posted" events across
 * the trailing 28 days (i-indexed, no randomness beyond shard placement — the
 * read side sums all shards, so totals and series are stable), retain every
 * 4th one a little later, and give the notary gauge a small fixed population.
 */
function devStatsDeltas(bids, todayISO) {
  const deltas = [];
  bids.forEach((bid, i) => {
    const createdAt = domain.addDays(todayISO, -((i % 28) + 1));
    deltas.push(...statsDeltasForOffer({ ...bid, createdAt }));
    if (i % 4 === 0) {
      deltas.push(...statsDeltasForRetain(bid, domain.addDays(todayISO, -(i % 14))));
    }
  });
  deltas.push(...statsDeltasForGauge(DEMO_GAUGE));
  return deltas;
}

/**
 * L'inverse exact d'un jeu de deltas : mêmes clés, mêmes shards, incréments
 * opposés. `applyStatsDeltas` n'émet que des ADD, dont la soustraction est la
 * seule annulation possible sans nouvelle méthode de dépôt.
 */
function negateDeltas(deltas) {
  return (deltas || []).map((d) => ({
    ...d,
    adds: Object.fromEntries(Object.entries(d.adds || {}).map(([k, n]) => [k, -Number(n || 0)])),
  }));
}

/**
 * The marker under which a written analytics history is remembered. The domain's
 * fixture signature is HASHED rather than carried whole: it is a long, growing
 * string (every pricing criterion is in it) and this value becomes a partition
 * key.
 */
function statsMarker(todayISO) {
  const shape = createHash('sha256').update(domain.seedSignature()).digest('hex').slice(0, 12);
  return `seed:dev-stats:${shape}:${todayISO}`;
}

/**
 * Write the whole demo set through a repo port. Works against ANY adapter —
 * that is the point: what the docker stack seeds is what the tests seed.
 *
 * Returns a summary `{ today, bids, partners, notaries, stats }` where `stats`
 * is the number of counter deltas written (0 when the guard skipped them).
 */
async function seedInto(repo, { today, force = false, log = () => {} } = {}) {
  const todayISO = devToday(today);

  const bids = devBids(todayISO);
  for (const bid of bids) await repo.put(bid);
  log(`  ${bids.length} offres écrites (carnet du ${todayISO})`);

  const partners = devPartners(todayISO);
  for (const p of partners) await repo.createPartner(p);
  log(`  ${partners.length} codes de parrainage confirmés`);

  const notaries = devNotaries(todayISO);
  for (const n of notaries) await repo.putNotary(n);
  log(`  ${notaries.length} notaires de démonstration`);

  const marker = statsMarker(todayISO);
  const dejaEcrit = await repo.wasEventProcessed(marker);
  let stats = 0;
  if (dejaEcrit && !force) {
    log('  historique analytique déjà écrit pour ce jour — ignoré (--force pour réécrire)');
  } else {
    const deltas = devStatsDeltas(bids, todayISO);
    // RÉÉCRIRE, et non additionner : l'historique déjà en place est retiré par
    // son inverse exact avant que le neuf soit écrit, sinon « --force » double
    // chaque KPI de la console au lieu de le remettre à plat.
    if (dejaEcrit) {
      await repo.applyStatsDeltas(negateDeltas(deltas));
      log('  historique précédent retiré (--force)');
    }
    await repo.applyStatsDeltas(deltas);
    await repo.markEventProcessed(marker, new Date().toISOString());
    stats = deltas.length;
    log(`  ${stats} compteurs analytiques (28 jours d'historique)`);
  }

  return { today: todayISO, bids: bids.length, partners: partners.length, notaries: notaries.length, stats };
}

module.exports = {
  DEMO_PARTNERS,
  DEMO_GAUGE,
  devToday,
  devBids,
  devPartners,
  devNotaries,
  devStatsDeltas,
  negateDeltas,
  statsMarker,
  seedInto,
};
