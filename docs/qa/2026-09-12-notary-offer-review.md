# Notary offer review — 2026-09-12

The open-offer cards now use equal natural grid rows. Their content can wrap without truncation, and actions stay at the foot of each card. This applies to compact, expanded and globally detailed views.

The acceptance dialog presents fees/payment, signing/travel, file preparation, all declared service parameters, prior proposals/document requests and cancellation/withdrawal terms. None of this information is inside a collapsed disclosure. A scrollable content area keeps the acceptance and dismissal controls visible. The year and offer deadline are explicit. Travel allowance and measured distance have separate labels. Missing-item labels are displayed individually; identical labels are listed once. Ready status is explicitly distinguished from document verification.

`notaryOfferDetails()` in the domain projects every catalogue criterion, including zero-complexity answers. Amounts use `money()`, counts remain counts, and false answers remain explicit. Unknown answers stay null. The API exposes only catalogue labels, numeric answers and booleans, never arbitrary pricing fields or free-text identity. Older API responses fall back to the existing complexity factors. The OpenAPI projection is updated.

## Validation

- Targeted run: 136 tests across domain details, notary API, offer feed/focus, confirmation/retention, payment guarantees, translations and CSS. Initial result: 134 passed, 2 new matrix assertions failed because they expected duplicate labels and trailing whitespace. Those assertions were corrected; both FR/EN matrices passed on rerun. The payment-without-billing regression also passed against the final change (3/3 rerun).
- Each FR/EN matrix visits all four services, verifies every missing-item label and criterion, and checks fees, proposed prices, requested-document labels, readiness, expiry, zero/unknown distance and applicable lender fields.
- Edge regressions cover absent/empty/malformed optional lists, literal markup as text, duplicate labels, long text, stale content when switching offers, unknown criteria, false/zero answers, missing defaults, profile completion, network retry, duplicate-click suppression, and 404/409 after opening the review.
- Full BDD suite: 300 scenarios, 2,105 steps passed, including the new scenario for reading all parameters before retention without exposing client identity.
- `npm run build`: passed. JS syntax and scoped `git diff --check`: passed.
- The shared workspace’s full web/admin/domain/API integration run is coordinated by the task handling repository integration. This review does not claim a new full web/admin run of its own.

## Browser verification

Real Nota web on port 4873 and its isolated local API on port 4878; fictitious identities and file-mailer only.

- 1280 px viewport: all 27 visible open cards measured 206.890625 px high. A previous 13-card detailed view measured 461.1328125 px for every card. No card overflow.
- 320 px viewport: all 13 measured cards were 319.8359375 px high; no page overflow. The French footer wraps within the dialog and both controls remain visible.
- 390 px viewport: French and English reviews have no horizontal overflow, all service parameters remain accessible by scrolling, and both footer actions remain visible.
- Actual English testament review: 16 catalogue parameters, no lender row, all 13 unique missing-item labels visible, no horizontal overflow.
- Direct offer link opened the review. After explicit confirmation, local bid `844decbf-372c-4a6e-96b4-a226d7b26211` was independently verified as `retenue` by the client API, for 5,060 CAD on 2026-09-23. The UI displayed the fictitious client contact block and conversation, with focus on the retained-files heading. No client message was sent.

Screenshots and acceptance proof are in `output/notary-offer-review/`. Logs: `/tmp/nota-offer-review-tests.log`, `/tmp/nota-offer-final-matrix.log`, `/tmp/nota-offer-all-features.log`, `/tmp/nota-offer-build.log`.
