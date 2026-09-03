# 0034 — La piste d'audit nomme son acteur, se conserve sept ans, et crie quand elle casse

Date : 2026-09-03

Statut : accepté — **complète l'ADR 0028 §divulgation**, ne renverse rien

## Contexte

Nota exploite une place de marché de services juridiques dans un secteur
réglementé : le notaire est tenu au secret professionnel (art. 35 à 37 du *Code
de déontologie des notaires*), et la Loi 25 impose à Nota de pouvoir constater
un accès non autorisé à un renseignement personnel — puis d'en rendre compte.

Un audit du 3 septembre 2026 a passé la piste au crible. Elle existait, elle
était append-only à l'écriture, elle était relisible par jour — et elle ne
répondait à aucune des questions qu'on lui poserait en litige.

**Quatre constats, tous vérifiés dans le code.**

1. **Aucune connexion ne laissait de trace.** `POST /notary/session/request`,
   `/notary/session/verify` et les deux étapes de la réclamation partenaire
   n'appelaient jamais l'audit. Le jeton porteur du client — scope `CLIENT`,
   **400 jours** de validité, la clé qui ouvre la messagerie et les documents du
   dossier — était émis en silence. Un accès non autorisé à un dossier était
   donc à la fois indétectable et irreconstituable : rien ne disait qui avait
   demandé un lien, qui l'avait redemé, ni depuis où.

2. **Les événements n'avaient pas d'acteur.** L'enveloppe codait en dur
   `adminId: null, email: null, ip: null` pour *tous* les événements —
   `document_depose`, `document_lu`, `acte_retenu`, `acte_regle`,
   `annulation_frais`. `document_lu` n'enregistrait qu'un camp (`par: 'client'`
   ou `'notaire'`), jamais une personne, jamais une origine. Un journal d'accès
   aux documents qui ne peut pas nommer qui a lu la pièce ne vaut rien dans un
   litige sur le secret professionnel.

3. **L'écriture d'audit échouait en silence.** Le `catch` vide applique une
   règle juste — « l'audit ne bloque jamais l'argent », un notaire ne doit pas
   rester impayé parce qu'une trace n'a pas pu s'écrire. Mais il rendait un
   puits d'audit cassé **indistinguable d'une journée calme**.

4. **« Append-only » était une promesse que l'IAM contredisait.** Les écrivains
   posent bien une `ConditionExpression` qui interdit d'écraser une entrée, et
   la console affiche « Journal append-only ». Le rôle Lambda admin détenait
   pourtant `DeleteItem` et `BatchWriteItem` sur **toute** la table admin,
   partitions d'audit comprises ; le rôle public détenait `UpdateItem` sur toute
   la table principale, `AUDIT#*` compris. Le rôle pouvait effacer la preuve
   qu'il venait d'écrire.

À quoi s'ajoutait une **conservation non bornée** : la politique de conservation
(§1) nomme sept ans pour le journal d'audit, et aucun `ttl` n'était posé. La
Loi 25 exige une conservation *bornée* — un journal qu'on ne détruit jamais
n'est pas plus conforme qu'un journal absent.

## Décision

### 1. Chaque entrée porte un acteur, sur un vocabulaire fermé

```js
acteur: { type: 'notaire' | 'client' | 'partenaire' | 'systeme', id, ip }
```

L'`id` est **l'identifiant que le système possède déjà, jamais une adresse
courriel** :

| Acteur | `id` | Comment on remonte au nom |
| --- | --- | --- |
| notaire | l'identifiant dérivé de sa boîte (`notaryIdForEmail`) | jointure sur `NOTARY#…/PROFILE` |
| client | l'identifiant de son offre | le dossier **est** son identité : il n'a pas de compte |
| partenaire | son code de parrainage | jointure sur `PARTNER#…` |
| systeme | `null` | écriture hors requête ; aucune origine inventée |

La minimisation de la Loi 25 et l'utilité pour un auditeur pointent ici dans le
même sens : une clé joignable aux registres vaut mieux qu'une donnée personnelle
recopiée dans un journal conservé sept ans. Corollaire assumé : l'adresse d'un
inconnu qui frappe à la porte notaire **n'est pas consignée** — la consigner
reviendrait à bâtir un registre de non-clients.

L'IP est prise comme le fait déjà `admin-handler.js` : la valeur attestée par la
passerelle, sinon le bond **le plus à droite** de `X-Forwarded-For`. Jamais le
jeton de gauche, qui est écrit par le client et permettrait de forger l'origine
de chaque accès à un dossier.

### 2. Les connexions laissent une trace, sans jamais entreposer un jeton

Sept actions nouvelles : `notaire_lien_demande`, `notaire_connexion`,
`notaire_connexion_refusee`, `partenaire_reclamation`, `partenaire_confirme`,
`client_jeton_emis` — et, sur les refus, une **raison** nommée
(`jeton_invalide`, `lien_deja_utilise`, `compte_inactif`).

**Aucun jeton en clair n'entre dans le journal.** Une trace de sécurité qui
contient des identifiants est elle-même une faille. Ce qui est consigné est une
**empreinte** : SHA-256, tronquée à 16 caractères hexadécimaux (64 bits),
préfixée de son algorithme (`sha256:…`). Elle ne sert qu'à une chose —
reconnaître que deux refus portent sur le *même* lien, donc distinguer un rejeu
d'un balayage — et 64 bits y suffisent largement tout en restant irréversibles.

