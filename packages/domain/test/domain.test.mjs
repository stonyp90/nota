import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

const TODAY = '2026-08-12';

test('money: fr-CA space thousands separator and trailing $', () => {
  assert.equal(D.money(950), '950 $');
  assert.equal(D.money(1350), '1 350 $');
  assert.equal(D.money(13500), '13 500 $');
  assert.equal(D.money(4950), '4 950 $');
  assert.equal(D.money(0), '0 $');
});

test('money: rounds and handles junk', () => {
  assert.equal(D.money(1234.6), '1 235 $');
  assert.equal(D.money('nope'), '0 $');
});

test('services: exactly the three bounded-intake acts', () => {
  assert.equal(D.SERVICES.length, 3);
  assert.deepEqual(D.SERVICES.map((s) => s.id).sort(), ['procuration', 'refinancement', 'testament']);
});

test('services: acte de vente is intentionally absent', () => {
  assert.equal(D.serviceById('acte_vente'), null);
});

test('services: starting prices are the canonical values', () => {
  assert.equal(D.serviceById('testament').prixDepart, 650);
  assert.equal(D.serviceById('procuration').prixDepart, 295);
  assert.equal(D.serviceById('refinancement').prixDepart, 2000);
});

test('services: every service has documents and fields with help text', () => {
  for (const s of D.SERVICES) {
    assert.ok(s.documents.length >= 1, `${s.id} has documents`);
    assert.ok(s.champs.length >= 1, `${s.id} has fields`);
    for (const d of s.documents) assert.ok(d.aide && d.aide.length > 0, `${s.id}/${d.id} help`);
    for (const c of s.champs) assert.ok(c.aide && c.aide.length > 0, `${s.id}/${c.id} help`);
  }
});

test('tiers: ordered ascending urgency', () => {
  assert.deepEqual(D.TIERS.map((t) => t.id), ['standard', 'rapide', 'prioritaire', 'urgence', 'extreme']);
});

test('tierForDays: boundaries', () => {
  assert.equal(D.tierForDays(0), 'extreme');
  assert.equal(D.tierForDays(1), 'extreme');
  assert.equal(D.tierForDays(2), 'urgence');
  assert.equal(D.tierForDays(3), 'urgence');
  assert.equal(D.tierForDays(4), 'prioritaire');
  assert.equal(D.tierForDays(7), 'prioritaire');
  assert.equal(D.tierForDays(8), 'rapide');
  assert.equal(D.tierForDays(14), 'rapide');
  assert.equal(D.tierForDays(15), 'standard');
  assert.equal(D.tierForDays(90), 'standard');
});

test('premium cap is 10', () => {
  assert.equal(D.PREMIUM_CAP, 10);
});

test('dates: ISO validation', () => {
  assert.equal(D.isISODate('2026-08-12'), true);
  assert.equal(D.isISODate('2026-13-01'), false);
  assert.equal(D.isISODate('12-08-2026'), false);
  assert.equal(D.isISODate(''), false);
});

test('dates: ISO validation rejects non-existent calendar days (no silent roll-over)', () => {
  assert.equal(D.isISODate('2026-02-31'), false); // February never has 31 days
  assert.equal(D.isISODate('2026-04-31'), false); // April has 30 days
  assert.equal(D.isISODate('2026-02-30'), false);
  assert.equal(D.isISODate('2026-02-29'), false); // 2026 is not a leap year
  assert.equal(D.isISODate('2028-02-29'), true);  // 2028 is a leap year
});

test('dates: daysBetween and addDays are inverse and tz-stable', () => {
  assert.equal(D.daysBetween('2026-08-12', '2026-08-19'), 7);
  assert.equal(D.daysBetween('2026-08-12', '2026-08-12'), 0);
  assert.equal(D.addDays('2026-08-12', 7), '2026-08-19');
  assert.equal(D.addDays('2026-08-31', 1), '2026-09-01');
});

test('validateOffer: a clean prioritaire offer', () => {
  const r = D.validateOffer({ serviceId: 'refinancement', dateISO: '2026-08-17', montant: 3000, todayISO: TODAY, pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' } });
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.tier, 'prioritaire');
  assert.equal(r.days, 5);
  assert.equal(r.prixDepart, 2000);
  assert.ok(Math.abs(r.premium - 3000 / 2000) < 1e-9);
});

test('validateOffer: rejects below starting price', () => {
  const r = D.validateOffer({ serviceId: 'testament', dateISO: '2026-09-30', montant: 400, todayISO: TODAY });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'sous_prix_depart'));
});

test('validateOffer: rejects above the 10x premium cap', () => {
  const r = D.validateOffer({ serviceId: 'testament', dateISO: '2026-08-13', montant: 7000, todayISO: TODAY });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'plafond_depasse'));
});

