// SEPT REGISTRES, ET LA MÊME SÉMANTIQUE DES DEUX CÔTÉS.
//
// Cette suite pose la couche de persistance que six autres chantiers vont
// consommer. Elle ne teste aucune route : elle tient les clés (keys.js) et les
// deux adaptateurs, et surtout elle exige qu'ils soient INDISCERNABLES.
//
// La régression qu'on redoute est toujours la même : un scénario écrit contre
// `repo-memory` passe en test, et la production — qui tourne sur `repo-dynamo`
// — fait autre chose. Chaque scénario ci-dessous est donc exécuté DEUX fois,
// une par adaptateur, contre la même assertion (voir `fake-table.mjs`, une
// table DynamoDB en mémoire qui évalue vraiment les ConditionExpression).
//
// Trois textes commandent ce qui suit :
//   • **Loi 25** (art. 8, 28) — le consentement doit pouvoir être PROUVÉ après
//     coup, et l'effacement demandé doit laisser une marque. D'où un journal
//     append-only, et non un simple état courant écrasable.
//   • **LCAP** (L.C. 2010, ch. 23, art. 13) — c'est à l'expéditeur de prouver
//     le consentement. Un état qu'on écrase ne prouve rien ; un journal, oui.
//   • **Art. 56 1° C.déont.** — le registre des destinataires de campagne est
//     l'histoire, là où `markCampaignSent` n'est que le plafond de fréquence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createFakeTable } from './fake-table.mjs';

