# Nota email design — one reusable template, every feature covered

The single source of truth for how a Nota email looks, reads, and complies.
The implementation lives in `apps/api/src/emails.js`; this document explains
the design so a new lifecycle email can be added in minutes without inventing
anything.

## Principles

1. **One shell, many messages.** Every email — client, notary, admin,
   operator — renders through the same `build()` layout. A template only
   supplies copy and a CTA; it can never restyle the shell.
2. **Bilingual by construction.** Recipients' language preference is not
   tracked, so every message carries both languages, **French first** (fr-CA is
   canonical, per AGENTS.md): subject `FR / EN`, preheader `FR · EN`, the full
   French block, a hairline divider, then the full English block with its own
   CTA to the same URL. Plain text mirrors this with a `----` separator.
3. **Presentation only.** Templates format context they are given. Amounts go
   through `domain.money()` / `domain.moneyEn()`, service and tier names
   through `nom`/`nomEn` — never hardcoded, never computed in the mail layer.
4. **Survives hostile clients.** Table-based layout, all CSS inline (clients
   strip `<style>`), no `<img>`, no `<svg>` — the logo is pure CSS/text so the
   brand shows even with images blocked. An MSO ghost table pins Outlook to
   600px; everywhere else the card is fluid.
5. **Compliant on every message.** CASL / Law 25 footer with sender name,
   registered mailing address, a plain-language reason, and a working
   `Se désabonner / Unsubscribe` link — on transactional messages too.

## Anatomy

```
┌──────────────────────────────────────────────┐  ← neutral #f4f7f4 page
│ ┌──────────────────────────────────────────┐ │
│ │ ███ 3px hunter-green top rule            │ │  ← white card, max 600px,
│ │  [N] Nota                                │ │    1px border, 14px radius
│ │      La place de marché notariale ·      │ │  ← CSS-only logo header
│ │      The notarial marketplace            │ │
│ ├──────────────────────────────────────────┤ │
│ │  H1 (fr)                                 │ │
│ │  lead (fr, muted)                        │ │
│ │  ▎callout — offer line, tinted panel     │ │  ← brand-left-rule emphasis
│ │  paragraph(s)                            │ │
│ │        [ CTA — hunter green ]            │ │  ← ONE CTA per language
│ │  ──────────── divider ────────────       │ │
│ │  H1 (en) … same structure … [ CTA ]      │ │
│ ├──────────────────────────────────────────┤ │
│ │  footer: Nota · mailing address ·        │ │  ← CASL / Law 25, bilingual
│ │  reason · unsubscribe / support / privacy│ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

Plus, invisible: a hidden preheader div (the inbox preview line) padded with
zero-width joiners so body copy never leaks into the preview.

## Design tokens

Inline styles are mandatory in email, so the web CSS custom properties can't be
referenced directly. The `PALETTE` object in `emails.js` is the one flattened
copy of the **light-theme** web tokens (`apps/web/public/styles.css`) — change
a color there, never inline:

| PALETTE key | Value | Web token |
| --- | --- | --- |
| `ink` | `#0b1220` | `--ink` |
| `muted` | `#4d5b6e` | `--ink-muted` |
| `bg` | `#f4f7f4` | `--surface-inset` |
| `card` | `#ffffff` | `--surface` |
| `border` | `#dbe2ea` | `--border` |
| `brand` | `#2c5f34` | `--brand` (hunter-700) |
| `brandBright` | `#50b848` | `--brand-bright` (hunter-500) |
| `brandDark` | `#244c2a` | `--brand-hover` (hunter-800) |
| `brandInk` | `#ffffff` | `--on-accent` |
| `tint` | `#f0f9f0` | hunter-50 |
| `footer` | `#6b7a8a` | email-only small print |

Type: Inter-first stack (`Inter, system-ui, …`), matching the web `--font-sans`.
The card always sits on the light surface — deliberate: it stays legible in
dark-mode clients that would otherwise invert unknown backgrounds.

CTA button: hunter-green fill, white 16px/600 label, `14px 32px` padding
(≥44px touch target), `mso-padding-alt` for Outlook, 10px radius, 1px
`brandDark` border. Table-based ("bulletproof"), no VML.

## Conversion checklist (every template)

