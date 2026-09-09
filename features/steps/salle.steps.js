'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const domain = require('@nota/domain');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');
const { NOTARY_CONTACT } = require('../../apps/api/test-support/notary-fixture.js');

// ADR 0047 — la salle de signature.
//
// Tout passe par les VRAIES routes, avec les VRAIS jetons : le notaire ouvre
// sa session par lien magique, le client tient celui que la publication lui a
// remis. Rien n'est écrit dans le dépôt derrière le dos du handler, sinon les
// scénarios prouveraient l'existence d'un état que la production ne peut pas
// atteindre.

const NOTAIRE = 'anne@etude-roy.ca';
const CLIENT = 'client@exemple.ca';
const EMPREINTE_NOTAIRE = 'AA:BB:CC:DD:EE:FF';
const EMPREINTE_CLIENT = '11:22:33:44:55:66';

// --- Sessions ----------------------------------------------------------------

async function sessionNotaire(world) {
  if (world.jetonNotaire) return world.jetonNotaire;
  // Un notaire ACTIF, avec le nom et le téléphone qu'exige l'ADR 0033 : sans
  // eux il ne peut rien retenir, et la séance n'aurait pas d'acte.
  await world.repo.putNotary({
    id: notaryIdForEmail(NOTAIRE), email: NOTAIRE, status: 'active',
    label: 'Étude Anne Roy', ...NOTARY_CONTACT,
  });
  const demande = await world.app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email: NOTAIRE }) });
  assert.equal(demande.statusCode, 200, 'demande de lien notaire: ' + demande.body);
  const devToken = JSON.parse(demande.body).devToken;
  const ouverture = await world.app.handle({ method: 'POST', path: '/notary/session/verify', body: JSON.stringify({ token: devToken }) });
  assert.equal(ouverture.statusCode, 200, 'ouverture de session notaire: ' + ouverture.body);
  world.jetonNotaire = JSON.parse(ouverture.body).token;
  return world.jetonNotaire;
}

function jetonDe(world, partie) {
  if (partie === 'notaire') return world.jetonNotaire;
  assert.ok(world.clientToken, "aucun jeton client — l'offre doit être publiée avec un courriel");
  return world.clientToken;
}

// Un appel de salle. `partie` vaut 'notaire', 'client', ou une chaîne quelconque
// qui devient un jeton invalide — c'est ainsi qu'on joue un inconnu.
async function salle(world, partie, method, chemin, corps) {
  const connue = partie === 'notaire' || partie === 'client';
  const jeton = connue ? jetonDe(world, partie) : String(partie);
  const identite = { id: world.lastBid.id, dateISO: world.lastBid.dateISO };
  return world.request({
    method,
    path: chemin,
    headers: { authorization: 'Bearer ' + jeton },
    ...(method === 'POST'
      ? { body: JSON.stringify({ ...identite, ...(corps || {}) }) }
      : { query: { ...identite, ...(corps || {}) } }),
  });
}

// L'état vu par le notaire, sans toucher à `this.response` du scénario : une
// assertion ne doit pas effacer la réponse que le scénario est en train
// d'examiner.
async function etatSalle(world, partie = 'notaire') {
  const jeton = jetonDe(world, partie);
  const res = await world.app.handle({
    method: 'GET', path: '/salle',
    headers: { authorization: 'Bearer ' + jeton },
    query: { id: world.lastBid.id, dateISO: world.lastBid.dateISO },
  });
  assert.equal(res.statusCode, 200, 'état de la séance: ' + res.body);
  return JSON.parse(res.body).salle;
}

// --- Contexte ----------------------------------------------------------------

Given('une offre retenue pour une séance de signature', async function () {
  const dateISO = this.domain.addDays(this.today, 21);
  await this.request({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO, montant: 2400, courriel: CLIENT, prefixe: 'G1R',
      pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
    }),
  });
  assert.equal(this.response.statusCode, 201, 'publication: ' + this.response.body);
  const j = this.responseJson;
  this.lastBid = j.bid;
  this.lastBidId = j.bid.id;
  this.clientToken = j.clientToken;

  const token = await sessionNotaire(this);
  const accepte = await this.app.handle({
    method: 'POST', path: '/notary/bids/accept',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: j.bid.id, dateISO: j.bid.dateISO }),
  });
  assert.equal(accepte.statusCode, 200, 'rétention: ' + accepte.body);
});

// --- Rejoindre ---------------------------------------------------------------

When("le notaire rejoint la séance avec l'empreinte {string}", async function (empreinte) {
  await salle(this, 'notaire', 'POST', '/salle/rejoindre', { empreinte, mode: 'strict', demonstration: true });
  assert.equal(this.response.statusCode, 200, 'le notaire rejoint: ' + this.response.body);
});

