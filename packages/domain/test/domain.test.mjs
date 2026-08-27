import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

const TODAY = '2026-08-12';

// Fully-answered mandatory pricing params that keep refinancement at its
// 2 000 $ base — the standard fixture for a valid offer since ADR 0010.
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' };

// fr-CA separates thousands and the sign with a NO-BREAK space (U+00A0), so an
// amount never wraps mid-number or leaves its "$" stranded on the next line.
const NB = '\u00A0';

test('money: fr-CA no-break space thousands separator and trailing $', () => {
  assert.equal(D.money(950), '950' + NB + '$');
  assert.equal(D.money(1350), '1' + NB + '350' + NB + '$');
  assert.equal(D.money(13500), '13' + NB + '500' + NB + '$');
  assert.equal(D.money(4950), '4' + NB + '950' + NB + '$');
  assert.equal(D.money(0), '0' + NB + '$');
  assert.ok(!D.money(1350).includes(' '), 'never a breaking ASCII space');
});

test('money: rounds and handles junk', () => {
  assert.equal(D.money(1234.6), '1' + NB + '235' + NB + '$');
  assert.equal(D.money('nope'), '0' + NB + '$');
});

// en-CA mirrors money(): same integer dollars, same rounding — only the
// English-Canada shape (leading $, comma thousands) differs.
test('moneyEn: en-CA comma thousands separator and leading $', () => {
  assert.equal(D.moneyEn(950), '$950');
  assert.equal(D.moneyEn(1350), '$1,350');
  assert.equal(D.moneyEn(13500), '$13,500');
  assert.equal(D.moneyEn(1234567), '$1,234,567');
  assert.equal(D.moneyEn(0), '$0');
  assert.equal(D.moneyEn(-1250), '−$1,250');
});

test('moneyEn: rounds and handles junk exactly like money()', () => {
  assert.equal(D.moneyEn(1234.6), '$1,235');
  assert.equal(D.moneyEn('nope'), '$0');
});

test('services: the catalogue is the financing family — refinancement then financement (ADR 0010)', () => {
  // The urgency ladder prices a deadline, and financing is the family that has
  // one. testament and procuration were retired by ADR 0010; financement (the
  // loan act for a NEW hypothec) is exactly the financing sibling that ADR
  // foresaw. Order matters: refinancement leads and stays the default.
  assert.deepEqual(D.SERVICES.map((s) => s.id), ['refinancement', 'financement']);
});

test('services: acte de vente is intentionally absent', () => {
  assert.equal(D.serviceById('acte_vente'), null);
});

test('services: the retired acts are gone, not aliased (ADR 0010)', () => {
  assert.equal(D.serviceById('testament'), null);
  assert.equal(D.serviceById('procuration'), null);
});

test('services: the starting prices are the canonical values (ADR 0006)', () => {
  assert.equal(D.serviceById('refinancement').prixDepart, 2000);
  // Slightly under refinancement: no old hypothec to discharge.
  assert.equal(D.serviceById('financement').prixDepart, 1800);
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
  assert.equal(D.tierById('nope'), null);
});

test('tiers: the ladder is strictly more expensive as the date closes in', () => {
  // Each step must cost strictly more than the one below it, or the calendar's
  // colours would rank dates in an order the prices do not.
  const mults = D.TIERS.map((t) => D.tierMultiplier(t.id));
  for (let i = 1; i < mults.length; i++) {
    assert.ok(mults[i] > mults[i - 1], D.TIERS[i].id + ' must cost more than ' + D.TIERS[i - 1].id);
  }
  // Realistic urgency surcharges: +0/+15/+35/+60/+100 % over the floor.
  assert.deepEqual(mults, [1.0, 1.15, 1.35, 1.6, 2.0]);
  // ...and the steepest step still fits under the hard cap the server enforces.
  assert.ok(mults[mults.length - 1] <= D.PREMIUM_CAP);
});

