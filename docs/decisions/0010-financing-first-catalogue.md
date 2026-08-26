# 10. Financing-first: one catalogue, one three-door menu, price before documents

- Status: Accepted (supersedes the service list of ADR 0003; amends the
  readiness rule of ADR 0009)
- Date: 2026-08-25

## Context

ADR 0003 launched Nota with three acts — testament, procuration,
refinancement. Living with them showed the marketplace model only truly fits
one of the three:

- **Refinancement is deadline-driven.** The lender's disbursement date and the
  rate-hold expiry press on the client; the notary meeting happens days before
  finalization. That is exactly the axis the whole pricing engine (urgency
  tiers on the signing date) was built for. Quebec fees for the act are
  quoted flat-rate (roughly 900–1 500 $ residential), which makes offers
  comparable — ideal auction inventory. And a wall of mortgage renewals is
  arriving in Québec through 2026–2027.
- **Testament is a relationship purchase.** Almost never urgent, rarely
  bid-shopped on a date. The urgency ladder is noise for it.
- **Procuration is small and occasional.** Its genuinely urgent cases mostly
  *feed a real-estate closing* — which is financing volume anyway.

Two more frictions surfaced. First, the intake asked the client to assemble a
document checklist before their demand was fully sellable, yet **none of those
documents changes the price** — the price is a pure function of the pricing
criteria answers. Second, the header carried two tabs with expandable
submenus; the owner's bar (ADR 0009: everything within three clicks,
self-explaining) wants fewer doors, not described ones.

## Decision

**1. The catalogue is the financing family — `refinancement` (2 000 $) and
`financement` (1 800 $, the loan act for a *new* hypothec: a purchase or a
first loan on an owned property; no old hypothec to discharge, hence the
slightly lower floor).** `testament` and `procuration` are removed from
`packages/domain` `SERVICES`. ADR 0003's guardrail stands unchanged: a new act
enters the catalogue only with a bounded, client-assemblable intake — the next
candidates are financing siblings (subrogation/transfer of lender, quittance
seule), not a return of the retired acts. `refinancement` stays the default
act.

**2. The menu is three doors, flat: Carnet · Espace notaire · Partenaires.**
No chevron submenus in the header; the mobile drawer mirrors the same three
links (plus theme, language and the legal fold). Every inner destination is
reached from inside its pane, never from a nested menu. There is deliberately
no "Services" door: with one act, the catalogue is not a destination — the
dossier is a *step* of booking and of the post-retention exchange, reached
from the booking flow and "Mes offres". The third door belongs to the people
who bring demand: the partner program (ADR 0011).

**3. Price before documents.** A demand is postable — and sellable — once the
client has answered the **required pricing criteria** and consented to share
the dossier. Documents are *not* required to post: `leadReadiness` now gates on
required answers + consent, and reports the document checklist as preparation
progress, not as a barrier. This aligns the product with what the criteria
already were: the price is derived from answers, never from uploads.

**4. Retention is a mise en relation.** The moment a notary retains a demand
(or the client accepts a proposition), the two parties are put in contact:

- the retaining notary sees the client's contact details (name if given,
  courriel, téléphone when provided) along with the dossier;
- the client sees the notary's étude and courriel;
- from there, documents flow either through Nota's dossier (the ADR 0009
  document-request loop) **or through the notary's own channel** — a dossier
  item can now be marked *transmis autrement* ("already sent through another
  channel"), which counts as provided. Nota does not insist on being the
  pipe; it insists the checklist be visibly complete.

## Consequences

- The domain's `SERVICES` shrinks to one entry; fixtures, pulse, agenda,
  filters and the pricing ladder all follow because they iterate the list.
  `DEFAULT_SERVICE_ID` stays `refinancement`.
- SEO copy, structured data, dictionaries and the OpenAPI `serviceId` enum
  drop the retired acts. Historical bids for retired acts are no longer
  renderable; the carnet is young enough that this is acceptable — the API
  filters unknown `serviceId`s rather than crashing.
- Tests pinning "three services" now pin one; the i18n walker and the
  per-service test loops shrink with the list.
- The refinancement floor is unchanged by this decision: 2 000 $ as pinned in
  `packages/domain` (it has been raised since ADR 0006's 950 $ market study —
  that drift predates this ADR and is worth its own note).
- The retired acts' definitions remain in git history; restoring one is a
  revert plus the ADR 0003 guardrail conversation, not a rewrite.
