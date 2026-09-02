import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling, NOTARY_STATUS } = require('../src/billing.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
import { notarySignIn } from '../test-support/notary-session.mjs';

const NOW = '2026-08-12T00:00:00.000Z';
const NOW_MS = 1_760_000_000_000;
const TODAY = '2026-08-12';
// ADR 0031 — le prix de Nota, un montant FIXE. Ces tests lisent le défaut du
// module plutôt qu'un nombre écrit ici : le jour où le propriétaire change le
// prix, la suite le suit sans être retouchée.
const { DEFAULT_PRIX_CENTS: PRIX } = require('../src/prix-nota-config.js');

/**
 * A plain fake Stripe adapter — implements the same surface as
 * src/stripe-port.js with no SDK and no network. `constructEvent` treats the
 * raw body as the JSON event and rejects the signature literal 'bad'.
 */
function fakeStripe() {
  const calls = { accounts: [], links: [], charges: [], authorizations: [], transfers: [], cancels: [] };
  return {
    calls,
    async createConnectAccount(args) { calls.accounts.push(args); return { accountId: 'acct_' + args.notaryId }; },
    async createOnboardingLink(args) { calls.links.push(args); return { url: 'https://connect.stripe.test/onboard/' + args.accountId }; },
    async chargeActCommission(args) { calls.charges.push(args); return { id: 'pi_' + (args.bidId || 'x'), applicationFeeCents: args.applicationFeeCents }; },
    async createOfferAuthorization(args) { calls.authorizations.push(args); return { sessionId: 'cs_' + (args.bidId || 'x'), url: 'https://checkout.stripe.test/pay/' + (args.bidId || 'x') }; },
    async captureAndTransfer(args) { calls.transfers.push(args); return { paymentIntentId: args.paymentIntentId, chargeId: 'ch_' + (args.bidId || 'x'), transferId: 'tr_' + (args.bidId || 'x'), applicationFeeCents: args.applicationFeeCents, netCents: args.amountCents - args.applicationFeeCents }; },
    async cancelOfferAuthorization(args) { calls.cancels.push(args); return { id: args.paymentIntentId, status: 'canceled' }; },
    constructEvent(rawBody, signature) {
      if (signature === 'bad' || !signature) throw new Error('signature verification failed');
      return JSON.parse(rawBody);
    },
  };
}

// The billing identity for an email — ONE id shared with /notary/session, so
// Connect activation actually opens the console gate.
const NID = (email) => notaryIdForEmail(email);

function setup() {
  const repo = createMemoryRepo();
  const stripe = fakeStripe();
  const billing = createBilling({
    repo, stripe,
    now: () => NOW,
    onboardingReturnUrl: 'https://nota.test/notaires?ok=1',
    onboardingRefreshUrl: 'https://nota.test/notaires?refresh=1',
  });
  const app = createApp(repo, { siteUrl: 'https://nota.test', now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'x', billing });
  return { repo, stripe, billing, app };
}

const parse = (res) => JSON.parse(res.body);
const accountUpdated = (id, notaryId, chargesEnabled) => ({
  id, type: 'account.updated',
  data: { object: { charges_enabled: chargesEnabled, metadata: { notaryId } } },
});

// --- onboarding (free) --------------------------------------------------------

test('connectNotary opens a Connect onboarding link and records an ONBOARDING notary under the SESSION id', async () => {
  const { repo, stripe, billing } = setup();
  const res = await billing.connectNotary({ email: 'Notaire@Example.CA' });
  const id = NID('notaire@example.ca');

  assert.equal(res.ok, true);
  assert.equal(res.url, 'https://connect.stripe.test/onboard/acct_' + id);
  assert.equal(stripe.calls.accounts[0].email, 'notaire@example.ca');
  // The id stamped on the Connect account IS notaryIdForEmail(email): the
  // account.updated webhook must activate the record /notary/session reads.
  assert.equal(stripe.calls.accounts[0].notaryId, id);

  const notary = await repo.getNotary(id);
  assert.equal(notary.status, NOTARY_STATUS.ONBOARDING);
  assert.equal(notary.email, 'notaire@example.ca');
  assert.equal(notary.connectAccountId, 'acct_' + id);
  assert.equal(notary.chargesEnabled, false);
});

test('connectNotary rejects an invalid email and records nothing', async () => {
  const { repo, stripe, billing } = setup();
  const res = await billing.connectNotary({ email: 'not-an-email' });
  assert.equal(res.ok, false);
  assert.equal(res.errors[0].code, 'courriel_invalide');
  assert.equal(stripe.calls.accounts.length, 0);
  assert.equal(await repo.getNotary(NID('not-an-email')), null);
});

test('re-connect for the same email reuses the Connect account and never resets the record', async () => {
  const { repo, stripe, billing } = setup();
  const id = NID('notaire@example.ca');
  await billing.connectNotary({ email: 'notaire@example.ca', parrain: 'EVEROY' });
  await billing.handleWebhook(JSON.stringify(accountUpdated('evt_up', id, true)), 'good'); // -> ACTIVE
  await repo.putNotary({ ...(await repo.getNotary(id)), commissionCentsCollected: 12345 });

  // Lost tab / double submit: a second connect returns a FRESH link for the
  // SAME account — no second Stripe account, no status/accumulator reset, and
  // first-touch referral attribution is preserved.
  const again = await billing.connectNotary({ email: 'notaire@example.ca', parrain: 'OTHERCODE' });
  assert.equal(again.ok, true);
  assert.equal(stripe.calls.accounts.length, 1, 'must not create a second Connect account');
  assert.equal(stripe.calls.links.length, 2);

  const notary = await repo.getNotary(id);
  assert.equal(notary.status, NOTARY_STATUS.ACTIVE);
  assert.equal(notary.chargesEnabled, true);
  assert.equal(notary.commissionCentsCollected, 12345);
  assert.equal(notary.parrain, 'EVEROY');
});

test('account.updated (charges enabled) marks the notary ACTIVE; a redelivery is ignored', async () => {
  const { repo, billing } = setup();
  const id = NID('notaire@example.ca');
  await billing.connectNotary({ email: 'notaire@example.ca' }); // onboarding

  const raw = JSON.stringify(accountUpdated('evt_1', id, true));
  const r1 = await billing.handleWebhook(raw, 'good');
  assert.equal(r1.ok, true);
  assert.equal(r1.handled, true);

  let notary = await repo.getNotary(id);
  assert.equal(notary.status, NOTARY_STATUS.ACTIVE);
  assert.equal(notary.chargesEnabled, true);

  // Idempotency: flip state, redeliver SAME id -> no-op, manual change survives.
  await repo.putNotary({ ...notary, status: NOTARY_STATUS.RESTRICTED });
  const r2 = await billing.handleWebhook(raw, 'good');
  assert.equal(r2.duplicate, true);
  notary = await repo.getNotary(id);
  assert.equal(notary.status, NOTARY_STATUS.RESTRICTED);
});

test('GATING CONSISTENCY: free Connect onboarding then activation opens the sign-in gate', async () => {
  const { app, stripe } = setup();
  const email = 'nouveau@notaire.ca';

  // 1) Sign-up via the public route.
  const connect = await app.handle({ method: 'POST', path: '/notaries/connect', body: JSON.stringify({ email }) });
  assert.equal(connect.statusCode, 200);

  // 2) Before activation the console gate stays closed: the request is
  //    enumeration-safe (generic ok) but mints NO usable link (no devToken), so
  //    there is nothing to redeem into a session.
  const early = await app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email }) });
  assert.equal(early.statusCode, 200);
  assert.equal(parse(early).devToken, undefined);

  // 3) Stripe reports charges enabled for the account created at signup — the
  //    metadata id comes from the REAL account creation call.
  const notaryId = stripe.calls.accounts[0].notaryId;
  await app.handle({
    method: 'POST', path: '/stripe/webhook', headers: { 'stripe-signature': 'good' },
    body: JSON.stringify(accountUpdated('evt_gate', notaryId, true)),
  });

  // 4) The SAME email now signs in: the activation landed on the record the
  //    session lookup reads (one identity, no orphaned billing record).
  const sess = await notarySignIn(app, email);
  assert.ok(sess.token);
});

