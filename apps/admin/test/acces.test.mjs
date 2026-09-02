/**
 * Tests DOM de la section « Accès » — le découplage utilisateur / groupe /
 * permission, vu depuis la console.
 *
 * Trois concepts indépendants : une PERMISSION est une capacité, un GROUPE en
 * réunit, un UTILISATEUR reçoit des groupes ET des permissions directes. Un
 * rôle est un raccourci de compatibilité, jamais la seule granularité offerte —
 * un opérateur doit pouvoir ouvrir une capacité sans promouvoir personne, et la
 * refermer sans rétrograder personne.
 *
 * Ce que l'écran doit rendre impossible, et que les tests tiennent :
 *   • accorder une permission qui n'est pas au catalogue du serveur ;
 *   • donner le joker « * » à un groupe (il se propagerait en silence à chaque
 *     nouveau membre) ;
 *   • retirer le dernier accès complet — le 409 du serveur doit se lire, en
 *     clair, à l'écran plutôt que de disparaître dans une console.
 *
 * Même harnais que prix.test.mjs.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* déjà fermée */ } } });

function makeFetch(handler, calls) {
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { /* laisser null */ } }
    calls.push({ method, url: String(url), body });
    const [status, json] = handler(method, String(url), body) || [404, null];
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(json) });
  };
}

async function boot(handler, hash) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/' + (hash || ''),
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = makeFetch(handler, calls);
      window.scrollTo = () => {};
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
  throw new Error('délai dépassé : ' + sel);
}
const text = (n) => (n ? n.textContent : '');
const click = (win, n) => n.dispatchEvent(new win.Event('click', { bubbles: true }));
const submit = (win, f) => f.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
const type = (win, i, v) => { i.value = v; i.dispatchEvent(new win.Event('input', { bubbles: true })); };
const futureISO = () => new Date(Date.now() + 3600000).toISOString();

const CATALOGUE = [
  { cle: 'analytics:read', libelle: 'Lire les tableaux de bord', libelleEn: 'Read the dashboards' },
  { cle: 'audit:read', libelle: 'Lire le journal d’audit', libelleEn: 'Read the audit log' },
  { cle: 'users:write', libelle: 'Attribuer groupes et permissions', libelleEn: 'Assign groups and permissions' },
  { cle: 'groups:write', libelle: 'Créer et modifier les groupes', libelleEn: 'Create and edit groups' },
];
const GROUPES = [
  { id: 'soutien', nom: 'Soutien', description: 'Lecture des dossiers', permissions: ['audit:read'], updatedAt: '2026-09-02T12:00:00.000Z' },
];
const UTILISATEURS = [
  { email: 'ops@nota.ca', id: 'a1', role: 'super_admin', disabled: false, groupes: [], permissions: ['*'], effectives: ['*'], derniereConnexion: '2026-09-02T09:00:00.000Z' },
  { email: 'support@nota.ca', id: 'a2', role: null, disabled: false, groupes: ['soutien'], permissions: [], effectives: ['audit:read'], derniereConnexion: null },
];

// L'API bouchonnée : session ouverte, joker, et les trois portes du RBAC.
function api(over = {}) {
  return (method, url, body) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role: over.role || 'super_admin' }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: over.role || 'super_admin', permissions: over.permissions || ['*'] }];
    if (url.endsWith('/permissions')) return [200, { ok: true, permissions: CATALOGUE }];
    if (url.endsWith('/groups') && method === 'GET') return [200, { ok: true, groupes: over.groupes || GROUPES }];
    if (url.endsWith('/users') && method === 'GET') return [200, { ok: true, utilisateurs: over.utilisateurs || UTILISATEURS }];
    if (url.includes('/groups/') && method === 'PUT') return over.putGroup ? over.putGroup(body) : [200, { ok: true, groupe: { id: 'x', nom: body.nom, permissions: body.permissions || [] } }];
    if (url.includes('/groups/') && method === 'DELETE') return [200, { ok: true }];
    if (url.includes('/users/') && method === 'PUT') return over.putUser ? over.putUser(body) : [200, { ok: true, utilisateur: {} }];
    return [404, null];
  };
}

