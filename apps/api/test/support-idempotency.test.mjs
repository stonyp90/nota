import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createFakeTable } from './fake-table.mjs';
const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler');
const { createMemoryRepo } = require('../src/repo-memory');
const { createDynamoRepo } = require('../src/repo-dynamo');
const { createSupportConversations } = require('../src/support-conversations');
const NOW = Date.parse('2026-09-09T14:00:00Z');
const parse = response => JSON.parse(response.body);
const ANSWER = { repond: true, niveau: 2, motif: null, texte: 'Vous pouvez consulter les étapes affichées dans le carnet.' };
const body = { texte: 'Précision alpha ?', messageId: 'browser-request-1', requestKey: Buffer.alloc(32, 7).toString('base64url'), courriel: 'client@example.ca', locale: 'fr' };
const post = (app, payload, token) => app.handle({ method: 'POST', path: '/support/messages', headers: token ? { authorization: 'Bearer ' + token } : {}, body: payload });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(adapter = 'memory', notifier) {
  const repo = createMemoryRepo();
  if (adapter === 'dynamo') {
    const dynamo = createDynamoRepo({ tableName: 'nota-main', doc: createFakeTable().doc });
    repo.putSupportThread = dynamo.putSupportThread; repo.getSupportThread = dynamo.getSupportThread;
  }
  let n = 0;
  const clock = { ms: NOW };
  const opts = { now: () => '2026-09-09', nowMs: () => clock.ms, newId: () => 'request-' + ++n, env: {}, notifier };
  return { repo, clock, app: port => createApp(repo, { ...opts, ...(port ? { assistantPort: port } : {}) }), service: extra => createSupportConversations({ repo, nowMs: opts.nowMs, newId: opts.newId, notifier, ...extra }) };
}

