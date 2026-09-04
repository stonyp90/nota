// POST /notary/profile — the notary attaches (or clears) the link of their
// official fiche in the Chambre des notaires directory (ADR 0016). Clients see
// the membership as a badge on propositions (`cnq`), and the full link only on
// the retained notaire block — like `courriel`, never before the retention.
// /notary/bids hands the console its own `profil`, sa cote et le TARIF que le
// client paie à Nota — jamais une part de ses honoraires (ADR 0031).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const domain = require('@nota/domain');
// ADR 0034 — la console reçoit la GRILLE et son « à partir de » : le prix que
// le client paie dépend du service et du délai, jamais du notaire qui lit.
const GRILLE = domain.prixNotaGrille();
const PRIX_MIN = GRILLE.defaut;

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  return { ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, ...opts }), repo };
}

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const clientToken = (bidId) => signToken(bidId, NOW_MS + 60_000, SCOPES.CLIENT);
const NOTARY = notaryIdForEmail('n@etude.ca');
const sessionToken = () => signToken(NOTARY, NOW_MS + 60_000, SCOPES.SESSION);
const FICHE = 'https://www.cnq.org/trouver-un-notaire/fiche/123/';

const postProfile = (a, token, body) =>
  a.handle({ method: 'POST', path: '/notary/profile', headers: bearer(token), body: JSON.stringify(body) });

async function seedNotary(a, over = {}) {
  await a.repo.putNotary({
    id: NOTARY, email: 'n@etude.ca', label: 'Étude N',
    status: 'active', chargesEnabled: true, connectAccountId: 'acct_n',
    ...over,
  });
}

test('the notary stores their CNQ fiche; the console reads it back from /notary/bids', async () => {
  const a = app();
  await seedNotary(a, { ratingSum: 9, ratingCount: 2, commissionCentsCollected: 12345 });

  const res = await postProfile(a, sessionToken(), { lienCNQ: '  ' + FICHE + '  ' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).profil.lienCNQ, FICHE);

  // The write is a spread on the existing record — billing identity, rating
  // aggregates and accumulator all survive.
  const notary = await a.repo.getNotary(NOTARY);
  assert.equal(notary.lienCNQ, FICHE);
  assert.equal(notary.status, 'active');
  assert.equal(notary.ratingSum, 9);
  assert.equal(notary.commissionCentsCollected, 12345);

  const consoleView = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(sessionToken()), query: {} }));
  assert.equal(consoleView.profil.lienCNQ, FICHE);
});

test('only the Chambre’s host passes; an empty link clears the fiche; a session token is required', async () => {
  const a = app();
  await seedNotary(a, { lienCNQ: FICHE });

  const bad = await postProfile(a, sessionToken(), { lienCNQ: 'https://cnq.org.evil.ca/fiche' });
  assert.equal(bad.statusCode, 422);
  assert.equal(parse(bad).errors[0].code, 'lien_cnq_invalide');
  assert.equal((await a.repo.getNotary(NOTARY)).lienCNQ, FICHE, 'a refused link never overwrites the stored one');

  const cleared = await postProfile(a, sessionToken(), { lienCNQ: '' });
  assert.equal(cleared.statusCode, 200);
  assert.equal(parse(cleared).profil.lienCNQ, null);
  assert.equal((await a.repo.getNotary(NOTARY)).lienCNQ, null);

  const anon = await a.handle({ method: 'POST', path: '/notary/profile', body: JSON.stringify({ lienCNQ: FICHE }) });
  assert.equal(anon.statusCode, 401);
  const feed = await postProfile(a, signToken(NOTARY, NOW_MS + 60_000, SCOPES.FEED), { lienCNQ: FICHE });
  assert.equal(feed.statusCode, 401, 'a feed-scoped token never writes a profile');
});

test('clients see the badge on propositions and the link only once retained', async () => {
  const a = app();
  await seedNotary(a, { lienCNQ: FICHE });

  // An open bid with a proposition from the CNQ-linked notary: badge, no link.
  await a.repo.put({
    id: 'b1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2800,
    status: domain.STATUS.OUVERTE, courriel: 'client@example.ca',
    propositions: [{ id: 'p1', notaryId: NOTARY, etude: 'Étude N', montant: 3200, delta: 400, status: 'en_attente', createdAt: TODAY }],
  });
  const open = parse(await a.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken('b1')), query: { id: 'b1', dateISO: '2026-08-20' } }));
  assert.equal(open.propositions[0].cnq, true);
  assert.equal(JSON.stringify(open.propositions).includes('cnq.org'), false, 'the fiche URL must never ride an open bid');
  assert.equal(open.notaire, null);

  // Retained by that notary: the full link rides the contact block.
  await a.repo.update({ ...(await a.repo.get('b1', '2026-08-20')), status: domain.STATUS.RETENUE, notaryId: NOTARY, etude: 'Étude N' });
  const mine = parse(await a.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken('b1')), query: { id: 'b1', dateISO: '2026-08-20' } }));
  assert.equal(mine.notaire.lienCNQ, FICHE);

  // A notary without a fiche: badge false, link null.
  await a.repo.putNotary({ ...(await a.repo.getNotary(NOTARY)), lienCNQ: null });
  const bare = parse(await a.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken('b1')), query: { id: 'b1', dateISO: '2026-08-20' } }));
  assert.equal(bare.notaire.lienCNQ, null);
});

