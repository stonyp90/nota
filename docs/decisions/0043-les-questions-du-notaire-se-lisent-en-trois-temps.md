# 0043 — La feuille se lit en cartes : trois temps par écran, et chaque réponse dit ce qu'elle change

Date : 2026-09-05

Statut : accepté

## Contexte

Retour du propriétaire, capture à l'appui : « améliore l'expérience du
formulaire, on peut grouper en sections et rendre ça le plus intuitif possible
pour chaque cas ».

L'écran 2 de la feuille (ADR 0040) alignait les dix questions de l'acte sur une
grille plate à deux colonnes. Trois défauts se lisaient sur la capture :

1. **Rien ne disait ce qui reliait les questions.** « Montant du nouveau prêt »,
   « Approbation bancaire », « La propriété fait-elle partie d'une succession ? »
   et « Déplacement pour la signature » se suivaient sans transition : quatre
   sujets différents, une seule colonne, aucune respiration.
2. **Les précisions facultatives tombaient dans un tiroir anonyme.** Un seul
   « Affiner (facultatif) » en bas d'écran cachait quatre questions qui
   n'avaient rien en commun — la résidence familiale, le co-emprunteur,
   l'assurance, le certificat de localisation — loin, chacune, du cas qu'elle
   précise, et sans dire combien il y en avait.
3. **Une réponse ne montrait qu'un prix.** « Oui » à la succession ajoute
   silencieusement un document à la liste (le testament et la déclaration de
   transmission) ; le client ne l'apprenait qu'au dossier, plus tard.

## Décision

**Le regroupement est une donnée du domaine.** `CRITERIA_GROUPS` déclare les
sections — leur identifiant, leur intitulé et leur raison d'être en une ligne —
et chaque critère porte son `groupe`. `criteriaGroups(acte)` rend les sections
dans l'ordre du catalogue et les questions dans l'ordre de l'acte, en séparant
`requis` et `facultatifs`. Aucun adaptateur ne réécrit cette liste : la feuille
de réservation et le carnet du dossier appellent la même fonction de rendu, si
bien qu'ils ne peuvent pas poser les questions dans deux ordres différents.

**Trois temps** : *Votre prêt* (le montant, l'approbation, le prêteur), puis
*L'immeuble* (la succession, et les titres derrière elle), puis *La signature*
(le déplacement) — la seule décision qui dépend des deux autres. Chaque section
porte au moins une question obligatoire ; une section qui n'ouvrirait qu'un
tiroir facultatif ne serait qu'un titre.

**Chaque section replie SES propres précisions.** « Préciser (facultatif) » vit
désormais à côté du cas qu'il précise, et le volet dit combien de questions il
cache. Le chemin court ne s'allonge pas : ce qui était replié le reste.

**Chaque section dit où elle en est.** Un chiffre à l'œil (le compte des
réponses attendues, ou « ✓ »), la phrase entière à l'oreille (`aria-label`,
traduit comme n'importe quel attribut). L'étape garde sa phrase ; la section ne
la répète pas à l'écran.

**Une réponse dit ce qu'elle change à la liste des documents.** `documentEffect`
mesure la différence contre l'ABSENCE de réponse : un document exigé de toute
façon n'est la conséquence de rien, un document collecté par défaut ne s'ajoute
pas — il se retire. L'écran l'imprime sous la réponse (« Ajoute un document :
Testament et déclaration de transmission », « Retire un document : Certificat de
localisation »), en deux nœuds — le cadre et le nom du document sont deux
entrées du dictionnaire, donc un changement de langue en vol traduit les deux.
La ligne est réservée dès la première peinture et masquée par `visibility`
(registre ADR 0039) : répondre, se raviser, répondre à nouveau ne déplace jamais
la question suivante.

## Le même registre sur l'écran du prix

Trois retours du propriétaire le même soir, sur des captures : « mieux découpler
les sections, ajouter des petites marges », « improve price section as well »,
« avoid blank space ».

**Une section est une CARTE.** Un simple filet à gauche ne découpait rien : le
titre d'une section venait coller à la dernière réponse de la précédente. Cadre,
coin carré, en-tête séparé par un filet, 12 px entre les cartes. Le fond reste
celui du dialogue — les contrôles à l'intérieur portent déjà `--surface-inset`,
et remplir la carte de la même teinte les effacerait.

**Une carte est le SEUL cadre.** Les écrans qui portent des sections (2 et 3)
rendent le leur : deux boîtes emboîtées mangeaient 30 px de largeur de chaque
côté et donnaient trois niveaux de bordure. Le titre de l'écran coiffe les
cartes. De même, le marché et le devis, qui portaient chacun leur propre cadre
et leur propre fond, se fondent dans la carte qui les accueille.

**L'écran 3 se lit lui aussi en trois temps** — *Le montant* (le palier, le
chiffre, le curseur, la jauge), *Le marché ce jour-là* (la référence, les offres,
ce que le délai y change), *Votre devis* (les lignes, le total, la revendication,
les petits caractères) — au lieu de dix blocs à la file dans une seule colonne.

