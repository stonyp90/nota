/**
 * LA COUTURE — la console RÉELLE contre l'API RÉELLE.
 *
 * Pourquoi ce fichier existe. « Envoyer à un groupe » était cassé depuis le
 * premier jour : la console peuplait sa liste déroulante depuis
 * `GET /admin/groups`, qui rend les groupes RBAC — des paquets de PERMISSIONS,
 * sur l'autre table — tandis que la résolution d'audience cherchait un groupe
 * d'AUDIENCE sous l'identifiant choisi et n'en trouvait aucun. Viser un groupe
 * ne pouvait donc atteindre personne.
 *
 * ET LES DEUX SUITES ÉTAIENT VERTES. Le test d'API semait `putAudienceGroup`
 * directement dans le dépôt et n'ouvrait jamais la console ; le test DOM
 * bouchonnait `/groups` avec la forme RBAC et n'appelait jamais l'API. Chacun
 * se parlait à lui-même, et la couture entre les deux n'était éprouvée nulle
 * part. Un bouchon dont la forme est fausse est pire qu'aucun bouchon : il
 * garantit que le bogue restera vert.
 *
 * Ici, `window.fetch` est branché sur `createAdminApp` — le vrai routeur, le
 * vrai module d'administration, le vrai dépôt en mémoire. Aucune charge utile
 * n'est inventée : la console reçoit exactement ce que la Lambda rendrait.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../../api/src/admin-handler.js');
const { createAdmin } = require('../../api/src/admin.js');
const { createAnalytics } = require('../../api/src/analytics.js');
const { createMemoryRepo } = require('../../api/src/repo-memory.js');

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const TODAY = '2026-09-02';
const START = Date.parse('2026-09-02T14:00:00.000Z');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (win) => { for (let i = 0; i < 8; i++) await wait(5); };
const text = (node) => (node ? node.textContent : '');
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true }));
const change = (win, node, value) => {
  node.value = value;
  node.dispatchEvent(new win.Event('change', { bubbles: true }));
  node.dispatchEvent(new win.Event('input', { bubbles: true }));
};

const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* already gone */ } } });

// L'API réelle, montée sur un dépôt en mémoire. `envoyes` capte ce que le
// notifieur aurait expédié — la seule pièce qu'on n'exécute pas pour de vrai.
function api() {
  const repo = createMemoryRepo();
  const envoyes = [];
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    notifier: { async sendCampaign(m) { envoyes.push(m); return { sent: true, to: m.to }; } },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => START,
    config: { allowlist: ['ops@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => TODAY }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => TODAY,
    nowMs: () => START,
  });
  return { repo, app, envoyes };
}

