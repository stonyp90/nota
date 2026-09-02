'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');

// Même poignée de main que les autres suites notaire : un lien de connexion,
// un jeton de session, mis en cache pour le scénario.
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

const oui = (v) => String(v || '').trim().toLowerCase() === 'oui';

// --- Étant donné : le dossier que la cote lit réellement ---------------------

Given('le dossier du notaire {string} est:', async function (email, table) {
  const r = table.hashes()[0];
  const id = notaryIdForEmail(email);
  const profile = await this.repo.getNotary(id);
  assert.ok(profile, 'notaire inconnu: ' + email);
  const actsByService = {};
  if (Number(r.refinancement)) actsByService.refinancement = Number(r.refinancement);
  if (Number(r.financement)) actsByService.financement = Number(r.financement);
  await this.repo.putNotary({
    ...profile,
    ratingSum: Number(r.note) * Number(r.avis),
    ratingCount: Number(r.avis),
    actsCompleted: Number(r.actes),
    actsByService,
    proposalsCount: Number(r.repondu),
    acceptsCount: 0,
    declinesCount: Number(r.declinees),
    rayonKm: Number(r.rayonKm),
    urgences: oui(r.urgences),
    lienCNQ: oui(r.fiche) ? 'https://www.cnq.org/trouver-un-notaire/fiche/1/' : null,
    prefixe: r.secteur || null,
    createdAt: r.membreDepuis + 'T00:00:00.000Z',
    lastSeenAt: this.today + 'T00:00:00.000Z',
  });
});

// --- Quand : le notaire regarde ce que Nota lui dit de lui-même --------------

When('le notaire {string} consulte son espace', async function (email) {
  const token = await notarySession(this, email);
  await this.request({ method: 'GET', path: '/notary/bids', headers: { authorization: 'Bearer ' + token }, query: {} });
  assert.equal(this.response.statusCode, 200, this.response.body);
  this.console = this.responseJson;
});

When('le notaire {string} consulte son relevé', async function (email) {
  const token = await notarySession(this, email);
  await this.request({ method: 'GET', path: '/notary/acts', headers: { authorization: 'Bearer ' + token }, query: {} });
  assert.equal(this.response.statusCode, 200, this.response.body);
  this.releve = this.responseJson;
});

// Le client rouvre son offre avec son propre jeton : c'est là qu'il voit qui
// lui propose quoi. Jamais une cote, jamais une note — art. 70 C.déont.,
// ADR 0030 : ce qui descend vers le client est FACTUEL.
When('le client consulte son offre', async function () {
  assert.ok(this.clientToken, "aucun jeton client — l'offre doit être publiée avec un courriel");
  const bid = this.lastBid;
  await this.request({
    method: 'GET',
    path: '/client/bid',
    headers: { authorization: 'Bearer ' + this.clientToken },
    query: { id: bid.id, dateISO: bid.dateISO },
  });
  assert.equal(this.response.statusCode, 200, this.response.body);
});

// --- Alors : la cote, telle que le notaire la lit ---------------------------

Then('sa cote est inférieure à {int}', function (seuil) {
  assert.ok(this.console.cote.cote < seuil, 'cote = ' + this.console.cote.cote);
});

Then('sa cote est supérieure à {int}', function (seuil) {
  assert.ok(this.console.cote.cote > seuil, 'cote = ' + this.console.cote.cote);
});

Then('sa cote détaille les axes {string}', function (liste) {
  const attendus = liste.split(',').map((s) => s.trim());
  assert.deepEqual(this.console.cote.axes.map((a) => a.id), attendus);
  for (const axe of this.console.cote.axes) {
    assert.ok(axe.nom, 'chaque axe se nomme en français');
    assert.ok(axe.detail && typeof axe.detail === 'object', 'et s’explique par des chiffres');
  }
});

Then('la somme des axes égale la cote affichée', function () {
  const somme = this.console.cote.axes.reduce((t, a) => t + a.points, 0);
  assert.equal(Math.round(somme), this.console.cote.cote);
});

Then('le total des maximums est {int}', function (total) {
  assert.equal(this.console.cote.axes.reduce((t, a) => t + a.max, 0), total);
});

// --- Alors : le relevé du notaire -------------------------------------------

Then('le relevé porte {int} acte', function (n) {
  assert.equal(this.releve.actes.length, n);
  assert.equal(this.releve.totaux.actes, n);
});

// ADR 0030 — l'article 70 du Code de déontologie interdit au notaire de
// permettre que soit utilisé un témoignage d'appui qui le concerne. Aucune
// moyenne, aucun compte d'avis, aucune cote ne descend donc vers un client.
Then('la proposition ne porte ni note, ni avis, ni cote', function () {
  const props = this.responseJson.propositions;
  assert.ok(props && props.length, 'aucune proposition visible côté client');
  assert.equal(props[0].rating, undefined, 'aucune moyenne d’étoiles');
  assert.equal(props[0].cote, undefined, 'aucune cote');
  assert.equal(JSON.stringify(this.responseJson).includes('"avis"'), false, 'aucun compte d’avis');
});

Then("la proposition porte des faits vérifiables : l'Ordre et le nombre d'actes", function () {
  const p = this.responseJson.propositions[0];
  assert.equal(typeof p.cnq, 'boolean', 'l’appartenance au tableau de la Chambre');
  assert.ok(Number.isInteger(p.actes), 'le nombre d’actes portés');
  assert.ok(p.etude, 'et l’étude qui propose');
});

// --- Alors : le parcours complet --------------------------------------------

Then('l\'offre publiée porte le palier {string}', function (tier) {
  assert.equal(this.lastBid.tier, tier, 'le délai décide du palier — ' + JSON.stringify(this.lastBid.tier));
});

// Un avis à 5 doit peser : la moyenne bayésienne monte au-dessus de l'a priori
// du notaire qui n'a encore rien reçu.
Then("sa satisfaction pèse plus que celle d'un notaire sans avis", function () {
  const axe = this.console.cote.axes.find((a) => a.id === 'satisfaction');
  const vierge = this.domain.notaryScore({}).axes.find((a) => a.id === 'satisfaction');
  assert.ok(axe.points > vierge.points, axe.points + ' devrait dépasser ' + vierge.points);
  assert.equal(axe.detail.avis, 1);
  assert.equal(axe.detail.note, 5);
});

Then('son axe {string} compte {int} acte', function (id, actes) {
  const axe = this.console.cote.axes.find((a) => a.id === id);
  assert.ok(axe, 'axe inconnu: ' + id);
  assert.equal(axe.detail.actes, actes);
  assert.ok(axe.points > 0, 'un acte porté vaut des points');
});

// Une volée de mauvaises notes et de déclins, entre l'engagement et la
// signature. Avant l'ADR 0031 il fallait s'en protéger — la rétention gravait
// un taux sur l'offre. Aujourd'hui le prix ne dépend plus du notaire : la cote
// peut s'effondrer, l'argent ne bouge pas (art. 29.1 C.déont.).
When("la cote du notaire {string} s'effondre", async function (email) {
  const id = notaryIdForEmail(email);
  const profile = await this.repo.getNotary(id);
  await this.repo.putNotary({ ...profile, ratingSum: 2 * 30, ratingCount: 30, declinesCount: 80, proposalsCount: 0, acceptsCount: 0 });
});
