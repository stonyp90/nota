// The in-app bell's catalogue covers EVERY business event (2026-09-11).
//
// `notifIn` silently drops any kind the domain does not declare, so a kind
// missing here is an event the client or the notary never learns of in the
// app: the 2026-09-11 inventory found seven such holes (publication, document
// requests, the J-7/3/1/0 reminders, the cancellation itself, the settled act,
// the answer to a proposal, a refused card hold). Each is declared here with
// both labels and its audiences, and `isNotifKind` must accept all of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

const byId = (id) => D.NOTIF_KINDS.find((k) => k.id === id);

// kind → the audiences the event concerns (the inventory's contract).
const EXPECTED = {
  publiee: ['client'],
  documents_demandes: ['client'],
  rappel: ['client'],
  annulee: ['client', 'notaire'],
  acte: ['client', 'notaire'],
  proposition_reponse: ['notaire'],
  caution: ['client', 'notaire'],
};

test('every business event has a declared in-app kind, with both titles and its audiences', () => {
  for (const [id, audiences] of Object.entries(EXPECTED)) {
    const k = byId(id);
    assert.ok(k, `kind « ${id} » is declared`);
    assert.ok(typeof k.titre === 'string' && k.titre.trim(), id + ' has a French title');
    assert.ok(typeof k.titreEn === 'string' && k.titreEn.trim(), id + ' has an English title');
    assert.notEqual(k.titre, k.titreEn, id + ' titles differ between languages');
    assert.deepEqual([...k.audiences].sort(), [...audiences].sort(), id + ' audiences');
    assert.equal(D.isNotifKind(id), true, 'isNotifKind covers ' + id);
  }
});

test('the earlier kinds are untouched and « annulation » stays the indemnity outcome, distinct from « annulee »', () => {
  for (const id of ['message', 'document', 'retenue', 'proposition', 'desistement', 'annulation']) {
    assert.ok(byId(id), id + ' still declared');
  }
  assert.deepEqual(byId('annulation').audiences, ['client']);
  assert.notEqual(byId('annulation').titre, byId('annulee').titre, 'the two cancellation kinds read differently');
});

test('the catalogue stays closed, frozen, and free of duplicates', () => {
  const ids = D.NOTIF_KINDS.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate id');
  assert.ok(Object.isFrozen(D.NOTIF_KINDS));
  for (const k of D.NOTIF_KINDS) {
    assert.ok(k.audiences.length >= 1, k.id + ' has at least one audience');
    for (const a of k.audiences) assert.ok(['client', 'notaire'].includes(a), k.id + ': ' + a);
  }
  assert.equal(D.isNotifKind('nope'), false);
});
