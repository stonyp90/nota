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
