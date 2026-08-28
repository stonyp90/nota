# 25. The distance is measured — FSA centroids anchor the travel bands to real kilometres

- Status: Accepted
- Date: 2026-08-28
- Extends: ADR 0017 (travel bands), ADR 0024 (required postal sector)

## Context

ADR 0017 priced the in-person signature through **declared** travel bands and
named the real distance check as future work: *« A real client↔notary distance
check needs a notary location field and an FSA centroid table in the domain »*.
ADR 0024 delivered the prerequisite — every offer now carries its postal
sector. The declarative proxy had two structural errors:

- **False negatives** — a client asks the notary to come « up to 50 km »
  (`notaire_50`); a notary with a 25 km radius six kilometres away was
  filtered out (`rayon 25 < bande 50`) even though the actual drive is six
  kilometres.
- **False positives** — client-travel bands reached *every* notary, including
  an étude 20 km away from a client who declared they can only travel 10 km.

## Decision

1. **The domain owns an FSA centroid table** (`FSA_CENTROIDS`) covering the
   Québec-metro service area (both shores), and `fsaDistanceKm(a, b)` — a
   haversine distance rounded to the kilometre. The centroids are
   **neighbourhood-level approximations (±1–2 km)**: band-level accuracy
   (10/25/50 km) is all the rules need, and every rendered figure is written
   « ≈ ». Swapping in Statistics Canada's official centroid file is a
   drop-in data upgrade. An FSA outside the table yields `null` — never a
   guess.
2. **The notary declares their étude's sector** (`prefixe`) on their profile:
   optional — empty clears it — validated as an FSA (`prefixe_invalide`),
   stored by `POST /notary/profile` beside `rayonKm` and `urgences`.
3. **`notaryCanServe(deplacementId, profil, clientPrefixe)` measures when it
   can, declares when it must.** With both sectors known:
   - the actual distance must fit the band the client priced
     (`dist ≤ band.km`), whoever travels;
   - when the notary travels, their declared radius must cover the actual
     drive (`rayonKm ≥ dist`) — not the band's nominal km.
   With either sector missing (legacy bids, notaries without a sector, FSAs
   outside the table), the ADR 0017 declarative rules apply unchanged. The
   online urgency stays a pure opt-in — distance never enters it.
4. **The feed shows the kilometres.** Every open and retained entry in
   `GET /notary/bids` carries `distanceKm` (null when unmeasurable), and the
   card's facts row renders « ≈ N km ». The feed filter, the accept gate and
   the propose gate all enforce the measured rule server-side
   (`deplacement_non_couvert`).

## Consequences

- A notary who declares their sector sees a feed that is honest about reach in
  both directions: nearby demands they used to miss, distant ones they can no
  longer waste time on. A notary who declares nothing loses nothing — the
  declarative rules remain.
- The pricing of the bands is untouched: the `add` ladder still prices the
  *declared* envelope; measurement only decides *who is offered the demand*.
- Centroid coverage is a data concern, not a code concern: growing the table
  (or replacing it with the official file) changes no rule.
