// LES GROUPES D'AUDIENCE, LE REGISTRE DES DESTINATAIRES, LE CONSENTEMENT ÉCRIT,
// LE COMPOSITEUR, ET L'ÉCHEC QUI SE VOIT.
//
// Cinq coutures que l'audit du 2026-09-04 a trouvées ouvertes, et dont chacune
// se tenait derrière une suite VERTE :
//
//   1. LA COUTURE DU GROUPE. La console peuplait sa liste déroulante depuis
//      `GET /admin/groups`, qui rend les groupes RBAC — des paquets de
//      PERMISSIONS. Viser « le groupe pilote » ne pouvait donc atteindre
//      personne. `putAudienceGroup` / `listAudienceGroups` existaient dans les
//      DEUX adaptateurs, testés, sans un seul appelant. Le test d'API semait
//      directement dans le dépôt, le test DOM bouchonnait `/groups` à la forme
//      RBAC : les deux se parlaient à eux-mêmes. Ici, on éprouve les DEUX
//      partitions dans la même assertion — un groupe d'audience n'est pas un
//      groupe de permissions, et la route qui sert l'un ne sert jamais l'autre.
//
//   2. LE REGISTRE DES DESTINATAIRES. `markCampaignSent` écrit UNE ligne par
//      ADRESSE (SK = EMAIL#<adresse>), écrasée par chaque campagne suivante :
//      « qui a reçu la campagne X » était sans réponse. La ligne par
//      (campagne, destinataire) existait — `appendCampaignRecipient` — sans
//      appelant. On l'éprouve en envoyant DEUX campagnes : la première doit
//      survivre à la seconde.
//
//   3. LE TRANSACTIONNEL N'ÉCRIVAIT RIEN. L'écriture était conditionnée à
//      `nature === COMMERCIAL`, donc une campagne transactionnelle ne laissait
//      aucune trace. La distinction LCAP reste là où elle est de droit — le
//      consentement et le plafond de fréquence — jamais comme motif de ne rien
//      journaliser.
//
//   4. LE CONSENTEMENT ÉTAIT LU, JAMAIS ÉCRIT. `getEmailConsent` était appelé,
//      `putEmailConsent` / `appendConsentEvent` ne l'étaient nulle part : le
//      registre restait vide et la garde décorative. On l'éprouve sur les
//      chemins où une personne donne ou retire vraiment son consentement.
//
//   5. UN EXPÉDITEUR ABSENT PASSAIT POUR UN SUCCÈS. Le mailer de la console
//      rendait `undefined` sans lever, et l'envoi lisait « pas d'exception »
//      comme « parti ». Une production mal configurée annonçait donc « campagne
//      envoyée » sans avoir rien envoyé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createNotifier } = require('../src/notifications.js');
const rbac = require('../src/rbac.js');
const emails = require('../src/emails.js');
const segments = require('../src/segments.js');

const TODAY = '2026-09-02';
const START = Date.parse('2026-09-02T14:00:00.000Z');
const NOW_ISO = new Date(START).toISOString();
const parse = (res) => JSON.parse(res.body);
const ilYA = (jours) => new Date(START - jours * 86400000).toISOString();

function notaire(id, over = {}) {
  return {
    id,
    email: id + '@etude.test',
    label: 'Étude ' + id,
    status: 'active',
    chargesEnabled: true,
    connectAccountId: 'acct_' + id,
    lienCNQ: 'https://www.cnq.org/notaire/' + id,
    lastSeenAt: ilYA(0),
    createdAt: ilYA(400),
    actsCompleted: 3,
    proposalsCount: 5,
    ...over,
  };
}

// Le port d'envoi. `notifications.js` en est la seule implémentation ; ici on
// n'éprouve pas SON comportement mais celui de la couche qui l'appelle.
function faussierNotifier({ echoue = () => null } = {}) {
  const envoyes = [];
  return {
    envoyes,
    async sendCampaign({ to, templateKey, ctx, message }) {
      const raison = echoue(to);
      if (raison === 'leve') throw new Error('SES down');
      if (raison) return { sent: false, reason: raison };
      envoyes.push({ to, templateKey, ctx, message });
      return { sent: true, to };
    },
  };
}

