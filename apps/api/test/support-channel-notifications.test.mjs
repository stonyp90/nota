import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { createMemoryRepo } = require('../src/repo-memory');
const { createFakeMailer } = require('../src/notify-port');
const { createNotifier } = require('../src/notifications');
const { verifyReplyAddress } = require('../src/support-email');
const { verifyToken, SCOPES } = require('../src/notary-auth');
const NOW = Date.parse('2026-09-09T12:00:00Z');
const SECRET = 'test-only-support-mail-secret-'.repeat(2);
const HOST = 'replies.nota.example';
function setup(extra = {}) {
  const repo = createMemoryRepo(), mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', adminUrl: 'https://admin.nota.example', operatorEmail: 'operator@nota.example', now: () => new Date(NOW).toISOString(), supportEmailDomain: HOST, supportEmailSecret: SECRET, ...extra });
  return { repo, mailer, notifier };
}
const verify = (address, sender) => verifyReplyAddress({ address, sender, domain: HOST, secret: SECRET, nowMs: NOW });

test('operator alert opens the existing admin thread and email reply binds operator identity', async () => {
  const { mailer, notifier } = setup();
  await notifier.onSupportMessage({ threadId: 'thread-1', message: { id: 'm1', texte: 'Question client' }, courriel: 'customer@example.test', escalade: true, historique: [] });
  const mail = mailer.sent[0];
  assert.equal(mail.to, 'operator@nota.example');
  assert.deepEqual(verify(mail.replyTo, mail.to).threadId, 'thread-1');
  assert.equal(verify(mail.replyTo, mail.to).role, 'operator');
  assert.equal(verify(mail.replyTo, 'customer@example.test'), null);
  assert.match(mail.html, /https:\/\/admin\.nota\.example\/#\/support\?thread=thread-1/);
  assert.match(mail.text, /au-dessus du message cité|above the quoted message/);
  assert.equal(mail.supportAutomation, true);
});

test('customer notification reply returns to the same thread as a visitor', async () => {
  const { mailer, notifier } = setup();
  await notifier.onSupportReply({ threadId: 'thread-2', message: { id: 'r1', texte: 'Voici la réponse.' }, courriel: 'customer@example.test' });
  const mail = mailer.sent[0];
  assert.equal(mail.to, 'customer@example.test');
  assert.equal(verify(mail.replyTo, mail.to).threadId, 'thread-2');
  assert.equal(verify(mail.replyTo, mail.to).role, 'visitor');
  assert.equal(verify(mail.replyTo, 'operator@nota.example'), null);
  assert.match(mail.text, /Répondez à ce courriel|Reply to this email/);
  const token = decodeURIComponent(mail.text.match(/#messagerie=([^\s]+)/)[1]);
  assert.deepEqual(verifyToken(token, NOW, SECRET), { sub: 'thread-2', scope: SCOPES.SUPPORT });
  assert.equal(verifyToken(token, NOW + 31 * 86400000, SECRET), null);
  assert.equal(mail.supportAutomation, true);
});

test('notification idempotency is scoped to thread and message without duplicate deliveries', async () => {
  const { mailer, notifier } = setup();
  const base = { message: { id: 'same-client-request-id', texte: 'Une réponse.' }, courriel: 'customer@example.test' };
  await notifier.onSupportReply({ ...base, threadId: 'one' });
  await notifier.onSupportReply({ ...base, threadId: 'one' });
  await notifier.onSupportReply({ ...base, threadId: 'two' });
  assert.equal(mailer.sent.length, 2);
  assert.notEqual(mailer.sent[0].replyTo, mailer.sent[1].replyTo);
});

test('disabled email ingestion does not advertise email-to-thread replies or bypass the transcript', async () => {
  const { mailer, notifier } = setup({ supportEmailDomain: '' });
  await notifier.onSupportMessage({ threadId: 'thread-3', message: { id: 'm1', texte: 'Question' }, courriel: 'customer@example.test' });
  await notifier.onSupportReply({ threadId: 'thread-3', message: { id: 'r1', texte: 'Réponse' }, courriel: 'customer@example.test' });
  for (const mail of mailer.sent) {
    assert.equal(mail.replyTo, null);
    assert.doesNotMatch(mail.text, /Répondez à ce courriel|Reply to this email/);
  }
});

test('SES adapter marks support automation while ordinary messages keep their existing headers', async () => {
  const calls = [];
  const fake = { SESv2Client: class { async send(command) { calls.push(command.input); return { MessageId: 'sent' }; } }, SendEmailCommand: class { constructor(input) { this.input = input; } } };
  const context = { module: { exports: {} }, process: { env: {} }, require: id => { assert.equal(id, '@aws-sdk/client-sesv2'); return fake; } };
  vm.runInNewContext(readFileSync(new URL('../src/notify-port.js', import.meta.url), 'utf8'), context);
  const adapter = context.module.exports.createSesAdapter({ from: 'support@nota.example' });
  await adapter.send({ to: 'customer@example.test', subject: 'Reply', text: 'Hello', replyTo: 'signed@replies.nota.example', supportAutomation: true });
  assert.equal(calls[0].ReplyToAddresses[0], 'signed@replies.nota.example');
  const headers = calls[0].Content.Simple.Headers;
  assert.ok(headers.some(h => h.Name === 'Auto-Submitted' && h.Value === 'auto-generated'));
  assert.ok(headers.some(h => h.Name === 'X-Nota-Support-Automation'));
  await adapter.send({ to: 'customer@example.test', subject: 'Other', text: 'Hello' });
  assert.equal(calls[1].Content.Simple.Headers, undefined);
});
