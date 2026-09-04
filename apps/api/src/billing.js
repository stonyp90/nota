'use strict';

/**
 * Billing use-cases, wired from two ports: the single-table Repo and a Stripe
 * adapter (see stripe-port.js). Framework- and SDK-free — the tests drive it
 * with the in-memory repo and a plain fake stripe object, no network.
 *
 * MODÈLE (ADR 0031, 2026-09-01) : le notaire s'inscrit et consulte gratuitement.
 * Nota ne prélève AUCUNE part des honoraires — elle vend son propre service à
 * son propre prix — depuis l'ADR 0034 une GRILLE par service, plus la garantie
 * de date sur sa propre ligne — encaissé comme frais d'application Stripe sur
 * la capture. Le net viré au notaire est exactement le montant qui lui a
 * été offert.
 *
 * Jusqu'à cette date, la part de Nota était un pourcentage que la cote du
 * notaire faisait varier. Quatre textes condamnaient cette forme — art. 32.1 2°
 * et 3° de la Loi sur le notariat, art. 32, 29.1 et 33 du Code de déontologie —
 * et l'art. 29.1 la condamnait deux fois : un revenu du notaire indexé sur une
 * note attribuée par une entreprise privée est une convention qui met en péril
 * son indépendance et son désintéressement. Le prix de Nota ne dépend donc ni
 * du notaire, ni de sa cote, ni de la valeur de l'acte : le domaine porte la
 * grille, prix-nota-config.js l'environnement et le stockage.
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

// ADR 0031 et 0034 — le prix de Nota : une grille par service, indépendante du
// notaire et de la valeur de l'acte. C'est la SEULE configuration que la
// tarification lise.
// ADR 0035 — les états de paiement où la carte du client est ENREGISTRÉE et
// prélevable hors session, mais où AUCUNE somme n'est encore réservée. C'est
// l'ensemble des offres dont la caution reste à poser.
//
// `a_reautoriser` en fait partie, et ce n'est pas un détail : le client a
// accepté une contre-proposition, donc l'autorisation d'origine — qui portait
// l'ANCIEN montant — a été relâchée, et la carte enregistrée est tout ce qui
// reste. Sans cette ligne, un acte renégocié n'était jamais cautionné (le
// notaire avait bloqué sa journée pour une créance de l'ADR 0029) et son
// annulation tardive était gratuite — le trou que l'ADR 0033 avait laissé
// ouvert « faute de caution vivante », et que la carte enregistrée referme.
const PAYMENT_STATUS_SANS_CAUTION = ['enregistre', 'a_reautoriser'];

// `todayISO` est facultatif, et il change la réponse sur UN cas : une offre
// marquée `authorized` dont la réservation a dépassé sa durée de vie. C'est le
// cas ORDINAIRE d'avant l'ADR 0035 — une autorisation posée à la publication
// pour une date à J+30 — et il en reste en base. Une telle offre n'a plus de
// garantie : elle attend sa caution comme les autres, et si la carte est
// enregistrée elle sera recautionnée par le geste quotidien.
//
// Sans le jour, la réponse reste celle d'avant : seuls les états sans caution
// comptent. Les appelants qui décident d'argent passent toujours le jour.
const attendCaution = (bid, todayISO) => {
  if (!bid) return false;
  if (PAYMENT_STATUS_SANS_CAUTION.includes(bid.paymentStatus)) return true;
  if (!todayISO) return false;
  return bid.paymentStatus === 'authorized' && !!bid.paymentIntentId
    && !domain.cautionVivante(bid.authorizedAt, todayISO);
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
   * ADR 0031 / 0034 — le devis d'une offre, AVANT tout engagement : les lignes
   * que le client voit séparément.
   *
   *   honorairesCents        — le montant offert, qui va au notaire EN ENTIER
   *   prixNotaServiceCents   — le prix de Nota pour CE service
   *   prixNotaDateCents      — la garantie de date, quand la date en demande une
   *   prixNotaCents          — la somme des deux lignes de Nota
   *   totalCents             — ce que la carte du client doit autoriser
   *
   * Aucun de ces nombres ne dépend du notaire : art. 29.1 du Code de
   * déontologie interdit au notaire toute convention mettant en péril son
   * désintéressement, et un prix qui bougerait selon sa cote en serait une. Le
   * service et le délai, eux, sont deux dimensions PUBLIÉES que le client
   * connaît avant d'offrir — c'est tout l'objet de l'ADR 0034.
   *
   * L'arithmétique elle-même est celle du domaine (`domain.prixNota`) : la
   * facturation ne recalcule jamais un prix à la main.
   *
   * `devisFige` — les deux lignes déjà AUTORISÉES, relues sur l'offre. Quand
   * elles sont là, elles l'emportent sur la grille du jour : la carte du client
   * a été bloquée pour un total précis, et le devis du règlement doit être
   * celui que le client a lu avant d'engager sa carte. Sans elles (offre
   * publiée sans carte, enregistrement d'avant l'ADR 0034), la grille en
   * vigueur décide, comme avant.
   */
  async function quoteOffer(actAmount, { serviceId, tierId, devisFige } = {}) {
    const honorairesCents = Math.round(Number(actAmount) * 100);
    const p = domain.prixNotaFige(devisFige)
      || domain.prixNota(serviceId, tierId, await resolveGrilleNota());
    return {
      honorairesCents,
      prixNotaServiceCents: p.serviceCents,
      prixNotaDateCents: p.dateCents,
      prixNotaCents: p.totalCents,
      totalCents: honorairesCents + p.totalCents,
    };
  }

  // La grille en vigueur : celle stockée par l'admin, sinon celle du déploiement.
  async function resolveGrilleNota() {
    return prixConfig.resolveGrille(repo, process.env);
  }

  // Le devis d'un acte. Il ne prend PAS de notaire, et c'est le fond du sujet.
  async function priceAct(actAmount, opts) {
    return quoteOffer(actAmount, opts);
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
    // 2026-09-02: an APPROVED notary (`approuveLe`, the operator's activation)
    // connects payouts from inside a console they already use — their status
    // is not Stripe's to set, so it is left exactly as it is. Only a notary who
    // starts here, with no record or a status-less one, is `onboarding`.
    const approved = !!(existing && existing.approuveLe);
    await repo.putNotary({
      // Preserve any session-upserted profile fields (label, createdAt) while
      // stamping the billing identity on the same record.
      ...(existing || {}),
      id, email: clean,
      status: approved ? existing.status : NOTARY_STATUS.ONBOARDING,
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
    // The « en intégration » gauge counts a notary ONCE: a record that already
    // carries a status (signed up at /notaries/signup, or approved) was
    // counted when it was written.
    if (!(existing && existing.status)) await recordStats(statsDeltasForNotaryOnboarding());

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
  async function completeAct({ notaryId, bidId, actAmount, serviceId, tierId, devisFige } = {}) {
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

    // ADR 0034 — le devis du règlement EST celui que le client a lu avant
    // d'engager sa carte : `devisFige` porte les deux lignes autorisées,
    // relues sur l'offre. La grille est vivante, l'autorisation ne l'est pas.
    // Sans devis figé (offre sans carte, enregistrement d'avant l'ADR 0034),
    // le service et le palier RETENUS résolvent la grille en vigueur.
    const prix = await priceAct(amount, { serviceId, tierId, devisFige });
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
        // ADR 0034 — les DEUX lignes de Nota, figées avec l'argent : le prix du
        // service et la garantie de date. Une grille modifiée demain ne peut
        // pas réécrire ce qu'un acte a coûté.
        prixNotaServiceCents: prix.prixNotaServiceCents, prixNotaDateCents: prix.prixNotaDateCents,
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
   * PAY-ON-ACCEPT, step 1 — take the client's card when they post an offer.
   *
   * ADR 0035 — WHICH Stripe surface opens depends on ONE question: can an
   * authorization posted today still be alive at the signing? A Stripe
   * authorization lives ~7 days; the carnet's « standard » tier starts at 15.
   * So the answer is the domain's `cautionDue`:
   *
   *   • date already inside the caution window → a PAYMENT session, manual
   *     capture, exactly as before: the hold is posted now and it will reach
   *     the signature;
   *   • date beyond it → a SETUP session: the card is registered, validated by
   *     the issuer, and NOTHING is held. The caution itself is placed at
   *     J-CAUTION_LEAD_DAYS by the daily gesture (`placeCaution`).
   *
   * Either way the offer stays PENDING until the client comes back through
   * Stripe — a demand a notary sees always rests on a card a bank accepted.
   * Returns `{ ok, url, sessionId, mode }`.
   */
  async function authorizeOffer({ bidId, bidDate, amountCents, email, description, successUrl, cancelUrl, reprise } = {}) {
    const cents = Math.round(Number(amountCents));
    if (!(cents > 0)) {
      return { ok: false, errors: [{ code: 'montant_invalide', message: 'Montant de l’offre invalide.' }] };
    }
    const args = {
      amountCents: cents, currency: 'cad', bidId, bidDate, description,
      customerEmail: email || undefined, successUrl, cancelUrl,
      // `reprise` — le client REVIENT donner une autre carte après un refus.
      // La clé d'idempotence doit alors changer, sinon Stripe rejoue la session
      // déjà terminée avec la carte refusée et la reprise est un lien mort.
      ...(reprise ? { cle: String(reprise) } : {}),
    };
    if (bidDate && !domain.cautionDue(bidDate, statsDay())) {
      const setup = await stripe.createOfferSetup(args);
      return { ok: true, url: setup.url, sessionId: setup.sessionId, mode: 'enregistrement' };
    }
    const { sessionId, url } = await stripe.createOfferAuthorization(args);
    return { ok: true, url, sessionId, mode: 'paiement' };
  }

  /**
   * ADR 0035 — POSE LA CAUTION. The daily gesture (reminders.js) calls this for
   * every live offer entering the caution window: it creates, off session, the
   * authorization that must survive until the signature, then binds it to the
   * bid exactly like the publication webhook used to.
   *
   * CE QUI GARANTIT LE PAIEMENT DU NOTAIRE, dans ce modèle :
   *   1. an offer is only ever visible once the client's card has been
   *      REGISTERED — Stripe validated it with the issuer. A notary never
   *      retains against a card nobody checked;
   *   2. the caution is posted two days before the signing and lives ~7 days,
   *      so it is alive when the act is signed and can be captured;
   *   3. a card refused at J-2 warns BOTH parties two days ahead, is retried
   *      the next day, and never blocks the act: settlement keeps its fallback
   *      (the fee becomes a receivable, ADR 0029) and the notary keeps the
   *      dossier.
   *
   * NEVER THROWS: a declined card is an operating fact, not an exception. It
   * answers `{ ok:false, code:'caution_refusee', refus }` and records the
   * refusal on the offer.
   *
   * Codes de refus, chacun un geste d'opérateur DIFFÉRENT :
   *   • `caution_refusee`  — la banque a dit non. On relance le client.
   *   • `carte_absente`    — aucun moyen de paiement connu. Soit le webhook
   *                          `setup_intent.succeeded` n'est pas branché, soit
   *                          l'offre est antérieure à l'ADR 0035. On répare
   *                          une configuration, pas un client.
   *   • `caution_non_inscrite` — la réservation existe chez Stripe mais n'a pas
   *                          pu être écrite ; elle a été relâchée pour que
   *                          demain reparte propre (jamais deux blocages).
   */
  async function placeCaution({ bid, todayISO } = {}) {
    if (!bid || !bid.id) return { ok: false, code: 'offre_absente' };
    const jour = todayISO || statsDay();
    // Already guaranteed — a second run of the day, or a hold posted at
    // publication because the date was already close. « Guaranteed » means
    // ALIVE: a hold that has outlived Stripe's ~7-day window guarantees
    // nothing, and answering `deja` on one would let a legacy offer sail to
    // its signing on a dead authorization (ADR 0035, offres héritées).
    const heritee = bid.paymentStatus === 'authorized' && !!bid.paymentIntentId
      && !domain.cautionVivante(bid.authorizedAt, jour);
    if (bid.paymentStatus === 'authorized' && bid.paymentIntentId && !heritee) {
      return { ok: true, deja: true, paymentIntentId: bid.paymentIntentId };
    }
    if (!attendCaution(bid, jour)) return { ok: false, code: 'carte_absente', heritee };
    // Le moyen de paiement peut manquer alors que le client Stripe est connu :
    // c'est la signature d'un point de terminaison abonné à
    // `checkout.session.completed` seul. Plutôt que d'abandonner, on redemande
    // à Stripe la carte de ce client — un repli, pas une case à cocher dans une
    // console tierce (ADR 0035, risque n° 1).
    const carte = await resoudreCarte(bid);
    if (!carte.customerId || !carte.paymentMethodId) return { ok: false, code: 'carte_absente', heritee };
    if (typeof stripe.placeOfferAuthorization !== 'function') return { ok: false, code: 'carte_absente', heritee };

    // The caution carries the SAME two lines the settlement will capture: the
    // notary's fees and Nota's own price (ADR 0031). Holding only the fees
    // would under-reserve the client at capture time.
    // ADR 0034 × ADR 0035 — la caution porte le devis FIGÉ de cette offre, pas
    // un prix recalculé au moment où on la pose. Sans les trois arguments,
    // `quoteOffer` retombait sur le défaut de la grille (aucun service, aucune
    // garantie de date) : le client lisait 2 349 $ à la publication et sa carte
    // se voyait réserver 2 199 $ deux jours avant la signature. Le défaut est né
    // de la RENCONTRE des deux ADR — la caution différée a été écrite quand le
    // prix de Nota était encore un forfait unique, où l'appel nu était juste.
    const devis = await quoteOffer(bid.montant, {
      serviceId: bid.serviceId,
      tierId: bid.tier,
      devisFige: bid,
    });
    let out;
    try {
      out = await stripe.placeOfferAuthorization({
        customerId: carte.customerId,
        paymentMethodId: carte.paymentMethodId,
        amountCents: devis.totalCents,
        currency: 'cad',
        bidId: bid.id,
        bidDate: bid.dateISO,
        description: bid.serviceId ? (domain.serviceById(bid.serviceId) || {}).nom : undefined,
        // The day scopes the idempotency key: two runs today are one attempt,
        // tomorrow's retry after a decline is a new one.
        jour,
      });
    } catch (err) {
      const refus = {
        at: clock(),
        code: (err && (err.code || err.decline_code)) || 'carte_refusee',
        message: String((err && err.message) || 'La carte a été refusée.').slice(0, 300),
      };
      if (typeof repo.markCautionRefusee === 'function') {
        try {
          await repo.markCautionRefusee(bid.id, bid.dateISO, refus);
        } catch {
          /* an unrecordable refusal must still be REPORTED, never thrown */
        }
      }
      return { ok: false, code: 'caution_refusee', refus };
    }

    // L'ÉCRITURE fait partie du geste d'argent. Si elle échoue, la réservation
    // existe chez Stripe mais rien ne la nomme sur l'offre : demain la passe
    // reprendrait l'offre comme non cautionnée, et la clé d'idempotence porte
    // le JOUR — elle créerait un SECOND blocage du montant complet sur la même
    // carte. Le code appelle cela un vol ailleurs ; on ne le laisse pas arriver
    // ici. La réservation orpheline est donc relâchée tout de suite, et la
    // journée de demain repart d'une carte libre.
    let updated = null;
    try {
      updated = typeof repo.authorizeBid === 'function'
        ? await repo.authorizeBid(bid.id, bid.dateISO, { paymentIntentId: out.paymentIntentId, authorizedAt: clock() })
        : null;
    } catch (err) {
      let relachee = false;
      if (typeof stripe.cancelOfferAuthorization === 'function') {
        try {
          await stripe.cancelOfferAuthorization({ paymentIntentId: out.paymentIntentId, bidId: bid.id });
          relachee = true;
        } catch { /* le blocage expirera de lui-même ; il faut surtout le DIRE */ }
      }
      return {
        ok: false,
        code: 'caution_non_inscrite',
        relachee,
        paymentIntentId: out.paymentIntentId,
        message: String((err && err.message) || err).slice(0, 300),
      };
    }
    return { ok: true, paymentIntentId: out.paymentIntentId, bid: updated };
  }

  /**
   * ADR 0035 — QUELLE CARTE porte la caution. Normalement les deux moitiés sont
   * déjà sur l'offre : le client Stripe (posé par `checkout.session.completed`)
   * et le moyen de paiement (posé par `setup_intent.succeeded`).
   *
   * Le second événement est le risque n° 1 de la livraison : s'il n'est pas
   * abonné dans le point de terminaison Stripe, aucune carte n'est jamais
   * nommée et AUCUNE caution ne peut être posée — une case à cocher dans une
   * console tierce déciderait si le produit fonctionne. Deux replis ferment
   * cette porte, dans l'ordre du moins ambigu au plus large :
   *
   *   1. le SetupIntent que la session de Checkout nomme (`setupIntentId`) :
   *      il porte exactement la carte que CE client a validée pour CETTE offre ;
   *   2. à défaut, les cartes du client Stripe — un client créé par Checkout
   *      pour cette offre n'en porte qu'une.
   *
   * Ne lève jamais : un repli qui échoue laisse simplement la réponse d'origine.
   */
  async function resoudreCarte(bid) {
    const dejaLa = { customerId: bid.paymentCustomerId || null, paymentMethodId: bid.paymentMethodId || null };
    if (dejaLa.customerId && dejaLa.paymentMethodId) return dejaLa;

    let customerId = dejaLa.customerId;
    let paymentMethodId = dejaLa.paymentMethodId;
    if (bid.setupIntentId && typeof stripe.retrieveSetupIntent === 'function') {
      try {
        const si = await stripe.retrieveSetupIntent({ setupIntentId: bid.setupIntentId });
        customerId = customerId || (si && si.customerId) || null;
        paymentMethodId = paymentMethodId || (si && si.paymentMethodId) || null;
      } catch { /* un repli qui échoue n'est pas une panne */ }
    }
    if (!paymentMethodId && customerId && typeof stripe.listCustomerPaymentMethods === 'function') {
      try {
        const cartes = await stripe.listCustomerPaymentMethods({ customerId });
        if (Array.isArray(cartes) && cartes.length === 1) paymentMethodId = cartes[0] || null;
      } catch { /* idem */ }
    }
    if (!customerId || !paymentMethodId) return { customerId, paymentMethodId };

    // Ce qui a été retrouvé est INSCRIT sur l'offre : le repli est un filet,
    // pas une dépendance permanente à un aller-retour Stripe par tentative.
    if (typeof repo.registerBidPaymentMethod === 'function') {
      try {
        await repo.registerBidPaymentMethod(bid.id, bid.dateISO, {
          customerId, paymentMethodId, setupIntentId: bid.setupIntentId || null, registeredAt: clock(),
        });
      } catch { /* la caution peut se poser même si l'inscription rate */ }
    }
    return { customerId, paymentMethodId };
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
  async function payNotaryOnAccept({ notaryId, bidId, actAmount, paymentIntentId, serviceId, tierId, devisFige } = {}) {
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

    // ADR 0034 — le devis du règlement EST celui que le client a lu avant
    // d'engager sa carte : `devisFige` porte les deux lignes autorisées,
    // relues sur l'offre. La grille est vivante, l'autorisation ne l'est pas.
    // Sans devis figé (offre sans carte, enregistrement d'avant l'ADR 0034),
    // le service et le palier RETENUS résolvent la grille en vigueur.
    const prix = await priceAct(amount, { serviceId, tierId, devisFige });
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
        prixNotaServiceCents: prix.prixNotaServiceCents, prixNotaDateCents: prix.prixNotaDateCents,
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
   * on the barème); this method only moves the money.
   *
   * ADR 0033 — the fee is the NOTARY'S: it compensates the day they reserved.
   * A notary who can receive (ACTIVE, charges enabled, connected account) is
   * transferred the whole amount in the same motion (`verse: true`). One who
   * cannot — still onboarding, capability pulled, no account — is CREDITED:
   * `dedommagementCentsDue` grows on their record, the way ADR 0029 books a
   * receivable rather than pretending money moved (`verse: false`). Nota
   * keeps nothing of it either way.
   *
   * A transfer that fails after a successful capture is the same case: the
   * money sits on the platform, so it is recorded as owed and the capture is
   * NOT retried. Only a failed CAPTURE answers `{ ok: false }` — the caller
   * then releases the hold whole so the client is never left blocked.
   *
   * UN ÉCHEC EST UN FAIT, PAS UN SILENCE. La porte hors session vise justement
   * des cartes qui viennent parfois d'être refusées à J-2 : c'est le cas de
   * bord le plus probable du mécanisme. Il répond donc
   * `{ ok:false, code:'frais_refuses', mecanisme, refus }` — assez pour que la
   * route d'annulation INSCRIVE des frais dus et non perçus plutôt que de
   * laisser l'annulation passer gratuitement sans que personne ne le compte.
   *
   * Returns `{ ok, mecanisme, chargeId, transferId, verse }`.
   */
  async function chargeCancellationFee({ paymentIntentId, bidId, amountCents, notaryId, customerId, paymentMethodId } = {}) {
    if (!(amountCents > 0)) return { ok: false, code: 'montant_invalide' };
    // ADR 0035 — TWO mechanisms, one rule. A live caution is collected by
    // PARTIAL capture (nothing new is asked of the client). Without one — the
    // signing was still far enough that the caution was not placed yet — the
    // fee is charged OFF SESSION on the card the client registered. Losing the
    // second door would silently make the 4-14 day band of the barème free.
    const parCapture = !!(paymentIntentId && typeof stripe.captureCancellationFee === 'function');
    const horsSession = !parCapture
      && !!(customerId && paymentMethodId && typeof stripe.chargeCancellationFeeOffSession === 'function');
    if (!parCapture && !horsSession) return { ok: false, code: 'aucun_moyen' };
    const mecanisme = parCapture ? 'capture' : 'hors_session';
    const cents = Math.round(Number(amountCents));
    const notary = notaryId ? await repo.getNotary(notaryId) : null;
    const payable = !!(notary && notary.status === NOTARY_STATUS.ACTIVE && notary.chargesEnabled && notary.connectAccountId);

    let out;
    try {
      out = parCapture
        ? await stripe.captureCancellationFee({
          paymentIntentId, amountCents: cents, bidId,
          ...(payable ? { connectAccountId: notary.connectAccountId } : {}),
        })
        : await stripe.chargeCancellationFeeOffSession({
          customerId, paymentMethodId, amountCents: cents, bidId,
          ...(payable ? { connectAccountId: notary.connectAccountId } : {}),
        });
    } catch (err) {
      // The capture went through and only the transfer failed: the money is
      // on the platform. Never lose it, never re-capture it.
      if (!(err && err.captured && err.chargeId)) {
        // Tout le reste — et un refus de carte hors session en est un — est un
        // ÉCHEC DE PRÉLÈVEMENT. Il est nommé, daté et rendu à l'appelant.
        return {
          ok: false,
          code: 'frais_refuses',
          mecanisme,
          refus: {
            at: clock(),
            code: (err && (err.code || err.decline_code)) || 'frais_refuses',
            message: String((err && err.message) || 'Les frais n’ont pas pu être prélevés.').slice(0, 300),
          },
        };
      }
      out = { chargeId: err.chargeId, transferId: null };
    }

    const chargeId = (out && out.chargeId) || null;
    const transferId = (payable && out && out.transferId) || null;
    const verse = !!transferId;
    if (!verse && notary) {
      await repo.putNotary({
        ...notary,
        dedommagementCentsDue: (Number(notary.dedommagementCentsDue) || 0) + cents,
        updatedAt: clock(),
      });
    }
    return { ok: true, mecanisme, chargeId, transferId, verse };
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

  // A Stripe field that is either an id string or the expanded object.
  const idOf = (v) => (typeof v === 'string' ? v : (v && v.id) || null);

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
        // 2026-09-02: an APPROVED notary's status belongs to the operator, not
        // to Stripe. For them this event moves `chargesEnabled` alone — the one
        // fact that says whether payouts can flow — and the gauge never swings
        // on a toggle (they were counted active at activation).
        const approved = !!(prior && prior.approuveLe);
        const notary = await transition(notaryId, {
          chargesEnabled: enabled,
          ...(approved ? {} : { status: enabled ? NOTARY_STATUS.ACTIVE : NOTARY_STATUS.ONBOARDING }),
        });
        // Move the gauge only on an ACTUAL active<->onboarding transition, so a
        // charges_enabled toggle can never double-count (true->false->true) and
        // a revert-to-onboarding decrements the active bucket.
        if (notary && !approved) {
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

      // Client finished Checkout. TWO shapes since ADR 0035:
      //   • payment mode — the signing was already inside the caution window,
      //     so the card is AUTHORIZED: bind the PaymentIntent, the offer goes
      //     live carrying its guarantee;
      //   • setup mode — the card is merely REGISTERED. There is no
      //     PaymentIntent to bind and claiming one would be a lie about money:
      //     record the Customer, mark the offer `enregistre`, and let the daily
      //     gesture place the caution at J-CAUTION_LEAD_DAYS.
      case 'checkout.session.completed': {
        const md = obj.metadata || {};
        const paymentIntentId = idOf(obj.payment_intent);
        let bid = null;
        if (md.bidId && paymentIntentId && typeof repo.authorizeBid === 'function') {
          bid = await repo.authorizeBid(md.bidId, md.bidDate, { paymentIntentId, authorizedAt: clock() });
        } else if (md.bidId && typeof repo.registerBidPaymentMethod === 'function') {
          // La session de setup NE PORTE PAS de `payment_method` : seulement le
          // SetupIntent, par son id. Nota le suit donc jusqu'à la carte plutôt
          // que d'attendre `setup_intent.succeeded` — sans quoi un point de
          // terminaison abonné à ce seul événement écrirait un client Stripe
          // sans moyen de paiement, et AUCUNE caution ne serait jamais posée
          // (ADR 0035, risque n° 1). Un repli qui échoue laisse l'offre
          // enregistrée : `placeCaution` retentera la résolution le jour venu.
          const setupIntentId = idOf(obj.setup_intent);
          let paymentMethodId = null;
          let customerId = idOf(obj.customer);
          if (setupIntentId && typeof stripe.retrieveSetupIntent === 'function') {
            try {
              const si = await stripe.retrieveSetupIntent({ setupIntentId });
              paymentMethodId = (si && si.paymentMethodId) || null;
              customerId = customerId || (si && si.customerId) || null;
            } catch { /* le webhook doit répondre 200 : un repli n'est pas une panne */ }
          }
          bid = await repo.registerBidPaymentMethod(md.bidId, md.bidDate, {
            customerId,
            paymentMethodId,
            setupIntentId,
            registeredAt: clock(),
          });
        }
        return { handled: !!bid, notary: null, bid };
      }

      // ADR 0035 — the saved card itself. The Checkout session says WHICH
      // customer; this event says which PAYMENT METHOD, and off-session
      // charging needs it by name. Both write the same record, so whichever
      // delivery lands first (or alone) leaves the offer usable.
      case 'setup_intent.succeeded': {
        const md = obj.metadata || {};
        let bid = null;
        if (md.bidId && typeof repo.registerBidPaymentMethod === 'function') {
          bid = await repo.registerBidPaymentMethod(md.bidId, md.bidDate, {
            customerId: idOf(obj.customer),
            paymentMethodId: idOf(obj.payment_method),
            setupIntentId: obj.id || null,
            registeredAt: clock(),
          });
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

  return { connectNotary, authorizeOffer, payNotaryOnAccept, completeAct, cancelAuthorization, chargeCancellationFee, handleWebhook, quoteOffer, priceAct, resolveGrilleNota, placeCaution, attendCaution };
}

module.exports = { createBilling, NOTARY_STATUS, attendCaution };
