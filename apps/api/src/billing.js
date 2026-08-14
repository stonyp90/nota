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
 * with the Chambre before launch. The commission concept lives ONLY here in the
 * billing layer — the @nota/domain pricing logic stays free of it.
 */

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
  repo, stripe, newId, now,
  onboardingReturnUrl, onboardingRefreshUrl, commissionRate,
} = {}) {
  if (!repo) throw new Error('createBilling: repo is required');
  if (!stripe) throw new Error('createBilling: stripe adapter is required');

  const genId = newId || (() => require('crypto').randomUUID());
  const clock = now || (() => new Date().toISOString());
  const rate = typeof commissionRate === 'number' ? commissionRate : DEFAULT_COMMISSION_RATE;

  // Nota's share of an act, in cents, from the act's dollar value.
  function feeCents(actAmount) {
    return Math.round(Number(actAmount) * 100 * rate);
  }

  /**
   * Begin FREE onboarding: validate the email, create the notary's Stripe
   * Connect account + a hosted onboarding link, and record an ONBOARDING profile
   * keyed by the same id stamped on the Connect account. Returns `{ ok, url }`.
   */
  async function connectNotary({ email } = {}) {
    const clean = String(email == null ? '' : email).trim().toLowerCase();
    if (!clean || clean.length > 254 || !EMAIL_RE.test(clean)) {
      return { ok: false, errors: [{ code: 'courriel_invalide', message: 'Un courriel valide est requis.' }] };
    }

    const id = genId();
    const { accountId } = await stripe.createConnectAccount({ email: clean, notaryId: id });
    const { url } = await stripe.createOnboardingLink({
      accountId, notaryId: id,
      returnUrl: onboardingReturnUrl || '',
      refreshUrl: onboardingRefreshUrl || '',
    });

    const at = clock();
    await repo.putNotary({
      id, email: clean,
      status: NOTARY_STATUS.ONBOARDING,
      connectAccountId: accountId,
      chargesEnabled: false,
      commissionCentsCollected: 0,
      createdAt: at, updatedAt: at,
    });

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
      return { ok: false, errors: [{ code: 'compte_incomplet', message: 'Le compte du notaire n’est pas prêt à encaisser.' }] };
    }
    const amount = Number(actAmount);
    if (!(amount > 0)) {
      return { ok: false, errors: [{ code: 'montant_invalide', message: 'Montant de l’acte invalide.' }] };
    }

    const fee = feeCents(amount);
    const charge = await stripe.chargeActCommission({
      connectAccountId: notary.connectAccountId,
      amountCents: Math.round(amount * 100),
      applicationFeeCents: fee,
      currency: 'cad',
      bidId, notaryId,
    });

    await repo.putNotary({
      ...notary,
      commissionCentsCollected: (notary.commissionCentsCollected || 0) + fee,
      updatedAt: clock(),
    });

    return { ok: true, commissionCents: fee, chargeId: charge && charge.id };
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
        const notary = await transition(notaryId, {
          chargesEnabled: enabled,
          status: enabled ? NOTARY_STATUS.ACTIVE : NOTARY_STATUS.ONBOARDING,
        });
        return { handled: !!notary, notary };
      }

      // Notary disconnected their account from the platform.
      case 'account.application.deauthorized': {
        const notaryId = obj.metadata && obj.metadata.notaryId;
        const notary = await transition(notaryId, {
          status: NOTARY_STATUS.RESTRICTED, chargesEnabled: false,
        });
        return { handled: !!notary, notary };
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
      return { ok: true, handled: false, duplicate: true, type: event.type, event, notary: null };
    }

    const { handled, notary } = await applyEvent(event);
    await repo.markEventProcessed(event.id, clock());
    return { ok: true, handled, duplicate: false, type: event.type, event, notary };
  }

  return { connectNotary, completeAct, handleWebhook, commissionRate: rate };
}

module.exports = { createBilling, NOTARY_STATUS, DEFAULT_COMMISSION_RATE };
