/**
 * La file d'approbation des notaires — le second maillon de la porte gratuite.
 *
 * `POST /notaries/signup` dépose un dossier en `status: 'en_attente'` ; seule
 * l'approbation de l'opérateur (`approuveLe`) ouvre la console, jamais Stripe.
 * La route `POST /admin/notaries/{id}/activer` faisait déjà tout — écrire
 * `approuveLe`, journaliser `notary_activated`, envoyer le courriel
 * `notaryApproved` — mais AUCUNE interface ne l'appelait. Câbler l'inscription
 * sans câbler l'activation aurait donc rempli une file que rien ne vidait.
 * Voir [[code-teste-sans-appelant]].
 *
 * L'écran « Notaires » est un tableau d'honneur trié par cote : un dossier en
 * attente (cote 0, aucun acte) y coule au fond. La file d'attente est donc une
 * section À PART, au-dessus, et c'est le vrai travail de l'opérateur.
 *
 * Même harnais que notaires.test.mjs.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFetch(handler, calls) {
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { /* leave null */ } }
    calls.push({ method, url: String(url), body });
    const out = handler(method, String(url), body) || [404, null];
    const [status, json] = out;
    if (status === 0) return Promise.reject(new Error('network'));
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(json) });
  };
}

const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* already gone */ } } });

async function boot(handler, hash) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/' + (hash || ''),
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = makeFetch(handler, calls);
      window.scrollTo = () => {};
      window.confirm = () => true;
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  win.eval(ADMIN_SRC);
  for (let i = 0; i < 3; i++) await wait(5);
  return { win, calls, doc: win.document };
}

async function waitFor(win, sel, timeout = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (win.document.querySelector(sel)) return win.document.querySelector(sel);
    await wait(5);
  }
  throw new Error('timeout waiting for ' + sel);
}

const text = (node) => (node ? node.textContent : '');
const futureISO = () => new Date(Date.now() + 3600000).toISOString();
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true }));

// Un actif approuvé + deux dossiers déposés par la porte gratuite.
function sample() {
  return {
    notaires: [
      { id: 'n1', email: 'm.tremblay@etude.ca', etude: 'Étude Tremblay & associés', statut: 'active',
        cote: 93, axes: [], actes: 40, actesParService: {}, note: 4.7, avis: 30,
        commissionPercue: 4820, commissionDue: 0, cnq: true, lienCNQ: 'https://www.cnq.org/fiche/tremblay',
        inscritLe: '2025-06-01T12:00:00.000Z', approuveLe: '2025-06-02T12:00:00.000Z', vuLe: null },
      { id: 'n2', email: 'nouvelle@etude.ca', etude: 'nouvelle@etude.ca', statut: 'en_attente',
        cote: 0, axes: [], actes: 0, actesParService: {}, note: null, avis: 0,
        commissionPercue: 0, commissionDue: 0, cnq: true, lienCNQ: 'https://www.cnq.org/fiche/nouvelle',
        inscritLe: '2026-09-05T12:00:00.000Z', approuveLe: null, vuLe: null },
      { id: 'n3', email: 'sansfiche@etude.ca', etude: 'sansfiche@etude.ca', statut: 'en_attente',
        cote: 0, axes: [], actes: 0, actesParService: {}, note: null, avis: 0,
        commissionPercue: 0, commissionDue: 0, cnq: false, lienCNQ: null,
        inscritLe: '2026-09-04T12:00:00.000Z', approuveLe: null, vuLe: null },
    ],
  };
}

function api(opts = {}) {
  const role = opts.role || 'super_admin';
  const permissions = opts.permissions || (role === 'super_admin'
    ? ['analytics:read', 'pii:read', 'moderation:write', 'settings:write', 'notifications:write']
    : ['analytics:read', 'pii:read']);
  const state = { notaries: opts.notaries || sample(), activate: opts.activate || (() => [200, { ok: true, deja: false }]) };
  const handler = (method, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role, permissions }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (/\/notaries\/[^/]+\/activer$/.test(url) && method === 'POST') return state.activate(url);
    if (url.includes('/notaries')) return [200, state.notaries];
    return [404, null];
  };
  handler.state = state;
  return handler;
}

async function openNotaires(handler) {
  const { win, doc, calls } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/notaires';
  await waitFor(win, '.ntable');
  return { win, doc, calls };
}

// ---------------------------------------------------------------------------

test('les dossiers en attente forment une file À PART, au-dessus du tableau d’honneur', async () => {
  const { doc } = await openNotaires(api());

  const file = doc.querySelector('.napprove');
  assert.ok(file, 'la file d’approbation existe');
  const rows = [...file.querySelectorAll('.napprove-row')];
  assert.equal(rows.length, 2, 'les deux dossiers déposés y figurent — et eux seuls');

  // Le plus ancien d'abord : une file se vide par le haut.
  assert.ok(text(rows[0]).includes('sansfiche@etude.ca'), 'déposé le 4 septembre, servi en premier');
  assert.ok(text(rows[1]).includes('nouvelle@etude.ca'));

  // Un notaire déjà approuvé n'a rien à faire dans une file d'attente.
  assert.ok(!text(file).includes('m.tremblay@etude.ca'), 'un actif n’est pas en attente');

  // Elle passe AVANT le tableau : c'est le travail, le classement est la vue.
  const body = doc.querySelector('.admin-content');
  const order = [...body.querySelectorAll('.napprove, .ntable')].map((n) => (n.classList.contains('napprove') ? 'file' : 'tableau'));
  assert.deepEqual(order, ['file', 'tableau'], 'la file précède le tableau d’honneur');
});

