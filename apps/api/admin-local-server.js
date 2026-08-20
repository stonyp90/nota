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

/**
 * Composition root, extracted so tests can drive the exact server wiring.
 * Returns { app, repo, email, mode } — `app.handle(request)` is the same
 * transport-agnostic handler the HTTP loop below serves.
 */
function createLocalAdminApp({ today } = {}) {
  const todayISO = today || new Date().toISOString().slice(0, 10);
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
    repo = createMemoryRepo(domain.makeFixtures(todayISO));
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

module.exports = { createLocalAdminApp, seedDevStats, DEV_ADMIN_EMAIL };
