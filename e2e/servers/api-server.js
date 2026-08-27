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
const domain = require('@nota/domain');

const PORT = Number(process.env.PORT || 8811);
// Effectively unthrottled for the test run; still a finite guard.
const RL_MAX = Number(process.env.E2E_RL_MAX || 100000);

// LOCAL date, like app.js's todayISO(): the raw UTC slice rolls to tomorrow
// every evening in UTC-4/-5, and the whole run then rejects the sheet's
// default same-day booking as date_passee.
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
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

const app = createApp(repo, {
  billing: demoBilling,
  billingConfigured: false,
  // Same LOCAL-date clock as the fixtures above and the web client's
  // todayISO() — otherwise every evening (UTC-4/-5) the handler's UTC default
  // is already "tomorrow" and rejects same-day bookings as date_passee.
  now: () => today,
  // The one E2E-specific tweak: don't let the shared-IP suite hit the throttle.
  notaryLoginRlMax: RL_MAX,
  partnerClaimRlMax: RL_MAX,
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const query = Object.fromEntries(url.searchParams);
    let body = '';
    for await (const chunk of req) body += chunk;
    const sourceIp = req.socket && req.socket.remoteAddress;
    const out = await app.handle({ method: req.method, path: url.pathname, query, headers: req.headers, body, sourceIp });
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
