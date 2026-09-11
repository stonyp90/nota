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
4. **Survives hostile clients.** Table-based layout, every LIGHT style inline
   (clients strip `<style>`), no `<img>`, no `<svg>`, no `url()` — the logo
   is typeset so the brand shows even with images blocked. It spells the
   production lockup, exploration 01 « Monogramme lié » (ADR 0048 and its
   2026-09-11 amendment): the deep blue-teal tile holding a heavy white « N »
   with the small signal dot at its top-right, then « OTA » in solid
   uppercase letters at the same 800 weight on `-0.07em` tracking (no rule
   under the word), then the pale « QUÉBEC » badge. The lockup table is one
   accessible image named « Nota Québec », so a screen reader never spells
   « N OTA ». An MSO ghost table pins Outlook to 600px; everywhere else the
   card is fluid. The `color-scheme` / `supported-color-schemes` metas declare
   `light dark`, and ONE `<style>` block carries nothing but the dark layer
   (see *Design tokens*), so Apple Mail, iOS Mail and the Outlook apps repaint
   the card on the product's dark tokens instead of auto-inverting it —
   clients that strip `<style>` keep the light card. The English block
   carries `lang="en-CA"` inside the `fr-CA` document so screen readers
   switch pronunciation.
5. **Compliant on every message.** CASL / Law 25 footer with sender name,
   registered mailing address, a plain-language reason, the contact and
   privacy addresses from `domain.CONTACT`, and a working
   `Se désabonner / Unsubscribe` link — on transactional messages too.
   CASL s. 6(6) lifts only the *consent* requirement for a message that
   solely completes a transaction, not the form requirements of s. 6(2)
   (identification + unsubscribe); a pure service notice is not a commercial
   message at all. Carrying the link everywhere is therefore always
   compliant, and one shell keeps it so. (Open product point: the notifier's
   suppression list silences transactional notices too — CASL does not ask
   for that; see `notifications.js` `sendOnce`.)
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
┌──────────────────────────────────────────────┐  ← Nota light blue #eef5f7 page
│ ┌──────────────────────────────────────────┐ │
│ │ ███ 3px Nota blue-teal top rule          │ │  ← surface card, max 600px,
│ │  [N•]OTA [QUÉBEC]                        │ │    1px border, 12px radius
│ │  La place de marché notariale ·          │ │  ← typeset 01 lockup + tagline
│ │  The notarial marketplace                │ │
│ ├──────────────────────────────────────────┤ │
│ │  H1 (fr)                                 │ │
│ │  lead (fr, muted)                        │ │
│ │  ▎callout — offer line, tinted panel     │ │  ← brand-left-rule emphasis
│ │  paragraph(s) · detail rows · bullets    │ │
│ │        [ CTA — Nota blue-teal ]          │ │  ← ONE CTA per language
│ │  L’équipe Nota                           │ │  ← sign-off, per language
│ │  ──────────── divider ────────────       │ │
│ │  H1 (en) … same structure … [ CTA ]      │ │
│ │  The Nota team                           │ │
│ ├──────────────────────────────────────────┤ │
│ │  footer: Nota · mailing address ·        │ │  ← CASL / Law 25, bilingual
│ │  reason · unsubscribe / contact / privacy│ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

Plus, invisible: a hidden preheader div (the inbox preview line) padded with
zero-width joiners so body copy never leaks into the preview.

## Design tokens

Inline styles are mandatory in email, so the web CSS custom properties can't be
referenced directly. The `PALETTE` object in `emails.js` is the one flattened
copy of the **light-theme** web tokens (`apps/web/public/styles.css`).
`emails-brand.test.mjs` parses that file's `:root` block and holds every key
below to it, so a token changed on the site fails CI here until the copy
follows — change a color there, never inline:

| PALETTE key | Web token | Role in the mail |
| --- | --- | --- |
| `ink` | `--ink` | headings, body |
| `muted` | `--ink-muted` | lead, tagline, footer small print, sign-off |
| `bg` | `--bg` | the page canvas the card floats on |
| `card` | `--surface` | the card |
| `border` | `--border` | card edge, hairlines, digest rows |
| `brand` | `--brand` (Nota blue-teal) | top rule, wordmark, CTA fill, links |
| `brandDark` | `--brand-hover` = `--nota-blue-800` | the CTA's 1px edge, the QUÉBEC badge text |
| `markBg` | `--nota-blue-900` | the lockup's tile |
| `brandBright` | `--nota-blue-500` | the lockup's signal dot |
| `brandInk` | `--brand-ink` | text on the brand fill, the N in the tile |
| `tint` | `--nota-blue-50` | the callout wash, the QUÉBEC badge ground |

