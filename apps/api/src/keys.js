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

module.exports = {
  monthOf,
  bidPK,
  bidSK,
  monthPK,
  notaryPK,
  NOTARY_SK,
  eventPK,
  EVENT_SK,
};
