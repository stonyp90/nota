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
  let call = 0;
  return {
    startKeys,
    calls: () => call,
    async send(cmd) {
      startKeys.push(cmd.input.ExclusiveStartKey);
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
  const bid = { id: 'a', dateISO: '2026-08-20', serviceId: 'testament', montant: 800, status: 'retenue', notaryId: 'N1' };

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
