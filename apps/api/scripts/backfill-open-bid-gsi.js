'use strict';

/**
 * ONE-TIME migration: backfill the sparse GSI1 open-bid index.
 *
 * WHY: the daily reminder worker used to Scan the whole table for open bids. It
 * now Queries a sparse GSI1 (GSI1PK = "OPENBID") instead — but only bids WRITTEN
 * after the code rolled out carry the GSI1 attributes. Open bids that were
 * already sitting in the table are invisible to the Query until they are next
 * written (which for a quiet open bid may be never). This script stamps the
 * GSI1 attributes onto every existing open (not-retained) bid so the backlog
 * shows up in the index too.
 *
 * WHEN: run once, right after `terraform apply` creates the GSI1 index AND the
 * new Lambda code is deployed. Idempotent — safe to re-run (it only ever SETs
 * the two attributes to their canonical values).
 *
 * PERMISSIONS: needs dynamodb:Scan + dynamodb:UpdateItem on the table. The
 * reminder Lambda role deliberately has NEITHER Scan nor the index-less write it
 * would need for a full sweep, so run this with an operator/deploy credential,
 * not the reminder role.
 *
 *   TABLE_NAME=nota-main AWS_REGION=ca-central-1 node scripts/backfill-open-bid-gsi.js
 *   # dry run (report what WOULD change, write nothing):
 *   DRY_RUN=1 TABLE_NAME=nota-main node scripts/backfill-open-bid-gsi.js
 *   # against DynamoDB Local:
 *   TABLE_NAME=nota DYNAMO_ENDPOINT=http://localhost:8000 node scripts/backfill-open-bid-gsi.js
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { STATUS } = require('@nota/domain');
const { GSI1_PK, GSI1_SK, OPENBID_GSI1PK, openBidGSI1SK } = require('../src/keys');

const TableName = process.env.TABLE_NAME;
const region = process.env.AWS_REGION || 'ca-central-1';
const endpoint = process.env.DYNAMO_ENDPOINT || undefined;
const dryRun = !!process.env.DRY_RUN;

if (!TableName) {
  console.error('TABLE_NAME is required.');
  process.exit(2);
}

const base = new DynamoDBClient({
  region,
  ...(endpoint ? { endpoint } : {}),
  // DynamoDB Local accepts any credentials; real AWS uses the ambient chain.
  ...(endpoint ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
});
const doc = DynamoDBDocumentClient.from(base, { marshallOptions: { removeUndefinedValues: true } });

(async () => {
  let scanned = 0;
  let open = 0;
  let updated = 0;
  let alreadyIndexed = 0;
  let ExclusiveStartKey;

  do {
    const out = await doc.send(
      new ScanCommand({
        TableName,
        // Only open bids: type = bid AND status <> retenue. (Filter is applied
        // after the read — that Scan cost is exactly what this migration exists
        // to stop paying DAILY; here we pay it ONCE.)
        FilterExpression: '#t = :bid AND #s <> :retenue',
        ExpressionAttributeNames: { '#t': 'type', '#s': 'status' },
        ExpressionAttributeValues: { ':bid': 'bid', ':retenue': STATUS.RETENUE },
        ExclusiveStartKey,
      })
    );

    for (const item of out.Items || []) {
      open += 1;
      const want = { pk: OPENBID_GSI1PK, sk: openBidGSI1SK({ dateISO: item.dateISO, id: item.id }) };
      if (item[GSI1_PK] === want.pk && item[GSI1_SK] === want.sk) {
        alreadyIndexed += 1;
        continue;
      }
      if (dryRun) {
        updated += 1;
        continue;
      }
      await doc.send(
        new UpdateCommand({
          TableName,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: 'SET #gpk = :pk, #gsk = :sk',
          ExpressionAttributeNames: { '#gpk': GSI1_PK, '#gsk': GSI1_SK },
          ExpressionAttributeValues: { ':pk': want.pk, ':sk': want.sk },
        })
      );
      updated += 1;
    }

    scanned += (out.Items || []).length;
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  console.log(
    JSON.stringify({ table: TableName, dryRun, scanned, openBids: open, alreadyIndexed, updated })
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
