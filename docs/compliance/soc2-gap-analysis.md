# Analyse d'écart SOC 2 — Nota

**Date : 1er septembre 2026. Statut : constat interne, non révisé par un auditeur.**

Ce document mesure le produit **tel qu'il est écrit**, contre les *Trust Services
Criteria* (TSC 2017, révision 2022) : **Sécurité (CC1-CC9)**, **Disponibilité
(A1)** et **Confidentialité (C1)**.

Règles que ce document s'impose :

1. **Aucun contrôle n'est coché s'il n'existe pas dans le code.** Une intention
   dans un commentaire n'est pas un contrôle.
2. **Chaque affirmation cite `fichier:ligne`.**
3. Un contrôle *déclaré en Terraform mais absent de l'état déployé* est noté
   **DÉRIVE** et compte comme **absent**. Plusieurs le sont.
4. Un contrôle **écrit dans le code mais qui ne s'exécute pas en production**
   compte comme **absent**. Il y en avait un — corrigé depuis (CC7.2) ; la règle
   reste, parce que le schéma qui l'a produit persiste ailleurs.

Légende — **P** : présent et vérifiable · **PP** : partiel · **A** : absent.
Effort : **F** (< 1 jour) · **M** (1-5 jours) · **É** (> 5 jours ou externe).

---

## Révision du 1er septembre 2026 (soir)

Une passe de correction a répondu à plusieurs constats de la première version.
Sont désormais **présents et vérifiés** :

- une **piste d'audit des transactions** dans le handler public — `acte_retenu`,
  `acte_regle`, `annulation_frais` (`apps/api/src/handler.js:300-305, 506-513,
  1126-1138, 1995-2004`), sur le **jour ouvrable québécois** ;
- **`GET /admin/audit`** et **`GET /admin/notaries`**, gardés par `pii:read`
  (`apps/api/src/admin-handler.js:207-226`, `admin.js:587-676`) — le journal a
  enfin un lecteur ;
- **`GET /notary/acts`**, le relevé acte par acte du notaire
  (`handler.js:1477-1517`) ;
- le **taux et la cote figés dans le registre write-once `ACT#`**
  (`apps/api/src/billing.js:314-317, 428-429`) ;
- **`retainedAt`** persisté (`handler.js:501-503`) ;
- la fin du **règlement fantôme** : le chemin de repli n'appelle plus Stripe et
  enregistre une **créance** honnête (`billing.js:255-340`) ;
- la **cohérence dit/fait sur l'économie** : site, README, ADR 0028 et code
  disent tous « Nota au plus 15 %, le notaire 85 % à 95 % »
  (`apps/web/public/index.html:768, 1160, 1170`, `commission-config.js:23, 27`).

S'y ajoute, le même soir, l'**ADR 0030 (« la déontologie prime »)** et une
**correction factuelle du circuit de l'argent** — les deux traités en CC2.3 et
CC9.3, et développés dans
[`../legal/conformite-deontologique-notaires.md`](../legal/conformite-deontologique-notaires.md) :

- **aucune appréciation d'un notaire nommé ne descend plus vers un client** :
  moyenne, nombre d'avis et cote retirés de `GET /client/bid`, remplacés par des
  faits — `cnq`, `lienCNQ`, `actes` (`apps/api/src/handler.js:1763-1771`,
  `:1797-1801`), avec quatre suites de tests qui échouent sur une régression ;
- **le client paie la PLATEFORME**, contrairement à ce qu'affirmait l'ADR 0027 :
  la caution est une session Checkout sur le compte de Nota — aucun compte
  connecté, pas de `on_behalf_of`, pas de `transfer_data`
  (`apps/api/src/stripe-port.js:85-116`) — et le règlement capture sur la
  plateforme puis vire le net (`:126-146`) ;
- **le taux est gravé à l'engagement comme plafond** (`handler.js:509-524`,
  `billing.js:174-180`) : une cote qui baisse ne renchérit jamais un acte déjà
  promis.

**Deux problèmes ont été relevés en cours de rédaction ; le premier a été
corrigé pendant celle-ci :**

1. ✅ **La trace de transaction n'atteignait pas la production** — le journal vit
   dans `nota-admin`, à laquelle la Lambda publique n'a aucun accès, et le
   `catch` best-effort avalait l'exception. **Corrigé** : les événements d'argent
   vont désormais dans la table **principale** via `appendTxAudit`
   (`repo-dynamo.js:1072-1110`), `GET /admin/audit` fusionne les deux journaux
   (`admin.js:677-678`), et `apps/api/test/audit-dynamo.test.mjs` échoue si la
   trace repart vers la mauvaise table. Aucune permission nouvelle, isolement des
   tables préservé. Voir CC7.2.
2. ⚠️ **La créance ne peut pas être recouvrée.** `commissionCentsDue` ne fait que
   croître : aucune route, aucun état, aucun âge, et elle disparaît de l'écran
   dès que le notaire cesse d'être `active`. **Non corrigé** — c'est désormais le
   premier trou de la piste financière.

---

## Avertissement préalable sur la portée

Un audit SOC 2 Type I atteste que des contrôles **sont conçus et en place à une
date donnée**. Aujourd'hui, trois faits rendent un Type I impossible tel quel :

- **Il n'existe aucune politique écrite.** Pas de politique de sécurité, pas de
  plan de réponse aux incidents, pas de politique de conservation, pas de revue
  d'accès. Le répertoire `docs/` ne contenait rien de tel avant ce travail. La
  moitié des CC1-CC5 est de la documentation, pas du code.
