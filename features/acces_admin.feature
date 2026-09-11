# language: fr
Fonctionnalité: Accès à la console d'administration
  La console d'administration est la seule surface où Nota voit ses clients en
  clair, relit son journal et écrit à sa liste. Ce qui la tient n'est pas un
  rôle mais une PERMISSION, accordée clé par clé : une porte gardée par
  « leads:read » ne s'ouvre pas parce qu'on détient « analytics:read », et
  aucune clé n'en appelle une autre — lire le dossier d'une personne ne donne
  pas le droit de l'effacer, rédiger un gabarit ne donne pas le droit de
  l'envoyer à mille adresses.

  La session, elle, est la moitié serveur d'un jeton signé : l'échange du lien
  de courriel la délivre, et un jeton périmé, retouché ou de mauvaise portée ne
  vaut rien. Chaque refus est un refus FRANC — le statut documenté, un code
  d'erreur, et rien d'autre : une porte fermée ne doit jamais se lire comme une
  réponse vide et réussie.

  # --- 1. Une permission garde vraiment sa porte ----------------------------

  Plan du Scénario: une opératrice qui ne détient que « analytics:read » est refusée
    Étant donné une opératrice "analyste@nota.ca" qui détient "analytics:read"
    Quand "analyste@nota.ca" ouvre "<porte>"
    Alors la console refuse avec le statut 403 et le code "interdit"
    Et le refus ne livre aucune donnée

    Exemples:
      | porte                            |
      | GET /admin/crm/leads             |
      | GET /admin/audit?jour=2026-08-12 |
      | GET /admin/notaries              |

  Plan du Scénario: l'administratrice principale franchit les mêmes portes
    Étant donné une administratrice principale "patronne@nota.ca"
    Quand "patronne@nota.ca" ouvre "<porte>"
    Alors la console répond avec le statut 200
    Et la réponse de la console porte "<donnée>"

    Exemples:
      | porte                            | donnée   |
      | GET /admin/crm/leads             | leads    |
      | GET /admin/audit?jour=2026-08-12 | entrees  |
      | GET /admin/notaries              | notaires |

  # Le refus ci-dessus n'est pas « elle ne peut rien » : la clé qu'elle détient
  # ouvre exactement ce qu'elle nomme, et pas un pouce de plus.
  Scénario: la clé détenue ouvre sa propre porte
    Étant donné une opératrice "analyste@nota.ca" qui détient "analytics:read"
    Quand "analyste@nota.ca" ouvre "GET /admin/metrics/overview"
    Alors la console répond avec le statut 200
    Et la réponse de la console porte "kpis"

  # --- 2. Aucune permission n'en implique une autre -------------------------

  Scénario: « subjects:read » ouvre le dossier d'une personne, jamais son effacement
    Étant donné une opératrice "archiviste@nota.ca" qui détient "subjects:read"
    Quand "archiviste@nota.ca" ouvre "GET /admin/usagers/cliente%40example.com"
    Alors la console répond avec le statut 200
    Quand "archiviste@nota.ca" envoie "POST /admin/usagers/cliente%40example.com/effacement" avec le corps:
      """
      { "confirmer": true }
      """
    Alors la console refuse avec le statut 403 et le code "interdit"
    Et le refus ne livre aucune donnée

  Scénario: « notifications:write » rédige le gabarit, jamais l'envoi à la liste
    Étant donné une opératrice "redactrice@nota.ca" qui détient "notifications:write"
    Quand "redactrice@nota.ca" envoie "PUT /admin/notifications/templates/offerPublished" avec le corps:
      """
      { "subjectFr": "Votre offre", "subjectEn": "Your offer" }
      """
    Alors la console répond avec le statut 200
    Quand "redactrice@nota.ca" envoie "POST /admin/campaigns" avec le corps:
      """
      { "audience": { "type": "segment", "id": "clients" }, "templateKey": "offerPublished" }
      """
    Alors la console refuse avec le statut 403 et le code "interdit"
    Et le refus ne livre aucune donnée

  # --- 3. Le cycle de vie de la session -------------------------------------

  Scénario: l'échange du lien de courriel délivre une session qui ouvre la console
    Étant donné une administratrice principale "patronne@nota.ca"
    Alors le lien de courriel de "patronne@nota.ca" a été échangé contre un jeton de session
    Quand "patronne@nota.ca" ouvre "GET /admin/me"
    Alors la console répond avec le statut 200
    Et la console reconnaît "patronne@nota.ca"

  Scénario: une session qui a dormi au-delà de sa fenêtre d'inactivité ne rouvre rien
    Étant donné une administratrice principale "patronne@nota.ca"
    Quand 31 minutes s'écoulent sans la moindre requête
    Et "patronne@nota.ca" ouvre "GET /admin/crm/leads"
    Alors la console refuse avec le statut 401 et le code "non_autorise"
    Et le refus ne livre aucune donnée

  Scénario: un jeton retouché d'un seul caractère ne vaut rien
    Étant donné une administratrice principale "patronne@nota.ca"
    Quand le jeton de session de "patronne@nota.ca" est retouché
    Et "patronne@nota.ca" ouvre "GET /admin/crm/leads"
    Alors la console refuse avec le statut 401 et le code "non_autorise"
    Et le refus ne livre aucune donnée

  Scénario: le jeton du lien de courriel n'est pas un jeton de session
    Étant donné une administratrice principale "patronne@nota.ca"
    Quand "patronne@nota.ca" présente le jeton de son lien de courriel au lieu de sa session
    Et "patronne@nota.ca" ouvre "GET /admin/notaries"
    Alors la console refuse avec le statut 401 et le code "non_autorise"
    Et le refus ne livre aucune donnée

  Scénario: sans aucun jeton, la console ne répond rien d'autre qu'un refus
    Quand un inconnu ouvre "GET /admin/audit?jour=2026-08-12"
    Alors la console refuse avec le statut 401 et le code "non_autorise"
    Et le refus ne livre aucune donnée

  # --- 4. Un refus laisse une trace (ADR 0036, amendement du 2026-09-11) -----
  # Trouvé par l'audit BDD du 11 septembre : les trois refus du premier plan
  # ci-dessus ne laissaient RIEN dans le journal — seulement « login_requested »
  # et « login_success ». La console écrivait sur chaque lecture sensible
  # RÉUSSIE et sur aucun 403 : quelqu'un qui sonde les portes des dossiers
  # était invisible au registre même qui existe pour rendre un accès
  # reprochable. Le journal se relit ici par la vraie porte du dépôt, jamais
  # par une entrée que le scénario aurait écrite lui-même.
  Scénario: un accès refusé laisse une trace
    Étant donné une opératrice "analyste@nota.ca" qui détient "analytics:read"
    Quand "analyste@nota.ca" ouvre "GET /admin/usagers/cliente%40example.com"
    Alors la console refuse avec le statut 403 et le code "interdit"
    Et le refus ne livre aucune donnée
    Et le journal porte une seule trace "acces_refuse", signée par l'opératrice "analyste@nota.ca"
    Et cette trace nomme la porte "getUserFile" et la permission manquante "subjects:read"
    Et cette trace nomme le sujet par son empreinte, jamais par l'adresse "cliente@example.com"
    Quand "analyste@nota.ca" ouvre "GET /admin/notaries"
    Et "analyste@nota.ca" ouvre "GET /admin/crm/leads"
    Alors les traces "acces_refuse" du jour nomment, dans l'ordre, les portes "getUserFile, listNotaries, listCrmLeads"
    Et les traces "acces_refuse" du jour nomment, dans l'ordre, les permissions "subjects:read, pii:read, leads:read"

  # Le contre-essai : la trace dit « refusé », pas « a frappé à la porte ».
  Scénario: un accès accordé ne laisse aucune trace de refus
    Étant donné une administratrice principale "patronne@nota.ca"
    Quand "patronne@nota.ca" ouvre "GET /admin/usagers/cliente%40example.com"
    Et "patronne@nota.ca" ouvre "GET /admin/notaries"
    Et "patronne@nota.ca" ouvre "GET /admin/crm/leads"
    Alors la console répond avec le statut 200
    Et le journal du jour ne porte aucune trace "acces_refuse"
