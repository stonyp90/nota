# Conformité déontologique — ce que le droit professionnel impose à Nota

> **BROUILLON NON RÉVISÉ.** Rédigé à partir du code et des textes officiels, non
> par un juriste. Ne remplace pas l'avis juridique écrit, qui **reste requis
> avant la mise en service**. Voir [`README.md`](README.md).

**Version : 0.2 (brouillon) · 1er septembre 2026, révisé le 4 septembre 2026**

> ⚠️ **RÉVISION DU 4 SEPTEMBRE 2026 — le modèle économique analysé ici a changé
> depuis la rédaction.** La version 0.1 examinait un prélèvement de **5 % à 15 %
> du montant payé pour un acte notarié**, variable selon la cote du notaire.
> **Ce prélèvement est retiré du produit.** Depuis
> l'[ADR 0031](../decisions/0031-le-prix-de-nota-est-celui-de-nota.md), le
> notaire reçoit **100 %** du montant qui lui est offert et Nota facture au
> client **son propre prix, publié d'avance** ; depuis
> l'[ADR 0034](../decisions/0034-le-prix-de-nota-est-une-grille-par-service.md),
> ce prix est une grille par service (199 $ / 249 $) plus une ligne de garantie
> de date (0 · 50 · 100 · 200 · 300 $). `commission-config.js` a été supprimé.
>
> **C'est exactement la « piste structurelle » que le §1.2 recommandait**, mise en
> œuvre : un prix par acte, sans lien avec le montant de l'acte ni avec la
> personne du notaire. Les passages ci-dessous qui décrivent le pourcentage ont
> été corrigés là où ils affirmaient un fait ; l'analyse juridique des textes,
> elle, tient intégralement — et la question qu'elle pose reste ouverte : ce qui
> demeure à qualifier est **le prix de Nota lui-même**, perçu par acte, par un
> intermédiaire.

---

## 0. La hiérarchie, décidée par le propriétaire

> « Ça serait de ne pas être à l'encontre du Code de déontologie des notaires.
> Ceci est primordial. »
> — le propriétaire, 1er septembre 2026, consigné dans
> `docs/decisions/0030-la-deontologie-prime-la-cote-ne-se-publie-pas.md`

C'est une **hiérarchie, pas une préférence** : la conformité déontologique passe
avant la valeur produit. Ce document en tire la liste complète des obligations,
ce que le code fait aujourd'hui pour s'y conformer, et **ce qui reste exposé**.

Les textes sont cités depuis
[`../go-to-market/veille-notation-plateformes.md`](../go-to-market/veille-notation-plateformes.md) §6.6,
qui porte les sources officielles.

**Un avertissement sur l'ordre.** Le risque le plus lourd n'est pas l'affichage
des avis — c'est **l'article 32.1 de la *Loi sur le notariat***, qui vise le
modèle économique lui-même. Le retrait de la cote des vues client (§2) est réel
et utile, mais il ne répond pas à §1. Ne pas confondre les deux.

---

## 1. ⚠️ Article 32.1 de la *Loi sur le notariat* — le risque principal

**Source :** RLRQ c. N-3, art. 32.1, introduit par la **Loi 23 de 2023**, en
vigueur le **24 octobre 2023**.
<https://www.legisquebec.gouv.qc.ca/fr/document/lc/N-3>

> « Est présumée **usurper les fonctions de notaire** toute personne autre qu'un
> membre de l'Ordre, agissant comme **intermédiaire** entre une tierce personne
> et un notaire, qui soit :
> 1° accorde ou promet […] à une tierce personne une **réduction des honoraires**
> et frais de ce notaire ;
> 2° **obtient d'un notaire qu'il abandonne une partie de ses honoraires** et
> frais ;
> 3° procure, promet ou convient de procurer à cette tierce personne des services
> professionnels, **sans aucune responsabilité de sa part envers le notaire pour
> ses honoraires** et frais. »

**Sanction :** art. 33 L.N. renvoyant à l'art. 188 du *Code des professions* —
**2 500 à 62 500 $** (personne physique), **5 000 à 125 000 $** (autres cas),
**doublée en récidive**.

### Pourquoi cela vise Nota directement

Nota est, par construction, **un intermédiaire entre une tierce personne (le
client) et un notaire**. Les trois branches doivent être examinées séparément :

| Branche | Exposition de Nota |
| --- | --- |
| **1° réduction des honoraires promise au client** | Le carnet est un marché où le client **fixe le montant qu'il offre** et où les notaires se positionnent. Le produit ne « promet » pas de rabais, mais il organise une concurrence par les prix dont l'effet attendu est la baisse. À qualifier. |
| **2° obtenir du notaire qu'il abandonne une partie de ses honoraires** | **La branche la plus dangereuse — et celle qui a fait changer le produit.** Jusqu'au 1<sup>er</sup> septembre 2026, Nota prélevait 5 % à 15 % du montant payé pour un acte notarié : c'était le résultat économique que le texte vise, quel que soit le nom donné au mécanisme. **Ce prélèvement est retiré** (ADR 0031/0034). Le notaire reçoit aujourd'hui 100 % du montant offert (`billing.js` — `honorairesCents` viré en entier) et **n'abandonne rien**. Ce qui reste à qualifier est le prix propre de Nota, facturé au client sur sa propre ligne : le texte vise le résultat économique, et un juriste doit dire si un prix par acte perçu par un intermédiaire y échappe. |
| **3° procurer des services sans responsabilité envers le notaire pour ses honoraires** | **Partiellement atténué**, et c'est un point qui joue en faveur de Nota — voir §1.2. |

### 1.1 La mise en garde du syndic — la Chambre s'est déjà prononcée

