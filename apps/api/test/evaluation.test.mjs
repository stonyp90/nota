// POST /client/evaluation — after the act is signed and settled (the ACT#
// ledger has an entry), the client rates the retaining notary once. The note
// feeds the notary profile's rating aggregate; a second submission answers
// idempotently with what is on file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', operatorEmail: 'ops@nota.ca', now: () => TODAY });
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, notifier, ...opts }),
    repo,
    mailer,
  };
}

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const clientToken = (bidId) => signToken(bidId, NOW_MS + 60_000, SCOPES.CLIENT);

const NOTARY = notaryIdForEmail('n@etude.ca');

// A retained bid whose act is (optionally) already settled in the ledger.
async function seed(a, { completed = true, over = {} } = {}) {
  await a.repo.putNotary({ id: NOTARY, email: 'n@etude.ca', status: 'active', label: 'Étude N' });
  const bid = {
    id: 'b1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2800,
    status: domain.STATUS.RETENUE, notaryId: NOTARY, courriel: 'client@example.ca', ...over,
  };
  await a.repo.put(bid);
  if (completed) await a.repo.markActCompleted(bid.id, { bidId: bid.id, notaryId: NOTARY, actAmount: 2800, commissionCents: 42000, completedAt: TODAY });
  return bid;
}

const evaluate = (a, token, body) =>
  a.handle({ method: 'POST', path: '/client/evaluation', headers: bearer(token), body: JSON.stringify(body) });

test('a completed act can be evaluated once; the note lands on the notary aggregate', async () => {
  const a = app();
  const bid = await seed(a);
  const res = await evaluate(a, clientToken(bid.id), { id: bid.id, dateISO: bid.dateISO, note: 5, commentaire: 'Impeccable.' });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(parse(res).evaluation.note, 5);

  const notary = await a.repo.getNotary(NOTARY);
  assert.equal(notary.ratingCount, 1);
  assert.equal(notary.ratingSum, 5);

  // The client's own view now carries the evaluation.
  const mine = parse(await a.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken(bid.id)), query: { id: bid.id, dateISO: bid.dateISO } }));
  assert.equal(mine.evaluation.note, 5);
  assert.equal(mine.acte.complete, true);
});

test('re-submitting answers idempotently with what is on file — the aggregate counts once', async () => {
  const a = app();
  const bid = await seed(a);
  await evaluate(a, clientToken(bid.id), { id: bid.id, dateISO: bid.dateISO, note: 4 });
  const again = await evaluate(a, clientToken(bid.id), { id: bid.id, dateISO: bid.dateISO, note: 1 });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(parse(again).evaluation.note, 4, 'the first note stands');
  const notary = await a.repo.getNotary(NOTARY);
  assert.equal(notary.ratingCount, 1);
  assert.equal(notary.ratingSum, 4);
});

test('gating: no evaluation before the act is settled, none without the bid’s own token, none on garbage', async () => {
  const a = app();
  const bid = await seed(a, { completed: false });

  const early = await evaluate(a, clientToken(bid.id), { id: bid.id, dateISO: bid.dateISO, note: 5 });
  assert.equal(early.statusCode, 409, early.body);
  assert.equal(parse(early).errors[0].code, 'acte_non_complete');

  const anon = await a.handle({ method: 'POST', path: '/client/evaluation', body: JSON.stringify({ id: bid.id, note: 5 }) });
  assert.equal(anon.statusCode, 401);

  await a.repo.markActCompleted(bid.id, { bidId: bid.id, notaryId: NOTARY, actAmount: 2800, commissionCents: 42000, completedAt: TODAY });
  const bad = await evaluate(a, clientToken(bid.id), { id: bid.id, dateISO: bid.dateISO, note: 9 });
  assert.equal(bad.statusCode, 422);
  assert.equal(parse(bad).errors[0].code, 'note_invalide');
});

test('the settlement invites the client to evaluate (one mail, once)', async () => {
  // Demo-style billing: a fake completeAct, with billingConfigured left OFF so
  // the pre-billing offer flow stays untouched (same shape as local-server.js).
  const fakeBilling = { completeAct: async () => ({ ok: true, commissionCents: 42000 }) };
  const a = app({ billing: fakeBilling, billingConfigured: false });
  const bid = await seed(a, { completed: false });
  const token = signToken(NOTARY, NOW_MS + 60_000, SCOPES.SESSION);
  const res = await a.handle({
    method: 'POST', path: '/notary/acts/complete', headers: bearer(token),
    body: JSON.stringify({ bidId: bid.id, dateISO: bid.dateISO, actAmount: 2800 }),
  });
  assert.equal(res.statusCode, 200, res.body);
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  const invite = a.mailer.sent.find((m) => m.to === 'client@example.ca' && /évalu/i.test(m.subject));
  assert.ok(invite, 'evaluation invite missing: ' + JSON.stringify(a.mailer.sent.map((m) => [m.to, m.subject])));
});
