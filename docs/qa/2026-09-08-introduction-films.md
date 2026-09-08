# Introduction films — responsive and language verification

The client and notary introductions now explain Nota in the first scene. Each has five concise scenes on a shared 20-second CSS timeline, followed by routing to the corresponding product pane. No video file, external player, or runtime dependency was added. The old miniature interfaces and dense legal slides were replaced with readable steps; detailed professional commitments remain on the notary landing.

Headings start at 32 px, explanatory text and steps at 18 px, and controls at 16 px with 44 px touch targets. Phone layouts stack the steps. Compact and landscape layouts reduce spacing rather than shrinking text. The footer stays outside the film. Pausing freezes both animations and the dismissal timer; hiding the tab also pauses playback. Reduced-motion preferences continue to bypass the introduction.

Both audience choices and both films use the site's language resolver: explicit `?lang=fr|en`, then the visitor's saved choice, then the first supported entry in `navigator.languages`, with French fallback. FR/EN controls are now available in the chooser and during playback. Switching language reloads into the translated chooser.

## Verification

In-app browser checks covered all five scenes of both films in French and English at 320×568, 390×844, 768×1024, 1024×768, 844×390, and 1440×900. Scene scroll dimensions matched their containers in all 120 combinations, with no horizontal or vertical overflow. Visual screenshots were inspected for small phones, tablet, and desktop. These are viewport checks, not physical-device certification.

- `npm run local:check`: all eight checks passed.
- `npm test`: domain and API passed.
- `npm run test:web`: 785 tests passed.
- `npm run test:admin`: passed.
- `npm test --prefix features`: 186 scenarios / 1,069 steps passed.
- `npm run build`: passed.
- Focused introduction, language, funnel and navigation checks: 93 tests passed.

Added coverage verifies both film headings and language selectors against eight browser/stored/URL preference combinations, plus pause/resume deadline accounting. Existing translation coverage verifies every new French string. Pricing checks retain payment-at-signing disclosure and total-price review without embedding an example price in the films.

The changes are local and have not been deployed. Preview with `http://localhost:4173/?intro=1` after starting the local stack.

## Second editorial pass

After the owner's follow-up, the introductions were simplified further: each French scene now contains 14–24 words, the opening names Nota and its purpose directly, and acceptance uses everyday language. Repeated explanations were shortened. Numbers were removed from informational cards and alternative choices so they cannot be mistaken for mandatory steps. English copy also avoids the unexplained word “carnet” in the film.

The revised scenes were checked again at the six viewport sizes in both languages; no scene overflow was found. The web suite passed all 785 tests; after the final wording adjustments, all 29 focused language/intro/translation checks and the build passed. No domain, API, timing or language-precedence behavior changed in this second pass. Readability was reviewed directly; comprehension has not been measured with first-time users.

## Brand motion pass

Added two outlined dollar signs and two instances of the existing Nota logo behind each film, in the existing brand colors. Slow peripheral drift leaves the center readable. Cards enter in a short stagger, a green underline draws below the headline, and the finale logo settles into place. All content entrances finish in the scene's first second; the remaining reading time and 20-second timeline are preserved.

Scene starts and child entrances share the same CSS timing variables. Motion uses transforms and opacity, including the progress bar, without JavaScript frame loops, new dependencies, image downloads or animated blur. Decorations are `aria-hidden` and pointer-transparent. The pause control freezes both decorations and pseudo-element effects. Reduced-motion visitors retain the existing intro bypass.

Visual checks covered mobile and desktop; six-viewport scene overflow checks passed for the French client film and English notary film. Browser inspection confirmed paused animation states and decorative accessibility/pointer settings. The complete web suite passed 785 tests; focused intro/language/accessibility tests passed 36 tests after the final CSS adjustments. Build and diff whitespace checks passed. No deployment was performed.

## Production release candidate

The final motion pass adds animated calendar, acceptance and message icons; card lifts with travelling highlights; animated step numbers; a livelier logo finale; and stronger peripheral drift. The notary narrative now puts choosing conditions before acceptance. Timings still leave the main text stationary and keep the same short duration.

The release was assembled from `7d5e037` in an isolated checkout, containing only this introduction work and its tests. Unrelated local calendar, billing and referral edits were excluded. On this exact release candidate: domain/API tests passed (API: 1,512); Web: 776; admin: 221; BDD: 186 scenarios; focused introduction/translation/accessibility: 36; production build and JavaScript syntax checks passed. The built HTML/CSS/JS were previewed separately from the development tree, including six viewport measurements for client English and notary French, with no overflow.

Deployment uses the existing GitHub Actions production workflow, including its browser-journey and Terraform gates, rather than a direct asset upload. Final workflow outcome and production asset verification are recorded after the run.

### Deployment outcome — 2026-09-08

Commit `3da82c30bd7a5864c32e89e59ae62a67cb1ed05d` was pushed to main and deployed successfully through [production run 34219784756](https://github.com/stonyp90/nota/actions/runs/34219784756). All application, browser-journey, Terraform and AWS delivery jobs succeeded.

HTTPS checks against `https://gonota.ca/` matched the release build byte-for-byte for index.html, all four fingerprinted assets and sw.js. HTML and sw.js return `no-cache`; fingerprinted assets return immutable caching. `/api/health` returned HTTP 200 and `ok: true`.

Published assets: `app.7892bd5f44.js`, `styles.559e56d272.css`, `domain.049e376519.js`, `i18n.0e2ad6af2f.js`. Browser verification on the public domain confirmed the French client film, playback pause and English notary film; the latter completed and opened the notary pane. The public preview was returned to French.

Local main was synchronized to the deployed commit while verifying that existing working-file bytes were preserved. This deployment outcome paragraph is a local QA record added after deployment; the production feature itself is in the commit above.
