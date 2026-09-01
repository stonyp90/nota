# Politique de sécurité de l'information

> **BROUILLON NON RÉVISÉ.** Rédigé à partir du code, non par un juriste. Voir
> [`README.md`](README.md).

**Version : 0.1 (brouillon) · Date d'entrée en vigueur : à déterminer**

Ce document énonce les règles de sécurité de Nota. Chaque règle est suivie de
**son état réel** : en place, partielle, ou non implémentée. Une règle non
implémentée est écrite comme telle — une politique qui décrit un système
imaginaire ne protège personne.

---

## 1. Portée et responsabilité

Cette politique couvre l'ensemble du système Nota : l'application web, l'API,
la console d'administration, l'infrastructure AWS (`ca-central-1`) et les
sous-traitants.

Le **responsable de la sécurité** est la personne ayant la plus haute autorité
dans l'entreprise, jusqu'à désignation contraire. Elle est aussi, aujourd'hui, le
responsable de la protection des renseignements personnels et l'unique
administrateur de production. **Il n'existe aucune séparation des tâches**, ce
qui doit être compensé par une journalisation exhaustive — laquelle, aujourd'hui,
n'existe pas non plus (§5).

**Revue : annuelle**, et après tout incident.

---

## 2. Classification des données

| Niveau | Contenu | Traitement |
| --- | --- | --- |
| **Public** | carnet des offres : date, service, montant, secteur postal à 3 caractères | diffusion libre |
| **Interne** | analytique, configuration, barème | accès administratif seulement |
| **Confidentiel** | courriel, téléphone, nom, dossier, code partenaire, profils de notaires | accès strictement nécessaire |
| **Secret** | clés Stripe, secrets de signature HMAC, jetons de session | jamais journalisés, jamais transmis |

**En place :** la séparation public / confidentiel est appliquée au niveau du
code — la projection publique d'une offre ne porte ni courriel, ni téléphone, ni
dossier, ni code partenaire (`apps/api/src/handler.js:739-773`).

**Manque :** aucune étiquette de classification sur les ressources AWS. Les
seules étiquettes appliquées sont `Project` et `ManagedBy`
(`infra/providers.tf:38-43`).

---

## 3. Contrôle d'accès

### Règles

- L'accès est accordé **au minimum nécessaire**, et retiré dès qu'il n'est plus
  nécessaire.
- L'accès administratif est **nominatif**, jamais partagé.
- Les accès sont **revus tous les trimestres**.
- Tout accès administratif est **journalisé**.

### État réel

**En place :**

- Console admin sans mot de passe, par lien magique à usage unique ; le jeton
  signé ne suffit pas — une session serveur vivante, non révoquée, est vérifiée à
  chaque requête (`apps/api/src/admin.js:233-268`).
- Inactivité 30 minutes, plafond absolu 12 heures (`admin.js:73-75`).
- Révocation immédiate côté serveur (`apps/api/src/repo-dynamo.js:1041-1054`).
- Secrets de signature distincts pour l'admin et les notaires, **échec fermé en
  production** (`apps/api/src/admin-auth.js:46-55`,
  `apps/api/src/notary-auth.js:56-65`).
- Aucune énumération de comptes à la connexion (`admin.js:124-134`).
- Moindre privilège IAM strict : la Lambda publique n'a que
  `GetItem, PutItem, Query, UpdateItem` — **ni `Scan`, ni `DeleteItem`**
  (`infra/lambda.tf:43-61`) ; la Lambda admin est en lecture seule sur les
  données client, avec une porte d'écriture confinée par
  `dynamodb:LeadingKeys` (`infra/admin.tf:125-167`).
- Console admin protégée par un WAF en **refus par défaut** avec liste blanche
  d'adresses IP (`infra/admin-cdn.tf:249-321`).
- Déploiement par OIDC GitHub, **aucune clé AWS durable**, `sub` restreint au
  dépôt et à la branche `main` (`infra/cicd.tf:39-78`).

**Partiel ou manquant :**

- **Aucune revue d'accès n'a jamais eu lieu.** Aucune procédure, aucune trace.
- **Le premier courriel de la liste blanche devient `super_admin` sans
  approbation** (`admin.js:138`, `:203`).
