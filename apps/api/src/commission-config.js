'use strict';

/**
 * The commission barème — Nota's operating lever (ADR 0021).
 *
 * ADR 0016 made the commission rating-earned; ADR 0021 makes the schedule a
 * runtime document Nota edits from the admin console instead of a deploy-time
 * constant. This module is the ONE authority on the barème's shape: the
 * built-in defaults, the environment overrides (now actually read — the ADR
 * 0016 gap), and the validation the admin write door applies. It is shared by
 * billing.js (pricing) and admin.js (editing) precisely so the two can never
 * disagree; it deliberately lives in the billing layer, NOT the domain — the
 * domain still has no commission concept (ADR 0008's deontology boundary).
 */

// Default platform commission on a completed act (share of the acte's value).
const DEFAULT_RATE = 0.10;

// Each tier: a minimum one-decimal average (`note`), a minimum number of
// evaluations (`avis`), and the rate REDUCTION it earns (`bonus`). The single
// best attained tier applies; the floor is never crossed.
const DEFAULT_TIERS = [
  { note: 4.5, avis: 5, bonus: 0.01 },
  { note: 4.8, avis: 10, bonus: 0.02 },
];
const DEFAULT_FLOOR = 0.05;

const TIERS_MAX = 10;

// A finite number, or undefined — env vars and stored items both go through
// this so "0.08" and 0.08 read the same and garbage reads as absent.
function num(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// NOTA_COMMISSION_BONUS_TIERS is a JSON array of tiers. Anything else —
// unparsable JSON, a non-array, a malformed tier — reads as absent: a broken
// env var must fall back to the defaults, never crash pricing.
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
    const note = num(t && t.note);
    const avis = num(t && t.avis);
    const bonus = num(t && t.bonus);
    if (note === undefined || avis === undefined || bonus === undefined) return undefined;
    tiers.push({ note, avis, bonus });
  }
  return tiers;
}

// The deployment's defaults: built-ins, overlaid by whatever the environment
// declares. This is what pricing uses when no stored barème exists — and what
// the admin console shows as « the default » a reset returns to.
function envDefaults(env = process.env) {
  const taux = num(env.NOTA_COMMISSION_RATE);
  const plancher = num(env.NOTA_COMMISSION_RATE_FLOOR);
  const paliers = parseTiers(env.NOTA_COMMISSION_BONUS_TIERS);
  return {
    taux: taux !== undefined ? taux : DEFAULT_RATE,
    plancher: plancher !== undefined ? plancher : DEFAULT_FLOOR,
    paliers: paliers !== undefined ? paliers : DEFAULT_TIERS.map((t) => ({ ...t })),
  };
}

/**
 * Validate a barème the admin proposes. Loud and typed, like the domain's
 * validators: `{ ok, errors, taux, plancher, paliers }`. Rules: 0 < taux < 1,
 * 0 ≤ plancher ≤ taux, at most TIERS_MAX paliers, each with a real note
 * (1–5), an integer avis ≥ 1 and a bonus in (0, taux].
 */
function validateSchedule(payload = {}) {
  const errors = [];
  const taux = num(payload.taux);
  if (taux === undefined || !(taux > 0 && taux < 1)) {
    errors.push({ code: 'taux_invalide', message: 'Le taux de commission doit être un nombre entre 0 et 1 (ex. 0,10 pour 10 %).' });
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
    payload.paliers.forEach((t, i) => {
      const note = num(t && t.note);
      const avis = num(t && t.avis);
      const bonus = num(t && t.bonus);
      const bad =
        note === undefined || note < 1 || note > 5 ||
        avis === undefined || !Number.isInteger(avis) || avis < 1 ||
        bonus === undefined || bonus <= 0 || (taux !== undefined && bonus > taux);
      if (bad) {
        errors.push({ code: 'palier_invalide', message: `Palier ${i + 1} : il faut une note entre 1 et 5, un nombre d’avis entier ≥ 1 et un bonus entre 0 et le taux.` });
      } else {
        paliers.push({ note, avis, bonus });
      }
    });
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
