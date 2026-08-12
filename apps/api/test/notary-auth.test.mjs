import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { signToken, verifyToken, notaryIdForEmail, SCOPES } = require('../src/notary-auth.js');

const SECRET = 'test-secret';
const NOW = 1_700_000_000_000; // fixed epoch ms

test('a freshly signed token verifies back to its notaryId and scope', () => {
  const token = signToken('N-abc', NOW + 1000, SCOPES.SESSION, SECRET);
  assert.deepEqual(verifyToken(token, NOW, SECRET), { sub: 'N-abc', scope: 'session' });
});

test('scope is carried through and round-trips (session vs feed)', () => {
  const feed = signToken('N-abc', NOW + 1000, SCOPES.FEED, SECRET);
  assert.deepEqual(verifyToken(feed, NOW, SECRET), { sub: 'N-abc', scope: 'feed' });
  const session = signToken('N-abc', NOW + 1000, SCOPES.SESSION, SECRET);
  assert.equal(verifyToken(session, NOW, SECRET).scope, 'session');
});

test('a token minted with no scope claim is treated as a full session token', () => {
  // Simulate a legacy token: payload with sub+exp but no scope.
  const raw = Buffer.from(JSON.stringify({ sub: 'N-legacy', exp: NOW + 1000 })).toString('base64url');
  const crypto = require('node:crypto');
  const sig = crypto.createHmac('sha256', SECRET).update(raw).digest('base64url');
  assert.deepEqual(verifyToken(raw + '.' + sig, NOW, SECRET), { sub: 'N-legacy', scope: 'session' });
});

test('an expired token is rejected', () => {
  const token = signToken('N-abc', NOW, SCOPES.SESSION, SECRET); // exp == now -> expired
  assert.equal(verifyToken(token, NOW, SECRET), null);
  assert.equal(verifyToken(token, NOW + 1, SECRET), null);
});

test('a tampered payload is rejected (signature no longer matches)', () => {
  const token = signToken('N-abc', NOW + 10_000, SCOPES.SESSION, SECRET);
  const forged = signToken('N-evil', NOW + 10_000, SCOPES.SESSION, SECRET);
  const [, goodSig] = token.split('.');
  const [forgedPayload] = forged.split('.');
  // Swap in an attacker-chosen payload but keep the original signature.
  const tampered = forgedPayload + '.' + goodSig;
  assert.equal(verifyToken(tampered, NOW, SECRET), null);
});

test('a token signed with a different secret is rejected', () => {
  const token = signToken('N-abc', NOW + 10_000, SCOPES.SESSION, 'other-secret');
  assert.equal(verifyToken(token, NOW, SECRET), null);
});

test('garbage inputs return null, never throw', () => {
  assert.equal(verifyToken('', NOW, SECRET), null);
  assert.equal(verifyToken('no-dot', NOW, SECRET), null);
  assert.equal(verifyToken('a.b.c', NOW, SECRET), null);
  assert.equal(verifyToken(null, NOW, SECRET), null);
});

test('notaryIdForEmail is stable and case/space-insensitive', () => {
  assert.equal(notaryIdForEmail('Me@Example.CA'), notaryIdForEmail('  me@example.ca '));
  assert.notEqual(notaryIdForEmail('a@x.ca'), notaryIdForEmail('b@x.ca'));
});

// --- Fix 1: the signing secret fails CLOSED in production --------------------

function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('secret() throws in production when NOTA_NOTARY_SECRET is empty (no forge-able fallback)', () => {
  withEnv({ NODE_ENV: 'production', NOTA_NOTARY_SECRET: undefined }, () => {
    assert.throws(() => signToken('N-abc', NOW + 1000, SCOPES.SESSION), /NOTA_NOTARY_SECRET/);
  });
});

test('secret() uses the configured value in production when it is set', () => {
  withEnv({ NODE_ENV: 'production', NOTA_NOTARY_SECRET: 'prod-secret' }, () => {
    const token = signToken('N-abc', NOW + 1000, SCOPES.SESSION); // must not throw
    assert.equal(verifyToken(token, NOW).sub, 'N-abc'); // default secret() both sides
  });
});

test('secret() falls back to the dev constant outside production so dev/test still run', () => {
  withEnv({ NODE_ENV: 'test', NOTA_NOTARY_SECRET: undefined }, () => {
    const token = signToken('N-abc', NOW + 1000, SCOPES.SESSION); // must not throw
    assert.equal(verifyToken(token, NOW).sub, 'N-abc');
  });
});
