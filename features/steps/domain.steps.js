'use strict';

const assert = require('node:assert/strict');
const { When, Then } = require('@cucumber/cucumber');

// --- Tarification et paliers de temps ---------------------------------------

When('une signature est prévue dans {int} jours', function (jours) {
  this.result = this.domain.tierForDays(jours);
});

Then('le palier est {string}', function (palier) {
  assert.equal(this.result, palier);
});

// --- Format monétaire québécois ---------------------------------------------

When('je formate le montant {int}', function (dollars) {
  this.result = this.domain.money(dollars);
});

Then('l\'affichage est {string}', function (affichage) {
  // money() separates with a NO-BREAK space (U+00A0) so an amount never wraps
  // mid-number. A Gherkin table cannot carry that character legibly, so the
  // comparison normalizes it — the scenario below pins the real character.
  assert.equal(this.result.replace(/\u00A0/g, ' '), affichage);
});

// --- Plancher et plafond (validateOffer) ------------------------------------

When('je valide une offre de {int} $ pour une date valide', function (montant) {
  const dateISO = this.domain.addDays(this.today, 10); // 10 jours -> palier rapide
  const P = {
    refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
    financement: { valeur_pret: 250000, contexte: 'propriete_detenue', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', succession: 'non', deplacement: 'client_50' },
  };
  this.result = this.domain.validateOffer({
    serviceId: this.input.serviceId,
    dateISO,
    montant,
    todayISO: this.today,
    pricing: P[this.input.serviceId],
    prefixe: 'G1R', // required sector — these scenarios exercise the price rails
  });
});

Then('l\'offre est refusée', function () {
  assert.equal(this.result.ok, false);
});

Then('l\'offre est acceptée', function () {
  assert.equal(this.result.ok, true, 'erreurs: ' + JSON.stringify(this.result.errors));
});

Then('l\'erreur {string} est présente', function (code) {
  const codes = this.result.errors.map((e) => e.code);
  assert.ok(codes.includes(code), `attendu ${code}, obtenu ${JSON.stringify(codes)}`);
});

Then('le palier calculé n\'est pas vide', function () {
  assert.ok(this.result.tier, 'le palier ne doit pas être nul');
});

// --- Garde-fou déontologique ------------------------------------------------

const INTERDITS = ['commission', 'cut', 'percentage', 'pourcentage', 'ristourne', 'rake', 'fee', 'kickback'];

When('j\'inspecte les exports du module de domaine', function () {
  this.exports = Object.keys(this.domain);
});

Then('aucun export ne ressemble à une commission ou à un pourcentage', function () {
  const suspects = this.exports.filter((name) =>
    INTERDITS.some((mot) => name.toLowerCase().includes(mot))
  );
  assert.deepEqual(suspects, [], `exports suspects: ${JSON.stringify(suspects)}`);
});

Then('il n\'existe pas d\'export {string}', function (name) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(this.domain, name),
    false,
    `le domaine ne doit pas exposer "${name}"`
  );
});

Then('l\'affichage n\'utilise aucune espace sécable', function () {
  assert.ok(!this.result.includes(' '), 'money() must not emit a breaking space: ' + this.result);
  assert.ok(this.result.includes('\u00A0'), 'money() must separate with a no-break space');
});

// The multiplier a client is offered by default for the current tier. It is the
// midpoint of the tier's market band, which is what recommendedAmount pre-fills.
Then('le multiplicateur proposé est {float}', function (attendu) {
  const t = this.domain.tierById(this.result);
  assert.ok(t, 'palier inconnu : ' + this.result);
  assert.equal((t.apercuMin + t.apercuMax) / 2, attendu);
});
