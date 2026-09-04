# 0035 — La caution tient jusqu'à la signature

Date : 2026-09-03

Statut : accepté — **amende l'ADR 0015 (§2 et ses conséquences) et l'ADR 0023
(§3, le mécanisme d'encaissement) ; ne touche ni au partage de l'ADR 0031, ni
au bénéficiaire des frais fixé par l'ADR 0033**

## Contexte — le défaut, mesuré

L'ADR 0015 a fait du règlement un geste de la signature : le client autorise sa
carte à la **publication**, et la capture attend l'acte. Cette autorisation
était le seul mécanisme de garantie du modèle.

Or une autorisation de carte Stripe expire en **~7 jours**. Le carnet, lui,
vend surtout des dates lointaines : le palier `rapide` s'arrête à 14 jours, donc
le palier « standard » — celui qui n'a aucune prime d'urgence, et de loin le
plus fréquent — **commence à 15 jours**. Sur la majorité des dates publiées,
l'autorisation mourait donc avant la signature.

Ce que cela donnait concrètement :

1. **L'offre se vidait de sa garantie sans que personne ne soit prévenu.** Rien,
   ni dans le produit ni dans un courriel, ne disait au client ni au notaire que
   la caution avait expiré.
2. **Le règlement retombait sur le repli.** `/notary/acts/complete` constatait
   la capture impossible et basculait sur `completeAct`, c'est-à-dire — depuis
   l'ADR 0029 — l'inscription d'une **créance** que personne ne sait encore
   recouvrer. Le notaire, lui, avait déjà bloqué sa journée.
3. **Le barème d'annulation était partiellement fictif.** L'ADR 0023 prélève les
   frais par capture partielle de la caution. Le palier 4-14 jours suppose donc
   une caution vivante… posée le plus souvent plus de 7 jours plus tôt. Elle ne
   l'était pas.

L'ADR 0015 avait vu le trou et l'avait laissé ouvert : « A future
saved-payment-method (off-session) charge can tighten this without changing the
routes. » C'est cette décision-là.

## Décision

### 1. Deux gestes séparés : enregistrer la carte, puis poser la caution

À la **publication**, Nota n'autorise plus rien : elle **enregistre** la carte.
Une session Stripe Checkout en mode `setup` (`createOfferSetup`) fait valider la
carte par la banque du client et la conserve sur un client Stripe. Aucune somme
n'est réservée, donc rien ne peut pourrir.

À **J-`CAUTION_LEAD_DAYS`**, la caution est posée hors session sur cette carte
(`placeOfferAuthorization` : `capture_method: 'manual'`, `confirm: true`,
`off_session: true`), pour le **total des deux lignes** de l'ADR 0031 — les
honoraires du notaire et le prix du service de Nota. La capture à la signature
ne change pas d'un iota.

`CAUTION_LEAD_DAYS` **vaut 2 et vit dans `packages/domain`**, avec
`cautionDue(dateISO, todayISO)`. Ce n'est pas un détail d'implémentation : c'est
le nombre qui décide si la garantie d'un acte existe. Deux jours, parce qu'il
faut être assez tard pour que l'autorisation (~7 jours) atteigne la signature,
et assez tôt pour qu'une carte refusée laisse le temps de réagir.

**Quand la date est DÉJÀ dans la fenêtre**, rien de tout cela n'est nécessaire :
la publication ouvre la session de paiement d'origine et la caution est posée
immédiatement — elle vivra jusqu'à l'acte. `billing.authorizeOffer` tranche
seule entre les deux portes, en interrogeant le domaine ; la route de
publication ne connaît pas cette mécanique.

### 2. Le geste quotidien est celui de la Lambda de rappels

`apps/api/src/reminders.js` porte désormais, en plus des rappels, une passe
« caution » : pour chaque offre vivante dont la date entre dans la fenêtre, elle
appelle `billing.placeCaution`. Trois exigences la gouvernent :

- elle lit `listByMonth`, **pas** `listOpenBids` — celui-ci exclut les actes
  RETENUS, et c'est précisément là que la caution compte le plus ;
- **elle ne lève jamais** parce qu'une carte est refusée. Un refus se compte
  (`caution: { due, posee, refusee }`), s'inscrit sur l'offre et se raconte ; il
  n'interrompt pas le lot ;
- le port de facturation lui est **optionnel** : sans clés Stripe (démo, tests,
  E2E), la passe est sautée et la Lambda reste ce qu'elle était.

La clé d'idempotence Stripe porte le jour (`hold:<bidId>:<jour>`) : deux
exécutions le même jour sont une seule tentative, la reprise du lendemain après
un refus en est une vraie.

### 3. Ce qui garantit le paiement du notaire

C'est la question que cet ADR doit trancher explicitement, parce qu'un notaire
qui retient bloque une journée qu'il ne revendra pas. Trois faits, et rien
d'autre :

1. **Aucune offre n'est visible sans carte validée.** Une offre publiée reste
   `pending` — invisible au carnet, invisible au fil du notaire — tant que le
   client n'a pas terminé la session Stripe. Le SetupIntent est une vraie
   demande d'autorisation à l'émetteur : la carte du client a été acceptée par
   sa banque avant que le notaire ne la voie. C'est **plus** que ce que
   garantissait l'ancien modèle au moment de la signature, où l'autorisation
   était déjà morte.
2. **La caution est vivante à la signature.** Posée deux jours avant, elle a
   ~7 jours devant elle. `/notary/acts/complete` capture donc réellement, et le
   virement des honoraires part.
3. **Un refus se sait deux jours d'avance.** Le notaire reçoit
   `cautionRefuseeNotaire`, le client `cautionRefusee` (une seule fois chacun,
   registre `SENT#`), la tentative est reprise chaque jour jusqu'à la date, et
   **l'acte reste confié au notaire** : il décide, en connaissance de cause, de
   le porter ou de se désister (gratuit, ADR 0033). Le repli du règlement — la
   créance de l'ADR 0029 — subsiste, mais il cesse d'être le cas ordinaire pour
   redevenir l'exception qu'il aurait toujours dû être.

Cela se dit aussi **dans le produit** : `GET /notary/bids` porte
`conditions.caution = { jours, carteValidee }` et, par acte,
`caution = { etat, poseeLe }` avec `etat` ∈ `posee` / `enregistree` / `refusee` /
`aucune`. Une garantie qu'on ne peut pas voir n'en est pas une (ADR 0033 §4 :
tout est exposé au notaire avant qu'il confirme).

### 4. Les frais d'annulation restent prélevés, et restent au notaire

L'ADR 0023 §3 disait : « Le mécanisme d'encaissement est la capture partielle de
la caution déjà posée. » Il y a désormais **deux** mécanismes, et le choix se
fait sur un seul critère — existe-t-il une caution vivante ?

| Situation | Mécanisme | Clé d'idempotence |
| --- | --- | --- |
| Caution posée (date proche) | capture partielle, le reste libéré par Stripe | `cancelfee:<bidId>` |
| Carte enregistrée seulement | prélèvement hors session sur cette carte | `cancelfee:<bidId>` |

La même clé pour les deux : une offre est facturée ses frais une fois, par l'un
**ou** l'autre, jamais par les deux. Le reste est identique et n'a pas bougé :
le montant est **viré entier au notaire** dès qu'il peut recevoir, inscrit
`dedommagementCentsDue` sinon, et Nota n'en garde rien (art. 32.1 2° de la *Loi
sur le notariat*, art. 32 du *Code de déontologie* — ADR 0033 §5).

Sans cette seconde porte, le palier 4-14 jours du barème serait devenu gratuit
en silence : le genre de trou qu'un ADR est censé fermer, pas ouvrir.

## Ce qui change

**Pour le client.** Il donne sa carte comme avant, mais rien n'est réservé le
jour de la publication : le courriel qu'il reçoit le dit (`carteEnregistree`
remplace `offerAuthorized` sur ce chemin — annoncer un « paiement autorisé »
qui n'existe pas serait un mensonge sur de l'argent, et l'art. 68 du *Code de
déontologie* interdit la publicité incomplète). Le devis affiche « Porté à votre
carte » plutôt que « Autorisé sur votre carte ». Si sa banque refuse à J-2, il
est prévenu et peut enregistrer une autre carte.