**Source :** Bureau du syndic de la Chambre des notaires, **25 janvier 2024**,
signée par la syndique.
<https://www.cnq.org/la-chambre-et-votre-protection/actualites-et-salle-de-presse/loi-23-mise-en-garde-du-bureau-du-syndic/>

> « ne laissant **aucun "intermédiaire"** (personne ou société) dicter votre
> conduite… »
>
> « Il est donc **proscrit** : […] de laisser un intermédiaire **offrir vos
> services, dicter votre conduite ou la portée de votre mandat ou fixer ou
> partager vos honoraires**. »
>
> « Au besoin, nous **n'hésiterons pas à prendre les recours** qui s'imposent
> face à toute contravention de la loi. »

La Chambre visait explicitement « certains modèles d'affaires en place ». Ce
n'est donc **pas un risque théorique** : le régulateur a annoncé son intention
d'agir, et le texte vise le notaire *autant* que l'intermédiaire — Nota met ses
notaires en défaut en même temps qu'elle s'expose.

Chacun des quatre verbes proscrits doit être confronté au produit :

| Verbe proscrit | Ce que Nota fait | Qualification |
| --- | --- | --- |
| **offrir vos services** | le carnet expose des demandes ; le notaire choisit ce qu'il retient (`handler.js:1589-1656`). Nota ne démarche pas au nom d'un notaire nommé. | plutôt favorable |
| **dicter votre conduite** | Nota n'intervient jamais dans l'acte ; aucune instruction professionnelle n'est transmise. | favorable |
| **dicter la portée du mandat** | le service et le dossier viennent du client, pas de Nota ; le notaire apprécie le mandat. | plutôt favorable |
| **fixer ou partager vos honoraires** | **le montant est fixé par le client** puis validé contre un plancher serveur, et **Nota n'en retient rien** : le virement au notaire est exactement le montant offert (retrait du prélèvement, ADR 0031). Le verbe « partager » n'a donc plus de prise. Le verbe « fixer » reste discutable : c'est le client qui pose le montant, mais dans une fourchette que Nota publie (plancher par service, plafond 5×) et sur une recommandation que Nota calcule. | **partager : fermé · fixer : à qualifier** |

### 1.2 Ce que le circuit de l'argent dit réellement — correction du 1er septembre 2026

L'ADR 0027 affirmait que « toutes les plateformes comparables facturent le
client » et rangeait Nota du côté du prélèvement sur les honoraires du notaire.
**La lecture du code montre que le circuit réel est déjà celui du client qui
paie la plateforme.**

Vérifié dans `apps/api/src/stripe-port.js` :

- **La caution est une session Checkout sur le compte de Nota**
  (`stripe-port.js:85-116`) : `mode: 'payment'`, capture manuelle, **aucun compte
  connecté**, **pas de `on_behalf_of`**, **pas de `transfer_data`**, **pas
  d'`application_fee_amount`**. Le client contracte avec Nota et paie Nota.
- **Le règlement capture sur la plateforme, puis vire le net au notaire**
  (`captureAndTransfer`, `stripe-port.js:126-146`) : `paymentIntents.capture`
  suivi de `transfers.create` vers le compte connecté.
- **Le seul chemin qui faisait l'inverse a été supprimé.**
  `chargeActCommission` était une charge de destination sur le compte du notaire
  avec Nota en frais d'application ; l'ADR 0029 l'a retiré et le port porte la
  note à sa place (`stripe-port.js:68-75`).

**Conséquence pour la qualification.** Le risque se déplace de la *direction du
flux* — qui est correcte : le client paie la plateforme, jamais le notaire qui
rétrocède — vers la **qualification au sens de l'art. 32.1 2°**. La question que
l'avis juridique doit trancher n'est plus « qui encaisse ? » mais :

> **Le fait que Nota conserve une fraction d'un montant offert pour un acte
> notarié équivaut-il à « obtenir d'un notaire qu'il abandonne une partie de ses
> honoraires », quelle que soit la mécanique de paiement ?**

Deux éléments à verser au dossier, dans les deux sens :

- **En faveur de Nota :** la part est un pourcentage d'un **prix fixé par le
  client**, non d'un tarif d'honoraires établi par le notaire ; Nota rend un
  service réel et distinct (trouver le notaire, monter et valider le dossier,
  opérer la transaction et le séquestre) ; et Nota **assume le risque de
  paiement** — la caution est posée sur la carte du client avant tout engagement
  (`handler.js:857-871`), ce qui l'écarte de la branche 3° (« sans aucune
  responsabilité de sa part envers le notaire pour ses honoraires »).
- **Contre Nota (version 0.1, corrigé depuis) :** la part était
  **proportionnelle** au montant de l'acte, ce qui la rattachait économiquement
  aux honoraires plutôt qu'au coût du service rendu ; et **elle variait selon la
  cote du notaire**, donc selon sa personne — un frais de service pur ne devrait
  dépendre que du service de Nota.

> ✅ **La piste structurelle a été suivie.** La version 0.1 recommandait un
> **prix par acte, sans lien avec le montant ni avec la personne du notaire**,
> comme sortie bien plus nette du champ de l'art. 32.1 2° que le pourcentage
> d'alors. C'est ce qui a été livré : l'ADR 0031 a retiré le pourcentage, l'ADR
> 0034 a posé une grille qui ne dépend que de **deux dimensions publiées** — le
> service demandé et le délai avant la signature — et de rien qui touche au
> notaire. Le coût produit annoncé a été payé : la cote n'est plus un levier de
> rémunération, et l'ADR 0028 est retiré en entier.
>
> **Ce qui reste à faire qualifier par l'avis** : un prix perçu **par acte
> notarié**, par un intermédiaire, échappe-t-il à une lecture strictement
> économique de l'art. 32.1 2° ? Et le repli — facturer le service hors de
> l'acte, à l'abonnement ou au dossier — doit-il être préparé ?

