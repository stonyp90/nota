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
