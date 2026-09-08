import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMemoryRepo } = require('../src/repo-memory');
const { createApp } = require('../src/handler');
const { createNotifier, encodeUnsubToken } = require('../src/notifications');
const { createFakeMailer } = require('../src/notify-port');
const emails = require('../src/emails');

test('preferences require a valid signed identity and reject unsupported keys or disabled login', async () => {
  const repo = createMemoryRepo();
  const app = createApp(repo);
  const headers = { authorization: 'Bearer ' + encodeUnsubToken('person@example.com') };
  const call = (method, body, h = headers) => app.handle({ method, path: '/notification-preferences', headers: h, body: JSON.stringify(body || {}) });
  assert.equal((await call('GET', null, {})).statusCode, 401);
  assert.equal((await call('POST', { preferences: { unknown: false } })).statusCode, 422);
  assert.equal((await call('POST', { preferences: { clientMagicLink: false } })).statusCode, 422);
  assert.equal((await call('POST', { preferences: { offerPublished: false } })).statusCode, 200);
  const result = JSON.parse((await call('GET')).body);
  assert.equal(result.preferences.offerPublished, false);
  assert.ok(result.catalog.some(x => x.key === 'offerPublished'));
  assert.deepEqual(await repo.getNotificationPreferences('someone-else@example.com'), {});
});

test('saved per-template preference suppresses an actual send and can be re-enabled', async () => {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://gonota.ca' });
  const bid = { id: 'b1', courriel: 'person@example.com', serviceId: 'refinancement', montant: 2000, dateISO: '2026-10-12', status: 'ouverte' };
  await repo.putNotificationPreferences(bid.courriel, { offerPublished: false });
  await notifier.onOfferCreated(bid);
  assert.equal(mailer.sent.length, 0);
  await repo.putNotificationPreferences(bid.courriel, { offerPublished: true });
  await notifier.onOfferCreated(bid);
  assert.equal(mailer.sent.length, 1);
});

test('local email preference link targets the app, not the separate API server', () => {
  const msg = emails.offerPublished({ baseUrl: 'http://localhost:4173', unsubscribeUrl: 'http://localhost:8788/unsubscribe?token=signed', montant: 2000 });
  assert.ok(msg.html.includes('http://localhost:4173/#email-preferences=signed'));
  assert.ok(msg.text.includes('http://localhost:4173/#email-preferences=signed'));
});

test('client preference access requires the matching bid identity and date', async () => {
  const { signToken, SCOPES } = require('../src/notary-auth');
  const repo = createMemoryRepo([{ id: 'owned', dateISO: '2026-10-12', courriel: 'owner@example.com' }]);
  const app = createApp(repo);
  const headers = { authorization: 'Bearer ' + signToken('owned', Date.now() + 60000, SCOPES.CLIENT) };
  const request = query => app.handle({ method: 'GET', path: '/notification-preferences', headers, query });
  assert.equal((await request({ id: 'owned', dateISO: '2026-10-12' })).statusCode, 200);
  assert.equal((await request({ id: 'someone-else', dateISO: '2026-10-12' })).statusCode, 401);
  assert.equal((await request({ id: 'owned' })).statusCode, 401);
});


test('production shared signing key still permits scoped client and notary sessions', async () => {
  const { signToken, SCOPES } = require('../src/notary-auth');
  const previous = process.env.NOTA_NOTARY_SECRET;
  process.env.NOTA_NOTARY_SECRET = 'production-test-key'.repeat(3);
  try {
    const repo = createMemoryRepo([{ id: 'owned', dateISO: '2026-10-12', courriel: 'owner@example.com' }]);
    await repo.putNotary({ id: 'notary', email: 'notary@example.com' });
    const app = createApp(repo);
    for (const [sub, scope, query] of [
      ['owned', SCOPES.CLIENT, { id: 'owned', dateISO: '2026-10-12' }],
      ['notary', SCOPES.SESSION, {}],
    ]) {
      const headers = { authorization: 'Bearer ' + signToken(sub, Date.now() + 60000, scope) };
      const result = await app.handle({ method: 'GET', path: '/notification-preferences', headers, query });
      assert.equal(result.statusCode, 200, sub);
    }
  } finally {
    if (previous === undefined) delete process.env.NOTA_NOTARY_SECRET;
    else process.env.NOTA_NOTARY_SECRET = previous;
  }
});