test('le rail porte une entrée « Accès » qui route vers #/acces', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const lien = [...doc.querySelectorAll('.admin-rail-link')].find((b) => /Accès/.test(text(b)));
  assert.ok(lien, 'l’entrée existe dans le rail');
  click(win, lien);
  await waitFor(win, '.acces-groupes');
  assert.equal(win.location.hash, '#/acces');
});

test('la vue liste les groupes, leurs permissions, et les utilisateurs avec leurs accès effectifs', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-groupes');

  const g = doc.querySelector('.acces-groupe');
  assert.ok(g, 'un groupe est rendu');
  assert.match(text(g), /Soutien/);
  assert.match(text(g), /Lire le journal d’audit/, 'la permission se lit en clair, pas en clé brute');

  const lignes = [...doc.querySelectorAll('.acces-user')];
  assert.equal(lignes.length, 2);
  assert.match(text(lignes[0]), /ops@nota\.ca/);
  assert.match(text(lignes[0]), /Accès complet/, 'le joker se dit en mots');
  assert.match(text(lignes[1]), /support@nota\.ca/);
  assert.match(text(lignes[1]), /Soutien/, 'le groupe attribué apparaît sur la personne');
});

test('créer un groupe envoie les permissions cochées, en clés du catalogue', async () => {
  const recus = [];
  const { win, doc } = await boot(api({ putGroup: (b) => { recus.push(b); return [200, { ok: true, groupe: { id: 'veille', ...b } }]; } }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-groupe-form');

  const form = doc.querySelector('.acces-groupe-form');
  type(win, form.querySelector('[name="id"]'), 'veille');
  type(win, form.querySelector('[name="nom"]'), 'Veille');
  const cb = form.querySelector('input[type="checkbox"][value="audit:read"]');
  assert.ok(cb, 'chaque permission du catalogue est offerte');
  cb.checked = true;
  cb.dispatchEvent(new win.Event('change', { bubbles: true }));
  submit(win, form);
  for (let i = 0; i < 4; i++) await wait(10);

  assert.equal(recus.length, 1, 'un seul envoi');
  assert.equal(recus[0].nom, 'Veille');
  assert.deepEqual(recus[0].permissions, ['audit:read']);
});

test('le joker n’est jamais offert sur un groupe', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-groupe-form');
  const form = doc.querySelector('.acces-groupe-form');
  assert.equal(form.querySelector('input[type="checkbox"][value="*"]'), null,
    'un groupe qui porte « tout » se propage en silence à chaque nouveau membre');
});

test('un 409 « dernier administrateur » se lit à l’écran, en clair', async () => {
  const { win, doc } = await boot(api({
    putUser: () => [409, { errors: [{ code: 'dernier_administrateur', message: 'Impossible : plus aucun compte actif ne pourrait administrer la console.' }] }],
  }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-user');

  const ligne = [...doc.querySelectorAll('.acces-user')].find((l) => /ops@nota\.ca/.test(text(l)));
  click(win, ligne.querySelector('.acces-user-edit'));
  const form = await waitFor(win, '.acces-user-form');
  const joker = form.querySelector('input[type="checkbox"][name="complet"]');
  assert.ok(joker, 'l’accès complet se donne et se retire nommément');
  joker.checked = false;
  joker.dispatchEvent(new win.Event('change', { bubbles: true }));
  submit(win, form);
  for (let i = 0; i < 5; i++) await wait(10);

  const err = form.querySelector('.acces-erreur');
  assert.ok(err && !err.hidden, 'l’erreur est rendue près du formulaire qui l’a provoquée');
  assert.match(text(err), /plus aucun compte actif/);
});

test('sans « users:write » l’écran est en lecture seule', async () => {
  const handler = (method, url, body) => {
    if (url.endsWith('/me')) return [200, { email: 'a@nota.ca', role: 'analyst', permissions: ['analytics:read'] }];
    return api()(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-groupes');
  assert.equal(doc.querySelector('.acces-groupe-form'), null, 'aucun formulaire de groupe');
  assert.equal(doc.querySelector('.acces-user-edit'), null, 'aucun bouton de modification');
  assert.ok(doc.querySelector('.tpl-readonly-note'), 'et la console dit pourquoi');
});
