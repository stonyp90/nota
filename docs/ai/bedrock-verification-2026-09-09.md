# Bedrock financing verification — 2026-09-09

## Result

AWS authentication was restored and the financing assistant now has an explicit
Bedrock IAM transport. The live extraction benchmark is **not passing**. The final
provider diagnostic is `AccessDeniedException` with `INVALID_PAYMENT_INSTRUMENT`:
AWS Marketplace cannot complete this model's subscription without a valid payment
method. Updating AWS billing is the remaining account prerequisite found in this run.

No credentials were written to repository files, reports or the AWS shared
credentials file. Temporary credentials were supplied through a terminal with echo
disabled and held in a process environment. Reports contain fictional evaluation
data and sanitized diagnostics only. No real customer documents were submitted.

## Access checks and account change

- STS authentication succeeded. The deployed API's configured runtime secret
  had no Anthropic provider key. The documented SSM parameter was not present.
- `us.anthropic.claude-opus-5` was rejected as unavailable for this account.
  A short Sonnet 4.6 Converse connectivity call succeeded, but the subsequent
  structured extraction requests failed. That transient response is not proof
  of usable extraction access or model quality.
- AWS initially required the Anthropic first-use form. Submitted the
  [use-case registration](bedrock-use-case-2026-09-09.json), using the operator
  name recorded in `docs/qa/2026-09-08-nota-tax-registration.json` and the deployed
  API's `NOTA_BASE_URL`. The form describes synthetic evaluation followed by
  qualified preparation for notary review. The saved fields were read back and
  compared with the submission; see the
  [verification receipt](evaluations/2026-09-09-bedrock-use-case-receipt.json).
- After registration, a diagnostic request reached the 20-second deadline.
  A separate synthetic schema warm-up probe allowed up to 180 seconds to
  distinguish initial schema compilation from an account error; it failed
  immediately with `INVALID_PAYMENT_INSTRUMENT`. The application and benchmark
  keep their 20-second deadline. The warm-up is not a passing benchmark or a
  production-deadline test.

AWS documents both the first-use form and a valid Marketplace payment method as
access prerequisites. It also explains why early invocations can temporarily
succeed before subscription setup finishes.
[AWS model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html).
New structured-output schemas can require compilation time.
[AWS structured outputs](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html).

## Preserved live evidence

| Artifact | Result |
| --- | --- |
| [Run 1](evaluations/2026-09-09-bedrock-sonnet-4-6-run1.json) | 0/8 passed; all requests unavailable before use-case registration. |
| [Run 2](evaluations/2026-09-09-bedrock-sonnet-4-6-run2.json) | 0/8 passed; all requests unavailable after registration. |
| [Warm-up diagnostic](evaluations/2026-09-09-bedrock-schema-warmup.json) | Failed; Marketplace payment method rejected. |

Both benchmark runs used `us.anthropic.claude-sonnet-4-6` through `ca-central-1`,
the unchanged eight-case development dataset and the normal provider adapter.
No extraction output was accepted. Zero returned unsupported fields on an
all-unavailable run is not an accuracy result. The model/profile and endpoint
region are explicit: the `us.` profile can process data in US regions. Its use
here does not authorize real customer data processing in those regions.

## Implementation and local verification

- Added a lazy AWS SDK Bedrock transport with IAM credential resolution,
  one attempt, a fresh 20-second abort deadline, disabled SDK logging, the
  same prompt/schema and the same domain evidence checks as direct Anthropic.
- The runtime and live evaluator require explicit financing provider, region
  and model settings for Bedrock. Unknown providers or missing settings fail
  closed. There is no automatic provider, model or region fallback. The direct
  Anthropic evaluator now honors the financing-specific model override first.
- 186 focused financing tests passed. Full domain 392, API 1,916, admin 239 and
  web 900 tests passed; BDD 205 scenarios / 1,122 steps, both builds and
  `git diff --check` passed.

No deployment, Lambda configuration change, IAM policy change, real-file review,
training job, model promotion, contract execution or measured time reduction
occurred. Use-case registration was the account configuration changed;
inference calls also triggered AWS's subscription setup.

## Resume after billing is fixed

Keep payment details and replacement credentials outside chat and source control.
With authorized credentials available locally, use:

```sh
NOTA_FINANCING_AI_PROVIDER=bedrock \
NOTA_FINANCING_AI_REGION=ca-central-1 \
NOTA_FINANCING_AI_MODEL=us.anthropic.claude-sonnet-4-6 \
node apps/api/scripts/evaluate-financing-ai.js --live > /tmp/nota-financing-ai-live.json
```

Allow AWS's stated propagation interval after fixing billing. Preserve the new
report even if it fails. Diagnose failures without weakening the deadline,
source-evidence checks or frozen development expectations to obtain a pass.
After a passing run, verify the authenticated preparation, save and review flow
against a synthetic in-memory file with the actual provider. A production rollout
still needs the deployment role's scoped invocation permissions and the approved
data-handling arrangement. Passing eight synthetic cases cannot establish the
owner's 90% whole-file effort-reduction target.
