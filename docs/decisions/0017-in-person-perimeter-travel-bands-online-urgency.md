# 17. The signature is in person within a declared perimeter — travel bands price the distance, and a declared urgency goes 100 % online at a premium

- Status: Accepted
- Date: 2026-08-27

## Context

A refinancing or financing act signs **in person** — and will, for as long as
the Chambre des notaires has not been convinced to let Nota's acts close 100 %
online (owner, 2026-08-27). That makes the perimeter primordial: someone has
to travel — the client to the notary's étude, or the notary to the client —
and today the product models none of it. The only location signal is the
bid's optional 3-letter postal prefix (made **required** by ADR 0024, owner's
ask 2026-08-28); the notary record has no location, no
travel radius, and no way to say « I take online urgencies ».

The owner's monetization intent, in three rules:

1. **The client's declared mobility is a price lever, both directions.** A
   client willing to travel far opens the largest pool of notaries — that is
   the cheapest scenario and the honest « à partir de » price. A client who
   cannot move (or wants the notary at home) shrinks the pool and adds real
   travel work — the price rises with the kilometres asked of the notary.
2. **A notary willing to travel earns more.** In an under-supplied market, a
   notary who declares a wide travel radius sees demandes others never see —
   and those demandes carry the travel surcharge in their floor, so the
   kilometres are paid.
3. **An urgency is declared, never implied — and it goes 100 % online.** When
   a client explicitly flags an urgency, the act must close online, with a
   notary who has explicitly opted into taking online urgencies. The scramble
   and the (pre-Chambre-agreement) exceptional character carry a firm premium.

Industry practice grounds the numbers. Mobile/travelling notaries price
travel as a **flat call-out fee per radius band** (typically 25–75 $ US
within a local radius) plus tiered per-mile beyond it, and remote-online
sessions and rush work carry their own premiums (see
notaries.com, thebeardednotary.com, nynotaryalliance.com surveys, 2025-2026).
Nota's pricing engine already has the exact shape for this: flat, data-driven
criterion adds on the floor (the « prêteur privé +300 $ » precedent, ADR
0012/0014), with the date-urgency multiplier ladder (tiers) layered on top.

## Decision

1. **A new required criterion `deplacement` on both financing acts — « qui se
   déplace pour la signature ? »** A `choice` catalogue (`DEPLACEMENTS`) in
   the domain, rendered as a select, six explicit bands:

   | id | Who moves | Band | add | poids |
   | --- | --- | --- | --- | --- |
   | `client_50` | client → étude | up to 50 km | +0 $ | 0 |
   | `client_25` | client → étude | up to 25 km | +50 $ | 0 |
   | `client_10` | client → étude | under 10 km | +100 $ | 1 |
   | `notaire_25` | notary → client | up to 25 km | +150 $ | 1 |
   | `notaire_50` | notary → client | up to 50 km | +250 $ | 2 |
   | `urgence_en_ligne` | nobody — 100 % online | — | +400 $ | 2 |

   The baseline (add 0) is the **most mobile client** — so the catalogue
   « à partir de » prices stay exactly what the hero advertises (ADR 0006
   floors hold; the price only ever *flexes down* by the client choosing more
   mobility, never below the floor). The adds raise the dynamic floor like
   any other criterion (`computeBasePrice`), the tier ladder multiplies the
   *recommendation* on top, and the commission (billing layer, ADR 0008/0016)
   scales with the montant — travel and urgency monetize with **zero new fee
   concepts**.

2. **The urgency is a declared signature mode, not a date.** `urgence_en_ligne`
   is an option the client must explicitly pick (« Une urgence doit être
   mentionnée ») — distinct from the *timing* tier ladder, whose `urgence`
   tier keeps its meaning (a date 1 day out). A same-week online urgency
   therefore prices as floor + 400 $, times the date tier's multiplier: the
   two urgency axes compose instead of colliding.

3. **The notary declares a travel radius and an online-urgency opt-in — on the
   server profile.** `POST /notary/profile` (ADR 0016's route) now also
   stores `rayonKm` (one of `NOTARY_RADII` = 0 · 25 · 50, default 0 — a
   notary who said nothing travels nowhere) and `urgences` (boolean, default
   false). `validateNotaryProfile` validates both (`rayon_invalide`).

4. **The feed only offers what the notary can serve.** `GET /notary/bids`
   filters through the domain's `notaryCanServe(deplacementId, profil)`:
   `notaire_25`/`notaire_50` require `rayonKm` ≥ the band; `urgence_en_ligne`
   requires `urgences: true`; client-travel bands reach every notary; a bid
   predating the criterion reaches everyone (legacy tolerance, like the
   lender). Widening your radius **is** how you see more demandes — the
   owner's incentive, enforced server-side, not by a hideable client filter.

5. **The notary sees the band before accepting.** The notary projection
   carries `deplacement` (id, label, who moves, km, urgency flag) beside
   `preteur`; the console shows it as a chip on the card, and `poids` feeds
   the existing complexity signal. The public carnet is unchanged — the
   premium stays computed against the static `prixDepart` so answers remain
   undecodable (ADR 0009 privacy stance).

6. **Geographic truth stays declarative for now.** With no notary address and
   no geocoding allowed (`apps/web` zero-dependency rule), the km bands are
   declarations that frame the mise en relation — not computed distances.
   A real client↔notary distance check needs a notary location field and an
   FSA centroid table in the domain; that was future work when written, and
   is now DELIVERED by ADR 0025 (2026-08-28): the domain carries the centroid
   table, the notary declares their étude's sector, and the measured distance
   decides whenever both sectors are known — these declarative rules remain
   the fallback.
   The 100 %-online urgency path operates under the owner's explicit legal
   risk: like ADR 0008's commission, it requires review with the Chambre des
   notaires before launch.

## Consequences

- Every offer now answers `deplacement`: fixtures, tests and BDD steps gain
  the new required key (the `preteur` sweep precedent); `seedSignature`
  fingerprints the `DEPLACEMENTS` adds so demo carnets rebuild themselves.
- Existing notaries see *no* change on client-travel bids, and see travelling
  or online-urgency bids only after opting in — the conservative default
  protects the in-person constraint.
- A crafted payload cannot buy silence: the API revalidates through
  `validateOffer` (missing band → `parametre_requis`), and an urgency bid
  can only be *accepted* by a notary whose profile passes `notaryCanServe`.
- OpenAPI: `NotaryBid.deplacement`, `NotaryProfile.rayonKm/urgences`, and the
  `/notary/bids` `profil` block are documented by hand, as always.
- When the Chambre allows 100 % online for the general case, the catalogue is
  data: a new zero-add online band (or flipping `urgence_en_ligne`'s add)
  is a one-line domain change plus its tests.
