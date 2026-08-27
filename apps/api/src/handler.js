'use strict';

const domain = require('@nota/domain');
const { createBilling } = require('./billing');
const { decodeUnsubToken } = require('./notifications');
const { signToken, signChallengeToken, verifyToken, notaryIdForEmail, SCOPES } = require('./notary-auth');
const { buildNotaryFeed, buildCarnetFeed } = require('./ics');
const { statsDeltasForOffer, statsDeltasForRetain } = require('./stats');

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
      commissionRate: process.env.NOTA_COMMISSION_RATE ? Number(process.env.NOTA_COMMISSION_RATE) : undefined,
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
  const siteUrl = opts.siteUrl || process.env.NOTA_SITE_URL || '';
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
    notifierInstance = createNotifier({
      repo,
      mailer,
      baseUrl: process.env.NOTA_BASE_URL,
      operatorEmail: process.env.NOTA_OPERATOR_EMAIL,
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
    return { notaryId, existing, demoOpen, active, allowed: demoOpen || active };
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
    await repo.putNotary({
      ...(existing || {}),
      ...demoActivation,
      id: notaryId,
      email,
      label,
      role: 'notary',
      createdAt: (existing && existing.createdAt) || new Date(nowMs()).toISOString(),
    });
  }

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

  function publicBid(b) {
    return {
      id: b.id,
      serviceId: b.serviceId,
      dateISO: b.dateISO,
      montant: b.montant,
      tier: b.tier,
      premium: publicPremium(b),
      status: b.status,
      etude: b.etude || null,
      anonyme: !!b.anonyme,
      nom: b.anonyme ? null : b.nom || null,
      prefixe: b.prefixe || null,
      createdAt: b.createdAt,
    };
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

  function notaryBid(b) {
    const r = domain.leadReadiness(b.serviceId, b.dossier || {});
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
  async function retainFor(bid, notaryId, extra = {}) {
    const profile = await repo.getNotary(notaryId);
    const updated = {
      ...bid,
      ...extra,
      status: domain.STATUS.RETENUE,
      notaryId,
      etude: (profile && profile.label) || notaryId,
    };
    const retained = await repo.retain(updated, notaryId);
    if (!retained) return null;
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
    if (rn) Promise.resolve(rn.onOfferRetained(retained)).catch(() => {});
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
  function calendar(statusCode, body) {
    return {
      statusCode,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'attachment; filename="nota-carnet.ics"',
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
        // Dynamic pricing criteria (part of the dossier): the server recomputes
        // the floor from these, never trusting the client's base/total.
        pricing: payload.pricing,
        todayISO,
      });
      const errors = [...v.errors];

      // OPTIONAL telephone (ADR 0010 §4, mise en relation): the number the
      // RETAINING notary will dial, released only with the dossier. Validation
      // is deliberately loose — people type "(418) 555-1234", "418.555.1234",
      // "1 418 555 1234" — so we only require that stripping the formatting
      // leaves a dialable North-American number (10 digits, or 11 with the
      // country code). We store what the client typed, trimmed: the formatting
      // is information for the human who will call, and domain.telHref() knows
      // how to turn it into a dial string when a tel: link is needed.
      const telephone = payload.telephone == null ? '' : String(payload.telephone).trim();
      if (telephone !== '') {
        const digits = telephone.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 11) {
          errors.push({ code: 'telephone_invalide', message: 'Le numéro de téléphone n’est pas valide.' });
        }
      }
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
        prefixe: String(payload.prefixe || '').trim().toUpperCase().slice(0, 3) || null,
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
      if (billingConfigured) bid.paymentStatus = 'pending';
      await repo.put(bid);
      await recordStats(statsDeltasForOffer(bid));

      // Fire-and-forget: confirm the offer to the client + alert the operator.
      // Never awaited and never allowed to reject the response — if mail fails
      // the offer is still created and returned.
      const n = notifier();
      if (n) Promise.resolve(n.onOfferCreated(bid)).catch(() => {});

      // The client's per-bid key (no account): scope CLIENT, sub = bid id. It is
      // returned ONCE here and never echoed by any other route.
      const clientToken = signToken(bid.id, nowMs() + CLIENT_TOKEN_TTL_MS, SCOPES.CLIENT);

      if (billingConfigured) {
        const svc = domain.serviceById(bid.serviceId);
        const auth = await billing().authorizeOffer({
          bidId: bid.id,
          bidDate: bid.dateISO,
          amountCents: Math.round(bid.montant * 100),
          email: bid.courriel || undefined,
          description: (svc && svc.nom) || 'Acte notarié',
          successUrl: siteUrl ? siteUrl + '/?paiement=ok' : undefined,
          cancelUrl: siteUrl ? siteUrl + '/?paiement=annule' : undefined,
        });
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
      const body = { ok: true };
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
      const partenaire = { code, type: claim.type, courriel: claim.courriel, createdAt: now(), confirmedAt: now() };
      if (await repo.createPartner(partenaire)) {
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

    // Begin FREE notary onboarding — open a Stripe Connect onboarding link.
    // No subscription; Nota takes a commission only when an act completes.
    if (route === '/notaries/connect' && method === 'POST') {
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
      let result = null;
      const canCapture = billingConfigured && bid.paymentIntentId && bid.paymentStatus === 'authorized';
      if (canCapture) {
        // Historical name (pay-on-accept era): the mechanics — capture the
        // client's card, keep the commission, transfer the net — are exactly
        // the paid-at-signing settlement, now invoked here instead.
        result = await billing().payNotaryOnAccept({
          notaryId, bidId: payload.bidId, actAmount: payload.actAmount, paymentIntentId: bid.paymentIntentId,
        });
      }
      if (!result || !result.ok) {
        // No capturable hold, or the capture failed (lapsed past Stripe's
        // ~7-day window, declined): the act still settles on the commission
        // model — the client paid the notary directly at signing.
        result = await billing().completeAct({ notaryId, bidId: payload.bidId, actAmount: payload.actAmount });
      }
      if (!result.ok) return json(422, { errors: result.errors });
      // Payout statement + operator alert, once per bid (fire-and-forget).
      const an = notifier();
      if (an) Promise.resolve(an.onActPaid({ notaryId, bid, actAmount: payload.actAmount })).catch(() => {});
      return json(200, {
        ok: true,
        commissionCents: result.commissionCents,
        ...(result.netCents != null ? { paid: true, netCents: result.netCents } : {}),
      });
    }

    // Stripe webhook. The raw request body and the `stripe-signature` header are
    // verified by the adapter; a bad signature is a 400. Idempotent by event id.
    if (route === '/stripe/webhook' && method === 'POST') {
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
    if (route === '/unsubscribe' && method === 'GET') {
      const email = decodeUnsubToken(query.token || '');
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
      const claims = verifyToken(String(payload.token || ''), nowMs());
      if (!claims || claims.scope !== SCOPES.CHALLENGE || !claims.cid) {
        return json(401, { errors: [{ code: 'lien_invalide', message: 'Lien invalide ou expiré.' }] });
      }

      // Atomic single-use consume: the FIRST redemption wins, a replay gets null.
      const challenge = await repo.consumeNotaryLoginChallenge(claims.cid, nowMs());
      if (!challenge || challenge.notaryId !== claims.sub) {
        return json(401, { errors: [{ code: 'lien_invalide', message: 'Lien invalide ou déjà utilisé.' }] });
      }

      const email = challenge.email;
      const gate = await notaryGate(email);
      if (!gate.allowed) {
        return json(403, {
          errors: [{ code: 'compte_requis', message: 'Un compte notaire actif est requis pour accéder à la console. L’inscription est gratuite.' }],
        });
      }

      await upsertNotaryProfile(gate, email);
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
              retained.push({
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
                // The live thread with the client — the place details surface
                // (and the reason a notary may still withdraw, see /release).
                messages: messagesOf(b).map(chatMessage),
                viaProposition: propositionsOf(b).some((p) => p.status === PROPOSITION.ACCEPTEE && p.notaryId === notaryId),
              });
            }
            continue;
          }
          if (b.status !== domain.STATUS.OUVERTE) continue;
          if (!isLive(b)) continue; // hide offers whose card authorization is still pending/void
          if (query.service && b.serviceId !== query.service) continue;
          if (await repo.wasDeclined(notaryId, b.id)) continue;
          seen.add(b.id);
          const mine = latestPropositionFor(b, notaryId);
          const ask = latestDemandeFor(b, notaryId);
          out.push({
            ...notaryBid(b),
            // ONLY this notary's own proposition/demande — never another's.
            proposition: mine ? { id: mine.id, montant: mine.montant, delta: mine.delta, status: mine.status, createdAt: mine.createdAt } : null,
            demande: ask ? { id: ask.id, documents: ask.documents, createdAt: ask.createdAt, fournie: demandeFournie(b, ask) } : null,
            missing: domain.leadReadiness(b.serviceId, b.dossier || {}).missing,
          });
        }
      }
      return json(200, { bids: out, retained });
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

      // Conditional retain (retainFor) closes the TOCTOU race: two notaries
      // accepting the same open bid concurrently both read status=ouverte, but
      // only ONE write succeeds — the repo flips the bid only while it is still
      // ouverte.
      const retained = await retainFor(bid, notaryId);
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
      const v = domain.validateCounterOffer({ bid, montant: payload.montant, todayISO: now() });
      const errors = [...v.errors];
      const message = payload.message == null ? '' : String(payload.message).trim();
      if (message.length > PROPOSITION_MESSAGE_MAX) {
        errors.push({ code: 'message_trop_long', message: `Le message ne peut dépasser ${PROPOSITION_MESSAGE_MAX} caractères.` });
      }
      if (errors.length) return json(422, { errors });

      const profile = await repo.getNotary(notaryId);
      const proposition = {
        id: newId(),
        notaryId,
        etude: (profile && profile.label) || notaryId,
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
        etude: (profile && profile.label) || notaryId,
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
        notaire = {
          etude: bid.etude || (profile && profile.label) || null,
          courriel: (profile && profile.email) || null,
        };
      }
      // Act + evaluation state (ADR 0015): once the ACT# ledger has settled
      // the signing, the client may evaluate the notary — the UI keys on
      // `acte.complete`.
      const completion = typeof repo.getActCompletion === 'function' ? await repo.getActCompletion(bid.id) : null;
      return json(200, {
        bid: publicBid(bid),
        notaire,
        propositions: propositionsOf(bid).filter((p) => p.status !== PROPOSITION.REMPLACEE).map(clientProposition),
        demandes: demandesOf(bid).map((d) => clientDemande(bid, d)),
        readiness: domain.leadReadiness(bid.serviceId, bid.dossier || {}),
        // The retained-act conversation. Empty until a notary retains the bid.
        messages: messagesOf(bid).map(chatMessage),
        acte: { complete: !!completion },
        evaluation: bid.evaluation ? { note: bid.evaluation.note, commentaire: bid.evaluation.commentaire || null } : null,
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
      const retained = await retainFor(bid, answered.notaryId, extra);
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
        readiness: domain.leadReadiness(updated.serviceId, dossier),
        demandes: demandesOf(updated).map((d) => clientDemande(updated, d)),
      });
    }

    // The client withdraws their offer — open OR already retained. Guarded by
    // the same per-bid CLIENT token as every other client route; idempotent.
    // Retained case: the mise en relation is unwound, so the retaining notary
    // (and the operator) are notified. Open case with a live card hold
    // (pay-on-accept): the hold is released, same fire-and-forget contract as
    // the proposition-accept path.
    if (route === '/client/bid/cancel' && method === 'POST') {
      const { payload, error } = parseBody(request);
      if (error) return error;
      const auth = requireClient(request, payload.id);
      if (auth.error) return auth.error;
      const bid = await repo.get(payload.id, payload.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      if (bid.status === domain.STATUS.ANNULEE) return json(200, { bid: publicBid(bid) });

      const wasRetained = bid.status === domain.STATUS.RETENUE;
      const cancelled = { ...bid, status: domain.STATUS.ANNULEE, cancelledAt: now() };
      await repo.update(cancelled);
      // The signing no longer exists: drop it from the retaining notary's
      // calendar-feed pointers too (older repos may not have the method).
      if (wasRetained && bid.notaryId && typeof repo.removeRetained === 'function') {
        await repo.removeRetained(bid.notaryId, { id: bid.id, dateISO: bid.dateISO });
      }

      if (!wasRetained && billingConfigured && bid.paymentIntentId) {
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
      return json(200, { message: chatMessage(message) });
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

      const released = domain.releasedBid(bid);
      await repo.update(released);
      // The withdrawing notary never sees this act again in their feed, and the
      // signing leaves their calendar.
      await repo.putDecline(notaryId, bid.id);
      if (typeof repo.removeRetained === 'function') {
        await repo.removeRetained(notaryId, { id: bid.id, dateISO: bid.dateISO });
      }

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
      return calendar(200, buildNotaryFeed(events, icsStamp()));
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
      return calendar(200, buildCarnetFeed(bids, icsStamp()));
    }

    return json(404, { errors: [{ code: 'introuvable', message: 'Route inconnue.' }] });
  }

  return { handle, publicBid };
}

module.exports = { createApp };
