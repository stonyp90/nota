# Investor presentation and business plan verification — 2026-09-12

## Delivered experience

- Nine native SVG pitch slides per language, with selectable content, source links, accessible transcripts, replay, pause, opt-in auto-advance, keyboard and swipe navigation.
- A separate eight-chapter business plan per language. Each chapter has its own diagram and a detail panel. The local-market assumptions and twelve monthly cash balances are interactive. Printing includes all detailed chapters.
- Direct icon buttons, short chapter buttons and details on demand replace explanatory controls and repeated page headings.
- Shared Nota header, gutters, Sora/Inter typography, ink, badge and controls. Both presentations fit the desktop viewport and use finite animations tied to the dossier, matching, preparation, market and signing sequence.
- One header logo in normal viewing. A stage logo appears only in fullscreen. Individual SVG, PNG and PDF slides have no repeated logo.
- The French and English pitch PDFs contain nine vector slides each, with selectable text and clickable primary sources.

## Evidence and assumptions

The source registry is docs/pitch-deck/investor-sources.json, and is included in the generated model and embedded slide data.

- APCIQ: 10,271 residential Centris resales in the Québec CMA and 97,214 provincially during 2025.
- CREA: 470,314 residential Canadian MLS transactions during 2025.
- These territories are nested and must not be added. Québec CMA is not the municipality. Transactions are not automatically eligible urgent notarial acts.
- CNQ: 2,659 individual notaries in traditional practices as of March 31, 2025; this is not a firm or paid-seat count.
- CNUE: nearly 50,000 notaries across its EU membership. UINL: 93 member notariats. These are international reference pools, not a validated software TAM.
- The 205-act local example uses three explicit assumptions: 10% qualification × 25% capture × 80% completion. It is distinct from the financing/refinancing forecast of 244 completions in Year 1.
- The 80% preparation target is unproven. Its proposed measurement includes human review and correction time on defined repeatable preparation tasks. Professional judgment and final approval remain with the notary.
- Electronic notarial signing already exists; Nota's signing room is a rehearsal. Authorized integration and the notary's assessment remain necessary.
- No commercial traction is invented. Existing demonstrations and tests are distinguished from settled revenue and completed commercial acts.
- Existing financial assumptions are preserved. Rounded amounts are formatted by @nota/domain. The base case shows approximately CAD 45,377 at Year 1 end and at least CAD 180,119 of further capital before unmodeled obligations.
- The owner clarified that “commission” means the existing client-paid Nota fees. The current referral rewards imply a maximum Year 1 allocation of CAD 22,850, or approximately CAD 94 per completed act, leaving approximately CAD 92 contribution per completed act in the model. Rewards are already inside acquisition budgets and are not subtracted again from annual results.
- The proposed AI offers are free access with voluntary structured contributions to model improvement, or paid access without that contribution requirement. The proposed Nota signing protocol must be presented to the Chambre for the necessary validations; no acceptance is claimed.

## Verification

- python3 docs/pitch-deck/test-render-slides.py: 4/4 meaning, financial formatting, SVG/source and repeatable-generation checks passed.
- node --test docs/pitch-deck/test-investor-deck.mjs: 7/7 integration tests passed.
- All 34 bilingual pitch/plan frames: text bounds and pairwise overlap checks passed; no browser page errors.
- Viewports 390, 768 and 1280 px: no horizontal overflow; both headers remain 52 px; mobile menus open and dismiss.
- Fullscreen branding, arrow navigation, replay/pause, reduced motion, chapter detail, market controls and cash markers passed.
- Both pitch PDFs were rebuilt from the same native slide data. Visual review includes all pitch frames via contact sheets, individual slides, PDF renders, and the business-plan presentation in normal and fullscreen modes.

Generated assets and source data travel together. Publication is a separate deployment step; local verification does not imply that production domains have changed.

## Latest editorial direction

The nine-slide investor story is in docs/planning/investor-editorial-plan.md. It prioritizes the problem, market and target share, partner distribution, three product phases, contribution after rewards, scaling, the client/notary/partner value loop, and the funding ask. The eight-chapter plan preserves the substantive financial and operating evidence under the relevant chapter.

## Checks after integration on the consolidated branch

- Shared brand suite: 140/140 passed.
- Investor browser integration: 7/7 passed on the repository files.
- Content, financial formatting, sources and stable regeneration: 4/4 passed.
- Web build passed. The built bundle contains nine pitch slides, eight plan chapters, both languages and only the eighteen current pitch images.
- Local stack: all twelve presence, freshness and seeded-data checks passed; the document check identifies nine bilingual pitch slides.
- The underlying consolidation at f995cd6 already passed all 1,120 web tests, domain/API, admin, BDD and builds. This follow-up changes documentation and its bundle check only.
