'use strict';
const assert = require('node:assert/strict');
const { When, Then } = require('@cucumber/cucumber');
const { createAnalytics } = require('../../apps/api/src/analytics');

When('le navigateur déclare les événements {string}', async function (events) {
  for (const event of events.split(',')) {
    const response = await this.app.handle({ method: 'POST', path: '/events', sourceIp: '127.0.0.1', body: JSON.stringify({ event }) });
    assert.equal(response.statusCode, 204);
  }
  this.funnelOverview = await createAnalytics({ repo: this.repo, now: () => this.today }).overview();
});
Then('le compteur de parcours {string} vaut {int}', function (id, count) {
  assert.equal(this.funnelOverview.entonnoir.find(e => e.id === id).total, count);
});
Then('le libellé du parcours {string} est {string}', function (id, label) {
  assert.equal(this.domain.FUNNEL_EVENTS.find(e => e.id === id).nom, label);
});

When('un navigateur Android déclare une visite provenant de Google avec une URL privée', async function () {
  await this.app.handle({ method: 'POST', path: '/events', headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 15) Chrome/135.0 Mobile Safari/537.36' }, body: JSON.stringify({ event: 'visite', context: { source: 'google', url: 'https://private.example/secret', entry: 'https://private.example/secret' } }) });
  this.funnelOverview = await createAnalytics({ repo: this.repo, now: () => this.today }).overview();
});
Then('le segment {string} contient {string} avec {int} visite', function (dimension, value, count) {
  assert.equal(this.funnelOverview.segments.find(d => d.id === dimension).rows.find(row => row.id === value).events.visite, count);
});
Then('les statistiques du parcours ne contiennent pas l’URL privée', function () {
  assert.ok(!JSON.stringify(this.funnelOverview).includes('private.example'));
});
