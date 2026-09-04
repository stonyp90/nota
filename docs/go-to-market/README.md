# Go-to-market — index

Une ligne par document. Le plan décide, la veille informe, le kit exécute.

## L'état de la prospection, au 4 septembre 2026

Une seule version de cette ligne existe. `plan-pmf-30-jours.md` et
`pipeline-notaires.csv` disent la même chose ; si un document en dit une autre,
c'est lui qui a tort.

| Étape | État | Où c'est consigné |
| --- | --- | --- |
| Contacts au pipeline | **37** | `pipeline-notaires.csv` |
| Courriels **envoyés** | **1** — Me Dany Gamache, le 2026-09-02 | `statut = contacte` (1 ligne) |
| Brouillons Gmail **créés, non envoyés** | **9** — la vague 1 | `statut = brouillon_gmail` (9 lignes) |
| Contacts encore à rédiger | **27** | `statut = brouillon_pret` (25) + `a_contacter` (2) |
| Entrevues tenues | **0** | `entrevues/` est vide |

**Ce qui bloque l'envoi des neuf :** l'adresse postale exigée par la LCAP sur
tout message électronique commercial (geste 4 du plan). Rien d'autre.

## Le modèle économique, en une ligne

Le notaire fixe ses honoraires et les garde **en entier**. Nota vend son propre
service au client, à côté, à un prix publié par service : **199 $** financement,
**249 $** refinancement, plus une garantie de date de **0 à 300 $** selon le
préavis. Le client paie **à la signature**. Ni commission, ni partage, ni
pourcentage — voir [`validation-notaires.md`](validation-notaires.md) §2 pour la
grille complète et pour ce que les ADR 0031, 0034 et 0030 ont retiré.

## Le plan

| Document | Ce qu'il contient |
| --- | --- |
| [`plan-pmf-30-jours.md`](plan-pmf-30-jours.md) | Les 30 jours du 3 septembre au 3 octobre 2026 : une seule mesure (rétention > 40 %), sept gestes du propriétaire qui bloquent le premier usager, et ce qui reste à coder. |
| [`carnet-pour-etre-numero-1.md`](carnet-pour-etre-numero-1.md) | Le carnet produit tiré du benchmark : ce qui est en chantier aujourd'hui, les six rattrapages de taille S, puis le reste en S/M/L, chaque ligne nommant le concurrent qu'elle dépasse. |
| [`les-usagers-dans-le-cycle-de-developpement.md`](les-usagers-dans-le-cycle-de-developpement.md) | Comment les dix premiers usagers entrent dans le cycle : conseil de dix, 30 minutes par semaine, porte « Proposer une amélioration », chemin d'une demande, journal des changements public. |

## La veille

| Document | Ce qu'il contient |
| --- | --- |
| [`concurrence.md`](concurrence.md) | La synthèse concurrentielle, corrigée le 3 septembre : qui facture qui, l'écart de prix assumé, l'écosystème CNQ installé, et le tableau « où Nota est devant / derrière ». |
| [`veille-2026-09-03/a-notairo-deeded-ownright.md`](veille-2026-09-03/a-notairo-deeded-ownright.md) | Crawl des trois concurrents financés : prix réels, entonnoirs comptés, rémunération du professionnel, signaux de confiance. |
| [`veille-2026-09-03/b-generation-de-demandes-quebec.md`](veille-2026-09-03/b-generation-de-demandes-quebec.md) | Les quatre apparieurs québécois et Neolegal : volumes revendiqués contre trafic mesuré, entonnoirs, avis. |
| [`veille-2026-09-03/c-decouverte-et-marges.md`](veille-2026-09-03/c-decouverte-et-marges.md) | Les acteurs absents du premier relevé (Leya en tête) et un banc d'essai des marges de trente plateformes qui donnent accès à une profession réglementée. |
| [`veille-2026-09-03/d-benchmark-produit.md`](veille-2026-09-03/d-benchmark-produit.md) | 29 capacités produit × 11 références, scorées, plus le carnet de rattrapage dont dérive `carnet-pour-etre-numero-1.md`. |
| [`veille-notation-plateformes.md`](veille-notation-plateformes.md) | Comment les plateformes notent leurs prestataires. **Instantané du 1<sup>er</sup> septembre** : il a servi à trancher une cote sur 100 qui décidait alors un partage d'honoraires — partage retiré par l'ADR 0031, affichage fermé par l'ADR 0030. À lire comme une archive. |

## Le kit de validation

| Document | Ce qu'il contient |
| --- | --- |
| [`validation-notaires.md`](validation-notaires.md) | Le playbook : les hypothèses à faire trancher par des notaires en exercice, avant d'écrire la ligne de code suivante. |
| [`entrevue-notaire.md`](entrevue-notaire.md) | La grille des 20 minutes, faite pour repartir avec des chiffres et non des impressions. |
| [`courriels-notaires.md`](courriels-notaires.md) | Les gabarits d'approche, au modèle des ADR 0031 et 0034 : deux lignes, 100 % des honoraires au notaire, prix de Nota publié par service. |
| [`courriel-me-dany-gamache.md`](courriel-me-dany-gamache.md) | Le premier courriel, relu à trois lentilles — le patron dont les neuf autres dérivent. |
| [`vague-1-neuf-notaires.md`](vague-1-neuf-notaires.md) | Les neuf destinataires après Gamache, avec la ligne personnalisée de chacun. |
| [`approche-institutions.md`](approche-institutions.md) | Les trois portes institutionnelles — AJNQ, APNQ, Chambre — et l'objectif propre à chacune. |
| [`pipeline-notaires.csv`](pipeline-notaires.csv) | Le pipeline : une ligne par étude, l'état des envois et les réponses aux hypothèses H1 à H6. |
| [`entrevues/`](entrevues/) | Les notes d'entrevue, une par fichier. |
