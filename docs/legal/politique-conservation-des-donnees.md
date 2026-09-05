# Politique de conservation des données

> **BROUILLON NON RÉVISÉ.** Rédigé à partir du code, non par un juriste. Voir
> [`README.md`](README.md).

**Version : 0.1 (brouillon) · Date d'entrée en vigueur : à déterminer**

La Loi 25 impose une conservation **bornée** : un renseignement personnel est
détruit ou anonymisé lorsque la finalité pour laquelle il a été recueilli est
accomplie, sous réserve d'un délai de conservation prévu par la loi.

Ce document énonce les durées **voulues**, puis, honnêtement, les durées
**réellement appliquées par le code**. Les deux ne coïncident pas partout.

---

## 1. Le calendrier voulu

| Catégorie | Conservation | Justification |
| --- | --- | --- |
| Offre publiée et son dossier | **12 mois** après la date de signature | suivi du service, différends |
| Courriel de notification lié à une offre | effacé à la clôture ou à l'expiration de l'offre | finalité accomplie |
| Téléphone du client | même calendrier que l'offre | mise en relation seulement |
| Registre de règlement d'un acte (montant, part, références Stripe) | **7 ans** | obligations fiscales et comptables |
| Registre des évaluations | **12 mois**, puis anonymisation définitive | alimente la cote |
| Profil de notaire | durée de la relation, puis **24 mois** | preuve de la relation d'affaires |
| Journal d'audit — gestes d'administration **et** chaîne d'accès aux dossiers | **7 ans**, à la condition ci-dessous | preuve d'imputabilité |
| Journaux techniques (Lambda, accès) | **12 mois** | investigation d'incident |
| Défis de connexion, compteurs anti-abus | **minutes à heures** | usage unique |
| Registre des incidents de confidentialité | **5 ans** après la date de l'incident | exigence Loi 25 |
| Désabonnements | **indéfiniment** | on ne peut pas oublier un refus sans le violer |

### La condition attachée aux sept ans du journal d'audit

Le 2026-09-03, le journal d'audit s'est élargi : il ne porte plus seulement les
gestes d'administration, mais la **chaîne d'accès** — demande et redemption d'un
lien de connexion notaire, émission du jeton porteur du client, dépôt et lecture
d'une pièce du dossier, réclamation d'un code partenaire.

Cet élargissement a d'abord été livré avec une **adresse IP sur chaque entrée**.
C'était une contradiction avec la ligne suivante du même tableau : un journal
d'accès est borné ici à douze mois, et celui-ci héritait de sept ans. Une adresse
IP est un renseignement personnel au sens de la Loi 25, et la permission
`audit:read` — qui ouvre ce journal — est délibérément distincte de `pii:read`.

La contradiction a été levée le 2026-09-04 **par le code, pas par le tableau** :

- **Le journal public ne consigne aucune adresse d'origine.** L'enveloppe d'une
  entrée écrite par la porte publique porte `ip: null`, et l'acteur est réduit à
  `{ type, id }`. L'origine sert à l'investigation d'incident : c'est la finalité
  des journaux techniques de la Lambda, que la ligne suivante borne à douze mois
  et qui la portent déjà.
- **Aucune adresse courriel non plus.** L'acteur est nommé par un identifiant
  interne : le notaire par l'identifiant dérivé de sa boîte, le client par
  l'offre qui est son dossier, le partenaire par son code.
- **Ces identifiants deviennent orphelins bien avant les sept ans.** L'offre et
  son dossier sont détruits à 400 jours (§2) ; passé ce délai, le `bidId` d'une
  entrée d'audit ne pointe plus sur rien. La conservation longue porte donc sur
  un fait — « quelqu'un a lu cette pièce ce jour-là » — et non sur une personne
  identifiable.

Le journal **administratif** continue, lui, de porter le courriel et l'adresse de
l'administrateur : ce sont des employés nommés agissant sur une console interne,
et cette règle est antérieure à l'élargissement.

