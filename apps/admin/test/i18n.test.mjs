/**
 * Bilingual (fr/en) guarantees for the admin console — the console twin of
 * apps/web/test/i18n.test.mjs. Engine behaviour, coverage of index.html, and
 * an English jsdom boot of the real auth gate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const srcOf = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const I18N_SRC = srcOf('../public/i18n.js');
const ADMIN_SRC = srcOf('../public/admin.js');
const HTML_SRC = srcOf('../public/index.html');

// apps/admin is "type":"module"; eval the UMD engine as a plain script.
const I18N = (() => {
  const mod = { exports: {} };
  new Function('module', 'exports', I18N_SRC)(mod, mod.exports);
  return mod.exports;
})();

// ---------------------------------------------------------------------------
// Engine behaviour
// ---------------------------------------------------------------------------

test('exact lookups translate in English mode; French mode is identity', () => {
  I18N.force('en');
  assert.equal(I18N.t('Se déconnecter'), 'Sign out');
  I18N.force('fr');
  assert.equal(I18N.t('Se déconnecter'), 'Se déconnecter');
});

test('money format converts in English mode', () => {
  I18N.force('en');
  assert.equal(I18N.t('1 250 $'), '$1,250');
});

// ---------------------------------------------------------------------------
// Coverage of index.html
// ---------------------------------------------------------------------------

const ALLOW = new Set(['Nota', 'Admin', 'Nota · Admin', 'FR', 'EN', 'Français', 'English']);

function needsTranslation(s) {
  if (!s || s.length < 2) return false;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(s)) return false;
  if (ALLOW.has(s)) return false;
  return true;
}

test('every user-visible string in index.html has an English entry', () => {
  const html = HTML_SRC
    .replace(/<script[\s\S]*?<\/script>/g, '\u0000')
    .replace(/<!--[\s\S]*?-->/g, '\u0000');
  const texts = [];
  for (const run of html.replace(/<[^>]+>/g, '\u0000').split('\u0000')) texts.push(run);
  for (const m of html.matchAll(/(?<=\s)(?:aria-label|title|placeholder|alt)="([^"]*)"/g)) texts.push(m[1]);
  const missing = texts
    .map((s) => I18N.normalize(s))
    .filter(needsTranslation)
    .filter((s) => !I18N.covered(s));
  assert.deepEqual([...new Set(missing)], [], 'French strings with no English entry');
});

// ---------------------------------------------------------------------------
// English boot of the real console (auth gate)
// ---------------------------------------------------------------------------

const FR_LEAD = 'Accès réservé. Recevez un lien de connexion à usage unique par courriel.';

async function boot(lang) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.setItem('nota.lang', lang);
      // Unauthenticated: every API call fails, so the auth gate renders.
      window.fetch = () => Promise.reject(new Error('offline'));
    },
  });
  const win = dom.window;
  win.eval(I18N_SRC);
  win.eval(ADMIN_SRC);
  await new Promise((r) => setTimeout(r, 80));
  return win;
}

test('English boot renders the auth gate in English', async () => {
  const win = await boot('en');
  const doc = win.document;
  assert.equal(doc.documentElement.getAttribute('lang'), 'en-CA');
  const lead = doc.querySelector('.auth-lead');
  assert.ok(lead, 'auth gate did not render');
  assert.equal(lead.textContent.trim(), I18N.tEn(FR_LEAD));
  assert.notEqual(lead.textContent.trim(), FR_LEAD, 'lead must actually change');
  assert.equal(doc.getElementById('admin-lang-toggle').textContent, 'FR');
});

test('French boot stays French', async () => {
  const win = await boot('fr');
  const doc = win.document;
  assert.equal(doc.documentElement.getAttribute('lang'), 'fr-CA');
  assert.equal(doc.querySelector('.auth-lead').textContent.trim(), FR_LEAD);
  assert.equal(doc.getElementById('admin-lang-toggle').textContent, 'EN');
});

// ---------------------------------------------------------------------------
// Coverage of admin.js (audit console admin 2026-09-03, P1-20)
// ---------------------------------------------------------------------------
// index.html is a shell: nearly every visible sentence is a literal handed to
// `el(tag, cls, 'texte')`, `createTextNode('texte')`, `toast('texte')`, or a
// `.placeholder = 'texte'` / `.title = 'texte'`. Walk them the way index.html
// is walked, so a new French string cannot ship without its English.
// Les exemples posés en `placeholder` : ils ne se traduisent pas, ils montrent
// la FORME attendue (un identifiant en minuscules, une adresse). « Groupe
// pilote » en est un aussi — c'est le nom qu'un opérateur pourrait taper.
const CODE_ALLOW = new Set([...ALLOW, 'soutien', 'Soutien', 'vous@nota.ca', 'personne@exemple.ca',
  'pilote', 'Groupe pilote', 'une.adresse@exemple.ca']);
function adminLiterals() {
  const out = new Set();
  const src = ADMIN_SRC;
  const add = (m) => out.add(m[1].replace(/\\'/g, "'"));
  for (const m of src.matchAll(/\bel\(\s*'[a-z0-9]+'\s*,\s*(?:'[^']*'|null)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) add(m);
  for (const m of src.matchAll(/createTextNode\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) add(m);
  for (const m of src.matchAll(/\btoast\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) add(m);
  for (const m of src.matchAll(/\.(?:placeholder|title)\s*=\s*'((?:[^'\\]|\\.)*)'/g)) add(m);
  return [...out];
}

test('every literal user-visible string in admin.js has an English entry', () => {
  const missing = adminLiterals()
    .map((s) => I18N.normalize(s))
    .filter((s) => needsTranslation(s) && !CODE_ALLOW.has(s))
    .filter((s) => !I18N.covered(s));
  assert.deepEqual([...new Set(missing)], [], 'French strings in admin.js with no English entry');
});

test('a dictionary key is never written with a leading space — normalize() would never match it', () => {
  const bad = Object.keys(I18N.dictionaries().text).filter((k) => k !== I18N.normalize(k));
  assert.deepEqual(bad, [], 'keys that can never match a normalized string');
});
