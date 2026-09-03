'use strict';

const domain = require('@nota/domain');
const prixConfig = require('./prix-nota-config.js');
const cote = require('./cote');
const { createBilling } = require('./billing');
const cancellationCfg = require('./cancellation-config');
const { decodeUnsubToken } = require('./notifications');
const { signToken, signChallengeToken, verifyToken, notaryIdForEmail, SCOPES } = require('./notary-auth');
const { buildNotaryFeed, buildCarnetFeed } = require('./ics');
const { statsDeltasForOffer, statsDeltasForRetain, statsDeltasForNotaryOnboarding, statsDeltasForFunnel } = require('./stats');

/**
 * HTTP application, transport-agnostic. `createApp` takes a Repo port and
 * returns `handle(request)`, where request is the normalized shape
 * `{ method, path, query, body }` and the return is `{ statusCode, body }`.
 * The Lambda entry (index.js) and the local dev server (local-server.js) each
 * adapt their native event to this shape — the routing logic lives here once.
 *
 * The clock is injected so tests are deterministic; production passes the real
 * date. All offer arithmetic is revalidated here through @nota/domain — the
 * client's tier, premium and total are never trusted.
 */
// Reject request bodies larger than this before attempting to parse them, so a
// hostile or runaway client cannot force a large JSON.parse. Function URLs cap
// payloads well above this, but the guard keeps the handler self-contained.
const MAX_BODY_BYTES = 64 * 1024;

