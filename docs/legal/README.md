# Documents juridiques — Nota

## Avertissement, à lire avant tout le reste

**Tous les documents de ce répertoire sont des BROUILLONS non révisés.**

Ils ont été rédigés à partir du code du produit, non par un juriste. Aucun d'eux
n'a été relu par un avocat, un notaire ou la Chambre des notaires du Québec.
**Aucun ne doit être publié, opposé à un client ou à un notaire, ni invoqué comme
engagement contractuel, en l'état.**

Leur utilité est double :

1. donner à un conseiller juridique un point de départ qui décrit **le produit
   réel**, pas un produit imaginé ;
2. rendre visible ce qui manque.

---

## Le préalable qui n'est pas négociable

**Le partage d'honoraires avec un non-notaire est restreint par le *Code de
déontologie des notaires* du Québec.**

Le modèle économique de Nota — retenir une part du montant que le client verse
pour un acte notarié — tombe directement dans cette restriction. L'avertissement
est dans le code depuis le premier jour, en tête de
`apps/api/src/billing.js:13-17` :

> *a share of a notarial acte is fee-sharing the Québec Code de déontologie
> restricts; this model is an explicit owner decision and needs a legal review
> with the Chambre before launch.*

Le plan d'affaires budgète **20 000 $** pour un avis écrit et un engagement
structuré avec la Chambre (`docs/business-plan.md:133-134`, `:554`).

**Et ce n'est pas le texte le plus lourd du dossier.** L'**article 32.1 de la
*Loi sur le notariat*** (en vigueur le 24 octobre 2023) présume **usurper les
fonctions de notaire** l'intermédiaire qui « obtient d'un notaire qu'il abandonne
une partie de ses honoraires » — **2 500 à 125 000 $, doublé en récidive**. Et le
Bureau du syndic de la Chambre a prévenu, le **25 janvier 2024**, qu'il est
« proscrit […] de laisser un intermédiaire offrir vos services, dicter votre
conduite ou la portée de votre mandat ou fixer ou partager vos honoraires », en
annonçant qu'il n'hésiterait pas « à prendre les recours qui s'imposent ».

**Cet avis juridique écrit demeure REQUIS avant toute mise en service**, et son
mandat s'est **élargi à quatre volets** : le partage d'honoraires et l'art. 32.1,
l'affichage des avis (art. 70), la qualification de la cote comme
recommandation, et la présentation des prix (art. 71-72).

Aucun document de ce répertoire ne le remplace, ne l'anticipe et n'en préjuge.
Tant qu'il n'est pas obtenu, la structure de rémunération décrite ici doit être
tenue pour **provisoire et susceptible d'être refaite**.

Le dossier complet — textes, sources officielles, ce que le produit fait déjà,
et la liste ordonnée de ce qui reste exposé — est dans
[`conformite-deontologique-notaires.md`](conformite-deontologique-notaires.md).

### La hiérarchie, décidée le 1er septembre 2026

> « Ça serait de ne pas être à l'encontre du Code de déontologie des notaires.
> Ceci est primordial. » — le propriétaire

C'est une **hiérarchie, pas une préférence** : la conformité passe avant la
valeur produit. Première application, immédiate et livrée — **aucune note,
moyenne d'avis ou cote concernant un notaire nommé ne descend plus vers un
client** (ADR 0030).

---

## Les documents

| Fichier | Objet | État |
| --- | --- | --- |
| [`conformite-deontologique-notaires.md`](conformite-deontologique-notaires.md) | **Le dossier déontologique** : Code de déontologie, *Loi sur le notariat*, ce que le produit fait, ce qui reste exposé | Brouillon — **à lire en premier** |
| [`conditions-utilisation-client.md`](conditions-utilisation-client.md) | Contrat entre Nota et le client qui publie une offre | Brouillon |
| [`conditions-notaire.md`](conditions-notaire.md) | Entente de place de marché entre Nota et le notaire | Brouillon — **dépend de l'avis déontologique** |
| [`politique-confidentialite.md`](politique-confidentialite.md) | Loi 25 : renseignements personnels, droits, incidents | Brouillon |
| [`politique-temoins.md`](politique-temoins.md) | Témoins et stockage local | Brouillon |
| [`politique-conservation-des-donnees.md`](politique-conservation-des-donnees.md) | Durées de conservation et destruction | Brouillon — **contredit le code sur un point** |
| [`politique-de-securite.md`](politique-de-securite.md) | Politique de sécurité de l'information | Brouillon |
| [`plan-de-reponse-aux-incidents.md`](plan-de-reponse-aux-incidents.md) | Détection, confinement, notification, registre | Brouillon |
| [`accord-de-traitement-des-donnees.md`](accord-de-traitement-des-donnees.md) | Sous-traitants : AWS, Stripe, SES | Brouillon |

