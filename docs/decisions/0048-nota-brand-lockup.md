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

---

## Amendment — 2026-09-12: the monogram leads, the word follows

- Status: Accepted
- Date: 2026-09-12

The owner, looking at the served lockup: **« mettre le N un peu plus bold, puis
mettre le OTA un peu moins bold. »**

Until today the two halves of the lockup were drawn to the same visual weight —
that was the explicit intent of the 2026-09-11 amendment, which set the word's
stem at `7.3` on a cap band of `28` precisely so that O T A would carry « the
same visual weight as the N ». At the sizes the product actually serves the
lockup, that parity reads as competition: a four-letter word set as heavily as
the monogram beside it flattens the mark into the first letter of a wordmark
instead of a tile the word hangs off.

So the two weights part company. The monogram is now the heavier of the two:

| | before | after | ratio to its cap band |
| --- | --- | --- | --- |
| N stem (tile, cap band 34) | `7.5` | `8.5` | .22 → .25 |
| O T A stem (word, cap band 28) | `7.3` | `6.5` | .26 → .23 |

Nothing else moves. Every outer silhouette is untouched — the tile is still
`rx="7"` on 64, the signal square still `x 40 y 8 16x16 rx 3`, the O's square
portal still spans `x 0-27` on the cap band `y 3.5-31.5`, the T's bar still runs
`x 28.4-55`, the A keeps its cut apex, and the word still ends on the signal
period at `x 87.4`, so the span stays `91.8` and the `--lockup-*` ratios, the
`viewBox`es and every surface's layout are unchanged. The weight change is
carried entirely by the inner contours:

- **N** — both stems `7.5 → 8.5`, the right stem's left edge moving `40.5 → 39.5`
  so the stem's outer edge stays on `48`; the diagonal's horizontal run grows
  `8 → 9.1` to hold the same ratio, giving `16,15 25.1,15 48,49 38.9,49`.
- **O** — the counter grows: the inner rectangle goes from `x 7.3-19.7 / y
  10.8-24.2` to `x 6.5-20.5 / y 10-25`, leaving `6.5` on all four sides.
- **T** — the bar's underside rises `10.8 → 10`, the stem narrows to `6.5`
  around the same axis (`38.45-44.95`), and the bevel keeps the N's angle, so
  its right edge now turns at `27.76` instead of `27.3`.
- **A** — the outer silhouette, cut apex included, is byte-identical; the legs,
  the bar and the counter move outward by the same `.89` factor, giving feet
  inner `77.15` / `61.85`, a bar top at `26.83` between `63.29` and `75.88`, and
  a counter apex at `8.84` over a base at `21.22` between `65.02` and `73.98`.

### What this touched

Fourteen files, because the drawing exists in fourteen places and a lockup that
is a weight behind on one surface is the drift this ADR exists to prevent: the
web and admin shells and their favicons, `og.svg`, the signing room, the brand
guide, the explorations board, the pitch deck, the business plan and its
renderer, the pitch-deck mark, and the two guards that pin the paths.

`og.png` was re-rendered from `og.svg` and its digest re-pinned in
`truthful-claims.test.mjs`. **The three PWA rasters were found stale**:
`icon-192.png`, `icon-512.png` and `apple-touch-icon.png` still carried the
drawing retired on 2026-09-11 — the round signal dot, the `rx 12` tile and the
rounded N stems — because nothing regenerates them and no guard reads them.
They are re-rendered from `favicon.svg`, and `apple-touch-icon.png` is now
flattened onto the mark square so iOS does not paint its own black behind the
tile's transparent corners.

**Still open.** Nothing regenerates the raster icons and no test reads them, so
they can go stale again the next time the drawing moves. A guard that rasterises
`favicon.svg` and compares it to the three PNGs would close that hole; it is not
written yet.

### Two paragraphs of this ADR were out of date, and are struck

The 2026-09-11 amendment closed on a **« Still open »** note: three chrome
lockups were said to set the mark beside the live text « nota. », so the N was
said twice and a period added, and making them read « OTA » was called a copy
decision waiting on the owner. **That decision was already taken in the tree and
the paragraph is struck.** Measured today:

