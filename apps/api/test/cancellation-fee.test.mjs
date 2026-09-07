// ADR 0023 — a late cancellation of a RETAINED act carries a fee, kept out of
// the client's card hold by PARTIAL capture (the same manual-capture
// authorization ADR 0015 posted; the remainder is released immediately).
// Cancelling an open offer stays free. The barème is admin-decided
// (CONFIG#ANNULATION) with environment/built-in defaults, resolved at every
// cancellation. A settled act (ACT# ledger) can no longer be cancelled at all.
//
// ADR 0033 — the fee COMPENSATES THE NOTARY whose day was reserved: it is
// transferred whole to their connected account when they can receive it, and
// recorded as OWED to them (`dedommagementCentsDue`) when they cannot. Nota
// keeps none of it (art. 32.1 L.N. / art. 32 C.déont.).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const { createStripeAdapter } = require('../src/stripe-port.js');
const cancellationCfg = require('../src/cancellation-config.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
const { runReminders } = require('../src/reminders.js');
// ADR 0033 — a notary may only retain with a reachable profile.
import { NOTARY_CONTACT } from '../test-support/notary-fixture.mjs';
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' };

// The same no-SDK fake Stripe as billing.test.mjs, plus the partial-capture
// door the cancellation fee rides on. `failFeeCapture` makes that door throw,
// to prove the route falls back to releasing the hold. `failFeeTransfer` makes
// the TRANSFER fail after a successful capture — the money is on the platform
// and must be recorded as owed, never re-captured.
function fakeStripe({ failFeeCapture = false, failFeeTransfer = false } = {}) {
  const calls = { authorizations: [], setups: [], transfers: [], cancels: [], feeCaptures: [], feeTransfers: [] };
  return {
    calls,
    async createOfferAuthorization(args) { calls.authorizations.push(args); return { sessionId: 'cs_' + args.bidId, url: 'https://checkout.stripe.test/pay/' + args.bidId }; },
    // ADR 0035 — la publication d'une date lointaine ENREGISTRE la carte ; ces
    // scénarios-ci posent ensuite la caution à la main (repo.authorizeBid),
    // pour rester sur le mécanisme qu'ils décrivent : la capture partielle.
    async createOfferSetup(args) { calls.setups.push(args); return { sessionId: 'cs_setup_' + args.bidId, url: 'https://checkout.stripe.test/setup/' + args.bidId }; },
    async captureAndTransfer(args) { calls.transfers.push(args); return { paymentIntentId: args.paymentIntentId, chargeId: 'ch_' + args.bidId, transferId: 'tr_' + args.bidId, applicationFeeCents: args.applicationFeeCents, netCents: args.amountCents - args.applicationFeeCents }; },
    async cancelOfferAuthorization(args) { calls.cancels.push(args); return { id: args.paymentIntentId, status: 'canceled' }; },
    async captureCancellationFee(args) {
      if (failFeeCapture) throw new Error('stripe down');
      calls.feeCaptures.push(args);
      const chargeId = 'chfee_' + args.bidId;
      if (!args.connectAccountId) return { paymentIntentId: args.paymentIntentId, chargeId, transferId: null };
      if (failFeeTransfer) {
        const err = new Error('transfer failed');
        err.captured = true;
        err.chargeId = chargeId;
        throw err;
      }
      calls.feeTransfers.push({ bidId: args.bidId, amountCents: args.amountCents, connectAccountId: args.connectAccountId, chargeId });
      return { paymentIntentId: args.paymentIntentId, chargeId, transferId: 'trfee_' + args.bidId };
    },
    constructEvent(rawBody) { return JSON.parse(rawBody); },
  };
}

function setup(stripeOpts) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const stripe = fakeStripe(stripeOpts);
  const billing = createBilling({ repo, stripe, now: () => TODAY });
  const app = createApp(repo, { siteUrl: 'https://nota.test', now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'bid-' + ++n, billing });
  return { repo, stripe, billing, app };
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
    body: JSON.stringify({ serviceId: 'refinancement', dateISO, montant, courriel: 'client@example.ca', prefixe: 'G1R', pricing: PRICING }),
  });
  assert.equal(res.statusCode, 201, res.body);
  const { bid, clientToken } = parse(res);
  await t.repo.authorizeBid(bid.id, bid.dateISO, { paymentIntentId: 'pi_' + bid.id, authorizedAt: TODAY });
  return { bid, clientToken };
}

