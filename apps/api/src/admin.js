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
const emails = require('./emails');
const commissionCfg = require('./commission-config');
const cancellationCfg = require('./cancellation-config');

// What each role may do. Re-derived from the server-side role on every request;
// the client is shown these only to hide controls it cannot use.
const PERMISSIONS = {
  [authDefaults.ROLES.SUPER_ADMIN]: ['analytics:read', 'pii:read', 'moderation:write', 'settings:write', 'notifications:write'],
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
        // The shared branded bilingual template (emails.js) — never an inline
        // one-off. Auth email = transactional; the unsubscribe mechanism is the
        // support mailbox (there is no public unsubscribe route on this domain).
        // mailto: still yields a List-Unsubscribe header (no one-click POST).
        const unsubscribeUrl =
          'mailto:' +
          emails.SENDER.supportEmail +
          '?subject=' +
          encodeURIComponent('Désabonnement / Unsubscribe');
        const msg = emails.adminMagicLink({
          link,
          ttlMinutes: Math.round(CHALLENGE_TTL_MS / 60000),
          baseUrl,
          unsubscribeUrl,
        });
        await mailer.send({ to: clean, subject: msg.subject, html: msg.html, text: msg.text, unsubscribeUrl });
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

  // ---------------------------------------------------------------------------
  // Admin-editable email templates (ADR 0018 §3).
  //
  // The registry of record is emails.TEMPLATE_META; the store is the main
  // table's CONFIG#EMAIL partition (repo.getEmailOverride & co — the notifier
  // consumes the same records through the repo port). Reading the merged list
  // is open to any authenticated admin (an analyst sees the state); WRITING
  // requires the 'notifications:write' permission, which only super_admin
  // carries. Every change is audit-logged with its before/after.
  // ---------------------------------------------------------------------------
  const SUBJECT_MAX = 200;

  function overrideView(o) {
    if (!o) return null;
    return {
      enabled: o.enabled !== false,
      subjectFr: o.subjectFr || null,
      subjectEn: o.subjectEn || null,
      updatedAt: o.updatedAt || null,
    };
  }

  // Validate one subject side against the template's declared placeholder
  // vocabulary. Returns an error object, or null when the subject is clean.
  function subjectError(side, raw, placeholders) {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string') {
      return { code: 'sujet_invalide', message: `${side} doit être une chaîne de caractères.` };
    }
    if (raw.length > SUBJECT_MAX) {
      return { code: 'sujet_trop_long', message: `${side} dépasse ${SUBJECT_MAX} caractères.` };
    }
    for (const [, tok] of raw.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)) {
      if (!placeholders.includes(tok)) {
        return {
          code: 'jeton_inconnu',
          message:
            `${side} : le jeton {{${tok}}} n’existe pas pour ce modèle. ` +
            (placeholders.length ? `Jetons permis : ${placeholders.map((p) => `{{${p}}}`).join(', ')}.` : 'Ce modèle n’accepte aucun jeton.'),
        };
      }
    }
    return null;
  }

  // GET — the merged registry: every template with its stored override (or null).
  async function listEmailTemplates(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    const overrides = typeof repo.listEmailOverrides === 'function' ? await repo.listEmailOverrides() : [];
    const byKey = new Map(overrides.map((o) => [o.key, o]));
    const templates = Object.entries(emails.TEMPLATE_META).map(([key, m]) => ({
      key,
      audience: m.audience,
      labelFr: m.labelFr,
      labelEn: m.labelEn,
      defaultSubjectFr: m.defaultSubjectFr,
      defaultSubjectEn: m.defaultSubjectEn,
      placeholders: m.placeholders,
      override: overrideView(byKey.get(key)),
    }));
    return { ok: true, templates };
  }

  // PUT — store (replace) one template's override. super_admin only.
  async function putEmailTemplate(token, key, body, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!p.permissions.includes('notifications:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    const meta = emails.TEMPLATE_META[key];
    if (!meta) {
      return { ok: false, status: 404, errors: [{ code: 'modele_inconnu', message: `Modèle de courriel inconnu : ${key}.` }] };
    }

    const b = body || {};
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') {
      return { ok: false, status: 422, errors: [{ code: 'champ_invalide', message: 'enabled doit être un booléen.' }] };
    }
    for (const [side, raw] of [['subjectFr', b.subjectFr], ['subjectEn', b.subjectEn]]) {
      const err = subjectError(side, raw, meta.placeholders || []);
      if (err) return { ok: false, status: 422, errors: [err] };
    }
    // Both-or-neither: the notifier's bilingual contract needs BOTH sides to
    // override a subject — a half-configured pair would silently do nothing,
    // so it is rejected loudly here instead.
    const fr = typeof b.subjectFr === 'string' ? b.subjectFr.trim() : '';
    const en = typeof b.subjectEn === 'string' ? b.subjectEn.trim() : '';
    if ((fr && !en) || (!fr && en)) {
      return {
        ok: false,
        status: 422,
        errors: [{ code: 'sujet_bilingue', message: 'Le sujet doit être fourni dans les deux langues (FR et EN), ou dans aucune.' }],
      };
    }

    const before = overrideView(await repo.getEmailOverride(key));
    const stored = await repo.putEmailOverride(
      { key, enabled: b.enabled !== false, subjectFr: fr, subjectEn: en },
      clockIso()
    );
    const after = overrideView(stored);
    await appendAudit('email_template_updated', {
      adminId: p.adminId,
      email: p.email,
      ip,
      meta: { key, before, after },
    });
    return { ok: true, override: { key, ...after } };
  }

  // DELETE — remove the override entirely (back to the built-in behaviour).
  async function resetEmailTemplate(token, key, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!p.permissions.includes('notifications:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    if (!emails.TEMPLATE_META[key]) {
      return { ok: false, status: 404, errors: [{ code: 'modele_inconnu', message: `Modèle de courriel inconnu : ${key}.` }] };
    }
    const before = overrideView(await repo.getEmailOverride(key));
    await repo.deleteEmailOverride(key);
    await appendAudit('email_template_reset', {
      adminId: p.adminId,
      email: p.email,
      ip,
      meta: { key, before, after: null },
    });
    return { ok: true, key };
  }

  // ---------------------------------------------------------------------------
  // The commission barème — Nota's to decide (ADR 0021 §4).
  //
  // The authority on shape and validation is commission-config.js, shared with
  // billing so the editor and the pricer can never disagree. The store is the
  // main table's single CONFIG#COMMISSION item. Reading is open to any
  // authenticated admin; WRITING requires 'settings:write' (super_admin only).
  // Every change is audit-logged with its before/after.
  // ---------------------------------------------------------------------------
  function baremeView(o) {
    if (!o) return null;
    return {
      taux: o.taux,
      plancher: o.plancher,
      paliers: (o.paliers || []).map((p) => ({ note: p.note, avis: p.avis, bonus: p.bonus })),
      updatedAt: o.updatedAt || null,
    };
  }

  // GET — the deployment's defaults (built-ins + environment), the stored
  // barème when Nota decided one, and whichever of the two is in force.
  async function getCommissionSchedule(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    const defaut = commissionCfg.envDefaults(process.env);
    const override = baremeView(typeof repo.getCommissionConfig === 'function' ? await repo.getCommissionConfig() : null);
    const effectif = override
      ? { taux: override.taux, plancher: override.plancher, paliers: override.paliers }
      : defaut;
    return { ok: true, defaut, override, effectif };
  }

  // PUT — store (replace) the barème. super_admin only, validated loudly.
  async function putCommissionSchedule(token, body, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!p.permissions.includes('settings:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    const v = commissionCfg.validateSchedule(body || {});
    if (!v.ok) return { ok: false, status: 422, errors: v.errors };
    const before = baremeView(await repo.getCommissionConfig());
    const stored = await repo.putCommissionConfig({ taux: v.taux, plancher: v.plancher, paliers: v.paliers }, clockIso());
    const after = baremeView(stored);
    await appendAudit('commission_schedule_updated', {
      adminId: p.adminId,
      email: p.email,
      ip,
      meta: { before, after },
    });
    return { ok: true, override: after };
  }

  // DELETE — back to the environment defaults, on the next pricing.
  async function resetCommissionSchedule(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!p.permissions.includes('settings:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    const before = baremeView(await repo.getCommissionConfig());
    await repo.deleteCommissionConfig();
    await appendAudit('commission_schedule_reset', {
      adminId: p.adminId,
      email: p.email,
      ip,
      meta: { before, after: null },
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // The cancellation-fee barème — Nota's to decide (ADR 0023 §2).
  //
  // The authority on shape and validation is cancellation-config.js, shared
  // with the public cancel route so the editor and the fee arithmetic can
  // never disagree. The store is the main table's single CONFIG#ANNULATION
  // item. Reading is open to any authenticated admin; WRITING requires
  // 'settings:write' (super_admin only). Every change is audit-logged with
  // its before/after. An EMPTY barème is a valid override — it makes
  // cancellation free everywhere (the kill-switch is data, not a flag).
  // ---------------------------------------------------------------------------
  function annulationView(o) {
    if (!o) return null;
    return {
      paliers: (o.paliers || []).map((p) => ({ maxJours: p.maxJours, taux: p.taux })),
      updatedAt: o.updatedAt || null,
    };
  }

  // GET — the deployment's defaults (built-ins + environment), the stored
  // barème when Nota decided one, and whichever of the two is in force.
  async function getCancellationSchedule(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    const defaut = cancellationCfg.envDefaults(process.env);
    const override = annulationView(typeof repo.getCancellationConfig === 'function' ? await repo.getCancellationConfig() : null);
    const effectif = override ? { paliers: override.paliers } : defaut;
    return { ok: true, defaut, override, effectif };
  }

  // PUT — store (replace) the barème. super_admin only, validated loudly.
  async function putCancellationSchedule(token, body, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!p.permissions.includes('settings:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    const v = cancellationCfg.validateSchedule(body || {});
    if (!v.ok) return { ok: false, status: 422, errors: v.errors };
    const before = annulationView(await repo.getCancellationConfig());
    const stored = await repo.putCancellationConfig({ paliers: v.paliers }, clockIso());
    const after = annulationView(stored);
    await appendAudit('cancellation_schedule_updated', {
      adminId: p.adminId,
      email: p.email,
      ip,
      meta: { before, after },
    });
    return { ok: true, override: after };
  }

  // DELETE — back to the environment defaults, on the next cancellation.
  async function resetCancellationSchedule(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!p.permissions.includes('settings:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    const before = annulationView(await repo.getCancellationConfig());
    await repo.deleteCancellationConfig();
    await appendAudit('cancellation_schedule_reset', {
      adminId: p.adminId,
      email: p.email,
      ip,
      meta: { before, after: null },
    });
    return { ok: true };
  }

  return {
    requestLogin,
    verifyMagic,
    requireAdmin,
    me,
    refresh,
    logout,
    permissionsFor,
    listEmailTemplates,
    putEmailTemplate,
    resetEmailTemplate,
    getCommissionSchedule,
    putCommissionSchedule,
    resetCommissionSchedule,
    getCancellationSchedule,
    putCancellationSchedule,
    resetCancellationSchedule,
  };
}

module.exports = { createAdmin, permissionsFor, PERMISSIONS };
