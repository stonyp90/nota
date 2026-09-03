// GET /admin/notaries et GET /admin/audit — la surveillance côté opérateur.
//
// Le propriétaire (2026-09-01) veut que chaque commission soit divulguée et que
// chaque transaction soit auditable. Le notaire voit son relevé ; Nota, elle,
// doit pouvoir voir le registre : qui sont les notaires, quelle cote ils
// portent, à quel taux ils sont facturés, et ce que le journal d'audit dit de
// chaque règlement. Ces deux portes exposent des renseignements personnels et
// des chiffres d'affaires : elles exigent 'pii:read' (super_admin), jamais le
// simple jeton d'analyste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const authDefaults = require('../src/admin-auth.js');

const START = 1_700_000_000_000;
const NOW_ISO = new Date(START).toISOString();
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
    config: { allowlist: ['ops@nota.ca', 'analyst@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => NOW_ISO.slice(0, 10) }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => NOW_ISO.slice(0, 10),
    nowMs: () => clock.ms,
  });
  const call = (method, path, { bearer, query } = {}) =>
    app.handle({
      method,
      path,
      query: query || {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
    });
  return { repo, admin, app, clock, call };
}

// Le vrai aller-retour : lien magique -> jeton de session.
async function login2(h, email) {
  const req = parse(await h.app.handle({ method: 'POST', path: '/admin/auth/request', query: {}, headers: { 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify({ email }) }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  const verified = parse(await h.app.handle({ method: 'POST', path: '/admin/auth/verify', query: {}, headers: { 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify({ token }) }));
  return verified.session;
}

async function loginAnalyste(h) {
  const email = 'analyst@nota.ca';
  await h.repo.putAdmin({ id: authDefaults.adminIdForEmail(email), email, role: 'analyst', disabled: false, createdAt: NOW_ISO });
  return login2(h, email);
}

async function seedNotaire(h, id, over = {}) {
  await h.repo.putNotary({
    id, email: id + '@etude.ca', label: 'Étude ' + id,
    status: 'active', chargesEnabled: true, connectAccountId: 'acct_' + id,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
}

test('le registre des notaires est fermé sans session, et fermé à l’analyste', async () => {
  const h = make();
  assert.equal((await h.call('GET', '/admin/notaries')).statusCode, 401);
  const analyste = await loginAnalyste(h);
  assert.equal((await h.call('GET', '/admin/notaries', { bearer: analyste })).statusCode, 403,
    'un registre nominatif exige pii:read');
});

test('le registre nomme, pour chaque notaire, sa cote et ce qu’il a porté', async () => {
  const h = make();
  const session = await login2(h, 'ops@nota.ca');
  await seedNotaire(h, 'n1', {
    ratingSum: 4.9 * 40, ratingCount: 40,
    actsCompleted: 80, actsByService: { refinancement: 50, financement: 30 },
    proposalsCount: 60, declinesCount: 3, rayonKm: 50, urgences: true,
    lienCNQ: 'https://www.cnq.org/f/1/', prefixe: 'G1R',
    createdAt: '2025-01-01T00:00:00.000Z', lastSeenAt: NOW_ISO,
    commissionCentsCollected: 123_400,
  });
  await seedNotaire(h, 'n2', { status: 'onboarding', chargesEnabled: false });

  const body = parse(await h.call('GET', '/admin/notaries', { bearer: session }));
  assert.equal(body.notaires.length, 2, 'même les notaires en inscription figurent au registre');
  const n1 = body.notaires.find((n) => n.id === 'n1');
  assert.ok(n1.cote > 90, 'la cote du registre est la même que celle qui facture : ' + n1.cote);
  // ADR 0031 — le registre ne porte plus ni taux ni part : le notaire garde
  // 100 % de ses honoraires, et une colonne « le notaire garde X % », même
  // dans une console interne, décrirait la convention que l'art. 29.1 du Code
  // de déontologie lui interdit de conclure.
  assert.equal(n1.tauxEffectif, undefined);
  assert.equal(n1.part, undefined);
  assert.equal(body.bareme, undefined, 'et aucun barème ne clôt le registre');
  assert.equal(n1.actes, 80);
  assert.equal(n1.note, 4.9);
  assert.equal(n1.avis, 40);
  assert.equal(n1.commissionPercue, 1234, 'la commission encaissée, en dollars');
  assert.equal(n1.email, 'n1@etude.ca');
  assert.equal(n1.axes.length, 4, 'les axes voyagent : une cote contestée doit pouvoir être refaite');

  const n2 = body.notaires.find((n) => n.id === 'n2');
  assert.equal(n2.statut, 'onboarding');
  assert.equal(n2.actes, 0);
  assert.equal(n2.note, null, 'jamais une fausse moyenne');
});

test('le registre est trié par cote décroissante — le tableau d’honneur est immédiat', async () => {
  const h = make();
  const session = await login2(h, 'ops@nota.ca');
  await seedNotaire(h, 'faible', { declinesCount: 20, createdAt: NOW_ISO });
  await seedNotaire(h, 'fort', {
    ratingSum: 4.9 * 40, ratingCount: 40, actsCompleted: 80,
    actsByService: { refinancement: 50, financement: 30 },
    proposalsCount: 60, declinesCount: 3, rayonKm: 50, urgences: true,
    lienCNQ: 'https://www.cnq.org/f/2/', prefixe: 'G1R',
    createdAt: '2025-01-01T00:00:00.000Z', lastSeenAt: NOW_ISO,
  });
  const body = parse(await h.call('GET', '/admin/notaries', { bearer: session }));
  assert.deepEqual(body.notaires.map((n) => n.id), ['fort', 'faible']);
});

test('le journal d’audit se relit par jour — et pas avec le simple jeton d’analyste', async () => {
  const h = make();
  const analyste = await loginAnalyste(h);
  assert.equal((await h.call('GET', '/admin/audit', { bearer: analyste, query: { jour: '2026-08-12' } })).statusCode, 403);

  const session = await login2(h, 'ops@nota.ca');
  await h.repo.appendAudit({ id: 'a1', ts: '2026-08-12T15:00:00.000Z', day: '2026-08-12', action: 'acte_regle', meta: { montant: 2000, commission: 300, net: 1700, taux: 0.15, cote: 51 } });
  await h.repo.appendAudit({ id: 'a2', ts: '2026-08-13T15:00:00.000Z', day: '2026-08-13', action: 'acte_regle', meta: { montant: 1000 } });

  const body = parse(await h.call('GET', '/admin/audit', { bearer: session, query: { jour: '2026-08-12' } }));
  assert.equal(body.jour, '2026-08-12');
  assert.equal(body.entrees.length, 1);
  assert.equal(body.entrees[0].action, 'acte_regle');
  assert.equal(body.entrees[0].meta.commission, 300);

  const vide = parse(await h.call('GET', '/admin/audit', { bearer: session, query: { jour: '2026-01-01' } }));
  assert.deepEqual(vide.entrees, [], 'un jour sans événement est un jour vide, pas une erreur');

  const mauvais = await h.call('GET', '/admin/audit', { bearer: session, query: { jour: 'hier' } });
  assert.equal(mauvais.statusCode, 422);
});

test('un auditeur dédié lit le journal avec audit:read SEUL — sans détenir tout le PII', async () => {
  // Le moindre privilège, vérifié plutôt qu'annoncé : `audit:read` et
  // `pii:read` sont deux capacités distinctes, et la première doit s'ouvrir
  // sans la seconde. Sans ce test, le catalogue pourrait publier une clé que
  // personne n'exerce jamais — c'était exactement l'écart trouvé le 2026-09-03,
  // où le commentaire de la route et l'OpenAPI annonçaient encore `pii:read`.
  const h = make();
  // Un analyste — donc SANS 'pii:read' — à qui l'opérateur a ouvert la seule
  // capacité d'audit, en accord direct.
  const email = 'analyst@nota.ca';
  await h.repo.putAdmin({
    id: authDefaults.adminIdForEmail(email), email, role: 'analyst',
    permissions: ['audit:read'], disabled: false, createdAt: NOW_ISO,
  });
  const session = await login2(h, email);

  await h.repo.appendTxAudit({ id: 'tx9', ts: '2026-08-12T19:00:00.000Z', day: '2026-08-12', action: 'document_lu', meta: { bidId: 'b1' } });

  const res = await h.call('GET', '/admin/audit', { bearer: session, query: { jour: '2026-08-12' } });
  assert.equal(res.statusCode, 200, 'audit:read suffit : ' + res.body);
  assert.deepEqual(parse(res).entrees.map((e) => e.id), ['tx9']);

  // Et la porte nominative, elle, reste fermée : la capacité accordée est
  // bornée à ce qu'elle nomme.
  assert.equal((await h.call('GET', '/admin/notaries', { bearer: session })).statusCode, 403,
    'lire le journal n’ouvre pas le bottin nominatif');
});

test('le journal fusionne les deux sources — gestes d’administration ET mouvements d’argent', async () => {
  const h = make();
  const session = await login2(h, 'ops@nota.ca');
  // Écrit par la console admin (table admin).
  await h.repo.appendAudit({ id: 'adm1', ts: '2026-08-12T09:00:00.000Z', day: '2026-08-12', action: 'commission_schedule_updated', email: 'ops@nota.ca', meta: { after: { taux: 0.15 } } });
  // Écrit par l'API publique (table principale).
  await h.repo.appendTxAudit({ id: 'tx1', ts: '2026-08-12T19:00:00.000Z', day: '2026-08-12', action: 'acte_regle', meta: { montant: 2000, commission: 300, net: 1700, taux: 0.15, cote: 51 } });

  const body = parse(await h.call('GET', '/admin/audit', { bearer: session, query: { jour: '2026-08-12' } }));
  assert.deepEqual(body.entrees.map((e) => e.id), ['tx1', 'adm1'], 'les deux journaux, le plus récent d’abord');
  // L'adaptateur mémoire écrit les deux dans le même tableau : un auditeur ne
  // doit pas voir l'entrée en double pour autant.
  assert.equal(new Set(body.entrees.map((e) => e.id)).size, body.entrees.length, 'aucun doublon');
});
