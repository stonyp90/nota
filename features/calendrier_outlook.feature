# language: fr
Fonctionnalité: Brancher le calendrier Outlook du notaire
  Le notaire vit déjà dans son calendrier. Nota lui offre donc de l'y brancher
  par OAuth : un consentement Microsoft, une preuve PKCE liée au navigateur qui
  l'a demandé, et un droit d'accès RENOUVELABLE scellé côté serveur — jamais un
  jeton en clair dans le dépôt, jamais un secret qui ressorte par l'API.

  Ce branchement est un CONFORT, pas une dépendance : l'agenda du notaire et
  son abonnement .ics vivent sans lui. Un consentement refusé, une autorisation
  périmée, une panne chez Microsoft ou un déploiement sans configuration se
  disent franchement, avec un code typé — et laissent la journée de signature
  exactement où elle était.

  L'horloge de Nota est figée au 2026-08-12 ; celle du consentement OAuth est
  distincte et s'avance à la main, parce qu'une autorisation expire en dix
  minutes et qu'une suite qui dort vraiment dix minutes ne se relit pas.

  Contexte:
    Étant donné un notaire actif "outlook@etude.ca"
    Et un client publie une offre avec le prêteur "desjardins" à 2500 dans 9 jours
    Et le notaire "outlook@etude.ca" retient l'offre

  Scénario: Brancher Outlook enregistre un droit d'accès renouvelable, jamais en clair
    Étant donné Outlook est configuré
    Quand le notaire "outlook@etude.ca" branche son calendrier Outlook
    Alors le consentement demandé porte une preuve PKCE en "S256"
    Et le calendrier de "outlook@etude.ca" est branché au compte "owner@example.test"
    Et le droit d'accès renouvelable de "outlook@etude.ca" n'est jamais lisible en clair
    Et le calendrier privé de "outlook@etude.ca" contient cette offre une fois

  Scénario: Débrancher coupe l'accès, périme l'autorisation en vol et n'efface pas l'agenda
    Étant donné Outlook est configuré
    Et le notaire "outlook@etude.ca" a branché son calendrier Outlook
    Quand le notaire "outlook@etude.ca" débranche son calendrier Outlook
    Alors le calendrier de "outlook@etude.ca" n'est plus branché
    Et le calendrier privé de "outlook@etude.ca" contient cette offre une fois
    Quand le notaire "outlook@etude.ca" demande un consentement Outlook
    Et le notaire "outlook@etude.ca" débranche son calendrier Outlook
    Et le fournisseur renvoie le notaire à Nota
    Alors le branchement est refusé avec le code "calendar_invalid_state" et le statut 400
    Et le calendrier de "outlook@etude.ca" n'est plus branché

  Scénario: Un consentement refusé ne laisse ni droit d'accès ni autorisation rejouable
    Étant donné Outlook est configuré
    Et le notaire "outlook@etude.ca" demande un consentement Outlook
    Quand le fournisseur renvoie le notaire à Nota avec le refus "access_denied"
    Alors le branchement est refusé avec le code "calendar_consent_denied" et le statut 400
    Et aucun jeton n'a été demandé au fournisseur
    Et le calendrier de "outlook@etude.ca" n'est plus branché
    Quand le fournisseur renvoie le notaire à Nota
    Alors le branchement est refusé avec le code "calendar_invalid_state" et le statut 400

  Scénario: Une autorisation périmée est refusée avant toute sortie réseau, et l'agenda tient
    Étant donné Outlook est configuré
    Et le notaire "outlook@etude.ca" demande un consentement Outlook
    Quand le consentement Outlook traîne plus de dix minutes
    Et le fournisseur renvoie le notaire à Nota
    Alors le branchement est refusé avec le code "calendar_invalid_state" et le statut 400
    Et aucun jeton n'a été demandé au fournisseur
    Et le calendrier privé de "outlook@etude.ca" contient cette offre une fois

  Scénario: Une panne chez Microsoft n'enregistre aucun droit d'accès et laisse l'agenda intact
    Étant donné Outlook est configuré mais le fournisseur est en panne
    Et le notaire "outlook@etude.ca" demande un consentement Outlook
    Quand le fournisseur renvoie le notaire à Nota
    Alors le branchement est refusé avec le code "calendar_provider_error" et le statut 503
    Et le calendrier de "outlook@etude.ca" n'est plus branché
    Et le calendrier privé de "outlook@etude.ca" contient cette offre une fois

  # Le retour du fournisseur n'est cru que s'il revient dans le navigateur qui
  # a demandé le consentement : le témoin de liaison est la preuve.
  Scénario: Un retour sans le témoin du navigateur n'est pas cru
    Étant donné Outlook est configuré
    Et le notaire "outlook@etude.ca" demande un consentement Outlook
    Quand le fournisseur renvoie le notaire à Nota depuis un autre navigateur
    Alors le branchement est refusé avec le code "calendar_invalid_state" et le statut 400
    Et aucun jeton n'a été demandé au fournisseur

  # Le jeton de flux .ics ne sert qu'à lire un calendrier. Il ne branche rien.
  Scénario: Un jeton de flux ne peut pas brancher un calendrier
    Étant donné Outlook est configuré
    Quand le jeton de flux de "outlook@etude.ca" demande un consentement Outlook
    Alors le branchement est refusé avec le code "non_autorise" et le statut 401

  Scénario: Sans configuration Outlook, la console le dit et rien d'autre ne casse
    Étant donné aucune configuration Outlook n'est déployée
    Alors le calendrier de "outlook@etude.ca" se dit non configuré
    Quand le notaire "outlook@etude.ca" branche son calendrier Outlook
    Alors le branchement est refusé avec le code "calendar_unconfigured" et le statut 503
    Et le calendrier privé de "outlook@etude.ca" contient cette offre une fois