- `apps/web/public/signature.html` draws the word five times, every one a
  `<use href="#nota-wordmark">`;
- `apps/web/public/brand.html` draws it four times, every one a `<use>`, with no
  live text left;
- `apps/api/src/emails.js` cannot use SVG at all, so it typesets the lockup —
  and it typesets a tile `N` plus the signal square, then `OTA` closed by a
  period in the signal colour. It reads `N ■ OTA.`, never « nota. ».

The email shell is the one place where the weight relationship decided above
cannot be drawn, only set. It now carries the same hierarchy with the one lever
type gives it: the tile's `N` stays at `800` and the word drops to `700`, in the
shell and in the personal signature `docs/signature-courriel.html`, both pinned
by `emails-brand.test.mjs`.

One more surface was a version behind and is now current:
`apps/web/public/brand-blanc.html`. It is untracked, it is served straight out
of `public/`, nothing links to it and no guard lists it, so it kept the retired
O, the straight T and the `7.5` N stems while every other surface moved twice.
An untracked page inside a served directory is a brand surface whether or not
anything points at it.

---

## Amendment — 2026-09-12, le soir : le deck et le plan cessent d'avoir une marque à eux

- Status: Accepted
- Date: 2026-09-12

Le propriétaire : **« s'assurer que le pitch deck, l'admin, l'app et le site
utilisent tout le brand, de la meilleure façon possible. »**

Le dessin du lockup était déjà le même sur les quatorze surfaces — c'est ce que
les trois amendements précédents ont réglé. Ce qui ne l'était pas, c'est tout le
reste de la marque. Mesuré sur les surfaces servies :

| | avant | après |
| --- | --- | --- |
| Coins du deck | 999px · 50% · 5 · 7 · 9 · 10 · 14 · 16px | 12 / 8 / 6 / 3, par jeton |
| Coins du plan | 999px · 2 · 4 · 5 · 7 · 9 · 10 · 14px | 12 / 8 / 6 / 3, par jeton |
| Coins de la console | deux gélules `99px` dans le CRM | `--radius-xs` · `--radius-sm` |
| Coins de la salle | 24 littéraux, dont 13 hors barreau | jeton partout |
| Fontes du plan | Inter, Sora **et SF Mono** (116 éléments) | Inter et Sora |
| Aplats de marque | 5 boutons (langue du deck, langue/lentille/focus du plan, langue de la console) | aucun |

### Ce que la marque est, au-delà du dessin

Une surface porte la marque quand elle emprunte **le vocabulaire**, pas seulement
les valeurs. Le plan d'affaires prouvait le contraire : ses couleurs étaient
justes — `--brass` valait bien `--nota-blue-600` — mais il les appelait
`--brass`, `--verdigris`, `--oxide`, `--rule`, `--muted`, `--faint`, `--ink-2`,
`--surface-2`, `--paper`, `--on-fill`, `--body`, `--display`, `--mono`. Un nom
parallèle est une marque parallèle : il rend la dérive invisible au `grep`, il
autorise une valeur à diverger sans que rien ne le signale, et il empêche la
règle d'être transportée d'une surface à l'autre. Les rôles portent désormais les
noms du produit sur les deux documents : `--brand`, `--brand-bright`,
`--brand-wash`, `--brand-on-surface`, `--brand-hover`, `--border`,
`--border-strong`, `--ink-muted`, `--surface-inset`, `--bg`, `--on-accent`,
`--danger`, `--font-sans`, `--font-display`, `--brand-word-ink`.

Un dessin garde ses formes : les glyphes de chapitre du plan (`.signal--*`) et
les orbites décoratives du deck restent ronds. Un rond dans une illustration est
une forme, pas un coin d'interface.

### Ce que le générateur possède

