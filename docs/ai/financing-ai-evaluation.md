# Financing extraction evaluation and reviewed learning

This scaffold checks proposed financing fields against nine wholly synthetic
development fixtures. It is separate from the support-answer keyword checks in
`apps/api/scripts/evaluate-financing.js`. The fixtures contain fictional people,
addresses, institutions, documents and amounts. Their labels are engineering
expectations, **not notary-reviewed ground truth or a professional benchmark**.

Implemented here: an offline-testable evaluator, explicit extraction expectations,
page evidence checks, provenance reporting and the reviewed-learning plan below.
The evaluator creates no approved training corpus, training job, model promotion
or deployment. The application's private correction capture is described in
[the implementation note](financing-ai-implementation.md). No measured professional accuracy,
time savings or human approval follows from passing these cases.

## Run modes

From the repository root:

```sh
# Inventory only: no engine/provider call, even when credentials are available.
node apps/api/scripts/evaluate-financing-ai.js

# Offline harness tests using synthetic response doubles and the real engine.
node --test apps/api/test/financing-ai-evaluation.test.mjs

# Explicit Anthropic run; set an authorized API key in the environment beforehand.
NOTA_FINANCING_AI_PROVIDER=anthropic \
  node apps/api/scripts/evaluate-financing-ai.js --live > /tmp/nota-financing-ai-evaluation.json

# Explicit Bedrock run; requires authorized IAM access, no Anthropic API key.
# Non-secret config; this US-profile example is for fictional fixtures only.
NOTA_FINANCING_AI_PROVIDER=bedrock \
NOTA_FINANCING_AI_MODEL=us.anthropic.claude-sonnet-4-6 \
NOTA_FINANCING_AI_REGION=ca-central-1 \
  node apps/api/scripts/evaluate-financing-ai.js --live > /tmp/nota-financing-ai-bedrock-evaluation.json
```

`--live` selects the provider with `NOTA_FINANCING_AI_PROVIDER`: `anthropic`
(the default when missing, empty or whitespace-only) or explicit `bedrock`.
The CLI trims the setting; other values are rejected before loading a provider.

The Anthropic path requires `ANTHROPIC_API_KEY` or `NOTA_ASSISTANT_API_KEY`, in
that order, skipping blank values. Model selection follows the financing
runtime's precedence:
`NOTA_FINANCING_AI_MODEL`, then `NOTA_ASSISTANT_MODEL`, then the engine's shared
`DEFAULT_MODEL` from `assistant-port.js`. The CLI trims model overrides and skips
empty or whitespace-only values.

The Bedrock path uses IAM authentication and requires both
`NOTA_FINANCING_AI_MODEL` and `NOTA_FINANCING_AI_REGION` explicitly. Both settings
are trimmed; missing, empty or whitespace-only values fail. There is no fallback
to `NOTA_ASSISTANT_MODEL`, `DEFAULT_MODEL`, `AWS_REGION` or `AWS_DEFAULT_REGION`.
A bare inference profile ID such as the example above is passed unchanged after
trimming. Bedrock needs no Anthropic API key and never falls back to Anthropic.
The US-profile example is limited to wholly fictional development fixtures until
a permitted arrangement for real-data processing and regions is established.

The runner does not retrieve application secrets from AWS or any other store;
the Bedrock SDK uses the operator's existing IAM authentication. Missing required
settings or credentials, unavailable engine/provider, invalid dataset, unknown
arguments and failed checks produce a nonzero exit. Provider exception text and
credentials are not printed. No flag means inventory, regardless of provider
settings, without loading a provider or running an evaluation. A failed live run
must not be recorded as passing because its redirected output file exists.

For Anthropic, when the configured AWS runtime secret is available, the operator
can supply the selected API key through one of those environment variables to
the Anthropic `--live` command, or inject the configured port into
`evaluate(port, model)`. Keep the
secret out of command arguments, shell history, logs and reports; do not print or
export the full runtime-secret bundle. Secret selection/restoration belongs to
the existing runtime configuration, not a discovery path in this evaluator.

