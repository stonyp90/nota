# 8. Free marketplace, commission on completed acts

- Status: Accepted
- Date: 2026-08-21
- Supersedes: [0001](0001-flat-fee-not-commission.md),
  [0005](0005-stripe-flat-subscription.md)

## Context

ADR 0001 fixed the original business model — a flat subscription, never a
commission — because the *Code de déontologie des notaires* forbids a notary
from sharing professional fees with a non-notaire, and ADR 0005 implemented it
with Stripe Checkout subscriptions.

On 2026-08-14 the owner decided to change the model (commit `4d801da`,
"Migrate billing to the free+commission model"): notaries join and browse for
free, and Nota takes a percentage of a retained act's value, collected only
when the act completes. The billing layer, web copy, i18n dictionaries, FAQ
JSON-LD and the BDD suite were migrated then; AGENTS.md, ADRs 0001/0005 and
the notary lifecycle emails lagged behind and kept asserting the flat-fee
model. This ADR records the pivot so the governance docs match the shipped
product, and confines the déontologie constraint to what still holds.

## Decision

**Notaries pay nothing to join; Nota collects a commission on completed acts.**

- **Free onboarding.** `POST /notaries/connect` opens free Stripe Connect
  onboarding; the notary becomes ACTIVE when their account can accept charges
  (`account.updated` webhook, `charges_enabled`). There is no subscription and
  no fixed fee.
- **Commission at completion (or on accept under pay-on-accept).** The
  commission is a share of the acte's confirmed value, charged as a Stripe
  Connect **application fee on a destination charge** to the notary's
  connected account. The rate is configurable via `NOTA_COMMISSION_RATE`
  (default 10%), never baked into logic or copy.
- **Billing layer only.** The commission concept lives exclusively in
  `apps/api/src/billing.js`. `packages/domain` — floor prices, tiers, offer
  validation — must never expose a commission, cut, or percentage concept.
  `features/deontologie.feature` asserts this boundary.
- **Copy tells the truth.** All user-facing copy (fr-CA canonical, EN via the
  i18n dictionaries) describes the commission model: free registration, no
  fixed fees, a commission deducted at the source only on completed acts.

## Consequences

- **Positive:** zero-cost onboarding removes the main adoption barrier;
  revenue scales with marketplace volume and act value; Stripe Connect keeps
  Nota out of PCI scope and automates the split at charge time.
- **Negative / trade-offs:** revenue is deferred until acts complete; per-act
  money now flows through Nota (destination charges, transfers, refunds must
  be reconciled); incentives must be watched so ranking never favors Nota's
  take over the client's interest.
- **LEGAL RISK — read before launch.** A share of a notarial acte is the
  fee-sharing arrangement the *Code de déontologie des notaires* restricts.
  This model is an explicit owner decision and **requires a legal review with
  the Chambre des notaires du Québec before launch** (also flagged in the
  `billing.js` header). If the review fails, ADR 0001's flat-subscription
  model is the documented fallback.
- **Enforcement:** AGENTS.md rule 2 states the model and its boundary;
  `features/deontologie.feature` keeps the domain commission-free; the billing
  tests assert the rate is configurable and collected exactly once per act.
