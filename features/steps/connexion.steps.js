'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

// La connexion n'était jouée nulle part : elle servait de décor à d'autres
// scénarios (« un notaire actif », puis un jeton), jamais de sujet. Ici, la
// poignée de main EST le sujet, et elle passe par le vrai handler — aucune
// fonction d'authentification n'est remplacée.
//
// Le courriel est la seule source du jeton : on ne lit JAMAIS l'écho de
// développement (`devToken`). Ce que le scénario ouvre est très exactement ce
// que la personne aurait reçu dans sa boîte.

// --- Outils -----------------------------------------------------------------

// Une IP stable et distincte par adresse : les deux portes de connexion sont
// freinées par IP, et un scénario ne doit pas se faire couper par le compteur
// d'un autre.
function sourceIpFor(world, email) {
  world.ipsConnexion = world.ipsConnexion || {};
  if (!world.ipsConnexion[email]) {
    const n = Object.keys(world.ipsConnexion).length + 1;
    world.ipsConnexion[email] = '203.0.113.' + n;
  }
  return world.ipsConnexion[email];
}

// Le lien voyage dans le HASH (`#nauth=` côté notaire, `#cauth=` côté client),
// jamais dans une query string qui se journalise. On relit le courriel comme
// le ferait la personne : on y prend le jeton, et rien d'autre.
function jetonDuCourriel(world, to, marqueur) {
  const msgs = world.mailsTo(to);
  assert.ok(msgs.length, 'aucun courriel envoyé à ' + to);
  const motif = new RegExp(marqueur + '([A-Za-z0-9._%~-]+)');
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const corps = String(msgs[i].text || '') + '\n' + String(msgs[i].html || '');
    const trouve = corps.match(motif);
    if (trouve) return { jeton: decodeURIComponent(trouve[1]), message: msgs[i] };
  }
  assert.fail('aucun courriel envoyé à ' + to + ' ne porte de lien ' + marqueur);
}

// L'échéance vient du JETON lui-même, jamais d'un nombre recopié ici : la
// fenêtre appartient au code, et un scénario qui la figerait mentirait le jour
// où elle change.
function echeanceDuJeton(jeton) {
  const charge = String(jeton).split('.')[0];
  const claims = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
  assert.ok(Number.isFinite(claims.exp), 'le jeton ne porte pas d’échéance : ' + charge);
  return claims.exp;
}

function memoire(world, cle) {
  world[cle] = world[cle] || {};
  return world[cle];
}

