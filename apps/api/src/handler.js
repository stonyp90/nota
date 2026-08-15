'use strict';

const domain = require('@nota/domain');
const { createBilling } = require('./billing');
const { decodeUnsubToken } = require('./notifications');
const { signToken, verifyToken, notaryIdForEmail, SCOPES } = require('./notary-auth');
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
  const now = opts.now || (() => new Date().toISOString().slice(0, 10));
  const newId = opts.newId || (() => require('crypto').randomUUID());

  // Wall-clock source for notary token expiry, in epoch milliseconds. Separate
  // from `now` (a business date string) and injectable so token tests are
  // deterministic. Default is the real clock.
  const nowMs = opts.nowMs || (() => Date.now());
  // How long a freshly-issued notary token stays valid. Configurable, not baked
  // into the token logic; default 7 days.
  const NOTARY_TOKEN_TTL_MS = opts.notaryTokenTtlMs || 7 * 24 * 60 * 60 * 1000;
  // How many months forward the notary open-bid feed scans, one Query per month
  // (the API role has no Scan). Configurable; default the current month + 3.
  const NOTARY_HORIZON_MONTHS = opts.notaryHorizonMonths || 4;

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
      newId,
      now: () => new Date().toISOString(),
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
  const billingConfigured = !!opts.billing || !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
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
  // dossier (documents/fields) is never part of the public shape.
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
      // The case-complexity signal (easy/hard) + the factors that drive it, so a
      // notary can judge whether the posted price fits the file before retaining.
      complexity: domain.complexity(b.serviceId, b.pricing || null),
    };
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
        return json(400, { errors: [{ code: 'mois_invalide', message: 'month doit être AAAA-MM.' }] });
      }
      const bids = await repo.listByMonth(month);
      return json(200, { month, bids: bids.filter(isLive).map(publicBid) });
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
      if (!v.ok) return json(422, { errors: v.errors });

      const anonyme = payload.anonyme !== false; // default anonymous
      const bid = {
        id: newId(),
        serviceId: payload.serviceId,
        dateISO: payload.dateISO,
        montant: v.montant,
        tier: v.tier,
        premium: v.premium,
        anonyme,
        nom: anonyme ? null : String(payload.nom || '').trim().slice(0, 120) || null,
        prefixe: String(payload.prefixe || '').trim().toUpperCase().slice(0, 3) || null,
        // PRIVATE: used only for notifications, never surfaced by publicBid().
        courriel: v.courriel ? v.courriel.toLowerCase() : null,
        // PRIVATE: the structured intake the client assembled (field values +
        // any documents/consent). Released ONLY to the notary who retains the
        // bid; it MUST NEVER appear in publicBid() / GET /bids.
        dossier:
          payload.dossier && typeof payload.dossier === 'object' && !Array.isArray(payload.dossier)
            ? payload.dossier
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
        return json(201, { bid: publicBid(bid), paymentStatus: 'pending', checkoutUrl: auth.url });
      }

      return json(201, { bid: publicBid(bid) });
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
      const result = await billing().connectNotary({ email: payload.email });
      if (!result.ok) return json(422, { errors: result.errors });
      return json(200, { url: result.url });
    }

    // A notary marks a retained act completed with its final value; Nota charges
    // its commission as a Stripe Connect application fee. Session-scoped.
    if (route === '/notary/acts/complete' && method === 'POST') {
      const notaryId = requireScope(bearer(request), SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      const result = await billing().completeAct({ notaryId, bidId: payload.bidId, actAmount: payload.actAmount });
      if (!result.ok) return json(422, { errors: result.errors });
      return json(200, { ok: true, commissionCents: result.commissionCents });
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

      // Fire the matching subscription lifecycle email (welcome/receipt/dunning/
      // win-back + operator alert). Best-effort; skipped on a redelivered event.
      const n = notifier();
      if (n && result.event && !result.duplicate) {
        Promise.resolve(n.onSubscription(result.event, result.notary)).catch(() => {});
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

    // --- Notary console -----------------------------------------------------
    // A notary signs in with an email and receives signed tokens. Access is
    // gated on an ACTIVE subscription: issuing a token to any valid email would
    // let anyone accept bids and read a client's courriel + dossier. The flat
    // subscription is what grants console access.
    if (route === '/notary/session' && method === 'POST') {
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      const email = String(payload.email || '').trim().toLowerCase();
      if (!domain.isEmail(email)) {
        return json(422, { errors: [{ code: 'courriel_invalide', message: 'Le courriel n’est pas valide.' }] });
      }
      const notaryId = notaryIdForEmail(email);
      const existing = await repo.getNotary(notaryId);

      // Demo escape hatch, OFF by default: setting NOTA_DEMO_OPEN=true skips the
      // subscription gate so an operator can run an open demo. DEMO ONLY — never
      // set this in real production; it lets any valid email into the console.
      const demoOpen = process.env.NOTA_DEMO_OPEN === 'true';
      // Accept either an explicit `status:'active'` (seeded/admin) or the Stripe
      // webhook's `subscriptionStatus:'active'`, so a genuinely subscribed notary
      // unlocks the console.
      const active = !!(existing && (existing.status === 'active' || existing.subscriptionStatus === 'active'));
      if (!demoOpen && !active) {
        return json(403, {
          errors: [{ code: 'abonnement_requis', message: 'Un abonnement actif est requis pour accéder à la console.' }],
        });
      }

      // Upsert the notary profile so accept can stamp a stable étude label.
      // Spread `existing` first so we never clobber status/subscription fields.
      const label = (existing && existing.label) || email;
      await repo.putNotary({
        ...(existing || {}),
        id: notaryId,
        email,
        label,
        role: 'notary',
        createdAt: (existing && existing.createdAt) || new Date(nowMs()).toISOString(),
      });
      const exp = nowMs() + NOTARY_TOKEN_TTL_MS;
      return json(200, {
        // Full-console token: sent in the Authorization header, never in a URL.
        token: signToken(notaryId, exp, SCOPES.SESSION),
        // Read-only calendar token, safe to embed in the webcal URL. It cannot
        // accept a bid or read a dossier.
        feedToken: signToken(notaryId, exp, SCOPES.FEED),
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
      for (const month of months) {
        const bids = await repo.listByMonth(month);
        for (const b of bids) {
          if (b.status !== domain.STATUS.OUVERTE) continue;
          if (!isLive(b)) continue; // hide offers whose card authorization is still pending/void
          if (query.service && b.serviceId !== query.service) continue;
          if (await repo.wasDeclined(notaryId, b.id)) continue;
          if (seen.has(b.id)) continue;
          seen.add(b.id);
          out.push(notaryBid(b));
        }
      }
      return json(200, { bids: out });
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

      // PAY-ON-ACCEPT: capture the client's authorized card and transfer the net
      // (act value − commission) to the notary the instant they accept. A no-op
      // without billing or without an authorized payment; idempotent per bid
      // (shared act ledger), so a re-accept or double-submit never pays twice.
      async function payout(b) {
        if (!billingConfigured || !b || !b.paymentIntentId) return null;
        return billing().payNotaryOnAccept({ notaryId, bidId: b.id, actAmount: b.montant, paymentIntentId: b.paymentIntentId });
      }
      const withPayout = (base, pay) => !pay ? base
        : pay.ok ? { ...base, paid: true, commissionCents: pay.commissionCents, netCents: pay.netCents }
          : { ...base, paid: false, paymentError: (pay.errors && pay.errors[0] && pay.errors[0].code) || 'paiement_echoue' };

      // Idempotent + access-controlled: re-accept by the SAME notary returns the
      // dossier (settling payment if it had not been); another notary -> 409.
      if (bid.status === domain.STATUS.RETENUE) {
        if (bid.notaryId === notaryId) {
          const pay = await payout(bid);
          return json(200, withPayout({ id: bid.id, courriel: bid.courriel || null, dossier: bid.dossier || null }, pay));
        }
        return json(409, { errors: [{ code: 'deja_retenue', message: 'Cette offre est déjà retenue.' }] });
      }

      const profile = await repo.getNotary(notaryId);
      const updated = {
        ...bid,
        status: domain.STATUS.RETENUE,
        notaryId,
        etude: (profile && profile.label) || notaryId,
      };
      // Conditional retain closes the TOCTOU race: two notaries accepting the
      // same open bid concurrently both read status=ouverte, but only ONE write
      // succeeds — the repo flips the bid only while it is still ouverte. Because
      // only the winner reaches the payout below, the client's card is captured
      // exactly once.
      const retained = await repo.retain(updated, notaryId);
      if (!retained) {
        // Lost the race. Re-read to answer precisely: if WE ended up the winner
        // (a double-submit by the same notary), it is idempotent; otherwise the
        // bid is now held by someone else -> 409.
        const fresh = await repo.get(payload.id, payload.dateISO);
        if (fresh && fresh.status === domain.STATUS.RETENUE && fresh.notaryId === notaryId) {
          const pay = await payout(fresh);
          return json(200, withPayout({ id: fresh.id, courriel: fresh.courriel || null, dossier: fresh.dossier || null }, pay));
        }
        return json(409, { errors: [{ code: 'deja_retenue', message: 'Cette offre est déjà retenue.' }] });
      }
      await repo.putRetained(notaryId, {
        id: retained.id,
        dateISO: retained.dateISO,
        serviceId: retained.serviceId,
        montant: retained.montant,
      });
      await recordStats(statsDeltasForRetain(retained, now()));
      const pay = await payout(retained);
      return json(200, withPayout({ id: retained.id, courriel: retained.courriel || null, dossier: retained.dossier || null }, pay));
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
      if (!payload.id) return json(422, { errors: [{ code: 'id_manquant', message: 'id est requis.' }] });
      await repo.putDecline(notaryId, payload.id);
      return json(200, { declined: true });
    }

    if (route === '/notary/dossier' && method === 'GET') {
      // Session-scoped token from the Authorization header — the dossier holds
      // the client's private courriel + file, so a feed token is rejected here.
      const notaryId = requireScope(bearer(request), SCOPES.SESSION);
      if (!notaryId) return json(401, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] });
      const bid = await repo.get(query.id, query.dateISO);
      if (!bid) return json(404, { errors: [{ code: 'introuvable', message: 'Offre introuvable.' }] });
      // The dossier is released ONLY to the notary who retained the bid.
      if (bid.notaryId !== notaryId) {
        return json(403, { errors: [{ code: 'interdit', message: 'Dossier réservé au notaire qui a retenu l’offre.' }] });
      }
      return json(200, { id: bid.id, courriel: bid.courriel || null, dossier: bid.dossier || null });
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
        for (const b of await repo.listByMonth(m)) bids.push(publicBid(b));
      }
      return calendar(200, buildCarnetFeed(bids, icsStamp()));
    }

    return json(404, { errors: [{ code: 'introuvable', message: 'Route inconnue.' }] });
  }

  return { handle, publicBid };
}

module.exports = { createApp };
