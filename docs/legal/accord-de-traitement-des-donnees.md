# Accord de traitement des données et registre des sous-traitants

> **BROUILLON NON RÉVISÉ.** Rédigé à partir du code, non par un juriste. Voir
> [`README.md`](README.md).

**Version : 0.1 (brouillon) · Date d'entrée en vigueur : à déterminer**

Ce document sert deux fins :

1. **Le registre des sous-traitants** — qui traite quels renseignements pour le
   compte de Nota, où, et sur quelle base. La Loi 25 exige que la communication
   à un tiers soit encadrée par un mandat ou un contrat écrit précisant les
   mesures de protection.
2. **Les clauses type** que Nota impose lorsqu'elle-même agit comme
   sous-traitante — notamment envers un notaire, qui reste responsable des
   renseignements de son client sous son secret professionnel.

---

## Partie A — Registre des sous-traitants

Trois sous-traitants, tous vérifiables dans le code.

### A.1 Amazon Web Services (AWS)

| | |
| --- | --- |
| **Rôle** | hébergement, calcul, base de données, diffusion, courriel sortant |
| **Services utilisés** | Lambda, DynamoDB, S3, CloudFront, API Gateway, CloudWatch, SNS, EventBridge Scheduler, **SES** |
| **Région** | `ca-central-1` — Montréal, **Canada** (`infra/providers.tf:35-36`) |
| **Exception régionale** | `us-east-1`, uniquement pour ACM et le WAF de CloudFront, qui l'exigent (`infra/providers.tf:47-49`). **Aucune donnée client n'y réside** — ce sont des certificats et des règles de filtrage. |
| **Renseignements traités** | la totalité : offres, dossiers, courriels, téléphones, profils de notaires, registres financiers |
| **Base** | contrat client AWS et son addenda de traitement des données |
| **Attestation** | AWS publie des rapports SOC 1/2/3 |
| **Entente signée ?** | **⚠️ Non vérifié.** Le compte AWS existe (`436136277668`, `infra/cicd.tf:27`) mais **rien ne documente l'acceptation de l'addenda**. |

**Sous-cas : Amazon SES.** Le courriel sortant transite par SES
(`infra/notifications.tf:57-73`). Sont transmis : l'adresse du destinataire et le
contenu du message — lequel peut porter des détails de dossier, un montant, un
nom de notaire. **C'est une communication de renseignements personnels et elle
doit figurer à ce registre en tant que telle.**

> ⚠️ La permission SES accorde `ses:SendEmail` sur **`Resource: ["*"]`**
> (`infra/notifications.tf:62`, `infra/admin.tf:176`). La condition qui la borne à
> l'adresse d'expédition est **dynamique** et disparaît si `from_email` est vide
> (`notifications.tf:65`).

### A.2 Stripe

| | |
| --- | --- |
| **Rôle** | autorisation et capture des paiements, comptes de versement des notaires (Connect Express) |
| **Renseignements transmis par Nota** | le courriel du client (`apps/api/src/handler.js:813`), le montant, une description du service, l'identifiant de l'offre en métadonnée |
| **Renseignements collectés directement par Stripe** | numéro de carte du client ; identité, pièce justificative et coordonnées bancaires du notaire — **Nota ne les voit jamais** (`apps/api/src/stripe-port.js:14`, `apps/web/public/index.html:732`) |
| **Localisation** | Stripe traite hors du Québec |
| **Base** | Stripe Services Agreement et son addenda de traitement |
| **Attestation** | Stripe est certifié PCI DSS niveau 1 et publie un rapport SOC 2 |
| **Entente signée ?** | **⚠️ Non vérifié.** |

**Conséquence Loi 25 :** cette communication hors Québec exige une **évaluation
des facteurs relatifs à la vie privée** avant la mise en service. Elle n'a pas été
faite.

**Détail qui compte pour la vérifiabilité :** dans le chemin de règlement
principal, le prix de Nota — jamais une part des honoraires du notaire — n'est
**pas** transmis à Stripe comme frais d'application ; il n'existe que comme
différence entre une capture (le total des deux lignes) et un virement (les
honoraires, en entier). Les rapports Stripe ne le montrent donc pas comme une
ligne distincte. Voir `../compliance/piste-audit-transactions.md`, §4.

### A.3 GitHub