function make({ notifier = faussierNotifier(), permissions, ...config } = {}) {
  const repo = createMemoryRepo();
  const clock = { ms: START };
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    notifier,
    newId: () => `id-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: {
      allowlist: ['ops@nota.ca', 'analyste@nota.ca'],
      baseUrl: 'https://admin.nota.ca',
      devEcho: true,
      ...config,
    },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => TODAY }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => TODAY,
    nowMs: () => clock.ms,
  });
  const call = (method, path, { body, bearer, query } = {}) =>
    app.handle({
      method,
      path,
      query: query || {},
      headers: bearer
        ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' }
        : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, admin, app, clock, call, notifier };
}

async function login(h, email = 'ops@nota.ca') {
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  return parse(await h.call('POST', '/admin/auth/verify', { body: { token } })).session;
}

// Un compte à permissions FINES : la seule façon d'éprouver qu'une porte est
// bien gardée (le super_admin porte le joker et passe partout).
async function loginAnalyste(h, permissions) {
  const session = await login(h, 'analyste@nota.ca');
  const id = require('../src/admin-auth.js').adminIdForEmail('analyste@nota.ca');
  const rec = await h.repo.getAdmin(id);
  await h.repo.putAdmin({ ...rec, role: 'analyst', permissions });
  return session;
}

const GROUPE = { libelle: 'Pilote', audience: 'notaire', nature: 'commercial', membres: ['a@etude.test', 'b@etude.test'] };

// ---------------------------------------------------------------------------
// 1. LA COUTURE DU GROUPE
// ---------------------------------------------------------------------------

test('deux routes, deux notions : /admin/groups rend des PERMISSIONS, /admin/audiences/groups rend des DESTINATAIRES', async () => {
  const h = make();
  const session = await login(h);

  await h.call('PUT', '/admin/groups/support', {
    bearer: session,
    body: { nom: 'Support', description: 'Le guichet', permissions: ['analytics:read'] },
  });
  await h.call('PUT', '/admin/audiences/groups/support', { bearer: session, body: GROUPE });

  const rbacRes = parse(await h.call('GET', '/admin/groups', { bearer: session }));
  const audRes = parse(await h.call('GET', '/admin/audiences/groups', { bearer: session }));

  // Même identifiant, deux items qui n'ont rien à voir : c'est exactement la
  // confusion qui rendait « envoyer à un groupe » impossible.
  const rbacGroupe = rbacRes.groupes.find((g) => g.id === 'support');
  const audGroupe = audRes.groupes.find((g) => g.id === 'support');
  assert.ok(rbacGroupe && audGroupe);
  assert.deepEqual(rbacGroupe.permissions, ['analytics:read']);
  assert.equal(rbacGroupe.membres, undefined, 'un groupe RBAC ne porte pas de destinataires');
  assert.deepEqual(audGroupe.membres, ['a@etude.test', 'b@etude.test']);
  assert.equal(audGroupe.permissions, undefined, 'un groupe d’audience ne porte pas de permissions');
  assert.equal(audGroupe.libelle, 'Pilote');
});

test('le groupe d’audience est la cible que la campagne atteint vraiment', async () => {
  const h = make();
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));
  await h.repo.putNotary(notaire('b'));
  await h.call('PUT', '/admin/audiences/groups/pilote', {
    bearer: session,
    body: { ...GROUPE, membres: ['a@etude.test', 'b@etude.test'] },
  });

  const res = parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'group', groupId: 'pilote' }, templateKey: 'notaryDisconnectedWinback' },
  }));
  assert.equal(res.envoyes, 2, JSON.stringify(res));
  assert.deepEqual(h.notifier.envoyes.map((e) => e.to).sort(), ['a@etude.test', 'b@etude.test']);
});

test('écrire un groupe d’audience demande « audiences:write » ; le lire demande « audiences:read »', async () => {
  assert.ok(rbac.PERMISSIONS.includes('audiences:read'), 'la clé doit être au catalogue pour être accordable');
  assert.ok(rbac.PERMISSIONS.includes('audiences:write'));

  const h = make();
  const lecteur = await loginAnalyste(h, ['audiences:read']);
  assert.equal((await h.call('GET', '/admin/audiences/groups', { bearer: lecteur })).statusCode, 200);
  assert.equal(
    (await h.call('PUT', '/admin/audiences/groups/x', { bearer: lecteur, body: GROUPE })).statusCode, 403);
  assert.equal((await h.call('DELETE', '/admin/audiences/groups/x', { bearer: lecteur })).statusCode, 403);

  const aveugle = make();
  const rien = await loginAnalyste(aveugle, ['analytics:read']);
  assert.equal((await aveugle.call('GET', '/admin/audiences/groups', { bearer: rien })).statusCode, 403);
});

test('un groupe d’audience se valide : identifiant, libellé, audience, nature, adresses', async () => {
  const h = make();
  const session = await login(h);
  const put = (id, body) => h.call('PUT', `/admin/audiences/groups/${id}`, { bearer: session, body });

  assert.equal((await put('MAJUSCULE', GROUPE)).statusCode, 422);
  assert.equal((await put('ok', { ...GROUPE, libelle: '' })).statusCode, 422);
  assert.equal((await put('ok', { ...GROUPE, audience: 'martien' })).statusCode, 422);
  assert.equal((await put('ok', { ...GROUPE, nature: 'promo' })).statusCode, 422);
  assert.equal((await put('ok', { ...GROUPE, membres: ['pas-une-adresse'] })).statusCode, 422);
  assert.equal((await put('ok', { ...GROUPE, membres: [] })).statusCode, 422,
    'un groupe sans destinataire n’est pas une audience');

  // Normalisation et déduplication : une majuscule ne fait pas deux personnes.
  const ok = parse(await put('pilote', { ...GROUPE, membres: ['A@Etude.Test', 'a@etude.test', 'b@etude.test'] }));
  assert.deepEqual(ok.groupe.membres, ['a@etude.test', 'b@etude.test']);
});

test('supprimer un groupe d’audience inconnu est un 404, jamais un succès silencieux', async () => {
  const h = make();
  const session = await login(h);
  assert.equal((await h.call('DELETE', '/admin/audiences/groups/fantome', { bearer: session })).statusCode, 404);
  await h.call('PUT', '/admin/audiences/groups/pilote', { bearer: session, body: GROUPE });
  assert.equal((await h.call('DELETE', '/admin/audiences/groups/pilote', { bearer: session })).statusCode, 200);
  assert.equal(await h.repo.getAudienceGroup('pilote'), null);
});

test('chaque écriture d’un groupe d’audience est journalisée avec son avant/après', async () => {
  const h = make();
  const session = await login(h);
  await h.call('PUT', '/admin/audiences/groups/pilote', { bearer: session, body: GROUPE });
  await h.call('DELETE', '/admin/audiences/groups/pilote', { bearer: session });
  const journal = await h.repo.queryAuditByDay(NOW_ISO.slice(0, 10));
  const actions = journal.map((e) => e.action);
  assert.ok(actions.includes('audience_groupe_modifie'), JSON.stringify(actions));
  assert.ok(actions.includes('audience_groupe_supprime'));
  const suppr = journal.find((e) => e.action === 'audience_groupe_supprime');
  assert.equal(suppr.meta.avant.libelle, 'Pilote');
});

// ---------------------------------------------------------------------------
// 2 + 3. LE REGISTRE DES DESTINATAIRES
// ---------------------------------------------------------------------------

test('une campagne écrit UNE ligne par (campagne, destinataire) — la suivante n’efface pas la précédente', async () => {
  const h = make();
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));
  await h.repo.putNotary(notaire('b'));
  await h.call('PUT', '/admin/audiences/groups/pilote', { bearer: session, body: GROUPE });

  const un = parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'group', groupId: 'pilote' }, templateKey: 'notaryDisconnectedWinback' },
  }));
  // La seconde campagne est TRANSACTIONNELLE : le plafond de fréquence ne la
  // bloque pas, et l'écriture du registre ne doit pas dépendre de la nature.
  const deux = parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: {
      audience: { type: 'user', email: 'a@etude.test', nature: 'transactionnel' },
      templateKey: 'notaryPendingReview',
    },
  }));
  assert.notEqual(un.campagneId, deux.campagneId);

  const l1 = await h.repo.listCampaignRecipients(un.campagneId);
  const l2 = await h.repo.listCampaignRecipients(deux.campagneId);
  assert.deepEqual(l1.destinataires.map((d) => d.courriel).sort(), ['a@etude.test', 'b@etude.test'],
    'la première campagne garde ses deux destinataires après la seconde');
  assert.deepEqual(l2.destinataires.map((d) => d.courriel), ['a@etude.test']);
  assert.equal(l2.destinataires[0].nature, 'transactionnel',
    'une campagne transactionnelle laisse une trace, elle aussi');
  assert.equal(l1.destinataires[0].statut, 'envoye');
});

test('un destinataire qui échoue est INSCRIT comme échoué — le registre dit ce qui s’est passé, pas ce qu’on espérait', async () => {
  const h = make({ notifier: faussierNotifier({ echoue: (to) => (to === 'b@etude.test' ? 'send-failed' : null) }) });
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));
  await h.repo.putNotary(notaire('b'));
  await h.call('PUT', '/admin/audiences/groups/pilote', { bearer: session, body: GROUPE });

  const res = parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'group', groupId: 'pilote' }, templateKey: 'notaryDisconnectedWinback' },
  }));
  assert.equal(res.envoyes, 1);
  assert.equal(res.echecs.length, 1);
  assert.equal(res.echecs[0].courriel, 'b@etude.test');

  const lignes = (await h.repo.listCampaignRecipients(res.campagneId)).destinataires;
  const b = lignes.find((d) => d.courriel === 'b@etude.test');
  assert.equal(b.statut, 'echoue');
  assert.equal(b.erreur, 'send-failed');
});

test('le plafond de fréquence ne se consomme que sur le COMMERCIAL — le registre, lui, s’écrit toujours', async () => {
  const h = make();
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));

  const tx = parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'user', email: 'a@etude.test', nature: 'transactionnel' }, templateKey: 'notaryPendingReview' },
  }));
  assert.equal(tx.envoyes, 1);
  assert.equal(await h.repo.lastCampaignAt('a@etude.test'), null,
    'un avis de service ne doit pas consommer le quota de son destinataire');
  assert.equal((await h.repo.listCampaignRecipients(tx.campagneId)).destinataires.length, 1);

  const co = parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'user', email: 'a@etude.test' }, templateKey: 'notaryDisconnectedWinback' },
  }));
  assert.equal(co.envoyes, 1);
  assert.equal(await h.repo.lastCampaignAt('a@etude.test'), NOW_ISO);
});

test('un quota qui ne s’inscrit pas n’est PAS un échec d’envoi — le courriel est parti', async () => {
  const h = make();
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));
  // Le registre du plafond tombe ; celui des destinataires, lui, répond.
  h.repo.markCampaignSent = async () => { throw new Error('Throughput exceeded'); };

  const res = parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'user', email: 'a@etude.test' }, templateKey: 'notaryDisconnectedWinback' },
  }));
  assert.equal(res.envoyes, 1);
  assert.equal(res.echoues, 0, 'compter ce destinataire deux fois masquerait la vraie lacune');
  assert.deepEqual(res.echecs, []);
  assert.equal(res.registre.frequenceEchecs, 1, 'la lacune du QUOTA se dit à part');
  // Et la ligne du registre des destinataires porte bien « envoyé ».
  const lignes = (await h.repo.listCampaignRecipients(res.campagneId)).destinataires;
  assert.equal(lignes[0].statut, 'envoye');
});

test('GET /admin/campaigns/{id}/recipients rend qui a reçu — et masque les adresses sans « pii:read »', async () => {
  const h = make();
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));
  const envoi = parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'user', email: 'a@etude.test' }, templateKey: 'notaryDisconnectedWinback' },
  }));

  const vu = parse(await h.call('GET', `/admin/campaigns/${envoi.campagneId}/recipients`, { bearer: session }));
  assert.equal(vu.campagneId, envoi.campagneId);
  assert.deepEqual(vu.destinataires.map((d) => d.courriel), ['a@etude.test']);

  const analyste = await loginAnalyste(h, ['analytics:read']);
  const masque = parse(await h.call('GET', `/admin/campaigns/${envoi.campagneId}/recipients`, { bearer: analyste }));
  assert.equal(masque.destinataires[0].courriel, 'a•••@etude.test',
    'reconnaissable, jamais expédiable');
});

// ---------------------------------------------------------------------------
// 4. LE CONSENTEMENT, ÉCRIT LÀ OÙ IL EST DONNÉ ET LÀ OÙ IL EST RETIRÉ
// ---------------------------------------------------------------------------

function notifieur({ repo = createMemoryRepo([]) } = {}) {
  const envoyes = [];
  const notifier = createNotifier({
    repo,
    mailer: { send: async (m) => { envoyes.push(m); } },
    now: () => NOW_ISO,
    baseUrl: 'https://nota.test',
    apiBaseUrl: 'https://api.nota.test',
    operatorEmail: 'ops@nota.ca',
  });
  return { repo, notifier, envoyes };
}

test('l’inscription d’un client écrit un consentement — finalité, source, instant, version du texte', async () => {
  const { repo, notifier } = notifieur();
  await notifier.onClientSignup('Client@Exemple.CA');

  const journal = await repo.listConsentEvents('client@exemple.ca');
  assert.equal(journal.length, 1, JSON.stringify(journal));
  const e = journal[0];
  assert.equal(e.type, 'octroi');
  assert.equal(e.audience, 'client');
  assert.equal(e.base, 'tacite');
  assert.equal(e.source, 'inscription_client');
  assert.equal(e.at, NOW_ISO);
  assert.ok(e.version, 'la version du libellé consenti voyage — sans elle, la preuve ne dit pas à QUOI on a consenti');

  // Et la projection que `segments.js` lit est à jour du même coup.
  const etat = await repo.getEmailConsent('client@exemple.ca');
  assert.equal(etat.base, 'tacite');
  assert.equal(etat.source, 'inscription_client');
});

test('publier une offre et s’inscrire comme notaire écrivent eux aussi au registre', async () => {
  const { repo, notifier } = notifieur();
  await notifier.onOfferCreated({
    id: 'b1', courriel: 'acheteur@exemple.ca', montant: 1800, serviceId: 'financement',
    dateISO: '2026-10-01', status: 'OUVERTE',
  });
  await notifier.onNotarySignedUp({ email: 'roy@etude.test', lienCNQ: 'https://cnq.org/roy' });

  const client = await repo.listConsentEvents('acheteur@exemple.ca');
  assert.equal(client.length, 1);
  assert.equal(client[0].source, 'offre_publiee');
  assert.equal(client[0].audience, 'client');

  const notaire = await repo.listConsentEvents('roy@etude.test');
  assert.equal(notaire.length, 1);
  assert.equal(notaire[0].source, 'inscription_notaire');
  assert.equal(notaire[0].audience, 'notaire');
});

// CE QUE CE TEST PROUVE, ET OÙ EST LE RESTE. Il éprouve la PORTE
// (`notifier.unsubscribe`), qui n'est plus qu'un alias de
// `createConsentRegistry().enregistrerRetrait`. La ROUTE publique
// (`GET|POST /unsubscribe`) appelle ce même registre directement — sans passer
// par un notifieur, qui exige un mailer que la production n'a pas encore — et
// c'est `apps/api/test/consentement-registre.test.mjs` qui le tient.
test('le retrait s’inscrit au registre comme un RETRAIT — la preuve du retrait est aussi une preuve', async () => {
  const { repo, notifier } = notifieur();
  await notifier.onClientSignup('client@exemple.ca');
  await notifier.unsubscribe('Client@Exemple.CA');

  // Le journal se trie par `<at>#<id>` : avec une horloge figée, l'ordre des
  // deux événements est celui des identifiants, pas celui des gestes. On
  // cherche le fait, pas sa place.
  const journal = await repo.listConsentEvents('client@exemple.ca');
  assert.equal(journal.length, 2);
  const retrait = journal.find((e) => e.type === 'retrait');
  assert.ok(retrait, JSON.stringify(journal));
  assert.equal(retrait.base, null, 'un retrait ne porte aucune base : il en éteint une');
  assert.equal(retrait.source, 'desabonnement');
  assert.ok(journal.some((e) => e.type === 'octroi'), 'l’octroi reste au journal — un retrait ne l’efface pas');
  // La suppression, elle, reste ce que `sendOnce` et `sendCampaign` lisent.
  assert.equal(await repo.isUnsubscribed('client@exemple.ca'), true);
});

