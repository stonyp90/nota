import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const WORKER = read('../../../infra/customer-improvement.tf');
const API_IAM = read('../../../infra/lambda.tf');
const LOGS = read('../../../infra/logs.tf');
const OBSERVABILITY = read('../../../infra/observability.tf');

test('the autonomous worker is scheduled, small and has no model credential', () => {
  assert.match(WORKER, /handler\s*=\s*"customer-improvement\.handler"/);
  assert.match(WORKER, /timeout\s*=\s*60/);
  assert.match(WORKER, /memory_size\s*=\s*256/);
  assert.match(WORKER, /schedule_expression\s*=\s*"cron\(15 13 \* \* \? \*\)"/);
  assert.match(WORKER, /schedule_expression_timezone\s*=\s*"UTC"/);
  assert.doesNotMatch(WORKER, /ANTHROPIC_API_KEY|NOTA_ASSISTANT_KEY_PARAM|NOTA_.*MODEL/);
});

test('the worker reads only aggregate and learning partitions and writes two bounded doors', () => {
  assert.match(WORKER, /values\s*=\s*\["STATS#GLOBAL#\*", "LEARNING#\*"\]/);
  assert.match(WORKER, /values\s*=\s*\["CONFIG#EXPERIENCE"\]/);
  assert.match(WORKER, /values\s*=\s*\["AUDIT#\*"\]/);
  assert.doesNotMatch(WORKER, /dynamodb:(Scan|UpdateItem|DeleteItem|BatchWriteItem)/);
  assert.doesNotMatch(WORKER, /dynamodb:GetItem[\s\S]*dynamodb:Query/);
});

test('the public Lambda keeps the learning stream append-only and observable', () => {
  assert.match(API_IAM, /values\s*=\s*\["AUDIT#\*", "LEARNING#\*"\]/);
  assert.match(LOGS, /aws_cloudwatch_log_group" "customer_improvement/);
  assert.match(OBSERVABILITY, /customer_improvement/);
});

test('daily processing defaults off and its single switch stops delivery and execution', () => {
  assert.match(WORKER, /variable "enable_customer_improvement" \{[^}]*type\s*=\s*bool[^}]*default\s*=\s*false/s);
  assert.match(WORKER, /state\s*=\s*var\.enable_customer_improvement \? "ENABLED" : "DISABLED"/);
  assert.match(WORKER, /reserved_concurrent_executions\s*=\s*var\.enable_customer_improvement \? 1 : 0/);
  assert.match(WORKER, /NOTA_AUTONOMOUS_IMPROVEMENT_ENABLED\s*=\s*tostring\(var\.enable_customer_improvement\)/);
});

test('Lambda processing retries are bounded separately from Scheduler delivery retries', () => {
  const asyncConfig = WORKER.slice(WORKER.indexOf('resource "aws_lambda_function_event_invoke_config" "customer_improvement"'));
  const scheduler = WORKER.slice(WORKER.indexOf('resource "aws_scheduler_schedule" "customer_improvement"'));
  assert.match(asyncConfig, /maximum_event_age_in_seconds\s*=\s*3600/);
  assert.match(asyncConfig, /maximum_retry_attempts\s*=\s*0/);
  assert.match(asyncConfig, /on_failure \{ destination = aws_sqs_queue\.customer_improvement_dlq\.arn \}/);
  assert.match(WORKER, /resource "aws_iam_role_policy" "customer_improvement_failure_destination"[\s\S]*?Action\s*=\s*"sqs:SendMessage"[\s\S]*?Resource\s*=\s*aws_sqs_queue\.customer_improvement_dlq\.arn/);
  assert.match(scheduler, /maximum_event_age_in_seconds\s*=\s*3600/);
  assert.match(scheduler, /maximum_retry_attempts\s*=\s*2/);
});
