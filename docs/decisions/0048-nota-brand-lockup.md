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

---

## Amendment — 2026-09-11: the word is drawn solid, and the rule is retired

- Status: Accepted
- Date: 2026-09-11

The owner, looking at `apps/web/public/brand-explorations.html`: **« 01 is the
right one »**. Exploration 01 « Monogramme lié » is the production wordmark.

What shipped until today was not it. `<symbol id="nota-wordmark">` drew O, T and
A as **thin outline strokes** (`fill:none; stroke:currentColor;
stroke-width:5.2`) and hung **a thin horizontal rule under the word** — « the
legal-document / signature-line cue ». Beside a tile holding a solid white N,
the outline letters read a full weight lighter than the monogram they follow,
and the rule made a two-part lockup out of a one-part name. Both are rejected.

The word is now drawn as exploration 01 draws it: **O T A in solid, heavy
letterforms of the same visual weight as the N**, on tight tracking, with **no
rule**. The stem weight is `7.3` on a cap band of `28` (the same 0.26 ratio the
tile's N carries), the three letters keep the cap band `y 3.5–31.5` and the
span `x 0–84.1` inside the unchanged `viewBox="0 0 92 42"`, so no surface moves.

**Filled paths, not `<text>`.** Both were acceptable in principle. `favicon.svg`
and `og.svg` are opened *without* the page's CSS and without its web fonts, so a
typeset word would fall back to whatever the viewer has; and a rasterised
`og.png` would then differ per machine. One drawing, in paths, renders
identically in Chromium, Firefox and WebKit and survives both standalone files.

The mark, the QUÉBEC badge and every colour are untouched: the word takes
`fill="currentColor"` on the page and the page's existing ink in `og.svg`. No
new literal colour enters the tree.

Carried by:

- `apps/web/public/index.html` — the single `<symbol id="nota-wordmark">`; every
  other copy on the site (header, footer, intro film, SEO landing pages via
  `apps/web/seo-pages.mjs`) stays a `<use href="#nota-wordmark">`;
- `apps/web/public/og.svg` — the same three paths, inlined, because the file is
  standalone; `og.png` re-rendered from it and its digest re-pinned in
  `truthful-claims.test.mjs`;
- `apps/admin/public/index.html` — the admin header's own single copy.

`apps/web/public/favicon.svg` is the mark alone and was already correct.

Guarded by `apps/web/test/ux-nav.test.mjs` (P2-19), which now asserts one
`<symbol>` per drawing, every copy a `<use>`, a filled word with no `stroke` and
no `fill="none"`, the same three letterform paths in `og.svg`, no `<text>` or
`font-family` in either standalone file, and — by path — that neither the
retired outline O nor the retired signature-line rule can return on the page, in
`og.svg`, or in the admin shell.

**Still open.** Two chrome lockups predate this decision and were left alone
because changing them changes what a page *spells*, not how it is drawn: the
signing room (`apps/web/public/signature.html`, three places) and the brand
guide (`apps/web/public/brand.html`) set the mark beside the live text
« nota. » — so the N is said twice and a period is added. `apps/api/src/emails.js`
does the same in the email shell, where SVG cannot be used at all. They carry no
outline word and no rule, and their letters are already solid and heavy. Making
them read « OTA » is a copy decision for the owner.

---

## Amendment — 2026-09-11, later the same day: variant C, then design 02 · layout 16 · details 22 + 27

- Status: Accepted
- Date: 2026-09-11

The owner, on the solid word shipped that morning: **« make it a bit more
square … a key differentiator that will be unique »**. Variant C « square tile,
square signal » is the drawing. Three boards of nine followed, each answered
the same day:

1. **layouts** → **02 « Signal repris par le badge »** retained;
2. **size and alignment** → **16 « Centré à 60 % »** retained;
3. **letter details** → **22 « Le T signé »** and **27 « Le point final »**,
   combined.

This completes the drawing; nothing below is open.

### The drawing (variant C + 22 + 27)

Against the morning's symbols, exactly these deltas — every copy is
byte-identical to them:

- the tile is `<rect width="64" height="64" rx="7" fill="#264961"/>` (was
  `rx="12"`, briefly `rx="6"` on the board);
- the N's two stems take `rx="1"` (were `rx="2.5"`); the polygon is unchanged;
- the signal is a **square**, not a circle:
  `<rect x="40" y="8" width="16" height="16" rx="3" fill="#407598" stroke="#264961" stroke-width="3"/>`
  replaces `<circle cx="48" cy="16" r="8" …/>`;
- the O is a **square portal**:
  `M0 8.5a5 5 0 0 1 5-5H22a5 5 0 0 1 5 5V26.5a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5ZM7.3 12.3v10.4a1.5 1.5 0 0 0 1.5 1.5h9.4a1.5 1.5 0 0 0 1.5-1.5V12.3a1.5 1.5 0 0 0-1.5-1.5H8.8a1.5 1.5 0 0 0-1.5 1.5Z`;
- the T's stem ends in a **bevel** echoing the N's diagonal (22):
  `M28.4 3.5H55V10.8H45.35V27.3L38.05 31.5V10.8H28.4Z`; the A is unchanged;
- a **signal square closes the word like a period** (27):
  `<rect x="87.4" y="27.1" width="4.4" height="4.4" rx="1" fill="#407598"/>` —
  the one colour literal allowed inside the wordmark besides `currentColor`,
  because it is the signal's own value;
- the wordmark's `viewBox` is its **cap band**, `0 3.5 91.8 28` (letters
  x 0–84.1, period to 91.8, caps y 3.5–31.5), so a word box `--lockup-word`
  tall renders caps exactly that tall; every `<svg class="brand-word-svg">`
  that `<use>`s it is the matching `0 0 91.8 28` box.

