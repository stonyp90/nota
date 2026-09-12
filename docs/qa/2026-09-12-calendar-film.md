# Silent calendar clip verification — 2026-09-12

The owner's correction replaces the narrated presentation with a small,
18-second silent loop inside the notary subscription card. It shows Google
Calendar and Outlook with Nota requests appearing and one request opening.
Sources and export instructions are in
`docs/go-to-market/video-calendrier-notaire.md`.

Verification completed:

- Both FR/EN exports contain one H.264 video stream, 1280 × 752, 18 seconds,
  and no audio stream. FFmpeg decoded both complete files without errors.
- The inline browser player loads the correct language, plays silently when
  visible, and responds to the play/pause button. Reduced motion leaves the
  poster visible without downloading the video until explicitly played.
- At 390 × 844, the document width is 390px and the video width is 316px.
  Desktop video width is 598px. Inspected the embedded calendar and request
  panel; restored the normal viewport and French language afterward.
- The 28 initial targeted checks passed. The final inline-video and partner
  vignette checks passed again (3 tests).
- The full web run reported 1,052 passes and 6 failures while concurrent
  profile, partner, and brand edits were arriving in the shared checkout.
  One failure concerned this clip's CSS token fallback; it was corrected.
  A focused rerun of all six failed checks passed against the updated tree,
  including translation coverage, profile copy, partner layout, brand output,
  and radius tokens. No unrelated work was reverted.
- Final production build, JavaScript syntax checks, and whitespace checks
  passed. All 12 local-stack checks passed.

The previous implementation had also passed the domain, API, admin, and BDD
suites. This revision changes the media and web presentation only; those
broader results are not represented as a new run against concurrent edits.

This is an illustrated calendar, not a recording of a connected account.
No publication or deployment was performed.

## Brand and synchronization revision

The owner's next review keeps the short silent animation and makes Nota the
visual anchor. The exported film now derives its real Nota logo, midnight
palette, Sora/Inter fonts, and provider icons from the product assets. One request
with domain-formatted amounts travels from Nota into Google Calendar, Outlook,
then Apple Calendar. Each provider has a six-second scene. The request opens
back into a Nota-branded card. The description remains about calendar sync;
it does not introduce a mailbox integration or promise instant updates.

- French and English brand frames inspected, including the request popup.
- Both complete videos decode without errors: 18 seconds, 1280 × 752, H.264,
  no audio. French is 350,254 bytes; English is 332,839 bytes.
- Browser inspection found a stale unversioned media response from the service
  worker. The exporter now versions poster and video URLs by content hash.
  A fresh navigation loaded the new branded video and the correct version URL.
- At 390px, the document remains 390px wide and the video is 356px wide.
  The Nota headline, mark, source request, destination, and subscription buttons
  remain visible. Manual pause and silent playback verified.
- 27 focused tests passed: inline media, translation coverage, notary claims,
  and brand assets. Production build, syntax and whitespace checks passed.
- The English reduced-motion preview selected its versioned English poster,
  stayed paused, and had no video source loaded. Returned to French afterward.

## Compact calendar revision

The owner requested removing the repeated Nota branding, focusing on the calendar,
and reducing and centring the presentation. The film now shows only the calendar,
the appearing request, and its opening action. The page header retains the logo.
The extra title, source card, and provider strip inside the film are removed.

The subscription block is capped at 640px. The headline now spans the available
page width: the old flex alignment had centred it inside a 691px intrinsic column
on an 1100px viewport. The updated headline and video centres both land at 550px.
The video frame is 800 × 420 and exports at 1280 × 672, still 18 seconds with no
audio. Both complete exports decode without errors.

The 33 focused media, translation, notary-copy and typography checks passed.
Production build and its existing build tests passed. Mobile layout and centring
were inspected at 390px; no horizontal overflow. No API or business rules changed.

## Two-column UI revision and playback

The owner's screenshot clarified that a narrow centred column left too much
unused space. The section now uses two columns: instructions, small provider
buttons and two short explanations on the left; the calendar preview capped at
520px on the right. Removed the repeated subscription logo from HTML, including
the authenticated state. Provider buttons measure 32px tall on desktop and
retain 44px touch targets. The play/pause control follows the same touch minimum.

Cleared inherited named grid areas and rows: these had created two empty rows
and 115px of extra vertical gaps after introducing the guide wrapper. Browser
inspection confirms one populated row, with the live offers immediately below.

The video was already progressing with readyState 4, muted, no reported media
error. Changed the player to observe the video at 10% visibility, retain its
source on an error, and expose a retry. Reduced-motion behaviour remains intact.
A sub-agent implemented and tested MP4 byte ranges plus no-store responses in
the local server. The restarted 4192 server returns 206, Content-Range and the
correct Content-Length for a real media request. This is a robustness change;
the reported playback failure was not reproduced before it.

