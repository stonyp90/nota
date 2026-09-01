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
// lui propose quoi — et, depuis l'ADR 0028, la cote de chacun.
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

// --- Alors : la cote, le partage, l'échelle ---------------------------------

Then('sa cote est inférieure à {int}', function (seuil) {
  assert.ok(this.console.cote.cote < seuil, 'cote = ' + this.console.cote.cote);
});

Then('sa cote est supérieure à {int}', function (seuil) {
  assert.ok(this.console.cote.cote > seuil, 'cote = ' + this.console.cote.cote);
});

Then('il garde {int} % de ce que le client paie', function (pct) {
  assert.equal(Math.round(this.console.commission.part * 100), pct);
  assert.equal(Math.round(this.console.commission.tauxEffectif * 100), 100 - pct, 'la part de Nota est le complément exact');
});

Then('le prochain palier lui est nommé avec les points qui lui manquent', function () {
  const p = this.console.commission.prochain;
  assert.ok(p, 'un notaire qui peut monter doit voir où');
  assert.ok(Number.isInteger(p.cote) && p.cote > this.console.cote.cote);
  assert.equal(p.manque, p.cote - this.console.cote.cote);
  assert.ok(p.part > this.console.commission.part, 'le palier suivant lui laisse davantage');
});

Then('aucun palier ne reste à atteindre', function () {
  assert.equal(this.console.commission.prochain, null);
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

Then("l'échelle publiée est:", function (table) {
  const attendu = table.hashes().map((r) => ({ cote: Number(r.cote), garde: Number(r.garde) }));
  const publie = this.console.commission.paliers.map((p) => ({ cote: p.cote, garde: Math.round(p.part * 100) }));
  assert.deepEqual(publie, attendu);
});

// --- Alors : la divulgation et l'audit --------------------------------------

Then('le relevé porte {int} acte', function (n) {
  assert.equal(this.releve.actes.length, n);
  assert.equal(this.releve.totaux.actes, n);
});

Then('la ligne du relevé montre {int} $ payés, {int} % retenus, {int} $ à Nota et {int} $ au notaire', function (montant, pct, commission, net) {
  const l = this.releve.actes[0];
  assert.equal(l.montant, montant);
  assert.equal(Math.round(l.taux * 100), pct);
  assert.equal(l.commission, commission);
  assert.equal(l.net, net);
  assert.equal(l.commission + l.net, l.montant, 'la ligne s’additionne — rien ne se perd');
});

Then('la ligne du relevé nomme la cote qui a mérité ce taux', function () {
  assert.ok(Number.isInteger(this.releve.actes[0].cote), 'la cote est figée avec l’acte');
});

Then("une entrée d'audit {string} existe avec {int} $, un taux et une cote", async function (action, montant) {
  const entries = await this.repo.queryAuditByDay(this.today);
  const e = entries.find((x) => x.action === action);
  assert.ok(e, 'aucune entrée d’audit « ' + action + ' » : ' + JSON.stringify(entries.map((x) => x.action)));
  assert.equal(e.meta.montant, montant);
  assert.ok(typeof e.meta.taux === 'number');
  assert.ok(Number.isInteger(e.meta.cote));
  assert.equal(e.meta.commission + e.meta.net, montant, 'la trace s’additionne');
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

// --- Le taux gravé à l'engagement -------------------------------------------

Then("l'offre porte le taux de l'engagement", async function () {
  const bid = await this.repo.get(this.lastBid.id, this.lastBid.dateISO);
  assert.ok(typeof bid.tauxRetenu === 'number', 'aucun taux gravé sur l’offre');
  assert.ok(Number.isInteger(bid.coteRetenue), 'ni la cote qui l’a mérité');
  this.tauxRetenu = bid.tauxRetenu;
});

// Une volée de mauvaises notes et de déclins, entre l'engagement et la
// signature : la cote s'effondre, le taux promis ne bouge pas.
When("la cote du notaire {string} s'effondre", async function (email) {
  const id = notaryIdForEmail(email);
  const profile = await this.repo.getNotary(id);
  await this.repo.putNotary({ ...profile, ratingSum: 2 * 30, ratingCount: 30, declinesCount: 80, proposalsCount: 0, acceptsCount: 0 });
});
