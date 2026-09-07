// L'ACCUSÉ « VU » NE DOIT PAS POUVOIR DÉ-RETENIR UN ACTE.
//
// `repo.update()` réécrit l'ITEM ENTIER (PutCommand sans condition, dans les
// deux adaptateurs). Les deux routes d'accusé de lecture — `/client/bid/lecture`
// et `/notary/bids/lecture` — faisaient `get` puis `update({ ...bid, luXAt })`
// sans relire le statut. Elles tirent à chaque ouverture du fil, donc très
// souvent.
//
// Si un `retain()` conditionnel atterrit entre le `get` et le `update`, la
// photo d'AVANT la retenue est réécrite par-dessus : l'acte redevient
// `ouverte`, `notaryId` disparaît, le notaire garde un pointeur `RETAINED#`
// vers une offre revenue au carnet public — et la caution posée sur la carte
// du client ne correspond plus à rien.
//
// Le commentaire de `repo-dynamo.update()` affirmait l'inverse : « Retention
// stays on the conditional retain() so the retained state itself can never be
// clobbered by a stale proposition write racing an accept. » Ces tests
// mesurent cette phrase.
//
// La correction ne touche pas aux quinze autres appelants d'`update()` : un
// accusé de lecture n'écrit QU'UN horodatage, il n'a aucune raison de
// réécrire l'item. Les deux adaptateurs gagnent donc un geste ciblé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const { createMemoryRepo } = require('../src/repo-memory.js');

const DATE = '2026-09-30';

const openBid = () => ({
  id: 'b1',
  serviceId: 'refinancement',
  dateISO: DATE,
  montant: 2400,
  tier: 'confort',
  status: 'ouverte',
  anonyme: true,
  courriel: 'client@example.ca',
  createdAt: '2026-09-01',
  dossierReady: true,
});

const retainedFrom = (bid) => ({ ...bid, status: 'retenue', notaryId: 'n1', etude: 'Étude n1' });

test('un accusé de lecture client bâti sur une photo périmée ne dé-retient pas l’acte', async () => {
  const repo = createMemoryRepo([openBid()]);

  // Le fil est à l'écran : la route lit l'offre…
  const photo = await repo.get('b1', DATE);
  assert.equal(photo.status, 'ouverte');

  // …un notaire retient pendant ce temps (écriture conditionnelle, elle gagne).
  const gagne = await repo.retain(retainedFrom(photo), 'n1');
  assert.ok(gagne, 'la retenue conditionnelle aurait dû passer');
  assert.equal((await repo.get('b1', DATE)).status, 'retenue');

  // …et l'accusé de lecture arrive après, avec sa photo d'avant.
  await repo.markThreadRead(photo, 'client', '2026-09-06T12:00:00.000Z');

  const apres = await repo.get('b1', DATE);
  assert.equal(apres.status, 'retenue', 'l’accusé de lecture a dé-retenu l’acte');
  assert.equal(apres.notaryId, 'n1', 'l’accusé de lecture a effacé le notaire qui tenait l’acte');
  assert.equal(apres.luParClientAt, '2026-09-06T12:00:00.000Z', 'l’horodatage n’a pas été posé');
});

test('un accusé de lecture notaire bâti sur une photo périmée n’annule pas une annulation', async () => {
  const repo = createMemoryRepo([retainedFrom(openBid())]);

  const photo = await repo.get('b1', DATE);
  // Le client annule pendant que le fil est à l'écran côté notaire.
  await repo.update({ ...photo, status: 'annulee', annulation: { statut: 'en_attente' } });

  await repo.markThreadRead(photo, 'notaire', '2026-09-06T12:05:00.000Z');

  const apres = await repo.get('b1', DATE);
  assert.equal(apres.status, 'annulee', 'l’accusé de lecture a ressuscité une offre annulée');
  assert.ok(apres.annulation, 'l’accusé de lecture a effacé le dossier d’annulation');
  assert.equal(apres.luParNotaireAt, '2026-09-06T12:05:00.000Z');
});

test('markThreadRead ne pose que l’horodatage demandé', async () => {
  const repo = createMemoryRepo([openBid()]);
  const avant = await repo.get('b1', DATE);

  await repo.markThreadRead(avant, 'client', '2026-09-06T12:00:00.000Z');
  const apres = await repo.get('b1', DATE);

  const change = Object.keys({ ...avant, ...apres })
    .filter((k) => JSON.stringify(avant[k]) !== JSON.stringify(apres[k]));
  assert.deepEqual(change, ['luParClientAt'], 'un autre champ que l’horodatage a bougé : ' + change.join(', '));
});

test('markThreadRead sur une offre disparue ne la recrée pas', async () => {
  const repo = createMemoryRepo([]);
  await repo.markThreadRead(openBid(), 'client', '2026-09-06T12:00:00.000Z');
  assert.equal(await repo.get('b1', DATE), null, 'une offre absente a été recréée par un accusé de lecture');
});

// Les deux adaptateurs doivent porter le même geste : la pile locale et les
// tests tournent sur la mémoire, la production sur DynamoDB. Une divergence
// ici serait invisible jusqu'au jour où elle coûte un acte.
test('les deux adaptateurs portent markThreadRead', () => {
  const { createDynamoRepo } = require('../src/repo-dynamo.js');
  const dynamo = createDynamoRepo({ tableName: 'nota-test', region: 'ca-central-1' });
  assert.equal(typeof dynamo.markThreadRead, 'function', 'repo-dynamo n’a pas markThreadRead');
  assert.equal(typeof createMemoryRepo([]).markThreadRead, 'function', 'repo-memory n’a pas markThreadRead');
});

// Et le handler doit s'en servir : le geste ciblé ne vaut que s'il remplace
// l'`update()` complet sur les deux routes.
test('les deux routes d’accusé de lecture n’écrivent plus l’item entier', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../src/handler.js', import.meta.url)), 'utf8');

  assert.ok(!/luParClientAt:\s*luLe\s*\}\)/.test(src),
    '/client/bid/lecture réécrit encore l’item entier via repo.update');
  assert.ok(!/luParNotaireAt:\s*luLe\s*\}\)/.test(src),
    '/notary/bids/lecture réécrit encore l’item entier via repo.update');
  assert.equal((src.match(/markThreadRead\(/g) || []).length, 2,
    'les deux routes doivent passer par markThreadRead');
});

void domain;
