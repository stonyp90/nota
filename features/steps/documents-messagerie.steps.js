'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Given, When, Then } = require('@cucumber/cucumber');

const { createApp } = require('../../apps/api/src/handler.js');
const { createMemoryStorage } = require('../../apps/api/src/storage-port.js');

// --- Le dépôt, branché comme en production ----------------------------------
//
// Le monde BDD construit son application SANS port de stockage — c'est l'état
// d'un déploiement où aucun seau n'est configuré, et le dernier scénario le
// documente. Les autres reconstruisent l'application sur le MÊME dépôt et la
// même horloge gelée, avec l'adaptateur en mémoire du port : quatre gestes,
// aucun réseau. Les octets d'un document ne traversent jamais l'API, ici pas
// plus qu'ailleurs — `__deposer` joue le navigateur qui téléverse.

function armerStockage(world) {
  world.stockage = createMemoryStorage({ now: () => world.nowMs });
  world.app = createApp(world.repo, {
    now: () => world.today,
    nowMs: () => world.nowMs,
    // Des identifiants opaques : la clé d'un document ne doit pas se deviner
    // en comptant à partir d'une autre.
    newId: () => randomUUID(),
    notifier: world.notifier,
    supportUrl: world.baseUrl,
    siteUrl: world.baseUrl,
    billingConfigured: false,
    storage: world.stockage,
    env: { ...process.env, NOTA_OPERATOR_EMAIL: world.operatorEmail },
  });
}

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

const TAILLE = 1024;
const PRICING = {
  valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue',
  preteur: 'banque_nationale', deplacement: 'client_50',
};

const cleDuDocument = (world, doc) => world.domain.documentStorageKey(world.acte.id, doc.id, doc.nom);

async function vueClient(world) {
  await world.request({
    method: 'GET', path: '/client/bid',
    headers: { authorization: 'Bearer ' + world.clientToken },
    query: { id: world.acte.id, dateISO: world.acte.dateISO },
  });
  assert.equal(world.response.statusCode, 200, world.response.body);
  return { corps: world.response.body, documents: world.responseJson.documents || [] };
}

async function filNotaire(world, email) {
  const token = await notarySession(world, email);
  await world.request({ method: 'GET', path: '/notary/bids', headers: { authorization: 'Bearer ' + token }, query: {} });
  assert.equal(world.response.statusCode, 200, world.response.body);
  const retenu = (world.responseJson.retained || []).find((r) => r.id === world.acte.id);
  assert.ok(retenu, 'l’acte retenu doit être dans le fil du notaire');
  return { corps: world.response.body, documents: retenu.documents || [] };
}

async function proposerPiece(world, qui, corps) {
  const chemin = qui === 'client' ? '/client/bid/documents' : '/notary/bids/documents/depot';
  const entetes = qui === 'client'
    ? { authorization: 'Bearer ' + world.clientToken }
    : { authorization: 'Bearer ' + (await notarySession(world, corps.__email)) };
  const { __email, ...charge } = corps;
  await world.request({
    method: 'POST', path: chemin, headers: entetes,
    body: JSON.stringify({ id: world.acte.id, dateISO: world.acte.dateISO, taille: TAILLE, ...charge }),
  });
  if (world.response.statusCode === 200) {
    world.piece = world.responseJson.document;
    world.depot = world.responseJson.depot;
    world.corpsDepot = world.response.body;
  }
}

// --- Given ------------------------------------------------------------------

Given('Nota tient un dépôt de documents', function () {
  armerStockage(this);
});

Given('un acte de refinancement retenu par {string}', async function (email) {
  this.notaireActe = email;
  const dateISO = this.domain.addDays(this.today, 21);
  await this.request({
    method: 'POST', path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO, montant: 2400,
      courriel: 'client@exemple.ca', prefixe: 'G1R', pricing: { ...PRICING },
    }),
  });
  assert.equal(this.response.statusCode, 201, 'publication: ' + this.response.body);
  this.acte = this.responseJson.bid;
  this.clientToken = this.responseJson.clientToken;

  const token = await notarySession(this, email);
  await this.request({
    method: 'POST', path: '/notary/bids/accept',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: this.acte.id, dateISO: this.acte.dateISO }),
  });
  assert.equal(this.response.statusCode, 200, 'rétention: ' + this.response.body);
});

