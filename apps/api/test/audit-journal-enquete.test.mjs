// LE JOURNAL VU DEPUIS UNE ENQUÊTE (2026-09-05).
//
// Deux trous, tous deux dans la console d'administration, tous deux invisibles
// tant qu'on ne demande rien au journal.
//
//   A. L'ÉCHEC D'ÉCRITURE ADMIN ÉTAIT MUET. `apps/api/src/admin.js` avalait
//      l'erreur dans un `catch {}` vide. L'alarme CloudWatch bâtie pour
//      détecter un puits d'audit mort (infra/observability.tf) pose pourtant
//      son filtre sur LES DEUX groupes de journaux ; celui de la console ne
//      pouvait rien compter, et son commentaire le disait explicitement :
//      « CE QUE LE FILTRE ADMIN COMPTE AUJOURD'HUI : RIEN ». Une surveillance
//      incapable de se déclencher est pire qu'aucune : elle rassure.
//
//   B. LE JOURNAL NE SE LISAIT QU'UN JOUR À LA FOIS, sans filtre et sans
//      pagination au-delà d'une partition. Les deux questions qu'un enquêteur
//      pose — « tout ce que cette personne a fait » et « tout ce qui a été
//      fait à ce compte » — n'avaient aucune réponse : il aurait fallu ouvrir
//      365 écrans et lire à l'œil. Un registre qu'on ne peut pas interroger
//      est une archive, pas une piste d'audit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const { adminIdForEmail } = require('../src/admin-auth.js');

