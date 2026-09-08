# Nota end-to-end journey matrix

This matrix binds each customer/notary lifecycle risk to a browser or API/BDD
test. Browser checks use the local in-memory stack; payment assertions use the
Stripe adapter fakes and never contact Stripe.

| Journey / edge case | Bound test | Status |
| --- | --- | --- |
| First visit, onboarding, client enters booking | `e2e/client-booking.spec.js`, `e2e/intro-gate.spec.js` | covered |
| Four booking steps, required answers, price quote, private contact fields | `e2e/client-booking.spec.js`, `apps/web/test/booking-form-sections.test.mjs` | covered |
| Server revalidation: bad amount/date/tier/anonymity/private fields | `apps/api/test/handler.test.mjs` | covered |
| Notary passwordless sign-in and magic-link replay protection | `e2e/notary-signin.spec.js`, `apps/api/test/notary-auth.test.mjs` | covered |
| Open-demand feed and agenda calendar | `e2e/notary-signin.spec.js`, `apps/web/test/notary-cote.test.mjs` | covered |
| Notary retains a demand and receives the client contact handoff | `apps/api/test/propositions.test.mjs`, `features/preteurs.feature` | covered in API/BDD; no dedicated browser retention assertion |
| Client/notary retained-act chat, read receipts, scope isolation | `apps/web/test/messaging-receipts.test.mjs`, `apps/api/test/support.test.mjs`, `features/preteurs.feature` | covered |
| Assistant answers known questions and escalates unknown questions | `features/messagerie_assistee.feature`, `apps/api/test/support-assistant.test.mjs` | covered |
| Client cancellation before retention | `e2e/client-cancel.spec.js`, `features/annulation.feature` | covered |
| Client cancellation after retention, free window | `apps/web/test/cancel-contact.test.mjs`, `features/annulation.feature` | covered |
| Client late cancellation: capped claim, no automatic charge, payment to notary | `apps/api/test/cancellation-fee.test.mjs`, `features/caution.feature`, `features/notifications.feature` | covered |
| Notary withdrawal after retention | `features/preteurs.feature`, `apps/api/test/audit-angles-morts.test.mjs` | covered |
| Signed/completed act cannot be cancelled | `features/annulation.feature`, `apps/api/test/cancellation-fee.test.mjs` | covered |
| Stripe card setup, authorization, release, commission and duplicate webhooks | `apps/api/test/audit-angles-morts.test.mjs`, `apps/api/test/billing.test.mjs`, `apps/api/test/cancellation-fee.test.mjs` | covered with fakes; production keys remain deployment configuration |
| Notary Connect payout onboarding and unavailable-Stripe degradation | `apps/api/test/facturation-absente.test.mjs`, `apps/api/test/billing.test.mjs` | covered |
| Retention/referral earnings and cancellation recovery | `features/parrainage.feature`, `apps/api/test/analytics-parrainage-payable.test.mjs` | covered |
| Empty, malformed, stale, duplicate, unauthorized and already-completed requests | `apps/api/test/*.test.mjs`, `features/validation_api.feature`, `features/annulation.feature` | covered |
| Responsive layout, no blank cards/gaps, console/network regressions | `e2e/responsive-layout.spec.js`, `e2e/no-console-errors.spec.js` | covered |

## Language and email coverage (2026-09-08)

| Journey / edge case | Bound test | Coverage |
| --- | --- | --- |
| Browser default (English/French), unsupported languages, ordered alternatives | `e2e/language-preferences.spec.js`, `apps/web/test/i18n.test.mjs` | browser + unit |
| Desktop/mobile menu changes, URL override, reload persistence | `e2e/language-preferences.spec.js` | browser |
| Storage blocked, invalid URL language, unrelated URL parameters retained | `e2e/language-preferences.spec.js` | browser |
| Browser choice reaches API and initializes recipient preference | `apps/api/test/recipient-language.test.mjs`, `e2e/language-preferences.spec.js` | API + browser |
| Each recipient uses their own language; delayed reminders see later changes | `apps/api/test/recipient-language.test.mjs` | notifier with captured mail |
| All 58 registered templates render complete French and English emails | `apps/api/test/email-language.test.mjs` | template registry, HTML/text/footer |
| All non-magic-link templates use recipient language through generic sending | `apps/api/test/recipient-language.test.mjs` | captured mail; does not replace event-trigger tests |
| Client/notary sign-in, partner claim and code reminder language | `apps/api/test/recipient-language.test.mjs` | direct sends + HTTP client verification/replay |
| Language-only updates preserve notification choices; anonymous writes rejected | `apps/api/test/recipient-language.test.mjs`, `apps/api/test/notification-preferences.test.mjs` | API + repository |
| DynamoDB settings updates preserve independent attributes | `apps/api/test/recipient-language.test.mjs` | adapter command contract; no live DynamoDB |
| Marketing opt-out, required login messages, disabled templates, failure/retry | `apps/api/test/notifications.test.mjs`, `apps/api/test/notification-preferences.test.mjs`, `apps/api/test/recipient-language.test.mjs`, `features/notifications.feature` | notifier/API/BDD |

See `2026-09-08-language-and-notifications.md` for the executed checks and
production limitations. A mapped test establishes coverage for its assertions;
it does not prove that every possible edge case has been enumerated.

## Browser run order

Run the browser suite with:

```bash
npm run test:e2e
```

The suite currently executes the customer booking, customer cancellation,
notary sign-in, responsive, partner and console-error journeys. The retention,
live conversation, and payment/cancellation branches have deterministic API/BDD
coverage. They do not yet have dedicated full browser journeys; this is a
coverage boundary, not a requirement for additional approval.