- **Retirer un administrateur exige de redéployer l'infrastructure** : aucune
  route de gestion des utilisateurs n'existe.
- **Le jeton notaire est sans état et non révocable** : un jeton volé vit
  jusqu'à son expiration (`notary-auth.js:104-132`).
- **Deux modèles d'autorisation coexistent** : le catalogue de permissions
  `apps/api/src/rbac.js:24-38` n'est appelé nulle part ; c'est la table locale
  `admin.js:31-37` qui décide.
- **Aucun second facteur** propre à Nota : la sécurité de l'accès administratif
  repose entièrement sur la sécurité de la boîte courriel de l'opérateur.

---

## 4. Chiffrement

### Règles

- Toute donnée est chiffrée **en transit** et **au repos**.
- Les secrets sont gérés par un gestionnaire de secrets, jamais en clair.
- Les secrets sont **renouvelés au moins une fois par an** et immédiatement après
  tout soupçon de compromission.

### État réel

**En place :**

- HTTPS imposé partout (`infra/cloudfront.tf:168, 190`), HSTS 2 ans avec preload
  (`cloudfront.tf:50-55`), origine en `https-only` TLS 1.2
  (`cloudfront.tf:157-162`).
- Compartiments S3 chiffrés (AES256) et **entièrement privés** derrière un
  contrôle d'accès d'origine, avec épinglage sur l'ARN de la distribution
  (`infra/s3.tf:49-100`).
- Les données de carte et les pièces d'identité **ne touchent jamais nos
  serveurs** : Stripe héberge le paiement et l'inscription
  (`apps/api/src/stripe-port.js:14`).

**Manquant — et sérieux :**

- **Aucune ressource KMS dans toute l'infrastructure.** DynamoDB est chiffré par
  la clé détenue par AWS ; `infra/dynamodb.tf:17-19` porte un commentaire
  reconnaissant le trou.
- **`kms_key_arn` absent des trois fonctions Lambda** : les variables
  d'environnement — qui contiennent **la clé secrète Stripe** — sont lisibles par
  tout principal capable d'appeler `lambda:GetFunctionConfiguration`.
- **Ni Secrets Manager ni SSM.** Tout est en variable d'environnement en clair
  (`infra/lambda.tf:128-140`, `infra/admin.tf:234`).
- **Les deux secrets de signature HMAC sont générés dans l'état Terraform**, qui
  est un **fichier local, non chiffré, non versionné, sans verrou**
  (`infra/lambda.tf:83-86`, `infra/admin.tf:40-44` — aucun bloc `backend`
  n'existe).
- **Aucune rotation.** La procédure prescrite est un `terraform taint` manuel
  (`infra/lambda.tf:82`). Elle n'a jamais été exécutée.
- **TLS minimum réellement déployé : `TLSv1`.** Le passage à `TLSv1.2_2021` est
  conditionné à un domaine personnalisé qui n'est pas configuré
  (`infra/cloudfront.tf:222`, `infra/variables.tf:20-24`).
- **Aucune politique de compartiment ne refuse `aws:SecureTransport = false`**
  (`infra/s3.tf:81-100`).

---

## 5. Journalisation et surveillance

### Règles

- Toute action administrative et tout mouvement d'argent sont journalisés, en
  ajout seul.
- Les journaux de sécurité sont conservés **12 mois**.
- Toute alerte a un **destinataire nommé** et un délai de prise en charge.

### État réel

**En place :**

- Journal d'audit administratif en ajout seul, conditionné, sans expiration,
  portant acteur, courriel, adresse IP et horodatage
  (`apps/api/src/repo-dynamo.js:1069-1083`), écrit sur 12 actions
  (`apps/api/src/admin.js:120, 132, 179, 229, 287, 301, 409, 430, 483, 501, 552, 570`).
- Adresse IP de confiance, non usurpable (`apps/api/src/admin-handler.js:61-73`).
- 11 alarmes CloudWatch définies (`infra/observability.tf:90-286`).

**Manquant — c'est le plus grave défaut de sécurité du système :**

- **Aucun CloudTrail.** Il n'existe **aucune piste d'audit des appels d'API AWS**.
  Personne ne peut dire qui a modifié quoi dans l'infrastructure.
- **Aucun journal d'accès** : ni CloudFront, ni API Gateway, ni S3, ni WAF.
- **Les 11 alarmes ne préviennent personne** : `alert_email` n'est pas renseigné,
  **zéro abonnement SNS n'est déployé** (`infra/observability.tf:61-66`,
  `infra/variables.tf:71-75`).
