# language: fr
Fonctionnalité: Les documents voyagent dans la conversation, Nota n'est que dépositaire (ADR 0032)
  Une pièce ne circule qu'entre les deux personnes de l'acte retenu : le
  client qui a publié la demande et le notaire qui l'a retenue. Les octets ne
  traversent jamais l'API — le navigateur parle au dépôt par une autorisation
  brève — et l'endroit où ils vivent est DÉRIVÉ de l'acte, jamais choisi par
  l'appelant ni rendu par une porte publique. Une pièce annoncée n'est pas une
  pièce reçue : elle n'existe pour l'autre partie qu'une fois le dépôt
  constaté. Et quand la relation meurt, les octets meurent avec elle.

  Scénario: la pièce n'existe pour l'autre partie qu'une fois le dépôt constaté
    Étant donné Nota tient un dépôt de documents
    Et un notaire actif "notaire@exemple.ca"
    Et un acte de refinancement retenu par "notaire@exemple.ca"
    Quand le client propose la pièce "relevé.pdf" de type "application/pdf"
    Alors la réponse a le statut 200
    Et l'autorisation de dépôt est brève et porte sur cette pièce
    Et la pièce n'existe pas encore pour l'autre partie
    Quand le client affirme avoir téléversé sans l'avoir fait
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "depot_absent"
    Et la pièce n'existe pas encore pour l'autre partie
    Quand le navigateur du client dépose vraiment les octets
    Et le client confirme le dépôt
    Alors la réponse a le statut 200
    Et la pièce est prête des deux côtés

  Scénario: le notaire dépose aussi, par la porte symétrique
    Étant donné Nota tient un dépôt de documents
    Et un notaire actif "notaire@exemple.ca"
    Et un acte de refinancement retenu par "notaire@exemple.ca"
    Quand le notaire "notaire@exemple.ca" propose la pièce "projet-acte.pdf"
    Alors la réponse a le statut 200
    Et la pièce vient du notaire
    Quand le navigateur du notaire dépose vraiment les octets
    Et le notaire "notaire@exemple.ca" confirme le dépôt
    Alors la réponse a le statut 200
    Et la pièce est prête des deux côtés

  Scénario: un format refusé l'est avant qu'aucune autorisation ne soit émise
    Étant donné Nota tient un dépôt de documents
    Et un notaire actif "notaire@exemple.ca"
    Et un acte de refinancement retenu par "notaire@exemple.ca"
    Quand le client propose la pièce "acte.exe" de type "application/octet-stream"
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "format_refuse"
    Et aucune autorisation de dépôt n'est émise

  Scénario: les octets vivent à une clé dérivée de l'acte, que personne ne choisit ni ne lit
    Étant donné Nota tient un dépôt de documents
    Et un notaire actif "notaire@exemple.ca"
    Et un acte de refinancement retenu par "notaire@exemple.ca"
    Quand le client propose la pièce "relevé.pdf" de type "application/pdf"
    Et le navigateur du client dépose vraiment les octets
    Et le client confirme le dépôt
    Alors la clé des octets est dérivée de l'acte par le domaine
    Et la clé des octets ne porte pas le nom du fichier
    Et aucune porte publique ne rend la clé des octets

  Scénario: un appelant qui choisit lui-même sa clé n'obtient que celle du domaine
    Étant donné Nota tient un dépôt de documents
    Et un notaire actif "notaire@exemple.ca"
    Et un acte de refinancement retenu par "notaire@exemple.ca"
    Quand le client propose la pièce "relevé.pdf" en dictant la clé "../../public/evade"
    Alors la réponse a le statut 200
    Et la clé des octets est dérivée de l'acte par le domaine
    Et la clé des octets ne remonte hors du dossier de l'acte

  Scénario: les deux parties lisent la pièce, un tiers n'entre pas
    Étant donné Nota tient un dépôt de documents
    Et un notaire actif "notaire@exemple.ca"
    Et un notaire actif "voisin@exemple.ca"
    Et un acte de refinancement retenu par "notaire@exemple.ca"
    Et une pièce déposée par le client
    Alors le client peut lire la pièce
    Et le notaire "notaire@exemple.ca" peut lire la pièce
    Quand le notaire "voisin@exemple.ca" tente de lire la pièce
    Alors la réponse a le statut 403
    Quand le notaire "voisin@exemple.ca" tente de déposer une pièce sur cet acte
    Alors la réponse a le statut 403
    Quand un visiteur sans jeton tente de lire la pièce
    Alors la réponse a le statut 401

  # ART. 37 — la conversation meurt avec la relation : le fil est vidé ET les
  # octets sont effacés. Laisser derrière soi des pièces que plus personne ne
  # peut atteindre serait un risque sans contrepartie.
  Scénario: le désistement du notaire emporte le fil et les octets
    Étant donné Nota tient un dépôt de documents
    Et un notaire actif "notaire@exemple.ca"
    Et un acte de refinancement retenu par "notaire@exemple.ca"
    Et une pièce déposée par le client
    Alors les octets sont bien dans le dépôt
    Quand le notaire "notaire@exemple.ca" rend l'acte au carnet
    Alors la réponse a le statut 200
    Et le fil de l'acte ne porte plus aucune pièce
    Et les octets ne sont plus dans le dépôt
    Quand le client tente de relire la pièce
    Alors la réponse a le statut 404

  # L'AUTRE porte de sortie de l'acte : l'annulation par le client. L'accès se
  # fermait déjà (410), mais les pièces — celles du client ET celles du
  # notaire — survivaient dans le seau et leurs références restaient sur
  # l'offre. Nota est dépositaire, pas propriétaire : quand l'acte meurt, il ne
  # garde rien, quel que soit le côté qui y a mis fin.
  Scénario: l'annulation par le client emporte les octets, des deux côtés
    Étant donné Nota tient un dépôt de documents
    Et un notaire actif "notaire@exemple.ca"
    Et un acte de refinancement retenu par "notaire@exemple.ca"
    Et une pièce déposée par le client
    Et une pièce déposée par le notaire "notaire@exemple.ca"
    Alors les octets des deux pièces sont bien dans le dépôt
    Quand le client annule l'acte
    Alors la réponse a le statut 200
    Et l'acte annulé ne porte plus aucune pièce
    Et les octets des deux pièces ne sont plus dans le dépôt
    Quand le client tente de relire la pièce
    Alors la réponse a le statut 410

  # Un déploiement sans dépôt garde la messagerie texte et ferme la porte des
  # pièces proprement — jamais une adresse inventée sur laquelle un client
  # téléverserait quinze mégaoctets pour rien.
  Scénario: sans dépôt configuré, la porte se ferme en disant quoi faire
    Étant donné un notaire actif "notaire@exemple.ca"
    Et un acte de refinancement retenu par "notaire@exemple.ca"
    Quand le client propose la pièce "relevé.pdf" de type "application/pdf"
    Alors la réponse a le statut 503
    Et la réponse contient le code d'erreur "stockage_indisponible"
    Et le refus nomme le canal qui reste ouvert
