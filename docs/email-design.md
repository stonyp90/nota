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
   600px; everywhere else the card is fluid. `color-scheme` /
   `supported-color-schemes` metas declare the card light-only so Apple Mail
   does not auto-invert it in dark mode, and the English block carries
   `lang="en-CA"` inside the `fr-CA` document so screen readers switch
   pronunciation.
5. **Compliant on every message.** CASL / Law 25 footer with sender name,
   registered mailing address, a plain-language reason, and a working
   `Se désabonner / Unsubscribe` link — on transactional messages too.
6. **One-click unsubscribe at the header level.** Every send carries its
   `unsubscribeUrl` through the mailer port; the SES adapter emits
   `List-Unsubscribe: <url>` and, for http(s) URLs, `List-Unsubscribe-Post:
   List-Unsubscribe=One-Click` (RFC 8058 — required by Gmail/Yahoo for bulk
   senders). `POST /unsubscribe` is the one-click target and records the
   opt-out exactly like GET. The admin magic link uses a `mailto:` URL
   (no public unsubscribe route on that domain), which yields the
   `List-Unsubscribe` header only.

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

This is the actual `TEMPLATES` registry in `apps/api/src/emails.js` (the
generic suites iterate it, so a row here without a registry entry — or the
reverse — fails a test).

