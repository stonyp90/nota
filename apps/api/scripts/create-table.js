'use strict';

/**
 * Creates the single Nota table in DynamoDB Local for development. Idempotent.
 * Run by docker-compose (the `dynamo-init` service) and available manually:
 *   TABLE_NAME=nota DYNAMO_ENDPOINT=http://localhost:8000 node scripts/create-table.js
 */
const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} = require('@aws-sdk/client-dynamodb');

const TableName = process.env.TABLE_NAME || 'nota';
const endpoint = process.env.DYNAMO_ENDPOINT || 'http://localhost:8000';
const region = process.env.AWS_REGION || 'ca-central-1';

const client = new DynamoDBClient({
  endpoint,
  region,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

(async () => {
  try {
    await client.send(new DescribeTableCommand({ TableName }));
    console.log(`Table "${TableName}" already exists.`);
    return;
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
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
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
