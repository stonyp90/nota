/**
 * Conversion defaults in the booking dialog: the questions whose dominant
 * answer costs nothing (succession = Non, déplacement = the +0 « je me
 * déplace » band) arrive PRE-ANSWERED, so a typical client only fills the
 * three that genuinely vary — montant, approbation bancaire, prêteur. A
 * dossier answer always wins over the default, and a default never moves
 * the floor (its add is 0 by domain invariant).
 *
 * Boot harness mirrors client-offers.test.mjs (domain then app inside jsdom,
 * offline fetch → local demo store).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

async function boot() {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, D: win.NotaDomain };
}

async function openRefinancement(win, doc) {
  const iso = addDays(todayISO(), 6);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(20);
  return iso;
}

test('succession and déplacement arrive pre-answered with their zero-cost defaults', async () => {
  const { win, doc } = await boot();
  await openRefinancement(win, doc);

  const non = $(doc, 'crit-succession__non');
  assert.ok(non, 'the succession chips render');
  assert.equal(non.getAttribute('aria-pressed'), 'true', '« Non » is pre-selected');
  assert.equal($(doc, 'crit-deplacement').value, 'client_50', 'the +0 déplacement band is pre-selected');

  // The hint only names what still needs input — never the pre-answered pair.
  const hint = $(doc, 'offer-hint');
  assert.ok(hint && !hint.hidden, 'the CTA still explains what is missing');
  assert.match(hint.textContent, /Montant du nouveau prêt/);
  assert.match(hint.textContent, /Approbation bancaire/);
  assert.match(hint.textContent, /Prêteur hypothécaire/);
  assert.ok(!/succession/i.test(hint.textContent), 'succession is pre-answered');
  assert.ok(!/Déplacement/.test(hint.textContent), 'déplacement is pre-answered');
});

test('six inputs left: montant + approbation + prêteur + secteur postal + nom + courriel enable the CTA', async () => {
  const { win, doc } = await boot();
  await openRefinancement(win, doc);
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));

  const lv = $(doc, 'crit-valeur_pret'); lv.value = '300000'; fire(lv, 'input');
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  const selPreteur = $(doc, 'crit-preteur'); selPreteur.value = 'banque_nationale'; fire(selPreteur, 'change');

  // The REQUIRED postal sector (domain: prefixe_requis).
  assert.equal($(doc, 'offer-submit').disabled, true, 'still blocked without the postal sector');
  const pre = $(doc, 'o-prefix'); pre.value = 'G1R'; fire(pre, 'input');

  // ADR 0033 — the identity the retaining notary needs: name + courriel are
  // the last gate (the téléphone is recommended, never required).
  assert.equal($(doc, 'offer-submit').disabled, true, 'still blocked without the identity');
  const nom = $(doc, 'o-name'); nom.value = 'Prénom Nom'; fire(nom, 'input');
  const em = $(doc, 'o-courriel'); em.value = 'client@exemple.ca'; fire(em, 'input');

  assert.equal($(doc, 'offer-submit').disabled, false, 'defaults + 6 answers = publishable');
});

test('a dossier answer wins over the default', async () => {
  const { win, doc } = await boot();
  await openRefinancement(win, doc);

  // The client flips succession to Oui (recorded in the dossier), leaves and
  // returns to the act: the default must NOT clobber the recorded answer.
  $(doc, 'crit-succession__oui').click();
  await wait(10);
  doc.querySelector('#o-service-chips .chip[data-svc="financement"]').click();
  await wait(20);
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(20);
  assert.equal($(doc, 'crit-succession__oui').getAttribute('aria-pressed'), 'true',
    'the recorded « Oui » survives the round-trip');
});

test('the montant field wears its $ unit', async () => {
  const { win, doc } = await boot();
  await openRefinancement(win, doc);
  const inp = $(doc, 'crit-valeur_pret');
  const wrap = inp.closest('.crit-unit-wrap');
  assert.ok(wrap, 'the bracket input is wrapped with its unit');
  assert.equal(wrap.querySelector('.crit-unit').textContent, '$');
});
