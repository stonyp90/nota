# 7. Email notifications and reminders (SES + EventBridge Scheduler)

- Status: Accepted
- Date: 2026-08-12

## Context

Nota's revenue depends on two conversions: turning a posted offer into a
*sellable* lead (a completed dossier a notary can retain), and keeping notaries
subscribed. Both are driven by timely email:

- A client who posts an offer but never finishes their dossier is not sellable.
  The single biggest lever is nudging them to complete it, then reminding them as
  the signing date approaches (urgency is the whole point of the marketplace).
- A notary whose card fails, or whose subscription lapses, is churn we can often
  recover with a well-timed dunning / win-back email.

We need an outbound-email capability and a daily reminder job that fit the
existing hexagonal shape of `apps/api` (ports/adapters, no framework, tests with
no network), and that comply with Canadian law:

- **CASL** (Canada's Anti-Spam Legislation): every commercial email needs clear
  sender identification (name + mailing address), a working unsubscribe
  mechanism, and consent. Transactional messages (offer confirmation, receipt,
  acceptance) are exempt from some consent rules but we still carry sender ID +
  unsubscribe on all of them.
- **Law 25** (Québec): personal data (the client's email) stays in Canada and is
  collected with a clear, single purpose.

## Decision

**Send through Amazon SES v2 behind a mailer port; run the reminder cadence as a
daily EventBridge Scheduler → Lambda; encode the schedule as a domain rule.**

- **Mailer port (`notify-port.js`).** `createSesAdapter({ from, region })`
  exposes a single `send({ to, subject, html, text })` and lazy-requires
  `@aws-sdk/client-sesv2` inside the factory — exactly like `stripe-port.js` and
  `repo-dynamo.js`. Tests inject `createFakeMailer()`, which captures messages in
  memory, so the suite stays offline and SDK-free.
- **Templates (`emails.js`).** fr-CA, conversion-optimized, presentation only.
  Each returns `{ subject, html, text }` with a short specific subject, hidden
  preheader, ONE primary CTA, mobile-friendly inline-CSS HTML, a plain-text
  alternative, and a CASL footer (sender identification + a working unsubscribe
  link) on **every** message. Copy is personalized with the service, date,
  amount and — for the date-approaching nudge — the timing tier.
- **Notifier use-case (`notifications.js`).** `createNotifier({ repo, mailer,
  baseUrl, operatorEmail })` picks the right template for a lifecycle event and
  enforces two invariants before every send: (1) **consent** — a suppressed
  (unsubscribed) address is never mailed; (2) **idempotency** — a given
  `(refId, kind)` is mailed at most once, recorded in a `SENT#<refId>#<kind>`
  ledger item, so re-runs and webhook redeliveries never double-send.
- **Reminder cadence is a DOMAIN rule.** `@nota/domain` owns `REMINDER_OFFSETS =
  [7, 3, 1]` and `dueReminders(bid, todayISO)`, which returns the kinds due for a
  bid today (`j7`/`j3`/`j1`, plus a `dossier_incomplet` hook). It is pure and
  deterministic, never fires for a retained or past-dated bid, and is asserted by
  domain tests. The API scheduler encodes no schedule of its own — it just asks
  the domain.
- **Daily scheduler.** `apps/api/reminders.js` is a second Lambda handler
  (reusing the same code bundle) that scans open bids, computes `dueReminders`
  for today, and sends idempotently. An EventBridge **Scheduler** fires it once a
  day at ~13:00 UTC (≈ 09:00 in Québec). IAM is least-privilege: `ses:SendEmail`
  (scoped by From address) and DynamoDB read/write on the single table only.
- **Transactional vs lifecycle.** Offer confirmation, subscription receipt and
  acceptance are transactional (sent on an action the user took). Date-approaching
  nudges, the weekly notary digest, dunning and win-back are lifecycle/marketing.
  Both classes carry sender ID + unsubscribe; only lifecycle sends are throttled
  by the cadence and suppression rules — but all respect the opt-out.
- **Private client email.** `courriel` is an OPTIONAL field on an offer, stored
  server-side and **never** included in the public `publicBid()` projection (an
  API test asserts it does not leak). `validateOffer` lightly checks the format
  when present.
- **Wiring.** `onOfferCreated` is fired fire-and-forget from `POST /bids` (a mail
  failure never breaks the response); `onSubscription` is fired from the verified
  Stripe webhook path. Notifications are DISABLED unless `NOTA_FROM_EMAIL` is
  configured, so the stack runs fully without SES.
- **Unsubscribe endpoint.** `GET /unsubscribe?token=...` decodes the recipient
  address (base64url) from the footer link and records an `UNSUB#<email>` opt-out,
  returning a small fr-CA confirmation page. Idempotent.

### Lifecycle emails implemented

- **Client:** `offerPublished`, `dossierIncomplete`, `dateApproaching` (7/3/1,
  tier-aware), `offerRetained`, `dateMissedNoUptake`.
- **Notary:** `newMatchingBids` (digest), `subWelcome`, `subReceipt`,
  `subRenewalReminder`, `subPaymentFailed` (dunning), `subCanceledWinback`.
- **Operator (Nota):** `operatorNotarySubscribed`, `operatorNewLead`.

## Consequences

- **Positive:** compliant by construction (sender ID + unsubscribe on every
  template, opt-out checked before every send, consent respected); the mailer
  boundary keeps tests offline and SDK-free; the cadence lives in the domain and
  is unit-tested at the 7/3/1 boundaries; idempotent by a SENT ledger, so
  redeliveries and re-runs are safe; notifications degrade gracefully (disabled
  without `NOTA_FROM_EMAIL`, and any send failure is swallowed rather than
  breaking a request).
- **Negative / trade-offs:** SES availability and deliverability become a
  dependency; the reminder Lambda uses a DynamoDB `Scan` (bounded, once daily,
  acceptable at this scale — revisit with a GSI if the table grows large); a
  second Lambda + Scheduler is more moving parts.
- **SES SANDBOX CAVEAT:** a new SES account/region starts in the **sandbox** —
  you may only send to **verified** addresses at a low rate. Going live requires
  (1) verifying a sending **domain** with DKIM and (2) requesting **production
  access** (sandbox exit) from AWS Support. Terraform creates the identity but
  never exits the sandbox; until you do, verify each test recipient. SES runs in
  `ca-central-1` for Law 25 data residency, like the rest of the stack.
- **Manual go-live steps:** set `TF_VAR_from_email`, `TF_VAR_operator_email` and
  `TF_VAR_base_url`; confirm the SES identity verification email (or verify the
  domain); request the sandbox exit; then `terraform apply`.
