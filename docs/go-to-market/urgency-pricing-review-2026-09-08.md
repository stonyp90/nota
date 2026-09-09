# Urgency pricing and margin decision — 2026-09-08

## Decision

Nota already prices by deadline. Do not describe the current prices as legally
cleared or profit-maximizing. Keep the tariff unchanged pending evidence on
demand and the written Quebec professional-regulation opinion. This review
adds a concrete urgency experiment to the existing
[margin audit](margin-audit-2026-09-08.md); it does not deploy an experiment.

The distinction for “under the hood” is automatic calculation versus undisclosed
charges. A server can calculate a quote from a published deadline schedule, but
the customer must see the applicable total before committing. Preserve an
accepted quote through payment; the passing quote tests are engineering evidence,
not a legal opinion. Do not increase an accepted price merely because time passes.

## What the current code does

`packages/domain/index.js` owns the service/date grid and recommended notary
amounts. `apps/api/src/prix-nota-config.js` resolves stored and environment
overrides; catalogue defaults below are not verification of live configuration.
`apps/api/src/billing.js` uses the quote and preserves the notary's honoraires.

| Notice at quotation | Nota date addition (CAD) | Financing Nota total | Refinancing Nota total |
| --- | ---: | ---: | ---: |
| More than 14 days | 0 | 229 | 279 |
| 8–14 days | 149 | 378 | 428 |
| 2–7 days | 299 | 528 | 578 |
| Tomorrow | 449 | 678 | 728 |
| Today | 549 | 778 | 828 |

These are Nota fees, excluding the notary's honoraires and taxes. The separate
recommended notary amount uses urgency multipliers and retained-offer history.
That tuner is not a margin optimizer: it does not measure the conversion lost
at a higher price, service cost, payment losses or incremental acquisition cost.
Completed/retained prices alone cannot identify willingness to pay among people
who abandoned the process.

The supplied AGENTS.md rule 2 still describes the superseded percentage model.
Current code and ADRs 0031/0034 instead implement separate Nota fees. This review
does not reintroduce a percentage deduction or treat that stale instruction as
legal clearance.

## Legal findings and limits

