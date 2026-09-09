# First-arrival films — outcome and brand pass

The client and notary introductions now use four distinct scenes on the existing 20-second timeline. Each scene has one headline and one supporting line. The client story is find a notary, propose a date and price, connect once a notary accepts, and start a request. The notary story is find suitable work, review the proposed conditions, connect with a client, and browse requests.

Nota's existing symbol and a readable wordmark appear on the audience chooser and remain in a masthead throughout playback. Large opening and closing signatures and a still background wordmark reinforce the brand. Repeated cards, dollar graphics, and competing decorative motion were removed. On the shortest landscape phones, the masthead carries the brand so the scene and final action fit.

French scene text decreased from 103 to 58 words for clients and from 95 to 54 for notaries (whitespace counts of scene text, including brand labels and CTA text). The unchanged duration leaves more reading time. Acceptance is conditional: “Dès qu’un notaire accepte…” The price-review and payment-at-signing lines remain in the client finale. New final buttons use the existing dismissal and navigation path to open the calendar or notary pane.

## Verification

Browser layout checks covered all four scenes for both audiences in French and English at 320×568, 390×844, 568×320, 768×1024, 1024×768, 844×390, and 1440×900. All 112 scene layouts had matching container and scroll dimensions, with no scene overflow. Screenshots were inspected at desktop, phone, and landscape sizes. The chooser remains scrollable on unusually short screens. Playback, pause/resume, and automatic client handoff were inspected in the browser; CTA tests verify routing, remembered dismissal, restored interaction, and focus for both audiences.

- Local stack freshness: eight checks passed.
- Focused intro tests: 23 passed.
- Translation coverage: 16 passed.
- Navigation/design and intro UI checks after the final styling changes: 45 passed.
- Domain/API: 392 / 1,854 passed.
- Admin: 237 passed.
- BDD: 205 scenarios / 1,122 steps passed.
- Production build and JavaScript syntax checks passed.
- Full web suite: 900 tests passed, zero failures or skips.

These are local changes. No deployment was performed. Preview at `http://localhost:4173/?intro=1&lang=fr` (or `lang=en`). Comprehension has been reviewed editorially, not measured with first-time users.