When("le client rejoint la séance avec l'empreinte {string}", async function (empreinte) {
  await salle(this, 'client', 'POST', '/salle/rejoindre', { empreinte });
  assert.equal(this.response.statusCode, 200, 'le client rejoint: ' + this.response.body);
});

// Amène la séance au point où les deux pairs sont là, caméra et micro allumés.
async function rejoindreLesDeux(world, { mode = 'strict' } = {}) {
  await salle(world, 'notaire', 'POST', '/salle/rejoindre', { empreinte: EMPREINTE_NOTAIRE, mode, demonstration: true });
  await salle(world, 'client', 'POST', '/salle/rejoindre', { empreinte: EMPREINTE_CLIENT });
  await salle(world, 'notaire', 'POST', '/salle/pistes', { video: true, audio: true });
  await salle(world, 'client', 'POST', '/salle/pistes', { video: true, audio: true });
}

Given('les deux parties ont rejoint la séance', async function () {
  await rejoindreLesDeux(this);
  this.sasAvant = (await etatSalle(this)).sas;
});

// Mène la séance jusqu'à l'étape demandée : identités attestées, chaîne
// confirmée, consentements donnés, étapes franchies une par une.
async function menerJusqua(world, jusqua, { mode = 'strict', sansIdentiteClient = false, sansConsentementClient = false } = {}) {
  await rejoindreLesDeux(world, { mode });
  const parties = sansIdentiteClient ? ['notaire'] : ['notaire', 'client'];
  for (const partie of parties) {
    await salle(world, 'notaire', 'POST', '/salle/identite', {
      partie,
      attestation: { methode: 'demonstration', verifieeLe: new Date(world.nowMs).toISOString(), verifieePar: NOTAIRE },
    });
    assert.equal(world.response.statusCode, 200, 'attestation: ' + world.response.body);
  }
  const etat = await etatSalle(world);
  await salle(world, 'notaire', 'POST', '/salle/lien', { sas: etat.sas });
  assert.equal(world.response.statusCode, 200, 'confirmation du lien: ' + world.response.body);

  const enregistrement = mode === 'temoin';
  await salle(world, 'notaire', 'POST', '/salle/consentement', { enregistrement });
  if (!sansConsentementClient) await salle(world, 'client', 'POST', '/salle/consentement', { enregistrement });

  for (const etape of ['identite', 'lien', 'consentement', 'lecture', 'questions']) {
    await salle(world, 'notaire', 'POST', '/salle/etape', { versEtape: etape });
    if (etape === jusqua) return;
    assert.equal(world.response.statusCode, 200, 'étape ' + etape + ': ' + world.response.body);
  }
}

Given('une séance prête à l\'étape {string}', async function (etape) {
  await menerJusqua(this, etape);
});

Given('une séance prête à l\'étape {string} en mode {string}', async function (etape, mode) {
  await menerJusqua(this, etape, { mode });
});

Given('une séance prête à l\'étape {string} sans attestation d\'identité du client', async function (etape) {
  await menerJusqua(this, etape, { sansIdentiteClient: true });
});

Given('une séance prête à l\'étape {string} sans le consentement du client', async function (etape) {
  await menerJusqua(this, etape, { sansConsentementClient: true });
});

Given('une séance menée jusqu\'au sceau', async function () {
  await menerJusqua(this, 'questions');
  await salle(this, 'notaire', 'POST', '/salle/etape', { versEtape: 'signature' });
  assert.equal(this.response.statusCode, 200, 'signature: ' + this.response.body);
  await salle(this, 'notaire', 'POST', '/salle/etape', { versEtape: 'cloture' });
  assert.equal(this.response.statusCode, 200, 'clôture: ' + this.response.body);
  await salle(this, 'notaire', 'POST', '/salle/sceau', {});
  assert.equal(this.response.statusCode, 200, 'sceau: ' + this.response.body);
  this.scelle = this.responseJson.scelle;
});

// --- La chaîne d'authentification --------------------------------------------

Then('les deux parties lisent la même chaîne d\'authentification', async function () {
  const vueNotaire = await etatSalle(this, 'notaire');
  const vueClient = await etatSalle(this, 'client');
  assert.ok(vueNotaire.sas, 'la chaîne doit exister dès que les deux empreintes sont connues');
  assert.equal(vueNotaire.sas, vueClient.sas, 'les deux côtés lisent la même chaîne, sinon elle ne prouve rien');
  // Elle est DÉRIVÉE des deux empreintes, et de rien d'autre : le domaine la
  // recalcule sans voir la séance.
  assert.equal(
    vueNotaire.sas,
    domain.chaineAuthentification(vueNotaire.lien.empreinteNotaire, vueNotaire.lien.empreinteClient),
  );
  this.sasAvant = vueNotaire.sas;
});

