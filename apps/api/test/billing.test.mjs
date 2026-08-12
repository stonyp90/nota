import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling, SUBSCRIPTION_STATUS } = require('../src/billing.js');

const NOW = '2026-08-12T00:00:00.000Z';
const TODAY = '2026-08-12';

/**
 * A plain fake Stripe adapter — implements the same two-method surface as
 * src/stripe-port.js with no SDK and no network. `constructEvent` treats the
 * raw body as the JSON event and rejects the signature literal 'bad'.
 */
function fakeStripe() {
  const calls = { checkout: [] };
  return {
    calls,
    async createSubscriptionCheckout(args) {
      calls.checkout.push(args);
      return { url: 'https://checkout.stripe.test/session/' + args.clientReferenceId };
    },
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
    repo,
    stripe,
    newId: () => 'n-' + ++n,
    now: () => NOW,
    successUrl: 'https://nota.test/merci',
    cancelUrl: 'https://nota.test/annule',
  });
  const app = createApp(repo, { now: () => TODAY, newId: () => 'x', billing });
  return { repo, stripe, billing, app };
}

const parse = (res) => JSON.parse(res.body);

const completedEvent = (id, notaryId) => ({
  id,
  type: 'checkout.session.completed',
  data: { object: { client_reference_id: notaryId, customer: 'cus_' + notaryId, subscription: 'sub_' + notaryId } },
});

// --- billing use-cases (unit) -------------------------------------------------

test('startSubscription returns a checkout url and records a PENDING notary', async () => {
  const { repo, stripe, billing } = setup();
  const res = await billing.startSubscription({ email: 'Notaire@Example.CA' });

  assert.equal(res.ok, true);
  assert.match(res.url, /^https:\/\/checkout\.stripe\.test\/session\/n-1$/);

  // Stripe was asked to open a subscription checkout for our notary id.
  assert.equal(stripe.calls.checkout.length, 1);
  assert.equal(stripe.calls.checkout[0].clientReferenceId, 'n-1');
  assert.equal(stripe.calls.checkout[0].email, 'notaire@example.ca');

  // A pending profile is persisted with the normalized email.
  const notary = await repo.getNotary('n-1');
  assert.equal(notary.subscriptionStatus, SUBSCRIPTION_STATUS.PENDING);
  assert.equal(notary.email, 'notaire@example.ca');
  assert.equal(notary.customerId, null);
});

test('startSubscription rejects an invalid email and records nothing', async () => {
  const { repo, stripe, billing } = setup();
  const res = await billing.startSubscription({ email: 'not-an-email' });

  assert.equal(res.ok, false);
  assert.equal(res.errors[0].code, 'courriel_invalide');
  assert.equal(stripe.calls.checkout.length, 0);
  assert.equal(await repo.getNotary('n-1'), null);
});

test('checkout.session.completed marks the notary ACTIVE; a redelivered event id is ignored', async () => {
  const { repo, billing } = setup();
  await billing.startSubscription({ email: 'notaire@example.ca' }); // -> n-1, pending

  const raw = JSON.stringify(completedEvent('evt_1', 'n-1'));
  const r1 = await billing.handleWebhook(raw, 'good');
  assert.equal(r1.ok, true);
  assert.equal(r1.handled, true);

  let notary = await repo.getNotary('n-1');
  assert.equal(notary.subscriptionStatus, SUBSCRIPTION_STATUS.ACTIVE);
  assert.equal(notary.customerId, 'cus_n-1');
  assert.equal(notary.subscriptionId, 'sub_n-1');

  // Prove idempotency: flip state, then redeliver the SAME event id. The second
  // delivery must be a no-op, so our manual change survives.
  await repo.putNotary({ ...notary, subscriptionStatus: SUBSCRIPTION_STATUS.CANCELED });
  const r2 = await billing.handleWebhook(raw, 'good');
  assert.equal(r2.ok, true);
  assert.equal(r2.handled, false);
  assert.equal(r2.duplicate, true);

  notary = await repo.getNotary('n-1');
  assert.equal(notary.subscriptionStatus, SUBSCRIPTION_STATUS.CANCELED);
});

