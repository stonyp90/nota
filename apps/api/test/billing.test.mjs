import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling, NOTARY_STATUS } = require('../src/billing.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');

const NOW = '2026-08-12T00:00:00.000Z';
const NOW_MS = 1_760_000_000_000;
const TODAY = '2026-08-12';
const RATE = 0.10;

/**
 * A plain fake Stripe adapter — implements the same surface as
 * src/stripe-port.js with no SDK and no network. `constructEvent` treats the
 * raw body as the JSON event and rejects the signature literal 'bad'.
 */
function fakeStripe() {
  const calls = { accounts: [], links: [], charges: [], authorizations: [], transfers: [] };
  return {
    calls,
    async createConnectAccount(args) { calls.accounts.push(args); return { accountId: 'acct_' + args.notaryId }; },
    async createOnboardingLink(args) { calls.links.push(args); return { url: 'https://connect.stripe.test/onboard/' + args.accountId }; },
    async chargeActCommission(args) { calls.charges.push(args); return { id: 'pi_' + (args.bidId || 'x'), applicationFeeCents: args.applicationFeeCents }; },
    async createOfferAuthorization(args) { calls.authorizations.push(args); return { sessionId: 'cs_' + (args.bidId || 'x'), url: 'https://checkout.stripe.test/pay/' + (args.bidId || 'x') }; },
    async captureAndTransfer(args) { calls.transfers.push(args); return { paymentIntentId: args.paymentIntentId, chargeId: 'ch_' + (args.bidId || 'x'), transferId: 'tr_' + (args.bidId || 'x'), applicationFeeCents: args.applicationFeeCents, netCents: args.amountCents - args.applicationFeeCents }; },
    constructEvent(rawBody, signature) {
      if (signature === 'bad' || !signature) throw new Error('signature verification failed');
      return JSON.parse(rawBody);
    },
  };
}

function setup() {
  const repo = createMemoryRepo();
  const stripe = fakeStripe();
  let n = 0;
  const billing = createBilling({
    repo, stripe,
    newId: () => 'n-' + ++n,
    now: () => NOW,
    commissionRate: RATE,
    onboardingReturnUrl: 'https://nota.test/notaires?ok=1',
    onboardingRefreshUrl: 'https://nota.test/notaires?refresh=1',
  });
  const app = createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'x', billing });
  return { repo, stripe, billing, app };
}

const parse = (res) => JSON.parse(res.body);
const accountUpdated = (id, notaryId, chargesEnabled) => ({
  id, type: 'account.updated',
  data: { object: { charges_enabled: chargesEnabled, metadata: { notaryId } } },
});

// --- onboarding (free) --------------------------------------------------------

test('connectNotary opens a Connect onboarding link and records an ONBOARDING notary', async () => {
  const { repo, stripe, billing } = setup();
  const res = await billing.connectNotary({ email: 'Notaire@Example.CA' });

  assert.equal(res.ok, true);
  assert.match(res.url, /^https:\/\/connect\.stripe\.test\/onboard\/acct_n-1$/);
  assert.equal(stripe.calls.accounts[0].email, 'notaire@example.ca');
  assert.equal(stripe.calls.accounts[0].notaryId, 'n-1');

  const notary = await repo.getNotary('n-1');
  assert.equal(notary.status, NOTARY_STATUS.ONBOARDING);
  assert.equal(notary.email, 'notaire@example.ca');
  assert.equal(notary.connectAccountId, 'acct_n-1');
  assert.equal(notary.chargesEnabled, false);
});

test('connectNotary rejects an invalid email and records nothing', async () => {
  const { repo, stripe, billing } = setup();
  const res = await billing.connectNotary({ email: 'not-an-email' });
  assert.equal(res.ok, false);
  assert.equal(res.errors[0].code, 'courriel_invalide');
  assert.equal(stripe.calls.accounts.length, 0);
  assert.equal(await repo.getNotary('n-1'), null);
});