test('un registre en panne ne fait pas tomber un courriel — le consentement est au mieux, jamais au prix du message', async () => {
  const repo = createMemoryRepo([]);
  repo.appendConsentEvent = async () => { throw new Error('DynamoDB down'); };
  const { notifier, envoyes } = notifieur({ repo });
  const r = await notifier.onClientSignup('client@exemple.ca');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(envoyes.length, 1);
});

test('une campagne commerciale sur une adresse au registre s’appuie sur le REGISTRE, pas sur une déduction', async () => {
  const h = make();
  const session = await login(h);
  // Personne d'inconnue au dépôt : sans registre, aucune base ne serait déduite.
  await h.repo.appendConsentEvent({
    courriel: 'inconnu@exemple.ca', audience: 'client', type: 'octroi',
    base: 'expres', source: 'inscription_client', at: NOW_ISO, id: 'e1',
  });
  const res = parse(await h.call('POST', '/admin/campaigns/preview', {
    bearer: session,
    body: { audience: { type: 'user', email: 'inconnu@exemple.ca' }, templateKey: 'clientWelcome' },
  }));
  assert.equal(res.total, 1, JSON.stringify(res));
  assert.equal(res.exclus.sansConsentement, 0);
  assert.equal(res.garde.consentement, 'registre',
    'la garde doit DIRE sur quoi elle s’est appuyée');
});

