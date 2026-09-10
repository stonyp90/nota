# 49. Monetize AI-assisted dossier preparation separately from the marketplace

- Status: Proposed pilot implementation
- Date: 2026-09-09

## Decision

Nota keeps the marketplace free for notaries and introduces a separate paid
product for AI-assisted dossier preparation. The canonical unit is a **new
dossier analysis**, not a token, page, message, or legal signature. Reusing an
existing analysis and the notary’s review never consume a second unit.

The pilot uses a hybrid model:

- one opt-in beta per notary, with **5 lifetime free analyses**;
- three monthly tiers: Essentiel (20), Cabinet (75), and Équipe (200) included
  analyses;
- additional analyses may be purchased as one-off units at the selected tier’s
  published rate;
- the UI shows remaining usage and the server enforces it atomically;
- a failed provider call or failed persistence does not permanently consume a
  unit;
- an unpaid or canceled subscription removes the AI work surface and leaves the
  normal dossier checklist available.

Prices and quotas live in `packages/domain`; Stripe price IDs remain deployment
configuration (`NOTA_AI_PRICE_ESSENTIEL`, `NOTA_AI_PRICE_CABINET`,
`NOTA_AI_PRICE_EQUIPE`). The AI product does not alter Connect payouts or the
marketplace commission decision in ADR 0008.

## Why this model

Five uses are enough to reach the value moment without offering an unlimited
free tier. A monthly included quota gives the étude a predictable invoice and
gives Nota recurring revenue to cover provider, storage, support, and privacy
costs. One-off units keep low-volume notaries from paying for a full month and
provide an upgrade path without forcing a surprise bill.

This follows the current SaaS guidance to use a legible value metric, bundled
usage, visible consumption, and spending control. The pilot must measure
activation, analyses per retained dossier, successful review rate, paid
conversion, support contacts, provider cost per analysis, gross margin, and
churn before prices or quotas are changed.

## Experience boundaries

The ordinary dossier preparation remains visible to every signed-in notary. The
AI controls appear only after the notary explicitly activates the beta or has a
paid entitlement. The beta and its paid upgrade are surfaced lightly in the
notary console and the notary beta landing. They are never presented to a
client as a legal signature, legal conclusion, or autonomous act execution.

When the five beta units are exhausted and no paid entitlement or purchased
unit remains, the client-side UI falls back to the normal dossier experience;
the API returns `402` before any AI provider call. A stale browser cannot bypass
this boundary.

## Rollout

Start with a small invited cohort. Configure Stripe price IDs only after the
provider cost and legal/privacy review are complete. Keep
`NOTA_AI_MONETIZATION_ENABLED=false` in local development and test fixtures;
production enables it explicitly. Existing notary profiles have no beta
enrollment by default, so the rollout is opt-in and reversible.

Stripe webhooks update the entitlement ledger before the common event
idempotency marker is written. Webhook signatures, event idempotency, Stripe
test/live-mode separation, and a rollback plan remain mandatory before paid
checkout is opened.
