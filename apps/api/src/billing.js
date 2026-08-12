'use strict';

/**
 * Billing use-cases, wired from two ports: the single-table Repo and a Stripe
 * adapter (see stripe-port.js). Framework- and SDK-free — the tests drive it
 * with the in-memory repo and a plain fake stripe object, no network.
 *
 * Nota bills notaries a FLAT MONTHLY SUBSCRIPTION for marketplace access. This
 * module deliberately holds no notion of a per-transaction charge, a rate, or a
 * platform share of an acte — the Code de déontologie forbids fee-sharing with
 * a non-notaire (ADR 0001, ADR 0005). A guardrail test asserts that absence.
 */

// A pragmatic single-line address check: exactly one @, no spaces, a dot in
// the domain. We only need to reject obvious garbage before handing the address
// to Stripe as the customer email.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Subscription lifecycle as Nota sees it. `pending` is written the moment a
// Checkout Session is opened; the webhooks move it forward.
const SUBSCRIPTION_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  CANCELED: 'canceled',
  PAST_DUE: 'past_due',
};

function createBilling({ repo, stripe, newId, now, successUrl, cancelUrl } = {}) {
  if (!repo) throw new Error('createBilling: repo is required');
  if (!stripe) throw new Error('createBilling: stripe adapter is required');

  const genId = newId || (() => require('crypto').randomUUID());
  const clock = now || (() => new Date().toISOString());
  const okUrl = successUrl || '';
  const koUrl = cancelUrl || '';

  /**
   * Begin a subscription: validate the email, open a Checkout Session, then
   * record a PENDING notary profile keyed by the same id we passed to Stripe as
   * the client reference. Returns `{ ok:true, url }` or `{ ok:false, errors }`.
   */
  async function startSubscription({ email } = {}) {
    const clean = String(email == null ? '' : email).trim().toLowerCase();
    if (!clean || clean.length > 254 || !EMAIL_RE.test(clean)) {
      return {
        ok: false,
        errors: [{ code: 'courriel_invalide', message: 'Un courriel valide est requis.' }],
      };
    }

    const id = genId();
    const { url } = await stripe.createSubscriptionCheckout({
      email: clean,
      successUrl: okUrl,
      cancelUrl: koUrl,
      clientReferenceId: id,
    });

    const at = clock();
    await repo.putNotary({
      id,
      email: clean,
      subscriptionStatus: SUBSCRIPTION_STATUS.PENDING,
      customerId: null,
      subscriptionId: null,
      createdAt: at,
      updatedAt: at,
    });

    return { ok: true, url };
  }

  // Persist a status transition for the notary the event points at. Returns the
  // updated notary (or null when none was found), so the caller can notify it.
  async function transition(id, patch) {
    if (!id) return null;
    const notary = await repo.getNotary(id);
    if (!notary) return null;
    const updated = { ...notary, ...patch, updatedAt: clock() };
    await repo.putNotary(updated);
    return updated;
  }

  // Map one verified event to a repo change. Unknown types are ignored (return
  // handled:false) — never throw on them. Also returns the affected notary so
  // the webhook route can send the matching lifecycle email.
  async function applyEvent(event) {
    const obj = (event && event.data && event.data.object) || {};

    switch (event.type) {
      case 'checkout.session.completed': {
        const notary = await transition(obj.client_reference_id, {
          subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
          customerId: obj.customer || null,
          subscriptionId: obj.subscription || null,
        });
        return { handled: !!notary, notary };
      }

      case 'customer.subscription.deleted': {
        const notaryId = obj.metadata && obj.metadata.notaryId;
        const notary = await transition(notaryId, {
          subscriptionStatus: SUBSCRIPTION_STATUS.CANCELED,
        });
        return { handled: !!notary, notary };
      }

      case 'customer.subscription.updated': {
        const notaryId = obj.metadata && obj.metadata.notaryId;
        let next = null;
        if (obj.status === 'canceled') next = SUBSCRIPTION_STATUS.CANCELED;
        else if (obj.status === 'unpaid' || obj.status === 'past_due') next = SUBSCRIPTION_STATUS.PAST_DUE;
        if (!next) return { handled: false, notary: null };
        const notary = await transition(notaryId, { subscriptionStatus: next });
        return { handled: !!notary, notary };
      }

      default:
        return { handled: false, notary: null };
    }
  }

  /**
   * Verify and process a webhook delivery. Returns `{ ok:false }` on a bad
   * signature (route -> 400). Otherwise `{ ok:true, ... }`. Idempotent: an event
   * id already recorded is ignored, so a redelivery is a no-op.
   */
  async function handleWebhook(rawBody, signature) {
    let event;
    try {
      event = stripe.constructEvent(rawBody, signature);
    } catch (err) {
      return { ok: false, error: 'signature_invalide' };
    }

    if (await repo.wasEventProcessed(event.id)) {
      return { ok: true, handled: false, duplicate: true, type: event.type, event, notary: null };
    }

    const { handled, notary } = await applyEvent(event);
    // Record every verified event (even ignored types) so a redelivery of any
    // kind is skipped.
    await repo.markEventProcessed(event.id, clock());

    // The verified event and the affected notary are returned so the route can
    // fire the matching lifecycle email (welcome/receipt/dunning/win-back)
    // outside this module — billing stays free of any I/O beyond its two ports.
    return { ok: true, handled, duplicate: false, type: event.type, event, notary };
  }

  return { startSubscription, handleWebhook };
}

module.exports = { createBilling, SUBSCRIPTION_STATUS };
