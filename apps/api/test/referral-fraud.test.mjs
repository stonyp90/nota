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
import { notarySignIn } from '../test-support/notary-session.mjs';
import { claimPartner } from '../test-support/partner-claim.mjs';
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
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' };
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
      // Le chemin PAYANT exige une origine de retour : sans elle, Stripe n'a
      // pas où renvoyer le client, et `POST /bids` refuse franchement.
      siteUrl: 'https://nota.test',
      now: () => TODAY,
      nowMs: () => NOW_MS,
      // Un hôte configuré : sans lui, les portes qui envoient un lien refusent
      // désormais de le faire (configuration-liens.test.mjs). Ces scénarios-ci
      // portent sur la fraude au parrainage, pas sur la configuration.
      notaryConsoleUrl: BASE,
      partnerClaimUrl: BASE,
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

// Post a referred demand under billing. It comes back PENDING (the client has
// not authorized their card yet) — exactly the state a fabricated demand sits in.
async function postReferredBid(a, parrain, over = {}) {
  const res = await a.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, courriel: 'client@example.ca', prefixe: 'G1R', pricing: PRICING, parrain, ...over }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res).bid;
}

async function activeSession(a, email) {
  const existing = await a.repo.getNotary(notaryIdForEmail(email));
  await a.repo.putNotary({ ...(existing || {}), id: notaryIdForEmail(email), email, status: 'active', chargesEnabled: true, connectAccountId: 'acct_x' });
  return (await notarySignIn(a, email)).token;
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
  await claimPartner(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
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
  await claimPartner(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
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
  await claimPartner(a, { type: 'agent_immobilier', courriel: 'marc@agence.ca', code: 'MARCQC' });
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

test("a VOIDED demand (paymentStatus 'void' — the canonical repo value) earns no reward mail", async () => {
  // Regression: the notifier's live-demand barrier once checked 'voided' while
  // the repo writes 'void' (markAuthorizationVoided) — a lapsed/cancelled hold
  // would still have mailed the partner a payout instruction.
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  await repo.createPartner({ code: 'EVEROY', type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', confirmedAt: TODAY });

  const bid = (over) => ({
    id: 'b-void', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800,
    tier: 'rapide', status: 'retenue', parrain: 'EVEROY', courriel: null, ...over,
  });

  await notifier.onOfferRetained(bid({ paymentStatus: 'void' }));
  assert.equal(
    mailer.sent.filter((m) => m.to === 'eve@courtage.ca').length, 0,
    "a bid whose authorization was voided must never mail a reward"
  );

  // Sanity: the same demand with a live payment DOES mail the reward once.
  await notifier.onOfferRetained(bid({ id: 'b-live', paymentStatus: 'authorized' }));
  assert.equal(mailer.sent.filter((m) => m.to === 'eve@courtage.ca').length, 1);
});

// --- Barrier 2: the demo escape hatch is inert in production -------------------

test('NOTA_DEMO_OPEN does NOT open the notary console in production', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevDemo = process.env.NOTA_DEMO_OPEN;
  process.env.NODE_ENV = 'production';
  process.env.NOTA_DEMO_OPEN = 'true';
  try {
    const a = app();
    const res = await a.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email: 'stranger@nowhere.ca' }) });
    // The request is enumeration-safe: a stranger gets the SAME generic ok as a
    // notary — but in production NOTA_DEMO_OPEN is inert, so NO challenge is
    // minted and NO usable link (devToken) is handed back. Nothing to redeem.
    assert.equal(res.statusCode, 200, 'the request stays generic, never a 403 that would enumerate');
    const body = parse(res);
    assert.equal(body.ok, true);
    assert.equal(body.devToken, undefined, 'an unknown email must not self-activate a notary session in production');
    assert.equal(body.devLink, undefined);
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
    const body = await notarySignIn(a, 'demo@guest.ca');
    assert.ok(body.token, 'the demo hatch still works where it is meant to');
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevDemo === undefined) delete process.env.NOTA_DEMO_OPEN; else process.env.NOTA_DEMO_OPEN = prevDemo;
  }
});
