// Audit console admin (2026-09-03), P1-22 : l'argent des annulations et les
// créances étaient invisibles de l'aperçu. Depuis l'ADR 0033 les frais
// d'annulation tardive sont le DÉDOMMAGEMENT du notaire — jamais un revenu de
// Nota. L'aperçu porte donc :
//
//   • `annulations` — le flux SUR LA PÉRIODE, lu dans les entrées d'audit
//     `annulation_frais` (la seule pièce qui existe sans nouveau compteur) :
//     ce qui a été VERSÉ aux notaires (`verse: true`), ce qui a été inscrit
//     comme DÛ (`verse: false`), et combien d'annulations ;
//   • `creances` — les SOLDES en ce moment, lus sur le registre des notaires :
//     `commissionCentsDue` (ce que les notaires doivent à Nota, ADR 0029) et
//     `dedommagementCentsDue` (ce que Nota doit encore aux notaires).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const TODAY = '2026-09-03';

async function seed() {
  const repo = createMemoryRepo([]);
  await repo.putNotary({ id: 'n1', email: 'n1@etude.ca', status: 'active', commissionCentsDue: 40000, dedommagementCentsDue: 84000 });
  await repo.putNotary({ id: 'n2', email: 'n2@etude.ca', status: 'onboarding', commissionCentsDue: 25000 });
  await repo.putNotary({ id: 'n3', email: 'n3@etude.ca', status: 'active' }); // rien de dû, dans aucun sens
  // Les frais voyagent en DOLLARS dans la meta (fee.frais), comme le handler les écrit.
  const row = (id, day, meta) => repo.appendTxAudit({ id, ts: day + 'T14:00:00.000Z', day, action: 'annulation_frais', meta });
  await row('a1', '2026-09-01', { bidId: 'b1', notaryId: 'n1', montant: 2800, taux: 0.3, frais: 840, verse: true, transferId: 'tr_1' });
  await row('a2', '2026-08-20', { bidId: 'b2', notaryId: 'n2', montant: 2000, taux: 0.1, frais: 200, verse: false, transferId: null });
  await row('a3', '2026-06-01', { bidId: 'b3', notaryId: 'n1', montant: 5000, taux: 0.3, frais: 1500, verse: true, transferId: 'tr_3' }); // hors fenêtre
  // Une autre pièce le même jour ne compte jamais comme une annulation.
  await repo.appendTxAudit({ id: 'x1', ts: '2026-09-01T15:00:00.000Z', day: '2026-09-01', action: 'acte_regle', meta: { bidId: 'b9', montant: 2000, honoraires: 2000, prixNota: 400 } });
  return repo;
}

test('les soldes de créances viennent du registre des notaires, additionnés', async () => {
  const repo = await seed();
  const o = await createAnalytics({ repo, now: () => TODAY }).overview();
  assert.deepEqual(o.creances, { commissionCentsDue: 65000, dedommagementCentsDue: 84000 });
});

test('le flux des annulations est celui de la période : versé, dû, nombre', async () => {
  const repo = await seed();
  const o = await createAnalytics({ repo, now: () => TODAY }).overview();
  assert.deepEqual(o.annulations, { nombre: 2, versesCents: 84000, dusCents: 20000 });
});

test('une période resserrée ne voit que ses annulations', async () => {
  const repo = await seed();
  const o = await createAnalytics({ repo, now: () => TODAY }).overview({ from: '2026-08-30', to: TODAY });
  assert.deepEqual(o.annulations, { nombre: 1, versesCents: 84000, dusCents: 0 });
  // Les soldes, eux, ne dépendent pas de la période.
  assert.equal(o.creances.commissionCentsDue, 65000);
});

test('un dépôt sans journal ni registre répond des zéros honnêtes, jamais une panne', async () => {
  const repo = createMemoryRepo([]);
  // Un adaptateur plus ancien, sans les portes de lecture.
  const ancien = new Proxy(repo, {
    get(t, k) {
      if (k === 'queryTxAuditByDay' || k === 'queryAuditByDay' || k === 'listNotaries') return undefined;
      return t[k];
    },
  });
  const o = await createAnalytics({ repo: ancien, now: () => TODAY }).overview();
  assert.deepEqual(o.annulations, { nombre: 0, versesCents: 0, dusCents: 0 });
  assert.deepEqual(o.creances, { commissionCentsDue: 0, dedommagementCentsDue: 0 });
});
