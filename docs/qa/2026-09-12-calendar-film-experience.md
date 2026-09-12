# Calendar film: focus on the experience

The embedded notary film no longer repeats the Nota logo or the top-right
demo label. The surrounding page header carries the brand. Moving the
instruction up recovers 50 px for the month and real review panel, while
keeping the acceptance action in view.

The 18-second sequence follows the context of the notary page: add the
calendar, receive/open a request, review and confirm in Nota, then see the
real retained file. The final 2.5 seconds make the outcome visible before
the loop. The existing capture verification records the same synthetic
offer as retained; no client message is sent. All application panels are
existing browser captures; the calendar ingestion scene is illustrated.

Both language exports are H.264, 1280×720, 24 fps, exactly 18 seconds, with
no audio stream. Content-version URLs are refreshed for the landing and
standalone player, and the production build fingerprints the new media.

## Validation

- 35 tests pass across film boundaries/outcome, HTTP media streaming and
  French/English coverage. Final log:
  `output/calendar-brand-review/experience-final-tests.log`.
- Both MP4 streams and durations were checked with FFprobe.
- French and English scene stills were rendered. The enlarged month,
  confirmation and retained-file frames were visually inspected; the real
  video was also loaded and paused in the browser.
- The web production build passes. Only the film renderer, exports,
  translations, media references and corresponding documentation/test are
  included in this revision. Concurrent phone-layout work has separate
  ownership and validation.

Review frames and export/build logs are under
`output/calendar-brand-review/` (ignored by Git).
