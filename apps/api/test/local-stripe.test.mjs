import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const { configureLocalStripe } = require('../scripts/local-stripe-config');
const Stripe = require('stripe');

test('demo sign-in never invents or overwrites a connected account when real billing is configured', async () => {
  const { createApp } = require('../src/handler');
  const { createMemoryRepo } = require('../src/repo-memory');
  const { notaryIdForEmail } = require('../src/notary-auth');
  const previous = process.env.NOTA_DEMO_OPEN;
  process.env.NOTA_DEMO_OPEN = 'true';
  try {
    for (const existingAccount of [null, 'acct_test_onboarding']) {
      const repo = createMemoryRepo();
      const email = 'stripe-notary@example.test';
      const id = notaryIdForEmail(email);
      if (existingAccount) await repo.putNotary({ id, email, status: 'onboarding', chargesEnabled: false, connectAccountId: existingAccount });
      const app = createApp(repo, { billing: {}, billingConfigured: true, notaryConsoleUrl: 'http://localhost:14173', notaryLoginDevEcho: true });
      const request = await app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email }) });
      const token = JSON.parse(request.body).devToken;
      assert.ok(token);
      const verified = await app.handle({ method: 'POST', path: '/notary/session/verify', body: JSON.stringify({ token }) });
      assert.equal(verified.statusCode, 200);
      const profile = await repo.getNotary(id);
      assert.equal(profile.connectAccountId || null, existingAccount);
      assert.notEqual(profile.chargesEnabled, true);
      assert.notEqual(profile.status, 'active');
    }
  } finally {
    if (previous === undefined) delete process.env.NOTA_DEMO_OPEN;
    else process.env.NOTA_DEMO_OPEN = previous;
  }
});

const valid = () => ({ NOTA_LOCAL_STRIPE: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' });

test('local Stripe refuses real keys, incomplete credentials and production resources', () => {
  assert.equal(configureLocalStripe({}), false);
  for (const extra of [
    { NOTA_LOCAL_STRIPE: 'live' }, { STRIPE_SECRET_KEY: 'sk_live_private' },
    { STRIPE_SECRET_KEY: 'pk_test_fixture' }, { STRIPE_WEBHOOK_SECRET: '' },
    { TABLE_NAME: 'nota' }, { ADMIN_TABLE_NAME: 'nota-admin' },
    { NOTA_RUNTIME_SECRET_ARN: 'arn:aws:secret' }, { NODE_ENV: 'production' },
  ]) {
    assert.throws(() => configureLocalStripe({ ...valid(), ...extra }));
  }
});

test('local payment and onboarding returns cannot inherit production URLs', () => {
  const env = { ...valid(), NOTA_PORT_WEB: '4317', NOTA_BASE_URL: 'https://gonota.ca', NOTA_SITE_URL: 'https://gonota.ca', NOTA_ONBOARDING_RETURN_URL: 'https://old.example' };
  assert.equal(configureLocalStripe(env), true);
  assert.equal(env.NOTA_BASE_URL, 'http://localhost:4317');
  assert.equal(env.NOTA_SITE_URL, env.NOTA_BASE_URL);
  assert.equal(env.NOTA_ONBOARDING_RETURN_URL, env.NOTA_BASE_URL + '/#notaires');
  assert.equal(env.NOTA_ONBOARDING_REFRESH_URL, env.NOTA_ONBOARDING_RETURN_URL);
});

test('the local HTTP server actually verifies Stripe signatures instead of invoking the demo adapter', async () => {
  const env = { ...process.env, ...valid(), NODE_ENV: 'test', PORT: '0' };
  for (const key of ['TABLE_NAME', 'ADMIN_TABLE_NAME', 'NOTA_RUNTIME_SECRET_ARN', 'STRIPE_CONNECT_WEBHOOK_SECRET']) delete env[key];
  // PORT=0 asks the OS for a free port; read it through a preload listening hook.
  const serverPath = require.resolve('../local-server.js');
  const code = `const http=require('node:http'); const listen=http.Server.prototype.listen; http.Server.prototype.listen=function(...args){this.once('listening',()=>console.log('TEST_PORT='+this.address().port));return listen.apply(this,args)};require(${JSON.stringify(serverPath)});`;
  const child = spawn(process.execPath, ['-e', code], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local Stripe server did not start')), 10000);
      child.stdout.on('data', chunk => { output += chunk; const match = output.match(/TEST_PORT=(\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      child.once('error', err => { clearTimeout(timer); reject(err); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Local Stripe server exited')); });
    });
    const payload = JSON.stringify({ id: 'evt_local_fixture', type: 'test.unhandled', data: { object: {} } });
    const stripe = new Stripe('sk_test_fixture');
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_fixture' });
    const send = sig => fetch(`http://localhost:${port}/stripe/webhook`, { method: 'POST', body: payload, headers: { 'stripe-signature': sig } });
    assert.equal((await send(signature)).status, 200);
    assert.equal((await send('invalid')).status, 400);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
  }
});
