# 20. The track record belongs to the notary — every evaluation is theirs to read, and the bonus schedule is Nota's to decide

- Status: Accepted
- Date: 2026-08-27

## Context

Since ADR 0015/0016 a client rates their notary after the signed act, the
one-decimal average surfaces everywhere, and strong ratings lower Nota's
commission by tiers. Two gaps remained (owner, 2026-08-27):

1. The notary only ever sees the aggregate — « ★ 4,5 (12 avis) ». The
   individual evaluations (note, comment, date) reach them once, in a
   fire-and-forget email, and are then buried on BID items the console's
   forward-looking month walk never revisits. A system meant to live over
   time — volume and quality compounding into a track record — needs the
   track record to be readable by the person it belongs to.
2. ADR 0016 called the bonus schedule « configurable », but
   `NOTA_COMMISSION_BONUS_TIERS` and `NOTA_COMMISSION_RATE_FLOOR` were never
   read anywhere: the tiers were hard-coded defaults. The owner's intent is
   that the bonification is *decided by Nota* — an operating lever, not a
   deploy-time constant.

## Decision

1. **Every evaluation is written twice: once on the bid, once to the notary's
   own ledger.** `POST /client/evaluation` now also appends an anonymized
   pointer item under the notary's partition —
   `PK = NOTARY#<id>  SK = EVAL#<createdAt>#<bidId>` — carrying only
   `note`, `commentaire`, `serviceId`, `dateISO` (the act's date) and
   `createdAt`. Never the client's name or courriel: the notary already met
   the client; the *ledger* stays anonymous so a future roster view can too.
   One Query (`begins_with EVAL#`, newest first) lists a notary's whole
   history — no Scan, no month walk. Evaluations submitted before this ADR
   are not backfilled (same stance as the referral ledger, ADR 0011).
2. **`GET /notary/evaluations`** (session-scoped token, like `/notary/bids`)
   returns `{ rating, evaluations: [{ note, commentaire, serviceId, dateISO,
   createdAt }] }`. The console grows a « Vos évaluations » disclosure —
   collapsed by default (ADR 0019's register: settings and history fold, the
   working surface doesn't), the aggregate on the summary, the list fetched
   on first open.
3. **The commission schedule becomes a runtime document, not a constant.**
   One item — `PK = CONFIG#COMMISSION  SK = BAREME` — holds
   `{ taux, plancher, paliers: [{ note, avis, bonus }] }`. Billing resolves,
   at every pricing: stored barème → environment
   (`NOTA_COMMISSION_RATE` / `NOTA_COMMISSION_BONUS_TIERS` /
   `NOTA_COMMISSION_RATE_FLOOR`, now actually read — the ADR 0016 gap) →
   built-in defaults. `commissionFor` and both settlement paths price from
   the resolved barème, so an admin edit takes effect on the next act with
   no deploy. The write-once ACT# ledger still keeps replays at the amount
   actually charged. The domain remains commission-free (ADR 0008): the
   barème's shape lives in the billing layer (`commission-config.js`).
4. **Nota decides through the admin console.** `GET/PUT/DELETE
   /admin/commission` mirror the email-template door (ADR 0018): GET is open
   to any authenticated admin, writes require `settings:write` (super_admin),
   every change is audit-logged with before/after, and validation is loud —
   rates in (0, 1), floor ≤ rate, each tier a real note (1–5), a positive
   avis count and a positive bonus. The admin Lambda's item-scoped write door
   widens by exactly one partition: `dynamodb:LeadingKeys` gains
   `CONFIG#COMMISSION` beside `CONFIG#EMAIL` (infra/admin.tf). The admin
   console gets a « Commission » page: the barème as Nota sees it, editable
   tier rows, and a reset back to the environment defaults.

## Consequences

- The notary's console now answers « how am I doing, and why » with the
  evaluations themselves — not just the average and the emailed one-liners.
  The comment a client wrote is visible to the notary it rates; the client
  is told nothing new (they always signed their note with their bid).
- A barème edit moves every notary's effective rate at the next settlement.
  The audit log records who moved it and from what; analytics projections
  keep using the base rate and read slightly high, as before.
- The EVAL# ledger double-writes what the BID item already holds. The bid
  stays the source of truth for the client's view; the ledger is the
  notary's read model. They can only diverge if the second write fails —
  the evaluation route treats the ledger write as best-effort, so a lost
  pointer costs a list entry, never the client's 201 or the aggregate.
- `settings:write` is enforced server-side per request; the admin UI merely
  hides the controls from analysts.
