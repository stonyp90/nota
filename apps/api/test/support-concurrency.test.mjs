import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createFakeTable } from './fake-table.mjs';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler');
const { createMemoryRepo } = require('../src/repo-memory');
const { createDynamoRepo } = require('../src/repo-dynamo');
const { signToken, SCOPES } = require('../src/notary-auth');

const NOW = Date.parse('2026-09-09T12:00:00Z');
const parse = response => JSON.parse(response.body);
const headers = token => ({ authorization: 'Bearer ' + token });
const ask = (app, token, texte, extra = {}) => app.handle({ method: 'POST', path: '/support/messages', headers: token ? headers(token) : {}, body: { texte, ...extra } });
const reply = (app, token, texte) => app.handle({ method: 'POST', path: '/support/reply', headers: headers(token), body: { texte } });
const saveEmail = (app, token, courriel) => app.handle({ method: 'PATCH', path: '/support/thread', headers: headers(token), body: { courriel } });
const read = (app, token) => app.handle({ method: 'GET', path: '/support/thread', headers: headers(token) }).then(parse);
const ANSWER = { repond: true, niveau: 2, motif: null, texte: 'Vous pouvez consulter les étapes affichées dans le carnet.' };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function heldAssistant(expected = 1) {
  const started = deferred();
  const calls = [];
  return {
    calls, started: started.promise,
    async answer(input) {
      const gate = deferred();
      calls.push({ input, resolve: gate.resolve });
      if (calls.length === expected) started.resolve();
      return gate.promise;
    },
  };
}

function fixture(adapter) {
  const repo = createMemoryRepo([]);
  let table;
  if (adapter === 'dynamo') {
    table = createFakeTable();
    const dynamo = createDynamoRepo({ tableName: 'nota-main', doc: table.doc });
    repo.putSupportThread = dynamo.putSupportThread;
    repo.getSupportThread = dynamo.getSupportThread;
  }
  let sequence = 0;
  const notices = [], replies = [];
  const app = port => createApp(repo, {
    env: {}, now: () => '2026-09-09', nowMs: () => NOW, newId: () => 'support-' + ++sequence,
    supportUrl: 'https://nota.example', ...(port ? { assistantPort: port } : {}),
    notifier: {
      onSupportMessage(message) { notices.push(message); },
      onSupportReply(message) { replies.push(message); },
    },
  });
  return { repo, table, app, notices, replies };
}

