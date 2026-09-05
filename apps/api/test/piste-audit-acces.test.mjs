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
// Trois règles que ces tests défendent aussi, et qui ne se voient nulle part
// ailleurs : AUCUN JETON EN CLAIR n'entre dans le journal (une empreinte suffit
// à reconnaître un rejeu), AUCUNE ADRESSE COURRIEL non plus — le notaire est
// nommé par l'identifiant dérivé que porte déjà son profil, et le client par
// l'offre qui est la sienne — et AUCUNE ADRESSE D'ORIGINE.
//
// Cette troisième règle a été ajoutée le 2026-09-04, contre la première version
// de ce chantier qui posait `ip` sur chaque entrée. Le journal public est
// conservé SEPT ANS (preuve d'imputabilité) et s'ouvre avec `audit:read` SANS
// `pii:read` : y déposer une IP — un renseignement personnel au sens de la Loi
// 25 — contredisait à la fois la borne de douze mois que la politique fixe aux
// journaux d'accès et le découplage des deux permissions. L'origine sert à
// l'investigation d'incident ; elle vit dans les journaux techniques de la
// Lambda, qui la portent déjà et que la politique borne, elle, à douze mois.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

test('la demande de lien magique d’un notaire est journalisée, avec son acteur', async () => {
  const { app, repo } = harness();
  await seedNotaire(repo);

  assert.equal((await demander(app, EMAIL)).statusCode, 200);

  const e = await seule(repo, 'notaire_lien_demande');
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE });
  assert.equal(e.meta.eligible, true, 'l’adresse est celle d’un notaire actif');
  assert.equal(e.meta.throttled, false);
  assert.equal(e.ip, null, 'la porte publique ne consigne aucune origine');
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
  assert.deepEqual(bloques[0].acteur, { type: 'notaire', id: null }, 'un flot bloqué ne nomme personne');
});

test('la connexion réussie est journalisée : qui, et par quel défi', async () => {
  const { app, repo } = harness();
  await seedNotaire(repo);
  const { devToken } = parse(await demander(app, EMAIL));

  assert.equal((await verifier(app, devToken)).statusCode, 200);

  const e = await seule(repo, 'notaire_connexion');
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE });
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
  assert.equal(e.acteur.id, null, 'un jeton qui ne vérifie pas ne nomme personne');
});

test('un flot de jetons forgés ne peut pas gonfler le journal — la redemption a un plafond', async () => {
  // LA RÉGRESSION QUE CE TEST GARDE (2026-09-04). Avant ce plafond, un jeton
  // forgé — qui échoue à la vérification de signature AVANT tout appel de dépôt,
  // et ne touchait donc aucune écriture — coûtait une écriture durable, anonyme
  // et non limitée. Toutes atterrissaient sur la MÊME clé de partition
  // `AUDIT#<jour>` : celle qui porte aussi `acte_regle` et `annulation_frais`.
  // DynamoDB plafonne une clé de partition à ~1000 WCU/s, et les traces
  // d'argent sont best-effort : un flot anonyme pouvait donc les faire échouer
  // sans reprise, et rendre `GET /admin/audit` — qui pagine la partition
  // entière du jour — inexploitable. Il n'y a pas de WAF devant ce compte.
  const { app, repo } = harness({ notaryVerifyRlMax: 3 });

  for (let i = 0; i < 40; i += 1) {
    const res = await verifier(app, 'forge.numero.' + i);
    assert.equal(res.statusCode, i < 3 ? 401 : 429, 'requête ' + i);
  }

  const refus = await journal(repo, 'notaire_connexion_refusee');
  // Trois refus réels + UN franchissement. Quarante requêtes, quatre écritures :
  // le journal ne grossit plus au rythme de l'attaquant.
  assert.equal(refus.length, 4, 'quarante requêtes hostiles, quatre entrées — vu ' + refus.length);
  const franchissements = refus.filter((e) => e.meta.throttled);
  assert.equal(franchissements.length, 1, 'un seul franchissement journalisé, pas trente-sept refus');
  assert.equal(franchissements[0].meta.raison, 'trop_de_tentatives');
  assert.deepEqual(franchissements[0].acteur, { type: 'notaire', id: null }, 'un flot bloqué ne nomme personne');
});

test('le plafond de redemption est plus large que celui de l’émission — un notaire légitime ne s’y cogne pas', async () => {
  // Un client de courriel qui préfetche le lien, un onglet rouvert, un retour
  // arrière : la redemption se rejoue plus souvent que la demande. Le plafond
  // borne l'abus, il ne doit pas fermer la porte à celui qui a le bon lien.
  const { app, repo } = harness();
  await seedNotaire(repo);
  const { devToken } = parse(await demander(app, EMAIL));

  assert.equal((await verifier(app, devToken)).statusCode, 200, 'la première redemption passe');
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await verifier(app, devToken)).statusCode, 401, 'un rejeu, pas un blocage (tour ' + i + ')');
  }
  assert.equal((await journal(repo, 'notaire_connexion_refusee')).filter((e) => e.meta.throttled).length, 0,
    'onze redemptions du même lien ne franchissent aucun plafond');
});

