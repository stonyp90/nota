# 48. Nota Québec brand lockup and colour system

- Status: Accepted
- Date: 2026-09-09, consolidated 2026-09-10

Two ADRs were numbered 0048 in parallel branches — one describing the lockup,
one describing the role-based colour system. They are the same decision seen
from two sides, and are merged here. The retired file was
`0048-color-system.md`.

## Context

The owner's instruction, 2026-09-10: **the brand must be the same across every
part of the app.** Before this decision the tree carried two live colour
vocabularies (a `--nota-blue-*` ramp and a parallel
`--nota-teal` / `--nota-midnight` / `--nota-coral` / `--nota-saffron` set), two
logo treatments, and a nine-flavour palette switcher that let a visitor repaint
the product. A brand a visitor can change is not a brand.

## Decision

### The lockup

A deep blue-teal square with a white `N`, a small blue signal dot, a dark
`Nota` wordmark, and a pale `QUÉBEC` badge. The same lockup is used in the
public carnet, admin console, signing room, email shell, PWA metadata,
favicons, the Open Graph image, the business plan and the pitch deck.

The mark and the wordmark are each drawn **once**, as
`<symbol id="nota-logomark">` and `<symbol id="nota-wordmark">`; every other
copy is a `<use href="…">`. `ux-nav.test.mjs` keeps the symbol, `favicon.svg`,
`og.svg`, both webmanifests and the `theme-color` metas in lockstep.

### Tokens

| Role | Token | Value |
| --- | --- | --- |
| Mark square | `--nota-blue-900` | `#264961` |
| Signal dot | `--nota-blue-500` | `#407598` |
| Primary action | `--nota-blue-600` | `#386888` |
| Hover / deep | `--nota-blue-800` | `#274A62` |
| Wordmark ink, midnight canvas | `--nota-blue-950` | `#101B26` |
| Québec badge | `--nota-blue-50` | `#EBF1F5` on `#274A62` text |
| Warm accent | `--accent-warm` | `#B45309` light · `#F79009` dark |

Colour is assigned **by role, never per component**: one ink anchor, one action
colour, one small signal, one warm accent, plus service/data colours that stay
categorical and are never reused for brand controls. A new product colour is
added as a semantic token; a one-off hex in a component rule is a defect.

Contrast is a product constraint, not a preference: WCAG 2.2 requires 4.5:1 for
normal text and 3:1 for non-text UI boundaries, so the light and dark theme
ramps carry separate action tokens and the browser chrome follows the canvas.

- https://www.w3.org/TR/WCAG22/#contrast-minimum
- https://www.w3.org/TR/WCAG22/#non-text-contrast

### One brand, not nine

The nine-flavour palette switcher (`data-palette`, `#palette-select`,
`#mnav-palette`, `PALETTE_IDS`/`setPalette`) is **retired** — markup, CSS
blocks, JavaScript, translations and tests. The light/dark **theme** toggle
stays: a theme is a reading condition, a palette was a second brand.

The default theme is **light**; `theme-color` is `#386888` on light and
`#101820` on dark. The signing room is a dark room by design and states its own
`#101820`.

## Alternatives reviewed

1. **01 — Monogramme lié (selected)** — the N opens directly into `ota`, with
   the strongest Québec signal, favicon legibility, and the closest match to
   the supplied reference.
2. **Wordmark only** — cleaner in long-form documents, loses recognition in
   browser chrome, email clients and small app surfaces.
3. **Rounded green/hunter** — distinct, but inconsistent with the reference and
   with the institutional blue-teal application UI.
4. **Text-only `CARNET PUBLIC · QUÉBEC`** — useful as supporting copy, too long
   as a primary lockup.

01 wins because it preserves the recognizable N at small sizes, lets the N open
directly into `ota`, gives Québec a compact secondary badge, and keeps the
action colour separate from the mark square.

Eight further logo directions (trust seal, deed leaf, continuous
paraph, register, notarial bridge, reserved date, proof frame, Québec rosette)
were drawn and rejected. None ships. Both reference pages are `noindex` and are
documentation, not production surfaces:

- `apps/web/public/brand.html` — the living brand guide (colours, the lockup,
  correct and incorrect usage);
- `apps/web/public/brand-explorations.html` — the full comparison board.

## Rollout contract

The web and admin token ramps move in lockstep. Email uses a flattened copy of
the web **light** tokens, checked by `emails-brand.test.mjs`. Raster assets are
generated from the current SVG sources; `truthful-claims.test.mjs` pins the
`og.svg` digest. The pitch deck and business plan use the same token values.

A new surface either consumes the shared tokens or documents an external partner
brand explicitly. It must not reintroduce the retired green/cobalt palette, the
`--nota-teal` / `--nota-midnight` vocabulary, or any per-visitor palette choice.