33 focused UI/copy/typography tests and 25 HTTP/build tests passed. The existing
calendar browser spec was updated for the two-column layout. No deployment.

## Enlarged calendar and complete month

The latest review prioritizes a larger calendar and a wider view of its dates.
The calendar now occupies about two thirds of the full subscription section:
923px versus a 404px guide at a 1440px viewport, without the former 520px cap.
The page retains its normal 28px outer gutters. At 390px, the 358px preview is
placed before the instructions; document width stays 390px.

The new 24-second silent film gives each provider eight seconds. It shows
Monday 21 through Sunday 27 September, then contracts that week into its row
in the complete September 2026 month. The month includes all 30 dates and
the adjacent August/October dates in five seven-day rows. Existing requests
keep their dates and domain-formatted amounts. No popup covers the calendar.
The calendar grid is clipped during the transition so rows enter smoothly.

French and English review frames were inspected. Both exported files decode
fully without errors: H.264, 1280 × 800, 24 seconds, no audio stream. French is
938,274 bytes; English is 912,847 bytes. Content-version URLs and the production
build point at the new media.

Browser inspection confirmed the seven-day week and full month in the enlarged
frame, advancing playback with readyState 4, muted audio and no media error.
Manual pause works. The English reduced-motion page starts with its translated
poster and no video source loaded. The normal French desktop preview is restored.

33 targeted UI, translation, notary-copy and typography checks passed, as did
25 HTTP/build tests. Production build and JavaScript syntax checks passed.
The existing calendar browser spec now expects the enlarged desktop frame and
calendar-first mobile order; these layout rules were inspected in the in-app
browser. No API or business rules changed, and no deployment was performed.

## Quiet calendar at full content width

The owner requested removing the intense blue blocks and provider application
chrome. The film now uses Nota's paper and light-canvas tokens with slate text,
fine grid lines, and lightly outlined offers. There are no filled blue offers,
dark header/sidebar, view buttons, or cursor. Small Google, Outlook and Apple
marks remain together in the top corner. The week contracts into the complete
month and returns smoothly in one 12-second silent loop.

The calendar occupies the entire section width: 1,384px at a 1,440px viewport.
Subscription instructions and transparent provider links sit beneath it. The
figure now also precedes those controls in DOM reading order. On mobile the
358px preview remains before the instructions, with no horizontal overflow at
390px. The poster shows the full month when motion is reduced.

French and English frames inspected. Both final videos decode without errors:
H.264, 1280 × 576, 12 seconds, no audio stream; 498,480 bytes for French and
488,913 bytes for English. Browser verification confirms advancing playback,
readyState 4, muted video, manual pause, the translated reduced-motion poster,
and the expandable subscription link. Provider controls have transparent fills
and borders. The normal French preview is restored after inspection.

33 targeted UI/copy/typography checks and 28 media/build checks passed (58 unique
checks, with three inline-media checks repeated after moving the figure).
Production build, JavaScript syntax, and whitespace checks passed. The local
stack had stopped during review; it was restarted with `npm run local`, and all
12 local-stack health/freshness checks now pass. No API or business rules were
changed. No deployment was performed.


## Notary copy, headings and alignment review

Reviewed the notary landing copy and positions without changing the calendar
film. The three headings below the film now share the product's Sora heading
scale and align on the same baseline. The free-subscription note has its own
row. The subscription title is an h2 and the two explanations are h3 headings.
The availability section is explicitly labelled “Demandes disponibles”, the
file download says “Télécharger le calendrier (.ics)”, and the repeated request
instruction has been removed from the synchronization footnote. English copy
is updated alongside the canonical French strings.

The calendar was checked independently for 35 unique displayed dates, correct
Monday-to-Sunday columns, the full 21–27 September week, and amounts matching
the domain fixtures. Browser layout checks covered 320, 390, 768, 1024, 1100
and 1440px, including French and English, the expanded subscription link, and
the account-access form. No horizontal overflow or clipped guide text/controls.
All three headings fit one line and align at 1024px after shortening the last
label. The normal French preview is restored.

The notary-focus, inline-film, copy, translation, typography and build checks
pass. Two heading-scale violations found during the review were corrected by
using the shared scale and a dedicated calendar-title class. No test rules were
weakened. Production build and whitespace checks pass; no deployment.

## Shared public landing header

Carnet, Partners and the signed-out Notary page now use the same header rules.
The notary page has the existing “Espace notaire” / “Notary space” section label.
The shared layout aligns the top-left origin, title scale, text column width,
47ch subtitle measure and 16px title-to-subtitle spacing. Copy starts at the top
of its column instead of depending on the height of the adjacent content.

