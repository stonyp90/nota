# Language and notification verification — 2026-09-08

Target confirmed by the owner: **gonota.ca**. Checks were run against the current
workspace, which already contained substantial uncommitted product/deployment
changes. No deployment, DNS change, real payment, or external email was performed.

## Implemented behavior

- A first visit uses the first supported browser language (English or French).
  Unsupported preferences fall back to French. A valid `?lang=en|fr` overrides
  the saved choice; otherwise a saved menu choice wins over browser detection.
- Existing desktop and mobile language controls persist the choice. When local
  storage is blocked, the language is retained in the URL across reloads.
- Public API requests carry the selected interface language in `Accept-Language`.
  External upload URLs are untouched. API language negotiation accepts regional
  tags and HTTP quality weights.
- Validated client signup, offer creation, notary signup and contact/support
  intake initialize the recipient's saved email language. Anonymous requests
  cannot overwrite an existing preference. Verified client/notary sign-in and
  partner verification can update it.
- The menu updates email preferences for identities backed by an existing client,
  notary or signed email-preference token. Browser-only, unauthenticated identities
  must verify their mailbox to replace an existing account preference.
- Sign-in/claim/code-reminder messages use the language of that request, without
  changing the account before verification. Lifecycle notifications, scheduled
  reminders and campaigns resolve each recipient's saved language independently.
  Existing recipients without a language retain the configured server fallback.
- Language and per-template notification choices are independent attributes in
  the existing `MAILPREF#` record. Language changes cannot re-enable opted-out
  notification types or marketing consent. No migration is required.

## Executed verification

| Command / suite | Final result |
| --- | --- |
| `npm test` — domain | 364 passed |
| `npm test` — API (includes contract tests) | 1,491 passed |
| `npm run test:contract` — explicit contract rerun | 25 passed |
| `npm test --workspace @nota/web -- --test-concurrency=4` | 767 passed |
| `npm run test:admin` | 221 passed |
| `npm test --prefix features` | 174 scenarios / 987 steps passed |
| `npm run test:e2e -- --workers=2` | 48 passed, Chromium |
| `npm run build` | passed |
| `npm run build:admin` | passed |

The web command runs the same suite as `npm run test:web` with bounded worker
concurrency. All final runs completed with zero failing or skipped tests. The
25 explicitly rerun contract tests are already included in the API count.

Additional integration evidence:

- `npm run local:check`: all eight checks passed. All four local surfaces answer,
  both APIs report the current source digest, and the public API has seeded offers.
- Separate English and French synthetic HTTP welcome requests to the local API
  produced `.local-mail` HTML captures with `lang="en-CA"` and `lang="fr-CA"`.
  The local adapter writes files only; these checks do not demonstrate SES delivery.
- All 58 registered templates are rendered in both languages by the existing
  registry-driven template suite. New notifier tests cover recipient language
  resolution through generic sends, direct authentication sends, reminders,
  mixed-language recipients, authenticated changes, replay and failure/retry.
- `git diff --check` passed. This repository has no lint script.

Baseline failures resolved:

- The client identity test still expected privacy guidance inside the label;
  it now verifies the guidance beside the field and its accessible association.
- The profile-completion test unintentionally started the separately tested new
  account tour; it now marks that tour completed to isolate profile behavior.
- The polling test assumed three polls within a fixed 120 ms window; it now
  waits for the required number of polls with a bounded deadline.
- One initial browser run timed out while loading the home page under concurrent
  suite load. Final browser runs use two workers against a stable source tree.

## Production and coverage boundaries

At verification time, `https://gonota.ca/` returned HTTP 200 from `DPS/2.0.0`,
with a GoDaddy content-security policy and a **Launching Soon** page. The response
contained neither the Nota calendar nor its application/i18n assets. The live
application journeys therefore could not be exercised on the requested domain.

The tests establish local application behavior and captured email content. They
do not establish live SES acceptance, inbox arrival, spam placement, reply-inbox
operation, DNS/DKIM configuration, real Stripe behavior, or deployed scheduled
notification execution. Those need the deployed application and controlled test
mailboxes. The browser suite runs Chromium; Safari/WebKit and Firefox were not
installed or exercised in this run.

Retention, conversation, payment, indemnity and several other lifecycle branches
have API/BDD/DOM coverage rather than a complete dedicated browser journey. See
`e2e-journey-matrix.md` for the mapping. This audit does not claim exhaustive
coverage of every possible input, interleaving, external failure or browser.
