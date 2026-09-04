# 0034 — Le prix de Nota est une grille par service, pas un nombre unique

Date : 2026-09-03

Statut : accepté — **précise l'ADR 0031 ; n'en retire rien**

> **Ce qui survit de l'ADR 0031.** Les deux lignes, et tout ce qui les tient :
> le notaire reçoit 100 % du montant offert, Nota vend son propre service à son
> propre prix, à côté et jamais dedans. Le prix ne dépend toujours ni du
> notaire, ni de sa cote, ni de la valeur de l'acte.
>
> **Ce qui change.** Ce prix cesse d'être **un** nombre pour devenir une
> **grille** : une ligne par service, plus la garantie de date sur sa propre
> ligne.

## Contexte

L'ADR 0031 a mis Nota du bon côté des quatre murs en remplaçant un pourcentage
par un prix fixe. Le prix retenu — 400 $, `DEFAULT_PRIX_CENTS = 40000` — n'a
jamais été calculé : c'était le nombre rond qui permettait d'écrire l'ADR. Une
veille menée le 3 septembre l'a mesuré, et le nombre rond tient mal.

> **Sources, et ce que le dépôt en porte.** Les notes brutes de cette veille ne
> sont PAS dans le dépôt : ne cherchez pas de fichier, il n'y en a pas. Chaque
> chiffre ci-dessous est donc donné avec sa source PRIMAIRE, vérifiable
> directement, plutôt qu'avec un renvoi interne :
>
> - **Notairo, 295 $** — le catalogue Shopify public de notairo.com
>   (`/products.json`), produit « Frais de prise en charge de dossier », relevé
>   le 2026-09-03. Le dépôt en porte le portrait général dans
>   `docs/go-to-market/concurrence.md` (§ « Notairo — le plus proche »), qui
>   documente l'offre affichée à 949 $ + débours, pas cette ligne-ci.
> - **Airbnb, 13,6 %** et **Upwork, 18,0 %** — les taux de prise publiés par
>   ces plateformes (frais voyageur + hôte pour la première, barème unique de
>   la seconde), au 2026-09-03.
> - Le **calcul** de chaque pourcentage, lui, est reproductible sans aucune
>   source externe : il est rejoué cellule par cellule dans
>   `packages/domain/test/prix-nota-grille.test.mjs`.

**Un prix unique posé sur un catalogue d'actes inégaux est régressif.** À 400 $ :

| Acte | Total client | Poids de Nota |
| --- | --- | --- |
| Financement 1 800 $ | 2 200 $ | **18,2 %** |
| Refinancement 2 000 $ | 2 400 $ | **16,7 %** |
| Refinancement 2 400 $ | 2 800 $ | 14,3 % |

Plus l'acte est petit, plus Nota pèse — exactement à l'envers de ce que Nota
apporte, puisqu'un petit acte lui demande moins de travail. En taux, cela place
Nota **au-dessus d'Airbnb (13,6 %) et au niveau d'Upwork (18,0 %)**, dans la
zone haute des places de marché, pour un service d'intermédiation.

**Le comparable direct vend le même service moins cher.** Le catalogue Shopify
de Notairo (`products.json`, relevé le 3 septembre) porte un produit
« *Frais de prise en charge de dossier* » à **295 $**, décrit comme la prise en
charge du dossier, la coordination avec le notaire instrumentant et le suivi
jusqu'à la signature — les honoraires du notaire étant « payables directement au
notaire lors du rendez-vous de signature ». C'est la structure de l'ADR 0031,
déjà adoptée par le marché québécois, à un prix inférieur : **400 $ contre
295 $, soit +35,6 % en défaveur de Nota** (105 $ ÷ 295 $).

> **Attention en citant ce chiffre.** 295 $ n'est pas « 35 % sous 400 $ » — ce
> serait 260 $. L'écart se lit dans les deux sens et ne donne pas le même
> pourcentage : Nota est **+35,6 % au-dessus** de Notairo (105 ÷ 295), Notairo
> est **26,3 % sous** Nota (105 ÷ 400). La confusion des deux a déjà été
> attrapée une fois en relecture ; elle ne doit pas revenir.

## Décision

**Le prix de Nota devient une grille fixe par service.** Elle vit dans
`packages/domain` avec le catalogue qu'elle tarife, et elle porte deux
dimensions — et seulement deux.

