// Le client doit connaître le prix de Nota AVANT d'autoriser sa carte.
//
// L'ADR 0031 fait porter à l'autorisation le TOTAL de deux lignes : les
// honoraires offerts au notaire et le prix du service de Nota. Jusqu'ici, la
// seconde n'apparaissait nulle part avant la page de paiement : le client
// découvrait le supplément chez Stripe.
//
//   Art. 68 C.déont. — « aucune publicité fausse, trompeuse, INCOMPLÈTE ou
//   susceptible d'induire en erreur ».
//   Art. 71 3° — qui annonce des honoraires doit « indiquer si les débours et
//   les taxes sont ou non inclus ».
//
// Le carnet est la première réponse que le navigateur reçoit : le tarif y
// voyage, pour qu'aucune surface n'ait à deviner un prix ni à en coder un en
// dur. Les taxes et les débours sont déclarés pour ce qu'ils sont — absents —
// parce qu'une omission est précisément ce que l'art. 68 nomme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { DEFAULT_PRIX_CENTS } = require('../src/prix-nota-config.js');

const TODAY = '2026-08-12';
const parse = (res) => JSON.parse(res.body);
const app = (env) => {
  const repo = createMemoryRepo([]);
  return { ...createApp(repo, { now: () => TODAY, env }), repo };
};
const carnet = (a) => a.handle({ method: 'GET', path: '/bids', headers: {}, query: {} });

test('le carnet public porte le prix de Nota', async () => {
  const body = parse(await carnet(app()));
  assert.ok(body.tarif, 'le carnet annonce le tarif de la plateforme');
  assert.equal(body.tarif.prixNotaCents, DEFAULT_PRIX_CENTS);
});

test('ART. 71 3° — le tarif dit si les taxes et les débours sont inclus', async () => {
  const { tarif } = parse(await carnet(app()));
  // Aujourd'hui : ni l'un ni l'autre n'existe dans le produit. Le dire est une
  // obligation ; le taire est l'infraction. Le jour où ils seront calculés,
  // ces deux drapeaux basculeront et la copie suivra sans être réécrite.
  assert.equal(tarif.taxesIncluses, false);
  assert.equal(tarif.deboursInclus, false);
});

test('le prix annoncé est celui du déploiement, jamais un nombre en dur', async () => {
  const { tarif } = parse(await carnet(app({ NOTA_PRIX_CENTS: '25000' })));
  assert.equal(tarif.prixNotaCents, 25000);
});

test('le tarif ne dépend d’aucun notaire — il est le même sans en connaître un seul', async () => {
  const a = app();
  const premier = parse(await carnet(a)).tarif;
  await a.repo.putNotary({
    id: 'n1', email: 'n1@e.ca', status: 'active', chargesEnabled: true,
    ratingSum: 5 * 40, ratingCount: 40, actsCompleted: 80, createdAt: TODAY,
  });
  const second = parse(await carnet(a)).tarif;
  assert.deepEqual(premier, second, 'art. 29.1 — aucune cote ne déplace ce prix');
});

test('ART. 68 — le prix ANNONCÉ est celui qui sera FACTURÉ, jamais un autre', async () => {
  const a = app();
  // L'opérateur change le prix du service. Le carnet doit annoncer le nouveau
  // prix, pas le défaut du déploiement : annoncer 400 $ et bloquer 250 $ sur
  // la carte serait précisément la publicité « incomplète » que l'art. 68
  // interdit — et la seule chose que le client verrait, c'est l'écart.
  await a.repo.putPrixNotaConfig({ prixCents: 25000 }, '2026-08-12T00:00:00.000Z');
  const { tarif } = parse(await carnet(a));
  assert.equal(tarif.prixNotaCents, 25000, 'le carnet suit le prix stocké');
});

test('un prix stocké illisible retombe sur le défaut plutôt que de faire tomber le carnet', async () => {
  const a = app();
  await a.repo.putPrixNotaConfig({ prixCents: 'oups' }, '2026-08-12T00:00:00.000Z');
  const res = await carnet(a);
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).tarif.prixNotaCents, DEFAULT_PRIX_CENTS);
});