`docs/planning/render-business-plan.py` lisait le premier bloc `<style>` de sa
**propre sortie précédente** comme feuille de base. Le jour où un `<style>` de
polices est passé devant, la génération suivante l'a recopié à la place de la
vraie feuille et a emporté les trois `:root` et toute l'échelle `--type-*` : la
page est passée de 1336 à 1042 lignes et `typographie.test.mjs` est tombé sur
vingt jetons nuls. Le générateur possède maintenant sa feuille (`BASE_STYLE`) et
ne se relit plus. Corollaire de méthode : **corriger `docs/business-plan.html` ne
tient pas** — la règle vit dans le script, et le filet le lit lui aussi.

Deux règles mortes en sont sorties : le bandeau `.mast` (et avec lui `.mark`,
`.mark-symbol`, `.mark-region`) n'était plus porté par aucune classe de la
sortie, et gardait une **seconde** version du lockup — un badge en gélule sur
`--brand-wash` au lieu du badge d'ADR 0048, et le mot peint sur `--ink` au lieu
de son encre à lui.

### Deux défauts d'interface trouvés en chemin

- Le sélecteur `.stage button` du deck habillait *tout* bouton du plateau, donc
  l'outil « Full screen » héritait la position absolue, la boîte 2,6 × 4 rem et
  le glyphe à 1,5 rem des flèches de navigation : **son libellé débordait du
  plateau**. La règle ne vise plus que les flèches et la navigation plein écran,
  et l'outil se retire au repos comme l'étiquette de planche en face de lui.
- `.password-toggle` et `.password-control` de la console n'avaient **aucune
  règle** : le navigateur peignait sa propre gélule grise sous le champ, sur le
  premier écran que quiconque voit de l'admin. Le bouton se loge dans le champ.

Et une adresse morte : le plan annonçait `https://plan.gonata.ca/` sur sa page de
couverture, alors que `infra/gonata.tfvars` sert `plan.gonota.ca` — la faute de
frappe était corrigée dans l'infrastructure mais pas dans le document qu'on
montre avec la levée. (`infra/variables.tf` et `infra/outputs.tf` la répètent
encore dans leurs descriptions ; ce n'est pas servi, mais c'est à reprendre.)

### Trois rasters et une chrome, trouvés en relisant les surfaces

- **Les 32 planches du deck étaient une graisse en retard.** L'amendement du
  matin a changé `docs/pitch-deck/nota-mark.svg`, mais `dark-slide-*.png`
  dataient de la veille : la planche 1 montre la tuile en grand, donc le deck
  servait le N retiré sur 32 images pendant que son en-tête servait le nouveau.
  C'est le même trou que les trois rasters PWA. Refaites par le chemin du
  README (`render-slides.py --svg-out` puis `rasterize-slides.mjs`).
- **`rasterize-slides.mjs` tirait Inter et Sora de `fonts.googleapis.com`.**
  C'est du temps de compilation, donc aucune exposition d'un visiteur — mais
  cela rendait les planches non reproductibles hors ligne et dépendantes de la
  coupe servie ce jour-là, alors que les mêmes woff2 sont dans l'arbre. Il lit
  maintenant `apps/web/public/fonts` et les embarque en base64 (une page
  `setContent` n'a pas d'origine, donc `file://` y serait refusé). Le garde-fou
  qui refuse d'écrire tant que `document.fonts.check` ne confirme pas Sora 800
  et Inter 700 est intact.
- **La console n'annonçait que la chrome claire** (`theme-color: #386888`),
  alors qu'elle a un thème sombre qui répond. Le web en porte deux ;
  `ux-nav.test.mjs` ne lit que le web, donc personne ne l'avait vu.

### Le filet

`apps/web/test/registre-carre.test.mjs`, sept tests : aucun coin au-dessus du
barreau haut sur aucune surface ; chaque coin littéral sur 12 / 8 / 6 / 3 ; la
console et la salle lisent leurs coins par jeton ; les quatre barreaux portent la
même valeur dans chaque copie de l'échelle ; le générateur du plan n'écrit ni
gélule ni coin hors échelle ; **aucun jeton ne se pointe lui-même** ; et chaque
surface annonce sa chrome dans les deux thèmes. `e2e/brand-conformance.spec.js`
passe ses quatorze surfaces.