Ce qui reste ouvert : le profil de notaire, lui, n'a toujours aucune borne (§2),
et un `notaryId` reste donc joignable à une personne au-delà des sept ans.

---

## 1 bis. La politique EXÉCUTABLE (2026-09-05)

> Le tableau du §1 énonçait des durées **voulues** ; le §2 décrivait, honnêtement,
> des durées **réellement appliquées** qui n'y correspondaient pas. Depuis le
> 2026-09-05, une seule table fait les deux : `RETENTION_FAMILIES` dans
> [`packages/domain/index.js`](../../packages/domain/index.js). **Le code la lit ;
> il ne la recopie plus.** Avant elle, une même règle vivait à quatre endroits —
> 400 jours en clair dans `handler.js`, 400 jours redits dans `keys.js`, sept ans
> calculés dans le domaine, 180 jours pour les avis — et six familles n'avaient
> aucune borne du tout.

Trois principes tiennent cette table, et trois tests les gardent
(`packages/domain/test/conservation-effacement.test.mjs`,
`apps/api/test/conservation-politique.test.mjs`) :

1. **Une famille absente est un bogue.** Un élément écrit sans ligne ici est un
   élément que personne n'a décidé de conserver. C'est exactement le test
   automatisé que le §5 de ce document appelait « le seul moyen de rendre cette
   politique auto-exécutoire ».
2. **`indéfini` n'est jamais un oubli.** Une conservation sans borne doit porter
   son motif, sans quoi la ligne ne passe pas les tests.
3. **Rien ne se raccourcit en douce.** Les durées existantes sont reprises telles
   quelles ; celles qui sont apparues le sont sur des familles qui n'en avaient
   **aucune**. Une rétention raccourcie DÉTRUIT des données.

| Famille | Durée | Ancre | Changement du 2026-09-05 | Réglage |
| --- | --- | --- | --- | --- |
| `offre` | **400 j** | date de signature | inchangée — seulement déplacée dans la politique | `NOTA_OFFRE_RETENTION_DAYS` |
| `index_client` | **400 j** | date de signature | inchangée ; c'est la MÊME famille que l'offre, elles ne peuvent plus se désaccorder | `NOTA_INDEX_CLIENT_RETENTION_DAYS` |
| `avis` | **180 j** | instant de l'avis | inchangée ; l'ancienne clé `NOTA_NOTIF_RETENTION_DAYS` reste honorée | `NOTA_AVIS_RETENTION_DAYS` |
| `journal_sujet` | 730 j — **écrite, PAS encore appliquée** | instant de l'envoi | décidée le 2026-09-05 ; `appendSubjectEvent` ne pose toujours aucun `ttl` | `NOTA_JOURNAL_SUJET_RETENTION_DAYS` |
| `journal_audit` | **7 ans civils** | instant d'écriture | inchangée (ADR 0036) ; l'échéance reste CALENDAIRE | `NOTA_JOURNAL_AUDIT_RETENTION_DAYS` |
| `acte` | **7 ans civils** | instant du règlement | **AJOUTÉE** — `ACT#` n'avait aucun `ttl` | `NOTA_ACTE_RETENTION_DAYS` |
| `evaluation` | **365 j** | instant de l'évaluation | **AJOUTÉE** — `EVAL#` n'avait aucun `ttl` | `NOTA_EVALUATION_RETENTION_DAYS` |
| `gain_parrainage` | **7 ans civils** | instant du gain | **AJOUTÉE** — `EARN#` n'avait aucun `ttl` | `NOTA_GAIN_PARRAINAGE_RETENTION_DAYS` |
| `evenement_stripe` | **400 j** | instant du traitement | **AJOUTÉE** — `EVENT#` n'avait aucun `ttl`. Volontairement LARGE : sous la durée de vie d'une offre, un rappel tardif serait rejoué et l'acte réglé deux fois | `NOTA_EVENEMENT_STRIPE_RETENTION_DAYS` |
| `destinataire_campagne` | 1 095 j — **écrite, PAS encore appliquée** | instant de l'envoi | décidée le 2026-09-05 ; `appendCampaignRecipient` ne pose toujours aucun `ttl` | `NOTA_DESTINATAIRE_CAMPAGNE_RETENTION_DAYS` |
| `fil_soutien` | 730 j — **écrite, PAS encore appliquée** | dernier message | décidée le 2026-09-05 ; `putSupportThread` ne pose toujours aucun `ttl` | `NOTA_FIL_SOUTIEN_RETENTION_DAYS` |
| `profil_notaire` | **indéfini** | — | **écart NOMMÉ, non refermé** (voir ci-dessous) | `NOTA_PROFIL_NOTAIRE_RETENTION_DAYS` |
| `desabonnement` | **indéfini** | — | inchangée, et voulue : on ne peut pas oublier un refus sans le violer | — |
| `consentement` | **indéfini** | — | voulue : le fardeau de prouver le consentement pèse sur l'expéditeur (LCAP, art. 13) | — |
| `effacement` | **indéfini** | — | voulue : sans la marque, « effacé » et « jamais connu » se confondent | — |

