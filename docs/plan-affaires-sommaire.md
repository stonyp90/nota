# Nota — Sommaire exécutif

**Le marché du temps notarial au Québec.**

Ronde : **250 000 $ CAD en préamorçage**, 12 mois · Version 1.1 — 4 septembre 2026
Anthony Paquet — anthonypaquet1508@gmail.com
Plan complet (anglais) : [`docs/business-plan.md`](business-plan.md)

> **Ce qui a changé en 1.1.** La version 1.0 décrivait une **commission de 10 %
> sur les honoraires du notaire** comme ce que le code faisait, et proposait de
> la restructurer. Cette commission est **retirée du produit**, pas seulement
> proposée au retrait : Nota facture au client **son propre prix, publié par
> service**, et les honoraires du notaire lui reviennent en entier. Tous les
> chiffres ont été recalculés sur la grille en vigueur dans
> `packages/domain/index.js`. **La marge brute par acte est nettement plus basse
> que ne le disait la version 1.0** — environ **66 %**, pas 89 à 91 % — parce que
> Nota supporte les frais de carte sur la **totalité** de ce que le client paie,
> honoraires du notaire compris, dont Nota ne garde rien.

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

| Palier | Jours avant la date | Prime sur les honoraires du **notaire** | Garantie de date de **Nota** |
| --- | --- | --- | ---: |
| `standard` | 15+ | 1,0× | 0 $ |
| `rapide` | 8–14 | 1,8×–2,2× (≈×2) | 50 $ |
| `prioritaire` | 2–7 | 2,7×–3,3× (≈×3) | 100 $ |
| `urgence` | 1 | 3,3×–3,7× (≈×3,5) | 200 $ |
| `extreme` | 0 | 3,7×–4,3× (≈×4) | 300 $ |

**Deux colonnes, deux justifications.** Le multiplicateur tarife les honoraires
du **notaire** — l'art. 49 4° du *Code de déontologie* lui permet de pondérer
« le degré d'urgence » — et il n'est pas figé : il s'ajuste sur la médiane des
offres réellement retenues. La colonne de droite est ce que **Nota** vend : la
garantie de la date.

Deux services au lancement, tous deux des actes de **financement**, chacun avec
une collecte de documents **bornée** que le client assemble seul :
refinancement hypothécaire (plancher 2 000 $) et financement hypothécaire
(plancher 1 800 $). Testament et procuration ont été **retirés** — un testament
n'a pas d'échéance externe, donc l'urgence y est une préférence et non un coût.
Plancher par service, plafond ferme à **5×**.

---

## Ce qui existe déjà

**Le produit est construit, testé et déployé.** Environ 40 000 lignes, en solo :

- un noyau de règles d'affaires **sans aucune dépendance** (prix, paliers,
  plafond, validation, tarification dynamique) ;
- une API HTTP sur Lambda et DynamoDB table unique, en **architecture
  hexagonale** (ports et adaptateurs) ;
- une application web publique **sans dépendance d'exécution** — carnet, dépôt
  d'offre, dossier, carte du Québec, console notaire ;
- paiements Stripe Connect : la carte est enregistrée au dépôt de l'offre, la
  caution posée quelques jours avant la signature pour qu'une autorisation de
  ~7 jours atteigne l'acte, capture à la signature puis virement des honoraires ;
  authentification notaire et admin avec permissions par rôle, courriels
  transactionnels et rappels planifiés, flux ICS, statistiques ;
- infrastructure Terraform **en production sur AWS `ca-central-1`**, coût au
  repos ≈ 0 $ ;
- suites de tests unitaires, de contrat OpenAPI, DOM, **BDD Cucumber** et
  bout-en-bout Playwright, CI sur chaque poussée, déploiement conditionné à
  leur réussite ;
- conformité **Loi 25** par conception : hébergement au Canada, anonymat activé
  par défaut, consentement à la collecte ;
- **trente-sept** décisions d'architecture (ADR) documentées — dont la séquence
  qui a démonté le modèle de revenus de la plateforme quand quatre articles du
  droit notarial québécois se sont avérés l'interdire.

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

