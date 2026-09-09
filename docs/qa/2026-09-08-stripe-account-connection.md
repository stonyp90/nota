# Stripe account connection — 2026-09-08

Historical preparation snapshot. Superseded by the
[production-readiness follow-up](2026-09-08-stripe-production-readiness.md).

## Verified access and deployment

- AWS STS confirmed account `436136277668` using the owner's temporary session.
- Stripe dashboard access confirmed account `acct_19hMgWAZUksBrhVb`, including its test environment.
- `https://gonota.ca/api/health` and the public API Gateway health route both returned HTTP 200 JSON.
- `nota-api` is active in `ca-central-1` and loads `nota/production/public` from Secrets Manager.
- The current secret bundle contains neither the Stripe API key nor webhook signing secret. No credentials were printed by the inspection.
- This Stripe account already has Tablix test destinations. They must remain intact. Separate Nota destinations do not isolate account-wide test events from other applications.

## Prepared configuration

Use **test mode** first. Both snapshot webhook destinations will deliver to
`https://gonota.ca/api/stripe/webhook`:

| Destination | Scope | Events | Secret field |
| --- | --- | --- | --- |
| Nota payments test | Your account | `checkout.session.completed`, `checkout.session.expired`, `setup_intent.succeeded`, `payment_intent.canceled` | `STRIPE_WEBHOOK_SECRET` |
| Nota Connect test | Connected accounts | `account.updated`, `account.application.deauthorized` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

Pin the destinations to API version `2024-06-20`, matching the installed Stripe
16 SDK. The Dashboard offers the old account default (`2016-10-19`) or current
versions; use the webhook endpoint API to set the SDK-compatible version without
changing the account-wide default.

The adapter now accepts either configured signing secret. Raw body validation,
signature expiry, and event idempotency remain in force. Runtime secret loading
accepts, rotates and removes the new Connect field. OpenAPI documents both
destinations. The staging helper supports `--connect-webhook` for private entry
of the second signing secret; it still writes AWSPENDING only.

Deploy the updated API and reminders code **before** adding the new secret field
to AWSCURRENT: the previous runtime loader rejects unknown fields. Preserve all
existing signing and assistant credentials. Adding Stripe credentials to the
active bundle enables the payment flow; staging alone does not.

## Next activation step

Validation passed: domain (364 tests), API (1,536 tests), web (791 tests), admin
(221 tests), Cucumber (186 scenarios / 1,069 steps), and both UI builds. After
the full API run, an additional HTTP signature-wiring test was added; the five
Connect webhook tests passed together. These are local tests, not evidence of
actual Stripe delivery or a successful payment.

The browser credential-transfer confirmation is still pending. No Stripe
destination was created, no Stripe credential was copied to AWS, and no live or
test payment was initiated during this preparation. The local code changes have
not been deployed.

After authorization, register the two test destinations, stage the test server
key and both signing secrets in the existing AWS bundle, then verify the signed
delivery and Checkout/Connect flows before enabling live payments. Test events
on this shared Stripe account can also reach its existing Tablix destinations.

References: [Stripe Connect webhooks](https://docs.stripe.com/connect/webhooks),
[webhook endpoint creation](https://docs.stripe.com/api/webhook_endpoints/create).
