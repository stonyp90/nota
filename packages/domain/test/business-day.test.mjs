import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// The marketplace's "today" is the civil day in Québec, not the UTC day of the
// machine. These tests pin the exact production bug: on Lambda (UTC), every
// evening after ~20:00 in Québec the UTC date has already rolled to tomorrow,
// so a UTC-derived clock rejected same-day bookings with 422 date_passee.

test('the business timezone is the Québec civil day (America/Toronto)', () => {
  assert.equal(D.BUSINESS_TIMEZONE, 'America/Toronto');
});

test('a Québec evening in summer (EDT, UTC-4) is still the same business day', () => {
  // 2026-08-26 21:30 in Québec == 2026-08-27T01:30Z — the reported bug window.
  assert.equal(D.businessDay('2026-08-27T01:30:00.000Z'), '2026-08-26');
});

test('a Québec evening in winter (EST, UTC-5) is still the same business day', () => {
  // 2026-12-30 22:00 in Québec == 2026-12-31T03:00Z.
  assert.equal(D.businessDay('2026-12-31T03:00:00.000Z'), '2026-12-30');
});

test('New Year in UTC is still New Year\'s Eve in Québec', () => {
  assert.equal(D.businessDay('2027-01-01T02:00:00.000Z'), '2026-12-31');
});

test('midday agrees with the UTC date (no off-by-one when the days align)', () => {
  assert.equal(D.businessDay('2026-08-26T15:00:00.000Z'), '2026-08-26');
});

test('accepts a Date instance and epoch milliseconds', () => {
  const at = new Date('2026-08-27T01:30:00.000Z');
  assert.equal(D.businessDay(at), '2026-08-26');
  assert.equal(D.businessDay(at.getTime()), '2026-08-26');
});

test('the timezone is a parameter, not baked in', () => {
  assert.equal(D.businessDay('2026-08-27T01:30:00.000Z', 'UTC'), '2026-08-27');
  assert.equal(D.businessDay('2026-08-27T01:30:00.000Z', 'America/Vancouver'), '2026-08-26');
});

test('with no arguments it returns the current Québec day as YYYY-MM-DD', () => {
  const today = D.businessDay();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(D.isISODate(today));
});
