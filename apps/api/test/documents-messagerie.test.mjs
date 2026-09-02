// L'ÉCHANGE SÉCURISÉ DE DOCUMENTS DANS LA MESSAGERIE (ADR 0032).
//
// Trois propriétés, et ce sont elles qui font la sécurité — pas le chiffrement
// tout seul :
//
//   1. LES OCTETS NE TRAVERSENT JAMAIS L'API. Le navigateur téléverse
//      directement vers le stockage. L'API n'émet qu'une autorisation signée,
//      portée sur une clé, un type, une taille et quelques minutes.
//   2. L'ACCÈS SE DÉCIDE AU SERVEUR. Une URL signée est un secret porteur : elle
//      n'est jamais la frontière d'autorisation. À chaque émission, le serveur
//      vérifie que le demandeur est le client titulaire du jeton, ou le notaire
//      qui a retenu — la règle de la messagerie.
//   3. ON NE CROIT PAS LE CLIENT SUR PAROLE. Un document n'existe pour l'autre
//      partie qu'après que le serveur a CONSTATÉ le dépôt dans le stockage.
//
// Et une propriété déontologique : Nota est dépositaire, jamais destinataire.
// Aucune route admin ne touche à ces documents (art. 35 à 37 C.déont. — le
// notaire est tenu au secret professionnel, et l'art. 12 lui impose de veiller
// au respect de la loi par ceux qui collaborent avec lui).
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
const AUTRE = notaryIdForEmail('autre@etude.ca');
const parse = (res) => JSON.parse(res.body);

function app() {
  const repo = createMemoryRepo([]);
  const storage = createMemoryStorage({ now: () => NOW_MS });
  return { ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, storage }), repo, storage };
}

async function offreRetenue(a, over = {}) {
  await a.repo.putNotary({ id: NOTAIRE, email: 'n@etude.ca', label: 'Étude N', status: 'active', createdAt: TODAY });
  const bid = {
    id: 'b1', dateISO: '2026-09-20', serviceId: 'refinancement', montant: 2000,
    tier: 'standard', status: domain.STATUS.RETENUE, anonyme: true, notaryId: NOTAIRE,
    etude: 'Étude N', courriel: 'client@exemple.ca', prefixe: 'G1R',
    pricing: { deplacement: 'client_50' }, createdAt: TODAY, ...over,
  };
  await a.repo.put(bid);
  return bid;
}

const jetonClient = () => signToken('b1', NOW_MS + 60_000, SCOPES.CLIENT);
const jetonNotaire = (id = NOTAIRE) => signToken(id, NOW_MS + 60_000, SCOPES.SESSION);
// Le harnais sépare le chemin de la requête, comme le fait la passerelle.
const call = (a, method, path, { body, bearer } = {}) => {
  const [chemin, qs] = String(path).split('?');
  const query = {};
  for (const [k, v] of new URLSearchParams(qs || '')) query[k] = v;
  return a.handle({ method, path: chemin, query, headers: bearer ? { authorization: 'Bearer ' + bearer } : {},
    body: body === undefined ? undefined : JSON.stringify(body) });
};

const PDF = { id: 'b1', dateISO: '2026-09-20', nom: 'relevé.pdf', taille: 1024, type: 'application/pdf' };

// ---------------------------------------------------------------------------
// L'autorisation de dépôt
// ---------------------------------------------------------------------------

test('le client obtient une autorisation de dépôt, portée et brève', async () => {
  const a = app();
  await offreRetenue(a);
  const res = await call(a, 'POST', '/client/bid/documents', { bearer: jetonClient(), body: PDF });
  assert.equal(res.statusCode, 200, res.body);
  const b = parse(res);
  assert.ok(b.document.id, 'un document est créé');
  assert.equal(b.document.etat, 'en_attente', 'il n’existe pas encore pour l’autre partie');
  assert.equal(b.document.nom, 'relevé.pdf');
  assert.equal(b.depot.methode, 'PUT');
  assert.ok(b.depot.url, 'et une URL de dépôt est émise');
  assert.ok(b.depot.expireA, 'qui expire');
  // La clé est DÉRIVÉE par le domaine : jamais reçue du client.
  assert.equal(b.document.cle, undefined, 'la clé de stockage ne sort jamais de l’API');
});

