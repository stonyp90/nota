# Plan de réponse aux incidents

> **BROUILLON NON RÉVISÉ.** Rédigé à partir du code, non par un juriste. Voir
> [`README.md`](README.md).

**Version : 0.1 (brouillon) · Date d'entrée en vigueur : à déterminer**

---

## 0. Ce qu'il faut savoir avant de lire la suite

Ce plan décrit une procédure que **le système ne permet pas encore d'exécuter**.
Trois obstacles matériels :

1. **Aucune alerte ne parvient à personne.** Les 11 alarmes CloudWatch existent
   (`infra/observability.tf:90-286`) mais aucun abonnement SNS n'est déployé :
   `alert_email` n'est pas renseigné (`infra/variables.tf:71-75`). **La détection
   dépend aujourd'hui entièrement du hasard ou d'un signalement client.**
2. **Aucun CloudTrail.** Il n'existe aucune piste d'audit des appels AWS, ni
   journal d'accès CloudFront, API Gateway, S3 ou WAF. **Une investigation
   « qui a fait quoi » est impossible.**
3. **Les journaux applicatifs sont à 14 jours déclarés** (`infra/logs.tf:31-34`)
   — et aucun groupe de journaux n'existe dans l'état Terraform, donc la
   rétention réelle est inconnue.

**Corriger ces trois points est le préalable à ce plan.** Le point 1 est l'affaire
d'une ligne de configuration.

---

## 1. Rôles

Nota n'a qu'un opérateur. Ces rôles sont donc cumulés par la même personne,
jusqu'à croissance de l'équipe. **Cela doit être écrit, pas dissimulé.**

| Rôle | Responsabilité |
| --- | --- |
| **Responsable d'incident** | dirige, décide, tient le fil des faits |
| **Responsable de la protection des RP** | qualifie l'incident de confidentialité, décide des notifications, tient le registre |
| **Responsable technique** | confine, corrige, restaure |
| **Communications** | clients, notaires, Commission d'accès à l'information |

**Contact unique actuel :** `bonjour@nota.ca` ·
Confidentialité : `confidentialite@nota.ca`

---

## 2. Gravité

| Niveau | Définition | Exemples concrets pour Nota | Prise en charge |
| --- | --- | --- | --- |
| **S1 — critique** | fuite de renseignements confidentiels, compromission d'un secret, argent déplacé à tort | secret de signature exposé, clé Stripe divulguée, dossier libéré au mauvais notaire, client débité sans acte | **immédiate** |
| **S2 — majeure** | service indisponible ou fonction d'argent défaillante | règlements en échec, webhooks Stripe non traités, carnet inaccessible | **4 h** |
| **S3 — mineure** | dégradation sans perte de données ni d'argent | courriels non partis, lenteur | **1 jour ouvrable** |
| **S4 — observation** | anomalie sans impact | dérive de compteurs analytiques | **prochaine revue** |

---

## 3. Procédure

### Étape 1 — Détecter et consigner

Ouvrir un fil daté. À partir de cet instant, **tout est horodaté** : ce qui est
constaté, ce qui est décidé, ce qui est fait, par qui.

Sources de détection actuellement disponibles :

- signalement d'un client ou d'un notaire par `bonjour@nota.ca` ;
- tableau de bord Stripe (litiges, échecs de capture ou de virement) ;
- console CloudWatch, consultée à la main ;
- alarmes CloudWatch — **dès qu'un destinataire y sera abonné**.

### Étape 2 — Qualifier

Répondre à quatre questions, par écrit :

1. Des **renseignements personnels** sont-ils en cause ? Lesquels, de qui,
   combien de personnes ?
2. De l'**argent** est-il en cause ? Voir
   `../compliance/piste-audit-transactions.md` pour savoir quels enregistrements
   consulter.
