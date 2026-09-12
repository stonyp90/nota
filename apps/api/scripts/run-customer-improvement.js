'use strict';

// Reads from a real table can incur AWS charges even without writes. Require
// explicit read or apply intent before loading clients or resolving credentials.
const apply = process.argv.includes('--apply');
const readAWS = process.argv.includes('--read-aws');

if (!apply && !readAWS) {
  console.error('No AWS access performed. Use --read-aws for a read-only evaluation (AWS reads may cost money), or --apply to read and update the configured table. For offline tests: npm run test:customer-improvement.');
  process.exitCode = 1;
} else if (!process.env.TABLE_NAME) {
  console.error('TABLE_NAME is required; use the Lambda entry point or configure a DynamoDB table.');
  process.exitCode = 1;
} else {
  const domain = require('@nota/domain');
  const { createDynamoRepo } = require('../src/repo-dynamo');
  const { runCustomerImprovement } = require('../src/customer-improvement');
  const repo = createDynamoRepo({ tableName: process.env.TABLE_NAME, region: process.env.AWS_REGION });
  runCustomerImprovement({
    repo,
    enabled: apply,
    now: () => domain.businessDay(null, process.env.NOTA_TIMEZONE),
  }).then((result) => {
    console.log(JSON.stringify({
      version: result.version,
      day: result.day,
      dryRun: !apply,
      decision: result.decision,
      applied: result.applied,
      auditRecorded: result.auditRecorded,
    }, null, 2));
  }).catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  });
}
