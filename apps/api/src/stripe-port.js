'use strict';

/**
 * Stripe adapter — a Port implementation that mirrors the shape of
 * repo-dynamo.js. The `stripe` SDK is required LAZILY inside the factory, so the
 * test suite (which injects a plain fake implementing this same interface) never
 * loads the package; only a live request pulls it in.
 *
 * Card data never touches our servers: Stripe hosts onboarding and payment.
 *
 * MODEL: Nota is a Connect PLATFORM. Notaries onboard a connected (Express)
 * account for free; when a retained act completes, the client's payment is a
 * destination charge to that account and Nota keeps an `application_fee_amount`
 * (its commission). No subscription. See billing.js for the compliance note.
 */
function createStripeAdapter({ secretKey, webhookSecret } = {}) {
  if (!secretKey) throw new Error('createStripeAdapter: secretKey is required');
  if (!webhookSecret) throw new Error('createStripeAdapter: webhookSecret is required');

  // Lazy import keeps the Stripe SDK out of the dependency graph for tests.
  const Stripe = require('stripe');
  const stripe = new Stripe(secretKey);

  return {
    /**
     * Create the notary's connected (Express) account. `notaryId` is stamped on
     * the account metadata so later `account.updated` webhooks trace back to the
     * notary without a secondary lookup.
     */
    async createConnectAccount({ email, notaryId }) {
      const account = await stripe.accounts.create({
        type: 'express',
        email,
        country: 'CA',
        default_currency: 'cad',
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
        business_type: 'individual',
        metadata: { notaryId },
      });
      return { accountId: account.id };
    },

    /**
     * Open a hosted onboarding link for a connected account. An idempotency key
     * derived from the notary id makes a retried request reuse the same link.
     */
    async createOnboardingLink({ accountId, notaryId, returnUrl, refreshUrl }) {
      const link = await stripe.accountLinks.create(
        {
          account: accountId,
          type: 'account_onboarding',
          return_url: returnUrl,
          refresh_url: refreshUrl,
        },
        notaryId ? { idempotencyKey: `onboard:${notaryId}` } : undefined
      );
      return { url: link.url };
    },

    /**
     * Charge a completed act as a destination charge to the notary's connected
     * account, keeping `application_fee_amount` (Nota's commission). Idempotent
     * per bid so a retried completion never double-charges.
     */
    async chargeActCommission({ connectAccountId, amountCents, applicationFeeCents, currency, bidId }) {
      const intent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: currency || 'cad',
          application_fee_amount: applicationFeeCents,
          transfer_data: { destination: connectAccountId },
          metadata: { bidId: bidId || '' },
        },
        bidId ? { idempotencyKey: `act:${bidId}` } : undefined
      );
      return { id: intent.id, applicationFeeCents };
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
