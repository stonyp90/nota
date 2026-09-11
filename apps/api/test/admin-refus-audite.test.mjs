// UN ACCÈS REFUSÉ LAISSE UNE TRACE (ADR 0036, amendement du 2026-09-11).
//
// Trouvé par l'audit BDD du 11 septembre 2026 : une opératrice qui ne détient
// que `analytics:read` et frappe à `GET /admin/usagers/{courriel}` — le dossier
// d'une personne au sens de la Loi 25 —, à `GET /admin/notaries` et à
// `GET /admin/crm/leads` est refusée trois fois et le journal d'audit n'en dit
// RIEN : seulement `login_requested` et `login_success`. `admin.js` écrivait sur
// chaque lecture sensible RÉUSSIE (`dossier_usager_consulte`) et sur aucun 403.
// Quelqu'un qui sonde les portes des dossiers était invisible au registre même
// qui existe pour rendre un accès reprochable.
//
// Ce que ces tests tiennent :
//
//   1. UN refus = UNE trace `acces_refuse`, signée comme les autres gestes de
//      la console (adminId + courriel de l'opérateur + IP : ce sont des employés
//      nommés, règle antérieure à l'ADR et inchangée), qui nomme la PORTE (le
//      use-case) et la PERMISSION manquante.
//   2. La trace ne porte JAMAIS la ressource demandée ni l'adresse du sujet :
//      le sujet est nommé par la même EMPREINTE que `dossier_usager_consulte`
//      (SHA-256 tronqué à 16 hex). Un journal lu avec `audit:read` sans
//      `pii:read` ne doit pas devenir un second annuaire.
//   3. Le refus répond 403 EXACTEMENT comme avant — même code, même message.
//   4. TOUTES les portes de `admin.js` tracent, pas les trois sondées : un
//      `status: 403` qui ne passe pas par l'entonnoir commun est une porte
//      muette, et le test statique le refuse.
//   5. Un puits d'audit cassé ne change rien à la réponse et crie
//      `audit_write_failed`, comme partout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const authDefaults = require('../src/admin-auth.js');

const TODAY = '2026-09-11';
const START = Date.parse('2026-09-11T15:00:00.000Z');
const NOW_ISO = new Date(START).toISOString();
const IP = '198.51.100.7';
const SUJET = 'cliente@example.com';
const parse = (res) => JSON.parse(res.body);
const empreinte = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

