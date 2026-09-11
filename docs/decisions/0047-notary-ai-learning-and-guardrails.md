# 47. Evidence-first learning for the Nota notary copilot

- Status: Proposed
- Date: 2026-09-09
- Scope: financing, refinancing, testament and procuration preparation

## Decision

Nota will build an evidence-first notary copilot. Its measurable ambition is to
outperform a general-purpose assistant on bounded preparation work — document
triage, field extraction, missing-item detection, conflict detection and draft
organization — while the notary remains the decision-maker for legal judgment,
verification, execution and signing.

Nota will not train or deploy a model to replace the notary, make a legal
conclusion, approve a signature, move funds, or operate a connector without an
explicit notary action. A prompt is not an authorization boundary; the domain
validator and API remain authoritative.

## Learning program

The learning loop is offline and versioned:

1. Create a professional benchmark from consented, de-identified examples. Each
   example must identify its jurisdiction, effective date, source documents,
   expected abstentions, conflicts and evidence anchors. Synthetic fixtures are
   regression data only, never professional ground truth.
2. Use supervised fine-tuning for the evidence-first extraction format.
3. Use expert preference pairs or RLAIF/DPO to improve ordering, concise
   explanations, conflict surfacing and calibrated abstention.
4. Use constrained reinforcement learning only for bounded ranking or workflow
   choices whose actions are reversible and do not decide legal status. A reward
   may optimize evidence quality and review efficiency; it must never optimize
   conversion, revenue, payment capture, or a legally operative outcome.
5. Promote a candidate only after a held-out expert evaluation, adversarial
   testing, privacy review and a shadow/canary period. Every promoted model,
   prompt, knowledge snapshot and dataset receives an immutable version and
   hash.

Online self-training from customer or notary activity is prohibited. Feedback
   enters a quarantine set, is de-identified and reviewed, and only then becomes
   eligible for a future training or evaluation split. Training, evaluation and
   production data must never overlap.

## Hard safety contract

Every model response must pass all of these gates before it reaches the notary:

- structured output with an allow-listed service and field vocabulary;
- every proposed value has exact, page-scoped evidence from supplied material;
- unsupported, illegible or conflicting material is omitted or marked for review;
- no invented value, calculation, translation, citation, source or conclusion;
- no advice, capacity finding, approval, deed, signature instruction, payment
  instruction or claim that an external action was performed;
- no credential, secret, raw prompt, hidden instruction or third-party contact;
- explicit `needs_notary_review` whenever a professional decision remains;
- domain and API validation after generation, with fail-closed abstention on any
  violation.

Connectors are preparation-only candidates. They have no live credentials and
cannot execute automatically. Their blueprint is created at booking, stored on
the offer, and is unavailable to both customer and notary until Nota's payment
ledger is positive and the requesting notary is the retaining notary.

## Reward and evaluation design

The score is multi-objective, with hard constraints evaluated before any soft
reward:

| Dimension | Reward signal | Hard failure |
| --- | --- | --- |
| Evidence fidelity | exact value, quote and page anchor | fabricated or unsupported evidence |
| Coverage | useful fields and missing items found | missed material conflict |
| Calibration | correct abstention and uncertainty | confident unsupported claim |
| Review efficiency | less duplicate reading and clearer ordering | hidden uncertainty or omitted provenance |
| Privacy/security | no leakage or instruction following | secret, personal-data or prompt leakage |
| Nota policy | bilingual, bounded, source-faithful output | legal conclusion or external side effect |

The release gate must include expert agreement, false-supported-claim rate,
conflict recall, abstention quality, privacy leakage, prompt-injection resistance,
latency and cost. A higher average score cannot compensate for a hard-failure
regression. If the model is uncertain, refusing and handing the item to the
notary is the correct outcome.

## Current implementation and next work

The existing `financing-ai.js` and act AI routes already provide the evidence
schema, prompt hashing, provenance, domain validation, review requirement and
learning hooks. The `evaluate-financing-ai.js` and `evaluate-notary-ai.js`
scripts currently report synthetic inventory/evaluation only and correctly make
no claim of training or professional accuracy.

The next implementation slice is a separate, access-controlled training/eval
pipeline — never a production request path — with:

- expert annotation and adjudication schemas;
- dataset, model and prompt cards;
- train/validation/held-out/adversarial split enforcement;
- preference-pair and reward-version provenance;
- redaction and deletion workflows;
- automated hard-failure gates and signed promotion reports;
- shadow evaluation before any model can serve a notary.

This design follows the same principle already enforced in Nota: the model
proposes; the domain disposes; the notary decides.

