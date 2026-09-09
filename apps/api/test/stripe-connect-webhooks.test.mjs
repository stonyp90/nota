import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Stripe = require('stripe');
const { createStripeAdapter } = require('../src/stripe-port');
const { createRuntimeSecrets } = require('../src/runtime-secrets');
const { createBilling } = require('../src/billing');
const { createMemoryRepo } = require('../src/repo-memory');
const stripe = new Stripe('sk_test_fixture');
const platformSecret = 'whsec_platform_fixture';
const connectSecret = 'whsec_connect_fixture';
const adapter = createStripeAdapter({ secretKey: 'sk_test_fixture', webhookSecret: platformSecret, connectWebhookSecret: connectSecret, stripe });
const payload = JSON.stringify({ id: 'evt_connect_fixture', type: 'account.updated', account: 'acct_fixture', data: { object: { id: 'acct_fixture' } } });
const sign = (secret, body = payload, timestamp) => stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp });

test('both Stripe destinations can authenticate deliveries at the same endpoint', () => {
  for (const secret of [platformSecret, connectSecret]) {
    assert.equal(adapter.constructEvent(payload, sign(secret)).id, 'evt_connect_fixture');
  }
});

test('neither destination accepts forged, modified or expired deliveries', () => {
  assert.throws(() => adapter.constructEvent(payload, sign('whsec_unknown')));
  for (const secret of [platformSecret, connectSecret]) {
    assert.throws(() => adapter.constructEvent(payload + ' ', sign(secret)));
    assert.throws(() => adapter.constructEvent(payload, sign(secret, payload, 1)));
  }
  assert.throws(() => adapter.constructEvent(payload, undefined));
});

test('single-destination deployments keep working and reject a Connect secret they do not configure', () => {
  const single = createStripeAdapter({ secretKey: 'sk_test_fixture', webhookSecret: platformSecret, stripe });
  assert.equal(single.constructEvent(payload, sign(platformSecret)).id, 'evt_connect_fixture');
  assert.throws(() => single.constructEvent(payload, sign(connectSecret)));
});

test('the HTTP receiver uses the configured Connect secret and rejects an unrelated signature', async () => {
  const { createApp } = require('../src/handler');
  const { createMemoryRepo } = require('../src/repo-memory');
  const keys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: platformSecret, STRIPE_CONNECT_WEBHOOK_SECRET: connectSecret });
    const app = createApp(createMemoryRepo());
    const body = JSON.stringify({ id: 'evt_unhandled_fixture', type: 'test.unhandled', data: { object: {} } });
    for (const [secret, expected] of [[platformSecret, 200], [connectSecret, 200], ['whsec_unknown', 400]]) {
      const response = await app.handle({ method: 'POST', path: '/stripe/webhook', body, headers: { 'stripe-signature': sign(secret, body) } });
      assert.equal(response.statusCode, expected);
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('runtime loading rotates and removes the separate Connect signing secret', async () => {
  const env = { NOTA_RUNTIME_SECRET_ARN: 'fixture' };
  let values = { NOTA_NOTARY_SECRET: 'x'.repeat(32), STRIPE_CONNECT_WEBHOOK_SECRET: connectSecret };
  const load = createRuntimeSecrets({ env, ttlMs: 0, read: async () => JSON.stringify(values) });
  await load();
  assert.equal(env.STRIPE_CONNECT_WEBHOOK_SECRET, connectSecret);
  values = { ...values, STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_rotated_fixture' };
  await load();
  assert.equal(env.STRIPE_CONNECT_WEBHOOK_SECRET, 'whsec_rotated_fixture');
  delete values.STRIPE_CONNECT_WEBHOOK_SECRET;
  await load();
  assert.equal(env.STRIPE_CONNECT_WEBHOOK_SECRET, undefined);
});

test('signed test events cannot mutate live data, and live events cannot mutate local data', async () => {
  for (const mode of ['live', 'test']) {
    const repo = createMemoryRepo();
    const adapter = createStripeAdapter({ secretKey: `sk_${mode}_fixture`, webhookSecret: platformSecret, stripe });
    const billing = createBilling({ repo, stripe: adapter });
    for (const livemode of [true, false, undefined]) {
      const event = { id: `evt_mode_${String(livemode)}`, type: 'test.unhandled', livemode, data: { object: {} } };
      const body = JSON.stringify(event);
      const result = await billing.handleWebhook(body, sign(platformSecret, body));
      assert.equal(result.ok, true);
      const expected = typeof livemode === 'boolean' && livemode === (mode === 'live');
      assert.equal(await repo.wasEventProcessed(event.id), expected);
      if (!expected) {
        assert.equal(result.modeMismatch, true);
        assert.equal(result.event, null, 'no event can reach the notification handler');
      }
    }
  }
});
