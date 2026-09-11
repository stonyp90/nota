'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');

// --- Helpers -----------------------------------------------------------------

// Même poignée de main que les autres suites : le lien magique est renvoyé
// hors production, donc aucune boîte aux lettres n'est nécessaire. Le jeton est
// mis en cache par courriel sur le monde.
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

// Les réponses obligatoires d'un refinancement, au socle plat du catalogue.
const PRICING_REFI = {
  valeur_pret: 250000,
  succession: 'non',
  approbation_bancaire: 'obtenue',
  preteur: 'banque_nationale',
  deplacement: 'client_50',
};

function lastBid(world) {
  assert.ok(world.lastBid, 'aucune demande publiée dans ce scénario');
  return world.lastBid;
}

// La journée attendue, exprimée comme le scénario la nomme : « dans N jours ».
function dayIn(world, jours) {
  const dateISO = world.domain.addDays(world.today, jours);
  const jour = (world.agenda || []).find((d) => d.dateISO === dateISO);
  assert.ok(jour, 'aucune journée au ' + dateISO + ' dans l’agenda: ' + JSON.stringify((world.agenda || []).map((d) => d.dateISO)));
  return jour;
}

// --- Étant donné / Quand : publier des demandes -------------------------------

// Une demande de plus sur le carnet. Volontairement répétable : l'agenda ne se
// prouve qu'avec plusieurs demandes, dont deux le même jour.
When('un client publie une demande de {int} $ dans {int} jours', async function (montant, jours) {
  this.agendaSeq = (this.agendaSeq || 0) + 1;
  const dateISO = this.domain.addDays(this.today, jours);
  await this.request({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO, montant,
      courriel: 'client' + this.agendaSeq + '@exemple.ca', prefixe: 'G1R', pricing: PRICING_REFI,
    }),
  });
  assert.equal(this.response.statusCode, 201, 'publication: ' + this.response.body);
  const j = this.responseJson;
  this.lastBidId = j.bid.id;
  this.lastBid = j.bid;
  this.clientToken = j.clientToken || null;
});

// --- Quand : lire l'agenda ----------------------------------------------------

// UNE seule lecture du fil, puis l'agenda se compose par date depuis ce qui en
// est revenu. C'est la promesse : le notaire ne paie pas un aller-retour par
// journée pour savoir de quoi son mois est fait.
When('le notaire {string} lit son agenda une seule fois', async function (email) {
  const token = await notarySession(this, email);
  await this.request({ method: 'GET', path: '/notary/bids', headers: { authorization: 'Bearer ' + token }, query: {} });
  assert.equal(this.response.statusCode, 200, 'fil notaire: ' + this.response.body);
  this.notaryFeed = this.responseJson;
  this.agenda = this.domain.agendaByDate(this.notaryFeed.bids);
});

// --- Alors : l'agenda par date ------------------------------------------------

Then('son agenda porte {int} journées, de la plus proche à la plus lointaine', function (count) {
  assert.ok(this.agenda, 'l’agenda n’a pas été lu');
  assert.equal(this.agenda.length, count, 'journées: ' + JSON.stringify(this.agenda.map((d) => d.dateISO)));
  const dates = this.agenda.map((d) => d.dateISO);
  assert.deepEqual(dates, [...dates].sort(), 'les journées se lisent de la plus proche à la plus lointaine');
});

Then('la journée dans {int} jours porte {int} demandes pour un total de {int} $', function (jours, count, total) {
  const jour = dayIn(this, jours);
  assert.equal(jour.count, count);
  assert.equal(jour.total, total);
});

Then('la journée dans {int} jours porte {int} demande pour un total de {int} $', function (jours, count, total) {
  const jour = dayIn(this, jours);
  assert.equal(jour.count, count);
  assert.equal(jour.total, total);
});

// À l'intérieur d'une journée, l'acte mène et la meilleure offre mène son acte.
Then('la meilleure demande de la journée dans {int} jours est celle de {int} $', function (jours, montant) {
  const jour = dayIn(this, jours);
  assert.ok(jour.services.length, 'la journée ne porte aucun acte');
  assert.equal(jour.services[0].best, montant);
  assert.equal(jour.services[0].bids[0].montant, montant, 'la meilleure offre mène son acte');
});

