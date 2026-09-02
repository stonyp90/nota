// ÉCRIRE À QUELQU'UN, ET POUVOIR LE JUSTIFIER APRÈS COUP.
//
// `segments.js` résolvait déjà une audience — et personne ne l'appelait : il
// déclarait cinq méthodes de dépôt qui n'existaient nulle part, et aucune porte
// admin ne s'en servait. Cette suite tient les deux bouts qui manquaient.
//
// Trois textes commandent ce qui suit, et chacun a son test :
//
//   • **LCAP** (L.C. 2010, ch. 23, art. 6 et 10) — un message COMMERCIAL exige
//     une base de consentement. La garde vit dans `segments.js` ; ce qu'on
//     éprouve ici, c'est que la ROUTE ne la contourne pas.
//   • **Art. 56 1° C.déont.** — inciter « de façon pressante ou répétée » est
//     dérogatoire. Le plafond de fréquence est la réponse produit ; il ne vaut
//     que si l'envoi ÉCRIT dans le registre (`markCampaignSent`). Un envoi qui
//     n'écrit rien rend la garde décorative, alors on l'éprouve en envoyant
//     deux fois.
//   • **Art. 68 C.déont.** — un gabarit TRANSACTIONNEL est le seul avis d'un
//     fait que son destinataire a le droit de connaître ; le détourner en
//     réclame est refusé.
//
// Le dépôt ne fait AUCUN Scan, et ce n'est pas une question de coût : un Scan
// élargirait la permission IAM de la Lambda admin à toute la table client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createDynamoRepo } = require('../src/repo-dynamo.js');
const keys = require('../src/keys.js');
const segments = require('../src/segments.js');
const emails = require('../src/emails.js');
const authDefaults = require('../src/admin-auth.js');

const TODAY = '2026-09-02';
const START = Date.parse('2026-09-02T14:00:00.000Z');
const NOW_ISO = new Date(START).toISOString();
const AUDIT_DAY = NOW_ISO.slice(0, 10);
const parse = (res) => JSON.parse(res.body);

const ilYA = (jours) => new Date(START - jours * 86400000).toISOString();

// Un notaire joignable et sous contrat : actif et connecté à Stripe, donc
// porteur d'un consentement TACITE au sens de l'art. 10(10) LCAP.
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

// Le port d'envoi. `notifications.js` en est la SEULE implémentation : la
// console admin n'ouvre pas un second chemin d'envoi, elle appelle celui-là.
function faussierNotifier({ echoue = () => false } = {}) {
  const envoyes = [];
  return {
    envoyes,
    async sendCampaign({ to, templateKey, ctx }) {
      if (echoue(to)) return { sent: false, reason: 'unsubscribed' };
      envoyes.push({ to, templateKey, ctx });
      return { sent: true, to };
    },
  };
}