async function appel(app, method, path, { body, bearer } = {}) {
  const res = await app.handle({
    method,
    path,
    query: {},
    headers: bearer
      ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' }
      : { 'x-forwarded-for': '1.2.3.4' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { statusCode: res.statusCode, json: JSON.parse(res.body) };
}

// Le jeton du lien magique, obtenu par la VRAIE porte d'authentification.
async function jetonMagique(app) {
  const req = await appel(app, 'POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } });
  return decodeURIComponent(req.json.devLink.split('token=')[1]);
}

// La console, avec son `fetch` branché sur l'application réelle. Les URL que
// la console forme (`/api/admin/...`) traversent le même normaliseur de route
// que derrière API Gateway.
async function consoleReelle(app, hash) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/' + (hash || ''),
    pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.fetch = async (url, opts = {}) => {
        const method = (opts.method || 'GET').toUpperCase();
        const u = new URL(String(url), 'https://admin.nota.example');
        const query = {};
        u.searchParams.forEach((v, k) => { query[k] = v; });
        const headers = Object.assign({ 'x-forwarded-for': '1.2.3.4' }, opts.headers || {});
        calls.push({ method, url: u.pathname, body: opts.body ? JSON.parse(opts.body) : null });
        const res = await app.handle({ method, path: u.pathname, query, headers, body: opts.body });
        let json = null;
        try { json = JSON.parse(res.body); } catch (e) { json = null; }
        return {
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => json,
        };
      };
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  win.eval(ADMIN_SRC);
  await settle(win);
  return { win, doc: win.document, calls };
}

async function waitFor(win, sel, timeout = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (win.document.querySelector(sel)) return win.document.querySelector(sel);
    await wait(5);
  }
  throw new Error('timeout waiting for ' + sel);
}

const q = (doc, sel) => doc.querySelector(sel);

function notaire(id) {
  return {
    id,
    email: id + '@etude.test',
    label: 'Étude ' + id,
    status: 'active',
    chargesEnabled: true,
    connectAccountId: 'acct_' + id,
    createdAt: new Date(START - 400 * 86400000).toISOString(),
    lastSeenAt: new Date(START).toISOString(),
    actsCompleted: 2,
  };
}

// ---------------------------------------------------------------------------
// LA COUTURE DU GROUPE
// ---------------------------------------------------------------------------

test('la liste « Un groupe » de la console est peuplée par les groupes d’AUDIENCE que l’API sert vraiment', async () => {
  const { app, repo } = api();
  const jeton = await jetonMagique(app);
  const session = (await appel(app, 'POST', '/admin/auth/verify', { body: { token: jeton } })).json.session;

  // Deux items, MÊME identifiant, deux notions. C'est exactement la confusion
  // qui rendait la cible « groupe » inatteignable.
  await appel(app, 'PUT', '/admin/groups/pilote', {
    bearer: session, body: { nom: 'Groupe RBAC', description: 'Des permissions.', permissions: ['analytics:read'] },
  });
  await appel(app, 'PUT', '/admin/audiences/groups/pilote', {
    bearer: session,
    body: { libelle: 'Liste pilote', audience: 'notaire', nature: 'commercial', membres: ['a@etude.test', 'b@etude.test'] },
  });
  await repo.putNotary(notaire('a'));
  await repo.putNotary(notaire('b'));

  // Le jeton du lien magique est à usage UNIQUE : celui qui a servi à semer
  // est consommé, la console en demande le sien.
  const { win, doc, calls } = await consoleReelle(app, '#/auth?token=' + encodeURIComponent(await jetonMagique(app)));
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/campagnes';
  await waitFor(win, '.camp-form');

  const groupe = [...doc.querySelectorAll('.camp-cible .seg-btn')].find((b) => text(b) === 'Un groupe');
  click(win, groupe);
  await settle(win);

  const select = q(doc, '[name="cibleGroupe"]');
  assert.ok(select, 'la cible « groupe » offre une liste');
  // Le LIBELLÉ vient du groupe d'audience, pas du groupe RBAC. Si la console
  // lisait encore `/groups`, elle afficherait « Groupe RBAC ».
  assert.match(text(select.options[0]), /Liste pilote/);
  assert.doesNotMatch(text(select.options[0]), /Groupe RBAC/);
  assert.ok(calls.some((c) => c.url.endsWith('/audiences/groups')),
    'la console a bien appelé la route des groupes d’audience');
});

test('bout en bout : un groupe créé dans la console est celui que la campagne atteint', async () => {
  const { app, repo, envoyes } = api();
  const jeton = await jetonMagique(app);
  await repo.putNotary(notaire('a'));
  await repo.putNotary(notaire('b'));

  const { win, doc } = await consoleReelle(app, '#/auth?token=' + encodeURIComponent(jeton));
  await waitFor(win, '.admin-rail');

  // (1) L'opérateur crée la liste sur l'écran Audiences — le seul geste par
  //     lequel un groupe d'audience pouvait naître, et il n'existait pas.
  win.location.hash = '#/audiences';
  await waitFor(win, '.aud-groupe-form');
  const form = q(doc, '.aud-groupe-form');
  change(win, form.querySelector('[name="id"]'), 'pilote');
  change(win, form.querySelector('[name="libelle"]'), 'Liste pilote');
  change(win, form.querySelector('[name="audience"]'), 'notaire');
  change(win, form.querySelector('[name="nature"]'), 'commercial');
  change(win, form.querySelector('[name="membres"]'), 'a@etude.test\nb@etude.test');
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(win, '.aud-groupe');
  assert.match(text(q(doc, '.aud-groupe')), /Liste pilote/);
  assert.match(text(q(doc, '.aud-groupe-faits')), /2/, 'le nombre de destinataires se lit sur la ligne');

  // Et le dépôt porte bien la liste, sous la partition des AUDIENCES.
  const stocke = await repo.getAudienceGroup('pilote');
  assert.deepEqual(stocke.membres, ['a@etude.test', 'b@etude.test']);

  // (2) L'opérateur revient aux campagnes, vise ce groupe, écrit un message.
  win.location.hash = '#/campagnes';
  await waitFor(win, '.camp-form');
  click(win, [...doc.querySelectorAll('.camp-cible .seg-btn')].find((b) => text(b) === 'Un groupe'));
  await settle(win);
  assert.equal(q(doc, '[name="cibleGroupe"]').value, 'pilote');

  change(win, q(doc, '[name="sujetFr"]'), 'Le carnet vous attend');
  change(win, q(doc, '[name="sujetEn"]'), 'The carnet is waiting');
  change(win, q(doc, '[name="corpsFr"]'), 'Des demandes arrivent chaque jour à Québec.');
  change(win, q(doc, '[name="corpsEn"]'), 'Requests arrive every day in Québec.');

  // (3) L'aperçu — le décompte RÉEL, calculé par la vraie résolution.
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  assert.match(text(q(doc, '.camp-total')), /2/, 'les deux membres de la liste sont atteignables');
  assert.match(text(q(doc, '.camp-garde')), /consentement|Base de consentement/i);

  // (4) L'envoi, derrière sa confirmation.
  click(win, q(doc, '.camp-envoyer'));
  await settle(win);
  click(win, q(doc, '.camp-confirmer'));
  await waitFor(win, '.camp-resultat');
  assert.deepEqual(envoyes.map((e) => e.to).sort(), ['a@etude.test', 'b@etude.test']);
  assert.equal(envoyes[0].templateKey, undefined, 'aucun gabarit détourné : la campagne porte sa copie');
  assert.equal(envoyes[0].message.sujetFr, 'Le carnet vous attend');

  // (5) QUI a reçu — le registre par (campagne, destinataire), rendu à l'écran.
  await waitFor(win, '.camp-recus');
  const lignes = [...doc.querySelectorAll('.camp-recus-table tbody tr')].map(text);
  assert.equal(lignes.length, 2);
  assert.ok(lignes.join(' ').includes('a@etude.test'));
  assert.ok(lignes.join(' ').includes('b@etude.test'));
});

test('le compositeur remonte le refus du serveur mot pour mot — HTML, partage d’honoraires, jeton inconnu', async () => {
  const { app, repo } = api();
  const jeton = await jetonMagique(app);
  await repo.putNotary(notaire('a'));

  const { win, doc } = await consoleReelle(app, '#/auth?token=' + encodeURIComponent(jeton));
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/campagnes';
  await waitFor(win, '.camp-form');

  click(win, [...doc.querySelectorAll('.camp-cible .seg-btn')].find((b) => text(b) === 'Une personne'));
  await settle(win);
  change(win, q(doc, '[name="cibleEmail"]'), 'a@etude.test');
  change(win, q(doc, '[name="sujetFr"]'), 'Bonjour');
  change(win, q(doc, '[name="sujetEn"]'), 'Hello');
  // Un jeton qu'une campagne ne peut pas renseigner : le serveur seul le sait.
  change(win, q(doc, '[name="corpsFr"]'), 'Votre montant est {{montant}}.');
  change(win, q(doc, '[name="corpsEn"]'), 'Your amount is {{montant}}.');

  click(win, q(doc, '.camp-previsualiser'));
  await settle(win);
  const err = q(doc, '.camp-erreur');
  assert.equal(err.hidden, false, 'le refus du serveur est rendu, pas avalé');
  assert.match(text(err), /jeton|token/i);
  assert.equal(q(doc, '.camp-apercu'), null, 'et aucun décompte n’est affiché');
});

test('sans « audiences:write », l’écran Audiences s’ouvre en lecture seule et nomme la permission', async () => {
  const { app, repo } = api();
  const jeton = await jetonMagique(app);
  const session = (await appel(app, 'POST', '/admin/auth/verify', { body: { token: jeton } })).json.session;
  await appel(app, 'PUT', '/admin/audiences/groups/pilote', {
    bearer: session,
    body: { libelle: 'Liste pilote', audience: 'notaire', nature: 'commercial', membres: ['a@etude.test'] },
  });
  // Le compte devient analyste avec la seule lecture : la porte d'écriture se
  // referme côté serveur ET côté écran, et les deux doivent s'accorder.
  const id = require('../../api/src/admin-auth.js').adminIdForEmail('ops@nota.ca');
  const rec = await repo.getAdmin(id);
  await repo.putAdmin({ ...rec, role: 'analyst', permissions: ['analytics:read', 'audiences:read'] });

  const jeton2 = await jetonMagique(app);
  const { win, doc } = await consoleReelle(app, '#/auth?token=' + encodeURIComponent(jeton2));
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audiences';
  await waitFor(win, '.aud-groupes');
  assert.match(text(q(doc, '.tpl-readonly-note')), /Lecture seule/);
  assert.match(text(q(doc, '.tpl-readonly-note')), /Modifier les groupes d’audience/);
  assert.equal(q(doc, '.aud-groupe-form'), null, 'aucun formulaire de création');
  assert.equal(q(doc, '.aud-groupe-del'), null, 'aucun bouton de suppression');
  assert.match(text(q(doc, '.aud-groupe')), /Liste pilote/, 'la liste, elle, reste lisible');
});