### Trois durées sont ÉCRITES sans être APPLIQUÉES, et le code le dit

`journal_sujet`, `destinataire_campagne` et `fil_soutien` portent une durée dans
la politique ; aucun adaptateur ne pose leur `ttl`. Ces lignes n'expirent donc
pas, et rien ne les efface sur demande — le journal des envois et les lignes de
destinataire gardent l'adresse **en clair**.

Ce n'est pas une note de bas de page : cette politique voyage dans l'export
remis à la personne (`GET /admin/usagers/{courriel}/export`). Une durée annoncée
là est une promesse faite à elle. Chaque ligne porte donc `applique: false` et sa
raison, et `apps/api/test/conservation-politique.test.mjs` relit la source des
adaptateurs pour faire rougir tout drapeau qui mentirait — dans un sens comme
dans l'autre.

Refermer l'écart demande une décision distincte : poser ces `ttl` **détruira**
des lignes à échéance, ce qui est précisément le geste que le §3 ci-dessus
interdit de faire en douce.

### Ce que ces ajouts changent, et ce qu'ils ne changent pas

- **Ils ne touchent QUE les écritures futures.** Le `ttl` DynamoDB est posé à
  l'écriture. Les `ACT#`, `EVAL#`, `EARN#` et `EVENT#` **déjà en table
  n'expireront jamais** — exactement comme les entrées d'audit antérieures au
  2026-09-03. Rien n'est rétroactif, et rien ne le sera sans une passe de
  rattrapage explicite, à décider séparément.
- **Une borne ajoutée ne détruit rien aujourd'hui.** La plus courte des durées
  neuves est de 365 jours : aucune donnée écrite maintenant ne disparaît avant
  septembre 2027.
- **Une durée indéfinie ne se borne PAS par variable d'environnement.** C'est le
  seul sens interdit : donner trente jours au registre des désabonnements ferait
  revenir, un mois plus tard, quelqu'un qui a dit non. La table refuse.
- **Les bornes de PREUVE se comptent en années civiles.** Sept fois 365 jours
  expirerait deux jours trop tôt (2028 et 2032 sont bissextiles) ; sur une pièce
  comptable, arrondir vers le bas est la seule erreur qui coûte cher.

### Le profil de notaire : pourquoi il reste sans borne

Le §1 veut « 24 mois **après la fin de la relation** », et cette fin **n'est
enregistrée nulle part**. Sans ancre, aucun `ttl` honnête n'est calculable : posé
à la création, il détruirait le profil d'un notaire actif. La ligne est donc
`indéfini`, **avec son motif**, et l'écart reste ouvert — nommé plutôt que
maquillé. Il se refermera le jour où la désactivation d'un notaire datera la fin
de la relation.

---