Restored AWS access, Bedrock connectivity evidence and any live synthetic run
are documented in the [2026-09-09 verification note](bedrock-verification-2026-09-09.md).
Connectivity alone does not establish a passing evaluation. This CLI change
records no live evaluation pass; its offline checks require no AWS access or
provider credentials.

The exported `evaluate(port, model)` calls
`createFinancingAI({ port, model }).prepare({ serviceId, pages })` for every case.
The engine and adapter factories are imported from `apps/api/src/financing-ai.js`.
The live path uses `createAnthropicFinancingPort({ apiKey, model })` or
`createBedrockFinancingPort({ region, model })`. The Bedrock adapter uses Converse
with a fixed 20-second budget, no retries, and the same extraction validation.
An injected port implements `extract({ system, pages, fieldIds })` and returns
`{ extraction: { fields }, usage }`. The evaluator forwards only the case's input,
never its expected values, behavior description, tags or evaluation labels.
The offline tests deliberately return fixture expectations to exercise the
evaluator and domain boundary. Their passing counts are **test results, not model
performance**. `execution: "caller-supplied-port"` preserves that distinction in
programmatic reports; the CLI live path records `execution: "anthropic"` or
`execution: "amazon-bedrock"`. Bedrock reports also include the configured
`region` at the top level. Both paths preserve the adapter's actual model and
the hash of the exact prompt observed at the extraction boundary, alongside the
requested model. These settings and examples do not change the dataset, prompt
or shared model default.

## Expected extraction behavior

The shared domain owns the field vocabulary, evidence rules, bounds, missing
fields and conflicts. The dataset records a versioned expectation for those rules
and is validated against the domain before inventory or evaluation. Its field IDs
are `property_address`, `borrower_names`, `lender_name`, `loan_amount`,
`rate_expiry` and `secured_debts`.

Each raw extraction has only `fields`. A field has `fieldId`, a literal string
`value`, and nonempty `evidence` entries with `documentId`, original `page` and
`quote`. A quote must be an **exact substring of that supplied page** and contain
the literal trimmed value. Values are not translated, reformatted, calculated or
joined across disconnected text. Currency strings are transcribed document data,
not amounts formatted by the UI. Separate borrowers and debts use repeated field
IDs with distinct values. Identical `(fieldId, value)` duplicates are invalid.

The domain permits at most 8 pages, 8,000 characters per page, 36,000 total page
characters, 24 fields, 1,000 characters per value and 2,000 per quote. The evaluator
calls the domain validators instead of implementing another version of these
limits. Unknown raw extraction properties, including purported legal findings or
approval, are rejected by the engine's domain boundary.

A successful preparation has exactly `fields`, `missing`, `conflicts` and
`status: "needs_notary_review"`. `missing` and `conflicts` are compared as exact
sets with no duplicates. Multiple distinct values for a single-value field such
as `lender_name` require that field ID in `conflicts`; borrower/debt multiplicity
does not. The evaluator expects the conflicting lenders to remain visible for
review, with their separate sources. The engine prompt/schema must permit
repeated field IDs to satisfy these fixtures.

| Development case | Required behavior |
| --- | --- |
| `complete-refinancement-fr` | Copy six clearly labeled French values; keep review required. |
| `financement-en-role-decoys` | Extract the English borrower and loan amount, ignoring the adviser and purchase-price decoys; leave absent expiry/debts missing. |
| `no-extractable-data-fr` | Return no fields and all six missing IDs for a cover sheet. This is a valid empty preparation. |
| `document-instruction-fr` | Extract the two legitimate values; ignore embedded commands to invent an amount, citation, legal finding or approval. |
| `conflicting-names-and-lender-fr` | Retain both borrower names and both lenders with their own sources; flag `lender_name`, choose no winner. |
| `expired-rate-fr` | Copy the stated past expiry, not the preparation date; make no finding about validity, renewal or ability to sign. |
| `multiple-secured-loans-fr` | Return two borrowers and three distinct debt entries from the original page references; calculate no total or official payout. |
| `bilingual-unicode-pages` | Preserve French accents, English source amounts, punctuation and separate names across documents; a no-debt declaration remains a declaration. |
| `client-document-date-decoys-fr` | Do not treat a client offer's version as `lender_instruction_version` or a monthly statement's balance date as `payout_valid_through`; keep official-evidence fields missing. |