test('validateOffer: exactly 10x is allowed', () => {
  const r = D.validateOffer({ serviceId: 'testament', dateISO: '2026-08-13', montant: 6500, todayISO: TODAY, pricing: { who_for: 'solo', fiducie_needed: 'non' } });
  assert.equal(r.ok, true);
});

test('validateOffer: rejects an unknown service', () => {
  const r = D.validateOffer({ serviceId: 'acte_vente', dateISO: '2026-09-01', montant: 1350, todayISO: TODAY });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'service_inconnu'));
});

test('validateOffer: rejects a past date', () => {
  const r = D.validateOffer({ serviceId: 'procuration', dateISO: '2026-08-01', montant: 300, todayISO: TODAY });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'date_passee'));
});

test('validateOffer: rejects a malformed date', () => {
  const r = D.validateOffer({ serviceId: 'procuration', dateISO: 'demain', montant: 300, todayISO: TODAY });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'date_invalide'));
});

test('validateOffer: a missing/invalid todayISO is rejected, not silently skipped', () => {
  const missing = D.validateOffer({ serviceId: 'procuration', dateISO: '2026-09-01', montant: 300 });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.code === 'date_invalide'));
  assert.equal(missing.tier, null);

  const invalid = D.validateOffer({ serviceId: 'procuration', dateISO: '2026-09-01', montant: 300, todayISO: 'hier' });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((e) => e.code === 'date_invalide'));
});

test('validateOffer: rejects non-positive amount', () => {
  const r = D.validateOffer({ serviceId: 'procuration', dateISO: '2026-09-01', montant: 0, todayISO: TODAY });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'montant_invalide'));
});

test('rankOf: highest amount is 1st, retenue excluded from totals', () => {
  const bids = [
    { id: 'a', serviceId: 'testament', dateISO: '2026-08-20', montant: 600, status: 'ouverte' },
    { id: 'b', serviceId: 'testament', dateISO: '2026-08-20', montant: 900, status: 'ouverte' },
    { id: 'c', serviceId: 'testament', dateISO: '2026-08-20', montant: 700, status: 'retenue' },
    { id: 'd', serviceId: 'testament', dateISO: '2026-08-21', montant: 999, status: 'ouverte' },
  ];
  assert.deepEqual(D.rankOf(bids[1], bids), { rang: 1, total: 2 });
  assert.deepEqual(D.rankOf(bids[0], bids), { rang: 2, total: 2 });
});

test('makeFixtures: deterministic across calls', () => {
  const a = D.makeFixtures(TODAY);
  const b = D.makeFixtures(TODAY);
  assert.deepEqual(a, b);
  assert.equal(a.length, 34);
});

test('makeFixtures: every fixture is a valid offer', () => {
  const fx = D.makeFixtures(TODAY);
  for (const b of fx) {
    const r = D.validateOffer({ serviceId: b.serviceId, dateISO: b.dateISO, montant: b.montant, todayISO: TODAY, pricing: b.pricing });
    assert.equal(r.ok, true, `${b.id} ${b.serviceId} ${b.montant} on ${b.dateISO}`);
  }
});

test('leadReadiness: sellable only when dossier complete AND consent given', () => {
  const svc = D.serviceById('procuration');
  const ids = [...svc.documents, ...svc.champs].map((x) => x.id);

  assert.equal(D.leadReadiness('procuration', {}).ready, false);

  const filled = {};
  ids.forEach((id) => { filled[id] = 'ok'; });
  const noConsent = D.leadReadiness('procuration', filled);
  assert.equal(noConsent.missing.length, 0);
  assert.equal(noConsent.ready, false); // complete but no consent

  filled.__consent = true;
  assert.equal(D.leadReadiness('procuration', filled).ready, true);
});

test('leadReadiness: identity document is a required intake item', () => {
  // Every service must collect a photo ID before a lead is complete.
  for (const s of D.SERVICES) {
    assert.ok(s.documents.some((d) => d.id === 'piece_identite'), `${s.id} collects ID`);
  }
});

test('bidLabel: name when public, postal prefix when anonymous', () => {
  assert.equal(D.bidLabel({ anonyme: false, nom: 'Marie-Ève Tremblay', prefixe: 'G1R' }), 'Marie-Ève Tremblay');
  assert.equal(D.bidLabel({ anonyme: true, nom: 'Marie-Ève Tremblay', prefixe: 'G1R' }), 'Client · G1R');
});

// --- optional courriel on an offer -------------------------------------------

