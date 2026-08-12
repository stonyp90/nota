'use strict';

const domain = require('@nota/domain');
const { createBilling } = require('./billing');

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

  function json(statusCode, obj) {
    return {
      statusCode,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
        'cache-control': 'no-store',
      },
      body: JSON.stringify(obj),
    };
  }

  async function handle(request) {
    const method = (request.method || 'GET').toUpperCase();
    // CloudFront routes /api/* to this Lambda so the site is single-origin.
    // Strip that prefix so routes are declared once, prefix-agnostic.
    const route = (request.path || '/').replace(/^\/api(?=\/|$)/, '') || '/';
    const query = request.query || {};

    if (method === 'OPTIONS') return json(204, {});

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
        status: domain.STATUS.OUVERTE,
        etude: null,
        createdAt: todayISO,
      };
      await repo.put(bid);
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
      return json(200, { received: true });
    }

    return json(404, { errors: [{ code: 'introuvable', message: 'Route inconnue.' }] });
  }

  return { handle, publicBid };
}

module.exports = { createApp };