| | |
| --- | --- |
| **Rôle** | dépôt de code et chaîne de déploiement |
| **Renseignements personnels ?** | **Aucun renseignement de client ou de notaire.** Le dépôt ne contient ni données de production ni secrets : `terraform.tfstate` et `terraform.tfvars` sont ignorés par git et absents de l'index. |
| **Accès à la production** | oui — par OIDC, avec des identifiants de courte durée, `sub` restreint au dépôt et à la branche `main` (`infra/cicd.tf:39-78`) ; l'admin exige en plus un environnement protégé (`infra/admin.tf:335-339`) |

### A.4 Aucun autre

Vérifié : **aucun outil d'analyse, aucun pixel, aucun réseau publicitaire, aucun
service de support tiers.** Voir [`politique-temoins.md`](politique-temoins.md).
La messagerie d'assistance est interne (`apps/api/src/keys.js:175-183`).

---

## Partie B — Ce qui manque, et qui est exigible

1. **Aucune entente de traitement n'est documentée** avec AWS ni avec Stripe.
   Accepter les conditions en ligne peut suffire juridiquement, mais **il faut en
   conserver la preuve datée**.
2. **Aucune EFVP de communication hors Québec** n'a été réalisée pour Stripe.
3. **Aucun rapport SOC 2 de sous-traitant n'a été obtenu ni revu.** Un auditeur
   demandera les rapports d'AWS et de Stripe, ainsi que la revue des *complementary
   user entity controls* — les contrôles que le fournisseur laisse explicitement à
   la charge du client. Plusieurs des manques relevés dans
   `../compliance/soc2-gap-analysis.md` (CloudTrail, KMS, journalisation d'accès)
   sont précisément de ceux-là.
4. **Aucune revue annuelle** des sous-traitants n'est planifiée.
5. **Aucune procédure de sortie** : que devient la donnée si Nota quitte Stripe ou
   AWS ?
6. **Le registre lui-même n'est publié nulle part.** La politique de
   confidentialité affichée mentionne AWS (`index.html:1090-1091`) mais **jamais
   Stripe**, alors que le client y est redirigé et que son courriel y est
   transmis. C'est une omission à corriger.

---

## Partie C — Clauses type, lorsque Nota est sous-traitante

Ces clauses s'appliquent lorsqu'un notaire confie à Nota le traitement de
renseignements dont il demeure responsable.

1. **Instructions.** Nota ne traite les renseignements que pour exécuter le
   service décrit dans les [conditions notaire](conditions-notaire.md), selon les
   instructions écrites du notaire.
2. **Confidentialité.** Toute personne ayant accès aux renseignements est tenue à
   la confidentialité.
3. **Sécurité.** Nota met en œuvre les mesures décrites dans la
   [politique de sécurité](politique-de-securite.md). **Les limites actuelles y
   sont énoncées sans être minimisées** ; le notaire en prend connaissance.
4. **Sous-traitance ultérieure.** Nota recourt aux sous-traitants listés en
   partie A. Tout ajout est communiqué au préalable ; le notaire peut s'y opposer
   et résilier.
5. **Assistance.** Nota assiste le notaire pour répondre aux demandes d'accès, de
   rectification, de suppression et de portabilité, dans la mesure de ses moyens
   techniques. **Ces moyens sont aujourd'hui manuels** — voir
   [`politique-confidentialite.md`](politique-confidentialite.md), §6.
6. **Incidents.** Nota avise le notaire **sans délai** de tout incident de
   confidentialité touchant ses renseignements, et lui fournit ce qui lui est
   nécessaire pour remplir ses propres obligations. Voir le
   [plan de réponse aux incidents](plan-de-reponse-aux-incidents.md).
7. **Localisation.** Les renseignements sont hébergés au Canada
   (`ca-central-1`). Les paiements transitent par Stripe, hors du Québec.
8. **Fin du service.** À la fin de la relation, Nota supprime ou anonymise les
   renseignements selon la
   [politique de conservation](politique-conservation-des-donnees.md), sous
   réserve des registres financiers dont la loi impose la conservation.
9. **Audit.** Le notaire peut demander la documentation démontrant le respect de
   ces clauses. **Nota ne dispose aujourd'hui d'aucune attestation
   indépendante** ; l'analyse d'écart SOC 2 en tient lieu, telle quelle.
10. **Secret professionnel.** Rien dans le service ne dispense le notaire de ses
    obligations de secret professionnel. Nota n'accède aux renseignements du
    client que dans la mesure strictement nécessaire à l'exploitation du service,
    et n'en fait aucun autre usage.
