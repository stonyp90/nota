// LE CHEMIN DE PUBLICATION PAYANT — le seul par lequel l'argent entre.
//
// Il n'était exercé nulle part : `local-server.js` et le serveur E2E posent
// tous deux `billingConfigured: false`, et l'unique test unitaire passait
// grâce à un faux Stripe qui acceptait n'importe quels arguments. Le tunnel
// testé n'était pas le tunnel livré.
//
// Deux défauts en découlaient :
//   • `siteUrl` était la SEULE des quatre URL du handler à ne pas retomber sur
//     `NOTA_BASE_URL` — et l'infrastructure ne pose jamais `NOTA_SITE_URL`. En
//     production, Stripe recevait donc `successUrl: undefined` : le client
//     n'avait aucun retour vers Nota, et `handleCheckoutReturn` ne s'exécutait
//     jamais.
//   • aucune garde ne refusait franchement une configuration incomplète sur
//     `POST /bids`, alors que le lien magique notaire et la réclamation
//     partenaire en ont une. Une promesse morte vaut moins qu'un refus clair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const domain = require('@nota/domain');

const TODAY = '2026-09-02';
const NOW_MS = Date.parse('2026-09-02T15:00:00.000Z');
const parse = (r) => JSON.parse(r.body);

const OFFRE = {
  serviceId: 'refinancement', dateISO: '2026-09-25', montant: 2000, prefixe: 'G1R',
  courriel: 'client@exemple.ca',
  pricing: { valeur_pret: 300000, approbation_bancaire: 'obtenue', preteur: 'banque_nationale', succession: 'non', deplacement: 'client_50' },
};

function app({ env = {}, billing } = {}) {
  const repo = createMemoryRepo([]);
  const recu = {};
  const faux = billing || {
    quoteOffer: async (m) => ({ honorairesCents: m * 100, prixNotaCents: 40000, totalCents: m * 100 + 40000 }),
    authorizeOffer: async (a) => { Object.assign(recu, a); return { ok: true, url: 'https://checkout.test/x' }; },
  };
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, billing: faux, billingConfigured: true, env }),
    repo, recu,
  };
}
const poster = (a, body = OFFRE) =>
  a.handle({ method: 'POST', path: '/bids', query: {}, headers: {}, body: JSON.stringify(body) });

test('NOTA_BASE_URL suffit — c’est la variable que l’infrastructure pose réellement', async () => {
  const a = app({ env: { NOTA_BASE_URL: 'https://nota.quebec' } });
  const res = await poster(a);
  assert.equal(res.statusCode, 201, res.body);
  assert.match(a.recu.successUrl, /^https:\/\/nota\.quebec\/\?paiement=ok$/);
  assert.match(a.recu.cancelUrl, /^https:\/\/nota\.quebec\/\?paiement=annule$/);
});

test('NOTA_SITE_URL reste honoré, et l’emporte quand les deux existent', async () => {
  const a = app({ env: { NOTA_SITE_URL: 'https://site.test', NOTA_BASE_URL: 'https://autre.test' } });
  await poster(a);
  assert.match(a.recu.successUrl, /^https:\/\/site\.test\//);
});

test('sans AUCUNE origine, la publication est REFUSÉE franchement — jamais une promesse morte', async () => {
  const a = app({ env: {} });
  const res = await poster(a);
  assert.equal(res.statusCode, 503, res.body);
  const err = parse(res).errors[0];
  assert.equal(err.code, 'configuration_incomplete');
  // Le message doit dire quoi faire : un 503 muet envoie chercher un bogue
  // dans le code alors que la cause est une variable d'environnement.
  assert.match(err.message, /configuration|réessayez|plus tard/i);
  // Et rien n'a été créé : pas d'offre fantôme que « Mes offres » montrerait
  // comme vivante en attendant un notaire qui ne la verra jamais.
  assert.equal((await a.repo.listByMonth('2026-09')).length, 0);
});

test('une panne de l’autorisation ne remonte pas en 500 nu', async () => {
  const a = app({
    env: { NOTA_BASE_URL: 'https://nota.quebec' },
    billing: {
      quoteOffer: async (m) => ({ honorairesCents: m * 100, prixNotaCents: 40000, totalCents: m * 100 + 40000 }),
      authorizeOffer: async () => { throw new Error('Stripe down'); },
    },
  });
  const res = await poster(a);
  assert.equal(res.statusCode, 503, res.body);
  assert.equal(parse(res).errors[0].code, 'paiement_indisponible');
});

test('sans facturation configurée, rien ne change — l’offre part directement', async () => {
  const repo = createMemoryRepo([]);
  const a = createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS });
  const res = await a.handle({ method: 'POST', path: '/bids', query: {}, headers: {}, body: JSON.stringify(OFFRE) });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(parse(res).checkoutUrl, undefined);
  assert.equal(parse(res).bid.status, domain.STATUS.OUVERTE);
});
