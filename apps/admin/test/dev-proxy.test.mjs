/**
 * The admin dev server must be a faithful stand-in for the production CDN:
 * static files from public/, SPA fallback, and — new — a same-origin /api/*
 * proxy to the local admin API, mirroring how CloudFront routes /api/* on
 * admin.nota.ca. Same-origin means no CORS and no checked-in meta edits.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { createDevServer } from '../dev-server.mjs';

// A stub admin API that records what it receives and answers with a marker.
const seen = [];
const stubApi = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  seen.push({ method: req.method, url: req.url, body, contentType: req.headers['content-type'] || '' });
  res.writeHead(299, { 'content-type': 'application/json', 'x-stub': 'admin-api' });
  res.end(JSON.stringify({ stub: true }));
});

stubApi.listen(0, '127.0.0.1');
await once(stubApi, 'listening');
const apiOrigin = `http://127.0.0.1:${stubApi.address().port}`;

const dev = createDevServer({ apiOrigin });
dev.listen(0, '127.0.0.1');
await once(dev, 'listening');
const base = `http://127.0.0.1:${dev.address().port}`;

after(() => {
  dev.close();
  stubApi.close();
});

test('serves index.html at / with an html content-type', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /nota-admin-api/);
});

test('falls unknown non-api paths back to index.html (SPA routing)', async () => {
  const res = await fetch(`${base}/some/deep/route`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
});

test('proxies /api/* to the admin API verbatim — method, path, body, content-type', async () => {
  const res = await fetch(`${base}/api/admin/auth/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ops@example.com' }),
  });
  assert.equal(res.status, 299, 'the upstream status passes through untouched');
  assert.equal(res.headers.get('x-stub'), 'admin-api', 'upstream headers pass through');
  assert.deepEqual(await res.json(), { stub: true });

  const hit = seen.at(-1);
  assert.equal(hit.method, 'POST');
  assert.equal(hit.url, '/api/admin/auth/request', 'path forwarded as-is (the API strips /api itself)');
  assert.equal(hit.body, JSON.stringify({ email: 'ops@example.com' }));
  assert.match(hit.contentType, /application\/json/);
});

test('an unreachable admin API yields a 502 JSON error, not a hang or an HTML fallback', async () => {
  const lonely = createDevServer({ apiOrigin: 'http://127.0.0.1:1' });
  lonely.listen(0, '127.0.0.1');
  await once(lonely, 'listening');
  try {
    const res = await fetch(`http://127.0.0.1:${lonely.address().port}/api/admin/me`);
    assert.equal(res.status, 502);
    assert.match(res.headers.get('content-type'), /application\/json/);
    const json = await res.json();
    assert.ok(Array.isArray(json.errors));
  } finally {
    lonely.close();
  }
});
