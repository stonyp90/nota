import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// index.js builds a Dynamo repo at module load, which requires TABLE_NAME (the
// constructor throws without it). Health and the validation-reject path never
// send a DynamoDB command, so a dummy table name is enough — no network here.
process.env.TABLE_NAME = process.env.TABLE_NAME || 'nota-test-table';
const { handler } = require('../index.js');

test('GET /api/health (payload-format-2.0) returns 200 JSON and strips the /api prefix', async () => {
  const res = await handler({
    requestContext: { http: { method: 'GET' } },
    rawPath: '/api/health',
    headers: {},
  });
  // A 200 here proves the /api prefix was stripped; without stripping the route
  // '/api/health' is unknown and the handler would answer 404.
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(body.today));
});

test('a base64-encoded body is decoded before the handler parses it', async () => {
  // Encode a well-formed offer with a clearly-past date. If the base64 body were
  // NOT decoded, JSON.parse would fail on the raw base64 and yield 400
  // json_invalide. A 422 domain rejection (date_passee) instead proves the body
  // was decoded and parsed as valid JSON — and this path returns before any
  // repo.put, so it never touches DynamoDB.
  const offer = JSON.stringify({ serviceId: 'testament', dateISO: '2020-01-01', montant: 700 });
  const res = await handler({
    requestContext: { http: { method: 'POST' } },
    rawPath: '/api/bids',
    headers: { 'content-type': 'application/json' },
    isBase64Encoded: true,
    body: Buffer.from(offer, 'utf8').toString('base64'),
  });
  assert.equal(res.statusCode, 422);
  const body = JSON.parse(res.body);
  assert.ok(body.errors.some((e) => e.code === 'date_passee'));
});
