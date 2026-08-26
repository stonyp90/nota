import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const TODAY = '2026-08-12';

// A stored bid always carries PRIVATE fields: the courriel used for
// notifications, the telephone for the mise en relation (ADR 0010 §4) and the
// partner referral code (ADR 0011). The public projection must never surface
// any of them — not as a value, not even as a key. These are unit-level guards
// on publicBid() itself, complementing the POST→GET integration check in
// api.test.mjs.

const storedBid = (over = {}) => ({
  id: 'b1',
  serviceId: 'refinancement',
  dateISO: '2026-08-20',
  montant: 2400,
  tier: 'rapide',
  premium: 2400 / 2000,
  status: 'ouverte',
  anonyme: true,
  prefixe: 'G1R',
  courriel: 'secret@example.ca', // PRIVATE
  telephone: '418 555-1234', // PRIVATE (ADR 0010 §4)
  parrain: 'EVEROY', // PRIVATE (ADR 0011)
  createdAt: TODAY,
  ...over,
});

test('publicBid() output has no courriel, telephone or parrain key at all', () => {
  const { publicBid } = createApp(createMemoryRepo(), { now: () => TODAY });
  const projected = publicBid(storedBid());
  for (const key of ['courriel', 'telephone', 'parrain']) {
    assert.equal(Object.prototype.hasOwnProperty.call(projected, key), false, key + ' key present');
    assert.equal(projected[key], undefined);
    assert.equal(Object.keys(projected).includes(key), false);
  }
});

test('GET /bids never exposes courriel for any listed bid', async () => {
  // Seed straight into the repo so we know every stored item carries a courriel.
  const repo = createMemoryRepo([
    storedBid({ id: 'a', courriel: 'a@example.ca' }),
    storedBid({ id: 'b', serviceId: 'refinancement', montant: 2100, tier: 'standard', anonyme: false, nom: 'Luc', courriel: 'b@example.ca' }),
  ]);
  const app = createApp(repo, { now: () => TODAY });
  const res = await app.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } });
  assert.equal(res.statusCode, 200);
  const { bids } = JSON.parse(res.body);
  assert.equal(bids.length, 2);
  for (const b of bids) {
    assert.equal(Object.prototype.hasOwnProperty.call(b, 'courriel'), false, 'courriel leaked in GET /bids');
    assert.equal(Object.prototype.hasOwnProperty.call(b, 'telephone'), false, 'telephone leaked in GET /bids');
    assert.equal(Object.prototype.hasOwnProperty.call(b, 'parrain'), false, 'parrain leaked in GET /bids');
  }
  // Serializing the whole response must not contain the private values.
  assert.equal(res.body.includes('a@example.ca'), false);
  assert.equal(res.body.includes('b@example.ca'), false);
  assert.equal(res.body.includes('555-1234'), false);
  assert.equal(res.body.includes('EVEROY'), false);
});