### 2. Le modèle de revenus était un risque déontologique. Il a été retiré.

La version 1.0 rapportait que le code prélevait une **commission de 10 %** sur
les honoraires du notaire, et proposait de la restructurer. Une variante
ultérieure faisait varier ce pourcentage entre 5 % et 15 % selon une note
interne. **Les deux ont disparu du produit.** Elles ne sont rappelées ici que
pour qu'un lecteur qui les retrouve dans l'historique ou dans un audit daté
sache qu'elles sont retirées, et par quelle décision.

**Ce que le code fait aujourd'hui.** Une offre porte **deux lignes**, que le
client lit séparément avant de s'engager :

| Ligne | Qui l'encaisse | Ce qui la détermine |
| --- | --- | --- |
| **Honoraires** | **Le notaire, en entier** | Le montant offert par le client |
| **Le prix de Nota** | Nota | Une grille publiée d'avance — le service demandé, plus la garantie de date — jamais le notaire, sa cote ou la valeur de l'acte |

La grille : `financement` **199 $**, `refinancement` **249 $**, plus la garantie
de date (0 · 50 · 100 · 200 · 300 $ selon le palier). La carte du client
autorise le **total** des deux lignes sur le compte de Nota ; à la signature,
Nota capture ce total, garde ses deux lignes et vire les honoraires au compte
Connect du notaire. **Nota ne retranche rien d'un honoraire professionnel, et le
notaire n'abandonne rien.**

**Quatre textes imposent cette forme.** L'art. **32.1 2°** de la *Loi sur le
notariat* présume usurper les fonctions de notaire l'intermédiaire qui « obtient
d'un notaire qu'il abandonne une partie de ses honoraires et frais » — 2 500 à
125 000 $, doublé en récidive. L'art. **32** du *Code de déontologie* interdit au
notaire de partager ses honoraires avec un non-membre d'un ordre : la même
conclusion prise par l'autre bout. L'art. **29.1** interdit toute convention
mettant en péril l'indépendance et le désintéressement du notaire — ce qu'un
revenu indexé sur une note attribuée par une entreprise privée serait. L'art.
**32.1 3°** écarte l'intermédiaire sans responsabilité envers le notaire pour ses
honoraires : Nota autorise, capture et garantit le net, délibérément.

Décisions : [ADR 0031](decisions/0031-le-prix-de-nota-est-celui-de-nota.md) a
retiré le partage ; [ADR 0034](decisions/0034-le-prix-de-nota-est-une-grille-par-service.md)
a transformé le prix unique en grille. **Aucun notaire n'a été facturé sous
l'ancien modèle** : aucun acte n'avait encore été porté sur la plateforme.

**Ce qui reste ouvert.** La **direction** de l'argent est réglée et vérifiable
sur le fil Stripe : le client paie la plateforme. Ce qui reste ouvert est la
**qualification** juridique du prix de Nota, plus trois questions plus étroites —
l'affichage des avis (art. 70), la qualification de la cote interne, et la
présentation des prix (art. 71-72), y compris le fait que **les taxes et les
débours ne figurent dans aucune des deux lignes et n'existent nulle part dans le
produit**. **20 000 $ sont budgétés** pour un avis écrit et un dialogue structuré
avec la Chambre des notaires **avant** le premier acte.

> **Discipline de langage, en permanence.** Aucune surface, aucun document et
> aucun commentaire ne peut décrire Nota comme prenant une *commission*, une
> *part* ou un *partage* des honoraires d'un notaire ; ne peut attacher une note,
> une moyenne ou une *cote* à un notaire **nommé** sur une surface client
> (art. 70) ; ne peut prétendre coûter *moins cher qu'un notaire* (art. 32.1 1°) ;
> ni qualifier le prix de Nota de *fixe* — c'est une grille, publiée par service.

---

## Le marché

Avec un prix fixé par acte, le nombre qui compte est le **volume d'actes**, pas
les dollars qui changent de mains. Les deux sont montrés ; seule la colonne de
droite revient à Nota.