- **Il n'existe aucune piste d'audit AWS.** Pas de CloudTrail. Aucun
  enregistrement de qui a fait quoi sur l'infrastructure.
- **Les 11 alarmes ne préviennent personne.** Aucun abonnement SNS n'est déployé.
La piste d'audit applicative des transactions, qui ne s'exécutait pas en
production, **a été corrigée pendant la rédaction de ce document** (CC7.2). Elle
illustre la règle n° 4 ci-dessus : un contrôle *conçu* mais qui ne produit aucune
preuve n'est pas un contrôle *en place*, et c'est précisément la distinction
qu'un Type I mesure.

---

## CC1 — Environnement de contrôle

| Contrôle | État | Ce qui existe (preuve) | Ce qui manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| CC1.1 Engagement envers l'intégrité et l'éthique | **A** | Rien de formel. La charte client (`apps/web/public/index.html:1162-1198`) est du marketing, pas une politique interne. | Code de conduite, engagement écrit de la direction. | F | Moyenne |
| CC1.2 Surveillance par un organe de gouvernance | **A** | — | Nota est une entreprise à un opérateur. Il faut nommer explicitement le responsable de la sécurité et documenter la fréquence de revue. | F | Haute |
| CC1.3 Structure, autorités et responsabilités | **PP** | Le catalogue RBAC existe et est *fail-closed* : `apps/api/src/rbac.js:24-38` (13 permissions), `rbac.js:70-74` (`can()` refuse par défaut). Rôles hérités `super_admin` / `analyst` : `rbac.js:43-46`. | Aucun organigramme, aucune matrice de séparation des tâches. **`rbac.js` est du code mort** : `admin.js:31-37` utilise une table `PERMISSIONS` locale, distincte, qui n'accorde jamais `audit:read` ni `users:*`. Deux modèles d'autorisation coexistent. | M | **Haute** |
| CC1.4 Compétence | **A** | — | Aucune exigence de formation, aucune vérification d'antécédents. | F | Basse |
| CC1.5 Imputabilité | **PP** | Le journal d'audit admin nomme l'acteur : `admin.js:83-99` écrit `adminId, email, ip`. Il est désormais **lisible** : `GET /admin/audit?jour=…` gardé par `pii:read` (`admin-handler.js:219-226`, `admin.js:662-676`), et `GET /admin/notaries` donne le registre nominatif (`admin.js:587-627`). | Le côté marketplace est journalisé **en intention seulement** : les trois traces de `handler.js` n'atteignent pas la production (CC7.2). Les entrées écrites depuis le handler public portent `adminId: null, email: null, ip: null` (`handler.js:303`) — l'acteur y est le notaire, nommé dans `meta`, pas dans les champs d'imputabilité. | F | Haute |

---

## CC2 — Communication et information

| Contrôle | État | Ce qui existe (preuve) | Ce qui manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| CC2.1 Information pertinente et de qualité | **PP** | Analytique interne : rollups `STATS#` shardés, `apps/api/src/keys.js:126-165`, lus par `apps/api/src/analytics.js`. | Ces compteurs sont **best-effort et silencieusement avalés** (`billing.js:160-169`) : ils ne peuvent pas servir de preuve. | M | Moyenne |
| CC2.2 Communication interne | **A** | — | Aucune politique publiée en interne, aucun canal d'incident. | F | Haute |
| CC2.3 Communication externe | **PP** | Conditions d'utilisation affichées : `index.html:1116-1159`. Confidentialité : `index.html:1076-1113`. Rôle de Nota et absence de conseil juridique : `index.html:1142-1143`. Adresse de confidentialité : `confidentialite@nota.ca` (`index.html:1109`). **La divulgation du partage est désormais exacte et cohérente** : « Nota conserve au plus 15 % », « le notaire 85 % à 95 % » (`index.html:768, 1160, 1170`, `i18n.js:721, 730`) correspondent à `commission-config.js:23, 27` ; l'ancien 75/25 et la phrase contradictoire de la charte ont disparu (`index.html:1214`), et l'ADR 0028 documente la règle. Le notaire voit sa cote, son taux et le prochain palier (`billing.js:122-146`, `handler.js:1450-1462`) ; l'opérateur voit le même chiffre pour tous sous un barème résolu une seule fois (`admin.js:598`) ; le client voit **son** partage après règlement (`handler.js:1807-1810`). **ADR 0030** : plus aucune appréciation d'un notaire nommé côté client — seulement des faits (`cnq`, `lienCNQ`, `actes`), la frontière étant commentée à l'endroit où elle se franchirait (`handler.js:436-447`, `:1791-1796`) et tenue par quatre suites de tests. | **Aucune version, aucune date d'entrée en vigueur** dans les CGU. **Aucun enregistrement d'acceptation** : recherche de `termsAccepted`, `conditionsAcceptees`, `tosVersion`, `accepted_at` dans `apps/api/src/` et `packages/domain/index.js` → **zéro résultat**. Le barème de frais d'annulation n'est toujours pas divulgué dans les conditions. | M | Haute |

---

## CC3 — Évaluation des risques

