// LA PISTE D'AUDIT NOMME SON ACTEUR (2026-09-03).
//
// Trois trous fermés ici, tous trouvés le même jour :
//
//   1. AUCUNE CONNEXION NE LAISSAIT DE TRACE. Le lien magique du notaire, sa
//      redemption, la réclamation d'un code partenaire et le jeton porteur du
//      client (400 jours de validité) s'émettaient en silence. Un accès non
//      autorisé à un dossier client était donc indétectable ET irreconstituable.
//   2. LES ÉVÉNEMENTS N'AVAIENT PAS D'AUTEUR. `document_lu` disait « par:
//      client » — un rôle, jamais une personne, jamais une origine. Un journal
//      d'accès aux documents qui ne peut pas nommer qui a lu la pièce ne vaut
//      rien dans un litige sur le secret professionnel.
//   3. L'ÉCRITURE D'AUDIT ÉCHOUAIT EN SILENCE. La règle « l'audit ne bloque
//      jamais l'argent » reste juste ; ce qui ne l'était pas, c'est qu'un puits
//      d'audit cassé était indistinguable d'une journée calme.
//
// Deux règles que ces tests défendent aussi, et qui ne se voient nulle part
// ailleurs : AUCUN JETON EN CLAIR n'entre dans le journal (une empreinte suffit
// à reconnaître un rejeu), et aucune adresse courriel non plus — le notaire est
// nommé par l'identifiant dérivé que porte déjà son profil, et le client par
// l'offre qui est la sienne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NOTARY_CONTACT } from '../test-support/notary-fixture.mjs';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createMemoryStorage } = require('../src/storage-port.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const domain = require('@nota/domain');

const TODAY = '2026-09-03';
const NOW_MS = Date.parse('2026-09-03T19:30:00.000Z');
const EMAIL = 'me.tremblay@etude.ca';
const NOTAIRE = notaryIdForEmail(EMAIL);
const IP = '203.0.113.7';
const PRICING = { valeur_pret: 300000, approbation_bancaire: 'obtenue', preteur: 'banque_nationale', succession: 'non', deplacement: 'client_50' };

const parse = (res) => JSON.parse(res.body);

function harness(opts = {}) {
  const repo = createMemoryRepo([]);
  const storage = createMemoryStorage({ now: () => NOW_MS });
  const app = createApp(repo, {
    now: () => TODAY,
    nowMs: () => NOW_MS,
    storage,
    notaryConsoleUrl: 'https://nota.example',
    partnerClaimUrl: 'https://nota.example',
    ...opts,
  });
  return { app, repo, storage };
}

const journal = (repo, action) =>
  repo.queryTxAuditByDay(TODAY).then((e) => (action ? e.filter((x) => x.action === action) : e));

async function seule(repo, action) {
  const e = await journal(repo, action);
  assert.equal(e.length, 1, 'une seule entrée « ' + action + ' », vu ' + e.length);
  return e[0];
}

const seedNotaire = (repo, over = {}) =>
  repo.putNotary({ id: NOTAIRE, email: EMAIL, status: 'active', ...NOTARY_CONTACT, ...over });

const demander = (app, email, ip = IP) =>
  app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email }), sourceIp: ip });
const verifier = (app, token, ip = IP) =>
  app.handle({ method: 'POST', path: '/notary/session/verify', body: JSON.stringify({ token }), sourceIp: ip });

// ---------------------------------------------------------------------------
// 1. Les connexions laissent une trace
// ---------------------------------------------------------------------------

test('la demande de lien magique d’un notaire est journalisée, avec son acteur et son IP', async () => {
  const { app, repo } = harness();
  await seedNotaire(repo);

  assert.equal((await demander(app, EMAIL)).statusCode, 200);

  const e = await seule(repo, 'notaire_lien_demande');
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE, ip: IP });
  assert.equal(e.meta.eligible, true, 'l’adresse est celle d’un notaire actif');
  assert.equal(e.meta.throttled, false);
  assert.equal(e.ip, IP, 'l’enveloppe porte l’IP, comme le journal admin');
  assert.equal(e.day, TODAY, 'seau = jour ouvrable québécois');
});