| | Volume annuel estimé | Honoraires notariaux | Revenu Nota adressable |
| --- | ---: | ---: | ---: |
| Refinancement hypothécaire | ~50 000 | ~100 M$ | ~12,5 M$ |
| Financement hypothécaire (hypothèque neuve) | ~60 000 | ~115 M$ | ~12 M$ |
| **Marché adressable (2 services)** | **~110 000 actes** | **~215 M$** | **~28 M$** |

La conséquence honnête du virage financement : le nombre d'actes adressables
vaut environ le tiers de l'ancien plan à trois services (~110 000 contre
~300 000), parce que les testaments faisaient le volume et qu'ils sont retirés.
Ce qui les remplace est une catégorie qui arrive avec une **échéance que le
client n'a pas choisie** — la seule demande qu'un marché tarifé au temps peut
facturer.

La profession compte environ **3 900 notaires** et facture de l'ordre de
**1,1 à 1,2 G$** par année. Au-delà des deux services : l'**acte de vente** sur
ces mêmes ~90 000 transactions résidentielles, qui arrive sur la même échéance
et par le même canal de référence ; les testaments et mandats (~200 000 par
année) restent une catégorie réelle où revenir une fois la liquidité acquise, sur
une base de prix adaptée à un acte de 650 $. Au-delà du Québec : le notariat de
droit civil, soit environ **90 États membres** de l'Union internationale du
notariat, tous bâtis sur le même instrument.

**Pourquoi maintenant :** les honoraires sont libres depuis 1991 sans aucun
mécanisme de prix ; l'acte technologique est permanent depuis 2023 ; ~1,2 M
d'hypothèques à taux fixe se renouvellent au Canada en 2025, **chacune avec une
garantie de taux qui expire à une date que le client n'a pas fixée** ; et un
concurrent — Notairo — vend déjà au Québec, depuis la fin de 2025, des frais de
prise en charge facturés au client (295 $), soit la même forme juridique que
celle de Nota. La structure n'est plus à expliquer ; ce qui reste à bâtir, c'est
de **publier le prix de la date avant que le client s'engage**.

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

## Économie unitaire

**Le coût des revenus n'est pas négligeable, et la version 1.0 le sous-estimait
gravement.** Nota est la **plateforme** Stripe : la carte du client est débitée
du **total des deux lignes** sur le compte de Nota, et les honoraires sont virés
au notaire ensuite. Les frais de carte portent donc sur la totalité — **y compris
les honoraires du notaire, dont Nota ne garde rien** — et Nota les supporte
seule. Au taux publié de Stripe au Canada (**2,9 % + 0,30 $** ; ce taux n'est
écrit nulle part dans le code, et le code ne comptabilise jamais ces frais) :

```
le client paie      2 000 $ (notaire) + 249 $ (Nota) = 2 249,00 $
Stripe              2,9 % × 2 249 $   + 0,30 $       =    65,52 $
Nota garde          249 $ − 65,52 $                  =   183,48 $   → marge 73,7 %
le notaire reçoit   2 000,00 $ — en entier
```

| Service · palier | Honoraires | Prix de Nota | Total client | Stripe | **Marge brute** | % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `financement` · standard | 1 800 $ | 199 $ | 1 999 $ | 58,27 $ | **140,73 $** | 70,7 % |
| `financement` · prioritaire | 5 400 $ | 299 $ | 5 699 $ | 165,57 $ | **133,43 $** | 44,6 % |
| `refinancement` · standard | 2 000 $ | 249 $ | 2 249 $ | 65,52 $ | **183,48 $** | 73,7 % |
| `refinancement` · prioritaire | 6 000 $ | 349 $ | 6 349 $ | 184,42 $ | **164,58 $** | 47,2 % |
| `refinancement` · extrême | 8 000 $ | 549 $ | 8 549 $ | 248,22 $ | **300,78 $** | 54,8 % |

**Un constat que cette table rend inévitable : deux barreaux de l'échelle
d'urgence coûtent de l'argent à vendre.** Passer un refinancement de `standard`
à `prioritaire` ajoute 100 $ à la ligne de Nota et **118,90 $** aux frais Stripe :
Nota est **18,90 $ plus pauvre** sur l'acte le plus urgent. Même chose au palier
`rapide` (+50 $ contre +59,45 $). Seuls `urgence` et `extrême` paient le coût
qu'ils créent. C'est de l'arithmétique, pas une opinion, et c'est le chiffre le
plus actionnable du plan — la grille est une donnée, modifiable depuis la console
sans déploiement.

