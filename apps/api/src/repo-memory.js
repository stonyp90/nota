'use strict';

const { monthOf } = require('./keys');

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

  return {
    async listByMonth(month) {
      return [...byId.values()]
        .filter((b) => monthOf(b.dateISO) === month)
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || String(a.id).localeCompare(String(b.id)));
    },
    async get(id) {
      return byId.get(id) || null;
    },
    async put(bid) {
      byId.set(bid.id, bid);
      return bid;
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

    async _all() {
      return [...byId.values()];
    },
  };
}

module.exports = { createMemoryRepo };