test('le compteur anti-abus ÉCHOUE OUVERT : une connexion ne dépend pas de sa santé', async () => {
  // La même règle que sur les deux autres portes ouvertes. Un compteur en panne
  // ne doit pas empêcher un notaire d'entrer — disponibilité avant rigueur, sur
  // le chemin de connexion.
  const { app, repo } = harness();
  await seedNotaire(repo);
  repo.incrNotaryRateCounter = async () => { throw new Error('ProvisionedThroughputExceeded'); };
  const { devToken } = parse(await demander(app, EMAIL));

  assert.equal((await verifier(app, devToken)).statusCode, 200, 'le compteur est mort, la porte reste ouverte');
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
  assert.deepEqual(d.acteur, { type: 'partenaire', id: 'EVEROY' });
  assert.equal(d.meta.type, 'courtier_hypothecaire');
  assert.equal(d.meta.throttled, false);
  assert.ok(!JSON.stringify(d).includes('eve@courtage.ca'), 'aucune adresse en clair');

  assert.equal((await app.handle({
    method: 'POST', path: '/partenaires/verify', body: JSON.stringify({ token: demande.devToken }), sourceIp: IP,
  })).statusCode, 201);

  // C'est CETTE écriture qui fait d'un code un payeur de record : elle est la
  // seule qui compte pour un audit du programme de parrainage.
  const c = await seule(repo, 'partenaire_confirme');
  assert.deepEqual(c.acteur, { type: 'partenaire', id: 'EVEROY' });
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
  assert.deepEqual(e.acteur, { type: 'client', id: bid.id });
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
  assert.deepEqual(e.acteur, { type: 'client', id: 'b1' }, 'le client EST son offre : il n’a pas d’autre nom');
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
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE });
  assert.equal(e.meta.par, 'notaire');
});

test('AUCUNE adresse d’origine n’entre dans le journal public — pas même celle que la passerelle atteste', async () => {
  // Un registre conservé SEPT ANS, que `audit:read` ouvre sans `pii:read`, ne
  // porte aucun renseignement personnel. L'en-tête de gauche est fourni par le
  // client et l'IP de droite est celle que la passerelle atteste : ni l'une ni
  // l'autre ne doit se retrouver dans l'entrée, ni dans l'enveloppe, ni dans
  // l'acteur, ni dans la meta. La recherche porte sur le JSON entier — c'est
  // la seule formulation qu'un futur champ ne peut pas contourner.
  const h = harness();
  const documentId = await documentPret(h);

  const res = await h.app.handle({
    method: 'GET', path: '/client/bid/documents',
    query: { id: 'b1', dateISO: '2026-09-20', documentId },
    headers: { authorization: 'Bearer ' + jetonClient(), 'x-forwarded-for': '1.2.3.4, 70.70.70.70' },
  });
  assert.equal(res.statusCode, 200, res.body);

  const e = await seule(h.repo, 'document_lu');
  assert.deepEqual(e.acteur, { type: 'client', id: 'b1' }, 'l’acteur est { type, id } — rien de plus');
  assert.equal(e.ip, null, 'l’enveloppe reste vide d’origine sur la porte publique');
  const brut = JSON.stringify(e);
  assert.ok(!brut.includes('70.70.70.70'), 'pas l’IP attestée par la passerelle');
  assert.ok(!brut.includes('1.2.3.4'), 'ni le premier bond de X-Forwarded-For');
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
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE });
});

