// LE REGISTRE DE CONSENTEMENT — CE QU'IL DOIT PORTER, ET CE QU'IL NE DOIT
// JAMAIS RÉÉCRIRE.
//
// Trois défauts, tous trouvés DERRIÈRE une suite verte, tous du même genre :
// une garantie annoncée par un module que personne n'appelle, ou qu'un autre
// chemin contredit en silence.
//
//   1. LE RETRAIT N'ENTRAIT PAS AU REGISTRE. `notifier.unsubscribe()` — la
//      seule porte instrumentée — n'avait AUCUN appelant en production : la
//      route publique `GET|POST /unsubscribe` écrivait `repo.putUnsubscribe`
//      directement. Le registre ne recevait donc que des OCTROIS, et se
//      trompait uniformément sur quiconque s'était retiré. Le remède qu'un
//      commentaire proposait — `notifier().unsubscribe(email)` — était pire que
//      le mal : `notifier()` rend `null` tant que `NOTA_FROM_EMAIL` n'est pas
//      configuré, ce qui EST la configuration de production d'aujourd'hui. Le
//      retrait doit s'écrire que l'expéditeur soit câblé ou non.
//
//   2. LE CONSENTEMENT RESSUSCITAIT. Après un retrait, redemander un simple
//      lien de connexion réécrivait un octroi TACITE par-dessus : la projection
//      que `segments.js` lit repassait à « consentant » pendant que la liste de
//      suppression, elle, disait toujours l'inverse. Aucun courriel ne fuyait
//      (l'exclusion des désabonnés tient), mais `garde.consentement =
//      'registre'` affirmait alors le contraire de la vérité sur cette
//      personne. La règle est fermée : une base TACITE n'écrase JAMAIS un
//      retrait ; seul un consentement EXPRÈS rétablit la relation.
//
//   3. LA REPRISE POUVAIT CORROMPRE. La réconciliation prend le DERNIER
//      événement du journal, c'est-à-dire la plus grande clé de tri `<at>#<id>`.
//      À instant égal, l'ordre retombait sur le NOM DU GESTE — et
//      « inscription_client » passe après « desabonnement » dans l'ordre des
//      octets. Rejouer un retrait avec une horloge figée reprojetait donc
//      l'OCTROI par-dessus le RETRAIT. Une horloge de production rend la
//      collision improbable ; les horloges de ce dépôt, elles, sont figées par
//      construction — et une reprise qui peut corrompre pointe dans le mauvais
//      sens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { encodeUnsubToken, createNotifier, createConsentRegistry } = require('../src/notifications.js');
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const TODAY = '2026-09-04';
const START = Date.parse('2026-09-04T14:00:00.000Z');
const NOW_ISO = new Date(START).toISOString();

// L'application publique telle qu'elle tourne AUJOURD'HUI en production : sans
// `NOTA_FROM_EMAIL`, donc sans notifieur. C'est exactement la configuration où
// le remède proposé par le commentaire aurait levé ou n'aurait rien fait.
function publique() {
  const repo = createMemoryRepo([]);
  const app = createApp(repo, { now: () => TODAY, nowMs: () => START });
  return { repo, app };
}
const retirer = (app, email, method = 'GET') =>
  app.handle({ method, path: '/unsubscribe', query: { token: encodeUnsubToken(email) }, headers: {}, body: method === 'POST' ? '' : undefined });

// Le notifieur, horloge injectée : les instants sont ceux que le test décide.
function notifieur({ repo = createMemoryRepo([]), at = () => NOW_ISO, consentement } = {}) {
  const envoyes = [];
  const notifier = createNotifier({
    repo,
    mailer: { send: async (m) => { envoyes.push(m); } },
    now: at,
    baseUrl: 'https://nota.test',
    apiBaseUrl: 'https://api.nota.test',
    operatorEmail: 'ops@nota.ca',
    consentement,
  });
  return { repo, notifier, envoyes };
}

// ---------------------------------------------------------------------------
// 1. LE RETRAIT ENTRE AU REGISTRE — SANS EXPÉDITEUR CONFIGURÉ
// ---------------------------------------------------------------------------

