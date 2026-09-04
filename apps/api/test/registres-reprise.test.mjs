// CE QUE LA PARITÉ NE VOYAIT PAS : LA REPRISE, L'ORDRE ET LE SUJET.
//
// `registres-persistance.test.mjs` exige que les deux adaptateurs répondent la
// même chose. C'est une garde puissante et un angle mort : quand les DEUX se
// trompent de la même façon, elle ne dit rien. Trois défauts vivaient
// exactement là.
//
//   1. Le journal de consentement et sa projection ne sont pas atomiques, et
//      la REPRISE était un no-op : un rejeu butait sur `attribute_not_exists`,
//      rendait `false`, et la projection perdue n'était jamais réécrite. Or
//      `segments.js` ne lit QUE la projection pour décider si une adresse est
//      démarchable — la personne continuait de recevoir du commercial alors
//      que son retrait était au registre (LCAP art. 13, Loi 25 art. 8).
//   2. La projection suivait la DERNIÈRE ÉCRITURE, pas le DERNIER ÉVÉNEMENT.
//      Un rejeu tardif, un backfill ou deux Lambdas concurrentes
//      ressuscitaient un consentement retiré.
//   3. `clientNotifSubject` ne refusait rien : sans jeton, tous les clients
//      partageaient une seule boîte d'avis — l'un lisait ceux de l'autre.
//
// D'où cette suite : elle éprouve ce qu'un scénario symétrique ne peut pas
// atteindre — une écriture qui échoue, un événement qui arrive en retard, une
// clé dérivée d'un jeton absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createFakeTable } from './fake-table.mjs';

const require = createRequire(import.meta.url);
const keys = require('../src/keys.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createDynamoRepo } = require('../src/repo-dynamo.js');

const T0 = '2026-09-03T14:00:00.000Z';
const t = (min) => new Date(Date.parse(T0) + min * 60000).toISOString();

const ADAPTATEURS = [
  ['mémoire', () => createMemoryRepo()],
  ['dynamo', () => createDynamoRepo({ tableName: 'nota-main', doc: createFakeTable().doc })],
];

const OCTROI = {
  courriel: 'roy@etude.ca', audience: 'notaire', type: 'octroi', base: 'expres',
  version: 'consent-2026-09', source: 'inscription', ip: '1.2.3.4', lang: 'fr',
};
const RETRAIT = {
  courriel: 'roy@etude.ca', audience: 'notaire', type: 'retrait', base: null,
  version: 'consent-2026-09', source: 'lien-desabonnement', ip: '5.6.7.8', lang: 'en',
};

// ============================================================================
// 1. La reprise après une projection perdue
// ============================================================================

// Une table dont UNE écriture de projection casse — throttling, coupure
// réseau : ce que DynamoDB fait sous charge, et ce que la Lambda voit.
function tableCassanteSurProjection() {
  const table = createFakeTable();
  const etat = { casser: false, cassures: 0 };
  const doc = {
    async send(cmd) {
      const item = cmd.input && cmd.input.Item;
      if (etat.casser && cmd.constructor.name === 'PutCommand' && item && item.PK === keys.emailConsentPK()) {
        etat.casser = false;
        etat.cassures += 1;
        const err = new Error('Throughput exceeded');
        err.name = 'ProvisionedThroughputExceededException';
        throw err;
      }
      return table.doc.send(cmd);
    },
  };
  return { doc, etat };
}

test('dynamo : un rejeu réconcilie la projection qu’une écriture perdue a laissée en arrière', async () => {
  const { doc, etat } = tableCassanteSurProjection();
  const repo = createDynamoRepo({ tableName: 'nota-main', doc });

  assert.equal(await repo.appendConsentEvent({ ...OCTROI, at: t(0), id: 'e1' }), true);
  assert.deepEqual(await repo.getEmailConsent('roy@etude.ca'), {
    email: 'roy@etude.ca', base: 'expres', at: t(0), source: 'inscription',
  });

  // Le retrait : le journal le prend, la projection casse. L'appelant voit
  // l'erreur et rejouera — c'est tout ce qu'il peut faire.
  etat.casser = true;
  const retrait = { ...RETRAIT, at: t(10), id: 'e2' };
  await assert.rejects(() => repo.appendConsentEvent(retrait), /Throughput/);
  assert.equal(etat.cassures, 1);
  assert.deepEqual(
    (await repo.listConsentEvents('roy@etude.ca')).map((e) => e.type),
    ['octroi', 'retrait'],
    'le journal, lui, porte déjà le retrait'
  );

  // LE REJEU. Le journal refuse le doublon — et c'est correct. Mais la
  // projection, elle, doit être remise d'aplomb : sinon `segments.js`
  // démarche encore quelqu'un qui s'est retiré.
  assert.equal(await repo.appendConsentEvent(retrait), false, 'écriture unique : le journal a déjà l’événement');
  assert.deepEqual(await repo.getEmailConsent('roy@etude.ca'), {
    email: 'roy@etude.ca', base: null, at: t(10), source: 'lien-desabonnement',
  });
});

// ============================================================================
// 2. L'ordre : la projection suit le dernier ÉVÉNEMENT, pas la dernière écriture
// ============================================================================

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : un événement arrivé EN RETARD ne ressuscite pas un consentement retiré`, async () => {
    const repo = ouvrir();
    assert.equal(await repo.appendConsentEvent({ ...RETRAIT, at: t(10), id: 'e2' }), true);
    // Le rejeu tardif d'un octroi ANTÉRIEUR : un backfill, une file qui se
    // vide dans le désordre, deux Lambdas concurrentes.
    assert.equal(
      await repo.appendConsentEvent({ ...OCTROI, at: t(0), id: 'e1' }),
      true,
      'le journal prend tout : c’est une chaîne de preuve, pas un état'
    );

    assert.deepEqual(
      (await repo.listConsentEvents('roy@etude.ca')).map((e) => e.type),
      ['octroi', 'retrait'],
      'et il se relit dans l’ordre des instants, pas dans celui des écritures'
    );
    assert.deepEqual(
      await repo.getEmailConsent('roy@etude.ca'),
      { email: 'roy@etude.ca', base: null, at: t(10), source: 'lien-desabonnement' },
      'la projection porte le DERNIER FAIT — le retrait'
    );
  });

  test(`${nom} : le rejeu du dernier événement laisse la projection où elle est`, async () => {
    const repo = ouvrir();
    await repo.appendConsentEvent({ ...OCTROI, at: t(0), id: 'e1' });
    await repo.appendConsentEvent({ ...RETRAIT, at: t(10), id: 'e2' });
    assert.equal(await repo.appendConsentEvent({ ...OCTROI, at: t(0), id: 'e1' }), false);
    assert.deepEqual(await repo.getEmailConsent('roy@etude.ca'), {
      email: 'roy@etude.ca', base: null, at: t(10), source: 'lien-desabonnement',
    });
  });
}

// ============================================================================
// 3. Le sujet : sans jeton, pas de boîte
// ============================================================================

test('keys : un sujet d’avis sans jeton est REFUSÉ — deux clients ne partagent pas une boîte', () => {
  for (const vide of [undefined, null, '', '   ']) {
    assert.throws(() => keys.clientNotifSubject(vide), /jeton/i, `clientNotifSubject(${JSON.stringify(vide)})`);
    assert.throws(() => keys.notaryNotifSubject(vide), /sujet|adresse|courriel/i, `notaryNotifSubject(${JSON.stringify(vide)})`);
  }
  assert.notEqual(keys.clientNotifSubject('jeton-a'), keys.clientNotifSubject('jeton-b'));
  // Et la partition qui en découle refuse le vide de la même façon : sinon
  // `NOTIF#` seul redeviendrait la boîte commune.
  for (const vide of [undefined, null, '', '  ']) {
    assert.throws(() => keys.notifPK(vide), /sujet/i);
    assert.throws(() => keys.subjectJournalPK(vide), /sujet/i);
  }
});