test('account.updated (charges enabled) marks the notary ACTIVE; a redelivery is ignored', async () => {
  const { repo, billing } = setup();
  await billing.connectNotary({ email: 'notaire@example.ca' }); // -> n-1, onboarding

  const raw = JSON.stringify(accountUpdated('evt_1', 'n-1', true));
  const r1 = await billing.handleWebhook(raw, 'good');
  assert.equal(r1.ok, true);
  assert.equal(r1.handled, true);

  let notary = await repo.getNotary('n-1');
  assert.equal(notary.status, NOTARY_STATUS.ACTIVE);
  assert.equal(notary.chargesEnabled, true);

  // Idempotency: flip state, redeliver SAME id -> no-op, manual change survives.
  await repo.putNotary({ ...notary, status: NOTARY_STATUS.RESTRICTED });
  const r2 = await billing.handleWebhook(raw, 'good');
  assert.equal(r2.duplicate, true);
  notary = await repo.getNotary('n-1');
  assert.equal(notary.status, NOTARY_STATUS.RESTRICTED);
});

// --- commission on a completed act -------------------------------------------

test('completeAct charges the commission (application fee = rate × value) and tallies it', async () => {
  const { repo, stripe, billing } = setup();
  await billing.connectNotary({ email: 'notaire@example.ca' }); // n-1
  await billing.handleWebhook(JSON.stringify(accountUpdated('evt_a', 'n-1', true)), 'good'); // -> active

  const res = await billing.completeAct({ notaryId: 'n-1', bidId: 'BID#1', actAmount: 2000 });
  assert.equal(res.ok, true);
  assert.equal(res.commissionCents, Math.round(2000 * 100 * RATE)); // 20000

  // The destination charge carried the act value + our application fee.
  const charge = stripe.calls.charges[0];
  assert.equal(charge.connectAccountId, 'acct_n-1');
  assert.equal(charge.amountCents, 200000);
  assert.equal(charge.applicationFeeCents, 20000);

  const notary = await repo.getNotary('n-1');
  assert.equal(notary.commissionCentsCollected, 20000);
});

test('completeAct refuses a notary that has not finished onboarding, and a bad amount', async () => {
  const { billing } = setup();
  await billing.connectNotary({ email: 'notaire@example.ca' }); // n-1 still ONBOARDING

  const notReady = await billing.completeAct({ notaryId: 'n-1', bidId: 'b', actAmount: 900 });
  assert.equal(notReady.ok, false);
  assert.equal(notReady.errors[0].code, 'compte_incomplet');

  await billing.handleWebhook(JSON.stringify(accountUpdated('e', 'n-1', true)), 'good'); // active
  const badAmount = await billing.completeAct({ notaryId: 'n-1', bidId: 'b', actAmount: 0 });
  assert.equal(badAmount.ok, false);
  assert.equal(badAmount.errors[0].code, 'montant_invalide');

  const noNotary = await billing.completeAct({ notaryId: 'nope', bidId: 'b', actAmount: 900 });
  assert.equal(noNotary.errors[0].code, 'notaire_introuvable');
});

test('an unknown event type is ignored, not fatal', async () => {
  const { billing } = setup();
  const res = await billing.handleWebhook(JSON.stringify({ id: 'evt_x', type: 'charge.refunded', data: { object: {} } }), 'good');
  assert.equal(res.ok, true);
  assert.equal(res.handled, false);
});

// --- routes through createApp -------------------------------------------------

