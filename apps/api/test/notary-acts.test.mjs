// GET /notary/acts — la divulgation intégrale des commissions (propriétaire,
// 2026-09-01 : « each commission is fully disclosed in the profile and you have
// audit of each transaction »).
//
// Le relevé n'agrège pas : il montre CHAQUE acte réglé avec ce que le client a
// payé, le taux appliqué, la part de Nota, le net du notaire et la cote qui a
// mérité ce taux — figés dans le registre write-once au moment du règlement,
// donc insensibles à un changement de barème ultérieur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = Date.parse('2026-08-12T15:00:00.000Z');
const NOTARY = notaryIdForEmail('n@etude.ca');
const AUTRE = notaryIdForEmail('autre@etude.ca');

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const sessionToken = (id = NOTARY) => signToken(id, NOW_MS + 60_000, SCOPES.SESSION);

function fakeStripe() {
  return {
    async chargeActCommission(a) { return { id: 'ch_' + a.bidId, applicationFeeCents: a.applicationFeeCents }; },
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

async function notaireActif(a, id = NOTARY, over = {}) {
  await a.repo.putNotary({
    id, email: 'n@etude.ca', label: 'Étude N',
    status: 'active', chargesEnabled: true, connectAccountId: 'acct_n',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
}

// Une offre retenue par le notaire, prête à être réglée.
async function offreRetenue(a, { id, dateISO, serviceId = 'refinancement', montant = 2000, notaryId = NOTARY }) {
  const bid = {
    id, dateISO, serviceId, montant, tier: 'standard',
    status: domain.STATUS.RETENUE, notaryId, etude: 'Étude N',
    anonyme: true, createdAt: dateISO, courriel: 'c@client.ca',
  };
  await a.repo.put(bid);
  await a.repo.putRetained(notaryId, bid);
  return bid;
}

const getActs = (a, token = sessionToken()) =>
  a.handle({ method: 'GET', path: '/notary/acts', headers: bearer(token), query: {} });

test('sans jeton de session, le relevé est fermé', async () => {
  const a = app();
  assert.equal((await a.handle({ method: 'GET', path: '/notary/acts', headers: {}, query: {} })).statusCode, 401);
  const feedToken = signToken(NOTARY, NOW_MS + 60_000, SCOPES.FEED);
  assert.equal((await getActs(a, feedToken)).statusCode, 401, 'un jeton de fil ne lit pas les finances');
});

test('un notaire sans acte réglé voit un relevé vide, jamais une erreur', async () => {
  const a = app();
  await notaireActif(a);
  const res = await getActs(a);
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.deepEqual(body.actes, []);
  assert.deepEqual(body.totaux, { actes: 0, montant: 0, commission: 0, net: 0, du: 0 });
});

test('chaque acte réglé est divulgué ligne à ligne : montant, taux, part de Nota, net, cote', async () => {
  const a = app();
  await notaireActif(a);
  await offreRetenue(a, { id: 'b1', dateISO: '2026-08-20', montant: 2000 });
  await a.billing.completeAct({ notaryId: NOTARY, bidId: 'b1', actAmount: 2000, serviceId: 'refinancement' });

  const body = parse(await getActs(a));
  assert.equal(body.actes.length, 1);
  const l = body.actes[0];
  assert.equal(l.bidId, 'b1');
  assert.equal(l.dateISO, '2026-08-20');
  assert.equal(l.serviceId, 'refinancement');
  assert.equal(l.service, domain.serviceById('refinancement').nom, 'le nom lisible du service voyage');
  assert.equal(l.montant, 2000, 'ce que le client a payé');
  assert.equal(l.taux, 0.15, 'le taux appliqué, au départ de l’échelle');
  assert.equal(l.commission, 300, 'la part de Nota, en dollars');
  assert.equal(l.net, 1700, 'ce qui reste au notaire');
  assert.equal(l.montant, l.commission + l.net, 'la ligne s’additionne — rien ne se perd');
  assert.ok(Number.isInteger(l.cote), 'la cote qui a mérité ce taux est figée avec l’acte');
  assert.equal(l.completedAt, TODAY);

  // Réglé hors plateforme (aucune caution à capturer) : les 300 $ sont DUS,
  // pas encaissés — et le relevé le dit.
  assert.equal(l.paye, false);
  assert.equal(l.du, 300);
  assert.deepEqual(body.totaux, { actes: 1, montant: 2000, commission: 300, net: 1700, du: 300 });
});

test('le taux figé au règlement survit à un changement de barème', async () => {
  const a = app();
  await notaireActif(a);
  await offreRetenue(a, { id: 'b1', dateISO: '2026-08-20', montant: 2000 });
  await a.billing.completeAct({ notaryId: NOTARY, bidId: 'b1', actAmount: 2000, serviceId: 'refinancement' });

  // Nota change son barème après coup : l'acte déjà réglé garde SON taux.
  await a.repo.putCommissionConfig({ taux: 0.05, plancher: 0.05, paliers: [] }, '2026-08-21T00:00:00.000Z');
  const l = parse(await getActs(a)).actes[0];
  assert.equal(l.taux, 0.15);
  assert.equal(l.commission, 300);
});

test('le relevé additionne plusieurs actes et ne montre que les siens', async () => {
  const a = app();
  await notaireActif(a);
  await notaireActif(a, AUTRE, { id: AUTRE, email: 'autre@etude.ca', connectAccountId: 'acct_a' });

  await offreRetenue(a, { id: 'b1', dateISO: '2026-08-18', montant: 2000 });
  await offreRetenue(a, { id: 'b2', dateISO: '2026-08-19', serviceId: 'financement', montant: 1800 });
  await offreRetenue(a, { id: 'b3', dateISO: '2026-08-20', montant: 3000, notaryId: AUTRE });
  await a.billing.completeAct({ notaryId: NOTARY, bidId: 'b1', actAmount: 2000, serviceId: 'refinancement' });
  await a.billing.completeAct({ notaryId: NOTARY, bidId: 'b2', actAmount: 1800, serviceId: 'financement' });
  await a.billing.completeAct({ notaryId: AUTRE, bidId: 'b3', actAmount: 3000, serviceId: 'refinancement' });

  const body = parse(await getActs(a));
  assert.deepEqual(body.actes.map((l) => l.bidId), ['b2', 'b1'], 'le plus récent d’abord');
  assert.equal(body.totaux.actes, 2);
  assert.equal(body.totaux.montant, 3800);
  assert.equal(body.totaux.commission, 300 + 270);
  assert.equal(body.totaux.net, 3800 - 570);
  assert.equal(JSON.stringify(body).includes('b3'), false, 'jamais l’acte d’un autre notaire');
});

test('une offre retenue mais pas encore signée n’apparaît pas dans le relevé', async () => {
  const a = app();
  await notaireActif(a);
  await offreRetenue(a, { id: 'b1', dateISO: '2026-08-20', montant: 2000 });
  const body = parse(await getActs(a));
  assert.deepEqual(body.actes, [], 'le relevé ne montre que l’argent réellement réglé');
});

test('un règlement écrit une entrée d’audit — la piste de la transaction', async () => {
  const a = app();
  await notaireActif(a);
  await offreRetenue(a, { id: 'b1', dateISO: '2026-08-20', montant: 2000 });
  await a.handle({
    method: 'POST', path: '/notary/acts/complete', headers: bearer(sessionToken()),
    body: JSON.stringify({ bidId: 'b1', dateISO: '2026-08-20', actAmount: 2000 }),
  });

  const entries = await a.repo.queryAuditByDay(TODAY);
  const regle = entries.find((e) => e.action === 'acte_regle');
  assert.ok(regle, 'chaque règlement laisse une trace');
  assert.equal(regle.meta.bidId, 'b1');
  assert.equal(regle.meta.notaryId, NOTARY);
  assert.equal(regle.meta.montant, 2000);
  assert.equal(regle.meta.commission, 300);
  assert.equal(regle.meta.net, 1700);
  assert.equal(regle.meta.taux, 0.15);
  assert.ok(Number.isInteger(regle.meta.cote));
  assert.ok(regle.ts, 'horodatée');
});

test('le client voit comment SON montant s’est partagé, une fois l’acte réglé', async () => {
  const a = app();
  await notaireActif(a);
  const bid = await offreRetenue(a, { id: 'b1', dateISO: '2026-08-20', montant: 2000 });
  // Un jeton client, comme la publication en délivre un.
  const { signToken: sign, SCOPES: S } = require('../src/notary-auth.js');
  const clientToken = sign(bid.id, NOW_MS + 60_000, S.CLIENT);

  const avant = parse(await a.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken), query: { id: 'b1', dateISO: '2026-08-20' } }));
  assert.deepEqual(avant.acte, { complete: false }, 'rien à divulguer avant la signature');

  await a.billing.completeAct({ notaryId: NOTARY, bidId: 'b1', actAmount: 2000, serviceId: 'refinancement' });
  const apres = parse(await a.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken), query: { id: 'b1', dateISO: '2026-08-20' } }));
  assert.equal(apres.acte.complete, true);
  assert.equal(apres.acte.montant, 2000);
  assert.equal(apres.acte.partNota, 300);
  assert.equal(apres.acte.partNotaire, 1700);
  assert.equal(apres.acte.taux, 0.15);
  assert.equal(apres.acte.partNota + apres.acte.partNotaire, apres.acte.montant, 'le partage s’additionne au total payé');
});

