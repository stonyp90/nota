# Nota typography and panel balance — 2026-09-12

The shared type scale now uses 26–36 px page headings, 19–24 px section
headings and 16 px lead text. Sora headings use weight 700. Partner codes and
reward amounts sit below the page title. The partner lead selector no longer
enlarges reward timing and eligibility notes.

Large panels use an 84% surface mix, subtle borders and layered shadows.
Short entrance and interaction animations respect reduced-motion preferences.
The gap after the public notary inventory is reduced to 16 px.

## Validation

- Web suite: 1,065/1,066 passed initially. The sole failure expected the
  superseded 72 px introduction heading. After updating that expectation,
  all eight tests in `intro-gate-ui.test.mjs` passed.
- Admin suite: 245 tests passed.
- Typography suite: all 10 tests passed after the lead-selector correction.
- Chromium brand and experience checks: 21 passed. Experience checks cover
  390, 1280 and 1920 px, both themes, actual blended contrast and reduced motion.
- Chromium layout sweep: all nine selected surfaces passed across seven
  widths from 320 to 1920 px, after correcting the 320 px notary section gap.
  Surfaces: French carnet, English dark carnet, public notary landing,
  partners, Signature beta, profile, brand guide, introduction and onboarding.
- Public and admin production builds passed. `git diff --check` passed.
- Local stack: all 12 freshness and availability checks passed.
- Partner screenshots inspected in both themes on desktop and mobile.
- Shared document typography synchronized; both 16-page pitch PDFs rebuilt.
  First PDF pages and all 32 rendered slide frames visually inspected.

No business rules or user-facing copy were changed in this styling pass.
