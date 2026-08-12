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
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    })
  );
  console.log(`Created table "${TableName}" at ${endpoint}.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
