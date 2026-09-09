# Evidence-grounded financing assistant

Implementation date: 2026-09-09. This is a first extraction/review workflow, not
an autonomous notary or a validated 90% automation result.

## What the application now does

### Reuse the customer's context before model processing

`financingWorkPacket` now assembles the current private customer answers and
pricing selections into a preparation packet. The authenticated preparation GET
returns it even when the AI feature is disabled, without a provider request.
It contains a factual summary, proposed merge values with explicit sources,
document declarations, the unanswered applicable questions, a client follow-up
draft and a lender-instruction request draft. Neither draft is sent automatically.
The notary can copy the packet or either draft after reviewing it.

Already supplied items are excluded from the client draft. Conditional documents
follow the domain catalogue. Customer statements, AI proposals, accepted values
and corrections stay distinct. Signing-party free text is not automatically
treated as verified borrower names. Money declared in intake uses `money()` and
`moneyEn()`; documentary quotations remain literal.

The packet compares customer and document values and flags declared rate-expiry
dates that need attention. Differences are review prompts, not proven errors;
formatting alone can differ. Corrections retain the original value so quotations
are not misrepresented as evidence for a human-entered replacement. Existing
checks for lender instructions, title, payout and closing remain pending until
the appropriate workflow can capture their official evidence.

This removes re-entry and initial draft assembly from the notary's preparation
flow. Its actual time saving has not been measured. The packet exposes the 90%
owner target as a target and leaves `measuredReduction` null. Recorded active
review seconds are a separate observation, never a whole-file savings estimate.

### Evidence-linked text extraction and review

The retaining notary can submit document page text for six candidate field types:
property address, borrowers, lender, loan amount, rate expiry and secured debts.
The provider returns proposed values and literal supporting quotations. Domain
validation rejects unknown fields, invented quotations, wrong page references,
unsupported values and model-supplied approval states. Distinct single-valued
facts generate unresolved conflicts. Multiple borrowers and debts stay separate.
Exact evidence is necessary but does not prove the model assigned the right role
or that the original document is authentic or legally sufficient.

The private notary workspace supports explicit acceptance, correction or rejection
of each proposed value. Corrections/rejections require a reason. The server stamps
the authenticated reviewer and time. Review time can be recorded manually;
missing time is unknown, not zero. No aggregate time-saving percentage exists yet.
An accepted extraction remains separate from legal approval or execution.

`POST /notary/financing/preparation`, `GET /notary/financing/preparation` and
`POST /notary/financing/review` require the retaining notary's session. Analysis
and review writes check current ownership, retained status and analysis version.
A review is immutable for that analysis. Regeneration replaces the current
analysis and review; this is not an immutable historical training corpus.
The packet is rebuilt from the current server dossier on reads and successful
generation/review responses; arbitrary browser-supplied dossier overrides are
ignored. No private customer context is automatically added to provider input.
The existing audit records counts and identifiers without copying field values.

The current analysis is stored inside the private bid with its existing retention
and erasure policy. Raw full-page input is not stored by this feature; only the
necessary evidence excerpts and proposals are retained. Original pages must stay
available through the notary's authorized document channel. Page identifiers and
text are supplied by the notary and labelled `notary_supplied_text`; this feature
does not authenticate an uploaded document or automatically retrieve its bytes.

The existing repo has other full-item bid writes. They retain their documented
last-writer-wins limitation; the AI's conditional writes do not fix that broader
repository concurrency issue. Move analyses to versioned records with coordinated
erasure before relying on this feature as a historical professional audit system.

## Enable and verify

The [2026-09-09 verification](bedrock-verification-2026-09-09.md) restored AWS
authentication and registered the use case. Live extraction remains blocked by
AWS Marketplace `INVALID_PAYMENT_INSTRUMENT`; no passing live result is recorded.

The endpoint is disabled unless `NOTA_FINANCING_AI_ENABLED=true`. Provider
selection applies only to financing AI; it does not change the support assistant.
`NOTA_FINANCING_AI_PROVIDER` accepts `anthropic` (the default when unset or blank)
or the explicit opt-in `bedrock`. Surrounding whitespace is trimmed from provider,
model, region, key and key-parameter settings. Unknown provider names fail closed
with HTTP 503 `financing_ai_unavailable`; there is no silent provider fallback.

