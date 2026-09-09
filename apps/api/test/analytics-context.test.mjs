import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { analyticsContext } = require('../src/analytics-context');
const { createAnalytics } = require('../src/analytics');
const { createMemoryRepo } = require('../src/repo-memory');
const { statsDeltasForFunnel } = require('../src/stats');
const { cleanAnalyticsContext, ANALYTICS_DIMENSIONS } = require('@nota/domain');

test('UA families cover iOS browsers, desktop-mode iPad, Android and bots without storing raw data', () => {
  for (const [ua, hint, browser, os, device] of [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile/15 Safari/604.1', {}, 'safari', 'ios', 'mobile'],
    ['Mozilla/5.0 (iPhone) CriOS/135.0 Mobile Safari/604.1', {}, 'chrome', 'ios', 'mobile'],
    ['Mozilla/5.0 (iPhone) FxiOS/135.0 Mobile Safari/604.1', {}, 'firefox', 'ios', 'mobile'],
    ['Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1', { device: 'tablet' }, 'safari', 'ios', 'tablet'],
    ['Mozilla/5.0 (Linux; Android 15) Chrome/135.0 Mobile Safari/537 SamsungBrowser/27.0', {}, 'samsung', 'android', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 15) Chrome/135.0 Safari/537', {}, 'chrome', 'android', 'tablet'],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/135.0 Edg/135.0', {}, 'edge', 'windows', 'desktop'],
    ['Mozilla/5.0 (Linux; Android 15; wv) Chrome/135.0 Mobile Safari/537', {}, 'in_app', 'android', 'mobile'],
    ['Googlebot/2.1', {}, 'bot', 'other', 'unknown'],
    ['', {}, 'unknown', 'unknown', 'unknown'],
  ]) {
    const context = analyticsContext({ headers: { 'User-Agent': ua } }, hint);
    assert.deepEqual(context, { browser, os, device }, ua);
  }
});

test('only bounded categories enter counters; no arbitrary URLs, versions, errors or cross-products', async () => {
  const context = analyticsContext({ headers: { 'user-agent': 'Chrome/135.0' } }, {
    browser: 'safari', os: 'ios', source: 'google', language: 'fr', viewport: 'narrow',
    entry: 'https://private.example/token', userAgent: 'sensitive', error: 'secret', sourceUrl: 'private',
  });
  assert.equal(context.browser, 'chrome');
  assert.equal(context.os, 'other');
  assert.equal(context.entry, undefined);
  const repo = createMemoryRepo([]);
  await repo.applyStatsDeltas(statsDeltasForFunnel('visite', '2026-09-08', context));
  await repo.applyStatsDeltas(statsDeltasForFunnel('publie', '2026-09-08', context));
  await repo.applyStatsDeltas(statsDeltasForFunnel('visite', '2026-08-01', context));
  const result = await createAnalytics({ repo, now: () => '2026-09-09' }).overview({ from: '2026-09-08', to: '2026-09-08' });
  assert.equal(result.entonnoir.find(e => e.id === 'visite').total, 1);
  const sources = result.segments.find(d => d.id === 'source');
  assert.equal(sources.rows[0].id, 'google');
  assert.equal(sources.rows[0].events.visite, 1);
  assert.equal(sources.rows[0].events.publie, 1);
  assert.equal(result.segments.find(d => d.id === 'entry').rows.length, 0);
  assert.ok(!JSON.stringify(result.segments).includes('private'));
  for (const key of Object.keys(statsDeltasForFunnel('visite', '2026-09-08', context)[0].adds).filter(k => k.startsWith('segment__'))) {
    assert.equal(key.split('__').length, 4, 'one dimension per counter');
  }
});

test('context values are bounded and bilingual; historical events have no invented segments', async () => {
  for (const d of ANALYTICS_DIMENSIONS) {
    assert.ok(d.nom && d.nomEn);
    for (const v of d.values) assert.ok(v.nom && v.nomEn);
  }
  assert.deepEqual(cleanAnalyticsContext(null), {});
  assert.deepEqual(cleanAnalyticsContext({ source: {}, viewport: '99999', email: 'private@example.test' }), {});
  const repo = createMemoryRepo([]);
  await repo.applyStatsDeltas(statsDeltasForFunnel('visite', '2026-09-08'));
  const result = await createAnalytics({ repo, now: () => '2026-09-09' }).overview();
  assert.equal(result.entonnoir.find(e => e.id === 'visite').total, 1);
  assert.ok(result.segments.every(group => group.rows.length === 0));
});
