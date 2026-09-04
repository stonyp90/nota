import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rbac = require('../src/rbac.js');

// --- Roles remain a convenient bundle, but granularity comes from groups -------

test('super_admin resolves to the wildcard and can do anything', () => {
  const eff = rbac.resolvePermissions({ role: 'super_admin' });
  assert.ok(eff.includes(rbac.WILDCARD));
  assert.equal(rbac.can(eff, 'users:write'), true);
  assert.equal(rbac.can(eff, 'a:brand:new:permission'), true); // wildcard covers unknown keys too
});

test('analyst role resolves to read-only analytics', () => {
  const eff = rbac.resolvePermissions({ role: 'analyst' });
  assert.deepEqual(eff, ['analytics:read']);
  assert.equal(rbac.can(eff, 'analytics:read'), true);
  assert.equal(rbac.can(eff, 'users:write'), false);
});

// --- The core decoupling: user + group + permission are independent ------------

test('effective permissions = union of direct grants and every group, de-duplicated', () => {
  const eff = rbac.resolvePermissions({
    directPermissions: ['analytics:read'],
    groups: [
      { id: 'support', permissions: ['users:read', 'audit:read'] },
      { id: 'ops', permissions: ['users:read', 'services:write'] }, // users:read duplicated
    ],
  });
  assert.deepEqual(
    eff.slice().sort(),
    ['analytics:read', 'audit:read', 'services:write', 'users:read'].sort()
  );
});

test('a user with no role, no grants and no groups has nothing', () => {
  const eff = rbac.resolvePermissions({});
  assert.deepEqual(eff, []);
  assert.equal(rbac.can(eff, 'analytics:read'), false);
});

// --- can() is fail-closed ------------------------------------------------------

test('can() only allows an explicitly present permission (or wildcard)', () => {
  assert.equal(rbac.can(['users:read'], 'users:read'), true);
  assert.equal(rbac.can(['users:read'], 'users:write'), false);
  assert.equal(rbac.can([], 'users:read'), false);
  assert.equal(rbac.can(null, 'users:read'), false);
  assert.equal(rbac.can(['users:read'], ''), false);
  assert.equal(rbac.can([rbac.WILDCARD], 'moderation:write'), true);
});

// --- Catalog covers the admin surface -----------------------------------------

test('the permission catalog covers the manageable admin surface', () => {
  for (const k of [
    'users:read', 'users:write', 'groups:read', 'groups:write', 'permissions:read',
    'moderation:write', 'notifications:write', 'billing:write', 'audit:read', 'campaigns:send',
  ]) {
    assert.ok(rbac.isKnownPermission(k), k + ' is in the catalog');
  }
  assert.equal(rbac.isKnownPermission('not:a:permission'), false);
  // 2026-09-03 — a key no route ever checked is a promise, not a permission:
  // `services:write` left the catalogue. Stored groups that still carry it
  // keep loading (resolvePermissions never filters), it is just not offered.
  assert.equal(rbac.isKnownPermission('services:write'), false);
});