// An ACTIVE notary retains the bid. `connected` gives them a charge-ready
// Stripe Connect account — the only case where a fee can be TRANSFERRED.
async function retain(t, bid, email = 'me@etude.ca', { connected = false } = {}) {
  const id = notaryIdForEmail(email);
  // Merge over an existing record: a notary retaining a SECOND act keeps
  // whatever the first one left on their file (a debt, counters).
  await t.repo.putNotary({
    ...((await t.repo.getNotary(id)) || {}),
    id, email, status: 'active', label: 'Étude ' + email, ...NOTARY_CONTACT, rayonKm: 50, urgences: true,
    ...(connected ? { chargesEnabled: true, connectAccountId: 'acct_' + id } : {}),
  });
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

const auditOf = async (t, bidId) =>
  (await t.repo.queryAuditByDay(TODAY)).find((e) => e.action === 'annulation_frais' && e.meta && e.meta.bidId === bidId);

// The shape an owed (not yet transferred) compensation takes on the bid.
const DUE = { notaire: true, verse: false, transferId: null };

// ADR 0041 — the notary's decision on the claim window a late cancellation
// opened: a justified amount at or under the cap, or 0 to waive.
const claim = (t, token, bid, montant, justification) =>
  t.app.handle({
    method: 'POST', path: '/notary/bids/indemnite', headers: bearer(token),
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, montant, ...(justification === undefined ? {} : { justification }) }),
  });
const JUST = 'Journée bloquée à l’agenda, dossier ouvert et recherches au registre faites.';
const DELAI = cancellationCfg.DEFAULT_DELAI_JOURS;
const fakeNotifier = () => ({ onReminderDue: async () => ({ sent: false }), onIndemniteDecidee: async () => ({ ok: true }) });

test('ADR 0041: a last-minute cancel OPENS a 30 % cap and takes nothing; the notary’s justified claim is collected by partial capture', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 3, montant: 2800 });
  const token = await retain(t, bid);

  const res = await cancel(t, clientToken, bid);
  assert.equal(res.statusCode, 200, res.body);
  const out = parse(res).bid;
  assert.equal(out.status, domain.STATUS.ANNULEE);
  // Art. 13 LPC — no amount fixed in advance is taken: the barème only caps
  // what the notary may claim, with a reason, within the delay.
  assert.equal(out.annulation.statut, 'en_attente');
  assert.equal(out.annulation.taux, 0.3);
  assert.equal(out.annulation.plafond, 840);
  assert.equal(out.annulation.frais, 0, 'nothing moves at cancellation');
  assert.equal(out.annulation.delaiJours, DELAI);
  assert.equal(out.annulation.echeanceISO, domain.addDays(TODAY, DELAI));
  assert.equal(out.annulation.mecanisme, 'capture');
  assert.equal(t.stripe.calls.feeCaptures.length, 0);
  assert.equal(t.stripe.calls.cancels.length, 0, 'the hold stays in place until the notary decides');

  // The notary claims 500 $ of the 840 $ cap, with a written reason.
  const c = await claim(t, token, bid, 500, JUST);
  assert.equal(c.statusCode, 200, c.body);
  const a = parse(c).bid.annulation;
  assert.equal(a.statut, 'percue');
  assert.equal(a.frais, 500);
  assert.equal(a.justification, JUST);
  assert.equal(a.percu, true);
  assert.equal(a.chargeId, 'chfee_' + bid.id);
  assert.equal(a.mecanisme, 'capture');
  assert.deepEqual(a.dedommagement, DUE);
  assert.deepEqual(t.stripe.calls.feeCaptures[0], { paymentIntentId: 'pi_' + bid.id, amountCents: 50000, bidId: bid.id });
  // Partial capture releases the remainder on Stripe's side — never a cancel on top.
  assert.equal(t.stripe.calls.cancels.length, 0);
  // The window is closed: a second claim is refused, nothing moves twice.
  const twice = await claim(t, token, bid, 100, JUST);
  assert.equal(twice.statusCode, 409, twice.body);
  assert.equal(parse(twice).errors[0].code, 'indemnite_close');
  assert.equal(t.stripe.calls.feeCaptures.length, 1);
});