test('une adresse inconnue est journalisée SANS être nommée : ni identifiant, ni courriel', async () => {
  // La porte reste anti-énumération côté réponse ; le journal, lui, doit dire
  // qu'on a frappé. Mais consigner l'adresse d'un inconnu, ce serait bâtir un
  // registre de non-clients — exactement ce que la minimisation interdit.
  const { app, repo } = harness();

  assert.equal((await demander(app, 'inconnu@ailleurs.ca')).statusCode, 200);

  const e = await seule(repo, 'notaire_lien_demande');
  assert.equal(e.meta.eligible, false);
  assert.equal(e.acteur.id, null, 'aucun identifiant : cette adresse n’est pas un notaire');
  assert.equal(e.acteur.ip, IP, 'l’origine, elle, est ce qui rend l’entrée utile');
  assert.ok(!JSON.stringify(e).includes('inconnu@ailleurs.ca'), 'aucune adresse en clair');
});

test('le franchissement du plafond laisse UNE trace, pas une par requête refusée', async () => {
  // Un journal qu'un attaquant peut faire grossir à volonté est une arme
  // retournée : la trace se pose au moment où le plafond est franchi.
  const { app, repo } = harness({ notaryLoginRlMax: 2 });
  await seedNotaire(repo);

  for (let i = 0; i < 5; i += 1) await demander(app, EMAIL);

  const bloques = (await journal(repo, 'notaire_lien_demande')).filter((e) => e.meta.throttled);
  assert.equal(bloques.length, 1, 'un seul franchissement journalisé, pas trois refus');
  assert.equal(bloques[0].acteur.ip, IP);
});

test('la connexion réussie est journalisée : qui, d’où, et par quel défi', async () => {
  const { app, repo } = harness();
  await seedNotaire(repo);
  const { devToken } = parse(await demander(app, EMAIL));

  assert.equal((await verifier(app, devToken)).statusCode, 200);

  const e = await seule(repo, 'notaire_connexion');
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE, ip: IP });
  assert.ok(e.meta.challengeId, 'le défi consommé, pour recoudre la demande et la connexion');
  assert.ok(!JSON.stringify(e).includes(devToken), 'jamais le jeton en clair');
});

test('un jeton forgé est journalisé comme refus — avec une EMPREINTE, jamais le jeton', async () => {
  const { app, repo } = harness();
  const forge = 'nimporte.quoi.dutout';

  assert.equal((await verifier(app, forge)).statusCode, 401);

  const e = await seule(repo, 'notaire_connexion_refusee');
  assert.equal(e.meta.raison, 'jeton_invalide');
  assert.match(e.meta.empreinteJeton, /^sha256:[0-9a-f]{16}$/, 'une empreinte tronquée, documentée');
  assert.ok(!JSON.stringify(e).includes(forge), 'le jeton lui-même n’entre jamais dans le journal');
  assert.equal(e.acteur.ip, IP);
  assert.equal(e.acteur.id, null, 'un jeton qui ne vérifie pas ne nomme personne');
});

test('deux refus du MÊME lien portent la même empreinte : un rejeu se reconnaît sans stocker le secret', async () => {
  const { app, repo } = harness();
  await seedNotaire(repo);
  const { devToken } = parse(await demander(app, EMAIL));

  assert.equal((await verifier(app, devToken)).statusCode, 200, 'la première redemption gagne');
  assert.equal((await verifier(app, devToken)).statusCode, 401, 'la seconde est un rejeu');
  assert.equal((await verifier(app, devToken)).statusCode, 401);

  const refus = await journal(repo, 'notaire_connexion_refusee');
  assert.equal(refus.length, 2);
  assert.equal(refus[0].meta.raison, 'lien_deja_utilise');
  assert.equal(refus[0].meta.empreinteJeton, refus[1].meta.empreinteJeton, 'même lien, même empreinte');
  assert.equal(refus[0].acteur.id, NOTAIRE, 'le jeton, lui, vérifie : on sait de qui il parle');
});

test('un notaire désactivé entre la demande et la redemption : refus journalisé, motif nommé', async () => {
  const { app, repo } = harness();
  await seedNotaire(repo);
  const { devToken } = parse(await demander(app, EMAIL));
  await seedNotaire(repo, { status: 'suspended' });

  assert.equal((await verifier(app, devToken)).statusCode, 403);

  const e = await seule(repo, 'notaire_connexion_refusee');
  assert.equal(e.meta.raison, 'compte_inactif');
  assert.equal(e.acteur.id, NOTAIRE);
});

