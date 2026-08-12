'use strict';

/**
 * Stripe adapter — a Port implementation that mirrors the shape of
 * repo-dynamo.js.
 *
 * The `stripe` SDK is required LAZILY inside the factory, exactly like
 * repo-dynamo lazy-requires the AWS SDK. The test suite injects a plain fake
 * that implements this same interface, so it never loads the package; only a
 * live request that actually talks to Stripe pulls it in.
 *
 * Card data never touches our servers: Stripe Checkout hosts the payment form
 * (no PCI scope for us). We only ever open a Checkout Session and verify signed
 * webhooks.
 *
 * Billing model: a single recurring FLAT monthly subscription price
 * (`priceId`). One line item, quantity one. There is no per-act, tiered, or
 * usage-metered component — Nota bills notaries for marketplace access, never a
 * share of an acte (see docs/decisions/0005-stripe-flat-subscription.md).
 */
function createStripeAdapter({ secretKey, webhookSecret, priceId } = {}) {
  if (!secretKey) throw new Error('createStripeAdapter: secretKey is required');
  if (!webhookSecret) throw new Error('createStripeAdapter: webhookSecret is required');
  if (!priceId) throw new Error('createStripeAdapter: priceId is required');

  // Lazy import keeps the Stripe SDK out of the dependency graph for tests.
  const Stripe = require('stripe');
  const stripe = new Stripe(secretKey);

  return {
    /**
     * Open a hosted Checkout Session for the flat monthly subscription.
     * `clientReferenceId` is our notary id; we also stamp it onto the
     * subscription metadata so later subscription webhooks can be traced back
     * to the notary without a secondary lookup. An idempotency key derived from
     * the notary id makes a retried subscribe request reuse the same session.
     */
    async createSubscriptionCheckout({ email, successUrl, cancelUrl, clientReferenceId }) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          line_items: [{ price: priceId, quantity: 1 }],
          customer_email: email,
          client_reference_id: clientReferenceId,
          subscription_data: { metadata: { notaryId: clientReferenceId } },
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
        clientReferenceId ? { idempotencyKey: `checkout:${clientReferenceId}` } : undefined
      );
      return { url: session.url };
    },

    /**
     * Verify a webhook payload against the signing secret and return the parsed
     * event. Throws when the signature does not match — the route turns that
     * into a 400.
     */
    constructEvent(rawBody, signatureHeader) {
      return stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
    },
  };
}

module.exports = { createStripeAdapter };
