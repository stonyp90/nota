import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const TODAY = '2026-08-12';

// A stored bid always carries the PRIVATE courriel used only for notifications.
// The public projection must never surface it — not as a value, not even as a
// key. These are unit-level guards on publicBid() itself, complementing the
// POST→GET integration check in api.test.mjs.

const storedBid = (over = {}) => ({
  id: 'b1',
  serviceId: 'testament',
  dateISO: '2026-08-20',
  montant: 700,
  tier: 'rapide',
  premium: 700 / 650,
  status: 'ouverte',
  anonyme: true,
  prefixe: 'G1R',
  courriel: 'secret@example.ca', // PRIVATE
  createdAt: TODAY,
  ...over,
});

test('publicBid() output has no courriel key at all', () => {
  const { publicBid } = createApp(createMemoryRepo(), { now: () => TODAY });
  const projected = publicBid(storedBid());
  assert.equal(Object.prototype.hasOwnProperty.call(projected, 'courriel'), false, 'courriel key present');
  assert.equal(projected.courriel, undefined);
  assert.equal(Object.keys(projected).includes('courriel'), false);
});

test('GET /bids never exposes courriel for any listed bid', async () => {
  // Seed straight into the repo so we know every stored item carries a courriel.
  const repo = createMemoryRepo([
    storedBid({ id: 'a', courriel: 'a@example.ca' }),
    storedBid({ id: 'b', serviceId: 'procuration', montant: 300, tier: 'standard', anonyme: false, nom: 'Luc', courriel: 'b@example.ca' }),
  ]);
  const app = createApp(repo, { now: () => TODAY });
  const res = await app.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } });
  assert.equal(res.statusCode, 200);
  const { bids } = JSON.parse(res.body);
  assert.equal(bids.length, 2);
  for (const b of bids) {
    assert.equal(Object.prototype.hasOwnProperty.call(b, 'courriel'), false, 'courriel leaked in GET /bids');
  }
  // Serializing the whole response must not contain the private local-parts.
  assert.equal(res.body.includes('a@example.ca'), false);
  assert.equal(res.body.includes('b@example.ca'), false);
});