## 1 ter. La demande d'accès et l'effacement (Loi 25, art. 27 et 28)

Le §3 listait « aucune suppression sur demande » comme « le manquement le plus
exigible immédiatement ». Il est levé, et il faut dire exactement jusqu'où.

**Ce qui existe (2026-09-05).** Trois portes dans la console
(`/admin/usagers/{courriel}`, `…/export`, `…/effacement`), derrière deux
permissions distinctes — `subjects:read` pour ouvrir, `subjects:erase` pour
détruire — et le masquage habituel : sans `pii:read`, rien de nominatif ne
traverse la réponse. Le dossier s'assemble par **l'index `CLIENT#`**, une Query
et non un balayage.

> **L'index existait, testé, et personne ne l'écrivait.** `indexClientBid` /
> `listClientBids` vivaient dans les deux adaptateurs depuis longtemps, avec des
> commentaires expliquant qu'ils rendent une demande d'accès « exécutable » — et
> aucun appelant, ni en lecture ni en écriture. La partition était **vide en
> production** : le droit d'accès était théorique. `POST /bids` l'écrit
> désormais à la publication.

**La frontière de l'effacement est une règle de domaine** (`domain.erasurePlan`),
pas une décision d'écran. Ce qui survit à une demande :

| Ce qui est conservé | Pourquoi |
| --- | --- |
| Les offres dont l'**acte est réglé** | Pièce comptable (sept ans), et l'acte notarié qu'elle documente engage les obligations professionnelles propres du notaire. |
| Les actes **en cours** | La finalité n'est pas accomplie : effacer la partie à mi-mandat abandonnerait le notaire avec un dossier sans client. |
| Le **journal d'audit** | Preuve d'imputabilité. Il ne porte ni adresse d'origine ni courriel : il nomme une offre, pas une personne. |
| Les **refus** (désabonnement, consentement) | Les oublier serait les violer. |
| La **marque d'effacement** | Sans elle, « nous avons effacé » et « nous ne l'avons jamais connue » ne se distinguent plus. |

Le plan est montré **avant** toute destruction, avec le motif et la date de fin
de conservation de chaque ligne ; il se déclare **partiel** dès qu'une donnée
identifiante survit — qu'elle soit gardée par obligation légale **ou hors de
portée du code**.

**Ce que le code ne sait pas détruire est nommé, jamais annoncé effacé.** Quatre
registres figurent au plan avec `executable: false` et leur raison :

