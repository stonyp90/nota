# Piste d'audit financière — état réel au 1er septembre 2026 (révisé)

> ⚠️ **PÉRIMÉ SUR UN POINT — corrigé le 2026-09-02.** Ce document décrit le
> partage d'honoraires (« Nota conserve au plus 15 %, le notaire garde de 85 %
> à 95 % selon sa cote ») comme s'il était en vigueur. **Il ne l'est plus.**
> L'[ADR 0031](../decisions/0031-le-prix-de-nota-est-celui-de-nota.md) l'a
> retiré : le notaire reçoit 100 % du montant offert, et Nota facture au client
> un **prix fixe** pour son propre service. Les art. 32 et 32.1 2° condamnaient
> la mécanique décrite ici. Tout le reste du document tient ; ne citez pas ses
> passages sur le partage sans lire l'ADR 0031 d'abord.

**Statut : constat technique, non révisé par un auditeur externe.**

Ce document décrit la piste d'audit **telle qu'elle existe dans le code
aujourd'hui**, événement par événement. Chaque affirmation cite son fichier et
sa ligne. Rien n'est décrit au futur : ce qui n'est pas écrit dans le code est
listé comme manquant.

**Révision du 1er septembre 2026 (soir).** Une passe de correction a répondu à
l'essentiel de la version précédente : le parcours de l'argent est désormais
journalisé, le journal a une porte de lecture, le barème est figé dans le
registre, l'instant de rétention est persisté, et le faux règlement du chemin de
repli est devenu une créance honnête. Ce qui suit tient compte de ces
changements — **et relève deux problèmes nouveaux, dont un qui annule en
production le bénéfice du premier**.

**Seconde révision, même soir.** L'ADR 0030 (« la déontologie prime ») retire
toute appréciation d'un notaire nommé des vues client, et une **correction
factuelle** est répercutée ici : contrairement à ce qu'affirmait l'ADR 0027,
**le client paie la PLATEFORME** — vérifié dans le port Stripe (§0.1).

---

## 0. Le résumé, avant le détail

| | |
| --- | --- |
| **Ce qui a été réparé** | trace de transaction (`acte_retenu`, `acte_regle`, `annulation_frais`), `GET /admin/audit`, `GET /admin/notaries`, `GET /notary/acts`, `taux`/`cote`/`serviceId` figés dans le registre `ACT#`, `retainedAt` persisté, **`tauxRetenu` gravé comme plafond**, fin du règlement fantôme |
| ~~Le trou nouveau, et grave~~ | ✅ **corrigé pendant la rédaction** : la trace de transaction vit désormais dans la table principale (`appendTxAudit`), `GET /admin/audit` fusionne les deux journaux, et un test la câble comme en production (§1) |
| **Le trou nouveau, structurel** | la créance (`commissionCentsDue`) s'accumule et **rien ne permet de la recouvrer ni de l'éteindre** (§5) |
| **Ce qui restait, et reste** | la part de Nota n'est pas un objet Stripe, le TTL efface les pièces, l'agrégat de notation est écrit sans condition, l'idempotence webhook n'est pas atomique |
| **Nouveau, hors piste d'audit** | la cote et les évaluations ne descendent plus vers le client (ADR 0030) — sans effet sur la reconstitution, avec un effet sur ce qu'un auditeur peut lire côté client (§0.2) |

---

## 0.1 Correction factuelle — le client paie la plateforme

L'ADR 0027 rangeait Nota du côté du prélèvement sur les honoraires du notaire.
**La lecture du port Stripe montre l'inverse**, et c'est important autant pour
l'audit financier que pour la qualification déontologique.

| Étape | Ce que le code fait réellement | Preuve |
| --- | --- | --- |
| Caution à la publication | session Checkout **sur le compte de Nota** : `mode: 'payment'`, capture manuelle, **aucun compte connecté**, **pas de `on_behalf_of`**, **pas de `transfer_data`**, **pas d'`application_fee_amount`** | `apps/api/src/stripe-port.js:85-116` |
| Règlement | `paymentIntents.capture` **sur la plateforme**, puis `transfers.create` du net vers le compte connecté du notaire | `stripe-port.js:126-146` |
| L'ancien chemin inverse | `chargeActCommission` — charge de destination sur le compte du notaire, Nota en frais d'application — **supprimé** par l'ADR 0029 ; le port porte la note à sa place | `stripe-port.js:68-75` |

**Le client contracte donc avec Nota et paie Nota** ; le notaire est payé par
virement depuis la plateforme. Aucun flux ne part du notaire vers Nota.

