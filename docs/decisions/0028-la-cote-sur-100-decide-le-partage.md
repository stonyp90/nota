# 0028 — La cote sur 100 décide le partage

Date : 2026-09-01

Statut : accepté — révise l'[ADR 0027](0027-partage-75-25-cote-client.md)

## Contexte

L'ADR 0027 a posé la bonne structure — le client paie un total tout compris, qui
se partage à la signature — mais deux choses n'y tenaient pas.

**Les pourcentages étaient trop durs.** 25 % pour Nota au départ, 15 % au
sommet : c'est le double de ce que le plan d'affaires modélisait, et la veille
concurrentielle du même jour montre Notairo 40 à 60 % moins cher que Nota sur le
prix client. Un notaire qui laisse le quart de son acte à une plateforme ne
s'inscrit pas — et la cohorte de départ de Nota, ce sont les jeunes notaires,
ceux qui ont le moins de marge.

**Le mérite était une grille d'axes épars.** Un palier de l'ADR 0027 exigeait
*à la fois* une note, un nombre d'avis et un nombre d'actes. Trois conditions
par palier, trois compteurs à expliquer, et un notaire qui manque une seule des
trois ne comprend pas pourquoi il stagne. Pire : la grille ne mesurait que le
passé transactionnel. Elle ignorait ce qui fait qu'un notaire est *utile au
marché* — répondre au fil plutôt que le laisser passer, se déplacer, tenir une
fiche à jour, servir plus d'un service du catalogue.

Le propriétaire a tranché les deux le 1<sup>er</sup> septembre 2026 : « les
notaires ont un système d'évaluation par les différents services qu'ils rendent,
leur présence sur Nota, leur disponibilité, le feedback des clients — et
l'ensemble leur donne une cote sur cent ». Et l'économie : **Nota prend au plus
15 % ; les meilleurs notaires ne laissent que 5 %.**

## Décision

**1. Nota prend au plus 15 %, et jamais moins de 5 %.** 15 %, c'est le point de
départ — celui d'un notaire sans historique, qui garde donc 85 %. 5 %, c'est le
plancher, atteint au-dessus d'une cote de 90 : le notaire garde **95 %**. Entre
les deux, une seule chose bouge la ligne, et elle ne la bouge que vers le
notaire.

**2. Le levier est UNE mesure : la cote sur 100.** Plus de grille à trois
conditions. `domain.notaryScore(stats)` produit un nombre entier de 0 à 100 et
son explication — quatre axes, quatre maxima qui font exactement 100 :

| Axe | Max | Ce qui le nourrit |
| --- | ---: | --- |
| `satisfaction` — Satisfaction des clients | **40** | la moyenne bayésienne des évaluations, étalée entre 3,0 (rien) et 4,8 (plein) |
| `services` — Services rendus | **25** | le volume d'actes portés (18, en racine, cible 50) et l'éventail du catalogue réellement servi (7) |
| `disponibilite` — Disponibilité | **20** | le taux de réponse — proposer ou accepter plutôt que décliner (12) — et la portée déclarée : le rayon (6) et les urgences en ligne (2) |
| `presence` — Présence sur Nota | **15** | la fiche CNQ (5), le secteur postal de l'étude (3), une activité récente dans la console (4), l'ancienneté (3) |

Les pondérations disent ce que Nota vend. **La satisfaction pèse 40** parce que
c'est la seule chose que le client, lui, a vécue : un marché de professionnels
sans le jugement des clients n'est qu'un annuaire. **Les services rendus pèsent
25** parce qu'un acte complété est la preuve la plus dure qu'un notaire existe
vraiment sur Nota — mais 25 seulement, sinon la cote devient un classement par
ancienneté commerciale et le nouveau ne rattrape jamais. **La disponibilité pèse
20** parce que c'est le produit : Nota vend une date, et une date ne vaut rien si
personne ne répond au fil. **La présence pèse 15**, la plus légère : elle
s'achète en dix minutes de formulaire, elle ne doit donc jamais suffire — elle
sert de socle, pas de raccourci.

**3. Trois amortisseurs, pour que la cote ne mente pas.**

- **Moyenne bayésienne sur la satisfaction** (a priori 4,0 sur 5 avis fictifs) :
  la note observée est tirée vers l'a priori tant que les avis sont rares. Un
  notaire neuf ne démarre pas à zéro étoile qu'il n'a pas méritée, et **cinq
  évaluations complaisantes n'achètent pas le sommet** — il faut du volume
  d'avis pour que la moyenne observée l'emporte sur l'a priori.
