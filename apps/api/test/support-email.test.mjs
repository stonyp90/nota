import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
const require = createRequire(import.meta.url);
const { supportReplyAddress, verifyReplyAddress, stripQuotedReply, createSupportEmailReceiver, MAX_RAW_BYTES, REPLY_TTL_MS } = require('../src/support-email');
const { createSupportConversations } = require('../src/support-conversations');
const { createMemoryRepo } = require('../src/repo-memory');
const domain = require('@nota/domain');
const { signToken, SCOPES } = require('../src/notary-auth');

const NOW = Date.parse('2026-09-09T12:00:00Z');
const SECRET = 'synthetic-support-email-key-with-at-least-32-characters';
const HOST = 'replies.nota.test';
const CLIENT = 'client@example.test';
const OPERATOR = 'operator@nota.test';
const ID = '2d9fda2f-d48a-4f2b-af4c-d54414a8d350';
const ENV = { NOTA_NOTARY_SECRET: SECRET, NOTA_SUPPORT_EMAIL_DOMAIN: HOST, NOTA_OPERATOR_EMAIL: OPERATOR };
const address = (overrides = {}) => supportReplyAddress({ threadId: ID, role: 'operator', sender: OPERATOR, domain: HOST, secret: SECRET, nowMs: NOW, ...overrides });
const verify = (recipient, overrides = {}) => verifyReplyAddress({ address: recipient, sender: OPERATOR, domain: HOST, secret: SECRET, nowMs: NOW, ...overrides });

function mime({ sender = OPERATOR, text = 'Bonjour, voici ma réponse.', id = '<reply-1@example.test>', headers = [], type = 'text/plain; charset=UTF-8', encoding, to = 'unrelated@example.test' } = {}) {
  return Buffer.from([
    `From: Example Person <${sender}>`, `To: ${to}`, `Message-ID: ${id}`, 'MIME-Version: 1.0',
    `Content-Type: ${type}`, ...(encoding ? [`Content-Transfer-Encoding: ${encoding}`] : []), ...headers,
    '', text,
  ].join('\r\n'));
}
function record(recipient, overrides = {}) {
  return {
    eventSource: 'aws:ses', eventVersion: '1.0', ses: {
      mail: { messageId: 'ses-receipt-1', source: OPERATOR, ...overrides.mail },
      receipt: {
        recipients: [recipient], spamVerdict: { status: 'PASS' }, virusVerdict: { status: 'PASS' },
        dmarcVerdict: { status: 'PASS' }, dkimVerdict: { status: 'PASS' }, spfVerdict: { status: 'PASS' },
        ...overrides.receipt,
      },
    },
  };
}
async function setup(raw = mime(), options = {}) {
  const repo = createMemoryRepo([]);
  await repo.putSupportThread({ id: ID, courriel: CLIENT, createdAt: '2026-09-09', messages: [
    { id: 'initial', de: 'visiteur', texte: 'Question existante.', createdAt: '2026-09-09T11:00:00.000Z' },
  ] });
  const notices = [], reads = [];
  const notifier = options.notifier || {
    async onSupportReply(payload) { notices.push(payload); return { ok: true }; },
    async onSupportMessage(payload) { notices.push(payload); return { ok: true }; },
  };
  const conversations = options.conversations || createSupportConversations({ repo, notifier, nowMs: () => NOW });
  const receiver = createSupportEmailReceiver({ repo, conversations, env: { ...ENV, ...options.env }, nowMs: () => NOW,
    getObject: options.getObject || (async id => { reads.push(id); return { Body: raw, ContentLength: raw.length }; }),
  });
  return { repo, receiver, notices, reads, conversations };
}

test('compact signed reply addresses fit the SMTP local-part limit and round-trip UUID/generic thread ids', () => {
  for (const threadId of [ID, 'thread-test-1', 'x'.repeat(32)]) {
    for (const role of ['operator', 'visitor']) {
      const recipient = address({ threadId, role });
      assert.ok(recipient.split('@')[0].length <= 64);
      assert.deepEqual(verify(recipient), { threadId, role, expiresAt: NOW + REPLY_TTL_MS });
    }
  }
});

