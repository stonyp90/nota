import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createDynamoRepo } = require('../src/repo-dynamo.js');

const NOW = '2026-08-12';

function app() {
  let n = 0;
  const repo = createMemoryRepo();
  return { ...createApp(repo, { now: () => NOW, newId: () => 'id-' + ++n }), repo };
}

// Post N valid reservations spread across one future month partition.
async function postN(a, n) {
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const day = String((i % 27) + 1).padStart(2, '0'); // 2026-09-01..27
    const res = await a.handle({
      method: 'POST',
      path: '/bids',
      body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-09-' + day, montant: 2000 + (i % 60) * 10, pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' } }),
    });
    if (res.statusCode === 201) ok++;
  }
  return ok;
}

for (const N of [5, 10, 100, 1000]) {
  test(`scale: ${N} reservations all persist and are returned (no truncation)`, async () => {
    const a = app();
    const created = await postN(a, N);
    assert.equal(created, N, `all ${N} POSTs should return 201`);
    const res = await a.handle({ method: 'GET', path: '/bids', query: { month: '2026-09' } });
    const { bids } = JSON.parse(res.body);
    assert.equal(bids.length, N, `GET should return exactly ${N} bids`);
    // ranking/aggregation must not blow up at scale
    assert.ok(bids.every((b) => b.tier && b.montant >= 2000), 'every bid server-validated');
    // amounts within the refinancement cap (base 2000 -> 3x = 6000)
    assert.ok(bids.every((b) => b.montant <= 6000), 'no bid exceeds the 3x cap');
  });
}

// A month partition can exceed DynamoDB's 1MB page (~2-3k items). This proves
// the production persistence path (repo-dynamo) follows LastEvaluatedKey and
// returns EVERY item across many pages — the bug the audit caught.
function fakeDoc(total, pageSize) {
  return {
    async send(cmd) {
      const start = cmd.input.ExclusiveStartKey ? cmd.input.ExclusiveStartKey.n : 0;
      const items = [];
      for (let i = start; i < Math.min(start + pageSize, total); i++) {
        items.push({
          PK: 'MONTH#2026-09', SK: `BID#2026-09-01#id${i}`, type: 'bid',
          id: 'id' + i, serviceId: 'refinancement', dateISO: '2026-09-01', montant: 1000,
        });
      }
      const next = start + pageSize;
      return { Items: items, LastEvaluatedKey: next < total ? { n: next } : undefined };
    },
  };
}

test('scale: DynamoDB listByMonth paginates 1000 items across 10 pages', async () => {
  const repo = createDynamoRepo({ tableName: 'nota', doc: fakeDoc(1000, 100) });
  const bids = await repo.listByMonth('2026-09');
  assert.equal(bids.length, 1000, 'all 1000 items returned across pages');
  assert.equal(new Set(bids.map((b) => b.id)).size, 1000, 'no duplicates or drops');
  assert.ok(bids.every((b) => b.PK === undefined && b.SK === undefined), 'internal keys stripped');
});

test('scale: DynamoDB listByMonth handles a partition larger than one page boundary (5000)', async () => {
  const repo = createDynamoRepo({ tableName: 'nota', doc: fakeDoc(5000, 100) });
  const bids = await repo.listByMonth('2026-09');
  assert.equal(bids.length, 5000);
});
