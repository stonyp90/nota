// L'article 70 du Code de déontologie des notaires (N-3, r. 2) :
//
//   « Le notaire ne peut, dans sa publicité, utiliser OU PERMETTRE QUE SOIT
//     UTILISÉ un témoignage d'appui ou de reconnaissance qui le concerne, à
//     l'exception des prix d'excellence et autres mérites soulignant une
//     contribution ou une réalisation dont l'honneur a rejailli sur la
//     profession. »
//
// Il n'y a aucune exception pour les avis authentiques, et « permettre que soit
// utilisé » atteint le notaire simplement listé sur une plateforme qui affiche
// des évaluations le concernant. Le propriétaire a tranché le 2026-09-01 : ne
// pas contrevenir au Code prime sur tout le reste.
//
// Ce que cela interdit : publier, auprès d'un client, une évaluation, une
// moyenne d'étoiles ou une cote qui concerne un notaire NOMMÉ.
// Ce que cela n'interdit pas : recueillir les évaluations, les montrer au
// notaire lui-même, les montrer à Nota, et s'en servir pour tarifer.
// Ce qui reste publiable : des FAITS vérifiables — l'inscription au tableau de
// la Chambre, le nombre d'actes portés — qui ne sont pas des témoignages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = Date.parse('2026-08-12T15:00:00.000Z');
const NOTARY = notaryIdForEmail('n@etude.ca');
const FICHE = 'https://www.cnq.org/trouver-un-notaire/fiche/1/';
const parse = (res) => JSON.parse(res.body);
const bearer = (t) => ({ authorization: 'Bearer ' + t });

function app() {
  const repo = createMemoryRepo([]);
  return { ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS }), repo };
}

// Un notaire très bien noté : c'est le cas où la tentation de publier est la
// plus forte, donc celui qu'il faut tester.
async function seedNotaire(a) {
  await a.repo.putNotary({
    id: NOTARY, email: 'n@etude.ca', label: 'Étude N',
    status: 'active', chargesEnabled: true, connectAccountId: 'acct_n',
    ratingSum: 4.9 * 40, ratingCount: 40,
    actsCompleted: 37, actsByService: { refinancement: 30, financement: 7 },
    proposalsCount: 40, acceptsCount: 12, declinesCount: 4,
    rayonKm: 50, urgences: true, lienCNQ: FICHE, prefixe: 'G1R',
    createdAt: '2025-01-01T00:00:00.000Z', lastSeenAt: TODAY,
  });
}

async function offreAvecProposition(a) {
  const bid = {
    id: 'b1', dateISO: '2026-08-25', serviceId: 'refinancement', montant: 2000,
    tier: 'standard', status: domain.STATUS.OUVERTE, anonyme: true, createdAt: TODAY,
    courriel: 'client@exemple.ca', prefixe: 'G1R', pricing: { deplacement: 'client_50' },
    propositions: [{
      id: 'p1', notaryId: NOTARY, etude: 'Étude N', montant: 2400, delta: 400,
      message: null, createdAt: TODAY, status: 'en_attente',
    }],
  };
  await a.repo.put(bid);
  return bid;
}

const vueClient = (a, bid) =>
  a.handle({
    method: 'GET', path: '/client/bid',
    headers: bearer(signToken(bid.id, NOW_MS + 60_000, SCOPES.CLIENT)),
    query: { id: bid.id, dateISO: bid.dateISO },
  });

test('la vue client ne publie AUCUNE évaluation d’un notaire nommé', async () => {
  const a = app();
  await seedNotaire(a);
  const bid = await offreAvecProposition(a);

  const body = parse(await vueClient(a, bid));
  const brut = JSON.stringify(body);

  assert.equal(body.propositions.length, 1);
  assert.equal(body.propositions[0].rating, undefined, 'aucune moyenne d’étoiles');
  assert.equal(body.propositions[0].cote, undefined, 'aucune cote — une note affichée est une recommandation');
  assert.equal(brut.includes('4.9'), false, 'la moyenne ne fuit nulle part');
  assert.equal(brut.includes('"avis"'), false, 'ni le nombre d’avis');
});

test('après la rétention non plus — le bloc notaire porte des faits, pas une appréciation', async () => {
  const a = app();
  await seedNotaire(a);
  const bid = await offreAvecProposition(a);
  await a.repo.retain({ ...bid, status: domain.STATUS.RETENUE, notaryId: NOTARY, etude: 'Étude N' }, NOTARY);

  const body = parse(await vueClient(a, bid));
  assert.equal(body.notaire.rating, undefined);
  assert.equal(body.notaire.cote, undefined);
  // Ce qui reste : la mise en relation, et des faits vérifiables.
  assert.equal(body.notaire.etude, 'Étude N');
  assert.equal(body.notaire.courriel, 'n@etude.ca');
  assert.equal(body.notaire.lienCNQ, FICHE, 'l’inscription au tableau est un fait, pas un témoignage');
  assert.equal(body.notaire.actes, 37, 'le nombre d’actes portés est un fait vérifiable');
});

test('une proposition porte l’appartenance à la Chambre et le volume — rien d’autre', async () => {
  const a = app();
  await seedNotaire(a);
  const bid = await offreAvecProposition(a);
  const p = parse(await vueClient(a, bid)).propositions[0];
  assert.equal(p.cnq, true, 'l’appartenance à l’Ordre reste un fait publiable');
  assert.equal(p.actes, 37);
  assert.equal(p.etude, 'Étude N');
  assert.equal(p.montant, 2400);
});

test('le notaire, lui, voit tout de ses propres évaluations — ce n’est pas de la publicité', async () => {
  const a = app();
  await seedNotaire(a);
  await a.repo.addNotaryEvaluation(NOTARY, { note: 5, commentaire: 'Impeccable.', serviceId: 'refinancement', dateISO: '2026-08-01', createdAt: '2026-08-02T00:00:00.000Z', bidId: 'x1' });

  const token = signToken(NOTARY, NOW_MS + 60_000, SCOPES.SESSION);
  const mes = parse(await a.handle({ method: 'GET', path: '/notary/evaluations', headers: bearer(token), query: {} }));
  assert.equal(mes.rating.note, 4.9, 'sa moyenne');
  assert.equal(mes.evaluations[0].commentaire, 'Impeccable.', 'et chaque commentaire');
  assert.ok(mes.cote.cote > 0, 'et sa cote');

  const console_ = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(token), query: {} }));
  assert.equal(console_.rating.avis, 40);
  assert.ok(console_.cote.cote > 0);
});

test('le client peut toujours ÉVALUER — c’est la publication qui est fermée, pas la collecte', async () => {
  const a = app();
  await seedNotaire(a);
  const bid = await offreAvecProposition(a);
  await a.repo.retain({ ...bid, status: domain.STATUS.RETENUE, notaryId: NOTARY, etude: 'Étude N' }, NOTARY);
  await a.repo.markActCompleted(bid.id, { bidId: bid.id, notaryId: NOTARY, actAmount: 2000, commissionCents: 30000, completedAt: TODAY });

  const res = await a.handle({
    method: 'POST', path: '/client/evaluation',
    headers: bearer(signToken(bid.id, NOW_MS + 60_000, SCOPES.CLIENT)),
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, note: 5, commentaire: 'Parfait.' }),
  });
  assert.equal(res.statusCode, 201, res.body);
  const profil = await a.repo.getNotary(NOTARY);
  assert.equal(profil.ratingCount, 41, 'l’évaluation entre bien au dossier');
});
