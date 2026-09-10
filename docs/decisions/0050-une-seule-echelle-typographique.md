# 50. Une seule échelle typographique : la page Signature fait loi

- Status: Accepted
- Date: 2026-09-10

## Contexte

Le propriétaire, captures à l'appui : « the font is really not accurate across
the app — the whole app must use the pattern from this page ». La page en
question est le pane Signature (bêta) : titre en Sora 800, 42–68 px, interligne
1,02, approche −0,055 em ; lede Inter 17 px / 1,7 ; surtitre 12 px, capitales,
approche 0,1 em.

Le reste du site ne la suivait pas. Chaque porte posait sa propre taille de
titre : carnet 21–28 px, partenaires 26–38 px, espace notaire 28–46 px, tous en
Inter 800 (Sora n'était chargée que « pour le texte d'intro hérité »). Les
sections (22 px), les cartes (16 px), les dialogues (18–20 px) et la visite de
compte (21 px) avaient chacune leur chiffre. Vingt-six règles de titre
portaient une taille en dur. Inter elle-même n'était pas chargée : le rendu
dépendait des polices installées sur la machine du visiteur.

Deuxième demande, même passe : « remove the colour fill from the 10 and any
number ». Dans le calendrier, la date du jour s'imprimait en blanc sur un carré
bleu, et le prix du palier extrême (« dès 8 000 $ ») en blanc sur un carré
rouge. Un nombre rempli se lit comme un bouton ; une date est un fait.

## Décision

1. **Des jetons `--type-*` dans `:root`, copiés de la bêta, verbatim.** h1
   `clamp(42px, 4.25vw, 68px)` (variante empilée `clamp(42px, 9vw, 58px)`), h2
   `clamp(24px, 2.35vw, 34px)`, h3 17 px, lede 17 px / 1,7, surtitre 12 px /
   0,1 em, avec leurs interlignes et approches. `--font-display: 'Sora'` et
   `--weight-display: 800` deviennent la face et la graisse de TOUT titre.
2. **`h1, h2, h3` lisent l'échelle globalement.** Aucune règle de titre ne
   pose sa propre taille, face, graisse ou approche : un pane ne fait que
   colorer son titre. `typographie.test.mjs` relit la feuille et refuse toute
   règle `h1`/`h2`/`h3` qui porterait un `font-size` hors `var(--type-h…)`.
3. **Les deux faces se chargent partout** (Inter 400–800 + Sora 700/800 via
   Google Fonts) : `index.html`, `signature.html` et la console admin.
4. **La salle de signature et la console admin** portent la même face, la même
   graisse et la même échelle. Une seule dérogation, dite dans le code : le
   titre de page de la console (surface de travail) s'assoit sur le barreau h2,
   pas sur le barreau h1 — 68 px au-dessus d'une table repousserait la donnée
   qu'il introduit sous le premier écran.
5. **Aucun nombre du calendrier ne porte de fond.** Aujourd'hui se dit par la
   couleur de marque et la graisse ; le palier extrême par son encre la plus
   sombre. Le mot et la couleur portent le sens, jamais un remplissage.

## Conséquences

- Les trois portes (carnet, espace notaire, partenaires), la bêta et la salle
  parlent d'une seule voix ; changer un barreau se fait en un endroit.
- Les titres de section et de dialogue montent d'un cran (24–34 px). C'est la
  hiérarchie de la page de référence, voulue par le propriétaire.
- Les ledes des trois portes prennent la mesure de la bêta (47 ch) : le carnet
  perd la mesure de 68 ch posée pour combler une gouttière à 14,5 px — à 17 px
  la question ne se pose plus de la même façon.
- Le test de style bloque le retour des tailles en dur ; un pane qui aurait
  besoin d'un barreau qui n'existe pas doit d'abord l'ajouter à l'échelle.
