# Hosted Stripe sandbox settlement — 2026-09-08

**Result: sandbox authorization, capture, Connect transfer, duplicate-submission
protection and refund succeeded. Production and bank payouts are not certified.**

The local Nota application used the real Stripe adapter and a Stripe CLI signed
event forwarder. The public/admin source digest was `142a77052233`; all eight
local-stack checks passed. No production data or real card money was used.
Machine-readable Stripe object references and cleanup results are in
[the receipt](2026-09-08-stripe-browser-e2e.json).

## Observed flow

1. In the Nota browser UI, booked a financing for September 9 with an approved
   CAD 250,000 loan, an already owned property and Banque Nationale.
2. Completed hosted Stripe Checkout using its sandbox card. Returned to Nota
   with payment confirmation; a real signed completion webhook returned 200.
3. Completed hosted Stripe Express test onboarding for a fictitious notary.
   Signed account events updated the app's connected-account state.
4. Used authenticated Nota HTTP endpoints to fill the notary profile, accept
   the offer and mark the simulated act completed. These notary actions were
   exercised through the API, not through the notary browser UI.
5. Verified Stripe's authorization changed from `requires_capture` to
   `succeeded`, and exactly one transfer reached the intended connected account.
6. Repeated act completion: still exactly one transfer.
7. Reversed that transfer, fully refunded the captured payment, canceled an
   earlier authorization and deleted the temporary connected account. Stripe
   confirmed the cleanup. The earlier offer had disappeared during a local
   source-watch restart; its authorization was explicitly released.

| Settlement component | CAD, before taxes |
| --- | ---: |
| Customer capture | 6,978.00 |
| Transfer to fictitious notary's Stripe balance | 6,300.00 |
| Nota service/date fees | 678.00 |
| Stripe fee reported on the test balance transaction | 202.66 |
| Nota remainder after that fee | 475.34 |

The remainder excludes other Connect charges, acquisition, support, losses and
taxes; this single sandbox result does not establish a general profit margin.

## Fix found during execution

Demo-open sign-in previously assigned a fake `acct_demo_…` identity even when
real Stripe billing was configured. It now limits that automatic activation to
the demo payment adapter. A regression test covers both a new notary and an
existing unfinished Stripe onboarding account. The API suite passes 1,542
tests; domain passes 364; Cucumber passes 186 scenarios / 1,069 steps.
The complete browser regression suite also passed 51/51 with four workers.
This additional local sign-in fix has not been deployed in this run.

## Remaining production limits

- The sandbox notary had active transfers and card payments, but bank payouts
  were disabled pending identity verification. A Stripe balance transfer is
  not evidence of money arriving in a bank account.
- Hosted Checkout displayed **Usrly**. The shared platform's merchant identity
  must be resolved for Nota without unintentionally changing another product.
- Taxes are announced as extra but are not collected by the current flow.
- Live secrets remain staged and live Nota webhook destinations disabled.
- This flow did not verify live delivery, 3DS recovery, bank settlement or every
  transfer-failure/retry ordering. The separate readiness report retains those
  launch gates, along with the required legal review and margin audit findings.
