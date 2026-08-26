/**
 * English-mode DOM integration tests. Boots the real page (index.html +
 * i18n.js + domain.js + app.js, same order as the browser) in jsdom with the
 * language persisted as "en", and asserts the static shell, the SEO head, the
 * dynamic renders and the money format all come out in English — and that a
 * French boot stays untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const srcOf = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const I18N_SRC = srcOf('../public/i18n.js');
const DOMAIN_SRC = srcOf('../../../packages/domain/index.js');
const APP_SRC = srcOf('../public/app.js');
const HTML_SRC = srcOf('../public/index.html');

// The engine itself, for expectations: EN assertions derive from the same
// dictionary the page uses, so copy edits don't break this suite.
const I18N = (() => {
  const mod = { exports: {} };
  new Function('module', 'exports', I18N_SRC)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(lang, url = 'https://nota.example/') {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url,
    pretendToBeVisual: true,
    beforeParse(window) {
      if (lang) window.localStorage.setItem('nota.lang', lang);
      // Offline path: the store falls back to domain fixtures.
      window.fetch = () => Promise.reject(new Error('offline'));
    },
  });
  const win = dom.window;
  win.eval(I18N_SRC);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80); // async boot: seed + first render
  return win;
}

const FR_H1 = 'Un notaire, à la date qu’il vous faut.';

test('English boot translates the static shell and head', async () => {
  const win = await boot('en');
  const doc = win.document;

  assert.equal(doc.documentElement.getAttribute('lang'), 'en-CA');
  const h1 = doc.querySelector('#pane-carnet h1');
  assert.equal(h1.textContent.trim(), I18N.tEn(FR_H1));
  assert.notEqual(h1.textContent.trim(), FR_H1, 'h1 must actually change');

  // Head/SEO follows the language.
  assert.equal(doc.title, I18N.tEn('Nota — le carnet public des actes notariés à Québec'));
  assert.equal(
    doc.querySelector('meta[property="og:locale"]').getAttribute('content'),
    'en_CA'
  );
  assert.equal(
    doc.querySelector('link[rel="manifest"]').getAttribute('href'),
    'manifest.en.webmanifest'
  );

  // The toggle offers the OTHER language.
  assert.equal(doc.getElementById('lang-toggle').textContent, 'FR');
  assert.equal(doc.getElementById('mnav-lang').textContent, 'Français');
});

test('English boot renders dynamic content in English', async () => {
  const win = await boot('en');
  const doc = win.document;

  // Calendar title comes from an en-CA Intl formatter. On the current month
  // the app shows a rolling window ("August – September 2026"), so assert the
  // English month name is present rather than the exact span.
  const calTitle = doc.getElementById('cal-title').textContent;
  const now = new Date();
  const monthEn = new Intl.DateTimeFormat('en-CA', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)));
  assert.ok(calTitle.includes(monthEn), `"${calTitle}" should name ${monthEn}`);

  // Amounts rendered by the app (pulse medians) wear the English format.
  const pulse = doc.getElementById('pulse-rows').textContent;
  assert.match(pulse, /\$\d/, 'expected $1,250-style amounts in the pulse');
  assert.doesNotMatch(pulse, /\d\u00a0\$/, 'no French-format amounts may remain');
});

test('a ?lang=en link boots English with no stored preference', async () => {
  const win = await boot(null, 'https://nota.example/?lang=en');
  const doc = win.document;
  assert.equal(doc.documentElement.getAttribute('lang'), 'en-CA');
  assert.equal(doc.querySelector('#pane-carnet h1').textContent.trim(), I18N.tEn(FR_H1));
  assert.equal(win.localStorage.getItem('nota.lang'), 'en', 'the link choice persists');
});

test('English boot never leaks French domain labels into composed lines', async () => {
  const win = await boot('en');
  const doc = win.document;
  const D = win.NotaDomain;

  // 1. The dossier's gate line (price questions + consent, ADR 0010 §3)
  //    composes the required question labels in English, prefix included.
  win.Nota.setTab('dossier');
  await wait(30);
  const missing = doc.getElementById('dossier-missing').textContent;
  const svc = D.serviceById(doc.getElementById('d-service').value);
  const required = (svc.pricing.criteria || []).filter((c) => c.required);
  for (const c of required) {
    assert.ok(missing.includes(I18N.tEn(c.label)),
      `"${missing}" should name "${I18N.tEn(c.label)}" in English`);
    assert.ok(!missing.includes(c.label) || c.label === I18N.tEn(c.label),
      `no French question label may remain: ${missing}`);
  }
  assert.match(missing, /^price questions to answer: /, `the composed prefix is translated: ${missing}`);
  assert.match(missing, /sharing consent required\.$/, `the consent tail is translated: ${missing}`);

  // 2. The booking form's "Answer: …" hint lists the notary's questions in English.
  win.Nota.setTab('carnet');
  doc.getElementById('cta-reserver').click();
  await wait(50);
  const hint = doc.getElementById('offer-hint').textContent;
  if (hint) {
    const svcO = D.serviceById(doc.getElementById('o-service').value);
    const required = ((svcO.pricing && svcO.pricing.criteria) || []).filter((c) => c.required);
    for (const c of required) {
      if (hint.includes(I18N.tEn(c.label))) continue;
      assert.ok(!hint.includes(c.label) || c.label === I18N.tEn(c.label),
        `French question label leaked into the hint: ${hint}`);
    }
    assert.match(hint, /^Answer: /, `the hint prefix is translated: ${hint}`);
  }

  // 3. The calendar's urgency badge title composes tier + act + amount; the
  //    tier's display name must come out English too ("Same day", never
  //    "Même jour").
  for (const u of doc.querySelectorAll('.cal-urgency')) {
    assert.ok(!/Même jour|À ce délai/.test(u.title),
      `French fragment leaked into an urgency title: ${u.title}`);
  }
});

test('French boot stays French and offers English', async () => {
  const win = await boot('fr');
  const doc = win.document;

  assert.equal(doc.documentElement.getAttribute('lang'), 'fr-CA');
  assert.equal(doc.querySelector('#pane-carnet h1').textContent.trim(), FR_H1);
  assert.equal(doc.title, 'Nota — le carnet public des actes notariés à Québec');
  assert.equal(
    doc.querySelector('link[rel="manifest"]').getAttribute('href'),
    'manifest.webmanifest'
  );
  assert.equal(doc.getElementById('lang-toggle').textContent, 'EN');
  assert.equal(doc.getElementById('mnav-lang').textContent, 'English');

  const pulse = doc.getElementById('pulse-rows').textContent;
  assert.match(pulse, /\d\u00a0\$/, 'French boot keeps Quebec money format');
});