const require = createRequire(import.meta.url);
const keys = require('../src/keys.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createApp } = require('../src/handler.js');
const { createDynamoRepo } = require('../src/repo-dynamo.js');

const T0 = '2026-09-03T14:00:00.000Z';
const t = (min) => new Date(Date.parse(T0) + min * 60000).toISOString();

// Les deux adaptateurs, ouverts de la même façon. Tout scénario écrit contre
// cette liste s'exécute une fois par adaptateur, avec la même assertion.
const ADAPTATEURS = [
  ['mémoire', () => createMemoryRepo()],
  ['dynamo', () => createDynamoRepo({ tableName: 'nota-main', doc: createFakeTable().doc })],
];

// ============================================================================
// 1. Les clés : la forme, et la raison de la forme
// ============================================================================

test('keys : le journal de consentement se range sous l’adresse, l’instant en tête du tri', () => {
  assert.equal(keys.consentJournalPK('  Roy@Etude.CA '), 'CONSENT#roy@etude.ca');
  assert.equal(keys.consentJournalSK(T0, 'e1'), `${T0}#e1`);
  // Le piège du single-table : la PROJECTION d'état courant vit sous la
  // partition littérale CONSENT#COURRIEL. Une adresse contient toujours un
  // « @ » et se range en minuscules — les deux partitions ne peuvent donc pas
  // se confondre, et ce test est là pour que ça reste vrai.
  assert.notEqual(keys.consentJournalPK('roy@etude.ca'), keys.emailConsentPK());
  assert.ok(!keys.consentJournalPK('roy@etude.ca').includes('COURRIEL'));
});

test('keys : le sujet d’une notification cliente est un HACHÉ, jamais le jeton', () => {
  const jeton = 'jeton-porteur-tres-secret';
  const sujet = keys.clientNotifSubject(jeton);
  assert.ok(sujet.startsWith('client:'));
  assert.equal(sujet.slice('client:'.length), createHash('sha256').update(jeton).digest('hex'));
  assert.ok(!sujet.includes(jeton), 'le jeton brut ne doit jamais devenir une clé');
  // Déterministe : le même porteur retrouve ses avis d’une requête à l’autre.
  assert.equal(keys.clientNotifSubject(jeton), sujet);
  // Le sujet d’un notaire, lui, EST son courriel — normalisé comme partout.
  assert.equal(keys.notaryNotifSubject(' Roy@Etude.CA '), 'roy@etude.ca');
  assert.equal(keys.notifPK(sujet), 'NOTIF#' + sujet);
  assert.equal(keys.notifSK(T0, 'n1'), `${T0}#n1`);
});

test('keys : journal par sujet, index client et marque d’effacement', () => {
  assert.equal(keys.subjectJournalPK('roy@etude.ca'), 'SUJET#roy@etude.ca');
  assert.equal(keys.subjectJournalSK(T0, 'j1'), `${T0}#j1`);
  assert.equal(keys.clientIndexPK(' Roy@Etude.CA '), 'CLIENT#roy@etude.ca');
  assert.equal(keys.clientBidSK('2026-10-02', 'b1'), 'BID#2026-10-02#b1');
  assert.ok(keys.clientBidSK('2026-10-02', 'b1').startsWith(keys.CLIENT_BID_PREFIX));
  assert.equal(keys.erasurePK(' Roy@Etude.CA '), 'ERASURE#roy@etude.ca');
  assert.equal(keys.ERASURE_SK, 'ERASURE');
});

test('keys : le registre des destinataires ne peut pas écraser le plafond de fréquence', () => {
  assert.equal(keys.campaignRecipientsPK('camp-1'), 'CAMPAGNE#camp-1');
  assert.equal(keys.campaignRecipientSK(' A@B.CA '), 'EMAIL#a@b.ca');
  // CAMPAGNE#ENVOIS est déjà pris par le registre de fréquence (art. 56 1°) :
  // une campagne qui s’appellerait « ENVOIS » écraserait la dernière date
  // d’envoi de chaque destinataire. La clé refuse plutôt que de corrompre.
  assert.throws(() => keys.campaignRecipientsPK('ENVOIS'), /réservé/i);
  assert.throws(() => keys.campaignRecipientsPK('envois'), /réservé/i);
});

test('keys : le ttl de l’index client est CELUI de l’offre qu’il indexe', async () => {
  const dateISO = '2026-10-02';
  assert.equal(
    keys.bidTtl(dateISO),
    Math.floor(Date.parse(dateISO + 'T00:00:00Z') / 1000) + keys.BID_RETENTION_DAYS * 86400
  );
  assert.equal(keys.bidTtl('pas-une-date'), null, 'une date illisible ne produit pas un ttl NaN');

  // Et la rétention est bien celle que le handler applique à l’offre : si l’un
  // change sans l’autre, l’index survit à ce qu’il indexe (ou meurt avant).
  //
  // La garde passe par la PORTE, pas par la source : elle publie une offre et
  // compare le ttl RÉELLEMENT stocké. Une garde qui cherchait la ligne de
  // calcul dans `handler.js` interdisait la migration qu’elle réclamait — le
  // jour où le handler écrit `ttl: keys.bidTtl(...)`, la ligne disparaît et la
  // garde tombe, alors que l’invariant, lui, n’a jamais été aussi vrai.
  const repo = createMemoryRepo();
  const api = createApp(repo, { now: () => '2026-08-12', newId: () => 'b1' });
  const res = await api.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO, montant: 2500, prefixe: 'G1R',
      pricing: {
        valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue',
        preteur: 'banque_nationale', deplacement: 'client_50',
      },
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  const [offre] = await repo._all();
  assert.equal(offre.ttl, keys.bidTtl(dateISO), 'l’index doit mourir EXACTEMENT avec l’offre qu’il indexe');
});

// ============================================================================
// 2. Registre de consentement (Loi 25 / LCAP) — le même scénario des deux côtés
// ============================================================================

const CONSENTEMENT = {
  courriel: ' Roy@Etude.CA ',
  audience: 'notaire',
  type: 'octroi',
  base: 'expres',
  version: 'consent-2026-09',
  source: 'inscription',
  ip: '1.2.3.4',
  lang: 'fr',
};

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : le consentement est un JOURNAL — chaque événement s’ajoute, aucun n’écrase`, async () => {
    const repo = ouvrir();
    assert.deepEqual(await repo.listConsentEvents('roy@etude.ca'), []);

    assert.equal(await repo.appendConsentEvent({ ...CONSENTEMENT, at: t(0), id: 'e1' }), true);
    assert.equal(
      await repo.appendConsentEvent({
        courriel: 'roy@etude.ca', audience: 'notaire', type: 'retrait',
        base: null, version: 'consent-2026-09', source: 'lien-desabonnement',
        ip: '5.6.7.8', lang: 'en', at: t(10), id: 'e2',
      }),
      true
    );

    const journal = await repo.listConsentEvents('ROY@Etude.ca');
    assert.equal(journal.length, 2, 'le retrait s’AJOUTE, il n’efface pas l’octroi');
    assert.deepEqual(journal.map((e) => e.type), ['octroi', 'retrait'], 'du plus ancien au plus récent');
    assert.deepEqual(journal[0], {
      id: 'e1', courriel: 'roy@etude.ca', audience: 'notaire', type: 'octroi',
      base: 'expres', version: 'consent-2026-09', source: 'inscription',
      ip: '1.2.3.4', lang: 'fr', at: t(0),
    });
    assert.equal(journal[1].source, 'lien-desabonnement');
  });

  test(`${nom} : réécrire le même événement de consentement ne détruit rien`, async () => {
    const repo = ouvrir();
    await repo.appendConsentEvent({ ...CONSENTEMENT, at: t(0), id: 'e1' });
    const rejoue = await repo.appendConsentEvent({
      ...CONSENTEMENT, at: t(0), id: 'e1', base: 'tacite', source: 'rejeu-hostile',
    });
    assert.equal(rejoue, false, 'écriture unique : la seconde tentative est refusée');
    const journal = await repo.listConsentEvents('roy@etude.ca');
    assert.equal(journal.length, 1);
    assert.equal(journal[0].base, 'expres', 'le premier écrit fait foi');
    assert.equal(journal[0].source, 'inscription');
  });

  test(`${nom} : l’écriture au journal met à jour la projection d’état courant`, async () => {
    const repo = ouvrir();
    await repo.appendConsentEvent({ ...CONSENTEMENT, at: t(0), id: 'e1' });
    assert.deepEqual(await repo.getEmailConsent('roy@etude.ca'), {
      email: 'roy@etude.ca', base: 'expres', at: t(0), source: 'inscription',
    });

    // Le journal est la vérité, la projection un index de lecture : elle suit
    // le DERNIER événement, et `segments.js` la lit sans connaître le journal.
    await repo.appendConsentEvent({
      courriel: 'roy@etude.ca', audience: 'notaire', type: 'retrait',
      base: null, source: 'lien-desabonnement', at: t(10), id: 'e2',
    });
    assert.deepEqual(await repo.getEmailConsent('roy@etude.ca'), {
      email: 'roy@etude.ca', base: null, at: t(10), source: 'lien-desabonnement',
    });
    assert.equal((await repo.listConsentEvents('roy@etude.ca')).length, 2, 'le journal, lui, garde tout');
  });
}

// ============================================================================
// 3. Notifications en application
// ============================================================================

const AVIS = {
  sujet: 'roy@etude.ca', audience: 'notaire', kind: 'nouvelle_demande',
  titre: 'Une nouvelle demande', corps: 'Un client cherche un notaire le 2 octobre.',
  lien: 'https://nota.ca/notaire', refId: 'b1',
};

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : les avis reviennent des plus récents aux plus anciens, et portent un ttl`, async () => {
    const repo = ouvrir();
    assert.deepEqual(await repo.listNotifications('roy@etude.ca'), []);

    for (let i = 0; i < 3; i += 1) {
      assert.equal(await repo.appendNotification({ ...AVIS, id: 'n' + i, at: t(i) }), true);
    }
    const avis = await repo.listNotifications('roy@etude.ca');
    assert.deepEqual(avis.map((a) => a.id), ['n2', 'n1', 'n0'], 'les plus récentes d’abord');
    assert.deepEqual(avis[0], {
      id: 'n2', sujet: 'roy@etude.ca', audience: 'notaire', kind: 'nouvelle_demande',
      titre: 'Une nouvelle demande', corps: 'Un client cherche un notaire le 2 octobre.',
      lien: 'https://nota.ca/notaire', refId: 'b1', at: t(2), luLe: null,
      ttl: keys.notifTtl(t(2)),
    });
    assert.ok(avis[0].ttl > Date.parse(t(2)) / 1000, 'le ttl est une date d’expiration, pas un âge');
  });

  test(`${nom} : la lecture des avis se borne, et « depuis » coupe le passé`, async () => {
    const repo = ouvrir();
    for (let i = 0; i < 5; i += 1) await repo.appendNotification({ ...AVIS, id: 'n' + i, at: t(i) });

    assert.deepEqual((await repo.listNotifications('roy@etude.ca', { limit: 2 })).map((a) => a.id), ['n4', 'n3']);
    // `depuis` est INCLUSIF : « tout ce qui s’est passé à partir de cet instant ».
    assert.deepEqual(
      (await repo.listNotifications('roy@etude.ca', { depuis: t(3) })).map((a) => a.id),
      ['n4', 'n3']
    );
    // Une limite absurde retombe sur le plafond partagé par les deux adaptateurs.
    const tout = await repo.listNotifications('roy@etude.ca', { limit: 10000 });
    assert.equal(tout.length, 5);
  });

  test(`${nom} : un avis rejoué ne se dédouble pas`, async () => {
    const repo = ouvrir();
    assert.equal(await repo.appendNotification({ ...AVIS, id: 'n1', at: t(0) }), true);
    assert.equal(await repo.appendNotification({ ...AVIS, id: 'n1', at: t(0), titre: 'Rejeu' }), false);
    const avis = await repo.listNotifications('roy@etude.ca');
    assert.equal(avis.length, 1);
    assert.equal(avis[0].titre, 'Une nouvelle demande', 'le premier écrit fait foi');
  });

  test(`${nom} : marquer lu — par identifiants, puis « toutes »`, async () => {
    const repo = ouvrir();
    for (let i = 0; i < 3; i += 1) await repo.appendNotification({ ...AVIS, id: 'n' + i, at: t(i) });

    assert.equal(await repo.markNotificationsRead('roy@etude.ca', ['n1'], t(30)), 1);
    let avis = await repo.listNotifications('roy@etude.ca');
    assert.deepEqual(avis.map((a) => a.luLe), [null, t(30), null]);

    // Re-marquer ce qui est déjà lu ne compte pas, et n’écrase pas l’instant.
    assert.equal(await repo.markNotificationsRead('roy@etude.ca', ['n1'], t(40)), 0);
    assert.equal((await repo.listNotifications('roy@etude.ca')).find((a) => a.id === 'n1').luLe, t(30));

    assert.equal(await repo.markNotificationsRead('roy@etude.ca', 'toutes', t(50)), 2);
    avis = await repo.listNotifications('roy@etude.ca');
    assert.deepEqual(avis.map((a) => a.luLe), [t(50), t(30), t(50)]);
    assert.equal(await repo.markNotificationsRead('roy@etude.ca', 'toutes', t(60)), 0);
    // Un identifiant inconnu ne fait rien — et ne lève pas.
    assert.equal(await repo.markNotificationsRead('roy@etude.ca', ['fantome'], t(70)), 0);
  });

  test(`${nom} : deux sujets ne se voient jamais`, async () => {
    const repo = ouvrir();
    const client = keys.clientNotifSubject('jeton-du-client');
    await repo.appendNotification({ ...AVIS, sujet: 'roy@etude.ca', id: 'n1', at: t(0) });
    await repo.appendNotification({ ...AVIS, sujet: client, audience: 'client', id: 'n2', at: t(1) });

    assert.deepEqual((await repo.listNotifications('roy@etude.ca')).map((a) => a.id), ['n1']);
    assert.deepEqual((await repo.listNotifications(client)).map((a) => a.id), ['n2']);
    assert.equal(await repo.markNotificationsRead('roy@etude.ca', 'toutes', t(9)), 1, 'un sujet ne marque que les siennes');
    assert.equal((await repo.listNotifications(client))[0].luLe, null);
  });
}

