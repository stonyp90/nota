import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling, NOTARY_STATUS } = require('../src/billing.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
import { notarySignIn } from '../test-support/notary-session.mjs';

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
  const calls = { accounts: [], links: [], charges: [], authorizations: [], transfers: [], cancels: [] };
  return {
    calls,
    async createConnectAccount(args) { calls.accounts.push(args); return { accountId: 'acct_' + args.notaryId }; },
    async createOnboardingLink(args) { calls.links.push(args); return { url: 'https://connect.stripe.test/onboard/' + args.accountId }; },
    async chargeActCommission(args) { calls.charges.push(args); return { id: 'pi_' + (args.bidId || 'x'), applicationFeeCents: args.applicationFeeCents }; },
    async createOfferAuthorization(args) { calls.authorizations.push(args); return { sessionId: 'cs_' + (args.bidId || 'x'), url: 'https://checkout.stripe.test/pay/' + (args.bidId || 'x') }; },
    async captureAndTransfer(args) { calls.transfers.push(args); return { paymentIntentId: args.paymentIntentId, chargeId: 'ch_' + (args.bidId || 'x'), transferId: 'tr_' + (args.bidId || 'x'), applicationFeeCents: args.applicationFeeCents, netCents: args.amountCents - args.applicationFeeCents }; },
    async cancelOfferAuthorization(args) { calls.cancels.push(args); return { id: args.paymentIntentId, status: 'canceled' }; },
    constructEvent(rawBody, signature) {
      if (signature === 'bad' || !signature) throw new Error('signature verification failed');
      return JSON.parse(rawBody);
    },
  };
}

// The billing identity for an email — ONE id shared with /notary/session, so
// Connect activation actually opens the console gate.
const NID = (email) => notaryIdForEmail(email);

