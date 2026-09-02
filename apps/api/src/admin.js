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
const prixCfg = require('./prix-nota-config');
const cote = require('./cote');
const cancellationCfg = require('./cancellation-config');
const rbac = require('./rbac');
const segments = require('./segments');

// Les permissions ne sont plus une table figée `rôle → capacités`. Elles se
// RÉSOLVENT à chaque requête par `rbac.resolvePermissions` : l'union du paquet
// hérité du rôle, des permissions accordées directement à l'utilisateur, et de
// celles de chacun de ses groupes.
//
// Pourquoi trois concepts et pas un : un rôle est un raccourci, et un raccourci
// finit toujours par mal décrire quelqu'un. Un opérateur doit pouvoir ouvrir
// une capacité — lire le journal d'audit, écrire une campagne — sans promouvoir
// personne, et la refermer sans rétrograder personne. Le rôle survit comme
// paquet de compatibilité pour les comptes créés avant les groupes.
//
// Le module `rbac.js` est PUR (aucune E/S) : il décide, il ne charge rien.
// Charger les groupes est le travail de cette couche.

function createAdmin({
  repo,
  mailer, // { send({ to, subject, text, html }) } — optional; best-effort
  // Le port d'ENVOI d'une campagne, et son unique implémentation attendue est
  // `notifications.js` : lui seul honore déjà la liste de suppression et pose
  // l'en-tête RFC 8058 du retrait. La console n'ouvre PAS un second chemin
  // d'envoi ; sans ce port câblé, elle refuse l'envoi (503) au lieu d'en
  // improviser un.
  //   notifier.sendCampaign({ to, templateKey, ctx }) -> { sent, reason? }
  notifier,
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

    // Amorçage / rafraîchissement de l'identité à la connexion.
    //
    // ⚠️ Une connexion ne doit RIEN décider des accès. Elle horodate, et c'est
    // tout. Ce bloc réécrivait l'enregistrement complet : chaque connexion
    // effaçait donc les groupes et les permissions accordés depuis la console,
    // et un compte volontairement rétrogradé redevenait administrateur au
    // prochain lien magique. Les accès sont une décision explicite
    // (`putUserAccess`), jamais un effet de bord d'une ouverture de session.
    const adminId = claims.sub;
    const existing = await repo.getAdmin(adminId);
    // Le rôle d'AMORÇAGE ne s'applique qu'à un compte qui n'existe pas encore :
    // la liste blanche de l'environnement est la porte extérieure, et le premier
    // à la franchir doit pouvoir ouvrir la console. Un compte déjà connu garde
    // le sien, fût-il null — c'est alors les groupes et les grants qui parlent.
    const role = existing ? existing.role : (challenge.role || ROLES.SUPER_ADMIN);
    await repo.putAdmin({
      ...(existing || {}),
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
      // Relues à CHAQUE requête, jamais figées dans le jeton : retirer un
      // groupe ou supprimer une permission doit mordre immédiatement, y compris
      // sur une session déjà ouverte. Un jeton qui porterait ses droits
      // survivrait à la décision de les retirer.
      permissions: await effectivePermissions(admin, session),
    };
  }

  /**
   * L'union rôle + grants directs + groupes, pour un compte donné.
   * Un groupe supprimé disparaît simplement de la liste chargée : aucune
   * permission fantôme ne survit à la disparition de sa source.
   */
  async function effectivePermissions(admin, session) {
    const ids = Array.isArray(admin && admin.groupes) ? admin.groupes : [];
    const groups = [];
    for (const id of ids) {
      const g = typeof repo.getGroup === 'function' ? await repo.getGroup(id) : null;
      if (g) groups.push(g);
    }
    return rbac.resolvePermissions({
      role: (admin && admin.role) || (session && session.role),
      directPermissions: (admin && admin.permissions) || [],
      groups,
    });
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

  function overrideView(o) {
    if (!o) return null;
    return {
      // `actif` est le nom du produit ; `enabled` reste exposé en alias pour ne
      // pas casser un client déjà déployé.
      actif: o.actif !== false && o.enabled !== false,
      enabled: o.actif !== false && o.enabled !== false,
      subjectFr: o.subjectFr || null,
      subjectEn: o.subjectEn || null,
      preheaderFr: o.preheaderFr || null,
      preheaderEn: o.preheaderEn || null,
      corpsFr: o.corpsFr || null,
      corpsEn: o.corpsEn || null,
      ctaFr: o.ctaFr || null,
      ctaEn: o.ctaEn || null,
      updatedAt: o.updatedAt || null,
    };
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
      // Un courriel TRANSACTIONNEL ne peut pas être éteint : le couper serait
      // une publicité « incomplète » au sens de l'art. 68 du Code de
      // déontologie. La console grise l'interrupteur plutôt que de laisser
      // découvrir le refus à l'enregistrement.
      transactionnel: m.transactionnel === true,
      override: overrideView(byKey.get(key)),
    }));
    return { ok: true, templates, limites: emails.OVERRIDE_LIMITS };
  }

  // PUT — store (replace) one template's override. super_admin only.
  async function putEmailTemplate(token, key, body, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'notifications:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    const meta = emails.TEMPLATE_META[key];
    if (!meta) {
      return { ok: false, status: 404, errors: [{ code: 'modele_inconnu', message: `Modèle de courriel inconnu : ${key}.` }] };
    }

    // TOUTE la règle vit dans `emails.validateOverride` : les quatre paires
    // bilingues, les bornes, le vocabulaire de jetons du gabarit, le refus du
    // HTML et l'interdiction d'éteindre un courriel transactionnel. Rejouer
    // cette règle ici la ferait diverger le jour où l'une des deux bouge.
    const v = emails.validateOverride(key, body || {});
    if (!v.ok) return { ok: false, status: 422, errors: v.errors };

    const before = overrideView(await repo.getEmailOverride(key));
    const stored = await repo.putEmailOverride(v.override, clockIso());
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
    if (!rbac.can(p.permissions, 'notifications:write')) {
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
  // Le PRIX DE NOTA — celui de Nota, décidé par Nota (ADR 0031).
  //
  // Cette porte remplace celle du barème de commission. Nota ne prélève plus
  // une part des honoraires du notaire : elle vend son service à son propre
  // prix, un montant fixe identique pour tous. L'art. 29.1 du Code de
  // déontologie interdit au notaire toute convention mettant en péril son
  // indépendance et son désintéressement — un prix qui bougerait selon la cote
  // que Nota lui attribue en serait une. Il n'y a donc RIEN à paramétrer ici
  // qui touche au notaire : un entier de cents, et c'est tout.
  //
  // L'autorité sur la forme et la validation est prix-nota-config.js, partagée
  // avec la facturation pour que l'éditeur et le tarificateur ne puissent
  // jamais diverger. Le stockage est l'unique item CONFIG#PRIX de la table
  // principale. La LECTURE est ouverte à tout admin authentifié ; l'ÉCRITURE
  // exige 'settings:write' (super_admin). Chaque changement est journalisé
  // avec son avant/après.
  // ---------------------------------------------------------------------------
  function prixView(o) {
    if (!o) return null;
    return { prixCents: o.prixCents, updatedAt: o.updatedAt || null };
  }

  // GET — le défaut du déploiement (intégré + environnement), le prix stocké
  // quand Nota en a décidé un, et celui des deux qui est en vigueur.
  async function getPrixNota(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    const defaut = prixCfg.envDefaults(process.env);
    const override = prixView(typeof repo.getPrixNotaConfig === 'function' ? await repo.getPrixNotaConfig() : null);
    const effectif = override ? { prixCents: override.prixCents } : defaut;
    return { ok: true, defaut, override, effectif };
  }

  // PUT — enregistrer (remplacer) le prix. super_admin seulement, validé fort.
  async function putPrixNota(token, body, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'settings:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    const v = prixCfg.validatePrix(body || {});
    if (!v.ok) return { ok: false, status: 422, errors: v.errors };
    const before = prixView(await repo.getPrixNotaConfig());
    const stored = await repo.putPrixNotaConfig({ prixCents: v.prixCents }, clockIso());
    const after = prixView(stored);
    await appendAudit('prix_nota_updated', {
      adminId: p.adminId,
      email: p.email,
      ip,
      meta: { before, after },
    });
    return { ok: true, override: after };
  }

  // DELETE — retour au défaut du déploiement, dès la prochaine tarification.
  async function resetPrixNota(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'settings:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    const before = prixView(await repo.getPrixNotaConfig());
    await repo.deletePrixNotaConfig();
    await appendAudit('prix_nota_reset', {
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
    if (!rbac.can(p.permissions, 'settings:write')) {
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
    if (!rbac.can(p.permissions, 'settings:write')) {
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

  // ---------------------------------------------------------------------------
  // Le registre des notaires (2026-09-01) — la contrepartie opérateur de la
  // divulgation faite au notaire (ADR 0028). Pour chaque notaire : sa cote et
  // ses quatre axes (une cote contestée doit pouvoir être refaite à la main),
  // le taux qu'elle lui vaut aujourd'hui, ce qu'il a porté, et ce que Nota a
  // réellement encaissé de lui. Nominatif : exige 'pii:read', donc super_admin.
  // ---------------------------------------------------------------------------
  async function listNotaries(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'pii:read')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    const profils = typeof repo.listNotaries === 'function'
      ? await repo.listNotaries()
      : (typeof repo.listActiveNotaries === 'function' ? await repo.listActiveNotaries() : []);
    const nowMs = clockMs();
    const notaires = profils.map((n) => {
      const score = cote.coteFor(n, nowMs);
      return {
        id: n.id,
        email: n.email || null,
        etude: n.label || null,
        statut: n.status || null,
        cote: score.cote,
        axes: score.axes,
        // ADR 0031 — plus de `tauxEffectif`, plus de `part`. Le notaire garde
        // 100 % de ses honoraires, et publier une colonne « le notaire garde
        // X % » — fût-ce dans une console interne — décrirait la convention que
        // l'art. 29.1 du Code de déontologie interdit. Ce qui reste est ce que
        // Nota a facturé au client pour son propre service.
        actes: Number(n.actsCompleted) || 0,
        actesParService: n.actsByService || {},
        note: domain.ratingAverage(n.ratingSum, n.ratingCount),
        avis: Number(n.ratingCount) || 0,
        commissionPercue: Math.round(Number(n.commissionCentsCollected) || 0) / 100,
        // Ce que ce notaire DOIT encore à Nota : les actes réglés hors
        // plateforme (le client l'a payé directement à la signature). Un
        // encaissement et une créance ne se confondent jamais.
        commissionDue: Math.round(Number(n.commissionCentsDue) || 0) / 100,
        rayonKm: Number(n.rayonKm) || 0,
        urgences: n.urgences === true,
        cnq: !!n.lienCNQ,
        depuis: n.createdAt || null,
        vuLe: n.lastSeenAt || null,
      };
    });
    // Par cote décroissante : le registre est d'abord un tableau d'honneur.
    notaires.sort((a, b) => b.cote - a.cote || String(a.etude || '').localeCompare(String(b.etude || '')));
    return { ok: true, notaires };
  }



  // ---------------------------------------------------------------------------
  // Le journal d'audit, relu par jour. Écrire une piste que personne ne peut
  // relire n'est pas une piste d'audit : c'est un fichier. Nominatif et
  // financier — 'pii:read', donc super_admin.
  // ---------------------------------------------------------------------------
  async function readAudit(token, jour, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    // `audit:read`, et non `pii:read` : le catalogue publiait les deux clés, et
    // seule la seconde était appliquée — un catalogue qui décrit autre chose que
    // ce qui est appliqué est pire qu'aucun catalogue. Lire le journal et lever
    // l'anonymat d'un client sont deux capacités distinctes, et on doit pouvoir
    // ouvrir la première sans la seconde.
    if (!rbac.can(p.permissions, 'audit:read')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    const j = String(jour || '').trim();
    if (!domain.isISODate(j)) {
      return { ok: false, status: 422, errors: [{ code: 'jour_invalide', message: 'Le jour doit être une date ISO (AAAA-MM-JJ).' }] };
    }
    // DEUX journaux, un seul écran : les gestes d'administration vivent dans la
    // table admin, les mouvements d'argent dans la table principale (la Lambda
    // publique n'a pas accès à la première). Un auditeur ne doit pas avoir à
    // savoir ça — on fusionne, on dédoublonne par id, on trie.
    const [admins, transactions] = await Promise.all([
      typeof repo.queryAuditByDay === 'function' ? repo.queryAuditByDay(j) : [],
      typeof repo.queryTxAuditByDay === 'function' ? repo.queryTxAuditByDay(j) : [],
    ]);
    const parId = new Map();
    for (const e of [...(admins || []), ...(transactions || [])]) {
      if (e && !parId.has(e.id)) parId.set(e.id, e);
    }
    const entrees = [...parId.values()];
    // Le plus récent d'abord, comme partout ailleurs dans la console.
    entrees.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    return { ok: true, jour: j, entrees };
  }

  // ---------------------------------------------------------------------------
  // RBAC — le catalogue, les groupes, les accès.
  //
  // Trois concepts indépendants : une permission est une capacité, un groupe en
  // réunit, un utilisateur reçoit des groupes ET des permissions directes. Le
  // catalogue publié ici EST celui que `rbac.can()` applique — un catalogue qui
  // décrirait autre chose que ce qui est appliqué serait pire qu'aucun.
  // ---------------------------------------------------------------------------

  // Ce que chaque clé autorise, en deux langues. La console n'invente aucun
  // libellé : sans entrée ici, une permission ne s'affiche pas.
  const PERMISSION_LABELS = {
    'analytics:read': ['Lire les tableaux de bord', 'Read the dashboards'],
    'pii:read': ['Voir les renseignements personnels', 'See personal information'],
    'moderation:write': ['Modérer les offres et les notaires', 'Moderate offers and notaries'],
    'settings:write': ['Modifier les réglages du produit', 'Change product settings'],
    'users:read': ['Voir les utilisateurs', 'See users'],
    'users:write': ['Attribuer groupes et permissions', 'Assign groups and permissions'],
    'groups:read': ['Voir les groupes', 'See groups'],
    'groups:write': ['Créer et modifier les groupes', 'Create and edit groups'],
    'permissions:read': ['Lire le catalogue des permissions', 'Read the permission catalog'],
    'services:write': ['Modifier le catalogue des actes', 'Edit the catalogue of acts'],
    'notifications:write': ['Modifier les courriels et notifications', 'Edit emails and notifications'],
    'billing:write': ['Configurer le paiement et le prix', 'Configure payment and price'],
    'audit:read': ['Lire le journal d’audit', 'Read the audit log'],
    'campaigns:send': ['Envoyer une campagne ciblée', 'Send a targeted campaign'],
  };

  function listPermissions() {
    return {
      ok: true,
      permissions: rbac.PERMISSIONS.map((cle) => ({
        cle,
        libelle: (PERMISSION_LABELS[cle] || [cle, cle])[0],
        libelleEn: (PERMISSION_LABELS[cle] || [cle, cle])[1],
      })),
    };
  }

  const GROUP_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
  const NAME_MAX = 80;

  function validateGroup(id, payload = {}) {
    const errors = [];
    if (!GROUP_ID.test(String(id || ''))) {
      errors.push({ code: 'identifiant_invalide', message: 'L’identifiant doit être en minuscules, sans espace (lettres, chiffres, - et _), 40 caractères au plus.' });
    }
    const nom = typeof payload.nom === 'string' ? payload.nom.trim() : '';
    if (!nom || nom.length > NAME_MAX) {
      errors.push({ code: 'nom_invalide', message: `Le nom du groupe est obligatoire et fait au plus ${NAME_MAX} caractères.` });
    }
    const perms = Array.isArray(payload.permissions) ? payload.permissions : [];
    for (const p of perms) {
      // Le joker se donne à un utilisateur, jamais à un groupe : un groupe qui
      // porte « tout » se propage silencieusement à chaque nouveau membre.
      if (p === rbac.WILDCARD) {
        errors.push({ code: 'joker_interdit', message: 'Le joker « * » ne s’accorde pas à un groupe : accordez-le nommément à une personne.' });
      } else if (!rbac.isKnownPermission(p)) {
        errors.push({ code: 'permission_inconnue', message: `« ${p} » n’est pas une permission connue.` });
      }
    }
    if (errors.length) return { ok: false, errors };
    return {
      ok: true,
      errors: [],
      groupe: {
        id: String(id),
        nom,
        description: typeof payload.description === 'string' ? payload.description.trim().slice(0, 240) : '',
        permissions: [...new Set(perms)],
      },
    };
  }

  async function listGroups() {
    const groupes = typeof repo.listGroups === 'function' ? await repo.listGroups() : [];
    return { ok: true, groupes };
  }

  async function putGroup(id, payload, { actor } = {}) {
    const v = validateGroup(id, payload);
    if (!v.ok) return v;
    const avant = typeof repo.getGroup === 'function' ? await repo.getGroup(id) : null;
    const groupe = await repo.putGroup(v.groupe, clockIso());
    await appendAudit('groupe_modifie', { email: actor || null, meta: { groupeId: String(id), avant, apres: groupe } });
    return { ok: true, errors: [], groupe };
  }

  async function deleteGroup(id, { actor } = {}) {
    const avant = typeof repo.getGroup === 'function' ? await repo.getGroup(id) : null;
    if (!avant) return { ok: false, errors: [{ code: 'groupe_introuvable', message: 'Ce groupe n’existe pas.' }] };
    await repo.deleteGroup(id);
    await appendAudit('groupe_supprime', { email: actor || null, meta: { groupeId: String(id), avant, apres: null } });
    return { ok: true, errors: [] };
  }

  // Les comptes que la console peut administrer : la liste blanche de
  // l'environnement est la porte extérieure, et elle reste une décision de
  // déploiement — une console compromise ne doit pas pouvoir se fabriquer des
  // administrateurs. Ce que l'on configure ici, c'est ce que chacun PEUT, pas
  // qui existe.
  async function listUsers() {
    const utilisateurs = [];
    for (const email of allowlist) {
      const id = adminIdForEmail(email);
      const rec = (await repo.getAdmin(id)) || null;
      const groupes = (rec && rec.groupes) || [];
      const charges = [];
      for (const gid of groupes) {
        const g = typeof repo.getGroup === 'function' ? await repo.getGroup(gid) : null;
        if (g) charges.push(g);
      }
      utilisateurs.push({
        email,
        id,
        role: (rec && rec.role) || null,
        disabled: !!(rec && rec.disabled),
        groupes,
        permissions: (rec && rec.permissions) || [],
        effectives: rbac.resolvePermissions({
          role: rec && rec.role,
          directPermissions: (rec && rec.permissions) || [],
          groups: charges,
        }),
        derniereConnexion: (rec && rec.lastLoginAt) || null,
      });
    }
    return { ok: true, utilisateurs };
  }

  // Combien de comptes ACTIFS détiennent encore le joker, une fois le
  // changement proposé appliqué. C'est la seule question qui protège la console
  // d'un verrouillage : une porte d'administration sans personne pour l'ouvrir
  // n'est pas une politique de sécurité, c'est une panne.
  async function jokersApres(emailCible, projete) {
    let n = 0;
    for (const email of allowlist) {
      const id = adminIdForEmail(email);
      const rec = (await repo.getAdmin(id)) || null;
      const eff = email === emailCible ? projete : {
        role: rec && rec.role,
        directPermissions: (rec && rec.permissions) || [],
        disabled: !!(rec && rec.disabled),
      };
      if (eff.disabled) continue;
      if (rbac.can(rbac.resolvePermissions({ role: eff.role, directPermissions: eff.directPermissions }), rbac.WILDCARD)) n += 1;
    }
    return n;
  }

  async function putUserAccess(email, payload = {}, { actor } = {}) {
    const clean = String(email || '').trim().toLowerCase();
    if (!allowlist.has(clean)) {
      return { ok: false, errors: [{ code: 'utilisateur_inconnu', message: 'Cette adresse n’est pas un compte d’administration.' }] };
    }
    const id = adminIdForEmail(clean);
    const avant = (await repo.getAdmin(id)) || null;

    const errors = [];
    const perms = payload.permissions === undefined
      ? ((avant && avant.permissions) || [])
      : (Array.isArray(payload.permissions) ? payload.permissions : []);
    for (const p of perms) {
      if (p !== rbac.WILDCARD && !rbac.isKnownPermission(p)) {
        errors.push({ code: 'permission_inconnue', message: `« ${p} » n’est pas une permission connue.` });
      }
    }
    const groupes = payload.groupes === undefined
      ? ((avant && avant.groupes) || [])
      : (Array.isArray(payload.groupes) ? payload.groupes : []);
    for (const gid of groupes) {
      const g = typeof repo.getGroup === 'function' ? await repo.getGroup(gid) : null;
      if (!g) errors.push({ code: 'groupe_introuvable', message: `Le groupe « ${gid} » n’existe pas.` });
    }
    const role = payload.role === undefined ? (avant && avant.role) || null : payload.role;
    if (role !== null && !authDefaults.isRole(role)) {
      errors.push({ code: 'role_invalide', message: 'Rôle inconnu.' });
    }
    const disabled = payload.disabled === undefined ? !!(avant && avant.disabled) : !!payload.disabled;
    if (errors.length) return { ok: false, errors };

    const restants = await jokersApres(clean, { role, directPermissions: perms, disabled });
    if (restants === 0) {
      return {
        ok: false,
        code: 'dernier_administrateur',
        errors: [{
          code: 'dernier_administrateur',
          message: 'Impossible : plus aucun compte actif ne pourrait administrer la console. Accordez d’abord l’accès complet à quelqu’un d’autre.',
        }],
      };
    }

    const apres = {
      id,
      email: clean,
      role,
      disabled,
      groupes: [...new Set(groupes)],
      permissions: [...new Set(perms)],
      createdAt: (avant && avant.createdAt) || clockIso(),
      lastLoginAt: (avant && avant.lastLoginAt) || null,
    };
    await repo.putAdmin(apres);
    await appendAudit('acces_modifie', { email: actor || null, meta: { cible: clean, avant, apres } });
    return { ok: true, errors: [], utilisateur: apres };
  }

  // ---------------------------------------------------------------------------
  // LES CAMPAGNES — viser quelqu'un, et pouvoir le justifier après coup.
  //
  // La résolution d'audience appartient entièrement à `segments.js` : le
  // catalogue, la déduplication, la suppression des désabonnés, la base de
  // consentement LCAP et le plafond de fréquence de l'art. 56 1° y vivent, et
  // cette couche ne les rejoue pas — elle les APPELLE. Une garde qu'on
  // contournerait en passant par la route au lieu du module ne serait pas une
  // garde, alors la route n'a aucun chemin qui saute la résolution.
  //
  // Ce que cette couche ajoute, et qui n'appartenait à personne :
  //   • la permission (`analytics:read` pour regarder, `campaigns:send` pour
  //     envoyer — deux décisions distinctes) ;
  //   • le refus d'un gabarit TRANSACTIONNEL comme réclame (art. 68) ;
  //   • l'écriture du registre de fréquence après chaque envoi réussi, sans
  //     laquelle le plafond de l'art. 56 1° serait purement décoratif ;
  //   • le journal d'audit : qui, quelle audience, combien atteints, combien
  //     exclus et pourquoi.
  // ---------------------------------------------------------------------------

  // Le catalogue tel que la console le consomme : les libellés à plat, les
  // seuils en LISTE. La console ne code aucun identifiant de segment en dur —
  // elle lit celui-ci, et publié == appliqué par construction.
  function segmentView(s) {
    return {
      id: s.id,
      libelle: s.libelle.fr,
      libelleEn: s.libelle.en,
      vise: s.vise,
      audience: s.audience,
      nature: s.nature,
      params: Object.entries(s.params || {}).map(([nom, p]) => ({
        nom,
        defaut: p.defaut,
        min: p.min,
        max: p.max,
        libelle: p.libelle.fr,
        libelleEn: p.libelle.en,
      })),
    };
  }

  async function listSegments(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'analytics:read')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Lecture des segments non autorisée.' }] };
    }
    return { ok: true, segments: segments.describeSegments().map(segmentView) };
  }

  const PLAFOND_CAMPAGNE = config.campagnePlafond || segments.GARDES.plafondAudience;
  const FENETRE_CAMPAGNE = config.campagneFenetreHeures || segments.GARDES.fenetreHeures;

  // Le gabarit, contrôlé AVANT toute résolution — un refus doit coûter zéro
  // lecture, et surtout zéro envoi.
  function verifierGabarit(templateKey) {
    const meta = emails.TEMPLATE_META[templateKey];
    if (!meta) {
      return { ok: false, status: 404, errors: [{ code: 'modele_inconnu', message: `Modèle de courriel inconnu : ${templateKey}.` }] };
    }
    return { ok: true, meta };
  }

  // Art. 68 : un gabarit transactionnel est le seul avis d'un fait que son
  // destinataire a le droit de connaître. Le détourner en campagne commerciale
  // ferait d'un avis de service une réclame — et l'inverse, éteindre l'avis,
  // est déjà refusé côté surcharges. La nature de la campagne est celle que la
  // résolution a calculée, jamais celle que l'opérateur déclare.
  function verifierNature(meta, templateKey, nature) {
    if (nature === segments.NATURE.COMMERCIAL && meta.transactionnel === true) {
      return {
        ok: false,
        status: 422,
        errors: [{
          code: 'gabarit_transactionnel',
          message: `« ${templateKey} » est un avis transactionnel : il ne peut pas servir de campagne commerciale (art. 68 du Code de déontologie).`,
        }],
      };
    }
    return { ok: true };
  }

  // Le contexte qu'une campagne peut donner à un gabarit. Une campagne ne part
  // d'aucune offre et d'aucun acte : elle ne connaît que l'adresse visée. Tout
  // jeton qui demanderait un montant, un service ou une date resterait vide.
  const CTX_CAMPAGNE = ['email'];

  // Les avertissements que l'opérateur doit lire, en clair — et en clair veut
  // dire AVANT l'envoi, pas dans un courriel déjà parti. Ceux de la résolution
  // (le registre de fréquence absent, par exemple) plus les deux que seule
  // cette couche peut voir : un gabarit adressé à une autre audience que celle
  // qu'on vient de résoudre, et un gabarit dont les jetons ne peuvent pas être
  // remplis par une campagne.
  function avertissementsDe(resolution, meta, templateKey) {
    const out = resolution.avertissements.map((a) => a.message);

    const visees = new Set(resolution.destinataires.map((d) => d.audience));
    for (const e of resolution.echantillon) visees.add(e.audience);
    if (visees.size && meta.audience && !visees.has(meta.audience)) {
      out.push(
        `Le gabarit « ${templateKey} » s’adresse à « ${meta.audience} », alors que l’audience résolue vise « ${[...visees].join(', ')} ».`
      );
    }

    const orphelins = (meta.placeholders || []).filter((j) => !CTX_CAMPAGNE.includes(j));
    if (orphelins.length) {
      out.push(
        `Le gabarit « ${templateKey} » interpole ${orphelins.map((j) => `{{${j}}}`).join(', ')}, qu’une campagne ne peut pas renseigner : ces jetons resteront vides.`
      );
    }
    return out;
  }

  // L'échantillon voyage en CHAÎNES : l'adresse masquée et la raison mesurée.
  // Reconnaissable, jamais expédiable — une prévisualisation ne doit pas
  // pouvoir servir de liste d'envoi.
  const echantillonView = (r) => r.echantillon.map((e) => `${e.email} — ${e.raison}`);

  const exclusView = (x) => ({
    desabonnes: x.desabonnes,
    sansConsentement: x.sansConsentement,
    frequence: x.frequence,
    doublons: x.doublons,
    sansCourriel: x.sansCourriel,
  });

  function resoudre(audience, { dryRun, confirme }) {
    return segments.resolveAudience(audience, {
      repo,
      now: clockIso,
      plafond: PLAFOND_CAMPAGNE,
      fenetreHeures: FENETRE_CAMPAGNE,
      dryRun,
      confirme,
    });
  }

  // ESSAI À BLANC. Il compte, il détaille, il montre — il ne prépare rien
  // d'envoyable et n'écrit nulle part, pas même dans le registre de fréquence :
  // regarder une audience ne doit pas consommer le quota de ses membres.
  async function previewCampaign(token, body, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'analytics:read')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Lecture des campagnes non autorisée.' }] };
    }

    const payload = body || {};
    const gabarit = verifierGabarit(payload.templateKey);
    if (!gabarit.ok) return gabarit;

    const r = await resoudre(payload.audience, { dryRun: true });
    if (!r.ok) return { ok: false, status: 422, errors: r.errors };

    const nature = verifierNature(gabarit.meta, payload.templateKey, r.nature);
    if (!nature.ok) return nature;

    return {
      ok: true,
      total: r.total,
      exclus: exclusView(r.exclus),
      echantillon: echantillonView(r),
      plafond: { limite: r.plafond.limite, depasse: r.plafond.depasse },
      nature: r.nature,
      avertissements: avertissementsDe(r, gabarit.meta, payload.templateKey),
    };
  }

  // L'ENVOI. `campaigns:send` et rien d'autre : écrire un gabarit
  // (`notifications:write`) et l'envoyer à cent personnes ne sont pas la même
  // décision, donc pas la même permission.
  async function sendCampaign(token, body, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'campaigns:send')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Envoi de campagnes non autorisé.' }] };
    }

    const payload = body || {};
    const gabarit = verifierGabarit(payload.templateKey);
    if (!gabarit.ok) return gabarit;

    const r = await resoudre(payload.audience, { dryRun: false, confirme: payload.confirme === true });
    if (!r.ok) {
      // Le plafond franchi sans confirmation n'est pas une donnée invalide : la
      // demande est bien formée, c'est l'ÉTAT de l'audience qui exige un second
      // geste. 409, et le décompte voyage avec le refus.
      if (r.errors.some((e) => e.code === 'confirmation_requise')) {
        return { ok: false, status: 409, errors: r.errors };
      }
      return { ok: false, status: 422, errors: r.errors };
    }

    const nature = verifierNature(gabarit.meta, payload.templateKey, r.nature);
    if (!nature.ok) return nature;

    if (!notifier || typeof notifier.sendCampaign !== 'function') {
      // Aucun chemin d'envoi câblé. On le DIT, plutôt que d'en écrire un second
      // ici : celui de `notifications.js` honore déjà la suppression et le
      // retrait RFC 8058, et un doublon divergerait le jour où l'un des deux
      // bouge. Rien n'est marqué : aucun quota consommé pour un envoi qui n'a
      // pas eu lieu.
      await appendAudit('campagne_refusee', {
        adminId: p.adminId, email: p.email, ip,
        meta: { templateKey: payload.templateKey, total: r.total, motif: 'envoi_indisponible' },
      });
      return {
        ok: false,
        status: 503,
        errors: [{ code: 'envoi_indisponible', message: 'Aucun expéditeur n’est câblé sur cette console : la campagne n’a pas été envoyée.' }],
      };
    }

    const campagneId = genId();
    const echecs = [];
    let envoyes = 0;
    for (const d of r.destinataires) {
      let out;
      try {
        out = await notifier.sendCampaign({
          to: d.email,
          templateKey: payload.templateKey,
          ctx: { email: d.email, campagneId },
        });
      } catch (err) {
        echecs.push({ email: d.email, raison: String((err && err.message) || err) });
        continue;
      }
      if (!out || out.sent !== true) {
        echecs.push({ email: d.email, raison: (out && out.reason) || 'refuse' });
        continue;
      }
      envoyes += 1;
      // Art. 56 1° — SANS cette écriture, le plafond de fréquence ne vaut rien :
      // la campagne suivante retrouverait la même personne comme si de rien
      // n'était. Elle ne se pose que sur le COMMERCIAL : un avis de service
      // n'est pas une sollicitation et ne doit pas consommer le quota de son
      // destinataire. Best-effort — un registre en panne ne doit pas rejouer un
      // envoi déjà parti.
      if (r.nature === segments.NATURE.COMMERCIAL && typeof repo.markCampaignSent === 'function') {
        try {
          await repo.markCampaignSent(d.email, clockIso(), campagneId);
        } catch {
          echecs.push({ email: d.email, raison: 'registre_frequence_indisponible' });
        }
      }
    }

    const cibles = Array.isArray(payload.audience) ? payload.audience : [payload.audience];
    await appendAudit('campagne_envoyee', {
      adminId: p.adminId,
      email: p.email,
      ip,
      meta: {
        campagneId,
        audience: cibles,
        templateKey: payload.templateKey,
        nature: r.nature,
        envoyes,
        total: r.total,
        exclus: exclusView(r.exclus),
        echecs,
        garde: r.garde,
      },
    });

    return { ok: true, envoyes, exclus: exclusView(r.exclus), campagneId };
  }

  return {
    requestLogin,
    verifyMagic,
    requireAdmin,
    listSegments,
    previewCampaign,
    sendCampaign,
    me,
    refresh,
    logout,
    listPermissions,
    listGroups,
    putGroup,
    deleteGroup,
    listUsers,
    putUserAccess,
    listEmailTemplates,
    putEmailTemplate,
    resetEmailTemplate,
    getPrixNota,
    putPrixNota,
    resetPrixNota,
    getCancellationSchedule,
    putCancellationSchedule,
    resetCancellationSchedule,
    listNotaries,
    readAudit,
  };
}

module.exports = { createAdmin };
