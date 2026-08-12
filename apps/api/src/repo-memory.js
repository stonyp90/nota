'use strict';

const { monthOf } = require('./keys');
const { STATUS } = require('@nota/domain');

/**
 * In-memory implementation of the Repo port. Used by the test suite and by the
 * local dev server when no DynamoDB endpoint is configured. Same interface as
 * repo-dynamo.js — the handler cannot tell them apart.
 */
function createMemoryRepo(seed = []) {
  const byId = new Map();
  for (const b of seed) byId.set(b.id, b);

  // Billing state lives in the same conceptual table (see keys.js): notary
  // subscription profiles keyed by id, and a set of processed webhook event ids
  // for idempotency.
  const byNotary = new Map();
  const events = new Map();

  // Notification ledgers: sent (idempotency) and unsubscribe (suppression).
  const notified = new Map(); // `${refId}#${kind}` -> timestamp
  const unsubscribed = new Set(); // lowercased emails

  // Notary console: declines (per notary+bid) and retained pointers (per notary).
  const declines = new Set(); // `${notaryId}#${bidId}`
  const retained = new Map(); // `${notaryId}#${bidId}` -> { id, dateISO, serviceId, montant }

  return {
    async listByMonth(month) {
      return [...byId.values()]
        .filter((b) => monthOf(b.dateISO) === month)
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || String(a.id).localeCompare(String(b.id)));
    },
    // `dateISO` is accepted (and ignored) so this adapter's signature matches
    // repo-dynamo's `get(id, dateISO)`, which needs it to build the composite key.
    async get(id, dateISO) {
      void dateISO;
      return byId.get(id) || null;
    },
    async put(bid) {
      byId.set(bid.id, bid);
      return bid;
    },
    // Conditional retain: flip a bid to RETENUE for `notaryId` ONLY while it is
    // still OUVERTE, mirroring the DynamoDB ConditionExpression. Returns the
    // stored bid on success, or null if another notary already retained it
    // (the TOCTOU loser). `bid` is the fully-formed retained item.
    async retain(bid, notaryId) {
      void notaryId;
      const current = byId.get(bid.id);
      if (!current || current.status === STATUS.RETENUE) return null;
      byId.set(bid.id, bid);
      return bid;
    },
    // Every open (not-retained) bid across all months — the reminder scheduler
    // asks the domain which of these are due for a reminder today.
    async scanOpenBids() {
      return [...byId.values()].filter((b) => b.status !== STATUS.RETENUE);
    },

    // --- Billing (notary subscriptions + webhook idempotency) ---------------
    async putNotary(notary) {
      byNotary.set(notary.id, { ...notary });
      return notary;
    },
    async getNotary(id) {
      const n = byNotary.get(id);
      return n ? { ...n } : null;
    },
    async markEventProcessed(stripeEventId, at) {
      events.set(stripeEventId, at || true);
    },
    async wasEventProcessed(stripeEventId) {
      return events.has(stripeEventId);
    },

    // --- Notifications (idempotency + unsubscribe suppression) --------------
    async markNotificationSent(refId, kind, at) {
      notified.set(`${refId}#${kind}`, at || true);
    },
    async wasNotificationSent(refId, kind) {
      return notified.has(`${refId}#${kind}`);
    },
    async putUnsubscribe(email, at) {
      unsubscribed.add(String(email).trim().toLowerCase());
      return at || true;
    },
    async isUnsubscribed(email) {
      return unsubscribed.has(String(email).trim().toLowerCase());
    },

    // --- Notary console (declines + retained calendar pointers) -------------
    async putDecline(notaryId, bidId) {
      declines.add(`${notaryId}#${bidId}`);
    },
    async wasDeclined(notaryId, bidId) {
      return declines.has(`${notaryId}#${bidId}`);
    },
    async putRetained(notaryId, event) {
      retained.set(`${notaryId}#${event.id}`, {
        id: event.id,
        dateISO: event.dateISO,
        serviceId: event.serviceId,
        montant: event.montant,
      });
    },
    async listRetainedByNotary(notaryId) {
      return [...retained.entries()]
        .filter(([k]) => k.startsWith(`${notaryId}#`))
        .map(([, v]) => v)
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || String(a.id).localeCompare(String(b.id)));
    },

    async _all() {
      return [...byId.values()];
    },
  };
}

module.exports = { createMemoryRepo };