// --- commission on a completed act -------------------------------------------

// Le repli de l'ADR 0015 : aucune caution à capturer (le client a payé le
// notaire directement à la signature). Rien ne peut être encaissé ici — et
// c'est exactement ce que le registre doit dire. Avant le 2026-09-01, ce
// chemin appelait Stripe pour créer un PaymentIntent sans moyen de paiement
// et sans `confirm` : aucun argent ne bougeait, mais le registre, le compteur
// et le courriel « acte payé » affirmaient le contraire.
test('completeAct settles WITHOUT charging — the fee is recorded as owed, never as collected', async () => {
  const { repo, stripe, billing } = setup();
  const id = NID('notaire@example.ca');
  await billing.connectNotary({ email: 'notaire@example.ca' });
  await billing.handleWebhook(JSON.stringify(accountUpdated('evt_a', id, true)), 'good'); // -> active

  const res = await billing.completeAct({ notaryId: id, bidId: 'BID#1', actAmount: 2000 });
  assert.equal(res.ok, true);
  // ADR 0031 — ce qui est dû est le PRIX de Nota, jamais une part des
  // honoraires : le notaire a encaissé ses 2 000 $ en entier, hors plateforme.
  assert.equal(res.commissionCents, PRIX);
  assert.equal(res.prixNotaCents, PRIX);
  assert.equal(res.honorairesCents, 200_000, 'les honoraires restent entiers');
  assert.equal(res.paye, false, 'the settlement never claims a payment it did not make');
  assert.equal(res.du, PRIX / 100, 'what the notary owes Nota, in dollars');

  // No Stripe call at all: there is no customer, no payment method, nothing to
  // charge. A call that cannot move money must not be made to look like one.
  assert.equal(stripe.calls.charges.length, 0);

  const notary = await repo.getNotary(id);
  assert.equal(notary.commissionCentsCollected || 0, 0, 'collected means Nota HAS the money');
  assert.equal(notary.commissionCentsDue, PRIX, 'owed, and visible as owed');

  // The ledger says the same thing, permanently — et il porte les DEUX lignes,
  // figées avec l'argent (`commissionCents` n'est plus qu'un nom hérité).
  const ledger = await repo.getActCompletion('BID#1');
  assert.equal(ledger.paye, false);
  assert.equal(ledger.commissionCentsDue, PRIX);
  assert.equal(ledger.prixNotaCents, PRIX);
  assert.equal(ledger.honorairesCents, 200_000);
});