| Contrôle | État | Ce qui existe (preuve) | Ce qui manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| CC3.1 Objectifs précisés | **A** | — | Aucun énoncé d'objectifs de sécurité. | F | Moyenne |
| CC3.2 Identification et analyse des risques | **PP** | Des risques réels sont identifiés **dans des commentaires de code et des ADR** : partage d'honoraires (`billing.js:13-17`), fraude au parrainage (`keys.js:207-221`), énumération de comptes (`admin.js:6-18`), TOCTOU sur la rétention (`repo-dynamo.js:174-179`). Le risque déontologique est désormais analysé pour de bon — sources officielles à l'appui — dans `docs/go-to-market/veille-notation-plateformes.md` §6.6 et l'ADR 0030, avec une décision explicite du propriétaire sur la hiérarchie (conformité > produit). | Aucun registre de risques consolidé, aucune cotation, aucun propriétaire, aucune revue périodique. Le risque de l'art. 32.1 (**jusqu'à 125 000 $, doublé en récidive**) n'est inscrit dans **aucun registre** : il vit dans un ADR et une veille, pas dans un instrument de suivi. | M | Haute |
| CC3.3 Risque de fraude | **PP** | Barrières anti-fraude réelles : vérification par courriel du code partenaire, barrière « demande réellement payée » avant tout gain, auto-parrainage bloqué (`handler.js:871-1015`, `:539-547`, `:751-756`). Le registre `ACT#` fige désormais `taux` et `cote` avec l'argent (`billing.js:314-317, 428-429`) : un règlement ne peut plus être réécrit par un changement de barème. | Aucun contrôle de fraude sur le **règlement** : la valeur d'acte n'est bornée que par `domain.validateActValue` (`handler.js:1094`), sans revue humaine ni seuil d'alerte. Aucune détection d'anomalie. | M | Haute |
| CC3.3 Créance non recouvrable | **A** | Le chemin de règlement hors plateforme est maintenant honnête : `completeAct` n'appelle plus Stripe, écrit `paye: false` et `commissionCentsDue` sans jamais toucher `commissionCentsCollected` (`billing.js:255-340`) ; la distinction est propagée au relevé notaire (`handler.js:1507-1511`) et au registre admin (`admin.js:616-620`). | **Rien ne permet de recouvrer la créance.** `commissionCentsDue` n'apparaît qu'en écriture (`billing.js:319, 332`) et en lecture (`admin.js:620`) : aucune route de facturation ou d'encaissement, aucun décrément, aucun état, aucun âge, aucun item de créance horodaté. Et le registre admin **omet tout notaire non `active`** — `listNotaries` et `listActiveNotaries` exécutent la même requête sur un GSI1 qui n'indexe que les profils actifs (`repo-dynamo.js:306-309, 328-333`) : **la créance d'un notaire qui se déconnecte devient invisible**. Un compte de produits à recevoir qui ne fait que croître, sans contrepartie ni procédure. | M | **Critique** |
| CC3.4 Changements significatifs | **A** | — | Aucun processus d'évaluation d'impact avant un changement. Voir CC8. | M | Haute |

---

## CC4 — Activités de surveillance

| Contrôle | État | Ce qui existe (preuve) | Ce qui manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| CC4.1 Évaluations continues et ponctuelles | **PP** | 11 alarmes CloudWatch : erreurs et throttles Lambda (`infra/observability.tf:90-134`), p99 de durée (`:139-159`), throttles DynamoDB (`:167-205`), 5xx API Gateway (`:234-252`), garde-fou de coût à 25 $ (`:266-286`). | **Elles ne préviennent personne.** Les abonnements sont conditionnés à `var.alert_email` (`observability.tf:61-66`), qui vaut `""` par défaut (`infra/variables.tf:71-75`) et n'est pas dans `terraform.tfvars` — **zéro `aws_sns_topic_subscription` dans l'état**. Aucune alarme sur les 4xx, les échecs de connexion admin, les changements IAM, l'usage du compte racine. | F | **Critique** |
| CC4.2 Communication des déficiences | **A** | — | Aucun processus. | F | Haute |

---

## CC5 — Activités de contrôle

| Contrôle | État | Ce qui existe (preuve) | Ce qui manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| CC5.1 Contrôles atténuant les risques | **PP** | Beaucoup de bons contrôles applicatifs : rétention conditionnelle anti-course qui pose `retainedAt` dans la même écriture (`repo-dynamo.js:180-197`, `handler.js:501-503`), registre d'acte *write-once* portant taux et cote (`repo-dynamo.js:735-749`), clés d'idempotence Stripe systématiques (`stripe-port.js:123, 140, 153, 170, 186`), trace de règlement écrite depuis le registre et une seule fois (`handler.js:1122-1124`). | Ces contrôles ne sont **ni inventoriés, ni testés au titre d'un programme**. Un auditeur ne peut pas les découvrir seul. Et le cas de CC7.2 montre le risque du `catch` silencieux : **un contrôle best-effort sans test de présence peut ne jamais s'exécuter sans que personne le sache**. | M | Haute |
| CC5.2 Contrôles technologiques | **PP** | Voir CC6. | Voir CC6. | — | — |
| CC5.3 Politiques et procédures | **A** | — | **Aucune politique écrite n'existait avant ce travail.** Voir `docs/legal/`. | É | **Critique** |

---

## CC6 — Accès logique et physique

### CC6.1 — Accès restreint

| Sous-contrôle | État | Ce qui existe (preuve) | Ce qui manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| Authentification admin | **P** | **Solide.** Sans mot de passe, lien magique à usage unique ; le jeton n'est que la moitié du secret : une session serveur vivante et non révoquée est exigée à chaque requête (`admin.js:233-268`). HMAC-SHA256 comparé en temps constant (`admin-auth.js:88-91`). Secret distinct de celui des notaires, **échec fermé en production** (`admin-auth.js:46-55`). Liste blanche de courriels comme seule porte (`admin.js:63-67`). Pas d'énumération de comptes (`admin.js:124-134`). | La MFA « réelle » est déléguée à la boîte courriel de l'opérateur ; aucun second facteur propre. Le premier courriel de la liste blanche est **auto-promu `super_admin`** (`admin.js:138`, `admin.js:203`) — aucune approbation. | M | Haute |
| Sessions admin | **P** | Inactivité 30 min, plafond absolu 12 h (`admin.js:73-75`), révocation immédiate côté serveur (`repo-dynamo.js:1041-1054`), rôle relu à chaque requête et compte désactivé rejeté en cours de session (`admin.js:249-251`). | — | — | — |
| Authentification notaire | **P** | Lien magique également, jeton signé à portées (`notary-auth.js:44`), défi consommé atomiquement (`repo-dynamo.js:628`). Échec fermé en production (`notary-auth.js:56-65`). | Le jeton notaire est **sans état** : contrairement à l'admin, il n'y a **aucune session révocable**. Un jeton volé vit jusqu'à son expiration ; aucun moyen de le tuer. | M | Haute |
| Jeton client | **PP** | Portée `CLIENT`, `sub` = id de l'offre, émis une seule fois (`handler.js:803-805`). | Non révocable, non journalisé. | M | Moyenne |
| Anti-abus | **PP** | Limite par IP sur la connexion notaire (`handler.js:1174-1180`) et la réclamation partenaire (`handler.js:854-859`), IP de confiance non usurpable (`admin-handler.js:61-73`). Throttle API Gateway 500 rps / 1000 burst (`infra/apigateway.tf:49-52`), admin 10/20 (`infra/admin.tf:289-292`). | **Aucune limite sur `POST /bids`, `POST /contact`, ni aucune route `/client/*`** — le throttle API Gateway est global, pas par IP. | M | Haute |
| Moindre privilège IAM | **P** | Excellent. Lambda publique : `GetItem, PutItem, Query, UpdateItem` sur la table seule, **sans `Scan` ni `DeleteItem`** (`infra/lambda.tf:43-61`). Lambda admin : lecture seule sur les données client (`infra/admin.tf:125-137`) et écriture confinée par `dynamodb:LeadingKeys ∈ [CONFIG#EMAIL, CONFIG#COMMISSION, CONFIG#ANNULATION]` (`infra/admin.tf:151-167`). Rôles de déploiement sans joker (`infra/cicd.tf:92-138`). | Deux `Resource: ["*"]`, tous deux SES (`infra/notifications.tf:62`, `infra/admin.tf:176`) ; la condition `ses:FromAddress` qui les borne est **dynamique** et disparaît si `from_email` est vide (`notifications.tf:65`). | F | Moyenne |
| Isolement de la surface admin | **P** | Table séparée `nota-admin` (`keys.js:300-310`), Lambda séparée, distribution séparée, WAF en **refus par défaut** avec liste blanche d'IP (`infra/admin-cdn.tf:249-321`). | **DÉRIVE** : la liste blanche IPv6 (`admin-cdn.tf:295-314`) n'est pas dans l'état déployé. | F | Moyenne |
| Revue d'accès | **A** | — | Aucune revue périodique des accès admin, des IP autorisées, ni des rôles AWS. Aucune procédure de départ. | F | **Haute** |

### CC6.2-6.3 — Cycle de vie des identifiants

| Contrôle | État | Preuve | Manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| Octroi / retrait | **PP** | Liste blanche par variable d'environnement (`admin.js:63-67`) ; `disabled` respecté (`admin.js:251`). | Retirer un admin = redéployer l'infrastructure. Aucune route de gestion des utilisateurs (`admin-handler.js` n'expose aucun `/admin/users`). | M | Haute |

### CC6.6-6.7 — Frontières et transmission

| Contrôle | État | Preuve | Manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| Chiffrement en transit | **PP** | `redirect-to-https` partout (`infra/cloudfront.tf:168,190`), HSTS 2 ans avec preload (`cloudfront.tf:50-55`), origine en `https-only` TLS 1.2 (`cloudfront.tf:157-162`). | **TLS minimum = `TLSv1`** en configuration déployée : `cloudfront.tf:222` bascule sur `TLSv1.2_2021` seulement si un domaine personnalisé est configuré, et `var.domain_name` vaut `""` (`variables.tf:20-24`). Aucun certificat ACM n'existe. **Aucune politique de bucket refusant `aws:SecureTransport = false`** (`infra/s3.tf:81-100`). | M | **Haute** |
| WAF sur la surface publique | **A** | WAF présent uniquement sur l'admin. | `infra/cloudfront.tf:134-230` n'a **aucun `web_acl_id`**. L'API publique face à Internet n'a aucun jeu de règles managées, aucune règle de débit. | M | Haute |
| S3 privé | **P** | OAC, blocage public complet des quatre drapeaux (`infra/s3.tf:60-67`), politique épinglée sur `AWS:SourceArn` de la distribution (`infra/s3.tf:81-100`). | — | — | — |
| Surface morte | **PP** | — | `aws_lambda_function_url.api` (`infra/lambda.tf:155-158`) est toujours déployée et **publiée en sortie Terraform** (`infra/outputs.tf:20-23`) alors que le trafic passe désormais par API Gateway. | F | Moyenne |

### CC6.8 — Logiciel non autorisé

| Contrôle | État | Preuve | Manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| Intégrité de la chaîne d'approvisionnement | **A** | — | **Aucune analyse de dépendances** (`npm audit` n'apparaît nulle part), **aucun Dependabot**, **aucun SAST**, **aucune analyse IaC**, **aucun scan de secrets**. Les actions GitHub sont épinglées par **tag mutable** (`actions/checkout@v4`) dans des workflows qui détiennent `id-token: write`. Le paquet Lambda est un `zip -qr` de tout `apps/api` — **les dépendances de développement partent en production** (`infra/lambda.tf:9-13`). | M | **Haute** |

---

## CC7 — Opérations du système

| Contrôle | État | Ce qui existe (preuve) | Ce qui manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| CC7.1 Détection des vulnérabilités | **A** | — | Aucun scan, aucun test d'intrusion, aucun programme de divulgation. Voir CC6.8. | M | Haute |
| CC7.2 Surveillance des anomalies | **A** | Alarmes présentes mais **sans abonné** (CC4.1). | **Aucun CloudTrail.** Aucune journalisation d'accès CloudFront, API Gateway, S3, ni WAF. Rétention des journaux Lambda : 14 jours déclarés (`infra/logs.tf:31-48`) — et **DÉRIVE : aucun `aws_cloudwatch_log_group` n'existe dans l'état**, donc les groupes auto-créés sont probablement en « N'expire jamais », hors gestion. | M | **Critique** |
| CC7.2 Journal applicatif — **admin** | **P** | Append-only, conditionné, sans TTL (`repo-dynamo.js:1069-1083`), écrit sur 12 actions (`admin.js:120, 132, 179, 229, 287, 301, 409, 430, 483, 501, 552, 570`) — modifications du barème incluses, avec avant/après. **Il a désormais un lecteur** : `GET /admin/audit?jour=…`, gardé par `pii:read`, 422 sur un jour non ISO, plus récent d'abord (`admin-handler.js:219-226`, `admin.js:662-676`), documenté dans `admin-openapi.yaml:710`. | La permission `audit:read` du catalogue (`rbac.js:37`) reste inutilisée : la route est gardée par `pii:read`, car `rbac.js` n'est câblé nulle part (CC1.3). | F | Moyenne |
| CC7.2 Journal applicatif — **transactions** | **P** | `appendAudit` best-effort dans le handler public (`handler.js:300-305`), trois actions — `acte_retenu` (`:527-536`), `acte_regle` (`:1152-1164`, **lue depuis le registre `ACT#` et seulement au premier règlement**, `:1148-1150`), `annulation_frais` (`:2025-2034`) — bucketées sur le **jour ouvrable québécois**. **Elle atteint désormais la production** : `appendTxAudit` écrit dans la table **principale**, où la Lambda publique a déjà `PutItem` (`repo-dynamo.js:1072-1110`, `handler.js:301-304`) ; `GET /admin/audit` **fusionne les deux journaux** (`admin.js:677-678`) et la console admin lit déjà cette table en lecture seule (`infra/admin.tf:126-131`). Garde-fou : `apps/api/test/audit-dynamo.test.mjs` câble l'adaptateur DynamoDB **exactement comme la Lambda publique — sans table admin** — et échoue si une trace repart vers la mauvaise table (5 tests au vert). | Publication et autorisation de carte ne sont toujours pas journalisées. Et le schéma qui a produit le défaut d'origine — un `catch` silencieux couvrant un contrôle qu'aucun test n'exerçait dans son câblage de production — **reste présent ailleurs** : rollups `STATS#` (`billing.js:174-188`), registre `EVAL#` (`handler.js:1876`), gains de parrainage (`handler.js:558-598`). | F | Moyenne |
| CC7.3 Évaluation des incidents | **A** | — | Aucun plan. Voir `docs/legal/plan-de-reponse-aux-incidents.md` (brouillon). | F | **Critique** |
| CC7.4 Réponse aux incidents | **A** | — | Aucune astreinte, aucune escalade, aucun exercice. | M | **Critique** |
| CC7.5 Rétablissement | **PP** | PITR 35 jours sur les deux tables (`infra/dynamodb.tf:61-63`, `infra/admin.tf:75-77`), protection contre la suppression (`dynamodb.tf:15`, `admin.tf:59`), versionnement S3 (`s3.tf:19-25`). | **Aucun AWS Backup** — zéro ressource `aws_backup*`. Pas de copie inter-région ni inter-compte, pas de coffre verrouillé. **Aucune restauration n'a jamais été testée**, aucun RTO/RPO documenté. | M | Haute |

---

## CC8 — Gestion du changement

| Contrôle | État | Ce qui existe (preuve) | Ce qui manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| CC8.1 Changements autorisés et testés | **PP** | CI réelle et sérieuse : `.github/workflows/ci.yml:22-47` exécute domaine, API, BDD Cucumber, DOM web et admin ; `ci.yml:49-65` fait `terraform fmt -check`, `init -backend=false`, `validate`. Le déploiement est barré par `needs: [test, e2e]` (`deploy.yml:103`) — la suite Playwright doit passer. L'admin exige un **environnement GitHub protégé, appliqué au niveau de la politique de confiance AWS** (`deploy-admin.yml:87` + `infra/admin.tf:335-339`) : c'est du très bon travail. | **Le déploiement en production n'a aucune approbation humaine** : le job `deploy` de `deploy.yml` n'a **pas de clé `environment:`**. Un `push` sur `main` part en production. La protection de branche est un réglage GitHub, **non vérifiable depuis le dépôt**, et aucun `CODEOWNERS` n'existe. `deploy.yml` ne déploie **que `nota-api`** — la Lambda `reminders` n'est mise à jour par aucun workflow et dérive en silence. CI teste sur Node 22 (`ci.yml:28-31`) alors que la production tourne en `nodejs20.x` (`infra/lambda.tf:96`). | M | **Haute** |
| CC8.1 Changement d'infrastructure | **A** | — | **Aucun bloc `backend`** : l'état Terraform est un fichier local de 183 Ko, **non chiffré, non versionné, sans verrou**, contenant en clair les deux secrets HMAC générés (`infra/lambda.tf:83-86`, `infra/admin.tf:40-44`). `terraform apply` se lance depuis un portable, sans trace, sans séparation des tâches. **DÉRIVE confirmée** : l'état déployé est en retard sur `main`. | M | **Critique** |
| CC8.1 Séparation des environnements | **A** | — | **Aucun workspace, aucun `dev`/`staging`, un seul compte AWS.** `NODE_ENV = "production"` est codé en dur (`infra/lambda.tf:122`). Aucun environnement où éprouver un changement d'infrastructure. | É | Haute |

---

## CC9 — Atténuation des risques et fournisseurs

| Contrôle | État | Ce qui existe (preuve) | Ce qui manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| CC9.1 Atténuation des risques d'affaires | **PP** | Garde-fou de coût à 25 $ (`infra/observability.tf:266-286`). Concurrence réservée sur `api` (100) et `admin` (10). | Aucune assurance cyber documentée. `reminders` n'a **aucune concurrence réservée** (`infra/notifications.tf:132-156`). | F | Moyenne |
| CC9.2 Gestion des fournisseurs | **A** | Trois sous-traitants réels : **AWS** (`infra/providers.tf:35-36`, ca-central-1), **Stripe** (`apps/api/src/stripe-port.js`), **SES** (`infra/notifications.tf:57-73`). | **Aucun inventaire de fournisseurs, aucune revue de leurs rapports SOC 2, aucun accord de traitement des données signé, aucune évaluation d'impact.** Voir `docs/legal/accord-de-traitement-des-donnees.md` (brouillon). | M | **Haute** |
| CC9.3 Risque réglementaire — droit professionnel | **PP** | **Le risque est identifié, documenté et hiérarchisé** : ADR 0030 acte que « la conformité déontologique passe avant la valeur produit ». Mesure appliquée et testée : aucune appréciation d'un notaire nommé ne descend vers un client (`handler.js:1763-1771`, `:1797-1801` ; garde-fous `apps/api/test/deontologie-avis.test.mjs`, `apps/web/test/client-cote.test.mjs`). Divulgation du partage complète des deux côtés (art. 34). Le client paie la plateforme, jamais le notaire qui rétrocède (`stripe-port.js:85-146`, en-tête du port corrigé le 01/09). Et la cote **ne pénalise aucun comportement que la déontologie impose** : un refus compte comme une réponse et un notaire spécialisé n'est pas puni (`packages/domain/index.js:1306-1323`, deux tests dans `packages/domain/test/cote.test.mjs`). Un notaire ne peut plus réclamer un code de parrainage — 422 `notaire_non_admissible` (`handler.js:928-944`, 3 tests). | **Le modèle économique lui-même reste non qualifié.** L'**art. 32.1 de la *Loi sur le notariat*** présume usurper les fonctions de notaire l'intermédiaire qui « obtient d'un notaire qu'il abandonne une partie de ses honoraires » — **2 500 à 125 000 $, doublé en récidive** — et la Chambre a annoncé le 25/01/2024 qu'elle prendrait « les recours qui s'imposent ». Les art. 32/33 ferment la liste des partages licites. L'art. 72 contraint une interface qui est par construction un marché de prix. Et le badge « CNQ » n'est **vérifié que par un format d'URL** (`packages/domain/index.js:1399-1402`) alors que l'ADR 0030 en a fait l'un des deux seuls signaux offerts au client — publicité trompeuse au sens de l'art. 68. Le garde-fou du parrainage est réel mais **atténue sans fermer** : il ne tient qu'au courriel (une adresse personnelle passe) et porte sur la réclamation, jamais sur le versement — `recordReferralEarnings` ne recoupe aucun statut (`handler.js:560-598`), et `/partenaires/verify`, qui écrit le payeur de record, ne revérifie pas. **Avis juridique écrit REQUIS, mandat élargi à quatre volets.** Voir [`../legal/conformite-deontologique-notaires.md`](../legal/conformite-deontologique-notaires.md). | É | **Critique** |

Un audit SOC 2 ne juge pas la licéité d'un modèle d'affaires. Mais un risque
réglementaire connu, chiffré et non traité est un **risque d'entreprise** que la
direction doit avoir identifié et suivi (CC3.2) — et une amende doublée en
récidive assortie d'une mise en garde publique du régulateur est exactement le
genre d'élément qu'un auditeur attend de voir au registre des risques.

---

## A1 — Disponibilité

| Contrôle | État | Ce qui existe (preuve) | Ce qui manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| A1.1 Capacité | **PP** | DynamoDB en `PAY_PER_REQUEST` (`infra/dynamodb.tf:11`) — pas de plafond de capacité. Concurrence réservée (`infra/lambda.tf:107`). Alarmes de throttle (`observability.tf:114-205`). | **DÉRIVE** : la concurrence déployée sur `api` est 20, pas 100. Aucun test de charge, aucun objectif de niveau de service documenté. | M | Moyenne |
| A1.2 Sauvegarde et reprise | **PP** | PITR 35 jours (voir CC7.5). | Aucun AWS Backup, aucune copie hors région, aucune restauration testée. **Une seule région**, aucun basculement, aucune table globale. | M | Haute |
| A1.2 Files d'attente d'échec | **A** | — | **Aucune DLQ sur aucune Lambda** — `dead_letter_config = []` partout. Une invocation asynchrone échouée du travail de rappels quotidiens est **perdue en silence** ; le seul signal est une alarme sans abonné. | F | Haute |
| A1.3 Test du plan de reprise | **A** | — | Jamais fait, jamais planifié. | M | Haute |

---

## C1 — Confidentialité

| Contrôle | État | Ce qui existe (preuve) | Ce qui manque | Effort | Priorité |
| --- | :-: | --- | --- | :-: | :-: |
| C1.1 Identification et protection | **P** | **Le meilleur travail du produit.** Les fichiers du dossier **ne quittent jamais l'appareil** : seul le nom assaini est stocké (`packages/domain/index.js:1821-1830`). Le dossier n'est libéré qu'au notaire qui retient (`handler.js:1466`). `publicBid()` ne porte ni courriel, ni téléphone, ni code partenaire, ni dossier (`handler.js:748-773`). Anonymat par défaut (`handler.js:730`). Le secteur postal public est limité aux 3 premiers caractères (`index.html:1086-1087`). Les évaluations sont anonymisées à la source (`handler.js:1474-1476`). | Le jeton de désabonnement est **le courriel en base64url, sans signature** (`notifications.js:22-27`) : l'adresse voyage en clair dans l'URL et n'importe qui peut désabonner n'importe qui. | F | Moyenne |
| C1.1 Chiffrement au repos | **PP** | S3 chiffré en AES256 (`infra/s3.tf:49-57`, `infra/admin-cdn.tf:97-106`). DynamoDB chiffré par la clé détenue par AWS. | **Aucune ressource KMS dans toute la pile.** Pas de CMK sur DynamoDB — `infra/dynamodb.tf:17-19` porte un commentaire « FUTURE IMPROVEMENT » qui reconnaît le trou, et `infra/admin.tf:53-85` ne l'a même pas. **`kms_key_arn` absent des trois Lambdas** : les variables d'environnement, qui contiennent la clé secrète Stripe, sont lisibles par tout principal ayant `lambda:GetFunctionConfiguration`. Pas de KMS sur les journaux (`infra/logs.tf:31-48`) ni sur les sujets SNS. | M | **Haute** |
| C1.1 Gestion des secrets | **A** | — | **Ni Secrets Manager ni SSM.** Tout est en variable d'environnement Lambda en clair (`infra/lambda.tf:128-140`, `infra/admin.tf:234`). La rotation prescrite est un `terraform taint` manuel (`infra/lambda.tf:82`). Les deux secrets HMAC sont **générés dans l'état Terraform local en clair**. | M | **Critique** |
| C1.2 Suppression | **PP** | TTL activé sur les deux tables (`infra/dynamodb.tf:69-72`, `infra/admin.tf:81-84`). L'offre porte un `ttl` de ~400 jours (`handler.js:815`). Promesse publique de 12 mois (`index.html:1102`). | **L'infrastructure n'active que le mécanisme ; la politique est dans le code applicatif.** Les enregistrements **notaire n'ont aucun TTL** et persistent indéfiniment (`infra/dynamodb.tf:65-68` le dit explicitement) : ils portent courriel, `connectAccountId` Stripe, historique de commission. **Aucune procédure de suppression sur demande** n'est implémentée — la promesse de `index.html:1103` (« suppression … dans un délai de 30 jours ») n'a **aucun mécanisme correspondant dans le code**. Écart entre 400 jours codés et 12 mois promis. | M | **Critique** |

---

## Les travaux qui rapprochent le plus vite d'un audit Type I

Ordonnés par ratio *impact d'audit / effort*. Chacun est étiqueté **code**,
**infra** ou **politique**.

Cinq travaux des listes précédentes sont **faits** : la porte de lecture du
journal, la journalisation du parcours de l'argent — **y compris son arrivée
effective en production**, corrigée pendant la rédaction —, le `retainedAt`, le
gel du taux à l'engagement, et la réconciliation dit/fait sur l'économie. La
liste ci-dessous est à jour ; elle compte donc **neuf** travaux, pas dix.

| # | Travail | Nature | Effort | Pourquoi en premier |
| :-: | --- | :-: | :-: | --- |
| ~~1~~ | ~~**Faire atteindre la production à la trace de transaction.**~~ ✅ **FAIT** pendant la rédaction : `appendTxAudit` sur la table principale, journaux fusionnés à la lecture, test de câblage. | — | — | Reste à généraliser la leçon : tout `catch` silencieux couvrant un contrôle a besoin d'un test qui échoue quand il ne s'exécute pas. |
| 1 | **Abonner un destinataire aux alarmes** : renseigner `alert_email` dans `terraform.tfvars` et appliquer. | **infra** | **F** | Une ligne. Elle transforme 11 alarmes mortes en surveillance réelle et débloque CC4.1. |
| 2 | **Activer CloudTrail** (trail multi-région, validation des fichiers, bucket dédié avec Object Lock) et l'assortir d'AWS Config. | **infra** | M | Sans piste d'audit AWS, CC6.1 et CC7.2 restent inatteignables côté infrastructure. |
| 3 | **Donner un cycle de vie à la créance** : un item de créance horodaté par acte réglé hors plateforme, un état (due / facturée / encaissée / radiée), un décrément à l'encaissement, un âge — et rendre visibles les notaires non `active` dans le registre admin (`repo-dynamo.js:306-309, 328-333`). | **code** | M | `commissionCentsDue` ne fait aujourd'hui que croître, sans contrepartie ni recouvrement, et s'efface de l'écran quand le notaire part. Voir `piste-audit-transactions.md` §5.5. |
| 4 | **Écrire les politiques** : sécurité, réponse aux incidents, conservation, contrôle d'accès, gestion des changements, fournisseurs. Les brouillons sont dans `docs/legal/`. | **politique** | É | La moitié de CC1-CC5, CC7.3-7.4 et CC9 est de la documentation. Aucun code ne peut la remplacer. |
| 5 | **Migrer les secrets vers Secrets Manager** (ou au minimum SSM chiffré par CMK) et poser un `kms_key_arn` sur les trois Lambdas. | **infra** | M | C1.1. Aujourd'hui la clé Stripe est en clair pour quiconque peut décrire la fonction. |
| 6 | **Déplacer l'état Terraform vers un backend S3 chiffré, versionné, verrouillé par DynamoDB.** | **infra** | **F** | Fait disparaître un fichier local en clair contenant deux secrets de signature, et crée une trace de changement d'infrastructure (CC8.1). |
| 7 | **Ajouter les analyses à la CI** : `npm audit --audit-level=high`, CodeQL, `tfsec`/`checkov`, gitleaks, Dependabot ; épingler les actions par SHA. | **code** | M | CC6.8 et CC7.1 d'un seul coup, entièrement dans le dépôt. |
| 8 | **Exiger une approbation humaine en production** : clé `environment:` sur le job `deploy` de `deploy.yml`, réviseurs requis, protection de `main`, `CODEOWNERS`. Réparer aussi le déploiement de la Lambda `reminders`. | **code** | **F** | Le modèle correct existe déjà dans `deploy-admin.yml:87` — il suffit de le copier. |
| 9 | **Finir de réconcilier dit et fait** : enregistrer l'acceptation des conditions (version + horodatage — aujourd'hui **zéro** trace), implémenter la suppression sur demande promise sous 30 jours, remplacer l'adresse postale de remplacement (`emails.js:46`), aligner la rétention 12 mois annoncée sur les 400 jours codés, et divulguer le barème d'annulation **avant** l'engagement. | **code + politique** | M | CC2.3. L'écart sur le partage est réglé ; ceux-là restent, et chacun est un constat d'auditeur. |

