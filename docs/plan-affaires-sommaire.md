# Nota — Sommaire exécutif

**Le marché du temps notarial au Québec.**

Ronde : **250 000 $ CAD en préamorçage**, 12 mois · Août 2026
Anthony Paquet — anthonypaquet1508@gmail.com
Plan complet (anglais) : [`docs/business-plan.md`](business-plan.md)

---

## L'idée

Le Québec a aboli les tarifs notariaux obligatoires en **1991**. Depuis
trente-cinq ans, les honoraires sont libres — et **aucun mécanisme de
découverte des prix n'a jamais vu le jour**. Le client qui a besoin d'une
signature mardi prochain ignore ce que vaut mardi prochain. Le notaire dont le
mardi est vide n'a nulle part où le vendre.

**Nota est ce mécanisme.** Le client affiche la date à laquelle il veut signer
son acte et le montant qu'il offre. Les notaires consultent un calendrier public
— le *carnet* — et retiennent le travail qui cadre avec leur horaire. Comme
l'offre est rattachée à une date, **le marché prix l'urgence** : une signature
requise demain se règle à un multiple d'une signature requise dans trois
semaines.

| Palier | Jours avant la date | Prime indicative |
| --- | --- | --- |
| `standard` | 15+ | 1,0×–1,2× |
| `rapide` | 8–14 | 1,2×–1,5× |
| `prioritaire` | 4–7 | 1,6×–2,2× |
| `urgence` | 2–3 | 2,5×–4,0× |
| `extreme` | 0–1 | 4,0×–10,0× |

Trois services au lancement, chacun avec une collecte de documents **bornée**
que le client assemble seul : testament et mandat de protection (650 $),
procuration (295 $), refinancement hypothécaire (2 000 $). Plancher par service,
plafond ferme à **10×**.

---

## Ce qui existe déjà

**Le produit est construit, testé et déployé.** Environ 21 000 lignes, en solo :

- un noyau de règles d'affaires **sans aucune dépendance** (prix, paliers,
  plafond, validation, tarification dynamique) ;
- une API HTTP sur Lambda et DynamoDB table unique, en **architecture
  hexagonale** (ports et adaptateurs) ;
- une application web publique **sans dépendance d'exécution** — carnet, dépôt
  d'offre, dossier, carte du Québec, console notaire ;
