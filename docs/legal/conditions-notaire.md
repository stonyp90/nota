# Entente de place de marché — notaire

> **BROUILLON NON RÉVISÉ, ET CONDITIONNEL.** Rédigé à partir du code, non par un
> juriste. Ce document décrit une structure de rémunération dont la licéité
> **n'est pas établie**. Voir la section 0 et [`README.md`](README.md).

**Version : 0.1 (brouillon) · Date d'entrée en vigueur : à déterminer**

---

## 0. Réserve déontologique — à lire d'abord

**Le *Code de déontologie des notaires* du Québec restreint le partage
d'honoraires avec une personne qui n'est pas notaire.**

La structure décrite ci-dessous — Nota conserve une part du montant que le client
verse pour un acte notarié — tombe directement dans le champ de cette
restriction. L'avertissement figure dans le code du produit depuis le premier
jour (`apps/api/src/billing.js:13-17`) et dans le plan d'affaires, qui budgète
**20 000 $** pour un avis écrit et un engagement structuré avec la Chambre des
notaires du Québec (`docs/business-plan.md:133-134`, `:554`).

**Il y a plus lourd encore.** L'**article 32.1 de la *Loi sur le notariat***
présume **usurper les fonctions de notaire** l'intermédiaire qui « obtient d'un
notaire qu'il abandonne une partie de ses honoraires » — **2 500 à 125 000 $,
doublé en récidive** — et le Bureau du syndic de la Chambre a prévenu le
**25 janvier 2024** qu'il est « proscrit […] de laisser un intermédiaire […]
fixer ou partager vos honoraires ». Le dossier complet, avec ses sources, est
dans [`conformite-deontologique-notaires.md`](conformite-deontologique-notaires.md).