test('tierForDays: boundaries', () => {
  assert.equal(D.tierForDays(0), 'extreme');      // signing today
  assert.equal(D.tierForDays(1), 'urgence');      // tomorrow
  assert.equal(D.tierForDays(2), 'prioritaire');
  assert.equal(D.tierForDays(3), 'prioritaire');
  assert.equal(D.tierForDays(4), 'rapide');
  assert.equal(D.tierForDays(8), 'rapide');
  assert.equal(D.tierForDays(14), 'rapide');
  assert.equal(D.tierForDays(15), 'standard');
  assert.equal(D.tierForDays(90), 'standard');
});

test('premium cap is 3', () => {
  assert.equal(D.PREMIUM_CAP, 3);
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
  // 3 days out is prioritaire; 2 700 $ is the band's midpoint (1,35× the floor).
  const r = D.validateOffer({ serviceId: 'refinancement', dateISO: '2026-08-15', montant: 2700, todayISO: TODAY, pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' } });
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.tier, 'prioritaire');
  assert.equal(r.days, 3);
  assert.equal(r.prixDepart, 2000);
  assert.ok(Math.abs(r.premium - 2700 / 2000) < 1e-9);
});

test('validateOffer: rejects below starting price', () => {
  const r = D.validateOffer({ serviceId: 'refinancement', dateISO: '2026-09-30', montant: 1400, todayISO: TODAY, pricing: PRICING });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'sous_prix_depart'));
});

test('validateOffer: rejects above the 3x premium cap', () => {
  const r = D.validateOffer({ serviceId: 'refinancement', dateISO: '2026-08-13', montant: 6001, todayISO: TODAY, pricing: PRICING });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'plafond_depasse'));
});

test('validateOffer: exactly 3x is allowed', () => {
  const r = D.validateOffer({ serviceId: 'refinancement', dateISO: '2026-08-13', montant: 6000, todayISO: TODAY, pricing: PRICING });
  assert.equal(r.ok, true);
});

test('validateOffer: rejects an unknown service', () => {
  const r = D.validateOffer({ serviceId: 'acte_vente', dateISO: '2026-09-01', montant: 1350, todayISO: TODAY });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'service_inconnu'));
});

test('validateOffer: rejects a past date', () => {
  const r = D.validateOffer({ serviceId: 'refinancement', dateISO: '2026-08-01', montant: 2500, todayISO: TODAY, pricing: PRICING });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'date_passee'));
});

test('validateOffer: rejects a malformed date', () => {
  const r = D.validateOffer({ serviceId: 'refinancement', dateISO: 'demain', montant: 2500, todayISO: TODAY, pricing: PRICING });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'date_invalide'));
});

test('validateOffer: a missing/invalid todayISO is rejected, not silently skipped', () => {
  const missing = D.validateOffer({ serviceId: 'refinancement', dateISO: '2026-09-01', montant: 2500, pricing: PRICING });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.code === 'date_invalide'));
  assert.equal(missing.tier, null);

  const invalid = D.validateOffer({ serviceId: 'refinancement', dateISO: '2026-09-01', montant: 2500, todayISO: 'hier', pricing: PRICING });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((e) => e.code === 'date_invalide'));
});

test('validateOffer: rejects non-positive amount', () => {
  const r = D.validateOffer({ serviceId: 'refinancement', dateISO: '2026-09-01', montant: 0, todayISO: TODAY, pricing: PRICING });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'montant_invalide'));
});