test('the cap follows the barème bands: 10 % inside 14 days, nothing at 15+ (and the hold is then released)', async () => {
  for (const { jours, taux } of [{ jours: 4, taux: 0.10 }, { jours: 14, taux: 0.10 }, { jours: 15, taux: 0 }, { jours: 30, taux: 0 }]) {
    const t = setup();
    const { bid, clientToken } = await seedAuthorized(t, { jours, montant: 2000 });
    await retain(t, bid);
    const out = parse(await cancel(t, clientToken, bid)).bid;
    if (taux > 0) {
      assert.equal(out.annulation.statut, 'en_attente', `jours=${jours}`);
      assert.equal(out.annulation.taux, taux, `jours=${jours}`);
      assert.equal(out.annulation.plafond, 2000 * taux, `jours=${jours}`);
      assert.equal(t.stripe.calls.feeCaptures.length, 0, `jours=${jours}`);
      assert.equal(t.stripe.calls.cancels.length, 0, `jours=${jours} — the hold waits for the decision`);
    } else {
      // Free window: no claim window, and the RETAINED hold is released.
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
    body: JSON.stringify({ serviceId: 'refinancement', dateISO, montant: 2800, courriel: 'client@example.ca', prefixe: 'G1R', pricing: PRICING }),
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
  const app = createApp(repo, { siteUrl: 'https://nota.test', now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'bid-' + ++n });
  const res = await app.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: domain.addDays(TODAY, 1), montant: 2800, courriel: 'client@example.ca', prefixe: 'G1R', pricing: PRICING }),
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

test('re-cancelling answers with the recorded annulation; a claim collects once and is owed once', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 1, montant: 2000 });
  const token = await retain(t, bid);
  const first = parse(await cancel(t, clientToken, bid)).bid;
  const again = parse(await cancel(t, clientToken, bid)).bid;
  assert.deepEqual(again.annulation, first.annulation);
  assert.equal(t.stripe.calls.feeCaptures.length, 0);
  assert.equal((await claim(t, token, bid, 600, JUST)).statusCode, 200);
  assert.equal((await claim(t, token, bid, 600, JUST)).statusCode, 409);
  assert.equal(t.stripe.calls.feeCaptures.length, 1);
  // …and the compensation is owed ONCE, not once per call.
  assert.equal((await t.repo.getNotary(notaryIdForEmail('me@etude.ca'))).dedommagementCentsDue, 60000);
});

test('the admin-stored barème overrides the defaults, and an empty barème makes cancellation free', async () => {
  const t = setup();
  await t.repo.putCancellationConfig({ paliers: [{ maxJours: 5, taux: 0.5 }], delaiJours: 10 }, TODAY);
  const a = await seedAuthorized(t, { jours: 5, montant: 2000 });
  await retain(t, a.bid, 'one@etude.ca');
  const out = parse(await cancel(t, a.clientToken, a.bid)).bid;
  assert.equal(out.annulation.statut, 'en_attente');
  assert.equal(out.annulation.taux, 0.5);
  assert.equal(out.annulation.plafond, 1000);
  assert.equal(out.annulation.delaiJours, 10, 'the stored delay rules too');
  assert.equal(out.annulation.echeanceISO, domain.addDays(TODAY, 10));
  assert.equal(t.stripe.calls.feeCaptures.length, 0);

  const t2 = setup();
  await t2.repo.putCancellationConfig({ paliers: [] }, TODAY);
  const b = await seedAuthorized(t2, { jours: 0, montant: 2000 });
  await retain(t2, b.bid, 'two@etude.ca');
  const out2 = parse(await cancel(t2, b.clientToken, b.bid)).bid;
  assert.equal(out2.annulation, null);
  assert.equal(t2.stripe.calls.feeCaptures.length, 0);
  assert.equal(t2.stripe.calls.cancels.length, 1);
});

