'use strict';

/**
 * Notary authentication — a stateless signed token, no external dependencies.
 *
 * A token is `base64url(payload) + '.' + base64url(HMAC-SHA256(payload))`, where
 * payload is a compact JSON `{ sub: <notaryId>, exp: <epoch ms>, scope }`. The
 * `scope` narrows what the token authorizes:
 *   - 'session' — the full console (list, accept, decline, read dossier).
 *   - 'feed'    — a READ-ONLY calendar token, safe to embed in a webcal URL; it
 *                 grants nothing but the .ics feed and can never accept a bid or
 *                 read a dossier.
 *   - 'client'  — a per-bid client token (sub = bid id) issued by POST /bids;
 *                 grants only the /client/* routes for that bid.
 * Verification recomputes the HMAC with a timing-safe compare and rejects a
 * tampered or expired token, returning `{ sub, scope }` on success.
 *
 * The signing secret comes from NOTA_NOTARY_SECRET and fails CLOSED: in
 * production a missing/empty secret throws (signing with a public constant would
 * let anyone forge console tokens). Outside production (local dev, tests) a fixed
 * non-secret fallback keeps everything runnable with zero configuration.
 *
 * Kept out of @nota/domain on purpose: the domain package is pure and free of
 * node:crypto and process.env. This is an API-layer adapter concern.
 */
const crypto = require('node:crypto');

// Token scopes. SESSION authorizes the full console; FEED is read-only calendar
// access, safe to place in a URL because it authorizes nothing else. CLIENT is
// the per-bid token a client (who has no account) receives when posting an
// offer: its `sub` is the BID id, and it only authorizes the /client/* routes
// for that one bid (see and answer propositions, update the dossier).
const SCOPES = { SESSION: 'session', FEED: 'feed', CLIENT: 'client' };

// Never a production secret — only so tests and `npm run api:local` work with no
// configuration. Production MUST set NOTA_NOTARY_SECRET (see infra/lambda.tf);
// when it is unset there, secret() throws rather than signing with this.
const DEV_FALLBACK_SECRET = 'nota-dev-notary-secret-do-not-use-in-prod';

// Fail closed. A real deployment must supply NOTA_NOTARY_SECRET. Only dev/test
// (NODE_ENV !== 'production') may borrow the fixed dev fallback so the local
// server and the test suite run with no configuration. In production an empty
// secret is a fatal misconfiguration — signing with a public constant would let
// anyone forge console tokens — so we throw instead of silently falling back.
function secret() {
  const configured = process.env.NOTA_NOTARY_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NOTA_NOTARY_SECRET is required in production (refusing to sign notary tokens with the dev fallback).'
    );
  }
  return DEV_FALLBACK_SECRET;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

// Deterministic notary id derived from the email, so the SAME email always maps
// to the SAME notary across sessions — this is what makes accept idempotency
// ("re-accept by the same notary") hold without a lookup.
function notaryIdForEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  return 'N' + crypto.createHash('sha256').update(clean).digest('hex').slice(0, 24);
}

// `exp` is an absolute expiry in epoch milliseconds. `scope` (see SCOPES) narrows
// what the token authorizes and defaults to a full 'session' token.
function signToken(sub, exp, scope = SCOPES.SESSION, sec = secret()) {
  const payload = b64url(JSON.stringify({ sub: String(sub), exp: Number(exp), scope: String(scope) }));
  const sig = crypto.createHmac('sha256', sec).update(payload).digest('base64url');
  return payload + '.' + sig;
}

// Returns `{ sub, scope }` for a valid, unexpired token, else null. `nowMs` is
// the current time in epoch milliseconds (injected for determinism). A token
// minted before scopes existed (no scope claim) is treated as a full 'session'
// token so previously issued tokens keep working.
function verifyToken(token, nowMs, sec = secret()) {
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
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
  if (Number(nowMs) >= claims.exp) return null; // expired
  const scope = typeof claims.scope === 'string' ? claims.scope : SCOPES.SESSION;
  return { sub: claims.sub, scope };
}

module.exports = { signToken, verifyToken, notaryIdForEmail, DEV_FALLBACK_SECRET, SCOPES };
