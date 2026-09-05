'use strict';

// Loi 25 — le droit d'accès (art. 27) et la frontière de l'effacement (art. 28).
//
// Deux moitiés, et la première conditionne la seconde : on ne peut ni montrer ni
// effacer ce qu'on ne sait pas RETROUVER. L'index par adresse est donc testé ici
// par la porte publique — celle qui l'écrit — et la frontière de l'effacement
// par le domaine, qui la décide.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

const DEFAULT_PRICING = {
  refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
};

// --- L'index par adresse ----------------------------------------------------

When('je publie une enchère au courriel {string} pour {string} le {string} à {int}', async function (courriel, serviceId, dateISO, montant) {
  await this.request({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({ prefixe: 'G1R', pricing: DEFAULT_PRICING[serviceId], serviceId, dateISO, montant, nom: 'Luc Gagné', courriel }),
  });
});

When('je publie une enchère sans courriel pour {string} le {string} à {int}', async function (serviceId, dateISO, montant) {
  await this.request({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({ prefixe: 'G1R', pricing: DEFAULT_PRICING[serviceId], serviceId, dateISO, montant, nom: 'Luc Gagné' }),
  });
});

// L'index est INTERNE. L'adresse ne revient jamais au client dans la réponse de
// publication ni dans le carnet — c'est la promesse d'anonymat, et l'index ne
// doit surtout pas l'affaiblir. On le vérifie donc par le dépôt, jamais par
// l'API publique, et ce test-ci tient la promesse dans l'autre sens.
Then('le carnet public n\'expose jamais l\'adresse du client', function () {
  const brut = JSON.stringify(this.responseJson);
  assert.equal(brut.includes('luc@exemple.ca'), false, 'l’adresse du client est revenue dans une réponse publique');
});

Then('l\'adresse {string} retrouve {int} enchère(s)', async function (courriel, n) {
  const offres = await this.repo.listClientBids(courriel);
  assert.equal(offres.length, n);
});

// --- La frontière de l'effacement -------------------------------------------

Given('une enchère {string} du {string} au statut {string} sans acte réglé', function (id, dateISO, statut) {
  this.offresLoi25 = this.offresLoi25 || [];
  this.offresLoi25.push({ id, dateISO, status: statut, acteComplete: false });
});

Given('une enchère {string} du {string} au statut {string} avec acte réglé le {string}', function (id, dateISO, statut, regleLe) {
  this.offresLoi25 = this.offresLoi25 || [];
  this.offresLoi25.push({ id, dateISO, status: statut, acteComplete: true, regleLe });
});

When('je prépare l\'effacement de {string}', function (courriel) {
  this.planLoi25 = this.domain.erasurePlan({
    courriel,
    offres: this.offresLoi25 || [],
    at: this.today + 'T12:00:00.000Z',
  });
});

const idsDe = (lignes, famille) =>
  lignes.filter((l) => !famille || l.famille === famille).flatMap((l) => l.ids || []);

Then('le plan efface l\'enchère {string}', function (id) {
  assert.ok(idsDe(this.planLoi25.efface, 'offre').includes(id), `« ${id} » n’est pas dans ce qui sera effacé`);
  assert.equal(idsDe(this.planLoi25.conserve, 'offre').includes(id), false, `« ${id} » est annoncée effacée ET conservée`);
});

Then('le plan conserve l\'enchère {string}', function (id) {
  assert.ok(idsDe(this.planLoi25.conserve, 'offre').includes(id), `« ${id} » n’est pas conservée`);
  assert.equal(idsDe(this.planLoi25.efface, 'offre').includes(id), false, `« ${id} » est annoncée effacée alors qu’elle est gardée`);
});

Then('le motif de conservation de l\'enchère {string} mentionne {string}', function (id, extrait) {
  const ligne = this.planLoi25.conserve.find((l) => (l.ids || []).includes(id));
  assert.ok(ligne, `aucune ligne de conservation pour « ${id} »`);
  assert.ok(ligne.motif && ligne.motif.includes(extrait), `motif obtenu : ${ligne.motif}`);
  assert.ok(ligne.base, 'une conservation doit nommer sa base légale');
});

Then('le plan conserve la famille {string}', function (famille) {
  assert.ok(this.planLoi25.conserve.some((l) => l.famille === famille), `« ${famille} » ne survit pas à l’effacement`);
});

Then('le plan n\'efface jamais la famille {string}', function (famille) {
  assert.equal(this.planLoi25.efface.some((l) => l.famille === famille), false, `« ${famille} » est annoncée effacée`);
});

// Il n'existe volontairement AUCUN pas « le plan se déclare complet » : aucun
// plan ne peut l'être aujourd'hui (trois registres gardent l'adresse en clair
// et rien ne sait les vider), et un pas qu'aucun scénario n'emploie finit par
// se faire brancher sur une promesse fausse.

// Une famille annoncée au plan que l'exécutant ne sait PAS vider : elle doit
// figurer dans `residus`, porter sa raison, et interdire le mot « complet ».
Then('le plan laisse hors de portée la famille {string}', function (famille) {
  const ligne = this.planLoi25.efface.find((l) => l.famille === famille);
  assert.ok(ligne, `« ${famille} » ne figure pas au plan : la taire laisserait croire que Nota ne la détient pas`);
  assert.equal(ligne.executable, false, `« ${famille} » s’annonce effaçable alors qu’aucune porte ne l’efface`);
  assert.ok(ligne.note, `« ${famille} » est hors de portée sans dire pourquoi`);
  assert.ok(
    this.planLoi25.residus.some((l) => l.famille === famille),
    `« ${famille} » garde l’adresse en clair sans compter dans les résidus`
  );
});

Then('le plan se déclare partiel', function () {
  // Le mensonge à ne jamais commettre : annoncer « effacé » en ayant tout gardé.
  assert.equal(this.planLoi25.complet, false);
});