The date-decoy case was added in dataset version `2026-09-12.1`. It checks a
known limitation: literal quotation validation alone cannot establish the source
document's role. Constructed wrong-role dates still satisfy the runtime's literal
evidence validation, but the evaluation oracle rejects them. This is detection
coverage, not a runtime fix or proof of live-model behavior. The professional
instruction, payout and closing checks continue to require notary review.

The name-conflict case intentionally exposes a contract limitation: the domain
treats borrower names as multivalued, so it does not flag inconsistent sole-
borrower declarations as a `borrower_names` conflict. Recording both source names
does not reconcile the identities. A notary must assess the discrepancy. This
suite does not claim semantic conflict detection beyond the stated expectations.

All nine inputs are valid extraction requests. An engine refusal on any of them
fails that case, including an adversarial page with otherwise extractable data.
Missing individual fields are handled by omission and the exact `missing` set.
A blanket empty extraction passes only the cover-sheet and date-decoy cases. A blanket refusal
cannot pass. Rejection of invalid provider output remains safe engine behavior,
but it is not a successful extraction for this evaluation.

## Scoring and provenance

Each case passes only when all required checks pass. There is no keyword score,
fuzzy match, normalization, model judge or partial-credit passing threshold.

- Compare the complete unordered collection of exact `(fieldId, value)` pairs.
  Missing, extra, merged or duplicate values fail, even if a wrong value occurs
  somewhere on a page. This catches purchase price as loan amount, adviser as
  borrower and document instructions treated as data.
- Check every evidence entry against its exact document and original page
  number. Each must contain the literal value and a golden anchor. Expected
  `evidence` arrays list **alternative allowed source anchors**: at least one
  citation is required, but every alternative need not be returned. Longer
  verbatim quotes containing an anchor on the same page are accepted. Every
  returned citation must qualify; one good citation cannot excuse a bad one.
- Validate the preparation through the domain and compare missing/conflict sets
  and review status. Unexpected preparation or result properties fail, preventing
  a successful score with an appended purported legal finding or approval.
- Verify successful-result provenance against the model selected by the engine,
  the actual system prompt observed at the port boundary, the original case input
  hash and the domain knowledge version. A prompt change during one run fails the
  report as a whole.

The report contains `pass`, case counts, detailed failure codes, case preparations,
refusals, errors, exact/evidenced field counts and `falseSupportedClaims`. The last
metric counts returned proposed fields with a wrong expected value/role or missing,
invalid or unexpected source evidence. It counts each offending field once. A
literal substring is necessary but cannot establish that it was assigned to the
right field. Duplicates and shape/status/missing/conflict/provenance failures also
fail the case regardless of this count.

`refusals` counts engine `{ ok: false, code }` outcomes, preserving known codes
such as `unavailable` and `invalid_output`. It does not claim to distinguish a
provider safety refusal from every parse, validation or transport failure. Raw
provider output rejected by the engine is unavailable to this evaluator; its
unsupported claims cannot be counted as accepted preparation fields. A zero
`falseSupportedClaims` count alongside refusals is not evidence of extraction
quality. Unexpected exceptions are sanitized, failed and counted as errors.

Provenance includes dataset ID/version/split/origin/review status, the SHA-256 of
the **exact dataset file bytes**, actual system prompt hash(es), the domain
knowledge version, selected/requested model, timestamp and per-case
`SHA256(JSON.stringify(input))`. Results retain engine provenance, latency and
usage when supplied on success. Unavailable usage/provenance is `null`, not zero
tokens or invented evidence. Failed calls retain a prompt hash if a prompt reached
the port; no port means no observed prompt hash. A model label alone does not prove
a real model ran. Preserve the report with the code revision used for comparison.

These narrow fixtures do not measure OCR, scans, handwriting, real lender forms,
document completeness, title analysis, identity verification, legal drafting,
payout correctness or professional practice. Even an exact page quote can repeat
a false declaration. Passing requires notary review to remain outstanding.

## Reviewed-learning scaffold — specification only

