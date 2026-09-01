# 16. Notoriety is verifiable and rewarded — the CNQ profile link and the rating-earned commission bonus

- Status: Accepted — **the public display of the rating is withdrawn by [ADR 0030](0030-la-deontologie-prime-la-cote-ne-se-publie-pas.md) (2026-09-01)**
- Date: 2026-08-27

## Context

Since ADR 0015 a client evaluates their notary after the signed act (1–5
stars plus an optional comment), and the one-decimal average now surfaces
publicly — beside every proposition, on the retained contact block, and in
the notary's own console. Two things were still missing (owner, 2026-08-27):

1. A client weighing propositions has no way to check that « Étude Roy » is a
   real, licensed notary. The authority on that question is the Chambre des
   notaires du Québec and its public directory on cnq.org.
2. The evaluations changed nothing for the notary. The owner wants the
   commission to reward the track record: a default rate, and earned bonuses —
   reductions of Nota's cut — allocated from the ratings and the volume of
   past client experiences.

## Decision

1. **A notary may attach their official CNQ directory link to their profile.**
   A new `POST /notary/profile` stores `lienCNQ` on the existing
   `NOTARY# / PROFILE` item. The domain validates it (`validateNotaryProfile`):
   https, host `cnq.org` or a subdomain — nothing else passes. The link is
   declared by the notary, not verified by Nota; what the badge attests is
   « this notary points at a fiche on the Chambre's own site », and the client
   can open it once the notary is retained.
2. **Clients see the membership, not the contact.** Before retention a
   proposition carries only `cnq: true` — a « CNQ » badge. The full link rides
   the retained `notaire` block only, exactly like `courriel` (a CNQ fiche
   lists the notary's phone and address; handing it out pre-retention would
   leak the mise en relation sideways).
3. **The commission is bonified by evaluations — in the billing layer only**
   (ADR 0008's deontology boundary holds; the domain still exposes no
   commission concept). The default rate stays `NOTA_COMMISSION_RATE`
   (0.10). A bonus schedule — each tier a minimum average note, a minimum
   number of avis, and the rate reduction earned — lowers the effective rate,
   never below a floor:
   - note ≥ 4,5 with ≥ 5 avis → −1 point (0.09)
   - note ≥ 4,8 with ≥ 10 avis → −2 points (0.08)
   - floor 0.05; schedule and floor configurable
     (`NOTA_COMMISSION_BONUS_TIERS` as JSON, `NOTA_COMMISSION_RATE_FLOOR`).
   Both settlement paths (`payNotaryOnAccept` capture+transfer, and the
   `completeAct` fallback) charge the effective rate. The write-once ACT#
   ledger keeps replays at the amount actually charged.
4. **The notary can see how to earn it.** `/notary/bids` returns
   `commission: { taux, tauxEffectif, bonus, prochain }` — the console shows
   the effective rate beside the earnings and names the next tier
   (« note ≥ 4,8 et 10 avis → 8 % »), so a better rating is a visible,
   reachable lever, not a hidden rule.

## Consequences

- The badge is only as strong as the host allowlist — a link to anything
  but cnq.org is rejected at the domain, the API re-validates, and the UI
  never renders a badge without a stored link.
- A notary's effective rate can move between settlements as evaluations
  arrive. The ledger stores what was charged, so idempotent replays never
  re-price; analytics' revenue *projection* keeps using the base rate and
  reads slightly high by design.
- The internal `notaryId` still never reaches a client; the CNQ link is the
  notary's own public fiche and shares nothing Nota generated.
- Referral rewards (ADR 0011) are untouched — flat amounts, separate ledger.
