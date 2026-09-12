# Notary experience refinements — 2026-09-12

The open-offer count and total now describe the cards actually shown after
service, readiness, lender and day filters. A reset control restores the browsing
filters without changing the notary's lender preferences. If lender preferences
hide everything, the empty state explains why and opens those settings.

An authenticated calendar link is resolved against the refreshed API response,
independently of whether a temporary filter hides its card. An unavailable offer
has an inline explanation and a way back to available requests. A failed network
load preserves the selected offer for a later successful refresh.

Retained files without messages now offer a clear first-contact action. It
prepares an editable message, moves focus into the composer, and preserves any
existing draft. Only the existing Send button transmits a message. The new
controls, notices and draft are translated into English.

Two heading colors were aligned with the existing neutral-heading rule. The
focused-composer polling test now controls elapsed time, so rendering delays on
a busy machine cannot accidentally consume its pause window.

Validation:

- Browser at desktop width and 390 × 844: matching totals, filter reset,
  unavailable-link recovery and first-message preparation in FR/EN, with no
  horizontal overflow. No message was sent; the synthetic draft was cleared.
- The initial targeted run passed 95/97 tests. Its two failures were corrected:
  the polling clock check and the heading hover color. Their reruns pass.
- Final focused regressions: 6/6 pass for totals/reset, lender preferences,
  hidden and unavailable links, draft preservation and the polling grace.
  Browser recovery from a malformed offer identifier also passed.
- Production build, JavaScript syntax and changed-file whitespace checks pass.
- A duplicate full web run was stopped because two other full runs were already
  consuming the host. This change has not been merged or deployed.

Review capture: `output/notary-polish/client-handoff.jpg` (fictional client).
