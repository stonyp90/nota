/**
 * ADR 0035 — LA GARANTIE QUE LE NOTAIRE PEUT VOIR.
 *
 * L'API porte l'état de la caution partout — `bid.caution` sur chaque demande,
 * sur chaque acte retenu, et `conditions.caution.jours` en règle générale — et
 * l'ADR le justifie ainsi : « Une garantie qu'on ne peut pas voir n'en est pas
 * une » (ADR 0033 §4 : tout est exposé au notaire avant qu'il confirme). Le
 * notaire bloque une journée qu'il ne revendra pas ; apprendre un refus par
 * courriel, après coup, ne remplace pas de le lire avant de retenir.
 *
 * Ce fichier tient cette promesse côté console :
 *   1. la demande ouverte porte la garantie sur sa rangée de décision ;
 *   2. la feuille « Retenir » la relit, avec la date, avant le clic ;
 *   3. l'acte RETENU l'affiche en toutes lettres — c'est là qu'elle compte le
 *      plus, et un refus doit s'y voir sans attendre un courriel ;
 *   4. le DÉLAI vient du serveur (`conditions.caution.jours`, lu du domaine) et
 *      n'est écrit en dur nulle part dans apps/web (règle 1 d'AGENTS.md) ;
 *   5. chaque phrase composée a son côté anglais.
 *
 * Harness calqué sur notary-feed-simple.test.mjs (jsdom + fetch stubé).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMS = [];
after(() => { for (const d of DOMS) { try { d.window.close(); } catch { /* already closed */ } } });

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const I18N = (() => {
  const src = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const $ = (doc, id) => doc.getElementById(id);
const click = (node) => node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));

const DATE = addDays(todayISO(), 10);
// Le délai vient du serveur, exactement comme en production : la console n'a
// AUCUN droit de le connaître autrement.
const JOURS = 2;

const openBid = (caution) => ({
  id: 'b1', serviceId: 'financement', dateISO: DATE, montant: 2400, tier: 'standard',
  prefixe: 'G1R', ready: true, missing: [], preteur: null, deplacement: null,
  complexity: null, proposition: null, demande: null, caution,
});

const retainedAct = (caution) => ({
  id: 'r1', serviceId: 'financement', dateISO: DATE, montant: 2400, tier: 'standard',
  prefixe: 'G1R', completed: false, actAmount: null, commissionCents: null,
  courriel: 'client@exemple.ca', dossier: null,
  client: { nom: 'Cliente Test', courriel: 'client@exemple.ca', telephone: '418 555 0199' },
  preteur: null, deplacement: null, distanceKm: null, messages: [], documents: [],
  viaProposition: false, annulation: null, caution,
});

const CONDITIONS = {
  paiement: 'signature',
  tarifNota: { prixNotaCents: 19900 },
  annulation: { paliers: [{ maxJours: 3, taux: 0.3 }, { maxJours: 14, taux: 0.1 }], beneficiaire: 'notaire' },
  desistement: { gratuit: true, compte: true },
  caution: { jours: JOURS, carteValidee: true },
};

async function bootSignedIn({ bids = [], retained = [], conditions = CONDITIONS } = {}) {
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
      // Chaque fichier repart d'une console vierge : les actes retenus sont
      // conservés localement par courriel (ADR 0033).
      window.localStorage.clear();
    },
  });
  DOMS.push(dom);
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(40);
  win.fetch = (url) => {
    const path = String(url);
    const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (path.includes('/notary/session/request')) return json({ ok: true, devToken: 'chal.tok' });
    if (path.includes('/notary/session/verify')) return json({ token: 'sess.tok', feedToken: 'feed.tok', email: 'demo@etude.ca' });
    if (path.includes('/notary/bids')) {
      return json({
        bids, retained, rating: null, cote: null, tarif: conditions.tarifNota,
        profil: { lienCNQ: null, rayonKm: 50, urgences: false, nom: 'Me Test', etude: 'Étude Test', telephone: '418 555 0100', adresse: '1 rue X', courriel: 'demo@etude.ca', complet: true, manquants: [], alertes: {} },
        conditions, fenetre: [DATE.slice(0, 7)],
      });
    }
    return Promise.reject(new Error('offline'));
  };
  await win.Nota.notary.signIn('demo@etude.ca');
  await wait(20);
  return { win, doc: win.document, Nota: win.Nota };
}

// --- 1. la demande ouverte porte la garantie sur sa rangée de décision --------

