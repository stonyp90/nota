# Boucle bêta d’amélioration IA des notaires

La bêta gratuite sert à valider deux choses en parallèle : l’utilité de la
préparation assistée pour un notaire et la qualité des propositions sur des
cas contrôlés. Elle ne transforme pas les dossiers clients en données
d’entraînement par défaut.

## Feedback demandé

Quand une extraction est incomplète ou contradictoire, l’interface expose une
question de clarification structurée. Le notaire vérifie la source et peut
accepter, corriger ou rejeter chaque proposition. Cette révision est le signal
fort; les clics, délais et comportements des clients restent des signaux
faibles, utiles seulement pour le triage et l’expérience.

Une révision ne certifie jamais l’identité, la capacité, le titre, les taxes,
les instructions du prêteur, la signature, le déboursement ou la validité
juridique. Ces contrôles restent dans le paquet de travail et sous la
responsabilité du notaire.

## Schedule et apprentissage

Le job quotidien `customer-improvement` demeure limité à l’expérience client
réversible (`standard`/`guided`). Le job hebdomadaire
`notary-learning-review` compte les signaux minimisés et produit un rapport de
triage. Il n’appelle aucun fournisseur, ne lit pas le texte des documents et
ne modifie ni poids, ni prompt, ni modèle en production.

Le terme « reinforcement learning » désigne ici une optimisation de
préférences hors ligne à partir de labels notariaux autorisés. Une promotion
requiert encore : autorisation d’utilisation, dé-identification, jeu de
qualification gelé, réussite de la qualification, approbation identifiée,
plan de retour arrière et déploiement manuel/canary. Le rapport planifié ne
peut pas franchir cette frontière.

## Guardrails de mise en production

- Toute sortie reste une proposition avec provenance et preuve source.
- Une abstention est préférable à une valeur devinée.
- Les cas inconnus, contradictoires ou critiques sont routés au notaire.
- L’automatisation cible la préparation et le suivi, jamais une décision
  juridique ou une exécution autonome.
- Les erreurs de job vont en DLQ; les rapports sont observables et rejouables.

La bêta doit donc mesurer la réduction du temps de préparation, le taux de
correction, le taux d’abstention et les exceptions critiques avant toute
promesse d’automatisation ou de remplacement de tâches professionnelles.
