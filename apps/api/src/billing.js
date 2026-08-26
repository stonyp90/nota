'use strict';

/**
 * Billing use-cases, wired from two ports: the single-table Repo and a Stripe
 * adapter (see stripe-port.js). Framework- and SDK-free — the tests drive it
 * with the in-memory repo and a plain fake stripe object, no network.
 *
 * MODEL (2026-08-14): notaries join and browse for FREE. Nota is a marketplace
 * that takes a COMMISSION — a percentage of a retained act's value — collected
 * only when that act completes, as a Stripe Connect application fee on a
 * destination charge to the notary's connected account. There is no subscription.
 *
 * NOTE: a share of a notarial acte is fee-sharing the Québec Code de déontologie
 * restricts; this model is an explicit owner decision and needs a legal review
 * with the Chambre before launch — see docs/decisions/0008-free-commission-
 * marketplace.md (supersedes ADRs 0001/0005). The commission concept lives ONLY
 * here in the billing layer — the @nota/domain pricing logic stays free of it.
 */

const {
  statsDeltasForComplete,
  statsDeltasForNotaryOnboarding,
  statsDeltasForNotaryActive,
  statsDeltasForGauge,
} = require('./stats');
const { notaryIdForEmail } = require('./notary-auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Marketplace status of a notary under the commission model. ONBOARDING until
// their Stripe Connect account can accept charges; ACTIVE once it can.
const NOTARY_STATUS = {
  ONBOARDING: 'onboarding',
  ACTIVE: 'active',
  RESTRICTED: 'restricted',
};

// Default platform commission on a completed act (share of the acte's value).
// Configurable via NOTA_COMMISSION_RATE so the rate is never baked into logic.
const DEFAULT_COMMISSION_RATE = 0.10;

function createBilling({
  repo, stripe, now,
  onboardingReturnUrl, onboardingRefreshUrl, commissionRate,
} = {}) {
  if (!repo) throw new Error('createBilling: repo is required');
  if (!stripe) throw new Error('createBilling: stripe adapter is required');

  const clock = now || (() => new Date().toISOString());
  const rate = typeof commissionRate === 'number' ? commissionRate : DEFAULT_COMMISSION_RATE;

  // Nota's share of an act, in cents, from the act's dollar value.
  function feeCents(actAmount) {
    return Math.round(Number(actAmount) * 100 * rate);
  }

  // Best-effort analytics rollups (see keys.js STATS#). A rollup failure must
  // never affect a billing outcome; a phase-4 reconcile heals any drift.
  async function recordStats(deltas) {
    if (!deltas || !deltas.length || typeof repo.applyStatsDeltas !== 'function') return;
    try {
      await repo.applyStatsDeltas(deltas);
    } catch {
      /* swallow — billing correctness does not depend on analytics counters */
    }
  }

  /**
   * Begin FREE onboarding: validate the email, create the notary's Stripe
   * Connect account + a hosted onboarding link, and record an ONBOARDING profile
   * keyed by the same id stamped on the Connect account. Returns `{ ok, url }`.
   */
  async function connectNotary({ email, parrain } = {}) {
    const clean = String(email == null ? '' : email).trim().toLowerCase();
    if (!clean || clean.length > 254 || !EMAIL_RE.test(clean)) {
      return { ok: false, errors: [{ code: 'courriel_invalide', message: 'Un courriel valide est requis.' }] };
    }

    // ONE identity per email: the notary record is keyed by the SAME
    // deterministic id `/notary/session` derives (notaryIdForEmail), so the
    // ACTIVE flip from `account.updated` opens the console gate for the notary
    // who onboarded. A random id here would strand the activation on a record
    // the session lookup never reads — signup would never unlock sign-in.
    const id = notaryIdForEmail(clean);
    const existing = await repo.getNotary(id);

    // Re-connect for an email that ALREADY has a Connect account (double
    // submit, lost tab, or an active notary re-opening their dashboard link):
    // reuse the account and hand back a fresh onboarding link. Never resets
    // status/chargesEnabled or the commission accumulator, and never creates a
    // second Stripe account for the same notary.
    if (existing && existing.connectAccountId) {
      const { url } = await stripe.createOnboardingLink({
        accountId: existing.connectAccountId, notaryId: id,
        returnUrl: onboardingReturnUrl || '',
        refreshUrl: onboardingRefreshUrl || '',
      });
      await repo.putNotary({
        ...existing,
        // First-touch referral attribution: an already-attributed notary keeps
        // their original partner; an unattributed one may gain a code.
        parrain: existing.parrain || parrain || null,
        updatedAt: clock(),
      });
      return { ok: true, url, existing: true };
    }

    const { accountId } = await stripe.createConnectAccount({ email: clean, notaryId: id });
    const { url } = await stripe.createOnboardingLink({
      accountId, notaryId: id,
      returnUrl: onboardingReturnUrl || '',
      refreshUrl: onboardingRefreshUrl || '',
    });

    const at = clock();
    await repo.putNotary({
      // Preserve any session-upserted profile fields (label, createdAt) while
      // stamping the billing identity on the same record.
      ...(existing || {}),
      id, email: clean,
      status: NOTARY_STATUS.ONBOARDING,
      connectAccountId: accountId,
      chargesEnabled: false,
      commissionCentsCollected: (existing && existing.commissionCentsCollected) || 0,
      // PRIVATE referral attribution (ADR 0011): the already-normalized partner
      // code the route layer validated through the domain (null otherwise). A
      // referred notary earns their partner REFERRAL.notaire once, when they
      // retain their first act — read back only by the admin ledger, never by
      // any notary-facing or public payload.
      parrain: (existing && existing.parrain) || parrain || null,
      createdAt: (existing && existing.createdAt) || at, updatedAt: at,
    });
    await recordStats(statsDeltasForNotaryOnboarding());

    return { ok: true, url };
  }

  /**
   * Collect Nota's commission when a retained act completes: the client's act
   * payment is a destination charge to the notary's connected account, and Nota
   * keeps `application_fee_amount` = rate × value. The notary must have finished
   * onboarding (charges enabled). Returns `{ ok, commissionCents }`.
   */
  async function completeAct({ notaryId, bidId, actAmount } = {}) {
    const notary = notaryId ? await repo.getNotary(notaryId) : null;
    if (!notary) {
      return { ok: false, errors: [{ code: 'notaire_introuvable', message: 'Notaire introuvable.' }] };
    }
    if (notary.status !== NOTARY_STATUS.ACTIVE || !notary.chargesEnabled || !notary.connectAccountId) {
      return { ok: false, errors: [{ code: 'compte_incomplet', message: 'Votre compte n’est pas encore prêt à encaisser les paiements. Terminez votre inscription Stripe.' }] };
    }
    const amount = Number(actAmount);
    if (!(amount > 0)) {
      return { ok: false, errors: [{ code: 'montant_invalide', message: 'Montant de l’acte invalide.' }] };
    }

    // Idempotency: a bid whose act was already completed never charges again.
    // The write-once ledger below (attribute_not_exists on the ACT# item) plus
    // the Stripe idempotency key (act:<bidId>) make a retry safe end to end.
    if (bidId && typeof repo.getActCompletion === 'function') {
      const prior = await repo.getActCompletion(bidId);
      if (prior) {
        return { ok: true, commissionCents: prior.commissionCents, chargeId: prior.chargeId, alreadyCompleted: true };
      }
    }

    const fee = feeCents(amount);
    // A Stripe failure (decline, outage) is a typed, retryable error — never an
    // unhandled throw that turns the route into a 5xx with no payload. Nothing
    // was written yet, so a retry starts clean; the Stripe idempotency key
    // (act:<bidId>) keeps that retry from double-charging.
    let charge;
    try {
      charge = await stripe.chargeActCommission({
        connectAccountId: notary.connectAccountId,
        amountCents: Math.round(amount * 100),
        applicationFeeCents: fee,
        currency: 'cad',
        bidId, notaryId,
      });
    } catch (err) {
      return { ok: false, errors: [{ code: 'paiement_echoue', message: 'Le paiement n’a pas pu être traité. Réessayez ou contactez Nota.' }] };
    }

    // markActCompleted returns true only on the FIRST write (write-once ledger).
    // A concurrent double-submit whose guard read missed the other in-flight
    // charge must NOT also bump the analytics counters, or actes/commission
    // over-count for one act. Default true when the repo lacks the method.
    let firstWrite = true;
    if (bidId && typeof repo.markActCompleted === 'function') {
      firstWrite = await repo.markActCompleted(bidId, {
        bidId, notaryId, actAmount: amount, commissionCents: fee,
        chargeId: charge && charge.id, completedAt: clock(),
      });
    }

    // Only the write-once ledger's FIRST writer bumps the notary's accumulator and
    // the analytics counters — a concurrent duplicate (deduped by Stripe) must not
    // over-count the collected commission.
    if (firstWrite) {
      await repo.putNotary({
        ...notary,
        commissionCentsCollected: (notary.commissionCentsCollected || 0) + fee,
        updatedAt: clock(),
      });
      await recordStats(statsDeltasForComplete({ completedAt: String(clock()).slice(0, 10), commissionCents: fee }));
    }

    return { ok: true, commissionCents: fee, chargeId: charge && charge.id };
  }

  /**
   * PAY-ON-ACCEPT, step 1 — authorize the client's card when they post an offer.
   * Opens a hosted Checkout session that AUTHORIZES (manual capture) the act
   * amount; nothing is captured until a notary accepts. Returns `{ ok, url }`;
   * the client is redirected there and the webhook binds the resulting
   * PaymentIntent back to the bid (see applyEvent: checkout.session.completed).
   */
  async function authorizeOffer({ bidId, bidDate, amountCents, email, description, successUrl, cancelUrl } = {}) {
    const cents = Math.round(Number(amountCents));
    if (!(cents > 0)) {
      return { ok: false, errors: [{ code: 'montant_invalide', message: 'Montant de l’offre invalide.' }] };
    }
    const { sessionId, url } = await stripe.createOfferAuthorization({
      amountCents: cents, currency: 'cad', bidId, bidDate, description,
      customerEmail: email || undefined, successUrl, cancelUrl,
    });
    return { ok: true, url, sessionId };
  }

  /**
   * PAY-ON-ACCEPT, step 2 — when a notary accepts a retained act, CAPTURE the
   * client's authorized payment and TRANSFER the net (value − commission) to the
   * notary immediately. Nota keeps the commission. Requires a bound
   * `paymentIntentId` (the client authorized at post) and a charge-ready notary.
   *
   * Idempotent: writes the SAME write-once act ledger as completeAct, so a later
   * completeAct call for the same bid is a no-op — the act is only ever paid once.
   * Returns `{ ok, commissionCents, netCents, transferId, chargeId }`.
   */
  async function payNotaryOnAccept({ notaryId, bidId, actAmount, paymentIntentId } = {}) {
    const notary = notaryId ? await repo.getNotary(notaryId) : null;
    if (!notary) {
      return { ok: false, errors: [{ code: 'notaire_introuvable', message: 'Notaire introuvable.' }] };
    }
    if (notary.status !== NOTARY_STATUS.ACTIVE || !notary.chargesEnabled || !notary.connectAccountId) {
      return { ok: false, errors: [{ code: 'compte_incomplet', message: 'Votre compte n’est pas encore prêt à encaisser les paiements. Terminez votre inscription Stripe.' }] };
    }
    const amount = Number(actAmount);
    if (!(amount > 0)) {
      return { ok: false, errors: [{ code: 'montant_invalide', message: 'Montant de l’acte invalide.' }] };
    }
    if (!paymentIntentId) {
      return { ok: false, errors: [{ code: 'paiement_absent', message: 'Aucune autorisation de paiement n’est liée à cette offre.' }] };
    }

    // Idempotency guard: a bid already paid (on accept OR completion) never charges again.
    if (bidId && typeof repo.getActCompletion === 'function') {
      const prior = await repo.getActCompletion(bidId);
      if (prior) {
        return { ok: true, commissionCents: prior.commissionCents, netCents: prior.netCents, transferId: prior.transferId, chargeId: prior.chargeId, alreadyPaid: true };
      }
    }

    const fee = feeCents(amount);
    // A capture decline AFTER a notary accepted must never dead-end the accept
    // as an unhandled 5xx: the retain already happened, and the notary must
    // still receive the dossier. Surface a typed error the route folds into
    // `{ paid:false, paymentError }`; a re-accept retries the capture (Stripe
    // idempotency key capture:<bidId>), and settlement can also fall back to
    // /notary/acts/complete.
    let result;
    try {
      result = await stripe.captureAndTransfer({
        paymentIntentId,
        connectAccountId: notary.connectAccountId,
        amountCents: Math.round(amount * 100),
        applicationFeeCents: fee,
        currency: 'cad',
        bidId, notaryId,
      });
    } catch (err) {
      return { ok: false, errors: [{ code: 'paiement_echoue', message: 'Le paiement du client n’a pas pu être capturé. L’acte vous reste confié; Nota fera le suivi du paiement.' }] };
    }

    let firstWrite = true;
    if (bidId && typeof repo.markActCompleted === 'function') {
      firstWrite = await repo.markActCompleted(bidId, {
        bidId, notaryId, actAmount: amount, commissionCents: fee,
        netCents: result.netCents, transferId: result.transferId, chargeId: result.chargeId,
        paidOnAccept: true, completedAt: clock(),
      });
    }
    // Guard the accumulator + stats with the ledger's first-write, so a concurrent
    // double-accept (charge deduped by Stripe) can't over-count the commission.
    if (firstWrite) {
      await repo.putNotary({
        ...notary,
        commissionCentsCollected: (notary.commissionCentsCollected || 0) + fee,
        updatedAt: clock(),
      });
      await recordStats(statsDeltasForComplete({ completedAt: String(clock()).slice(0, 10), commissionCents: fee }));
    }

    return { ok: true, commissionCents: fee, netCents: result.netCents, transferId: result.transferId, chargeId: result.chargeId };
  }

  /**
   * Release a card hold that will never be captured — e.g. the ORIGINAL
   * authorization after a client accepts a notary's proposition at a NEW
   * amount (the hold was taken for the old one, so it cannot settle it).
   * Without this the client's card stays blocked for up to ~7 days until
   * Stripe expires the hold on its own. Best-effort and idempotent (Stripe
   * cancel of an already-canceled intent is caught): the caller fires and
   * forgets. Returns `{ ok }`.
   */
  async function cancelAuthorization({ paymentIntentId, bidId } = {}) {
    if (!paymentIntentId || typeof stripe.cancelOfferAuthorization !== 'function') {
      return { ok: false };
    }
    try {
      await stripe.cancelOfferAuthorization({ paymentIntentId, bidId });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // Persist a status transition for the notary the event points at.
  async function transition(id, patch) {
    if (!id) return null;
    const notary = await repo.getNotary(id);
    if (!notary) return null;
    const updated = { ...notary, ...patch, updatedAt: clock() };
    await repo.putNotary(updated);
    return updated;
  }

  // Map one verified event to a repo change. Unknown types are ignored (never
  // throw). Returns the affected notary so the webhook route can notify it.
  async function applyEvent(event) {
    const obj = (event && event.data && event.data.object) || {};

    switch (event.type) {
      // Connect onboarding progressed: flip ACTIVE once the account can charge.
      case 'account.updated': {
        const notaryId = obj.metadata && obj.metadata.notaryId;
        const enabled = !!obj.charges_enabled;
        const prior = notaryId ? await repo.getNotary(notaryId) : null;
        const wasActive = !!(prior && prior.status === NOTARY_STATUS.ACTIVE);
        const notary = await transition(notaryId, {
          chargesEnabled: enabled,
          status: enabled ? NOTARY_STATUS.ACTIVE : NOTARY_STATUS.ONBOARDING,
        });
        // Move the gauge only on an ACTUAL active<->onboarding transition, so a
        // charges_enabled toggle can never double-count (true->false->true) and
        // a revert-to-onboarding decrements the active bucket.
        if (notary) {
          if (enabled && !wasActive) await recordStats(statsDeltasForNotaryActive());
          else if (!enabled && wasActive) await recordStats(statsDeltasForGauge({ active: -1, onboarding: 1 }));
        }
        return { handled: !!notary, notary };
      }

      // Notary disconnected their account from the platform.
      case 'account.application.deauthorized': {
        const notaryId = obj.metadata && obj.metadata.notaryId;
        const prior = notaryId ? await repo.getNotary(notaryId) : null;
        const notary = await transition(notaryId, {
          status: NOTARY_STATUS.RESTRICTED, chargesEnabled: false,
        });
        // Decrement whichever bucket they were counted in (no monotonic leak).
        if (notary && prior) {
          if (prior.status === NOTARY_STATUS.ACTIVE) await recordStats(statsDeltasForGauge({ active: -1 }));
          else if (prior.status === NOTARY_STATUS.ONBOARDING) await recordStats(statsDeltasForGauge({ onboarding: -1 }));
        }
        return { handled: !!notary, notary };
      }

      // Client finished Checkout — their card is AUTHORIZED. Bind the resulting
      // PaymentIntent to the bid and mark it authorized so it goes live on the
      // carnet and a notary can be paid the instant they accept.
      case 'checkout.session.completed': {
        const md = obj.metadata || {};
        const paymentIntentId = typeof obj.payment_intent === 'string'
          ? obj.payment_intent
          : (obj.payment_intent && obj.payment_intent.id) || null;
        let bid = null;
        if (md.bidId && typeof repo.authorizeBid === 'function') {
          bid = await repo.authorizeBid(md.bidId, md.bidDate, { paymentIntentId, authorizedAt: clock() });
        }
        return { handled: !!bid, notary: null, bid };
      }

      // Authorization lapsed or was cancelled before any notary accepted — void
      // the (never-captured) hold and drop the offer from the carnet.
      case 'checkout.session.expired':
      case 'payment_intent.canceled': {
        const md = obj.metadata || {};
        let bid = null;
        if (md.bidId && typeof repo.voidBidAuthorization === 'function') {
          bid = await repo.voidBidAuthorization(md.bidId, md.bidDate, { voidedAt: clock() });
        }
        return { handled: !!bid, notary: null, bid };
      }

      default:
        return { handled: false, notary: null };
    }
  }

  /**
   * Verify and process a webhook delivery. `{ ok:false }` on a bad signature
   * (route -> 400). Idempotent: an event id already recorded is a no-op.
   */
  async function handleWebhook(rawBody, signature) {
    let event;
    try {
      event = stripe.constructEvent(rawBody, signature);
    } catch (err) {
      return { ok: false, error: 'signature_invalide' };
    }

    if (await repo.wasEventProcessed(event.id)) {
      return { ok: true, handled: false, duplicate: true, type: event.type, event, notary: null, bid: null };
    }

    const { handled, notary, bid } = await applyEvent(event);
    await repo.markEventProcessed(event.id, clock());
    return { ok: true, handled, duplicate: false, type: event.type, event, notary, bid: bid || null };
  }

  return { connectNotary, authorizeOffer, payNotaryOnAccept, completeAct, cancelAuthorization, handleWebhook, commissionRate: rate };
}

module.exports = { createBilling, NOTARY_STATUS, DEFAULT_COMMISSION_RATE };