// Le chemin complet, en une ligne, pour les scénarios qui commencent APRÈS le
// dépôt : proposer, téléverser, constater.
Given('une pièce déposée par le client', async function () {
  await proposerPiece(this, 'client', { nom: 'relevé.pdf', type: 'application/pdf' });
  assert.equal(this.response.statusCode, 200, 'autorisation de dépôt: ' + this.response.body);
  this.cleDeposee = cleDuDocument(this, this.piece);
  this.stockage.__deposer(this.cleDeposee, Buffer.alloc(TAILLE), 'application/pdf');
  await this.request({
    method: 'POST', path: '/client/bid/documents/confirme',
    headers: { authorization: 'Bearer ' + this.clientToken },
    body: JSON.stringify({ id: this.acte.id, dateISO: this.acte.dateISO, documentId: this.piece.id }),
  });
  assert.equal(this.response.statusCode, 200, 'constat du dépôt: ' + this.response.body);
});

// --- When -------------------------------------------------------------------

When('le client propose la pièce {string} de type {string}', async function (nom, type) {
  await proposerPiece(this, 'client', { nom, type });
});

When('le client propose la pièce {string} en dictant la clé {string}', async function (nom, cle) {
  // `cle` est un paramètre que l'API ne lit pas : la clé est FABRIQUÉE par le
  // domaine. Le scénario le prouve en la dictant quand même.
  await proposerPiece(this, 'client', { nom, type: 'application/pdf', cle });
});

When('le client affirme avoir téléversé sans l\'avoir fait', async function () {
  await this.request({
    method: 'POST', path: '/client/bid/documents/confirme',
    headers: { authorization: 'Bearer ' + this.clientToken },
    body: JSON.stringify({ id: this.acte.id, dateISO: this.acte.dateISO, documentId: this.piece.id }),
  });
});

When('le navigateur du client dépose vraiment les octets', function () {
  this.cleDeposee = cleDuDocument(this, this.piece);
  this.stockage.__deposer(this.cleDeposee, Buffer.alloc(TAILLE), this.piece.contentType || 'application/pdf');
});

When('le client confirme le dépôt', async function () {
  await this.request({
    method: 'POST', path: '/client/bid/documents/confirme',
    headers: { authorization: 'Bearer ' + this.clientToken },
    body: JSON.stringify({ id: this.acte.id, dateISO: this.acte.dateISO, documentId: this.piece.id }),
  });
});

When('le notaire {string} propose la pièce {string}', async function (email, nom) {
  await proposerPiece(this, 'notaire', { nom, type: 'application/pdf', __email: email });
});

When('le navigateur du notaire dépose vraiment les octets', function () {
  this.cleDeposee = cleDuDocument(this, this.piece);
  this.stockage.__deposer(this.cleDeposee, Buffer.alloc(TAILLE), this.piece.contentType || 'application/pdf');
});

When('le notaire {string} confirme le dépôt', async function (email) {
  const token = await notarySession(this, email);
  await this.request({
    method: 'POST', path: '/notary/bids/documents/confirme',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: this.acte.id, dateISO: this.acte.dateISO, documentId: this.piece.id }),
  });
});

Then('la pièce vient du notaire', function () {
  assert.equal(this.piece.de, this.domain.CHAT_FROM.NOTAIRE);
  assert.equal(this.piece.etat, 'en_attente');
});

When('le notaire {string} tente de déposer une pièce sur cet acte', async function (email) {
  await proposerPiece(this, 'notaire', { nom: 'note.pdf', type: 'application/pdf', __email: email });
});

async function lirePiece(world, entetes) {
  await world.request({
    method: 'GET', path: entetes.notaire ? '/notary/bids/documents' : '/client/bid/documents',
    headers: entetes.headers,
    query: { id: world.acte.id, dateISO: world.acte.dateISO, documentId: world.piece.id },
  });
}

When('le notaire {string} tente de lire la pièce', async function (email) {
  const token = await notarySession(this, email);
  await lirePiece(this, { notaire: true, headers: { authorization: 'Bearer ' + token } });
});

When('un visiteur sans jeton tente de lire la pièce', async function () {
  await lirePiece(this, { notaire: false, headers: {} });
});

