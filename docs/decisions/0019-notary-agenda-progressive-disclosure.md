# 0019 — L'agenda du notaire lit en une passe : divulgation progressive et console focalisée

Date : 2026-08-27
Statut : accepté

## Contexte

Le fil des demandes ouvertes (Espace notaire) était devenu illisible (retour
du propriétaire, 2026-08-27) : une maçonnerie de tuiles-jours placées côte à
côte (certaines élargies sur deux pistes), et dans chaque tuile des cartes
chargées — pastilles de signaux, ligne prêteur/déplacement, prose des
facteurs, pastilles d'état, barre d'outils, deux boutons. L'ordre de lecture
était ambigu et chaque carte demandait une étude avant la décision. De plus,
un notaire connecté gardait tout le menu client (Carnet, Partenaires) en
tête de page, en compétition avec son agenda.

## Décision

1. **Un seul flux vertical, chronologique.** Les sections-jours s'empilent du
   plus proche au plus lointain (l'en-tête de jour reste collant : date,
   nombre de demandes, montant à retenir). La maçonnerie et `.nc-day--span`
   disparaissent. À L'INTÉRIEUR d'un bandeau-jour, l'espace horizontal
   travaille : les groupes d'actes partagent la rangée et leurs cartes se
   rangent en grille.

2. **Divulgation progressive sur chaque carte.** La moitié toujours visible
   est la RANGÉE DE DÉCISION : acte, montant, pastilles de signaux
   (palier / complexité / dossier), faits (prêteur · déplacement · code),
   ce qui est déjà en cours (proposition, documents), et Retenir. Tout le
   verbeux — prose des facteurs, barre Proposer un prix / Demander des
   documents / Agenda, Décliner — se replie dans `.nc-card-body` derrière un
   bouton « Détails » (aria-expanded/aria-controls). Toute la surface de la
   carte est la cible du déplié ; les cartes ouvertes à la main survivent aux
   re-rendus (rafraîchir, filtres).

3. **Le niveau de détail est un réglage, pas un état.** Un seg
   « L'essentiel | Tout afficher » au-dessus du fil déplie ou replie tout
   d'un coup ; le choix est mémorisé par appareil
   (`nota.notary.view.v1`). Revenir à l'essentiel replie aussi les cartes
   ouvertes à la main : le seg veut dire « montre-moi ce niveau ».

4. **Connecté = console.** `body.is-notary-session` masque les portes client
   (Carnet, Partenaires — en-tête et tiroir mobile) tant que la session
   notaire vit, et une session restaurée atterrit sur l'Espace notaire quand
   l'URL n'impose pas d'onglet. Se déconnecter restaure le menu complet.

5. **Une seule identité : le menu compte.** (Addendum, même jour.) La barre
   « Connecté · courriel · Se déconnecter » du panneau doublait le menu
   compte de l'en-tête et laissait une bande morte au-dessus de l'agenda.
   Elle disparaît : l'avatar de l'en-tête porte seul le courriel et
   Se déconnecter, la console ouvre directement sur les demandes.

6. **Le bandeau des jours devient un rail-calendrier.** (Addendum, même
   jour.) Les tuiles « Jeu. 27 août · dans X jours · 1 demande · 4 200 $ »
   répétaient les mêmes mots douze fois et s'empilaient sur deux rangées.
   Chaque jour devient une cellule de calendrier compacte — jour de semaine
   sur le numéro, mois dessous, le montant du jour, le nombre en badge de
   coin — dans UNE rangée défilable (scroll-snap) à toute largeur. La phrase
   complète vit dans l'aria-label. Une cellule pressée retient son jour et le
   reste du rail s'estompe (`has-day`).

## Conséquences

- Le fil se balaie du haut vers le bas sans étude : montants alignés,
  signaux courts, détails au besoin — la barre UX du propriétaire (≤ 3 clics,
  ADR 0009) tient : Retenir reste à 1 clic + confirmation, Décliner et la
  barre d'outils à 2.
- `notary-feed-simple.test.mjs` verrouille le pli par défaut, le toggle par
  carte, la survie aux re-rendus, le seg global et sa persistance, la classe
  de session sur `<body>`, et l'absence de maçonnerie ;
  `notary-focus.test.mjs` verrouille désormais le flux vertical (son ancien
  test de tuilage est retiré).
- Les chaînes nouvelles (« L'essentiel », « Tout afficher », « Détails »,
  « Réduire », « Niveau de détail ») ont leurs entrées anglaises dans
  `i18n.js`.
