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

// --- Analytics rollups (STATS#) ----------------------------------------------
// Admin analytics are computed WITHOUT a Scan (the API role deliberately lacks
// it). Marketplace history is folded into rollup items on the SAME main table
// as it happens: each fact (a bid posted, a retain, an act completed) does an
// atomic UpdateItem ADD on a small counter item, so concurrent writers never
// race and there is never a read-modify-write. The admin reads them back with
// bounded range Queries:
//
//   PK = STATS#GLOBAL          SK = D#YYYY-MM-DD  (a day's counters: offers,
//                                                  retenues, actes, commission¢)
//   PK = STATS#SVC#<serviceId> SK = D#YYYY-MM-DD  (the same, per service)
//   PK = STATS#GAUGE           SK = GAUGE         (present-tense running totals:
//                                                  notaires actifs / en intégration)
//
// Writes are best-effort in the public Lambda — a rollup failure must never
// break a bid/retain/act — so counters can drift on partial failure; a later
// reconcile pass (admin phase 4) heals them from the source MONTH# partitions.
// Write-sharding for the hot day counters. Every marketplace write ADDs to ONE
// of STATS_SHARDS shard partitions (chosen at random per fact), so no single
// item absorbs the whole write rate — a DynamoDB item caps at ~1000 WCU/s and
// on-demand adaptive capacity cannot split a single item. The admin read sums
// all shards (K small range Queries, on the rare dashboard load). K is a fixed
// structural constant so the read and write sides never skew; raising it needs a
// reconcile of historical shards.
const STATS_SHARDS = 10;
function shardIndex(shard) {
  const k = STATS_SHARDS;
  return ((Number(shard) % k) + k) % k;
}
function statsGlobalPK(shard) {
  return 'STATS#GLOBAL#' + shardIndex(shard);
}
function statsServicePK(serviceId, shard) {
  return 'STATS#SVC#' + String(serviceId) + '#' + shardIndex(shard);
}
function statsDaySK(dateISO) {
  return 'D#' + String(dateISO).slice(0, 10);
}
const STATS_DAY_PREFIX = 'D#';
const STATS_GAUGE_PK = 'STATS#GAUGE';
const STATS_GAUGE_SK = 'GAUGE';

// Completed-act ledger (idempotency): one write-once item per retained act, so
// re-submitting the same completion never double-charges or double-counts.
//   PK = ACT#<bidId>   SK = ACT
function actPK(bidId) {
  return 'ACT#' + String(bidId);
}
const ACT_SK = 'ACT';

// --- Admin table (admin.nota.ca) ---------------------------------------------
// Identity, revocable sessions, single-use magic-link challenges, the immutable
// audit log and rate-limit counters live in a SEPARATE `nota-admin` table, so
// the admin surface can never read or write customer data and its blast radius
// is isolated (Law 25). Same single-table prefix design, distinct table.
//
//   PK = ADMIN#<adminId>     SK = PROFILE            (an admin's identity + role)
//   PK = LOGIN#<challengeId> SK = LOGIN              (a single-use magic link; TTL)
//   PK = SESSION#<sessionId> SK = SESSION            (a revocable session; TTL)
//   PK = AUDIT#<YYYY-MM-DD>  SK = <isoTs>#<id>       (append-only action log)
//   PK = RL#<scope>#<key>    SK = RL                 (a rate-limit counter; TTL)
function adminPK(adminId) {
  return 'ADMIN#' + String(adminId);
}
const ADMIN_SK = 'PROFILE';

function adminLoginPK(challengeId) {
  return 'LOGIN#' + String(challengeId);
}
const ADMIN_LOGIN_SK = 'LOGIN';

function adminSessionPK(sessionId) {
  return 'SESSION#' + String(sessionId);
}
const ADMIN_SESSION_SK = 'SESSION';

function auditPK(dayISO) {
  return 'AUDIT#' + String(dayISO).slice(0, 10);
}
function auditSK(isoTs, id) {
  return String(isoTs) + '#' + String(id);
}

function adminRlPK(scope, key) {
  return `RL#${scope}#${String(key).trim().toLowerCase()}`;
}
const ADMIN_RL_SK = 'RL';

// Reserved for admin phase 2 notary/act enumeration (a sparse GSI1 over PROFILE
// + ACT# items). Named here so the key shape is declared in one place; the GSI
// itself is not created on the live table until phase 2.
const GSI1_PK = 'GSI1PK';
const GSI1_SK = 'GSI1SK';

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
  // analytics rollups (write-sharded day counters)
  STATS_SHARDS,
  statsGlobalPK,
  statsServicePK,
  statsDaySK,
  STATS_DAY_PREFIX,
  STATS_GAUGE_PK,
  STATS_GAUGE_SK,
  // admin table
  adminPK,
  ADMIN_SK,
  adminLoginPK,
  ADMIN_LOGIN_SK,
  adminSessionPK,
  ADMIN_SESSION_SK,
  auditPK,
  auditSK,
  adminRlPK,
  ADMIN_RL_SK,
  GSI1_PK,
  GSI1_SK,
};
