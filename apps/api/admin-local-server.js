'use strict';

process.env.NOTA_EMAIL_LANGUAGE ||= 'fr';

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
 * Auth uses a normal email/password login in the console. The legacy magic-link
 * route remains available for recovery and existing bookmarked links. The
 * allowlist comes from NOTA_ADMIN_EMAILS and falls back to a dev-only address;
 * the local password can be overridden with NOTA_ADMIN_PASSWORD.
 * (NOTA_ADMIN_BASE_URL, default http://localhost:4174).
 */
const http = require('node:http');
const { createAdminApp } = require('./src/admin-handler');
const { createAdmin } = require('./src/admin');
const { createMemoryRepo } = require('./src/repo-memory');
const { createDynamoRepo } = require('./src/repo-dynamo');
const domain = require('@nota/domain');
const { devToday, devBids, devPartners, devNotaries, devStatsDeltas, seedDevAdministration } = require('./scripts/dev-fixtures');
const { sourceFingerprint } = require('./scripts/source-fingerprint');

const PORT = Number(process.env.PORT || 8790);
const DEV_ADMIN_EMAIL = 'admin@nota.local';
const DEV_ADMIN_PASSWORD = 'nota-local-admin';

// Same freshness stamp as local-server.js: the digest of the source THIS
// process loaded, on every response as `x-nota-source`. See
// scripts/source-fingerprint.js for why a dev server has to self-report it.
const SOURCE = sourceFingerprint();

// The demo data itself lives in scripts/dev-fixtures.js — the SAME set the
// docker path writes through the Dynamo adapter. These two wrappers keep the
// names this module has always exported (tests drive them directly) while the
// definition stays in one place.
async function seedDevStats(repo, bids, todayISO) {
  await repo.applyStatsDeltas(devStatsDeltas(bids, todayISO));
}

// Quatre notaires de démonstration, étalés sur toute l'échelle de la cote
// (ADR 0028). Mémoire seulement — jamais quand TABLE_NAME pointe une vraie
// table ; c'est `scripts/seed.js` qui écrit les mêmes profils dans DynamoDB.
function seedDevNotaries(repo, todayISO) {
  return Promise.all(devNotaries(todayISO).map((n) => repo.putNotary(n)));
}

/**
 * Composition root, extracted so tests can drive the exact server wiring.
 * Returns { app, repo, email, mode } — `app.handle(request)` is the same
 * transport-agnostic handler the HTTP loop below serves.
 */
function createLocalAdminApp({ today, repo: sharedRepo, mailer, notifier, adminRlMax } = {}) {
  // Québec business day, matching the admin handler's default clock.
  const todayISO = devToday(today);
  const useDynamo = !!process.env.TABLE_NAME;

  let repo = sharedRepo;
  let demoAdminReady = Promise.resolve();
  if (repo) {
    if (!useDynamo) {
      demoAdminReady = seedDevNotaries(repo, todayISO)
        .then(() => seedDevAdministration(repo, todayISO));
    }
  } else if (useDynamo) {
    repo = createDynamoRepo({
      tableName: process.env.TABLE_NAME,
      adminTableName: process.env.ADMIN_TABLE_NAME || `${process.env.TABLE_NAME}-admin`,
      endpoint: process.env.DYNAMO_ENDPOINT,
      region: process.env.AWS_REGION || 'ca-central-1',
    });
  } else {
    repo = createMemoryRepo(devBids(todayISO));
    for (const p of devPartners(todayISO)) repo.createPartner(p);
    demoAdminReady = seedDevNotaries(repo, todayISO)
      .then(() => seedDevAdministration(repo, todayISO));
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
    mailer,
    notifier,
    config: {
      allowlist: emails,
      baseUrl,
      password: process.env.NOTA_ADMIN_PASSWORD || DEV_ADMIN_PASSWORD,
      devEcho: process.env.NODE_ENV !== 'production',
      // The E2E harness alone raises the sign-in throttle: its whole run comes
      // from one IP and signs the operator in once per surface it measures.
      ...(adminRlMax ? { rlMax: adminRlMax } : {}),
    },
  });
  const app = createAdminApp(repo, { admin, adminBaseUrl: baseUrl, mailer, notifier });

  const ready = useDynamo
    ? Promise.resolve()
    : Promise.all([demoAdminReady, seedDevStats(repo, devBids(todayISO), todayISO)]);

  return { app, repo, email: emails[0], mode: useDynamo ? 'dynamo' : 'memory', ready };
}

function startServer({ port = PORT, ...options } = {}) {
  const { app, email, mode, ready } = createLocalAdminApp(options);

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
      res.writeHead(out.statusCode, { ...out.headers, 'x-nota-source': SOURCE.hash });
      res.end(out.body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json', 'x-nota-source': SOURCE.hash });
      res.end(JSON.stringify({ errors: [{ code: 'erreur_serveur', message: String((err && err.message) || err) }] }));
    }
  });

  server.listen(port, () => {
    const store = mode === 'dynamo' ? `DynamoDB ${process.env.DYNAMO_ENDPOINT || '(regional)'}` : 'in-memory fixtures + seeded stats';
    console.log(`Nota ADMIN API on http://localhost:${port}  [${store}]`);
    console.log(`  source ${SOURCE.hash} (${SOURCE.files} fichiers) — rendu dans l'en-tête x-nota-source`);
    console.log(`Dev sign-in: ${email} / ${process.env.NOTA_ADMIN_PASSWORD || DEV_ADMIN_PASSWORD}`);
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { startServer, createLocalAdminApp, seedDevStats, seedDevNotaries, DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD };
