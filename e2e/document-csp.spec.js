'use strict';
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('production CSP permits signed document uploads only to the configured S3 bucket', async ({ page }) => {
  const terraform = readFileSync(join(__dirname, '../infra/cloudfront.tf'), 'utf8');
  const match = /content_security_policy\s*=\s*"([^"]+)"/.exec(terraform);
  expect(match).not.toBeNull();
  const policy = match[1].replaceAll('${aws_s3_bucket.documents.bucket}', 'nota-csp-test').replaceAll('${var.region}', 'ca-central-1');
  await page.route('**/csp-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>CSP probe</title>', headers: { 'Content-Security-Policy': policy } }));
  let allowedRequests = 0, deniedRequests = 0;
  await page.route('https://nota-csp-test.s3.ca-central-1.amazonaws.com/**', route => {
    allowedRequests++;
    return route.fulfill({ status: 200, body: '', headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'PUT, OPTIONS' } });
  });
  await page.route('https://other-bucket.s3.ca-central-1.amazonaws.com/**', route => { deniedRequests++; return route.fulfill({ body: '', headers: { 'access-control-allow-origin': '*' } }); });
  await page.goto('/csp-probe');
  const result = await page.evaluate(async () => {
    const allowed = await fetch('https://nota-csp-test.s3.ca-central-1.amazonaws.com/document?signature=test', { method: 'PUT', body: 'synthetic document' });
    let blocked = false;
    try { await fetch('https://other-bucket.s3.ca-central-1.amazonaws.com/document'); } catch { blocked = true; }
    return { allowed: allowed.ok, blocked };
  });
  expect(result).toEqual({ allowed: true, blocked: true });
  expect(allowedRequests).toBeGreaterThan(0);
  expect(deniedRequests).toBe(0);
});
