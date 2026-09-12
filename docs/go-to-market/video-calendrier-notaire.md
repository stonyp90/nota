# Calendar-to-acceptance film

The notary landing contains a silent, 15.5-second demonstration. It shows the
journey from calendar subscription to confirmation in the actual Nota application:

1. **0–4 s:** the real subscription choices beside a preview of the month. A cursor
   points to the actual Google button; the film tells the notary to confirm
   in their calendar before Nota appears on the date.
2. **4–10.5 s:** a stable, rounded September month grid gains Nota requests. A
   new financing offer for September 23 arrives, is selected, and exposes its
   **Ouvrir dans Nota** link. Calendar ingestion is illustrated; the sync note
   stays visible and does not promise immediate delivery from providers.
3. **10.5–15.5 s:** the calendar link opens the actual confirmation directly after sign-in. Its source pixels
   fill the frame at a readable scale; a short vertical camera movement follows
   the fees and signing details. The real sticky **Retenir** footer stays visible.
   The application contains the complete documents, criteria and terms; the
   film frames the part relevant to this decision.

The film loops directly after confirmation, without showing the retained file.

The same offer's service, date and amount persist across every scene. Service
names and money formatting come from `@nota/domain`; captions use the product's
FR/EN dictionary. The source of the real captures, their framing and the
synthetic public offer are in `demo/calendar-captures/`. See its README for the
isolated capture workflow. No production account or provider calendar was
changed. No credentials or access tokens are included in the source assets.

The 16:9 frame uses the product's pale canvas, official logo and Sora/Inter
typography. The header contains the logo and demo label. The real
subscription and acceptance buttons preserve Nota's outlined style; the
illustrated calendar link uses the same brand colour and radius. The calendar
opens to a full-width month after subscription. Opaque cuts separate the
actions, without white flashes or a blank frame at the loop boundary. The
review uses the full useful width of the frame. Acceptance
always happens in Nota after review.

The output is 1280 × 720, 24 fps, without sound. FR/EN MP4s and static posters
live in `apps/web/public/media/nota-agenda-*`. The exporter refreshes the content
versions in the landing and standalone demo URLs; the production build also
fingerprints them. The player loads only the visible language, pauses when
hidden or offscreen, and respects reduced motion. The standalone demo retains
its play/pause control. The landing keeps its existing inline presentation.

```sh
node demo/render-calendar.mjs --frames-only
node demo/render-calendar.mjs --lang=en --frames-only
node demo/render-calendar.mjs
node demo/render-calendar.mjs --lang=en
```

The development renderer uses the existing isolated `@resvg/resvg-js` install,
FFmpeg, and the hosted font conversion in `demo/prepare-calendar-fonts.py`.
There are no new browser runtime dependencies. Review stills are written to
`output/calendar-brand-review`; review video copies go to
`demo/sortie/calendrier/nota-calendrier-{fr,en}.mp4`.