Le sixième test vient d'une faute commise pendant cette passe : `--oxide` n'était
qu'un second nom pour `--danger`, et le renommer a produit
`--danger: var(--danger)` — déclaration invalide, jeton vide, plus aucun rouge
sur la page, et **aucun test ne tombait**.

### Deuxième vague, le même soir : chaque application, pilotée à la main

Le propriétaire, sur la première vague : **« ensure this is the best it can be
and that each and every app is using it. »** Les mesures ci-dessus étaient des
lectures de fichiers ; celles-ci viennent d'avoir piloté chaque surface dans un
navigateur, connecté, en clair et en sombre, à 320 / 375 / bureau.

- **Cinq contrôles du carnet et un de la console sortaient en Arial.** Un
  `<button>` n'hérite pas de la fonte de la page : le navigateur lui impose la
  sienne, et une règle sans `font` la laisse passer. Vingt éléments à 375 px —
  `.icon-btn`, `.cell-chevron`, `.tswitch`, `.sup-fab`, `.mini-btn` au carnet,
  `.icon-btn` à la console — écrivaient donc dans une **troisième fonte** que
  personne n'avait choisie. `font: inherit` sur chacun.
- **Le titre de la salle de signature était bleu au tiers.** « Un même espace. »,
  la troisième ligne du h1, prenait `var(--brand)` par `.welcome h1 span`.
  `registre-encre.test.mjs` ne lisait que les sélecteurs *finissant* par un
  titre, donc un morceau de titre passait dessous. Le filet lit maintenant les
  balises nues d'un titre (`h1 span`, `h2 strong`…), tout en laissant bleu un
  descendant CLASSÉ, qui mentionne une information — `.nc-h .nc-h-amt` tient.
- **Deux cibles tactiles sous les 44 px.** Le choix de langue de la console
  mesurait 30 × 22 px sur téléphone (il manquait à la liste du bloc
  `pointer: coarse`), et celui de la salle redescendait à 36 px de large sous
  380 px de fenêtre. Mesuré : à 320 comme à 375, la barre de la salle tient
  **sans** ce rétrécissement, donc la cible revient gratuitement.

### L'icône maskable : le signal se faisait couper sur Android

Les deux manifestes déclaraient `icon-512.png` en `purpose: maskable`. Android
ne dessine pas l'icône qu'on lui donne : il la recadre à la silhouette du
lanceur et ne garantit que les **80 % centraux**, un cercle de rayon `.4 × côté`.
Le coin extérieur du carré de signal tombe à 33,94 unités de tuile du centre,
soit **271 px à 512 pour un rayon sûr de 204,8** — le détail autour duquel la
marque est construite était coupé sur chaque écran d'accueil Android, dans les
deux langues.

`icon-maskable-512.png` est l'actif dédié : fond pleine bordure sans rayon,
puisque le lanceur fournit la silhouette, et le dessin centré sur sa propre
boîte d'encre puis réduit jusqu'à ce que sa demi-diagonale tienne dans le cercle
sûr (×0,8939 ici). Les deux nombres sont **calculés depuis le SVG**, jamais
saisis.

### Ce qui ferme le trou des rasters

L'amendement précédent laissait ouvert : « rien ne régénère les icônes et aucun
test ne les lit ». Les deux existent maintenant.

- `apps/web/scripts/render-icons.mjs` — une commande, quatre PNG, tous depuis
  `favicon.svg` : aucune géométrie n'est posée à la main, et deux exécutions de
  suite donnent les mêmes octets.
- `apps/web/test/icones-marque.test.mjs` — un lecteur PNG de quarante lignes
  (zlib, 8 bits, RGB ou RGBA) qui **sonde les pixels** aux coordonnées que
  `favicon.svg` prédit : le jambage du N est blanc, le carré de signal porte la
  couleur du signal, le coin de la tuile reste transparent sur l'icône « any » et
  plein sur celle d'iOS, et le point le plus éloigné du dessin maskable tient
  dans le cercle sûr. Vérifié en remplaçant l'actif par la tuile pleine bordure :
  le test tombe.