test('keys : la partition d’un sujet se normalise comme toutes les autres clés d’adresse', () => {
  assert.equal(keys.notifPK(' Roy@Etude.CA '), 'NOTIF#roy@etude.ca');
  assert.equal(keys.subjectJournalPK(' Roy@Etude.CA '), 'SUJET#roy@etude.ca');
  assert.equal(keys.notifPK(keys.notaryNotifSubject('Roy@Etude.CA')), keys.notifPK('  ROY@ETUDE.ca'));
  // Un sujet client est déjà un haché minuscule : la normalisation le laisse
  // intact, elle ne doit pas le déformer.
  const client = keys.clientNotifSubject('jeton-porteur');
  assert.equal(keys.notifPK(client), 'NOTIF#' + client);
});

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : une même personne n’a qu’UNE boîte d’avis, quelle que soit la casse`, async () => {
    const repo = ouvrir();
    await repo.appendNotification({
      sujet: ' Roy@Etude.CA ', audience: 'notaire', kind: 'nouvelle_demande',
      titre: 'Une demande', corps: 'texte', at: t(0), id: 'n1',
    });
    const avis = await repo.listNotifications('roy@etude.ca');
    assert.deepEqual(avis.map((a) => a.id), ['n1'], 'écrite d’un côté, lue de l’autre');
    assert.equal(avis[0].sujet, 'roy@etude.ca', 'le sujet stocké est celui de la clé');
    assert.equal(await repo.markNotificationsRead('ROY@etude.ca', 'toutes', t(1)), 1);
    assert.equal((await repo.listNotifications(' roy@etude.ca '))[0].luLe, t(1));
  });

  test(`${nom} : le journal par sujet se range sous la même adresse normalisée`, async () => {
    const repo = ouvrir();
    await repo.appendSubjectEvent({ sujet: 'Roy@Etude.CA', kind: 'courriel', templateKey: 'a', at: t(0), id: 'j1' });
    assert.deepEqual((await repo.listSubjectEvents(' roy@etude.ca ')).map((e) => e.id), ['j1']);
    assert.equal(
      await repo.appendSubjectEvent({ sujet: 'roy@etude.ca', kind: 'courriel', templateKey: 'b', at: t(0), id: 'j1' }),
      false,
      'et le rejeu se reconnaît malgré la casse'
    );
  });
}

// ============================================================================
// 4. L'identifiant de campagne se trime des deux côtés, en lecture aussi
// ============================================================================

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : un identifiant de campagne mal cadré retrouve quand même sa partition`, async () => {
    const repo = ouvrir();
    await repo.appendCampaignRecipient({
      campagneId: ' camp-1 ', courriel: 'roy@etude.ca', templateKey: 'invitation',
      nature: 'commercial', at: t(0), statut: 'envoye',
    });
    const page = await repo.listCampaignRecipients('  camp-1  ');
    assert.deepEqual(page.destinataires.map((d) => d.courriel), ['roy@etude.ca'], 'l’écriture trime : la lecture aussi');
  });
}