test('completeAct refuses a notary that has not finished onboarding, and a bad amount', async () => {
  const { billing } = setup();
  const id = NID('notaire@example.ca');
  await billing.connectNotary({ email: 'notaire@example.ca' }); // still ONBOARDING

  const notReady = await billing.completeAct({ notaryId: id, bidId: 'b', actAmount: 900 });
  assert.equal(notReady.ok, false);
  assert.equal(notReady.errors[0].code, 'compte_incomplet');

  await billing.handleWebhook(JSON.stringify(accountUpdated('e', id, true)), 'good'); // active
  const badAmount = await billing.completeAct({ notaryId: id, bidId: 'b', actAmount: 0 });
  assert.equal(badAmount.ok, false);
  assert.equal(badAmount.errors[0].code, 'montant_invalide');

  const noNotary = await billing.completeAct({ notaryId: 'nope', bidId: 'b', actAmount: 900 });
  assert.equal(noNotary.errors[0].code, 'notaire_introuvable');
});

test('an unknown event type is ignored, not fatal', async () => {
  const { billing } = setup();
  const res = await billing.handleWebhook(JSON.stringify({ id: 'evt_x', type: 'charge.refunded', data: { object: {} } }), 'good');
  assert.equal(res.ok, true);
  assert.equal(res.handled, false);
});

// --- routes through createApp -------------------------------------------------

test('POST /notaries/connect returns 200 {url}', async () => {
  const { app } = setup();
  const res = await app.handle({ method: 'POST', path: '/notaries/connect', body: JSON.stringify({ email: 'notaire@example.ca' }) });
  assert.equal(res.statusCode, 200);
  assert.match(parse(res).url, /^https:\/\/connect\.stripe\.test\//);
});

test('POST /notaries/connect returns 422 {errors} on an invalid email', async () => {
  const { app } = setup();
  const res = await app.handle({ method: 'POST', path: '/notaries/connect', body: JSON.stringify({ email: 'nope' }) });
  assert.equal(res.statusCode, 422);
  assert.equal(parse(res).errors[0].code, 'courriel_invalide');
});

test('POST /notary/acts/complete: session-gated, verifies bid ownership, then settles at Nota’s price', async () => {
  const { repo, app } = setup();
  // 401 without a token.
  assert.equal((await app.handle({ method: 'POST', path: '/notary/acts/complete', body: '{}' })).statusCode, 401);

  // Seed an ACTIVE, charge-ready notary and sign in for a real session token.
  const email = 'a@notaire.ca';
  const id = notaryIdForEmail(email);
  await repo.putNotary({ id, email, status: 'active', chargesEnabled: true, connectAccountId: 'acct_x', commissionCentsCollected: 0 });
  const sess = await notarySignIn(app, email);
  const auth = { authorization: 'Bearer ' + sess.token };

  // SECURITY: a bid this notary did NOT retain is rejected (no ledger poisoning).
  await repo.put({ id: 'BID#9', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 1500, status: 'ouverte', notaryId: null });
  const stranger = await app.handle({
    method: 'POST', path: '/notary/acts/complete', headers: auth,
    body: JSON.stringify({ bidId: 'BID#9', dateISO: '2026-08-20', actAmount: 1500 }),
  });
  assert.equal(stranger.statusCode, 403);
  assert.equal(await repo.getActCompletion('BID#9'), null); // the shared act ledger stays untouched

  // Once this notary has retained it, completing settles at Nota's own price.
  await repo.put({ id: 'BID#9', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 1500, status: 'retenue', notaryId: id });
  const res = await app.handle({
    method: 'POST', path: '/notary/acts/complete', headers: auth,
    body: JSON.stringify({ bidId: 'BID#9', dateISO: '2026-08-20', actAmount: 1500 }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).commissionCents, PRIX);
});

test('POST /stripe/webhook returns 200 {received:true} on a good signature', async () => {
  const { app } = setup();
  const res = await app.handle({
    method: 'POST', path: '/stripe/webhook',
    headers: { 'stripe-signature': 'good' },
    body: JSON.stringify(accountUpdated('evt_route', 'n-1', true)),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).received, true);
});

test('POST /stripe/webhook returns 400 when signature verification throws', async () => {
  const { app } = setup();
  const res = await app.handle({
    method: 'POST', path: '/stripe/webhook',
    headers: { 'stripe-signature': 'bad' },
    body: JSON.stringify(accountUpdated('evt_bad', 'n-1', true)),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(parse(res).errors[0].code, 'signature_invalide');
});

// --- model guardrails ---------------------------------------------------------

// --- EDGE CASES (logic) — commission math + boundaries -----------------------

const EDGE_ID = NID('e@x.ca');
async function activeBilling() {
  const repo = createMemoryRepo();
  const stripe = fakeStripe();
  const billing = createBilling({ repo, stripe, now: () => NOW });
  await billing.connectNotary({ email: 'e@x.ca' });
  await billing.handleWebhook(JSON.stringify(accountUpdated('a', EDGE_ID, true)), 'good');
  return { repo, stripe, billing };
}

test('EDGE (logic): a fractional act value leaves Nota’s price a whole number of cents', async () => {
  const { billing } = await activeBilling();
  // 999,99 $ d'honoraires : ce sont eux qui portent la fraction, jamais le
  // prix de Nota — un montant fixe n'a pas de cent à arrondir.
  const r = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'b1', actAmount: 999.99 });
  assert.equal(r.honorairesCents, 99_999);
  assert.equal(r.commissionCents, PRIX);
});

test('EDGE (logic): a very large act value does not move Nota’s price by a cent', async () => {
  const { billing } = await activeBilling();
  const r = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'big', actAmount: 1_000_000 });
  assert.equal(r.honorairesCents, 100_000_000);
  // Un pourcentage aurait facturé 100 000 $ sur cet acte. Le prix de Nota ne
  // dépend pas de la valeur de l'acte (ADR 0031).
  assert.equal(r.commissionCents, PRIX);
});

