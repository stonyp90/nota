import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler');
const { createAdmin } = require('../src/admin');
const { createAdminApp } = require('../src/admin-handler');
const { createSupportConversations } = require('../src/support-conversations');
const { createMemoryRepo } = require('../src/repo-memory');
const { createNotifier } = require('../src/notifications');
const { createFakeMailer } = require('../src/notify-port');
const { adminIdForEmail } = require('../src/admin-auth');
const { signToken, SCOPES } = require('../src/notary-auth');
const D = require('@nota/domain');

const NOW = Date.parse('2026-09-09T14:00:00Z');
const parse = response => JSON.parse(response.body);
const bearer = token => ({ authorization: 'Bearer ' + token });

function setup() {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', operatorEmail: 'ops@nota.ca', now: () => new Date(NOW).toISOString() });
  let n = 0;
  const opts = { repo, notifier, nowMs: () => NOW, now: () => new Date(NOW).toISOString(), newId: () => 'id-' + ++n };
  const admin = createAdmin({ ...opts, config: { allowlist: ['ops@nota.ca', 'analyst@nota.ca'], devEcho: true, baseUrl: 'https://admin.nota.ca' } });
  const app = createAdminApp(repo, { admin, notifier, nowMs: () => NOW, adminBaseUrl: 'https://admin.nota.ca' });
  const publicApp = createApp(repo, { notifier, nowMs: () => NOW, newId: opts.newId, env: {}, supportUrl: 'https://nota.example' });
  const support = createSupportConversations(opts);
  const call = (method, path, token, body, query = {}) => app.handle({ method, path, headers: token ? bearer(token) : {}, body, query, sourceIp: '127.0.0.1' });
  const ask = (texte, token) => publicApp.handle({ method: 'POST', path: '/support/messages', headers: token ? bearer(token) : {}, body: { texte, courriel: 'client@example.ca' } });
  return { repo, mailer, admin, app, publicApp, support, call, ask };
}

async function login(h, permissions) {
  const email = permissions ? 'analyst@nota.ca' : 'ops@nota.ca';
  if (permissions) await h.repo.putAdmin({ id: adminIdForEmail(email), email, role: 'analyst', permissions, disabled: false });
  const requested = await h.admin.requestLogin({ email });
  const token = new URL(requested.devLink).hash.split('token=')[1];
  return (await h.admin.verifyMagic({ token: decodeURIComponent(token) })).session;
}