### Ce qui n'est pas dans les dix, mais doit précéder la mise en service

- **L'avis juridique, dont le mandat s'est ÉLARGI** (budget de 20 000 $,
  `docs/business-plan.md:133-134`, `:554`). Il ne porte plus seulement sur le
  partage d'honoraires, mais sur **quatre volets** : (1) le partage et l'**art.
  32.1 de la *Loi sur le notariat*** — la disposition la plus lourde, qui vise le
  modèle économique lui-même ; (2) l'affichage des avis (art. 70) ; (3) la
  qualification de la cote comme recommandation ; (4) la présentation des prix
  (art. 71-72). Ce n'est pas un contrôle SOC 2, c'est un préalable
  réglementaire. **Il reste REQUIS avant toute mise en service.** Détail et
  sources : [`../legal/conformite-deontologique-notaires.md`](../legal/conformite-deontologique-notaires.md) §7.
- ~~Le chemin de repli du règlement qui inscrit une commission non prélevée.~~
  **Corrigé** le 1er septembre 2026 : `completeAct` n'appelle plus Stripe et
  enregistre une créance explicite (`billing.js:255-340`). Le reproche portait
  juste ; la correction est propre. Reste le n° 4 ci-dessus.

---

## Ce qui est déjà de qualité — et qu'un auditeur créditera

