# 0021 — La date est une donnée de la carte, pas un axe de mise en page ; le fil se rafraîchit seul

Date : 2026-08-27

Statut : accepté

## Contexte

Après l'ADR 0019, chaque jour de signature occupait un bandeau pleine largeur
dans le fil des demandes ouvertes. Retour du propriétaire (2026-08-27) : avec
une ou deux demandes par jour, chaque bandeau restait vide à 70 % et la carte
isolée se lisait comme un gros prix flottant — « ça fait très prix ». L'axe
horizontal ne travaillait pas, et « une date n'est pas nécessairement une
colonne ou une rangée ». Le même retour exige une vraie SPA : pas de bouton
« Rafraîchir » — la console doit se tenir à jour toute seule.

## Décision

1. **La date descend SUR la carte.** Le fil est UNE grille responsive
   (`.nc-agenda-grid`, pistes auto-fill) qui remplit la largeur ; les cartes
   s'y rangent chronologiquement (jour le plus proche d'abord, meilleure
   offre en tête de son acte — l'ordre de `agendaByDate` aplati). Chaque
   carte porte un en-tête de jour (`.nc-card-when` : date courte + distance
   relative, `data-today` accentué). Les sections-jours (`.nc-day`), leurs
   en-têtes collants et les groupes d'actes (`.nc-svc`) disparaissent.

2. **Le bandeau-jours résume et filtre.** Au-dessus de la grille, `.nc-days`
   aligne une tuile compacte par jour de signature — date, distance, compte ·
   montant (`aujourd'hui` en teinte marque). Presser une tuile garde ce seul
   jour (aria-pressed) ; represser rend tout. Sur téléphone le bandeau reste
   UNE rangée à défilement horizontal : dix tuiles empilées repoussaient la
   première carte sous le pli.

3. **Le fil se rafraîchit seul.** Le bouton « Rafraîchir » est retiré. Un
   poll (30 s par défaut, `window.__NOTA_POLL_MS__` pour l'ajuster) vit
   exactement aussi longtemps que la session (`ncLoadBids` l'arme,
   `ncExpire` le tue), dort quand l'onglet est caché et ne tire jamais en
   plein geste — champ focalisé, confirmation Retenir armée, formulaire ou
   menu ouvert — parce que `ncLoadBids` re-rend aussi la fiche profil.

## Conséquences

- Sur une console large, ~3 cartes par rangée au lieu d'une carte perdue par
  bandeau ; le balayage chronologique survit (l'ordre EST la chronologie, la
  tuile-jour redonne le total que l'en-tête de jour portait).
- Le poll étant un minuteur jsdom, les suites DOM qui ouvrent une session
  notaire ferment leurs fenêtres en fin de suite (`after → dom.window.close()`
  dans notary-feed-simple, notary-focus, lender-chat, smoke, ux-nav), sinon
  le runner ne se termine jamais — c'était la raison historique du « no
  background poller ».
- `notary-focus.test.mjs` verrouille l'ordre chronologique de la grille, les
  totaux des tuiles et le filtre-jour ; `notary-feed-simple.test.mjs`
  verrouille l'absence de sections-jours, la grille unique, l'absence du
  bouton Rafraîchir, le re-pull automatique et son gel pendant une
  confirmation armée ; le spec Playwright vise `.nc-agenda-grid .nc-card`.
- « Filtrer par jour » (et « Dossier prêt seulement », trou relevé au
  passage) ont leurs entrées anglaises dans `i18n.js` ; « Rafraîchir » et
  « Demandes rafraîchies. » en sortent.

Remplace le §1 (flux vertical par bandeaux-jours) de l'ADR 0019 ; sa
divulgation progressive (§2–3) et la console focalisée (§4) demeurent.
