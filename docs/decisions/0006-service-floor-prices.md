# 0006 — Starting-price floors for the three services

## Status
Accepted (2026-08-12)

## Context
Nota shows a starting price ("prix de départ") per service; a client's offer must
be at least that floor and at most 10× it. The floors need to be defensible
against the real Québec market. Notary fees in Québec are **not** tariff-regulated
— mandatory tariffs were abolished in 1991, so each notary sets fees freely. The
floors are therefore market observations, not a schedule.

Market research (2026) found:

| Service | Typical market range (CAD) | Notes |
|---|---|---|
| Testament + mandat de protection | 700–1 000 (bundle) | À la carte a will alone is ~390–500 |
| Procuration | 90–500 | Simple ~90–150, general/complex up to 500 |
| Refinancement hypothécaire | 900–1 500 honoraires + ~550 déboursés | Publication (~350) + tax certificate (~200) are disbursements on top |

## Decision
- **Testament + mandat: raise 495 → 650.** The act is a two-act bundle (will +
  protection mandate); 495 priced it like a will alone and undersold it by
  roughly one act. 650 is a defensible floor below the 700–1 000 bundle range.
- **Procuration: keep 295.** Mid-range for a notarial (en minute) procuration;
  reads as a quality floor rather than a 90 race-to-bottom.
- **Refinancement: keep 950.** Realistic low end of the 900–1 500 honoraires band,
  valid because land-register publication and tax certificates are disbursements
  billed on top, not absorbed into the floor.

Intake additions from the same research (kept minimal to preserve a simple,
client-assemblable dossier):
- Testament: **tuteur des enfants mineurs** (distinct, commonly omitted).
- Procuration: **durée / échéance** of the mandate.
- Refinancement: **certificat de localisation** (routinely required; the item
  that most often stalls a file).

## Consequences
- Floors live only in `packages/domain` (`SERVICES[].prixDepart`) with tests
  pinning each value; changing one is a one-line domain edit plus its test.
- Raising testament raised its premium cap to 6 500 (10×), reflected in the
  domain tests and the `plancher_plafond` BDD feature.
- The refinancement floor assumes disbursements are shown separately at signing;
  if we ever advertise an all-in price it must rise accordingly.