**Pour le notaire.** La garantie qu'il croyait avoir existe maintenant, et il la
voit avant de retenir. En échange, il apprend un refus deux jours avant la
signature plutôt que de le découvrir le jour de la capture.

**Pour l'opérateur.** Le lot quotidien devient un geste d'argent : son journal
porte `caution: { due, posee, refusee }`, et un `refusee` non nul est un signal
à regarder. Les gabarits `carteEnregistree`, `cautionRefusee` et
`cautionRefuseeNotaire` sont **transactionnels** : la console admin peut en
changer le sujet, jamais les éteindre (art. 68, ADR 0018).

## Ce qui reste à faire côté Stripe en production

1. **Activer les paiements hors session sur le compte Stripe.** Rien de
   spécifique à cocher côté API, mais les cartes enregistrées via Checkout
   `setup` doivent porter un mandat utilisable hors session — c'est le
   comportement par défaut de `mode: 'setup'`, à vérifier une fois sur le compte
   réel avec une carte de test qui exige une authentification.
2. **Écouter `setup_intent.succeeded` dans le point de terminaison de webhook.**
   L'événement n'y est probablement pas encore abonné : sans lui, la carte n'est
   jamais liée à l'offre et **aucune caution ne peut être posée**. C'est le seul
   réglage qui casse tout s'il est oublié. `checkout.session.completed` reste
   nécessaire (il porte le client Stripe).
3. **Poser `STRIPE_SECRET_KEY` (et `STRIPE_WEBHOOK_SECRET`) sur la Lambda de
   rappels.** `infra/notifications.tf` les passe désormais ; il faut un
   `terraform apply`. Sans la clé, la Lambda tourne mais ne pose aucune caution.
4. **Surveiller les refus hors session** (`payment_intent.payment_failed` avec
   `off_session`) : le produit les traite, mais l'opérateur n'a pas encore de
   tableau qui les compte. À suivre avec le recouvrement des créances de
   l'ADR 0029, qui reste ouvert.
5. **Décisions non prises, hors périmètre :** proposer au client de changer sa
   carte depuis son espace (aujourd'hui il republie ou écrit au soutien) ;
   avancer la fenêtre pour les actes de très forte valeur ; et le sort d'une
   offre restée `enregistre` dont la date est passée sans que la caution ait pu
   être posée — elle n'est plus retentée, et le règlement retombe sur la créance.
