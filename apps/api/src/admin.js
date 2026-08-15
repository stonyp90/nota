'use strict';

/**
 * Admin authentication + authorization use-case for admin.nota.ca.
 *
 * Security model (deliberately stronger than the notary console):
 *   - PASSWORDLESS magic link. requestLogin never reveals whether an address is
 *     an admin (no account enumeration); it only ever emails a single-use link
 *     to an ALLOWLISTED address and otherwise does nothing, returning the same
 *     generic result either way.
 *   - A signed token is only half the credential. The CHALLENGE token must be
 *     redeemed against an unconsumed, unexpired server-side login record
 *     (single-use), and every SESSION token is checked against a live, un-revoked
 *     session record on EVERY request — so a stolen token dies the moment the
 *     session is revoked or idles out, and the role is re-read server-side and
 *     never trusted from the client.
 *   - Rate-limited per IP to blunt link-spamming / brute force.
 *   - Every meaningful action appends to an immutable audit log.
 *
 * Framework-free and injectable: tests drive it with the in-memory repo, a fake
 * mailer and a fixed clock — no SES, no network, no real time.
 */
const domain = require('@nota/domain');
const authDefaults = require('./admin-auth');

// What each role may do. Re-derived from the server-side role on every request;
// the client is shown these only to hide controls it cannot use.
const PERMISSIONS = {
  [authDefaults.ROLES.SUPER_ADMIN]: ['analytics:read', 'pii:read', 'moderation:write', 'settings:write'],
  [authDefaults.ROLES.ANALYST]: ['analytics:read'],
};
function permissionsFor(role) {
  return PERMISSIONS[role] || [];
}

