/**
 * Une porte qui exige un compte ne s'ouvre pas — et ne s'affiche pas.
 *
 * Le propriétaire, 2026-09-12 : « les sections qui doivent nécessiter une
 * authentification ne sont pas disponibles. Donc la signature ne doit pas être
 * disponible tant et aussi longtemps que l'usager ne soit pas signé. Faire de
 * même pour tous les autres. »
 *
 * Jusque-là, « Signature » s'affichait dans l'en-tête et dans le tiroir pour
 * tout le monde, et `#t=beta` ouvrait le panneau à un visiteur anonyme.
 *
 * Le profil et le dossier ne sont PAS de la liste : ce sont les surfaces où
 * l'on DEVIENT authentifié — le profil est l'endroit où un client inscrit
 * l'adresse qui le connecte sur cet appareil, et un client qui a publié sans
 * compte détient le jeton de son offre dans ce navigateur. Les fermer
 * enfermerait les gens dehors de leur propre porte d'entrée.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const WINDOWS = [];
after(() => WINDOWS.forEach((window) => { try { window.close(); } catch {} }));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

async function boot({ hash = '', profil = null, offres = null } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/' + hash,
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
  WINDOWS.push(dom.window);
  const { window } = dom;
  window.localStorage.setItem('nota.introSeen', '1');
  window.localStorage.setItem('nota.onboarded.v1', '1');
  if (profil) window.localStorage.setItem('nota.profile.v1', JSON.stringify(profil));
  if (offres) window.localStorage.setItem('nota.myoffers.v1', JSON.stringify(offres));
  window.eval(DOMAIN_SRC);
  const D = window.NotaDomain;
  window.localStorage.setItem('nota.bids.v1', JSON.stringify(D.makeFixtures(todayISO())));
  window.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  window.eval(APP_SRC);
  await wait(80);
  return { window, doc: window.document };
}

const shown = (doc, sel) => {
  const el = doc.querySelector(sel);
  return !!el && !el.hidden;
};

test('anonyme : la porte « Signature » ne s’affiche nulle part', async () => {
  const { doc } = await boot();
  assert.equal(shown(doc, '#tab-beta'), false, 'l’onglet d’en-tête');
  assert.equal(shown(doc, '.mnav-link[data-tab="beta"]'), false, 'le lien du tiroir');
  // Les portes publiques, elles, restent ouvertes.
  assert.equal(shown(doc, '#tab-carnet'), true);
  assert.equal(shown(doc, '#tab-notaires'), true);
  assert.equal(shown(doc, '#tab-partenaires'), true);
});

test('anonyme : un lien profond vers la signature retombe sur le carnet', async () => {
  const { doc } = await boot({ hash: '#t=beta' });
  assert.equal(doc.getElementById('pane-beta').hidden, true, 'le panneau reste fermé');
  assert.equal(doc.getElementById('pane-carnet').hidden, false, 'le visiteur atterrit au carnet');
});

test('signé : la porte s’ouvre', async () => {
  const { doc } = await boot({ profil: { courriel: 'client@exemple.test', nom: 'Client' }, hash: '#t=beta' });
  assert.equal(shown(doc, '#tab-beta'), true, 'l’onglet revient dans l’en-tête');
  assert.equal(doc.getElementById('pane-beta').hidden, false, 'et le lien profond ouvre le panneau');
});

test('le profil et le dossier restent ouverts : on y devient authentifié', async () => {
  const profil = await boot({ hash: '#t=profil' });
  assert.equal(profil.doc.getElementById('pane-profil').hidden, false, 'le profil porte le champ courriel qui connecte');

  const dossier = await boot({
    hash: '#t=dossier',
    offres: [{ id: 'B-1', dateISO: todayISO(), serviceId: 'refinancement', clientToken: 'jeton' }],
  });
  assert.equal(dossier.doc.getElementById('pane-dossier').hidden, false, 'une offre détenue authentifie par jeton');
});
