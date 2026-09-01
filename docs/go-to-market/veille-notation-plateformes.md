# Veille — comment les plateformes notent leurs prestataires, et ce que Nota devrait en retenir

Date : 2026-09-01
Objet : valider (ou corriger) la **cote sur 100** décidée par le propriétaire le
1<sup>er</sup> septembre 2026, qui fixe directement la part que Nota retient sur
chaque acte (15 % au départ, 5 % au sommet).

**Convention de lecture.** Chaque affirmation sur un concurrent est suivie de sa
source. Ce qui vient d'une page officielle de la plateforme est marqué
**[officiel]** ; ce qui vient de presse, de recherche universitaire ou d'un
blogue spécialisé est marqué **[tiers]** ; ce qui est un calcul ou une
estimation de ma part est marqué **[estimation Nota]** et n'est jamais présenté
comme un fait sourcé. Quand une information n'a pas pu être établie, c'est
écrit — « non documenté publiquement au 2026-09-01 » — plutôt qu'estimé.

Plusieurs sites officiels (`support.upwork.com`, `help.fiverr.com`,
`help.thumbtack.com`, `legisquebec.gouv.qc.ca`) refusent la lecture automatisée
simple et ont été lus au navigateur lors d'une passe de recherche dédiée. Les
citations sont verbatim et les URL font foi ; la §9 liste ce qu'il faut relire à
la main avant de reprendre ces chiffres dans un document destiné à la Chambre.

---

## 0. L'objet à valider, tel qu'il est réellement codé

Pas la table du courriel : le code.

| Fichier | Ce qu'il porte |
| --- | --- |
| `packages/domain/index.js` (bloc `COTE`, ligne ~1222) | Les quatre axes, leurs maxima, toute la pondération |
| `apps/api/src/cote.js` | L'adaptateur : quels compteurs du profil notaire alimentent quels axes |
| `apps/api/src/commission-config.js` | La traduction cote → taux : 15 % de base, paliers 60/70/80/90, plancher 5 % |

Barème effectif :

| Cote atteinte | Nota garde | Le notaire garde |
| ---: | ---: | ---: |
| < 60 | 15 % | 85 % |
| ≥ 60 | 12 % | 88 % |
| ≥ 70 | 10 % | 90 % |
| ≥ 80 | 8 % | 92 % |
| ≥ 90 | 5 % | 95 % |

**Fait structurant, vérifié dans `cote.js` :** tous les signaux sont des
compteurs **cumulés depuis l'inscription** — `ratingSum` / `ratingCount`,
`actsCompleted`, `proposalsCount` + `acceptsCount`, `declinesCount`. **Il
n'existe aucune fenêtre temporelle nulle part**, sauf sur l'axe présence
(`joursDepuisActivite`, `joursMembre`). C'est le point de divergence le plus net
avec l'ensemble de l'industrie, et le cœur du verdict en §8.

**Fait structurant n° 2 :** le catalogue ne compte que **deux** services
(`refinancement`, `financement`). Le sous-axe « éventail » (7 pts) est donc un
interrupteur à deux positions : 3,5 pts ou 7 pts.

### Simulations du barème actuel (exécutées contre `domain.notaryScore`)

| Profil | Cote | Nota garde |
| --- | ---: | ---: |
| Notaire neuf, profil vide | **35** | 15 % |
| Notaire neuf, profil **complet** (fiche CNQ, secteur, rayon 50 km, urgences) | **51** | 15 % |
| 1 an, 20 actes (1 seul service), 20 avis à 4,9, 30 réponses / 0 déclin | **88** | 8 % |
| 1 an, 50 actes (2 services), 30 avis à 5,0, 40 réponses / 0 déclin | **100** | 5 % |
| Le même que le 3<sup>e</sup>, mais 15 réponses / 5 déclins | **85** | 8 % |

**[estimation Nota]** Conséquence immédiate : *un notaire irréprochable mais
neuf plafonne à 51 et paie le taux maximum*. Le premier palier (60) est
inatteignable sans actes complétés, quelle que soit la qualité du notaire.

---

## 1. Uber — la référence dont tout le monde a copié la mécanique

### Ce qui est mesuré, et sur quelle fenêtre

- La note est **la moyenne des 500 dernières évaluations reçues**, pas la
  moyenne de la carrière. **[officiel]**
  <https://help.uber.com/en/driving-and-delivering/article/understanding-ratings?nodeId=fa1eb77f-ad79-4607-9651-72b932be30b7>
- Les nouveaux chauffeurs démarrent à 5 étoiles et la note fluctue « jusqu'à
  100 évaluations » — c'est-à-dire que le démarrage à froid est traité par une
  **présomption favorable**, pas par un a priori médian. **[officiel]** (même
  page)
- Le **taux d'acceptation** et le **taux d'annulation** sont calculés sur une
  *lookback window* de **100 dernières demandes**, et sur le total reçu si le
  chauffeur en a moins de 100. **[officiel]**
  <https://www.uber.com/us/en/blog/understanding-acceptance-and-cancellation-rates/>

### Ce qui se compense, ce qui est éliminatoire

- **Éliminatoire :** la note. « Consistently low ratings may lead to account
  deactivation. » Uber précise que le minimum **varie selon la ville** pour les
  produits non premium et qu'un préavis est donné. **[officiel]** (même page
  *Understanding ratings*)
- Le seuil de ~**4,6** couramment cité n'apparaît sur aucune page officielle
  que j'ai pu ouvrir ; c'est un chiffre de presse et de forums, et Uber dit
  lui-même qu'il n'y a pas de nombre unique pour tout un pays. **[tiers]**
  <https://www.ridester.com/uber-driver-ratings/> — **à traiter comme un ordre
  de grandeur, pas comme un fait.**
- **Non éliminatoire :** le taux d'acceptation. La page officielle ne le relie
  jamais à une désactivation ; elle le relie **uniquement** au statut Uber Pro :
  « Your acceptance rate affects your Uber Pro […] status, which determines the
  rewards and benefits you can access. » **[officiel]** (même page
  *acceptance and cancellation rates*)

C'est la distinction la plus importante de tout ce document, et j'y reviens en
§8 : **refuser une course ne coûte pas le compte, il coûte un avantage.**

### Uber Pro : des paliers qui donnent des avantages, jamais un tarif

- Quatre paliers : **Blue, Gold, Platinum, Diamond**. Un point par course, plus
  des points bonus aux heures de pointe. Le statut est déterminé par **les
  points gagnés sur la période de 3 mois précédente**. **[officiel]**
  <https://www.uber.com/us/en/drive/uber-pro/>
- Les seuils de points **varient par marché** et ne sont pas publiés — la page
  officielle renvoie au *hub* dans l'application. **[officiel]** (même page)
- Sur les taux d'annulation, la page officielle indique qu'un taux entre
  **4,01 % et 10 %** empêche de monter de palier et qu'**au-delà de 10 %** on
  perd ses récompenses. **[officiel]** (même page)
- Les exigences d'acceptation sont différenciées par palier : Gold sans
  exigence, **Platinum 25 %**, **Diamond 70 %** (annonce Californie).
  **[officiel]**
  <https://www.uber.com/us/en/blog/uber-pro-in-california-rewards-that-go-the-extra-mile-like-you/>
- Les avantages sont des **remises et des priorités** (remise essence/recharge,
  file prioritaire aéroport, soutien premium, couverture de frais de scolarité
  après 2 000 courses à vie) — **jamais un pourcentage de commission
  différent**. **[tiers]** <https://gridwise.io/blog/uber-pro/uber-pro-what-should-uber-drivers-know/>
  ; **[officiel]** <https://www.uber.com/us/en/drive/uber-pro/>

### Protection de la note