function make({ notifier = faussierNotifier(), ...config } = {}) {
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
  const call = (method, path, { body, bearer } = {}) =>
    app.handle({
      method,
      path,
      query: {},
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

// Un analyste : `analytics:read` et rien d'autre — surtout pas `campaigns:send`.
async function loginAnalyste(h) {
  await h.repo.putAdmin({
    id: authDefaults.adminIdForEmail('analyste@nota.ca'),
    email: 'analyste@nota.ca',
    role: 'analyst',
    disabled: false,
    createdAt: NOW_ISO,
  });
  return login(h, 'analyste@nota.ca');
}

// ============================================================================
// 1. Les clés
// ============================================================================

test('les trois familles de clés tiennent chacune dans UNE partition nommée', () => {
  assert.equal(keys.audienceGroupsPK(), 'AUDIENCE#GROUPES');
  assert.equal(keys.audienceGroupSK('pilote'), 'GROUP#pilote');

  // L'adresse est la clé de tri, minusculisée : une recherche ne doit pas
  // dépendre de la casse que l'opérateur a tapée.
  assert.equal(keys.campaignLogPK(), 'CAMPAGNE#ENVOIS');
  assert.equal(keys.campaignLogSK('Roy@Etude.TEST '), 'EMAIL#roy@etude.test');
  assert.equal(keys.emailConsentPK(), 'CONSENT#COURRIEL');
  assert.equal(keys.emailConsentSK(' ROY@etude.test'), 'EMAIL#roy@etude.test');
});

test('un groupe d’AUDIENCE n’est pas un groupe RBAC : deux partitions, deux tables', async () => {
  const sent = [];
  const doc = { async send(cmd) { sent.push({ name: cmd.constructor.name, input: cmd.input }); return {}; } };
  const repo = createDynamoRepo({ tableName: 'main', adminTableName: 'admin', doc });

  await repo.putGroup({ id: 'support', nom: 'Soutien', permissions: ['users:read'] }, NOW_ISO);
  await repo.putAudienceGroup({ id: 'support', libelle: 'Pilote', membres: ['a@b.ca'] }, NOW_ISO);

  const [rbacPut, audiencePut] = sent.filter((s) => s.name === 'PutCommand');
  assert.equal(rbacPut.input.TableName, 'admin', 'les permissions vivent avec les identités');
  assert.equal(rbacPut.input.Item.PK, 'GROUPS');
  assert.equal(audiencePut.input.TableName, 'main', 'une liste de destinataires vit avec les données client');
  assert.equal(audiencePut.input.Item.PK, 'AUDIENCE#GROUPES');
  assert.notEqual(rbacPut.input.Item.PK, audiencePut.input.Item.PK, 'confondre les deux serait un vrai bogue');
});

// ============================================================================
// 2. Les cinq méthodes de dépôt, sur les DEUX adaptateurs
// ============================================================================

test('memory : un groupe d’audience fait l’aller-retour et se liste', async () => {
  const repo = createMemoryRepo();
  assert.equal(await repo.getAudienceGroup('pilote'), null);
  assert.deepEqual(await repo.listAudienceGroups(), []);

  const g = await repo.putAudienceGroup(
    { id: 'pilote', libelle: 'Pilote 198.1', audience: 'notaire', nature: 'commercial', membres: ['Roy@Etude.test', 'lavoie@etude.test'] },
    NOW_ISO
  );
  assert.equal(g.updatedAt, NOW_ISO);
  assert.deepEqual(g.membres, ['roy@etude.test', 'lavoie@etude.test'], 'les adresses sont normalisées à l’écriture');

  const relu = await repo.getAudienceGroup('pilote');
  assert.equal(relu.libelle, 'Pilote 198.1');
  assert.equal(relu.audience, 'notaire');
  assert.equal((await repo.listAudienceGroups()).length, 1);
  await repo.deleteAudienceGroup('pilote');
  assert.equal(await repo.getAudienceGroup('pilote'), null);
});

test('memory : le registre des campagnes garde UN item par adresse, écrasé', async () => {
  const repo = createMemoryRepo();
  assert.equal(await repo.lastCampaignAt('roy@etude.test'), null);

  await repo.markCampaignSent('Roy@Etude.test', ilYA(30), 'camp-1');
  assert.equal(await repo.lastCampaignAt('roy@etude.test'), ilYA(30));
  await repo.markCampaignSent('roy@etude.test', NOW_ISO, 'camp-2');
  assert.equal(await repo.lastCampaignAt('ROY@etude.test'), NOW_ISO, 'écrasé, pas empilé');

  const many = await repo.lastCampaignAtMany(['roy@etude.test', 'inconnu@etude.test']);
  assert.deepEqual(many, { 'roy@etude.test': NOW_ISO, 'inconnu@etude.test': null });
});

test('memory : le consentement se stocke et se relit tel quel', async () => {
  const repo = createMemoryRepo();
  assert.equal(await repo.getEmailConsent('roy@etude.test'), null);
  await repo.putEmailConsent('Roy@Etude.test', { base: 'expres', at: NOW_ISO, source: 'inscription' });
  assert.deepEqual(await repo.getEmailConsent('roy@etude.test'), {
    email: 'roy@etude.test', base: 'expres', at: NOW_ISO, source: 'inscription',
  });
});

test('dynamo : aucune de ces portes ne Scanne — Get, Put, Query, BatchGet, rien d’autre', async () => {
  const sent = [];
  const doc = {
    async send(cmd) {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      if (cmd.constructor.name === 'BatchGetCommand') {
        return { Responses: { main: [{ PK: 'CAMPAGNE#ENVOIS', SK: 'EMAIL#roy@etude.test', email: 'roy@etude.test', at: NOW_ISO }] } };
      }
      return {};
    },
  };
  const repo = createDynamoRepo({ tableName: 'main', doc });

  await repo.markCampaignSent('Roy@Etude.test', NOW_ISO, 'camp-1');
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.Item.PK, 'CAMPAGNE#ENVOIS');
  assert.equal(put.input.Item.SK, 'EMAIL#roy@etude.test');
  assert.equal(put.input.Item.campagneId, 'camp-1');

  // La porte préférée : UNE lecture par campagne, bornée par l'audience —
  // jamais par l'historique de tout ce que Nota a déjà écrit.
  const many = await repo.lastCampaignAtMany(['roy@etude.test', 'muet@etude.test']);
  assert.deepEqual(many, { 'roy@etude.test': NOW_ISO, 'muet@etude.test': null });
  const batch = sent.find((s) => s.name === 'BatchGetCommand');
  assert.ok(batch, 'une seule requête pour toute l’audience');
  assert.equal(batch.input.RequestItems.main.Keys.length, 2);

  await repo.getEmailConsent('roy@etude.test');
  await repo.putEmailConsent('roy@etude.test', { base: 'expres', at: NOW_ISO, source: 'inscription' });
  await repo.getAudienceGroup('pilote');
  await repo.listAudienceGroups();

  assert.deepEqual(
    [...new Set(sent.map((s) => s.name))].sort(),
    ['BatchGetCommand', 'GetCommand', 'PutCommand', 'QueryCommand'],
    'aucun ScanCommand : la Lambda admin n’a pas — et ne doit pas avoir — cette permission'
  );
});

test('dynamo : un lot inachevé est repris, jamais perdu en silence', async () => {
  let tour = 0;
  const doc = {
    async send() {
      tour += 1;
      if (tour === 1) {
        return {
          Responses: { main: [{ SK: 'EMAIL#a@b.ca', email: 'a@b.ca', at: NOW_ISO }] },
          UnprocessedKeys: { main: { Keys: [{ PK: 'CAMPAGNE#ENVOIS', SK: 'EMAIL#c@d.ca' }] } },
        };
      }
      return { Responses: { main: [{ SK: 'EMAIL#c@d.ca', email: 'c@d.ca', at: ilYA(2) }] } };
    },
  };
  const repo = createDynamoRepo({ tableName: 'main', doc });
  const many = await repo.lastCampaignAtMany(['a@b.ca', 'c@d.ca']);
  assert.deepEqual(many, { 'a@b.ca': NOW_ISO, 'c@d.ca': ilYA(2) });
});

// ============================================================================
// 3. Le catalogue des segments
// ============================================================================

test('GET /admin/segments — le catalogue est une donnée, dans les deux langues', async () => {
  const h = make();
  const s = await login(h);
  const res = await h.call('GET', '/admin/segments', { bearer: s });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);

  assert.equal(body.ok, true);
  assert.equal(body.segments.length, segments.SEGMENTS.length, 'publié == appliqué');
  for (const seg of body.segments) {
    assert.ok(seg.id && seg.libelle && seg.libelleEn, seg.id);
    assert.notEqual(seg.libelle, seg.libelleEn, seg.id + ' : deux langues, pas une copie');
    assert.ok(seg.vise.length > 20, seg.id);
    assert.ok(['notaire', 'client'].includes(seg.audience), seg.id);
    assert.ok(['commercial', 'transactionnel'].includes(seg.nature), seg.id);
    assert.ok(Array.isArray(seg.params), seg.id + ' : les seuils sont une LISTE, pas un objet à deviner');
    for (const p of seg.params) {
      assert.equal(typeof p.nom, 'string');
      assert.ok(p.min <= p.defaut && p.defaut <= p.max, seg.id + '.' + p.nom);
    }
  }
  // La console ne code aucun identifiant en dur : elle lit celui-ci.
  assert.ok(body.segments.some((x) => x.id === 'notaires_silencieux'));
});

test('GET /admin/segments — sans session, rien ; avec `analytics:read`, tout', async () => {
  const h = make();
  assert.equal((await h.call('GET', '/admin/segments')).statusCode, 401);
  const analyste = await loginAnalyste(h);
  assert.equal((await h.call('GET', '/admin/segments', { bearer: analyste })).statusCode, 200);
});

// ============================================================================
// 4. La prévisualisation — elle compte, elle ne prépare rien d'envoyable
// ============================================================================

test('POST /admin/campaigns/preview — le décompte, les exclusions, un échantillon MASQUÉ', async () => {
  const h = make();
  for (const n of [
    notaire('parti', { lastSeenAt: ilYA(45) }),
    notaire('sorti', { lastSeenAt: ilYA(60) }),
    notaire('present'),
  ]) await h.repo.putNotary(n);
  await h.repo.putUnsubscribe('sorti@etude.test', NOW_ISO);

  const s = await login(h);
  const res = await h.call('POST', '/admin/campaigns/preview', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'notaryDisconnectedWinback' },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);

  assert.equal(body.ok, true);
  assert.equal(body.total, 1, 'le silencieux, moins le désabonné');
  assert.equal(body.nature, 'commercial');
  assert.equal(body.exclus.desabonnes, 1);
  for (const cle of ['desabonnes', 'sansConsentement', 'frequence', 'doublons', 'sansCourriel']) {
    assert.equal(typeof body.exclus[cle], 'number', 'exclusion détaillée : ' + cle);
  }
  assert.equal(typeof body.plafond.limite, 'number');
  assert.equal(body.plafond.depasse, false);
  assert.ok(Array.isArray(body.avertissements));

  assert.equal(body.echantillon.length, 1);
  assert.match(body.echantillon[0], /•/, 'reconnaissable, pas expédiable');
  assert.doesNotMatch(body.echantillon[0], /parti@/, 'une prévisualisation n’est pas une liste d’envoi');
  assert.match(body.echantillon[0], /45 j/, 'la raison porte la MESURE, pas l’étiquette');
});