**1. Une ligne par service** (`prixNotaCents` sur chaque entrée de `SERVICES`) :

| Service | Prix de Nota |
| --- | --- |
| `financement` — Financement hypothécaire | **199 $** |
| `refinancement` — Refinancement hypothécaire | **249 $** |

L'acte le plus substantiel porte la ligne la plus haute parce que Nota y fait
davantage : plus de documents à réunir, un prêteur à relancer, un titre à faire
vérifier. Un service hors catalogue retombe sur la cellule **la plus basse** —
Nota ne peut jamais facturer plus que ce qu'elle a publié pour un service
qu'elle ne sait pas nommer (art. 68 C.déont., publicité incomplète).

**2. La garantie de date, sur sa propre ligne** (`prixNotaDateCents` sur chaque
palier de `TIERS`) :

| Palier | Délai | Garantie de date |
| --- | --- | --- |
| `standard` | 15 j et plus | **0 $** |
| `rapide` | ≤ 14 j | 50 $ |
| `prioritaire` | ≤ 7 j | 100 $ |
| `urgence` | ≤ 1 j | 200 $ |
| `extreme` | jour même | 300 $ |

**Cette ligne est un objet distinct des multiplicateurs qui la côtoient, et
c'est le point le plus important de cet ADR.** Les multiplicateurs (×1 → ×4)
font monter les **honoraires du notaire** : l'art. 49 4° du *Code de
déontologie* autorise expressément le notaire à tenir compte, dans **ses**
honoraires, de « la prestation de services inhabituels ou exigeant une
compétence particulière ou une **célérité exceptionnelle** ». La ligne
ci-dessus est autre chose : c'est ce que **Nota** vend — trouver un notaire à
courte échéance et tenir la date. Deux objets, deux justifications, **deux
lignes sur le devis**. Un seul nombre qui ferait les deux travaux serait, quel
que soit son nom, une part variable prélevée sur un acte notarié.

`prixNota(serviceId, tierId, grille)` rend `{ serviceCents, dateCents,
totalCents }` et c'est le **seul** endroit où un prix de Nota se calcule. Ni
l'API ni l'écran ne refont cette arithmétique.

### Effet sur le taux de prise

Le taux de prise est le prix de Nota divisé par le total que le client paie.

| Acte | Palier | Avant (400 $) | Après | Taux avant | Taux après |
| --- | --- | --- | --- | --- | --- |
| Financement 1 800 $ | standard | 2 200 $ | 199 $ → **1 999 $** | 18,2 % | **10,0 %** |
| Refinancement 2 000 $ | standard | 2 400 $ | 249 $ → **2 249 $** | 16,7 % | **11,1 %** |
| Refinancement 2 400 $ | standard | 2 800 $ | 249 $ → **2 649 $** | 14,3 % | **9,4 %** |
| Refinancement 6 000 $ | urgence | 6 400 $ | 249 + 200 $ → **6 449 $** | 6,3 % | **7,0 %** |

Les trois premières lignes descendent sous Airbnb. **La quatrième monte**, et il
faut le dire : quand le client achète une date, il paie la date. La grille n'est
pas un rabais général, c'est un prix qui suit ce qui est vendu.

### Marge brute après Stripe

La session Checkout est sur le compte de Nota : Stripe prélève ≈ 2,9 % + 0,30 $
sur le **total client**, honoraires du notaire compris. Ce coût ne bouge donc
pas quand la ligne de Nota rétrécit — il la ronge.

| Acte | Total client | Stripe | Revenu Nota | Marge brute |
| --- | --- | --- | --- | --- |
| Financement 1 800 $ standard | 1 999 $ | 58,27 $ | 199 $ | **70,7 %** |
| Refinancement 2 000 $ standard | 2 249 $ | 65,52 $ | 249 $ | **73,7 %** |
| Refinancement 2 400 $ standard | 2 649 $ | 77,12 $ | 249 $ | **69,0 %** |
| Refinancement 6 000 $ urgence | 6 449 $ | 187,32 $ | 449 $ | **58,3 %** |
| *Rappel — ADR 0031, refi 2 000 $* | *2 400 $* | *69,90 $* | *400 $* | *82,5 %* |

