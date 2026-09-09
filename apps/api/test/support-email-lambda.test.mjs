import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { createSupportEmailLambda } = require('../support-email');
const { supportReplyAddress } = require('../src/support-email');
const { createMemoryRepo } = require('../src/repo-memory');

const NOW = Date.parse('2026-09-09T12:00:00Z');
const SECRET = 'synthetic-support-email-secret-with-32-characters';
const ENV = { TABLE_NAME: 'synthetic-table', NOTA_SUPPORT_EMAIL_BUCKET: 'synthetic-receipts', NOTA_SUPPORT_EMAIL_PREFIX: 'support/',
  NOTA_SUPPORT_EMAIL_DOMAIN: 'replies.nota.test', NOTA_OPERATOR_EMAIL: 'operator@nota.test', NOTA_NOTARY_SECRET: SECRET };
const address = () => supportReplyAddress({ threadId: 'same-thread', role: 'operator', sender: ENV.NOTA_OPERATOR_EMAIL, domain: ENV.NOTA_SUPPORT_EMAIL_DOMAIN, secret: SECRET, nowMs: NOW });
const incoming = (overrides = {}) => ({ Records: [{ eventSource: 'aws:ses', ses: {
  mail: { messageId: 'receipt1', source: ENV.NOTA_OPERATOR_EMAIL }, receipt: {
    recipients: [address()], spamVerdict: { status: 'PASS' }, virusVerdict: { status: 'PASS' },
    dmarcVerdict: { status: 'PASS' }, dkimVerdict: { status: 'PASS' }, spfVerdict: { status: 'PASS' }, ...overrides,
  },
} }] });
const RAW = Buffer.from(`From: Operator <${ENV.NOTA_OPERATOR_EMAIL}>\r\nMessage-ID: <one@nota.test>\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nRéponse par courriel.`);

async function setup(options = {}) {
  const repo = createMemoryRepo([]), commands = [], logs = [], notices = [];
  await repo.putSupportThread({ id: 'same-thread', courriel: 'client@example.test', createdAt: '2026-09-09', messages: [
    { id: 'q1', de: 'visiteur', texte: 'Question.', createdAt: '2026-09-09T11:59:00Z' },
  ] });
  const handler = createSupportEmailLambda({
    env: { ...ENV }, repo, nowMs: () => NOW, loadSecrets: async () => 'version-1',
    log: line => logs.push(line),
    s3: { async send(command) { commands.push(command.input); return { Body: RAW, ContentLength: RAW.length }; } },
    notifier: { async onSupportReply(message) { notices.push(message); return { ok: true }; } }, ...options,
  });
  return { handler, repo, commands, logs, notices };
}

test('SES Lambda reads only its configured S3 receipt path and appends to the shared thread', async () => {
  const { handler, repo, commands, logs, notices } = await setup();
  const event = incoming();
  event.bucket = 'untrusted-bucket';
  event.key = '../other-object';
  const result = await handler(event);
  assert.equal(result.results[0].accepted, true);
  assert.deepEqual(commands, [{ Bucket: ENV.NOTA_SUPPORT_EMAIL_BUCKET, Key: 'support/receipt1' }]);
  assert.equal((await repo.getSupportThread('same-thread')).messages.length, 2);
  assert.equal(notices.length, 1);
  assert.deepEqual(logs.map(JSON.parse), [{ event: 'support_email', counts: { accepted: 1 } }]);
  assert.ok(!logs.join('').includes('Réponse'));
  assert.ok(!logs.join('').includes('@'));
});

test('repeated SES invocations share message idempotency and expose only aggregate result counts', async () => {
  const { handler, logs, notices } = await setup();
  await handler(incoming());
  await handler(incoming());
  assert.equal(notices.length, 1);
  assert.deepEqual(JSON.parse(logs.at(-1)), { event: 'support_email', counts: { duplicate: 1 } });
});

test('rejected SES mail is counted without downloading or exposing its capability', async () => {
  const { handler, commands, logs } = await setup();
  await handler(incoming({ dmarcVerdict: { status: 'FAIL' } }));
  assert.equal(commands.length, 0);
  assert.deepEqual(JSON.parse(logs[0]), { event: 'support_email', counts: { ses_verdict: 1 } });
  assert.ok(!logs[0].includes(address()));
});

test('transient storage failures throw for asynchronous retry and log no provider details', async () => {
  const { handler, logs } = await setup({ s3: { async send() { throw new Error('PRIVATE_BUCKET_AND_BODY'); } } });
  await assert.rejects(handler(incoming()), /^Error: Support email processing unavailable\.$/);
  assert.deepEqual(logs.map(JSON.parse), [{ event: 'support_email', result: 'retryable_failure' }]);
});

test('worker cannot start with missing signing/storage configuration', async () => {
  for (const name of ['TABLE_NAME', 'NOTA_SUPPORT_EMAIL_BUCKET', 'NOTA_SUPPORT_EMAIL_DOMAIN', 'NOTA_NOTARY_SECRET']) {
    const { handler } = await setup({ env: { ...ENV, [name]: '' } });
    await assert.rejects(handler(incoming()), /not configured/);
  }
});

test('infrastructure keeps receiving opt-in and scoped to the dedicated subdomain and exact SES rule', () => {
  const source = readFileSync(new URL('../../../infra/support-email.tf', import.meta.url), 'utf8');
  assert.match(source, /variable "enable_support_email"[\s\S]*?default\s*= false/);
  assert.match(source, /variable "support_email_activate"[\s\S]*?default\s*= false/);
  assert.match(source, /enabled\s*= var\.support_email_activate/);
  assert.match(source, /recipients\s*= \[local\.support_email_domain\]/);
  assert.match(source, /inbound-smtp\.ca-central-1\.amazonaws\.com/);
  assert.match(source, /source_account\s*= data\.aws_caller_identity\.current\.account_id/);
  assert.match(source, /source_arn\s*= local\.support_email_rule_arn/);
  assert.match(source, /maximum_retry_attempts\s*= 2/);
  assert.match(source, /aws_sqs_queue\.support_email_failed\[0\]\.arn/);
  assert.ok(!source.includes('aws_lambda_function_url'));
  assert.ok(!/name\s*= var\.domain_name/.test(source), 'never replaces the apex MX');
});

test('opt-in CI deploy verifies the isolated MIME/runtime artifact and never hides configured errors', () => {
  const yaml = readFileSync(new URL('../../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const block = yaml.slice(yaml.indexOf('- name: Deploy optional support email worker'), yaml.indexOf('- name: Sync web assets to S3'));
  assert.match(block, /if: vars\.SUPPORT_EMAIL_FUNCTION != ''/);
  assert.match(block, /set -euo pipefail/);
  assert.match(block, /get-function --function-name "\$SUPPORT_EMAIL_FUNCTION"/);
  assert.match(block, /require\('\.\/node_modules\/mailparser'\)/);
  assert.match(block, /require\('\.\/support-email'\)/);
  assert.match(block, /--zip-file fileb:\/\/\/tmp\/api.zip/);
  assert.ok(!block.includes('|| true'));
});
