# Vague 1 — neuf notaires après Gamache

**Déclencheur :** le courriel à Me Gamache est approuvé et envoyé.
**Source des cibles :** `pipeline-notaires.csv`, colonne `statut = brouillon_pret`,
`e1_envoye` vide. Aucune extraction du bottin de la Chambre.
**Règles du kit qui s'appliquent** (`courriels-notaires.md`) : envoi individuel,
jamais en cc ; une ligne personnalisée par étude ; aucun pourcentage ;
identification complète et mécanisme de retrait, parce que ces neuf-là sont des
premiers contacts à froid et non une référence.

## Les neuf

| # | Destinataire | Étude · ville | Courriel | Pourquoi elle |
| --- | --- | --- | --- | --- |
| 1 | Me Gaétane Baril | Québec (Lebourgneuf) | reception@notairebaril.qc.ca | Phase 1. Dessert Charlesbourg, Beauport, Sainte-Foy : le cœur du territoire. |
| 2 | Un notaire de l'étude | Lagrange Provencher · Lévis | info@lpnotaires.com | Phase 1. Lévis est dans la RMR de Québec, de l'autre côté du fleuve. |
| 3 | Un notaire de l'étude | Marcoux Gariépy & Associés · Beauport | notairesconseils@notarius.net | Phase 1. Beauport, à l'est de la ville. |
| 4 | Un notaire de l'étude | Boulanger Dolan Denault · Montmagny | info@pmenotaires.com | Côte-du-Sud, à une heure de Québec : offre finie, dates rares. |
| 5 | Un notaire de l'étude | PME INTER Notaires · Sainte-Marie | info@lesnotaires.net | Beauce, 45 min de Québec : même logique d'offre finie. |
| 6 | Un notaire de l'étude | Tousignant Rodrigue Veilleux Mathieu · Saint-Georges | trnotair@notarius.net | Beauce profonde : le déplacement pèse dans chaque dossier. |
| 7 | Me Philippe Couture | Horizon Notaires · Sherbrooke | info@horizonnotaires.com | Étude récente, un seul notaire : le profil « notaire fondateur ». |
| 8 | Me Étienne Tourigny | Tourigny Desjardins · Trois-Rivières | tdnotaires@notarius.net | Jeune étude qui se dit dynamique ; deux notaires nommés. |
| 9 | Me Stéphanie Racicot | Sherbrooke | stephanieracicot@notarius.net | Pratique solo : c'est elle qui décide, et vite. |

Six sur neuf sont à moins d'une heure de Québec et peuvent **utiliser** le
produit dès la phase 1. Les trois autres sont des notaires nommés, jeunes ou
solo : ils donnent la forme du produit, pas encore du volume.

## Ce qui change par rapport au courriel Gamache

| Élément | Gamache | Les neuf |
| --- | --- | --- |
| Salutation | « Bonjour Me Gamache, » | « Bonjour Me [Nom], » ou « Bonjour, » si boîte générique |
| La référence | « Antoine Leclerc, de Stein Monast, a pensé à vous. » | **Remplacée** par la ligne personnalisée ci-dessous |
| La rencontre | « me déplacer à Loretteville » | Québec et rayon d'une heure : « me déplacer à [ville] ». Sherbrooke, Trois-Rivières : « en visioconférence » |
| Pied de page | aucun | **Adresse postale + ligne de retrait** (LCAP, premier contact à froid) |

## Les lignes personnalisées

| # | Ligne |
| --- | --- |
| 1 | Nous amorçons le déploiement dans la région de Québec, et votre étude dessert précisément les quartiers où les premières demandes seront publiées. |
| 2 | Nous amorçons le déploiement dans la région de Québec, et Lévis en fait partie dès le premier jour. |
| 3 | Nous amorçons le déploiement dans la région de Québec, et Beauport est dans le premier périmètre. |
| 4 | Dans une région comme la Côte-du-Sud, le nombre de notaires disponibles pour une date donnée est limité. C'est là que la plateforme prend tout son sens. |
| 5 | Dans une région comme la Beauce, le nombre de notaires disponibles pour une date donnée est limité. C'est là que la plateforme prend tout son sens. |
| 6 | À Saint-Georges, le déplacement pèse dans chaque dossier, et c'est un des facteurs que le questionnaire du client capture explicitement. |
| 7 | Une étude récente, avec un seul notaire, est exactement le point de vue qui me manque : celui de quelqu'un qui bâtit sa clientèle et pour qui une date vide a un coût réel. |
| 8 | Une jeune étude qui se dit dynamique est exactement le point de vue qui me manque : celui de notaires qui bâtissent leur clientèle et pour qui une date vide a un coût réel. |
| 9 | Une pratique solo est exactement le point de vue qui me manque : celui de quelqu'un qui décide seul, et pour qui une date vide a un coût réel. |

## Le gabarit

```
Bonjour Me [Nom],

Je suis Anthony Paquet, entrepreneur et développeur logiciel. J'ai développé
Nota, une plateforme qui vise à rééquilibrer l'offre et la demande des actes
notariaux simples, soit le financement et le refinancement hypothécaires.

[… paragraphes 2 à 6 identiques au courriel Gamache : fonctionnement,
honoraires, questionnaire, prime, liens …]

À terme, je souhaite démontrer à la Chambre des notaires qu'un tel dossier
peut se mener à distance en toute sécurité. C'est le sujet sur lequel votre
avis me serait le plus utile.

Au-delà des utilisateurs, je cherche un notaire qui accepte de m'accompagner
dans cette aventure et dont le jugement professionnel façonnera Nota avant
son ouverture au public. [LIGNE PERSONNALISÉE]

Auriez-vous vingt minutes à m'accorder cette semaine ou la suivante ?
[Je me ferais un plaisir de me déplacer à [ville]. | Une visioconférence
suffit amplement.]

Bien à vous,

Anthony Paquet
Fondateur, Nota
418-564-6162
anthonypaquet.com
[ADRESSE POSTALE — À FOURNIR, exigée par la LCAP]
Pour ne plus recevoir de message de ma part, répondez « retrait ».
```

## Avant de créer les neuf brouillons

1. **Le courriel Gamache est envoyé** (déclencheur).
2. **L'adresse postale** est fournie : sans elle, le pied de page LCAP est un
   trou, et il vaut mieux ne pas envoyer que d'envoyer incomplet.
3. **Les liens sont retapés à la main** dans chaque brouillon (voir la note
   sur la réécriture par Gmail ci-dessous).

## Note — Gmail réécrit les liens des brouillons créés par l'API

Vérifié dans le MIME stocké le 2026-09-02 : toute URL déposée par l'API ressort
en `https://www.google.com/url?q=…&source=gmail&ust=…&sa=E`. Le paramètre `ust`
est horodaté et expire. **Ce n'est pas un artefact d'affichage — c'est ce qui
partirait.** Le seul remède fiable : ouvrir le brouillon dans Gmail, effacer
chaque lien et le retaper. Gmail ne réécrit pas ce que l'expéditeur tape
lui-même.
