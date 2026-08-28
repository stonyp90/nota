// ADR 0023 — a late cancellation of a RETAINED act carries a fee, kept out of
// the client's card hold by PARTIAL capture (the same manual-capture
// authorization ADR 0015 posted; the remainder is released immediately).
// Cancelling an open offer stays free. The barème is admin-decided
// (CONFIG#ANNULATION) with environment/built-in defaults, resolved at every
// cancellation. A settled act (ACT# ledger) can no longer be cancelled at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const cancellationCfg = require('../src/cancellation-config.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' };

// The same no-SDK fake Stripe as billing.test.mjs, plus the partial-capture
// door the cancellation fee rides on. `failFeeCapture` makes that door throw,
// to prove the route falls back to releasing the hold.
function fakeStripe({ failFeeCapture = false } = {}) {
  const calls = { authorizations: [], transfers: [], cancels: [], feeCaptures: [] };
  return {
    calls,
    async createOfferAuthorization(args) { calls.authorizations.push(args); return { sessionId: 'cs_' + args.bidId, url: 'https://checkout.stripe.test/pay/' + args.bidId }; },
    async captureAndTransfer(args) { calls.transfers.push(args); return { paymentIntentId: args.paymentIntentId, chargeId: 'ch_' + args.bidId, transferId: 'tr_' + args.bidId, applicationFeeCents: args.applicationFeeCents, netCents: args.amountCents - args.applicationFeeCents }; },
    async cancelOfferAuthorization(args) { calls.cancels.push(args); return { id: args.paymentIntentId, status: 'canceled' }; },
    async captureCancellationFee(args) {
      if (failFeeCapture) throw new Error('stripe down');
      calls.feeCaptures.push(args);
      return { paymentIntentId: args.paymentIntentId, chargeId: 'chfee_' + args.bidId };
    },
    constructEvent(rawBody) { return JSON.parse(rawBody); },
  };
}

function setup(stripeOpts) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const stripe = fakeStripe(stripeOpts);
  const billing = createBilling({ repo, stripe, now: () => TODAY });
  const app = createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'bid-' + ++n, billing });
  return { repo, stripe, app };
}

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });

// Publish an offer signing `jours` days out, then hand it an AUTHORIZED hold —
// what the checkout.session.completed webhook does in production.
async function seedAuthorized(t, { jours = 3, montant = 2800 } = {}) {
  const dateISO = domain.addDays(TODAY, jours);
  const res = await t.app.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO, montant, courriel: 'client@example.ca', pricing: PRICING }),
  });
  assert.equal(res.statusCode, 201, res.body);
  const { bid, clientToken } = parse(res);
  await t.repo.authorizeBid(bid.id, bid.dateISO, { paymentIntentId: 'pi_' + bid.id, authorizedAt: TODAY });
  return { bid, clientToken };
}

async function retain(t, bid, email = 'me@etude.ca') {
  await t.repo.putNotary({ id: notaryIdForEmail(email), email, status: 'active', label: 'Étude ' + email, profile: { rayonKm: 50, urgences: true } });
  const token = (await notarySignIn(t.app, email)).token;
  const res = await t.app.handle({
    method: 'POST', path: '/notary/bids/accept', headers: bearer(token),
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(res.statusCode, 200, res.body);
  return token;
}

const cancel = (t, token, bid) =>
  t.app.handle({ method: 'POST', path: '/client/bid/cancel', headers: bearer(token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });

test('last-minute cancel of a retained act keeps 30% by partial capture and never releases what it captured', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 3, montant: 2800 });
  await retain(t, bid);

  const res = await cancel(t, clientToken, bid);
  assert.equal(res.statusCode, 200, res.body);
  const out = parse(res).bid;
  assert.equal(out.status, domain.STATUS.ANNULEE);
  assert.deepEqual(out.annulation, { taux: 0.3, frais: 840, joursAvant: 3, chargeId: 'chfee_' + bid.id });

  assert.equal(t.stripe.calls.feeCaptures.length, 1);
  assert.deepEqual(t.stripe.calls.feeCaptures[0], { paymentIntentId: 'pi_' + bid.id, amountCents: 84000, bidId: bid.id });
  // Partial capture releases the remainder on Stripe's side — cancelling the
  // intent on top of it would error; the route must not try.
  assert.equal(t.stripe.calls.cancels.length, 0);
});

test('the fee follows the barème bands: 10% inside 14 days, free at 15+ (and the hold is then released)', async () => {
  for (const { jours, taux } of [{ jours: 4, taux: 0.10 }, { jours: 14, taux: 0.10 }, { jours: 15, taux: 0 }, { jours: 30, taux: 0 }]) {
    const t = setup();
    const { bid, clientToken } = await seedAuthorized(t, { jours, montant: 2000 });
    await retain(t, bid);
    const out = parse(await cancel(t, clientToken, bid)).bid;
    if (taux > 0) {
      assert.equal(out.annulation.taux, taux, `jours=${jours}`);
      assert.equal(out.annulation.frais, 2000 * taux, `jours=${jours}`);
      assert.equal(t.stripe.calls.feeCaptures.length, 1, `jours=${jours}`);
      assert.equal(t.stripe.calls.cancels.length, 0, `jours=${jours}`);
    } else {
      // Free window: no capture, and the RETAINED hold is finally released —
      // the audited `!wasRetained` leak is gone.
      assert.equal(out.annulation, null, `jours=${jours}`);
      assert.equal(t.stripe.calls.feeCaptures.length, 0, `jours=${jours}`);
      assert.deepEqual(t.stripe.calls.cancels.map((c) => c.bidId), [bid.id], `jours=${jours}`);
    }
  }
});

