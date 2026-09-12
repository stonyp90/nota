# 54. Shared brand foundations and document navigation

- Status: Accepted
- Date: 2026-09-12

The owner asked for consistent margins, heading sizes, typography, colours,
logos and menu placement across gonota.ca, brand.gonota.ca, plan.gonota.ca,
pitch.gonota.ca and the application surfaces.

`apps/web/public/styles.css` remains the authority for typography, the spacing
scale and logo proportions. `apps/web/brand-foundations.css` owns shared page
geometry: a 1600px outer rail, responsive 16–28px gutters, a 52px header and
44px control targets. Header tiles use the product's 28px size. The wordmark
uses the current text ink in both themes. Long paragraphs retain a narrower
reading measure within the common outer rail.

Header badges share the public product's neutral grey background, muted ink,
9px minimum label and line height. The guide distinguishes this compact
navigation treatment from the blue badge in downloadable brand assets.

`apps/web/scripts/sync-brand-foundations.mjs` embeds the same generated block
in web, admin, signing, brand, plan and pitch. Acquisition pages use the same
generator. Both builds run it; `npm run brand:generate` runs it explicitly,
and `--check` detects drift without writing. The business-plan generator also
refreshes the block. Documents remain self-contained and no runtime dependency
is introduced.

Document headers place the logo on the left and commands on the right. At
700px and below, a native details menu contains document commands; Escape and
outside clicks close it. It is explicitly opened on desktop because CSS display
alone does not make the contents of a closed details element accessible.
The product and private console keep their application-specific navigation.

The guide documents this geometry in French and English. Document controls
use `nota.lang`, accept `?lang=fr|en`, and retain legacy saved preferences as
a fallback. The plan's existing French executive summary and complete English
document remain distinct editions; this change does not claim to translate the
complete business plan.

The web build now packages both document viewers and their current PDF exports.
The former historical PowerPoint is no longer distributed by CI or deployment.
Historical PowerPoint files remain in the repository as source history, not as
current deliverables. The presentation retains its 1600×900 composition,
consistent slide headers and the existing 1.5× document type scale. Shared slide
labels use the product dictionary and currency uses `money()` / `moneyEn()`.

Regression coverage checks embedded foundations, documented logo proportions,
shipping assets, mobile menu interaction and measured header geometry across
seven surfaces at 390, 1280 and 1920px in both themes. The existing brand audit
also accepts an explicit `BRAND_PITCH_HOST` for post-deployment verification.
