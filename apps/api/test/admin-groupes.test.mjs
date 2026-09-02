// LE DÉCOUPLAGE UTILISATEUR / GROUPE / PERMISSION, de bout en bout.
//
// `rbac.js` portait déjà les primitives — et personne ne les appelait :
// `admin.js` tenait sa propre table `rôle → permissions`, figée dans le code.
// Deux conséquences : un opérateur ne pouvait rien accorder à la carte, et le
// catalogue publié (13 clés) ne décrivait pas ce qui était réellement appliqué
// (5 clés). Cette suite tient le contrat inverse :
//
//   • une PERMISSION est une capacité `ressource:action` du catalogue ;
//   • un GROUPE réunit des permissions et se stocke ;
//   • un UTILISATEUR reçoit des groupes ET des permissions directes ;
//   • ses permissions EFFECTIVES sont l'union des deux, plus le rôle hérité.
//
// Le rôle survit comme paquet de compatibilité pour les comptes créés avant les
// groupes — jamais comme la seule granularité offerte.
//
// LE GARDE-FOU QUI COMPTE : on ne doit jamais pouvoir se verrouiller dehors.
// Retirer le dernier détenteur du joker, ou le désactiver, laisserait la console
// sans personne pour la rouvrir — une porte d'administration sans issue de
// secours est une panne, pas une politique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createDynamoRepo } = require('../src/repo-dynamo.js');
const rbac = require('../src/rbac.js');
const authDefaults = require('../src/admin-auth.js');

const TODAY = '2026-09-02';
const START = 1_700_000_000_000;
const NOW_ISO = new Date(START).toISOString();
// Le journal est indexé par le JOUR de l'horloge injectée, pas par la date du
// produit : une entrée écrite à START se lit sous ce jour-là.
const AUDIT_DAY = NOW_ISO.slice(0, 10);
const parse = (res) => JSON.parse(res.body);

