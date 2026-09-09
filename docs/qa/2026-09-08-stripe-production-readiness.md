# Stripe production readiness — 2026-09-08

**Verdict: technical fixes deployed; live credentials and destinations staged;
live payment activation remains blocked.**
This report supersedes the earlier same-day Stripe access/preparation reports.
The machine-readable evidence is in [stripe-verification.json](2026-09-08-stripe-verification.json).

## Pricing verified

The live API's tariff matches the current domain catalogue and ADR 0042:

| Service | Starting notary fee | Nota service fee | Advertised standard total, before tax/disbursements |
| --- | ---: | ---: | ---: |
| Mortgage financing | CAD 1,800 | CAD 229 | CAD 2,029 |
| Mortgage refinancing | CAD 2,000 | CAD 279 | CAD 2,279 |

Date guarantees are CAD 0 / 149 / 299 / 449 / 549 for standard / rapide /
prioritaire / urgence / extreme. These supplement Nota's service fee; the
notary's quoted fee is separate. Actual Stripe test Checkout sessions accepted
the API-calculated totals for all ten service/tier combinations. The production
API reports both taxes and disbursements as excluded.

Prices are created dynamically in Checkout from server calculations. There is
no separate static Stripe price catalogue to synchronize. Existing tests cover
stored admin overrides, frozen quotes and the notary's settlement amount.

## Completed

- AWS and Stripe access verified for AWS `436136277668` and Stripe
  `acct_19hMgWAZUksBrhVb`.
- Corrected the deployed onboarding return and refresh URLs from the old
  CloudFront hostname to `https://gonota.ca/#notaires`.
- Added separate platform/Connect webhook signing secrets, runtime loading and
  rotation. Authenticated opposite-mode events are acknowledged without
  persistence changes or notifications; sandbox Connect events cannot affect
  live records through the live destination.
- Added `npm run local:stripe`, using real Stripe test payments on the seeded
  in-memory stack. It refuses live keys, production mode, persistent tables and
  AWS secret bundles, and forces local return URLs.
- Added `npm run test:stripe`, an explicit provider check outside the normal
  test suite. The final run passed 15 checks, including ten pricing combinations,
  card-registration Checkout, simulated authorization/capture/refund,
  authorization release, card decline and Connect onboarding-link creation.
- Verified a real Stripe CLI signed `payment_intent.canceled` delivery to the
  actual local API, receiving HTTP 200. This is local delivery evidence, not a
  production delivery check.
- Expired the smoke-test Checkout sessions, removed temporary Connect accounts,
  and refunded the successful simulated captures. Test history remains in
  Stripe. The first run's test-harness account-id bug was corrected and its
  temporary account was separately removed; the final run reported no cleanup
  errors.
- Fixed private AWS secret staging for this Mac's AWS CLI: individual request
  flags plus `--secret-string file:///dev/stdin` work, while whole-request
  `--cli-input-json file:///dev/stdin` failed. Explicit profiles are optional so
  temporary environment credentials work. Secret values are neither printed
  nor put in command arguments.
- Deployed the updated API and reminder code from this workspace after passing
  checks. The bundle hash and final AWS status are recorded in the JSON receipt.
  No new Stripe secret was activated and no live payment was initiated.

## Checks

Domain: 364 tests. API: 1,542 tests. Cucumber: 186 scenarios / 1,069 steps.
Browser E2E: 51 passed. The prior unchanged web/admin suites passed 791/221 tests
and both builds passed. Terraform formatting and validation passed. All eight
local-stack checks passed with the current API source digests.

These results do not certify every failure case, live bank payouts, taxes or
legal launch readiness.

## Production recheck — 2026-09-08, after 12:26 UTC

- AWS reports `nota-api` Active / Successful with the same deployed bundle hash.
- Live health and tariff probes returned HTTP 200. The tariff still matches
  229/279 CAD and the existing date ladder. An unsigned webhook returned 400.
- A private inspection of the active AWS secret bundle confirms all three
  Stripe fields are absent. Payments remain unconfigured; an HTTP 200 health
  response is not evidence that real payment collection works.
- Stripe's live-key reveal still requires owner verification. The email dialog
  appeared, then returned to `Try again`; no live key was obtained.
- Re-ran domain (364), API (1,541), web (791), admin (221), and Cucumber
  (186 scenarios / 1,069 steps): all passed. Both frontend builds passed.