// ---------------------------------------------------------------------------
// 5. L'ÉCHEC QUI SE VOIT
// ---------------------------------------------------------------------------

test('zéro destinataire joint n’est PAS un succès : la route refuse plutôt que d’annoncer un envoi qui n’a pas eu lieu', async () => {
  const h = make({ notifier: faussierNotifier({ echoue: () => 'send-failed' }) });
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));

  const res = await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'user', email: 'a@etude.test' }, templateKey: 'notaryDisconnectedWinback' },
  });
  assert.equal(res.statusCode, 502, res.body);
  const body = parse(res);
  assert.equal(body.errors[0].code, 'envoi_echoue');
  assert.equal(body.echecs.length, 1);
  assert.equal(body.echecs[0].raison, 'send-failed');
});

test('un notifieur qui LÈVE est rapporté destinataire par destinataire, jamais avalé', async () => {
  const h = make({ notifier: faussierNotifier({ echoue: (to) => (to === 'b@etude.test' ? 'leve' : null) }) });
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));
  await h.repo.putNotary(notaire('b'));
  await h.call('PUT', '/admin/audiences/groups/pilote', { bearer: session, body: GROUPE });

  const res = parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'group', groupId: 'pilote' }, templateKey: 'notaryDisconnectedWinback' },
  }));
  assert.equal(res.envoyes, 1);
  assert.match(res.echecs[0].raison, /SES down/);
});