- **Rendement décroissant sur le volume** : les points d'actes suivent une
  racine carrée (cible 50). Les dix premiers actes valent plus que les dix
  suivants. Un cabinet qui traite cent actes ne peut pas se placer hors
  d'atteinte d'un notaire correct qui en fait vingt.
- **A priori qui ne comble QUE le manquant sur le taux de réponse** (0,7 sous
  cinq observations) : un notaire qui n'a jamais vu passer une demande n'est ni
  puni ni récompensé ; un notaire qui a répondu vingt fois sans jamais décliner
  est à 100 %, sans dilution résiduelle. L'a priori s'efface à mesure que la
  mesure existe, il ne la plafonne pas.

**4. L'échelle : une cote atteinte → le taux que Nota garde.**

| Cote atteinte | Nota garde | Le notaire garde |
| ---: | ---: | ---: |
| — (départ) | 15 % | **85 %** |
| 60 | 12 % | **88 %** |
| 70 | 10 % | **90 %** |
| 80 | 8 % | **92 %** |
| 90 | 5 % | **95 %** — le sommet |

Un palier est atteint dès que la cote l'égale, et c'est le meilleur palier
atteint qui s'applique. Le taux effectif est **borné des deux côtés** : jamais
au-dessus du taux de base, jamais en dessous du plancher. Cette borne n'est pas
une coquetterie défensive — c'est la règle elle-même. Un plancher configuré
au-dessus du taux (faute de frappe d'environnement, déploiement à moitié
appliqué) ne doit jamais facturer *plus* que la base : **le mérite ne déplace la
ligne que vers le notaire.**

**5. Tout est publié, des deux côtés.** Le notaire voit sa cote, ses quatre axes
avec leur détail chiffré, le taux qu'elle lui vaut, sa part, et le prochain
palier avec les points qui l'en séparent. Le client voit la cote du notaire qui
lui propose un prix — le même nombre exactement, celui sur lequel Nota se tarife.
Une cote n'a de valeur que si les deux côtés la lisent.

### Ce que ça donne, sur des profils réels

Quatre profils calculés avec `domain.notaryScore` et tarifés par le barème par
défaut :

| Profil | Satisf. | Services | Dispo. | Présence | **Cote** | Nota | Le notaire garde |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Neuf** — fiche + secteur, 2 jours, aucun acte, aucun avis | 22,2 | 0 | 11,4 | 12 | **46** | 15 % | **85 %** |
| **Jeune actif** — 4 mois, 8 actes (1 service), 6 avis à 4,6, 14 réponses / 3 déclins, rayon 25 km | 29,5 | 10,7 | 12,9 | 13 | **66** | 12 % | **88 %** |
| **Établi** — 13 mois, 25 actes sur les 2 services, 18 avis à 4,7, 34 réponses / 5 déclins, rayon 50 km | 34,4 | 19,7 | 16,5 | 15 | **86** | 8 % | **92 %** |
| **Chevronné** — 17 mois, 80 actes sur les 2 services, 40 avis à 4,9, 60 réponses / 3 déclins, rayon 50 km + urgences | 40 | 25 | 19,4 | 15 | **99** | 5 % | **95 %** |

Trois lectures de ce tableau. Le notaire neuf **n'est pas à zéro** (46) : un
profil complet vaut déjà quelque chose, et il voit exactement ce qui lui manque.
Le sommet est **atteignable et pas donné** : il faut être aimé, volumineux,
disponible et présent *en même temps* — du volume sans satisfaction plafonne. Et
la marche la plus rentable, pour un jeune notaire, est la moins chère à
franchir : répondre au fil et servir le deuxième service du catalogue.

## Conséquences

**La forme du barème change.** Un palier passe de `{ note, avis, actes, bonus }`
à **`{ cote, taux }`** : la cote à atteindre, et le taux que Nota garde une fois
atteinte — le taux, pas un rabais à soustraire, parce que c'est le nombre que le
notaire veut lire. `apps/api/src/commission-config.js` reste la seule autorité
sur cette forme : les défauts (`DEFAULT_RATE` 0,15, `DEFAULT_FLOOR` 0,05,
`DEFAULT_TIERS`), les surcharges d'environnement, et la validation qu'applique la
porte d'écriture admin. La validation garde l'échelle : cote entière de 1 à 100,
taux entre le plancher et le taux de base, pas deux fois la même cote, et **le
taux ne remonte jamais quand la cote monte**.

