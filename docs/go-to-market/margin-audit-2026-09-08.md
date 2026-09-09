# Nota margin audit — 2026-09-08

## Decision

Prioritize collection costs and loss prevention before increasing prices. The
current fixed Nota fees do **not** guarantee a positive contribution on every
allowed offer. Keep the production catalogue unchanged while testing demand;
249/289 CAD is a reasonable first price experiment, not a demonstrated optimum.
Do not launch a blanket percentage surcharge or silently deduct costs from the
notary's promised payment.

This is a financial scenario analysis, not evidence of actual profitability.
It does not clear the remaining Stripe production, tax, or professional-regulation
launch conditions. The live account's negotiated fee schedule has not been
verified; published Canadian Stripe rates are assumptions.

## Reproduce and scope

Run `node docs/go-to-market/margin-model-2026-09-08.cjs` from the repository root.
The accompanying `margin-scenarios-2026-09-08.json` is its output. The model reads
prices, date tiers, complexity criteria and the premium cap from the domain.
It does not introduce application business rules or change customer prices.

All 528,768 combinations of enumerated criterion answers are evaluated: 176,256
refinancing and 352,512 financing combinations, yielding 46 and 50 distinct
bases respectively. These are a mathematical envelope, not equally probable or
necessarily commercially realistic dossiers. Brackets use one representative
value because the domain price is constant inside a bracket. The resulting
base ranges are 2,000–4,300 CAD and 1,800–4,300 CAD. All five date tiers are
evaluated. Within the allowed 1–5× offer interval, the card margin decreases
linearly with honoraires, so endpoint analysis covers intermediate amounts.
This does not enumerate future products, future prices or unknown demand curves.

## Cost assumptions and accounting