test('cancelling an OPEN offer stays free and releases the hold, whatever the date', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 0 });
  const out = parse(await cancel(t, clientToken, bid)).bid;
  assert.equal(out.status, domain.STATUS.ANNULEE);
  assert.equal(out.annulation, null);
  assert.equal(t.stripe.calls.feeCaptures.length, 0);
  assert.deepEqual(t.stripe.calls.cancels.map((c) => c.bidId), [bid.id]);
});

test('a hold that was never authorized is never captured — pending payment cancels free', async () => {
  const t = setup();
  const dateISO = domain.addDays(TODAY, 1);
  const res = await t.app.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO, montant: 2800, courriel: 'client@example.ca', pricing: PRICING }),
  });
  const { bid, clientToken } = parse(res);
  assert.equal(parse(res).bid.status ?? 'ouverte', 'ouverte');
  const out = parse(await cancel(t, clientToken, bid)).bid;
  assert.equal(out.annulation, null);
  assert.equal(t.stripe.calls.feeCaptures.length, 0);
});

test('without billing configured the cancel is free — no fee outside the Stripe consent', async () => {
  let n = 0;
  const repo = createMemoryRepo([]);
  const app = createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'bid-' + ++n });
  const res = await app.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: domain.addDays(TODAY, 1), montant: 2800, courriel: 'client@example.ca', pricing: PRICING }),
  });
  const { bid, clientToken } = parse(res);
  const t = { app, repo };
  await retain(t, bid);
  const out = parse(await cancel(t, clientToken, bid)).bid;
  assert.equal(out.status, domain.STATUS.ANNULEE);
  assert.equal(out.annulation, null);
});

test('a settled act refuses cancellation outright: 409 acte_complete, nothing moves', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 2 });
  await retain(t, bid);
  await t.repo.markActCompleted(bid.id, { bidId: bid.id, notaryId: notaryIdForEmail('me@etude.ca'), actAmount: 2800, commissionCents: 28000, completedAt: TODAY });

  const res = await cancel(t, clientToken, bid);
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(parse(res).errors[0].code, 'acte_complete');
  const stored = await t.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.status, domain.STATUS.RETENUE);
  assert.equal(t.stripe.calls.feeCaptures.length, 0);
  assert.equal(t.stripe.calls.cancels.length, 0);
});

test('re-cancelling answers with the recorded annulation and never captures twice', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 1, montant: 2000 });
  await retain(t, bid);
  const first = parse(await cancel(t, clientToken, bid)).bid;
  const again = parse(await cancel(t, clientToken, bid)).bid;
  assert.deepEqual(again.annulation, first.annulation);
  assert.equal(t.stripe.calls.feeCaptures.length, 1);
});

test('the admin-stored barème overrides the defaults, and an empty barème makes cancellation free', async () => {
  const t = setup();
  await t.repo.putCancellationConfig({ paliers: [{ maxJours: 5, taux: 0.5 }] }, TODAY);
  const a = await seedAuthorized(t, { jours: 5, montant: 2000 });
  await retain(t, a.bid, 'one@etude.ca');
  const out = parse(await cancel(t, a.clientToken, a.bid)).bid;
  assert.deepEqual(out.annulation, { taux: 0.5, frais: 1000, joursAvant: 5, chargeId: 'chfee_' + a.bid.id });

  const t2 = setup();
  await t2.repo.putCancellationConfig({ paliers: [] }, TODAY);
  const b = await seedAuthorized(t2, { jours: 0, montant: 2000 });
  await retain(t2, b.bid, 'two@etude.ca');
  const out2 = parse(await cancel(t2, b.clientToken, b.bid)).bid;
  assert.equal(out2.annulation, null);
  assert.equal(t2.stripe.calls.feeCaptures.length, 0);
  assert.equal(t2.stripe.calls.cancels.length, 1);
});

test('if the fee capture fails the client pays nothing and the hold is released whole', async () => {
  const t = setup({ failFeeCapture: true });
  const { bid, clientToken } = await seedAuthorized(t, { jours: 0 });
  await retain(t, bid);
  const res = await cancel(t, clientToken, bid);
  assert.equal(res.statusCode, 200, res.body);
  const out = parse(res).bid;
  assert.equal(out.status, domain.STATUS.ANNULEE);
  assert.equal(out.annulation, null);
  assert.deepEqual(t.stripe.calls.cancels.map((c) => c.bidId), [bid.id]);
});

test('GET /client/bid previews the fee on a retained offer so the client sees it BEFORE confirming', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 3, montant: 2800 });

  const open = parse(await t.app.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken), query: { id: bid.id, dateISO: bid.dateISO } }));
  assert.equal(open.annulation, null);

  await retain(t, bid);
  const retained = parse(await t.app.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken), query: { id: bid.id, dateISO: bid.dateISO } }));
  assert.deepEqual(retained.annulation, { taux: 0.3, frais: 840, joursAvant: 3 });
});

test('the barème arithmetic is the config module’s, shared with the admin door', () => {
  assert.deepEqual(cancellationCfg.feeFor({ montant: 2800, joursAvant: 3 }), { taux: 0.3, frais: 840, fraisCents: 84000, joursAvant: 3 });
  assert.deepEqual(cancellationCfg.feeFor({ montant: 2800, joursAvant: -2 }).taux, 0.3, 'a past date clamps to last-minute');
  assert.equal(cancellationCfg.feeFor({ montant: 2800, joursAvant: 15 }).frais, 0);
  assert.equal(cancellationCfg.feeFor({ montant: 2800, joursAvant: 4, paliers: [] }).frais, 0);
  const v = cancellationCfg.validateSchedule({ paliers: [{ maxJours: 14, taux: 0.1 }, { maxJours: 3, taux: 0.3 }] });
  assert.equal(v.ok, false, 'out-of-order paliers must be refused');
});
