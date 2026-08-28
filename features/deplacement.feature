# language: fr
Fonctionnalité: Le déplacement — la signature en personne dans un périmètre déclaré
  L'acte se signe en personne : quelqu'un se déplace — le client vers l'étude,
  ou le notaire chez le client. La bande de déplacement est un levier de prix
  dans les deux sens : le client le plus mobile est la base (le « à partir de »
  affiché), et le prix monte avec les kilomètres demandés au notaire. Une
  urgence est déclarée, jamais implicite : elle se signe 100 % en ligne, porte
  la prime la plus ferme, et n'atteint que les notaires qui l'acceptent.
  Le catalogue des bandes vit dans le domaine ; chaque offre doit déclarer la
  sienne, et le fil du notaire ne montre que ce que son profil peut servir.

  Scénario: le catalogue compte six bandes, du client mobile à l'urgence en ligne
    Alors le catalogue des déplacements compte 6 bandes
    Et la bande "client_50" est la base sans majoration
    Et la bande "urgence_en_ligne" porte la prime la plus ferme, à 400 $

  Scénario: la bande déclarée majore le prix de base
    Alors le prix de base "refinancement" avec le déplacement "urgence_en_ligne" est 2400
    Et le prix de base "refinancement" avec le déplacement "notaire_50" est 2250
    Et le prix de base "refinancement" avec le déplacement "client_50" est 2000

  Scénario: une offre sans déplacement déclaré est bloquée
    Étant donné le service "refinancement"
    Quand je valide une offre à 2500 $ sans déclarer de déplacement
    Alors l'offre est refusée
    Et l'erreur "parametre_requis" est présente

  Scénario: un notaire sans profil ne voit que les clients qui se déplacent
    Étant donné un notaire sans profil de déplacement
    Alors le notaire peut servir la bande "client_50"
    Et le notaire peut servir la bande "client_25"
    Et le notaire peut servir la bande "client_10"
    Et le notaire ne peut pas servir la bande "notaire_25"
    Et le notaire ne peut pas servir la bande "notaire_50"
    Et le notaire ne peut pas servir la bande "urgence_en_ligne"

  Scénario: un rayon de 50 km couvre chaque bande où le notaire se déplace
    Étant donné un notaire au rayon de 50 km
    Alors le notaire peut servir la bande "notaire_25"
    Et le notaire peut servir la bande "notaire_50"

  Scénario: l'urgence exige l'adhésion explicite — le rayon n'y donne rien
    Étant donné un notaire au rayon de 50 km
    Alors le notaire ne peut pas servir la bande "urgence_en_ligne"
    Quand le notaire accepte les urgences en ligne
    Alors le notaire peut servir la bande "urgence_en_ligne"

  Scénario: une offre d'avant la question atteint tout le monde
    Étant donné un notaire sans profil de déplacement
    Alors le notaire peut servir une offre sans bande déclarée

  Scénario: le profil refuse un rayon hors des bandes déclarées
    Quand un notaire déclare un rayon de "12" km
    Alors le profil est refusé avec l'erreur "rayon_invalide"

  Scénario: le rayon saisi en chaîne de formulaire devient un nombre
    Quand un notaire déclare un rayon de "25" km
    Alors le profil retient un rayon de 25 km

  # --- La distance mesurée (ADR 0025) ----------------------------------------
  # Chaque offre porte son secteur postal (ADR 0024) et le notaire peut
  # déclarer celui de son étude : quand les deux sont connus, la distance
  # réelle décide — sinon, les règles déclaratives ci-dessus s'appliquent.

  Scénario: la distance mesurée remplace la règle déclarative
    # Sainte-Foy (G1V) ↔ Vieux-Québec (G1R) : ± 6 km.
    Alors la distance entre les secteurs "G1V" et "G1R" est d'environ 6 km
    # Un notaire au rayon de 25 km, l'étude à Sainte-Foy : une demande
    # « notaire_50 » à 6 km est servable — la règle déclarative (rayon 25 <
    # bande 50) l'aurait caché à tort.
    Étant donné un notaire au rayon de 25 km dont l'étude est au secteur "G1V"
    Alors le notaire peut servir la bande "notaire_50" pour un client au secteur "G1R"
    Mais le notaire ne peut pas servir la bande "notaire_50" pour un client au secteur "G9Z"

  Scénario: un client peu mobile n'atteint pas une étude trop lointaine
    # Saint-Augustin (G3A) ↔ Vieux-Québec (G1R) : ± 20 km ; le client ne se
    # déplace que 10 km — cette étude est hors de sa portée.
    Étant donné un notaire au rayon de 0 km dont l'étude est au secteur "G1R"
    Alors le notaire ne peut pas servir la bande "client_10" pour un client au secteur "G3A"
    Mais le notaire peut servir la bande "client_10" pour un client au secteur "G1K"

  Scénario: sans secteur d'étude, les règles déclaratives demeurent
    Étant donné un notaire au rayon de 25 km
    Alors le notaire ne peut pas servir la bande "notaire_50" pour un client au secteur "G1R"

  Scénario: le profil refuse un secteur d'étude mal formé
    Quand un notaire déclare le secteur d'étude "123"
    Alors le profil est refusé avec l'erreur "prefixe_invalide"

  Scénario: le secteur d'étude est normalisé comme celui des offres
    Quand un notaire déclare le secteur d'étude " g1v "
    Alors le profil retient le secteur d'étude "G1V"