test('if the claim’s capture fails the client pays nothing, the hold is released whole — et l’échec est INSCRIT', async () => {
  const t = setup({ failFeeCapture: true });
  const { bid, clientToken } = await seedAuthorized(t, { jours: 0 });
  const token = await retain(t, bid);
  const res = await cancel(t, clientToken, bid);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).bid.annulation.statut, 'en_attente');
  assert.equal(t.stripe.calls.cancels.length, 0);

  const c = await claim(t, token, bid, 840, JUST);
  assert.equal(c.statusCode, 200, c.body);
  const out = parse(c).bid;
  // ADR 0035 — a claim whose charge was REFUSED is not a free cancellation:
  // it is free FOR THE CLIENT (nothing is charged), but the fact is counted.
  assert.equal(out.annulation.statut, 'refusee');
  assert.equal(out.annulation.percu, false, 'rien n’a été prélevé, et cela se dit');
  assert.equal(out.annulation.frais, 840, 'the claim was made in full');
  assert.equal(out.annulation.chargeId, null, 'aucune charge : il n’y a rien à nommer');
  assert.equal(out.annulation.dedommagement.verse, false);
  assert.deepEqual(t.stripe.calls.cancels.map((x) => x.bidId), [bid.id], 'the hold is released whole');
  // Nothing was captured, so nothing is owed to anyone.
  assert.equal((await t.repo.getNotary(notaryIdForEmail('me@etude.ca'))).dedommagementCentsDue, undefined);
  const audit = await auditOf(t, bid.id);
  assert.equal(audit.meta.percu, false);
  assert.equal(audit.meta.mecanisme, 'capture');
  assert.equal(audit.meta.justification, JUST, 'the reason rides the financial record');
});

test('GET /client/bid previews the CAP on a retained offer so the client sees it BEFORE confirming', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 3, montant: 2800 });

  const open = parse(await t.app.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken), query: { id: bid.id, dateISO: bid.dateISO } }));
  assert.equal(open.annulation, null);

  await retain(t, bid);
  const retained = parse(await t.app.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken), query: { id: bid.id, dateISO: bid.dateISO } }));
  assert.deepEqual(retained.annulation, { taux: 0.3, plafond: 840, joursAvant: 3, delaiJours: DELAI });
});

test('the barème arithmetic is the config module’s, shared with the admin door — and it is a CAP', () => {
  assert.deepEqual(cancellationCfg.feeFor({ montant: 2800, joursAvant: 3 }), { taux: 0.3, frais: 840, fraisCents: 84000, plafond: 840, plafondCents: 84000, joursAvant: 3 });
  assert.deepEqual(cancellationCfg.feeFor({ montant: 2800, joursAvant: -2 }).taux, 0.3, 'a past date clamps to last-minute');
  assert.equal(cancellationCfg.feeFor({ montant: 2800, joursAvant: 15 }).plafond, 0);
  assert.equal(cancellationCfg.feeFor({ montant: 2800, joursAvant: 4, paliers: [] }).plafond, 0);
  const v = cancellationCfg.validateSchedule({ paliers: [{ maxJours: 14, taux: 0.1 }, { maxJours: 3, taux: 0.3 }] });
  assert.equal(v.ok, false, 'out-of-order paliers must be refused');
  assert.equal(cancellationCfg.validateSchedule({ paliers: [{ maxJours: 3, taux: 0.3 }], delaiJours: 0 }).ok, false, 'a delay under one day is refused');
  assert.equal(cancellationCfg.validateSchedule({ paliers: [{ maxJours: 3, taux: 0.3 }], delaiJours: 12 }).delaiJours, 12);
});

// ---------------------------------------------------------------------------
// ADR 0033 — the fee compensates the NOTARY. Nota keeps none of it.
// ---------------------------------------------------------------------------

