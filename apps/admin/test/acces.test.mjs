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

// ---------------------------------------------------------------------------
// Audit console admin (2026-09-03)
// ---------------------------------------------------------------------------

test('P0-7 — supprimer un groupe demande une confirmation qui le nomme, avec ses membres ; rien ne part avant', async () => {
  const supprimes = [];
  const handler = (method, url, body) => {
    if (url.includes('/groups/') && method === 'DELETE') { supprimes.push(url); return [200, { ok: true }]; }
    return api()(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-groupe');
  const row = doc.querySelector('.acces-groupe');
  click(win, row.querySelector('.acces-groupe-del'));
  await wait(10);
  assert.equal(supprimes.length, 0, 'le premier clic n’efface rien');
  const confirm = row.querySelector('.bareme-confirm');
  assert.ok(confirm && !confirm.hidden, 'la confirmation s’ouvre dans la ligne');
  assert.match(text(confirm), /Soutien/, 'elle nomme le groupe');
  assert.match(text(confirm), /1 membre/, 'et compte ses membres (support@nota.ca)');
  assert.equal(win.document.activeElement, confirm.querySelector('button'), 'le focus va au bouton de confirmation');

  click(win, [...confirm.querySelectorAll('button')].find((b) => /Annuler/.test(text(b))));
  assert.equal(confirm.hidden, true);
  assert.equal(supprimes.length, 0);

  click(win, row.querySelector('.acces-groupe-del'));
  click(win, [...confirm.querySelectorAll('button')].find((b) => /Confirmer/.test(text(b))));
  for (let i = 0; i < 4; i++) await wait(10);
  assert.equal(supprimes.length, 1);
  assert.match(supprimes[0], /\/groups\/soutien$/);
});

test('P0-7 — un refus du serveur à la suppression se lit dans la ligne, en clair', async () => {
  const handler = (method, url, body) => {
    if (url.includes('/groups/') && method === 'DELETE') return [404, { errors: [{ code: 'groupe_introuvable', message: 'Ce groupe n’existe pas.' }] }];
    return api()(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-groupe');
  const row = doc.querySelector('.acces-groupe');
  click(win, row.querySelector('.acces-groupe-del'));
  click(win, [...row.querySelectorAll('.bareme-confirm button')].find((b) => /Confirmer/.test(text(b))));
  for (let i = 0; i < 4; i++) await wait(10);
  const err = row.querySelector('.tpl-error');
  assert.ok(err && !err.hidden, 'l’erreur est rendue près du geste');
  assert.match(text(err), /Groupe introuvable/, 'le code est dit en clair (ERREUR_CLAIRE)');
  assert.match(text(err), /n’existe pas/, 'et le mot du serveur reste dessous');
  assert.equal(err.getAttribute('role'), 'alert');
});

test('P0-8 — « Modifier » ouvre le groupe avec son nom, sa description et ses permissions, et le PUT garde la description', async () => {
  const recus = [];
  const { win, doc } = await boot(api({ putGroup: (b) => { recus.push(b); return [200, { ok: true, groupe: { id: 'soutien', ...b } }]; } }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-groupe');
  const row = doc.querySelector('.acces-groupe');
  const edit = row.querySelector('.acces-groupe-edit');
  assert.ok(edit, 'chaque ligne offre « Modifier »');
  click(win, edit);
  const form = await waitFor(win, '.acces-groupe .acces-groupe-form');
  const id = form.querySelector('[name="id"]');
  assert.equal(id.value, 'soutien');
  assert.equal(id.readOnly, true, 'l’identifiant ne se change pas : c’est la clé');
  assert.equal(form.querySelector('[name="nom"]').value, 'Soutien');
  assert.equal(form.querySelector('[name="description"]').value, 'Lecture des dossiers');
  assert.equal(form.querySelector('input[type="checkbox"][value="audit:read"]').checked, true);

  type(win, form.querySelector('[name="nom"]'), 'Soutien clientèle');
  submit(win, form);
  for (let i = 0; i < 4; i++) await wait(10);
  assert.equal(recus.length, 1);
  assert.equal(recus[0].nom, 'Soutien clientèle');
  assert.equal(recus[0].description, 'Lecture des dossiers', 'la description n’est plus effacée par un enregistrement');
  assert.deepEqual(recus[0].permissions, ['audit:read']);
});

test('P0-8 — en création, un identifiant déjà pris est refusé AVANT le réseau, et renvoie vers « Modifier »', async () => {
  const recus = [];
  const { win, doc } = await boot(api({ putGroup: (b) => { recus.push(b); return [200, { ok: true, groupe: {} }]; } }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  const form = await waitFor(win, '.acces-groupes > .acces-groupe-form');
  type(win, form.querySelector('[name="id"]'), 'soutien');
  type(win, form.querySelector('[name="nom"]'), 'Doublon');
  submit(win, form);
  for (let i = 0; i < 3; i++) await wait(10);
  assert.equal(recus.length, 0, 'rien ne part');
  const err = form.querySelector('.tpl-error');
  assert.ok(err && !err.hidden);
  assert.match(text(err), /porte déjà l’identifiant/);
  assert.equal(win.document.activeElement, form.querySelector('[name="id"]'), 'le focus va au champ fautif');
  assert.equal(form.querySelector('[name="id"]').getAttribute('aria-invalid'), 'true');
});

test('P2-28 — un identifiant mal formé est refusé côté console, dans les mots du serveur', async () => {
  const recus = [];
  const { win, doc } = await boot(api({ putGroup: (b) => { recus.push(b); return [200, { ok: true, groupe: {} }]; } }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  const form = await waitFor(win, '.acces-groupes > .acces-groupe-form');
  type(win, form.querySelector('[name="id"]'), 'Mauvais Id!');
  type(win, form.querySelector('[name="nom"]'), 'X');
  submit(win, form);
  for (let i = 0; i < 3; i++) await wait(10);
  assert.equal(recus.length, 0);
  assert.match(text(form.querySelector('.tpl-error')), /minuscules, sans espace/);
});

test('P1-12 — un 403 sur les groupes ou les utilisateurs se lit « Réservé », jamais « Aucun groupe »', async () => {
  const handler = (method, url, body) => {
    if (url.endsWith('/groups') && method === 'GET') return [403, { errors: [{ code: 'interdit', message: 'Lecture des groupes non autorisée.' }] }];
    if (url.endsWith('/users') && method === 'GET') return [403, { errors: [{ code: 'interdit', message: 'Lecture des utilisateurs non autorisée.' }] }];
    return api()(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-groupes');
  const groupes = text(doc.querySelector('.acces-groupes'));
  assert.doesNotMatch(groupes, /Aucun groupe pour le moment/);
  assert.match(groupes, /Réservé — .*Voir les groupes/);
  const users = text(doc.querySelector('.acces-users'));
  assert.match(users, /Réservé — .*Voir les utilisateurs/);
  assert.equal(doc.querySelector('.error-banner'), null, 'une porte fermée n’est pas une panne');
});

test('P1-12 — un 403 sur le catalogue des permissions ferme la section proprement', async () => {
  const handler = (method, url, body) => {
    if (url.endsWith('/permissions')) return [403, { errors: [{ code: 'interdit', message: 'Lecture du catalogue des permissions non autorisée.' }] }];
    return api()(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.admin-denied');
  assert.match(text(doc.querySelector('.admin-denied')), /Lire le catalogue des permissions/);
  assert.equal(doc.querySelector('.error-banner'), null);
});

test('P1-14 — le formulaire d’une personne permet de la désactiver, et l’envoie', async () => {
  const recus = [];
  const { win, doc } = await boot(api({ putUser: (b) => { recus.push(b); return [200, { ok: true, utilisateur: {} }]; } }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-user');
  const ligne = [...doc.querySelectorAll('.acces-user')].find((l) => /support@nota\.ca/.test(text(l)));
  click(win, ligne.querySelector('.acces-user-edit'));
  const form = await waitFor(win, '.acces-user-form');
  const off = form.querySelector('input[type="checkbox"][name="disabled"]');
  assert.ok(off, 'la case « Compte désactivé » existe');
  assert.equal(off.checked, false);
  off.checked = true;
  submit(win, form);
  for (let i = 0; i < 4; i++) await wait(10);
  assert.equal(recus.length, 1);
  assert.equal(recus[0].disabled, true);
  assert.deepEqual(recus[0].groupes, ['soutien']);
});

test('P1-13 — un 409 « dernier administrateur » se dit en clair, traduisible, avec le mot du serveur dessous', async () => {
  const { win, doc } = await boot(api({
    putUser: () => [409, { errors: [{ code: 'dernier_administrateur', message: 'Impossible : plus aucun compte actif ne pourrait administrer la console.' }] }],
  }), '#/auth?token=T', );
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-user');
  const ligne = [...doc.querySelectorAll('.acces-user')].find((l) => /ops@nota\.ca/.test(text(l)));
  click(win, ligne.querySelector('.acces-user-edit'));
  const form = await waitFor(win, '.acces-user-form');
  submit(win, form);
  for (let i = 0; i < 5; i++) await wait(10);
  const err = form.querySelector('.acces-erreur');
  assert.ok(err && !err.hidden);
  assert.match(text(err.querySelector('strong')), /Dernier administrateur/, 'la phrase claire d’abord');
  assert.match(text(err.querySelector('.tpl-error-detail')), /plus aucun compte actif/, 'le détail du serveur dessous');
  assert.equal(err.getAttribute('role'), 'alert');
});

test('P1-17 — en anglais, les permissions se lisent par leur libellé anglais servi par l’API', async () => {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/#/auth?token=T',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = makeFetch(api(), calls);
      window.scrollTo = () => {};
      window.localStorage.setItem('nota.lang', 'en');
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  win.eval(readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8'));
  win.eval(ADMIN_SRC);
  for (let i = 0; i < 3; i++) await wait(5);
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/acces';
  await waitFor(win, '.acces-groupe');
  for (let i = 0; i < 3; i++) await wait(5);
  const doc = win.document;
  assert.match(text(doc.querySelector('.acces-groupe .acces-perm-list')), /Read the audit log/);
  assert.doesNotMatch(text(doc.querySelector('.acces-groupe .acces-perm-list')), /Lire le journal/);
  const ligne = [...doc.querySelectorAll('.acces-user')].find((l) => /support@nota\.ca/.test(text(l)));
  assert.match(text(ligne), /Read the audit log/, 'le résumé des accès effectifs aussi');
  const form = doc.querySelector('.acces-groupes > .acces-groupe-form');
  assert.match(text(form.querySelector('.acces-perms')), /Assign groups and permissions/, 'et les cases à cocher');
});