### 1.3 Le bac à sable réglementaire — la seule voie de conformité identifiée

- **Art. 198.1 du *Code des professions*** : le ministre peut autoriser par
  arrêté un projet pilote dont les normes « **s'appliquent malgré toute
  disposition inconciliable** » d'une loi ou d'un règlement d'ordre. Durée
  maximale **deux ans**, prolongeable d'un an.
  <https://www.legisquebec.gouv.qc.ca/fr/document/lc/C-26>
- **Barreau du Québec** — projet pilote de services juridiques novateurs, publié
  à la Gazette officielle le **20 mai 2026**. *L'avis ne mentionne toutefois
  aucune dérogation aux règles de partage d'honoraires.*
- **Chambre des notaires : aucun bac à sable trouvé.** Sa seule position publique
  sur les intermédiaires est la mise en garde de 2024, qui va **en sens
  inverse**.
- **Ontario, Access to Innovation (LSO)** : pilote ouvert aux non-titulaires de
  permis depuis le 8 novembre 2021 ; **Deeded** y a été admise et se décrit comme
  « a technology platform and is **not a law firm** ».

**À retenir :** l'art. 198.1 est la seule porte identifiée qui permettrait au
modèle actuel d'exister légalement au Québec. Elle exige une démarche auprès du
ministre et **de la Chambre**, dont la position publique est aujourd'hui hostile
aux intermédiaires. Cette démarche est un projet en soi, à budgéter et à mener
avant la mise en service — pas après.

---

## 2. Articles 70, 68 et 69 — la publicité et les témoignages d'appui

**Source :** *Code de déontologie des notaires*, RLRQ c. N-3, r. 2.
<https://www.legisquebec.gouv.qc.ca/fr/document/rc/N-3,%20r.%202>

> **Art. 70.** « Le notaire ne peut, dans sa publicité, utiliser **ou permettre
> que soit utilisé** un témoignage d'appui ou de reconnaissance qui le concerne,
> à l'exception des prix d'excellence et autres mérites soulignant une
> contribution ou une réalisation dont l'honneur a rejailli sur la profession. »

Deux caractéristiques rendent cet article contraignant pour une plateforme :

1. **Aucune exception pour les avis authentiques.** L'interdiction ne porte pas
   sur le mensonge : elle porte sur le **témoignage d'appui** lui-même. Un avis
   client vrai, vérifié et non sollicité tombe dans l'interdiction.
2. **« ou permettre que soit utilisé ».** Le verbe atteint le notaire simplement
   **listé** sur une plateforme qui affiche des évaluations le concernant. En
   affichant une note, **c'est Nota qui met ses propres notaires en défaut** —
   et un notaire mis en défaut par son fournisseur quitte le fournisseur.

**Art. 69** : ne s'attribuer des qualités ou habiletés particulières « que s'il
est en mesure de les justifier ». **Art. 68** : aucune publicité fausse,
trompeuse, incomplète ou susceptible d'induire en erreur.

### 2.1 Le raisonnement d'Avvo — pourquoi une note n'est pas un simple affichage

L'avis **1132 du barreau de l'État de New York** tient qu'**afficher une note
transforme un annuaire en recommandation** — et qu'une recommandation rémunérée
est interdite.

Appliqué à Nota, ce raisonnement mordait plus fort qu'ailleurs, parce que la
cote n'était pas une décoration : **elle décidait combien Nota prélevait**.
Affichée au client, elle aurait été exactement une recommandation dont l'auteur a
un intérêt financier au classement. **Cette aggravation est tombée avec l'ADR
0031** — la cote ne décide plus d'aucun montant. Le raisonnement de l'avis 1132
tient néanmoins par lui-même : afficher une note transforme un annuaire en
recommandation, que l'auteur y gagne ou non. C'est pourquoi la cote reste
**invisible côté client** (ADR 0030).

### 2.2 Ce que le régulateur exigerait d'une cote publiée

La formulation la plus claire vient du **New Jersey** : une distinction ne peut
être citée que si celui qui la décerne (a) a **enquêté sur la compétence**,
(b) **ne la vend pas**, et (c) publie « a truthful, plain language description of
the standard or methodology » ouverte à l'inspection.

Nota est vraisemblablement la seule plateforme étudiée capable de satisfaire (c)
— la méthode est publiée et testée (`features/cote.feature`). Mais (b) est
précisément le problème : **la cote est liée au tarif**. Satisfaire ces critères
conditionnerait l'usage de la cote ; cela ne l'autoriserait pas.

### 2.3 ✅ Ce que le produit fait aujourd'hui — vérifié dans le code

**Aucune appréciation portant sur un notaire nommé ne descend vers un client.**

