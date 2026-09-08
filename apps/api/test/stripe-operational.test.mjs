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