**En moyenne pondérée** (60 % refinancement / 40 % financement ; 70 % standard,
18 % rapide, 7 % prioritaire, 3 % urgence, 2 % extrême — le mélange est une
hypothèse, les prix n'en sont pas) :

| Par acte complété | |
| --- | ---: |
| Honoraires (versés au notaire en entier) | 2 794 $ |
| **Revenu de Nota** | **257 $** |
| Frais de carte | (89) $ |
| **Marge brute de Nota** | **168 $** |
| **Marge brute** | **66 %** |

**Point de structure.** Comme le prix de Nota ne suit pas la valeur de l'acte,
**la marge brute par acte est presque plate** — entre 133 $ et 301 $ — pendant
que le montant qui change de mains varie du simple au quadruple. Le revenu est
donc fonction du **nombre d'actes**, jamais du volume transigé. Tout argument de
croissance doit être un argument de volume.

**Économie du notaire.** Coût d'acquisition ≈ 500 $ (le poste terrain de
15 000 $ ÷ 30 notaires). Un notaire qui retient 20 actes par année produit
**3 365 $** de marge brute annuelle — 10 094 $ sur trois ans. **VVC/CAC ≈ 20×**,
retour sur investissement en **trois actes**. C'est l'offre, pas la demande, qui
compose.

---

## Projections

| | An 1 | An 2 | An 3 |
| --- | ---: | ---: | ---: |
| Notaires | 30 | 220 | 700 |
| Offres déposées | 434 | 4 912 | 17 742 |
| Taux de rétention | 56 % | 57 % | 62 % |
| **Actes complétés** | **244** | **2 800** | **11 000** |
| Honoraires versés aux notaires | 682 000 $ | 7 822 000 $ | 30 730 000 $ |
| Total facturé aux clients | 744 000 $ | 8 542 000 $ | 33 557 000 $ |
| **Revenu de Nota** (257 $ × actes) | **62 700 $** | **719 600 $** | **2 827 000 $** |
| Frais de carte | (21 700) $ | (248 500) $ | (976 400) $ |
| **Marge brute** | **41 000 $** | **471 100 $** | **1 850 600 $** |
| Charges d'exploitation | (250 000) $ | (720 000) $ | (1 850 000) $ |
| **Résultat net** | **(209 000) $** | **(249 000) $** | **+600 $** |

**Seuil de rentabilité**, à 168 $ de marge brute par acte : **1 487 actes**
(124/mois) en an 1, **4 280** (357/mois) en an 2, **10 997** (917/mois) en an 3.
Le volume prévu de l'an 3 arrive donc à une centaine d'actes de couvrir sa
propre base de coûts — une histoire plus propre que celle de la version 1.0, où
l'an 3 perdait encore 390 850 $.

**Capital cumulé requis jusqu'à l'an 3 : ~460 000 $**, contre ~1,05 M$ dans la
version 1.0.

L'an 3 représente **~10 %** du volume d'actes adressable des deux services — une
part plus grande d'une catégorie plus petite que ne le disait la version 1.0,
conséquence directe du virage financement. Le plan n'exige pas de dominer le
marché — seulement d'être l'endroit où le prix se découvre.

**Déclencheur de la série A :** sortir de l'an 2 à un rythme annualisé de
**700 K$**, avec l'appariement provincial et la couche d'exception en
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
| Infrastructure, certificats, assurances, outils | 12 000 $ |
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

Quatre hypothèses portent le modèle, chacune avec son test de réfutation — **et
les quatre sont tranchées à l'intérieur de cette ronde** :

1. **Le client paie une prime pour une date.** *Test :* la distribution des
   primes réalisées par palier. Visible au 6ᵉ mois.
2. **Le notaire vend sa disponibilité de dernière minute.** *Test :* le taux de
   rétention sur les paliers `prioritaire` et `urgence`. Visible au 5ᵉ mois.
