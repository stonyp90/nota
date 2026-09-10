# Business plan review — 2026-09-09

## Outcome

The prior plan was polished but internally optimistic. Its two biggest unsupported conclusions were the claim that approximately 240 000 $ funded the business through Year 3 and the claim that the marketplace already had a defensible proprietary urgency dataset. The revised plan labels targets as targets, separates the four-service code catalogue from the proposed financing launch, and publishes a cash model that includes card/Connect costs, service work, losses, referral-budget exposure and a reserve.

## Corrections made

- Reconciled the document with the current domain catalogue: financing, refinancing, testament and procuration are implemented; the financing scenario only assumes the first two.
- Reconciled current default prices: 229 $ financing, 279 $ refinancing, and date additions of 0 / 149 / 299 / 449 / 549 $. The plan no longer repeats the former 199 / 249 grid as current.
- Replaced the 73% gross-margin headline with payment contribution after card and Connect costs, then modeled service work, losses and operating budgets separately.
- Added a monthly Year 1 cash ramp and a 25 000 $ planning reserve. Base annual endpoint capital is approximately 430 119 $ including that reserve; the proposed 250 000 $ leaves a modeled gap before within-year timing, opening obligations or restricted balances.
- Replaced 244 bids / 244 completions with 534 posted, 307 retained and 244 completed requests in the base funnel. Acceptance and completion-after-acceptance are now separate metrics.
- Corrected referral language: the domain constants are 50 $ per client and 250 $ per activated notary, while the current ledger records client reward at retention and notary reward at `premierActe`. Settlement-only payout is a required implementation and contract decision, not an existing fact.
- Removed the unsubstantiated Notairo 295 $ comparison and the “only participant” / “no competitor” claims. The current public page was checked on September 9 and shows a 949 $ refinancing starting price, excluding taxes and disbursements, with possible urgency/complexity additions.
- Added explicit gates for tax calculation, supplier identity, notary eligibility, payment activation and payout recovery, loss-making offers, signing authorization and privacy.
- Added the current AI and signing boundaries: Bedrock extraction is blocked by provider billing/access, the four-service cases are synthetic and unreviewed, and the signing room is a rehearsal rather than an operative notarial ceremony.
- Added reproducible model source at `docs/planning/business-plan-model.cjs`; generated output is `business-plan-model.json` and the HTML is rebuilt from Markdown.

## Evidence checked

- `packages/domain/index.js` for service catalogue, current fees, tiers and referral constants.
- `docs/go-to-market/margin-audit-2026-09-08.md` for the whole-charge payment-cost envelope and allowed loss segments.
- `docs/qa/2026-09-08-stripe-production-readiness.md` for staged versus activated live payment, tax implementation and sandbox settlement boundaries.
- `docs/go-to-market/launch-evidence/2026-09-08-activation.md` for deployment/search-submission evidence and the absence of claimed customer traction.
- `docs/ai/bedrock-verification-2026-09-09.md`, `docs/ai/notary-ai-evaluation-2026-09-09.md` and `docs/signing-beta-release.md` for AI and signing readiness.
- Current public Stripe pricing pages, the Québec *Loi sur le notariat* and the *Code de déontologie des notaires*; links are in the plan.

## Remaining owner decisions

The plan cannot answer these from repository evidence: the financing entity and cash/liabilities; the written professional opinion; tax collection responsibility; current notary-status verification; settlement reserve and recovery policy; reward disclosure/eligibility; supported handling for high-honoraires loss segments; insurance; and the live payment/signing authorization package. These are written as gates instead of being presented as solved.

## Verification commands

```sh
node docs/planning/business-plan-model.cjs
python3 docs/planning/render-business-plan.py
git diff --check
```