test('la demande ouverte affiche l’état de la caution parmi les signaux — jamais replié', async () => {
  const { doc } = await bootSignedIn({ bids: [openBid({ etat: 'enregistree', poseeLe: addDays(DATE, -JOURS) })] });
  const card = doc.querySelector('#notary-open-list .nc-card[data-id="b1"]');
  assert.ok(card, 'la demande doit être au fil');
  const pill = card.querySelector('.nc-caution');
  assert.ok(pill, 'AUCUN rendu de la caution côté notaire — la garantie est invisible');
  assert.equal(pill.dataset.caution, 'enregistree');
  assert.match(pill.textContent, /Carte validée/);
  // La rangée de décision ne se replie jamais : le signal doit en faire partie.
  const body = card.querySelector('.nc-card-body');
  assert.ok(body && !body.contains(pill), 'la garantie ne se cache pas derrière « Détails »');
});

test('un refus se lit à l’accent d’alerte, une caution posée à celui de la garantie', async () => {
  const { doc } = await bootSignedIn({
    bids: [
      { ...openBid({ etat: 'refusee', poseeLe: null }), id: 'b1' },
      { ...openBid({ etat: 'posee', poseeLe: todayISO() }), id: 'b2' },
      { ...openBid({ etat: 'aucune', poseeLe: null }), id: 'b3' },
    ],
  });
  const at = (id) => doc.querySelector(`#notary-open-list .nc-card[data-id="${id}"] .nc-caution`);
  assert.equal(at('b1').dataset.caution, 'refusee');
  assert.match(at('b1').textContent, /Carte refusée/);
  assert.equal(at('b2').dataset.caution, 'posee');
  assert.match(at('b2').textContent, /Somme réservée/);
  // `aucune` — la facturation est absente (démo, tests) : on n'invente aucune
  // garantie, et on n'en nie aucune non plus.
  assert.equal(at('b3'), null, 'sans facturation, aucune pastille inventée');
});

// --- 2. la feuille « Retenir » relit la garantie AVANT le clic ----------------

test('la feuille Retenir dit la garantie, avec sa date, et la règle du délai', async () => {
  const { doc } = await bootSignedIn({ bids: [openBid({ etat: 'enregistree', poseeLe: addDays(DATE, -JOURS) })] });
  click(doc.querySelector('#notary-open-list .nc-card[data-id="b1"] .nc-accept'));
  await wait(20);
  assert.equal($(doc, 'nc-retenir-dialog').open, true, 'la feuille de confirmation doit s’ouvrir');
  const dd = $(doc, 'nc-retenir-caution');
  assert.ok(dd, 'la feuille n’a aucune ligne pour la garantie de paiement');
  assert.match(dd.textContent, /Carte validée/, dd.textContent);
  assert.match(dd.textContent, /somme réservée le/, dd.textContent);
  // Le délai vient du serveur, jamais de la page.
  assert.match(dd.textContent, new RegExp(JOURS + ' jours avant la signature'), dd.textContent);
});

test('une caution DÉJÀ posée ne répète pas la règle du délai — elle est déjà passée', async () => {
  const { doc } = await bootSignedIn({ bids: [openBid({ etat: 'posee', poseeLe: todayISO() })] });
  click(doc.querySelector('#notary-open-list .nc-card[data-id="b1"] .nc-accept'));
  await wait(20);
  const dd = $(doc, 'nc-retenir-caution');
  assert.match(dd.textContent, /Somme réservée/, dd.textContent);
  assert.match(dd.textContent, /posée le/, dd.textContent);
  assert.ok(!/avant la signature/.test(dd.textContent), 'la somme est déjà réservée : ' + dd.textContent);
});

test('sans facturation, la feuille dit qu’aucune garantie n’est en place plutôt que d’en inventer une', async () => {
  const { doc } = await bootSignedIn({
    bids: [openBid(null)],
    conditions: { ...CONDITIONS, caution: { jours: JOURS, carteValidee: false } },
  });
  click(doc.querySelector('#notary-open-list .nc-card[data-id="b1"] .nc-accept'));
  await wait(20);
  assert.match($(doc, 'nc-retenir-caution').textContent, /Aucune garantie en place/);
});

// --- 3. l'acte RETENU : c'est là que la garantie compte le plus ---------------