Then('la chaîne d\'authentification n\'est plus la même qu\'avant', async function () {
  assert.ok(this.sasAvant, 'aucune chaîne mémorisée avant le changement');
  const apres = (await etatSalle(this)).sas;
  assert.notEqual(apres, this.sasAvant, 'changer une empreinte doit changer la chaîne — sinon elle ne détecte rien');
});

When('le notaire confirme la chaîne {string}', async function (chaine) {
  await salle(this, 'notaire', 'POST', '/salle/lien', { sas: chaine });
});

// --- Conduite ----------------------------------------------------------------

When('le notaire fait avancer la séance à {string}', async function (etape) {
  await salle(this, 'notaire', 'POST', '/salle/etape', { versEtape: etape });
});

When('le client tente de faire avancer la séance à {string}', async function (etape) {
  await salle(this, 'client', 'POST', '/salle/etape', { versEtape: etape });
});

When("le client tente d'attester l'identité du client", async function () {
  await salle(this, 'client', 'POST', '/salle/identite', {
    partie: 'client',
    attestation: { methode: 'demonstration', verifieeLe: new Date(this.nowMs).toISOString(), verifieePar: CLIENT },
  });
});

When("un inconnu demande l'état de la séance", async function () {
  await salle(this, 'jeton-inventé', 'GET', '/salle');
});

// --- Consentement -------------------------------------------------------------

When('le client retire son consentement', async function () {
  await salle(this, 'client', 'POST', '/salle/consentement', { retire: true });
  assert.equal(this.response.statusCode, 200, 'retrait du consentement: ' + this.response.body);
});

// --- Présence -----------------------------------------------------------------

// Le client se tait : on n'envoie PLUS rien de son côté, on avance l'horloge, et
// c'est le sondage du notaire qui découvre le silence. C'est exactement ce qui
// se passe quand un client débranche son réseau.
When('le client se tait pendant {int} secondes', async function (secondes) {
  const avant = await etatSalle(this, 'client'); // dernier signe de vie du client
  void avant;
  this.clientVuLe = this.nowMs;
  this.nowMs += secondes * 1000;
  this.salleVue = await etatSalle(this, 'notaire');
});

When('le client donne de nouveau signe de vie', async function () {
  this.salleVue = await etatSalle(this, 'client');
  this.salleVue = await etatSalle(this, 'notaire');
});

Then('la séance est suspendue', async function () {
  const vue = await etatSalle(this, 'notaire');
  assert.equal(vue.statut, domain.SALLE_STATUT.SUSPENDUE, 'statut observé: ' + vue.statut);
});

// La reprise appartient au notaire : le lien qui revient ne redémarre pas un
// acte, et le domaine refuse la reprise tant que la présence n'est pas rétablie.
When('le notaire reprend la séance', async function () {
  await salle(this, 'notaire', 'POST', '/salle/etape', { versEtape: 'lecture', reprendre: true });
});

Then('la séance est encore à l\'étape {string}', async function (etape) {
  const vue = await etatSalle(this);
  assert.equal(vue.etape, etape, 'une reprise repart de l\'étape en cours, jamais plus loin');
});

Then('la séance n\'est plus suspendue', async function () {
  const vue = await etatSalle(this, 'notaire');
  assert.notEqual(vue.statut, domain.SALLE_STATUT.SUSPENDUE);
});

Then('la coupure est datée du dernier signe de vie du client', async function () {
  const vue = await etatSalle(this, 'notaire');
  assert.ok(Number.isFinite(vue.presence.coupeeA), 'aucune coupure enregistrée');
  assert.equal(
    vue.presence.coupeeA, this.clientVuLe,
    'la coupure doit porter l\'instant du dernier signe de vie, pas celui de sa découverte',
  );
  assert.ok(vue.presence.coupeeA < this.nowMs, 'la coupure est antérieure à sa découverte');
});

// --- Les portes ---------------------------------------------------------------

Then('les quatre portes de la séance sont ouvertes', async function () {
  const vue = await etatSalle(this);
  assert.deepEqual(vue.fermees, [], 'portes encore fermées: ' + JSON.stringify(vue.fermees));
  assert.equal(vue.toutesOuvertes, true);
  assert.equal(vue.fermees.length + Object.keys(vue.portes).length, domain.SALLE_PORTES.length);
});

Then('la porte {string} reste fermée', async function (porte) {
  const vue = await etatSalle(this);
  assert.ok(vue.fermees.includes(porte), 'portes fermées observées: ' + JSON.stringify(vue.fermees));
  assert.ok(vue.portes[porte].message, 'une porte fermée dit POURQUOI, sinon le notaire ne peut rien corriger');
});