test('EDGE (logic): a stored price is honored end-to-end', async () => {
  const { repo, billing } = await activeBilling();
  await repo.putPrixNotaConfig({ prixCents: 25_000 }, NOW);
  const r = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'b', actAmount: 2000 });
  assert.equal(r.commissionCents, 25_000);
  assert.equal((await repo.getNotary(EDGE_ID)).commissionCentsDue, 25_000);
});

test('EDGE (logic): re-completing the SAME bid is idempotent — one ledger row, one tally', async () => {
  const { repo, billing } = await activeBilling();
  const first = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'dup', actAmount: 1000 });
  const second = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'dup', actAmount: 1000 });

  // The write-once ACT ledger short-circuits the second call.
  assert.equal(second.alreadyCompleted, true);
  assert.equal(second.commissionCents, first.commissionCents);
  assert.equal(second.paye, false);

  // And the fee owed is tallied exactly once on the notary.
  const notary = await repo.getNotary(EDGE_ID);
  assert.equal(notary.commissionCentsDue, first.commissionCents);
});

// Le repli ne touche plus Stripe du tout : il ne peut donc plus échouer sur un
// refus de carte. Ce qui doit rester vrai, c'est qu'un règlement sans argent
// n'écrive jamais un encaissement — et que le notaire reçoive quand même son
// acte au registre.
test('completeAct never reports a Stripe payment on the fallback path', async () => {
  const { repo, stripe, billing } = await activeBilling();
  stripe.chargeActCommission = async () => { throw new Error('ne doit jamais être appelé'); };

  const r = await billing.completeAct({ notaryId: EDGE_ID, bidId: 'BID#F', actAmount: 1000 });
  assert.equal(r.ok, true);
  assert.equal(r.paye, false);
  assert.equal(stripe.calls.charges.length, 0);
  assert.equal((await repo.getActCompletion('BID#F')).paye, false);
  assert.equal((await repo.getNotary(EDGE_ID)).commissionCentsCollected || 0, 0);
});

// --- PAY-ON-ACCEPT: authorize at post, capture + pay the notary on accept ----

const checkoutCompleted = (id, bidId, bidDate, pi) => ({
  id, type: 'checkout.session.completed',
  data: { object: { payment_intent: pi, metadata: { bidId, bidDate } } },
});
const checkoutExpired = (id, bidId, bidDate) => ({
  id, type: 'checkout.session.expired',
  data: { object: { metadata: { bidId, bidDate } } },
});
// Zero-add refinancement answers: the dynamic base stays at the flat 2000 $.
const DEFAULT_PRICING = { refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' } };

test('authorizeOffer opens a hosted Checkout to authorize the client card', async () => {
  const { stripe, billing } = setup();
  const res = await billing.authorizeOffer({ bidId: 'BID#1', bidDate: '2026-09-01', amountCents: 90000, email: 'c@x.ca' });
  assert.equal(res.ok, true);
  assert.match(res.url, /^https:\/\/checkout\.stripe\.test\//);
  assert.equal(stripe.calls.authorizations[0].amountCents, 90000);
  assert.equal(stripe.calls.authorizations[0].bidId, 'BID#1');

  const bad = await billing.authorizeOffer({ bidId: 'x', amountCents: 0 });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].code, 'montant_invalide');
});

test('checkout.session.completed binds the PaymentIntent to the bid and makes it live', async () => {
  const { repo, billing } = setup();
  await repo.put({ id: 'BID#1', dateISO: '2026-09-01', serviceId: 'refinancement', montant: 900, status: 'ouverte', paymentStatus: 'pending' });
  const r = await billing.handleWebhook(JSON.stringify(checkoutCompleted('evt_c1', 'BID#1', '2026-09-01', 'pi_1')), 'good');
  assert.equal(r.ok, true);
  assert.equal(r.handled, true);
  const bid = await repo.get('BID#1', '2026-09-01');
  assert.equal(bid.paymentStatus, 'authorized');
  assert.equal(bid.paymentIntentId, 'pi_1');
});

