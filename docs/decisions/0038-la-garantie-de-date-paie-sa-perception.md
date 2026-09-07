# 0038. La garantie de date paie sa perception et garde la marge

Date : 2026-09-05

Statut : accepté. **Précise l'ADR 0034 et n'en retire rien.** Seule la ligne
de garantie de date change de niveau. Les lignes de service, les deux
dimensions du prix et les quatre murs restent ce qu'ils étaient.

> **Le même jour, l'ADR 0042 a porté les lignes de service à 229 et 279 $.**
> Les tables ci-dessous sont celles de cette décision, à 199 et 249 $ ; les
> trois règles et l'échelle 0 · 149 · 299 · 449 · 549 $ ne changent pas. Les
> chiffres à jour sont dans l'ADR 0042 et dans le plan d'affaires.

## Contexte

L'ADR 0034 a posé la garantie de date à 0, 50, 100, 200 et 300 $ selon le
palier, en écrivant lui-même que « les niveaux eux-mêmes ne sont pas validés ».
L'audit du 4 septembre les a mesurés, et deux barreaux perdaient de l'argent.

Nota est la plateforme Stripe. La carte du client est débitée du total des deux
lignes, honoraires du notaire compris, et les frais de carte portent sur ce
total. Nota les supporte seule, y compris sur l'argent qu'elle vire au notaire
en entier. Chaque barreau de l'échelle multiplie donc les honoraires du notaire
et, du même coup, un coût que Nota paie.

Au multiple recommandé de chaque palier, sur un refinancement à 2 000 $ :

| Palier | Ligne de date | Frais Stripe induits | Net pour Nota |
| --- | ---: | ---: | ---: |
| `rapide` | +50 $ | +59,45 $ | **−9,45 $** |
| `prioritaire` | +100 $ | +118,90 $ | **−18,90 $** |
| `urgence` | +200 $ | +150,80 $ | +49,20 $ |
| `extrême` | +300 $ | +182,70 $ | +117,30 $ |

Nota était plus pauvre sur l'acte le plus pressé que sur un acte calme. La
marge brute tombait de 73,7 % au standard à 47,2 % au prioritaire, sur le
service où Nota travaille le plus.

## Décision

**La garantie de date est retarifée pour couvrir les frais qu'elle induit et
garder à Nota la marge d'une date calme.** Trois règles, toutes tenues par
`packages/domain/test/prix-nota-garantie-de-date.test.mjs` :

1. au multiple recommandé du palier, la ligne de date couvre les frais de carte
   qu'elle induit, sur le plancher du catalogue et jusqu'au sommet de la bande,
2. la marge brute de Nota par acte monte avec l'urgence, jamais l'inverse,
3. le taux de prise d'un acte pressé reste sous celui d'un acte calme du même
   service : acheter une date ne rend jamais Nota plus lourde.

| Palier | Délai | Avant | **Après** |
| --- | --- | ---: | ---: |
| `standard` | 15 j et plus | 0 $ | **0 $** |
| `rapide` | ≤ 14 j | 50 $ | **149 $** |
| `prioritaire` | ≤ 7 j | 100 $ | **299 $** |
| `urgence` | ≤ 1 j | 200 $ | **449 $** |
| `extrême` | jour même | 300 $ | **549 $** |

L'échelle monte de 150 $ par barreau. Le jour même monte de 100 $ seulement,
parce que la règle 3 y bute : à 599 $, un financement signé le jour même
pèserait 9,98 % du total, contre 9,95 % sur une date calme.

Le taux de Stripe n'est écrit nulle part dans le code et le code ne le
comptabilise jamais. Le test le pose comme hypothèse de modèle, au taux publié
pour une carte canadienne (2,9 % + 0,30 $). Le jour où il change, ce fichier est
le seul endroit à corriger, et la grille se relit contre lui.

### Effet, au multiple recommandé de chaque palier

| Service · palier | Honoraires | Prix de Nota | Total client | Stripe | Marge brute | % | Taux de prise |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `financement` · standard | 1 800 $ | 199 $ | 1 999 $ | 58,27 $ | 140,73 $ | 70,7 % | 10,0 % |
| `financement` · rapide | 3 600 $ | 348 $ | 3 948 $ | 114,79 $ | 233,21 $ | 67,0 % | 8,8 % |
| `financement` · prioritaire | 5 400 $ | 498 $ | 5 898 $ | 171,34 $ | 326,66 $ | 65,6 % | 8,4 % |
| `financement` · urgence | 6 300 $ | 648 $ | 6 948 $ | 201,79 $ | 446,21 $ | 68,9 % | 9,3 % |
| `financement` · extrême | 7 200 $ | 748 $ | 7 948 $ | 230,79 $ | 517,21 $ | 69,1 % | 9,4 % |
| `refinancement` · standard | 2 000 $ | 249 $ | 2 249 $ | 65,52 $ | 183,48 $ | 73,7 % | 11,1 % |
| `refinancement` · rapide | 4 000 $ | 398 $ | 4 398 $ | 127,84 $ | 270,16 $ | 67,9 % | 9,0 % |
| `refinancement` · prioritaire | 6 000 $ | 548 $ | 6 548 $ | 190,19 $ | 357,81 $ | 65,3 % | 8,4 % |
| `refinancement` · urgence | 7 000 $ | 698 $ | 7 698 $ | 223,54 $ | 474,46 $ | 68,0 % | 9,1 % |
| `refinancement` · extrême | 8 000 $ | 798 $ | 8 798 $ | 255,44 $ | 542,56 $ | 68,0 % | 9,1 % |

