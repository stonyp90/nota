# 1. Charge a flat subscription, not a commission

- Status: Superseded by [0008](0008-free-commission-marketplace.md) (2026-08-21)
- Date: 2026-08-12

## Context

Nota is a marketplace that connects clients to notaries for a signed *acte
notarié*. The obvious marketplace monetization is a commission: take a
percentage of each transaction. For Nota this is not merely undesirable — it is
**prohibited**.

Notaries in Quebec are bound by the *Code de déontologie des notaires* under the
oversight of the **Chambre des notaires du Québec**. The Code forbids a notary
from **sharing professional fees with a non-notaire**. A platform that skimmed a
percentage of the *acte* would be doing exactly that: taking a cut of a
professional fee it is not entitled to. Any notary using such a platform would
be exposed to a disciplinary complaint, and the platform would be structurally
built on a *déontologie* violation.

The fee a client offers on Nota **is** the notary's professional fee for the
act. Nota is a non-notaire. Therefore Nota cannot take a share of it.

## Decision

**Nota charges notaries a flat subscription to access the marketplace.** Revenue
is decoupled entirely from the amount, tier, or premium of any individual
*acte*. Nota is paid for access to demand (the carnet of posted dates and
offers), not for a slice of the work.

Consequences for the product and code:

- The premium a client offers (up to the 10× cap) flows **entirely** to the
  notary. Nota computes tiers and premiums only to price *urgency* and rank
  bids — never to compute a cut.
- No field, table, or line of copy anywhere in the system represents a
  Nota-take, commission rate, or platform percentage of an *acte*.

## Consequences

- **Positive:** the model is compliant by construction; there is no per-act money
  flow through Nota to reconcile, hold, or remit; the notary–client fee
  relationship is untouched; incentives are clean (Nota grows by adding
  notaries and demand, not by inflating individual acts).
- **Negative / trade-offs:** revenue does not automatically scale with high-value
  acts; subscription pricing and tiers must be designed to capture value
  another way; the "never a commission" rule is a permanent hard constraint
  that every future feature, integration and payments idea must respect.
- **Enforcement:** documented in `AGENTS.md` as a top-level rule and asserted by
  the `features/deontologie.feature` BDD suite so the constraint is executable,
  not just prose.
