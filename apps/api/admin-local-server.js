'use strict';

/**
 * Local dev server for the ADMIN API (the admin.nota.ca Lambda, runnable with
 * no AWS). Plain node:http, same shape as local-server.js. Two modes:
 *
 *   - TABLE_NAME unset  → in-memory repo seeded with the domain fixtures PLUS a
 *     deterministic analytics history (seedDevStats), so the overview renders a
 *     populated dashboard out of the box.
 *   - TABLE_NAME set    → DynamoDB (Local or regional) with ADMIN_TABLE_NAME as
 *     the separate admin table, mirroring production's two-table split.
 *
 * Auth is the REAL magic-link flow: NODE_ENV !== 'production' makes the admin
 * use-case echo the link back in the response (devLink), so the flow completes
 * with no mailbox. The allowlist comes from NOTA_ADMIN_EMAILS and falls back to
 * a dev-only address; the link points at the admin SPA dev server
 * (NOTA_ADMIN_BASE_URL, default http://localhost:4174).
 */
const http = require('node:http');
const { createAdminApp } = require('./src/admin-handler');
const { createAdmin } = require('./src/admin');
const { createMemoryRepo } = require('./src/repo-memory');
const { createDynamoRepo } = require('./src/repo-dynamo');
const { statsDeltasForOffer, statsDeltasForRetain, statsDeltasForGauge } = require('./src/stats');
const domain = require('@nota/domain');

const PORT = Number(process.env.PORT || 8790);
const DEV_ADMIN_EMAIL = 'admin@nota.local';

// Deterministic dev analytics: spread the fixture bids' "posted" events across
// the trailing 28 days (i-indexed, no randomness beyond shard placement — the
// read side sums all shards, so totals and series are stable), retain every
// 4th one a little later, and give the notary gauge a small fixed population.
async function seedDevStats(repo, bids, todayISO) {
  const deltas = [];
  bids.forEach((bid, i) => {
    const createdAt = domain.addDays(todayISO, -((i % 28) + 1));
    deltas.push(...statsDeltasForOffer({ ...bid, createdAt }));
    if (i % 4 === 0) {
      deltas.push(...statsDeltasForRetain(bid, domain.addDays(todayISO, -(i % 14))));
    }
  });
  deltas.push(...statsDeltasForGauge({ active: 3, onboarding: 1 }));
  await repo.applyStatsDeltas(deltas);
}

// Quatre notaires de démonstration, étalés sur toute l'échelle de la cote
// (ADR 0028) : le registre et le journal d'audit ne se jugent pas sur un
// tableau vide. Mémoire seulement — jamais quand TABLE_NAME pointe une vraie
// table. Les dates sont dérivées du jour ouvrable, donc le rendu est stable.
function seedDevNotaries(repo, todayISO) {
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
  profils.forEach((p) => {
    repo.putNotary({ status: 'active', chargesEnabled: true, connectAccountId: 'acct_' + p.id, role: 'notary', ...p });
  });
}

/**
 * Composition root, extracted so tests can drive the exact server wiring.
 * Returns { app, repo, email, mode } — `app.handle(request)` is the same
 * transport-agnostic handler the HTTP loop below serves.
 */
function createLocalAdminApp({ today } = {}) {
  // Québec business day, matching the admin handler's default clock.
  const todayISO = today || domain.businessDay(null, process.env.NOTA_TIMEZONE);
  const useDynamo = !!process.env.TABLE_NAME;

  let repo;
  if (useDynamo) {
    repo = createDynamoRepo({
      tableName: process.env.TABLE_NAME,
      adminTableName: process.env.ADMIN_TABLE_NAME || `${process.env.TABLE_NAME}-admin`,
      endpoint: process.env.DYNAMO_ENDPOINT,
      region: process.env.AWS_REGION || 'ca-central-1',
    });
  } else {
    // A deterministic slice of the fixtures arrives via demo partner links, so
    // the overview's Parrainages ledger renders populated out of the box (the
    // card hides itself when the program has no activity).
    const fixtures = domain.makeFixtures(todayISO).map((b, i) =>
      i % 5 === 0 ? { ...b, parrain: i % 10 === 0 ? 'EVEROY' : 'COURTIER1' } : b,
    );
    repo = createMemoryRepo(fixtures);
    // Seeded as CONFIRMED (email-verified, ADR 0011) so the admin referral
    // ledger shows these demo codes as owned payees, not unconfirmed claims.
    repo.createPartner({ code: 'EVEROY', type: 'agent_immobilier', courriel: 'eve.roy@agence.demo', createdAt: todayISO, confirmedAt: todayISO });
    repo.createPartner({ code: 'COURTIER1', type: 'courtier_hypothecaire', courriel: 'marc.courtier@hypotheque.demo', createdAt: todayISO, confirmedAt: todayISO });
    seedDevNotaries(repo, todayISO);
  }

  const emails = (process.env.NOTA_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!emails.length) emails.push(DEV_ADMIN_EMAIL);

  const baseUrl = process.env.NOTA_ADMIN_BASE_URL || 'http://localhost:4174';

  // Build the admin use-case explicitly (rather than via env inside the
  // handler) so the local composition is visible in one place. devEcho stays
  // conditional on NODE_ENV exactly like production wiring.
  const admin = createAdmin({
    repo,
    config: {
      allowlist: emails,
      baseUrl,
      devEcho: process.env.NODE_ENV !== 'production',
    },
  });
  const app = createAdminApp(repo, { admin, adminBaseUrl: baseUrl });

  const ready = useDynamo
    ? Promise.resolve()
    : seedDevStats(repo, domain.makeFixtures(todayISO), todayISO);

  return { app, repo, email: emails[0], mode: useDynamo ? 'dynamo' : 'memory', ready };
}

function startServer() {
  const { app, email, mode, ready } = createLocalAdminApp();

  const server = http.createServer(async (req, res) => {
    try {
      await ready;
      const url = new URL(req.url, 'http://localhost');
      const query = Object.fromEntries(url.searchParams);
      let body = '';
      for await (const chunk of req) body += chunk;
      const out = await app.handle({
        method: req.method,
        path: url.pathname,
        query,
        headers: req.headers,
        body,
        sourceIp: req.socket.remoteAddress || null,
      });
      res.writeHead(out.statusCode, out.headers);
      res.end(out.body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ code: 'erreur_serveur', message: String((err && err.message) || err) }] }));
    }
  });

  server.listen(PORT, () => {
    const store = mode === 'dynamo' ? `DynamoDB ${process.env.DYNAMO_ENDPOINT || '(regional)'}` : 'in-memory fixtures + seeded stats';
    console.log(`Nota ADMIN API on http://localhost:${PORT}  [${store}]`);
    console.log(`Dev sign-in: request a link for ${email} — the response echoes the magic link (devLink).`);
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { createLocalAdminApp, seedDevStats, seedDevNotaries, DEV_ADMIN_EMAIL };