test('ADR 0033: the claimed indemnity is TRANSFERRED whole to a charge-ready notary — verse, transferId, Nota keeps nothing', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 3, montant: 2800 });
  const token = await retain(t, bid, 'paye@etude.ca', { connected: true });
  const id = notaryIdForEmail('paye@etude.ca');

  assert.equal((await cancel(t, clientToken, bid)).statusCode, 200);
  const res = await claim(t, token, bid, 840, JUST);
  assert.equal(res.statusCode, 200, res.body);
  const a = parse(res).bid.annulation;
  assert.equal(a.statut, 'percue');
  assert.equal(a.frais, 840);
  assert.equal(a.plafond, 840);
  assert.equal(a.chargeId, 'chfee_' + bid.id);
  assert.equal(a.mecanisme, 'capture');
  assert.equal(a.percu, true);
  assert.deepEqual(a.dedommagement, { notaire: true, verse: true, transferId: 'trfee_' + bid.id });

  // The capture asked for the transfer to THIS notary's account…
  assert.deepEqual(t.stripe.calls.feeCaptures[0], { paymentIntentId: 'pi_' + bid.id, amountCents: 84000, bidId: bid.id, connectAccountId: 'acct_' + id });
  // …and the transfer carries the WHOLE amount: no slice stays on the platform.
  assert.equal(t.stripe.calls.feeTransfers.length, 1);
  assert.equal(t.stripe.calls.feeTransfers[0].amountCents, t.stripe.calls.feeCaptures[0].amountCents);
  assert.equal(t.stripe.calls.feeTransfers[0].connectAccountId, 'acct_' + id);
  assert.equal(t.stripe.calls.cancels.length, 0);
  assert.equal((await t.repo.getNotary(id)).dedommagementCentsDue, undefined);

  // The audit trail names the transfer, and the reason.
  const audit = await auditOf(t, bid.id);
  assert.ok(audit, 'annulation_frais audit entry missing');
  assert.equal(audit.meta.transferId, 'trfee_' + bid.id);
  assert.equal(audit.meta.verse, true);
  assert.equal(audit.meta.chargeId, 'chfee_' + bid.id);
  assert.equal(audit.meta.notaryId, id);
  assert.equal(audit.meta.justification, JUST);
  assert.equal(audit.meta.plafond, 840);
});

test('ADR 0033: without Stripe Connect the claim is captured and recorded as OWED to the notary — it accumulates', async () => {
  const t = setup();
  const id = notaryIdForEmail('du@etude.ca');
  const a = await seedAuthorized(t, { jours: 3, montant: 2800 });
  const tokenA = await retain(t, a.bid, 'du@etude.ca');
  await cancel(t, a.clientToken, a.bid);
  const out = parse(await claim(t, tokenA, a.bid, 840, JUST)).bid;
  assert.deepEqual(out.annulation.dedommagement, DUE);
  assert.equal(t.stripe.calls.feeTransfers.length, 0, 'no transfer without a connected account');
  assert.equal((await t.repo.getNotary(id)).dedommagementCentsDue, 84000);

  const audit = await auditOf(t, a.bid.id);
  assert.equal(audit.meta.verse, false);
  assert.equal(audit.meta.transferId, null);

  // A second claim on the same notary ADDS to the debt.
  const b = await seedAuthorized(t, { jours: 10, montant: 2000 });
  const tokenB = await retain(t, b.bid, 'du@etude.ca');
  await cancel(t, b.clientToken, b.bid);
  assert.equal((await claim(t, tokenB, b.bid, 200, JUST)).statusCode, 200);
  assert.equal((await t.repo.getNotary(id)).dedommagementCentsDue, 84000 + 20000);
});