**Le vide se ferme.** Une question seule sur son rang PREND le rang (`:last-child:nth-child(odd)`)
et l'occupe — contrôle à gauche, aide à droite — plutôt que de laisser une
demi-carte nue ; un contrôle de 320 px suivi d'un demi-cadre vide était le
défaut le plus visible de la grille à deux colonnes.

**Deux hiérarchies redressées au passage** : la revendication « Le notaire garde
100 % de ses honoraires » n'avait AUCUNE règle CSS — elle héritait des 16 px du
formulaire et parlait donc plus fort que le total juste au-dessus ; et le libellé
du marché criait en capitales sur deux lignes alors que la carte porte désormais
son titre. Enfin, `bookGoTo` pose le focus sur le titre de l'écran (`tabindex -1`)
pour que le clavier reparte du haut : l'anneau de focus générique dessinait une
boîte verte autour de « Les questions du notaire » qui se lisait comme une
sélection coincée. Le focus reste posé, la bague part — le titre n'est pas un
contrôle et ne s'atteint jamais en tabulant.

## L'aide passe derrière le « i », et une réponse ressemble à un bouton

Dernier retour de la soirée, capture à l'appui : « our button and form is hard to
understand — keep it really straight forward, (i) for more information with info
on mouse hover etc, keep the same pattern, and ensure we are maximizing the
space ».

**Trois à cinq lignes de prose sous chaque question** doublaient la hauteur de
chaque carte : deux questions côte à côte ne tenaient plus dans un écran, et
l'œil devait traverser un paragraphe pour atteindre la réponse suivante. L'aide
ne disparaît pas — elle rejoint le panneau du MÊME composant que les notes de
situation (`infoTip`, ADR 0039) : survol, focus clavier ou clic, un seul panneau
ouvert à la fois. Le contrôle continue de la nommer en `aria-describedby` : un
nœud RÉFÉRENCÉ est lu par un lecteur d'écran même quand il n'est pas affiché,
donc la description ne se perd pas en chemin. Le « i » se range CONTRE le
libellé, avant la ligne réservée du message d'attente — posé après elle, il
tombait sur une ligne à lui, entre la question et sa réponse.

**Le message d'attente cesse de coûter une ligne par question.** « Réponse
requise » réclamait toute la largeur (`flex: 1 0 100%`) parce que le libellé et
le message ne tenaient pas ensemble à côté d'une aide. L'aide partie, il se range
contre le libellé et ne bascule que s'il n'y tient pas — réservé dans les deux
cas, donc toujours sans saut (ADR 0039).

**Une réponse est un bouton.** Sur la piste segmentée commune, une option non
choisie n'avait ni fond ni cadre : trois libellés posés sur une barre, dont on ne
devinait ni qu'ils étaient cliquables, ni lequel était pris — la réponse retenue
ne se distinguait que par un gris à peine plus clair. Dans une question, la piste
s'efface, chaque option porte son cadre et sa surface, le survol la lève, et la
réponse retenue est peinte à la marque (`--brand-tint-solid-strong` + cadre
`--brand`). Le défaut non touché garde son trait pointillé : une suggestion, pas
une déclaration (§1.5).

**Et le « i » dit son ton avant qu'on lise le panneau** : « i » pour un
renseignement, « ! » pour une situation qui demande attention — deux tips
voisins (l'aide d'une question et sa note de situation) ne se distinguaient
jusque-là que par la couleur.

## Conséquences

- La grille de lecture a descendu d'un cran : l'étape est une pile de sections,
  et c'est DANS une section que les questions s'alignent deux par ligne
  (l'invariant d'audit 2.15 — l'ordre de lecture est l'ordre du DOM, jamais du
  multicol — tient toujours, sur `.crit-sec-grid`).
- Ajouter une question ne demande qu'un `groupe` de plus dans le domaine ; ajouter
  une section demande une entrée de catalogue et sa traduction, que la couverture
  i18n exige désormais (`CRITERIA_GROUPS` est scanné comme `SERVICES`).
- La conséquence documentaire ne s'affiche que pour les questions qui en ont une
  (succession, contexte d'achat, assurance, certificat) : l'écran ne lit pas les
  prédicats des documents, il demande au domaine si une réponse déplace la liste.
- Le carnet du dossier hérite des sections sans code propre.

## Tests

- `packages/domain/test/criteres-groupes.test.mjs` — le catalogue, l'absence
  d'orphelin, l'ordre, le partage requis/facultatif, et la conséquence
  documentaire mesurée contre l'absence de réponse.
- `apps/web/test/booking-form-sections.test.mjs` — les sections rendues, la
  question dans sa section, le tiroir par section et son compte, la porte
  « Répondez à : … » qui l'ouvre encore, le compte de section, la ligne de
  conséquence, le dossier qui rend les mêmes sections, puis (§7) les trois cartes
  de l'écran du prix, le cadre unique, le rang plein et les deux hiérarchies
  redressées, puis (§8) l'aide derrière le « i », le « i » contre le libellé, la
  description qui survit au repli, et les réponses en boutons.
