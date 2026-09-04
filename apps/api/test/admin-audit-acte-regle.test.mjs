// Audit console admin (2026-09-03), P0-3 : la piste d'audit d'un acte réglé
// disait « réglé » sans dire si l'argent était passé par Nota. Or l'ADR 0029 a
// fait du règlement hors plateforme une CRÉANCE, jamais un encaissement — et la
// console rendait les deux comme un encaissement. L'entrée `acte_regle` porte
// donc `paye` et `commissionCentsDue`, lus depuis le registre write-once ACT#
// (l'autorité comptable), pour que la console puisse écrire « dû à Nota — non
// encaissé » là où c'est vrai.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NOTARY_CONTACT } from '../test-support/notary-fixture.mjs';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const domain = require('@nota/domain');
const { DEFAULT_PRIX_CENTS: PRIX } = require('../src/prix-nota-config.js');

const TODAY = '2026-08-12';
const NOW_MS = Date.parse('2026-08-12T15:00:00.000Z');
const NOTARY = notaryIdForEmail('n@etude.ca');
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const sessionToken = () => signToken(NOTARY, NOW_MS + 60_000, SCOPES.SESSION);

function fakeStripe() {
  return {
    async captureAndTransfer(a) {
      return { chargeId: 'ch_' + a.bidId, transferId: 'tr_' + a.bidId, netCents: a.amountCents - a.applicationFeeCents };
    },
  };
}

function app() {
  const repo = createMemoryRepo([]);
  const billing = createBilling({ repo, stripe: fakeStripe(), now: () => TODAY });
  return { ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, billing }), repo, billing };
}

async function notaireActif(a) {
  await a.repo.putNotary({
    id: NOTARY, email: 'n@etude.ca', label: 'Étude N',
    status: 'active', chargesEnabled: true, connectAccountId: 'acct_n',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...NOTARY_CONTACT,
  });
}

async function offreRetenue(a, { id, dateISO, montant = 2000, ...over }) {
  const bid = {
    id, dateISO, serviceId: 'refinancement', montant, tier: 'standard',
    status: domain.STATUS.RETENUE, notaryId: NOTARY, etude: 'Étude N',
    anonyme: true, createdAt: dateISO, courriel: 'c@client.ca',
    ...over,
  };
  await a.repo.put(bid);
  await a.repo.putRetained(NOTARY, bid);
  return bid;
}

const complete = (a, bid) =>
  a.handle({
    method: 'POST', path: '/notary/acts/complete', headers: bearer(sessionToken()),
    body: JSON.stringify({ bidId: bid.id, dateISO: bid.dateISO, actAmount: bid.montant }),
  });

const auditOf = async (a, bidId) =>
  (await a.repo.queryAuditByDay(TODAY)).find((e) => e.action === 'acte_regle' && e.meta && e.meta.bidId === bidId);

test('réglé HORS plateforme (aucune caution capturable) : la piste dit paye:false et ce qui est dû à Nota', async () => {
  const a = app();
  await notaireActif(a);
  const bid = await offreRetenue(a, { id: 'b1', dateISO: '2026-08-20' }); // pas de paymentIntentId
  const res = await complete(a, bid);
  assert.equal(res.statusCode, 200, res.body);
  const e = await auditOf(a, 'b1');
  assert.ok(e, 'la trace existe');
  assert.equal(e.meta.paye, false, 'aucun dollar n’a bougé : la pièce le dit');
  assert.equal(e.meta.commissionCentsDue, PRIX, 'la créance de Nota, en cents, figée avec l’acte');
  assert.equal(e.meta.honoraires, 2000);
  assert.equal(e.meta.prixNota, PRIX / 100);
});

test('réglé PAR Nota (caution capturée, net viré) : paye:true et rien de dû', async () => {
  const a = app();
  await notaireActif(a);
  const bid = await offreRetenue(a, { id: 'b2', dateISO: '2026-08-21', paymentIntentId: 'pi_b2', paymentStatus: 'authorized' });
  const res = await complete(a, bid);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).paid, true, 'ce chemin est bien celui de la capture');
  const e = await auditOf(a, 'b2');
  assert.equal(e.meta.paye, true);
  assert.equal(e.meta.commissionCentsDue, 0);
  assert.equal(e.meta.chargeId, 'ch_b2');
  assert.equal(e.meta.transferId, 'tr_b2');
});
