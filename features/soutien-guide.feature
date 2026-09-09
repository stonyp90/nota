# language: fr
Fonctionnalité: Soutien guidé et limites de l’assistant
  Scénario: Une personne peut sortir de la discussion automatisée
    Alors le soutien transfère « Je veux parler à une personne. » pour « humain »
    Et le soutien transfère « Please connect me to an agent » pour « humain »

  Scénario: Les secrets ne sont pas destinés au modèle
    Alors le soutien transfère « NAS: 123-456-789 » pour « renseignements_sensibles »
    Et le soutien transfère « password: secret » pour « renseignements_sensibles »

  Scénario: Le soutien ne prétend pas agir sur un dossier
    Alors le soutien refuse la réponse « J’ai annulé votre demande. »
    Et le soutien refuse la réponse « Send your card number. »

  Scénario: Chaque sujet préparé possède une réponse bilingue ou un relais humain
    Alors chaque sujet du soutien reçoit une réponse préparée ou un relais sans appeler le modèle
