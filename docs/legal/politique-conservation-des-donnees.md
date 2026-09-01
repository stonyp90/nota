# Politique de conservation des données

> **BROUILLON NON RÉVISÉ.** Rédigé à partir du code, non par un juriste. Voir
> [`README.md`](README.md).

**Version : 0.1 (brouillon) · Date d'entrée en vigueur : à déterminer**

La Loi 25 impose une conservation **bornée** : un renseignement personnel est
détruit ou anonymisé lorsque la finalité pour laquelle il a été recueilli est
accomplie, sous réserve d'un délai de conservation prévu par la loi.

Ce document énonce les durées **voulues**, puis, honnêtement, les durées
**réellement appliquées par le code**. Les deux ne coïncident pas partout.

---

## 1. Le calendrier voulu

| Catégorie | Conservation | Justification |
| --- | --- | --- |
| Offre publiée et son dossier | **12 mois** après la date de signature | suivi du service, différends |
| Courriel de notification lié à une offre | effacé à la clôture ou à l'expiration de l'offre | finalité accomplie |
| Téléphone du client | même calendrier que l'offre | mise en relation seulement |
| Registre de règlement d'un acte (montant, part, références Stripe) | **7 ans** | obligations fiscales et comptables |
| Registre des évaluations | **12 mois**, puis anonymisation définitive | alimente la cote |
| Profil de notaire | durée de la relation, puis **24 mois** | preuve de la relation d'affaires |
| Journal d'audit administratif | **7 ans** | preuve d'imputabilité |
| Journaux techniques (Lambda, accès) | **12 mois** | investigation d'incident |
| Défis de connexion, compteurs anti-abus | **minutes à heures** | usage unique |
| Registre des incidents de confidentialité | **5 ans** après la date de l'incident | exigence Loi 25 |
| Désabonnements | **indéfiniment** | on ne peut pas oublier un refus sans le violer |

---

## 2. Ce que le code applique réellement

### Ce qui est automatiquement supprimé

| Élément | Mécanisme | Durée réelle |
| --- | --- | --- |
| Offre + dossier + téléphone + courriel + évaluation + trace d'annulation | attribut `ttl` DynamoDB, posé à la création | **400 jours** après la date de signature (`apps/api/src/handler.js:815`) |
| Défi de connexion notaire, réclamation partenaire, compteurs de débit | `ttl` par fenêtre | minutes (`apps/api/src/repo-dynamo.js:648-652, 707-711`) |
| Sessions et défis admin | `ttl` | ≤ 12 h (`apps/api/src/admin.js:216-226`) |
| Versions S3 non courantes | règle de cycle de vie | 30 jours (`infra/s3.tf:31-46`) |
| Journaux Lambda | `retention_in_days` | **14 jours déclarés** (`infra/logs.tf:31-48`) |

Le mécanisme TTL est bien activé sur les deux tables
(`infra/dynamodb.tf:69-72`, `infra/admin.tf:81-84`).

### Ce qui n'est jamais supprimé

| Élément | Pourquoi c'est un problème |
| --- | --- |
| **Profils de notaires** (`NOTARY#…/PROFILE`) | Portent courriel, identifiant Stripe Connect, historique de commission, notations. **Aucun `ttl`** — `infra/dynamodb.tf:65-68` le dit explicitement. Un notaire qui quitte la plateforme y reste indéfiniment. |
| **Registre des actes** (`ACT#…`) | Aucun `ttl` (`apps/api/src/repo-dynamo.js:735-749`). Voulu — c'est la pièce comptable — mais **non déclaré**. |
| **Événements Stripe traités** (`EVENT#…`) | Aucun `ttl` (`repo-dynamo.js:322-328`). Croissance sans fin, non documentée. |
| **Gains de parrainage** (`EARN#…`) | Aucun `ttl` (`repo-dynamo.js:835-840`). |
| **Registre des évaluations** (`EVAL#…`) | Aucun `ttl` (`repo-dynamo.js:558`). Survit à l'offre qui l'a produite. |
| **Désabonnements** (`UNSUB#…`) | Aucun `ttl` — correct et voulu. |
| **Journal d'audit admin** (`AUDIT#…`) | Aucun `ttl` — correct et voulu. |

---

## 3. Les écarts à corriger

1. **12 mois promis, 400 jours appliqués.** L'application annonce « au plus
   12 mois après la date de signature » (`apps/web/public/index.html:1102`) ; le
   code pose 400 jours, soit environ 13,1 mois
   (`apps/api/src/handler.js:815`). Il faut aligner l'un sur l'autre. Le
   commentaire d'infrastructure parle d'ailleurs de « ~13 mois »
   (`infra/dynamodb.tf:65-68`) : la cible réelle du concepteur n'est pas celle
   annoncée au client.

2. **« Le courriel de notification est effacé dès que l'offre est close ou
   expirée »** (`index.html:1102`) — **c'est faux**. Aucun code n'efface le
   courriel à la clôture ; il disparaît avec l'offre entière, au bout de 400
   jours. Cette phrase doit être retirée ou le comportement implémenté.

3. **Aucune suppression sur demande.** La promesse de suppression sous 30 jours
   (`index.html:1103`) n'a **aucun mécanisme** : ni route, ni outil, ni
   procédure. C'est le manquement le plus exigible immédiatement.

4. **Les profils de notaires n'ont aucune borne.** Il faut décider d'une durée
   après la fin de la relation et l'implémenter.

5. **Les registres survivent aux pièces justificatives.** Après 400 jours, le
   registre `ACT#` référence une offre effacée, et l'agrégat de notation d'un
   notaire n'est plus justifiable évaluation par évaluation. C'est défendable au
   nom de la minimisation, mais cela doit être un **choix documenté**, pas un
   effet de bord. Voir `../compliance/piste-audit-transactions.md`, §8.

6. **14 jours de journaux, et même pas.** La rétention de 14 jours
   (`infra/logs.tf:31-34`) est trop courte pour investiguer un incident.
   Pire : **aucun groupe de journaux n'existe dans l'état Terraform déployé**, ce
   qui signifie que les groupes auto-créés sont probablement en « N'expire
   jamais », hors de toute gestion — l'inverse exact de la politique.

---

## 4. Destruction

À l'échéance, DynamoDB supprime l'élément. La suppression se propage aux
sauvegardes ponctuelles (PITR) selon leur propre fenêtre de **35 jours**
(`infra/dynamodb.tf:61-63`) : un renseignement supprimé aujourd'hui reste
récupérable pendant 35 jours par restauration. C'est à déclarer au client.

**Un renseignement supprimé chez Nota ne l'est pas nécessairement chez Stripe** :
Stripe applique ses propres durées légales aux transactions.

---

## 5. Responsabilité

L'application de cette politique relève du responsable de la protection des
renseignements personnels (`confidentialite@nota.ca`).

**Revue : annuelle**, et à chaque changement de schéma de données.

> ⚠️ Aujourd'hui, aucune vérification ne contrôle qu'un nouveau type d'élément
> écrit dans la table porte un `ttl`. Un test automatisé — « tout élément
> contenant un renseignement personnel porte un `ttl` » — serait le seul moyen de
> rendre cette politique auto-exécutoire.