3. **Le client paie le prix de Nota en plus des honoraires.** *Test :* le taux
   d'abandon à l'écran du devis, où les deux lignes s'affichent ensemble avant
   tout engagement de carte. Visible dès les cinquante premières offres. C'est
   une question distincte de la première, et la version 1.0 ne la posait pas :
   un pourcentage retranché des honoraires du notaire était invisible au client.
4. **Le prix de Nota est déontologiquement sûr tel que structuré.** *Test :* un
   avis juridique écrit, 2ᵉ mois. La direction de l'argent est déjà réglée et
   vérifiable sur le fil Stripe ; la qualification ne l'est pas.

C'est l'argument pour la taille de la ronde : 250 000 $ suffisent à confirmer ou
à réfuter la thèse entière, et pas un dollar ne construit ce qui n'a pas été
validé.

---

## Risques principaux

| Risque | Atténuation |
| --- | --- |
| **Qualification du prix de Nota (art. 32.1 L.N.)** — critique | Le partage est **retiré** : le notaire reçoit 100 % de ses honoraires et Nota facture au client son propre prix publié (ADR 0031/0034). Ce qui reste est une qualification, pas une structure. Avis écrit budgété, 2ᵉ mois ; un forfait par acte facturé hors de l'acte est la structure de repli. |
| **Une affirmation retirée survit dans un document** | La commission de 10 %, le partage 75/25, la coupe de 5 à 15 % décidée par la cote et le prix unique de 400 $ sont tous retirés. Ils sont faux **et** ils décrivent un arrangement que le droit québécois interdit à Nota d'avoir : chaque audit daté qui les cite porte un bandeau de retrait. |
| **Les taxes et les débours ne sont pas au devis** | L'art. 71 3° exige d'indiquer s'ils sont inclus, l'art. 68 interdit la publicité incomplète. Chiffrés et affichés au 1ᵉʳ mois, avant toute affirmation de complétude. |
| **Le milieu de l'échelle d'urgence est vendu sous son coût** | Mesuré : `rapide` et `prioritaire` perdent 9,45 $ et 18,90 $ face aux frais Stripe qu'ils créent. La grille est une donnée, retarifée au 6ᵉ mois sur le coût réel. |
| **Aucune vérification au Tableau de l'Ordre** | Le seul contrôle actuel est le format d'une URL de fiche CNQ. Une vérification réelle et une radiation immédiate sont des préalables au premier acte. |
| **L'art. 46 maintient l'exception** | La phase 2 est rentable sous la loi actuelle. Les catégories d'exception sont vastes et mal desservies. |
| **Démarrage à froid** | L'offre est gratuite et sans friction. Une ville dense d'abord. Taux de rétention suivi chaque semaine. |
| **Faible réachat client** | L'actif durable est l'offre (notaires récurrents), la capture organique du carnet et les canaux de référence à coût nul. |
| **Opposition de la Chambre** | Dialogue précoce, écrit, en posture de partenariat. Nota ne touche jamais l'acte ni ne partage d'honoraires : c'est de la génération de demande pour la profession. |
| **Risque d'homme-clé** | ADR, spécifications exécutables BDD, embauche d'un second développeur tôt en an 2. |

---

## La demande

**250 000 $ CAD en préamorçage, 12 mois.** SAFE ou billet convertible, avec un
ange principal.

Ce que l'argent achète : un avis juridique écrit au dossier qui qualifie le prix
de Nota — la structure, elle, est déjà livrée ; 30 notaires et un marché biface
fonctionnel à Québec ; 244 actes complétés, ~62 700 $ de revenu et **la première
courbe d'urgence du marché notarial québécois** ; la couche d'exception qui rend
l'acte à distance routinier là où la loi le permet déjà ; et douze mois d'un
fondateur qui a bâti la plateforme entière et qui ne fera plus que cela.

> **En une phrase :** le Québec a déréglementé les honoraires notariaux en 1991
> et n'a jamais bâti de marché. Le marché est bâti. Cette ronde sert à savoir
> s'il se règle.