test('checkout.session.expired voids a never-accepted authorization', async () => {
  const { repo, billing } = setup();
  await repo.put({ id: 'BID#2', dateISO: '2026-09-01', serviceId: 'refinancement', montant: 900, status: 'ouverte', paymentStatus: 'pending' });
  const r = await billing.handleWebhook(JSON.stringify(checkoutExpired('evt_e1', 'BID#2', '2026-09-01')), 'good');
  assert.equal(r.handled, true);
  assert.equal((await repo.get('BID#2', '2026-09-01')).paymentStatus, 'void');
});

test('payNotaryOnAccept captures the two lines, transfers the notary’s fees WHOLE, keeps Nota’s price, and is idempotent', async () => {
  const { repo, stripe, billing } = setup();
  const id = NID('n@x.ca');
  await billing.connectNotary({ email: 'n@x.ca' });
  await billing.handleWebhook(JSON.stringify(accountUpdated('e', id, true)), 'good'); // -> active

  const res = await billing.payNotaryOnAccept({ notaryId: id, bidId: 'BID#7', actAmount: 2000, paymentIntentId: 'pi_7' });
  assert.equal(res.ok, true);
  assert.equal(res.commissionCents, PRIX);
  assert.equal(res.honorairesCents, 200000);
  // ART. 32.1 2° L.N. — le notaire n'abandonne rien : son net EST le montant
  // qui lui a été offert. La capture porte les deux lignes.
  assert.equal(res.netCents, 200000);
  const t = stripe.calls.transfers[0];
  assert.equal(t.paymentIntentId, 'pi_7');
  assert.equal(t.connectAccountId, 'acct_' + id);
  assert.equal(t.amountCents, 200000 + PRIX);
  assert.equal(t.applicationFeeCents, PRIX, 'les frais d’application SONT le prix de Nota');
  assert.equal((await repo.getNotary(id)).commissionCentsCollected, PRIX);

  // Idempotent: a second accept for the same bid never transfers again.
  const again = await billing.payNotaryOnAccept({ notaryId: id, bidId: 'BID#7', actAmount: 2000, paymentIntentId: 'pi_7' });
  assert.equal(again.alreadyPaid, true);
  assert.equal(stripe.calls.transfers.length, 1);
});

test('payNotaryOnAccept refuses a not-ready notary and a missing authorization', async () => {
  const { billing } = setup();
  const id = NID('n@x.ca');
  await billing.connectNotary({ email: 'n@x.ca' }); // onboarding, not charge-ready
  const notReady = await billing.payNotaryOnAccept({ notaryId: id, bidId: 'b', actAmount: 900, paymentIntentId: 'pi' });
  assert.equal(notReady.errors[0].code, 'compte_incomplet');

  await billing.handleWebhook(JSON.stringify(accountUpdated('e', id, true)), 'good');
  const noPay = await billing.payNotaryOnAccept({ notaryId: id, bidId: 'b', actAmount: 900 });
  assert.equal(noPay.errors[0].code, 'paiement_absent');
});

test('end-to-end (ADR 0015): post → authorize → accept retains WITHOUT paying → completion captures and pays the notary', async () => {
  const { repo, stripe, app } = setup();

  // 1) Post an offer — PENDING, returns a Checkout URL, hidden from the carnet.
  const posted = parse(await app.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, prefixe: 'G1R', pricing: DEFAULT_PRICING.refinancement }),
  }));
  assert.equal(posted.paymentStatus, 'pending');
  assert.match(posted.checkoutUrl, /^https:\/\/checkout\.stripe\.test\//);
  assert.equal(stripe.calls.authorizations.length, 1);
  let feed = parse(await app.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } }));
  assert.equal(feed.bids.length, 0, 'a pending offer must not appear on the public carnet');

  // 2) Client authorizes their card — webhook binds the PaymentIntent, offer goes live.
  await app.handle({
    method: 'POST', path: '/stripe/webhook', headers: { 'stripe-signature': 'good' },
    body: JSON.stringify(checkoutCompleted('evt_live', 'x', '2026-08-20', 'pi_x')),
  });
  feed = parse(await app.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } }));
  assert.equal(feed.bids.length, 1);
  const montant = feed.bids[0].montant;
  // La carte autorise les DEUX lignes : autoriser les seuls honoraires
  // sous-facturerait le client au moment de la capture (ADR 0031).
  assert.equal(stripe.calls.authorizations[0].amountCents, Math.round(montant * 100) + PRIX);

  // 3) A charge-ready notary signs in and accepts → the dossier is released
  //    but NO money moves (paid at signing, ADR 0015): no capture, no transfer,
  //    the hold stays intact for the settlement at completion.
  const email = 'a@notaire.ca';
  const id = notaryIdForEmail(email);
  await repo.putNotary({ id, email, status: 'active', chargesEnabled: true, connectAccountId: 'acct_x', commissionCentsCollected: 0 });
  const sess = await notarySignIn(app, email);
  const acc = parse(await app.handle({
    method: 'POST', path: '/notary/bids/accept',
    headers: { authorization: 'Bearer ' + sess.token },
    body: JSON.stringify({ id: 'x', dateISO: '2026-08-20' }),
  }));
  assert.equal(acc.paid, undefined, 'accept must not settle anything');
  assert.equal(stripe.calls.transfers.length, 0, 'no capture at accept');
  assert.equal(await repo.getActCompletion('x'), null, 'no ledger entry before signing');

  // 4) The act is signed: completion captures the hold and pays the notary.
  const cents = Math.round(montant * 100);
  const done = parse(await app.handle({
    method: 'POST', path: '/notary/acts/complete',
    headers: { authorization: 'Bearer ' + sess.token },
    body: JSON.stringify({ bidId: 'x', dateISO: '2026-08-20', actAmount: montant }),
  }));
  assert.equal(done.ok, true);
  assert.equal(done.paid, true);
  assert.equal(done.commissionCents, PRIX);
  assert.equal(done.netCents, cents, 'le notaire nette ses honoraires ENTIERS');
  assert.equal(stripe.calls.transfers.length, 1);
  assert.equal(stripe.calls.transfers[0].paymentIntentId, 'pi_x');
  assert.equal(stripe.calls.transfers[0].amountCents, cents + PRIX, 'la capture porte les deux lignes');
  assert.equal(stripe.calls.charges.length, 0, 'the capture path never also charges the notary');
});

