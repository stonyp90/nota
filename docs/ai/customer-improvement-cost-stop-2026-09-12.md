# Customer-improvement execution cost controls

Reviewed: 2026-09-12. Implementation branch:
`codex/ai-worker-cost-stop-2026-09-12`.

Production pause applied on 2026-09-12 using targeted control-plane updates:
`nota-daily-customer-improvement` is `DISABLED`, worker reserved concurrency is
`0`, and `NOTA_AUTONOMOUS_IMPROVEMENT_ENABLED` is `false`. All three values were
read back; Lambda reported `LastUpdateStatus=Successful`. The account and
schedule target were checked before changes. No model or worker invocation was
performed. The handler/CLI patch is released separately through CI. Additional
Terraform asynchronous retry/failure-destination settings below remain declared
changes until explicitly applied; no full Terraform apply was performed.

## What changed

The Lambda entry point previously treated
`NOTA_AUTONOMOUS_IMPROVEMENT_ENABLED=false` as an engine dry run: it still
queried DynamoDB. It also enabled execution when the variable was absent or
misspelled. The entry point now requires `true`, `1` or `on` (case-insensitive,
with surrounding whitespace removed). All other values return a skipped result
before importing dependencies, creating an AWS client, reading a table or
writing application logs. An invocation event cannot override this switch.

The Terraform variable `enable_customer_improvement` defaults to `false` and
controls all three execution gates together:

- Scheduler state: disabled when false.
- Lambda reserved concurrency: zero when false, one when true.
- Lambda environment opt-in: the same variable's explicit boolean string.

Applying the default pauses existing daily processing. Re-enabling it is an
explicit operating-cost decision. This does not change the domain's guidance
policy, its stored mode, customer intake, or notary review requirements.

Scheduler invokes Lambda asynchronously. Its delivery retries do not control
Lambda's processing retries. A separate Lambda asynchronous configuration now
sets zero function-error retries and a one-hour maximum event age. Scheduler
delivery remains limited to two retries with one-hour event age. Processing
failures use the existing queue with a queue-specific `sqs:SendMessage` grant
to the worker role; Scheduler's existing failure queue handles delivery failures.
This gives bounded retry settings, not exactly-once processing or a dollar cap.

The operator command now exits without AWS access unless the operator passes
`--read-aws` (read-only evaluation) or `--apply` (read and write). Both modes can
incur AWS charges. `TABLE_NAME` alone, or an ambiguous `--dry-run`, is insufficient
to trigger a read. Use `npm run test:customer-improvement` for local synthetic
evaluation. The engine's in-memory `enabled:false` tests remain valid dry runs.

## Limits and correction to earlier cost statements

Neither zero observed invocations nor a zero Lambda billing line proves zero
account cost. Billing can lag, metrics can be missing and costs can sit in other
services. Reserved concurrency limits simultaneous executions; it does not
provide an overall spend limit or eliminate sequential duplicate delivery.

Pausing scheduled computation does not remove existing CloudWatch alarm charges,
retained logs, DynamoDB storage, queues or shared infrastructure. An already
accepted asynchronous event may reach a failure destination after pausing, and
a manually invoked disabled handler can still incur Lambda platform costs.
These controls therefore stop planned work; they are not a zero-dollar promise.
No existing data or alarms are deleted by this patch.

Cost Explorer's API itself is charged per request (the public primary billing
view price reviewed today is USD 0.01/request). Earlier Cost Explorer reads may
therefore have added charges. Development validation made no AWS API requests;
the subsequent production pause used control-plane requests only. There were no
model calls, live evaluations, Cost Explorer requests or training jobs. No new
invoice measurement is asserted here.

Before release, review the Terraform plan against the production backend and
actual variables; do not reuse the earlier mismatched plan or treat a code-only
deployment as an infrastructure pause. Keep the default false until daily
processing is explicitly desired. Reconcile actual residual infrastructure
charges separately; no new invoice measurement is asserted here.

## Primary references

- [AWS Scheduler invokes Lambda asynchronously](https://docs.aws.amazon.com/lambda/latest/dg/with-eventbridge-scheduler.html)
- [Lambda asynchronous errors, retries and duplicate delivery](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)
- [AWS Cost Explorer API pricing](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/)
- [CloudWatch pricing, including alarms and retained logs](https://aws.amazon.com/cloudwatch/pricing/)

## Validation

Entry-point regressions exercise the actual handler and CLI source using isolated
dependency boundaries. They reject imports when disabled, absent, malformed or
invoked without operator intent; they verify explicit opt-in still calls the
engine correctly. Infrastructure checks cover all three linked switches, both
retry layers and the existing failure queue. Tests use synthetic data and no
provider; they do not constitute a model-quality or workflow-effort measurement.
Final suite results are recorded in `refinancing-review-log.md`.
