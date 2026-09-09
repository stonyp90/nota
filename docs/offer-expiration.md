# Offer expiration

New offers carry `expiresOn`, an ISO date computed by the domain and persisted
by the API. The last valid day is the earlier of publication plus seven civil
days and the signing date, inclusive, in Quebec's business timezone. Caller
values cannot extend it. Retained acts remain accessible after this deadline.

Open bids without a valid expiration date are unavailable immediately. Listings,
ICS exports, acceptance, counteroffers, document requests, reminders, instant
alerts and scheduled card authorizations respect expiration. Offline demo
storage drops obsolete open bids. The client can publish a new offer; old
expiry dates are never silently renewed.

## Existing hosted records

Deploy the API and web changes, then run the one-time archival sweep using the
actual table name and operator credentials:

```sh
TABLE_NAME=nota-main AWS_REGION=ca-central-1 node apps/api/scripts/expire-legacy-offers.js
TABLE_NAME=nota-main AWS_REGION=ca-central-1 node apps/api/scripts/expire-legacy-offers.js --apply
```

The first command is read-only. The second closes expired or undated open bids
with `status=annulee`, `closureReason=expiration`, removes their open-bid index
entries, and leaves retained/cancelled acts untouched. Conditional writes protect
concurrent acceptance and edits. No client files or financial records are deleted.
Existing retention TTLs remain responsible for eventual record deletion.

The hosted sweep has NOT been executed in this workspace session: AWS rejected
the available credentials with `UnrecognizedClientException`. Deployment has not
been performed either.
