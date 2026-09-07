# 0040 — La feuille de réservation se fait en quatre écrans, et les colonnes vont jusqu'au bout

Date : 2026-09-05

Statut : accepté

## Contexte

Retour du propriétaire, capture à l'appui : « l'expérience est vraiment
confuse. Le faire en plusieurs screens — le premier, choisir l'acte, le
deuxième, les informations rentrées, et caetera. S'assurer que ça reste très
simple pour l'usager. »

La feuille de réservation empilait cinq blocs dans une seule colonne à faire
défiler : l'acte, les questions du notaire (en grille à deux colonnes), le
prix, le secteur postal, l'identité, puis le bouton. Tout se disputait le même
premier regard, et rien ne disait où l'on en était.

Deux autres captures, le même jour, sur deux pages différentes : « lets use
all the space » et « remove all the gap there and improve design ». Même
maladie, autre organe — une colonne s'arrêtait, l'autre continuait, et le vide
entre les deux se lisait comme un oubli.

## Décision

1. **Quatre écrans, un seul à la fois** : 1 l'acte · 2 les réponses · 3 le
   prix · 4 les coordonnées. Un rail en haut dit où l'on est et ramène vers
   une étape déjà franchie — jamais au-delà : on ne saute pas par-dessus une
   question du notaire.

2. **La structure du formulaire NE CHANGE PAS.** Chaque bloc porte le numéro
   de l'écran auquel il appartient (`data-screen`), le formulaire porte celui
   où l'on est (`data-at`), et c'est le CSS seul qui n'en montre qu'un. Rien
   n'est détaché du DOM : ce qui a été répondu à l'écran 2 reste répondu, le
   garde de publication continue de juger le formulaire ENTIER — pas l'écran
   courant — et un `display: none` retire déjà du parcours au clavier et de
   l'arbre d'accessibilité.

3. **Les portes existantes ouvrent d'abord le bon écran** (`bookShow`) : la
   ligne « Répondez à : … », le refus du serveur et les liens du garde
   viseraient sinon un champ que le CSS cache.

4. **Une seule barre d'action, toujours en bas** : « Retour » à gauche, et à
   droite l'action qui fait avancer — « Continuer », ou « Publier mon offre »
   au dernier écran. Jamais deux boutons primaires à la fois. « Continuer » ne
   bloque pas en silence : si l'écran attend une réponse, il la marque et pose
   le curseur dessus.

5. **L'écran 2 s'enjambe** quand l'acte ne pose aucune question, dans les deux
   sens, plutôt que de montrer une carte vide.

6. **Partenaires — l'estimateur descend sous les deux cartes qu'il calcule**,
   et la mention de l'article 33 remonte sous le bouton « Obtenir mon code ».
   La colonne de gauche courait 179 px plus bas que la droite : la moitié
   droite du héros finissait sur du vide, et « combien de clients par mois ? »
   était loin des deux montants qui lui répondent. Les deux colonnes se
   terminent maintenant à 11 px l'une de l'autre et le héros a rendu 105 px.
   Devenus des cases de la grille, ces blocs n'ont plus à porter leur propre
   marge : elle s'ajoutait au `gap`.

7. **Espace notaire — l'agenda ferme la colonne de gauche**, sous la grille
   des demandes, au lieu de suivre la porte d'accès à droite. Sous la grille
   s'ouvrait un trou de 137 px pendant que la colonne de droite continuait. Ce
   qui reste se retrouve désormais sous la porte d'accès : sous une carte qui
   se termine par son bouton, du blanc se lit comme du calme, pas comme un
   oubli. Le nombre de demandes montrées avant l'inscription NE CHANGE PAS —
   c'est une décision produit, pas une décision de mise en page.

8. **L'écran 1 ne porte plus que sa question.** Le contexte marché
   (`.day-market` : la référence du jour, « Offrir autant », la liste des
   offres) et la ligne de délai (`#day-chance`) sont passés à l'écran 3 — ils
   répétaient trois fois le même montant à côté de la SEULE question de
   l'écran 1, et ils ne veulent dire quelque chose qu'au moment où l'on fixe
   son prix. Les deux cartes d'acte prennent la place ainsi rendue, sans
   devenir des pavés : elles se dimensionnent sur leur contenu.

9. **« Nous joindre » et la messagerie ont perdu ce qu'elles disaient deux
   fois.** Le préambule du dialogue de contact passe de quatre lignes à une
   (la seconde moitié était déjà l'état « envoyé », mot pour mot) ; le
   compteur de caractères monte sur la ligne du libellé, qui a déjà cette
   hauteur, donc la réserve d'ADR 0039 ne coûte plus une bande vide ; la
   boîte de message se pose à deux lignes au lieu de trois. Dans la
   messagerie, le journal se colle au bas (le vide du milieu se lisait comme
   « ça charge »), la ligne du courriel s'empile au lieu de s'aligner de
   travers, le panneau passe à 380 px et son échelle de police se resserre.
   Le compteur `#chat-count` rejoint le registre des lignes tenues : il se
   réveille à la frappe et poussait la ligne du courriel vers le bas.

## Conséquences

- La feuille est plus haute au repos (le rail, la barre d'action) et beaucoup
  plus courte à lire : un écran tient dans un regard.
- Les tests continuent de remplir le formulaire de bout en bout sans connaître
  les écrans, puisque rien n'est retiré du DOM.
- `bookSeen` borne le rail : une étape jamais atteinte n'est pas cliquable.
- Une date changée depuis l'intérieur du dialogue laisse le client sur son
  écran ; une nouvelle date ouverte repart de l'écran 1.
