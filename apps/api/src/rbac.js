'use strict';

// ---------------------------------------------------------------------------
// Decoupled RBAC primitives — PURE (no I/O, no repo).
//
// User, User Group, Permission Group and Permission are four independent concepts:
//   • a Permission is a `resource:action` capability key (the catalog below);
//   • a Permission Group bundles permissions and can be reused;
//   • a User Group can attach many Permission Groups and hold many users;
//   • a User's EFFECTIVE permissions = the union of their DIRECT grants, every
//     attached Permission Group and the permissions of EVERY user group they
//     belong to (plus an optional legacy role
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
  'leads:read', // CRM pipeline and conversion facts
  'leads:write', // CRM stages, notes and follow-up dates
  'pii:read', // reveal customer personal data
  'support:read', // read the shared customer-support inbox
  'support:write', // reply in existing customer-support conversations
  'moderation:write', // moderate offers / notaries
  'settings:write', // global settings
  'users:read',
  'users:write', // create/edit admins, assign groups + grants
  'cabinets:read', // view firms, plans and memberships
  'cabinets:write', // create/edit firms, plans and notary memberships
  'groups:read',
  'groups:write', // create/edit groups + their permissions
  'permissions:read', // read the permission catalog
  // `services:write` (customize the catalogue of acts) was published here
  // without any route ever checking it — a key no gate applies is a promise,
  // not a permission, so it left the catalogue on 2026-09-03. A group stored
  // with it still loads (resolvePermissions never filters); it is simply no
  // longer offered. Bring it back the day a route enforces it.
  'notifications:write', // customize notification templates / channels
  'billing:write', // Stripe / commission configuration
  'audit:read', // read the audit log
  // Envoyer une campagne ciblée (un utilisateur, un groupe, un segment). C'est
  // une capacité à part, jamais un corollaire de `notifications:write` : écrire
  // un gabarit et l'envoyer à mille personnes ne sont pas la même décision.
  'campaigns:send',
  // Les GROUPES D'AUDIENCE — des listes de DESTINATAIRES, à ne jamais confondre
  // avec les groupes RBAC ci-dessus, qui réunissent des permissions. Deux clés
  // et non une : voir la liste des gens à qui Nota écrit et la MODIFIER ne sont
  // pas la même décision. `audiences:read` donne accès aux adresses du groupe —
  // c'est une lecture nominative, à accorder comme telle.
  'audiences:read',
  'audiences:write',
  // LE DOSSIER D'UNE PERSONNE (Loi 25, art. 27 et 28). Deux clés et non une :
  // OUVRIR le dossier d'un client — ses offres, ses paiements, ses avis, ses
  // consentements — et l'EFFACER ne sont pas la même décision. La seconde
  // détruit ; elle ne doit jamais s'obtenir comme corollaire de la première,
  // exactement comme `campaigns:send` n'est pas un corollaire de
  // `notifications:write`.
  //
  // Ni l'une ni l'autre n'implique `pii:read` : un opérateur peut instruire une
  // demande d'accès en voyant des adresses MASQUÉES (la réponse le fait), et
  // lever l'anonymat reste une capacité distincte, comme partout ici.
  'subjects:read',
  'subjects:erase',
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

// Union a user's role bundle + direct grants + every group's permission bundles
// into a de-duplicated effective set. The legacy `group.permissions` field is
// still read so existing records remain valid while administrators migrate them
// to reusable permission groups.
function resolvePermissions({ role, directPermissions = [], groups = [], permissionGroups = [] } = {}) {
  const set = new Set();
  for (const p of permissionsForRole(role)) set.add(p);
  for (const p of directPermissions || []) if (p) set.add(p);
  for (const g of groups || []) {
    for (const p of (g && g.permissions) || []) if (p) set.add(p);
    for (const id of (g && (g.groupesPermissions || g.permissionGroups)) || []) {
      const pg = (permissionGroups || []).find((candidate) => candidate && candidate.id === id);
      for (const p of (pg && pg.permissions) || []) if (p) set.add(p);
    }
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