// --- La signature -------------------------------------------------------------

Then('la signature est libérée', async function () {
  const vue = await etatSalle(this);
  assert.ok(vue.signature, 'aucune signature libérée');
  assert.ok(vue.signature.reference, 'une signature libérée porte sa référence');
});

Then('aucune signature n\'est libérée', async function () {
  const vue = await etatSalle(this);
  assert.equal(vue.signature, null, 'signature inattendue: ' + JSON.stringify(vue.signature));
});

Then('la signature ne porte aucune minute', async function () {
  const vue = await etatSalle(this);
  assert.ok(vue.signature, 'aucune signature libérée');
  assert.equal(vue.signature.minute, null, 'le fournisseur de démonstration ne délivre AUCUNE minute');
});

Then('la signature porte un avis à afficher', async function () {
  const vue = await etatSalle(this);
  assert.ok(vue.signature.avis && vue.signature.avis.length > 10, 'avis: ' + JSON.stringify(vue.signature.avis));
});

Then('rien dans la séance ne se dit approuvé par la Chambre des notaires', async function () {
  const vue = await etatSalle(this);
  const texte = JSON.stringify(vue).toLowerCase();
  for (const promesse of ['approuvé par la chambre', 'approuve par la chambre', 'certifié par la chambre', 'conforme à la chambre']) {
    assert.ok(!texte.includes(promesse), 'la séance prétend « ' + promesse +' »');
  }
});

// --- Le procès-verbal ---------------------------------------------------------

// Ce que ferait un vérificateur indépendant : rechaîner les entrées telles
// qu'elles sont, et comparer. Il ne lui faut rien d'autre que la fonction
// publique du domaine et le scellé lui-même.
function verifierScelle(scelle) {
  const brutes = scelle.entrees.map((e) => ({ fait: e.fait, par: e.par, a: e.a, detail: e.detail }));
  const rechaine = domain.chainerProcesVerbal(brutes);
  if (rechaine.length !== scelle.entrees.length) return false;
  for (let i = 0; i < rechaine.length; i++) {
    if (rechaine[i].empreinte !== scelle.entrees[i].empreinte) return false;
  }
  const fin = rechaine.length ? rechaine[rechaine.length - 1].empreinte : domain.PV_GENESE;
  return fin === scelle.empreinte;
}

Then('le procès-verbal scellé se vérifie', function () {
  assert.ok(this.scelle, 'aucun scellé dans ce scénario');
  assert.equal(verifierScelle(this.scelle), true, 'la chaîne du procès-verbal ne se referme pas');
});

Then('le procès-verbal scellé ne se vérifie plus', function () {
  assert.equal(verifierScelle(this.scelle), false, 'la falsification est passée inaperçue');
});

When('on retire une entrée du procès-verbal scellé', function () {
  assert.ok(this.scelle.entrees.length > 3, 'trop peu d\'entrées pour en retirer une au milieu');
  this.scelle = { ...this.scelle, entrees: this.scelle.entrees.filter((_, i) => i !== 2) };
});

When('on change la partie nommée dans une entrée du procès-verbal scellé', function () {
  const entrees = this.scelle.entrees.map((e, i) => (i === 2 ? { ...e, par: e.par === 'notaire' ? 'client' : 'notaire' } : e));
  this.scelle = { ...this.scelle, entrees };
});

Then('le procès-verbal porte le fait {string}', async function (fait) {
  const vue = await etatSalle(this);
  const faits = (this.scelle ? this.scelle.entrees : vue.pv).map((e) => e.fait);
  assert.ok(faits.includes(fait), 'faits observés: ' + JSON.stringify(faits));
});

Then('le procès-verbal porte {int} fois le fait {string}', async function (fois, fait) {
  const vue = await etatSalle(this);
  const faits = (this.scelle ? this.scelle.entrees : vue.pv).map((e) => e.fait);
  assert.equal(faits.filter((f) => f === fait).length, fois, 'faits observés: ' + JSON.stringify(faits));
});

Then('l\'empreinte du sceau est aussi dans la piste d\'audit', async function () {
  const journal = await this.repo.queryTxAuditByDay(this.today);
  const ligne = journal.find((l) => l.action === 'salle_scellee');
  assert.ok(ligne, 'aucune ligne « salle_scellee » au journal: ' + JSON.stringify(journal.map((l) => l.action)));
  const meta = typeof ligne.meta === 'string' ? JSON.parse(ligne.meta) : ligne.meta;
  assert.equal(
    meta.empreinte, this.scelle.empreinte,
    'deux copies indépendantes de la même vérité, sinon il n\'y en a qu\'une',
  );
});
