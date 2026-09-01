import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBilling, NOTARY_STATUS } = require('../src/billing.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
const config = require('../src/commission-config.js');
const cote = require('../src/cote.js');

const NOW = '2026-09-01T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const jourII = (n) => new Date(NOW_MS - n * 24 * 60 * 60 * 1000).toISOString();

/**
 * ADR 0028 — la cote sur 100 décide le partage.
 *
 * Nota prend AU PLUS 15 % ; les meilleurs notaires ne laissent que 5 %. Le
 * levier n'est plus une grille d'axes épars : c'est LA cote du domaine, qui
 * agrège la satisfaction des clients, les services rendus, la disponibilité
 * et la présence. Un seul nombre décide, et ce nombre est publié.
 */

function fakeStripe() {
  return {
    async createConnectAccount(a) { return { accountId: 'acct_' + a.notaryId }; },
    async createOnboardingLink(a) { return { url: 'https://connect.test/' + a.accountId }; },
    async chargeActCommission(a) { return { id: 'pi_' + (a.bidId || 'x'), applicationFeeCents: a.applicationFeeCents }; },
  };
}

// Un profil notaire, décrit par ce que la cote lit réellement.
function profil({ note = null, avis = 0, actes = 0, parService = null, repondu = 0, declinees = 0, rayonKm = 0, urgences = false, fiche = false, secteur = null, joursMembre = 0, joursInactif = 0 } = {}) {
  return {
    ratingSum: note == null ? 0 : note * avis, ratingCount: avis,
    actsCompleted: actes, actsByService: parService || (actes ? { refinancement: actes } : {}),
    proposalsCount: repondu, acceptsCount: 0, declinesCount: declinees,
    rayonKm, urgences, lienCNQ: fiche ? 'https://www.cnq.org/fiche/1/' : null, prefixe: secteur,
    createdAt: jourII(joursMembre), lastSeenAt: jourII(joursInactif),
  };
}

// Le sommet : aimé, volumineux sur tout le catalogue, disponible, présent.
const SOMMET = profil({
  note: 4.9, avis: 40, actes: 80, parService: { refinancement: 50, financement: 30 },
  repondu: 60, declinees: 3, rayonKm: 50, urgences: true,
  fiche: true, secteur: 'G1R', joursMembre: 500, joursInactif: 1,
});
const NEUF = profil({ rayonKm: 25, secteur: 'G1R', joursMembre: 1 });

async function notary(repo, email, over = {}) {
  const id = notaryIdForEmail(email);
  await repo.putNotary({
    id, email, connectAccountId: 'acct_' + id,
    status: NOTARY_STATUS.ACTIVE, chargesEnabled: true,
    createdAt: NOW, updatedAt: NOW,
    ...over,
  });
  return id;
}

const billingOn = (repo) => createBilling({ repo, stripe: fakeStripe(), now: () => NOW });

test('le barème par défaut : 15 % pour Nota au départ, 5 % au sommet', () => {
  assert.equal(config.DEFAULT_RATE, 0.15, 'Nota ne prend jamais plus de 15 %');
  assert.equal(config.DEFAULT_FLOOR, 0.05, 'et jamais moins de 5 %');
  assert.ok(config.DEFAULT_TIERS.length >= 3, 'l’échelle a des barreaux');
  let precedent = config.DEFAULT_RATE;
  for (const t of config.DEFAULT_TIERS) {
    assert.ok(Number.isInteger(t.cote) && t.cote > 0 && t.cote <= 100, 'chaque palier vise une cote');
    assert.ok(t.taux <= precedent, 'une cote plus haute ne coûte jamais plus cher');
    assert.ok(t.taux >= config.DEFAULT_FLOOR);
    precedent = t.taux;
  }
  const top = config.DEFAULT_TIERS[config.DEFAULT_TIERS.length - 1];
  assert.equal(top.cote, 90, 'le propriétaire : au-dessus de 90, c’est 95/5');
  assert.equal(top.taux, 0.05);
});

test('un notaire neuf part à 15 % — et sa cote lui dit exactement où il en est', async () => {
  const b = billingOn(createMemoryRepo());
  const c = await b.commissionFor(NEUF, NOW_MS);
  assert.equal(c.taux, 0.15);
  assert.equal(c.tauxEffectif, 0.15);
  assert.equal(c.part, 0.85, 'la part du notaire est énoncée, jamais laissée à recalculer');
  assert.equal(c.bonus, 0);
  assert.equal(c.cote, cote.coteFor(NEUF, NOW_MS).cote);
  assert.equal(c.axes.length, 4, 'les quatre axes voyagent avec le taux');
});

test('au-dessus de 90, le notaire garde 95 % — le sommet du propriétaire', async () => {
  const b = billingOn(createMemoryRepo());
  const c = await b.commissionFor(SOMMET, NOW_MS);
  assert.ok(c.cote > 90, 'le profil du sommet dépasse 90 : ' + c.cote);
  assert.equal(c.tauxEffectif, 0.05);
  assert.equal(c.part, 0.95);
  assert.equal(c.prochain, null, 'plus rien à atteindre');
});

test('la cote seule décide — du volume sans satisfaction ne monte pas au sommet', async () => {
  const b = billingOn(createMemoryRepo());
  const tiede = profil({
    note: 3.9, avis: 30, actes: 90, parService: { refinancement: 60, financement: 30 },
    repondu: 40, declinees: 25, rayonKm: 25, fiche: true, secteur: 'G1R', joursMembre: 400, joursInactif: 2,
  });
  const c = await b.commissionFor(tiede, NOW_MS);
  assert.ok(c.cote < 80, 'beaucoup d’actes tièdes ne font pas une cote de 80 : ' + c.cote);
  assert.ok(c.tauxEffectif > 0.05, 'le sommet reste fermé');
});

test('le palier suivant nomme la cote à atteindre, les points qui manquent et la part gagnée', async () => {
  const b = billingOn(createMemoryRepo());
  const c = await b.commissionFor(NEUF, NOW_MS);
  const premier = config.DEFAULT_TIERS.find((t) => t.cote > c.cote);
  assert.equal(c.prochain.cote, premier.cote);
  assert.equal(c.prochain.manque, premier.cote - c.cote, 'les points qui manquent, comptés');
  assert.equal(c.prochain.tauxEffectif, premier.taux);
  assert.equal(c.prochain.part, Math.round((1 - premier.taux) * 10000) / 10000);
});

test('sur un acte de 2 000 $ au départ, le partage est 1 700 $ / 300 $', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo);
  const id = await notary(repo, 'depart@example.ca', NEUF);
  const r = await b.completeAct({ notaryId: id, bidId: 's1', actAmount: 2000, serviceId: 'refinancement' });
  assert.equal(r.commissionCents, 30_000);
  assert.equal(2000 * 100 - r.commissionCents, 170_000, 'le côté notaire du même acte');
});

