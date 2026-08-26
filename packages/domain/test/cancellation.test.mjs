// A client can withdraw (cancel) an offer — including one already retained.
// The domain rule: a cancelled bid leaves every market surface (rank, agenda,
// pulse, week vignette, reminders) but stays addressable for its owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

const bid = (over = {}) => ({
  id: over.id || 'b1',
  serviceId: 'refinancement',
  dateISO: '2026-09-10',
  montant: 3000,
  status: D.STATUS.OUVERTE,
  ...over,
});

test('STATUS exposes ANNULEE alongside OUVERTE and RETENUE', () => {
  assert.equal(D.STATUS.ANNULEE, 'annulee');
});

test('rankOf ignores cancelled peers', () => {
  const bids = [
    bid({ id: 'a', montant: 5000, status: D.STATUS.ANNULEE }),
    bid({ id: 'b', montant: 3000 }),
    bid({ id: 'c', montant: 2500 }),
  ];
  const r = D.rankOf(bids[1], bids);
  assert.deepEqual({ rang: r.rang, total: r.total }, { rang: 1, total: 2 });
});

test('validateCounterOffer refuses a cancelled bid', () => {
  const out = D.validateCounterOffer({ bid: bid({ status: D.STATUS.ANNULEE }), montant: 4000, todayISO: '2026-09-01' });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.code === 'offre_non_ouverte'));
});

test('agendaByDate leaves cancelled bids out', () => {
  const days = D.agendaByDate([bid(), bid({ id: 'x', status: D.STATUS.ANNULEE, montant: 9000 })]);
  assert.equal(days.length, 1);
  assert.equal(days[0].count, 1);
  assert.equal(days[0].total, 3000);
});

test('carnetPulse counts a cancelled bid neither as open nor in the median', () => {
  const withCancelled = D.carnetPulse(
    [bid({ montant: 3000 }), bid({ id: 'x', montant: 9000, status: D.STATUS.ANNULEE })],
    '2026-09-01'
  );
  const without = D.carnetPulse([bid({ montant: 3000 })], '2026-09-01');
  const svcA = withCancelled.services.find((s) => s.id === 'refinancement');
  const svcB = without.services.find((s) => s.id === 'refinancement');
  assert.deepEqual(svcA, svcB);
});

test('weekAgenda never shows a cancelled bid, even with retenues on', () => {
  const bids = [bid({ id: 'x', status: D.STATUS.ANNULEE })];
  assert.equal(D.weekAgenda(bids, '2026-09-01', { retenues: true }).items.length, 0);
  assert.equal(D.weekAgenda(bids, '2026-09-01').items.length, 0);
});

test('a cancelled bid is never due for reminders', () => {
  assert.deepEqual(D.dueReminders(bid({ status: D.STATUS.ANNULEE, dossierReady: false }), '2026-09-03'), []);
});

// --- Contact form ----------------------------------------------------------

test('validateContactMessage accepts a plain question and normalizes fields', () => {
  const out = D.validateContactMessage({
    nom: '  Anne Tremblay ',
    courriel: ' Anne@Example.CA ',
    sujet: ' Une question ',
    message: '  Bonjour, comment annuler une offre ?  ',
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.errors, []);
  assert.equal(out.nom, 'Anne Tremblay');
  assert.equal(out.courriel, 'anne@example.ca');
  assert.equal(out.sujet, 'Une question');
  assert.equal(out.message, 'Bonjour, comment annuler une offre ?');
});

test('validateContactMessage requires a valid courriel and a message', () => {
  const out = D.validateContactMessage({ courriel: 'pas-un-courriel', message: '   ' });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.code === 'courriel_invalide'));
  assert.ok(out.errors.some((e) => e.code === 'message_requis'));
});

test('validateContactMessage caps the message length', () => {
  const out = D.validateContactMessage({
    courriel: 'a@b.ca',
    message: 'x'.repeat(D.CONTACT_MESSAGE_MAX + 1),
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.code === 'message_trop_long'));
});

test('validateContactMessage keeps optional fields optional', () => {
  const out = D.validateContactMessage({ courriel: 'a@b.ca', message: 'Allo' });
  assert.equal(out.ok, true);
  assert.equal(out.nom, null);
  assert.equal(out.sujet, null);
});
