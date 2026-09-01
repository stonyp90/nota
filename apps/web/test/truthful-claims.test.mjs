/**
 * Claims the product makes about itself must be true in the code that ships.
 *
 * Three were audited as false or misleading and are fixed here. Each test
 * locks BOTH directions: the retired wording must not come back, and the
 * replacement must actually say the true thing.
 *
 *  1. « Vos renseignements restent sur cet appareil » — false at the very
 *     moment it is displayed: the button under it calls clientWelcome(), which
 *     POSTs the courriel to /client/welcome, and the API stores it in a SENT#
 *     record keyed on the address.
 *  2. « Elles ne quittent pas le pays » — false: infra/cloudfront.tf declares
 *     PriceClass_100 (US + Europe edge locations), index.html preconnects and
 *     loads a stylesheet from rsms.me (a third-party font host that receives
 *     the visitor's IP), and payment runs through Stripe. Data AT REST is in
 *     ca-central-1; that is the defensible half.
 *  3. « Chances d’obtenir un notaire : 95 % » — invented: domain.OBTAIN_CHANCE
 *     is a hand-written table, never measured, shown exactly where the client
 *     picks a date and a price. Not one act has been completed on the platform.
 *
 * The rule for #3: no number, and no qualitative scale either — « élevées /
 * faibles » still mimics a measurement. Only the mechanism, which is true.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const I18N_SRC = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');

const I18N = (() => {
  const mod = { exports: {} };
  new Function('module', 'exports', I18N_SRC)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const FLAT = (s) => s.replace(/[  ]/g, ' ').replace(/\s+/g, ' ');

async function boot() {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, dom };
}

// ---------------------------------------------------------------------------
// 1. The courriel DOES leave the device — say so where it happens.
// ---------------------------------------------------------------------------
const DEVICE_LIE = /renseignements restent sur cet appareil/;

test('no surface claims the client’s information stays on the device', () => {
  for (const [name, src] of Object.entries({ 'index.html': HTML_SRC, 'app.js': APP_SRC, 'i18n.js': I18N_SRC })) {
    assert.ok(!DEVICE_LIE.test(src),
      name + ' still claims « vos renseignements restent sur cet appareil » — clientWelcome() POSTs the courriel to /client/welcome');
  }
  // And the English side cannot carry it either.
  assert.ok(!/information stays on this device|stay on this device/i.test(I18N_SRC),
    'i18n.js still carries the English form of the device-only claim');
});

test('the signup fine print says the courriel is transmitted, and claims only what the code honours', async () => {
  const { doc, Nota, dom } = await boot();
  // Static default, before any role is picked.
  const staticFine = FLAT($(doc, 'auth-fine').textContent);
  // …and the client-role copy the modal swaps in.
  Nota.openAuthModal ? Nota.openAuthModal('client', 'signup') : null;
  await wait(20);
  const clientFine = FLAT($(doc, 'auth-fine').textContent);

  for (const [label, txt] of [['the static fine print', staticFine], ['the client fine print', clientFine]]) {
    assert.ok(!DEVICE_LIE.test(txt), label + ' still claims device-only: ' + txt);
    assert.match(txt, /courriel est transmis à Nota/, label + ' must say the courriel is transmitted: ' + txt);
    assert.match(txt, /lien de suivi|avis/, label + ' must say what it is used for: ' + txt);
    // The narrow, verifiable half: file CONTENTS never leave. Answers and
    // document FILENAMES do travel (payload.dossier), so the copy must not
    // promise that « vos renseignements » or « votre dossier » stay local.
    assert.match(txt, /contenu de vos documents/, label + ' must scope the promise to file contents: ' + txt);
    assert.ok(!/vos réponses.{0,30}rest|dossier.{0,30}reste sur cet appareil/.test(txt),
      label + ' over-promises: the dossier answers and filenames DO travel with an offer: ' + txt);
  }
  dom.window.close();
});

test('the fine print is honest about a real POST: clientWelcome sends the courriel', () => {
  // Guard the premise itself — if this call ever stops existing, the copy
  // should be revisited rather than left stale in the other direction.
  assert.match(APP_SRC, /function clientWelcome\([\s\S]{0,400}\/client\/welcome/,
    'clientWelcome must still POST the courriel — the copy is written for that fact');
  // Nothing uploads file contents: no FormData, no data-URL read of a file.
  assert.ok(!/FormData|readAsDataURL|readAsArrayBuffer/.test(APP_SRC),
    'a file-upload path appeared — « le contenu de vos documents ne quitte jamais cet appareil » would become false');
});

// ---------------------------------------------------------------------------
// 2. Data at rest is Canadian; transit is not. Say both.
// ---------------------------------------------------------------------------
const COUNTRY_LIE = /ne quittent pas le pays|never leaves the country/i;

test('no surface promises the data never leaves the country', () => {
  for (const [name, src] of Object.entries({ 'index.html': HTML_SRC, 'i18n.js': I18N_SRC })) {
    assert.ok(!COUNTRY_LIE.test(src),
      name + ' still promises the data never leaves the country — CloudFront is PriceClass_100 (US + EU edges)');
  }
});

test('the hosting card keeps its true title and names what actually crosses the border', () => {
  const flat = FLAT(HTML_SRC);
  assert.match(flat, /<h3>Hébergé au Canada<\/h3>/, 'the title is true and stays');
  const card = flat.slice(flat.indexOf('Hébergé au Canada'), flat.indexOf('Hébergé au Canada') + 700);
  // The defensible half, kept.
  assert.match(card, /ca-central-1/, 'the region is named');
  assert.match(card, /conservées|repos/, 'and it is scoped to data at rest');
  // The half that was missing.
  assert.match(card, /réseau de diffusion|points de présence/, 'the CDN is disclosed');
  assert.match(card, /États-Unis/, 'including that its edges are in the US');
  assert.match(card, /Stripe/, 'the payment processor is named');
  assert.match(card, /rsms\.me|police/, 'and the third-party font host');
});

test('the hosting card’s English side says the same thing', () => {
  I18N.force('en');
  const dict = I18N.dictionaries();
  const key = Object.keys(dict.html).find((k) => k.includes('ca-central-1'));
  assert.ok(key, 'the hosting sentence is an HTML entry (it contains <strong>)');
  const en = dict.html[key];
  assert.ok(!COUNTRY_LIE.test(en), 'the English side still promises the country claim: ' + en);
  assert.match(en, /United States/, en);
  assert.match(en, /Stripe/, en);
});

// ---------------------------------------------------------------------------
// 3. The invented probability is gone; the mechanism stays.
// ---------------------------------------------------------------------------
test('the day dialog no longer prints a probability of getting a notary', async () => {
  const { doc, dom } = await boot();
  const iso = addDays(todayISO(), 5);
  const cell = doc.querySelector('.cal-cell[data-date="' + iso + '"]');
  assert.ok(cell, 'a bookable day is on screen');
  cell.click();
  await wait(40);

  const line = FLAT($(doc, 'day-chance').textContent);
  assert.ok(line.length > 0, 'the explainer still exists at the decision point');
  // No number, of any shape, anywhere in it.
  assert.ok(!/\d/.test(line), 'a figure survives in the chance line: ' + line);
  assert.ok(!/%/.test(line), 'a percentage survives: ' + line);
  assert.ok(!/[Cc]hances? d’obtenir/.test(line), 'the retired framing is back: ' + line);
  // And no qualitative scale, which would still mimic a measurement.
  for (const scale of ['élevée', 'faible', 'moyenne', 'bonne', 'mauvaise', 'forte', 'probab']) {
    assert.ok(!line.toLowerCase().includes(scale), 'a scale that mimics a measurement (« ' + scale + ' »): ' + line);
  }
  // What it must say instead: the mechanism, which is true and checkable.
  assert.match(line, /éloignée/, 'the mechanism names the far date: ' + line);
  assert.match(line, /rapprochée/, 'and the near one: ' + line);
  assert.match(line, /notaires/, 'and who it is about: ' + line);
  dom.window.close();
});

test('the invented percentage is gone from the sources and from the dictionary', () => {
  // A comment may narrate the removal; a STRING LITERAL may not bring it back.
  assert.ok(!/['\u2019"«]\s*Chances d\u2019obtenir un notaire/.test(APP_SRC), 'app.js still composes the chance sentence');
  assert.ok(!/Chances d\u2019obtenir un notaire/.test(I18N_SRC), 'i18n.js still carries its rule');
  assert.ok(!/Chances of getting a notary/.test(I18N_SRC), 'i18n.js still carries the English side');
  assert.ok(!/D\.obtainChance\(/.test(APP_SRC), 'app.js still CALLS domain.obtainChance for display');
});

test('the three replacements are translated', () => {
  I18N.force('en');
  const covered = (s) => assert.ok(I18N.covered(s), 'no English entry for: ' + s);
  covered('Plus la date est éloignée, plus de notaires ont la latitude de s’organiser pour la prendre ; une date rapprochée en laisse moins.');
  const en = I18N.tEn('Plus la date est éloignée, plus de notaires ont la latitude de s’organiser pour la prendre ; une date rapprochée en laisse moins.');
  assert.ok(!/\d|%/.test(en), 'the English side must not reintroduce a figure: ' + en);
});
