// Les avis partent AVANT que la réponse ne parte (constaté en production le
// 2026-09-06).
//
// LE DÉFAUT. Chaque avis était envoyé « au vol » —
// `Promise.resolve(n.onX(...)).catch(() => {})`, jamais attendu — pour qu'une
// panne de SES ne bloque jamais une réponse HTTP. L'intention est juste. La
// conséquence sur Lambda ne l'était pas : Lambda GÈLE l'environnement dès que
// le handler rend sa réponse, et une promesse encore en vol n'est pas annulée,
// elle est SUSPENDUE. Elle ne reprend qu'au réveil suivant du conteneur — la
// requête d'après, dans quelques minutes, quelques heures, ou jamais sur un
// site à faible trafic.
//
// CE QUI A ÉTÉ MESURÉ. Un message de soutien posté sur la production : aucune
// ligne `SENT#` dans la table, aucun envoi compté par SES. Trois requêtes de
// santé plus tard — le conteneur réveillé — la ligne est apparue. Un balayage
// de la table ne trouvait AUCUNE ligne `SENT#` : depuis la mise en service,
// aucun avis n'était jamais parti à l'heure.
//
// Ce que ces tests tiennent, c'est la promesse la plus simple du produit : ce
// qui doit être écrit à quelqu'un l'est avant qu'on ne réponde « c'est fait ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const TODAY = '2026-08-12';

// Un notifier dont on contrôle la vitesse : c'est le seul moyen de distinguer
// « parti » de « parti plus tard ».
function slowNotifier({ delayMs = 30, onDone } = {}) {
  const sent = [];
  const faire = async (kind) => {
    await new Promise((r) => setTimeout(r, delayMs));
    sent.push(kind);
    if (onDone) onDone(kind);
    return { ok: true };
  };
  return {
    sent,
    async onSupportMessage() { return faire('operatorSupportMessage'); },
    async onContactMessage() { return faire('operatorContactMessage'); },
  };
}

function app(notifier, opts = {}) {
  const repo = createMemoryRepo([]);
  let n = 0;
  return {
    ...createApp(repo, {
      now: () => TODAY,
      nowMs: () => 1_760_000_000_000,
      newId: () => 'id-' + ++n,
      notifier,
      supportUrl: 'https://nota.example',
      env: { NOTA_OPERATOR_EMAIL: 'ops@nota.ca' },
      ...opts,
    }),
    repo,
  };
}

const ask = (a, texte) =>
  a.handle({ method: 'POST', path: '/support/messages', headers: {}, body: JSON.stringify({ texte }) });

test('l’avis est PARTI quand la réponse revient — pas « en vol »', async () => {
  const n = slowNotifier({ delayMs: 40 });
  const a = app(n);
  const res = await ask(a, 'Bonjour, une question ?');
  assert.equal(res.statusCode, 201);
  // AVANT le correctif, cette ligne valait [] : la réponse rendait la main
  // pendant que le courriel dormait, et Lambda gelait tout.
  assert.deepEqual(n.sent, ['operatorSupportMessage'], 'l’avis a fini avant la réponse');
});

test('le formulaire « Nous joindre » a la même garantie', async () => {
  const n = slowNotifier({ delayMs: 40 });
  const a = app(n);
  const res = await a.handle({
    method: 'POST',
    path: '/contact',
    headers: {},
    body: JSON.stringify({ nom: 'Marie', courriel: 'marie@example.ca', sujet: 'Bonjour', message: 'Une question sur le prix.' }),
  });
  assert.equal(res.statusCode, 202);
  assert.ok(n.sent.length >= 1, 'le message du formulaire est parti avant la réponse');
});

test('un envoi qui ÉCHOUE ne casse jamais la réponse', async () => {
  // La raison d'être du « au vol » d'origine, et elle reste intacte : le
  // correctif attend l'envoi, il ne le laisse pas remonter.
  const a = app({
    async onSupportMessage() { throw new Error('SES est tombé'); },
  });
  const res = await ask(a, 'Bonjour ?');
  assert.equal(res.statusCode, 201, 'le visiteur est servi malgré la panne d’envoi');
});

test('un envoi qui TRAÎNE ne retient pas la réponse indéfiniment', async () => {
  // L'attente est bornée : un envoi en éventail ne doit pas retenir une
  // réponse. Au-delà du délai on rend la main, et le reliquat repartira au
  // réveil suivant — donc jamais pire qu'avant, et presque toujours mieux.
  const a = app(
    { async onSupportMessage() { return new Promise(() => {}); } }, // ne finit jamais
    { env: { NOTA_OPERATOR_EMAIL: 'ops@nota.ca', NOTA_SEND_FLUSH_MS: '60' } }
  );
  const t0 = Date.now();
  const res = await ask(a, 'Bonjour ?');
  const ms = Date.now() - t0;
  assert.equal(res.statusCode, 201);
  assert.ok(ms < 2000, `la réponse a été rendue en ${ms} ms, sans attendre l’envoi bloqué`);
});

test('la garantie vaut pour la requête EN COURS, pas la suivante', async () => {
  // Le piège exact du gel : avant le correctif, l'avis de la requête N
  // n'aboutissait qu'au réveil provoqué par la requête N+1.
  const n = slowNotifier({ delayMs: 25 });
  const a = app(n);
  await ask(a, 'Première question');
  const apresPremiere = n.sent.length;
  await ask(a, 'Deuxième question');
  assert.equal(apresPremiere, 1, 'la première requête a fait partir SON avis');
  assert.equal(n.sent.length, 2, 'et la seconde le sien');
});

test('une route sans avis ne paie aucune attente', async () => {
  const a = app(slowNotifier({ delayMs: 5000 }));
  const t0 = Date.now();
  const res = await a.handle({ method: 'GET', path: '/health', headers: {} });
  assert.equal(res.statusCode, 200);
  assert.ok(Date.now() - t0 < 500, 'rien à vider, rien à attendre');
});
