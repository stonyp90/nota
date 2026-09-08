import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createStripeAdapter } = require('../src/stripe-port');
function harness() {
  const calls = [];
  const capture = kind => async (params, options) => { calls.push({ kind, params, options }); return { id: 'id', url: 'https://stripe.test/' }; };
  const adapter = createStripeAdapter({ secretKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture', stripe: {
    accounts: { create: capture('account') }, accountLinks: { create: capture('onboarding') },
    checkout: { sessions: { create: capture('checkout') } },
  } });
  return { adapter, calls };
}
test('Connect account retries use one identity and no unsupported preferred_locales parameter', async () => {
  const { adapter, calls } = harness();
  await adapter.createConnectAccount({ email: 'test@example.com', notaryId: 'n1' });
  await adapter.createConnectAccount({ email: 'test@example.com', notaryId: 'n1' });
  assert.equal(calls[0].options.idempotencyKey, calls[1].options.idempotencyKey);
  assert.equal('preferred_locales' in calls[0].params, false);
  assert.equal(calls[0].params.type, 'express');
});
test('each onboarding request creates a fresh single-use link', async () => {
  const { adapter, calls } = harness();
  const args = { accountId: 'acct_test', notaryId: 'n1', returnUrl: 'https://gonota.ca', refreshUrl: 'https://gonota.ca' };
  await adapter.createOnboardingLink(args); await adapter.createOnboardingLink(args);
  assert.notEqual(calls[0].options.idempotencyKey, calls[1].options.idempotencyKey);
});
for (const [language, expected] of [['en', 'en'], ['fr-CA', 'fr-CA'], [undefined, 'auto']]) {
  test(`Checkout setup and authorization respect ${language || 'browser default'}`, async () => {
    const { adapter, calls } = harness();
    const args = { bidId: 'b1', bidDate: '2026-10-12', amountCents: 200000, language, successUrl: 'https://gonota.ca/?paiement=ok', cancelUrl: 'https://gonota.ca/?paiement=annule' };
    await adapter.createOfferSetup(args); await adapter.createOfferAuthorization(args);
    for (const call of calls) {
      assert.equal(call.params.locale, expected);
      assert.deepEqual(call.params.payment_method_types, ['card']);
      assert.ok(call.options.idempotencyKey);
    }
    assert.equal(calls[0].params.customer_creation, 'always');
    assert.equal(calls[0].params.mode, 'setup');
    assert.equal(calls[1].params.payment_intent_data.capture_method, 'manual');
  });
}

test('payout onboarding rejects anonymous and cross-account access before contacting Stripe', async () => {
  const { createApp } = require('../src/handler');
  const { createMemoryRepo } = require('../src/repo-memory');
  const { signToken, notaryIdForEmail, SCOPES } = require('../src/notary-auth');
  let calls = 0;
  const app = createApp(createMemoryRepo(), { billing: { async connectNotary() { calls++; return { ok: true, url: 'https://stripe.test/onboarding' }; } } });
  const call = token => app.handle({ method: 'POST', path: '/notaries/connect', headers: token ? { authorization: 'Bearer ' + token } : {}, body: { email: 'owner@example.com' } });
  assert.equal((await call()).statusCode, 401);
  assert.equal((await call(signToken(notaryIdForEmail('attacker@example.com'), Date.now() + 60000, SCOPES.SESSION))).statusCode, 403);
  assert.equal((await call(signToken(notaryIdForEmail('owner@example.com'), Date.now() + 60000, SCOPES.FEED))).statusCode, 401);
  assert.equal(calls, 0);
  assert.equal((await call(signToken(notaryIdForEmail('owner@example.com'), Date.now() + 60000, SCOPES.SESSION))).statusCode, 200);
  assert.equal(calls, 1);
});

test('a Stripe onboarding outage returns a retryable response without leaking provider errors', async () => {
  const { createApp } = require('../src/handler');
  const { createMemoryRepo } = require('../src/repo-memory');
  const connectHeaders = require('./helpers/connect-session.cjs');
  const app = createApp(createMemoryRepo(), { billing: { async connectNotary() { throw new Error('provider-debug-sensitive'); } } });
  const response = await app.handle({ method: 'POST', path: '/notaries/connect', headers: connectHeaders('owner@example.com'), body: { email: 'owner@example.com' } });
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).errors[0].code, 'paiement_indisponible');
  assert.doesNotMatch(response.body, /provider-debug-sensitive/);
});

