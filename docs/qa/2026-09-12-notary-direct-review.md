# Direct offer review — 2026-09-12

Calendar links open the selected offer's confirmation after authentication.
Required profile completion returns to that offer after refreshing availability.
The account tour yields to this explicit offer selection. A recent selection is
also carried into a mailbox login opened in the same browser, bound to the
verified email, consumed once and limited to 30 minutes. It never accepts an
offer automatically.

The confirmation keeps the service, date, fee, client-paid Nota price, location,
lender, readiness and payment guarantee visible. Document lists, the payment
schedule explanation and cancellation terms use native disclosures. The action
footer remains visible while the contents scroll. Temporary acceptance errors
remain in the review for retry; repeat clicks do not duplicate requests. Server
refusals for unavailable offers, expired sessions and missing profile fields
keep their existing handling.

The silent FR/EN film now lasts 21 seconds and has four steps: subscription,
calendar offer, direct review, retained client file. The confirmation and result
are real captures from the local application with fictional identities. The
client API independently returned `retenue`; the record and public offer are in
`demo/calendar-captures/`. External calendar synchronization remains illustrative
and carries the provider refresh caveat.

Validation:

- Real browser: calendar link, profile save, confirmation and retained dossier.
- Desktop and 390 × 844 mobile: no horizontal overflow; the 44 px confirmation
  button stays visible with documents and cancellation details expanded.
- FR/EN media: H.264, 1280 × 576, 21 seconds, no audio; both browser players
  reached readyState 4 and advanced their playback time.
- 83 targeted notary-flow/CSS checks passed; 49 pricing/acceptance regressions
  and 35 copy/i18n/video HTTP checks passed in subsequent runs.
- Final acceptance suite: 36/36 passed, including a new-tab mailbox login,
  mismatched account, expired selection, profile return and retry handling.
- Full web run: 1,085/1,088 passed. Pricing-label and translation failures were
  resolved and their suites rerun successfully. The existing muted-kicker
  assertion in `registre-encre.test.mjs` still fails independently of this change.
- Production build, JavaScript syntax and changed-file whitespace checks pass.

No production data, external calendar account or payment was changed.
