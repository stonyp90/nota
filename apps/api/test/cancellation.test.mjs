// A client withdraws their offer — POST /client/bid/cancel — with the same
// per-bid CLIENT token that guards every other client route. Cancelling works
// on an open offer AND on one a notary already retained; in the second case
// the retaining notary (and the operator) are told, because a mise en relation
// is being unwound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const BASE = 'https://nota.example';
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' };

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, notifier, ...opts }),
    repo,
    mailer,
  };
}

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

async function seedBid(a, over = {}) {
  const res = await a.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement',
      dateISO: '2026-08-20',
      montant: 2800,
      courriel: 'client@example.ca',
      pricing: PRICING,
      ...over,
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res);
}

async function session(a, email) {
  await a.repo.putNotary({ id: notaryIdForEmail(email), email, status: 'active', label: 'Étude ' + email });
  const res = await a.handle({ method: 'POST', path: '/notary/session', body: JSON.stringify({ email }) });
  assert.equal(res.statusCode, 200, res.body);
  return parse(res).token;
}

const cancel = (a, token, body) =>
  a.handle({ method: 'POST', path: '/client/bid/cancel', headers: bearer(token), body: JSON.stringify(body) });

test('cancelling an open offer flips it to annulee and hides it from the carnet', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);

  const res = await cancel(a, clientToken, { id: bid.id, dateISO: bid.dateISO });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).bid.status, domain.STATUS.ANNULEE);

  const carnet = parse(await a.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } }));
  assert.ok(!carnet.bids.some((b) => b.id === bid.id), 'cancelled bid still on the public carnet');

  // The owner still sees their bid, with its final status.
  const mine = await a.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken), query: { id: bid.id, dateISO: bid.dateISO } });
  assert.equal(parse(mine).bid.status, domain.STATUS.ANNULEE);
});

test('cancel requires the bid’s own client token', async () => {
  const a = app();
  const { bid } = await seedBid(a);
  const other = await seedBid(a, { dateISO: '2026-08-21' });

  const anon = await a.handle({ method: 'POST', path: '/client/bid/cancel', body: JSON.stringify({ id: bid.id }) });
  assert.equal(anon.statusCode, 401);

  const wrong = await cancel(a, other.clientToken, { id: bid.id, dateISO: bid.dateISO });
  assert.equal(wrong.statusCode, 403);
});

test('cancel is idempotent and 404s on an unknown bid', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  await cancel(a, clientToken, { id: bid.id, dateISO: bid.dateISO });
  const again = await cancel(a, clientToken, { id: bid.id, dateISO: bid.dateISO });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(parse(again).bid.status, domain.STATUS.ANNULEE);
});

test('an open cancel confirms to the client and mails no notary', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  await cancel(a, clientToken, { id: bid.id, dateISO: bid.dateISO });
  await flush();

  const to = a.mailer.sent.map((m) => m.to);
  assert.ok(to.includes('client@example.ca'), 'client ack missing: ' + JSON.stringify(to));
  const ack = a.mailer.sent.find((m) => m.to === 'client@example.ca' && /annul/i.test(m.subject));
  assert.ok(ack, 'no cancellation subject to the client');
});

test('cancelling a RETAINED offer tells the retaining notary and the operator', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  const token = await session(a, 'me@etude.ca');
  const acc = await a.handle({
    method: 'POST', path: '/notary/bids/accept', headers: bearer(token),
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(acc.statusCode, 200, acc.body);

  const res = await cancel(a, clientToken, { id: bid.id, dateISO: bid.dateISO });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).bid.status, domain.STATUS.ANNULEE);
  await flush();

  const notaryMail = a.mailer.sent.find((m) => m.to === 'me@etude.ca' && /annul/i.test(m.subject));
  assert.ok(notaryMail, 'retaining notary was not told');
  const opsMail = a.mailer.sent.find((m) => m.to === 'ops@nota.ca' && /annul/i.test(m.subject));
  assert.ok(opsMail, 'operator was not told');

  // The bid leaves the notary console — open list and retained list alike.
  const list = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(token), query: {} }));
  assert.ok(!list.bids.some((b) => b.id === bid.id), 'cancelled bid still offered to notaries');
  assert.ok(!list.retained.some((b) => b.id === bid.id), 'cancelled bid still in the retained list');
});

test('a cancelled retained bid leaves the notary and public calendar feeds', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  const token = await session(a, 'feed@etude.ca');
  await a.handle({
    method: 'POST', path: '/notary/bids/accept', headers: bearer(token),
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  await cancel(a, clientToken, { id: bid.id, dateISO: bid.dateISO });

  const { signToken, SCOPES } = require('../src/notary-auth.js');
  const feedToken = signToken(notaryIdForEmail('feed@etude.ca'), NOW_MS + 60_000, SCOPES.FEED);
  const feed = await a.handle({ method: 'GET', path: '/notary/feed.ics', query: { token: feedToken } });
  assert.equal(feed.statusCode, 200);
  assert.ok(!feed.body.includes(bid.id), 'cancelled signing still in the notary feed');

  const carnet = await a.handle({ method: 'GET', path: '/carnet/feed.ics', query: {} });
  assert.ok(!carnet.body.includes(bid.id), 'cancelled bid still in the public carnet feed');
});

test('a cancelled bid can no longer be accepted nor proposed on', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  await cancel(a, clientToken, { id: bid.id, dateISO: bid.dateISO });
  const token = await session(a, 'late@etude.ca');

  const acc = await a.handle({
    method: 'POST', path: '/notary/bids/accept', headers: bearer(token),
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(acc.statusCode, 410, acc.body);
  assert.equal(parse(acc).errors[0].code, 'offre_annulee');

  const prop = await a.handle({
    method: 'POST', path: '/notary/bids/propose', headers: bearer(token),
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, montant: 4000 }),
  });
  assert.equal(prop.statusCode, 422, prop.body);
});

test('cancelling an open offer releases a pending card hold (pay-on-accept)', async () => {
  const calls = [];
  const fakeBilling = {
    cancelAuthorization: async (args) => { calls.push(args); return { ok: true }; },
  };
  const a = app({ billing: fakeBilling, billingConfigured: true });
  // billingConfigured makes POST /bids go through checkout; seed the bid
  // directly in the repo instead, as an authorized offer with a live hold.
  const { createApp } = require('../src/handler.js');
  void createApp;
  const bid = {
    id: 'b-hold', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800,
    status: domain.STATUS.OUVERTE, courriel: 'client@example.ca',
    paymentStatus: 'authorized', paymentIntentId: 'pi_123',
  };
  await a.repo.put(bid);
  const { signToken, SCOPES } = require('../src/notary-auth.js');
  const clientToken = signToken(bid.id, NOW_MS + 1000 * 60 * 60, SCOPES.CLIENT);

  const res = await cancel(a, clientToken, { id: bid.id, dateISO: bid.dateISO });
  assert.equal(res.statusCode, 200, res.body);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].paymentIntentId, 'pi_123');
});