test('la route publique de retrait ÉCRIT le retrait au registre, expéditeur câblé ou non', async () => {
  assert.equal(process.env.NOTA_FROM_EMAIL, undefined,
    'ce test vaut pour la configuration de production d’aujourd’hui : aucun expéditeur');
  const { repo, app } = publique();
  const res = await retirer(app, 'Client@Exemple.CA');
  assert.equal(res.statusCode, 200, res.body);

  // La garde opérationnelle, d'abord : elle est ce que `sendOnce` LIT.
  assert.equal(await repo.isUnsubscribed('client@exemple.ca'), true);

  // La PREUVE, ensuite : elle est ce que la LCAP art. 13 exige.
  const journal = await repo.listConsentEvents('client@exemple.ca');
  assert.equal(journal.length, 1, JSON.stringify(journal));
  assert.equal(journal[0].type, 'retrait');
  assert.equal(journal[0].base, null, 'un retrait ne porte aucune base : il en éteint une');
  assert.equal(journal[0].source, 'desabonnement');
  assert.equal(journal[0].courriel, 'client@exemple.ca', 'l’adresse est normalisée comme la suppression');
  // L'INSTANT, pas le jour ouvrable. La clé de tri du journal est `<at>#<id>` :
  // un « 2026-09-04 » se rangerait AVANT tout octroi horodaté du même jour, et
  // la projection retomberait sur l'octroi.
  assert.match(journal[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'l’instant du retrait est un instant');

  // Et la projection que `segments.js` lit dit le retrait.
  const etat = await repo.getEmailConsent('client@exemple.ca');
  assert.equal(etat.base, null);
  assert.equal(etat.source, 'desabonnement');
});

test('le retrait un-clic (RFC 8058, POST) écrit la même preuve que le lien', async () => {
  const { repo, app } = publique();
  assert.equal((await retirer(app, 'autre@exemple.ca', 'POST')).statusCode, 200);
  const journal = await repo.listConsentEvents('autre@exemple.ca');
  assert.equal(journal.length, 1);
  assert.equal(journal[0].type, 'retrait');
});

test('un jeton forgé n’écrit NI suppression NI retrait — la preuve ne se fabrique pas', async () => {
  const { repo, app } = publique();
  const forge = Buffer.from('victime@exemple.ca', 'utf8').toString('base64url');
  const res = await app.handle({ method: 'GET', path: '/unsubscribe', query: { token: forge }, headers: {} });
  assert.equal(res.statusCode, 400);
  assert.equal(await repo.isUnsubscribed('victime@exemple.ca'), false);
  assert.deepEqual(await repo.listConsentEvents('victime@exemple.ca'), []);
});

test('un registre en panne ne retient pas le retrait — la suppression passe d’abord', async () => {
  const { repo, app } = publique();
  repo.appendConsentEvent = async () => { throw new Error('DynamoDB down'); };
  const res = await retirer(app, 'client@exemple.ca');
  assert.equal(res.statusCode, 200, 'la personne obtient son retrait, quoi qu’il arrive au registre');
  assert.equal(await repo.isUnsubscribed('client@exemple.ca'), true);
});

// ---------------------------------------------------------------------------
// 2. UN CONSENTEMENT TACITE NE RESSUSCITE PAS UN RETRAIT
// ---------------------------------------------------------------------------

test('après un retrait, redemander un lien de connexion ne réécrit AUCUN octroi tacite', async () => {
  let ms = START;
  const { repo, notifier } = notifieur({ at: () => new Date(ms).toISOString() });

  await notifier.onClientSignup('client@exemple.ca');
  ms += 60_000;
  await notifier.unsubscribe('client@exemple.ca');
  ms += 60_000;
  // Le geste qui ressuscitait : la personne revient et laisse son adresse.
  await notifier.onClientSignup('client@exemple.ca');

  const journal = await repo.listConsentEvents('client@exemple.ca');
  assert.equal(journal.length, 2, 'le tacite d’après le retrait n’entre pas au journal : ' + JSON.stringify(journal));
  assert.equal(journal[journal.length - 1].type, 'retrait', 'le dernier fait reste le retrait');

  const etat = await repo.getEmailConsent('client@exemple.ca');
  assert.equal(etat.base, null, 'la projection que segments.js lit ne redevient PAS consentante');
  assert.equal(await repo.isUnsubscribed('client@exemple.ca'), true,
    'et la suppression, elle, n’a jamais bougé — les deux disent enfin la même chose');
});

test('une offre publiée après un retrait ne rétablit pas davantage la base tacite', async () => {
  let ms = START;
  const { repo, notifier } = notifieur({ at: () => new Date(ms).toISOString() });
  await notifier.unsubscribe('acheteur@exemple.ca');
  ms += 60_000;
  await notifier.onOfferCreated({
    id: 'b1', courriel: 'acheteur@exemple.ca', montant: 1800, serviceId: 'financement',
    dateISO: '2026-10-01', status: 'OUVERTE',
  });
  const journal = await repo.listConsentEvents('acheteur@exemple.ca');
  assert.deepEqual(journal.map((e) => e.type), ['retrait']);
  assert.equal((await repo.getEmailConsent('acheteur@exemple.ca')).base, null);
});

test('seul un consentement EXPRÈS rétablit la relation après un retrait', async () => {
  let ms = START;
  const { repo, notifier } = notifieur({
    at: () => new Date(ms).toISOString(),
    // Rien ici n'est une loi de la nature : un déploiement déclare ses gestes.
    consentement: { gestes: { reabonnement: { type: 'octroi', audience: 'client', base: 'expres' } } },
  });
  await notifier.onClientSignup('client@exemple.ca');
  ms += 60_000;
  await notifier.unsubscribe('client@exemple.ca');
  ms += 60_000;
  await notifier.noterConsentement('reabonnement', 'client@exemple.ca');

  const journal = await repo.listConsentEvents('client@exemple.ca');
  assert.equal(journal.length, 3, JSON.stringify(journal));
  assert.equal(journal[journal.length - 1].source, 'reabonnement');
  const etat = await repo.getEmailConsent('client@exemple.ca');
  assert.equal(etat.base, 'expres', 'un OUI exprès, lui, se réinscrit — c’est la personne qui l’a redonné');
});

test('un octroi tacite passe normalement quand aucun retrait ne court', async () => {
  const { repo, notifier } = notifieur();
  await notifier.onClientSignup('neuf@exemple.ca');
  const journal = await repo.listConsentEvents('neuf@exemple.ca');
  assert.equal(journal.length, 1);
  assert.equal(journal[0].base, 'tacite');
});

test('un dépôt qui ne sait pas dire le retrait ne fabrique pas un octroi tacite : on ferme', async () => {
  const repo = createMemoryRepo([]);
  // La liste de suppression répond (c'est elle que `sendOnce` lit, et un
  // courriel ne doit jamais tomber pour un problème de PREUVE) ; c'est la
  // projection du registre qui est muette.
  repo.getEmailConsent = async () => { throw new Error('DynamoDB down'); };
  const { notifier, envoyes } = notifieur({ repo });
  const r = await notifier.onClientSignup('client@exemple.ca');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(await repo.listConsentEvents('client@exemple.ca'), [],
    'faute de pouvoir vérifier, on n’écrit pas un octroi qu’un retrait contredirait peut-être');
  assert.equal(envoyes.length, 1, 'et le message part quand même — la preuve se répare, un avis manqué non');
});

// ---------------------------------------------------------------------------
// 3. À INSTANT ÉGAL, LE RETRAIT L'EMPORTE
// ---------------------------------------------------------------------------

test('horloge figée : la reprise du journal ne reprojette JAMAIS l’octroi par-dessus le retrait', async () => {
  // Tous les événements au même instant — ce que fait toute horloge épinglée.
  const { repo, notifier } = notifieur({ at: () => NOW_ISO });
  await notifier.onClientSignup('client@exemple.ca');
  await notifier.unsubscribe('client@exemple.ca');

  const journal = await repo.listConsentEvents('client@exemple.ca');
  assert.equal(journal.length, 2, JSON.stringify(journal));
  assert.equal(journal[journal.length - 1].type, 'retrait',
    'à instant égal, le RETRAIT est le dernier fait du journal — pas le nom du geste');

  const octroi = journal.find((e) => e.type === 'octroi');
  // LE REJEU : une tentative précédente qui s'était arrêtée en chemin revient.
  // La reprise réconcilie depuis le dernier événement du journal.
  assert.equal(await repo.appendConsentEvent(octroi), false, 'écriture unique : le journal refuse le doublon');
  const etat = await repo.getEmailConsent('client@exemple.ca');
  assert.equal(etat.base, null, 'la reprise répare — elle ne ressuscite pas');
  assert.equal(etat.source, 'desabonnement');
});

// ---------------------------------------------------------------------------
// 4. LA PORTE, SANS EXPÉDITEUR
// ---------------------------------------------------------------------------

test('createConsentRegistry écrit le retrait sans mailer — c’est ce qui rend la route possible', async () => {
  const repo = createMemoryRepo([]);
  const registre = createConsentRegistry({ repo, now: () => NOW_ISO });
  const out = await registre.enregistrerRetrait('Client@Exemple.CA');
  assert.deepEqual(out, { ok: true, email: 'client@exemple.ca' });
  assert.equal(await repo.isUnsubscribed('client@exemple.ca'), true);
  assert.equal((await repo.listConsentEvents('client@exemple.ca'))[0].type, 'retrait');
});

test('le notifieur et la porte nue écrivent EXACTEMENT le même fait', async () => {
  const a = createMemoryRepo([]);
  const b = createMemoryRepo([]);
  await createConsentRegistry({ repo: a, now: () => NOW_ISO }).enregistrerRetrait('x@exemple.ca');
  const { notifier } = notifieur({ repo: b, at: () => NOW_ISO });
  await notifier.unsubscribe('x@exemple.ca');
  const [ea] = await a.listConsentEvents('x@exemple.ca');
  const [eb] = await b.listConsentEvents('x@exemple.ca');
  assert.deepEqual(ea, eb, 'deux chemins, un seul fait — sinon la preuve dépend de qui l’écrit');
});
