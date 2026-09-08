# Production communication audit — 2026-09-08

## Live evidence

Target: https://gonota.ca. Public page and `/api/health` return 200.
An unauthenticated private notary ICS feed returns 401.

A fresh customer sign-in request was submitted through the production browser
using the owner's designated Gmail identity. The message arrived in INBOX with
subject `Your link to your requests` at 07:10:49 UTC. Gmail's received headers
report SPF, DKIM (gonota.ca and Amazon SES), and DMARC pass. Opening the email's
single-use link in a fresh document authenticated the customer and opened
`My offers`. Reopening the consumed link was rejected with the expired/already-used
message. No access tokens or magic-link URLs are retained in this report.
This proves this specific production email and sign-in journey, not delivery of
all templates or every recipient provider.

Earlier welcome and support-escalation messages from bonjour@gonota.ca were also
present in the owner's INBOX. Their presence does not prove a newly accepted
booking's introduction emails or a two-party conversation.

## Reproduced and fixed

`onOfferRetained` previously wrapped the customer, notary, and operator sends in
one try/catch. A rejection for the customer prevented the notary's introduction
from being attempted; a rejection for the notary prevented the operator alert.
Two new regression cases failed against the old implementation.

Each introduction now handles delivery failure independently. The result
reports partial failure without exposing provider error details. Retrying the
notifier sends the previously failed message and skips recipients recorded as
already delivered. Both failure cases pass. This does not add a durable retry
queue or guarantee exactly-once delivery across a crash between SES acceptance
and the sent-ledger write; those remain reliability limitations.

## Automated verification

182 notification, recipient-language, email-template, conversation, and withdrawal
tests passed locally (zero failures). They assert customer/notary contact details
in the acceptance emails, signed customer deep links, the notary dossier link,
message exchange and message-email notifications, access boundaries after
withdrawal, and language selection. Email transports are fakes in these tests.

All 49 existing browser journeys passed against isolated local fixtures
(5.7 minutes, zero failures). They cover
booking, client cancellation, notary sign-in, partner claims, onboarding,
language preferences, upload CSP, and responsive layouts. They do not establish
live Stripe charges, production mailbox delivery, or live provider calendar sync.
The full domain/API/contract/BDD/web/admin suite passed in CI run 34198266093
for commit `7d5e037800c0b5c816f35279f360f8bb38fc2431`. The release workflows
repeat these checks before deploying.

## Live acceptance matrix still requiring controlled identities

| Scenario | Production status |
| --- | --- |
| Customer email sign-in, delivery authentication and account landing | Verified as above |
| Publish a designated test offer and confirm publication email | Pending controlled test data |
| Approved test notary accepts that offer | Pending designated test notary |
| Both introduction emails arrive with correct contacts and links | Pending live acceptance |
| Customer and notary exchange messages, each sees replies and receives email | Pending live acceptance |
| Unrelated user cannot read the conversation or documents | Automated API coverage; live test pending |
| Customer cancellation and notary withdrawal, with correct notices | Automated coverage; live test pending |
| Late cancellation claims, completion, Stripe transfers and replay | Automated fake-provider coverage; live test pending |
| Google/Outlook two-way calendar synchronization | Not implemented/deployed |
| Nearby-notary lookup | Failed: HTTP 503 for G1R/client_10 |

No new production offer, notary identity, calendar event or payment was created
in this audit. The operator was asked to designate test inboxes before a live
marketplace journey. A fresh AWS session is also required: `aws-prod` currently
has no SSO token. The previously committed coverage IAM fix has not been applied.

The existing broader feature-to-test mapping is in `e2e-journey-matrix.md`.
No claim is made that every platform feature is verified in production.

## Release verification

The acceptance-email fix was merged into `main` and pushed as
`7d5e037800c0b5c816f35279f360f8bb38fc2431`.
Public deployment 34198575829 and admin deployment 34198575857 both completed
successfully. After deployment, the public home, public API health and admin home
returned HTTP 200. The nearby-notary lookup still returned HTTP 503; application
deployment does not apply the outstanding infrastructure IAM change.

The in-progress Outlook implementation was deliberately excluded from this
release. Successful deployment and health checks do not establish live
acceptance-email delivery, payments or calendar synchronization.
