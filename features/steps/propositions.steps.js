'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');

// --- Helpers ----------------------------------------------------------------

// Sign a notary in through the real passwordless handshake (request → verify)
// and cache the session token per email on the world. Outside production the
// request echoes the single-use challenge token, so the flow needs no mailbox.
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

function lastBid(world) {
  assert.ok(world.lastBidId, 'aucune offre publiée dans ce scénario');
  return world.lastBid;
}

// --- Given ------------------------------------------------------------------

Given('un notaire actif {string}', async function (email) {
  await this.repo.putNotary({ id: notaryIdForEmail(email), email, status: 'active', label: 'Étude ' + email });
});

// --- When: notary actions ---------------------------------------------------

async function propose(world, email, montant) {
  const token = await notarySession(world, email);
  const bid = lastBid(world);
  await world.request({
    method: 'POST',
    path: '/notary/bids/propose',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, montant }),
  });
  if (world.response.statusCode === 200) world.proposition = world.responseJson.proposition;
}

// Used both as a Given (a proposition already on the table) and as a When.
When('le notaire {string} propose {int} sur l\'offre', async function (email, montant) {
  await propose(this, email, montant);
});

When('le notaire {string} demande les documents {string} sur l\'offre', async function (email, list) {
  const token = await notarySession(this, email);
  const bid = lastBid(this);
  const documents = list.split(',').map((s) => s.trim()).filter(Boolean);
  await this.request({
    method: 'POST',
    path: '/notary/bids/documents',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, documents }),
  });
  if (this.response.statusCode === 200) this.demande = this.responseJson.demande;
});

// --- When: client answers ---------------------------------------------------

When('le client accepte la proposition', async function () {
  const bid = lastBid(this);
  assert.ok(this.proposition, 'aucune proposition à accepter');
  await this.request({
    method: 'POST',
    path: '/client/propositions/accept',
    headers: { authorization: 'Bearer ' + this.clientToken },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, propositionId: this.proposition.id }),
  });
});

// --- Then -------------------------------------------------------------------

Then('la proposition est en attente avec un écart de {int}', function (delta) {
  const p = this.responseJson.proposition;
  assert.equal(p.status, 'en_attente');
  assert.equal(p.delta, delta);
});

Then('l\'offre est retenue par {string} à {int}', async function (email, montant) {
  const bid = lastBid(this);
  const stored = await this.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.status, this.domain.STATUS.RETENUE);
  assert.equal(stored.notaryId, notaryIdForEmail(email));
  assert.equal(stored.montant, montant);
  assert.equal(this.responseJson.bid.montant, montant);
});

Then('la demande porte sur {int} documents non fournis', function (count) {
  const d = this.responseJson.demande;
  assert.equal(d.documents.length, count);
  assert.equal(d.fournie, false);
});

Then('le courriel {string} reçu par {string} nomme chaque document demandé', function (label, email) {
  void label;
  const msgs = this.mailsTo(email).filter((m) => m.subject.includes('document'));
  assert.ok(msgs.length >= 1, 'aucun courriel de demande de documents pour ' + email);
  for (const doc of this.demande.documents) {
    assert.ok(msgs[0].html.includes(doc.nom), 'le courriel ne nomme pas « ' + doc.nom + ' »');
  }
});