// ============================================================================
// 4. Journal par sujet — « quels courriels cette personne a-t-elle reçus »
// ============================================================================

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : le journal par sujet garde ce qui est parti, du plus récent au plus ancien`, async () => {
    const repo = ouvrir();
    assert.deepEqual(await repo.listSubjectEvents('roy@etude.ca'), []);

    assert.equal(
      await repo.appendSubjectEvent({
        sujet: 'roy@etude.ca', kind: 'courriel', templateKey: 'nouvelle_demande',
        refId: 'b1', at: t(0), messageId: 'ses-1', id: 'j1',
      }),
      true
    );
    await repo.appendSubjectEvent({
      sujet: 'roy@etude.ca', kind: 'courriel', templateKey: 'digest_notaire',
      refId: null, at: t(5), messageId: 'ses-2', id: 'j2',
    });

    const journal = await repo.listSubjectEvents('roy@etude.ca');
    assert.deepEqual(journal.map((e) => e.id), ['j2', 'j1']);
    assert.deepEqual(journal[1], {
      id: 'j1', sujet: 'roy@etude.ca', kind: 'courriel', templateKey: 'nouvelle_demande',
      refId: 'b1', at: t(0), messageId: 'ses-1',
    });
    assert.deepEqual((await repo.listSubjectEvents('roy@etude.ca', { limit: 1 })).map((e) => e.id), ['j2']);
  });

  test(`${nom} : un événement de sujet rejoué ne réécrit pas l’original`, async () => {
    const repo = ouvrir();
    await repo.appendSubjectEvent({ sujet: 'roy@etude.ca', kind: 'courriel', templateKey: 'a', at: t(0), id: 'j1' });
    assert.equal(
      await repo.appendSubjectEvent({ sujet: 'roy@etude.ca', kind: 'courriel', templateKey: 'b', at: t(0), id: 'j1' }),
      false
    );
    const journal = await repo.listSubjectEvents('roy@etude.ca');
    assert.equal(journal.length, 1);
    assert.equal(journal[0].templateKey, 'a');
  });
}

// ============================================================================
// 5. Registre des destinataires de campagne (l’histoire, pas l’état)
// ============================================================================

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : une campagne garde la liste de ses destinataires, une ligne par adresse`, async () => {
    const repo = ouvrir();
    assert.deepEqual(await repo.listCampaignRecipients('camp-1'), { destinataires: [], cursor: null });

    for (const courriel of ['Roy@Etude.CA', 'lavoie@etude.ca']) {
      assert.equal(
        await repo.appendCampaignRecipient({
          campagneId: 'camp-1', courriel, templateKey: 'invitation',
          nature: 'commercial', at: t(0), statut: 'envoye', erreur: null,
        }),
        true
      );
    }
    await repo.appendCampaignRecipient({
      campagneId: 'camp-2', courriel: 'roy@etude.ca', templateKey: 'invitation',
      nature: 'commercial', at: t(60), statut: 'refuse', erreur: 'unsubscribed',
    });

    const { destinataires, cursor } = await repo.listCampaignRecipients('camp-1');
    assert.equal(cursor, null, 'tout tient sur une page');
    assert.deepEqual(destinataires.map((d) => d.courriel), ['lavoie@etude.ca', 'roy@etude.ca']);
    assert.deepEqual(destinataires[1], {
      campagneId: 'camp-1', courriel: 'roy@etude.ca', templateKey: 'invitation',
      nature: 'commercial', at: t(0), statut: 'envoye', erreur: null,
    });
    const deux = await repo.listCampaignRecipients('camp-2');
    assert.deepEqual(deux.destinataires.map((d) => d.statut), ['refuse'], 'chaque campagne a sa partition');
  });

  test(`${nom} : le registre est l’HISTOIRE — un rejeu n’écrase pas la ligne`, async () => {
    const repo = ouvrir();
    await repo.appendCampaignRecipient({
      campagneId: 'camp-1', courriel: 'roy@etude.ca', templateKey: 'invitation',
      nature: 'commercial', at: t(0), statut: 'envoye',
    });
    assert.equal(
      await repo.appendCampaignRecipient({
        campagneId: 'camp-1', courriel: 'ROY@etude.ca', templateKey: 'invitation',
        nature: 'commercial', at: t(99), statut: 'refuse', erreur: 'rejeu',
      }),
      false
    );
    const { destinataires } = await repo.listCampaignRecipients('camp-1');
    assert.equal(destinataires.length, 1);
    assert.equal(destinataires[0].statut, 'envoye');
    assert.equal(destinataires[0].at, t(0));
  });

  test(`${nom} : une campagne nommée « ENVOIS » est refusée, jamais silencieusement fusionnée`, async () => {
    const repo = ouvrir();
    await assert.rejects(
      () => repo.appendCampaignRecipient({ campagneId: 'ENVOIS', courriel: 'a@b.ca', at: t(0) }),
      /réservé/i
    );
    await assert.rejects(() => repo.listCampaignRecipients('envois'), /réservé/i);
  });

  test(`${nom} : la liste des destinataires se pagine par curseur opaque`, async () => {
    const repo = ouvrir();
    for (const c of ['a@x.ca', 'b@x.ca', 'c@x.ca', 'd@x.ca', 'e@x.ca']) {
      await repo.appendCampaignRecipient({
        campagneId: 'camp-1', courriel: c, templateKey: 'invitation', nature: 'commercial', at: t(0), statut: 'envoye',
      });
    }
    const vus = [];
    let cursor = null;
    let tours = 0;
    do {
      const page = await repo.listCampaignRecipients('camp-1', { limit: 2, cursor });
      assert.ok(page.destinataires.length <= 2);
      assert.ok(page.cursor === null || typeof page.cursor === 'string', 'le curseur est opaque et sérialisable');
      vus.push(...page.destinataires.map((d) => d.courriel));
      cursor = page.cursor;
      tours += 1;
    } while (cursor && tours < 10);
    assert.deepEqual(vus, ['a@x.ca', 'b@x.ca', 'c@x.ca', 'd@x.ca', 'e@x.ca']);
  });
}

