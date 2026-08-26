'use strict';

/**
 * Notifier use-cases — the orchestration layer of the notification vertical.
 * Wired from two ports: the single-table Repo and a mailer (see notify-port.js).
 * Framework- and SDK-free — tests drive it with the in-memory repo and the fake
 * mailer, no network.
 *
 * Responsibilities:
 *   - pick the right template (emails.js) for a lifecycle event;
 *   - respect the recipient's consent: never mail a suppressed (unsubscribed)
 *     address (CASL / Law 25);
 *   - be idempotent: a given (refId, kind) is mailed at most once, recorded in
 *     the SENT ledger, so a re-run or a webhook redelivery never double-sends.
 *
 * The notifier never throws to its callers about mail failures: onOfferCreated
 * is wired fire-and-forget into POST /bids and must never break the response.
 */

const emails = require('./emails');

// Unsubscribe token: base64url of the email. The GET /unsubscribe route decodes
// it and records the opt-out. CASL requires a *working* mechanism, not a signed
// one; this is reversible and carries no secret.
function encodeUnsubToken(email) {
  return Buffer.from(String(email || ''), 'utf8').toString('base64url');
}
function decodeUnsubToken(token) {
  try {
    return Buffer.from(String(token || ''), 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function createNotifier({ repo, mailer, baseUrl, operatorEmail, now } = {}) {
  if (!repo) throw new Error('createNotifier: repo is required');
  if (!mailer) throw new Error('createNotifier: mailer is required');

  const clock = now || (() => new Date().toISOString());
  const base = baseUrl || '';

  function unsubscribeUrl(email) {
    const b = String(base).replace(/\/+$/, '');
    return b + '/unsubscribe?token=' + encodeUnsubToken(email);
  }

  // Send one message at most once, honoring suppression. Returns a small result
  // describing what happened (sent, or why not) so callers/tests can assert.
  async function sendOnce({ refId, kind, to, buildTemplate }) {
    if (!to) return { sent: false, reason: 'no-address', kind };
    if (await repo.isUnsubscribed(to)) return { sent: false, reason: 'unsubscribed', kind };
    if (await repo.wasNotificationSent(refId, kind)) return { sent: false, reason: 'duplicate', kind };

    const msg = buildTemplate({ unsubscribeUrl: unsubscribeUrl(to), baseUrl: base });
    await mailer.send({ to, subject: msg.subject, html: msg.html, text: msg.text });
    await repo.markNotificationSent(refId, kind, clock());
    return { sent: true, kind, to };
  }

  function bidCtx(bid, extra) {
    return {
      serviceId: bid.serviceId,
      dateISO: bid.dateISO,
      montant: bid.montant,
      tier: bid.tier,
      ...extra,
    };
  }

  // --- Offer lifecycle (client + operator) ---------------------------------

  // Fired from POST /bids (fire-and-forget). Confirms the offer to the client
  // (the offerPublished nudge → dossier) and alerts the operator of a new lead.
  async function onOfferCreated(bid) {
    const results = [];
    try {
      if (bid.courriel) {
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'offerPublished',
            to: bid.courriel,
            buildTemplate: (env) => emails.offerPublished({ ...bidCtx(bid), ...env }),
          })
        );
      }
      if (operatorEmail) {
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'operatorNewLead',
            to: operatorEmail,
            buildTemplate: (env) => emails.operatorNewLead({ ...bidCtx(bid), ...env }),
          })
        );
      }
    } catch (err) {
      // Never let a mail failure break the caller (the POST /bids response).
      return { ok: false, error: String((err && err.message) || err), results };
    }
    return { ok: true, results };
  }

  async function onOfferRetained(bid) {
    if (!bid) return { ok: true, results: [] };
    const results = [];
    try {
      if (bid.courriel) {
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'offerRetained',
            to: bid.courriel,
            buildTemplate: (env) => emails.offerRetained({ ...bidCtx(bid), ...env }),
          })
        );
      }
      // Referral rewards (ADR 0011) — retention is the earning moment for the
      // client track, and the first retained act is the earning moment for the
      // notary track, so BOTH are checked here, on the one retain path every
      // flow funnels through (accept and proposition-accept alike).
      results.push(...(await onReferralRetained(bid)));
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
  }

  // --- Partner referral rewards (ADR 0011) ----------------------------------
  // A reward mail goes only to a partner who actually REGISTERED their code
  // (POST /partenaires gives us a courriel); an unregistered code still earns
  // in the admin ledger, there is just nowhere to send the news. Two tracks:
  //   • client: the retained bid carries `parrain` -> one mail per bid
  //     (refId = bid id, kind referral_client);
  //   • notaire: the retaining notary's profile carries `parrain` -> one mail
  //     EVER per notary (refId = notary id, kind referral_notaire) — the SENT
  //     ledger is exactly the "first retained act" rule, no counting needed.
  async function onReferralRetained(bid) {
    const results = [];
    if (typeof repo.getPartner !== 'function') return results;
    // Same FRAUD BARRIER the earning ledger enforces (see recordReferralEarnings
    // in handler.js): a reward mail is a payout instruction to the operator, so
    // it may only fire on a LIVE demand — one whose card was authorized, or where
    // billing is off (no paymentStatus, every bid live). A bid still `pending`
    // (never taken through Checkout) is a staged demand and earns no mail on
    // either track. Kept identical to the handler's isLive so the two never drift.
    const isLive = bid.paymentStatus !== 'pending' && bid.paymentStatus !== 'voided';
    if (!isLive) return results;

    if (bid.parrain) {
      const partner = await repo.getPartner(bid.parrain);
      if (partner && partner.courriel) {
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'referral_client',
            to: partner.courriel,
            buildTemplate: (env) => emails.referralRewardClient({ ...bidCtx(bid), code: partner.code, ...env }),
          })
        );
      }
    }

    const notary =
      bid.notaryId && typeof repo.getNotary === 'function' ? await repo.getNotary(bid.notaryId) : null;
    if (notary && notary.parrain) {
      const partner = await repo.getPartner(notary.parrain);
      if (partner && partner.courriel) {
        results.push(
          await sendOnce({
            refId: notary.id,
            kind: 'referral_notaire',
            to: partner.courriel,
            buildTemplate: (env) => emails.referralRewardNotary({ code: partner.code, ...env }),
          })
        );
      }
    }
    return results;
  }

  // Fired from POST /partenaires (fire-and-forget): welcome the partner with
  // their shareable link + alert the operator, each at most once per code.
  async function onPartnerRegistered(partner) {
    if (!partner || !partner.code) return { ok: true, results: [] };
    const results = [];
    try {
      if (partner.courriel) {
        results.push(
          await sendOnce({
            refId: partner.code,
            kind: 'partnerWelcome',
            to: partner.courriel,
            buildTemplate: (env) => emails.partnerWelcome({ code: partner.code, type: partner.type, ...env }),
          })
        );
      }
      if (operatorEmail) {
        results.push(
          await sendOnce({
            refId: partner.code,
            kind: 'operatorNewPartner',
            to: operatorEmail,
            buildTemplate: (env) =>
              emails.operatorNewPartner({ code: partner.code, type: partner.type, courriel: partner.courriel, ...env }),
          })
        );
      }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
    return { ok: true, results };
  }

  // --- Notary actions on an open offer ---------------------------------------
  // Fired fire-and-forget from POST /notary/bids/propose: the client (no account,
  // per-bid token) learns a notary proposed a higher price. Idempotent per
  // proposition id.
  async function onCounterOfferProposed(bid, proposition) {
    if (!bid || !bid.courriel || !proposition) return { ok: true, results: [] };
    try {
      const r = await sendOnce({
        refId: proposition.id,
        kind: 'propositionRecue',
        to: bid.courriel,
        buildTemplate: (env) =>
          emails.propositionRecue({
            ...bidCtx(bid),
            proposition: { montant: proposition.montant, delta: proposition.delta, message: proposition.message, etude: proposition.etude },
            ...env,
          }),
      });
      return { ok: true, results: [r] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  // Fired from POST /notary/bids/documents: the client is mailed the list of
  // requested items. Idempotent per demande id.
  async function onDocumentsRequested(bid, demande) {
    if (!bid || !bid.courriel || !demande) return { ok: true, results: [] };
    try {
      const r = await sendOnce({
        refId: demande.id,
        kind: 'documentsDemandes',
        to: bid.courriel,
        buildTemplate: (env) =>
          emails.documentsDemandes({
            ...bidCtx(bid),
            demande: { documents: demande.documents, message: demande.message, etude: demande.etude },
            ...env,
          }),
      });
      return { ok: true, results: [r] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  // Fired from POST /client/propositions/accept|decline: tells the notary who
  // made the proposition how the client answered. `notary` is their profile
  // (repo.getNotary); resolved here when the caller did not pass it. One mail
  // per proposition: the kind follows the final status.
  async function onCounterOfferAnswered(bid, proposition, notary) {
    if (!bid || !proposition) return { ok: true, results: [] };
    try {
      const profile =
        notary || (proposition.notaryId && typeof repo.getNotary === 'function' ? await repo.getNotary(proposition.notaryId) : null);
      const to = profile && profile.email;
      const accepted = proposition.status === 'acceptee';
      const r = await sendOnce({
        refId: proposition.id,
        kind: accepted ? 'propositionAcceptee' : 'propositionRefusee',
        to,
        buildTemplate: (env) =>
          (accepted ? emails.propositionAcceptee : emails.propositionRefusee)({
            ...bidCtx(bid),
            proposition: { montant: proposition.montant, delta: proposition.delta },
            ...env,
          }),
      });
      return { ok: true, results: [r] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  // Fired from POST /client/bid/cancel: the client withdrew their offer. The
  // client always gets a confirmation; when the bid was RETAINED, the notary
  // who held it and the operator are told too — a mise en relation (and maybe
  // money) is being unwound. Idempotent per bid and audience.
  async function onOfferCancelled(bid, { notary, wasRetained } = {}) {
    if (!bid) return { ok: true, results: [] };
    const results = [];
    try {
      if (bid.courriel) {
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'offerCancelled',
            to: bid.courriel,
            buildTemplate: (env) => emails.offerCancelled({ ...bidCtx(bid), ...env }),
          })
        );
      }
      if (wasRetained) {
        const to = notary && notary.email;
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'offerCancelledNotary',
            to,
            buildTemplate: (env) => emails.offerCancelledNotary({ ...bidCtx(bid), ...env }),
          })
        );
        if (operatorEmail) {
          results.push(
            await sendOnce({
              refId: bid.id,
              kind: 'operatorOfferCancelled',
              to: operatorEmail,
              buildTemplate: (env) => emails.operatorOfferCancelled({ ...bidCtx(bid), etude: bid.etude, ...env }),
            })
          );
        }
      }
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
  }

  // --- Contact form (nous joindre) ------------------------------------------
  // Fired from POST /contact. The operator gets the message and the sender an
  // acknowledgement; the sender's unsubscribe silences only their own ack —
  // their message still reaches the operator, because writing the form IS the
  // request to be contacted. refId is the contact id minted per submission, so
  // the same person can write twice.
  async function onContactMessage(msg) {
    if (!msg || !msg.courriel || !msg.message) return { ok: true, results: [] };
    const results = [];
    try {
      if (operatorEmail) {
        results.push(
          await sendOnce({
            refId: msg.id,
            kind: 'operatorContactMessage',
            to: operatorEmail,
            buildTemplate: (env) =>
              emails.operatorContactMessage({
                nom: msg.nom,
                email: msg.courriel,
                sujet: msg.sujet,
                message: msg.message,
                bidId: msg.bidId,
                ...env,
              }),
          })
        );
      }
      results.push(
        await sendOnce({
          refId: msg.id,
          kind: 'contactRecu',
          to: msg.courriel,
          buildTemplate: (env) => emails.contactRecu({ nom: msg.nom, message: msg.message, ...env }),
        })
      );
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
  }

  // --- Client onboarding ---------------------------------------------------
  // Fired when a client signs up (email captured in the sign-in modal, no offer
  // yet). One warm welcome, conversion-first (publish a demand). Idempotent per
  // address, so re-opening the modal or signing in again never re-sends. Wired
  // fire-and-forget from POST /client/welcome — never throws to the caller.
  async function onClientSignup(email) {
    const to = String(email || '').trim().toLowerCase();
    if (!to) return { ok: true, results: [] };
    try {
      const r = await sendOnce({
        refId: to,
        kind: 'clientWelcome',
        to,
        buildTemplate: (env) => emails.clientWelcome({ ...env }),
      });
      return { ok: true, results: [r] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  // --- Reminder cadence (called by the daily scheduler) --------------------
  // Maps a domain reminder kind to its template. j7/j3/j1 share the tier-aware
  // dateApproaching template; dossier_incomplet uses the dossierIncomplete nudge.
  async function onReminderDue(bid, kind, todayISO) {
    if (!bid || !bid.courriel) return { sent: false, reason: 'no-address', kind };
    const days = require('@nota/domain').daysBetween(todayISO, bid.dateISO);
    const template =
      kind === 'dossier_incomplet' ? emails.dossierIncomplete : emails.dateApproaching;
    return sendOnce({
      refId: bid.id,
      kind,
      to: bid.courriel,
      buildTemplate: (env) => template({ ...bidCtx(bid, { days }), ...env }),
    });
  }

  // --- Notary onboarding (free Stripe Connect) ------------------------------
  // Fired from POST /notaries/connect (fire-and-forget). Backs up the hosted
  // onboarding link into the notary's inbox so a closed tab is recoverable.
  // Idempotent per address: a double-click never double-sends.
  async function onNotaryConnected(email, onboardingUrl) {
    const to = String(email || '').trim().toLowerCase();
    if (!to) return { ok: true, results: [] };
    try {
      const r = await sendOnce({
        refId: to,
        kind: 'notaryOnboardingStarted',
        to,
        buildTemplate: (env) => emails.notaryOnboardingStarted({ onboardingUrl, ...env }),
      });
      return { ok: true, results: [r] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  // --- Act paid (capture + transfer done) -----------------------------------
  // Fired after payNotaryOnAccept / completeAct succeeds. Statement to the
  // notary + revenue alert to the operator, at most once per bid.
  async function onActPaid({ notaryId, bid, actAmount } = {}) {
    if (!bid || !bid.id) return { ok: true, results: [] };
    const results = [];
    try {
      const notary =
        notaryId && typeof repo.getNotary === 'function' ? await repo.getNotary(notaryId) : null;
      const ctx = { ...bidCtx(bid), actAmount };
      if (notary && notary.email) {
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'actPaidNotary',
            to: notary.email,
            buildTemplate: (env) => emails.actPaidNotary({ ...ctx, ...env }),
          })
        );
      }
      if (operatorEmail) {
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'operatorActCompleted',
            to: operatorEmail,
            buildTemplate: (env) =>
              emails.operatorActCompleted({ ...ctx, notaryEmail: notary && notary.email, ...env }),
          })
        );
      }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
    return { ok: true, results };
  }

  // --- Stripe account lifecycle (notary + client + operator) ----------------
  // Driven from the Stripe webhook route with the verified event, the affected
  // notary, and — for pay-on-accept events — the affected bid. Switches on
  // event type; unknown types produce nothing.
  async function onAccountEvent(event, notary, bid) {
    const type = event && event.type;
    const obj = (event && event.data && event.data.object) || {};
    const email = (notary && notary.email) || obj.customer_email || obj.email || null;
    const refId =
      (notary && notary.id) || (obj.metadata && obj.metadata.notaryId) || (event && event.id) || 'account';
    const results = [];

    async function toNotary(kind, tmpl) {
      results.push(
        await sendOnce({
          refId,
          kind,
          to: email,
          buildTemplate: (env) => tmpl({ email, ...env }),
        })
      );
    }
    async function toOperator(kind, tmpl, extra) {
      if (!operatorEmail) return;
      results.push(
        await sendOnce({
          refId,
          kind,
          to: operatorEmail,
          buildTemplate: (env) => tmpl({ ...(extra || {}), ...env }),
        })
      );
    }

    try {
      switch (type) {
        // Connect onboarding cleared — the notary can now take requests and be
        // paid. Welcomed at most once ever (the SENT ledger), so later
        // account.updated deliveries never re-send.
        case 'account.updated':
          if (notary && notary.status === 'active') {
            await toNotary('notaryActive', emails.notaryActive);
            await toOperator('operatorNotaryActive', emails.operatorNotaryActive, {
              notaryEmail: email,
            });
          }
          break;
        // Notary disconnected their payment account from the platform — keep
        // the door open with a win-back (once ever, via the SENT ledger).
        case 'account.application.deauthorized':
          await toNotary('notaryDisconnectedWinback', emails.notaryDisconnectedWinback);
          break;
        // Under the pay-on-accept model, checkout.session.completed is the CLIENT
        // authorizing their offer card (bound in billing.applyEvent). It must NOT
        // trigger a notary subscription welcome/receipt or a "notaire abonné"
        // operator alert — it confirms to the CLIENT that their offer is live.
        case 'checkout.session.completed':
          if (bid && bid.courriel) {
            results.push(
              await sendOnce({
                refId: bid.id,
                kind: 'offerAuthorized',
                to: bid.courriel,
                buildTemplate: (env) => emails.offerAuthorized({ ...bidCtx(bid), ...env }),
              })
            );
          }
          break;
        // The hold lapsed or was cancelled before any notary accepted — the offer
        // silently dropped off the carnet, so tell the client how to come back.
        case 'checkout.session.expired':
        case 'payment_intent.canceled':
          if (bid && bid.courriel) {
            results.push(
              await sendOnce({
                refId: bid.id,
                kind: 'offerAuthorizationVoided',
                to: bid.courriel,
                buildTemplate: (env) => emails.offerAuthorizationVoided({ ...bidCtx(bid), ...env }),
              })
            );
          }
          break;
        // No subscription exists under the commission model, so the legacy
        // invoice.* / customer.subscription.* events are intentionally ignored.
        default:
          break;
      }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
    return { ok: true, results };
  }

  // --- Notary console sign-in (passwordless magic link) ---------------------
  // Fired from POST /notary/session/request (fire-and-forget). Emails the
  // single-use sign-in link on the shared branded template. Unlike every other
  // notifier this bypasses sendOnce: an auth link is TRANSACTIONAL — it must
  // resend on each request (a fresh single-use link every time) and must never
  // be suppressed by an unsubscribe or a dedupe ledger. Best-effort: a mail
  // failure must never break the request response (which stays generic anyway).
  async function onNotaryLoginRequested({ email, link, ttlMinutes } = {}) {
    const to = String(email || '').trim().toLowerCase();
    if (!to || !link) return { ok: true, sent: false };
    try {
      const msg = emails.notaryMagicLink({
        link,
        ttlMinutes,
        baseUrl: base,
        unsubscribeUrl: unsubscribeUrl(to),
      });
      await mailer.send({ to, subject: msg.subject, html: msg.html, text: msg.text });
      return { ok: true, sent: true, to };
    } catch (err) {
      return { ok: false, sent: false, error: String((err && err.message) || err) };
    }
  }

  // Record an opt-out (used by GET /unsubscribe).
  async function unsubscribe(email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean) return { ok: false };
    await repo.putUnsubscribe(clean, clock());
    return { ok: true, email: clean };
  }

  return {
    onOfferCreated,
    onOfferRetained,
    onPartnerRegistered,
    onCounterOfferProposed,
    onDocumentsRequested,
    onCounterOfferAnswered,
    onOfferCancelled,
    onContactMessage,
    onClientSignup,
    onReminderDue,
    onNotaryConnected,
    onNotaryLoginRequested,
    onActPaid,
    onAccountEvent,
    unsubscribe,
    unsubscribeUrl,
  };
}

module.exports = { createNotifier, encodeUnsubToken, decodeUnsubToken };
