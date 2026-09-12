# Real Nota frames for the calendar film

These are full, unmodified browser captures of the actual local web application,
with synthetic notary and client identities. `manifest.json` records the CSS
rectangle of each panel and the position of its real action button. The SVG
renderer crops these full frames during composition; it does not redraw Nota.

Captured in the desktop browser on 2026-09-12. The exporter reads each image’s native dimensions before applying its recorded crop. The same example uses a financing offer
for September 23. Its public API response is in `offer.json`; no session tokens,
client access tokens, payment data or real personal information are stored here.

The isolated capture stack uses the normal app and HTTP handler:

```sh
PORT=4878 NOTA_DEMO_OPEN=true NOTA_SITE_URL=http://localhost:4873 \
  NOTA_LOCAL_MAIL_DIR=/tmp/nota-calendar-film-mail node apps/api/local-server.js
PORT=4873 NOTA_API_BASE=http://localhost:4878 node apps/web/run-local.mjs
```

Use the browser to capture the public subscription guide, then follow the offer
link in `/carnet/feed.ics` and sign in with a fictional notary. Complete the
required profile if needed; the selected offer opens directly for review.
Capture the complete confirmation with its sticky footer, confirm, and capture
the expanded retained file. The manifest records the footer rectangle separately
so its real button remains in view while the film follows the review content.
Capture both French and English at each stage. Confirm the retained status
through the client API before exporting. Notification emails stay in the local
file mailbox. No calendar provider account is used or changed.

The external calendar scene is an illustration, with the same real offer's
service, date and amount. Updates follow each provider's synchronization
schedule. The film does not claim immediate external calendar delivery.

To refresh the captures, use full browser screenshots and update the crop rectangle
in the manifest. Capture after entry animations and scrolling have stopped.
Keep the true dialog contents, including the confirmation step. The source
images remain available for reviewers to compare against the displayed crop.
The offer-card capture remains a historical source reference. The current
film goes from the calendar event to the real review, then shows the retained
file before looping. The retained crop starts below the page header to avoid
repeating the logo already visible around the embedded film.