test('le mailer de la console LÈVE quand l’expéditeur n’est pas configuré — le silence était le pire des verdicts', async () => {
  const avant = process.env.NOTA_FROM_EMAIL;
  delete process.env.NOTA_FROM_EMAIL;
  try {
    delete require.cache[require.resolve('../admin.js')];
    // Le module d'entrée construit le dépôt DynamoDB au chargement : on ne le
    // charge pas, on éprouve la promesse qu'il porte, écrite noir sur blanc.
    const src = require('node:fs').readFileSync(new URL('../admin.js', import.meta.url), 'utf8');
    assert.match(src, /throw new Error\([^)]*NOTA_FROM_EMAIL/,
      'un expéditeur absent doit LEVER, jamais rendre undefined');
    assert.doesNotMatch(src, /if \(!process\.env\.NOTA_FROM_EMAIL\) return;/,
      'le retour muet est exactement le bogue');
  } finally {
    if (avant === undefined) delete process.env.NOTA_FROM_EMAIL;
    else process.env.NOTA_FROM_EMAIL = avant;
  }
});

// ---------------------------------------------------------------------------
// 6. LA FENÊTRE VIENT DE LA CONFIGURATION, ET « AUJOURD'HUI » EST QUÉBÉCOIS
// ---------------------------------------------------------------------------

