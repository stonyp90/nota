# 0031 — Le prix de Nota est celui de Nota, pas une part des honoraires

Date : 2026-09-01

Statut : accepté — **révise l'ADR 0027 et retire la mécanique de rémunération
de l'ADR 0028** ; **précisé depuis par l'ADR 0034**

> **Lu après le 2026-09-03.** Tout ce que cet ADR pose tient toujours : les deux
> lignes, le notaire qui reçoit 100 % du montant offert, le prix qui ne dépend
> ni du notaire ni de sa cote ni de la valeur de l'acte. Une seule chose a
> changé : ce prix n'est plus **un** nombre. L'ADR 0034 en fait une **grille** —
> une ligne par service, plus la garantie de date sur sa propre ligne. Là où ce
> document dit « un montant fixe, identique pour tous », lisez « un prix publié
> d'avance, déterminé par le service et le délai, identique pour tous les
> notaires ».

> **Ce qui survit de l'ADR 0028.** La cote sur 100 et ses quatre axes, calculés
> par `domain.notaryScore`, restent intacts. Ils peuvent décider du classement
> dans le fil, de l'accès aux dossiers, d'un statut.
>
> **Ce qui est retiré.** La cote ne décide plus d'un dollar. Le partage
> 75/25 puis 85/95 disparaît : Nota ne prélève plus aucune part des honoraires
> du notaire.

## Contexte

Quatre textes, **vérifiés mot pour mot aux versions officielles**, condamnent
ensemble la mécanique des ADR 0027 et 0028.

**Art. 32.1 de la *Loi sur le notariat*** (2023, c. 23, a. 37, en vigueur le
24 octobre 2023) — est présumée usurper les fonctions de notaire toute personne
autre qu'un membre de l'Ordre, agissant comme intermédiaire, qui : 1° promet une
réduction des honoraires du notaire ; **2° obtient d'un notaire qu'il abandonne
une partie de ses honoraires** ; 3° procure des services professionnels **sans
aucune responsabilité de sa part envers le notaire pour ses honoraires**.

**Art. 32 du *Code de déontologie des notaires*** — le notaire ne peut partager
ses honoraires avec une personne qui n'est pas membre d'un ordre professionnel
régi par le *Code des professions*. Deux interdictions distinctes frappent donc
la même opération : l'art. 32.1 vise Nota, l'art. 32 vise le notaire. **Corriger
l'une sans l'autre ne règle rien.**

**Art. 29.1 du *Code de déontologie*** — « Le notaire ne peut conclure aucune
convention ayant pour effet de mettre en péril l'indépendance, le
désintéressement, l'objectivité et l'intégrité requis pour l'exercice de la
profession de notaire. » C'est l'article décisif, et celui que le dossier avait
manqué jusqu'au 1<sup>er</sup> septembre : **un revenu du notaire indexé sur une
note attribuée par une entreprise privée est exactement une telle convention.**
L'art. 26 2° ajoute que le notaire doit cesser d'agir « lorsque son indépendance
professionnelle pourrait être mise en doute ».

**Art. 33 du *Code de déontologie*** — le notaire ne peut, hors sa rémunération,
« verser ou recevoir tout autre avantage relatif à l'exercice de sa profession ».
Un abonnement offert, une place privilégiée dans le fil ou un flux de dossiers
donné en échange d'une exclusivité sont des avantages. Tout ce que Nota fournit
à un notaire doit être facturé à sa valeur.

## Décision

**Nota cesse de prélever une part des honoraires et vend son propre service à
son propre prix.** Une offre porte désormais deux lignes distinctes :

| Ligne | Qui l'encaisse | Ce qui la détermine |
| --- | --- | --- |
| `honorairesCents` | **Le notaire, en entier** | Le montant offert par le client |
| `prixNotaCents` | Nota | Un **montant fixe**, identique pour tous |

`totalCents = honorairesCents + prixNotaCents` — c'est ce que la carte du client
autorise, et c'est ce que la capture prélève. Les frais d'application Stripe
**sont** le prix de Nota ; le net viré au notaire est exactement le montant qui
lui a été offert.

**Le prix de Nota ne dépend de rien qui touche au notaire** : ni de sa cote, ni
de son historique, ni de la valeur de l'acte. C'est la conséquence directe de
l'art. 29.1, et c'est un invariant testé.

