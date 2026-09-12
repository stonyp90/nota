/**
 * ADR 0052 §A — ce qu'un notaire doit comprendre AVANT de créer un compte.
 *
 * Le 12 septembre 2026 la page des notaires disait une chose sur cinq : « Des
 * clients de Québec ont fixé leur date et leur prix. » Elle ne disait pas que
 * le carnet se branche sur Outlook ou Google, ni que les dates rapprochées
 * paient davantage, ni que la fiche est complète avant la décision. Le film et
 * la bande Conformité portaient le reste, ou rien.
 *
 * Ces tests tiennent le bloc, et surtout son CHIFFRE : la troisième promesse
 * est une somme sortie de l'échelle des délais du domaine, jamais une phrase
 * écrite à la main. Un jour où TIERS bougera, la promesse bougera avec —
 * ou ce fichier rougira.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');
const WINDOWS = [];
after(() => WINDOWS.forEach((window) => { try { window.close(); } catch {} }));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

async function boot() {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/#t=notaires',
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
  window.eval(DOMAIN_SRC);
  const D = window.NotaDomain;
  window.localStorage.setItem('nota.bids.v1', JSON.stringify(D.makeFixtures(todayISO())));
  window.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  window.eval(APP_SRC);
  await wait(80);
  return { window, doc: window.document, D };
}

test('les cinq promesses sont sur la page, chacune avec sa phrase', async () => {
  const { doc } = await boot();
  const tiles = [...doc.querySelectorAll('#nc-promesses .nc-promesse')];
  assert.equal(tiles.length, 5, 'agenda, trous comblés, urgence payée, rien à refuser, fiche complète');
  for (const tile of tiles) {
    const titre = tile.querySelector('.nc-promesse-t');
    const phrase = tile.querySelector('.nc-promesse-p');
    assert.ok(titre && titre.textContent.trim().length > 8, 'chaque tuile porte un titre');
    assert.ok(phrase && phrase.textContent.trim().length > 40, 'et une phrase qui l’explique : ' + titre.textContent);
  }
  const texte = doc.getElementById('nc-promesses').textContent;
  // Les trois agendas sont NOMMÉS : un notaire cherche le sien, pas le mot
  // « calendrier ».
  for (const agenda of ['Google', 'Outlook', 'Apple']) {
    assert.ok(texte.includes(agenda), 'la promesse de l’agenda nomme ' + agenda);
  }
});

test('la porte dit que c’est gratuit, et qu’il n’y a rien à refuser', async () => {
  // Propriétaire, 2026-09-12 : un notaire doit comprendre qu'il peut avoir
  // Nota dans son agenda sans payer, et qu'une offre qui ne lui convient pas
  // ne demande AUCUN geste. Le titre disait « Un abonnement » — un notaire y
  // lit un forfait.
  const { doc } = await boot();
  const titre = doc.getElementById('nc-promesses-h').textContent;
  assert.match(titre, /Gratuit/, 'le titre dit la gratuité : ' + titre);
  assert.ok(!/abonnement/i.test(titre), 'et ne se lit plus comme un forfait : ' + titre);
  const passe = [...doc.querySelectorAll('#nc-promesses .nc-promesse')]
    .find((tile) => /Rien à refuser/.test(tile.querySelector('.nc-promesse-t').textContent));
  assert.ok(passe, 'la promesse du refus qu’on n’a pas à écrire est sur la page');
  const phrase = passe.querySelector('.nc-promesse-p').textContent;
  assert.match(phrase, /aucune pénalité/, phrase);
  // Elle ne promet pas que l'inaction rapporte : coteDisponibilite compte les
  // réponses, et une offre ignorée en vaut zéro. La phrase dit « ne retire
  // rien », jamais « ne change rien ».
  assert.match(phrase, /ne vous retire rien/, phrase);
  assert.ok(!/sans conséquence|ne change rien/.test(phrase), phrase);
});

test('la promesse d’urgence est la somme du domaine, pas une phrase écrite à la main', async () => {
  const { doc, D } = await boot();
  const chiffre = doc.getElementById('nc-promesse-urgence');
  assert.ok(chiffre, 'la tuile de l’urgence a son emplacement de chiffre');

  const svc = D.serviceById(D.DEFAULT_SERVICE_ID) || D.SERVICES[0];
  const presse = D.TIERS.find((t) => t.eleve);
  const bids = JSON.parse(doc.defaultView.localStorage.getItem('nota.bids.v1'));
  const honoraires = (tierId) => Math.round(svc.prixDepart * D.tierMultiplier(tierId, bids, svc.id));
  const calme = honoraires('standard');
  const urgent = honoraires(presse.id);

  assert.equal(
    chiffre.textContent.trim(),
    'Le même acte : ' + D.money(calme) + ' d’honoraires à délai normal, '
      + D.money(urgent) + ' à ' + presse.maxJours + ' jours d’avis.',
    'la phrase se recalcule depuis TIERS et les offres du mois',
  );
  assert.ok(urgent > calme, 'et elle ne s’affiche que si l’urgence paie effectivement davantage');

  // La preuve que rien n'est en dur : le fichier de la page ne contient aucun
  // des deux montants (AGENTS.md règle 1).
  assert.ok(!HTML_SRC.includes(D.money(urgent)), 'le montant d’urgence n’est pas écrit dans index.html');
  assert.ok(!HTML_SRC.includes(D.money(calme)), 'le montant calme n’est pas écrit dans index.html');
});

test('l’échange de la préparation assistée est dit au complet (ADR 0052 §B)', async () => {
  const { doc } = await boot();
  const panneau = doc.getElementById('notary-ai-beta-details');
  assert.ok(panneau, 'le panneau de la bêta existe');
  const texte = panneau.textContent;
  // Les deux voies, et la seule différence entre elles.
  assert.match(texte, /Si vous payez, vous ne devez rien à l’apprentissage/);
  assert.match(texte, /Si vous ne payez pas, vos corrections servent à améliorer le système/);
  // La borne : le secret professionnel n'appartient pas au notaire.
  assert.match(texte, /Jamais un document de votre client/);
  assert.match(texte, /le secret professionnel ne vous appartient pas/);
  // Et le refus ne reprend rien — c'est ce qui rend le consentement libre.
  assert.match(texte, /refuser les deux ne vous retire rien du marché/);
});

test('le bloc se replie quand la console s’ouvre : signé, c’est un plan de travail', () => {
  assert.match(
    CSS_SRC,
    /#pane-notaires > \.wrap:has\(#notary-auth-form\[hidden\]\) #nc-promesses \{ display: none; \}/,
    'la promesse est une annonce, pas un meuble de la console',
  );
});