// --- authorize → capture/void lifecycle: no dead ends ------------------------

const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

async function activeSession(app, stripe, email) {
  await app.handle({ method: 'POST', path: '/notaries/connect', body: JSON.stringify({ email }) });
  const notaryId = stripe.calls.accounts.at(-1).notaryId;
  await app.handle({
    method: 'POST', path: '/stripe/webhook', headers: { 'stripe-signature': 'good' },
    body: JSON.stringify(accountUpdated('evt_act_' + notaryId, notaryId, true)),
  });
  const sess = await notarySignIn(app, email);
  return { notaryId, auth: { authorization: 'Bearer ' + sess.token } };
}

test('CAPTURE FAILURE AT COMPLETION (ADR 0015): a lapsed/declined hold settles the act as an UNPAID fee — never a dead end, never a phantom payment', async () => {
  const { repo, stripe, app } = setup();
  const { auth, notaryId } = await activeSession(app, stripe, 'a@notaire.ca');
  await repo.put({
    id: 'y1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2400,
    status: 'retenue', notaryId, paymentStatus: 'authorized', paymentIntentId: 'pi_y', courriel: 'client@x.ca',
  });

  stripe.captureAndTransfer = async () => { throw new Error('card_declined'); };

  const res = await app.handle({
    method: 'POST', path: '/notary/acts/complete', headers: auth,
    body: JSON.stringify({ bidId: 'y1', dateISO: '2026-08-20', actAmount: 2400 }),
  });
  assert.equal(res.statusCode, 200, 'a Stripe decline must not dead-end the completion');
  const body = parse(res);
  assert.equal(body.ok, true);
  assert.equal(body.paid, undefined, 'nothing was paid through Nota on this path');
  assert.equal(body.commissionCents, PRIX);
  assert.equal(stripe.calls.charges.length, 0, 'no charge is attempted: there is nothing to charge');
  const ledger = await repo.getActCompletion('y1');
  assert.ok(ledger, 'the act ledger settled exactly once, via the fallback');
  assert.equal(ledger.paye, false, 'and it says so: settled, not paid');
  assert.equal(ledger.commissionCentsDue, PRIX, 'le prix de Nota est dû par le notaire');
  assert.equal((await repo.getNotary(notaryId)).commissionCentsCollected || 0, 0);
});

test('payment_intent.canceled arriving AFTER retention never voids the live mise en relation', async () => {
  const { repo, billing } = setup();
  await repo.put({
    id: 'r1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2600,
    status: 'retenue', notaryId: 'N1', paymentStatus: 'a_reautoriser', paymentIntentId: 'pi_old',
  });
  const r = await billing.handleWebhook(JSON.stringify({
    id: 'evt_pi_cancel', type: 'payment_intent.canceled',
    data: { object: { metadata: { bidId: 'r1', bidDate: '2026-08-20' } } },
  }), 'good');
  assert.equal(r.ok, true);
  assert.equal(r.handled, false, 'the void must be refused on a retained bid');
  const bid = await repo.get('r1', '2026-08-20');
  assert.equal(bid.status, 'retenue');
  assert.equal(bid.paymentStatus, 'a_reautoriser', 'the retained bid keeps its settlement flag');
});

