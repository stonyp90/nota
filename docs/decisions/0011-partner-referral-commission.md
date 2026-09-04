# 11. Partner referral commission: a flat thank-you per completed act

- Status: Accepted
- Date: 2026-08-25

## Context

The people who know *today* that a homeowner needs a notary for a financing
are not on Nota — they are the courtier hypothécaire arranging the loan and
the agent immobilier whose deal depends on the closing. They already tell
clients "you'll need a notary"; today that referral is word of mouth Nota
never sees.

ADR 0001/0008 settled how Nota earns (a commission on completed acts, free to
join). Nothing yet says how Nota *spends* to acquire demand. A referral fee to
these professionals is classic, understood marketing in their world — but it
must not contaminate the deontology boundary: the notary's fee and the act
itself stay untouched (`features/deontologie.feature`), and a regulated
referrer (OACIQ brokers, notably) must be able to disclose the compensation
to their client, so the amount has to be public, flat and boring.

## Decision

**Flat referral rewards — amounts defined once in the domain — on two
tracks, each with a visible trigger.**

- **Two tracks, two amounts, both data.** `REFERRAL.client` (launching at
  50 $) rewards a referred **client's demand being retained** by a notary —
  the moment the marketplace visibly worked. `REFERRAL.notaire` (launching
  at 250 $) rewards a referred **notary retaining their first act** — once
  per notary, and worth more because a notary is recurring supply. The
  amounts and the partner categories (`agent_immobilier`,
  `courtier_hypothecaire`, `autre_professionnel`) live in `packages/domain`
  next to the prices, asserted by tests, never hardcoded in an app.
- **Attribution is a code in the link.** A partner shares
  `…/?ref=CODE`. The web app keeps the code on the device and attaches it
  when the client posts their demand **or when a notary signs up**; the API
  stores it on the bid / notary record, **privately** — never on the public
  carnet, never shown to other parties. A code is 4–12 characters, letters
  and digits, case-insensitive (`normalizeReferralCode` / `isReferralCode`
  in the domain).
- **Earned at retention, bounded by "first".** The owner chose the visible
  trigger over the cautious one: a client referral earns when the demand is
  retained (not when the act completes — completion is still tracked as
  information); a notary referral earns exactly once, at that notary's first
  retained act. Exposure to gaming is bounded by the flat small amounts and
  the once-per-notary rule — and under pay-on-accept a retention authorises
  real money, so a fake "accepted" demand is not free to stage.
- **The ledger is derived, not kept.** `referralLedger(bids, notaires)` in
  the domain folds the carnet and the referred-notary records into per-code
  totals (demandes, retenues, completes, notaires, notairesActifs, earned).
  Anything that needs the numbers (admin stats today, a partner statement
  tomorrow) recomputes from the records.
- **The program is legible on the site.** The Partenaires pane presents the
  two reward tracks as the page's centrepiece — plain words, both amounts
  rendered from the domain, a small animation that respects
  `prefers-reduced-motion` — so a visiting professional understands in one
  glance that referrals are rewarded.
- **The client's price is untouched.** The fee is Nota's marketing cost,
  paid out of Nota's own commission. It never appears in the client's amount
  or the notary's fee, and the deontology rule — no commission concept in
  domain pricing or notary-facing surfaces — holds: the referral module is a
  separate concern from act pricing.

## Consequences

- One new private field on a bid (`parrain`, the normalized code); the
  OpenAPI spec documents it on `POST /bids` and marks it write-only.
- Admin stats gain a referral section derived via `referralLedger`.
- The program has a front door: a **Partenaires** pane (one of the header's
  three doors, ADR 0010) that pitches the program and lets a professional
  claim their code self-serve — partner type, courriel, desired code —
  via `POST /partenaires` (code normalized and unique; the shareable
  `?ref=CODE` link is shown on success). The amount shown always reads from
  `REFERRAL.commission`, never a literal in the UI.
- Actual payout (how a registered partner proves identity and gets paid) is
  out of scope here: this ADR establishes attribution, registration and the
  earned amount. Until a payout rail exists, the ledger joined to the partner
  registry is the source of truth for what is owed and to whom.
- One new private field on the notary record too (`parrain`, captured at
  signup), plus the once-per-notary "first retained act" marker the ledger
  reads.
- If either flat amount ever varies (by act, by volume), `REFERRAL` grows a
  map — a data change in one file.

## Addendum (2026-08-25): one code, two faces — the link and the spoken word

A survey of consumer referral programs (Wealthsimple, Uber, Airbnb, Thumbtack,
mortgage/real-estate programs) shows the industry converged on **one personal
code that is both a link and a word you can say out loud**. Links convert
best; typed codes survive where links can't — a phone call, an office visit,
a business card. That second channel *is* the courtier/agent world, so the
program gains it:

- **A visible « Code de référence (optionnel) » field** on the client booking
  form and on the notary signup step — the single entry point for a spoken
  referral. It is pre-filled when the visitor arrived by `?ref=CODE`, making
  the attribution transparent and editable instead of an invisible cookie;
  an emptied field is an explicit "no code". Validation is soft: an invalid
  code warns inline and is dropped server-side — it never blocks the
  transaction (industry rule: a bad code must never cost a booking).
- **Self-referral is dropped silently** (the standard fraud check): when the
  code's registered partner books or signs up with their own email, the
  transaction succeeds but earns nothing.
- **The idempotent claim is a success in the UI too**: the API's 200 on an
  owner re-claiming their code shows the shareable link, never an error.
- The admin ledger renders the already-derived **Complétés** column, since
  the operator paying out by hand reads completion at a glance.

Everything else — flat two-track amounts, retention trigger, private
attribution, derived ledger, no partner dashboard (a code plus transactional
email is the simplest viable partner program) — stands as decided above.

> **Amendement du 2026-09-04 (décision produit, ADR 0037).** La récompense
> client reste ACQUISE à la rétention (registre EARN write-once, inchangé),
> mais elle n'est VERSÉE qu'une fois l'acte de la demande réglé (registre
> ACT#) ; la récompense notaire, une fois que le notaire référé a réglé au
> moins un acte. `GET /admin/metrics/overview` distingue désormais `du`
> (acquis) et `payable`. Motif : une demande retenue puis annulée ne se paie
> pas, et comme EARN est write-once, seul le moment du versement ferme la
> porte « retenir, annuler, encaisser 50 $ ».