test('la réclamation d’un code partenaire, puis sa confirmation, laissent chacune leur trace', async () => {
  const { app, repo } = harness();
  const body = { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' };
  const demande = parse(await app.handle({
    method: 'POST', path: '/partenaires', body: JSON.stringify(body), sourceIp: IP,
  }));

  const d = await seule(repo, 'partenaire_reclamation');
  assert.deepEqual(d.acteur, { type: 'partenaire', id: 'EVEROY', ip: IP });
  assert.equal(d.meta.type, 'courtier_hypothecaire');
  assert.equal(d.meta.throttled, false);
  assert.ok(!JSON.stringify(d).includes('eve@courtage.ca'), 'aucune adresse en clair');

  assert.equal((await app.handle({
    method: 'POST', path: '/partenaires/verify', body: JSON.stringify({ token: demande.devToken }), sourceIp: IP,
  })).statusCode, 201);

  // C'est CETTE écriture qui fait d'un code un payeur de record : elle est la
  // seule qui compte pour un audit du programme de parrainage.
  const c = await seule(repo, 'partenaire_confirme');
  assert.deepEqual(c.acteur, { type: 'partenaire', id: 'EVEROY', ip: IP });
  assert.ok(!JSON.stringify(c).includes(demande.devToken), 'jamais le jeton en clair');
});

test('le jeton porteur du client — 400 jours de validité — n’est plus émis en silence', async () => {
  const { app, repo } = harness();
  const res = await app.handle({
    method: 'POST', path: '/bids', sourceIp: IP,
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO: '2026-10-20', montant: 2400,
      prefixe: 'G1R', courriel: 'client@exemple.ca', pricing: PRICING,
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  const { bid, clientToken } = parse(res);

  const e = await seule(repo, 'client_jeton_emis');
  assert.deepEqual(e.acteur, { type: 'client', id: bid.id, ip: IP });
  assert.equal(e.meta.dateISO, '2026-10-20');
  assert.ok(e.meta.expiresAt > NOW_MS, 'jusqu’à quand ce jeton ouvre le dossier');
  assert.ok(!JSON.stringify(e).includes(clientToken), 'le jeton lui-même n’est jamais consigné');
});

// ---------------------------------------------------------------------------
// 2. L'acteur sur les événements qui existaient déjà
// ---------------------------------------------------------------------------

const BID = {
  id: 'b1', dateISO: '2026-09-20', serviceId: 'refinancement', montant: 2000,
  tier: 'standard', anonyme: true, etude: 'Étude T', courriel: 'client@exemple.ca',
  prefixe: 'G1R', pricing: { deplacement: 'client_50' }, createdAt: TODAY,
};

async function offreRetenue(repo) {
  await seedNotaire(repo);
  const bid = { ...BID, status: domain.STATUS.RETENUE, notaryId: NOTAIRE };
  await repo.put(bid);
  return bid;
}

const jetonClient = () => signToken('b1', NOW_MS + 60_000, SCOPES.CLIENT);
const jetonNotaire = () => signToken(NOTAIRE, NOW_MS + 60_000, SCOPES.SESSION);

const PDF = { id: 'b1', dateISO: '2026-09-20', nom: 'releve.pdf', taille: 1024, type: 'application/pdf' };

// Le client dépose une pièce et le serveur CONSTATE le dépôt — le préalable de
// toute lecture, donc de toute trace de lecture.
async function documentPret({ app, repo, storage }) {
  await offreRetenue(repo);
  const ouvre = await app.handle({
    method: 'POST', path: '/client/bid/documents', headers: { authorization: 'Bearer ' + jetonClient() },
    sourceIp: IP, body: JSON.stringify(PDF),
  });
  assert.equal(ouvre.statusCode, 200, ouvre.body);
  const { document } = parse(ouvre);
  storage.__deposer(domain.documentStorageKey('b1', document.id, PDF.nom), Buffer.alloc(1024), 'application/pdf');
  const ok = await app.handle({
    method: 'POST', path: '/client/bid/documents/confirme', headers: { authorization: 'Bearer ' + jetonClient() },
    sourceIp: IP, body: JSON.stringify({ id: 'b1', dateISO: '2026-09-20', documentId: document.id }),
  });
  assert.equal(ok.statusCode, 200, ok.body);
  return document.id;
}

test('un dépôt de document nomme son déposant, pas seulement son camp', async () => {
  const h = harness();
  await documentPret(h);

  const e = await seule(h.repo, 'document_depose');
  assert.deepEqual(e.acteur, { type: 'client', id: 'b1', ip: IP }, 'le client EST son offre : il n’a pas d’autre nom');
  assert.equal(e.meta.de, 'client', 'le camp reste, il ne suffisait simplement pas');
});

test('la lecture d’un document par le notaire le NOMME — sinon la trace ne vaut rien en litige', async () => {
  const h = harness();
  const documentId = await documentPret(h);

  const res = await h.app.handle({
    method: 'GET', path: '/notary/bids/documents',
    query: { id: 'b1', dateISO: '2026-09-20', documentId },
    headers: { authorization: 'Bearer ' + jetonNotaire() }, sourceIp: '198.51.100.4',
  });
  assert.equal(res.statusCode, 200, res.body);

  const e = await seule(h.repo, 'document_lu');
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE, ip: '198.51.100.4' });
  assert.equal(e.meta.par, 'notaire');
});

test('l’IP consignée est celle que la passerelle atteste, jamais le premier bond de X-Forwarded-For', async () => {
  // Le jeton de gauche est écrit par le client : le croire laisserait forger
  // l'origine de chaque accès au dossier. Même règle qu'admin-handler.js.
  const h = harness();
  const documentId = await documentPret(h);

  const res = await h.app.handle({
    method: 'GET', path: '/client/bid/documents',
    query: { id: 'b1', dateISO: '2026-09-20', documentId },
    headers: { authorization: 'Bearer ' + jetonClient(), 'x-forwarded-for': '1.2.3.4, 70.70.70.70' },
  });
  assert.equal(res.statusCode, 200, res.body);

  const e = await seule(h.repo, 'document_lu');
  assert.deepEqual(e.acteur, { type: 'client', id: 'b1', ip: '70.70.70.70' });
});

test('la rétention d’un acte nomme le notaire qui s’engage', async () => {
  const { app, repo } = harness();
  await seedNotaire(repo);
  await repo.put({ ...BID, id: 'b2', dateISO: '2026-09-25', status: domain.STATUS.OUVERTE, notaryId: null });

  const res = await app.handle({
    method: 'POST', path: '/notary/bids/accept', headers: { authorization: 'Bearer ' + jetonNotaire() },
    sourceIp: IP, body: JSON.stringify({ id: 'b2', dateISO: '2026-09-25' }),
  });
  assert.equal(res.statusCode, 200, res.body);

  const e = await seule(repo, 'acte_retenu');
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE, ip: IP });
});