function createApp(repo, opts = {}) {
  // "Today" is the Québec civil day (domain.BUSINESS_TIMEZONE), not the UTC
  // day: on Lambda (UTC) a plain toISOString() rolls to tomorrow every evening
  // after ~20:00 in Québec and wrongly 422s a same-day booking as date_passee.
  const TIME_ZONE = opts.timeZone || process.env.NOTA_TIMEZONE || domain.BUSINESS_TIMEZONE;
  const now = opts.now || (() => domain.businessDay(null, TIME_ZONE));
  const newId = opts.newId || (() => require('crypto').randomUUID());

  // Wall-clock source for notary token expiry, in epoch milliseconds. Separate
  // from `now` (a business date string) and injectable so token tests are
  // deterministic. Default is the real clock.
  const nowMs = opts.nowMs || (() => Date.now());
  // How long a freshly-issued notary token stays valid. Configurable, not baked
  // into the token logic; default 7 days.
  const NOTARY_TOKEN_TTL_MS = opts.notaryTokenTtlMs || 7 * 24 * 60 * 60 * 1000;
  // How long the per-bid CLIENT token issued by POST /bids stays valid. The
  // client has no account, so this token is their only key to see and answer a
  // notary's propositions. Default matches the bid's own retention (~400 days).
  const CLIENT_TOKEN_TTL_MS = opts.clientTokenTtlMs || 400 * 24 * 60 * 60 * 1000;
  // Longest free-text message a notary may attach to a proposition (same limit
  // as the domain's document-request message, same error code).
  const PROPOSITION_MESSAGE_MAX = opts.propositionMessageMax || 500;
  // Lifecycle of a notary's proposition (counter-offer) on an open bid.
  const PROPOSITION = { EN_ATTENTE: 'en_attente', ACCEPTEE: 'acceptee', REFUSEE: 'refusee', REMPLACEE: 'remplacee' };
  // How many months forward the notary open-bid feed scans, one Query per month
  // (the API role has no Scan). Configurable; default the current month + 3.
  const NOTARY_HORIZON_MONTHS = opts.notaryHorizonMonths || 4;

  // --- Notary passwordless sign-in (magic link) -----------------------------
  // Sign-in is a TWO step handshake that proves mailbox ownership before any
  // session token is minted (the old one-shot route trusted a bare request
  // email — see admin.js:6-9). All windows are injectable, none baked in.
  const NOTARY_CHALLENGE_TTL_MS = opts.notaryChallengeTtlMs || 15 * 60 * 1000; // 15 min
  const NOTARY_LOGIN_RL_WINDOW_SEC = opts.notaryLoginRlWindowSec || 15 * 60; // 15 min window
  const NOTARY_LOGIN_RL_MAX = opts.notaryLoginRlMax || 5; // links / window / IP
  // The support widget's per-IP throttle (ADR 0033 §7): 20 messages / 10 min.
  const SUPPORT_RL_WINDOW_SEC = opts.supportRlWindowSec || 10 * 60;
  const SUPPORT_RL_MAX = opts.supportRlMax || 20;
  // The site the magic link points back at (the notary console lives on the main
  // site, opened via a `#nauth=<token>` hash the web app consumes on load).
  const NOTARY_CONSOLE_URL = String(
    opts.notaryConsoleUrl || process.env.NOTA_BASE_URL || opts.siteUrl || process.env.NOTA_SITE_URL || ''
  ).replace(/\/+$/, '');
  // Outside production, echo the link/token in the response so the test suite and
  // `npm run api:local` complete sign-in with no mailbox. NEVER in production —
  // there the emailed link is the only way through. An explicit opt wins so a
  // test can assert the production (no-echo) shape.
  const NOTARY_LOGIN_DEV_ECHO =
    opts.notaryLoginDevEcho != null ? !!opts.notaryLoginDevEcho : process.env.NODE_ENV !== 'production';

  // --- Live support messaging (ADR 0026) -------------------------------------
  // The widget's thread token lives on the visitor's device for a season; the
  // operator's reply link stays valid long enough to answer from any inbox.
  // Same site-URL pattern as the notary console: the reply link opens the main
  // site with a `#reponse=<token>` hash the web app consumes on load.
  const SUPPORT_TOKEN_TTL_MS = opts.supportTokenTtlMs || 90 * 24 * 60 * 60 * 1000; // 90 days
  const SUPPORT_OP_TTL_MS = opts.supportOpTtlMs || 30 * 24 * 60 * 60 * 1000; // 30 days
  const SUPPORT_URL = String(
    opts.supportUrl || process.env.NOTA_BASE_URL || opts.siteUrl || process.env.NOTA_SITE_URL || ''
  ).replace(/\/+$/, '');
  // The wire shape of one chat message — an allow-list, like publicBid().
  const supportMessageView = (m) => ({ id: m.id, de: m.de, texte: m.texte, createdAt: m.createdAt });

  // --- Partner code claim: email verification (ADR 0011 fraud-hardening) -----
  // Claiming a referral code is a TWO-step, mailbox-proven handshake, mirroring
  // the notary magic link above: POST /partenaires mints a single-use challenge
  // and emails a confirmation link; POST /partenaires/verify redeems it and only
  // THEN writes the confirmed partner record. This closes code squatting (an
  // unverified claim never becomes the payee) and harvest-then-claim (a code is
  // never owned until its email is proven). All windows are injectable.
  const PARTNER_CLAIM_TTL_MS = opts.partnerClaimTtlMs || 30 * 60 * 1000; // 30 min
  const PARTNER_CLAIM_RL_WINDOW_SEC = opts.partnerClaimRlWindowSec || 15 * 60; // 15 min window
  const PARTNER_CLAIM_RL_MAX = opts.partnerClaimRlMax || 5; // links / window / IP
  // The site the confirmation link points back at (the Partenaires pane lives on
  // the main site, opened via a `#pauth=<token>` hash the web app consumes on load).
  const PARTNER_CLAIM_URL = String(
    opts.partnerClaimUrl || process.env.NOTA_BASE_URL || opts.siteUrl || process.env.NOTA_SITE_URL || ''
  ).replace(/\/+$/, '');
  // Outside production, echo the link/token so the test suite and `npm run
  // api:local` confirm a code with no mailbox. NEVER in production — there the
  // emailed link is the only way through. An explicit opt wins so a test can
  // assert the production (no-echo) shape.
  const PARTNER_CLAIM_DEV_ECHO =
    opts.partnerClaimDevEcho != null ? !!opts.partnerClaimDevEcho : process.env.NODE_ENV !== 'production';

  // Billing is injected so tests pass a fake (no Stripe package, no network).
  // In production it is built LAZILY on first use from a real Stripe adapter,
  // so existing tests — which never pass `billing` and never hit its routes —
  // never load the `stripe` SDK. Keys come from the environment (TF_VAR_*).
  let billingInstance = opts.billing || null;
  function billing() {
    if (billingInstance) return billingInstance;
    const { createStripeAdapter } = require('./stripe-port');
    const stripe = createStripeAdapter({
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    });
    billingInstance = createBilling({
      repo,
      stripe,
      now: () => new Date().toISOString(),
      timeZone: TIME_ZONE,
      onboardingReturnUrl: process.env.NOTA_ONBOARDING_RETURN_URL,
      onboardingRefreshUrl: process.env.NOTA_ONBOARDING_REFRESH_URL,
      // ADR 0031 — plus aucun taux à passer. La facturation ne connaît qu'un
      // PRIX, résolu par `prix-nota-config.resolvePrix` : le stocké par
      // l'opérateur, sinon `NOTA_PRIX_CENTS`, sinon le défaut. Passer encore un
      // barème que rien ne lit serait la manière la plus sûre de le voir
      // revenir.
    });
    return billingInstance;
  }
  // True when Stripe billing is available, decided WITHOUT loading the SDK — so
  // pay-on-accept turns on for a configured deployment but stays off for demo and
  // tests, which keep the pre-billing behaviour (offers go live the instant they
  // are posted). `siteUrl` builds the Checkout return links.
  // An explicit `billingConfigured` wins: a caller may inject a billing adapter
  // ONLY to exercise the webhook route yet keep the pre-billing offer flow (the
  // BDD world does exactly this). Otherwise infer it from an injected adapter or
  // the Stripe environment.
  const billingConfigured = opts.billingConfigured != null
    ? !!opts.billingConfigured
    : (!!opts.billing || !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET));
  // `billingConfigured` répond à « le paiement à l'acceptation est-il actif ? »
  // et peut être forcé à false ALORS QU'un adaptateur est injecté — le monde
  // BDD et `partenaires.test.mjs` font exactement cela pour exercer le webhook
  // et le branchement sans changer le flux d'offre.
  //
  // Ce prédicat-ci répond à l'autre question, la seule qui compte avant
  // d'appeler `billing()` : la construction peut-elle aboutir ? Elle échoue si
  // et seulement si aucun adaptateur n'est injecté et qu'aucune clé Stripe
  // n'est posée — `createStripeAdapter` lève alors sur `secretKey`. Confondre
  // les deux prédicats donne soit un 500 en production, soit un 503 en test.
  const billingAvailable = !!opts.billing || !!process.env.STRIPE_SECRET_KEY;
  // L'origine publique du site — celle où Stripe renvoie le client après le
  // paiement. `NOTA_BASE_URL` EST la variable que l'infrastructure pose
  // (`infra/lambda.tf`) ; `NOTA_SITE_URL` n'y figure nulle part. Cette ligne
  // était la SEULE des quatre URL du handler à ne pas retomber dessus, si bien
  // qu'en production Stripe recevait `successUrl: undefined` — le client
  // n'avait aucun retour, et `handleCheckoutReturn()` ne s'exécutait jamais.
  const env = opts.env || process.env;
  const siteUrl = opts.siteUrl || env.NOTA_SITE_URL || env.NOTA_BASE_URL || '';
  // --- Free notary signup + funnel beacon throttles (2026-09-02) -------------
  // The signup door shares the sign-in request's window and ceiling (it is the
  // same kind of door: public, unauthenticated, one mail per call). The funnel
  // beacon is lighter and far more frequent — a page fires it on every step —
  // so its own, looser ceiling per minute.
  const NOTARY_SIGNUP_RL_MAX = opts.notarySignupRlMax || NOTARY_LOGIN_RL_MAX;
  const FUNNEL_RL_WINDOW_SEC = opts.funnelRlWindowSec || 60;
  const FUNNEL_RL_MAX = opts.funnelRlMax || 120;
  // An offer is shown on the carnet unless its card authorization is still pending
  // or was voided (pay-on-accept). Legacy bids (no paymentStatus) are always live.
  const isLive = (b) => b.paymentStatus !== 'pending' && b.paymentStatus !== 'void';

  // Notifier is injected so tests pass a fake (no SES package, no network). In
  // production it is built LAZILY from a real SES adapter on first use, exactly
  // like billing — and ONLY when NOTA_FROM_EMAIL is configured, so existing
  // tests (which never set it) run with notifications simply disabled. All sends
  // are best-effort: a mail failure must never affect an HTTP response.
  let notifierInstance = opts.notifier || null;
  let notifierResolved = false;
  function notifier() {
    if (notifierInstance) return notifierInstance;
    if (notifierResolved) return null;
    notifierResolved = true;
    if (!process.env.NOTA_FROM_EMAIL) return null; // notifications disabled
    const { createSesAdapter } = require('./notify-port');
    const { createNotifier } = require('./notifications');
    const mailer = createSesAdapter({ from: process.env.NOTA_FROM_EMAIL, region: process.env.AWS_REGION });
    // ADR 0033 §2.7 — the client's signed, device-independent link to THEIR
    // act, good for 30 days: the CTA of every client act mail. Minted here
    // because the handler holds the signing secret and the public origin.
    const CLIENT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    notifierInstance = createNotifier({
      repo,
      mailer,
      baseUrl: process.env.NOTA_BASE_URL,
      // Où vit réellement l'API vue de l'extérieur. Par défaut `<base>/api`,
      // le chemin que CloudFront route vers la Lambda ; surchargeable pour un
      // déploiement dont l'API a sa propre adresse.
      apiBaseUrl: process.env.NOTA_API_BASE_URL,
      operatorEmail: process.env.NOTA_OPERATOR_EMAIL,
      // Null without a public origin: the mail then falls back to the client's space.
      clientLink: (bid) =>
        siteUrl && bid && bid.id
          ? siteUrl + '/#offre=' + bid.id + '&d=' + bid.dateISO + '&cle=' + signToken(bid.id, nowMs() + CLIENT_LINK_TTL_MS, SCOPES.CLIENT)
          : null,
      // Operator alerts open the admin console when one is configured.
      adminUrl: process.env.NOTA_ADMIN_URL || null,
    });
    return notifierInstance;
  }

  // Best-effort analytics rollups (see keys.js STATS#). Awaited so the counter
  // write completes within the request (a Lambda may freeze after responding),
  // but wrapped so a rollup failure — including an older repo without the method
  // or a missing UpdateItem grant — can NEVER break a bid/retain. A phase-4
  // reconcile heals any counter drift from a partial failure.
  async function recordStats(deltas) {
    if (!deltas || !deltas.length || typeof repo.applyStatsDeltas !== 'function') return;
    try {
      await repo.applyStatsDeltas(deltas);
    } catch {
      /* swallow: analytics must never affect the marketplace write path */
    }
  }

  // Case-insensitive header lookup (Lambda function URL and node:http both
  // lowercase keys, but be defensive).
  function header(headers, name) {
    if (!headers) return '';
    const lower = name.toLowerCase();
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === lower) return headers[k];
    }
    return '';
  }

  // Extract a bearer token from the Authorization header. Notary console calls
  // carry the SESSION token here rather than in the query string, so it never
  // lands in access logs or a shareable URL.
  function bearer(request) {
    const raw = header(request.headers, 'authorization');
    const m = /^Bearer\s+(.+)$/i.exec(String(raw || '').trim());
    return m ? m[1].trim() : '';
  }

  // The caller IP for login rate-limiting. MUST be a trusted value: prefer the
  // platform-supplied sourceIp (unspoofable), else the RIGHTMOST X-Forwarded-For
  // hop (the one the trusted proxy appended). NEVER the leftmost token — that is
  // client-controlled and would let an attacker mint a fresh rate-limit key per
  // request. Mirrors admin-handler.js's clientIp.
  function clientIp(request) {
    if (request && request.sourceIp) return String(request.sourceIp);
    const parts = String(header(request.headers, 'x-forwarded-for') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  }

  // Resolve the active-account gate for a notary email. Shared by the sign-in
  // request (to decide whether to mint a challenge) and verify (to re-check
  // before issuing a session). NOTA_DEMO_OPEN skips the gate for an open demo but
  // is HARD-DISABLED in production regardless of the env var — a config slip must
  // never open the notary surface on the real deployment.
  async function notaryGate(email) {
    const notaryId = notaryIdForEmail(email);
    const existing = await repo.getNotary(notaryId);
    const demoOpen = process.env.NOTA_DEMO_OPEN === 'true' && process.env.NODE_ENV !== 'production';
    const active = !!(existing && existing.status === 'active');
    // 2026-09-02: console access is the OPERATOR's approval (`approuveLe`,
    // stamped from the admin console once the Tableau de l'Ordre check is
    // done) — not Stripe's `active`, which now only says whether payouts can
    // flow. A notary activated by Stripe before this date keeps getting in.
    const approved = !!(existing && existing.approuveLe);
    return { notaryId, existing, demoOpen, active, approved, allowed: demoOpen || active || approved };
  }

  // Upsert the notary profile so accept can stamp a stable étude label. Spreads
  // `existing` first so status/subscription fields are never clobbered. Under the
  // demo hatch a brand-new account is seeded fully onboarded so the open demo can
  // walk the WHOLE lifecycle (retain, complete, commission) with no real Stripe.
  async function upsertNotaryProfile(gate, email) {
    const { notaryId, existing, demoOpen, active } = gate;
    const label = (existing && existing.label) || email;
    const demoActivation =
      demoOpen && !active
        ? { status: 'active', chargesEnabled: true, connectAccountId: 'acct_demo_' + notaryId.slice(0, 12) }
        : {};
    // ADR 0033: retaining needs a name, a phone and an address (the client
    // must be able to reach and find the notary). The open demo seeds them on
    // a brand-new account — never over what a notary already typed.
    const demoIdentity =
      demoOpen && !active
        ? {
            nom: (existing && existing.nom) || 'Me Démo Nota',
            etude: (existing && existing.etude) || 'Étude Démo',
            telephone: (existing && existing.telephone) || '418 555 0100',
            adresse: (existing && existing.adresse) || '1, rue de la Démo, Québec (QC) G1R 1A1',
          }
        : {};
    await repo.putNotary({
      ...(existing || {}),
      ...demoActivation,
      ...demoIdentity,
      id: notaryId,
      email,
      label,
      role: 'notary',
      createdAt: (existing && existing.createdAt) || new Date(nowMs()).toISOString(),
    });
  }

  // --- The cote's live signals (ADR 0028) ------------------------------------
  // Everything the cote reads lives on the notary's own record, so the score is
  // one item away at pricing time. These two writers keep it true:
  //
  //   bumpNotary   — add to a counter the moment the act happens (a proposition
  //                  sent, a demande accepted or declined).
  //   touchNotary  — stamp the console's last visit, AT MOST ONCE A DAY: the
  //                  feed is polled live (ADR 0021) and a write per poll would
  //                  be a write storm for a signal measured in days.
  //
  // Both are best-effort: a counter that fails to move must never break the
  // action the notary actually asked for.
  async function bumpNotary(notaryId, field, by = 1) {
    try {
      const profile = await repo.getNotary(notaryId);
      if (!profile) return;
      await repo.putNotary({ ...profile, [field]: (Number(profile[field]) || 0) + by, updatedAt: now() });
    } catch { /* the cote is not worth failing a retain over */ }
  }
  async function touchNotary(notaryId, profile) {
    try {
      const p = profile || (await repo.getNotary(notaryId));
      if (!p) return;
      const today = now().slice(0, 10);
      if (String(p.lastSeenAt || '').slice(0, 10) === today) return;
      await repo.putNotary({ ...p, lastSeenAt: new Date(nowMs()).toISOString() });
    } catch { /* presence is a signal, never a gate */ }
  }

  // --- La piste d'audit des transactions (2026-09-01) ------------------------
  // Chaque règlement laisse une entrée append-only : qui, quel acte, combien le
  // client a payé, à quel taux, la part de Nota, le net du notaire et la cote
  // qui a mérité ce taux. Même contrat que la console admin (admin.js), même
  // registre — et strictement best-effort : une écriture d'audit qui échoue ne
  // doit jamais empêcher un notaire d'être payé. Le registre ACT# reste
  // l'autorité comptable ; ceci en est la trace lisible par un auditeur.
  //
  // L'ACTEUR (2026-09-03). L'enveloppe codait en dur `adminId: null, email:
  // null, ip: null` pour TOUS les événements : `document_lu` ne disait qu'un
  // camp (« par: client »), jamais une personne ni une origine. Un journal
  // d'accès aux documents qui ne peut pas nommer qui a lu la pièce ne vaut rien
  // dans un litige sur le secret professionnel. Chaque entrée porte donc
  // désormais `acteur: { type, id, ip }`, sur un vocabulaire fermé.
  //
  // L'`id` est celui que le système possède déjà, jamais une adresse courriel :
  // le notaire est nommé par l'identifiant dérivé de sa boîte (celui que porte
  // son profil, donc joignable à son nom), le client par l'offre qui EST son
  // dossier, le partenaire par son code. La minimisation de la Loi 25 et
  // l'utilité pour un auditeur pointent ici dans le même sens : une clé
  // joignable au registre vaut mieux qu'une donnée personnelle recopiée dans un
  // journal conservé sept ans.
  const ACTEUR = { NOTAIRE: 'notaire', CLIENT: 'client', PARTENAIRE: 'partenaire', SYSTEME: 'systeme' };
  const SYSTEME = { type: ACTEUR.SYSTEME, id: null, ip: null };
  // `request` est facultatif : une trace écrite hors requête (tâche planifiée,
  // reprise) dit « systeme » et n'invente aucune origine.
  function acteur(type, id, request) {
    return { type, id: id == null ? null : String(id), ip: (request && clientIp(request)) || null };
  }

  // Un jeton ne s'entrepose JAMAIS en clair dans le journal : une trace de
  // sécurité qui contient des identifiants est elle-même une faille. L'empreinte
  // est SHA-256, tronquée à 16 caractères hexadécimaux (64 bits) et préfixée par
  // son algorithme. Elle ne sert qu'à une chose — reconnaître que deux refus
  // portent sur le MÊME lien, donc distinguer un rejeu d'un balayage — et 64
  // bits suffisent largement à cela, tout en restant irréversibles.
  function empreinteJeton(token) {
    const t = String(token || '');
    if (!t) return null;
    return 'sha256:' + require('crypto').createHash('sha256').update(t).digest('hex').slice(0, 16);
  }

  async function appendAudit(action, meta, qui) {
    // `appendTxAudit` écrit dans la table PRINCIPALE : la Lambda publique n'a
    // aucun accès à la table admin, et une trace écrite là-bas ne s'écrirait
    // jamais en production (l'appel lève, le catch ci-dessous l'avale).
    const write = typeof repo.appendTxAudit === 'function' ? repo.appendTxAudit : repo.appendAudit;
    if (typeof write !== 'function') return;
    const a = qui || SYSTEME;
    const ts = new Date(nowMs()).toISOString();
    try {
      await write.call(repo, {
        id: newId(), ts, day: now(), action,
        // La porte publique n'a pas d'administrateur, et ne consigne aucune
        // adresse : ces deux colonnes appartiennent au journal admin, qui les
        // remplit. `ip` est doublée hors de l'acteur pour que l'écran d'audit
        // existant la montre sans rien savoir de la nouvelle enveloppe.
        adminId: null, email: null, ip: a.ip || null,
        acteur: a,
        meta: meta || null,
      });
    } catch (err) {
      // La règle tient : l'audit ne bloque jamais l'argent. Ce qui change, c'est
      // qu'un puits d'audit cassé n'est plus indistinguable d'une journée calme
      // — cette ligne est ce que le filtre de métrique CloudWatch compte, et
      // l'alarme qui en dépend vit dans infra/observability.tf.
      console.error(JSON.stringify({
        level: 'error',
        event: 'audit_write_failed',
        action,
        ts,
        acteur: a.type,
        message: (err && err.message) || String(err),
      }));
    }
  }

  // --- Un lien qu'on ne peut pas cliquer ne part pas (2026-09-01) ------------
  // Les liens des courriels sont bâtis sur NOTA_BASE_URL. Vérification faite sur
  // la Lambda réelle : elle est VIDE, donc le lien magique du notaire vaut
  // « /#nauth=<jeton> » — un chemin relatif, sans hôte, inutilisable depuis une
  // boîte de réception. Et l'écho de développement étant coupé en production,
  // ce lien est le seul chemin d'entrée : personne ne peut ouvrir sa console.
  //
  // Plutôt qu'envoyer une promesse morte, la porte se ferme et le dit. Le
  // remède est une variable d'environnement, pas un correctif de code — mais
  // une panne visible vaut mieux qu'un courriel qui trahit.
  const CONFIG_INCOMPLETE = {
    code: 'configuration_incomplete',
    message: 'Ce service est momentanément indisponible : sa configuration est incomplète. Écrivez-nous et nous vous ouvrons l’accès à la main.',
  };
  // Vrai quand aucune adresse de site n'est configurée ET que l'écho de
  // développement ne peut pas prendre le relais.
  const lienImpossible = (base, echo) => !String(base || '').trim() && !echo;

  // Verify a token AND require a specific scope. Returns the notaryId (sub) only
  // when the signature is valid, the token is unexpired, and its scope matches;
  // otherwise null. This is what stops a read-only 'feed' token from accepting a
  // bid or reading a dossier, and a 'session' token from being a valid feed URL.
  function requireScope(token, scope) {
    const claims = verifyToken(token || '', nowMs());
    if (!claims || claims.scope !== scope) return null;
    return claims.sub;
  }

  // Public projection: strip anything private and enforce anonymity server-side.
  // A bid marked anonyme never leaks its name, whatever the client sent. The
  // dossier (documents/fields) is never part of the public shape — and neither
  // are the referral code (`parrain`, ADR 0011) or the client's `telephone`
  // (ADR 0010 §4): both live on the stored bid only, and publicBid() is an
  // ALLOW-list, so a new private field can never leak by omission.
  // Premium shown PUBLICLY is relative to the public starting price (prixDepart),
  // never the private per-bid dynamic base — otherwise round(montant/premium)
  // would recover the private floor and decode the client's pricing answers.
  function publicPremium(b) {
    const svc = domain.serviceById(b.serviceId);
    return svc && svc.prixDepart ? b.montant / svc.prixDepart : 1;
  }

  /**
   * ADR 0031 — les DEUX lignes d'un acte réglé, lues du registre write-once.
   *
   *   honoraires — le montant offert, qui revient au notaire EN ENTIER
   *   prixNota   — le prix du service de Nota, payé par le client, à côté
   *
   * Une seule définition pour les trois surfaces qui divulguent un règlement
   * (le relevé du notaire, la piste d'audit, l'espace client), pour qu'aucune
   * ne puisse dériver vers un pourcentage. `commissionCents` est l'ancien nom
   * du prix de Nota et sert de repli : le montant est le même, le mot est
   * hérité (voir la conséquence n° 3 de l'ADR 0031).
   *
   * Rien ici ne divise, ne compare ni ne retranche : un relevé qui présente le
   * prix de Nota comme une part des honoraires décrit l'opération que l'art. 32
   * du Code de déontologie interdit au notaire — et ce serait une pièce écrite
   * par Nota elle-même.
   */
  function deuxLignes(regle) {
    const r = regle || {};
    const montant = Number(r.actAmount) || 0;
    const honoraires = r.honorairesCents != null
      ? Math.round(Number(r.honorairesCents)) / 100
      : montant;
    const prixNota = Math.round(Number(r.prixNotaCents != null ? r.prixNotaCents : r.commissionCents) || 0) / 100;
    return { montant, honoraires, prixNota };
  }

  /**
   * ADR 0031 — LE TARIF DE NOTA, tel que le client doit le connaître avant
   * d'autoriser sa carte.
   *
   * L'autorisation porte le TOTAL de deux lignes : les honoraires offerts au
   * notaire et le prix du service de Nota. Tant que la seconde n'apparaît nulle
   * part, le client la découvre chez Stripe — et l'art. 68 du Code de
   * déontologie nomme précisément cela : une publicité « incomplète ».
   *
   * `taxesIncluses` et `deboursInclus` sont déclarés parce que l'art. 71 3°
   * oblige quiconque annonce des honoraires à « indiquer si les débours et les
   * taxes sont ou non inclus ». Ils sont faux aujourd'hui, et le produit doit
   * le dire plutôt que de laisser croire à un « tout compris » : ni TPS/TVQ ni
   * droits de publication n'existent nulle part dans le code. Le jour où ils
   * seront calculés, ces drapeaux basculent et toute la copie suit.
   */
  async function tarifNota() {
    return {
      // La MÊME résolution que la tarification : le prix annoncé est celui qui
      // sera facturé, sans quoi l'annonce devient trompeuse au sens de
      // l'art. 68 dès qu'un opérateur change le prix.
      prixNotaCents: await prixConfig.resolvePrix(repo, opts.env || process.env),
      taxesIncluses: false,
      deboursInclus: false,
    };
  }

  function publicBid(b) {
    return {
      id: b.id,
      serviceId: b.serviceId,
      dateISO: b.dateISO,
      montant: b.montant,
      tier: b.tier,
      premium: publicPremium(b),
      status: b.status,
      // ART. 37 du Code de déontologie — « Le notaire ne doit pas, à moins que
      // la nature du cas ne l'exige, révéler qu'une personne a fait appel à ses
      // services. » Le carnet est PUBLIC et sans authentification : y nommer
      // l'étude à côté du secteur postal du client, du montant et de la date,
      // c'est révéler exactement cela — et l'anonymat du client n'y change
      // rien. La nature du cas n'exige rien de tel : le signal de marché est
      // « cette date est prise », que `status` porte déjà à lui seul.
      //
      // Le nom de l'étude reste dû au client qui a retenu ce notaire : il le
      // reçoit par `GET /client/bid`, derrière son jeton (`requireClient`).
      anonyme: !!b.anonyme,
      nom: b.anonyme ? null : b.nom || null,
      prefixe: b.prefixe || null,
      createdAt: b.createdAt,
      // ADR 0023 — what a cancellation actually kept, on a cancelled bid.
      annulation: b.annulation || null,
    };
  }

  // ADR 0023 — the fee cancelling this RETAINED bid would carry today, under
  // the barème in force (the admin-stored CONFIG#ANNULATION item, else the
  // environment defaults — resolved at every call, like the commission). Only
  // a live authorized hold can pay a fee: without one (demo, tests, pending or
  // voided payment) the answer is null and the cancel is free.
  async function annulationFeeFor(bid) {
    if (!billingConfigured || bid.status !== domain.STATUS.RETENUE) return null;
    if (bid.paymentStatus !== 'authorized' || !bid.paymentIntentId) return null;
    const stored = typeof repo.getCancellationConfig === 'function' ? await repo.getCancellationConfig() : null;
    const paliers = stored && Array.isArray(stored.paliers) ? stored.paliers : cancellationCfg.envDefaults().paliers;
    const fee = cancellationCfg.feeFor({ montant: bid.montant, joursAvant: domain.daysBetween(now(), bid.dateISO), paliers });
    return fee.fraisCents > 0 ? fee : null;
  }

  // The barème in force, as data for the notary console (ADR 0033 §2.3):
  // resolved exactly like `annulationFeeFor` above — the admin-stored item,
  // else the environment defaults — so what the console shows before a
  // retain is what a cancellation would actually charge.
  async function annulationBareme() {
    const stored = typeof repo.getCancellationConfig === 'function' ? await repo.getCancellationConfig() : null;
    const paliers = stored && Array.isArray(stored.paliers) ? stored.paliers : cancellationCfg.envDefaults().paliers;
    return paliers.map((t) => ({ maxJours: t.maxJours, taux: t.taux }));
  }

  // The notary's own profile as the console reads and edits it (ADR 0033):
  // the feed levers (fiche, rayon, urgences, secteur), the identity a retained
  // client will receive (nom, étude, téléphone, adresse, courriel), whether
  // that identity is complete enough to retain, and the alert preferences.
  function notaryProfil(p) {
    const s = (v) => { const t = String(v == null ? '' : v).trim(); return t || null; };
    const manquants = domain.notaryContactMissing(p);
    return {
      lienCNQ: (p && p.lienCNQ) || null,
      rayonKm: (p && Number(p.rayonKm)) || 0,
      urgences: !!(p && p.urgences),
      prefixe: (p && p.prefixe) || null,
      nom: s(p && p.nom),
      etude: s(p && p.etude),
      telephone: s(p && p.telephone),
      adresse: s(p && p.adresse),
      courriel: s(p && p.email),
      complet: manquants.length === 0,
      manquants,
      alertes: domain.notaryAlertes(p),
    };
  }

  // The gate (ADR 0033 §2.2): a notary may RETAIN or PROPOSE only once a
  // client could call them and find their étude. Returns the 403 to send, or
  // null when the profile is complete. Never applied to the idempotent
  // re-accept by the holder — a dossier already released stays released.
  function profilIncomplet(profile) {
    const manquants = domain.notaryContactMissing(profile);
    if (!manquants.length) return null;
    return json(403, {
      errors: [{
        code: 'profil_incomplet',
        message: 'Complétez votre profil (nom, téléphone, adresse de l’étude) avant de retenir une demande.',
        manquants,
      }],
    });
  }

  // Notary-facing projection of a bid: enough to decide on, never the private
  // dossier or courriel. `ready` tells the notary the client's file is complete
  // (every required document/field assembled + consent), computed by the domain.
  // The lender behind a bid, as notaries see it. A notary only closes with the
  // institutions they normally work with, so the feed must NAME the lender —
  // and flag a virtual (branchless) one — before they decide to retain,
  // propose, or pass. Null on bids that predate the lender question.
  function bidLenderInfo(b) {
    const l = domain.bidLender(b);
    return l ? { id: l.id, nom: l.nom, virtuel: l.virtuel } : null;
  }

  // The déplacement band behind a bid, as notaries see it (ADR 0017): who
  // moves for the in-person signature, how far, and whether the client
  // declared a 100 %-online urgency — the notary must know the travel (or the
  // scramble) before they decide to retain, propose, or pass. Null on bids
  // that predate the question.
  function bidDeplacementInfo(b) {
    const d = domain.bidDeplacement(b);
    return d ? { id: d.id, nom: d.nom, qui: d.qui, km: d.km, urgence: d.urgence } : null;
  }

  function notaryBid(b) {
    // The bid's frozen pricing answers decide which documents apply to this
    // client (domain `si` predicates) — the checklist the notary sees is theirs.
    const r = domain.leadReadiness(b.serviceId, b.dossier || {}, b.pricing);
    return {
      id: b.id,
      serviceId: b.serviceId,
      dateISO: b.dateISO,
      montant: b.montant,
      tier: b.tier,
      premium: b.premium,
      prefixe: b.prefixe || null,
      ready: r.ready,
      preteur: bidLenderInfo(b),
      deplacement: bidDeplacementInfo(b),
      // The case-complexity signal (easy/hard) + the factors that drive it, so a
      // notary can judge whether the posted price fits the file before retaining.
      complexity: domain.complexity(b.serviceId, b.pricing || null),
    };
  }

  // The mise en relation (ADR 0010 §4): retention puts the two parties in
  // contact. This is the CLIENT half — name (even when the public bid was
  // anonymous: anonymity is a carnet promise, not a blackout on the person the
  // notary is meeting), courriel and téléphone — attached ONLY to views that
  // already require being the retaining notary. The other half (the notary's
  // étude + courriel) is built inline in GET /client/bid, where the client
  // token proves ownership.
  function clientContact(b) {
    return { nom: b.nom || null, courriel: b.courriel || null, telephone: b.telephone || null };
  }

  // --- Propositions / demandes projections ---------------------------------
  // Stored shapes (private, on the bid record):
  //   proposition { id, notaryId, etude, montant, delta, message|null, createdAt, status }
  //   demande     { id, notaryId, etude, documents:[{id,nom,kind}], message|null, createdAt }
  // A notary projection never shows another notary's propositions; a client
  // projection shows the étude but never the notaryId.
  const propositionsOf = (b) => (Array.isArray(b.propositions) ? b.propositions : []);
  const demandesOf = (b) => (Array.isArray(b.demandes) ? b.demandes : []);
  // A demande is "fournie" once every requested id is present in the dossier.
  const demandeFournie = (b, d) => {
    const dossier = b.dossier || {};
    return (d.documents || []).every((it) => !!dossier[it.id]);
  };
  const notaryProposition = (p) => ({ id: p.id, montant: p.montant, delta: p.delta, message: p.message || null, status: p.status, createdAt: p.createdAt });
  const notaryDemande = (b, d) => ({ id: d.id, documents: d.documents, message: d.message || null, createdAt: d.createdAt, fournie: demandeFournie(b, d) });
  const clientProposition = (p) => ({ id: p.id, etude: p.etude || null, montant: p.montant, delta: p.delta, message: p.message || null, status: p.status, createdAt: p.createdAt });
  // A notary's evaluations, as a one-decimal average and a count — null before
  // the first one, so the UI never paints fake stars.
  //
  // ADR 0030 — ceci ne voyage QUE vers le notaire lui-même (sa console) et vers
  // Nota. Jamais vers un client : l'art. 70 du Code de déontologie interdit au
  // notaire d'utiliser « ou de permettre que soit utilisé » un témoignage
  // d'appui qui le concerne, et il n'y a aucune exception pour les avis
  // authentiques. Si vous ajoutez un appelant, vérifiez qui le lit.
  const notaryRating = (profile) => {
    const note = profile ? domain.ratingAverage(profile.ratingSum, profile.ratingCount) : null;
    return note == null ? null : { note, avis: profile.ratingCount };
  };
  const clientDemande = (b, d) => ({ id: d.id, etude: d.etude || null, documents: d.documents, message: d.message || null, createdAt: d.createdAt, fournie: demandeFournie(b, d) });
  // This notary's latest proposition that was not superseded (or null).
  function latestPropositionFor(b, notaryId) {
    const mine = propositionsOf(b).filter((p) => p.notaryId === notaryId && p.status !== PROPOSITION.REMPLACEE);
    return mine.length ? mine[mine.length - 1] : null;
  }
  function latestDemandeFor(b, notaryId) {
    const mine = demandesOf(b).filter((d) => d.notaryId === notaryId);
    return mine.length ? mine[mine.length - 1] : null;
  }

  // --- Retained-act conversation (client ↔ notaire) --------------------------
  // Stored shape (private, on the bid record): { id, de, texte, createdAt }
  // where `de` is domain.CHAT_FROM.CLIENT | .NOTAIRE. Both parties see the same
  // thread once the bid is retained — never before, never another notary.
  // --- Les documents de la conversation (ADR 0032) ---------------------------
  //
  // Nota est DÉPOSITAIRE, jamais destinataire : elle conserve des octets qu'elle
  // ne lit pas, pour les deux seules parties d'une conversation retenue. Les
  // art. 35 à 37 du Code de déontologie tiennent le notaire au secret
  // professionnel, et l'art. 12 lui impose de veiller au respect de la loi par
  // ceux qui collaborent avec lui — une plateforme dont le personnel pourrait
  // ouvrir les dossiers lui rendrait cette obligation intenable. D'où : aucune
  // route admin ici, et la clé de stockage ne sort jamais de l'API.
  //
  // Les octets ne traversent PAS ce service. Il n'émet que des autorisations
  // signées, brèves et portées sur une clé unique.
  const documentsOf = (b) => (Array.isArray(b.documents) ? b.documents : []);

  // Ce qu'une partie a le droit de voir d'un document. Ni la clé de stockage,
  // ni rien qui permettrait de deviner où il vit.
  const publicDocument = (d) => ({
    id: d.id,
    de: d.de,
    nom: d.nom,
    taille: d.taille,
    etat: d.etat,
    createdAt: d.createdAt,
  });

  // Le port de stockage, injecté. Absent, les portes de document se ferment en
  // 503 avec un message qui dit quoi faire — jamais une URL inventée, jamais un
  // téléversement qui échouera chez le client après 15 Mo.
  // Injecté par les tests et le développement local ; sinon composé depuis
  // l'environnement, et SEULEMENT si un seau est configuré. Un déploiement sans
  // seau garde la messagerie texte et ferme proprement les portes de document —
  // l'ADR 0010 §4 reste vrai : le canal du notaire n'a jamais cessé d'être une
  // réponse complète.
  const storage = opts.storage || (env.NOTA_DOCS_BUCKET
    ? require('./storage-port').createS3Storage({
        bucket: env.NOTA_DOCS_BUCKET,
        region: env.AWS_REGION,
        kmsKeyId: env.NOTA_DOCS_KMS_KEY_ID || undefined,
        // Un point d'accès explicite rend la pile locale (MinIO) et tout autre
        // stockage compatible S3 utilisables sans changer une ligne ailleurs.
        endpoint: env.NOTA_DOCS_ENDPOINT || undefined,
        // L'adresse que le NAVIGATEUR doit atteindre. Vide sur AWS (c'est la
        // même) ; distincte dès qu'un réseau privé ou une pile locale sépare
        // les deux points de vue.
        publicEndpoint: env.NOTA_DOCS_PUBLIC_ENDPOINT || undefined,
      })
    : null);
  const storageIndisponible = () => json(503, {
    errors: [{
      code: 'stockage_indisponible',
      message: 'Le partage de documents n’est pas configuré sur ce déploiement. Transmettez le document par le canal de votre notaire en attendant.',
    }],
  });

  // La conversation d'une offre RETENUE, et les deux seules personnes qui y ont
  // droit. Rend le bid, ou une réponse d'erreur — la même règle pour les quatre
  // portes de document, écrite une fois.
  async function conversationPour(request, query, qui) {
    const id = query.id;
    const dateISO = query.dateISO;
    if (qui === domain.CHAT_FROM.CLIENT) {
      const auth = requireClient(request, id);
      if (auth.error) return { error: auth.error };
    }
    let notaryId = null;
    if (qui === domain.CHAT_FROM.NOTAIRE) {
      notaryId = requireScope(bearer(request), SCOPES.SESSION);
      if (!notaryId) return { error: json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] }) };
    }
    const bid = id && dateISO ? await repo.get(id, dateISO) : null;
    if (!bid) return { error: json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] }) };
    if (bid.status === domain.STATUS.ANNULEE) return { error: goneCancelled() };
    if (qui === domain.CHAT_FROM.NOTAIRE && bid.notaryId !== notaryId) {
      return { error: json(403, { errors: [{ code: 'interdit', message: 'Conversation réservée au notaire qui a retenu l’offre.' }] }) };
    }
    return { bid, notaryId };
  }

  // Qui agit dans une conversation : le notaire par son identifiant, le client
  // par l'offre — il n'a pas de compte, son dossier EST son nom. Une seule
  // définition pour le dépôt et pour la lecture, sinon les deux traces
  // nommeraient les mêmes personnes différemment.
  const acteurPartie = (qui, bid, notaryId, request) =>
    (qui === domain.CHAT_FROM.NOTAIRE
      ? acteur(ACTEUR.NOTAIRE, notaryId, request)
      : acteur(ACTEUR.CLIENT, bid && bid.id, request));

  // Étape 1 — l'autorisation de dépôt. Le domaine décide de la recevabilité
  // AVANT qu'une seule URL soit émise : refuser après un téléversement de 15 Mo
  // est la pire réponse possible.
  async function ouvrirDepot(request, payload, qui) {
    if (!storage) return storageIndisponible();
    const { bid, error } = await conversationPour(request, payload || {}, qui);
    if (error) return error;
    const v = domain.validateChatDocument({ bid, de: qui, nom: payload.nom, taille: payload.taille, type: payload.type });
    if (!v.ok) return json(422, { errors: v.errors });

    const doc = {
      id: newId(),
      de: qui,
      nom: v.nom,
      taille: v.taille,
      contentType: v.contentType,
      // « en attente » tant que le dépôt n'a pas été CONSTATÉ : un document
      // annoncé n'est pas un document reçu, et l'autre partie ne doit jamais
      // voir une pièce qui n'existe pas.
      etat: 'en_attente',
      createdAt: new Date(nowMs()).toISOString(),
    };
    const cle = domain.documentStorageKey(bid.id, doc.id, doc.nom);
    await repo.update({ ...bid, documents: [...documentsOf(bid), { ...doc, cle }] });
    const depot = await storage.presignUpload({
      cle, contentType: v.contentType, maxBytes: v.taille, expiresInSeconds: 300,
    });
    return json(200, { document: publicDocument(doc), depot });
  }

  // Étape 2 — la confirmation. Le serveur CONSTATE le dépôt dans le stockage ;
  // il ne croit pas le navigateur sur parole. Sans cela, n'importe qui pourrait
  // faire apparaître dans le fil une pièce qui n'a jamais été téléversée.
  async function confirmerDepot(request, payload, qui) {
    if (!storage) return storageIndisponible();
    const { bid, notaryId, error } = await conversationPour(request, payload || {}, qui);
    if (error) return error;
    const docs = documentsOf(bid);
    const doc = docs.find((d) => d.id === payload.documentId && d.de === qui);
    if (!doc) return json(404, { errors: [{ code: 'document_introuvable', message: 'Document introuvable.' }] });

    const tete = await storage.head(doc.cle);
    if (!tete) {
      return json(422, { errors: [{ code: 'depot_absent', message: 'Le fichier n’est pas arrivé — réessayez le téléversement.' }] });
    }
    const pret = { ...doc, etat: 'pret', taille: tete.taille || doc.taille };
    await repo.update({ ...bid, documents: docs.map((d) => (d.id === doc.id ? pret : d)) });
    await appendAudit(
      'document_depose',
      { bidId: bid.id, documentId: doc.id, de: qui, taille: pret.taille },
      acteurPartie(qui, bid, notaryId, request)
    );
    // Prévenir l'autre partie, comme pour un message — au même endroit et par
    // le même chemin, pour qu'un document ne soit pas un événement de second
    // rang qu'on découvre en rouvrant le fil.
    const dn = notifier();
    if (dn && typeof dn.onChatDocument === 'function') {
      Promise.resolve(dn.onChatDocument(bid, pret)).catch(() => {});
    }
    return json(200, { document: publicDocument(pret) });
  }

  // La lecture. L'autorisation est brève et l'accès a déjà été décidé ici : une
  // URL signée est un secret porteur, jamais une frontière d'autorisation.
  async function ouvrirLecture(request, query, qui) {
    if (!storage) return storageIndisponible();
    const { bid, notaryId, error } = await conversationPour(request, query || {}, qui);
    if (error) return error;
    const doc = documentsOf(bid).find((d) => d.id === query.documentId && d.etat === 'pret');
    if (!doc) return json(404, { errors: [{ code: 'document_introuvable', message: 'Document introuvable.' }] });
    const lecture = await storage.presignDownload({ cle: doc.cle, nom: doc.nom, expiresInSeconds: 120 });
    await appendAudit(
      'document_lu',
      { bidId: bid.id, documentId: doc.id, par: qui, notaryId: notaryId || null },
      acteurPartie(qui, bid, notaryId, request)
    );
    return json(200, { document: publicDocument(doc), lecture });
  }

  const messagesOf = (b) => (Array.isArray(b.messages) ? b.messages : []);
  const chatMessage = (m) => ({ id: m.id, de: m.de, texte: m.texte, createdAt: m.createdAt });

  // Parse a JSON body; returns { payload } or { error: <400 response> }.
  function parseBody(request) {
    try {
      return { payload: typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {} };
    } catch {
      return { error: json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] }) };
    }
  }

  // The one answer every route gives about a bid the client withdrew.
  const goneCancelled = () =>
    json(410, { errors: [{ code: 'offre_annulee', message: 'Cette offre a été annulée par le client.' }] });

  // Verify a per-bid CLIENT token against the bid id it claims to act on.
  // Returns { error } (401 / 403) or {} when the token is the owner's.
  function requireClient(request, bidId) {
    const sub = requireScope(bearer(request), SCOPES.CLIENT);
    if (!sub) return { error: json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] }) };
    if (!bidId || sub !== String(bidId)) {
      return { error: json(403, { errors: [{ code: 'interdit', message: 'Ce jeton ne donne pas accès à cette offre.' }] }) };
    }
    return {};
  }

  // The ONE retention path, shared by /notary/bids/accept and a client accepting
  // a proposition. Conditional retain (closes the TOCTOU race: the repo flips
  // the bid only while it is still ouverte), then the retained-calendar pointer,
  // the analytics rollup and the client's "offer retained" email. `extra` are
  // additional fields folded into the same conditional write (a proposition
  // accept rewrites montant/premium/propositions atomically with the status).
  // Returns the retained bid, or null when the bid was no longer ouverte.
  // `qui` est l'acteur de la piste d'audit : DEUX portes mènent ici — le notaire
  // qui accepte une demande ouverte, et le client qui accepte une proposition.
  // La trace `acte_retenu` nomme celle qui a été franchie, pas seulement le
  // notaire qui se retrouve engagé.
  async function retainFor(bid, notaryId, extra = {}, qui) {
    const profile = await repo.getNotary(notaryId);
    const updated = {
      ...bid,
      ...extra,
      status: domain.STATUS.RETENUE,
      notaryId,
      etude: domain.notaryEtude(profile) || notaryId,
    };
    // L'INSTANT de l'engagement. Sans lui, la piste d'audit ne peut pas dire
    // quand un notaire s'est engagé — seulement qu'il l'a fait.
    updated.retainedAt = new Date(nowMs()).toISOString();
    // ADR 0031 — il n'y a PLUS de taux à graver. Jusqu'au 1er septembre 2026,
    // la rétention estampillait `tauxRetenu` et `coteRetenue` sur l'offre :
    // le notaire s'engageait en voyant un pourcentage que sa cote avait mérité.
    // C'est exactement la convention que l'art. 29.1 du Code de déontologie
    // interdit — « aucune convention ayant pour effet de mettre en péril
    // l'indépendance, le désintéressement, l'objectivité et l'intégrité ». Le
    // prix de Nota est désormais un montant fixe, identique pour tous : rien
    // ne dépend du notaire, donc rien n'a besoin d'être figé à son engagement.
    const retained = await repo.retain(updated, notaryId);
    if (!retained) return null;
    await appendAudit('acte_retenu', {
      bidId: retained.id,
      dateISO: retained.dateISO,
      notaryId,
      serviceId: retained.serviceId || null,
      montant: retained.montant,
      etude: retained.etude || null,
    }, qui);
    await repo.putRetained(notaryId, {
      id: retained.id,
      dateISO: retained.dateISO,
      serviceId: retained.serviceId,
      montant: retained.montant,
    });
    await recordStats(statsDeltasForRetain(retained, now()));
    await recordReferralEarnings(retained, notaryId, profile);
    // Tell the client a notary retained their offer (fire-and-forget; never blocks
    // or fails the response), mirroring the onOfferCreated call in POST /bids.
    const rn = notifier();
    if (rn) Promise.resolve(rn.onOfferRetained(retained, { notary: profile })).catch(() => {});
    return retained;
  }

  // Durable referral earnings (ADR 0011): retention is the earning moment for
  // BOTH reward tracks, so the money owed is recorded here, at event time —
  // the admin ledger reads these back as ALL-TIME truth instead of losing an
  // earning the day its signing date scrolls out of the live month window.
  // Write-once per (code, track, ref) in the repo, so the handler never needs
  // its own replay guard. Best-effort, same contract as recordStats: a ledger
  // failure — including an older repo without the method — can NEVER break the
  // retain; the live window still shows recent earnings while a heal catches up.
  async function recordReferralEarnings(bid, notaryId, profile) {
    if (typeof repo.recordReferralEarning !== 'function') return;
    // FRAUD BARRIER (ADR 0011): an earning may only accrue on a demand that is
    // actually LIVE — i.e. the client's card was authorized (pay-on-accept) or
    // billing is off entirely (legacy/demo, where every bid is live). The ADR's
    // whole defence against staged referrals is "under pay-on-accept a retention
    // authorises real money, so a fake 'accepted' demand is not free to stage";
    // a bid still `pending` (never taken through Checkout) is exactly that fake,
    // so it earns nothing on EITHER track. This is the payment barrier the ADR
    // relies on, enforced at the one place money is recorded.
    if (!isLive(bid)) return;
    try {
      // Client track: the retained bid carries the partner code -> flat
      // REFERRAL.client, once per bid.
      if (domain.isReferralCode(bid.parrain)) {
        await repo.recordReferralEarning({
          code: domain.normalizeReferralCode(bid.parrain),
          track: 'client',
          refId: bid.id,
          montant: domain.REFERRAL.client,
          at: now(),
        });
      }
      // Notaire track: the retaining notary was referred -> flat
      // REFERRAL.notaire on their FIRST retained act, once ever per notary
      // (the write-once earning IS that rule). The profile is stamped with the
      // durable premierActe marker so the fact also lives on the record itself.
      if (profile && domain.isReferralCode(profile.parrain) && !profile.premierActe) {
        const first = await repo.recordReferralEarning({
          code: domain.normalizeReferralCode(profile.parrain),
          track: 'notaire',
          refId: notaryId,
          montant: domain.REFERRAL.notaire,
          at: now(),
        });
        if (first) await repo.putNotary({ ...profile, premierActe: true, premierActeAt: now() });
      }
    } catch {
      /* swallow: the referral ledger must never affect the retain path */
    }
  }

  // The list of month strings (YYYY-MM) the notary open-bid feed scans, starting
  // at `startMonth` and running `count` months forward. One Query per month.
  function monthWindow(startMonth, count) {
    const [y, m] = startMonth.split('-').map(Number);
    const months = [];
    for (let i = 0; i < count; i += 1) {
      const d = new Date(Date.UTC(y, m - 1 + i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    return months;
  }

  // Shared CORS headers so a JSON response and a bodiless 204 preflight agree.
  function corsHeaders() {
    return {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
    };
  }

  function json(statusCode, obj) {
    return {
      statusCode,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...corsHeaders(),
        'cache-control': 'no-store',
      },
      body: JSON.stringify(obj),
    };
  }

  // A text/calendar (iCalendar) response for a webcal feed. Content-Disposition
  // makes a direct browser navigation download the .ics with a filename;
  // webcal/Google/Outlook subscribe paths fetch server-side and ignore it.
  function calendar(statusCode, body, filename = 'nota-carnet.ics') {
    return {
      statusCode,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        ...corsHeaders(),
        'cache-control': 'no-store',
      },
      body,
    };
  }

  // RFC 5545 DTSTAMP (UTC, second precision) — required per VEVENT; Outlook
  // silently drops events without it. Derived from the injectable clock.
  function icsStamp() {
    return new Date(nowMs()).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  }

  // A minimal fr-CA confirmation page for the unsubscribe link (opened in a
  // browser from an email footer, so HTML rather than JSON).
  function htmlPage(statusCode, title, message) {
    const body =
      '<!doctype html><html lang="fr-CA"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' +
      title +
      ' — Nota</title></head>' +
      '<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#eef2f5;margin:0;padding:48px 16px;">' +
      '<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dce4ea;border-radius:12px;padding:28px 24px;">' +
      '<h1 style="margin:0 0 12px;font-size:20px;color:#16232f;">' +
      title +
      '</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#5b6b7b;">' +
      message +
      '</p></div></body></html>';
    return {
      statusCode,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      body,
    };
  }

  async function handle(request) {
    const method = (request.method || 'GET').toUpperCase();
    // CloudFront routes /api/* to this Lambda so the site is single-origin.
    // Strip that prefix so routes are declared once, prefix-agnostic.
    const route = (request.path || '/').replace(/^\/api(?=\/|$)/, '') || '/';
    const query = request.query || {};

    // A 204 must carry no body (a `{}` body is a protocol violation), so return
    // the bare CORS headers rather than routing through json().
    if (method === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };

    // Guard oversized bodies before any JSON.parse below.
    if (typeof request.body === 'string' && Buffer.byteLength(request.body) > MAX_BODY_BYTES) {
      return json(413, { errors: [{ code: 'corps_trop_grand', message: 'Le corps de la requête est trop volumineux.' }] });
    }

    // The public API never serves the admin surface — that lives on its own
    // Lambda (admin-handler.js) behind admin.nota.ca. Refuse /admin/* here so
    // this internet-facing function can never be coaxed into admin behaviour.
    if (/^\/admin(\/|$)/.test(route)) {
      return json(404, { errors: [{ code: 'introuvable', message: 'Route inconnue.' }] });
    }

    if (route === '/health' && method === 'GET') {
      return json(200, { ok: true, today: now() });
    }

    if (route === '/bids' && method === 'GET') {
      const month = query.month || now().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return json(400, { errors: [{ code: 'mois_invalide', message: 'Le paramètre « month » doit être au format AAAA-MM.' }] });
      }
      const bids = await repo.listByMonth(month);
      // A cancelled bid left the market: it stays readable by its owner via
      // /client/bid but never reappears on the public carnet.
      return json(200, {
        month,
        bids: bids.filter((b) => isLive(b) && b.status !== domain.STATUS.ANNULEE).map(publicBid),
        // Le carnet est la PREMIÈRE réponse que le navigateur reçoit : le tarif
        // y voyage pour qu'aucune surface n'ait à coder un prix en dur ni à
        // deviner ce que le client paiera en plus de son offre.
        tarif: await tarifNota(),
      });
    }

    if (route === '/bids' && method === 'POST') {
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }

      const todayISO = now();
      // Authoritative revalidation. The client computed a tier and total; we
      // recompute from scratch and reject on any discrepancy the rules catch.
      const v = domain.validateOffer({
        serviceId: payload.serviceId,
        dateISO: payload.dateISO,
        montant: payload.montant,
        courriel: payload.courriel,
        // REQUIRED: the bid's only location signal (see domain.validateOffer —
        // without it the déplacement band cannot be related to a notary radius).
        prefixe: payload.prefixe,
        // Dynamic pricing criteria (part of the dossier): the server recomputes
        // the floor from these, never trusting the client's base/total.
        pricing: payload.pricing,
        todayISO,
      });
      const errors = [...v.errors];

      // OPTIONAL telephone (ADR 0010 §4, mise en relation): the number the
      // RETAINING notary will dial, released only with the dossier. The rule
      // is the domain's (`validateTelephone`, shared with the notary profile):
      // stripped of its formatting, a dialable North-American number must
      // remain; what the client typed is stored trimmed, formatting kept.
      const telV = domain.validateTelephone(payload.telephone);
      if (!telV.ok) errors.push(telV.error);
      const telephone = telV.value;
      if (errors.length) return json(422, { errors });

      // Referral attribution (ADR 0011): a partner's code rides along on the
      // POST as `parrain` — from their `?ref=CODE` link or typed by hand in
      // the booking form. Normalize + validate through the domain and keep it
      // ONLY when it is a real code — an invalid or absent code is silently
      // dropped, because a broken referral link must never cost a booking. The
      // code is PRIVATE marketing data: never on the public carnet, never shown
      // to a notary, never echoed back to the client.
      let parrain = domain.isReferralCode(payload.parrain)
        ? domain.normalizeReferralCode(payload.parrain)
        : null;
      // Self-referral guard: a registered partner booking with their own code
      // earns nothing — the attribution is dropped, the booking goes through.
      if (parrain && v.courriel) {
        const owner = await repo.getPartner(parrain);
        if (owner && owner.courriel === v.courriel.toLowerCase()) parrain = null;
      }

      const anonyme = payload.anonyme !== false; // default anonymous
      const bid = {
        id: newId(),
        serviceId: payload.serviceId,
        dateISO: payload.dateISO,
        montant: v.montant,
        tier: v.tier,
        premium: v.premium,
        anonyme,
        // The name is stored even for an anonymous bid: anonymity is a PUBLIC
        // promise (publicBid() nulls the name whenever `anonyme` is true), not
        // an identity blackout — the notary who retains the demand needs to
        // know who they are meeting, exactly like the dossier and courriel are
        // released to the retaining notary only (ADR 0010 §4).
        nom: String(payload.nom || '').trim().slice(0, 120) || null,
        prefixe: v.prefixe, // normalized by validateOffer; never null past the 422 gate
        // PRIVATE: used only for notifications and the mise en relation, never
        // surfaced by publicBid().
        courriel: v.courriel ? v.courriel.toLowerCase() : null,
        // PRIVATE: the client's phone, released with the dossier to the
        // retaining notary only (see the telephone validation above).
        telephone: telephone || null,
        // PRIVATE: the partner referral code (ADR 0011) — admin analytics fold
        // it into the referral ledger; no public or notary projection carries it.
        parrain,
        // PRIVATE: the structured intake the client assembled (field values +
        // any documents/consent). Released ONLY to the notary who retains the
        // bid; it MUST NEVER appear in publicBid() / GET /bids.
        // Whatever the payload carries, only the service's own items, consent
        // and known pricing answers are stored, each value bounded
        // (domain.cleanDossier) — unknown keys and local UI state never reach
        // the record the retaining notary receives.
        dossier:
          payload.dossier && typeof payload.dossier === 'object' && !Array.isArray(payload.dossier)
            ? domain.cleanDossier(payload.serviceId, payload.dossier)
            : null,
        // PRIVATE: the pricing criteria answers (part of the dossier — "the
        // document merged with the process"). Released with the dossier to the
        // retaining notary; NEVER in publicBid(). The authoritative floor was
        // already recomputed from these in validateOffer above.
        pricing:
          payload.pricing && typeof payload.pricing === 'object' && !Array.isArray(payload.pricing)
            ? payload.pricing
            : null,
        // The server-derived floor this offer was validated against.
        basePrice: v.basePrice,
        status: domain.STATUS.OUVERTE,
        etude: null,
        notaryId: null,
        // PRIVATE: notary propositions (counter-offers) and document requests on
        // this bid. Projected per audience (see notaryProposition/clientProposition).
        propositions: [],
        demandes: [],
        createdAt: todayISO,
        // DynamoDB TTL (epoch seconds): auto-delete ~13 months after the signing
        // date — Law 25 retention + zero storage cost for stale bids. Never
        // exposed publicly (not in publicBid/notaryBid).
        ttl: Math.floor(Date.parse(payload.dateISO + 'T00:00:00Z') / 1000) + 400 * 86400,
      };
      // Pay-on-accept: with billing on, a posted offer is PENDING until the client
      // authorizes their card via hosted Checkout — the webhook then binds the
      // PaymentIntent and the offer goes live (isLive). Without billing (demo/tests)
      // the offer is live immediately, exactly as before.
      if (billingConfigured) {
        // La même garde que le lien magique notaire et la réclamation
        // partenaire : sans origine publique, Stripe n'a pas où renvoyer le
        // client. Refuser franchement vaut mieux qu'une offre créée dont le
        // paiement ne pourra jamais aboutir — « Mes offres » la montrerait
        // comme vivante, en attente d'un notaire qui ne la verra jamais.
        if (lienImpossible(siteUrl, false)) {
          return json(503, {
            errors: [{
              code: 'configuration_incomplete',
              message: 'La publication est momentanément indisponible (configuration incomplète). Réessayez plus tard — rien n’a été débité.',
            }],
          });
        }
        bid.paymentStatus = 'pending';
      }
      await repo.put(bid);
      await recordStats(statsDeltasForOffer(bid));
      await recordStats(statsDeltasForFunnel('publie', now())); // the funnel's « publié » step is counted HERE, never trusted from the client beacon

      // Fire-and-forget: confirm the offer to the client + alert the operator.
      // Never awaited and never allowed to reject the response — if mail fails
      // the offer is still created and returned.
      const n = notifier();
      if (n) Promise.resolve(n.onOfferCreated(bid)).catch(() => {});

      // The client's per-bid key (no account): scope CLIENT, sub = bid id. It is
      // returned ONCE here and never echoed by any other route.
      const clientTokenExp = nowMs() + CLIENT_TOKEN_TTL_MS;
      const clientToken = signToken(bid.id, clientTokenExp, SCOPES.CLIENT);
      // Ce jeton ouvre le dossier — messagerie et documents compris — pendant
      // plus d'un an, et il n'est rendu qu'ICI. Son émission est donc le premier
      // fait de la chaîne d'accès : sans elle, une lecture ultérieure ne se
      // rattache à rien. Le jeton lui-même n'est jamais consigné ; ce que la
      // trace porte, c'est l'offre qu'il ouvre et jusqu'à quand.
      await appendAudit(
        'client_jeton_emis',
        { bidId: bid.id, dateISO: bid.dateISO, expiresAt: clientTokenExp },
        acteur(ACTEUR.CLIENT, bid.id, request)
      );

      if (billingConfigured) {
        const svc = domain.serviceById(bid.serviceId);
        // ADR 0031 — la carte autorise LES DEUX LIGNES : les honoraires du
        // notaire (le montant offert, qui lui revient en entier) et le prix du
        // service de Nota. Autoriser les seuls honoraires sous-facturerait le
        // client au moment de la capture.
        const devis = await billing().quoteOffer(bid.montant);
        let auth;
        try {
          auth = await billing().authorizeOffer({
            bidId: bid.id,
            bidDate: bid.dateISO,
            amountCents: devis.totalCents,
            email: bid.courriel || undefined,
            description: (svc && svc.nom) || 'Acte notarié',
            successUrl: siteUrl ? siteUrl + '/?paiement=ok' : undefined,
            cancelUrl: siteUrl ? siteUrl + '/?paiement=annule' : undefined,
          });
        } catch {
          // Une panne de l'intermédiaire de paiement n'est pas une erreur du
          // client : elle se dit, et l'offre n'est pas publiée à moitié.
          return json(503, { errors: [{ code: 'paiement_indisponible', message: 'Le paiement est momentanément indisponible. Réessayez dans quelques minutes — rien n’a été débité.' }] });
        }
        if (!auth.ok) return json(422, { errors: auth.errors });
        return json(201, { bid: publicBid(bid), clientToken, paymentStatus: 'pending', checkoutUrl: auth.url });
      }

      return json(201, { bid: publicBid(bid), clientToken });
    }

    // The referral program's front door (ADR 0011), now EMAIL-VERIFIED to close
    // two fraud vectors: CODE SQUATTING (grabbing a real broker's obvious code
    // before they register, then collecting their genuine referrals — reward
    // mail follows the registered courriel) and HARVEST-THEN-CLAIM (farming
    // earnings on a vanity code, then claiming it to become the payee). Claiming
    // is now a TWO-step, mailbox-proven handshake mirroring the notary sign-in:
    //   • Step 1 (here) — validate type/courriel/code, per-IP rate-limit, then
    //     mint a single-use challenge tied to (code, email) and EMAIL a
    //     confirmation link. NO partner record is written yet, so an unverified
    //     claim never becomes the payee and never permanently blocks the real
    //     owner.
    //   • Step 2 (/partenaires/verify) — redeem the link, atomically consume the
    //     challenge, and only THEN write the confirmed partner record.
    // Enumeration honesty: a code already CONFIRMED by someone else answers 409
    // (you cannot claim a taken code — the one unavoidable disclosure, matching
    // the old UX); a FREE code and a merely-PENDING code are indistinguishable —
    // both get the generic { ok: true } (+ dev echo outside production). A bad
    // code still never costs anything (422 only on a malformed request).
    if (route === '/partenaires' && method === 'POST') {
      if (lienImpossible(PARTNER_CLAIM_URL, PARTNER_CLAIM_DEV_ECHO)) return json(503, { errors: [CONFIG_INCOMPLETE] });
      const { payload, error } = parseBody(request);
      if (error) return error;

      // Throttle FIRST, keyed on the trusted source IP, so a hostile client
      // cannot spam confirmation links regardless of which codes it guesses.
      // Fail OPEN on a counter error — availability over strictness, exactly like
      // the notary login path.
      const ip = clientIp(request);
      let count = 1;
      try {
        count = await repo.incrPartnerRateCounter('partner_claim', ip || 'unknown', PARTNER_CLAIM_RL_WINDOW_SEC, nowMs());
      } catch {
        count = 1;
      }
      if (count > PARTNER_CLAIM_RL_MAX) {
        // Même règle que la porte du notaire : seul le FRANCHISSEMENT est
        // journalisé, pour qu'un flot hostile ne puisse pas gonfler le journal.
        // Le code n'est pas encore lu à ce stade — la limite s'applique avant.
        if (count === PARTNER_CLAIM_RL_MAX + 1) {
          await appendAudit('partenaire_reclamation', { code: null, type: null, throttled: true }, acteur(ACTEUR.PARTENAIRE, null, request));
        }
        return json(429, { ok: true, throttled: true });
      }

      const errors = [];
      const type = String(payload.type || '').trim();
      if (!domain.REFERRAL.partners.some((p) => p.id === type)) {
        errors.push({ code: 'type_inconnu', message: 'Choisissez une catégorie de partenaire valide.' });
      }
      const courriel = String(payload.courriel || '').trim().toLowerCase();
      if (!domain.isEmail(courriel)) {
        errors.push({ code: 'courriel_invalide', message: 'Le courriel n’est pas valide.' });
      }
      const code = domain.normalizeReferralCode(payload.code);
      if (!domain.isReferralCode(payload.code)) {
        errors.push({ code: 'code_invalide', message: 'Le code doit compter de 4 à 12 lettres ou chiffres.' });
      }
      if (errors.length) return json(422, { errors });

      // La trace de la réclamation, posée dès que la demande est BIEN FORMÉE et
      // avant tout aiguillage : un code déjà pris, un notaire inadmissible et un
      // code libre sont trois issues d'une même tentative, et c'est la tentative
      // qu'un audit du programme de parrainage doit pouvoir relire. Le code est
      // le nom du partenaire ici — son courriel n'entre pas dans le journal.
      await appendAudit(
        'partenaire_reclamation',
        { code, type, throttled: false },
        acteur(ACTEUR.PARTENAIRE, code, request)
      );

      // ADR 0030 — art. 33 du Code de déontologie des notaires : hors la
      // rémunération et les commissions auxquelles il a droit, le notaire ne
      // peut ni verser ni recevoir « tout autre avantage » relatif à l'exercice
      // de sa profession. Une récompense de parrainage en est un. Un notaire
      // qui réclame un code serait donc mis en défaut PAR NOUS — le produit
      // refuse la réclamation, en disant pourquoi. Le courriel est la seule
      // clé dont nous disposons ; ce n'est pas un contrôle infaillible, c'est
      // celui qui ne coûte rien à un partenaire qui n'est pas notaire.
      const dejaNotaire = await repo.getNotary(notaryIdForEmail(courriel));
      if (dejaNotaire) {
        return json(422, {
          errors: [{
            code: 'notaire_non_admissible',
            message: 'Le programme de parrainage n’est pas ouvert aux notaires : le Code de déontologie interdit au notaire de recevoir un avantage lié à l’exercice de sa profession. Votre espace notaire, lui, reste ouvert.',
          }],
        });
      }

      // A CONFIRMED (mailbox-proven) owner already holds this code?
      //  • same courriel  -> the owner re-visiting: idempotent 200 with what is
      //    on file (re-fire the welcome) — no re-verification needed.
      //  • other courriel -> the code is owned; 409 code_deja_pris.
      // A pending-only claim is NOT a confirmed owner, so it does not block here.
      const existing = await repo.getPartner(code);
      if (existing && existing.confirmedAt) {
        if (existing.courriel === courriel) {
          const pn = notifier();
          if (pn) Promise.resolve(pn.onPartnerRegistered(existing)).catch(() => {});
          return json(200, {
            partenaire: { code: existing.code, type: existing.type, courriel: existing.courriel, createdAt: existing.createdAt },
            confirmed: true,
          });
        }
        return json(409, { errors: [{ code: 'code_deja_pris', message: 'Ce code est déjà réservé. Choisissez-en un autre.' }] });
      }

      // Free or merely-pending: mint a single-use claim challenge tied to (code,
      // email) and email the confirmation link. NO PARTNER# record is written —
      // only /partenaires/verify writes it. Several pending claims on a free code
      // can coexist; whoever VERIFIES first wins (createPartner is write-once).
      const cid = newId();
      const exp = nowMs() + PARTNER_CLAIM_TTL_MS;
      await repo.putPartnerClaim({
        challengeId: cid,
        code,
        type,
        courriel,
        createdAt: new Date(nowMs()).toISOString(),
        expiresAt: exp,
        consumed: false,
        ttl: Math.floor(exp / 1000) + 60, // let DynamoDB reap it shortly after expiry
      });

      // The link carries the CHALLENGE token in the hash (never a query string,
      // which is logged); the web app consumes `#pauth=` on load and calls verify.
      // `sub` is the code, so verify can cross-check the consumed claim.
      const token = signChallengeToken(code, cid, exp);
      const link = PARTNER_CLAIM_URL + '/#pauth=' + encodeURIComponent(token);

      // Best-effort send on the shared branded template; a mail failure never
      // changes the (generic) response — the partner can request another link.
      const pn = notifier();
      if (pn && typeof pn.onPartnerClaimRequested === 'function') {
        Promise.resolve(
          pn.onPartnerClaimRequested({ email: courriel, link, code, ttlMinutes: Math.round(PARTNER_CLAIM_TTL_MS / 60000) })
        ).catch(() => {});
      }

      // Dev echo (never in production): hand the link + raw token back so tests
      // and `npm run api:local` confirm a code with no mailbox.
      // `ttlMinutes` is the link's real lifetime, so the pane can say how long
      // the emailed link stays valid instead of guessing (audit 2026-09-02,
      // P1-6). Safe on the generic path too: it leaks nothing about the code.
      const body = { ok: true, ttlMinutes: Math.round(PARTNER_CLAIM_TTL_MS / 60000) };
      if (PARTNER_CLAIM_DEV_ECHO) {
        body.devLink = link;
        body.devToken = token;
      }
      return json(200, body);
    }

    // Step 2 — redeem the confirmation link and WRITE the confirmed partner
    // record. Single-use: the challenge is atomically consumed, so a replayed or
    // expired link is rejected, and a forged/tampered token never verifies. Only
    // here does a code become a payee of record (write-once createPartner + the
    // sparse GSI1 attrs + a `confirmedAt` stamp), and only here is the welcome/
    // operator mail sent — mirroring /notary/session/verify.
    if (route === '/partenaires/verify' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;

      const claims = verifyToken(String(payload.token || ''), nowMs());
      if (!claims || claims.scope !== SCOPES.CHALLENGE || !claims.cid) {
        return json(401, { errors: [{ code: 'lien_invalide', message: 'Lien invalide ou expiré.' }] });
      }

      // Atomic single-use consume: the FIRST redemption wins, a replay gets null.
      const claim = await repo.consumePartnerClaim(claims.cid, nowMs());
      if (!claim || domain.normalizeReferralCode(claim.code) !== claims.sub) {
        return json(401, { errors: [{ code: 'lien_invalide', message: 'Lien invalide ou déjà utilisé.' }] });
      }

      const code = domain.normalizeReferralCode(claim.code);

      // ADR 0030 (art. 33) — le refus posé à l'étape 1 ne suffit pas : c'est
      // ICI qu'un code devient le PAYEUR DE RECORD, et le profil notaire a pu
      // naître entre la réclamation et sa confirmation. On revérifie donc au
      // moment qui compte, celui de l'écriture.
      if (await repo.getNotary(notaryIdForEmail(claim.courriel))) {
        return json(422, {
          errors: [{
            code: 'notaire_non_admissible',
            message: 'Le programme de parrainage n’est pas ouvert aux notaires : le Code de déontologie interdit au notaire de recevoir un avantage lié à l’exercice de sa profession. Votre espace notaire, lui, reste ouvert.',
          }],
        });
      }

      const partenaire = { code, type: claim.type, courriel: claim.courriel, createdAt: now(), confirmedAt: now() };
      if (await repo.createPartner(partenaire)) {
        // La seule écriture qui fait d'un code un PAYEUR DE RECORD. Sans elle,
        // le registre des gains ne peut pas dire quand ni d'où le bénéficiaire
        // a été désigné.
        await appendAudit(
          'partenaire_confirme',
          { code, type: partenaire.type, challengeId: claims.cid },
          acteur(ACTEUR.PARTENAIRE, code, request)
        );
        // Welcome the partner (their shareable link + the reward tracks) and
        // alert the operator. Fire-and-forget, like every send-point: mail must
        // never break the confirmation response.
        const pn = notifier();
        if (pn) Promise.resolve(pn.onPartnerRegistered(partenaire)).catch(() => {});
        return json(201, { partenaire });
      }
      // Someone else CONFIRMED this code between the request and this verify (the
      // write-once create lost the race). Same courriel -> idempotent 200; anyone
      // else -> the code now belongs to the other, verified owner.
      const owner = await repo.getPartner(code);
      if (owner && owner.courriel === partenaire.courriel) {
        const pn = notifier();
        if (pn) Promise.resolve(pn.onPartnerRegistered(owner)).catch(() => {});
        return json(200, {
          partenaire: { code: owner.code, type: owner.type, courriel: owner.courriel, createdAt: owner.createdAt },
          confirmed: true,
        });
      }
      return json(409, { errors: [{ code: 'code_deja_pris', message: 'Ce code est déjà réservé. Choisissez-en un autre.' }] });
    }

    // Welcome a client who just signed up (email captured in the sign-in modal,
    // no offer posted yet). Fire-and-forget welcome email, idempotent per address
    // in the notifier. Always answers 200 {ok:true} so the modal never blocks on
    // mail: a missing/invalid address is a silent no-op, not an error the UI must
    // handle, and no data is echoed back.
    if (route === '/client/welcome' && method === 'POST') {
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      const email = String(payload.courriel || payload.email || '').trim().toLowerCase();
      if (email && domain.isEmail(email)) {
        const n = notifier();
        if (n) Promise.resolve(n.onClientSignup(email)).catch(() => {});
      }
      return json(200, { ok: true });
    }

    // --- Free signup by professional email (2026-09-02) ----------------------
    // The supply-side front door no longer goes through Stripe. Asking a notary
    // for a passport and a bank account before they have even SEEN the demand
    // was the biggest churn wall on the supply side — and with Stripe not
    // configured in production, a wall with no door. The sequence is now:
    // sign up here (email + optional CNQ fiche) → the operator vets the
    // Tableau de l'Ordre and activates from the admin console (`approuveLe`,
    // which is what notaryGate reads) → the notary signs in and works →
    // payouts connect later, on /notaries/connect, only before a first act is
    // marked signed. Enumeration-safe: a valid address always answers the same
    // `{ ok: true }`, whether it is new, pending, or already active.
    if (route === '/notaries/signup' && method === 'POST') {
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      const email = String(payload.email || '').trim().toLowerCase();

      // Throttle FIRST, on the trusted source IP — same window and ceiling as
      // the sign-in request; fail OPEN on a counter error.
      const ip = clientIp(request);
      let count = 1;
      try {
        count = await repo.incrNotaryRateCounter('notary_signup', ip || email || 'unknown', NOTARY_LOGIN_RL_WINDOW_SEC, nowMs());
      } catch {
        count = 1;
      }
      if (count > NOTARY_SIGNUP_RL_MAX) return json(429, { ok: true, throttled: true });

      if (!domain.isEmail(email)) {
        return json(422, { errors: [{ code: 'courriel_invalide', message: 'Le courriel n’est pas valide.' }] });
      }
      // The optional fiche link is judged by the domain's own CNQ rule (ADR
      // 0016) — the same one the profile form applies later. Only that rule's
      // verdict matters here: the rest of the profile is not on the form.
      const fiche = domain.validateNotaryProfile({ lienCNQ: payload.lienCNQ });
      const ficheErrors = fiche.errors.filter((e) => e.code === 'lien_cnq_invalide');
      if (ficheErrors.length) return json(422, { errors: ficheErrors });
      const lienCNQ = fiche.lienCNQ || null;

      // Referral (ADR 0011): normalized through the domain, an invalid code is
      // silently dropped, and a partner signing up with their own code earns
      // nothing — exactly the rules of /notaries/connect.
      let parrain = domain.isReferralCode(payload.parrain) ? domain.normalizeReferralCode(payload.parrain) : null;
      if (parrain) {
        const owner = await repo.getPartner(parrain);
        if (owner && owner.courriel === email) parrain = null;
      }

      const notaryId = notaryIdForEmail(email);
      const existing = await repo.getNotary(notaryId);
      const at = new Date(nowMs()).toISOString();
      let created = false;
      if (!existing) {
        await repo.putNotary({
          id: notaryId, email, label: email, role: 'notary',
          status: 'en_attente', inscritLe: at, lienCNQ, parrain, createdAt: at,
        });
        await recordStats(statsDeltasForNotaryOnboarding());
        // The funnel's last step is counted on the FIRST signup only.
        await recordStats(statsDeltasForFunnel('notaire_inscrit', now()));
        created = true;
      } else if ((!existing.lienCNQ && lienCNQ) || (!existing.parrain && parrain)) {
        // An existing record only gains what it lacked — never a status
        // change (no downgrade of an active or approved notary), never a
        // second attribution.
        await repo.putNotary({
          ...existing,
          lienCNQ: existing.lienCNQ || lienCNQ,
          parrain: existing.parrain || parrain,
          updatedAt: at,
        });
      }

      // Mail — fire-and-forget, and only while the file is still waiting for
      // the operator: an already-approved (or Stripe-active) notary who hits
      // the door again is not told to wait for a check that is done.
      const stillPending = created || !(existing.approuveLe || existing.status === 'active');
      const sn = notifier();
      if (sn && stillPending && typeof sn.onNotarySignedUp === 'function') {
        Promise.resolve(sn.onNotarySignedUp({ email, lienCNQ: (existing && existing.lienCNQ) || lienCNQ })).catch(() => {});
      }
      return json(200, { ok: true });
    }

    // --- The conversion funnel's beacon (2026-09-02) -------------------------
    // The web app reports one observable step at a time (`{ event }`); only
    // the domain's FUNNEL_EVENTS catalogue is ever counted, and anything else
    // is dropped with the SAME 204 — a beacon never learns what the catalogue
    // holds. The two steps that cost money (an offer published, a notary
    // signed up) are counted server-side on their own routes, never from here.
    // Lightly throttled per IP: a page fires this on every step.
    if (route === '/events' && method === 'POST') {
      const ip = clientIp(request);
      let count = 1;
      try {
        count = await repo.incrNotaryRateCounter('funnel', ip || 'unknown', FUNNEL_RL_WINDOW_SEC, nowMs());
      } catch {
        count = 1;
      }
      if (count > FUNNEL_RL_MAX) return json(429, { ok: true, throttled: true });
      let payload = null;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        payload = null;
      }
      const id = payload && typeof payload.event === 'string' ? payload.event : null;
      if (domain.isFunnelEvent(id)) await recordStats(statsDeltasForFunnel(id, now()));
      // A 204 carries no body — bare CORS headers, like the preflight.
      return { statusCode: 204, headers: corsHeaders(), body: '' };
    }

    // Begin FREE notary onboarding — open a Stripe Connect onboarding link.
    // No subscription; Nota takes a commission only when an act completes.
    if (route === '/notaries/connect' && method === 'POST') {
      // Brancher ses versements exige l'intermédiaire de paiement. Quand il
      // n'est pas configuré, le dire franchement : `billing()` le construit
      // paresseusement et lève sans clé, ce qui rendait un 500 — un notaire y
      // lisait une panne de Nota plutôt qu'une configuration absente.
      if (!billingAvailable) {
        return json(503, { errors: [{ code: 'paiement_indisponible', message: 'Le branchement des versements est momentanément indisponible. Réessayez dans quelques minutes.' }] });
      }
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      // Same referral rules as POST /bids (ADR 0011): normalize through the
      // domain, keep only a real code, and NEVER fail a signup over a broken
      // referral link — an invalid code is silently dropped. A referred notary
      // is worth REFERRAL.notaire to their partner once they retain a first
      // act; the code stays private on the notary record (admin ledger only).
      let notaryParrain = domain.isReferralCode(payload.parrain)
        ? domain.normalizeReferralCode(payload.parrain)
        : null;
      // Self-referral guard (same as POST /bids): a partner signing up as a
      // notary with their own code earns nothing — attribution dropped, the
      // signup goes through.
      if (notaryParrain) {
        const owner = await repo.getPartner(notaryParrain);
        const email = String(payload.email || '').trim().toLowerCase();
        if (owner && email && owner.courriel === email) notaryParrain = null;
      }
      const result = await billing().connectNotary({ email: payload.email, parrain: notaryParrain });
      if (!result.ok) return json(422, { errors: result.errors });
      // Back the hosted onboarding link up into the notary's inbox so a closed
      // tab is recoverable. Fire-and-forget — never blocks or fails the response.
      const cn = notifier();
      if (cn) Promise.resolve(cn.onNotaryConnected(payload.email, result.url)).catch(() => {});
      return json(200, { url: result.url });
    }

    // A notary marks a retained act completed with its final value — THE
    // settlement moment (ADR 0015, paid at signing). With a live client
    // authorization Nota captures it and transfers the net (value −
    // commission) to the notary; otherwise — billing off, `a_reautoriser`
    // after a proposition accept, or a lapsed/declined hold — the commission
    // model applies as fallback: the client paid the notary directly and Nota
    // charges the notary its fee. Both paths share the write-once act ledger,
    // so the act settles exactly once. Session-scoped.
    if (route === '/notary/acts/complete' && method === 'POST') {
      const notaryId = requireScope(bearer(request), SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      // AUTHORIZATION: only the notary who RETAINED this bid may complete it — and
      // thus write the shared write-once act ledger. Without this, any active notary
      // could POST an arbitrary public bid id and poison its ledger, blocking the
      // real payout while still counting a commission. Loading the bid by its full
      // (id, dateISO) key also validates both fields (a missing key → 403, not a 500).
      const bid = payload.bidId && payload.dateISO ? await repo.get(payload.bidId, payload.dateISO) : null;
      if (!bid || bid.status !== domain.STATUS.RETENUE || bid.notaryId !== notaryId) {
        return json(403, { errors: [{ code: 'acte_non_autorise', message: 'Cet acte ne vous a pas été confié.' }] });
      }
      // The ledger below is write-once: a value that passes here is permanent.
      // The domain bounds it against the retained offer so a fat-fingered
      // figure (the offer typed twice, a lost digit) dies in validation.
      const valued = domain.validateActValue({ actAmount: payload.actAmount, retainedMontant: bid.montant });
      if (!valued.ok) return json(422, { errors: valued.errors });
      payload.actAmount = valued.actAmount;
      let result = null;
      const canCapture = billingConfigured && bid.paymentIntentId && bid.paymentStatus === 'authorized';
      if (canCapture) {
        // Historical name (pay-on-accept era): the mechanics — capture the
        // client's card, keep the commission, transfer the net — are exactly
        // the paid-at-signing settlement, now invoked here instead.
        result = await billing().payNotaryOnAccept({
          notaryId, bidId: payload.bidId, actAmount: payload.actAmount, paymentIntentId: bid.paymentIntentId,
          // ADR 0028: the settled act is counted on its own service, so the
          // cote can reward the breadth of the catalogue a notary serves.
          serviceId: bid.serviceId,
        });
      }
      if (!result || !result.ok) {
        // No capturable hold, or the capture failed (lapsed past Stripe's
        // ~7-day window, declined): the act still settles on the commission
        // model — the client paid the notary directly at signing.
        result = await billing().completeAct({
          notaryId, bidId: payload.bidId, actAmount: payload.actAmount, serviceId: bid.serviceId,
        });
      }
      if (!result.ok) return json(422, { errors: result.errors });
      // La piste d'audit de la transaction : écrite depuis le registre ACT#
      // lui-même (l'autorité comptable), et seulement au PREMIER règlement —
      // une reprise idempotente ne doit pas doubler la trace.
      if (!result.alreadyCompleted && !result.alreadyPaid) {
        const regle = typeof repo.getActCompletion === 'function' ? await repo.getActCompletion(payload.bidId) : null;
        if (regle) {
          const { montant, honoraires, prixNota } = deuxLignes(regle);
          await appendAudit('acte_regle', {
            bidId: payload.bidId,
            dateISO: bid.dateISO,
            notaryId,
            serviceId: bid.serviceId || null,
            montant,
            // ADR 0031 — la piste d'audit porte les DEUX lignes et rien qui
            // ressemble à un partage : c'est la pièce qu'un syndic lirait.
            honoraires,
            prixNota,
            chargeId: regle.chargeId || null,
            transferId: regle.transferId || null,
            // ADR 0029 — réglé n'est pas encaissé. Le registre write-once
            // porte `paye: false` et la créance quand aucun dollar n'a bougé ;
            // la pièce d'audit le répète, pour que la console n'écrive jamais
            // « encaissé » là où c'est « dû ».
            paye: regle.paye !== false,
            commissionCentsDue: regle.paye === false ? Math.round(Number(regle.commissionCentsDue) || 0) : 0,
          }, acteur(ACTEUR.NOTAIRE, notaryId, request));
        }
      }

      // Payout statement + operator alert, once per bid (fire-and-forget).
      const an = notifier();
      if (an) {
        Promise.resolve(
          an.onActPaid({
            notaryId, bid, actAmount: payload.actAmount,
            // Only a real transfer earns the « acte payé » statement.
            paye: result.netCents != null,
          })
        ).catch(() => {});
      }
      return json(200, {
        ok: true,
        // The SETTLED value — on a duplicate submit, the ledger's original
        // figure, never the retried one — so the console renders the truth.
        actAmount: result.actAmount != null ? result.actAmount : valued.actAmount,
        commissionCents: result.commissionCents,
        ...(result.netCents != null ? { paid: true, netCents: result.netCents } : {}),
      });
    }

    // Stripe webhook. The raw request body and the `stripe-signature` header are
    // verified by the adapter; a bad signature is a 400. Idempotent by event id.
    if (route === '/stripe/webhook' && method === 'POST') {
      // Sans secret de webhook, AUCUNE signature n'est vérifiable : le refus
      // est donc exactement celui d'une signature fausse — même code, même
      // corps, si bien que sonder la route n'apprend rien sur la
      // configuration. Appeler `billing()` ici LEVAIT (l'adaptateur Stripe est
      // construit paresseusement et exige une clé), et un webhook qui répond
      // 500 fait réessayer Stripe pendant des heures avant de lever l'alerte.
      if (!billingAvailable) {
        return json(400, { errors: [{ code: 'signature_invalide', message: 'Signature Stripe invalide.' }] });
      }
      const signature = header(request.headers, 'stripe-signature');
      const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body || {});
      const result = await billing().handleWebhook(raw, signature);
      if (!result.ok) {
        return json(400, { errors: [{ code: 'signature_invalide', message: 'Signature Stripe invalide.' }] });
      }

      // Fire the matching lifecycle email (notary active / offer authorized or
      // voided / win-back + operator alert). Best-effort; skipped on a
      // redelivered event.
      const n = notifier();
      if (n && result.event && !result.duplicate) {
        Promise.resolve(n.onAccountEvent(result.event, result.notary, result.bid)).catch(() => {});
      }

      return json(200, { received: true });
    }

    // CASL / Law 25 opt-out. The email footer links here with a token that
    // encodes the recipient's address; we record the opt-out and the sender
    // checks it before every future send. Opening it in a browser shows a page.
    // POST is the RFC 8058 one-click target (List-Unsubscribe-Post): mailbox
    // providers POST here with no user interaction, so it must opt out too.
    if (route === '/unsubscribe' && (method === 'GET' || method === 'POST')) {
      // Normalize the decoded address (trim + lowercase) so the suppression
      // record always matches what the notifier checks — isUnsubscribed lookups
      // normalize the same way, and a case-variant token must not slip past.
      const email = decodeUnsubToken(query.token || '').trim().toLowerCase();
      if (!email || !domain.isEmail(email)) {
        return htmlPage(400, 'Lien invalide', 'Ce lien de désabonnement est invalide ou incomplet.');
      }
      await repo.putUnsubscribe(email, now());
      return htmlPage(
        200,
        'Désabonnement confirmé',
        'Vous ne recevrez plus de courriels de Nota à cette adresse. Vous pouvez fermer cette page.'
      );
    }

    // --- Notary console: passwordless sign-in (magic link) ------------------
    // TWO steps. The old one-shot POST /notary/session minted a full session
    // token straight from a bare, UNVERIFIED request email — anyone who knew an
    // active notary's public address could impersonate them and read a client's
    // courriel + private dossier (admin.js:6-9 calls this a known weakness).
    // Now the caller must PROVE mailbox ownership: /request emails a single-use
    // link; /verify redeems it for the same stateless session token as before.
    // Mirrors the admin console (admin.js requestLogin / verifyMagic).

    // Step 1 — request a link. Per-IP rate-limited, NO account enumeration: an
    // active notary, an inactive one and a stranger all get the SAME generic
    // { ok: true }, so the response never reveals who is a notary. Only an
    // eligible address actually mints a challenge and gets a link emailed.
    if (route === '/notary/session/request' && method === 'POST') {
      if (lienImpossible(NOTARY_CONSOLE_URL, NOTARY_LOGIN_DEV_ECHO)) return json(503, { errors: [CONFIG_INCOMPLETE] });
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      const email = String(payload.email || '').trim().toLowerCase();

      // Throttle FIRST, keyed on the trusted source IP, so a hostile client
      // cannot spam links regardless of which addresses it guesses. Fail OPEN on
      // a counter error — availability over strictness for the login path.
      const ip = clientIp(request);
      let count = 1;
      try {
        count = await repo.incrNotaryRateCounter('notary_login', ip || email || 'unknown', NOTARY_LOGIN_RL_WINDOW_SEC, nowMs());
      } catch {
        count = 1;
      }
      if (count > NOTARY_LOGIN_RL_MAX) {
        // Le FRANCHISSEMENT seul est journalisé, pas chaque refus qui suit : une
        // trace posée à chaque requête bloquée donnerait à un attaquant le
        // pouvoir de faire grossir le journal à volonté — une arme retournée.
        // Le plafond dit déjà que la suite est du même flot, depuis la même IP.
        if (count === NOTARY_LOGIN_RL_MAX + 1) {
          await appendAudit('notaire_lien_demande', { eligible: null, throttled: true }, acteur(ACTEUR.NOTAIRE, null, request));
        }
        return json(429, { ok: true, throttled: true });
      }

      // A syntactically invalid email is not an account of any kind — rejecting
      // it leaks nothing about who is a notary (and keeps the 422 the web app
      // and existing callers expect). Enumeration only matters for well-formed
      // addresses, which the generic ok below makes indistinguishable.
      if (!domain.isEmail(email)) {
        return json(422, { errors: [{ code: 'courriel_invalide', message: 'Le courriel n’est pas valide.' }] });
      }

      const gate = await notaryGate(email);

      // La trace de la DEMANDE. Elle est posée pour les deux issues — un accès
      // non autorisé commence par une demande, et une demande qu'on ne voit pas
      // n'est pas reconstituable. Le corps de la réponse, lui, ne change pas :
      // l'anti-énumération se joue face au demandeur, pas face à l'auditeur.
      // L'adresse d'un inconnu n'est jamais consignée — la consigner reviendrait
      // à bâtir un registre de non-clients.
      await appendAudit(
        'notaire_lien_demande',
        { eligible: !!gate.allowed, throttled: false },
        acteur(ACTEUR.NOTAIRE, gate.allowed ? gate.notaryId : null, request)
      );

      if (!gate.allowed) {
        // Same shape as the happy path: the BODY never distinguishes a notary
        // from a stranger. Nothing is minted and nothing is emailed.
        return json(200, { ok: true });
      }

      const cid = newId();
      const exp = nowMs() + NOTARY_CHALLENGE_TTL_MS;
      await repo.putNotaryLoginChallenge({
        challengeId: cid,
        notaryId: gate.notaryId,
        email,
        createdAt: new Date(nowMs()).toISOString(),
        expiresAt: exp,
        consumed: false,
        ttl: Math.floor(exp / 1000) + 60, // let DynamoDB reap it shortly after expiry
      });

      // The link carries the CHALLENGE token in the hash (never a query string,
      // which is logged); the web app consumes `#nauth=` on load and calls verify.
      const token = signChallengeToken(gate.notaryId, cid, exp);
      const link = NOTARY_CONSOLE_URL + '/#nauth=' + encodeURIComponent(token);

      // Best-effort send on the shared branded template; a mail failure never
      // changes the (generic) response — the notary can request another link.
      const n = notifier();
      if (n && typeof n.onNotaryLoginRequested === 'function') {
        Promise.resolve(
          n.onNotaryLoginRequested({ email, link, ttlMinutes: Math.round(NOTARY_CHALLENGE_TTL_MS / 60000) })
        ).catch(() => {});
      }

      // Dev echo (never in production): hand the link + raw token back so tests
      // and `npm run api:local` complete sign-in with no mailbox.
      const body = { ok: true };
      if (NOTARY_LOGIN_DEV_ECHO) {
        body.devLink = link;
        body.devToken = token;
      }
      return json(200, body);
    }

    // Step 2 — redeem the link for a session. Single-use: the challenge is
    // atomically consumed, so a replayed link is rejected. Re-checks the gate at
    // REDEMPTION time (a notary deactivated between request and verify must not
    // slip through), then issues the SAME stateless session + feed tokens the old
    // route did, after the identical profile upsert (stable étude label).
    if (route === '/notary/session/verify' && method === 'POST') {
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      // Chaque refus laisse une trace : c'est la moitié du journal qui manquait.
      // Un lien forgé, un lien expiré, un lien rejoué et un compte désactivé
      // depuis la demande sont quatre histoires différentes, et seule la RAISON
      // les distingue. Le jeton, lui, n'entre jamais dans le journal : son
      // empreinte suffit à voir que deux refus portent sur le même lien.
      //
      // Cette porte n'est pas limitée en débit, donc un balayage produit autant
      // de traces qu'il fait d'appels. C'est assumé : l'écriture d'audit coûte
      // strictement moins que l'invocation Lambda qui la provoque, elle ne
      // change donc pas l'économie d'un flot hostile — elle le rend visible.
      const jeton = String(payload.token || '');
      const claims = verifyToken(jeton, nowMs());
      if (!claims || claims.scope !== SCOPES.CHALLENGE || !claims.cid) {
        await appendAudit(
          'notaire_connexion_refusee',
          { raison: 'jeton_invalide', empreinteJeton: empreinteJeton(jeton) },
          acteur(ACTEUR.NOTAIRE, null, request)
        );
        return json(401, { errors: [{ code: 'lien_invalide', message: 'Lien invalide ou expiré.' }] });
      }

      // Atomic single-use consume: the FIRST redemption wins, a replay gets null.
      const challenge = await repo.consumeNotaryLoginChallenge(claims.cid, nowMs());
      if (!challenge || challenge.notaryId !== claims.sub) {
        await appendAudit(
          'notaire_connexion_refusee',
          { raison: 'lien_deja_utilise', empreinteJeton: empreinteJeton(jeton), challengeId: claims.cid },
          acteur(ACTEUR.NOTAIRE, claims.sub, request)
        );
        return json(401, { errors: [{ code: 'lien_invalide', message: 'Lien invalide ou déjà utilisé.' }] });
      }

      const email = challenge.email;
      const gate = await notaryGate(email);
      if (!gate.allowed) {
        await appendAudit(
          'notaire_connexion_refusee',
          { raison: 'compte_inactif', empreinteJeton: empreinteJeton(jeton), challengeId: claims.cid },
          acteur(ACTEUR.NOTAIRE, challenge.notaryId, request)
        );
        return json(403, {
          errors: [{ code: 'compte_requis', message: 'Un compte notaire actif est requis pour accéder à la console. L’inscription est gratuite.' }],
        });
      }

      await upsertNotaryProfile(gate, email);
      await appendAudit(
        'notaire_connexion',
        { challengeId: claims.cid },
        acteur(ACTEUR.NOTAIRE, gate.notaryId, request)
      );
      const exp = nowMs() + NOTARY_TOKEN_TTL_MS;
      return json(200, {
        // Full-console token: sent in the Authorization header, never in a URL.
        token: signToken(gate.notaryId, exp, SCOPES.SESSION),
        // Read-only calendar token, safe to embed in the webcal URL. It cannot
        // accept a bid or read a dossier.
        feedToken: signToken(gate.notaryId, exp, SCOPES.FEED),
        // The notary's own address, so a client that redeemed a link on a fresh
        // device (nothing in localStorage) can key its console to it. The caller
        // just proved ownership of this mailbox, so it is theirs to receive.
        email,
        expiresAt: new Date(exp).toISOString(),
      });
    }

    if (route === '/notary/bids' && method === 'GET') {
      // Session-scoped token from the Authorization header — never the query
      // string (which is logged). A feed-scoped token is rejected here.
      const notaryId = requireScope(bearer(request), SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });

      const months = monthWindow(now().slice(0, 7), NOTARY_HORIZON_MONTHS);
      // Loaded before the walk: the profile now gates which open bids the
      // feed may offer at all (ADR 0017), not just the console's own block.
      const ownProfile = await repo.getNotary(notaryId);
      // ADR 0028: opening the console IS the presence signal — stamped here,
      // once a day, on the profile the cote reads.
      await touchNotary(notaryId, ownProfile);
      // ≈ km between a bid's sector and the étude's (ADR 0025) — null when
      // either sector is unknown. One definition for both open and retained.
      const distKm = (b) => domain.fsaDistanceKm(b.prefixe, ownProfile && ownProfile.prefixe);
      const seen = new Set();
      const out = [];
      // Bids in the window retained BY THIS notary — including those retained
      // through a proposition the client accepted, which the console would
      // otherwise never learn about (it never called accept itself).
      const retained = [];
      for (const month of months) {
        const bids = await repo.listByMonth(month);
        for (const b of bids) {
          if (seen.has(b.id)) continue;
          if (b.status === domain.STATUS.RETENUE) {
            if (b.notaryId === notaryId) {
              seen.add(b.id);
              // The write-once act ledger rides along: a settled act renders
              // « Acte complété » in ANY session — the console must never
              // re-offer the settlement button (nor forget the revenue).
              const completion = typeof repo.getActCompletion === 'function'
                ? await repo.getActCompletion(b.id) : null;
              retained.push({
                completed: !!completion,
                actAmount: completion ? completion.actAmount : null,
                commissionCents: completion ? completion.commissionCents : null,
                id: b.id,
                dateISO: b.dateISO,
                serviceId: b.serviceId,
                montant: b.montant,
                tier: b.tier,
                prefixe: b.prefixe || null,
                courriel: b.courriel || null,
                dossier: b.dossier || null,
                // Mise en relation (ADR 0010 §4): this notary retained the bid,
                // so they see whom to contact — never present on open bids.
                client: clientContact(b),
                preteur: bidLenderInfo(b),
                deplacement: bidDeplacementInfo(b),
                distanceKm: distKm(b),
                // The retaining notary may still ask for what the dossier lacks:
                // the same checklist the open card carried (computed with the
                // bid's private `pricing`, which never travels itself).
                missing: domain.leadReadiness(b.serviceId, b.dossier || {}, b.pricing).missing,
                requestable: domain.requestableItems(b.serviceId, b.pricing).map((it) => it.id),
                // The live thread with the client — the place details surface
                // (and the reason a notary may still withdraw, see /release).
                messages: messagesOf(b).map(chatMessage),
            // Les documents de la conversation (ADR 0032) — jamais leur clé de
            // stockage, et jamais ceux dont le dépôt n'a pas été constaté : une
            // pièce annoncée n'est pas une pièce reçue.
            documents: documentsOf(b).filter((d) => d.etat === 'pret').map(publicDocument),
                viaProposition: propositionsOf(b).some((p) => p.status === PROPOSITION.ACCEPTEE && p.notaryId === notaryId),
                // ADR 0033: what a cancellation TODAY would hand this notary
                // (the fee compensates them) — the same forecast the client
                // sees on GET /client/bid; null when the cancel would be free.
                annulation: await (async () => {
                  const fee = await annulationFeeFor(b);
                  return fee ? { taux: fee.taux, frais: fee.frais, joursAvant: fee.joursAvant } : null;
                })(),
              });
            }
            continue;
          }
          if (b.status !== domain.STATUS.OUVERTE) continue;
          if (!isLive(b)) continue; // hide offers whose card authorization is still pending/void
          if (query.service && b.serviceId !== query.service) continue;
          // ADR 0017/0025: the feed only offers what this notary can serve — a
          // travel band beyond their reach, or an online urgency they never
          // opted into, is not their demande. With both sectors known the
          // MEASURED distance decides; legacy bids without a band reach everyone.
          // This pure check runs BEFORE the per-bid declined lookup (real I/O).
          if (!domain.notaryCanServe((b.pricing || {}).deplacement, ownProfile, b.prefixe)) continue;
          if (await repo.wasDeclined(notaryId, b.id)) continue;
          seen.add(b.id);
          const mine = latestPropositionFor(b, notaryId);
          const ask = latestDemandeFor(b, notaryId);
          out.push({
            ...notaryBid(b),
            distanceKm: distKm(b),
            // ONLY this notary's own proposition/demande — never another's.
            proposition: mine ? { id: mine.id, montant: mine.montant, delta: mine.delta, status: mine.status, createdAt: mine.createdAt } : null,
            demande: ask ? { id: ask.id, documents: ask.documents, createdAt: ask.createdAt, fournie: demandeFournie(b, ask) } : null,
            missing: domain.leadReadiness(b.serviceId, b.dossier || {}, b.pricing).missing,
            // The ids a document request may name for THIS client (the domain's
            // `si` predicates, fed with the bid's private pricing answers).
            requestable: domain.requestableItems(b.serviceId, b.pricing).map((it) => it.id),
            // Is there a hold a cancellation fee could actually be captured
            // from? Exactly the condition `annulationFeeFor` requires — so the
            // Retenir sheet promises the barème only where it can be honoured.
            cautionVivante: billingConfigured && b.paymentStatus === 'authorized' && !!b.paymentIntentId,
          });
        }
      }
      // ADR 0031 — la console ne reçoit PLUS de barème. Elle en recevait un
      // (taux de base, taux effectif mérité par la cote, palier suivant), et
      // l'écran en tirait « vous gardez X % de ce que le client paie, mérité
      // par votre cote ». Le notaire garde 100 % de ses honoraires : il n'y a
      // aucun pourcentage à lui montrer, et lui en montrer un décrirait la
      // convention que l'art. 29.1 interdit. Ce qu'il doit voir à la place —
      // le prix que le CLIENT paie à Nota — voyage dans `tarif`.
      const tarif = await tarifNota();
      return json(200, {
        bids: out, retained,
        rating: notaryRating(ownProfile),
        // ADR 0031 — ce que le CLIENT paie à Nota, pour que la console puisse
        // le dire au notaire sans jamais le présenter comme une part de ses
        // honoraires : c'est une ligne du client, pas une retenue sur les
        // siennes.
        tarif,
        // ADR 0028: the cote sur 100 and its four axes — the console's own
        // copy, present even when billing is off (a notary always has a cote).
        cote: cote.coteFor(ownProfile, nowMs()),
        profil: notaryProfil(ownProfile),
        // ADR 0033 — what retaining commits the notary to, as data the
        // console lays out BEFORE they confirm: honoraires paid in full at the
        // signing, the client's separate price to Nota, the cancellation
        // barème (the fee compensates the notary), and the withdrawal right
        // (free, but counted on their record — releasesCount).
        conditions: {
          paiement: 'signature',
          tarifNota: tarif,
          // `applicable`: without a billing adapter no fee can ever be
          // captured (annulationFeeFor answers null) — the barème is then
          // information, not a promise, and the console says so.
          annulation: { paliers: await annulationBareme(), beneficiaire: 'notaire', applicable: billingConfigured },
          desistement: { gratuit: true, compte: true },
        },
        // The months `retained` covers — so the console can prune the local
        // entries the server no longer returns (a client cancelled).
        fenetre: months,
      });
    }

    // The notary's own track record (ADR 0021): every client evaluation, note
    // and comment included, newest first — not just the average. Anonymized at
    // the source: the ledger items never carried the client.
    if (route === '/notary/evaluations' && method === 'GET') {
      const notaryId = requireScope(bearer(request), SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });
      const profile = await repo.getNotary(notaryId);
      const ledger = typeof repo.listNotaryEvaluations === 'function' ? await repo.listNotaryEvaluations(notaryId) : [];
      return json(200, {
        rating: notaryRating(profile),
        // ADR 0028: the cote and, service by service, what this notary
        // actually renders — acts carried and what clients said about them.
        cote: cote.coteFor(profile, nowMs()),
        services: domain.notaryServiceRecord(ledger, profile && profile.actsByService),
        evaluations: ledger.map((e) => ({
          note: e.note,
          commentaire: e.commentaire || null,
          serviceId: e.serviceId || null,
          dateISO: e.dateISO || null,
          createdAt: e.createdAt || null,
        })),
      });
    }

    // Le relevé du notaire (propriétaire, 2026-09-01) : CHAQUE acte réglé, avec
    // ce que le client a payé, le taux appliqué, la part de Nota, le net et la
    // cote qui a mérité ce taux. Rien d'agrégé seulement — la ligne par acte
    // EST la divulgation. Les chiffres viennent du registre write-once ACT#,
    // figés au règlement : un changement de barème ne réécrit jamais un acte
    // déjà payé.
    if (route === '/notary/acts' && method === 'GET') {
      const notaryId = requireScope(bearer(request), SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });

      // Les actes du notaire se lisent par ses pointeurs de rétention : un acte
      // réglé a forcément été retenu. Aucun index supplémentaire n'est requis.
      const pointeurs = typeof repo.listRetainedByNotary === 'function' ? await repo.listRetainedByNotary(notaryId) : [];
      const lignes = [];
      for (const e of pointeurs) {
        const regle = typeof repo.getActCompletion === 'function' ? await repo.getActCompletion(e.id) : null;
        // Pas encore signé, ou réglé par quelqu'un d'autre : hors relevé.
        if (!regle || (regle.notaryId && regle.notaryId !== notaryId)) continue;
        const { montant, honoraires, prixNota } = deuxLignes(regle);
        const serviceId = regle.serviceId || e.serviceId || null;
        const svc = serviceId ? domain.serviceById(serviceId) : null;
        const paye = regle.netCents != null || !!regle.transferId;
        lignes.push({
          bidId: e.id,
          dateISO: e.dateISO || null,
          serviceId,
          service: svc ? svc.nom : null,
          montant,
          // ADR 0031 — deux lignes, et JAMAIS un taux. Le notaire garde ses
          // honoraires en entier ; le prix de Nota est payé par le client, à
          // côté. Afficher ici un pourcentage décrirait un partage que la
          // plomberie ne fait plus — et l'art. 32 du Code de déontologie
          // interdit au notaire de partager ses honoraires avec un non-membre
          // d'un ordre. Un relevé qui l'affirme est une pièce à conviction.
          honoraires,
          prixNota,
          // Le net du notaire EST ses honoraires : rien n'en est retranché.
          net: honoraires,
          completedAt: regle.completedAt || null,
          paye,
          // Le prix de Nota, quand l'acte s'est réglé hors plateforme et qu'il
          // n'a donc pas été encaissé. Une créance, jamais une part.
          du: paye ? 0 : prixNota,
        });
      }
      // Le plus récent d'abord : par règlement, puis par date de signature.
      lignes.sort((a, b) =>
        String(b.completedAt || '').localeCompare(String(a.completedAt || '')) ||
        String(b.dateISO || '').localeCompare(String(a.dateISO || '')));

      const somme = (f) => Math.round(lignes.reduce((t, l) => t + l[f], 0) * 100) / 100;
      return json(200, {
        actes: lignes,
        totaux: {
          actes: lignes.length,
          montant: somme('montant'),
          honoraires: somme('honoraires'),
          prixNota: somme('prixNota'),
          net: somme('net'),
          du: somme('du'),
        },
      });
    }

    // The notary's public profile (ADR 0016): attach — or clear — the link of
    // their official fiche in the Chambre des notaires directory. The domain
    // is the authority on what counts as a fiche (https, cnq.org host only).
    if (route === '/notary/profile' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      // Session-scoped token: Authorization header preferred, POST-body `token`
      // accepted as a fallback (same pattern as accept).
      const notaryId = requireScope(bearer(request) || payload.token, SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });
      const v = domain.validateNotaryProfile(payload);
      if (!v.ok) return json(422, { errors: v.errors });
      // Spread the existing record first — the billing identity, the rating
      // aggregates and the commission accumulator must all survive this write.
      const existing = await repo.getNotary(notaryId);
      // A field ABSENT from the body keeps its stored value; a field present
      // but empty clears it. The console edits the profile from more than one
      // form (the identity/feed form, the « à votre rythme » alert block), and
      // a block that posts only its own fields must never wipe the others.
      const sent = (k) => Object.prototype.hasOwnProperty.call(payload, k) && payload[k] !== undefined;
      const fields = {
        // ADR 0016: the official fiche.
        lienCNQ: v.lienCNQ,
        // ADR 0017: the declared travel radius and the online-urgency opt-in —
        // the two levers that widen (or narrow) the feed this notary sees.
        rayonKm: v.rayonKm,
        urgences: v.urgences,
        // ADR 0025: the étude's sector — what turns the feed's declarative
        // travel rules into measured distances.
        prefixe: v.prefixe,
        // ADR 0033: the identity a retained client receives — and the gate
        // on retaining at all (nom, téléphone, adresse).
        nom: v.nom,
        etude: v.etude,
        telephone: v.telephone,
        adresse: v.adresse,
        // ADR 0033 §7: how (and whether) new demandes reach this notary.
        alertes: v.alertes,
      };
      const next = { ...(existing || { id: notaryId, createdAt: now() }) };
      for (const k of Object.keys(fields)) if (sent(k)) next[k] = fields[k];
      next.updatedAt = now();
      await repo.putNotary(next);
      return json(200, { profil: notaryProfil(next) });
    }

    if (route === '/notary/bids/accept' && method === 'POST') {
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      // Session-scoped token: Authorization header preferred, POST-body `token`
      // accepted as a fallback. A feed-scoped token is rejected.
      const notaryId = requireScope(bearer(request) || payload.token, SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });

      const bid = await repo.get(payload.id, payload.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      if (bid.status === domain.STATUS.ANNULEE) return goneCancelled();

      // PAID AT SIGNING (ADR 0015): accepting retains — it never charges.
      // The client's hold stays untouched; every payment (capture + transfer,
      // or the commission fallback) happens in /notary/acts/complete once the
      // act is actually signed.

      // What an accept hands the winning notary: the released dossier plus the
      // mise en relation contact block (ADR 0010 §4). `courriel` stays at the
      // top level for existing callers; `client` is the full contact shape.
      const released = (b) => ({ id: b.id, courriel: b.courriel || null, dossier: b.dossier || null, client: clientContact(b) });

      // Idempotent + access-controlled: re-accept by the SAME notary returns
      // the dossier again; another notary -> 409.
      if (bid.status === domain.STATUS.RETENUE) {
        if (bid.notaryId === notaryId) {
          return json(200, released(bid));
        }
        return json(409, { errors: [{ code: 'deja_retenue', message: 'Cette offre est déjà retenue.' }] });
      }

      // ADR 0033: no retain without a name, a phone and an address — the
      // client must be able to reach and find the notary who took their act.
      // Placed after the idempotent re-accept above (a dossier already
      // released stays released) and before any write.
      const profil = await repo.getNotary(notaryId);
      const incomplet = profilIncomplet(profil);
      if (incomplet) return incomplet;

      // ADR 0017: a notary can only take what they can serve (radius / urgency
      // opt-in). Placed after the idempotent re-accept above — a notary who
      // already holds the act keeps their dossier even if their profile
      // narrowed since — and before the retain, so a refused accept never
      // flips the bid.
      if (!domain.notaryCanServe((bid.pricing || {}).deplacement, profil, bid.prefixe)) {
        return json(403, { errors: [{ code: 'deplacement_non_couvert', message: 'Cette demande exige un déplacement ou une urgence en ligne que votre profil ne couvre pas.' }] });
      }

      // Conditional retain (retainFor) closes the TOCTOU race: two notaries
      // accepting the same open bid concurrently both read status=ouverte, but
      // only ONE write succeeds — the repo flips the bid only while it is still
      // ouverte.
      const retained = await retainFor(bid, notaryId, {}, acteur(ACTEUR.NOTAIRE, notaryId, request));
      if (!retained) {
        // Lost the race. Re-read to answer precisely: if WE ended up the winner
        // (a double-submit by the same notary), it is idempotent; otherwise the
        // bid is now held by someone else -> 409.
        const fresh = await repo.get(payload.id, payload.dateISO);
        if (fresh && fresh.status === domain.STATUS.RETENUE && fresh.notaryId === notaryId) {
          return json(200, released(fresh));
        }
        return json(409, { errors: [{ code: 'deja_retenue', message: 'Cette offre est déjà retenue.' }] });
      }
      // ADR 0028: taking the demande as it stands is an answer too — counted
      // once, on the write that actually won the race.
      await bumpNotary(notaryId, 'acceptsCount');
      return json(200, released(retained));
    }

    // A notary answers an open offer with a PROPOSITION: a higher price than
    // the client's. The domain validates (above the client, under the cap, date
    // not passed). A new proposition by the same notary supersedes their
    // pending one. The client is emailed and answers via /client/propositions/*.
    if (route === '/notary/bids/propose' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      // Session-scoped token: Authorization header preferred, POST-body `token`
      // accepted as a fallback (same pattern as accept).
      const notaryId = requireScope(bearer(request) || payload.token, SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });

      const bid = await repo.get(payload.id, payload.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      if (bid.status === domain.STATUS.RETENUE) {
        return json(409, { errors: [{ code: 'deja_retenue', message: 'Cette offre est déjà retenue.' }] });
      }

      // ADR 0033: a proposition is an offer to take the act — same gate as a
      // retain: no name, phone or address, no proposition.
      const profil = await repo.getNotary(notaryId);
      const incomplet = profilIncomplet(profil);
      if (incomplet) return incomplet;

      // ADR 0017: a notary can only take what they can serve (radius / urgency
      // opt-in) — a proposition on an unserveable demande is refused like an
      // accept would be.
      if (!domain.notaryCanServe((bid.pricing || {}).deplacement, profil, bid.prefixe)) {
        return json(403, { errors: [{ code: 'deplacement_non_couvert', message: 'Cette demande exige un déplacement ou une urgence en ligne que votre profil ne couvre pas.' }] });
      }

      const v = domain.validateCounterOffer({ bid, montant: payload.montant, todayISO: now() });
      const errors = [...v.errors];
      const message = payload.message == null ? '' : String(payload.message).trim();
      if (message.length > PROPOSITION_MESSAGE_MAX) {
        errors.push({ code: 'message_trop_long', message: `Le message ne peut dépasser ${PROPOSITION_MESSAGE_MAX} caractères.` });
      }
      if (errors.length) return json(422, { errors });

      const proposition = {
        id: newId(),
        notaryId,
        etude: domain.notaryEtude(profil) || notaryId,
        montant: v.montant,
        delta: v.delta,
        message: message || null,
        createdAt: now(),
        status: PROPOSITION.EN_ATTENTE,
      };
      const propositions = propositionsOf(bid).map((p) =>
        p.notaryId === notaryId && p.status === PROPOSITION.EN_ATTENTE ? { ...p, status: PROPOSITION.REMPLACEE } : p
      );
      propositions.push(proposition);
      await repo.update({ ...bid, propositions });

      // ADR 0028: answering with a price is the strongest availability signal.
      await bumpNotary(notaryId, 'proposalsCount');

      const pn = notifier();
      if (pn) Promise.resolve(pn.onCounterOfferProposed(bid, proposition)).catch(() => {});
      return json(200, { proposition: notaryProposition(proposition) });
    }

    // A notary asks the client for specific documents/fields of the service's
    // dossier. Allowed while the bid is open, or when THIS notary retained it
    // (a retaining notary may still ask); another notary's retained bid -> 409.
    if (route === '/notary/bids/documents' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      const notaryId = requireScope(bearer(request) || payload.token, SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });

      const bid = await repo.get(payload.id, payload.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      if (bid.status === domain.STATUS.ANNULEE) return goneCancelled();
      if (bid.status === domain.STATUS.RETENUE && bid.notaryId !== notaryId) {
        return json(409, { errors: [{ code: 'deja_retenue', message: 'Cette offre est déjà retenue.' }] });
      }
      const v = domain.validateDocumentRequest({ serviceId: bid.serviceId, documents: payload.documents, message: payload.message });
      if (!v.ok) return json(422, { errors: v.errors });

      const profile = await repo.getNotary(notaryId);
      const demande = {
        id: newId(),
        notaryId,
        etude: domain.notaryEtude(profile) || notaryId,
        documents: v.documents,
        message: v.message,
        createdAt: now(),
      };
      await repo.update({ ...bid, demandes: [...demandesOf(bid), demande] });

      const dn = notifier();
      if (dn) Promise.resolve(dn.onDocumentsRequested(bid, demande)).catch(() => {});
      return json(200, { demande: notaryDemande(bid, demande) });
    }

    // --- Client space (per-bid CLIENT token, no account) ---------------------
    // The client sees their own offer, every pending/answered proposition (with
    // the étude, never the notaryId), every document request, and the domain's
    // readiness of their dossier.
    if (route === '/client/bid' && method === 'GET') {
      const auth = requireClient(request, query.id);
      if (auth.error) return auth.error;
      const bid = await repo.get(query.id, query.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      // The client's half of the mise en relation (ADR 0010 §4): once the bid
      // is RETAINED, the client sees whom to reach — the retaining notary's
      // étude and courriel (never the internal notaryId). Null while the bid
      // is open: contact flows in NEITHER direction before retention.
      let notaire = null;
      if (bid.status === domain.STATUS.RETENUE && bid.notaryId) {
        const profile = await repo.getNotary(bid.notaryId);
        const s = (v) => { const t = String(v == null ? '' : v).trim(); return t || null; };
        notaire = {
          // ADR 0033 — the mise en relation is complete: the client can call
          // the notary and find the étude. The gate on retaining guarantees
          // the three are on the profile of whoever holds the act.
          nom: s(profile && profile.nom),
          etude: bid.etude || domain.notaryEtude(profile) || null,
          telephone: s(profile && profile.telephone),
          adresse: s(profile && profile.adresse),
          courriel: (profile && profile.email) || null,
          // ADR 0030 — art. 70 du Code de déontologie : ni moyenne d'étoiles ni
          // cote ne voyagent vers le client. Ce qui reste sont des FAITS
          // vérifiables : l'inscription au tableau de la Chambre (ADR 0016) et
          // le nombre d'actes portés sur Nota. Un fait n'est pas un témoignage.
          lienCNQ: (profile && profile.lienCNQ) || null,
          actes: (profile && Number(profile.actsCompleted)) || 0,
        };
      }
      // Act + evaluation state (ADR 0015): once the ACT# ledger has settled
      // the signing, the client may evaluate the notary — the UI keys on
      // `acte.complete`.
      const completion = typeof repo.getActCompletion === 'function' ? await repo.getActCompletion(bid.id) : null;
      // Each pending proposition carries its notary's public rating and CNQ
      // membership badge: the facts a client has to weigh a higher price from
      // a stranger. Profiles are fetched once per distinct proposer. The badge
      // is a boolean — the fiche URL itself never rides an open bid (it lists
      // the notary's phone; contact flows only after retention).
      const props = propositionsOf(bid).filter((p) => p.status !== PROPOSITION.REMPLACEE);
      const proposerIds = [...new Set(props.map((p) => p.notaryId).filter(Boolean))];
      const proposersById = {};
      for (const nid of proposerIds) {
        proposersById[nid] = await repo.getNotary(nid);
      }
      return json(200, {
        bid: publicBid(bid),
        notaire,
        // ADR 0030 — ce qu'une proposition dit du notaire qui la fait : son
        // étude, son prix, son appartenance à l'Ordre et le nombre d'actes
        // qu'il a portés. Des faits. Jamais une note, une moyenne ou une cote :
        // l'art. 70 du Code de déontologie interdit au notaire de PERMETTRE
        // QUE SOIT UTILISÉ un témoignage d'appui qui le concerne, et une note
        // affichée transforme un annuaire en recommandation.
        propositions: props.map((p) => ({
          ...clientProposition(p),
          cnq: !!(proposersById[p.notaryId] && proposersById[p.notaryId].lienCNQ),
          actes: (proposersById[p.notaryId] && Number(proposersById[p.notaryId].actsCompleted)) || 0,
        })),
        demandes: demandesOf(bid).map((d) => clientDemande(bid, d)),
        readiness: domain.leadReadiness(bid.serviceId, bid.dossier || {}, bid.pricing),
        // The retained-act conversation. Empty until a notary retains the bid.
        messages: messagesOf(bid).map(chatMessage),
        documents: documentsOf(bid).filter((d) => d.etat === 'pret').map(publicDocument),
        // ADR 0028 — la transparence va dans les DEUX sens : une fois l'acte
        // signé et réglé, le client voit comment SON montant s'est partagé.
        // Rien d'inventé : les chiffres sortent du registre write-once.
        acte: completion
          ? (() => {
              // ADR 0031 — le client voit ce qu'il a payé, ligne par ligne :
              // les honoraires du notaire, qui lui reviennent en entier, et le
              // prix du service de Nota, à côté. Jamais un « partage » : il n'y
              // en a plus, et en décrire un serait décrire l'opération que
              // l'art. 32 du Code de déontologie interdit au notaire.
              const { montant, honoraires, prixNota } = deuxLignes(completion);
              return {
                complete: true,
                montant,
                honoraires,
                prixNota,
                total: Math.round((honoraires + prixNota) * 100) / 100,
              };
            })()
          : { complete: false },
        evaluation: bid.evaluation ? { note: bid.evaluation.note, commentaire: bid.evaluation.commentaire || null } : null,
        // ADR 0023 — what cancelling TODAY would cost, disclosed BEFORE the
        // client confirms. Null when the cancel would be free (open offer, no
        // live hold, free window) or impossible (settled act).
        annulation: await (async () => {
          if (completion) return null;
          const fee = await annulationFeeFor(bid);
          return fee ? { taux: fee.taux, frais: fee.frais, joursAvant: fee.joursAvant } : null;
        })(),
      });
    }

    // The client evaluates the notary — once, after the act is signed and
    // settled (the ACT# ledger gates it). The note feeds the notary profile's
    // rating aggregate; a re-submit answers idempotently with what is on file.
    if (route === '/client/evaluation' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      const auth = requireClient(request, payload.id);
      if (auth.error) return auth.error;
      const bid = await repo.get(payload.id, payload.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      if (bid.evaluation) {
        return json(200, { evaluation: { note: bid.evaluation.note, commentaire: bid.evaluation.commentaire || null } });
      }
      if (bid.status !== domain.STATUS.RETENUE || !bid.notaryId) {
        return json(409, { errors: [{ code: 'acte_non_complete', message: 'L’évaluation s’ouvre une fois l’acte signé.' }] });
      }
      const completion = typeof repo.getActCompletion === 'function' ? await repo.getActCompletion(bid.id) : null;
      if (!completion) {
        return json(409, { errors: [{ code: 'acte_non_complete', message: 'L’évaluation s’ouvre une fois l’acte signé.' }] });
      }
      const v = domain.validateEvaluation(payload);
      if (!v.ok) return json(422, { errors: v.errors });

      const evaluation = { note: v.note, commentaire: v.commentaire, createdAt: now() };
      await repo.update({ ...bid, evaluation });
      // Aggregate on the notary profile — the domain turns (sum, count) into
      // the public one-decimal average wherever it is displayed.
      const profile = await repo.getNotary(bid.notaryId);
      if (profile) {
        await repo.putNotary({
          ...profile,
          ratingCount: (profile.ratingCount || 0) + 1,
          ratingSum: (profile.ratingSum || 0) + v.note,
        });
      }
      // The notary's own ledger (ADR 0021): the anonymized track record their
      // console lists. Best-effort — the bid stays the source of truth, and a
      // lost pointer must never cost the client their 201.
      if (typeof repo.addNotaryEvaluation === 'function') {
        try {
          await repo.addNotaryEvaluation(bid.notaryId, {
            bidId: bid.id,
            dateISO: bid.dateISO,
            serviceId: bid.serviceId,
            note: v.note,
            commentaire: v.commentaire,
            createdAt: evaluation.createdAt,
          });
        } catch { /* the aggregate and the bid already carry the note */ }
      }
      // Close the feedback loop (fire-and-forget): the rated notary hears about
      // it, and a low note alerts the operator for a human follow-up.
      const ev = notifier();
      if (ev && typeof ev.onEvaluationSubmitted === 'function') {
        Promise.resolve(ev.onEvaluationSubmitted(bid, evaluation)).catch(() => {});
      }
      return json(201, { evaluation: { note: evaluation.note, commentaire: evaluation.commentaire } });
    }

    // The client answers a proposition. ACCEPT retains the bid for that notary
    // at the proposed amount through the SAME conditional retain path as
    // /notary/bids/accept (retainFor); every other pending proposition is
    // refused in the same write.
    //
    // PAY-ON-ACCEPT: nothing is captured here. The card hold (if any) was taken
    // for the ORIGINAL amount, so it cannot settle the new one; the bid is
    // flagged `paymentStatus: 'a_reautoriser'` and settlement is left to
    // /notary/acts/complete (commission on the completed act's value).
    if ((route === '/client/propositions/accept' || route === '/client/propositions/decline') && method === 'POST') {
      const accepting = route === '/client/propositions/accept';
      const { payload, error } = parseBody(request);
      if (error) return error;
      const auth = requireClient(request, payload.id);
      if (auth.error) return auth.error;
      const bid = await repo.get(payload.id, payload.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      if (bid.status === domain.STATUS.ANNULEE) return goneCancelled();
      const target = propositionsOf(bid).find((p) => p.id === payload.propositionId);
      if (!target) return json(404, { errors: [{ code: 'proposition_introuvable', message: 'Proposition introuvable.' }] });
      if (target.status !== PROPOSITION.EN_ATTENTE) {
        return json(422, { errors: [{ code: 'proposition_close', message: 'Cette proposition n’est plus en attente.' }] });
      }
      if (bid.status === domain.STATUS.RETENUE) {
        return json(409, { errors: [{ code: 'deja_retenue', message: 'Cette offre est déjà retenue.' }] });
      }

      const answered = { ...target, status: accepting ? PROPOSITION.ACCEPTEE : PROPOSITION.REFUSEE };
      const notifyAnswer = (b) => {
        const an = notifier();
        if (an) {
          Promise.resolve(repo.getNotary(answered.notaryId))
            .then((notary) => an.onCounterOfferAnswered(b, answered, notary))
            .catch(() => {});
        }
      };

      if (!accepting) {
        const propositions = propositionsOf(bid).map((p) => (p.id === answered.id ? answered : p));
        await repo.update({ ...bid, propositions });
        notifyAnswer(bid);
        return json(200, { proposition: clientProposition(answered) });
      }

      const propositions = propositionsOf(bid).map((p) =>
        p.id === answered.id ? answered : p.status === PROPOSITION.EN_ATTENTE ? { ...p, status: PROPOSITION.REFUSEE } : p
      );
      const svc = domain.serviceById(bid.serviceId);
      const floor = Number(bid.basePrice) > 0 ? Number(bid.basePrice) : svc && svc.prixDepart;
      const extra = {
        montant: answered.montant,
        premium: floor ? answered.montant / floor : bid.premium,
        propositions,
        ...(billingConfigured ? { paymentStatus: 'a_reautoriser' } : {}),
      };
      const retained = await retainFor(bid, answered.notaryId, extra, acteur(ACTEUR.CLIENT, bid.id, request));
      if (!retained) return json(409, { errors: [{ code: 'deja_retenue', message: 'Cette offre est déjà retenue.' }] });
      // Release the ORIGINAL card hold right away — it was authorized for the
      // old amount and can never settle the accepted proposition, so leaving it
      // would block the client's card for up to ~7 days. Fire-and-forget and
      // idempotent in billing; the resulting payment_intent.canceled webhook is
      // a no-op on a retained bid (the repos guard voidBidAuthorization).
      if (billingConfigured && bid.paymentIntentId) {
        const b = billing();
        if (b && typeof b.cancelAuthorization === 'function') {
          Promise.resolve(b.cancelAuthorization({ paymentIntentId: bid.paymentIntentId, bidId: bid.id })).catch(() => {});
        }
      }
      notifyAnswer(retained);
      return json(200, { bid: publicBid(retained), proposition: clientProposition(answered) });
    }

    // The client replaces their dossier (documents/fields/consent) — the answer
    // to a demande de documents. Always allowed for the bid's owner, open or
    // retained. Answers with the fresh readiness and each demande's `fournie`.
    if (route === '/client/dossier' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      const auth = requireClient(request, payload.id);
      if (auth.error) return auth.error;
      const bid = await repo.get(payload.id, payload.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      const raw = payload.dossier;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return json(422, { errors: [{ code: 'dossier_invalide', message: 'Le dossier doit être un objet.' }] });
      }
      // Store the CLEANED dossier (domain.cleanDossier): only the service's
      // own items, consent and known pricing answers, each value bounded.
      // Unknown keys and local UI state (__validated) never persist.
      const dossier = domain.cleanDossier(bid.serviceId, raw);
      const updated = { ...bid, dossier };
      await repo.update(updated);
      return json(200, {
        readiness: domain.leadReadiness(updated.serviceId, dossier, updated.pricing),
        demandes: demandesOf(updated).map((d) => clientDemande(updated, d)),
      });
    }

    // The client withdraws their offer — open OR already retained. Guarded by
    // the same per-bid CLIENT token as every other client route; idempotent.
    // Retained case: the mise en relation is unwound, the retaining notary
    // (and the operator) are notified, and a LATE cancellation carries a fee
    // kept by partial capture of the live hold (ADR 0023). Every path that
    // captures no fee releases the hold whole — open or retained — so a card
    // is never left blocked. A settled act (ACT# ledger) refuses outright.
    if (route === '/client/bid/cancel' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      const auth = requireClient(request, payload.id);
      if (auth.error) return auth.error;
      const bid = await repo.get(payload.id, payload.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      if (bid.status === domain.STATUS.ANNULEE) return json(200, { bid: publicBid(bid) });

      const completion = typeof repo.getActCompletion === 'function' ? await repo.getActCompletion(bid.id) : null;
      if (completion) {
        return json(409, { errors: [{ code: 'acte_complete', message: 'Cet acte est signé et réglé — il ne peut plus être annulé.' }] });
      }

      const wasRetained = bid.status === domain.STATUS.RETENUE;

      // The fee is charged BEFORE the flip: a capture that fails must leave
      // the client free (hold released below), never blocked or double-billed
      // — the cancelfee:<bidId> idempotency key guards the Stripe side too.
      //
      // ADR 0033 — the fee is the retaining NOTARY'S compensation: billing
      // transfers it to them whole when they can receive, or books it as owed
      // to them (`dedommagementCentsDue`) when they cannot. `dedommagement`
      // on the bid says which, so the client reads where their money went.
      let annulation = null;
      const fee = wasRetained ? await annulationFeeFor(bid) : null;
      if (fee) {
        const b = billing();
        const charge = b && typeof b.chargeCancellationFee === 'function'
          ? await b.chargeCancellationFee({ paymentIntentId: bid.paymentIntentId, bidId: bid.id, amountCents: fee.fraisCents, notaryId: bid.notaryId || null })
          : { ok: false };
        if (charge.ok) {
          const dedommagement = { notaire: true, verse: !!charge.verse, transferId: charge.transferId || null };
          annulation = { taux: fee.taux, frais: fee.frais, joursAvant: fee.joursAvant, chargeId: charge.chargeId || null, dedommagement };
          // Une capture partielle est un mouvement d'argent : elle laisse une
          // trace, comme le règlement d'un acte (ADR 0023 + piste d'audit).
          // Le virement au notaire en fait partie (ADR 0033) : `verse` dit si
          // l'argent est parti, `transferId` le nomme.
          await appendAudit('annulation_frais', {
            bidId: bid.id,
            dateISO: bid.dateISO,
            notaryId: bid.notaryId || null,
            montant: bid.montant,
            taux: fee.taux,
            frais: fee.frais,
            joursAvant: fee.joursAvant,
            chargeId: charge.chargeId || null,
            transferId: dedommagement.transferId,
            verse: dedommagement.verse,
          }, acteur(ACTEUR.CLIENT, bid.id, request));
        }
      }

      const cancelled = { ...bid, status: domain.STATUS.ANNULEE, cancelledAt: now(), annulation };
      await repo.update(cancelled);
      // The signing no longer exists: drop it from the retaining notary's
      // calendar-feed pointers too (older repos may not have the method).
      if (wasRetained && bid.notaryId && typeof repo.removeRetained === 'function') {
        await repo.removeRetained(bid.notaryId, { id: bid.id, dateISO: bid.dateISO });
      }

      // No fee captured — free window, no live hold, or a failed capture: the
      // remaining authorization is released, retained case included (a partial
      // capture already released its remainder, so never on top of one).
      if (!annulation && billingConfigured && bid.paymentIntentId && bid.paymentStatus !== 'void') {
        const b = billing();
        if (b && typeof b.cancelAuthorization === 'function') {
          Promise.resolve(b.cancelAuthorization({ paymentIntentId: bid.paymentIntentId, bidId: bid.id })).catch(() => {});
        }
      }

      const cn = notifier();
      if (cn) {
        Promise.resolve(
          wasRetained && bid.notaryId ? repo.getNotary(bid.notaryId) : null
        )
          .then((notary) => cn.onOfferCancelled(cancelled, { notary, wasRetained }))
          .catch(() => {});
      }
      return json(200, { bid: publicBid(cancelled) });
    }

    // The contact form — no auth: anyone stuck deserves a way to reach a
    // human. The domain validates; the notifier carries the message to the
    // operator and acknowledges the sender. Always 202 on a valid payload,
    // even with mail disabled — the submission itself succeeded.
    if (route === '/contact' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      const v = domain.validateContactMessage(payload);
      if (!v.ok) return json(422, { errors: v.errors });
      const msg = {
        id: newId(),
        nom: v.nom,
        courriel: v.courriel,
        sujet: v.sujet,
        message: v.message,
        bidId: payload.bidId ? String(payload.bidId).slice(0, 80) : null,
        receivedAt: now(),
      };
      const kn = notifier();
      if (kn) Promise.resolve(kn.onContactMessage(msg)).catch(() => {});
      return json(202, { recu: true });
    }

    // --- Live support messaging (ADR 0026) ----------------------------------
    // The site's chat widget: no auth to start — anyone with a question
    // deserves a live answer. The first message mints the thread and its
    // signed SUPPORT token (the widget keeps it and polls with it); every
    // visitor message emails the operator with a signed SUPPORT_OP reply link,
    // so the answer is one tap away from the inbox and lands live in the
    // widget. The courriel is optional: it only adds an offline copy of the
    // reply — the widget itself is the channel.
    if (route === '/support/messages' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      // Per-IP throttle (ADR 0033 §7), same fixed-window counter as the
      // notary sign-in: an open, unauthenticated door must not become a mail
      // cannon aimed at the operator. Keyed on the trusted source IP; fails
      // OPEN on a counter error — a visitor's question beats strictness.
      const ip = clientIp(request);
      let count = 1;
      try {
        if (typeof repo.incrNotaryRateCounter === 'function') {
          count = await repo.incrNotaryRateCounter('support_message', ip || 'unknown', SUPPORT_RL_WINDOW_SEC, nowMs());
        }
      } catch {
        count = 1;
      }
      if (count > SUPPORT_RL_MAX) {
        return json(429, { errors: [{ code: 'trop_de_messages', message: 'Trop de messages en peu de temps. Réessayez dans quelques minutes.' }] });
      }
      const v = domain.validateSupportMessage(payload);
      if (!v.ok) return json(422, { errors: v.errors });
      // A token continues its thread; none starts one. A stale or tampered
      // token is refused (the widget clears it and starts fresh) rather than
      // silently splitting the conversation.
      let thread = null;
      const raw = bearer(request) || payload.token;
      if (raw) {
        const id = requireScope(raw, SCOPES.SUPPORT);
        if (!id) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });
        thread = await repo.getSupportThread(id);
        if (!thread) return json(404, { errors: [{ code: 'introuvable', message: 'Conversation introuvable.' }] });
      }
      const message = { id: newId(), de: domain.SUPPORT_FROM.VISITEUR, texte: v.texte, createdAt: new Date(nowMs()).toISOString() };
      if (!thread) thread = { id: newId(), courriel: null, createdAt: now(), messages: [] };
      if (v.courriel) thread.courriel = v.courriel;
      thread.messages = [...(thread.messages || []), message];
      await repo.putSupportThread(thread);
      const sn = notifier();
      if (sn && typeof sn.onSupportMessage === 'function') {
        const replyUrl = SUPPORT_URL
          ? SUPPORT_URL + '/#reponse=' + encodeURIComponent(signToken(thread.id, nowMs() + SUPPORT_OP_TTL_MS, SCOPES.SUPPORT_OP))
          : null;
        Promise.resolve(sn.onSupportMessage({ message, courriel: thread.courriel, replyUrl })).catch(() => {});
      }
      return json(201, {
        threadId: thread.id,
        token: signToken(thread.id, nowMs() + SUPPORT_TOKEN_TTL_MS, SCOPES.SUPPORT),
        message: supportMessageView(message),
      });
    }

    // The widget polls here while open; the operator's reply box reads the
    // same thread through its SUPPORT_OP link token.
    if (route === '/support/thread' && method === 'GET') {
      const raw = bearer(request);
      const id = requireScope(raw, SCOPES.SUPPORT) || requireScope(raw, SCOPES.SUPPORT_OP);
      if (!id) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });
      const thread = await repo.getSupportThread(id);
      if (!thread) return json(404, { errors: [{ code: 'introuvable', message: 'Conversation introuvable.' }] });
      return json(200, { messages: (thread.messages || []).map(supportMessageView) });
    }

    // The operator answers through the emailed link's SUPPORT_OP token — a
    // visitor token can never speak as Nota. The reply lands in the thread
    // (the widget polls it up) and is copied to the visitor's courriel when
    // they left one.
    if (route === '/support/reply' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      const id = requireScope(bearer(request) || payload.token, SCOPES.SUPPORT_OP);
      if (!id) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });
      const thread = await repo.getSupportThread(id);
      if (!thread) return json(404, { errors: [{ code: 'introuvable', message: 'Conversation introuvable.' }] });
      const v = domain.validateSupportMessage({ texte: payload.texte });
      if (!v.ok) return json(422, { errors: v.errors });
      const message = { id: newId(), de: domain.SUPPORT_FROM.NOTA, texte: v.texte, createdAt: new Date(nowMs()).toISOString() };
      thread.messages = [...(thread.messages || []), message];
      await repo.putSupportThread(thread);
      const rn = notifier();
      if (rn && typeof rn.onSupportReply === 'function' && thread.courriel) {
        Promise.resolve(rn.onSupportReply({ message, courriel: thread.courriel })).catch(() => {});
      }
      return json(200, { message: supportMessageView(message) });
    }

    if (route === '/notary/bids/decline' && method === 'POST') {
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      // Session-scoped token: Authorization header preferred, POST-body `token`
      // accepted as a fallback. A feed-scoped token is rejected.
      const notaryId = requireScope(bearer(request) || payload.token, SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });
      if (!payload.id) return json(422, { errors: [{ code: 'id_manquant', message: 'L’identifiant de l’offre est requis.' }] });
      await repo.putDecline(notaryId, payload.id);
      // ADR 0028: declining is a real answer — it just lowers the availability
      // axis. Counted, never punished twice.
      await bumpNotary(notaryId, 'declinesCount');
      return json(200, { declined: true });
    }

    // The retaining notary writes to their client. The thread lives on the bid
    // and only exists while the act is retained (domain.validateChatMessage) —
    // and only for the notary who holds it, never a bystander.
    if (route === '/notary/bids/message' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      const notaryId = requireScope(bearer(request) || payload.token, SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });
      const bid = await repo.get(payload.id, payload.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      if (bid.status === domain.STATUS.ANNULEE) return goneCancelled();
      if (bid.notaryId !== notaryId) {
        return json(403, { errors: [{ code: 'interdit', message: 'Conversation réservée au notaire qui a retenu l’offre.' }] });
      }
      const v = domain.validateChatMessage({ bid, de: domain.CHAT_FROM.NOTAIRE, texte: payload.texte });
      if (!v.ok) return json(422, { errors: v.errors });
      const message = { id: newId(), de: domain.CHAT_FROM.NOTAIRE, texte: v.texte, createdAt: new Date(nowMs()).toISOString() };
      await repo.update({ ...bid, messages: [...messagesOf(bid), message] });
      // Tell the client their notary wrote (fire-and-forget, once per message).
      const mn = notifier();
      if (mn && typeof mn.onChatMessage === 'function') {
        Promise.resolve(mn.onChatMessage(bid, message)).catch(() => {});
      }
      return json(200, { message: chatMessage(message) });
    }

    // The client answers in the same thread, proving ownership with their
    // per-bid token like every other client route.
    if (route === '/client/bid/message' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      const auth = requireClient(request, payload.id);
      if (auth.error) return auth.error;
      const bid = await repo.get(payload.id, payload.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      if (bid.status === domain.STATUS.ANNULEE) return goneCancelled();
      const v = domain.validateChatMessage({ bid, de: domain.CHAT_FROM.CLIENT, texte: payload.texte });
      if (!v.ok) return json(422, { errors: v.errors });
      const message = { id: newId(), de: domain.CHAT_FROM.CLIENT, texte: v.texte, createdAt: new Date(nowMs()).toISOString() };
      await repo.update({ ...bid, messages: [...messagesOf(bid), message] });
      // Tell the retaining notary their client replied (fire-and-forget, once
      // per message — the notifier resolves the notary from bid.notaryId).
      const mc = notifier();
      if (mc && typeof mc.onChatMessage === 'function') {
        Promise.resolve(mc.onChatMessage(bid, message)).catch(() => {});
      }
      return json(200, { message: chatMessage(message) });
    }

    // --- Les documents de la conversation (ADR 0032) -------------------------
    // Quatre portes, deux par partie : ouvrir un dépôt, puis le confirmer une
    // fois le fichier réellement arrivé. Les octets ne passent jamais ici.
    if (route === '/client/bid/documents' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      return ouvrirDepot(request, payload, domain.CHAT_FROM.CLIENT);
    }
    if (route === '/client/bid/documents/confirme' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      return confirmerDepot(request, payload, domain.CHAT_FROM.CLIENT);
    }
    if (route === '/client/bid/documents' && method === 'GET') {
      return ouvrirLecture(request, query, domain.CHAT_FROM.CLIENT);
    }

    if (route === '/notary/bids/documents/depot' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      return ouvrirDepot(request, payload, domain.CHAT_FROM.NOTAIRE);
    }
    if (route === '/notary/bids/documents/confirme' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      return confirmerDepot(request, payload, domain.CHAT_FROM.NOTAIRE);
    }
    if (route === '/notary/bids/documents' && method === 'GET') {
      return ouvrirLecture(request, query, domain.CHAT_FROM.NOTAIRE);
    }

    // The retaining notary WITHDRAWS after accepting — a detail surfaced in the
    // conversation (an unfamiliar lender, a conflict) makes the file impossible
    // on their side. The act returns to the open market exactly as the client
    // posted it (domain.releasedBid); the withdrawing notary stops seeing it
    // (decline marker), their calendar pointer is dropped, and the client (and
    // the operator, when money may be in flight) are notified.
    if (route === '/notary/bids/release' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      const notaryId = requireScope(bearer(request) || payload.token, SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });
      const bid = await repo.get(payload.id, payload.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      if (bid.status === domain.STATUS.ANNULEE) return goneCancelled();
      if (bid.status === domain.STATUS.RETENUE && bid.notaryId !== notaryId) {
        return json(403, { errors: [{ code: 'interdit', message: 'Seul le notaire qui a retenu l’offre peut se désister.' }] });
      }
      const v = domain.validateRelease({ bid, message: payload.message });
      if (!v.ok) return json(422, { errors: v.errors });

      // ART. 37 — la conversation meurt avec la relation. `releasedBid` vide le
      // fil et les documents ; ici on efface aussi les octets, devenus
      // inatteignables : les laisser 400 jours serait un risque sans contrepartie.
      const clesAEffacer = domain.releasedDocumentKeys(bid);
      const released = domain.releasedBid(bid);
      await repo.update(released);
      if (storage && clesAEffacer.length) {
        // Best-effort : un effacement qui échoue ne doit pas empêcher un notaire
        // de se désister — le cycle de vie du seau reprendra la main.
        for (const cle of clesAEffacer) {
          try { await storage.remove(cle); } catch { /* le seau expirera de toute façon */ }
        }
      }
      // The withdrawing notary never sees this act again in their feed, and the
      // signing leaves their calendar.
      await repo.putDecline(notaryId, bid.id);
      if (typeof repo.removeRetained === 'function') {
        await repo.removeRetained(notaryId, { id: bid.id, dateISO: bid.dateISO });
      }
      // ADR 0033: withdrawing is free, but it is COUNTED on the notary's record
      // — a client lost their notary, and the console tells the notary so.
      await bumpNotary(notaryId, 'releasesCount');

      // The operator is ALWAYS told (ADR 0033, notifier-side): a désistement
      // is a signal on the notary's file whether or not money is in flight.
      const rn = notifier();
      if (rn && typeof rn.onActReleased === 'function') {
        Promise.resolve(repo.getNotary(notaryId))
          .then((notary) => rn.onActReleased(released, { notary, etude: bid.etude, message: v.message, paidOrHeld: !!bid.paymentIntentId }))
          .catch(() => {});
      }
      return json(200, { bid: publicBid(released) });
    }

    if (route === '/notary/dossier' && method === 'GET') {
      // Session-scoped token from the Authorization header — the dossier holds
      // the client's private courriel + file, so a feed token is rejected here.
      const notaryId = requireScope(bearer(request), SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });
      const bid = await repo.get(query.id, query.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      // The dossier is released ONLY to the notary who retained the bid — and
      // with it the mise en relation contact block (ADR 0010 §4).
      if (bid.notaryId !== notaryId) {
        return json(403, { errors: [{ code: 'interdit', message: 'Dossier réservé au notaire qui a retenu l’offre.' }] });
      }
      return json(200, {
        id: bid.id,
        courriel: bid.courriel || null,
        dossier: bid.dossier || null,
        client: clientContact(bid),
        preteur: bidLenderInfo(bid),
        messages: messagesOf(bid).map(chatMessage),
        documents: documentsOf(bid).filter((d) => d.etat === 'pret').map(publicDocument),
      });
    }

    // Webcal feed of this notary's retained signings, for calendar subscription.
    // A calendar client cannot send headers, so the token lives in the URL — which
    // is exactly why it must be FEED-scoped: a leaked feed URL exposes only the
    // read-only .ics, never accept/dossier. A session token is rejected here.
    if (route === '/notary/feed.ics' && method === 'GET') {
      const notaryId = requireScope(query.token, SCOPES.FEED);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });
      const events = await repo.listRetainedByNotary(notaryId);
      // Hydrate each pointer into the decision details the retaining notary is
      // already entitled to (montant, prêteur, déplacement, readiness, client
      // NAME — the mise en relation, never the courriel or dossier content).
      // A pointer whose bid record is gone still renders from its own fields.
      const rows = [];
      for (const e of events) {
        let bid = null;
        try {
          bid = await repo.get(e.id, e.dateISO);
        } catch {
          /* enrichment only: the pointer alone still makes a valid event */
        }
        rows.push(
          bid
            ? {
                id: e.id,
                dateISO: e.dateISO,
                serviceId: bid.serviceId,
                montant: bid.montant,
                preteur: bidLenderInfo(bid),
                deplacement: bidDeplacementInfo(bid),
                ready: domain.leadReadiness(bid.serviceId, bid.dossier || {}, bid.pricing).ready,
                clientNom: bid.nom || null,
                prefixe: bid.prefixe || null,
              }
            : e
        );
      }
      // The cross-origin download honours the HEADER filename (the anchor's
      // download attribute is ignored cross-origin), so name it here.
      return calendar(200, buildNotaryFeed(rows, icsStamp(), siteUrl), 'nota-signatures.ics');
    }

    // PUBLIC carnet feed — no token. Anyone can subscribe to the whole carnet in
    // Google / Outlook / Apple over webcal. It scans the same forward month
    // window the notary open feed uses and returns ONLY the public projection
    // (publicBid), so it can never expose a courriel or dossier.
    if (route === '/carnet/feed.ics' && method === 'GET') {
      const months = monthWindow(now().slice(0, 7), NOTARY_HORIZON_MONTHS);
      const bids = [];
      for (const m of months) {
        // Same isLive gate as GET /bids: never leak pending/void (unauthorized or
        // withdrawn) offers into the publicly subscribable calendar feed.
        for (const b of await repo.listByMonth(m)) {
          if (isLive(b) && b.status !== domain.STATUS.ANNULEE) bids.push(publicBid(b));
        }
      }
      return calendar(200, buildCarnetFeed(bids, icsStamp(), siteUrl));
    }

    return json(404, { errors: [{ code: 'introuvable', message: 'Route inconnue.' }] });
  }

  return { handle, publicBid };
}

module.exports = { createApp };
