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
 * account for free. The client's money moves in the « separate charges and
 * transfers » shape, and the DIRECTION matters more than the mechanics:
 *
 *   1. At publication, the client's card is authorized by a Checkout session on
 *      NOTA'S OWN account — no connected account, no `on_behalf_of`, no
 *      `transfer_data`. The client pays the platform.
 *   2. At signing, `captureAndTransfer` captures on the platform, keeps Nota's
 *      share and TRANSFERS THE NET to the notary's connected account.
 *
 * Nota's share therefore never transits the notary's account. (Until 2026-09-01
 * a fallback did the opposite — a destination charge with an
 * `application_fee_amount` — but it created a PaymentIntent with no payment
 * method and no `confirm`, so it moved nothing at all; ADR 0029 removed it.)
 * No subscription. See billing.js and docs/legal/ for the deontology note: the
 * open question is the legal QUALIFICATION of Nota's share, not the direction
 * the money travels.
 */
function createStripeAdapter({ secretKey, webhookSecret, stripe: injected } = {}) {
  if (!secretKey) throw new Error('createStripeAdapter: secretKey is required');
  if (!webhookSecret) throw new Error('createStripeAdapter: webhookSecret is required');

  // Lazy import keeps the Stripe SDK out of the dependency graph for tests.
  // `stripe` may be injected instead — the port's own seam, so the ARGUMENTS
  // this adapter sends to Stripe can be asserted without a network or a key.
  // Everything above this line is the contract; everything below is plumbing.
  const stripe = injected || new (require('stripe'))(secretKey);

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

    // NOTE (ADR 0029) — `chargeActCommission` a été retiré le 2026-09-01.
    // C'était une charge de destination sur le compte connecté du notaire, avec
    // Nota en frais d'application : elle créait un PaymentIntent sans moyen de
    // paiement ni `confirm`, donc ne déplaçait jamais un dollar, tout en
    // faisant croire au contraire à l'appelant. Le seul chemin de règlement est
    // désormais `captureAndTransfer` ci-dessous : le client paie la PLATEFORME,
    // Nota garde sa part et vire le net au notaire. Ne pas la ressusciter sans
    // relire l'ADR 0029 et l'avis déontologique.

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
      // PARTIAL capture — `amount_to_capture`, never the whole hold. The hold
      // was posted on the offer; the settlement is priced on the act's declared
      // value, which the notary may set lower (domain.validateActValue allows
      // 0,25×). Capturing the full hold while transferring the lower net would
      // leave the difference on the platform — and that difference is a slice
      // of the notary's fees: art. 32.1 2° L.N. (« obtient d'un notaire qu'il
      // abandonne une partie de ses honoraires ») and art. 32 C.déont. Stripe
      // releases the remainder of the authorization on its own.
      // What Nota keeps is its price, and only ever its price.
      const captured = await stripe.paymentIntents.capture(
        paymentIntentId,
        { amount_to_capture: amountCents },
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
     * ADR 0023 — keep a cancellation fee out of the client's card hold by
     * PARTIAL capture: `amount_to_capture` takes the fee onto the platform and
     * Stripe releases the remainder of the authorization immediately. No new
     * payment, no new consent — the hold was posted for more than this. The
     * funds stay on the platform (no transfer: compensating the notary is a
     * separate product decision). Idempotent per bid via cancelfee:<bidId>.
     */
    async captureCancellationFee({ paymentIntentId, amountCents, bidId }) {
      const captured = await stripe.paymentIntents.capture(
        paymentIntentId,
        { amount_to_capture: amountCents },
        bidId ? { idempotencyKey: `cancelfee:${bidId}` } : undefined
      );
      const chargeId = captured && (typeof captured.latest_charge === 'string' ? captured.latest_charge : captured.latest_charge && captured.latest_charge.id);
      return { paymentIntentId, chargeId: chargeId || null };
    },

    /**
     * Cancel an uncaptured authorization, releasing the client's card hold
     * immediately instead of letting it expire on its own (~7 days). Used when
     * a proposition accept retains the bid at a NEW amount the old hold cannot
     * settle. Idempotent per bid via the cancel:<bidId> key.
     */
    async cancelOfferAuthorization({ paymentIntentId, bidId }) {
      const intent = await stripe.paymentIntents.cancel(
        paymentIntentId,
        { cancellation_reason: 'abandoned' },
        bidId ? { idempotencyKey: `cancel:${bidId}` } : undefined
      );
      return { id: intent.id, status: intent.status };
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
