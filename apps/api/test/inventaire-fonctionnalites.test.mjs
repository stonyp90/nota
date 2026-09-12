import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAdmin } = require('../src/admin');
const { createMemoryRepo } = require('../src/repo-memory');

/**
 * L'INVENTAIRE DIT CE QUI TOURNE, PAS CE QUI EST ÉCRIT.
 *
 * Audit du 2026-09-12 : la section « Fonctionnalités » estampillait `actif` sur
 * les trente et une, en dur. Sur LA MÊME console, au même instant, « Paiements »
 * affichait « Checkout · Inactif · clé manquante ». Une pastille verte qui ment
 * sur l'état de la production est pire que pas de pastille : elle répond « oui »
 * à « est-ce que Nota peut encaisser aujourd'hui ? ».
 *
 * Une fonctionnalité qui ne dépend de rien est livrée — son code tourne. Celle
 * qui attend un interrupteur, une clé ou un seau est « en attente », et
 * l'inventaire NOMME ce qui manque.
 */
const OPERATEUR = 'op@nota.ca';

async function console_(env) {
  const repo = createMemoryRepo();
  const admin = createAdmin({
    repo,
    config: { allowlist: [OPERATEUR], baseUrl: 'https://admin.nota.example', siteUrl: 'https://nota.example', devEcho: true, rlMax: 100 },
    env,
  });
  const asked = await admin.requestLogin({ email: OPERATEUR, ip: '1.1.1.1' });
  const link = new URL(asked.devLink);
  const challenge = new URLSearchParams(link.hash.replace(/^#\/?/, '')).get('token') || link.hash.split('=').pop();
  const opened = await admin.verifyMagic({ token: challenge, ip: '1.1.1.1' });
  assert.ok(opened.ok, 'l’opérateur ouvre bien une session');
  return { admin, token: opened.session };
}

function find(snapshot, id) {
  for (const group of snapshot.groupes) {
    const hit = group.fonctionnalites.find((f) => f.id === id);
    if (hit) return hit;
  }
  return null;
}

test('une production sans Stripe ne dit pas que Stripe est actif', async () => {
  const { admin, token } = await console_({});
  const result = await admin.getFeatures(token, { ip: '1.1.1.1' });
  assert.equal(result.ok, true);

  for (const id of ['stripe-checkout', 'stripe-connect', 'stripe-webhooks', 'cancellation']) {
    const f = find(result, id);
    assert.ok(f, id + ' est bien inventoriée');
    assert.equal(f.statut, 'en attente', id + ' ne peut pas être « actif » sans clé');
    assert.ok(f.manquant.length, id + ' nomme l’interrupteur qui manque');
    assert.ok(f.manquant.every((name) => name.startsWith('NOTA_')), id + ' nomme une vraie variable');
  }
  // Ce qui ne dépend de rien reste livré : le carnet, lui, tourne.
  assert.equal(find(result, 'carnet').statut, 'actif');
  assert.deepEqual(find(result, 'carnet').manquant, []);
});

test('les interrupteurs posés rendent la fonctionnalité active', async () => {
  const { admin, token } = await console_({
    NOTA_STRIPE_SECRET_CONFIGURED: 'true',
    NOTA_STRIPE_WEBHOOK_CONFIGURED: 'true',
    NOTA_SMS_ENABLED: 'true',
    NOTA_SIGNING_BETA_ENABLED: 'true',
    NOTA_DOCS_BUCKET: 'nota-documents-prod',
    NOTA_FROM_EMAIL: 'bonjour@gonota.ca',
  });
  const result = await admin.getFeatures(token, { ip: '1.1.1.1' });
  for (const id of ['stripe-checkout', 'stripe-webhooks', 'signing-beta', 'messages-documents', 's3', 'ses']) {
    assert.equal(find(result, id).statut, 'actif', id + ' est actif une fois son interrupteur posé');
  }
});

test('« false » et la chaîne vide ne comptent pas pour un interrupteur posé', async () => {
  const { admin, token } = await console_({ NOTA_SIGNING_BETA_ENABLED: 'false', NOTA_DOCS_BUCKET: '   ', NOTA_FROM_EMAIL: '' });
  const result = await admin.getFeatures(token, { ip: '1.1.1.1' });
  assert.equal(find(result, 'signing-beta').statut, 'en attente');
  assert.equal(find(result, 'messages-documents').statut, 'en attente');
  assert.equal(find(result, 'ses').statut, 'en attente');
});

test('l’un OU l’autre suffit quand deux chemins mènent à la même clé', async () => {
  const parClé = await console_({ NOTA_ASSISTANT_API_KEY: 'sk-test' });
  const parParamètre = await console_({ NOTA_ASSISTANT_KEY_PARAM: '/nota/assistant/key' });
  for (const { admin, token } of [parClé, parParamètre]) {
    const result = await admin.getFeatures(token, { ip: '1.1.1.1' });
    assert.equal(find(result, 'support').statut, 'actif');
  }
  const sansRien = await console_({});
  const result = await sansRien.admin.getFeatures(sansRien.token, { ip: '1.1.1.1' });
  assert.equal(find(result, 'support').statut, 'en attente');
});
