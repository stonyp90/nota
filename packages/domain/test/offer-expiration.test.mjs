import { test } from 'node:test';
import assert from 'node:assert/strict';
import D from '../index.js';

test('expiry is capped at seven civil days and at the signing date', () => {
  assert.equal(D.OFFER_VALIDITY_DAYS, 7);
  assert.equal(D.offerExpirationDate('2026-12-29', '2027-02-01'), '2027-01-05');
  assert.equal(D.offerExpirationDate('2026-09-09', '2026-09-10'), '2026-09-10');
  assert.equal(D.offerExpirationDate('2026-09-09', '2026-09-09'), '2026-09-09');
  assert.equal(D.offerExpirationDate('bad', '2026-09-09'), null);
  assert.equal(D.offerExpirationDate('2026-09-09', '2026-09-08'), null);
});

test('deadline is inclusive; legacy and invalid open offers fail closed', () => {
  const bid = { status: 'ouverte', dateISO: '2026-09-30', expiresOn: '2026-09-16' };
  assert.equal(D.isOfferExpired(bid, '2026-09-16'), false);
  assert.equal(D.isOfferExpired(bid, '2026-09-17'), true);
  for (const expiresOn of [undefined, null, '', 'bad', '2026-02-30']) {
    assert.equal(D.isOfferExpired({ ...bid, expiresOn }, '2026-09-09'), true);
  }
  assert.equal(D.isOfferExpired({ ...bid, dateISO: '2026-09-08' }, '2026-09-09'), true);
  assert.equal(D.isOfferExpired({ ...bid, status: 'retenue' }, '2027-01-01'), false);
});
