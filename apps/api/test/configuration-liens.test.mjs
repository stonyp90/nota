// Un lien qu'on ne peut pas cliquer ne doit pas partir.
//
// Constat du 2026-09-01 sur la configuration RÉELLE de la Lambda `nota-api` :
// `NOTA_BASE_URL` est vide. Or c'est elle qui porte l'hôte de tous les liens
// des courriels. Conséquence mesurée : le lien magique du notaire vaut
// « /#nauth=<jeton> » — un chemin relatif, sans hôte, inutilisable depuis une
// boîte de réception. Et comme l'écho de développement est désactivé en
// production, ce lien est le SEUL chemin d'entrée : aucun notaire ne peut
// ouvrir sa console. Même chose pour la réclamation d'un code de parrainage.
//
// Le produit promet « un lien sécurisé arrive par courriel — un clic et vous
// êtes dans l'espace notaire ». Tant que la configuration ne le permet pas, il
// vaut mieux le dire franchement que d'envoyer une promesse morte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const TODAY = '2026-08-12';
const parse = (r) => JSON.parse(r.body);

// Une app dont AUCUNE base d'URL n'est configurée, en production.
function appSansBase(over = {}) {
  const repo = createMemoryRepo([]);
  const env = { ...process.env };
  delete env.NOTA_BASE_URL;
  delete env.NOTA_SITE_URL;
  return {
    repo,
    a: createApp(repo, {
      now: () => TODAY,
      notaryConsoleUrl: '',
      partnerClaimUrl: '',
      notaryLoginDevEcho: false,
      partnerClaimDevEcho: false,
      ...over,
    }),
  };
}

test('sans hôte configuré, la demande de lien notaire échoue franchement', async () => {
  const { a } = appSansBase();
  const res = await a.handle({
    method: 'POST', path: '/notary/session/request', headers: {},
    body: JSON.stringify({ email: 'me@etude.ca' }),
  });
  assert.equal(res.statusCode, 503, res.body);
  const codes = parse(res).errors.map((e) => e.code);
  assert.ok(codes.includes('configuration_incomplete'), res.body);
  assert.match(parse(res).errors[0].message, /momentanément|configuration|indisponible/i);
});

test('sans hôte configuré, la réclamation d’un code de parrainage échoue aussi', async () => {
  const { repo, a } = appSansBase();
  const res = await a.handle({
    method: 'POST', path: '/partenaires', headers: {},
    body: JSON.stringify({ code: 'COURTIER1', type: 'courtier_hypothecaire', courriel: 'marc@hypotheque.ca' }),
  });
  assert.equal(res.statusCode, 503, res.body);
  assert.ok(parse(res).errors.map((e) => e.code).includes('configuration_incomplete'));
  assert.equal(await repo.getPartner('COURTIER1'), null, 'et rien n’est réservé');
});

test('avec un hôte configuré, tout se comporte comme avant', async () => {
  const { a } = appSansBase({ notaryConsoleUrl: 'https://nota.example', partnerClaimUrl: 'https://nota.example' });
  const res = await a.handle({
    method: 'POST', path: '/notary/session/request', headers: {},
    body: JSON.stringify({ email: 'me@etude.ca' }),
  });
  assert.equal(res.statusCode, 200, res.body);
});

test('hors production, le développement local reste utilisable sans hôte', async () => {
  const { repo, a } = appSansBase({ notaryLoginDevEcho: true });
  // La porte ne distingue jamais un notaire d'un inconnu dans sa réponse : il
  // faut donc un notaire réel pour observer l'écho de développement.
  const { notaryIdForEmail } = require('../src/notary-auth.js');
  await repo.putNotary({ id: notaryIdForEmail('me@etude.ca'), email: 'me@etude.ca', label: 'Étude', status: 'active' });

  const res = await a.handle({
    method: 'POST', path: '/notary/session/request', headers: {},
    body: JSON.stringify({ email: 'me@etude.ca' }),
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(parse(res).devToken, 'l’écho de développement reste la porte locale');
});