When('le client tente de relire la pièce', async function () {
  await lirePiece(this, { notaire: false, headers: { authorization: 'Bearer ' + this.clientToken } });
});

When('le notaire {string} rend l\'acte au carnet', async function (email) {
  const token = await notarySession(this, email);
  await this.request({
    method: 'POST', path: '/notary/bids/release',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: this.acte.id, dateISO: this.acte.dateISO, message: 'Dossier impossible de mon côté.' }),
  });
});

// --- Then -------------------------------------------------------------------

Then('l\'autorisation de dépôt est brève et porte sur cette pièce', function () {
  assert.equal(this.depot.methode, 'PUT');
  assert.ok(this.depot.url, 'une adresse de dépôt est émise');
  assert.equal(this.depot.maxBytes, TAILLE, 'l’autorisation est bornée à la taille annoncée');
  const restant = Date.parse(this.depot.expireA) - this.nowMs;
  assert.ok(restant > 0 && restant <= 15 * 60 * 1000, 'une URL signée se compte en minutes : ' + this.depot.expireA);
});

Then('aucune autorisation de dépôt n\'est émise', function () {
  assert.equal(this.responseJson.depot, undefined, 'un fichier refusé n’ouvre aucun dépôt: ' + this.response.body);
});

Then('la pièce n\'existe pas encore pour l\'autre partie', async function () {
  assert.equal(this.piece.etat, 'en_attente');
  const vue = await vueClient(this);
  assert.deepEqual(vue.documents, [], 'rien n’apparaît dans le fil du client');
  const fil = await filNotaire(this, this.notaireActe);
  assert.deepEqual(fil.documents, [], 'ni dans celui du notaire');
});

Then('la pièce est prête des deux côtés', async function () {
  assert.equal(this.responseJson.document.etat, 'pret');
  const vue = await vueClient(this);
  assert.equal(vue.documents.length, 1);
  assert.equal(vue.documents[0].nom, this.piece.nom);
  const fil = await filNotaire(this, this.notaireActe);
  assert.equal(fil.documents.length, 1, 'le notaire voit la pièce');
  assert.equal(fil.documents[0].nom, this.piece.nom);
});

async function docStocke(world) {
  const acte = await world.repo.get(world.acte.id, world.acte.dateISO);
  const doc = (acte.documents || []).find((d) => d.id === world.piece.id);
  assert.ok(doc, 'la pièce doit exister au dossier');
  return doc;
}

Then('la clé des octets est dérivée de l\'acte par le domaine', async function () {
  const doc = await docStocke(this);
  assert.equal(doc.cle, this.domain.documentStorageKey(this.acte.id, doc.id, doc.nom),
    'la clé est fabriquée par le domaine, jamais reçue');
  assert.ok(doc.cle.startsWith('offres/' + this.acte.id + '/'), 'elle est portée par l’acte : ' + doc.cle);
});

Then('la clé des octets ne porte pas le nom du fichier', async function () {
  const doc = await docStocke(this);
  const base = doc.nom.replace(/\.[^.]+$/, '');
  assert.equal(doc.cle.includes(base), false, 'le nom du client ne décide pas de l’adresse : ' + doc.cle);
});

Then('la clé des octets ne remonte hors du dossier de l\'acte', async function () {
  const doc = await docStocke(this);
  assert.equal(/\.\./.test(doc.cle), false, 'aucune traversée n’est représentable : ' + doc.cle);
  assert.match(doc.cle, /^offres\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z]+$/);
});

Then('aucune porte publique ne rend la clé des octets', async function () {
  const doc = await docStocke(this);
  const vue = await vueClient(this);
  const fil = await filNotaire(this, this.notaireActe);
  for (const corps of [this.corpsDepot, vue.corps, fil.corps]) {
    assert.equal(corps.includes(doc.cle), false, 'la clé de stockage sort par une porte publique');
    assert.equal(/"cle"/.test(corps), false, 'aucun champ « cle » ne doit sortir : ' + corps.slice(0, 200));
  }
});

Then('le client peut lire la pièce', async function () {
  await lirePiece(this, { notaire: false, headers: { authorization: 'Bearer ' + this.clientToken } });
  assert.equal(this.response.statusCode, 200, this.response.body);
  assert.ok(this.responseJson.lecture.url, 'une autorisation de lecture est émise');
});

