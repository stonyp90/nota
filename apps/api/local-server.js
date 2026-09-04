'use strict';

/**
 * Local dev server (plain node:http, no framework). Uses DynamoDB Local when
 * TABLE_NAME is set (docker-compose), otherwise falls back to an in-memory repo
 * seeded with domain fixtures so the API returns a populated carnet with no
 * infrastructure at all.
 */
const http = require('node:http');
const { createApp } = require('./src/handler');
const { createBilling } = require('./src/billing');
const { createMemoryRepo } = require('./src/repo-memory');
const { createDynamoRepo } = require('./src/repo-dynamo');
const domain = require('@nota/domain');

const PORT = Number(process.env.PORT || 8788);
const useDynamo = !!process.env.TABLE_NAME;

let repo;
if (useDynamo) {
  repo = createDynamoRepo({
    tableName: process.env.TABLE_NAME,
    endpoint: process.env.DYNAMO_ENDPOINT,
    region: process.env.AWS_REGION || 'ca-central-1',
  });
} else {
  // Seed on the same Québec business day the handler's default clock uses —
  // a UTC slice here would seed "tomorrow" every evening and desync the carnet.
  const today = domain.businessDay(null, process.env.NOTA_TIMEZONE);
  // Same demo referral slice as admin-local-server.js: a deterministic subset
  // of the fixtures arrives via partner links and the two demo partners are
  // registered, so POST /partenaires' idempotent/409 paths and the referral
  // field are exercisable against this server out of the box.
  const fixtures = domain.makeFixtures(today).map((b, i) =>
    i % 5 === 0 ? { ...b, parrain: i % 10 === 0 ? 'EVEROY' : 'COURTIER1' } : b,
  );
  repo = createMemoryRepo(fixtures);
  // Seeded as CONFIRMED (email-verified, ADR 0011) so the demo's owned codes
  // answer 409 to a foreign claim and appear as payees in the referral ledger.
  repo.createPartner({ code: 'EVEROY', type: 'agent_immobilier', courriel: 'eve.roy@agence.demo', createdAt: today, confirmedAt: today });
  repo.createPartner({ code: 'COURTIER1', type: 'courtier_hypothecaire', courriel: 'marc.courtier@hypotheque.demo', createdAt: today, confirmedAt: today });
}

// In-memory demo: a Stripe stand-in so the FULL lifecycle (retain, complete,
// commission) is walkable with zero configuration — every call succeeds with
// deterministic ids and no network. `billingConfigured: false` keeps the
// pre-billing offer flow (no hosted checkout), exactly like the BDD world.
// With TABLE_NAME (a real deployment shape) nothing is injected: billing is
// built lazily from the real Stripe env, and completing an act without keys
// fails loudly rather than pretending money moved.
const demoBilling = useDynamo ? null : createBilling({
  repo,
  stripe: {
    async createConnectAccount() { return { id: 'acct_demo' }; },
    async createOnboardingLink({ accountId }) { return { url: 'http://localhost:' + PORT + '/demo-onboarding/' + accountId }; },
    async createOfferAuthorization({ bidId }) { return { sessionId: 'cs_demo_' + bidId, url: 'http://localhost:' + PORT + '/demo-checkout/' + bidId }; },
    // ADR 0035 — la carte s'enregistre à la publication, la caution se pose J-2.
    async createOfferSetup({ bidId }) { return { sessionId: 'cs_demo_setup_' + bidId, url: 'http://localhost:' + PORT + '/demo-checkout/' + bidId }; },
    async placeOfferAuthorization({ bidId }) { return { paymentIntentId: 'pi_demo_' + bidId, status: 'requires_capture' }; },
    async captureAndTransfer({ bidId }) { return { id: 'pi_demo_' + bidId }; },
    async chargeActCommission({ bidId }) { return { id: 'ch_demo_' + bidId }; },
    async cancelOfferAuthorization({ bidId }) { return { id: 'pi_demo_' + bidId, canceled: true }; },
    constructEvent() { throw new Error('demo mode: no Stripe webhooks'); },
  },
  now: () => new Date().toISOString(),
});

const app = createApp(repo, demoBilling ? { billing: demoBilling, billingConfigured: false } : {});

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
    // CORS on the failure path too: without these headers the browser cannot
    // read the error and the web app misreports a server fault as "offline".
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
  const mode = useDynamo ? `DynamoDB ${process.env.DYNAMO_ENDPOINT || '(regional)'}` : 'in-memory fixtures';
  console.log(`Nota API on http://localhost:${PORT}  [${mode}]`);
});
