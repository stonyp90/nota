/**
 * La porte d'inscription du notaire — elle doit dire la vérité.
 *
 * Deux défauts tenaient ensemble avant le 2026-09-05 :
 *
 *   1. « Je suis notaire » + « Créer votre compte » appelait `ncSignIn`, quel
 *      que soit le mode. L'API `/notary/session/request` est volontairement
 *      anti-énumération : pour une adresse inconnue elle répond 200 sans rien
 *      envoyer. L'écran affirmait pourtant « Nous venons d'envoyer un lien de
 *      connexion sécurisé à … ». Aucun courriel n'arrivait JAMAIS.
 *
 *   2. Le bouton « Créer mon compte gratuit » appelait `/notaries/connect`
 *      (Stripe), qui rend 503 tant que la facturation n'est pas configurée —
 *      l'état de la production. `/notaries/signup`, la porte SANS Stripe,
 *      était construite et testée côté API mais n'avait aucun appelant web.
 *      Voir [[code-teste-sans-appelant]] : une route sans appelant ne reste
 *      pas neutre, l'interface finit par mentir à sa place.
 *
 * Ces tests traversent la couture : vraie page en jsdom, vrai app.js, et on
 * observe les APPELS RÉSEAU réellement émis — pas un bouchon de chaque côté.
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
      window.localStorage.setItem('nota.lang', 'fr'); // on vérifie la copie canonique
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
  return { win, doc: win.document };
}

const $ = (doc, id) => doc.getElementById(id);
const fire = (win, node, type) => node.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true }));
const shown = (node) => !!node && !node.hidden;

// Emmène la modale jusqu'à la soumission, en mode « inscription » (S'inscrire)
// ou « connexion » (Se connecter), rôle notaire.
async function submitAsNotary(win, doc, { mode, email }) {
  $(doc, mode === 'signin' ? 'header-login' : 'header-signup').click();
  doc.querySelector('#auth-role .seg-btn[data-role="notary"]').click();
  $(doc, 'auth-email').value = email;
  fire(win, $(doc, 'auth-email-form'), 'submit');
  await wait(20);
}

test('« Créer votre compte » ne prétend JAMAIS avoir envoyé un lien', async () => {
  const calls = [];
  const { win, doc } = await boot({
    fetchStub: (url, opts) => {
      calls.push({ url: String(url), opts: opts || {} });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    },
  });

  await submitAsNotary(win, doc, { mode: 'signup', email: 'nouvelle@etude.ca' });

  // Le défaut historique : l'étape « vérifiez votre boîte » sur une inscription.
  assert.equal(
    shown($(doc, 'notary-gate-step-sent')), false,
    'une inscription ne doit pas afficher « Nous venons d’envoyer un lien »'
  );
  assert.ok(
    !calls.some((c) => c.url.includes('/notary/session/request')),
    'aucun lien magique n’est demandé pour une adresse qui n’a pas encore de compte'
  );
  // Ce qu'elle doit faire : ouvrir l'étape d'inscription, sur cette adresse.
  assert.ok(shown($(doc, 'notary-signup-prompt')), 'l’inscription ouvre l’étape d’inscription');
  assert.equal(
    $(doc, 'notary-signup-email').textContent, 'nouvelle@etude.ca',
    'l’adresse saisie est reprise — elle ne se retape pas'
  );
});

test('« Se connecter » demande toujours le lien magique (le chemin existant est intact)', async () => {
  const calls = [];
  const { win, doc } = await boot({
    fetchStub: (url, opts) => {
      calls.push({ url: String(url), opts: opts || {} });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    },
  });

  await submitAsNotary(win, doc, { mode: 'signin', email: 'connue@etude.ca' });

  assert.ok(
    calls.some((c) => c.url.includes('/notary/session/request')),
    'une connexion demande bien le lien'
  );
  assert.ok(shown($(doc, 'notary-gate-step-sent')), 'et annonce la boîte de réception');
});

test('« Créer mon compte gratuit » passe par /notaries/signup, jamais par Stripe', async () => {
  const calls = [];
  const { win, doc } = await boot({
    fetchStub: (url, opts) => {
      calls.push({ url: String(url), opts: opts || {} });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    },
  });

  await submitAsNotary(win, doc, { mode: 'signup', email: 'nouvelle@etude.ca' });
  $(doc, 'notary-signup-btn').click();
  await wait(30);

  const signup = calls.filter((c) => c.url.includes('/notaries/signup'));
  assert.equal(signup.length, 1, 'la porte gratuite est appelée une fois');
  assert.equal(
    JSON.parse(signup[0].opts.body).email, 'nouvelle@etude.ca',
    'sur l’adresse saisie'
  );
  assert.ok(
    !calls.some((c) => c.url.includes('/notaries/connect')),
    'l’inscription ne dépend plus de Stripe — /notaries/connect rend 503 sans facturation'
  );
});

test('après l’inscription, l’écran annonce une VÉRIFICATION, pas une console ouverte', async () => {
  const { win, doc } = await boot({
    fetchStub: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }),
  });

  await submitAsNotary(win, doc, { mode: 'signup', email: 'nouvelle@etude.ca' });
  $(doc, 'notary-signup-btn').click();
  await wait(30);

  const pending = $(doc, 'notary-gate-step-pending');
  assert.ok(shown(pending), 'une étape de confirmation existe');
  assert.equal(shown($(doc, 'notary-signup-prompt')), false, 'et remplace le formulaire');

  const txt = pending.textContent;
  assert.ok(/nouvelle@etude\.ca/.test(txt), 'elle nomme l’adresse inscrite');
  assert.ok(
    /vérifi|Tableau de l’Ordre/i.test(txt),
    'elle dit qu’une vérification a lieu — l’accès est l’approbation de l’opérateur'
  );
  // Le contrat de la route : `status: 'en_attente'`. Promettre l'ouverture
  // immédiate serait le mensonge d'avant, déplacé d'un écran.
  assert.ok(
    !/aussitôt|immédiat/i.test(txt),
    'elle ne promet aucune ouverture immédiate de la console'
  );
});

test('le code de référence saisi voyage avec l’inscription (ADR 0011)', async () => {
  const calls = [];
  const { win, doc } = await boot({
    fetchStub: (url, opts) => {
      calls.push({ url: String(url), opts: opts || {} });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    },
  });

  await submitAsNotary(win, doc, { mode: 'signup', email: 'nouvelle@etude.ca' });
  $(doc, 'nc-signup-parrain').value = 'marie';
  $(doc, 'notary-signup-btn').click();
  await wait(30);

  const body = JSON.parse(calls.find((c) => c.url.includes('/notaries/signup')).opts.body);
  assert.equal(body.parrain, 'MARIE', 'normalisé par le domaine avant de partir');
});

test('une inscription refusée laisse la porte ouverte et dit pourquoi', async () => {
  const { win, doc } = await boot({
    fetchStub: (url) => (String(url).includes('/notaries/signup')
      ? Promise.resolve({
        ok: false, status: 422,
        json: () => Promise.resolve({ errors: [{ code: 'courriel_invalide', message: 'Le courriel n’est pas valide.' }] }),
      })
      : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })),
  });

  await submitAsNotary(win, doc, { mode: 'signup', email: 'nouvelle@etude.ca' });
  $(doc, 'notary-signup-btn').click();
  await wait(30);

  assert.equal(shown($(doc, 'notary-gate-step-pending')), false, 'aucune confirmation sur un refus');
  assert.ok(shown($(doc, 'notary-signup-prompt')), 'le formulaire reste à l’écran');
  const errs = $(doc, 'notary-signup-errors');
  assert.ok(shown(errs) && /courriel/i.test(errs.textContent), 'la raison est lisible');
  const btn = $(doc, 'notary-signup-btn');
  assert.equal(btn.disabled, false, 'et le bouton se réarme pour un second essai');
});
