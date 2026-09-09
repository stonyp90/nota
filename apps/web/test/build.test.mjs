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
  assert.equal(hashed(/^i18n\.[0-9a-f]{10}\.js$/).length, 1, 'missing hashed i18n.js');
});

test('no un-hashed app.js/styles.css/domain.js ship in dist', () => {
  for (const bare of ['app.js', 'styles.css', 'domain.js', 'i18n.js']) {
    assert.ok(!files.includes(bare), `dist still contains un-hashed ${bare}`);
  }
});

test('index.html references only the hashed asset filenames', () => {
  assert.match(html, /src="app\.[0-9a-f]{10}\.js"/, 'index.html lost its hashed app.js ref');
  assert.match(html, /href="styles\.[0-9a-f]{10}\.css"/, 'index.html lost its hashed styles.css ref');
  assert.match(html, /src="domain\.[0-9a-f]{10}\.js"/, 'index.html lost its hashed domain.js ref');
  assert.match(html, /src="i18n\.[0-9a-f]{10}\.js"/, 'index.html lost its hashed i18n.js ref');
  assert.doesNotMatch(html, /(src|href)="(app\.js|styles\.css|domain\.js)"/, 'index.html still points at an un-hashed asset');
});

test('service worker is build-stamped and precaches the hashed shell', () => {
  assert.doesNotMatch(sw, /nota-shell-dev/, 'sw.js kept the dev cache name — activate would not purge old shells');
  assert.match(sw, /nota-shell-[0-9a-f]{10}/, 'sw.js is missing its per-build cache name');
  assert.match(sw, /'\/app\.[0-9a-f]{10}\.js'/, 'sw.js precache list is not hashed');
  assert.doesNotMatch(sw, /'\/app\.js'/, 'sw.js still precaches the un-hashed app.js');
});

// Retired URLs overwrite the old static pages without keeping them indexed.
const { JSDOM } = await import('jsdom');
const { pages, pagePath } = await import('../seo-pages.mjs');
const sitemap = readFileSync(dist('sitemap.xml'), 'utf8');
for (const page of pages) {
  for (const lang of ['fr', 'en']) {
    test(`retired search document: ${pagePath(page, lang)}`, () => {
      const source = readFileSync(dist(pagePath(page, lang).slice(1)), 'utf8');
      const doc = new JSDOM(source).window.document;
      const target = `/?lang=${lang}#t=carnet`;
      assert.equal(doc.documentElement.lang, `${lang}-CA`);
      assert.equal(doc.querySelector('meta[name="robots"]').content, 'noindex,follow');
      assert.equal(doc.querySelector('meta[http-equiv="refresh"]').content, `0;url=${target}`);
      assert.equal(doc.querySelector('a').getAttribute('href'), target, 'manual fallback without JavaScript');
      assert.equal(doc.querySelector('link[rel="canonical"]').href, 'https://gonota.ca/' + (lang === 'en' ? '?lang=en' : ''));
      assert.equal(doc.querySelectorAll('script').length, 0, 'retired pages need no scripts or tracking');
      assert.ok(!sitemap.includes(pagePath(page, lang)), 'retired URL is absent from sitemap');
      assert.ok(!html.includes(pagePath(page, lang)), 'retired URL is absent from navigation');
    });
  }
}

test('campaign and referral labels survive the CTA without forwarding personal query values', () => {
  const dom = new JSDOM('<a data-acquisition-link href="/?lang=en#t=carnet">Continue</a>', {
    url: 'https://gonota.ca/test.html?utm_source=linkedin&ref=COURTIER&email=private%40example.com&utm_content=%3Cscript%3E', runScripts: 'outside-only',
  });
  dom.window.eval(readFileSync(new URL('../public/landing.js', import.meta.url), 'utf8'));
  const target = new URL(dom.window.document.querySelector('a').href);
  assert.equal(target.searchParams.get('lang'), 'en');
  assert.equal(target.searchParams.get('utm_source'), 'linkedin');
  assert.equal(target.searchParams.get('ref'), 'COURTIER');
  assert.equal(target.searchParams.has('email'), false);
  assert.equal(target.searchParams.has('utm_content'), false);
  assert.equal(target.hash, '#t=carnet');
});

test('visiting a search document cannot replace the offline application shell', async () => {
  let listener;
  let intercepted = false;
  const self = { addEventListener: (name, fn) => { if (name === 'fetch') listener = fn; }, location: { origin: 'https://gonota.ca' } };
  new Function('self', sw)(self);
  listener({ request: { method: 'GET', url: 'https://gonota.ca/notaire-financement-quebec.html', mode: 'navigate' }, respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false);
});