test('la rétention horodate l’engagement et laisse une trace', async () => {
  const a = app();
  await notaireActif(a);
  // Une offre ouverte, retenue par la vraie porte (pas un raccourci de repo).
  await a.repo.put({
    id: 'b9', dateISO: '2026-08-25', serviceId: 'refinancement', montant: 2200,
    tier: 'standard', status: domain.STATUS.OUVERTE, anonyme: true, createdAt: '2026-08-12',
    pricing: { deplacement: 'client_50' },
  });
  const res = await a.handle({
    method: 'POST', path: '/notary/bids/accept', headers: bearer(sessionToken()),
    body: JSON.stringify({ id: 'b9', dateISO: '2026-08-25' }),
  });
  assert.equal(res.statusCode, 200, res.body);

  const bid = await a.repo.get('b9', '2026-08-25');
  assert.equal(bid.retainedAt, new Date(NOW_MS).toISOString(), 'l’instant de l’engagement est persisté');

  const trace = (await a.repo.queryAuditByDay(TODAY)).find((e) => e.action === 'acte_retenu');
  assert.ok(trace, 'la rétention laisse une trace');
  assert.equal(trace.meta.bidId, 'b9');
  assert.equal(trace.meta.notaryId, NOTARY);
  assert.equal(trace.meta.montant, 2200);
});
