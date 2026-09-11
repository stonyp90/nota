// L'ANNULATION PAR LE CLIENT EMPORTE LES OCTETS (ADR 0032, « Nota est
// dépositaire, pas propriétaire »).
//
// Le désistement du notaire (/notary/bids/release) vidait le fil ET effaçait
// les octets du seau. L'annulation par le client (/client/bid/cancel) fermait
// l'accès — toute lecture répond 410 — mais laissait chaque pièce dans le
// seau et chaque référence `cle` sur l'offre : des documents qui survivaient à
// l'acte, atteignables par personne, et que ni les rappels ni la rétention ne
// rattrapaient. Ici : les deux portes de sortie de l'acte se comportent
// pareil pour les documents. L'argent, lui, reste l'affaire de l'annulation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createMemoryStorage } = require('../src/storage-port.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const domain = require('@nota/domain');

const TODAY = '2026-09-02';
const NOW_MS = Date.parse('2026-09-02T15:00:00.000Z');
const NOTAIRE = notaryIdForEmail('n@etude.ca');
const parse = (res) => JSON.parse(res.body);

// Le port de stockage en mémoire, avec un journal des effacements et un
// robinet pour les faire échouer : ce que l'appelant fait des erreurs du seau
// est précisément ce que ce fichier vérifie.
function stockageEspion({ echoue = false } = {}) {
  const base = createMemoryStorage({ now: () => NOW_MS });
  const effaces = [];
  return {
    ...base,
    effaces,
    __deposer: base.__deposer,
    async remove(cle) {
      effaces.push(String(cle));
      if (echoue) throw new Error('seau indisponible');
      return base.remove(cle);
    },
  };
}

function app({ storage } = {}) {
  const repo = createMemoryRepo([]);
  return { ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, storage }), repo, storage };
}

const jetonClient = () => signToken('b1', NOW_MS + 60_000, SCOPES.CLIENT);
const call = (a, method, path, { body, bearer } = {}) =>
  a.handle({ method, path, headers: bearer ? { authorization: 'Bearer ' + bearer } : {},
    body: body === undefined ? undefined : JSON.stringify(body) });

// Un acte retenu dont la conversation porte une pièce de chaque côté, toutes
// deux constatées (`pret`) et présentes dans le seau.
async function acteAvecPieces(a) {
  await a.repo.putNotary({ id: NOTAIRE, email: 'n@etude.ca', label: 'Étude N', status: 'active', createdAt: TODAY });
  const piece = (id, de, nom) => ({
    id, de, nom, type: 'application/pdf', taille: 1024, etat: 'pret',
    cle: domain.documentStorageKey('b1', id, nom), createdAt: TODAY,
  });
  const documents = [
    piece('d-client', domain.CHAT_FROM.CLIENT, 'relevé.pdf'),
    piece('d-notaire', domain.CHAT_FROM.NOTAIRE, 'projet.pdf'),
  ];
  const bid = {
    id: 'b1', dateISO: '2026-09-20', serviceId: 'refinancement', montant: 2000,
    tier: 'standard', status: domain.STATUS.RETENUE, anonyme: true, notaryId: NOTAIRE,
    etude: 'Étude N', courriel: 'client@exemple.ca', prefixe: 'G1R',
    pricing: { deplacement: 'client_50' }, createdAt: TODAY,
    messages: [{ id: 'm1', de: domain.CHAT_FROM.CLIENT, texte: 'Bonjour', createdAt: TODAY }],
    documents,
  };
  await a.repo.put(bid);
  if (a.storage) for (const d of documents) a.storage.__deposer(d.cle, Buffer.alloc(1024), 'application/pdf');
  return { bid, cles: documents.map((d) => d.cle) };
}

const annuler = (a) => call(a, 'POST', '/client/bid/cancel', { bearer: jetonClient(), body: { id: 'b1', dateISO: '2026-09-20' } });

test('l’annulation par le client efface chaque pièce du seau et vide les références', async () => {
  const a = app({ storage: stockageEspion() });
  const { cles } = await acteAvecPieces(a);
  for (const cle of cles) assert.ok(await a.storage.head(cle), 'les octets sont déposés avant l’annulation');

  const res = await annuler(a);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).bid.status, domain.STATUS.ANNULEE);

  assert.deepEqual([...a.storage.effaces].sort(), [...cles].sort(), 'chaque clé — client ET notaire — est effacée');
  for (const cle of cles) assert.equal(await a.storage.head(cle), null, 'les octets survivent à l’acte : ' + cle);

  const acte = await a.repo.get('b1', '2026-09-20');
  assert.equal(acte.status, domain.STATUS.ANNULEE);
  assert.deepEqual(acte.documents, [], 'aucune référence `cle` ne reste sur l’offre annulée');
  assert.equal(JSON.stringify(acte).includes('offres/b1/'), false, 'aucune clé de stockage ne subsiste dans l’acte');
});

test('un seau qui refuse l’effacement n’empêche pas l’annulation — les octets sont secondaires', async () => {
  const a = app({ storage: stockageEspion({ echoue: true }) });
  const { cles } = await acteAvecPieces(a);

  const res = await annuler(a);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).bid.status, domain.STATUS.ANNULEE);
  // Chaque clé a été TENTÉE — un premier échec n'interrompt pas les suivantes.
  assert.deepEqual([...a.storage.effaces].sort(), [...cles].sort());

  const acte = await a.repo.get('b1', '2026-09-20');
  assert.equal(acte.status, domain.STATUS.ANNULEE);
  assert.deepEqual(acte.documents, [], 'les références tombent même quand le seau a échoué');
});

test('sans port de stockage, l’annulation passe et les références tombent quand même', async () => {
  const a = app();
  await acteAvecPieces(a);

  const res = await annuler(a);
  assert.equal(res.statusCode, 200, res.body);

  const acte = await a.repo.get('b1', '2026-09-20');
  assert.equal(acte.status, domain.STATUS.ANNULEE);
  assert.deepEqual(acte.documents, []);
});

test('annuler deux fois n’efface rien de plus — idempotent comme le reste de la porte', async () => {
  const a = app({ storage: stockageEspion() });
  const { cles } = await acteAvecPieces(a);
  assert.equal((await annuler(a)).statusCode, 200);
  const encore = await annuler(a);
  assert.equal(encore.statusCode, 200, encore.body);
  assert.equal(a.storage.effaces.length, cles.length, 'la seconde annulation ne touche plus au seau');
});