3. Un **secret** est-il compromis ? (`STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `NOTA_NOTARY_SECRET`, `NOTA_ADMIN_SECRET`)
4. L'incident est-il **en cours** ou terminé ?

### Étape 3 — Confiner

Actions réellement possibles aujourd'hui, avec leur moyen :

| Situation | Action | Moyen réel |
| --- | --- | --- |
| Session admin compromise | révoquer la session | `repo.revokeAdminSession` (`apps/api/src/repo-dynamo.js:1041-1054`) — **aucune interface ; écriture directe en base** |
| Compte admin compromis | désactiver l'identité | poser `disabled: true` sur l'élément `ADMIN#…` — refusé dès la requête suivante (`apps/api/src/admin.js:251`) |
| Console admin attaquée | restreindre les IP | vider `admin_allowed_cidrs` : le WAF **refuse par défaut** (`infra/admin-cdn.tf:261-272`) |
| Secret de signature compromis | renouveler | `terraform taint` puis `apply` (`infra/lambda.tf:82`) — **invalide toutes les sessions notaires et admin** |
| Clé Stripe compromise | révoquer chez Stripe, puis mettre à jour la variable et redéployer | tableau de bord Stripe |
| **Jeton notaire compromis** | — | ⚠️ **impossible** : le jeton est sans état et non révocable (`apps/api/src/notary-auth.js:104-132`). Seul le renouvellement du secret global le tue, en déconnectant tout le monde. |
| Données corrompues | restaurer | PITR, fenêtre de 35 jours (`infra/dynamodb.tf:61-63`) — **jamais testé** |

### Étape 4 — Éradiquer et rétablir

Corriger la cause. Vérifier que la correction tient. Rétablir le service.
Confirmer, chiffres à l'appui, qu'aucun autre enregistrement n'est touché.

### Étape 5 — Notifier

Voir §4.

### Étape 6 — Retour d'expérience

Dans les **10 jours ouvrables** suivant la clôture, produire un compte rendu sans
recherche de faute : chronologie, cause profonde, pourquoi la détection a pris ce
temps, mesures correctives datées et assignées.

---

## 4. Incident de confidentialité — obligations de la Loi 25

Un **incident de confidentialité** est un accès, une utilisation ou une
communication non autorisés d'un renseignement personnel, sa perte, ou toute
autre atteinte à sa protection.

### Notification

Lorsque l'incident présente un **risque de préjudice sérieux**, Nota doit, **avec
diligence** :

- aviser la **Commission d'accès à l'information du Québec** ;
- aviser **chaque personne concernée**.

Nota peut aviser toute personne susceptible de diminuer le risque.

### Évaluer le risque de préjudice sérieux

Facteurs à documenter :

| Facteur | Ce qu'il faut consigner |
| --- | --- |
| **Sensibilité** | quels champs ? Un courriel et un montant n'ont pas le poids d'un dossier complet avec téléphone et documents |
| **Conséquences appréhendées** | vol d'identité, fraude, atteinte à la réputation, préjudice financier |
| **Probabilité d'usage malveillant** | erreur interne corrigée en minutes, ou exfiltration ? |
| **Nombre de personnes** | combien d'éléments, combien d'individus distincts |
| **Mesures d'atténuation** | rapidité du confinement, chiffrement, récupération |

### Le contenu de l'avis

**À la Commission :** nature de l'incident, date ou période, description des
renseignements, nombre de personnes, circonstances, mesures prises, coordonnées
du responsable.

**Aux personnes concernées :** description de l'incident, renseignements en
cause, mesures prises par Nota, mesures que la personne peut prendre, coordonnées
pour obtenir de l'information.

### Le registre — obligatoire, même vide

Nota tient un **registre des incidents de confidentialité**. Il consigne **tous**
les incidents, y compris ceux qui ne présentent pas de risque de préjudice
sérieux et n'ont donc entraîné aucune notification.

**Conservation : 5 ans** après la date de l'incident.

> ⚠️ **Ce registre n'existe pas.** Il est légalement obligatoire dès le premier
> traitement de renseignements personnels. Le modèle ci-dessous doit être
> instancié dès aujourd'hui.

#### Modèle de registre

| Champ | Contenu |
| --- | --- |
| Numéro | séquentiel |
| Date de l'incident | ou période |
| Date de découverte | |
| Description | ce qui s'est passé |
| Renseignements en cause | catégories et champs précis |
| Nombre de personnes concernées | ou estimation motivée |
| Cause | |
| Risque de préjudice sérieux | oui / non, **avec la motivation écrite** |
| Commission avisée | date, ou motif de non-notification |
| Personnes avisées | date et moyen, ou motif |
| Mesures prises | confinement, correction |
| Mesures pour éviter la récurrence | avec responsable et échéance |
| Date de clôture | |

---

## 5. Communications

- **Aux clients et notaires touchés** : dans les meilleurs délais, en français,
  en clair, sans minimiser. Ce qui s'est passé, ce qui les concerne, ce que Nota
  a fait, ce qu'ils peuvent faire.
- **Aux autres** : une page d'état si le service est dégradé.
- **Rien n'est communiqué avant que les faits soient établis** — mais l'attente
  de la certitude ne justifie pas le silence sur ce qui est déjà connu.

---

## 6. Contacts externes

| Organisme | Quand |
| --- | --- |
| Commission d'accès à l'information du Québec — `cai.gouv.qc.ca` | incident avec risque de préjudice sérieux |
| Stripe — assistance du tableau de bord | incident de paiement, litige, compromission de clé |
| AWS Support | incident d'infrastructure |
| Chambre des notaires du Québec | incident touchant un notaire dans l'exercice de sa profession |
| Corps policier | acte criminel soupçonné |

---

## 7. Exercice

**Un exercice sur table par an, au minimum.** Scénarios de départ :

1. Le secret de signature notaire est publié par erreur.
2. Un client déclare avoir été débité sans que l'acte ait eu lieu.
3. Un dossier a été libéré au mauvais notaire.
4. La table principale est corrompue par un déploiement fautif.

**Aucun exercice n'a jamais eu lieu.** Le premier devrait tester le scénario 2 :
c'est celui pour lequel la piste d'audit actuelle est le plus manifestement
insuffisante.
