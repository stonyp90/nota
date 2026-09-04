'use strict';

/**
 * Les steps de LA CAUTION (ADR 0035).
 *
 * Deux gestes, séparés parce qu'une autorisation de carte ne vit que ~7 jours :
 *
 *   enregistrement — à la publication, la banque valide la carte et Stripe la
 *                    conserve. RIEN n'est réservé ; l'offre devient visible.
 *   caution        — deux jours avant la signature, le geste quotidien réserve
 *                    le total des deux lignes, hors session, sur cette carte.
 *
 * Ces steps passent par les portes réelles — le webhook, la Lambda de rappels,
 * la route d'annulation — parce qu'un scénario qui écrirait l'état directement
 * dans le dépôt ne prouverait rien du mécanisme livré.
 */

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');

// Même poignée de main notaire que les autres suites : un lien, un jeton, mis
// en cache pour la durée du scénario.
async function notarySession(world, email) {
  world.notaryTokens = world.notaryTokens || {};
  if (world.notaryTokens[email]) return world.notaryTokens[email];
  const req = await world.app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email }) });
  assert.equal(req.statusCode, 200, 'demande de lien notaire: ' + req.body);
  const res = await world.app.handle({ method: 'POST', path: '/notary/session/verify', body: JSON.stringify({ token: JSON.parse(req.body).devToken }) });
  assert.equal(res.statusCode, 200, 'ouverture de session notaire: ' + res.body);
  world.notaryTokens[email] = JSON.parse(res.body).token;
  return world.notaryTokens[email];
}

function lastBid(world) {
  assert.ok(world.lastBid, 'aucune offre publiée dans ce scénario');
  return world.lastBid;
}

// --- Given / When : ce que le client et la banque font -----------------------

// Le client termine la session Stripe d'enregistrement : Stripe annonce le
// SetupIntent réussi, l'API lie la carte à l'offre et celle-ci devient visible.
Given('le client donne sa carte', async function () {
  const bid = lastBid(this);
  await this.request({
    method: 'POST',
    path: '/stripe/webhook',
    headers: { 'stripe-signature': 'test-signature' },
    body: JSON.stringify({
      id: 'evt_setup_' + bid.id,
      type: 'setup_intent.succeeded',
      data: {
        object: {
          id: 'seti_' + bid.id,
          customer: 'cus_' + bid.id,
          payment_method: 'pm_' + bid.id,
          metadata: { bidId: bid.id, bidDate: bid.dateISO },
        },
      },
    }),
  });
  assert.equal(this.response.statusCode, 200, 'enregistrement de la carte: ' + this.response.body);
  await this.flush();
});

// La banque décline au moment de poser la caution — hors session, le client
// n'est pas là pour s'authentifier.
Given('la banque du client refuse la carte', function () {
  this.stripe.placeOfferAuthorization = async (args) => {
    this.stripe.calls.holds.push(args);
    const err = new Error('Your card was declined.');
    err.code = 'card_declined';
    throw err;
  };
});

// --- Then : l'état de la caution ---------------------------------------------

Then("la carte du client est enregistrée, sans qu'aucune somme soit bloquée", function () {
  const bid = lastBid(this);
  const c = this.stripe.calls;
  assert.equal(c.setups.filter((x) => x.bidId === bid.id).length, 1, 'un enregistrement de carte attendu');
  assert.equal(c.authorizations.filter((x) => x.bidId === bid.id).length, 0, 'aucune autorisation ne doit être posée à la publication');
  assert.equal(c.holds.length, 0, 'aucune caution ne doit être posée à la publication');
});

Then("aucune caution n'est posée", function () {
  const bid = lastBid(this);
  assert.equal(
    this.stripe.calls.authorizations.filter((x) => x.bidId === bid.id).length,
    0,
    'aucune autorisation attendue: ' + JSON.stringify(this.stripe.calls.authorizations)
  );
  const posees = this.reminderResult ? this.reminderResult.caution.posee : 0;
  assert.equal(posees, 0, 'le geste quotidien ne devait poser aucune caution');
});

Then("l'offre reste confiée au notaire {string}", async function (email) {
  const bid = lastBid(this);
  const stored = await this.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.status, this.domain.STATUS.RETENUE, "l'acte ne doit pas être retiré au notaire");
  assert.equal(stored.notaryId, notaryIdForEmail(email));
});

// --- Then : le carnet public --------------------------------------------------

async function carnet(world, month) {
  await world.request({ method: 'GET', path: '/bids', query: { month } });
  assert.equal(world.response.statusCode, 200, world.response.body);
  return world.responseJson.bids;
}

Then('le carnet public du mois {string} ne montre aucune offre', async function (month) {
  assert.deepEqual(await carnet(this, month), []);
});

Then('le carnet public du mois {string} montre {int} offre', async function (month, n) {
  assert.equal((await carnet(this, month)).length, n);
});

// --- Then : l'argent ----------------------------------------------------------

Then('les frais sont prélevés hors session sur la carte enregistrée', function () {
  const bid = lastBid(this);
  const hs = this.stripe.calls.offSessionFees.filter((x) => x.bidId === bid.id);
  assert.equal(hs.length, 1, 'un prélèvement hors session attendu: ' + JSON.stringify(this.stripe.calls.offSessionFees));
  assert.equal(this.stripe.calls.feeCaptures.length, 0, "aucune capture partielle : il n'y a pas de caution à capturer");
});