test('ADR 0033: a transfer that fails AFTER the capture never loses the money — owed to the notary, capture not retried, hold not released', async () => {
  const t = setup({ failFeeTransfer: true });
  const { bid, clientToken } = await seedAuthorized(t, { jours: 3, montant: 2800 });
  const token = await retain(t, bid, 'panne@etude.ca', { connected: true });
  const id = notaryIdForEmail('panne@etude.ca');

  await cancel(t, clientToken, bid);
  const res = await claim(t, token, bid, 840, JUST);
  assert.equal(res.statusCode, 200, res.body);
  const a = parse(res).bid.annulation;
  // The capture happened: the amount is recorded, and it is owed.
  assert.equal(a.statut, 'percue');
  assert.equal(a.frais, 840);
  assert.equal(a.chargeId, 'chfee_' + bid.id);
  assert.equal(a.percu, true);
  assert.deepEqual(a.dedommagement, DUE);
  assert.equal((await t.repo.getNotary(id)).dedommagementCentsDue, 84000);
  assert.equal(t.stripe.calls.feeCaptures.length, 1);
  assert.equal(t.stripe.calls.feeTransfers.length, 0);
  // A partial capture already released the remainder — no cancel on top.
  assert.equal(t.stripe.calls.cancels.length, 0);
  const audit = await auditOf(t, bid.id);
  assert.equal(audit.meta.verse, false);
  assert.equal(audit.meta.chargeId, 'chfee_' + bid.id);
});

// ---------------------------------------------------------------------------
// ADR 0041 — the three ways a claim window closes without money moving.
// ---------------------------------------------------------------------------

test('ADR 0041: claiming 0 WAIVES — nothing moves, the hold is released, the act leaves the console, the decision is logged', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 3, montant: 2800 });
  const token = await retain(t, bid, 'gentil@etude.ca');
  const id = notaryIdForEmail('gentil@etude.ca');
  await cancel(t, clientToken, bid);
  // While pending, the act is still on the notary's console, flagged.
  const feedBefore = parse(await t.app.handle({ method: 'GET', path: '/notary/bids', headers: bearer(token), query: {} }));
  const pending = feedBefore.retained.find((r) => r.id === bid.id);
  assert.ok(pending, 'the cancelled act stays on the console until the decision');
  assert.equal(pending.annulee, true);
  assert.equal(pending.annulation.plafond, 840);
  assert.equal(pending.annulation.echeanceISO, domain.addDays(TODAY, DELAI));
  assert.equal(pending.client, undefined, 'art. 37 — nothing of the client travels after the relation ended');

  const res = await claim(t, token, bid, 0);
  assert.equal(res.statusCode, 200, res.body);
  const a = parse(res).bid.annulation;
  assert.equal(a.statut, 'renoncee');
  assert.equal(a.frais, 0);
  assert.equal(t.stripe.calls.feeCaptures.length, 0);
  assert.deepEqual(t.stripe.calls.cancels.map((x) => x.bidId), [bid.id], 'the hold is released');
  assert.equal((await t.repo.getNotary(id)).dedommagementCentsDue, undefined);
  const feedAfter = parse(await t.app.handle({ method: 'GET', path: '/notary/bids', headers: bearer(token), query: {} }));
  assert.ok(!feedAfter.retained.some((r) => r.id === bid.id), 'decided: the act leaves the console');
  const decision = (await t.repo.queryAuditByDay(TODAY)).find((e) => e.action === 'annulation_indemnite' && e.meta.bidId === bid.id);
  assert.ok(decision, 'the decision is logged');
  assert.equal(decision.meta.statut, 'renoncee');
  assert.equal(decision.acteur.type, 'notaire');
  assert.equal(await auditOf(t, bid.id), undefined, 'no financial record: no money moved');
});

