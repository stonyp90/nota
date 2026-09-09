# Stripe: local tests and production activation

## Local demo versus real Stripe test mode

`npm run local` starts the seeded demo with simulated payments. For actual hosted
Checkout and signed Stripe events, use `npm run local:stripe`. It uses the same
four local services and in-memory data, but the real Stripe adapter. It refuses
live API keys, production mode, persistent tables and AWS secret bundles.

With real Stripe configured, demo sign-in grants a local session but does not
invent a connected account or mark a notary payment-ready. Complete hosted
Stripe test onboarding and let signed account events update readiness.

Use Node 22 (the CI version) and the official Stripe CLI. Create the gitignored
file `.env.stripe.local` at the repository root, in your private editor:

```dotenv
STRIPE_ACCOUNT_ID=acct_your_test_account
STRIPE_SECRET_KEY=sk_test_your_private_key
STRIPE_WEBHOOK_SECRET=whsec_from_your_local_listener
```

The account id must identify the same test account as the key. Never use a live
key or a production destination's signing secret. A separate Stripe sandbox is
preferable when the platform also serves another application: test events in a
shared account can reach that application's existing destinations.

In the first terminal, load the test key and start the local event forwarder:

```sh
set -a
source .env.stripe.local
set +a
export STRIPE_API_KEY="$STRIPE_SECRET_KEY"
stripe listen --skip-update --latest \
  --events checkout.session.completed,checkout.session.expired,setup_intent.succeeded,payment_intent.canceled,account.updated,account.application.deauthorized \
  --forward-to http://localhost:8788/stripe/webhook \
  --forward-connect-to http://localhost:8788/stripe/webhook
```

Copy the listener's `whsec_…` into `STRIPE_WEBHOOK_SECRET` in the private file.
This local listener uses one secret for both kinds of events. Keep it running.
In a second terminal:

```sh
npm run local:stripe
```

The website is at `http://localhost:4173`; admin is at `http://localhost:4174`.
All payment and onboarding return URLs are forced to the local website, including
when a shell inherited production URLs. After startup, run `npm run local:check`.
Use Stripe's test card `4242 4242 4242 4242`, any future expiry, and any three-digit
CVC in **test-mode Checkout only**. The listener should report HTTP 200 for
completed Checkout and setup events. In-memory offers disappear on restart.

For reproducible provider checks, run:

```sh
npm run test:stripe
```

This command creates Stripe **test** objects and refuses live keys. It verifies
the expected account before creating anything, checks all service/date-tier
Checkout totals against the API's pricing function, checks card-registration
Checkout, authorization/capture/refund, cancellation, decline and Connect
onboarding links. Sessions and temporary connected accounts are cleaned up;
simulated payment/refund history remains in Stripe. A failed cleanup is reported
and causes a nonzero exit. It is intentionally outside `npm test`.

The script does not prove bank payouts, completed Connect identity verification,
browser 3DS recovery, production webhook delivery or tax compliance.

## Production configuration

The account uses hosted Checkout with dynamic `price_data`: no static Stripe
Product/Price id needs to duplicate the Nota tariff. The authoritative tariff
comes from `packages/domain`, optionally overridden through Nota admin, and the
API freezes the customer's quote before settlement. Compare the deployed
`/api/bids?month=YYYY-MM` response's `tarif.grille` with the intended tariff.

Store these fields in AWS Secrets Manager `nota/production/public`, preserving
all existing signing/assistant values:

- `STRIPE_SECRET_KEY`: the intended platform's live server key.
- `STRIPE_WEBHOOK_SECRET`: the live platform snapshot destination secret.
- `STRIPE_CONNECT_WEBHOOK_SECRET`: the live connected-account snapshot secret.

The two destinations share `https://gonota.ca/api/stripe/webhook`. The platform
destination subscribes to the four Checkout/setup/payment events in the local
command above; the Connect destination subscribes to the two account events.
Pin snapshot destinations to `2024-06-20`, matching the installed Stripe 16 SDK.
Do not change account-wide API defaults or other applications' destinations.

Deploy the updated API/reminders code before activating the Connect secret field.
The old runtime loader rejects unknown fields. The current adapter checks both
signatures and the billing layer acknowledges opposite-mode events without
changing records or sending notifications. This matters because live Connect
destinations can receive test events.

Private staging, using the current AWS environment or an explicit `--profile`:

```sh
python3 apps/api/scripts/stage-stripe-secrets.py \
  --mode live --stripe-account acct_your_platform --connect-webhook
```

Staging writes AWSPENDING only. Before activation, verify platform capabilities,
complete sandbox payment flows and signed deliveries, and decide how taxes on
Nota's service and the notary's fees must be invoiced and collected. The present
code announces taxes as extra but does not calculate or collect them. Do not
mistake a successful pretax Checkout for tax-ready billing.

On activation, align AWS required-secret settings and the admin Stripe readiness
metadata with the live configuration, and set Terraform's non-secret
`stripe_mode` to `live`. API and reminder Lambda instances refresh active secrets
within five minutes. Check that both onboarding return URLs use `gonota.ca`.

References: [test payment methods](https://docs.stripe.com/testing),
[Connect webhooks](https://docs.stripe.com/connect/webhooks),
[Stripe CLI API keys](https://github.com/stripe/stripe-cli/wiki/using-stripe-api-keys).