// ============================================================================
// 5 bis. LA BORNE DE PAGE, ÉPROUVÉE EN LA DÉPASSANT
// ============================================================================
//
// « Aucune lecture ne s'en dispense » est l'argument central de ces registres :
// une partition entière rapatriée dans la mémoire d'une Lambda est un bogue de
// dessin. Un test qui écrit CINQ lignes, en demande dix mille et en attend cinq
// ne peut pas être rouge — il passerait avec un plafond d'un milliard. Celui-ci
// écrit PLUS que le plafond et exige que la fenêtre coupe : il tombe le jour où
// une borne disparaît.
//
// Et il vérifie par quel BOUT la fenêtre coupe, ce qui n'est pas un détail : ce
// qui doit tomber est le passé lointain, jamais le dernier fait — c'est le
// dernier qui décide (le retrait de consentement, l'offre encore vivante).
const jour = (i) => new Date(Date.UTC(2026, 9, 2) + i * 86400000).toISOString().slice(0, 10);

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : chaque lecture bornée COUPE vraiment quand la partition déborde`, async () => {
    const repo = ouvrir();
    const trop = (max) => max + 3;

    // Le journal de consentement : la fenêtre garde le bout RÉCENT.
    for (let i = 0; i < trop(keys.CONSENT_PAGE_MAX); i += 1) {
      await repo.appendConsentEvent({ courriel: 'roy@etude.ca', type: 'octroi', base: 'expres', at: t(i), id: 'e' + i });
    }
    const chaine = await repo.listConsentEvents('roy@etude.ca');
    assert.equal(chaine.length, keys.CONSENT_PAGE_MAX, 'la borne du journal de consentement ne tient pas');
    assert.equal(chaine[chaine.length - 1].at, t(trop(keys.CONSENT_PAGE_MAX) - 1), 'le DERNIER fait ne tombe jamais');

    // Les avis : la lecture ET le marquage partagent la même fenêtre.
    for (let i = 0; i < trop(keys.NOTIF_PAGE_MAX); i += 1) {
      await repo.appendNotification({ ...AVIS, id: 'n' + i, at: t(i) });
    }
    const vus = await repo.listNotifications('roy@etude.ca');
    assert.equal(vus.length, keys.NOTIF_PAGE_MAX, 'la borne des avis ne tient pas');
    assert.equal(vus[0].id, 'n' + (trop(keys.NOTIF_PAGE_MAX) - 1), 'les plus récentes d’abord');
    assert.equal(
      await repo.markNotificationsRead('roy@etude.ca', 'toutes', t(9999)),
      keys.NOTIF_PAGE_MAX,
      'on ne marque lu que ce qu’on pouvait voir'
    );

    // Le journal par sujet.
    for (let i = 0; i < trop(keys.SUBJECT_PAGE_MAX); i += 1) {
      await repo.appendSubjectEvent({ sujet: 'roy@etude.ca', kind: 'courriel', templateKey: 'x', at: t(i), id: 'j' + i });
    }
    const envois = await repo.listSubjectEvents('roy@etude.ca');
    assert.equal(envois.length, keys.SUBJECT_PAGE_MAX, 'la borne du journal par sujet ne tient pas');
    assert.equal(envois[0].id, 'j' + (trop(keys.SUBJECT_PAGE_MAX) - 1));

    // L'index client : la fenêtre garde les dates les plus PROCHES.
    for (let i = 0; i < trop(keys.CLIENT_BID_PAGE_MAX); i += 1) {
      await repo.indexClientBid({ courriel: 'roy@etude.ca', bidId: 'b' + i, dateISO: jour(i), at: t(i) });
    }
    const offres = await repo.listClientBids('roy@etude.ca');
    assert.equal(offres.length, keys.CLIENT_BID_PAGE_MAX, 'la borne de l’index client ne tient pas');
    assert.equal(
      offres[offres.length - 1].dateISO,
      jour(trop(keys.CLIENT_BID_PAGE_MAX) - 1),
      'une personne se retrouve par ce qu’elle a de vivant'
    );

    // Et la campagne, elle, ne coupe pas : elle PAGINE — la borne y est la
    // taille d'une page, pas la fin de la liste.
    for (let i = 0; i < trop(keys.CAMPAIGN_PAGE_MAX); i += 1) {
      await repo.appendCampaignRecipient({ campagneId: 'camp-1', courriel: `d${String(i).padStart(3, '0')}@x.ca`, at: t(i) });
    }
    const page = await repo.listCampaignRecipients('camp-1');
    assert.equal(page.destinataires.length, keys.CAMPAIGN_PAGE_MAX, 'la borne de la campagne ne tient pas');
    assert.equal(typeof page.cursor, 'string', 'ce qui déborde revient par le curseur, il ne se perd pas');
    const suite = await repo.listCampaignRecipients('camp-1', { cursor: page.cursor });
    assert.equal(suite.destinataires.length, 3);
    assert.equal(suite.cursor, null);
  });
}

// ============================================================================
// 6. Groupes d’audience — quatre portes qui existaient sans être éprouvées
// ============================================================================

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : un groupe d’audience s’écrit, se relit, se liste et s’efface`, async () => {
    const repo = ouvrir();
    assert.equal(await repo.getAudienceGroup('pilote'), null);
    assert.deepEqual(await repo.listAudienceGroups(), []);

    const ecrit = await repo.putAudienceGroup(
      { id: 'pilote', libelle: 'Pilote', audience: 'notaire', nature: 'commercial', membres: [' Roy@Etude.CA ', 'lavoie@etude.ca'] },
      T0
    );
    assert.deepEqual(ecrit.membres, ['roy@etude.ca', 'lavoie@etude.ca'], 'normalisées à l’écriture');
    assert.equal(ecrit.updatedAt, T0);

    await repo.putAudienceGroup({ id: 'ajnq', libelle: 'AJNQ', audience: 'notaire', nature: 'commercial', membres: [] }, T0);
    // Deux identifiants dont l’ordre par OCTETS (celui d’une partition
    // DynamoDB) contredit celui d’une locale : « _ » vaut 0x5F, « . » 0x2E.
    await repo.putAudienceGroup({ id: 'pilote_2', libelle: 'Pilote 2', membres: [] }, T0);
    await repo.putAudienceGroup({ id: 'pilote.b', libelle: 'Pilote B', membres: [] }, T0);
    const liste = await repo.listAudienceGroups();
    assert.deepEqual(
      liste.map((g) => g.id),
      ['ajnq', 'pilote', 'pilote.b', 'pilote_2'],
      'ordonnés par identifiant, dans l’ordre de la partition — celui des octets'
    );
    assert.deepEqual(liste[0].membres, [], 'un groupe vide reste un groupe');

    assert.deepEqual(await repo.getAudienceGroup('pilote'), {
      id: 'pilote', libelle: 'Pilote', audience: 'notaire', nature: 'commercial',
      membres: ['roy@etude.ca', 'lavoie@etude.ca'], updatedAt: T0,
    });

    await repo.deleteAudienceGroup('pilote');
    assert.equal(await repo.getAudienceGroup('pilote'), null);
    assert.deepEqual(
      (await repo.listAudienceGroups()).map((g) => g.id),
      ['ajnq', 'pilote.b', 'pilote_2'],
      'l’effacement ne touche que le sien'
    );
  });
}

