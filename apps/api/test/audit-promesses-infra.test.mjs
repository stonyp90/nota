// LES PROMESSES QUE L'INFRA PORTE, RELUES CONTRE LE CODE (2026-09-04).
//
// Deux garanties de la piste d'audit vivent dans du Terraform que rien
// n'exécute en test : l'alarme qui doit crier quand une trace se perd, et le
// `Deny` IAM qui doit rendre le journal inaltérable. Une alarme muette et un
// Deny trop large se ressemblent beaucoup, vus d'ici : dans les deux cas tout
// est vert et la preuve est perdue. Ces tests confrontent donc le Terraform au
// comportement RÉEL du handler, plutôt qu'à ce que ses commentaires annoncent.
//
// Ce qu'ils défendent :
//   1. le motif du filtre de métrique retrouve la ligne TELLE QUE LAMBDA
//      L'ÉCRIT — préfixée, donc pas du JSON pur ;
//   2. le Deny ne couvre JAMAIS PutItem — l'y ajouter tuerait silencieusement
//      toute écriture d'audit, ce qui est pire que le trou qu'il ferme ;
//   3. et puisque PutItem reste permis, la seule chose qui empêche d'écraser
//      une entrée est la `ConditionExpression` de l'adaptateur, sur LES DEUX
//      journaux. Elle n'est pas un détail de style : c'est la garantie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createDynamoRepo } = require('../src/repo-dynamo.js');

const lire = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const OBSERVABILITY = lire('../../../infra/observability.tf');
const LAMBDA_TF = lire('../../../infra/lambda.tf');
const ADMIN_TF = lire('../../../infra/admin.tf');

// Le motif tel qu'il est écrit dans le Terraform, dé-échappé une fois (HCL).
function motifDuFiltre() {
  const m = OBSERVABILITY.match(/audit_failure_pattern\s*=\s*"((?:[^"\\]|\\.)*)"/);
  assert.ok(m, 'infra/observability.tf ne déclare plus `audit_failure_pattern`');
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

// La ligne que le handler émet vraiment quand le puits d'audit casse.
async function ligneEmise() {
  const repo = createMemoryRepo([]);
  repo.appendTxAudit = async () => { throw new Error('ProvisionedThroughputExceeded'); };
  const app = createApp(repo, {
    now: () => '2026-09-03',
    nowMs: () => Date.parse('2026-09-03T19:30:00.000Z'),
    notaryConsoleUrl: 'https://nota.example',
  });

  const lignes = [];
  const vrai = console.error;
  console.error = (...args) => lignes.push(args.join(' '));
  try {
    await app.handle({
      method: 'POST', path: '/notary/session/request',
      body: JSON.stringify({ email: 'inconnu@ailleurs.ca' }), sourceIp: '203.0.113.7',
    });
  } finally {
    console.error = vrai;
  }
  assert.equal(lignes.length, 1, 'le handler n’a pas crié : il n’y a rien à apparier');
  return lignes[0];
}

// Le format TEXTE du runtime Node de Lambda — le défaut, faute de
// `logging_config` sur les fonctions (infra/lambda.tf). Chaque appel à
// console.error part préfixé de l'horodatage, de l'identifiant de requête et du
// niveau, séparés par des tabulations.
const commeLambda = (message) =>
  '2026-09-03T19:30:00.123Z\t8f4b0c2e-1d3a-4c5b-9e7f-2a1b3c4d5e6f\tERROR\t' + message + '\n';

test('le motif du filtre n’est pas un motif JSON — Lambda préfixe ses lignes', async () => {
  // LE PIÈGE. Un motif JSON (`{ $.event = "…" }`) n'apparie que si l'événement
  // de journal est, EN ENTIER, du JSON valide. La ligne de Lambda ne l'est pas :
  // le JSON y commence après trois champs et deux tabulations. Un tel motif
  // n'apparierait donc jamais rien — et l'alarme resterait à OK pour toujours,
  // ce qui est exactement l'apparence d'un puits d'audit en bonne santé. Une
  // alarme qui ne peut pas se déclencher est pire qu'une alarme absente : elle
  // se fait passer pour une surveillance.
  const motif = motifDuFiltre();
  assert.ok(
    !motif.trim().startsWith('{'),
    'motif JSON `' + motif + '` : il exigerait que la ligne entière soit du JSON, ' +
      'or Lambda écrit `<horodatage>\\t<requestId>\\tERROR\\t{…}`'
  );
});

test('le motif retrouve la ligne que le handler écrit vraiment, préfixée par Lambda', async () => {
  const motif = motifDuFiltre();
  const evenement = commeLambda(await ligneEmise());

  // Un motif texte CloudWatch apparie les termes entre guillemets comme des
  // sous-chaînes exactes. Chacun doit donc se retrouver dans la ligne.
  const termes = (motif.match(/"([^"]*)"/g) || []).map((t) => t.slice(1, -1));
  assert.ok(termes.length, 'un motif sans terme cité n’apparie rien de vérifiable : ' + motif);
  for (const terme of termes) {
    assert.ok(evenement.includes(terme), 'terme « ' + terme + ' » absent de la ligne émise : ' + evenement);
  }
});