// --- La reprise de carte (ADR 0035) -------------------------------------------

// Le client, prévenu du refus, revient donner une autre carte. La route rouvre
// une session Stripe — enregistrement si la signature est lointaine,
// réservation immédiate si elle est proche : le serveur tranche, pas le client.
When('le client demande à enregistrer une autre carte', async function () {
  const bid = lastBid(this);
  await this.request({
    method: 'POST',
    path: '/client/bid/carte',
    headers: { authorization: 'Bearer ' + this.clientToken },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
});

Then('une nouvelle session de paiement lui est ouverte', function () {
  assert.equal(this.response.statusCode, 200, this.response.body);
  assert.ok(this.responseJson.checkoutUrl, 'une adresse de paiement est attendue');
  // La clé d'idempotence doit être NEUVE : sans elle, Stripe rejouerait la
  // session déjà terminée avec la carte refusée, et la reprise serait un lien
  // mort.
  const bid = lastBid(this);
  const ouvertes = this.stripe.calls.setups.concat(this.stripe.calls.authorizations).filter((x) => x.bidId === bid.id);
  assert.ok(ouvertes.length >= 2, 'une session de plus que celle de la publication: ' + ouvertes.length);
  assert.ok(ouvertes[ouvertes.length - 1].cle, 'la dernière session doit porter une clé de reprise');
});

// --- Les offres HÉRITÉES : une réservation qui a dépassé sa durée de vie ------
//
// Le cas ordinaire d'AVANT l'ADR 0035 : la caution était posée à la publication,
// pour une date à J+30. L'autorisation est morte bien avant la signature. Le
// scénario la fabrique telle qu'elle dort en base — par le dépôt, parce que
// aucune porte du produit ne sait plus la produire.
async function vieillirLaCaution(world, jours, { sansCarte = false } = {}) {
  const bid = lastBid(world);
  const stored = await world.repo.get(bid.id, bid.dateISO);
  await world.repo.update({
    ...stored,
    paymentStatus: 'authorized',
    paymentIntentId: 'pi_vieux_' + bid.id,
    authorizedAt: world.domain.addDays(world.today, -jours) + 'T14:00:00.000Z',
    ...(sansCarte ? { paymentCustomerId: null, paymentMethodId: null, setupIntentId: null } : {}),
  });
}

Given("la caution de l'offre a été posée il y a {int} jours", async function (jours) {
  await vieillirLaCaution(this, jours);
});

// L'offre telle que l'ancien modèle la laissait vraiment : autorisée à la
// publication, sans qu'aucune carte n'ait jamais été conservée.
Given("la caution de l'offre a été posée il y a {int} jours, sans carte enregistrée", async function (jours) {
  await vieillirLaCaution(this, jours, { sansCarte: true });
});

// Ce que le notaire LIT dans sa console — pas ce que le dépôt contient : une
// garantie qu'on ne peut pas voir n'en est pas une (ADR 0035 §3).
Then('le notaire {string} lit la garantie {string} sur son acte', async function (email, etat) {
  const bid = lastBid(this);
  const token = await notarySession(this, email);
  await this.request({ method: 'GET', path: '/notary/bids', headers: { authorization: 'Bearer ' + token }, query: {} });
  assert.equal(this.response.statusCode, 200, this.response.body);
  const acte = (this.responseJson.retained || []).find((r) => r.id === bid.id)
    || (this.responseJson.bids || []).find((b) => b.id === bid.id);
  assert.ok(acte, "l'acte doit être visible dans la console du notaire");
  assert.ok(acte.caution, 'aucun état de caution rendu au notaire');
  assert.equal(acte.caution.etat, etat, JSON.stringify(acte.caution));
});

// --- Des frais d'annulation REFUSÉS -------------------------------------------

Given("la banque du client refuse les frais d'annulation", function () {
  this.stripe.chargeCancellationFeeOffSession = async (args) => {
    this.stripe.calls.offSessionFees.push(args);
    const err = new Error('Your card was declined.');
    err.code = 'card_declined';
    throw err;
  };
});

Then('les frais de {int} $ sont inscrits comme NON perçus', function (frais) {
  const a = this.responseJson.bid.annulation;
  assert.ok(a, "l'annulation doit être INSCRITE, pas passée sous silence: " + this.response.body);
  assert.equal(a.frais, frais);
  assert.equal(a.percu, false);
  assert.equal(a.chargeId, null, "aucune charge n'a abouti : il n'y a rien à nommer");
});

Then("aucune créance n'est inscrite au notaire {string}", async function (email) {
  const profile = await this.repo.getNotary(notaryIdForEmail(email));
  assert.ok(profile, 'notaire inconnu: ' + email);
  assert.ok(
    !profile.dedommagementCentsDue,
    "Nota n'a rien encaissé : elle ne peut rien devoir au notaire"
  );
});

Then("la piste d'audit garde la trace des frais non perçus", async function () {
  const bid = lastBid(this);
  const journal = await this.repo.queryAuditByDay(this.today);
  const trace = journal.find((e) => e.action === 'annulation_frais' && e.meta && e.meta.bidId === bid.id);
  assert.ok(trace, "aucune trace d'audit — c'est précisément le trou");
  assert.equal(trace.meta.percu, false);
  assert.equal(trace.meta.mecanisme, 'hors_session');
});