L'en-tête du port décrit désormais ce circuit et nomme la question réellement
ouverte — **la qualification de la part de Nota, pas la direction du flux**
(`stripe-port.js:16-30`).

**Conséquence pour l'audit :** ce circuit est le **plus simple à auditer** des
deux — un encaissement plateforme et un décaissement, tous deux sur le compte
Stripe de Nota. Il ne règle en revanche rien du §8.2 n° 3 : la part de Nota
reste une **différence arithmétique**, jamais un objet Stripe nommé.

**Conséquence déontologique :** le risque se déplace de la *direction du flux*
vers la **qualification** au sens de l'art. 32.1 de la *Loi sur le notariat*.
Voir [`../legal/conformite-deontologique-notaires.md`](../legal/conformite-deontologique-notaires.md) §1.

## 0.2 Nouvelle frontière de publication (ADR 0030)

**Aucune appréciation portant sur un notaire nommé ne descend vers un client.**
Sont retirés de `GET /client/bid` — bloc `notaire` et chaque proposition — la
moyenne d'étoiles, le nombre d'avis et la cote sur 100. Restent des **faits** :
`cnq` / `lienCNQ` et `actes` (`handler.js:1763-1771`, `:1797-1801`).

**Sans effet sur la piste d'audit** : la collecte des évaluations, le registre
`NOTARY#/EVAL#`, la console du notaire, le registre `/admin/notaries` et le fait
que la cote décide le partage sont **inchangés**. Ce qui change est la surface
de lecture côté client.

**Un effet indirect qui compte pour un auditeur** : la cote reste pleinement
reconstituable — depuis le registre `EVAL#`, depuis `coteRetenue` gravée à
l'engagement et depuis `cote` figée dans le registre `ACT#` — mais **elle n'est
plus vérifiable par le client lui-même**. La transparence de la tarification
repose désormais entièrement sur les surfaces notaire et admin, et sur le bloc
`acte` que le client reçoit **après** règlement (`handler.js:1807-1810`).

---

## 1. ✅ Le journal de transaction atteint la production — corrigé

Ce paragraphe portait, il y a quelques heures, le constat le plus grave de cette
révision : la trace de transaction était **écrite mais jamais persistée en
production**. Elle l'est désormais. Le constat et sa correction sont conservés
ici, parce que le mécanisme d'échec mérite d'être connu.

### Le défaut, tel qu'il était

Le journal administratif vit dans la table `nota-admin`, à laquelle la Lambda
publique n'a **délibérément** aucun accès. `appendAudit` y écrivait via
`adminTable()`, qui **lève** quand le repo n'a pas de nom de table admin
(`repo-dynamo.js:90-92`) — et c'est exactement le câblage du point d'entrée
public (`apps/api/index.js:11-14`). L'exception était avalée par le `catch`
best-effort du handler. Même la variable d'environnement ajoutée, l'IAM n'aurait
pas suivi : la Lambda publique n'a de droits DynamoDB que sur la table
principale (`infra/lambda.tf:60`).

**Le journal fonctionnait donc uniquement sous l'adaptateur mémoire — c'est-à-dire
uniquement dans les tests.**

### La correction

C'est l'option 1 qui a été retenue : **les événements d'argent vivent dans la
table principale**, où la Lambda publique a déjà `PutItem`.

| Élément | Où |
| --- | --- |
| `appendTxAudit` / `queryTxAuditByDay`, sur `tableName` | `repo-dynamo.js:1072-1110` |
| Le handler préfère `appendTxAudit`, avec repli sur `appendAudit` | `handler.js:301-304` |
| Jumeau mémoire | `repo-memory.js:494` |
| `GET /admin/audit` **fusionne les deux journaux** — administratif et transactionnel | `admin.js:677-678` |
| La console admin peut lire la table principale (`Query`, lecture seule) | `infra/admin.tf:126-131` |

Aucune permission nouvelle n'a été nécessaire, et l'isolement des deux tables est
préservé : la Lambda publique n'a toujours aucun accès à `nota-admin`.

### Le garde-fou, qui est le vrai enseignement

`apps/api/test/audit-dynamo.test.mjs` (**5 tests, tous au vert**) pilote
l'adaptateur DynamoDB avec un faux enregistreur, **câblé exactement comme la
Lambda publique — sans table admin** — et échoue si une trace repart vers la
mauvaise table. Son en-tête décrit le défaut d'origine.