- The first browser suite passed 50/51: the calendar booking test timed out
  waiting for the reservation button to stabilize. Both calendar tests passed
  in isolation, and the complete suite passed 51/51 with four workers. This is
  evidence of an intermittent test failure, not proof of its root cause or a
  permanent fix. No forced clicks or disabled assertions were introduced.
- Corrected `stripe-provider-check.js` to locate `.env.stripe.local` in the
  repository root rather than its parent. Syntax verification passed. Earlier
  provider checks used stdin credentials, so did not expose this path error.
- The margin audit also identifies allowed loss-making offers. Its suggested
  billing eligibility safeguard is not implemented. See
  [margin audit](../go-to-market/margin-audit-2026-09-08.md).

No live payment activation, tariff change, tax implementation or additional
application deployment was performed in this recheck. The outstanding gates
below remain open; the owner has been asked about tax registration and which
supplier invoices and collects tax on the notary's fees.

## Outstanding production gates

1. **Stripe owner verification — resolved at 12:31 UTC.** Email verification
   followed by authenticator verification unlocked the live key. The key and
   both webhook signing secrets are now staged in AWS `AWSPENDING` and verified
   by private readback. `AWSCURRENT` is unchanged. The platform reports
   `charges_enabled=true` and `payouts_enabled=true`; this does not establish
   readiness of a connected notary. See the non-secret
   [live staging receipt](2026-09-08-stripe-live-staging.json).
2. **Taxes — operator registrations verified; implementation still pending.**
   The owner supplied NEQ `1177601144`, GST/HST `729206607RT0001`, and QST
   `1229550311TQ0001`. Revenu Québec's official API reports QST status `R`
   (regular), effective 2022-04-29, for `GESTION A. PAQUET INC.`. The CRA registry
   separately confirms GST/HST registration under that name as of 2026-09-08.
   See [registration evidence](2026-09-08-nota-tax-registration.json). The NEQ
   and Nota trade-name registration have not been independently verified.
   The ordinary Quebec tax treatment for Nota's own taxable service is GST 5%
   and QST 9.975%; registered small-supplier exemption is not assumed. The site
   says taxes are extra, but the billing code and Stripe adapter still do not
   calculate or collect them. Responsibility for invoicing/collecting tax on
   each notary's separate supply remains unresolved. Do not apply the operator's
   tax identity to notaries' supplies without an established collection model.
3. **Live destinations and secret activation — prepared, not activated.**
   Nota's platform and Connect destinations now exist, pinned to API version
   `2024-06-20`, pointing at `https://gonota.ca/api/stripe/webhook`, and disabled.
   Both secrets and the live key are in pending version
   `bbdee999-047e-448b-96c0-b08e6e0add94`, preserving existing bundle values.
   After resolving launch conditions, promote the reviewed bundle, align
   required-secret settings and admin readiness metadata, enable the two
   destinations, and verify delivery. Neither live delivery nor live payment
   activation is established by staging. Tablix and Ursly's two destinations
   were compared before/after and are unchanged. Do not create duplicates.
4. **Settlement partially verified with real Stripe test objects at 12:44 UTC.**
   Hosted Checkout and Express onboarding were completed in a browser; actual
   Nota HTTP acceptance/completion captured CAD 6,978 and transferred CAD 6,300.
   Repeating completion created no duplicate transfer. Signed CLI-forwarded
   events returned HTTP 200. The transfer was reversed and payment refunded.
   See [browser settlement evidence](2026-09-08-stripe-browser-e2e.md).
   This used the local app and real sandbox adapter, distinct from the demo
   browser suite. Bank payouts remain unverified: the fictitious account had
   transfers active but payouts disabled pending identity verification.
   Live settlement, transfer failure recovery, event reordering and browser
   3DS recovery remain open. Checkout also displayed **Usrly**, not Nota;
   resolve merchant branding without changing other apps on the shared account.
5. **Launch review.** Obtain the legal review required by the repository's
   working rules; tests cannot establish that requirement has been met. The
   repository also retains an older commission model in AGENTS.md while the
   current code and later ADRs implement separate fixed Nota fees. This audit
   preserved the current approved catalogue and did not reinstate a commission.

Local usage and activation instructions: [Stripe testing](../stripe-testing.md).
Stripe references: [Connect webhook modes](https://docs.stripe.com/connect/webhooks),
[test payment methods](https://docs.stripe.com/testing).
