// Article 33 du Code de déontologie des notaires : hors la rémunération et les
// commissions auxquelles il a droit, le notaire ne peut ni verser ni recevoir
// « tout autre avantage » relatif à l'exercice de sa profession.
//
// Le programme de parrainage de Nota (ADR 0011) verse 50 $ pour un client
// amené et 250 $ pour un notaire amené qui complète son premier acte. Un
// NOTAIRE qui réclamerait un code de parrainage recevrait donc un avantage lié
// à l'exercice de sa profession — Nota le mettrait en défaut. Le produit refuse
// la réclamation plutôt que de la laisser passer.
//
// Ce n'est pas un avis juridique : c'est le garde-fou le moins coûteux, et il
// ne coûte rien à un partenaire qui n'est pas notaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');

const TODAY = '2026-08-12';
const NOW_MS = Date.parse('2026-08-12T15:00:00.000Z');
const parse = (res) => JSON.parse(res.body);

function app() {
  const repo = createMemoryRepo([]);
  return { ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS }), repo };
}

const reclamer = (a, body) =>
  a.handle({ method: 'POST', path: '/partenaires', headers: {}, body: JSON.stringify(body) });

test('un notaire ne peut pas réclamer un code de parrainage', async () => {
  const a = app();
  const email = 'me.roy@etude.ca';
  await a.repo.putNotary({ id: notaryIdForEmail(email), email, label: 'Étude Roy', status: 'active' });

  const res = await reclamer(a, { code: 'ROY2026', type: 'autre_professionnel', courriel: email });
  assert.equal(res.statusCode, 422, res.body);
  const codes = parse(res).errors.map((e) => e.code);
  assert.ok(codes.includes('notaire_non_admissible'), res.body);
  assert.match(parse(res).errors[0].message, /déontologie|notaire/i, 'le refus dit POURQUOI');

  // Rien n'a été écrit : ni réclamation en attente, ni partenaire.
  assert.equal(await a.repo.getPartner('ROY2026'), null);
});

test('la casse et les espaces du courriel ne contournent pas le refus', async () => {
  const a = app();
  const email = 'me.roy@etude.ca';
  await a.repo.putNotary({ id: notaryIdForEmail(email), email, label: 'Étude Roy', status: 'onboarding' });

  const res = await reclamer(a, { code: 'ROY2026', type: 'courtier_hypothecaire', courriel: '  ME.ROY@Etude.CA  ' });
  assert.equal(res.statusCode, 422, 'un notaire en cours d’inscription est un notaire');
  assert.ok(parse(res).errors.map((e) => e.code).includes('notaire_non_admissible'));
});

test('un partenaire qui n’est pas notaire passe comme avant', async () => {
  const a = app();
  const res = await reclamer(a, { code: 'COURTIER1', type: 'courtier_hypothecaire', courriel: 'marc@hypotheque.ca' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).ok, true);
});

test('devenir notaire ENTRE la réclamation et sa confirmation ne passe pas non plus', async () => {
  const a = app();
  const email = 'futur@etude.ca';

  // Étape 1 : au moment de la réclamation, cette adresse n'est pas un notaire.
  const claim = await reclamer(a, { code: 'FUTUR1', type: 'autre_professionnel', courriel: email });
  assert.equal(claim.statusCode, 200, claim.body);
  const token = parse(claim).devToken;
  assert.ok(token, 'le jeton de dev doit être renvoyé hors production');

  // Entre les deux, la personne ouvre son espace notaire.
  await a.repo.putNotary({ id: notaryIdForEmail(email), email, label: 'Étude Future', status: 'active' });

  // Étape 2 — c'est ici que le code deviendrait le payeur de record.
  const verify = await a.handle({ method: 'POST', path: '/partenaires/verify', headers: {}, body: JSON.stringify({ token }) });
  assert.equal(verify.statusCode, 422, verify.body);
  assert.ok(parse(verify).errors.map((e) => e.code).includes('notaire_non_admissible'));
  assert.equal(await a.repo.getPartner('FUTUR1'), null, 'aucun payeur de record écrit');
});
