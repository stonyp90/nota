# 0023 — L'annulation tardive d'un acte retenu coûte des frais, retenus sur la caution

Date : 2026-08-28
Statut : accepté

## Contexte

ADR 0015 a fait de l'annulation un geste gratuit : « unwinds a mise en relation
with no money in flight — the hold is simply released ». C'était vrai entre la
publication et la rétention. Depuis que le notaire bloque une plage d'agenda dès
la rétention, une annulation à la dernière minute lui coûte une journée de
travail invendable — et l'audit du 2026-08-27 a confirmé trois trous d'argent
autour de la même route :

1. **Aucuns frais d'annulation n'existent** alors que le modèle d'affaires les
   suppose : un client peut retenir un notaire pour demain et annuler ce soir,
   sans conséquence.
2. **La caution n'est jamais libérée quand l'offre annulée était retenue** — le
   garde `!wasRetained` de `handler.js` inversait le cas important : c'est
   précisément l'offre retenue qui porte une autorisation vivante (l'acceptation
   ne capture rien, ADR 0015), et elle restait bloquée ~7 jours sur la carte.
3. **Un acte déjà réglé pouvait encore être « annulé »** : le règlement n'écrit
   rien sur l'item BID (seul le registre ACT# en témoigne), la route d'annulation
   ne consultait pas ce registre, et l'argent déjà capturé et transféré n'était
   ni remboursé ni protégé.

## Décision

**1. Des frais d'annulation s'appliquent à l'offre RETENUE, selon la proximité
de la date de signature.** Annuler une offre encore ouverte reste gratuit — le
marché n'a rien promis à personne. Annuler une offre retenue retient une part du
montant convenu, par paliers de jours restants (le même axe que la
tarification : « les trois derniers jours forment une seule situation ») :

| Jours avant la signature | Taux retenu (défaut) |
| --- | --- |
| 0–3 jours (dernière minute) | 30 % |
| 4–14 jours | 10 % |
| 15 jours et plus | 0 % — gratuit |

**2. Le barème est un document d'exploitation, pas une constante de déploiement**
(le motif exact de l'ADR 0021) : `cancellation-config.js` est la seule autorité
sur sa forme (défauts intégrés, `NOTA_CANCELLATION_TIERS` en environnement,
validation du write door admin), l'item `CONFIG#ANNULATION / BAREME` porte
l'override édité depuis la console admin (`settings:write`, audité), et la route
d'annulation le résout à chaque appel — aucun déploiement pour changer la
politique. Un barème vide (`paliers: []`) rend l'annulation gratuite partout :
le kill-switch est une donnée, pas un flag.

**3. Le mécanisme d'encaissement est la capture partielle de la caution déjà
posée.** ADR 0015 a mis une autorisation `capture_method: 'manual'` du montant
total sur la carte du client à la publication ; le règlement la capture en
entier. Les frais d'annulation capturent **une partie** de cette même
autorisation (`amount_to_capture`, clé d'idempotence `cancelfee:<bidId>`) ;
Stripe libère le reste immédiatement. Aucun nouveau moyen de paiement, aucune
nouvelle collecte : le client a déjà consenti à ce montant. Les fonds restent
sur la plateforme (pas de transfert au notaire pour l'instant — dédommager le
notaire est une décision produit séparée). Si la capture échoue, l'autorisation
est libérée entière : le client ne paie rien plutôt que d'être bloqué.

**4. La route d'annulation devient honnête sur l'argent :**
- un acte dont le registre ACT# existe répond `409 acte_complete` — on
  n'« annule » pas un acte signé et réglé ;
- toute annulation qui n'encaisse pas de frais **libère la caution**, offre
  ouverte comme retenue (bug 2 réparé) ;
- l'offre annulée porte `annulation: { taux, frais, joursAvant, chargeId }` —
  la trace de ce qui a été retenu, exposée au client ;
- `GET /client/bid` expose `annulation` en **prévision** sur une offre retenue,
  pour que l'interface affiche les frais AVANT que le client confirme — la
  divulgation fait partie du mécanisme, pas de la documentation.

**5. Les frais ne se calculent que s'il y a une caution vivante à capturer**
(`paymentStatus: 'authorized'`). Sans facturation configurée (démo, E2E local)
ou sans caution, l'annulation reste gratuite : on ne facture jamais hors du
consentement Stripe déjà donné.

## Conséquences

- Le domaine reste sans concept de commission ni de pourcentage (ADR 0008,
  gardé par `deontologie.feature`) : le barème et son arithmétique vivent dans
  la couche API (`cancellation-config.js`), comme la commission.
- `jours restants` se mesure en jour civil du Québec (`domain.businessDay`),
  clampé à 0 : annuler une signature déjà passée mais jamais réglée compte
  comme dernière minute.
- La ré-annulation idempotente répond 200 avec l'annulation déjà enregistrée —
  jamais une seconde capture (la clé d'idempotence protège aussi côté Stripe).
- Décisions produit encore ouvertes, hors du périmètre : reverser une part des
  frais au notaire ; récupérer la récompense de parrainage d'une offre annulée
  (le registre EARN est write-once par conception, ADR 0011) ; rembourser un
  acte réglé (aujourd'hui : impossible d'annuler, point).

## Amendé par l'ADR 0033 (2026-09-02)

La décision 3 disait : « Les fonds restent sur la plateforme (pas de transfert
au notaire pour l'instant — dédommager le notaire est une décision produit
séparée). » Cette décision est prise : **les frais d'annulation dédommagent le
notaire dont la journée était réservée, et Nota n'en garde rien** (art. 32.1 de
la *Loi sur le notariat*, art. 32 du *Code de déontologie* — Nota ne conserve
jamais une part de ce qui revient au notaire).

- La capture partielle reste le mécanisme (clé `cancelfee:<bidId>`) ; elle est
  suivie d'un **virement entier** vers le compte Stripe connecté du notaire
  (`transfer_group: bid:<id>`, clé `cancelfee-transfer:<bidId>`, sans frais
  d'application) dès que celui-ci peut recevoir (`active`, `chargesEnabled`,
  `connectAccountId`).
- Quand il ne le peut pas — ou qu'un virement échoue après une capture réussie —
  la capture n'est jamais rejouée et le montant est inscrit **dû au notaire** :
  `notary.dedommagementCentsDue`, sur le modèle de la créance de l'ADR 0029.
- L'offre annulée porte `annulation.dedommagement = { notaire: true, verse,
  transferId }` ; l'audit `annulation_frais` porte `transferId` et `verse`.
- Le désistement du notaire reste gratuit, mais il est **compté à son dossier**
  (`releasesCount`) et l'opérateur en est **toujours** prévenu.