test('le notaire retenu aussi', async () => {
  const a = app();
  await offreRetenue(a);
  const res = await call(a, 'POST', '/notary/bids/documents/depot', { bearer: jetonNotaire(), body: PDF });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).document.de, domain.CHAT_FROM.NOTAIRE);
});

test('un AUTRE notaire est refusé — la conversation n’est pas la sienne', async () => {
  const a = app();
  await offreRetenue(a);
  await a.repo.putNotary({ id: AUTRE, email: 'autre@etude.ca', status: 'active', createdAt: TODAY });
  const res = await call(a, 'POST', '/notary/bids/documents/depot', { bearer: jetonNotaire(AUTRE), body: PDF });
  assert.equal(res.statusCode, 403, res.body);
});

test('sans jeton, aucune autorisation', async () => {
  const a = app();
  await offreRetenue(a);
  assert.equal((await call(a, 'POST', '/client/bid/documents', { body: PDF })).statusCode, 401);
  assert.equal((await call(a, 'POST', '/notary/bids/documents/depot', { body: PDF })).statusCode, 401);
});

test('un format refusé l’est AVANT toute autorisation', async () => {
  const a = app();
  await offreRetenue(a);
  const res = await call(a, 'POST', '/client/bid/documents', {
    bearer: jetonClient(), body: { ...PDF, nom: 'acte.exe', type: 'application/octet-stream' },
  });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(parse(res).depot, undefined, 'aucune URL n’est émise pour un fichier refusé');
});

test('sans rétention, la conversation n’existe pas — donc aucun document', async () => {
  const a = app();
  await offreRetenue(a, { status: domain.STATUS.OUVERTE, notaryId: null });
  const res = await call(a, 'POST', '/client/bid/documents', { bearer: jetonClient(), body: PDF });
  assert.equal(res.statusCode, 422, res.body);
});

// ---------------------------------------------------------------------------
// La confirmation — on constate, on ne croit pas
// ---------------------------------------------------------------------------

test('un document non déposé ne devient JAMAIS visible, même si le client l’affirme', async () => {
  const a = app();
  await offreRetenue(a);
  const { document } = parse(await call(a, 'POST', '/client/bid/documents', { bearer: jetonClient(), body: PDF }));

  // Le navigateur prétend avoir téléversé, sans l'avoir fait.
  const res = await call(a, 'POST', '/client/bid/documents/confirme', {
    bearer: jetonClient(), body: { id: 'b1', dateISO: '2026-09-20', documentId: document.id },
  });
  assert.equal(res.statusCode, 422, res.body);
  assert.ok(parse(res).errors.some((e) => e.code === 'depot_absent'), res.body);

  const vue = parse(await call(a, 'GET', '/client/bid?id=b1&dateISO=2026-09-20', { bearer: jetonClient() }));
  assert.deepEqual(vue.documents || [], [], 'rien n’apparaît dans le fil');
});