**Un avis juridique écrit demeure REQUIS avant la mise en service**, et son
mandat couvre désormais quatre volets : le partage d'honoraires et l'art. 32.1,
l'affichage des avis (art. 70), la qualification de la cote, et la présentation
des prix (art. 71-72). Il peut conclure que la structure doit être refaite — par exemple en frais de service
facturés au client sans lien avec les honoraires, comme le font les plateformes
comparables (voir `docs/decisions/0027-partage-75-25-cote-client.md`, dont l'ADR 0028 a depuis révisé le barème).

**Aucun notaire ne devrait signer cette entente avant l'obtention de cet avis.**
Le notaire demeure en tout temps seul responsable du respect de son propre code
de déontologie ; rien dans le présent document ne l'en dégage.

---

## 1. Objet

Nota exploite une place de marché où des clients du Québec publient la date à
laquelle ils souhaitent signer un acte notarié et le montant qu'ils offrent. Le
notaire consulte ces demandes et choisit librement celles qu'il retient.

**Nota n'est pas un cabinet, n'exerce pas la profession notariale, ne rédige
aucun acte et ne donne aucun conseil juridique** (`apps/web/public/index.html:1142`).

**Le notaire agit en toute indépendance professionnelle** : il apprécie le
mandat, vérifie l'identité du client, rédige l'acte selon la loi et demeure seul
maître de son exécution. **Nota n'intervient jamais dans l'acte**
(`index.html:1143`, `index.html:887`).

---

## 2. Adhésion, gratuité, et vérification

**L'inscription et la consultation du carnet sont gratuites.** Il n'existe
aucun abonnement et aucun frais fixe (`apps/api/src/billing.js:8-11`).

Le notaire ouvre un compte de paiement Stripe Connect (Express). Les pièces
d'identité et coordonnées bancaires exigées à cette étape **restent chez Stripe ;
Nota ne les voit jamais** (`index.html:732`, `apps/api/src/stripe-port.js:14`).

Le notaire peut inscrire le lien de sa **fiche officielle à la Chambre des
notaires du Québec** (`cnq.org`) ; un badge « CNQ » est alors affiché
(`index.html:790`, `packages/domain/index.js:1388-1389`).

> ⚠️ **Faiblesse à corriger.** Nota **ne vérifie pas l'inscription au Tableau de
> l'Ordre.** Le seul contrôle est un format d'URL (`packages/domain/index.js:1399-1402`).
> Rien n'empêche aujourd'hui une personne non inscrite d'ouvrir un compte, de
> retenir un acte et d'en être payée. Une place de marché notariale ne peut pas
> lancer sans une vérification réelle du statut professionnel, ni sans un
> mécanisme de radiation immédiate.

---

## 3. Ce que le notaire reçoit

**Le notaire reçoit la totalité du montant que le client a offert.** Nota ne
prélève rien sur ses honoraires, ne lui demande d'en abandonner aucune part, et
ne fait dépendre son revenu d'aucune note, cote ou classement.

Une offre porte **deux lignes distinctes**, que le client voit séparément avant
de s'engager :

| Ligne | Qui l'encaisse | Ce qui la détermine |
| --- | --- | --- |
| **Honoraires** | **Le notaire, en entier** | Le montant offert par le client |
| **Prix de Nota** | Nota | Un prix **publié d’avance**, déterminé par le service et par le délai avant la signature — **identique pour tous les notaires**, et sans lien avec vos honoraires |

La carte du client autorise le **total** des deux lignes ; à la signature, la
capture prélève ce total, les frais d'application Stripe **sont** le prix de
Nota, et le net viré au notaire est exactement le montant qui lui a été offert
(`apps/api/src/billing.js:183-186`, `:355-357`).

**Le prix de Nota ne dépend de rien qui touche au notaire** — ni de sa cote, ni
de son historique, ni de la valeur de l'acte. C'est un invariant testé
(`apps/api/test/prix-nota-separe.test.mjs`), et c'est une obligation : l'art.
29.1 du *Code de déontologie* interdit au notaire toute convention mettant en
péril son indépendance et son désintéressement, et un revenu indexé sur une note
attribuée par une entreprise privée en serait une.

*(Prix par défaut : 400 $ — `apps/api/src/prix-nota-config.js:41`. Décision :
`docs/decisions/0031-le-prix-de-nota-est-celui-de-nota.md`.)*

> **Ce qui a changé, et pourquoi.** Jusqu'au 1<sup>er</sup> septembre 2026, Nota
> conservait de 5 % à 15 % du montant offert, selon la cote du notaire. Ce
> modèle est **retiré**. Trois textes le condamnaient ensemble : l'art. 32.1 2°
> de la *Loi sur le notariat* (est présumée usurper les fonctions de notaire la
> personne qui « obtient d'un notaire qu'il abandonne une partie de ses
> honoraires et frais »), l'art. 32 du *Code de déontologie* (le notaire ne peut
> partager ses honoraires avec un non-membre d'un ordre) et l'art. 29.1. Aucun
> notaire n'a été facturé sous l'ancien modèle : aucun acte n'a encore été porté
> sur la plateforme.

### La cote sur 100 — ce qu'elle fait, et ce qu'elle ne fait plus

La cote **ne touche plus à un dollar**. Elle subsiste comme signal de service,
calculée sur quatre axes visibles par le notaire dans sa console
(`apps/api/src/cote.js:32-59`) :

| Axe | Ce qui le compose |
| --- | --- |
| **Évaluations** | la note moyenne des clients et le nombre d'avis |
| **Actes rendus** | le nombre d'actes complétés. **Pas leur variété** : se spécialiser ne coûte rien |
| **Disponibilité** | **toutes** les demandes auxquelles le notaire répond — proposition, acceptation **ou refus, sans distinction** — son rayon de déplacement, son ouverture aux urgences. Seul le silence vaut zéro |
| **Présence** | fiche CNQ renseignée, secteur déclaré, activité récente, ancienneté |

**Refuser un mandat ne coûte rien.** C'est délibéré : l'art. 8 du *Code de
déontologie* commande au notaire de tenir compte des limites de ses aptitudes et
de ses moyens **avant** de convenir d'un contrat de service, et l'art. 26 lui
impose de cesser d'agir pour un motif sérieux. Une plateforme qui pénaliserait
un refus le pousserait à contrevenir à son propre code.

La cote n'est **jamais publiée sur une surface client** : l'art. 70 interdit au
notaire d'utiliser un témoignage d'appui ou de reconnaissance dans sa publicité
(`docs/decisions/0030-la-deontologie-prime-la-cote-ne-se-publie-pas.md`).

---

## 4. Quand et comment le notaire est payé

**Le client paie Nota ; Nota vire au notaire.** Le notaire ne facture pas le
client par la plateforme et ne rétrocède rien à Nota : il reçoit un virement.

1. **À la publication de l'offre**, la carte du client est autorisée **au profit
   de Nota** — une session de paiement au nom de la plateforme, sans compte
   connecté (`apps/api/src/stripe-port.js:85-116`). Rien n'est débité.
2. **Quand le notaire retient la demande**, le dossier et les coordonnées du
   client lui sont libérés (`apps/api/src/handler.js:1613`). **Aucun paiement
   n'a lieu à cette étape** — mais le taux du notaire est **gravé** (voir
   section 3).
3. **À la signature**, le notaire déclare l'acte complété et sa valeur. Le
   paiement du client est **capturé sur le compte de Nota**, puis **le net —
   montant moins la part de Nota — est viré au compte Connect du notaire**
   (`apps/api/src/stripe-port.js:126-146`).

