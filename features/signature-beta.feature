# language: fr
Fonctionnalité: Exercice de signature vidéo Nota
  La bêta sert à essayer une séance vidéo et une confirmation cryptographique.
  Elle ne conclut aucun acte notarié et ne déclenche aucun paiement.

  Scénario: Le notaire contrôle la progression avec deux participants présents
    Étant donné un exercice de signature admis avec deux participants connectés
    Quand le client tente de libérer la signature de démonstration
    Alors la progression de l'exercice est refusée
    Quand le notaire révise puis libère la signature de démonstration
    Alors la confirmation du client est disponible dans l'exercice

  Scénario: La perte de présence interdit de signer
    Étant donné un exercice de signature admis avec deux participants connectés
    Quand la présence vidéo du client devient périmée
    Alors le notaire ne peut pas libérer la signature de démonstration

  Scénario: Le document signé reste explicitement sans effet juridique
    Alors le document d'exercice indique qu'il ne constitue pas un acte notarié
