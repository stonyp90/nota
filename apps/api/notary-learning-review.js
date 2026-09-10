'use strict';

// Weekly EventBridge entry point. It intentionally has no model credentials;
// the report is a queue for an approved offline evaluation/export process.
const domain = require('@nota/domain');
const { createDynamoRepo } = require('./src/repo-dynamo');
const { runNotaryLearningReview } = require('./src/notary-learning-review');

exports.handler = async () => {
  const repo = createDynamoRepo({ tableName: process.env.TABLE_NAME, region: process.env.AWS_REGION });
  const result = await runNotaryLearningReview({
    repo,
    now: () => domain.businessDay(null, process.env.NOTA_TIMEZONE),
  });
  console.log('notary-learning-review:', JSON.stringify({
    version: result.version,
    day: result.day,
    eventCount: result.eventCount,
    eventCounts: result.eventCounts,
    reviewedProposals: result.reviewedProposals,
    truncated: result.truncated,
    training: result.training,
  }));
  return result;
};