| Hors de portée | Ce qui survit |
| --- | --- |
| `journal_sujet` — journal des envois | L'**adresse en clair** : c'est la clé de partition (`SUJET#<courriel>`). |
| `destinataire_campagne` | L'**adresse en clair** ; le registre est partitionné par campagne, on ne sait même pas énumérer les lignes d'une personne. |
| `index_client` | L'**adresse en clair** (`CLIENT#<courriel>`), jusqu'à l'expiration des pointeurs. |
| `avis` | Les avis eux-mêmes ; ils ne nomment personne (leur partition dérive du jeton de l'offre) et expirent d'eux-mêmes. |

Les trois premiers étant identifiants, **aucun plan ne peut aujourd'hui se
déclarer complet**. Jusqu'au 2026-09-05 ces familles étaient rangées dans « ce
qui sera effacé », le plan se déclarait complet et la console disait « Dossier
effacé » : l'adresse restait en clair dans trois registres. C'est le mensonge
exact que cette section existe pour empêcher.

**Ce qui n'est PAS encore fait, et pourquoi.** Le rôle IAM de la console est en
**lecture seule** sur la table des clients (`infra/admin.tf`,
`MainTableReadOnly`). La marque d'effacement a reçu sa porte étroite
(`MainTableErasureMarkWrite`, `ERASURE#*` — **`terraform apply` en attente**),
mais la **réécriture des offres** vit dans des partitions `MONTH#` partagées par
toute la clientèle : aucune condition `LeadingKeys` n'y isole une personne, et
ouvrir `MONTH#*` donnerait à la console l'écriture sur **chaque** offre. Cet
échange est refusé. En conséquence, tant que l'exécutant n'est pas la Lambda
publique, ces écritures-là remontent en **`enAttente`** avec un avertissement —
**jamais** en « effacé ». La règle tenue par les tests : *ne jamais annoncer un
effacement qui n'a pas eu lieu.*

---

## 2. Ce que le code applique réellement

### Ce qui est automatiquement supprimé

| Élément | Mécanisme | Durée réelle |
| --- | --- | --- |
| Offre + dossier + téléphone + courriel + évaluation + trace d'annulation | attribut `ttl` DynamoDB, posé à la création | **400 jours** après la date de signature (`apps/api/src/handler.js:815`) |
| Défi de connexion notaire, réclamation partenaire, compteurs de débit | `ttl` par fenêtre | minutes (`apps/api/src/repo-dynamo.js:648-652, 707-711`) |
| Sessions et défis admin | `ttl` | ≤ 12 h (`apps/api/src/admin.js:216-226`) |
| Versions S3 non courantes | règle de cycle de vie | 30 jours (`infra/s3.tf:31-46`) |
| Journaux Lambda | `retention_in_days` | **14 jours déclarés** (`infra/logs.tf:31-48`) |

Le mécanisme TTL est bien activé sur les deux tables
(`infra/dynamodb.tf:69-72`, `infra/admin.tf:81-84`).

### Ce qui n'est jamais supprimé

| Élément | Pourquoi c'est un problème |
| --- | --- |
| **Profils de notaires** (`NOTARY#…/PROFILE`) | Portent courriel, identifiant Stripe Connect, cumul de ce que Nota a facturé au client sur leurs actes, notations. **Aucun `ttl`.** Toujours vrai le 2026-09-05, et désormais **nommé** dans la politique exécutable avec son motif : la fin de la relation n'est enregistrée nulle part, donc aucune ancre n'existe (§1 bis). Un notaire qui quitte la plateforme y reste indéfiniment. |
| ~~**Registre des actes** (`ACT#…`)~~ | **Corrigé le 2026-09-05** : sept ans civils à compter du règlement (§1 bis, famille `acte`). Les lignes écrites AVANT cette date n'ont pas de `ttl` et n'expireront jamais. |
| ~~**Événements Stripe traités** (`EVENT#…`)~~ | **Corrigé le 2026-09-05** : 400 jours (§1 bis, famille `evenement_stripe`) — délibérément au-delà de la vie d'une offre, pour qu'un rappel tardif ne soit jamais rejoué. Lignes antérieures : sans `ttl`. |
| ~~**Gains de parrainage** (`EARN#…`)~~ | **Corrigé le 2026-09-05** : sept ans civils (§1 bis, famille `gain_parrainage`) — une récompense due ou versée est une pièce comptable. Lignes antérieures : sans `ttl`. |
| ~~**Registre des évaluations** (`EVAL#…`)~~ | **Corrigé le 2026-09-05** : douze mois (§1 bis, famille `evaluation`). Lignes antérieures : sans `ttl`. |
| **Désabonnements** (`UNSUB#…`) | Aucun `ttl` — correct et voulu. |
| **Journal d'audit** (`AUDIT#…`) | ~~Aucun `ttl`~~ — **corrigé le 2026-09-03 (ADR 0036)** : les deux adaptateurs posent désormais un `ttl` calendaire de **sept ans** à l'écriture, sur les deux journaux (`packages/domain` → `auditRetentionTtl`, `apps/api/src/repo-dynamo.js`, `apps/api/src/repo-memory.js`). Conforme au §1 ci-dessus — y compris à la condition qui y est attachée : depuis le 2026-09-04, le journal écrit par la porte publique ne porte **ni adresse d'origine ni adresse courriel** (`ip: null`, acteur réduit à `{ type, id }`), ce qui est ce qui rend sept ans défendables sur un journal d'accès. Les entrées écrites AVANT le 2026-09-03 ne portent pas de `ttl` et n'expireront jamais — rien n'est rétroactif ; et la version qui posait une IP n'a jamais été déployée — elle est corrigée dans la même branche, avant sa mise en ligne. |

---

## 3. Les écarts à corriger

1. **12 mois promis, 400 jours appliqués.** L'application annonce « au plus
   12 mois après la date de signature » (`apps/web/public/index.html:1102`) ; le
   code pose 400 jours, soit environ 13,1 mois
   (`apps/api/src/handler.js:815`). Il faut aligner l'un sur l'autre. Le
   commentaire d'infrastructure parle d'ailleurs de « ~13 mois »
   (`infra/dynamodb.tf:65-68`) : la cible réelle du concepteur n'est pas celle
   annoncée au client.

2. **« Le courriel de notification est effacé dès que l'offre est close ou
   expirée »** (`index.html:1102`) — **c'est faux**. Aucun code n'efface le
   courriel à la clôture ; il disparaît avec l'offre entière, au bout de 400
   jours. Cette phrase doit être retirée ou le comportement implémenté.

3. ~~**Aucune suppression sur demande.**~~ **Levé le 2026-09-05** — voir §1 ter.
   Trois portes existent (dossier, export, effacement), la frontière de
   l'effacement est une règle de domaine testée, et le plan est montré avant
   toute destruction. **Reste ouvert :** la réécriture des offres n'est pas
   exécutable depuis la console (rôle en lecture seule sur la table des
   clients) ; elle remonte en « en attente », jamais en « effacé ».

4. **Les profils de notaires n'ont aucune borne.** Il faut décider d'une durée
   après la fin de la relation et l'implémenter.

5. **Les registres survivent aux pièces justificatives.** Après 400 jours, le
   registre `ACT#` référence une offre effacée, et l'agrégat de notation d'un
   notaire n'est plus justifiable évaluation par évaluation. C'est défendable au
   nom de la minimisation, mais cela doit être un **choix documenté**, pas un
   effet de bord. Voir `../compliance/piste-audit-transactions.md`, §8.

6. **14 jours de journaux, et même pas.** La rétention de 14 jours
   (`infra/logs.tf:31-34`) est trop courte pour investiguer un incident.
   Pire : **aucun groupe de journaux n'existe dans l'état Terraform déployé**, ce
   qui signifie que les groupes auto-créés sont probablement en « N'expire
   jamais », hors de toute gestion — l'inverse exact de la politique.

---

## 4. Destruction

À l'échéance, DynamoDB supprime l'élément. La suppression se propage aux
sauvegardes ponctuelles (PITR) selon leur propre fenêtre de **35 jours**
(`infra/dynamodb.tf:61-63`) : un renseignement supprimé aujourd'hui reste
récupérable pendant 35 jours par restauration. C'est à déclarer au client.

**Un renseignement supprimé chez Nota ne l'est pas nécessairement chez Stripe** :
Stripe applique ses propres durées légales aux transactions.

---

## 5. Responsabilité

L'application de cette politique relève du responsable de la protection des
renseignements personnels (`confidentialite@nota.ca`).

**Revue : annuelle**, et à chaque changement de schéma de données.

> ✅ **Depuis le 2026-09-05, cette vérification existe.** La politique est une
> table lue par le code (§1 bis), et deux suites la tiennent : une famille sans
> ligne ne passe pas, une conservation indéfinie sans motif ne passe pas, et le
> `ttl` que chaque adaptateur pose est comparé à celui que la politique dit
> (`packages/domain/test/conservation-effacement.test.mjs`,
> `apps/api/test/conservation-politique.test.mjs`).
>
> Ce qu'elle ne couvre PAS encore : rien n'oblige un NOUVEAU type d'élément à
> se déclarer dans la table. La garde attrape une famille connue qui perdrait sa
> ligne, pas une famille inventée demain qui n'en aurait jamais eu.
