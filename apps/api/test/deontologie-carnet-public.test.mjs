// L'article 37 du Code de déontologie des notaires (N-3, r. 2) :
//
//   « Le notaire ne doit pas, à moins que la nature du cas ne l'exige, révéler
//     qu'une personne a fait appel à ses services sauf pour les fins de
//     l'administration interne de la société dans laquelle il exerce ses
//     activités professionnelles. »
//
// Le carnet de Nota est PUBLIC et sans authentification. Y afficher, sur une
// même carte, le nom de l'étude qui a retenu ET le secteur postal du client ET
// le montant ET la date, c'est révéler qu'une personne a fait appel aux
// services de ce notaire. L'anonymat du client n'y change rien : ce que
// l'art. 37 protège, c'est le FAIT du recours, pas seulement le nom.
//
// La nature du cas n'exige rien de tel. Le signal que le carnet doit porter est
// « cette date est prise » — le statut le porte à lui seul.
//
// Ce que cela n'interdit pas : dire au CLIENT qui a retenu sa demande. Il a
// besoin du nom pour joindre son notaire, et il le reçoit derrière son jeton.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = Date.parse('2026-08-12T15:00:00.000Z');
const NOTARY = notaryIdForEmail('n@etude.ca');
const ETUDE = 'Étude Tremblay & Associés';
const parse = (res) => JSON.parse(res.body);

function app() {
  const repo = createMemoryRepo([]);
  return { ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS }), repo };
}

async function offreRetenue(a) {
  await a.repo.putNotary({
    id: NOTARY, email: 'n@etude.ca', label: ETUDE,
    status: 'active', chargesEnabled: true, connectAccountId: 'acct_n',
    createdAt: '2025-01-01T00:00:00.000Z',
  });
  await a.repo.put({
    id: 'b1', dateISO: '2026-08-25', serviceId: 'refinancement', montant: 2000,
    tier: 'standard', status: domain.STATUS.RETENUE, anonyme: true,
    notaryId: NOTARY, etude: ETUDE, courriel: 'client@exemple.ca',
    prefixe: 'G1R', pricing: { deplacement: 'client_50' }, createdAt: TODAY,
  });
}

const carnetPublic = (a) => a.handle({ method: 'GET', path: '/bids', headers: {}, query: {} });

test('ART. 37 — le carnet public ne nomme jamais l’étude qui a retenu', async () => {
  const a = app();
  await offreRetenue(a);

  const res = await carnetPublic(a);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.includes(ETUDE), false,
    'le nom de l’étude ne doit apparaître nulle part dans une réponse publique');
  assert.equal(res.body.includes(NOTARY), false,
    'ni son identifiant, qui dérive de son courriel');
});

test('le carnet public dit toujours que la date est prise', async () => {
  const a = app();
  await offreRetenue(a);

  const offre = parse(await carnetPublic(a)).bids.find((b) => b.id === 'b1');
  assert.ok(offre, 'l’offre reste au carnet');
  assert.equal(offre.status, domain.STATUS.RETENUE,
    'le signal de marché survit intact : la date est prise');
  assert.equal(offre.etude, undefined, 'mais sans nommer personne');
});

test('le CLIENT, lui, voit qui a retenu sa demande', async () => {
  const a = app();
  await offreRetenue(a);
  const jeton = signToken('b1', NOW_MS + 60_000, SCOPES.CLIENT);

  const vue = parse(await a.handle({
    method: 'GET', path: '/client/bid',
    headers: { authorization: 'Bearer ' + jeton },
    query: { id: 'b1', dateISO: '2026-08-25' },
  }));
  assert.equal(vue.notaire && vue.notaire.etude, ETUDE,
    'il a besoin du nom pour joindre son notaire — derrière son jeton');
});
