'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

// --- Given ------------------------------------------------------------------

Given('le service {string}', function (serviceId) {
  this.input.serviceId = serviceId;
});

// --- POST /bids -------------------------------------------------------------

// Default mandatory pricing params per service so a publication validates unless
// a scenario explicitly overrides them.
const DEFAULT_PRICING = {
  refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale' },
  financement: { valeur_pret: 250000, contexte: 'propriete_detenue', approbation_bancaire: 'obtenue', preteur: 'banque_nationale' },
};
async function publish(world, body) {
  await world.request({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({ pricing: DEFAULT_PRICING[body.serviceId], ...body }),
  });
}

When('je publie une enchère pour {string} le {string} à {int}', async function (serviceId, dateISO, montant) {
  await publish(this, { serviceId, dateISO, montant });
});

When(
  'je publie une enchère anonyme au nom de {string} avec préfixe {string} pour {string} le {string} à {int}',
  async function (nom, prefixe, serviceId, dateISO, montant) {
    await publish(this, { serviceId, dateISO, montant, anonyme: true, nom, prefixe });
  }
);

When(
  'je publie une enchère nominative au nom de {string} avec préfixe {string} pour {string} le {string} à {int}',
  async function (nom, prefixe, serviceId, dateISO, montant) {
    await publish(this, { serviceId, dateISO, montant, anonyme: false, nom, prefixe });
  }
);

// --- Response assertions ----------------------------------------------------

Then('la réponse a le statut {int}', function (statut) {
  assert.equal(this.response.statusCode, statut, 'corps: ' + this.response.body);
});

Then('la réponse contient le code d\'erreur {string}', function (code) {
  const codes = (this.responseJson.errors || []).map((e) => e.code);
  assert.ok(codes.includes(code), `attendu ${code}, obtenu ${JSON.stringify(codes)}`);
});

// --- Carnet (GET /bids?month=) ----------------------------------------------

async function carnet(world, month) {
  await world.request({ method: 'GET', path: '/bids', query: { month } });
  assert.equal(world.response.statusCode, 200, 'corps: ' + world.response.body);
  return world.responseJson.bids;
}

Then('l\'enchère apparaît dans le carnet du mois {string}', async function (month) {
  const bids = await carnet(this, month);
  assert.equal(bids.length, 1, 'exactement une enchère attendue dans le carnet');
});

Then('dans le carnet du mois {string}, l\'enchère n\'expose aucun nom', async function (month) {
  const bids = await carnet(this, month);
  assert.equal(bids.length, 1);
  assert.equal(bids[0].nom, null, 'une enchère anonyme ne doit pas divulguer de nom');
  assert.equal(bids[0].anonyme, true);
});

Then('dans le carnet du mois {string}, l\'enchère expose le préfixe {string}', async function (month, prefixe) {
  const bids = await carnet(this, month);
  assert.equal(bids.length, 1);
  assert.equal(bids[0].prefixe, prefixe);
});

Then('dans le carnet du mois {string}, l\'enchère expose le nom {string}', async function (month, nom) {
  const bids = await carnet(this, month);
  assert.equal(bids.length, 1);
  assert.equal(bids[0].nom, nom);
  assert.equal(bids[0].anonyme, false);
});
