'use strict';

/**
 * Creates the Nota tables in DynamoDB Local for development. Idempotent.
 * Run by docker-compose (the `dynamo-init` service) and available manually:
 *   npm run local:tables
 *   TABLE_NAME=nota ADMIN_TABLE_NAME=nota-admin \
 *   DYNAMO_ENDPOINT=http://localhost:8000 node scripts/create-table.js
 *
 * It creates tables and NOTHING ELSE — no PutItem, by design. Filling them with
 * the demo world is `scripts/seed.js` (`npm run local:seed`, or the compose
 * `seed` service), which the two APIs wait for. Splitting the two was not
 * always obvious: for a while this script was the whole docker "setup", so a
 * cold start produced an empty carnet and an empty admin console.
 *
 * Two tables, mirroring production (infra/dynamodb.tf + infra/admin.tf):
 *   - TABLE_NAME        — the single main table (bids, notaries, stats) with
 *                         the sparse GSI1 over open bids.
 *   - ADMIN_TABLE_NAME  — the separate admin table (identities, single-use
 *                         login challenges, sessions, audit) with TTL on `ttl`.
 *                         Optional: skipped when the variable is unset.
 */
const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
} = require('@aws-sdk/client-dynamodb');

const TableName = process.env.TABLE_NAME || 'nota';
const AdminTableName = process.env.ADMIN_TABLE_NAME || '';
const endpoint = process.env.DYNAMO_ENDPOINT || 'http://localhost:8000';
const region = process.env.AWS_REGION || 'ca-central-1';

const client = new DynamoDBClient({
  endpoint,
  region,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

async function exists(name) {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
    return false;
  }
}

async function createMainTable() {
  if (await exists(TableName)) {
    console.log(`Table "${TableName}" already exists.`);
    return;
  }
  await client.send(
    new CreateTableCommand({
      TableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        // Sparse GSI1 keys (open-bid enumeration for the reminder worker).
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      // Mirror infra/dynamodb.tf so local dev matches production: a sparse GSI1
      // over open bids, projecting the full item (ALL) for the reminder Query.
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    })
  );
  console.log(`Created table "${TableName}" at ${endpoint}.`);
}

async function createAdminTable() {
  if (!AdminTableName) return;
  if (await exists(AdminTableName)) {
    console.log(`Table "${AdminTableName}" already exists.`);
    return;
  }
  await client.send(
    new CreateTableCommand({
      TableName: AdminTableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    })
  );
  // Expired challenges/sessions reap themselves, exactly like infra/admin.tf.
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: AdminTableName,
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    })
  );
  console.log(`Created table "${AdminTableName}" (TTL on "ttl") at ${endpoint}.`);
}

(async () => {
  await createMainTable();
  await createAdminTable();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
