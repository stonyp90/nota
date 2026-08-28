import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCarnetFeed, buildNotaryFeed } = require('../src/ics.js');

const events = (s) => (s.match(/BEGIN:VEVENT/g) || []).length;

// --- EDGE CASES (logic) — iCalendar builder ----------------------------------

test('EDGE (logic): an empty carnet feed is a valid, event-free VCALENDAR', () => {
  const s = buildCarnetFeed([], '20260101T000000Z');
  assert.match(s, /BEGIN:VCALENDAR/);
  assert.match(s, /END:VCALENDAR/);
  assert.equal(events(s), 0);
  // CRLF line endings per RFC 5545.
  assert.ok(s.includes('\r\n'));
});

test('EDGE (logic): SUMMARY escapes comma/semicolon and every VEVENT carries DTSTAMP', () => {
  // An unknown serviceId falls back to itself, so we can force special chars.
  const s = buildCarnetFeed(
    [{ id: 'x1', dateISO: '2026-08-20', serviceId: 'Acte, spécial; test', montant: 100 }],
    'STAMP123Z'
  );
  assert.equal(events(s), 1);
  assert.ok(s.includes('SUMMARY:Acte\\, spécial\\; test'), 'comma/semicolon must be backslash-escaped');
  assert.ok(s.includes('DTSTAMP:STAMP123Z'), 'DTSTAMP must be present (Outlook drops events without it)');
  assert.ok(s.includes('DTSTART;VALUE=DATE:20260820'));
  assert.ok(s.includes('DTEND;VALUE=DATE:20260821'), 'all-day event ends the next day');
});

test('EDGE (logic): the notary feed omits DTSTAMP gracefully when no stamp is passed', () => {
  const s = buildNotaryFeed([{ id: 'n1', dateISO: '2026-08-20', serviceId: 'refinancement' }]);
  assert.equal(events(s), 1);
  assert.ok(!s.includes('DTSTAMP:'), 'no stamp arg -> no empty DTSTAMP line');
  assert.match(s, /SUMMARY:Signature notari/);
});

// --- bilingual feeds: French SUMMARY, English DESCRIPTION, FR / EN CALNAME ----

test('the notary feed keeps the French SUMMARY and adds the English DESCRIPTION', () => {
  const s = buildNotaryFeed([{ id: 'n1', dateISO: '2026-08-20', serviceId: 'refinancement' }], '20260101T000000Z');
  assert.match(s, /SUMMARY:Signature notariée — Refinancement hypothécaire/);
  assert.match(s, /DESCRIPTION:Notarized signing — Mortgage refinancing/);
  assert.ok(s.includes('X-WR-CALNAME:Nota — signatures retenues / retained signings'));
});

