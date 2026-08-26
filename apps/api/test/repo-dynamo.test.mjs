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

// --- Durable referral ledger + partner enumeration (ADR 0011) ----------------

test('recordReferralEarning writes a write-once EARN item under the partner partition, indexed on REFEARN', async () => {
  const sent = [];
  const doc = { async send(cmd) { sent.push(cmd); return {}; } };
  const repo = createDynamoRepo({ tableName: 't', doc });

  const first = await repo.recordReferralEarning({ code: 'eve-roy', track: 'client', refId: 'b1', montant: 50, at: '2026-08-12' });
  assert.equal(first, true);
  const input = sent[0].input;
  assert.equal(input.Item.PK, 'PARTNER#EVEROY', 'the earning lives in the partner partition, code NORMALIZED');
  assert.equal(input.Item.SK, 'EARN#CLIENT#b1', 'keyed by track + ref, so the key IS the idempotency');
  assert.equal(input.Item.GSI1PK, 'REFEARN', 'sparse GSI1 overload: all earnings, one Query');
  assert.equal(input.Item.GSI1SK, 'EVEROY#CLIENT#b1');
  assert.equal(input.Item.code, 'EVEROY');
  assert.equal(input.Item.track, 'client');
  assert.equal(input.Item.montant, 50);
  assert.equal(input.ConditionExpression, 'attribute_not_exists(PK)', 'a replay must not double-count');
});

test('recordReferralEarning returns false when the earning already exists (conditional replay)', async () => {
  const doc = {
    async send() {
      const e = new Error('conditional check failed');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    },
  };
  const repo = createDynamoRepo({ tableName: 't', doc });
  assert.equal(await repo.recordReferralEarning({ code: 'EVEROY', track: 'notaire', refId: 'N1', montant: 250, at: '2026-08-12' }), false);
});

test('listReferralEarnings Queries the sparse REFEARN GSI1, paginates, and strips the storage keys', async () => {
  const e1 = {
    PK: 'PARTNER#EVEROY', SK: 'EARN#CLIENT#b1', type: 'refearn',
    GSI1PK: 'REFEARN', GSI1SK: 'EVEROY#CLIENT#b1',
    code: 'EVEROY', track: 'client', refId: 'b1', montant: 50, at: '2026-08-12',
  };
  const e2 = {
    PK: 'PARTNER#MARCQC', SK: 'EARN#NOTAIRE#N1', type: 'refearn',
    GSI1PK: 'REFEARN', GSI1SK: 'MARCQC#NOTAIRE#N1',
    code: 'MARCQC', track: 'notaire', refId: 'N1', montant: 250, at: '2026-08-13',
  };
  const lastKey = { GSI1PK: 'REFEARN', GSI1SK: 'EVEROY#CLIENT#b1' };
  const doc = fakeDoc([
    { Items: [e1], LastEvaluatedKey: lastKey }, // page 1 not the end
    { Items: [e2] }, // page 2 stops
  ]);
  const repo = createDynamoRepo({ tableName: 't', doc });
  const events = await repo.listReferralEarnings();
  assert.deepEqual(events, [
    { code: 'EVEROY', track: 'client', refId: 'b1', montant: 50, at: '2026-08-12' },
    { code: 'MARCQC', track: 'notaire', refId: 'N1', montant: 250, at: '2026-08-13' },
  ]);
  const q = doc.sentInputs[0];
  assert.equal(q.IndexName, 'GSI1');
  assert.equal(q.ExpressionAttributeNames['#g'], 'GSI1PK');
  assert.equal(q.ExpressionAttributeValues[':pk'], 'REFEARN');
  assert.equal(doc.startKeys[0], undefined);
  assert.deepEqual(doc.startKeys[1], lastKey);
});

test('createPartner stamps PARTNER GSI1 attrs so a registered code is enumerable with zero referrals', async () => {
  const sent = [];
  const doc = { async send(cmd) { sent.push(cmd); return {}; } };
  const repo = createDynamoRepo({ tableName: 't', doc });
  await repo.createPartner({ code: 'ZOEQC', type: 'agent_immobilier', courriel: 'zoe@agence.ca', createdAt: '2026-08-12' });
  const item = sent[0].input.Item;
  assert.equal(item.GSI1PK, 'PARTNER');
  assert.equal(item.GSI1SK, 'ZOEQC');
});