test('sur le même acte, le sommet ne laisse que 100 $ à Nota', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo);
  const id = await notary(repo, 'sommet@example.ca', SOMMET);
  const r = await b.completeAct({ notaryId: id, bidId: 's2', actAmount: 2000, serviceId: 'refinancement' });
  assert.equal(r.commissionCents, 10_000);
});

test('un acte complété compte pour la cote — une fois, et sur SON service', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo);
  const id = await notary(repo, 'compte@example.ca');

  await b.completeAct({ notaryId: id, bidId: 'a1', actAmount: 2000, serviceId: 'refinancement' });
  await b.completeAct({ notaryId: id, bidId: 'a2', actAmount: 2000, serviceId: 'financement' });
  let n = await repo.getNotary(id);
  assert.equal(n.actsCompleted, 2);
  assert.deepEqual(n.actsByService, { refinancement: 1, financement: 1 });

  // Le registre write-once a déjà répondu pour a1 — ni le compteur ni
  // l'éventail ne doivent bouger.
  await b.completeAct({ notaryId: id, bidId: 'a1', actAmount: 2000, serviceId: 'refinancement' });
  n = await repo.getNotary(id);
  assert.equal(n.actsCompleted, 2, 'une reprise ne gonfle jamais la notoriété');
  assert.deepEqual(n.actsByService, { refinancement: 1, financement: 1 });
});

