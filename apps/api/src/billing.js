'use strict';

/**
 * Billing use-cases, wired from two ports: the single-table Repo and a Stripe
 * adapter (see stripe-port.js). Framework- and SDK-free — the tests drive it
 * with the in-memory repo and a plain fake stripe object, no network.
 *
 * MODÈLE (ADR 0031, 2026-09-01) : le notaire s'inscrit et consulte gratuitement.
 * Nota ne prélève AUCUNE part des honoraires — elle vend son propre service à
 * son propre prix, un montant fixe encaissé comme frais d'application Stripe
 * sur la capture. Le net viré au notaire est exactement le montant qui lui a
 * été offert.
 *
 * Jusqu'à cette date, la part de Nota était un pourcentage que la cote du
 * notaire faisait varier. Quatre textes condamnaient cette forme — art. 32.1 2°
 * et 3° de la Loi sur le notariat, art. 32, 29.1 et 33 du Code de déontologie —
 * et l'art. 29.1 la condamnait deux fois : un revenu du notaire indexé sur une
 * note attribuée par une entreprise privée est une convention qui met en péril
 * son indépendance et son désintéressement. Le prix de Nota ne dépend donc ni
 * du notaire, ni de sa cote, ni de la valeur de l'acte : prix-nota-config.js
 * est la seule autorité sur ce montant.
 */

const {
  statsDeltasForComplete,
  statsDeltasForNotaryOnboarding,
  statsDeltasForNotaryActive,
  statsDeltasForGauge,
} = require('./stats');
const { notaryIdForEmail } = require('./notary-auth');
const domain = require('@nota/domain');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Marketplace status of a notary. ONBOARDING until their Stripe Connect
// account can accept charges; ACTIVE once it can.
const NOTARY_STATUS = {
  ONBOARDING: 'onboarding',
  ACTIVE: 'active',
  RESTRICTED: 'restricted',
};

// ADR 0031 — le prix de Nota, montant fixe, indépendant du notaire et de l'acte.
// C'est la SEULE configuration que la tarification lise.
const prixConfig = require('./prix-nota-config');

// Le taux historique du prélèvement. Il ne tarife plus rien depuis l'ADR 0031 ;
// il ne survit ici que parce que analytics.js le lit encore pour un indicateur
// rétrospectif de la console admin — jamais pour décider d'un dollar.

// One more completed act on one service (ADR 0028's « services rendus » axis).
// An act settled without a service id — a legacy ledger row — leaves the map
// untouched rather than inventing a bucket.
function actsPlusOne(map, serviceId) {
  const current = map && typeof map === 'object' ? { ...map } : {};
  if (!serviceId) return current;
  current[serviceId] = (Number(current[serviceId]) || 0) + 1;
  return current;
}

