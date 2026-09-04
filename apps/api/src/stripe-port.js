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
 *   1. At publication, the client's card is REGISTERED by a Checkout session on
 *      NOTA'S OWN account — no connected account, no `on_behalf_of`, no
 *      `transfer_data`. The client pays the platform. `createOfferSetup` saves
 *      the card without holding a cent; `createOfferAuthorization` holds it
 *      right away when the signing is already inside the caution window.
 *   2. At J-CAUTION_LEAD_DAYS, `placeOfferAuthorization` posts the hold off
 *      session on that saved card — late enough that its ~7-day life reaches
 *      the signing (ADR 0035).
 *   3. At signing, `captureAndTransfer` captures on the platform, keeps Nota's
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

  // A PaymentIntent's charge, expanded or not — the id every transfer sources.
  const latestChargeId = (intent) =>
    (intent &&
      (typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge && intent.latest_charge.id)) ||
    null;

  /**
   * ADR 0033 — hand a cancellation fee to the notary WHOLE: no application fee,
   * nothing kept on the platform. Shared by the two ways a fee can be collected
   * (partial capture of a live caution, or an off-session charge on the
   * registered card) so both obey the same rule and the same idempotency key.
   *
   * A failure here means the money IS on the platform: it rethrows with
   * `captured: true` and the charge id, so the caller records the debt and
   * never re-collects.
   */
  async function transferFeeWhole({ amountCents, bidId, connectAccountId, chargeId, paymentIntentId }) {
    try {
      return await stripe.transfers.create(
        {
          amount: amountCents,
          currency: 'cad',
          destination: connectAccountId,
          source_transaction: chargeId || undefined,
          transfer_group: bidId ? `bid:${bidId}` : undefined,
          metadata: { bidId: bidId || '', motif: 'annulation' },
        },
        bidId ? { idempotencyKey: `cancelfee-transfer:${bidId}` } : undefined
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      e.captured = true;
      e.chargeId = chargeId || null;
      e.paymentIntentId = paymentIntentId || null;
      throw e;
    }
  }

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
    async createOfferAuthorization({ amountCents, currency, bidId, bidDate, description, customerEmail, successUrl, cancelUrl, cle }) {
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
        bidId ? { idempotencyKey: `auth:${bidId}${cle ? ':' + cle : ''}` } : undefined
      );
      return { sessionId: session.id, url: session.url };
    },

    /**
     * ADR 0035, step 0 — REGISTER the client's card without holding a cent.
     * A hosted Checkout Session in `setup` mode: Stripe validates the card with
     * the issuer, saves it on a Customer, and hands back a SetupIntent. Nothing
     * is reserved, so nothing can rot: the reservation itself is placed later,
     * at J-CAUTION_LEAD_DAYS, by `placeOfferAuthorization` below.
     *
     * `amountCents` is NOT charged here — it rides on the session metadata and
     * the SetupIntent description so the client reads, on Stripe's own page,
     * the amount their card will carry (art. 68 C.déont. : le prix annoncé est
     * le prix facturé). The bid id rides on both metadata blocks so the
     * `setup_intent.succeeded` webhook binds the saved card back to the bid.
     * Idempotent per bid via setup:<bidId>. `cle` suffixes that key when the
     * client comes back to register ANOTHER card (their first was declined):
     * without it Stripe would replay the session already completed with the bad
     * card, and the recovery would be a dead link.
     */
    async createOfferSetup({ amountCents, currency, bidId, bidDate, description, customerEmail, successUrl, cancelUrl, cle }) {
      const meta = { bidId: bidId || '', bidDate: bidDate || '', amountCents: String(amountCents == null ? '' : amountCents) };
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'setup',
          // Same reason as the payment session: 'auto' would drop an English
          // page into the middle of an all-French flow.
          locale: STRIPE_LOCALE,
          currency: currency || 'cad',
          setup_intent_data: {
            description: description || 'Acte notarié — Nota',
            metadata: meta,
          },
          customer_email: customerEmail || undefined,
          metadata: meta,
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
        bidId ? { idempotencyKey: `setup:${bidId}${cle ? ':' + cle : ''}` } : undefined
      );
      return { sessionId: session.id, url: session.url };
    },

    /**
     * ADR 0035, step 1 — PLACE the caution on a card registered earlier, OFF
     * SESSION (the client is not at their browser). A manual-capture
     * PaymentIntent confirmed on the saved payment method: exactly the hold the
     * old flow posted at publication, only created at a moment when its ~7-day
     * life reaches the signing.
     *
     * `off_session: true` tells the issuer this is a merchant-initiated charge
     * on a mandate the client already gave; a card that needs authentication or
     * has no funds THROWS (`err.code` carries Stripe's decline code), and the
     * caller turns that into a notice to both parties — never an exception that
     * kills the daily run.
     *
     * The idempotency key carries the DAY: two runs on the same day are one
     * attempt, while tomorrow's retry after a decline is a genuinely new one
     * (Stripe replays a key's original response, decline included).
     */
    async placeOfferAuthorization({ customerId, paymentMethodId, amountCents, currency, bidId, bidDate, description, jour }) {
      const intent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: currency || 'cad',
          customer: customerId,
          payment_method: paymentMethodId,
          capture_method: 'manual',
          confirm: true,
          off_session: true,
          description: description || 'Acte notarié — Nota',
          metadata: { bidId: bidId || '', bidDate: bidDate || '' },
        },
        bidId ? { idempotencyKey: `hold:${bidId}:${jour || ''}` } : undefined
      );
      return { paymentIntentId: intent.id, status: intent.status };
    },

    /**
     * ADR 0023 + 0033 + 0035 — the cancellation fee when there is NO live
     * caution to capture from: the signing was still far enough away that the
     * hold had not been placed yet, but the client's card is registered. The
     * fee is charged off session on that card, then TRANSFERRED WHOLE to the
     * notary exactly like the partial-capture path (Nota keeps nothing of it:
     * art. 32.1 2° L.N., art. 32 C.déont.).
     *
     * Without this door the 4-14 day band of the barème would silently become
     * free, which is the kind of hole an ADR is supposed to close, not open.
     * Idempotent per bid via cancelfee:<bidId> — the SAME key as the partial
     * capture, because a bid is charged its fee once by one mechanism or the
     * other, never by both.
     */
    async chargeCancellationFeeOffSession({ customerId, paymentMethodId, amountCents, bidId, connectAccountId }) {
      const intent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'cad',
          customer: customerId,
          payment_method: paymentMethodId,
          confirm: true,
          off_session: true,
          description: 'Frais d’annulation — Nota',
          transfer_group: bidId ? `bid:${bidId}` : undefined,
          metadata: { bidId: bidId || '', motif: 'annulation' },
        },
        bidId ? { idempotencyKey: `cancelfee:${bidId}` } : undefined
      );
      const chargeId = latestChargeId(intent);
      if (!connectAccountId) return { paymentIntentId: intent.id, chargeId, transferId: null };
      const transfer = await transferFeeWhole({ amountCents, bidId, connectAccountId, chargeId, paymentIntentId: intent.id });
      return { paymentIntentId: intent.id, chargeId, transferId: transfer.id };
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
     * payment, no new consent — the hold was posted for more than this.
     * Idempotent per bid via cancelfee:<bidId>.
     *
     * ADR 0033 — the fee COMPENSATES THE NOTARY whose day was reserved. When
     * `connectAccountId` names their connected account, the captured amount
     * is TRANSFERRED to them WHOLE — no application fee, no slice on the
     * platform: art. 32.1 2° L.N. and art. 32 C.déont. forbid Nota any part
     * of what is the notary's. Idempotent via cancelfee-transfer:<bidId>.
     * Without an account the money waits on the platform and the caller
     * records it as owed (billing.js).
     *
     * A transfer that fails AFTER a successful capture rethrows with
     * `captured: true` and the `chargeId` attached: the money is on the
     * platform, the caller must record the debt, and the capture must never
     * be retried (the idempotency key would make a retry a no-op anyway).
     */
    async captureCancellationFee({ paymentIntentId, amountCents, bidId, connectAccountId }) {
      const captured = await stripe.paymentIntents.capture(
        paymentIntentId,
        { amount_to_capture: amountCents },
        bidId ? { idempotencyKey: `cancelfee:${bidId}` } : undefined
      );
      const chargeId = latestChargeId(captured);
      if (!connectAccountId) return { paymentIntentId, chargeId, transferId: null };
      const transfer = await transferFeeWhole({ amountCents, bidId, connectAccountId, chargeId, paymentIntentId });
      return { paymentIntentId, chargeId, transferId: transfer.id };
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
