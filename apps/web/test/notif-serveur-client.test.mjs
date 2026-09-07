/**
 * LA CLOCHE DU CLIENT LIT ENFIN CE QUE LE SERVEUR LUI ÉCRIT.
 *
 * L'API tient un journal d'avis par destinataire : `notifIn` écrit des entrées
 * d'audience « client » (retenue, proposition, message, document, desistement
 * et — depuis qu'elle est déclarée — annulation), et `GET /notifications?id=…`
 * les sert contre le jeton par offre du client.
 *
 * Rien ne les lisait. `ncSyncNotifs` fait le GET avec le jeton du NOTAIRE ; le
 * client, lui, ne faisait que POSTer `/notifications/lues` — il marquait donc
 * « lues » des entrées qu'il n'avait jamais cherchées. Toute la moitié client
 * du journal était en écriture seule, et la cloche se rabattait sur une dérive
 * locale à partir de `localStorage` : vidé le cache, l'historique disparaît, et
 * un document déposé par le notaire ne sonnait rien du tout.
 *
 * Deuxième défaut, plus discret : les réglages de la carte « Notifications »
 * portent des clés produit (`retained`, `documents`, `released`, `cancelled`)
 * alors que le serveur nomme ses genres autrement (`retenue`, `document`,
 * `desistement`, `annulation`). `notifAllowed('retenue')` lisait donc une clé
 * absente — toujours vraie. Un interrupteur fermé ne fermait rien.
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
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});

async function boot({ seed = {}, routes = [] } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {} };
        calls.push(call);
        const r = routes.find((x) => x.match(call.url, call.init));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
      window.scrollTo = () => {};
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, JSON.stringify(seed[k])));
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(120);
  return { win, doc: win.document, Nota: win.Nota, calls };
}

const notifs = (win) => JSON.parse(win.localStorage.getItem('nota.notifs.v1') || '[]');
const myOffer = (over = {}) => Object.assign({
  id: 'b1', dateISO: addDays(todayISO(), 20), serviceId: 'refinancement',
  montant: 2000, clientToken: 'tok-b1',
}, over);

// The routes a booted client touches, plus a server notification journal.
function routesWith(avis) {
  return [
    { match: (u, i) => u.includes('/bids?month=') && (!i.method || i.method === 'GET'), reply: () => jsonRes(200, { bids: [] }) },
    { match: (u) => u.includes('/client/bid?id='), reply: () => jsonRes(200, {
      bid: { id: 'b1', status: 'ouverte', montant: 2000 },
      notaire: null, propositions: [], demandes: [], readiness: null, messages: [],
      acte: { complete: false }, evaluation: null,
    }) },
    { match: (u, i) => u.includes('/notifications') && !u.includes('/lues') && (!i.method || i.method === 'GET'),
      reply: () => jsonRes(200, { avis, nonLus: avis.filter((a) => !a.luLe).length }) },
    { match: (u) => u.includes('/notifications/lues'), reply: () => jsonRes(200, { marques: 0 }) },
  ];
}

const AVIS_ANNULATION = {
  id: 'av1',
  kind: 'annulation',
  titre: 'Suite de votre annulation',
  corps: 'Votre notaire ne réclame aucune indemnité : rien n’est retenu, et la somme réservée est libérée.',
  lien: '#offre=b1&d=2026-09-30',
  refId: 'b1',
  at: '2026-09-06T12:00:00.000Z',
  luLe: null,
};

test('le client va chercher son journal d’avis, avec le jeton de son offre', async () => {
  const { calls } = await boot({
    seed: { 'nota.myoffers.v1': [myOffer()] },
    routes: routesWith([AVIS_ANNULATION]),
  });
  const get = calls.find((c) => /\/notifications\?/.test(c.url) && (!c.init.method || c.init.method === 'GET'));
  assert.ok(get, 'le client n’appelle jamais GET /notifications — la moitié client du journal reste en écriture seule');
  assert.match(get.url, /id=b1/, 'le GET doit porter l’offre : ' + get.url);
  const auth = (get.init.headers || {}).Authorization || (get.init.headers || {}).authorization || '';
  assert.match(auth, /Bearer tok-b1/, 'le GET doit présenter le jeton par offre : ' + auth);
});

test('un avis écrit par le serveur atterrit dans la cloche', async () => {
  const { win } = await boot({
    seed: { 'nota.myoffers.v1': [myOffer()] },
    routes: routesWith([AVIS_ANNULATION]),
  });
  const entry = notifs(win).find((n) => n.key === 'srv:av1');
  assert.ok(entry, 'l’avis du serveur n’est pas dans la cloche : ' + JSON.stringify(notifs(win).map((n) => n.key)));
  assert.equal(entry.title, 'Suite de votre annulation');
  assert.match(entry.body, /aucune indemnité/);
  assert.equal(entry.read, false);
});

test('un avis déjà lu côté serveur arrive lu, sans repastiller la cloche', async () => {
  const { win } = await boot({
    seed: { 'nota.myoffers.v1': [myOffer()] },
    routes: routesWith([{ ...AVIS_ANNULATION, luLe: '2026-09-06T13:00:00.000Z' }]),
  });
  const entry = notifs(win).find((n) => n.key === 'srv:av1');
  assert.ok(entry, 'l’avis lu doit tout de même figurer dans l’historique');
  assert.equal(entry.read, true, 'un avis lu au serveur ne doit pas revenir non lu');
});

test('les genres du serveur obéissent aux interrupteurs de la carte Notifications', async () => {
  // «  Confirmation d'annulation d'une offre » fermé : le genre serveur
  // `annulation` doit se taire, comme son libellé le promet.
  const { win } = await boot({
    seed: {
      'nota.myoffers.v1': [myOffer()],
      'nota.profile.v1': { courriel: 'client@example.ca', notifs: { cancelled: false } },
    },
    routes: routesWith([AVIS_ANNULATION]),
  });
  assert.equal(notifs(win).find((n) => n.key === 'srv:av1'), undefined,
    'l’interrupteur « annulation » est fermé et l’avis a sonné quand même');
});

test('chaque genre du serveur est rattaché à un interrupteur existant', async () => {
  const { win } = await boot({ routes: routesWith([]) });
  const D = win.NotaDomain;
  const kinds = D.NOTIF_KINDS.filter((k) => k.audiences.includes('client')).map((k) => k.id);
  assert.ok(kinds.length >= 6, 'le domaine déclare les genres client : ' + kinds.join(', '));

  // Les clés produit de la carte, lues dans la source pour qu'un renommage
  // d'un côté fasse tomber le test plutôt qu'un interrupteur.
  const prefKeys = [...APP_SRC.matchAll(/\{ key: '([a-z]+)', label: '/g)].map((m) => m[1]);
  for (const kind of kinds) {
    const mapped = win.Nota.notifPrefKey ? win.Nota.notifPrefKey(kind) : null;
    assert.ok(mapped, 'aucune correspondance déclarée pour le genre serveur « ' + kind + ' »');
    assert.ok(prefKeys.includes(mapped),
      'le genre « ' + kind + ' » pointe vers « ' + mapped + ' », qui n’est pas un interrupteur de la carte');
  }
});