Documents connexes, hors de ce répertoire :

- [`../compliance/soc2-gap-analysis.md`](../compliance/soc2-gap-analysis.md)
- [`../compliance/piste-audit-transactions.md`](../compliance/piste-audit-transactions.md)

---

## Ce que le produit affiche déjà, et qu'il faut ne pas contredire

Les textes juridiques **existent déjà dans l'application**, en dur, dans trois
panneaux de `apps/web/public/index.html` :

| Panneau | Lignes | Titre affiché |
| --- | --- | --- |
| `pane-confidentialite` | `1076-1113` | Confidentialité (Loi 25) |
| `pane-conditions` | `1116-1159` | Conditions d'utilisation |
| `pane-charte` | `1162-1198` | Charte des droits |

Le français est la langue canonique ; l'anglais est une couche de traduction du
DOM, indexée **par la phrase française elle-même** (`apps/web/public/i18n.js:1-23`).
Les brouillons de ce répertoire reprennent volontairement les formulations déjà
publiées — notamment « Rôle de Nota » (`index.html:1142`) et « Indépendance du
notaire » (`index.html:1143`) — pour ne pas créer deux vérités.

---

## Les contradictions à trancher avant publication

Ces points sont des **conflits réels entre le texte affiché et le code**. Aucun
brouillon ne peut les résoudre seul : ils demandent une décision du propriétaire.

1. **La conservation.** Le site promet 12 mois (`index.html:1102`) ; le code pose
   un TTL de **400 jours** (`apps/api/src/handler.js:815`).
2. **La suppression sur demande sous 30 jours** est promise
   (`index.html:1103`) ; **aucun mécanisme correspondant n'existe dans le code**.
3. **Les frais d'annulation** (30 % / 10 % selon le délai,
   `apps/api/src/cancellation-config.js:25-28`) ne figurent **pas** dans les
   conditions affichées : ils n'apparaissent qu'au moment d'annuler.
4. **L'adresse postale de l'expéditeur est un texte de remplacement** dans tous
   les courriels sortants (`apps/api/src/emails.js:46`) — exigence de la LCAP.
5. **Aucune acceptation des conditions n'est enregistrée** : aucune case, aucune
   version, aucun horodatage. Recherche de `termsAccepted`,
   `conditionsAcceptees`, `tosVersion`, `accepted_at` dans `apps/api/src/` et
   `packages/domain/index.js` → **zéro résultat**.
6. **Aucune version ni date d'entrée en vigueur** dans les conditions affichées.
7. **La créance du règlement hors plateforme n'a aucune modalité.** Quand le
   client paie le notaire directement, la part de Nota devient un dû
   (`apps/api/src/billing.js:318-332`) que **rien ne permet de facturer,
   d'encaisser ni d'éteindre**. Les conditions notaire ne peuvent pas lier
   quelqu'un à une dette dont ni l'exigibilité ni le mode de paiement ne sont
   définis.

### Résolu le 1er septembre 2026

- ~~Le site annonçait « 75 % au notaire, 25 % à Nota » alors que le code
  facturait 15 %.~~ **Aligné** : site, README, ADR 0028 et code disent tous
  « Nota au plus 15 %, le notaire 85 % à 95 % selon sa cote sur 100 »
  (`apps/web/public/index.html:768, 1160, 1170`, `i18n.js:721, 730`,
  `apps/api/src/commission-config.js:23, 27, 32-37`).
- ~~« Ce que vous offrez est ce que le notaire reçoit » contredisait la clause de
  partage.~~ **Retiré** ; `index.html:1214` porte maintenant « Transparence des
  prix ».

---

## Ce qu'il reste à faire faire par un professionnel

- L'avis déontologique, dans son mandat élargi aux quatre volets (ci-dessus, et
  [`conformite-deontologique-notaires.md`](conformite-deontologique-notaires.md) §7).
- L'évaluation de la voie du **bac à sable réglementaire** (art. 198.1 du *Code
  des professions*) auprès du ministre et de la Chambre — la seule porte
  identifiée qui permettrait au modèle actuel d'exister légalement au Québec.
- La **vérification réelle de l'inscription au Tableau de l'Ordre** : Nota
  affiche aujourd'hui un badge « CNQ » sur la foi d'un simple format d'URL
  (`packages/domain/index.js:1399-1402`).
- La revue de l'ensemble de ces brouillons.
- L'évaluation des facteurs relatifs à la vie privée (EFVP) exigée par la Loi 25
  pour un projet d'acquisition ou de refonte de système impliquant des
  renseignements personnels.
- La désignation formelle et publiée du responsable de la protection des
  renseignements personnels.
- La vérification de la conformité LCAP des envois, y compris l'adresse postale.
- La constitution en société, les assurances et la revue des ententes
  fournisseurs.
