# language: fr
Fonctionnalité: L'accès payant à la préparation IA du notaire (ADR 0049)
  La préparation assistée par l'IA est un produit VENDU AU NOTAIRE, distinct
  de la place de marché. Elle ne s'ouvre jamais toute seule : un notaire
  s'inscrit à la bêta, reçoit un nombre d'essais compté à vie, puis choisit
  une formule. Le quota vit dans le domaine, le refus arrive AVANT tout appel
  au modèle, et rien de tout cela ne se voit du côté du client : ce qu'il paie
  pour son acte ne dépend pas de l'outillage de son notaire.

  Scénario: la bêta ne s'ouvre pas toute seule
    Étant donné l'accès IA payant est activé sur ce déploiement
    Et un notaire actif "notaire@exemple.ca"
    Quand le notaire "notaire@exemple.ca" consulte son accès IA
    Alors l'accès IA est fermé, motif "beta_non_inscrite"
    Et aucun essai de bêta n'est entamé
    Et le barème d'accès annonce les formules du domaine

  Scénario: l'inscription donne exactement les essais que le domaine documente
    Étant donné l'accès IA payant est activé sur ce déploiement
    Et un notaire actif "notaire@exemple.ca"
    Quand le notaire "notaire@exemple.ca" s'inscrit à la bêta IA
    Alors l'accès IA est ouvert, motif "essais_beta"
    Et il reste 5 essais de bêta
    Et ce nombre est celui que le domaine documente

  Scénario: l'essai de trop est refusé, et se réinscrire ne remet rien à zéro
    Étant donné l'accès IA payant est activé sur ce déploiement
    Et un notaire actif "notaire@exemple.ca"
    Et le notaire "notaire@exemple.ca" a retenu une demande de refinancement
    Et le notaire "notaire@exemple.ca" s'inscrit à la bêta IA
    Quand le notaire "notaire@exemple.ca" épuise ses essais de préparation
    Alors il reste 0 essai de bêta
    Et le modèle n'a été appelé que 5 fois
    Quand le notaire "notaire@exemple.ca" prépare le dossier avec l'IA
    Alors la réponse a le statut 402
    # Le refus dit la vérité au notaire : son quota est épuisé. On ne l'invite
    # pas à s'inscrire à une bêta où il est déjà, et le modèle n'est pas appelé.
    Et le refus IA porte le motif "quota_epuise" et son message
    Et le modèle n'a été appelé que 5 fois
    Quand le notaire "notaire@exemple.ca" consulte son accès IA
    Alors l'accès IA est fermé, motif "quota_epuise"
    Quand le notaire "notaire@exemple.ca" s'inscrit à la bêta IA
    Alors il reste 0 essai de bêta

  Scénario: une formule rouvre la porte que le quota avait fermée
    Étant donné l'accès IA payant est activé sur ce déploiement
    Et un notaire actif "notaire@exemple.ca"
    Et le notaire "notaire@exemple.ca" a retenu une demande de refinancement
    Et le notaire "notaire@exemple.ca" s'inscrit à la bêta IA
    Et le notaire "notaire@exemple.ca" épuise ses essais de préparation
    Quand le notaire "notaire@exemple.ca" choisit la formule "essentiel"
    Alors la réponse a le statut 200
    Et le notaire est envoyé payer chez Stripe pour la formule "essentiel"
    Quand Stripe confirme la formule "essentiel" pour "notaire@exemple.ca"
    Et le notaire "notaire@exemple.ca" consulte son accès IA
    Alors l'accès IA est ouvert, motif "abonnement"
    Et la formule laisse 20 préparations incluses
    Quand le notaire "notaire@exemple.ca" prépare le dossier avec l'IA
    Alors la réponse a le statut 200
    Et la formule laisse 19 préparations incluses

  # Le prix d'un acte se décide entre le client et la date. Ce que le notaire
  # dépense pour s'outiller ne s'y ajoute jamais — et ne se devine même pas.
  Scénario: ce que le notaire paie pour l'IA ne touche pas le prix du client
    Étant donné l'accès IA payant est activé sur ce déploiement
    Et un notaire actif "notaire@exemple.ca"
    Et le notaire "notaire@exemple.ca" a retenu une demande de refinancement
    Et un client publie une demande de refinancement à 2500 $ dans 30 jours
    Et je note ce que le client voit de sa demande
    Quand le notaire "notaire@exemple.ca" s'inscrit à la bêta IA
    Et le notaire "notaire@exemple.ca" épuise ses essais de préparation
    Et Stripe confirme la formule "essentiel" pour "notaire@exemple.ca"
    Alors ce que le client voit de sa demande n'a pas changé
    Et aucune formule IA n'apparaît dans ce que le client voit
