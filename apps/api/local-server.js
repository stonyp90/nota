'use strict';

/**
 * Local dev server (plain node:http, no framework). Uses DynamoDB Local when
 * TABLE_NAME is set (docker-compose), otherwise falls back to an in-memory repo
 * seeded with domain fixtures so the API returns a populated carnet with no
 * infrastructure at all.
 */
const http = require('node:http');
const { createApp } = require('./src/handler');
const { createMemoryRepo } = require('./src/repo-memory');
const { createDynamoRepo } = require('./src/repo-dynamo');
const domain = require('@nota/domain');

const PORT = Number(process.env.PORT || 8788);
const useDynamo = !!process.env.TABLE_NAME;

let repo;
if (useDynamo) {
  repo = createDynamoRepo({
    tableName: process.env.TABLE_NAME,
    endpoint: process.env.DYNAMO_ENDPOINT,
    region: process.env.AWS_REGION || 'ca-central-1',
  });
} else {
  const today = new Date().toISOString().slice(0, 10);
  repo = createMemoryRepo(domain.makeFixtures(today));
}

const app = createApp(repo);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const query = Object.fromEntries(url.searchParams);
    let body = '';
    for await (const chunk of req) body += chunk;
    const out = await app.handle({ method: req.method, path: url.pathname, query, headers: req.headers, body });
    res.writeHead(out.statusCode, out.headers);
    res.end(out.body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errors: [{ code: 'erreur_serveur', message: String(err && err.message || err) }] }));
  }
});

server.listen(PORT, () => {
  const mode = useDynamo ? `DynamoDB ${process.env.DYNAMO_ENDPOINT || '(regional)'}` : 'in-memory fixtures';
  console.log(`Nota API on http://localhost:${PORT}  [${mode}]`);
});
