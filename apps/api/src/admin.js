'use strict';

/**
 * Admin authentication + authorization use-case for admin.nota.ca.
 *
 * Security model (deliberately stronger than the notary console):
 *   - Password login is the normal path. A passwordless magic link remains
 *     available as a recovery/compatibility path and never reveals whether an address is
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
const crm = require('./crm');
const { statsDeltasForNotaryActive } = require('./stats');
// Le sujet sous lequel les avis d'un client sont rangés est le HACHÉ de son
// offre (keys.js) : le dossier d'usager les retrouve offre par offre, sans
// jamais manipuler un jeton porteur.
const { clientNotifSubject } = require('./keys');

// The feature inventory is an operator-facing map of shipped surfaces. It is
// intentionally descriptive: it never grants access and never replaces the
// route-level RBAC checks below. Keeping it here makes the admin console able
// to answer "what is Nota currently capable of?" without inventing a second
// product catalogue in the browser.
const ADMIN_FEATURES = Object.freeze([
  {
    id: 'marketplace', nom: 'Marché public', nomEn: 'Public marketplace',
    features: [
      ['carnet', 'Carnet de dates et demandes', 'Date calendar and requests'],
      ['offers', 'Publication, validation et expiration des offres', 'Offer publishing, validation and expiration'],
      ['matching', 'Mise en relation et propositions des notaires', 'Notary matching and proposals'],
      ['client-space', 'Espace client avec suivi du dossier', 'Client space with file tracking'],
      ['notary-space', 'Espace notaire avec agenda et cote', 'Notary space with calendar and score'],
      ['messages-documents', 'Messagerie et documents chiffrés après la retenue', 'Encrypted messaging and documents after acceptance'],
      ['evaluations', 'Évaluations anonymisées des notaires', 'Anonymized notary evaluations'],
      ['referrals', 'Partenaires et codes de recommandation', 'Partners and referral codes'],
      ['notifications', 'Notifications dans l’application et par courriel', 'In-app and email notifications'],
      ['cancellation', 'Annulation, caution et réclamation encadrée', 'Cancellation, holds and controlled claims'],
    ],
  },
  {
    id: 'preparation', nom: 'Préparation notariale', nomEn: 'Notarial preparation',
    features: [
      ['intake', 'Intake par service et liste de pièces', 'Service-specific intake and document checklist'],
      ['financing-ai', 'Préparation assistée du financement et du refinancement', 'Assisted financing and refinancing preparation'],
      ['act-ai', 'Préparation assistée du testament et de la procuration', 'Assisted will and power-of-attorney preparation'],
      ['control-plans', 'Plans de contrôle, preuves et étapes réservées au notaire', 'Control plans, evidence and notary-only steps'],
      ['signing-beta', 'Parcours de signature supervisé en phase bêta', 'Supervised signing flow in beta'],
      ['calendar', 'Abonnement carnet et connexion Outlook du notaire', 'Calendar feed and notary Outlook connection'],
    ],
  },
  {
    id: 'operations', nom: 'Opérations Nota', nomEn: 'Nota operations',
    features: [
      ['support', 'Soutien omnicanal avec escalade humaine', 'Omnichannel support with human escalation'],
      ['analytics', 'Analytique, entonnoir, appareils et provenance', 'Analytics, funnel, devices and acquisition'],
      ['privacy', 'Dossier usager, export et effacement Loi 25', 'Privacy file, export and Law 25 erasure'],
      ['audit', 'Journal d’audit et enquête par acteur ou sujet', 'Audit log and actor/subject investigations'],
      ['rbac', 'Accès par utilisateurs, groupes et permissions', 'Access through users, groups and permissions'],
      ['campaigns', 'Audiences, campagnes et registre des destinataires', 'Audiences, campaigns and recipient ledger'],
      ['email-editor', 'Gabarits bilingues et préférences de courriel', 'Bilingual templates and email preferences'],
    ],
  },
  {
    id: 'integrations', nom: 'Intégrations et paiements', nomEn: 'Integrations and payments',
    features: [
      ['stripe-checkout', 'Stripe Checkout et autorisation de la carte', 'Stripe Checkout and card authorization'],
      ['stripe-connect', 'Stripe Connect pour l’intégration des notaires', 'Stripe Connect for notary onboarding'],
      ['stripe-webhooks', 'Webhooks Stripe idempotents et rapprochement', 'Idempotent Stripe webhooks and reconciliation'],
      ['ses', 'SES, rebonds, plaintes et retrait LCAP', 'SES, bounces, complaints and CASL opt-out'],
      ['s3', 'Stockage documentaire S3 chiffré', 'Encrypted S3 document storage'],
      ['oauth', 'Connexion OAuth Google, Microsoft et LinkedIn', 'Google, Microsoft and LinkedIn OAuth sign-in'],
      ['outlook', 'Calendrier Outlook du notaire', 'Notary Outlook calendar'],
      ['cnq', 'Registres et formalités de la Chambre : préparation et étape humaine', 'Chambre registers and formalities: preparation and human step'],
    ],
  },
]);

const ADMIN_CUSTOMIZATION = Object.freeze([
  ['prix', 'Prix par service et garantie de date', 'Service and date-guarantee prices', 'editable', 'billing:write'],
  ['annulation', 'Barème d’annulation et délai de réclamation', 'Cancellation schedule and claim window', 'editable', 'settings:write'],
  ['courriels', 'Sujets, pré-en-têtes, copies, appels à l’action et signatures', 'Subjects, preheaders, copy, calls to action and signatures', 'editable', 'notifications:write'],
  ['audiences', 'Groupes de destinataires et consentement', 'Recipient groups and consent', 'editable', 'audiences:write'],
  ['campagnes', 'Prévisualisation et envoi ciblé avec garde-fous', 'Guarded targeted preview and sending', 'editable', 'campaigns:send'],
  ['acces', 'Utilisateurs, groupes et permissions', 'Users, groups and permissions', 'editable', 'users:write'],
  ['paiements', 'État Stripe et mode de paiement', 'Stripe readiness and payment mode', 'readiness', 'billing:write'],
  ['notaires', 'Activation des notaires après vérification', 'Notary activation after verification', 'operational', 'moderation:write'],
]);

// CE DONT CHAQUE FONCTIONNALITÉ DÉPEND, dehors. Une fonctionnalité qui n'a
// besoin de rien est livrée : son code tourne. Les autres attendent un
// interrupteur, une clé ou un seau, et tant qu'il manque, elles ne font RIEN —
// silencieusement. L'inventaire affichait « actif » sur les trente et une, y
// compris sur Stripe pendant que la section Paiements, deux portes plus loin,
// disait « Inactif · clé manquante » (audit du 2026-09-12). Une pastille verte
// qui ment sur l'état de la production est pire qu'aucune pastille.
const FEATURE_DEPENDENCIES = Object.freeze({
  'stripe-checkout': ['NOTA_STRIPE_SECRET_CONFIGURED', 'NOTA_STRIPE_WEBHOOK_CONFIGURED'],
  'stripe-connect': ['NOTA_STRIPE_SECRET_CONFIGURED'],
  'stripe-webhooks': ['NOTA_STRIPE_WEBHOOK_CONFIGURED'],
  cancellation: ['NOTA_STRIPE_SECRET_CONFIGURED'],
  'signing-beta': ['NOTA_SIGNING_BETA_ENABLED'],
  'messages-documents': ['NOTA_DOCS_BUCKET'],
  s3: ['NOTA_DOCS_BUCKET'],
  ses: ['NOTA_FROM_EMAIL'],
  support: ['NOTA_ASSISTANT_API_KEY|NOTA_ASSISTANT_KEY_PARAM'],
  'financing-ai': ['NOTA_FINANCING_AI_ENABLED'],
  'act-ai': ['NOTA_ACT_AI_ENABLED'],
  outlook: ['NOTA_OUTLOOK_CLIENT_ID'],
  oauth: ['NOTA_OAUTH_ENCRYPTION_KEY'],
});

// Un interrupteur est « posé » s'il vaut 'true' (drapeau) ou s'il porte une
// valeur non vide (clé, seau, paramètre). `A|B` : l'un ou l'autre suffit.
function switchOn(env, name) {
  return name.split('|').some((one) => {
    const value = String((env || {})[one] == null ? '' : (env || {})[one]).trim();
    if (!value) return false;
    return value !== 'false' && value !== '0';
  });
}

function featureStatus(env, id) {
  const needs = FEATURE_DEPENDENCIES[id];
  if (!needs) return { statut: 'actif', statutEn: 'active', manquant: [] };
  const manquant = needs.filter((name) => !switchOn(env, name));
  if (!manquant.length) return { statut: 'actif', statutEn: 'active', manquant: [] };
  return { statut: 'en attente', statutEn: 'waiting', manquant };
}

function featureSnapshot(env = process.env) {
  return {
    groupes: ADMIN_FEATURES.map((group) => ({
      id: group.id, nom: group.nom, nomEn: group.nomEn,
      fonctionnalites: group.features.map(([id, nom, nomEn]) => ({ id, nom, nomEn, ...featureStatus(env, id) })),
    })),
    personnalisations: ADMIN_CUSTOMIZATION.map(([id, nom, nomEn, mode, permission]) => ({ id, nom, nomEn, mode, permission })),
  };
}

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
  // L'environnement DE CE DÉPLOIEMENT : l'inventaire des fonctionnalités y lit
  // quels interrupteurs sont réellement posés. Injectable pour qu'un test
  // puisse décrire une production incomplète sans toucher process.env.
  env = process.env,
} = {}) {
  if (!repo) throw new Error('createAdmin: repo is required');

  const genId = newId || (() => require('node:crypto').randomUUID());
  const clockMs = nowMs || (() => Date.now());
  const clockIso = now || (() => new Date(clockMs()).toISOString());
  const support = require('./support-conversations').createSupportConversations({ repo, nowMs: clockMs, newId: genId, notifier });

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
  const configuredPassword = config.password || null;
  const configuredPasswordHash = config.passwordHash || null;

  const CHALLENGE_TTL_MS = config.challengeTtlMs || 15 * 60 * 1000; // 15 min
  const SESSION_IDLE_TTL_MS = config.sessionIdleTtlMs || 30 * 60 * 1000; // 30 min inactivity
  const SESSION_ABS_TTL_MS = config.sessionAbsoluteTtlMs || 12 * 60 * 60 * 1000; // 12 h hard cap
  const RL_WINDOW_SEC = config.rlWindowSec || 15 * 60; // 15 min window
  const RL_MAX = config.rlMax || 5; // max login requests / window / IP

  function passwordMatches(password) {
    const supplied = String(password == null ? '' : password);
    if (!supplied) return false;
    if (configuredPasswordHash) {
      const expected = String(configuredPasswordHash).trim().toLowerCase();
      const actual = require('node:crypto').createHash('sha256').update(supplied).digest('hex');
      const a = Buffer.from(actual);
      const b = Buffer.from(expected);
      return a.length === b.length && require('node:crypto').timingSafeEqual(a, b);
    }
    if (!configuredPassword) return false;
    const a = Buffer.from(supplied);
    const b = Buffer.from(String(configuredPassword));
    return a.length === b.length && require('node:crypto').timingSafeEqual(a, b);
  }

  async function establishSession({ adminId, email, role, ip }) {
    const existing = await repo.getAdmin(adminId);
    if (existing && existing.disabled) return { ok: false, disabled: true };
    const effectiveRole = existing ? existing.role : role;
    await repo.putAdmin({
      ...(existing || {}), id: adminId, email, role: effectiveRole,
      disabled: !!(existing && existing.disabled), createdAt: (existing && existing.createdAt) || clockIso(),
      lastLoginAt: clockIso(),
    });
    const sessionId = genId();
    const created = clockMs();
    const absExp = created + SESSION_ABS_TTL_MS;
    await repo.putAdminSession({ sessionId, adminId, email, role: effectiveRole, createdAt: clockIso(), lastSeenAt: created, absoluteExpiresAt: absExp, revokedAt: null, ttl: epochSeconds(absExp) + 60 });
    const session = signToken({ sub: adminId, sid: sessionId, role: effectiveRole, scope: SCOPES.SESSION, exp: absExp });
    await appendAudit('login_success', { adminId, email, ip });
    return { ok: true, session, role: effectiveRole, expiresAt: new Date(absExp).toISOString() };
  }

  async function login({ email, password, ip } = {}) {
    const clean = String(email == null ? '' : email).trim().toLowerCase();
    let count = 1;
    try { count = await repo.incrRateCounter('login', ip || clean || 'unknown', RL_WINDOW_SEC, clockMs()); } catch { count = 1; }
    if (count > RL_MAX) {
      await appendAudit('login_throttled', { ...auditIdentity(clean), ip });
      return { ok: false, throttled: true };
    }
    const valid = domain.isEmail(clean) && allowlist.has(clean) && passwordMatches(password);
    if (!valid) {
      await appendAudit('login_failed', { ...auditIdentity(clean), ip });
      return { ok: false };
    }
    const result = await establishSession({ adminId: adminIdForEmail(clean), email: clean, role: ROLES.SUPER_ADMIN, ip });
    return result.ok ? result : { ok: false };
  }

  function epochSeconds(ms) {
    return Math.floor(ms / 1000);
  }

  async function appendAudit(action, ctx = {}) {
    const ts = clockIso();
    try {
      await repo.appendAudit({
        id: genId(),
        ts,
        action,
        adminId: ctx.adminId || null,
        email: ctx.email || null,
        ip: ctx.ip || null,
        meta: ctx.meta || null,
      });
    } catch (err) {
      // --- UN PUITS D'AUDIT CASSÉ NE DOIT PLUS SE TAIRE (2026-09-05) --------
      // Ce `catch` était VIDE, avec pour seule justification « une alarme de
      // phase 4 fera surface ». Elle existe : infra/observability.tf pose un
      // filtre de métrique sur les groupes de journaux des DEUX Lambdas et une
      // alarme à la première perte. Le filtre admin ne pouvait rien compter —
      // le commentaire de ce fichier-là le disait mot pour mot. Une alarme
      // incapable de se déclencher est pire qu'aucune : elle rassure.
      //
      // La ligne est celle de la porte publique, au caractère près (le filtre
      // cherche la sous-chaîne « audit_write_failed »), avec ce que ce
      // journal-ci peut dire en plus : l'administrateur nommé. La console est
      // nominative — ce sont des employés, pas des clients — et savoir DE QUI
      // la trace perdue parlait est la moitié utile de l'alerte.
      //
      // FAUT-IL FAIRE ÉCHOUER LE GESTE QUAND SA TRACE SE PERD ? Non, et ce
      // n'est pas de la commodité — trois raisons, dont deux sont des faits de
      // ce code :
      //
      //   1. L'ÉCRITURE ARRIVE APRÈS LA MUTATION. Partout ici, on écrit
      //      `putGroup` / `putConfig` / `putAdmin` PUIS la trace. Répondre en
      //      erreur décrirait un geste qui a bel et bien eu lieu, et
      //      l'opérateur le rejouerait : un journal cassé produirait des
      //      doubles écritures. Le remède serait de faire de la trace et de la
      //      mutation UNE transaction (les deux vivent sur la table ADMIN,
      //      donc `TransactWriteItems` est possible) — c'est le vrai
      //      correctif, et c'est un autre chantier.
      //   2. `login_success` EST AUDITÉ. Fermer sur échec verrouillerait tous
      //      les administrateurs dehors à la première seconde de throttling
      //      DynamoDB — y compris ceux qui viendraient réparer le puits. Une
      //      politique de sécurité qui se coupe elle-même l'accès à la salle
      //      des machines n'est pas une politique, c'est une panne.
      //   3. Ce qu'on protège ici, c'est l'IMPUTABILITÉ, pas l'intégrité d'une
      //      transaction. Une trace perdue ne se rattrape pas ; ce qui doit
      //      être garanti, c'est que PERSONNE ne l'ignore. Cinq minutes plus
      //      tard l'alarme sonne, et geler la console est alors une décision
      //      d'opérateur — prise en connaissance de cause, pas subie.
      console.error(JSON.stringify({
        level: 'error',
        event: 'audit_write_failed',
        action,
        ts,
        adminId: ctx.adminId || null,
        message: (err && err.message) || String(err),
      }));
    }
  }

  // --- UN ACCÈS REFUSÉ LAISSE UNE TRACE (ADR 0036, amendement 2026-09-11) ---
  // Trouvé par l'audit BDD du 11 septembre : une opératrice qui ne détient que
  // `analytics:read` et frappe au dossier d'une personne, au registre des
  // notaires et au CRM est refusée trois fois — et le journal n'en dit RIEN. On
  // écrivait sur chaque lecture sensible RÉUSSIE (`dossier_usager_consulte`) et
  // sur aucun 403 : quelqu'un qui sonde les portes des dossiers était invisible
  // au registre même qui existe pour rendre un accès reprochable.
  //
  // Un seul entonnoir, que TOUTE porte de ce fichier traverse (un test statique
  // refuse tout `status: 403` écrit ailleurs). La trace est signée comme les
  // autres gestes de la console — adminId, courriel, IP : des employés nommés,
  // règle antérieure à l'ADR et inchangée — et nomme la PORTE (le use-case) et
  // la PERMISSION qui manquait. Une porte à deux clés (support:read ET pii:read)
  // les nomme toutes dans `manquantes` ; une porte à clé « l'une ou l'autre »
  // (settings:write OU billing:write) nomme la principale et l'`equivalentes`.
  //
  // Ce que la trace ne porte JAMAIS : la ressource demandée, ni l'adresse du
  // sujet. Le sujet d'un dossier Loi 25 est nommé par la même EMPREINTE que
  // `dossier_usager_consulte` — le journal s'ouvre avec `audit:read` sans
  // `pii:read`, il ne doit pas devenir un second annuaire. Le refus, lui, part
  // exactement comme avant : même statut, même code, même message. Et comme
  // partout ici, un puits d'audit cassé ne change rien à la réponse : il crie.
  async function refuserAcces(p, { porte, permission, equivalentes, manquantes, sujet, ip, message }) {
    const meta = { porte, permission };
    if (equivalentes && equivalentes.length) meta.equivalentes = equivalentes;
    if (manquantes && manquantes.length > 1) meta.manquantes = manquantes;
    if (sujet !== undefined) {
      const s = sujetDemande(sujet);
      meta.sujet = s.adresse ? empreinteSujet(s.adresse) : null;
    }
    await appendAudit('acces_refuse', { adminId: p.adminId, email: p.email, ip, meta });
    return { ok: false, status: 403, errors: [{ code: 'interdit', message }] };
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
          __override: repo.getEmailOverride ? await repo.getEmailOverride('adminMagicLink') : null,
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
    return establishSession({ adminId, email: challenge.email, role, ip });
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
    const permissionGroupIds = new Set();
    for (const id of ids) {
      const g = typeof repo.getGroup === 'function' ? await repo.getGroup(id) : null;
      if (g) {
        groups.push(g);
        for (const permissionGroupId of (g.groupesPermissions || g.permissionGroups || [])) {
          permissionGroupIds.add(String(permissionGroupId));
        }
      }
    }
    const permissionGroups = [];
    for (const id of permissionGroupIds) {
      const g = typeof repo.getPermissionGroup === 'function' ? await repo.getPermissionGroup(id) : null;
      if (g) permissionGroups.push(g);
    }
    return rbac.resolvePermissions({
      role: (admin && admin.role) || (session && session.role),
      directPermissions: (admin && admin.permissions) || [],
      groups,
      permissionGroups,
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
      signatureFr: o.signatureFr || null,
      signatureEn: o.signatureEn || null,
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
      return refuserAcces(p, { porte: 'putEmailTemplate', permission: 'notifications:write', ip, message: 'Cette section demande la permission d’écrire les courriels.' });
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
      return refuserAcces(p, { porte: 'resetEmailTemplate', permission: 'notifications:write', ip, message: 'Cette section demande la permission d’écrire les courriels.' });
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
      return refuserAcces(p, { porte: 'putPrixNota', permission: 'settings:write', equivalentes: ['billing:write'], ip, message: 'Cette section demande la permission de modifier les réglages.' });
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
      return refuserAcces(p, { porte: 'resetPrixNota', permission: 'settings:write', equivalentes: ['billing:write'], ip, message: 'Cette section demande la permission de modifier les réglages.' });
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
      // ADR 0041 — le délai de réclamation, quand Nota l'a décidé.
      ...(Number.isInteger(o.delaiJours) ? { delaiJours: o.delaiJours } : {}),
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
    // ADR 0041 — chaque `taux` est un PLAFOND ; `delaiJours` est le délai de
    // réclamation, résolu comme la route d'annulation : l'item stocké s'il en
    // porte un, le déploiement sinon.
    const effectif = override
      ? { paliers: override.paliers, delaiJours: cancellationCfg.delaiFor(override, process.env) }
      : defaut;
    return { ok: true, defaut, override, effectif };
  }

  // PUT — store (replace) the barème. super_admin only, validated loudly.
  async function putCancellationSchedule(token, body, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'settings:write')) {
      return refuserAcces(p, { porte: 'putCancellationSchedule', permission: 'settings:write', ip, message: 'Cette section demande la permission de modifier les réglages.' });
    }
    const v = cancellationCfg.validateSchedule(body || {});
    if (!v.ok) return { ok: false, status: 422, errors: v.errors };
    const before = annulationView(await repo.getCancellationConfig());
    const stored = await repo.putCancellationConfig({ paliers: v.paliers, ...(v.delaiJours !== undefined ? { delaiJours: v.delaiJours } : {}) }, clockIso());
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
      return refuserAcces(p, { porte: 'resetCancellationSchedule', permission: 'settings:write', ip, message: 'Cette section demande la permission de modifier les réglages.' });
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
      return refuserAcces(p, { porte: 'listNotaries', permission: 'pii:read', ip, message: 'Cette section demande la permission de lire les renseignements personnels.' });
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
      return refuserAcces(p, { porte: 'activateNotary', permission: 'moderation:write', ip, message: 'Activation des notaires non autorisée.' });
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
  // --- LE JOURNAL VU DEPUIS UNE ENQUÊTE (2026-09-05) -------------------------
  // Il ne se lisait QU'UN JOUR À LA FOIS, sans filtre et sans pagination
  // au-delà d'une partition. Les deux seules questions qu'un enquêteur pose —
  // « tout ce que cette personne a fait » et « tout ce qui a été fait à ce
  // compte » — n'avaient donc aucune réponse : il aurait fallu ouvrir un écran
  // par jour et lire à l'œil. Un registre qu'on ne peut pas interroger est une
  // archive, pas une piste d'audit.
  //
  // POURQUOI PAS UN INDEX. Le journal est partitionné par JOUR (`AUDIT#<jour>`)
  // et rien n'indexe l'acteur ni le sujet. Un index secondaire les rendrait
  // interrogeables sans borne — c'est le bon dessin le jour où le volume
  // l'exige, et c'est de l'infrastructure (une migration DynamoDB, pas un
  // correctif de code). D'ici là, la lecture reste ce qu'elle a toujours été —
  // une Query par partition — et le filtrage se fait au retour, sur une FENÊTRE
  // BORNÉE. Les deux bornes ci-dessous sont ce qui empêche cette porte de
  // devenir un balayage de table déguisé.
  const AUDIT_FENETRE_MAX_JOURS = 92; // un trimestre : au-delà, 422
  // Combien de JOURS une seule requête ouvre au plus. Ce n'est pas le même
  // chiffre que le nombre de Query : `entreesDuJour` lit DEUX partitions par
  // jour (la couture du fuseau de Québec) sur DEUX journaux — donc quatre. À
  // quatorze jours, une requête plafonne à ~56 Query, ce qui tient largement
  // dans le temps d'une Lambda ; le curseur porte le reste de la fenêtre.
  const AUDIT_JOURS_PAR_PAGE = 14;
  const AUDIT_LIMITE_DEFAUT = 100;
  const AUDIT_LIMITE_MAX = 500;

  const veille = (j) => new Date(Date.parse(j + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
  // La clé de tri d'une entrée dans sa partition — la MÊME que celle du dépôt
  // (`<isoTs>#<id>`, voir keys.js). C'est elle que le curseur retient.
  const cleAudit = (e) => String(e.ts || '') + '#' + String(e.id || '');

  // Le curseur dit DEUX choses : quelle partition rouvrir, et après quelle
  // entrée y reprendre. Il est opaque pour l'appelant mais jamais signé — il ne
  // porte aucun secret et n'ouvre aucune permission : la porte `audit:read` est
  // vérifiée à chaque requête, curseur ou pas.
  function encoderCurseur(c) {
    return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
  }
  function decoderCurseur(brut) {
    try {
      const c = JSON.parse(Buffer.from(String(brut), 'base64url').toString('utf8'));
      if (!c || !domain.isISODate(c.j)) return null;
      return { j: c.j, a: c.a == null ? null : String(c.a) };
    } catch {
      return null;
    }
  }

  // L'ACTEUR : qui a agi. Les deux journaux ne le nomment pas pareil — le
  // journal public par `acteur.{type,id}`, le journal admin par le courriel de
  // l'employé — et un enquêteur ne doit pas avoir à connaître cette plomberie.
  // Le TYPE seul est accepté aussi (« tout ce que les notaires ont fait »).
  function correspondActeur(e, q) {
    if (!q) return true;
    const candidats = [e.acteur && e.acteur.id, e.acteur && e.acteur.type, e.adminId, e.email];
    return candidats.some((v) => v != null && String(v).toLowerCase() === q);
  }

  // LE SUJET : sur quoi on a agi. Il ne porte pas le même NOM de clé selon
  // l'action — `bidId` ici, `notaryId` là, `cible` pour un changement d'accès,
  // `code` pour un partenaire — et un enquêteur ne connaît pas ces noms : il
  // connaît l'identifiant. On cherche donc la VALEUR dans la meta, quelle que
  // soit la clé qui la porte.
  //
  // Volontairement, l'acteur n'est PAS regardé ici : un dossier client est à la
  // fois l'acteur et le sujet de ses propres gestes, et confondre les deux
  // ferait de « sujet » un synonyme de « acteur » — les deux questions
  // redeviendraient une seule.
  function contientValeur(v, q, profondeur) {
    if (v == null || profondeur > 4) return false;
    if (Array.isArray(v)) return v.some((x) => contientValeur(x, q, profondeur + 1));
    if (typeof v === 'object') return Object.values(v).some((x) => contientValeur(x, q, profondeur + 1));
    return String(v).toLowerCase() === q;
  }
  const correspondSujet = (e, q) => (!q ? true : contientValeur(e.meta, q, 0));

  async function readAudit(token, jour, { ip, du, au, acteur, sujet, limite, curseur } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    // `audit:read`, et non `pii:read` : le catalogue publiait les deux clés, et
    // seule la seconde était appliquée — un catalogue qui décrit autre chose que
    // ce qui est appliqué est pire qu'aucun catalogue. Lire le journal et lever
    // l'anonymat d'un client sont deux capacités distinctes, et on doit pouvoir
    // ouvrir la première sans la seconde.
    if (!rbac.can(p.permissions, 'audit:read')) {
      return refuserAcces(p, { porte: 'readAudit', permission: 'audit:read', ip, message: 'Cette section demande la permission de lire le journal d’audit.' });
    }
    // UNE fenêtre, exprimée de deux façons. `jour` seul reste le comportement
    // d'origine (et celui de la console d'hier) ; `du`/`au` ouvrent l'intervalle
    // sans lequel « tout ce que cette personne a fait » n'a pas de réponse.
    const iso = (v) => String(v == null ? '' : v).trim();
    const bornes = iso(du) || iso(au);
    const finISO = bornes ? (iso(au) || iso(du)) : iso(jour);
    const debutISO = bornes ? (iso(du) || iso(au)) : iso(jour);
    if (!domain.isISODate(finISO) || !domain.isISODate(debutISO)) {
      return { ok: false, status: 422, errors: [{ code: 'jour_invalide', message: 'Le jour doit être une date ISO (AAAA-MM-JJ).' }] };
    }
    if (debutISO > finISO) {
      return { ok: false, status: 422, errors: [{ code: 'fenetre_invalide', message: 'La date de début suit la date de fin.' }] };
    }
    const etendue = Math.round((Date.parse(finISO + 'T00:00:00Z') - Date.parse(debutISO + 'T00:00:00Z')) / 864e5) + 1;
    if (etendue > AUDIT_FENETRE_MAX_JOURS) {
      return {
        ok: false,
        status: 422,
        errors: [{
          code: 'fenetre_trop_large',
          message: `La fenêtre ne peut dépasser ${AUDIT_FENETRE_MAX_JOURS} jours. Resserrez les dates, ou paginez.`,
        }],
      };
    }

    const nombre = Number(limite);
    const parPage = Number.isFinite(nombre) && nombre > 0 ? Math.min(Math.floor(nombre), AUDIT_LIMITE_MAX) : AUDIT_LIMITE_DEFAUT;
    const qActeur = iso(acteur).toLowerCase() || null;
    const qSujet = iso(sujet).toLowerCase() || null;

    // Les jours de la fenêtre, du PLUS RÉCENT au plus ancien : c'est l'ordre
    // dans lequel la console lit, et celui qu'une pagination doit conserver
    // page après page pour ne rien rejouer ni rien sauter.
    const jours = [];
    for (let d = finISO; d >= debutISO; d = veille(d)) jours.push(d);

    let depart = 0;
    let apres = null;
    if (iso(curseur)) {
      const c = decoderCurseur(curseur);
      const i = c ? jours.indexOf(c.j) : -1;
      if (i < 0) {
        return { ok: false, status: 422, errors: [{ code: 'curseur_invalide', message: 'Ce curseur ne correspond pas à la fenêtre demandée.' }] };
      }
      depart = i;
      apres = c.a;
    }

    // DEUX journaux, un seul écran : les gestes d'administration vivent dans la
    // table admin, les mouvements d'argent dans la table principale (la Lambda
    // publique n'a pas accès à la première). Un auditeur ne doit pas avoir à
    // savoir ça — on fusionne, on dédoublonne par id, on trie.
    const portes = ['queryAuditByDay', 'queryTxAuditByDay'];
    const entrees = [];
    let suivant = null;
    let ouvertes = 0;
    for (let i = depart; i < jours.length; i += 1) {
      // Deux raisons de rendre la main AVANT d'ouvrir une partition de plus :
      // la page est pleine, ou cette requête a déjà ouvert son quota de
      // partitions. La seconde est ce qui empêche un filtre très sélectif sur
      // un trimestre de devenir une seule requête interminable.
      if (entrees.length >= parPage || ouvertes >= AUDIT_JOURS_PAR_PAGE) {
        suivant = encoderCurseur({ j: jours[i], a: null });
        break;
      }
      ouvertes += 1;
      const liste = await entreesDuJour(jours[i], portes);
      // `apres` ne vaut que pour la partition où le curseur reprend.
      const ancre = i === depart ? apres : null;
      // ET SI L'ANCRE A DISPARU ? Une entrée reprise par le TTL entre deux
      // pages, et la boucle « saute jusqu'à » ne trouverait jamais son repère :
      // elle passerait la journée ENTIÈRE en silence. Dans un journal d'audit,
      // un doublon visible vaut infiniment mieux qu'une omission muette — on
      // repart donc du haut du jour.
      const ancreVue = ancre ? liste.some((e) => cleAudit(e) === ancre) : true;
      let vu = !(ancre && ancreVue);
      let derniere = ancreVue ? ancre : null;
      for (const e of liste) {
        const cle = cleAudit(e);
        if (!vu) {
          if (cle === ancre) vu = true;
          continue;
        }
        if (entrees.length >= parPage) {
          suivant = encoderCurseur({ j: jours[i], a: derniere });
          break;
        }
        // La clé avance sur CHAQUE entrée examinée, filtrée ou non : reprendre
        // après la dernière RETENUE ferait relire (et refiltrer) tout ce qui
        // suivait, à chaque page.
        derniere = cle;
        if (!correspondActeur(e, qActeur) || !correspondSujet(e, qSujet)) continue;
        entrees.push(e);
      }
      if (suivant) break;
    }

    return { ok: true, jour: finISO, du: debutISO, au: finISO, entrees, curseur: suivant };
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
    'leads:read': ['Lire le CRM et les leads', 'Read the CRM and leads'],
    'leads:write': ['Modifier les étapes et relances CRM', 'Edit CRM stages and follow-ups'],
    'pii:read': ['Voir les renseignements personnels', 'See personal information'],
    'moderation:write': ['Modérer les offres et les notaires', 'Moderate offers and notaries'],
    'settings:write': ['Modifier les réglages du produit', 'Change product settings'],
    'users:read': ['Voir les utilisateurs', 'See users'],
    'users:write': ['Attribuer groupes et permissions', 'Assign groups and permissions'],
    'cabinets:read': ['Voir les cabinets et leurs forfaits', 'See practices and plans'],
    'cabinets:write': ['Gérer les cabinets, forfaits et membres', 'Manage practices, plans and members'],
    'groups:read': ['Voir les groupes', 'See groups'],
    'groups:write': ['Créer et modifier les groupes', 'Create and edit groups'],
    'permissions:read': ['Lire le catalogue des permissions', 'Read the permission catalog'],
    'notifications:write': ['Modifier les courriels et notifications', 'Edit emails and notifications'],
    'billing:write': ['Configurer le paiement et le prix', 'Configure payment and price'],
    'audit:read': ['Lire le journal d’audit', 'Read the audit log'],
    'campaigns:send': ['Envoyer une campagne ciblée', 'Send a targeted campaign'],
    'audiences:read': ['Voir les groupes d’audience', 'See audience groups'],
    'audiences:write': ['Modifier les groupes d’audience', 'Edit audience groups'],
    'subjects:read': ['Ouvrir le dossier d’une personne', 'Open a person’s file'],
    'subjects:erase': ['Effacer le dossier d’une personne', 'Erase a person’s file'],
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

  // Read-only catalogue inventory. `analytics:read` is used because this is
  // product metadata, not customer PII; a super_admin still receives it via
  // the wildcard. The effective Nota price is resolved through the same
  // configuration path as `/admin/prix`, so the cards cannot show stale prices.
  async function getCatalogue(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'analytics:read')) {
      return refuserAcces(p, { porte: 'getCatalogue', permission: 'analytics:read', ip, message: 'Lecture du catalogue des services non autorisée.' });
    }
    const grille = await prixCfg.resolveGrille(repo, process.env);
    return { ok: true, catalogue: domain.catalogueSnapshot({ grille }) };
  }

  // The feature map is deliberately separate from the service catalogue: an
  // operator needs to see both "what we sell" and "what the platform does".
  // It carries no secrets and no personal data.
  async function getFeatures(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'analytics:read')) {
      return refuserAcces(p, { porte: 'getFeatures', permission: 'analytics:read', ip, message: 'Lecture de l’inventaire des fonctionnalités non autorisée.' });
    }
    // L'inventaire lit l'environnement DE CE DÉPLOIEMENT : la même console
    // qui dit « Stripe inactif » dans Paiements ne peut plus dire « actif » ici.
    return { ok: true, ...featureSnapshot(env) };
  }

  const GROUP_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
  const NAME_MAX = 80;
  const PERMISSION_GROUP_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

  function validatePermissionGroup(id, payload = {}) {
    const errors = [];
    if (!PERMISSION_GROUP_ID.test(String(id || ''))) {
      errors.push({ code: 'identifiant_invalide', message: 'L’identifiant doit être en minuscules, sans espace (lettres, chiffres, - et _), 40 caractères au plus.' });
    }
    const nom = typeof payload.nom === 'string' ? payload.nom.trim() : '';
    if (!nom || nom.length > NAME_MAX) {
      errors.push({ code: 'nom_invalide', message: `Le nom du groupe de permissions est obligatoire et fait au plus ${NAME_MAX} caractères.` });
    }
    const perms = Array.isArray(payload.permissions) ? payload.permissions : [];
    for (const p of perms) {
      if (p === rbac.WILDCARD) {
        errors.push({ code: 'joker_interdit', message: 'Le joker « * » ne s’accorde pas à un groupe de permissions.' });
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
    const permissionGroupIds = Array.isArray(payload.groupesPermissions)
      ? payload.groupesPermissions
      : (Array.isArray(payload.permissionGroups) ? payload.permissionGroups : []);
    for (const permissionGroupId of permissionGroupIds) {
      if (!PERMISSION_GROUP_ID.test(String(permissionGroupId || ''))) {
        errors.push({ code: 'groupe_permissions_invalide', message: `Le groupe de permissions « ${permissionGroupId} » est invalide.` });
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
        groupesPermissions: [...new Set(permissionGroupIds.map((id) => String(id)))],
      },
    };
  }

  async function listPermissionGroups() {
    const groupes = typeof repo.listPermissionGroups === 'function' ? await repo.listPermissionGroups() : [];
    return { ok: true, groupes };
  }

  async function putPermissionGroup(id, payload, { actor } = {}) {
    const v = validatePermissionGroup(id, payload);
    if (!v.ok) return v;
    const avant = typeof repo.getPermissionGroup === 'function' ? await repo.getPermissionGroup(id) : null;
    const groupe = await repo.putPermissionGroup(v.groupe, clockIso());
    await appendAudit('groupe_permissions_modifie', { email: actor || null, meta: { groupeId: String(id), avant, apres: groupe } });
    return { ok: true, errors: [], groupe };
  }

  async function deletePermissionGroup(id, { actor } = {}) {
    const avant = typeof repo.getPermissionGroup === 'function' ? await repo.getPermissionGroup(id) : null;
    if (!avant) return { ok: false, errors: [{ code: 'groupe_permissions_introuvable', message: 'Ce groupe de permissions n’existe pas.' }] };
    const groupes = typeof repo.listGroups === 'function' ? await repo.listGroups() : [];
    const utilisePar = groupes.filter((g) => (g.groupesPermissions || g.permissionGroups || []).includes(String(id)));
    if (utilisePar.length) {
      return {
        ok: false,
        code: 'groupe_permissions_utilise',
        errors: [{ code: 'groupe_permissions_utilise', message: `Retirez d’abord ce groupe de permissions de ${utilisePar.length} groupe(s) d’utilisateurs.` }],
      };
    }
    await repo.deletePermissionGroup(id);
    await appendAudit('groupe_permissions_supprime', { email: actor || null, meta: { groupeId: String(id), avant, apres: null } });
    return { ok: true, errors: [] };
  }

  async function listGroups() {
    const groupes = typeof repo.listGroups === 'function' ? await repo.listGroups() : [];
    return { ok: true, groupes: groupes.map((g) => ({ ...g, groupesPermissions: g.groupesPermissions || g.permissionGroups || [] })) };
  }

  async function putGroup(id, payload, { actor } = {}) {
    const avant = typeof repo.getGroup === 'function' ? await repo.getGroup(id) : null;
    const incoming = {
      ...(avant || {}),
      ...(payload || {}),
      ...(payload && payload.groupesPermissions === undefined && payload.permissionGroups === undefined && avant
        ? { groupesPermissions: avant.groupesPermissions || avant.permissionGroups || [] }
        : {}),
    };
    const v = validateGroup(id, incoming);
    if (!v.ok) return v;
    if (typeof repo.getPermissionGroup === 'function') {
      for (const permissionGroupId of v.groupe.groupesPermissions) {
        const permissionGroup = await repo.getPermissionGroup(permissionGroupId);
        if (!permissionGroup) {
          return {
            ok: false,
            errors: [{ code: 'groupe_permissions_introuvable', message: `Le groupe de permissions « ${permissionGroupId} » n’existe pas.` }],
          };
        }
      }
    }
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
  // CABINETS — organisations commerciales distinctes des groupes RBAC.
  // Un cabinet possède plusieurs profils de notaires et un forfait commercial;
  // cela ne donne par lui-même aucun droit dans la console d'administration.
  // ---------------------------------------------------------------------------
  const CABINET_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
  const CABINET_STATUSES = new Set(['prospect', 'actif', 'suspendu']);

  function cabinetView(cabinet) {
    const plan = domain.cabinetPlan(cabinet.planId);
    return {
      ...cabinet,
      notaires: [...(cabinet.notaires || [])],
      plan: plan ? domain.cabinetPlanPublic(plan) : null,
    };
  }

  async function cabinetMembers(ids) {
    const out = [];
    for (const id of ids || []) {
      const n = typeof repo.getNotary === 'function' ? await repo.getNotary(id) : null;
      out.push({ id: String(id), email: n && n.email ? n.email : null, etude: n ? domain.notaryEtude(n) : null, statut: n ? (n.status || null) : null });
    }
    return out;
  }

  function validateCabinet(id, payload = {}, existing = null) {
    const errors = [];
    if (!CABINET_ID.test(String(id || ''))) errors.push({ code: 'identifiant_invalide', message: 'L’identifiant du cabinet doit être en minuscules, sans espace (40 caractères au plus).' });
    const nom = typeof payload.nom === 'string' ? payload.nom.trim() : '';
    if (!nom || nom.length > NAME_MAX) errors.push({ code: 'nom_invalide', message: `Le nom du cabinet est obligatoire et fait au plus ${NAME_MAX} caractères.` });
    const planId = payload.planId === undefined ? (existing && existing.planId) : String(payload.planId || '');
    if (!domain.cabinetPlan(planId)) errors.push({ code: 'forfait_invalide', message: 'Le forfait du cabinet est inconnu.' });
    const statut = payload.statut === undefined ? ((existing && existing.statut) || 'prospect') : String(payload.statut || '');
    if (!CABINET_STATUSES.has(statut)) errors.push({ code: 'statut_invalide', message: 'Le statut doit être prospect, actif ou suspendu.' });
    const contact = payload.contactEmail === undefined ? ((existing && existing.contactEmail) || '') : String(payload.contactEmail || '').trim().toLowerCase();
    if (contact && !domain.isEmail(contact)) errors.push({ code: 'courriel_invalide', message: 'Le courriel de contact du cabinet est invalide.' });
    const prix = payload.prixMensuelCents === undefined ? ((existing && existing.prixMensuelCents) ?? null) : payload.prixMensuelCents;
    if (prix !== null && (!Number.isSafeInteger(Number(prix)) || Number(prix) < 0)) errors.push({ code: 'prix_invalide', message: 'Le prix mensuel doit être un nombre entier de cents positif ou nul.' });
    const sieges = payload.siegesInclus === undefined ? ((existing && existing.siegesInclus) ?? null) : payload.siegesInclus;
    if (sieges !== null && (!Number.isSafeInteger(Number(sieges)) || Number(sieges) < 1)) errors.push({ code: 'sieges_invalides', message: 'Le nombre de sièges inclus doit être un entier positif ou nul.' });
    const notaires = payload.notaires === undefined ? ((existing && existing.notaires) || []) : payload.notaires;
    if (!Array.isArray(notaires)) errors.push({ code: 'notaires_invalides', message: 'Les membres du cabinet doivent être une liste de notaires.' });
    const membres = [...new Set((notaires || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (membres.some((id) => id.length > 120)) errors.push({ code: 'notaire_invalide', message: 'Un identifiant de notaire est trop long.' });
    if (domain.cabinetPlan(planId) && !domain.cabinetPlan(planId).multiNotaires && membres.length > 1) {
      errors.push({ code: 'forfait_sans_equipe', message: 'Le forfait Indépendant ne peut contenir qu’un notaire.' });
    }
    if (errors.length) return { ok: false, errors };
    return {
      ok: true,
      errors: [],
      cabinet: {
        id: String(id), nom, planId, statut, contactEmail: contact || null,
        prixMensuelCents: prix === null ? null : Number(prix),
        siegesInclus: sieges === null ? null : Number(sieges),
        notaires: membres,
        notes: typeof payload.notes === 'string' ? payload.notes.trim().slice(0, 500) : ((existing && existing.notes) || ''),
      },
    };
  }

  async function listCabinets(token, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'cabinets:read')) return refuserAcces(p, { porte: 'listCabinets', permission: 'cabinets:read', ip, message: 'Lecture des cabinets non autorisée.' });
    const records = typeof repo.listCabinets === 'function' ? await repo.listCabinets() : [];
    const plans = domain.CABINET_PLANS.map(domain.cabinetPlanPublic);
    const cabinets = [];
    for (const cabinet of records) cabinets.push({ ...cabinetView(cabinet), membres: await cabinetMembers(cabinet.notaires || []) });
    return { ok: true, cabinets, plans };
  }

  async function putCabinet(token, id, payload = {}, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'cabinets:write')) return refuserAcces(p, { porte: 'putCabinet', permission: 'cabinets:write', ip, message: 'Modification des cabinets non autorisée.' });
    const avant = typeof repo.getCabinet === 'function' ? await repo.getCabinet(id) : null;
    const v = validateCabinet(id, payload, avant);
    if (!v.ok) return { ok: false, status: 422, errors: v.errors };
    for (const notaryId of v.cabinet.notaires) {
      if (typeof repo.getNotary === 'function' && !(await repo.getNotary(notaryId))) {
        return { ok: false, status: 422, errors: [{ code: 'notaire_introuvable', message: `Le notaire « ${notaryId} » n’existe pas.` }] };
      }
    }
    const cabinets = typeof repo.listCabinets === 'function' ? await repo.listCabinets() : [];
    for (const other of cabinets) {
      if (other.id === String(id)) continue;
      const overlap = v.cabinet.notaires.filter((notaryId) => (other.notaires || []).includes(notaryId));
      if (overlap.length) return { ok: false, status: 409, errors: [{ code: 'notaire_deja_dans_cabinet', message: `Un notaire est déjà rattaché au cabinet « ${other.nom} ».` }] };
    }
    const cabinet = await repo.putCabinet(v.cabinet, clockIso());
    await appendAudit('cabinet_modifie', { adminId: p.adminId, email: p.email, ip, meta: { cabinetId: String(id), avant, apres: cabinet } });
    return { ok: true, cabinet: { ...cabinetView(cabinet), membres: await cabinetMembers(cabinet.notaires) } };
  }

  async function deleteCabinet(token, id, { ip } = {}) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { ok: false, status: 401 };
    if (!rbac.can(p.permissions, 'cabinets:write')) return refuserAcces(p, { porte: 'deleteCabinet', permission: 'cabinets:write', ip, message: 'Modification des cabinets non autorisée.' });
    const avant = typeof repo.getCabinet === 'function' ? await repo.getCabinet(id) : null;
    if (!avant) return { ok: false, status: 404, errors: [{ code: 'cabinet_introuvable', message: 'Ce cabinet n’existe pas.' }] };
    if ((avant.notaires || []).length) return { ok: false, status: 409, errors: [{ code: 'cabinet_non_vide', message: 'Retirez d’abord les notaires avant de supprimer le cabinet.' }] };
    await repo.deleteCabinet(id);
    await appendAudit('cabinet_supprime', { adminId: p.adminId, email: p.email, ip, meta: { cabinetId: String(id), avant, apres: null } });
    return { ok: true };
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
      return refuserAcces(p, { porte: 'listAudienceGroups', permission: 'audiences:read', ip, message: 'Lecture des groupes d’audience non autorisée.' });
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
      return refuserAcces(p, { porte: 'putAudienceGroup', permission: 'audiences:write', ip, message: 'Modification des groupes d’audience non autorisée.' });
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
      return refuserAcces(p, { porte: 'deleteAudienceGroup', permission: 'audiences:write', ip, message: 'Modification des groupes d’audience non autorisée.' });
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
        groupesPermissions: [...new Set(charges.flatMap((g) => g.groupesPermissions || g.permissionGroups || []))],
        effectives: await effectivePermissions(rec || { role: null, permissions: [], groupes: [] }, null),
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
      return refuserAcces(p, { porte: 'listSegments', permission: 'analytics:read', ip, message: 'Lecture des segments non autorisée.' });
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
      return refuserAcces(p, { porte: 'previewCampaign', permission: 'analytics:read', ip, message: 'Lecture des campagnes non autorisée.' });
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
      return refuserAcces(p, { porte: 'sendCampaign', permission: 'campaigns:send', ip, message: 'Envoi de campagnes non autorisé.' });
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
      return refuserAcces(p, { porte: 'listCampaignRecipients', permission: 'analytics:read', ip, message: 'Lecture des campagnes non autorisée.' });
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
      return refuserAcces(p, { porte: 'listCampaigns', permission: 'analytics:read', ip, message: 'Lecture des campagnes non autorisée.' });
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

  // ===========================================================================
  // RÉGION « USAGERS » — le dossier d'une personne (Loi 25, art. 27 et 28)
  // ===========================================================================
  //
  // L'audit du 2026-09-05 : aucune route, aucun écran n'ouvrait UNE personne. Un
  // opérateur ne pouvait pas répondre à « que détenez-vous sur moi ? », qui est
  // la première question que la Loi 25 donne à tout résident du Québec. Trois
  // portes le font maintenant : LIRE le dossier, l'EXPORTER, l'EFFACER.
  //
  // LA COLONNE VERTÉBRALE EST L'INDEX, PAS UN BALAYAGE. Les offres se rangent
  // par mois ; retrouver une personne sans index demanderait un Scan, que le
  // rôle IAM de la console refuse — et à juste titre. Le pointeur
  // CLIENT#<courriel> existait dans les deux adaptateurs, testé, avec ses
  // commentaires disant qu'il rend une demande d'accès « exécutable », et sans
  // aucun appelant : ni lecteur ICI, ni écrivain dans `handler.js`. Il est
  // désormais écrit à la publication et lu ici, par une Query bornée.
  //
  // DEUX PERMISSIONS, ET `pii:read` PAR-DESSUS. `subjects:read` ouvre le
  // dossier ; `subjects:erase` autorise à détruire — jamais un corollaire de la
  // lecture. Sans `pii:read`, tout ce qui NOMME est masqué exactement comme au
  // registre des destinataires de campagne : reconnaissable, jamais expédiable.

  // Ce qu'un dossier retient d'une offre. Deux projections : la nominative, et
  // celle où tout ce qui désigne une personne est retiré. Le masque n'est pas un
  // formatage, c'est une frontière — d'où une SEULE fonction qui construit les
  // deux, pour qu'un champ ajouté ne puisse pas fuir en oubliant le masque.
  function offreDuDossier(bid, acte, avis, enClair) {
    const masque = (v) => (enClair ? v ?? null : v == null ? null : '•••');
    return {
      id: bid.id,
      dateISO: bid.dateISO,
      serviceId: bid.serviceId,
      montant: Number(bid.montant) || 0,
      statut: bid.status || null,
      createdAt: bid.createdAt || null,
      anonyme: bid.anonyme !== false,
      // Nominatif : masqué sans `pii:read`.
      nom: masque(bid.nom),
      telephone: masque(bid.telephone),
      // Le secteur postal, lui, N'EST PAS masqué — et c'est délibéré : le
      // carnet PUBLIC l'affiche sur chaque offre. Le cacher dans une console
      // interne serait du théâtre, et pire, ferait croire à l'opérateur que
      // Nota le garde secret alors que le site l'expose à tout le monde.
      prefixe: bid.prefixe || null,
      // Le dossier d'intake et les réponses de tarification SONT des
      // renseignements personnels (« le document confondu avec la démarche ») :
      // sans `pii:read` on ne les résume même pas, on les retire.
      dossier: enClair ? bid.dossier || null : null,
      pricing: enClair ? bid.pricing || null : null,
      // L'argent : ce que le client a payé, et ce que l'acte a réglé.
      paiement: {
        statut: bid.paymentStatus || null,
        prixNotaServiceCents: bid.prixNotaServiceCents == null ? null : Number(bid.prixNotaServiceCents),
        prixNotaDateCents: bid.prixNotaDateCents == null ? null : Number(bid.prixNotaDateCents),
      },
      acte: acte
        ? { regleLe: acte.at || acte.completedAt || null, montant: Number(acte.actAmount) || null, paye: acte.paye === true }
        : null,
      // LA MESSAGERIE DE L'ACTE RETENU vit DANS l'offre. Un COMPTE ne suffit
      // pas : l'art. 27 donne accès aux renseignements eux-mêmes, et une
      // conversation entre le client et son notaire en est. On rend donc le
      // contenu — derrière `pii:read`, comme le nom et le téléphone — et le
      // compte reste lisible sans, pour qu'un opérateur sache qu'il existe une
      // conversation qu'il n'a pas le droit de lire.
      messagesCount: Array.isArray(bid.messages) ? bid.messages.length : 0,
      messages: enClair
        ? (Array.isArray(bid.messages) ? bid.messages : []).map((m) => ({
            id: m.id || null,
            de: m.de || null,
            texte: m.texte == null ? null : String(m.texte),
            createdAt: m.createdAt || null,
          }))
        : null,
      notaryId: bid.notaryId || null,
      avis: avis.map((a) => ({ id: a.id, kind: a.kind, titre: a.titre, at: a.at, luLe: a.luLe || null })),
      // Ce que la politique promet pour CETTE offre, en clair.
      conservationJusqua: bid.ttl ? new Date(Number(bid.ttl) * 1000).toISOString().slice(0, 10) : null,
      efface: bid.efface === true,
      effaceLe: bid.effaceLe || null,
    };
  }

  // Le sujet nommé dans le JOURNAL D'AUDIT. Jamais l'adresse en clair : le
  // journal se lit avec `audit:read`, délibérément distinct de `pii:read`, et en
  // faire un second annuaire d'adresses défierait ce découplage. Une empreinte
  // suffit à corréler deux gestes sur la même personne.
  const empreinteSujet = (email) =>
    require('node:crypto').createHash('sha256').update(String(email || '')).digest('hex').slice(0, 16);

  // Les registres que le dossier interroge, et — tout aussi important — ceux
  // qu'il ne peut PAS encore joindre par sujet. Un dossier qui tait ce qu'il n'a
  // pas regardé ment par omission : l'opérateur croirait avoir tout vu.
  function sourcesDuDossier({ joursLus, joursOmis } = {}) {
    return [
      { famille: 'offre', joignable: true, note: null },
      { famille: 'acte', joignable: true, note: null },
      { famille: 'avis', joignable: true, note: null },
      { famille: 'consentement', joignable: true, note: null },
      { famille: 'desabonnement', joignable: true, note: null },
      { famille: 'journal_sujet', joignable: true, note: null },
      { famille: 'effacement', joignable: true, note: null },
      {
        famille: 'journal_audit',
        // Joignable, mais PARTIELLEMENT — et une lecture partielle qui se
        // présente comme complète est le mensonge que cette liste existe pour
        // empêcher. La fenêtre lue est donc CHIFFRÉE, et une troncature est
        // annoncée : un opérateur qui instruit une demande d'accès doit savoir
        // si le journal qu'il montre est tout le journal.
        joignable: !joursOmis,
        note:
          'Le journal est partitionné par JOUR, pas par personne : seules les journées touchées par ses offres sont relues (' +
          (joursLus || 0) +
          '), et seules les entrées qui nomment une de ces offres sont retenues.' +
          (joursOmis ? ' ' + joursOmis + ' journée(s) plus anciennes n’ont PAS été relues : la lecture est bornée.' : ''),
      },
      {
        famille: 'fil_soutien',
        joignable: false,
        note: 'Les conversations de soutien sont indexées par MOIS, jamais par adresse : elles ne peuvent pas encore être jointes à une personne sans parcourir chaque mois.',
      },
      {
        famille: 'destinataire_campagne',
        joignable: false,
        note: 'Le registre des destinataires est partitionné par CAMPAGNE : il répond à « qui a reçu la campagne X », jamais à « quelles campagnes cette personne a-t-elle reçues ».',
      },
    ];
  }

  // Les journées d'audit qu'il vaut la peine de relire pour cette personne : la
  // création de chaque offre, sa date de signature, et le règlement de son acte.
  // BORNÉ — un dossier ne doit jamais devenir un balayage du journal.
  // Chaque journée coûte QUATRE Query (deux partitions — le jour civil de Québec
  // chevauche deux jours UTC — sur deux journaux). La borne est donc basse, et
  // ce qui tombe est le passé le plus lointain : on garde ce qui est vivant.
  const AUDIT_JOURS_MAX = 12;
  function joursDAudit(offres, actes) {
    const jours = new Set();
    for (const o of offres) {
      for (const d of [o.createdAt, o.dateISO]) {
        const j = String(d || '').slice(0, 10);
        if (domain.isISODate(j)) jours.add(j);
      }
    }
    for (const a of actes) {
      const j = String((a && (a.at || a.completedAt)) || '').slice(0, 10);
      if (domain.isISODate(j)) jours.add(j);
    }
    // Rendu ENTIER : c'est l'appelant qui borne, pour qu'il puisse dire
    // combien de journées il a laissées de côté.
    return [...jours].sort();
  }

  // Le dossier ASSEMBLÉ. Une fonction interne : les trois portes publiques
  // (lire, exporter, effacer) partent toutes d'ici, pour qu'aucune ne puisse
  // voir une personne différente des deux autres.
  async function assemblerDossier(adresse, enClair) {
    const pointeurs = typeof repo.listClientBids === 'function' ? await repo.listClientBids(adresse) : [];

    const offres = [];
    const actes = [];
    for (const p of pointeurs) {
      const bid = await repo.get(p.bidId, p.dateISO);
      if (!bid) continue;
      offres.push(bid);
      const acte = typeof repo.getActCompletion === 'function' ? await repo.getActCompletion(bid.id) : null;
      actes.push(acte);
    }

    // Les avis du client sont rangés sous le HACHÉ de son offre (keys.js) : le
    // dossier les retrouve offre par offre, sans jamais manipuler un jeton.
    const avisParOffre = [];
    for (const bid of offres) {
      let avis = [];
      if (typeof repo.listNotifications === 'function') {
        try {
          avis = await repo.listNotifications(clientNotifSubject(bid.id));
        } catch {
          avis = [];
        }
      }
      avisParOffre.push(avis);
    }

    const consentement = typeof repo.getEmailConsent === 'function' ? await repo.getEmailConsent(adresse) : null;
    const journalConsentement = typeof repo.listConsentEvents === 'function' ? await repo.listConsentEvents(adresse) : [];
    const desabonne = typeof repo.isUnsubscribed === 'function' ? !!(await repo.isUnsubscribed(adresse)) : false;
    let journalEnvois = [];
    if (typeof repo.listSubjectEvents === 'function') {
      try {
        journalEnvois = await repo.listSubjectEvents(adresse);
      } catch {
        journalEnvois = [];
      }
    }
    const effacement = typeof repo.getErasure === 'function' ? await repo.getErasure(adresse) : null;

    // Le journal d'audit, borné aux journées que ses offres ont touchées et
    // filtré sur les identifiants d'offre : le journal PUBLIC nomme une offre,
    // jamais une personne, donc c'est par l'offre qu'on le rejoint.
    const ids = new Set(offres.map((o) => o.id));
    const journalAudit = [];
    const tousLesJours = joursDAudit(offres, actes);
    const joursRetenus = tousLesJours.slice(-AUDIT_JOURS_MAX);
    for (const j of joursRetenus) {
      for (const e of await entreesDuJour(j, ['queryAuditByDay', 'queryTxAuditByDay'])) {
        const m = (e && e.meta) || {};
        const cible = m.bidId || m.refId || (e && e.acteur && e.acteur.id);
        if (cible && ids.has(cible)) journalAudit.push({ id: e.id, ts: e.ts, action: e.action, meta: m });
      }
    }

    return {
      courriel: enClair ? adresse : masquerCourriel(adresse),
      enClair,
      offres: offres.map((bid, i) => offreDuDossier(bid, actes[i], avisParOffre[i], enClair)),
      consentement: consentement ? { base: consentement.base || null, at: consentement.at || null } : null,
      journalConsentement: journalConsentement.map((e) => ({ at: e.at || null, base: e.base || null, source: e.source || null })),
      desabonne,
      journalEnvois: journalEnvois.map((e) => ({ at: e.at || null, kind: e.kind || null, templateKey: e.templateKey || null })),
      journalAudit,
      effacement: effacement ? { at: effacement.at || null } : null,
      sources: sourcesDuDossier({
        joursLus: joursRetenus.length,
        joursOmis: tousLesJours.length - joursRetenus.length,
      }),
      // Les offres BRUTES ne sortent jamais d'ici : l'effacement en a besoin
      // pour écrire, la réponse HTTP ne doit jamais les voir.
      _brutes: offres,
      _actes: actes,
    };
  }

  // Une adresse est une CLÉ : elle se normalise, et le vide se refuse plutôt que
  // d'ouvrir la partition de personne.
  function sujetDemande(courriel) {
    const clean = String(courriel == null ? '' : courriel).trim().toLowerCase();
    if (!clean || clean.indexOf('@') <= 0) {
      return { error: { ok: false, status: 422, errors: [{ code: 'courriel_invalide', message: 'Une adresse courriel est requise pour ouvrir un dossier.' }] } };
    }
    return { adresse: clean };
  }

  // La garde commune aux trois portes — l'identité et le sujet, PAS la
  // permission. Chaque porte applique la sienne, en toutes lettres, chez elle :
  // une permission passée en VARIABLE devient invisible à l'audit
  // « publié == appliqué » (admin-permissions-gate.test.mjs), qui relit le code
  // à la recherche de `rbac.can(…, 'clé')`. C'est exactement ainsi que
  // `billing:write` est resté publié sans qu'aucune route ne l'applique.
  const interditUsager = (garde, porte, permission, courriel, ip) =>
    refuserAcces(garde.p, { porte, permission, sujet: courriel, ip, message: 'Dossier d’usager non autorisé.' });

  // La session se résout UNE SEULE FOIS par requête. Deux résolutions, c'est
  // deux lectures d'identité, deux lectures de session, et surtout DEUX
  // glissements de la fenêtre d'inactivité pour un seul geste — une session
  // inactive vivrait plus longtemps que ce que la console annonce.
  async function porteUsager(token, ip) {
    const p = await requireAdmin(token, { ip });
    if (!p) return { error: { ok: false, status: 401 } };
    return { p, enClair: rbac.can(p.permissions, 'pii:read') };
  }

  // Ce qui sort d'un dossier assemblé, une fois les champs internes retirés.
  const dossierPublic = ({ _brutes, _actes, ...reste }) => reste;

  // --- 1. LIRE ---------------------------------------------------------------
  //
  // LA LECTURE LAISSE UNE TRACE, AU MÊME TITRE QUE L'EXPORT. Elle n'en laissait
  // aucune, et l'export en laissait une : or les deux portes rendent LE MÊME
  // dossier — nom, téléphone, dossier d'intake, conversation avec le notaire.
  // Tracer la seconde seulement rendait la trace facultative : il suffisait
  // d'ouvrir le dossier au lieu de l'exporter pour lire la même chose sans
  // laisser de trace. Le motif écrit pour l'export vaut mot pour mot ici : un
  // accès qu'on ne peut pas reprocher n'est pas un accès surveillé.
  //
  // Le sujet est nommé par une EMPREINTE, comme partout dans cette région : le
  // journal se lit avec `audit:read`, délibérément distinct de `pii:read`, et il
  // ne doit pas devenir un second annuaire d'adresses.
  async function getUserFile(token, courriel, { ip } = {}) {
    const garde = await porteUsager(token, ip);
    if (garde.error) return garde.error;
    if (!rbac.can(garde.p.permissions, 'subjects:read')) return interditUsager(garde, 'getUserFile', 'subjects:read', courriel, ip);
    const sujet = sujetDemande(courriel);
    if (sujet.error) return sujet.error;
    const dossier = await assemblerDossier(sujet.adresse, garde.enClair);
    await appendAudit('dossier_usager_consulte', {
      adminId: garde.p.adminId,
      email: garde.p.email,
      ip,
      meta: {
        sujet: empreinteSujet(sujet.adresse),
        // `enClair` dit si l'opérateur a VU les valeurs nominatives ou leur
        // masque : sans lui, deux accès très différents se lisent pareil.
        enClair: garde.enClair,
        offres: dossier.offres.length,
      },
    });
    return { ok: true, ...dossierPublic(dossier) };
  }

  // --- 2. EXPORTER (droit à la portabilité) ----------------------------------
  // Le même dossier, dans une enveloppe VERSIONNÉE et datée, avec la politique
  // de conservation qui l'accompagne : la personne doit pouvoir lire combien de
  // temps chaque chose est gardée sans avoir à le redemander.
  //
  // Un export laisse une trace — c'est un geste sur des renseignements
  // personnels, et il doit pouvoir être reproché.
  const EXPORT_FORMAT = 'nota.dossier-usager.v1';

  async function exportUserFile(token, courriel, { ip } = {}) {
    const garde = await porteUsager(token, ip);
    if (garde.error) return garde.error;
    if (!rbac.can(garde.p.permissions, 'subjects:read')) return interditUsager(garde, 'exportUserFile', 'subjects:read', courriel, ip);
    const sujet = sujetDemande(courriel);
    if (sujet.error) return sujet.error;
    const dossier = await assemblerDossier(sujet.adresse, garde.enClair);
    const genereLe = clockIso();
    await appendAudit('dossier_usager_exporte', {
      adminId: garde.p.adminId,
      email: garde.p.email,
      ip,
      meta: {
        sujet: empreinteSujet(sujet.adresse),
        enClair: garde.enClair,
        offres: dossier.offres.length,
        format: EXPORT_FORMAT,
      },
    });
    return {
      ok: true,
      format: EXPORT_FORMAT,
      genereLe,
      genereePar: garde.p.email || null,
      courriel: dossier.courriel,
      enClair: garde.enClair,
      dossier: dossierPublic(dossier),
      conservation: domain.retentionPolicy(process.env),
    };
  }

  // --- 3. EFFACER (Loi 25, art. 28) ------------------------------------------
  //
  // TROIS RÈGLES, ET AUCUNE N'EST NÉGOCIABLE :
  //
  //   1. ON PRÉVISUALISE AVANT DE DÉTRUIRE. Sans `confirmer`, la porte rend le
  //      PLAN et ne touche à rien — pas même à la marque.
  //   2. LA FRONTIÈRE EST AU DOMAINE. `domain.erasurePlan` décide ce qui part et
  //      ce qui reste ; cette fonction n'invente aucune règle, elle exécute.
  //   3. ON NE MENT JAMAIS SUR CE QU'ON A FAIT. Chaque offre effacée n'entre
  //      dans `effacees` qu'APRÈS une écriture réussie ; une écriture refusée
  //      la met dans `enAttente`, avec un avertissement.
  //
  // CE QUE CETTE PORTE NE PEUT PAS FAIRE SEULE, ET IL FAUT LE DIRE : en
  // production le rôle IAM de la console est en LECTURE SEULE sur la table
  // client (infra/admin.tf, `MainTableReadOnly`), avec des portes d'écriture
  // confinées par `dynamodb:LeadingKeys` à des partitions de CONFIGURATION. La
  // marque d'effacement demande donc une porte `ERASURE#*` (ajoutée dans
  // infra/admin.tf, `terraform apply` en attente) ; la RÉÉCRITURE des offres,
  // elle, vit dans des partitions `MONTH#` partagées par toute la clientèle —
  // les ouvrir à la console défairait l'isolement qui fait qu'elle ne peut pas
  // toucher un élément client. Tant que l'exécutant n'est pas la Lambda
  // publique, ces écritures-là remonteront en `enAttente`, jamais en « effacé ».
  async function eraseUserFile(token, courriel, { confirmer, ip } = {}) {
    const garde = await porteUsager(token, ip);
    if (garde.error) return garde.error;
    if (!rbac.can(garde.p.permissions, 'subjects:erase')) return interditUsager(garde, 'eraseUserFile', 'subjects:erase', courriel, ip);
    const sujet = sujetDemande(courriel);
    if (sujet.error) return sujet.error;
    const { adresse } = sujet;
    const p = garde.p;

    const dossier = await assemblerDossier(adresse, true);
    const at = clockIso();
    const plan = domain.erasurePlan({
      courriel: adresse,
      offres: dossier._brutes.map((b, i) => ({
        id: b.id,
        dateISO: b.dateISO,
        status: b.status || null,
        acteComplete: !!dossier._actes[i],
        regleLe: dossier._actes[i] ? dossier._actes[i].at || dossier._actes[i].completedAt || null : null,
      })),
      desabonne: dossier.desabonne,
      consentement: !!dossier.consentement,
      at,
    });

    if (confirmer !== true) {
      return { ok: true, execute: false, courriel: adresse, plan, effacees: [], enAttente: [], avertissement: null };
    }

    // Les identifiants que le PLAN autorise à effacer — et eux seuls.
    const autorisees = new Set(plan.efface.filter((l) => l.famille === 'offre').flatMap((l) => l.ids || []));
    const effacees = [];
    const enAttente = [];
    for (const bid of dossier._brutes) {
      if (!autorisees.has(bid.id)) continue;
      // Déjà effacée : ce n'est ni un succès à recompter ni un échec. La date du
      // premier effacement est un fait, pas un compteur qu'on repousse.
      if (bid.efface === true) continue;
      try {
        await repo.update(domain.redactedBid(bid, at));
        effacees.push(bid.id);
      } catch {
        enAttente.push(bid.id);
      }
    }

    // La marque : sans elle, rien ne distingue « nous avons effacé cette
    // personne » de « nous ne l'avons jamais connue ».
    let marque = null;
    let marqueEnAttente = false;
    try {
      marque = typeof repo.putErasure === 'function' ? await repo.putErasure(adresse, at) : null;
    } catch {
      marqueEnAttente = true;
    }

    await appendAudit('dossier_usager_efface', {
      adminId: p.adminId,
      email: p.email,
      ip,
      meta: {
        sujet: empreinteSujet(adresse),
        effacees,
        enAttente,
        marqueEnAttente,
        complet: plan.complet,
        conserve: plan.conserve.map((l) => ({ famille: l.famille, compte: (l.ids || []).length || l.compte || 0 })),
      },
    });

    const avertissement =
      enAttente.length || marqueEnAttente
        ? 'Une partie de l’effacement n’a PAS pu être écrite : la console est en lecture seule sur la table des clients. Ce qui reste est listé dans « en attente » — rien n’est annoncé comme effacé sans l’avoir été.'
        : null;

    return { ok: true, execute: true, courriel: adresse, plan, effacees, enAttente, marque, avertissement };
  }

  // --- CRM : faits first-party + état de travail opérateur ------------------
  // The source of truth for counts is the customer table's bounded MONTH#
  // partitions, joined to the write-once act ledger. CRM metadata is kept in
  // the admin table and is never allowed to change those customer facts.
  const crmUnavailable = () => ({
    ok: false,
    status: 503,
    errors: [{ code: 'crm_indisponible', message: 'Le CRM est momentanément indisponible.' }],
  });
  const maskEmail = (value) => value ? '••••@••••' : null;
  const maskName = (value) => value ? '••••' : null;
  const maskPhone = (value) => value ? '••••••' : null;

  function crmBidView(bid, workflow, completion, consent, enClair, todayISO) {
    const service = domain.serviceById(bid.serviceId);
    const readiness = domain.leadReadiness(bid.serviceId, bid.dossier || {}, bid.pricing);
    const manual = workflow && typeof workflow === 'object';
    const stageId = manual ? workflow.stage : crm.defaultStage({ bid, completed: completion !== null && !!completion });
    const stage = crm.stage(stageId) || crm.stage('nouveau');
    const followUp = manual ? workflow.nextFollowUpAt || null : null;
    const completedAt = completion && (completion.completedAt || completion.at || completion.regleLe) || null;
    return {
      bidId: bid.id,
      serviceId: bid.serviceId,
      serviceNom: service ? service.nom : bid.serviceId,
      serviceNomEn: service ? service.nomEn : bid.serviceId,
      dateISO: bid.dateISO,
      createdAt: bid.createdAt || null,
      bidStatus: bid.status || null,
      stage: stage.id,
      stageNom: stage.nom,
      stageNomEn: stage.nomEn,
      stageSource: manual ? 'manual' : 'derived',
      nom: enClair ? bid.nom || null : maskName(bid.nom),
      courriel: enClair ? bid.courriel || null : maskEmail(bid.courriel),
      telephone: enClair ? bid.telephone || null : maskPhone(bid.telephone),
      hasEmail: !!bid.courriel,
      hasTelephone: !!bid.telephone,
      consentement: consent ? { base: consent.base == null ? null : !!consent.base, at: consent.at || null } : null,
      acquisition: bid.acquisition || { version: 1, first: { source: 'unknown' }, last: { source: 'unknown' } },
      readiness: { ready: !!readiness.ready, done: readiness.done || 0, total: readiness.total || 0, missing: (readiness.missing || []).length },
      retainedAt: bid.retainedAt || null,
      completedAt,
      completionAvailable: completion !== null,
      note: enClair ? (manual ? workflow.note || '' : '') : null,
      nextFollowUpAt: followUp,
      revision: manual ? Number(workflow.revision) || 0 : 0,
      followUpOverdue: !!followUp && followUp <= todayISO && stage.id !== 'converti' && stage.id !== 'perdu',
    };
  }

  async function listCrmLeads(token, { from, to, stage, source, limit, ip } = {}) {
    const principal = await requireAdmin(token, { ip });
    if (!principal) return { ok: false, status: 401 };
    if (!rbac.can(principal.permissions, 'leads:read')) {
      return refuserAcces(principal, { porte: 'listCrmLeads', permission: 'leads:read', ip, message: 'Lecture du CRM non autorisée.' });
    }
    if (stage && !crm.stage(stage)) {
      return { ok: false, status: 422, errors: [{ code: 'etape_invalide', message: 'L’étape CRM est invalide.' }] };
    }
    const todayISO = clockIso().slice(0, 10);
    const requestedTo = domain.isISODate(to) ? to : todayISO;
    if ((from != null && !domain.isISODate(from)) || (to != null && !domain.isISODate(to)) || (from && from > requestedTo)) {
      return { ok: false, status: 422, errors: [{ code: 'periode_invalide', message: 'La période CRM est invalide.' }] };
    }
    const window = crm.dateWindow({ from, to, today: todayISO });
    if (domain.daysBetween(window.from, window.to) >= crm.RANGE_MAX_DAYS) {
      return { ok: false, status: 422, errors: [{ code: 'periode_trop_longue', message: `La période CRM doit couvrir au plus ${crm.RANGE_MAX_DAYS} jours.` }] };
    }
    const months = crm.monthsBetween(window.from, window.to);
    const max = Math.max(1, Math.min(500, Number(limit) || 100));
    let bids;
    try {
      if (typeof repo.listByMonth !== 'function') return crmUnavailable();
      const pages = await Promise.all(months.map((month) => repo.listByMonth(month, { consistentRead: true })));
      const seen = new Set();
      bids = pages.flat().filter((bid) => {
        if (!bid || !bid.id || seen.has(bid.id)) return false;
        seen.add(bid.id);
        return domain.isISODate(bid.dateISO) && bid.dateISO >= window.from && bid.dateISO <= window.to;
      });
      bids.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b.dateISO).localeCompare(String(a.dateISO)) || String(b.id).localeCompare(String(a.id)));
      const rows = await Promise.all(bids.map(async (bid) => {
        const workflow = typeof repo.getCrmLead === 'function' ? await repo.getCrmLead(bid.id) : null;
        const completion = typeof repo.getActCompletion === 'function' ? await repo.getActCompletion(bid.id, { consistentRead: true }) : null;
        const consent = typeof repo.getEmailConsent === 'function' && bid.courriel ? await repo.getEmailConsent(bid.courriel, { consistentRead: true }) : null;
        return crmBidView(bid, workflow, completion, consent, rbac.can(principal.permissions, 'pii:read'), todayISO);
      }));
      const filtered = rows.filter((row) => (!stage || row.stage === stage) && (!source || ((row.acquisition.last || {}).source || 'unknown') === source));
      const completedKnown = filtered.filter((row) => row.completedAt).length;
      const byStage = crm.STAGES.map((item) => {
        const inStage = filtered.filter((row) => row.stage === item.id);
        return { ...item, total: inStage.length, retained: inStage.filter((row) => row.retainedAt || row.bidStatus === domain.STATUS.RETENUE).length, completed: inStage.filter((row) => row.completedAt).length };
      });
      const sources = [...new Set(filtered.map((row) => ((row.acquisition.last || {}).source || 'unknown')))].sort();
      const bySource = sources.map((item) => {
        const inSource = filtered.filter((row) => ((row.acquisition.last || {}).source || 'unknown') === item);
        return { source: item, total: inSource.length, retained: inSource.filter((row) => row.retainedAt || row.bidStatus === domain.STATUS.RETENUE).length, completed: inSource.filter((row) => row.completedAt).length };
      });
      const retained = filtered.filter((row) => row.retainedAt || row.bidStatus === domain.STATUS.RETENUE).length;
      const summary = {
        total: filtered.length,
        contactables: filtered.filter((row) => row.hasEmail || row.hasTelephone).length,
        email: filtered.filter((row) => row.hasEmail).length,
        telephone: filtered.filter((row) => row.hasTelephone).length,
        consented: filtered.filter((row) => row.consentement && row.consentement.base === true).length,
        ready: filtered.filter((row) => row.readiness.ready).length,
        retained,
        completed: completedKnown,
        overdueFollowUps: filtered.filter((row) => row.followUpOverdue).length,
        byStage,
        bySource,
      };
      await appendAudit('crm_leads_read', { adminId: principal.adminId, email: principal.email, ip, meta: { from: window.from, to: window.to, stage: stage || null, source: source || null, count: filtered.length } });
      return {
        ok: true,
        leads: filtered.slice(0, max),
        stages: crm.STAGES,
        summary,
        range: { from: window.from, to: window.to, field: 'dateISO', months: months.length },
        dataQuality: { exact: true, source: 'persisted_bids_and_act_ledger', ga4: 'supplementary_only', completionAvailable: typeof repo.getActCompletion === 'function' },
      };
    } catch {
      return crmUnavailable();
    }
  }

  async function updateCrmLead(token, bidId, payload, { ip } = {}) {
    const principal = await requireAdmin(token, { ip });
    if (!principal) return { ok: false, status: 401 };
    if (!rbac.can(principal.permissions, 'leads:write')) {
      return refuserAcces(principal, { porte: 'updateCrmLead', permission: 'leads:write', ip, message: 'Écriture du CRM non autorisée.' });
    }
    const id = String(bidId || '').trim();
    const dateISO = payload && payload.dateISO;
    if (!id || !domain.isISODate(dateISO)) return { ok: false, status: 422, errors: [{ code: 'lead_invalide', message: 'Le lead et sa date sont invalides.' }] };
    if (typeof repo.get !== 'function' || typeof repo.getCrmLead !== 'function' || typeof repo.putCrmLead !== 'function') return crmUnavailable();
    let bid;
    try { bid = await repo.get(id, dateISO, { consistentRead: true }); } catch { return crmUnavailable(); }
    if (!bid) return { ok: false, status: 404, errors: [{ code: 'lead_introuvable', message: 'Le lead est introuvable.' }] };
    let current;
    try { current = await repo.getCrmLead(id); } catch { return crmUnavailable(); }
    let completion = null;
    try { completion = typeof repo.getActCompletion === 'function' ? await repo.getActCompletion(id, { consistentRead: true }) : null; } catch { return crmUnavailable(); }
    const canSeePii = rbac.can(principal.permissions, 'pii:read');
    const workflowPayload = canSeePii ? payload : { ...(payload || {}) };
    if (!canSeePii) delete workflowPayload.note;
    const patch = crm.cleanPatch(workflowPayload, current, crm.defaultStage({ bid, completed: completion !== null && !!completion }));
    if (patch.errors) return { ok: false, status: 422, errors: patch.errors };
    if (Number(payload.revision) !== patch.currentRevision) {
      return { ok: false, status: 409, errors: [{ code: 'crm_conflit', message: 'Ce lead a été modifié par une autre personne. Rechargez la fiche avant de sauvegarder.' }] };
    }
    const now = clockIso();
    const next = {
      bidId: id,
      stage: patch.value.stage,
      note: patch.value.note,
      nextFollowUpAt: patch.value.nextFollowUpAt,
      revision: patch.currentRevision + 1,
      createdAt: current && current.createdAt || now,
      createdBy: current && current.createdBy || principal.email,
      updatedAt: now,
      updatedBy: principal.email,
    };
    try {
      await repo.putCrmLead(next, patch.currentRevision);
    } catch (error) {
      if (error && error.name === 'ConditionalCheckFailedException') return { ok: false, status: 409, errors: [{ code: 'crm_conflit', message: 'Ce lead a été modifié par une autre personne. Rechargez la fiche avant de sauvegarder.' }] };
      return crmUnavailable();
    }
    await appendAudit('crm_lead_updated', {
      adminId: principal.adminId, email: principal.email, ip,
      meta: { bidId: id, stageBefore: current && current.stage || null, stageAfter: next.stage, nextFollowUpBefore: current && current.nextFollowUpAt || null, nextFollowUpAfter: next.nextFollowUpAt, noteChanged: (current && current.note || '') !== next.note },
    });
    return {
      ok: true,
      lead: canSeePii ? next : { ...next, note: null },
    };
  }

  async function supportPrincipal(token, permission, ip, porte) {
    const principal = await requireAdmin(token, { ip });
    if (!principal) return { error: { ok: false, status: 401 } };
    const permitted = permission === 'support:write'
      ? rbac.can(principal.permissions, 'support:write')
      : rbac.can(principal.permissions, 'support:read');
    const pii = rbac.can(principal.permissions, 'pii:read');
    if (!permitted || !pii) {
      // Deux clés, pas une : la trace nomme chacune de celles qui manquent.
      const manquantes = [permitted ? null : permission, pii ? null : 'pii:read'].filter(Boolean);
      return { error: await refuserAcces(principal, { porte, permission: manquantes[0], manquantes, ip, message: 'Accès à la messagerie de soutien non autorisé.' }) };
    }
    return { principal };
  }
  const supportDetail = thread => ({
    ...domain.supportThreadSummary(thread), ...support.state(thread),
    messages: (thread.messages || []).map(message => ({
      ...support.messageView(message),
      ...(message.de === domain.SUPPORT_FROM.NOTA ? {
        notificationPending: !!(thread.courriel && message.delivery && message.delivery.state !== 'complete'),
      } : {}),
    })),
  });
  const supportUnavailable = () => ({ ok: false, status: 503, errors: [{ code: 'soutien_indisponible', message: 'La messagerie de soutien est momentanément indisponible.' }] });
  async function listSupport(token, { statut, limit, ip } = {}) {
    const gate = await supportPrincipal(token, 'support:read', ip, 'listSupport');
    if (gate.error) return gate.error;
    if (statut && !domain.SUPPORT_STATUTS.some(item => item.id === statut)) {
      return { ok: false, status: 422, errors: [{ code: 'statut_invalide', message: 'Le statut de conversation n’est pas valide.' }] };
    }
    const mois = require('./keys').supportInboxMonths(clockIso());
    const max = Math.max(1, Math.min(500, Number(limit) || 100));
    let threads;
    try {
      threads = await repo.listSupportThreads({ months: mois, limit: statut ? 500 : max });
    } catch { return supportUnavailable(); }
    const summaries = threads.map(thread => ({ ...domain.supportThreadSummary(thread), ...support.state(thread) }));
    await appendAudit('support_inbox_read', { adminId: gate.principal.adminId, email: gate.principal.email, ip, meta: { statut: statut || null, count: summaries.length } });
    return {
      ok: true, threads: summaries.filter(thread => !statut || thread.statut === statut).slice(0, max),
      statuts: domain.SUPPORT_STATUTS, limites: { messageMax: domain.SUPPORT_MESSAGE_MAX }, mois,
    };
  }
  async function getSupport(token, id, { ip } = {}) {
    const gate = await supportPrincipal(token, 'support:read', ip, 'getSupport');
    if (gate.error) return gate.error;
    let thread;
    try { thread = await repo.getSupportThread(id); } catch { return supportUnavailable(); }
    if (!thread) return support.writeError(null);
    await appendAudit('support_thread_read', { adminId: gate.principal.adminId, email: gate.principal.email, ip, meta: { threadId: thread.id } });
    return { ok: true, thread: supportDetail(thread), limites: { messageMax: domain.SUPPORT_MESSAGE_MAX } };
  }
  async function replySupport(token, id, payload, { ip } = {}) {
    const gate = await supportPrincipal(token, 'support:write', ip, 'replySupport');
    if (gate.error) return gate.error;
    let result;
    try {
      result = await support.reply({ threadId: id, texte: payload.texte, messageId: payload.messageId, author: gate.principal.adminId });
    } catch { return supportUnavailable(); }
    if (!result.ok) return result;
    if (!result.duplicate) {
      await appendAudit('support_reply_sent', {
        adminId: gate.principal.adminId, email: gate.principal.email, ip,
        meta: { threadId: id, messageId: result.message.id },
      });
    }
    const thread = supportDetail(result.thread);
    const notification = !result.thread.courriel ? null : result.notification && result.notification.ok !== false
      ? { ok: true } : { ok: false, retryable: true };
    return {
      ok: true, message: thread.messages.find(message => message.id === result.message.id),
      duplicate: result.duplicate, notification, thread, limites: { messageMax: domain.SUPPORT_MESSAGE_MAX },
    };
  }
  async function getSupportKnowledge(token, { ip } = {}) {
    const gate = await supportPrincipal(token, 'support:read', ip, 'getSupportKnowledge');
    if (gate.error) return gate.error;
    try {
      const knowledge = await repo.getSupportKnowledge();
      return { ok: true, ...knowledge, limites: { entriesMax: domain.SUPPORT_KNOWLEDGE_MAX, questionMax: domain.SUPPORT_KNOWLEDGE_QUESTION_MAX, messageMax: domain.SUPPORT_MESSAGE_MAX } };
    } catch { return supportUnavailable(); }
  }
  async function saveSupportKnowledge(token, payload, { ip } = {}) {
    const gate = await supportPrincipal(token, 'support:write', ip, 'saveSupportKnowledge');
    if (gate.error) return gate.error;
    const invalid = (code, message, status = 422) => ({ ok: false, status, errors: [{ code, message }] });
    if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) return invalid('revision_requise', 'Actualisez les réponses approuvées avant de les modifier.');
    try {
      const current = await repo.getSupportKnowledge();
      if (current.revision !== payload.revision) return invalid('revision_conflit', 'Les réponses ont changé. Actualisez avant de réessayer.', 409);
      let entry;
      if (payload.active === false) {
        const previous = current.entries.find(item => item.id === payload.id);
        if (!previous) return invalid('introuvable', 'Réponse approuvée introuvable.', 404);
        entry = { ...previous, active: false, updatedAt: clockIso(), reviewedBy: gate.principal.adminId };
      } else {
        const validation = require('./support-knowledge').validateKnowledge(payload);
        if (!validation.ok) return { ok: false, status: 422, errors: validation.errors };
        if (typeof payload.threadId !== 'string' || typeof payload.messageId !== 'string') return invalid('source_requise', 'Choisissez une réponse humaine dans la conversation.');
        const thread = await repo.getSupportThread(payload.threadId);
        const source = thread && (thread.messages || []).find(item => item.id === payload.messageId && item.de === domain.SUPPORT_FROM.NOTA);
        if (!source) return invalid('source_requise', 'Choisissez une réponse humaine dans la conversation.');
        // Stable, bounded ID: retries cannot create duplicate entries.
        const id = require('node:crypto').createHash('sha256').update(JSON.stringify([thread.id, source.id])).digest('hex');
        entry = { id, ...validation.value, active: true, threadId: thread.id, messageId: source.id, updatedAt: clockIso(), reviewedBy: gate.principal.adminId };
      }
      const entries = current.entries.filter(item => item.id !== entry.id);
      entries.push(entry);
      if (entries.length > domain.SUPPORT_KNOWLEDGE_MAX) {
        // Inactive entries may be replaced; an active answer is never evicted.
        const inactive = entries.findIndex(item => !item.active && item.id !== entry.id);
        if (inactive < 0) return invalid('limite_connaissances', 'La base est pleine. Retirez une réponse avant d’en ajouter une.');
        entries.splice(inactive, 1);
      }
      // Leave room below DynamoDB's item limit, including multibyte text.
      if (Buffer.byteLength(JSON.stringify(entries), 'utf8') > 300000) return invalid('limite_connaissances', 'La base est pleine. Retirez une réponse avant d’en ajouter une.');
      const saved = await repo.putSupportKnowledge({ entries }, { expectedRevision: current.revision });
      if (!saved) return invalid('revision_conflit', 'Les réponses ont changé. Actualisez avant de réessayer.', 409);
      await appendAudit('support_knowledge_reviewed', { adminId: gate.principal.adminId, email: gate.principal.email, ip, meta: { knowledgeId: entry.id, active: entry.active, revision: saved.revision } });
      return { ok: true, ...saved };
    } catch { return supportUnavailable(); }
  }

  async function closeSupport(token, id, { ip } = {}) {
    const gate = await supportPrincipal(token, 'support:write', ip, 'closeSupport');
    if (gate.error) return gate.error;
    let result;
    try { result = await support.close({ threadId: id }); } catch { return supportUnavailable(); }
    if (!result.ok) return result;
    if (!result.duplicate) await appendAudit('support_thread_closed', {
      adminId: gate.principal.adminId, email: gate.principal.email, ip, meta: { threadId: id },
    });
    return { ok: true, duplicate: result.duplicate, thread: supportDetail(result.thread), limites: { messageMax: domain.SUPPORT_MESSAGE_MAX } };
  }

  return {
    listSupport, getSupport, replySupport, closeSupport, getSupportKnowledge, saveSupportKnowledge,
    // L'entonnoir des refus (ADR 0036, 2026-09-11) : exposé pour que les portes
    // que admin-handler.js garde lui-même (groupes, utilisateurs, permissions,
    // tableaux de bord) puissent laisser la même trace.
    refuserAcces,
    requestLogin,
    login,
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
    getCatalogue,
    getFeatures,
    listPermissionGroups,
    putPermissionGroup,
    deletePermissionGroup,
    listCabinets,
    putCabinet,
    deleteCabinet,
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
    // Région « usagers » — le dossier d'une personne (Loi 25).
    getUserFile,
    exportUserFile,
    eraseUserFile,
    listCrmLeads,
    updateCrmLead,
  };
}

module.exports = { createAdmin };
