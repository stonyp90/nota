import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { brandKit } from '../scripts/brand-kit.mjs';

const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const guide = new JSDOM(read('brand.html')).window.document;

test('official downloads reproduce the product drawings and email signature', () => {
  for (const [name, expected] of Object.entries(brandKit())) assert.equal(read(name), expected, `${name}: regenerate with node apps/web/scripts/brand-kit.mjs`);
  for (const theme of ['light', 'dark']) {
    const svg = new JSDOM(read(`nota-logo-${theme}.svg`), { contentType: 'image/svg+xml' }).window.document;
    assert.equal(svg.querySelectorAll('path').length, 3);
    assert.equal(svg.querySelectorAll('text,image,script').length, 0, 'logo is self-contained geometry');
  }
});

test('the public kit offers official resources, not unapproved logo directions', () => {
  assert.equal(guide.querySelectorAll('a[href*="brand-explorations"], a[href*="brand-compose"], a[href*="brand-blanc"], .variant').length, 0);
  for (const name of ['nota-logo-light.svg', 'nota-logo-dark.svg', 'favicon.svg', 'og.svg', 'signature-courriel.html']) {
    assert.ok(guide.querySelector(`a[href="${name}"]`), `missing ${name}`);
    assert.ok(read(name));
  }
  assert.equal(guide.querySelector('link[rel="canonical"]').href, 'https://brand.gonota.ca/');
  assert.equal(guide.querySelector('a.lockup').href, 'https://gonota.ca/', 'the brand subdomain must link back to the product');
});

test('brand guide prose is covered by the shared English dictionary', () => {
  const mod = { exports: {} };
  new Function('module', 'exports', read('i18n.js'))(mod, mod.exports);
  const i18n = mod.exports;
  const same = new Set(['Québec', 'Nota', 'FR', 'EN', 'brand.gonota.ca · Nota', 'Blue-teal · action', 'Cyan signal', 'Midnight ink', 'Warm accent']);
  const walker = guide.createTreeWalker(guide.body, 4);
  const missing = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('script,style,svg,pre,code,[data-i18n-skip]')) continue;
    const text = i18n.normalize(node.textContent);
    if (text && !same.has(text) && !i18n.covered(text)) missing.push(text);
  }
  assert.deepEqual(missing, []);
  assert.ok(guide.querySelector('script[src="i18n.js"]'));
  assert.equal(guide.querySelectorAll('[data-set-lang]').length, 2);
});

test('every public pane and admin section is registered in the browser surface sweep', () => {
  const sweep = readFileSync(new URL('../../../e2e/every-surface.spec.js', import.meta.url), 'utf8');
  const app = new JSDOM(read('index.html')).window.document;
  for (const pane of app.querySelectorAll('[id^="pane-"]')) assert.ok(sweep.includes(`root: '#${pane.id}'`), `No browser coverage for ${pane.id}`);
  const admin = readFileSync(new URL('../../admin/public/admin.js', import.meta.url), 'utf8');
  const sections = admin.match(/var ADMIN_SECTIONS = \[([\s\S]*?)\n  \];/);
  assert.ok(sections, 'admin section registry must be discoverable');
  for (const [, key] of sections[1].matchAll(/key: '([^']+)'/g)) {
    assert.ok(sweep.includes(`admin: '${key === 'overview' ? '' : key}'`), `No browser coverage for admin ${key}`);
  }
});
