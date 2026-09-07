'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

const domain = require('../../packages/domain/index.js');

// L'assistant de la messagerie (ADR 0046). Le SCÉNARIO dicte ce que le modèle
// rend ; ces pas n'observent que ce que le reste du système en fait — le fil,
// son statut, le courriel de l'opérateur, et le garde-fou du domaine. Aucun
// SDK, aucun réseau : `createFakeAssistant` est branché par le monde.

// --- Étant donné -------------------------------------------------------------

Given('la messagerie a un assistant', function () {
  // Un assistant par défaut, muet : chaque scénario dit ensuite ce qu'il rend.
  this.enableAssistant(() => ({ repond: true, niveau: 1, motif: null, texte: 'Bonjour.' }));
});

Given('la messagerie n\'a pas d\'assistant', function () {
  // L'état d'un déploiement sans clé : le monde reconstruit l'app sans port.
  this.enableAssistant(null);
});

Given('l\'assistant sait répondre {string}', function (texte) {
  this.enableAssistant(() => ({ repond: true, niveau: 2, motif: null, texte }));
});

Given('l\'assistant passe la main pour le motif {string}', function (motif) {
  this.enableAssistant(() => ({
    repond: false,
    niveau: null,
    motif,
    texte: 'Celle-là mérite une vraie réponse — je la passe à Anthony.',
  }));
});

Given('l\'assistant est en panne', function () {
  this.enableAssistant(() => ({ throw: 'le modèle est injoignable' }));
});

// --- Quand -------------------------------------------------------------------

When('un visiteur écrit {string} dans la messagerie', async function (texte) {
  this.derniereQuestion = texte;
  await this.request({
    method: 'POST',
    path: '/support/messages',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texte }),
  });
  this.supportBody = this.responseJson;
  this.supportThreadId = this.supportBody.threadId;
});

// --- Alors -------------------------------------------------------------------

Then('le visiteur reçoit une réponse tout de suite', function () {
  assert.equal(this.response.statusCode, 201, 'corps: ' + this.response.body);
  assert.ok(this.supportBody.reponse, 'la réponse voyage dans la même requête');
  assert.ok(String(this.supportBody.reponse.texte || '').trim().length > 0);
  assert.equal(this.supportBody.escalade, false);
});

Then('la réponse est signée par l\'assistant, pas par une personne', function () {
  assert.equal(this.supportBody.reponse.de, domain.SUPPORT_FROM.ASSISTANT);
  assert.notEqual(this.supportBody.reponse.de, domain.SUPPORT_FROM.NOTA);
});

Then('le visiteur est prévenu qu\'une personne reprend la question', function () {
  assert.equal(this.response.statusCode, 201, 'corps: ' + this.response.body);
  assert.equal(this.supportBody.escalade, true);
  assert.ok(String(this.supportBody.reponse.texte || '').trim().length > 10);
});

Then('l\'opérateur ne reçoit aucun courriel', function () {
  const pour = this.mailer.sent.filter((m) => m.to === this.operatorEmail);
  assert.equal(pour.length, 0, 'courriels reçus : ' + JSON.stringify(pour.map((m) => m.subject)));
});

Then('l\'opérateur reçoit un courriel', function () {
  const pour = this.mailer.sent.filter((m) => m.to === this.operatorEmail);
  assert.equal(pour.length, 1, 'courriels reçus : ' + pour.length);
});

Then('l\'opérateur reçoit un courriel d\'escalade', function () {
  const pour = this.mailer.sent.filter((m) => m.to === this.operatorEmail);
  assert.equal(pour.length, 1, 'courriels reçus : ' + pour.length);
  // Le gabarit d'escalade dit POURQUOI il arrive : c'est ce qui le distingue
  // de la copie de chaque question qu'il remplace.
  assert.match(pour[0].text, /Pourquoi vous/, 'le courriel dit pourquoi il arrive');
  this.mailEscalade = pour[0];
});

Then('le courriel porte la question du visiteur', function () {
  assert.match(this.mailEscalade.text, new RegExp(escapeRe(this.derniereQuestion)));
});

Then('le courriel porte un lien de réponse signé', function () {
  assert.match(this.mailEscalade.html, /#reponse=/, 'le lien de réponse de l’ADR 0026');
});

Then('le fil de soutien reste {string}', async function (statut) {
  const attendu = statut === 'à répondre' ? domain.SUPPORT_STATUT.A_REPONDRE : statut;
  const fil = await this.repo.getSupportThread(this.supportThreadId);
  assert.equal(fil.statut, attendu);
});

Then('le fil est marqué comme escaladé', async function () {
  const fil = await this.repo.getSupportThread(this.supportThreadId);
  assert.equal(fil.escalade, true);
});

Then('le fil de soutien ne porte qu\'un seul message', async function () {
  const fil = await this.repo.getSupportThread(this.supportThreadId);
  assert.equal(fil.messages.length, 1, 'aucune bulle inventée sans assistant');
  assert.equal(this.supportBody.reponse, undefined);
});

Then('la réponse envoyée au visiteur ne contient pas {string}', function (interdit) {
  const texte = String((this.supportBody.reponse && this.supportBody.reponse.texte) || '');
  assert.ok(!new RegExp(escapeRe(interdit), 'i').test(texte), 'la réponse contenait « ' + interdit + ' »');
});

Then('l\'invite du modèle porte le prix annoncé de chaque service', function () {
  const invite = this.assistantPort.calls[0].systeme;
  for (const svc of domain.SERVICES) {
    const total = domain.prixAnnonce(svc.id).totalCents;
    assert.ok(invite.includes(String(total)), `le total ${total} de ${svc.id} manque à l’invite`);
  }
});

Then('l\'invite du modèle nomme la personne qui reprend la main', function () {
  assert.match(this.assistantPort.calls[0].systeme, /Anthony/);
});

Then('l\'invite du modèle interdit de conseiller', function () {
  const invite = this.assistantPort.calls[0].systeme;
  assert.match(invite, /Nota n’est pas notaire/);
  assert.match(invite, /vous devriez/i);
});

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
