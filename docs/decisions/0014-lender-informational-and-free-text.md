# 14. The lender informs, it no longer surcharges — and an unlisted lender is added by name

- Status: Accepted
- Date: 2026-08-26
- Amends: ADR 0012 §1 (the lender's pricing role)

## Context

ADR 0012 made the lender a catalogued pricing factor: every virtual
(branchless) lender carried +100 $, « Autre prêteur » carried +100 $, and
the private lender +300 $. In the booking dialog this painted a wall of
« (+100 $) » suffixes across the lender dropdown, reading as a penalty for
the client's bank rather than as information — the client does not choose
their lender at booking time, so surcharging the choice priced something the
client cannot act on. And « Autre prêteur » was a dead end: it charged +100 $
yet told the notary nothing about who the lender actually is.

## Decision

1. **Choosing a lender is free.** Every catalogue `add` drops to 0 except
   `Prêteur privé`, which keeps its deliberate +300 $ (manual instructions,
   extra diligence — a genuinely heavier act). The dropdown therefore shows
   plain names.
2. **The coordination signal survives as complexity, not price.** Virtual
   lenders keep `poids: 1` (and `virtuel: true`), so the notary's card still
   composes « Prêteur hypothécaire : Tangerine » and flags « Virtuel » —
   the work is visible without being billed to the client at the source.
3. **An unlisted lender is added by name.** The lender criterion declares a
   free-text companion (`criterion.autre = { option: 'autre', champ:
   'preteur_autre', label: 'Nom du prêteur' }`). Renderers reveal the field
   only while « Autre prêteur » is chosen; `missingRequired()` gates the
   offer on a non-blank name, exactly like the choice itself. The mechanism
   is generic criterion data — adapters render it, never re-declare it.
4. **The typed name travels to the notary.** `bidLender()` returns the
   catalogue entry with `nom` replaced by the client's text (whitespace
   collapsed, capped at 80 chars); the id stays `autre` so the refusal
   roster (ADR 0012 §4) keeps keying on it. Fixtures drawing `autre` carry a
   name so demo bids stay valid offers, and `seedSignature()` now
   fingerprints the catalogue's adds so adapters reseed after this change.

## Consequences

- The dynamic floor for refinancing with a virtual lender returns to the
  service base (2 000 $ instead of 2 100 $); only `prive` still moves it.
- A notary reading the feed sees the real lender name even off-catalogue —
  a better refusal signal than a +100 $ line ever was.
- Old bids that answered `autre` without a name keep rendering as « Autre
  prêteur » — never a crash, never a retro-gate.
