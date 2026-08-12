/**
 * Build-integrity tests: the deploy pipeline breaks returning visitors if a new
 * index.html can pair with a browser-cached OLD app.js/styles.css. Fingerprinted
 * filenames are what prevent that, so guard them here. Runs the real build and
 * inspects dist/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const dist = (f) => fileURLToPath(new URL('../dist/' + f, import.meta.url));

// Build once for the whole suite.
execFileSync('node', ['build.mjs'], { cwd: webDir, stdio: 'ignore' });

const files = readdirSync(fileURLToPath(new URL('../dist', import.meta.url)));
const html = readFileSync(dist('index.html'), 'utf8');
const sw = readFileSync(dist('sw.js'), 'utf8');

test('JS/CSS assets are emitted with content-hashed filenames', () => {
  const hashed = (re) => files.filter((f) => re.test(f));
  assert.equal(hashed(/^app\.[0-9a-f]{10}\.js$/).length, 1, 'missing hashed app.js');
  assert.equal(hashed(/^styles\.[0-9a-f]{10}\.css$/).length, 1, 'missing hashed styles.css');
  assert.equal(hashed(/^domain\.[0-9a-f]{10}\.js$/).length, 1, 'missing hashed domain.js');
});

test('no un-hashed app.js/styles.css/domain.js ship in dist', () => {
  for (const bare of ['app.js', 'styles.css', 'domain.js']) {
    assert.ok(!files.includes(bare), `dist still contains un-hashed ${bare}`);
  }
});

test('index.html references only the hashed asset filenames', () => {
  assert.match(html, /src="app\.[0-9a-f]{10}\.js"/, 'index.html lost its hashed app.js ref');
  assert.match(html, /href="styles\.[0-9a-f]{10}\.css"/, 'index.html lost its hashed styles.css ref');
  assert.match(html, /src="domain\.[0-9a-f]{10}\.js"/, 'index.html lost its hashed domain.js ref');
  assert.doesNotMatch(html, /(src|href)="(app\.js|styles\.css|domain\.js)"/, 'index.html still points at an un-hashed asset');
});

test('service worker is build-stamped and precaches the hashed shell', () => {
  assert.doesNotMatch(sw, /nota-shell-dev/, 'sw.js kept the dev cache name — activate would not purge old shells');
  assert.match(sw, /nota-shell-[0-9a-f]{10}/, 'sw.js is missing its per-build cache name');
  assert.match(sw, /'\/app\.[0-9a-f]{10}\.js'/, 'sw.js precache list is not hashed');
  assert.doesNotMatch(sw, /'\/app\.js'/, 'sw.js still precaches the un-hashed app.js');
});