test('POST /admin/campaigns/preview — un essai à blanc n’envoie rien et n’écrit rien', async () => {
  const h = make();
  await h.repo.putNotary(notaire('parti', { lastSeenAt: ilYA(45) }));
  const s = await login(h);

  await h.call('POST', '/admin/campaigns/preview', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'notaryDisconnectedWinback' },
  });

  assert.deepEqual(h.notifier.envoyes, []);
  assert.equal(await h.repo.lastCampaignAt('parti@etude.test'), null, 'prévisualiser ne consomme pas le quota du destinataire');
});

test('POST /admin/campaigns/preview — les avertissements se lisent AVANT l’envoi, pas dans un courriel déjà parti', async () => {
  const h = make();
  await h.repo.putNotary(notaire('parti', { lastSeenAt: ilYA(45) }));
  const s = await login(h);

  // `evaluationInvite` s'adresse au CLIENT et interpole montant/service/date :
  // une campagne ne part d'aucune offre et ne peut renseigner aucun des trois.
  const body = parse(await h.call('POST', '/admin/campaigns/preview', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'evaluationInvite' },
  }));

  assert.equal(body.avertissements.length, 2);
  assert.ok(body.avertissements.some((a) => /s’adresse à « client »/.test(a)), body.avertissements.join(' | '));
  assert.ok(body.avertissements.some((a) => /\{\{montant\}\}/.test(a)), body.avertissements.join(' | '));

  // Un gabarit sans jeton hors de portée n'invente pas d'avertissement.
  const propre = parse(await h.call('POST', '/admin/campaigns/preview', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'notaryDisconnectedWinback' },
  }));
  assert.deepEqual(propre.avertissements, []);
});

