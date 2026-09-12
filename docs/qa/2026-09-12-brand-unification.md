# Brand unification — 2026-09-12

## Scope and changes

The owner's request covers gonota.ca, brand.gonota.ca, plan.gonota.ca,
pitch.gonota.ca, the private console, signing and the associated documents.
ADR 0054 records the common geometry and source files.

- One generated foundation supplies the current product type scale, spacing
  names and logo proportions to every shipped shell and acquisition page.
- Common outer rails: 1600px maximum, 16–28px gutters, 52px headers, 28px logo
  tiles and 44px command targets. Header wordmarks use the current text ink.
  Header badges share the product's grey background and 9px label treatment;
  the guide documents this navigation variant alongside the blue asset badge.
- Brand, plan and pitch place their logo on the left and controls on the right;
  on phones, document controls live in an accessible native menu. Keyboard
  Escape and outside clicks close it.
- The guide now documents layout, headings, margins and the actual 48% wordmark
  proportion / 12% tile-to-word gap, in both languages.
- The document paint roles use the product names (`--brand-word-ink`,
  `--ink-muted`, `--border`, `--brand-tint-solid`).
- Document language controls use `nota.lang`, with legacy preference fallback.
  The plan retains its existing French summary and complete English edition.
- The public build includes both viewers, their assets and the two current
  PDFs. CI/deploy no longer copy or advertise the historical legal PPTX.
- Deployment probes identify the public, plan and pitch shells through their
  surface roles and shared foundations; optional `BRAND_URL` enables the same
  probe for the brand host. Obsolete English slide strings no longer determine
  whether the current bilingual viewer deployed correctly.
- All 32 slide images were regenerated. Shared labels use the product's
  translation dictionary, tier labels use the domain, and standalone amounts
  use `money()` / `moneyEn()`. The English slide 15's compliance copy is split
  over two lines to fit. Both PDFs contain 16 full-page slides.

## Verification

Completed locally:

| Check | Result |
| --- | --- |
| `npm run test:brand` | 137 passed |
| `npm run test:admin` | 245 passed |
| Brand browser audit and kit | 14 surfaces + 5 kit cases passed across the run and targeted recheck |
| Shared geometry | 6 cases, each checking 7 surfaces; 390/1280/1920px, light/dark |
| Content and document policy sweep | 45 content surfaces at 7 widths, plus 4 CSP checks, passed across the sweep and targeted rechecks |
| Transparent subgrid measurement | Passed; empty cells are ignored while real content collisions remain detectable |
| Final foundation / translation checks | 3 foundation and 16 translation tests passed |
| `python3 docs/pitch-deck/test-render-slides.py` | Passed; currency/title separation, negative amounts and tier names |
| Public and admin builds | Passed |
| JavaScript/Python syntax and `git diff --check` | Passed |

The 25-case browser run initially passed 18 cases. Its seven failures were the
plan's wait targeting the hidden English heading and six geometry cases using
an old acquisition-page module retained by a development server. A fresh stack
and the visible-heading selector passed all seven in 23.9 seconds.

Browser geometry measures actual logo dimensions, horizontal rail, vertical
centering, header height, wordmark colour and overflow. It opens and closes the
mobile menus. This is stronger than merely finding the expected CSS tokens.

The final geometry pass also compares badge paint and typography with the
public application. It found the signing stylesheet's older `--muted` name;
renaming it to `--ink-muted` preserved the colour values and aligned the
header. The remaining five cases passed in 27.2 seconds after this correction;
the sixth had already passed with the corrected stylesheet.

The content sweep completed 49 cases before its process received SIGTERM.
Its 45 passes included every admin section, the signing workspace, all four
acquisition pages and the documents. The four initial failures were a
transparent subgrid falsely counted as overlapping the notary title and three
booking helpers using the calendar's previous entry sequence. All four passed
targeted rechecks. The two first-visit motion cases had not run when the process
stopped; the calendar task owns validation of its newly revised onboarding.

The 32 slide images were reviewed in two overview sheets; the changed English
slide 15 and French slide 13 were also inspected at full size. The PDF binder
uses those images directly. A regression test prevents a heading such as
`250 000 $ pour` from being mistaken for a standalone numeric amount.

The first broad checks were interrupted when the host ran out of disk space.
Their partial results are not counted as passing runs. A subsequent complete
admin run passed after its translation guard was corrected to exclude style
blocks from visible prose. No user files were deleted during this task.

## Integration boundary

This was a shared working tree containing extensive existing changes. The
calendar and notary-profile tasks are being consolidated by the calendar task;
they own the final domain/API/web/BDD validation and Git integration record.
All older named branches were already ancestors of main except
`brand/footer-and-notaire-experience`, which had one unmerged commit.

The live brand guide inspected at the start still advertised older logo
proportions and alternatives. Local checks do not constitute deployment.
After the main release, use the existing browser brand audit with
`BRAND_WEB`, `BRAND_ADMIN`, `BRAND_DOCS`, `BRAND_BRAND_HOST`, `BRAND_PLAN_HOST`
and `BRAND_PITCH_HOST` set to the public hosts.
