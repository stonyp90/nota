/**
 * Montrer, pas décrire (propriétaire, 2026-09-12).
 *
 * Les animations se regardent là où le produit se vend :
 *   • page des notaires — une courte vidéo muette près des
 *     boutons Google / Outlook / Apple / .ics qui les y feront arriver
 *     pour de vrai ;
 *   • page des partenaires — le code voyage avec la réservation, l'acte se
 *     signe, la récompense part.
 *
 * Les tests pilotent le chemin « mouvement réduit », qui rend l'état FINAL sans
 * boucle : c'est le seul état déterministe, et c'est aussi celui que reçoit un
 * visiteur qui a demandé moins d'animation. Ils tiennent surtout la règle 1
 * d'AGENTS.md — aucun des deux montants n'est écrit dans la page.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const FILM_SRC = readFileSync(fileURLToPath(new URL('../public/agenda-demo.js', import.meta.url)), 'utf8');
// L'origine publique que la page déclare : les liens de partage sont bâtis
// dessus, jamais sur location.origin.
const SITE = (/<meta name="nota:site" content="([^"]+)"/.exec(HTML_SRC) || [null, 'https://nota.example'])[1];
const WINDOWS = [];
after(() => WINDOWS.forEach((window) => { try { window.close(); } catch {} }));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

async function boot(hash) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/' + hash,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      // Mouvement réduit : la vignette rend son dernier état d'un coup.
      window.matchMedia = (q) => ({
        matches: /prefers-reduced-motion/.test(q), media: q,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      });
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
  window.eval(DOMAIN_SRC);
  const D = window.NotaDomain;
  window.localStorage.setItem('nota.bids.v1', JSON.stringify(D.makeFixtures(todayISO())));
  window.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  window.eval(APP_SRC);
  await wait(90);
  return { window, doc: window.document, D };
}

test('le calendrier est une courte vidéo sans son dans la carte d’abonnement', async () => {
  const { doc } = await boot('#t=notaires');
  const figure = doc.getElementById('nc-calendar-teaser');
  assert.ok(doc.getElementById('notary-carnet').contains(figure));
  const video = figure.querySelector('video');
  for (const attribute of ['muted', 'loop', 'playsinline']) assert.ok(video.hasAttribute(attribute));
  assert.equal(video.preload, 'none', 'la vidéo ne charge pas sur les autres pages');
  assert.match(video.dataset.filmFr, /nota-agenda-fr\.mp4\?v=[a-f0-9]{10}$/);
  assert.match(video.dataset.filmEn, /nota-agenda-en\.mp4\?v=[a-f0-9]{10}$/);
  assert.equal(figure.querySelector('figcaption, button, [controls]'), null, 'le calendrier reste sans bande de commandes');
  assert.equal(doc.querySelector('.nc-calendar-film-link'), null, 'la vidéo se regarde sur place');
});

test('le calendrier sans commandes démarre à l’écran et respecte le mouvement réduit', () => {
  const dom = new JSDOM(HTML_SRC, { runScripts: 'outside-only', pretendToBeVisual: true });
  WINDOWS.push(dom.window);
  const { window } = dom;
  const video = window.document.querySelector('#nc-calendar-teaser video');
  let observe, onMotion, plays = 0, pauses = 0;
  const motion = { matches: true, addEventListener(_type, listener) { onMotion = listener; } };
  window.matchMedia = () => motion;
  window.IntersectionObserver = class {
    constructor(callback) { observe = callback; }
    observe() {}
  };
  video.play = () => { plays++; return Promise.resolve(); };
  video.pause = () => { pauses++; };
  assert.doesNotThrow(() => window.eval(FILM_SRC), 'aucun bouton n’est nécessaire au lecteur');
  observe([{ isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(video.getAttribute('src'), null, 'le mouvement réduit conserve l’affiche');
  assert.equal(plays, 0);
  motion.matches = false;
  onMotion();
  assert.equal(plays, 1, 'la boucle démarre quand elle est visible');
  assert.equal(video.getAttribute('src'), video.dataset.filmFr);
  assert.equal(video.muted, true);
  const previousPauses = pauses;
  observe([{ isIntersecting: false, intersectionRatio: 0 }]);
  assert.ok(pauses > previousPauses, 'la lecture s’arrête hors écran');
});

// Le circuit du code (propriétaire, 2026-09-12 soir) : « une animation qui
// explique clairement comment la section partenaire fonctionne ». Un code,
// deux voies — le lien, qui remplit le champ tout seul, et le code donné de
// vive voix, que le client tape au moment de publier — puis une seule fin.
// Ce qui reste fermé, c'est la porte du TEXTE : la page ne redit rien, elle
// montre.
test('la page partenaires montre les deux voies du code', async () => {
  const { doc, D } = await boot('#t=partenaires');
  const figure = doc.getElementById('pr-flow');
  assert.ok(doc.getElementById('pane-partenaires').contains(figure), 'le circuit vit sur la porte des partenaires');
  // Mouvement réduit : l'état final, d'un coup, jamais une bande éteinte.
  for (const id of ['pr-fl-seed', 'pr-fl-step-lien', 'pr-fl-link', 'pr-fl-card-lien',
    'pr-fl-step-code', 'pr-fl-said', 'pr-fl-card-code', 'pr-fl-beat-publiee',
    'pr-fl-beat-retenue', 'pr-fl-beat-signe', 'pr-fl-end-vous', 'pr-fl-end-client']) {
    assert.ok(doc.getElementById(id).classList.contains('is-on'), id + ' est allumé en mouvement réduit');
  }
  // Le code montré est celui que le visiteur a déjà sous les yeux : l'exemple
  // du champ tant qu'il n'a pas réclamé le sien.
  const code = doc.getElementById('partner-code').placeholder;
  assert.equal(doc.getElementById('pr-fl-seed-code').textContent, code);
  assert.equal(doc.getElementById('pr-fl-link').textContent, SITE.replace(/^https?:\/\//, '') + '/?ref=' + code,
    'la voie du lien montre le vrai lien de partage, sans son protocole');
  // Les deux voies finissent sur le MÊME code dans le MÊME champ : l'une le
  // remplit, l'autre le fait taper.
  assert.equal(doc.getElementById('pr-fl-field-lien').textContent, code);
  assert.equal(doc.getElementById('pr-fl-field-code').textContent, code);
});

test('le circuit finit sur la signature, puis la récompense — jamais l’inverse', async () => {
  const { doc, D } = await boot('#t=partenaires');
  const stage = doc.getElementById('pr-flow-stage');
  const order = [...stage.querySelectorAll('.pr-fl-beat, .pr-fl-end')].map((n) => n.id);
  assert.deepEqual(order, ['pr-fl-beat-publiee', 'pr-fl-beat-retenue', 'pr-fl-beat-signe',
    'pr-fl-end-vous', 'pr-fl-end-client'], 'la récompense vient APRÈS l’acte signé');
  // Aucun versement immédiat n'est promis nulle part dans la figure.
  assert.doesNotMatch(doc.getElementById('pr-flow').textContent, /quelques secondes|immédiat|instantané/i);
  // La récompense est celle du domaine, et le client ne paie rien de plus.
  assert.equal(doc.getElementById('pr-fl-amount').textContent, D.money(D.REFERRAL.client));
  assert.equal(doc.getElementById('pr-fl-client-amount').textContent, D.money(0));
  // Règle 1 d'AGENTS.md : aucun de ces chiffres n'est écrit dans la page.
  for (const montant of [D.REFERRAL.client, D.REFERRAL.notaire, 0]) {
    assert.ok(!HTML_SRC.includes('>' + D.money(montant) + '<'),
      'la somme n’est pas écrite en dur dans index.html');
  }
});

test('le champ montré est celui de la feuille de réservation, mot pour mot', async () => {
  const { doc } = await boot('#t=partenaires');
  // Ce que le client verra à l'écran 4 : le même libellé, pour qu'il le
  // reconnaisse une fois devant.
  const reel = doc.querySelector('label[for="o-parrain"]').textContent;
  const montre = doc.querySelector('#pr-fl-card-lien .pr-fl-field-lbl').textContent;
  assert.ok(reel.startsWith(montre), reel + ' commence par ' + montre);
  assert.equal(doc.querySelector('#pr-fl-card-code .pr-fl-field-lbl').textContent, montre);
});

// Ce qui reste fermé : la page ne redit pas ses montants en toutes lettres.
test('les deux montants de la porte viennent du domaine', async () => {
  const { doc, D } = await boot('#t=partenaires');
  assert.equal(doc.getElementById('pr-amount-client').textContent, D.money(D.REFERRAL.client));
  assert.equal(doc.getElementById('pr-amount-notaire').textContent, D.money(D.REFERRAL.notaire));
});