1. **Notary urgency fees have a qualified basis.** Article 49 requires reasonable
   fees proportionate to services and recognizes exceptional speed as a factor.
   It does not approve a particular multiplier, a five-times cap, or an unlimited
   emergency premium. The official article returned by search is a historical
   version dated 2025-10-20; counsel must confirm amendments through launch.
   [Official article 49](https://www.legisquebec.gouv.qc.ca/fr/version/rc/N-3%2C%20r.%202?code=se%3A49&historique=20251020).

2. **Nota's date fee needs its own legal assessment.** Article 49 governs the
   notary's professional fee; it is not authority for the platform's fee.
   Article 32.1 addresses intermediaries obtaining fee reductions, abandonment
   of honoraires, or arranging services without responsibility for the notary's
   fees. Paying the notary in full is useful design evidence, not a statutory
   safe harbour for the whole marketplace. The official consolidation retrieved
   on this review was current to 2026-04-07.
   [Loi sur le notariat, article 32.1](https://www.legisquebec.gouv.qc.ca/fr/document/lc/N-3).

3. **Automatic pricing cannot hide mandatory charges.** The Competition Bureau
   explains that mandatory additions can make an advertised price misleading;
   its guidance also addresses variable mandatory fees. Show the attainable
   total prominently and explain the date service actually supplied. Do not
   imply a guaranteed date without capacity and a defined remedy for failure.
   [Bureau guidance](https://bureau-concurrence.canada.ca/fr/pratiques-commerciales-trompeuses/indication-prix-partiel),
   [variable-fee guidance](https://bureau-concurrence.canada.ca/fr/comment-nous-favorisons-concurrence/education-sensibilisation/recueil-pratiques-commerciales-trompeuses-volume-6).

4. **Personalized automation creates an additional question.** If pricing is a
   decision based exclusively on automated processing of personal information,
   assess article 12.1 notice, explanation and review requirements before
   introducing it. Do not assume keeping the algorithm on the server removes
   those duties. Search returned the official statutory text, but full-page
   retrieval failed; verify the current wording and application with counsel.
   [Private-sector privacy law](https://www.legisquebec.gouv.qc.ca/fr/document/lc/P-39.1).

These findings qualify the categorical statements in the September 5 internal
legal note: separate lines, a frozen quote and service/date inputs are controls,
not proof that every such price is lawful. The present review does not certify
tax handling, trust accounting, cancellation terms, referrals or the broader
marketplace. No written professional opinion was established by this review.

## Concrete optimization experiment

First reconcile real processor charges and losses. The existing model estimates
232.85 CAD payment contribution per completed act under its assumed portfolio;
after illustrative support and CAC it leaves 38.85 CAD before overhead and losses.
These are scenarios, not measured profit. It also finds negative payment
contribution for some allowed high-honoraires offers. Increasing urgency prices
does not repair the loss exposure on standard bookings.

After legal clearance, compare the current date schedule with **an additional
50 CAD on each nonstandard date tier**, keeping service fees and the notary's
offer unchanged. This is a test size, not an asserted optimal or legal ceiling.
Evaluate each service/date cohort separately. Start with a published, versioned
tariff pilot and retained control cohorts; assess assignment/disclosure with
counsel before using personalized customer experiments.

At the existing domestic-card assumption, an extra 50 CAD contributes 48.55 CAD
before incremental taxes, service costs or losses. Using reference honoraires
and the existing model's illustrative 30 CAD support cost:

| Tier | Maximum relative paid-completion conversion loss: financing | Refinancing |
| --- | ---: | ---: |
| 8–14 days | 17.9% | 15.8% |
| 2–7 days | 13.5% | 12.4% |
| Tomorrow | 10.2% | 9.6% |
| Today | 8.9% | 8.5% |

Formula: `1 - (current payment contribution - 30) /
(current payment contribution + 48.55 - 30)`. These are break-even thresholds,
not predicted conversion changes. They assume unchanged honoraires, per-act
support, loss rates and equal acquisition spending per eligible visitor. A 10%
relative loss from 10% conversion means 9%, not zero. Account for customers
switching dates and differences in supply; do not mistake seasonal changes for
a price effect. Higher emergency fulfilment costs reduce these allowances.

Optimize **net contribution per eligible visitor**, not fee percentage or
revenue per transaction. Include paid completions, actual processor fees,
refunds, unrecovered payouts, support and acquisition spend. Establish sample
size from observed conversion and a specified detectable effect; promote only
with credible improvement and acceptable date fulfilment/notary acceptance.
Sparse urgent traffic may not support a reliable experiment yet.

The larger modeled opportunity remains eligible advance-booking collection:
the existing audit estimates roughly 86 CAD more payment contribution with PAD
before verification costs and additional risk. It requires a separate payment
flow and does not substitute for an urgent card authorization. Confirm actual
provider pricing and operational eligibility before implementing it.

## Written opinion requested before activating new prices

Give Quebec counsel the actual quote screens, contracts, payment flow and the
two tariff schedules above. Obtain conclusions on (a) separate service/date
fees and intermediary/fee-sharing rules, (b) substantiation and remedies for
the date guarantee, (c) notary discretion and reasonableness of recommended
urgency amounts, (d) consumer disclosures, price experiments and automated
decisions, and (e) tax/trust-account treatment of collections. Request concrete
permitted conditions and required changes, not just general approval of
“dynamic pricing.” No external message was sent by this review.

## Verification

Re-ran `node docs/go-to-market/margin-model-2026-09-08.cjs`; its accounting and
boundary assertions passed. Re-ran six targeted test files: domain grid,
date-margin invariants and tuning; API frozen quotes, grid resolution and
separate Nota fees. **67 tests passed.** No runtime or production tariff was
changed. Existing unrelated working-tree changes were preserved. Full UI/BDD
suites were not run for this documentation-only review.
