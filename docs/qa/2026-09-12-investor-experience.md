# Investor presentation and business plan verification — 2026-09-12

## Delivered experience

- Sixteen native SVG pitch slides per language, with selectable content, source links, accessible transcripts, replay, pause, opt-in auto-advance, keyboard and swipe navigation.
- A separate eight-chapter business plan per language. Each chapter has its own diagram and a detail panel. The local-market assumptions and twelve monthly cash balances are interactive. Printing includes all detailed chapters.
- Shared Nota header, gutters, Sora/Inter typography, ink, badge and controls. Both presentations fit the desktop viewport and use finite animations tied to the dossier, matching, preparation, market and signing sequence.
- One header logo in normal viewing. A stage logo appears only in fullscreen. Individual SVG, PNG and PDF slides have no repeated logo.
- The French and English pitch PDFs contain sixteen vector slides each, with selectable text and clickable primary sources.

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
- The pre-existing conflict between the repository's commission instruction and the separate-fee planning model remains explicit. This change does not alter billing or grant legal approval.

## Verification

- python3 docs/pitch-deck/test-render-slides.py: 3/3 meaning, financial formatting and SVG/source checks passed.
- node --test docs/pitch-deck/test-investor-deck.mjs: 6/6 integration tests passed.
- All 48 bilingual pitch/plan frames: text bounds and pairwise overlap checks passed; no browser page errors.
- Viewports 390, 768 and 1280 px: no horizontal overflow; both headers remain 52 px; mobile menus open and dismiss.
- Fullscreen branding, arrow navigation, replay/pause, reduced motion, chapter detail, market controls and cash markers passed.
- Both pitch PDFs were rebuilt from the same native slide data. Visual review includes all pitch frames via contact sheets, individual slides, PDF renders, and the business-plan presentation in normal and fullscreen modes.

Generated assets and source data travel together. Publication is a separate deployment step; local verification does not imply that production domains have changed.