test('A_REAUTORISER (ADR 0009): accepting a proposition releases the ORIGINAL hold and flags the bid for re-settlement', async () => {
  const { repo, stripe, app } = setup();
  const notaryId = notaryIdForEmail('p@notaire.ca');
  await repo.putNotary({ id: notaryId, email: 'p@notaire.ca', status: 'active', label: 'Étude P' });
  await repo.put({
    id: 'x1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2400, basePrice: 2000,
    status: 'ouverte', paymentStatus: 'authorized', paymentIntentId: 'pi_old', courriel: 'client@x.ca',
    propositions: [{ id: 'p1', notaryId, etude: 'Étude P', montant: 2600, delta: 200, status: 'en_attente', createdAt: TODAY }],
  });
  const clientAuth = { authorization: 'Bearer ' + signToken('x1', NOW_MS + 60_000, SCOPES.CLIENT) };

  const res = await app.handle({
    method: 'POST', path: '/client/propositions/accept', headers: clientAuth,
    body: JSON.stringify({ id: 'x1', dateISO: '2026-08-20', propositionId: 'p1' }),
  });
  assert.equal(res.statusCode, 200);
  await flush(); // the cancel is fire-and-forget

  const bid = await repo.get('x1', '2026-08-20');
  assert.equal(bid.status, 'retenue');
  assert.equal(bid.montant, 2600);
  assert.equal(bid.paymentStatus, 'a_reautoriser', 'the old hold cannot settle the NEW amount');
  // The client's card is released immediately — never left blocked for ~7 days
  // on an amount that will never be captured.
  assert.equal(stripe.calls.cancels.length, 1);
  assert.equal(stripe.calls.cancels[0].paymentIntentId, 'pi_old');
  assert.equal(stripe.calls.cancels[0].bidId, 'x1');
});

test('a normal accept neither cancels nor captures the hold — it waits for the signing (ADR 0015)', async () => {
  const { repo, stripe, app } = setup();
  const { auth } = await activeSession(app, stripe, 'q@notaire.ca');
  await repo.put({
    id: 'z1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2400,
    status: 'ouverte', paymentStatus: 'authorized', paymentIntentId: 'pi_z', courriel: 'c@x.ca',
  });
  const res = parse(await app.handle({
    method: 'POST', path: '/notary/bids/accept', headers: auth,
    body: JSON.stringify({ id: 'z1', dateISO: '2026-08-20' }),
  }));
  await flush();
  assert.equal(res.courriel, 'c@x.ca', 'the dossier is released');
  assert.equal(stripe.calls.cancels.length, 0, 'the hold is kept for the settlement at signing');
  assert.equal(stripe.calls.transfers.length, 0, 'nothing is captured at accept');
  const bid = await repo.get('z1', '2026-08-20');
  assert.equal(bid.paymentStatus, 'authorized', 'the authorization survives the accept untouched');
});

test('le prix d’un acte ne vit QUE dans la facturation — le domaine n’en sait rien', () => {
  // Le prix du service de Nota est une affaire de facturation. La TARIFICATION
  // du domaine (services, paliers, validation) ne doit jamais exprimer une part
  // d'un acte, pour que la frontière déontologique reste nette là où se fait le
  // calcul notarial. L'ADR 0011 a ensuite ajouté au domaine le module de
  // PARRAINAGE — un remerciement forfaitaire (`REFERRAL.commission`) qui ne
  // touche ni le prix du client ni les honoraires du notaire — et la garde
  // excise donc cette section clairement délimitée (sa bannière jusqu'à la
  // suivante) en tenant toute AUTRE ligne du domaine à la règle d'origine.
  const forbidden = /commission|percentage|per[-_ ]?cent|application[_ ]?fee|ristourne/i;
  const domainSrc = readFileSync(new URL('../../../packages/domain/index.js', import.meta.url), 'utf8');
  const withoutReferral = domainSrc
    .replace(/\/\/ --- Partner referrals -[\s\S]*?(?=\/\/ --- Reminder schedule)/, '');
  assert.ok(
    domainSrc.includes('// --- Partner referrals'),
    'the referral section marker moved — update this guard rather than letting it silently skip'
  );
  assert.ok(!forbidden.test(withoutReferral), '@nota/domain pricing must not express a commission concept');

  // La couche facturation, elle, porte le prix de Nota — et RIEN qui ressemble
  // à un taux : plus de `commissionFor`, plus de `commissionRate` (ADR 0031).
  const billing = createBilling({ repo: createMemoryRepo(), stripe: fakeStripe() });
  assert.equal(typeof billing.completeAct, 'function');
  assert.equal(typeof billing.quoteOffer, 'function');
  assert.equal(billing.commissionRate, undefined);
  assert.equal(billing.commissionFor, undefined);
});

// --- Le prix de Nota, décidé par Nota (ADR 0031) -----------------------------
// Le levier n'est plus une cote traduite en pourcentage : c'est UN montant, le
// même pour tous. Ces tests tiennent le MÉCANISME — d'où vient le prix, quand
// il est relu, ce qu'un registre write-once en garde.

// Un notaire intégré par le vrai chemin Stripe, puis doté du dossier que la
// cote lirait s'il en restait une à lire.
async function activeNotaryWithRecord(billing, repo, email, record = {}) {
  const id = NID(email);
  await billing.connectNotary({ email });
  await billing.handleWebhook(JSON.stringify(accountUpdated('evt_' + id, id, true)), 'good');
  if (Object.keys(record).length) {
    await repo.putNotary({ ...(await repo.getNotary(id)), ...record });
  }
  return id;
}