- paiements Stripe (autorisation à l'offre, capture à la complétion),
  authentification notaire et admin, courriels transactionnels et rappels
  planifiés, flux ICS, statistiques ;
- infrastructure Terraform **en production sur AWS `ca-central-1`**, coût au
  repos ≈ 0 $ ;
- suite de tests unitaires, DOM et **BDD Cucumber**, CI sur chaque poussée ;
- conformité **Loi 25** par conception : hébergement au Canada, anonymat activé
  par défaut, consentement à la collecte ;
- sept décisions d'architecture (ADR) documentées.

**Cette ronde ne finance pas un développement. Elle finance la distribution et
la liquidité.**

---

## Deux constats qui structurent le plan

### 1. L'acte à distance est déjà légal — et c'est une bonne nouvelle

L'*acte notarié technologique* signé par visioconférence est **permanent** depuis
la Loi 34 (en vigueur le 24 octobre 2023). Les rails existent et sont encadrés :
canal de visioconférence prescrit, signature numérique officielle du notaire,
minute technologique. **Nota n'a pas à faire créer un instrument juridique ni à
attendre un régulateur** — cela retire des années et des centaines de milliers de
dollars à la phase 2.

Mais l'**article 46** de la *Loi sur le notariat* n'autorise la signature à
distance qu'**exceptionnellement** : la demande doit venir d'une **partie**, et
la circonstance justificative doit lui être **propre** (éloignement d'un notaire
disponible, état de santé, limitation fonctionnelle, intempérie, imprévu
préjudiciable). **La commodité ne suffit pas.**

Le véritable frein n'est donc ni la technologie ni le droit : **c'est que le
fardeau de justification et le risque déontologique reposent entièrement sur le
notaire**, qui choisit par défaut le présentiel — la seule option qui ne génère
jamais de plainte.

**C'est un produit.** Nota recueille la demande de la partie, qualifie la
circonstance, réunit la preuve et joint au dossier un **registre de
justification horodaté et vérifiable**. Le notaire reçoit un dossier déjà
défendable. On transforme un jugement discrétionnaire risqué en flux de travail
standard.

### 2. Le modèle de revenus doit être restructuré avant le lancement

Le code implémente aujourd'hui une **commission de 10 %** prélevée sur les
honoraires du notaire. C'est la forme classique du **partage d'honoraires** que
le *Code de déontologie des notaires* interdit avec un non-notaire, et cela
exposerait chaque notaire de la plateforme à une plainte disciplinaire.

**La correction préserve l'économie et change entièrement la structure
juridique : facturer le client, pas le notaire.**

| | Actuel (à risque) | Proposé (conforme) |
| --- | --- | --- |
| Le client paie | 650 $ | 650 $ + 65 $ de frais de service = **715 $** |
| Le notaire reçoit | 585 $ (90 %) | **650 $ (100 %)** |
| Nota reçoit | 65 $ *pris sur les honoraires* | 65 $ *du client, pour son propre service* |

Nota est payé par le client pour le travail que Nota exécute réellement :
trouver le notaire, monter et valider le dossier, opérer la transaction et le
séquestre. **Nota ne prend aucune part d'un honoraire professionnel.** Les
honoraires du notaire lui reviennent intégralement.

**20 000 $ sont budgétés** pour un avis déontologique écrit et un dialogue
structuré avec la Chambre des notaires **avant** le premier acte.

---

## Le marché

| | Volume annuel estimé | Valeur d'acte |
| --- | ---: | ---: |
| Testaments et mandats | ~200 000 inscriptions | ~130 M$ |
| Procurations | ~50 000 | ~15 M$ |
| Refinancements | ~50 000 | ~100 M$ |
| **Marché adressable (3 services)** | **~300 000 actes** | **~245 M$** |

La profession compte environ **3 900 notaires** et facture de l'ordre de
**1,1 à 1,2 G$** par année. Au-delà des trois services : les transactions
immobilières résidentielles (~90 000 par année, 1 500–3 500 $ chacune) — à elles
seules plus grandes que le marché adressable actuel. Au-delà du Québec : le
notariat de droit civil, soit environ **90 États membres** de l'Union
internationale du notariat, tous bâtis sur le même instrument.

**Pourquoi maintenant :** les honoraires sont libres depuis 1991 sans aucun
mécanisme de prix ; l'acte technologique est permanent depuis 2023 ; ~1,2 M
d'hypothèques à taux fixe se renouvellent au Canada en 2025 ; **environ la
moitié des adultes québécois n'ont pas de testament** (près de 70 % chez les
18–34 ans) au moment du plus grand transfert de patrimoine de l'histoire.

---

## Phases

**Phase 1 — Le prix du temps.** Prouver qu'un marché notarial tarifé au temps se
règle, dans une ville, avec de l'argent réel. Québec (RMR de ~850 000 personnes,
~400 notaires) : assez petit pour rencontrer l'offre en personne, assez dense
pour atteindre la liquidité. **L'indicateur unique : le taux de rétention** — la
part des offres qu'un notaire retient.

L'actif produit par la phase 1 n'est pas le revenu : c'est **la seule courbe
existante prix réalisé × jours avant la date × type d'acte** au Québec.
Personne ne peut la reconstituer sans opérer le même marché pendant la même
année.

**Phase 2 — L'acte sans le déplacement.** Retirer la géographie comme contrainte
d'appariement. Un client de Québec est aujourd'hui apparié à ~400 notaires ; si
la signature n'exige pas la même pièce, il est apparié à ~3 900 — et le notaire
de Rimouski vend son jeudi vide à un client de Gatineau. **Le marché ne devient
pas 10× plus grand parce que le client évite un déplacement. Il devient 10× plus
liquide parce que l'offre et la demande cessent d'être cloisonnées par code
postal.**

Livrables : la couche d'exception (art. 46), l'automatisation du dossier, les
rails de signature, l'appariement provincial, puis le corridor transfrontalier
vers les notaires UINL pour les Québécois à l'étranger.

**La phase 2 est conçue pour être pleinement rentable sous la loi actuelle.** Un
assouplissement de l'article 46 est un gain additionnel, pas une hypothèse du
plan.

---

## Projections

| | An 1 | An 2 | An 3 |
| --- | ---: | ---: | ---: |
| Notaires | 30 | 220 | 700 |
| Offres déposées | 434 | 4 912 | 17 742 |
| Taux de rétention | 56 % | 57 % | 62 % |
| **Actes complétés** | **244** | **2 800** | **11 000** |
| **Valeur transigée** | **257 664 $** | **3 220 000 $** | **15 950 000 $** |
| **Revenu net (10 %)** | **25 766 $** | **322 000 $** | **1 595 000 $** |
| Résultat net | (226 959) $ | (430 060) $ | (390 850) $ |