Uber retire automatiquement du calcul : les notes sous 5 étoiles motivées par
des causes hors du contrôle du chauffeur (panne d'application, GPS, trafic,
mauvaise épingle, comportement d'un co-passager, faux signalement), et **les
notes de passagers qui notent systématiquement bas**. Aucune démarche du
chauffeur n'est possible : le retrait est automatique ou il n'a pas lieu.
**[officiel]** <https://www.uber.com/en-DO/blog/ratings-protection/> et page
*Understanding ratings*.

### Critiques documentées

- **Biais discriminatoire.** Rosenblat, Levy, Barocas et Hwang, *Discriminating
  Tastes: Uber's Customer Ratings as Vehicles for Workplace Discrimination*,
  Policy & Internet, 2017 : un système de notation alimenté par les
  consommateurs offre une voie « facialement neutre » par laquelle les
  préjugés des clients entrent dans des décisions d'emploi. **[tiers]**
  <https://datasociety.net/wp-content/uploads/2020/10/Rosenblat_et_al-2017-Policy_amp_Internet.pdf>
- **Décision automatisée sans recours réel.** Cour d'appel d'Amsterdam, avril
  2023 (affaires dites du *robo-firing*, Uber et Ola c. chauffeurs
  britanniques) : la cour a jugé que la « revue humaine » invoquée par Uber
  n'était « pas beaucoup plus qu'un acte purement symbolique », que la décision
  était donc **entièrement automatisée** au sens de l'article 22 du RGPD, et a
  ordonné la réintégration. **[tiers]**
  <https://fountaincourt.uk/2023/04/amsterdam-court-upholds-appeal-in-algorithmic-decision-making-test-case-drivers-v-uber-and-ola/>
- **Coercition par le taux d'acceptation.** Les forums de chauffeurs
  documentent le calcul : atteindre 70 % d'acceptation pour Diamond peut coûter
  plus que la prime ne rapporte. **[tiers]**
  <https://www.uberpeople.net/threads/your-acceptance-rate-and-uber-pro.328039/>
- **Le fond du problème, en droit.** Veena Dubal, *On Algorithmic Wage
  Discrimination*, Columbia Law Review 123:7 (2023), p. 1929 : quand la
  rémunération devient une variable de sortie d'un algorithme opaque, les
  travailleurs la vivent comme un jeu de hasard, et l'autrice propose une
  interdiction légale non renonçable de la pratique. **[tiers]**
  <https://www.columbialawreview.org/wp-content/uploads/2023/11/Dubal-On_Algorithmic_Wage_discrimination.pdf>

---

## 2. Lyft — même mécanique, fenêtre cinq fois plus courte

- La note du chauffeur est **la moyenne des 100 dernières évaluations** ; en
  dessous de 100 courses, c'est la moyenne de tout ce qui a été reçu.
  **[officiel]** <https://help.lyft.com/hc/en-us/all/articles/115013079948-Driver-and-passenger-ratings>
- Lyft ne publie pas de seuil couperet : « Consistently low ratings can put you
  at risk of deactivation. If your rating is below 4.8, you may want to consider
  ways to improve it. » **[officiel]** (même page)
- **Recours explicite, contrairement à Uber :** « Lyft can exclude the lowest
  rating received out of your last 100 rides », les demandes multiples n'étant
  pas garanties. **[officiel]** (même page) — c'est le seul mécanisme de
  contestation individuelle que j'ai trouvé chez un grand acteur du transport.
- **Lyft Rewards :** quatre paliers (Silver, Gold, Platinum, Elite), points
  gagnés sur des **périodes d'un mois** débutant à 5 h le 1<sup>er</sup> du
  mois, remise à zéro mensuelle. Les seuils de points et les minimums de note,
  d'acceptation et d'annulation **ne sont pas publiés**. Les récompenses sont
  des remises (essence, recharge, TurboTax, assistance routière) et des
  **filtres de destination** — **aucune modulation du taux de commission**.
  **[officiel]** <https://help.lyft.com/hc/en-us/all/articles/360035885974-Lyft-Rewards>

---

## 3. DoorDash — le seul qui a explicitement dépénalisé le refus

### Les métriques et leurs fenêtres — toutes en « 100 dernières »

| Métrique | Fenêtre | Seuil | Éliminatoire ? |
| --- | --- | ---: | --- |
| Note client | 100 dernières évaluations | **4,2** | seuil minimum affiché |
| Taux de complétion | 100 dernières offres acceptées | **90 %** | **oui** — « could result in account deactivation » |
| Taux d'acceptation | 100 dernières offres reçues | *aucun minimum* | **non** |
| Taux de ponctualité | 100 dernières offres complétées | — | infractions répétées |

**[officiel]** <https://help.doordash.com/en-us/dashers/article/dasher-ratings-explained>

DoorDash retire automatiquement les évaluations sous 5 étoiles causées par une
longue attente au restaurant, une commande déjà en retard à l'acceptation, un
désassignement antérieur, une commande groupée, la météo extrême, des
manifestations ou une panne système. **[officiel]** (même page)

### Le point capital

**Accepter ou refuser une offre ne fait pas partie des critères de
désactivation** — seule la complétion d'une offre *déjà acceptée* l'est. Le
taux d'acceptation ne sert qu'à ouvrir un programme d'avantages. **[officiel]**
(même page)

### Top Dasher → Dasher Rewards

- Le programme historique **Top Dasher** exigeait : note ≥ **4,7**, taux
  d'acceptation ≥ **70 %**, taux de complétion ≥ **95 %**, **200 livraisons à
  vie** et **100 livraisons dans le mois écoulé** ; le statut se recalcule au
  premier jour de chaque mois. **[tiers]**
  <https://entrecourier.com/delivery/gig-delivery-platforms/doordash/doordash-strategies/doordash-top-dasher-requirement/>
  et <https://www.everlance.com/blog/top-dasher-requirements>
- Il est remplacé aux États-Unis par **Dasher Rewards** (Silver / Gold /
  Platinum), assis sur un **Overall Dasher Rating** qui agrège **six mesures en
  un score unique** : taux d'acceptation, taux de complétion, note client, taux
  de ponctualité, taux de qualité, et **commandes des 30 derniers jours**.
  **[officiel]** <https://help.doordash.com/en-us/dashers/article/overall-dasher-rating>
- **C'est la structure la plus proche de la cote de Nota** — et il faut noter
  ce que DoorDash n'a *pas* fait : la pondération de chaque mesure et les
  seuils de palier **ne sont pas publiés**, et les exigences « dépendent de la
  zone ». **[officiel]**
  <https://help.doordash.com/en-us/dashers/article/dasher-rewards-program-pilot>
- **Démarrage à froid :** un nouveau livreur devient éligible au programme
  après **50 livraisons**. **[officiel]** (même page)
- **Amortisseur :** le *Platinum Pass* — 200 livraisons consécutives en statut
  Platinum donnent un laissez-passer qui maintient les avantages Platinum
  **7 jours** même si les métriques retombent sous les seuils. **[officiel]**
  <https://help.doordash.com/dashers/s/article/Platinum-Pass?language=en_US>

### Critique documentée

Le taux d'acceptation reste critiqué comme un levier de coercition
économique : il pousse à accepter des courses longues et peu payées, au
détriment du coût réel au kilomètre, surtout pour les nouveaux. Une pétition
demande d'interdire son usage dans les structures de paliers. **[tiers]**
<https://www.change.org/p/ban-uber-eats-doordash-from-using-acceptance-rate-as-a-driver-metric-in-tier-structures>
et <https://therideshareguy.com/doordash-acceptance-rate/>

---

## 4. Airbnb — le modèle le plus transférable à Nota

C'est la plateforme dont la structure ressemble le plus à Nota : faible volume
par prestataire, transaction à forte valeur, prestataire qui a le droit de
refuser.

### Superhost — quatre conditions, toutes sur 12 mois glissants

**[officiel]** <https://www.airbnb.com/help/article/829>

| Critère | Seuil |
| --- | --- |
| Note globale | **4,8 ou plus** |
| Volume | **10 réservations**, ou 3 réservations totalisant **100 nuits** |
| Annulations par l'hôte | **moins de 1 %** |
| Réactivité | répondre à **90 %** des nouveaux messages et accepter/refuser les demandes **en 24 h** |

Deux détails que Nota devrait copier tels quels :

1. **La fenêtre est de 12 mois**, et « l'hôte n'a pas besoin d'avoir été actif
   toute la période ». **[officiel]**
2. **L'évaluation est trimestrielle** — 1<sup>er</sup> janvier, avril, juillet,
   octobre. Le statut n'est décerné que **4 fois par an**. **[officiel]**

Le troisième détail, décisif pour un officier public : **le critère de
réactivité d'Airbnb compte le fait de répondre, pas le fait d'accepter.**
« Respond to 90 % of new messages, **and accept or decline** new reservation
requests, within 24 hours. » **Refuser dans les délais est une réponse
conforme.** **[officiel]**

### Guest Favorite (2024) — la génération suivante

Airbnb a superposé un badge assis sur « les notes globales et par
sous-catégorie, le contenu des commentaires, les annulations par l'hôte et le
nombre d'incidents de qualité remontés au service client ». **[tiers]**
<https://community.withairbnb.com/t5/Support-with-your-bookings/quot-Guest-favorite-quot-concept-what-for/m-p/1852893>
Les seuils rapportés (4,9+, moins de 1 % d'annulation, minimum 5 avis sur
4 ans dont 1 sur 2 ans) proviennent de sources tierces et **n'ont pas pu être
confirmés sur une page officielle** — la page d'aide `airbnb.com/help/article/3383`
a refusé la connexion. **[tiers]**
<https://triadvacationrentals.com/blog/why-guest-favorite-has-replaced-superhost-as-airbnbs-gold-standard>

### Effet sur la visibilité

Airbnb affirme que Superhost ne donne pas une meilleure position en recherche ;
les mesures tierces trouvent un effet réel mais modeste sur les impressions
(45,6 % contre 46 % en première page) et plus net sur la conversion (~0,86 %
contre ~1,03 %). **[tiers]**
<https://intellihost.co/blog/how-superhost-status-affects-bookings> — chiffres
d'un éditeur commercial, à prendre comme un ordre de grandeur.

### Critique documentée : l'inflation des notes

- Zervas, Proserpio et Byers, *A First Look at Online Reputation on Airbnb,
  Where Every Stay is Above Average* : sur plus de 2 000 logements inscrits à
  la fois sur Airbnb et TripAdvisor, la proportion notée **4,5 étoiles ou plus
  est 14 % plus élevée sur Airbnb**, et celle notée 5 étoiles **18 % plus
  élevée** — l'écart étant attribué au caractère **réciproque** des évaluations
  d'Airbnb. **[tiers]**
  <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2554500>
- Filippas, Horton et Golden, *Reputation Inflation* (NBER w25857) : sur une
  grande place de marché du travail en ligne, **85 % des travailleurs évalués
  reçoivent la note parfaite** ces dernières années ; les évaluateurs subissent
  une pression sociale à noter « au-dessus de la moyenne », ce qui pousse la
  moyenne vers le haut et détruit progressivement le pouvoir informatif de
  l'échelle. **[tiers]**
  <https://www.nber.org/system/files/working_papers/w25857/w25857.pdf>

**Conséquence directe pour Nota :** une cible fixée à **4,8 sur 5** n'est pas
une cible d'excellence dans un système à notes inflatées — c'est à peu près la
médiane. Voir §8.2.

---

## 5. Upwork et Fiverr

Upwork et Fiverr sont les deux seules plateformes de ce dossier qui notent un
**travail intellectuel à livrable unique**, ce qui les rapproche du notariat
plus que le transport. Elles divergent radicalement sur presque tout.

### 5.1 Upwork — le Job Success Score

**La formule publiée, et ce qu'elle cache.** Upwork ne publie qu'une seule
formule, de son propre aveu « at a high level » :

> `(successful contract outcomes − negative contract outcomes) / total outcomes`

**[officiel]** <https://support.upwork.com/hc/en-us/articles/38437458199059-How-is-my-Job-Success-Score-calculated>

**Les pondérations ne sont jamais publiées.** Toute « formule JSS » détaillée
qui circule en ligne est une reconstitution non officielle (voir 5.4).

**La fenêtre — le mécanisme le plus important de tout le document pour Nota.**

| Élément | Valeur | Source |
| --- | --- | --- |
| Recalcul | **quotidien** | **[officiel]** <https://support.upwork.com/hc/en-us/articles/38437480577939-When-is-my-JSS-calculated> |
| Fenêtres | **6, 12 et 24 mois**, calculées **en parallèle** | idem |
| Score retenu | **le meilleur des trois** — « The best score out of these moving time windows is your JSS » | idem |
| Point de départ du décompte | la date de la **dernière transaction**, pas la fin du contrat | idem |
| Révision des **badges** | **toutes les deux semaines** | **[officiel]** <https://support.upwork.com/hc/en-us/articles/211063568-Understand-freelancer-talent-badges> |

Le « meilleur des trois fenêtres glissantes » est une solution élégante au
problème exact que Nota va rencontrer : à faible volume, une fenêtre unique et
courte est bruyante, une fenêtre longue est inerte. Upwork calcule les trois et
retient la plus favorable — le prestataire n'est donc jamais puni par le choix
de la fenêtre.

**Ce qui se compense.** Le *long-term client bonus*, chiffré officiellement :

> « Contracts with clients you've worked with longer than 90 days are
> automatically considered successful, both when they are in progress as well
> as if the contract ends without client feedback. »
> « Contract length — Every 90 days with payment is weighted as an extra "job"
> towards your JSS, **up to a maximum weight of 8 jobs**. »

**[officiel]** <https://support.upwork.com/hc/en-us/articles/32389629156755-How-to-understand-your-Job-Success-insights-on-Upwork>

Et la symétrie est explicite : « Longer-term relationships are great and can
help boost your score. But **not having them does not count against you**. »
**[officiel]** <https://support.upwork.com/hc/en-us/articles/41946128518035-What-should-I-know-about-my-Job-Success-Score-JSS>

**Ce qui ne compte pas.** Contrairement au mythe le plus répandu, un contrat
sans avis est **inéligible**, pas pénalisant :

> « Contracts with no payment but with negative feedback can impact JSS. »
> « Contracts with no payment and no feedback **do not impact JSS**. »

**[officiel]** <https://support.upwork.com/hc/en-us/articles/38439816969875-What-factors-affect-my-Job-Success-Score>

Sont également exclus : les contrats dont la dernière transaction remonte à plus
de 24 mois, et les avis de clients signalés pour mauvaise collaboration ou
suspendus.

**Le feedback privé a été supprimé le 31 mars 2026** — fait récent et décisif,
que la quasi-totalité des blogs ignore encore :

> « As of March 31, 2026, we've simplified how you leave feedback for your
> clients at the end of a contract. »
> « In the past, both public and private feedback were included. **Since we no
> longer collect private feedback, only public feedback is considered.** »

**[officiel]** <https://support.upwork.com/hc/en-us/articles/211068438-How-to-give-feedback-to-your-clients>
et <https://support.upwork.com/hc/en-us/articles/215917628-How-to-view-and-share-your-feedback-from-clients>

Motif invoqué par Upwork : « We heard from freelancers and clients that private
feedback felt unclear and confusing. » Après une douzaine d'années, la
plateforme a cédé sur le grief numéro un de sa communauté.

**Les seuils.**

| Badge | Seuil | Autres critères | Part |
| --- | --- | --- | --- |
| Rising Talent | *pas encore de JSS* | profil à 100 %, activité < 90 j, aucun avis négatif, identité vérifiée | — |
| **Top Rated** | **JSS ≥ 90 % maintenu 13 des 16 dernières semaines** | 1<sup>er</sup> projet > 90 j ; **1 000 $ sur 12 mois** ; activité < 90 j | top 10 % |
| **Top Rated Plus** | Top Rated maintenu (**pas** 100 %) | **10 000 $ sur 12 mois** + ≥ 1 « large contract » sans issue négative | top 3 % |
| Expert-Vetted | — | **sur invitation**, entretien de 30 min | top 1 % |

**[officiel]** <https://support.upwork.com/hc/en-us/articles/211068468-How-to-become-Top-Rated-on-Upwork>,
<https://support.upwork.com/hc/en-us/articles/360050417233-How-to-reach-Top-Rated-Plus-status>,
<https://support.upwork.com/hc/en-us/articles/360049625454-Expert-Vetted-talent>

La règle **13 semaines sur 16** est une hystérésis explicite : un mauvais mois
ne coûte pas le badge.

**Démarrage à froid.** Le JSS n'apparaît qu'après **deux issues de contrat sur
24 mois avec au moins deux clients différents** — et il **disparaît** si ces
conditions cessent d'être remplies. **[officiel]**
<https://support.upwork.com/hc/en-us/articles/38437546570643-When-will-I-get-a-JSS>
et <https://support.upwork.com/hc/en-us/articles/38437621837203-Why-did-my-JSS-disappear>

Autrement dit : **Upwork préfère n'afficher aucun score plutôt qu'un score
non significatif.** C'est l'inverse du choix de Nota, qui affiche 35 à un
notaire dont on ne sait rien.

**Le seuil de conséquence** est publié : « A JSS of 90 % or above is
excellent… If your score falls below 79 %, you may find it difficult to connect
with new clients or win new projects. » **[officiel]**
<https://support.upwork.com/hc/en-us/articles/211068358-All-about-your-Job-Success-Score>

### 5.2 Upwork — la commission, et ce qu'elle enseigne à Nota

C'est le point que le barème de Nota doit regarder en face.

| Période | Régime freelance | Fiabilité |
| --- | --- | --- |
| avant mai 2016 | **10 % forfaitaire** | **[tiers]** <https://www.forbes.com/sites/elainepofeldt/2016/05/07/freelance-giant-upworks-new-pricing-model-sparks-outcry/> |
| juin 2016 → mai 2023 | **20 %** sur les premiers 500 $ / **10 %** de 500 $ à 10 000 $ / **5 %** au-delà — **cumul à vie avec le même client** | **[tiers]** (même source, + <https://www.staffingindustry.com/news/global-daily-news/upwork-changes-pricing-format>) |
| à partir du **3 mai 2023** | **10 % plat** ; contrats déjà à 5 % grand-pérés jusqu'à fin 2023 | **[tiers]** convergents — <https://freelancemvp.com/upwork-freelancer-fees-10-percent/>, <https://wise.com/us/blog/upwork-fees> ; **le billet Upwork d'origine n'a pas été retrouvé** |
| depuis 2025 | **variable de 0 % à 15 % par contrat** | **plage confirmée officiellement**, date de bascule **[tiers]** |

Le texte officiel actuel, mot à mot :

> « The fee ranges from **0 % to 15 % per contract**. »
> « Once your contract begins, **the fee is fixed and won't change**. »

et le taux est affiché **avant** que le freelance soumette sa proposition ou
accepte l'offre ; aucune remise n'existe (« we are not offering any regular
discounts »). **[officiel]**
<https://support.upwork.com/hc/en-us/articles/211062538-Learn-about-the-Freelancer-Service-Fee>

**Trois enseignements directs pour la cote de Nota :**

1. **Le taux variable par contrat existe et est industriellement viable** — Upwork
   fait exactement ce que le propriétaire a décidé, sur une amplitude comparable
   (0–15 % contre 5–15 %). Le modèle de Nota n'est donc pas une aberration.
2. **Mais le taux est FIGÉ à l'ouverture du contrat et annoncé AVANT
   l'engagement.** C'est le garde-fou que Nota n'a pas : aujourd'hui, le taux
   se calcule au règlement (`billing.js` appelle `coteFor` au moment de
   facturer), donc un notaire peut retenir un acte à 8 % et le régler à 10 %
   parce qu'il aura décliné deux demandes entretemps.
3. **La commission dégressive selon la relation client a été supprimée en
   2023.** Le palier 5 % était le seul avantage tarifaire récompensant la
   fidélité ; depuis, la loyauté n'ouvre plus que de la visibilité. Upwork a
   donc parcouru le chemin inverse de celui que Nota emprunte — et la barème
   0–15 % actuel est fixé par un algorithme **non publié**, c'est-à-dire une
   seconde boîte noire, tarifaire cette fois.

### 5.3 Fiverr — le Success Score, et le piège du score relatif

**Le barème officiel, chiffré** — verbatim de
<https://help.fiverr.com/hc/en-us/articles/360010560118-Understanding-Fiverr-s-freelancer-levels> **[officiel]** :

| Niveau | Success Score | Note | Taux de réponse | Commandes | Clients uniques | Revenus | Revue humaine |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Level 1 | **5+** | 4,4+ | 80 % | 5 | 3 | 400 $ | non |
| Level 2 | **7+** | 4,6+ | 90 % | 20 | 10 | 2 000 $ | non |
| Top Rated | **9+** | 4,7+ | 90 % | 40 | 20 | 10 000 $ | **oui** |

**Les fenêtres** **[officiel]** (mêmes pages) :

| Métrique | Fenêtre |
| --- | --- |
| Note | moyenne sur les **2 dernières années** |
| Taux de réponse | premières réponses **< 24 h**, sur les **90 derniers jours** |
| Commandes / clients / revenus | cumul **total** |
| **Success Score** | **« a longer time period » — jamais chiffré** |

Mobilité **quotidienne** (« you'll move up automatically within 24 hours ») et
**période de grâce de 30 jours** avant tout déclassement. Le « 15 du mois » est
l'ancien système, d'avant 2024.

**Le Success Score** (<https://help.fiverr.com/hc/en-us/articles/21965360854673-Success-score>) —
six axes par prestation, agrégés : satisfaction client, communication,
commandes sans conflit, annulations, livraison à temps, **rapport
qualité-prix**. Échelle 1 à 10, **visible du seul prestataire** — « Clients only
see your overall Level. » **[officiel]**

**Le piège, dit noir sur blanc par Fiverr :**

> « The Success score is based on your performance **relative to other
> freelancers in your price range**. »

**[officiel]** (même page). Conséquence : un prestataire peut être à 100 % sur
toutes ses métriques et ne jamais atteindre 10, parce que ses pairs ont
progressé. **C'est un classement déguisé en note.**

**Commission : 20 % plat, à tous les niveaux.** « After an order is completed,
freelancers receive 80 % of the client's cleared payment », avec 14 jours de
compensation. **Aucune dégressivité, aucun rabais lié au niveau.**
**[officiel]** <https://help.fiverr.com/hc/en-us/articles/34069565843985-How-Fiverr-works-for-freelancers>

**La refonte de 2024, et le motif que Fiverr a lui-même donné.** Communiqué
officiel du **30 janvier 2024** annonçant « a radical level of transparency »
(<https://investors.fiverr.com/news-releases/news-release-details/fiverrs-winter-product-release-packed-new-features-keep>) —
le communiqué **ne nomme jamais le « Success Score »**. Mise en production le
**14 février 2024**, annoncée sur le forum officiel par un membre du personnel :

> « **The previous system often led to near-perfect scores, making it
> challenging for exceptional work to stand out.** »

> « we will test a new calculation method for public ratings that
> **incorporates historical private feedback**… This adjustment may lead to a
> change in public rating scores platform-wide. »

**[officiel, via archive]**
<http://web.archive.org/web/20240423142407/https://community.fiverr.com/forums/topic/324066-important-updates-level-system-now-live-and-ratings-reviews-testing-changes/>

**C'est l'aveu le plus utile de tout le dossier :** une plateforme majeure
reconnaît publiquement que son échelle de notes était saturée au sommet — le
phénomène que Filippas et al. mesurent (§4 et §5.4) — et annonce y répondre en
**rétro-injectant du feedback privé** dans les notes publiques.

**Et deux semaines plus tard, elle refuse de publier la formule :**

> « **It's not a one-size-fits-all formula**… it is possible to have 2 Gigs with
> the same score, but with different key areas highlighted, **each with
> different weights**. »

**[officiel, via archive]**
<http://web.archive.org/web/20241016041859/https://community.fiverr.com/forums/topic/324227-update-addressing-new-level-system-questions-and-feedback/>

**« Une transparence radicale » annoncée le 30 janvier, « pas de formule
unique » le 15 février.** C'est exactement l'écart que Nota peut ne pas creuser.

**Le taux affiché n'est pas le taux réel.** Fiverr annonce 20 % côté
prestataire ; son *take rate* publié aux investisseurs est de **30,2 % (2022)**
et **31,8 % (2023)**, l'écart venant des frais acheteur, des *Promoted Gigs* et
de l'abonnement *Seller Plus*. **[officiel]**
<https://investors.fiverr.com/news-releases/news-release-details/fiverr-announces-fourth-quarter-and-full-year-2023-results>
Utile à garder en tête quand on compare le 15 % de Nota à un 20 % affiché
ailleurs : **le chiffre annoncé et le prélèvement réel sont deux choses
différentes.** Le 15 % de Nota, lui, est le prélèvement total.

### 5.4 Critiques documentées

**Upwork — aucun recours, officiellement.** La page dont le titre acte l'impasse :

> « JSS is determined by an automated algorithm… **Our calculations cannot be
> manually adjusted.** »

**[officiel]** <https://support.upwork.com/hc/en-us/articles/38440432318995-There-s-a-mistake-in-my-JSS-calculation-What-should-I-do>

Et aucun historique n'est consultable : « Can I see my JSS changes over time in
Job Success insights? **No, only your current score is shown.** » **[officiel]**
<https://support.upwork.com/hc/en-us/articles/32389629156755-How-to-understand-your-Job-Success-insights-on-Upwork>
Un avis ne peut être retiré que pour violation des CGU, signalable **une seule
fois** — « we can't edit it or make determinations about its accuracy in most
cases ». **[officiel]**
<https://support.upwork.com/hc/en-us/articles/219801228-When-can-Upwork-remove-feedback-I-ve-received>

**Upwork — l'inflation des notes, quantifiée.** Filippas, Horton et Golden,
*Reputation Inflation* (NBER WP 25857 → *Marketing Science* 41(4), 2022). La
plateforme est anonymisée mais **fortement identifiable** comme oDesk/Upwork.
**[tiers]** <https://www.nber.org/papers/w25857>

| Constat | Chiffre |
| --- | ---: |
| Évaluations dans la tranche 4,75–5,00 (2014–2016, n = 1 339 071) | **> 80 %** |
| Moyenne publique | **4,77** |
| Dérive de la moyenne mensuelle, 2007 → 2016 | **3,74 → 4,85** |
| Contrats notés exactement 5 étoiles | **33 % → 85 %** |
| Part de la hausse imputable à l'inflation, non à la qualité | **> 50 %** |
| Employeurs **privément** insatisfaits | **~15 %** |
| … contre notes **publiques** ≤ 3 étoiles | **< 4 %** |
| Employeurs ayant répondu « Definitely Not » en privé et mis > 4 étoiles en public | **28,4 %** |

**Biais mesurés.** Discrimination de classement sur **44 167 profils Upwork** —
femmes, femmes noires, personnes asiatiques et candidats jeunes moins bien
classés (*Journal of Business Research* 192, 2025). **[tiers]**
<https://www.sciencedirect.com/science/article/pii/S0148296325001213>
Biais raciaux également mesurés sur TaskRabbit et Fiverr. **[tiers]**
<https://www.researchgate.net/publication/313738299_Bias_in_Online_Freelance_Marketplaces_Evidence_from_TaskRabbit_and_Fiverr>

**Fiverr — biais mesuré.** Hannák et al., CSCW '17, sur **13 500 profils
Fiverr** : les travailleurs perçus comme noirs reçoivent **~32 % d'avis en
moins** (IRR = 0,68) et des notes plus basses — moyennes/médianes de 3,3/4,8
(Blancs), 3,0/4,6 (Noirs), 3,3/4,8 (Asiatiques). Données de 2016, limite
reconnue par les auteurs. **[tiers]**
<https://dl.acm.org/doi/10.1145/2998181.2998327>

**Fiverr — l'ampleur de la contestation de 2024, mesurée.** Le fil officiel
d'annonce compte **462 réponses** (dont 303 le seul 14 février) et le fil de
suivi **1 300 réponses en 8 jours** — soit ~1 762 réponses cumulées. Les titres
sont explicites (« My success score is calculated incorrectly, Fiverr should
explain how they calculated all parameters »). **[tiers]**
<https://community.fiverr.com/forums/topic/324534-my-success-score-is-calculated-incorrectly-fiverr-should-explain-how-they-calculated-all-parameters>

**Deux nuances honnêtes.** Il n'existe **aucun chiffre de rétrogradations**, ni
chez Fiverr ni ailleurs : « déclassements massifs » est inféré du volume de
plaintes, pas mesuré — **non documenté publiquement au 2026-09-01**. Et le grief
n'est pas unanime : des vendeurs relèvent que « this system is **more
transparent** than what it was before… now you know, every gig shows what's
affecting it ». Par ailleurs **aucune couverture de presse tech** n'a été trouvée
sur la refonte, et le forum officiel est désormais **fermé aux non-connectés** —
la contestation n'est plus indexable publiquement.

Et **deux pages officielles de Fiverr se contredisent** sur les notes privées :

- Centre d'aide : « This review is not shared with the freelancer and is used by
  Fiverr for **internal quality measurement only**. »
  <https://help.fiverr.com/hc/en-us/articles/360049982353-Reviews-and-ratings-explained>
- Blogue officiel, 15 janvier 2026 : « **Private ratings directly affect your
  Success Score**, particularly your Client Satisfaction metric. »
  <https://community.fiverr.com/public/blogs/why-your-5-star-rating-isnt-telling-the-whole-story-a-guide-to-private-ratings-2026-01-15>

**Le contraste vaut d'être noté :** Upwork a **supprimé** le feedback privé le
31 mars 2026 ; Fiverr l'a **renforcé** et l'assume publiquement en janvier 2026.

**Mise en garde sur les sources tierces.** Tout l'écosystème qui « explique » le
JSS (GigRadar, UpHunt, AiProposer, Zenlance…) est composé d'éditeurs d'outils de
prospection Upwork, commercialement intéressés. Plusieurs affirment encore en
2026 que le feedback privé pèse dans le JSS — ce que la documentation officielle
contredit depuis mars 2026. **Aucun de leurs pourcentages de pondération n'a de
valeur probante.**

---

## 6. Thumbtack, Angi, et les professions réglementées

C'est la section qui compte le plus, parce que c'est la seule où l'on trouve
des **professionnels réglementés notés par une plateforme** — et l'historique
réglementaire de ce qui leur est arrivé.

### 6.1 Thumbtack — « Top Pro » est le palier haut d'un programme de points

Le badge Top Pro n'est pas un programme autonome : c'est le palier **Platinum**
de **Pro Rewards**. **[officiel]**
<https://help.thumbtack.com/article/thumbtack-pro-rewards-program>

| | Silver | Gold | **Platinum = Top Pro** |
| --- | ---: | ---: | ---: |
| Points | 300 | 1 200 | **2 400** |
| Note minimale | 4,5 | 4,6 | **4,7** |
| Taux de réponse | aucun | 65 % | **75 %** |
| Enquête d'antécédents | oui | oui | oui |

- **Points :** 100 points par piste à laquelle le pro répond après le message du
  client (+ 600 pour brancher une intégration partenaire). **Remise à zéro au
  début de chaque période de trois mois.**
- **Taux de réponse :** part des pistes auxquelles on répond **en moins d'une
  heure, entre 8 h et 20 h heure locale** — une piste reçue à 22 h laisse
  jusqu'à 9 h le lendemain. Fenêtre : les **trois mois** précédents.
- **Note :** « calculated on a three-month rolling period, using **verified
  reviews** you've received from Thumbtack customers **from the past
  12 months** ».
- **Quatre périodes d'évaluation par an** : décembre-février, mars-mai,
  juin-août, septembre-novembre. Le statut acquis vaut pour le reste de la
  période **et la suivante**.
- **Badge annuel** si le pro a été Platinum dans **au moins 2 des 4 périodes**.
- Silver et Gold **ne sont visibles que du pro** ; seul Top Pro s'affiche au
  client et dans les résultats de recherche.

**Correction utile :** les chiffres qui circulent partout — « note minimale
4,8 », « 5 avis vérifiés en 12 mois », « répondre en 4 heures » — proviennent de
blogues tiers et **ne correspondent pas à la page officielle actuelle**. Le
seuil est **4,7**, le délai est **1 heure**, et il n'y a **aucun minimum
d'avis** pour le badge. Le « seulement 4 % des pros » n'a **aucune source
officielle** — à ne pas reprendre.

**Le « bloc des trois meilleurs résultats »** est un mécanisme distinct, avec
des seuils **plus bas** : ≥ 4,5 étoiles, ≥ 3 avis, réponse **en 4 heures ou
moins en moyenne**. **[officiel]**
<https://help.thumbtack.com/article/search-results>

**Le prix achète la position — et Thumbtack l'assume.** Parmi les leviers
officiels pour améliorer son rang : « **Adjust your lead prices**. […] Setting
competitive prices helps you **show up higher in search results** ».
**[officiel]** <https://help.thumbtack.com/article/my-rank-in-search-results>
et <https://help.thumbtack.com/article/set-lead-prices>

**Démarrage à froid — le mécanisme le plus intéressant de Thumbtack.**
**[officiel]** <https://help.thumbtack.com/article/ask-for-reviews>

- Barrière d'entrée explicite : « when you first sign up on Thumbtack, you may
  be asked to get **at least one review** before you can start meeting
  customers. »
- **Import d'avis externes autorisé mais plafonné à 10** : « Your profile can
  show **up to 10 reviews** from customers you met outside of Thumbtack. »
- La note **affichée au client** agrège avis Thumbtack + avis Google importés +
  notes importées d'autres sites ; la note **qui donne droit au badge** ne
  compte que les avis vérifiés Thumbtack des 12 derniers mois. **Deux
  définitions, un seul chiffre à l'écran.**

**Critiques :** aucune action de la FTC, aucun règlement avec un procureur
général et aucun jugement contre Thumbtack n'a été trouvé — contraste net avec
Angi. Ce qui existe (plaintes BBB, pétition, article alléguant des pistes
« bogus ») est de qualité probante nettement inférieure ; **aucun recours
collectif certifié n'a pu être vérifié, à ne pas présenter comme un fait.**

### 6.2 Angi / HomeAdvisor — ce qui arrive quand un label ment

**Le règlement FTC de 2023.** **[officiel]**
<https://www.ftc.gov/news-events/news/press-releases/2023/01/ftc-order-requires-homeadvisor-pay-72-million-stop-deceptively-marketing-its-leads-home-improvement>
et <https://www.ftc.gov/news-events/news/press-releases/2023/04/ftc-approves-final-order-against-homeadvisor-inc-deceptively-marketing-its-leads-home-improvement>

- **Jusqu'à 7,2 M$.** Plainte administrative **mars 2022**, ordonnance proposée
  **23 janvier 2023**, ordonnance finale **21 avril 2023**. Cible :
  **HomeAdvisor, Inc.**, « a company affiliated with Angi », opérant aussi sous
  **Angi Leads**.
- **Modèle visé :** adhésion annuelle de **287,99 $** plus un frais par piste.
- **Trois griefs**, sur des pratiques remontant à « at least mid-2014 » : pistes
  hors du champ de service ou hors zone (« many of them do not » correspondre) ;
  taux de conversion annoncé « much higher than it can substantiate » ; et un
  abonnement d'un mois à mHelpDesk (59,99 $) présenté comme gratuit.
- **Interdictions :** ne plus prétendre que les pistes concernent des personnes
  « **ready to hire** » ou ayant « submitted a request for home services
  directly to HomeAdvisor ». Pénalité civile jusqu'à **50 120 $** par infraction.
- **Exécution :** plus de **3 M$ versés, 110 372 chèques** (novembre 2023), soit
  **≈ 27 $ par pro** — très en dessous des sommes dépensées. **[officiel]**
  <https://www.ftc.gov/news-events/news/press-releases/2023/11/ftc-returns-more-3-million-businesses-paid-homeadvisor-memberships-announces-claims-process>

**Le classement acheté — l'accusation historique.** *Moore v. Angie's List* :
règlement de **1,4 M$**, approbation finale le **12 décembre 2016**, portant
précisément sur la question de savoir si les paiements publicitaires
influençaient « service providers' **letter-grade ratings, reviews, and place in
search-result rankings** ». Indemnités de 10 $ et 5 $ par membre. **[tiers]**
<https://www.ibj.com/articles/60052-angies-list-agrees-to-settle-class-action-suit-for-14-million>
Angie's List a par ailleurs reconnu que « revenue from service providers **can
affect the order of search-result rankings** ». **[tiers]**
<https://en.wikipedia.org/wiki/Angi>

**Vermont, 13 octobre 2025 — le mot « certifié » coûte 100 000 $.**
**[officiel]** <https://ago.vermont.gov/blog/2025/10/13/attorney-general-clark-settles-dispute-angi-over-misleading-marketing-practice>

La procureure générale du Vermont obtient **100 000 $** et l'engagement d'Angi
de **cesser d'utiliser « Angi Certified Pro »** ou tout terme suggérant un titre
gouvernemental. Motif : le Vermont n'a pas de processus de certification des
contracteurs, et « Angi itself **does not have a certification process and
cannot confer, or vouch for, credentials** of contractors using its platform ».

**C'est la leçon la plus directement transposable de tout le dossier : un seul
mot de label, emprunté au vocabulaire d'un titre public, a suffi à déclencher
une action d'un procureur général.**

### 6.3 Avvo — noter un professionnel réglementé sans son consentement

**La méthode officielle** (note de 1,0 à 10,0) **[officiel]**
<https://www.avvo.com/support/articles/913946-attorneys-what-is-the-avvo-rating> :

- **Entrent dans le calcul :** années d'inscription au barreau, parcours,
  formation, titres ; prix, publications, conférences, reconnaissance par les
  pairs ; **et les sanctions disciplinaires rapportées par les barreaux**.
- **N'entrent PAS dans le calcul — et c'est capital :** « Client reviews are very
  influential for people considering hiring you, but they are **not a direct
  input into the numerical rating**. » Ni les résultats obtenus, ni la
  personnalité. Et « Advertising, premium products, and other paid services **do
  not influence** your Avvo Rating. »
- **La pondération des facteurs n'est pas publiée.**
- Les profils sont créés **sans consentement** : « We automatically create
  profiles for the vast majority of licensed U.S. attorneys we are able to
  locate. » On ne peut pas supprimer son profil ; on peut seulement **demander**
  que la note ne soit pas affichée, à condition de ne pas chercher de clients par
  Avvo et de n'avoir **aucun antécédent disciplinaire**. Masquage discrétionnaire,
  pas un droit.

**Avvo n'a jamais perdu en justice — toujours sur le Premier Amendement.**

| Affaire | Date | Issue |
| --- | --- | --- |
| *Browne v. Avvo*, 525 F. Supp. 2d 1249 (W.D. Wash.) | 18 déc. 2007 | Rejet : « The rating itself cannot be proved true or false » ; « No reasonable consumer would believe that Avvo is asserting that plaintiff Browne is a '5.5.' » |
| *Davis v. Avvo* (W.D. Wash.) | 28 mars 2012 | Rejet sous la loi anti-SLAPP de Washington |
| *Vrdolyak v. Avvo* (N.D. Ill.) | 12 sept. 2016 | Droit à l'image — rejet ; profils comparés aux Pages Jaunes |
| *Davis v. Avvo* (S.D.N.Y.) | déc. 2018 | Contestation « pay-to-play » — rejet : « A reasonable consumer would view an Avvo rating as just that — the defendant's evaluation » |

**[tiers]** <https://caselaw.findlaw.com/court/us-dis-crt-w-d-was-at-sea/2190675.html>,
<https://blog.ericgoldman.org/archives/2016/09/avvos-attorney-profile-pages-dont-violate-publicity-rights-vrdolyak-v-avvo.htm>,
<https://www.abajournal.com/news/article/avvos-lawyer-ratings-are-protected-by-the-first-amendment-judge-rules-in-false-advertising-suit>

**Mais Avvo Legal Services est mort — huit avis d'éthique concordants.** Le
produit : honoraire fixe **fixé par Avvo**, client payant Avvo, avocat payé
après exécution, puis reversant une « marketing fee » à Avvo.

| Juridiction | Avis | Date |
| --- | --- | --- |
| Ohio | Op. 2016-3 | 3 juin 2016 |
| Pennsylvanie | Formal Op. 2016-200 | sept. 2016 |
| Caroline du Sud | EAO 16-06 | 2016 |
| New Jersey | ACPE 732 / CAA 44 / UPL 54 | 21 juin 2017 |
| New York | NYSBA Op. 1132 | 8 août 2017 |
| Utah | Op. 17-05 | 27 sept. 2017 |
| Virginie | LEO 1885 (proposée) | 17 nov. 2017 |
| Indiana | Op. 1-18 | 9 avril 2018 |

**Fermeture le 31 juillet 2018.** **[tiers]**
<https://www.lawnext.com/2018/07/avvo-legal-services-shut.html>

**Le raisonnement de New York vise la NOTE elle-même**, et c'est ce qui doit
retenir l'attention de Nota :

> « A lawyer may not pay the current marketing fee to participate in Avvo Legal
> Services, because the fee includes an improper payment for a **recommendation**
> in violation of Rule 7.2(a). »

Le comité s'appuie sur le fait qu'Avvo « gives each lawyer an Avvo rating (on a
scale of 1 to 10) » et annonce que cette note permet de trouver « **the right**
lawyer » — ce qui « either expressly states or at least implies or creates the
reasonable impression that Avvo is **'recommending'** those lawyers ».
**[officiel]** <https://nysba.org/ethics-opinion-1132/>

**Autrement dit : afficher une note transforme un annuaire publicitaire en
recommandation, et une recommandation rémunérée est interdite.**

Les autres avis complètent le tableau :

- **New Jersey :** « The label Avvo assigns to this payment ("marketing fee")
  **does not determine the purpose of the fee**. » **[officiel]**
  <https://www.njcourts.gov/sites/default/files/notices/2017/06/n170621f.pdf>
- **Caroline du Sud :** « A lawyer cannot do indirectly what would be prohibited
  if done directly » — deux transactions séparées ne déguisent pas un partage
  d'honoraires. **[officiel]**
  <https://www.scbar.org/for-lawyers/quicklinks/legal-resources/ethics-advisory-opinions/ethics-advisory-opinion-16-06/>
- **Ohio :** un modèle où la plateforme « defines the type of services offered,
  the scope of representation, and the fees charged » est « **antithetical to the
  core components of the client-lawyer relationship** ». **[officiel]**
  <https://www.ohioadvop.org/wp-content/uploads/2017/04/Op_16-003.pdf>
- **Pennsylvanie :** l'idée que des frais de marketing de **20 % à 30 %** des
  honoraires n'interfèrent pas avec le jugement professionnel est « at a
  minimum, of questionable validity ».

### 6.4 Martindale-Hubbell et Super Lawyers — la norme qu'un régulateur exige

**Martindale-Hubbell** (depuis 1887) : sondage confidentiel réservé aux avocats
et juges en exercice ; notes de 1 à 5 sur **cinq critères** — « Legal Knowledge,
Analytical Capabilities, Judgment, Communication Ability and Legal
Experience » ; éligibilité après **3 ans** de barreau. **~10 %** des avocats
détiennent l'AV Preeminent. **[officiel]**
<https://www.martindale.com/marketyourfirm/profiles/peer-ratings/>
Les seuils numériques ne sont plus publiés : ce que Martindale annonce est un
« **confidential threshold number of qualified responses** ». Opacité assumée.

**Super Lawyers** (Thomson Reuters) : nominations par les pairs, recherche
indépendante, évaluation par domaine, sélection finale ; **12 indicateurs** à
pondération inégale ; procédé breveté (U.S. Pat. 8 412 564). Seuils confirmés
officiellement : « **Five percent** of the total lawyers in the state are
selected » ; Rising Stars = les **2,5 %** supérieurs. **[officiel]**
<https://www.superlawyers.com/about/selection-process/>

**L'épisode du New Jersey — c'est la pièce maîtresse de cette section.**

1. **CAA Opinion 39 (2006)** interdit purement et simplement ces mentions. Motif
   sur la méthode : « The methodology used by the media corporation to award the
   "Super Lawyer" designation is **unclear**… they do not make available the
   specific methodology for objective review or analysis », ce qui « underscores
   the **arbitrary** selection and ranking process ». **[officiel]**
   <https://www.njcourts.gov/sites/default/files/notices/2006/07/CAA_Opinion%252039.pdf>
2. **In re Opinion 39, 197 N.J. 66 (17 décembre 2008)** — après un rapport de
   304 pages d'un *Special Master*, la Cour suprême du New Jersey **annule**
   l'interdiction, mais pose la norme : « **The rating or certifying methodology
   must have included inquiry into the lawyer's qualifications and considered
   those qualifications in selecting the lawyer for inclusion.** » *(Le texte
   intégral de l'arrêt est resté inaccessible ; seule cette phrase, citée
   verbatim par le régulateur lui-même, est vérifiée.)*
3. **RPC 7.1(a)(3), amendée le 2 novembre 2009** — trois conditions pour citer un
   classement : nommer l'organisme, une base de comparaison **substantiable**, et
   un avertissement. Le commentaire officiel ajoute **trois conditions de fond
   sur l'organisme** : « (1) the conferrer **has made inquiry into the attorney's
   fitness**; (2) the conferrer **does not issue such an honor or accolade for a
   price**; and (3) a truthful, **plain language description of the standard or
   methodology** upon which the honor or accolade is based **is available for
   inspection**. » **[officiel]**
   <https://www.njcourts.gov/sites/default/files/notices/2009/11/n091104g.pdf>
4. **10 mai 2021** — le comité du New Jersey exige que l'enquête sur l'aptitude
   soit « **more rigorous than a survey or a simple tally of the lawyer's years
   of practice and lack of disciplinary history** », visant nommément les
   distinctions « issued for a price ». **[officiel]**
   <https://www.njcourts.gov/sites/default/files/notices/2021/05/n210510a.pdf>

**Ces trois conditions sont un cahier des charges directement applicable à la
cote de Nota.** Deux sur trois sont déjà satisfaites : la cote enquête bien sur
des qualités du notaire, et la méthodologie *peut* être publiée en langage
clair. La troisième — « does not issue such an honor **for a price** » — est
précisément celle que le barème 15 %→5 % met en danger : la cote n'est pas
vendue, mais elle **fixe un prix**, ce qui n'est pas la même chose et devra être
expliqué.

**Constat structurel à garder en tête :** la Commission ABA Ethics 20/20 a
**refusé d'auditer les méthodologies** de ces services en 2011, invoquant leur
nombre et un coût supérieur à **1 M$** en psychométriciens et statisticiens.
**[tiers]** <https://www.newyorklegalethics.com/aba-studies-super-best-and-other-lawyer-rankings-part-ii/>

### 6.5 Plateformes juridiques de mise en relation — la règle de survie

**LegalMatch revendique explicitement de NE PAS classer :** « LegalMatch
pre-screens member attorneys… we **do not rate, rank or otherwise recommend**
specific members. » Le client remplit un questionnaire anonymisé et les avocats
intéressés répondent eux-mêmes. Frais d'adhésion **mensuels forfaitaires**,
jamais un pourcentage des honoraires. Un système d'avis clients existe, mais **ne
sert pas à classer**. **[officiel]**
<https://www.legalmatch.com/attorneys/ethicsFAQs.html>

LegalMatch a obtenu des approbations d'éthique en Caroline du Sud, au Texas
(#573, août 2006), au Rhode Island, en Ohio et en Caroline du Nord.

**La règle de discrimination qui ressort de tout le corpus américain :** une
plateforme juridique survit aux barreaux quand **(a)** le client choisit
lui-même, **(b)** la plateforme facture un **forfait décorrélé** des honoraires,
et **(c)** elle **ne classe ni ne recommande**. Elle échoue quand sa
rémunération **varie avec l'honoraire** ou quand elle **oriente le choix**.
Certains comités ont même explicitement validé une sélection « in the order in
which the lawyers had registered with the service, i.e., on a **first come,
first served basis** » — l'antithèse exacte du classement au mérite.

Source primaire la plus complète du corpus : l'étude *Client-Lawyer Matching
Services* de l'ARDC de la Cour suprême de l'Illinois (30 mai 2018). **[officiel]**
<https://iaals.du.edu/sites/default/files/documents/publications/il_matching_services_study.pdf>

**UpCounsel** publie des avis clients mais **aucune méthodologie de classement**
— information officielle absente. **L'annuaire de partenaires de Clio** : rien
de public sur des critères de classement — **non documenté publiquement au
2026-09-01.**

### 6.6 Québec — ce qui existe, et ce que dit le droit

**Aucune plateforme au Québec n'attribue de note chiffrée ni ne publie d'avis
clients sur des notaires individuels.** Vérifié service par service :

| Service | Notation ? |
| --- | --- |
| Bottin officiel CNQ (<https://trouverunnotaire.cnq.org/>) | recherche par nom ou rayon 5–50 km — **aucune note, aucun avis, aucun classement** |
| Notairo | plateforme technologique, prix affichés — **aucune notation de notaires** |
| JuriGo, JurisRéférence, Notaire-Direct | mise en relation par soumissions — **aucune note publiée** |
| Neolegal | avis publics sur l'entreprise, jamais sur un professionnel individuel |
| Lexpert, Chambers Canada | par les **pairs**, pour des **avocats**, jamais de note chiffrée ni d'avis clients ; ne couvrent pas le notariat québécois |

**Ce n'est pas un trou de marché : c'est une conséquence réglementaire.**

**Code de déontologie des notaires (RLRQ c. N-3, r. 2)** — articles vérifiés sur
<https://www.legisquebec.gouv.qc.ca/fr/document/rc/N-3,%20r.%202> **[officiel]** :

- **Art. 70 — l'article le plus dangereux pour Nota :** « Le notaire ne peut,
  dans sa publicité, utiliser **ou permettre que soit utilisé** un témoignage
  d'appui ou de reconnaissance qui le concerne, à l'exception des prix
  d'excellence et autres mérites soulignant une contribution ou une réalisation
  dont l'honneur a rejailli sur la profession. » Interdiction **sans exception
  pour les avis authentiques**, et le verbe « permettre que soit utilisé »
  atteint le notaire simplement listé sur une plateforme qui affiche des avis.
- **Art. 69** : ne s'attribuer des qualités ou habiletés particulières « que s'il
  est en mesure de les justifier ». **Art. 68** : aucune publicité fausse,
  trompeuse, incomplète ou susceptible d'induire en erreur.
- **Art. 32 — partage d'honoraires :** interdit avec « une personne qui n'est pas
  membre d'un ordre professionnel régi par le Code des professions… ou de l'une
  des organisations visées à l'Annexe A ». L'Annexe A est une **liste fermée**
  (ordres comptables, OACIQ, AMF, ordres de juristes, Institut canadien des
  actuaires) : **une plateforme technologique ne peut pas y figurer.**
- **Art. 33** : hors rémunération et commissions auxquelles il a droit, verser ou
  recevoir « **tout autre avantage** » relatif à l'exercice de sa profession est
  interdit. **Art. 34** : divulgation écrite obligatoire au client de tout
  honoraire ou commission versé à un tiers ou reçu d'un tiers.
- **Art. 29.1** : aucune convention « ayant pour effet de mettre en péril
  l'indépendance, le désintéressement, l'objectivité et l'intégrité requis ».
  **Art. 31** : « Le notaire doit **ignorer toute intervention d'un tiers** qui
  pourrait influer sur l'exécution de ses devoirs professionnels. »
- **Le prix affiché est permis, sous conditions. Art. 71** : honoraires
  compréhensibles pour un profane, **maintenus au moins 60 jours** après la
  dernière diffusion, services inclus précisés, mention si débours et taxes sont
  inclus. **Art. 72** : « Le notaire ne peut… accorder dans une déclaration ou un
  message publicitaire **plus d'importance aux honoraires professionnels
  demandés qu'au service professionnel offert**. » **Art. 51** : prévenir le
  client du coût approximatif.

**Loi sur le notariat (RLRQ c. N-3), art. 32.1** — introduit par la **Loi 23 de
2023**, en vigueur le **24 octobre 2023**. C'est la disposition la plus
déterminante du dossier : **[officiel]**
<https://www.legisquebec.gouv.qc.ca/fr/document/lc/N-3>

> « Est présumée **usurper les fonctions de notaire** toute personne autre qu'un
> membre de l'Ordre, agissant comme **intermédiaire** entre une tierce personne
> et un notaire, qui soit :
> 1° accorde ou promet… à une tierce personne une **réduction des honoraires** et
> frais de ce notaire ;
> 2° **obtient d'un notaire qu'il abandonne une partie de ses honoraires** et
> frais ;
> 3° procure, promet ou convient de procurer à cette tierce personne des services
> professionnels, **sans aucune responsabilité de sa part envers le notaire pour
> ses honoraires** et frais. »

Sanction : art. 33 L.N. renvoyant à l'**art. 188 du Code des professions** —
amende de **2 500 à 62 500 $** (personne physique) ou **5 000 à 125 000 $**
(autres cas), doublée en récidive.

**La CNQ s'est prononcée explicitement, le 25 janvier 2024.** Mise en garde du
Bureau du syndic, signée par la syndique, à la suite de l'entrée en vigueur de la
Loi 23. **[officiel]**
<https://www.cnq.org/la-chambre-et-votre-protection/actualites-et-salle-de-presse/loi-23-mise-en-garde-du-bureau-du-syndic/>

> « ne laissant **aucun "intermédiaire"** (personne ou société) dicter votre
> conduite… »
> « Il est donc **proscrit** : […] de laisser un intermédiaire **offrir vos
> services, dicter votre conduite ou la portée de votre mandat ou fixer ou
> partager vos honoraires**. »
> « Au besoin, nous n'hésiterons pas à prendre les recours qui s'imposent face à
> toute contravention de la loi. »

La CNQ visait explicitement « certains modèles d'affaires en place ».

**La seule voie de conformité identifiée : le bac à sable réglementaire.**

- **Art. 198.1 du Code des professions** : le ministre peut autoriser par arrêté
  un projet pilote dont les normes « **s'appliquent malgré toute disposition
  inconciliable** » d'une loi ou d'un règlement d'ordre ; durée maximale **deux
  ans**, prolongeable d'un an. **[officiel]**
  <https://www.legisquebec.gouv.qc.ca/fr/document/lc/C-26>
- **Barreau du Québec** — projet pilote de services juridiques novateurs, publié
  à la Gazette officielle le **20 mai 2026**, permettant à « une entité qui n'est
  pas autorisée à exercer la profession, ou n'est pas détenue par des avocats »
  d'offrir consultations, avis et rédaction juridiques. **[officiel]**
  <https://www.barreau.qc.ca/en/new/notices-to-members/projet-pilote-services-juridiques-novateurs/>
  *L'avis ne mentionne toutefois aucune dérogation aux règles de partage
  d'honoraires.*
- **Chambre des notaires : aucun bac à sable trouvé.** Sa seule position publique
  sur les intermédiaires est la mise en garde de 2024, qui va en sens inverse.
- **Ontario, Access to Innovation (LSO)** : lancé le **8 novembre 2021**, pilote
  de cinq ans ouvert aux non-titulaires de permis. **Deeded** y a été admise et se
  décrit comme « a technology platform and is **not a law firm** ». **[tiers]**
  <https://www.deeded.ca/blog/deeded-joins-the-law-society-of-ontario-a2i>

**Ce qui n'a pas pu être établi :** **aucune décision disciplinaire n'a été
trouvée** portant sur le partage d'honoraires d'un notaire avec une plateforme,
sur une commission de référencement, ou sur l'affichage de notes. Les décisions
du Conseil de discipline sont publiques via SOQUIJ ; une recherche plein texte
serait nécessaire. **Absence de preuve, pas preuve d'absence — ne pas affirmer
qu'il n'y a pas de jurisprudence.**

---

## 7. eBay et Etsy — le taux indexé sur une note, et le comparable « faible volume »

eBay est, avec Upwork (§5.2), l'un des **deux seuls cas** de ce dossier où une
plateforme fait exactement ce que Nota veut faire : **moduler sa commission
selon la performance du prestataire.** C'est aussi le seul qui assortit la
récompense d'une **pénalité symétrique**.

- **Top Rated Seller** : compte actif depuis au moins 90 jours, **au moins 100
  transactions et 1 000 $ de ventes avec des acheteurs américains sur les
  12 derniers mois**, conformité à la politique de vente. **[officiel]**
  <https://export.ebay.com/en/growth/seller-performance/top-rated-seller/>
- **Récompense : 10 % de rabais sur les frais de vente finale** (Top Rated
  Plus). **[officiel]** (même page) — c'est un rabais sur *le taux*, pas un
  bonus en argent.
- **Pénalité symétrique :** un compte évalué **Below Standard** paie **6 % de
  frais supplémentaires** sur les frais de vente finale du mois civil suivant,
  et **7 %** après quatre mois consécutifs sous la norme, jusqu'au retour à
  Above Standard. **[officiel]**
  <https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822>
- **L'évaluation a lieu le 20 de chaque mois**, sur les métriques affichées
  dans le Seller Hub. **[officiel]** (même page ; je n'ai pas pu ouvrir
  `ebay.com/help/policies/selling-policies/seller-standards-policy?id=4347`,
  qui porte les seuils exacts de taux de défaut — à vérifier avant de citer un
  chiffre précis.)

### Etsy Star Seller — le comparable « faible volume » le plus proche

Etsy est le seul acteur étudié dont le prestataire type fait **quelques
commandes par mois**, comme un notaire fera quelques actes par trimestre sur
Nota. Sa mécanique est donc directement transposable :

- Quatre critères sur une **période glissante de trois mois** : taux de réponse
  aux messages ≥ **95 %** (première réponse dans les **24 h**), expédition à
  l'heure avec suivi ≥ **95 %**, note moyenne ≥ **4,8**, et **au moins
  5 commandes complétées**. **[tiers]**
  <https://craftybase.com/blog/how-to-become-etsy-star-seller>
- **Le badge est évalué le 1<sup>er</sup> de chaque mois**, en regardant les
  trois derniers mois, et **seulement à partir de 90 jours après la première
  vente**. **[tiers]** (même source)
- Détail remarquable : **une réponse automatique compte** comme réponse valide
  pour le taux de réponse. Etsy mesure explicitement la *fiabilité du canal*,
  pas l'engagement commercial. **[tiers]** (même source)

Page officielle de référence : <https://help.etsy.com/hc/en-us/articles/4403058372503-What-is-the-Star-Seller-Badge>
— **HTTP 403 en lecture automatisée**, les chiffres ci-dessus proviennent donc
d'une source tierce et sont à confirmer à la main.

**Ce que ça règle pour Nota :** un minimum de **5 actes** et une fenêtre de
**3 mois** suffisent à Etsy pour décerner un statut à un vendeur artisanal.
C'est l'ordre de grandeur réaliste pour le notariat — pas les **50 actes** que
la cible de l'axe « services rendus » exige aujourd'hui.

**Trois enseignements pour Nota, tous copiables :**

1. eBay module son **taux**, pas la rémunération de base du vendeur. Le
   vendeur fixe son prix ; eBay ajuste **sa propre part**. C'est exactement la
   structure de l'ADR 0027 — bonne nouvelle.
2. **L'amplitude d'eBay est faible et symétrique** — de −10 % à +6 %/+7 % sur les
   frais — alors que Nota varie d'un facteur 3 (15 % → 5 %). Mais la §5.2 montre
   qu'une amplitude comparable à celle de Nota existe : Upwork facture
   officiellement « 0 % to 15 % per contract ». **L'amplitude n'est donc pas
   l'anomalie** ; ce qui manque à Nota, c'est le garde-fou d'Upwork — le taux
   figé à l'engagement et annoncé d'avance.
3. Le seuil d'entrée est **volumétrique et daté** (100 transactions / 12 mois),
   ce qui évite le problème que Nota va rencontrer : un professionnel à faible
   volume n'atteint jamais le palier.

---

## 8. Verdict opérationnel pour Nota

### Le cadre déontologique — plus serré qu'aucune plateforme des §1 à §5 n'a à l'être

Un notaire est un **officier public**. La §6.6 a établi le droit applicable, et
trois dispositions mordent directement sur la cote. Elles ne sont pas des
nuances : ce sont des interdictions.

**(1) Art. 70 du Code de déontologie des notaires — le témoignage client est
interdit.** « Le notaire ne peut, dans sa publicité, utiliser **ou permettre que
soit utilisé** un témoignage d'appui ou de reconnaissance qui le concerne, à
l'exception des prix d'excellence et autres mérites soulignant une contribution
ou une réalisation dont l'honneur a rejailli sur la profession. » **[officiel]**
<https://www.legisquebec.gouv.qc.ca/fr/document/rc/N-3,%20r.%202>

Il n'y a **aucune exception pour les avis authentiques**, et « permettre que soit
utilisé » atteint le notaire simplement listé sur une plateforme qui affiche des
avis. L'axe satisfaction — 40 points sur 100, le plus lourd — repose entièrement
sur un matériau que le Code interdit d'exposer publiquement.

**(2) Art. 32 — le partage d'honoraires avec un non-membre est interdit**, la
liste des exceptions (Annexe A du N-3, r. 7) étant **fermée** et ne pouvant pas
accueillir une plateforme technologique. Et l'art. 33 ferme la voie de contournement :
hors rémunération et commissions auxquelles il a droit, le notaire ne peut verser
ni recevoir « **tout autre avantage** » relatif à l'exercice de sa profession.

**(3) Loi sur le notariat, art. 32.1 (en vigueur le 24 octobre 2023) — c'est la
disposition la plus lourde du dossier.** Est **présumée usurper les fonctions de
notaire** toute personne autre qu'un membre de l'Ordre, agissant comme
**intermédiaire**, qui « **obtient d'un notaire qu'il abandonne une partie de ses
honoraires** ». Sanction : **2 500 à 125 000 $** selon le cas, doublée en
récidive. **[officiel]** <https://www.legisquebec.gouv.qc.ca/fr/document/lc/N-3>

Et la Chambre a explicitement prévenu, le **25 janvier 2024**, qu'il est
« **proscrit** […] de laisser un intermédiaire offrir vos services, dicter votre
conduite ou la portée de votre mandat ou **fixer ou partager vos honoraires** »,
en ajoutant : « nous n'hésiterons pas à prendre les recours qui s'imposent ».
**[officiel]** <https://www.cnq.org/la-chambre-et-votre-protection/actualites-et-salle-de-presse/loi-23-mise-en-garde-du-bureau-du-syndic/>

À quoi s'ajoutent deux obligations qui, elles, jouent **en faveur** du notaire
contre la cote :

- **Avant d'accepter un mandat, le notaire doit tenir compte des limites de ses
  connaissances ainsi que des moyens dont il dispose.** Refuser un dossier qu'il
  ne peut pas porter n'est pas un défaut de service, **c'est une obligation**.
- **Art. 72 :** le notaire ne peut « accorder dans une déclaration ou un message
  publicitaire **plus d'importance aux honoraires professionnels demandés qu'au
  service professionnel offert** » — contrainte directe sur une interface « prix
  d'abord ». **Art. 71 :** un prix annoncé doit être **maintenu au moins 60
  jours** après la dernière diffusion.

**Le standard que le régulateur exigera de la cote elle-même.** La meilleure
formulation trouvée vient du New Jersey, à propos des classements d'avocats
(§6.4). Pour qu'une distinction puisse être citée, l'organisme qui la décerne
doit remplir trois conditions : « (1) the conferrer **has made inquiry into the
attorney's fitness**; (2) the conferrer **does not issue such an honor or
accolade for a price**; and (3) a truthful, **plain language description of the
standard or methodology** upon which the honor or accolade is based **is
available for inspection**. » **[officiel]**
<https://www.njcourts.gov/sites/default/files/notices/2009/11/n091104g.pdf>

Et le raisonnement de la NYSBA contre Avvo (§6.3) va plus loin : **afficher une
note transforme un annuaire en recommandation**, et une recommandation rémunérée
est interdite. **[officiel]** <https://nysba.org/ethics-opinion-1132/>

**Point de comparaison réglementaire, hors Québec :** la directive européenne
2024/2831 sur le travail de plateforme impose depuis le 1<sup>er</sup> décembre
2024 une supervision humaine des systèmes automatisés, un **droit à
l'explication** de toute décision algorithmique significative, un **droit de
contestation**, et interdit les décisions de désactivation **purement**
automatisées. **[tiers]**
<https://www.consilium.europa.eu/en/press/press-releases/2024/03/11/platform-workers-council-confirms-agreement-on-new-rules-to-improve-their-working-conditions/>
Ce texte ne s'applique pas au Québec, mais il décrit exactement le standard
qu'un ordre professionnel exigera si la cote lui est présentée.

**Ce que cela ne dit pas.** Rien de ce qui précède ne condamne la cote comme
outil interne d'affectation ou de qualité. Ce qui est en cause est précis :
**(a)** l'affichage public d'avis clients sur un notaire nommé, **(b)** une part
de Nota calculée en pourcentage des honoraires du notaire, **(c)** une note qui
oriente le choix du client. L'ADR 0027 avait déjà identifié (b) et budgété
20 000 $ pour un avis écrit ; la présente veille ajoute (a) et (c), qui n'étaient
pas au dossier.

### 8.1 Ce que l'algorithme fait bien

1. **La moyenne bayésienne (a priori 4,0 sur 5 avis fictifs) est la bonne
   décision, et Nota est en avance sur l'industrie ici.** Uber démarre à 5
   étoiles (présomption flatteuse qui s'effondre), Lyft ne dit rien, DoorDash
   attend 50 livraisons avant d'admettre au programme. Nota amortit les
   premiers avis dans les deux sens : cinq complaisances n'achètent pas le
   sommet, un client difficile ne détruit pas un notaire. C'est la pratique
   documentée dans la littérature sur le *cold start* (formule BR = (C·m +
   Σrᵢ)/(C + n)). **[tiers]** <https://arpitbhayani.me/blogs/bayesian-average/>
2. **Le rendement décroissant en racine carrée sur le volume est adapté au
   notariat.** Un axe linéaire aurait donné toute la cote aux gros cabinets.
   La racine carrée fait que les 10 premiers actes pèsent 45 % de ce que
   pèsent les 50. **[estimation Nota]**
3. **La cote est reproductible à la main, et c'est l'atout décisif.**
   `notaryScore` est une somme de quatre nombres arrondis, et chaque axe renvoie
   son `detail`. **Aucune** des plateformes étudiées ne fait cela : Uber ne
   publie pas les seuils de ses paliers (« varie selon le marché »), DoorDash non
   plus (« dépend de la zone »), Upwork publie une formule agrégée mais aucune
   pondération, Fiverr ne chiffre même pas la fenêtre de son Success Score,
   Avvo et Martindale revendiquent l'opacité. Or le standard qu'un régulateur
   exige est précisément l'inverse : « a truthful, **plain language description
   of the standard or methodology** upon which the honor or accolade is based
   **is available for inspection** » (New Jersey RPC 7.1, §6.4). **Nota est la
   seule à pouvoir satisfaire ce critère — il faut donc le publier, pas
   seulement le coder.**
4. **Le domaine ne connaît pas le mot « commission ».** La frontière ADR 0008
   tient : `packages/domain` produit un nombre, `commission-config.js` le
   traduit. Si la Chambre exige de retirer la modulation, une seule couche
   change.
5. **L'a priori de disponibilité ne comble que les observations manquantes**
   (`manque = max(0, 5 − vues)`). Un notaire qui a répondu 20 fois sans
   décliner est bien à 100 %, sans dilution résiduelle. C'est correct.

### 8.2 Ce qui cloche, avec le correctif chiffré

#### (a) Il n'y a aucune fenêtre temporelle — c'est l'anomalie n° 1

Toute l'industrie mesure sur une fenêtre glissante : Uber 500 courses, Lyft 100
courses, DoorDash 100 offres, Airbnb 12 mois, eBay 12 mois, Etsy 3 mois, Thumbtack
3 mois de points sur 12 mois d'avis, Fiverr 2 ans sur la note et 90 jours sur la
réactivité. **Nota mesure depuis toujours.** Conséquences :

- Un notaire excellent en 2027 qui décroche en 2029 conserve sa cote.
- Un notaire qui a mal démarré traîne ses trois premiers avis à vie.
- Aucun mécanisme ne permet de « se racheter ».

**Et la meilleure solution existe déjà, chez Upwork.** Plutôt qu'une fenêtre,
Upwork en calcule **trois en parallèle — 6, 12 et 24 mois — et retient la plus
favorable** : « The best score out of these moving time windows is your JSS. »
**[officiel]**
<https://support.upwork.com/hc/en-us/articles/38437480577939-When-is-my-JSS-calculated>

C'est la réponse exacte au dilemme de Nota. À faible volume, une fenêtre courte
est bruyante et une fenêtre longue est inerte ; le « meilleur des trois » évite
d'avoir à choisir, et surtout **le notaire n'est jamais puni par le choix de la
fenêtre**. Un notaire qui a un mauvais trimestre garde sa fenêtre de 24 mois ;
un notaire qui s'est redressé bascule automatiquement sur celle de 6 mois.

**Correctif chiffré :** calculer la cote sur **trois fenêtres glissantes — 6, 12
et 24 mois — et retenir la meilleure**, sur les avis, les actes et la
disponibilité. Si une seule fenêtre est retenue pour des raisons de coût, alors
**24 mois avec décroissance exponentielle de demi-vie 12 mois** (poids
`0,5^(âge_mois / 12)` : un avis d'il y a 12 mois pèse 0,5 ; d'il y a 24 mois,
0,25). **[estimation Nota]** La demi-vie est préférable au couperet parce qu'au
volume notarial (voir (b)), un couperet à 12 mois ferait tomber la cote d'un
notaire compétent d'un coup, sans qu'il ait rien fait.

Coût technique : `cote.js` ne peut plus lire un seul item. Il faut un ledger
horodaté (il existe déjà pour les évaluations : `NOTARY#/EVAL#`, ADR 0021) et
des compteurs seau-par-mois pour les actes et la disponibilité.

#### (b) Le volume notarial ne supporte pas une métrique de type « taux d'acceptation »

Uber recalcule son taux d'acceptation sur 100 demandes — reconstituées en une
journée. Un notaire de la région de Québec (≈ 400 notaires pour ce marché,
source interne `validation-notaires.md`) verra, dans les premiers trimestres de
Nota, **quelques dizaines de demandes par an au mieux**. Le dénominateur reste
petit **en permanence**.

Simulation exécutée contre le code actuel **[estimation Nota]** :

| Situation | Cote | Effet |
| --- | ---: | --- |
| Notaire à 6 réponses, 0 déclin | 83 | 8 % |
| Le même, **1 seul déclin** (5 réponses, 1 déclin) | **81** | 8 % |
| Le même, 2 déclins | **79** | **10 %** — franchit le palier 80 vers le bas |
| Notaire mûr : 18 réponses, 0 déclin | 89 | 8 % |
| Le même, 3 déclins | 87 | 8 % |

**Un seul refus légitime coûte 2 points à faible volume**, et deux refus font
basculer un palier — soit **2 points de pourcentage sur chaque acte futur**,
40 $ par acte à 2 000 $. Un notaire qui refuse un dossier hors de sa compétence,
comme le Code l'y oblige, est financièrement puni pour l'avoir fait.

**Correctifs, dans l'ordre de préférence :**

1. **Le meilleur : cesser de compter les déclins.** Copier Airbnb — mesurer
   **le fait de répondre dans un délai**, pas le fait d'accepter. Concrètement :
   remplacer `taux = repondu / (repondu + declinees)` par
   `taux = (repondu + declinees_dans_les_48h) / demandes_vues`, où un déclin
   explicite **compte comme une réponse** et seul le **silence** pénalise. Le
   sous-axe reste à 12 points ; il mesure la fiabilité, plus le consentement.
   C'est aussi ce que DoorDash a fini par faire pour l'acceptation.
   **[officiel]** Airbnb : <https://www.airbnb.com/help/article/829> ;
   DoorDash : <https://help.doordash.com/en-us/dashers/article/dasher-ratings-explained>
2. **Si le propriétaire veut garder un signal d'acceptation :** offrir un motif
   de refus déontologique (« hors de mes champs de compétence », « conflit
   d'intérêts », « capacité insuffisante ») qui **neutralise** le déclin, sur le
   modèle de la protection des notes d'Uber et de DoorDash — qui retirent tous
   deux les évaluations attribuables à des causes hors du contrôle du
   prestataire. Plafonner à **3 refus neutralisés par trimestre** pour éviter
   l'usage systématique. **[estimation Nota]**
3. **Dans tous les cas : plafonner la perte.** Aucun axe ne devrait pouvoir
   faire varier la cote de plus de ce qui sépare deux paliers. Concrètement,
   ramener le sous-axe « taux de réponse » de **12 à 8 points** et reverser les
   4 points à la satisfaction (40 → 44) : la disponibilité arrête d'être un
   levier de bascule de palier.

#### (c) La cible de satisfaction à 4,8 est mal calibrée pour un système à notes inflatées

Ce que le code exige réellement pour les 40 points pleins **[estimation Nota,
dérivée de la formule]** : il faut `n·(N − 4,8) ≥ 4`, donc

| Note moyenne réelle | Avis nécessaires pour 40/40 |
| ---: | ---: |
| 5,00 | 20 |
| 4,90 | 40 |
| 4,85 | 80 |
| ≤ 4,80 | **jamais** |

Un notaire à 4,8 — la barre du Superhost Airbnb, un excellent score — ne peut
**mathématiquement jamais** atteindre le maximum de l'axe. Et pendant ce temps,
la littérature dit que 85 % des évaluations sur ces plateformes sont parfaites
(Filippas et al.) et que la réciprocité gonfle encore les distributions
(Zervas et al.). Fiverr l'a reconnu officiellement en refondant son système :
« **The previous system often led to near-perfect scores, making it challenging
for exceptional work to stand out.** » (§5.3). La cible de Nota est donc
simultanément **trop haute en absolu** et **trop basse par rapport à la
distribution réelle** : elle sépare mal.

**Attention au correctif évident, qui est un piège.** La réaction naturelle est
d'étalonner sur la distribution observée — plancher au 25<sup>e</sup> centile,
cible au 90<sup>e</sup> centile de la cohorte. **C'est exactement ce que fait
Fiverr, et c'est documenté comme un échec.** Le Success Score « is based on your
performance **relative to other freelancers in your price range** »
**[officiel]** <https://help.fiverr.com/hc/en-us/articles/21965360854673-Success-score> —
avec pour conséquence qu'un prestataire irréprochable peut voir son score baisser
sans avoir rien changé, parce que ses pairs ont progressé. C'est un classement
déguisé en note, et c'est ce qui a déclenché la crise de 2024 (§5.4). Pour une
cote qui **fixe une rémunération**, un score relatif est indéfendable : le
notaire ne peut ni le prévoir, ni le refaire à la main, ni le contester.

**Correctif chiffré :** garder une échelle **absolue et arithmétique**, mais
**recalibrer ses constantes périodiquement et les publier**. Concrètement :
baisser la cible de **4,8 à 4,7** — ce qui rend l'axe atteignable à 4,75 avec
40 avis et à 4,9 avec seulement 21 — et **réviser plancher et cible une fois
par an**, par décision documentée dans la console admin (le mécanisme d'édition
existe déjà), à la lumière de la distribution observée. La différence avec
Fiverr est essentielle : **la constante est fixée à l'avance et publiée**, pas
recalculée en continu contre les pairs. Un notaire doit pouvoir dire « il me
faut 4,7 », pas « il me faut faire mieux que les autres ». **[estimation Nota]**

#### (d) Le sous-axe « éventail » punit la spécialisation, ce qui est déontologiquement à l'envers

Le catalogue compte **deux** services. Un notaire qui ne fait que du
refinancement perd **3,5 points sur 100** — soit, à la frontière d'un palier,
2 à 3 points de pourcentage de revenus — *parce qu'il ne fait pas d'actes de
financement*. Or le Code lui commande de tenir compte des limites de ses
connaissances avant d'accepter un mandat.

Simulation : le notaire excellent passe de **99 à 96** en ne servant qu'un seul
des deux services. **[estimation Nota]**

**Correctif :** supprimer le sous-axe « éventail » et reverser ses 7 points au
volume (18 → 25), **ou** ne l'activer qu'à partir d'un catalogue de 4 services
ou plus. Aucune plateforme étudiée ne récompense l'étendue de gamme ; toutes
récompensent le volume et la qualité.

#### (d-bis) La cible de 50 actes est hors d'échelle pour le notariat

`services.cible = 50` définit le volume qui vaut les 18 points pleins. Aux
seuils de volume du reste de l'industrie, c'est démesuré : Etsy décerne son
statut à **5 commandes** sur 3 mois, Airbnb à **10 réservations** sur 12 mois,
DoorDash admet au programme à **50 livraisons** (que l'on fait en une semaine),
eBay exige 100 transactions sur 12 mois pour un **commerçant**. Aucun n'exige
50 transactions d'un professionnel qui en fait quelques-unes par trimestre.

À 20 actes, l'axe rend 11,4 points sur 18 ; il faut **50 actes** pour le
saturer — soit, à un rythme réaliste de 15 à 25 actes Nota par an,
**deux à trois ans**. **[estimation Nota]**

**Correctif :** ramener `cible` de **50 à 24 actes**, mesurés sur la fenêtre
glissante de 24 mois recommandée en (a). Un notaire à 12 actes sur deux ans
rend alors 12,7 points sur 18 au lieu de 8,8. **[estimation Nota]**

#### (e) L'axe « présence » achète 12 points sans qu'aucun client soit servi

Fiche CNQ (5) + secteur postal (3) + activité récente (4) = **12 points sur
100** pour avoir rempli un formulaire et ouvert la console. Un notaire neuf et
bien configuré est à **51**. C'est un tiers du chemin vers le premier palier,
gagné sans un seul acte.

Ce n'est pas absurde — c'est un **bonus de démarrage à froid déguisé**, et il
est utile. Mais il est mal nommé et mal placé : il gonfle la même échelle qui
sert à récompenser le mérite, ce qui rend la cote moins lisible et moins
défendable devant un ordre professionnel (« pourquoi 5 points pour un lien
hypertexte ? »).

**Correctif :** sortir la fiche CNQ et le secteur postal de la cote et en faire
des **conditions d'admission** (on ne publie pas au fil sans fiche CNQ ni
secteur — la fiche CNQ est déjà la source d'autorité de l'ADR 0016). Ramener
l'axe présence à **7 points** (activité récente 4 + ancienneté 3) et reverser
les 8 points libérés à la satisfaction. **[estimation Nota]**

#### (f) Les paliers sont des falaises, et l'amplitude est trois fois celle du marché

Un point de cote peut coûter 2 à 3 points de pourcentage sur **chaque acte
futur**. eBay, comparable le plus proche côté commerce, va de −10 % à +6 % sur
ses frais.

**Correction par rapport à ce que j'écrivais avant la §5 : le taux variable
existe bel et bien ailleurs, et sur une amplitude comparable.** Upwork facture
aujourd'hui « **0 % to 15 % per contract** ». **[officiel]**
<https://support.upwork.com/hc/en-us/articles/211062538-Learn-about-the-Freelancer-Service-Fee>
L'amplitude de Nota (5–15 %) n'est donc pas une aberration. **Ce qui manque à
Nota, c'est le garde-fou qui accompagne ce taux chez Upwork :**

> « Once your contract begins, **the fee is fixed and won't change**. »

et le taux est affiché **avant** que le prestataire soumette sa proposition ou
accepte l'offre. **[officiel]** (même page)

Chez Nota aujourd'hui, `billing.js` appelle `coteFor` **au moment de facturer** :
un notaire peut retenir un acte alors que sa cote lui vaut 8 %, et le régler à
10 % parce qu'il aura décliné deux demandes entretemps. C'est le défaut le plus
facile à corriger et le plus difficile à défendre s'il subsiste.

**Correctifs :**

1. **Lisser.** Remplacer l'escalier par une interpolation linéaire entre 60 et
   90 : `taux = 0,12 − 0,07 × (cote − 60) / 30`, borné à [0,05 ; 0,15]. Un
   point de cote vaut alors **0,23 point de pourcentage**, pas 3. Le barème
   reste éditable depuis la console (`commission-config.js` valide déjà la
   monotonie décroissante — il faudrait valider une pente, pas des marches).
2. **Ou, si le propriétaire tient à l'escalier** : ajouter une **hystérésis**.
   Un palier s'acquiert à la cote `C` et ne se perd qu'à `C − 3`. C'est
   l'équivalent conceptuel du *Platinum Pass* de DoorDash. **[officiel]**
   <https://help.doordash.com/dashers/s/article/Platinum-Pass?language=en_US>
3. **Et dans les deux cas, le correctif prioritaire : figer le taux au moment de
   la retenue de l'acte, pas au moment du règlement, et l'afficher au notaire
   avant qu'il s'engage.** C'est littéralement la règle d'Upwork citée ci-dessus,
   et c'est le reproche central de Dubal sur la rémunération variable opaque.
   **[tiers]**
   <https://www.columbialawreview.org/wp-content/uploads/2023/11/Dubal-On_Algorithmic_Wage_discrimination.pdf>
   Coût technique : quelques lignes — figer `taux` sur l'item de l'acte au
   moment de la retenue et le lire au règlement, au lieu de recalculer.

#### (g) Il n'y a ni seuil éliminatoire, ni recours

Toutes les plateformes étudiées ont un plancher qui *sort* du marché : Uber
désactive sur note basse, DoorDash sur complétion < 90 %, Airbnb retire le
badge, eBay surtaxe. Nota n'a rien : un notaire à cote 20 reste au fil, il paie
seulement 15 %.

**Correctif :** deux seuils, distincts du barème de rémunération.

- **Alerte à cote < 45** (courriel, cote affichée en console, pas de sanction).
- **Suspension du fil à cote < 35 avec au moins 5 actes complétés** — la
  condition de volume évite de couperer un notaire neuf, qui démarre justement
  à 35. **[estimation Nota]**
- **Et un recours humain obligatoire avant toute suspension**, avec motif
  écrit. C'est ce que la Cour d'appel d'Amsterdam a exigé d'Uber, ce que la
  directive 2024/2831 impose en Europe, et ce qu'un ordre professionnel exigera
  ici. **[tiers]**
  <https://fountaincourt.uk/2023/04/amsterdam-court-upholds-appeal-in-algorithmic-decision-making-test-case-drivers-v-uber-and-ola/>

**Le contre-exemple à ne pas imiter est Upwork**, qui maintient une page dont le
titre acte l'impasse : « JSS is determined by an automated algorithm… **Our
calculations cannot be manually adjusted.** » **[officiel]**
<https://support.upwork.com/hc/en-us/articles/38440432318995-There-s-a-mistake-in-my-JSS-calculation-What-should-I-do>
Un score sans recours est tolérable pour un pigiste ; il ne l'est pas pour un
officier public dont la rémunération en dépend.

#### (h) Il manque la protection des évaluations

Uber et DoorDash retirent **automatiquement** les mauvaises notes causées par
des facteurs hors du contrôle du prestataire ; Lyft laisse exclure la pire note
sur 100. Nota n'a rien. Sur 10 avis à vie, un client mécontent d'un délai
bancaire pèse 10 % de l'axe le plus lourd.

**Correctif :** exclure du calcul les évaluations dont le motif choisi par le
client est **hors du contrôle du notaire** (retard du prêteur, dossier client
incomplet, annulation par le client), et laisser le notaire demander **une**
révision par trimestre, tranchée par un humain. Le ledger `NOTARY#/EVAL#`
existe déjà et peut porter un drapeau d'exclusion.

### 8.3 Recommandation nette : fenêtre temporelle et démarrage à froid

**Fenêtre.** Fenêtre glissante de **24 mois**, avec **décroissance
exponentielle de demi-vie 12 mois** sur les avis et les actes, et **12 mois
fermes** sur la disponibilité. **Recalcul et publication du barème une fois par
trimestre** (1<sup>er</sup> janvier / avril / juillet / octobre), à la manière
d'Airbnb, et **pas en continu**. Motif : au volume notarial, un recalcul continu
transforme chaque acte individuel en événement financier, ce qui est
exactement le mécanisme que Dubal décrit comme délétère ; un recalcul
trimestriel donne au notaire un horizon stable et à Nota une décision
défendable.

**Démarrage à froid.** Le marché des seuils d'entrée observés :

| Plateforme | Ce qu'il faut avant qu'un score existe |
| --- | --- |
| **Upwork** | **2 issues de contrat sur 24 mois, avec 2 clients différents** — sinon **aucun JSS n'est affiché**, et il **disparaît** si la condition cesse d'être remplie **[officiel]** |
| Fiverr | Level 1 à **5 commandes / 3 clients / 400 $** **[officiel]** |
| Etsy | statut évalué seulement **90 jours après la première vente**, minimum **5 commandes** **[tiers]** |
| DoorDash | admission au programme à **50 livraisons** **[officiel]** |
| eBay | **90 jours de compte actif** + 100 transactions / 12 mois **[officiel]** |
| Thumbtack | **au moins 1 avis** avant de pouvoir rencontrer des clients ; **jusqu'à 10 avis importés** de l'extérieur **[officiel]** |

Quatre pièces, et il faut les quatre :

1. **Garder la moyenne bayésienne telle quelle.** C'est la bonne réponse et
   c'est déjà fait.
2. **Ne pas afficher de cote publique tant qu'il n'y a pas 3 évaluations et
   2 clients distincts.** C'est la règle d'Upwork, et elle est plus honnête que
   la nôtre : Nota affiche aujourd'hui **35** à un notaire dont on ne sait
   strictement rien, ce qui est un jugement déguisé en mesure. Un notaire sans
   historique doit lire « pas encore évalué », pas « 35 ». **[estimation Nota]**
3. **Une période de grâce explicite de 6 mois ou 5 actes complétés** (le
   premier atteint des deux) pendant laquelle **le notaire est facturé au
   palier 70 (10 %)**, pas au taux de base de 15 %. Sinon Nota fait payer le
   plus cher à ceux dont elle a le plus besoin pour amorcer le marché — environ
   400 notaires dans la RMR de Québec, aucun n'a d'historique le jour 1.
   **[estimation Nota]**
4. **Retirer la fiche CNQ et le secteur postal de la cote** et en faire des
   conditions d'accès (voir (e)) — le démarrage à froid doit être une politique
   explicite et datée, pas 8 points cachés dans un axe.

**Une piste à évaluer, empruntée à Thumbtack :** autoriser un notaire à importer
un nombre plafonné d'attestations externes au démarrage. Thumbtack le fait
(10 avis maximum, distingués des avis vérifiés). **Mais l'art. 70 du Code de
déontologie l'interdit sans doute au Québec** — c'est précisément un « témoignage
d'appui ou de reconnaissance » que le notaire « permettrait d'utiliser ». À
inscrire dans les questions de l'avis juridique, pas à implémenter.

### 8.4 Tableau final — ce qu'on garde, ce qu'on change, pourquoi

| # | Élément | Décision | Correctif chiffré | Pourquoi |
| --- | --- | --- | --- | --- |
| 1 | Moyenne bayésienne (a priori 4,0 / poids 5) | **On garde** | inchangé | Meilleure pratique de démarrage à froid ; Uber (départ à 5★) et Lyft font moins bien |
| 2 | Volume en racine carrée | **On garde** | inchangé | Neutralise l'avantage des gros cabinets ; adapté au faible volume notarial |
| 3 | Cote reproductible à la main, `detail` par axe | **On garde et on renforce** | publier la formule dans la console notaire | Seule défense crédible devant la Chambre ; DoorDash et Upwork ne publient pas leurs pondérations |
| 4 | Frontière domaine / facturation (ADR 0008) | **On garde** | inchangé | Si la Chambre interdit la modulation, une seule couche change |
| 5 | **Absence de fenêtre temporelle** | **On change** | **Trois fenêtres glissantes — 6, 12, 24 mois — et on retient la meilleure** (modèle Upwork) ; à défaut, 24 mois à demi-vie 12 mois ; recalcul trimestriel | Uber 500 courses, Lyft 100, DoorDash 100, Airbnb 12 mois, eBay 12 mois, Etsy 3 mois — personne ne mesure « depuis toujours ». Le « meilleur des trois » d'Upwork évite qu'un faible volume soit puni par le choix de la fenêtre |
| 6 | **Déclins comptés contre le notaire** | **On change** | Mesurer la *réponse sous 48 h*, pas l'acceptation ; déclin explicite = réponse ; sinon, motif déontologique neutralisant, 3/trimestre max | Le Code oblige le notaire à refuser un mandat hors de ses moyens ; Airbnb compte « accept **or decline** within 24 h » ; DoorDash a retiré l'acceptation de ses critères de désactivation |
| 7 | Poids du taux de réponse (12 pts) | **On change** | 12 → **8 pts**, les 4 pts vont à la satisfaction | À faible volume, 1 déclin = 2 pts = parfois un palier = 2 pts de % sur chaque acte futur |
| 8 | Cible de satisfaction à 4,8 | **On change** | Cible **4,7**, échelle **absolue**, constantes **révisées une fois par an et publiées** — surtout **pas** de centiles calculés en continu contre la cohorte | À 4,8 pile, le maximum de l'axe est mathématiquement inatteignable ; 85 % des notes sont parfaites sur ces marchés (Filippas et al.) ; et le score **relatif** de Fiverr est documenté comme un échec — on peut y perdre sans avoir rien changé |
| 9 | Sous-axe « éventail » (7 pts sur 2 services) | **On change** | Supprimer, reverser au volume (18 → 25) ; réactiver seulement si le catalogue atteint 4 services | Punit la spécialisation, que le Code protège ; aucune plateforme étudiée ne récompense l'étendue de gamme |
| 9b | Cible de volume à **50 actes** | **On change** | Cible **24 actes** sur la fenêtre de 24 mois | Etsy : 5 commandes / 3 mois ; Airbnb : 10 réservations / 12 mois ; eBay : 100 transactions / 12 mois pour un commerçant. 50 actes = 2 à 3 ans pour un notaire |
| 10 | Fiche CNQ (5 pts) + secteur (3 pts) | **On change** | Sortir de la cote, devenir **conditions d'admission** ; axe présence 15 → 7 pts | 12 pts sur 100 sans qu'un client soit servi ; indéfendable comme mesure de mérite |
| 11 | **Paliers en escalier 60/70/80/90** | **On change** | Interpolation linéaire `taux = 0,12 − 0,07 × (cote − 60)/30` bornée [0,05 ; 0,15] ; à défaut, hystérésis de 3 points | 1 pt de cote = jusqu'à 3 pts de %. L'amplitude 5–15 % est en revanche **validée** : Upwork facture officiellement « 0 % to 15 % per contract ». Hystérésis : Upwork exige 90 % sur **13 des 16 dernières semaines**, DoorDash offre le Platinum Pass |
| 12 | Moment où le taux est fixé | **On change** | Figer au moment de la **retenue** de l'acte, l'afficher au notaire **avant** qu'il s'engage | Règle officielle d'Upwork : « Once your contract begins, the fee is fixed and won't change », taux affiché avant la proposition. Aujourd'hui `billing.js` recalcule la cote **au règlement** |
| 13 | **Rien pour le notaire neuf** (cote 51 max, 15 %) | **On ajoute** | Grâce de **6 mois ou 5 actes** au palier 70 (10 %) | Aucun des ~400 notaires de la RMR n'a d'historique au jour 1 ; Nota facturerait le plus cher à ceux dont elle a le plus besoin |
| 13b | **Une cote de 35 est affichée à un notaire dont on ne sait rien** | **On change** | **Aucune cote publique avant 3 évaluations et 2 clients distincts** — afficher « pas encore évalué » | Règle d'Upwork : pas de JSS avant 2 issues de contrat avec 2 clients, et il **disparaît** si la condition tombe. Un 35 non gagné est un jugement déguisé en mesure |
| 14 | **Aucun seuil éliminatoire** | **On ajoute** | Alerte < 45 ; suspension du fil < 35 **et** ≥ 5 actes complétés | Toutes les plateformes étudiées ont un plancher qui sort du marché ; sans lui, la cote n'est qu'un prix, pas une garantie de qualité |
| 15 | **Aucun recours** | **On ajoute** | Révision humaine obligatoire avant suspension, motif écrit ; 1 contestation d'évaluation par trimestre | Cour d'appel d'Amsterdam 2023 (art. 22 RGPD) ; directive UE 2024/2831 ; Lyft exclut déjà la pire note sur 100 |
| 16 | **Aucune protection des évaluations** | **On ajoute** | Exclusion automatique des avis dont le motif est hors du contrôle du notaire (retard prêteur, dossier client incomplet, annulation client) | Uber et DoorDash le font automatiquement ; sur 10 avis à vie, un avis injuste pèse 10 % de l'axe le plus lourd |
| 17 | **Publication de la méthode** | **On ajoute** | Publier la formule complète, les quatre axes et leurs pondérations dans la console notaire ET sur une page publique | Standard du New Jersey pour tout classement de professionnel : « a plain language description of the standard or methodology… is available for inspection ». Nota est la seule plateforme étudiée capable de le faire |
| 18 | **Affichage public d'avis clients nominatifs** | **À suspendre en attendant l'avis juridique** | Conserver la note comme signal **interne** d'affectation et de rémunération ; ne pas l'exposer publiquement sur un notaire nommé tant que l'avis n'a pas tranché | Art. 70 du Code de déontologie : le notaire ne peut « utiliser **ou permettre que soit utilisé** » un témoignage d'appui. Et NYSBA Op. 1132 : afficher une note transforme l'annuaire en **recommandation**, ce qui, rémunérée, est interdite |
| 19 | **Part de Nota en % des honoraires du notaire** | **À porter à l'avis juridique en priorité** | Explorer le forfait décorrélé (modèle LegalMatch) et/ou le projet pilote de l'art. 198.1 C. prof. | Loi sur le notariat art. 32.1(2°) : l'intermédiaire qui « obtient d'un notaire qu'il abandonne une partie de ses honoraires » est **présumé usurper les fonctions de notaire** (2 500–125 000 $) ; mise en garde du syndic de la CNQ du 25 janvier 2024 |
| 20 | **Vocabulaire des labels** | **On ajoute une règle** | Interdire « certifié », « agréé », « approuvé » et tout terme empruntant un titre public ; un label ne décrit qu'un fait vérifiable de Nota | Angi a payé **100 000 $** au Vermont en octobre 2025 pour le seul mot « Certified » |

### 8.5 L'avertissement stratégique

**Ce que je pensais avant la §5 est faux, et il faut le dire.** J'avais écrit
qu'aucune plateforme ne module sa commission selon un score. C'est vrai du
transport, de la livraison et de l'hébergement — Uber Pro, Lyft Rewards, Top
Dasher et Superhost donnent des **avantages** (priorité, visibilité, remises),
jamais un taux différent. Mais **c'est faux en général** :

| Plateforme | Le score modifie-t-il le taux ? | Amplitude |
| --- | --- | --- |
| Uber, Lyft, DoorDash, Airbnb, Etsy, Thumbtack | **non** — avantages seulement | — |
| Fiverr | **non** — 20 % plat à tous les niveaux | — |
| eBay | **oui** | −10 % (Top Rated) à +6 %/+7 % (Below Standard) sur les frais |
| **Upwork** | **oui** | **« 0 % to 15 % per contract »** |

L'économie décidée par le propriétaire (5–15 %) est donc **dans la norme
haute d'un mécanisme qui existe**, pas une invention. Ce n'est plus le problème.

**Le vrai problème est ailleurs, et les §6.3 à §6.6 le nomment précisément.**

Le corpus américain sur les plateformes juridiques dégage une règle de survie
très nette : une plateforme survit aux barreaux quand **(a)** le client choisit
lui-même, **(b)** la plateforme facture un **forfait décorrélé** des honoraires,
et **(c)** elle **ne classe ni ne recommande**. LegalMatch la respecte
explicitement — « we **do not rate, rank or otherwise recommend** specific
members » — et a obtenu des approbations d'éthique dans cinq États.
**[officiel]** <https://www.legalmatch.com/attorneys/ethicsFAQs.html>
Avvo l'a violée sur (b) et (c) et a fermé son produit après huit avis d'éthique
concordants.

Nota est aujourd'hui **du mauvais côté des trois critères** : le prix de Nota
varie avec l'honoraire du notaire (b), la cote est un classement au mérite (c),
et l'affichage de la cote oriente le choix du client (a). Au Québec, l'art. 32.1
de la *Loi sur le notariat* ajoute une sanction que les États-Unis n'ont pas :
l'intermédiaire qui obtient l'abandon d'une part des honoraires est **présumé
usurper les fonctions de notaire**.

**Trois chantiers, dans cet ordre :**

1. **L'avis juridique de l'ADR 0027 doit poser trois questions, pas une.** Le
   budget de 20 000 $ était prévu pour le partage d'honoraires. Il faut y
   ajouter : l'affichage public d'avis clients sur un notaire nommé (art. 70), et
   le fait qu'une note qui oriente le client puisse constituer une
   « recommandation » rémunérée (raisonnement NYSBA 1132).
2. **Préparer un plan B tarifaire décorrélé.** Un forfait fixe par acte, ou par
   mise en relation, indépendant du montant payé au notaire, satisfait le
   critère (b) sans rien changer à l'expérience client — le client paie toujours
   un total tout compris. La cote peut alors moduler **ce forfait** plutôt qu'un
   pourcentage des honoraires. C'est une question de plomberie, pas de modèle
   d'affaires ; mieux vaut l'avoir prête que de la découvrir sous contrainte.
3. **Explorer le projet pilote de l'art. 198.1 du Code des professions.** C'est
   la seule voie identifiée permettant à des normes de « s'appliquer malgré toute
   disposition inconciliable » d'une loi ou d'un règlement d'ordre — deux ans,
   prolongeables d'un an. Le Barreau vient de l'emprunter (Gazette officielle du
   20 mai 2026) ; la Chambre des notaires **n'a pas de bac à sable**, et sa seule
   position publique sur les intermédiaires est la mise en garde de janvier 2024,
   qui va en sens inverse. C'est donc long, et c'est une raison de commencer tôt.

**Et l'atout qui reste, entier.** Toutes les plateformes de ce dossier ont le
même défaut, et c'est le même : **elles cachent leur formule.** Uber et DoorDash
ne publient pas leurs seuils, Upwork ne publie pas ses pondérations et refuse
tout recours, Fiverr ne chiffre même pas sa fenêtre, Avvo et Martindale
revendiquent l'opacité. Le régulateur, lui, demande exactement l'inverse : une
description en langage clair de la méthode, disponible pour inspection, et une
distinction qui n'est pas décernée contre de l'argent.

**Nota a déjà écrit cette formule dans `packages/domain/index.js`, en français,
avec ses raisons.** C'est le seul avantage de ce dossier qui ne s'achète pas — et
il ne compte que s'il est publié.

---

## 9. Sources

### Officielles — plateformes de transport, livraison, hébergement, commerce

- Uber — *Understanding driver ratings* : <https://help.uber.com/en/driving-and-delivering/article/understanding-ratings?nodeId=fa1eb77f-ad79-4607-9651-72b932be30b7>
- Uber — *Understanding acceptance and cancellation rates* : <https://www.uber.com/us/en/blog/understanding-acceptance-and-cancellation-rates/>
- Uber — *Uber Pro* : <https://www.uber.com/us/en/drive/uber-pro/>
- Uber — *Uber Pro in California* : <https://www.uber.com/us/en/blog/uber-pro-in-california-rewards-that-go-the-extra-mile-like-you/>
- Uber — *Ratings protection* : <https://www.uber.com/en-DO/blog/ratings-protection/>
- Lyft — *Driver and passenger ratings* : <https://help.lyft.com/hc/en-us/all/articles/115013079948-Driver-and-passenger-ratings>
- Lyft — *Lyft Rewards* : <https://help.lyft.com/hc/en-us/all/articles/360035885974-Lyft-Rewards>
- DoorDash — *Dasher ratings explained* : <https://help.doordash.com/en-us/dashers/article/dasher-ratings-explained>
- DoorDash — *Overall Dasher Rating* : <https://help.doordash.com/en-us/dashers/article/overall-dasher-rating>
- DoorDash — *Dasher Rewards Program* : <https://help.doordash.com/en-us/dashers/article/dasher-rewards-program-pilot>
- DoorDash — *Platinum Pass* : <https://help.doordash.com/dashers/s/article/Platinum-Pass?language=en_US>
- Airbnb — *Superhost* : <https://www.airbnb.com/help/article/829>
- eBay — *Top Rated Seller* : <https://export.ebay.com/en/growth/seller-performance/top-rated-seller/>
- eBay — *Selling fees* (rabais 10 %, surtaxe 6 %/7 %) : <https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822>
- Etsy — *What is the Star Seller Badge?* (page officielle, non lisible en automatisé) : <https://help.etsy.com/hc/en-us/articles/4403058372503-What-is-the-Star-Seller-Badge>

### Officielles — plateformes de travail intellectuel

- Upwork — *How is my Job Success Score calculated?* : <https://support.upwork.com/hc/en-us/articles/38437458199059-How-is-my-Job-Success-Score-calculated>
- Upwork — *When is my JSS calculated?* (fenêtres 6/12/24 mois, meilleur des trois) : <https://support.upwork.com/hc/en-us/articles/38437480577939-When-is-my-JSS-calculated>
- Upwork — *When will I get a JSS?* (2 issues / 2 clients) : <https://support.upwork.com/hc/en-us/articles/38437546570643-When-will-I-get-a-JSS>
- Upwork — *Why did my JSS disappear?* : <https://support.upwork.com/hc/en-us/articles/38437621837203-Why-did-my-JSS-disappear>
- Upwork — *Job Success insights* (bonus relation longue, plafond 8 « jobs ») : <https://support.upwork.com/hc/en-us/articles/32389629156755-How-to-understand-your-Job-Success-insights-on-Upwork>
- Upwork — *What factors affect my JSS?* : <https://support.upwork.com/hc/en-us/articles/38439816969875-What-factors-affect-my-Job-Success-Score>
- Upwork — *There's a mistake in my JSS calculation* (« cannot be manually adjusted ») : <https://support.upwork.com/hc/en-us/articles/38440432318995-There-s-a-mistake-in-my-JSS-calculation-What-should-I-do>
- Upwork — *How to give feedback to your clients* (suppression du feedback privé, 31 mars 2026) : <https://support.upwork.com/hc/en-us/articles/211068438-How-to-give-feedback-to-your-clients>
- Upwork — *Talent badges* (révision bimensuelle) : <https://support.upwork.com/hc/en-us/articles/211063568-Understand-freelancer-talent-badges>
- Upwork — *How to become Top Rated* (90 % sur 13 des 16 semaines) : <https://support.upwork.com/hc/en-us/articles/211068468-How-to-become-Top-Rated-on-Upwork>
- Upwork — *Top Rated Plus* : <https://support.upwork.com/hc/en-us/articles/360050417233-How-to-reach-Top-Rated-Plus-status>
- Upwork — *Learn about the Freelancer Service Fee* (« 0 % to 15 % per contract », taux figé) : <https://support.upwork.com/hc/en-us/articles/211062538-Learn-about-the-Freelancer-Service-Fee>
- Fiverr — *Understanding Fiverr's freelancer levels* : <https://help.fiverr.com/hc/en-us/articles/360010560118-Understanding-Fiverr-s-freelancer-levels>
- Fiverr — *Success score* (score **relatif** à la gamme de prix) : <https://help.fiverr.com/hc/en-us/articles/21965360854673-Success-score>
- Fiverr — *Reviews and ratings explained* : <https://help.fiverr.com/hc/en-us/articles/360049982353-Reviews-and-ratings-explained>
- Fiverr — *How Fiverr works for freelancers* (20 % plat) : <https://help.fiverr.com/hc/en-us/articles/34069565843985-How-Fiverr-works-for-freelancers>
- Fiverr — communiqué du 30 janvier 2024 : <https://investors.fiverr.com/news-releases/news-release-details/fiverrs-winter-product-release-packed-new-features-keep>
- Fiverr — annonce du 14 février 2024 sur le forum officiel (aveu de l'inflation des notes) : <http://web.archive.org/web/20240423142407/https://community.fiverr.com/forums/topic/324066-important-updates-level-system-now-live-and-ratings-reviews-testing-changes/>
- Fiverr — suivi du 15 février 2024 (« It's not a one-size-fits-all formula ») : <http://web.archive.org/web/20241016041859/https://community.fiverr.com/forums/topic/324227-update-addressing-new-level-system-questions-and-feedback/>
- Fiverr — résultats FY2023 (take rate 31,8 %) : <https://investors.fiverr.com/news-releases/news-release-details/fiverr-announces-fourth-quarter-and-full-year-2023-results>

### Officielles — plateformes de professionnels et régulateurs

- Thumbtack — *Pro Rewards program* (paliers, points, seuils) : <https://help.thumbtack.com/article/thumbtack-pro-rewards-program>
- Thumbtack — *My rank in search results* (le prix influence le rang) : <https://help.thumbtack.com/article/my-rank-in-search-results>
- Thumbtack — *Ask for reviews* (1 avis avant de rencontrer des clients, 10 avis importés max) : <https://help.thumbtack.com/article/ask-for-reviews>
- FTC — *Order requires HomeAdvisor to pay up to $7.2 million* (janvier 2023) : <https://www.ftc.gov/news-events/news/press-releases/2023/01/ftc-order-requires-homeadvisor-pay-72-million-stop-deceptively-marketing-its-leads-home-improvement>
- FTC — ordonnance finale, avril 2023 : <https://www.ftc.gov/news-events/news/press-releases/2023/04/ftc-approves-final-order-against-homeadvisor-inc-deceptively-marketing-its-leads-home-improvement>
- FTC — remboursements, novembre 2023 : <https://www.ftc.gov/news-events/news/press-releases/2023/11/ftc-returns-more-3-million-businesses-paid-homeadvisor-memberships-announces-claims-process>
- Procureure générale du Vermont — règlement Angi, 13 octobre 2025 (« Angi Certified Pro », 100 000 $) : <https://ago.vermont.gov/blog/2025/10/13/attorney-general-clark-settles-dispute-angi-over-misleading-marketing-practice>
- Avvo — *What is the Avvo Rating?* : <https://www.avvo.com/support/articles/913946-attorneys-what-is-the-avvo-rating>
- NYSBA — Ethics Opinion 1132 (la note crée une « recommandation ») : <https://nysba.org/ethics-opinion-1132/>
- New Jersey — ACPE 732 / CAA 44 / UPL 54 (« the label… does not determine the purpose of the fee ») : <https://www.njcourts.gov/sites/default/files/notices/2017/06/n170621f.pdf>
- Caroline du Sud — EAO 16-06 : <https://www.scbar.org/for-lawyers/quicklinks/legal-resources/ethics-advisory-opinions/ethics-advisory-opinion-16-06/>
- Ohio — Op. 2016-3 : <https://www.ohioadvop.org/wp-content/uploads/2017/04/Op_16-003.pdf>
- New Jersey — CAA Opinion 39 (2006) : <https://www.njcourts.gov/sites/default/files/notices/2006/07/CAA_Opinion%252039.pdf>
- New Jersey — RPC 7.1(a)(3) amendée, 2 novembre 2009 (les trois conditions) : <https://www.njcourts.gov/sites/default/files/notices/2009/11/n091104g.pdf>
- New Jersey — avis du 10 mai 2021 (« more rigorous than a survey ») : <https://www.njcourts.gov/sites/default/files/notices/2021/05/n210510a.pdf>
- Super Lawyers — processus de sélection (5 % / 2,5 %) : <https://www.superlawyers.com/about/selection-process/>
- Martindale-Hubbell — peer review ratings : <https://www.martindale.com/marketyourfirm/profiles/peer-ratings/>
- LegalMatch — FAQ éthique (« we do not rate, rank or otherwise recommend ») : <https://www.legalmatch.com/attorneys/ethicsFAQs.html>
- ARDC (Cour suprême de l'Illinois) — *Client-Lawyer Matching Services*, 2018 : <https://iaals.du.edu/sites/default/files/documents/publications/il_matching_services_study.pdf>

### Officielles — Québec

- Légis Québec — *Code de déontologie des notaires*, N-3, r. 2 (art. 29.1, 31, 32, 33, 34, 51, 68, 69, 70, 71, 72) : <https://www.legisquebec.gouv.qc.ca/fr/document/rc/N-3,%20r.%202>
- Légis Québec — *Loi sur le notariat*, N-3 (art. 32.1, usurpation présumée) : <https://www.legisquebec.gouv.qc.ca/fr/document/lc/N-3>
- Légis Québec — *Code des professions*, C-26 (art. 188 sanctions, art. 198.1 projets pilotes) : <https://www.legisquebec.gouv.qc.ca/fr/document/lc/C-26>
- CNQ — *Loi 23 : mise en garde du Bureau du syndic*, 25 janvier 2024 : <https://www.cnq.org/la-chambre-et-votre-protection/actualites-et-salle-de-presse/loi-23-mise-en-garde-du-bureau-du-syndic/>
- CNQ — bottin officiel (aucune note, aucun avis) : <https://trouverunnotaire.cnq.org/>
- Barreau du Québec — projet pilote de services juridiques novateurs, mai 2026 : <https://www.barreau.qc.ca/en/new/notices-to-members/projet-pilote-services-juridiques-novateurs/>

### Recherche et presse

- Rosenblat, Levy, Barocas, Hwang — *Discriminating Tastes* (2017) : <https://datasociety.net/wp-content/uploads/2020/10/Rosenblat_et_al-2017-Policy_amp_Internet.pdf>
- Zervas, Proserpio, Byers — *A First Look at Online Reputation on Airbnb* : <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2554500>
- Filippas, Horton, Golden — *Reputation Inflation* (NBER w25857 → *Marketing Science* 41(4), 2022) : <https://www.nber.org/papers/w25857>
- Dubal — *On Algorithmic Wage Discrimination*, Columbia Law Review 123:7 (2023) : <https://www.columbialawreview.org/wp-content/uploads/2023/11/Dubal-On_Algorithmic_Wage_discrimination.pdf>
- Discrimination de classement sur 44 167 profils Upwork, *Journal of Business Research* 192 (2025) : <https://www.sciencedirect.com/science/article/pii/S0148296325001213>
- Biais dans les places de marché indépendantes (TaskRabbit, Fiverr) : <https://www.researchgate.net/publication/313738299_Bias_in_Online_Freelance_Marketplaces_Evidence_from_TaskRabbit_and_Fiverr>
- Hannák et al., CSCW '17 — biais racial mesuré sur 13 500 profils Fiverr : <https://dl.acm.org/doi/10.1145/2998181.2998327>
- Fountain Court Chambers — Cour d'appel d'Amsterdam, 2023 (*robo-firing*) : <https://fountaincourt.uk/2023/04/amsterdam-court-upholds-appeal-in-algorithmic-decision-making-test-case-drivers-v-uber-and-ola/>
- Conseil de l'UE — directive sur le travail de plateforme (2024) : <https://www.consilium.europa.eu/en/press/press-releases/2024/03/11/platform-workers-council-confirms-agreement-on-new-rules-to-improve-their-working-conditions/>
- Forbes — changement de tarification Upwork, 7 mai 2016 : <https://www.forbes.com/sites/elainepofeldt/2016/05/07/freelance-giant-upworks-new-pricing-model-sparks-outcry/>
- *Browne v. Avvo* (W.D. Wash. 2007) : <https://caselaw.findlaw.com/court/us-dis-crt-w-d-was-at-sea/2190675.html>
- ABA Journal — *Davis v. Avvo* (S.D.N.Y. 2018) : <https://www.abajournal.com/news/article/avvos-lawyer-ratings-are-protected-by-the-first-amendment-judge-rules-in-false-advertising-suit>
- LawNext — fermeture d'Avvo Legal Services, 31 juillet 2018 : <https://www.lawnext.com/2018/07/avvo-legal-services-shut.html>
- Indianapolis Business Journal — règlement *Moore v. Angie's List*, 1,4 M$ : <https://www.ibj.com/articles/60052-angies-list-agrees-to-settle-class-action-suit-for-14-million>
- EntreCourier — *DoorDash Top Dasher requirements* : <https://entrecourier.com/delivery/gig-delivery-platforms/doordash/doordash-strategies/doordash-top-dasher-requirement/>
- Gridwise — *Uber Pro* : <https://gridwise.io/blog/uber-pro/uber-pro-what-should-uber-drivers-know/>
- Ridester — *Uber driver ratings* (seuil 4,6, non officiel) : <https://www.ridester.com/uber-driver-ratings/>
- Craftybase — *Etsy Star Seller requirements* : <https://craftybase.com/blog/how-to-become-etsy-star-seller>
- Change.org — pétition contre l'usage du taux d'acceptation dans les paliers : <https://www.change.org/p/ban-uber-eats-doordash-from-using-acceptance-rate-as-a-driver-metric-in-tier-structures>
- *Fiverr Voices* — critique du Success Score, avril 2024 : <https://medium.com/fiverr-voices/is-fiverrs-success-score-a-big-fail-dffc87f4f3a1>

### Sources internes

- `packages/domain/index.js`, bloc `COTE` — les quatre axes
- `apps/api/src/cote.js` — l'adaptateur, et la confirmation que tous les compteurs sont cumulés à vie
- `apps/api/src/commission-config.js` — 15 % de base, paliers 60/70/80/90, plancher 5 %
- `apps/api/src/billing.js` — la cote est calculée **au règlement**, pas à la retenue
- `docs/decisions/0027-partage-75-25-cote-client.md` — la décision du propriétaire
- `docs/go-to-market/validation-notaires.md` — ≈ 3 900 notaires au Québec, ≈ 400 dans la RMR de Québec

### Réserves de fiabilité — à vérifier avant toute citation externe

- **Pages officielles lues via une passe de recherche dédiée** (navigateur) plutôt
  que par le récupérateur simple, qui reçoit un HTTP 403 : `support.upwork.com`,
  `help.fiverr.com`, `help.thumbtack.com`, `legisquebec.gouv.qc.ca`. Les citations
  sont verbatim et les URL font foi ; **relire l'original avant de les
  reproduire dans un document destiné à la Chambre.**
- **Dates de bascule tarifaire d'Upwork** — le 3 mai 2023 (passage au 10 % plat)
  et le passage à la fourchette 0–15 % reposent sur des sources tierces
  convergentes ; **le billet d'annonce d'Upwork n'a pas été retrouvé**. La
  *fourchette* 0–15 %, elle, est officielle.
- **eBay** — `ebay.com/help/policies/selling-policies/seller-standards-policy?id=4347`
  n'a pas répondu ; les **seuils exacts de taux de défaut** d'eBay ne sont donc
  pas cités ici.
- **Airbnb Guest Favorite** — `airbnb.com/help/article/3383` en HTTP 403 ; les
  seuils du badge viennent de sources tierces seulement.
- **Etsy Star Seller** — page officielle en HTTP 403 ; chiffres tiers.
- **Uber, seuil de désactivation ~4,6** — chiffre de presse. Uber dit lui-même
  que le minimum varie par ville. **Non documenté publiquement au 2026-09-01.**
- **Thumbtack** — la part de pros détenant Top Pro (« 4 % ») n'a **aucune source
  officielle** ; aucune action réglementaire ni recours collectif certifié contre
  Thumbtack n'a pu être vérifié.
- **Angi** — la grille tarifaire pour les pros n'est **pas publiée** ; seul le
  287,99 $ cité par la FTC est officiel.
- **Avvo** — la pondération des facteurs n'est **pas publiée** ; le nombre
  d'avocats profilés n'est **jamais chiffré officiellement**.
- **Martindale-Hubbell** — les seuils numériques ont disparu des sources
  primaires actuelles, remplacés par un « confidential threshold number of
  qualified responses ». Le biais d'âge fréquemment évoqué n'est étayé par
  **aucune source sérieuse** — ne pas l'affirmer.
- **In re Opinion 39, 197 N.J. 66 (2008)** — texte intégral inaccessible ; seule
  la phrase citée verbatim par le régulateur est vérifiée.
- **Québec, jurisprudence disciplinaire** — **aucune décision trouvée** portant
  sur le partage d'honoraires d'un notaire avec une plateforme, sur une
  commission de référencement ou sur l'affichage de notes. Une recherche plein
  texte SOQUIJ/CanLII serait nécessaire. **Absence de preuve, pas preuve
  d'absence.**
- **LSO Access to Innovation** — les documents détaillant les règles formellement
  écartées sont protégés et n'ont pas pu être lus.
- **UpCounsel, annuaire de partenaires Clio** — critères de classement **non
  documentés publiquement au 2026-09-01**.
- **Fiverr, ampleur des rétrogradations de 2024** — **aucun chiffre n'existe**,
  ni chez Fiverr ni ailleurs. « Déclassements massifs » est inféré du volume de
  plaintes (~1 762 réponses sur deux fils officiels), pas mesuré. **Non
  documenté publiquement au 2026-09-01.**
- **Fiverr, forum officiel** — désormais fermé aux non-connectés ; les fils de
  2024 ne sont accessibles que par archive.