test('POST /notaries/connect returns 200 {url}', async () => {
  const { app } = setup();
  const res = await app.handle({ method: 'POST', path: '/notaries/connect', body: JSON.stringify({ email: 'notaire@example.ca' }) });
  assert.equal(res.statusCode, 200);
  assert.match(parse(res).url, /^https:\/\/connect\.stripe\.test\//);
});

test('POST /notaries/connect returns 422 {errors} on an invalid email', async () => {
  const { app } = setup();
  const res = await app.handle({ method: 'POST', path: '/notaries/connect', body: JSON.stringify({ email: 'nope' }) });
  assert.equal(res.statusCode, 422);
  assert.equal(parse(res).errors[0].code, 'courriel_invalide');
});

test('POST /notary/acts/complete requires a session token and charges the commission', async () => {
  const { repo, app } = setup();
  // 401 without a token.
  assert.equal((await app.handle({ method: 'POST', path: '/notary/acts/complete', body: '{}' })).statusCode, 401);

  // Seed an ACTIVE, charge-ready notary and sign in for a real session token.
  const email = 'a@notaire.ca';
  const id = notaryIdForEmail(email);
  await repo.putNotary({ id, email, status: 'active', chargesEnabled: true, connectAccountId: 'acct_x', commissionCentsCollected: 0 });
  const sess = parse(await app.handle({ method: 'POST', path: '/notary/session', body: JSON.stringify({ email }) }));

  const res = await app.handle({
    method: 'POST', path: '/notary/acts/complete',
    headers: { authorization: 'Bearer ' + sess.token },
    body: JSON.stringify({ bidId: 'BID#9', actAmount: 1500 }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).commissionCents, Math.round(1500 * 100 * RATE)); // 15000
});

test('POST /stripe/webhook returns 200 {received:true} on a good signature', async () => {
  const { app } = setup();
  const res = await app.handle({
    method: 'POST', path: '/stripe/webhook',
    headers: { 'stripe-signature': 'good' },
    body: JSON.stringify(accountUpdated('evt_route', 'n-1', true)),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).received, true);
});

test('POST /stripe/webhook returns 400 when signature verification throws', async () => {
  const { app } = setup();
  const res = await app.handle({
    method: 'POST', path: '/stripe/webhook',
    headers: { 'stripe-signature': 'bad' },
    body: JSON.stringify(accountUpdated('evt_bad', 'n-1', true)),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(parse(res).errors[0].code, 'signature_invalide');
});

// --- model guardrails ---------------------------------------------------------

// --- EDGE CASES (logic) — commission math + boundaries -----------------------

async function activeBilling(rate) {
  const repo = createMemoryRepo();
  const stripe = fakeStripe();
  const billing = createBilling({ repo, stripe, newId: () => 'n-1', now: () => NOW, commissionRate: rate });
  await billing.connectNotary({ email: 'e@x.ca' });
  await billing.handleWebhook(JSON.stringify(accountUpdated('a', 'n-1', true)), 'good');
  return { repo, stripe, billing };
}

test('EDGE (logic): a fractional-cent commission rounds to the nearest cent', async () => {
  const { billing } = await activeBilling(RATE);
  // 999.99 × 100 × 0.10 = 9999.9 -> 10000
  const r = await billing.completeAct({ notaryId: 'n-1', bidId: 'b1', actAmount: 999.99 });
  assert.equal(r.commissionCents, 10000);
});

test('EDGE (logic): a very large act value does not overflow the fee', async () => {
  const { billing } = await activeBilling(RATE);
  const r = await billing.completeAct({ notaryId: 'n-1', bidId: 'big', actAmount: 1_000_000 });
  assert.equal(r.commissionCents, 10_000_000); // 1e6 × 100 × 0.10
});

test('EDGE (logic): a custom commission rate is honored end-to-end', async () => {
  const { billing, stripe } = await activeBilling(0.15);
  const r = await billing.completeAct({ notaryId: 'n-1', bidId: 'b', actAmount: 2000 });
  assert.equal(r.commissionCents, Math.round(2000 * 100 * 0.15)); // 30000
  assert.equal(stripe.calls.charges[0].applicationFeeCents, 30000);
});

test('EDGE (logic): re-completing the SAME bid is idempotent — exactly one charge, one tally', async () => {
  const { repo, billing, stripe } = await activeBilling(RATE);
  const first = await billing.completeAct({ notaryId: 'n-1', bidId: 'dup', actAmount: 1000 });
  const second = await billing.completeAct({ notaryId: 'n-1', bidId: 'dup', actAmount: 1000 });

  // The write-once ACT ledger must short-circuit the second call BEFORE Stripe.
  assert.equal(stripe.calls.charges.length, 1); // never charged twice
  assert.equal(second.alreadyCompleted, true);
  assert.equal(second.commissionCents, first.commissionCents);
  assert.equal(second.chargeId, first.chargeId);

  // And the commission is tallied exactly once on the notary.
  const notary = await repo.getNotary('n-1');
  assert.equal(notary.commissionCentsCollected, first.commissionCents);
});

// --- PAY-ON-ACCEPT: authorize at post, capture + pay the notary on accept ----

const checkoutCompleted = (id, bidId, bidDate, pi) => ({
  id, type: 'checkout.session.completed',
  data: { object: { payment_intent: pi, metadata: { bidId, bidDate } } },
});
const checkoutExpired = (id, bidId, bidDate) => ({
  id, type: 'checkout.session.expired',
  data: { object: { metadata: { bidId, bidDate } } },
});
const DEFAULT_PRICING = { testament: { who_for: 'solo', fiducie_needed: 'non' } };

test('authorizeOffer opens a hosted Checkout to authorize the client card', async () => {
  const { stripe, billing } = setup();
  const res = await billing.authorizeOffer({ bidId: 'BID#1', bidDate: '2026-09-01', amountCents: 90000, email: 'c@x.ca' });
  assert.equal(res.ok, true);
  assert.match(res.url, /^https:\/\/checkout\.stripe\.test\//);
  assert.equal(stripe.calls.authorizations[0].amountCents, 90000);
  assert.equal(stripe.calls.authorizations[0].bidId, 'BID#1');

  const bad = await billing.authorizeOffer({ bidId: 'x', amountCents: 0 });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].code, 'montant_invalide');
});

test('checkout.session.completed binds the PaymentIntent to the bid and makes it live', async () => {
  const { repo, billing } = setup();
  await repo.put({ id: 'BID#1', dateISO: '2026-09-01', serviceId: 'testament', montant: 900, status: 'ouverte', paymentStatus: 'pending' });
  const r = await billing.handleWebhook(JSON.stringify(checkoutCompleted('evt_c1', 'BID#1', '2026-09-01', 'pi_1')), 'good');
  assert.equal(r.ok, true);
  assert.equal(r.handled, true);
  const bid = await repo.get('BID#1', '2026-09-01');
  assert.equal(bid.paymentStatus, 'authorized');
  assert.equal(bid.paymentIntentId, 'pi_1');
});

test('checkout.session.expired voids a never-accepted authorization', async () => {
  const { repo, billing } = setup();
  await repo.put({ id: 'BID#2', dateISO: '2026-09-01', serviceId: 'testament', montant: 900, status: 'ouverte', paymentStatus: 'pending' });
  const r = await billing.handleWebhook(JSON.stringify(checkoutExpired('evt_e1', 'BID#2', '2026-09-01')), 'good');
  assert.equal(r.handled, true);
  assert.equal((await repo.get('BID#2', '2026-09-01')).paymentStatus, 'void');
});

test('payNotaryOnAccept captures the hold, transfers the net, keeps the commission, and is idempotent', async () => {
  const { repo, stripe, billing } = setup();
  await billing.connectNotary({ email: 'n@x.ca' }); // n-1
  await billing.handleWebhook(JSON.stringify(accountUpdated('e', 'n-1', true)), 'good'); // -> active

  const res = await billing.payNotaryOnAccept({ notaryId: 'n-1', bidId: 'BID#7', actAmount: 2000, paymentIntentId: 'pi_7' });
  assert.equal(res.ok, true);
  assert.equal(res.commissionCents, 20000); // 10% of 2000$
  assert.equal(res.netCents, 180000);       // 200000 - 20000
  const t = stripe.calls.transfers[0];
  assert.equal(t.paymentIntentId, 'pi_7');
  assert.equal(t.connectAccountId, 'acct_n-1');
  assert.equal(t.amountCents, 200000);
  assert.equal(t.applicationFeeCents, 20000);
  assert.equal((await repo.getNotary('n-1')).commissionCentsCollected, 20000);

  // Idempotent: a second accept for the same bid never transfers again.
  const again = await billing.payNotaryOnAccept({ notaryId: 'n-1', bidId: 'BID#7', actAmount: 2000, paymentIntentId: 'pi_7' });
  assert.equal(again.alreadyPaid, true);
  assert.equal(stripe.calls.transfers.length, 1);
});

test('payNotaryOnAccept refuses a not-ready notary and a missing authorization', async () => {
  const { billing } = setup();
  await billing.connectNotary({ email: 'n@x.ca' }); // onboarding, not charge-ready
  const notReady = await billing.payNotaryOnAccept({ notaryId: 'n-1', bidId: 'b', actAmount: 900, paymentIntentId: 'pi' });
  assert.equal(notReady.errors[0].code, 'compte_incomplet');

  await billing.handleWebhook(JSON.stringify(accountUpdated('e', 'n-1', true)), 'good');
  const noPay = await billing.payNotaryOnAccept({ notaryId: 'n-1', bidId: 'b', actAmount: 900 });
  assert.equal(noPay.errors[0].code, 'paiement_absent');
});

test('end-to-end: post → pending (hidden) → authorize → accept pays the notary in full', async () => {
  const { repo, stripe, app } = setup();

  // 1) Post an offer — PENDING, returns a Checkout URL, hidden from the carnet.
  const posted = parse(await app.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'testament', dateISO: '2026-08-20', montant: 700, prefixe: 'G1R', pricing: DEFAULT_PRICING.testament }),
  }));
  assert.equal(posted.paymentStatus, 'pending');
  assert.match(posted.checkoutUrl, /^https:\/\/checkout\.stripe\.test\//);
  assert.equal(stripe.calls.authorizations.length, 1);
  let feed = parse(await app.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } }));
  assert.equal(feed.bids.length, 0, 'a pending offer must not appear on the public carnet');

  // 2) Client authorizes their card — webhook binds the PaymentIntent, offer goes live.
  await app.handle({
    method: 'POST', path: '/stripe/webhook', headers: { 'stripe-signature': 'good' },
    body: JSON.stringify(checkoutCompleted('evt_live', 'x', '2026-08-20', 'pi_x')),
  });
  feed = parse(await app.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } }));
  assert.equal(feed.bids.length, 1);
  const montant = feed.bids[0].montant;

  // 3) A charge-ready notary signs in and accepts → paid in full, net of commission.
  const email = 'a@notaire.ca';
  const id = notaryIdForEmail(email);
  await repo.putNotary({ id, email, status: 'active', chargesEnabled: true, connectAccountId: 'acct_x', commissionCentsCollected: 0 });
  const sess = parse(await app.handle({ method: 'POST', path: '/notary/session', body: JSON.stringify({ email }) }));
  const acc = parse(await app.handle({
    method: 'POST', path: '/notary/bids/accept',
    headers: { authorization: 'Bearer ' + sess.token },
    body: JSON.stringify({ id: 'x', dateISO: '2026-08-20' }),
  }));
  const cents = Math.round(montant * 100);
  const fee = Math.round(montant * 100 * RATE);
  assert.equal(acc.paid, true);
  assert.equal(acc.commissionCents, fee);
  assert.equal(acc.netCents, cents - fee);
  assert.equal(stripe.calls.transfers.length, 1);
  assert.equal(stripe.calls.transfers[0].paymentIntentId, 'pi_x');
  assert.equal(stripe.calls.transfers[0].amountCents, cents);
});

test('the commission lives ONLY in billing — the @nota/domain module stays free of it', () => {
  // The platform commission is a billing concern. The domain (pricing, tiers,
  // validation) must never express a share of an acte, so the déontologie
  // boundary stays clean where the notarial math happens.
  const forbidden = /commission|percentage|per[-_ ]?cent|application[_ ]?fee|ristourne/i;
  const domainSrc = readFileSync(new URL('../../../packages/domain/index.js', import.meta.url), 'utf8');
  assert.ok(!forbidden.test(domainSrc), '@nota/domain must not express a commission concept');

  // The billing layer DOES model a commission now (owner decision, 2026-08-14).
  const billing = createBilling({ repo: createMemoryRepo(), stripe: fakeStripe(), commissionRate: RATE });
  assert.equal(typeof billing.completeAct, 'function');
  assert.equal(billing.commissionRate, RATE);
});
