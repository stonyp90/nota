// « VOIR EXACTEMENT QUI L'A REÇU » — MAIS APRÈS AVOIR REFERMÉ L'ÉCRAN.
//
// Le registre par (campagne, destinataire) est durable côté serveur, et la
// console le lisait — UNE FOIS, dans la seconde qui suivait l'envoi. Rechargez
// la page, ouvrez-la sur un autre appareil, revenez le lendemain : plus aucun
// chemin ne menait à une campagne passée. Il n'existait pas de route pour LES
// LISTER, et l'identifiant de campagne ne vivait que dans une variable de
// rendu. Un registre qu'on ne peut pas retrouver ne répond à aucune des
// questions qui l'ont fait écrire — ni « qui l'a reçue », ni une demande
// d'accès (Loi 25, art. 27).
//
// Ce que ces tests tiennent :
//   • la liste existe, et elle est SERVIE PAR LE JOURNAL d'audit — la seule
//     trace append-only qui porte déjà chaque envoi avec sa copie ;
//   • le JOUR est celui de QUÉBEC (`domain.businessDay`), jamais une tranche
//     UTC : une campagne partie à 21 h vit dans la partition du lendemain UTC
//     et doit rester du bon jour civil ;
//   • les permissions sont celles qui existent déjà : `analytics:read` pour
//     poser la question, `pii:read` pour lire les adresses en clair ;
//   • et la deuxième moitié du chemin — de la liste vers les destinataires —
//     aboutit vraiment.
//
// S'y ajoute le défaut jumeau : les BORNES de l'écran des audiences étaient
// recopiées dans la console (`AUD_ID_RE`, `AUD_LIBELLE_MAX`) et le plafond de
// membres n'était servi nulle part — relever le plafond d'un déploiement
// laissait l'interface l'ignorer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const domain = require('@nota/domain');

// 21 h à Québec le 3 septembre = 4 septembre 01:00 UTC. Le journal partitionne
// par jour UTC ; le jour ouvrable, lui, est le 3.
const TARD = Date.parse('2026-09-04T01:00:00.000Z');
const JOUR_QUEBEC = domain.businessDay(TARD, process.env.NOTA_TIMEZONE || undefined);
const parse = (res) => JSON.parse(res.body);

function faussierNotifier() {
  const envoyes = [];
  return {
    envoyes,
    async sendCampaign({ to }) {
      if (String(to).startsWith('bloque')) return { sent: false, reason: 'unsubscribed' };
      envoyes.push(to);
      return { sent: true, to };
    },
  };
}

