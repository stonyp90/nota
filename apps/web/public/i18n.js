/* =============================================================================
   Nota i18n — the bilingual (fr-CA / en-CA) layer. Zero dependencies.

   French is canonical: index.html, app.js and @nota/domain all speak French.
   This module owns the English side. In English mode it translates the DOM in
   place — static markup once at boot, dynamic renders through a
   MutationObserver — via three lookups applied in order:

     1. TEXT  — exact match on a normalized text node / attribute value.
     2. HTML  — exact match on an element's normalized innerHTML, for sentences
                split by inline markup where fragment-by-fragment translation
                would break English word order.
     3. RULES — regex patterns for strings composed at runtime (amounts,
                dates, counts). A trailing money rule converts the Quebec
                format ("1 250 $") to English ("$1,250").

   A miss falls back to the French original — never a blank. The language is
   persisted under localStorage "nota.lang"; switching reloads the page so the
   Intl formatters in app.js pick up the new locale.

   UMD like @nota/domain: window.NotaI18N in the browser, require()-able in
   tests. Coverage is enforced by apps/web/test/i18n.test.mjs.
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
  "Testament et mandat de protection": "Will and protection mandate",
  "Testament": "Will",
  "Testament notarié et mandat de protection en cas d’inaptitude.": "Notarized will and protection mandate in case of incapacity.",
  "Le testament est pour qui ?": "Who is the will for?",
  "Un couple = deux testaments miroirs + deux mandats.": "A couple = two mirror wills + two mandates.",
  "Moi seul": "Just me",
  "Un héritier a-t-il besoin d’être protégé ?": "Does an heir need to be protected?",
  "Enfant mineur, proche à charge ou handicapé, ou remise de l’héritage à un âge précis.": "A minor child, a dependent or disabled loved one, or handing the inheritance over at a specific age.",
  "Non": "No",
  "Oui": "Yes",
  "Inclure le mandat de protection ?": "Include the protection mandate?",
  "Le forfait standard réunit le testament et le mandat d’inaptitude.": "The standard package combines the will and the incapacity mandate.",
  "Oui (forfait)": "Yes (package)",
  "Testament seul": "Will only",
  "Famille recomposée": "Blended family",
  "Conjoint et enfants d’unions différentes.": "A spouse and children from different unions.",
  "Entreprise, société ou ferme": "Business, corporation or farm",
  "Actions, convention d’actionnaires, gel successoral.": "Shares, shareholder agreement, estate freeze.",
  "Biens importants à l’étranger": "Significant assets abroad",
  "Immeuble ou comptes hors Canada.": "Real estate or accounts outside Canada.",
  "Pièce d’identité avec photo": "Photo ID",
  "Permis de conduire, passeport ou carte d’assurance maladie valide.": "A valid driver’s licence, passport or health insurance card.",
  "Liste sommaire des biens": "Summary list of assets",
  "Immeubles, comptes, placements. Une estimation suffit à cette étape.": "Real estate, accounts, investments. An estimate is enough at this stage.",
  "Liquidateur (exécuteur) pressenti": "Intended liquidator (executor)",
  "La personne qui réglera la succession. Nom complet et lien avec vous.": "The person who will settle the estate. Full name and relationship to you.",
  "Bénéficiaires principaux": "Main beneficiaries",
  "Qui hérite, et dans quelles proportions approximatives.": "Who inherits, and in roughly what proportions.",
  "Mandataire en cas d’inaptitude": "Mandatary in case of incapacity",
  "La personne qui vous représenterait si vous perdiez vos capacités.": "The person who would represent you if you lost your capacity.",
  "Tuteur des enfants mineurs": "Guardian for minor children",
  "Si vous avez des enfants mineurs, qui en prendrait soin. Écrivez « aucun » s’il n’y a pas d’enfant mineur.": "If you have minor children, who would take care of them. Write \"none\" if there is no minor child.",
  "Procuration": "Power of attorney",
  "Procuration générale ou spéciale pour agir en votre nom.": "General or special power of attorney to act on your behalf.",
  "Étendue de la procuration": "Scope of the power of attorney",
  "Un acte précis, ou la gestion générale de vos biens.": "One specific act, or the general management of your property.",
  "Un acte précis": "One specific act",
  "Gestion générale": "General management",
  "Vise-t-elle un immeuble ?": "Does it involve real estate?",
  "Pouvoir de vendre, acheter ou hypothéquer une propriété — encadré strictement par la loi.": "The power to sell, buy or mortgage a property — strictly regulated by law.",
  "Où sera-t-elle utilisée ?": "Where will it be used?",
  "À l’étranger : apostille ou traduction requise.": "Abroad: an apostille or translation is required.",
  "À l’étranger": "Abroad",
  "En anglais / traduction": "In English / translation",
  "Version anglaise ou traduite requise.": "An English or translated version is required.",
  "Personne mandatée": "Appointed person",
  "Nom complet de la personne qui pourra agir en votre nom.": "Full name of the person who will be able to act on your behalf.",
  "Portée de la procuration": "Extent of the power of attorney",
  "Générale (tous vos biens) ou spéciale. Écrivez « aucune limite » si générale.": "General (all your property) or special. Write \"no limit\" if general.",
  "Durée ou échéance": "Duration or expiry",
  "Jusqu’à quand la procuration doit valoir. Écrivez « indéterminée » si sans fin prévue.": "How long the power of attorney should remain valid. Write \"indefinite\" if no end date is planned.",
  "Refinancement hypothécaire": "Mortgage refinancing",
  "Refinancement": "Refinancing",
  "Acte de prêt et publication de l’hypothèque lors d’un refinancement.": "Loan deed and publication of the hypothec during a refinancing.",
  "Montant du nouveau prêt": "Amount of the new loan",
  "Le montant du refinancement.": "The amount of the refinancing.",
  "La propriété fait-elle partie d’une succession ?": "Is the property part of an estate?",
  "Héritiers, liquidateur : dossier nettement plus complexe.": "Heirs, a liquidator: a markedly more complex file.",
  "Approbation bancaire": "Bank approval",
  "Où en êtes-vous avec le prêteur ? Sans instructions, le notaire ne peut signer à la date visée.": "Where do you stand with the lender? Without instructions, the notary cannot sign on the target date.",
  "Obtenue": "Obtained",
  "En cours": "In progress",
  "Pas encore": "Not yet",
  "Co-emprunteur / indivision": "Co-borrower / undivided co-ownership",
  "Plus de deux propriétaires inscrits.": "More than two registered owners.",
  "Assurance habitation à jour ?": "Home insurance up to date?",
  "Le prêteur exige une assurance en vigueur (feu, dégât d’eau, foudre…). Sans elle, le refinancement ne peut se conclure.": "The lender requires insurance in force (fire, water damage, lightning…). Without it, the refinancing cannot close.",
  "Oui, en vigueur": "Yes, in force",
  "À renouveler": "Needs renewal",
  "Aucune": "None",
  "Certificat de localisation": "Certificate of location",
  "Un certificat périmé ou absent retarde souvent le dossier.": "An expired or missing certificate often delays the file.",
  "À jour": "Up to date",
  "Je ne sais pas": "I don’t know",
  "Périmé / absent": "Expired / missing",
  "Offre de financement du prêteur": "Lender’s financing offer",
  "Le document d’engagement de la banque, avec le taux et le montant.": "The bank’s commitment document, with the rate and the amount.",
  "Relevé hypothécaire actuel": "Current mortgage statement",
  "Un relevé de moins de 30 jours du prêt à rembourser.": "A statement less than 30 days old for the loan being paid off.",
  "Compte de taxes municipales": "Municipal tax bill",
  "Le compte le plus récent de la municipalité.": "The most recent bill from the municipality.",
  "Le plan de l’arpenteur-géomètre. C’est souvent le document qui retarde un dossier — vérifiez qu’il est à jour.": "The land surveyor’s plan. It is often the document that delays a file — check that it is up to date.",
  "Adresse de l’immeuble": "Property address",
  "Adresse civique complète de la propriété refinancée.": "Full civic address of the property being refinanced.",
  "Prêteur": "Lender",
  "Le nom de l’institution qui accorde le nouveau prêt.": "The name of the institution granting the new loan.",
  "Échéance du taux": "Rate expiry",
  "La date avant laquelle le taux offert doit être signé, si connue.": "The date by which the offered rate must be signed, if known.",
  "Rapide": "Fast",
  "Prioritaire": "Priority",
  "Extrême": "Extreme",
  "complexe": "complex",
  "ouverte": "open",
  "retenue": "taken",
  "Service inconnu.": "Unknown service.",
  "Le montant doit être un nombre positif.": "The amount must be a positive number.",
  "La date doit être au format AAAA-MM-JJ.": "The date must be in YYYY-MM-DD format.",
  "La date du jour est manquante ou invalide.": "Today’s date is missing or invalid.",
  "La date de signature est déjà passée.": "The signing date has already passed.",
  "Le courriel n’est pas valide.": "The email address is not valid.",
  "Réponse requise : Le testament est pour qui ?": "Answer required: Who is the will for?",
  "Réponse requise : Un héritier a-t-il besoin d’être protégé ?": "Answer required: Does an heir need to be protected?",
  "Réponse requise : Étendue de la procuration.": "Answer required: Scope of the power of attorney.",
  "Réponse requise : Vise-t-elle un immeuble ?": "Answer required: Does it involve real estate?",
  "Réponse requise : Montant du nouveau prêt.": "Answer required: Amount of the new loan.",
  "Réponse requise : La propriété fait-elle partie d’une succession ?": "Answer required: Is the property part of an estate?",
  "Réponse requise : Approbation bancaire.": "Answer required: Bank approval.",
  "Erreur serveur. Réessayez.": "Server error. Please try again.",
  "✓ Approuvée": "✓ Approved",
  "En attente": "Pending",
  "Expirée": "Expired",
  "Aucune notification pour le moment.": "No notifications yet.",
  "Ignorer cette notification": "Dismiss this notification",
  "Ignorer": "Dismiss",
  "Accédez aux demandes ouvertes à Québec. Sans mot de passe.": "Access open requests in Québec. No password required.",
  "Accéder à l’espace notaire →": "Go to the notary space →",
  "Publiez une demande et suivez vos offres. Vos renseignements restent sur cet appareil.": "Post a request and track your offers. Your information stays on this device.",
  "Continuer →": "Continue →",
  "Entrez un courriel valide.": "Enter a valid email.",
  "Trouvez votre notaire en 3 étapes": "Find your notary in 3 steps",
  "Vous publiez votre demande ; un notaire de Québec la retient.": "You post your request; a Québec notary takes it on.",
  "Publier ma demande →": "Post my request →",
  "Explorer le carnet d’abord": "Explore the carnet first",
  "Choisissez votre date": "Choose your date",
  "sur le calendrier public.": "on the public calendar.",
  "Proposez votre prix": "Propose your price",
  "plus l’échéance est proche, plus votre offre pèse.": "the closer the deadline, the more weight your offer carries.",
  "Un notaire vous retient": "A notary takes you on",
  "payé à la signature, gratuit pour vous.": "paid at signing, free for you.",
  "Recevez des dossiers en 3 étapes": "Receive files in 3 steps",
  "Vous choisissez les demandes qui vous conviennent.": "You choose the requests that suit you.",
  "Voir les demandes →": "See the requests →",
  "Voyez les demandes ouvertes": "See the open requests",
  "à Québec, triées par date.": "in Québec, sorted by date.",
  "Retenez celle qui vous convient": "Take on the one that suits you",
  "le dossier du client s’ouvre.": "the client's file opens.",
  "Complétez l’acte": "Complete the act",
  "commission seulement sur ce qui se conclut.": "commission only on what closes.",
  "Se déconnecter effacera de cet appareil vos coordonnées, vos offres publiées, votre dossier et vos notifications. Continuer ?": "Signing out will erase your contact details, published offers, file and notifications from this device. Continue?",
  "Vous êtes déconnecté.": "You are signed out.",
  "Espace notaire": "Notary space",
  "Vos demandes et vos dossiers retenus": "Your requests and your retained files",
  "Mon compte": "My account",
  "Se connecter / s’inscrire": "Sign in / sign up",
  "Publiez une demande, ou ouvrez l’espace notaire": "Post a request, or open the notary space",
  "Comment ça marche": "How it works",
  "Mes demandes et dossiers": "My requests and files",
  "Se déconnecter": "Sign out",
  "Mon profil": "My profile",
  "Mes offres": "My offers",
  "Mon dossier": "My file",
  "Publier une offre": "Post an offer",
  "Votre signature est aujourd’hui": "Your signing is today",
  "Un notaire a retenu votre demande 🎉": "A notary has taken on your request 🎉",
  "lun": "Mon",
  "mar": "Tue",
  "mer": "Wed",
  "jeu": "Thu",
  "ven": "Fri",
  "sam": "Sat",
  "dim": "Sun",
  "Délai": "Lead time",
  "Dans chaque case": "In each cell",
  ": la meilleure offre encore ouverte pour chaque acte, à la couleur ci-dessus, et le multiple du prix de départ qu’il faut compter à ce délai. Plus la date est proche, plus ce multiple monte.": ": the best offer still open for each act, in the colour shown above, and the multiple of the starting price to expect at this notice. The closer the date, the higher the multiple climbs.",
  "à partir de": "from",
  "médiane": "median",
  "aucune offre ce mois": "no offers this month",
  "anonyme": "anonymous",
  "Retenu": "Taken",
  "Retenue": "Taken",
  "aujourd’hui": "today",
  "demain": "tomorrow",
  "hier": "yesterday",
  "libre": "free",
  "Libre": "Free",
  "Afficher le détail": "Show details",
  "Masquer le détail": "Hide details",
  "Voir moins": "See less",
  "Meilleure offre ouverte": "Best open offer",
  "Votre offre passe devant.": "Your offer moves ahead.",
  "Filtres réinitialisés.": "Filters reset.",
  "Tous les actes": "All acts",
  "Affiner (facultatif)": "Refine (optional)",
  "Choisissez d’abord une date.": "Choose a date first.",
  "Choisissez une date et un montant.": "Choose a date and an amount.",
  "Sous la fourchette du marché, peu susceptible d’être retenue.": "Below the market range, unlikely to be taken.",
  "Dans la fourchette qui se conclut à ce délai.": "Within the range that closes at this notice.",
  "Offre généreuse, susceptible d’être retenue rapidement.": "Generous offer, likely to be taken quickly.",
  "Publier mon offre": "Publish my offer",
  "Affichée comme « Client · secteur postal ».": "Displayed as “Client · postal sector”.",
  "Votre nom sera visible publiquement sur le carnet.": "Your name will be publicly visible on the carnet.",
  "Publication…": "Publishing…",
  "Redirection vers le paiement…": "Redirecting to payment…",
  "Offre publiée ✓": "Offer published ✓",
  "Offre publiée": "Offer published",
  "Vous n’avez pas encore publié d’offre. Choisissez une date au carnet et un notaire de Québec la retient.": "You haven't posted an offer yet. Choose a date in the carnet and a Québec notary takes it on.",
  "Réserver ma première date": "Book my first date",
  "Aucune offre à venir.": "No upcoming offers.",
  "Acte": "Act",
  "Montant": "Amount",
  "Statut": "Status",
  "Coordonnées": "Contact details",
  "Réutilisées automatiquement quand vous publiez une offre.": "Automatically reused when you post an offer.",
  "Nom (offre non anonyme)": "Name (non-anonymous offer)",
  "Prénom Nom": "First and last name",
  "Courriel": "Email",
  "vous@exemple.ca": "you@example.ca",
  "Code postal": "Postal code",
  "Par courriel et dans l’application. Activées par défaut.": "By email and in the app. On by default.",
  "Confirmation de publication d’une offre": "Confirmation when an offer is published",
  "Rappels à l’approche de la date": "Reminders as the date approaches",
  "Avis quand un notaire retient votre offre": "Notice when a notary takes on your offer",
  "Mes documents": "My documents",
  "Téléversez ce que le notaire demandera. Ajoutez, retirez ou marquez « validé ». Tout reste sur votre appareil jusqu’à ce qu’un notaire retienne votre demande.": "Upload what the notary will ask for. Add, remove or mark « validated ». Everything stays on your device until a notary takes on your request.",
  "Acte pour lequel préparer les documents": "Act to prepare documents for",
  "Aucun document requis pour cet acte.": "No documents required for this act.",
  "Validé": "Validated",
  "Remplacer le fichier": "Replace the file",
  "Choisir un fichier": "Choose a file",
  "Retirer": "Remove",
  "Votre réponse": "Your answer",
  "Questions qui déterminent le prix": "Questions that determine the price",
  "Enregistrées dans votre profil. Elles ajustent le prix de départ de cet acte.": "Saved in your profile. They adjust this act's starting price.",
  "Consentement de partage": "Sharing consent",
  "Le notaire qui retient votre demande vérifiera votre identité à la signature. Rien n’est transmis avant.": "The notary who takes on your request will verify your identity at signing. Nothing is shared before then.",
  "J’autorise le partage de mon dossier avec le notaire retenu.": "I authorize sharing my file with the retained notary.",
  "✓ Prêt à être retenu par un notaire. Votre identité sera vérifiée à la signature.": "✓ Ready to be taken on by a notary. Your identity will be verified at signing.",
  "consentement de partage requis.": "sharing consent required.",
  "Dossier complet ✓": "File complete ✓",
  "Votre demande est prête à être retenue immédiatement.": "Your request is ready to be taken on immediately.",
  "Revoir mon dossier": "Review my file",
  "Complétez votre dossier": "Complete your file",
  "Les demandes au dossier complet sont retenues en priorité par les notaires.": "Requests with a complete file are taken first by notaries.",
  "Compléter mon dossier": "Complete my file",
  "Un courriel est requis.": "An email is required.",
  "Inscription indisponible pour le moment.": "Sign-up unavailable at the moment.",
  "Hors ligne. Réessayez une fois en ligne.": "Offline. Try again once you're back online.",
  "Connectez-vous d’abord à votre console.": "Sign in to your console first.",
  "Redirection…": "Redirecting…",
  "Connecter mon compte de paiement": "Connect my payment account",
  "M’inscrire gratuitement →": "Sign up for free →",
  "Montant de l’acte invalide.": "Invalid act amount.",
  "Envoi…": "Sending…",
  "Marquer complété": "Mark completed",
  "Action impossible (hors ligne).": "Action unavailable (offline).",
  "Session expirée. Reconnectez-vous.": "Session expired. Sign in again.",
  "Impossible de compléter l’acte.": "Unable to complete the act.",
  "Courriel invalide.": "Invalid email.",
  "Abonné — vous recevrez les nouvelles dates.": "Subscribed — you will receive new dates.",
  "Désabonné.": "Unsubscribed.",
  "Console indisponible hors ligne. Réessayez une fois en ligne.": "Console unavailable offline. Try again once you're back online.",
  "Connexion refusée.": "Sign-in refused.",
  "Impossible de charger les demandes (hors ligne). Réessayez.": "Unable to load requests (offline). Try again.",
  "Cette offre a déjà été retenue par un autre notaire.": "This offer has already been taken by another notary.",
  "Offre introuvable, elle a peut-être expiré.": "Offer not found — it may have expired.",
  "Échec de la prise en charge.": "Failed to take on the request.",
  "Demande retenue. Dossier du client débloqué.": "Request taken. Client file unlocked.",
  "Échec du refus.": "Failed to decline.",
  "Demande déclinée.": "Request declined.",
  "Inscrivez-vous pour tout voir": "Sign up to see everything",
  "Des demandes réelles — retenues en un clic": "Real requests — taken in one click",
  "Vous proposez — un notaire retient": "You propose — a notary takes it",
  "Ouverte — à retenir en un clic": "Open — take it on in one click",
  "Ouverte — les notaires de Québec la voient": "Open — Québec notaries can see it",
  "Une semaine sur Nota": "A week on Nota",
  "Cette semaine à Québec": "This week in Québec",
  "à la signature": "at signing",
  "en jeu": "in play",
  "Dossier complet": "Complete file",
  "Dossier incomplet": "Incomplete file",
  "Retenir": "Take on",
  "Décliner": "Decline",
  "Bloquer cette date dans mon agenda": "Block this date in my calendar",
  "Cas simple": "Simple case",
  "Cas standard": "Standard case",
  "Cas complexe": "Complex case",
  "Demandes ouvertes": "Open requests",
  "Dossier du client": "Client file",
  "Acte complété": "Act completed",
  "Acte signé ? Confirmez la valeur finale": "Act signed? Confirm the final value",
  "Valeur de l’acte": "Act value",
  "Nota prélève sa commission uniquement à cette étape, sur la valeur confirmée.": "Nota charges its commission only at this step, on the confirmed value.",
  "Actes complétés": "Acts completed",
  "Valeur réalisée": "Value realized",
  "Commission Nota": "Nota commission",
  "Net à vous": "Net to you",
  "Vos revenus et la commission Nota s’afficheront ici dès votre premier acte complété.": "Your earnings and the Nota commission will appear here after your first completed act.",
  "Déconnecté.": "Signed out.",
  "Quitter le plein écran": "Exit full screen",
  "Plein écran": "Full screen",
  "Redirection vers l’inscription…": "Redirecting to sign-up…",
  "Demandes rafraîchies.": "Requests refreshed.",
  "Paiement autorisé. Votre offre est en cours de publication.": "Payment authorized. Your offer is being published.",
  "Paiement annulé. Votre offre n’a pas été publiée.": "Payment canceled. Your offer was not published.",
  "Nota — le carnet public des actes notariés à Québec": "Nota — the public carnet of notarized acts in Québec",
  "Notaire à Québec pour la date voulue : testament, procuration, refinancement. Affichez votre date, un notaire retient rapidement votre demande. Gratuit.": "A notary in Québec for the date you want: will, power of attorney, refinancing. Post your date and a notary quickly takes on your request. Free.",
  "Choisissez votre date, nommez votre prix. Testament, procuration, refinancement. Un notaire de Québec retient votre demande. Gratuit pour le client.": "Choose your date, name your price. Will, power of attorney, refinancing. A Québec notary takes on your request. Free for the client.",
  "Nota — carnet public des actes notariés à Québec": "Nota — public carnet of notarized acts in Québec",
  "Choisissez votre date, nommez votre prix. Un notaire de Québec retient votre demande.": "Choose your date, name your price. A Québec notary takes on your request.",
  "Carte Nota : le carnet public des actes notariés à Québec — testament, procuration, refinancement.": "Nota card: the public carnet of notarized acts in Québec — will, power of attorney, refinancing.",
  "Aller au contenu": "Skip to content",
  "Nota, accueil — retour au menu": "Nota, home — back to the menu",
  "Sections": "Sections",
  "Carnet": "Carnet",
  "Notaires": "Notaries",
  "Ouvrir le menu": "Open the menu",
  "Thème clair / sombre": "Light / dark theme",
  "Changer de thème": "Switch theme",
  "Se connecter": "Sign in",
  "S’inscrire": "Sign up",
  "Compte et notifications": "Account and notifications",
  "Compte": "Account",
  "Coordonnées, documents, préférences": "Contact details, documents, preferences",
  "Actions du compte": "Account actions",
  "Notifications": "Notifications",
  "Tout marquer lu": "Mark all read",
  "Informations légales": "Legal information",
  "Confidentialité": "Privacy",
  "Conditions d’utilisation": "Terms of use",
  "Charte des droits": "Charter of rights",
  "Menu principal": "Main menu",
  "Menu": "Menu",
  "Fermer le menu": "Close the menu",
  "Place de marché des services notariaux · Québec": "Notarial services marketplace · Québec",
  "Un notaire, à la date qu’il vous faut.": "A notary, on the date you need.",
  "Proposez votre date et votre prix — un notaire de Québec retient votre demande.": "Propose your date and your price — a Québec notary takes on your request.",
  "Gratuit pour vous.": "Free for you.",
  "Réserver votre date →": "Reserve your date →",
  "Voir les dates": "See the dates",
  "Le carnet en ce moment": "The carnet right now",
  "Ce que les clients offrent": "What clients are offering",
  "Mois précédent": "Previous month",
  "Aujourd’hui": "Today",
  "Mois suivant": "Next month",
  "Filtrer les offres": "Filter offers",
  "Filtres": "Filters",
  "Agrandir le calendrier": "Enlarge the calendar",
  "Filtrer par service": "Filter by service",
  "Filtrer par statut": "Filter by status",
  "Toutes": "All",
  "Ouvertes": "Open",
  "Retenues": "Taken",
  "Montant minimum": "Minimum amount",
  "Tout montant": "Any amount",
  "500\u00a0$+": "$500+",
  "1\u00a0000\u00a0$+": "$1,000+",
  "2\u00a0000\u00a0$+": "$2,000+",
  "Trier": "Sort",
  "Date": "Date",
  "Réinitialiser": "Reset",
  "Calendrier des offres": "Offer calendar",
  "Ajouter le carnet à votre agenda": "Add the carnet to your calendar",
  "Ajouter le carnet des dates à votre agenda": "Add the carnet of dates to your calendar",
  "Suivez les dates": "Follow the dates",
  "Le carnet dans votre agenda": "The carnet in your calendar",
  "Ajoutez le carnet à Google, Outlook ou Apple en un clic. Les dates ouvertes à Québec, à jour automatiquement.": "Add the carnet to Google, Outlook or Apple in one click. The open dates in Québec, automatically up to date.",
  "Ou par courriel": "Or by email",
  "Les nouvelles dates, par courriel": "New dates, by email",
  "Votre courriel": "Your email",
  "M’abonner": "Subscribe",
  "Un courriel quand une nouvelle date s’ouvre à Québec. Désabonnement en un clic.": "One email when a new date opens in Québec. Unsubscribe in one click.",
  "Se désabonner": "Unsubscribe",
  "Votre dossier": "Your file",
  "Ce que le notaire demandera": "What the notary will ask for",
  "Préparez-le d’avance. Rien n’est transmis avant qu’un notaire retienne votre demande.": "Prepare it in advance. Nothing is shared until a notary takes on your request.",
  "Service": "Service",
  "Pour les notaires": "For notaries",
  "Remplissez votre semaine. Payé à la signature.": "Fill your week. Paid at signing.",
  "Inscription gratuite, sans frais fixes. Nota se rémunère par une commission, uniquement sur les actes que vous complétez. Vous retenez ce qui vous convient, vous déclinez le reste sans frais.": "Free registration, no fixed fees. Nota earns a commission, only on the acts you complete. You take on what suits you and decline the rest at no charge.",
  "Inscrivez-vous, gratuit": "Sign up, free",
  "Retenez ce qui vous convient": "Take on what suits you",
  "Payé en entier à la signature": "Paid in full at signing",
  "Ce que vous obtenez": "What you get",
  "Des demandes réelles à Québec": "Real requests in Québec",
  "Des clients qui ont fixé une date et un prix, triés par date de signature.": "Clients who have set a date and a price, sorted by signing date.",
  "La commission Nota est déduite à la source, jamais une facture à courir.": "Nota's commission is deducted at the source — never an invoice to chase.",
  "Vous gardez la main": "You stay in control",
  "Vous fixez vos honoraires et choisissez les dossiers qui vous conviennent.": "You set your fees and choose the files that suit you.",
  "Sans frais fixes": "No fixed fees",
  "Inscription gratuite, une commission seulement sur les actes complétés.": "Free registration, a commission only on completed acts.",
  "Ajouter le carnet des demandes à votre agenda": "Add the carnet of requests to your calendar",
  "Votre outil de prospection": "Your prospecting tool",
  "Toutes les demandes ouvertes à Québec, à jour automatiquement dans Google, Outlook ou Apple.": "All the open requests in Québec, automatically up to date in Google, Outlook or Apple.",
  "En jeu ce mois à Québec": "In play this month in Québec",
  "demandes ouvertes": "open requests",
  "à retenir": "to take on",
  "Accédez aux demandes": "Access the requests",
  "Courriel professionnel": "Professional email",
  "vous@etude.ca": "you@firm.ca",
  "Voir les demandes ouvertes →": "See the open requests →",
  "Sans mot de passe. Première visite ou retour, c’est le même courriel. Si aucun compte n’existe encore, l’inscription gratuite se propose ici même.": "No password. First visit or returning, it's the same email. If no account exists yet, free sign-up is offered right here.",
  "Bienvenue !": "Welcome!",
  "n’a pas encore de compte. L’inscription est": "doesn't have an account yet. Signing up is",
  "gratuite et sans engagement": "free with no commitment",
  ", en deux étapes :": ", in two steps:",
  "Vous créez votre compte de paiement sécurisé via": "You create your secure payment account via",
  ", notre partenaire (~2 min).": ", our partner (~2 min).",
  "Votre console s’ouvre aussitôt. Vous voyez les demandes et en retenez.": "Your console opens right away. You see the requests and take them on.",
  "Stripe vous demandera une pièce d’identité et un compte bancaire pour vos versements. Ces informations restent chez Stripe, Nota ne les voit jamais. Vous êtes ensuite ramené ici.": "Stripe will ask you for photo ID and a bank account for your payouts. That information stays with Stripe — Nota never sees it. You are then brought back here.",
  "Connecté": "Signed in",
  "Rafraîchir": "Refresh",
  "Recevez vos demandes à votre rythme": "Receive your requests at your own pace",
  "Choisissez comment et à quelle fréquence Nota vous prévient des nouvelles demandes qui vous conviennent. Modifiable à tout moment.": "Choose how and how often Nota alerts you to new requests that suit you. Adjustable at any time.",
  "Comment vous prévenir": "How to reach you",
  "Dans l’application": "In the app",
  "toujours actif": "always on",
  "Par courriel": "By email",
  "Par texto (SMS)": "By text (SMS)",
  "Mobile pour les textos": "Mobile number for texts",
  "À quelle fréquence": "How often",
  "Fréquence des alertes": "Alert frequency",
  "À chaque demande": "Every request",
  "Résumé quotidien": "Daily digest",
  "Résumé hebdomadaire": "Weekly digest",
  "Seulement les demandes urgentes (Prioritaire et +)": "Only urgent requests (Priority and up)",
  "Quels actes vous intéressent": "Which acts interest you",
  "Actes": "Acts",
  "✓ Préférences enregistrées.": "✓ Preferences saved.",
  "Aucune demande ouverte pour l’instant.": "No open requests at the moment.",
  "Dossiers retenus": "Files taken",
  "Aucun dossier retenu pour l’instant.": "No files taken at the moment.",
  "Vos revenus": "Your earnings",
  "Paiements": "Payments",
  "Connectez un compte de paiement sécurisé (Stripe) pour être payé sur les actes complétés. Nota ne prélève sa commission qu’à la signature, sur la valeur confirmée.": "Connect a secure payment account (Stripe) to get paid on completed acts. Nota only takes its commission at signing, on the confirmed value.",
  "Vos signatures dans votre agenda": "Your signings in your calendar",
  "Vos dossiers retenus, à jour automatiquement (webcal).": "Your taken files, automatically up to date (webcal).",
  "Ouvertes en ce moment": "Open right now",
  "Vous gardez la main.": "You stay in control.",
  "Vous fixez vos honoraires et vérifiez l’identité du client à la signature, comme l’exige la loi. Nota n’intervient jamais dans l’acte.": "You set your fees and verify the client's identity at signing, as the law requires. Nota never intervenes in the act.",
  "Votre profil": "Your profile",
  "Vos coordonnées et préférences, enregistrées sur cet appareil et réutilisées automatiquement pour vos offres et votre dossier.": "Your contact details and preferences, saved on this device and reused automatically for your offers and your file.",
  "Vie privée · Loi 25": "Privacy · Law 25",
  "Vos renseignements, protégés.": "Your information, protected.",
  "Nota respecte la": "Nota complies with",
  "Loi 25": "Law 25",
  "(Loi sur la protection des renseignements personnels dans le secteur privé). Voici, en clair, ce que nous recueillons et vos droits.": "(the Act respecting the protection of personal information in the private sector). Here, in plain language, is what we collect and what your rights are.",
  "Ce que nous recueillons": "What we collect",
  "Votre date de signature, le service, le montant offert et les 3 premiers caractères de votre code postal, affichés publiquement. Votre courriel et le contenu de votre dossier restent privés.": "Your signing date, the service, the amount offered and the first 3 characters of your postal code, displayed publicly. Your email and the contents of your file stay private.",
  "Hébergé au Canada": "Hosted in Canada",
  "Anonyme par défaut": "Anonymous by default",
  "Les offres sont affichées comme « Client · secteur postal ». Votre nom n’est visible que si vous choisissez explicitement de le rendre public.": "Offers are displayed as “Client · postal sector”. Your name is only visible if you explicitly choose to make it public.",
  "Vos droits et nos engagements": "Your rights and our commitments",
  "Droit de suppression.": "Right to deletion.",
  "Vous pouvez demander l’accès, la rectification ou la suppression de vos renseignements en tout temps en écrivant à": "You can request access to, correction of, or deletion of your information at any time by writing to",
  ". Nous répondons dans un délai de 30 jours.": ". We respond within 30 days.",
  "Partage du dossier.": "File sharing.",
  "Le contenu de votre dossier n’est transmis à personne tant qu’un notaire n’a pas retenu votre demande, et seulement après votre consentement explicite. Les documents eux-mêmes sont échangés de façon sécurisée à cette étape.": "The contents of your file are shared with no one until a notary has taken on your request, and only after your explicit consent. The documents themselves are exchanged securely at that step.",
  "Vérification d’identité.": "Identity verification.",
  "Nota ne vérifie pas votre identité. C’est le notaire qui retient votre demande qui vérifie votre identité au moment de la signature, comme l’exige la loi.": "Nota does not verify your identity. The notary who takes on your request verifies your identity at signing, as the law requires.",
  "Aucune revente.": "No resale.",
  "Nous ne vendons ni ne louons vos renseignements. Nota se rémunère par une commission sur les actes complétés. Aucune donnée n’est monnayée.": "We neither sell nor rent your information. Nota earns a commission on completed acts. No data is monetized.",
  "Responsable.": "Accountability.",
  "Une personne responsable de la protection des renseignements personnels supervise ces pratiques :": "A person responsible for the protection of personal information oversees these practices:",
  "Les règles du service, en clair.": "The rules of the service, in plain language.",
  "En utilisant Nota, vous acceptez ces conditions. Nota est une place de marché qui met en relation des clients et des notaires du Québec. Nota n’est pas un notaire et ne pose aucun acte notarié.": "By using Nota, you accept these terms. Nota is a marketplace that connects clients with Québec notaries. Nota is not a notary and performs no notarized acts.",
  "Ce qu’est Nota": "What Nota is",
  "Un carnet public où vous proposez une date et un montant. Un notaire du Québec choisit de retenir votre demande. Nota facilite la mise en relation, rien de plus.": "A public carnet where you propose a date and an amount. A Québec notary chooses to take on your request. Nota facilitates the connection, nothing more.",
  "Vous restez maître": "You stay in charge",
  "Vous fixez la date, le montant et votre niveau d’anonymat. Aucune obligation : vous pouvez retirer une offre tant qu’aucun notaire ne l’a retenue.": "You set the date, the amount and your level of anonymity. No obligation: you can withdraw an offer as long as no notary has taken it.",
  "Gratuit pour le client": "Free for the client",
  "Publier une offre est gratuit. Nota se rémunère par une commission versée par le notaire, uniquement sur les actes complétés.": "Publishing an offer is free. Nota earns a commission paid by the notary, only on completed acts.",
  "Les conditions": "The terms",
  "Rôle de Nota.": "Nota's role.",
  "Nota fournit une plateforme de mise en relation. Nous ne rédigeons pas d’actes, ne donnons aucun conseil juridique, fiscal ou financier, et ne sommes pas partie au mandat entre vous et le notaire.": "Nota provides a matchmaking platform. We do not draft acts, give no legal, tax or financial advice, and are not a party to the mandate between you and the notary.",
  "Indépendance du notaire.": "The notary's independence.",
  "Le notaire qui retient votre demande agit en toute indépendance : il fixe ses honoraires, vérifie votre identité et rédige l’acte selon la loi. Nota n’intervient jamais dans l’acte notarié.": "The notary who takes on your request acts fully independently: they set their fees, verify your identity and draft the act according to the law. Nota never intervenes in the notarized act.",
  "Vos engagements.": "Your commitments.",
  "Vous fournissez des renseignements exacts et n’utilisez pas le service à des fins illégales ou trompeuses. Une offre publiée est un engagement de bonne foi à procéder à la date convenue.": "You provide accurate information and do not use the service for illegal or misleading purposes. A published offer is a good-faith commitment to proceed on the agreed date.",
  "Prix et commission.": "Price and commission.",
  "Le montant que vous offrez est celui que le notaire reçoit pour l’acte. La commission de Nota est prélevée auprès du notaire sur les actes complétés ; elle ne s’ajoute pas à votre montant.": "The amount you offer is what the notary receives for the act. Nota's commission is collected from the notary on completed acts; it is never added to your amount.",
  "Disponibilité.": "Availability.",
  "Le service est fourni « tel quel ». Nous visons une haute disponibilité sans garantir l’absence d’interruption. Nota peut suspendre ou refuser une offre contraire à ces conditions.": "The service is provided “as is”. We aim for high availability without guaranteeing uninterrupted service. Nota may suspend or refuse an offer that violates these terms.",
  "Responsabilité.": "Liability.",
  "Dans la mesure permise par la loi, la responsabilité de Nota se limite à la mise en relation. La qualité, la validité et l’exécution de l’acte relèvent du notaire.": "To the extent permitted by law, Nota's liability is limited to the matchmaking. The quality, validity and execution of the act are the notary's responsibility.",
  "Données personnelles.": "Personal data.",
  "Le traitement de vos renseignements est décrit dans notre": "How we handle your information is described in our",
  "politique de confidentialité": "privacy policy",
  "(Loi 25).": "(Law 25).",
  "Modifications.": "Changes.",
  "Ces conditions peuvent évoluer. La version en vigueur est celle affichée ici. Les changements importants vous seront signalés.": "These terms may evolve. The version in force is the one displayed here. Important changes will be flagged to you.",
  "Droit applicable.": "Governing law.",
  "Ces conditions sont régies par le droit du Québec. Tout litige relève des tribunaux du district judiciaire de Québec.": "These terms are governed by Québec law. Any dispute falls under the courts of the judicial district of Québec.",
  "Contact.": "Contact.",
  "Une question ? Écrivez à": "A question? Write to",
  "Vos droits sur Nota.": "Your rights on Nota.",
  "Nos engagements envers vous, le client. Cette charte guide chaque décision que nous prenons.": "Our commitments to you, the client. This charter guides every decision we make.",
  "Vous gardez le contrôle": "You keep control",
  "Vous choisissez la date, le montant et votre anonymat. Personne ne décide à votre place.": "You choose the date, the amount and your anonymity. No one decides for you.",
  "Aucune pression": "No pressure",
  "Aucune obligation, aucun démarchage. Vous retirez une offre tant qu’elle n’est pas retenue, sans frais.": "No obligation, no solicitation. You can withdraw an offer as long as it has not been taken, at no charge.",
  "Un notaire indépendant": "An independent notary",
  "Le notaire vérifie votre identité et rédige l’acte selon la loi. Nota n’intervient jamais dans l’acte.": "The notary verifies your identity and drafts the act according to the law. Nota never intervenes in the act.",
  "Nos engagements": "Our commitments",
  "Gratuité.": "Free of charge.",
  "Publier une offre et consulter le carnet est gratuit pour le client, pour toujours.": "Publishing an offer and browsing the carnet is free for the client, forever.",
  "Transparence des prix.": "Price transparency.",
  "Un prix de départ clair par service, aucun frais caché. Ce que vous offrez est ce que le notaire reçoit.": "A clear starting price per service, no hidden fees. What you offer is what the notary receives.",
  "Anonymat par défaut.": "Anonymity by default.",
  "Votre offre s’affiche « Client · secteur postal ». Votre nom n’apparaît que si vous le choisissez.": "Your offer appears as “Client · postal sector”. Your name only appears if you choose it.",
  "Vos données protégées.": "Your data, protected.",
  "Hébergement au Canada, conformité à la Loi 25, aucune revente. Voir la": "Hosted in Canada, Law 25 compliance, no resale. See the",
  "confidentialité": "privacy policy",
  "Traitement équitable.": "Fair treatment.",
  "Le carnet est public et les mêmes règles s’appliquent à tous. Aucune offre n’est mise en avant contre paiement.": "The carnet is public and the same rules apply to everyone. No offer is promoted for payment.",
  "Liberté de partir.": "Freedom to leave.",
  "Vous pouvez demander la suppression de vos renseignements en tout temps.": "You can request the deletion of your information at any time.",
  "Un recours.": "Recourse.",
  "Un problème, une question ? Une personne vous répond :": "A problem, a question? A person answers you:",
  "Le carnet public des actes notariés à Québec. Vous proposez la date et le prix — un notaire retient votre demande.": "The public carnet of notarized acts in Québec. You propose the date and the price — a notary takes on your request.",
  "Explorer": "Explore",
  "Le carnet": "The carnet",
  "Légal": "Legal",
  "Nota · Fait à Québec": "Nota · Made in Québec",
  "Données hébergées au Canada · Loi 25": "Data hosted in Canada · Law 25",
  "Réserver cette date": "Reserve this date",
  "Fermer": "Close",
  "Quel acte\u00a0?": "Which act?",
  "Choisir l’acte": "Choose the act",
  "Passer devant": "Jump ahead",
  "Standard": "Standard",
  "Quelques détails": "A few details",
  "(ajustent le prix)": "(they adjust the price)",
  "Votre offre": "Your offer",
  "(pré-remplie)": "(pre-filled)",
  "Montant de l’offre": "Offer amount",
  "Choisissez un acte.": "Choose an act.",
  "Options et confidentialité": "Options and privacy",
  "Offre anonyme": "Anonymous offer",
  "Nom affiché publiquement": "Name displayed publicly",
  "Secteur postal": "Postal sector",
  "Les 3 premiers caractères de votre code postal, le seul repère de lieu que voient les notaires. Il indique votre secteur sans révéler votre adresse.": "The first 3 characters of your postal code — the only location marker notaries see. It shows your sector without revealing your address.",
  "Courriel (optionnel)": "Email (optional)",
  "Sert à vous prévenir. Jamais affiché.": "Used to notify you. Never displayed.",
  "En publiant, la date, le service, le montant et le secteur postal deviennent publics. Aucun document n’est transmis à cette étape. Données au Canada, supprimées sur demande (Loi 25).": "When you publish, the date, the service, the amount and the postal sector become public. No document is shared at this step. Data kept in Canada, deleted on request (Law 25).",
  "Offre publiée.": "Offer published.",
  "Une dernière étape la fait retenir plus vite.": "One last step gets it taken faster.",
  "Ajouter la date à mon agenda": "Add the date to my calendar",
  "Télécharger .ics": "Download .ics",
  "Google Agenda": "Google Calendar",
  "Rendre votre offre publique ?": "Make your offer public?",
  "Votre nom sera visible sur le carnet public, à côté du service, du montant et de la date. Par exemple : « votre nom · refinancement · dans 4 jours ». Les offres nominatives sont souvent retenues plus vite, mais c’est une information que vous rendez publique.": "Your name will be visible on the public carnet, next to the service, the amount and the date. For example: “your name · refinancing · in 4 days”. Named offers are often taken faster, but this is information you are making public.",
  "Rester anonyme": "Stay anonymous",
  "Afficher mon nom": "Show my name",
  "Bienvenue sur Nota": "Welcome to Nota",
  "Connectez-vous ou créez votre compte, sans mot de passe.": "Sign in or create your account — no password.",
  "Vous êtes": "You are",
  "Je suis client": "I'm a client",
  "Je suis notaire": "I'm a notary",
  "Continuer avec Google": "Continue with Google",
  "Continuer avec Facebook": "Continue with Facebook",
  "Continuer avec LinkedIn": "Continue with LinkedIn",
  "Bientôt": "Coming soon",
  "ou": "or",
  "vous@courriel.ca": "you@email.ca",
  "Première visite ou retour, c’est le même geste. Vos renseignements restent sur cet appareil.": "First visit or returning, it's the same motion. Your information stays on this device.",
  "Comment souhaitez-vous utiliser Nota\u00a0?": "How would you like to use Nota?",
  "Comment souhaitez-vous utiliser Nota ?": "How would you like to use Nota?",
  "Étape 1 sur 2": "Step 1 of 2",
  "Je cherche un notaire": "I'm looking for a notary",
  "Publiez votre demande — date et prix\u00a0; un notaire la retient.": "Publish your request — date and price; a notary takes it on.",
  "Voyez les demandes ouvertes à Québec.": "See the open requests in Québec.",
  "Changer": "Change",
  "Étape 2 sur 2": "Step 2 of 2",
  "Passer": "Skip",
  "Offres réelles du carnet —": "Real offers from the carnet —",
  "déjà retenue par un notaire.": "already taken by a notary.",
  "Demandes réelles ouvertes en ce moment, placées à leur jour de signature.": "Real requests open right now, placed on their signing day.",
  "Le carnet s’ajoute à votre agenda en un clic.": "The carnet adds to your calendar in one click.",
  "Publiée au carnet": "Published to the carnet",
  "courriel, texto, fréquence, actes": "email, text message, frequency, acts",
  "Des clients de Québec ont fixé leur date et leur prix — retenez ce qui vous convient. Inscription gratuite, payé en entier à la signature.": "Québec clients have set their date and price — take on what suits you. Free registration, paid in full at signing."
};
  var HTML = {
  "Le principe est simple : <strong>vous proposez</strong> la date et le prix de votre acte (testament, procuration ou refinancement). Au carnet public, <strong>les notaires de Québec</strong> voient votre demande et l’un d’eux la retient. L’offre rencontre la demande. Gratuit pour vous.": "The idea is simple: <strong>you propose</strong> the date and the price of your act (will, power of attorney or refinancing). On the public carnet, <strong>Québec's notaries</strong> see your request and one of them takes it on. Offer meets demand. Free for you.",
  "<strong>Gratuit pour vous</strong> : Nota se rémunère auprès du notaire.": "<strong>Free for you</strong>: Nota is paid by the notary.",
  "<span class=\"nc-soon-tag\">Bientôt</span>Vérification d’identité, inscription et <strong>réalisation complète de l’acte en ligne</strong> : recevez la demande, rencontrez le client et signez à distance. Tout le parcours notaire, de bout en bout, sans quitter Nota.": "<span class=\"nc-soon-tag\">Coming soon</span>Identity verification, onboarding and <strong>completing the entire act online</strong>: receive the request, meet the client and sign remotely. The whole notary journey, end to end, without leaving Nota.",
  "Vos données sont conservées sur des serveurs canadiens (Amazon Web Services, région <strong>ca-central-1</strong>, Montréal). Elles ne quittent pas le pays.": "Your data is stored on Canadian servers (Amazon Web Services, <strong>ca-central-1</strong> region, Montréal). It never leaves the country.",
  "<strong>Conservation.</strong> Une offre et son dossier sont conservés au plus <strong>12 mois</strong> après la date de signature, puis supprimés automatiquement. Le courriel de notification est effacé dès que l’offre est close ou expirée.": "<strong>Retention.</strong> An offer and its file are kept at most <strong>12 months</strong> after the signing date, then deleted automatically. The notification email is erased as soon as the offer is closed or expired.",
  "Les réponses de votre <strong>Dossier</strong> accompagnent l’offre. Les documents ne sont partagés qu’après qu’un notaire a retenu votre demande.": "The answers in your <strong>File</strong> travel with the offer. Documents are only shared after a notary has taken on your request.",
  "<span class=\"nc-soon-tag\">Bientôt</span>Les notaires pourront réaliser l’acte <strong>entièrement en ligne</strong> sur Nota, signature à distance comprise, sans déplacement. Aujourd’hui, vous convenez du lieu avec le notaire qui vous retient.": "<span class=\"nc-soon-tag\">Coming soon</span>Notaries will soon complete the act <strong>entirely online</strong> on Nota, remote signing included, no travel needed. For now, you agree on the location with the notary who takes you on."
};
  var RULES = compileRules([
  {
    "pattern": "^La connexion (.+?) arrive bientôt\\. Continuez avec votre courriel pour l’instant\\.$",
    "flags": "",
    "replacement": "$1 sign-in is coming soon. Continue with your email for now."
  },
  {
    "pattern": "^Bienvenue ! Vous êtes connecté comme (.+)\\.$",
    "flags": "",
    "replacement": "Welcome! You are signed in as $1."
  },
  {
    "pattern": "^Votre date approche \\(J-([0-9]+)\\)$",
    "flags": "",
    "replacement": "Your date is approaching (D-$1)"
  },
  {
    "pattern": "^à battre : (.+)$",
    "flags": "",
    "replacement": "to beat: $1"
  },
  {
    "pattern": "^retenue — (.+)$",
    "flags": "",
    "replacement": "taken — $1"
  },
  {
    "pattern": "^(.+) — 1 offre, meilleure offre (.+)$",
    "flags": "",
    "replacement": "$1 — 1 offer, best offer $2"
  },
  {
    "pattern": "^(.+) — ([0-9]+) offres, meilleure offre (.+)$",
    "flags": "",
    "replacement": "$1 — $2 offers, best offer $3"
  },
  {
    "pattern": "^(.+?)\\. À ce délai, une offre se conclut autour de (.+?) le prix de départ\\.$",
    "flags": "",
    "replacement": "$1. At this notice, an offer typically closes around $2 the starting price."
  },
  {
    "pattern": "^Afficher le détail — (.+)$",
    "flags": "",
    "replacement": "Show details — $1"
  },
  {
    "pattern": "^Masquer le détail — (.+)$",
    "flags": "",
    "replacement": "Hide details — $1"
  },
  {
    "pattern": "^(.+?) — à partir de (.+?), aucune offre ce mois\\. Retirer ce filtre\\.$",
    "flags": "",
    "replacement": "$1 — from $2, no offers this month. Remove this filter."
  },
  {
    "pattern": "^(.+?) — à partir de (.+?), aucune offre ce mois\\. Afficher le carnet pour cet acte\\.$",
    "flags": "",
    "replacement": "$1 — from $2, no offers this month. Show the carnet for this act."
  },
  {
    "pattern": "^(.+?) — à partir de (.+?), médiane des offres (.+?)\\. Retirer ce filtre\\.$",
    "flags": "",
    "replacement": "$1 — from $2, median offer $3. Remove this filter."
  },
  {
    "pattern": "^(.+?) — à partir de (.+?), médiane des offres (.+?)\\. Afficher le carnet pour cet acte\\.$",
    "flags": "",
    "replacement": "$1 — from $2, median offer $3. Show the carnet for this act."
  },
  {
    "pattern": "^Réserver un (.+)$",
    "flags": "",
    "replacement": "Book a $1"
  },
  {
    "pattern": "^(.+) · ([0-9]+)e sur ([0-9]+)$",
    "flags": "",
    "replacement": "$1 · #$2 of $3"
  },
  {
    "pattern": "^Retenu · (.+)$",
    "flags": "",
    "replacement": "Taken · $1"
  },
  {
    "pattern": "^Retenu par (.+)$",
    "flags": "",
    "replacement": "Taken by $1"
  },
  {
    "pattern": "^Retenue par un notaire$",
    "flags": "",
    "replacement": "Taken by a notary"
  },
  {
    "pattern": "^Retenue par (.+)$",
    "flags": "",
    "replacement": "Taken by $1"
  },
  {
    "pattern": "^Chances d’obtenir un notaire : ([0-9]+)[\u00a0 ]%\\. La date est (.+?), et plus elle approche, plus un notaire a de mal à s’y libérer\\.$",
    "flags": "",
    "replacement": "Chances of getting a notary: $1\u00a0%. The date is $2, and the closer it comes, the harder it is for a notary to free up."
  },
  {
    "pattern": "^Les offres en (.+?) sont déjà retenues — la place est libre, fixez votre prix\\.$",
    "flags": "",
    "replacement": "The offers for $1 are already taken — the slot is free, set your price."
  },
  {
    "pattern": "^L’offre en (.+?) est déjà retenue — la place est libre, fixez votre prix\\.$",
    "flags": "",
    "replacement": "The offer for $1 is already taken — the slot is free, set your price."
  },
  {
    "pattern": "^Aucune offre en (.+?) pour cette date\\. Soyez le premier — fixez votre prix\\.$",
    "flags": "",
    "replacement": "No offers for $1 for this date. Be the first — set your price."
  },
  {
    "pattern": "^Meilleure offre ouverte · (.+)$",
    "flags": "",
    "replacement": "Best open offer · $1"
  },
  {
    "pattern": "^Proposez plus que (.+) pour passer devant\\.$",
    "flags": "",
    "replacement": "Offer more than $1 to move ahead."
  },
  {
    "pattern": "^Passer devant · (.+)$",
    "flags": "",
    "replacement": "Move ahead · $1"
  },
  {
    "pattern": "^Prochaine dispo · (.+)$",
    "flags": "",
    "replacement": "Next availability · $1"
  },
  {
    "pattern": "^(.+) — à partir de (.+)$",
    "flags": "",
    "replacement": "$1 — from $2"
  },
  {
    "pattern": "^Prix de départ : (.+)\\.$",
    "flags": "",
    "replacement": "Starting price: $1."
  },
  {
    "pattern": "^Prix de départ ajusté : (.+)\\.$",
    "flags": "",
    "replacement": "Adjusted starting price: $1."
  },
  {
    "pattern": "^Signature (.+?) · le marché se conclut ici entre (.+?) et (.+?)\\.$",
    "flags": "",
    "replacement": "Signing $1 · the market closes here between $2 and $3."
  },
  {
    "pattern": "^([0-9.]+)× le prix de départ \\((.+)\\)$",
    "flags": "",
    "replacement": "$1× the starting price ($2)"
  },
  {
    "pattern": "^Votre offre s’affichera « Client · (.+?) »\\.$",
    "flags": "",
    "replacement": "Your offer will appear as « Client · $1 »."
  },
  {
    "pattern": "^Encore 1 caractère — format « (.+) »\\.$",
    "flags": "",
    "replacement": "1 more character — format « $1 »."
  },
  {
    "pattern": "^Encore ([0-9]+) caractères — format « (.+) »\\.$",
    "flags": "",
    "replacement": "$1 more characters — format « $2 »."
  },
  {
    "pattern": "^« (.+?) » n’est pas un secteur du Québec\\. Nota dessert Québec pour l’instant\\.$",
    "flags": "",
    "replacement": "« $1 » is not a Québec sector. Nota serves Québec for now."
  },
  {
    "pattern": "^Format attendu : une lettre, un chiffre, une lettre, comme « (.+) »\\.$",
    "flags": "",
    "replacement": "Expected format: a letter, a digit, a letter, like « $1 »."
  },
  {
    "pattern": "^Offre publiée : (.+) \\(démo locale\\)$",
    "flags": "",
    "replacement": "Offer published: $1 (local demo)"
  },
  {
    "pattern": "^Offre publiée : (.+)$",
    "flags": "",
    "replacement": "Offer published: $1"
  },
  {
    "pattern": "^Signature notariée — (.+)$",
    "flags": "",
    "replacement": "Notarized signing — $1"
  },
  {
    "pattern": "^Offre publiée sur Nota : (.+)\\.$",
    "flags": "",
    "replacement": "Offer published on Nota: $1."
  },
  {
    "pattern": "^✓ Tout est prêt · ([0-9]+) / ([0-9]+)$",
    "flags": "",
    "replacement": "✓ All set · $1 / $2"
  },
  {
    "pattern": "^([0-9]+) / ([0-9]+) fournis$",
    "flags": "",
    "replacement": "$1 / $2 provided"
  },
  {
    "pattern": "^Marquer « (.+) » comme validé$",
    "flags": "",
    "replacement": "Mark « $1 » as validated"
  },
  {
    "pattern": "^Sélectionné : (.+)\\. Reste sur votre appareil\\.$",
    "flags": "",
    "replacement": "Selected: $1. Stays on your device."
  },
  {
    "pattern": "^Prix de départ déterminé : (.+)\\.$",
    "flags": "",
    "replacement": "Determined starting price: $1."
  },
  {
    "pattern": "^à compléter : (.+) · consentement de partage requis\\.$",
    "flags": "",
    "replacement": "to complete: $1 · sharing consent required."
  },
  {
    "pattern": "^à compléter : (.+)\\.$",
    "flags": "",
    "replacement": "to complete: $1."
  },
  {
    "pattern": "^Acte complété\\. Commission Nota : (.+)\\.$",
    "flags": "",
    "replacement": "Act completed. Nota commission: $1."
  },
  {
    "pattern": "^Abonné : (.+)$",
    "flags": "",
    "replacement": "Subscribed: $1"
  },
  {
    "pattern": "^Console ouverte pour (.+)\\.$",
    "flags": "",
    "replacement": "Console opened for $1."
  },
  {
    "pattern": "^Se connecter pour retenir : (.+)$",
    "flags": "",
    "replacement": "Sign in to take on: $1"
  },
  {
    "pattern": "^Demandes ouvertes · ([0-9]+)$",
    "flags": "",
    "replacement": "Open requests · $1"
  },
  {
    "pattern": "^(.+) · transmis à la signature$",
    "flags": "",
    "replacement": "$1 · shared at signing"
  },
  {
    "pattern": "^Valeur (.+) · commission Nota (.+)$",
    "flags": "",
    "replacement": "Value $1 · Nota commission $2"
  },
  {
    "pattern": "^Facteurs : (.+)$",
    "flags": "",
    "replacement": "Factors: $1"
  },
  {
    "pattern": "^Écrire à (.+)$",
    "flags": "",
    "replacement": "Email $1"
  },
  {
    "pattern": "^Appeler (.+)$",
    "flags": "",
    "replacement": "Call $1"
  },
  {
    "pattern": "Aucune offre en ",
    "flags": "g",
    "replacement": "No offers for "
  },
  {
    "pattern": "^Aucune offre · ",
    "flags": "g",
    "replacement": "No offers · "
  },
  {
    "pattern": " · soyez le premier$",
    "flags": "g",
    "replacement": " · be the first"
  },
  {
    "pattern": "([0-9]+) offres ouvertes",
    "flags": "g",
    "replacement": "$1 open offers"
  },
  {
    "pattern": "1 offre ouverte",
    "flags": "g",
    "replacement": "1 open offer"
  },
  {
    "pattern": "([0-9]+) autres offres",
    "flags": "g",
    "replacement": "$1 other offers"
  },
  {
    "pattern": "1 autre offre",
    "flags": "g",
    "replacement": "1 other offer"
  },
  {
    "pattern": "([0-9]+) offres passées",
    "flags": "g",
    "replacement": "$1 past offers"
  },
  {
    "pattern": "1 offre passée",
    "flags": "g",
    "replacement": "1 past offer"
  },
  {
    "pattern": "([0-9]+) offres",
    "flags": "g",
    "replacement": "$1 offers"
  },
  {
    "pattern": "\\b0 offre\\b",
    "flags": "g",
    "replacement": "0 offers"
  },
  {
    "pattern": "\\b1 offre\\b",
    "flags": "g",
    "replacement": "1 offer"
  },
  {
    "pattern": "([0-9]+) autres demandes",
    "flags": "g",
    "replacement": "$1 other requests"
  },
  {
    "pattern": "1 autre demande",
    "flags": "g",
    "replacement": "1 other request"
  },
  {
    "pattern": "([0-9]+) demandes",
    "flags": "g",
    "replacement": "$1 requests"
  },
  {
    "pattern": "\\b1 demande\\b",
    "flags": "g",
    "replacement": "1 request"
  },
  {
    "pattern": "([0-9]+) retenues",
    "flags": "g",
    "replacement": "$1 taken"
  },
  {
    "pattern": "\\b1 retenue\\b",
    "flags": "g",
    "replacement": "1 taken"
  },
  {
    "pattern": "([0-9]+) dossiers à compléter",
    "flags": "g",
    "replacement": "$1 files to complete"
  },
  {
    "pattern": "1 dossier à compléter",
    "flags": "g",
    "replacement": "1 file to complete"
  },
  {
    "pattern": " · valeur estimée ",
    "flags": "g",
    "replacement": " · estimated value "
  },
  {
    "pattern": "La commission n’est prélevée qu’à la signature, sur la valeur confirmée\\.",
    "flags": "g",
    "replacement": "The commission is only charged at signing, on the confirmed value."
  },
  {
    "pattern": "dans ([0-9]+) jours",
    "flags": "g",
    "replacement": "in $1 days"
  },
  {
    "pattern": "dans 1 jour\\b",
    "flags": "g",
    "replacement": "in 1 day"
  },
  {
    "pattern": "il y a ([0-9]+) jours",
    "flags": "g",
    "replacement": "$1 days ago"
  },
  {
    "pattern": "il y a 1 jour\\b",
    "flags": "g",
    "replacement": "1 day ago"
  },
  {
    "pattern": "aujourd’hui",
    "flags": "g",
    "replacement": "today"
  },
  {
    "pattern": "\\bdemain\\b",
    "flags": "g",
    "replacement": "tomorrow"
  },
  {
    "pattern": "· passé$",
    "flags": "g",
    "replacement": "· past"
  },
  {
    "pattern": " ce mois-ci",
    "flags": "g",
    "replacement": " this month"
  },
  {
    "pattern": " ce mois$",
    "flags": "g",
    "replacement": " this month"
  },
  {
    "pattern": " au carnet$",
    "flags": "g",
    "replacement": " in the carnet"
  },
  {
    "pattern": " ce jour, tous actes confondus",
    "flags": "g",
    "replacement": " on this day, all acts combined"
  },
  {
    "pattern": "(offer|offers) en ",
    "flags": "g",
    "replacement": "$1 for "
  },
  {
    "pattern": "· retenue par un notaire",
    "flags": "g",
    "replacement": "· taken by a notary"
  },
  {
    "pattern": "· retenue par ",
    "flags": "g",
    "replacement": "· taken by "
  },
  {
    "pattern": "cet acte",
    "flags": "g",
    "replacement": "this act"
  },
  {
    "pattern": "^Voir les ",
    "flags": "g",
    "replacement": "See the "
  },
  {
    "pattern": "· départ ",
    "flags": "g",
    "replacement": "· starting "
  },
  {
    "pattern": " à retenir$",
    "flags": "g",
    "replacement": " to take on"
  },
  {
    "pattern": "^L’offre doit être d’au moins (.+)\\.$",
    "flags": "",
    "replacement": "The offer must be at least $1."
  },
  {
    "pattern": "^L’offre ne peut dépasser (.+) \\((.+)×\\)\\.$",
    "flags": "",
    "replacement": "The offer cannot exceed $1 ($2×)."
  },
  {
    "pattern": "^Réponse requise : (.+)$",
    "flags": "",
    "replacement": "Answer required: $1"
  },
  {
    "pattern": "Testament et mandat de protection(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Will and protection mandate"
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
    "pattern": "Procuration(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Power of attorney"
  },
  {
    "pattern": "Prioritaire(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Priority"
  },
  {
    "pattern": "Testament(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Will"
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
  }
]);
  // === END DICTIONARY ========================================================

  function compileRules(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      try { out.push({ re: new RegExp(list[i].pattern, list[i].flags || ''), sub: list[i].replacement }); }
      catch (e) { /* a bad pattern must not take the app down */ }
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
    // Reload rather than re-render: app.js builds its Intl formatters from
    // locale() at startup, and every rendered string re-derives on boot.
    if (typeof location !== 'undefined') location.reload();
  }

  // --- String translation ----------------------------------------------------
  // Collapse ASCII whitespace only: U+00A0 is meaningful French typography
  // (thousands groups, before « $ ») and takes part in dictionary keys.
  function normalize(s) { return String(s == null ? '' : s).replace(/[ \t\r\n]+/g, ' ').trim(); }

  // "1 250 $" -> "$1,250" (NBSP-grouped, trailing sign). Runs last so rule
  // replacements can pass amounts through untouched.
  function moneyEn(s) {
    return s.replace(/(\d{1,3}(?:\u00a0\d{3})*)(?:,(\d{1,2}))?\u00a0\$/g, function (m, d, c) {
      return '$' + d.replace(/\u00a0/g, ',') + (c ? '.' + c : '');
    });
  }

  // Rules run IN ORDER, each on the output of the previous one: anchored
  // full-sentence rules translate the frame and pass variable segments
  // through; the trailing fragment rules then finish those segments
  // (counts, relative dates, connectives). Order is part of the contract.
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

  // True when the string has an explicit English form (exact entry or rule) —
  // used by the coverage tests; identical-in-both-languages entries count.
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

  // Our own writes must not loop back through the observer.
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

  // innerHTML serialization differences across engines: fold the entity forms
  // back to characters so the key matches what the source markup means.
  function normalizeHtml(html) {
    return normalize(html).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }

  function translateElement(el) {
    if (!el || el.nodeType !== 1) return;
    var tag = el.nodeName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'svg') return;
    if (el.hasAttribute && el.hasAttribute('data-i18n-skip')) return;

    // Whole-element translation for mixed inline markup (see HTML map).
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

  // --- Head / SEO ------------------------------------------------------------
  function translateHead() {
    var d = document;
    var title = d.querySelector('title');
    if (title && title.firstChild) translateTextNode(title.firstChild);
    var metas = [
      'meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]',
      'meta[property="og:image:alt"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]',
      'meta[name="twitter:image:alt"]',
    ];
    for (var i = 0; i < metas.length; i++) {
      var m = d.querySelector(metas[i]);
      if (m) m.setAttribute('content', translateEn(m.getAttribute('content') || ''));
    }
    var ogl = d.querySelector('meta[property="og:locale"]');
    if (ogl) ogl.setAttribute('content', 'en_CA');
    var man = d.querySelector('link[rel="manifest"]');
    if (man) man.setAttribute('href', 'manifest.en.webmanifest');
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
  // Buttons carry data-lang-toggle (value "short" shows "EN"/"FR", anything
  // else the full name) and data-i18n-skip so the walker leaves them alone.
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
    translateHead();
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
