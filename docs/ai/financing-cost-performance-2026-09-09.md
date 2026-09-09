# Financing AI: cost and performance plan

Research date: **2026-09-09**. Provider facts below come only from Anthropic and
AWS primary documentation. Prices are **dated public list prices in USD, not
measured invoice costs**. Recommendations and worked examples are Nota planning
assumptions, not measured accuracy, latency or savings.

Prioritize deterministic context and exact result reuse. Benchmark cheaper
models against notary-reviewed, held-out cases before changing the model. Keep
extraction evidence complete; add public-prefix caching only when measured
eligibility and reuse justify its write premium. No automatic model downgrade.

## Starting point and ownership

The inspected [transport](/Users/tony/Github/nota/apps/api/src/financing-ai.js)
defaults to direct Anthropic through shared `DEFAULT_MODEL = claude-opus-5`.
Bedrock requires an explicit model/profile and region; the recorded development
configuration is `us.anthropic.claude-sonnet-4-6` through `ca-central-1`. Both
transports have a 20-second deadline, zero automatic retries and an 8,192-token
output cap. They request adaptive thinking at low effort and structured JSON.
These are settings, not achieved response times or typical token counts.

There are eight wholly synthetic development cases, without notary-reviewed
labels or a held-out split. Recorded live extraction runs have no passes because
of AWS Marketplace billing/access failure; a connectivity response is not an
extraction benchmark. See the [evaluation note](/Users/tony/Github/nota/docs/ai/financing-ai-evaluation.md)
and [verification record](/Users/tony/Github/nota/docs/ai/bedrock-verification-2026-09-09.md).
This research used public documentation and offline source inspection only; no
credentials, account operations or live model calls.

The corresponding controls are implemented in
[`financing-ai-routes.js`](/Users/tony/Github/nota/apps/api/src/financing-ai-routes.js)
and [`financing-ai.js`](/Users/tony/Github/nota/apps/api/src/financing-ai.js): exact
per-file/owner source-and-configuration result reuse, concurrent duplicate
coalescing within one worker, provider client reuse, and a configurable global
daily provider-call cap defaulting to 100, alongside the existing six
attempts/hour/notary. Treat these as controls to verify, not savings demonstrated
here. The route persists bounded latency and usage metadata so later evaluation
can compare provider attempts, cache reads/writes and reused results. This
document records research and does not itself change application code.

## Price comparison

Standard on-demand rates, USD per **million tokens**. AWS values were read from
the live pricing table under Anthropic → Geo and In-region Cross-region
Inference → **Canada (Central)**; the same four rows were visible for US East
(Ohio). These are the geographic-profile rates, including the 10% premium over
global routing. Do not price the existing `us.` profile using global rates.

| Model | Direct input | Direct output | Bedrock US-profile input | Bedrock US-profile output |
| --- | ---: | ---: | ---: | ---: |
| Haiku 4.5 | $1.00 | $5.00 | $1.10 | $5.50 |
| Sonnet 4.6 | $3.00 | $15.00 | $3.30 | $16.50 |
| Sonnet 5 | $2.00 | $10.00 | $2.20 | $11.00 |
| Opus 5 | $5.00 | $25.00 | $5.50 | $27.50 |