function make({ permissions, ...config } = {}) {
  const repo = createMemoryRepo();
  const clock = { ms: TARD };
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    notifier: faussierNotifier(),
    newId: () => `id-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: { allowlist: ['ops@nota.ca', 'analyste@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true, ...config },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => JOUR_QUEBEC }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => JOUR_QUEBEC,
    nowMs: () => clock.ms,
  });
  const call = (method, path, { body, bearer, query } = {}) =>
    app.handle({
      method,
      path,
      query: query || {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, admin, app, clock, call };
}

async function login(h, email = 'ops@nota.ca') {
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  return parse(await h.call('POST', '/admin/auth/verify', { body: { token } })).session;
}

// Un compte à permissions FINES, et à rôle SANS paquet : le super_admin porte
// le joker et le rôle « analyst » traîne `analytics:read` — ni l'un ni l'autre
// ne permet d'éprouver qu'une porte est vraiment gardée. Ici, les permissions
// sont EXACTEMENT celles qu'on accorde.
async function loginAnalyste(h, permissions) {
  const session = await login(h, 'analyste@nota.ca');
  const id = require('../src/admin-auth.js').adminIdForEmail('analyste@nota.ca');
  const rec = await h.repo.getAdmin(id);
  await h.repo.putAdmin({ ...rec, role: 'sans_paquet', permissions, groupes: [] });
  return session;
}

// Une campagne réelle : deux adresses au groupe, une qui refuse.
async function envoyer(h, session, id = 'pilote') {
  await h.call('PUT', `/admin/audiences/groups/${id}`, {
    bearer: session,
    body: {
      libelle: 'Groupe ' + id, audience: 'client', nature: 'transactionnel',
      membres: ['recu@exemple.ca', 'bloque@exemple.ca'],
    },
  });
  return parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: {
      audience: { type: 'group', groupId: id },
      message: {
        sujetFr: 'Un mot de Nota', sujetEn: 'A word from Nota',
        corpsFr: 'Bonjour, voici les nouvelles.', corpsEn: 'Hello, here is the news.',
      },
    },
  }));
}

// ---------------------------------------------------------------------------
// 1. LA LISTE EXISTE, ET ELLE SURVIT À LA FERMETURE DE L'ÉCRAN
// ---------------------------------------------------------------------------

test('GET /admin/campaigns rend les campagnes passées — le registre redevient joignable', async () => {
  const h = make();
  const session = await login(h);
  const envoi = await envoyer(h, session);
  assert.equal(envoi.ok, true, JSON.stringify(envoi));

  const liste = parse(await h.call('GET', '/admin/campaigns', { bearer: session }));
  assert.equal(liste.ok, true, JSON.stringify(liste));
  assert.equal(liste.jour, JOUR_QUEBEC, 'le jour par défaut est le jour OUVRABLE de Québec');
  assert.equal(liste.campagnes.length, 1, JSON.stringify(liste.campagnes));
  const c = liste.campagnes[0];
  assert.equal(c.campagneId, envoi.campagneId, 'l’identifiant est celui qui ouvre le registre');
  assert.equal(c.statut, 'envoyee');
  assert.equal(c.envoyes, 1);
  assert.equal(c.echoues, 1, 'un envoi partiel se dit comme tel dans la liste aussi');
  assert.deepEqual(c.audience, [{ type: 'group', groupId: 'pilote' }]);
  assert.equal(c.nature, 'transactionnel');
  assert.ok(c.at, 'une campagne sans instant ne se replace pas dans une histoire');
  assert.equal(c.message.sujetFr, 'Un mot de Nota', 'qui a reçu QUOI — la copie voyage avec la trace');
});

test('la liste mène aux destinataires : les deux moitiés du chemin se rejoignent', async () => {
  const h = make();
  const session = await login(h);
  await envoyer(h, session);

  const liste = parse(await h.call('GET', '/admin/campaigns', { bearer: session }));
  const id = liste.campagnes[0].campagneId;
  const recus = parse(await h.call('GET', `/admin/campaigns/${encodeURIComponent(id)}/recipients`, { bearer: session }));
  assert.equal(recus.ok, true, JSON.stringify(recus));
  assert.deepEqual(
    recus.destinataires.map((d) => [d.courriel, d.statut]).sort(),
    [['bloque@exemple.ca', 'echoue'], ['recu@exemple.ca', 'envoye']],
  );
});

test('un jour explicite ramène ce jour-là, et un jour vide ne ment pas', async () => {
  const h = make();
  const session = await login(h);
  await envoyer(h, session);

  const veille = parse(await h.call('GET', '/admin/campaigns', { bearer: session, query: { jour: '2026-09-02' } }));
  assert.equal(veille.jour, '2026-09-02');
  assert.deepEqual(veille.campagnes, [], 'aucune campagne ce jour-là, et l’écran le dit');

  const bon = parse(await h.call('GET', '/admin/campaigns', { bearer: session, query: { jour: JOUR_QUEBEC } }));
  assert.equal(bon.campagnes.length, 1);
});

test('le jour est celui de QUÉBEC, pas une tranche UTC', async () => {
  const h = make();
  const session = await login(h);
  const envoi = await envoyer(h, session);
  // L'instant est le 4 septembre en UTC ; le jour ouvrable, le 3.
  assert.equal(new Date(TARD).toISOString().slice(0, 10), '2026-09-04');
  assert.equal(JOUR_QUEBEC, '2026-09-03');

  const utc = parse(await h.call('GET', '/admin/campaigns', { bearer: session, query: { jour: '2026-09-04' } }));
  assert.deepEqual(utc.campagnes, [], 'la partition UTC n’est pas le jour civil de l’opérateur');
  const quebec = parse(await h.call('GET', '/admin/campaigns', { bearer: session, query: { jour: '2026-09-03' } }));
  assert.deepEqual(quebec.campagnes.map((c) => c.campagneId), [envoi.campagneId]);
});

test('un jour mal formé est refusé — 422, pas une liste vide qui rassure', async () => {
  const h = make();
  const session = await login(h);
  const res = await h.call('GET', '/admin/campaigns', { bearer: session, query: { jour: 'hier' } });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(parse(res).errors[0].code, 'jour_invalide');
});

// ---------------------------------------------------------------------------
// 2. LES PERMISSIONS SONT CELLES QUI EXISTENT DÉJÀ
// ---------------------------------------------------------------------------

test('sans « analytics:read », la liste est refusée — pas vidée', async () => {
  const h = make();
  const ops = await login(h);
  await envoyer(h, ops);
  const aveugle = await loginAnalyste(h, ['audiences:read']);
  const res = await h.call('GET', '/admin/campaigns', { bearer: aveugle });
  assert.equal(res.statusCode, 403, res.body);
});

test('sans « pii:read », les adresses des échecs sont MASQUÉES — reconnaissables, jamais expédiables', async () => {
  const h = make();
  const ops = await login(h);
  const envoi = await envoyer(h, ops);

  const enClair = parse(await h.call('GET', '/admin/campaigns', { bearer: ops }));
  assert.equal(enClair.campagnes[0].echecs[0].courriel, 'bloque@exemple.ca');

  const analyste = await loginAnalyste(h, ['analytics:read']);
  const masque = parse(await h.call('GET', '/admin/campaigns', { bearer: analyste }));
  assert.equal(masque.campagnes[0].campagneId, envoi.campagneId);
  assert.equal(masque.campagnes[0].echecs[0].courriel, 'b•••@exemple.ca',
    'le même masque que l’échantillon de l’aperçu et le registre des destinataires');
});

// ---------------------------------------------------------------------------
// 3. LES BORNES DE L'ÉCRAN VIENNENT DU SERVEUR
// ---------------------------------------------------------------------------

test('les groupes d’audience voyagent avec LEURS bornes — la console n’en recopie aucune', async () => {
  const h = make();
  const session = await login(h);
  const res = parse(await h.call('GET', '/admin/audiences/groups', { bearer: session }));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.limites, 'les bornes voyagent avec le catalogue, comme celles du compositeur');
  assert.equal(res.limites.libelleMax, 80);
  assert.equal(res.limites.membresMax, 500);
  assert.equal(typeof res.limites.identifiantMotif, 'string');
  // Le motif est CELUI que le serveur applique : la console le compile tel quel.
  const re = new RegExp(res.limites.identifiantMotif);
  assert.equal(re.test('pilote-2'), true);
  assert.equal(re.test('Pilote'), false, 'majuscule refusée par le serveur ET par l’écran');
  assert.equal(re.test('a'.repeat(41)), false);
});

test('relever le plafond du déploiement se voit dans les bornes servies', async () => {
  const h = make({ audienceMembresMax: 12 });
  const session = await login(h);
  const res = parse(await h.call('GET', '/admin/audiences/groups', { bearer: session }));
  assert.equal(res.limites.membresMax, 12, 'le plafond servi est celui du déploiement, jamais un nombre en dur');

  // Et il est bien celui que l'écriture applique.
  const trop = await h.call('PUT', '/admin/audiences/groups/large', {
    bearer: session,
    body: {
      libelle: 'Trop de monde', audience: 'client', nature: 'commercial',
      membres: Array.from({ length: 13 }, (_, i) => `p${i}@exemple.ca`),
    },
  });
  assert.equal(trop.statusCode, 422, trop.body);
  assert.equal(parse(trop).errors[0].code, 'membres_trop_nombreux');
});