function setup() {
  const repo = createMemoryRepo();
  const stripe = fakeStripe();
  const billing = createBilling({
    repo, stripe,
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

test('connectNotary opens a Connect onboarding link and records an ONBOARDING notary under the SESSION id', async () => {
  const { repo, stripe, billing } = setup();
  const res = await billing.connectNotary({ email: 'Notaire@Example.CA' });
  const id = NID('notaire@example.ca');

  assert.equal(res.ok, true);
  assert.equal(res.url, 'https://connect.stripe.test/onboard/acct_' + id);
  assert.equal(stripe.calls.accounts[0].email, 'notaire@example.ca');
  // The id stamped on the Connect account IS notaryIdForEmail(email): the
  // account.updated webhook must activate the record /notary/session reads.
  assert.equal(stripe.calls.accounts[0].notaryId, id);

  const notary = await repo.getNotary(id);
  assert.equal(notary.status, NOTARY_STATUS.ONBOARDING);
  assert.equal(notary.email, 'notaire@example.ca');
  assert.equal(notary.connectAccountId, 'acct_' + id);
  assert.equal(notary.chargesEnabled, false);
});

test('connectNotary rejects an invalid email and records nothing', async () => {
  const { repo, stripe, billing } = setup();
  const res = await billing.connectNotary({ email: 'not-an-email' });
  assert.equal(res.ok, false);
  assert.equal(res.errors[0].code, 'courriel_invalide');
  assert.equal(stripe.calls.accounts.length, 0);
  assert.equal(await repo.getNotary(NID('not-an-email')), null);
});

test('re-connect for the same email reuses the Connect account and never resets the record', async () => {
  const { repo, stripe, billing } = setup();
  const id = NID('notaire@example.ca');
  await billing.connectNotary({ email: 'notaire@example.ca', parrain: 'EVEROY' });
  await billing.handleWebhook(JSON.stringify(accountUpdated('evt_up', id, true)), 'good'); // -> ACTIVE
  await repo.putNotary({ ...(await repo.getNotary(id)), commissionCentsCollected: 12345 });

  // Lost tab / double submit: a second connect returns a FRESH link for the
  // SAME account — no second Stripe account, no status/accumulator reset, and
  // first-touch referral attribution is preserved.
  const again = await billing.connectNotary({ email: 'notaire@example.ca', parrain: 'OTHERCODE' });
  assert.equal(again.ok, true);
  assert.equal(stripe.calls.accounts.length, 1, 'must not create a second Connect account');
  assert.equal(stripe.calls.links.length, 2);

  const notary = await repo.getNotary(id);
  assert.equal(notary.status, NOTARY_STATUS.ACTIVE);
  assert.equal(notary.chargesEnabled, true);
  assert.equal(notary.commissionCentsCollected, 12345);
  assert.equal(notary.parrain, 'EVEROY');
});

test('account.updated (charges enabled) marks the notary ACTIVE; a redelivery is ignored', async () => {
  const { repo, billing } = setup();
  const id = NID('notaire@example.ca');
  await billing.connectNotary({ email: 'notaire@example.ca' }); // onboarding

  const raw = JSON.stringify(accountUpdated('evt_1', id, true));
  const r1 = await billing.handleWebhook(raw, 'good');
  assert.equal(r1.ok, true);
  assert.equal(r1.handled, true);

  let notary = await repo.getNotary(id);
  assert.equal(notary.status, NOTARY_STATUS.ACTIVE);
  assert.equal(notary.chargesEnabled, true);

  // Idempotency: flip state, redeliver SAME id -> no-op, manual change survives.
  await repo.putNotary({ ...notary, status: NOTARY_STATUS.RESTRICTED });
  const r2 = await billing.handleWebhook(raw, 'good');
  assert.equal(r2.duplicate, true);
  notary = await repo.getNotary(id);
  assert.equal(notary.status, NOTARY_STATUS.RESTRICTED);
});

test('GATING CONSISTENCY: free Connect onboarding then activation opens the sign-in gate', async () => {
  const { app, stripe } = setup();
  const email = 'nouveau@notaire.ca';

  // 1) Sign-up via the public route.
  const connect = await app.handle({ method: 'POST', path: '/notaries/connect', body: JSON.stringify({ email }) });
  assert.equal(connect.statusCode, 200);

  // 2) Before activation the console gate stays closed: the request is
  //    enumeration-safe (generic ok) but mints NO usable link (no devToken), so
  //    there is nothing to redeem into a session.
  const early = await app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email }) });
  assert.equal(early.statusCode, 200);
  assert.equal(parse(early).devToken, undefined);

  // 3) Stripe reports charges enabled for the account created at signup — the
  //    metadata id comes from the REAL account creation call.
  const notaryId = stripe.calls.accounts[0].notaryId;
  await app.handle({
    method: 'POST', path: '/stripe/webhook', headers: { 'stripe-signature': 'good' },
    body: JSON.stringify(accountUpdated('evt_gate', notaryId, true)),
  });

  // 4) The SAME email now signs in: the activation landed on the record the
  //    session lookup reads (one identity, no orphaned billing record).
  const sess = await notarySignIn(app, email);
  assert.ok(sess.token);
});

// --- commission on a completed act -------------------------------------------

test('completeAct charges the commission (application fee = rate × value) and tallies it', async () => {
  const { repo, stripe, billing } = setup();
  const id = NID('notaire@example.ca');
  await billing.connectNotary({ email: 'notaire@example.ca' });
  await billing.handleWebhook(JSON.stringify(accountUpdated('evt_a', id, true)), 'good'); // -> active

  const res = await billing.completeAct({ notaryId: id, bidId: 'BID#1', actAmount: 2000 });
  assert.equal(res.ok, true);
  assert.equal(res.commissionCents, Math.round(2000 * 100 * RATE)); // 20000

  // The destination charge carried the act value + our application fee.
  const charge = stripe.calls.charges[0];
  assert.equal(charge.connectAccountId, 'acct_' + id);
  assert.equal(charge.amountCents, 200000);
  assert.equal(charge.applicationFeeCents, 20000);

  const notary = await repo.getNotary(id);
  assert.equal(notary.commissionCentsCollected, 20000);
});

