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
  const s = buildNotaryFeed([{ id: 'n1', dateISO: '2026-08-20', serviceId: 'testament' }]);
  assert.equal(events(s), 1);
  assert.ok(!s.includes('DTSTAMP:'), 'no stamp arg -> no empty DTSTAMP line');
  assert.match(s, /SUMMARY:Signature notari/);
});
