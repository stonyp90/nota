# Calendar acceptance film — 2026-09-12

Replaces the 12-second week/month morph with a 27-second, five-step walkthrough:
subscription → incoming calendar offer → real Nota offer → real confirmation →
retained client file. The preview uses a 12 px radius; the month and entries
also have softer corners.

The app frames are actual desktop browser captures. A fictional notary
acted on a fictional financing request using the normal local HTTP handler.
The public offer, framing manifest and successful client API verification are
stored in `demo/calendar-captures/`. The calendar scene is illustrative and
explicitly preserves the provider synchronization caveat. The film shows the
real confirmation step before acceptance, not an invented provider action.

Validation:

- Both exports: H.264, 1280 × 576, 24 fps, exactly 27 seconds, no audio track.
- FR/EN story frames checked for text, amount/date consistency, framing and
  visible Retenir / Take on controls.
- Real client API returned `retenue` with the same service, signing date and
  amount. Notification output stayed in the local file mailbox.
- Browser: the French and English MP4s reached readyState 4 and played in the
  actual notary landing, with currentTime advancing and duration 27.
- Desktop: no horizontal overflow; the frame computed to radius 12 px.
- Initial targeted run: 34 CSS, i18n and MP4 HTTP/range tests passed. Final
  rerun: 33 passed; the index translation-coverage test reports eight strings
  in the independently changing Partners section. None are film captions.
  Production web build and changed-file whitespace checks passed.

The image sources contain only fictional demo identities and no access tokens.
Full captures are kept for review; the SVG composition crops them to the actual
panels. Public asset URLs were refreshed with their new content hashes.
