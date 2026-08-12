# language: fr
Fonctionnalité: Revenus par abonnement — garde-fou déontologique
  La Chambre des notaires interdit le partage d'honoraires. Le modèle
  d'affaires de Nota repose sur l'abonnement, jamais sur une commission ou
  un pourcentage prélevé sur les honoraires. Ce scénario encode cette
  contrainte : le module de domaine ne doit exposer aucun concept de
  commission, de ristourne ni de pourcentage.

  Scénario: le domaine n'expose aucun concept de commission ou de pourcentage
    Quand j'inspecte les exports du module de domaine
    Alors aucun export ne ressemble à une commission ou à un pourcentage
    Et il n'existe pas d'export "commission"
    Et il n'existe pas d'export "cut"
    Et il n'existe pas d'export "percentage"
