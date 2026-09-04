/**
 * The support inbox and the in-app notification catalogue are product rules:
 *   • a support thread has ONE status, derived from who spoke last — the
 *     operator's inbox sorts on it and the widget never contradicts it;
 *   • the operator's quick replies are data, bilingual, never typed twice;
 *   • the in-app notification kinds are a closed, bilingual catalogue shared
 *     by the API (writer), the web bell (reader) and the tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

const v = (de, at) => ({ id: at, de, texte: 'x', createdAt: at });

test('supportThreadSummary: status follows who spoke last, and clos wins', () => {
  const t = { id: 't1', courriel: 'a@b.ca', createdAt: '2026-09-04T10:00:00.000Z',
    messages: [v(D.SUPPORT_FROM.VISITEUR, '2026-09-04T10:00:00.000Z')] };
  let s = D.supportThreadSummary(t);
  assert.equal(s.statut, D.SUPPORT_STATUT.A_REPONDRE);
  assert.equal(s.nb, 1);
  assert.equal(s.dernierDe, 'visiteur');
  assert.equal(s.dernierAt, '2026-09-04T10:00:00.000Z');
  assert.equal(s.dernierTexte, 'x');
  t.messages.push(v(D.SUPPORT_FROM.NOTA, '2026-09-04T10:05:00.000Z'));
  s = D.supportThreadSummary(t);
  assert.equal(s.statut, D.SUPPORT_STATUT.REPONDU);
  assert.equal(s.dernierDe, 'nota');
  assert.equal(s.nb, 2);
  // A visitor writing again reopens the thread.
  t.messages.push(v(D.SUPPORT_FROM.VISITEUR, '2026-09-04T11:00:00.000Z'));
  assert.equal(D.supportThreadSummary(t).statut, D.SUPPORT_STATUT.A_REPONDRE);
  // Closed by the operator stays closed until the visitor writes again.
  assert.equal(D.supportThreadSummary({ ...t, closLe: '2026-09-04T12:00:00.000Z' }).statut, D.SUPPORT_STATUT.CLOS);
  t.messages.push(v(D.SUPPORT_FROM.VISITEUR, '2026-09-04T13:00:00.000Z'));
  assert.equal(D.supportThreadSummary({ ...t, closLe: '2026-09-04T12:00:00.000Z' }).statut, D.SUPPORT_STATUT.A_REPONDRE);
  // An empty thread is still a thread — waiting, with no last message.
  const e = D.supportThreadSummary({ id: 'e', messages: [] });
  assert.equal(e.statut, D.SUPPORT_STATUT.A_REPONDRE);
  assert.equal(e.nb, 0);
  assert.equal(e.dernierAt, null);
  // The summary never carries the whole log: the excerpt is bounded.
  const long = { id: 'l', messages: [{ id: 'm', de: 'visiteur', texte: 'a'.repeat(500), createdAt: '2026-09-04T10:00:00.000Z' }] };
  assert.ok(D.supportThreadSummary(long).dernierTexte.length <= D.SUPPORT_EXCERPT_MAX + 1);
});

test('the support statuses and quick replies are bilingual product data', () => {
  assert.deepEqual(Object.values(D.SUPPORT_STATUT).sort(), ['a_repondre', 'clos', 'repondu']);
  for (const s of D.SUPPORT_STATUTS) {
    assert.ok(s.id && s.nom && s.nomEn, s.id);
  }
  assert.ok(D.SUPPORT_REPONSES_TYPES.length >= 4, 'a handful of ready answers');
  for (const r of D.SUPPORT_REPONSES_TYPES) {
    assert.ok(r.id && r.titre && r.titreEn && r.texte && r.texteEn, r.id);
    assert.ok(r.texte.length <= D.SUPPORT_MESSAGE_MAX, 'a quick reply must itself be a valid message');
    assert.ok(D.validateSupportMessage({ texte: r.texte }).ok, r.id + ' validates');
    assert.ok(!/\d\s*\$/.test(r.texte), 'no hardcoded amount in a quick reply — prices come from the grid');
  }
});

test('NOTIF_KINDS is a closed bilingual catalogue with an audience per kind', () => {
  const ids = D.NOTIF_KINDS.map((k) => k.id);
  for (const must of ['message', 'retenue', 'proposition', 'document']) assert.ok(ids.includes(must), must);
  for (const k of D.NOTIF_KINDS) {
    assert.ok(k.titre && k.titreEn, k.id + ' titles');
    assert.ok(Array.isArray(k.audiences) && k.audiences.length, k.id + ' audiences');
    for (const a of k.audiences) assert.ok(['client', 'notaire'].includes(a), a);
  }
  assert.equal(D.isNotifKind('message'), true);
  assert.equal(D.isNotifKind('nope'), false);
  assert.ok(Object.isFrozen(D.NOTIF_KINDS));
});
