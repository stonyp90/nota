// Le taux est FIGÉ au moment où le notaire s'engage.
//
// Constat de la veille des plateformes (docs/go-to-market/veille-notation-
// plateformes.md) : chez Upwork, le taux d'une mission est arrêté à l'ouverture
// du contrat et affiché AVANT l'engagement. Chez nous, la cote était relue au
// règlement — un notaire pouvait retenir une demande en voyant 8 % et payer
// 10 % à la signature parce qu'un déclin ou une évaluation avait bougé entre
// les deux. Le mérite ne doit déplacer la ligne que vers le notaire : le taux
// retenu est un PLAFOND, et une cote qui monte entre-temps profite quand même.
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
const parse = (res) => JSON.parse(res.body);
const bearer = (t) => ({ authorization: 'Bearer ' + t });
const token = () => signToken(NOTARY, NOW_MS + 60_000, SCOPES.SESSION);

const fakeStripe = () => ({
  async chargeActCommission(a) { return { id: 'ch', applicationFeeCents: a.applicationFeeCents }; },
  async captureAndTransfer(a) { return { chargeId: 'ch', transferId: 'tr', netCents: a.amountCents - a.applicationFeeCents }; },
});

function app() {
  const repo = createMemoryRepo([]);
  const billing = createBilling({ repo, stripe: fakeStripe(), now: () => TODAY });
  return { ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, billing }), repo, billing };
}

// Un dossier qui vaut 92 % au notaire (cote dans les 80).
const FORT = {
  ratingSum: 4.6 * 20, ratingCount: 20,
  actsCompleted: 22, actsByService: { refinancement: 16, financement: 6 },
  proposalsCount: 26, acceptsCount: 6, declinesCount: 6,
  rayonKm: 50, urgences: false,
  lienCNQ: 'https://www.cnq.org/f/1/', prefixe: 'G1R',
  createdAt: '2025-06-01T00:00:00.000Z', lastSeenAt: '2026-08-12T00:00:00.000Z',
};

async function seed(a, over = {}) {
  await a.repo.putNotary({
    id: NOTARY, email: 'n@etude.ca', label: 'Étude N',
    status: 'active', chargesEnabled: true, connectAccountId: 'acct_n',
    ...FORT, ...over,
  });
}

async function offreOuverte(a, id = 'b1') {
  await a.repo.put({
    id, dateISO: '2026-08-25', serviceId: 'refinancement', montant: 2000,
    tier: 'standard', status: domain.STATUS.OUVERTE, anonyme: true, createdAt: TODAY,
    pricing: { deplacement: 'client_50' },
  });
  return id;
}
const retenir = (a, id) =>
  a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token()), body: JSON.stringify({ id, dateISO: '2026-08-25' }) });
const completer = (a, id) =>
  a.handle({ method: 'POST', path: '/notary/acts/complete', headers: bearer(token()), body: JSON.stringify({ bidId: id, dateISO: '2026-08-25', actAmount: 2000 }) });

test('la rétention grave le taux et la cote du moment sur l’offre', async () => {
  const a = app();
  await seed(a);
  const id = await offreOuverte(a);
  assert.equal((await retenir(a, id)).statusCode, 200);

  const bid = await a.repo.get(id, '2026-08-25');
  assert.equal(bid.tauxRetenu, 0.08, 'le taux montré à l’engagement');
  assert.ok(bid.coteRetenue >= 80, 'et la cote qui l’a mérité : ' + bid.coteRetenue);
});

test('une cote qui BAISSE après l’engagement ne renchérit pas l’acte', async () => {
  const a = app();
  await seed(a);
  const id = await offreOuverte(a);
  await retenir(a, id);

  // Entre la rétention et la signature, le notaire décline vingt demandes et
  // reçoit une volée de mauvaises notes : sa cote s’effondre.
  await a.repo.putNotary({ ...(await a.repo.getNotary(NOTARY)), ratingSum: 2 * 30, ratingCount: 30, declinesCount: 60 });
  const apres = await a.billing.commissionFor(await a.repo.getNotary(NOTARY), NOW_MS);
  assert.ok(apres.tauxEffectif > 0.08, 'la cote a bien chuté : ' + apres.tauxEffectif);

  const res = parse(await completer(a, id));
  assert.equal(res.commissionCents, Math.round(2000 * 100 * 0.08), 'le taux de l’engagement tient');

  const ledger = await a.repo.getActCompletion(id);
  assert.equal(ledger.taux, 0.08);
  assert.equal(ledger.tauxRetenu, 0.08, 'le registre garde la promesse faite à l’engagement');
});

test('une cote qui MONTE après l’engagement profite au notaire', async () => {
  const a = app();
  // Il s’engage avec un dossier moyen…
  await seed(a, { ratingSum: 4.6 * 8, ratingCount: 8, actsCompleted: 6, actsByService: { refinancement: 6 }, proposalsCount: 8, acceptsCount: 2, declinesCount: 2, rayonKm: 25, createdAt: '2026-06-01T00:00:00.000Z' });
  const id = await offreOuverte(a);
  await retenir(a, id);
  const retenu = (await a.repo.get(id, '2026-08-25')).tauxRetenu;
  assert.ok(retenu > 0.08, 'point de départ plus cher : ' + retenu);

  // …et signe avec un dossier de premier plan.
  await a.repo.putNotary({ ...(await a.repo.getNotary(NOTARY)), ...FORT, id: NOTARY });
  const res = parse(await completer(a, id));
  assert.equal(res.commissionCents, Math.round(2000 * 100 * 0.08), 'le mérite ne déplace la ligne que vers le notaire');
});

test('le plafond est un plafond, pas un tarif : il ne peut pas descendre sous le plancher du barème', async () => {
  const a = app();
  await seed(a);
  const id = await offreOuverte(a, 'b2');
  // Un plafond absurde inscrit sur l’offre (barème modifié, migration, bricolage)
  // ne doit pas offrir l’acte à Nota — le plancher du barème tient.
  await a.repo.update({ ...(await a.repo.get('b2', '2026-08-25')), status: domain.STATUS.OUVERTE });
  await retenir(a, 'b2');
  await a.repo.update({ ...(await a.repo.get('b2', '2026-08-25')), tauxRetenu: -1 });
  const res = parse(await completer(a, 'b2'));
  assert.ok(res.commissionCents >= Math.round(2000 * 100 * 0.05), 'jamais sous le plancher : ' + res.commissionCents);
});