## Pourquoi cette forme sort des murs

- **Art. 32.1 1°** — aucune réduction d'honoraires n'est promise à personne.
  Nota vend la date, jamais un notaire moins cher. Ce positionnement est
  désormais une **défense**, pas seulement une stratégie : il ne doit jamais
  être abandonné en marketing.
- **Art. 32.1 2°** — le notaire n'abandonne rien : il reçoit 100 % du montant
  offert, par construction.
- **Art. 32.1 3°** — Nota autorise, capture et garantit le net du notaire. La
  responsabilité envers le notaire pour ses honoraires est **assumée**, et la
  branche s'exclut par sa propre rédaction.
- **Art. 32 C.déont.** — il n'y a plus d'honoraires partagés à partager.
- **Art. 29.1 C.déont.** — le revenu du notaire ne dépend plus d'une note
  attribuée par Nota.

## Conséquences

**Ce qui change dans le code.**

- Nouveau `apps/api/src/prix-nota-config.js` : `DEFAULT_PRIX_CENTS` (40 000 ¢ =
  400 $), `envDefaults` (`NOTA_PRIX_CENTS`), `validatePrix`. Un entier de cents,
  pas un taux.
- `billing.js` : `quoteOffer(actAmount)` retourne les trois nombres ;
  `priceAct` s'y réduit ; les deux chemins de règlement — capture (ADR 0015) et
  créance hors plateforme (ADR 0029) — divulguent `prixNotaCents` et
  `honorairesCents` dans le registre write-once.
- `handler.js` : l'autorisation de la carte porte `devis.totalCents`. Autoriser
  les seuls honoraires sous-facturerait le client à la capture.
- Tests : `apps/api/test/prix-nota-separe.test.mjs`, dont l'invariant art. 29.1
  — deux notaires aux antipodes de la cote paient le même prix.

**Ce qui reste à faire, et qui n'est pas fait.**

1. **23 tests de l'API encodent encore le modèle en pourcentage** et échouent.
   Ce ne sont pas des régressions : ils décrivent un contrat que cet ADR
   remplace. Ils doivent être réécrits, pas rustinés.
2. **Les surfaces client et notaire montrent encore une part et un taux.** Le
   client doit voir deux lignes avant d'offrir ; la console notaire doit montrer
   ses honoraires entiers et le prix de Nota à côté, jamais un pourcentage.
3. **`commissionCents` survit comme alias** dans le registre, les statistiques
   et l'admin. Le montant est juste, le nom est hérité et trompeur — à renommer.
4. **La console admin édite encore un barème de taux.** Elle doit éditer un
   prix.
5. **L'abonnement, s'il arrive un jour, doit être facturé à sa valeur** — jamais
   offert, jamais échangé contre une exclusivité (art. 33).

## Ce que cet ADR ne règle pas

Il ne rend pas Nota conforme. Il retire la mécanique que quatre textes visent
directement, ce qui est nécessaire mais pas suffisant. **L'avis juridique écrit
demeure requis** (`docs/legal/README.md`), et trois questions lui restent
posées :

1. Le modèle à deux prix échappe-t-il vraiment à l'art. 32.1 2° et à l'art. 32,
   ou un syndic peut-il requalifier le prix de Nota en partage déguisé ?
2. La garantie du paiement des honoraires fait-elle tomber l'art. 32.1 3° ?
3. Une cote qui décide du classement mais pas de la rémunération survit-elle à
   l'art. 29.1 ?

## Alternatives écartées

- **Ajuster le pourcentage à la baisse.** N'aurait rien changé : c'est la
  nature du prélèvement qui est visée, pas son ampleur.
- **Un notaire actionnaire de Nota.** N'éteint pas la présomption, qui vise la
  conduite de l'intermédiaire et non son actionnariat — et exposerait
  personnellement ce notaire à l'art. 32. Le règlement N-3, r. 7 exigerait par
  ailleurs que la majorité des voix appartienne à des membres d'ordres :
  le contrôle serait perdu sans qu'aucun mur ne tombe.
- **Attendre l'avis avant de changer quoi que ce soit.** Écarté : la
  restructuration ne dépend d'aucun tiers, et elle est infiniment moins chère
  maintenant qu'après une plainte au syndic.