function createBilling({
  repo, stripe, now, timeZone,
  onboardingReturnUrl, onboardingRefreshUrl,
} = {}) {
  if (!repo) throw new Error('createBilling: repo is required');
  if (!stripe) throw new Error('createBilling: stripe adapter is required');

  const clock = now || (() => new Date().toISOString());
  // The STATS# day an act's fee lands on is the Québec civil day of the
  // completion instant — a UTC slice booked evening completions on tomorrow.
  const statsDay = () => domain.businessDay(clock(), timeZone || process.env.NOTA_TIMEZONE);

  /**
   * ADR 0031 — le devis d'une offre, AVANT tout engagement : deux lignes que
   * le client voit séparément.
   *
   *   honorairesCents — le montant offert, qui va au notaire EN ENTIER
   *   prixNotaCents   — le prix du service de Nota, fixe
   *   totalCents      — ce que la carte du client doit autoriser
   *
   * Aucun des trois ne dépend du notaire : art. 29.1 du Code de déontologie
   * interdit au notaire toute convention mettant en péril son désintéressement,
   * et un prix qui bougerait selon sa cote en serait une.
   */
  async function quoteOffer(actAmount) {
    const honorairesCents = Math.round(Number(actAmount) * 100);
    const prixNotaCents = await resolvePrixNota();
    return { honorairesCents, prixNotaCents, totalCents: honorairesCents + prixNotaCents };
  }

  // Le prix en vigueur : le prix stocké par l'admin, sinon celui du déploiement.
  async function resolvePrixNota() {
    if (typeof repo.getPrixNotaConfig === 'function') {
      try {
        const stored = await repo.getPrixNotaConfig();
        const v = stored && prixConfig.validatePrix(stored);
        if (v && v.ok) return v.prixCents;
      } catch { /* un prix stocké illisible ne fait jamais tomber la tarification */ }
    }
    return prixConfig.envDefaults(process.env).prixCents;
  }

  // Le devis d'un acte. Le paramètre `notary` n'est PAS lu, et c'est le fond
  // du sujet : il ne subsiste que pour les appelants historiques.
  async function priceAct(actAmount) {
    return quoteOffer(actAmount);
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
    // deterministic id the console sign-in derives (notaryIdForEmail), so the
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
   * Settle a retained act when NO live hold can be captured — the fallback path
   * of ADR 0015: the client paid the notary DIRECTLY at signing, outside Nota.
   *
   * There is nothing for Nota to capture here: no customer, no payment method,
   * no authorization. The honest outcome is therefore a RECEIVABLE, not a
   * payment — Nota's service fee is recorded as owed by the notary, the act
   * ledger says `paye: false`, and the collected accumulator does NOT move.
   *
   * (Before 2026-09-01 this path called `stripe.chargeActCommission`, which
   * created a PaymentIntent with no payment method and no `confirm`: it moved
   * no money, yet the ledger, the accumulator and the « acte payé » email all
   * claimed it had. A ledger that asserts a payment nobody made is worse than
   * an unpaid invoice — see docs/compliance/piste-audit-transactions.md.)
   *
   * Returns `{ ok, actAmount, commissionCents, paye: false, du }`.
   */
  async function completeAct({ notaryId, bidId, actAmount, serviceId } = {}) {
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
        return {
          ok: true, actAmount: prior.actAmount, commissionCents: prior.commissionCents,
          chargeId: prior.chargeId || null,
          paye: prior.netCents != null || !!prior.transferId,
          alreadyCompleted: true,
        };
      }
    }

    const prix = await priceAct(amount);
    // Les frais d'application SONT le prix de Nota — jamais une part des
    // honoraires. Le total capturé porte les deux lignes, et le net viré au
    // notaire est exactement le montant qui lui a été offert (art. 32.1 2°).
    const fee = prix.prixNotaCents;
    // No Stripe call: there is nothing here to charge. The act is recorded, the
    // fee is recorded as OWED, and collecting it is a separate, deliberate act
    // of Nota's — never something a settlement silently claims to have done.

    // markActCompleted returns true only on the FIRST write (write-once ledger).
    // A concurrent double-submit whose guard read missed the other in-flight
    // charge must NOT also bump the analytics counters, or actes/commission
    // over-count for one act. Default true when the repo lacks the method.
    let firstWrite = true;
    if (bidId && typeof repo.markActCompleted === 'function') {
      firstWrite = await repo.markActCompleted(bidId, {
        // `commissionCents` est le NOM hérité du prix de Nota, pas une part
        // des honoraires (conséquence n° 3 de l'ADR 0031). Un registre
        // write-once ne se réécrit pas : le mot reste, le montant est le prix.
        bidId, notaryId, actAmount: amount, commissionCents: fee,
        // ADR 0031 — la divulgation voyage DANS le registre write-once : les
        // deux lignes, figées avec l'argent. Un changement de prix ultérieur ne
        // peut jamais réécrire ce qu'un acte a coûté.
        prixNotaCents: prix.prixNotaCents, honorairesCents: prix.honorairesCents,
        serviceId: serviceId || null,
        // Settled, but not paid through Nota: the fee is a receivable.
        paye: false, commissionCentsDue: fee,
        completedAt: clock(),
      });
    }

    // Only the write-once ledger's FIRST writer bumps the notary's accumulator and
    // the analytics counters — a concurrent duplicate (deduped by Stripe) must not
    // over-count the collected commission.
    if (firstWrite) {
      await repo.putNotary({
        ...notary,
        // OWED, not collected. The two accumulators must never be confused:
        // `commissionCentsCollected` is money Nota actually has.
        commissionCentsDue: (notary.commissionCentsDue || 0) + fee,
        // ADR 0024's notoriety axis, ADR 0028's « services rendus ». Bumped
        // under the same write-once guard as the money, so a replay can never
        // inflate a notary's standing — and counted BY SERVICE, because the
        // cote rewards the breadth of the catalogue a notary actually serves.
        actsCompleted: (Number(notary.actsCompleted) || 0) + 1,
        actsByService: actsPlusOne(notary.actsByService, serviceId),
        updatedAt: clock(),
      });
      await recordStats(statsDeltasForComplete({ completedAt: statsDay(), commissionCents: fee }));
    }

    return {
      ok: true, actAmount: amount,
      prixNotaCents: prix.prixNotaCents, honorairesCents: prix.honorairesCents,
      commissionCents: fee, // alias historique — même montant, nom hérité
      paye: false, du: Math.round(fee) / 100,
    };
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
   * PAID-AT-SIGNING settlement (ADR 0015) — CAPTURE the client's authorized
   * payment (the two lines together) and TRANSFER the notary's OWN fees to
   * them, whole. Nota keeps its own price, never a share of theirs (ADR 0031).
   * Requires a bound `paymentIntentId` (the client
   * authorized at post) and a charge-ready notary. Called from
   * /notary/acts/complete when the act is signed — the historical name dates
   * from the pay-on-accept era; only the call site moved.
   *
   * Idempotent: writes the SAME write-once act ledger as completeAct, so a later
   * completeAct call for the same bid is a no-op — the act is only ever paid once.
   * Returns `{ ok, commissionCents, netCents, transferId, chargeId }`.
   */
  async function payNotaryOnAccept({ notaryId, bidId, actAmount, paymentIntentId, serviceId } = {}) {
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
        return { ok: true, actAmount: prior.actAmount, commissionCents: prior.commissionCents, netCents: prior.netCents, transferId: prior.transferId, chargeId: prior.chargeId, alreadyPaid: true };
      }
    }

    const prix = await priceAct(amount);
    // Les frais d'application SONT le prix de Nota — jamais une part des
    // honoraires. Le total capturé porte les deux lignes, et le net viré au
    // notaire est exactement le montant qui lui a été offert (art. 32.1 2°).
    const fee = prix.prixNotaCents;
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
        amountCents: prix.totalCents,
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
        // `commissionCents` est le NOM hérité du prix de Nota, pas une part
        // des honoraires (conséquence n° 3 de l'ADR 0031). Un registre
        // write-once ne se réécrit pas : le mot reste, le montant est le prix.
        bidId, notaryId, actAmount: amount, commissionCents: fee,
        prixNotaCents: prix.prixNotaCents, honorairesCents: prix.honorairesCents,
        serviceId: serviceId || null,
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
        // ADR 0024's notoriety axis, ADR 0028's « services rendus ». Bumped
        // under the same write-once guard as the money, so a replay can never
        // inflate a notary's standing — and counted BY SERVICE, because the
        // cote rewards the breadth of the catalogue a notary actually serves.
        actsCompleted: (Number(notary.actsCompleted) || 0) + 1,
        actsByService: actsPlusOne(notary.actsByService, serviceId),
        updatedAt: clock(),
      });
      await recordStats(statsDeltasForComplete({ completedAt: statsDay(), commissionCents: fee }));
    }

    return {
      ok: true, actAmount: amount,
      prixNotaCents: prix.prixNotaCents, honorairesCents: prix.honorairesCents,
      commissionCents: fee, // alias historique — même montant, nom hérité
      netCents: result.netCents, transferId: result.transferId, chargeId: result.chargeId,
    };
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
  /**
   * ADR 0023 — collect a cancellation fee by PARTIAL capture of the live
   * authorization (the remainder is released by Stripe immediately). The
   * amount is decided by the caller (cancellation-config.js is the authority
   * on the barème); this method only moves the money. Returns
   * `{ ok, chargeId }`, `{ ok: false }` on any failure — the caller then
   * releases the hold whole so the client is never left blocked.
   */
  async function chargeCancellationFee({ paymentIntentId, bidId, amountCents } = {}) {
    if (!paymentIntentId || !(amountCents > 0) || typeof stripe.captureCancellationFee !== 'function') {
      return { ok: false };
    }
    try {
      const out = await stripe.captureCancellationFee({ paymentIntentId, amountCents, bidId });
      return { ok: true, chargeId: (out && out.chargeId) || null };
    } catch {
      return { ok: false };
    }
  }

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

  return { connectNotary, authorizeOffer, payNotaryOnAccept, completeAct, cancelAuthorization, chargeCancellationFee, handleWebhook, quoteOffer, priceAct, resolvePrixNota };
}

module.exports = { createBilling, NOTARY_STATUS };
