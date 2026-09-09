'use strict';

// Explicit provider tests, never part of npm test. All objects belong to test
// mode. Uses the application's adapter and prices; never accepts a live key.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Stripe = require('stripe');
const domain = require('@nota/domain');
const { createStripeAdapter } = require('../src/stripe-port');
const { createBilling } = require('../src/billing');
const { createMemoryRepo } = require('../src/repo-memory');

async function main() {
  const file = path.resolve(__dirname, '../../..', '.env.stripe.local');
  if (fs.existsSync(file)) process.loadEnvFile(file);
  const key = process.argv.includes('--key-stdin') ? fs.readFileSync(0, 'utf8').trim() : process.env.STRIPE_SECRET_KEY;
  if (!/^sk_test_[A-Za-z0-9]+$/.test(key || '')) throw new Error('Only a Stripe test server key is allowed.');
  const expected = process.env.STRIPE_ACCOUNT_ID;
  if (!/^acct_[A-Za-z0-9]+$/.test(expected || '')) throw new Error('Set STRIPE_ACCOUNT_ID to the expected test account.');
  const stripe = new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 });
  const account = await stripe.accounts.retrieve();
  assert.equal(account.id, expected, 'Stripe account mismatch; no test objects created.');
  const adapter = createStripeAdapter({ secretKey: key, webhookSecret: 'whsec_unused_by_provider_smoke', stripe });
  const billing = createBilling({ repo: createMemoryRepo(), stripe: adapter });
  const run = 'nota_smoke_' + randomUUID();
  const sessions = [];
  const intents = [];
  let connected;
  const checks = [];
  const receipt = { account: account.id, mode: 'test', run, checks, cleanupErrors: [] };
  try {
    const base = { successUrl: 'http://localhost:4173/?paiement=ok', cancelUrl: 'http://localhost:4173/?paiement=annule', language: 'fr-CA' };
    for (const service of domain.SERVICES) {
      for (const tier of domain.TIERS) {
        const quote = await billing.quoteOffer(service.prixDepart, { serviceId: service.id, tierId: tier.id });
        const result = await adapter.createOfferAuthorization({ ...base, bidId: `${run}_${service.id}_${tier.id}`, amountCents: quote.totalCents });
        sessions.push(result.sessionId);
        const session = await stripe.checkout.sessions.retrieve(result.sessionId);
        assert.equal(session.livemode, false);
        assert.equal(session.amount_total, quote.totalCents);
        assert.equal(session.currency, 'cad');
        assert.equal(session.locale, 'fr-CA');
        checks.push({ check: 'checkout_total', service: service.id, tier: tier.id, cents: session.amount_total });
      }
    }
    const setup = await adapter.createOfferSetup({ ...base, bidId: run + '_setup', amountCents: domain.prixAnnonce(domain.SERVICES[0].id).totalCents });
    sessions.push(setup.sessionId);
    const saved = await stripe.checkout.sessions.retrieve(setup.sessionId);
    assert.equal(saved.mode, 'setup');
    assert.equal(saved.customer_creation, 'always');
    checks.push({ check: 'card_registration_checkout', passed: true });

    const amount = domain.prixAnnonce(domain.SERVICES[0].id).totalCents;
    const payment = { amount, currency: 'cad', payment_method_types: ['card'], payment_method: 'pm_card_visa', confirm: true, capture_method: 'manual', metadata: { notaSmokeRun: run } };
    const hold = await stripe.paymentIntents.create(payment);
    intents.push(hold.id);
    assert.equal(hold.status, 'requires_capture');
    const captured = await stripe.paymentIntents.capture(hold.id, { amount_to_capture: amount });
    assert.equal(captured.amount_received, amount);
    const refund = await stripe.refunds.create({ payment_intent: hold.id });
    assert.equal(refund.amount, amount);
    checks.push({ check: 'authorize_capture_refund', cents: amount, passed: true });

    const release = await stripe.paymentIntents.create(payment);
    intents.push(release.id);
    const canceled = await adapter.cancelOfferAuthorization({ paymentIntentId: release.id, bidId: run + '_release' });
    assert.equal(canceled.status, 'canceled');
    checks.push({ check: 'release_authorization', passed: true });
    await assert.rejects(stripe.paymentIntents.create({ ...payment, payment_method: 'pm_card_visa_chargeDeclined' }), error => error.code === 'card_declined');
    checks.push({ check: 'declined_card', passed: true });

    connected = await adapter.createConnectAccount({ notaryId: run });
    const link = await adapter.createOnboardingLink({ accountId: connected.accountId, notaryId: run, returnUrl: base.successUrl, refreshUrl: base.cancelUrl });
    assert.ok(link.url.startsWith('https://connect.stripe.com/'));
    checks.push({ check: 'connect_onboarding_link', passed: true });
    receipt.passed = true;
  } finally {
    for (const id of sessions) {
      try { await stripe.checkout.sessions.expire(id); } catch { receipt.cleanupErrors.push({ resource: 'checkout', id }); }
    }
    for (const id of intents) {
      try {
        const intent = await stripe.paymentIntents.retrieve(id);
        if (!['succeeded', 'canceled'].includes(intent.status)) await stripe.paymentIntents.cancel(id);
      } catch { receipt.cleanupErrors.push({ resource: 'payment_intent', id }); }
    }
    if (connected) {
      try { await stripe.accounts.del(connected.accountId); } catch { receipt.cleanupErrors.push({ resource: 'connect_account', id: connected.accountId }); }
    }
    console.log(JSON.stringify(receipt, null, 2));
    if (receipt.cleanupErrors.length) process.exitCode = 1;
  }
}

main().catch(error => {
  // Provider messages can contain request data. Emit only safe error codes.
  console.error(JSON.stringify({ passed: false, error: error.type || error.name, code: error.code || null, parameter: error.param || null }));
  process.exitCode = 1;
});
