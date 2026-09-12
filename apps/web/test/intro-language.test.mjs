import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');
const scenarios = [
  { languages: ['en-CA'], expected: 'en' },
  { languages: ['fr-CA', 'en-CA'], expected: 'fr' },
  { languages: ['es-MX', 'en-US', 'fr'], expected: 'en' },
  { languages: ['de-DE'], expected: 'fr' },
  { languages: ['en-US'], saved: 'fr', expected: 'fr' },
  { languages: ['fr-CA'], saved: 'en', expected: 'en' },
  { languages: ['fr-CA'], saved: 'fr', query: '?lang=en', expected: 'en' },
  { languages: ['en-CA'], saved: 'en', query: '?lang=fr', expected: 'fr' },
];
for (const scenario of scenarios) {
  test('both introductions follow language precedence: ' + JSON.stringify(scenario), () => {
    const dom = new JSDOM(html, { url: 'https://nota.example/' + (scenario.query || ''), runScripts: 'outside-only' });
    const { window } = dom;
    try {
      Object.defineProperty(window.navigator, 'languages', { value: scenario.languages });
      if (scenario.saved) window.localStorage.setItem('nota.lang', scenario.saved);
      window.eval(i18n);
      window.NotaI18N.boot();
      const doc = window.document;
      assert.equal(doc.documentElement.lang, scenario.expected + '-CA');
      assert.equal(doc.querySelector('.ig-c1 .ig-h').textContent, scenario.expected === 'en'
        ? 'Choose your date.' : 'Choisissez votre date.');
      assert.equal(doc.querySelector('.ig-n1 .ig-h').textContent, scenario.expected === 'en'
        ? 'Find your next client.' : 'Trouvez votre prochain dossier.');
      for (const group of doc.querySelectorAll('#intro-gate [data-lang-seg]')) {
        assert.equal(group.querySelector('[aria-pressed="true"]').dataset.setLang, scenario.expected);
      }
    } finally { window.close(); }
  });
}
