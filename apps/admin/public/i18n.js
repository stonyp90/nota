/* =============================================================================
   Admin i18n — the bilingual (fr-CA / en-CA) layer for the admin console.

   Twin of apps/web/public/i18n.js, carrying the console's own dictionary: the
   admin app is deliberately self-contained (no shared runtime modules), so the
   engine rides along rather than being imported. French is canonical in
   index.html/admin.js; in English mode this translates the DOM in place —
   static markup at boot, dynamic renders through a MutationObserver — via
   exact TEXT lookups, whole-element HTML lookups, then ordered pattern RULES,
   with a trailing money rule ("1 250 $" -> "$1,250"). A miss falls back to
   French, never a blank. Language persists under localStorage "nota.lang".

   UMD so the jsdom tests can eval it; window.NotaI18N in the browser.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotaI18N = api;
  if (typeof document !== 'undefined') api.boot();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LS_LANG = 'nota.lang';

  // === DICTIONARY — generated from the French sources. =======================
  var TEXT = {
  // Accès — utilisateurs, groupes, permissions (RBAC découplé).
  "Accès": "Access",
  "Qui peut quoi. Une permission est une capacité, un groupe en réunit, une personne reçoit des groupes et des permissions directes.": "Who can do what. A permission is a capability, a group bundles them, a person receives groups and direct permissions.",
  "Groupes": "Groups",
  "Un groupe réunit des permissions et s’attribue à des personnes. Le supprimer retire ses permissions à tous ses membres, immédiatement.": "A group bundles permissions and is assigned to people. Deleting it removes its permissions from every member, immediately.",
  "Aucun groupe pour le moment.": "No groups yet.",
  "Aucune permission": "No permission",
  "Nouveau groupe": "New group",
  "Identifiant": "Identifier",
  "Nom": "Name",
  "Permissions": "Permissions",
  "Créer le groupe": "Create the group",
  "Groupe enregistré.": "Group saved.",
  "Groupe supprimé.": "Group deleted.",
  "Suppression impossible.": "Could not delete.",
  "Utilisateurs": "Users",
  "Les comptes viennent de la liste blanche du déploiement — elle reste la porte extérieure. Ce qui se règle ici, c’est ce que chacun peut.": "Accounts come from the deployment allowlist — it remains the outer gate. What is configured here is what each person can do.",
  "Accès complet": "Full access",
  "Aucun accès": "No access",
  "Accès complet à la console": "Full access to the console",
  "Permissions directes": "Direct permissions",
  "Aucun groupe à attribuer.": "No group to assign.",
  "Accès enregistrés.": "Access saved.",
  "Enregistrement impossible.": "Could not save.",
  "Désactivé": "Disabled",
  "— attribuer des accès demande la permission « Attribuer groupes et permissions ».": "— assigning access requires the “Assign groups and permissions” permission.",
  "Facturé par Nota": "Billed by Nota",
  "Le notaire garde la totalité de ses honoraires. La colonne « Facturé par Nota » est ce que le client a payé pour le service de la plateforme.": "The notary keeps the entirety of their fees. The « Billed by Nota » column is what the client paid for the platform service.",
  "Aller au contenu": "Skip to content",
  "Nota Admin, accueil": "Nota Admin, home",
  "Se déconnecter": "Sign out",
  "Thème clair / sombre": "Light / dark theme",
  "Changer de thème": "Change theme",
  "Session expirée. Reconnectez-vous.": "Session expired. Sign in again.",
  "Administrateur principal": "Primary administrator",
  "Analyste": "Analyst",
  "Lecture seule": "Read-only",
  "Accès complet": "Full access",
  "Console Nota": "Nota Console",
  "Accès réservé. Recevez un lien de connexion à usage unique par courriel.": "Restricted access. Receive a one-time sign-in link by email.",
  "Courriel": "Email",
  "vous@nota.ca": "you@nota.ca",
  "Recevoir le lien": "Send me the link",
  "Envoi…": "Sending…",
  "Le lien expire après un court délai et ne peut servir qu’une fois. Aucune session n’est conservée après la fermeture de l’onglet.": "The link expires after a short time and can be used only once. No session is kept after the tab is closed.",
  "Courriel invalide.": "Invalid email.",
  "Service indisponible. Réessayez dans un instant.": "Service unavailable. Try again in a moment.",
  "Si cette adresse est autorisée, un lien vient d’être envoyé.": "If this address is authorized, a link has just been sent.",
  "Lien de développement →": "Development link →",
  "Vérification du lien…": "Verifying the link…",
  "Un instant pendant que nous validons votre accès.": "One moment while we confirm your access.",
  "Connexion réussie.": "Signed in.",
  "Lien invalide ou expiré.": "Invalid or expired link.",
  "Impossible de charger votre profil.": "Unable to load your profile.",
  "Une erreur est survenue": "Something went wrong",
  "Réessayer": "Try again",
  "Se reconnecter": "Sign in again",
  "Déconnecté.": "Signed out.",
  "Sections de la console": "Console sections",
  "Aperçu": "Overview",
  "Offres": "Offers",
  "Notaires": "Notaries",
  "Bientôt": "Coming soon",
  "Tableau de bord": "Dashboard",
  "Activité du marché notarial — offres, rétention, et ce que Nota a facturé.": "Notarial marketplace activity — offers, retention, and what Nota billed.",
  "Période": "Period",
  "Offres publiées": "Offers posted",
  "sur la période": "over the period",
  "Taux de rétention": "Retention rate",
  "Actes complétés": "Acts completed",
  "Offres ouvertes": "Open offers",
  "en ce moment": "right now",
  "registre des notaires indisponible": "notary roster unavailable",
  "Notaires actifs": "Active notaries",
  "sur la plateforme": "on the platform",
  "Notaires en intégration": "Notaries onboarding",
  "en intégration": "onboarding",
  "Offres par jour": "Offers per day",
  "Nombre d’offres publiées chaque jour de la période.": "Number of offers posted each day of the period.",
  "Par service": "By service",
  "Offres publiées et part retenue, par type d’acte.": "Offers posted and share taken, by type of act.",
  "Publiées": "Posted",
  "Retenues": "Taken",
  "Graphique linéaire des offres publiées par jour.": "Line chart of offers posted per day.",
  "Offres publiées par jour": "Offers posted per day",
  "Diagramme à barres des offres publiées et retenues par service.": "Bar chart of offers posted and taken, by service.",
  "Offres et rétention par service": "Offers and retention by service",
  "Aucune donnée pour cette période.": "No data for this period.",
  "Aucune offre, rétention ni facturation n’a été enregistrée sur l’intervalle sélectionné. Essayez une période plus large.": "No offers, retention or billing were recorded over the selected interval. Try a wider period.",
  "Parrainages": "Referrals",
  "Récompenses des partenaires référents — dû à la rétention (clients) et au premier acte (notaires).": "Referring-partner rewards — owed at retention (clients) and at the first act (notaries).",
  "Partenaire": "Partner",
  "Demandes": "Requests",
  "Complétés": "Completed",
  "Actifs": "Active",
  "Dû": "Owed",
  "Non inscrit": "Not registered",
  "Agent immobilier": "Real-estate agent",
  "Courtier hypothécaire": "Mortgage broker",
  "Autre professionnel": "Other professional",
  "Impossible de charger les données.": "Unable to load the data.",
  "Le service n’a pas répondu correctement. Vérifiez votre connexion, puis réessayez.": "The service did not respond correctly. Check your connection, then try again.",
  "Données chargées.": "Data loaded.",
  "Courriels": "Emails",
  "Sujets et activation des modèles de courriels. Les corps restent gérés par le code.": "Email template subjects and activation. Bodies remain managed by code.",
  "— la modification des modèles est réservée à l’administrateur principal.": "— editing templates is reserved for the primary administrator.",
  "Partenaires": "Partners",
  "Opérateur": "Operator",
  "Console admin": "Admin console",
  "Désactivé": "Disabled",
  "Modifié": "Customized",
  "Modifier": "Edit",
  "Détails": "Details",
  "Envoi activé": "Sending enabled",
  "Sujet (FR)": "Subject (FR)",
  "Sujet (EN)": "Subject (EN)",
  "Jetons permis": "Allowed tokens",
  "Aucun jeton pour ce modèle.": "No tokens for this template.",
  // --- Courriels : les quatre paires bilingues, l'interrupteur et ses raisons.
  "Sujet, ligne d’aperçu, corps et bouton de chaque modèle, dans les deux langues. Un courriel transactionnel ne peut pas être éteint.": "Subject, preview line, body and button for every template, in both languages. A transactional email cannot be switched off.",
  "Transactionnel": "Transactional",
  "Annonce un fait à son destinataire : ne peut pas être désactivé.": "Announces a fact to its recipient: cannot be switched off.",
  "Courriel transactionnel — il annonce à son destinataire un fait qu’il doit connaître : un accusé, un mouvement d’argent, un acte qui change de mains, un lien de connexion. L’éteindre laisserait la personne sans ce fait, ce qui est une publicité incomplète au sens de l’art. 68 du Code de déontologie. L’envoi ne peut donc pas être coupé ; la reformulation, elle, reste permise.": "Transactional email — it tells its recipient a fact they must know: an acknowledgement, a movement of money, an act changing hands, a sign-in link. Switching it off would leave the person without that fact, which is incomplete advertising under s. 68 of the Code of ethics. Sending therefore cannot be cut; rewording it remains allowed.",
  "Courriel commercial — relance, digest, invitation, reconquête. L’art. 56 1° du Code de déontologie tient l’autre bout : inciter quelqu’un de façon pressante ou répétée est dérogatoire, donc celui-ci doit pouvoir être coupé.": "Commercial email — reminder, digest, invitation, winback. Section 56(1) of the Code of ethics holds the other end: urging someone insistently or repeatedly is a breach, so this one must be switchable off.",
  "Nature non déclarée par l’API pour ce modèle. L’interrupteur reste ouvert, mais vérifiez avant de couper : éteindre un courriel transactionnel serait une publicité incomplète au sens de l’art. 68 du Code de déontologie.": "Nature not declared by the API for this template. The switch stays open, but check before cutting: switching off a transactional email would be incomplete advertising under s. 68 of the Code of ethics.",
  "Ligne d’aperçu (FR)": "Preview line (FR)",
  "Ligne d’aperçu (EN)": "Preview line (EN)",
  "Corps (FR)": "Body (FR)",
  "Corps (EN)": "Body (EN)",
  "Bouton (FR)": "Button (FR)",
  "Bouton (EN)": "Button (EN)",
  "Un champ laissé vide garde le texte du gabarit. Les deux langues d’une même ligne vont ensemble : remplissez le français ET l’anglais, ou aucun des deux.": "A field left empty keeps the template’s own text. Both languages of a line go together: fill in French AND English, or neither.",

  // --- Les codes de refus, dits en clair.
  "Jeton inconnu — ce modèle n’accepte que les jetons listés sous le formulaire.": "Unknown token — this template only accepts the tokens listed below the form.",
  "HTML refusé — écrivez du texte : la mise en forme vient du gabarit.": "HTML refused — write text: formatting comes from the template.",
  "Partage d’honoraires — Nota ne prélève aucune part des honoraires du notaire, et un courriel ne peut pas l’affirmer (art. 32 du Code de déontologie).": "Fee splitting — Nota takes no share of the notary’s fees, and an email cannot claim it does (s. 32 of the Code of ethics).",
  "Courriel transactionnel — il annonce un fait que son destinataire doit connaître : l’envoi ne peut pas être coupé (art. 68 du Code de déontologie).": "Transactional email — it announces a fact its recipient must know: sending cannot be cut (s. 68 of the Code of ethics).",
  "Champ inconnu — la console a envoyé un champ que le serveur ne connaît pas. Rechargez la page.": "Unknown field — the console sent a field the server does not know. Reload the page.",
  "Valeur invalide.": "Invalid value.",
  "Modèle inconnu — la liste a peut-être changé. Rechargez la page.": "Unknown template — the list may have changed. Reload the page.",
  "Sujet trop long.": "Subject too long.",
  "Ligne d’aperçu trop longue.": "Preview line too long.",
  "Corps trop long.": "Body too long.",
  "Libellé de bouton trop long.": "Button label too long.",
  "Sujet : les deux langues vont ensemble — remplissez le français ET l’anglais, ou aucun des deux.": "Subject: both languages go together — fill in French AND English, or neither.",
  "Ligne d’aperçu : les deux langues vont ensemble — remplissez le français ET l’anglais, ou aucun des deux.": "Preview line: both languages go together — fill in French AND English, or neither.",
  "Corps : les deux langues vont ensemble — remplissez le français ET l’anglais, ou aucun des deux.": "Body: both languages go together — fill in French AND English, or neither.",
  "Bouton : les deux langues vont ensemble — remplissez le français ET l’anglais, ou aucun des deux.": "Button: both languages go together — fill in French AND English, or neither.",
  "Confirmation requise — l’audience dépasse le plafond. Confirmez pour envoyer quand même.": "Confirmation required — the audience exceeds the cap. Confirm to send anyway.",
  "Cible invalide — choisissez une personne, un groupe ou un segment.": "Invalid target — choose a person, a group or a segment.",
  "Segment inconnu — la liste a peut-être changé. Rechargez la page.": "Unknown segment — the list may have changed. Reload the page.",
  "Paramètre inconnu pour ce segment.": "Unknown parameter for this segment.",
  "Paramètre hors des bornes permises.": "Parameter outside the allowed bounds.",
  "Cible incomplète — écrivez l’adresse courriel de la personne visée.": "Incomplete target — write the email address of the person you are targeting.",
  "Cible incomplète — choisissez le groupe visé.": "Incomplete target — choose the group you are targeting.",
  "Cible incomplète — choisissez le segment visé.": "Incomplete target — choose the segment you are targeting.",
  "Aucun gabarit choisi — désignez le courriel à envoyer.": "No template chosen — name the email to send.",

  // --- Campagnes : les envois ciblés (LCAP + art. 56 1°).
  "Campagnes": "Campaigns",
  "À qui Nota écrit, et pourquoi celui-là. Prévisualisez toujours avant d’envoyer : le décompte et les exclusions sont ce qui rend l’envoi défendable.": "Who Nota writes to, and why that person. Always preview before sending: the count and the exclusions are what make a send defensible.",
  "Ce qu’un envoi engage": "What a send commits you to",
  "LCAP (L.C. 2010, ch. 23, art. 6 et 10) — un message commercial exige une base de consentement, l’identification de l’expéditeur et un mécanisme d’exclusion qui fonctionne. Une campagne commerciale n’est pas une notification transactionnelle : l’aperçu dit laquelle des deux part.": "CASL (S.C. 2010, c. 23, ss. 6 and 10) — a commercial message requires a basis of consent, sender identification and a working unsubscribe mechanism. A commercial campaign is not a transactional notification: the preview says which of the two is going out.",
  "Art. 56 1° du Code de déontologie des notaires — est dérogatoire le fait d’inciter quelqu’un de façon pressante ou répétée à recourir à ses services. Le plafond de fréquence et le décompte des exclus sont la réponse ; c’est pourquoi ils sont affichés, exclusion par exclusion.": "Section 56(1) of the Code of ethics of notaries — urging someone insistently or repeatedly to use one’s professional services is a breach. The frequency cap and the count of those excluded are the answer; that is why they are shown, exclusion by exclusion.",
  "1 · La cible": "1 · The target",
  "2 · Le gabarit": "2 · The template",
  "Forme de la cible": "Target form",
  "Une personne": "One person",
  "Un groupe": "A group",
  "Un segment": "A segment",
  "Adresse courriel": "Email address",
  "personne@exemple.ca": "person@example.ca",
  "Un envoi nominatif reste un envoi : les mêmes exclusions s’appliquent, et l’aperçu les montre.": "A send to a named person is still a send: the same exclusions apply, and the preview shows them.",
  "Groupe": "Group",
  "Aucun groupe lisible avec vos accès.": "No group readable with your access.",
  "Segment": "Segment",
  "Aucun segment au catalogue.": "No segment in the catalogue.",
  "Courriel à envoyer": "Email to send",
  "— Choisissez un gabarit —": "— Choose a template —",
  "Aucun gabarit choisi — une campagne ne part jamais sur un défaut.": "No template chosen — a campaign never goes out on a default.",
  "Ce gabarit est transactionnel : il annonce un fait à son destinataire.": "This template is transactional: it announces a fact to its recipient.",
  "Ce gabarit est commercial : la LCAP exige une base de consentement pour chaque destinataire.": "This template is commercial: CASL requires a basis of consent for every recipient.",
  "Nature non déclarée par l’API pour ce gabarit — traitez-le comme commercial, la règle la plus stricte.": "Nature not declared by the API for this template — treat it as commercial, the stricter rule.",
  "Prévisualiser": "Preview",
  "Envoyer la campagne": "Send the campaign",
  "Prévisualisez d’abord : l’envoi ne s’ouvre qu’une fois le décompte affiché.": "Preview first: sending only opens once the count is shown.",
  "Le décompte ci-dessous correspond à la cible actuelle. Changez un paramètre et il faudra prévisualiser de nouveau.": "The count below matches the current target. Change one parameter and you will have to preview again.",
  "Le décompte est à jour ; l’envoi demande la permission « Envoyer une campagne ciblée ».": "The count is current; sending requires the “Send a targeted campaign” permission.",
  "La prévisualisation demande la permission « Lire les tableaux de bord ».": "Previewing requires the “Read the dashboards” permission.",
  "— l’envoi d’une campagne demande la permission « Envoyer une campagne ciblée ». La prévisualisation, elle, reste ouverte.": "— sending a campaign requires the “Send a targeted campaign” permission. Previewing stays open.",
  "Confirmer l’envoi": "Confirm the send",
  "L’envoi est immédiat et ne se rappelle pas.": "Sending is immediate and cannot be recalled.",
  "Confirmer et envoyer quand même": "Confirm and send anyway",
  "Aperçu de l’envoi": "Send preview",
  "Rien n’est parti — c’est un décompte.": "Nothing has gone out — this is a count.",
  "Destinataires retenus": "Recipients kept",
  "ce que l’envoi atteindrait": "what the send would reach",
  "Écartés": "Excluded",
  "et pourquoi, ligne par ligne": "and why, line by line",
  "Campagne commerciale": "Commercial campaign",
  "Message commercial au sens de la LCAP : il exige une base de consentement, l’identification de l’expéditeur et un lien de retrait. Ce n’est PAS une notification transactionnelle.": "A commercial message under CASL: it requires a basis of consent, sender identification and an unsubscribe link. It is NOT a transactional notification.",
  "Notification transactionnelle": "Transactional notification",
  "Avis de service : il annonce à son destinataire un fait qu’il doit connaître. Ni la base de consentement commerciale ni le plafond de fréquence ne s’y appliquent.": "A service notice: it tells its recipient a fact they must know. Neither the commercial basis of consent nor the frequency cap applies to it.",
  "Nature inconnue": "Unknown nature",
  "Le serveur n’a pas qualifié cette campagne ; traitez-la comme commerciale.": "The server did not qualify this campaign; treat it as commercial.",
  "À savoir avant d’envoyer": "Worth knowing before you send",
  "Nombre": "Count",
  "Pourquoi": "Why",
  "Sans adresse courriel": "No email address",
  "Aucune adresse au dossier — il n’y a personne à joindre.": "No address on file — there is nobody to reach.",
  "Doublons": "Duplicates",
  "La même adresse visée par plusieurs parties de l’audience, comptée une seule fois.": "The same address targeted by several parts of the audience, counted once.",
  "Désabonnés": "Unsubscribed",
  "Retrait demandé. La LCAP (art. 6) exige un mécanisme d’exclusion qui fonctionne.": "Withdrawal requested. CASL (s. 6) requires a working unsubscribe mechanism.",
  "Sans base de consentement": "No basis of consent",
  "Ni consentement exprès ni relation d’affaires en cours pour un message commercial (LCAP, art. 10).": "Neither express consent nor an existing business relationship for a commercial message (CASL, s. 10).",
  "Plafond de fréquence": "Frequency cap",
  "Déjà joints dans la fenêtre. Art. 56 1° : ne pas inciter de façon pressante ou répétée.": "Already reached within the window. Section 56(1): do not urge insistently or repeatedly.",
  "Échantillon": "Sample",
  "Adresses masquées : reconnaissables, pas expédiables.": "Masked addresses: recognizable, not sendable.",
  "Aucun destinataire à montrer.": "No recipient to show.",
  "La prévisualisation n’a pas abouti.": "The preview did not go through.",
  "L’envoi n’a pas abouti.": "The send did not go through.",
  "Campagne envoyée": "Campaign sent",
  "Campagne envoyée.": "Campaign sent.",
  "Référence": "Reference",
  "Envoyés": "Sent",
  "destinataires joints": "recipients reached",
  "Prévisualisez de nouveau avant tout autre envoi : le décompte précédent a été consommé.": "Preview again before any further send: the previous count has been consumed.",
  "Enregistrer": "Save",
  "Réinitialiser": "Reset",
  "Modèle enregistré.": "Template saved.",
  "Modèle réinitialisé.": "Template reset.",
  "Impossible d’enregistrer le modèle.": "Unable to save the template.",
  "Facturation": "Billing",
  "Prix": "Price",
  "Le prix du service de Nota — un montant fixe, le même pour tous les notaires.": "Nota’s service price — a fixed amount, the same for every notary.",
  "— la modification du prix est réservée à l’administrateur principal.": "— editing the price is reserved for the primary administrator.",
  "Prix en vigueur": "Price in force",
  "ajouté à chaque offre, encaissé à la signature": "added to every offer, collected at the signing",
  "Défaut du déploiement": "Deployment default",
  "ce à quoi une réinitialisation revient": "what a reset returns to",
  "Valeur par défaut du déploiement — aucun prix enregistré.": "Deployment default — no price stored.",
  "Le client autorise sa carte pour le montant offert au notaire PLUS ce prix. Le notaire reçoit ses honoraires en entier ; ce prix ne dépend ni de lui, ni de sa cote, ni de la valeur de l’acte.": "The client authorizes their card for the amount offered to the notary PLUS this price. The notary receives their fees in full; this price depends neither on them, nor on their cote, nor on the value of the act.",
  "Modifier le prix": "Edit the price",
  "Le montant est saisi en dollars — « 400 » signifie 400,00 $.": "The amount is entered in dollars — “400” means $400.00.",
  "Prix de Nota ($)": "Nota’s price ($)",
  "Retirer": "Remove",
  "Enregistrer le prix": "Save the price",
  "Revenir à la valeur par défaut": "Return to the default value",
  "Le prix enregistré sera supprimé — la valeur par défaut reprendra effet dès la prochaine offre.": "The stored price will be deleted — the default value takes effect again at the next offer.",
  "Confirmer la réinitialisation": "Confirm the reset",
  "Annuler": "Cancel",
  "Prix enregistré.": "Price saved.",
  "Prix réinitialisé.": "Price reset.",
  "Impossible d’enregistrer le prix.": "Unable to save the price.",
  "Le prix de Nota doit être un nombre entier de cents, supérieur à zéro (ex. 40000 pour 400,00 $).": "Nota’s price must be a whole number of cents, greater than zero (e.g. 40000 for $400.00).",
  "Annulation": "Cancellation",
  "Valeurs par défaut du déploiement — aucun barème enregistré.": "Deployment defaults — no schedule stored.",
  "Paliers": "Tiers",
  "Modifier le barème": "Edit the schedule",
  "Ajouter un palier": "Add a tier",
  "Enregistrer le barème": "Save the schedule",
  "Revenir aux valeurs par défaut": "Return to the default values",
  "Barème enregistré.": "Schedule saved.",
  "Barème réinitialisé.": "Schedule reset.",
  "Impossible d’enregistrer le barème.": "Unable to save the schedule.",
  "Barème décidé par Nota — frais d’annulation tardive selon les jours restants avant la signature.": "Schedule decided by Nota — late-cancellation fees by days left before the signing.",
  "Dernière minute": "Last minute",
  "retenu le jour de la signature": "retained on the day of the signing",
  "de frais selon les jours restants": "of fees by days remaining",
  "Gratuit dès": "Free from",
  "avant la signature": "before the signing",
  "Aucun palier — l’annulation est gratuite partout.": "No tiers — cancellation is free everywhere.",
  "Jours avant la signature": "Days before the signing",
  "Taux retenu": "Rate retained",
  "Au-delà du dernier palier, l’annulation est gratuite.": "Beyond the last tier, cancellation is free.",
  "Les taux sont saisis en pourcentage — « 30 » signifie 30 %. Un barème sans palier rend l’annulation gratuite partout.": "Rates are entered as percentages — “30” means 30%. A schedule with no tiers makes cancellation free everywhere.",
  "Paliers de frais": "Fee tiers",
  "Jours restants (max)": "Days left (max)",
  "Taux retenu (%)": "Rate retained (%)",
  "Le barème enregistré sera supprimé — les valeurs par défaut reprendront effet dès la prochaine annulation.": "The stored schedule will be deleted — the default values take effect again at the next cancellation.",
  "Réservé": "Reserved",
  "Réservé à l’administrateur principal.": "Reserved for the primary administrator.",
  "Accès réservé": "Restricted access",
  "— cette section est réservée à l’administrateur principal.": "— this section is reserved for the primary administrator.",
  "Réseau": "Network",
  "Tableau d’honneur — la cote sur 100, ses quatre axes, et ce que Nota a facturé au client.": "Roll of honour — the cote out of 100, its four axes, and what Nota billed the client.",
  "Tableau d’honneur": "Roll of honour",
  "Trié par cote — la meilleure d’abord.": "Sorted by cote — the best first.",
  "Aucun notaire inscrit pour le moment.": "No notary registered yet.",
  "Étude": "Firm",
  "Statut": "Status",
  "Actes": "Acts",
  "Note": "Rating",
  "Dernière visite": "Last visit",
  "Actif": "Active",
  "En intégration": "Onboarding",
  "Restreint": "Restricted",
  "aucun avis": "no reviews",
  "jamais": "never",
  "oui": "yes",
  "non": "no",
  "Note moyenne": "Average rating",
  "Avis reçus": "Reviews received",
  "Note pondérée": "Weighted rating",
  "Cible": "Target",
  "Note visée": "Target rating",
  "Volume visé": "Target volume",
  "Services rendus (information)": "Services delivered (information)",
  "Services au catalogue (information)": "Services in the catalogue (information)",
  "Ces deux lignes sont affichées pour information : se spécialiser ne retire aucun point.": "Both lines are shown for information: specializing takes away no points.",
  "Réponses données": "Responses given",
  "Réponses visées": "Target responses",
  "Propositions et acceptations": "Proposals and acceptances",
  "Déclins (sans pénalité)": "Declines (no penalty)",
  "Répondre est ce qui compte — décliner EST une réponse. Seul le silence coûte des points.": "Answering is what counts — declining IS an answer. Only silence costs points.",
  "Rayon": "Radius",
  "Urgences en ligne": "Online urgent acts",
  "Fiche CNQ": "CNQ listing",
  "Secteur postal": "Postal sector",
  "Jours depuis la dernière visite": "Days since the last visit",
  "Jours sur Nota": "Days on Nota",
  "Conformité": "Compliance",
  "Journal append-only — chaque geste d’administration et chaque acte réglé, jour par jour.": "Append-only log — every administrative action and every settled act, day by day.",
  "Jour": "Day",
  "Aucune entrée pour ce jour.": "No entry for this day.",
  "Ni geste d’administration ni acte réglé n’a été journalisé à cette date.": "No administrative action and no settled act were logged on this date.",
  "Le jour demandé est illisible.": "The requested day is unreadable.",
  "système": "system",
  "Acte réglé": "Act settled",
  "Frais d’annulation — dédommagement du notaire": "Cancellation fee — the notary’s compensation",
  "Prix de Nota modifié": "Nota’s price updated",
  "Prix de Nota réinitialisé": "Nota’s price reset",
  "Barème d’annulation modifié": "Cancellation schedule updated",
  "Barème d’annulation réinitialisé": "Cancellation schedule reset",
  "Modèle de courriel modifié": "Email template updated",
  "Modèle de courriel réinitialisé": "Email template reset",
  "Lien de connexion demandé": "Sign-in link requested",
  "Lien demandé par une adresse inconnue": "Link requested by an unknown address",
  "Connexion freinée": "Sign-in throttled",
  "Connexion réussie": "Signed in",
  "Déconnexion": "Signed out",
  "Session prolongée": "Session extended",
  /* F1 — audit console admin 2026-09-03 */
  "Trop de demandes de lien. Réessayez dans quinze minutes.": "Too many link requests. Try again in fifteen minutes.",
  "Le service n’a pas pu envoyer le lien. Réessayez.": "The service could not send the link. Try again.",
  "Votre session expire dans deux minutes.": "Your session expires in two minutes.",
  "Votre session atteint sa durée maximale dans deux minutes — reconnectez-vous pour continuer.": "Your session reaches its maximum length in two minutes — sign in again to continue.",
  "Rester connecté": "Stay signed in",
  "Facturé par Nota": "Billed by Nota",
  "Dédommagements versés aux notaires": "Compensation paid to notaries",
  "Dédommagements dus aux notaires": "Compensation owed to notaries",
  "Dû à Nota": "Owed to Nota",
  "actes réglés hors plateforme": "acts settled off-platform",
  "encaissé, tous notaires": "collected, all notaries",
  "Retenues en cours": "Retained right now",
  "— cette section demande la permission « Lire les tableaux de bord ».": "— this section requires the “Read the dashboards” permission.",
  "— cette section demande la permission « Lire le catalogue des permissions ».": "— this section requires the “Read the permission catalog” permission.",
  "— cette section demande la permission « Lire le journal d’audit ».": "— this section requires the “Read the audit log” permission.",
  "Réservé — cette liste demande la permission « Voir les groupes ».": "Reserved — this list requires the “See groups” permission.",
  "Réservé — cette liste demande la permission « Voir les utilisateurs ».": "Reserved — this list requires the “See users” permission.",
  "Modifier le groupe": "Edit the group",
  "Description": "Description",
  "À quoi sert ce groupe": "What this group is for",
  "Enregistrer le groupe": "Save the group",
  "Supprimer": "Delete",
  "Confirmer la suppression": "Confirm the deletion",
  "1 membre perd ses permissions, immédiatement.": "1 member loses its permissions, immediately.",
  "Compte désactivé — ne peut plus ouvrir de session": "Account disabled — can no longer sign in",
  "Dernier administrateur — impossible de retirer le dernier accès complet : accordez-le d’abord à quelqu’un d’autre.": "Last administrator — the last full access cannot be removed: grant it to someone else first.",
  "Joker refusé — « * » ne s’accorde pas à un groupe : accordez-le nommément à une personne.": "Wildcard refused — “*” is not granted to a group: grant it to a named person.",
  "Permission inconnue — le catalogue a peut-être changé. Rechargez la page.": "Unknown permission — the catalogue may have changed. Reload the page.",
  "Groupe introuvable — il a peut-être été supprimé entre-temps. Rechargez la page.": "Group not found — it may have been deleted in the meantime. Reload the page.",
  "Compte inconnu — cette adresse n’est pas dans la liste blanche du déploiement.": "Unknown account — this address is not on the deployment allowlist.",
  "Identifiant invalide — minuscules, sans espace (lettres, chiffres, - et _), 40 caractères au plus.": "Invalid identifier — lowercase, no spaces (letters, digits, - and _), 40 characters at most.",
  "Nom manquant — le nom du groupe est obligatoire, 80 caractères au plus.": "Name missing — the group name is required, 80 characters at most.",
  "Un groupe porte déjà l’identifiant demandé — modifiez-le depuis sa ligne plutôt que de l’écraser.": "A group already carries the requested identifier — edit it from its row rather than overwriting it.",
  "Aucun expéditeur câblé sur cette console — la campagne n’a pas été envoyée.": "No sender is wired on this console — the campaign was not sent.",
  "Gabarit transactionnel — un avis de service ne peut pas servir de campagne commerciale (art. 68 du Code de déontologie).": "Transactional template — a service notice cannot serve as a commercial campaign (s. 68 of the Code of ethics).",
  "Non encaissé": "Not collected",
  "Acte retenu": "Act retained",
  "Document déposé": "Document uploaded",
  "Document consulté": "Document viewed",
  "Notaire activé": "Notary activated",
  "Accès modifiés": "Access updated",
  "Groupe enregistré": "Group saved",
  "Groupe supprimé": "Group deleted",
  "Campagne refusée": "Campaign refused",
  "Audit": "Audit",
  "Console": "Console",
  "Notifications": "Notifications",
  "Barème en vigueur": "Schedule in force",
  "Axes": "Axes",
  "Aucun jeton pour ce modèle.": "No tokens for this template.",
  "— la modification du barème est réservée à l’administrateur principal.": "— editing the schedule is reserved for the primary administrator."
  /* /F1 */
};
  var HTML = {};
  var RULES = compileRules([
  {
    "pattern": "^Envoyer \u00e0 ([\\d\u00a0 ]+) destinataires \\?$",
    "flags": "",
    "replacement": "Send to $1 recipients?"
  },
  {
    "pattern": "^Plafond d\u2019audience d\u00e9pass\u00e9 \\(([\\d\u00a0 ]+)\\) \u2014 l\u2019envoi demandera une confirmation explicite\\.$",
    "flags": "",
    "replacement": "Audience cap exceeded ($1) \u2014 sending will require an explicit confirmation."
  },
  {
    "pattern": "^Plafond d\u2019audience : ([\\d\u00a0 ]+) destinataires\\. Cette audience tient dessous\\.$",
    "flags": "",
    "replacement": "Audience cap: $1 recipients. This audience fits under it."
  },
  {
    "pattern": "^Prix décidé par Nota — modifié le (.+)\\.$",
    "flags": "",
    "replacement": "Price decided by Nota — updated $1."
  },
  {
    "pattern": "^Barème décidé par Nota — modifié le (.+)\\.$",
    "flags": "",
    "replacement": "Schedule decided by Nota — updated $1."
  },
  {
    "pattern": "^(.+) au notaire · (.+) à Nota$",
    "flags": "",
    "replacement": "$1 to the notary · $2 to Nota"
  },
  {
    "pattern": "^(\\d+),(\\d+) sur (\\d+)$",
    "flags": "",
    "replacement": "$1.$2 out of $3"
  },
  {
    "pattern": "^(\\d+) sur (\\d+)$",
    "flags": "",
    "replacement": "$1 out of $2"
  },
  {
    "pattern": "^(\\d+) avis$",
    "flags": "",
    "replacement": "$1 reviews"
  },
  {
    "pattern": "^Palier (\\d+) : il faut une cote entière de 1 à 100 et un taux entre le plancher et le taux de base\\.$",
    "flags": "",
    "replacement": "Tier $1: a whole cote from 1 to 100 and a rate between the floor and the base rate are required."
  },
  {
    "pattern": "^Deux paliers ne peuvent pas viser la même cote \\((\\d+)\\)\\.$",
    "flags": "",
    "replacement": "Two tiers cannot target the same cote ($1)."
  },
  {
    "pattern": "^Les paliers doivent être une liste d’au plus (\\d+) éléments\\.$",
    "flags": "",
    "replacement": "Tiers must be a list of at most $1 items."
  },
  {
    "pattern": "^Récompenses des partenaires référents — (.+) à la rétention \\(client\\), (.+) au premier acte \\(notaire\\)\\.$",
    "flags": "",
    "replacement": "Referring-partner rewards — $1 at retention (client), $2 at the first act (notary)."
  },
  {
    "pattern": "^(\\d+) jours$",
    "flags": "",
    "replacement": "$1 days"
  },
  {
    "pattern": "^(\\d+) jour$",
    "flags": "",
    "replacement": "$1 day"
  },
  {
    "pattern": "^(\\d+)–(\\d+) jours$",
    "flags": "",
    "replacement": "$1–$2 days"
  },
  {
    "pattern": "^(\\d+) modèles$",
    "flags": "",
    "replacement": "$1 templates"
  },
  {
    "pattern": "^(−?[\\d ]+) retenues sur (−?[\\d ]+) publiées$",
    "flags": "",
    "replacement": "$1 taken of $2 posted"
  },
  {
    "pattern": "^(−?[\\d ]+) publiées · (−?[\\d ]+) retenues$",
    "flags": "",
    "replacement": "$1 posted · $2 taken"
  },
  {
    "pattern": "^(\\d+),(\\d) %$",
    "flags": "",
    "replacement": "$1.$2%"
  },
  {
    "pattern": "^(\\d+) %$",
    "flags": "",
    "replacement": "$1%"
  },
  {
    "pattern": "^du (\\d{1,2})[ \\u00A0](\\S+) au (\\d{1,2})[ \\u00A0](\\S+)$",
    "flags": "",
    "replacement": "from $2 $1 to $4 $3"
  },
  {
    "pattern": "^(\\d{1,2})[ \\u00A0]((?:janv|févr|avr|juill|sept|oct|nov|déc)\\.|mars|mai|juin|août)$",
    "flags": "",
    "replacement": "$2 $1"
  },
  {
    "pattern": "\\bjanv\\.",
    "flags": "g",
    "replacement": "Jan"
  },
  {
    "pattern": "\\bfévr\\.",
    "flags": "g",
    "replacement": "Feb"
  },
  {
    "pattern": "\\bmars\\b",
    "flags": "g",
    "replacement": "Mar"
  },
  {
    "pattern": "\\bavr\\.",
    "flags": "g",
    "replacement": "Apr"
  },
  {
    "pattern": "\\bmai\\b",
    "flags": "g",
    "replacement": "May"
  },
  {
    "pattern": "\\bjuin\\b",
    "flags": "g",
    "replacement": "Jun"
  },
  {
    "pattern": "\\bjuill\\.",
    "flags": "g",
    "replacement": "Jul"
  },
  {
    "pattern": "\\baoût\\b",
    "flags": "g",
    "replacement": "Aug"
  },
  {
    "pattern": "\\bsept\\.",
    "flags": "g",
    "replacement": "Sep"
  },
  {
    "pattern": "\\boct\\.",
    "flags": "g",
    "replacement": "Oct"
  },
  {
    "pattern": "\\bnov\\.",
    "flags": "g",
    "replacement": "Nov"
  },
  {
    "pattern": "\\bdéc\\.",
    "flags": "g",
    "replacement": "Dec"
  },
  {
    "pattern": "(\\d) (\\d{3})",
    "flags": "g",
    "replacement": "$1\u00a0$2"
  },
  {
    "pattern": "(\\d) (\\d{3})",
    "flags": "g",
    "replacement": "$1\u00a0$2"
  },
  {
    "pattern": "(\\d) \\$",
    "flags": "g",
    "replacement": "$1\u00a0$"
  },
  {
    "pattern": "Refinancement hypothécaire(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Mortgage refinancing"
  },
  {
    "pattern": "Refinancement(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Refinancing"
  },
  {
    "pattern": "Prioritaire(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Priority"
  },
  {
    "pattern": "Extrême(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Extreme"
  },
  {
    "pattern": "Rapide(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Fast"
  },
  {
    "pattern": "(\\d)[\\u00a0 ]%",
    "flags": "g",
    "replacement": "$1%"
  },
  /* F1 rules — audit console admin 2026-09-03 */
  {
    "pattern": "^(.+) au notaire · (.+) dû à Nota — non encaissé$",
    "flags": "",
    "replacement": "$1 to the notary · $2 owed to Nota — not collected"
  },
  {
    "pattern": "^(.+) retenus au client · versés au notaire$",
    "flags": "",
    "replacement": "$1 withheld from the client · paid to the notary"
  },
  {
    "pattern": "^(.+) retenus au client · dus au notaire$",
    "flags": "",
    "replacement": "$1 withheld from the client · owed to the notary"
  },
  {
    "pattern": "^(.+) offerts au notaire$",
    "flags": "",
    "replacement": "$1 offered to the notary"
  },
  {
    "pattern": "^(\\d+)\\.(\\d+) sur (\\d+)$",
    "flags": "",
    "replacement": "$1.$2 out of $3"
  },
  {
    "pattern": "^Supprimer le groupe « (.+) » \\?$",
    "flags": "",
    "replacement": "Delete the group “$1”?"
  },
  {
    "pattern": "^([\\d\\u00a0 ]+) membres perdent ses permissions, immédiatement\\.$",
    "flags": "",
    "replacement": "$1 members lose its permissions, immediately."
  },
  {
    "pattern": "^Groupes : (.+)$",
    "flags": "",
    "replacement": "Groups: $1"
  },
  {
    "pattern": "^Palier (\\d+) : il faut un nombre de jours entier ≥ 0 et un taux entre 0 et 1 \\(ex\\. 0,30 pour 30 ?%\\)\\.$",
    "flags": "",
    "replacement": "Tier $1: a whole number of days ≥ 0 and a rate between 0 and 1 are required (e.g. 0.30 for 30%)."
  },
  {
    "pattern": "^Palier (\\d+) : les jours doivent être strictement croissants\\.$",
    "flags": "",
    "replacement": "Tier $1: days must be strictly ascending."
  },
  {
    "pattern": "^Heure de Québec \\((.+)\\)$",
    "flags": "",
    "replacement": "Québec time ($1)"
  },
  {
    "pattern": "\\(heure de Québec\\)",
    "flags": "g",
    "replacement": "(Québec time)"
  }
  /* /F1 rules */
]);
  // === END DICTIONARY ========================================================

  function compileRules(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      try { out.push({ re: new RegExp(list[i].pattern, list[i].flags || ''), sub: list[i].replacement }); }
      catch (e) { /* a bad pattern must not take the console down */ }
    }
    return out;
  }

  // --- Language state --------------------------------------------------------
  function detect() {
    // A ?lang=en|fr in the URL wins and persists — it makes an English link
    // shareable (and is what the hreflang alternates point at).
    try {
      if (typeof location !== 'undefined') {
        var q = /[?&]lang=(en|fr)\b/.exec(location.search || '');
        if (q) { try { localStorage.setItem(LS_LANG, q[1]); } catch (e) {} return q[1]; }
      }
    } catch (e) {}
    try { var v = localStorage.getItem(LS_LANG); if (v === 'en' || v === 'fr') return v; } catch (e) {}
    try {
      if (typeof navigator !== 'undefined' && /^en/i.test(String(navigator.language || ''))) return 'en';
    } catch (e) {}
    return 'fr';
  }
  var current = detect();

  function lang() { return current; }
  function locale() { return current === 'en' ? 'en-CA' : 'fr-CA'; }
  function force(l) { current = l === 'en' ? 'en' : 'fr'; }
  function setLang(l) {
    l = l === 'en' ? 'en' : 'fr';
    try { localStorage.setItem(LS_LANG, l); } catch (e) {}
    // A ?lang= in the URL would win over the stored choice on reload — rewrite
    // it so the toggle works for visitors arriving through a language link.
    if (typeof location !== 'undefined' && /[?&]lang=(en|fr)\b/.test(location.search || '')) {
      location.replace(
        location.pathname +
        location.search.replace(/([?&])lang=(en|fr)\b/, '$1lang=' + l) +
        location.hash
      );
      return;
    }
    if (typeof location !== 'undefined') location.reload();
  }

  // --- String translation ----------------------------------------------------
  // ASCII whitespace only: U+00A0 is French typography and part of the keys.
  function normalize(s) { return String(s == null ? '' : s).replace(/[ \t\r\n]+/g, ' ').trim(); }

  function moneyEn(s) {
    return s.replace(/(\d{1,3}(?:\u00a0\d{3})*)(?:,(\d{1,2}))?\u00a0\$/g, function (m, d, c) {
      return '$' + d.replace(/\u00a0/g, ',') + (c ? '.' + c : '');
    });
  }

  // Rules run IN ORDER, each on the output of the previous one.
  function applyRules(s) {
    for (var i = 0; i < RULES.length; i++) s = s.replace(RULES[i].re, RULES[i].sub);
    return s;
  }

  function translateEn(s) {
    var n = normalize(s);
    if (!n) return n;
    if (Object.prototype.hasOwnProperty.call(TEXT, n)) return TEXT[n];
    return moneyEn(applyRules(n));
  }

  function t(s) { return current === 'en' ? translateEn(s) : String(s == null ? '' : s); }
  function tEn(s) { return translateEn(s); }

  function covered(s) {
    var n = normalize(s);
    if (!n) return true;
    if (Object.prototype.hasOwnProperty.call(TEXT, n)) return true;
    return applyRules(n) !== n;
  }

  // --- DOM translation -------------------------------------------------------
  var ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
  var mo = null;
  var applying = false;

  function silence(fn) {
    applying = true;
    try { fn(); } finally { if (mo) mo.takeRecords(); applying = false; }
  }

  function translateTextNode(node) {
    var v = node.nodeValue;
    if (!v) return;
    var n = normalize(v);
    if (!n) return;
    var en = translateEn(n);
    if (en === n) return;
    var lead = (v.match(/^[ \t\r\n]*/) || [''])[0];
    var trail = (v.match(/[ \t\r\n]*$/) || [''])[0];
    silence(function () { node.nodeValue = lead + en + trail; });
  }

  function translateAttrs(el) {
    if (!el.getAttribute) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var v = el.getAttribute(a);
      if (v == null || !v) continue;
      var en = translateEn(v);
      if (en !== normalize(v)) {
        (function (attr, val) { silence(function () { el.setAttribute(attr, val); }); })(a, en);
      }
    }
  }

  function normalizeHtml(html) {
    return normalize(html).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }

  function translateElement(el) {
    if (!el || el.nodeType !== 1) return;
    var tag = el.nodeName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'svg') return;
    if (el.hasAttribute && el.hasAttribute('data-i18n-skip')) return;

    if (el.childElementCount > 0) {
      var ih = el.innerHTML;
      if (ih.length < 800 && ih.indexOf('<svg') === -1) {
        var key = normalizeHtml(ih);
        if (Object.prototype.hasOwnProperty.call(HTML, key)) {
          silence(function () { el.innerHTML = HTML[key]; });
          translateAttrs(el);
          return;
        }
      }
    }

    translateAttrs(el);
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) translateTextNode(c);
      else if (c.nodeType === 1) translateElement(c);
    }
  }

  // --- Dynamic renders -------------------------------------------------------
  function observe() {
    mo = new MutationObserver(function (records) {
      if (applying) return;
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'characterData') translateTextNode(r.target);
        else if (r.type === 'attributes') translateAttrs(r.target);
        else if (r.type === 'childList') {
          for (var j = 0; j < r.addedNodes.length; j++) {
            var n = r.addedNodes[j];
            if (n.nodeType === 3) translateTextNode(n);
            else if (n.nodeType === 1) translateElement(n);
          }
        }
      }
    });
    mo.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS,
    });
  }

  // --- Language toggle -------------------------------------------------------
  function wireToggles() {
    var els = document.querySelectorAll('[data-lang-toggle]');
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        var short = el.getAttribute('data-lang-toggle') === 'short';
        var target = current === 'en' ? 'fr' : 'en';
        el.textContent = short
          ? (target === 'en' ? 'EN' : 'FR')
          : (target === 'en' ? 'English' : 'Français');
        el.setAttribute('lang', target === 'en' ? 'en-CA' : 'fr-CA');
        el.setAttribute(
          'aria-label',
          target === 'en' ? 'Switch to English' : 'Passer au français'
        );
        el.addEventListener('click', function () { setLang(target); });
      })(els[i]);
    }
  }

  // --- Boot ------------------------------------------------------------------
  function boot() {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('lang', locale());
    wireToggles();
    if (current !== 'en') return;
    if (document.body) translateElement(document.body);
    observe();
  }

  return {
    lang: lang,
    locale: locale,
    setLang: setLang,
    force: force,
    t: t,
    tEn: tEn,
    covered: covered,
    normalize: normalize,
    boot: boot,
    dictionaries: function () { return { text: TEXT, html: HTML }; },
  };
});