test('customer.subscription.deleted marks the notary CANCELED', async () => {
  const { repo, billing } = setup();
  await billing.startSubscription({ email: 'notaire@example.ca' }); // n-1
  await billing.handleWebhook(JSON.stringify(completedEvent('evt_1', 'n-1')), 'good');

  const deleted = {
    id: 'evt_del',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_n-1', metadata: { notaryId: 'n-1' } } },
  };
  const res = await billing.handleWebhook(JSON.stringify(deleted), 'good');
  assert.equal(res.handled, true);

  const notary = await repo.getNotary('n-1');
  assert.equal(notary.subscriptionStatus, SUBSCRIPTION_STATUS.CANCELED);
});

test('customer.subscription.updated with status unpaid marks PAST_DUE', async () => {
  const { repo, billing } = setup();
  await billing.startSubscription({ email: 'notaire@example.ca' }); // n-1

  const updated = {
    id: 'evt_upd',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_n-1', status: 'unpaid', metadata: { notaryId: 'n-1' } } },
  };
  await billing.handleWebhook(JSON.stringify(updated), 'good');

  const notary = await repo.getNotary('n-1');
  assert.equal(notary.subscriptionStatus, SUBSCRIPTION_STATUS.PAST_DUE);
});

test('an unknown event type is ignored, not fatal', async () => {
  const { billing } = setup();
  const res = await billing.handleWebhook(
    JSON.stringify({ id: 'evt_x', type: 'invoice.paid', data: { object: {} } }),
    'good'
  );
  assert.equal(res.ok, true);
  assert.equal(res.handled, false);
});

// --- routes through createApp -------------------------------------------------

test('POST /notaries/subscribe returns 200 {url}', async () => {
  const { app } = setup();
  const res = await app.handle({
    method: 'POST',
    path: '/notaries/subscribe',
    body: JSON.stringify({ email: 'notaire@example.ca' }),
  });
  assert.equal(res.statusCode, 200);
  assert.match(parse(res).url, /^https:\/\/checkout\.stripe\.test\//);
});

test('POST /notaries/subscribe returns 422 {errors} on an invalid email', async () => {
  const { app } = setup();
  const res = await app.handle({
    method: 'POST',
    path: '/notaries/subscribe',
    body: JSON.stringify({ email: 'nope' }),
  });
  assert.equal(res.statusCode, 422);
  assert.equal(parse(res).errors[0].code, 'courriel_invalide');
});

test('POST /stripe/webhook returns 200 {received:true} on a good signature', async () => {
  const { app } = setup();
  const res = await app.handle({
    method: 'POST',
    path: '/stripe/webhook',
    headers: { 'stripe-signature': 'good' },
    body: JSON.stringify(completedEvent('evt_route', 'n-1')),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).received, true);
});

test('POST /stripe/webhook returns 400 when signature verification throws', async () => {
  const { app } = setup();
  const res = await app.handle({
    method: 'POST',
    path: '/stripe/webhook',
    headers: { 'stripe-signature': 'bad' },
    body: JSON.stringify(completedEvent('evt_bad', 'n-1')),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(parse(res).errors[0].code, 'signature_invalide');
});

// --- déontologie guardrail ----------------------------------------------------

test('the billing layer exposes NO commission / percentage / application_fee concept', () => {
  // The Chambre des notaires forbids fee-sharing with a non-notaire (ADR 0001).
  // Nota bills a flat subscription only; nothing here may express a share of an
  // acte. Assert both on the source and on the runtime surface.
  const forbidden = /commission|percentage|per[-_ ]?cent|application[_ ]?fee|destination[_ ]?charge|ristourne|\bcut\b/i;

  const billingSrc = readFileSync(new URL('../src/billing.js', import.meta.url), 'utf8');
  const stripeSrc = readFileSync(new URL('../src/stripe-port.js', import.meta.url), 'utf8');
  assert.ok(!forbidden.test(billingSrc), 'billing.js must not express a commission/percentage concept');
  assert.ok(!forbidden.test(stripeSrc), 'stripe-port.js must not express a commission/percentage concept');

  // Module exports.
  const mod = require('../src/billing.js');
  for (const key of Object.keys(mod)) {
    assert.ok(!forbidden.test(key), `export "${key}" hints at a commission concept`);
  }

  // Runtime surface of a constructed billing instance and its status values.
  const surface = Object.keys(createBilling({ repo: createMemoryRepo(), stripe: fakeStripe() }));
  for (const key of surface) {
    assert.ok(!forbidden.test(key), `billing method "${key}" hints at a commission concept`);
  }
  for (const value of Object.values(mod.SUBSCRIPTION_STATUS)) {
    assert.ok(!forbidden.test(value), `status "${value}" hints at a commission concept`);
  }
});