test('la file montre ce qu’il faut pour trancher : l’adresse, la date, et la fiche à vérifier', async () => {
  const { doc } = await openNotaires(api());
  const row = doc.querySelector('.napprove-row');

  assert.ok(text(row).includes('sansfiche@etude.ca'), 'l’adresse inscrite');
  assert.ok(text(row).includes('2026-09-04'), 'la date de dépôt');

  // La fiche officielle est LE geste de vérification (Tableau de l'Ordre).
  // Quand elle manque, l'écran le dit — il ne laisse pas une case vide.
  assert.ok(/aucune fiche/i.test(text(row)), 'l’absence de fiche est nommée, pas tue');

  const withFiche = [...doc.querySelectorAll('.napprove-row')][1];
  const lien = withFiche.querySelector('a[href*="cnq.org"]');
  assert.ok(lien, 'la fiche fournie est un lien cliquable vers le Tableau de l’Ordre');
  assert.equal(lien.target, '_blank', 'elle s’ouvre à côté — on ne perd pas la file');
  assert.ok(/noopener/.test(lien.rel || ''), 'sans donner la main à l’onglet ouvert');
});

test('« Activer » appelle la route, sur le bon notaire, et retire la ligne de la file', async () => {
  const handler = api();
  const { win, doc, calls } = await openNotaires(handler);

  const row = doc.querySelector('.napprove-row');
  const btn = row.querySelector('.napprove-go');
  assert.ok(btn, 'chaque dossier porte son bouton');

  // La liste que renverra le rechargement : le dossier activé n'attend plus.
  handler.state.notaries = {
    notaires: handler.state.notaries.notaires.map((n) => (n.id === 'n3'
      ? { ...n, statut: 'active', approuveLe: '2026-09-05T13:00:00.000Z' }
      : n)),
  };

  click(win, btn);
  for (let i = 0; i < 40 && !calls.some((c) => c.url.includes('/activer')); i++) await wait(10);

  const hit = calls.filter((c) => c.method === 'POST' && c.url.includes('/activer'));
  assert.equal(hit.length, 1, 'la route est appelée une fois');
  assert.ok(hit[0].url.includes('/notaries/n3/activer'), 'sur le notaire de la ligne, jamais un autre');

  // L'écran se remet à jour tout seul : la file rétrécit.
  for (let i = 0; i < 60 && doc.querySelectorAll('.napprove-row').length > 1; i++) await wait(10);
  assert.equal(doc.querySelectorAll('.napprove-row').length, 1, 'le dossier activé quitte la file');
});

test('un refus de la route laisse le dossier dans la file et dit pourquoi', async () => {
  const handler = api({
    activate: () => [403, { errors: [{ code: 'interdit', message: 'Activation des notaires non autorisée.' }] }],
  });
  const { win, doc, calls } = await openNotaires(handler);

  click(win, doc.querySelector('.napprove-row .napprove-go'));
  for (let i = 0; i < 40 && !calls.some((c) => c.url.includes('/activer')); i++) await wait(10);
  await wait(30);

  assert.equal(doc.querySelectorAll('.napprove-row').length, 2, 'rien n’a quitté la file');
  const row = doc.querySelector('.napprove-row');
  assert.ok(/non autorisée/i.test(text(row)), 'la raison est lisible sur la ligne');
  assert.equal(row.querySelector('.napprove-go').disabled, false, 'le bouton se réarme');
});

test('sans moderation:write la file se lit mais ne s’actionne pas', async () => {
  const { doc } = await openNotaires(api({ role: 'analyste', permissions: ['analytics:read', 'pii:read'] }));

  const file = doc.querySelector('.napprove');
  assert.ok(file, 'l’analyste voit qu’il y a des dossiers en attente');
  assert.equal(file.querySelectorAll('.napprove-go').length, 0, 'mais aucun bouton d’activation');
  assert.ok(/autorisation|permission/i.test(text(file)), 'et l’écran dit que le geste ne lui appartient pas');
});

test('file vide : la section disparaît plutôt que d’afficher un vide', async () => {
  const only = { notaires: [sample().notaires[0]] };
  const { doc } = await openNotaires(api({ notaries: only }));
  assert.equal(doc.querySelector('.napprove'), null, 'rien à traiter, rien à afficher');
  assert.ok(doc.querySelector('.ntable'), 'le tableau d’honneur reste');
});

test('« En attente » est nommé en toutes lettres dans le tableau', async () => {
  const { doc } = await openNotaires(api());
  const statuts = [...doc.querySelectorAll('.ntable tbody .nstatut')].map(text);
  assert.ok(!statuts.includes('en_attente'), 'jamais la valeur brute de la base');
  assert.ok(statuts.some((s) => /attente/i.test(s)), 'le statut est traduit pour l’opérateur');
});
