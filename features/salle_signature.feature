# language: fr
Fonctionnalité: La salle de signature à distance
  Une séance de signature à distance est une CÉRÉMONIE, et non un formulaire
  avec une fenêtre vidéo à côté. Le notaire la conduit, il voit et entend la
  personne et il en est vu et entendu, et ce qui s'est passé laisse une trace
  qu'un tiers peut vérifier sans avoir à croire Nota sur parole.

  Le partage est le suivant, et il ne bouge pas : la cérémonie est de Nota, la
  signature juridique est du fournisseur admis par la Chambre des notaires, la
  preuve est de Nota et elle est remise au notaire. Aucun scénario ici ne
  prétend à une approbation que Nota n'a pas.

  Ces scénarios pilotent les VRAIES routes de l'API, avec une horloge que le
  scénario avance lui-même : la continuité se mesure en secondes, et une suite
  qui dort vraiment dix secondes ne se relit pas.

  Contexte:
    Étant donné une offre retenue pour une séance de signature

  # --- Le lien privé --------------------------------------------------------
  # Le média passe de pair à pair, chiffré par DTLS-SRTP. Il n'y a pas de
  # serveur au milieu qui déchiffrerait, donc il n'y a pas non plus de case à
  # cocher qu'on aurait pu oublier. Reste une seule question : est-ce bien
  # l'autre en face ? La chaîne d'authentification y répond, et elle y répond à
  # voix haute.

  Scénario: les deux parties lisent la même chaîne d'authentification
    Quand le notaire rejoint la séance avec l'empreinte "AA:BB:CC:DD:EE:FF"
    Et le client rejoint la séance avec l'empreinte "11:22:33:44:55:66"
    Alors les deux parties lisent la même chaîne d'authentification

  Scénario: la chaîne ne dépend pas de qui est arrivé le premier
    Quand le client rejoint la séance avec l'empreinte "11:22:33:44:55:66"
    Et le notaire rejoint la séance avec l'empreinte "AA:BB:CC:DD:EE:FF"
    Alors les deux parties lisent la même chaîne d'authentification

  Scénario: une empreinte changée en cours de route change la chaîne
    Étant donné que les deux parties ont rejoint la séance
    Quand le client rejoint la séance avec l'empreinte "99:88:77:66:55:44"
    Alors la chaîne d'authentification n'est plus la même qu'avant

  Scénario: le notaire ne peut pas confirmer une chaîne qui n'est pas celle affichée
    Étant donné que les deux parties ont rejoint la séance
    Quand le notaire confirme la chaîne "AAAA-BBBB"
    Alors la réponse a le statut 422
    Et la porte "lien" reste fermée

  # --- Qui conduit ----------------------------------------------------------
  # Le notaire conduit et le client suit. Ce n'est pas une politesse
  # d'interface : les gestes qui font foi (l'attestation d'identité, la
  # confirmation du lien, le passage d'une étape, le sceau) n'appartiennent
  # qu'à lui, et l'API le refuse au client plutôt que de le lui cacher.

  Scénario: le client ne fait pas avancer la cérémonie
    Étant donné une séance prête à l'étape "questions"
    Quand le client tente de faire avancer la séance à "signature"
    Alors la réponse a le statut 403

  Scénario: le client n'atteste pas sa propre identité
    Étant donné que les deux parties ont rejoint la séance
    Quand le client tente d'attester l'identité du client
    Alors la réponse a le statut 403

  Scénario: un tiers sans jeton n'entre pas dans la séance
    Quand un inconnu demande l'état de la séance
    Alors la réponse a le statut 401

  # --- Les quatre portes ----------------------------------------------------
  # Compte, identité, lien, présence. Tant qu'une seule reste fermée, la
  # signature ne se libère pas — et le refus NOMME la porte, parce qu'un
  # notaire en séance a besoin de savoir quoi corriger, pas qu'on lui dise non.

  Scénario: les quatre portes sont ouvertes avant que la signature se libère
    Étant donné une séance prête à l'étape "questions"
    Alors les quatre portes de la séance sont ouvertes
    Quand le notaire fait avancer la séance à "signature"
    Alors la réponse a le statut 200
    Et la signature est libérée

  Scénario: une identité non attestée ferme la porte et bloque la signature
    Étant donné une séance prête à l'étape "questions" sans attestation d'identité du client
    Alors la porte "identite" reste fermée
    Quand le notaire fait avancer la séance à "signature"
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "porte_fermee"

  Scénario: une séance en répétition n'atteint jamais la signature
    Étant donné une séance prête à l'étape "questions" en mode "aucun"
    Quand le notaire fait avancer la séance à "signature"
    Alors la réponse a le statut 422
    Et aucune signature n'est libérée

  Scénario: une étape ne se saute pas
    Étant donné que les deux parties ont rejoint la séance
    Quand le notaire fait avancer la séance à "signature"
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "etape_sautee"

  # --- Le consentement ------------------------------------------------------
  # Un enregistrement sans l'accord des DEUX parties n'a pas lieu. La question
  # est posée à chacun séparément, la réponse est horodatée, et elle se retire.

  Scénario: la signature attend que les deux parties aient répondu
    Étant donné une séance prête à l'étape "questions" sans le consentement du client
    Quand le notaire fait avancer la séance à "signature"
    Alors la réponse a le statut 422
    Et aucune signature n'est libérée

  Scénario: un consentement retiré referme la séance sur elle-même
    Étant donné une séance prête à l'étape "questions"
    Quand le client retire son consentement
    Et le notaire fait avancer la séance à "signature"
    Alors la réponse a le statut 422
    Et aucune signature n'est libérée

  # --- La présence ----------------------------------------------------------
  # Le notaire doit voir et entendre la personne PENDANT toute la séance. Une
  # coupure n'est donc pas un incident réseau à ravaler : elle suspend la
  # séance, elle est datée au dernier signe de vie et non au moment où on s'en
  # aperçoit, et elle est écrite au procès-verbal.

  Scénario: le silence d'une partie suspend la séance
    Étant donné une séance prête à l'étape "lecture"
    Quand le client se tait pendant 40 secondes
    Alors la séance est suspendue
    Et le procès-verbal porte le fait "lien_coupe"

  Scénario: la coupure est datée au dernier signe de vie, pas à sa découverte
    Étant donné une séance prête à l'étape "lecture"
    Quand le client se tait pendant 40 secondes
    Alors la coupure est datée du dernier signe de vie du client

  Scénario: une séance suspendue n'avance pas
    Étant donné une séance prête à l'étape "lecture"
    Quand le client se tait pendant 40 secondes
    Et le notaire fait avancer la séance à "questions"
    Alors la réponse a le statut 422

  Scénario: le lien qui revient ne redémarre pas la séance tout seul
    Étant donné une séance prête à l'étape "lecture"
    Quand le client se tait pendant 40 secondes
    Et le client donne de nouveau signe de vie
    Alors la séance est suspendue
    Et le procès-verbal porte le fait "lien_repris"

  Scénario: c'est le notaire qui reprend la séance, et il repart de l'étape en cours
    Étant donné une séance prête à l'étape "lecture"
    Quand le client se tait pendant 40 secondes
    Et le client donne de nouveau signe de vie
    Et le notaire reprend la séance
    Alors la réponse a le statut 200
    Et la séance n'est plus suspendue
    Et la séance est encore à l'étape "lecture"
    Et le procès-verbal porte le fait "salle_reprise"

  Scénario: le notaire ne reprend pas une séance dont le lien est encore coupé
    Étant donné une séance prête à l'étape "lecture"
    Quand le client se tait pendant 40 secondes
    Et le notaire reprend la séance
    Alors la réponse a le statut 422

  Scénario: une SECONDE coupure suspend de nouveau
    Étant donné une séance prête à l'étape "lecture"
    Quand le client se tait pendant 40 secondes
    Et le client donne de nouveau signe de vie
    Et le notaire reprend la séance
    Et le client se tait pendant 40 secondes
    Alors la séance est suspendue
    Et le procès-verbal porte 2 fois le fait "lien_coupe"

  # --- Le procès-verbal -----------------------------------------------------
  # Chaque entrée porte l'empreinte de la précédente. Retirer une ligne, en
  # ajouter une, ou changer un mot dans l'une d'elles casse la chaîne à partir
  # de là — et la casse se VOIT, ce qui est tout ce qu'on demande à une preuve.

  Scénario: la séance scellée publie une empreinte vérifiable
    Étant donné une séance menée jusqu'au sceau
    Alors le procès-verbal scellé se vérifie
    Et l'empreinte du sceau est aussi dans la piste d'audit

  Scénario: retirer une entrée du procès-verbal casse la chaîne
    Étant donné une séance menée jusqu'au sceau
    Quand on retire une entrée du procès-verbal scellé
    Alors le procès-verbal scellé ne se vérifie plus

  Scénario: changer un mot dans une entrée casse la chaîne
    Étant donné une séance menée jusqu'au sceau
    Quand on change la partie nommée dans une entrée du procès-verbal scellé
    Alors le procès-verbal scellé ne se vérifie plus

  Scénario: le procès-verbal raconte la séance dans l'ordre
    Étant donné une séance menée jusqu'au sceau
    Alors le procès-verbal porte le fait "salle_ouverte"
    Et le procès-verbal porte le fait "identite_attestee"
    Et le procès-verbal porte le fait "lien_confirme"
    Et le procès-verbal porte le fait "signature_liberee"
    Et le procès-verbal porte le fait "salle_scellee"

  # --- Ce que Nota ne promet pas --------------------------------------------
  # Le fournisseur de démonstration scelle une séance et ne délivre AUCUNE
  # minute. La page le dit, l'API le dit, et ce scénario existe pour que
  # personne ne puisse le retirer en silence.

  Scénario: la signature de démonstration ne délivre aucune minute et le dit
    Étant donné une séance menée jusqu'au sceau
    Alors la signature ne porte aucune minute
    Et la signature porte un avis à afficher

  Scénario: aucune surface ne prétend à une approbation de la Chambre
    Étant donné une séance menée jusqu'au sceau
    Alors rien dans la séance ne se dit approuvé par la Chambre des notaires
