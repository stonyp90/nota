# Calendar readiness — 2026-09-08

## Outlook connection implementation update

The owner registered `Nota Calendar` in Microsoft tenant
`7a915511-d3f5-454c-a915-bff2f9d3aa05`, client ID
`93d6c709-8e5d-4814-9d7e-1a4cd320fed6`. The registration supports
Microsoft 365 and personal Microsoft accounts. Requested delegated permissions
are `Calendars.ReadWrite`, `offline_access`, and `openid`. No tenant-wide consent
or application permission was granted. The registered web redirect is
`https://gonota.ca/api/calendar/outlook/callback`.

The working tree now includes a disabled-by-default notary OAuth connection
port and HTTP endpoints. It uses PKCE S256, encrypted expiring state, an HttpOnly
Secure SameSite=Lax browser-binding cookie, single-use conditional state
consumption, owner-bound AES-256-GCM refresh-token encryption, and conditional
writes preventing callback/disconnect races. Dynamo reads are strongly
consistent. Provider errors and tokens are never returned to the browser.
Disconnect removes stored credentials and invalidates pending authorization.

Enable only once the application and production secret storage are ready:
- `NOTA_OUTLOOK_CLIENT_ID`: the public client ID above.
- `NOTA_OUTLOOK_REDIRECT_URI`: the exact callback above.
- `NOTA_OUTLOOK_CLIENT_SECRET`: server secret, stored in the runtime secret bundle.
- `NOTA_CALENDAR_ENCRYPTION_KEY`: random 32-byte key represented by 64 hex
  characters, stored in the runtime secret bundle. Preserve this key while any
  connection is stored; rotation requires migration or reconnection.

No client secret has been created. AWS SSO profile `aws-prod` still lacks a
session. The connection endpoints are not deployed, and there is deliberately
no customer-facing sync button yet. This is a connection foundation, not a
calendar synchronization release: refresh/reconciliation workers, automatic
moves and actor-correct cancellations, stable booking identities, user-visible
connection controls, Google OAuth clients, and provider acceptance tests remain.
The original audit below describes those remaining requirements.

Validation: 10 focused Outlook tests plus 25 existing contract tests passed.
These use provider stubs, not live Microsoft calendars. No real calendar event
was created, modified or deleted.

## Outcome

**Production bidirectional Google Calendar / Outlook synchronization is not operational or verified.** The repository currently implements ICS subscriptions and one-time calendar links. There are no provider OAuth connections, refresh-token storage, inbound change processing, or calendar reconciliation workers. Exported events cannot write changes back to Nota.

The owner confirmed:

- Production target: `gonota.ca`.
- Both internal customer/notary updates and external Google/Outlook updates are required.
- External moves and deletions should apply automatically, without requesting customer approval.
- Google and Microsoft OAuth applications have not been registered.
- Stripe must pass test mode before live activation.

AWS access was checked again: `aws sts get-caller-identity --profile aws-prod` fails because the SSO token is missing. No deployment, provider configuration, production calendar mutation, email delivery test, or payment was performed in this calendar audit.

## Production read-only checks

At the latest check, `https://gonota.ca/` serves the Nota application from Amazon S3 (HTTP 200), not the earlier holding page. `/api/health` returns JSON with HTTP 200. `/api/carnet/feed.ics` returns `text/calendar` with 19 events. `/api/notary/feed.ics` without a token returns HTTP 401. These are reachability and access-gate checks only; they do not identify the deployed revision or prove an authenticated production booking journey.

## Changes implemented locally

- The private ICS feed now treats retained-calendar pointers only as lookup hints. It verifies current ownership, retained status and date against the authoritative bid before returning an event. Cancelled, released, reassigned, missing and obsolete-date records no longer produce stale events or disclose details to a former notary.
- These ownership checks request strongly consistent DynamoDB reads, avoiding an eventually consistent snapshot after a completed cancellation or reassignment.
- Feed/index read failures return HTTP 503 with `Retry-After: 60` and no-store. They no longer silently produce a successful partial or empty subscription that a calendar client could interpret as deleted appointments. Internal error text is not exposed.
- Duplicate pointers produce one event per bid.
- Acceptance now commits the bid and its retained-calendar pointer in one DynamoDB transaction; the memory adapter mirrors the combined operation. A failed second write can no longer leave a newly accepted booking missing from the calendar. Only a conditional booking failure is classified as a lost race; transaction and storage outages propagate.
- The memory repository's conditional retention now requires `ouverte`, matching DynamoDB. It cannot resurrect a concurrently cancelled offer; this makes local race tests representative of that production condition.
- The two ICS endpoints and their actual limitations are now documented in OpenAPI; the contract drift guard includes them.

## Executable regression coverage

`features/synchronisation-calendriers.feature` adds 12 scenarios / 82 steps through the real handler and domain over the memory repository. It covers publication in the notary view and public calendar, client visibility of acceptance and its email, cancellation, withdrawal and availability to another notary, five stale-pointer cases, outage/recovery, duplicate pointers, and simultaneous acceptance with one winner matching the client's view.