test('a failed transfer preserves the successful capture and retries with identical Stripe keys', async () => {
  const captures = []; const transfers = [];
  let unavailable = true;
  const adapter = createStripeAdapter({ secretKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture', stripe: {
    paymentIntents: { async capture(id, params, options) {
      captures.push({ id, params, options });
      return { latest_charge: 'ch_captured' };
    } },
    transfers: { async create(params, options) {
      transfers.push({ params, options });
      if (unavailable) throw new Error('transfer unavailable');
      return { id: 'tr_recovered' };
    } },
  } });
  const args = { bidId: 'b_transfer_retry', paymentIntentId: 'pi_paid', connectAccountId: 'acct_notary', amountCents: 240000, applicationFeeCents: 40000 };
  await assert.rejects(adapter.captureAndTransfer(args), err => {
    assert.equal(err.captured, true);
    assert.equal(err.chargeId, 'ch_captured');
    assert.equal(err.paymentIntentId, 'pi_paid');
    return true;
  });
  unavailable = false;
  const result = await adapter.captureAndTransfer(args);
  assert.equal(result.transferId, 'tr_recovered');
  assert.deepEqual(captures[1], captures[0]);
  assert.deepEqual(transfers[1], transfers[0]);
  assert.equal(transfers[1].params.source_transaction, 'ch_captured');
  assert.equal(transfers[1].params.amount, 200000);
});

for (const amountReceived of [240000, 230000]) {
  test(`capture retry reads Stripe's settled amount (${amountReceived}) before transfer or fallback`, async () => {
    const transfers = [];
    const adapter = createStripeAdapter({ secretKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture', stripe: {
      paymentIntents: {
        async capture() { throw new Error('already captured'); },
        async retrieve() { return { status: 'succeeded', amount_received: amountReceived, latest_charge: 'ch_original' }; },
      },
      transfers: { async create(params) { transfers.push(params); return { id: 'tr_resumed' }; } },
    } });
    const attempt = adapter.captureAndTransfer({ paymentIntentId: 'pi_old', connectAccountId: 'acct_notary', amountCents: 240000, applicationFeeCents: 40000, bidId: 'old' });
    if (amountReceived === 240000) {
      assert.equal((await attempt).transferId, 'tr_resumed');
      assert.equal(transfers[0].source_transaction, 'ch_original');
    } else {
      await assert.rejects(attempt, err => err.captured === true);
      assert.equal(transfers.length, 0, 'no transfer at an amount other than the settled one');
    }
  });
}

test('an unreadable capture result remains uncertain, never an unpaid settlement', async () => {
  const adapter = createStripeAdapter({ secretKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture', stripe: {
    paymentIntents: {
      async capture() { throw new Error('network timeout'); },
      async retrieve() { throw new Error('still unavailable'); },
    },
    transfers: { async create() { assert.fail('no transfer before verifying the charge'); } },
  } });
  await assert.rejects(adapter.captureAndTransfer({ paymentIntentId: 'pi_unknown', amountCents: 240000, applicationFeeCents: 40000, bidId: 'unknown' }), err => err.settlementUncertain === true);
});


for (const responseLost of [false, true]) {
  test(`a processing capture remains pending (response lost: ${responseLost})`, async () => {
    const adapter = createStripeAdapter({ secretKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture', stripe: {
      paymentIntents: {
        async capture() {
          if (responseLost) throw new Error('network timeout');
          return { status: 'processing', latest_charge: 'ch_pending' };
        },
        async retrieve() { return { status: 'processing', latest_charge: 'ch_pending' }; },
      },
      transfers: { async create() { assert.fail('processing is not a confirmed capture'); } },
    } });
    await assert.rejects(adapter.captureAndTransfer({ paymentIntentId: 'pi_pending', amountCents: 240000, applicationFeeCents: 40000, bidId: 'pending' }), err => err.settlementUncertain === true);
  });
}
