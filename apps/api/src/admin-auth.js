'use strict';

/**
 * Admin token signing — a stateless signed envelope, no external dependencies,
 * DELIBERATELY separate from notary-auth.js.
 *
 * Two things make admin auth stronger than the notary console (whose sign-in is
 * a known weakness — it mints a token from a bare request-body email):
 *   1. A different signing secret, NOTA_ADMIN_SECRET, so an admin token can
 *      never be forged from the notary secret and vice-versa. Fails CLOSED in
 *      production (a missing secret throws rather than signing with a constant).
 *   2. The token is only HALF of the credential. A valid signature is necessary
 *      but NOT sufficient — the admin use-case additionally requires a live,
 *      un-revoked server-side session record (SESSION token) or an unconsumed
 *      single-use challenge (CHALLENGE token). Signature + server state = access.
 *
 * A token is `base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payload))`.
 * The payload is a compact claims object; `scope` narrows what it authorizes:
 *   - 'challenge' — a single-use magic-link token (carries `cid`), good only to
 *                   exchange for a session. Short-lived.
 *   - 'session'   — an issued admin session (carries `sid` + `role`), presented
 *                   in the Authorization header on every admin call.
 *
 * Kept out of @nota/domain on purpose (crypto + process.env are adapter concerns).
 */
const crypto = require('node:crypto');

// Token scopes.
const SCOPES = { CHALLENGE: 'challenge', SESSION: 'session' };

// Admin roles. super_admin can change settings/moderate (phase 3); analyst is
// read-only. Both may read analytics. The role is stamped into the session
// record server-side and re-read on every request — never trusted from a client.
const ROLES = { SUPER_ADMIN: 'super_admin', ANALYST: 'analyst' };
function isRole(r) {
  return r === ROLES.SUPER_ADMIN || r === ROLES.ANALYST;
}

// Never a production secret — only so tests / local dev run with no config.
// Production MUST set NOTA_ADMIN_SECRET (see infra/admin.tf); when unset there,
// secret() throws rather than signing with this.
const DEV_FALLBACK_SECRET = 'nota-dev-admin-secret-do-not-use-in-prod';

// Fail closed: a real deployment must supply NOTA_ADMIN_SECRET. Only dev/test
// (NODE_ENV !== 'production') may borrow the fixed fallback.
function secret() {
  const configured = process.env.NOTA_ADMIN_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NOTA_ADMIN_SECRET is required in production (refusing to sign admin tokens with the dev fallback).'
    );
  }
  return DEV_FALLBACK_SECRET;
}

// Deterministic admin id derived from the email, so the SAME admin email always
// maps to the SAME identity id (the ADMIN# partition key) across sessions.
function adminIdForEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  return 'A' + crypto.createHash('sha256').update(clean).digest('hex').slice(0, 24);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

// Sign an arbitrary claims object. The caller supplies `exp` (epoch ms) and the
// scope-specific fields (cid | sid+role). We stringify with sorted-ish stable
// key order via JSON (object insertion order) — verification re-reads the same
// bytes, so exact ordering does not matter, only that we sign what we parse.
function signAdminToken(claims, sec = secret()) {
  const payload = b64url(JSON.stringify(claims || {}));
  const sig = crypto.createHmac('sha256', sec).update(payload).digest('base64url');
  return payload + '.' + sig;
}

// Returns the claims object for a valid, unexpired token, else null. `nowMs` is
// injected for determinism. Verifies the HMAC with a timing-safe compare before
// trusting any claim.
function verifyAdminToken(token, nowMs, sec = secret()) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = crypto.createHmac('sha256', sec).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims.sub !== 'string') return null;
  if (claims.scope !== SCOPES.CHALLENGE && claims.scope !== SCOPES.SESSION) return null;
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
  if (Number(nowMs) >= claims.exp) return null; // expired
  return claims;
}

module.exports = {
  SCOPES,
  ROLES,
  isRole,
  adminIdForEmail,
  signAdminToken,
  verifyAdminToken,
  DEV_FALLBACK_SECRET,
};
