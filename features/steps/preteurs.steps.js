'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');

// --- Session helper (same handshake as propositions.steps.js, cached) --------

async function notarySession(world, email) {
  world.notaryTokens = world.notaryTokens || {};
  if (world.notaryTokens[email]) return world.notaryTokens[email];
  const req = await world.app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email }) });
  assert.equal(req.statusCode, 200, 'demande de lien notaire: ' + req.body);
  const devToken = JSON.parse(req.body).devToken;
  assert.ok(devToken, 'le lien de connexion doit être renvoyé hors production: ' + req.body);
  const res = await world.app.handle({ method: 'POST', path: '/notary/session/verify', body: JSON.stringify({ token: devToken }) });
  assert.equal(res.statusCode, 200, 'ouverture de session notaire: ' + res.body);
  world.notaryTokens[email] = JSON.parse(res.body).token;
  return world.notaryTokens[email];
}

// --- Le catalogue (pur domaine) ----------------------------------------------

Then('le catalogue des prêteurs contient {string} non virtuel', function (id) {
  const l = this.domain.lenderById(id);
  assert.ok(l, 'prêteur inconnu du catalogue : ' + id);
  assert.equal(l.virtuel, false);
});

Then('le catalogue des prêteurs contient {string} virtuel', function (id) {
  const l = this.domain.lenderById(id);
  assert.ok(l, 'prêteur inconnu du catalogue : ' + id);
  assert.equal(l.virtuel, true);
});

Then('aucun prêteur du catalogue ne majore le prix, sauf le prêteur privé', function () {
  for (const l of this.domain.LENDERS) {
    if (l.id === 'prive') assert.ok(l.add > 0, 'le prêteur privé garde sa majoration');
    else assert.equal(l.add, 0, l.id + ' ne devrait pas majorer le prix');
  }
});

Then('le prix de base {string} avec le prêteur {string} est {int}', function (serviceId, preteur, attendu) {
  const answers = {
    refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' },
    financement: { valeur_pret: 250000, contexte: 'propriete_detenue', approbation_bancaire: 'obtenue' },
  }[serviceId];
  assert.equal(this.domain.computeBasePrice(serviceId, { ...answers, preteur }), attendu);
});

When('je valide une offre à {int} $ sans nommer de prêteur', function (montant) {
  const dateISO = this.domain.addDays(this.today, 10);
  this.result = this.domain.validateOffer({
    serviceId: this.input.serviceId,
    dateISO,
    montant,
    todayISO: this.today,
    pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' },
  });
});

When('je valide une offre à {int} $ avec le prêteur {string} sans nom', function (montant, preteur) {
  const dateISO = this.domain.addDays(this.today, 10);
  this.result = this.domain.validateOffer({
    serviceId: this.input.serviceId,
    dateISO,
    montant,
    todayISO: this.today,
    pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur },
  });
});

// --- L'offre, le fil du notaire, la conversation, le désistement -------------

When('un client publie une offre avec le prêteur {string} à {int} dans {int} jours', async function (preteur, montant, jours) {
  const dateISO = this.domain.addDays(this.today, jours);
  await this.request({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO, montant, courriel: 'client@exemple.ca',
      pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur },
    }),
  });
  assert.equal(this.response.statusCode, 201, 'publication: ' + this.response.body);
  const j = this.responseJson;
  this.lastBidId = j.bid.id;
  this.lastBid = j.bid;
  this.clientToken = j.clientToken;
});

async function notaryFeed(world, email) {
  const token = await notarySession(world, email);
  await world.request({ method: 'GET', path: '/notary/bids', headers: { authorization: 'Bearer ' + token }, query: {} });
  assert.equal(world.response.statusCode, 200, 'fil notaire: ' + world.response.body);
  return world.responseJson;
}

Then('le fil du notaire {string} nomme le prêteur {string} virtuel', async function (email, nom) {
  const feed = await notaryFeed(this, email);
  assert.equal(feed.bids.length, 1, 'une demande attendue dans le fil');
  assert.equal(feed.bids[0].preteur.nom, nom);
  assert.equal(feed.bids[0].preteur.virtuel, true);
});

When('un client publie une offre avec le prêteur {string} nommé {string} à {int} dans {int} jours', async function (preteur, nom, montant, jours) {
  const dateISO = this.domain.addDays(this.today, jours);
  await this.request({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO, montant, courriel: 'client@exemple.ca',
      pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur, preteur_autre: nom },
    }),
  });
  assert.equal(this.response.statusCode, 201, 'publication: ' + this.response.body);
  const j = this.responseJson;
  this.lastBidId = j.bid.id;
  this.lastBid = j.bid;
  this.clientToken = j.clientToken;
});

Then('le fil du notaire {string} nomme le prêteur {string}', async function (email, nom) {
  const feed = await notaryFeed(this, email);
  assert.equal(feed.bids.length, 1, 'une demande attendue dans le fil');
  assert.equal(feed.bids[0].preteur.nom, nom, 'le nom saisi par le client voyage jusqu\'au notaire');
});

When('le notaire {string} retient l\'offre', async function (email) {
  const token = await notarySession(this, email);
  await this.request({
    method: 'POST',
    path: '/notary/bids/accept',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: this.lastBid.id, dateISO: this.lastBid.dateISO }),
  });
  assert.equal(this.response.statusCode, 200, 'rétention: ' + this.response.body);
});

When('le notaire {string} écrit {string}', async function (email, texte) {
  const token = await notarySession(this, email);
  await this.request({
    method: 'POST',
    path: '/notary/bids/message',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: this.lastBid.id, dateISO: this.lastBid.dateISO, texte }),
  });
});

When('le client répond {string}', async function (texte) {
  await this.request({
    method: 'POST',
    path: '/client/bid/message',
    headers: { authorization: 'Bearer ' + this.clientToken },
    body: JSON.stringify({ id: this.lastBid.id, dateISO: this.lastBid.dateISO, texte }),
  });
});

Then('la conversation de l\'offre compte {int} messages', async function (count) {
  await this.request({
    method: 'GET',
    path: '/client/bid',
    headers: { authorization: 'Bearer ' + this.clientToken },
    query: { id: this.lastBid.id, dateISO: this.lastBid.dateISO },
  });
  assert.equal(this.response.statusCode, 200, this.response.body);
  assert.equal(this.responseJson.messages.length, count);
});

When('le notaire {string} se désiste avec le motif {string}', async function (email, motif) {
  const token = await notarySession(this, email);
  await this.request({
    method: 'POST',
    path: '/notary/bids/release',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: this.lastBid.id, dateISO: this.lastBid.dateISO, message: motif }),
  });
});

Then('l\'offre est revenue au carnet telle que publiée à {int}', async function (montant) {
  const stored = await this.repo.get(this.lastBid.id, this.lastBid.dateISO);
  assert.equal(stored.status, this.domain.STATUS.OUVERTE);
  assert.equal(stored.notaryId, null);
  assert.equal(stored.etude, null);
  assert.equal(stored.montant, montant, 'l\'offre du client reste intacte');
});

Then('le notaire {string} ne voit plus l\'offre dans son fil', async function (email) {
  const feed = await notaryFeed(this, email);
  assert.equal(feed.bids.length, 0, 'le fil devrait être vide');
  assert.equal(feed.retained.length, 0, 'plus rien de retenu');
  // Et son agenda (pointeurs de calendrier) est libéré.
  const events = await this.repo.listRetainedByNotary(notaryIdForEmail(email));
  assert.equal(events.length, 0);
});
