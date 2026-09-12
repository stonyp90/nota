# Retained notary files: simple overview and complete workspace

## Implemented

- Retained files default to a compact overview: service, fee, signing date, client contact, payment alerts, and the next conversation action.
- **File details / Simple view** is an accessible per-file disclosure with `aria-controls` and `aria-expanded`. The complete file remains mounted when collapsed, preserving drafts and input state.
- The expanded file shows the conversation and document exchange beside the client file, preparation, agenda, signature room, completion and withdrawal actions. It uses one column when the card is narrower than 720 px.
- A single retained file fills the available width. Multiple compact files share equal-width tracks; when a file expands, all files use the full row, avoiding an empty half-row beneath the expanded file.
- After acceptance, and when following a retained-file link, the matching file opens automatically. Starting a first conversation prepares the existing editable draft and sends nothing. Opening an existing conversation adds no template.
- Expansion survives feed refreshes; message text, focus and selection keep the existing preservation behavior. Expansion state resets when the session expires.
- New copy is translated in French and English. Withdrawal now uses Nota's standard ghost-button style. The earnings sentence is rendered as a separate translated element so an English overview no longer ends with French copy.

## Verification

- Existing `notary-mise-en-relation.test.mjs`: **45/45 passed**. Log: `/tmp/nota-retained-tests.log`.
- Targeted direct-link, first-contact, bilingual service matrix, and draft-preservation run: **5/5 passed**. Log: `/tmp/nota-retained-simple-tests.log`. Three of these are new tests; the other two are existing regression checks.
- Bilingual matrix rerun including a client without contact details and the earnings translation: **2/2 passed**. Log: `/tmp/nota-retained-matrix-tests.log`.
- CSS validation: **3/3 passed**. Log: `/tmp/nota-retained-css-tests.log`.
- `node --check apps/web/public/app.js`: passed.

Browser checks used the real local Nota UI and fictional seeded data on port 4873. No message was sent and no act was settled or withdrawn during these checks.

| Viewport | Observed result |
| --- | --- |
| 1280 px | Single compact card: 1224 × 198 px. Expanded card: 1224 × approximately 566–584 px, depending on language. Two content columns. |
| 1280 px, two files | Compact cards: 606 × 334 px each. Expanding one produces a 1224 px workspace and a 1224 px compact summary below. |
| 768 px | Card: 712 px wide; detailed content stacks in one column. |
| 390 px | Card: 358 px wide; no horizontal overflow; first-contact draft visible and editable. |
| 320 px | Card: 288 px wide; no horizontal overflow; primary overview buttons are 44 px tall and stack. |

Captures:

- `output/notary-retained-simple/detail-desktop-en.jpg`
- `output/notary-retained-simple/summaries-desktop-en.jpg`

## Boundaries

The visual checks cover the current in-app Chromium browser. They do not establish cross-browser coverage on physical iOS/Android devices. Cancelled files keep their existing dedicated compensation workflow. The available-offer feed, landing section and explanatory video are owned by the parallel tasks. Domain/API behavior is unchanged.