test('POST /admin/campaigns/preview — un segment inconnu est refusé, typé', async () => {
  const h = make();
  const s = await login(h);
  const res = await h.call('POST', '/admin/campaigns/preview', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'inexistant' }, templateKey: 'notaryDisconnectedWinback' },
  });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(parse(res).errors[0].code, 'segment_inconnu');
});

test('POST /admin/campaigns/preview — un gabarit hors registre est refusé', async () => {
  const h = make();
  const s = await login(h);
  const res = await h.call('POST', '/admin/campaigns/preview', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'nexistepas' },
  });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(parse(res).errors[0].code, 'modele_inconnu');
});

// ============================================================================
// 5. L'envoi
// ============================================================================

test('POST /admin/campaigns — envoie par notifications.js, marque le registre, journalise', async () => {
  const h = make();
  await h.repo.putNotary(notaire('parti', { lastSeenAt: ilYA(45) }));
  await h.repo.putNotary(notaire('present'));
  const s = await login(h);

  const res = await h.call('POST', '/admin/campaigns', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'notaryDisconnectedWinback' },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.equal(body.ok, true);
  assert.equal(body.envoyes, 1);
  assert.ok(body.campagneId, 'la campagne porte un identifiant : sans lui, l’audit ne désigne rien');
  assert.equal(typeof body.exclus.frequence, 'number');

  assert.deepEqual(h.notifier.envoyes.map((e) => e.to), ['parti@etude.test']);
  assert.equal(h.notifier.envoyes[0].templateKey, 'notaryDisconnectedWinback');

  // Art. 56 1° : sans cette écriture, le plafond de fréquence ne veut rien dire.
  assert.equal(await h.repo.lastCampaignAt('parti@etude.test'), NOW_ISO);

  const journal = await h.repo.queryAuditByDay(AUDIT_DAY);
  const entree = journal.find((e) => e.action === 'campagne_envoyee');
  assert.ok(entree, 'une campagne non journalisée est un envoi que personne ne peut auditer');
  assert.equal(entree.email, 'ops@nota.ca', 'QUI');
  assert.equal(entree.meta.campagneId, body.campagneId);
  assert.equal(entree.meta.templateKey, 'notaryDisconnectedWinback');
  assert.equal(entree.meta.envoyes, 1);
  assert.equal(entree.meta.nature, 'commercial');
  assert.deepEqual(entree.meta.audience, [{ type: 'segment', segmentId: 'notaires_silencieux' }], 'QUELLE audience');
  assert.equal(typeof entree.meta.exclus.desabonnes, 'number', 'COMBIEN d’exclus, et pourquoi');
});

