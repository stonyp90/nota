# language: fr
Fonctionnalité: Connexion — la boîte aux lettres est la seule preuve
  Personne n'a de mot de passe chez Nota. Un notaire comme un client demande un
  lien, et c'est la BOÎTE qui fait foi : le jeton porté par le lien envoyé est
  ce qui ouvre la session, rien d'autre. Ce lien vaut une capacité courte —
  à usage unique, périmée d'elle-même — et ce qu'il ouvre est étroitement borné :
  le notaire n'atteint que ses propres dossiers, le client que ses propres
  offres. L'horloge est figée au 2026-08-12 ; un scénario qui la fait avancer
  le dit.

  Scénario: le lien reçu par courriel est ce qui ouvre la console
    Étant donné un notaire actif "notaire@exemple.ca"
    Quand le notaire "notaire@exemple.ca" demande un lien de connexion
    Alors la réponse a le statut 200
    Et le notaire "notaire@exemple.ca" reçoit un courriel portant un lien de connexion
    Quand le notaire "notaire@exemple.ca" ouvre le lien reçu par courriel
    Alors la réponse a le statut 200
    Et la session ouvre la console du notaire "notaire@exemple.ca"

  Scénario: un lien de connexion ne s'ouvre qu'une fois
    Étant donné un notaire actif "notaire@exemple.ca"
    Et le notaire "notaire@exemple.ca" demande un lien de connexion
    Et le notaire "notaire@exemple.ca" reçoit un courriel portant un lien de connexion
    Et le notaire "notaire@exemple.ca" ouvre le lien reçu par courriel
    Quand le notaire "notaire@exemple.ca" ouvre une seconde fois le même lien
    Alors la réponse a le statut 401
    Et la réponse contient le code d'erreur "lien_invalide"

  Scénario: un lien de connexion périmé ne vaut plus rien
    Étant donné un notaire actif "notaire@exemple.ca"
    Et le notaire "notaire@exemple.ca" demande un lien de connexion
    Et le notaire "notaire@exemple.ca" reçoit un courriel portant un lien de connexion
    Quand l'horloge dépasse l'échéance portée par le lien du notaire "notaire@exemple.ca"
    Et le notaire "notaire@exemple.ca" ouvre le lien reçu par courriel
    Alors la réponse a le statut 401
    Et la réponse contient le code d'erreur "lien_invalide"

  Scénario: la session d'un notaire n'atteint pas le travail d'un autre
    Étant donné un notaire actif "premier@exemple.ca"
    Et un notaire actif "second@exemple.ca"
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2500 dans 10 jours
    Et le notaire "premier@exemple.ca" retient l'offre
    Quand le notaire "second@exemple.ca" écrit "Bonjour, je reprends ce dossier."
    Alors la réponse a le statut 403
    Et la réponse contient le code d'erreur "interdit"
    Et le fil du notaire "premier@exemple.ca" montre 1 dossier retenu
    Et le fil du notaire "second@exemple.ca" montre 0 dossier retenu
    Et le fil du notaire "second@exemple.ca" ne nomme pas le client "client@exemple.ca"

  Scénario: le lien d'un client ouvre ses offres, et seulement les siennes
    Étant donné le client "un@exemple.ca" a publié une offre pour "refinancement" à 2500 dans 10 jours
    Et le client "deux@exemple.ca" a publié une offre pour "refinancement" à 2600 dans 12 jours
    Quand le client "un@exemple.ca" demande un lien vers son espace
    Alors la réponse a le statut 200
    Et le client "un@exemple.ca" reçoit un courriel portant un lien vers son espace
    Quand le client "un@exemple.ca" ouvre le lien reçu par courriel
    Alors la réponse a le statut 200
    Et l'espace de "un@exemple.ca" ne contient que ses propres offres
    Et le jeton d'espace de "un@exemple.ca" ouvre sa propre offre
    Et le jeton d'espace de "un@exemple.ca" est refusé sur l'offre de "deux@exemple.ca"

  Scénario: un lien vers l'espace client ne s'ouvre qu'une fois
    Étant donné le client "un@exemple.ca" a publié une offre pour "refinancement" à 2500 dans 10 jours
    Et le client "un@exemple.ca" demande un lien vers son espace
    Et le client "un@exemple.ca" reçoit un courriel portant un lien vers son espace
    Et le client "un@exemple.ca" ouvre le lien reçu par courriel
    Quand le client "un@exemple.ca" ouvre une seconde fois le même lien
    Alors la réponse a le statut 401
    Et la réponse contient le code d'erreur "lien_invalide"