const ANALYSTE = 'analyste@nota.ca';
const TODAY = '2026-09-05';
const START = Date.parse('2026-09-05T18:00:00.000Z');
const JOUR = '2026-09-05';
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
    // L'analyste est sur la liste blanche — elle n'ouvre QUE la demande de
    // lien. Ce qu'il peut faire une fois entré vient de son compte stocké, et
    // c'est ce découplage que le 403 plus bas met à l'épreuve.
    config: { allowlist: ['ops@nota.ca', ANALYSTE], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => TODAY }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => TODAY,
    nowMs: () => clock.ms,
  });
  const call = (method, path, { body, bearer } = {}) => {
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

// Une VRAIE session d'analyste : le compte est posé sous l'identifiant que
// `adminIdForEmail` dérive — sans quoi `requireAdmin` ne le retrouve pas et la
// porte répond 401 (« qui es-tu ? ») au lieu du 403 (« pas toi ») qu'on teste.
async function sessionAnalyste(h) {
  await h.repo.putAdmin({
    id: adminIdForEmail(ANALYSTE), email: ANALYSTE, role: 'analyst',
    disabled: false, createdAt: new Date(START).toISOString(),
  });
  return login(h, ANALYSTE);
}

function captureErreurs(fn) {
  const lignes = [];
  const vrai = console.error;
  console.error = (...args) => lignes.push(args.join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => { console.error = vrai; });
}

// ---------------------------------------------------------------------------
// A. Un puits d'audit ADMIN cassé se voit
// ---------------------------------------------------------------------------

test('une écriture d’audit ADMIN qui échoue crie la MÊME ligne que la porte publique', async () => {
  // Le filtre CloudWatch cherche la sous-chaîne « audit_write_failed » dans les
  // deux groupes de journaux (infra/observability.tf). Une console qui échoue
  // en silence rend le filtre admin décoratif.
  const h = make();
  h.repo.appendAudit = async () => { throw new Error('ProvisionedThroughputExceeded'); };

  let session = null;
  const lignes = [];
  const vrai = console.error;
  console.error = (...args) => lignes.push(args.join(' '));
  try {
    session = await login(h);
  } finally {
    console.error = vrai;
  }

  assert.ok(session, 'l’audit ne bloque pas la connexion — voir l’argument dans admin.js');
  assert.ok(lignes.length >= 1, 'au moins une ligne exploitable par un filtre de métrique');
  const trace = JSON.parse(lignes[0]);
  assert.equal(trace.level, 'error');
  assert.equal(trace.event, 'audit_write_failed', 'le nom exact que le filtre CloudWatch cherche');
  assert.ok(trace.action, 'quelle trace a été perdue');
  assert.match(trace.message, /ProvisionedThroughputExceeded/);
  // La console est nominative : contrairement à la porte publique, elle PEUT
  // dire quel administrateur agissait — c'est la moitié utile de l'alerte.
  assert.ok('adminId' in trace, 'de qui la trace perdue parlait-elle');
});

// ---------------------------------------------------------------------------
// B. Le journal répond aux deux questions d'un enquêteur
// ---------------------------------------------------------------------------

const entree = (over) => ({
  id: over.id,
  ts: (over.jour || JOUR) + 'T' + (over.heure || '12:00:00') + '.000Z',
  day: over.jour || JOUR,
  action: over.action || 'acte_regle',
  adminId: over.adminId || null,
  email: over.email || null,
  ip: null,
  acteur: over.acteur || null,
  meta: over.meta || null,
});

async function semer(repo, entrees) {
  for (const e of entrees) await repo.appendAudit(e);
}

test('« tout ce que cette personne a fait » — le filtre par ACTEUR traverse les deux journaux', async () => {
  const h = make();
  const s = await login(h);
  await semer(h.repo, [
    entree({ id: 'e1', heure: '13:00:00', action: 'acte_retenu', acteur: { type: 'notaire', id: 'me-tremblay' }, meta: { bidId: 'b1' } }),
    entree({ id: 'e2', heure: '13:05:00', action: 'notaire_proposition', acteur: { type: 'notaire', id: 'me-tremblay' }, meta: { bidId: 'b2' } }),
    entree({ id: 'e3', heure: '13:10:00', action: 'notaire_proposition', acteur: { type: 'notaire', id: 'me-autre' }, meta: { bidId: 'b2' } }),
    entree({ id: 'e4', heure: '13:15:00', action: 'prix_nota_updated', adminId: 'ad1', email: 'ops@nota.ca', meta: {} }),
  ]);

  const r = parse(await h.call('GET', `/admin/audit?jour=${JOUR}&acteur=me-tremblay`, { bearer: s }));
  assert.deepEqual(r.entrees.map((e) => e.id).sort(), ['e1', 'e2']);

  // Un administrateur se nomme par son courriel dans le journal ADMIN : le même
  // paramètre doit l'atteindre, sinon l'enquêteur doit connaître la plomberie.
  // La connexion de l'enquêteur lui-même est journalisée et remonte ici : c'est
  // JUSTE — elle est bien un geste de `ops@nota.ca` — et c'est même la preuve
  // que le filtre traverse les deux journaux. Ce qui est vérifié, c'est la
  // RÈGLE : tout ce qui sort porte cet acteur, et le geste semé en fait partie.
  const parCourriel = parse(await h.call('GET', `/admin/audit?jour=${JOUR}&acteur=ops@nota.ca`, { bearer: s }));
  assert.ok(parCourriel.entrees.some((e) => e.id === 'e4'), 'le geste semé par cet administrateur');
  assert.ok(parCourriel.entrees.length > 1, 'ses connexions du jour en font partie');
  for (const e of parCourriel.entrees) assert.equal(e.email, 'ops@nota.ca', 'rien qui ne soit à lui');
  assert.ok(!parCourriel.entrees.some((e) => e.id === 'e1'), 'et rien qui soit au notaire');

  // Et le TYPE seul répond à « tout ce que les notaires ont fait ».
  const parType = parse(await h.call('GET', `/admin/audit?jour=${JOUR}&acteur=notaire`, { bearer: s }));
  assert.deepEqual(parType.entrees.map((e) => e.id).sort(), ['e1', 'e2', 'e3']);
});

test('« tout ce qui a été fait à ce compte » — le filtre par SUJET lit la meta, quelle que soit la clé', async () => {
  // Le sujet ne porte pas le même NOM selon l'action : `bidId` ici, `notaryId`
  // là, `cible` pour un changement d'accès, `code` pour un partenaire. Un
  // enquêteur ne connaît pas ces noms — il connaît l'identifiant.
  const h = make();
  const s = await login(h);
  await semer(h.repo, [
    entree({ id: 'e1', heure: '13:00:00', action: 'acte_retenu', acteur: { type: 'notaire', id: 'me-tremblay' }, meta: { bidId: 'b1', notaryId: 'me-tremblay' } }),
    entree({ id: 'e2', heure: '13:05:00', action: 'offre_annulee', acteur: { type: 'client', id: 'b1' }, meta: { bidId: 'b1', notaryId: null } }),
    entree({ id: 'e3', heure: '13:10:00', action: 'acte_retenu', acteur: { type: 'notaire', id: 'me-autre' }, meta: { bidId: 'b9' } }),
    entree({ id: 'e4', heure: '13:12:00', action: 'acces_modifie', adminId: 'ad1', email: 'ops@nota.ca', meta: { cible: 'b1', avant: null, apres: {} } }),
  ]);

  const r = parse(await h.call('GET', `/admin/audit?jour=${JOUR}&sujet=b1`, { bearer: s }));
  assert.deepEqual(r.entrees.map((e) => e.id).sort(), ['e1', 'e2', 'e4'], 'trois gestes portent sur b1, sous trois clés différentes');

  // Les deux filtres se composent : « ce que ce notaire a fait à ce dossier ».
  const croise = parse(await h.call('GET', `/admin/audit?jour=${JOUR}&acteur=me-tremblay&sujet=b1`, { bearer: s }));
  assert.deepEqual(croise.entrees.map((e) => e.id), ['e1']);
});

test('le filtre traverse LES JOURS : un enquêteur ne demande pas 365 écrans', async () => {
  const h = make();
  const s = await login(h);
  await semer(h.repo, [
    entree({ id: 'v1', jour: '2026-09-01', action: 'notaire_inscription', acteur: { type: 'notaire', id: 'me-tremblay' }, meta: {} }),
    entree({ id: 'v2', jour: '2026-09-03', action: 'notaire_profil_modifie', acteur: { type: 'notaire', id: 'me-tremblay' }, meta: {} }),
    entree({ id: 'v3', jour: '2026-09-05', action: 'acte_retenu', acteur: { type: 'notaire', id: 'me-tremblay' }, meta: {} }),
    entree({ id: 'x1', jour: '2026-09-02', action: 'acte_retenu', acteur: { type: 'notaire', id: 'me-autre' }, meta: {} }),
  ]);

  const r = parse(await h.call('GET', '/admin/audit?du=2026-09-01&au=2026-09-05&acteur=me-tremblay', { bearer: s }));
  assert.deepEqual(r.entrees.map((e) => e.id), ['v3', 'v2', 'v1'], 'la plus récente d’abord, sur toute la fenêtre');
  assert.equal(r.du, '2026-09-01');
  assert.equal(r.au, '2026-09-05');
});

test('la pagination franchit la frontière d’un jour, et le curseur ne rejoue rien', async () => {
  const h = make();
  const s = await login(h);
  const semis = [];
  for (let i = 0; i < 4; i += 1) semis.push(entree({ id: 'a' + i, jour: '2026-09-05', heure: '1' + i + ':00:00', meta: { bidId: 'b1' } }));
  for (let i = 0; i < 4; i += 1) semis.push(entree({ id: 'b' + i, jour: '2026-09-04', heure: '1' + i + ':00:00', meta: { bidId: 'b1' } }));
  await semer(h.repo, semis);

  const vus = [];
  let curseur = null;
  let tours = 0;
  do {
    // `sujet=b1` isole les huit entrées semées : les connexions de l'enquêteur
    // sont journalisées le même jour et n'ont rien à voir avec ce dossier.
    const url = '/admin/audit?du=2026-09-04&au=2026-09-05&sujet=b1&limite=3' + (curseur ? '&curseur=' + encodeURIComponent(curseur) : '');
    const page = parse(await h.call('GET', url, { bearer: s }));
    assert.ok(page.entrees.length <= 3, 'une page ne dépasse jamais la limite demandée');
    vus.push(...page.entrees.map((e) => e.id));
    curseur = page.curseur || null;
    tours += 1;
    assert.ok(tours < 10, 'la pagination doit se terminer');
  } while (curseur);

  assert.equal(vus.length, 8, 'les huit entrées, une seule fois chacune');
  assert.equal(new Set(vus).size, 8, 'aucun doublon d’une page à l’autre');
  assert.deepEqual(vus, ['a3', 'a2', 'a1', 'a0', 'b3', 'b2', 'b1', 'b0'], 'l’ordre reste le plus récent d’abord');
});

test('une requête ne lit pas 92 partitions d’un coup : elle rend la main avec un curseur', async () => {
  // Le BUDGET DE PARTITIONS, et pas seulement la limite d'entrées. Une question
  // très sélective sur un trimestre — « où est passé ce dossier ? » — ne trouve
  // rien pendant des semaines : sans ce budget, la Lambda lirait la fenêtre
  // entière avant de répondre, et expirerait avant de le dire.
  const h = make();
  const s = await login(h);
  await semer(h.repo, [entree({ id: 'loin', jour: '2026-06-20', action: 'acte_retenu', acteur: { type: 'notaire', id: 'me-tremblay' }, meta: { bidId: 'zz' } })]);

  const vus = [];
  let curseur = null;
  let tours = 0;
  do {
    const url = '/admin/audit?du=2026-06-15&au=2026-09-05&sujet=zz' + (curseur ? '&curseur=' + encodeURIComponent(curseur) : '');
    const page = parse(await h.call('GET', url, { bearer: s }));
    vus.push(...page.entrees.map((e) => e.id));
    curseur = page.curseur || null;
    tours += 1;
    assert.ok(tours < 20, 'la pagination doit se terminer');
  } while (curseur);

  assert.deepEqual(vus, ['loin'], 'l’entrée finit par sortir, quelque part dans la fenêtre');
  assert.ok(tours > 1, 'et elle n’est pas sortie d’une seule requête : le budget a rendu la main');
});

test('une ancre disparue ne fait pas sauter une journée en silence', async () => {
  // Le cas de bord qui compte dans un JOURNAL : le curseur pointe une entrée
  // que le TTL a reprise entre deux pages. Sauter la partition entière serait
  // une omission muette — exactement ce que cette piste existe pour empêcher.
  // Un doublon visible vaut mieux : on repart du haut du jour.
  const h = make();
  const s = await login(h);
  await semer(h.repo, [
    entree({ id: 'g1', heure: '13:00:00', meta: { bidId: 'b1' } }),
    entree({ id: 'g2', heure: '13:05:00', meta: { bidId: 'b1' } }),
  ]);
  const fantome = Buffer.from(JSON.stringify({ j: JOUR, a: JOUR + 'T23:59:59.000Z#disparue' }), 'utf8').toString('base64url');

  const page = parse(await h.call('GET', `/admin/audit?jour=${JOUR}&sujet=b1&curseur=${encodeURIComponent(fantome)}`, { bearer: s }));
  assert.deepEqual(page.entrees.map((e) => e.id), ['g2', 'g1'], 'la journée est relue, jamais escamotée');
});

test('une fenêtre déraisonnable est refusée : le journal ne devient pas une porte de balayage', async () => {
  const h = make();
  const s = await login(h);
  const res = await h.call('GET', '/admin/audit?du=2020-01-01&au=2026-09-05', { bearer: s });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(parse(res).errors[0].code, 'fenetre_trop_large');
});

test('un curseur trafiqué est refusé plutôt que d’ouvrir un jour arbitraire', async () => {
  const h = make();
  const s = await login(h);
  const res = await h.call('GET', `/admin/audit?jour=${JOUR}&curseur=n-importe-quoi`, { bearer: s });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(parse(res).errors[0].code, 'curseur_invalide');
});

test('les filtres n’ouvrent AUCUNE porte : sans « audit:read », c’est toujours 403', async () => {
  const h = make();
  // CE TEST NE PROUVAIT RIEN (revue du 2026-09-05). Il posait un compte sous un
  // identifiant inventé — jamais celui que `adminIdForEmail` dérive, donc un
  // compte introuvable —, n'ouvrait aucune session pour lui, et concluait sur
  // un 401 obtenu avec un jeton bidon. Un 401 dit « je ne sais pas qui tu
  // es » ; la question posée ici est « je sais qui tu es, et tu n'as pas le
  // droit » — c'est un 403, et il demande une VRAIE session.
  const analyste = await sessionAnalyste(h);
  // Sans filtre : la porte est déjà fermée.
  assert.equal((await h.call('GET', `/admin/audit?jour=${JOUR}`, { bearer: analyste })).statusCode, 403);
  // Et avec chacun des paramètres neufs : aucun n'est un contournement.
  for (const q of [
    `jour=${JOUR}&acteur=me-tremblay`,
    `jour=${JOUR}&sujet=b1`,
    'du=2026-09-01&au=2026-09-05',
    `jour=${JOUR}&limite=500`,
  ]) {
    const res = await h.call(`GET`, `/admin/audit?${q}`, { bearer: analyste });
    assert.equal(res.statusCode, 403, q + ' → ' + res.body);
  }
  // Et un inconnu reste un inconnu.
  assert.equal((await h.call('GET', `/admin/audit?jour=${JOUR}&acteur=me-tremblay`, { bearer: 'jeton-bidon' })).statusCode, 401);
});

test('le jour seul reste le comportement par défaut — la console d’hier ne change pas', async () => {
  const h = make();
  const s = await login(h);
  await semer(h.repo, [entree({ id: 'e1', meta: { bidId: 'b1' } })]);
  const r = parse(await h.call('GET', `/admin/audit?jour=${JOUR}`, { bearer: s }));
  assert.equal(r.jour, JOUR);
  assert.ok(r.entrees.some((e) => e.id === 'e1'));
  assert.equal(r.curseur == null, true, 'une petite journée ne rend aucun curseur');
});

// La capture d'erreurs sert aussi ce fichier : sans elle, un test qui échoue
// laisserait `console.error` détourné pour les suivants.
test('le harnais rend console.error intact', async () => {
  const vrai = console.error;
  await captureErreurs(() => {});
  assert.equal(console.error, vrai);
});