| Feature | Template(s) | Recipient | Trigger (send-point) |
| --- | --- | --- | --- |
| Client sign-up | `clientWelcome` | client | `POST /client/welcome` |
| Offer posted | `offerPublished` | client | `POST /bids` |
| Offer posted (operator) | `operatorNewLead` | operator | `POST /bids` |
| Card authorized → offer live | `offerAuthorized` | client | webhook `checkout.session.completed` |
| Authorization lapsed | `offerAuthorizationVoided` | client | webhook `checkout.session.expired` / `payment_intent.canceled` |
| Dossier incomplete | `dossierIncomplete` | client | daily reminder scheduler (`dossier_incomplet` — an explicit `dossierReady` flag, or derived via `leadReadiness` when the flag is absent) |
| Date approaching (J-7/3/1) | `dateApproaching` | client | daily reminder scheduler (`j7`/`j3`/`j1`) |
| Date is today, no uptake (J-0) | `dateMissedNoUptake` | client | daily reminder scheduler (`j0` — the date is today and no notary retained the offer) |
| Offer retained | `offerRetained` | client | `POST /notary/bids/accept` and a proposition accepted — the ONE retain path. Since ADR 0033 it names the notary (nom, étude, `tel:` link, adresse, courriel, fiche CNQ), says the conversation lives in the client's Nota space, that the notary may still withdraw, and quotes the cancellation barème in force (priced on this montant — the fee is the notary's compensation) |
| Offer retained (to the notary) | `demandeRetenueNotaire` | notary | same retain path (ADR 0033) — the client block (nom, courriel, `tel:`, secteur, déplacement, prêteur), the file's readiness, and « ce qui vous engage » (signature à la date, honoraires versés en entier à la signature, le barème d'annulation versé en dédommagement, le désistement gratuit mais compté); CTA `/#notaires&acte=<bidId>` |
| Offer retained (operator) | `operatorDemandeRetenue` | operator | same retain path — a small revenue event |
| New matching demand (instant) | `nouvelleDemande` | notary | `POST /bids` (and the `checkout.session.completed` webhook once the hold is authorized) — every ACTIVE notary whose `alertes.pace` is `instant`, who can serve the demand (ADR 0017/0025 reach), and — when `urgentOnly` — only an elevated tier (`TIERS[].eleve`); once per (bid, notary); CTA `/#notaires&acte=<bidId>` |
| Proposition received | `propositionRecue` | client | `POST /notary/bids/propose` |
| Documents requested | `documentsDemandes` | client | `POST /notary/bids/documents` |
| Chat — notary wrote | `messageDuNotaire` | client | `POST /notary/bids/message` (once per message) |
| Chat — client replied | `messageDuClient` | notary | `POST /client/bid/message` (once per message) |
| Proposition answered | `propositionAcceptee` / `propositionRefusee` | notary | `POST /client/propositions/accept` / `decline` |
| Offer cancelled (ack) | `offerCancelled` | client | `POST /client/bid/cancel` — states the fee kept (`bid.annulation`: amount, taux) and that it goes to the notary as compensation, or that the cancel was free |
| Retained offer cancelled | `offerCancelledNotary` | notary | `POST /client/bid/cancel` (retained bid) — states the amount transferred to them (`annulation.dedommagement.verse`), or owed « dès que vos versements Stripe seront branchés », or that no fee was due; never « notre équipe vous écrit » |
| Retained offer cancelled (operator) | `operatorOfferCancelled` | operator | `POST /client/bid/cancel` (retained bid) |
| Notary withdrew (act released) | `actReleased` | client | `POST /notary/bids/release` |
| Notary withdrew (operator) | `operatorActReleased` | operator | `POST /notary/bids/release` — always (ADR 0033: a désistement is a signal on the notary's file) |
| Act signed → rate the notary | `evaluationInvite` | client | `POST /notary/acts/complete` |
| Evaluation received | `evaluationRecueNotaire` | notary | `POST /client/evaluation` |
| Low rating alert (note ≤ 2) | `operatorLowRating` | operator | `POST /client/evaluation` |
| Contact form (ack) | `contactRecu` | sender | `POST /contact` |
| Contact form (message) | `operatorContactMessage` | operator | `POST /contact` |
| Notary onboarding opened | `notaryOnboardingStarted` | notary | `POST /notaries/connect` |
| Notary account active | `notaryActive` | notary | webhook `account.updated` (once) |
| Notary account active (operator) | `operatorNotaryActive` | operator | webhook `account.updated` (once) |
| Notary disconnected (win-back) | `notaryDisconnectedWinback` | notary | webhook `account.application.deauthorized` |
| Matching open bids digest | `newMatchingBids` | notary | daily reminder Lambda — the live demands each active notary can serve (ADR 0017 perimeter), top 8 by montant, once per notary per day, at the notary's pace (ADR 0033 §7): `daily` (default) = yesterday's; `weekly` = the past week's, Mondays only; `instant` and `off` receive no digest; `urgentOnly` keeps it to elevated tiers |
| Act paid / payout | `actPaidNotary` | notary | accept payout & `POST /notary/acts/complete` |
| Act paid (operator) | `operatorActCompleted` | operator | same as above |
| Notary console sign-in | `notaryMagicLink` | notary | `POST /notary/session/request` (magic-link flow) |
| Admin console sign-in | `adminMagicLink` | admin | `requestLogin` in `apps/api/src/admin.js` |
| Partner code confirmation | `partnerClaimLink` | partner | `POST /partenaires` (email-verified claim) |
| Partner welcome | `partnerWelcome` | partner | partner claim confirmed (`/partenaires/verify`) |
| Referral reward — client track | `referralRewardClient` | partner | referred demand retained (live payment only) |
| Referral reward — notary track | `referralRewardNotary` | partner | referred notary's first retained act (once ever) |
| New partner (operator) | `operatorNewPartner` | operator | partner claim confirmed |

The legacy subscription set (`subWelcome`, `subReceipt`, `subRenewalReminder`,
`subPaymentFailed`, `subCanceledWinback`, `operatorNotarySubscribed`) was
retired with the pay-on-accept/commission model — those templates no longer
exist in the registry and the Stripe invoice/subscription events are
deliberately ignored.

## Where a CTA lands (ADR 0033 §2.7)

Every act mail opens **the act**, on any device:

- **Client** act mails (`offerRetained`, `messageDuNotaire`, `documentDuNotaire`,
  `propositionRecue`, `documentsDemandes`, `dateApproaching`,
  `dateMissedNoUptake`, `dossierIncomplete`, `offerPublished`,
  `evaluationInvite`, `actReleased`, `offerAuthorized`,
  `offerAuthorizationVoided`) use `ctx.clientUrl` — the signed deep link
  `<site>/#offre=<id>&d=<dateISO>&cle=<token>` (CLIENT scope, 30 days) minted
  by `createNotifier({ clientLink })`, wired in the handler's notifier factory
  from `siteUrl` + `signToken`. Without one (an older caller, a test) the CTA
  falls back to the client's space (`/#t=profil`; the two dossier nudges fall
  back to `/#dossier`). The client has no account: the link IS the session.