test('listPartners Queries GSI1PK=PARTNER, paginates, and strips storage + index attrs', async () => {
  const p1 = {
    PK: 'PARTNER#EVEROY', SK: 'PARTNER', GSI1PK: 'PARTNER', GSI1SK: 'EVEROY',
    code: 'EVEROY', type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', createdAt: '2026-08-01',
  };
  const p2 = {
    PK: 'PARTNER#ZOEQC', SK: 'PARTNER', GSI1PK: 'PARTNER', GSI1SK: 'ZOEQC',
    code: 'ZOEQC', type: 'agent_immobilier', courriel: 'zoe@agence.ca', createdAt: '2026-08-12',
  };
  const lastKey = { GSI1PK: 'PARTNER', GSI1SK: 'EVEROY' };
  const doc = fakeDoc([
    { Items: [p1], LastEvaluatedKey: lastKey },
    { Items: [p2] },
  ]);
  const repo = createDynamoRepo({ tableName: 't', doc });
  const partners = await repo.listPartners();
  assert.deepEqual(partners, [
    { code: 'EVEROY', type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', createdAt: '2026-08-01' },
    { code: 'ZOEQC', type: 'agent_immobilier', courriel: 'zoe@agence.ca', createdAt: '2026-08-12' },
  ]);
  const q = doc.sentInputs[0];
  assert.equal(q.IndexName, 'GSI1');
  assert.equal(q.ExpressionAttributeValues[':pk'], 'PARTNER');
  assert.deepEqual(doc.startKeys[1], lastKey);
});

test('getPartner strips the GSI1 attrs a registered partner item now carries', async () => {
  const doc = {
    async send() {
      return {
        Item: {
          PK: 'PARTNER#EVEROY', SK: 'PARTNER', GSI1PK: 'PARTNER', GSI1SK: 'EVEROY',
          code: 'EVEROY', type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', createdAt: '2026-08-01',
        },
      };
    },
  };
  const repo = createDynamoRepo({ tableName: 't', doc });
  assert.deepEqual(await repo.getPartner('eve-roy'), {
    code: 'EVEROY', type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', createdAt: '2026-08-01',
  });
});

// --- Notary magic-link login (MAIN table, single-use conditional consume) ----

test('putNotaryLoginChallenge writes the challenge to the MAIN table (not the admin one)', async () => {
  const sent = [];
  const doc = { async send(cmd) { sent.push(cmd); return {}; } };
  const repo = createDynamoRepo({ tableName: 'nota-main', doc });
  await repo.putNotaryLoginChallenge({ challengeId: 'c1', notaryId: 'N1', email: 'me@notaire.ca', consumed: false, expiresAt: 9, ttl: 1 });
  const input = sent[0].input;
  assert.equal(input.TableName, 'nota-main');
  assert.equal(input.Item.PK, 'NOTARY_LOGIN#c1');
  assert.equal(input.Item.SK, 'NOTARY_LOGIN');
});

test('consumeNotaryLoginChallenge is a conditional single-use consume: a replay/expiry returns null', async () => {
  const doc = {
    async send() {
      const e = new Error('conditional check failed');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    },
  };
  const repo = createDynamoRepo({ tableName: 'nota-main', doc });
  assert.equal(await repo.consumeNotaryLoginChallenge('c1', 123), null);
});

test('consumeNotaryLoginChallenge returns the record (PK/SK/type stripped) on the winning consume', async () => {
  const sent = [];
  const doc = {
    async send(cmd) {
      sent.push(cmd);
      return { Attributes: { PK: 'NOTARY_LOGIN#c1', SK: 'NOTARY_LOGIN', type: 'notary_login', notaryId: 'N1', email: 'me@notaire.ca', consumed: true } };
    },
  };
  const repo = createDynamoRepo({ tableName: 'nota-main', doc });
  const rec = await repo.consumeNotaryLoginChallenge('c1', 123);
  assert.deepEqual(rec, { notaryId: 'N1', email: 'me@notaire.ca', consumed: true });
  const input = sent[0].input;
  assert.equal(input.TableName, 'nota-main');
  // `consumed` is a reserved word — it MUST be aliased, like the admin consume.
  assert.equal(input.ExpressionAttributeNames['#consumed'], 'consumed');
});

test('incrNotaryRateCounter ADDs on a TTL window on the MAIN table and returns the running count', async () => {
  const sent = [];
  const doc = { async send(cmd) { sent.push(cmd); return { Attributes: { count: 3 } }; } };
  const repo = createDynamoRepo({ tableName: 'nota-main', doc });
  const n = await repo.incrNotaryRateCounter('notary_login', '1.2.3.4', 900, 1_700_000_000_000);
  assert.equal(n, 3);
  const input = sent[0].input;
  assert.equal(input.TableName, 'nota-main');
  assert.equal(input.Key.PK, 'NRL#notary_login#1.2.3.4');
  assert.ok(String(input.UpdateExpression).includes('ADD'));
});

// --- Partner code claim: email verification (ADR 0011 fraud-hardening) --------
// Same conditional single-use consume + TTL design as the notary login, under a
// DISTINCT prefix so a partner claim and a notary challenge never collide.

test('putPartnerClaim writes the claim under the PARTNER_CLAIM# prefix on the MAIN table', async () => {
  const sent = [];
  const doc = { async send(cmd) { sent.push(cmd); return {}; } };
  const repo = createDynamoRepo({ tableName: 'nota-main', doc });
  await repo.putPartnerClaim({ challengeId: 'c1', code: 'EVEROY', type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', consumed: false, expiresAt: 9, ttl: 1 });
  const input = sent[0].input;
  assert.equal(input.TableName, 'nota-main');
  assert.equal(input.Item.PK, 'PARTNER_CLAIM#c1');
  assert.equal(input.Item.SK, 'PARTNER_CLAIM');
  assert.equal(input.Item.code, 'EVEROY');
});

test('consumePartnerClaim is a conditional single-use consume: a replay/expiry returns null', async () => {
  const doc = {
    async send() {
      const e = new Error('conditional check failed');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    },
  };
  const repo = createDynamoRepo({ tableName: 'nota-main', doc });
  assert.equal(await repo.consumePartnerClaim('c1', 123), null);
});

test('consumePartnerClaim returns the record (PK/SK/type stripped) on the winning consume', async () => {
  const sent = [];
  const doc = {
    async send(cmd) {
      sent.push(cmd);
      return { Attributes: { PK: 'PARTNER_CLAIM#c1', SK: 'PARTNER_CLAIM', type: 'partner_claim', code: 'EVEROY', courriel: 'eve@courtage.ca', consumed: true } };
    },
  };
  const repo = createDynamoRepo({ tableName: 'nota-main', doc });
  const rec = await repo.consumePartnerClaim('c1', 123);
  assert.deepEqual(rec, { code: 'EVEROY', courriel: 'eve@courtage.ca', consumed: true });
  const input = sent[0].input;
  assert.equal(input.TableName, 'nota-main');
  // `consumed` is a reserved word — it MUST be aliased, like the notary consume.
  assert.equal(input.ExpressionAttributeNames['#consumed'], 'consumed');
});

test('incrPartnerRateCounter ADDs on a TTL window under the PRL# prefix and returns the running count', async () => {
  const sent = [];
  const doc = { async send(cmd) { sent.push(cmd); return { Attributes: { count: 2 } }; } };
  const repo = createDynamoRepo({ tableName: 'nota-main', doc });
  const n = await repo.incrPartnerRateCounter('partner_claim', '1.2.3.4', 900, 1_700_000_000_000);
  assert.equal(n, 2);
  const input = sent[0].input;
  assert.equal(input.TableName, 'nota-main');
  assert.equal(input.Key.PK, 'PRL#partner_claim#1.2.3.4');
  assert.ok(String(input.UpdateExpression).includes('ADD'));
});
