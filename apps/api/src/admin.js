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
const { statsDeltasForNotaryActive } = require('./stats');

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
  // The PUBLIC site (NOTA_BASE_URL) — where an activated notary signs in. The
  // admin console's own origin (`baseUrl`) is never a place to send a notary.
  const siteUrl = String(config.siteUrl || '').replace(/\/+$/, '');
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

  // Qui nommer dans le journal quand une adresse frappe à la porte. Un compte
  // de la liste blanche se journalise par son adresse : l'opérateur doit savoir
  // QUI est freiné. Un INCONNU, lui, n'est pas un compte — c'est la donnée
  // personnelle d'un tiers, et le journal la gardait en clair sans limite de
  // durée (audit du 2026-09-03, P2-34). Il ne reste qu'une empreinte : de quoi
  // corréler des tentatives répétées, jamais de quoi reconstituer l'adresse.
  function auditIdentity(clean) {
    if (clean && allowlist.has(clean)) return { email: clean };
    const empreinte = require('node:crypto').createHash('sha256').update(String(clean || '')).digest('hex').slice(0, 16);
    return { email: null, meta: { empreinte } };
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
      await appendAudit('login_throttled', { ...auditIdentity(clean), ip });
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
      await appendAudit('login_requested_unknown', { ...auditIdentity(clean), ip });
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
    return {
      email: p.email,
      role: p.role,
      permissions: p.permissions,
      // Les DEUX échéances de la session, pour que la console vise la vraie :
      // elle rafraîchissait vers le plafond de 12 h alors que la session meurt
      // après `idleTtlMs` sans requête (audit du 2026-09-03, P1-15).
      idleTtlMs: SESSION_IDLE_TTL_MS,
      expiresAt: new Date(p.absoluteExpiresAt).toISOString(),
    };
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
  // prix, publié d'avance et le même pour tous les notaires. L'art. 29.1 du Code de
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
  //
  // ADR 0034 — ce n'est plus UN nombre mais une GRILLE : une ligne par service,
  // plus la garantie de date sur sa propre ligne. Un prix unique posé sur des
  // actes inégaux était régressif ; la grille ne dépend toujours que de deux
  // dimensions publiées — le service et le délai — et de rien qui touche au
  // notaire. Une grille stockée à l'ancien format `{ prixCents }` continue de
  // tarifer exactement ce qu'elle tarifait la veille.
  //
  // La LECTURE est tolérante là où l'écriture est stricte (`readStored`) : une
  // cellule devenue illisible — un service retiré du catalogue, par exemple —
  // est écartée SEULE et nommée dans `ignorees`. La console doit voir les
  // décisions qui survivent, et voir aussi celle qui ne survit pas : rendre
  // `null` afficherait « aucun prix enregistré » alors que la ligne existe
  // toujours en base, et le prochain enregistrement l'écraserait à l'aveugle.
  function prixView(o) {
    if (!o) return null;
    const { config, ignorees } = prixCfg.readStored(o);
    if (!Object.keys(config).length) return null;
    return {
      ...config,
      updatedAt: o.updatedAt || null,
      ...(ignorees.length ? { ignorees } : {}),
    };
  }

  // GET — la grille du déploiement (catalogue + environnement), celle stockée
  // quand Nota en a décidé une, celle des deux qui est en vigueur, et le
  // catalogue à éditer (la console n'a pas le domaine).
  async function getPrixNota(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    const defaut = prixCfg.envDefaults(process.env);
    const stored = typeof repo.getPrixNotaConfig === 'function' ? await repo.getPrixNotaConfig() : null;
    const override = prixView(stored);
    const effectif = await prixCfg.resolveGrille(repo, process.env);
    return { ok: true, defaut, override, effectif, catalogue: prixCfg.catalogue() };
  }

  // PUT — enregistrer (remplacer) le prix. super_admin seulement, validé fort.
  async function putPrixNota(token, body, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    // `billing:write` (« Configurer le paiement et le prix ») gouverne le prix
    // de Nota ; `settings:write` (super_admin) le garde aussi. Publiée sans
    // garde jusqu'au 2026-09-04, la première était une promesse, pas une
    // permission (revue de f45a2e1).
    if (!rbac.can(p.permissions, 'settings:write') && !rbac.can(p.permissions, 'billing:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] };
    }
    const v = prixCfg.validatePrix(body || {});
    if (!v.ok) return { ok: false, status: 422, errors: v.errors };
    const before = prixView(await repo.getPrixNotaConfig());
    // On ne stocke QUE les cellules décidées par l'opérateur : un service
    // ajouté au catalogue demain sera tarifé par le catalogue jusqu'à ce que
    // Nota en décide autrement, plutôt que par un zéro figé dans un vieil
    // enregistrement.
    const stored = await repo.putPrixNotaConfig(v.config, clockIso());
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
    if (!rbac.can(p.permissions, 'settings:write') && !rbac.can(p.permissions, 'billing:write')) {
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
        etude: domain.notaryEtude(n),
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
        // 2026-09-02 — what the operator needs to VET a signup: the fiche they
        // gave (a link to check, not a badge), when they signed up, and when
        // (if) their access was opened.
        lienCNQ: n.lienCNQ || null,
        inscritLe: n.inscritLe || null,
        approuveLe: n.approuveLe || null,
        depuis: n.createdAt || null,
        vuLe: n.lastSeenAt || null,
      };
    });
    // Par cote décroissante : le registre est d'abord un tableau d'honneur.
    notaires.sort((a, b) => b.cote - a.cote || String(a.etude || '').localeCompare(String(b.etude || '')));
    return { ok: true, notaires };
  }

  // ---------------------------------------------------------------------------
  // Activer un notaire (2026-09-02) — la porte de la console s'ouvre ICI.
  //
  // Le notaire s'est inscrit avec son courriel professionnel ; l'opérateur a
  // vérifié son inscription au Tableau de l'Ordre ; ce geste pose `approuveLe`,
  // le seul champ que la porte publique (notaryGate) lit. Stripe n'y est pour
  // rien : ses versements se branchent plus tard, depuis la console.
  //
  //   • `moderation:write` — décider qui est sur la place de marché est de la
  //     modération, pas un réglage.
  //   • Idempotent : un second clic répond `deja: true` et ne bouge ni la
  //     jauge, ni le journal, ni la boîte du notaire.
  //   • `status` : `en_attente` devient `active` ; un statut posé par Stripe
  //     (`onboarding`, `restricted`) est laissé tel quel — `approuveLe`
  //     suffit à ouvrir la porte, et le statut reste le fait de Stripe.
  //   • Le courriel `notaryApproved` part par la porte générique du notifieur
  //     (`sendCampaign`) : la Lambda admin ne peut pas écrire le registre
  //     SENT# de la table principale, et `deja` fait l'idempotence.
  // ---------------------------------------------------------------------------
  async function recordStats(deltas) {
    if (!deltas || !deltas.length || typeof repo.applyStatsDeltas !== 'function') return;
    try {
      await repo.applyStatsDeltas(deltas);
    } catch {
      /* la jauge est un indicateur, jamais une condition de l'activation */
    }
  }
  function notaireActivationView(n) {
    return {
      id: n.id,
      email: n.email || null,
      etude: domain.notaryEtude(n),
      statut: n.status || null,
      approuveLe: n.approuveLe || null,
      inscritLe: n.inscritLe || null,
    };
  }
  async function activateNotary(token, id, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'moderation:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Activation des notaires non autorisée.' }] };
    }
    const notaryId = String(id == null ? '' : id).trim();
    const n = notaryId && typeof repo.getNotary === 'function' ? await repo.getNotary(notaryId) : null;
    if (!n) return { ok: false, status: 404, errors: [{ code: 'notaire_introuvable', message: 'Notaire introuvable.' }] };
    if (n.approuveLe) return { ok: true, deja: true, notaire: notaireActivationView(n) };

    const at = clockIso();
    const next = {
      ...n,
      approuveLe: at,
      status: !n.status || n.status === 'en_attente' ? 'active' : n.status,
      updatedAt: at,
    };
    await repo.putNotary(next);
    await recordStats(statsDeltasForNotaryActive());
    await appendAudit('notary_activated', {
      adminId: p.adminId, email: p.email, ip,
      meta: { notaryId, notaryEmail: n.email || null, statutAvant: n.status || null, statutApres: next.status },
    });
    if (next.email && notifier && typeof notifier.sendCampaign === 'function') {
      try {
        await notifier.sendCampaign({
          to: next.email,
          templateKey: 'notaryApproved',
          ctx: { email: next.email, ...(siteUrl ? { consoleUrl: siteUrl + '/#notaires' } : {}) },
        });
      } catch {
        /* best-effort : l'accès est ouvert même si le courriel échoue ; le lien magique reste demandable */
      }
    }
    return { ok: true, deja: false, notaire: notaireActivationView(next) };
  }



  // ---------------------------------------------------------------------------
  // Le journal d'audit, relu par jour. Écrire une piste que personne ne peut
  // relire n'est pas une piste d'audit : c'est un fichier.
  //
  // La permission est 'audit:read', et rien d'autre — surtout pas 'pii:read',
  // que cet en-tête annonçait encore à tort le 2026-09-03 alors que trois
  // lignes plus bas c'est bien 'audit:read' qui est appliqué. Lire le journal
  // et lever l'anonymat d'un client sont deux capacités distinctes, et la
  // première s'ouvre sans la seconde (apps/api/test/admin-notaries.test.mjs).
  // Ce qui rend ce découplage tenable : le journal PUBLIC ne porte aucun
  // renseignement personnel — ni courriel, ni adresse d'origine, seulement des
  // identifiants internes (voir la note sur l'acteur dans handler.js).
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
    return { ok: true, jour: j, entrees: await entreesDuJour(j, ['queryAuditByDay', 'queryTxAuditByDay']) };
  }

  // LES ENTRÉES D'AUDIT D'UN JOUR OUVRABLE DE QUÉBEC, fusionnées et
  // dédoublonnées par id, la plus récente d'abord.
  //
  // Le journal est PARTITIONNÉ par jour UTC (AUDIT#<isoTs.slice(0,10)>) ;
  // l'opérateur, lui, demande un jour de QUÉBEC. Un geste de 21 h à Québec vit
  // dans la partition du LENDEMAIN UTC — on lit donc les deux partitions que ce
  // jour civil recouvre, puis on ne garde que les entrées dont le jour ouvrable
  // est bien celui demandé (revue de f45a2e1). Une seule copie de cette règle :
  // deux écrans la lisent (le journal d'audit, la liste des campagnes) et rien
  // ne serait pire que deux notions de « aujourd'hui » dans la même console.
  async function entreesDuJour(j, portes) {
    const lendemain = new Date(Date.parse(j + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
    const lire = (fn) => (typeof repo[fn] === 'function' ? Promise.all([repo[fn](j), repo[fn](lendemain)]).then((x) => x.flat()) : Promise.resolve([]));
    const journaux = await Promise.all(portes.map(lire));
    const zone = process.env.NOTA_TIMEZONE || undefined;
    const duJour = (e) => {
      if (!e || !e.ts) return true; // an undated entry stays visible rather than lost
      const t = Date.parse(e.ts);
      return Number.isFinite(t) ? domain.businessDay(t, zone) === j : true;
    };
    const parId = new Map();
    for (const e of journaux.flat()) {
      if (e && duJour(e) && !parId.has(e.id)) parId.set(e.id, e);
    }
    const entrees = [...parId.values()];
    // Le plus récent d'abord, comme partout ailleurs dans la console.
    entrees.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    return entrees;
  }

  // LE JOUR OUVRABLE COURANT — celui de Québec, jamais une tranche UTC d'un
  // horodatage. À 21 h le 3 septembre, `toISOString().slice(0,10)` dirait le 4.
  const jourCourant = () => domain.businessDay(clockMs(), process.env.NOTA_TIMEZONE || undefined);

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
    'notifications:write': ['Modifier les courriels et notifications', 'Edit emails and notifications'],
    'billing:write': ['Configurer le paiement et le prix', 'Configure payment and price'],
    'audit:read': ['Lire le journal d’audit', 'Read the audit log'],
    'campaigns:send': ['Envoyer une campagne ciblée', 'Send a targeted campaign'],
    'audiences:read': ['Voir les groupes d’audience', 'See audience groups'],
    'audiences:write': ['Modifier les groupes d’audience', 'Edit audience groups'],
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

  // ---------------------------------------------------------------------------
  // LES GROUPES D'AUDIENCE — des listes de DESTINATAIRES.
  //
  // À ne jamais confondre avec les groupes RBAC juste au-dessus, et la confusion
  // n'était pas théorique : la console peuplait sa liste « envoyer à un groupe »
  // depuis `GET /admin/groups`, qui rend des paquets de PERMISSIONS. Viser « le
  // groupe pilote » ne pouvait donc atteindre personne — la cible existait dans
  // l'écran, jamais dans la résolution. Deux notions, deux partitions
  // (`AUDIENCE#GROUPES` contre `GROUPS`), deux tables, et maintenant deux
  // routes : l'ambiguïté était la porte du bogue.
  //
  // Deux permissions et non une : voir la liste des gens à qui Nota écrit est
  // une lecture NOMINATIVE, et la modifier est une décision d'envoi. Un
  // opérateur peut avoir la première sans la seconde.
  // ---------------------------------------------------------------------------

  const AUDIENCE_GROUP_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
  const AUDIENCE_LIBELLE_MAX = 80;
  // Une liste écrite à la main, pas une base de données : au-delà, c'est un
  // segment qu'il faut, et le catalogue en sert déjà. La borne est un garde-fou
  // de saisie, surchargeable par déploiement.
  const AUDIENCE_MEMBRES_MAX = Number(config.audienceMembresMax) > 0 ? Number(config.audienceMembresMax) : 500;

  // LES BORNES, SERVIES. La console les recopiait — un `AUD_ID_RE` et un
  // `AUD_LIBELLE_MAX` jumeaux de ceux-ci, et AUCUN plafond de membres : relever
  // `NOTA_AUDIENCE_MEMBRES_MAX` sur un déploiement laissait l'écran l'ignorer,
  // et l'opérateur découvrait la borne au refus du serveur. Elles voyagent donc
  // avec le catalogue, exactement comme celles du compositeur (`listSegments`).
  // Le motif est rendu en SOURCE d'expression régulière : la console le compile
  // tel quel, et le jour où la règle bouge ici, elle bouge là-bas.
  const audienceLimites = () => ({
    identifiantMotif: AUDIENCE_GROUP_ID.source,
    libelleMax: AUDIENCE_LIBELLE_MAX,
    membresMax: AUDIENCE_MEMBRES_MAX,
  });

  function validateAudienceGroup(id, payload = {}) {
    const errors = [];
    if (!AUDIENCE_GROUP_ID.test(String(id || ''))) {
      errors.push({
        code: 'identifiant_invalide',
        message: 'L’identifiant doit être en minuscules, sans espace (lettres, chiffres, - et _), 40 caractères au plus.',
      });
    }
    const libelle = typeof payload.libelle === 'string' ? payload.libelle.trim() : '';
    if (!libelle || libelle.length > AUDIENCE_LIBELLE_MAX) {
      errors.push({
        code: 'libelle_invalide',
        message: `Le nom du groupe est obligatoire et fait au plus ${AUDIENCE_LIBELLE_MAX} caractères.`,
      });
    }
    // L'audience décide quelle table `segments.js` interroge pour retrouver le
    // SUJET de chaque adresse — donc quelle base de consentement il peut
    // établir. Se tromper ici, c'est écrire à un notaire en le prenant pour un
    // client, et perdre sa base au passage.
    const audiencesValides = Object.values(segments.AUDIENCE);
    if (!audiencesValides.includes(payload.audience)) {
      errors.push({
        code: 'audience_invalide',
        message: `L’audience doit être l’une de : ${audiencesValides.join(', ')}.`,
      });
    }
    // La nature décide si la LCAP exige une base de consentement. Elle est
    // DÉCLARÉE sur le groupe et non devinée à l'envoi : un groupe qui ne le dit
    // pas est traité comme commercial par la résolution, et il vaut mieux que
    // l'opérateur l'ait écrit lui-même.
    const naturesValides = Object.values(segments.NATURE);
    if (!naturesValides.includes(payload.nature)) {
      errors.push({
        code: 'nature_invalide',
        message: `La nature doit être l’une de : ${naturesValides.join(', ')}.`,
      });
    }

    const bruts = Array.isArray(payload.membres) ? payload.membres : null;
    if (!bruts) {
      errors.push({ code: 'membres_invalides', message: 'Les destinataires doivent être une liste d’adresses.' });
    }
    const membres = [];
    for (const brut of bruts || []) {
      const email = String(brut == null ? '' : brut).trim().toLowerCase();
      if (!domain.isEmail(email)) {
        errors.push({ code: 'courriel_invalide', message: `« ${brut} » n’est pas une adresse courriel valide.` });
        continue;
      }
      // Déduplication à l'écriture : `resolveAudience` dédoublonne aussi, mais
      // un groupe qui MONTRE deux fois la même personne ment sur sa taille.
      if (!membres.includes(email)) membres.push(email);
    }
    if (bruts && membres.length === 0 && !errors.some((e) => e.code === 'courriel_invalide')) {
      errors.push({ code: 'membres_vides', message: 'Un groupe sans destinataire n’est pas une audience.' });
    }
    if (membres.length > AUDIENCE_MEMBRES_MAX) {
      errors.push({
        code: 'membres_trop_nombreux',
        message: `Un groupe compte au plus ${AUDIENCE_MEMBRES_MAX} destinataires — au-delà, visez un segment.`,
      });
    }

    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], groupe: { id: String(id), libelle, audience: payload.audience, nature: payload.nature, membres } };
  }

  async function listAudienceGroups(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'audiences:read')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Lecture des groupes d’audience non autorisée.' }] };
    }
    const groupes = typeof repo.listAudienceGroups === 'function' ? await repo.listAudienceGroups() : [];
    return {
      ok: true,
      groupes: groupes.map((g) => ({ ...g, membres: g.membres || [], nbMembres: (g.membres || []).length })),
      limites: audienceLimites(),
    };
  }

  async function putAudienceGroup(token, id, payload, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'audiences:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Modification des groupes d’audience non autorisée.' }] };
    }
    const v = validateAudienceGroup(id, payload || {});
    if (!v.ok) return { ok: false, status: 422, errors: v.errors };
    const avant = typeof repo.getAudienceGroup === 'function' ? await repo.getAudienceGroup(id) : null;
    const groupe = await repo.putAudienceGroup(v.groupe, clockIso());
    // Modifier la liste des gens à qui Nota écrit est une décision : elle se
    // journalise avec son avant/après, comme un changement de permission.
    await appendAudit('audience_groupe_modifie', {
      adminId: p.adminId, email: p.email, ip,
      meta: { groupeId: String(id), avant, apres: groupe },
    });
    return { ok: true, groupe: { ...groupe, nbMembres: (groupe.membres || []).length } };
  }

  async function deleteAudienceGroup(token, id, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'audiences:write')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Modification des groupes d’audience non autorisée.' }] };
    }
    const avant = typeof repo.getAudienceGroup === 'function' ? await repo.getAudienceGroup(id) : null;
    if (!avant) {
      return { ok: false, status: 404, errors: [{ code: 'groupe_introuvable', message: 'Ce groupe d’audience n’existe pas.' }] };
    }
    await repo.deleteAudienceGroup(id);
    await appendAudit('audience_groupe_supprime', {
      adminId: p.adminId, email: p.email, ip,
      meta: { groupeId: String(id), avant, apres: null },
    });
    return { ok: true };
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
    // `limites` voyage avec le catalogue : la console pose les `maxlength` du
    // compositeur depuis le serveur plutôt que de recopier des bornes qui
    // dériveraient le jour où emails.js bouge.
    return {
      ok: true,
      segments: segments.describeSegments().map(segmentView),
      limites: { ...emails.CAMPAIGN_LIMITS, jetons: [...emails.CAMPAIGN_TOKENS] },
    };
  }

  const PLAFOND_CAMPAGNE = config.campagnePlafond || segments.GARDES.plafondAudience;
  const FENETRE_CAMPAGNE = config.campagneFenetreHeures || segments.GARDES.fenetreHeures;

  // CE QUE LA CAMPAGNE ENVOIE — deux formes, contrôlées AVANT toute résolution :
  // un refus doit coûter zéro lecture, et surtout zéro envoi.
  //
  //   • `message` — la copie que l'opérateur vient d'écrire POUR cette campagne.
  //     C'est la forme normale depuis le compositeur. Elle vit avec la campagne
  //     et ne touche jamais au registre des gabarits : avant, « rédiger » une
  //     relance voulait dire aller reformuler un gabarit dans l'écran
  //     « Courriels », donc changer ce courriel-là pour TOUS les envois
  //     suivants — y compris les transactionnels que l'art. 68 protège.
  //   • `templateKey` — un gabarit du registre, avec sa surcharge admin
  //     (ADR 0018). Forme héritée, gardée : réexpédier un gabarit existant reste
  //     une demande légitime, et c'est elle qui porte la garde de l'art. 68.
  //
  // Les deux ensemble sont refusés : un envoi doit avoir UNE source de copie.
  function verifierCopie(payload) {
    const aMessage = payload.message !== undefined && payload.message !== null;
    const aGabarit = payload.templateKey !== undefined && payload.templateKey !== null && payload.templateKey !== '';
    if (aMessage && aGabarit) {
      return {
        ok: false, status: 422,
        errors: [{ code: 'copie_ambigue', message: 'Choisissez soit un gabarit du registre, soit un message écrit — jamais les deux.' }],
      };
    }
    if (aMessage) {
      const v = emails.validateCampaignMessage(payload.message);
      if (!v.ok) return { ok: false, status: 422, errors: v.errors };
      return { ok: true, message: v.message, meta: null, templateKey: null };
    }
    if (!aGabarit) {
      return {
        ok: false, status: 422,
        errors: [{ code: 'copie_manquante', message: 'Une campagne part avec un message écrit ou un gabarit du registre : elle ne part pas vide.' }],
      };
    }
    const meta = emails.TEMPLATE_META[payload.templateKey];
    if (!meta) {
      return { ok: false, status: 404, errors: [{ code: 'modele_inconnu', message: `Modèle de courriel inconnu : ${payload.templateKey}.` }] };
    }
    return { ok: true, meta, templateKey: payload.templateKey, message: null };
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
  function avertissementsDe(resolution, copie) {
    const out = resolution.avertissements.map((a) => a.message);

    // Une copie écrite ici n'a ni audience déclarée ni jeton non renseignable —
    // le validateur du compositeur refuse déjà tout jeton hors `{{email}}`.
    const meta = copie.meta;
    if (!meta) return out;

    const visees = new Set(resolution.destinataires.map((d) => d.audience));
    for (const e of resolution.echantillon) visees.add(e.audience);
    if (visees.size && meta.audience && !visees.has(meta.audience)) {
      out.push(
        `Le gabarit « ${copie.templateKey} » s’adresse à « ${meta.audience} », alors que l’audience résolue vise « ${[...visees].join(', ')} ».`
      );
    }

    const orphelins = (meta.placeholders || []).filter((j) => !CTX_CAMPAGNE.includes(j));
    if (orphelins.length) {
      out.push(
        `Le gabarit « ${copie.templateKey} » interpole ${orphelins.map((j) => `{{${j}}}`).join(', ')}, qu’une campagne ne peut pas renseigner : ces jetons resteront vides.`
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
    const copie = verifierCopie(payload);
    if (!copie.ok) return copie;

    const r = await resoudre(payload.audience, { dryRun: true });
    if (!r.ok) return { ok: false, status: 422, errors: r.errors };

    if (copie.meta) {
      const nature = verifierNature(copie.meta, copie.templateKey, r.nature);
      if (!nature.ok) return nature;
    }

    return {
      ok: true,
      total: r.total,
      exclus: exclusView(r.exclus),
      echantillon: echantillonView(r),
      plafond: { limite: r.plafond.limite, depasse: r.plafond.depasse },
      nature: r.nature,
      // Sur QUOI les deux gardes se sont appuyées. Sans cet écho, la console
      // affirmait « base de consentement vérifiée » alors que la résolution
      // avait pu redescendre sur une déduction faute de registre — une garantie
      // qu'on ne peut pas contrôler n'en est pas une.
      garde: { frequence: r.garde.frequence, consentement: r.garde.consentement },
      avertissements: avertissementsDe(r, copie),
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
    const copie = verifierCopie(payload);
    if (!copie.ok) return copie;

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

    if (copie.meta) {
      const nature = verifierNature(copie.meta, copie.templateKey, r.nature);
      if (!nature.ok) return nature;
    }

    if (!notifier || typeof notifier.sendCampaign !== 'function') {
      // Aucun chemin d'envoi câblé. On le DIT, plutôt que d'en écrire un second
      // ici : celui de `notifications.js` honore déjà la suppression et le
      // retrait RFC 8058, et un doublon divergerait le jour où l'un des deux
      // bouge. Rien n'est marqué : aucun quota consommé pour un envoi qui n'a
      // pas eu lieu.
      await appendAudit('campagne_refusee', {
        adminId: p.adminId, email: p.email, ip,
        meta: { templateKey: copie.templateKey, total: r.total, motif: 'envoi_indisponible' },
      });
      return {
        ok: false,
        status: 503,
        errors: [{ code: 'envoi_indisponible', message: 'Aucun expéditeur n’est câblé sur cette console : la campagne n’a pas été envoyée.' }],
      };
    }

    const campagneId = genId();
    const echecs = [];
    // `ecrits` / `echecs` : le registre des DESTINATAIRES (qui a reçu quoi).
    // `frequenceEchecs` : le registre du QUOTA (art. 56 1°), qui est un autre
    // item et une autre garde — les confondre ferait passer un envoi réussi
    // pour un envoi manqué.
    const registre = { ecrits: 0, echecs: 0, frequenceEchecs: 0 };
    let envoyes = 0;

    // LE REGISTRE DES DESTINATAIRES — une ligne par (campagne, adresse), et
    // pour TOUTES les natures.
    //
    // Il n'existait pas. `markCampaignSent` écrit UNE ligne par ADRESSE, écrasée
    // par la campagne suivante : c'est l'ÉTAT du plafond de fréquence, et il ne
    // peut pas répondre à « qui a reçu la campagne du 3 septembre ». Sans cette
    // réponse, un renvoi ne peut pas se dédoublonner, une plainte ne peut pas se
    // vérifier, et la Loi 25 (art. 27, droit d'accès) reste inexécutable.
    //
    // Et il s'écrit sur le TRANSACTIONNEL aussi. L'écriture était conditionnée à
    // `nature === COMMERCIAL` — ce qui est juste pour le quota de fréquence et
    // faux pour la trace : la distinction LCAP décide du consentement et du
    // plafond, jamais de la tenue des livres.
    const inscrire = async (email, statut, erreur) => {
      if (typeof repo.appendCampaignRecipient !== 'function') return;
      try {
        await repo.appendCampaignRecipient({
          campagneId,
          courriel: email,
          templateKey: copie.templateKey || 'campagne_composee',
          nature: r.nature,
          at: clockIso(),
          statut,
          erreur: erreur || null,
        });
        registre.ecrits += 1;
      } catch {
        // Best-effort, comme le journal d'audit : un registre en panne ne doit
        // pas rejouer un envoi déjà parti. Mais le compte des lignes perdues
        // REMONTE — un registre muet qui se croit complet est pire que pas de
        // registre du tout.
        registre.echecs += 1;
      }
    };

    for (const d of r.destinataires) {
      let out;
      try {
        out = await notifier.sendCampaign({
          to: d.email,
          templateKey: copie.templateKey || undefined,
          message: copie.message || undefined,
          ctx: { email: d.email, campagneId },
        });
      } catch (err) {
        const raison = String((err && err.message) || err);
        echecs.push({ courriel: d.email, raison });
        await inscrire(d.email, 'echoue', raison);
        continue;
      }
      if (!out || out.sent !== true) {
        const raison = (out && (out.detail || out.reason)) || 'refuse';
        echecs.push({ courriel: d.email, raison });
        await inscrire(d.email, 'echoue', raison);
        continue;
      }
      envoyes += 1;
      await inscrire(d.email, 'envoye', null);
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
          // PAS un échec d'ENVOI : le courriel est parti. Ce qui a échoué est
          // le quota — la prochaine campagne retrouvera cette personne comme
          // si de rien n'était (art. 56 1°). Le mélanger aux échecs de
          // livraison ferait compter deux fois le même destinataire, en
          // « envoyé » et en « échoué », et masquerait la vraie lacune.
          registre.frequenceEchecs += 1;
        }
      }
    }

    const cibles = Array.isArray(payload.audience) ? payload.audience : [payload.audience];
    // Le message composé est CONSERVÉ avec la campagne : « qui a reçu quoi »
    // n'a pas de « quoi » si la copie n'existe plus nulle part une fois l'écran
    // refermé. Le journal d'audit est append-only — c'est l'endroit juste.
    const trace = {
      campagneId,
      audience: cibles,
      templateKey: copie.templateKey,
      message: copie.message,
      nature: r.nature,
      envoyes,
      total: r.total,
      exclus: exclusView(r.exclus),
      echecs,
      registre,
      garde: r.garde,
    };

    // ZÉRO JOINT N'EST PAS UN SUCCÈS. Le mailer de la console rendait
    // `undefined` sans lever quand l'expéditeur n'était pas configuré, et cette
    // couche lisait « pas d'exception » comme « parti » : une production mal
    // câblée annonçait « campagne envoyée » en n'ayant rien envoyé. Une
    // résolution qui a désigné des destinataires et n'en a joint AUCUN est un
    // échec, et elle se dit comme tel — avec le motif de chacun.
    if (envoyes === 0 && r.destinataires.length > 0) {
      await appendAudit('campagne_echouee', { adminId: p.adminId, email: p.email, ip, meta: trace });
      return {
        ok: false,
        status: 502,
        errors: [{
          code: 'envoi_echoue',
          message: `Aucun des ${r.destinataires.length} destinataires n’a été joint : la campagne n’est PAS partie.`,
        }],
        echecs,
        campagneId,
      };
    }

    await appendAudit('campagne_envoyee', { adminId: p.adminId, email: p.email, ip, meta: trace });

    return {
      ok: true,
      envoyes,
      echoues: echecs.length,
      echecs,
      registre,
      exclus: exclusView(r.exclus),
      campagneId,
    };
  }

  // QUI A REÇU LA CAMPAGNE X — la question à laquelle rien ne répondait.
  //
  // `analytics:read` pour la poser, `pii:read` pour lire les adresses en clair :
  // un opérateur doit pouvoir vérifier qu'un envoi a bien atteint le nombre
  // annoncé sans obtenir pour autant la liste expédiable. Sans `pii:read`,
  // l'adresse est masquée comme dans l'échantillon de l'aperçu — reconnaissable,
  // pas expédiable.
  const masquerCourriel = (email) => {
    const s = String(email || '');
    const at = s.indexOf('@');
    return at <= 0 ? '•••' : s.slice(0, 1) + '•••' + s.slice(at);
  };

  async function listCampaignRecipients(token, campagneId, { limit, cursor, ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'analytics:read')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Lecture des campagnes non autorisée.' }] };
    }
    const id = String(campagneId || '').trim();
    if (!id) {
      return { ok: false, status: 422, errors: [{ code: 'campagne_invalide', message: 'Identifiant de campagne manquant.' }] };
    }
    if (typeof repo.listCampaignRecipients !== 'function') {
      return { ok: false, status: 503, errors: [{ code: 'registre_indisponible', message: 'Le registre des destinataires n’est pas câblé sur ce dépôt.' }] };
    }
    let page;
    try {
      page = await repo.listCampaignRecipients(id, { limit, cursor });
    } catch (err) {
      // Un curseur d'une autre campagne, un identifiant réservé : la clé refuse
      // plutôt que de rendre le milieu d'une autre partition.
      return { ok: false, status: 422, errors: [{ code: 'campagne_invalide', message: String((err && err.message) || err) }] };
    }
    const enClair = rbac.can(p.permissions, 'pii:read');
    return {
      ok: true,
      campagneId: id,
      destinataires: (page.destinataires || []).map((d) => ({
        courriel: enClair ? d.courriel : masquerCourriel(d.courriel),
        templateKey: d.templateKey || null,
        nature: d.nature || null,
        statut: d.statut || null,
        erreur: d.erreur || null,
        at: d.at || null,
      })),
      cursor: page.cursor || null,
    };
  }

  // LES CAMPAGNES PASSÉES — sans quoi « qui a reçu » ne survit pas au rendu.
  //
  // `listCampaignRecipients` répond à « qui a reçu la campagne X » ; encore
  // faut-il pouvoir NOMMER X après avoir refermé l'écran. L'identifiant ne
  // vivait que dans la réponse d'un envoi : recharger la console, ou l'ouvrir
  // ailleurs, coupait le seul chemin vers un registre pourtant durable.
  //
  // La source est le JOURNAL D'AUDIT, et ce n'est pas un pis-aller : chaque
  // envoi y écrit déjà sa trace complète (audience, copie, comptes, exclusions,
  // gardes) sous `campagne_envoyee` / `campagne_echouee`, append-only, avec son
  // instant. Un second index de campagnes serait une deuxième vérité à tenir
  // d'accord avec la première. Le journal est partitionné par jour : la liste
  // l'est donc aussi, et le jour par défaut est le JOUR OUVRABLE DE QUÉBEC.
  //
  // Permissions : les mêmes que le registre des destinataires vers lequel elle
  // mène — `analytics:read` pour poser la question, `pii:read` pour lire en
  // clair les adresses que portent les échecs.
  const CAMPAGNE_STATUTS = { campagne_envoyee: 'envoyee', campagne_echouee: 'echouee' };

  async function listCampaigns(token, { jour, ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'analytics:read')) {
      return { ok: false, status: 403, errors: [{ code: 'interdit', message: 'Lecture des campagnes non autorisée.' }] };
    }
    const demande = String(jour == null ? '' : jour).trim();
    const j = demande || jourCourant();
    if (!domain.isISODate(j)) {
      return { ok: false, status: 422, errors: [{ code: 'jour_invalide', message: 'Le jour doit être une date ISO (AAAA-MM-JJ).' }] };
    }
    const enClair = rbac.can(p.permissions, 'pii:read');
    const entrees = await entreesDuJour(j, ['queryAuditByDay']);
    const campagnes = [];
    for (const e of entrees) {
      const statut = CAMPAGNE_STATUTS[e && e.action];
      const meta = (e && e.meta) || null;
      // Une trace sans identifiant n'ouvre aucun registre : `campagne_refusee`
      // (aucun expéditeur câblé) n'a jamais eu de campagne à nommer.
      if (!statut || !meta || !meta.campagneId) continue;
      campagnes.push({
        campagneId: meta.campagneId,
        at: e.ts || null,
        statut,
        audience: Array.isArray(meta.audience) ? meta.audience : (meta.audience ? [meta.audience] : []),
        templateKey: meta.templateKey || null,
        // La COPIE, telle qu'elle est partie. « Qui a reçu quoi » n'a pas de
        // « quoi » si le message n'existe plus nulle part.
        message: meta.message || null,
        nature: meta.nature || null,
        envoyes: Number(meta.envoyes) || 0,
        total: Number(meta.total) || 0,
        echoues: Array.isArray(meta.echecs) ? meta.echecs.length : 0,
        echecs: (Array.isArray(meta.echecs) ? meta.echecs : []).map((f) => ({
          courriel: enClair ? f.courriel : masquerCourriel(f.courriel),
          raison: f.raison || null,
        })),
        exclus: meta.exclus || null,
        registre: meta.registre || null,
        garde: meta.garde || null,
      });
    }
    return { ok: true, jour: j, campagnes };
  }

  return {
    requestLogin,
    verifyMagic,
    requireAdmin,
    listSegments,
    previewCampaign,
    sendCampaign,
    listCampaigns,
    listCampaignRecipients,
    listAudienceGroups,
    putAudienceGroup,
    deleteAudienceGroup,
    campaignLimits: () => ({ ...emails.CAMPAIGN_LIMITS, jetons: [...emails.CAMPAIGN_TOKENS] }),
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
    activateNotary,
    readAudit,
  };
}

module.exports = { createAdmin };
