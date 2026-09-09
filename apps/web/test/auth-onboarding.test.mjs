/**
 * LA PORTE D'ENTRÉE — s'inscrire et se connecter, et ce qui arrive bientôt.
 *
 * Décision du propriétaire (2026-09-06) : exposer Google, Microsoft et LinkedIn
 * comme portes à venir. Le dépôt les avait RETIRÉES le 2026-08-28 (« No dead
 * social doors — they return the day OAuth is actually wired ») ; elles
 * reviennent, mais annoncées pour ce qu'elles sont.
 *
 * Ce que « bien fait » veut dire ici :
 *
 *   • Le COURRIEL reste premier. La convention du web met les boutons sociaux
 *     en haut — mais cette convention suppose qu'ils FONCTIONNENT. Placer trois
 *     boutons morts au-dessus du seul chemin qui marche ferait cliquer là
 *     d'abord, pour rien. Ils passent donc sous le séparateur, et remonteront
 *     le jour où OAuth est câblé.
 *   • Un bouton qui ne fait rien ne doit pas se taire : `aria-disabled` plutôt
 *     que `disabled` (le clavier peut l'atteindre et donc le DÉCOUVRIR),
 *     `aria-describedby` qui explique, et un clic qui répond.
 *   • On peut passer d'« inscription » à « connexion » SANS fermer la porte.
 *     C'est la convention universelle, et c'était le vrai manque : il fallait
 *     fermer la modale et viser l'autre bouton de l'en-tête.
 *   • L'ordre des fournisseurs suit le métier : LinkedIn d'abord pour un
 *     notaire (réseau professionnel), Google d'abord pour un client.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const srcOf = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const I18N_SRC = srcOf('../public/i18n.js');
const DOMAIN_SRC = srcOf('../../../packages/domain/index.js');
const APP_SRC = srcOf('../public/app.js');
const HTML_SRC = srcOf('../public/index.html');

const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* déjà fermée */ } } });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot({ lang = 'fr', fetchStub } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.setItem('nota.lang', lang);
      window.scrollTo = () => {};
      window.fetch = (url, opts) => {
        calls.push({ url: String(url), opts: opts || {} });
        const r = fetchStub && fetchStub(String(url), opts || {});
        return r || Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      };
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  win.eval(I18N_SRC);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80);
  return { win, doc: win.document, Nota: win.Nota, calls };
}

const $ = (doc, id) => doc.getElementById(id);
const txt = (n) => (n ? n.textContent : '');
const socials = (doc) => [...doc.querySelectorAll('#auth-dialog .auth-soc-btn')];

// ===========================================================================
// 1. LES TROIS PORTES À VENIR
// ===========================================================================

test('les trois fournisseurs sont exposés, chacun nommé', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  const btns = socials(doc);
  assert.equal(btns.length, 3, 'Google, Microsoft, LinkedIn');
  const fournisseurs = btns.map((b) => b.dataset.provider).sort();
  assert.deepEqual(fournisseurs, ['google', 'linkedin', 'microsoft']);
  btns.forEach((b) => {
    assert.ok(txt(b).trim().length, 'chaque bouton porte un libellé lisible');
    assert.ok(b.querySelector('svg'), 'et la marque du fournisseur');
  });
});

test('aucun ne PRÉTEND fonctionner : chacun s’annonce à venir', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  socials(doc).forEach((b) => {
    assert.equal(b.getAttribute('aria-disabled'), 'true', 'annoncé indisponible à la technologie d’assistance');
    // `disabled` retirerait le bouton du parcours clavier : on ne peut pas
    // découvrir ce qu'on ne peut pas atteindre.
    assert.equal(b.disabled, false, 'mais toujours atteignable au clavier');
    assert.ok(b.getAttribute('aria-describedby'), 'et rattaché à l’explication');
    const badge = b.querySelector('.auth-soc-soon');
    assert.ok(badge && badge.textContent.trim().length, 'un marqueur d’état vit SUR le bouton');
    assert.ok(txt(b).indexOf(badge.textContent) >= 0, 'et il se lit avec le libellé');
  });
});

test('un clic répond — jamais un bouton qui avale le geste en silence', async () => {
  const { win, doc } = await boot();
  $(doc, 'header-signup').click();
  const g = socials(doc).find((b) => b.dataset.provider === 'google');
  g.click();
  await wait(30);
  // La réponse doit être DANS la modale : une <dialog> ouverte par showModal()
  // occupe la couche supérieure, et un toast au <body> peindrait dessous —
  // invisible là même où l'on vient de cliquer.
  const live = $(doc, 'auth-soc-live');
  assert.ok(live, 'la modale porte sa propre ligne de réponse');
  assert.ok($(doc, 'auth-dialog').contains(live), 'et elle vit DANS la modale');
  assert.match(live.textContent, /Google/, 'elle nomme le fournisseur cliqué');
  assert.match(live.textContent, /bientôt/i, 'et dit que ça s’en vient');
  assert.equal(live.getAttribute('role'), 'status', 'annoncée sans voler le focus');
  assert.equal($(doc, 'auth-dialog').open, true, 'la porte reste ouverte : rien n’est perdu');
});

