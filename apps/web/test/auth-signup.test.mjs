/**
 * The signup/sign-in door (owner, 2026-08-28: « comme un site traditionnel,
 * en trois clics ») — ONE clean modal behind both header buttons:
 *   • no dead social doors, no « ou » divider — role → courriel → one CTA;
 *   • the title matches the button that opened it (Connexion / Créer votre
 *     compte) and the CTA names the exact action;
 *   • a client signs up in TWO clicks (S'inscrire → Créer mon compte);
 *   • the notary path says a link is coming and requests it (3rd click is in
 *     their inbox — the magic link stays, it is the security boundary).
 * Boots the real page (index.html + i18n.js + domain.js + app.js) in jsdom.
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot({ fetchStub } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.setItem('nota.lang', 'fr'); // assert the canonical copy
      window.fetch = fetchStub || (() => Promise.reject(new Error('offline')));
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
    },
  });
  const win = dom.window;
  win.eval(I18N_SRC);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80);
  return { win, doc: win.document, Nota: win.Nota };
}

const $ = (doc, id) => doc.getElementById(id);
const fire = (win, node, type) => node.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true }));

test('the auth modal is ONE clean door: no social buttons, no divider — role, courriel, one CTA', async () => {
  const { doc } = await boot();
  const dlg = $(doc, 'auth-dialog');
  assert.equal(dlg.querySelectorAll('.auth-soc-btn').length, 0, 'the dead social doors are gone');
  assert.equal(dlg.querySelector('.auth-or'), null, 'no « ou » divider without an alternative');
  // Reading order: who you are, then the one field, then the one action.
  const order = [...dlg.querySelectorAll('#auth-role, #auth-email-form')].map((n) => n.id);
  assert.deepEqual(order, ['auth-role', 'auth-email-form']);
  assert.equal(dlg.querySelectorAll('#auth-email-form button[type="submit"]').length, 1, 'exactly one CTA');
});

test('both header buttons open the SAME door, titled for the button that opened it', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  await wait(10);
  assert.equal($(doc, 'auth-dialog').open, true, 'S’inscrire opens the signup door');
  assert.notEqual($(doc, 'onboarding-dialog').open, true, 'never the pedagogical guide');
  assert.equal($(doc, 'auth-title').textContent, 'Créer votre compte');
  assert.equal($(doc, 'auth-continue').textContent, 'Créer mon compte');
  $(doc, 'auth-dialog').close();

  $(doc, 'header-login').click();
  await wait(10);
  assert.equal($(doc, 'auth-dialog').open, true);
  assert.equal($(doc, 'auth-title').textContent, 'Connexion');
  assert.equal($(doc, 'auth-continue').textContent, 'Me connecter');
});

test('a client signs up in TWO clicks: S’inscrire → courriel → Créer mon compte', async () => {
  const calls = [];
  const { win, doc, Nota } = await boot({
    fetchStub: (url, opts) => {
      calls.push({ url: String(url), opts: opts || {} });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    },
  });
  $(doc, 'header-signup').click();            // click 1
  $(doc, 'auth-email').value = 'nouveau@client.ca';
  fire(win, $(doc, 'auth-email-form'), 'submit'); // click 2
  await wait(10);
  assert.equal(Nota.account.role(), 'client', 'signed in on the second click');
  assert.notEqual($(doc, 'auth-dialog').open, true, 'the door closes itself');
  assert.ok(calls.some((c) => c.url.includes('/client/welcome')), 'the welcome email fires');
});

test('the notary path says what happens and requests the magic link', async () => {
  const calls = [];
  const { win, doc } = await boot({
    fetchStub: (url, opts) => {
      calls.push({ url: String(url), opts: opts || {} });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    },
  });
  $(doc, 'header-signup').click();
  const seg = doc.querySelector('#auth-role .seg-btn[data-role="notary"]');
  seg.click();                                 // click 2
  assert.equal($(doc, 'auth-continue').textContent, 'Recevoir mon lien de connexion →', 'the CTA names the outcome');
  $(doc, 'auth-email').value = 'me@etude.ca';
  fire(win, $(doc, 'auth-email-form'), 'submit'); // click 3
  await wait(10);
  assert.ok(calls.some((c) => c.url.includes('/notary/session/request')), 'the magic link is requested');
});
