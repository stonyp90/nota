// CE QUE LA PARITÉ NE PEUT PAS VOIR : LA COMMANDE ELLE-MÊME.
//
// `registres-persistance.test.mjs` éprouve la sémantique — les deux
// adaptateurs répondent la même chose. Il reste ce qu'aucune réponse ne
// révèle : sur QUELLE table l'écriture part, avec quelle ConditionExpression,
// et si une lecture dégénère en parcours de table.
//
// Le patron est celui d'`audit-dynamo.test.mjs` : on inspecte la commande
// remise au client, on ne parle jamais à AWS. Deux invariants tiennent tout :
//   • la Lambda PUBLIQUE n'a pas la table admin (elle est câblée sans elle) —
//     un registre qui partirait là-bas n'existerait qu'en test ;
//   • le rôle IAM n'accorde ni Scan ni parcours : une lecture qui en aurait
//     besoin est un bogue de dessin, pas un problème de coût.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDynamoRepo } = require('../src/repo-dynamo.js');
const keys = require('../src/keys.js');

const T0 = '2026-09-03T14:00:00.000Z';

function recordingRepo(reply) {
  const sent = [];
  const doc = {
    async send(cmd) {
      const rec = { name: cmd.constructor.name, input: cmd.input };
      sent.push(rec);
      return reply ? reply(rec) : {};
    },
  };
  // Exactement le câblage de la Lambda PUBLIQUE : aucune table admin.
  return { repo: createDynamoRepo({ tableName: 'nota-main', doc }), sent };
}

const puts = (sent) => sent.filter((s) => s.name === 'PutCommand');
const seule = (sent, name) => sent.find((s) => s.name === name);

test('le journal de consentement s’écrit une fois, et met à jour sa projection', async () => {
  const { repo, sent } = recordingRepo();
  await repo.appendConsentEvent({
    courriel: 'Roy@Etude.CA', audience: 'notaire', type: 'octroi', base: 'expres',
    version: 'consent-2026-09', source: 'inscription', ip: '1.2.3.4', lang: 'fr',
    at: T0, id: 'e1',
  });

  const [journal, projection] = puts(sent);
  assert.equal(journal.input.TableName, 'nota-main');
  assert.equal(journal.input.Item.PK, 'CONSENT#roy@etude.ca');
  assert.equal(journal.input.Item.SK, `${T0}#e1`);
  // Le discriminant `type: '<entité>'` est DÉLIBÉRÉMENT absent, comme sur les
  // items PARTNER# : le champ métier s’appelle littéralement `type` (octroi /
  // retrait) et l’écraser ferait disparaître la nature de l’événement.
  assert.equal(journal.input.Item.type, 'octroi', 'la nature de l’événement survit à l’écriture');
  assert.equal(journal.input.Item.base, 'expres');
  assert.match(String(journal.input.ConditionExpression), /attribute_not_exists/, 'append-only');

  // La projection est un INDEX DE LECTURE — même table, partition littérale.
  assert.equal(projection.input.Item.PK, 'CONSENT#COURRIEL');
  assert.equal(projection.input.Item.SK, 'EMAIL#roy@etude.ca');
  assert.equal(projection.input.Item.at, T0);
  // L'état courant s'écrase — mais JAMAIS avec un fait plus ancien que celui
  // qu'il porte déjà. La condition est atomique, donc elle tient aussi entre
  // deux Lambdas concurrentes : sans elle, un octroi rejoué en retard
  // ressusciterait un consentement retiré, et `segments.js` (qui ne lit que
  // cette projection) recommencerait à démarcher.
  assert.equal(projection.input.ConditionExpression, 'attribute_not_exists(PK) OR attribute_not_exists(#at) OR #at <= :at');
  assert.deepEqual(projection.input.ExpressionAttributeNames, { '#at': 'at' });
  assert.equal(projection.input.ExpressionAttributeValues[':at'], T0);
});