// --- Alors : le détail se divulgue par acte ----------------------------------

Then('aucune demande de son agenda ne porte le courriel ni le dossier du client', function () {
  assert.ok(this.notaryFeed && this.notaryFeed.bids.length, 'le fil est vide');
  for (const bid of this.notaryFeed.bids) {
    for (const forbidden of ['courriel', 'dossier', 'client', 'nom', 'telephone']) {
      assert.ok(!(forbidden in bid), 'une demande ouverte ne doit pas porter « ' + forbidden + ' »: ' + JSON.stringify(bid));
    }
  }
});

async function dossier(world, email) {
  const token = await notarySession(world, email);
  const bid = lastBid(world);
  return world.request({
    method: 'GET',
    path: '/notary/dossier',
    headers: { authorization: 'Bearer ' + token },
    query: { id: bid.id, dateISO: bid.dateISO },
  });
}

Then('le dossier de la demande est refusé au notaire {string}', async function (email) {
  const response = await dossier(this, email);
  assert.equal(response.statusCode, 403, 'le dossier a fuité: ' + response.body);
  assert.equal(JSON.parse(response.body).errors[0].code, 'interdit');
});

Then('le dossier de la demande nomme le client au notaire {string}', async function (email) {
  const response = await dossier(this, email);
  assert.equal(response.statusCode, 200, 'dossier: ' + response.body);
  const body = JSON.parse(response.body);
  assert.equal(body.courriel, 'client@exemple.ca', 'le dossier porte le courriel du client');
  assert.ok(body.client, 'le dossier porte la fiche de contact du client (ADR 0033)');
  assert.ok(body.preteur, 'le dossier nomme le prêteur à coordonner');
});

// --- Le rythme des alertes (ADR 0033 §7) -------------------------------------

Then('les rythmes d\'alerte offerts sont {string}', function (list) {
  const attendus = list.split(',').map((s) => s.trim());
  assert.deepEqual([...this.domain.NOTARY_ALERT_PACES], attendus);
});

// Le rythme s'écrit par la porte réelle de la console, celle qui valide.
async function reglerAlertes(world, email, alertes) {
  const token = await notarySession(world, email);
  return world.request({
    method: 'POST',
    path: '/notary/profile',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ alertes }),
  });
}

Given('le notaire {string} règle ses alertes sur {string} depuis sa console', async function (email, pace) {
  const response = await reglerAlertes(this, email, { pace, urgentOnly: false });
  assert.equal(response.statusCode, 200, 'réglage des alertes: ' + response.body);
  const stored = await this.repo.getNotary(notaryIdForEmail(email));
  assert.equal(this.domain.notaryAlertes(stored).pace, pace, 'le rythme doit être écrit sur le profil');
});

Then('régler ses alertes sur {string} est refusé au notaire {string}', async function (pace, email) {
  const response = await reglerAlertes(this, email, { pace, urgentOnly: false });
  assert.equal(response.statusCode, 422, 'un rythme inconnu ne doit jamais être accepté: ' + response.body);
  const codes = JSON.parse(response.body).errors.map((e) => e.code);
  assert.ok(codes.includes('alerte_rythme_invalide'), JSON.stringify(codes));
});

// Deux gabarits différents portent le mot « demande » : l'avis instantané
// (« Nouvelle demande : 2 500 $ · … ») et le digest (« 1 nouvelle demande sur
// le carnet »). On les distingue par ce qui leur est propre.
const AVIS_INSTANTANE = (m) => /^Nouvelle demande/.test(m.subject || '');
const DIGEST_CARNET = (m) => /sur le carnet/.test(m.subject || '');

Then('le notaire {string} a reçu {int} avis de nouvelle demande', function (email, count) {
  const hits = this.mailsTo(email).filter(AVIS_INSTANTANE);
  assert.equal(hits.length, count, JSON.stringify(this.mailsTo(email).map((m) => m.subject)));
});