function make() {
  const repo = createMemoryRepo();
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => START,
    config: { allowlist: ['patronne@nota.ca', 'analyste@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => TODAY }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => TODAY,
    nowMs: () => START,
  });
  const call = (method, path, { body, bearer, query } = {}) =>
    app.handle({
      method,
      path,
      query: query || {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': IP } : { 'x-forwarded-for': IP },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const refus = async () => (await repo.queryAuditByDay(TODAY)).filter((e) => e.action === 'acces_refuse');
  return { repo, admin, app, call, refus };
}

async function login(h, email) {
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  return parse(await h.call('POST', '/admin/auth/verify', { body: { token } })).session;
}

// Une opératrice qui existe AVANT sa première connexion, sans rôle : ses seuls
// accès sont les clés accordées une à une.
async function analyste(h, permissions = ['analytics:read']) {
  const email = 'analyste@nota.ca';
  await h.repo.putAdmin({ id: authDefaults.adminIdForEmail(email), email, role: null, disabled: false, permissions, createdAt: NOW_ISO });
  return { session: await login(h, email), email, adminId: authDefaults.adminIdForEmail(email) };
}

// ===========================================================================
// 1. Le cas sondé : le dossier d'une personne
// ===========================================================================

test('un refus au dossier d’une personne laisse UNE trace, signée par l’opératrice, qui nomme la porte et la clé manquante', async () => {
  const h = make();
  const op = await analyste(h);
  const res = await h.call('GET', `/admin/usagers/${encodeURIComponent(SUJET)}`, { bearer: op.session });

  // 3. Le refus est celui d'hier, au caractère près.
  assert.equal(res.statusCode, 403);
  assert.deepEqual(parse(res), { errors: [{ code: 'interdit', message: 'Dossier d’usager non autorisé.' }] });

  // 1. Une trace, une seule, signée comme les autres gestes de la console.
  const traces = await h.refus();
  assert.equal(traces.length, 1, JSON.stringify(traces));
  const [t] = traces;
  assert.equal(t.adminId, op.adminId);
  assert.equal(t.email, op.email, 'la console est nominative : l’opérateur refusé est nommé');
  assert.equal(t.ip, IP);
  assert.equal(t.meta.porte, 'getUserFile');
  assert.equal(t.meta.permission, 'subjects:read');
  assert.equal(typeof t.ttl, 'number', 'la trace expire comme toutes les autres (sept ans)');
});

test('la trace du refus nomme le sujet par son EMPREINTE — jamais son adresse, jamais son dossier', async () => {
  const h = make();
  const op = await analyste(h);
  await h.call('GET', `/admin/usagers/${encodeURIComponent(SUJET)}`, { bearer: op.session });
  const [t] = await h.refus();
  assert.equal(t.meta.sujet, empreinte(SUJET), 'même empreinte que `dossier_usager_consulte`');
  const brut = JSON.stringify(t).toLowerCase();
  assert.equal(brut.includes('cliente'), false, 'l’adresse du sujet ne traîne nulle part dans la trace');
  assert.equal(brut.includes('example.com'), false);
  assert.deepEqual(Object.keys(t.meta).sort(), ['permission', 'porte', 'sujet'], 'rien d’autre : ni offres, ni paiements, ni consentements');
});

test('le sujet n’est empreint que si l’adresse en est une : une porte frappée avec n’importe quoi ne fabrique pas d’empreinte', async () => {
  const h = make();
  const op = await analyste(h);
  await h.call('GET', '/admin/usagers/pas-une-adresse', { bearer: op.session });
  const [t] = await h.refus();
  assert.equal(t.meta.sujet, null);
});

// ===========================================================================
// 2. Chaque porte de admin.js trace — pas seulement les trois sondées
// ===========================================================================

// La table est celle des routes HTTP qui aboutissent à un `rbac.can` de
// admin.js. Une opératrice qui ne détient RIEN les frappe toutes : chacune doit
// répondre 403 ET laisser sa trace, qui nomme la porte et la clé attendue.
const PORTES = [
  ['PUT', '/admin/notifications/templates/offerPublished', { subjectFr: 'x', subjectEn: 'y' }, 'putEmailTemplate', 'notifications:write'],
  ['DELETE', '/admin/notifications/templates/offerPublished', undefined, 'resetEmailTemplate', 'notifications:write'],
  ['PUT', '/admin/prix', {}, 'putPrixNota', 'settings:write'],
  ['DELETE', '/admin/prix', undefined, 'resetPrixNota', 'settings:write'],
  ['PUT', '/admin/annulation', {}, 'putCancellationSchedule', 'settings:write'],
  ['DELETE', '/admin/annulation', undefined, 'resetCancellationSchedule', 'settings:write'],
  ['GET', '/admin/notaries', undefined, 'listNotaries', 'pii:read'],
  ['POST', '/admin/notaries/n1/activer', {}, 'activateNotary', 'moderation:write'],
  ['GET', '/admin/audit', undefined, 'readAudit', 'audit:read'],
  ['GET', '/admin/catalogue', undefined, 'getCatalogue', 'analytics:read'],
  ['GET', '/admin/features', undefined, 'getFeatures', 'analytics:read'],
  ['GET', '/admin/cabinets', undefined, 'listCabinets', 'cabinets:read'],
  ['PUT', '/admin/cabinets/c1', {}, 'putCabinet', 'cabinets:write'],
  ['DELETE', '/admin/cabinets/c1', undefined, 'deleteCabinet', 'cabinets:write'],
  ['GET', '/admin/audiences/groups', undefined, 'listAudienceGroups', 'audiences:read'],
  ['PUT', '/admin/audiences/groups/g1', {}, 'putAudienceGroup', 'audiences:write'],
  ['DELETE', '/admin/audiences/groups/g1', undefined, 'deleteAudienceGroup', 'audiences:write'],
  ['GET', '/admin/segments', undefined, 'listSegments', 'analytics:read'],
  ['POST', '/admin/campaigns/preview', {}, 'previewCampaign', 'analytics:read'],
  ['POST', '/admin/campaigns', {}, 'sendCampaign', 'campaigns:send'],
  ['GET', '/admin/campaigns', undefined, 'listCampaigns', 'analytics:read'],
  ['GET', '/admin/campaigns/c1/recipients', undefined, 'listCampaignRecipients', 'analytics:read'],
  ['GET', `/admin/usagers/${encodeURIComponent(SUJET)}`, undefined, 'getUserFile', 'subjects:read'],
  ['GET', `/admin/usagers/${encodeURIComponent(SUJET)}/export`, undefined, 'exportUserFile', 'subjects:read'],
  ['POST', `/admin/usagers/${encodeURIComponent(SUJET)}/effacement`, { confirmer: true }, 'eraseUserFile', 'subjects:erase'],
  ['GET', '/admin/crm/leads', undefined, 'listCrmLeads', 'leads:read'],
  ['PUT', '/admin/crm/leads/b1', { dateISO: '2026-09-20' }, 'updateCrmLead', 'leads:write'],
  ['GET', '/admin/support', undefined, 'listSupport', 'support:read'],
];

for (const [method, path, body, porte, permission] of PORTES) {
  test(`${method} ${path} refusé → 403 inchangé + une trace « acces_refuse » (${porte} / ${permission})`, async () => {
    const h = make();
    const op = await analyste(h, []);
    const res = await h.call(method, path, { bearer: op.session, body });
    assert.equal(res.statusCode, 403, res.body);
    const corps = parse(res);
    assert.deepEqual(Object.keys(corps), ['errors'], 'un refus ne livre rien d’autre que ses erreurs');
    assert.equal(corps.errors[0].code, 'interdit');
    const traces = await h.refus();
    assert.equal(traces.length, 1, 'exactement une trace : ' + JSON.stringify(traces));
    assert.equal(traces[0].meta.porte, porte);
    assert.equal(traces[0].meta.permission, permission);
    assert.equal(traces[0].adminId, op.adminId);
  });
}

// Une porte à DEUX clés (la messagerie de soutien exige support:read ET
// pii:read) nomme toutes celles qui manquent, la première en tête.
test('une porte à deux clés nomme chaque clé manquante', async () => {
  const h = make();
  const op = await analyste(h, ['support:read']);
  const res = await h.call('GET', '/admin/support', { bearer: op.session });
  assert.equal(res.statusCode, 403);
  const [t] = await h.refus();
  assert.equal(t.meta.permission, 'pii:read');
  assert.equal(t.meta.manquantes, undefined, 'une seule clé manque : pas de liste');

  const h2 = make();
  const op2 = await analyste(h2, []);
  await h2.call('GET', '/admin/support', { bearer: op2.session });
  const [t2] = await h2.refus();
  assert.equal(t2.meta.permission, 'support:read');
  assert.deepEqual(t2.meta.manquantes, ['support:read', 'pii:read']);
});

// Une porte qui s'ouvre avec L'UNE OU L'AUTRE de deux clés (le prix : settings:write
// ou billing:write) nomme la clé principale, et l'autre comme équivalente.
test('une porte « l’une ou l’autre » nomme les deux clés qui l’auraient ouverte', async () => {
  const h = make();
  const op = await analyste(h, []);
  await h.call('PUT', '/admin/prix', { bearer: op.session, body: {} });
  const [t] = await h.refus();
  assert.equal(t.meta.permission, 'settings:write');
  assert.deepEqual(t.meta.equivalentes, ['billing:write']);
});

// ===========================================================================
// 3. Ce qui ne trace PAS
// ===========================================================================

test('un accès ACCORDÉ n’écrit aucune trace de refus', async () => {
  const h = make();
  const session = await login(h, 'patronne@nota.ca');
  for (const [method, path, body] of PORTES.filter(([, p]) => p === '/admin/notaries' || p === '/admin/crm/leads' || p.startsWith('/admin/usagers/') && !p.endsWith('effacement'))) {
    const res = await h.call(method, path, { bearer: session, body });
    assert.equal(res.statusCode, 200, `${method} ${path}: ${res.body}`);
  }
  assert.deepEqual(await h.refus(), []);
});

test('sans session il n’y a pas d’opérateur à nommer : un 401 ne fabrique pas de trace de refus', async () => {
  const h = make();
  const res = await h.call('GET', '/admin/notaries', { bearer: 'pas-un-jeton' });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(await h.refus(), []);
});

// ===========================================================================
// 4. Le puits cassé
// ===========================================================================

test('un puits d’audit cassé ne change pas le refus, et crie « audit_write_failed » pour « acces_refuse »', async () => {
  const h = make();
  const op = await analyste(h);
  h.repo.appendAudit = async () => { throw new Error('DynamoDB: ProvisionedThroughputExceededException'); };
  const lignes = [];
  const consoleError = console.error;
  console.error = (...args) => lignes.push(args.map(String).join(' '));
  let res;
  try {
    res = await h.call('GET', '/admin/notaries', { bearer: op.session });
  } finally {
    console.error = consoleError;
  }
  assert.equal(res.statusCode, 403);
  assert.deepEqual(parse(res), { errors: [{ code: 'interdit', message: 'Cette section demande la permission de lire les renseignements personnels.' }] });
  const alertes = lignes.filter((l) => l.includes('audit_write_failed')).map((l) => JSON.parse(l)).filter((o) => o.action === 'acces_refuse');
  assert.equal(alertes.length, 1, JSON.stringify(lignes));
  assert.equal(alertes[0].adminId, op.adminId);
});

// ===========================================================================
// 5. La garde statique : aucune porte muette dans admin.js
// ===========================================================================

// Un futur `if (!rbac.can(…)) return { ok: false, status: 403, … }` écrit à la
// main rétablirait exactement le trou d'aujourd'hui. Le seul `status: 403` de
// admin.js est celui de l'entonnoir qui écrit la trace.
test('admin.js ne contient aucun 403 hors de l’entonnoir qui l’audite', () => {
  const src = readFileSync(new URL('../src/admin.js', import.meta.url), 'utf8');
  const lignes = src.split('\n');
  // Le corps de l'entonnoir : de sa déclaration à l'accolade qui la ferme, au
  // même retrait. Le seul `status: 403` légitime vit là.
  const debut = lignes.findIndex((l) => /^  async function refuserAcces\(/.test(l));
  assert.ok(debut >= 0, 'l’entonnoir refuserAcces() n’existe pas dans admin.js');
  const fin = lignes.findIndex((l, i) => i > debut && /^  \}\s*$/.test(l));
  assert.ok(fin > debut);
  const hors = [];
  lignes.forEach((l, i) => {
    if (i >= debut && i <= fin) return;
    if (/^\s*\/\//.test(l)) return; // un commentaire n'est pas une porte
    if (/status:\s*403\b/.test(l)) hors.push(`${i + 1}: ${l.trim()}`);
  });
  assert.deepEqual(hors, [], 'des 403 qui ne passent pas par refuserAcces()');
  assert.equal(lignes.slice(debut, fin + 1).filter((l) => /status:\s*403\b/.test(l) && !/^\s*\/\//.test(l)).length, 1, 'l’entonnoir répond 403 une fois');
});
