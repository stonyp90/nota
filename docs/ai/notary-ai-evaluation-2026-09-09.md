# Évaluation IA des quatre parcours notariaux

La stratégie d’apprentissage, la hiérarchie des signaux et la matrice des cas
sont détaillées dans [`notary-learning-strategy-2026-09-09.md`](notary-learning-strategy-2026-09-09.md).

La branche `codex/ai-notary-lifecycle` évalue maintenant un même contrat de préparation pour le financement, le refinancement, le testament et la procuration. Le contrat est fondé sur des faits extraits avec une citation exacte de document et de page. La sortie reste `needs_notary_review`; elle ne peut pas déclarer une capacité, une qualité, un titre, une radiation, une homologation, un consentement ou une aptitude à signer.

Le catalogue expose une vue `parameterCoverage` dans chaque paquet privé. Elle relie :

- les paramètres de tarification et les champs recueillis du client;
- les documents attendus et les documents conditionnels;
- les champs que l’IA peut proposer avec preuve;
- les contrôles critiques qui doivent être décidés par le notaire;
- les intégrations candidates, sans prétendre qu’un accès fournisseur est déjà autorisé.

Les champs IA couvrent notamment les parties et leurs rôles, l’identification cadastrale, le type d’immeuble, le prix d’achat séparé du montant du prêt, l’objet du financement, la version des instructions du prêteur, les changements à l’immeuble et la date de validité d’un remboursement. Pour un testament, l’IA prépare aussi les formalités mentionnées. Pour une procuration, elle extrait le type déclaré et force le contrôle de routage entre procuration ordinaire et possible mandat de protection.

Le jeu `apps/api/evals/notary-ai-extraction-cases.json` est entièrement synthétique et non révisé par un notaire. Il contient au moins un cas par service et teste la séparation des rôles, la distinction prix d’achat/montant du prêt, la date de validité d’un remboursement, les formalités testamentaires et le routage d’un mandat de protection. Il ne doit jamais être présenté comme une mesure de précision professionnelle.

```bash
npm run test:notary-ai
npm run eval:notary-ai
```

`eval:notary-ai` sans `--live` ne charge aucun fournisseur. Une évaluation fournisseur explicite peut être lancée avec `--live` après avoir configuré une clé ou un profil Bedrock dans l’environnement d’exécution. Le rapport conserve le modèle, la version des connaissances, les empreintes de prompt et d’entrée, la latence et les compteurs d’usage nettoyés; il n’enregistre ni les pages ni les erreurs brutes du fournisseur.

Le cycle d’amélioration est contrôlé : une correction du notaire est un signal d’évaluation et de régression, pas un exemple d’entraînement automatique. Avant d’autoriser un affinage privé, il faut une base dé-identifiée et autorisée, une annotation notariale, une séparation entraînement/validation/test, une mesure par service et langue, un seuil de faux déblocage nul sur les contrôles critiques, une revue professionnelle et un retour arrière. Le champ de revue `trainingEligible` reste donc `false` jusqu’à cette gouvernance.

Les événements de production suivent désormais la même séparation : les réponses,
comportements et communications du client restent des signaux faibles pour le
routage et l’expérience; seuls des champs vérifiés séparément par un notaire
peuvent constituer une préférence d’extraction hors ligne. Le constructeur
`buildNotaryPreferenceDataset` reste fermé par défaut et ne modifie aucun poids.

Les coûts sont bornés par le nombre de pages, la taille du texte, le nombre de champs, le nombre d’appels par notaire et le budget quotidien. Une même demande validée est réutilisée par empreinte; une correction ou un document modifié crée une nouvelle génération. Ces règles réduisent les appels et la latence sans masquer un manque de preuve.