test('un fournisseur à venir n’envoie RIEN sur le réseau', async () => {
  const { doc, calls } = await boot();
  $(doc, 'header-signup').click();
  socials(doc).forEach((b) => b.click());
  await wait(30);
  const auth = calls.filter((c) => !c.url.endsWith('/auth/oauth/providers') && /oauth|google|microsoft|linkedin|session\/request/.test(c.url));
  assert.deepEqual(auth, [], 'aucun appel : il n’y a rien au bout');
});

test('l’explication est rattachée et dit quoi faire EN ATTENDANT', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  const note = $(doc, socials(doc)[0].getAttribute('aria-describedby'));
  assert.ok(note, 'la note existe');
  assert.ok(/courriel/i.test(txt(note)), 'elle renvoie au chemin qui marche aujourd’hui');
});

// ===========================================================================
// 2. LA HIÉRARCHIE — le courriel d'abord, parce que lui fonctionne
// ===========================================================================

test('le formulaire courriel PRÉCÈDE les portes à venir', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  const form = $(doc, 'auth-email-form');
  const soc = doc.querySelector('#auth-dialog .auth-social');
  assert.ok(soc, 'le bloc social existe');
  // compareDocumentPosition & 4 = « soc suit form dans le document »
  assert.ok(form.compareDocumentPosition(soc) & 4, 'le seul chemin qui marche est le premier');
});

test('un séparateur sépare les deux, et il est décoratif', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  const or = doc.querySelector('#auth-dialog .auth-or');
  assert.ok(or, 'le séparateur est là — la convention du web');
  assert.equal(or.getAttribute('aria-hidden'), 'true', 'purement visuel : rien à annoncer deux fois');
});

test('l’ordre des fournisseurs suit le métier', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  // Client : Google d'abord (grand public).
  assert.equal(socials(doc)[0].dataset.provider, 'google');
  // Notaire : LinkedIn d'abord (réseau professionnel).
  doc.querySelector('#auth-role .seg-btn[data-role="notary"]').click();
  await wait(10);
  assert.equal(socials(doc)[0].dataset.provider, 'linkedin', 'un notaire voit d’abord le réseau de son métier');
});

// ===========================================================================
// 3. PASSER D'UNE PORTE À L'AUTRE SANS FERMER
// ===========================================================================

test('on bascule inscription ↔ connexion depuis la modale', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  assert.equal(txt($(doc, 'auth-title')), 'Enregistrer votre courriel');

  const bascule = $(doc, 'auth-switch-btn');
  assert.ok(bascule, 'la bascule existe');
  bascule.click();
  await wait(10);
  assert.equal(txt($(doc, 'auth-title')), 'Connexion', 'on est passé à la connexion');
  assert.equal($(doc, 'auth-dialog').open, true, 'sans jamais fermer la porte');

  bascule.click();
  await wait(10);
  assert.equal(txt($(doc, 'auth-title')), 'Enregistrer votre courriel', 'et on revient');
});

test('la bascule garde le courriel déjà tapé et le rôle choisi', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  doc.querySelector('#auth-role .seg-btn[data-role="notary"]').click();
  $(doc, 'auth-email').value = 'me@etude.ca';
  $(doc, 'auth-switch-btn').click();
  await wait(10);
  assert.equal($(doc, 'auth-email').value, 'me@etude.ca', 'on ne retape pas son adresse');
  assert.equal(
    doc.querySelector('#auth-role .seg-btn[data-role="notary"]').getAttribute('aria-pressed'), 'true',
    'et on ne redit pas qui on est'
  );
});

test('la bascule nomme la destination, jamais l’état courant', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  // En inscription, elle propose la CONNEXION — sinon elle décrit la page
  // qu'on regarde déjà, ce qui ne dit pas où l'on va.
  assert.ok(/connect/i.test(txt($(doc, 'auth-switch'))), 'depuis l’inscription, elle mène à la connexion');
  $(doc, 'auth-switch-btn').click();
  await wait(10);
  assert.ok(/inscri|compte/i.test(txt($(doc, 'auth-switch'))), 'et inversement');
});

// ===========================================================================
// 4. LES DEUX CHEMINS QUI MARCHENT MARCHENT TOUJOURS
// ===========================================================================

