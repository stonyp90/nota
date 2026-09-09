'use strict';

// Local/operator entry point for the same bounded worker used by Lambda. It is
// dry-run by default so a developer can inspect the decision without changing
// production; pass --apply only when TABLE_NAME points at the intended table.
const domain = require('@nota/domain');
const { createDynamoRepo } = require('../src/repo-dynamo');
const { runCustomerImprovement } = require('../src/customer-improvement');

if (!process.env.TABLE_NAME) {
  console.error('TABLE_NAME is required; use the Lambda entry point or configure a DynamoDB table.');
  process.exitCode = 1;
} else {
  const apply = process.argv.includes('--apply');
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