> **La leçon à retenir, et à généraliser.** Ce défaut a existé sans bruit parce
> qu'un `catch` silencieux couvrait un contrôle best-effort qu'aucun test
> n'exerçait dans son câblage de production. **Tout contrôle best-effort a besoin
> d'un test qui échoue quand il ne s'exécute pas** — sinon il n'est pas un
> contrôle, seulement une intention. Le même schéma reste à vérifier ailleurs :
> les rollups `STATS#` (`billing.js:174-188`), l'écriture du registre `EVAL#`
> (`handler.js:1876`) et les gains de parrainage (`handler.js:558-598`) sont tous
> avalés de la même manière.

---

## 2. Les deux tables et les familles de clés

Toutes les clés vivent dans `apps/api/src/keys.js`.

| Table | Contenu | Écrite par |
| --- | --- | --- |
| `nota-main` | offres, notaires, actes, événements Stripe, ledger de parrainage, compteurs, configuration | Lambda API publique |
| `nota-admin` | identités admin, sessions révocables, défis magic-link, **journal d'audit**, compteurs anti-abus | Lambda admin (`keys.js:300-336`) — **et, en intention seulement, la Lambda publique : voir §1** |

### Le journal a désormais une porte de lecture

C'était le reproche central de la version précédente. Il est levé :

- **`GET /admin/audit?jour=AAAA-MM-JJ`** — `apps/api/src/admin-handler.js:219-226`,
  logique dans `apps/api/src/admin.js:662-676`. Gardée par **`pii:read`**
  (`admin.js:665-667`), donc `super_admin` seul ; **422** si le jour n'est pas
  une date ISO (`admin.js:669-671`) ; le plus récent d'abord (`admin.js:674`).
  Documentée dans `apps/api/admin-openapi.yaml:710`.
- **`GET /admin/notaries`** — `admin-handler.js:207-214`, logique dans
  `admin.js:587-627`. Même garde `pii:read`. Registre nominatif : cote et ses
  axes, taux effectif, part du notaire, actes et actes par service, note et
  nombre d'avis, **`commissionPercue` ET `commissionDue`** — l'encaissé et la
  créance ne sont jamais confondus (`admin.js:616-620`). Le barème est résolu
  **une seule fois pour tout le registre** (`admin.js:598`), pour que deux
  notaires soient comparés sous la même règle. Documentée dans
  `admin-openapi.yaml:620`.

> ⚠️ **Limite du registre.** `repo.listNotaries()` et `listActiveNotaries()`
> exécutent la **même** requête sur l'index GSI1 (`repo-dynamo.js:328-333`), et
> `putNotary` n'y inscrit un profil **que s'il est `active`**
> (`repo-dynamo.js:306-309`). Le registre admin **omet donc tout notaire en
> intégration, restreint ou déconnecté** — c'est-à-dire précisément celui qui
> part en devant de l'argent. La créance d'un notaire qui se déconnecte devient
> invisible à l'écran même si elle reste sur son profil.

---

## 3. Publication de l'offre — autorisation de la carte

### Ce qui est écrit

| Élément | Clé | Référence |
| --- | --- | --- |
| L'offre | `PK = MONTH#YYYY-MM`, `SK = BID#<dateISO>#<id>` | `keys.js:34-40`, écrite en `handler.js:822` |

Le montant retenu n'est jamais celui envoyé par le client :
`domain.validateOffer` recalcule le plancher à partir du service, de la date, du
secteur et des critères de tarification (`handler.js:732-744`), et l'item stocke
`basePrice` — le plancher serveur contre lequel l'offre a été validée. C'est la
seule preuve conservée que le prix était licite.

Champs horodatés : `createdAt` et `ttl` — **suppression automatique ~400 jours
après la date de signature** (`handler.js:815`).

Avec la facturation activée, l'offre naît `paymentStatus: 'pending'`
(`handler.js:821`), puis une session Checkout en **capture manuelle** est ouverte
(`billing.js:342-352` → `apps/api/src/stripe-port.js:95-126`). La carte est
**autorisée, pas débitée** (`stripe-port.js:104`).

### Idempotence

Clé Stripe `auth:<bidId>` (`stripe-port.js:123`). Un double POST `/bids` crée en
revanche **deux offres distinctes** (`newId()`, `handler.js:760`) : aucune
déduplication côté Nota.

### Ce qui manque encore

- **Aucune trace d'audit à la publication.** Les trois actions journalisées
  couvrent la rétention, le règlement et le frais d'annulation ; la publication
  et l'autorisation de la carte n'en produisent aucune. C'est le premier maillon
  de la chaîne, et il reste muet — au-delà de `createdAt` sur l'item lui-même.
