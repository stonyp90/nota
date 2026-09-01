'use strict';

/**
 * Le barème du partage — le levier d'exploitation de Nota (ADR 0021, 0027, 0028).
 *
 * ADR 0016 a rendu la part méritée ; ADR 0021 en a fait un document d'exécution
 * que Nota édite depuis la console admin plutôt qu'une constante de déploiement ;
 * ADR 0028 remplace les axes épars (note / avis / actes) par UNE mesure —
 * la cote sur 100 du domaine — et fixe l'échelle décidée par le propriétaire :
 *
 *   Nota prend AU PLUS 15 % ; les meilleurs notaires ne laissent que 5 %.
 *
 * Ce module est la SEULE autorité sur la forme du barème : les défauts
 * intégrés, les surcharges d'environnement, et la validation qu'applique la
 * porte d'écriture admin. Il est partagé par billing.js (tarification) et
 * admin.js (édition) précisément pour que les deux ne puissent jamais diverger ;
 * il vit délibérément dans la couche facturation, PAS dans le domaine — le
 * domaine n'a toujours aucune notion de commission (frontière de l'ADR 0008).
 */

// Part de service par défaut sur un acte complété : 15 %, le notaire garde 85 %.
// C'est le point de DÉPART, celui d'un notaire sans historique.
const DEFAULT_RATE = 0.15;

// Le plancher : jamais moins de 5 % pour Nota, donc jamais plus de 95 % pour
// le notaire — le sommet décidé par le propriétaire (2026-09-01).
const DEFAULT_FLOOR = 0.05;

// L'échelle : une cote atteinte (domain.notaryScore) → la part que Nota garde.
// Un palier est atteint dès que la cote l'égale. Le meilleur palier atteint
// s'applique ; le plancher n'est jamais franchi.
const DEFAULT_TIERS = [
  { cote: 60, taux: 0.12 },  // le notaire garde 88 %
  { cote: 70, taux: 0.10 },  // 90 %
  { cote: 80, taux: 0.08 },  // 92 %
  { cote: 90, taux: 0.05 },  // 95 % — le sommet
];

const TIERS_MAX = 10;

// Un nombre fini, ou undefined — les variables d'environnement et les items
// stockés passent tous par là, pour que "0.08" et 0.08 se lisent pareil et que
// n'importe quoi d'autre se lise comme absent.
function num(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// NOTA_COMMISSION_TIERS est un tableau JSON de paliers `{ cote, taux }`. Tout
// le reste — JSON illisible, non-tableau, palier malformé, barème d'avant
// l'ADR 0028 (note/avis/bonus) — se lit comme ABSENT : un barème périmé doit
// retomber sur les défauts, jamais faire tomber la tarification.
function parseTiers(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (Array.isArray(raw)) return normalizeTiers(raw);
  try {
    return normalizeTiers(JSON.parse(String(raw)));
  } catch {
    return undefined;
  }
}
function normalizeTiers(arr) {
  if (!Array.isArray(arr)) return undefined;
  const tiers = [];
  for (const t of arr) {
    const cote = num(t && t.cote);
    const taux = num(t && t.taux);
    if (cote === undefined || taux === undefined) return undefined;
    tiers.push({ cote, taux });
  }
  return tiers.sort((a, b) => a.cote - b.cote);
}

// Les défauts du déploiement : les intégrés, recouverts par ce que déclare
// l'environnement. C'est ce que la tarification utilise quand aucun barème
// n'est stocké — et ce que la console admin montre comme « le défaut » auquel
// une remise à zéro revient.
function envDefaults(env = process.env) {
  const taux = num(env.NOTA_COMMISSION_RATE);
  const plancher = num(env.NOTA_COMMISSION_RATE_FLOOR);
  const paliers = parseTiers(env.NOTA_COMMISSION_TIERS);
  return {
    taux: taux !== undefined ? taux : DEFAULT_RATE,
    plancher: plancher !== undefined ? plancher : DEFAULT_FLOOR,
    paliers: paliers !== undefined ? paliers : DEFAULT_TIERS.map((t) => ({ ...t })),
  };
}

/**
 * Valider un barème que l'admin propose. Bruyant et typé, comme les
 * validateurs du domaine : `{ ok, errors, taux, plancher, paliers }`.
 *
 * Règles : 0 < taux < 1 ; 0 ≤ plancher ≤ taux ; au plus TIERS_MAX paliers,
 * chacun avec une cote entière de 1 à 100 et un taux entre le plancher et le
 * taux de base ; une cote ne se répète pas ; et le taux ne remonte JAMAIS
 * quand la cote monte — le mérite ne déplace la ligne que vers le notaire.
 */
function validateSchedule(payload = {}) {
  const errors = [];
  const taux = num(payload.taux);
  if (taux === undefined || !(taux > 0 && taux < 1)) {
    errors.push({ code: 'taux_invalide', message: 'Le taux de base doit être un nombre entre 0 et 1 (ex. 0,15 pour 15 %).' });
  }
  const plancher = num(payload.plancher);
  if (plancher === undefined || plancher < 0 || (taux !== undefined && plancher > taux)) {
    errors.push({ code: 'plancher_invalide', message: 'Le plancher doit être un nombre entre 0 et le taux de base.' });
  }
  let paliers;
  if (!Array.isArray(payload.paliers) || payload.paliers.length > TIERS_MAX) {
    errors.push({ code: 'paliers_invalides', message: `Les paliers doivent être une liste d’au plus ${TIERS_MAX} éléments.` });
  } else {
    paliers = [];
    payload.paliers.forEach((p, i) => {
      const cote = num(p && p.cote);
      const t = num(p && p.taux);
      const bad =
        cote === undefined || !Number.isInteger(cote) || cote < 1 || cote > 100 ||
        t === undefined || t < 0 || t >= 1 ||
        (plancher !== undefined && t < plancher) ||
        (taux !== undefined && t > taux);
      if (bad) {
        errors.push({ code: 'palier_invalide', message: `Palier ${i + 1} : il faut une cote entière de 1 à 100 et un taux entre le plancher et le taux de base.` });
      } else {
        paliers.push({ cote, taux: t });
      }
    });
    if (paliers.length === payload.paliers.length) {
      paliers.sort((a, b) => a.cote - b.cote);
      for (let i = 1; i < paliers.length; i++) {
        if (paliers[i].cote === paliers[i - 1].cote) {
          errors.push({ code: 'paliers_invalides', message: `Deux paliers ne peuvent pas viser la même cote (${paliers[i].cote}).` });
          break;
        }
        if (paliers[i].taux > paliers[i - 1].taux) {
          errors.push({ code: 'paliers_invalides', message: 'Une cote plus haute ne peut jamais coûter plus cher au notaire.' });
          break;
        }
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], taux, plancher, paliers };
}

module.exports = {
  DEFAULT_RATE,
  DEFAULT_TIERS,
  DEFAULT_FLOOR,
  TIERS_MAX,
  parseTiers,
  envDefaults,
  validateSchedule,
};
