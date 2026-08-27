# 18. Every lifecycle event notifies on both channels — and email subjects become admin-editable

- Status: Accepted
- Date: 2026-08-27

## Context

An audit of the notification vertical (2026-08-27) found the email channel
broad but leaky, and the in-app channel client-only and partially dishonest:

- **Chat had no email at all**, in either direction. A notary writing to
  their retained client — or a client answering — produced nothing but a
  bell entry that only appears if the client happens to reopen the app.
- **The evaluation loop was one-way**: the client is invited to rate at
  settlement (ADR 0015/0016), but the notary was never told a rating landed,
  and nobody was alerted on a 1–2 star review — no churn/moderation signal.
- **Two templates were dead**: `dateMissedNoUptake` (registry + tests, no
  call site) and `newMatchingBids` (a notary digest with no scheduler and no
  way to enumerate notaries without a Scan).
- **The `dossier_incomplet` reminder never fired**: `dueReminders` gated on
  `bid.dossierReady`, which no code ever writes — even though the API
  already computes readiness on every feed read via `domain.leadReadiness`.
- **Referral reward drift**: `notifications.js` guarded liveness with
  `paymentStatus !== 'voided'` while the canonical persisted value is
  `'void'` — a voided (never-authorized) demand could earn reward mail.
- **Small leaks**: the admin Lambda's inline mailer dropped the branded HTML
  body (text-only magic links); `GET /unsubscribe` skipped the
  trim/lowercase normalization that the suppression lookup expects.
- **The profile toggles lied**: the card said notifications were controlled
  « par courriel et dans l'application », but the switches only ever gated
  the local bell — and four in-app kinds had no switch at all.
- **Nothing was parametrizable**: every subject and body is hardcoded in
  `emails.js`; the admin console (read-only metrics) had no notifications
  section.

## Decision

**1. Close the coverage holes on the existing rails.** New templates on the
same bilingual branded shell (`build()`/`layout()` — no bypasses):
`messageDuNotaire` / `messageDuClient` (chat, idempotent per message id),
`evaluationRecueNotaire` + `operatorLowRating` (rating landed; operator
alerted when note ≤ 2). `dateMissedNoUptake` wires to a new domain reminder
kind `j0` (signing date is today, still open). `dossier_incomplet` is
repaired **in the domain**: when `bid.dossierReady` is absent,
`dueReminders` falls back to `leadReadiness(bid.serviceId, bid.dossier)` —
no new write path, the readiness truth stays where it already lived.

**2. The notary digest gets an enumerable roster, not a Scan.** Active
notaries join the existing sparse-GSI1 overload family (`GSI1PK = 'NOTARY'`,
set/cleared by `putNotary` on `status === 'active'`), and
`repo.listActiveNotaries()` feeds the daily reminder Lambda, which now also
sends `newMatchingBids` — the fresh live demands each notary can actually
serve (ADR 0017 perimeter rules) — at most once per notary per day via the
SENT ledger. Pre-existing profiles enter the index on their next write; the
early-stage roster makes a backfill unnecessary.

**3. Email subjects become admin-editable; bodies stay code.** A per-template
override — `{ key, enabled, subjectFr, subjectEn }` — is stored in the main
table under `CONFIG#EMAIL` / `TPL#<key>` and edited from a new
« Courriels » section of the admin console (super_admin, audit-logged). The
notifier consults overrides through the repo port with a short in-process
cache: `enabled: false` is a per-template kill-switch; subject overrides
interpolate a small `{{placeholder}}` vocabulary (montant, service, date,
code, n, note, etude, email) per language, formatted by the same domain
helpers the defaults use. **Bodies are not editable**: the branded layout,
CASL footer and unsubscribe plumbing are guaranteed by code and enforced by
the brand test suite — a free-text body editor would let an operator break
all three. `TEMPLATE_META` in `emails.js` is the registry the admin UI
lists (audience, labels, default subjects, allowed placeholders).

**4. Transactional auth mail is never parametrizable.** The notary magic
link, partner claim link and admin magic link already bypass suppression and
dedupe by design; they equally ignore overrides — a kill-switch or reworded
subject on a sign-in link is an outage, not a customization.

**5. The in-app channel tells the truth and covers settlement.** Every kind
actually produced has a declared default and a switch; the card copy says
what the switches do (the bell — email remains transactional, managed by
the unsubscribe link). New derivations: « acte signé — évaluez » when the
poll shows completion, and release detection (previously retained → open
again) that retires the stale « retenue » entry.

**6. Admin writes are least-privilege.** The admin Lambda keeps its
read-only posture on customer data; it gains write access only to the
`CONFIG#` partition of the main table (IAM `dynamodb:LeadingKeys`
condition). The public API keeps reading overrides through the repo it
already owns.

## Consequences

- Every feature with a lifecycle moment now notifies on the channel(s) the
  audience actually watches; conversion (welcome, publish, dossier, J-7/3/1,
  J-0), retention (chat, evaluation, digest) and win-back (release, void,
  deauthorize) are all covered by named templates on one shell.
- The digest introduces the first per-notary daily fan-out; volume is
  bounded by roster × 1/day and the SENT ledger. If the roster grows past a
  single GSI partition's comfort, shard `NOTARY` like `OPENBID` would be.
- Editable subjects mean a template's subject test asserts the *default*;
  override rendering has its own tests. Copy changes no longer require a
  deploy — but body changes still do, deliberately.
- The `.claude` worktree caveat stands: `docs/email-design.md` is the
  template catalogue of record and was refreshed to match the registry.