test('the carnet feed lines are bilingual with domain money on each side', () => {
  const s = buildCarnetFeed([{ id: 'c1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 1500 }], '20260101T000000Z');
  // fr-CA SUMMARY: no-break space thousands + trailing $ (comma-free, so no escaping needed).
  assert.ok(s.includes('SUMMARY:Refinancement hypothécaire — 1 500 $'));
  // en-CA DESCRIPTION: leading $, comma thousands — the comma must be escaped per RFC 5545.
  assert.ok(s.includes('DESCRIPTION:Mortgage refinancing — $1\\,500'));
  assert.ok(s.includes('X-WR-CALNAME:Nota — carnet public / public carnet (Québec)'));
});

// --- decision-complete notary events (montant, déplacement, prêteur, dossier) --

// Unfold per RFC 5545 §3.1 (CRLF + single space/tab), for round-trip checks.
const unfold = (s) => s.replace(/\r\n[ \t]/g, '');

const FULL_EVENT = {
  id: 'n9',
  dateISO: '2026-08-20',
  serviceId: 'refinancement',
  montant: 3285,
  preteur: { nom: 'Banque Nationale', virtuel: false },
  deplacement: { qui: 'notaire', km: 25, urgence: false },
  ready: true,
  clientNom: 'Marie Tremblay',
  prefixe: 'G2B',
};

test('a notary VEVENT carries every decision detail, bilingually', () => {
  const s = unfold(buildNotaryFeed([FULL_EVENT], '20260101T000000Z'));
  // The amount sits in the SUMMARY (fr) and in the English title line.
  assert.match(s, /SUMMARY:Signature notariée — Refinancement hypothécaire — 3\u{a0}285\u{a0}\$/u);
  assert.ok(s.includes('DESCRIPTION:Notarized signing — Mortgage refinancing — $3\\,285'));
  // One fact per line, FR — EN, in the notary-card register.
  assert.ok(s.includes('Déplacement : Chez le client · ≤ 25 km — Travel: At the client’s · ≤ 25 km'));
  assert.ok(s.includes('Prêteur : Banque Nationale — Lender: Banque Nationale'));
  assert.ok(s.includes('Dossier prêt — File ready'));
  assert.ok(s.includes('Client : Marie Tremblay'));
  assert.ok(s.includes('Réf. : G2B'));
  // The déplacement band doubles as the calendar LOCATION (fr register).
  assert.ok(s.includes('LOCATION:Chez le client · ≤ 25 km'));
});

test('an urgence band reads « 100 % en ligne » and a virtual lender is flagged', () => {
  const s = unfold(buildNotaryFeed([
    {
      ...FULL_EVENT,
      preteur: { nom: 'Tangerine', virtuel: true },
      deplacement: { qui: 'en_ligne', km: 0, urgence: true },
      ready: false,
    },
  ], '20260101T000000Z'));
  assert.ok(s.includes('LOCATION:Urgence · 100 % en ligne'));
  assert.ok(s.includes('Déplacement : Urgence · 100 % en ligne — Travel: Urgency · 100 % online'));
  assert.ok(s.includes('Prêteur : Tangerine (virtuel) — Lender: Tangerine (virtual)'));
  assert.ok(s.includes('Dossier en préparation — File in preparation'));
});

test('a sub-25 km band reads « moins de N km » on both sides', () => {
  const s = unfold(buildNotaryFeed([
    { ...FULL_EVENT, deplacement: { qui: 'client', km: 10, urgence: false } },
  ], '20260101T000000Z'));
  assert.ok(s.includes('LOCATION:À l’étude · moins de 10 km'));
  assert.ok(s.includes('Travel: At the office · under 10 km'));
});

test('a bare pointer (legacy retained event) still builds a valid VEVENT', () => {
  // Pointers written before the detail hydration carry only id/date/service.
  const s = unfold(buildNotaryFeed([{ id: 'n1', dateISO: '2026-08-20', serviceId: 'refinancement' }], '20260101T000000Z'));
  assert.equal(events(s), 1);
  assert.ok(s.includes('SUMMARY:Signature notariée — Refinancement hypothécaire'));
  assert.ok(!s.includes('LOCATION:'), 'no déplacement -> no LOCATION line');
  assert.ok(!s.includes('Prêteur'), 'no lender -> no lender line');
});

// --- RFC 5545 §3.1 line folding: every calendar client must parse the feed ----

test('EDGE (logic): every physical line stays ≤ 75 octets and unfolds losslessly', () => {
  const long = {
    ...FULL_EVENT,
    clientNom: 'Marie-Ève de la Chevrotière-Beauséjour de Sainte-Anne-de-Bellevue',
    preteur: { nom: 'Fiducie du Vieux-Port de Montréal et de la Rive-Sud', virtuel: false },
  };
  const folded = buildNotaryFeed([long, FULL_EVENT], '20260101T000000Z');
  for (const line of folded.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line over 75 octets: ${line}`);
  }
  // Folding must never split a UTF-8 sequence: unfolding restores intact text.
  const back = unfold(folded);
  assert.ok(back.includes('Chevrotière-Beauséjour de Sainte-Anne-de-Bellevue'));
  assert.ok(back.includes('Fiducie du Vieux-Port de Montréal et de la Rive-Sud'));
  assert.ok(!back.includes('�'), 'no replacement character after unfold');
});

test('EDGE (logic): the carnet feed folds too', () => {
  const s = buildCarnetFeed(
    [{ id: 'c1', dateISO: '2026-08-20', serviceId: 'Acte à rallonge — un service au nom démesurément long pour plier la ligne', montant: 1500 }],
    '20260101T000000Z'
  );
  for (const line of s.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line over 75 octets: ${line}`);
  }
});
