'use strict';

// Archive obsolete open bids without deleting retained acts or their records.
// Dry run by default. Run after deploying the expiry gates:
// TABLE_NAME=nota-main node apps/api/scripts/expire-legacy-offers.js [--apply]
const domain = require('@nota/domain');
const { ScanCommand, UpdateCommand, DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

async function expireLegacyOffers({ doc, table, todayISO, apply = false }) {
  let cursor;
  const result = { candidates: 0, archived: 0, raced: 0, apply };
  do {
    const page = await doc.send(new ScanCommand({
      TableName: table, ExclusiveStartKey: cursor,
      FilterExpression: '#type = :bid',
      ExpressionAttributeNames: { '#type': 'type' }, ExpressionAttributeValues: { ':bid': 'bid' },
    }));
    for (const bid of page.Items || []) {
      if (!domain.isOfferExpired(bid, todayISO)) continue;
      result.candidates++;
      if (!apply) continue;
      try {
        // Match the observed expiry and status: a concurrent retain or edit wins.
        const names = { '#s': 'status', '#e': 'expiresOn', '#d': 'dateISO' };
        const values = { ':cancelled': domain.STATUS.ANNULEE, ':today': todayISO, ':reason': 'expiration', ':date': bid.dateISO };
        const conditions = ['attribute_exists(PK)', '#d = :date'];
        for (const [field, alias] of [['status', '#s'], ['expiresOn', '#e']]) {
          if (bid[field] === undefined) conditions.push(`attribute_not_exists(${alias})`);
          else { conditions.push(`${alias} = :${field}`); values[`:${field}`] = bid[field]; }
        }
        await doc.send(new UpdateCommand({
          TableName: table, Key: { PK: bid.PK, SK: bid.SK },
          UpdateExpression: 'SET #s = :cancelled, cancelledAt = :today, closureReason = :reason REMOVE GSI1PK, GSI1SK',
          ConditionExpression: conditions.join(' AND '),
          ExpressionAttributeNames: names, ExpressionAttributeValues: values,
        }));
        result.archived++;
      } catch (error) {
        if (error.name !== 'ConditionalCheckFailedException') throw error;
        result.raced++;
      }
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return result;
}

if (require.main === module) {
  const table = process.env.TABLE_NAME;
  if (!table) throw new Error('TABLE_NAME is required');
  const endpoint = process.env.DYNAMO_ENDPOINT;
  const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ca-central-1',
    ...(endpoint ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}) });
  const doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  expireLegacyOffers({ doc, table, todayISO: domain.businessDay(), apply: process.argv.includes('--apply') })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { expireLegacyOffers };