La valeur déclarée est bornée contre l'offre retenue : une valeur aberrante est
refusée (`apps/api/src/handler.js:1094`). **Un acte ne peut être réglé qu'une
fois** : le registre est en écriture unique (`apps/api/src/repo-dynamo.js:735-749`).

**Seul le notaire qui a retenu la demande peut la compléter**
(`handler.js:1087-1090`).

### Le taux promis est un plafond

Le taux affiché au notaire **au moment où il retient** est gravé sur l'acte
(`tauxRetenu`, `apps/api/src/handler.js:509-524`). Au règlement, Nota applique
**le plus avantageux des deux** pour le notaire (`billing.js:174-180`) : une cote
qui monte entre l'engagement et la signature profite encore au notaire, **une
cote qui baisse ne renchérit jamais un acte déjà promis**. Les deux taux sont
conservés dans le registre, donc vérifiables.

> ✅ **Corrigé** (1er septembre 2026). Le chemin de repli n'invente plus
> d'encaissement. Lorsque aucune autorisation ne peut être capturée — le client a
> payé le notaire **directement** à la signature — l'acte est enregistré
> `paye: false` et la part de Nota devient une **créance** explicite,
> `commissionCentsDue`, qui ne touche jamais le compteur des sommes réellement
> encaissées (`apps/api/src/billing.js:255-340`). Le relevé du notaire
> (`handler.js:1507-1511`) et le registre de l'opérateur (`admin.js:616-620`)
> distinguent partout l'encaissé du dû, et le courriel « acte payé » n'est plus
> envoyé sur ce chemin (`handler.js:1146-1151`).

### La créance, et ce qui n'existe pas encore

Quand un acte se règle hors plateforme, **le notaire doit à Nota la part de
service** de cet acte. Il la voit sur son relevé (`du`), et Nota la voit dans son
registre (`commissionDue`).

> ⚠️ **Aucune modalité de recouvrement n'existe.** Il n'y a aujourd'hui ni
> facturation, ni échéance, ni moyen de marquer une créance payée : le montant dû
> ne fait que s'accumuler et **ne redescend jamais**, même si Nota l'encaisse hors
> ligne (`billing.js:319, 332`, `admin.js:620` sont ses seules occurrences dans
> tout le code). Avant qu'un notaire puisse être lié par cette clause, l'entente
> doit préciser **quand** la créance est exigible, **comment** elle est facturée
> et payée, et **ce qui l'éteint** — et le produit doit savoir l'enregistrer.
> Voir `../compliance/piste-audit-transactions.md`, §5.5.

---

## 5. Ce que le notaire s'engage à faire

- Être et demeurer **inscrit au Tableau de l'Ordre** de la Chambre des notaires
  du Québec, et informer Nota sans délai de toute limitation, suspension ou
  radiation.
- Maintenir l'**assurance responsabilité professionnelle** obligatoire.
- Respecter son **Code de déontologie**, y compris ses obligations de vérification
  d'identité, de conservation, de secret professionnel et de conflits d'intérêts.
- **Honorer les rendez-vous retenus.** Retenir une demande engage le notaire
  envers un client qui a déjà immobilisé le montant sur sa carte.
- Ne retenir que les demandes qu'il peut **réellement servir**, selon le rayon de
  déplacement et l'ouverture aux urgences qu'il a déclarés — contrôle appliqué au
  moment de retenir (`handler.js:1482-1485`).
- Traiter les renseignements du client conformément à la Loi 25 et à son secret
  professionnel, et n'en faire aucun autre usage.

---

## 6. Ce que Nota s'engage à faire

- **Ne jamais intervenir dans l'acte**, ni dans la relation professionnelle.
- **Divulguer intégralement sa part** : le taux, le montant, la cote qui l'a
  déterminé, et le prochain palier.
- **Ne pas mettre une offre en avant contre paiement.** Le carnet est public et
  les mêmes règles s'appliquent à tous (`index.html:1192`).
- **Ne pas monnayer les données.** Nota se rémunère uniquement par sa part sur les
  actes complétés (`index.html:1108`).
- Ne libérer le dossier et les coordonnées du client **qu'au notaire qui retient**
  la demande.
- Payer les récompenses de référence **à même ses propres fonds** : elles ne sont
  jamais retranchées des honoraires du notaire ni ajoutées au prix du client
  (`index.html:1009`).

---

## 7. Évaluations — recueillies, jamais publiées

Le client peut évaluer le notaire une fois l'acte réglé. Le notaire voit
l'intégralité de ses évaluations, note et commentaire, **anonymisées à la source**
(`handler.js:1474-1476`, `GET /notary/evaluations`).