test('une cote qui monte reprend le prix de l’acte suivant', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo);
  const id = await notary(repo, 'palier@example.ca', NEUF);
  const avant = await b.completeAct({ notaryId: id, bidId: 'p1', actAmount: 2000, serviceId: 'refinancement' });
  assert.equal(avant.commissionCents, 30_000);

  await repo.putNotary({ ...(await repo.getNotary(id)), ...SOMMET, id });
  const apres = await b.completeAct({ notaryId: id, bidId: 'p2', actAmount: 2000, serviceId: 'refinancement' });
  assert.equal(apres.commissionCents, 10_000, 'la cote se relit à chaque acte');
});

test('un barème stocké par Nota reprend la main ; un barème d’avant l’ADR 0028 se lit comme absent', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo);
  await repo.putCommissionConfig({ taux: 0.14, plancher: 0.06, paliers: [{ cote: 25, taux: 0.06 }] }, NOW);
  const c = await b.commissionFor(NEUF, NOW_MS);
  assert.equal(c.taux, 0.14);
  assert.ok(c.cote >= 25, 'le neuf franchit ce palier taillé pour lui : ' + c.cote);
  assert.equal(c.tauxEffectif, 0.06, 'le barème stocké tarife immédiatement');

  // La forme d'avant (note/avis/bonus) n'est plus un barème : elle se lit comme
  // absente et la tarification retombe sur les défauts, sans jamais tomber.
  assert.equal(config.parseTiers('[{"note":4,"avis":2,"bonus":0.05}]'), undefined);
  assert.equal(config.validateSchedule({ taux: 0.15, plancher: 0.05, paliers: [{ note: 4, avis: 2, bonus: 0.05 }] }).ok, false);
});

test('la validation garde l’échelle : cote entière 1–100, taux borné, jamais à l’envers', () => {
  const ok = config.validateSchedule({ taux: 0.15, plancher: 0.05, paliers: [{ cote: 90, taux: 0.05 }, { cote: 60, taux: 0.12 }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.paliers, [{ cote: 60, taux: 0.12 }, { cote: 90, taux: 0.05 }], 'triés par cote');

  const codes = (p) => (config.validateSchedule(p).errors || []).map((e) => e.code);
  assert.ok(codes({ taux: 0.15, plancher: 0.05, paliers: [{ cote: 0, taux: 0.1 }] }).includes('palier_invalide'), 'cote 0');
  assert.ok(codes({ taux: 0.15, plancher: 0.05, paliers: [{ cote: 101, taux: 0.1 }] }).includes('palier_invalide'), 'cote 101');
  assert.ok(codes({ taux: 0.15, plancher: 0.05, paliers: [{ cote: 70.5, taux: 0.1 }] }).includes('palier_invalide'), 'cote fractionnaire');
  assert.ok(codes({ taux: 0.15, plancher: 0.05, paliers: [{ cote: 70, taux: 0.02 }] }).includes('palier_invalide'), 'sous le plancher');
  assert.ok(codes({ taux: 0.15, plancher: 0.05, paliers: [{ cote: 70, taux: 0.20 }] }).includes('palier_invalide'), 'au-dessus du taux de base');
  assert.ok(codes({ taux: 0.15, plancher: 0.05, paliers: [{ cote: 60, taux: 0.08 }, { cote: 80, taux: 0.12 }] }).includes('paliers_invalides'), 'une cote plus haute ne coûte pas plus cher');
  assert.ok(codes({ taux: 0.15, plancher: 0.05, paliers: [{ cote: 60, taux: 0.08 }, { cote: 60, taux: 0.07 }] }).includes('paliers_invalides'), 'deux fois la même cote');
});

test('le plancher tient même si le barème est mal configuré — le mérite ne va que vers le notaire', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo);
  // Un plancher au-dessus du taux (faute de frappe) ne doit jamais facturer
  // PLUS que la base.
  await repo.putCommissionConfig({ taux: 0.10, plancher: 0.20, paliers: [{ cote: 10, taux: 0.20 }] }, NOW);
  const c = await b.commissionFor(SOMMET, NOW_MS);
  assert.ok(c.tauxEffectif <= 0.10, 'jamais au-dessus du taux de base : ' + c.tauxEffectif);
});
