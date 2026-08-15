import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDynamoRepo } = require('../src/repo-dynamo.js');

/**
 * These tests drive the DynamoDB adapter against a RECORDING fake document
 * client and assert the *shape* of the commands it emits — specifically that
 * every attribute referenced inside an UpdateExpression/ConditionExpression is
 * ALIASED via ExpressionAttributeNames. Reserved-word collisions (e.g. the
 * `consumed` bug) throw ValidationException only on real DynamoDB, so the
 * memory-repo suite can never catch them; this closes that parity gap.
 */
function recordingRepo(reply) {
  const sent = [];
  const doc = {
    async send(cmd) {
      const rec = { name: cmd.constructor.name, input: cmd.input };
      sent.push(rec);
      return reply ? reply(rec) : {};
    },
  };
  return { repo: createDynamoRepo({ tableName: 'main', adminTableName: 'admin', doc }), sent };
}

test('consumeLoginChallenge aliases the reserved word `consumed` (would 500 every login otherwise)', async () => {
  const { repo, sent } = recordingRepo(() => ({ Attributes: { PK: 'LOGIN#x', SK: 'LOGIN', email: 'a@b.ca', consumed: true } }));
  await repo.consumeLoginChallenge('x', 1000);
  const upd = sent.find((s) => s.name === 'UpdateCommand');
  assert.ok(upd, 'emits an UpdateCommand');
  assert.equal(upd.input.ExpressionAttributeNames['#consumed'], 'consumed');
  assert.doesNotMatch(upd.input.UpdateExpression, /(^|[^#\w])consumed\b/);
  assert.doesNotMatch(upd.input.ConditionExpression, /(^|[^#\w])consumed\b/);
});

test('incrRateCounter aliases the reserved words `count` and `ttl`', async () => {
  const { repo, sent } = recordingRepo(() => ({ Attributes: { count: 3 } }));
  const n = await repo.incrRateCounter('login', 'k', 900, 1_000_000);
  const upd = sent.find((s) => s.name === 'UpdateCommand');
  assert.equal(upd.input.ExpressionAttributeNames['#c'], 'count');
  assert.equal(upd.input.ExpressionAttributeNames['#ttl'], 'ttl');
  assert.equal(n, 3);
});

test('applyStatsDeltas emits an aliased atomic ADD (never a bare counter name)', async () => {
  const { repo, sent } = recordingRepo();
  await repo.applyStatsDeltas([{ pk: 'STATS#GLOBAL', sk: 'D#2026-08-14', adds: { offers: 1 } }]);
  const upd = sent.find((s) => s.name === 'UpdateCommand');
  assert.match(upd.input.UpdateExpression, /^ADD #a0 :a0$/);
  assert.equal(upd.input.ExpressionAttributeNames['#a0'], 'offers');
  assert.equal(upd.input.ExpressionAttributeValues[':a0'], 1);
});

test('admin session touch + revoke alias every attribute they write', async () => {
  const { repo, sent } = recordingRepo();
  await repo.touchAdminSession('s', 123, 999);
  await repo.revokeAdminSession('s', 'now');
  const [touch, revoke] = sent.filter((s) => s.name === 'UpdateCommand');
  assert.equal(touch.input.ExpressionAttributeNames['#lastSeenAt'], 'lastSeenAt');
  assert.equal(touch.input.ExpressionAttributeNames['#absoluteExpiresAt'], 'absoluteExpiresAt');
  assert.equal(revoke.input.ExpressionAttributeNames['#revokedAt'], 'revokedAt');
});

test('the admin methods refuse to run without an admin table configured', async () => {
  const doc = { async send() { return {}; } };
  const repo = createDynamoRepo({ tableName: 'main', doc }); // no adminTableName
  await assert.rejects(() => repo.getAdmin('x'), /admin table not configured/);
});
