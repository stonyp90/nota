# language: fr
Fonctionnalité: Messagerie en direct — une question tombe live chez l'opérateur
  Un visiteur avec une question ouvre la messagerie du site : chaque message
  lui vaut une réponse en direct. Le premier message crée le fil et son jeton ;
  chaque question part immédiatement par courriel à l'opérateur, avec un lien
  de réponse signé — la réponse atterrit dans le fil (que le widget interroge)
  et, si le visiteur a laissé un courriel, dans sa boîte aussi. Les portées de
  jetons sont étanches : un jeton visiteur ne parle jamais au nom de Nota.

  Scénario: la première question crée le fil et courrielle l'opérateur en direct
    Quand un visiteur écrit "Un refinancement se signe-t-il en soirée ?" à la messagerie
    Alors la réponse a le statut 201
    Et l'opérateur reçoit le courriel "messagerie : nouvelle question"
    Et le courriel de l'opérateur porte un lien de réponse signé
    Et le fil de la messagerie compte 1 message

  Scénario: la réponse de l'opérateur atterrit en direct dans le fil
    Quand un visiteur écrit "Vos frais incluent-ils la quittance ?" à la messagerie
    Et l'opérateur répond "Oui — la quittance est incluse." par son lien
    Alors le fil de la messagerie compte 2 messages
    Et le dernier message du fil vient de "nota"

  Scénario: un courriel laissé reçoit copie de la réponse
    Quand un visiteur écrit "Pouvez-vous me rappeler ?" à la messagerie en laissant le courriel "curieux@exemple.ca"
    Et l'opérateur répond "Bien sûr." par son lien
    Alors le client "curieux@exemple.ca" reçoit le courriel "messagerie : réponse de Nota"

  Scénario: sans courriel laissé, la réponse ne part que dans le fil
    Quand un visiteur écrit "Allo ?" à la messagerie
    Et l'opérateur répond "Bonjour !" par son lien
    Alors aucun courriel n'est envoyé sauf à l'opérateur

  Scénario: un jeton visiteur ne parle jamais au nom de Nota
    Quand un visiteur écrit "Allo ?" à la messagerie
    Et le visiteur tente de répondre par son propre jeton
    Alors la réponse a le statut 401

  Scénario: un message vide est refusé par le domaine
    Quand un visiteur écrit "   " à la messagerie
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "message_requis"

  Scénario: la boîte de l'opérateur liste chaque fil avec son statut
    Quand un visiteur écrit "Faites-vous les subrogations ?" à la messagerie
    Alors la boîte de soutien liste 1 fil au statut "a_repondre"
    Quand l'opérateur répond "Oui, dès la semaine prochaine." par son lien
    Alors la boîte de soutien liste 1 fil au statut "repondu"

  Scénario: un message « Nous joindre » entre dans la même boîte, et son auteur peut suivre la réponse
    Quand un client envoie "Pouvez-vous me rappeler demain ?" par le formulaire Nous joindre avec le courriel "eve@exemple.ca"
    Alors la boîte de soutien liste 1 fil au statut "a_repondre"
    Et le fil de la messagerie compte 1 message