At 1100px, all three titles start at x=28px, y=109.797px, occupy a 500px column,
and use Sora 26px / 29.12px. At 1440px, they start at x=28px, y=114px with a
668px column and the same responsive 32.4px type. At 390px, all titles start at
x=16px, y=66px with a 358px column. Text wraps naturally according to its length;
subtitle spacing and typography remain shared. French comparisons covered
390, 901 and 1440px; English covered 390, 1100 and the desktop visual review.
No horizontal overflow was found. The calendar remains at full content width.

87 existing typography, translation, notary-copy, Carnet and Partners checks
passed. Production build and whitespace checks passed. No media or business
rules changed in this header adjustment.

## Subscription choices left, calendar right

The owner requested a split desktop section while preserving the current film.
The subscription guide now occupies the left column and the wider animation
occupies the right. Both align at the top. The shared page header is unchanged.
At 960px and below, the guide and then the animation stack in DOM reading order.
The video retains its 20:9 frame and existing French/English media assets.

Browser checks covered 320, 390, 768, 960, 1024, 1100 and 1440px. At 1440px,
the guide is 494.813px wide and the preview is 841.188px wide, separated by
48px. At 390px both are 358px wide. No horizontal overflow was found, including
expanded subscription instructions on desktop in French and mobile in English.
Playback remains muted and advancing with readyState 4 and no media error.
The normal French desktop preview is restored.

52 existing notary-focus, inline-film, typography and translation tests passed.
Production build, browser-spec syntax and whitespace checks passed. The existing
landing browser spec now expects the split desktop arrangement and stacked
mobile order; its layout checks were exercised in the in-app browser rather
than by running the complete end-to-end suite.

## Remove the empty title row above the film

The previous split still reserved the full-width title row above the calendar.
The introduction and subscription now share the left column; the animation
starts beside the introduction. A shared CSS grid with subgrids keeps the film,
choices and two supporting explanations aligned without absolute positioning
or fixed block heights. The explanations form a short row beneath both columns.
On mobile they follow the film, so the animation appears earlier in the page.

At 1440px, the film moves from y=241.469px to y=76px, and the available-requests
heading moves from y=727.102px to y=593.422px. The page title retains its x=28px,
y=114px position and shared typography. The calendar film itself is unchanged.
Layout checks covered 320, 390, 768, 960, 1024, 1100, 1440 and 1920px; French
and English, including expanded subscription instructions, remain readable
without horizontal overflow. The subscription guide keeps its natural spacing
when the neighboring film is taller.

The offer-card stagger also briefly hid individual cards while their neighbors
were already visible. The public landing now renders those cards together,
without the entrance animation; the calendar continues to animate normally.

52 existing notary-focus, inline-film, typography and translation checks pass.
Production build, browser-spec syntax and whitespace checks pass. The existing
browser spec now compares the film's top edge with the introduction instead of
the subscription guide. Browser layout verification used the in-app browser;
the full end-to-end suite was not rerun for this layout adjustment.

## Calendar message above the automatic loop

The owner requested moving “Vous décidez quoi retenir” above the calendar and
removing the “Illustration · Sans son” strip and pause button. The landing now
has a decision message followed directly by the unchanged silent animation.
The left introduction explicitly explains that Nota is a calendar of notarial
requests to add to Google Calendar, Outlook or Apple Calendar, with matching
English copy. The date/service/amount explanation stays with the choices.

The shared player accepts the absence of a button without interrupting startup.
Automatic playback remains muted, visibility-aware and reduced-motion-aware;
the separate demo page retains its optional controls. An added behavior check
verifies startup without controls, reduced motion and pausing offscreen.

57 targeted notary, player, copy, translation and typography checks passed.
Browser checks covered French at 320, 768, 1100 and 1440px and English at
390 and 1440px, with the decision message above the video, no caption/controls,
advancing muted playback and no horizontal overflow. Production build and
JavaScript/browser-spec syntax checks passed. Media assets were not regenerated.

## Balance the landing copy

Shortened the introduction, subscription instruction and explanatory sentences
to remove repetition and the isolated “Nota” line. Short text blocks use balanced
wrapping and a consistent measure. Google Agenda/Calendar and Apple Calendrier/
Calendar stay together using nonbreaking spaces. The free-subscription note is
quieter, in sentence case; the date explanation now shares the left edge of
the other text blocks, with a fine horizontal divider.

French and English desktop/mobile views were inspected, including 320, 390,
1100 and 1440px. Provider names stay on one line, with no horizontal overflow.
30 translation, typography and notary-copy checks and two calendar-player checks
passed. The translation check was repeated after adding the nonbreaking spaces;
production build and whitespace checks pass.

The first broad run encountered concurrent Partner edits: a temporary startup
reference error, missing translations and two expectations for the removed
partner vignette. Navigation and translation recovered on reload; this change
does not modify the Partner implementation or its legacy vignette expectations.
