# 15. The act is paid at signing — money moves on completion, never on accept

- Status: Accepted
- Date: 2026-08-27

## Context

Pay-on-accept (introduced with the Stripe hold flow) captured the client's
authorized card and transferred the net to the notary the instant the notary
retained the demand. Three surfaces ended up telling three different money
stories: the notary hero promised « Payé à la signature », the payments card
said the net was wired at retention, and the earnings note said the commission
was taken at signing. The owner settled it (2026-08-26): **the service is paid
at signing** — the client pays the full amount at signing, Nota keeps its
commission, then pays the notary; the notary is evaluated afterwards.

Paying at accept also paid for acts that might never happen: a client can
cancel a retained demand (ADR on cancellation), and a notary can withdraw
(ADR 0013) — both between retention and signature, both after money had
already moved.

## Decision

1. **Accepting retains; it never charges.** `/notary/bids/accept` releases the
   dossier and the mise en relation only. No capture, no transfer, no
   `onActPaid` mail from this route.
2. **Completion settles.** `/notary/acts/complete` (the notary confirms the
   signed act and its final value) is the ONE settlement moment:
   - If the client's card authorization is still live
     (`paymentStatus: 'authorized'` + a bound PaymentIntent), Nota captures it
     and transfers the net (value − commission) to the notary —
     `captureAndTransfer`, the existing `payNotaryOnAccept` mechanics, now
     invoked at signing time. The function keeps its historical name; its call
     site is what changed.
   - Otherwise — no authorization (billing off, `a_reautoriser` after a
     proposition accept) or a capture failure (hold lapsed past Stripe's ~7-day
     window, card declined) — the legacy commission model applies as fallback:
     the client pays the notary directly at signing and Nota charges the
     notary its commission (`chargeActCommission`). The act is never blocked
     by a payment path.
3. **One write-once ledger, unchanged.** Both paths share the ACT# ledger, so
   whichever settles first wins and retries stay idempotent.
4. **Copy follows the model.** « Payé à la signature » stays the notary
   promise; the payments card and the accept toast stop claiming a transfer at
   retention.

## Consequences

- A client cancelling a retained demand, or a notary withdrawing (ADR 0013),
  now unwinds a mise en relation with **no money in flight** — the hold is
  simply released.
- The client's hold typically lapses before a signing more than ~7 days out;
  the capture path then falls back to the commission model. A future
  saved-payment-method (off-session) charge can tighten this without changing
  the routes.
- Referral rewards still *record* at retention (ADR 0011 ledger) but the
  operator pays them out manually; no automated money moves before signing.
- The notary evaluation happens after completion (separate decision).