**`NOTA_COMMISSION_BONUS_TIERS` devient `NOTA_COMMISSION_TIERS`.** Le mot
« bonus » décrivait un rabais soustrait d'une base ; il n'y a plus de rabais, il
y a un taux. Le renommage est franc plutôt que compatible : un barème stocké ou
déclaré dans l'ancienne forme (`note`/`avis`/`actes`/`bonus`) **se lit comme
absent**, et la tarification retombe sur les défauts. C'est le comportement
voulu — un barème périmé doit tarifer au taux de base, jamais faire tomber la
tarification, et jamais tarifer selon une grille que plus personne ne lit.

**Les signaux vivent sur le profil du notaire, tenus là où l'événement se
produit.** `proposalsCount` à chaque proposition envoyée, `acceptsCount` à chaque
acceptation gagnante, `declinesCount` à chaque demande déclinée, `lastSeenAt`
estampillé au plus une fois par jour à l'ouverture de la console, `actsByService`
incrémenté au règlement **sous la même garde write-once que l'argent** — une
reprise ne gonfle jamais une cote. `apps/api/src/cote.js` est le port : il
traduit ce seul document en l'entrée que le domaine attend. Aucun balayage de
registre au moment de facturer ; la cote se calcule en mémoire, à partir d'un
item.

**Le domaine ignore toujours le partage.** `notaryScore` produit un nombre et son
explication ; il ne sait rien des pourcentages. C'est la couche facturation
(`billing.js`, `commissionWith`) qui traduit la cote en taux. La frontière de
l'ADR 0008 tient : le mot « commission » n'apparaît pas dans
`packages/domain`.

**L'API publie la cote.** `GET /notary/bids` porte `cote` (toujours — un notaire
a une cote même quand la facturation n'est pas configurée) et un bloc
`commission` enrichi : `taux`, `plancher`, `tauxEffectif`, `part`, `bonus`,
`cote`, `axes`, `paliers` et `prochain`. `GET /notary/evaluations` porte la cote
et le palmarès service par service (`notaryServiceRecord` : actes portés, avis
reçus, note — jamais de fausse moyenne pour un service jamais rendu).
`GET /client/bid` porte `cote` sur chaque proposition et sur le bloc `notaire`
retenu. `GET /notary/acts` est le relevé acte par acte : montant, taux,
commission, net, et les totaux — la divulgation intégrale, ligne par ligne, pas
seulement un agrégat.

### Ce qui reste ouvert

**La qualification juridique, pas la plomberie.** La vérification du même
jour (`apps/api/src/stripe-port.js`) a corrigé une croyance de l'ADR 0027 : sur
le fil Stripe, le client paie **la plateforme** — la caution est une session
Checkout sur le compte de Nota, sans compte connecté — et à la signature Nota
capture, garde sa part et vire le net au notaire. La part de Nota ne transite
pas par le compte du notaire. Le seul chemin qui faisait l'inverse était le
repli, retiré par l'ADR 0029.

Ce qui reste entier, c'est la **qualification** : l'article 32.1 de la *Loi sur
le notariat* (2023) présume usurpation des fonctions de notaire chez
l'intermédiaire qui obtient d'un notaire l'abandon d'une partie de ses
honoraires, avec une amende de 2 500 $ à 125 000 $, et l'article 70 du *Code de
déontologie* interdit au notaire d'utiliser **ou de permettre que soit utilisé**
un témoignage d'appui — ce qui touche directement l'affichage public des
évaluations sur lequel cette cote repose (voir
`docs/go-to-market/veille-notation-plateformes.md`). **L'avis juridique écrit
budgété reste requis avant le premier acte réel**, et il doit désormais couvrir
l'affichage des avis autant que le partage.

**La fenêtre de mesure est « depuis toujours ».** Rien dans la cote ne
s'estompe : un notaire excellent en 2026 garde ses points en 2029, et une
mauvaise passe ancienne pèse indéfiniment. C'est acceptable tant que le corpus
est jeune ; il faudra probablement une fenêtre glissante (ou un demi-vie sur les
avis et les actes) avant que la première cohorte ait deux ans.

**Les pondérations sont une hypothèse, pas un fait.** 40/25/20/15 est un
jugement — défendable, calibré sur des profils plausibles, mais jamais confronté
à un notaire réel. C'est exactement ce que le programme de validation terrain
(`docs/go-to-market/`) doit mesurer auprès des trente notaires interrogés avant
la mise en service, au même titre que le taux lui-même. Le barème est éditable
depuis la console admin sans redéploiement (ADR 0021), et
`notaryScore(stats, ponderation)` accepte une pondération de rechange : les deux
portes existent précisément pour que la réponse du terrain puisse être appliquée.

## Complément du même jour — deux sanctions déontologiquement à l'envers, retirées

La veille des plateformes a mis au jour deux endroits où la première version de
la cote punissait un notaire pour avoir respecté son Code.

