# 52. Le notaire paie, ou il enseigne

- Status: Accepted
- Date: 2026-09-12
- Supersedes nothing; precise ADR 0047 (apprentissage) et ADR 0049 (monétisation)

## Le contexte

Le propriétaire, le 12 septembre 2026 : ce qu'un notaire doit comprendre en
arrivant sur Nota tient en cinq phrases, et aucune n'était dite au complet sur
la page qui lui est destinée.

1. Il branche les demandes sur **son** agenda — Outlook, Google, Apple — en un
   geste, sans rien installer.
2. Ce qu'il branche **comble les trous** de sa semaine : des dates précises que
   des clients ont déjà fixées.
3. Il **gagne davantage** sur ces dates, parce que c'est un marché d'urgence :
   le délai court est la seule chose que le client ne peut pas déplacer, et
   l'art. 49 4° du *Code de déontologie* reconnaît le degré d'urgence comme un
   facteur des honoraires.
4. Pour les actes simples du catalogue, **toute l'information est déjà là**
   quand il ouvre la demande : montant, date, prêteur, déplacement, secteur.
5. **L'IA propriétaire de Nota lui prépare le dossier** — et il décide seul.

Et une règle de monétisation nouvelle, qui décide comment cette IA se paie.

## La décision

### A. Les cinq promesses sont dites sur la page des notaires

Elles sont un bloc, pas une phrase noyée dans le film ni une note de bas de
page. Chaque promesse renvoie à la preuve qui est déjà sur la page : la carte
d'abonnement à l'agenda, l'inventaire ouvert, l'échelle des délais, la fiche
d'une demande, la console.

Le chiffre de la promesse 3 n'est **jamais** écrit à la main. Il vient de
`tierMultiplier()` — le même multiple que le carnet pré-remplit et que la
légende affiche. Changer l'échelle des délais change la promesse, sans qu'une
seconde formule ait à être retrouvée.

### B. Le notaire paie, ou il enseigne

La préparation assistée a deux voies, et une seule différence entre elles :

| Voie | Ce que le notaire donne | Ce qu'il paie |
| --- | --- | --- |
| Payante (abonnement ou unités) | rien | le prix d'ADR 0049 |
| Gratuite (essais bêta) | ses **révisions** | rien |

« Ses révisions » a un sens précis et borné : ce que le notaire pense de ce que
Nota lui a proposé. Un champ accepté, un champ corrigé, une question escaladée,
une proposition rejetée. C'est-à-dire exactement les deux natures d'événement
que l'ADR 0047 nomme déjà `notary_review` et `notary_question`, et que
`apps/api/src/notary-learning.js` écrit **sans valeur de dossier** : les textes
sont hachés en mémoire, jamais consignés.

Ce que la voie gratuite ne donne **jamais**, et qu'aucun consentement de notaire
ne pourrait donner :

- un document du client, ou une page d'un document ;
- une valeur de dossier, un nom, une adresse, un montant nominatif ;
- un renseignement personnel au sens de la Loi 25.

La raison n'est pas le confort : le secret professionnel de l'art. 14 du *Code
de déontologie des notaires* appartient au client, pas au notaire. Le notaire ne
peut pas le lever pour entraîner un modèle. Ce qu'il peut donner, c'est **son
propre jugement professionnel sur le travail de Nota** — et c'est aussi le seul
signal qui vaille quelque chose pour l'apprentissage.

### C. Le refus ne coûte rien

Un notaire qui ne veut ni payer ni contribuer garde **tout le marché** : les
demandes, l'agenda, la console, les versements. Il perd seulement la
préparation assistée, qui n'a jamais fait partie de la place de marché
gratuite.

Cette condition n'est pas de la politesse. Un consentement obtenu en retirant
quelque chose que la personne avait déjà n'est pas *libre* au sens de l'art. 14
de la Loi 25. En gardant la place de marché entière des deux côtés du choix,
la contrepartie porte sur un produit distinct que le notaire n'avait pas —
c'est ce qui la tient debout.

## L'implémentation

- `packages/domain` : `notaryAIContribution(entitlement)` rend le mode
  (`requise` / `facultative`), ce qui est donné, ce qui ne l'est jamais, et la
  sortie. Fonction pure, sans I/O — le domaine ne connaît ni Stripe ni le dépôt.
- `apps/api/src/ai-access.js` : le consentement est un état du notaire
  (`contribution.consentiLe` / `refuseLe`). `consume()` refuse
  `contribution_requise` quand la voie est gratuite et que le consentement
  manque. Une entitlement payée rend le mode facultatif, quelle que soit la
  réserve qui sert l'analyse — un notaire abonné ne contribue jamais par
  accident.
- `POST /notary/ai-contribution` enregistre ou retire le consentement. Le
  retrait est immédiat et n'efface pas ce qui a déjà été appris : les journaux
  d'apprentissage sont écrits une fois, et l'ADR 0047 fait entrer toute
  contribution dans une quarantaine avant toute utilisation.

## Les conséquences

- Un notaire bêta doit consentir avant sa première analyse. L'écran le dit dans
  les mots de la table ci-dessus, pas en légalese.
- Le taux de consentement de la voie gratuite devient une mesure du produit :
  s'il est bas, l'échange est mal expliqué ou mal proportionné.
- `NOTA_AI_MONETIZATION_ENABLED=false` laisse tout ouvert, comme avant : en
  local et en test, la règle ne s'arme pas.