const PRICING_VALIDE = {
  refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
  financement: { valeur_pret: 250000, contexte: 'propriete_detenue', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', succession: 'non', deplacement: 'client_50' },
};

// --- Le notaire : demander un lien, l'ouvrir --------------------------------

When('le notaire {string} demande un lien de connexion', async function (email) {
  await this.request({
    method: 'POST',
    path: '/notary/session/request',
    sourceIp: sourceIpFor(this, email),
    body: JSON.stringify({ email }),
  });
});

Then('le notaire {string} reçoit un courriel portant un lien de connexion', function (email) {
  const { jeton, message } = jetonDuCourriel(this, email, '#nauth=');
  assert.match(message.subject, /lien de connexion/i, 'le courriel reçu n’est pas celui de la connexion');
  memoire(this, 'liensNotaire')[email] = jeton;
});

When('le notaire {string} ouvre le lien reçu par courriel', async function (email) {
  const jeton = memoire(this, 'liensNotaire')[email];
  assert.ok(jeton, 'aucun lien de connexion reçu par ' + email);
  await this.request({
    method: 'POST',
    path: '/notary/session/verify',
    sourceIp: sourceIpFor(this, email),
    body: JSON.stringify({ token: jeton }),
  });
  if (this.response.statusCode === 200) memoire(this, 'sessionsNotaire')[email] = this.responseJson.token;
});

When('le notaire {string} ouvre une seconde fois le même lien', async function (email) {
  const jeton = memoire(this, 'liensNotaire')[email];
  assert.ok(jeton, 'aucun lien de connexion reçu par ' + email);
  await this.request({
    method: 'POST',
    path: '/notary/session/verify',
    sourceIp: sourceIpFor(this, email),
    body: JSON.stringify({ token: jeton }),
  });
});

When('l\'horloge dépasse l\'échéance portée par le lien du notaire {string}', function (email) {
  const jeton = memoire(this, 'liensNotaire')[email];
  assert.ok(jeton, 'aucun lien de connexion reçu par ' + email);
  this.nowMs = echeanceDuJeton(jeton) + 1;
});

Then('la session ouvre la console du notaire {string}', async function (email) {
  const token = memoire(this, 'sessionsNotaire')[email];
  assert.ok(token, 'aucune session ouverte pour ' + email);
  await this.request({
    method: 'GET',
    path: '/notary/bids',
    headers: { authorization: 'Bearer ' + token },
  });
  assert.equal(this.response.statusCode, 200, 'la console refuse la session : ' + this.response.body);
});

// --- Ce que la session d'un notaire n'atteint pas ---------------------------

// Le fil de la console est la porte où vivent SES dossiers retenus : le
// courriel du client, son dossier, la conversation. C'est donc là que la
// cloison se mesure.
async function filDuNotaire(world, email) {
  world.notaryTokens = world.notaryTokens || {};
  let token = memoire(world, 'sessionsNotaire')[email] || world.notaryTokens[email];
  assert.ok(token, 'le notaire ' + email + ' n’a pas de session dans ce scénario');
  await world.request({
    method: 'GET',
    path: '/notary/bids',
    headers: { authorization: 'Bearer ' + token },
  });
  assert.equal(world.response.statusCode, 200, 'fil du notaire : ' + world.response.body);
  return world.responseJson;
}

Then('le fil du notaire {string} montre {int} dossier retenu', async function (email, attendu) {
  const fil = await filDuNotaire(this, email);
  assert.equal((fil.retained || []).length, attendu, 'dossiers retenus vus par ' + email);
});

Then('le fil du notaire {string} ne nomme pas le client {string}', async function (email, courriel) {
  const fil = await filDuNotaire(this, email);
  assert.ok(
    !JSON.stringify(fil).includes(courriel),
    'le fil de ' + email + ' porte le courriel d’un client qui n’est pas le sien'
  );
});

// --- Le client : publier, demander un lien, ouvrir son espace ---------------

Given('le client {string} a publié une offre pour {string} à {int} dans {int} jours', async function (courriel, serviceId, montant, jours) {
  const dateISO = this.domain.addDays(this.today, jours);
  await this.request({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({ serviceId, dateISO, montant, courriel, prefixe: 'G1R', pricing: PRICING_VALIDE[serviceId] }),
  });
  assert.equal(this.response.statusCode, 201, 'la publication a échoué : ' + this.response.body);
  const bid = this.responseJson.bid;
  memoire(this, 'offresClient')[courriel] = bid;
  this.lastBidId = bid.id;
  this.lastBid = bid;
});

When('le client {string} demande un lien vers son espace', async function (courriel) {
  await this.request({
    method: 'POST',
    path: '/client/session/request',
    sourceIp: sourceIpFor(this, courriel),
    body: JSON.stringify({ courriel }),
  });
});

Then('le client {string} reçoit un courriel portant un lien vers son espace', function (courriel) {
  const { jeton, message } = jetonDuCourriel(this, courriel, '#cauth=');
  assert.match(message.subject, /lien d’accès/i, 'le courriel reçu n’est pas celui de l’espace client');
  memoire(this, 'liensClient')[courriel] = jeton;
});

When('le client {string} ouvre le lien reçu par courriel', async function (courriel) {
  const jeton = memoire(this, 'liensClient')[courriel];
  assert.ok(jeton, 'aucun lien d’espace reçu par ' + courriel);
  await this.request({
    method: 'POST',
    path: '/client/session/verify',
    sourceIp: sourceIpFor(this, courriel),
    body: JSON.stringify({ token: jeton }),
  });
  if (this.response.statusCode === 200) memoire(this, 'espacesClient')[courriel] = this.responseJson.offres;
});

When('le client {string} ouvre une seconde fois le même lien', async function (courriel) {
  const jeton = memoire(this, 'liensClient')[courriel];
  assert.ok(jeton, 'aucun lien d’espace reçu par ' + courriel);
  await this.request({
    method: 'POST',
    path: '/client/session/verify',
    sourceIp: sourceIpFor(this, courriel),
    body: JSON.stringify({ token: jeton }),
  });
});

Then('l\'espace de {string} ne contient que ses propres offres', function (courriel) {
  const offres = memoire(this, 'espacesClient')[courriel];
  assert.ok(offres, 'l’espace de ' + courriel + ' n’a pas été ouvert');
  const sienne = memoire(this, 'offresClient')[courriel];
  assert.ok(sienne, 'aucune offre publiée par ' + courriel + ' dans ce scénario');
  assert.deepEqual(offres.map((o) => o.id), [sienne.id], 'l’espace rend une offre qui n’est pas la sienne');
});

// Le jeton rendu est un jeton CLIENT par OFFRE : il n'existe aucune portée
// « personne ». Ces deux pas traversent la couture dans les deux sens.
async function ouvrirOffre(world, jeton, bid) {
  await world.request({
    method: 'GET',
    path: '/client/bid',
    query: { id: bid.id, dateISO: bid.dateISO, date: bid.dateISO },
    headers: { authorization: 'Bearer ' + jeton },
  });
}

function jetonDEspace(world, courriel) {
  const offres = memoire(world, 'espacesClient')[courriel];
  assert.ok(offres && offres.length, 'l’espace de ' + courriel + ' n’a rendu aucune offre');
  return offres[0].clientToken;
}

Then('le jeton d\'espace de {string} ouvre sa propre offre', async function (courriel) {
  const sienne = memoire(this, 'offresClient')[courriel];
  await ouvrirOffre(this, jetonDEspace(this, courriel), sienne);
  assert.equal(this.response.statusCode, 200, 'son propre dossier lui est refusé : ' + this.response.body);
  assert.equal(this.responseJson.bid.id, sienne.id);
});

Then('le jeton d\'espace de {string} est refusé sur l\'offre de {string}', async function (courriel, autre) {
  const celle_de_lautre = memoire(this, 'offresClient')[autre];
  assert.ok(celle_de_lautre, 'aucune offre publiée par ' + autre);
  await ouvrirOffre(this, jetonDEspace(this, courriel), celle_de_lautre);
  assert.equal(this.response.statusCode, 403, 'le jeton d’un client a ouvert l’offre d’un autre : ' + this.response.body);
  assert.equal(this.responseJson.errors[0].code, 'interdit');
});
