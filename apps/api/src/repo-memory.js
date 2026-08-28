'use strict';

const { monthOf, STATS_GAUGE_PK, STATS_GAUGE_SK } = require('./keys');
const { STATUS, normalizeReferralCode } = require('@nota/domain');

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
  const acts = new Map(); // bidId -> completed-act record (idempotency ledger)
  const partners = new Map(); // CODE -> registered referral partner (ADR 0011)
  const referralEarnings = new Map(); // `${CODE}#${TRACK}#${refId}` -> durable earning event

  // Notification ledgers: sent (idempotency) and unsubscribe (suppression).
  const notified = new Map(); // `${refId}#${kind}` -> timestamp
  const unsubscribed = new Set(); // lowercased emails

  // Admin-editable email subject overrides (ADR 0018): one record per template
  // key, mirroring the CONFIG#EMAIL / TPL#<key> partition on the main table.
  const emailOverrides = new Map(); // templateKey -> { key, enabled, subjectFr, subjectEn, updatedAt }

  // Notary console: declines (per notary+bid) and retained pointers (per notary).
  const declines = new Set(); // `${notaryId}#${bidId}`
  const retained = new Map(); // `${notaryId}#${bidId}` -> { id, dateISO, serviceId, montant }

  // The notary's anonymized evaluation ledger (ADR 0021), mirroring the
  // NOTARY#<id> / EVAL#<createdAt>#<bidId> items on the main table.
  const notaryEvals = new Map(); // notaryId -> [{ bidId, dateISO, serviceId, note, commentaire, createdAt }]

  // The admin-decided commission barème (ADR 0021), mirroring the single
  // CONFIG#COMMISSION / BAREME item. Null until Nota stores one.
  let commissionCfg = null;

  // The admin-decided cancellation fee barème (ADR 0023), mirroring the single
  // CONFIG#ANNULATION / BAREME item. Null until Nota stores one.
  let cancellationCfg = null;

  // Notary magic-link login: single-use challenges (main table) and a per-IP
  // login rate-limit counter, kept apart from the admin equivalents above so an
  // admin and a notary challenge can never be confused.
  const notaryChallenges = new Map(); // challengeId -> record
  const notaryRateCounters = new Map(); // `${scope}#${key}#${windowStart}` -> count

  // Partner code claim (email verification): single-use claim challenges and a
  // per-IP request rate-limit counter — kept apart from the notary equivalents
  // so a notary and a partner challenge can never be confused (ADR 0011).
  const partnerClaims = new Map(); // challengeId -> pending claim record
  const partnerRateCounters = new Map(); // `${scope}#${key}#${windowStart}` -> count

  // Analytics rollups (STATS#): counter items keyed by `${pk}\x00${sk}`.
  const stats = new Map();
  const statKey = (pk, sk) => `${pk}\x00${sk}`;

  // Admin table: identities, single-use login challenges, revocable sessions,
  // the append-only audit log, and rate-limit counters.
  const admins = new Map(); // adminId -> profile
  const challenges = new Map(); // challengeId -> record
  const sessions = new Map(); // sessionId -> record
  const audit = []; // { id, ts, action, adminId, email, ip, meta }
  const rateCounters = new Map(); // `${scope}#${key}#${windowStart}` -> count

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
    // General overwrite of a mutated bid (propositions, demandes, dossier).
    // Same full-item semantics as put(); kept as its own method so the
    // handler's intent reads clearly. LIMITATION: last-writer-wins — two
    // notaries proposing on the same bid at the same instant could drop one
    // proposition. Retention itself stays on the conditional retain().
    async update(bid) {
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
    // Every open bid across all months — the reminder scheduler asks the
    // domain which of these are due for a reminder today. Open means neither
    // retained NOR cancelled (domain.isOpenBid): the dynamo adapter serves the
    // same set from a sparse GSI1 Query that drops both, and a cancelled offer
    // must never reach the notary digest; here it is a filter.
    async listOpenBids() {
      return [...byId.values()].filter((b) => b.status !== STATUS.RETENUE && b.status !== STATUS.ANNULEE);
    },

    // --- Pay-on-accept authorization ----------------------------------------
    // The Stripe webhook binds the client's authorized PaymentIntent to the bid
    // (offer goes live), or voids the hold if the authorization lapsed before any
    // notary accepted. `dateISO` matches the dynamo composite-key signature.
    async authorizeBid(bidId, dateISO, patch) {
      void dateISO;
      const b = byId.get(bidId);
      if (!b) return null;
      const updated = {
        ...b,
        paymentStatus: 'authorized',
        paymentIntentId: (patch && patch.paymentIntentId) || b.paymentIntentId || null,
        authorizedAt: (patch && patch.authorizedAt) || b.authorizedAt || null,
      };
      byId.set(bidId, updated);
      return updated;
    },
    async voidBidAuthorization(bidId, dateISO, patch) {
      void dateISO;
      const b = byId.get(bidId);
      if (!b) return null;
      // Never void a RETAINED bid: after a proposition accept the ORIGINAL hold
      // is canceled (or expires), and Stripe's payment_intent.canceled webhook
      // must not flip the live mise en relation to 'void' and hide it.
      if (b.status === STATUS.RETENUE) return null;
      const updated = { ...b, paymentStatus: 'void', voidedAt: (patch && patch.voidedAt) || null };
      byId.set(bidId, updated);
      return updated;
    },

    // --- Billing (notary subscriptions + webhook idempotency) ---------------
    // Completed-act ledger: write-once, so a re-submitted completion is a no-op
    // (mirrors the DynamoDB attribute_not_exists(PK) guard). markActCompleted
    // returns true only on the FIRST write; getActCompletion returns the record.
    async markActCompleted(bidId, record) {
      if (acts.has(bidId)) return false;
      acts.set(bidId, { ...record });
      return true;
    },
    async getActCompletion(bidId) {
      const a = acts.get(bidId);
      return a ? { ...a } : null;
    },

    // --- Partner referral registry (ADR 0011) -------------------------------
    // One record per NORMALIZED code; write-once, so claiming a taken code
    // returns false (mirrors the DynamoDB attribute_not_exists(PK) guard) and
    // the handler decides between "same owner, idempotent" and 409.
    async createPartner(partner) {
      const code = String(partner.code).trim().toUpperCase();
      if (partners.has(code)) return false;
      partners.set(code, { ...partner, code });
      return true;
    },
    async getPartner(code) {
      const p = partners.get(String(code).trim().toUpperCase());
      return p ? { ...p } : null;
    },
    // Every CLAIMED code, for the admin ledger — a partner with zero referrals
    // is still a row the operator must see. The dynamo adapter serves the same
    // set from the sparse PARTNER GSI1 overload; here it is the whole map.
    async listPartners() {
      return [...partners.values()]
        .map((p) => ({ ...p }))
        .sort((a, b) => a.code.localeCompare(b.code));
    },
    // Durable referral earnings (ADR 0011): the money owed is recorded at EVENT
    // time (the retain), write-once per (code, track, ref) — the key IS the
    // idempotency, mirroring the DynamoDB attribute_not_exists guard. Returns
    // true only on the FIRST write, so the caller knows a replay earned nothing.
    async recordReferralEarning({ code, track, refId, montant, at } = {}) {
      const clean = normalizeReferralCode(code);
      const key = `${clean}#${String(track).toUpperCase()}#${refId}`;
      if (referralEarnings.has(key)) return false;
      referralEarnings.set(key, { code: clean, track, refId, montant, at });
      return true;
    },
    // All earnings ever recorded — the ledger's durable truth. Bounded by the
    // number of real-money events, never a table walk (sparse GSI1 in dynamo).
    async listReferralEarnings() {
      return [...referralEarnings.values()]
        .map((e) => ({ ...e }))
        .sort((a, b) => a.code.localeCompare(b.code) || String(a.refId).localeCompare(String(b.refId)));
    },
    async putNotary(notary) {
      byNotary.set(notary.id, { ...notary });
      return notary;
    },
    // Mirrors the Dynamo sparse-GSI1 read: only ACTIVE notaries are enumerable.
    async listActiveNotaries() {
      return [...byNotary.values()].filter((n) => n.status === 'active').map((n) => ({ ...n }));
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

    // --- Admin-editable email subject overrides (ADR 0018) -------------------
    // Same normalization contract as the dynamo adapter: empty-string subjects
    // are stored as null (the consumption side treats a half-configured pair as
    // not configured), `enabled` is a real boolean, and updatedAt is stamped by
    // the caller-supplied clock — never Date.now().
    async getEmailOverride(key) {
      const o = emailOverrides.get(String(key));
      return o ? { ...o } : null;
    },
    async putEmailOverride(override, nowISO) {
      const subj = (v) => {
        const s = typeof v === 'string' ? v.trim() : '';
        return s || null;
      };
      const stored = {
        key: String(override.key),
        enabled: override.enabled !== false,
        subjectFr: subj(override.subjectFr),
        subjectEn: subj(override.subjectEn),
        updatedAt: nowISO,
      };
      emailOverrides.set(stored.key, stored);
      return { ...stored };
    },
    async deleteEmailOverride(key) {
      emailOverrides.delete(String(key));
    },
    async listEmailOverrides() {
      return [...emailOverrides.values()]
        .map((o) => ({ ...o }))
        .sort((a, b) => a.key.localeCompare(b.key));
    },

    // --- Admin-decided commission barème (ADR 0021) --------------------------
    // Same contract as the dynamo adapter: one record, updatedAt stamped by the
    // caller-supplied clock, absent reads as null (billing then falls back to
    // the environment defaults).
    async getCommissionConfig() {
      return commissionCfg ? { ...commissionCfg, paliers: commissionCfg.paliers.map((p) => ({ ...p })) } : null;
    },
    async putCommissionConfig(cfg, nowISO) {
      commissionCfg = {
        taux: cfg.taux,
        plancher: cfg.plancher,
        paliers: (cfg.paliers || []).map((p) => ({ ...p })),
        updatedAt: nowISO,
      };
      return { ...commissionCfg, paliers: commissionCfg.paliers.map((p) => ({ ...p })) };
    },
    async deleteCommissionConfig() {
      commissionCfg = null;
    },

    // --- Admin-decided cancellation fee barème (ADR 0023) --------------------
    // Same contract as the dynamo adapter: one record, updatedAt stamped by the
    // caller-supplied clock, absent reads as null (the cancel route then falls
    // back to the environment defaults).
    async getCancellationConfig() {
      return cancellationCfg ? { ...cancellationCfg, paliers: cancellationCfg.paliers.map((p) => ({ ...p })) } : null;
    },
    async putCancellationConfig(cfg, nowISO) {
      cancellationCfg = {
        paliers: (cfg.paliers || []).map((p) => ({ ...p })),
        updatedAt: nowISO,
      };
      return { ...cancellationCfg, paliers: cancellationCfg.paliers.map((p) => ({ ...p })) };
    },
    async deleteCancellationConfig() {
      cancellationCfg = null;
    },

    // --- Notary evaluation ledger (ADR 0021) ---------------------------------
    async addNotaryEvaluation(notaryId, evaluation) {
      const list = notaryEvals.get(notaryId) || [];
      list.push({ ...evaluation });
      notaryEvals.set(notaryId, list);
    },
    // Newest first — the dynamo Query walks the EVAL# range backwards.
    async listNotaryEvaluations(notaryId) {
      return (notaryEvals.get(notaryId) || [])
        .map((e) => ({ ...e }))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.bidId).localeCompare(String(a.bidId)));
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
    // A client cancelled a retained bid: the signing no longer exists, so the
    // pointer leaves the notary's calendar feed with it.
    async removeRetained(notaryId, event) {
      retained.delete(`${notaryId}#${event.id}`);
    },
    async listRetainedByNotary(notaryId) {
      return [...retained.entries()]
        .filter(([k]) => k.startsWith(`${notaryId}#`))
        .map(([, v]) => v)
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || String(a.id).localeCompare(String(b.id)));
    },

    // --- Notary magic-link login (single-use challenges + rate limit) -------
    // Symmetric with the admin login challenge, but on the MAIN table (see
    // keys.js): the public API Lambda cannot reach the admin table, so the
    // notary console keeps its own challenge/rate-limit records here.
    async putNotaryLoginChallenge(challenge) {
      notaryChallenges.set(challenge.challengeId, { ...challenge });
    },
    // Atomic single-use consume: return the challenge only if it exists, is
    // unconsumed and unexpired; flip it consumed so a replay gets null.
    async consumeNotaryLoginChallenge(challengeId, nowMs) {
      const c = notaryChallenges.get(challengeId);
      if (!c || c.consumed) return null;
      if (typeof nowMs === 'number' && nowMs >= Number(c.expiresAt)) return null;
      c.consumed = true;
      notaryChallenges.set(challengeId, c);
      return { ...c };
    },
    // Fixed-window counter, same shape as incrRateCounter but on its own map so a
    // notary login attempt never shares a window with an admin one.
    async incrNotaryRateCounter(scope, key, windowSec, nowMs) {
      const windowStart = Math.floor(nowMs / 1000 / windowSec);
      const k = `${scope}#${String(key).toLowerCase()}#${windowStart}`;
      const count = (notaryRateCounters.get(k) || 0) + 1;
      notaryRateCounters.set(k, count);
      return count;
    },

    // --- Partner code claim (email verification, ADR 0011 fraud-hardening) ---
    // The two-step claim's single-use challenge + per-IP rate limit. Symmetric
    // with the notary login above (own maps, so a notary and a partner challenge
    // never share state), mirroring the DynamoDB conditional-consume + TTL.
    async putPartnerClaim(claim) {
      partnerClaims.set(claim.challengeId, { ...claim });
    },
    // Atomic single-use consume: return the claim only if it exists, is
    // unconsumed and unexpired; flip it consumed so a replay gets null.
    async consumePartnerClaim(challengeId, nowMs) {
      const c = partnerClaims.get(challengeId);
      if (!c || c.consumed) return null;
      if (typeof nowMs === 'number' && nowMs >= Number(c.expiresAt)) return null;
      c.consumed = true;
      partnerClaims.set(challengeId, c);
      return { ...c };
    },
    // Fixed-window per-IP counter for the claim request, on its own map.
    async incrPartnerRateCounter(scope, key, windowSec, nowMs) {
      const windowStart = Math.floor(nowMs / 1000 / windowSec);
      const k = `${scope}#${String(key).toLowerCase()}#${windowStart}`;
      const count = (partnerRateCounters.get(k) || 0) + 1;
      partnerRateCounters.set(k, count);
      return count;
    },

    // --- Analytics rollups (STATS#) -----------------------------------------
    // Atomic ADD semantics: each delta bumps counters on its (pk, sk) item,
    // mirroring DynamoDB's `UpdateItem ... ADD` (create-if-absent, then add).
    async applyStatsDeltas(deltas) {
      for (const d of deltas || []) {
        const key = statKey(d.pk, d.sk);
        const item = stats.get(key) || { pk: d.pk, sk: d.sk };
        for (const [k, n] of Object.entries(d.adds || {})) {
          item[k] = Number(item[k] || 0) + Number(n || 0);
        }
        stats.set(key, item);
      }
    },
    // Range Query over one STATS# partition: items with skStart <= sk <= skEnd.
    async queryStats(pk, skStart, skEnd) {
      return [...stats.values()]
        .filter((it) => it.pk === pk && it.sk >= skStart && it.sk <= skEnd)
        .sort((a, b) => String(a.sk).localeCompare(String(b.sk)))
        .map((it) => ({ ...it }));
    },
    async getGauge() {
      const it = stats.get(statKey(STATS_GAUGE_PK, STATS_GAUGE_SK));
      return it ? { ...it } : null;
    },

    // --- Admin identities ----------------------------------------------------
    async getAdmin(id) {
      const a = admins.get(id);
      return a ? { ...a } : null;
    },
    async putAdmin(admin) {
      admins.set(admin.id, { ...admin });
      return admin;
    },

    // --- Admin login challenges (single-use magic links) --------------------
    async putLoginChallenge(challenge) {
      challenges.set(challenge.challengeId, { ...challenge });
    },
    // Atomic single-use consume: return the challenge only if it exists, is
    // unconsumed and unexpired; flip it consumed so a replay gets null.
    async consumeLoginChallenge(challengeId, nowMs) {
      const c = challenges.get(challengeId);
      if (!c || c.consumed) return null;
      if (typeof nowMs === 'number' && nowMs >= Number(c.expiresAt)) return null;
      c.consumed = true;
      challenges.set(challengeId, c);
      return { ...c };
    },

    // --- Admin sessions (revocable, server-side) ----------------------------
    async putAdminSession(session) {
      sessions.set(session.sessionId, { ...session });
    },
    async getAdminSession(sessionId) {
      const s = sessions.get(sessionId);
      return s ? { ...s } : null;
    },
    async touchAdminSession(sessionId, lastSeenMs, absoluteExpiresAt) {
      const s = sessions.get(sessionId);
      if (!s) return;
      s.lastSeenAt = lastSeenMs;
      if (typeof absoluteExpiresAt === 'number') s.absoluteExpiresAt = absoluteExpiresAt;
      sessions.set(sessionId, s);
    },
    async revokeAdminSession(sessionId, at) {
      const s = sessions.get(sessionId);
      if (!s) return;
      s.revokedAt = at || true;
      sessions.set(sessionId, s);
    },

    // --- Audit log (append-only) --------------------------------------------
    async appendAudit(entry) {
      audit.push({ ...entry, day: String(entry.ts || '').slice(0, 10) });
    },
    async queryAuditByDay(dayISO) {
      return audit.filter((e) => e.day === dayISO).map((e) => ({ ...e }));
    },

    // --- Rate limiting -------------------------------------------------------
    // Fixed-window counter: increments the count for the window `nowMs` falls in
    // and returns the running total, like a DynamoDB ADD with a TTL per window.
    async incrRateCounter(scope, key, windowSec, nowMs) {
      const windowStart = Math.floor(nowMs / 1000 / windowSec);
      const k = `${scope}#${String(key).toLowerCase()}#${windowStart}`;
      const count = (rateCounters.get(k) || 0) + 1;
      rateCounters.set(k, count);
      return count;
    },

    async _all() {
      return [...byId.values()];
    },
  };
}

module.exports = { createMemoryRepo };
