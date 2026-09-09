import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

test('the funnel catalogue is ordered from arrival to payment and bilingual', () => {
  const ids = D.FUNNEL_EVENTS.map((e) => e.id);
  assert.deepEqual(ids.slice(0, 5), ['visite', 'jour_ouvert', 'formulaire', 'publie', 'paiement_ok']);
  for (const e of D.FUNNEL_EVENTS) {
    assert.ok(e.nom && e.nomEn, e.id + ' carries both labels');
    assert.match(e.id, /^[a-z_]+$/);
  }
  assert.ok(Object.isFrozen(D.FUNNEL_EVENTS));
});

test('only catalogued names are funnel events', () => {
  assert.equal(D.isFunnelEvent('visite'), true);
  assert.equal(D.isFunnelEvent('notaire_inscrit'), true);
  assert.equal(D.isFunnelEvent('offers'), false);
  assert.equal(D.isFunnelEvent(''), false);
  assert.equal(D.isFunnelEvent(null), false);
  assert.equal(D.isFunnelEvent({ id: 'visite' }), false);
});

test('only browser observations are accepted as client events', () => {
  for (const id of ['publie', 'notaire_inscrit']) {
    assert.equal(D.isFunnelEvent(id), true);
    assert.equal(D.isClientFunnelEvent(id), false);
  }
  for (const id of ['criteres_vus', 'prix_vu', 'coordonnees_vues', 'formulaire_bloque', 'publication_tentee', 'publication_echouee']) {
    assert.equal(D.isClientFunnelEvent(id), true);
  }
  for (const id of ['inconnu', null, {}, 42]) assert.equal(D.isClientFunnelEvent(id), false);
  assert.equal(D.FUNNEL_EVENTS.find(e => e.id === 'paiement_ok').nomEn, 'Checkout returns — success');
});

test('analytics categories are bilingual, bounded and reject arbitrary identifying values', () => {
  for (const dimension of D.ANALYTICS_DIMENSIONS) {
    assert.ok(dimension.nom && dimension.nomEn);
    assert.equal(new Set(dimension.values.map(v => v.id)).size, dimension.values.length);
    for (const value of dimension.values) assert.ok(value.nom && value.nomEn);
  }
  assert.deepEqual(D.cleanAnalyticsContext({ source: 'google', browser: 'safari', email: 'private@example.test', entry: 'https://example.test/secret', viewport: 390 }), { source: 'google', browser: 'safari' });
  assert.deepEqual(D.cleanAnalyticsContext(null), {});
  assert.deepEqual(D.cleanAnalyticsContext([]), {});
});
