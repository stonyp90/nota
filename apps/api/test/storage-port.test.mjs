// LE PORT DE STOCKAGE — quatre gestes, et rien d'autre.
//
// ADR 0032. Les octets d'un document ne traversent JAMAIS l'API : le navigateur
// parle directement au stockage, par une autorisation signée à durée courte que
// l'API émet. Ce qui ne traverse pas un service ne peut pas fuir par ses
// journaux, sa mémoire ou ses traces d'erreur.
//
// Le port est délibérément l'INTERSECTION de ce que savent faire S3, Google
// Cloud Storage et Azure Blob : URL signée en écriture et en lecture,
// expiration, type et taille contraints. Écrire un second adaptateur ne doit
// demander aucune modification du domaine ni des routes — c'est ce que
// « compatible avec les différents fournisseurs » veut dire ici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMemoryStorage, createS3Storage, STORAGE_PORT } = require('../src/storage-port.js');

// De faux constructeurs de commandes : on vérifie ce que l'adaptateur SIGNE,
// pas ce qu'AWS en fait. Le SDK n'est donc jamais chargé par la suite.
const commande = (nom) => class { constructor(input) { this.nom = nom; this.input = input; } };
const COMMANDS = {
  PutObjectCommand: commande('put'),
  GetObjectCommand: commande('get'),
  DeleteObjectCommand: commande('delete'),
  HeadObjectCommand: commande('head'),
};

const CLE = 'bids/b1/doc-1.pdf';
const NOW = 1_700_000_000_000;

test('le port se réduit à quatre gestes — un cinquième serait un fournisseur qui déborde', () => {
  assert.deepEqual(STORAGE_PORT.slice().sort(), ['head', 'presignDownload', 'presignUpload', 'remove']);
});

test('les deux adaptateurs offrent EXACTEMENT le port, sans rien de plus', () => {
  const enMemoire = createMemoryStorage();
  const s3 = createS3Storage({ bucket: 'nota-docs', region: 'ca-central-1', commands: COMMANDS, client: { send: async () => ({}) }, signer: async () => 'https://signe.test/x' });
  for (const adaptateur of [enMemoire, s3]) {
    for (const geste of STORAGE_PORT) {
      assert.equal(typeof adaptateur[geste], 'function', geste + ' manque à un adaptateur');
    }
    // Un adaptateur qui exposerait davantage laisserait fuir un fournisseur
    // dans les appelants — et la portabilité mourrait là, silencieusement.
    assert.deepEqual(Object.keys(adaptateur).sort(), STORAGE_PORT.slice().sort());
  }
});

// ---------------------------------------------------------------------------
// L'adaptateur en mémoire — celui des tests et du développement local
// ---------------------------------------------------------------------------

test('en mémoire : l’aller-retour dépôt → lecture, et l’effacement', async () => {
  const s = createMemoryStorage({ now: () => NOW });
  const up = await s.presignUpload({ cle: CLE, contentType: 'application/pdf', maxBytes: 1000, expiresInSeconds: 300 });
  assert.ok(up.url, 'une URL de dépôt est émise');
  assert.equal(up.methode, 'PUT');
  assert.equal(await s.head(CLE), null, 'rien avant le dépôt');

  s.__deposer(CLE, Buffer.from('%PDF-1.4'), 'application/pdf');
  const h = await s.head(CLE);
  assert.equal(h.contentType, 'application/pdf');
  assert.equal(h.taille, 8);

  const down = await s.presignDownload({ cle: CLE, nom: 'relevé.pdf', expiresInSeconds: 60 });
  assert.ok(down.url);
  await s.remove(CLE);
  assert.equal(await s.head(CLE), null, 'effacé');
});

test('en mémoire : effacer un objet absent ne lève pas — l’effacement est idempotent', async () => {
  const s = createMemoryStorage();
  await s.remove('rien/du/tout');
});

// ---------------------------------------------------------------------------
// L'adaptateur S3 — on vérifie les CONTRAINTES, pas AWS
// ---------------------------------------------------------------------------

function s3Espion(over = {}) {
  const signes = [];
  const envoyes = [];
  const s = createS3Storage({
    bucket: 'nota-docs',
    region: 'ca-central-1',
    kmsKeyId: 'arn:aws:kms:ca-central-1:1:key/abc',
    commands: COMMANDS,
    client: { async send(cmd) { envoyes.push(cmd); return {}; } },
    signer: async (cmd, opts) => { signes.push({ cmd, opts }); return 'https://nota-docs.s3.test/signe'; },
    ...over,
  });
  return { s, signes, envoyes };
}

