'use strict';

/**
 * Le PRIX DE NOTA — une grille par service, décidée par Nota.
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
 * la valeur de l'acte.**
 *
 * **Art. 32.1 3°** — écarte l'intermédiaire qui procure des services « sans
 * aucune responsabilité de sa part envers le notaire pour ses honoraires ».
 * Nota autorise, capture et garantit le net du notaire : la responsabilité est
 * assumée, et c'est délibéré.
 *
 * **ADR 0034 (2026-09-03)** — le prix cesse d'être UN nombre pour devenir une
 * GRILLE : une ligne par service, plus la garantie de date sur sa propre ligne.
 * Un prix unique posé sur des actes inégaux était régressif — plus l'acte était
 * petit, plus Nota pesait. La grille ne rouvre aucun des quatre murs : elle
 * dépend du service et du délai, deux dimensions PUBLIÉES que le client connaît
 * avant d'offrir, et de rien qui touche au notaire.
 *
 * La grille elle-même vit dans `@nota/domain`, avec le catalogue des services
 * qu'elle tarife ; ce module ne fait que l'environnement, la validation et le
 * stockage. La cote (`domain.notaryScore`) survit intacte — classement du fil,
 * accès aux dossiers, statut. Elle ne touche simplement plus à un dollar.
 *
 * Voir `docs/decisions/0034-le-prix-de-nota-est-une-grille-par-service.md`
 * et `docs/decisions/0031-le-prix-de-nota-est-celui-de-nota.md`.
 */

const domain = require('@nota/domain');

// Un entier de cents, ou undefined — les variables d'environnement et les
// items stockés passent tous par là, pour qu'une valeur illisible se lise
// comme absente plutôt que de faire tomber la tarification.
function centsOrUndefined(v, min = 1) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= min ? n : undefined;
}

// Un objet JSON, ou undefined. Une valeur illisible se lit comme absente.
function jsonOrUndefined(v) {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * La grille du déploiement : celle du catalogue, surchargée par l'environnement.
 * C'est ce que la tarification utilise quand aucune grille stockée n'existe, et
 * ce que la console admin montre comme « le défaut » auquel une remise à zéro
 * revient.
 *
 * `NOTA_PRIX_CENTS` — l'ancien prix UNIQUE de l'ADR 0031. Il survit tel quel :
 * un déploiement qui le porte encore tarife exactement ce qu'il tarifait la
 * veille, sur tous les services, sans ligne de garantie de date.
 * `NOTA_PRIX_GRILLE` — la grille, en JSON : `{ services, garantieDate }`.
 */
function envDefaults(env = process.env) {
  const unique = centsOrUndefined(env.NOTA_PRIX_CENTS);
  const grille = jsonOrUndefined(env.NOTA_PRIX_GRILLE) || {};
  return domain.prixNotaGrille({
    prixCents: unique,
    services: grille.services,
    garantieDate: grille.garantieDate,
  });
}

const erreur = (code, message) => ({ code, message });
const PRIX_INVALIDE = 'Chaque cellule de la grille doit être un nombre entier de cents (ex. 24900 pour 249,00 $) — strictement positif pour un service, zéro accepté pour la garantie de date.';

/**
 * Valide une grille proposée par l'admin. Bruyante et typée, comme les
 * validateurs du domaine : `{ ok, errors, config, grille }`.
 *
 *   `config` — ce qu'il faut STOCKER : les seules cellules décidées par
 *              l'opérateur. Un service ajouté au catalogue demain sera donc
 *              tarifé par le catalogue jusqu'à ce que Nota en décide autrement,
 *              plutôt que par un zéro figé dans un vieil enregistrement.
 *   `grille` — la grille COMPLÈTE qui en découle, telle que la tarification la
 *              lira. C'est elle que l'écran doit montrer.
 *
 * L'ancien corps `{ prixCents }` de l'ADR 0031 reste accepté et rend l'ancien
 * champ : une console ou un script écrit avant le 2026-09-03 continue de
 * fonctionner.
 */
function validatePrix(payload = {}) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const errors = [];

  // L'ancien contrat : un seul nombre pour tout le catalogue.
  if (body.prixCents !== undefined && body.services === undefined && body.garantieDate === undefined) {
    const prixCents = centsOrUndefined(body.prixCents);
    if (prixCents === undefined) {
      return { ok: false, errors: [erreur('prix_invalide', PRIX_INVALIDE)] };
    }
    return {
      ok: true, errors: [], prixCents,
      config: { prixCents },
      grille: domain.prixNotaGrille({ prixCents }),
    };
  }

  const lire = (source, { min, connus, codeInconnu }) => {
    const out = {};
    if (source === undefined || source === null) return out;
    if (typeof source !== 'object' || Array.isArray(source)) {
      errors.push(erreur('prix_invalide', PRIX_INVALIDE));
      return out;
    }
    for (const id of Object.keys(source)) {
      if (!connus.includes(id)) {
        errors.push(erreur(codeInconnu, `« ${id} » n’est pas au catalogue.`));
        continue;
      }
      const cents = centsOrUndefined(source[id], min);
      if (cents === undefined) {
        errors.push(erreur('prix_invalide', PRIX_INVALIDE));
        continue;
      }
      out[id] = cents;
    }
    return out;
  };

  const services = lire(body.services, {
    min: 1,
    connus: domain.SERVICES.map((s) => s.id),
    codeInconnu: 'service_inconnu',
  });
  // Zéro est une décision légitime ici : renoncer à facturer la garantie de
  // date n'est pas donner un service, c'est ne pas en vendre un.
  const garantieDate = lire(body.garantieDate, {
    min: 0,
    connus: domain.TIERS.map((t) => t.id),
    codeInconnu: 'palier_inconnu',
  });

  if (errors.length) return { ok: false, errors };
  if (!Object.keys(services).length && !Object.keys(garantieDate).length) {
    return { ok: false, errors: [erreur('prix_invalide', PRIX_INVALIDE)] };
  }

  const config = { services, garantieDate };
  return { ok: true, errors: [], config, grille: domain.prixNotaGrille(config) };
}

