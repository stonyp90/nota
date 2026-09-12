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

// Search visitors and non-JavaScript crawlers must receive complete localized pages.
const { JSDOM } = await import('jsdom');
const { pages, pagePath } = await import('../seo-pages.mjs');
const sitemap = new JSDOM(readFileSync(dist('sitemap.xml'), 'utf8'), { contentType: 'text/xml' }).window.document;
for (const page of pages) {
  for (const lang of ['fr', 'en']) {
    test(`static search document: ${pagePath(page, lang)}`, () => {
      const source = readFileSync(dist(pagePath(page, lang).slice(1)), 'utf8');
      const doc = new JSDOM(source).window.document;
      const url = 'https://gonota.ca' + pagePath(page, lang);
      assert.equal(doc.documentElement.lang, `${lang}-CA`);
      assert.equal(doc.querySelector('link[rel="canonical"]').href, url);
      assert.equal(doc.querySelectorAll('h1').length, 1);
      assert.ok(doc.querySelector('main').textContent.length > 1000);
      assert.ok([...sitemap.querySelectorAll('loc')].some(el => el.textContent === url));
      assert.equal(doc.querySelector('a.btn').getAttribute('href'), `/?lang=${lang}#t=carnet`);
      for (const el of doc.querySelectorAll('script[src],link[rel="stylesheet"]')) {
        const path = el.getAttribute('src') || el.getAttribute('href');
        // Plus AUCUN asset externe depuis que Nota sert ses propres polices
        // (2026-09-12) : tout ce que la page charge est un fichier construit.
        assert.doesNotMatch(path, /^https?:/, `unexpected external asset ${path}`);
        assert.ok(files.includes(path.slice(1)), `missing built asset ${path}`);
      }
      // One brand: the acquisition page carries the same lockup as the carnet.
      assert.ok(doc.querySelector('symbol#nota-logomark') && doc.querySelector('symbol#nota-wordmark'), 'brand symbols inlined');
      assert.ok(doc.querySelector('header .brand .brand-lockup use[href="#nota-logomark"]'), 'header lockup uses the mark');
      assert.equal(doc.querySelector('meta[name="theme-color"]:not([media])').getAttribute('content'), '#386888');
      // Les deux fontes arrivent par styles.css, qui porte les @font-face vers
      // /fonts — la page d'acquisition a donc la typographie du carnet sans
      // qu'une requête parte chez un tiers (polices-hebergees.test.mjs).
      assert.ok([...doc.querySelectorAll('link[rel="stylesheet"]')].some((el) => /^\/styles\.[0-9a-f]{10}\.css$/.test(el.getAttribute('href'))), 'la page lit la feuille du carnet');
      assert.doesNotMatch(source, /fonts\.googleapis\.com|fonts\.gstatic\.com|rsms\.me/, 'aucun hôte de polices tiers');
      assert.doesNotMatch(source, /#315b43|#50b848|#2c5f34/i, 'no retired green anywhere on the page');
      for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) assert.equal(JSON.parse(el.textContent).url, url);
      if (lang === 'en') {
        assert.match(doc.querySelector('h1').textContent, /Notary for mortgage/);
        assert.doesNotMatch(doc.querySelector('main').textContent, /Votre|notaire|hypothécaire|demande|Québec/);
      }
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
