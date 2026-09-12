# Guided support chat

## Chat first and reviewed knowledge (2026-09-12)

“Nous joindre” now opens the persistent chat, with no email required. Per-offer
help prepares a context draft without sending it or replacing unfinished text.
The visitor can explicitly ask for a person; the handoff stays in this conversation
and works even without a model provider. Email copies remain opt-in. AI identity
is explicit; no always-online human badge or guaranteed response time is shown.

Open visitor threads refresh every three seconds; the active admin inbox refreshes
every five seconds. Both retain visibility/offline suspension and failure backoff.

In **Admin → Messagerie**, answer a visitor, then choose **Améliorer l’assistant
avec cette réponse**. Generalize the question and answer in both languages, remove
personal and case-specific details, and confirm the review before approving.
Approved answers appear under **Réponses approuvées de l’assistant** and can be
withdrawn there. Drafts survive thread switching and polling within the view.

Approved complete-question matches answer without a provider. Other questions use
the existing configured provider or reach a person. Raw customer messages never
train model weights or publish answers automatically. The current learning loop
uses exact questions; semantic grouping and fine-tuning are not implemented.
See [ADR 0053](decisions/0053-chat-first-reviewed-support-knowledge.md) for storage,
guards, limits and deployment details.

The public support widget has four quick starters and a persistent, collapsible
browser containing 25 bilingual topics. Choosing a topic fills the composer
without sending or replacing an unfinished draft. The full list remains
available after the first reply. The composer explains that this is general
support, without access to the customer's file, and warns against sharing secrets.

## Response flow

When an assistant is configured:

1. Server checks route explicit human requests, complaints and recognizable
   secrets to a person before calling the model. Detected instruction attacks
   also bypass the model.
2. An exact normalized match to a topic uses the prepared French or English
   answer in `apps/api/src/support-playbook.js`, or that topic's human handoff.
   Additional text does not qualify as an exact match.
3. Other questions reach the model with the domain fact sheet, API policy,
   discussion guides and prepared replies. The prompt requires clarification
   for ambiguity and handoff for personal advice, unresolved issues and unknowns.
4. Domain guards and API capability checks reject unsafe answers, including
   unsafe text inside a proposed handoff. Successful model output must have a
   valid level and no escalation reason. Unapproved external URLs are rejected;
   source URLs explicitly present in the financing fact sheet are allowed.
5. Existing support-thread persistence, the admin inbox and operator alerts
   handle escalations. The visitor follows the reply in the chat. No new message is sent to an external party by the UI
   merely selecting a topic.

With no model port configured, approved custom answers can still answer exact
questions. Explicit handoffs are acknowledged; other questions reach a person.
Built-in prepared topics retain their existing model-configuration gate.

## Ownership and maintenance

`packages/domain/index.js` owns bilingual questions, discussion guides, escalation
reasons and product safeguards. The API owns prepared operational answers and
model transport. Catalogue names and payment timing come from current domain
facts; no new pricing rules are introduced. Keep a unique topic ID and bilingual
answer or explicit escalation route whenever extending `SUPPORT_TOPICS`.

The matcher is intentionally conservative. It is not an exhaustive classifier,
legal adviser, account lookup, or transaction tool. Regex guards cannot prove
that arbitrary generated text is correct. Sensitive history detected by these
checks is masked before the model request, but original messages still remain
in the existing support storage and operator workflow; this change does not
claim to redact stored support records. Retained-act document exchange remains
separate from general support.

## Verification

Coverage includes bilingual prepared replies, all topic routes, human and
complaint bypass, recognizable secrets, instruction attacks, unsafe model
responses and handoffs, context masking, draft preservation, and accessible
persistent topic discovery. BDD covers the same handoffs and the complete
prepared catalogue. Browser QA includes French and English, desktop and mobile.

## Reliability and usability improvements (2026-09-09)

The topic browser now includes accent-insensitive local search and a useful empty
state. Search and topic selection never submit a message. The conversation is an
accessible live log; closing it returns focus to the launcher or the visible
mobile menu control. Responses arriving after closing or hiding the page remain
unread.