function make() {
  const repo = createMemoryRepo();
  const clock = { ms: START };
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: { allowlist: ['ops@nota.ca', 'support@nota.ca', 'analyst@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => TODAY }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => TODAY,
    nowMs: () => clock.ms,
  });
  const call = (method, path, { body, bearer } = {}) => {
    // Le harnais sépare le chemin de la requête, comme le fait la passerelle.
    const [chemin, qs] = String(path).split('?');
    const query = {};
    for (const [k, v] of new URLSearchParams(qs || '')) query[k] = v;
    return app.handle({
      method, path: chemin, query,
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  return { repo, admin, app, clock, call };
}

async function login(h, email = 'ops@nota.ca') {
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  return parse(await h.call('POST', '/admin/auth/verify', { body: { token } })).session;
}

// Un compte SANS joker : ni rôle privilégié, ni permission directe, ni groupe.
async function loginNu(h, email = 'support@nota.ca') {
  await h.repo.putAdmin({
    id: authDefaults.adminIdForEmail(email), email, role: 'analyst',
    disabled: false, createdAt: NOW_ISO,
  });
  return login(h, email);
}

// ============================================================================
// Le port de dépôt
// ============================================================================

test('memory repo : un groupe fait l’aller-retour, se liste et se supprime', async () => {
  const repo = createMemoryRepo();
  assert.deepEqual(await repo.listGroups(), []);
  const g = await repo.putGroup({ id: 'support', nom: 'Soutien', permissions: ['users:read'] }, NOW_ISO);
  assert.equal(g.updatedAt, NOW_ISO);
  assert.deepEqual(await repo.getGroup('support'), g);
  assert.equal((await repo.listGroups()).length, 1);
  await repo.deleteGroup('support');
  assert.equal(await repo.getGroup('support'), null);
});

test('dynamo repo : les groupes tiennent dans UNE partition de la table ADMIN', async () => {
  const sent = [];
  const doc = { async send(cmd) { sent.push({ name: cmd.constructor.name, input: cmd.input }); return {}; } };
  const repo = createDynamoRepo({ tableName: 'main', adminTableName: 'admin', doc });
  await repo.putGroup({ id: 'support', nom: 'Soutien', permissions: ['users:read'] }, NOW_ISO);
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.TableName, 'admin', 'l’identité vit sur la table admin, jamais avec les offres');
  assert.equal(put.input.Item.PK, 'GROUPS');
  assert.equal(put.input.Item.SK, 'GROUP#support');

  // La liste se lit par une Query sur cette partition. Le dépôt ne fait AUCUN
  // Scan, et ce n'est pas une question de coût : un Scan obligerait à donner à
  // la Lambda admin la permission de parcourir toute la table des identités.
  await repo.listGroups();
  const q = sent.find((s) => s.name === 'QueryCommand');
  assert.ok(q, 'la liste passe par une Query');
  assert.equal(q.input.ExpressionAttributeValues[':pk'], 'GROUPS');
});

// ============================================================================
// Le catalogue des permissions
// ============================================================================

test('le catalogue publié EST celui qu’applique le serveur', async () => {
  const h = make();
  const s = await login(h);
  const body = parse(await h.call('GET', '/admin/permissions', { bearer: s }));
  assert.deepEqual(body.permissions.map((p) => p.cle).sort(), rbac.PERMISSIONS.slice().sort(),
    'aucune clé publiée qui ne soit pas dans le catalogue, et réciproquement');
  for (const p of body.permissions) {
    assert.ok(p.libelle && p.libelleEn, 'chaque permission se lit dans les deux langues : ' + p.cle);
  }
});

// ============================================================================
// Les groupes
// ============================================================================

test('un groupe se crée, se lit, se modifie et se supprime — sous permission', async () => {
  const h = make();
  const s = await login(h);

  const cree = await h.call('PUT', '/admin/groups/soutien', {
    bearer: s, body: { nom: 'Soutien', description: 'Lecture des dossiers', permissions: ['users:read', 'audit:read'] },
  });
  assert.equal(cree.statusCode, 200, cree.body);
  assert.deepEqual(parse(cree).groupe.permissions.sort(), ['audit:read', 'users:read']);

  const liste = parse(await h.call('GET', '/admin/groups', { bearer: s }));
  assert.equal(liste.groupes.length, 1);
  assert.equal(liste.groupes[0].nom, 'Soutien');

  assert.equal((await h.call('DELETE', '/admin/groups/soutien', { bearer: s })).statusCode, 200);
  assert.equal(parse(await h.call('GET', '/admin/groups', { bearer: s })).groupes.length, 0);
});

test('un groupe ne peut pas porter une permission inconnue', async () => {
  const h = make();
  const s = await login(h);
  const res = await h.call('PUT', '/admin/groups/x', { bearer: s, body: { nom: 'X', permissions: ['pas:une:permission'] } });
  assert.equal(res.statusCode, 422);
  assert.ok(parse(res).errors.some((e) => e.code === 'permission_inconnue'), res.body);
});

test('un compte sans « groups:write » ne peut pas toucher aux groupes', async () => {
  const h = make();
  const nu = await loginNu(h);
  assert.equal((await h.call('PUT', '/admin/groups/x', { bearer: nu, body: { nom: 'X', permissions: [] } })).statusCode, 403);
  assert.equal((await h.call('DELETE', '/admin/groups/x', { bearer: nu })).statusCode, 403);
});

// ============================================================================
// L'union — le cœur du découplage
// ============================================================================

test('les permissions effectives sont l’union du rôle, des groupes et des grants directs', async () => {
  const h = make();
  const s = await login(h);
  await h.call('PUT', '/admin/groups/soutien', { bearer: s, body: { nom: 'Soutien', permissions: ['users:read'] } });
  await h.call('PUT', '/admin/groups/veille', { bearer: s, body: { nom: 'Veille', permissions: ['audit:read'] } });

  const cible = 'support@nota.ca';
  const res = await h.call('PUT', '/admin/users/' + encodeURIComponent(cible), {
    bearer: s,
    body: { groupes: ['soutien', 'veille'], permissions: ['analytics:read'] },
  });
  assert.equal(res.statusCode, 200, res.body);

  const sessionCible = await login(h, cible);
  const moi = parse(await h.call('GET', '/admin/me', { bearer: sessionCible }));
  assert.deepEqual(moi.permissions.slice().sort(), ['analytics:read', 'audit:read', 'users:read']);
  // Et la permission accordée MORD réellement sur une route gardée.
  assert.equal((await h.call('GET', '/admin/audit?jour=' + TODAY, { bearer: sessionCible })).statusCode, 200);
  assert.equal((await h.call('PUT', '/admin/prix', { bearer: sessionCible, body: { prixCents: 1 } })).statusCode, 403);
});

test('retirer un groupe retire ses permissions, sans toucher aux grants directs', async () => {
  const h = make();
  const s = await login(h);
  await h.call('PUT', '/admin/groups/soutien', { bearer: s, body: { nom: 'Soutien', permissions: ['users:read'] } });
  const cible = 'support@nota.ca';
  await h.call('PUT', '/admin/users/' + encodeURIComponent(cible), { bearer: s, body: { groupes: ['soutien'], permissions: ['audit:read'] } });

  // Le groupe disparaît : ses permissions s'en vont avec lui, le grant direct reste.
  await h.call('DELETE', '/admin/groups/soutien', { bearer: s });
  const moi = parse(await h.call('GET', '/admin/me', { bearer: await login(h, cible) }));
  assert.deepEqual(moi.permissions, ['audit:read']);
});

test('un groupe supprimé ne laisse pas une permission fantôme sur ses membres', async () => {
  const h = make();
  const s = await login(h);
  await h.call('PUT', '/admin/groups/tout', { bearer: s, body: { nom: 'Tout', permissions: ['settings:write'] } });
  const cible = 'support@nota.ca';
  await h.call('PUT', '/admin/users/' + encodeURIComponent(cible), { bearer: s, body: { groupes: ['tout'], permissions: [] } });
  const avant = await login(h, cible);
  assert.equal((await h.call('PUT', '/admin/prix', { bearer: avant, body: { prixCents: 30000 } })).statusCode, 200);

  await h.call('DELETE', '/admin/groups/tout', { bearer: s });
  // MÊME session : la permission est relue à chaque requête, jamais figée dans le jeton.
  assert.equal((await h.call('PUT', '/admin/prix', { bearer: avant, body: { prixCents: 31000 } })).statusCode, 403);
});

// ============================================================================
// Le garde-fou : ne jamais se verrouiller dehors
// ============================================================================

test('le DERNIER détenteur du joker ne peut ni se désactiver ni perdre le joker', async () => {
  const h = make();
  const s = await login(h);
  const moi = 'ops@nota.ca';

  const perte = await h.call('PUT', '/admin/users/' + encodeURIComponent(moi), {
    bearer: s, body: { role: 'analyst', groupes: [], permissions: [] },
  });
  assert.equal(perte.statusCode, 409, perte.body);
  assert.ok(parse(perte).errors.some((e) => e.code === 'dernier_administrateur'), perte.body);

  const desactive = await h.call('PUT', '/admin/users/' + encodeURIComponent(moi), { bearer: s, body: { disabled: true } });
  assert.equal(desactive.statusCode, 409, desactive.body);
});

test('dès qu’un SECOND détenteur du joker existe, le premier peut se retirer', async () => {
  const h = make();
  const s = await login(h);
  await h.call('PUT', '/admin/users/' + encodeURIComponent('support@nota.ca'), {
    bearer: s, body: { permissions: [rbac.WILDCARD] },
  });
  const res = await h.call('PUT', '/admin/users/' + encodeURIComponent('ops@nota.ca'), {
    bearer: s, body: { role: 'analyst', groupes: [], permissions: [] },
  });
  assert.equal(res.statusCode, 200, res.body);
});

// ============================================================================
// L'audit — une permission accordée est une décision, elle laisse une trace
// ============================================================================

test('chaque changement de groupe ou d’accès est journalisé avec avant et après', async () => {
  const h = make();
  const s = await login(h);
  await h.call('PUT', '/admin/groups/soutien', { bearer: s, body: { nom: 'Soutien', permissions: ['users:read'] } });
  await h.call('PUT', '/admin/users/' + encodeURIComponent('support@nota.ca'), { bearer: s, body: { groupes: ['soutien'] } });

  const entries = await h.repo.queryAuditByDay(AUDIT_DAY);
  const actions = entries.map((e) => e.action);
  assert.ok(actions.includes('groupe_modifie'), actions.join(','));
  assert.ok(actions.includes('acces_modifie'), actions.join(','));
  const acces = entries.find((e) => e.action === 'acces_modifie');
  assert.equal(acces.meta.cible, 'support@nota.ca');
  assert.equal(acces.meta.avant, null, 'aucun accès avant');
  assert.deepEqual(acces.meta.apres.groupes, ['soutien'], 'et le groupe après');
  assert.equal(acces.email, 'ops@nota.ca', 'qui a décidé');
});