Then('le notaire {string} a reçu {int} digest du carnet', function (email, count) {
  const hits = this.mailsTo(email).filter(DIGEST_CARNET);
  assert.equal(hits.length, count, JSON.stringify(this.mailsTo(email).map((m) => m.subject)));
});

// Le digest quotidien compte les demandes de la VEILLE (appartenance exactement
// une fois). L'horloge est gelée : c'est la demande qu'on recule d'un jour.
When('la demande a été publiée hier', async function () {
  const bid = await this.repo.get(this.lastBid.id, this.lastBid.dateISO);
  assert.ok(bid, 'aucune demande à reculer');
  await this.repo.update({ ...bid, createdAt: this.domain.addDays(this.today, -1) });
});

// --- Les évaluations (ADR 0021 / ADR 0030) ------------------------------------

async function evaluations(world, email) {
  const token = await notarySession(world, email);
  const response = await world.request({
    method: 'GET',
    path: '/notary/evaluations',
    headers: { authorization: 'Bearer ' + token },
    query: {},
  });
  assert.equal(response.statusCode, 200, 'évaluations: ' + response.body);
  return JSON.parse(response.body);
}

Then('le notaire {string} lit {int} évaluation notée {int} portant {string}', async function (email, count, note, commentaire) {
  const body = await evaluations(this, email);
  assert.equal(body.evaluations.length, count, JSON.stringify(body.evaluations));
  assert.equal(body.evaluations[0].note, note);
  assert.equal(body.evaluations[0].commentaire, commentaire);
  assert.equal(body.evaluations[0].serviceId, 'refinancement', 'l’évaluation dit sur quel acte elle porte');
});

Then('la moyenne du notaire {string} est de {int} sur {int} avis', async function (email, note, avis) {
  const body = await evaluations(this, email);
  assert.deepEqual(body.rating, { note, avis });
});

Then('le notaire {string} ne lit aucune évaluation', async function (email) {
  const body = await evaluations(this, email);
  assert.deepEqual(body.evaluations, [], 'le registre d’un notaire ne se lit pas depuis la console d’un autre');
  assert.equal(body.rating, null, 'sans avis, aucune moyenne inventée');
});

// ADR 0030 — art. 70 : aucune appréciation ne voyage vers le client. On fouille
// la réponse ENTIÈRE, pas seulement le bloc du notaire : une note oubliée dans
// un coin de la charge utile serait publiée tout autant.
function clefsProfondes(value, chemin = '$', out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => clefsProfondes(v, chemin + '[' + i + ']', out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    out.push([chemin + '.' + k, k]);
    clefsProfondes(v, chemin + '.' + k, out);
  }
  return out;
}

Then('rien de la cote ni des évaluations du notaire ne parvient au client', function () {
  // `$.evaluation` est la SIENNE, renvoyée en écho pour que le formulaire ne
  // se rouvre pas : le client relit ce qu'il a écrit, ce n'est pas un
  // témoignage sur un notaire. Cette branche-là est donc exclue, et TOUT le
  // reste de la charge utile est fouillé — une note oubliée dans un coin
  // serait publiée tout autant.
  const { evaluation, ...reste } = this.responseJson;
  assert.equal(evaluation.note, 5, 'le client relit sa propre évaluation');
  const interdites = ['cote', 'rating', 'note', 'avis', 'evaluations', 'moyenne', 'etoiles'];
  for (const [chemin, clef] of clefsProfondes(reste)) {
    assert.ok(!interdites.includes(clef), 'le client ne doit jamais lire « ' + clef + ' » (' + chemin + ')');
  }
});

Then('le client ne lit du notaire que des faits vérifiables', function () {
  const notaire = this.responseJson.notaire;
  assert.ok(notaire, 'l’acte est retenu : le client doit savoir qui joindre');
  // Les faits (ADR 0030) : l'inscription au tableau de la Chambre et le nombre
  // d'actes portés. Le reste sert à JOINDRE le notaire, pas à le juger.
  assert.deepEqual(
    Object.keys(notaire).sort(),
    ['actes', 'adresse', 'courriel', 'etude', 'lienCNQ', 'nom', 'telephone'],
  );
  assert.equal(typeof notaire.actes, 'number');
});