test('ART. 56 1° — la même personne n’est pas relancée deux fois dans la fenêtre', async () => {
  const h = make();
  await h.repo.putNotary(notaire('parti', { lastSeenAt: ilYA(45) }));
  const s = await login(h);
  const corps = {
    audience: { type: 'segment', segmentId: 'notaires_silencieux' },
    templateKey: 'notaryDisconnectedWinback',
  };

  const un = parse(await h.call('POST', '/admin/campaigns', { bearer: s, body: corps }));
  assert.equal(un.envoyes, 1);

  const deux = parse(await h.call('POST', '/admin/campaigns', { bearer: s, body: corps }));
  assert.equal(deux.envoyes, 0, 'le registre écrit au premier envoi ferme le second');
  assert.equal(deux.exclus.frequence, 1);
  assert.equal(h.notifier.envoyes.length, 1, 'un seul courriel est réellement parti');
});

test('LCAP — sans base de consentement, la route n’écrit pas : la garde n’est pas contournable', async () => {
  const h = make();
  // Ni contrat en cours (pas de compte Connect), ni candidature récente.
  await h.repo.putNotary(
    notaire('perdu', { status: 'restricted', chargesEnabled: false, connectAccountId: null, lastSeenAt: ilYA(45), createdAt: ilYA(900) })
  );
  await h.repo.putNotary(notaire('encours', { lastSeenAt: ilYA(45) }));
  const s = await login(h);

  const body = parse(await h.call('POST', '/admin/campaigns', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'notaryDisconnectedWinback' },
  }));

  assert.equal(body.envoyes, 1);
  assert.equal(body.exclus.sansConsentement, 1);
  assert.deepEqual(h.notifier.envoyes.map((e) => e.to), ['encours@etude.test']);
});