test('rankOf: highest amount is 1st, retenue excluded from totals', () => {
  const bids = [
    { id: 'a', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2600, status: 'ouverte' },
    { id: 'b', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2900, status: 'ouverte' },
    { id: 'c', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2700, status: 'retenue' },
    { id: 'd', serviceId: 'refinancement', dateISO: '2026-08-21', montant: 2999, status: 'ouverte' },
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

test('leadReadiness: price before documents — required answers + consent make it sellable (ADR 0010)', () => {
  // None of the documents changes the price; the price is a pure function of
  // the pricing answers. So the gate is: required answers (under __pricing)
  // AND consent — a demand is ready even with ZERO documents provided.
  assert.equal(D.leadReadiness('refinancement', {}).ready, false);

  const answered = { __pricing: { ...PRICING } };
  const noConsent = D.leadReadiness('refinancement', answered);
  assert.equal(noConsent.requis.length, 0, 'every required question answered');
  assert.equal(noConsent.ready, false, 'consent still gates');

  const r = D.leadReadiness('refinancement', { ...answered, __consent: true });
  assert.equal(r.ready, true, 'sellable with an empty document checklist');
  assert.equal(r.done, 0);
  assert.ok(r.missing.length > 0, 'the checklist still reports preparation progress');
});

test('leadReadiness: requis lists the unanswered required pricing questions, by label', () => {
  const required = D.serviceById('refinancement').pricing.criteria
    .filter((c) => c.required)
    .map((c) => c.label);
  assert.ok(required.length >= 3, 'refinancement has required pricing questions');

  const none = D.leadReadiness('refinancement', { __consent: true });
  assert.deepEqual(none.requis, required);
  assert.equal(none.ready, false, 'consent alone does not sell an unpriced demand');

  const partial = D.leadReadiness('refinancement', { __consent: true, __pricing: { valeur_pret: 250000 } });
  assert.deepEqual(partial.requis, required.slice(1), 'an answered question leaves the list');
});

test('leadReadiness: documents are progress, and "transmis autrement" counts as provided (ADR 0010)', () => {
  // After the mise en relation a document can flow through the notary's own
  // channel; marking it DOSSIER_TRANSMIS completes the checklist item.
  assert.equal(D.DOSSIER_TRANSMIS, 'transmis_autrement');
  const svc = D.serviceById('refinancement');
  const saved = { piece_identite: 'data:image/png;…', offre_preteur: D.DOSSIER_TRANSMIS };
  const r = D.leadReadiness('refinancement', saved);
  assert.equal(r.total, svc.documents.length + svc.champs.length);
  assert.equal(r.done, 2, 'the item sent outside Nota counts as provided');
  assert.ok(!r.missing.includes('Offre de financement du prêteur'));
  assert.ok(r.missing.includes('Certificat de localisation'));
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
  const base = { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2500, todayISO: TODAY, pricing: PRICING };
  assert.equal(D.validateOffer(base).ok, true);
  assert.equal(D.validateOffer(base).courriel, null);
  assert.equal(D.validateOffer({ ...base, courriel: '' }).ok, true);
});

test('validateOffer: a valid courriel passes and is echoed back trimmed', () => {
  const r = D.validateOffer({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2500, todayISO: TODAY, courriel: '  Client@Example.CA ', pricing: PRICING });
  assert.equal(r.ok, true);
  assert.equal(r.courriel, 'Client@Example.CA');
});

test('validateOffer: an invalid courriel is rejected with courriel_invalide', () => {
  const r = D.validateOffer({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2500, todayISO: TODAY, courriel: 'not-an-email', pricing: PRICING });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'courriel_invalide'));
});

// --- reminder schedule -------------------------------------------------------

test('REMINDER_OFFSETS is the 7/3/1 cadence', () => {
  assert.deepEqual(D.REMINDER_OFFSETS, [7, 3, 1]);
});

test('dueReminders: fires the matching kind exactly on 7/3/1 days out', () => {
  const open = (dateISO) => ({ id: 'b', serviceId: 'refinancement', dateISO, montant: 2500, status: 'ouverte' });
  assert.deepEqual(D.dueReminders(open(D.addDays(TODAY, 7)), TODAY), ['j7']);
  assert.deepEqual(D.dueReminders(open(D.addDays(TODAY, 3)), TODAY), ['j3']);
  assert.deepEqual(D.dueReminders(open(D.addDays(TODAY, 1)), TODAY), ['j1']);
});

test('dueReminders: nothing on a non-cadence day', () => {
  const open = { id: 'b', serviceId: 'refinancement', dateISO: D.addDays(TODAY, 5), montant: 2500, status: 'ouverte' };
  assert.deepEqual(D.dueReminders(open, TODAY), []);
});

test('dueReminders: nothing for a retained bid, even on a cadence day', () => {
  const retenue = { id: 'b', serviceId: 'refinancement', dateISO: D.addDays(TODAY, 7), montant: 2500, status: 'retenue' };
  assert.deepEqual(D.dueReminders(retenue, TODAY), []);
});

test('dueReminders: nothing for a bid whose signing date has passed', () => {
  const past = { id: 'b', serviceId: 'refinancement', dateISO: D.addDays(TODAY, -1), montant: 2500, status: 'ouverte' };
  assert.deepEqual(D.dueReminders(past, TODAY), []);
});

test('dueReminders: the dossier_incomplet hook fires for an incomplete open lead', () => {
  const incomplete = { id: 'b', serviceId: 'refinancement', dateISO: D.addDays(TODAY, 10), montant: 2500, status: 'ouverte', dossierReady: false };
  assert.deepEqual(D.dueReminders(incomplete, TODAY), ['dossier_incomplet']);
  // On a cadence day it stacks with the date-approaching kind.
  const both = { ...incomplete, dateISO: D.addDays(TODAY, 3) };
  assert.deepEqual(D.dueReminders(both, TODAY), ['j3', 'dossier_incomplet']);
});

test('recommendedAmount: mid-tier default, within bounds, one-tap booking', () => {
  // 2 days out -> prioritaire, whose band is centred on 1.35.
  const t = D.tierById('prioritaire');
  assert.equal((t.apercuMin + t.apercuMax) / 2, 1.35, 'prioritaire defaults to 1.35x');
  const base = D.notaPrice('refinancement');
  const expected = Math.round((base * (t.apercuMin + t.apercuMax) / 2) / 5) * 5;
  assert.equal(D.recommendedAmount('refinancement', '2026-08-14', TODAY), expected);
  // always within [Nota floor, PREMIUM_CAP× floor]
  for (const s of D.SERVICES) {
    const r = D.recommendedAmount(s.id, '2026-08-13', TODAY); // 1 day = urgence
    const floor = D.notaPrice(s.id);
    assert.ok(r >= floor && r <= floor * D.PREMIUM_CAP, `${s.id} recommended in bounds`);
  }
  // unknown service / bad date -> null
  assert.equal(D.recommendedAmount('bad', '2026-09-01', TODAY), null);
  assert.equal(D.recommendedAmount('refinancement', 'nope', TODAY), null);
});

test('obtainChance: high with lead time, low last-minute', () => {
  const far = D.obtainChance(D.addDays(TODAY, 60), TODAY);
  const near = D.obtainChance(D.addDays(TODAY, 1), TODAY);
  assert.ok(far >= 90 && far <= 100, 'a far date reads as high chance');
  assert.ok(near <= 55, 'a last-minute date reads as low chance');
  assert.ok(far > near, 'more lead time = higher chance');
  assert.equal(D.obtainChance('nope', TODAY), null);
});

test('DEFAULT_SERVICE_ID names a real service', () => {
  assert.equal(typeof D.DEFAULT_SERVICE_ID, 'string');
  const svc = D.serviceById(D.DEFAULT_SERVICE_ID);
  assert.ok(svc, 'the default must resolve to an actual service');
  assert.ok(D.SERVICES.some((s) => s.id === D.DEFAULT_SERVICE_ID));
  assert.equal(svc.id, 'refinancement', 'refinancement leads the booking flow');
});

test('postal prefix: normalizes, validates the format, and knows Quebec', () => {
  assert.equal(D.normalizePostalPrefix(' g1r 2k4 '), 'G1R', 'uppercases, strips, keeps 3');
  assert.equal(D.normalizePostalPrefix('g1r'), 'G1R');
  assert.equal(D.normalizePostalPrefix(null), '');
  assert.equal(D.normalizePostalPrefix('!!'), '');

  assert.ok(D.isPostalPrefix('G1R'), 'letter-digit-letter is the format');
  assert.ok(D.isPostalPrefix('h2x'), 'case-insensitive via normalization');
  assert.ok(!D.isPostalPrefix('G1'), 'too short');
  assert.ok(!D.isPostalPrefix('GG1'), 'wrong shape');
  assert.ok(!D.isPostalPrefix('123'), 'not digits');

  assert.ok(D.isQuebecPostalPrefix('G1R'), 'Quebec City');
  assert.ok(D.isQuebecPostalPrefix('H2X'), 'Montreal');
  assert.ok(!D.isQuebecPostalPrefix('M5V'), 'Toronto is not Quebec');
  assert.ok(!D.isQuebecPostalPrefix('G1'), 'must still be a valid prefix');
  D.QC_POSTAL_LETTERS.forEach((L) => assert.ok(D.isQuebecPostalPrefix(L + '1A')));
});

test('every fixture postal prefix is a valid Quebec prefix', () => {
  D.makeFixtures('2026-08-19')
    .filter((b) => b.prefixe)
    .forEach((b) => assert.ok(D.isQuebecPostalPrefix(b.prefixe), b.prefixe + ' should be a Quebec prefix'));
});

test('every service has a short name that fits a calendar cell', () => {
  D.SERVICES.forEach((s) => {
    assert.equal(typeof s.nomCourt, 'string', s.id + ' has no nomCourt');
    assert.ok(s.nomCourt.length > 0 && s.nomCourt.length <= 16, s.nomCourt + ' is too long for a cell');
    assert.ok(!s.nomCourt.includes(' '), s.nomCourt + ' should be a single word');
    assert.ok(s.nom.startsWith(s.nomCourt), s.nomCourt + ' must be a prefix of ' + s.nom);
  });
  assert.equal(new Set(D.SERVICES.map((s) => s.nomCourt)).size, D.SERVICES.length, 'short names must be distinct');
});

test('elevated tiers are exactly the ones that carry a real premium', () => {
  const eleves = D.TIERS.filter((t) => t.eleve);
  const calmes = D.TIERS.filter((t) => !t.eleve);
  assert.ok(eleves.length > 0 && calmes.length > 0, 'the split must be meaningful');
  D.TIERS.forEach((t) => assert.equal(typeof t.eleve, 'boolean', t.id + ' has no eleve flag'));

  // The flag must track the pricing ladder, not be set by hand out of step with
  // it: every elevated tier prices above every calm one.
  const worstCalm = Math.max(...calmes.map((t) => t.apercuMax));
  const bestEleve = Math.min(...eleves.map((t) => t.apercuMin));
  assert.ok(bestEleve >= worstCalm, 'an elevated tier must price above every calm tier');

  // And they must be the CLOSEST dates: every elevated tier has a tighter
  // deadline than every calm one (maxJours null = the open-ended far tier).
  const calmDays = calmes.map((t) => (t.maxJours == null ? Infinity : t.maxJours));
  eleves.forEach((t) => assert.ok(t.maxJours != null && t.maxJours < Math.min(...calmDays),
    t.id + ' should be nearer than every calm tier'));
});

test('tierMultiplier is the number recommendedAmount actually uses', () => {
  D.TIERS.forEach((t) => {
    assert.equal(D.tierMultiplier(t.id), (t.apercuMin + t.apercuMax) / 2);
  });
  assert.equal(D.tierMultiplier('prioritaire'), 1.35);
  assert.equal(D.tierMultiplier('urgence'), 1.6, 'tomorrow costs 1.6x');
  assert.equal(D.tierMultiplier('extreme'), 2.0, 'today costs 2x');
  assert.equal(D.tierMultiplier('nope'), null);

  // The number a cell shows must be the number the booking form pre-fills, or
  // the calendar is quoting a price the form then contradicts.
  const svc = 'refinancement';
  const base = D.notaPrice(svc);
  D.TIERS.forEach((t) => {
    const days = t.maxJours == null ? 40 : t.maxJours;
    const dateISO = D.addDays('2026-08-12', days);
    const expected = Math.round((base * D.tierMultiplier(D.tierForDays(days))) / 5) * 5;
    assert.equal(D.recommendedAmount(svc, dateISO, '2026-08-12'), expected, t.id);
  });
});
