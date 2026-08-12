'use strict';

const {
  bidPK,
  bidSK,
  monthPK,
  notaryPK,
  NOTARY_SK,
  eventPK,
  EVENT_SK,
  sentPK,
  SENT_SK,
  unsubPK,
  UNSUB_SK,
} = require('./keys');
const { STATUS } = require('@nota/domain');

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
function createDynamoRepo({ tableName, endpoint, region, doc } = {}) {
  if (!tableName) throw new Error('createDynamoRepo: tableName is required');

  // Lazy import keeps the SDK out of the dependency graph for tests. The command
  // classes are always needed; the concrete client is built only when the caller
  // did not inject its own document client.
  const { PutCommand, GetCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

  // `doc` is injectable so a test can drive the paginating reads (listByMonth /
  // scanOpenBids) against a fake document client with no AWS. Production omits it
  // and we construct the real client here.
  if (!doc) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    const base = new DynamoDBClient({
      ...(region ? { region } : {}),
      ...(endpoint ? { endpoint } : {}),
    });
    doc = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

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
      // A month partition can exceed DynamoDB's 1MB page, so follow
      // LastEvaluatedKey to exhaustion — same contract as scanOpenBids and the
      // memory adapter, which both return every matching item.
      const bids = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :b)',
            ExpressionAttributeValues: { ':pk': monthPK(month), ':b': 'BID#' },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((i) => bids.push(fromItem(i)));
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return bids;
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

    // Every open (not-retained) bid, across all month partitions. Used only by
    // the daily reminder scheduler (a bounded, low-frequency scan). The filter
    // keeps retained bids out; the domain decides which of the rest are due.
    async scanOpenBids() {
      const bids = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new ScanCommand({
            TableName: tableName,
            FilterExpression: '#t = :bid AND #s <> :retenue',
            ExpressionAttributeNames: { '#t': 'type', '#s': 'status' },
            ExpressionAttributeValues: { ':bid': 'bid', ':retenue': STATUS.RETENUE },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((i) => bids.push(fromItem(i)));
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return bids;
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

    // --- Notifications (idempotency + unsubscribe suppression) --------------
    async markNotificationSent(refId, kind, at) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: sentPK(refId, kind), SK: SENT_SK, type: 'sent', refId, kind, sentAt: at },
        })
      );
    },
    async wasNotificationSent(refId, kind) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: sentPK(refId, kind), SK: SENT_SK } })
      );
      return !!out.Item;
    },
    async putUnsubscribe(email, at) {
      const clean = String(email).trim().toLowerCase();
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: unsubPK(clean), SK: UNSUB_SK, type: 'unsub', email: clean, unsubscribedAt: at },
        })
      );
    },
    async isUnsubscribed(email) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: unsubPK(email), SK: UNSUB_SK } })
      );
      return !!out.Item;
    },
  };
}

module.exports = { createDynamoRepo };
