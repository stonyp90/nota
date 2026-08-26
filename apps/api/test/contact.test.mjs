// POST /contact — the "nous joindre" form. No auth: anyone stuck deserves a
// way to reach a human. The domain validates; the operator gets the message,
// the sender gets an acknowledgement, and a bad payload gets the same
// error-code shape as every other route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');

const TODAY = '2026-08-12';
const BASE = 'https://nota.example';

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  return {
    ...createApp(repo, { now: () => TODAY, newId: () => 'id-' + ++n, notifier, ...opts }),
    repo,
    mailer,
  };
}

const parse = (res) => JSON.parse(res.body);
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};
const send = (a, body) => a.handle({ method: 'POST', path: '/contact', body: JSON.stringify(body) });

test('a valid message reaches the operator and is acknowledged to the sender', async () => {
  const a = app();
  const res = await send(a, {
    nom: 'Anne Tremblay',
    courriel: 'anne@example.ca',
    sujet: 'Annuler une offre',
    message: 'Bonjour, comment annuler mon offre du 20 août ?',
  });
  assert.equal(res.statusCode, 202, res.body);
  assert.equal(parse(res).recu, true);
  await flush();

  const ops = a.mailer.sent.find((m) => m.to === 'ops@nota.ca');
  assert.ok(ops, 'operator mail missing');
  assert.ok(/Annuler une offre/.test(ops.subject), 'subject line missing the sujet: ' + ops.subject);
  assert.ok(ops.text.includes('anne@example.ca'), 'operator mail must carry the reply address');
  assert.ok(ops.text.includes('comment annuler mon offre'), 'operator mail must carry the message');

  const ack = a.mailer.sent.find((m) => m.to === 'anne@example.ca');
  assert.ok(ack, 'sender acknowledgement missing');
});

test('an invalid payload is a 422 with the domain error codes', async () => {
  const a = app();
  const res = await send(a, { courriel: 'pas-un-courriel', message: '' });
  assert.equal(res.statusCode, 422, res.body);
  const codes = parse(res).errors.map((e) => e.code);
  assert.ok(codes.includes('courriel_invalide'), codes.join(','));
  assert.ok(codes.includes('message_requis'), codes.join(','));
  await flush();
  assert.equal(a.mailer.sent.length, 0);
});

test('two messages from the same address both go through (no false dedupe)', async () => {
  const a = app();
  await send(a, { courriel: 'anne@example.ca', message: 'Première question' });
  await send(a, { courriel: 'anne@example.ca', message: 'Deuxième question' });
  await flush();
  const ops = a.mailer.sent.filter((m) => m.to === 'ops@nota.ca');
  assert.equal(ops.length, 2);
});

test('an unsubscribed sender still reaches the operator; only the ack is suppressed', async () => {
  const a = app();
  await a.repo.putUnsubscribe('anne@example.ca', TODAY);
  const res = await send(a, { courriel: 'anne@example.ca', message: 'Aidez-moi' });
  assert.equal(res.statusCode, 202, res.body);
  await flush();
  assert.ok(a.mailer.sent.some((m) => m.to === 'ops@nota.ca'), 'operator mail suppressed');
  assert.ok(!a.mailer.sent.some((m) => m.to === 'anne@example.ca'), 'ack should honour the unsubscribe');
});

test('without an operator address the route still accepts and acks', async () => {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, now: () => TODAY });
  const a = { ...createApp(repo, { now: () => TODAY, newId: () => 'id-' + ++n, notifier }), mailer };
  const res = await send(a, { courriel: 'anne@example.ca', message: 'Allo' });
  assert.equal(res.statusCode, 202, res.body);
  await flush();
  assert.ok(a.mailer.sent.some((m) => m.to === 'anne@example.ca'));
});
