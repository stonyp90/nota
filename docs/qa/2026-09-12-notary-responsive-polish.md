# Notary responsive polish — 2026-09-12

This pass follows the full offer review documented in `2026-09-12-notary-offer-review.md`.

## Changes

- The open feed starts with essential cards. Service, date, fees, readiness, complexity, payment signals and signing location remain visible. Lender context, every available service answer, documents, proposed prices, calendar and decline are available through Details. Acceptance still opens the complete review before committing.
- Filters start folded. The service and date controls can be shown or hidden independently of their selections. A visible count signals active filters; Clear filters stays reachable even when the panel is folded or there are no results. Device preference and keyboard focus survive redraws.
- Open cards use equal natural grid rows with their actions at the foot. Their text wraps without clipping. Auto-fit releases unused columns when only one or two offers remain.
- The white console wrapper is removed. Offer surfaces use a very pale Nota tint, distinct from the date tabs. The redundant landing eyebrow is removed while the signed-in heading remains accessible.
- Retained files have a compact summary and a full-width detailed workspace, with conversation and file controls in two columns when space allows. See the retained-file QA report for draft, service and language coverage.
- The calendar film is being rebuilt from the actual updated Nota screens in 16:9, using the official logo and app buttons, with opaque scene changes. See the film QA report for final media validation.

## Browser measurements

Actual local Nota on ports 4873 / 4878, with synthetic offers and fictitious identities. No client message was sent.

| French viewport | Cards measured | Card width | Common height | Page overflow |
| --- | ---: | ---: | ---: | --- |
| 1280 | 26 | 400 | 186 | None |
| 768 | 26 | 350 | 214.5 | None |
| 390 | 26 | 358 | 186 | None |
| 320 | 26 | 288 | 235.5 | None |

All card action footers were 15 px from their bottom edge. English at 390, 768 and 1280 px also passed uniform width/height/footer and overflow assertions. Filtering September 23, hiding the filters while keeping the selection, opening individual details, showing all details and resetting the feed were checked. English expanded parameters showed both translated labels and values, with unknown answers explicit.

The final French retained workspace independently measured exactly the full list width: 1224 px at 1280, 712 px at 768, 358 px at 390 and 288 px at 320. It used two columns only at the desktop width, with no page or card overflow. Final capture: `output/notary-responsive-polish/retained-final-fr.jpg`.

Geometry was read from rendered DOM using `e2e/offer-card-geometry.mjs` through the in-app browser. `e2e/notary-offer-size.spec.js` adds a six-case FR/EN × mobile/tablet/desktop CI regression with mixed optional parameters. That new Playwright specification was syntax-checked here; its CLI runner was not run in this pass.

## Tests

- Feed, focus and translation run: 52 tests, initially 50 passed. The old test expecting Decline beside the primary action was updated for the requested disclosure. The unrelated client string “Prix total” was translated by the integration task. Both failures were resolved in a 4/4 targeted rerun, including complete expanded parameter values.
- Final filter preservation and keyboard-focus regression: 1/1 passed.
- Shell contrast/brand CSS checks: 12/12 passed; shell agent verified mobile, tablet, desktop and dark mode.
- Final shared-token/contrast/square-register checks after aligning the filter-count badge: 16/16 passed (`/tmp/nota-notary-final-contrast.log`).
- Build passed after the final card/filter changes. Media are rebuilt separately after capture.
- Syntax and scoped whitespace checks passed. The integration task owns the full shared-workspace suite and any eventual commit/merge.

Logs: `/tmp/nota-offer-simple-latest.log`, `/tmp/nota-offer-simple-recheck.log`, `/tmp/nota-notary-filter-focus.log`, `/tmp/nota-notary-polish-build.log`.
