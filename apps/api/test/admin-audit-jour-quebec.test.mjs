// Revue de f45a2e1 (2026-09-04), deux mineurs sur la console :
//   1. Le journal d'audit est partitionné par jour UTC, mais l'opérateur
//      demande un jour de Québec : un geste de 23 h 30 à Québec vivait dans la
//      partition du lendemain et disparaissait de l'écran du jour.
//   2. Un registre des notaires illisible rendait « 0 $ dû » — l'opérateur en
//      concluait que tout était réglé. Il doit lire « indisponible ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const TODAY = '2026-09-04';
const START = Date.parse('2026-09-04T18:00:00.000Z');
const parse = (res) => JSON.parse(res.body);

function make() {
  const repo = createMemoryRepo();
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
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
  const call = (method, path, { body, bearer, query } = {}) =>
    app.handle({
      method,
      path,
      query: query || {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, admin, app, call };
}

async function login(h, email = 'ops@nota.ca') {
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  return parse(await h.call('POST', '/admin/auth/verify', { body: { token } })).session;
}

test('le journal d’un jour de Québec inclut le geste de 23 h 30 (partition UTC du lendemain) et exclut le midi suivant', async () => {
  const h = make();
  const s = await login(h);
  // Sans `day` explicite, le dépôt range par jour UTC — comme la table admin.
  await h.repo.appendAudit({ id: 'soir', ts: '2026-09-04T03:30:00.000Z', action: 'groupe_modifie', email: 'ops@nota.ca', meta: {} });
  await h.repo.appendAudit({ id: 'midi', ts: '2026-09-04T16:00:00.000Z', action: 'groupe_modifie', email: 'ops@nota.ca', meta: {} });
  await h.repo.appendAudit({ id: 'matin', ts: '2026-09-03T13:00:00.000Z', action: 'groupe_modifie', email: 'ops@nota.ca', meta: {} });

  // La connexion elle-même journalise (login_*) — on ne regarde que nos trois gestes.
  const notres = (j) => j.entrees.map((e) => e.id).filter((id) => ['soir', 'midi', 'matin'].includes(id)).sort();

  const j3 = parse(await h.call('GET', '/admin/audit', { bearer: s, query: { jour: '2026-09-03' } }));
  assert.equal(j3.jour, '2026-09-03');
  assert.deepEqual(notres(j3), ['matin', 'soir'], 'le geste de 23 h 30 à Québec appartient au 3, pas au 4');

  const j4 = parse(await h.call('GET', '/admin/audit', { bearer: s, query: { jour: '2026-09-04' } }));
  assert.deepEqual(notres(j4), ['midi'], 'et il ne réapparaît pas le lendemain');
});

test('un registre des notaires illisible répond `creances: null`, jamais des zéros', async () => {
  const repo = createMemoryRepo();
  await repo.putNotary({ id: 'n1', email: 'n1@etude.ca', status: 'active', commissionCentsDue: 40000 });
  const casse = { ...repo, listNotaries: async () => { throw new Error('dynamo indisponible'); } };
  const o = await createAnalytics({ repo: casse, now: () => TODAY }).overview();
  assert.equal(o.creances, null);
  assert.equal(o.gauge.pendingNotaries, null);
  // Et le registre sain donne bien le solde.
  const ok = await createAnalytics({ repo, now: () => TODAY }).overview();
  assert.equal(ok.creances.commissionCentsDue, 40000);
});