test('la porte d’ÉTAT, elle, écrase sans condition — c’est une décision, pas un événement', async () => {
  const { repo, sent } = recordingRepo();
  await repo.putEmailConsent('Roy@Etude.CA', { base: 'expres', at: T0, source: 'inscription' });
  const put = seule(sent, 'PutCommand');
  assert.equal(put.input.Item.PK, 'CONSENT#COURRIEL');
  assert.equal(put.input.ConditionExpression, undefined, 'l’état écrit à la main fait foi');
});

test('le journal de consentement se relit par sa seule partition, borné, et rendu dans l’ordre', async () => {
  const T10 = '2026-09-03T14:10:00.000Z';
  const { repo, sent } = recordingRepo((rec) =>
    rec.name === 'QueryCommand'
      ? {
          Items: [
            { PK: 'CONSENT#roy@etude.ca', SK: `${T10}#e2`, id: 'e2', type: 'retrait', courriel: 'roy@etude.ca', at: T10 },
            { PK: 'CONSENT#roy@etude.ca', SK: `${T0}#e1`, id: 'e1', type: 'octroi', courriel: 'roy@etude.ca', at: T0 },
          ],
        }
      : {}
  );
  const journal = await repo.listConsentEvents('Roy@Etude.CA');
  const q = seule(sent, 'QueryCommand');
  assert.equal(q.input.TableName, 'nota-main');
  assert.equal(q.input.ExpressionAttributeValues[':pk'], 'CONSENT#roy@etude.ca');
  // UNE Query bornée, jamais une boucle sur toute la partition : une lecture
  // non bornée finit par rapatrier une partition entière dans la mémoire d'une
  // Lambda. Et la fenêtre garde le bout RÉCENT — le retrait est le fait qui
  // décide si l'on peut encore démarcher, l'octroi de 2019 ne l'est plus.
  assert.equal(q.input.Limit, keys.CONSENT_PAGE_MAX);
  assert.equal(q.input.ScanIndexForward, false, 'la fenêtre se prend par le bout récent…');
  assert.deepEqual(
    journal.map((e) => e.id),
    ['e1', 'e2'],
    '…et se rend du plus ancien au plus récent : une chaîne de preuve se lit dans l’ordre'
  );
  assert.equal(journal[0].type, 'octroi', 'la nature de l’événement survit à la lecture');
  assert.equal(journal[0].PK, undefined, 'les clés de table ne remontent jamais');
});

test('un avis en application porte un ttl et refuse le rejeu', async () => {
  const { repo, sent } = recordingRepo();
  await repo.appendNotification({
    sujet: 'roy@etude.ca', audience: 'notaire', kind: 'nouvelle_demande',
    titre: 'Une demande', corps: 'texte', lien: null, refId: 'b1', at: T0, id: 'n1',
  });
  const put = seule(sent, 'PutCommand');
  assert.equal(put.input.Item.PK, 'NOTIF#roy@etude.ca');
  assert.equal(put.input.Item.SK, `${T0}#n1`);
  assert.equal(put.input.Item.type, 'notification');
  assert.equal(put.input.Item.ttl, keys.notifTtl(T0));
  assert.equal(put.input.Item.luLe, null);
  assert.match(String(put.input.ConditionExpression), /attribute_not_exists/);
});