test('signatures bind role, thread, sender, destination, expiry and signing key', () => {
  const recipient = address();
  for (const tampered of [recipient.replace('1ou.', '1vu.'), recipient.replace('2d9fda2f', '3d9fda2f'), recipient.replace(/\.[^.]+@/, '.aaaaaaaaaaaaaaaaaaa@')]) assert.equal(verify(tampered), null);
  for (const options of [{ sender: CLIENT }, { domain: 'other.nota.test' }, { secret: 'other-synthetic-secret-at-least-32-characters' }, { nowMs: NOW + REPLY_TTL_MS }]) assert.equal(verify(recipient, options), null);
  assert.equal(verify(recipient, { sender: OPERATOR.toUpperCase(), domain: HOST.toUpperCase() }).role, 'operator');
  assert.equal(verifyReplyAddress({ address: signToken(ID, NOW + REPLY_TTL_MS, SCOPES.SUPPORT_OP, SECRET), sender: OPERATOR, domain: HOST, secret: SECRET, nowMs: NOW }), null);
});

test('missing/invalid configuration cannot mint a capability or use a public development key', () => {
  for (const override of [{ secret: '' }, { secret: 'short' }, { role: 'admin' }, { sender: 'invalid' }, { domain: '' }, { domain: 'bad@domain.test' }, { threadId: '../other' }, { threadId: 'x'.repeat(33) }, { ttlMs: -1 }, { ttlMs: REPLY_TTL_MS + 1 }, { nowMs: NaN }]) assert.equal(address(override), null);
});

test('an authenticated operator email appends to the existing browser/admin thread and notifies the client once', async () => {
  const { receiver, repo, notices } = await setup();
  const event = record(address());
  assert.deepEqual(await receiver.receive(event), { accepted: true, duplicate: false, attachmentsIgnored: 0 });
  assert.deepEqual(await receiver.receive(event), { accepted: true, duplicate: true, attachmentsIgnored: 0 });
  const thread = await repo.getSupportThread(ID);
  assert.equal(thread.id, ID);
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.messages[1].de, 'nota');
  assert.equal(thread.messages[1].texte, 'Bonjour, voici ma réponse.');
  assert.equal(thread.messages[1].author, OPERATOR);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].threadId, ID);
  assert.equal(notices[0].courriel, CLIENT);
});

test('a client email continues the same thread as visiteur, without invoking an assistant', async () => {
  const { receiver, repo, notices } = await setup(mime({ sender: CLIENT }));
  const result = await receiver.receive(record(address({ role: 'visitor', sender: CLIENT }), { mail: { source: CLIENT } }));
  assert.equal(result.accepted, true);
  const thread = await repo.getSupportThread(ID);
  assert.equal(thread.messages.at(-1).de, 'visiteur');
  assert.equal(thread.messages.length, 2);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].threadId, ID);
});

test('routing uses the SES envelope and never the visible To header', async () => {
  const { receiver, reads, repo } = await setup(mime({ to: address() }));
  const result = await receiver.receive(record('arbitrary@' + HOST));
  assert.equal(result.reason, 'recipient');
  assert.equal(reads.length, 0);
  assert.equal((await repo.getSupportThread(ID)).messages.length, 1);
});

test('signed routes sent to multiple distinct threads are rejected rather than cross-posted', async () => {
  const { receiver, reads } = await setup();
  const result = await receiver.receive(record(address(), { receipt: { recipients: [address(), address({ threadId: 'other-thread' })] } }));
  assert.equal(result.reason, 'recipient');
  assert.equal(reads.length, 0);
});

test('forwarded operator capabilities, expired capabilities and removed participants cannot post', async () => {
  const forwarded = await setup(mime({ sender: CLIENT }));
  assert.equal((await forwarded.receiver.receive(record(address(), { mail: { source: CLIENT } }))).reason, 'capability');
  const expired = await setup();
  assert.equal((await expired.receiver.receive(record(address({ nowMs: NOW - REPLY_TTL_MS })))).reason, 'capability');
  const removed = await setup(mime({ sender: CLIENT }));
  const thread = await removed.repo.getSupportThread(ID);
  await removed.repo.putSupportThread({ ...thread, courriel: 'new@example.test' });
  assert.equal((await removed.receiver.receive(record(address({ role: 'visitor', sender: CLIENT }), { mail: { source: CLIENT } }))).reason, 'participant');
  const deniedOperator = await setup(mime(), { env: { NOTA_SUPPORT_OPERATOR_EMAILS: 'other@nota.test' } });
  assert.equal((await deniedOperator.receiver.receive(record(address()))).reason, 'participant');
});