- Le **barème de tarification** appliqué à la publication n'est pas conservé :
  seul son résultat (`basePrice`) l'est. Un changement de plancher rend l'ancien
  prix irreproductible.

---

## 4. Confirmation de l'autorisation — webhook Stripe

| Élément | Clé | Référence |
| --- | --- | --- |
| L'événement traité | `PK = EVENT#<stripeEventId>`, `SK = EVENT` | `keys.js:52-56`, `repo-dynamo.js:334-340` |
| L'offre, mise à jour | mêmes clés qu'en §3 | `repo-dynamo.js:203-218` |

`checkout.session.completed` lie le `paymentIntentId` à l'offre et pose
`authorizedAt` (`billing.js:534-544`). C'est **le premier horodatage financier
fiable** de la chaîne. `checkout.session.expired` et `payment_intent.canceled`
posent `voidedAt` (`billing.js:548-556`).

### Idempotence — toujours non atomique

`handleWebhook` lit `wasEventProcessed` puis, après traitement, écrit
`markEventProcessed` (`billing.js:575-581`). L'écriture est un `PutCommand`
**sans `ConditionExpression`** (`repo-dynamo.js:334-340`) : deux livraisons
concurrentes du même événement passent toutes deux le contrôle de lecture. Pour
les types traités l'effet reste idempotent par nature (écriture d'état), donc le
risque financier est faible — mais **la garantie affichée n'est pas celle que le
code offre**.

Le corps de l'événement n'est toujours **pas conservé** : seuls `stripeEventId`
et `processedAt` (`repo-dynamo.js:338`). Reconstituer ce que Stripe a annoncé
exige d'aller dans le tableau de bord Stripe, hors du système.

---

## 5. La rétention, puis le règlement

### 5.1 Rétention — l'instant existe enfin

`retainFor` (`handler.js:493-547`) pose désormais l'horodatage de l'engagement :

> `handler.js:501-503` — « L'INSTANT de l'engagement. Sans lui, la piste d'audit
> ne peut pas dire quand un notaire s'est engagé — seulement qu'il l'a fait. »
> `updated.retainedAt = new Date(nowMs()).toISOString();`

Il est écrit **dans la même écriture conditionnelle** que la rétention
(`repo-dynamo.js:180-197`, condition `status = ouverte`) : un seul gagnant, et
l'instant appartient au gagnant. La trace `acte_retenu` est appendée juste après
la victoire (`handler.js:527-536`) — modulo §1.

**Le taux est gravé en même temps, comme plafond.** `tauxRetenu` et
`coteRetenue` sont posés sur l'offre à la rétention (`handler.js:509-524`) :

> « La cote se relit à chaque tarification ; sans cette empreinte, un notaire
> pouvait retenir en voyant 8 % et payer 10 % à la signature parce qu'un déclin
> ou une évaluation avait bougé entre-temps. Le taux gravé ici devient un
> PLAFOND : le règlement applique le meilleur des deux. »

Au règlement, `priceAct` borne le taux du jour par ce plafond, lui-même borné par
le plancher du barème (`billing.js:174-180`) : une cote qui monte profite encore
au notaire, une cote qui baisse **ne renchérit jamais un acte déjà promis**. Le
plafond voyage jusque dans le registre (`tauxRetenu`, `billing.js:333` et `:445`)
et dans la trace `acte_retenu` (`handler.js:534-535`).

C'est exactement le contrôle qu'un auditeur cherche sur un prix variable : **le
prix promis est opposable et conservé**.

| Élément | Clé | Référence |
| --- | --- | --- |
| L'offre retenue, avec `retainedAt`, `tauxRetenu`, `coteRetenue` | `MONTH#…` / `BID#…` | `repo-dynamo.js:180-197` |
| Le pointeur d'agenda | `NOTARY#<id>` / `RETAINED#<dateISO>#<bidId>` | `handler.js:537-542` |
| Le gain de parrainage, s'il y a lieu | `PARTNER#<CODE>` / `EARN#<TRACK>#<ref>` | `handler.js:558-598` |

**Le `ttl` de 400 jours reste sur l'offre** : `retainedAt` et l'empreinte de taux
disparaissent avec elle — mais `tauxRetenu` est recopié dans le registre `ACT#`,
qui survit. Pour un acte réglé, la preuve tient ; pour un acte retenu jamais
réglé, elle s'efface.

### 5.2 Règlement, chemin nominal — capture et virement

`payNotaryOnAccept` (`billing.js:379-463`) → `stripe-port.js:126-146` :

1. `paymentIntents.capture` **sur la plateforme** — clé `capture:<bidId>`
   (`stripe-port.js:130`) ;