test('inscription client : deux clics, l’adresse sur l’appareil', async () => {
  const { win, doc, Nota, calls } = await boot();
  $(doc, 'header-signup').click();
  $(doc, 'auth-email').value = 'nouveau@client.ca';
  $(doc, 'auth-email-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await wait(30);
  assert.equal(Nota.account.role(), 'client');
  assert.ok(calls.some((c) => c.url.includes('/client/welcome')));
});

test('connexion client : le lien de reprise part, et rien n’est prétendu', async () => {
  const { win, doc, Nota, calls } = await boot();
  $(doc, 'header-login').click();
  $(doc, 'auth-email').value = 'roy@exemple.ca';
  $(doc, 'auth-email-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await wait(30);
  assert.ok(calls.some((c) => c.url.includes('/client/session/request')));
  assert.equal(Nota.account.role(), 'anon', 'demander un lien ne connecte pas');
});

test('les portes à venir n’existent PAS en double dans la page', async () => {
  // Un bouton social hors de la modale serait une seconde porte à maintenir.
  const { doc } = await boot();
  // Fermée, la porte n'en peint aucun : ils naissent à l'ouverture.
  assert.equal(doc.querySelectorAll('.auth-soc-btn').length, 0, 'rien tant que la porte est fermée');

  $(doc, 'header-signup').click();
  const tous = doc.querySelectorAll('.auth-soc-btn');
  assert.equal(tous.length, 3, 'trois au total dans toute la page');
  const dlg = $(doc, 'auth-dialog');
  tous.forEach((b) => assert.ok(dlg.contains(b), 'et chacun DANS la modale — pas une seconde porte ailleurs'));

  // Rouvrir ne les empile pas : chaque rendu repart d'une liste vide.
  $(doc, 'auth-dialog').close();
  $(doc, 'header-login').click();
  assert.equal(doc.querySelectorAll('.auth-soc-btn').length, 3, 'toujours trois après une réouverture');
});

test('account tour follows client sections, supports Back, Skip, and replay', async () => {
  const { win, doc } = await boot();
  doc.querySelectorAll('dialog[open]').forEach(d => d.close());
  $(doc, 'header-signup').click();
  $(doc, 'auth-email').value = 'tour@example.test';
  $(doc, 'auth-email-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  const tour = () => doc.querySelector('.account-tour');
  const click = label => [...tour().querySelectorAll('button')].find(b => b.textContent === label).click();
  assert.ok(tour()?.open);
  assert.match(tour().textContent, /1 \/ 5/);
  assert.ok($(doc, 'profil-offers').classList.contains('account-tour-target'));
  click('Suivant');
  assert.ok($(doc, 'profil-contact').classList.contains('account-tour-target'));
  click('Retour');
  assert.match(tour().textContent, /1 \/ 5/);
  click('Passer la visite');
  assert.equal(tour(), null);
  assert.equal(doc.querySelector('.account-tour-target'), null);
  doc.querySelector('.account-tour-replay').click();
  for (let i = 0; i < 4; i++) click('Suivant');
  assert.match(tour().textContent, /5 \/ 5/);
  click('Terminer la visite');
  assert.equal(tour(), null);
  assert.equal(win.localStorage.getItem('nota.account-tour.v1.client.tour%40example.test'), 'done');
  win.close();
});

test('account tour Escape dismisses and clears the highlighted section', async () => {
  const { win, doc } = await boot();
  doc.querySelectorAll('dialog[open]').forEach(d => d.close());
  $(doc, 'header-signup').click();
  $(doc, 'auth-email').value = 'escape@example.test';
  $(doc, 'auth-email-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  doc.querySelector('.account-tour').dispatchEvent(new win.Event('cancel', { cancelable: true }));
  assert.equal(doc.querySelector('.account-tour'), null);
  assert.equal(doc.querySelector('.account-tour-target'), null);
  win.close();
});

test('notary tour covers setup, calendar, requests, files and payments only once', async () => {
  const { win, doc, Nota } = await boot({ fetchStub: (url) => url.includes('/notary/session/verify')
    ? { ok: true, status: 200, json: async () => ({ token: 'test-session', email: 'tour@notary.test' }) }
    : undefined });
  doc.querySelectorAll('dialog[open]').forEach(d => d.close());
  await Nota.notary.verifyMagic('test-challenge', 'tour@notary.test');
  assert.ok(doc.querySelector('.account-tour')?.open);
  const targets = ['#notary-profil', '.nc-cal', '#notary-open-h', '#notary-retained-h', '#notary-connect'];
  for (let i = 0; i < targets.length; i++) {
    assert.ok(doc.querySelector(targets[i]).classList.contains('account-tour-target'));
    const buttons = [...doc.querySelector('.account-tour').querySelectorAll('button')];
    buttons.find(b => b.textContent === (i === 4 ? 'Terminer la visite' : 'Suivant')).click();
  }
  assert.equal(doc.querySelector('.account-tour'), null);
  await Nota.notary.verifyMagic('another-challenge', 'tour@notary.test');
  assert.equal(doc.querySelector('.account-tour'), null);
  assert.ok(doc.querySelector('#notary-authed .account-tour-replay'));
  win.close();
});
