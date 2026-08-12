'use strict';

const domain = require('@nota/domain');
const { createBilling } = require('./billing');
const { decodeUnsubToken } = require('./notifications');

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
      priceId: process.env.STRIPE_PRICE_ID,
    });
    billingInstance = createBilling({
      repo,
      stripe,
      newId,
      now: () => new Date().toISOString(),
      successUrl: process.env.STRIPE_SUCCESS_URL,
      cancelUrl: process.env.STRIPE_CANCEL_URL,
    });
    return billingInstance;
  }

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

  // Public projection: strip anything private and enforce anonymity server-side.
  // A bid marked anonyme never leaks its name, whatever the client sent. The
  // dossier (documents/fields) is never part of the public shape.
  function publicBid(b) {
    return {
      id: b.id,
      serviceId: b.serviceId,
      dateISO: b.dateISO,
      montant: b.montant,
      tier: b.tier,
      premium: b.premium,
      status: b.status,
      etude: b.etude || null,
      anonyme: !!b.anonyme,
      nom: b.anonyme ? null : b.nom || null,
      prefixe: b.prefixe || null,
      createdAt: b.createdAt,
    };
  }

  // Shared CORS headers so a JSON response and a bodiless 204 preflight agree.
  function corsHeaders() {
    return {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
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

    if (route === '/health' && method === 'GET') {
      return json(200, { ok: true, today: now() });
    }

    if (route === '/bids' && method === 'GET') {
      const month = query.month || now().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return json(400, { errors: [{ code: 'mois_invalide', message: 'month doit être AAAA-MM.' }] });
      }
      const bids = await repo.listByMonth(month);
      return json(200, { month, bids: bids.map(publicBid) });
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
        status: domain.STATUS.OUVERTE,
        etude: null,
        createdAt: todayISO,
      };
      await repo.put(bid);

      // Fire-and-forget: confirm the offer to the client + alert the operator.
      // Never awaited and never allowed to reject the response — if mail fails
      // the offer is still created and returned.
      const n = notifier();
      if (n) Promise.resolve(n.onOfferCreated(bid)).catch(() => {});

      return json(201, { bid: publicBid(bid) });
    }

    // Open a flat monthly subscription for a notary. Returns the Stripe Checkout
    // URL the client redirects to; card data never touches this server.
    if (route === '/notaries/subscribe' && method === 'POST') {
      let payload;
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      const result = await billing().startSubscription({ email: payload.email });
      if (!result.ok) return json(422, { errors: result.errors });
      return json(200, { url: result.url });
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

    return json(404, { errors: [{ code: 'introuvable', message: 'Route inconnue.' }] });
  }

  return { handle, publicBid };
}

module.exports = { createApp };
