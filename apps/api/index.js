'use strict';

/**
 * Lambda function URL entry point. Adapts the payload-format-2.0 event to the
 * transport-agnostic request shape and wires the DynamoDB repo. Table name and
 * region come from the environment set by Terraform.
 */
const { createApp } = require('./src/handler');
const { createDynamoRepo } = require('./src/repo-dynamo');

const repo = createDynamoRepo({
  tableName: process.env.TABLE_NAME,
  region: process.env.AWS_REGION,
});
const app = createApp(repo);

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method || 'GET';
  const path = event?.rawPath || '/';
  const query = event?.queryStringParameters || {};
  const headers = event?.headers || {};
  // The platform-supplied source IP (unspoofable) — used to rate-limit notary
  // sign-in requests. NOT read from a client-controlled header.
  const sourceIp = event?.requestContext?.http?.sourceIp;
  let body = event?.body || '';
  if (event?.isBase64Encoded && body) body = Buffer.from(body, 'base64').toString('utf8');

  const res = await app.handle({ method, path, query, headers, body, sourceIp });
  return { statusCode: res.statusCode, headers: res.headers, body: res.body };
};