test('l’acte retenu affiche la garantie en toutes lettres', async () => {
  const { doc } = await bootSignedIn({ retained: [retainedAct({ etat: 'posee', poseeLe: todayISO() })] });
  const card = doc.querySelector('#notary-retained-list .nc-card[data-id="r1"]');
  assert.ok(card, 'l’acte retenu doit être rendu');
  const line = card.querySelector('.nc-caution-line');
  assert.ok(line, 'AUCUN rendu de la caution sur l’acte retenu — la journée est bloquée sans garantie visible');
  assert.match(line.textContent, /Somme réservée/);
  assert.match(line.textContent, /posée le/);
});

test('un refus de caution se voit sur l’acte retenu, sans attendre un courriel', async () => {
  const { doc } = await bootSignedIn({ retained: [retainedAct({ etat: 'refusee', poseeLe: null })] });
  const line = doc.querySelector('#notary-retained-list .nc-card[data-id="r1"] .nc-caution-line');
  assert.ok(line);
  assert.equal(line.querySelector('.nc-caution').dataset.caution, 'refusee');
  assert.match(line.textContent, /le client doit enregistrer une autre carte/);
});

test('une réservation EXPIRÉE n’est jamais racontée comme une somme réservée', async () => {
  const { doc } = await bootSignedIn({ retained: [retainedAct({ etat: 'expiree', poseeLe: addDays(todayISO(), -35) })] });
  const line = doc.querySelector('#notary-retained-list .nc-card[data-id="r1"] .nc-caution-line');
  assert.ok(line);
  assert.equal(line.querySelector('.nc-caution').dataset.caution, 'expiree');
  assert.match(line.textContent, /Réservation expirée/);
  assert.match(line.textContent, /aucune somme n’est réservée/);
  assert.ok(!/Somme réservée/.test(line.textContent), line.textContent);
});

// --- 4. le nombre vient du domaine, pas de la page ----------------------------

test('le bloc Paiements écrit le délai à partir de conditions.caution.jours', async () => {
  const { doc } = await bootSignedIn({ bids: [openBid({ etat: 'enregistree', poseeLe: addDays(DATE, -JOURS) })] });
  const p = $(doc, 'notary-pay-caution');
  assert.ok(p, 'le bloc Paiements n’a aucune ligne pour la caution');
  assert.equal(p.hidden, false);
  assert.match(p.textContent, new RegExp(JOURS + ' jours avant la signature'), p.textContent);
});

test('un autre délai change la phrase — la constante du domaine décide, pas la page', async () => {
  const { doc } = await bootSignedIn({
    bids: [openBid({ etat: 'enregistree', poseeLe: addDays(DATE, -4) })],
    conditions: { ...CONDITIONS, caution: { jours: 4, carteValidee: true } },
  });
  assert.match($(doc, 'notary-pay-caution').textContent, /4 jours avant la signature/);
  assert.ok(!/2 jours avant la signature/.test($(doc, 'notary-pay-caution').textContent));
});

test('index.html ne code EN DUR aucun délai de caution — la règle 1 d’AGENTS.md', () => {
  // La page ne doit contenir ni « deux jours », ni « 2 jours » à propos de la
  // somme réservée : changer domain.CAUTION_LEAD_DAYS ferait mentir la copie
  // sans qu'aucun test ne rougisse.
  const suspect = /(deux|trois|[0-9]+)\s+jours?\s+avant la signature/i;
  assert.ok(!suspect.test(HTML_SRC), 'un délai de caution est écrit en dur dans index.html');
  assert.ok(!/réservée deux jours/i.test(HTML_SRC));
});

// --- 5. bilingue --------------------------------------------------------------

test('chaque phrase de la garantie a son côté anglais', () => {
  const phrases = [
    'Garantie de paiement', 'Somme réservée', 'Carte validée', 'Carte refusée',
    'Réservation expirée', 'posée le', 'somme réservée le',
    'la somme est bloquée sur la carte du client',
    'la somme sera réservée avant la signature',
    'le client doit enregistrer une autre carte',
    'aucune somme n’est réservée pour cet acte',
    'Aucune garantie en place',
  ];
  for (const p of phrases) assert.ok(I18N.covered(p), 'sans traduction : ' + p);
  assert.equal(
    I18N.tEn('La carte du client est validée par sa banque dès la publication, et la somme y est réservée 2 jours avant la signature.'),
    'The client’s card is validated by their bank as soon as the offer is posted, and the amount is held on it 2 days before the signing.'
  );
  assert.equal(
    I18N.tEn('La carte du client est validée par sa banque dès la publication, et la somme y est réservée 1 jour avant la signature.'),
    'The client’s card is validated by their bank as soon as the offer is posted, and the amount is held on it 1 day before the signing.'
  );
  I18N.force('fr');
});