Deux gardes de volume, parce qu'un journal qu'un attaquant peut faire grossir à
volonté est une arme retournée :

- sur les deux portes limitées en débit, **seul le franchissement du plafond**
  est journalisé, pas chaque requête bloquée qui suit ;
- `/notary/session/verify` n'est pas limitée : un balayage y produit autant de
  traces qu'il fait d'appels. C'est assumé — l'écriture d'audit coûte
  strictement moins que l'invocation Lambda qui la provoque, elle ne change donc
  pas l'économie d'un flot hostile, elle le rend visible.

### 3. Une écriture perdue crie, sans jamais bloquer l'argent

La règle est conservée : l'échec est avalé, la réponse part. Ce qui change, c'est
qu'il émet une ligne JSON structurée —
`{"level":"error","event":"audit_write_failed","action":…}` — qu'un filtre de
métrique CloudWatch compte sur les groupes de logs des deux Lambdas, et qu'une
alarme dit sur le sujet SNS d'alerte existant. **Le seuil est zéro** :
contrairement à une erreur passagère, une entrée d'audit qui n'est pas écrite ne
se rattrape jamais — il n'y a pas de reprise, l'événement est passé.

### 4. Un Deny explicite tient la promesse d'append-only

Sur les deux rôles, un statement `Deny` sur `DeleteItem`, `UpdateItem` et
`BatchWriteItem`, conditionné par `ForAnyValue:StringLike` sur
`dynamodb:LeadingKeys = AUDIT#*`. Deny l'emporte toujours sur Allow ; les Allow
existants restent intacts, et `PutItem` d'une entrée neuve reste permis — c'est
l'écriture du journal.

**Ce que la garantie vaut exactement, et rien de plus :**

- elle couvre les appels qui **nomment une clé de partition** ;
- elle ne couvre **pas** ce qui ne porte pas `dynamodb:LeadingKeys` : une
  condition `ForAnyValue` ne s'applique jamais quand la clé de contexte est
  absente. PartiQL, un `TransactWriteItems` non conditionné par la clé ou une
  opération de niveau table passent à côté — ce sont d'autres actions, non
  accordées ici ;
- elle ne lie que **ces deux rôles**. Un humain avec la console AWS, un
  administrateur du compte ou une restauration PITR peuvent toujours réécrire
  l'histoire.

L'immuabilité réelle demanderait un puits séparé (CloudTrail Lake, ou un bucket
S3 en Object Lock). Ce Deny ferme le chemin applicatif ; il ne rend pas la table
inviolable, et la console ne devrait pas prétendre le contraire.

### 5. Sept ans, en calendrier, dans le domaine

`AUDIT_RETENTION_YEARS = 7` et `auditRetentionTtl(atMs)` vivent dans
`packages/domain` — c'est une règle d'affaires, pas un détail d'adaptateur. Le
calcul est **calendaire** (sept fois « même jour, année suivante »), jamais un
compte de jours : `7 × 365` expirerait deux jours trop tôt à cause des années
bissextiles, et sur une borne de preuve, arrondir vers le bas est la seule
erreur qui coûte cher. Un horodatage illisible rend `null` : aucune expiration
vaut mieux qu'une expiration fausse, qui effacerait une preuve au hasard.

La borne est posée dans les **adaptateurs de dépôt**, pas dans le handler : deux
journaux existent (gestes d'administration dans la table admin, mouvements
d'argent et accès dans la table principale) avec deux appelants, et l'adaptateur
est le seul point que les deux traversent.

La liste de suppression (`UNSUB#`) **n'expire jamais**. Oublier un refus de
communication, c'est le violer.

## Conséquences

- Une entrée d'audit écrite avant le 3 septembre 2026 ne porte pas d'`acteur` et
  n'expirera jamais. Rien n'est rétroactif : on ne fabrique pas un acteur qu'on
  n'a pas observé.
- L'écran d'audit de la console montre désormais une IP sur les événements
  publics (l'enveloppe la double hors de l'acteur pour cela) ; il ne sait pas
  encore lire l'acteur lui-même.
- `GET /admin/audit` est gardé par **`audit:read`**, et non `pii:read` : lire le
  journal et lever l'anonymat d'un client sont deux capacités distinctes, et un
  auditeur dédié doit pouvoir obtenir la première sans la seconde. Le
  commentaire de la route et l'OpenAPI l'annonçaient encore mal ; c'est corrigé,
  et un test le prouve désormais côté serveur.
- **La console reste à aligner** : `apps/admin/public/admin.js` garde l'écran
  d'audit derrière `canReadPii()`. Tant que ce n'est pas fait, le moindre
  privilège est défait en pratique — un auditeur à qui on a accordé `audit:read`
  passe par l'API mais ne voit pas l'écran.
- La politique de conservation se contredit : son §1 nomme sept ans, son §2
  qualifie l'absence de `ttl` de « correct et voulu ». Le code suit le §1 (la
  Loi 25 exige une borne) ; le document doit être repris pour ne dire qu'une
  seule chose.
- `terraform apply` est requis pour que les deux `Deny`, le filtre de métrique
  et l'alarme existent réellement. Rien n'est appliqué à ce jour.
