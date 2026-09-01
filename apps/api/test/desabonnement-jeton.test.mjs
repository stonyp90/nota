// Le jeton de désabonnement doit être SIGNÉ.
//
// Il n'était qu'un `base64url(courriel)` : n'importe qui pouvant deviner une
// adresse — c'est-à-dire n'importe qui — pouvait désabonner n'importe qui.
// Le tort n'est pas théorique : un client désabonné de force cesse de recevoir
// les avis qui concernent SON acte (proposition reçue, notaire retenu, J-0).
//
// La signature ne remplace pas le mécanisme exigé par la LCAP : elle garantit
// que le retrait enregistré est bien celui que le destinataire a demandé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { encodeUnsubToken, decodeUnsubToken } = require('../src/notifications.js');
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const TODAY = '2026-08-12';
const app = () => {
  const repo = createMemoryRepo([]);
  return { repo, a: createApp(repo, { now: () => TODAY }) };
};
const call = (a, token) => a.handle({ method: 'GET', path: '/unsubscribe', query: { token }, headers: {} });

test('le jeton porte une signature — un base64 nu ne passe plus', async () => {
  const signe = encodeUnsubToken('client@exemple.ca');
  const nu = Buffer.from('client@exemple.ca', 'utf8').toString('base64url');
  assert.notEqual(signe, nu, 'le jeton signé ne peut pas être le simple encodage');
  assert.equal(decodeUnsubToken(signe), 'client@exemple.ca');
  assert.equal(decodeUnsubToken(nu), '', 'un jeton non signé ne décode plus rien');
});

test('on ne peut pas désabonner quelqu’un d’autre en devinant son adresse', async () => {
  const { repo, a } = app();
  const forge = Buffer.from('victime@exemple.ca', 'utf8').toString('base64url');
  const res = await call(a, forge);
  assert.equal(res.statusCode, 400, 'un jeton forgé est refusé');
  assert.equal(await repo.isUnsubscribed('victime@exemple.ca'), false, 'et n’enregistre rien');
});

test('le vrai lien fonctionne toujours, en GET comme en POST (un clic, RFC 8058)', async () => {
  const { repo, a } = app();
  const token = encodeUnsubToken('client@exemple.ca');
  assert.equal((await call(a, token)).statusCode, 200);
  assert.equal(await repo.isUnsubscribed('client@exemple.ca'), true);

  const { repo: r2, a: a2 } = app();
  const post = await a2.handle({ method: 'POST', path: '/unsubscribe', query: { token: encodeUnsubToken('autre@exemple.ca') }, headers: {}, body: '' });
  assert.equal(post.statusCode, 200);
  assert.equal(await r2.isUnsubscribed('autre@exemple.ca'), true);
});

test('un jeton tronqué, vide ou bricolé est refusé sans enregistrer quoi que ce soit', async () => {
  const { repo, a } = app();
  for (const bad of ['', 'x', encodeUnsubToken('client@exemple.ca').slice(0, -3), 'a.b.c']) {
    assert.equal((await call(a, bad)).statusCode, 400, 'jeton: ' + JSON.stringify(bad));
  }
  assert.equal(await repo.isUnsubscribed('client@exemple.ca'), false);
});
