'use strict';
const assert = require('node:assert/strict');
const { When, Then } = require('@cucumber/cucumber');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');

async function session(world, email) {
  world.calendarSessions ||= {};
  if (world.calendarSessions[email]) return world.calendarSessions[email];
  const request = await world.app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email }) });
  const verified = await world.app.handle({ method: 'POST', path: '/notary/session/verify', body: JSON.stringify({ token: JSON.parse(request.body).devToken }) });
  assert.equal(verified.statusCode, 200, verified.body);
  return world.calendarSessions[email] = JSON.parse(verified.body);
}
async function privateFeed(world, email) {
  const { feedToken } = await session(world, email);
  return world.app.handle({ method: 'GET', path: '/notary/feed.ics', query: { token: feedToken } });
}
async function client(world) {
  const response = await world.app.handle({ method: 'GET', path: '/client/bid', headers: { authorization: 'Bearer ' + world.clientToken }, query: { id: world.lastBid.id, dateISO: world.lastBid.dateISO } });
  assert.equal(response.statusCode, 200, response.body);
  return JSON.parse(response.body);
}
function occurrences(world, response) {
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers['content-type'], /text\/calendar/);
  return response.body.split('\r\n').filter(line => line === 'UID:' + world.lastBid.id + '@nota').length;
}
Then('le calendrier public contient cette offre une fois', async function () {
  assert.equal(occurrences(this, await this.app.handle({ method: 'GET', path: '/carnet/feed.ics', query: {} })), 1);
});
Then('le calendrier public ne contient pas cette offre', async function () {
  assert.equal(occurrences(this, await this.app.handle({ method: 'GET', path: '/carnet/feed.ics', query: {} })), 0);
});
Then('le calendrier privé de {string} contient cette offre une fois', async function (email) {
  assert.equal(occurrences(this, await privateFeed(this, email)), 1);
});
Then('le calendrier privé de {string} ne contient pas cette offre', async function (email) {
  assert.equal(occurrences(this, await privateFeed(this, email)), 0);
});
Then('le client voit le statut {string} sans notaire', async function (status) {
  const result = await client(this);
  assert.equal(result.bid.status, status);
  assert.equal(result.notaire, null);
});
Then('le client voit le statut {string} avec le notaire {string}', async function (status, email) {
  const result = await client(this);
  assert.equal(result.bid.status, status);
  assert.equal(result.notaire.courriel, email);
});
When('le pointeur du calendrier subsiste après {string}', async function (change) {
  const bid = await this.repo.get(this.lastBid.id, this.lastBid.dateISO);
  const patches = {
    annulation: { status: 'annulee' },
    désistement: { status: 'ouverte', notaryId: null },
    réattribution: { notaryId: notaryIdForEmail('autre-agenda@exemple.ca'), nom: 'Nouveau client confidentiel' },
    'date modifiée': { dateISO: this.domain.addDays(bid.dateISO, 1) },
  };
  if (change === 'offre absente') {
    const get = this.repo.get.bind(this.repo);
    this.repo.get = async (id, ...args) => id === bid.id ? null : get(id, ...args);
  } else {
    assert.ok(patches[change], change);
    await this.repo.update({ ...bid, ...patches[change] });
  }
});
When('la lecture des offres du calendrier échoue', async function () {
  // Authenticate before injecting a database outage, so only the feed is tested.
  await session(this, 'agenda@exemple.ca');
  this.calendarOriginalGet = this.repo.get;
  this.repo.get = async () => { throw new Error('database unavailable: confidential diagnostic'); };
});
When('la lecture des offres du calendrier reprend', function () { this.repo.get = this.calendarOriginalGet; });
Then('le calendrier privé de {string} signale une indisponibilité temporaire', async function (email) {
  const response = await privateFeed(this, email);
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['retry-after'], '60');
  assert.doesNotMatch(response.body, /BEGIN:VCALENDAR|confidential/);
});
When('le calendrier retourne deux fois le même pointeur', function () {
  const list = this.repo.listRetainedByNotary.bind(this.repo);
  this.repo.listRetainedByNotary = async id => { const rows = await list(id); return [...rows, ...rows]; };
});
When('les notaires {string} et {string} retiennent simultanément l\'offre', async function (first, second) {
  this.calendarContenders = [first, second];
  const sessions = await Promise.all(this.calendarContenders.map(email => session(this, email)));
  const responses = await Promise.all(sessions.map(({ token }) => this.app.handle({ method: 'POST', path: '/notary/bids/accept', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ id: this.lastBid.id, dateISO: this.lastBid.dateISO }) })));
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
});
Then('un seul notaire voit cette signature et le client voit ce même notaire', async function () {
  const result = await client(this);
  assert.equal(result.bid.status, 'retenue');
  assert.ok(this.calendarContenders.includes(result.notaire.courriel));
  for (const email of this.calendarContenders) {
    assert.equal(occurrences(this, await privateFeed(this, email)), email === result.notaire.courriel ? 1 : 0);
  }
});
