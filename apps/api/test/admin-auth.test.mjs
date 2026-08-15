import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const adminAuth = require('../src/admin-auth.js');
const notaryAuth = require('../src/notary-auth.js');
const { signAdminToken, verifyAdminToken, adminIdForEmail, SCOPES, ROLES, isRole } = adminAuth;

const SEC = 'test-admin-secret';

test('a signed session token round-trips its claims', () => {
  const exp = 1_000_000;
  const token = signAdminToken({ sub: 'A123', sid: 'sess-1', role: ROLES.SUPER_ADMIN, scope: SCOPES.SESSION, exp }, SEC);
  const claims = verifyAdminToken(token, exp - 1, SEC);
  assert.equal(claims.sub, 'A123');
  assert.equal(claims.sid, 'sess-1');
  assert.equal(claims.role, ROLES.SUPER_ADMIN);
  assert.equal(claims.scope, SCOPES.SESSION);
});

test('an expired token is rejected', () => {
  const exp = 1000;
  const token = signAdminToken({ sub: 'A1', sid: 's', role: ROLES.ANALYST, scope: SCOPES.SESSION, exp }, SEC);
  assert.equal(verifyAdminToken(token, exp, SEC), null); // now >= exp
  assert.ok(verifyAdminToken(token, exp - 1, SEC));
});

test('a tampered payload fails the HMAC check', () => {
  const token = signAdminToken({ sub: 'A1', cid: 'c', scope: SCOPES.CHALLENGE, exp: 9e12 }, SEC);
  const [payload, sig] = token.split('.');
  const forged = payload.slice(0, -2) + 'AA' + '.' + sig;
  assert.equal(verifyAdminToken(forged, 0, SEC), null);
});

test('an unknown scope is rejected', () => {
  const token = signAdminToken({ sub: 'A1', scope: 'root', exp: 9e12 }, SEC);
  assert.equal(verifyAdminToken(token, 0, SEC), null);
});

test('admin tokens do not verify under the notary secret (cross-surface isolation)', () => {
  const exp = 9e12;
  const token = signAdminToken({ sub: 'A1', sid: 's', role: ROLES.SUPER_ADMIN, scope: SCOPES.SESSION, exp }, SEC);
  // The notary verifier uses a different secret + payload shape; even with the
  // same bytes, a mismatched secret must fail.
  assert.equal(notaryAuth.verifyToken(token, exp - 1, SEC + '-different'), null);
});

test('adminIdForEmail is deterministic, case/space-insensitive, and prefixed', () => {
  const a = adminIdForEmail('  Ops@Nota.CA ');
  const b = adminIdForEmail('ops@nota.ca');
  assert.equal(a, b);
  assert.match(a, /^A[0-9a-f]{24}$/);
});

test('isRole guards the two known roles', () => {
  assert.ok(isRole(ROLES.SUPER_ADMIN));
  assert.ok(isRole(ROLES.ANALYST));
  assert.equal(isRole('wheel'), false);
});