2. `transfers.create` du net = montant − part de Nota — clé `transfer:<bidId>`
   (`stripe-port.js:134-144`), `transfer_group: bid:<bidId>`.

Le client a payé **Nota** (§0.1) ; le notaire est payé par virement depuis la
plateforme.

### 5.3 Le registre `ACT#` porte maintenant la divulgation

C'est la correction la plus utile pour un auditeur. `priceAct`
(`billing.js:169-172`) retourne le montant **et** le taux effectif **et** la
cote, et les deux chemins de règlement les figent dans l'item write-once :

> `billing.js:428-429` (chemin payé) et `billing.js:314-317` (chemin hors
> plateforme) — « la divulgation rides IN the write-once ledger: the rate
> applied and the cote that earned it, frozen with the money. A later barème
> change can never rewrite what this act was charged. »

Le registre `ACT#<bidId>` porte donc désormais : `bidId, notaryId, actAmount,
commissionCents, **taux**, **cote**, **tauxRetenu**, **serviceId**, completedAt`,
plus `netCents / transferId / chargeId / paidOnAccept` sur le chemin payé, ou
`paye: false / commissionCentsDue` sur l'autre. Write-once par
`attribute_not_exists(PK)` (`repo-dynamo.js:735-749`).

`tauxRetenu` y figure à côté de `taux` (`billing.js:333`, `:445`) : l'auditeur
voit **le taux promis à l'engagement et le taux réellement appliqué**, et peut
vérifier que le second n'a jamais dépassé le premier.

**Un acte est désormais démontrable seul** : le montant, le taux, la cote qui l'a
mérité et la référence Stripe tiennent dans un item immuable. Une modification
ultérieure du barème ne peut plus réécrire l'histoire.

### 5.4 Le relevé du notaire

`GET /notary/acts` (`handler.js:1477-1517`) rend le relevé acte par acte, lu par
les pointeurs de rétention (aucun index nouveau, `handler.js:1483`). Chaque ligne
porte `montant, taux, cote, commission, net, completedAt, paye` et **`du`**
(`handler.js:1493-1512`). Un acte antérieur à la correction, qui ne porte pas de
`taux`, le voit **déduit de ce qui a réellement été facturé, jamais du barème
d'aujourd'hui** (`handler.js:1502`) — c'est la bonne façon de traiter
l'historique.

### 5.5 Le règlement fantôme est corrigé — et devient une créance

Le défaut le plus grave de la version précédente est réparé. `completeAct`
**n'appelle plus Stripe du tout** :

> `billing.js:264-268` — « Before 2026-09-01 this path called
> `stripe.chargeActCommission`, which created a PaymentIntent with no payment
> method and no `confirm`: it moved no money, yet the ledger, the accumulator and
> the « acte payé » email all claimed it had. A ledger that asserts a payment
> nobody made is worse than an unpaid invoice. »

Le comportement actuel :

| | |
| --- | --- |
| Registre `ACT#` | `paye: false`, `commissionCentsDue: fee` (`billing.js:318-319`) |
| Profil du notaire | `commissionCentsDue` **augmenté** ; `commissionCentsCollected` **intouché** (`billing.js:330-332`) |
| Courriel | `onActPaid({ paye })` — le relevé « acte payé » n'est envoyé que sur un virement réel (`handler.js:1146-1151`) |
| Relevé notaire | ligne `paye: false`, `du: commission` (`handler.js:1507-1511`) |
| Registre admin | `commissionDue` distinct de `commissionPercue` (`admin.js:616-620`) |

L'acte est donc enregistré comme **réglé hors plateforme** — le client a payé le
notaire directement — et la part de Nota est une **créance**, nommée comme telle
partout où elle apparaît. C'est honnête et c'est correctement propagé.

### ⚠️ Mais rien ne permet de recouvrer cette créance

`commissionCentsDue` **s'accumule et ne redescend jamais**. Vérifié : les seules
occurrences dans tout `apps/api/src/` sont l'écriture au registre
(`billing.js:319`), l'incrément sur le profil (`billing.js:332`) et la lecture au
registre admin (`admin.js:620`). **Il n'existe :**

- aucune route pour facturer, encaisser ou marquer payée une créance ;
- aucun mécanisme pour la décrémenter — même si Nota l'encaisse hors ligne, le
  chiffre affiché reste faux à la hausse pour toujours ;
- aucun item de créance horodaté : seul un total agrégé sur le profil, plus la
  ligne par acte reconstituable depuis les registres `ACT#` ;
- aucun échéancier, aucune relance, aucun état (« due », « facturée »,
  « encaissée », « radiée ») ;
