/**
 * L'ESPACE CLIENT — retrouver SES offres depuis n'importe quel appareil.
 *
 * Avant : un client était connu de son seul appareil. `nota.myoffers.v1` et le
 * jeton par offre vivaient dans le localStorage ; vider le navigateur ou
 * changer de téléphone effaçait tout l'historique du client — alors que le
 * serveur, lui, le tenait toujours. L'index `CLIENT#<courriel>` est écrit à
 * CHAQUE publication (handler.js) et relu par une Query bornée
 * (`listClientBids`), mais son unique lecteur était la console d'opérateur.
 * Voir [[code-teste-sans-appelant]].
 *
 * Le verrou à ne pas forcer : `/client/welcome` accepte n'importe quelle
 * adresse, sans preuve ni freinage. Rendre les offres sur une adresse nue
 * aurait fait de l'index une porte d'ÉNUMÉRATION et de reprise de compte.
 * D'où la poignée de main en deux temps, calquée sur le lien magique notaire
 * (ADR 0026, « une capacité courte ») :
 *
 *   • POST /client/session/request — freinée par IP, anti-énumération, pose un
 *     défi à usage unique et envoie le lien.
 *   • POST /client/session/verify  — consomme le défi et rend la LISTE des
 *     offres, chacune avec un jeton CLIENT frais (portée `sub === bid.id`).
 *
 * La frontière de sécurité existante ne bouge pas d'un pouce : `requireClient`
 * exige toujours `sub === bid.id`. On ne fabrique pas une portée « personne ».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { verifyToken, SCOPES } = require('../src/notary-auth.js');

const TODAY = '2026-09-05';
const START = Date.parse('2026-09-05T12:00:00.000Z');
const COURRIEL = 'roy@exemple.ca';
const parse = (res) => JSON.parse(res.body);

const OFFRE = {
  serviceId: 'refinancement',
  dateISO: '2026-12-01',
  montant: 2000,
  nom: 'Éveline Roy',
  courriel: COURRIEL,
  telephone: '418 555-0100',
  prefixe: 'G1R',
  pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
};

function harness(opts = {}) {
  let n = 0;
  const clock = { ms: START };
  const repo = createMemoryRepo();
  const app = createApp(repo, {
    now: () => TODAY,
    nowMs: () => clock.ms,
    newId: () => 'id-' + ++n,
    siteUrl: 'https://nota.example',
    ...opts,
  });
  return { app, repo, clock };
}

async function publier(app, extra = {}) {
  const res = await app.handle({
    method: 'POST', path: '/bids', query: {}, headers: { 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify({ ...OFFRE, ...extra }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res).bid;
}

const demander = (app, courriel, ip = '9.9.9.9') =>
  app.handle({ method: 'POST', path: '/client/session/request', query: {}, headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ courriel }) });
const verifier = (app, token, ip = '9.9.9.9') =>
  app.handle({ method: 'POST', path: '/client/session/verify', query: {}, headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ token }) });

// ===========================================================================
// 1. ANTI-ÉNUMÉRATION — la porte ne dit jamais qui est client
// ===========================================================================

test('la demande répond pareil pour un client connu et pour un inconnu', async () => {
  const { app } = harness({ clientLoginDevEcho: false });
  await publier(app);

  const connu = await demander(app, COURRIEL, '1.1.1.1');
  const inconnu = await demander(app, 'personne@nulle-part.ca', '2.2.2.2');

  assert.equal(connu.statusCode, 200);
  assert.equal(inconnu.statusCode, 200);
  assert.deepEqual(parse(connu), parse(inconnu), 'deux réponses indiscernables');
});

test('une adresse invalide est refusée sans rien poser', async () => {
  const { app } = harness();
  const res = await demander(app, 'pas-une-adresse');
  assert.equal(res.statusCode, 422);
  assert.equal(parse(res).errors[0].code, 'courriel_invalide');
});

test('la porte est freinée par IP — au-delà du plafond, plus aucun lien', async () => {
  const { app } = harness();
  await publier(app);
  let dernier;
  for (let i = 0; i < 12; i++) dernier = await demander(app, COURRIEL, '7.7.7.7');
  assert.equal(dernier.statusCode, 429, 'le flot est coupé');
  assert.equal(parse(dernier).throttled, true);
});

// ===========================================================================
// 2. LA POIGNÉE DE MAIN — usage unique, expiration, contrefaçon
// ===========================================================================

test('le lien rend les offres du client, chacune avec son jeton', async () => {
  const { app } = harness();
  const a = await publier(app);
  const b = await publier(app, { dateISO: '2026-12-15', montant: 2400 });

  const { devToken } = parse(await demander(app, COURRIEL));
  assert.ok(devToken, 'l’écho de développement porte le défi');

  const res = await verifier(app, devToken);
  assert.equal(res.statusCode, 200, res.body);
  const { offres } = parse(res);

  assert.equal(offres.length, 2, 'les deux offres de cette adresse');
  const ids = offres.map((o) => o.id).sort();
  assert.deepEqual(ids, [a.id, b.id].sort());

  // Chaque offre porte de quoi la lire ET de quoi agir dessus.
  offres.forEach((o) => {
    assert.ok(o.dateISO && o.serviceId, 'la ligne se lit sans second appel');
    assert.ok(o.clientToken, 'et porte son jeton');
    const claims = verifyToken(o.clientToken);
    assert.equal(claims.scope, SCOPES.CLIENT, 'portée CLIENT, jamais une portée « personne »');
    assert.equal(claims.sub, o.id, 'le jeton ne vaut que pour SON offre');
  });
});

test('le jeton rendu ouvre vraiment /client/bid — la couture est traversée', async () => {
  const { app } = harness();
  const bid = await publier(app);
  const { devToken } = parse(await demander(app, COURRIEL));
  const [offre] = parse(await verifier(app, devToken)).offres;

  const res = await app.handle({
    method: 'GET', path: '/client/bid', query: { id: offre.id, date: offre.dateISO },
    headers: { authorization: `Bearer ${offre.clientToken}`, 'x-forwarded-for': '1.2.3.4' },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).bid.id, bid.id);
});

test('un lien est à usage unique : le rejouer ne rend plus rien', async () => {
  const { app } = harness();
  await publier(app);
  const { devToken } = parse(await demander(app, COURRIEL));

  assert.equal((await verifier(app, devToken)).statusCode, 200);
  const rejeu = await verifier(app, devToken);
  assert.equal(rejeu.statusCode, 401, 'un lien consommé est mort');
  assert.equal(parse(rejeu).errors[0].code, 'lien_invalide');
});

test('un lien expiré ne vaut plus rien', async () => {
  const { app, clock } = harness();
  await publier(app);
  const { devToken } = parse(await demander(app, COURRIEL));
  clock.ms += 60 * 60 * 1000; // une heure plus tard
  const res = await verifier(app, devToken);
  assert.equal(res.statusCode, 401);
});

test('un jeton contrefait est refusé', async () => {
  const { app } = harness();
  await publier(app);
  const res = await verifier(app, 'ceci.nest.pas.un.jeton');
  assert.equal(res.statusCode, 401);
});

// ===========================================================================
// 3. CE QUE LA PORTE NE DOIT PAS LAISSER PASSER
// ===========================================================================

test('le lien d’une adresse ne donne JAMAIS les offres d’une autre', async () => {
  const { app } = harness();
  await publier(app);                                   // roy@exemple.ca
  await publier(app, { courriel: 'autre@exemple.ca', nom: 'Autre Personne' });

  const { devToken } = parse(await demander(app, 'autre@exemple.ca'));
  const { offres } = parse(await verifier(app, devToken));

  assert.equal(offres.length, 1, 'seulement les siennes');
  assert.ok(offres.every((o) => o.id !== undefined));
  const autres = await app.handle({
    method: 'GET', path: '/client/bid', query: { id: 'id-1', date: OFFRE.dateISO },
    headers: { authorization: `Bearer ${offres[0].clientToken}`, 'x-forwarded-for': '1.2.3.4' },
  });
  assert.equal(autres.statusCode, 403, 'le jeton d’une offre n’ouvre pas celle du voisin');
});

test('l’adresse est la clé : casse et espaces ne font pas deux personnes', async () => {
  const { app } = harness();
  await publier(app);
  const { devToken } = parse(await demander(app, '  Roy@Exemple.CA  '));
  const { offres } = parse(await verifier(app, devToken));
  assert.equal(offres.length, 1, 'la même personne, quelle que soit la graphie');
});

test('une adresse sans aucune offre vérifie, et rend une liste vide', async () => {
  // Vide n'est pas une erreur : la personne a bien prouvé sa boîte, elle n'a
  // simplement rien publié. Un 404 ici trahirait qui est client.
  const { app } = harness();
  const { devToken } = parse(await demander(app, 'neuf@exemple.ca'));
  const res = await verifier(app, devToken);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(parse(res).offres, []);
});

test('l’écho de développement est ABSENT en production', async () => {
  const { app } = harness({ clientLoginDevEcho: false });
  await publier(app);
  const j = parse(await demander(app, COURRIEL));
  assert.equal(j.devToken, undefined, 'aucun jeton dans la réponse');
  assert.equal(j.devLink, undefined, 'aucun lien non plus');
});

// ===========================================================================
// 4. LA PISTE D'AUDIT (ADR 0036) — l'accès à un dossier se journalise
// ===========================================================================

test('la demande et l’ouverture laissent chacune une trace, sans le courriel en clair', async () => {
  const { app, repo } = harness();
  await publier(app);
  const { devToken } = parse(await demander(app, COURRIEL));
  await verifier(app, devToken);

  const entrees = await repo.queryAuditByDay(TODAY);
  const kinds = entrees.map((e) => e.action);
  assert.ok(kinds.includes('client_lien_demande'), 'la demande est journalisée');
  assert.ok(kinds.includes('client_espace_ouvert'), 'l’ouverture aussi');
  // Une piste conservée des années ne porte pas l'adresse en clair.
  const brut = JSON.stringify(entrees);
  assert.ok(!brut.includes(COURRIEL), 'le courriel n’entre pas dans la piste');
});

// ===========================================================================
// 5. LE DOSSIER REVIENT AVEC L'OFFRE
// ===========================================================================
// La reprise rendait les offres mais PAS les réponses déjà données : un client
// sur un appareil neuf retrouvait sa demande et une liste de documents vide,
// alors que le serveur tenait ses réponses. `/client/bid` ne rendait que
// `readiness` — un COMPTE dérivé du dossier — jamais le dossier lui-même. Le
// dossier ne se poussait donc que dans un sens.

test('le dossier REVIENT dans /client/bid — la reprise n’est pas à moitié faite', async () => {
  const { app } = harness();
  const bid = await publier(app);
  const { devToken } = parse(await demander(app, COURRIEL));
  const [offre] = parse(await verifier(app, devToken)).offres;
  const auth = { authorization: `Bearer ${offre.clientToken}`, 'x-forwarded-for': '1.2.3.4' };

  // Le client répond depuis son premier appareil.
  const push = await app.handle({
    method: 'POST', path: '/client/dossier', query: {}, headers: auth,
    body: JSON.stringify({ id: bid.id, date: bid.dateISO, dossier: { piece_identite: 'permis-2019.pdf' } }),
  });
  assert.equal(push.statusCode, 200, push.body);

  // …et le relit depuis un autre.
  const res = await app.handle({ method: 'GET', path: '/client/bid', query: { id: bid.id, date: bid.dateISO }, headers: auth });
  assert.equal(res.statusCode, 200, res.body);
  const j = parse(res);
  assert.ok(j.dossier, 'le dossier est rendu');
  assert.equal(j.dossier.piece_identite, 'permis-2019.pdf', 'avec la réponse déjà donnée');
});

test('un dossier vide se rend comme un objet vide, jamais comme une absence', async () => {
  // `undefined` ferait écrire « aucune réponse » à l'écran alors que la
  // question est simplement neuve : les deux se lisent pareil, et l'un des
  // deux effacerait le cache local du client à la première relecture.
  const { app } = harness();
  const bid = await publier(app);
  const { devToken } = parse(await demander(app, COURRIEL));
  const [offre] = parse(await verifier(app, devToken)).offres;
  const res = await app.handle({
    method: 'GET', path: '/client/bid', query: { id: bid.id, date: bid.dateISO },
    headers: { authorization: `Bearer ${offre.clientToken}`, 'x-forwarded-for': '1.2.3.4' },
  });
  assert.deepEqual(parse(res).dossier, {}, 'un objet, vide');
});