test('completeAct refuses a notary that has not finished onboarding, and a bad amount', async () => {
  const { billing } = setup();
  const id = NID('notaire@example.ca');
  await billing.connectNotary({ email: 'notaire@example.ca' }); // still ONBOARDING

  const notReady = await billing.completeAct({ notaryId: id, bidId: 'b', actAmount: 900 });
  assert.equal(notReady.ok, false);
  assert.equal(notReady.errors[0].code, 'compte_incomplet');

  await billing.handleWebhook(JSON.stringify(accountUpdated('e', id, true)), 'good'); // active
  const badAmount = await billing.completeAct({ notaryId: id, bidId: 'b', actAmount: 0 });
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

test('POST /notary/acts/complete: session-gated, verifies bid ownership, then charges the commission', async () => {
  const { repo, app } = setup();
  // 401 without a token.
  assert.equal((await app.handle({ method: 'POST', path: '/notary/acts/complete', body: '{}' })).statusCode, 401);

  // Seed an ACTIVE, charge-ready notary and sign in for a real session token.
  const email = 'a@notaire.ca';
  const id = notaryIdForEmail(email);
  await repo.putNotary({ id, email, status: 'active', chargesEnabled: true, connectAccountId: 'acct_x', commissionCentsCollected: 0 });
  const sess = await notarySignIn(app, email);
  const auth = { authorization: 'Bearer ' + sess.token };

  // SECURITY: a bid this notary did NOT retain is rejected (no ledger poisoning).
  await repo.put({ id: 'BID#9', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 1500, status: 'ouverte', notaryId: null });
  const stranger = await app.handle({
    method: 'POST', path: '/notary/acts/complete', headers: auth,
    body: JSON.stringify({ bidId: 'BID#9', dateISO: '2026-08-20', actAmount: 1500 }),
  });
  assert.equal(stranger.statusCode, 403);
  assert.equal(await repo.getActCompletion('BID#9'), null); // the shared act ledger stays untouched

  // Once this notary has retained it, completing charges the commission.
  await repo.put({ id: 'BID#9', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 1500, status: 'retenue', notaryId: id });
  const res = await app.handle({
    method: 'POST', path: '/notary/acts/complete', headers: auth,
    body: JSON.stringify({ bidId: 'BID#9', dateISO: '2026-08-20', actAmount: 1500 }),
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

const EDGE_ID = NID('e@x.ca');
async function activeBilling(rate) {
  const repo = createMemoryRepo();
  const stripe = fakeStripe();
  const billing = createBilling({ repo, stripe, now: () => NOW, commissionRate: rate });
  await billing.connectNotary({ email: 'e@x.ca' });
  await billing.handleWebhook(JSON.stringify(accountUpdated('a', EDGE_ID, true)), 'good');
  return { repo, stripe, billing };
}

test('EDGE (logic): a fractional-cent commission rounds to the nearest cent', async () => {
  const { billing } = await activeBilling(RATE);
  // 999.99 × 100 × 0.10 = 9999.9 -> 10000
  const r = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'b1', actAmount: 999.99 });
  assert.equal(r.commissionCents, 10000);
});

test('EDGE (logic): a very large act value does not overflow the fee', async () => {
  const { billing } = await activeBilling(RATE);
  const r = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'big', actAmount: 1_000_000 });
  assert.equal(r.commissionCents, 10_000_000); // 1e6 × 100 × 0.10
});

test('EDGE (logic): a custom commission rate is honored end-to-end', async () => {
  const { billing, stripe } = await activeBilling(0.15);
  const r = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'b', actAmount: 2000 });
  assert.equal(r.commissionCents, Math.round(2000 * 100 * 0.15)); // 30000
  assert.equal(stripe.calls.charges[0].applicationFeeCents, 30000);
});

test('EDGE (logic): re-completing the SAME bid is idempotent — exactly one charge, one tally', async () => {
  const { repo, billing, stripe } = await activeBilling(RATE);
  const first = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'dup', actAmount: 1000 });
  const second = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'dup', actAmount: 1000 });

  // The write-once ACT ledger must short-circuit the second call BEFORE Stripe.
  assert.equal(stripe.calls.charges.length, 1); // never charged twice
  assert.equal(second.alreadyCompleted, true);
  assert.equal(second.commissionCents, first.commissionCents);
  assert.equal(second.chargeId, first.chargeId);

  // And the commission is tallied exactly once on the notary.
  const notary = await repo.getNotary(EDGE_ID);
  assert.equal(notary.commissionCentsCollected, first.commissionCents);
});

