import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

const TODAY = '2026-08-12';
// An open refinancement demand at its 2 000 $ floor, offered slightly above it
// (the single-act catalogue since ADR 0010).
const open = (over = {}) => ({
  id: 'b1',
  serviceId: 'refinancement',
  dateISO: '2026-08-20',
  montant: 2200,
  basePrice: 2000,
  status: D.STATUS.OUVERTE,
  ...over,
});
const codes = (r) => r.errors.map((e) => e.code);

// ---------------------------------------------------------------------------
// Counter-offer (proposition de prix) — a notary asks the client for more.
// ---------------------------------------------------------------------------

test('validateCounterOffer: a higher amount on an open bid is ok and reports the delta', () => {
  const r = D.validateCounterOffer({ bid: open(), montant: 2600, todayISO: TODAY });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.montant, 2600);
  assert.equal(r.delta, 400);
});

test('validateCounterOffer: must exceed the client’s current amount', () => {
  const same = D.validateCounterOffer({ bid: open(), montant: 2200, todayISO: TODAY });
  assert.ok(codes(same).includes('proposition_inferieure'));
  const lower = D.validateCounterOffer({ bid: open(), montant: 2100, todayISO: TODAY });
  assert.ok(codes(lower).includes('proposition_inferieure'));
  assert.ok(lower.errors[0].message.includes(D.money(2200)), 'the message names the amount to beat');
});

test('validateCounterOffer: respects the premium cap over the bid’s own floor', () => {
  const cap = 2000 * D.PREMIUM_CAP;
  assert.equal(D.validateCounterOffer({ bid: open(), montant: cap, todayISO: TODAY }).ok, true);
  const over = D.validateCounterOffer({ bid: open(), montant: cap + 1, todayISO: TODAY });
  assert.ok(codes(over).includes('plafond_depasse'));
});

test('validateCounterOffer: falls back to the service starting price when the bid carries no floor', () => {
  const r = D.validateCounterOffer({ bid: open({ basePrice: undefined }), montant: 2000 * D.PREMIUM_CAP + 1, todayISO: TODAY });
  assert.ok(codes(r).includes('plafond_depasse'));
});

test('validateCounterOffer: rejects junk amounts and non-open bids', () => {
  assert.ok(codes(D.validateCounterOffer({ bid: open(), montant: 'x', todayISO: TODAY })).includes('montant_invalide'));
  assert.ok(codes(D.validateCounterOffer({ bid: open(), montant: -5, todayISO: TODAY })).includes('montant_invalide'));
  const taken = D.validateCounterOffer({ bid: open({ status: D.STATUS.RETENUE }), montant: 2600, todayISO: TODAY });
  assert.ok(codes(taken).includes('offre_non_ouverte'));
  const past = D.validateCounterOffer({ bid: open({ dateISO: '2026-08-01' }), montant: 2600, todayISO: TODAY });
  assert.ok(codes(past).includes('date_passee'));
  assert.ok(codes(D.validateCounterOffer({ bid: null, montant: 2600, todayISO: TODAY })).includes('offre_non_ouverte'));
});

test('validateCounterOffer: rounds to whole dollars', () => {
  assert.equal(D.validateCounterOffer({ bid: open(), montant: 2599.6, todayISO: TODAY }).montant, 2600);
});

test('suggestedCounterOffer: a sensible default above the client’s amount, never above the cap', () => {
  const s = D.suggestedCounterOffer(open());
  assert.ok(s > 2200, 'above the current amount');
  assert.ok(s <= 2000 * D.PREMIUM_CAP, 'within the cap');
  assert.equal(s % 10, 0, 'a round number a notary would actually type');
  // Near the cap the suggestion clamps instead of overshooting.
  assert.equal(D.suggestedCounterOffer(open({ montant: 2000 * D.PREMIUM_CAP - 1 })), 2000 * D.PREMIUM_CAP);
});

// ---------------------------------------------------------------------------
// Document request — a notary asks the client for specific pieces.
// ---------------------------------------------------------------------------