function createAdmin({
  repo,
  mailer, // { send({ to, subject, text, html }) } — optional; best-effort
  signToken = authDefaults.signAdminToken,
  verifyToken = authDefaults.verifyAdminToken,
  adminIdForEmail = authDefaults.adminIdForEmail,
  newId,
  now, // () => ISO datetime string (audit timestamps)
  nowMs, // () => epoch ms (token + session windows)
  config = {},
} = {}) {
  if (!repo) throw new Error('createAdmin: repo is required');

  const genId = newId || (() => require('node:crypto').randomUUID());
  const clockMs = nowMs || (() => Date.now());
  const clockIso = now || (() => new Date(clockMs()).toISOString());

  const SCOPES = authDefaults.SCOPES;
  const ROLES = authDefaults.ROLES;

  // The env-controlled allowlist of trusted operator emails. This is the ONLY
  // gate that lets someone request a login link at all. An allowlisted email
  // with no profile yet is bootstrapped as a super_admin on first successful
  // login (analyst assignment is a later settings feature).
  const allowlist = new Set(
    (config.allowlist || [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
  // In non-production only, return the magic link in the response so local dev
  // and tests can complete the flow without a real mailbox. NEVER in production.
  const devEcho = config.devEcho === true;

  const CHALLENGE_TTL_MS = config.challengeTtlMs || 15 * 60 * 1000; // 15 min
  const SESSION_IDLE_TTL_MS = config.sessionIdleTtlMs || 30 * 60 * 1000; // 30 min inactivity
  const SESSION_ABS_TTL_MS = config.sessionAbsoluteTtlMs || 12 * 60 * 60 * 1000; // 12 h hard cap
  const RL_WINDOW_SEC = config.rlWindowSec || 15 * 60; // 15 min window
  const RL_MAX = config.rlMax || 5; // max login requests / window / IP

  function epochSeconds(ms) {
    return Math.floor(ms / 1000);
  }

  async function appendAudit(action, ctx = {}) {
    try {
      const ts = clockIso();
      await repo.appendAudit({
        id: genId(),
        ts,
        action,
        adminId: ctx.adminId || null,
        email: ctx.email || null,
        ip: ctx.ip || null,
        meta: ctx.meta || null,
      });
    } catch {
      // Best-effort: never let an audit-write failure break the action itself.
      // A phase-4 reconcile / alarm surfaces a persistently failing audit sink.
    }
  }

  /**
   * Step 1 — request a magic link. Always returns { ok: true } for a
   * well-formed request (no account enumeration); `throttled: true` when the
   * per-IP rate limit is hit (the route maps that to 429). In dev, `devLink`
   * carries the link so the flow is completable without email.
   */
  async function requestLogin({ email, ip } = {}) {
    const clean = String(email == null ? '' : email).trim().toLowerCase();

    // Per-IP throttle first, so a hostile client cannot spam links regardless of
    // which addresses it guesses.
    const rlKey = ip || clean || 'unknown';
    let count = 1;
    try {
      count = await repo.incrRateCounter('login', rlKey, RL_WINDOW_SEC, clockMs());
    } catch {
      count = 1; // fail open on a counter error — availability over strictness here
    }
    if (count > RL_MAX) {
      await appendAudit('login_throttled', { email: clean, ip });
      return { ok: true, throttled: true };
    }

    // Silently no-op for a malformed or non-allowlisted address — same response
    // shape as the happy path, so the BODY never distinguishes an admin from a
    // stranger. (A small residual timing signal remains: the allowlisted path
    // does an SES round-trip the stranger path does not. We accept it because
    // reliably delivering the link requires awaiting the send, and the per-IP
    // rate limit above — now keyed on the trusted source IP — caps an attacker to
    // RL_MAX samples per window, making a timing oracle impractical.)
    if (!domain.isEmail(clean) || !allowlist.has(clean)) {
      await appendAudit('login_requested_unknown', { email: clean, ip });
      return { ok: true };
    }

    const adminId = adminIdForEmail(clean);
    const existing = await repo.getAdmin(adminId);
    const role = (existing && existing.role) || ROLES.SUPER_ADMIN;

    const challengeId = genId();
    const expMs = clockMs() + CHALLENGE_TTL_MS;
    await repo.putLoginChallenge({
      challengeId,
      adminId,
      email: clean,
      role,
      createdAt: clockIso(),
      expiresAt: expMs,
      consumed: false,
      ttl: epochSeconds(expMs) + 60, // let DynamoDB reap it shortly after expiry
    });

    const token = signToken({ sub: adminId, cid: challengeId, scope: SCOPES.CHALLENGE, exp: expMs });
    const link = `${baseUrl}/#/auth?token=${encodeURIComponent(token)}`;

    if (mailer) {
      try {
        await mailer.send({
          to: clean,
          subject: 'Votre lien de connexion — Nota Admin',
          text:
            'Connectez-vous à la console d’administration Nota :\n\n' +
            link +
            '\n\nCe lien est valide 15 minutes et à usage unique. ' +
            'Si vous n’avez pas demandé cette connexion, ignorez ce courriel.',
        });
      } catch {
        // Best-effort send; the operator can request another link.
      }
    }

    await appendAudit('login_requested', { adminId, email: clean, ip });
    return devEcho ? { ok: true, devLink: link } : { ok: true };
  }

  /**
   * Step 2 — redeem the magic link for a session. Single-use: the challenge is
   * atomically consumed, so a replayed link is rejected. Returns
   * { ok, session, role, expiresAt } or { ok:false }.
   */
  async function verifyMagic({ token, ip } = {}) {
    const claims = verifyToken(token || '', clockMs());
    if (!claims || claims.scope !== SCOPES.CHALLENGE || !claims.cid) {
      return { ok: false, errors: [{ code: 'lien_invalide', message: 'Lien invalide ou expiré.' }] };
    }

    // Atomic single-use consume: the FIRST redemption wins, a replay gets null.
    const challenge = await repo.consumeLoginChallenge(claims.cid, clockMs());
    if (!challenge || challenge.adminId !== claims.sub) {
      return { ok: false, errors: [{ code: 'lien_invalide', message: 'Lien invalide ou déjà utilisé.' }] };
    }

    // Bootstrap / refresh the identity record on first successful login.
    const adminId = claims.sub;
    const existing = await repo.getAdmin(adminId);
    const role = (existing && existing.role) || challenge.role || ROLES.SUPER_ADMIN;
    await repo.putAdmin({
      id: adminId,
      email: challenge.email,
      role,
      disabled: !!(existing && existing.disabled),
      createdAt: (existing && existing.createdAt) || clockIso(),
      lastLoginAt: clockIso(),
    });

    const sessionId = genId();
    const created = clockMs();
    const absExp = created + SESSION_ABS_TTL_MS;
    await repo.putAdminSession({
      sessionId,
      adminId,
      email: challenge.email,
      role,
      createdAt: clockIso(),
      lastSeenAt: created,
      absoluteExpiresAt: absExp,
      revokedAt: null,
      ttl: epochSeconds(absExp) + 60,
    });

    const session = signToken({ sub: adminId, sid: sessionId, role, scope: SCOPES.SESSION, exp: absExp });
    await appendAudit('login_success', { adminId, email: challenge.email, ip });
    return { ok: true, session, role, expiresAt: new Date(absExp).toISOString() };
  }

  /**
   * The gate every protected route calls. Returns the authenticated principal
   * { adminId, email, role, sid, permissions } for a live session, else null.
   * A valid signature is not enough — the server-side session must exist, be
   * un-revoked, within its absolute window, and not idle past the inactivity TTL.
   */
  async function requireAdmin(token, { ip } = {}) {
    const claims = verifyToken(token || '', clockMs());
    if (!claims || claims.scope !== SCOPES.SESSION || !claims.sid) return null;

    const session = await repo.getAdminSession(claims.sid);
    if (!session || session.revokedAt) return null;
    const t = clockMs();
    if (t >= Number(session.absoluteExpiresAt)) return null; // hard cap reached
    if (t - Number(session.lastSeenAt) > SESSION_IDLE_TTL_MS) return null; // idled out

    // Re-read the identity: a disabled/removed admin is rejected even mid-session.
    const admin = await repo.getAdmin(session.adminId);
    if (!admin || admin.disabled) return null;

    // Slide the inactivity window (best-effort; a touch failure must not 401).
    try {
      await repo.touchAdminSession(claims.sid, t);
    } catch {
      /* ignore */
    }
    void ip;
    return {
      adminId: session.adminId,
      email: session.email,
      role: admin.role || session.role,
      sid: claims.sid,
      absoluteExpiresAt: Number(session.absoluteExpiresAt),
      permissions: permissionsFor(admin.role || session.role),
    };
  }

  async function me(token) {
    const p = await requireAdmin(token);
    if (!p) return null;
    return { email: p.email, role: p.role, permissions: p.permissions };
  }

  /**
   * Sliding keep-alive: validate the current session (which slides the idle
   * window as a side effect) and re-mint the token. It does NOT extend the
   * ABSOLUTE cap set at login — that stays a hard 12h ceiling, so a stolen token
   * kept warm by repeated refreshes still dies. An idle/abandoned session dies
   * even sooner (the inactivity TTL).
   */
  async function refresh(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip }); // side effect: slides lastSeenAt
    if (!p) return { ok: false };
    const session = signToken({ sub: p.adminId, sid: p.sid, role: p.role, scope: SCOPES.SESSION, exp: p.absoluteExpiresAt });
    await appendAudit('session_refreshed', { adminId: p.adminId, email: p.email, ip });
    return { ok: true, session, expiresAt: new Date(p.absoluteExpiresAt).toISOString() };
  }

  // Revoke the server-side session so the token is dead everywhere immediately.
  // Idempotent: always returns { ok:true }, even on an already-invalid token.
  async function logout(token, { ip } = {}) {
    const claims = verifyToken(token || '', clockMs());
    if (claims && claims.scope === SCOPES.SESSION && claims.sid) {
      try {
        await repo.revokeAdminSession(claims.sid, clockIso());
      } catch {
        /* ignore */
      }
      await appendAudit('logout', { adminId: claims.sub, ip });
    }
    return { ok: true };
  }

  return { requestLogin, verifyMagic, requireAdmin, me, refresh, logout, permissionsFor };
}

module.exports = { createAdmin, permissionsFor, PERMISSIONS };