test('ADR 0041: the deadline passes — the daily sweep closes the window, releases the hold and logs it', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 3, montant: 2800 });
  const token = await retain(t, bid, 'tard@etude.ca');
  await cancel(t, clientToken, bid);

  // The day before the deadline: nothing happens.
  const veille = domain.addDays(TODAY, DELAI);
  let r = await runReminders({ repo: t.repo, notifier: fakeNotifier(), billing: t.billing, now: () => veille });
  assert.equal(r.indemnites.echues, 0);
  assert.equal(t.stripe.calls.cancels.length, 0);

  // The day after: closed without charge.
  const lendemain = domain.addDays(TODAY, DELAI + 1);
  r = await runReminders({ repo: t.repo, notifier: fakeNotifier(), billing: t.billing, now: () => lendemain });
  assert.equal(r.indemnites.echues, 1);
  const stored = await t.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.annulation.statut, 'expiree');
  assert.equal(stored.annulation.frais, 0);
  assert.deepEqual(t.stripe.calls.cancels.map((x) => x.bidId), [bid.id]);
  assert.equal(t.stripe.calls.feeCaptures.length, 0);
  const decision = (await t.repo.queryAuditByDay(lendemain)).find((e) => e.action === 'annulation_indemnite' && e.meta.bidId === bid.id);
  assert.ok(decision, 'the expiry is logged on the day it happened');
  assert.equal(decision.meta.statut, 'expiree');
  // Too late to claim: the route says so and moves nothing.
  const late = await claim(t, token, bid, 100, JUST);
  assert.equal(late.statusCode, 409);
  assert.equal(parse(late).errors[0].code, 'indemnite_close');
  assert.equal(t.stripe.calls.feeCaptures.length, 0);
});

test('ADR 0041: a claim above the cap or without a reason is refused (422); another notary is refused (403)', async () => {
  const t = setup();
  const { bid, clientToken } = await seedAuthorized(t, { jours: 3, montant: 2800 });
  const token = await retain(t, bid, 'moi@etude.ca');
  await cancel(t, clientToken, bid);

  let res = await claim(t, token, bid, 900, JUST);
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(parse(res).errors[0].code, 'montant_au_dessus_du_plafond');
  res = await claim(t, token, bid, 500, 'court');
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(parse(res).errors[0].code, 'justification_requise');
  res = await claim(t, token, bid, -1, JUST);
  assert.equal(res.statusCode, 422, res.body);

  await t.repo.putNotary({ id: notaryIdForEmail('autre@etude.ca'), email: 'autre@etude.ca', status: 'active', ...NOTARY_CONTACT });
  const other = (await notarySignIn(t.app, 'autre@etude.ca')).token;
  res = await claim(t, other, bid, 500, JUST);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(t.stripe.calls.feeCaptures.length, 0, 'nothing moved on any refusal');
  assert.equal((await t.repo.get(bid.id, bid.dateISO)).annulation.statut, 'en_attente', 'the window is still open');
});

test('billing.chargeCancellationFee returns { ok, chargeId, transferId, verse } on both paths', async () => {
  const t = setup();
  const paid = notaryIdForEmail('ok@etude.ca');
  await t.repo.putNotary({ id: paid, email: 'ok@etude.ca', status: 'active', chargesEnabled: true, connectAccountId: 'acct_ok' });
  const r1 = await t.billing.chargeCancellationFee({ paymentIntentId: 'pi_1', bidId: 'b1', amountCents: 5000, notaryId: paid });
  assert.deepEqual(r1, { ok: true, mecanisme: 'capture', chargeId: 'chfee_b1', transferId: 'trfee_b1', verse: true });

  // ACTIVE but charges disabled (Stripe pulled the capability): owed.
  const off = notaryIdForEmail('off@etude.ca');
  await t.repo.putNotary({ id: off, email: 'off@etude.ca', status: 'active', chargesEnabled: false, connectAccountId: 'acct_off' });
  const r2 = await t.billing.chargeCancellationFee({ paymentIntentId: 'pi_2', bidId: 'b2', amountCents: 5000, notaryId: off });
  assert.deepEqual(r2, { ok: true, mecanisme: 'capture', chargeId: 'chfee_b2', transferId: null, verse: false });
  assert.equal((await t.repo.getNotary(off)).dedommagementCentsDue, 5000);
  assert.equal(t.stripe.calls.feeCaptures[1].connectAccountId, undefined, 'no transfer is requested for a notary who cannot receive');

  // Still ONBOARDING: owed as well.
  const onb = notaryIdForEmail('onb@etude.ca');
  await t.repo.putNotary({ id: onb, email: 'onb@etude.ca', status: 'onboarding', chargesEnabled: true, connectAccountId: 'acct_onb' });
  const r3 = await t.billing.chargeCancellationFee({ paymentIntentId: 'pi_3', bidId: 'b3', amountCents: 700, notaryId: onb });
  assert.equal(r3.verse, false);
  assert.equal((await t.repo.getNotary(onb)).dedommagementCentsDue, 700);

  // Guards: nothing to capture → { ok: false }, nothing recorded.
  assert.deepEqual(await t.billing.chargeCancellationFee({ paymentIntentId: null, bidId: 'b4', amountCents: 700, notaryId: paid }), { ok: false, code: 'aucun_moyen' });
  assert.deepEqual(await t.billing.chargeCancellationFee({ paymentIntentId: 'pi_5', bidId: 'b5', amountCents: 0, notaryId: paid }), { ok: false, code: 'montant_invalide' });
});