test('a missing thread is never recreated from email', async () => {
  const { receiver, repo } = await setup();
  assert.equal((await receiver.receive(record(address({ threadId: 'missing-thread' })))).reason, 'thread_missing');
  assert.equal(await repo.getSupportThread('missing-thread'), null);
});

test('all non-PASS spam, virus and DMARC verdicts reject before reading MIME', async t => {
  for (const name of ['spamVerdict', 'virusVerdict', 'dmarcVerdict']) for (const status of ['FAIL', 'GRAY', 'PROCESSING_FAILED', undefined]) {
    await t.test(`${name}: ${status}`, async () => {
      const { receiver, reads } = await setup();
      assert.equal((await receiver.receive(record(address(), { receipt: { [name]: { status } } }))).reason, 'ses_verdict');
      assert.equal(reads.length, 0);
    });
  }
});

test('DMARC must be backed by an authenticated SPF or DKIM result; forwarded DKIM-authenticated mail works', async () => {
  const { receiver } = await setup();
  assert.equal((await receiver.receive(record(address(), { receipt: { spfVerdict: { status: 'FAIL' }, dkimVerdict: { status: 'FAIL' } } }))).reason, 'ses_verdict');
  assert.equal((await receiver.receive(record(address(), { receipt: { spfVerdict: { status: 'FAIL' } }, mail: { source: 'forwarder@example.test' } }))).accepted, true);
});

test('automatic replies, mailing lists and DSNs do not generate support messages or more emails', async () => {
  for (const headers of [
    ['Auto-Submitted: auto-replied'], ['Auto-Submitted: auto-generated'], ['Precedence: bulk'],
    ['List-Id: a-list.example.test'], ['X-Autoreply: yes'], ['X-Nota-Support-Automation: 1'],
  ]) {
    const { receiver, notices } = await setup(mime({ headers }));
    assert.equal((await receiver.receive(record(address()))).reason, 'automatic');
    assert.equal(notices.length, 0);
  }
  const dsn = await setup();
  assert.equal((await dsn.receiver.receive(record(address(), { mail: { source: '' } }))).reason, 'automatic');
});

test('ambiguous From and Message-ID headers cannot choose or overwrite a participant', async () => {
  for (const headers of [['From: Other <other@example.test>'], ['Message-ID: <other@example.test>']]) {
    const { receiver, notices } = await setup(mime({ headers }));
    assert.equal((await receiver.receive(record(address()))).accepted, false);
    assert.equal(notices.length, 0);
  }
});

test('UTF-8 base64 and quoted-printable replies are decoded before validation', async () => {
  for (const [encoding, text] of [['base64', Buffer.from('Réponse française.').toString('base64')], ['quoted-printable', 'R=C3=A9ponse fran=C3=A7aise.']]) {
    const { receiver, repo } = await setup(mime({ encoding, text }));
    assert.equal((await receiver.receive(record(address()))).accepted, true);
    assert.equal((await repo.getSupportThread(ID)).messages.at(-1).texte, 'Réponse française.');
  }
});

test('HTML-only email becomes plain text; quoted blocks and signature content are excluded', async () => {
  const { receiver, repo } = await setup(mime({ type: 'text/html; charset=UTF-8', text: '<p>Voici la réponse &amp; ses détails.</p><blockquote>Ancienne question privée.</blockquote><img src="https://outside.invalid/pixel">' }));
  assert.equal((await receiver.receive(record(address()))).accepted, true);
  assert.equal((await repo.getSupportThread(ID)).messages.at(-1).texte, 'Voici la réponse & ses détails.');
});

test('common FR/EN quote markers strip history conservatively while ordinary prose remains intact', () => {
  for (const quote of ['> Ancien texte', 'On Tue, 8 Sep 2026, Person wrote:\nold text', 'Le 8 septembre 2026, Person\na écrit :\nancien texte', '-----Original Message-----\nold text', '-- \nSignature', 'Sent from my iPhone', 'From: Person\nSent: yesterday\nTo: someone']) assert.equal(stripQuotedReply('Réponse.\n\n' + quote), 'Réponse.');
  assert.equal(stripQuotedReply('Le notaire répond demain.\nOn pose deux questions.\nTexte complet.'), 'Le notaire répond demain.\nOn pose deux questions.\nTexte complet.');
});

