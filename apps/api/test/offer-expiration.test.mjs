import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler');
const { createMemoryRepo } = require('../src/repo-memory');
const { signToken, SCOPES } = require('../src/notary-auth');
const { runReminders } = require('../src/reminders');
const { expireLegacyOffers } = require('../scripts/expire-legacy-offers');
const NOW = Date.parse('2026-09-09T16:00:00Z');
const base = { id: 'b', dateISO: '2026-09-30', status: 'ouverte', serviceId: 'refinancement', montant: 2500 };

test('server stamps deadline and ignores a caller-supplied extension', async () => {
  const repo = createMemoryRepo();
  const app = createApp(repo, { now: () => '2026-09-09' });
  const res = await app.handle({ method: 'POST', path: '/bids', body: {
    ...base, prefixe: 'G1R', expiresOn: '2099-01-01',
    pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
  } });
  assert.equal(res.statusCode, 201, res.body);
  const { bid } = JSON.parse(res.body);
  assert.equal(bid.expiresOn, '2026-09-16');
  assert.equal((await repo.get(bid.id)).expiresOn, bid.expiresOn);
});

test('legacy and expired offers leave public listings and cannot be accepted or negotiated', async () => {
  for (const expiresOn of [undefined, 'bad', '2026-09-08']) {
    const repo = createMemoryRepo([{ ...base, expiresOn }]);
    const app = createApp(repo, { now: () => '2026-09-09', nowMs: () => NOW });
    const listed = await app.handle({ method: 'GET', path: '/bids', query: { month: '2026-09' } });
    assert.deepEqual(JSON.parse(listed.body).bids, []);
    for (const path of ['/notary/bids/accept', '/notary/bids/propose', '/notary/bids/documents', '/client/propositions/accept']) {
      const client = path.startsWith('/client');
      const token = signToken(client ? 'b' : 'n', NOW + 60000, client ? SCOPES.CLIENT : SCOPES.SESSION);
      const res = await app.handle({ method: 'POST', path, headers: { authorization: 'Bearer ' + token }, body: { id: 'b', dateISO: base.dateISO } });
      assert.equal(res.statusCode, 410, path + ': ' + res.body);
      assert.equal(JSON.parse(res.body).errors[0].code, 'offre_expiree');
    }
    assert.equal((await repo.get('b')).status, 'ouverte');
  }
});

test('deadline day is available, the next day is hidden; retained acts remain visible', async () => {
  const repo = createMemoryRepo([{ ...base, expiresOn: '2026-09-16' }, { ...base, id: 'retained', status: 'retenue' }]);
  let today = '2026-09-16';
  const app = createApp(repo, { now: () => today });
  const list = async () => JSON.parse((await app.handle({ method: 'GET', path: '/bids', query: { month: '2026-09' } })).body).bids;
  assert.equal((await list()).length, 2);
  today = '2026-09-17';
  assert.deepEqual((await list()).map(b => b.id), ['retained']);
});

test('expired and undated offers trigger neither reminders, digests nor caution placement', async () => {
  const repo = createMemoryRepo([{ ...base, dateISO: '2026-09-10', createdAt: '2026-09-08' }, { ...base, id: 'expired', expiresOn: '2026-09-08' }]);
  await repo.putNotary({ id: 'n', email: 'n@example.ca', status: 'active' });
  let calls = 0;
  const result = await runReminders({ repo, now: () => '2026-09-09',
    notifier: { onReminderDue: async () => { calls++; }, onNotaryDigest: async () => { calls++; } },
    billing: { attendCaution: () => true, placeCaution: async () => { calls++; } },
  });
  assert.equal(calls, 0);
  assert.equal(result.sent, 0);
});

test('cleanup paginates, skips retained/live bids and conditionally archives only obsolete offers', async () => {
  const writes = [];
  let scans = 0;
  const doc = { send: async cmd => {
    if (cmd.constructor.name === 'ScanCommand') {
      scans++;
      return scans === 1 ? { Items: [{ ...base, PK: 'M', SK: '1' }, { ...base, status: 'retenue' }], LastEvaluatedKey: { PK: 'M', SK: '1' } }
        : { Items: [{ ...base, PK: 'M', SK: '2', expiresOn: '2026-09-08' }, { ...base, expiresOn: '2026-09-10' }] };
    }
    writes.push(cmd.input);
    if (writes.length === 2) throw Object.assign(new Error('concurrent retain'), { name: 'ConditionalCheckFailedException' });
    return {};
  } };
  assert.deepEqual(await expireLegacyOffers({ doc, table: 't', todayISO: '2026-09-09', apply: true }), { candidates: 2, archived: 1, raced: 1, apply: true });
  assert.match(writes[0].ConditionExpression, /#s = :status/);
  assert.match(writes[0].ConditionExpression, /attribute_not_exists\(#e\)/);
  assert.match(writes[0].UpdateExpression, /REMOVE GSI1PK, GSI1SK/);
  scans = 0; writes.length = 0;
  const dry = await expireLegacyOffers({ doc, table: 't', todayISO: '2026-09-09' });
  assert.equal(dry.candidates, 2);
  assert.equal(writes.length, 0);
});

test('conditional retention checks the stored deadline, including a concurrent expiry change', async () => {
  const repo = createMemoryRepo([{ ...base, expiresOn: '2026-09-08' }]);
  assert.equal(await repo.retain({ ...base, status: 'retenue', expiresOn: '2026-09-16' }, 'n', '2026-09-09'), null);
  assert.equal((await repo.get('b')).status, 'ouverte');
  const { createDynamoRepo } = require('../src/repo-dynamo');
  let transaction;
  const dynamo = createDynamoRepo({ tableName: 't', doc: { send: async cmd => { transaction = cmd.input; return {}; } } });
  await dynamo.retain({ ...base, status: 'retenue', expiresOn: '2026-09-16' }, 'n', '2026-09-09');
  const put = transaction.TransactItems[0].Put;
  assert.match(put.ConditionExpression, /#expiry = :expiry/);
  assert.match(put.ConditionExpression, /#expiry >= :today/);
  assert.equal(put.ExpressionAttributeValues[':today'], '2026-09-09');
});