Additional API tests cover index outages, strongly consistent read requests, the DynamoDB adapter option, and cancellation winning before retention. Existing suites cover scoped feed authorization, bilingual rendering, RFC 5545 folding, all-day dates, message exchange, notification preferences and financial cancellation rules.

These tests do **not** call Google, Microsoft, SES or Stripe. A fake mailer proves notification generation, not inbox delivery. Passing them is not evidence that external sync or production billing works.

## Required implementation before external sync can be released

1. Register Google Calendar and Microsoft identity applications under the owner's organizations. Confirm account audience (Google consumer/Workspace; Microsoft personal/work/school), consent, delegated calendar scopes, verified domain and exact HTTPS callback URLs. Restore access to the intended AWS account before deploying. Keep client secrets out of chat, source control, Terraform state, command arguments and logs; store server secrets through a private input channel in Secrets Manager.
2. Add authenticated provider connection/disconnection with single-use OAuth state bound to the Nota user, PKCE, exact redirect validation, token refresh/revocation, encrypted refresh-token storage and restricted IAM. Connect actual product users; an operator's personal calendar connector is not this integration.
3. Give each synchronized appointment a durable identity independent of its date and its current DynamoDB month key. Store provider event ID, calendar/account ownership, provider revision and synchronization state. Preserve old date-based links and customer access across a month change.
4. Define and implement automatic move/delete commands through the same domain and billing paths as Nota changes. A provider edit is untrusted input. Validate dates, ownership, current lifecycle and completed acts; never infer authorization from a title or a supplied bid ID. A notary deleting a signing must follow notary withdrawal rules, not charge the client as if the client cancelled. Decide and represent timed events/time zones, all-day events, recurrence and availability conflicts explicitly; the current offer model stores a date, not an appointment time.
5. Persist booking changes and a synchronization/notification outbox atomically. Process outbound creates/updates/deletions idempotently, record acknowledgements, and avoid echo loops. This audit closes the separate-write gap for new acceptances, but does not implement the external-sync outbox, reconcile historical missing pointers or eliminate the general last-writer-wins limitations of bid updates.
6. Implement Google incremental synchronization, pagination and expired-token full reconciliation. Implement Microsoft Graph calendar-view delta synchronization, pagination and full recovery. Authenticate provider notifications, renew expiring subscriptions, and reconcile on a schedule so missed notifications do not lose changes. Webhooks signal work; fetch authoritative provider state before applying it.
7. Notify both parties in their saved language after a committed change. Retry delivery and provider writes independently without duplicating notifications or payments. Surface connection failures and unresolved synchronization conflicts to the affected user and operator.
8. Run isolated production acceptance tests with designated test customers/notaries and provider accounts, then inspect both actual calendars and both Nota sessions. Measure propagation delay; do not promise instantaneous refresh. Test the same production handlers with Stripe test credentials before enabling live billing.

## External acceptance matrix (not executed)

| Case | Required result |
| --- | --- |
| Publish / accept in Nota | Notary sees the lead; accepted appointment appears in the connected calendars; customer sees the accepting notary |
| Move in Google or Outlook | Nota date/time updates automatically, the other party is notified, and all connected copies converge |
| Delete externally | Correct actor-specific cancellation/withdrawal path; no phantom appointment or inappropriate client cancellation charge |
| Move across month/year, DST, leap day | Stable identity, correct local time/date, working old links and one appointment |
| Duplicate, delayed, out-of-order events | No duplicate appointment, notification or charge; old changes cannot overwrite newer decisions |
| Concurrent client cancellation / notary acceptance / external move | One valid transition with a recoverable conflict, no resurrected cancellation |
| Delete followed by provider echo | No recreation of an intentionally cancelled appointment |
| Missing scope, expired/revoked refresh token | Safe reconnect state, no repeated failures hidden from the user |
| Provider 429/5xx, timeout, missing webhook | Backoff/retry and reconciliation recover without duplicate writes |
| Expired sync cursor / multi-page delta / subscription renewal | Complete reconciliation, including deletions; never drop a page or clear events on a transient failure |
| Malicious webhook or another user's event ID | Rejected without booking changes or private-data disclosure |
| Paid/completed act edited externally | Existing financial lifecycle enforced; no silent duplicate capture, refund or change to a settled act |
| EN/FR recipients, delivery outage | Each recipient gets their language; durable retry with observable failures |

Provider protocol references: [Google incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync), [Microsoft event delta synchronization](https://learn.microsoft.com/en-us/graph/delta-query-events), [Microsoft webhook delivery](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks).

## Local validation results

- Domain: 364 tests passed.
- API: 1,508 tests passed after the atomic-retention change.
- Web: 767 tests passed.
- Admin: 221 tests passed.
- Cucumber: 186 scenarios / 1,069 steps passed, including 12 new calendar scenarios / 82 steps.
- Playwright: all 49 browser journeys passed again after the atomic-retention change.
- Both web and admin production builds passed. OpenAPI contract checks passed within the API suite; `git diff --check` passed.
- Local stack freshness checks passed on all four surfaces. This establishes local source freshness only.

Logs are under `/tmp/nota-calendar-*.log`; provider acceptance remains unexecuted. No finite regression suite proves all possible edge cases or guarantees the absence of future regressions.
