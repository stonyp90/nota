# 9. Notary propositions and document requests

- Status: Accepted
- Date: 2026-08-23

## Context

Until now a notary had exactly two verbs on an open demand: *retenir* or
*décliner*. The console listed open demands as one flat grid, and a client
could only learn that their offer was *ouverte* or *retenue*. Two real
situations had no path through the product:

1. The client's price does not fit the file (a complex refinancing posted at
   the starting price). The notary's only options were to take it at a loss
   or walk away — the client never learned that 200 $ more would have closed
   it.
2. The file is incomplete. The notary saw `Dossier incomplet` but could not
   say *which* piece was missing; the client saw nothing at all.

The owner's brief: the notary must "see the bids by date for each service"
and have "an easy way to accept them, suggest a higher price, ask for more
documents, and add it to their work calendar"; the client must understand
what to do next without help, everything within three clicks.

Clients have no account. They are known by a per-device list of posted offers
(`localStorage nota.myoffers.v1`), an optional private courriel, and the
emails the notifier sends them.

## Decision

**Two new notary actions on an open demand — a *proposition* (a higher
price) and a *demande de documents* — answered by the client through a
per-bid token, with the notary console reorganised by signing date.**

- **Business rules in the domain.** `validateCounterOffer` (must exceed the
  client's amount; held to the same 10× cap over the bid's own floor; only on
  an open, future demand), `suggestedCounterOffer` (the pre-filled default),
  `validateDocumentRequest` / `requestableItems` (only the service's own
  documents and intake fields may be requested), and `agendaByDate` (open
  demands by date, then by act in canonical order, best offer first, with
  the money on the table per day). All in `packages/domain`, asserted by
  `packages/domain/test/notary-actions.test.mjs`.
- **The bid carries its negotiation.** A bid record gains `propositions[]`
  and `demandes[]`. A notary sees only their own; a client sees every
  proposition with the notary's `etude` label, never a `notaryId`. A new
  proposition by the same notary supersedes their pending one (`remplacee`).
- **Client identity is a per-bid token.** `POST /bids` returns a
  `clientToken` (scope `client`, subject = bid id) that the web app stores
  with the offer. It authorises `GET /client/bid`, accepting or declining a
  proposition, and pushing an updated dossier (`POST /client/dossier`) —
  which is how a document request gets fulfilled. The token is never echoed
  anywhere else.
- **Accepting a proposition retains the demand.** The bid's amount becomes
  the proposed amount and the same conditional retain path as
  `/notary/bids/accept` runs (one winner, stats, `offerRetained` email).
  Under pay-on-accept the card was authorised for the *old* amount, so no
  capture happens here: the bid is flagged `a_reautoriser` and the money is
  settled at completion (`/notary/acts/complete`), as for any act.
- **Every event has a bilingual email** via the `TEMPLATES` registry:
  `propositionRecue`, `documentsDemandes` (to the client),
  `propositionAcceptee`, `propositionRefusee` (to the notary). The
  commission concept stays out of these and out of the domain
  (`features/deontologie.feature`).
- **The console is an agenda, not a list.** Open demands render by signing
  date (`D.agendaByDate`), each day with its count and total, each act as a
  sub-group. Every card offers *Retenir* (two-step confirm — it moves money),
  *Proposer un prix*, *Demander des documents*, *Décliner* (with undo) and an
  *Agenda* menu (Google / Outlook / .ics) on open **and** retained cards.
  Retained files are hydrated from the API, not only from `localStorage`.
- **The client's side reads in plain words.** *Mes offres* rows link to
  the day, state `Ouverte — en attente d’un notaire` / `Retenue par …`, and
  carry any proposition (`Accepter 1 200 $` / `Refuser`) or document request
  (`Compléter mon dossier`) inline; the bell notifies once per event.

## Consequences

- Six new routes (`/notary/bids/propose`, `/notary/bids/documents`,
  `/client/bid`, `/client/propositions/accept`, `/client/propositions/decline`,
  `/client/dossier`) documented in `apps/api/openapi.yaml`; `GET /notary/bids`
  also returns the notary's own `retained` demands.
- Propositions and demandes are written with a whole-item put: two notaries
  proposing on the same bid in the same instant is last-writer-wins. The
  retain itself stays conditional, so money is never moved twice. Revisit
  with a list-append `UpdateItem` if contention ever appears.
- The client token lives in `localStorage` like the offer list it extends:
  losing the device loses the ability to answer a proposition from the app.
  The emails still tell the client what was proposed; a link-based answer
  path (token in the email CTA) is the natural next step.
- `features/propositions.feature` is the executable specification.