Published Canadian card pricing is 2.9% + 0.30 CAD, with an additional 0.8% for
international cards and 2% when currency conversion is required. Canadian PAD
is 1% + 0.40 CAD, capped at 5 CAD, with additional verification/failure costs.
Custom pricing may be negotiated; no discount is assumed.
[Stripe Payments pricing](https://stripe.com/en-ca/pricing).

For platforms handling pricing, the Connect model includes 2 CAD per monthly
active account and 0.25% + 0.25 CAD per bank payout. Baseline: ten acts per active
notary per month and one act per payout. A transfer is not a bank payout. These
costs must be reconciled against actual invoicing and payout schedules. Switching
to the alternative pricing arrangement can shift costs to connected accounts;
it is not automatically a saving under the existing charge flow.
[Stripe Connect pricing](https://stripe.com/en-ca/connect/pricing).

Let H be honoraires transferred to the notary and N the separate Nota fee, in CAD.
For a completed, non-refunded domestic-card act, before taxes:

```
Client charge              = H + N
Card processing            = 0.029 × (H + N) + 0.30
Allocated Connect cost     = 0.0025 × H + 2/10 + 0.25
Payment contribution      = N − processing − Connect
Operating contribution    = payment contribution − variable service cost
                            − acquisition cost − expected losses
```

The API's separate charge/transfer arrangement makes Nota pay processing on the
whole charge while promising the notary the whole H. Taxes and disbursements
are excluded here; tax collected is a liability, not additional Nota revenue.
Every additional 100 CAD collected for tax adds 2.90 CAD of domestic card cost,
plus any payout cost if that money is transferred. The model's tax sensitivity
holds transfers constant and therefore does not model the latter.

## Current catalogue: payment contribution per completed act

Amounts below are CAD rounded to the nearest dollar. The reference column uses
the starting base and the domain's recommended date multiplier. The stress
column uses the largest criterion-derived base, 4,300 CAD, times the allowed
cap of five: 21,500 CAD in honoraires. Neither column includes support, CAC,
refunds, disputes or taxes.

| Service | Date tier | Nota fee | Reference contribution | Stress contribution |
| --- | --- | ---: | ---: | ---: |
| Financing | Standard | 229 | 165 | −456 |
| Financing | Fast | 378 | 253 | −311 |
| Financing | Priority | 528 | 342 | −165 |
| Financing | Urgent | 678 | 459 | −20 |
| Financing | Same day | 778 | 528 | 77 |
| Refinancing | Standard | 279 | 207 | −407 |
| Refinancing | Fast | 428 | 289 | −262 |
| Refinancing | Priority | 578 | 371 | −117 |
| Refinancing | Urgent | 728 | 486 | 29 |
| Refinancing | Same day | 828 | 551 | 126 |

Losses are possible even without complex criteria: a standard financing offer
of 9,000 CAD leaves −61.89 CAD; standard refinancing at 10,000 CAD leaves
−44.84 CAD. Both lie at the domain's five-times cap for their starting base.
Standard domestic-card payment contribution reaches zero at approximately
7,035 CAD financing honoraires or 8,576 CAD refinancing honoraires. Operational
break-even occurs earlier once service and acquisition costs are included.

Raising every standard fee enough to cover the 21,500 CAD envelope would require
about 699 CAD just to cover domestic payment costs. That is poor justification
for charging every ordinary customer more. Resolve the expensive collection
path or explicitly restrict unsupported transactions before accepting them.

## Portfolio scenarios and acquisition

Use the existing business plan's **assumed**, not observed, mix: 40% financing,
60% refinancing; 70% standard, 18% fast, 7% priority, 3% urgent and 2% same day.
Complexity uses starting bases. This is an illustrative portfolio, not a forecast.

| Per completed act | CAD |
| --- | ---: |
| Honoraires passed to notary | 2,793.60 |
| Nota revenue | 331.20 |
| Card processing | −90.92 |
| Allocated Connect | −7.43 |
| Payment contribution | **232.85** |
| Illustrative variable service cost | −30.00 |
| Year-one CAC assumption from business plan | −164.00 |
| Remaining before fixed overhead and losses | **38.85** |

Payment contribution is about 70.3% of Nota revenue, not net profit. Do not
subtract CAC here and then count the same marketing budget again in fixed
overhead. Measure actual paid staff time and acquisition per completed act.
An extra ten minutes at 60 CAD/hour costs 10 CAD; reducing that work without
reducing service quality can rival a price increase. No support cost observation
currently substantiates the illustrative 30 CAD assumption.

| Alternative | Payment contribution | Change vs domestic card baseline |
| --- | ---: | ---: |
| International card, no conversion | 207.85 | −25.00 |
| International card with conversion | 145.35 | −87.49 |
| PAD, before verification and incremental risk | 318.77 | +85.92 |
| Ten acts per bank payout | 233.07 | +0.23 |
| One act per active account/month | 231.05 | −1.80 |

The larger lever is the percentage charged on honoraires, not batching pennies
of fixed payout cost. Keep charges and settlement in CAD where appropriate;
an international card does not necessarily cause currency conversion.

PAD is a candidate for sufficiently early standard bookings. It is delayed,
does not support manual capture, and requires a mandate and bank verification.
Settlement/success is not irrevocability: personal-account disputes can arise
within 90 days. It cannot simply replace the existing card hold close to the
act. Pilot earlier collection, failure recovery and payout exposure before
offering it broadly. The displayed saving is not risk-adjusted profit.
[Stripe PAD documentation](https://docs.stripe.com/payments/acss-debit).

Another architectural option is collecting only Nota's own fee while the
notary collects honoraires separately. This removes roughly 81 CAD of card
cost on H in the illustrative portfolio, before any Connect changes, but
creates a second payment responsibility and can move costs to the notary.
Assess reconciliation, customer simplicity and the professional obligations
before choosing it. Do not call a transferred cost an ecosystem saving.

## Price experiments, not automatic production changes

Retain the existing date additions of 0/149/299/449/549 CAD for the initial
comparison. The alternative standard fees below are experimental inputs only.

| Financing / refinancing | Contribution per act | Gain | Maximum relative conversion loss* |
| --- | ---: | ---: | ---: |
| 229 / 279, current | 232.85 | — | — |
| 249 / 289 | 246.44 | 13.59 | 6.3% |
| 279 / 289 | 258.09 | 25.25 | 11.1% |
| 289 / 289 | 261.98 | 29.13 | 12.6% |

*Break-even uses contribution after 30 CAD service cost, before acquisition:
`1 − (current contribution − 30)/(new contribution − 30)`. It assumes equal
traffic, fixed acquisition spend per lead, unchanged mix and completion/loss
rates. A 6.3% relative decline from 10% conversion means approximately 9.37%,
not 3.7%. CAC per completed act rises when conversion falls; holding CAC fixed
would give a misleading comparison. Abandoned-lead support costs also need
measurement. These thresholds are not predictions of customer behavior.

Start by testing 249/289 against the current tariff with a stable assignment
per customer and a frozen quote. It provides a modest increase while retaining
service differentiation. A single 289 fee is simpler, but has a larger increase
for financing; select it only if profit per eligible visitor improves. Do not
assume a competitor's price defines the optimum or a permissible ceiling.

Track quote views → valid offers → accepted offers → completed paid acts,
segmented by service, date, honoraires and collection method. Compare net
contribution per eligible visitor including support and payment losses, plus
notary acceptance and customer complaints. Determine sample size from observed
conversion and a chosen detectable effect; do not stop an experiment at the
first favorable result. If traffic is insufficient, retain current prices and
collect evidence rather than proclaiming a winner.

## Lifecycle and exception scenarios

| Scenario | Margin consequence | Required operating response |
| --- | --- | --- |
| Completed act, ordinary card | Baseline above | Reconcile actual balance transaction fees and payouts |
| Customer abandons before charge | No captured payment revenue; acquisition/support can remain | Track funnel cost; do not label it cost-free |
| Authorization canceled before capture | No captured sale; any provider-specific ancillary fees remain | Cancel hold promptly and measure support |
| Captured cancellation fee paid entirely to notary | Nota retains no fee but pays collection costs | Budget as loss; review cancellation economics transparently |
| Full or partial refund after capture | Revenue reduced; original processing costs may remain | Recover/reverse the appropriate transfer; explicit customer policy |
| Dispute won | Evidence/support and applicable fees remain | Retain consent, quote, completion and communications evidence |
| Dispute lost after notary paid | Lost Nota revenue, fees and potentially unrecovered H | Control payout exposure, reversal/recovery and reserve policy |
| Transfer or payout fails | Cash held or owed is not profit | Idempotent retry and reconciliation; prevent duplicate payment |
| Off-session decline or authentication required | Expected sale may never complete | Clear recovery flow; measure paid completion rather than authorization |
| Foreign card or actual conversion | Higher percentage cost on whole collection | CAD pricing/settlement; measure actual fee profile |
| PAD failure or late dispute | Delayed or reversed funds plus collection costs | Eligible dates, mandate, recovery and risk pilot |
| Discount or goodwill credit | Every 10 CAD reduction in N removes about 9.71 CAD domestic contribution | Fund credits from measured contribution; preserve accepted quotes |
| Taxes/disbursements added to collection | Extra processing without equivalent Nota revenue | Validate invoice responsibility and tax configuration before launch |
| Instant payouts or optional paid payment products | Additional costs can erase gains | Enable only with a measured customer or supply benefit |

Refund and dispute allocation depends on charge type; for marketplace charges,
do not assume refunding automatically recovers every prior transfer.
[Stripe marketplace refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes).
At 0.1%, 0.5% and 1% unrecovered honoraires exposure, the portfolio's additional
principal loss alone is 2.79, 13.97 and 27.94 CAD per act. These are stress
assumptions, not observed dispute rates, and exclude lost Nota fees, dispute
charges and support. Count refunded revenue and recovered funds consistently
to avoid double-counting losses.

## Simple, transparent customer offer

Keep an upfront total with a visible breakdown: notary honoraires, Nota's fixed
service fee, any selected date service, taxes and known disbursements. Explain
what Nota does and when each amount is charged, refundable or earned. Identify
unknown third-party disbursements before commitment. Do not present a mandatory
Nota fee only at checkout, market an unsupported date guarantee, or add an
unannounced card surcharge. Preserve the amount already accepted by a customer.

Before expanding collection or changing cancellation terms, resolve the tax
and professional-regulation launch questions already recorded in the project.
This audit does not validate the legal conclusions in historical decision notes.

## Execution order

1. Reconcile the applicable Stripe/Connect contract and taxes; instrument actual
   fees, support time, refunds, reversals, losses and CAC per completed act.
2. Design and implement a billing eligibility safeguard for loss-making high-H
   transactions, with an explicit supported payment path or a clear refusal
   before commitment. Define the operational contribution floor from measured
   costs; it is not implemented by this audit.
3. Pilot lower-cost collection for eligible advance bookings, preserving card
   handling for time-sensitive cases and checking incremental risk/conversion.
4. Test 249/289 transparently; promote only after contribution per visitor and
   notary supply evidence support it. Further increases need the same test.
5. Recalculate by cohort monthly. A positive average must not conceal an
   uncontrolled loss segment. No production tariff was changed by this audit.
