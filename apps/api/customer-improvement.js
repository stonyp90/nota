'use strict';

/**
 * EventBridge Scheduler entry point for Nota's bounded autonomous customer
 * improvement loop. The worker has no model credential and no write port for
 * legal, pricing or AI configuration; it only evaluates the public guidance
 * policy in `src/customer-improvement.js`.
 */
const domain = require('@nota/domain');
const { createDynamoRepo } = require('./src/repo-dynamo');
const { runCustomerImprovement } = require('./src/customer-improvement');

function enabledFromEnvironment() {
  return !['false', '0', 'off'].includes(String(process.env.NOTA_AUTONOMOUS_IMPROVEMENT_ENABLED || 'true').trim().toLowerCase());
}

exports.handler = async () => {
  const repo = createDynamoRepo({
    tableName: process.env.TABLE_NAME,
    region: process.env.AWS_REGION,
  });
  const result = await runCustomerImprovement({
    repo,
    enabled: enabledFromEnvironment(),
    now: () => domain.businessDay(null, process.env.NOTA_TIMEZONE),
  });
  // The report contains aggregate counters and a bounded decision only. Never
  // log audit rows, customer text or document metadata from this worker.
  console.log('customer-improvement:', JSON.stringify({
    version: result.version,
    day: result.day,
    decision: result.decision,
    applied: result.applied,
    auditRecorded: result.auditRecorded,
  }));
  return result;
};
