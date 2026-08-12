'use strict';

/**
 * Single-table key design.
 *
 * Partition by month so the public calendar reads exactly one partition per
 * month it displays:
 *
 *   PK = MONTH#YYYY-MM        (all bids that month, one Query)
 *   SK = BID#YYYY-MM-DD#<id>  (sorted by day then id within the partition)
 *
 * A future notary console adds SUB#<notaryId> and DOSSIER#<bidId> items in the
 * same table; those keys are reserved here but unused until continue-prompt #3.
 *
 * Billing adds two more item shapes in the same single table:
 *
 *   PK = NOTARY#<id>          SK = PROFILE   (a notary's subscription profile)
 *   PK = EVENT#<stripeId>     SK = EVENT     (a processed webhook event, for
 *                                             idempotent delivery)
 *
 * Notifications add two more item shapes in the same single table:
 *
 *   PK = SENT#<refId>#<kind>  SK = SENT      (one notification/reminder already
 *                                             sent — the idempotency ledger so a
 *                                             kind is never sent twice)
 *   PK = UNSUB#<email>        SK = UNSUB     (a recorded CASL/Law-25 opt-out; the
 *                                             sender checks it before every send)
 */

function monthOf(dateISO) {
  return String(dateISO).slice(0, 7);
}

function bidPK(dateISO) {
  return 'MONTH#' + monthOf(dateISO);
}

function bidSK(bid) {
  return `BID#${bid.dateISO}#${bid.id}`;
}

function monthPK(month) {
  return 'MONTH#' + month;
}

// Notary subscription profile.
function notaryPK(id) {
  return 'NOTARY#' + id;
}
const NOTARY_SK = 'PROFILE';

// Processed webhook event (idempotency ledger).
function eventPK(stripeEventId) {
  return 'EVENT#' + stripeEventId;
}
const EVENT_SK = 'EVENT';

// Sent-notification ledger: one item per (bid|subscription id, kind) already
// mailed, so a reminder/notification is never sent twice.
function sentPK(refId, kind) {
  return `SENT#${refId}#${kind}`;
}
const SENT_SK = 'SENT';

// Recorded opt-out. Email is lowercased so lookups are case-insensitive.
function unsubPK(email) {
  return 'UNSUB#' + String(email).trim().toLowerCase();
}
const UNSUB_SK = 'UNSUB';

// --- Notary console -----------------------------------------------------------
// A notary declining a bid: a single marker item looked up by GetItem, so a
// declined bid drops out of that notary's list without a Scan.
//
//   PK = DECLINE#<notaryId>#<bidId>   SK = DECLINE
//
// A notary retaining (accepting) a bid: a pointer item under the notary's own
// partition, so their calendar feed is one Query (begins_with) — no Scan, which
// the API Lambda role deliberately lacks (Get/Put/Query only, see infra).
//
//   PK = NOTARY#<notaryId>   SK = RETAINED#<dateISO>#<bidId>
function declinePK(notaryId, bidId) {
  return `DECLINE#${notaryId}#${bidId}`;
}
const DECLINE_SK = 'DECLINE';

function retainedSK(dateISO, bidId) {
  return `RETAINED#${dateISO}#${bidId}`;
}
const RETAINED_PREFIX = 'RETAINED#';

module.exports = {
  monthOf,
  bidPK,
  bidSK,
  monthPK,
  notaryPK,
  NOTARY_SK,
  eventPK,
  EVENT_SK,
  sentPK,
  SENT_SK,
  unsubPK,
  UNSUB_SK,
  declinePK,
  DECLINE_SK,
  retainedSK,
  RETAINED_PREFIX,
};
