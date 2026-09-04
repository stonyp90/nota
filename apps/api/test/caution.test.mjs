// LA CAUTION QUI SURVIT À L'ATTENTE — ADR 0035.
//
// Le défaut mesuré : « payé à la signature » (ADR 0015) reposait sur une
// autorisation de carte posée à la PUBLICATION. Une autorisation Stripe vit
// ~7 jours ; le palier « standard » du carnet commence à 15 jours. Sur la
// majorité des dates publiées, la garantie mourait donc avant la signature,
// sans que le client ni le notaire n'en sachent rien.
//
// La forme retenue : la carte est ENREGISTRÉE à la publication (SetupIntent,
// hors session) et la somme n'est réservée qu'à J-CAUTION_LEAD_DAYS, par le
// geste quotidien de la Lambda de rappels — au moment où l'autorisation peut
// vivre jusqu'à la signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const { runReminders } = require('../src/reminders.js');
const { createNotifier } = require('../src/notifications.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
const { DEFAULT_PRIX_CENTS: PRIX } = require('../src/prix-nota-config.js');
import { activeNotary } from '../test-support/notary-fixture.mjs';
import { notarySignIn } from '../test-support/notary-session.mjs';

const TODAY = '2026-09-10';
const NOW = '2026-09-10T14:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const loin = domain.addDays(TODAY, 30); // palier standard — bien au-delà des 7 jours
const proche = domain.addDays(TODAY, domain.CAUTION_LEAD_DAYS); // déjà dans la fenêtre

/**
 * Le double du port Stripe — même surface que src/stripe-port.js, aucun SDK,
 * aucun réseau. `refuse` fait échouer la pose de la caution comme le ferait une
 * carte refusée hors session.
 */
function fakeStripe({ refuse = false, refuseTransfer = false } = {}) {
  const calls = { setups: [], authorizations: [], holds: [], transfers: [], fees: [], offSessionFees: [], cancels: [], accounts: [], links: [] };
  return {
    calls,
    async createConnectAccount(a) { calls.accounts.push(a); return { accountId: 'acct_' + a.notaryId }; },
    async createOnboardingLink(a) { calls.links.push(a); return { url: 'https://connect.test/' + a.accountId }; },
    async createOfferAuthorization(a) { calls.authorizations.push(a); return { sessionId: 'cs_' + a.bidId, url: 'https://checkout.test/pay/' + a.bidId }; },
    async createOfferSetup(a) { calls.setups.push(a); return { sessionId: 'cs_setup_' + a.bidId, url: 'https://checkout.test/setup/' + a.bidId }; },
    async placeOfferAuthorization(a) {
      calls.holds.push(a);
      if (refuse) {
        const err = new Error('Your card was declined.');
        err.code = 'card_declined';
        throw err;
      }
      return { paymentIntentId: 'pi_' + a.bidId, status: 'requires_capture' };
    },
    async captureAndTransfer(a) {
      calls.transfers.push(a);
      return { paymentIntentId: a.paymentIntentId, chargeId: 'ch_' + a.bidId, transferId: 'tr_' + a.bidId, applicationFeeCents: a.applicationFeeCents, netCents: a.amountCents - a.applicationFeeCents };
    },
    async captureCancellationFee(a) { calls.fees.push(a); return { paymentIntentId: a.paymentIntentId, chargeId: 'ch_fee_' + a.bidId, transferId: a.connectAccountId ? 'tr_fee_' + a.bidId : null }; },
    async chargeCancellationFeeOffSession(a) {
      calls.offSessionFees.push(a);
      if (refuseTransfer) {
        const err = new Error('transfer failed');
        err.captured = true;
        err.chargeId = 'ch_hs_' + a.bidId;
        throw err;
      }
      return { paymentIntentId: 'pi_fee_' + a.bidId, chargeId: 'ch_hs_' + a.bidId, transferId: a.connectAccountId ? 'tr_hs_' + a.bidId : null };
    },
    async cancelOfferAuthorization(a) { calls.cancels.push(a); return { id: a.paymentIntentId, status: 'canceled' }; },
    constructEvent(raw, sig) {
      if (!sig || sig === 'bad') throw new Error('signature verification failed');
      return JSON.parse(raw);
    },
  };
}

function setup(opts = {}) {
  const repo = createMemoryRepo([]);
  const stripe = fakeStripe(opts);
  const billing = createBilling({ repo, stripe, now: () => NOW });
  const app = createApp(repo, {
    siteUrl: 'https://nota.test', now: () => TODAY, nowMs: () => NOW_MS, billing,
  });
  return { repo, stripe, billing, app };
}

const parse = (r) => JSON.parse(r.body);
const PRICING = { valeur_pret: 300000, approbation_bancaire: 'obtenue', preteur: 'banque_nationale', succession: 'non', deplacement: 'client_50' };

const poster = (app, dateISO, over = {}) =>
  app.handle({
    method: 'POST', path: '/bids', query: {}, headers: {},
    body: JSON.stringify({ serviceId: 'refinancement', dateISO, montant: 2000, prefixe: 'G1R', courriel: 'client@exemple.ca', nom: 'Cliente Test', pricing: PRICING, ...over }),
  });

const setupSucceeded = (id, bidId, bidDate) => ({
  id, type: 'setup_intent.succeeded',
  data: { object: { id: 'seti_' + bidId, customer: 'cus_' + bidId, payment_method: 'pm_' + bidId, metadata: { bidId, bidDate } } },
});
const checkoutSetupCompleted = (id, bidId, bidDate) => ({
  id, type: 'checkout.session.completed',
  data: { object: { mode: 'setup', customer: 'cus_' + bidId, setup_intent: 'seti_' + bidId, metadata: { bidId, bidDate } } },
});

const webhook = (app, event, sig = 'good') =>
  app.handle({ method: 'POST', path: '/stripe/webhook', query: {}, headers: { 'stripe-signature': sig }, body: JSON.stringify(event) });

// --- 1. la publication ---------------------------------------------------------

test('une date lointaine n’autorise plus rien : la carte est ENREGISTRÉE, pas réservée', async () => {
  const { stripe, app, repo } = setup();
  const res = await poster(app, loin);
  assert.equal(res.statusCode, 201, res.body);
  const body = parse(res);
  assert.equal(body.paymentStatus, 'pending', 'une offre publiée reste PENDING tant que la carte n’est pas donnée');
  assert.match(body.checkoutUrl, /^https:\/\/checkout\.test\/setup\//);
  assert.equal(stripe.calls.setups.length, 1, 'un SetupIntent, pas une autorisation');
  assert.equal(stripe.calls.authorizations.length, 0, 'aucune autorisation ne doit pourrir 30 jours');
  // Le montant total voyage quand même : ce que la carte devra porter est dit
  // au client sur la page Stripe (art. 68 — le prix annoncé est le prix facturé).
  assert.equal(stripe.calls.setups[0].amountCents, 200000 + PRIX);
  const [stored] = await repo.listByMonth(loin.slice(0, 7));
  assert.equal(stored.paymentStatus, 'pending');
});

test('une date DÉJÀ dans la fenêtre réserve tout de suite — l’autorisation vivra jusqu’à la signature', async () => {
  const { stripe, app } = setup();
  const res = await poster(app, proche);
  assert.equal(res.statusCode, 201, res.body);
  assert.match(parse(res).checkoutUrl, /^https:\/\/checkout\.test\/pay\//);
  assert.equal(stripe.calls.authorizations.length, 1);
  assert.equal(stripe.calls.setups.length, 0);
  assert.equal(stripe.calls.authorizations[0].amountCents, 200000 + PRIX);
});

// --- 2. l'enregistrement de la carte -------------------------------------------

test('setup_intent.succeeded enregistre la carte : l’offre devient vivante SANS caution', async () => {
  const { app, repo } = setup();
  await poster(app, loin);
  const [bid] = await repo.listByMonth(loin.slice(0, 7));

  const res = await webhook(app, setupSucceeded('evt_s1', bid.id, bid.dateISO));
  assert.equal(res.statusCode, 200, res.body);

  const after = await repo.get(bid.id, bid.dateISO);
  assert.equal(after.paymentStatus, 'enregistre');
  assert.equal(after.paymentCustomerId, 'cus_' + bid.id);
  assert.equal(after.paymentMethodId, 'pm_' + bid.id);
  assert.equal(after.paymentIntentId || null, null, 'aucune somme n’est réservée à ce stade');

  // Et l'offre est visible : le notaire ne voit jamais une demande dont la
  // carte n'a pas été validée par la banque, mais il voit celle-ci.
  const feed = parse(await app.handle({ method: 'GET', path: '/bids', query: { month: loin.slice(0, 7) }, headers: {} }));
  assert.equal(feed.bids.length, 1);
});

test('checkout.session.completed en mode setup enregistre aussi, sans jamais prétendre à une autorisation', async () => {
  const { app, repo } = setup();
  await poster(app, loin);
  const [bid] = await repo.listByMonth(loin.slice(0, 7));

  await webhook(app, checkoutSetupCompleted('evt_c1', bid.id, bid.dateISO));
  const after = await repo.get(bid.id, bid.dateISO);
  assert.equal(after.paymentStatus, 'enregistre');
  assert.equal(after.paymentIntentId || null, null);
});

// --- 3. le geste quotidien : la caution -----------------------------------------

function fakeNotifier() {
  const calls = { reminders: [], caution: [] };
  return {
    calls,
    async onReminderDue() { return { sent: false }; },
    async onCautionRefusee(bid, detail) { calls.caution.push({ bid, detail }); return { sent: true }; },
  };
}

async function offreEnregistree({ jours, statut = 'ouverte', notaryId = null, stripeOpts } = {}) {
  const t = setup(stripeOpts);
  const dateISO = domain.addDays(TODAY, jours);
  const posted = parse(await poster(t.app, dateISO));
  const [bid] = await t.repo.listByMonth(dateISO.slice(0, 7));
  await webhook(t.app, setupSucceeded('evt_' + bid.id, bid.id, bid.dateISO));
  if (statut !== 'ouverte') {
    const stored = await t.repo.get(bid.id, bid.dateISO);
    await t.repo.update({ ...stored, status: statut, notaryId });
  }
  return { ...t, clientToken: posted.clientToken, bid: await t.repo.get(bid.id, bid.dateISO) };
}

test('le geste quotidien pose la caution à J-2 — le TOTAL des deux lignes, hors session', async () => {
  const { repo, stripe, billing, bid } = await offreEnregistree({ jours: domain.CAUTION_LEAD_DAYS });
  const notifier = fakeNotifier();

  const res = await runReminders({ repo, notifier, billing, now: () => TODAY });
  assert.equal(res.caution.due, 1);
  assert.equal(res.caution.posee, 1);
  assert.equal(res.caution.refusee, 0);

  assert.equal(stripe.calls.holds.length, 1);
  assert.equal(stripe.calls.holds[0].amountCents, 200000 + PRIX);
  assert.equal(stripe.calls.holds[0].customerId, 'cus_' + bid.id);
  assert.equal(stripe.calls.holds[0].paymentMethodId, 'pm_' + bid.id);

  const after = await repo.get(bid.id, bid.dateISO);
  assert.equal(after.paymentStatus, 'authorized');
  assert.equal(after.paymentIntentId, 'pi_' + bid.id);
});

test('avant la fenêtre, le geste quotidien ne pose RIEN — une caution posée trop tôt pourrit', async () => {
  const { repo, stripe, billing } = await offreEnregistree({ jours: domain.CAUTION_LEAD_DAYS + 1 });
  const res = await runReminders({ repo, notifier: fakeNotifier(), billing, now: () => TODAY });
  assert.equal(res.caution.due, 0);
  assert.equal(stripe.calls.holds.length, 0);
});

test('la caution d’un acte RETENU est posée elle aussi — c’est là qu’elle compte le plus', async () => {
  const { repo, stripe, billing, bid } = await offreEnregistree({
    jours: domain.CAUTION_LEAD_DAYS, statut: 'retenue', notaryId: notaryIdForEmail('n@x.ca'),
  });
  const res = await runReminders({ repo, notifier: fakeNotifier(), billing, now: () => TODAY });
  assert.equal(res.caution.posee, 1, 'listOpenBids exclut les actes retenus : la caution ne peut pas s’y fier');
  assert.equal(stripe.calls.holds.length, 1);
  assert.equal((await repo.get(bid.id, bid.dateISO)).paymentStatus, 'authorized');
});

test('une caution déjà posée n’est jamais posée deux fois', async () => {
  const { repo, stripe, billing } = await offreEnregistree({ jours: domain.CAUTION_LEAD_DAYS });
  await runReminders({ repo, notifier: fakeNotifier(), billing, now: () => TODAY });
  await runReminders({ repo, notifier: fakeNotifier(), billing, now: () => TODAY });
  assert.equal(stripe.calls.holds.length, 1);
});

// --- 4. la carte refusée ---------------------------------------------------------

test('une carte refusée à J-2 ne fait JAMAIS tomber le geste quotidien, et prévient les deux parties', async () => {
  const notaryId = notaryIdForEmail('n@x.ca');
  const { repo, billing, bid } = await offreEnregistree({
    jours: domain.CAUTION_LEAD_DAYS, statut: 'retenue', notaryId, stripeOpts: { refuse: true },
  });
  await repo.putNotary(activeNotary('n@x.ca'));

  const notifier = fakeNotifier();
  const res = await runReminders({ repo, notifier, billing, now: () => TODAY });

  assert.equal(res.caution.due, 1);
  assert.equal(res.caution.posee, 0);
  assert.equal(res.caution.refusee, 1);
  assert.deepEqual(res.errors, [], 'un refus de carte est un fait d’exploitation, pas une exception');

  const after = await repo.get(bid.id, bid.dateISO);
  assert.equal(after.paymentStatus, 'enregistre', 'l’offre reste vivante : le client peut encore changer de carte');
  assert.ok(after.cautionRefus, 'le refus est inscrit sur l’offre');
  assert.equal(after.cautionRefus.code, 'card_declined');

  assert.equal(notifier.calls.caution.length, 1, 'le client ET le notaire doivent l’apprendre');
  assert.equal(notifier.calls.caution[0].bid.id, bid.id);
});

test('un refus déjà signalé ne re-prévient pas tous les jours', async () => {
  const { repo, billing } = await offreEnregistree({ jours: domain.CAUTION_LEAD_DAYS, stripeOpts: { refuse: true } });
  const notifier = fakeNotifier();
  await runReminders({ repo, notifier, billing, now: () => TODAY });
  await runReminders({ repo, notifier, billing, now: () => TODAY });
  assert.equal(notifier.calls.caution.length, 1);
});

test('une livraison tardive de l’enregistrement ne rétrograde JAMAIS une caution déjà posée', async () => {
  const { repo, app, bid } = await offreEnregistree({ jours: 1 });
  await repo.authorizeBid(bid.id, bid.dateISO, { paymentIntentId: 'pi_live', authorizedAt: TODAY });
  // Stripe rejoue l'enregistrement (autre id d'événement, même carte).
  await webhook(app, setupSucceeded('evt_tardif', bid.id, bid.dateISO));
  const after = await repo.get(bid.id, bid.dateISO);
  assert.equal(after.paymentStatus, 'authorized', 'la caution vivante prime sur un événement en retard');
  assert.equal(after.paymentIntentId, 'pi_live');
});

test('une carte enregistrée SANS moyen de paiement se rapporte — le webhook manque, la caution ne se pose pas en silence', async () => {
  // Ce que produit un point de terminaison Stripe abonné à
  // `checkout.session.completed` mais PAS à `setup_intent.succeeded` : le
  // client Stripe est connu, la carte ne l'est pas.
  const t = setup();
  const dateISO = domain.addDays(TODAY, domain.CAUTION_LEAD_DAYS);
  await poster(t.app, dateISO);
  const [bid] = await t.repo.listByMonth(dateISO.slice(0, 7));
  await webhook(t.app, checkoutSetupCompleted('evt_partiel', bid.id, bid.dateISO));

  const res = await runReminders({ repo: t.repo, notifier: fakeNotifier(), billing: t.billing, now: () => TODAY });
  assert.equal(res.caution.due, 1);
  assert.equal(res.caution.posee, 0);
  assert.equal(t.stripe.calls.holds.length, 0, 'rien n’est tenté sans moyen de paiement');
  assert.equal(res.errors.length, 1, 'le lot doit RAPPORTER ce cas plutôt que de l’avaler');
  assert.match(res.errors[0].error, /carte_absente/);
});

test('sans port de facturation, le geste quotidien reste exactement ce qu’il était', async () => {
  const { repo } = await offreEnregistree({ jours: domain.CAUTION_LEAD_DAYS });
  const res = await runReminders({ repo, notifier: fakeNotifier(), now: () => TODAY });
  assert.deepEqual(res.caution, { due: 0, posee: 0, refusee: 0 });
});

// --- 3 bis. ce que le notaire voit AVANT de retenir --------------------------------

test('le notaire lit l’état de la garantie avant de retenir — carte validée, caution posée le J-2', async () => {
  const { repo, app, bid } = await offreEnregistree({ jours: 10 });
  await repo.putNotary(activeNotary('n@x.ca', { rayonKm: 50, urgences: true }));
  const { token } = await notarySignIn(app, 'n@x.ca');

  const feed = parse(await app.handle({
    method: 'GET', path: '/notary/bids', query: {}, headers: { authorization: 'Bearer ' + token },
  }));
  const mine = feed.bids.find((b) => b.id === bid.id);
  assert.ok(mine, 'la demande doit être au carnet du notaire');
  assert.deepEqual(mine.caution, { etat: 'enregistree', poseeLe: domain.addDays(bid.dateISO, -domain.CAUTION_LEAD_DAYS) });
  // Et la règle générale, comme donnée : ADR 0033 §4, tout est exposé avant le clic.
  assert.equal(feed.conditions.caution.jours, domain.CAUTION_LEAD_DAYS);
  assert.equal(feed.conditions.caution.carteValidee, true);
});

// --- 4 bis. les courriels réels (gabarits + notifieur) -----------------------------

test('le courriel d’enregistrement ne prétend PAS que le paiement est autorisé', async () => {
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.test', operatorEmail: null, now: () => TODAY });
  const bid = { id: 'b1', serviceId: 'refinancement', dateISO: loin, montant: 2000, courriel: 'client@exemple.ca', paymentStatus: 'enregistre' };

  await notifier.onAccountEvent({ id: 'evt_1', type: 'setup_intent.succeeded', data: { object: {} } }, null, bid);
  const [msg] = mailer.sent;
  assert.ok(msg, 'aucun courriel envoyé');
  assert.match(msg.subject, /carte est enregistrée|card is saved/i);
  assert.doesNotMatch(msg.subject, /autorisé|authorized/i, 'rien n’est autorisé tant que la caution n’est pas posée');
});

test('un refus de caution écrit aux DEUX parties, une seule fois', async () => {
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.test', operatorEmail: null, now: () => TODAY });
  const notaryId = notaryIdForEmail('n@x.ca');
  await repo.putNotary(activeNotary('n@x.ca'));
  const bid = { id: 'b2', serviceId: 'refinancement', dateISO: loin, montant: 2000, courriel: 'client@exemple.ca', notaryId, status: 'retenue' };

  await notifier.onCautionRefusee(bid, { code: 'card_declined' });
  await notifier.onCautionRefusee(bid, { code: 'card_declined' });

  const to = mailer.sent.map((m) => m.to).sort();
  assert.deepEqual(to, ['client@exemple.ca', 'n@x.ca'], 'le client ET le notaire, chacun une fois');
  const notaire = mailer.sent.find((m) => m.to === 'n@x.ca');
  assert.match(notaire.subject, /Caution non posée|Hold not placed/);
});

// --- 5. le règlement ---------------------------------------------------------------

test('bout en bout : carte enregistrée → caution à J-2 → capture à la signature', async () => {
  const notaryId = notaryIdForEmail('n@x.ca');
  const { repo, stripe, billing, app, bid } = await offreEnregistree({
    jours: domain.CAUTION_LEAD_DAYS, statut: 'retenue', notaryId,
  });
  await repo.putNotary(activeNotary('n@x.ca', { chargesEnabled: true, connectAccountId: 'acct_' + notaryId }));
  await runReminders({ repo, notifier: fakeNotifier(), billing, now: () => TODAY });

  const live = await repo.get(bid.id, bid.dateISO);
  const paid = await billing.payNotaryOnAccept({
    notaryId, bidId: bid.id, actAmount: 2000, paymentIntentId: live.paymentIntentId, serviceId: 'refinancement',
  });
  assert.equal(paid.ok, true, JSON.stringify(paid.errors));
  // ART. 32.1 2° L.N. — le notaire reçoit ses honoraires ENTIERS.
  assert.equal(paid.netCents, 200000);
  assert.equal(stripe.calls.transfers[0].amountCents, 200000 + PRIX);
  void app;
});

// --- 6. les frais d'annulation (ADR 0023 + 0033) -----------------------------------

test('annuler tard SANS caution vivante prélève quand même les frais, hors session, et les verse au notaire', async () => {
  // Une annulation à J-10 : la caution n'est pas encore posée (elle ne l'est
  // qu'à J-2), mais la carte est enregistrée. Les frais du barème 4-14 jours
  // restent dus — et ils sont AU NOTAIRE (ADR 0033).
  const notaryId = notaryIdForEmail('n@x.ca');
  const { repo, stripe, billing, bid } = await offreEnregistree({ jours: 10, statut: 'retenue', notaryId });
  await repo.putNotary(activeNotary('n@x.ca', { chargesEnabled: true, connectAccountId: 'acct_' + notaryId }));

  const live = await repo.get(bid.id, bid.dateISO);
  const out = await billing.chargeCancellationFee({
    bidId: bid.id, amountCents: 20000, notaryId,
    customerId: live.paymentCustomerId, paymentMethodId: live.paymentMethodId,
  });
  assert.equal(out.ok, true);
  assert.equal(out.verse, true, 'Nota ne garde rien de ces frais');
  assert.equal(stripe.calls.offSessionFees.length, 1);
  assert.equal(stripe.calls.offSessionFees[0].amountCents, 20000);
  assert.equal(stripe.calls.offSessionFees[0].connectAccountId, 'acct_' + notaryId);
  assert.equal(stripe.calls.fees.length, 0, 'aucune capture partielle : il n’y a rien à capturer');
});

test('la capture partielle reste le mécanisme quand une caution EST vivante', async () => {
  const notaryId = notaryIdForEmail('n@x.ca');
  const { repo, stripe, billing } = await offreEnregistree({ jours: domain.CAUTION_LEAD_DAYS, statut: 'retenue', notaryId });
  await repo.putNotary(activeNotary('n@x.ca', { chargesEnabled: true, connectAccountId: 'acct_' + notaryId }));
  await runReminders({ repo, notifier: fakeNotifier(), billing, now: () => TODAY });

  const out = await billing.chargeCancellationFee({ paymentIntentId: 'pi_live', bidId: 'b1', amountCents: 60000, notaryId });
  assert.equal(out.ok, true);
  assert.equal(stripe.calls.fees.length, 1);
  assert.equal(stripe.calls.offSessionFees.length, 0);
});

test('la route d’annulation prélève et verse même sur une offre seulement ENREGISTRÉE', async () => {
  const notaryId = notaryIdForEmail('n@x.ca');
  const { repo, stripe, app, bid, clientToken } = await offreEnregistree({ jours: 10, statut: 'retenue', notaryId });
  await repo.putNotary(activeNotary('n@x.ca', { chargesEnabled: true, connectAccountId: 'acct_' + notaryId }));

  const res = await app.handle({
    method: 'POST', path: '/client/bid/cancel', query: {},
    headers: { authorization: 'Bearer ' + clientToken },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(res.statusCode, 200, res.body);
  // Palier 4-14 jours : 10 % des honoraires, prélevés hors session puisque
  // aucune caution n'est encore posée, et versés AU NOTAIRE (ADR 0033).
  assert.equal(stripe.calls.offSessionFees.length, 1);
  assert.equal(stripe.calls.offSessionFees[0].amountCents, 20000);
  assert.equal(stripe.calls.offSessionFees[0].connectAccountId, 'acct_' + notaryId);
  const annulation = parse(res).bid.annulation;
  assert.equal(annulation.frais, 200);
  assert.equal(annulation.dedommagement.verse, true);
});

test('GET /client/bid annonce les frais AVANT la confirmation, même sans caution posée', async () => {
  const notaryId = notaryIdForEmail('n@x.ca');
  const { app, bid, clientToken } = await offreEnregistree({ jours: 10, statut: 'retenue', notaryId });
  const res = await app.handle({
    method: 'GET', path: '/client/bid', query: { id: bid.id, dateISO: bid.dateISO },
    headers: { authorization: 'Bearer ' + clientToken },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).annulation.frais, 200, 'la divulgation fait partie du mécanisme (ADR 0023)');
});

// --- 7. l'acte renégocié (contre-proposition acceptée) ------------------------------
//
// Le trou que l'ADR 0035 laissait ouvert : quand le client accepte une
// contre-proposition, l'offre est retenue à un NOUVEAU montant et marquée
// `a_reautoriser` — l'ancienne autorisation ne peut pas régler le nouveau prix.
// Le geste quotidien ne regardait que les offres `enregistre` : la caution
// n'était donc JAMAIS posée sur ces actes-là, et le notaire qui avait bloqué sa
// journée retombait sur la créance de l'ADR 0029. C'est précisément le défaut
// que cet ADR prétend fermer, resté vivant sur ce chemin.

/** Publie, enregistre la carte, fait proposer un autre montant, et l'accepte. */
async function acteRenegocie({ jours, montant = 3200 }) {
  const t = setup();
  const dateISO = domain.addDays(TODAY, jours);
  const posted = parse(await poster(t.app, dateISO));
  const [seed] = await t.repo.listByMonth(dateISO.slice(0, 7));
  await webhook(t.app, setupSucceeded('evt_' + seed.id, seed.id, seed.dateISO));

  await t.repo.putNotary(activeNotary('n@x.ca', { rayonKm: 50, urgences: true, chargesEnabled: true, connectAccountId: 'acct_' + notaryIdForEmail('n@x.ca') }));
  const { token } = await notarySignIn(t.app, 'n@x.ca');
  const prop = await t.app.handle({
    method: 'POST', path: '/notary/bids/propose', query: {}, headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: seed.id, dateISO: seed.dateISO, montant }),
  });
  assert.equal(prop.statusCode, 200, prop.body);
  const propositionId = parse(prop).proposition.id;

  const acc = await t.app.handle({
    method: 'POST', path: '/client/propositions/accept', query: {},
    headers: { authorization: 'Bearer ' + posted.clientToken },
    body: JSON.stringify({ id: seed.id, dateISO: seed.dateISO, propositionId }),
  });
  assert.equal(acc.statusCode, 200, acc.body);
  return { ...t, clientToken: posted.clientToken, bid: await t.repo.get(seed.id, seed.dateISO), montant };
}

test('un acte RENÉGOCIÉ est cautionné lui aussi — sur le montant accepté, pas l’ancien', async () => {
  const { repo, stripe, billing, bid } = await acteRenegocie({ jours: domain.CAUTION_LEAD_DAYS });
  assert.equal(bid.paymentStatus, 'a_reautoriser', 'l’ancienne autorisation ne règle pas le nouveau montant');
  assert.equal(bid.montant, 3200);

  const res = await runReminders({ repo, notifier: fakeNotifier(), billing, now: () => TODAY });
  assert.equal(res.caution.posee, 1, 'le notaire a bloqué sa journée : la caution doit être posée');
  assert.equal(stripe.calls.holds[0].amountCents, 320000 + PRIX, 'la caution porte le montant ACCEPTÉ');

  const after = await repo.get(bid.id, bid.dateISO);
  assert.equal(after.paymentStatus, 'authorized');
});

test('annuler tard un acte RENÉGOCIÉ n’est pas gratuit — les frais suivent la carte enregistrée', async () => {
  const { app, stripe, bid, clientToken } = await acteRenegocie({ jours: 10 });
  const res = await app.handle({
    method: 'POST', path: '/client/bid/cancel', query: {},
    headers: { authorization: 'Bearer ' + clientToken },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(res.statusCode, 200, res.body);
  // Palier 4-14 jours : 10 % du montant accepté (3200 $), au notaire.
  assert.equal(parse(res).bid.annulation.frais, 320);
  assert.equal(stripe.calls.offSessionFees.length, 1, 'la carte enregistrée reste prélevable');
  assert.equal(stripe.calls.offSessionFees[0].amountCents, 32000);
});

// --- 8. reprendre la main sur sa carte ----------------------------------------------
//
// Le courriel de refus dit au client d'enregistrer une autre carte, et le geste
// quotidien réessaie jusqu'à la signature. Sans porte pour CHANGER de carte,
// les deux sont du théâtre : réessayer demain la même carte refusée donnera le
// même refus. C'est cette porte-là.

test('le client voit l’état de sa caution — c’est la même vérité que le notaire lit', async () => {
  const { app, repo, bid, clientToken } = await offreEnregistree({ jours: 10 });
  const stored = await repo.get(bid.id, bid.dateISO);
  await repo.markCautionRefusee(bid.id, bid.dateISO, { at: NOW, code: 'card_declined' });
  void stored;

  const res = await app.handle({
    method: 'GET', path: '/client/bid', query: { id: bid.id, dateISO: bid.dateISO },
    headers: { authorization: 'Bearer ' + clientToken },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).caution.etat, 'refusee');
});

test('après un refus, le client peut enregistrer une AUTRE carte', async () => {
  const { app, stripe, bid, clientToken } = await offreEnregistree({ jours: 10 });
  const res = await app.handle({
    method: 'POST', path: '/client/bid/carte', query: {},
    headers: { authorization: 'Bearer ' + clientToken },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.match(parse(res).checkoutUrl, /checkout\.test/);
  // Une date lointaine enregistre — elle ne bloque toujours rien.
  assert.equal(stripe.calls.setups.length, 2, 'une NOUVELLE session, pas celle de la publication');
  assert.notEqual(stripe.calls.setups[1].cle, undefined, 'la clé d’idempotence doit changer, sinon Stripe rejoue la session déjà terminée');
});

test('dans la fenêtre, changer de carte la BLOQUE tout de suite — la signature est dans deux jours', async () => {
  const { app, stripe, bid, clientToken } = await offreEnregistree({ jours: domain.CAUTION_LEAD_DAYS });
  const res = await app.handle({
    method: 'POST', path: '/client/bid/carte', query: {},
    headers: { authorization: 'Bearer ' + clientToken },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(res.statusCode, 200, res.body);
  // La publication en avait déjà ouvert une (la date était DÉJÀ dans la
  // fenêtre) : la reprise en ouvre une SECONDE, du même genre — une
  // réservation immédiate, pas un simple enregistrement qui ne bloquerait
  // rien à deux jours de la signature.
  assert.equal(parse(res).mode, 'paiement');
  assert.equal(stripe.calls.authorizations.length, 2);
  assert.equal(stripe.calls.setups.length, 0);
  assert.notEqual(stripe.calls.authorizations[1].cle, undefined, 'sans clé neuve, Stripe rejoue la session de la publication');
});

test('une offre annulée n’ouvre plus aucune session de paiement', async () => {
  const { app, repo, bid, clientToken } = await offreEnregistree({ jours: 10 });
  const stored = await repo.get(bid.id, bid.dateISO);
  await repo.update({ ...stored, status: domain.STATUS.ANNULEE });
  const res = await app.handle({
    method: 'POST', path: '/client/bid/carte', query: {},
    headers: { authorization: 'Bearer ' + clientToken },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(res.statusCode, 410, res.body);
});

test('la carte d’autrui ne s’enregistre pas : le jeton client est exigé', async () => {
  const { app, bid } = await offreEnregistree({ jours: 10 });
  const res = await app.handle({
    method: 'POST', path: '/client/bid/carte', query: {}, headers: {},
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(res.statusCode, 401, res.body);
});

test('une caution DÉJÀ vivante ne se redouble pas — bloquer deux fois la même carte serait un vol', async () => {
  const { app, stripe, billing, repo, bid, clientToken } = await offreEnregistree({ jours: domain.CAUTION_LEAD_DAYS });
  await runReminders({ repo, notifier: fakeNotifier(), billing, now: () => TODAY });
  const avant = stripe.calls.authorizations.length + stripe.calls.setups.length;

  const res = await app.handle({
    method: 'POST', path: '/client/bid/carte', query: {},
    headers: { authorization: 'Bearer ' + clientToken },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(parse(res).errors[0].code, 'caution_posee');
  assert.equal(stripe.calls.authorizations.length + stripe.calls.setups.length, avant, 'aucune session de plus');
});
