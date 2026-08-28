'use strict';

/**
 * Le barème des frais d'annulation — un document d'exploitation (ADR 0023).
 *
 * Annuler une offre RETENUE près de la date de signature retient une part du
 * montant convenu, capturée sur la caution déjà posée (ADR 0015). Ce module
 * est la SEULE autorité sur la forme du barème : défauts intégrés, override
 * d'environnement, validation du write door admin, et l'arithmétique des
 * frais elle-même. Il est partagé par la route d'annulation (handler.js) et
 * la console admin (admin.js) précisément pour que les deux ne puissent
 * jamais diverger ; comme la commission, il vit dans la couche API, JAMAIS
 * dans le domaine (frontière déontologique de l'ADR 0008).
 *
 * Un palier : { maxJours, taux } — le taux s'applique quand il reste AU PLUS
 * `maxJours` jours avant la signature. Les paliers se lisent en ordre
 * croissant de maxJours ; au-delà du dernier, l'annulation est gratuite. Un
 * barème vide ([]) rend l'annulation gratuite partout : le kill-switch est
 * une donnée, pas un flag.
 */

// Défauts : la dernière minute (les trois derniers jours, la même « seule
// situation » que la tarification) retient 30 %, la fenêtre rapide 10 %,
// au-delà de 14 jours l'annulation est gratuite.
const DEFAULT_TIERS = [
  { maxJours: 3, taux: 0.30 },
  { maxJours: 14, taux: 0.10 },
];

const TIERS_MAX = 10;

// A finite number, or undefined — env vars and stored items both go through
// this so "0.3" and 0.3 read the same and garbage reads as absent.
function num(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// NOTA_CANCELLATION_TIERS is a JSON array of paliers. Anything else —
// unparsable JSON, a non-array, a malformed palier — reads as absent: a
// broken env var must fall back to the defaults, never crash a cancellation.
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
    const maxJours = num(t && t.maxJours);
    const taux = num(t && t.taux);
    if (maxJours === undefined || taux === undefined) return undefined;
    tiers.push({ maxJours, taux });
  }
  return tiers;
}

// The deployment's defaults: built-ins, overlaid by whatever the environment
// declares. This is what a cancellation prices on when no stored barème
// exists — and what the admin console shows as « the default ».
function envDefaults(env = process.env) {
  const paliers = parseTiers(env.NOTA_CANCELLATION_TIERS);
  return { paliers: paliers !== undefined ? paliers : DEFAULT_TIERS.map((t) => ({ ...t })) };
}

/**
 * Validate a barème the admin proposes. Loud and typed, like the domain's
 * validators: `{ ok, errors, paliers }`. Rules: at most TIERS_MAX paliers,
 * each with an integer maxJours ≥ 0 and a taux in (0, 1), maxJours strictly
 * ascending so every day count resolves to exactly one palier. An empty list
 * is valid — it means cancellation is free everywhere.
 */
function validateSchedule(payload = {}) {
  const errors = [];
  let paliers;
  if (!Array.isArray(payload.paliers) || payload.paliers.length > TIERS_MAX) {
    errors.push({ code: 'paliers_invalides', message: `Les paliers doivent être une liste d’au plus ${TIERS_MAX} éléments.` });
  } else {
    paliers = [];
    let prev = -1;
    payload.paliers.forEach((t, i) => {
      const maxJours = num(t && t.maxJours);
      const taux = num(t && t.taux);
      const bad =
        maxJours === undefined || !Number.isInteger(maxJours) || maxJours < 0 ||
        taux === undefined || taux <= 0 || taux >= 1;
      if (bad) {
        errors.push({ code: 'palier_invalide', message: `Palier ${i + 1} : il faut un nombre de jours entier ≥ 0 et un taux entre 0 et 1 (ex. 0,30 pour 30 %).` });
      } else if (maxJours <= prev) {
        errors.push({ code: 'paliers_desordonnes', message: `Palier ${i + 1} : les jours doivent être strictement croissants.` });
      } else {
        prev = maxJours;
        paliers.push({ maxJours, taux });
      }
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], paliers };
}

/**
 * The fee a cancellation carries, pure: the retained montant (dollars), the
 * number of days left before the signing, and the barème in force. Days are
 * clamped to 0 — a signing date already past but never settled counts as
 * last-minute, not as free. Beyond the last palier the fee is zero. Returns
 * `{ taux, frais, fraisCents, joursAvant }`, frais rounded to the cent.
 */
function feeFor({ montant, joursAvant, paliers } = {}) {
  const m = num(montant);
  const jours = Math.max(0, Math.floor(num(joursAvant) ?? 0));
  const bareme = Array.isArray(paliers) ? paliers : DEFAULT_TIERS;
  let taux = 0;
  for (const t of bareme) {
    if (jours <= t.maxJours) { taux = t.taux; break; }
  }
  const fraisCents = m !== undefined && m > 0 && taux > 0 ? Math.round(m * 100 * taux) : 0;
  return { taux, frais: fraisCents / 100, fraisCents, joursAvant: jours };
}

module.exports = {
  DEFAULT_TIERS,
  TIERS_MAX,
  parseTiers,
  envDefaults,
  validateSchedule,
  feeFor,
};
