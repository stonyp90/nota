# 0042. Le prix annoncé est le total, et les lignes de service montent à 229 et 279 $

Date : 2026-09-05

Statut : accepté. **Précise l'ADR 0034 et l'ADR 0038, n'en retire rien.**

## Contexte

Deux textes que le dépôt n'avait jamais cités ont été relus à la source le
5 septembre (`docs/legal/verification-juridique-2026-09-05-prix-et-frais.md`).

L'art. 224 c) de la Loi sur la protection du consommateur : « le prix annoncé
doit comprendre le total des sommes que le consommateur devra débourser pour
l'obtention du bien ou du service », taxes de vente exceptées, et « le prix
annoncé doit ressortir de façon plus évidente que les sommes dont il est
composé ». L'art. 74.01 (1.1) de la Loi sur la concurrence : « l'indication
d'un prix qui n'est pas atteignable en raison de frais obligatoires fixes qui
s'y ajoutent constitue une indication fausse ou trompeuse », sauf les montants
imposés par une loi.

Trois surfaces du carnet annonçaient « à partir de 2 000 $ » pour un
refinancement : le plancher des honoraires du notaire, seul. Le service de
Nota est un frais obligatoire fixe qui s'y ajoute à la caisse. Un client ne
peut pas obtenir un refinancement par Nota à 2 000 $.

Le propriétaire a par ailleurs demandé, le même jour, que la marge soit
optimisée autant que possible dans les limites déjà posées : rester sous les
295 $ de la prise en charge de Notairo, rester sous le taux de prise d'Airbnb,
ne jamais faire dépendre le prix du notaire ni de la valeur de l'acte.

## Décision

**1. Le seul « à partir de » qu'une surface client peut afficher pour un acte
est le total annoncé : honoraires de départ du notaire plus prix de Nota au
palier standard.** Le domaine le calcule (`prixAnnonce(serviceId, grille)`) et
l'écran le lit, jamais l'inverse. Les taxes de vente restent en sus, ce que les
deux lois permettent, et se disent telles. Les débours imposés par une loi
(droits de publication, RDPRM) restent en sus et se nomment.

Trois surfaces changent : les lignes du pouls du carnet, le sélecteur d'acte
et le catalogue JSON-LD que les moteurs lisent. La ligne du héros, « le service
Nota, à partir de 229 $ », annonce le prix de Nota pour ce qu'il est et reste.
Un test (`truthful-claims`) interdit désormais qu'un « à partir de » soit
composé depuis le plancher des honoraires seul.

**2. Les lignes de service montent de 199 à 229 $ (financement) et de 249 à
279 $ (refinancement).** Le prix annoncé devient 2 029 $ et 2 279 $.

| | Financement | Refinancement |
| --- | ---: | ---: |
| Prix de Nota, service | 229 $ | 279 $ |
| Prix annoncé, taxes en sus | 2 029 $ | 2 279 $ |
| Taux de prise sur une date calme | 11,3 % | 12,2 % |
| Écart avec Notairo (295 $) | −22,4 % | −5,4 % |

Les deux taux restent sous les 13,6 % d'Airbnb, et sous les 16,7 à 18,2 % du
prix unique retiré par l'ADR 0034. La grille reste non régressive : le petit
acte paie moins.

**3. Le tarif servi au client ne porte ni « taux » ni « palier ».** Le bloc
d'annulation qu'il transporte pour le devis (ADR 0041) se nomme `plafonds`,
avec une cellule `plafond` par palier. Le scénario `deontologie.feature` tient
la liste des mots qu'aucune pièce d'argent ne doit porter.

### Effet sur la marge

Au multiple recommandé de chaque palier, après l'ADR 0038 et cette décision :

| Par acte complété, moyenne pondérée | ADR 0034 | ADR 0038 | **ADR 0042** |
| --- | ---: | ---: | ---: |
| Revenu de Nota | 257 $ | 301 $ | **331 $** |
| Frais de carte | (89) $ | (90) $ | (91) $ |
| Marge brute de Nota | 168 $ | 211 $ | **240 $** |
| Marge brute | 66 % | 70 % | **73 %** |

Le seuil de rentabilité de l'an 1 passe de 1 487 actes (ADR 0034) à
**1 041 actes**.

## Ce que cette décision ne règle pas

1. **Le plancher des honoraires reste à 2 000 et 1 800 $.** Le marché
   québécois vend le même acte 1 300 à 1 700 $ d'honoraires hors taxes. C'est
   le plancher, pas la ligne de Nota, qui rend Nota chère tout compris. Le
   baisser améliorerait la marge de Nota (moins de frais de carte sur un argent
   qu'elle ne garde pas) et la conversion. Décision du propriétaire, non prise.
2. **Le coût structurel demeure** : Nota paie Stripe sur les honoraires du
   notaire. Voir ADR 0038 et le relevé du 5 septembre.
3. **Les niveaux ne sont toujours pas validés par une transaction.** Ils sont
   administrables pour cette raison.

## Conséquences

- `packages/domain` : `prixNotaCents` 22900 et 27900, `prixAnnonce()`.
- `apps/web` : `prixAnnonceDollars()` derrière le pouls, le sélecteur et le
  JSON-LD, lu sur la grille servie par l'API.
- Tests : `prix-nota-grille`, `truthful-claims` (garde du prix partiel),
  `smoke`, `i18n`, les scénarios BDD et les fixtures admin portent les nouveaux
  totaux.
- Documents : README, plans, kit de validation, courriels, scripts d'entrevue.