test('une fois le dépôt CONSTATÉ, le document apparaît des deux côtés', async () => {
  const a = app();
  const bid = await offreRetenue(a);
  const { document } = parse(await call(a, 'POST', '/client/bid/documents', { bearer: jetonClient(), body: PDF }));
  a.storage.__deposer(domain.documentStorageKey(bid.id, document.id, 'relevé.pdf'), Buffer.alloc(1024), 'application/pdf');

  const ok = await call(a, 'POST', '/client/bid/documents/confirme', {
    bearer: jetonClient(), body: { id: 'b1', dateISO: '2026-09-20', documentId: document.id },
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(parse(ok).document.etat, 'pret');

  const cote = parse(await call(a, 'GET', '/client/bid?id=b1&dateISO=2026-09-20', { bearer: jetonClient() }));
  assert.equal(cote.documents.length, 1);
  assert.equal(cote.documents[0].nom, 'relevé.pdf');
  assert.equal(cote.documents[0].cle, undefined, 'jamais la clé de stockage');

  const feed = parse(await call(a, 'GET', '/notary/bids', { bearer: jetonNotaire() }));
  const retenu = (feed.retained || []).find((r) => r.id === 'b1');
  assert.ok(retenu, 'l’acte retenu est là');
  assert.equal((retenu.documents || []).length, 1, 'et le notaire voit le document');
});

// ---------------------------------------------------------------------------
// Le téléchargement
// ---------------------------------------------------------------------------

async function documentPret(a) {
  const bid = await offreRetenue(a);
  const { document } = parse(await call(a, 'POST', '/client/bid/documents', { bearer: jetonClient(), body: PDF }));
  a.storage.__deposer(domain.documentStorageKey(bid.id, document.id, 'relevé.pdf'), Buffer.alloc(1024), 'application/pdf');
  await call(a, 'POST', '/client/bid/documents/confirme', {
    bearer: jetonClient(), body: { id: 'b1', dateISO: '2026-09-20', documentId: document.id },
  });
  return document.id;
}

test('les deux parties téléchargent ; personne d’autre', async () => {
  const a = app();
  const docId = await documentPret(a);
  const q = '?id=b1&dateISO=2026-09-20&documentId=' + docId;

  const c = await call(a, 'GET', '/client/bid/documents' + q, { bearer: jetonClient() });
  assert.equal(c.statusCode, 200, c.body);
  assert.ok(parse(c).lecture.url);

  const n = await call(a, 'GET', '/notary/bids/documents' + q, { bearer: jetonNotaire() });
  assert.equal(n.statusCode, 200, n.body);

  await a.repo.putNotary({ id: AUTRE, email: 'autre@etude.ca', status: 'active', createdAt: TODAY });
  assert.equal((await call(a, 'GET', '/notary/bids/documents' + q, { bearer: jetonNotaire(AUTRE) })).statusCode, 403);
  assert.equal((await call(a, 'GET', '/client/bid/documents' + q)).statusCode, 401);
});

test('chaque téléchargement laisse une trace — qui, quoi, quand', async () => {
  const a = app();
  const docId = await documentPret(a);
  await call(a, 'GET', '/notary/bids/documents?id=b1&dateISO=2026-09-20&documentId=' + docId, { bearer: jetonNotaire() });
  // Le journal est indexé par le JOUR OUVRABLE québécois (`day: now()`),
  // jamais par la tranche UTC de l'horodatage.
  const entries = await a.repo.queryAuditByDay(TODAY);
  const lu = entries.find((e) => e.action === 'document_lu');
  assert.ok(lu, 'un téléchargement sans trace est indéfendable : ' + entries.map((e) => e.action).join(','));
  assert.equal(lu.meta.documentId, docId);
  assert.equal(lu.meta.bidId, 'b1');
});

test('un document inconnu ne fait pas fuir l’existence d’un autre', async () => {
  const a = app();
  await documentPret(a);
  const res = await call(a, 'GET', '/client/bid/documents?id=b1&dateISO=2026-09-20&documentId=inexistant', { bearer: jetonClient() });
  assert.equal(res.statusCode, 404, res.body);
});

// ---------------------------------------------------------------------------
// Nota est dépositaire, jamais destinataire
// ---------------------------------------------------------------------------

test('ART. 35-37 — aucune route publique ne rend la clé de stockage', async () => {
  const a = app();
  await documentPret(a);
  const vue = await call(a, 'GET', '/client/bid?id=b1&dateISO=2026-09-20', { bearer: jetonClient() });
  const feed = await call(a, 'GET', '/notary/bids', { bearer: jetonNotaire() });
  for (const res of [vue, feed]) {
    assert.equal(/"cle"|offres\//.test(res.body), false,
      'la clé de stockage ne doit apparaître nulle part : ' + res.body.slice(0, 200));
  }
});

test('sans stockage configuré, la porte se ferme proprement — jamais une URL inventée', async () => {
  const repo = createMemoryRepo([]);
  const a = { ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS }), repo };
  await offreRetenue(a);
  const res = await call(a, 'POST', '/client/bid/documents', { bearer: jetonClient(), body: PDF });
  assert.equal(res.statusCode, 503, res.body);
  assert.ok(parse(res).errors[0].message.length > 10, 'et le refus dit quoi faire');
});