for (const adapter of ['memory', 'dynamo']) {
  test(`${adapter}: concurrent first-message retries reserve one thread and invoke the assistant once`, async () => {
    const entered = deferred(), released = deferred();
    let calls = 0;
    const port = { async answer() { calls++; entered.resolve(); await released.promise; return ANSWER; } };
    const f = fixture(adapter);
    const first = post(f.app(port), body);
    await entered.promise;
    const waiting = await post(f.app(port), body);
    assert.equal(waiting.statusCode, 409);
    assert.equal(parse(waiting).errors[0].code, 'message_en_cours');
    assert.equal(calls, 1);
    released.resolve();
    const accepted = parse(await first);
    const repeated = await post(f.app(port), body);
    assert.equal(repeated.statusCode, 201);
    const duplicate = parse(repeated);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.threadId, accepted.threadId);
    assert.equal(duplicate.token, accepted.token);
    assert.deepEqual(duplicate.message, accepted.message);
    assert.deepEqual(duplicate.reponse, accepted.reponse);
    assert.match(duplicate.threadId, /^[a-f0-9]{32}$/);
    assert.equal(calls, 1);
    const saved = await f.repo.getSupportThread(accepted.threadId);
    assert.equal(saved.messages.length, 2);
    assert.ok(!JSON.stringify(saved).includes(body.requestKey), 'raw retry credential is not stored');
    for (const changed of [{ texte: 'Autre question.' }, { courriel: 'other@example.ca' }, { locale: 'en' }, { messageId: 'other-id' }]) {
      assert.equal((await post(f.app(port), { ...body, ...changed })).statusCode, 409);
    }
  });

  test(`${adapter}: existing-thread duplicate messages return the same acknowledgment and notify only once`, async () => {
    let notices = 0;
    const f = fixture(adapter, { async onSupportMessage() { notices++; return { ok: true }; } });
    const first = parse(await post(f.app(), body));
    const followup = { texte: 'Une précision.', messageId: 'followup-1', courriel: 'client@example.ca' };
    const accepted = parse(await post(f.app(), followup, first.token));
    const duplicate = parse(await post(f.app(), followup, first.token));
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.message, accepted.message);
    assert.equal(notices, 2);
    assert.equal((await f.repo.getSupportThread(first.threadId)).messages.length, 2);
    assert.equal((await post(f.app(), { ...followup, texte: 'Changed.' }, first.token)).statusCode, 409);
  });

  test(`${adapter}: an expired processing claim can recover without appending the old worker's late answer`, async () => {
    const entered = deferred(), released = deferred();
    const f = fixture(adapter);
    const late = post(f.app({ async answer() { entered.resolve(); await released.promise; return ANSWER; } }), body);
    await entered.promise;
    f.clock.ms += 31000;
    const recovered = await post(f.app({ async answer() { return { ...ANSWER, texte: 'Voici les étapes à consulter dans le carnet.' }; } }), body);
    assert.equal(recovered.statusCode, 201);
    released.resolve();
    const original = await late;
    assert.equal(original.statusCode, 201);
    assert.deepEqual(parse(original).reponse, parse(recovered).reponse);
    const saved = await f.repo.getSupportThread(parse(recovered).threadId);
    assert.equal(saved.messages.length, 2);
    assert.equal(saved.pendingMessages.length, 0);
  });

  test(`${adapter}: failed reply notification can retry while completed delivery stays deduplicated`, async () => {
    let calls = 0;
    const f = fixture(adapter, { async onSupportReply() { calls++; return { ok: calls > 1 }; } });
    await f.repo.putSupportThread({ id: 'thread', courriel: 'client@example.ca', messages: [] });
    const service = f.service();
    const request = { threadId: 'thread', texte: 'Réponse.', messageId: 'reply-retry-1' };
    const failed = await service.reply(request);
    assert.equal(failed.ok, true);
    assert.equal(failed.notification.ok, false);
    const retried = await service.reply(request);
    assert.equal(retried.duplicate, true);
    assert.equal(retried.notification.ok, true);
    assert.equal((await service.reply(request)).notification.duplicate, true);
    assert.equal(calls, 2);
    assert.equal((await f.repo.getSupportThread('thread')).messages.length, 1);
    assert.deepEqual(Object.keys(retried.message).sort(), ['createdAt', 'de', 'id', 'texte']);
  });

  test(`${adapter}: concurrent notification callbacks are claimed once and an expired lease recovers`, async () => {
    const entered = deferred(), released = deferred();
    let calls = 0;
    const f = fixture(adapter, { async onSupportReply() { calls++; entered.resolve(); await released.promise; return { ok: true }; } });
    await f.repo.putSupportThread({ id: 'thread', courriel: 'client@example.ca', messages: [] });
    const request = { threadId: 'thread', texte: 'Réponse.', messageId: 'reply-shared-1' };
    const first = f.service().reply(request);
    await entered.promise;
    const concurrent = await f.service().reply(request);
    assert.equal(concurrent.duplicate, true);
    assert.equal(concurrent.notification.pending, true);
    assert.equal(calls, 1);
    released.resolve(); await first;
    assert.equal((await f.service().reply(request)).notification.duplicate, true);
    let thread = await f.repo.getSupportThread('thread');
    thread.messages[0] = { ...thread.messages[0], delivery: { state: 'sending', claimId: 'crashed', leaseUntil: NOW - 1 } };
    await f.repo.putSupportThread(thread);
    assert.equal((await f.service().reply(request)).notification.ok, true);
    assert.equal(calls, 2, 'an expired persisted claim can be recovered');
  });

  test(`${adapter}: visitor email identity is rechecked after a concurrent address change`, async () => {
    const f = fixture(adapter);
    await f.repo.putSupportThread({ id: 'thread', courriel: 'first@example.ca', messages: [] });
    const put = f.repo.putSupportThread;
    let changed = false;
    f.repo.putSupportThread = async (thread, options) => {
      if (!changed) {
        changed = true;
        const current = await f.repo.getSupportThread(thread.id);
        await put({ ...current, courriel: 'second@example.ca' }, { expectedRevision: current.supportRevision });
      }
      return put(thread, options);
    };
    const result = await f.service().appendVisitor({ threadId: 'thread', texte: 'Bonjour.', messageId: 'mail-1', expectedEmail: 'first@example.ca' });
    assert.equal(result.status, 403);
    assert.equal((await f.repo.getSupportThread('thread')).messages.length, 0);
  });
}

test('message/request-key validation rejects malformed retry credentials before persistence', async () => {
  const f = fixture();
  for (const changed of [{ messageId: '<id>' }, { requestKey: 'short' }, { requestKey: '+'.repeat(43) }, { messageId: undefined }]) {
    assert.equal((await post(f.app(), { ...body, ...changed })).statusCode, 422);
  }
});

test('a stalled callback returns a retryable bounded result and retains its delivery lease', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const entered = deferred();
  const f = fixture('memory', { async onSupportReply() { entered.resolve(); return new Promise(() => {}); } });
  await f.repo.putSupportThread({ id: 'thread', courriel: 'client@example.ca', messages: [] });
  const pending = f.service({ notifyFlushMs: 20 }).reply({ threadId: 'thread', texte: 'Réponse.', messageId: 'slow-reply' });
  await entered.promise;
  // Exercise the configured deadline without depending on host CPU scheduling.
  t.mock.timers.tick(20);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.notification.timedOut, true);
  assert.equal(result.notification.retryable, true);
  assert.equal((await f.repo.getSupportThread('thread')).messages[0].delivery.state, 'sending');
});
