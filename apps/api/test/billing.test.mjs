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
  const calls = { accounts: [], links: [], charges: [] };
  return {
    calls,
    async createConnectAccount(args) { calls.accounts.push(args); return { accountId: 'acct_' + args.notaryId }; },
    async createOnboardingLink(args) { calls.links.push(args); return { url: 'https://connect.stripe.test/onboard/' + args.accountId }; },
    async chargeActCommission(args) { calls.charges.push(args); return { id: 'pi_' + (args.bidId || 'x'), applicationFeeCents: args.applicationFeeCents }; },
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