test('/notary/bids ne montre PLUS aucun partage — le tarif du client, et la cote à part', async () => {
  // ADR 0031. Jusqu'au 1er septembre 2026 la console recevait un barème (taux
  // de base, taux effectif mérité par la cote, palier suivant) et l'écran en
  // tirait « vous gardez X % de ce que le client paie ». L'art. 29.1 du Code de
  // déontologie interdit au notaire toute convention mettant en péril son
  // indépendance et son désintéressement : un revenu indexé sur une note
  // attribuée par Nota en est une. Le notaire garde 100 % de ses honoraires, et
  // ce qu'il voit à la place est le prix que le CLIENT paie à Nota.
  const billing = createBilling({ repo: createMemoryRepo(), stripe: {} });
  const a = app({ billing });
  await seedNotary(a, { ratingSum: 45, ratingCount: 10, actsCompleted: 0, createdAt: '2026-08-10T00:00:00.000Z' });

  const view = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(sessionToken()), query: {} }));
  assert.equal(view.commission, undefined, 'plus aucun bloc de partage ne descend à la console');
  assert.deepEqual(view.tarif.grille, GRILLE, 'la grille que le client paie à Nota, en cents');
  assert.equal(view.tarif.prixNotaMinCents, PRIX_MIN, 'et son « à partir de »');
  // Ni pourcentage, ni part, ni cote : rien à recalculer, rien à négocier.
  assert.deepEqual(Object.keys(view.tarif).sort(),
    ['deboursInclus', 'grille', 'prixNotaMinCents', 'taxesIncluses']);

  // La cote survit intacte — elle classe, elle ouvre des dossiers, elle ne
  // touche simplement plus à un dollar.
  assert.ok(view.cote.cote > 0 && view.cote.cote < 100, 'une cote réelle : ' + view.cote.cote);
  assert.deepEqual(view.cote.axes.map((x) => x.id), ['satisfaction', 'services', 'disponibilite', 'presence']);
});

test('ART. 29.1 — la cote peut grimper au sommet, le tarif ne bouge pas d’un cent', async () => {
  const billing = createBilling({ repo: createMemoryRepo(), stripe: {} });
  const a = app({ billing });
  // Le dossier complet : aimé, volumineux sur tout le catalogue, disponible,
  // présent. Sa cote passe 90 — et le prix reste exactement le même.
  await seedNotary(a, {
    ratingSum: 4.9 * 40, ratingCount: 40,
    actsCompleted: 80, actsByService: { refinancement: 50, financement: 30 },
    proposalsCount: 60, acceptsCount: 0, declinesCount: 3,
    rayonKm: 50, urgences: true,
    lienCNQ: FICHE, prefixe: 'G1R',
    createdAt: '2025-01-01T00:00:00.000Z', lastSeenAt: '2026-08-12T00:00:00.000Z',
  });

  const view = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(sessionToken()), query: {} }));
  assert.ok(view.cote.cote > 90, 'la cote passe 90 : ' + view.cote.cote);
  assert.deepEqual(view.tarif.grille, GRILLE, 'la même grille que pour un notaire tout neuf');
  assert.equal(view.commission, undefined);
});

test('sans facturation configurée, la console reçoit quand même le tarif et sa cote', async () => {
  const a = app();
  await seedNotary(a);
  const view = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(sessionToken()), query: {} }));
  // Le prix ne dépend d'aucun compte Stripe : il se lit du déploiement.
  assert.deepEqual(view.tarif.grille, GRILLE);
  assert.equal(view.commission, undefined);
  // ADR 0033 — the whole profil block: the feed levers, the identity a
  // retained client receives (empty here, hence `complet: false` and the three
  // `manquants`), the courriel, and the alert preferences at their default.
  assert.deepEqual(view.profil, {
    lienCNQ: null, rayonKm: 0, urgences: false, prefixe: null,
    nom: null, etude: null, telephone: null, adresse: null, courriel: 'n@etude.ca',
    complet: false, manquants: domain.notaryContactMissing({}),
    alertes: { pace: 'daily', urgentOnly: false },
  });
});
