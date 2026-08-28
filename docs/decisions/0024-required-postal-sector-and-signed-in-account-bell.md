# 24. The postal sector is required on every offer, and the account bell belongs to the signed-in state only

- Status: Accepted
- Date: 2026-08-28
- Extends: ADR 0017 (travel bands), ADR 0018 (notification coverage)

## Context

Two owner asks (2026-08-28):

1. **« Le code postal n'est pas obligatoire. Je crois qu'il doit l'être,
   sinon le déplacement peut changer et varie. »** ADR 0017 priced the
   in-person signature through declared travel bands, but left the bid's only
   location signal — the 3-character postal sector (FSA) — optional. A bid
   without a sector carries a « ≤ 25 km » or « ≤ 50 km » declaration anchored
   to nowhere: the notary cannot judge whether the demand sits inside their
   radius, and the future FSA-centroid distance check (ADR 0017 §« future
   work ») would have nothing to measure from.
2. **The account bell must not show while signed out.** Until now an anonymous
   visitor who had published an offer from their device kept the bell (offers
   and notifications derive from the device). The owner wants the standard
   pattern instead: signed out → explicit « Se connecter / S'inscrire »
   buttons only; signed in → the bell, whose menu is role-aware (notaire vs
   client, unchanged from ADR 0018/0019).

## Decision

1. **`prefixe` is REQUIRED and format-validated in the domain.**
   `validateOffer` rejects a missing sector with `prefixe_requis` and a
   malformed one (not letter-digit-letter) with `prefixe_invalide`, and echoes
   the normalized sector back (`v.prefixe`) for the API to persist. A valid
   non-Quebec sector stays a soft UI warning — the format rule is the
   invariant, the service area is a product setting. The rule lives ONLY in
   `packages/domain` (AGENTS.md rule 1); the API and the demo store both
   revalidate through it, and `openapi.yaml` lists `prefixe` in
   `OfferInput.required` with its pattern.
2. **The field moves out of the folded « Options et confidentialité » block**
   into the open booking flow, marked `required`, and joins the submit gate's
   hint (« Répondez à : … · Secteur postal ») with a door that focuses the
   field. A required field must never hide behind a collapsed `<details>`.
3. **The bell is signed-in only.** `renderAccountMenu()` hides `.acct-wrap`
   whenever the session role is `anon` — the published-offers exception is
   removed. An anonymous publisher's offers and dossier stay reachable through
   the post-publish card and the `#t=` deep links; publishing with a courriel
   signs the device in as a client (unchanged), which restores the bell.

## Consequences

- Every publish path (web form, demo store, API, BDD, e2e) now supplies a
  sector; the fixtures already did.
- The e2e cancel journey signs in (courriel on publish) before reaching the
  offers card, since the anonymous bell no longer exists.
- The public label `Client · G1R` can no longer degrade to `Client · —` for
  new bids; bids that predate this rule may still carry `prefixe: null`.
- The FSA-centroid distance check of ADR 0017 becomes buildable: every new
  bid is guaranteed a sector to measure from. Built the same day — see
  ADR 0025.