test('le sujet d’un client est un haché : le jeton porteur n’entre jamais dans la table', async () => {
  const { repo, sent } = recordingRepo();
  const jeton = 'jeton-porteur-tres-secret';
  await repo.appendNotification({
    sujet: keys.clientNotifSubject(jeton), audience: 'client', kind: 'proposition',
    titre: 'Une proposition', corps: 'texte', at: T0, id: 'n1',
  });
  const ecrit = JSON.stringify(seule(sent, 'PutCommand').input);
  assert.ok(!ecrit.includes(jeton), 'le jeton brut serait un secret rangé en clair dans une clé');
  assert.match(seule(sent, 'PutCommand').input.Item.PK, /^NOTIF#client:[0-9a-f]{64}$/);
});

test('la lecture des avis est bornée et remonte à rebours — jamais toute la partition', async () => {
  const { repo, sent } = recordingRepo((rec) => (rec.name === 'QueryCommand' ? { Items: [] } : {}));
  await repo.listNotifications('roy@etude.ca', { limit: 20, depuis: T0 });
  const q = seule(sent, 'QueryCommand');
  assert.equal(q.input.ExpressionAttributeValues[':pk'], 'NOTIF#roy@etude.ca');
  assert.equal(q.input.ScanIndexForward, false, 'les plus récentes d’abord');
  assert.equal(q.input.Limit, 20);
  assert.equal(q.input.ExpressionAttributeValues[':depuis'], T0);
  assert.match(String(q.input.KeyConditionExpression), /SK >= :depuis/);
});

test('marquer lu n’écrit que sur les avis non lus, un UpdateItem chacun', async () => {
  const items = [
    { PK: 'NOTIF#roy@etude.ca', SK: `${T0}#n1`, id: 'n1', at: T0, luLe: null },
    { PK: 'NOTIF#roy@etude.ca', SK: `${T0}#n2`, id: 'n2', at: T0, luLe: '2026-09-03T15:00:00.000Z' },
  ];
  const { repo, sent } = recordingRepo((rec) => (rec.name === 'QueryCommand' ? { Items: items } : {}));
  const marques = await repo.markNotificationsRead('roy@etude.ca', 'toutes', '2026-09-03T16:00:00.000Z');

  // La recherche des clés est BORNÉE à la même fenêtre que la lecture — on ne
  // marque lu que ce qu'on pouvait voir — et elle ne rapatrie QUE de quoi
  // décider : la clé, l'identifiant, l'instant de lecture. Le corps d'un avis
  // n'a rien à faire dans la mémoire d'une Lambda qui ne fait que cocher.
  const recherche = seule(sent, 'QueryCommand');
  assert.equal(recherche.input.Limit, keys.NOTIF_PAGE_MAX);
  assert.equal(recherche.input.ScanIndexForward, false, 'la même fenêtre que listNotifications');
  assert.equal(recherche.input.ProjectionExpression, 'PK, SK, #id, #lu');
  assert.deepEqual(recherche.input.ExpressionAttributeNames, { '#id': 'id', '#lu': 'luLe' });

  assert.equal(marques, 1, 'le déjà-lu n’est pas réécrit');
  const updates = sent.filter((s) => s.name === 'UpdateCommand');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].input.TableName, 'nota-main');
  assert.deepEqual(updates[0].input.Key, { PK: 'NOTIF#roy@etude.ca', SK: `${T0}#n1` });
  assert.match(String(updates[0].input.ConditionExpression), /attribute_exists\(PK\)/);
  assert.equal(updates[0].input.ExpressionAttributeValues[':at'], '2026-09-03T16:00:00.000Z');
});

test('le journal par sujet et le registre des destinataires sont append-only', async () => {
  const { repo, sent } = recordingRepo();
  await repo.appendSubjectEvent({
    sujet: 'roy@etude.ca', kind: 'courriel', templateKey: 'nouvelle_demande',
    refId: 'b1', at: T0, messageId: 'ses-1', id: 'j1',
  });
  await repo.appendCampaignRecipient({
    campagneId: 'camp-1', courriel: 'Roy@Etude.CA', templateKey: 'invitation',
    nature: 'commercial', at: T0, statut: 'envoye',
  });

  const [sujet, destinataire] = puts(sent);
  assert.equal(sujet.input.Item.PK, 'SUJET#roy@etude.ca');
  assert.equal(sujet.input.Item.SK, `${T0}#j1`);
  assert.equal(sujet.input.Item.type, 'subject_event');
  assert.match(String(sujet.input.ConditionExpression), /attribute_not_exists/);

  assert.equal(destinataire.input.Item.PK, 'CAMPAGNE#camp-1');
  assert.equal(destinataire.input.Item.SK, 'EMAIL#roy@etude.ca');
  assert.equal(destinataire.input.Item.type, 'campaign_recipient');
  assert.match(String(destinataire.input.ConditionExpression), /attribute_not_exists/);
  // La partition du plafond de fréquence (art. 56 1°) reste intouchée.
  assert.notEqual(destinataire.input.Item.PK, keys.campaignLogPK());
});