- **Le journal d'audit applicatif n'est lisible par personne** :
  `queryAuditByDay` (`repo-dynamo.js:1084-1103`) n'est appelé nulle part et
  aucune route `/admin/audit` n'existe.
- **Le parcours de l'argent n'est pas journalisé du tout** : `appendAudit`
  n'apparaît que dans `admin.js`, jamais dans `handler.js` ni `billing.js`.
- **Ni AWS Config, ni GuardDuty, ni Security Hub, ni IAM Access Analyzer.**

---

## 6. Développement et gestion des changements

### Règles

- Tout changement passe par une demande de tirage revue.
- Les tests automatisés barrent le déploiement.
- Aucun secret n'entre dans le dépôt.
- Les dépendances sont analysées à chaque construction.

### État réel

**En place :**

- Intégration continue réelle : domaine, API, BDD Cucumber, DOM web et admin
  (`.github/workflows/ci.yml:22-47`) ; `terraform fmt -check` et `validate`
  (`ci.yml:49-65`).
- Le déploiement est barré par `needs: [test, e2e]` — la suite Playwright doit
  passer (`.github/workflows/deploy.yml:103`).
- Le déploiement de la console admin exige un **environnement GitHub protégé,
  imposé au niveau de la politique de confiance AWS**
  (`deploy-admin.yml:87` + `infra/admin.tf:335-339`).
- Aucun secret dans le dépôt : `terraform.tfstate` et `terraform.tfvars` sont
  ignorés par git et absents de l'index.

**Manquant :**

- **Le déploiement en production n'a aucune approbation humaine** : le job
  `deploy` n'a pas de clé `environment:`. Un `push` sur `main` part en
  production.
- **Aucun `CODEOWNERS`**, protection de branche non vérifiable depuis le dépôt.
- **Aucune analyse de sécurité en intégration continue** : ni `npm audit`, ni
  CodeQL, ni analyse d'infrastructure (`tfsec`, `checkov`), ni détection de
  secrets, ni Dependabot.
- **Actions GitHub épinglées par tag mutable** dans des workflows détenant
  `id-token: write`.
- **Le paquet Lambda embarque les dépendances de développement**
  (`infra/lambda.tf:9-13`).
- **La Lambda `reminders` n'est déployée par aucun workflow** et dérive en
  silence.
- **Aucun environnement hors production.** Un seul compte AWS, `NODE_ENV`
  codé en dur (`infra/lambda.tf:122`).
- **`terraform apply` se lance depuis un portable**, sans trace ni verrou. L'état
  déployé est déjà en retard sur `main`.

---

## 7. Continuité

**En place :** restauration à un instant donné sur 35 jours pour les deux tables
(`infra/dynamodb.tf:61-63`, `infra/admin.tf:75-77`), protection contre la
suppression (`dynamodb.tf:15`), versionnement S3 (`s3.tf:19-25`).

**Manquant :** aucun AWS Backup, aucune copie hors région ou hors compte, aucun
coffre verrouillé, **aucune restauration jamais testée**, aucun RTO ni RPO
documenté, **aucune file d'attente d'échec sur aucune Lambda** — une invocation
asynchrone ratée est perdue en silence.

---

## 8. Sous-traitants

Voir l'[accord de traitement des données](accord-de-traitement-des-donnees.md).

**Règle :** les rapports SOC 2 de chaque sous-traitant sont obtenus et revus
annuellement. **Aucune revue n'a eu lieu à ce jour.**

---

## 9. Incidents

Voir le [plan de réponse aux incidents](plan-de-reponse-aux-incidents.md).

---

## 10. Manquement

Un manquement à cette politique entraîne la révocation immédiate des accès.