test('le motif survit aussi à un journal passé en format JSON — le terme n’est pas ré-échappé', async () => {
  // Si un jour `logging_config { log_format = "JSON" }` est posé, la ligne de
  // console.error devient la VALEUR d'un champ `message`, donc ré-échappée :
  // les guillemets internes prennent une barre oblique inverse. Un motif qui
  // citerait `"event":"audit_write_failed"` cesserait d'apparier ce jour-là,
  // sans que rien ne le signale. Un terme sans guillemet interne, lui, traverse.
  const motif = motifDuFiltre();
  const brut = await ligneEmise();
  const enveloppeJson = JSON.stringify({
    timestamp: '2026-09-03T19:30:00.123Z', level: 'ERROR',
    requestId: '8f4b0c2e-1d3a-4c5b-9e7f-2a1b3c4d5e6f', message: brut,
  });
  const termes = (motif.match(/"([^"]*)"/g) || []).map((t) => t.slice(1, -1));
  for (const terme of termes) {
    assert.ok(enveloppeJson.includes(terme), 'terme « ' + terme + ' » perdu si le journal passe en JSON');
  }
});

test('les deux filtres et l’alarme partagent le MÊME motif — sinon un puits devient sourd', () => {
  const filtres = OBSERVABILITY.match(/pattern\s*=\s*local\.audit_failure_pattern/g) || [];
  assert.equal(filtres.length, 2, 'les deux groupes de logs (api, admin) doivent citer le motif partagé');
});

test('le Deny IAM ne couvre JAMAIS PutItem — l’y ajouter tuerait le journal', () => {
  // La tentation est réelle : PutItem écrase par défaut, donc il « manque » au
  // Deny. Mais PutItem EST l'écriture du journal. Le refuser ne rendrait pas la
  // piste inaltérable, il la rendrait vide — une preuve perdue par excès de
  // zèle, ce qui est la façon la plus coûteuse de se tromper ici.
  for (const [nom, src] of [['lambda.tf', LAMBDA_TF], ['admin.tf', ADMIN_TF]]) {
    const bloc = src.match(/effect\s*=\s*"Deny"[\s\S]*?\n\s{2}\}/);
    assert.ok(bloc, nom + ' : plus aucun statement Deny sur les partitions d’audit');
    assert.doesNotMatch(bloc[0], /dynamodb:PutItem/, nom + ' : PutItem refusé — plus aucune trace ne s’écrirait');
    assert.match(bloc[0], /dynamodb:DeleteItem/, nom + ' : DeleteItem doit rester refusé');
    assert.match(bloc[0], /dynamodb:UpdateItem/, nom + ' : UpdateItem doit rester refusé');
    assert.match(bloc[0], /dynamodb:BatchWriteItem/, nom + ' : BatchWriteItem doit rester refusé');
    // ForAnyValue, et non ForAllValues : un lot mêlant une clé AUDIT#* à
    // d'autres doit être refusé EN ENTIER. ForAllValues laisserait passer.
    assert.match(bloc[0], /ForAnyValue:StringLike/, nom + ' : ForAllValues laisserait passer un lot mixte');
  }
});

test('PutItem restant permis, la ConditionExpression est la SEULE garde contre l’écrasement — sur les deux journaux', async () => {
  // Ce que l'IAM ne peut pas promettre, l'adaptateur doit le tenir : aucune
  // condition IAM ne sait exiger qu'un PutItem porte une ConditionExpression.
  // La retirer d'un des deux journaux rouvrirait donc le trou que le Deny
  // croyait fermer, sans qu'aucune alarme ne le dise.
  const sent = [];
  const doc = { async send(cmd) { sent.push({ name: cmd.constructor.name, input: cmd.input }); return {}; } };
  const repo = createDynamoRepo({ tableName: 'nota-main', adminTableName: 'nota-admin', doc });
  const entree = { id: 'a1', ts: '2026-09-03T19:30:00.000Z', day: '2026-09-03', action: 'acte_regle' };

  await repo.appendTxAudit(entree);
  await repo.appendAudit(entree);

  const puts = sent.filter((s) => s.name === 'PutCommand');
  assert.equal(puts.length, 2, 'un journal de transactions ET un journal administratif');
  assert.deepEqual(puts.map((p) => p.input.TableName), ['nota-main', 'nota-admin']);
  for (const put of puts) {
    assert.match(String(put.input.ConditionExpression), /attribute_not_exists/,
      'journal ' + put.input.TableName + ' : sans cette condition, un PutItem écrase la preuve');
  }
});