- **Notary** act mails (`messageDuClient`, `documentDuClient`,
  `propositionAcceptee`, `demandeRetenueNotaire`, `offerCancelledNotary`,
  `evaluationRecueNotaire`, `nouvelleDemande`) open the console on the act:
  `/#notaires&acte=<bidId>` (`ctx.bidId`, set by `bidCtx`).
- **Operator** alerts land on the admin console when `createNotifier({ adminUrl })`
  is set (`NOTA_ADMIN_URL` in the handler), else on the public carnet.
- `supportReponse` reopens the site widget (`/#messagerie`).

Contact blocks (`detailRows`) carry real `tel:` / `mailto:` hrefs — the
phone is dialable from the inbox, which is the whole point of the mise en
relation.

## Admin-parametrizable subjects (overrides)

The notifier can consume a per-template override stored by the admin console.
Everything lives on the consumption side in `emails.js` + `notifications.js`;
the storage is a repo port:

```
repo.getEmailOverride(key)
  -> Promise<{ key, enabled, subjectFr, subjectEn, updatedAt } | null>
```

- **Optional port.** Guarded with `typeof repo.getEmailOverride === 'function'`
  — repos without it behave exactly as before.
- **Cached.** `sendOnce` reads overrides through a 60-second TTL cache keyed on
  the injected clock (`Date.parse(now())`), so a reminder batch costs one read
  per template, not one per mail.
- **Disable.** `enabled: false` short-circuits the send with
  `{ sent: false, reason: 'disabled' }` — and does **not** mark the SENT
  ledger, so re-enabling lets the pending mail go out later.
- **Subject rewording.** `emails.renderSubjectOverride(override, ctx)` builds
  the final `'FR / EN'` subject. It is all-or-nothing: BOTH `subjectFr` and
  `subjectEn` must be non-empty, otherwise it returns `null` and the template's
  built subject stands (a half-translated override would break the bilingual
  contract). Newlines are stripped; nothing is HTML-escaped (subjects are plain
  text headers).
- **Placeholder vocabulary** — `{{token}}`, interpolated per language; unknown
  or missing tokens render as `''`:
  `montant` (domain `money()` fr / `moneyEn()` en), `service` (`nom`/`nomEn`),
  `date` (fr-CA / en-CA long date), `code`, `n`, `note`, `etude`, `email`.
- **`TEMPLATE_META`** (exported from `emails.js`) describes every registry key
  for the console: `{ audience, labelFr, labelEn, defaultSubjectFr,
  defaultSubjectEn, placeholders }` — the defaults show the subject with its
  `{{token}}` placeholders, and `placeholders` lists only the tokens that
  template's ctx actually carries. A test asserts it covers exactly
  `Object.keys(TEMPLATES)`.
- **Non-overridable, on purpose:** the direct `mailer.send` bypasses
  (`notaryMagicLink` via `onNotaryLoginRequested`, `partnerClaimLink` via
  `onPartnerClaimRequested`) and the admin console's own `adminMagicLink`.
  These are auth-critical transactional messages — disabling one would silently
  lock people out, and rewording one blind could break the trust cues (validity
  window, single-use) around a sign-in link.

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
   list) and idempotency (the `(refId, kind)` SENT ledger) come for free. Pass
   `templateKey` (the registry key) and `ctx` (the same context object handed
   to the template) so the admin override system can disable or reword it.
   Send-points in `handler.js` are fire-and-forget: mail must never break a
   response.
5. Describe it in `TEMPLATE_META` (audience, labels, default subjects with
   `{{token}}` placeholders, and the tokens its ctx carries) — the coverage
   test fails until the entry exists.

## Before go-live

- `SENDER.address` in `emails.js` is a **placeholder**; CASL requires the real
  registered mailing address.
