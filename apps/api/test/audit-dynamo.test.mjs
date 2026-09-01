// La piste d'audit doit exister EN PRODUCTION, pas seulement en mémoire.
//
// Le trou trouvé le 2026-09-01 : la Lambda publique construit son repo SANS
// `adminTableName` (apps/api/index.js) et son rôle IAM n'accorde DynamoDB que
// sur la table principale (infra/lambda.tf). Une trace de règlement écrite
// dans la table admin lève donc à l'appel, le `catch` best-effort l'avale, et
// le journal n'existe que sous l'adaptateur mémoire — c'est-à-dire uniquement
// dans les tests. Ces tests pilotent l'adaptateur DynamoDB avec un faux
// enregistreur : ils échouent si la trace repart vers la mauvaise table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDynamoRepo } = require('../src/repo-dynamo.js');

function recordingRepo(reply) {
  const sent = [];
  const doc = {
    async send(cmd) {
      const rec = { name: cmd.constructor.name, input: cmd.input };
      sent.push(rec);
      return reply ? reply(rec) : {};
    },
  };
  // Exactement le câblage de la Lambda PUBLIQUE : aucune table admin.
  return { repo: createDynamoRepo({ tableName: 'nota-main', doc }), sent };
}

const ENTREE = {
  id: 'a1', ts: '2026-08-12T19:00:00.000Z', day: '2026-08-12',
  action: 'acte_regle', adminId: null, email: null, ip: null,
  meta: { bidId: 'b1', montant: 2000, taux: 0.15, cote: 51, commission: 300, net: 1700 },
};

test('la trace de transaction s’écrit dans la table PRINCIPALE, sans table admin configurée', async () => {
  const { repo, sent } = recordingRepo();
  await repo.appendTxAudit(ENTREE);

  const put = sent.find((s) => s.name === 'PutCommand');
  assert.ok(put, 'aucune écriture émise');
  assert.equal(put.input.TableName, 'nota-main', 'la table admin est hors de portée de la Lambda publique');
  assert.equal(put.input.Item.PK, 'AUDIT#2026-08-12', 'partitionnée par jour ouvrable');
  assert.ok(String(put.input.Item.SK).startsWith('2026-08-12T19:00:00.000Z#'), 'triée par instant');
  assert.equal(put.input.Item.type, 'audit');
  assert.equal(put.input.Item.action, 'acte_regle');
  assert.equal(put.input.Item.meta.commission, 300);
  assert.match(String(put.input.ConditionExpression), /attribute_not_exists/, 'append-only : jamais d’écrasement');
});

test('le journal administratif, lui, exige toujours la table admin', async () => {
  const { repo } = recordingRepo();
  await assert.rejects(() => repo.appendAudit(ENTREE), /admin table not configured/);
});

test('la relecture d’un jour interroge la table principale par sa partition', async () => {
  const { repo, sent } = recordingRepo((rec) =>
    rec.name === 'QueryCommand'
      ? { Items: [{ PK: 'AUDIT#2026-08-12', SK: '2026-08-12T19:00:00.000Z#a1', type: 'audit', ...ENTREE }] }
      : {}
  );
  const entrees = await repo.queryTxAuditByDay('2026-08-12');
  const q = sent.find((s) => s.name === 'QueryCommand');
  assert.equal(q.input.TableName, 'nota-main');
  assert.equal(q.input.ExpressionAttributeValues[':pk'], 'AUDIT#2026-08-12');
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].action, 'acte_regle');
  assert.equal(entrees[0].PK, undefined, 'les clés de table ne remontent jamais');
});

test('le registre des notaires voit AUSSI ceux qui n’ont pas fini leur inscription', async () => {
  // L'index GSI1 était creux — seuls les actifs y entraient — donc la console
  // ne voyait ni les notaires en inscription, ni la créance de celui qui part.
  const { repo, sent } = recordingRepo((rec) => (rec.name === 'QueryCommand'
    ? { Items: [
        { PK: 'NOTARY#n1', SK: 'PROFILE', type: 'notary', id: 'n1', status: 'active' },
        { PK: 'NOTARY#n2', SK: 'PROFILE', type: 'notary', id: 'n2', status: 'onboarding', commissionCentsDue: 4200 },
      ] }
    : {}));

  const tous = await repo.listNotaries();
  assert.deepEqual(tous.map((n) => n.id), ['n1', 'n2'], 'le registre les voit tous');

  const actifs = await repo.listActiveNotaries();
  assert.deepEqual(actifs.map((n) => n.id), ['n1'], 'le digest quotidien, lui, ne parle qu’aux actifs');
  assert.ok(sent.every((s) => s.name !== 'ScanCommand'), 'jamais un Scan');
});

test('un notaire en inscription entre bien dans l’index — sinon le registre ne le verra jamais', async () => {
  const { repo, sent } = recordingRepo();
  await repo.putNotary({ id: 'n9', status: 'onboarding', email: 'n9@etude.ca', label: 'Étude 9' });
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.TableName, 'nota-main');
  assert.ok(put.input.Item.GSI1PK, 'aucune appartenance à l’index : le profil serait invisible');
});
