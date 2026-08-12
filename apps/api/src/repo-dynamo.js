'use strict';

const { bidPK, bidSK, monthPK, notaryPK, NOTARY_SK, eventPK, EVENT_SK } = require('./keys');

/**
 * DynamoDB implementation of the Repo port.
 *
 * The AWS SDK is required lazily so the test suite and the domain package never
 * need it installed — only the code path that actually talks to DynamoDB pulls
 * it in. This is the one justified runtime dependency in apps/api.
 *
 * `endpoint` lets the local dev server point at DynamoDB Local (docker-compose);
 * in Lambda it is omitted and the SDK resolves the regional endpoint.
 */
function createDynamoRepo({ tableName, endpoint, region } = {}) {
  if (!tableName) throw new Error('createDynamoRepo: tableName is required');

  // Lazy import keeps the SDK out of the dependency graph for tests.
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

  const base = new DynamoDBClient({
    ...(region ? { region } : {}),
    ...(endpoint ? { endpoint } : {}),
  });
  const doc = DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });

  function toItem(bid) {
    return { PK: bidPK(bid.dateISO), SK: bidSK(bid), type: 'bid', ...bid };
  }
  function fromItem(item) {
    if (!item) return null;
    const { PK, SK, type, ...bid } = item;
    return bid;
  }

  return {
    async listByMonth(month) {
      const out = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :b)',
          ExpressionAttributeValues: { ':pk': monthPK(month), ':b': 'BID#' },
        })
      );
      return (out.Items || []).map(fromItem);
    },
    async get(id, dateISO) {
      if (!dateISO) throw new Error('dynamo get requires dateISO for the key');
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: bidPK(dateISO), SK: `BID#${dateISO}#${id}` } })
      );
      return fromItem(out.Item);
    },
    async put(bid) {
      await doc.send(new PutCommand({ TableName: tableName, Item: toItem(bid) }));
      return bid;
    },

    // --- Billing (notary subscriptions + webhook idempotency) ---------------
    // Same single table, distinct key prefixes (see keys.js). Only GetItem and
    // PutItem are used, so the least-privilege IAM policy is unchanged.
    async putNotary(notary) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: notaryPK(notary.id), SK: NOTARY_SK, type: 'notary', ...notary },
        })
      );
      return notary;
    },
    async getNotary(id) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: notaryPK(id), SK: NOTARY_SK } })
      );
      if (!out.Item) return null;
      const { PK, SK, type, ...notary } = out.Item;
      return notary;
    },
    async markEventProcessed(stripeEventId, at) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: eventPK(stripeEventId), SK: EVENT_SK, type: 'event', stripeEventId, processedAt: at },
        })
      );
    },
    async wasEventProcessed(stripeEventId) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: eventPK(stripeEventId), SK: EVENT_SK } })
      );
      return !!out.Item;
    },
  };
}

module.exports = { createDynamoRepo };