// ============================================================================
// 5. Le curseur de page : même forme, et une reprise qui ne recommence pas
// ============================================================================

for (const [nom, ouvrir] of ADAPTATEURS) {
  test(`${nom} : le curseur porte la clé COMPLÈTE et reprend STRICTEMENT après elle`, async () => {
    const repo = ouvrir();
    for (const c of ['a@x.ca', 'b@x.ca', 'c@x.ca']) {
      await repo.appendCampaignRecipient({ campagneId: 'camp-1', courriel: c, at: t(0), statut: 'envoye' });
    }

    const p1 = await repo.listCampaignRecipients('camp-1', { limit: 1 });
    assert.deepEqual(p1.destinataires.map((d) => d.courriel), ['a@x.ca']);
    const clef = JSON.parse(Buffer.from(String(p1.cursor), 'base64').toString('utf8'));
    assert.deepEqual(Object.keys(clef).sort(), ['PK', 'SK'], 'la même forme des deux côtés');
    assert.equal(clef.PK, keys.campaignRecipientsPK('camp-1'));
    assert.equal(clef.SK, keys.campaignRecipientSK('a@x.ca'));

    // Une clé de reprise qui n'existe plus (ligne purgée, curseur d'une autre
    // page) doit rendre la SUITE, jamais faire repartir la liste du début —
    // sinon la boucle de l'appelant tourne sans fin sur la même page.
    const disparue = Buffer.from(
      JSON.stringify({ PK: keys.campaignRecipientsPK('camp-1'), SK: keys.campaignRecipientSK('b@x.ca') + '#purgee' }),
      'utf8'
    ).toString('base64');
    const suite = await repo.listCampaignRecipients('camp-1', { limit: 2, cursor: disparue });
    assert.deepEqual(suite.destinataires.map((d) => d.courriel), ['c@x.ca'], 'la page reprend après la clé, pas au début');
  });
}

// ============================================================================
// 6. Le double de table est un fichier texte
// ============================================================================

test('le double de table reste LISIBLE — aucun octet de contrôle', () => {
  const src = readFileSync(new URL('./fake-table.mjs', import.meta.url), 'utf8');
  const fautif = [...src].find((c) => c !== '\n' && c !== '\t' && c.codePointAt(0) < 0x20);
  assert.equal(
    fautif,
    undefined,
    'un octet de contrôle fait classer le fichier BINAIRE par git : invisible en diff, non fusionnable, illisible au grep'
  );
});

// ============================================================================
// 7. Rétentions et bornes : des valeurs, pas des constantes gravées
// ============================================================================

test('les rétentions et les bornes de page se surchargent par l’environnement', () => {
  const chemin = require.resolve('../src/keys.js');
  const avant = {
    NOTA_NOTIF_RETENTION_DAYS: process.env.NOTA_NOTIF_RETENTION_DAYS,
    NOTA_NOTIF_PAGE_MAX: process.env.NOTA_NOTIF_PAGE_MAX,
  };
  const restaurer = () => {
    for (const [k, v] of Object.entries(avant)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[chemin];
    require(chemin);
  };

  try {
    process.env.NOTA_NOTIF_RETENTION_DAYS = '30';
    process.env.NOTA_NOTIF_PAGE_MAX = '7';
    delete require.cache[chemin];
    const surcharge = require(chemin);
    assert.equal(surcharge.NOTIF_RETENTION_DAYS, 30);
    assert.equal(surcharge.NOTIF_PAGE_MAX, 7);
    assert.equal(surcharge.notifTtl(T0), Math.floor(Date.parse(T0) / 1000) + 30 * 86400);

    // Une surcharge illisible ne casse pas le déploiement : elle est ignorée.
    process.env.NOTA_NOTIF_RETENTION_DAYS = 'beaucoup';
    process.env.NOTA_NOTIF_PAGE_MAX = '-3';
    delete require.cache[chemin];
    const abime = require(chemin);
    assert.equal(abime.NOTIF_RETENTION_DAYS, 180, 'le défaut du dépôt tient');
    assert.equal(abime.NOTIF_PAGE_MAX, 50);
  } finally {
    restaurer();
  }
});