**La grille coûte 9 à 24 points de marge brute.** C'est le prix assumé de la
décision, et c'est le chiffre à surveiller : Nota passe d'une marge de place de
marché (82 %, niveau Airbnb/Fiverr) à une marge de service (58–74 %, niveau
LegalZoom). La sortie n'est pas d'augmenter la grille mais de **cesser de payer
Stripe sur les honoraires du notaire** — un compte Connect où le client paie le
notaire directement laisserait à Nota les frais de sa seule ligne. Ce chantier
n'est pas ouvert (voir « Ce que cet ADR ne règle pas »).

## Pourquoi cette forme ne rouvre aucun des quatre murs

Les quatre textes sont cités mot pour mot dans
`docs/legal/code-deontologie-notaires-texte-officiel.md`.

- **Art. 32.1 2° de la *Loi sur le notariat*** — « obtient d'un notaire qu'il
  abandonne une partie de ses honoraires et frais ». La grille ne touche pas
  aux honoraires : elle décide de ce que **Nota** facture au **client**, à
  côté. Le net viré au notaire reste, au cent près, le montant qui lui a été
  offert. Baisser le prix de Nota ne prend rien à personne.
- **Art. 32 C.déont.** — le partage d'honoraires. Il n'y a toujours rien à
  partager : la grille est un prix de vente, pas une part.
- **Art. 33 C.déont.** — « verser ou recevoir tout autre avantage ». La grille
  ne donne rien à un notaire et ne lui prend rien. Un notaire ne paie pas
  Nota ; un notaire ne reçoit pas de Nota.
- **Art. 29.1 C.déont.** — aucune convention mettant en péril l'indépendance et
  le désintéressement. **C'est le mur que la grille aurait pu rouvrir, et la
  forme retenue est ce qui l'en empêche.** La grille dépend du **service** et du
  **délai** : deux dimensions publiées, que le client connaît avant d'offrir, et
  qui ne passent par aucun notaire. Elle ne dépend ni de la cote, ni de
  l'historique du notaire, ni de la valeur de l'acte. Il n'existe aucun argument
  par lequel un notaire pourrait entrer dans le calcul — c'est la signature de
  `prixNota(serviceId, tierId, grille)` qui le garantit, et un test le tient.

## Conséquences

**Ce qui change dans le code.**

- `packages/domain` : `prixNotaCents` sur chaque service, `prixNotaDateCents`
  sur chaque palier, `prixNotaGrille(source)` (normalisation) et
  `prixNota(serviceId, tierId, grille)` (le calcul). Le mot « commission »
  n'apparaît toujours nulle part.
- `apps/api/src/prix-nota-config.js` : `envDefaults` accepte `NOTA_PRIX_GRILLE`
  (JSON) **et** l'ancien `NOTA_PRIX_CENTS` ; `validatePrix` accepte l'ancien
  corps `{ prixCents }` **et** le nouveau `{ services, garantieDate }` ;
  `resolveGrille` reste la résolution **unique**, partagée par la tarification
  et par l'annonce — annoncer un prix et en facturer un autre serait la
  publicité incomplète de l'art. 68.
- `handler.js` : `tarifNota()` sert la grille entière plus un
  `prixNotaMinCents` annoncé comme un plancher (« à partir de »), jamais comme
  le prix d'un devis. L'autorisation de la carte porte la cellule exacte.
- `apps/web` : le devis montre quatre lignes — honoraires, prix de Nota pour ce
  service, garantie de date **quand elle se paie**, total autorisé sur la carte
  — et la revendication « Le notaire garde 100 % de ses honoraires. » là où le
  client décide.
- `apps/admin` : l'écran Prix édite la grille cellule par cellule.

**Le devis autorisé est figé sur l'offre, et c'est lui qu'on capture.** La
grille est vivante — la console la change quand Nota le décide, et c'est le but.
L'autorisation, elle, ne l'est pas : la carte du client est bloquée pour **un**
total, une fois, avant qu'il ne s'engage. Les deux lignes de Nota sont donc
écrites sur l'enregistrement de l'offre au moment de l'autorisation
(`prixNotaServiceCents`, `prixNotaDateCents`) et rejouées telles quelles au
règlement (`domain.prixNotaFige`). Une grille relue au moment de la capture se
casserait dans les deux sens : **à la hausse**, Stripe refuse une capture
supérieure à son autorisation — l'acte reste retenu et impayé alors que la
signature a eu lieu ; **à la baisse**, l'écart entre le prix annoncé et le prix
facturé est exactement la publicité « incomplète » de l'art. 68. Une offre sans
devis figé — publiée sans carte, ou d'avant cet ADR — se tarife encore sur la
grille en vigueur.

