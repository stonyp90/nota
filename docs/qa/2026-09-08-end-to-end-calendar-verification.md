# End-to-end calendar verification — 2026-09-08

## Conclusion

The local application journey passes. Production end-to-end readiness and all
external calendar clients are not yet verified. The provisional five-calendar
inventory is Nota's public carnet, Nota's retained-signing calendar, Google,
Outlook and Apple; the owner was asked to confirm that inventory.

## New executable evidence

`e2e/calendar-retention.spec.js` drives independent client and notary browser
contexts against the real local HTTP handler. It covers:

1. Partner code capture and visible indicator; the four-screen booking form
   submits that code and receives a real HTTP 201.
2. The public ICS feed includes the new request, its all-day date, and the same
   request-specific link in URL and DESCRIPTION, without client credentials.
3. A signed-out notary follows that actual event link, signs in and confirms
   retention through the UI after their isolated test profile is completed.
4. The retained card appears. Private Outlook/Apple/Google links point to the
   same feed using only the feed token. That feed has exactly one matching UID;
   the client API agrees that the bid is retained.
5. The client sees the retained conversation, sends a message, and the notary
   reads and replies in their separate browser. The client sees the reply.
6. Cancelling through the client API removes the request from both ICS feeds.

The E2E harness now receives its real web origin so the test follows a generated
calendar link instead of inventing a route in the spec.

All **50 browser journeys passed** on isolated ports 8823/4323 (56.6 seconds).
The final expanded message/reply version of the new calendar journey also passed
on isolated ports 8824/4324 (4.8 seconds including server startup).
These runs use memory persistence, dev-echoed login tokens and fake billing;
they do not contact Microsoft, Google, Apple, SES or Stripe.

## Fresh production read-only checks

- `https://gonota.ca/`: HTTP 200.
- `/api/health`: HTTP 200.
- `/api/carnet/feed.ics`: HTTP 200, text/calendar, 19 events. No
  `#notaires&acte=` links: the local calendar-link changes are not deployed.
- `/api/notary/feed.ics` without credentials: HTTP 401, as expected.
- `/api/coverage?prefixe=G1R&deplacement=client_10`: HTTP 503 with
  `{"status":"unknown"}`. The live nearby-notary lookup remains unavailable.
- AWS profile `aws-prod`: no SSO token. No deployment or infrastructure update
  was performed in this verification.

## Remaining release gates

Deploy the intended reviewed application revision and resolve/verify the live
coverage failure. Exercise a designated production client and approved test
notary, verify both inboxes and both conversations, and test billing in Stripe
test mode. Subscribe designated Google, Outlook and Apple accounts to the
actual production feeds; check creation, updates, removal, dates, duplication,
link landing and measured refresh delays in each real client. ICS subscription
support does not imply bidirectional synchronization or immediate refresh.