test('toute entrée du journal public porte un acteur du vocabulaire fermé — et jamais un adminId', async () => {
  // La garde qui empêche le prochain point d'appel d'oublier son acteur : la
  // porte publique n'a pas d'administrateur, et « on ne sait pas » doit se dire
  // « systeme », jamais par un champ absent qu'on lirait comme « personne ».
  const h = harness();
  const documentId = await documentPret(h);
  await h.app.handle({
    method: 'GET', path: '/notary/bids/documents', query: { id: 'b1', dateISO: '2026-09-20', documentId },
    headers: { authorization: 'Bearer ' + jetonNotaire() }, sourceIp: IP,
  });
  await demander(h.app, EMAIL);

  const entrees = await journal(h.repo);
  assert.ok(entrees.length >= 3, 'le scénario a bien produit des traces');
  for (const e of entrees) {
    assert.ok(e.acteur, 'entrée sans acteur : ' + e.action);
    assert.ok(['notaire', 'client', 'partenaire', 'systeme'].includes(e.acteur.type), 'acteur hors vocabulaire : ' + e.acteur.type);
    assert.equal(e.adminId, null, 'la porte publique n’a pas d’administrateur');
  }
});

// ---------------------------------------------------------------------------
// 3. Un puits d'audit cassé se voit
// ---------------------------------------------------------------------------

test('une écriture d’audit qui échoue crie en JSON — et ne bloque toujours pas l’argent', async () => {
  const repo = createMemoryRepo([]);
  repo.appendTxAudit = async () => { throw new Error('ProvisionedThroughputExceeded'); };
  const app = createApp(repo, {
    now: () => TODAY, nowMs: () => NOW_MS, notaryConsoleUrl: 'https://nota.example',
  });
  await seedNotaire(repo);

  const lignes = [];
  const vrai = console.error;
  console.error = (...args) => lignes.push(args.join(' '));
  let res;
  try {
    res = await demander(app, EMAIL);
  } finally {
    console.error = vrai;
  }

  assert.equal(res.statusCode, 200, 'l’audit ne bloque jamais la porte');
  assert.equal(lignes.length, 1, 'exactement une ligne, exploitable par un filtre de métrique');
  const trace = JSON.parse(lignes[0]);
  assert.equal(trace.level, 'error');
  assert.equal(trace.event, 'audit_write_failed', 'le nom que le filtre CloudWatch cherche (infra/observability.tf)');
  assert.equal(trace.action, 'notaire_lien_demande', 'quelle trace a été perdue');
  assert.match(trace.message, /ProvisionedThroughputExceeded/);
});
