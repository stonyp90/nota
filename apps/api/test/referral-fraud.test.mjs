import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
const domain = require('@nota/domain');

// Fraud-hardening for the referral rail (ADR 0011). The program pays real money
// per RETAINED referred demand, so the two economic barriers the ADR leans on
// must actually hold in code:
//   1. "under pay-on-accept a retention authorises real money, so a fake
//      'accepted' demand is not free to stage" — an earning may only accrue on a
//      LIVE (client-paid) demand, never on one still pending authorization;
//   2. the NOTA_DEMO_OPEN escape hatch (which turns any email into an
//      accept-capable notary) must be inert in production.

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const BASE = 'https://nota.example';
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' };
const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

// A fake Stripe covering both the Connect signup and the hosted-Checkout
// authorization surface, so we can run the app with billing ON.
function fakeStripe() {
  return {
    async createConnectAccount({ notaryId }) { return { accountId: 'acct_' + notaryId }; },
    async createOnboardingLink({ accountId }) { return { url: 'https://connect.stripe.test/onboard/' + accountId }; },
    async createOfferAuthorization({ bidId }) { return { sessionId: 'cs_' + bidId, url: 'https://checkout.stripe.test/' + bidId }; },
    constructEvent(raw) { return JSON.parse(raw); },
  };
}

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  const billing = createBilling({ repo, stripe: fakeStripe(), now: () => TODAY });
  const analytics = createAnalytics({ repo, now: () => TODAY });
  return {
    ...createApp(repo, {
      now: () => TODAY,
      nowMs: () => NOW_MS,
      newId: () => 'id-' + ++n,
      notifier,
      billing,
      billingConfigured: true, // pay-on-accept ON: posted offers are pending until paid
      ...opts,
    }),
    repo,
    mailer,
    analytics,
  };
}

const register = (a, body) =>
  a.handle({ method: 'POST', path: '/partenaires', body: JSON.stringify(body) });

// Post a referred demand under billing. It comes back PENDING (the client has
// not authorized their card yet) — exactly the state a fabricated demand sits in.
async function postReferredBid(a, parrain, over = {}) {
  const res = await a.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, courriel: 'client@example.ca', pricing: PRICING, parrain, ...over }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res).bid;
}

async function activeSession(a, email) {
  const existing = await a.repo.getNotary(notaryIdForEmail(email));
  await a.repo.putNotary({ ...(existing || {}), id: notaryIdForEmail(email), email, status: 'active', chargesEnabled: true, connectAccountId: 'acct_x' });
  const res = await a.handle({ method: 'POST', path: '/notary/session', body: JSON.stringify({ email }) });
  assert.equal(res.statusCode, 200, res.body);
  return parse(res).token;
}

const accept = (a, token, bid) =>
  a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });

async function ledgerFor(a, code) {
  const overview = await a.analytics.overview();
  const codes = (overview.parrainages && overview.parrainages.codes) || [];
  return codes.find((r) => r.code === code) || null;
}

// --- Barrier 1: an earning requires a real, paid demand -----------------------

test('a referred demand the client never paid earns NOTHING when retained (billing on)', async () => {
  const a = app();
  await register(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
  const bid = await postReferredBid(a, 'EVEROY'); // pending — no Checkout completed
  const token = await activeSession(a, 'me@notaire.ca');

  assert.equal((await accept(a, token, bid)).statusCode, 200, 'the retain itself still succeeds');
  await flush();

  const row = await ledgerFor(a, 'EVEROY');
  assert.ok(!row || row.du === 0, 'a demand the client never authorized owes the partner nothing');
  const durable = typeof a.repo.listReferralEarnings === 'function' ? await a.repo.listReferralEarnings() : [];
  assert.equal(durable.length, 0, 'no durable earning is written for an unpaid demand');
  assert.equal(a.mailer.sent.filter((m) => m.to === 'eve@courtage.ca' && m.subject.includes(domain.money(domain.REFERRAL.client))).length, 0, 'no reward mail for an unpaid demand');
});

test('a referred demand the client PAID earns the flat client amount when retained (billing on)', async () => {
  const a = app();
  await register(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
  const bid = await postReferredBid(a, 'EVEROY');
  // The client completes hosted Checkout — the webhook binds the PaymentIntent
  // and the demand goes live. This is the real path a genuine referral follows.
  await a.repo.authorizeBid(bid.id, bid.dateISO, { paymentIntentId: 'pi_1', authorizedAt: TODAY });
  const token = await activeSession(a, 'me@notaire.ca');

  assert.equal((await accept(a, token, bid)).statusCode, 200);
  await flush();

  const row = await ledgerFor(a, 'EVEROY');
  assert.ok(row, 'the code appears in the ledger');
  assert.equal(row.du, domain.REFERRAL.client, 'a genuine paid referral owes the flat client amount');
});

test('the notaire track also ignores an unpaid first act (billing on)', async () => {
  const a = app();
  await register(a, { type: 'agent_immobilier', courriel: 'marc@agence.ca', code: 'MARCQC' });
  const id = notaryIdForEmail('ref@notaire.ca');
  await a.repo.putNotary({ id, email: 'ref@notaire.ca', status: 'active', chargesEnabled: true, connectAccountId: 'acct_ref', parrain: 'MARCQC' });
  const token = await activeSession(a, 'ref@notaire.ca');
  const bid = await postReferredBid(a, undefined); // unpaid, no client-track code

  assert.equal((await accept(a, token, bid)).statusCode, 200);
  await flush();

  const profile = await a.repo.getNotary(id);
  assert.notEqual(profile.premierActe, true, 'an unpaid first act does not consume the once-ever notaire reward');
  const row = await ledgerFor(a, 'MARCQC');
  assert.ok(!row || row.du === 0, 'the 250 $ notaire reward is not owed on an unpaid act');
});

// --- Barrier 2: the demo escape hatch is inert in production -------------------

test('NOTA_DEMO_OPEN does NOT open the notary console in production', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevDemo = process.env.NOTA_DEMO_OPEN;
  process.env.NODE_ENV = 'production';
  process.env.NOTA_DEMO_OPEN = 'true';
  try {
    const a = app();
    const res = await a.handle({ method: 'POST', path: '/notary/session', body: JSON.stringify({ email: 'stranger@nowhere.ca' }) });
    assert.equal(res.statusCode, 403, 'an unknown email must not self-activate a notary session in production');
    assert.equal(parse(res).errors[0].code, 'compte_requis');
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevDemo === undefined) delete process.env.NOTA_DEMO_OPEN; else process.env.NOTA_DEMO_OPEN = prevDemo;
  }
});

test('NOTA_DEMO_OPEN still opens the console outside production (demo/dev)', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevDemo = process.env.NOTA_DEMO_OPEN;
  process.env.NODE_ENV = 'development';
  process.env.NOTA_DEMO_OPEN = 'true';
  try {
    const a = app();
    const res = await a.handle({ method: 'POST', path: '/notary/session', body: JSON.stringify({ email: 'demo@guest.ca' }) });
    assert.equal(res.statusCode, 200, 'the demo hatch still works where it is meant to');
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevDemo === undefined) delete process.env.NOTA_DEMO_OPEN; else process.env.NOTA_DEMO_OPEN = prevDemo;
  }
});
