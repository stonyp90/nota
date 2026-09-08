# Application audit — 2026-09-08

## Verdict and scope

The local regression suites and browser journeys listed below were executed.
This is not a certification of every possible function or of live production
payments, email delivery, or external calendar synchronization. No deployment,
real charge, external calendar write, or customer email was performed here.

The five-calendar interpretation remains: Nota public carnet, Nota notary
signings, Google Calendar, Outlook, Apple Calendar. The last three currently
consume subscription feeds; a static .ics download is not ongoing sync, and
provider edits do not update Nota. Actual provider refresh and account-level
subscription acceptance still require real-account tests.

## Section-by-section review

| Section | Executed evidence | Boundary |
| --- | --- | --- |
| Welcome/navigation/languages | Intro, language-preferences, no-console-errors E2E; web i18n and navigation tests | Chromium local; other browser engines not executed |
| Public carnet and booking | client-booking E2E; domain validation, API server validation and booking DOM suites | Real local HTTP; memory persistence |
| Partner reference code | Browser booking verifies EVEROY submitted, visible status; referral storage/conversion DOM and API/BDD tests | Reward payments not exercised externally |
| Client profile | Client offer/state, cancellation, messaging and evaluation tests; independent browser sees retained request | Cross-device production login not exercised |
| Notary identity and profile | Sign-in E2E, session scope/replay tests, incomplete-profile guards | Dev magic links; no real notary mailbox/identity verification |
| Direct retention from calendar | Actual public ICS URL opened in a separate browser; sign-in, profile, explicit retain confirmation | Opening a link alone never accepts the request |
| Counter-offer | New browser branch: expand Details, propose suggested higher amount, client accepts, exact new amount verified server-side, retained card and chat | Accept/refuse/replacement and concurrent-accept edges also covered by API/BDD |
| Signings/subscriptions | Feed UID/link/date/scope checks, cancellation removal from both feeds; Google/Outlook/Apple URL checks | No external subscription ingestion, propagation-time or bidirectional test |
| Documents | Dossier/readiness/upload DOM/API tests and browser CSP test | No real production S3 document round trip in this audit |
| Chat/support | Two-browser client/notary exchange; support, receipts, isolation and assistant BDD tests | External assistant availability and inbox delivery not certified |
| Completion/payment/cancellation | Billing, Stripe adapter, caution, cancellation, act-confirmation and BDD suites | Stripe SDK transport simulated; no Stripe test-mode transaction |
| Email and preferences | 58-template French/English registry; captured-mail event, language, opt-out, failure and duplicate tests | Mail generation is not delivery; durable automatic retry is incomplete |
| Administration | 221 admin tests: auth, users, notaries, prices, audiences, campaigns, mail, audit and overview; API contract suites | Admin browser full journey and production IAM not certified |
| Responsive/accessibility/privacy | Browser responsive widths 320–1920, document CSP, booking accessibility and privacy/security tests | Not a full assistive-technology or security penetration audit |

## Corrections made during this review

1. Distinguish a successful client capture followed by a failed notary transfer
   from a failed capture. Previously both entered the unpaid completion fallback
   and could permanently close the act as unpaid after the client had paid.
   The adapter now preserves the captured state; billing/HTTP return a retryable
   503 (`virement_en_attente`) and do not write an unpaid completion ledger.
2. When a capture retry fails, read back the PaymentIntent. A succeeded charge
   at the same amount can resume its transfer using the original charge and
   idempotency keys. A different captured amount stops for reconciliation.
   An unreadable payment outcome returns `paiement_a_verifier`, never an unpaid
   fallback. Regression tests cover adapter, billing route and UI retry state.
3. The completion toast now announces a transfer only when the API says
   `paid: true`. Unpaid completion explicitly says no payment occurred through
   Nota. Both outcomes and retryable failures are tested, with bilingual copy.
4. Added the full counter-offer browser journey alongside direct retention,
   preserving calendar URL entry, client/notary messages and cancellation.
5. Added the missing English dictionary entry for the introduction's Pause
   control found by the translation coverage test. Concurrent introduction
   layout/test edits in this shared workspace were preserved.

Stripe's idempotency cache can retain failures and is not a permanent settlement
ledger. The correction preserves the distinction and prevents a false unpaid
closure; a persistent transfer error still needs operational reconciliation.
See [Stripe's idempotent request contract](https://docs.stripe.com/api/idempotent_requests).
No assertion here proves automatic recovery from every Stripe outage.

## Executed checks

- `npm test`: domain **364**, API **1,530**, all pass.
- `npm run test:admin`: **221**, all pass.
- `npm test --prefix features`: **186 scenarios / 1,069 steps**, all pass.
- `npm run test:contract`: **25**, all pass (also included in API tests).
- `E2E_API_PORT=8827 E2E_WEB_PORT=4327 npm run test:e2e -- --workers=2`:
  **51 Chromium tests**, all pass.
- Payment UI + i18n targeted run after final changes: **22**, all pass.
- `python3 apps/api/test/stage-stripe-secrets.test.py`: **3**, all pass.
- Public/admin builds pass; `git diff --check` passes.
- `terraform -chdir=infra fmt -check` and `terraform -chdir=infra validate`: pass.
- `npm run local:check`: **8 checks**, current API source digest, all pass.
- `npm run test:web`: **785**, all pass after reconciling introduction tests
  with the concurrently updated layout. The earlier run had two obsolete
  introduction assertions; they are not counted as successful validation.
- Updated introduction/language/accessibility focused suite: **21**, all pass.

There is no repository lint script. Terraform formatting and diff whitespace
checks were run; they are not substitutes for a configured JavaScript linter.
Test counts overlap across focused runs and must not be added as unique tests.

## Remaining production gates

1. Restore AWS SSO access. The previous check failed due to a missing SSO token.
   Deploy the reviewed revision and verify its source/version before accepting
   production observations as evidence of these changes.
2. Resolve the previously observed production coverage API 503. Local seeded
   coverage success does not prove the deployed index/IAM works.
3. Supply/activate the Stripe sandbox configuration through the existing private
   staging workflow; verify Connect onboarding, Checkout/card setup, signed
   webhook, authorization, completion, transfer, cancellation and recovery in
   Stripe test mode. Live activation has not been validated.
4. Subscribe with actual Google, Outlook personal/work and Apple accounts;
   verify the event, Nota destination, updates and deletion. Measure refresh
   delays. OAuth/worker-based two-way synchronization is not implemented by
   the feed links tested here.
5. Exercise real notification delivery to designated test inboxes. Several
   handler notifications remain fire-and-forget, and webhook duplicates skip
   sending. A durable outbox with independent retry/reconciliation is still
   required to guarantee recovery after process/provider failure. Captured-mail
   tests prove contents and event wiring, not reliable post-crash delivery.

Related evidence: `2026-09-08-end-to-end-calendar-verification.md`,
`2026-09-08-outlook-apple-subscriptions.md`,
`2026-09-08-stripe-aws-readiness.md`, and `e2e-journey-matrix.md`.


## Final confidence pass

After the owner's request for maximum assurance, a final payment review added
protection for Stripe's `processing` state, both on the capture response and
on readback after a lost response. No transfer or unpaid completion is allowed
while that result is unresolved. Two new regressions pass; the full domain/API
run passes **364 / 1,532** tests. This follows the documented
[PaymentIntent lifecycle](https://docs.stripe.com/payments/paymentintents/lifecycle).

Production read-only checks repeated in this pass: website and health 200;
public feed 200 with 19 events but no new Nota act links; private feed without
a token 401; coverage still 503. These observations confirm that local test
success has not removed the deployment and production verification gates above.