A failed or timed-out submission retains the message. If the customer has already
started a new draft, the original message stays marked as unconfirmed with an
explicit restore action. Restoring does not send or overwrite another draft.
Uncertain POSTs are never retried automatically: a lost response does not prove
that the server rejected the message. An explicit retry preserves the exact body
and message ID. A first-message attempt also retains a temporary random recovery
credential in memory, so a lost first response can recover the same thread without
already having its visitor token. The API stores only its digest and uses bounded
processing claims; concurrent retries do not repeat the model call. This in-memory
recovery state does not survive closing or reloading the page before confirmation.
Expired credentials are the exception: a definite 401/404 permits
one new-thread submission, retaining recovery state if that submission fails.

Polling allows one outstanding read per conversation surface, pauses while hidden
or offline, backs off failures up to two minutes, and resumes when available.
Requests have deadlines that cover both fetching and JSON decoding. Old reads
cannot erase a renewed session, regress read timestamps, or overwrite a saved
email. Operator double-submissions are suppressed and newer reply drafts survive.

Customers can explicitly save an email after their question using
`PATCH /support/thread`. The request only updates that conversation's address;
it does not append a message, invoke the assistant, or send an email. Validation,
failure feedback and confirmation appear beside the field. A reload retrieves
the saved address for the visitor holding the conversation token.

## Conversation ownership and concurrent updates

Both message responses and thread reads return `escalade` (waiting for a person)
and `humain` (a person has joined). Pending handoffs and human participation bypass
the assistant, including its configuration lookup. Subsequent customer messages
reach the operator with conversation history, without another automated reply.
A human reply clears the pending handoff and retains human ownership.

Support records use conditional revisions in both repositories. Appends and email
updates merge against the winning revision, retrying at most eight conflicts
without repeating model work or notifications. A late model result is discarded
if a person or pending handoff won the race. Exhausted contention returns 409
instead of accepting a message that was not stored. DynamoDB reads of an individual
support record are strongly consistent; legacy records upgrade on their first
conditional update. Stable request identifiers additionally protect supported
retries across channel adapters; see the shared inbox section below.

## Assistant efficiency and provider boundary

Prepared-question indexes are immutable and shared across handler instances.
Answers and operational facts stay scoped to the current configuration. The
model prompt is lazy, and one model request builds one playbook and policy
snapshot. The provider SDK also initializes lazily, only for a model request.
No cross-request prompt cache or stale-price cache is introduced.

The provider gets one bounded attempt, without SDK retry or request-body logging.
Malformed structures, unexpected types, incomplete/truncated responses and unsafe
answers route to a human. Token usage is sanitized. Recognizable secrets and
instruction attacks are masked in bounded history, not only in the current
question. An appended non-Latin question prevents a prepared-answer exact match;
a known FAQ cannot silently swallow additional questions.

Run the focused regression suite and reproducible matcher benchmark:

```sh
npm run test:chat
npm run benchmark:chat
npx playwright test e2e/support-chat.spec.js e2e/support-admin.spec.js e2e/support-knowledge.spec.js --project=chromium --workers=1
```

The matcher benchmark compares equivalent normalization and the previous linear
scan against the shared index: three rounds of 50,000 mixed French, English and
free-form questions. A local run measured median 885.7 ms versus 53.8 ms (16.5×).
This is a synthetic lookup CPU measurement, not end-to-end latency, customer
resolution rate, or evidence that all generated answers are correct. It is a
measurement script, not a flaky timing assertion in CI.

Focused provider/playbook tests cover malformed output, transport errors,
credential handling, instruction attacks, repeated troubleshooting and all
prepared bilingual topics. Route tests include concurrent visitor/operator writes,
independent API instances, legacy revisions, save-email races and handoff recovery.
UI tests cover delivery recovery, read races, timeouts, unread state, search,
composition input, draft preservation and mobile focus. Browser journeys exercise
French/English at desktop and 390×600 sizes against the local API.

## Industry comparison and ongoing evaluation

Reviewed primary Intercom documentation on 2026-09-09:

- [Fin guidance](https://www.intercom.com/help/en/articles/10210126-provide-fin-ai-agent-with-specific-guidance)
  recommends explicit context/clarification rules, source guidance, escalation on
  human requests or repeated failure, and realistic preview testing. Nota applies
  those principles with prepared paths, enforced handoff and adversarial fixtures.
- [Messenger accessibility](https://www.intercom.com/help/en/articles/6612597-messenger-faqs)
  describes keyboard navigation, screen-reader support and accessibility review.
  Nota adds focus, live-log and responsive regression checks; these checks are not
  a WCAG conformance audit.
- [Unified conversation QA](https://www.intercom.com/learning-center/qa-system-ai-human-conversations)
  emphasizes continuity and context at the handoff. Nota preserves the conversation
  and human ownership and tests concurrent handoff behavior.
- [Inbox setup](https://www.intercom.com/help/en/articles/10223008-setting-up-the-inbox)
  and [customer notification behavior](https://www.intercom.com/help/en/articles/250-push-email-chat-and-post-notifications-for-customers)
  informed the shared transcript, direct email replies, explicit operator role,
  and reopening a resolved conversation when the customer follows up.

These improvements adopt relevant practices, without claiming Intercom feature
parity. Before assessing production quality, run a consented review of real
anonymized conversations for answer correctness, repeat contacts, handoff success,
and response latency. Unit tests use fake providers; they cannot measure live
model answer quality, customer satisfaction or production load.

## One inbox for the widget, admin and email

The existing admin console now has **Messagerie / Messages**, with status filters,
the full transcript, an inline reply composer, and a close action. The canonical
deep link is `/#/support?thread=<id>`; the existing sign-in gate preserves this
destination. Support access requires `support:read` or `support:write` together
with `pii:read`; existing super administrators inherit the permissions. The API
rechecks authorization and revoked sessions on every request. Audit entries
identify the actor and conversation, without copying private message text.

Admin and email replies use `apps/api/src/support-conversations.js` and the same
`SUPPORT#` records as the public widget and original signed reply page. No second
inbox, CRM or conversation store is introduced. Admin drafts survive polling and
thread navigation within the session; signing out clears them. Background polling
does not extend the operator's idle session. A close adds no message or email;
the next customer message reopens the same thread and retains human ownership.

Admin retry IDs and incoming email Message-IDs are deduplicated at the shared
conditional-write boundary. Notification attempts also have a persisted claim
so concurrent requests do not independently send the same pending notification.
A failed delivery can be retried without appending the message again. There is
still an unavoidable external delivery ambiguity if SES accepts an email and the
process fails before recording success; this is not an exactly-once SES guarantee.
The admin transcript shows an unconfirmed email delivery and offers a retry of
that saved message, including after a reload. Retrying leaves the composer draft
alone and reuses the message ID; it does not add another transcript entry.

The local launcher shares one in-memory repository between its public and admin
API listeners. `npm run local` therefore exercises the actual cross-channel
workflow, with file-based mail and no AWS. Docker continues to share DynamoDB.
The full-loop integration test starts at the public handler, signs in through
the local admin composition, replies in admin, processes authenticated MIME
replies from both participants, retries them, and checks one unchanged thread ID.
Browser tests additionally drop an already-saved admin response and retry it,
verify the reply in the customer widget, and exercise closing and reopening.

## Email reply activation

Outbound support messages use a signed Reply-To only when receiving is enabled.
The capability is bound to the conversation, role, intended sender and expiry.
The receiver also requires authenticated SES verdicts and checks the current
customer address or operator allowlist. Forwarding a notification does not grant
another sender operator access. Quoted history and common signatures are stripped;
automated responses are rejected to prevent mail loops. Attachments are ignored;
general chat is not the document intake channel.

The opt-in SES/S3/Lambda resources use a dedicated reply subdomain and leave the
existing mailbox MX untouched. Provisioning, packaging and activation must follow
the [receiving runbook](support-email.md). Until deployed and activated, the UI and notification
templates offer the working web/admin response path and do not advertise direct
email-to-thread replies. Local tests use synthetic authenticated SES events and
fake mail, not live delivery or real customer messages.

Customer notification links carry a scoped, expiring conversation credential in
the fragment. The widget removes the fragment and verifies it with the API before
adopting the conversation, allowing continuity on another device. Invalid or
expired links preserve the browser's existing conversation. A forwarded customer
link grants visitor access to that conversation, like the existing browser token;
it never grants operator or admin access. Signed Reply-To capabilities have the
additional sender binding described in the receiving runbook.
Both initial page loads and links opened in an existing tab use the same link
consumer. Removing the fragment does not trigger another request.

The final focused coverage run on 2026-09-09 measured **95.95% lines and 86.61%
branches** across `src/support-conversations.js`, `src/support-email.js` and the
email Lambda entrypoint. The shared conversation module has 100% line coverage;
these figures do not represent whole-application coverage. Nine real-browser
journeys cover French/English admin replies, saved-response retries, first-message
recovery, customer link restoration, closing/reopening, and desktop/mobile topic
discovery. No live email or production infrastructure was changed by verification.
