# Stripe and AWS operational audit — 2026-09-08

**Status: not ready to certify live payments.** The owner authorized Stripe test
mode validation first, followed by live activation after successful checks.
Credentials have not yet been supplied through the private entry tool. No new
Stripe secret has been stored, no test/live charge has been created, and no AWS
infrastructure change has been applied in this audit.

## Corrected in the workspace

- Payout onboarding now requires a valid notary SESSION token matching the
  requested email. Anonymous callers and another notary cannot obtain a Connect
  onboarding URL. The browser sends its existing session; OpenAPI is updated.
- Stripe account creation no longer sends unsupported `preferred_locales`.
  Account creation uses a stable per-notary idempotency key; onboarding links
  use a fresh key because the hosted links are single-use and expire.
- Checkout follows the selected website language (`en` or `fr-CA`), with Stripe's
  browser detection as the fallback. Both payment and setup flows are covered.
- Setup Checkout explicitly creates a Customer for later off-session holds.
  Payment methods are restricted to cards, matching the application's hold and
  capture flow. Merely registering a card does not capture money.
- Stripe SDK network requests have a five-second timeout and one retry instead
  of potentially outliving the Lambda timeout on one network request.
- Stripe onboarding failures return a controlled, retryable 503 without exposing
  provider exception details.
- CloudFront's CSP permits requests to the specific private document bucket;
  the previous `connect-src 'self'` blocked the direct signed S3 uploads used by
  the application. A real Chromium CSP test verifies the configured bucket is
  allowed while another bucket is blocked.
- Admin Lambda joins the existing error, throttle and duration alarms.

## Credential entry

Run from the repository root after restoring AWS authentication:

```sh
python3 apps/api/scripts/stage-stripe-secrets.py --profile aws-prod --mode test
```

The tool requires the **server secret key** (`sk_test_...`) and the relevant
**webhook endpoint signing secret** (`whsec_...`). A publishable `pk_...` key is
not needed by this server-created hosted Checkout integration. API keys and
webhook signing secrets are distinct: [Stripe key documentation](https://docs.stripe.com/keys).

The tool checks AWS account `436136277668`, validates the Stripe server key with
a read-only account request, preserves the existing signing/assistant bundle,
checks for a concurrent active-version change, and writes **AWSPENDING** in
`nota/production/public`. It does not change AWSCURRENT. Optional
`--stripe-account acct_...` pins the expected Stripe account. `--mode live`
accepts live keys only, still stages only, and must follow the sandbox checks.

Input is hidden; non-private terminal fallback is refused. Values travel to the
AWS CLI over stdin and are not embedded in command arguments, repository files,
Terraform inputs or terminal output. Provider errors are redacted. The receipt
contains only account/readiness metadata and the pending version ID. Staging a
`whsec_` value verifies its format, not the endpoint's actual signature delivery.

Secrets Manager metadata, scoped IAM reads, five-minute cached runtime retrieval
and credential rotation handling already exist in this workspace. These follow
[AWS's Secrets Manager guidance](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html).
The current implementation uses AWS-managed encryption for the secret bundles.
Legacy Terraform state contains older signing values and must still be treated
as sensitive; staging new values does not sanitize historical state backups.

## Executed checks

| Suite | Result |
| --- | --- |
| Domain | 364 passed |
| API, including billing, webhook, credential-staging and contract checks | 1,500 passed |
| Web DOM suite (four workers) | 767 passed |
| Admin | 221 passed |
| Cucumber | 174 scenarios / 987 steps passed |
| Chromium end-to-end (two workers) | 49 passed |
| Public and admin builds | passed |
| Terraform format and configuration validation | passed |

No failing or skipped tests in the final runs. Stripe tests use injected ports;
the CSP test runs in Chromium against intercepted synthetic upload endpoints.
The secure-entry Python tests are invoked by the standard Node API test suite.

- Terraform formatting and validation pass. This validates configuration, not
  deployed IAM, alarms, budgets or resource state.
- Local-stack checks pass: all four surfaces respond, both APIs carry the current
  source digest, and the public carnet contains seeded offers.
- A modest local read-only sample (40 requests, concurrency four) had zero HTTP
  errors, p50 1 ms, p95 7 ms, maximum 23 ms. This is the **in-memory local API**,
  not an AWS capacity or end-user latency benchmark.
- Public read-only probes returned: gonota.ca HTTP 200 (Launching Soon), existing
  CloudFront application HTTP 200, CloudFront `/api/health` HTTP 200, and the API
  Gateway `/health` HTTP 200. A single CloudFront health sample took 1,129 ms;
  the direct API Gateway sample took 117 ms. These isolated samples cannot
  distinguish network, edge, cold-start and warm-runtime effects.

## Blocking production verification

1. AWS CLI access is currently unavailable. The `aws-prod` SSO token is missing;
   alternative configured production profiles returned invalid credential
   errors, and initiating device authorization failed. The owner has been asked
   to restore `aws sts get-caller-identity --profile aws-prod` for the intended
   account. No live IAM, Secrets Manager, CloudWatch or Terraform plan/apply could
   be verified in this run.
2. gonota.ca still serves the registrar's Launching Soon page. The existing AWS
   application is reachable at `d1s1h4894dau0c.cloudfront.net`, but it is not a
   substitute for verifying the intended domain, TLS, return URLs and webhook URL.
3. Stripe credentials and a working webhook endpoint are required to validate
   actual sandbox Checkout, card registration, SCA/3DS, declined/expired cards,
   authorization placement/release, exact capture, cancellation compensation,
   Connect transfers, and payout readiness. Include transfer failure after a
   successful capture, webhook retries/order and reconciliation in the gate.
4. The test gate must include browser return/cancel recovery and signed events
   reaching the deployed application, rather than only SDK calls or mocks.
   A Stripe test transfer is not evidence of a real bank payout.
5. Promote a verified secret version and matching non-secret Stripe mode only
   after the sandbox gate passes. Then verify live account/capability readiness,
   endpoint signing, notifications and reconciliation. Any actual live charge
   requires an agreed amount and payment method; none was performed here.

## Remaining security and performance verification

Terraform already describes private S3/OAC access, document KMS encryption,
DynamoDB deletion protection and point-in-time recovery, API throttles, Lambda
reserved concurrency, capped log retention, CloudFront compression and disabled
API caching. These are configured controls, not proof of their live state.

After access is restored, inspect the deployed policies and alarm subscriptions,
validate restores and secret rotation, and measure end-to-end p95/p99 latency and
errors under realistic concurrent browsing, booking and payment callbacks. API
health responses alone do not establish every section is working. No claim of
perfect security, exhaustive edge-case coverage or perfect performance is made.

Stripe references used to check the adapter contracts:
[Checkout creation](https://docs.stripe.com/api/checkout/sessions/create),
[Connect account creation](https://docs.stripe.com/api/accounts/create),
[single-use account links](https://docs.stripe.com/api/account_links/create),
[webhook verification](https://docs.stripe.com/webhooks).