test('admin inbox/detail/reply share the widget thread and a retry sends one email and one audit event', async () => {
  const h = setup();
  const token = await login(h);
  const first = parse(await h.ask('Bonjour, une question.'));
  const listed = await h.call('GET', '/admin/support', token);
  assert.equal(listed.statusCode, 200);
  assert.equal(parse(listed).threads[0].id, first.threadId);
  assert.deepEqual(parse(listed).statuts, D.SUPPORT_STATUTS);
  assert.equal(parse(listed).limites.messageMax, D.SUPPORT_MESSAGE_MAX);
  const detail = await h.call('GET', '/admin/support/' + first.threadId, token);
  assert.equal(parse(detail).thread.messages.length, 1);
  assert.equal(parse(detail).thread.courriel, 'client@example.ca');
  const path = '/admin/support/' + first.threadId + '/reponse';
  const body = { texte: 'Bonjour, je peux vous guider.', messageId: 'request-fixed-1' };
  const one = await h.call('POST', path, token, body);
  assert.equal(one.statusCode, 200);
  assert.equal(parse(one).duplicate, false);
  assert.equal(parse(one).thread.humain, true);
  assert.deepEqual(parse(one).notification, { ok: true });
  assert.equal(parse(one).message.notificationPending, false);
  const two = await h.call('POST', path, token, body);
  assert.equal(parse(two).duplicate, true);
  assert.deepEqual(parse(two).message, parse(one).message);
  const widget = parse(await h.publicApp.handle({ method: 'GET', path: '/support/thread', headers: bearer(first.token) }));
  assert.deepEqual(widget.messages.map(message => message.de), ['visiteur', 'nota']);
  assert.equal(widget.threadId, first.threadId);
  assert.equal(widget.messages[1].texte, body.texte);
  assert.equal(h.mailer.sent.filter(mail => mail.to === 'client@example.ca').length, 1);
  const audit = await h.repo.queryAuditByDay('2026-09-09');
  assert.equal(audit.filter(event => event.action === 'support_reply_sent').length, 1);
  assert.ok(!JSON.stringify(audit.filter(event => event.action.startsWith('support_'))).includes(body.texte), 'audit records identity and message id, not the private transcript');
  assert.equal(one.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(one.headers['cache-control'], 'no-store');
});

test('admin support permissions fail closed and can be granted separately', async () => {
  const h = setup();
  const first = parse(await h.ask('Bonjour.'));
  const path = '/admin/support/' + first.threadId;
  assert.equal((await h.call('GET', '/admin/support')).statusCode, 401);
  assert.equal((await h.call('GET', path, first.token)).statusCode, 401, 'a public visitor token is not an admin session');
  const analyst = await login(h, []);
  assert.equal((await h.call('GET', path, analyst)).statusCode, 403);
  const id = adminIdForEmail('analyst@nota.ca');
  let profile = await h.repo.getAdmin(id);
  await h.repo.putAdmin({ ...profile, permissions: ['support:read'] });
  assert.equal((await h.call('GET', path, analyst)).statusCode, 403, 'free text needs explicit PII permission');
  await h.repo.putAdmin({ ...profile, permissions: ['support:read', 'pii:read'] });
  assert.equal((await h.call('GET', path, analyst)).statusCode, 200);
  assert.equal((await h.call('POST', path + '/reponse', analyst, { texte: 'Réponse.' })).statusCode, 403);
  await h.repo.putAdmin({ ...profile, permissions: ['support:read', 'support:write', 'pii:read'] });
  assert.equal((await h.call('POST', path + '/reponse', analyst, { texte: 'Réponse.', messageId: 'grant-1' })).statusCode, 200);
  await h.admin.logout(analyst);
  assert.equal((await h.call('GET', path, analyst)).statusCode, 401, 'revocation applies to every support request');
});

test('admin validates replies, rejects conflicting IDs, and never creates an unknown conversation', async () => {
  const h = setup();
  const token = await login(h);
  const first = parse(await h.ask('Bonjour.'));
  const path = '/admin/support/' + first.threadId + '/reponse';
  assert.equal((await h.call('GET', '/admin/support', token, null, { statut: 'invented' })).statusCode, 422);
  assert.equal((await h.call('GET', '/admin/support/missing', token)).statusCode, 404);
  assert.equal((await h.call('POST', '/admin/support/missing/reponse', token, { texte: 'Réponse.' })).statusCode, 404);
  for (const body of [{ texte: '' }, { texte: 'x'.repeat(D.SUPPORT_MESSAGE_MAX + 1) }, { texte: 'Réponse.', messageId: '<bad>' }]) {
    assert.equal((await h.call('POST', path, token, body)).statusCode, 422);
  }
  assert.equal((await h.call('POST', path, token, '{broken')).statusCode, 400);
  assert.equal((await h.call('GET', '/admin/support/%ZZ', token)).statusCode, 400);
  assert.equal((await h.call('POST', path, token, { texte: 'Réponse A.', messageId: 'same-id' })).statusCode, 200);
  const conflict = await h.call('POST', path, token, { texte: 'Réponse B.', messageId: 'same-id' });
  assert.equal(conflict.statusCode, 409);
  assert.equal(parse(conflict).errors[0].code, 'message_id_conflit');
  assert.equal((await h.repo.getSupportThread(first.threadId)).messages.length, 2);
});

test('admin can reload a failed email and retry its stored message without another message or audit entry', async () => {
  const h = setup();
  const token = await login(h);
  const first = parse(await h.ask('Bonjour.'));
  const originalSend = h.mailer.send.bind(h.mailer);
  let failed = false;
  h.mailer.send = async mail => {
    if (mail.to === 'client@example.ca' && !failed) { failed = true; throw new Error('temporary delivery failure'); }
    return originalSend(mail);
  };
  const path = '/admin/support/' + first.threadId;
  const payload = { texte: 'Réponse à conserver.', messageId: 'pending-mail-1' };
  const accepted = parse(await h.call('POST', path + '/reponse', token, payload));
  assert.deepEqual(accepted.notification, { ok: false, retryable: true });
  assert.equal(accepted.message.notificationPending, true);
  const reloaded = parse(await h.call('GET', path, token));
  assert.equal(reloaded.thread.messages.at(-1).notificationPending, true);
  assert.ok(!JSON.stringify(reloaded).includes('claimId'));
  const retried = parse(await h.call('POST', path + '/reponse', token, payload));
  assert.equal(retried.duplicate, true);
  assert.deepEqual(retried.notification, { ok: true });
  assert.equal(retried.message.notificationPending, false);
  assert.equal(retried.thread.messages.length, 2);
  assert.equal(h.mailer.sent.filter(mail => mail.to === 'client@example.ca').length, 1);
  assert.equal((await h.repo.queryAuditByDay('2026-09-09')).filter(event => event.action === 'support_reply_sent').length, 1);
  await h.repo.putSupportThread({ id: 'without-email', courriel: null, messages: [] });
  const local = parse(await h.call('POST', '/admin/support/without-email/reponse', token, { texte: 'Réponse dans le fil.', messageId: 'no-email-1' }));
  assert.equal(local.notification, null);
  assert.equal(local.message.notificationPending, false);
});

test('email and admin retries of one message share the same idempotency boundary', async () => {
  const h = setup();
  const token = await login(h);
  const first = parse(await h.ask('Bonjour.'));
  const texte = 'Une seule réponse, sur tous les canaux.';
  const results = await Promise.all([
    h.call('POST', '/admin/support/' + first.threadId + '/reponse', token, { texte, messageId: 'shared-message-1' }),
    h.support.reply({ threadId: first.threadId, texte, messageId: 'shared-message-1', author: 'email' }),
  ]);
  assert.equal(results[0].statusCode, 200);
  assert.equal(results[1].ok, true);
  assert.equal([parse(results[0]).duplicate, results[1].duplicate].filter(Boolean).length, 1);
  assert.equal((await h.repo.getSupportThread(first.threadId)).messages.length, 2);
  assert.equal(h.mailer.sent.filter(mail => mail.to === 'client@example.ca').length, 1);
  const incoming = await h.support.appendVisitor({ threadId: first.threadId, texte: 'Merci, une précision.', messageId: 'mail-sha256-1' });
  const replay = await h.support.appendVisitor({ threadId: first.threadId, texte: 'Merci, une précision.', messageId: 'mail-sha256-1' });
  assert.equal(incoming.humain, true);
  assert.equal(replay.duplicate, true);
  assert.equal((await h.repo.getSupportThread(first.threadId)).messages.length, 3);
  assert.equal((await h.support.appendVisitor({ threadId: 'missing', texte: 'Bonjour.', messageId: 'mail-sha256-2' })).status, 404);
});

test('the emailed operator link uses the same idempotent reply service', async () => {
  const h = setup();
  const first = parse(await h.ask('Bonjour.'));
  const token = signToken(first.threadId, NOW + 60000, SCOPES.SUPPORT_OP);
  const send = () => h.publicApp.handle({ method: 'POST', path: '/support/reply', headers: bearer(token), body: { texte: 'Réponse par lien.', messageId: 'operator-retry-1' } });
  assert.equal(parse(await send()).duplicate, false);
  assert.equal(parse(await send()).duplicate, true);
  assert.equal(h.mailer.sent.filter(mail => mail.to === 'client@example.ca').length, 1);
});

test('closing is idempotent and visitor replies reopen the same thread even at the same timestamp', async () => {
  const h = setup();
  const token = await login(h);
  const first = parse(await h.ask('Bonjour.'));
  const path = '/admin/support/' + first.threadId + '/clos';
  const pending = await h.repo.getSupportThread(first.threadId);
  await h.repo.putSupportThread({
    ...pending, escaladeLe: new Date(NOW + 1).toISOString(), escaladeMotif: 'inconnu',
    messages: [...pending.messages, { id: 'handoff', de: 'assistant', texte: 'Une personne reprend.', createdAt: new Date(NOW + 1).toISOString() }],
  });
  const initialCount = h.mailer.sent.length;
  const closed = parse(await h.call('POST', path, token));
  assert.equal(closed.thread.statut, 'clos');
  assert.equal(closed.thread.escalade, false, 'a closed handoff no longer promises a pending reply');
  assert.equal(closed.duplicate, false);
  assert.equal(parse(await h.call('POST', path, token)).duplicate, true);
  assert.equal(h.mailer.sent.length, initialCount, 'closing does not send mail');
  assert.equal((await h.repo.getSupportThread(first.threadId)).messages.length, 2);
  await h.ask('Une précision sur ma question.', first.token);
  let thread = await h.repo.getSupportThread(first.threadId);
  assert.equal(thread.statut, 'a_repondre');
  assert.equal(thread.closLe, null);
  await h.call('POST', path, token);
  const incoming = await h.support.appendVisitor({ threadId: first.threadId, texte: 'Une autre précision.', messageId: 'email-after-close' });
  assert.equal(incoming.thread.statut, 'a_repondre');
  assert.equal(incoming.thread.closLe, null);
  const audit = await h.repo.queryAuditByDay('2026-09-09');
  assert.equal(audit.filter(event => event.action === 'support_thread_closed').length, 2);
});

test('admin IAM scopes shared support writes and delivery bookkeeping to their existing partitions', () => {
  const iam = readFileSync(new URL('../../../infra/admin.tf', import.meta.url), 'utf8');
  assert.match(iam, /sid\s*=\s*"MainTableSupportReply"[\s\S]*?values\s*=\s*\["SUPPORT#\*"\]/);
  assert.match(iam, /sid\s*=\s*"MainTableSupportDelivery"[\s\S]*?values\s*=\s*\["SENT#support:\*#supportReponse", "SUJET#\*"\]/);
});

test('the production admin composition builds the shared notifier from its mailer and environment', async () => {
  const keys = ['NOTA_ADMIN_EMAILS', 'NOTA_BASE_URL', 'NODE_ENV'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.NOTA_ADMIN_EMAILS = 'ops@nota.ca';
    process.env.NOTA_BASE_URL = 'https://nota.example';
    process.env.NODE_ENV = 'test';
    const repo = createMemoryRepo();
    const mailer = createFakeMailer();
    const app = createAdminApp(repo, { mailer, nowMs: () => NOW, adminBaseUrl: 'https://admin.nota.ca' });
    const call = (path, body, token) => app.handle({ method: 'POST', path, body, headers: token ? bearer(token) : {} });
    const requested = parse(await call('/admin/auth/request', { email: 'ops@nota.ca' }));
    const challenge = decodeURIComponent(new URL(requested.devLink).hash.split('token=')[1]);
    const token = parse(await call('/admin/auth/verify', { token: challenge })).session;
    await repo.putSupportThread({ id: 'production-thread', courriel: 'client@example.ca', messages: [] });
    const response = await call('/admin/support/production-thread/reponse', { texte: 'Réponse de la console.', messageId: 'prod-compose-1' }, token);
    assert.equal(response.statusCode, 200);
    assert.equal(mailer.sent.filter(mail => mail.to === 'client@example.ca').length, 1, 'no explicit notifier injection is needed in the deployed entry point');
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
