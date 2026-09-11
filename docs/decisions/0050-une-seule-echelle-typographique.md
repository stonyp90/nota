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

## Addendum — 2026-09-11 : les classes de titre retirées, barreau h4 optionnel

L'inventaire de marque du 2026-09-11 a trouvé le trou du test : la règle
d'élément `h2` passait pendant que douze classes posées sur des `<h2>` de
`index.html` (`.auth-title`, `.onb-title`, `.pr-how-title`, `.pr-faq-title`,
`.h-sub` et ses trois surcharges, `.nc-live-h`, `.nc-ai-title`, `.nc-h`,
`.ig-title` et ses trois variantes, `.nc-conformite-h`, `.salle-etape-nom`)
posaient 15–21 px, une graisse 700 ou leur propre approche.

1. **Aucune classe posée sur un titre ne pose sa propre taille, graisse, face
   ou approche.** `typographie.test.mjs` relit les classes de tout h1/h2/h3
   de `index.html` et refuse toute règle dont le dernier composé porte l'une
   d'elles avec un `font-size` / `font-weight` / `font-family` /
   `letter-spacing` hors `var(--type-*)`, `var(--weight-display)`,
   `var(--font-display)`. Une classe ne fait que colorer, aligner, espacer.
2. **Où chaque titre s'assoit.** Titres de dialogue (`.auth-title`,
   `.onb-title`) et porte de connexion notaire (`.nc-gate .h-sub`) : barreau
   h2 (le titre hérite de la règle d'élément, la classe ne dit plus rien).
   Titres de carte et de section (`.h-sub`, `.pr-*-title`, `.nc-ai-title`,
   `.salle-etape-nom`) : barreau h3. Titre de la porte d'entrée (`.ig-title`) :
   `--type-h1-compact`, et le barreau h2 sur les téléphones courts, où le film
   doit tenir sous la ligne de flottaison.
3. **Barreau h4, optionnel : `--type-h4: 15px; --type-h4-lh: 1.3;
   --type-h4-ls: -.01em`.** Les kickers denses de carte (`.nc-h`, `.nc-live-h`,
   `.nc-conformite-h`) avaient besoin d'un barreau sous h3 ; il est déclaré
   dans les DEUX `:root` (`styles.css`, `tokens.css`) avec les mêmes valeurs,
   le test compare les deux, et la feuille de la salle le porte aussi. La
   graisse reste `--weight-display` : un titre de 15 px en 800 est un kicker,
   pas un libellé.
4. **La salle de signature** ne porte plus aucune couleur hors de ses deux
   blocs de jetons — la palette verte retirée survivait sur la ligne minifiée
   de `signature.css` et teintait encore la scène vidéo, les plaques et le
   document — et son titre de document (`.paper h3`) passe de Georgia 25 px au
   barreau h2 en Sora 800.