Chaque barreau est désormais net pour Nota, sur le refinancement : +86,68 $ au
rapide, +174,33 $ au prioritaire, +290,98 $ à l'urgence, +359,08 $ à l'extrême.

**En moyenne pondérée**, sur le mélange que le plan d'affaires modélise
(60 % refinancement, 40 % financement, 70 % standard, 18 % rapide,
7 % prioritaire, 3 % urgence, 2 % extrême) :

| Par acte complété | Avant | **Après** |
| --- | ---: | ---: |
| Revenu de Nota | 257 $ | **301 $** |
| Frais de carte | (89) $ | (90) $ |
| Marge brute de Nota | 168 $ | **211 $** |
| Marge brute | 66 % | **70 %** |

Le seuil de rentabilité passe de 1 487 à **1 184 actes** en an 1, de 4 280 à
**3 410** en an 2, de 10 997 à **8 762** en an 3, à charges égales.

## Pourquoi cette forme ne rouvre aucun mur

Le prix dépend toujours du service et du délai, deux dimensions publiées que le
client connaît avant d'offrir, et de rien qui touche au notaire. La signature
`prixNota(serviceId, tierId, grille)` n'a pas changé. Aucun argument ne porte un
notaire, une cote ou un montant, et le test d'arité de l'ADR 0034 le tient
toujours.

La ligne reste distincte des multiplicateurs qui la côtoient. Les
multiplicateurs font monter les honoraires du notaire, au titre de l'art. 49 4°
du Code de déontologie. La ligne de date est ce que Nota vend : trouver un
notaire à courte échéance et tenir la date. Deux objets, deux lignes sur le
devis.

La règle 3 est ce qui garde la grille non régressive : un client qui achète une
date paie la date, et rien de plus que sa part. Au prioritaire, Nota pèse
8,4 % du total sur les deux services, contre 10,0 % et 11,1 % sur une date calme.

## Ce qui ne change pas

- Les lignes de service : 199 $ financement, 249 $ refinancement. Le « à partir
  de 199 $ » du héros est intact.
- Le devis figé (ADR 0034) : une offre dont la carte a été autorisée avant ce
  jour se règle sur les deux lignes qu'elle a lues, jamais sur la grille du jour.
- La console admin : la grille reste une donnée, éditable cellule par cellule.
  Une grille stockée par l'opérateur l'emporte toujours sur le catalogue. Après
  le déploiement, vérifier à l'écran Prix qu'aucune cellule stockée ne rejoue
  l'ancienne échelle.

## Ce que cet ADR ne règle pas

1. **Le coût structurel demeure.** Nota paie Stripe sur les honoraires du
   notaire, un argent qu'elle ne garde jamais. C'est 58 à 255 $ par acte, plus
   que tout ce que la grille rapporte à un barreau. La sortie est un flux où le
   client paie le notaire directement et Nota ne porte les frais que sur sa
   propre ligne. Ce flux change ce que « 100 % de votre offre » veut dire pour
   le notaire, qui porterait alors ses propres frais de carte. C'est une
   décision du propriétaire, avec l'avis juridique écrit toujours requis.
2. **Une ligne fixe ne couvre pas tout.** Au plafond de 5× sur la base la plus
   haute du catalogue (4 300 $), le barreau induit jusqu'à 499 $ de frais. La
   grille couvre le catalogue au multiple recommandé et au sommet de chaque
   bande, pas les offres extrêmes. Elles restent rentables au total, moins
   qu'une date calme.
3. **Les lignes de service ne sont pas revalidées.** Une hausse à 229 $ et
   279 $ ajouterait environ 29 $ de marge brute par acte (soit 240 $), à
   11,3 % et 12,2 % du total, toujours sous Airbnb et sous les 295 $ de Notairo.
   Elle échange de la conversion contre de la marge sans aucune transaction pour
   arbitrer. Non prise ici.
4. **Le mélange des paliers est une hypothèse.** La moyenne pondérée ci-dessus
   sera refaite sur les paliers réellement retenus.

## Conséquences

- `packages/domain` : `prixNotaDateCents` sur chaque palier de `TIERS`, et le
  test des trois règles.
- BDD : `caution`, `cote`, `deontologie`, `plancher_plafond`, `reglement`,
  `tarification` portent les nouveaux totaux (un refinancement au prioritaire
  autorise 2 548 $, Nota garde 548 $).
- `apps/admin/test/prix.test.mjs` : la grille du déploiement dans les fixtures.
- Documents : README, plan d'affaires, sommaire, kit de validation, courriels
  et scripts d'entrevue disent la même échelle.