L'an 3 représente **~3,7 %** du volume d'actes adressable. Le plan n'exige pas de
dominer le marché — seulement d'être l'endroit où le prix se découvre.

**Déclencheur de la série A :** sortir de l'an 2 à un rythme annualisé de
300–500 K$, avec l'appariement provincial et la couche d'exception en
production.

---

## Emploi des fonds — 250 000 $ sur 12 mois

| Poste | Montant |
| --- | ---: |
| Salaire du fondateur (8 000 $/mois) | 96 000 $ |
| Juridique — avis déontologique, Chambre, constitution, CGU, programme Loi 25 | 20 000 $ |
| Notaire-conseil (temps partiel, en exercice) | 25 000 $ |
| Design et front-end (contrat, ~3 mois) | 25 000 $ |
| Acquisition clients | 40 000 $ |
| Acquisition notaires (terrain, congrès) | 15 000 $ |
| Infrastructure, Stripe, certificats, assurances, outils | 12 000 $ |
| Imprévus (~7 %) | 17 000 $ |
| **Total** | **250 000 $** |

**Levier non dilutif :** à titre de SPCC québécoise avec développement
admissible, les crédits **RS&DE** remboursables et le crédit québécois sur les
salaires de R-D peuvent récupérer une part appréciable du poste salarial —
traité prudemment comme prolongation de piste (2–3 mois), non comme revenu.

**Suite du financement :** le **Fonds Impulsion** d'Investissement Québec
investit 250 K$ à 1 M$ en préamorçage et amorçage, mais exige un **investisseur
principal** et une **référence** d'un accélérateur reconnu ou d'Anges Québec.
Obtenir un ange principal et une relation d'accélérateur (Le Camp à Québec,
Centech) dans la présente ronde est donc le pont vers l'amorçage.

---

## Ce qui doit être vrai

Trois hypothèses portent le modèle, chacune avec son test de réfutation — **et
les trois sont tranchées à l'intérieur de cette ronde** :

1. **Le client paie une prime pour une date.** *Test :* la distribution des
   primes réalisées par palier. Visible au 6ᵉ mois.
2. **Le notaire vend sa disponibilité de dernière minute.** *Test :* le taux de
   rétention sur les paliers `prioritaire` et `urgence`. Visible au 5ᵉ mois.
3. **Les frais côté client sont déontologiquement sûrs.** *Test :* un avis
   juridique écrit. 2ᵉ mois.

C'est l'argument pour la taille de la ronde : 250 000 $ suffisent à confirmer ou
à réfuter la thèse entière, et pas un dollar ne construit ce qui n'a pas été
validé.

---

## Risques principaux

| Risque | Atténuation |
| --- | --- |
| **Partage d'honoraires (déontologie)** — critique | Restructuration en frais côté client avant le lancement. Avis écrit budgété, 2ᵉ mois. Le notaire conserve 100 % de ses honoraires. |
| **L'art. 46 maintient l'exception** | La phase 2 est rentable sous la loi actuelle. Les catégories d'exception sont vastes et mal desservies. |
| **Démarrage à froid** | L'offre est gratuite et sans friction. Une ville dense d'abord. Taux de rétention suivi chaque semaine. |
| **Faible réachat client** | L'actif durable est l'offre (notaires récurrents), la capture organique du carnet et les canaux de référence à coût nul. |
| **Opposition de la Chambre** | Dialogue précoce, écrit, en posture de partenariat. Nota ne touche jamais l'acte ni ne partage d'honoraires : c'est de la génération de demande pour la profession. |
| **Risque d'homme-clé** | ADR, spécifications exécutables BDD, embauche d'un second développeur tôt en an 2. |

---

## La demande

**250 000 $ CAD en préamorçage, 12 mois.** SAFE ou billet convertible, avec un
ange principal.

Ce que l'argent achète : une structure déontologiquement propre avec avis écrit
au dossier ; 30 notaires et un marché biface fonctionnel à Québec ; 244 actes
complétés et **la première courbe d'urgence du marché notarial québécois** ; la
couche d'exception qui rend l'acte à distance routinier là où la loi le permet
déjà ; et douze mois d'un fondateur qui a bâti la plateforme entière et qui ne
fera plus que cela.

> **En une phrase :** le Québec a déréglementé les honoraires notariaux en 1991
> et n'a jamais bâti de marché. Le marché est bâti. Cette ronde sert à savoir
> s'il se règle.