for (const adapter of ['memory', 'dynamo']) {
  test(`${adapter}: separate API instances preserve both concurrent visitor questions without repeating model work`, async () => {
    const f = fixture(adapter);
    const first = parse(await ask(f.app(), null, 'Première question.'));
    const initialRevision = (await f.repo.getSupportThread(first.threadId)).supportRevision;
    const port = heldAssistant(2);
    const pending = [
      ask(f.app(port), first.token, 'Précision alpha ?'),
      ask(f.app(port), first.token, 'Précision bêta ?', { courriel: 'Client@Example.ca' }),
    ];
    await port.started;
    port.calls.forEach(call => call.resolve(ANSWER));
    const responses = await Promise.all(pending);
    assert.deepEqual(responses.map(response => response.statusCode), [201, 201]);
    assert.equal(port.calls.length, 2, 'a conflict never repeats model work');
    const stored = await f.repo.getSupportThread(first.threadId);
    assert.equal(stored.supportRevision, initialRevision + 2);
    assert.deepEqual(stored.messages.filter(message => message.de === 'visiteur').map(message => message.texte).sort(), ['Première question.', 'Précision alpha ?', 'Précision bêta ?'].sort());
    assert.equal(stored.messages.filter(message => message.de === 'assistant').length, 2);
    assert.equal(new Set(stored.messages.map(message => message.id)).size, 5);
    assert.equal(stored.courriel, 'client@example.ca');
    assert.equal(f.notices.length, 1, 'no retry sends a duplicate notification');
  });

  test(`${adapter}: a human reply during model work survives and suppresses the late assistant`, async () => {
    const f = fixture(adapter);
    const first = parse(await ask(f.app(), null, 'Première question.', { courriel: 'client@example.ca' }));
    const opToken = signToken(first.threadId, NOW + 60000, SCOPES.SUPPORT_OP);
    const port = heldAssistant();
    const pending = ask(f.app(port), first.token, 'Précision alpha ?');
    await port.started;
    const human = await reply(f.app(), opToken, 'Je prends votre question en charge.');
    assert.equal(human.statusCode, 200);
    port.calls[0].resolve(ANSWER);
    const response = await pending;
    assert.equal(response.statusCode, 201);
    assert.equal(parse(response).reponse, undefined, 'no late bot interruption');
    assert.equal(parse(response).humain, true);
    const stored = await f.repo.getSupportThread(first.threadId);
    assert.deepEqual(stored.messages.map(message => message.de), ['visiteur', 'nota', 'visiteur']);
    assert.equal(stored.messages[1].texte, 'Je prends votre question en charge.');
    assert.equal(stored.statut, 'a_repondre');
    assert.equal(f.notices.length, 2, 'the person receives the question that arrived during their reply');
    assert.equal(f.replies.length, 1);
    assert.equal(port.calls.length, 1);
  });

  test(`${adapter}: overlapping operator replies are each accepted exactly once`, async () => {
    const f = fixture(adapter);
    const first = parse(await ask(f.app(), null, 'Première question.', { courriel: 'client@example.ca' }));
    const token = signToken(first.threadId, NOW + 60000, SCOPES.SUPPORT_OP);
    const responses = await Promise.all([reply(f.app(), token, 'Réponse alpha.'), reply(f.app(), token, 'Réponse bêta.')]);
    assert.deepEqual(responses.map(response => response.statusCode), [200, 200]);
    const stored = await f.repo.getSupportThread(first.threadId);
    assert.equal(stored.messages.length, 3);
    assert.equal(stored.messages.filter(message => message.de === 'nota').length, 2);
    assert.equal(stored.statut, 'repondu');
    assert.equal(f.replies.length, 2);
  });

  test(`${adapter}: a conditional failure after an already committed write does not duplicate a message`, async () => {
    const f = fixture(adapter);
    const first = parse(await ask(f.app(), null, 'Première question.', { courriel: 'client@example.ca' }));
    const put = f.repo.putSupportThread;
    let simulatedLosses = 0;
    f.repo.putSupportThread = async (thread, options) => {
      await put(thread, options);
      simulatedLosses++;
      return false; // The SDK retried a committed write after losing its response.
    };
    const visitor = await ask(f.app(), first.token, 'Précision alpha ?');
    assert.equal(visitor.statusCode, 201);
    const token = signToken(first.threadId, NOW + 60000, SCOPES.SUPPORT_OP);
    assert.equal((await reply(f.app(), token, 'Réponse alpha.')).statusCode, 200);
    const stored = await f.repo.getSupportThread(first.threadId);
    assert.deepEqual(stored.messages.map(message => message.texte), ['Première question.', 'Précision alpha ?', 'Réponse alpha.']);
    assert.equal(simulatedLosses, 6, 'both appends and their delivery phases recognize their already committed writes');
    assert.equal(f.notices.length, 2);
    assert.equal(f.replies.length, 1);
  });

  test(`${adapter}: saving an email during a slow answer preserves it and creates no extra message`, async () => {
    const f = fixture(adapter);
    const first = parse(await ask(f.app(), null, 'Première question.'));
    const port = heldAssistant();
    const pending = ask(f.app(port), first.token, 'Précision alpha ?');
    await port.started;
    const saved = await saveEmail(f.app(), first.token, ' Client@Example.ca ');
    assert.equal(saved.statusCode, 200);
    assert.equal(parse(saved).courriel, 'client@example.ca');
    port.calls[0].resolve(ANSWER);
    assert.equal((await pending).statusCode, 201);
    const stored = await f.repo.getSupportThread(first.threadId);
    assert.equal(stored.courriel, 'client@example.ca');
    assert.equal(stored.messages.length, 3);
    assert.equal((await read(f.app(), first.token)).courriel, 'client@example.ca');
    assert.equal(port.calls.length, 1);
    assert.equal(f.notices.length, 1);
    assert.equal(f.replies.length, 0);
  });

  test(`${adapter}: saving a reply address is authenticated, validated, and preserves handoff state`, async () => {
    const f = fixture(adapter);
    const port = { calls: 0, async answer() { this.calls++; return ANSWER; } };
    const app = f.app(port);
    const first = parse(await ask(app, null, 'Je veux parler à une personne.'));
    assert.equal(first.escalade, true);
    const before = await f.repo.getSupportThread(first.threadId);
    const opToken = signToken(first.threadId, NOW + 60000, SCOPES.SUPPORT_OP);
    for (const token of ['bad-token', opToken]) assert.equal((await saveEmail(app, token, 'client@example.ca')).statusCode, 401);
    for (const email of [undefined, null, '', 'not-an-email', 25, 'x'.repeat(255) + '@example.ca']) {
      assert.equal((await saveEmail(app, first.token, email)).statusCode, 422);
    }
    const saved = await saveEmail(app, first.token, ' Client@Example.ca ');
    assert.equal(saved.statusCode, 200);
    assert.equal(parse(saved).escalade, true);
    assert.equal(parse(saved).humain, false);
    const after = await f.repo.getSupportThread(first.threadId);
    assert.deepEqual(after.messages, before.messages);
    assert.equal(after.escaladeLe, before.escaladeLe);
    assert.equal(after.courriel, 'client@example.ca');
    assert.equal(port.calls, 0, 'neither explicit handoff nor email update invokes the model');
    assert.equal(f.notices.length, 1, 'saving an address is not another message notification');
    assert.equal(f.replies.length, 0);
    assert.equal((await read(app, first.token)).courriel, 'client@example.ca');
    assert.equal((await read(app, opToken)).courriel, undefined, 'the new visitor field is not added to operator responses');
  });
}

