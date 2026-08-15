/**
 * Build-integrity tests for the admin console. Same hazard as the web app: a
 * freshly deployed (no-cache) index.html must never be able to pair with a
 * browser-cached OLD admin.js/admin.css/tokens.css. Content-hashed filenames are
 * what prevent that, so guard them here. Runs the real build and inspects dist/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const adminDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

// Build once for the whole suite.
execFileSync('node', ['build.mjs'], { cwd: adminDir, stdio: 'ignore' });

const files = readdirSync(distDir);
const html = readFileSync(fileURLToPath(new URL('../dist/index.html', import.meta.url)), 'utf8');
// The hashed admin.css — needed to check its @import points at the hashed tokens.
const cssName = files.find((f) => /^admin\.[0-9a-f]{10}\.css$/.test(f));
const css = cssName ? readFileSync(fileURLToPath(new URL('../dist/' + cssName, import.meta.url)), 'utf8') : '';

test('every cacheable asset is emitted with a content-hashed filename', () => {
  const one = (re, label) => assert.equal(files.filter((f) => re.test(f)).length, 1, 'missing hashed ' + label);
  one(/^admin\.[0-9a-f]{10}\.js$/, 'admin.js');
  one(/^admin\.[0-9a-f]{10}\.css$/, 'admin.css');
  one(/^tokens\.[0-9a-f]{10}\.css$/, 'tokens.css');
  one(/^admin-theme\.[0-9a-f]{10}\.js$/, 'admin-theme.js');
});

test('no un-hashed cacheable asset ships in dist', () => {
  for (const bare of ['admin.js', 'admin.css', 'tokens.css', 'admin-theme.js']) {
    assert.ok(!files.includes(bare), 'dist still contains un-hashed ' + bare);
  }
});

test('index.html references only the hashed asset filenames', () => {
  assert.match(html, /src="admin-theme\.[0-9a-f]{10}\.js"/, 'lost hashed admin-theme.js ref');
  assert.match(html, /href="admin\.[0-9a-f]{10}\.css"/, 'lost hashed admin.css ref');
  assert.match(html, /src="admin\.[0-9a-f]{10}\.js"/, 'lost hashed admin.js ref');
  assert.doesNotMatch(html, /(src|href)="(admin-theme\.js|admin\.css|admin\.js)"/, 'index.html still points at an un-hashed asset');
});

test('admin.css @import resolves to the hashed tokens.css (not the bare name)', () => {
  assert.match(css, /tokens\.[0-9a-f]{10}\.css/, 'admin.css lost its hashed tokens.css @import');
  assert.doesNotMatch(css, /["'(]tokens\.css["')]/, 'admin.css still @imports the un-hashed tokens.css');
});

test('the private console stays out of search indexes', () => {
  assert.match(html, /name="robots"\s+content="noindex,nofollow"/, 'index.html dropped its noindex robots meta');
  assert.ok(files.includes('robots.txt'), 'robots.txt is missing from dist');
});
