# 5. Bill the flat subscription with Stripe Checkout

- Status: Superseded by [0008](0008-free-commission-marketplace.md) (2026-08-21)
- Date: 2026-08-12

## Context

ADR 0001 fixed the business model: Nota charges notaries a **flat monthly
subscription** for marketplace access, never a commission or percentage of an
*acte* — the *Code de déontologie des notaires* forbids a notary from sharing
professional fees with a non-notaire. We now need to actually collect that
subscription. The mechanism must:

- take recurring card payments without Nota ever handling card data (staying out
  of PCI scope);
- keep our servers as the source of truth for whether a notary's subscription is
  active, while Stripe is the source of truth for the money;
- fit the existing hexagonal shape of `apps/api` (ports/adapters, no framework,
  tests with no network);
- carry **zero** notion of a per-transaction charge, rate, or platform share of
  an *acte*, so the déontologie constraint is respected by construction.

## Decision

**Use Stripe Checkout in `mode: 'subscription'` with a single flat monthly
Price, and reconcile state through signed webhooks.**

- **One recurring Price.** `POST /notaries/subscribe` opens a Checkout Session
  with exactly one line item — the flat monthly `STRIPE_PRICE_ID`, quantity 1 —
  and returns the hosted `url`. There is no usage/metered/tiered component and
  no `application_fee`/Connect destination charge: those are the shapes that
  would represent a cut of the notary's fee, and they are intentionally absent.
- **Checkout keeps card data off our servers.** Stripe hosts the payment form;
  Nota only ever creates a session and later reads webhook events. No PCI scope.
- **Ports & adapters.** A `stripe-port.js` adapter mirrors `repo-dynamo.js`: it
  lazy-requires the `stripe` SDK inside the factory, so tests inject a plain fake
  and never load the package. `billing.js` holds the use-cases and depends only
  on the Repo port and the Stripe port.
- **Webhook signature verification.** `POST /stripe/webhook` verifies the raw
  body against `STRIPE_WEBHOOK_SECRET` via `stripe.webhooks.constructEvent`. A
  bad signature is a 400; nothing is trusted unverified.
- **Idempotency by event id.** Each processed event id is stored
  (`PK=EVENT#<id>`, `SK=EVENT`); a redelivered event is a no-op. Stripe delivers
  at-least-once, so this is required for correctness.
- **State machine.** `checkout.session.completed` → `active` (persisting
  `customerId` + `subscriptionId`); `customer.subscription.deleted` → `canceled`;
  `customer.subscription.updated` with status `canceled` → `canceled`,
  `unpaid`/`past_due` → `past_due`. The notary id is stamped into the
  subscription metadata at creation so subscription events trace back without a
  secondary index. Unknown event types are ignored, never fatal.
- **Test-mode keys via env.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
  `STRIPE_PRICE_ID` are provided through `TF_VAR_*` / a gitignored tfvars and
  injected into the Lambda environment. No key value is ever committed; use
  Stripe test-mode keys everywhere except production.

## Consequences

- **Positive:** compliant by construction — no code path expresses a share of an
  *acte*; no card data on our servers; the adapter boundary keeps the test suite
  offline and SDK-free; idempotent, signature-verified webhooks make delivery
  robust; Stripe owns dunning/retries for the recurring charge.
- **Negative / trade-offs:** we depend on Stripe availability and its webhook
  delivery; subscription state is eventually consistent (a Checkout redirect may
  land before its webhook, so the UI must tolerate a brief `pending`); the
  `stripe` SDK is a new runtime dependency in `apps/api` (justified, lazy-loaded).
- **Enforcement:** a guardrail test asserts the billing layer's source and
  exports contain no commission/percentage/`application_fee` concept, keeping the
  ADR 0001 rule executable rather than merely documented.
