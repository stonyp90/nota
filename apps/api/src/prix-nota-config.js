'use strict';

/**
 * Le PRIX DE NOTA — un montant fixe, pour le service de Nota.
 *
 * Ce module remplace `commission-config.js`, et le changement de nom est le
 * fond du sujet : Nota ne prélève plus une part des honoraires du notaire,
 * Nota vend son propre service à son propre prix. Quatre textes, vérifiés mot
 * pour mot aux sources officielles, imposent ensemble cette forme.
 *
 * **Art. 32.1 2° de la Loi sur le notariat** (2023, c. 23, a. 37) — est
 * présumée usurper les fonctions de notaire la personne, autre qu'un membre de
 * l'Ordre, agissant comme intermédiaire, qui « obtient d'un notaire qu'il
 * abandonne une partie de ses honoraires et frais ». Le notaire reçoit donc
 * 100 % du montant offert : `honorairesCents`.
 *
 * **Art. 32 du Code de déontologie des notaires** — le notaire ne peut
 * partager ses honoraires avec une personne qui n'est pas membre d'un ordre
 * professionnel. La même conclusion, prise par l'autre bout : l'interdiction
 * frappe le notaire, la présomption frappe Nota, et corriger l'une sans
 * l'autre ne règle rien.
 *
 * **Art. 29.1 du Code de déontologie** — « Le notaire ne peut conclure aucune
 * convention ayant pour effet de mettre en péril l'indépendance, le
 * désintéressement, l'objectivité et l'intégrité requis pour l'exercice de la
 * profession. » C'est l'article qui condamne la mécanique des ADR 0027/0028 :
 * un revenu du notaire indexé sur une note attribuée par une entreprise
 * privée. **Le prix de Nota ne dépend donc ni du notaire, ni de sa cote, ni de
 * la valeur de l'acte.** Un seul nombre, le même pour tous.
 *
 * **Art. 32.1 3°** — écarte l'intermédiaire qui procure des services « sans
 * aucune responsabilité de sa part envers le notaire pour ses honoraires ».
 * Nota autorise, capture et garantit le net du notaire : la responsabilité est
 * assumée, et c'est délibéré.
 *
 * La cote (`domain.notaryScore`) survit intacte — classement du fil, accès aux
 * dossiers, statut. Elle ne touche simplement plus à un dollar.
 *
 * Voir `docs/decisions/0031-le-prix-de-nota-est-celui-de-nota.md`.
 */

// Le prix par défaut du service de Nota, en cents. Un montant fixe : ni
// pourcentage, ni fonction de la valeur de l'acte, ni fonction du notaire.
const DEFAULT_PRIX_CENTS = 40000; // 400,00 $

// Un entier de cents, ou undefined — les variables d'environnement et les
// items stockés passent tous par là, pour qu'une valeur illisible se lise
// comme absente plutôt que de faire tomber la tarification.
function centsOrUndefined(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Le prix du déploiement : le défaut intégré, surchargé par l'environnement.
 * C'est ce que la tarification utilise quand aucun prix stocké n'existe, et ce
 * que la console admin montre comme « le défaut » auquel une remise à zéro
 * revient.
 */
function envDefaults(env = process.env) {
  const p = centsOrUndefined(env.NOTA_PRIX_CENTS);
  return { prixCents: p !== undefined ? p : DEFAULT_PRIX_CENTS };
}

/**
 * Valide un prix proposé par l'admin. Bruyant et typé, comme les validateurs
 * du domaine : `{ ok, errors, prixCents }`. La règle tient en une ligne — un
 * entier de cents strictement positif.
 */
function validatePrix(payload = {}) {
  const prixCents = centsOrUndefined(payload.prixCents);
  if (prixCents === undefined) {
    return {
      ok: false,
      errors: [{
        code: 'prix_invalide',
        message: 'Le prix de Nota doit être un nombre entier de cents, supérieur à zéro (ex. 40000 pour 400,00 $).',
      }],
    };
  }
  return { ok: true, errors: [], prixCents };
}

/**
 * LE PRIX EN VIGUEUR — une seule résolution, pour toutes les surfaces.
 *
 * Le prix stocké par l'opérateur l'emporte sur celui du déploiement. Il est
 * essentiel que la tarification (ce que la carte du client bloque) et
 * l'annonce (ce que le carnet affiche) lisent le MÊME nombre : annoncer un
 * prix et en facturer un autre serait la publicité « incomplète » que
 * l'art. 68 du Code de déontologie interdit — et l'écart est précisément ce
 * que le client verrait. Deux résolutions parallèles finiraient par diverger ;
 * il n'y en a donc qu'une.
 *
 * Un prix stocké illisible se lit comme absent : le défaut reprend la main
 * plutôt que de faire tomber le carnet.
 */
async function resolvePrix(repo, env = process.env) {
  if (repo && typeof repo.getPrixNotaConfig === 'function') {
    try {
      const stored = await repo.getPrixNotaConfig();
      const v = stored && validatePrix(stored);
      if (v && v.ok) return v.prixCents;
    } catch { /* un prix stocké illisible ne fait jamais tomber la tarification */ }
  }
  return envDefaults(env).prixCents;
}

module.exports = {
  DEFAULT_PRIX_CENTS,
  envDefaults,
  validatePrix,
  resolvePrix,
};
