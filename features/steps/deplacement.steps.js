'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

// --- Le catalogue (pur domaine) ----------------------------------------------

Then('le catalogue des déplacements compte {int} bandes', function (count) {
  assert.equal(this.domain.DEPLACEMENTS.length, count);
});

Then('la bande {string} est la base sans majoration', function (id) {
  const d = this.domain.deplacementById(id);
  assert.ok(d, 'bande inconnue du catalogue : ' + id);
  assert.equal(d.add, 0, 'la base ne majore pas le prix');
  for (const autre of this.domain.DEPLACEMENTS) {
    if (autre.id !== id) assert.ok(autre.add > 0, autre.id + ' devrait majorer le prix');
  }
});

Then('la bande {string} porte la prime la plus ferme, à {int} $', function (id, add) {
  const d = this.domain.deplacementById(id);
  assert.ok(d, 'bande inconnue du catalogue : ' + id);
  assert.equal(d.add, add);
  assert.equal(d.urgence, true, 'l\'urgence est déclarée, jamais implicite');
  for (const autre of this.domain.DEPLACEMENTS) {
    if (autre.id !== id) assert.ok(autre.add < add, autre.id + ' ne devrait pas dépasser la prime d\'urgence');
  }
});

Then('le prix de base {string} avec le déplacement {string} est {int}', function (serviceId, deplacement, attendu) {
  const answers = {
    refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale' },
    financement: { valeur_pret: 250000, contexte: 'propriete_detenue', approbation_bancaire: 'obtenue', preteur: 'banque_nationale' },
  }[serviceId];
  assert.equal(this.domain.computeBasePrice(serviceId, { ...answers, deplacement }), attendu);
});

When('je valide une offre à {int} $ sans déclarer de déplacement', function (montant) {
  const dateISO = this.domain.addDays(this.today, 10);
  this.result = this.domain.validateOffer({
    serviceId: this.input.serviceId,
    dateISO,
    montant,
    todayISO: this.today,
    pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale' },
  });
});

// --- Ce qu'un profil de notaire peut servir (notaryCanServe) -----------------

Given('un notaire sans profil de déplacement', function () {
  this.profil = null;
});

Given('un notaire au rayon de {int} km', function (rayonKm) {
  this.profil = { rayonKm, urgences: false };
});

When('le notaire accepte les urgences en ligne', function () {
  this.profil = { ...(this.profil || {}), urgences: true };
});

Then('le notaire peut servir la bande {string}', function (id) {
  assert.ok(this.domain.deplacementById(id), 'bande inconnue du catalogue : ' + id);
  assert.equal(this.domain.notaryCanServe(id, this.profil), true, id + ' devrait atteindre ce notaire');
});

Then('le notaire ne peut pas servir la bande {string}', function (id) {
  assert.ok(this.domain.deplacementById(id), 'bande inconnue du catalogue : ' + id);
  assert.equal(this.domain.notaryCanServe(id, this.profil), false, id + ' ne devrait pas atteindre ce notaire');
});

Then('le notaire peut servir une offre sans bande déclarée', function () {
  // Une offre publiée avant la question n'a pas de bande : tolérance héritée,
  // comme pour le prêteur — elle atteint tout le monde.
  assert.equal(this.domain.notaryCanServe(undefined, this.profil), true);
});

// --- Le profil du notaire (validateNotaryProfile) ----------------------------

When('un notaire déclare un rayon de {string} km', function (rayon) {
  this.result = this.domain.validateNotaryProfile({ rayonKm: rayon });
});

Then('le profil est refusé avec l\'erreur {string}', function (code) {
  assert.equal(this.result.ok, false);
  const codes = this.result.errors.map((e) => e.code);
  assert.ok(codes.includes(code), `attendu ${code}, obtenu ${JSON.stringify(codes)}`);
});

Then('le profil retient un rayon de {int} km', function (rayonKm) {
  assert.equal(this.result.ok, true, 'erreurs: ' + JSON.stringify(this.result.errors));
  assert.equal(this.result.rayonKm, rayonKm, 'la chaîne du formulaire devient un nombre');
});

// --- La distance mesurée (ADR 0025) ------------------------------------------

Then('la distance entre les secteurs {string} et {string} est d\'environ {int} km', function (a, b, km) {
  const d = this.domain.fsaDistanceKm(a, b);
  assert.ok(d != null, `les deux secteurs doivent être au catalogue des centroïdes (${a}, ${b})`);
  assert.ok(Math.abs(d - km) <= 3, `≈ ${km} km attendu, obtenu ${d}`);
});

Given('un notaire au rayon de {int} km dont l\'étude est au secteur {string}', function (rayonKm, prefixe) {
  this.profil = { rayonKm, urgences: false, prefixe };
});

Then('le notaire peut servir la bande {string} pour un client au secteur {string}', function (id, prefixe) {
  assert.equal(this.domain.notaryCanServe(id, this.profil, prefixe), true,
    id + ' devrait atteindre ce notaire depuis ' + prefixe);
});

Then('le notaire ne peut pas servir la bande {string} pour un client au secteur {string}', function (id, prefixe) {
  assert.equal(this.domain.notaryCanServe(id, this.profil, prefixe), false,
    id + ' ne devrait pas atteindre ce notaire depuis ' + prefixe);
});

When('un notaire déclare le secteur d\'étude {string}', function (prefixe) {
  this.result = this.domain.validateNotaryProfile({ prefixe });
});

Then('le profil retient le secteur d\'étude {string}', function (prefixe) {
  assert.equal(this.result.ok, true, 'erreurs: ' + JSON.stringify(this.result.errors));
  assert.equal(this.result.prefixe, prefixe, 'normalisé comme le secteur des offres');
});