// Un dossier qui coche tout ce que la cote récompensait.
const FORT = {
  ratingSum: 4.9 * 40, ratingCount: 40,
  actsCompleted: 80, actsByService: { refinancement: 50, financement: 30 },
  proposalsCount: 60, acceptsCount: 0, declinesCount: 3,
  rayonKm: 50, urgences: true,
  lienCNQ: 'https://www.cnq.org/fiche/9/', prefixe: 'G1R',
  createdAt: '2025-01-01T00:00:00.000Z', lastSeenAt: NOW,
};
// Le même notaire, privé de tout ce que la cote récompensait.
const FAIBLE = {
  ratingSum: 0, ratingCount: 0, actsCompleted: 0, actsByService: {},
  proposalsCount: 0, acceptsCount: 0, declinesCount: 12,
  rayonKm: 0, urgences: false, lienCNQ: null, prefixe: null,
  createdAt: NOW, lastSeenAt: NOW,
};

test('ART. 29.1 — deux dossiers aux antipodes paient le MÊME prix, sur les deux chemins de règlement', async () => {
  const { repo, stripe, billing } = setup();
  const fort = await activeNotaryWithRecord(billing, repo, 'top@example.ca', FORT);
  const faible = await activeNotaryWithRecord(billing, repo, 'none@example.ca', FAIBLE);

  // La créance hors plateforme.
  const a = await billing.completeAct({ notaryId: fort, bidId: 'BID#T1', actAmount: 2000 });
  const b = await billing.completeAct({ notaryId: faible, bidId: 'BID#T2', actAmount: 2000 });
  assert.equal(a.commissionCents, PRIX);
  assert.equal(b.commissionCents, PRIX, 'un dossier vide ne coûte pas plus cher qu’un dossier plein');
  assert.equal((await repo.getNotary(fort)).commissionCentsDue, PRIX);

  // La capture.
  const paidA = await billing.payNotaryOnAccept({ notaryId: fort, bidId: 'BID#T3', actAmount: 1000, paymentIntentId: 'pi_a' });
  const paidB = await billing.payNotaryOnAccept({ notaryId: faible, bidId: 'BID#T4', actAmount: 1000, paymentIntentId: 'pi_b' });
  assert.equal(paidA.commissionCents, PRIX);
  assert.equal(paidB.commissionCents, PRIX);
  assert.equal(stripe.calls.transfers[0].applicationFeeCents, stripe.calls.transfers[1].applicationFeeCents);
});

test('le prix ne bouge pas avec la valeur de l’acte — un pourcentage, lui, bougerait', async () => {
  const { repo, billing } = setup();
  const id = await activeNotaryWithRecord(billing, repo, 'echelle@example.ca', FORT);
  const petit = await billing.completeAct({ notaryId: id, bidId: 'p', actAmount: 900 });
  const gros = await billing.completeAct({ notaryId: id, bidId: 'g', actAmount: 9000 });
  assert.equal(petit.commissionCents, PRIX);
  assert.equal(gros.commissionCents, PRIX);
  assert.equal(petit.honorairesCents, 90_000);
  assert.equal(gros.honorairesCents, 900_000, 'seuls les honoraires suivent le montant offert');
});

test('un prix stocké par l’admin tarife l’acte suivant ; une remise à zéro rend le défaut', async () => {
  const { repo, billing } = setup();
  const id = await activeNotaryWithRecord(billing, repo, 'prix@example.ca', FAIBLE);
  assert.equal((await billing.completeAct({ notaryId: id, bidId: 'px1', actAmount: 1000 })).commissionCents, PRIX);

  // Nota décide : 250 $.
  await repo.putPrixNotaConfig({ prixCents: 25_000 }, NOW);
  assert.equal((await billing.completeAct({ notaryId: id, bidId: 'px2', actAmount: 1000 })).commissionCents, 25_000);

  // Remise à zéro : le prix stocké disparaît, le défaut gouverne de nouveau.
  await repo.deletePrixNotaConfig();
  assert.equal((await billing.completeAct({ notaryId: id, bidId: 'px3', actAmount: 1000 })).commissionCents, PRIX);
});

test('un prix stocké illisible ne fait jamais tomber la tarification', async () => {
  const { repo, billing } = setup();
  const id = await activeNotaryWithRecord(billing, repo, 'casse@example.ca', FAIBLE);
  // Une donnée bricolée, une migration à moitié faite, un vieil item de barème :
  // tout ce qui n'est pas un entier de cents se lit comme ABSENT.
  await repo.putPrixNotaConfig({ prixCents: 'oups' }, NOW);
  assert.equal((await billing.completeAct({ notaryId: id, bidId: 'kz', actAmount: 1000 })).commissionCents, PRIX);
});

test('une reprise garde le montant du registre même si le prix a changé entre les tentatives', async () => {
  const { repo, billing } = setup();
  const id = await activeNotaryWithRecord(billing, repo, 'replay@example.ca', FORT);
  const first = await billing.completeAct({ notaryId: id, bidId: 'RP', actAmount: 2000 });
  assert.equal(first.commissionCents, PRIX);
  // Nota double son prix entre les deux tentatives…
  await repo.putPrixNotaConfig({ prixCents: PRIX * 2 }, NOW);
  // …mais la reprise répond ce qui a réellement été facturé : un registre
  // write-once ne se réécrit pas.
  const again = await billing.completeAct({ notaryId: id, bidId: 'RP', actAmount: 2000 });
  assert.equal(again.alreadyCompleted, true);
  assert.equal(again.commissionCents, PRIX);
});
