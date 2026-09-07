# 0039 — Une note de situation ne bouge plus le formulaire : elle passe derrière un « i »

Date : 2026-09-05

Statut : accepté

## Contexte

Dans la feuille de réservation, une réponse pouvait faire apparaître une
phrase en orange sous la question qui l'avait déclenchée — « Sans les
instructions du prêteur en main, une signature dans moins de deux semaines
est rarement tenable… » sous *Approbation bancaire*, les deux mises en garde
du déplacement sous *Déplacement pour la signature*, « Vos réponses
précédentes — vérifiez-les » au-dessus de la grille, « Réponse requise » sous
chaque question attendue.

Chacune de ces phrases était un bloc de plus dans la carte : elle **grandit**
la carte qui la porte, pousse vers le bas tout ce qui suit, puis laisse tout
remonter à la réponse suivante. Le formulaire bougeait sous la main du client
pendant qu'il le lisait. Retour du propriétaire (2026-09-05) : « s'assurer que
la hauteur du composant ne change pas, mettre un petit i pour information et
l'information en survol ».

## Décision

1. **Un primitif, `infoTip()` / `.itip`.** Une note *de situation* — une
   phrase qui arrive à cause d'une réponse et repart avec la suivante — ne
   prend plus de ligne. Elle est portée par un petit « i » épinglé sur la
   ligne de la question elle-même, et s'ouvre dans un panneau **hors flux**
   (`position: absolute`) qui flotte par-dessus la page. La hauteur du
   formulaire cesse de dépendre de ce que ses notes ont à dire.

2. **La boîte est réservée, jamais retirée.** Une pastille sans rien à dire
   reste en place en `visibility: hidden` — jamais `display: none` — donc la
   ligne du libellé ne tressaute pas non plus, et un élément invisible n'est
   ni focusable ni lu à voix haute : une pastille muette est muette aussi
   pour un lecteur d'écran.

3. **Trois portes, pas seulement la souris.** Survol, focus clavier, et un
   clic qui **épingle** le panneau jusqu'à Échap, un clic à l'extérieur, ou
   l'ouverture d'une autre pastille — deux panneaux ne tiennent jamais
   ouverts en même temps. Le panneau épinglé prend le pointeur : sa phrase se
   sélectionne et se copie. Le bouton est un vrai `<button type="button">`
   nommé « Information », qui pointe (`aria-controls` / `aria-describedby`)
   vers son panneau `role="tooltip"` ; l'icône n'est jamais le libellé.

4. **Le placement est mesuré au moment d'être vu**, jamais au rendu et jamais
   sur un défilement inactif : côté haut/bas selon la place, et un glissement
   horizontal borné à la fenêtre — sur téléphone le panneau est plus large
   que la place à gauche du « i », donc l'aligner sur un bord ne suffit pas.
   Tant qu'un panneau est épinglé, et seulement là, il suit son « i » au
   défilement et au redimensionnement.

5. **Ce qui NE passe pas derrière le « i ».** Un message de validation reste
   lu en clair : « Réponse requise » garde sa ligne, mais cette ligne est
   **réservée dès la première peinture** par la passe qui trouve la question
   attendue, et seule sa visibilité change ensuite. Une question répondue,
   effacée, puis répondue de nouveau ne déplace plus rien. Même règle pour
   l'aperçu du secteur postal et pour les deux confirmations « enregistré »
   de la console notaire : la ligne est tenue (`min-height`), seule la phrase
   arrive et repart — ce qui est aussi ce qui fait parler un `role="status"`.

5bis. **Une seule règle pour toutes les lignes tenues.** Le tapis général de
   la feuille est `.hidden, [hidden] { display: none !important }` : mettre
   `visibility: hidden` sans plus ne tient RIEN, le navigateur retire la ligne
   quand même — et aucun test unitaire ne le voit, jsdom ne calculant pas de
   mise en page. Le registre est donc **une liste unique** de sélecteurs qui
   répondent `display: … !important; visibility: hidden`, avec `.hold` comme
   nom d'accueil pour tout nouvel arrivant et `.hold-line` pour réserver la
   hauteur des nœuds qu'on VIDE quand ils se taisent. Deux conteneurs flex
   (`.day-market-line`, `.cal-avail`) gardent leur `flex` : en `block` leur
   contenu se recomposerait et la ligne tenue changerait de hauteur.

5ter. **Ce qu'on ne réserve PAS.** Une liste de refus (`.errors`) répond à un
   envoi volontaire, pas à une frappe : le saut arrive une fois, à un moment
   où l'œil est déjà sur le message. La réserver mettrait ~27 px de vide
   permanent au-dessus de six boutons d'envoi — plus cher que le saut évité.
   Les listes qui répondent à CHAQUE frappe (`.nc-form-errors`,
   `.nc-field-err`) tiennent bien leur ligne, elles. Même arbitrage pour
   `.file-error` (un refus de fichier répond à un choix délibéré) et pour les
   sous-cartes qui arrivent d'un `fetch`.

6. **Le pouls d'un signal qui n'a plus sa ligne.** Une note qui vient
   d'arriver réveille son « i » une fois (animation courte, coupée sous
   `prefers-reduced-motion`) : un signal qui ne prend plus de place doit
   quand même se faire voir. Le « i » d'une note d'avertissement est au ton
   `--warn`, celui d'une note d'information au ton neutre.

7. **Questions fréquentes (Partenaires).** Même famille de problème, autre
   cause : la grille à deux colonnes partage ses **rangées**, donc ouvrir la
   première réponse faisait descendre les questions des DEUX colonnes. Les
   items sont désormais tenus par deux boîtes-colonnes indépendantes
   (`display: contents` tant qu'il n'y a qu'une colonne, donc le téléphone
   lit toujours les questions dans l'ordre écrit). Les réponses restent des
   `<details>` : une réponse de plusieurs phrases se lit, elle ne se survole
   pas.

8. **La sélection de texte** répond aux jetons de la marque (`::selection`,
   web et admin) plutôt qu'au bleu par défaut du navigateur.

## Conséquences

- `infoTip()` est le primitif à réutiliser pour toute note de situation à
  venir ; ajouter une phrase sous un contrôle n'est plus le geste par défaut.
- La hauteur de la grille des questions est mesurée invariante par les tests
  (`apps/web/test/info-tip.test.mjs`) : le nombre de nœuds d'une rangée ne
  change pas quand une note s'allume.
- Les questions requises portent une ligne réservée dès la première peinture,
  donc la feuille est un peu plus haute au repos — c'est le prix d'une
  hauteur qui ne bouge jamais, et il est payé une seule fois.
- L'admin n'avait presque aucune note de situation par champ : cinq en tout,
  toutes dans la carte Campagnes. Le primitif `infoTip` n'y est **pas** porté
  — ce serait ~130 lignes pour deux appelants. Deux `min-height`
  (`.camp-perime`, `.camp-gabarit-nature`) et une ligne tenue sur `.tpl-error`
  — la région d'erreur partagée par une dizaine de cartes, toujours collée
  au-dessus de la rangée d'actions — achètent tout le gain. Le registre de
  sélection y est aligné aussi.
- Le « i » vise 24 × 24 px (WCAG 2.2 « Target Size ») par un pad hors flux, et
  le survol est réservé aux vrais pointeurs (`@media (hover: hover)`) : sur
  écran tactile un tap laissait un `:hover` collé et le panneau ne se
  refermait plus.