test('la liste des destinataires reprend au curseur qu’elle a rendu', async () => {
  const derniere = { PK: 'CAMPAGNE#camp-1', SK: 'EMAIL#b@x.ca' };
  const { repo, sent } = recordingRepo((rec) =>
    rec.name === 'QueryCommand'
      ? {
          Items: [{ PK: 'CAMPAGNE#camp-1', SK: 'EMAIL#b@x.ca', type: 'campaign_recipient', courriel: 'b@x.ca' }],
          LastEvaluatedKey: derniere,
        }
      : {}
  );
  const page = await repo.listCampaignRecipients('camp-1', { limit: 1 });
  assert.equal(typeof page.cursor, 'string', 'le curseur voyage : il doit être sérialisable');
  assert.equal(page.destinataires[0].PK, undefined);

  await repo.listCampaignRecipients('camp-1', { limit: 1, cursor: page.cursor });
  const [premiere, suivante] = sent.filter((s) => s.name === 'QueryCommand');
  assert.equal(premiere.input.ExclusiveStartKey, undefined);
  assert.deepEqual(suivante.input.ExclusiveStartKey, derniere, 'la page suivante reprend exactement où l’autre s’est arrêtée');
  assert.equal(suivante.input.Limit, 1);
});

test('un curseur illisible est ignoré, pas fatal', async () => {
  const { repo, sent } = recordingRepo((rec) => (rec.name === 'QueryCommand' ? { Items: [] } : {}));
  const page = await repo.listCampaignRecipients('camp-1', { cursor: 'pas-du-base64-json' });
  assert.deepEqual(page, { destinataires: [], cursor: null });
  assert.equal(seule(sent, 'QueryCommand').input.ExclusiveStartKey, undefined);
});

test('la liste des groupes d’audience suit LastEvaluatedKey jusqu’au bout', async () => {
  const derniere = { PK: 'AUDIENCE#GROUPES', SK: 'GROUP#a' };
  let tour = 0;
  const { repo, sent } = recordingRepo((rec) => {
    if (rec.name !== 'QueryCommand') return {};
    tour += 1;
    return tour === 1
      ? { Items: [{ PK: 'AUDIENCE#GROUPES', SK: 'GROUP#a', type: 'audience_group', id: 'a', membres: ['x@y.ca'] }], LastEvaluatedKey: derniere }
      : { Items: [{ PK: 'AUDIENCE#GROUPES', SK: 'GROUP#b', type: 'audience_group', id: 'b' }] };
  });
  const groupes = await repo.listAudienceGroups();
  assert.deepEqual(groupes.map((g) => g.id), ['a', 'b'], 'une seconde page ne doit pas disparaître');
  assert.deepEqual(groupes[1].membres, [], 'un groupe sans membres reste lisible');
  const queries = sent.filter((s) => s.name === 'QueryCommand');
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1].input.ExclusiveStartKey, derniere);
});

test('l’index client porte le ttl de l’offre et ne s’oppose à rien', async () => {
  const { repo, sent } = recordingRepo();
  await repo.indexClientBid({ courriel: 'Roy@Etude.CA', bidId: 'b1', dateISO: '2026-10-02', at: T0 });
  const put = seule(sent, 'PutCommand');
  assert.equal(put.input.Item.PK, 'CLIENT#roy@etude.ca');
  assert.equal(put.input.Item.SK, 'BID#2026-10-02#b1');
  assert.equal(put.input.Item.type, 'client_bid');
  assert.equal(put.input.Item.ttl, keys.bidTtl('2026-10-02'));
  assert.equal(put.input.ConditionExpression, undefined, 'un index n’est pas un journal : sa clé porte déjà l’unicité');
});