### The geometry (design 02 · layout 16) — five properties, declared once

The lockup no longer carries a hand-placed size per surface. Each surface
stylesheet declares **the same five custom properties, once, on its lockup
root** (`.brand, .footer-brand, .ig-wordmark` in `styles.css`;
`.brand, .video-brand, .paper-brand, .footer-brand` in `signature.css`;
`.admin-brand` in `admin.css`) and a surface re-sets `--lockup-tile` alone:

| Property | Value | Meaning |
| --- | --- | --- |
| `--lockup-tile` | `30px` carnet/admin · `35px` room (26/30 on phones; 25/24 stage, paper, footer) | the tile |
| `--lockup-word` | `calc(var(--lockup-tile) * .60)` | cap height of O T A, **vertically centred** on the tile |
| `--lockup-gap` | `calc(var(--lockup-tile) * .12)` | tile → word |
| `--lockup-badge-gap` | `calc(var(--lockup-tile) * .16)` | word → badge |
| `--lockup-badge-size` | `calc(var(--lockup-tile) * .16)` | badge font-size |

The **QUÉBEC badge takes the signal colour**: `--nota-blue-500` ground, white
text (`--on-accent`, 4.99:1) in both themes, weight 800, tracking `.1em`,
padding `.55em .7em`, radius `--radius-xs` (the 3 px step of the square
register). The pale `--nota-blue-50` / `--nota-blue-800` badge is retired.

`og.svg` draws the same thing standalone — one commented transform group per
element (`#og-tile` = the logomark verbatim at ×1.5, `#og-word` at
57.6 / 28 = 2.0571 centred on the 96 px tile, `#og-badge` on `#407598` with
`#ffffff` text) — and `og.png` is re-rendered from it, digest re-pinned. The
email shell (`apps/api/src/emails.js`, `docs/signature-courriel.html`) carries
the same ratios as one constant set, `LOCKUP` (40 px tile: 33 px font ≈ 24 px
caps, gaps 5 / 6 px, badge 7 px), tile radius on the 6 px step, the signal as
« ■ », the period typeset in the signal colour — the bevelled T cannot be.

Guarded by `apps/web/test/ux-nav.test.mjs` (P2-19): the drawing by path
signature on the symbol, the signing room, the admin shell, both favicons and
`og.svg`; refusal of the round signal, the `rx="12"` tile, the `rx="2.5"`
stems, the rounded and outline Os, the straight T and the rule; the cap-band
viewBoxes; the five properties with these exact ratios declared once per
stylesheet, no tile or word sized in px, and the badge on `--nota-blue-500` /
`--on-accent` on every surface. `signature-room.test.mjs` keeps the room's
symbols byte-identical to the carnet's; `emails-brand.test.mjs` pins the text
lockup and `LOCKUP`; `truthful-claims.test.mjs` pins the `og.svg` digest.