- **aucune visibilité sur le notaire qui part** : un profil non `active` sort de
  l'index GSI1 et disparaît du registre admin (§2), créance comprise.

Un auditeur verra donc un compte de produits à recevoir qui ne fait que croître,
sans aucune contrepartie, sans âge, et sans procédure de recouvrement. **C'est
aujourd'hui le premier trou de la piste financière**, devant tout le reste — au
même rang que §1.

### 5.6 Frais d'annulation

Route `handler.js:1992-2080`. Un acte déjà réglé ne peut plus être annulé — le
registre `ACT#` sert de garde. Le frais est prélevé par **capture partielle** de
l'autorisation vivante (`billing.js:456-466` → `stripe-port.js:166-174`, clé
`cancelfee:<bidId>`), Stripe libérant le reste immédiatement.

La trace est maintenant double : sur l'item de l'offre
(`annulation = { taux, frais, joursAvant, chargeId }`, `handler.js:2022`) **et**
dans le journal (`annulation_frais`, `handler.js:2025-2034`) — modulo §1.

Restent : l'offre annulée porte le `ttl` de 400 jours, donc **la preuve du frais
disparaît avec elle** ; les fonds **restent sur la plateforme** sans virement ni
écriture de destination (`stripe-port.js:163-164`) ; **un échec de capture n'est
journalisé nulle part** (`handler.js:2021` n'écrit la trace que sur succès).

---

## 6. L'évaluation

Route `handler.js:1831-1885`. L'évaluation n'ouvre qu'après écriture du registre
`ACT#`. Trois écritures : sur l'offre, sur l'agrégat `ratingSum`/`ratingCount` du
profil, et dans le registre anonymisé `NOTARY#<id>` / `EVAL#<createdAt>#<bidId>`
(`keys.js:92-102`).

**Lien direct avec l'argent** : l'agrégat alimente `domain.notaryScore` via
`apps/api/src/cote.js:32-59`, qui détermine le taux du prochain règlement
(`billing.js:105-147`). Une évaluation modifie le partage futur.

Ce qui manque, inchangé :

- L'agrégat est un **read-modify-write non conditionnel**
  (`handler.js:1855-1861`) : deux évaluations simultanées peuvent en perdre une.
  Le registre `EVAL#` reste juste, mais l'agrégat — celui qui fixe le taux —
  peut diverger de lui, et **rien ne les réconcilie**.
- L'écriture du registre `EVAL#` est dans un `try/catch` silencieux
  (`handler.js:1876`).
- L'évaluation vit sur l'offre : **le TTL l'efface** au bout de ~400 jours, alors
  que l'agrégat qui en découle est permanent. Après 13 mois, la cote d'un notaire
  — donc son taux — n'est plus justifiable pièce par pièce. Le registre `EVAL#`,
  lui, survit : c'est lui qu'il faut désigner comme la pièce de référence.

---

## 7. Le barème

Modifiable en production sans déploiement, relu à chaque tarification
(`billing.js:77-91`), stocké dans `CONFIG#COMMISSION / BAREME` (`keys.js:283-286`).

Défauts intégrés (`apps/api/src/commission-config.js:23, 27, 32-37`) :

| Cote atteinte | Nota garde | Le notaire garde |
| ---: | ---: | ---: |
| — | 15 % | 85 % |
| 60 | 12 % | 88 % |
| 70 | 10 % | 90 % |
| 80 | 8 % | 92 % |
| 90 | 5 % | **95 %** (plancher) |

Les modifications sont journalisées avec avant/après dans le journal admin
(`admin.js:483, 501`) — et ce journal est maintenant **lisible** (§2).

**La divulgation est désormais cohérente de bout en bout.** Le site annonce ce
que le code facture : « Nota conserve au plus 15 % » et « le notaire 85 % à
95 % » (`apps/web/public/index.html:768, 1160, 1170`,
`apps/web/public/i18n.js:721, 730`). L'ancienne contradiction 75/25 et la phrase
« ce que vous offrez est ce que le notaire reçoit » ont disparu de la charte
(`index.html:1214` porte maintenant « Transparence des prix »). L'ADR 0028
existe (`docs/decisions/0028-la-cote-sur-100-decide-le-partage.md`). Le notaire
voit sa cote, son taux, ses axes et le prochain palier
(`billing.js:122-146`, `handler.js:1450-1462`), et l'opérateur voit le même
chiffre pour tous sous un barème résolu une seule fois (`admin.js:598`).

### 7.1 Où la divulgation se lit désormais — et où elle ne se lit plus

L'ADR 0030 déplace la surface de divulgation, sans en retirer la substance.

| Destinataire | Ce qu'il voit | Où |
| --- | --- | --- |
| **Le notaire, avant de s'engager** | sa cote, ses quatre axes, son taux effectif, le prochain palier, le barème complet | `handler.js:1450-1485` |
| **Le notaire, après règlement** | son relevé acte par acte : montant, taux, cote, part de Nota, net, `paye`, `du` | `GET /notary/acts`, `handler.js:1477-1517` |
| **Le client, avant de publier** | « Nota conserve au plus 15 % », « le notaire 85 % à 95 % » | `index.html:768, 1160, 1170` |
| **Le client, après règlement** | comment **son** montant s'est partagé, depuis le registre write-once | `handler.js:1807-1810` |
| **L'opérateur** | le registre nominatif complet : cote, axes, taux, actes, note, avis, encaissé, dû | `GET /admin/notaries`, `admin.js:587-627` |
| **Le client, sur un notaire nommé, avant de choisir** | ~~moyenne, avis, cote~~ → **`cnq`, `lienCNQ`, `actes` seulement** | `handler.js:1763-1771`, `:1797-1801` |

La dernière ligne est le changement de l'ADR 0030. **La divulgation du partage
reste intégrale** — c'est celle de la règle et du prix. Ce qui disparaît est
l'appréciation portant sur une personne, retirée pour l'art. 70 du *Code de
déontologie* : voir
[`../legal/conformite-deontologique-notaires.md`](../legal/conformite-deontologique-notaires.md) §2.

> **Un point à ne pas manquer pour un audit financier.** La cote détermine le
> prix, et le client ne peut plus la voir. La démonstration que le prix appliqué
> était le bon repose donc **entièrement** sur les registres internes :
> `coteRetenue` et `tauxRetenu` gravés à l'engagement, `cote` et `taux` figés
> dans `ACT#`, le registre `EVAL#` en amont, et le journal d'audit. **Chacune de
> ces pièces doit être irréprochable** — ce qui rend §1 (le journal qui n'atteint
> pas la production) et §6 (l'agrégat de notation écrit sans condition) plus
> lourds qu'ils ne l'étaient avant l'ADR 0030, pas moins.

---

## 8. Ce qu'un auditeur peut désormais reconstituer, et ce qui manque encore

### 8.1 La chaîne, bout en bout

§1 étant corrigé, la colonne « journal » est désormais vraie en production :

| Étape | Preuve dans la table | Instant | Journal | Recoupement externe |
| --- | --- | --- | --- | --- |
| **Publication** | `BID#` : `serviceId, montant, basePrice, prefixe` | `createdAt` | ❌ aucune | — |
| **Autorisation carte** | `BID#` : `paymentIntentId, paymentStatus` | `authorizedAt` | ❌ aucune | ✅ Stripe : PaymentIntent |
| **Rétention** | `BID#` : `notaryId, etude`, **`tauxRetenu`, `coteRetenue`** ; pointeur `RETAINED#` | ✅ **`retainedAt`** | ✅ `acte_retenu` | — |
| **Règlement payé** | `ACT#` : `actAmount, commissionCents, taux, cote, tauxRetenu, serviceId, netCents, chargeId, transferId` | `completedAt` | ✅ `acte_regle` | ⚠️ partiel (§8.2) |
| **Règlement hors plateforme** | `ACT#` : idem + `paye:false, commissionCentsDue` | `completedAt` | ✅ `acte_regle` | ❌ aucun — hors système |
| **Frais d'annulation** | `BID#` : `annulation{taux,frais,joursAvant,chargeId}` | `cancelledAt` | ✅ `annulation_frais` | ✅ Stripe : capture partielle |
| **Évaluation** | `EVAL#` sous `NOTARY#` | `createdAt` | ❌ aucune | — |

**Ce qui est maintenant vrai et ne l'était pas :** pour un acte réglé, un
auditeur peut prendre le seul item `ACT#<bidId>` et démontrer le montant, le
taux appliqué, la cote qui l'a mérité, le service, la part de Nota, le net du
notaire et les références Stripe — **sans dépendre du barème d'aujourd'hui**. Il
peut ensuite dater l'engagement (`retainedAt`), vérifier que le taux appliqué n'a
pas dépassé le taux promis (`tauxRetenu` vs `taux`), lire la trace du jour
ouvrable (`GET /admin/audit?jour=…`), et confronter au relevé que le notaire
lui-même voit (`GET /notary/acts`) et au registre nominatif de l'opérateur
(`GET /admin/notaries`). C'est une piste d'audit réelle.

**Et le circuit qu'elle décrit est le plus simple à recouper** : le client paie
la plateforme, la plateforme vire le net au notaire (§0.1). Tous les mouvements
sont sur un seul compte Stripe, celui de Nota.

**Ce qu'un auditeur ne peut PAS faire, et doit savoir :** vérifier la cote depuis
la place du client. L'ADR 0030 l'a retirée des vues client ; la vérification du
prix passe désormais par les registres internes et les surfaces notaire et admin
(§7.1).

### 8.2 Ce qui manque encore pour boucler chaque dollar

Classé par gravité.

| # | Manque | Où | Effort |
| :-: | --- | --- | :-: |
| 1 | **La créance n'a ni cycle de vie ni recouvrement** : `commissionCentsDue` ne fait que croître, aucune route, aucun état, aucun âge — et disparaît de l'écran quand le notaire cesse d'être `active`. | `billing.js:319, 332`, `admin.js:620`, `repo-dynamo.js:306-309, 328-333` | **M** |
| 2 | **La part de Nota n'est pas un objet Stripe.** Le client paie bien la plateforme (§0.1), mais `applicationFeeCents` est soustrait avant le virement, jamais transmis comme `application_fee_amount`. La part n'existe que comme différence entre un `charge` et un `transfer`, et comme champ écrit par notre propre code. Aucun recoupement indépendant. | `stripe-port.js:126-146` | M |
| 3 | **Publication et autorisation ne sont pas journalisées** : le premier maillon de la chaîne est muet. | `handler.js:845`, `billing.js:534-544` | F |
| 4 | **Le TTL de 400 jours efface les pièces justificatives** — offre, dossier, `retainedAt`, frais d'annulation, évaluation — alors que les registres dérivés (`ACT#`, `EVAL#`, agrégats) survivent. Après 13 mois, un `ACT#` référence une offre qui n'existe plus. | `handler.js:815` | Décision de politique |
| 5 | **L'agrégat de notation, qui fixe le taux, est écrit sans condition** et peut diverger du registre `EVAL#` sans réconciliation. Plus lourd depuis l'ADR 0030 : le client ne peut plus voir la cote, donc plus rien hors nos registres ne la contredit. | `handler.js:1855-1861` | F |
| 6 | **Idempotence webhook non atomique** (lire-puis-écrire sans `ConditionExpression`). | `billing.js:575-581`, `repo-dynamo.js:334-340` | F |
| 7 | **Le corps des événements Stripe n'est pas conservé** : seuls l'identifiant et l'instant de traitement. | `repo-dynamo.js:338` | F |
| 8 | **Les dettes de parrainage n'ont ni état de paiement ni reprise** : écrites à la rétention, jamais reprises si l'acte est annulé. | `repo-dynamo.js:847-852`, `handler.js:537-577` | M |
| 9 | **Un échec de capture de frais d'annulation n'est journalisé nulle part.** | `handler.js:2021` | F |

---

## 9. Ce qui fonctionne bien — à ne pas casser

- Le registre `ACT#` est un vrai **write-once** conditionné, et il porte
  maintenant **le taux et la cote figés avec l'argent**
  (`repo-dynamo.js:735-749`, `billing.js:314-317, 428-429`).
- La trace `acte_regle` est **lue depuis le registre**, pas depuis la requête, et
  n'est écrite qu'au premier règlement (`handler.js:1148-1150`).
- Le seau du journal est **le jour ouvrable québécois**, honoré par les deux
  adaptateurs (`handler.js:303`, `repo-dynamo.js:1072`, `repo-memory.js:490-495`).
- Toutes les opérations Stripe portent une **clé d'idempotence dérivée du
  `bidId`** : `auth:`, `capture:`, `transfer:`, `cancelfee:`, `cancel:`.
- La rétention est protégée contre la course par une condition sur le statut, et
  `retainedAt` est posé dans cette même écriture (`repo-dynamo.js:180-197`).
- Le journal a désormais **deux lecteurs gardés par `pii:read`** :
  `GET /admin/audit` et `GET /admin/notaries`, tous deux dans
  `admin-openapi.yaml`.
- **Un encaissement et une créance ne sont jamais confondus** — dans le registre,
  sur le profil, dans le relevé du notaire, dans le registre admin et dans le
  courriel.
- Les données de carte **ne touchent jamais nos serveurs** (`stripe-port.js:14`) ;
  les fichiers du dossier **ne quittent jamais l'appareil du client**
  (`packages/domain/index.js:1821-1830`).
