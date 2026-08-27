/**
 * Social sign-in options on the auth modal (Google / Facebook / LinkedIn).
 *
 * OAuth is not wired yet: the three buttons are visible but announced as
 * « Arrive bientôt » (aria-disabled), and a click never signs anyone in — it
 * surfaces the coming-soon line INSIDE the modal (a toast would paint under
 * the <dialog> top layer) and hands focus to the courriel path, which stays
 * the one real door. Boots the real page (index.html + i18n.js + domain.js +
 * app.js) in jsdom, same order as the browser.
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

// The same dictionary the page uses, so EN assertions never hardcode copy.
const I18N = (() => {
  const mod = { exports: {} };
  new Function('module', 'exports', I18N_SRC)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(lang) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      if (lang) window.localStorage.setItem('nota.lang', lang);
      window.fetch = () => Promise.reject(new Error('offline')); // offline path
    },
  });
  const win = dom.window;
  win.eval(I18N_SRC);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80); // async boot: seed + first render
  return win;
}

const PROVIDERS = ['Google', 'Facebook', 'LinkedIn'];

test('the auth modal offers the three social doors, marked « Arrive bientôt »', async () => {
  const win = await boot('fr');
  const doc = win.document;

  const btns = [...doc.querySelectorAll('#auth-dialog .auth-soc-btn')];
  assert.equal(btns.length, PROVIDERS.length, 'one button per provider');

  PROVIDERS.forEach((p, i) => {
    const b = btns[i];
    assert.equal(b.dataset.provider, p, `button ${i} is ${p}`);
    assert.equal(b.getAttribute('type'), 'button', `${p}: never submits the courriel form`);
    assert.equal(b.getAttribute('aria-disabled'), 'true', `${p}: announced as not yet available`);
    assert.ok(b.textContent.includes(`Continuer avec ${p}`), `${p}: carries its label`);
    const soon = b.querySelector('.auth-soon');
    assert.ok(soon, `${p}: carries the coming-soon chip`);
    assert.equal(soon.textContent.trim(), 'Arrive bientôt');
    assert.ok(b.querySelector('svg'), `${p}: carries its brand mark`);
  });

  // The « ou » divider separates the social block from the courriel path,
  // and the social block sits ABOVE the form it defers to.
  const or = doc.querySelector('#auth-dialog .auth-or');
  assert.ok(or, 'the divider exists');
  assert.equal(or.textContent.trim(), 'ou');
  const body = doc.querySelector('#auth-dialog .auth-body');
  const order = [...body.querySelectorAll('.auth-social, .auth-or, #auth-email-form')];
  assert.deepEqual(
    order.map((n) => n.id || n.className.split(' ')[0]),
    ['auth-social', 'auth-or', 'auth-email-form'],
    'social → ou → courriel, top to bottom'
  );
});

test('clicking a social door says « arrive bientôt » in the modal and points to the courriel path', async () => {
  const win = await boot('fr');
  const doc = win.document;

  const note = doc.getElementById('auth-soc-note');
  assert.equal(note.hidden, true, 'the note stays silent until a social click');

  const google = doc.querySelector('#auth-dialog .auth-soc-btn[data-provider="Google"]');
  google.click();

  // Inside the modal — a toast would paint under the <dialog> top layer.
  assert.equal(note.hidden, false);
  assert.equal(
    note.textContent,
    'La connexion avec Google arrive bientôt — continuez avec votre courriel.'
  );
  assert.equal(doc.activeElement, doc.getElementById('auth-email'), 'focus lands on the courriel field');

  // Another door updates the same line — one status region, no stacking.
  doc.querySelector('#auth-dialog .auth-soc-btn[data-provider="LinkedIn"]').click();
  assert.equal(
    note.textContent,
    'La connexion avec LinkedIn arrive bientôt — continuez avec votre courriel.'
  );

  // No identity was created: the click is a signpost, not a sign-in.
  assert.equal(win.localStorage.getItem('nota.profile.v1'), null);
});

test('English boot translates the social doors and the coming-soon chip', async () => {
  const win = await boot('en');
  const doc = win.document;

  for (const p of PROVIDERS) {
    const b = doc.querySelector(`#auth-dialog .auth-soc-btn[data-provider="${p}"]`);
    assert.ok(
      b.textContent.includes(I18N.tEn(`Continuer avec ${p}`)),
      `${p}: label is translated`
    );
    assert.equal(b.querySelector('.auth-soon').textContent.trim(), I18N.tEn('Arrive bientôt'));
  }
  assert.equal(doc.querySelector('#auth-dialog .auth-or').textContent.trim(), I18N.tEn('ou'));

  const google = doc.querySelector('#auth-dialog .auth-soc-btn[data-provider="Google"]');
  google.click();
  assert.equal(
    doc.getElementById('auth-soc-note').textContent,
    I18N.tEn('La connexion avec Google arrive bientôt — continuez avec votre courriel.')
  );
});