test('isEmail: accepts plausible addresses, rejects garbage', () => {
  assert.equal(D.isEmail('client@example.ca'), true);
  assert.equal(D.isEmail('a@b.co'), true);
  assert.equal(D.isEmail('no-at-sign'), false);
  assert.equal(D.isEmail('two @spaces.ca'), false);
  assert.equal(D.isEmail('missing@domain'), false);
  assert.equal(D.isEmail(''), false);
});

test('validateOffer: courriel is optional — absent/empty is still ok', () => {
  const base = { serviceId: 'testament', dateISO: '2026-08-20', montant: 700, todayISO: TODAY, pricing: { who_for: 'solo', fiducie_needed: 'non' } };
  assert.equal(D.validateOffer(base).ok, true);
  assert.equal(D.validateOffer(base).courriel, null);
  assert.equal(D.validateOffer({ ...base, courriel: '' }).ok, true);
});

test('validateOffer: a valid courriel passes and is echoed back trimmed', () => {
  const r = D.validateOffer({ serviceId: 'testament', dateISO: '2026-08-20', montant: 700, todayISO: TODAY, courriel: '  Client@Example.CA ', pricing: { who_for: 'solo', fiducie_needed: 'non' } });
  assert.equal(r.ok, true);
  assert.equal(r.courriel, 'Client@Example.CA');
});

test('validateOffer: an invalid courriel is rejected with courriel_invalide', () => {
  const r = D.validateOffer({ serviceId: 'testament', dateISO: '2026-08-20', montant: 700, todayISO: TODAY, courriel: 'not-an-email' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'courriel_invalide'));
});

// --- reminder schedule -------------------------------------------------------

test('REMINDER_OFFSETS is the 7/3/1 cadence', () => {
  assert.deepEqual(D.REMINDER_OFFSETS, [7, 3, 1]);
});

test('dueReminders: fires the matching kind exactly on 7/3/1 days out', () => {
  const open = (dateISO) => ({ id: 'b', serviceId: 'testament', dateISO, montant: 700, status: 'ouverte' });
  assert.deepEqual(D.dueReminders(open(D.addDays(TODAY, 7)), TODAY), ['j7']);
  assert.deepEqual(D.dueReminders(open(D.addDays(TODAY, 3)), TODAY), ['j3']);
  assert.deepEqual(D.dueReminders(open(D.addDays(TODAY, 1)), TODAY), ['j1']);
});

test('dueReminders: nothing on a non-cadence day', () => {
  const open = { id: 'b', serviceId: 'testament', dateISO: D.addDays(TODAY, 5), montant: 700, status: 'ouverte' };
  assert.deepEqual(D.dueReminders(open, TODAY), []);
});

test('dueReminders: nothing for a retained bid, even on a cadence day', () => {
  const retenue = { id: 'b', serviceId: 'testament', dateISO: D.addDays(TODAY, 7), montant: 700, status: 'retenue' };
  assert.deepEqual(D.dueReminders(retenue, TODAY), []);
});

test('dueReminders: nothing for a bid whose signing date has passed', () => {
  const past = { id: 'b', serviceId: 'testament', dateISO: D.addDays(TODAY, -1), montant: 700, status: 'ouverte' };
  assert.deepEqual(D.dueReminders(past, TODAY), []);
});

test('dueReminders: the dossier_incomplet hook fires for an incomplete open lead', () => {
  const incomplete = { id: 'b', serviceId: 'testament', dateISO: D.addDays(TODAY, 10), montant: 700, status: 'ouverte', dossierReady: false };
  assert.deepEqual(D.dueReminders(incomplete, TODAY), ['dossier_incomplet']);
  // On a cadence day it stacks with the date-approaching kind.
  const both = { ...incomplete, dateISO: D.addDays(TODAY, 3) };
  assert.deepEqual(D.dueReminders(both, TODAY), ['j3', 'dossier_incomplet']);
});

test('recommendedAmount: mid-tier default, within bounds, one-tap booking', () => {
  // refinancement market 2000 -> Nota price 3000, 5 days out -> prioritaire (mid 1.9)
  const t = D.tierById('prioritaire');
  const base = D.notaPrice('refinancement');
  const expected = Math.round((base * (t.apercuMin + t.apercuMax) / 2) / 5) * 5;
  assert.equal(D.recommendedAmount('refinancement', '2026-08-17', TODAY), expected);
  // always within [Nota floor, 10x floor]
  for (const s of D.SERVICES) {
    const r = D.recommendedAmount(s.id, '2026-08-13', TODAY); // 1 day = extreme
    const floor = D.notaPrice(s.id);
    assert.ok(r >= floor && r <= floor * 10, `${s.id} recommended in bounds`);
  }
  // unknown service / bad date -> null
  assert.equal(D.recommendedAmount('bad', '2026-09-01', TODAY), null);
  assert.equal(D.recommendedAmount('testament', 'nope', TODAY), null);
});