test('exhausted CAS retries return a conflict without a false acceptance or notification', async () => {
  const f = fixture('memory');
  const first = parse(await ask(f.app(), null, 'Première question.'));
  let writes = 0;
  f.repo.putSupportThread = async () => { writes++; return false; };
  const port = { calls: 0, async answer() { this.calls++; return ANSWER; } };
  const response = await ask(f.app(port), first.token, 'Précision alpha ?');
  assert.equal(response.statusCode, 409);
  assert.equal(parse(response).errors[0].code, 'conversation_occupee');
  assert.equal(writes, 8);
  assert.equal(port.calls, 1);
  assert.equal((await f.repo.getSupportThread(first.threadId)).messages.length, 1);
  assert.equal(f.notices.length, 1);
});

test('Dynamo reads support revisions consistently and upgrades legacy items with a conditional write', async () => {
  const table = createFakeTable();
  const repo = createDynamoRepo({ tableName: 'nota-main', doc: table.doc });
  const { PutCommand } = require('@aws-sdk/lib-dynamodb');
  await table.doc.send(new PutCommand({ TableName: 'nota-main', Item: { PK: 'SUPPORT#legacy', SK: 'THREAD', id: 'legacy', messages: [] } }));
  const legacy = await repo.getSupportThread('legacy');
  assert.equal(legacy.supportRevision, undefined);
  const upgraded = await repo.putSupportThread(legacy, { expectedRevision: 0 });
  assert.equal(upgraded.supportRevision, 1);
  assert.equal(await repo.putSupportThread(legacy, { expectedRevision: 0 }), false, 'a stale legacy reader cannot overwrite the upgrade');
  // Use a normal first write to pin both absent-item and stale-revision handling.
  const first = await repo.putSupportThread({ id: 'new', messages: [] }, { expectedRevision: 0 });
  assert.equal(first.supportRevision, 1);
  assert.equal(await repo.putSupportThread({ id: 'new', messages: [] }, { expectedRevision: 0 }), false);
  await repo.getSupportThread('new');
  const reads = table.sent.filter(command => command.name === 'GetCommand');
  assert.equal(reads.at(-1).input.ConsistentRead, true);
});