### Nota ne publie aucune évaluation vous concernant

**Aucune note, aucune moyenne, aucun nombre d'avis et aucune cote vous concernant
n'est montré à un client.** C'est une obligation, pas un choix d'affichage.

L'**article 70 du *Code de déontologie des notaires*** interdit au notaire
d'utiliser « **ou de permettre que soit utilisé** » un témoignage d'appui qui le
concerne — **sans exception pour les avis authentiques**. Une plateforme qui
afficherait vos évaluations **vous mettrait en défaut**, vous, envers votre
ordre. Nota s'y refuse.

Ce qu'un client voit de vous : votre étude, votre prix, votre **appartenance à la
Chambre**, le **nombre d'actes** que vous avez portés sur Nota, le délai et le
déplacement. Des faits — jamais une appréciation
(`handler.js:1763-1771`, `:1797-1801`).

**Ce que vous seul voyez :** votre moyenne, chaque commentaire, votre cote, vos
quatre axes et votre palmarès par service (`handler.js:1450-1485`). **Votre
dossier n'est pas votre publicité** : l'information que Nota vous donne sur
vous-même ne relève pas de l'art. 70.

**Ce que Nota voit :** le registre interne d'affectation et de qualité
(`admin.js:587-627`).

*(Décision : `docs/decisions/0030-la-deontologie-prime-la-cote-ne-se-publie-pas.md`.
Garanti par `apps/api/test/deontologie-avis.test.mjs`.)*

### Ce qui manque encore

Les évaluations alimentent la cote, donc la part (section 3). Nota se réserve la
possibilité de retirer une évaluation manifestement abusive ; **aucune procédure
de contestation n'existe aujourd'hui dans le produit** et doit être créée.

### Décliner ne vous coûte rien

**Refuser une demande ne fait jamais baisser votre cote**, donc n'augmente jamais
la part que Nota prélève.

Votre déontologie peut vous **imposer** de refuser un mandat — conflit
d'intérêts, compétence insuffisante, surcharge. Une plateforme qui vous ferait
payer ce refus vous placerait devant un choix que vous ne devez pas avoir à
faire. Le barème est construit pour l'éviter : l'axe « disponibilité » compte
**toutes vos réponses**, qu'elles soient des propositions, des acceptations ou
des refus (`packages/domain/index.js:1306-1323`). Ce qui vaut zéro, c'est de ne
pas répondre du tout.

En pratique, décliner fait légèrement **monter** votre cote, parce que répondre
est ce qui compte. Deux tests le verrouillent : dix refus et dix acceptations
donnent exactement la même note, et **se spécialiser ne coûte rien** non plus —
servir un seul type d'acte vaut autant que d'en servir cinq, à volume égal
(`packages/domain/test/cote.test.mjs`).

*(Motivation : `docs/decisions/0028-la-cote-sur-100-decide-le-partage.md`,
section « deux sanctions déontologiquement à l'envers, retirées ».)*

---

## 8. Suspension et résiliation

Le notaire peut cesser d'utiliser Nota à tout moment et déconnecter son compte
Stripe ; son statut passe alors à « restreint » et il ne reçoit plus de demandes
(`apps/api/src/billing.js:503-515`).

Nota peut suspendre un compte en cas de manquement aux présentes conditions ou de
perte du statut professionnel.

**Les actes déjà retenus doivent être menés à terme** ou faire l'objet d'un
transfert convenu avec le client.

> ⚠️ **Manque.** Il n'existe **aucun mécanisme de session révocable côté notaire**,
> contrairement à la console admin : le jeton notaire est sans état
> (`apps/api/src/notary-auth.js:104-132`). Un accès ne peut pas être coupé
> immédiatement. C'est un défaut à corriger avant qu'une suspension ait un sens.

---

## 9. Responsabilité, droit applicable

Nota fournit une plateforme de mise en relation. **La qualité, la validité et
l'exécution de l'acte relèvent du notaire**, seul responsable envers son client
et envers son ordre professionnel.

Ces conditions sont régies par le droit du Québec. Tout litige relève des
tribunaux du district judiciaire de Québec.

**Contact.** `bonjour@nota.ca`

---

## 10. Documents de référence

- ADR 0028 — la cote sur 100 décide le partage
  (`docs/decisions/0028-la-cote-sur-100-decide-le-partage.md`)
- ADR 0029 — un règlement hors plateforme est une créance, jamais un
  encaissement (`docs/decisions/0029-un-reglement-hors-plateforme-est-une-creance.md`)
- ADR 0023 — les frais d'annulation tardive
- `../compliance/piste-audit-transactions.md` — ce qu'un auditeur peut
  reconstituer de chaque dollar, et ce qui manque encore
