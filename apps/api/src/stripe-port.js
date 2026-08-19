'use strict';

// fr-CA is the product language, so every Stripe-hosted surface (Checkout,
// Express onboarding, the payout dashboard) is pinned to it. Overridable for a
// future market rather than baked in.
const STRIPE_LOCALE = process.env.NOTA_STRIPE_LOCALE || 'fr-CA';

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
        // Without this, Stripe-hosted onboarding and the payout dashboard render
        // in English for a product that is fr-CA everywhere else.
        preferred_locales: [STRIPE_LOCALE, 'fr'],
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
     * PAY-ON-ACCEPT, step 1 — authorize the client's card for a posted offer.
     * A hosted Checkout Session in `payment` mode with a MANUAL-CAPTURE payment
     * intent: the client's card is authorized (funds held) but nothing is
     * captured until a notary accepts. Card data never touches our servers. The
     * bid id rides on the session + intent metadata so the webhook can bind the
     * resulting PaymentIntent back to the bid. Idempotent per bid.
     */
    async createOfferAuthorization({ amountCents, currency, bidId, bidDate, description, customerEmail, successUrl, cancelUrl }) {
      const meta = { bidId: bidId || '', bidDate: bidDate || '' };
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          // Stripe defaults to 'auto' (the BROWSER's language), which drops an
          // English payment page into the middle of an all-French flow.
          locale: STRIPE_LOCALE,
          payment_intent_data: {
            capture_method: 'manual',
            description: description || 'Acte notarié — Nota',
            metadata: meta,
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: currency || 'cad',
                unit_amount: amountCents,
                product_data: { name: description || 'Acte notarié' },
              },
            },
          ],
          customer_email: customerEmail || undefined,
          metadata: meta,
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
        bidId ? { idempotencyKey: `auth:${bidId}` } : undefined
      );
      return { sessionId: session.id, url: session.url };
    },

    /**
     * PAY-ON-ACCEPT, step 2 — when a notary accepts, CAPTURE the authorized
     * payment (funds move to the platform) and TRANSFER the net (act value minus
     * Nota's commission) to the notary's connected account. This is the Stripe
     * "separate charges and transfers" model: the destination notary is unknown
     * at authorization time, so we capture on the platform then transfer.
     * Idempotent per bid end-to-end via the capture/transfer idempotency keys.
     */
    async captureAndTransfer({ paymentIntentId, connectAccountId, amountCents, applicationFeeCents, currency, bidId }) {
      const captured = await stripe.paymentIntents.capture(
        paymentIntentId,
        {},
        bidId ? { idempotencyKey: `capture:${bidId}` } : undefined
      );
      const chargeId = captured && (typeof captured.latest_charge === 'string' ? captured.latest_charge : captured.latest_charge && captured.latest_charge.id);
      const netCents = amountCents - applicationFeeCents;
      const transfer = await stripe.transfers.create(
        {
          amount: netCents,
          currency: currency || 'cad',
          destination: connectAccountId,
          source_transaction: chargeId || undefined,
          transfer_group: bidId ? `bid:${bidId}` : undefined,
          metadata: { bidId: bidId || '' },
        },
        bidId ? { idempotencyKey: `transfer:${bidId}` } : undefined
      );
      return { paymentIntentId, chargeId: chargeId || null, transferId: transfer.id, applicationFeeCents, netCents };
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