test('« inactif depuis X » : X vient de l’opérateur, dans les bornes servies — jamais du code', async () => {
  const h = make();
  const session = await login(h);
  await h.repo.putNotary(notaire('vieux', { lastSeenAt: ilYA(45), updatedAt: ilYA(45), createdAt: ilYA(400) }));
  await h.repo.putNotary(notaire('frais', { lastSeenAt: ilYA(10), updatedAt: ilYA(10), createdAt: ilYA(400) }));

  const avec = (joursSilence) => h.call('POST', '/admin/campaigns/preview', {
    bearer: session,
    body: {
      audience: { type: 'segment', segmentId: 'notaires_silencieux', params: { joursSilence } },
      templateKey: 'notaryDisconnectedWinback',
    },
  });
  assert.equal(parse(await avec(30)).total, 1, 'seul le silencieux de 45 j');
  assert.equal(parse(await avec(7)).total, 2, 'la fenêtre s’élargit, l’audience aussi');
  // Hors bornes : refusé bruyamment, jamais rabattu sur le défaut.
  assert.equal((await avec(1)).statusCode, 422);
});

test('« aujourd’hui » est le jour ouvrable de QUÉBEC, jamais la tranche UTC de la machine', async () => {
  // 02 h 00 UTC le 3 septembre = 22 h 00 le 2 septembre à Québec. Une offre
  // datée du 3 est donc « demain » ici, et « aujourd'hui » si l'on avait
  // découpé l'instant UTC — un jour d'écart sur toutes les fenêtres.
  const SOIR = Date.parse('2026-09-03T02:00:00.000Z');
  const repo = createMemoryRepo();
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    notifier: faussierNotifier(),
    newId: () => `id-${(n += 1)}`,
    nowMs: () => SOIR,
    config: { allowlist: ['ops@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const app = createAdminApp(repo, {
    admin, analytics: createAnalytics({ repo, now: () => '2026-09-02' }),
    adminBaseUrl: 'https://admin.nota.ca', now: () => '2026-09-02', nowMs: () => SOIR,
  });
  const call = (method, path, { body, bearer } = {}) =>
    app.handle({
      method, path, query: {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const req = parse(await call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } }));
  const session = parse(await call('POST', '/admin/auth/verify', {
    body: { token: decodeURIComponent(req.devLink.split('token=')[1]) },
  })).session;

  await repo.put({
    id: 'b1', courriel: 'client@exemple.ca', dateISO: '2026-09-03', montant: 1800,
    serviceId: 'financement', status: 'OUVERTE', paymentStatus: 'authorized',
    paymentIntentId: 'pi_1', createdAt: new Date(SOIR - 86400000).toISOString(),
  });

  // `joursAvant: 0` ne retient qu'une signature AUJOURD'HUI. Au jour québécois
  // (le 2), le 3 est à un jour : personne. Au jour UTC (le 3), elle serait
  // « aujourd'hui » — et la campagne partirait un jour trop tôt.
  const zero = parse(await call('POST', '/admin/campaigns/preview', {
    bearer: session,
    body: { audience: { type: 'segment', segmentId: 'clients_offre_proche', params: { joursAvant: 1 } }, templateKey: 'dateApproaching' },
  }));
  assert.equal(zero.total, 1, JSON.stringify(zero));
  assert.match(zero.echantillon[0], /signature dans 1 j/,
    'la distance se compte depuis le jour de Québec, pas depuis la tranche UTC');
});

test('le plafond et la fenêtre de fréquence viennent de la configuration, pas d’un littéral', async () => {
  const h = make({ campagnePlafond: 1 });
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));
  await h.repo.putNotary(notaire('b'));
  await h.call('PUT', '/admin/audiences/groups/pilote', { bearer: session, body: GROUPE });
  const res = parse(await h.call('POST', '/admin/campaigns/preview', {
    bearer: session,
    body: { audience: { type: 'group', groupId: 'pilote' }, templateKey: 'notaryDisconnectedWinback' },
  }));
  assert.equal(res.plafond.limite, 1);
  assert.equal(res.plafond.depasse, true);
});

test('les bornes de campagne se lisent dans l’environnement quand la console est câblée par Terraform', async () => {
  const avantP = process.env.NOTA_CAMPAGNE_PLAFOND;
  const avantF = process.env.NOTA_CAMPAGNE_FENETRE_HEURES;
  const avantA = process.env.NOTA_ADMIN_EMAILS;
  process.env.NOTA_CAMPAGNE_PLAFOND = '3';
  process.env.NOTA_CAMPAGNE_FENETRE_HEURES = '48';
  process.env.NOTA_ADMIN_EMAILS = 'ops@nota.ca';
  try {
    const repo = createMemoryRepo();
    await repo.putNotary(notaire('a'));
    await repo.putNotary(notaire('b'));
    await repo.putNotary(notaire('c'));
    await repo.putNotary(notaire('d'));
    const app = createAdminApp(repo, {
      mailer: { send: async () => {} },
      notifier: faussierNotifier(),
      adminBaseUrl: 'https://admin.nota.ca',
      now: () => TODAY,
      nowMs: () => START,
    });
    const call = (method, path, { body, bearer } = {}) =>
      app.handle({
        method, path, query: {},
        headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const req = parse(await call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } }));
    const token = decodeURIComponent(req.devLink.split('token=')[1]);
    const session = parse(await call('POST', '/admin/auth/verify', { body: { token } })).session;
    const res = parse(await call('POST', '/admin/campaigns/preview', {
      bearer: session,
      body: {
        audience: { type: 'segment', segmentId: 'notaires_silencieux', params: { joursSilence: 7 } },
        templateKey: 'notaryDisconnectedWinback',
      },
    }));
    assert.equal(res.plafond.limite, 3, 'le plafond vient de NOTA_CAMPAGNE_PLAFOND');
  } finally {
    if (avantP === undefined) delete process.env.NOTA_CAMPAGNE_PLAFOND; else process.env.NOTA_CAMPAGNE_PLAFOND = avantP;
    if (avantF === undefined) delete process.env.NOTA_CAMPAGNE_FENETRE_HEURES; else process.env.NOTA_CAMPAGNE_FENETRE_HEURES = avantF;
    if (avantA === undefined) delete process.env.NOTA_ADMIN_EMAILS; else process.env.NOTA_ADMIN_EMAILS = avantA;
  }
});

