# 0029 — Un règlement hors plateforme est une créance, jamais un encaissement

Date : 2026-09-01

Statut : accepté

## Contexte

L'ADR 0015 a fait payer l'acte **à la signature** : la caution posée à la
publication est capturée quand le notaire marque l'acte complété, Nota garde sa
part, le notaire reçoit le net. Le même ADR a prévu un **repli** : quand aucune
caution n'est capturable — la cliente n'a jamais complété le paiement, ou
l'autorisation a expiré au-delà de la fenêtre Stripe d'environ sept jours — la
route `/notary/acts/complete` bascule sur `billing.completeAct()`, décrit
comme « l'acte se règle quand même sur le modèle de commission : le client a
payé le notaire directement à la signature ».

Ce repli ne réglait rien. `completeAct` appelait
`stripe.chargeActCommission()`, qui créait un `PaymentIntent` **sans moyen de
paiement et sans `confirm`** : l'objet naissait en `requires_payment_method`,
aucun dollar ne bougeait, et rien ne le confirmait ensuite. Pourtant la suite
du code se comportait comme si le paiement avait eu lieu — le registre
write-once `ACT#` était écrit, `commissionCentsCollected` était incrémenté sur
le profil du notaire, la route répondait `ok`, et le notaire recevait le
courriel « votre acte est payé ».

Le trou a été trouvé le 2026-09-01 par l'audit de conformité
(`docs/compliance/piste-audit-transactions.md`), en préparation d'un audit
SOC 2. Un registre comptable qui **affirme un encaissement que personne n'a
fait** est pire qu'une facture impayée : il rend le trou invisible, et il le
rend invisible dans la seule pièce qu'un auditeur ira lire.

## Décision

**Le chemin de repli ne touche plus Stripe du tout.** Il n'y a rien à
encaisser — ni client, ni moyen de paiement, ni autorisation — et une fonction
qui ne peut pas déplacer d'argent ne doit pas ressembler à une fonction qui en
déplace.

Ce que le repli fait désormais :

1. **Il enregistre l'acte.** Le registre `ACT#` est écrit une fois, comme
   avant, avec le montant, le taux appliqué, la cote qui l'a mérité (ADR 0028)
   et le service — plus deux champs qui disent la vérité : `paye: false` et
   `commissionCentsDue`.
2. **Il inscrit une créance, pas une recette.** Le profil du notaire porte
   maintenant `commissionCentsDue`, distinct de `commissionCentsCollected`.
   Les deux ne se confondent jamais : *perçu* veut dire que Nota a l'argent.
3. **Il ne ment à personne.** Le courriel « acte payé » n'est envoyé que
   lorsqu'un virement a réellement eu lieu (`onActPaid({ paye })`) ; l'alerte
   à l'opérateur et l'invitation à évaluer, elles, partent toujours — l'acte,
   lui, a bien été signé.
4. **Il se voit.** `GET /notary/acts` porte `paye` et `du` par ligne et un
   total `du` ; `GET /admin/notaries` porte `commissionDue` par notaire.

La notoriété du notaire (`actsCompleted`, `actsByService`) continue d'être
incrémentée : l'acte a réellement été porté, et la cote mesure le travail, pas
le mode de paiement.

## Conséquences

**Ce qui est vrai maintenant.** Aucun chiffre du registre n'affirme un
mouvement d'argent qui n'a pas eu lieu. La somme des `commissionCentsCollected`
est rapprochable des versements Stripe ; la somme des `commissionCentsDue` est
un poste de créances, visible dans la console admin.

**Ce qui reste ouvert, et qui est le vrai trou.** *Rien dans le produit ne
permet encore de recouvrer cette créance.* Nota constate ce qui lui est dû et
n'a aucun moyen de le facturer : ni facture, ni prélèvement sur le compte
connecté, ni relance. C'est une décision d'affaires à prendre — facturer le
notaire, compenser sur l'acte suivant, ou renoncer — et elle n'est pas prise
ici. Ce qui est décidé ici, c'est de ne plus la cacher.

**Un effet de bord heureux, à consigner.** En retirant ce chemin, on a retiré
le seul endroit du code où l'argent partait du compte connecté du notaire avec
Nota en frais d'application. Le chemin réel — `captureAndTransfer` — fait
l'inverse depuis l'ADR 0015 : le client paie la plateforme, Nota garde sa part
et vire le net. L'ADR 0027 et l'ADR 0028 affirmaient le contraire dans leur
section « ce qui reste ouvert » ; les deux ont été corrigés le même jour. La
**qualification juridique** du modèle, elle, reste ouverte, et l'avis écrit
budgété reste requis.

## Alternatives écartées

- **Confirmer le `PaymentIntent` avec un moyen de paiement du notaire.**
  Écarté : aucun moyen de paiement du notaire n'est collecté aujourd'hui, et en
  collecter un est précisément la décision d'affaires laissée ouverte.
- **Débiter le solde du compte connecté du notaire.** Écarté pour l'instant :
  le solde peut être vide, l'opération a ses propres règles Stripe, et elle
  mérite d'être conçue avec l'avis déontologique plutôt que bricolée dans un
  chemin de repli.
- **Renoncer silencieusement à la part de Nota sur ce chemin.** Écarté : c'est
  peut-être la bonne politique commerciale, mais elle doit être choisie, pas
  subie par un effet de bord — et un abandon de créance se comptabilise.
