# 13. Retained acts get a conversation, and the notary keeps a right to withdraw

- Status: Accepted
- Date: 2026-08-26

## Context

Retention (the mise en relation, ADR 0010 §4) hands both parties an email
address and wishes them luck. But the days between retention and signature
are where files live or die: lender instructions arrive (or don't), dates
slip, and details surface that the pricing questions could not capture — an
unfamiliar lender (ADR 0012), a conflict of interest, a file that turns out
different from its dossier. Email is off-platform, invisible to Nota, and
gives the notary no honest exit: today a notary stuck with an impossible
file can only ghost the client or route through support.

## Decision

1. **A per-act message thread lives on the bid** (`messages: [{ id, de:
   'client'|'notaire', texte, createdAt }]`), validated by the domain
   (`validateChatMessage`: 500 chars, only while RETAINED, only the two
   parties). `POST /notary/bids/message` and `POST /client/bid/message`
   append; `GET /client/bid`, `GET /notary/bids` (retained entries) and
   `GET /notary/dossier` read it back. Messages send no email — the thread
   is in-app, refreshed on focus/tab switches and after every send (the repo
   deliberately runs no background pollers; push can come later).
2. **The retaining notary may withdraw after accepting**
   (`POST /notary/bids/release`, domain `validateRelease`/`releasedBid`).
   The act returns to the open market **exactly as the client posted it** —
   same date, amount, dossier; the withdrawing notary gets a decline marker
   (never sees the demand again) and loses the calendar pointer; the client
   is emailed (`actReleased`: their offer stands, other notaries see it);
   the operator is alerted when money may be in flight or a reason was
   given (`operatorActReleased`). Only the holder can release, only while
   retained; the withdrawal reason goes to the operator, never public.

## Consequences

- The client keeps their date and price after a withdrawal — the market
  re-decides, not the client's paperwork.
- A released act may bounce between notaries in theory; the decline marker
  makes each bounce one-way, and the operator alert catches repeats.
- Pay-on-accept money already moved is NOT auto-reversed: the operator
  email flags it (`paidOrHeld`) for manual settlement, mirroring the
  cancelled-retained-bid posture (ADR 0010 era) rather than inventing an
  automatic clawback.
- The thread is part of the bid record (same TTL, same privacy posture: the
  public projection never carries it).

> **Note du 2026-09-02 (ADR 0033).** La phrase « Messages send no email » ne
> tient plus depuis l'ADR 0018 : chaque message et chaque document déposé avise
> l'autre partie par courriel (`messageDuNotaire` / `messageDuClient`,
> `documentDu*`), une fois par message, et ces courriels mènent désormais à
> l'acte lui-même. Le désistement reste gratuit pour le notaire mais est compté
> à son dossier (`releasesCount`) et l'opérateur est toujours prévenu.