// ---------------------------------------------------------------------------
// 7. LA PROMESSE D'INFRA SANS LAQUELLE LE REGISTRE EST DÉCORATIF
// ---------------------------------------------------------------------------
//
// La partition du registre des destinataires est MINTÉE à l'envoi
// (`CAMPAGNE#<id>`), donc aucune liste finie de valeurs exactes ne peut la
// couvrir — `apps/api/src/keys.js` le signalait noir sur blanc avant qu'on
// branche le registre. Sans le préfixe dans la condition `LeadingKeys`, chaque
// écriture partirait en AccessDenied EN PRODUCTION pendant que les tests, eux,
// resteraient verts sur le dépôt en mémoire : exactement la classe de bogue que
// tout ce chantier corrige.

test('la porte d’écriture de la Lambda admin autorise la partition du registre des destinataires', async () => {
  const { readFileSync } = await import('node:fs');
  const tf = readFileSync(new URL('../../../infra/admin.tf', import.meta.url), 'utf8');
  const bloc = tf.slice(tf.indexOf('MainTableCampaignWrite'));
  const condition = bloc.slice(0, bloc.indexOf('\n  }\n\n'));

  assert.match(condition, /ForAllValues:StringLike/,
    'une partition mintée à l’envoi ne se couvre pas par une égalité exacte');
  assert.match(condition, /"CAMPAGNE#\*"/,
    'sans ce préfixe, appendCampaignRecipient lève AccessDenied en production');
  assert.match(condition, /"AUDIENCE#GROUPES"/, 'les groupes d’audience restent écrivables');
  assert.match(condition, /"CONSENT#COURRIEL"/, 'la projection de consentement aussi');

  // Le préfixe ne doit pas ouvrir la table : les trois autres familles d'items
  // du schéma commencent par autre chose.
  const keys = require('../src/keys.js');
  assert.match(keys.campaignRecipientsPK('camp_1'), /^CAMPAGNE#/);
  assert.ok(!keys.notifPK('roy@etude.test').startsWith('CAMPAGNE#'));
  assert.ok(!keys.clientIndexPK('a@b.ca').startsWith('CAMPAGNE#'));
  // Et la clé refuse le vide, donc le seau commun « CAMPAGNE# » reste hors
  // d'atteinte même avec le joker.
  assert.throws(() => keys.campaignRecipientsPK(''), /seau COMMUN/);
});

test('les bornes de campagne sont des variables Terraform, pas des littéraux', async () => {
  const { readFileSync } = await import('node:fs');
  const vars = readFileSync(new URL('../../../infra/variables.tf', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../../../infra/admin.tf', import.meta.url), 'utf8');
  for (const nom of ['campagne_plafond', 'campagne_fenetre_heures', 'audience_membres_max']) {
    assert.match(vars, new RegExp(`variable "${nom}"`), `infra/variables.tf ne déclare pas ${nom}`);
  }
  assert.match(admin, /NOTA_CAMPAGNE_PLAFOND\s*=\s*var\.campagne_plafond/);
  assert.match(admin, /NOTA_CAMPAGNE_FENETRE_HEURES\s*=\s*var\.campagne_fenetre_heures/);
  assert.match(admin, /NOTA_AUDIENCE_MEMBRES_MAX\s*=\s*var\.audience_membres_max/);
});

// ---------------------------------------------------------------------------
// 8. LE COMPOSITEUR — une campagne porte SA copie, les gabarits ne bougent pas
// ---------------------------------------------------------------------------

const MESSAGE = {
  sujetFr: 'On ne vous a pas vu depuis un moment',
  sujetEn: 'We have not seen you in a while',
  corpsFr: 'Le carnet reçoit des demandes chaque jour à Québec. Revenez quand vous voulez.',
  corpsEn: 'The carnet receives requests every day in Québec. Come back whenever you like.',
  ctaFr: 'Ouvrir le carnet',
  ctaEn: 'Open the carnet',
};

test('une campagne écrite à la main part avec SA copie, sans toucher au registre des gabarits', async () => {
  const h = make();
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));

  const res = parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'user', email: 'a@etude.test' }, message: MESSAGE },
  }));
  assert.equal(res.envoyes, 1, JSON.stringify(res));
  const envoye = h.notifier.envoyes[0];
  assert.equal(envoye.templateKey, undefined, 'aucun gabarit détourné');
  assert.equal(envoye.message.sujetFr, MESSAGE.sujetFr);

  // Et RIEN n'a été écrit dans les surcharges de gabarit : le transactionnel
  // reste ce qu'il était.
  assert.equal(await h.repo.getEmailOverride('notaryDisconnectedWinback'), null);
  const tpl = parse(await h.call('GET', '/admin/notifications/templates', { bearer: session }));
  assert.ok(tpl.templates.every((t) => !t.override), 'aucune surcharge de gabarit n’a bougé');
});