Sources: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[AWS Bedrock pricing, Anthropic tables](https://aws.amazon.com/bedrock/pricing/#Anthropic).
Anthropic explicitly cancelled the September 1 Sonnet 5 increase: $2/$10 is now
standard, not an expired introductory rate. Direct prices above assume default
global inference; explicitly selecting US-only inference on supported Claude
4.6+ models adds 10%. Claude Platform on AWS is a separate offering from Bedrock.
[Anthropic pricing and geography](https://platform.claude.com/docs/en/about-claude/pricing).

The endpoint region alone does not establish processing location. AWS lists US
destinations for the Sonnet 4.6 profile invoked from Canada. Retain the current
fictional-data restriction until the real-data arrangement is approved; a lower
global price is not authorization to change routing.
[AWS Sonnet 4.6 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html).

**Worked assumption:** one call with exactly 3,000 uncached input tokens and
1,000 total billable output tokens, including any thinking. Input includes the
prompt, pages and schema overhead. No cache, tools, retry, discount, tax, foreign
exchange, storage, OCR or infrastructure charge is included.
`call USD = (3,000 × input rate + 1,000 × output rate) / 1,000,000`.

| Model | Direct / call | Bedrock US / call | Direct / 100 calls | Bedrock US / 100 calls |
| --- | ---: | ---: | ---: | ---: |
| Haiku 4.5 | $0.0080 | $0.0088 | $0.80 | $0.88 |
| Sonnet 4.6 | $0.0240 | $0.0264 | $2.40 | $2.64 |
| Sonnet 5 | $0.0160 | $0.0176 | $1.60 | $1.76 |
| Opus 5 | $0.0400 | $0.0440 | $4.00 | $4.40 |

These are arithmetic scenarios using the cited rates, not a forecast of Nota's
request sizes. Tokenizers differ across model generations, so compare the same
files using each model's actual usage rather than assuming equal token counts.
[Anthropic tokenizer/pricing note](https://platform.claude.com/docs/en/about-claude/pricing).
At 3,000 input and the full 8,192 output cap, direct Opus instead costs $0.2198
per call, or $21.98 for 100 calls. That is still only a scenario: input varies.
**100 provider calls/day is a call-count guardrail, not a dollar budget.**

## Execution order and qualification

1. **Use deterministic context first.** Keep the domain-built preparation packet,
   customer answers, missing-document rules and drafts available without a model
   call. Preserve the distinction between declarations and documentary evidence.
   Do not send the entire dossier/history to the extractor to recreate facts
   already available deterministically.
2. **Reuse exact results before paid work.** Verify parent changes preserve owner,
   file, exact source, service, prompt/schema/knowledge version and provider/model/
   region configuration boundaries. Recheck ownership and file status; never use
   fuzzy similarity to reuse another file's extraction. Keep existing reviews on
   identical reruns; failed attempts must not become reusable successes. Count
   provider invocations separately from result hits and coalesced waiters.
   Same-worker coalescing cannot guarantee deduplication across Lambda workers.
   Reused clients may avoid setup work; they do not discount inference tokens.
3. **Benchmark model/configuration pairs.** Keep Opus 5 as the direct baseline and
   explicit Sonnet 4.6 as the Bedrock baseline. Evaluate Sonnet 5 and Haiku 4.5 as
   candidates, with the same source files, domain validation and evidence contract.
   Haiku is not a model-ID-only swap: it rejects adaptive thinking and has no
   effort parameter. Qualify its supported request configuration separately.
   [Anthropic migration compatibility](https://platform.claude.com/docs/en/models/sonnet-5/migration-guide).
4. **Compact output without removing evidence.** The current contract already
   asks for fields only. Retain every required `fieldId`, literal value,
   `documentId`, original page and supporting exact quote, including conflicting
   values and multiple borrowers/debts. Prefer short sufficient quotes; let the
   domain derive missing/conflict/status data. Test any lower output cap against
   the largest valid cases and truncation rate before adopting it.
5. **Only then test optional public-prefix caching.** Use the eligibility and
   break-even gates below. Defer batching for interactive preparation.

Use the eight fixtures for smoke checks only. A proposed first comparison is
four configurations × eight cases × two runs = 64 provider calls **per transport**;
this exercises the harness but does not estimate professional performance.
Explicitly account for evaluation calls: a CLI may bypass application quotas.
Then freeze separate notary-labelled qualification files, split by dossier and
document/template family to reduce leakage. Set acceptance thresholds with the
reviewing notary before inspecting held-out outputs. Preserve role decoys,
unsupported/absent values, conflicting evidence, French/English and adversarial
documents. A critical unsupported value or lost conflict blocks promotion.

Compare field precision/recall, evidence/role correctness, abstention, corrections,
rejections, failed/truncated calls and active review time. Report sample size,
paired differences and uncertainty. Promote explicitly only after held-out
quality and total cost per accepted file are acceptable to the notary; lower
list prices alone never trigger fallback or downgrade.

## Public-prefix caching: eligibility before savings

Minimum eligible prefix tokens, excluding uncached client pages:

| Model | Direct minimum | Bedrock minimum | Direct TTL | Bedrock model-card TTL |
| --- | ---: | ---: | --- | --- |
| Haiku 4.5 | 4,096 | 4,096 | 5m / 1h | 5m / 1h |
| Sonnet 4.6 | 1,024 | 1,024 | 5m / 1h | 5m / 1h* |
| Sonnet 5 | 1,024 | 1,024 | 5m / 1h | 5m / 1h |
| Opus 5 | 512 | 512 | 5m / 1h | 5m / 1h |

Sources: [Anthropic cache limits](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
AWS model cards for [Haiku 4.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html),
[Sonnet 4.6](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html),
[Sonnet 5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html)
and [Opus 5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5.html).
*AWS's general cache table still lists only 5m for Sonnet 4.6, whereas its model
card and price table list 1h. Use 5m for planning; validate 1h support on the exact
adapter/profile before relying on it.
[AWS caching guide](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html).

For these models, cache writes cost **1.25× input for 5m** or **2× for 1h**;
hits cost **0.1×**. A write replaces the base charge for those tokens; do not add
both. On Bedrock US Sonnet 4.6 that is $4.125 / $6.60 / $0.33 per million tokens
for 5m write / 1h write / hit. A cold write costs more than ordinary input.
[Anthropic caching pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[AWS price table](https://aws.amazon.com/bedrock/pricing/#Anthropic).

Derived break-even for the same prefix: `write multiplier + 0.1 × hits < 1 + hits`.
One write needs at least **one hit for 5m**, or **two hits for 1h**. Over many
equal-length writes, hits/writes must exceed 0.278 or 1.111 respectively.
Count actual hits: concurrent cold requests may all write; Bedrock cross-region
routing can increase writes. TTL refresh and exact-prefix identity matter.
[Anthropic cache behavior](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[AWS cross-region cache behavior](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html).

Offline inspection captured the current public system prefix at **3,371
characters / 3,380 UTF-8 bytes**, hash
`e71bf72401bd0002c4d7ad62a4a7cfcbe2aba6f6577b516cde12bba36172697a`.
That is not a token count or proof it meets any model's minimum. It contains
instructions, six public field definitions, domain limits and knowledge version.
The financing request currently sets no explicit cache breakpoint.

Before enabling caching, count that exact prefix for each target model and
measure the remaining cross-file traffic after result reuse. Token counting is
an estimate and does not create a cache; returned usage must confirm writes/hits.
[Anthropic token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting).
If eligible, place an explicit boundary after public static instructions/schema
only. **Do not pad the prefix, cache client pages, or use a broad automatic
breakpoint that includes them.** Preserve provider privacy settings when testing
models with implicit caching. Disable the optimization if measured write/read
cost exceeds uncached cost. Output tokens remain payable on every inference.

## Batching and latency constraints

Direct Anthropic batches receive 50% pricing: input/output rates are Haiku
$0.50/$2.50, Sonnet 4.6 $1.50/$7.50, Sonnet 5 $1/$5 and Opus 5 $2.50/$12.50 per
million tokens. Requests are asynchronous, limited to 100,000 requests or 256 MB;
unfinished requests expire at 24 hours. No streaming; cache discounts can stack,
but hits depend on execution timing. This does not fit the interactive deadline.
[Anthropic batches](https://platform.claude.com/docs/en/build-with-claude/batch-processing).

Bedrock US batch input/output list rates are Haiku $0.55/$2.75, Sonnet 4.6
$1.65/$8.25 and Opus 5 $2.75/$13.75; Sonnet 5 is **N/A**.
[AWS pricing](https://aws.amazon.com/bedrock/pricing/#Anthropic).
The support matrix includes Haiku 4.5 and Sonnet 4.6 through `ca-central-1` but
does not list Opus 5; its price and quota entries are not sufficient evidence of
usable batch support on that profile. Confirm before scheduling.
[AWS batch support matrix](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference-supported.html).
AWS lists a 100-record minimum for Haiku 4.5, Sonnet 4.6 and Opus 5: the eight
development cases do not meet it; do not duplicate them to manufacture volume.
[AWS quotas](https://docs.aws.amazon.com/general/latest/gr/bedrock.html).
Bedrock batch data uses S3 JSONL and separate job handling; its batch API does not
support prompt caching. Consider it later for authorized offline evaluation with
sufficient real volume and acceptable queue lag.
[AWS batch data](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference-data.html),
[AWS caching restrictions](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html).

Record cold worker/client, cold schema and warm-request latency separately.
AWS warns new structured-output grammar compilation can take minutes and caches
compiled grammars for 24 hours; this is separate from prompt caching and can
conflict with Nota's 20-second deadline. Report such failures instead of hiding
them in warm-only results. Any future synthetic schema warm-up belongs outside
the interactive request and must be reported separately.
[AWS structured outputs](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html).

## Decision metric: cost per accepted file and lag

Define an accepted file here as an extraction packet explicitly accepted after
notary review, not financing approval or a completed act. For one evaluation
cohort, calculate:

`USD / accepted file = (all provider attempts + infrastructure/OCR + human review
and correction + rework + explicitly valued delay) / accepted files`.

Use a common currency for human and provider costs. Include failed attempts and
rejected files in the numerator; count each accepted dossier once. When delay
cannot be valued defensibly, report it alongside cost rather than assigning an
invented dollar amount. Distinguish first-pass acceptance from acceptance after
correction and track manual fallback effort.

Illustration only: at $60 USD/hour, two minutes of review plus direct Opus's
$0.040 call costs $2.040. Haiku with 2.1 minutes of review costs $2.108 despite
its $0.008 call. With equal acceptance, just 1.92 extra review seconds consumes
the $0.032 token saving. No review-time difference has been measured at Nota.

Use the evaluator agent's latency/usage coverage as inputs, including all
attempts, usage-known versus usage-missing counts, input/output and cache
write/read categories. Missing usage is unknown cost, not zero; timed-out or
rejected outputs may still incur charges. Keep token-based list-price estimates
distinct from later invoice reconciliation. Track p50/p95 provider and end-to-end
review-ready latency, timeout rate, queue lag, active review time, acceptance and
manual fallback. Declare a winner only when reviewed quality, total cost and
the notary's turnaround requirement all support it.
