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
