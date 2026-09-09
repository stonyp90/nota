import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

test('seedSignature: a non-empty string, stable across calls', () => {
  const sig = D.seedSignature();
  assert.equal(typeof sig, 'string');
  assert.ok(sig.length > 0);
  assert.equal(D.seedSignature(), sig);
});

test('seedSignature: reflects every service id and its prixDepart', () => {
  const sig = D.seedSignature();
  for (const s of D.SERVICES) {
    assert.ok(sig.includes(s.id + ':' + s.prixDepart), `signature carries ${s.id}:${s.prixDepart}`);
  }
});

test('seedSignature: live service ids are part of the fixture fingerprint', () => {
  const sig = D.seedSignature();
  assert.ok(sig.includes('testament:1800'), 'testament is in the fingerprint');
  assert.ok(sig.includes('procuration:1500'), 'procuration is in the fingerprint');
  assert.ok(sig.includes('refinancement:2000'), 'the financing acts and their floors remain');
  assert.ok(sig.includes('financement:1800'), 'the new sibling act changes the fingerprint too');
});

test('seedSignature: reflects the tiers, the premium cap and the fixture seed', () => {
  const sig = D.seedSignature();
  for (const t of D.TIERS) {
    assert.ok(sig.includes(t.id + ':'), `signature carries tier ${t.id}`);
  }
  assert.ok(sig.includes(String(D.PREMIUM_CAP)), 'signature carries PREMIUM_CAP');
  assert.ok(sig.includes(D.FIXTURE_SEED.toString(16)), 'signature carries FIXTURE_SEED (hex)');
});
