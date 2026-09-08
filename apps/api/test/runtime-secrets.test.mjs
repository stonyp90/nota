import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRuntimeSecrets } = require('../src/runtime-secrets');

test('local development does not contact AWS or alter local credentials', async () => {
  const env = { STRIPE_SECRET_KEY: 'local' };
  await createRuntimeSecrets({ env, read: () => { throw new Error('unexpected AWS'); } })();
  assert.equal(env.STRIPE_SECRET_KEY, 'local');
});

test('one request for concurrent invocations, cached reads, rotation and removed keys', async () => {
  const env = { NOTA_RUNTIME_SECRET_ARN: 'test' };
  let clock = 0, reads = 0;
  let value = { NOTA_NOTARY_SECRET: 'first'.repeat(8), ANTHROPIC_API_KEY: 'optional' };
  const load = createRuntimeSecrets({ env, now: () => clock, ttlMs: 10, read: async () => { reads++; return JSON.stringify(value); } });
  const versions = await Promise.all([load(), load(), load()]);
  assert.equal(reads, 1);
  assert.equal(versions[0], versions[1]);
  assert.equal(env.NOTA_NOTARY_SECRET, 'first'.repeat(8));
  assert.equal(await load(), versions[0]);
  clock = 11;
  value = { NOTA_NOTARY_SECRET: 'rotated'.repeat(8) };
  assert.notEqual(await load(), versions[0]);
  assert.equal(env.NOTA_NOTARY_SECRET, 'rotated'.repeat(8));
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
});

test('invalid or unavailable secrets fail closed without leaking content and can retry', async () => {
  const env = { NOTA_RUNTIME_SECRET_ARN: 'test', NOTA_REQUIRED_SECRETS: 'NOTA_ADMIN_SECRET,NOTA_ADMIN_PASSWORD_HASH' };
  let value = '{sensitive-data';
  const load = createRuntimeSecrets({ env, read: async () => value });
  for (const bad of ['{sensitive-data', '{}', '{"NODE_ENV":"development"}', '{"NOTA_ADMIN_SECRET":12}']) {
    value = bad;
    await assert.rejects(load, { message: 'Runtime secrets unavailable or invalid; refusing to start with fallback credentials.' });
    assert.equal(env.NOTA_ADMIN_SECRET, undefined);
  }
  value = JSON.stringify({ NOTA_ADMIN_SECRET: 'signing'.repeat(8), NOTA_ADMIN_PASSWORD_HASH: 'a'.repeat(64) });
  await load();
  assert.equal(env.NOTA_ADMIN_SECRET, 'signing'.repeat(8));
});