test('completeAct surfaces a Stripe failure as a typed, retryable error — never an unhandled throw', async () => {
  const { repo, stripe, billing } = await activeBilling(RATE);
  stripe.chargeActCommission = async () => { throw new Error('card_declined'); };

  const r = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'BID#F', actAmount: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'paiement_echoue');
  // Nothing written: the ledger stays clean so a retry starts from scratch.
  assert.equal(await repo.getActCompletion('BID#F'), null);
  assert.equal((await repo.getNotary(EDGE_ID)).commissionCentsCollected, 0);
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
// Zero-add refinancement answers: the dynamic base stays at the flat 2000 $.
const DEFAULT_PRICING = { refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale' } };

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
  await repo.put({ id: 'BID#1', dateISO: '2026-09-01', serviceId: 'refinancement', montant: 900, status: 'ouverte', paymentStatus: 'pending' });
  const r = await billing.handleWebhook(JSON.stringify(checkoutCompleted('evt_c1', 'BID#1', '2026-09-01', 'pi_1')), 'good');
  assert.equal(r.ok, true);
  assert.equal(r.handled, true);
  const bid = await repo.get('BID#1', '2026-09-01');
  assert.equal(bid.paymentStatus, 'authorized');
  assert.equal(bid.paymentIntentId, 'pi_1');
});

test('checkout.session.expired voids a never-accepted authorization', async () => {
  const { repo, billing } = setup();
  await repo.put({ id: 'BID#2', dateISO: '2026-09-01', serviceId: 'refinancement', montant: 900, status: 'ouverte', paymentStatus: 'pending' });
  const r = await billing.handleWebhook(JSON.stringify(checkoutExpired('evt_e1', 'BID#2', '2026-09-01')), 'good');
  assert.equal(r.handled, true);
  assert.equal((await repo.get('BID#2', '2026-09-01')).paymentStatus, 'void');
});

test('payNotaryOnAccept captures the hold, transfers the net, keeps the commission, and is idempotent', async () => {
  const { repo, stripe, billing } = setup();
  const id = NID('n@x.ca');
  await billing.connectNotary({ email: 'n@x.ca' });
  await billing.handleWebhook(JSON.stringify(accountUpdated('e', id, true)), 'good'); // -> active

  const res = await billing.payNotaryOnAccept({ notaryId: id, bidId: 'BID#7', actAmount: 2000, paymentIntentId: 'pi_7' });
  assert.equal(res.ok, true);
  assert.equal(res.commissionCents, 20000); // 10% of 2000$
  assert.equal(res.netCents, 180000);       // 200000 - 20000
  const t = stripe.calls.transfers[0];
  assert.equal(t.paymentIntentId, 'pi_7');
  assert.equal(t.connectAccountId, 'acct_' + id);
  assert.equal(t.amountCents, 200000);
  assert.equal(t.applicationFeeCents, 20000);
  assert.equal((await repo.getNotary(id)).commissionCentsCollected, 20000);

  // Idempotent: a second accept for the same bid never transfers again.
  const again = await billing.payNotaryOnAccept({ notaryId: id, bidId: 'BID#7', actAmount: 2000, paymentIntentId: 'pi_7' });
  assert.equal(again.alreadyPaid, true);
  assert.equal(stripe.calls.transfers.length, 1);
});

test('payNotaryOnAccept refuses a not-ready notary and a missing authorization', async () => {
  const { billing } = setup();
  const id = NID('n@x.ca');
  await billing.connectNotary({ email: 'n@x.ca' }); // onboarding, not charge-ready
  const notReady = await billing.payNotaryOnAccept({ notaryId: id, bidId: 'b', actAmount: 900, paymentIntentId: 'pi' });
  assert.equal(notReady.errors[0].code, 'compte_incomplet');

  await billing.handleWebhook(JSON.stringify(accountUpdated('e', id, true)), 'good');
  const noPay = await billing.payNotaryOnAccept({ notaryId: id, bidId: 'b', actAmount: 900 });
  assert.equal(noPay.errors[0].code, 'paiement_absent');
});

