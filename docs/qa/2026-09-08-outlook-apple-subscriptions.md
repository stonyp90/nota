# Outlook and Apple subscription follow-up

Scope: subscribe to Nota's public requests or private retained signings, then
follow an event's link into Nota to review and confirm retention. This is an
ICS subscription, not bidirectional provider synchronization.

## Changes

- Both feed builders put the request-specific Nota URL in `URL` and in the
  bilingual `DESCRIPTION`, including for clients that hide the URL property.
- Provider buttons and the manual subscription field share one URL builder.
  Outlook uses the HTTP(S) feed; Apple uses its webcal equivalent. The private
  feed contains the read-only feed token, never the session token.
- A collapsible manual subscription path supports work Outlook and Apple when
  the shortcut does not select the desired app/account. The URL can be copied
  or selected manually if clipboard permission is denied.
- Download buttons explicitly say “Télécharger .ics”. Nearby copy explains
  that an imported file is a one-time snapshot and a subscription refreshes
  according to the calendar application.
- Private links and the manual field are cleared when no authenticated feed
  token is available, including after sign-out.

## Verification

The local stack freshness check passed all eight checks. Browser inspection
confirmed the public subscription instructions, readable URL field and working
copy feedback. Automated tests cover matching provider/manual feed URLs,
scoped tokens, cleanup after sign-out and clipboard refusal. Existing feed
regressions cover line folding, bilingual text, all-day dates, current ownership,
cancellations, withdrawals, duplicates and outage recovery. A request-link test
covers sign-in followed by explicit retention confirmation.

Provider ingestion was not tested in real Outlook.com, Microsoft 365, Apple
Calendar on macOS or iOS accounts. No deployment or real provider event mutation
was performed. The existing OAuth connection foundation is not a released
bidirectional sync implementation.

## Provider constraints and final acceptance

Microsoft distinguishes file import from subscription: imported events do not
refresh; subscription updates can take more than 24 hours. See
[Microsoft's import and subscription documentation](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web).
Apple Calendar on Mac offers an Auto-refresh setting for subscribed calendars:
[Apple's refresh documentation](https://support.apple.com/en-gb/guide/calendar/icl1024/mac).

After deployment, use designated test accounts in each provider to subscribe,
verify the correct all-day date and description link, publish/retain/cancel a
test request, refresh and measure propagation, and ensure one current event
remains. Test both a signed-in and signed-out Nota browser when following the
link. A downloaded/imported ICS file must not be used to claim automatic sync.

Final local results: 364 domain tests, 1,524 API tests, 770 web tests, 221
admin tests and 186 Cucumber scenarios / 1,069 steps passed. The final focused
subscription/i18n run passed 24 tests after the input styling adjustment. The
web production build and whitespace checks passed. The public subscription
panel was inspected in the browser in French and English; copying the URL
produced the expected confirmation.
