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
    if (!bid || !bid.courriel) return { ok: true, results: [] };
    try {
      const r = await sendOnce({
        refId: bid.id,
        kind: 'offerRetained',
        to: bid.courriel,
        buildTemplate: (env) => emails.offerRetained({ ...bidCtx(bid), ...env }),
      });
      return { ok: true, results: [r] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
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

  // --- Account lifecycle (notary + operator, commission model) --------------
  // Driven from the Stripe webhook route with the verified event + affected
  // notary. Switches on event type; unknown types produce nothing.
  async function onAccountEvent(event, notary) {
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
        // Under the pay-on-accept COMMISSION model there are no notary subscription
        // checkouts: checkout.session.completed is the CLIENT authorizing their offer
        // card (bound in billing.applyEvent). It must NOT trigger a notary
        // welcome or a "notaire actif" operator alert.
        // Connect onboarding complete — the account can accept charges. Stripe
        // redelivers account.updated on every account change; sendOnce's
        // (refId, kind) ledger keeps the welcome to exactly one per notary.
        case 'account.updated':
          if (obj.charges_enabled) {
            await toNotary('notaryAccountActive', emails.notaryAccountActive);
            await toOperator('operatorNotaryActive', emails.operatorNotaryActive, {
              notaryEmail: email,
            });
          }
          break;
        // Notary disconnected their payment account from the platform.
        case 'account.application.deauthorized':
          await toNotary('notaryDisconnectedWinback', emails.notaryDisconnectedWinback);
          break;
        default:
          break;
      }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
    return { ok: true, results };
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
    onClientSignup,
    onReminderDue,
    onAccountEvent,
    unsubscribe,
    unsubscribeUrl,
  };
}

module.exports = { createNotifier, encodeUnsubToken, decodeUnsubToken };
