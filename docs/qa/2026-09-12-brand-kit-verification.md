# Brand kit and application verification — 2026-09-12

## Identity and scope

The adopted identity is **Nota**, hosted at **gonota.ca**. The public kit is
**https://brand.gonota.ca/**. `brand.gunata.ca` did not resolve during this audit.
The attached exploration transcript did not select a replacement logo, so this
change preserves the adopted N tile, OTA letterforms, square period and blue
palette. It does not promote any unselected exploration to production.

## Changes in this pass

- The public guide no longer offers eight alternative logos as approved assets
  or sends portfolio users to unselected exploration boards.
- Official light/dark SVG downloads derive from the product's actual symbols.
  Both contain paths, built-in clear space and no external font dependencies.
- The public email signature derives from `docs/signature-courriel.html`.
- The guide explains reproduction, minimum width, typography and colour usage.
- The guide uses the shared French/English dictionary and language toggle.
- Colour copying preserves the swatch and hex-code markup, including repeated
  clicks. Previously, copy feedback replaced the entire button contents.
- `npm run brand:generate` regenerates the downloads; the web build does this too.
- `npm run test:brand` covers brand assets, email branding, fonts, ink, typography,
  contrast and the public guide. A registry guard requires every public pane and
  admin navigation section to appear in the browser surface sweep.
- The browser sweep now verifies the brand palette and heading-scale tokens in
  every reached section, including authenticated admin sections.
- Booking compatibility and surface tests now click the visible lender dropdown
  and travel buttons instead of selecting hidden native state mirrors. Firefox
  exposed that gap in the old browser tests.
- `npm run test:all` runs domain/API, web, admin, BDD, both builds and Playwright with one browser worker.
  `npm test` alone still means domain/API only.

## Evidence

Verification uses the shared working tree, which already contained extensive
uncommitted changes before this pass. Other sessions edited API/UI files during
the run. Counts are observations of the runs below, not a certification of an
immutable commit or a claim of exhaustive provider testing.

Local test ports: API 8941, web 4441, admin 4442, documents 4443. This prevents
reusing the standard demo servers by accident.

- Local stack: 12 health, fixture and source-freshness checks passed.
- Focused brand suite: 134 tests passed, including the section-registry guard.
  The guide and i18n tests also passed together (20 tests).
- Local browser brand audit: all 14 listed surfaces passed, plus responsive
  brand-guide and exploration checks (16 total).
- Public kit browser tests: five passed: French/English × light/dark plus a
  repeated colour-copy regression. Downloads, image loading, mobile overflow,
  language switching and preservation of swatch markup are covered.
- Public and admin builds succeeded.

Additional completed runs:

- Domain: 454 tests passed; API: 2,101 passed (also rechecked after the shared
  API source changed).
- Admin: 244 tests passed.
- BDD: 298 scenarios and 2,093 steps passed, including the final recheck.
- Main browser matrix: 465/476 passed on the initial run. The guide failure was
  corrected; language and inventory rechecks passed (16/16). The booking tests
  were changed to exercise visible controls and are being rechecked below.
- Updated section sweep: 40/47 passed initially; the six interrupted by the
  first runner shutting down its servers and the overview timeout all passed
  on the independent stack (7/7). All 47 surface cases have therefore passed
  the new brand-token assertions.

Final follow-ups:

- Web suite: 1,054 passed, one failed because an old brand assertion still
  targeted `.pulse-row:hover`. The hover surface now belongs to the shared
  `.pulse-item` wrapper. The updated assertion verifies both pointer and
  keyboard focus against the same hover-veil token and passes in isolation.
- Final compatibility run: **60/60 passed** across Chromium, Firefox, WebKit,
  iPhone, Android and iPad, including complete French/English booking journeys,
  all four booking steps and the four acquisition pages. The two complete
  booking journeys use a 90-second functional-test budget; the old 30-second
  whole-journey budget expired on the loaded host before the UI could be driven.
- The initial browser matrix's 11 failures are covered by the successful brand,
  language/inventory and compatibility rechecks. This is evidence across runs,
  not a claim that the initial 476-case run exited green.
- Both builds, JavaScript syntax checks and whitespace checks passed. There is
  no repository lint script configured.

The full smoke-file recheck passed **126/126**, including the corrected hover
assertion. No local test failures remain unresolved from the runs above. The
complete web suite was not rerun after this test-only correction; its other
1,054 cases had passed. The new brand-kit tests were run separately.

The final local-stack check passed all 12 checks with API source digest
`c216bbfdda7b`. Public/admin builds and the 134-test brand suite passed again
after the final asset-generator changes.

No production deployment or git commit was performed. The repository contained
extensive unrelated work in progress; release the reviewed changes together
through the normal public/admin deployment workflows, then rerun the live
brand audit.

## Production boundary

Read-only browser checks against the live sites found older letterforms than
those in the current checkout. For example, the public carnet lacks the current
N stems, bevelled T and cut A. The live guide is also behind the local guide.
All 16 live audit targets failed the same three geometry checks: current N
stems, bevelled T and cut A. The audited palette and typography did not produce
additional failures. Local success must not be reported as a production deployment.

The historical PPTX files in `docs/` were not regenerated in this pass; see the
separate conformance audit for their status. They are not official logo assets.
Real payment, email delivery, identity and signing providers require their
configured integration environments; the local browser suite uses demo ports
and fixtures.

## Reproduce

```sh
npm run local:check
npm run test:brand
npm run test:all
```

To inspect live branding without publishing or changing account data:

```sh
BRAND_WEB=https://gonota.ca BRAND_ADMIN=https://admin.gonota.ca \
BRAND_DOCS=https://gonota.ca BRAND_BRAND_HOST=https://brand.gonota.ca \
BRAND_PLAN_HOST=https://plan.gonota.ca \
npx playwright test e2e/brand-conformance.spec.js --project=chromium --workers=1
```
