# 0022 — Sur téléphone, la landing se centre sur le calendrier ; le marché devient deux cartes compactes

Date : 2026-08-27

Statut : accepté

## Contexte

Sur téléphone, les deux rangées du pouls du marché (Refinancement /
Financement — nom, deux chiffres, légende des volumes, barre de volume,
flèche « réserver ») coûtaient ~300 px du premier écran : le calendrier des
disponibilités commençait sous la pliure. Retour du propriétaire
(2026-08-27) : « pour la version mobile, financing et refinancing, on peut
utiliser un autre UI — le but c'est vraiment de focusser sur les
availabilities et le calendrier. » Deux irritants du même écran : au joint de
mois, l'étiquette du jour s'ellipsait (« MAR 1 SE… ») sous la réserve du
chevron ; et la bulle flottante « ? » (Comment ça marche) peignait par-dessus
les tuiles du calendrier — « remove this » (même retour).

## Décision

1. **Le strip marché téléphone** (≤ 767.98 px) : les deux actes deviennent
   une paire de cartes côte à côte — le nom de l'acte au-dessus de ses deux
   chiffres légendés (« à partir de » / « médiane », légende à gauche,
   montant à droite). La barre de volume et la ligne des comptes restent au
   bureau (couleur de marché, pas une décision de réservation) ; la flèche
   « réserver » par rangée disparaît — le CTA du héros juste au-dessus
   réserve déjà. MÊME DOM que le bureau : une carte filtre toujours le
   carnet, `.is-on` marque l'acte actif par son arête brand.
2. **Le joint de mois se replie** : dans la grille téléphone (3 colonnes),
   une cellule de joint peut se replier — « MAR 1 » reste entier et le mois
   se lit sur sa propre ligne discrète en dessous, jamais d'ellipse au
   milieu d'un mot.
3. **La bulle « ? » quitte le téléphone** : `display: none` dans la bande
   ≤ 767.98 px. Le guide garde ses portes téléphone — l'onboarding de
   première visite et le lien du pied de page. Le bureau garde la bulle,
   toujours à un tap (les décisions 2026-08-26/27 « toujours visible, jamais
   dans un menu » restent vraies AU BUREAU).

## Conséquences

- Le calendrier atteint la pliure d'un iPhone (812 pt) au lieu de commencer
  un écran plus bas ; la section marché passe d'environ 300 px à ~190 px.
- CSS seulement : aucun test DOM existant ne bouge ; les invariants sont
  gardés par `apps/web/test/mobile-market-compact.test.mjs`.
- L'ancien bloc téléphone ≤ 480 px du pouls (empilement nom / chiffres /
  barre) est retiré — la forme change à 768, pas à 480.
