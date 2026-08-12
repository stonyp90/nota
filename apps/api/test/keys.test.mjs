import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const keys = require('../src/keys.js');
const {
  monthOf,
  bidPK,
  bidSK,
  monthPK,
  notaryPK,
  NOTARY_SK,
  eventPK,
  EVENT_SK,
  sentPK,
  SENT_SK,
  unsubPK,
  UNSUB_SK,
} = keys;

test('monthOf slices the year-month from a date or datetime string', () => {
  assert.equal(monthOf('2026-08-17'), '2026-08');
  assert.equal(monthOf('2026-08-17T13:45:00.000Z'), '2026-08');
});

test('bidPK partitions by month', () => {
  assert.equal(bidPK('2026-08-17'), 'MONTH#2026-08');
});

test('monthPK builds the same partition key the query uses', () => {
  assert.equal(monthPK('2026-08'), 'MONTH#2026-08');
});

test('a bid write PK matches the monthly query PK', () => {
  // repo-dynamo writes items under bidPK(bid.dateISO) and reads a month under
  // monthPK(month); they must resolve to the identical partition.
  assert.equal(bidPK('2026-08-17'), monthPK(monthOf('2026-08-17')));
});

test('bidSK is stable and begins with the BID# prefix the query filters on', () => {
  const bid = { id: 'abc', dateISO: '2026-08-17' };
  assert.equal(bidSK(bid), 'BID#2026-08-17#abc');
  assert.ok(bidSK(bid).startsWith('BID#')); // matches begins_with(SK, 'BID#')
});

test('bidSK/read-key symmetry: a written bidSK equals the key repo.get rebuilds', () => {
  // repo-dynamo.get() reads with SK = `BID#${dateISO}#${id}`; a bid persisted
  // under bidSK(bid) must be found by that exact key.
  const bid = { id: 'abc', dateISO: '2026-08-17' };
  const readSK = `BID#${bid.dateISO}#${bid.id}`;
  assert.equal(bidSK(bid), readSK);
});

test('notary key builders', () => {
  assert.equal(notaryPK('n1'), 'NOTARY#n1');
  assert.equal(NOTARY_SK, 'PROFILE');
});

test('event (webhook idempotency) key builders', () => {
  assert.equal(eventPK('evt_123'), 'EVENT#evt_123');
  assert.equal(EVENT_SK, 'EVENT');
});

test('sent-notification ledger key builders', () => {
  assert.equal(sentPK('bid-1', 'offerPublished'), 'SENT#bid-1#offerPublished');
  assert.equal(SENT_SK, 'SENT');
});

test('unsubscribe key normalizes the email (trim + lowercase)', () => {
  assert.equal(unsubPK('  Client@Example.CA '), 'UNSUB#client@example.ca');
  assert.equal(UNSUB_SK, 'UNSUB');
});