test('end-to-end: post → pending (hidden) → authorize → accept pays the notary in full', async () => {
  const { repo, stripe, app } = setup();

  // 1) Post an offer — PENDING, returns a Checkout URL, hidden from the carnet.
  const posted = parse(await app.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, prefixe: 'G1R', pricing: DEFAULT_PRICING.refinancement }),
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
  const sess = await notarySignIn(app, email);
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

// --- authorize → capture/void lifecycle: no dead ends ------------------------

const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

async function activeSession(app, stripe, email) {
  await app.handle({ method: 'POST', path: '/notaries/connect', body: JSON.stringify({ email }) });
  const notaryId = stripe.calls.accounts.at(-1).notaryId;
  await app.handle({
    method: 'POST', path: '/stripe/webhook', headers: { 'stripe-signature': 'good' },
    body: JSON.stringify(accountUpdated('evt_act_' + notaryId, notaryId, true)),
  });
  const sess = await notarySignIn(app, email);
  return { notaryId, auth: { authorization: 'Bearer ' + sess.token } };
}

test('DECLINE-AFTER-ACCEPT: a capture failure never dead-ends the accept — dossier released, typed paymentError, retry settles', async () => {
  const { repo, stripe, app } = setup();
  const { auth } = await activeSession(app, stripe, 'a@notaire.ca');
  await repo.put({
    id: 'y1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2400,
    status: 'ouverte', paymentStatus: 'authorized', paymentIntentId: 'pi_y', courriel: 'client@x.ca',
  });

  const realCapture = stripe.captureAndTransfer.bind(stripe);
  stripe.captureAndTransfer = async () => { throw new Error('card_declined'); };

  const res = await app.handle({
    method: 'POST', path: '/notary/bids/accept', headers: auth,
    body: JSON.stringify({ id: 'y1', dateISO: '2026-08-20' }),
  });
  assert.equal(res.statusCode, 200, 'a Stripe decline must not turn the accept into a 5xx');
  const body = parse(res);
  assert.equal(body.paid, false);
  assert.equal(body.paymentError, 'paiement_echoue');
  assert.equal(body.courriel, 'client@x.ca', 'the dossier is still released to the retaining notary');
  assert.equal((await repo.get('y1', '2026-08-20')).status, 'retenue');
  assert.equal(await repo.getActCompletion('y1'), null, 'no ledger entry for an uncaptured payment');

  // Stripe recovers (or the card unblocks): the idempotent re-accept settles.
  stripe.captureAndTransfer = realCapture;
  const retry = parse(await app.handle({
    method: 'POST', path: '/notary/bids/accept', headers: auth,
    body: JSON.stringify({ id: 'y1', dateISO: '2026-08-20' }),
  }));
  assert.equal(retry.paid, true);
  assert.ok(await repo.getActCompletion('y1'));
});

test('payment_intent.canceled arriving AFTER retention never voids the live mise en relation', async () => {
  const { repo, billing } = setup();
  await repo.put({
    id: 'r1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2600,
    status: 'retenue', notaryId: 'N1', paymentStatus: 'a_reautoriser', paymentIntentId: 'pi_old',
  });
  const r = await billing.handleWebhook(JSON.stringify({
    id: 'evt_pi_cancel', type: 'payment_intent.canceled',
    data: { object: { metadata: { bidId: 'r1', bidDate: '2026-08-20' } } },
  }), 'good');
  assert.equal(r.ok, true);
  assert.equal(r.handled, false, 'the void must be refused on a retained bid');
  const bid = await repo.get('r1', '2026-08-20');
  assert.equal(bid.status, 'retenue');
  assert.equal(bid.paymentStatus, 'a_reautoriser', 'the retained bid keeps its settlement flag');
});

test('A_REAUTORISER (ADR 0009): accepting a proposition releases the ORIGINAL hold and flags the bid for re-settlement', async () => {
  const { repo, stripe, app } = setup();
  const notaryId = notaryIdForEmail('p@notaire.ca');
  await repo.putNotary({ id: notaryId, email: 'p@notaire.ca', status: 'active', label: 'Étude P' });
  await repo.put({
    id: 'x1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2400, basePrice: 2000,
    status: 'ouverte', paymentStatus: 'authorized', paymentIntentId: 'pi_old', courriel: 'client@x.ca',
    propositions: [{ id: 'p1', notaryId, etude: 'Étude P', montant: 2600, delta: 200, status: 'en_attente', createdAt: TODAY }],
  });
  const clientAuth = { authorization: 'Bearer ' + signToken('x1', NOW_MS + 60_000, SCOPES.CLIENT) };

  const res = await app.handle({
    method: 'POST', path: '/client/propositions/accept', headers: clientAuth,
    body: JSON.stringify({ id: 'x1', dateISO: '2026-08-20', propositionId: 'p1' }),
  });
  assert.equal(res.statusCode, 200);
  await flush(); // the cancel is fire-and-forget

  const bid = await repo.get('x1', '2026-08-20');
  assert.equal(bid.status, 'retenue');
  assert.equal(bid.montant, 2600);
  assert.equal(bid.paymentStatus, 'a_reautoriser', 'the old hold cannot settle the NEW amount');
  // The client's card is released immediately — never left blocked for ~7 days
  // on an amount that will never be captured.
  assert.equal(stripe.calls.cancels.length, 1);
  assert.equal(stripe.calls.cancels[0].paymentIntentId, 'pi_old');
  assert.equal(stripe.calls.cancels[0].bidId, 'x1');
});

test('a normal accept never cancels the hold it is about to capture', async () => {
  const { repo, stripe, app } = setup();
  const { auth } = await activeSession(app, stripe, 'q@notaire.ca');
  await repo.put({
    id: 'z1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2400,
    status: 'ouverte', paymentStatus: 'authorized', paymentIntentId: 'pi_z', courriel: 'c@x.ca',
  });
  const res = parse(await app.handle({
    method: 'POST', path: '/notary/bids/accept', headers: auth,
    body: JSON.stringify({ id: 'z1', dateISO: '2026-08-20' }),
  }));
  await flush();
  assert.equal(res.paid, true);
  assert.equal(stripe.calls.cancels.length, 0);
});

test('the act commission lives ONLY in billing — the domain pricing stays free of it', () => {
  // The platform commission on an acte is a billing concern. The domain's
  // PRICING (services, tiers, validation) must never express a share of an
  // acte, so the déontologie boundary stays clean where the notarial math
  // happens. ADR 0011 later added the PARTNER REFERRAL module to the domain —
  // a flat marketing thank-you (`REFERRAL.commission`) that never touches the
  // client's price or the notary's fee — so the guard now excises that
  // clearly-delimited section (its banner through the next section banner)
  // and holds every OTHER line of the domain to the original rule.
  const forbidden = /commission|percentage|per[-_ ]?cent|application[_ ]?fee|ristourne/i;
  const domainSrc = readFileSync(new URL('../../../packages/domain/index.js', import.meta.url), 'utf8');
  const withoutReferral = domainSrc
    .replace(/\/\/ --- Partner referrals -[\s\S]*?(?=\/\/ --- Reminder schedule)/, '');
  assert.ok(
    domainSrc.includes('// --- Partner referrals'),
    'the referral section marker moved — update this guard rather than letting it silently skip'
  );
  assert.ok(!forbidden.test(withoutReferral), '@nota/domain pricing must not express a commission concept');

  // The billing layer DOES model a commission now (owner decision, 2026-08-14).
  const billing = createBilling({ repo: createMemoryRepo(), stripe: fakeStripe(), commissionRate: RATE });
  assert.equal(typeof billing.completeAct, 'function');
  assert.equal(billing.commissionRate, RATE);
});
