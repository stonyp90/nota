# 0048 — Nota color system

Status: accepted

## Decision

Nota uses a role-based palette rather than assigning a new color to each
component:

- midnight ink (`#101B26`) is the canvas and text anchor;
- blue-teal (`#386888`) is the primary action, link, focus and active-state color;
- cyan-blue (`#407598`) is the small signal used in the mark and key highlights;
- coral is reserved for urgency and destructive states;
- service colors remain categorical data colors and are not reused for brand
  controls.

The logo uses a deep blue-teal tile (`#264961`) with a white `N` and cyan-blue
signal dot (`#407598`), paired with a dark `Nota` wordmark and a pale
`QUÉBEC` badge. This keeps the mark visible on both light and dark chrome
without confusing the signal color with a legacy gold accent.

The selected lockup is the reference supplied for this release. The reviewed
alternatives remain documented in `apps/web/public/brand-explorations.html`:
the linked-N direction is the best fit for a compact favicon and email-safe
mark; the seal, document, bridge and rosette directions are more expressive
but lose legibility at small sizes or overstate institutional formality. That
exploration page is noindex and is not a production brand surface.

## Research basis

The palette follows a restrained analogous/split-complementary relationship:
cool slate/sage carries trust and continuity, while antique gold supplies a
measured counterpoint. Adobe’s color-wheel guidance identifies analogous and
complementary relationships as useful starting points for harmonious palettes;
the implementation then reduces saturation and chooses tones by role and
contrast rather than by hue alone.

Contrast is treated as a product constraint. WCAG 2.2 requires at least 4.5:1
for normal text and 3:1 for non-text UI boundaries, so the CSS keeps separate
light-theme and dark-theme action tokens and the browser metadata follows the
dark boot canvas.

References:

- https://color.adobe.com/create/color-wheel
- https://www.w3.org/TR/WCAG22/#contrast-minimum
- https://www.w3.org/TR/WCAG22/#non-text-contrast

## Guardrails

`ux-nav.test.mjs` verifies that the inline mark, favicon, social SVG, manifest
theme color and browser theme color stay synchronized. New product colors
should be added as semantic tokens in `styles.css`; do not add one-off hex
values to component rules.
