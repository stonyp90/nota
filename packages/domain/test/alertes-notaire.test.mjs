import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// Les alertes du notaire (ADR 0033 §7) : « Recevez vos demandes à votre
// rythme » devient une donnée serveur. Le rythme est l'un de quatre mots,
// « urgences seulement » est un booléen strict, et un profil qui n'a rien dit
// reçoit le digest quotidien — la promesse qui existait déjà.

test('validateNotaryProfile: alertes absentes → le défaut est le digest quotidien, sans filtre', () => {
  assert.deepEqual(D.NOTARY_ALERT_PACES, ['instant', 'daily', 'weekly', 'off']);
  assert.deepEqual(D.NOTARY_ALERTES_DEFAULT, { pace: 'daily', urgentOnly: false });
  const r = D.validateNotaryProfile({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.alertes, { pace: 'daily', urgentOnly: false });
  const nul = D.validateNotaryProfile({ alertes: null });
  assert.equal(nul.ok, true);
  assert.deepEqual(nul.alertes, { pace: 'daily', urgentOnly: false });
});

test('validateNotaryProfile: un rythme déclaré et le filtre urgences sont retenus, normalisés', () => {
  for (const pace of D.NOTARY_ALERT_PACES) {
    const r = D.validateNotaryProfile({ alertes: { pace: ' ' + pace.toUpperCase() + ' ', urgentOnly: true } });
    assert.equal(r.ok, true, pace + ': ' + JSON.stringify(r.errors));
    assert.deepEqual(r.alertes, { pace, urgentOnly: true });
  }
  // Le filtre ne se déduit jamais d'une chaîne « truthy » : seul `true` compte.
  const r = D.validateNotaryProfile({ alertes: { pace: 'instant', urgentOnly: 'oui' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'alertes_invalides'), JSON.stringify(r.errors));
  const partiel = D.validateNotaryProfile({ alertes: { pace: 'instant' } });
  assert.equal(partiel.ok, true);
  assert.deepEqual(partiel.alertes, { pace: 'instant', urgentOnly: false });
});

test('validateNotaryProfile: un rythme inconnu ou des alertes qui ne sont pas un objet sont refusés avec un code typé', () => {
  const rythme = D.validateNotaryProfile({ alertes: { pace: 'hourly' } });
  assert.equal(rythme.ok, false);
  assert.ok(rythme.errors.some((e) => e.code === 'alerte_rythme_invalide'), JSON.stringify(rythme.errors));
  assert.equal(rythme.alertes, null, 'rien de normalisé ne sort d’un refus');
  for (const bad of ['daily', 42, ['daily']]) {
    const r = D.validateNotaryProfile({ alertes: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.errors.some((e) => e.code === 'alertes_invalides'), JSON.stringify(r.errors));
  }
});

test('notaryAlertes: lit les alertes d’un profil stocké, avec le même défaut qu’à la validation', () => {
  assert.deepEqual(D.notaryAlertes(null), { pace: 'daily', urgentOnly: false });
  assert.deepEqual(D.notaryAlertes({ email: 'n@etude.ca' }), { pace: 'daily', urgentOnly: false });
  assert.deepEqual(D.notaryAlertes({ alertes: { pace: 'instant', urgentOnly: true } }), { pace: 'instant', urgentOnly: true });
  // Une valeur corrompue en base retombe sur le défaut — jamais une exception,
  // jamais un rythme inventé.
  assert.deepEqual(D.notaryAlertes({ alertes: { pace: 'hourly', urgentOnly: 'oui' } }), { pace: 'daily', urgentOnly: false });
  assert.deepEqual(D.notaryAlertes({ alertes: 'instant' }), { pace: 'daily', urgentOnly: false });
});
