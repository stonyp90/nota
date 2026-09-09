# language: fr
Fonctionnalité: La messagerie répond d'abord, et n'escalade que le reste
  ADR 0046. La demande du propriétaire tenait en une phrase : « répondez tout
  de suite à ce qu'on sait répondre, et escaladez-moi le reste par courriel ».
  Les deux moitiés de cette phrase peuvent silencieusement se manger l'une
  l'autre — un assistant trop confiant qui répond à tout, ou un assistant trop
  prudent qui n'allège rien — et c'est pourquoi elles sont tenues ici ensemble,
  sur le vrai chemin HTTP.

  Ce qui est vérifié n'est jamais la qualité d'une réponse : c'est ce que le
  SYSTÈME fait d'une réponse donnée. Le scénario dicte ce que le modèle rend ;
  le reste — le fil, le statut, le courriel, le garde-fou — est le code réel.

  L'horloge est figée au 2026-08-12.

  Contexte:
    Étant donné que la messagerie a un assistant

  # La moitié qui allège : une question que le catalogue fonde ne doit RIEN
  # coûter à l'opérateur. C'était le cas le plus fréquent, et c'était celui qui
  # réveillait quelqu'un.
  Scénario: une question couverte reçoit sa réponse et ne réveille personne
    Étant donné que l'assistant sait répondre "Le prix affiché est le total : les honoraires du notaire et le service de Nota."
    Quand un visiteur écrit "Le prix comprend quoi ?" dans la messagerie
    Alors le visiteur reçoit une réponse tout de suite
    Et la réponse est signée par l'assistant, pas par une personne
    Et l'opérateur ne reçoit aucun courriel

  # La moitié qui protège. « Où en est mon dossier ? » ne peut être fondé par
  # aucune fiche : l'assistant n'a ni jeton client, ni accès au carnet.
  Scénario: une question qu'aucune fiche ne fonde part à l'opérateur, avec le fil
    Étant donné que l'assistant passe la main pour le motif "dossier_precis"
    Quand un visiteur écrit "Où en est mon dossier 4821 ?" dans la messagerie
    Alors le visiteur est prévenu qu'une personne reprend la question
    Et l'opérateur reçoit un courriel d'escalade
    Et le courriel porte la question du visiteur
    Et le courriel porte un lien de réponse signé

  # L'invariant qui protège la boîte du propriétaire : une machine ne classe pas
  # le travail de quelqu'un d'autre.
  Scénario: un fil escaladé attend une PERSONNE, quoi que l'assistant ait écrit
    Étant donné que l'assistant passe la main pour le motif "plainte"
    Quand un visiteur écrit "Je suis très mécontent du service." dans la messagerie
    Alors le fil de soutien reste "à répondre"
    Et le fil est marqué comme escaladé

  # Le garde-fou du domaine tourne APRÈS le modèle. Ce qu'il refuse n'est pas
  # corrigé : c'est jeté, et l'humain reprend. Le conseil juridique est la
  # ligne que Nota ne peut pas franchir — elle n'est pas notaire.
  Scénario: une réponse qui conseille ne sort jamais du serveur
    Étant donné que l'assistant sait répondre "Vous devriez signer avant la fin du mois pour éviter des frais."
    Quand un visiteur écrit "Je fais quoi ?" dans la messagerie
    Alors la réponse envoyée au visiteur ne contient pas "vous devriez"
    Et l'opérateur reçoit un courriel d'escalade

  # ADR 0042 — le prix annoncé est un total. Le mot « taux » a été banni des
  # surfaces client ; une machine qui rédige est ce qui le ferait revenir.
  Scénario: une réponse qui nomme un taux ne sort jamais du serveur
    Étant donné que l'assistant sait répondre "Le taux d'annulation est de 30 % du montant."
    Quand un visiteur écrit "Expliquez les conditions d’annulation en détail." dans la messagerie
    Alors la réponse envoyée au visiteur ne contient pas "taux"
    Et l'opérateur reçoit un courriel d'escalade

  # ART. 70 C.déont. — « Le notaire ne peut utiliser ou permettre que soit
  # utilisé un témoignage d'appui ou de reconnaissance qui le concerne. »
  # L'ADR 0030 l'a tenu sur le site ; il tient aussi sur ce qu'une machine écrit.
  Scénario: une réponse qui publie la cote d'un notaire nommé ne sort jamais — art. 70
    Étant donné que l'assistant sait répondre "Me Roy a une cote de 94 sur 100, c'est notre meilleur."
    Quand un visiteur écrit "Qui est votre meilleur notaire ?" dans la messagerie
    Alors la réponse envoyée au visiteur ne contient pas "94"
    Et l'opérateur reçoit un courriel d'escalade

  # Une panne du modèle est le cas où un visiteur pourrait rester sans réponse
  # ET sans que personne ne le sache. Il ne doit pas exister.
  Scénario: une panne du modèle escalade au lieu de perdre la question
    Étant donné que l'assistant est en panne
    Quand un visiteur écrit "Bonjour, une question ?" dans la messagerie
    Alors le visiteur est prévenu qu'une personne reprend la question
    Et l'opérateur reçoit un courriel d'escalade

  # Sans clé, le produit doit se comporter EXACTEMENT comme avant l'ADR 0046 :
  # une clé absente dégrade, elle ne casse pas — et l'état non configuré est
  # celui de tout déploiement qui n'a rien demandé.
  Scénario: sans assistant configuré, chaque question part à l'opérateur comme avant
    Étant donné que la messagerie n'a pas d'assistant
    Quand un visiteur écrit "Le prix comprend quoi ?" dans la messagerie
    Alors le fil de soutien ne porte qu'un seul message
    Et l'opérateur reçoit un courriel

  # L'invariant central de l'ADR : la connaissance est CALCULÉE. Si l'invite du
  # modèle cessait de suivre le catalogue, l'assistant se mettrait à citer des
  # prix périmés sans que rien ne casse — sauf ceci.
  Scénario: ce que le modèle reçoit porte les prix VIVANTS du catalogue
    Étant donné que l'assistant sait répondre "Bonjour."
    Quand un visiteur écrit "Pouvez-vous expliquer le calcul du prix ?" dans la messagerie
    Alors l'invite du modèle porte le prix annoncé de chaque service
    Et l'invite du modèle nomme la personne qui reprend la main
    Et l'invite du modèle interdit de conseiller

  Scénario: une question préparée reçoit une réponse même si le modèle est en panne
    Étant donné que l'assistant est en panne
    Quand un visiteur écrit "Comment ça marche ?" dans la messagerie
    Alors le visiteur reçoit une réponse tout de suite
    Et la réponse est signée par l'assistant, pas par une personne
    Et l'opérateur ne reçoit aucun courriel
