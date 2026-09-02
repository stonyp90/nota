// QUAND STRIPE N'EST PAS CONFIGURÉ, AUCUNE ROUTE NE DOIT S'EFFONDRER.
//
// Constaté en production le 2026-09-02 : `POST /api/notaries/connect` et
// `POST /api/stripe/webhook` répondaient tous deux 500 « Internal Server
// Error ». La cause était la même pour les deux — `billing()` construit
// paresseusement l'adaptateur Stripe, et `createStripeAdapter` LÈVE quand
// `secretKey` manque. Six chemins du handler consultent `billingConfigured`
// avant d'appeler `billing()` ; ces deux-là ne le faisaient pas.
//
// La conséquence n'était pas cosmétique. `/notaries/connect` est la porte par
// laquelle un notaire branche ses versements : un 500 y ressemble à une panne
// de Nota, pas à une configuration absente. Et un webhook qui répond 500 fait
// RÉESSAYER Stripe — pendant des heures, puis l'alerte tombe.
//
// Ce que chaque route doit répondre à la place :
//   • /notaries/connect → 503 `paiement_indisponible`. Le service existe, il
//     n'est pas disponible maintenant ; c'est exactement ce que 503 veut dire.
//   • /stripe/webhook   → 400 `signature_invalide`. Sans secret de webhook,
//     AUCUNE signature ne peut être vérifiée : le refus est le même que pour
//     une signature fausse, et il ne révèle donc pas l'état de la
//     configuration à qui sonde la route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const parse = (r) => JSON.parse(r.body);

// Aucun `billing` injecté et aucune clé Stripe dans l'environnement : c'est
// EXACTEMENT la production du 2026-09-02.
function appSansStripe() {
  return createApp(createMemoryRepo([]), {
    today: () => '2026-09-02',
    now: () => Date.parse('2026-09-02T15:00:00.000Z'),
    env: {},
  });
}

test('sans Stripe, brancher ses versements répond 503 — jamais 500', async () => {
  const res = await appSansStripe().handle({
    method: 'POST',
    path: '/notaries/connect',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'notaire@exemple.ca' }),
  });

  assert.equal(res.statusCode, 503, 'un 500 dit « Nota est cassé » ; le vrai fait est « le paiement n’est pas branché »');
  assert.equal(parse(res).errors[0].code, 'paiement_indisponible');
});

test('sans Stripe, le webhook refuse en 400 au lieu de faire réessayer Stripe', async () => {
  const res = await appSansStripe().handle({
    method: 'POST',
    path: '/stripe/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=peu-importe' },
    body: JSON.stringify({ id: 'evt_1', type: 'account.updated' }),
  });

  assert.equal(res.statusCode, 400, 'un 500 déclenche la file de réessais de Stripe ; un 400 la referme');
  assert.equal(parse(res).errors[0].code, 'signature_invalide');
});

test('le refus du webhook est LE MÊME que Stripe soit absent ou la signature fausse', async () => {
  // Sonder la route ne doit rien apprendre sur la configuration de Nota.
  const absent = await appSansStripe().handle({
    method: 'POST', path: '/stripe/webhook',
    headers: { 'stripe-signature': 'x' }, body: '{}',
  });

  const configuré = createApp(createMemoryRepo([]), {
    today: () => '2026-09-02',
    now: () => Date.parse('2026-09-02T15:00:00.000Z'),
    env: {},
    billingConfigured: true,
    billing: { handleWebhook: async () => ({ ok: false }) },
  });
  const fausse = await configuré.handle({
    method: 'POST', path: '/stripe/webhook',
    headers: { 'stripe-signature': 'x' }, body: '{}',
  });

  assert.equal(absent.statusCode, fausse.statusCode);
  assert.deepEqual(parse(absent), parse(fausse));
});

test('un adaptateur injecté suffit, même quand le paiement à l’acceptation est éteint', async () => {
  // Le piège exact de ce correctif. `billingConfigured` peut être forcé à
  // false ALORS QU'un adaptateur est injecté : le monde BDD et
  // `partenaires.test.mjs` font cela pour exercer ces deux routes sans activer
  // le paiement à l'acceptation. Garder ces routes sur `billingConfigured`
  // rendait donc 503/400 à des appelants parfaitement équipés.
  const app = createApp(createMemoryRepo([]), {
    today: () => '2026-09-02',
    now: () => Date.parse('2026-09-02T15:00:00.000Z'),
    env: {},
    billingConfigured: false,
    billing: {
      connectNotary: async () => ({ ok: true, url: 'https://connect.stripe.test/x' }),
      handleWebhook: async () => ({ ok: true, event: null, duplicate: true }),
    },
  });

  const connect = await app.handle({
    method: 'POST', path: '/notaries/connect',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'notaire@exemple.ca' }),
  });
  assert.equal(connect.statusCode, 200, 'l’adaptateur est là : la route doit passer');
  assert.equal(parse(connect).url, 'https://connect.stripe.test/x');

  const hook = await app.handle({
    method: 'POST', path: '/stripe/webhook',
    headers: { 'stripe-signature': 'x' }, body: '{}',
  });
  assert.equal(hook.statusCode, 200);
});
