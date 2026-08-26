import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// A Wednesday, so the surrounding week has weekdays on both sides.
const TODAY = '2026-08-12';

function bid(over) {
  return {
    id: 'b' + Math.random().toString(36).slice(2),
    serviceId: 'refinancement',
    dateISO: D.addDays(TODAY, 1), // Thursday
    montant: 2400,
    status: D.STATUS.OUVERTE,
    ...over,
  };
}

test('weekAgenda: empty or junk input yields an empty board', () => {
  assert.deepEqual(D.weekAgenda([], TODAY), { items: [], total: 0, poolSize: 0 });
  assert.deepEqual(D.weekAgenda(null, TODAY), { items: [], total: 0, poolSize: 0 });
  const junk = D.weekAgenda([null, {}, { dateISO: 'nope' }, { serviceId: 'faux', dateISO: TODAY }], TODAY);
  assert.deepEqual(junk, { items: [], total: 0, poolSize: 0 });
});

test('weekAgenda: only open, upcoming, weekday demands qualify', () => {
  const saturday = D.addDays(TODAY, 3); // 2026-08-15
  const sunday = D.addDays(TODAY, 4);
  const past = D.addDays(TODAY, -2);
  const a = D.weekAgenda(
    [
      bid({ id: 'ok' }),
      bid({ id: 'taken', status: D.STATUS.RETENUE }),
      bid({ id: 'past', dateISO: past }),
      bid({ id: 'sat', dateISO: saturday }),
      bid({ id: 'sun', dateISO: sunday }),
    ],
    TODAY,
  );
  assert.deepEqual(a.items.map((i) => i.id), ['ok']);
  assert.equal(a.poolSize, 1);
});

test('weekAgenda: items carry the weekday column (0=Mon … 4=Fri) of their real date', () => {
  const monday = '2026-08-17';
  const friday = '2026-08-21';
  const a = D.weekAgenda([bid({ id: 'mon', dateISO: monday }), bid({ id: 'fri', dateISO: friday })], TODAY);
  const byId = Object.fromEntries(a.items.map((i) => [i.id, i]));
  assert.equal(byId.mon.day, 0);
  assert.equal(byId.fri.day, 4);
});

test('weekAgenda: soonest first, capped per day and overall, total sums the batch', () => {
  const bids = [];
  // Three demands on the same Thursday: only two may land in one column.
  for (let i = 0; i < 3; i++) bids.push(bid({ id: 'thu' + i, montant: 2500 + i }));
  // Enough weekday demands to overflow the overall cap of 8.
  for (let i = 0; i < 10; i++) bids.push(bid({ id: 'mon' + i, dateISO: '2026-08-17', montant: 2100 }));
  for (let i = 0; i < 10; i++) bids.push(bid({ id: 'tue' + i, dateISO: '2026-08-18', montant: 2100 }));
  for (let i = 0; i < 10; i++) bids.push(bid({ id: 'wed' + i, dateISO: '2026-08-19', montant: 2100 }));
  for (let i = 0; i < 10; i++) bids.push(bid({ id: 'fri' + i, dateISO: '2026-08-21', montant: 2100 }));
  const a = D.weekAgenda(bids, TODAY);
  assert.equal(a.items.length, 8);
  const perDay = a.items.reduce((m, i) => ((m[i.day] = (m[i.day] || 0) + 1), m), {});
  for (const n of Object.values(perDay)) assert.ok(n <= 2, 'no more than 2 per weekday column');
  // Soonest demands (the Thursday trio) are served before next week's.
  assert.ok(a.items.some((i) => i.id.startsWith('thu')));
  assert.equal(a.total, a.items.reduce((s, i) => s + i.montant, 0));
  assert.equal(a.poolSize, 43);
});

test('weekAgenda: offset rotates the batch through the pool and wraps around', () => {
  const bids = [];
  for (let i = 0; i < 12; i++) bids.push(bid({ id: 'm' + i, dateISO: D.addDays('2026-08-17', (i % 5) * 7 + (i % 5)) }));
  const first = D.weekAgenda(bids, TODAY, { offset: 0 });
  const second = D.weekAgenda(bids, TODAY, { offset: first.items.length });
  assert.notDeepEqual(first.items.map((i) => i.id), second.items.map((i) => i.id));
  const wrapped = D.weekAgenda(bids, TODAY, { offset: 1200 });
  assert.equal(wrapped.items.length > 0, true, 'a huge offset still yields a batch');
});

test('weekAgenda: retenues option includes taken demands, flagged with their étude', () => {
  const bids = [
    bid({ id: 'open1' }),
    bid({ id: 'taken1', status: D.STATUS.RETENUE, etude: 'Étude Laval', montant: 2900 }),
  ];
  const without = D.weekAgenda(bids, TODAY);
  assert.deepEqual(without.items.map((i) => i.id), ['open1']);
  const withTaken = D.weekAgenda(bids, TODAY, { retenues: true });
  assert.deepEqual(withTaken.items.map((i) => i.id).sort(), ['open1', 'taken1']);
  const byId = Object.fromEntries(withTaken.items.map((i) => [i.id, i]));
  assert.equal(byId.open1.retenue, false);
  assert.equal(byId.taken1.retenue, true);
  assert.equal(byId.taken1.etude, 'Étude Laval');
  assert.equal(withTaken.total, withTaken.items.reduce((s, i) => s + i.montant, 0));
});

test('weekAgenda: items expose what the vignette renders (service label, amount, date)', () => {
  const a = D.weekAgenda([bid({ id: 'x', montant: 2990 })], TODAY);
  assert.equal(a.items[0].serviceId, 'refinancement');
  assert.equal(a.items[0].nomCourt, D.serviceById('refinancement').nomCourt);
  assert.equal(a.items[0].montant, 2990);
  assert.equal(D.isISODate(a.items[0].dateISO), true);
});