Every hex literal written inline must be one of these (asserted) — there is
no email-only colour. Radii sit on the web square scale (`RADIUS`): card
`--radius-lg` 12px, tile and CTA `--radius` 8px, callout `--radius-sm` 6px,
QUÉBEC badge `--radius-xs` 3px — no pills, no circles (asserted).

### The lockup (exploration 01)

`logoHeader()` typesets the three pieces of the production mark in one
`<table role="img" aria-label="Nota Québec">`: a 40px tile on `markBg` with a
24px/800 white « N » and an 11px `brandBright` « ■ » (variant C: a square signal) riding its top-right;
« OTA » at 26px/800, `letter-spacing:-0.07em`, in `ink`, 3px from the tile so
the N opens directly into the word; « QUÉBEC » at 9px/700, `0.08em`, on `tint`
with `brandDark` text, seated on the word's baseline. The letters are written
in capitals (Outlook ignores `text-transform`). The tile and the badge are
constants of the mark and do not change with the theme; only the word takes
the theme's ink. The same block, verbatim, is the owner's personal signature
in `docs/signature-courriel.html` (copy-paste ready, tables + inline styles,
no image), pinned by the same test.

### The dark layer

`DARK` is the one flattened copy of the web **dark** tokens — the standalone
`@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {…} }`
block of `styles.css`, values verbatim — and `emails-brand.test.mjs` pins every
key to it:

| DARK key | Web token (dark) | Role in the mail |
| --- | --- | --- |
| `bg` | `--bg` `#101820` | the canvas (the product's dark canvas — NOT `--nota-blue-950` `#101b26`, the wordmark midnight) |
| `card` | `--surface` `#0f2030` | the card |
| `panel` | `--surface-inset` `#132b3f` | the callout wash |
| `border` | `--border` `#294353` | card edge, hairlines, digest rows |
| `ink` | `--ink` `#f4f8fa` | headings, body, the « OTA » |
| `muted` | `--ink-muted` `#afc2cf` | lead, tagline, footer, sign-off |
| `brand` | `--brand` = `--nota-blue-500` `#407598` | CTA fill, the card's top rule, the callout rule |
| `link` | `--brand-bright` = `--nota-blue-400` `#78a9bf` | links, the CTA's edge |
| `brandInk` | `--on-accent` `#ffffff` | the CTA label (the dark `--brand-ink` `#061c2a` sits at 3.5:1 on the dark `--brand`; a 16px/600 label needs 4.5:1) |

The inline light styles stay the source of truth. `darkStyle()` writes ONE
`<style>` block: `:root{color-scheme:light dark;…}`, then the rule set under
`@media (prefers-color-scheme: dark)`, then the same rule set prefixed
`[data-ogsc]` for Outlook.com. Every declaration is `!important` (it must beat
the inline light style it overrides) and targets a class hook the helpers set:
`nm-canvas`, `nm-card`, `nm-hr`, `nm-ink`, `nm-muted`, `nm-link`, `nm-cta`,
`nm-callout`. Every hex inside the block must be a `DARK` value, every hex
outside it a `PALETTE` value (asserted). The test also computes WCAG 2.2
contrast for the tile, the word, the badge, the CTA and links in both modes
and refuses anything under 4.5:1.

Type: Inter-first stack (`Inter, system-ui, …`), matching the web `--font-sans`.

CTA button: Nota blue-teal fill, white 16px/600 label, `14px 32px` padding
(≥44px touch target), `mso-padding-alt` for Outlook, 8px radius, 1px
`brandDark` border. Table-based ("bulletproof"), no VML.

## Invariants — every template, enforced by `emails-brand.test.mjs`

The generic suites iterate `TEMPLATES` with a rich context AND a bare one, so
registering a template is what opts it in. Each line is an assertion:

- **Subject** reads `FR / EN` (exactly one ` / `), ≤ 78 characters with a
  typical amount, never ALL CAPS, no newline. Operator alerts carry the detail
  on the FR side and keep the EN side a short label so an address fits.
- **Preheader** reads `FR · EN`, each side ≤ 110 characters, and never
  repeats the FR subject.
- **CTA**: exactly one per language, both on the same absolute URL, label
  ≤ 40 characters opening with an imperative verb from the whitelist in the
  test (`Ouvrir`, `Compléter`, … / `Open`, `Complete`, …), and the same
  label + URL in the text alternative.
- **Sign-off** « L’équipe Nota » / « The Nota team » closes each language
  block, HTML and text.
- **Footer**: sender name, mailing address, contact + privacy addresses from
  `domain.CONTACT` as `mailto:` links, unsubscribe link — HTML and text.
- **Shell**: `max-width:600px`, `role="presentation"` tables, exactly one
  `<style>` (the dark layer, nothing else — light stays inline), no
  `<img>`/`<svg>`/`url(`, Inter stack, `light dark` color-scheme metas,
  `lang` switch, the 01 lockup, variant C (tile N■ + OTA. + QUÉBEC on the signal colour, one `role="img"`
  named « Nota Québec ») + tagline, palette-only colours inline and
  DARK-only colours in the layer, square-scale radii, ≥ 4.5:1 on the
  lockup, CTA and links in both modes.
- **No leaks**: no `{{`, `undefined`, `null`, `NaN`, `[object`, lorem/TODO,
  and no empty « · · » offer line — with the rich context and the bare one.
- **Text alternative** carries every `http(s)` link the HTML carries.
- **Dates** through `fmtDate`/`fmtDateEn` — a raw ISO date never reaches the
  copy; **amounts** through `money()`/`moneyEn()`; **acts** through
  `nom`/`nomEn`.
- **Escaped once**: a document name with `&` / `<` reads as typed.
- **Client copy**: no platform jargon (`lead`, `hold`, `capture`, `payout`,
  `webhook`, `Stripe`), and never a rating value, an average or a cote value
  about a named notary (ADR 0030).
- **Notary copy**: never a percentage of honoraires (art. 29.1 / 32); the only
  `%` allowed is the cancellation barème, immediately followed by « du
  montant » / « of the amount », in a sentence that does not name honoraires.
- **Coverage**: `TEMPLATE_META` covers exactly `Object.keys(TEMPLATES)`, and
  every placeholder a template declares is carried by the ctx of the
  send-point that mails it — the test drives every notifier send-point with a
  probing override and reads the interpolated subject back (the three auth
  links bypass overrides and are excluded).

Also, per template: the key fact (offer line, amount, link validity) in a
`callout()` so a 5-second scan gets it, and the first sentence says what
happened and what to do.

## Template inventory — every feature has its dedicated email

This is the actual `TEMPLATES` registry in `apps/api/src/emails.js` (the
generic suites iterate it, so a row here without a registry entry — or the
reverse — fails a test).

| Feature | Template(s) | Recipient | Trigger (send-point) |
| --- | --- | --- | --- |
| Client sign-up | `clientWelcome` | client | `POST /client/welcome` |
| Offer posted | `offerPublished` | client | `POST /bids` |
| Offer posted (operator) | `operatorNewLead` | operator | `POST /bids` |
| Card authorized → offer live | `offerAuthorized` | client | webhook `checkout.session.completed` carrying a PaymentIntent — the signing was already inside the caution window (ADR 0035), so the amount IS held |
| Card registered → offer live | `carteEnregistree` | client | webhook `setup_intent.succeeded` (or a setup-mode `checkout.session.completed`) — ADR 0035: the card is validated and saved, NOTHING is held yet; the copy says so rather than claiming an authorization |
| Authorization lapsed | `offerAuthorizationVoided` | client | webhook `checkout.session.expired` / `payment_intent.canceled` |
| Caution refused at J-2 (client) | `cautionRefusee` | client | daily reminder scheduler, caution pass (ADR 0035) — once per offer; the bank declined the saved card, nothing was charged, retried daily until the signing |
| Caution refused at J-2 (notary) | `cautionRefuseeNotaire` | notary | same pass, only when the act is RETAINED — the notary blocked their day and must know two days ahead; the act stays theirs |
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
  `offerAuthorizationVoided`, `carteEnregistree`, `cautionRefusee`) use `ctx.clientUrl` — the signed deep link
  `<site>/#offre=<id>&d=<dateISO>&cle=<token>` (CLIENT scope, 30 days) minted
  by `createNotifier({ clientLink })`, wired in the handler's notifier factory
  from `siteUrl` + `signToken`. Without one (an older caller, a test) the CTA
  falls back to the client's space (`/#t=profil`; the two dossier nudges fall
  back to `/#dossier`). The client has no account: the link IS the session.
- **Notary** act mails (`messageDuClient`, `documentDuClient`,
  `propositionAcceptee`, `demandeRetenueNotaire`, `offerCancelledNotary`,
  `evaluationRecueNotaire`, `nouvelleDemande`, `cautionRefuseeNotaire`) open the console on the act:
  `/#notaires&acte=<bidId>` (`ctx.bidId`, set by `bidCtx`).