For Anthropic, configure `ANTHROPIC_API_KEY` or `NOTA_ASSISTANT_API_KEY`, or use
the existing `NOTA_ASSISTANT_KEY_PARAM` resolver/runtime-secret loading in the
deployed API. The first nonblank key in that order is used, including trimming
the resolved secret. `NOTA_FINANCING_AI_MODEL` overrides `NOTA_ASSISTANT_MODEL`
for preparation; blank model settings fall through to the shared default model.
Keep secrets in the local environment or configured secret store, never in source
files or this document. Configuring a key does not establish model availability.

For Bedrock, the runtime configuration is explicitly opt-in:

```sh
export NOTA_FINANCING_AI_ENABLED=true
export NOTA_FINANCING_AI_PROVIDER=bedrock
export NOTA_FINANCING_AI_REGION='<approved-region>'
export NOTA_FINANCING_AI_MODEL='<approved-model-or-inference-profile-id>'
```

Both financing region and model must be explicit and nonblank. Neither
`AWS_REGION` nor `NOTA_ASSISTANT_MODEL` supplies a Bedrock fallback. Missing
configuration returns the same controlled HTTP 503 before constructing a provider.
Bedrock uses IAM authentication, requires no API key, and the financing route
never calls the SSM key resolver or the direct Anthropic provider in this mode,
even when Anthropic keys or a parameter name are configured. Provider failure
also returns a controlled error without switching providers. Both providers use
the same domain input and evidence validation. The injected test port still takes
precedence over runtime provider configuration, behind the existing request gates.

Before real-file use, establish the permitted provider/data handling arrangement
with the responsible notary; the feature flag and per-request authorization are
implementation controls, not a substitute for that arrangement. For Bedrock,
approve the selected model/profile and all regions in which that profile may
process requests before submitting real client documents. Configuring a runtime
region alone does not establish that approval.

Local route tests use synthetic pages, factory stubs and injected provider
responses, with no AWS calls or credentials. This configuration documents runtime
selection only: it does not deploy the feature, edit infrastructure, grant an IAM
role policy or establish that a deployed role can invoke a model/profile. Both
transports have a fixed 20-second deadline within the API's 30-second Lambda
budget, no automatic retries, and no tool access. There are six attempts per
notary per hour, with failure closed if the shared rate counter is unavailable.
Disabled, unauthorized and rate-limited requests never construct a provider or
resolve a financing API key.

Run the synthetic development evaluation after configuring the selected provider.
The CLI uses the same provider selection and explicit Bedrock region/model.
Anthropic CLI runs require a key environment variable; the CLI does not resolve
the SSM parameter.

```sh
node apps/api/scripts/evaluate-financing-ai.js --live > /tmp/nota-financing-ai-live.json
```

Without `--live`, the command reports an inventory and explicitly says no model
was evaluated. A failed live run is not a pass. This development dataset is not
notary-reviewed or held out, and a passing run does not qualify an autonomous
legal workflow. Live synthetic results, including Bedrock results, are recorded
separately by the main implementation task; the offline provider-selection tests
do not constitute a live result. See [evaluation design](financing-ai-evaluation.md).

## Learning and the next increments

The application records authentic notary corrections in the current file, but
`trainingEligible` remains false. No weight training or automatic dataset export
occurs. Daily development may classify authorized feedback, produce synthetic
regressions and improve the prompt or retrieval. Training requires an authorized,
minimized, reviewed dataset, case-level splits, a frozen qualification set and a
supported provider training job. Never use model answers as legal ground truth.

The [researched integration plan](notary-automation-research-2026-09-09.md) prioritizes:

1. OCR/text ingestion from the authorized source pack, with visible page evidence.
2. Versioned lender mandates and official payout/discharge imports.
3. Registry evidence and cross-document obligation checks.
4. Notary-approved document templates and reviewed field mapping.
5. Approved signing handoff, registration receipts and closing reconciliation.

Official-channel access, approved templates and provider contracts remain external
dependencies. No connector, deed drafting, legal execution, signature, registration,
fund transfer or verified end-to-end turnaround reduction is implemented here.

Measure both total human effort and the clerical/preparation subset. The owner's
90% target is not achieved by relabelling fields as tasks or excluding portal work.
Retain professional decision time, review/corrections, client effort and third-party
waiting in the measurement report. The ten-day starting point is still a hypothesis.