test('attachments are ignored safely and never become stored messages or filesystem paths', async () => {
  const raw = mime({ type: 'multipart/mixed; boundary="bound"', text: [
    '--bound', 'Content-Type: text/plain; charset=UTF-8', '', 'Texte utile.',
    '--bound', 'Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename="../../secret.txt"',
    'Content-Transfer-Encoding: base64', '', Buffer.from('PRIVATE_ATTACHMENT_BYTES').toString('base64'), '--bound--',
  ].join('\r\n') });
  const { receiver, repo, notices } = await setup(raw);
  assert.deepEqual(await receiver.receive(record(address())), { accepted: true, duplicate: false, attachmentsIgnored: 1 });
  const thread = await repo.getSupportThread(ID);
  assert.equal(thread.messages.at(-1).texte, 'Texte utile.');
  assert.ok(!JSON.stringify(thread).includes('PRIVATE_ATTACHMENT_BYTES'));
  assert.ok(!JSON.stringify(notices).includes('../../secret.txt'));
});

test('oversized MIME is refused from content length or actual stream size without buffering it all', async () => {
  let destroyed = false;
  const header = await setup(mime(), { getObject: async () => ({ ContentLength: MAX_RAW_BYTES + 1, Body: { destroy() { destroyed = true; } } }) });
  assert.equal((await header.receiver.receive(record(address()))).reason, 'message_size');
  assert.equal(destroyed, true);
  const stream = await setup(mime(), { getObject: async () => ({ Body: Readable.from([Buffer.alloc(MAX_RAW_BYTES), Buffer.alloc(1)]) }) });
  assert.equal((await stream.receiver.receive(record(address()))).reason, 'message_size');
});

test('empty/quoted-only/over-limit reply text is refused rather than silently truncated', async () => {
  for (const text of ['', '> Only history', 'x'.repeat(domain.SUPPORT_MESSAGE_MAX + 1)]) {
    const { receiver, notices } = await setup(mime({ text }));
    assert.equal((await receiver.receive(record(address()))).reason, 'message_text');
    assert.equal(notices.length, 0);
  }
});

test('stable MIME Message-ID dedupes provider redelivery even when SES receipt ID changes', async () => {
  const { receiver, repo, notices } = await setup();
  await receiver.receive(record(address()));
  const repeated = await receiver.receive(record(address(), { mail: { messageId: 'new-ses-receipt' } }));
  assert.equal(repeated.duplicate, true);
  assert.equal((await repo.getSupportThread(ID)).messages.length, 2);
  assert.equal(notices.length, 1);
});

test('storage/append/notification failures remain retryable without leaking raw error details', async () => {
  const missing = await setup(mime(), { getObject: async () => { throw new Error('PRIVATE_STORAGE_DETAILS'); } });
  await assert.rejects(missing.receiver.receive(record(address())), /^Error: Support email storage unavailable\.$/);
  const failed = await setup(mime(), { conversations: { reply: async () => { throw new Error('PRIVATE_DATABASE_DETAILS'); } } });
  await assert.rejects(failed.receiver.receive(record(address())), /^Error: Support email conversation unavailable\.$/);
  const notify = await setup(mime(), { conversations: { reply: async () => ({ ok: true, notification: { ok: false } }) } });
  await assert.rejects(notify.receiver.receive(record(address())), /^Error: Support email notification unavailable\.$/);
});

test('malformed/untrusted events and invalid S3 object keys never read storage', async () => {
  const { receiver, reads } = await setup();
  for (const event of [null, {}, { Records: [] }, { Records: Array(11).fill({}) }]) assert.equal((await receiver.handle(event)).reason, 'event');
  assert.equal((await receiver.receive({ eventSource: 'aws:sns' })).reason, 'ses_verdict');
  assert.equal((await receiver.receive(record(address(), { mail: { messageId: '../other-object' } }))).reason, 'ses_verdict');
  assert.equal(reads.length, 0);
});