test('ART. 68 — un gabarit transactionnel ne peut pas servir de réclame', async () => {
  const h = make();
  await h.repo.putNotary(notaire('parti', { lastSeenAt: ilYA(45) }));
  const s = await login(h);

  assert.equal(emails.TEMPLATE_META.offerRetained.transactionnel, true);
  const res = await h.call('POST', '/admin/campaigns', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'offerRetained' },
  });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(parse(res).errors[0].code, 'gabarit_transactionnel');
  assert.deepEqual(h.notifier.envoyes, [], 'refusé AVANT tout envoi');
});

test('le plafond de taille exige une confirmation explicite — 409, puis passage', async () => {
  const h = make({ campagnePlafond: 1 });
  await h.repo.putNotary(notaire('parti', { lastSeenAt: ilYA(45) }));
  await h.repo.putNotary(notaire('sorti', { lastSeenAt: ilYA(60) }));
  const s = await login(h);
  const corps = {
    audience: { type: 'segment', segmentId: 'notaires_silencieux' },
    templateKey: 'notaryDisconnectedWinback',
  };

  const refus = await h.call('POST', '/admin/campaigns', { bearer: s, body: corps });
  assert.equal(refus.statusCode, 409, refus.body);
  const err = parse(refus).errors[0];
  assert.equal(err.code, 'confirmation_requise');
  assert.equal(err.total, 2, 'on refuse en disant COMBIEN, jamais en cachant combien');
  assert.deepEqual(h.notifier.envoyes, []);

  const ok = await h.call('POST', '/admin/campaigns', { bearer: s, body: { ...corps, confirme: true } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(parse(ok).envoyes, 2);
});

test('un groupe d’audience stocké devient une campagne', async () => {
  const h = make();
  await h.repo.putNotary(notaire('roy'));
  await h.repo.putNotary(notaire('lavoie'));
  await h.repo.putAudienceGroup(
    { id: 'pilote', libelle: 'Pilote 198.1', audience: 'notaire', membres: ['roy@etude.test', 'lavoie@etude.test'] },
    NOW_ISO
  );
  const s = await login(h);

  const body = parse(await h.call('POST', '/admin/campaigns', {
    bearer: s,
    body: { audience: { type: 'group', groupId: 'pilote' }, templateKey: 'notaryDisconnectedWinback' },
  }));
  assert.equal(body.envoyes, 2);
  assert.deepEqual(h.notifier.envoyes.map((e) => e.to).sort(), ['lavoie@etude.test', 'roy@etude.test']);
});

// ============================================================================
// 6. La permission — `campaigns:send`, jamais un `includes`
// ============================================================================

test('`campaigns:send` gouverne l’envoi ; `analytics:read` suffit pour regarder', async () => {
  const h = make();
  await h.repo.putNotary(notaire('parti', { lastSeenAt: ilYA(45) }));
  const analyste = await loginAnalyste(h);
  const corps = {
    audience: { type: 'segment', segmentId: 'notaires_silencieux' },
    templateKey: 'notaryDisconnectedWinback',
  };

  assert.equal((await h.call('POST', '/admin/campaigns/preview', { bearer: analyste, body: corps })).statusCode, 200);

  const envoi = await h.call('POST', '/admin/campaigns', { bearer: analyste, body: corps });
  assert.equal(envoi.statusCode, 403, envoi.body);
  assert.equal(parse(envoi).errors[0].code, 'interdit');
  assert.deepEqual(h.notifier.envoyes, []);
});

test('le joker `*` passe : la permission se décide par rbac.can, jamais par un includes', async () => {
  const h = make();
  await h.repo.putNotary(notaire('parti', { lastSeenAt: ilYA(45) }));
  // Le super_admin ne porte PAS littéralement 'campaigns:send' — il porte '*'.
  const s = await login(h);
  const moi = parse(await h.call('GET', '/admin/me', { bearer: s }));
  assert.deepEqual(moi.permissions, ['*']);

  const res = await h.call('POST', '/admin/campaigns', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'notaryDisconnectedWinback' },
  });
  assert.equal(res.statusCode, 200, res.body);
});

