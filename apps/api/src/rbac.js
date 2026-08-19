'use strict';

// ---------------------------------------------------------------------------
// Decoupled RBAC primitives — PURE (no I/O, no repo).
//
// User, Group and Permission are three independent concepts:
//   • a Permission is a `resource:action` capability key (the catalog below);
//   • a Group bundles permissions and can hold many users;
//   • a User's EFFECTIVE permissions = the union of their DIRECT grants and the
//     permissions of EVERY group they belong to (plus an optional legacy role
//     bundle, kept only for back-compat with the existing admin.role string).
//
// `can()` is fail-closed: no permission unless it is explicitly present (or the
// caller holds the wildcard `*`). This module is the single source of truth for
// authorization decisions; the repo/handler layers only store and pass the data.
// ---------------------------------------------------------------------------

// Grants every permission. Held by super_admin (and grantable to a group).
const WILDCARD = '*';

// The full catalog of permission keys the admin surface checks. Adding a guarded
// route means adding its key here so it can be granted à la carte to a group or
// a user — decoupled from any role.
const PERMISSIONS = Object.freeze([
  'analytics:read', // dashboards / metrics
  'pii:read', // reveal customer personal data
  'moderation:write', // moderate offers / notaries
  'settings:write', // global settings
  'users:read',
  'users:write', // create/edit admins, assign groups + grants
  'groups:read',
  'groups:write', // create/edit groups + their permissions
  'permissions:read', // read the permission catalog
  'services:write', // customize the notarial services offered
  'notifications:write', // customize notification templates / channels
  'billing:write', // Stripe / commission configuration
  'audit:read', // read the audit log
]);

// Legacy role → permission bundle. Kept ONLY so an admin created before groups
// existed still resolves to a sensible set. New granularity comes from groups +
// direct grants, not roles.
const ROLE_PERMISSIONS = Object.freeze({
  super_admin: [WILDCARD],
  analyst: ['analytics:read'],
});

function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ? ROLE_PERMISSIONS[role].slice() : [];
}

function isKnownPermission(key) {
  return PERMISSIONS.indexOf(key) !== -1;
}

// Union a user's role bundle + direct grants + every group's permissions into a
// de-duplicated effective set. `groups` is an array of group records that each
// expose a `permissions` array.
function resolvePermissions({ role, directPermissions = [], groups = [] } = {}) {
  const set = new Set();
  for (const p of permissionsForRole(role)) set.add(p);
  for (const p of directPermissions || []) if (p) set.add(p);
  for (const g of groups || []) {
    for (const p of (g && g.permissions) || []) if (p) set.add(p);
  }
  return Array.from(set);
}

// Fail-closed check. A wildcard in the effective set grants everything.
function can(effectivePermissions, permission) {
  if (!permission) return false;
  const list = Array.isArray(effectivePermissions) ? effectivePermissions : [];
  return list.indexOf(WILDCARD) !== -1 || list.indexOf(permission) !== -1;
}

module.exports = {
  WILDCARD,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  permissionsForRole,
  isKnownPermission,
  resolvePermissions,
  can,
};