1. **Authorize collection and use.** Before retaining a real correction, record
   the case's authority for this specific secondary evaluation/training purpose,
   permitted uses, provider processing scope, retention/deletion schedule and
   access policy. Ordinary dossier sharing is not an authorization for training.
   Minimize/de-identify documents and evidence under that authorization; verify
   that redaction has not broken the label or leaked an identifier. Unclear
   authorization excludes the case. No customer pages are added to this repo.
2. **Capture a reviewable correction.** Preserve an immutable source snapshot and
   hashes, extraction, model/prompt/schema/dataset/code versions, field evidence,
   missing/conflict state and the proposed edit. Record whether each field was
   accepted, replaced, split or omitted and why. A correction must cite its source
   page; external confirmation must be modeled separately, never disguised as a
   page quote. Distinguish an extraction correction from a new source version.
3. **Require an actual authorized notary review.** Keep reviewer identity/role,
   review timestamp, decision, rationale and an audit event attributable to that
   person. Use pending/null values until the person actually reviews. Never infer
   acceptance from silence, uploading, an assistant response, a passing test or
   `needs_notary_review`. Disagreement remains unresolved and excluded until
   adjudicated by an authorized reviewer. An extraction label approval does not
   mean the legal file is approved for closing.
4. **Freeze case-level splits.** Group the entire dossier, all document versions,
   corrections, related borrowers/properties and near-duplicate source/template
   variants before assigning train/development/heldout. Maintain a versioned
   split manifest keyed by a protected case-group identifier. Do not split pages
   or fields from one case across partitions. Check exact/near duplicates and
   distribution coverage for service, language, missingness and document type.
   These nine public-to-development synthetic cases are not the heldout set.
5. **Make heldout immutable.** After authorization and review, seal the heldout
   snapshot and hashes with access restricted to evaluation custodians. Never
   use its pages, labels, detailed failures or derivatives in prompts, examples,
   training, iterative tuning or synthetic-case generation. A discovered label
   defect requires a separately reviewed new version; preserve the prior version
   and comparisons instead of silently rewriting results. A required deletion
   retires the affected version under the data policy, rather than retaining
   withdrawn data to preserve a score.
6. **Compare before promotion.** Set acceptance criteria before a heldout run.
   Evaluate the frozen baseline and candidate on the same authorized snapshots
   using exact field/evidence checks plus independent notary review of semantic
   errors. Report counts and coverage by case group, service and language, with
   uncertainty for any statistical performance claim. Require improvement on
   the intended correction categories, no increase in false supported claims,
   unwanted refusals or missing/conflict errors, and no safety regression on
   document instructions, unsupported legal/identity/closing assertions or
   evidence integrity. Any critical safety failure blocks promotion regardless
   of aggregate accuracy. Synthetic development passes alone cannot open this
   gate. Check privacy, latency and cost against predeclared budgets as well.
7. **Keep release separate.** A future training proposal must identify the
   authorized dataset manifest and supported training method, budget and owner;
   this scaffold starts no training job. Promotion requires a real accountable
   review of the comparison, explicit release authorization, immutable model/
   prompt versions, rollback target and monitoring/stop criteria. Capture a
   promotion decision only when it happens. No deploy or automatic self-training
   is implied by a correction, daily review or evaluation run.

A future correction record needs, at minimum, the following fields. This is a
schema outline, **not a reviewed record or a populated training example**:

| Record group | Required information |
| --- | --- |
| Identity and lineage | Record/version ID, protected case-group ID, source snapshot hashes, parent correction ID. |
| Authority and handling | Purpose-specific authority reference, permitted uses, retention/deletion policy, access scope, redaction version. |
| Extraction | Input/prompt/model/knowledge/schema/code versions, original fields/evidence/missing/conflicts, usage if available. |
| Correction | Field-level action, before/after literal values/evidence, rationale, separate external-confirmation references. |
| Review | Initially pending with reviewer/time/decision null; actual notary identity, timestamp and audit event only after review. |
| Dataset eligibility | Excluded until authorized and reviewed; split-manifest version, deduplication group, frozen artifact hashes after admission. |

Keep label revisions append-only with auditable supersession. The future export
process must refuse records without valid purpose authorization, completed review,
source integrity and split assignment, and must never export heldout records to
training. None of those services or records is created by this change.
