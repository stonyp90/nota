/**
 * L'adaptateur mémoire n'est pas plus indulgent que DynamoDB.
 *
 * Toute la pyramide de tests (domaine, API, contrat, DOM, BDD) tourne sur
 * `repo-memory.js`. Chaque endroit où il accepte ce que `repo-dynamo.js`
 * refuse est un bogue qui passe toutes les couches vertes et ne casse qu'en
 * production. Audit BDD du 2026-09-11 : deux de ces trous.
 *
 * 1. `get(id, dateISO)` — DynamoDB exige `dateISO` pour composer la clé
 *    (PK = MONTH#<mois>, SK = BID#<dateISO>#<id>) et LÈVE sans elle ; une date
 *    qui n'est pas celle de l'offre lit une autre clé et rend `null`. La
 *    mémoire cherchait par `id` seul : un appelant qui oubliait la date
 *    passait ici et tombait en 500 là-bas.
 *
 * 2. `appendAudit` — la promesse centrale du journal (ADR 0036 : append-only)
 *    est portée en DynamoDB par `attribute_not_exists(PK) OR
 *    attribute_not_exists(SK)`, la collision étant avalée. La mémoire faisait
 *    un `push` nu : une même clé (jour, ts, id) posée deux fois donnait deux
 *    lignes ici, une seule là-bas.
 *
 * Chaque test tient les DEUX adaptateurs à la même règle : celui de DynamoDB
 * sur un `doc` enregistreur, celui de la mémoire pour de vrai.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDynamoRepo } = require('../src/repo-dynamo.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const BID = { id: 'b1', dateISO: '2026-12-01', serviceId: 'refinancement', montant: 2400, status: 'ouverte' };

function recordingRepo({ items = {} } = {}) {
  const sent = [];
  const doc = {
    async send(cmd) {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      if (cmd.constructor.name === 'GetCommand') {
        const k = cmd.input.Key.PK + '|' + cmd.input.Key.SK;
        return items[k] ? { Item: items[k] } : {};
      }
      return {};
    },
  };
  return { repo: createDynamoRepo({ tableName: 'nota-main', adminTableName: 'nota-admin', doc }), sent };
}

// --- get(id, dateISO) ------------------------------------------------------

test('get sans dateISO lève — dans les deux adaptateurs, jamais un secours par id', async () => {
  const dyn = recordingRepo().repo;
  await assert.rejects(() => dyn.get('b1'), /requires dateISO/);
  await assert.rejects(() => dyn.get('b1', ''), /requires dateISO/);

  const mem = createMemoryRepo();
  await mem.put(BID);
  await assert.rejects(() => mem.get('b1'), /requires dateISO/);
  await assert.rejects(() => mem.get('b1', ''), /requires dateISO/);
  await assert.rejects(() => mem.get('b1', null), /requires dateISO/);
});

test('get avec une date qui n’est pas celle de l’offre rend null — c’est une autre clé', async () => {
  const stored = { PK: 'MONTH#2026-12', SK: 'BID#2026-12-01#b1', type: 'bid', ...BID };
  const { repo: dyn, sent } = recordingRepo({ items: { 'MONTH#2026-12|BID#2026-12-01#b1': stored } });
  assert.deepEqual(await dyn.get('b1', '2026-12-01'), BID);
  assert.equal(await dyn.get('b1', '2026-12-02'), null);
  assert.equal(sent.filter((s) => s.name === 'GetCommand').length, 2, 'deux lectures, deux clés');

  const mem = createMemoryRepo();
  await mem.put(BID);
  assert.deepEqual(await mem.get('b1', '2026-12-01'), BID);
  assert.equal(await mem.get('b1', '2026-12-02'), null, 'la mémoire lit la même clé composée');
  assert.equal(await mem.get('inconnu', '2026-12-01'), null);
});

// --- appendAudit / appendTxAudit : écrit une fois ---------------------------

const TS = '2026-09-03T19:30:00.000Z';
const ENTREE = { id: 'a1', ts: TS, day: '2026-09-03', action: 'acte_regle', meta: { bidId: 'b1' } };

test('le journal DynamoDB est écrit une fois par clé, et la collision est avalée', async () => {
  const { repo, sent } = recordingRepo();
  await repo.appendAudit(ENTREE);
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.ConditionExpression, 'attribute_not_exists(PK) OR attribute_not_exists(SK)');
  assert.equal(put.input.Item.PK, 'AUDIT#2026-09-03');
  assert.equal(put.input.Item.SK, TS + '#a1');

  // La collision est avalée (repo-dynamo.js appendAudit .catch) : l'appelant
  // ne la voit pas, et la première ligne reste.
  const collision = { async send() { const e = new Error('x'); e.name = 'ConditionalCheckFailedException'; throw e; } };
  const heurte = createDynamoRepo({ tableName: 'nota-main', adminTableName: 'nota-admin', doc: collision });
  await heurte.appendAudit(ENTREE);
  await heurte.appendTxAudit(ENTREE);
});

test('l’adaptateur mémoire tient la même clé : deux écritures de (jour, ts, id) ne font qu’une ligne', async () => {
  const repo = createMemoryRepo();
  await repo.appendAudit(ENTREE);
  // Une seconde écriture — une relance, un rejeu — porte un contenu DIFFÉRENT :
  // c'est la première qui doit rester, exactement comme en DynamoDB.
  await repo.appendAudit({ ...ENTREE, meta: { bidId: 'REJOUE' } });
  const jour = await repo.queryAuditByDay('2026-09-03');
  assert.equal(jour.length, 1, 'append-only : une clé, une ligne');
  assert.deepEqual(jour[0].meta, { bidId: 'b1' }, 'la première écriture fait foi');

  // Une AUTRE clé (autre id, même instant) s'ajoute normalement.
  await repo.appendAudit({ ...ENTREE, id: 'a2' });
  assert.equal((await repo.queryAuditByDay('2026-09-03')).length, 2);
});

test('le jour déduit de l’horodatage compose la clé comme le jour nommé', async () => {
  // Dynamo : `day = entry.day || ts.slice(0, 10)` puis PK = AUDIT#<day>. Une
  // entrée qui nomme son jour et la même entrée qui le laisse déduire visent
  // la MÊME clé — la seconde est donc un doublon.
  const repo = createMemoryRepo();
  const { day, ...sansJour } = ENTREE;
  await repo.appendAudit(ENTREE);
  await repo.appendAudit(sansJour);
  assert.equal((await repo.queryAuditByDay('2026-09-03')).length, 1);
});

test('la paire « transactions » tient la même règle, et vit dans sa propre table', async () => {
  const repo = createMemoryRepo();
  await repo.appendTxAudit(ENTREE);
  await repo.appendTxAudit({ ...ENTREE, meta: { bidId: 'REJOUE' } });
  assert.equal((await repo.queryTxAuditByDay('2026-09-03')).length, 1);
  assert.deepEqual((await repo.queryTxAuditByDay('2026-09-03'))[0].meta, { bidId: 'b1' });
});

test('les signaux d’apprentissage, même flux append-only, même garde', async () => {
  const repo = createMemoryRepo();
  const signal = { id: 's1', ts: TS, day: '2026-09-03', kind: 'x' };
  await repo.appendLearningSignal(signal);
  await repo.appendLearningSignal({ ...signal, kind: 'REJOUE' });
  const jour = await repo.queryNotaryLearningByDay('2026-09-03');
  assert.equal(jour.length, 1);
  assert.equal(jour[0].kind, 'x');
});
