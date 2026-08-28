# 26. Live support messaging — a visitor's question lands live with the operator, and the answer lands live in the widget

- Status: Accepted
- Date: 2026-08-28

## Context

The owner's ask: « Ajouter une messagerie sur le site pour les gens ayant des
questions qui tombe live avec moi. » The site had one support channel — the
« Nous joindre » form (POST /contact, ADR 0018) — which requires a courriel
and answers by email, hours later. A visitor mid-decision needs a live lane.

Two constraints shaped the design:

1. **The admin surface can never mutate customer data** (admin-handler.js:
   its Lambda is IAM read-only on the customer table). A support thread is
   customer data, so the operator's reply cannot go through the admin console
   without an infra change.
2. **No third-party chat widget**: `apps/web` is zero-dependency by rule, and
   an external script would also ship visitor questions to a foreign service.

## Decision

One mechanism, entirely on the existing rails:

1. **The widget** — a floating chat button on the public site (vanilla JS,
   token-styled). The first message `POST /support/messages` mints a thread
   and returns a signed per-thread token (`SUPPORT` scope, 90 days) the
   device keeps; the panel polls `GET /support/thread` while open, so the
   answer lands live. The courriel is OPTIONAL — the widget is the reply
   channel; a courriel only adds an offline copy.
2. **The operator's live lane is their inbox.** Every visitor message emails
   the operator immediately (template `operatorSupportMessage`, idempotent
   per message) whose CTA is a **signed reply link**: `{site}/#reponse=<token>`
   with a `SUPPORT_OP` scope (30 days). One tap opens the site's reply box;
   `POST /support/reply` appends the answer as `nota`. No admin console, no
   IAM change, answerable from a phone.
3. **Scopes are watertight.** `SUPPORT` reads its thread and posts as
   `visiteur`; `SUPPORT_OP` reads and posts as `nota`. A visitor token on
   /support/reply is 401. A stale token is 401 — the widget forgets it and
   mints a fresh thread rather than silently splitting a conversation.
4. **The domain owns the message rules** (`validateSupportMessage`: required
   texte ≤ 2000, optional valid courriel; `SUPPORT_FROM`), the API validates
   through it, the widget mirrors it inline before any network call.
5. **Storage**: one item per thread (`SUPPORT#<id>` / `THREAD`), addressed
   only by the id its tokens carry — a GetItem each way, no listing index.
   An admin read-only thread list is possible later (the admin Lambda may
   read the customer table); it is deliberately NOT part of this slice.

## Consequences

- « Live » is polling (8 s while the panel is open), not WebSockets — the
  right trade on Lambda + CloudFront, invisible at this latency.
- When the visitor left a courriel, the reply is also emailed
  (`supportReponse`) — closing the loop for visitors who left the site.
- The operator email address is the existing `operatorEmail` channel
  (ADR 0018); no new configuration. The reply link needs `NOTA_BASE_URL`,
  already set in both Lambdas (infra/lambda.tf, infra/notifications.tf).
- The reply-link token in a forwarded email is a capability: whoever holds it
  can answer that ONE thread for 30 days. Same risk class as the notary
  magic link, narrower blast radius.
