# Client calendar walkthrough

The calendar keeps its original quiet presentation. The rejected “Start here”
heading, disclosure, per-cell “Choose” labels and standalone client clip were
removed. The calendar controls and dates now share the hero’s left edge.
Direct booking buttons retain their existing behavior.

The client introduction is a short four-scene animation: choose a date,
describe a refinancing, review the two price lines, and publish. Its dates
come from the domain calendar helpers. At the owner's final request, the
calendar stays visible on the right while the explanation changes on the
left. The calendar carries one persistent Nota signature, following the
owner's later request to make the brand more recognizable, without a numbered
step strip. On portrait phones the calendar and explanation stack without
overlap. It retains pause, scene navigation,
French/English, and reduced-motion support, without a “silent demo” caption
or a second play label.

Finishing the client film starts an optional contextual walkthrough in the
actual carnet. The client onboarding CTA also starts it, and the existing
help button can replay it. A separate local completion flag keeps it quiet
after skipping or finishing. Notary entry and ordinary reloads stay unchanged.

The six steps follow date selection, act, criteria, price, contact details,
and publication. The real form owns all data and validation. The guide’s
Continue action uses that same validation; the guide never fills fictitious
contact details or posts an offer. On touch screens it also explains the
existing date-preview confirmation. Going back follows the form’s current
screen. Completing the guide leaves publication to the client’s explicit click.

The card moves inside the native booking dialog, where it remains keyboard
accessible. Skip and Escape remove the guide without losing entered data.
Open custom selects retain their own Escape handling. The target is outlined
and associated with its explanation; the date remains clear of the floating
card. Reduced motion does not block the walkthrough.

The arrival screen now places the Nota mark, headline and three audience
choices together on the left, with the date/price examples on the right.
On phones those sections stack in reading order. Each choice has a short
subtitle: “Choisir ma date et mon prix”, “Consulter les demandes”, and
“Créer et partager mon code”. A confirmed partner instead sees “Partager
mon code”. The partner choice opens the existing registration or sharing
panel directly and retains real email verification. French/English controls
are visible in the arrival screen and both films.

The date sheet separates the visitor's next action from other clients'
published offers. Its primary action is “Préparer mon offre”; the date
editor and existing offers are separate disclosures. See
`2026-09-12-date-preview.md` for its responsive and focus checks.

## Validation

Logs and screenshots are local under `output/client-calendar-qa/` (ignored
by Git). Earlier tests of the rejected calendar banner are superseded by
`e2e/client-calendar-guide.spec.js`.

- Current intro, arrival, language and i18n checks: 48/48 pass
  (`intro-current.log`). Partner entry behavior: 6/6 pass; date sheet and
  title-color checks: 10/10 pass.
- Current Chromium journeys: 10/10 pass (`current-guide.log`), including
  actual publication, four guided refinancing flows in French/English at
  390/1280 px, skip/reload/replay, keyboard/reduced motion, film-to-guide,
  hero alignment and the responsive date sheet.
- Arrival and film geometry: 2/2 bilingual tests pass at widths 320, 390,
  768, 1280 and 1920 px (`arrival-verified.log`). The short phone viewport is
  320×568. Controls remain at least 44 px; calendar and explanations do not
  overlap. Representative desktop and phone screenshots were inspected.
- The earlier compatibility matrix passed 44/50 cases, including every
  WebKit, iPhone and Android case. Its six Firefox/iPad failures were
  navigation/action timeouts under heavy machine load. The final focused
  rerun passes 10/10 cases, covering all six previous failures with the real
  flows and bounded navigation timeouts (`compatibility-current.log`).
- Domain: 460 pass. API: 2,106 pass. Admin: 245 pass. BDD: 300 scenarios,
  2,105 steps pass. Brand: 140 pass in the final check.
- The second broad web run completed 1,109 tests: 1,095 passed, 13 failed,
  one timed out. Updated intro expectations, shared title tokens and a
  notary fixture cleanup fixed the identified causes; all affected cases
  passed their focused reruns. The final complete run against the frozen
  files passes **1,120/1,120 tests**, with zero failures or cancellations
  (`web-frozen.log`, 1,130.5 seconds).
- Both production builds pass (`build-current.log`,
  `build-admin-current.log`). Local stack checks: 12/12 pass; their unit
  tests also pass 12/12. The pitch probe now validates complete bilingual
  slide data and navigation, independent of slide wording/count.
- Final staging exposed trailing whitespace in newly added licenses, SVG
  downloads and one browser helper. Whitespace was normalized; the SVG
  generators now emit the same clean formatting. The 140 brand checks and
  web build pass again; the application asset hashes remain unchanged.