/**
 * LA GRILLE EN VIGUEUR — une seule résolution, pour toutes les surfaces.
 *
 * La grille stockée par l'opérateur l'emporte sur celle du déploiement. Il est
 * essentiel que la tarification (ce que la carte du client bloque) et
 * l'annonce (ce que le carnet affiche) lisent les MÊMES nombres : annoncer un
 * prix et en facturer un autre serait la publicité « incomplète » que
 * l'art. 68 du Code de déontologie interdit — et l'écart est précisément ce
 * que le client verrait. Deux résolutions parallèles finiraient par diverger ;
 * il n'y en a donc qu'une.
 *
 * Une grille stockée illisible se lit comme absente : le défaut reprend la main
 * plutôt que de faire tomber le carnet.
 */
async function resolveGrille(repo, env = process.env) {
  if (repo && typeof repo.getPrixNotaConfig === 'function') {
    try {
      const stored = await repo.getPrixNotaConfig();
      if (stored) {
        const v = validatePrix(stored);
        if (v.ok) return v.grille;
      }
    } catch { /* une grille stockée illisible ne fait jamais tomber la tarification */ }
  }
  return envDefaults(env);
}

/**
 * Le CATALOGUE tel que la console admin doit le montrer : les lignes à éditer,
 * avec leurs noms. La console n'a pas le domaine ; sans cet écho elle devrait
 * coder en dur les services et les paliers, et une ligne ajoutée au catalogue
 * deviendrait invisible à l'opérateur.
 */
function catalogue() {
  return {
    services: domain.SERVICES.map((s) => ({ id: s.id, nom: s.nom, nomEn: s.nomEn || s.nom })),
    garantieDate: domain.TIERS.map((t) => ({ id: t.id, nom: t.nom, nomEn: t.nomEn || t.nom, maxJours: t.maxJours })),
  };
}

/**
 * La forme STOCKÉE d'une grille — une liste d'autorisation, pour que les deux
 * adaptateurs de persistance écrivent le même enregistrement et qu'un champ
 * étranger ne puisse jamais entrer dans l'item de configuration. L'ancien
 * `prixCents` de l'ADR 0031 en fait partie : il doit pouvoir être relu, donc
 * pouvoir être écrit.
 */
function storedConfig(cfg = {}) {
  const out = {};
  if (cfg.services && typeof cfg.services === 'object') out.services = { ...cfg.services };
  if (cfg.garantieDate && typeof cfg.garantieDate === 'object') out.garantieDate = { ...cfg.garantieDate };
  if (cfg.prixCents !== undefined) out.prixCents = cfg.prixCents;
  return out;
}

module.exports = {
  envDefaults,
  validatePrix,
  resolveGrille,
  catalogue,
  storedConfig,
};
