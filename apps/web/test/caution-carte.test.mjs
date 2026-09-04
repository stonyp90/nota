/**
 * ADR 0035 — LA REPRISE DE CARTE, côté client.
 *
 * La caution n'est plus posée à la publication (une autorisation Stripe vit
 * ~7 jours, le palier « standard » du carnet commence à 15) mais deux jours
 * avant la signature. Quand la banque refuse à ce moment-là, le client reçoit
 * le seul avis qu'il aura — et il doit pouvoir AGIR : réessayer demain la même
 * carte refusée donnerait le même refus.
 *
 * Ce fichier tient la porte de sortie : la bande de l'offre montre le refus,
 * offre d'enregistrer une autre carte, et le bouton mène à la page Stripe que
 * le serveur ouvre (POST /client/bid/carte).
 *
 * Harness calqué sur mise-en-relation-client.test.mjs (jsdom + fetch stubé).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch { /* already closed */ } } });

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

const DATE = addDays(todayISO(), 2);
const OFFER = { id: 'o1', dateISO: DATE, serviceId: 'financement', montant: 2400, clientToken: 'tok-o1', retained: true, etude: 'Étude Roy' };
const SEED = { 'nota.myoffers.v1': [OFFER] };

// L'offre telle que GET /client/bid la rend, avec l'état de la caution.
const status = (caution) => ({
  bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 2400, status: 'retenue', etude: 'Étude Roy' },
  notaire: { nom: 'Me Anne Roy', etude: 'Étude Roy', courriel: 'anne@etuderoy.ca', actes: 3 },
  propositions: [], demandes: [], readiness: null, messages: [], documents: [],
  acte: { complete: false }, evaluation: null, annulation: null, caution,
});

async function boot({ seed = SEED, routes = [] } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {} };
        calls.push(call);
        const r = routes.find((x) => x.match(call.url));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
      window.scrollTo = () => {};
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, JSON.stringify(seed[k])));
    },
  });
  const win = dom.window;
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, calls };
}

const statusRoute = (body) => ({ match: (u) => u.includes('/client/bid?'), reply: () => jsonRes(200, body) });
const monthRoute = () => ({ match: (u) => u.includes('/bids?month='), reply: (u) => jsonRes(200, { month: u.slice(-7), bids: [] }) });
const band = (doc) => doc.querySelector('.my-offer-detail[data-for="o1"] .my-offer-detail-cell');

test('une caution refusée se voit dans la bande de l’offre, et dit que rien n’a été débité', async () => {
  const { doc, Nota } = await boot({ routes: [statusRoute(status({ etat: 'refusee', poseeLe: null })), monthRoute()] });
  Nota.setTab('profil');
  await wait(40);
  const box = band(doc).querySelector('.my-offer-carte');
  assert.ok(box, 'le bloc de refus doit paraître');
  assert.match(box.querySelector('.my-offer-carte-h').textContent, /carte a été refusée/i);
  // Ce que le client a besoin de savoir tout de suite : il n'a rien perdu.
  assert.match(box.textContent, /Rien n’a été débité/);
  assert.match(box.textContent, /reste en place/);
  assert.ok(box.querySelector('button'), 'et le geste qui répare');
});

test('rien ne paraît quand la caution se porte bien — on n’inquiète pas sans raison', async () => {
  for (const etat of ['enregistree', 'posee', 'aucune']) {
    const { doc, Nota } = await boot({ routes: [statusRoute(status({ etat, poseeLe: DATE })), monthRoute()] });
    Nota.setTab('profil');
    await wait(40);
    assert.equal(band(doc).querySelector('.my-offer-carte'), null, 'état ' + etat);
  }
});

test('le bouton demande au serveur la page Stripe, avec le jeton de CETTE offre', async () => {
  const { doc, Nota, calls } = await boot({
    routes: [
      statusRoute(status({ etat: 'refusee', poseeLe: null })),
      monthRoute(),
      { match: (u) => u.includes('/client/bid/carte'), reply: () => jsonRes(200, { checkoutUrl: 'https://checkout.stripe.test/s/neuve', mode: 'paiement' }) },
    ],
  });
  Nota.setTab('profil');
  await wait(40);
  band(doc).querySelector('.my-offer-carte button').click();
  await wait(40);

  const post = calls.find((c) => c.url.includes('/client/bid/carte'));
  assert.ok(post, 'la reprise passe par POST /client/bid/carte');
  assert.equal(post.init.method, 'POST');
  // Le jeton de CETTE offre — personne d'autre ne change cette carte.
  assert.match(String(post.init.headers.Authorization), /tok-o1/);
  assert.deepEqual(JSON.parse(post.init.body), { id: 'o1', dateISO: DATE });
  // La redirection elle-même (window.location.href) n'est pas observable sous
  // jsdom : ce que ce test tient, c'est que l'URL demandée est bien allée
  // chercher une session neuve, avec la bonne autorisation.
});

test('un serveur qui refuse laisse le client sur place, prévenu — jamais une page blanche', async () => {
  const { doc, Nota } = await boot({
    routes: [
      statusRoute(status({ etat: 'refusee', poseeLe: null })),
      monthRoute(),
      { match: (u) => u.includes('/client/bid/carte'), reply: () => jsonRes(503, { errors: [{ code: 'paiement_indisponible' }] }) },
    ],
  });
  Nota.setTab('profil');
  await wait(40);
  const btn = band(doc).querySelector('.my-offer-carte button');
  btn.click();
  await wait(40);
  assert.equal(btn.disabled, false, 'le bouton se réarme');
  assert.ok(doc.querySelector('.my-offer-carte'), 'le bloc reste : le problème n’est pas résolu');
});
