import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// La mise en relation (ADR 0033) : les deux parties doivent pouvoir se joindre.
// Le notaire porte un nom, un téléphone et l'adresse de son étude ; tant que
// l'un des trois manque, il ne peut ni retenir ni proposer — le client
// n'aurait personne à appeler ni d'endroit où se présenter.

test('validateTelephone: accepts North-American numbers however they are typed, keeps the human formatting', () => {
  for (const raw of ['(418) 555-1234', '418.555.1234', '1 418 555 1234', '+1 418 555 1234', ' 4185551234 ']) {
    const r = D.validateTelephone(raw);
    assert.equal(r.ok, true, raw);
    assert.equal(r.value, raw.trim());
  }
});

test('validateTelephone: empty is valid and null; too short or too long is telephone_invalide', () => {
  assert.deepEqual(D.validateTelephone(''), { ok: true, value: null, error: null });
  assert.deepEqual(D.validateTelephone(null), { ok: true, value: null, error: null });
  for (const raw of ['555-1234', '12345678901234', 'abc']) {
    const r = D.validateTelephone(raw);
    assert.equal(r.ok, false, raw);
    assert.equal(r.value, null);
    assert.equal(r.error.code, 'telephone_invalide');
  }
});

test('validateNotaryProfile: carries nom, étude, téléphone and adresse — trimmed, optional, null when empty', () => {
  const r = D.validateNotaryProfile({
    nom: '  Me Julie Tremblay ', etude: ' Tremblay Notaires ', telephone: ' (418) 555-0199 ',
    adresse: ' 123, rue Saint-Jean, Québec (QC) G1R 1N4 ', rayonKm: 25,
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.nom, 'Me Julie Tremblay');
  assert.equal(r.etude, 'Tremblay Notaires');
  assert.equal(r.telephone, '(418) 555-0199');
  assert.equal(r.adresse, '123, rue Saint-Jean, Québec (QC) G1R 1N4');
  assert.equal(r.rayonKm, 25);

  const empty = D.validateNotaryProfile({});
  assert.equal(empty.ok, true);
  assert.equal(empty.nom, null);
  assert.equal(empty.etude, null);
  assert.equal(empty.telephone, null);
  assert.equal(empty.adresse, null);
});

test('validateNotaryProfile: rejects an oversized nom / étude / adresse and a bad téléphone with typed codes', () => {
  const r = D.validateNotaryProfile({
    nom: 'x'.repeat(D.NOTARY_NAME_MAX + 1), etude: 'y'.repeat(D.NOTARY_NAME_MAX + 1),
    adresse: 'z'.repeat(D.NOTARY_ADDRESS_MAX + 1), telephone: '12',
  });
  assert.equal(r.ok, false);
  const codes = r.errors.map((e) => e.code);
  assert.ok(codes.includes('nom_invalide'), codes);
  assert.ok(codes.includes('etude_invalide'), codes);
  assert.ok(codes.includes('adresse_invalide'), codes);
  assert.ok(codes.includes('telephone_invalide'), codes);
});

test('notaryContactMissing: lists exactly what a client could not reach — name, phone, address of the étude', () => {
  assert.deepEqual(D.NOTARY_CONTACT_REQUIRED, ['nom', 'telephone', 'adresse']);
  const none = D.notaryContactMissing({ nom: 'Me A', telephone: '418 555 0000', adresse: '1, rue X, Québec' });
  assert.deepEqual(none, []);
  const all = D.notaryContactMissing({ email: 'n@etude.ca', label: 'Étude' });
  assert.deepEqual(all.map((m) => m.id), ['nom', 'telephone', 'adresse']);
  for (const m of all) assert.equal(typeof m.label, 'string');
  const some = D.notaryContactMissing({ nom: 'Me A', telephone: '   ', adresse: null });
  assert.deepEqual(some.map((m) => m.id), ['telephone', 'adresse']);
  assert.deepEqual(D.notaryContactMissing(null).map((m) => m.id), ['nom', 'telephone', 'adresse']);
});

test('notaryEtude: the name a client sees — étude, else the legacy label, else the notary’s name, else the courriel', () => {
  assert.equal(D.notaryEtude({ etude: 'Tremblay Notaires', label: 'x@y.ca', nom: 'Me T', email: 'x@y.ca' }), 'Tremblay Notaires');
  assert.equal(D.notaryEtude({ label: 'Étude Laval', nom: 'Me T', email: 'x@y.ca' }), 'Étude Laval');
  assert.equal(D.notaryEtude({ nom: 'Me T', email: 'x@y.ca' }), 'Me T');
  assert.equal(D.notaryEtude({ email: 'x@y.ca' }), 'x@y.ca');
  assert.equal(D.notaryEtude(null), null);
});