**Décliner n'est plus une pénalité.** L'axe disponibilité mesurait
`repondu / (repondu + declinees)` : chaque refus faisait baisser la note, et à
faible volume — quelques dizaines de demandes par an, pas cent courses par jour
— **deux refus suffisaient à faire basculer un palier**, soit deux points de
pourcentage sur chaque acte futur. Or le notaire est un officier public à qui le
Code impose de tenir compte des limites de ses connaissances avant d'accepter un
mandat : refuser un dossier qu'il ne peut pas porter est une **obligation**, pas
un défaut de service. Une plateforme qui le lui facture le pousse à mal faire son
métier. DoorDash a fini par retirer le taux d'acceptation de ses critères pour
cette raison exacte ; Airbnb mesure « accept **or decline** within 24 h ».

L'axe mesure désormais le fait de **répondre** — proposer, accepter ou décliner,
toutes des réponses — avec le même rendement décroissant que le volume d'actes.
Ce qui coûte des points, c'est le silence. Le `detail` continue d'afficher
séparément les réponses et les déclins : la mesure a cessé d'être une sanction,
elle n'a pas cessé d'être honnête.

**L'éventail du catalogue disparaît de la note.** Sept points récompensaient le
nombre de services rendus sur les deux du catalogue : un notaire qui ne fait que
du refinancement perdait 3,5 points *pour s'être spécialisé*. Même contradiction
avec le devoir de compétence, et aucune des plateformes étudiées ne récompense
l'étendue de gamme. Les sept points sont reversés au volume, à calibrage
constant : les profils de référence ne bougent pas (jeune actif 65, établi 84,
chevronné 99). Ce que le notaire rend, service par service, reste **affiché**
dans la console et dans le registre admin — comme information, plus comme note.

Deux effets à connaître : un notaire tout neuf qui n'a encore répondu à rien
tombe de 41 à **32** (l'a priori de disponibilité qui lui offrait 8 points
n'existe plus — ne rien répondre vaut zéro), et un notaire qui répond beaucoup
en refusant souvent monte, ce qui est précisément l'intention.

## Complément du même jour — le taux de l'engagement est un plafond

La veille des plateformes (`docs/go-to-market/veille-notation-plateformes.md`)
a relevé une asymétrie que la première version de cet ADR laissait passer : la
cote se relit **à chaque tarification**, donc au règlement. Un notaire pouvait
retenir une demande en voyant 8 % et payer 10 % à la signature, parce qu'un
déclin ou une mauvaise évaluation avait bougé sa cote entre les deux. Chez
Upwork, le taux d'un contrat est arrêté à son ouverture et affiché avant
l'engagement ; c'est la bonne règle, et c'est celle qui manquait.

Depuis le 2026-09-01, la rétention grave sur l'offre le taux et la cote du
moment (`tauxRetenu`, `coteRetenue` — et la trace d'audit `acte_retenu` les
porte). Le règlement applique **le meilleur des deux pour le notaire**, borné
par le plancher du barème :

- une cote qui **baisse** entre l'engagement et la signature ne renchérit
  jamais un acte déjà promis ;
- une cote qui **monte** profite quand même, immédiatement.

Le mérite ne déplace la ligne que vers le notaire — la même règle que le
plancher et la borne du taux de base, appliquée cette fois dans le temps.
Le registre `ACT#` conserve les deux chiffres, `taux` et `tauxRetenu`, pour
qu'un écart reste explicable après coup.

## Alternatives écartées

- **Garder la grille à trois axes de l'ADR 0027.** Écartée : trois conditions
  simultanées par palier sont impossibles à expliquer en une phrase à un notaire,
  et elles ne mesuraient que le passé transactionnel. Une cote unique est
  lisible, et elle peut absorber un nouveau signal sans ajouter une colonne.
- **Une cote purement transactionnelle (actes + note seulement).** Écartée :
  elle rend le nouveau structurellement perdant et n'encourage rien de ce dont le
  marché a besoin au démarrage — répondre vite, couvrir un territoire, servir
  tout le catalogue.
- **Un taux unique de 10 % pour tout le monde.** Écarté : simple, mais il
  n'achète aucun comportement. Le propriétaire veut que le meilleur notaire soit
  visiblement mieux traité que le moins bon, et qu'il le voie à l'écran.
- **Laisser la cote au notaire seul, sans la montrer au client.** Écartée : une
  cote cachée est une note interne, pas un signal de marché. Le client qui pèse
  un prix plus haut venu d'un inconnu a besoin du même nombre que Nota — et Nota
  perd le droit de se tarifer dessus s'il ne l'assume pas devant le client.