test('l’index client se lit borné — la partition d’une personne n’est pas une page', async () => {
  const { repo, sent } = recordingRepo((rec) =>
    rec.name === 'QueryCommand'
      ? {
          Items: [
            { PK: 'CLIENT#roy@etude.ca', SK: 'BID#2026-11-15#b2', type: 'client_bid', bidId: 'b2', dateISO: '2026-11-15' },
            { PK: 'CLIENT#roy@etude.ca', SK: 'BID#2026-10-02#b1', type: 'client_bid', bidId: 'b1', dateISO: '2026-10-02' },
          ],
        }
      : {}
  );
  const offres = await repo.listClientBids('Roy@Etude.CA');
  const q = seule(sent, 'QueryCommand');
  assert.equal(q.input.ExpressionAttributeValues[':pk'], 'CLIENT#roy@etude.ca');
  assert.equal(q.input.Limit, keys.CLIENT_BID_PAGE_MAX, 'une lecture non bornée est un bogue de dessin, pas un coût');
  assert.equal(q.input.ScanIndexForward, false, 'la fenêtre se prend par les dates les plus proches…');
  assert.deepEqual(offres.map((o) => o.bidId), ['b1', 'b2'], '…et se rend chronologiquement, comme le carnet');
});

test('le réabonnement efface l’item de désabonnement, et la marque d’effacement a sa propre clé', async () => {
  const { repo, sent } = recordingRepo();
  await repo.deleteUnsubscribe(' ROY@Etude.CA ');
  await repo.putErasure('Roy@Etude.CA', T0);
  await repo.getErasure('roy@etude.ca');

  const del = seule(sent, 'DeleteCommand');
  assert.equal(del.input.TableName, 'nota-main');
  assert.deepEqual(del.input.Key, { PK: 'UNSUB#roy@etude.ca', SK: 'UNSUB' });

  const put = seule(sent, 'PutCommand');
  assert.deepEqual({ PK: put.input.Item.PK, SK: put.input.Item.SK }, { PK: 'ERASURE#roy@etude.ca', SK: 'ERASURE' });
  assert.equal(put.input.Item.type, 'erasure');
  assert.deepEqual(seule(sent, 'GetCommand').input.Key, { PK: 'ERASURE#roy@etude.ca', SK: 'ERASURE' });
});

test('aucun de ces sept registres ne Scanne, et aucun ne vise la table admin', async () => {
  const { repo, sent } = recordingRepo((rec) => (rec.name === 'QueryCommand' ? { Items: [] } : {}));
  await repo.appendConsentEvent({ courriel: 'a@b.ca', audience: 'client', type: 'octroi', base: 'expres', at: T0, id: 'e1' });
  await repo.listConsentEvents('a@b.ca');
  await repo.appendNotification({ sujet: 'a@b.ca', audience: 'client', kind: 'x', titre: 't', corps: 'c', at: T0, id: 'n1' });
  await repo.listNotifications('a@b.ca');
  await repo.markNotificationsRead('a@b.ca', 'toutes', T0);
  await repo.appendSubjectEvent({ sujet: 'a@b.ca', kind: 'courriel', templateKey: 'x', at: T0, id: 'j1' });
  await repo.listSubjectEvents('a@b.ca');
  await repo.appendCampaignRecipient({ campagneId: 'c1', courriel: 'a@b.ca', templateKey: 'x', nature: 'commercial', at: T0 });
  await repo.listCampaignRecipients('c1');
  await repo.putAudienceGroup({ id: 'g1', membres: [] }, T0);
  await repo.getAudienceGroup('g1');
  await repo.listAudienceGroups();
  await repo.deleteAudienceGroup('g1');
  await repo.indexClientBid({ courriel: 'a@b.ca', bidId: 'b1', dateISO: '2026-10-02', at: T0 });
  await repo.listClientBids('a@b.ca');
  await repo.deleteUnsubscribe('a@b.ca');
  await repo.putErasure('a@b.ca', T0);
  await repo.getErasure('a@b.ca');

  assert.ok(sent.length > 0);
  assert.ok(sent.every((s) => s.name !== 'ScanCommand'), 'un Scan élargirait la permission IAM à toute la table');
  assert.ok(sent.every((s) => s.input.TableName === 'nota-main'), 'la Lambda publique n’a pas la table admin');
  assert.ok(sent.every((s) => !s.input.IndexName), 'aucun index secondaire : ces registres se lisent par leur partition');
});
