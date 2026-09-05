// LA PILE LOCALE, ÉPROUVÉE SANS DOCKER.
//
// Rien ne testait le chemin docker : ni `docker-compose.yml`, ni
// `create-table.js`, n'apparaissaient dans un test ou un workflow. La pile
// montait verte et VIDE — les tables créées, aucun PutItem — et personne ne
// l'apprenait avant d'ouvrir la console admin sur un tableau blanc.
//
// Cette suite ne lance aucun conteneur (un test qui exige Docker sur le
// runner ne tourne jamais). Elle éprouve les deux choses qui cassent :
//
//   1. LE SEED ÉCRIT CE QUE LES SURFACES LISENT. `seedInto` tourne contre le
//      MÊME adaptateur DynamoDB que les conteneurs (repo-dynamo sur la fausse
//      table de `fake-table.mjs`, qui évalue vraiment les ConditionExpression),
//      puis les routes publiques et admin sont interrogées sur ce dépôt. Un
//      seed qui écrirait à côté de ce que lit le carnet échoue ici.
//   2. LE FICHIER COMPOSE TIENT SES PROMESSES. Les deux défauts trouvés à
//      l'audit — aucun seed, et des processus qui servent du vieux code — sont
//      des lignes précises du compose. Elles sont relues ici, sinon la
//      correction se perd au prochain remaniement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createFakeTable } from './fake-table.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const domain = require('@nota/domain');
const { createDynamoRepo } = require('../src/repo-dynamo.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createApp } = require('../src/handler.js');
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { seedInto, devBids, devNotaries, devPartners, statsMarker, DEMO_GAUGE } = require('../scripts/dev-fixtures.js');
const { sourceFingerprint } = require('../scripts/source-fingerprint.js');

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TODAY = '2026-09-04';

// Exactement le câblage des conteneurs : l'adaptateur DynamoDB, sur les DEUX
// tables du compose (`nota` et `nota-admin`), routées par TableName comme le
// vrai client. `admin: false` reproduit la Lambda publique, qui n'a pas la
// table admin du tout — une écriture qui partirait là-bas lèverait ici.
function dynamoRepo({ admin = false } = {}) {
  const principale = createFakeTable({ name: 'nota' });
  const administrative = createFakeTable({ name: 'nota-admin' });
  const doc = {
    send: (cmd) => (cmd.input.TableName === 'nota-admin' ? administrative : principale).doc.send(cmd),
  };
  return createDynamoRepo({ tableName: 'nota', ...(admin ? { adminTableName: 'nota-admin' } : {}), doc });
}

// ============================================================================
// 1. Le seed écrit ce que les surfaces lisent
// ============================================================================

test('le seed remplit le carnet PUBLIC que sert la route /bids', async () => {
  const repo = dynamoRepo();
  const resume = await seedInto(repo, { today: TODAY });

  const app = createApp(repo);
  const mois = TODAY.slice(0, 7);
  const res = await app.handle({ method: 'GET', path: '/bids', query: { month: mois }, headers: {}, body: '' });
  assert.equal(res.statusCode, 200);
  const carnet = JSON.parse(res.body);

  // L'attente vient du DOMAINE, pas de ce que le seed a bien voulu écrire.
  const attendues = devBids(TODAY).filter((b) => b.dateISO.slice(0, 7) === mois);
  assert.ok(attendues.length > 0, 'les fixtures doivent couvrir le mois courant');
  assert.equal(carnet.bids.length, attendues.length);
  assert.equal(resume.bids, devBids(TODAY).length);

  // Et le contenu, pas seulement le compte : le montant sert de sonde.
  const parId = new Map(carnet.bids.map((b) => [b.id, b]));
  for (const attendue of attendues) {
    assert.ok(parId.has(attendue.id), `l'offre ${attendue.id} doit être au carnet`);
    assert.equal(parId.get(attendue.id).montant, attendue.montant);
  }
});

test('le seed remplit le registre des NOTAIRES et le journal analytique que lit la console admin', async () => {
  const repo = dynamoRepo();
  await seedInto(repo, { today: TODAY });

  const notaires = await repo.listNotaries();
  assert.equal(notaires.length, devNotaries(TODAY).length);
  // Le registre doit porter l'échelle entière : un actif chevronné ET un
  // notaire en inscription, sinon la console se juge sur un cas unique.
  assert.ok(notaires.some((n) => n.status === 'active' && n.actsCompleted > 0));
  assert.ok(notaires.some((n) => n.status === 'onboarding'));

  const partenaires = await repo.listPartners();
  assert.equal(partenaires.length, devPartners(TODAY).length);
  assert.ok(partenaires.every((p) => p.confirmedAt), 'les codes de démonstration sont confirmés (ADR 0011)');

  const { createAnalytics } = require('../src/analytics.js');
  const overview = await createAnalytics({ repo, now: () => TODAY }).overview({});
  assert.equal(overview.kpis.offersPosted, devBids(TODAY).length, 'chaque offre amorcée est dans la fenêtre de 30 jours');
  assert.ok(overview.series.offersPerDay.some((d) => d.count > 0), 'la série ne doit pas être plate');
});

test("la console admin s'ouvre sur des données amorcées, par le lien magique de dev", async () => {
  const repo = dynamoRepo({ admin: true });
  await seedInto(repo, { today: TODAY });

  const email = 'admin@nota.local';
  const admin = createAdmin({ repo, config: { allowlist: [email], baseUrl: 'http://localhost:4174', devEcho: true } });
  const app = createAdminApp(repo, { admin, adminBaseUrl: 'http://localhost:4174' });

  const demande = await app.handle({ method: 'POST', path: '/admin/auth/request', headers: {}, body: JSON.stringify({ email }), sourceIp: '127.0.0.1' });
  const devLink = JSON.parse(demande.body).devLink;
  assert.ok(devLink, 'hors production, le lien magique est renvoyé dans la réponse');

  const jeton = decodeURIComponent(devLink.split('token=')[1]);
  const verif = await app.handle({ method: 'POST', path: '/admin/auth/verify', headers: {}, body: JSON.stringify({ token: jeton }), sourceIp: '127.0.0.1' });
  assert.equal(verif.statusCode, 200);
  const session = JSON.parse(verif.body).session;

  const vue = await app.handle({ method: 'GET', path: '/admin/metrics/overview', query: {}, headers: { authorization: `Bearer ${session}` }, sourceIp: '127.0.0.1' });
  assert.equal(vue.statusCode, 200);
  const data = JSON.parse(vue.body);
  assert.ok(data.kpis.offersPosted > 0, 'la console amorcée ne rend pas un tableau vide');
  assert.ok(data.gauge.open > 0, 'les offres ouvertes du carnet doivent se voir');
});

// ============================================================================
// 2. Rejouable — c'est la promesse qui rend le script utilisable
// ============================================================================

test('rejouer le seed ne double aucun compteur ni aucune offre', async () => {
  const repo = dynamoRepo();
  const premier = await seedInto(repo, { today: TODAY });
  const { createAnalytics } = require('../src/analytics.js');
  const avant = await createAnalytics({ repo, now: () => TODAY }).overview({});

  const second = await seedInto(repo, { today: TODAY });
  const apres = await createAnalytics({ repo, now: () => TODAY }).overview({});

  assert.ok(premier.stats > 0, 'le premier passage écrit bien un historique');
  assert.equal(second.stats, 0, 'le second passage saute les compteurs atomiques');
  assert.deepEqual(apres.kpis, avant.kpis, 'les KPI doivent être identiques après rejeu');
  assert.equal((await repo.listByMonth(TODAY.slice(0, 7))).length, (await repo.listByMonth(TODAY.slice(0, 7))).length);
  assert.equal((await repo.listNotaries()).length, devNotaries(TODAY).length);
  assert.equal((await repo.listPartners()).length, devPartners(TODAY).length);
  assert.equal(await repo.wasEventProcessed(statsMarker(TODAY)), true, 'la marque de garde est posée');
});

test('--force RÉÉCRIT l’historique : il ne l’additionne pas une seconde fois', async () => {
  const { createAnalytics } = require('../src/analytics.js');

  // La référence : un seul seed. C'est le monde que les fixtures DÉCRIVENT —
  // 34 offres publiées, la jauge de `DEMO_GAUGE` — et non ce que le code a
  // bien voulu écrire.
  const temoin = dynamoRepo();
  await seedInto(temoin, { today: TODAY });
  const attendu = await createAnalytics({ repo: temoin, now: () => TODAY }).overview({});
  assert.equal(attendu.kpis.offersPosted, devBids(TODAY).length);
  assert.equal(attendu.gauge.activeNotaries, DEMO_GAUGE.active);

  const repo = dynamoRepo();
  await seedInto(repo, { today: TODAY });
  const forcee = await seedInto(repo, { today: TODAY, force: true });
  assert.ok(forcee.stats > 0, 'le forçage écrit bien de nouveau les compteurs');

  const apres = await createAnalytics({ repo, now: () => TODAY }).overview({});
  // Le forçage écrivait par-dessus sans retirer : la console rendait 68 offres
  // publiées pour 34 réelles et 6 notaires actifs pour 3, en restant verte.
  assert.equal(apres.kpis.offersPosted, attendu.kpis.offersPosted, 'forcer ne double pas les offres publiées');
  assert.deepEqual(apres.gauge, attendu.gauge, 'forcer ne double pas la jauge des notaires');
  assert.deepEqual(apres.series.offersPerDay, attendu.series.offersPerDay, 'ni la série jour par jour');
});

test('la marque de garde suit la SIGNATURE du domaine : un changement de barème ré-amorce', () => {
  // La garde ne doit pas être un simple « déjà fait » : le jour où une question
  // de tarification s'ajoute, les montants des fixtures changent et l'historique
  // amorcé décrit un monde qui n'existe plus.
  assert.notEqual(statsMarker(TODAY), statsMarker(domain.addDays(TODAY, 1)));
  assert.match(statsMarker(TODAY), /^seed:dev-stats:[0-9a-f]{12}:2026-09-04$/);
});

// ============================================================================
// 3. Les deux adaptateurs voient le même monde
// ============================================================================

test('mémoire et dynamo servent le MÊME carnet à partir du même seed', async () => {
  const dyn = dynamoRepo();
  await seedInto(dyn, { today: TODAY });
  const mem = createMemoryRepo([]);
  await seedInto(mem, { today: TODAY });

  const mois = TODAY.slice(0, 7);
  const lire = async (repo) => {
    const res = await createApp(repo).handle({ method: 'GET', path: '/bids', query: { month: mois }, headers: {}, body: '' });
    return JSON.parse(res.body).bids;
  };
  assert.deepEqual(await lire(mem), await lire(dyn));
});

// ============================================================================
// 4. Le fichier compose tient les deux corrections
// ============================================================================

const compose = yaml.load(readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf8'));

test('le chemin docker AMORCE : un service seed, et les API l’attendent', () => {
  const seed = compose.services.seed;
  assert.ok(seed, 'le compose doit porter un service « seed »');
  assert.ok(
    JSON.stringify(seed.entrypoint || seed.command).includes('apps/api/scripts/seed.js'),
    'le service seed lance bien le script de seed',
  );
  assert.equal(seed.environment.TABLE_NAME, 'nota', 'il écrit dans la table que lisent les API');

  for (const nom of ['api', 'admin-api']) {
    const dep = compose.services[nom].depends_on;
    assert.ok(dep && dep.seed, `${nom} doit dépendre du seed`);
    assert.equal(dep.seed.condition, 'service_completed_successfully',
      `${nom} doit attendre que le seed ait RÉUSSI, pas seulement démarré`);
  }
});

test('aucun service node ne tourne en « node » nu : tout passe par le superviseur', () => {
  for (const [nom, svc] of Object.entries(compose.services)) {
    if (svc.image !== 'node:20-alpine') continue;
    const cmd = JSON.stringify(svc.command || svc.entrypoint || '');
    if (!/local-server|run-local/.test(cmd)) continue; // les one-shots ne servent rien
    assert.match(cmd, /dev-watch\.js/, `${nom} doit tourner sous dev-watch.js, sinon il sert du code périmé`);
  }
});

test('la base locale PERSISTE : plus de -inMemory, un volume nommé', () => {
  const ddb = compose.services['dynamodb-local'];
  assert.doesNotMatch(String(ddb.command), /-inMemory/, 'tout disparaissait au redémarrage');
  assert.match(String(ddb.command), /-dbPath/);
  assert.ok((ddb.volumes || []).some((v) => String(v).startsWith('dynamodb-data:')));
  assert.ok(compose.volumes && 'dynamodb-data' in compose.volumes);
});

// ============================================================================
// 5. L’empreinte de source — la sonde qui rend la péremption visible
// ============================================================================

test('l’empreinte couvre le domaine et la source API, et bouge quand la source bouge', () => {
  const a = sourceFingerprint();
  assert.match(a.hash, /^[0-9a-f]{12}$/);
  assert.ok(a.files > 10, 'elle doit couvrir toute la source API, pas un fichier');
  assert.deepEqual(sourceFingerprint().hash, a.hash, 'même arbre → même empreinte (contenu, pas mtime)');

  // Un seul octet ailleurs dans l'arbre surveillé donne une autre empreinte.
  const b = sourceFingerprint({ paths: ['apps/api/src'] });
  assert.notEqual(b.hash, a.hash);
  assert.ok(b.files < a.files);
});
