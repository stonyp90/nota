# 12. The lender is a catalogued pricing factor and the notary's refusal axis

- Status: Accepted — §1's pricing role amended by ADR 0014 (the lender no
  longer surcharges, except `prive`; « Autre prêteur » takes a free-text name)
- Date: 2026-08-26

## Context

Both acts of the financing family (ADR 0010) hinge on one third party the
platform never modelled: the **prêteur hypothécaire** whose instructions and
disbursement make the act possible. Until now the lender was a free-text
intake field (`champs.preteur`) — invisible to pricing, invisible to the
notary's feed, unfilterable.

In practice the lender decides two things:

1. **Work.** A branch bank hands the notary familiar instructions through a
   familiar channel. A *virtual* lender (no branches — Tangerine, Simplii,
   the monolines like First National or MCAP) means remote instructions,
   remote disbursement, more coordination. A private lender means manual
   instructions and extra diligence.
2. **Whether the notary takes the file at all.** Notaries close with the
   institutions they normally work with; an act financed by a lender outside
   that circle is routinely refused.

A free-text field can drive neither a price nor a refusal.

## Decision

1. **A `LENDERS` catalogue lives in `packages/domain`** — the institutions
   that normally lend to Quebec borrowers, each `{ id, nom, virtuel, add,
   poids }`, plus `Prêteur privé` and `Autre prêteur` so the question always
   has an honest answer. `virtuel: true` marks a branchless lender; its `add`
   prices the extra coordination (+100 $), a private lender prices highest
   (+300 $, poids 2).
2. **The lender is a required pricing criterion** (`preteur`, a `choice`
   whose options ARE the catalogue, rendered as a select via the `ui:
   'select'` hint). It flows through the existing engine untouched:
   `criterionAdd`, `complexity` (the factor names the lender),
   `missingRequired` (a bid cannot be posted without naming it),
   `leadReadiness`, fixtures. The free-text champ is retired.
3. **The notary sees the lender before deciding.** `GET /notary/bids`
   projects `preteur: { id, nom, virtuel }` on every open bid and retained
   entry (null on records that predate the question — never a crash).
4. **Refusal is a standing preference, not a per-bid chore.** The console's
   préférences carry a lender roster (all accepted by default); unchecking
   one hides its demands from the feed, exactly like the act filter. The
   per-bid decline stays for one-off passes; the post-acceptance withdrawal
   (ADR 0013) covers a lender discovered too late.

## Consequences

- Virtual and private lenders raise the dynamic floor, so the extra work is
  priced at the source instead of surfacing as notary frustration (or a
  counter-proposition) later.
- The composed factor (« Prêteur hypothécaire : Tangerine ») rides the same
  complexity pipeline notaries already read, and every lender label carries
  an English entry (i18n coverage tests enforce it).
- `seedSignature()` now fingerprints the criteria ids, so adapters rebuild
  demo data seeded before the lender question existed.
- The catalogue is data: adding a lender is one domain line plus one i18n
  entry — never an adapter change.
