/**
 * LE DEVIS — ce que le client paiera vraiment, affiché avant qu'il ne s'engage.
 *
 * Depuis l'ADR 0031, la carte du client autorise le TOTAL de deux lignes : les
 * honoraires offerts au notaire, qui lui reviennent en entier, et le prix du
 * service de Nota. La seconde n'était affichée nulle part : le client la
 * découvrait sur la page de paiement.
 *
 *   Art. 68 C.déont. — « Le notaire ne doit faire ni permettre que soit faite,
 *   par quelque moyen que ce soit, aucune publicité fausse, trompeuse,
 *   INCOMPLÈTE ou susceptible d'induire en erreur. »
 *   Art. 71 3° — qui annonce des honoraires doit « indiquer si les débours et
 *   les taxes sont ou non inclus ».
 *   Art. 32 C.déont. / art. 32.1 2° L.N. — le notaire ne partage pas ses
 *   honoraires : le devis montre DEUX ACHATS, jamais un partage. Le vocabulaire
 *   compte autant que le chiffre.
 *
 * Le devis vit dans l'étape du montant, sans un clic de plus : il bouge avec le
 * curseur, là où la décision se prend.
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

const PRIX_CENTS = 40000; // ce que le serveur annonce dans ce test

async function boot({ enLigne = true, tarif } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url) => {
        if (!enLigne) return Promise.reject(new Error('offline'));
        if (String(url).includes('/bids?month=')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              month: String(url).split('month=')[1],
              bids: [],
              tarif: tarif !== undefined ? tarif
                : { prixNotaCents: PRIX_CENTS, taxesIncluses: false, deboursInclus: false },
            }),
          });
        }
        return Promise.reject(new Error('route non simulée'));
      };
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
  await wait(80);
  return { win, doc: win.document, D: win.NotaDomain };
}

async function ouvrirRefinancement(doc) {
  const iso = addDays(todayISO(), 6);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(30);
  return iso;
}

const montant = (doc) => Number($(doc, 'o-amount').value);

test('ART. 68 — le devis annonce les DEUX lignes et le total avant tout paiement', async () => {
  const { doc } = await boot();
  await ouvrirRefinancement(doc);

  const devis = $(doc, 'offer-devis');
  assert.ok(devis, 'le devis existe dans le parcours');
  assert.equal(devis.hidden, false, 'et il est visible dès qu’un montant est proposé');

  const offert = montant(doc);
  assert.ok(offert > 0, 'le montant est pré-rempli');
  assert.equal($(doc, 'devis-hon').textContent, doc.defaultView.NotaDomain.money(offert));
  assert.equal($(doc, 'devis-nota').textContent, doc.defaultView.NotaDomain.money(PRIX_CENTS / 100));
  assert.equal($(doc, 'devis-total').textContent,
    doc.defaultView.NotaDomain.money(offert + PRIX_CENTS / 100),
    'le total est exactement ce que la carte autorisera');
});

test('le devis suit le curseur — il ne peut jamais mentir d’un cran', async () => {
  const { win, doc } = await boot();
  await ouvrirRefinancement(doc);

  const slider = $(doc, 'o-amount');
  slider.value = String(Number(slider.max));
  slider.dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(20);

  const offert = montant(doc);
  assert.equal($(doc, 'devis-hon').textContent, win.NotaDomain.money(offert));
  assert.equal($(doc, 'devis-total').textContent, win.NotaDomain.money(offert + PRIX_CENTS / 100));
});

test('ART. 71 3° — le devis dit que les taxes et les débours sont en sus', async () => {
  const { doc } = await boot();
  await ouvrirRefinancement(doc);
  const note = $(doc, 'devis-note').textContent;
  assert.match(note, /[Tt]axes en sus/);
  assert.match(note, /[Dd]ébours en sus/);
  assert.match(note, /RDPRM|droits de publication/);
});

test('ART. 32 — le devis ne décrit jamais un partage', async () => {
  const { doc } = await boot();
  await ouvrirRefinancement(doc);
  const texte = $(doc, 'offer-devis').textContent;
  assert.equal(/commission|partage|% |part de/i.test(texte), false,
    'deux achats distincts, jamais une part retenue sur les honoraires du notaire');
  assert.match($(doc, 'devis-hon-k').textContent, /[Hh]onoraires/,
    'la première ligne nomme les honoraires du notaire');
});

test('hors ligne, le devis n’invente aucun montant', async () => {
  const { doc } = await boot({ enLigne: false });
  await ouvrirRefinancement(doc);

  assert.equal($(doc, 'devis-nota').textContent, '—', 'aucun prix inventé');
  assert.equal($(doc, 'devis-total').textContent, '—');
  assert.match($(doc, 'devis-note').textContent, /s’ajoute à ce montant/,
    'mais le client sait qu’un prix s’ajoutera');
});

test('un serveur qui n’annonce pas de tarif ne fait pas tomber le parcours', async () => {
  const { doc } = await boot({ tarif: null });
  await ouvrirRefinancement(doc);
  assert.equal($(doc, 'offer-devis').hidden, false);
  assert.equal($(doc, 'devis-nota').textContent, '—');
});

test('LOI DES TROIS CLICS — de l’accueil à l’offre publiable sans clic de plus', async () => {
  const { win, doc } = await boot();
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));

  // 1er clic : la date au calendrier. 2e clic : l'acte.
  await ouvrirRefinancement(doc);
  // Le devis est déjà là — il n'a coûté aucun clic.
  assert.equal($(doc, 'offer-devis').hidden, false,
    'le devis se lit AVANT toute saisie, sans un clic de plus');

  // Les réponses obligatoires ne sont pas des clics de navigation : ce sont
  // les questions du notaire, et le devis reste visible pendant qu'on y répond.
  const lv = $(doc, 'crit-valeur_pret'); lv.value = '300000'; fire(lv, 'input');
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  const p = $(doc, 'crit-preteur'); p.value = 'banque_nationale'; fire(p, 'change');
  const pre = $(doc, 'o-prefix'); pre.value = 'G1R'; fire(pre, 'input');
  // L'identité (ADR 0033) est une saisie, pas un clic : le notaire qui retient
  // doit pouvoir nommer et écrire au client.
  const nom = $(doc, 'o-name'); nom.value = 'Prénom Nom'; fire(nom, 'input');
  const em = $(doc, 'o-courriel'); em.value = 'client@exemple.ca'; fire(em, 'input');
  await wait(20);

  assert.equal($(doc, 'offer-devis').hidden, false, 'le devis ne disparaît jamais');
  // 3e clic : publier.
  assert.equal($(doc, 'offer-submit').disabled, false,
    'la publication est atteignable au troisième clic');
});
