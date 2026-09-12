# Client date preview

The touch calendar now opens a compact sheet with one primary action,
“Préparer mon offre”. The selected signing date appears once; “Modifier la
date” reveals the native date input in place. Other clients' published
amounts are secondary, behind one disclosure, so they cannot be mistaken
for the visitor's own quote. Inside that disclosure, service names precede
client identifiers and prices remain aligned on the right.

The preview uses the shared Nota color, typography and spacing tokens, with
a full-width 48 px primary action. It becomes a bottom sheet on phones and
a bounded dialog on larger screens. Short landscape screens use a compact
header. French copy has matching English dictionary entries.

Preparing an offer returns the existing market list to the actual form.
Changing the date preserves preview/form mode and the current form screen.
On later form screens, focus returns to the date control rather than a
hidden service choice. The optional client guide still targets the direct
child button in `#day-preview` and names its updated action.

## Validation

- `client-offering-strip.test.mjs`: 5/5 pass. Covers separate entry points,
  default disclosure state, CTA focus, market-list restoration, and date
  changes in both preview and form mode.
- `registre-encre.test.mjs`: 5/5 pass, including the day eyebrow's
  `--subtitle-ink` token. Combined log: `/tmp/nota-date-preview-final.log`.
- One focused Chromium E2E passes at 320×568, 390×844, 768×1024, 1024×390
  and 1440×900 by resizing the same open preview. It checks no horizontal
  overflow, visible primary controls, opening/closing offers and date
  editing, then continues into the real form and changes date on screen 2.
  Log: `/tmp/nota-date-preview-browser.log`.
- All five generated screenshots were visually inspected. Local artifacts:
  `output/client-calendar-qa/date-preview-results/` (ignored by Git).
- Browser inspection also verified the French two-offer day and the native
  date picker at 320 px. Later browser connections were unavailable; the
  repository's E2E test completed the remaining responsive checks.
- JavaScript syntax and `git diff --check` pass.
