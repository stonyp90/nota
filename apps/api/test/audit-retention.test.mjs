/**
 * La rétention du journal d'audit, posée à l'ÉCRITURE.
 *
 * `docs/legal/politique-conservation-des-donnees.md` §1 nomme sept ans pour le
 * journal d'audit ; le §2 constatait qu'aucun `ttl` n'était posé. Un journal
 * qu'on ne détruit jamais n'est pas conforme à la Loi 25 — la conservation doit
 * être bornée — et la borne ne peut pas vivre dans le handler seul : DEUX
 * journaux existent (les gestes d'administration dans la table admin, les
 * mouvements d'argent et les accès dans la table principale) et ils ont deux
 * appelants. La borne vit donc dans l'ADAPTATEUR, le seul endroit que les deux
 * traversent.
 *
 * Et une garde qui ne se voit qu'ici : la liste de suppression (UNSUB#) ne doit
 * JAMAIS expirer. Oublier un refus de communication, c'est le violer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDynamoRepo } = require('../src/repo-dynamo.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const domain = require('@nota/domain');

function recordingRepo({ adminTableName } = {}) {
  const sent = [];
  const doc = { async send(cmd) { sent.push({ name: cmd.constructor.name, input: cmd.input }); return {}; } };
  return { repo: createDynamoRepo({ tableName: 'nota-main', adminTableName, doc }), sent };
}

const TS = '2026-09-03T19:30:00.000Z';
const ENTREE = { id: 'a1', ts: TS, day: '2026-09-03', action: 'acte_regle', meta: { bidId: 'b1' } };
const ECHEANCE = domain.auditRetentionTtl(Date.parse(TS));

test('la trace de transaction porte l’échéance de sept ans, calculée sur son propre horodatage', async () => {
  const { repo, sent } = recordingRepo();
  await repo.appendTxAudit(ENTREE);
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.Item.ttl, ECHEANCE);
  // Pas un « maintenant » : deux entrées écrites le même jour pour des instants
  // différents expirent à des instants différents.
  assert.equal(new Date(put.input.Item.ttl * 1000).toISOString(), '2033-09-03T19:30:00.000Z');
});

test('le journal administratif porte la MÊME échéance — une seule politique, deux tables', async () => {
  const { repo, sent } = recordingRepo({ adminTableName: 'nota-admin' });
  await repo.appendAudit(ENTREE);
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.Item.TableName, undefined);
  assert.equal(put.input.TableName, 'nota-admin');
  assert.equal(put.input.Item.ttl, ECHEANCE);
});

test('l’adaptateur mémoire pose la même échéance — sinon les tests mentiraient sur la production', async () => {
  const repo = createMemoryRepo();
  await repo.appendTxAudit(ENTREE);
  const [entree] = await repo.queryTxAuditByDay('2026-09-03');
  assert.equal(entree.ttl, ECHEANCE);
});

test('une échéance déjà décidée par l’appelant est respectée, jamais réécrite', async () => {
  const { repo, sent } = recordingRepo();
  await repo.appendTxAudit({ ...ENTREE, ttl: 4102444800 });
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.Item.ttl, 4102444800);
});

test('un horodatage illisible ne fabrique pas une échéance — l’entrée survit plutôt que d’expirer au hasard', async () => {
  const { repo, sent } = recordingRepo();
  await repo.appendTxAudit({ id: 'a2', ts: 'pas-une-date', day: '2026-09-03', action: 'document_lu' });
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.ok(!('ttl' in put.input.Item) || put.input.Item.ttl == null, 'aucune expiration inventée');
});

test('la liste de suppression n’expire JAMAIS : oublier un refus, c’est le violer', async () => {
  const { repo, sent } = recordingRepo();
  await repo.putUnsubscribe('personne@exemple.ca', TS);
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.Item.PK, 'UNSUB#personne@exemple.ca');
  assert.equal(put.input.Item.ttl, undefined, 'un désabonnement ne porte aucun ttl');
});
