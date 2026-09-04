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

**Le partage d'honoraires avec un non-notaire est interdit par le *Code de
déontologie des notaires* du Québec (art. 32).**

**Nota ne partage aucun honoraire.** Le notaire reçoit **la totalité** du montant
que le client lui offre ; Nota facture au client, à côté et sur sa propre ligne,
**son propre prix pour son propre service** — une grille publiée par service
(199 $ / 249 $) plus une garantie de date (0 · 50 · 100 · 200 · 300 $). La carte
du client autorise le total des deux ; à la signature, Nota capture ce total,
garde ses deux lignes et vire les honoraires au notaire.

Jusqu'au 1<sup>er</sup> septembre 2026, il en allait autrement : Nota conservait
de 5 % à 15 % du montant offert, selon la cote du notaire. **Ce modèle est
retiré**, et le fichier qui le portait (`commission-config.js`) a été supprimé du
dépôt au profit de `prix-nota-config.js`. Décisions :
[`0031`](../decisions/0031-le-prix-de-nota-est-celui-de-nota.md) puis
[`0034`](../decisions/0034-le-prix-de-nota-est-une-grille-par-service.md). Aucun
notaire n'a été facturé sous l'ancien modèle : aucun acte n'avait encore été
porté sur la plateforme.

**Ce qui reste ouvert est la qualification, pas la structure.** L'**article 32.1
de la *Loi sur le notariat*** (en vigueur le 24 octobre 2023) présume **usurper
les fonctions de notaire** l'intermédiaire qui « obtient d'un notaire qu'il
abandonne une partie de ses honoraires » — **2 500 à 125 000 $, doublé en
récidive**. Et le Bureau du syndic de la Chambre a prévenu, le **25 janvier
2024**, qu'il est « proscrit […] de laisser un intermédiaire offrir vos services,
dicter votre conduite ou la portée de votre mandat ou fixer ou partager vos
honoraires », en annonçant qu'il n'hésiterait pas « à prendre les recours qui
s'imposent ». Nota n'obtient aucun abandon d'honoraires — mais un prix perçu par
acte, par un intermédiaire, reste à **qualifier** par un juriste.

Le plan d'affaires budgète **20 000 $** pour cet avis et pour un engagement
structuré avec la Chambre ([`../business-plan.md`](../business-plan.md), §2.2 et
§12.1).

**Cet avis juridique écrit demeure REQUIS avant toute mise en service**, et son
mandat couvre **quatre volets** : la qualification du prix de Nota au regard de
l'art. 32.1, l'affichage des avis (art. 70), la qualification de la cote comme
recommandation, et la présentation des prix (art. 71-72) — **y compris le fait
que les taxes et les débours ne figurent dans aucune ligne du produit**.

Aucun document de ce répertoire ne le remplace, ne l'anticipe et n'en préjuge.
Tant qu'il n'est pas obtenu, la structure de rémunération décrite ici doit être
tenue pour **provisoire et susceptible d'être refaite** — un forfait par acte
facturé hors de l'acte est la structure de repli déjà identifiée.

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
   `apps/api/src/cancellation-config.js`) ne figurent **pas** dans les
   conditions affichées : ils n'apparaissent qu'au moment d'annuler. Ils sont
   **versés au notaire**, jamais gardés par Nota (ADR 0033).
8. **Les taxes et les débours ne sont dans aucune ligne du produit.** Ni le
   montant offert au notaire ni le prix de Nota ne les portent. L'art. 71 3°
   exige d'indiquer s'ils sont inclus, et l'art. 68 interdit la publicité
   incomplète : tant que ce point n'est pas réglé, aucune surface ne peut
   présenter le total comme « tout compris ».
4. **L'adresse postale de l'expéditeur est un texte de remplacement** dans tous
   les courriels sortants (`apps/api/src/emails.js:46`) — exigence de la LCAP.
5. **Aucune acceptation des conditions n'est enregistrée** : aucune case, aucune
   version, aucun horodatage. Recherche de `termsAccepted`,
   `conditionsAcceptees`, `tosVersion`, `accepted_at` dans `apps/api/src/` et
   `packages/domain/index.js` → **zéro résultat**.
6. **Aucune version ni date d'entrée en vigueur** dans les conditions affichées.
7. **La créance du règlement hors plateforme n'a aucune modalité.** Quand le
   client paie le notaire directement, le prix de Nota — jamais une part des
   honoraires — devient un dû que **rien ne permet de facturer, d'encaisser ni
   d'éteindre**. Les conditions notaire ne peuvent pas lier
   quelqu'un à une dette dont ni l'exigibilité ni le mode de paiement ne sont
   définis.

### Résolu le 1er septembre 2026

- ~~Le site annonçait « 75 % au notaire, 25 % à Nota » alors que le code
  facturait 15 %.~~ D'abord **aligné** sur « Nota au plus 15 % » — puis
  **entièrement retiré** le 1<sup>er</sup> septembre : il n'y a plus de partage à
  divulguer. Le notaire reçoit 100 % de ses honoraires et Nota facture son propre
  prix au client (ADR 0031, puis la grille de l'ADR 0034).
- ~~« Ce que vous offrez est ce que le notaire reçoit » contredisait la clause de
  partage.~~ **La phrase est redevenue vraie** : c'est exactement ce que le code
  fait depuis l'ADR 0031.

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
