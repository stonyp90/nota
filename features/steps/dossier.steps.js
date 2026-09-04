'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

// --- Lead readiness: price before documents (ADR 0010) ------------------------
// Driven straight through the domain's leadReadiness(), the single source of
// truth the web dossier reads. `saved` mirrors the per-service intake map:
// pricing answers under __pricing, consent under __consent, documents by id.

// The required answers of each act, all at their zero-cost values.
const REQUIRED_ANSWERS = {
  refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
  financement: { valeur_pret: 250000, contexte: 'propriete_detenue', succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
};

Given('un dossier {string} avec les réponses tarifaires obligatoires', function (serviceId) {
  this.dossierServiceId = serviceId;
  assert.ok(REQUIRED_ANSWERS[serviceId], 'acte inconnu des scénarios : ' + serviceId);
  this.dossierSaved = { __pricing: { ...REQUIRED_ANSWERS[serviceId] } };
});

Given('la réponse tarifaire {string} vaut {string}', function (critere, valeur) {
  this.dossierSaved.__pricing = { ...(this.dossierSaved.__pricing || {}), [critere]: valeur };
});

Given('un dossier {string} sans réponse tarifaire', function (serviceId) {
  this.dossierServiceId = serviceId;
  this.dossierSaved = {};
});

Given('le consentement au partage du dossier', function () {
  this.dossierSaved.__consent = true;
});

Given('le document {string} marqué {string}', function (docId, marque) {
  // The marker is the domain's own constant — the scenario pins its value.
  assert.equal(this.domain.DOSSIER_TRANSMIS, marque, 'marqueur « transmis autrement » inattendu');
  this.dossierSaved[docId] = marque;
});

When('j\'évalue l\'état du dossier', function () {
  this.readiness = this.domain.leadReadiness(this.dossierServiceId, this.dossierSaved);
});

// The caller opts in: the pricing answers are passed explicitly (the dossier's
// own __pricing is never read implicitly by leadReadiness).
When('j\'évalue l\'état du dossier selon les réponses tarifaires', function () {
  const pricing = this.dossierSaved.__pricing;
  this.readiness = this.domain.leadReadiness(this.dossierServiceId, this.dossierSaved, pricing);
  this.dossierItems = this.domain.dossierItems(this.dossierServiceId, pricing);
});

function documentNom(domain, serviceId, docId) {
  const d = domain.serviceById(serviceId).documents.find((x) => x.id === docId);
  assert.ok(d, 'document inconnu du catalogue : ' + docId);
  return d.nom;
}

Then('le document {string} est demandé', function (docId) {
  const nom = documentNom(this.domain, this.dossierServiceId, docId);
  assert.ok(this.readiness.missing.includes(nom), nom + ' devrait figurer dans la liste : ' + JSON.stringify(this.readiness.missing));
});

Then('le document {string} n\'est pas demandé', function (docId) {
  const nom = documentNom(this.domain, this.dossierServiceId, docId);
  assert.ok(!this.readiness.missing.includes(nom), nom + ' ne devrait pas être demandé : ' + JSON.stringify(this.readiness.missing));
});

Then('la liste du dossier porte une note pour {string}', function (docId) {
  const item = (this.dossierItems || []).find((it) => it.id === docId);
  assert.ok(item, 'aucun élément ' + docId + ' dans la liste du dossier');
  assert.equal(item.kind, 'note', 'attendu une note, pas un téléversement : ' + JSON.stringify(item));
  assert.ok(item.aide && item.aide.length > 0, 'la note explique pourquoi rien n\'est demandé');
});

Then('la demande est prête', function () {
  assert.equal(this.readiness.ready, true, 'readiness: ' + JSON.stringify(this.readiness));
});

Then('la demande n\'est pas prête', function () {
  assert.equal(this.readiness.ready, false, 'readiness: ' + JSON.stringify(this.readiness));
});

Then('aucun document n\'est fourni', function () {
  assert.equal(this.readiness.done, 0, 'aucun élément du dossier ne devrait être fourni');
});

Then('exactement {int} document est fourni', function (count) {
  assert.equal(this.readiness.done, count);
});