- **Operator** alerts land on the admin console when `createNotifier({ adminUrl })`
  is set (`NOTA_ADMIN_URL` in the handler), else on the public carnet.
- `supportReponse` reopens the site widget (`/#messagerie`).

Contact blocks (`detailRows`) carry real `tel:` / `mailto:` hrefs — the
phone is dialable from the inbox, which is the whole point of the mise en
relation.

## Texto — the second leg of a send (ADR 0051)

A text is **not a template**: it is one line the notifier derives from the
email that just went out, sent only to a recipient whose **express consent**
is on record (`repo.getSmsConsent`, keyed by email like every preference).
LCAP treats a text as a commercial electronic message and Nota reads no
transactional exemption into it — no consent, no text, ever.

- **Which templates text**: `TEMPLATE_META[key].sms === true` — the 17
  act-bound, time-critical ones (client: `offerRetained`, `dateApproaching`,
  `dateMissedNoUptake`, `propositionRecue`, `messageDuNotaire`,
  `documentsDemandes`, `offerCancelled`, `actReleased`, `cautionRefusee`;
  notary: `demandeRetenueNotaire`, `propositionAcceptee`,
  `propositionRefusee`, `messageDuClient`, `documentDuClient`,
  `offerCancelledNotary`, `nouvelleDemande`, `cautionRefuseeNotaire`). Never a
  magic link, never operator/admin/partner/campaign mail.
  `sms-notifications.test.mjs` pins the exact list.
- **What it says**: `domain.smsText({ lang, subject, url })` — « Nota : » /
  « Nota: » in the recipient's language, the subject **as sent** (admin
  override included), « — », the link the email's button carries (the client's
  signed act link, or the notary console on the act). 320 chars max; the
  subject is what gets cut, never the link.
- **When it runs**: inside `sendOnce`, *after* the email's guards (unsubscribe,
  per-template preference, SENT# duplicate, admin kill-switch) and after the
  email is sent and ledgered — so anything that silences the email silences
  the text. Its own ledger key is `<kind>:sms`; its own Law-25 journal line
  too. A carrier failure never fails the email (`sms: { sent: false, reason:
  'sms-failed' }` on the result; the text stays due).
- **Where consent comes from**: the booking form checkbox (`smsConsent` on
  POST /bids), the notary's « Alertes par texto » switch (`alertes.sms` on
  POST /notary/profile, texting the profile phone), and
  `/notification-preferences` (`sms.consent`, masked phone; `smsConsent` to
  withdraw or restore).
- **Ports**: `sms-port.js` — `createSnsSmsAdapter` (prod, behind
  `NOTA_SMS_ENABLED=true` + `infra/sms.tf`), `createFakeSms` (tests, BDD),
  `createFileSms` (local stack, a `.json` per text beside `.local-mail/`).

Adding a texting template = adding `sms: true` to its `TEMPLATE_META` entry
and the key to the pinned list in the test. Nothing else.

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
  `montant` is always the **act's** amount — the referral reward templates do
  not declare it on purpose, so an admin cannot publish the act amount as the
  reward (the reward is `domain.REFERRAL`).
- **`TEMPLATE_META`** (exported from `emails.js`) describes every registry key
  for the console: `{ audience, transactionnel, labelFr, labelEn,
  defaultSubjectFr, defaultSubjectEn, placeholders }` — the defaults show the
  subject with its `{{token}}` placeholders, and `placeholders` lists only the
  tokens that template's ctx actually carries. Two tests hold it: coverage
  of exactly `Object.keys(TEMPLATES)`, and a notifier-driven probe proving
  every declared token renders non-empty from its real send-point.
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
   every invariant listed above automatically — subject and preheader
   lengths, the verb-first CTA pair, the sign-off, palette-only colours, the
   no-leak render under a bare context, the audience copy rules.
4. Wire it in `notifications.js` through `sendOnce()` — consent (suppression
   list) and idempotency (the `(refId, kind)` SENT ledger) come for free. Pass
   `templateKey` (the registry key) and `ctx` (the same context object handed
   to the template) so the admin override system can disable or reword it.
   Send-points in `handler.js` are fire-and-forget: mail must never break a
   response.
5. Describe it in `TEMPLATE_META` (audience, `transactionnel`, labels,
   default subjects with `{{token}}` placeholders, and the tokens its ctx
   carries) — the coverage test fails until the entry exists, and the
   placeholder probe in `emails-brand.test.mjs` fails until its send-point is
   driven there (add the call next to the others).

## Before go-live

- `SENDER.address` in `emails.js` is a **placeholder**; CASL requires the real
  registered mailing address.