### Le filet d'encre avait deux mailles

Signalé par une session sœur en lisant le correctif ci-dessus, et vérifié :
`registre-encre.test.mjs` ne reconnaissait que `var(--brand…)`, donc un titre
peint au bleu de **palette** (`var(--nota-blue-400)`) passait ; et il ne lisait
que trois feuilles servies, donc une page qui porte son style **en ligne** lui
échappait entièrement. Le filet lit maintenant la rampe et ses valeurs nues, et
ouvre le `<style>` des documents autonomes — `brand.html`, le deck, le plan.

Deux sur-titres de plus en sont sortis : `.salle-sas-titre` et
`.salle-portes-titre` étaient en `--nota-blue-300` sur le panneau d'annonce de
la salle. Le panneau est épinglé en nuit, donc l'encre juste y est
`--midnight-ink` — elle existait déjà et n'était pas utilisée là.

Deux exclusions sont écrites dans le filet avec leur raison, parce qu'un filet
qui prétend plus qu'il ne tient est pire que pas de filet :
`brand-explorations.html` (la planche des directions REJETÉES — lui imposer le
registre courant effacerait ce qu'elle existe pour montrer) et les namespaces de
dessin du deck `.learning-*` / `.nota-map*` (ces surcouches reproduisent des
planches rendues en PNG ; les désaccorder de leur image serait un défaut de
plus). La **chrome** du deck, elle, est bien sortie de l'accent chaud.

### Le deck qui voyage

Un deck doit partir en pièce jointe, et les seuls fichiers qui le pouvaient
étaient les huit `.pptx` de `docs/`, qui portent **huit palettes différentes** —
verts `#2E7D6B` `#1D5648`, bruns `#3A2C12` `#B87A17`, rouges `#A8453B`,
sarcelle `#365B62` : le vocabulaire que cet ADR a retiré. Rien dans le dépôt ne
les référence. `docs/pitch-deck/build-pdf.mjs` relie les trente-deux planches
déjà rendues en un PDF par langue (`docs/nota-pitch-deck.pdf`,
`docs/nota-pitch-deck-fr.pdf`, 1600 × 900, pleine page) ; il n'ajoute ni couleur
ni type ni géométrie, il ne fait que relier. **Les huit `.pptx` sont à retirer,
et c'est la décision du propriétaire, pas la mienne.**

**Encore ouvert.** Deux pastilles gardent un aplat de marque et c'est délibéré —
`.beta-badge` de la salle et `salle-annonce-pastille` du carnet : une étiquette
n'est pas une action. Le carnet et la console ne s'accordent pas encore sur le
nom du voile de marque (`--brand-tint-solid` côté web, `--brand-wash` côté admin
et documents) ; les deux documents ont pris `--brand-wash`. Enfin, le dessin du
lockup n'a pas été touché : le propriétaire examine un passage de la tuile bleue
à une marque blanche (`apps/web/public/brand-compose.html`), et geler le dessin
dans trois documents de plus l'aurait fait refaire.

---

## Amendment — 2026-09-12: OTA follows the N's optical height

The owner clarified that the oversized element is the **OTA wordmark**, not the
site's typography. The temporary reduction of the shared text scale is reversed.

The word's cap height moves from **60% to 54% of the tile**, a 10% reduction in
both dimensions. At the 30px header tile, OTA measures 16.2px high instead of
18px; the white N's own 34/64 cap band measures 15.94px. This brings the letters
onto nearly the same cap line while leaving a small optical allowance. The
comparison covered 60%, 56%, 54% and 52% at header and larger sizes, on light and
dark backgrounds. The 54% version keeps the word legible and the N prominent.

The letter paths, tile, colours and proportional gaps remain the same. OTA stays
vertically centred and scales uniformly; it is never horizontally compressed.
Live surfaces, the brand guide, downloads, social image, email approximation,
business plan and pitch deck carry the same proportion. Download geometry now
reads the live CSS ratios instead of maintaining separate hardcoded transforms.
The historical exploration boards retain their original alternatives.

The review was informed by [IBM's optical corrections and cap-height alignment](https://www.ibm.com/design/language/ibm-logos/8-bar/)
and [Atlassian's alignment and clear-space guidance](https://atlassian.design/foundations/logos/).
The 54% ratio is a Nota-specific optical choice, not a universal brand rule.

### Follow-up — lighter OTA, stronger N

The owner's next review asked for smaller/lighter letters and a bolder N.
OTA moves from 54% to **52% of the tile**, a further 3.7% size reduction. Its
O/T stem moves from 6.5 to **6 units**; the A's inner contours follow the same
weight reduction. The N stems move from 8.5 to **9.5 units** and its diagonal
from 9.1 to **10.2 units**, retaining the outer bounds and the square signal.
The word's outer shapes, bevels, cap band and aspect ratio remain intact.

The email approximation uses a 29px OTA at weight 600 and a weight-900 N.
The browser drawing, favicons, downloadable SVGs, social image and document
exports are synchronized. The site's text scale is unchanged.

### Follow-up — a smaller, closer wordmark

The next review asks for slightly smaller, more closely joined letters. OTA
now measures **50% of the tile**, down 3.8% from 52%, and the tile-to-word gap
is **6% of the tile**, down from 12%. At the 30px header size, that means
15px capitals and a 1.8px gap. The already tight O–T–A drawing scales uniformly;
the stronger N and the word-to-Québec spacing keep their current geometry.
The email approximation follows at 28px with a 2px tile-to-word gap.

### Follow-up — a quieter header logo

The owner asks for another small reduction of the complete brand and of the
N-to-O space. Public and admin header tiles move from **30px to 28px**; the
signing surface moves from **35px to 33px**. OTA retains its 50% cap ratio,
so the public header now renders 14px capitals. The shared tile-to-word gap
moves from 6% to **4%**, or 1.12px at the 28px tile. The 9px minimum on the
Québec badge preserves its legibility at these small sizes.

### Follow-up — bolder OTA with more breathing room

The owner asks for more N-to-O space and OTA closer to the N's weight, but
2–3px shorter in the header. OTA moves to **45% of the tile**: 12.6px beside
the N's 14.875px cap at a 28px tile, a 2.275px difference (2.68px on the
33px signing tile). The gap moves to **8%**, or 2.24px in the public header.
O/T stems are **7.8 of 28 units**, matching the N's relative stem weight
(9.5 of 34); the A counters are reduced to carry that weight. The outer
letter bounds, signal period and centred alignment remain the same.
The email fallback uses 25px / 800 OTA, a 29px / 900 N and a 3px gap,
so the text N's cap also approximates the vector's 34/64 ratio.

### Follow-up — optical spacing across O–T–A

The owner finds OTA too small and O–T crowded. The word returns to **50%
of the tile**, or 14px in the 28px header. The T moves **2.6 drawing units
to the right**: the O–T gap grows from 1.4 to 4 units, or from 0.63px in
the previous header to **2px** now. This also tightens the visually open
T–A pair without moving A or the period, so the outer word bounds remain
91.8 × 28. The A counter opens from 4.9 to 7 units at its base, improving
legibility while retaining the cut apex and bold outer legs. N–O remains
2.24px and O/T stems remain 7.8 units. The email approximation follows
at 28px / 800 with -0.02em tracking instead of -0.07em.


### Follow-up — a final reduction and a clearer N–O gap

The owner requests a slightly smaller OTA and a small additional space after
the N. OTA moves from 50% to **48% of the tile** (a 4% reduction), and N–O
spacing from 8% to **12%**. The 28px header now renders 13.44px capitals with
a 3.36px gap. The N, bold letter paths, optical O–T spacing and Québec badge
retain their geometry. The shared styles, downloadable logos and generated
brand assets use the same proportions; the email fallback follows at 27px
with a 5px gap beside its 40px tile.