// --- The Stripe adapter itself: what is actually sent to Stripe --------------

function fakeSdk({ failTransfer = false } = {}) {
  const calls = { captures: [], transfers: [] };
  const sdk = {
    paymentIntents: {
      async capture(id, params, opts) { calls.captures.push({ id, params, opts }); return { id, latest_charge: 'ch_' + id }; },
    },
    transfers: {
      async create(params, opts) {
        if (failTransfer) throw new Error('balance_insufficient');
        calls.transfers.push({ params, opts });
        return { id: 'tr_' + (params.metadata && params.metadata.bidId) };
      },
    },
  };
  return { sdk, calls };
}
const adapterOn = (sdk) => createStripeAdapter({ secretKey: 'sk_test', webhookSecret: 'whsec', stripe: sdk });

test('stripe-port.captureCancellationFee: partial capture, then a WHOLE transfer to the notary, idempotent per bid, no application fee', async () => {
  const { sdk, calls } = fakeSdk();
  const out = await adapterOn(sdk).captureCancellationFee({ paymentIntentId: 'pi_a', amountCents: 84000, bidId: 'bid-a', connectAccountId: 'acct_n' });
  assert.deepEqual(out, { paymentIntentId: 'pi_a', chargeId: 'ch_pi_a', transferId: 'tr_bid-a' });

  assert.equal(calls.captures.length, 1);
  assert.deepEqual(calls.captures[0], { id: 'pi_a', params: { amount_to_capture: 84000 }, opts: { idempotencyKey: 'cancelfee:bid-a' } });

  assert.equal(calls.transfers.length, 1);
  assert.deepEqual(calls.transfers[0], {
    params: {
      amount: 84000, currency: 'cad', destination: 'acct_n',
      source_transaction: 'ch_pi_a', transfer_group: 'bid:bid-a',
      metadata: { bidId: 'bid-a', motif: 'annulation' },
    },
    opts: { idempotencyKey: 'cancelfee-transfer:bid-a' },
  });
  assert.equal(calls.transfers[0].params.application_fee_amount, undefined, 'Nota takes no fee on a compensation');
});

test('stripe-port.captureCancellationFee: without a connected account it captures only (transferId null)', async () => {
  const { sdk, calls } = fakeSdk();
  const out = await adapterOn(sdk).captureCancellationFee({ paymentIntentId: 'pi_b', amountCents: 20000, bidId: 'bid-b' });
  assert.deepEqual(out, { paymentIntentId: 'pi_b', chargeId: 'ch_pi_b', transferId: null });
  assert.equal(calls.captures.length, 1);
  assert.equal(calls.transfers.length, 0);
});

test('stripe-port.captureCancellationFee: a transfer failure after the capture surfaces the chargeId so the caller can record the debt', async () => {
  const { sdk, calls } = fakeSdk({ failTransfer: true });
  await assert.rejects(
    adapterOn(sdk).captureCancellationFee({ paymentIntentId: 'pi_c', amountCents: 20000, bidId: 'bid-c', connectAccountId: 'acct_n' }),
    (err) => err.captured === true && err.chargeId === 'ch_pi_c' && err.paymentIntentId === 'pi_c'
  );
  assert.equal(calls.captures.length, 1, 'the capture went through');
});