| Vue | Ce qui a été retiré | Ce qui reste, et pourquoi |
| --- | --- | --- |
| `GET /client/bid`, bloc `notaire` | `rating` (moyenne + nombre d'avis), `cote` | `etude`, `courriel`, **`lienCNQ`** et **`actes`** (`handler.js:1763-1771`) |
| `GET /client/bid`, chaque proposition | `rating`, `cote` | `etude`, `montant`, `delta`, `message`, **`cnq`** (booléen), **`actes`** (`handler.js:1797-1801`) |

La frontière est **commentée là où elle se franchirait** : `notaryRating` porte
l'avertissement et le renvoi à l'art. 70 (`handler.js:436-447`), et la projection
des propositions porte le sien (`handler.js:1791-1796`).

**La distinction retenue est la bonne** : un **fait vérifiable** n'est pas un
**témoignage d'appui**.

- `cnq` / `lienCNQ` — l'inscription au tableau de l'Ordre est un fait public,
  vérifiable auprès de la Chambre elle-même.
- `actes` — le nombre d'actes portés sur Nota est un **compte**, pas une
  appréciation : il dit ce que le notaire a fait, pas qu'il est bon.

**Garde-fous automatisés :**

- `apps/api/test/deontologie-avis.test.mjs` — 5 tests qui échouent si une
  moyenne, un compte d'avis ou une cote réapparaît dans une réponse client ; la
  vérification porte aussi sur le **corps brut sérialisé** (`:88-89`), donc une
  fuite par un champ imprévu est attrapée.
- `apps/web/test/client-cote.test.mjs` — balaie le DOM des vues client et échoue
  sur « cote », « avis », « note », « étoile » ou les sélecteurs d'étoiles
  (`:96-105`). La suite avait été écrite **dans l'autre sens** et a été
  retournée : la trace du renversement est dans son en-tête (`:14-22`).
- `apps/web/test/notary-cote.test.mjs` — garde que la console du notaire, elle,
  conserve tout.
- Les deux specs OpenAPI portent la justification à l'endroit du champ
  (`apps/api/openapi.yaml:1275-1281`, `:2078-2081`).

### 2.4 ✅ Ce qui reste, et qui est correct

- **La collecte continue.** Recueillir n'est pas publier : l'invitation à évaluer
  part après le règlement et le registre `NOTARY#/EVAL#` reste écrit
  (`handler.js:1801-1855`). Rien dans le Code n'interdit à une plateforme de
  recueillir de la rétroaction pour son propre usage.
- **Le notaire voit tout de son propre dossier** — sa moyenne, chaque
  commentaire, sa cote, ses quatre axes (`handler.js:1450-1485`). **Son dossier
  n'est pas sa publicité** : l'art. 70 vise la publicité, pas l'information que
  le professionnel reçoit sur lui-même.
- **Nota voit tout** (`GET /admin/notaries`, `admin.js:587-627`) : usage interne
  d'affectation et de qualité, que rien dans le Code ne restreint.
- **La cote continue de décider le partage**, et elle est communiquée **au
  notaire, avant qu'il s'engage**, avec le barème complet
  (`billing.js:122-146`, `handler.js:1450-1462`).

---

## 3. Articles 32, 33 et 34 — le partage d'honoraires

> **Art. 32.** Le partage d'honoraires est interdit avec « une personne qui n'est
> pas membre d'un ordre professionnel régi par le *Code des professions*… ou de
> l'une des organisations visées à l'**Annexe A** ».

L'Annexe A est une **liste fermée** — ordres comptables, OACIQ, AMF, ordres de
juristes, Institut canadien des actuaires. **Une plateforme technologique ne peut
pas y figurer.** Il n'y a pas de voie d'adhésion : c'est une liste, pas un
critère.

> **Art. 33.** Hors la rémunération et les commissions auxquelles il a droit,
> verser ou recevoir « **tout autre avantage** » relatif à l'exercice de sa
> profession est interdit.

L'art. 33 **ferme le contournement** : renommer le partage « frais de service »,
« abonnement » ou « commission de mise en relation » ne le fait pas sortir du
champ si l'avantage est relatif à l'exercice de la profession.

> **Art. 34.** Divulgation écrite obligatoire au client de tout honoraire ou
> commission versé à un tiers **ou reçu d'un tiers**.

### ✅ Ce que le produit fait — et c'est un point fort

L'art. 34 est **le seul de cette section que Nota satisfait déjà**, et
largement :

- **les deux lignes du devis** — les honoraires offerts au notaire et le prix de
  Nota — sont annoncées au client **avant** qu'il publie, séparément ;
- une fois l'acte réglé, **le client revoit les deux lignes** telles qu'elles ont
  été figées, depuis le registre write-once. Il n'y a pas de « partage » à
  divulguer : il y a deux achats, montrés comme deux achats ;
- le notaire voit son taux, sa cote et le barème complet avant de s'engager, et
  son relevé acte par acte après (`GET /notary/acts`, `handler.js:1477-1517`) ;
- le taux est **gravé à l'engagement comme plafond** : une cote qui baisse ne
  renchérit jamais un acte déjà promis (`handler.js:509-524`,
  `billing.js:174-180`).

> ⚠️ **Mais la divulgation ne guérit pas l'interdiction.** L'art. 32 interdit le
> partage ; l'art. 34 impose de le divulguer quand il est licite. **Divulguer
> parfaitement un partage prohibé reste un partage prohibé.** C'est le point que
> l'avis juridique doit trancher, et aucune amélioration de transparence ne le
> réglera.

### Les récompenses de référence

Nota verse 50 $ (piste client) et 250 $ (premier acte d'un notaire référé) à des
partenaires — agents immobiliers, courtiers hypothécaires
(`packages/domain/index.js:1870-1877`).

Le produit affiche que ces récompenses sont « payées à même sa propre commission
— jamais ajoutée au prix du client, jamais retranchée des honoraires du notaire »
(`index.html:1009`). C'est la bonne construction.

### 3.1 ✅ Un notaire ne peut plus réclamer un code — et les deux angles morts

Le risque direct de l'art. 33 était qu'un **notaire** réclame lui-même un code de
parrainage : il recevrait alors un avantage lié à l'exercice de sa profession, et
**c'est Nota qui le mettrait en défaut**.

`POST /partenaires` refuse désormais cette réclamation, juste après la validation
du type, du courriel et du code :

> `handler.js:928-944` — « Un notaire qui réclame un code serait donc mis en
> défaut PAR NOUS — le produit refuse la réclamation, en disant pourquoi. Le
> courriel est la seule clé dont nous disposons ; ce n'est pas un contrôle
> infaillible, c'est celui qui ne coûte rien à un partenaire qui n'est pas
> notaire. »

Réponse **422 `notaire_non_admissible`**, avec un message qui explique la règle
et rappelle que l'espace notaire, lui, reste ouvert. Trois tests le couvrent
(`apps/api/test/deontologie-parrainage.test.mjs`) : le refus, le contournement
par la casse et les espaces, et le partenaire non-notaire qui passe comme avant.
Le code d'erreur est documenté (`apps/api/openapi.yaml:231`).

**C'est le bon garde-fou, et il est honnête sur sa portée.** Mais il ne ferme pas
l'exposition. Deux angles morts, à écrire tels quels :

**1. Le contrôle ne tient qu'au courriel.** La clé est
`repo.getNotary(notaryIdForEmail(courriel))` — un identifiant dérivé par hachage
de l'adresse normalisée. **Un notaire qui réclame un code avec une adresse
personnelle passe** : l'identité n'est recoupée contre rien, ni contre le tableau
de l'Ordre, ni contre un nom. La normalisation casse/espaces est bien fermée
(`handler.js:918`, plus la normalisation interne de `notaryIdForEmail`), donc le
contournement trivial ne fonctionne pas — mais changer d'adresse suffit.

**2. Le contrôle porte sur la réclamation, jamais sur le versement.** Un parrain
qui réclame son code en toute légitimité **puis devient notaire** continue
d'accumuler : `recordReferralEarnings` (`handler.js:560-598`) ne vérifie que la
validité du code, jamais le statut de son propriétaire. Rien ne l'arrête, rien ne
le signale.

À quoi s'ajoute une variante plus étroite : la réclamation est un **échange en
deux temps**, et seule la première étape contrôle. `POST /partenaires/verify` —
qui écrit le `PARTNER#`, c'est-à-dire **le payeur de record** — ne refait aucune
vérification. La fenêtre est courte (le défi est à durée de vie limitée), mais
elle existe.

**Ce qu'il faudrait pour fermer :** rejouer la vérification à
`/partenaires/verify` **et** au moment de chaque versement, et recouper autrement
que par le courriel — au minimum contre le tableau de l'Ordre, ce qui suppose la
vérification CNQ de l'exposition n° 3. Les deux chantiers se rejoignent.

> ⚠️ **À faire qualifier par l'avis, en plus :** lorsqu'un **notaire** est référé
> par un partenaire non-notaire et que ce partenaire touche 250 $ au premier acte
> (`handler.js:584-598`), le versement est-il un « avantage relatif à l'exercice
> de la profession » au sens de l'art. 33 ? Le bénéficiaire n'est pas notaire,
> mais le fait générateur est l'acte d'un notaire. Et le refus au moment de la
> réclamation suffit-il, ou le **versement** lui-même doit-il être conditionné ?

---

## 4. Articles 71 et 72 — la présentation des prix

> **Art. 71.** Honoraires compréhensibles pour un profane, **maintenus au moins
> 60 jours** après la dernière diffusion, services inclus précisés, mention si
> les débours et taxes sont inclus.
>
> **Art. 72.** « Le notaire ne peut… accorder dans une déclaration ou un message
> publicitaire **plus d'importance aux honoraires professionnels demandés qu'au
> service professionnel offert**. »

**L'art. 72 est une contrainte directe sur l'interface de Nota**, qui est par
construction un marché de **prix et de dates**. Le carnet public affiche un
montant et une date ; c'est sa fonction.

### État réel

| Exigence | État |
| --- | --- |
| Prix compréhensible, tout compris | ✅ « le montant que vous offrez est le total, tout compris : rien ne s'y ajoute » (`index.html:1170`) |
| Mention des débours et taxes | ⚠️ **à vérifier** — le produit dit « tout compris » ; il faut s'assurer que les débours réels (droits d'inscription, etc.) sont bien couverts ou explicitement exclus |
| Services inclus précisés | ✅ partiellement — le catalogue décrit chaque service (`packages/domain/index.js`) |
| Maintien 60 jours | ⚠️ **non applicable tel quel** : les prix de Nota sont dynamiques par date et par secteur. À qualifier — le plancher serveur est-il une « diffusion d'honoraires » au sens de l'art. 71 ? |
| Art. 72 — le service avant le prix | ⚠️ **exposé.** Le carnet est ordonné par date et montant. Une note de mémoire interne indique que le produit a déjà déplacé « le prix avant les documents » dans le tunnel client — c'est-à-dire dans la direction inverse de l'art. 72. |

> ⚠️ **Point d'attention produit.** Une décision d'expérience utilisateur —
> montrer le prix tôt — a une conséquence déontologique. Toute interface qui met
> le montant au premier plan et le service au second doit être revue contre
> l'art. 72. **Cette contrainte doit entrer dans les critères de conception, pas
> seulement dans la revue juridique finale.**

---

## 5. Articles 29.1 et 31 — l'indépendance du notaire

> **Art. 29.1.** Aucune convention « ayant pour effet de mettre en péril
> l'indépendance, le désintéressement, l'objectivité et l'intégrité requis ».
>
> **Art. 31.** « Le notaire doit **ignorer toute intervention d'un tiers** qui
> pourrait influer sur l'exécution de ses devoirs professionnels. »

### ✅ Ce que le produit fait

- Nota **n'intervient jamais dans l'acte** et le dit, au client comme au notaire
  (`index.html:1142-1143`).
- Le notaire **choisit librement** ce qu'il retient, et **décliner ne lui coûte
  rien** — voir ci-dessous.
- Le dossier et les coordonnées ne sont libérés **qu'au notaire qui retient**
  (`handler.js:1613`).

> ✅ **Un point de tension a été identifié puis retiré** (1er septembre 2026).
> L'axe « disponibilité » de la cote compte les demandes **déclinées** — et l'on
> pouvait craindre qu'un notaire refusant un mandat que sa déontologie lui
> **impose** de refuser (conflit d'intérêts, compétence insuffisante, surcharge)
> le paie financièrement. **Ce n'est pas ce que fait le code.**
>
> Le domaine additionne les deux compteurs : `reponses = repondu + declinees`,
> puis `points = 12 × min(1, √(reponses / cible)) + portée`
> (`packages/domain/index.js:1306-1323`). **Un déclin est compté comme une
> réponse.** Ce qui vaut zéro, c'est le **silence** — ne pas répondre du tout.
>
> Vérifié en exécutant le domaine sur un profil réel : 0 déclin → cote 69,
> 1 → 70, 2 → 70, 5 → 71, 10 → 73. **Décliner fait légèrement MONTER la cote.**
> (Et depuis l'ADR 0031, la cote ne décide plus d'aucun montant : décliner ne
> peut plus rien coûter du tout.)
>
> Le test `packages/domain/test/cote.test.mjs` — « décliner est une RÉPONSE,
> jamais une pénalité ; seul le silence coûte » — vérifie que dix déclins et dix
> acceptations donnent **exactement** la même note, et que le détail reste
> honnête sur ce qui s'est réellement passé. L'adaptateur porte l'avertissement
> pour le prochain lecteur (`apps/api/src/cote.js:47-51`).
>
> **La même correction a retiré le sous-axe « éventail du catalogue »** : se
> spécialiser ne coûte plus rien, parce que le Code impose au notaire de
> connaître ses limites. Test : « se spécialiser ne coûte rien — le Code impose
> de connaître ses limites » (même volume d'actes, même cote, que le notaire
> serve un service ou cinq). L'information reste visible dans le détail de
> l'axe ; elle a cessé d'être une sanction.
>
> Les deux retraits sont motivés dans
> `docs/decisions/0028-la-cote-sur-100-decide-le-partage.md`, section « deux
> sanctions déontologiquement à l'envers, retirées ».

**Cette section ne porte donc plus d'exposition.** Elle est conservée parce que
le raisonnement compte : une cote qui décide d'une rémunération **ne doit jamais
pénaliser un comportement que la déontologie impose**. C'est un critère de
conception permanent, à appliquer à tout nouvel axe.

> ⚠️ **Erreur d'analyse à ne pas refaire.** La version précédente de ce document
> affirmait que décliner faisait monter le taux prélevé. Elle l'avait **inféré de
> l'adaptateur** (`cote.js`, qui se contente de porter `declinesCount` vers le
> domaine) **sans lire la fonction qui calcule la note**. Le port dit ce qui est
> transmis, jamais ce qui en est fait : la règle vit dans
> `packages/domain/index.js`.

---

## 6. Ce qui reste exposé — liste ordonnée par gravité

Une exposition de la version précédente a **disparu après vérification** :
« décliner une demande fait monter le taux prélevé » était une inférence fausse,
tirée de l'adaptateur sans lire le domaine (§5). Le n° 3 a **gagné en gravité**
depuis l'ADR 0030 ; le n° 5 a été **atténué par un garde-fou, sans être fermé**
(§3.1).

| # | Exposition | Fondement | Ce qui existe | Reste à faire |
| :-: | --- | --- | --- | --- |
| **1** | **Le modèle économique lui-même.** Nota perçoit un prix **par acte notarié**, en tant qu'intermédiaire. Le prélèvement sur les honoraires (5 % à 15 %) est **retiré** ; ce qui reste à qualifier est le prix propre de Nota. | **Art. 32.1 L.N.** (2 500–125 000 $, doublé en récidive) ; art. 32/33 C.déont. ; mise en garde du syndic du 25/01/2024 | Le notaire reçoit **100 %** du montant offert (ADR 0031) ; le prix de Nota est **publié d'avance**, par service et par délai, et ne dépend ni du notaire ni de la valeur de l'acte (ADR 0034) ; le circuit est celui du client qui paie la plateforme ; Nota assume le risque de paiement, et le service rendu est réel et distinct. | **Avis juridique écrit — REQUIS.** Faire qualifier le prix par acte. Préparer le repli : facturer le service **hors de l'acte** (abonnement, forfait dossier). Envisager la démarche d'art. 198.1 auprès du ministre et de la Chambre. |
| **2** | ~~La cote fait varier la part selon la personne du notaire.~~ **Fermé le 1<sup>er</sup> septembre 2026.** | Art. 32.1 2° ; art. 32 ; **art. 29.1** | Le prix de Nota ne dépend **ni du notaire, ni de sa cote, ni de la valeur de l'acte** — invariant testé (`apps/api/test/prix-nota-separe.test.mjs`). La cote subsiste comme signal de service et **ne décide plus d'aucun dollar**. | Rien. Ne jamais réintroduire une rémunération indexée sur une note attribuée par une entreprise privée : l'art. 29.1 l'interdit deux fois. |
| **3** | **Le badge « CNQ » n'est pas vérifié** — le seul contrôle est un format d'URL (`packages/domain/index.js:1399-1402`). **L'ADR 0030 vient d'en augmenter le poids** : en retirant la note et la cote des vues client, il a fait de `cnq` et `actes` les **deux seuls signaux** sur lesquels un client choisit son notaire. Un signal rare porte plus de charge qu'un signal parmi cinq — et celui-ci n'est adossé à rien. | **Art. 68** (publicité trompeuse) ; protection du public ; crédibilité devant la Chambre | Badge `cnq` et `lienCNQ` affichés, désormais mis en avant — mais **jamais vérifiés auprès de l'Ordre**. | **Vérification réelle du statut au Tableau, et radiation immédiate.** Afficher une appartenance à l'Ordre sans la vérifier est trompeur en soi — d'autant plus quand c'est le principal signal de confiance offert. |
| **4** | **L'art. 72 contre une interface de marché.** Le prix est structurellement au premier plan. **Et le devis est incomplet** : ni les taxes (TPS/TVQ) ni les débours n'apparaissent nulle part dans le produit. | **Art. 72** ; **art. 71 3°** (indiquer si les débours et taxes sont inclus) ; **art. 68** (publicité incomplète) | Prix clair, deux lignes séparées, publiées avant tout engagement et figées sur l'offre. Aucune surface ne dit « tout compris ». | **Chiffrer et afficher les taxes et les débours** — préalable à toute affirmation de complétude. Revoir la hiérarchie visuelle prix/service. Qualifier le maintien 60 jours face à un prix dynamique. |
| **5** | **Les récompenses de parrainage versées à un notaire** — 50 $ par client amené, 250 $ pour un notaire amené qui complète son premier acte. **Atténuée, pas fermée** : le refus ne tient qu'au courriel, et il porte sur la réclamation, jamais sur le versement. | **Art. 33** (« tout autre avantage ») | ✅ `POST /partenaires` **refuse** une réclamation dont le courriel correspond à un notaire connu — `notaire_non_admissible`, 422, avec un message qui dit pourquoi (`handler.js:928-944`). 3 tests (`apps/api/test/deontologie-parrainage.test.mjs`), code documenté (`openapi.yaml:231`). Par ailleurs, payées par Nota, jamais retranchées des honoraires ni ajoutées au prix (`index.html:1009`). | Fermer les deux angles morts (§3.1). Faire qualifier le fait générateur, et faire dire à l'avis si le refus au moment de la réclamation suffit ou si le **versement** doit être conditionné. |
| **6** | **Aucune décision disciplinaire n'a été trouvée** sur le partage d'honoraires avec une plateforme. | — | — | **Absence de preuve n'est pas preuve d'absence.** Recherche plein texte SOQUIJ à commander avec l'avis. |

---

## 7. Le mandat élargi de l'avis juridique

Le plan d'affaires budgète **20 000 $** pour un avis écrit et un engagement
structuré avec la Chambre (`../business-plan.md:133-134`, `:554`). **Ce mandat
ne couvrait que le partage d'honoraires. Il est désormais insuffisant.**

Le mandat doit couvrir **quatre volets** :

1. **Le partage d'honoraires et l'art. 32.1** — la qualification du prélèvement
   de Nota, la portée de la présomption d'usurpation, l'incidence du fait que le
   client paie la plateforme, et **l'évaluation d'un frais fixe par acte comme
   structure de repli**. *(Le volet le plus lourd — voir §1.)*
2. **L'affichage des avis et l'art. 70** — la frontière fait/appréciation
   retenue par l'ADR 0030 tient-elle ? `actes` et `cnq` sont-ils bien des faits
   publiables ? Une plateforme peut-elle **recueillir** des avis qu'elle ne
   publie pas ?
3. **La qualification de la cote** — est-elle une « recommandation » au sens du
   raisonnement d'Avvo ? Son usage **interne** — affectation et tarification —
   est-il licite alors même que sa publication ne le serait pas ?
4. **La présentation des prix et l'art. 72** — une interface de marché peut-elle
   satisfaire l'exigence de ne pas donner plus d'importance aux honoraires qu'au
   service ? Les art. 71 (maintien 60 jours, débours) s'appliquent-ils à un prix
   dynamique ?

**Ce qui n'a PAS besoin d'y figurer :** la crainte que la cote pénalise un refus
imposé par la déontologie. Vérification faite, le code ne le fait pas, et deux
tests le verrouillent (§5).

---

## 8. Ce qu'il faut retenir

- **La conformité prime, et c'est écrit.** L'ADR 0030 acte la hiérarchie.
- **Le retrait de la cote des vues client est réel, testé et bien construit** —
  la distinction fait / témoignage d'appui est la bonne, et les garde-fous
  automatisés empêchent la régression.
- **Mais il ne répond pas au risque principal.** L'art. 32.1 vise le modèle
  économique, pas l'affichage. Ne pas publier la cote n'y change rien.
- **La Chambre a annoncé qu'elle agirait.** La mise en garde du 25 janvier 2024
  n'est pas un texte dormant : elle vise « certains modèles d'affaires en place »
  et annonce des recours.
- **Aucun acte ne devrait être porté sur Nota avant l'avis écrit**, désormais
  élargi aux quatre volets ci-dessus.

---

## Art. 49 — la fixation des honoraires appartient au notaire (ajouté 2026-09-01)

Signalé par Antoine Leclerc (Stein Monast). **Texte vérifié mot pour mot** à
Légis Québec :

> **49.** Le notaire doit exiger des honoraires justes et raisonnables qui sont
> justifiés par les circonstances et proportionnels aux services rendus et doit
> **s'interdire toute compétition déloyale envers ses confrères** à cet égard.
>
> Il doit notamment tenir compte des facteurs suivants pour la fixation de ses
> honoraires : 1° son expérience ou son expertise ; 2° le temps consacré ;
> 3° la difficulté et l'importance du service ; 4° la prestation de services
> inhabituels ou exigeant une compétence particulière ou **une célérité
> exceptionnelle** ; 5° l'importance de la responsabilité assumée ; 6° le
> résultat obtenu dans une affaire présentant des difficultés spéciales.

### Le cadeau : 49(4°) nomme la célérité

**La prime d'urgence n'est pas étrangère au Code — elle y est énumérée.** Le
4° invite expressément le notaire à tenir compte d'« une célérité
exceptionnelle » pour fixer ses honoraires. La thèse de Nota — une date
rapprochée vaut plus cher — a donc un ancrage réglementaire, ce qui est
exactement l'inverse de ce qu'on pouvait craindre. À citer devant la Chambre.

### Le danger : le moteur de prix parle à la place du notaire

Les six facteurs sont ceux **du notaire**. Or le domaine de Nota ne se contente
pas d'héberger le chiffre d'un client : il le **calcule** — `prixDepart`,
`pricing.base`, paliers sur la valeur du prêt, approbation bancaire, succession,
co-emprunteur, déplacement, puis les multiplicateurs de date de 1,0× à 10×.
C'est un algorithme qui produit un montant pour un acte notarié, dans la voix de
Nota, avant qu'aucun notaire ne l'ait vu.

Plusieurs entrées correspondent aux facteurs (difficulté → succession et
co-emprunteur ; célérité → palier de date). **Mais la pondération est faite par
Nota, pas par le notaire.** C'est l'exposition, et elle est structurelle :
c'est le moteur de prix, c'est-à-dire le coeur du domaine.

**Direction d'atténuation** — le nombre doit être une *indication de marché qui
aide le client à formuler une offre*, jamais une détermination d'honoraires :

- ne jamais présenter le montant comme « le prix de l'acte » ni comme « les
  honoraires » — c'est **ce que le client offre** ;
- la contre-offre du notaire doit rester de plein droit et sans friction (déjà
  supporté : accepter / contre-offrir / passer) ;
- envisager d'afficher une **fourchette de marché** plutôt qu'un nombre unique ;
- l'acceptation par le notaire doit être un acte de fixation d'honoraires
  documenté, pas un simple clic.

### Le troisième volet, que personne n'avait relevé

« **s'interdire toute compétition déloyale envers ses confrères** ». Un carnet
public où les prix acceptés sont visibles, et où un client magasine par prix,
peut être décrit comme induisant une concurrence déloyale entre confrères.
C'est un risque distinct de tous les autres du registre — il ne vise ni le
partage, ni l'indépendance, mais la **structure même d'un marché affiché**.
À ajouter au mandat de l'avis juridique.

### ⚠️ Ce que l'ADR 0031 vient de faire à l'art. 49 (constaté 2026-09-02)

L'atténuation écrite ci-dessus — « ne jamais présenter le montant comme les
honoraires : c'est **ce que le client offre** » — a été rédigée le
1<sup>er</sup> septembre, sous le modèle en pourcentage. **Elle n'est plus
disponible telle quelle.**

L'ADR 0031 a fait du montant offert la totalité des honoraires du notaire :

- `apps/api/src/billing.js:184` — `honorairesCents = Math.round(actAmount * 100)`,
  où `actAmount` **est** l'offre du client ;
- `packages/domain/index.js:1719-1732` — `recommendedAmount` **pré-remplit**
  cette offre : `notaPrice` (base du service + les adds du barème) × le
  multiplicateur du palier de date.

Autrement dit, la chaîne complète est désormais : **un algorithme de Nota
produit un nombre, ce nombre est pré-rempli dans le formulaire du client, et ce
nombre devient au dollar près les honoraires du notaire.** La ligne de défense
« ce n'est pas un prix, c'est une offre » tenait tant qu'une part revenait à
Nota et qu'une négociation implicite subsistait ; elle est plus mince quand le
code lui-même nomme le résultat `honoraires`.

**Ce n'est pas un argument contre l'ADR 0031** — sans lui, l'art. 32.1 2° et
l'art. 32 restent frontalement violés, et ces deux textes sont plus lourds que
l'art. 49. C'est le constat que **la conformité s'est déplacée, pas dissoute** :
la restructuration a fermé le partage d'honoraires et a, du même geste, tendu
l'exposition à l'art. 49.

**Ce qui reste vrai et acquis.** Les surfaces client parlent déjà d'« offre » et
de « prix », jamais d'« honoraires » (`apps/web/public/index.html:512, 603,
1170`), la copie notaire dit expressément « Vous fixez vos honoraires »
(`:926, 1182`), et la contre-offre existe de plein droit (« Proposer un prix »,
`apps/web/public/app.js:5664, 5830`). Le vocabulaire est donc déjà du bon côté.
**Ce qui manque est structurel, pas lexical.**

**Les trois pistes, par coût croissant, à trancher par le propriétaire :**

1. **La fourchette.** `recommendedAmount` retourne un intervalle plutôt qu'un
   nombre, et le formulaire n'est pas pré-rempli. Nota indique un marché ; le
   client choisit. Coût : le « une seule tape pour réserver » disparaît.
2. **L'acceptation comme acte de fixation.** Retenir cesse d'être un clic : le
   notaire confirme le montant *en tant que ses honoraires*, en vue des
   facteurs de l'art. 49 — les `facteurs` de complexité déjà calculés
   (`domain.complexity`) sont exactement les 3° et 4°. Le registre write-once
   en garde la trace. Coût : une friction sur l'action principale du notaire.
3. **Ne rien changer et faire qualifier.** L'art. 49 vise **le notaire**, pas
   Nota : c'est un risque pour le membre, que Nota induit, et non une infraction
   propre à Nota. À poser tel quel au mandat.

**Ajout au mandat de l'avis juridique (5<sup>e</sup> volet).** Un notaire qui
accepte un montant calculé par un tiers, dans un carnet où les prix retenus sont
publics, respecte-t-il l'art. 49 — la fixation d'honoraires justes et
raisonnables selon *ses* six facteurs, et l'interdiction de la compétition
déloyale envers ses confrères ? Et la plateforme qui produit ce montant
aide-t-elle le notaire à contrevenir (art. 156 du *Code des professions*) ?
