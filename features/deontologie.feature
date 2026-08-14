# language: fr
Fonctionnalité: Frontière déontologique du domaine
  La commission de la plateforme (part d'un acte complété) est une affaire de
  facturation, isolée dans la couche billing. Le module de DOMAINE — le calcul
  notarial : prix planchers, paliers, validation des offres — ne doit jamais
  exposer un concept de commission, de ristourne ni de pourcentage, afin que la
  logique des honoraires reste séparée du prélèvement de la plateforme.

  Scénario: le domaine n'expose aucun concept de commission ou de pourcentage
    Quand j'inspecte les exports du module de domaine
    Alors aucun export ne ressemble à une commission ou à un pourcentage
    Et il n'existe pas d'export "commission"
    Et il n'existe pas d'export "cut"
    Et il n'existe pas d'export "percentage"