**Une cellule stockée hors catalogue est écartée seule, jamais la grille
entière.** L'écriture est stricte (un id inconnu vaut un 422 : l'opérateur doit
voir sa faute de frappe) ; la **lecture** est tolérante. Le catalogue a déjà
rétréci une fois — testament et procuration retirés au pivot
financement-d'abord — et une grille écrite la veille aurait alors emporté toutes
les décisions encore valides, sans un mot, la console affichant « aucun prix
enregistré » pendant que la ligne dormait en base. Les cellules écartées sont
journalisées et nommées dans la console (`ignorees`).

**Les deux variables d'environnement ne se composent jamais.** Dès que
`NOTA_PRIX_GRILLE` porte une grille lisible, elle décide seule et
`NOTA_PRIX_CENTS` est ignoré — même règle qu'au stockage, où `validatePrix`
écarte déjà `prixCents` en présence de `services`/`garantieDate`. Les composer
ferait le dégât qu'un opérateur ne verrait pas : ajouter une grille pour
corriger **un** service forcerait toutes les garanties de date à zéro (c'est ce
que `{ prixCents }` veut dire) et laisserait les autres services à l'ancien prix
unique.

**La rétro-compatibilité est une exigence, pas une politesse.** Une
configuration stockée avant le 3 septembre porte `{ prixCents: 40000 }`. Elle
doit continuer de tarifer **exactement** ce qu'elle tarifait la veille : ce prix
s'applique à tous les services, **sans ligne de garantie de date** — une
migration qui ajouterait silencieusement la date changerait ce qu'un opérateur a
décidé. Un test le prouve.

## Ce que cet ADR ne règle pas

1. **La régression n'est pas éliminée, elle est bornée.** Entre services, elle
   disparaît : le petit acte ne porte plus la même ligne que le gros. À
   l'intérieur d'un service, 249 $ pèsent encore plus sur un refinancement de
   1 500 $ que sur un de 3 000 $. Un prix fixe fait cela par nature ; le
   corriger davantage demanderait des paliers par valeur d'acte, ce qui
   ramènerait un prix indexé sur la valeur de l'acte — précisément ce que
   l'ADR 0031 a retiré.
2. **La marge brute recule de 9 à 24 points** et le vrai correctif — ne plus
   payer Stripe sur les honoraires du notaire — n'est pas fait.
3. **Les niveaux eux-mêmes ne sont pas validés.** 199 $ et 249 $ se lisent
   contre Notairo (295 $) et contre le poids visé de 10–12 % ; aucune
   transaction ne les soutient. Ils sont administrables pour cette raison.
4. **L'avis juridique écrit demeure requis**, avec les trois questions de
   l'ADR 0031 intactes. Cet ADR n'y ajoute pas de question nouvelle : il ne
   crée aucun lien entre le prix et un notaire.

## Alternatives écartées

- **Baisser le prix unique à 295 $ pour égaler Notairo.** Corrigerait le niveau
  sans corriger la forme : le prix resterait le même sur un acte de 1 800 $ et
  sur un de 4 000 $, donc toujours régressif, et Nota s'alignerait sur un
  concurrent au lieu de tarifer son propre travail.
- **Un pourcentage plafonné du total client.** Réglerait la régression
  parfaitement, et rouvrirait le mur : un prix indexé sur la valeur de l'acte
  est ce que l'ADR 0031 a retiré, et l'habiller d'un plafond ne change pas sa
  nature.
- **Fondre la garantie de date dans le prix du service.** Plus simple à
  afficher, et faux : le client qui signe dans trente jours paierait la célérité
  qu'il n'a pas demandée, et la ligne unique deviendrait indiscernable de la
  prime d'urgence que l'art. 49 4° réserve au notaire.
- **Tarifer par notaire** (une remise au notaire bien coté, un prix plus haut
  quand la demande est forte). Écarté sans discussion : art. 29.1.