Then('le notaire {string} peut lire la pièce', async function (email) {
  const token = await notarySession(this, email);
  await lirePiece(this, { notaire: true, headers: { authorization: 'Bearer ' + token } });
  assert.equal(this.response.statusCode, 200, this.response.body);
  assert.ok(this.responseJson.lecture.url);
});

Then('les octets sont bien dans le dépôt', async function () {
  assert.ok(await this.stockage.head(this.cleDeposee), 'les octets devraient être déposés');
});

Then('les octets ne sont plus dans le dépôt', async function () {
  assert.equal(await this.stockage.head(this.cleDeposee), null, 'les octets survivent au désistement');
});

Then('le fil de l\'acte ne porte plus aucune pièce', async function () {
  const acte = await this.repo.get(this.acte.id, this.acte.dateISO);
  assert.equal(acte.status, this.domain.STATUS.OUVERTE);
  assert.deepEqual(acte.documents || [], [], 'le fil meurt avec la relation');
});

Then('le refus nomme le canal qui reste ouvert', function () {
  const message = (this.responseJson.errors || [])[0].message || '';
  assert.match(message, /canal/, 'le refus doit dire par où passer : ' + message);
});

// --- L'annulation par le client emporte les octets (ADR 0032, suite) -------
//
// L'autre porte de sortie de l'acte. Le désistement du notaire vidait le fil
// et le seau ; l'annulation par le client ne fermait que l'accès. Les pas
// ci-dessous gardent la clé de CHAQUE pièce — client et notaire — pour prouver
// que les deux tombent, quel que soit le côté qui a mis fin à l'acte.

// Le chemin complet côté notaire, comme « une pièce déposée par le client » :
// proposer, téléverser, constater. La clé du client est conservée à part, car
// `proposerPiece` remplace `piece` et `cleDeposee` à chaque appel.
Given('une pièce déposée par le notaire {string}', async function (email) {
  this.cleDeposeeClient = this.cleDeposee;
  await proposerPiece(this, 'notaire', { nom: 'projet.pdf', type: 'application/pdf', __email: email });
  assert.equal(this.response.statusCode, 200, 'autorisation de dépôt notaire: ' + this.response.body);
  this.cleDeposeeNotaire = cleDuDocument(this, this.piece);
  this.stockage.__deposer(this.cleDeposeeNotaire, Buffer.alloc(TAILLE), 'application/pdf');
  const token = await notarySession(this, email);
  await this.request({
    method: 'POST', path: '/notary/bids/documents/confirme',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: this.acte.id, dateISO: this.acte.dateISO, documentId: this.piece.id }),
  });
  assert.equal(this.response.statusCode, 200, 'constat du dépôt notaire: ' + this.response.body);
});

const clesDesDeuxPieces = (world) => {
  const cles = [world.cleDeposeeClient, world.cleDeposeeNotaire].filter(Boolean);
  assert.equal(cles.length, 2, 'le scénario doit avoir déposé une pièce de chaque côté');
  return cles;
};

When('le client annule l\'acte', async function () {
  await this.request({
    method: 'POST', path: '/client/bid/cancel',
    headers: { authorization: 'Bearer ' + this.clientToken },
    body: JSON.stringify({ id: this.acte.id, dateISO: this.acte.dateISO }),
  });
});

Then('les octets des deux pièces sont bien dans le dépôt', async function () {
  for (const cle of clesDesDeuxPieces(this)) {
    assert.ok(await this.stockage.head(cle), 'les octets devraient être déposés : ' + cle);
  }
});

Then('les octets des deux pièces ne sont plus dans le dépôt', async function () {
  for (const cle of clesDesDeuxPieces(this)) {
    assert.equal(await this.stockage.head(cle), null, 'les octets survivent à l’annulation : ' + cle);
  }
});

Then('l\'acte annulé ne porte plus aucune pièce', async function () {
  const acte = await this.repo.get(this.acte.id, this.acte.dateISO);
  assert.equal(acte.status, this.domain.STATUS.ANNULEE);
  assert.deepEqual(acte.documents || [], [], 'les références aux pièces meurent avec l’acte');
  assert.equal(JSON.stringify(acte).includes('offres/' + this.acte.id + '/'), false,
    'aucune clé de stockage ne subsiste sur l’offre annulée');
});