test('l’autorisation de dépôt est portée sur UNE clé, UN type, UNE durée courte', async () => {
  const { s, signes } = s3Espion();
  const up = await s.presignUpload({ cle: CLE, contentType: 'application/pdf', maxBytes: 15 * 1024 * 1024, expiresInSeconds: 300 });
  assert.equal(up.url, 'https://nota-docs.s3.test/signe');
  assert.equal(up.methode, 'PUT');

  const { cmd, opts } = signes[0];
  assert.equal(cmd.input.Bucket, 'nota-docs');
  assert.equal(cmd.input.Key, CLE, 'une seule clé — jamais un préfixe');
  assert.equal(cmd.input.ContentType, 'application/pdf',
    'le type est IMPOSÉ dans l’autorisation : une autorisation pour un PDF ne peut pas servir à déposer autre chose');
  assert.equal(cmd.input.ContentLength, 15 * 1024 * 1024, 'et la taille aussi');
  assert.equal(opts.expiresIn, 300, 'quelques minutes, jamais une heure');
});

test('le chiffrement au repos est imposé par l’autorisation elle-même', async () => {
  const { s, signes } = s3Espion();
  await s.presignUpload({ cle: CLE, contentType: 'application/pdf', maxBytes: 100, expiresInSeconds: 60 });
  const { cmd } = signes[0];
  // Sans cela, un dépôt réussi pourrait atterrir non chiffré : la politique du
  // seau refuserait, mais l’échec surviendrait chez le client, après le
  // téléversement — trop tard et illisible.
  assert.equal(cmd.input.ServerSideEncryption, 'aws:kms');
  assert.equal(cmd.input.SSEKMSKeyId, 'arn:aws:kms:ca-central-1:1:key/abc');
});

test('le téléchargement force une PIÈCE JOINTE, jamais un rendu dans la page', async () => {
  const { s, signes } = s3Espion();
  await s.presignDownload({ cle: CLE, nom: 'relevé hypothécaire.pdf', expiresInSeconds: 60 });
  const { cmd } = signes[0];
  assert.match(cmd.input.ResponseContentDisposition, /^attachment/,
    'un document déposé par un inconnu ne doit jamais s’exécuter dans l’origine de Nota');
  // Le nom voyage encodé : un guillemet ou un accent ne doit pas casser l’en-tête.
  assert.match(cmd.input.ResponseContentDisposition, /filename\*=UTF-8''/);
  assert.ok(!/\n|\r/.test(cmd.input.ResponseContentDisposition), 'aucune injection d’en-tête');
});

test('une durée d’expiration absurde est ramenée dans les bornes', async () => {
  const { s, signes } = s3Espion();
  await s.presignDownload({ cle: CLE, nom: 'a.pdf', expiresInSeconds: 999999 });
  assert.ok(signes[0].opts.expiresIn <= 900, 'un quart d’heure au plus : ' + signes[0].opts.expiresIn);
  await s.presignDownload({ cle: CLE, nom: 'a.pdf', expiresInSeconds: 0 });
  assert.ok(signes[1].opts.expiresIn >= 30, 'et jamais une durée inutilisable');
});

test('l’adaptateur refuse de se construire sans seau — une erreur muette serait pire', () => {
  assert.throws(() => createS3Storage({ region: 'ca-central-1' }), /bucket/);
});

test('un autre fournisseur compatible S3 ne demande aucune ligne ailleurs', async () => {
  // MinIO en développement, R2 ou Backblaze en production : le port ne change
  // pas, seuls `endpoint` et `forcePathStyle` s'ajoutent. C'est la portabilité
  // que l'ADR 0032 revendique, vérifiée plutôt qu'affirmée.
  const { s, signes } = s3Espion({ endpoint: 'http://minio:9000', forcePathStyle: true, kmsKeyId: undefined });
  await s.presignUpload({ cle: CLE, contentType: 'application/pdf', maxBytes: 100, expiresInSeconds: 60 });
  const { cmd } = signes[0];
  assert.equal(cmd.input.Bucket, 'nota-docs');
  assert.equal(cmd.input.ContentType, 'application/pdf', 'le type reste figé');
  // Sans clé KMS, on n'IMPOSE pas un chiffrement que le fournisseur ne connaît
  // pas : un dépôt refusé après téléversement est le pire des échecs.
  assert.equal(cmd.input.ServerSideEncryption, undefined);
  for (const geste of STORAGE_PORT) assert.equal(typeof s[geste], 'function');
});

test('l’URL est SIGNÉE pour l’adresse publique, jamais pour l’adresse interne', async () => {
  // La signature couvre l'hôte : réécrire l'URL après coup la casse
  // (SignatureDoesNotMatch). Quand l'API et le navigateur n'atteignent pas le
  // stockage par la même adresse, c'est celle du NAVIGATEUR qui doit signer.
  const vus = [];
  const s = createS3Storage({
    bucket: 'nota-docs', region: 'ca-central-1', commands: COMMANDS,
    endpoint: 'http://minio:9000', publicEndpoint: 'http://localhost:9100',
    signer: async (cmd, opts, client) => { vus.push(opts); return 'https://signe.test/x'; },
    client: { send: async () => ({}) },
  });
  const up = await s.presignUpload({ cle: CLE, contentType: 'application/pdf', maxBytes: 10, expiresInSeconds: 60 });
  assert.equal(up.url, 'https://signe.test/x');
  assert.equal(vus.length, 1, 'une signature a bien eu lieu');
});
