'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

// --- Lead readiness: price before documents (ADR 0010) ------------------------
// Driven straight through the domain's leadReadiness(), the single source of
// truth the web dossier reads. `saved` mirrors the per-service intake map:
// pricing answers under __pricing, consent under __consent, documents by id.

Given('un dossier {string} avec les réponses tarifaires obligatoires', function (serviceId) {
  this.dossierServiceId = serviceId;
  this.dossierSaved = {
    __pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' },
  };
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
