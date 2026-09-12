# Refinancing improvement log

## 2026-09-12 — explicit cost stop and document-role regression

- Worked on isolated branch `codex/ai-worker-cost-stop-2026-09-12`, based on
  `b6c1c2e`, preserving unrelated edits in the main working directory. GitHub
  reports successful public/admin deployments for that base; this branch has
  not been deployed or applied to AWS.
- Found and fixed the worker's false stop: setting its environment flag false
  previously left DynamoDB reads active. Missing/invalid/disabled flags now
  return before imports, client creation, reads or application logs. An explicit
  Terraform opt-in (default false) links the scheduler state, reserved
  concurrency and handler flag. The operator CLI also requires `--read-aws`
  or `--apply` before it can access a configured table.
- Distinguished Scheduler delivery retries from Lambda asynchronous processing
  retries. Added zero function-error retries, one-hour maximum event age and a
  queue-specific failure destination using the existing DLQ. These bounds are
  not a dollar cap or exactly-once guarantee. Existing alarms/storage may still
  cost money while computation is paused; a code-only deployment does not
  apply Terraform's stop. No zero-account-cost assertion is made.
- Rechecked the public [RBC Quebec forms](https://www.rbcroyalbank.com/fr/formulesjuridiques/qc-residential.html)
  and [FCAC mortgage discharge guidance](https://www.canada.ca/en/financial-consumer-agency/services/mortgages/mortgage-discharge.html).
  Added synthetic development case `client-document-date-decoys-fr` and bumped
  dataset version to `2026-09-12.1` (nine cases). The evaluator now rejects an
  offer version mislabeled as lender instructions, and a monthly statement
  date mislabeled as official payout validity, despite literal page quotes.
  This verifies the evaluator, not a live model or a runtime document-role fix:
  literal validation still cannot establish document authority. Professional
  instruction, payout and closing checks remain pending.
- No new authorized professional labels were supplied in this task; no private
  customer documents were accessed. No AWS API, Cost Explorer, live model,
  training, outreach, account creation or deployment operation was performed.
  Model weights remain unchanged and whole-workflow effort reduction is unknown.
- Validation: domain 450/450, final API 2107/2107, web 989/989, admin 244/244,
  BDD 296 scenarios / 2066 steps passed. Both production builds, Terraform
  formatting/validation and `git diff --check` passed. All model responses in
  regression tests were synthetic doubles; passing does not establish 90%
  automation or professional qualification.
- [Operating limits and AWS source references](customer-improvement-cost-stop-2026-09-12.md).
  Next: review/apply the production stop using the correct Terraform state if
  execution must be paused; design authenticated document-role provenance before
  suppressing official-evidence questions from extracted values.

## 2026-09-09 — cost and performance controls

- Added deterministic exact-result reuse before provider resolution or AI
  admission. Reuse is scoped to the retaining notary and exact validated source,
  service, prompt/schema/knowledge version, provider, region and model; the
  saved preparation is revalidated and the work packet is rebuilt from the
  current server dossier.
- Identical concurrent requests share one generation within an API worker.
  Warm workers retain the provider client, and the existing SSM secret cache
  avoids repeated key lookups. Cross-worker deduplication remains guarded by the
  repository's optimistic analysis write.
- Added a shared UTC-day provider-call cap, configurable through
  `NOTA_FINANCING_AI_MAX_CALLS_PER_DAY` and defaulting to 100, in addition to
  six admitted attempts per notary per hour. Unavailable or malformed counters
  fail closed; failed attempts reserve capacity and are never reusable.
- Persisted bounded provider, latency and usage metadata, including cache reads,
  cache writes and whether the provider reported usage. Prompt caching and
  automatic model downgrades remain deferred until notary-reviewed quality and
  cost-per-accepted-file measurements support them. No measured saving or 90%
  automation result is claimed.
- Validation for this increment: financing/domain/API extraction checks 201/201,
  financing UI and work-packet checks 46/46, API contract checks 25/25, both
  production builds and `git diff --check` passed. Full domain, API, web and BDD
  runs still include unrelated concurrent workspace failures; no deployment was
  made.

## 2026-09-09 — AWS restored and Bedrock transport implemented

- Restored AWS authentication with temporary, process-local credentials. No
  configured Anthropic API key was found; the documented SSM parameter was absent.
- Added explicit Bedrock provider/region/model configuration in the runtime and
  evaluator, with the same source-evidence contract and a fixed 20-second deadline.
  Two subagents completed route configuration and evaluator integration. Fixed
  the evaluator's financing-specific model override precedence.
- Registered the Anthropic use case from the repository's operator identity and
  deployed website, then verified the saved form. The final account blocker is
  AWS Marketplace `INVALID_PAYMENT_INSTRUMENT`. The owner was asked to fix billing
  outside the conversation; no payment information or replacement key is requested
  in chat.
- Preserved two failed live reports (0/8 each) and the sanitized payment diagnostic
  in `docs/ai/evaluations/`. No model-quality score or training is claimed.
- Focused financing checks 186 passed; full domain 392, API 1916, admin 239,
  web 900, BDD 205 scenarios / 1122 steps, both builds and `git diff --check`
  passed. No deployment or measured 90% saving.
- See [verification and resume steps](bedrock-verification-2026-09-09.md).

## 2026-09-09 — customer-context work packet

- Reused current customer intake and pricing selections in a server-assembled
  private work packet, available without AI credentials. Added reusable summary
  and merge values, missing-item follow-up and lender-instruction drafts.
- Kept declarations, AI proposals and notary decisions distinct. Added possible
  discrepancy comparisons and strict ISO expiry-date attention flags. No draft
  is sent, no borrower role is inferred from signing-party text, and no legal
  check becomes complete from an uploaded filename or checked intake field.
- Kept measured reduction unknown; the 90% objective is not a measured result.
  AWS still reports an invalid security token, so no new live model result.
- Final focused packet/API/UI/translation checks: 77 passed. Domain 392 and
  full web 875 passed; BDD 205 scenarios / 1122 steps passed. Both builds and
  `git diff --check` passed.
- The shared workspace is not fully green: API 1783/1785 passed, with unrelated
  support permission-scan and missing admin-route documentation failures;
  admin 220/224 passed, with sidebar and support-audit-label failures. These
  concurrent changes were left intact. No merge or deployment occurred.

## 2026-09-09 — delegated extraction/review implementation

- Four subagents completed workflow/integration research, provider extraction,
  exact-field evaluation and the bilingual notary UI. The research document
  records primary sources, verified vendor capabilities and unknown access.
- Added a provider-capable text extraction engine, domain evidence/role/field
  rules, protected preparation/read/review endpoints, and both repository
  adapters. Proposed fields require literal page support; notary decisions are
  explicit and cannot authorize signing or training.
- Analysis/review writes guard current owner, retained status, analysis version
  and concurrent review. Private results follow bid retention and are removed
  by the existing erasure operation. The latest analysis replaces the previous
  one; this is not a historical training corpus.
- Added eight wholly synthetic development cases with exact field, evidence,
  missing/conflict, refusal and provenance checks. Updated the existing daily
  10:00 automation to use the new benchmark and researched integration order.
- The owner will restore AWS access. Multiple read-only configuration checks
  still returned `UnrecognizedClientException`; no local provider key was
  available. The live evaluator failed as expected without credentials. No live
  model result, customer-document processing, training, integration activation,
  deployment or measured 90% saving occurred.
- Final focused AI checks: 115 passed. Domain 382 and API 1762 passed; admin
  224 and BDD 201 scenarios / 1110 steps passed. Both builds and the clean full
  web run passed after the final UI changes. The earlier web run overlapped
  those changes and is not used as a passing result.

Next: restore provider access and run the live synthetic benchmark; investigate
errors before enabling the feature. Then obtain professional-reviewed qualification
data and approved lender/template/channel access. See `financing-ai-implementation.md`.

## 2026-09-09 — preparation brief follow-up

- Rechecked the RBC Quebec residential forms and FCAC discharge guidance.
  Confirmed that lender instructions, payout/discharge and reporting remain
  separate dependencies; no universal ten-day turnaround was established.
- Added `financingPreparation` in the domain and a bilingual, expandable brief
  on the retained-file card. It lists missing applicable items and source-backed
  professional checks. Filenames and external delivery declarations never mark
  a professional check complete. No private values go to an AI provider.
- Confirmed the existing daily 10:00 America/Toronto heartbeat is active; did
  not create a duplicate. Daily review remains research/evaluation, not training.
- Live evaluation attempted: neither provider key is available in this shell;
  exited 1. No live evaluation score, weight training, deployment or measured
  time saving is claimed.
- Validation: domain 377/377, API 1584/1584, admin 224/224; BDD 199 scenarios
  and 1106 steps passed. Both builds and the focused brief/i18n checks passed.
  The full web suite also passed; the added translation check passed separately.
- Remaining implementation work: authorized document extraction with page-level
  evidence, a notary correction workflow and measured operational milestones.
  The preparation brief is a deterministic inventory, not document analysis.

## 2026-09-09 — initial implementation

- Reviewed RBC Quebec forms, FCAC discharge, AMF title insurance and CNQ digital practice.
- Added private bilingual intake and versioned support knowledge (2026-09-09.1).
- Created seven synthetic support evaluation cases and a provider-backed runner.
- No live provider credentials in this shell: inventory only, no live model score,
  training job, document processing, deployment or measured time savings.
- Initial focused checks: 20 passed (domain preparation, web translations, evaluation harness).
- Final core validation: domain 375/375 and API 1582/1582 passed.
- Admin 224/224 passed; BDD 197 scenarios / 1098 steps passed; both builds passed.
- Focused preparation/catalogue/i18n/evaluation checks: 40/40 passed.
- Full web run: 800/801 passed. The remaining support-chat assertion expects
  18 starter buttons but the concurrently edited support UI renders 4; this
  change does not modify starter selection. No clean full-web claim.
- The live evaluation command was attempted and exited 1 without credentials;
  no provider request or successful model evaluation occurred.
- Daily Codex heartbeat created: `improve-nota-refinancing-preparation`, 10:00
  America/Toronto, with meaningful-change notifications only.
- Next priority: notary review of the work map, then an authorized document
  extraction/review workflow with evidence references and correction capture.
  Real-file processing and weight training remain unimplemented.
