/**
 * ADR 0038. LA GARANTIE DE DATE PAIE SA PERCEPTION ET GARDE LA MARGE.
 *
 * Nota est la plateforme Stripe : la carte du client est débitée du TOTAL des
 * deux lignes, honoraires du notaire compris, et les frais de carte portent
 * sur ce total. Nota les supporte seule, y compris sur l'argent qu'elle vire
 * au notaire en entier. Chaque barreau de l'échelle de date multiplie donc
 * les honoraires du notaire ET un coût que Nota paie. Jusqu'au 2026-09-05,
 * deux barreaux (rapide, prioritaire) se vendaient sous ce coût : Nota était
 * plus pauvre sur l'acte le plus pressé.
 *
 * Ces tests tiennent la règle de tarification de l'ADR 0038 :
 *
 *   1. au multiple recommandé du barreau, la ligne de date couvre les frais
 *      qu'elle induit, sur le plancher du catalogue ET au sommet de la bande,
 *   2. la marge brute de Nota par acte MONTE avec l'urgence, elle ne
 *      redescend jamais,
 *   3. le taux de prise d'un acte pressé ne dépasse jamais celui d'un acte
 *      calme du même service : acheter une date ne rend jamais Nota plus lourde.
 *
 * Le taux de Stripe n'est écrit nulle part dans le code, et le code ne le
 * comptabilise jamais. Il est POSÉ ici, comme une hypothèse de modèle, au
 * taux publié pour une carte canadienne. Le jour où il change, ce fichier est
 * le seul endroit à mettre à jour, et la grille se relit contre lui.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../index.js');
const { SERVICES, TIERS, prixNota, tierMultiplier } = domain;

// Stripe, carte canadienne, taux publié : 2,9 % + 0,30 $ par transaction.
const STRIPE_RATE = 0.029;
const STRIPE_FIXED_CENTS = 30;

const stripeFee = (totalCents) => STRIPE_RATE * totalCents + STRIPE_FIXED_CENTS;

// L'économie d'UN acte au multiple donné : ce que le client paie, ce que
// Stripe prend, ce que Nota garde.
function economie(svc, tier, multiple) {
  const honoraires = svc.prixDepart * 100 * multiple;
  const nota = prixNota(svc.id, tier.id).totalCents;
  const total = honoraires + nota;
  const frais = stripeFee(total);
  return { honoraires, nota, total, frais, margeBrute: nota - frais, taux: nota / total };
}

test('la décision du 2026-09-05, chiffrée : 0 · 149 · 299 · 449 · 549 $', () => {
  const attendu = { standard: 0, rapide: 14900, prioritaire: 29900, urgence: 44900, extreme: 54900 };
  for (const t of TIERS) {
    assert.equal(t.prixNotaDateCents, attendu[t.id], t.id);
  }
});

test('RÈGLE 1. chaque barreau couvre les frais de carte qu’il induit, au multiple recommandé', () => {
  for (const svc of SERVICES) {
    const calme = economie(svc, domain.tierById('standard'), 1);
    for (const t of TIERS) {
      if (t.id === 'standard') continue;
      // Ce que le barreau AJOUTE aux frais de Stripe par rapport à une date calme,
      // et ce qu'il ajoute au revenu de Nota, net de ses propres frais.
      const presse = economie(svc, t, tierMultiplier(t.id));
      const fraisInduits = presse.frais - calme.frais;
      const ligneNette = t.prixNotaDateCents;
      assert.ok(ligneNette > fraisInduits,
        `${svc.id} · ${t.id} : la ligne de date (${ligneNette} ¢) ne couvre pas les frais qu’elle induit (${fraisInduits.toFixed(0)} ¢)`);
    }
  }
});

test('RÈGLE 1 bis. et encore au SOMMET de la bande du barreau, sur le plancher du catalogue', () => {
  // La bande est ce que le marché peut retenir sans sortir du palier : la
  // ligne doit tenir au pire du barreau, pas seulement à son milieu.
  for (const svc of SERVICES) {
    const calme = economie(svc, domain.tierById('standard'), 1);
    for (const t of TIERS) {
      if (t.id === 'standard') continue;
      const presse = economie(svc, t, t.apercuMax);
      assert.ok(presse.margeBrute > calme.margeBrute,
        `${svc.id} · ${t.id} au sommet de sa bande : Nota gagne ${presse.margeBrute.toFixed(0)} ¢ contre ${calme.margeBrute.toFixed(0)} ¢ sur une date calme`);
    }
  }
});

test('RÈGLE 2. la marge brute de Nota par acte monte avec l’urgence, jamais l’inverse', () => {
  for (const svc of SERVICES) {
    let precedente = -Infinity;
    for (const t of TIERS) {
      const e = economie(svc, t, tierMultiplier(t.id));
      assert.ok(e.margeBrute > precedente,
        `${svc.id} · ${t.id} : ${e.margeBrute.toFixed(0)} ¢ après ${precedente.toFixed(0)} ¢ au barreau d’avant`);
      precedente = e.margeBrute;
    }
  }
});

test('RÈGLE 3. acheter une date ne rend jamais Nota plus lourde : le taux de prise reste sous celui du standard', () => {
  for (const svc of SERVICES) {
    const calme = economie(svc, domain.tierById('standard'), 1);
    for (const t of TIERS) {
      if (t.id === 'standard') continue;
      const presse = economie(svc, t, tierMultiplier(t.id));
      assert.ok(presse.taux < calme.taux,
        `${svc.id} · ${t.id} : ${(presse.taux * 100).toFixed(2)} % contre ${(calme.taux * 100).toFixed(2)} % sur une date calme`);
    }
  }
});

test('la marge de Nota sur son propre revenu reste celle d’une date calme, à quelques points près', () => {
  // Le plan d'affaires modélise une marge brute d'environ 70 % sur une date
  // calme. Un barreau qui tomberait sous 60 % vendrait la date à perte de
  // marge, ce que l'échelle d'avant faisait (44,6 % au prioritaire).
  for (const svc of SERVICES) {
    for (const t of TIERS) {
      const e = economie(svc, t, tierMultiplier(t.id));
      const marge = e.margeBrute / e.nota;
      assert.ok(marge >= 0.6, `${svc.id} · ${t.id} : marge ${(marge * 100).toFixed(1)} %`);
    }
  }
});

test('l’échelle monte d’un barreau à l’autre, et le standard reste gratuit', () => {
  assert.equal(domain.tierById('standard').prixNotaDateCents, 0);
  let prev = -1;
  for (const t of TIERS) {
    assert.ok(t.prixNotaDateCents > prev || t.id === 'standard', t.id);
    prev = t.prixNotaDateCents;
  }
  // Le « à partir de » du héros ne bouge pas : la grille des services est intacte.
  assert.equal(prixNota(null, 'standard').totalCents, Math.min(...SERVICES.map((s) => s.prixNotaCents)));
});
