# Politique de confidentialité — Loi 25

> **BROUILLON NON RÉVISÉ.** Rédigé à partir du code, non par un juriste. Voir
> [`README.md`](README.md).

**Version : 0.1 (brouillon) · Date d'entrée en vigueur : à déterminer**

Cette politique décrit comment Nota traite les renseignements personnels, au sens
de la *Loi sur la protection des renseignements personnels dans le secteur privé*
telle que modifiée par la **Loi 25**.

---

## 1. Responsable de la protection des renseignements personnels

La Loi 25 impose de **désigner** une personne responsable et de **publier son
titre et ses coordonnées**.

**Titre :** responsable de la protection des renseignements personnels
**Coordonnées :** `confidentialite@nota.ca`

> ⚠️ **À compléter.** L'application annonce déjà qu'« une personne responsable de
> la protection des renseignements personnels supervise ces pratiques »
> (`apps/web/public/index.html:1109`) **sans la nommer**. La loi exige un titre et
> des coordonnées publiés. Il faut désigner formellement cette personne — par
> défaut, la personne ayant la plus haute autorité dans l'entreprise — et
> consigner la désignation.

---

## 2. Ce que Nota recueille

### Du client

| Renseignement | Public ? | Où c'est écrit dans le code |
| --- | --- | --- |
| Date de signature, service, montant offert | **Public** | `apps/api/src/handler.js:733-736` |
| Trois premiers caractères du code postal | **Public** | `handler.js:745` |
| Nom | Privé par défaut | `handler.js:739-744` — l'anonymat est le défaut (`handler.js:730`) |
| Courriel | Privé | `handler.js:748` |
| Téléphone (facultatif) | Privé | `handler.js:751` |
| Réponses du dossier et **noms** des documents | Privé | `handler.js:762-765`, `packages/domain/index.js:1821-1830` |
| Réponses aux critères de tarification | Privé | `handler.js:770-773` |
| Code du partenaire référent | Privé | `handler.js:754` |
| Évaluation d'un notaire (note, commentaire) | Anonymisée | `handler.js:1693-1719` |

**Les fichiers eux-mêmes ne sont jamais transmis à Nota.** Seul le nom du
document, assaini, est enregistré. Le document circule directement entre le
client et le notaire une fois la mise en relation faite.

### Du notaire

Courriel, étiquette d'étude, lien de fiche CNQ, secteur, rayon de déplacement,
ouverture aux urgences, identifiant de compte Stripe Connect, historique d'actes
et de notations (`apps/api/src/billing.js:219-235`, `apps/api/src/cote.js:32-59`).

### Techniquement, en plus

L'adresse IP de l'appelant, utilisée pour limiter les abus de connexion et
horodater les actions administratives (`apps/api/src/admin-handler.js:61-73`).

**Nota ne voit jamais** : numéro de carte, numéro de compte bancaire, pièce
d'identité. Ces éléments restent chez Stripe
(`apps/api/src/stripe-port.js:14`, `index.html:732`).

---

## 3. Pourquoi, et sur quelle base

| Finalité | Renseignements utilisés |
| --- | --- |
| Publier l'offre sur le carnet | date, service, montant, secteur |
| Permettre à un notaire de retenir la demande | dossier, courriel, téléphone — **libérés uniquement au notaire qui retient** (`handler.js:1466`) |
| Autoriser et régler le paiement | montant, courriel (transmis à Stripe) |
| Notifier le client et le notaire | courriel |
| Établir la cote d'un notaire | évaluations, actes, activité |
| Créditer un partenaire référent | code partenaire |
| Limiter les abus | adresse IP |

Nota **ne vend ni ne loue** vos renseignements. Nota se rémunère uniquement par
sa part sur les actes complétés. **Aucune donnée n'est monnayée**
(`index.html:1108`).

---

## 4. Consentement

Le consentement est demandé **de manière distincte** pour le partage du dossier
avec le notaire retenu : une case explicite, libellée « J'autorise le partage de
mon dossier avec le notaire retenu », doit être cochée
(`apps/web/public/app.js:4073-4094`). Le choix est enregistré avec le dossier
(`packages/domain/index.js:1753, 1761-1762`).

Avant de publier, le client est informé de ce qui devient public
(`index.html:1313`).

> ⚠️ **Manques.**
> - **Aucun consentement aux conditions d'utilisation n'est recueilli ni
>   enregistré** : ni case, ni version, ni horodatage (recherche de `tos`, `cgu`,
>   `termsAccepted` dans `apps/api/src/` → zéro résultat).
> - Le consentement au partage du dossier est **révocable en pratique** (décocher
>   la case) mais **le retrait n'est pas propagé** : rien ne retire un dossier
>   déjà libéré à un notaire.

---

## 5. Évaluation des facteurs relatifs à la vie privée (EFVP)

La Loi 25 exige une EFVP pour tout projet d'acquisition, de développement ou de
refonte d'un système d'information mettant en jeu des renseignements personnels,
ainsi qu'avant toute communication hors Québec.

**Aucune EFVP n'a été réalisée à ce jour.** Deux sont requises avant la mise en
service :

1. **EFVP du produit** — le système dans son ensemble : collecte, conservation,
   libération du dossier au notaire, règlement, évaluations.