test('validateDocumentRequest: known documents of the service are accepted and labelled', () => {
  const r = D.validateDocumentRequest({ serviceId: 'refinancement', documents: ['piece_identite', 'offre_preteur'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.documents.map((d) => d.id), ['piece_identite', 'offre_preteur']);
  assert.equal(r.documents[0].nom, 'Pièce d’identité avec photo');
});

test('validateDocumentRequest: a field (champ) of the service may be requested too', () => {
  const r = D.validateDocumentRequest({ serviceId: 'refinancement', documents: ['preteur'] });
  assert.equal(r.ok, true);
  assert.equal(r.documents[0].nom, 'Prêteur');
});

test('validateDocumentRequest: rejects unknown service, empty list, unknown ids, and dedupes', () => {
  assert.ok(codes(D.validateDocumentRequest({ serviceId: 'nope', documents: ['x'] })).includes('service_inconnu'));
  assert.ok(codes(D.validateDocumentRequest({ serviceId: 'refinancement', documents: [] })).includes('documents_requis'));
  assert.ok(codes(D.validateDocumentRequest({ serviceId: 'refinancement' })).includes('documents_requis'));
  const bad = D.validateDocumentRequest({ serviceId: 'refinancement', documents: ['piece_identite', 'bidule'] });
  assert.ok(codes(bad).includes('document_inconnu'));
  const dup = D.validateDocumentRequest({ serviceId: 'refinancement', documents: ['piece_identite', 'piece_identite'] });
  assert.equal(dup.ok, true);
  assert.equal(dup.documents.length, 1);
});

test('validateDocumentRequest: the optional message is trimmed and bounded', () => {
  const r = D.validateDocumentRequest({ serviceId: 'refinancement', documents: ['piece_identite'], message: '  Merci  ' });
  assert.equal(r.message, 'Merci');
  const long = D.validateDocumentRequest({ serviceId: 'refinancement', documents: ['piece_identite'], message: 'x'.repeat(2000) });
  assert.ok(codes(long).includes('message_trop_long'));
});

// ---------------------------------------------------------------------------
// The notary's working view: open bids by date, best offer first.
// ---------------------------------------------------------------------------

test('agendaByDate: groups open bids by signing date, highest amount first', () => {
  const bids = [
    open({ id: 'a', dateISO: '2026-08-21', montant: 2600 }),
    open({ id: 'b', dateISO: '2026-08-20', montant: 2200 }),
    open({ id: 'c', dateISO: '2026-08-20', montant: 2500 }),
    open({ id: 'e', dateISO: '2026-08-20', montant: 3100, status: D.STATUS.RETENUE }),
  ];
  const days = D.agendaByDate(bids);
  assert.deepEqual(days.map((d) => d.dateISO), ['2026-08-20', '2026-08-21']);
  const d20 = days[0];
  assert.equal(d20.total, 4700, 'the money on the table that day (open bids only)');
  assert.equal(d20.count, 2);
  // Services in the canonical SERVICES order, each with its bids best-first.
  assert.deepEqual(d20.services.map((s) => s.serviceId), ['refinancement']);
  assert.deepEqual(d20.services[0].bids.map((b) => b.id), ['c', 'b']);
  assert.equal(d20.services[0].nom, 'Refinancement hypothécaire');
  assert.equal(d20.services[0].best, 2500);
});

test('agendaByDate: skips malformed bids and returns [] for nothing', () => {
  assert.deepEqual(D.agendaByDate([]), []);
  assert.deepEqual(D.agendaByDate(null), []);
  assert.deepEqual(D.agendaByDate([{ id: 'z', dateISO: 'nope', serviceId: 'refinancement', montant: 1 }]), []);
  // A bid for a retired act (ADR 0010) is filtered, never rendered or crashed on.
  assert.deepEqual(D.agendaByDate([{ id: 'y', dateISO: '2026-08-20', serviceId: 'testament', montant: 1300, status: D.STATUS.OUVERTE }]), []);
});
