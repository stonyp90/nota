# 2. Single-table DynamoDB, partitioned by month

- Status: Accepted
- Date: 2026-08-12

## Context

The core read of the product is the public *carnet*: a calendar for a given
month showing every posted bid on every day. The dominant access pattern is
therefore "**give me all bids for month `YYYY-MM`**". Writes are single bids
appended as clients post offers.

Nota runs scale-to-zero serverless (Lambda + DynamoDB PAY_PER_REQUEST) with a
goal of near-$0 idle cost and data residency in `ca-central-1`. We wanted a data
layer that matches that: no idle capacity, no relational server, and a read path
that costs one query per month displayed.

## Decision

Use a **single DynamoDB table** with a composite key designed so the calendar
reads exactly one partition per month:

```
PK = MONTH#YYYY-MM          all bids for that month (one Query, one partition)
SK = BID#YYYY-MM-DD#<id>    sorts naturally by day, then by id, within the month
```

`GET /bids?month=YYYY-MM` becomes a single `Query` on `PK = MONTH#<month>`.
Posting a bid is a single `PutItem`. The key helpers live in
`apps/api/src/keys.js` (`bidPK`, `bidSK`, `monthPK`, `monthOf`) so key
construction is defined once and never string-built at call sites.

The table is `PAY_PER_REQUEST` with point-in-time recovery, `PK`/`SK` string
keys, and no secondary indexes for the current access patterns.

## Consequences

- **Positive:** the primary read is one query against one partition — cheap,
  fast, and predictable; no joins, no scans; billing scales to zero when idle;
  the schema is a natural fit for the calendar UI.
- **Reserved for growth:** a future notary console adds `SUB#<notaryId>` and
  `DOSSIER#<bidId>` items **in the same table** (keys already reserved in
  `keys.js`). Single-table design keeps those related entities co-located and
  transactionally writable.
- **Negative / trade-offs:** a single month is a single partition, so a
  pathologically hot month concentrates traffic on one partition key — acceptable
  at Nota's scale (one city, notarial acts), revisit with a write-sharding
  suffix if a month ever exceeds partition throughput. Cross-month or
  cross-service analytical queries are not served by the primary key and would
  need a GSI or an export; that is out of scope for the marketplace read path.
- **Non-key access** (e.g. "all bids for a service across months") is
  intentionally unsupported for now; add a GSI only when a real feature needs it.