// ============================================================================
// 7. Index client — sans lui, une personne n’est trouvable par personne
// ============================================================================

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : les offres d’une personne se retrouvent par son adresse, en ordre de date`, async () => {
    const repo = ouvrir();
    assert.deepEqual(await repo.listClientBids('roy@etude.ca'), []);

    await repo.indexClientBid({ courriel: ' Roy@Etude.CA ', bidId: 'b2', dateISO: '2026-11-15', at: t(1) });
    await repo.indexClientBid({ courriel: 'roy@etude.ca', bidId: 'b1', dateISO: '2026-10-02', at: t(0) });
    await repo.indexClientBid({ courriel: 'autre@etude.ca', bidId: 'b3', dateISO: '2026-10-03', at: t(2) });

    const offres = await repo.listClientBids('ROY@etude.ca');
    assert.deepEqual(offres.map((o) => o.bidId), ['b1', 'b2'], 'chronologique, comme le carnet');
    assert.deepEqual(offres[0], {
      courriel: 'roy@etude.ca', bidId: 'b1', dateISO: '2026-10-02', at: t(0), ttl: keys.bidTtl('2026-10-02'),
    });
    assert.deepEqual((await repo.listClientBids('autre@etude.ca')).map((o) => o.bidId), ['b3']);
  });

  test(`${nom} : l’entrée d’index porte le ttl de l’offre — jamais un autre`, async () => {
    const repo = ouvrir();
    // Le handler connaît déjà le ttl de l’offre qu’il vient d’écrire : il le
    // passe, et l’index meurt EXACTEMENT avec elle.
    const ttlOffre = keys.bidTtl('2026-10-02');
    await repo.indexClientBid({ courriel: 'roy@etude.ca', bidId: 'b1', dateISO: '2026-10-02', at: t(0), ttl: ttlOffre });
    assert.equal((await repo.listClientBids('roy@etude.ca'))[0].ttl, ttlOffre);

    // Réindexer la même offre est sans effet de bord : l’index n’est pas un
    // journal, sa clé porte déjà l’unicité.
    await repo.indexClientBid({ courriel: 'roy@etude.ca', bidId: 'b1', dateISO: '2026-10-02', at: t(30) });
    const offres = await repo.listClientBids('roy@etude.ca');
    assert.equal(offres.length, 1);
    assert.equal(offres[0].at, t(30), 'la dernière écriture fait foi');
  });
}

// ============================================================================
// 8. Réabonnement et marque d’effacement (Loi 25)
// ============================================================================

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : un désabonnement se défait — sinon personne ne peut se réabonner`, async () => {
    const repo = ouvrir();
    assert.equal(await repo.isUnsubscribed('roy@etude.ca'), false);
    await repo.putUnsubscribe('Roy@Etude.CA', t(0));
    assert.equal(await repo.isUnsubscribed('roy@etude.ca'), true);

    await repo.deleteUnsubscribe(' ROY@etude.ca ');
    assert.equal(await repo.isUnsubscribed('roy@etude.ca'), false, 'le réabonnement est possible');
    // Effacer un désabonnement absent est un no-op, jamais une erreur.
    await repo.deleteUnsubscribe('jamais-vu@etude.ca');
  });

  test(`${nom} : l’effacement demandé laisse une marque durable`, async () => {
    const repo = ouvrir();
    assert.equal(await repo.getErasure('roy@etude.ca'), null);
    const marque = await repo.putErasure(' Roy@Etude.CA ', t(0));
    assert.deepEqual(marque, { courriel: 'roy@etude.ca', at: t(0) });
    assert.deepEqual(await repo.getErasure('ROY@etude.ca'), { courriel: 'roy@etude.ca', at: t(0) });

    await repo.putErasure('roy@etude.ca', t(60));
    assert.deepEqual(await repo.getErasure('roy@etude.ca'), { courriel: 'roy@etude.ca', at: t(60) });
    assert.equal(await repo.getErasure('autre@etude.ca'), null);
  });
}