2. **EFVP de communication hors Québec** — Stripe traite les paiements depuis
   l'extérieur du Québec. Les données sont hébergées à Montréal
   (`infra/providers.tf:35-36`, région `ca-central-1`), mais le courriel du client
   est transmis à Stripe (`apps/api/src/handler.js:813`) et les notaires y
   déposent leur identité. Cette communication doit être évaluée et documentée.

---

## 6. Vos droits

| Droit | Comment l'exercer | État réel |
| --- | --- | --- |
| **Accès** | `confidentialite@nota.ca` | Manuel — **aucun outil** |
| **Rectification** | `confidentialite@nota.ca` | Manuel — **aucun outil** |
| **Suppression / retrait** | `confidentialite@nota.ca` | Manuel — **aucun outil** |
| **Portabilité** (renseignements informatisés recueillis auprès de vous, dans un format technologique structuré et couramment utilisé) | `confidentialite@nota.ca` | **Aucun mécanisme n'existe** |
| **Retrait du consentement** | décocher le partage du dossier ; se désabonner des courriels | Partiel |
| **Désabonnement** | lien en pied de chaque courriel | ✅ Fonctionne (`apps/api/src/handler.js:1130-1144`) |
| **Plainte** | `confidentialite@nota.ca`, puis la Commission d'accès à l'information du Québec | — |

**Délai de réponse : 30 jours.**

> ⚠️ **Écart grave entre la promesse et le code.** L'application promet déjà
> l'accès, la rectification et la suppression sous 30 jours
> (`index.html:1103`). **Aucun mécanisme correspondant n'existe** : il n'y a ni
> route d'export, ni route de suppression, ni procédure écrite. Une demande
> reçue aujourd'hui ne pourrait être honorée qu'à la main, par écriture directe
> dans la base — sans traçabilité. **Aucun droit à la portabilité n'est
> implémenté.** Ce sont des obligations légales exigibles dès maintenant.

---

## 7. Où vos données résident, et qui d'autre les voit

**Hébergement : Canada.** Amazon Web Services, région `ca-central-1` (Montréal)
(`infra/providers.tf:35-36`, `index.html:1090-1091`).

Sous-traitants : voir l'[accord de traitement des données](accord-de-traitement-des-donnees.md).

| Sous-traitant | Ce qu'il traite |
| --- | --- |
| **Amazon Web Services** | hébergement, base de données, courriel sortant (SES) |
| **Stripe** | paiements, comptes de versement des notaires, pièces d'identité des notaires |

Le **notaire qui retient votre demande** reçoit votre dossier et vos coordonnées.
Il est alors responsable de ces renseignements sous son propre secret
professionnel.

---

## 8. Conservation

Voir la [politique de conservation](politique-conservation-des-donnees.md).

En résumé : une offre et son dossier sont supprimés automatiquement environ
**13 mois** après la date de signature (`apps/api/src/handler.js:815`). Les
enregistrements de notaires, eux, **n'expirent pas** aujourd'hui
(`infra/dynamodb.tf:65-68`).

---

## 9. Sécurité

Voir la [politique de sécurité](politique-de-securite.md).

Mesures réellement en place : chiffrement en transit imposé, stockage entièrement
privé derrière un contrôle d'accès d'origine, moindre privilège strict sur la
base de données, authentification sans mot de passe avec sessions révocables du
côté administratif, séparation physique de la surface administrative, et
minimisation des données au point de collecte.

**Mesures manquantes qu'il serait malhonnête de taire** : absence de journal
d'audit d'infrastructure, absence de gestionnaire de secrets, absence de clés de
chiffrement gérées, alarmes sans destinataire. Le détail est dans
`../compliance/soc2-gap-analysis.md`.

---

## 10. Incidents de confidentialité

Nota tient un **registre des incidents de confidentialité** et notifie la
Commission d'accès à l'information ainsi que les personnes concernées lorsque
l'incident présente un **risque de préjudice sérieux**, conformément à la Loi 25.

La procédure, les critères d'évaluation du risque, les délais et le modèle de
registre sont dans le
[plan de réponse aux incidents](plan-de-reponse-aux-incidents.md).

> ⚠️ **Le registre n'existe pas encore.** Il est légalement obligatoire, même
> vide. Le modèle est fourni dans le plan de réponse.

---

## 11. Décisions automatisées

La **cote** d'un notaire est calculée automatiquement et détermine la part qu'il
reçoit (`apps/api/src/cote.js:62-64`, `apps/api/src/billing.js:105-147`).

Nota informe le notaire de cette décision, lui en communique les axes, la valeur
et le prochain palier (`apps/api/src/handler.js:1367-1385`), et lui permet de
présenter ses observations à `bonjour@nota.ca`.

Aucune décision automatisée n'est prise à l'égard d'un client.

---

## 12. Mineurs, et catégories sensibles

Le service s'adresse à des personnes majeures. Nota ne recueille pas sciemment de
renseignements auprès de mineurs.

Nota **ne recueille aucun renseignement sensible** : ni numéro d'assurance
sociale, ni pièce d'identité, ni donnée de santé, ni donnée biométrique. La
vérification d'identité est faite par le notaire, hors de la plateforme
(`index.html:1107`).

---

## 13. Modifications et contact

Cette politique peut évoluer ; la version en vigueur porte son numéro et sa date.

**Responsable de la protection des renseignements personnels :**
`confidentialite@nota.ca`
**Commission d'accès à l'information du Québec :** `cai.gouv.qc.ca`