- a short, specific subject — no spammy words, no ALL CAPS;
- a preheader that adds information, not repeats the subject;
- exactly **one** CTA per language block, verb-first label ("Compléter mon
  dossier"), both languages pointing at the same URL;
- the key fact (offer line, amount, link validity) in a `callout()` so a
  5-second scan gets it;
- a plain-text alternative carrying the same content and CTA URL.

## Template inventory — every feature has its dedicated email

| Feature | Template(s) | Recipient | Trigger (send-point) |
| --- | --- | --- | --- |
| Client sign-up | `clientWelcome` | client | `POST /client/welcome` |
| Offer posted | `offerPublished` | client | `POST /bids` |
| Offer posted (operator) | `operatorNewLead` | operator | `POST /bids` |
| Card authorized → offer live | `offerAuthorized` | client | webhook `checkout.session.completed` |
| Authorization lapsed | `offerAuthorizationVoided` | client | webhook `checkout.session.expired` / `payment_intent.canceled` |
| Dossier incomplete | `dossierIncomplete` | client | daily reminder scheduler |
| Date approaching (J-7/3/1) | `dateApproaching` | client | daily reminder scheduler |
| Offer retained | `offerRetained` | client | `POST /notary/bids/accept` |
| Offer cancelled (ack) | `offerCancelled` | client | `POST /client/bid/cancel` |
| Retained offer cancelled | `offerCancelledNotary` | notary | `POST /client/bid/cancel` (retained bid) |
| Retained offer cancelled (operator) | `operatorOfferCancelled` | operator | `POST /client/bid/cancel` (retained bid) |
| Contact form (ack) | `contactRecu` | sender | `POST /contact` |
| Contact form (message) | `operatorContactMessage` | operator | `POST /contact` |
| Date near, no uptake | `dateMissedNoUptake` | client | daily reminder scheduler |
| Notary onboarding opened | `notaryOnboardingStarted` | notary | `POST /notaries/connect` |
| Notary account active | `notaryActive` | notary | webhook `account.updated` (once) |
| Matching open bids digest | `newMatchingBids` | notary | digest scheduler |
| Act paid / payout | `actPaidNotary` | notary | accept payout & `POST /notary/acts/complete` |
| Act paid (operator) | `operatorActCompleted` | operator | same as above |
| Notary console sign-in | `notaryMagicLink` | notary | **registry-ready, not yet wired** — the notary session flow does not email a link today |
| Admin console sign-in | `adminMagicLink` | admin | `requestLogin` in `apps/api/src/admin.js` |
| Subscription lifecycle (legacy) | `subWelcome`, `subReceipt`, `subRenewalReminder`, `subPaymentFailed`, `subCanceledWinback`, `operatorNotarySubscribed` | notary/operator | Stripe invoice/subscription events |

The subscription set predates the pay-on-accept model in
`apps/api/src/billing.js` and only fires on Stripe invoice/subscription events;
it is kept until the business model question (AGENTS.md rule 2 vs the
2026-08-14 note in `billing.js`) is settled.

## Adding a new template

1. Write a failing assertion in `apps/api/test/emails-features.test.mjs`
   (add the name to `FEATURE_TEMPLATES`, plus one behavior test).
2. In `emails.js`, compose `build({ subjectFr, subjectEn, preheaderFr,
   preheaderEn, fr: {…}, en: {…}, ctaUrl, unsubscribeUrl })` from the existing
   primitives (`para`, `callout`, `button` via `ctaLabel`). No new styles.
3. Add it to the `TEMPLATES` registry. That alone opts it into the generic
   suites (`emails-brand.test.mjs`, `notifications.test.mjs`), which enforce
   the bilingual contract, brand color, Inter stack, no-`<style>`/`<img>`/
   `<svg>`, preheader, CASL footer and unsubscribe link automatically.
4. Wire it in `notifications.js` through `sendOnce()` — consent (suppression
   list) and idempotency (the `(refId, kind)` SENT ledger) come for free.
   Send-points in `handler.js` are fire-and-forget: mail must never break a
   response.

## Before go-live

- `SENDER.address` in `emails.js` is a **placeholder**; CASL requires the real
  registered mailing address.
- The notary sign-in flow should start emailing `notaryMagicLink` instead of
  minting a session from a bare email (known weakness noted in
  `notary-auth.js`).