Il serait malhonnête de ne lister que les manques. Sont réellement bien faits :

- **L'isolement de la surface admin** : table séparée, Lambda séparée, WAF en
  refus par défaut, écriture confinée par `dynamodb:LeadingKeys`
  (`infra/admin.tf:151-167`).
- **L'authentification admin** : sans mot de passe, session serveur révocable,
  double plafond temporel, échec fermé en production (`admin.js:233-268`,
  `admin-auth.js:46-55`).
- **Le moindre privilège IAM** : aucun joker d'action, `Scan` et `DeleteItem`
  délibérément absents de la Lambda publique (`infra/lambda.tf:43-61`).
- **OIDC GitHub** avec `sub` borné au dépôt et à la branche, **aucune clé AWS
  durable** (`infra/cicd.tf:39-78`).
- **S3 entièrement privé derrière OAC** avec épinglage `AWS:SourceArn`
  (`infra/s3.tf:60-100`).
- **La minimisation des données** : les fichiers ne quittent pas l'appareil, le
  dossier n'est libéré qu'à la rétention, l'anonymat est le défaut.
- **La divulgation financière au notaire** : le registre `ACT#` fige `taux`,
  `cote` et `serviceId` avec l'argent (`billing.js:314-317, 428-429`), le notaire
  lit son relevé acte par acte (`handler.js:1477-1517`), et un acte antérieur au
  barème actuel voit son taux **déduit de ce qui a réellement été facturé, jamais
  du barème d'aujourd'hui** (`handler.js:1502`). C'est le bon réflexe.
- **La séparation encaissé / dû**, tenue partout : registre, profil, relevé
  notaire, registre admin et courriel (`billing.js:318-332`, `handler.js:1146-1151,
  1507-1511`, `admin.js:616-620`).
- **Le jour ouvrable québécois comme seau du journal**, nommé explicitement par
  l'appelant et honoré par les deux adaptateurs (`handler.js:33, 303`,
  `repo-dynamo.js:1072`, `repo-memory.js:490-495`) — un règlement du soir ne
  bascule pas sur le lendemain UTC.
- **La trace de règlement lue depuis le registre**, pas depuis la requête, et
  écrite une seule fois (`handler.js:1122-1124`).
- **Une pyramide de tests réelle** qui barre le déploiement (`deploy.yml:103`).
