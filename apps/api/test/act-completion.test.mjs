// The settlement moment, hardened: /notary/acts/complete refuses a value far
// outside the retained offer (the write-once ledger makes a typo permanent),
// and /notary/bids carries each retained act's completion state so a fresh
// session renders « Acte complété » instead of re-offering the button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const NOTARY_EMAIL = 'n@etude.ca';
const NOTARY = notaryIdForEmail(NOTARY_EMAIL);

function fakeStripe() {
  return {
    async chargeActCommission(args) { return { id: 'pi_' + (args.bidId || 'x'), applicationFeeCents: args.applicationFeeCents }; },
    constructEvent(rawBody) { return JSON.parse(rawBody); },
  };
}

function app() {
  let n = 0;
  const repo = createMemoryRepo([]);
  const billing = createBilling({ repo, stripe: fakeStripe(), now: () => TODAY });
  return { ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, billing }), repo };
}

const parse = (res) => JSON.parse(res.body);
const session = () => ({ authorization: 'Bearer ' + signToken(NOTARY, NOW_MS + 60_000, SCOPES.SESSION) });

async function seedRetained(a, { montant = 4600 } = {}) {
  await a.repo.putNotary({ id: NOTARY, email: NOTARY_EMAIL, status: 'active', chargesEnabled: true, connectAccountId: 'acct_x', commissionCentsCollected: 0 });
  const bid = { id: 'b1', dateISO: '2026-08-20', serviceId: 'refinancement', montant, status: domain.STATUS.RETENUE, notaryId: NOTARY, courriel: 'client@example.ca' };
  await a.repo.put(bid);
  return bid;
}

const complete = (a, body) =>
  a.handle({ method: 'POST', path: '/notary/acts/complete', headers: session(), body: JSON.stringify(body) });

test('a value far outside the retained offer is refused — the ledger stays clean', async () => {
  const a = app();
  const bid = await seedRetained(a);
  // The append-typo: the prefilled 4600 with 4600 typed after it.
  const res = await complete(a, { bidId: bid.id, dateISO: bid.dateISO, actAmount: 46004600 });
  assert.equal(res.statusCode, 422, res.body);
  assert.ok(parse(res).errors.some((e) => e.code === 'montant_hors_bornes'));
  assert.equal(await a.repo.getActCompletion(bid.id), null);

  // A sane adjustment still settles.
  const ok = await complete(a, { bidId: bid.id, dateISO: bid.dateISO, actAmount: 4800 });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((await a.repo.getActCompletion(bid.id)).actAmount, 4800);
});

test('/notary/bids exposes each retained act’s completion state', async () => {
  const a = app();
  const bid = await seedRetained(a);

  // Before completion: pending, no ledger figures.
  let res = await a.handle({ method: 'GET', path: '/notary/bids', headers: session() });
  assert.equal(res.statusCode, 200, res.body);
  let entry = parse(res).retained.find((r) => r.id === bid.id);
  assert.equal(entry.completed, false);
  assert.equal(entry.actAmount, null);
  assert.equal(entry.commissionCents, null);

  // Complete, then a FRESH session read: the ledger figures ride along, so the
  // console never re-offers « Marquer complété » for a settled act.
  const done = await complete(a, { bidId: bid.id, dateISO: bid.dateISO, actAmount: 4600 });
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(parse(done).actAmount, 4600); // the settled value echoes back

  res = await a.handle({ method: 'GET', path: '/notary/bids', headers: session() });
  entry = parse(res).retained.find((r) => r.id === bid.id);
  assert.equal(entry.completed, true);
  assert.equal(entry.actAmount, 4600);
  assert.equal(entry.commissionCents, parse(done).commissionCents);
});

test('a duplicate completion answers with the ORIGINAL settled figures', async () => {
  const a = app();
  const bid = await seedRetained(a);
  await complete(a, { bidId: bid.id, dateISO: bid.dateISO, actAmount: 4600 });
  const again = await complete(a, { bidId: bid.id, dateISO: bid.dateISO, actAmount: 5000 });
  assert.equal(again.statusCode, 200, again.body);
  const j = parse(again);
  assert.equal(j.actAmount, 4600); // never the retried value
  assert.equal((await a.repo.getActCompletion(bid.id)).actAmount, 4600);
});
