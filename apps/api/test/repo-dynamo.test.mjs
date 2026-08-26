import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDynamoRepo } = require('../src/repo-dynamo.js');

// A fake DynamoDBDocumentClient: returns the queued pages in order and records
// the ExclusiveStartKey each QueryCommand carried, so we can assert the repo
// threads LastEvaluatedKey -> ExclusiveStartKey across pages. No AWS involved.
function fakeDoc(pages) {
  const startKeys = [];
  const sentInputs = [];
  let call = 0;
  return {
    startKeys,
    sentInputs,
    calls: () => call,
    async send(cmd) {
      startKeys.push(cmd.input.ExclusiveStartKey);
      sentInputs.push(cmd.input);
      return pages[call++];
    },
  };
}

test('listByMonth follows LastEvaluatedKey until the partition is exhausted', async () => {
  const item1 = { PK: 'MONTH#2026-08', SK: 'BID#2026-08-01#a', type: 'bid', id: 'a', dateISO: '2026-08-01', montant: 500 };
  const item2 = { PK: 'MONTH#2026-08', SK: 'BID#2026-08-02#b', type: 'bid', id: 'b', dateISO: '2026-08-02', montant: 600 };
  const lastKey = { PK: 'MONTH#2026-08', SK: 'BID#2026-08-01#a' };
  const doc = fakeDoc([
    { Items: [item1], LastEvaluatedKey: lastKey }, // page 1 is not the end
    { Items: [item2] }, // page 2, no LastEvaluatedKey -> stop
  ]);

  const repo = createDynamoRepo({ tableName: 't', doc });
  const bids = await repo.listByMonth('2026-08');

  // Both pages accumulated, PK/SK/type stripped by fromItem.
  assert.equal(doc.calls(), 2);
  assert.deepEqual(bids, [
    { id: 'a', dateISO: '2026-08-01', montant: 500 },
    { id: 'b', dateISO: '2026-08-02', montant: 600 },
  ]);
  // First query has no start key; second resumes from page 1's LastEvaluatedKey.
  assert.equal(doc.startKeys[0], undefined);
  assert.deepEqual(doc.startKeys[1], lastKey);
});

test('listByMonth returns [] for an empty partition', async () => {
  const doc = fakeDoc([{ Items: [] }]);
  const repo = createDynamoRepo({ tableName: 't', doc });
  assert.deepEqual(await repo.listByMonth('2026-01'), []);
  assert.equal(doc.calls(), 1);
});

// --- Fix 4: conditional retain (TOCTOU) -------------------------------------

test('retain writes with an "ouverte" ConditionExpression and returns the bid on success', async () => {
  const sent = [];
  const doc = { async send(cmd) { sent.push(cmd); return {}; } };
  const repo = createDynamoRepo({ tableName: 't', doc });
  const bid = { id: 'a', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 800, status: 'retenue', notaryId: 'N1' };

  const out = await repo.retain(bid, 'N1');
  assert.equal(out, bid);
  const input = sent[0].input;
  assert.equal(input.ConditionExpression, '#s = :ouverte');
  assert.equal(input.ExpressionAttributeNames['#s'], 'status');
  assert.equal(input.ExpressionAttributeValues[':ouverte'], 'ouverte');
});

test('retain returns null when the conditional check fails (lost TOCTOU race)', async () => {
  const doc = {
    async send() {
      const e = new Error('conditional check failed');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    },
  };
  const repo = createDynamoRepo({ tableName: 't', doc });
  assert.equal(await repo.retain({ id: 'a', dateISO: '2026-08-20', status: 'retenue' }, 'N1'), null);
});

test('retain rethrows a non-conditional error', async () => {
  const doc = {
    async send() {
      const e = new Error('boom');
      e.name = 'ProvisionedThroughputExceededException';
      throw e;
    },
  };
  const repo = createDynamoRepo({ tableName: 't', doc });
  await assert.rejects(() => repo.retain({ id: 'a', dateISO: '2026-08-20' }, 'N1'), /boom/);
});

// --- Sparse GSI1 open-bid index (reminder enumeration, no Scan) --------------

test('put stamps GSI1 attributes on an OPEN bid so it joins the sparse index', async () => {
  const sent = [];
  const doc = { async send(cmd) { sent.push(cmd); return {}; } };
  const repo = createDynamoRepo({ tableName: 't', doc });

  await repo.put({ id: 'a', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 800, status: 'ouverte' });

  const item = sent[0].input.Item;
  assert.equal(item.GSI1PK, 'OPENBID');
  assert.equal(item.GSI1SK, '2026-08-20#a', 'sorted by signing date then id');
});

test('a RETAINED bid carries NO GSI1 attributes, so it drops out of the index', async () => {
  const sent = [];
  const doc = { async send(cmd) { sent.push(cmd); return {}; } };
  const repo = createDynamoRepo({ tableName: 't', doc });

  await repo.retain({ id: 'a', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 800, status: 'retenue' }, 'N1');

  const item = sent[0].input.Item;
  assert.equal('GSI1PK' in item, false, 'retained bids are not indexed');
  assert.equal('GSI1SK' in item, false);
});

test('listOpenBids Queries the sparse GSI1, paginates, and strips index attrs', async () => {
  const openA = {
    PK: 'MONTH#2026-08', SK: 'BID#2026-08-01#a', type: 'bid',
    GSI1PK: 'OPENBID', GSI1SK: '2026-08-01#a',
    id: 'a', dateISO: '2026-08-01', montant: 500, status: 'ouverte',
  };
  const openB = {
    PK: 'MONTH#2026-09', SK: 'BID#2026-09-02#b', type: 'bid',
    GSI1PK: 'OPENBID', GSI1SK: '2026-09-02#b',
    id: 'b', dateISO: '2026-09-02', montant: 600, status: 'ouverte',
  };
  const lastKey = { GSI1PK: 'OPENBID', GSI1SK: '2026-08-01#a' };
  const doc = fakeDoc([
    { Items: [openA], LastEvaluatedKey: lastKey }, // page 1 not the end
    { Items: [openB] }, // page 2 stops
  ]);

  const repo = createDynamoRepo({ tableName: 't', doc });
  const bids = await repo.listOpenBids();

  // Both pages accumulated; PK/SK/type AND GSI1PK/GSI1SK stripped by fromItem.
  assert.deepEqual(bids, [
    { id: 'a', dateISO: '2026-08-01', montant: 500, status: 'ouverte' },
    { id: 'b', dateISO: '2026-09-02', montant: 600, status: 'ouverte' },
  ]);
  // It reads the index, not the base table, keyed on the OPENBID partition.
  const q = doc.sentInputs ? doc.sentInputs[0] : null;
  assert.ok(q, 'query input captured');
  assert.equal(q.IndexName, 'GSI1');
  assert.equal(q.KeyConditionExpression, '#g = :open');
  assert.equal(q.ExpressionAttributeNames['#g'], 'GSI1PK');
  assert.equal(q.ExpressionAttributeValues[':open'], 'OPENBID');
  // Pagination threads LastEvaluatedKey -> ExclusiveStartKey.
  assert.equal(doc.startKeys[0], undefined);
  assert.deepEqual(doc.startKeys[1], lastKey);
});