test('le message composé est CONSERVÉ avec la campagne — sinon « qui a reçu quoi » n’a pas de « quoi »', async () => {
  const h = make();
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));
  const res = parse(await h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'user', email: 'a@etude.test' }, message: MESSAGE },
  }));
  const journal = await h.repo.queryAuditByDay(NOW_ISO.slice(0, 10));
  const entree = journal.find((e) => e.action === 'campagne_envoyee' && e.meta.campagneId === res.campagneId);
  assert.equal(entree.meta.message.sujetFr, MESSAGE.sujetFr);
  assert.equal(entree.meta.message.corpsFr, MESSAGE.corpsFr);
});

test('la copie composée est validée comme celle d’un gabarit : bilingue, bornée, sans HTML, sans partage d’honoraires', async () => {
  const h = make();
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));
  const envoyer = (message) => h.call('POST', '/admin/campaigns', {
    bearer: session,
    body: { audience: { type: 'user', email: 'a@etude.test' }, message },
  });

  assert.equal((await envoyer({ ...MESSAGE, sujetEn: '' })).statusCode, 422, 'une paire à moitié remplie n’est pas une copie');
  assert.equal((await envoyer({ ...MESSAGE, corpsFr: '<b>gras</b>' })).statusCode, 422, 'le HTML est refusé');
  assert.equal((await envoyer({ ...MESSAGE, sujetFr: 'x'.repeat(500) })).statusCode, 422, 'les bornes sont des bornes');
  assert.equal((await envoyer({ ...MESSAGE, corpsFr: 'Le notaire garde 85 % de ses honoraires.' })).statusCode, 422,
    'art. 32 C.déont. / art. 32.1 2° Loi sur le notariat');
  assert.equal((await envoyer({ ...MESSAGE, corpsFr: 'Bonjour {{montant}}' })).statusCode, 422,
    'une campagne ne connaît que l’adresse : tout autre jeton resterait vide');
  assert.equal((await envoyer({})).statusCode, 422, 'ni gabarit ni copie : rien à envoyer');
});

test('le jeton {{email}} d’une campagne composée s’interpole vraiment', async () => {
  const { repo, notifier, envoyes } = notifieur();
  const r = await notifier.sendCampaign({
    to: 'a@etude.test',
    ctx: { email: 'a@etude.test' },
    message: { ...MESSAGE, sujetFr: 'Bonjour {{email}}', sujetEn: 'Hello {{email}}' },
  });
  assert.equal(r.sent, true, JSON.stringify(r));
  assert.match(envoyes[0].subject, /a@etude\.test/);
  assert.match(envoyes[0].html, /carnet reçoit des demandes/);
  assert.ok(envoyes[0].unsubscribeUrl, 'LCAP art. 6 : le retrait voyage sur une campagne composée aussi');
  assert.equal(await repo.isUnsubscribed('a@etude.test'), false);
});

test('une campagne composée honore quand même la suppression', async () => {
  const { repo, notifier, envoyes } = notifieur();
  await repo.putUnsubscribe('parti@exemple.ca', NOW_ISO);
  const r = await notifier.sendCampaign({ to: 'parti@exemple.ca', ctx: {}, message: MESSAGE });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'unsubscribed');
  assert.equal(envoyes.length, 0);
});

test('emails.js sait valider et bâtir une campagne composée, et n’a pas ajouté de gabarit au registre', async () => {
  assert.equal(typeof emails.campaignMessage, 'function');
  assert.equal(typeof emails.validateCampaignMessage, 'function');
  assert.equal(emails.TEMPLATE_META.campaign, undefined,
    'une campagne n’est pas un gabarit transactionnel de plus dans l’écran Courriels');
  const v = emails.validateCampaignMessage(MESSAGE);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const built = emails.campaignMessage({ ...v.message, email: 'a@b.ca', baseUrl: 'https://nota.test' });
  assert.match(built.subject, /On ne vous a pas vu/);
  assert.match(built.subject, / \/ /, 'le sujet reste bilingue');
});

test('la nature d’une campagne composée est celle de la CIBLE — aucun gabarit à détourner', async () => {
  const h = make();
  const session = await login(h);
  await h.repo.putNotary(notaire('a'));
  const res = parse(await h.call('POST', '/admin/campaigns/preview', {
    bearer: session,
    body: { audience: { type: 'user', email: 'a@etude.test', nature: 'transactionnel' }, message: MESSAGE },
  }));
  assert.equal(res.nature, segments.NATURE.TRANSACTIONNEL);
});