test('un groupe accordant `campaigns:send` ouvre la porte sans promouvoir personne', async () => {
  const h = make();
  await h.repo.putNotary(notaire('parti', { lastSeenAt: ilYA(45) }));
  await h.repo.putGroup({ id: 'marketing', nom: 'Marketing', permissions: ['analytics:read', 'campaigns:send'] }, NOW_ISO);
  await h.repo.putAdmin({
    id: authDefaults.adminIdForEmail('analyste@nota.ca'),
    email: 'analyste@nota.ca',
    role: 'analyst',
    groupes: ['marketing'],
    disabled: false,
    createdAt: NOW_ISO,
  });
  const s = await login(h, 'analyste@nota.ca');

  const res = await h.call('POST', '/admin/campaigns', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'notaryDisconnectedWinback' },
  });
  assert.equal(res.statusCode, 200, res.body);
});

// ============================================================================
// 7. Sans porte d'envoi, on le DIT — on ne fait pas semblant
// ============================================================================

test('sans notifier câblé, l’envoi est refusé bruyamment plutôt que silencieusement perdu', async () => {
  const h = make({ notifier: null });
  await h.repo.putNotary(notaire('parti', { lastSeenAt: ilYA(45) }));
  const s = await login(h);

  const res = await h.call('POST', '/admin/campaigns', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'notaryDisconnectedWinback' },
  });
  assert.equal(res.statusCode, 503, res.body);
  assert.equal(parse(res).errors[0].code, 'envoi_indisponible');
  assert.equal(await h.repo.lastCampaignAt('parti@etude.test'), null, 'aucun quota consommé pour un envoi qui n’a pas eu lieu');
});

test('un envoi refusé par le notifieur ne marque pas le registre', async () => {
  const h = make({ notifier: faussierNotifier({ echoue: (to) => to === 'sorti@etude.test' }) });
  await h.repo.putNotary(notaire('parti', { lastSeenAt: ilYA(45) }));
  await h.repo.putNotary(notaire('sorti', { lastSeenAt: ilYA(60) }));
  const s = await login(h);

  const body = parse(await h.call('POST', '/admin/campaigns', {
    bearer: s,
    body: { audience: { type: 'segment', segmentId: 'notaires_silencieux' }, templateKey: 'notaryDisconnectedWinback' },
  }));
  assert.equal(body.envoyes, 1);
  assert.equal(await h.repo.lastCampaignAt('sorti@etude.test'), null);
  assert.equal(await h.repo.lastCampaignAt('parti@etude.test'), NOW_ISO);
});
