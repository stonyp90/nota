'use strict';

/**
 * E2E API launcher — a thin, test-only wrapper around the same demo stack that
 * apps/api/local-server.js boots (in-memory fixtures + a Stripe stand-in), with
 * ONE difference: the notary-login and partner-claim rate limits are raised far
 * above their production defaults (5 / 15 min / IP).
 *
 * Why: the whole E2E run shares one server and one client IP (localhost), so a
 * couple of legitimate sign-ins plus a retry would otherwise trip the 429
 * throttle and make the suite flaky. This wrapper leaves apps/api untouched and
 * keeps the tweak inside the E2E harness. Behaviour is otherwise identical to
 * `node apps/api/local-server.js`.
 */
const http = require('node:http');
const path = require('node:path');

const apiRoot = path.join(__dirname, '..', '..', 'apps', 'api');
const { createApp } = require(path.join(apiRoot, 'src', 'handler'));
const { createBilling } = require(path.join(apiRoot, 'src', 'billing'));
const { createMemoryRepo } = require(path.join(apiRoot, 'src', 'repo-memory'));
const { createLocalAdminApp } = require(path.join(apiRoot, 'admin-local-server'));
const { createOAuth } = require(path.join(apiRoot, 'src', 'oauth'));
const domain = require('@nota/domain');

const PORT = Number(process.env.PORT || 8811);
const SITE_URL = process.env.NOTA_SITE_URL || 'http://localhost:4311';
process.env.NOTA_OAUTH_LOCAL = 'true';
process.env.NOTA_OAUTH_ORIGIN = SITE_URL;
process.env.NOTA_OAUTH_ENCRYPTION_KEY ||= '11'.repeat(32);
for (const id of ['google', 'microsoft', 'linkedin']) {
  process.env['NOTA_OAUTH_' + id.toUpperCase() + '_CLIENT_ID'] ||= 'nota-local-' + id;
  process.env['NOTA_OAUTH_' + id.toUpperCase() + '_CLIENT_SECRET'] ||= 'nota-local-' + id + '-secret';
}
// Effectively unthrottled for the test run; still a finite guard.
const RL_MAX = Number(process.env.E2E_RL_MAX || 100000);

// The Québec business day — the SAME clock the handler's default `now` uses,
// so fixtures and the API's idea of "today" can never disagree. (A UTC slice
// here seeded tomorrow's carnet every evening; the browser's local date is
// always >= the Québec date, so client-picked dates are never date_passee.)
const today = domain.businessDay(null, process.env.NOTA_TIMEZONE);
// Same demo referral slice as apps/api/local-server.js so the two seeded demo
// partners (EVEROY / COURTIER1) exist and the referral paths are exercisable.
const fixtures = domain.makeFixtures(today).map((b, i) =>
  i % 5 === 0 ? { ...b, parrain: i % 10 === 0 ? 'EVEROY' : 'COURTIER1' } : b,
);
const repo = createMemoryRepo(fixtures);
repo.createPartner({ code: 'EVEROY', type: 'agent_immobilier', courriel: 'eve.roy@agence.demo', createdAt: today, confirmedAt: today });
repo.createPartner({ code: 'COURTIER1', type: 'courtier_hypothecaire', courriel: 'marc.courtier@hypotheque.demo', createdAt: today, confirmedAt: today });

const demoBilling = createBilling({
  repo,
  stripe: {
    async createConnectAccount() { return { id: 'acct_demo' }; },
    async createOnboardingLink({ accountId }) { return { url: 'http://localhost:' + PORT + '/demo-onboarding/' + accountId }; },
    async createOfferAuthorization({ bidId }) { return { sessionId: 'cs_demo_' + bidId, url: 'http://localhost:' + PORT + '/demo-checkout/' + bidId }; },
    async captureAndTransfer({ bidId }) { return { id: 'pi_demo_' + bidId }; },
    async chargeActCommission({ bidId }) { return { id: 'ch_demo_' + bidId }; },
    async cancelOfferAuthorization({ bidId }) { return { id: 'pi_demo_' + bidId, canceled: true }; },
    constructEvent() { throw new Error('demo mode: no Stripe webhooks'); },
  },
  now: () => new Date().toISOString(),
});

const oauth = createOAuth({ repo, env: process.env, now: () => Date.now() });
for (const id of ['google', 'microsoft', 'linkedin']) {
  const identity = oauth.localDemoIdentity(id);
  repo.putOAuthIdentity(identity.subject, identity);
}

const app = createApp(repo, {
  siteUrl: SITE_URL,
  oauth,
  billing: demoBilling,
  billingConfigured: false,
  // Same LOCAL-date clock as the fixtures above and the web client's
  // todayISO() — otherwise every evening (UTC-4/-5) the handler's UTC default
  // is already "tomorrow" and rejects same-day bookings as date_passee.
  now: () => today,
  // The one E2E-specific tweak: don't let the shared-IP suite hit a throttle.
  // EVERY per-IP throttle the handler exposes is raised, not just the two
  // sign-in ones: the funnel beacon (/events, 120/window in production) was
  // the first to trip once the suite grew past ~30 specs — every spec's
  // `visite` / `jour_ouvert` / `formulaire` beacons come from 127.0.0.1, and
  // no-console-errors.spec.js then read the 429s as a product regression.
  notaryLoginRlMax: RL_MAX,
  partnerClaimRlMax: RL_MAX,
  notarySignupRlMax: RL_MAX,
  notaryVerifyRlMax: RL_MAX,
  clientLoginRlMax: RL_MAX,
  supportRlMax: RL_MAX,
  chatRlMax: RL_MAX,
  funnelRlMax: RL_MAX,
});
// Exercise the real local shared-store composition: admin replies must become
// visible in the public widget without a test-only messaging implementation.
// Un postier de test pour la console : sans lui, le notifieur de campagne
// n'existe pas et « Envoyer » répond 503 — le chemin d'envoi, le registre des
// destinataires et « Qui a reçu » ne seraient traversés par aucun test de bout
// en bout (audit du 2026-09-12). Rien ne part sur le réseau : les messages
// s'empilent en mémoire, et la suite peut les lire.
const { createFakeMailer } = require(path.join(apiRoot, 'src', 'notify-port'));
const adminMailer = createFakeMailer();
const localAdmin = createLocalAdminApp({ repo, adminRlMax: RL_MAX, mailer: adminMailer });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const query = Object.fromEntries(url.searchParams);
    let body = '';
    for await (const chunk of req) body += chunk;
    const sourceIp = req.socket && req.socket.remoteAddress;
    await localAdmin.ready;
    const handler = /^\/(?:api\/)?admin\//.test(url.pathname) ? localAdmin.app : app;
    const out = await handler.handle({ method: req.method, path: url.pathname, query, headers: req.headers, body, sourceIp });
    res.writeHead(out.statusCode, out.headers);
    res.end(out.body);
  } catch (err) {
    res.writeHead(500, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
    });
    res.end(JSON.stringify({ errors: [{ code: 'erreur_serveur', message: String(err && err.message || err) }] }));
  }
});

server.listen(PORT, () => {
  console.log(`Nota E2E API on http://localhost:${PORT}  [in-memory fixtures, RL max ${RL_MAX}]`);
});