// Ce que chaque action du journal public doit NOMMER. Le tableau est la garde :
// il ne dit pas « un acteur du vocabulaire », il dit LEQUEL.
//
// Pourquoi il a fallu le réécrire (2026-09-04). La première version bouclait sur
// trois assertions faibles — acteur présent, type dans le vocabulaire, adminId
// nul — et prétendait « empêcher le prochain point d'appel d'oublier son
// acteur ». Elle ne le pouvait pas : `appendAudit` fait `const a = qui ||
// SYSTEME`, donc un appel qui OUBLIE son troisième argument produit
// `{ type: 'systeme', id: null }`, qui satisfait les trois. Le test passait
// exactement dans le cas qu'il disait interdire ; il ne gardait que le
// vocabulaire.
//
// Trois façons de le faire rougir, maintenant : un acteur oublié (l'entrée dit
// « systeme » là où le tableau attend une partie), un acteur mal attribué (le
// notaire crédité d'un geste du client), et une action neuve que personne n'a
// déclarée ici — c'est ce dernier cas qui force le prochain à choisir.
const ACTEUR_ATTENDU = {
  notaire_lien_demande: 'notaire',
  notaire_connexion: 'notaire',
  notaire_connexion_refusee: 'notaire',
  partenaire_reclamation: 'partenaire',
  partenaire_confirme: 'partenaire',
  client_jeton_emis: 'client',
  document_depose: 'client',
  document_lu: 'notaire',
  acte_retenu: 'notaire',
  acte_regle: 'notaire',
  annulation_frais: 'client',
  // Les angles morts fermés le 2026-09-05. L'ARGENT hors règlement nomme le
  // CLIENT — c'est sa carte, et l'offre EST son dossier ; Stripe n'est qu'un
  // messager et ne doit jamais apparaître comme « systeme ». La vie du NOTAIRE
  // le nomme, lui, même quand c'est un webhook qui l'apprend à Nota.
  caution_demandee: 'client',
  carte_autorisee: 'client',
  carte_enregistree: 'client',
  caution_liberee: 'client',
  offre_annulee: 'client',
  notaire_compte_stripe: 'notaire',
  notaire_inscription: 'notaire',
  notaire_profil_modifie: 'notaire',
  notaire_proposition: 'notaire',
  notaire_desistement: 'notaire',
};

test('AUCUNE action du handler n’échappe au tableau : le vocabulaire se lit dans la SOURCE', () => {
  // La garde d'au-dessus ne voit que les actions que SON scénario déclenche —
  // elle n'aurait jamais rougi pour un point d'appel neuf ailleurs dans le
  // fichier. Le vocabulaire se lit donc directement dans la source, comme la
  // console le fait pour ses libellés (apps/admin/test/audit.test.mjs) : les
  // deux tables qui doivent s'accorder ne se recopient pas, elles se dérivent.
  const src = readFileSync(fileURLToPath(new URL('../src/handler.js', import.meta.url)), 'utf8');
  const ecrites = [...new Set([...src.matchAll(/\bappendAudit\(\s*'([a-z_]+)'/g)].map((m) => m[1]))].sort();
  assert.ok(ecrites.length >= 15, 'le vocabulaire a bien été lu : ' + ecrites.join(', '));
  const nonDeclarees = ecrites.filter((a) => !Object.prototype.hasOwnProperty.call(ACTEUR_ATTENDU, a));
  assert.deepEqual(nonDeclarees, [], 'actions écrites par l’API que personne n’a déclarées : choisissez qui elles nomment');
});

test('chaque entrée du journal public nomme L’ACTEUR ATTENDU — « systeme » est un échec, pas un repli', async () => {
  const h = harness();
  const documentId = await documentPret(h);
  // Le notaire lit la pièce que le client a déposée : deux camps, deux traces.
  await h.app.handle({
    method: 'GET', path: '/notary/bids/documents', query: { id: 'b1', dateISO: '2026-09-20', documentId },
    headers: { authorization: 'Bearer ' + jetonNotaire() }, sourceIp: IP,
  });
  await demander(h.app, EMAIL);
  await h.app.handle({
    method: 'POST', path: '/partenaires', sourceIp: IP,
    body: JSON.stringify({ type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' }),
  });
  await verifier(h.app, 'jeton.forge.invalide');

  const entrees = await journal(h.repo);
  const vues = new Set(entrees.map((e) => e.action));
  assert.ok(vues.size >= 5, 'le scénario a bien traversé plusieurs portes, vu ' + [...vues].join(', '));

  for (const e of entrees) {
    assert.ok(e.acteur, 'entrée sans acteur : ' + e.action);
    assert.ok(
      Object.prototype.hasOwnProperty.call(ACTEUR_ATTENDU, e.action),
      'action « ' + e.action + ' » non déclarée : ajoutez-la à ACTEUR_ATTENDU en choisissant qui elle nomme'
    );
    assert.equal(
      e.acteur.type, ACTEUR_ATTENDU[e.action],
      '« ' + e.action + ' » devait nommer ' + ACTEUR_ATTENDU[e.action] + ', a nommé ' + e.acteur.type
    );
    assert.notEqual(e.acteur.type, 'systeme', 'une porte publique a toujours une partie devant elle : ' + e.action);
    assert.equal(e.adminId, null, 'la porte publique n’a pas d’administrateur');
    assert.equal(e.email, null, 'aucune adresse courriel dans le journal public');
    assert.equal(e.ip, null, 'aucune adresse d’origine dans le journal public');
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
