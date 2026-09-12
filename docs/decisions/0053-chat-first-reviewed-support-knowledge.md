# 53. Chat first, with reviewed support knowledge

- Status: Accepted
- Date: 2026-09-12
- Extends: ADR 0026 and ADR 0046

The owner wants a simple live customer inbox, AI first replies, personal takeover,
and improvement from customer questions. The existing support records and admin
inbox already provide the conversation; email wording and contact entry points
made the product behave like an email form.

All public “Nous joindre” and per-offer help actions now open the same chat.
Opening never sends or overwrites a draft. Email is an explicit optional copy;
it is no longer expanded automatically on a send or handoff. The legacy contact
form remains available to existing integrations via `Nota.contact.openEmail()`.
The visitor can ask for a person directly. Automated messages are labelled and
no human online status or round-the-clock human staffing is claimed. Read polling
is three seconds for an open visitor chat and five seconds in the active admin
inbox, with existing visibility, offline, deadline and backoff protections.

Improvement means reviewed knowledge, not automatic changes to model weights:

1. The operator answers in the admin conversation.
2. “Améliorer l’assistant avec cette réponse” creates an editable draft from
   that human reply and the preceding question. Nothing is published yet.
3. The operator generalizes the answer, removes personal and case-specific facts,
   writes both languages, and explicitly confirms the review.
4. Server-side validation applies answer guards, rejects recognizable private
   data, links, numeric facts and instruction attacks, and checks that the source
   really is a human reply. Human review remains necessary; pattern checks cannot
   recognize all personal information or prove factual correctness.
5. A complete matching question reuses the approved answer without a model call.
   Built-in catalogue topics retain priority. Broader questions use the existing
   provider and fact sheet if configured, otherwise reach the operator.
6. The operator can withdraw the answer. Fresh requests read the new revision;
   no process restart or model retraining is needed. Responses already in flight
   may still use their starting snapshot.

Reviewed entries live in one bounded `CONFIG#SUPPORT / KNOWLEDGE` item, separate
from private transcripts, with conditional revisions and a narrow admin IAM
write permission. The API accepts at most 40 entries and caps encoded storage
below DynamoDB's item size limit. Stable source-based IDs prevent duplicates;
concurrent reviews cannot overwrite each other silently. Audit events record
actor, entry ID, revision and activation, not private text. No transcript export
or model-training job is introduced.

This is intentionally a conservative first learning loop. It does not yet group
semantically similar questions, automatically judge correctness, train weights,
or measure customer resolution. Exact-match coverage should not be reported as
model accuracy. Review repeated unanswered questions in the inbox, publish the
approved general answers, and grow the bilingual regression set before expanding
retrieval. Changes to pricing and policies continue to belong to domain/config.

Intercom's [guidance practices](https://www.intercom.com/help/en/articles/10560969-fin-guidance-best-practices)
and [guidance workflow](https://www.intercom.com/help/en/articles/10210126-provide-fin-ai-agent-with-specific-guidance)
informed explicit human handoff, clarification, review and testing. This does not
claim feature parity or automatically trained weights.

Validation includes domain and API tests, both storage adapters, authorization,
concurrency, guardrails, browser drafts, French/English journeys, mobile layout,
and approval → new visitor answer → withdrawal without a model provider.
Deployment must include public/API/admin assets and the scoped IAM statement;
free-form generated answers also require the existing assistant credentials.
