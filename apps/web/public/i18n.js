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
  "Choisir ma date et mon prix": "Choose my date and price",
  "Consulter les demandes": "Browse requests",
  "Ouvrir le carnet →": "Open the calendar →",
  "Choisissez votre date.": "Choose your date.",
  "Dans le carnet, cliquez sur le jour qui vous convient.": "In the calendar, click the day that works for you.",
  "✓ Refinancement": "✓ Refinancing",
  "Décrivez votre refinancement.": "Describe your refinancing.",
  "Choisissez l’acte, puis répondez aux questions.": "Choose your act, then answer the questions.",
  "Votre offre et le service Nota sont présentés séparément.": "Your offer and the Nota service are shown separately.",
  "Publier mon offre →": "Post my offer →",
  "✓ Offre publiée": "✓ Offer posted",
  "Publiez votre offre.": "Post your offer.",
  "Un notaire peut alors retenir votre demande.": "A notary can then accept your request.",
  "Essayer avec le guide →": "Try it with the guide →",

  "Aucune demande ouverte": "No open request",
  "Personne n’a publié de date pour ce mois-ci.": "Nobody has posted a date for this month.",
  "Les demandes de Québec arrivent ici dès qu’un client publie sa date et son prix. En attendant, gardez le carnet à l’œil sans revenir sur le site.": "Requests from Québec City land here as soon as a client posts their date and price. Until then, keep an eye on the carnet without coming back to the site.",
  "Recevoir les demandes dans mon agenda": "Get requests in my calendar",
  "Créer mon compte gratuit": "Create my free account",

  "Guide interactif": "Interactive guide",
  "Votre date de signature": "Your signing date",
  "Prenons un refinancement comme exemple. Cliquez sur la date qui vous convient, même si elle contient déjà des offres.": "Let’s use refinancing as an example. Click the date that works for you, even if it already has offers.",
  "Votre acte": "Your notarial act",
  "Pour notre exemple, choisissez « Refinancement ». Vous pouvez aussi choisir l’acte dont vous avez besoin.": "For our example, choose “Refinancing”. You can also choose the act you need.",
  "Votre situation": "Your situation",
  "Répondez aux questions avec les renseignements de votre dossier. Le notaire pourra ainsi évaluer votre demande.": "Answer the questions using your own file’s details so the notary can assess your request.",
  "Votre prix": "Your price",
  "Vérifiez votre offre, le prix du service Nota et le total. Vous pouvez ajuster votre offre avant de continuer.": "Review your offer, the Nota service price and the total. You can adjust your offer before continuing.",
  "Vos coordonnées": "Your contact details",
  "Indiquez le lieu de signature et vos coordonnées pour qu’un notaire puisse vous joindre.": "Enter the signing location and your contact details so a notary can reach you.",
  "À vous de publier": "Ready to post",
  "Vérifiez votre demande, puis cliquez sur « Publier mon offre » lorsque vous êtes prêt. Un notaire devra la retenir pour confirmer la suite.": "Review your request, then click “Post my offer” when you are ready. A notary must accept it to confirm the next steps.",
  "Touchez « Préparer mon offre » pour ajouter votre projet et votre prix à cette date.": "Tap “Prepare my offer” to add your project and your price to this date.",
  "Préparer mon offre": "Prepare my offer",
  "Ajoutez votre projet et votre prix. Vous vérifierez le tout avant de publier.": "Add your project and your price. You can review everything before publishing.",
  "Offres déjà publiées": "Published offers",
  "Aucune offre publiée pour cette date.": "No offers have been published for this date.",
  "Modifier la date": "Change the date",
  "Terminer le guide": "Finish the guide",
  "Me montrer": "Show me",
  "Modifier les prêteurs": "Change lender preferences",
  "Vos préférences de prêteurs masquent ces demandes.": "Your lender preferences are hiding these requests.",
  "Effacer les filtres": "Clear filters",
  "Voir les demandes disponibles": "See available requests",
  "Cette demande n’est plus disponible pour votre profil. Choisissez une autre demande.": "This request is no longer available for your profile. Choose another request.",
  "Confirmez l’heure du rendez-vous et les documents à préparer.": "Confirm the appointment time and the documents to prepare.",
  "Bonjour, j’ai retenu votre demande dans Nota. Quelle heure vous conviendrait pour la signature ? Nous pouvons aussi préciser les documents à préparer ici.": "Hello, I’ve accepted your request in Nota. What time would work for you for the signing? We can also discuss the documents to prepare here.",
  "Ouvrez le lien d’une offre dans votre agenda. Connectez-vous au besoin, vérifiez le montant et la date, puis confirmez avec Retenir. Le dossier du client s’ouvre dans Nota.": "Open an offer’s link in your calendar. Sign in if needed, review the amount and date, then confirm with Take on. The client’s file opens in Nota.",
  "en plus de vos honoraires": "in addition to your fees",
  "Choisissez une offre dans votre agenda.": "Choose an offer in your calendar.",
  "Vérifiez et confirmez dans Nota.": "Review and confirm in Nota.",
  "Le lien ouvre directement cette demande après connexion.": "The link opens this request directly after sign-in.",
  "Cette demande vous convient ?": "Does this request work for you?",
  "Honoraires et paiement": "Fees and payment",
  "Signature et déplacement": "Signing and travel",
  "Secteur du client": "Client’s area",
  "Distance de votre étude": "Distance from your office",
  "Non précisée": "Not specified",
  "Offre valide jusqu’au": "Offer valid until",
  "L’heure de signature est à convenir avec le client.": "Arrange the signing time with the client.",
  "Dossier et documents": "File and documents",
  "L’état du dossier indique si les renseignements requis et le consentement sont reçus. Les documents restent à vérifier.": "File status indicates whether the required information and consent have been received. Documents still need to be reviewed.",
  "Éléments à compléter": "Items to complete",
  "Aucun élément manquant signalé.": "No missing items reported.",
  "La liste des éléments manquants n’est pas disponible.": "The list of missing items is unavailable.",
  "Renseignements sur la demande": "Request details",
  "Aucun renseignement supplémentaire fourni.": "No additional information provided.",
  "Vos démarches sur cette offre": "Your activity on this offer",
  "Frais Nota payés par le client": "Nota fees paid by the client",
  "Documents à obtenir": "Documents to collect",
  "Quand le montant est-il réservé ?": "When is the amount held?",
  "Conditions d’annulation et de désistement": "Cancellation and withdrawal terms",
  "Confirmez pour échanger vos coordonnées avec le client et ouvrir la conversation Nota.": "Confirm to exchange contact details with the client and open the Nota conversation.",
  "La demande n’a pas été retenue. Réessayez.": "The request was not accepted. Try again.",
  "Cette demande n’est plus disponible pour votre profil.": "This request is no longer available for your profile.",
  // Profile workspace and referral sharing.
  "Vérifiez votre secteur postal (ex. : G1R).": "Check your postal sector (e.g. G1R).",
  "Votre lien est prêt à partager.": "Your link is ready to share.",
  "Vous n’avez pas encore publié d’offre. Choisissez une date au carnet pour envoyer votre première demande.": "You haven’t posted an offer yet. Choose a date in the calendar to send your first request.",
  "Vos démarches, vos préférences et votre parrainage, au même endroit.": "Your requests, preferences and referrals, all in one place.",
  "Sections du profil": "Profile sections",
  "Dans votre espace": "In your account",
  "Un lien à partager. Une récompense quand la référence aboutit.": "A link to share. A reward when your referral succeeds.",
  "Client référé": "Referred client",
  "Notaire référé": "Referred notary",
  "Quand sa demande est retenue par un notaire.": "When a notary accepts their request.",
  "Une seule fois, à son premier acte retenu.": "Once, for their first accepted act.",
  "Le versement suit la signature de l’acte. Une demande annulée avant la signature ne donne lieu à aucun versement.": "Payment follows the signing of the act. A request cancelled before signing does not qualify for payment.",
  "Votre prochain bon contact commence ici.": "Your next connection starts here.",
  "Choisissez votre code, confirmez votre courriel, puis partagez votre lien.": "Choose your code, confirm your email, then share your link.",
  "Programme réservé aux professionnels qui ne sont pas notaires.": "This program is reserved for professionals who are not notaries.",
  "Code actif": "Active code",
  "Vos récompenses et leur suivi vous sont envoyés par courriel.": "Your rewards and updates are sent to you by email.",
  "Voir le programme": "View the program",
  "Enregistrement automatique sur cet appareil.": "Automatically saved on this device.",
  "Modifications enregistrées sur cet appareil.": "Changes saved on this device.",
  "Les courriels se règlent séparément des notifications dans l’application.": "Email preferences are managed separately from in-app notifications.",
  "Coordonnées et code": "Contact details and code",

  "Votre semaine au complet.": "Your whole week.",
  "Les nouvelles offres arrivent à la bonne date.": "New offers arrive on the right date.",
  "Le notaire ajoute Nota à son agenda.": "The notary adds Nota to their calendar.",
  "Ouvrez l’offre dans Nota.": "Open the offer in Nota.",
  "Vérifiez, puis retenez la demande.": "Review, then take on the request.",
  "Demande retenue. Le dossier est à vous.": "Request taken. The file is yours.",
  "Google Agenda · Outlook · Apple Calendrier": "Google Calendar · Outlook · Apple Calendar",
  "Votre espace notaire · Application Nota": "Your notary space · Nota application",
  "Votre décision est confirmée dans Nota.": "Your decision is confirmed in Nota.",
  "Les coordonnées du client sont débloquées.": "The client’s contact details are unlocked.",
  "Exemple de démonstration": "Demo example",
  "Le client a maintenant son notaire.": "The client now has a notary.",
  "La demande est retenue. Les échanges peuvent commencer.": "The request is accepted. The conversation can begin.",
  "Confirmez l’ajout dans votre calendrier.": "Confirm the subscription in your calendar.",
  "Nouvelle offre": "New offer",
  "Mercredi 23 septembre": "Wednesday, September 23",
  "Le client est prévenu. Vous pouvez échanger dans Nota.": "The client is notified. You can talk in Nota.",
  "Un notaire ajoute Nota à son agenda, reçoit une nouvelle offre, l’ouvre dans Nota et confirme sa prise en charge. Démonstration avec l’application réelle.": "A notary adds Nota to their calendar, receives a new offer, opens it in Nota and confirms acceptance. Demonstration using the real application.",
  "Tout le mois, d’un coup d’œil.": "The whole month at a glance.",
  "Mois": "Month",
  "Vue complète de la semaine, puis du mois, avec les demandes Nota dans Google Agenda, Outlook et Apple Calendrier.": "A full week, then a full month, with Nota requests in Google Calendar, Outlook and Apple Calendar.",
  "Les demandes à la bonne date": "Requests on the right date",
  "Chaque demande indique le service, la date de signature et le montant offert.": "Each request shows the service, signing date and offered amount.",
  "Vous décidez quoi retenir": "You decide what to accept",
  "Consultez les détails dans Nota avant de retenir une demande.": "Review the details in Nota before accepting a request.",
  "Réessayer l’animation": "Retry animation",
  "Nota, dans votre agenda.": "Nota, in your calendar.",
  "Une demande sur Nota.": "A request on Nota.",
  "Elle se synchronise.": "It syncs to your calendar.",
  "Ouvrez-la dans Nota.": "Open it in Nota.",
  "Apple Calendrier": "Apple Calendar",
  "Nota synchronise les demandes avec Google Agenda, Outlook ou Apple Calendrier. Ouvrez une demande pour la consulter dans Nota.": "Nota syncs requests to Google Calendar, Outlook or Apple Calendar. Open a request to review it in Nota.",
  "Nota dans votre agenda — Démonstration": "Nota in your calendar — Demo",
  "Votre agenda.": "Your calendar.",
  "Les demandes Nota apparaissent.": "Nota requests appear.",
  "Ouvrez une demande.": "Open a request.",
  "Illustration · Sans son": "Illustration · No sound",
  "Illustration": "Illustration",
  "Les demandes Nota apparaissent dans votre agenda. Ouvrez une demande pour la consulter dans Nota.": "Nota requests appear in your calendar. Open a request to review it in Nota.",
  "Réunion": "Meeting",
  "Rencontre": "Appointment",
  "21 septembre": "September 21",
  "Demande Nota": "Nota request",
  // Calendar explainer: provider illustrations and player controls.
  "GMAIL + GOOGLE AGENDA": "GMAIL + GOOGLE CALENDAR",
  "Créer": "Create",
  "Paramètres": "Settings",
  "Nota dans Gmail et Outlook — Démonstration": "Nota in Gmail and Outlook — Demo",
  "Voyez comment les demandes Nota apparaissent dans Google Agenda et Outlook, puis comment les ouvrir dans Nota.": "See how Nota requests appear in Google Calendar and Outlook, and how to open them in Nota.",
  "Voir Nota dans Gmail et Outlook": "See Nota in Gmail and Outlook",
  "Retour à l’espace notaire": "Back to the notary workspace",
  "Animation du calendrier Nota": "Nota calendar animation",
  "Lire l’animation": "Play animation",
  "Mettre en pause": "Pause",
  "Revoir l’animation": "Replay animation",
  "Recommencer l’animation": "Restart animation",
  "Position dans l’animation": "Animation position",
  "Chapitres de l’animation": "Animation chapters",
  "Gmail et Google Agenda": "Gmail and Google Calendar",
  "Ouvrir et retenir dans Nota": "Open and retain in Nota",
  "Ajouter Nota à mon agenda": "Add Nota to my calendar",
  "Lire les étapes": "Read the steps",
  "Les demandes s’affichent à la journée. L’heure de signature se convient avec le client. Vérifiez la disponibilité et les conditions dans Nota avant de retenir une demande.": "Requests appear as all-day events. Arrange the signing time with the client. Check availability and conditions in Nota before retaining a request.",
  "Ajoutez le calendrier Nota dans Google Agenda ou Outlook. Les demandes apparaissent à leur date de signature. Ouvrez leur lien dans Nota, connectez-vous et vérifiez les conditions avant de confirmer votre acceptation.": "Add the Nota calendar to Google Calendar or Outlook. Requests appear on their signing date. Open their link in Nota, sign in, and check the conditions before confirming your acceptance.",
  "Septembre 2026": "September 2026",
  "L M M J V S D": "M T W T F S S",
  "Rechercher dans les messages": "Search mail",
  "Boîte de réception": "Inbox",
  "Messages suivis": "Starred",
  "Messages envoyés": "Sent",
  "Brouillons": "Drafts",
  "Libellés": "Labels",
  "Dossiers en cours": "Current files",
  "Rechercher": "Search",
  "Favoris": "Favorites",
  "Éléments envoyés": "Sent Items",
  "Éléments supprimés": "Deleted Items",
  "Principale": "Primary",
  "Équipe administrative": "Office team",
  "Suivi des dossiers": "File follow-up",
  "Rencontre d’équipe": "Team meeting",
  "Documents à vérifier": "Documents to review",
  "Suivi de la semaine": "Weekly follow-up",
  "Votre prochaine rencontre": "Your next meeting",
  "Disponibilités de l’étude": "Office availability",
  "Applications Google": "Google apps",
  "21 – 27 septembre 2026": "September 21–27, 2026",
  "Semaine": "Week",
  "Nouvel événement": "New event",
  "Mes agendas": "My calendars",
  "Demandes Nota": "Nota requests",
  "Mon étude": "My office",
  "Autres calendriers": "Other calendars",
  "Nota — demandes": "Nota — requests",
  "Journée": "All-day",
  "Signature à l’étude": "Office signing",
  "Suivi de dossier": "File follow-up",
  "Rencontre client": "Client meeting",
  "S’abonner à un agenda": "Subscribe to calendar",
  "Créer un calendrier vide": "Create blank calendar",
  "Charger à partir d’un fichier": "Upload from file",
  "Lien du calendrier Nota": "Nota calendar link",
  "Nom du calendrier": "Calendar name",
  "Couleur du calendrier": "Calendar color",
  "Les nouvelles demandes suivront la synchronisation de Google.": "New requests will follow Google’s sync schedule.",
  "Ajouter un agenda": "Add calendar",
  "Importer": "Import",
  "Calendrier ajouté": "Calendar added",
  "Général": "General",
  "Lundi 21 septembre · Toute la journée": "Monday, September 21 · All day",
  "Ouvrez la demande pour vérifier sa disponibilité.": "Open the request to check its availability.",
  "Ouvrir dans Nota": "Open in Nota",
  "Mes signatures": "My signings",
  "Après votre connexion à Nota": "After signing in to Nota",
  "DEMANDE OUVERTE": "OPEN REQUEST",
  "Lundi 21 septembre 2026": "Monday, September 21, 2026",
  "Honoraires proposés": "Proposed fees",
  "Exemple de demande": "Sample request",
  "Avant de vous engager": "Before you commit",
  "Vérifiez les renseignements disponibles et les conditions.": "Review the available information and conditions.",
  "Vous pouvez accepter, proposer vos honoraires ou passer.": "You can accept, propose your fees, or pass.",
  "Proposer mes honoraires": "Propose my fees",
  "Données fictives": "Fictional data",
  "Lisez les conditions avant de confirmer.": "Read the conditions before confirming.",
  "Votre confirmation engage la prise en charge de la demande.": "Your confirmation commits you to taking on the request.",
  "Retrouvez le dossier dans votre espace Nota.": "Find the file in your Nota workspace.",
  "Des demandes dans votre calendrier.": "Requests in your calendar.",
  "La décision vous appartient.": "The decision is yours.",
  "POUR LES NOTAIRES": "FOR NOTARIES",
  "Mises à jour selon la synchronisation de votre agenda.": "Updates follow your calendar’s sync schedule.",
  "Reproduction animée · Données fictives · Étapes condensées": "Animated reproduction · Fictional data · Condensed steps",
  "Vous connaissez déjà Gmail.": "You already know Gmail.",
  "Vous utilisez Gmail? Nota ajoute les demandes de clients à votre Google Agenda.": "Use Gmail? Nota adds client requests to your Google Calendar.",
  "Votre calendrier habituel.": "Your familiar calendar.",
  "Dans Google Agenda, ouvrez Autres agendas, puis À partir de l’URL.": "In Google Calendar, open Other calendars, then From URL.",
  "Ajoutez Nota une seule fois.": "Add Nota once.",
  "Copiez le lien fourni par Nota, collez-le ici, puis confirmez l’ajout.": "Copy the link provided by Nota, paste it here, then confirm.",
  "Les demandes arrivent dans votre agenda.": "Requests arrive in your calendar.",
  "Après la synchronisation, les demandes apparaissent à leur date de signature.": "After syncing, requests appear on their signing date.",
  "Vous préférez Outlook?": "Prefer Outlook?",
  "Dans Outlook aussi, partez du calendrier que vous utilisez déjà.": "In Outlook too, start from the calendar you already use.",
  "Le même geste dans Outlook.": "The same step in Outlook.",
  "Ajouter un calendrier, S’abonner à partir du web : collez le lien Nota.": "Add calendar, Subscribe from web: paste the Nota link.",
  "Une demande vous intéresse?": "Interested in a request?",
  "Ouvrez l’événement, puis son lien vers Nota pour consulter la demande.": "Open the event, then its Nota link to review the request.",
  "Vous choisissez dans Nota.": "You choose in Nota.",
  "Connectez-vous à Nota. Vérifiez la disponibilité, la date, les honoraires et les conditions.": "Sign in to Nota. Check availability, the date, fees, and conditions.",
  "Vous gardez le dernier mot.": "You have the final say.",
  "Cliquez sur Retenir, lisez les conditions, puis confirmez votre acceptation.": "Click Retain, read the conditions, then confirm your acceptance.",
  "Nota met les demandes sous vos yeux. Vous décidez lesquelles accepter.": "Nota puts requests in front of you. You decide which ones to accept.",
  "Posez votre question ici, en tout temps. Un assistant IA peut vous guider; une personne peut prendre le relais dans cette conversation.": "Ask your question here at any time. An AI assistant can guide you; a person can take over in this conversation.",
  "Une personne prendra le relais ici. Vous pouvez revenir dans ce navigateur pour lire sa réponse.": "A person will take over here. You can return on this browser to read the reply.",
  "Parler à une personne": "Talk to a person",
  "Envoyez ou effacez votre brouillon avant de demander une personne.": "Send or clear your draft before asking for a person.",
  "Ajoutez Nota à votre agenda.": "Add Nota to your calendar.",
  "Le calendrier des demandes notariales, à ajouter à Google\u00a0Agenda, Outlook ou Apple\u00a0Calendrier.": "A calendar of notarial requests to add to Google\u00a0Calendar, Outlook or Apple\u00a0Calendar.",
  "Gratuit · Aucun compte Nota requis": "Free · No Nota account required",
  "Choisissez votre calendrier": "Choose your calendar",
  "Sélectionnez votre application, puis confirmez l’ajout.": "Select your app, then confirm the calendar subscription.",
  "Voir les demandes et le fonctionnement": "Browse requests and see how it works",
  "Accéder à mon espace notaire": "Access my notary workspace",
  "Vos obligations professionnelles": "Your professional obligations",
  "Les mises à jour suivent la fréquence de synchronisation de votre agenda.": "Updates follow your calendar’s sync schedule.",
  "Demandes disponibles": "Available requests",
  "Télécharger le calendrier (.ics)": "Download the calendar (.ics)",
  "Un fichier .ics téléchargé est une copie ponctuelle, sans mises à jour.": "A downloaded .ics file is a one-time copy, without updates.",
  // Calendar journey and professional obligations.
  "Les offres clients, dans votre agenda.": "Client offers, in your calendar.",
  "Ajoutez le calendrier Nota à Google, Outlook ou Apple. Ouvrez une offre depuis votre agenda, consultez le dossier et confirmez votre acceptation dans Nota.": "Add the Nota calendar to Google, Outlook or Apple. Open an offer from your calendar, review the file and confirm your acceptance in Nota.",
  "Un abonnement. Des offres à consulter. Vous décidez.": "One subscription. Offers to review. You decide.",
  "Des besoins urgents, des occasions à saisir": "Urgent needs, opportunities to consider",
  "Une échéance rapprochée peut rendre une offre avantageuse. La célérité exceptionnelle fait partie des facteurs d’honoraires reconnus; le montant doit rester juste et raisonnable (art. 49 du Code de déontologie).": "A near deadline can make an offer attractive. Exceptional speed is a recognized fee factor; the amount must remain fair and reasonable (s. 49 of the Code of ethics).",
  "De l’agenda à l’acceptation": "From your calendar to acceptance",
  "Cliquez sur le lien de l’offre dans votre agenda. Connectez-vous à Nota, vérifiez le montant, la date et les renseignements disponibles, puis cliquez sur Retenir et confirmez. Vous pouvez aussi proposer vos honoraires ou passer.": "Click the offer link in your calendar. Sign in to Nota, check the amount, date and available information, then click Retain and confirm. You can also propose your own fees or pass.",
  "Abonnez-vous une fois : les nouvelles offres apparaissent à leur date de signature lors de la prochaine synchronisation de votre agenda.": "Subscribe once: new offers appear on their signing date when your calendar next syncs.",
  "Google, Outlook ou Apple détermine la fréquence de synchronisation : la réception n’est pas instantanée. Un fichier .ics téléchargé est une copie ponctuelle. Ouvrez l’offre dans Nota pour vérifier sa disponibilité avant de la retenir.": "Google, Outlook or Apple determines the sync frequency: delivery is not instant. A downloaded .ics file is a one-time copy. Open the offer in Nota to check its availability before retaining it.",
  "Votre indépendance et vos obligations restent entières.": "Your independence and professional duties remain unchanged.",
  "Nota verse au notaire 100 % du montant offert. Son prix distinct, facturé au client, reste à faire qualifier juridiquement au regard des règles sur les intermédiaires.": "Nota transfers 100% of the offered amount to the notary. Its separate client fee still requires legal assessment under the rules governing intermediaries.",
  "Les restrictions sur le partage d’honoraires et les conventions compromettant votre indépendance s’appliquent. Vous conservez le contrôle de votre mandat et de vos actes professionnels.": "Restrictions on fee sharing and agreements compromising your independence apply. You retain control of your mandate and professional acts.",
  "Vous évaluez les honoraires selon les services à rendre, y compris la célérité exceptionnelle. Vous acceptez, proposez votre montant ou passez; l’urgence ne dispense jamais d’honoraires justes et raisonnables.": "You assess fees based on the services required, including exceptional speed. Accept, propose your amount or pass; urgency never removes the duty to charge fair and reasonable fees.",
  "Avant d’accepter : évaluez votre compétence et vos moyens (art. 8), les conflits d’intérêts (art. 30) et la confidentialité (art. 35). Informez le client du coût approximatif (art. 51).": "Before accepting: assess your competence and resources (s. 8), conflicts of interest (s. 30) and confidentiality (s. 35). Inform the client of the approximate cost (s. 51).",
  "L’utilisation de Nota ne certifie pas la conformité d’un notaire et ne constitue pas une approbation de la Chambre des notaires du Québec. La validation juridique du modèle de frais reste à obtenir.": "Using Nota does not certify a notary’s compliance or constitute approval by the Chambre des notaires du Québec. Legal validation of the fee model is still required.",
  "Consulter le Code de déontologie": "Read the Code of ethics",
  "Lire la mise en garde du Bureau du syndic": "Read the warning from the Bureau du syndic",
    "Nota — Guide de marque": "Nota — Brand guide",
    "Bleu · action": "Blue · action",
    "Bleu signal": "Signal blue",
    "Encre nuit": "Midnight ink",
    "Accent chaud": "Warm accent",

    "#B45309 · #F79009 en sombre": "#B45309 · #F79009 in dark mode",
    // Public brand guide: official resources and reproduction rules.
    "Ressources officielles": "Official resources",
    "Une identité claire, partout où Nota apparaît.": "A consistent identity wherever Nota appears.",
    "Le logo, les couleurs et les boutons de Nota sont ici. Utilisez les ressources directement dans votre site, votre présentation ou votre signature de courriel.": "Find the Nota logo, colours and buttons here. Use these resources in your website, presentation or email signature.",
    "Obtenir le logo SVG": "Download the SVG logo",
    "Obtenir la carte sociale": "Download the social card",
    "Le logo officiel": "The official logo",
    "Le logo officiel associe le monogramme N aux lettres OTA et au point carré. La même géométrie apparaît dans le carnet, la console admin et la salle de signature.": "The official logo combines the N monogram with the OTA lettering and square period. The same geometry appears in the marketplace, admin console and signing room.",
    "Tuile": "Tile",
    "Un carré arrondi à 7/64 de son côté, carré-signal en haut à droite ; sa hauteur rendue est l’unité de tout le reste.": "A square with corners rounded to 7/64 of its side, and a signal square at the top right. Its rendered height sets every other proportion.",
    "Mot · 0,48": "Word · 0.48",
    "Les capitales OTA (O carré) font 48 % de la hauteur de la tuile et sont centrées verticalement sur elle.": "The OTA capitals (square O) are 48% of the tile height and vertically centred beside it.",
    "Air tuile → mot · 0,12": "Tile → word spacing · 0.08",
    "Entre la tuile et le mot, 12 % de la hauteur de la tuile.": "Space between tile and word: 8% of the tile height.",
    "Air mot → badge · 0,16": "Word → badge spacing · 0.16",
    "Entre le mot et le badge QUÉBEC, 16 % de la hauteur de la tuile.": "Space between word and QUÉBEC badge: 16% of the tile height.",
    "Badge · 0,16": "Badge · 0.16",
    "QUÉBEC en 16 % de la hauteur de la tuile, graisse 800, interlettrage 0,1 em, rembourrage 0,55 em / 0,7 em, coins 3 px, sur le bleu signal (#407598) avec du blanc, dans les deux thèmes.": "QUÉBEC at 16% of the tile height, weight 800, 0.1em tracking, 0.55em / 0.7em padding, 3px corners, white on signal blue (#407598) in both themes.",
    "Le T signé": "The bevelled T",
    "Le fût du T se termine en biseau, de 27,02 à droite à 31,5 à gauche, en écho à la diagonale du N.": "The T stem ends in a bevel, from 27.02 on the right to 31.5 on the left, echoing the N diagonal.",
    "Le A coupé": "The cut A",
    "Le sommet du A est tranché sur sa gauche, à la pente du biseau du T : la marque porte une seule coupe, répétée — la diagonale du N, le fût du T, le sommet du A.": "The A apex is cut on its left at the angle of the T bevel. One cut repeats in the N diagonal, T stem and A apex.",
    "Le point final": "The final period",
    "Un carré-signal de 4,4 × 4,4 (coins 1), posé sur la ligne de base après le A, ferme le mot comme un point : « NOTA. » — la ponctuation d’un acte signé. Il élargit la bande du mot à 91,8 pour 28 de haut.": "A 4.4 × 4.4 signal square (corner radius 1), on the baseline after the A, closes the word: “NOTA.” The word spans 91.8 units by 28 units high.",
    "Couleurs de marque": "Brand colours",
    "Cliquez sur une couleur pour copier sa valeur hexadécimale. Les couleurs de service de l’application restent réservées aux données.": "Click a colour to copy its hex value. Service colours in the app are reserved for data.",
    "Carré du logo": "Logo square",
    "Lavis Québec": "Québec wash",
    "Canevas": "Canvas",
    "Action primaire · contour #386888": "Primary action · #386888 outline",
    "Action secondaire · contour discret": "Secondary action · subtle outline",
    "Registre d’encre": "Text colour rules",
    "Un titre est": "A heading is",
    "blanc ou noir": "white or black",
    ", en toutes circonstances. Le bleu ne porte jamais le libellé principal : il mentionne une information, et cela reste rare.": ", in every state. Blue never carries the main label: it highlights information sparingly.",
    "Blanc ou noir": "White or black",
    "Titres, sur-titres et libellés principaux. Sur fond clair, le noir ; sur fond de nuit, le blanc. Un état — survol, choix, onglet retenu — ne change pas l’encre d’un titre : c’est le fond, le cadre ou le crochet qui le disent.": "Headings, eyebrows and main labels use black on light backgrounds and white on dark backgrounds. Hover, selection and active tabs do not change a heading’s colour: the background, border or checkmark indicates the state.",
    "Copier la règle": "Copy the rule",
    "Bleu, et rarement": "Blue, used sparingly",
    "Un montant, un lien, une pastille, un glyphe, le cadre d’un contrôle retenu. Sur fond de nuit, la marque devient de l’encre illisible (2,5:1) : c’est": "An amount, link, badge, glyph or selected control border. On a dark background, the base brand colour has insufficient contrast (2.5:1): use",
    "qui prend le relais, jamais": "instead of",
    "nu. Le mot du lockup, lui, EST de l’encre : blanc sur la nuit, noir sur le jour, comme un titre — seul le point final reste bleu.": "alone. The wordmark follows heading colours: white on dark, black on light. Only the final period stays blue.",
    "Pour votre portfolio, votre site ou votre présentation, utilisez uniquement les fichiers ci-dessous. Les planches exploratoires ne sont pas des variantes approuvées.": "For your portfolio, website or presentation, use only the files below. Exploratory boards are not approved logo variants.",
    "Logo sur fond clair": "Logo on light backgrounds",
    "Télécharger le logo pour fond clair": "Download the logo for light backgrounds",
    "Logo sur fond sombre": "Logo on dark backgrounds",
    "Télécharger le logo pour fond sombre": "Download the logo for dark backgrounds",
    "Signature de courriel": "Email signature",
    "Ouvrez le modèle, copiez la signature dans votre logiciel de courriel, puis remplacez le nom et le rôle par les vôtres.": "Open the template, copy the signature into your email app, then replace the name and role with your own.",
    "Ouvrir la signature": "Open the signature",
    "Règles de reproduction": "Reproduction rules",
    "Conservez les proportions, les couleurs et l’espace libre intégré au SVG. Ne redessinez pas les lettres, ne retirez pas le carré du N et n’ajoutez ni ombre ni contour. Affichez le logo à au moins 115 px de largeur; en dessous, utilisez le monogramme.": "Keep the proportions, colours and clear space built into the SVG. Do not redraw the letters, remove the N tile or add shadows or outlines. Display the logo at least 115px wide; below that, use the monogram.",
    "Utilisez Sora pour les titres et Inter pour le texte. Les polices et leur licence sont offertes dans le dossier fonts.": "Use Sora for headings and Inter for body text. The fonts and their licence are available in the fonts folder.",
    "Télécharger le monogramme": "Download the monogram",
    "Utiliser Nota correctement": "Using Nota correctly",
    "Gardez le logo intact, conservez son espace libre et utilisez les tokens sémantiques plutôt que des couleurs arbitraires.": "Keep the logo intact, preserve its clear space and use semantic tokens rather than arbitrary colours.",
    "Logo hébergé": "Hosted logo",
    "Pour une référence toujours à jour, utilisez l’asset public :": "For an up-to-date reference, use the public asset:",
    "Copier le HTML": "Copy the HTML",
    "Tokens CSS": "CSS tokens",
    "Ce sont les noms exacts que Nota utilise dans son propre code (ADR 0048) : un site partenaire parle ainsi la même langue.": "These are the exact token names Nota uses in its own code (ADR 0048), so partner websites can use the same system.",
    "Copier les tokens": "Copy the tokens",
    "Nota · kit de marque public · 2026": "Nota · public brand kit · 2026",
    "Une question sur l’utilisation du logo?": "Questions about using the logo?",
    "Télécharger le logo": "Download the logo",
    "Ressources de marque": "Brand resources",
    "Les cinq rapports du lockup": "Logo proportions",
    "Exemples de boutons": "Button examples",
    "Logo Nota officiel": "Official Nota logo",
    "Logo Nota": "Nota logo",
    "Lockup Nota Québec sur fond clair": "Nota Québec logo on a light background",
    "Lockup Nota Québec sur fond sombre": "Nota Québec logo on a dark background",
    "Retour à Nota": "Back to Nota",
    "Mise en page commune": "Shared layout",
    "Les mêmes repères guident le site, le guide de marque, le plan d’affaires et la présentation.": "The site, brand guide, business plan and pitch deck use the same layout rules.",
    "En-tête et menu": "Header and menu",
    "Logo à gauche, commandes à droite. Sur téléphone, les commandes des documents se rangent dans le menu.": "Logo on the left, controls on the right. On phones, document controls move into the menu.",
    "Hauteur : 52 px. Tuile du logo : 28 px. Cible des commandes : 44 px.": "Height: 52 px. Logo tile: 28 px. Control target: 44 px.",
    "Dans les en-têtes, le badge utilise un fond gris adapté au thème et un texte de 9 px minimum. Les ressources de marque conservent le badge bleu.": "In headers, the badge uses a grey background matched to the theme and text of at least 9 px. Brand assets retain the blue badge.",
    "Titres et sous-titres": "Headings and subheadings",
    "Sora 700 pour les titres. Inter pour le texte, les introductions et les commandes. L’encre suit le thème.": "Sora 700 for headings. Inter for body text, introductions and controls. Ink follows the theme.",
    "Titre de page : 26–36 px. Section : 19–24 px. Carte : 17 px. Petit titre : 15 px.": "Page heading: 26–36 px. Section: 19–24 px. Card: 17 px. Small heading: 15 px.",
    "Marges et espacement": "Margins and spacing",
    "Une marge latérale de 16 à 28 px et une largeur maximale de 1 600 px. Les paragraphes longs gardent une mesure de lecture plus étroite.": "Side margins of 16–28 px and a maximum width of 1,600 px. Long paragraphs retain a narrower reading measure.",
    "Texte courant et introduction : 16 px. Espacement des sections du guide : 32 px.": "Body text and introduction: 16 px. Brand guide section spacing: 32 px.",
    "INFRASTRUCTURE DE CAPACITÉ": "CAPACITY INFRASTRUCTURE",
    "PROBLÈME": "PROBLEM",
    "TÉLÉPHONE": "PHONE",
    "OCCASION": "OPPORTUNITY",
    "MÉCANISME": "MECHANISM",
    "PRODUIT": "PRODUCT",
    "DEMANDE": "REQUEST",
    "ACTE": "ACT",
    "PREUVE": "EVIDENCE",
    "POURQUOI MAINTENANT": "WHY NOW",
    "MODÈLE D’AFFAIRES": "BUSINESS MODEL",
    "AUCUN PARTAGE D’HONORAIRES": "NO FEE SHARE",
    "POSITIONNEMENT": "POSITIONING",
    "ÉCONOMIE": "ECONOMICS",
    "UTILISATION DES FONDS": "USE OF FUNDS",
    "JALONS": "MILESTONES",
    "FINANCEMENT RECHERCHÉ": "THE ASK",
    "CADRE JURIDIQUE": "LEGAL FRAMEWORK",
    "CONDITION": "GATE",
    "condition": "gate",
    "MONDE": "GLOBAL",
    "Nota · capacité, clarté, confiance": "Nota · capacity, clarity, trust",
    "exception · demande des parties · motif": "exception · party request · reason",
    "Des gains pour chacun": "win-win-win",
    "HONORAIRES": "PROFESSIONAL FEES",
    "FRAIS NOTA": "NOTA FEES",
    "CAPACITÉ": "CAPACITY",
    "LIQUIDITÉ": "LIQUIDITY",
    "CONFORMITÉ": "COMPLIANCE",
    "Client · notaire · Nota": "Client · notary · Nota",
    "Juridique + conseil": "Legal + advice",
    "Produit + opérations": "Product + operations",
    "Québec · demandes qualifiées": "Québec City · qualified demand",
    "avis professionnel · paiements · assurance": "professional advice · payments · insurance",
    "preuve avant expansion": "proof before expansion",
    "ordre et règles professionnelles": "professional body and rules",
    "indépendance et honoraires": "independence and fees",
    "consentement, conseil, signature": "consent, advice, signature",
    "MOIS 1": "MONTH 1",
    "MOIS 6": "MONTH 6",
    "MOIS 12": "MONTH 12",
    "ANNÉE 1": "Y1",
    "ANNÉE 2": "Y2",
    "ANNÉE 3": "Y3",
    "Avis professionnel": "Professional advice",
    "Paiements · assurance": "Payments · insurance",
    'Historique': 'History',
    'Précédent': 'Back',
    'Suivant': 'Forward',
    'Pas d’offres': 'No offers',
    'Ce que vous avez payé': 'What you paid',
    'Le notaire qui vous retient pourra vous appeler.': 'The notary who takes your request will be able to call you.',
    'Vos honoraires vont au notaire en entier. Le prix du service de Nota s’ajoute à côté; il n’en est jamais retranché.': 'Your notary’s fees go to them in full. Nota’s service price is added beside them; it is never taken out of them.',
    'Pas d’offre': 'No offer',
    '0 acte complété. Vos honoraires s’afficheront ici dès votre premier acte complété.': '0 completed acts. Your fees will appear here after your first completed act.',
    'Concept': 'Concept',
    'L’idée devient intention.': 'The idea becomes intent.',
    'Plan': 'Plan',
    'Une mise en œuvre claire.': 'A clear implementation.',
    'Technologie': 'Technology',
    'Les bons outils, au bon endroit.': 'The right tools, in the right place.',
    'Tests': 'Testing',
    'Unitaires, contrat et comportement.': 'Unit, contract and behavior.',
    'Sécurité': 'Security',
    'Conformité intégrée au cycle.': 'Compliance built into the cycle.',
    'CI/CD': 'CI/CD',
    'Chaque changement est vérifié.': 'Every change is verified.',
    'Production': 'Production',
    'Livrer, puis vérifier.': 'Ship, then verify.',
    'Feedback': 'Feedback',
    'Écouter les personnes qui l’utilisent.': 'Listen to the people who use it.',
    'Modèles': 'Models',
    'Chaque fournisseur itère dans sa boucle.': 'Each provider iterates in its loop.',
    'Relier la date,': 'Connect the date,',
    'la confiance': 'trust',
    'et la capacité.': 'and capacity.',
    // Signature beta hub.
    "Bêta": "Beta",
    "Bêta · essais disponibles": "Beta · trials available",
    "Signature électronique · Bêta": "Electronic signing · Beta",
    "Outil Nota · bêta gratuite": "Nota tool · free beta",
    "Préparation assistée pour les notaires": "Assisted preparation for notaries",
    "Connexion sécurisée via votre fournisseur ou avec votre courriel Nota.": "Secure sign-in with your provider or your Nota email.",
    "À la première connexion, confirmez votre courriel pour lier votre compte. Microsoft accepte les comptes Outlook et Microsoft 365.": "On your first sign-in, confirm your email to link your account. Microsoft accepts Outlook and Microsoft 365 accounts.",
    "En savoir plus sur la bêta": "Learn more about the beta",
    "À propos de la bêta": "About the beta",
    "Souhaitez-vous recevoir une invitation à la bêta ?": "Would you like to receive a beta invitation?",
    "Oui, m’inscrire à la bêta →": "Yes, sign me up for the beta →",
    "Une infrastructure canadienne": "Canadian infrastructure",
    "La bêta s’appuie sur une infrastructure canadienne et un document fictif. Aucun acte réel n’est produit.": "The beta runs on Canadian infrastructure and a fictional document. No real deed is produced.",
    "Sécurité de la bêta": "Beta security",
    "Outil Nota · préparation assistée": "Nota tool · assisted preparation",
    "Préparez vos dossiers avec l’IA, sous votre contrôle.": "Prepare your files with AI, under your control.",
    "Essayez la bêta avec 5 préparations gratuites. Le notaire vérifie chaque proposition avant tout envoi ou toute décision.": "Try the beta with 5 free preparations. The notary reviews every proposal before anything is sent or decided.",
    "Questions de clarification": "Clarification questions",
    "Un point incertain a été repéré. Confirmez-le avec les sources et utilisez votre décision comme feedback professionnel pour améliorer Nota.": "An uncertain point was flagged. Confirm it against the sources and use your decision as professional feedback to improve Nota.",
    "Confirmer la contradiction et choisir la source autorisée : ": "Confirm the conflict and choose the authorized source: ",
    "Confirmer l’absence ou rechercher une pièce source : ": "Confirm the absence or look for a source document: ",
    "Réponse à la question": "Answer to the question",
    "Choisir une réponse": "Choose an answer",
    "Point confirmé": "Point confirmed",
    "Point résolu": "Point resolved",
    "Non applicable": "Not applicable",
    "À examiner par le notaire": "For the notary to examine",
    "Note facultative": "Optional note",
    "Enregistrer la réponse": "Save answer",
    "Enregistrement de la réponse…": "Saving answer…",
    "Réponse enregistrée.": "Answer recorded.",
    "Impossible d’enregistrer la réponse. Réessayez.": "Unable to save the answer. Try again.",
    "Votre accès est actif. Chaque nouvelle analyse consomme une unité; une analyse réutilisée et votre révision restent gratuites.": "Your access is active. Each new analysis uses one unit; reused analyses and your review remain free.",
    "Vos 5 essais bêta sont terminés. Passez à une formule mensuelle ou achetez seulement les unités dont vous avez besoin.": "Your 5 beta trials are finished. Choose a monthly plan or buy only the units you need.",
    "Inscrivez-vous à la bêta : 5 préparations gratuites, une seule fois par notaire. Le notaire vérifie chaque proposition avant tout envoi.": "Join the beta: 5 free preparations, once per notary. The notary reviews every proposal before anything is sent.",
    "Activer mes 5 essais": "Activate my 5 trials",
    "Formule IA": "AI plan",
    "/mois · ": "/month · ",
    "dossiers": "files",
    "Choisir cette formule": "Choose this plan",
    "Nombre d’unités à acheter": "Number of units to buy",
    "Acheter à la pièce": "Buy per unit",
    "Je confirme être autorisé à transmettre ce document au fournisseur d’IA configuré, sans utilisation pour l’entraînement du texte du dossier; seules des décisions notariales minimisées peuvent contribuer au programme contrôlé d’amélioration.": "I confirm that I am authorized to send this document to the configured AI provider, without using the file text for training; only minimized notary decisions may contribute to the controlled improvement program.",
    "Bêta activée. Vos 5 essais sont prêts.": "Beta activated. Your 5 trials are ready.",
    "Inscription à la bêta impossible pour le moment.": "Beta enrollment is temporarily unavailable.",
    "Hors ligne. Réessayez une fois en ligne.": "Offline. Try again when you are online.",
    "Paiement momentanément indisponible.": "Payment is temporarily unavailable.",
    "Préparez votre prochain rendez-vous à distance : aperçu caméra, répétition à deux et démonstration du parcours notarial.": "Prepare for your next remote appointment: camera preview, two-person rehearsal and notarial workflow demonstration.",
    "Découvrir la signature en bêta": "Explore signing in beta",
    "La signature électronique, avec votre notaire.": "Electronic signing, with your notary.",
    "Une signature électronique accompagnée par votre notaire : une visioconférence sécurisée pour vous voir, comprendre le document et avancer ensemble.": "An electronic signing experience guided by your notary: secure video communication to meet, understand the document and move forward together.",
    "La signature électronique en conférence sera libérée après la lecture et votre consentement. La signature officielle reste à venir, après validation et intégration du fournisseur autorisé.": "Electronic signing during the conference will be enabled after the reading and your consent. Official signing is coming later, following validation and integration of the authorized provider.",
    "La bêta utilise un document fictif. Elle ne signe aucun acte notarié et ne déclenche aucun paiement.": "The beta uses a fictional document. It does not sign any notarial deed or trigger a payment.",
    "Un aperçu pour vous familiariser, à votre rythme.": "Get familiar with the room at your own pace.",
    "Caméra désactivée": "Camera off",
    "Votre notaire": "Your notary",
    "Votre document, à lire ensemble.": "Your document. Read together.",
    "Aperçu": "Preview",
    "Découvrir la salle": "Explore the room",
    "Retrouver mon dossier": "Go to my file",
    "L’aperçu est accessible sans compte. La caméra et le micro s’activent seulement à votre demande.": "No account is needed for the preview. Your camera and microphone turn on only when you choose.",
    "Aperçu du parcours de signature": "Preview of the signing process",
    "Document d’essai": "Test document",
    "Préparation": "Preparation",
    "Lecture ensemble": "Read together",
    "Signature de test": "Test signature",
    "Portée de la bêta": "Beta scope",
    "Un essai, aucun acte réel.": "A trial, no real deeds.",
    "La bêta utilise un document fictif. Elle ne signe aucun acte notarié et ne déclenche aucun paiement. La signature électronique en conférence sera libérée après la lecture et votre consentement. La signature officielle reste à venir, après validation et intégration du fournisseur autorisé.": "The beta uses a fictional document. It does not sign any notarial deed or trigger a payment. Electronic signing during the conference will be enabled after the reading and your consent. Official signing is coming later, following validation and integration of the authorized provider.",
    "Confiance et hébergement": "Trust and hosting",
    "Une salle pensée pour vos échanges sensibles.": "A room designed for sensitive conversations.",
    "Communication sécurisée": "Secure communication",
    "Une visioconférence propriétaire, hébergée au Canada.": "Proprietary video communication hosted in Canada.",
    "La salle de bêta utilise une communication vidéo propriétaire sur une infrastructure canadienne. Le son et l’image sont chiffrés de bout en bout : Nota ne peut pas les lire, et un relais fourni par Nota peut les acheminer lorsque la connexion directe est impossible. La caméra et le micro restent inactifs jusqu’à votre accord.": "The beta room uses proprietary video communication on Canadian infrastructure. Audio and video are encrypted end to end: Nota cannot read them, and a relay provided by Nota may carry them when a direct connection is impossible. Your camera and microphone stay off until you agree.",
    "Conservation contrôlée": "Controlled retention",
    "Des preuves conservées avec des contrôles reconnus.": "Evidence retained with recognized controls.",
    "Les éléments de séance et les documents de la bêta sont conservés sur une infrastructure canadienne, avec des contrôles calqués sur les référentiels SOC 2 et ISO 27001. Ni l’une ni l’autre certification n’est obtenue : notre cible est le 1er trimestre 2027.": "Beta session materials and documents are retained on Canadian infrastructure, with controls modelled on the SOC 2 and ISO 27001 frameworks. Neither certification has been obtained: our target is Q1 2027.",
    "Langue et consentement": "Language and consent",
    "Le parcours reste en français.": "The experience stays in French.",
    "Les écrans, communications et consentements sont prévus en français québécois, dans le respect de la Charte de la langue française.": "Screens, communications and consent prompts are designed in Quebec French, respecting the Charter of the French language.",
    "À essayer aujourd’hui": "Try it today",
    "Du premier échange au reçu d’essai.": "From the first conversation to the trial receipt.",
    "Installez-vous": "Get settled",
    "Vérifiez votre caméra et votre micro dans un aperçu privé avant de rejoindre votre notaire.": "Check your camera and microphone in a private preview before joining your notary.",
    "Avancez à deux": "Move forward together",
    "Votre notaire vous accueille en vidéo et guide la lecture. Vous pouvez poser vos questions et faire pause.": "Your notary welcomes you on video and guides the reading. You can ask questions and pause.",
    "Essayez de signer": "Try signing",
    "Signez le document fictif dans l’ordre prévu, puis téléchargez le reçu de la répétition.": "Sign the fictional document in the required order, then download the rehearsal receipt.",
    "Répétition à deux": "Two-person rehearsal",
    "Votre dossier ouvre la salle.": "Your file opens the room.",
    "Lorsqu’une demande est retenue, le lien « Salle de signature · Bêta » apparaît dans le dossier du client et dans l’espace du notaire. Le notaire ouvre la séance, puis accueille le client.": "Once a request is accepted, the “Signing room · Beta” link appears in the client’s file and the notary’s workspace. The notary opens the session and then welcomes the client.",
    "Chaque personne se reconnecte avec son propre courriel avant d’entrer. Préparez seulement des données fictives pour les essais.": "Each person signs in again with their own email before entering. Prepare only fictional data for the trials.",
    "Accéder à mon espace notaire": "Go to my notary workspace",
    "Vers la signature officielle.": "Towards official signing.",
    "Vérification d’identité adaptée au parcours notarial.": "Identity verification suited to the notarial workflow.",
    "Signature officielle et clôture avec le fournisseur autorisé.": "Official signing and closing with the authorized provider.",
    "Conservation de l’acte et remise de la copie selon le parcours validé.": "Deed preservation and copy delivery through the validated workflow.",
    "Ces fonctions ne sont pas offertes dans la bêta.": "These features are not available in the beta.",
    "Démonstration du parcours notarial": "Notarial workflow demonstration",
    "Progression du film": "Film progress",
    "Explorez aussi les étapes de la cérémonie : accueil, vérifications, consentement et journal de séance. Cette démonstration distincte nécessite une demande retenue et deux comptes. Elle ne produit aucune signature juridique.": "Also explore the ceremony steps: welcome, checks, consent and session log. This separate demonstration requires an accepted request and two accounts. It does not produce any legal signature.",
    "Les vérifications d’identité y sont simulées. N’utilisez aucun renseignement d’identité réel. Un enregistrement local ne peut démarrer qu’après le consentement des deux participants.": "Identity checks are simulated. Do not use any real identity information. A local recording can start only after both participants consent.",
    "Essayer le parcours client": "Try the client workflow",
    "Essayer le parcours notaire": "Try the notary workflow",

    'Mesure facultative.': 'Optional measurement.',
    'Avec votre accord, Google Analytics mesure les visites et les clics. Aucun nom, courriel, contenu de formulaire ou lien de dossier ne lui est envoyé. Google peut traiter ces données à l’extérieur du Canada. Les témoins de mesure et la provenance conservée sur cet appareil expirent après 30 jours sans nouvelle visite. Vous pouvez retirer votre accord dans « Préférences de mesure ». La provenance d’une demande reste enregistrée avec celle-ci, même sans Google Analytics.': 'With your permission, Google Analytics measures visits and clicks. No name, email, form content or case link is sent to it. Google may process this data outside Canada. Measurement cookies and acquisition data saved on this device expire after 30 days without another visit. You can withdraw permission under “Measurement preferences”. The source of a request remains saved with it, even without Google Analytics.',

    'Mesure d’audience': 'Audience measurement',
    'Acceptez-vous la mesure d’audience? Google Analytics nous aide à comprendre les visites et les clics pour améliorer Nota. Aucun contenu de formulaire n’y est envoyé. Le suivi est facultatif; votre demande sera traitée même si vous refusez.': 'Allow audience measurement? Google Analytics helps us understand visits and clicks to improve Nota. No form content is sent to it. Tracking is optional; your request will be processed even if you decline.',
    'Refuser': 'Decline',
    'Préférences de mesure': 'Measurement preferences',

    'Connexion interrompue. Votre demande n’est pas confirmée. Vos réponses restent dans ce formulaire; réessayez.': 'Connection interrupted. Your request is not confirmed. Your answers remain in this form; please try again.',
    'Salle de signature · Bêta': 'Signing room · Beta',
    'Essai vidéo et document de démonstration. Signature notariale à venir.': 'Video trial and demonstration document. Notarial signing is coming soon.',
    'La conversation a changé pendant l’envoi. Réessayez votre message.': 'The conversation changed while sending. Please try your message again.',
    "Enregistrer le courriel": "Save email",
    "Courriel enregistré pour cette conversation.": "Email saved for this conversation.",
    "Courriel non enregistré. Réessayez avant de quitter.": "Email not saved. Try again before leaving.",
    "Chercher un sujet d’aide": "Search help topics",
    "Chercher un sujet…": "Search topics…",
    "Aucun sujet trouvé. Écrivez votre question dans le message.": "No topics found. Type your question in the message.",
    "Envoi non confirmé. Votre message est conservé. Vérifiez la conversation avant de réessayer.": "Send not confirmed. Your message is preserved. Check the conversation before trying again.",
    "Terminez votre brouillon avant de reprendre ce message.": "Finish your draft before restoring this message.",
    "Envoi non confirmé": "Send not confirmed",
    "Reprendre ce message": "Restore this message",
    'L’identifiant du message n’est pas valide.': 'The message ID is invalid.',
    'La clé de reprise du message n’est pas valide.': 'The message recovery key is invalid.',
    'Votre message est en cours d’envoi. Réessayez dans un instant.': 'Your message is being sent. Try again in a moment.',
    'Cet identifiant appartient déjà à un autre message.': 'This ID already belongs to another message.',
    "Lien de conversation invalide ou expiré. Votre conversation actuelle est conservée.": "Conversation link invalid or expired. Your current conversation is preserved.",
    "Impossible d’ouvrir la conversation. Réessayez le lien reçu par courriel.": "Could not open the conversation. Try the link from your email again.",
    "Conversation": "Conversation",
    "Analyse assistée des documents": "Assisted document analysis",
    "Dossier de travail et analyse assistée": "Work packet and assisted analysis",
    "Dossier de travail préparé par Nota": "Work packet prepared by Nota",
    "Prochaine action": "Next action",
    "Nota rassemble le contexte client et les propositions IA pour réduire la préparation. Le notaire conserve chaque contrôle critique et chaque décision professionnelle.": "Nota brings together customer context and AI proposals to reduce preparation. The notary keeps every critical control and professional decision.",
    "État de l’IA": "AI status",
    "État de l’IA non précisé.": "AI status not specified.",
    "Aucune analyse IA lancée.": "No AI analysis started.",
    "L’IA n’a pas produit de proposition exploitable.": "AI did not produce a usable proposal.",
    "Des propositions IA attendent votre révision.": "AI proposals are waiting for your review.",
    "Les propositions IA ont été révisées.": "AI proposals have been reviewed.",
    "propositions": "proposals",
    "Demander les renseignements et pièces manquants": "Request missing information and documents",
    "Analyser les documents autorisés avec l’IA": "Analyze authorized documents with AI",
    "Réviser les propositions de l’IA": "Review AI proposals",
    "Résoudre les différences et dates signalées": "Resolve flagged differences and dates",
    "Compléter les contrôles critiques et joindre les preuves": "Complete critical controls and attach evidence",
    "Confirmer les conditions de signature et de clôture": "Confirm signing and closing conditions",
    "Action à préciser": "Action to be specified",
    "À faire par le client": "Customer action",
    "À faire par le notaire": "Notary action",
    "À faire maintenant": "Do now",
    "Ensuite": "Next",
    "éléments": "items",
    "Renseignements et brouillons à réviser par le notaire. Les déclarations du client et les propositions de l’IA restent à vérifier. Ce dossier de travail ne constitue pas une approbation juridique ni une autorisation de signer.": "Information and drafts for the notary to review. Customer declarations and AI proposals still require verification. This work packet does not constitute legal approval or authorization to sign.",
    "Déclaration du client": "Customer declaration",
    "Proposition de l’IA": "AI proposal",
    "Accepté par le notaire": "Accepted by the notary",
    "Corrigé par le notaire": "Corrected by the notary",
    "Document manquant": "Missing document",
    "Document déclaré": "Listed document",
    "État non précisé": "Status not specified",
    "Source non précisée": "Source not specified",
    "Responsable non précisé": "Responsible party not specified",
    "Notaire": "Notary",
    "Registre": "Registry",
    "À vérifier": "Pending verification",
    "Contexte fourni par le client": "Customer-provided context",
    "Inventaire des documents": "Document inventory",
    "Valeurs préparées pour le dossier": "Prepared file values",
    "Valeur d’origine dans le document": "Original value in the document",
    "Les extraits appuient la valeur d’origine, pas la correction du notaire.": "The excerpts support the original value, not the notary’s correction.",
    "Renseignements et documents à obtenir": "Information and documents to obtain",
    "Aucun élément manquant signalé dans le dossier de travail.": "No missing items reported in the work packet.",
    "Déclarations et documents à comparer": "Declarations and documents to compare",
    "Des différences de format peuvent être signalées; comparez les sources avant de conclure.": "Formatting differences may be flagged; compare the sources before drawing a conclusion.",
    "Valeur relevée dans un document": "Value found in a document",
    "Dates à examiner": "Dates to examine",
    "Vérifications en attente": "Pending checks",
    "Temps de révision consigné (secondes)": "Recorded review time (seconds)",
    "Brouillon à réviser par le notaire avant tout envoi.": "Draft for the notary to review before sending.",
    "Éléments à confirmer avec le prêteur": "Items to confirm with the lender",
    "Texte copié. Révisez-le avant de l’utiliser.": "Text copied. Review it before using it.",
    "Copie automatique impossible. Le texte est sélectionné; copiez-le manuellement.": "Automatic copying is unavailable. The text is selected; copy it manually.",
    "Résumé du dossier de travail": "Work packet summary",
    "Copier le résumé du dossier": "Copy file summary",
    "Brouillon pour le client": "Draft for the customer",
    "Copier le brouillon pour le client": "Copy customer draft",
    "Aucun élément à demander au client dans ce dossier de travail.": "No outstanding items to request from the customer in this work packet.",
    "Brouillon pour le prêteur": "Draft for the lender",
    "Copier le brouillon pour le prêteur": "Copy lender draft",
    "Date de signature demandée": "Requested signing date",
    "Échéance du taux à préciser au format AAAA-MM-JJ.": "Specify the rate expiry in YYYY-MM-DD format.",
    "L’échéance du taux déclarée est passée; confirmez la suite avec le prêteur.": "The declared rate expiry has passed; confirm the next steps with the lender.",
    "La signature demandée est après l’échéance du taux déclarée; confirmez la date avec le prêteur.": "The requested signing is after the declared rate expiry; confirm the date with the lender.",
    "Recevoir et vérifier les instructions officielles du prêteur": "Receive and verify the lender’s official instructions",
    "Vérifier l’identité, la capacité et les personnes qui doivent intervenir": "Verify identity, capacity and the parties who must be involved",
    "Vérifier l’identité, la capacité et la compréhension de chaque testateur": "Verify each testator’s identity, capacity and understanding",
    "Confirmer la situation familiale, les personnes à protéger et les bénéficiaires": "Confirm family status, people to protect and beneficiaries",
    "Examiner les biens, entreprises et volontés particulières déclarés": "Examine declared assets, businesses and specific wishes",
    "Préparer l’inscription de l’acte dans les registres applicables": "Prepare registration of the act in the applicable registries",
    "Expliquer l’acte et confirmer les conditions de signature": "Explain the act and confirm signing conditions",
    "Vérifier l’identité, la capacité et la compréhension de chaque mandant": "Verify each principal’s identity, capacity and understanding",
    "Confirmer la portée, les limites, la durée et la révocation souhaitées": "Confirm the desired scope, limits, duration and revocation",
    "Valider les exigences du tiers ou de la transaction, s’il y en a une": "Validate third-party or transaction requirements, if any",
    "Expliquer la procuration et confirmer les conditions de signature": "Explain the power of attorney and confirm signing conditions",
    "Examiner les titres, les charges et les exigences de localisation ou d’assurance titres": "Examine title, encumbrances and certificate of location or title insurance requirements",
    "Obtenir les relevés officiels de remboursement et suivre les quittances": "Obtain official payout statements and follow up on discharges",
    "Choisir le formulaire autorisé et vérifier le projet d’acte": "Choose the authorized form and verify the draft deed",
    "Confirmer les conditions de signature, de publication et de déboursement": "Confirm signing, registration and disbursement conditions",
    "Plan des contrôles et intégrations": "Control and integration plan",
    "Chaque contrôle reste en attente d’une décision et d’une preuve dans le dossier du notaire.": "Each control remains pending a decision and evidence in the notary’s file.",
    "La préparation peut être automatisée; chaque contrôle reste à décider et à documenter par le notaire.": "Preparation can be automated; each control still needs a notary decision and documentation.",
    "Préparation automatique seulement": "Preparation only",
    "Contrôle critique": "Critical control",
    "Contrôle à confirmer": "Control to confirm",
    "Type d’intégration": "Integration type",
    "Système candidat": "Candidate system",
    "Dossier et graphe de preuve": "Case and evidence graph",
    "Intake sécurisée et documents": "Secure intake and documents",
    "Canal autorisé du prêteur": "Authorized lender channel",
    "Registre officiel": "Official registry",
    "Preuve émise par l’institution": "Evidence issued by the institution",
    "Coordination avec un tiers": "Third-party coordination",
    "Signature notariale autorisée": "Authorized notarial signing",
    "Système de pratique notariale": "Notarial practice system",
    "Registre de la Chambre": "Chambre registry",
    "Fiducie et rapprochement": "Trust and reconciliation",
    "Confirmer la portée de l’acte et les rôles de chaque personne": "Confirm the act’s scope and each person’s role",
    "Vérifier l’identité, la qualité, la capacité et l’autorité d’intervention": "Verify identity, capacity, standing and authority to act",
    "Confirmer la langue, l’accessibilité et les besoins de communication": "Confirm language, accessibility and communication needs",
    "Lire ou faire lire l’acte, l’expliquer et recueillir un consentement libre et éclairé": "Read or have the act read, explain it and obtain free and informed consent",
    "Contrôler la présence, les témoins, la méthode de signature et les mentions requises": "Control attendance, witnesses, signing method and required statements",
    "Conserver l’original, la copie, les preuves et l’historique du dossier": "Keep the original, copy, evidence and file history",
    "Recevoir et vérifier les instructions officielles et actuelles du prêteur": "Receive and verify the lender’s current official instructions",
    "Examiner le titre, les charges, le lot et le rang de la sûreté": "Examine title, encumbrances, the lot and the security’s priority",
    "Valider les taxes, l’assurance, le certificat et les documents de copropriété applicables": "Validate applicable taxes, insurance, certificate and co-ownership documents",
    "Coordonner l’achat, la promesse, les ajustements et le notaire du vendeur": "Coordinate the purchase, promise, adjustments and seller’s notary",
    "Préparer et suivre la publication de l’hypothèque et obtenir les reçus officiels": "Prepare and track registration of the mortgage and obtain official receipts",
    "Réconcilier les conditions de fonds, les paiements et le rapport de clôture": "Reconcile funding conditions, payments and the closing report",
    "Examiner le titre, les charges, le lot et le rang des sûretés": "Examine title, encumbrances, the lot and the securities’ priority",
    "Obtenir un état officiel pour chaque prêt ou marge garanti par l’immeuble": "Obtain an official statement for each loan or line secured by the property",
    "Choisir, obtenir et suivre la quittance ou la mainlevée et sa publication": "Choose, obtain and track the discharge or release and its registration",
    "Préparer et suivre la publication de la nouvelle hypothèque et des radiations": "Prepare and track registration of the new mortgage and releases",
    "Réconcilier les conditions de fonds, les remboursements et le rapport de clôture": "Reconcile funding conditions, payouts and the closing report",
    "Confirmer la situation familiale, le conjoint, les enfants et les personnes vulnérables": "Confirm family status, spouse, children and vulnerable people",
    "Comprendre les volontés, bénéficiaires, legs, liquidateur et fiducie à discuter": "Understand the wishes, beneficiaries, legacies, liquidator and trust to discuss",
    "Vérifier le testament existant et les recherches pertinentes": "Verify the existing will and relevant searches",
    "Prévoir le témoin ou les témoins et les formalités particulières de communication": "Plan for the witness or witnesses and special communication formalities",
    "Conserver l’original et enregistrer l’existence du testament dans le registre applicable": "Keep the original and register the will’s existence in the applicable registry",
    "Définir les événements qui doivent déclencher une révision du testament": "Define events that should trigger a will review",
    "Distinguer la procuration ordinaire du mandat de protection ou d’un autre parcours": "Distinguish an ordinary power of attorney from a protection mandate or another workflow",
    "Confirmer les pouvoirs exprès, les limites, la durée et les conditions de fin": "Confirm express powers, limits, duration and end conditions",
    "Vérifier les mandats existants et préparer toute révocation ou annotation nécessaire": "Verify existing mandates and prepare any necessary revocation or notation",
    "Valider les exigences du tiers, de l’institution ou de la transaction": "Validate third-party, institutional or transaction requirements",
    "Prévoir le registre et la procédure distincts si le dossier concerne un mandat de protection": "Plan for the separate registry and procedure when the file concerns a protection mandate",
  "Nota dossier": "Nota case file",
  "Adresse de l’immeuble": "Property address",
  "Noms des emprunteurs": "Borrowers’ names",
  "Personne-ressource du prêteur": "Lender contact",
  "Personnes et rôles à la signature": "People and roles at signing",
  "Identification cadastrale indiquée": "Stated cadastral identification",
  "Type d’immeuble indiqué": "Stated property type",
  "Montant du prêt indiqué": "Stated loan amount",
  "Prix d’achat indiqué": "Stated purchase price",
  "Objet du financement indiqué": "Stated financing purpose",
  "Version ou date des instructions du prêteur": "Lender instruction version or date",
  "Changements à l’immeuble indiqués": "Stated changes to the property",
  "Échéance du taux indiquée": "Stated rate expiry",
  "Dettes garanties indiquées": "Stated secured debts",
  "Date de validité du remboursement indiquée": "Stated payout validity date",
  "Pièces d’identité et revue notariale": "Identity documents and notarial review",
    "Environnement de signature autorisé": "Authorized signing environment",
    "Système de pratique choisi par le cabinet": "Practice system chosen by the firm",
    "Assyst/Unity ou Paiements immobiliers Dye & Durham": "Assyst/Unity or Dye & Durham real estate payments",
    "Registre foncier / SLRI": "Land Registry / SLRI",
    "Municipalité, assureur, arpenteur et syndicat": "Municipality, insurer, surveyor and syndicate",
    "Notaire du vendeur et parties à la vente": "Seller’s notary and parties to the sale",
    "Système fiduciaire du cabinet et canal du prêteur": "Firm trust system and lender channel",
    "Créancier et canal de remboursement autorisé": "Creditor and authorized payout channel",
  "Créancier, Assyst/Unity ou Paiements immobiliers Dye & Durham": "Creditor, Assyst/Unity or Dye & Durham real estate payments",
    "Couverture des paramètres": "Parameter coverage",
    "Branches de cas connues": "Known case branches",
    "Les cas inconnus sont orientés vers le notaire avant toute automatisation.": "Unknown cases are routed to the notary before any automation.",
    "Dossier courant de personne physique": "Standard individual file",
    "Pièces manquantes, tardives ou illisibles": "Missing, late or unreadable documents",
    "Preuves contradictoires, périmées ou incomplètes": "Conflicting, outdated or incomplete evidence",
    "Identité, qualité, capacité ou autorité à confirmer": "Identity, standing, capacity or authority to confirm",
    "Langue, interprète, témoin ou accessibilité": "Language, interpreter, witness or accessibility needs",
    "Prêteur, registre ou institution temporairement indisponible": "Lender, registry or institution temporarily unavailable",
    "Autorisation de traitement, confidentialité ou conservation à confirmer": "Processing authorization, confidentiality or retention to confirm",
    "Contenu documentaire non fiable ou tentative d’instruction embarquée": "Untrusted document content or embedded instruction attempt",
    "Cas inconnu ou hors catalogue": "Unknown or out-of-catalogue case",
    "Achat, promesse, ajustements et coordination avec le vendeur": "Purchase, promise, adjustments and coordination with the seller",
    "Immeuble existant et nouveau financement": "Existing property and new financing",
    "Codébiteur, caution ou personne qui intervient à l’acte": "Co-borrower, guarantor or person intervening in the deed",
    "Copropriété et documents du syndicat applicables": "Co-ownership and applicable syndicate documents",
    "Revenu particulier, société, fiducie ou succession": "Personal income, corporation, trust or estate",
    "Anomalie de titre, lot, certificat ou changements à l’immeuble": "Title, lot, certificate or property-change exception",
    "Condition, version ou échéance des instructions du prêteur à confirmer": "Lender instruction condition, version or expiry to confirm",
    "Plusieurs prêts ou marges garantis par l’immeuble": "Multiple loans or lines secured by the property",
    "Marge garantie à solde nul qui doit tout de même être traitée": "Zero-balance secured line that still requires processing",
    "État de remboursement expiré ou contradictoire": "Expired or conflicting payout statement",
    "Quittance, mainlevée ou radiation à obtenir et publier": "Discharge, release or cancellation to obtain and register",
    "Nouvelle sûreté et sûretés existantes à coordonner": "New security and existing securities to coordinate",
    "Société, fiducie ou résidence familiale impliquée": "Corporation, trust or family residence involved",
    "Un testateur avec volontés simples à clarifier": "One testator with straightforward wishes to clarify",
    "Plusieurs testateurs ou actes coordonnés": "Multiple testators or coordinated deeds",
    "Famille recomposée, enfant mineur ou personne à charge": "Blended family, minor child or dependant",
    "Bénéficiaire vulnérable, legs complexe ou fiducie à discuter": "Vulnerable beneficiary, complex legacy or trust to discuss",
    "Testament antérieur, modification ou incertitude à vérifier": "Prior will, amendment or uncertainty to verify",
    "Biens hors Québec, entreprise ou actifs importants": "Assets outside Quebec, business or significant assets",
    "Témoin, interprète ou adaptation de communication à prévoir": "Witness, interpreter or communication accommodation to plan",
    "Doute sur la capacité, la compréhension ou l’influence exercée": "Concern about capacity, understanding or undue influence",
    "Procuration ordinaire pour une portée clairement délimitée": "Ordinary power of attorney with a clearly defined scope",
    "Possibilité de mandat de protection ou de parcours distinct": "Possible protection mandate or separate workflow",
    "Mandataires conjoints, séparés ou remplaçants": "Joint, separate or substitute mandataries",
    "Durée, condition de fin ou révocation à préciser": "Duration, end condition or revocation to clarify",
    "Mandat antérieur, révocation ou annotation à vérifier": "Prior mandate, revocation or notation to verify",
    "Pouvoir bancaire, immobilier, financement ou institutionnel": "Banking, real-estate, financing or institutional authority",
    "Demande qui concerne les soins personnels ou médicaux": "Request concerning personal or medical care",
    "Doute sur la capacité, la compréhension ou une pression exercée": "Concern about capacity, understanding or pressure",
  "Nota relie les réponses du client, les pièces, les propositions IA et les décisions qui restent au notaire.": "Nota links client answers, documents, AI proposals and decisions that remain with the notary.",
  "Paramètres tarifaires": "Pricing parameters",
  "Champs de collecte": "Intake fields",
  "Documents du parcours": "Workflow documents",
  "Champs préparables par l’IA": "Fields AI can prepare",
  "Contrôles humains critiques": "Critical human controls",
  "Certains champs de collecte sont préparés par le dossier et le notaire sans extraction automatique : ": "Some intake fields are prepared by the case file and notary without automatic extraction: ",
    "Nota dossier et pièces d’état civil": "Nota case file and civil-status documents",
    "Nota dossier et modèle approuvé du cabinet": "Nota case file and firm-approved template",
    "Registre des dispositions testamentaires de la CNQ": "CNQ register of testamentary dispositions",
    "Rappels Nota contrôlés par le client et le notaire": "Nota reminders controlled by the client and notary",
    "Nota routage de service": "Nota service routing",
    "Dossier du cabinet et avis contrôlés": "Firm file and controlled notices",
    "Institution ou prêteur demandeur": "Requesting institution or lender",
    "Registre des mandats de protection de la CNQ": "CNQ register of protection mandates",
    "Bonjour, voici les renseignements et les pièces à compléter pour préparer votre dossier.": "Hello, here is the information and documentation needed to prepare your file.",
    "Utilisez le canal convenu avec votre notaire pour les pièces. Si un élément ne s’applique pas ou vous est inconnu, indiquez-le pour que nous puissions préciser la demande.": "Use the channel agreed with your notary for documents. If an item does not apply or is unknown to you, let us know so we can clarify the request.",
    "Bonjour, nous préparons ce dossier à partir des renseignements déclarés par le client, qui restent à confirmer.": "Hello, we are preparing this file using information declared by the customer, which still needs to be confirmed.",
    "Confirmer l’envoi des instructions générales et particulières au notaire mandaté.": "Confirm that general and specific instructions will be sent to the appointed notary.",
    "Préciser les conditions et les délais applicables à la demande de fonds et au déboursement.": "Specify the conditions and deadlines for requesting funds and disbursement.",
    "Merci de confirmer la marche à suivre par votre canal autorisé. La date demandée n’est pas une confirmation de signature ni de déboursement.": "Please confirm the procedure through your authorized channel. The requested date is not a confirmation of signing or disbursement.",
    "Collez le texte d’une page de document. La reconnaissance optique de caractères (OCR) n’est pas encore offerte. Les références de document et de page sont fournies par le notaire.": "Paste the text of a document page. Optical character recognition (OCR) is not yet available. Document and page references are supplied by the notary.",
    "L’IA produit seulement des propositions appuyées par des extraits. Le notaire doit vérifier les sources; aucune proposition ne constitue une conclusion juridique ni une autorisation de signer.": "AI produces only proposals supported by excerpts. The notary must verify the sources; no proposal constitutes a legal conclusion or authorization to sign.",
    "Un texte inchangé peut réutiliser l’analyse et sa révision. Une nouvelle analyse remplace les précédentes. Une révision enregistrée ne peut pas être modifiée.": "Unchanged text can reuse the analysis and its review. A new analysis replaces the previous ones. A recorded review cannot be changed.",
    "Analyse existante réutilisée. Aucun nouvel appel d’IA pour cette demande; la révision enregistrée est conservée.": "Existing analysis reused. No new AI call for this request; the recorded review is preserved.",
    "Page à analyser": "Page to analyze",
    "Identifiant du document": "Document ID",
    "Numéro de page": "Page number",
    "Texte de la page": "Page text",
    "Je confirme être autorisé à transmettre ce document au fournisseur d’IA configuré, sans utilisation pour l’entraînement des modèles.": "I confirm that I am authorized to transmit this document to the configured AI provider, without using it for model training.",
    "Analyser cette page avec l’IA": "Analyze this page with AI",
    "Analyse IA indisponible : le fournisseur est désactivé ou indisponible. Aucune nouvelle analyse n’a été produite.": "AI analysis unavailable: the provider is disabled or unavailable. No new analysis was produced.",
    "L’analyse IA reçue n’a pas pu être validée. Aucune nouvelle proposition n’a été enregistrée.": "The AI analysis could not be validated. No new proposal was recorded.",
    "Confirmez votre autorisation de transmettre ce document avant de relancer l’analyse IA.": "Confirm your authorization to transmit this document before running the AI analysis again.",
    "Aucune analyse enregistrée pour ce dossier. Coller du texte ne lance pas l’IA.": "No analysis is recorded for this file. Pasting text does not run AI.",
    "Propositions à vérifier par le notaire": "Proposals for the notary to review",
    "Champs non trouvés dans les pages analysées": "Fields not found in the analyzed pages",
    "Aucun champ signalé comme manquant.": "No fields reported as missing.",
    "Contradictions à examiner": "Conflicts to examine",
    "Aucune contradiction signalée.": "No conflicts reported.",
    "Provenance de l’analyse": "Analysis provenance",
    "Identifiant de l’analyse": "Analysis ID",
    "Date de l’analyse": "Analysis date",
    "Modèle": "Model",
    "Empreinte des instructions (SHA-256)": "Instructions hash (SHA-256)",
    "Empreinte des données (SHA-256)": "Input hash (SHA-256)",
    "Version des connaissances": "Knowledge version",
    "Aucune proposition extraite. Vérifiez les documents et les champs manquants.": "No proposals extracted. Check the documents and missing fields.",
    "Révision des propositions": "Proposal review",
    "Valeur proposée": "Proposed value",
    "Décision du notaire": "Notary’s decision",
    "Choisir une décision": "Choose a decision",
    "Accepter la proposition": "Accept the proposal",
    "Corriger la proposition": "Correct the proposal",
    "Rejeter la proposition": "Reject the proposal",
    "Valeur corrigée": "Corrected value",
    "Motif de la correction ou du rejet": "Reason for correction or rejection",
    "Temps de révision active en secondes (facultatif)": "Active review time in seconds (optional)",
    "Enregistrer la révision": "Save review",
    "Révision enregistrée pour ce dossier. Elle ne sert pas à l’entraînement des modèles et ne constitue pas une approbation juridique.": "Review recorded for this file. It is not used for model training and does not constitute legal approval.",
    "Modifications non enregistrées.": "Unsaved changes.",
    "Choisissez une décision pour chaque proposition et complétez les corrections, les motifs et le temps, s’il est indiqué.": "Choose a decision for every proposal and complete corrections, reasons and review time, if provided.",
    "Enregistrement de la révision…": "Saving review…",
    "L’analyse ou sa révision a changé. Fermez ce panneau et rouvrez-le pour charger la version enregistrée.": "The analysis or its review has changed. Close and reopen this panel to load the recorded version.",
    "Impossible d’enregistrer la révision. Vos décisions restent à l’écran; réessayez.": "Unable to save the review. Your decisions remain on screen; try again.",
    "Chargement de l’analyse enregistrée…": "Loading recorded analysis…",
    "Impossible de charger l’analyse. Fermez ce panneau et rouvrez-le pour réessayer.": "Unable to load the analysis. Close and reopen this panel to try again.",
    "Indiquez le document, une page valide et son texte, puis confirmez votre autorisation de transmission.": "Enter the document, a valid page and its text, then confirm your authorization to transmit it.",
    "Analyse IA en cours…": "AI analysis in progress…",
    "Impossible d’obtenir une analyse IA. Aucune nouvelle proposition n’est disponible; réessayez.": "Unable to obtain an AI analysis. No new proposal is available; try again.",
    "Analyse enregistrée. Vérifiez chaque proposition et son extrait avant de choisir une décision.": "Analysis recorded. Check each proposal and its excerpt before choosing a decision.",
    "Noms des emprunteurs": "Borrowers’ names",
    "Nom du prêteur": "Lender name",
    "Montant du prêt indiqué": "Stated loan amount",
    "Échéance du taux indiquée": "Stated rate expiry",
    "Dettes garanties indiquées": "Stated secured debts",
    "Préparation du financement": "Financing preparation",
    "Renseignements déclarés seulement. Les documents et les conditions de signature restent à vérifier.": "Declared information only. Documents and signing conditions still require verification.",
    "Renseignements à compléter": "Information to complete",
    "Chaque élément est déclaré; la vérification du dossier reste à faire.": "Every item is declared; the file still requires verification.",
    "Vérifications du notaire et du prêteur": "Notary and lender checks",
    "La lettre d’engagement du client et les instructions au notaire sont distinctes. Le notaire doit recevoir et vérifier le mandat et les conditions du prêteur. Les formulaires et exigences varient selon le prêteur.": "The client’s commitment letter and the instructions to the notary are separate. The notary must receive and verify the lender’s mandate and conditions. Forms and requirements vary by lender.",
    "Un relevé hypothécaire du client ne remplace pas un relevé officiel de remboursement. Le remboursement ne radie pas automatiquement l’hypothèque; les autres produits garantis, dont les marges de crédit, doivent être examinés avec le notaire et le prêteur.": "A client’s mortgage statement does not replace an official payout statement. Repayment does not automatically discharge the mortgage; other secured products, including lines of credit, must be reviewed with the notary and lender.",
    "Le notaire examine les titres et les sûretés et les exigences concernant le certificat de localisation ou l’assurance titres. Une assurance titres ne constitue pas une correction automatique de tous les problèmes.": "The notary examines title, security interests and requirements for the certificate of location or title insurance. Title insurance does not automatically resolve every problem.",
    "Le notaire évalue les besoins juridiques, vérifie les personnes qui interviennent et explique l’acte avant la signature. Le mandat comporte aussi les démarches de publication et les conditions de déboursement et de rapport au prêteur.": "The notary assesses legal needs, verifies the parties involved and explains the deed before signing. The mandate also includes registration steps and conditions for disbursement and reporting to the lender.",

    'Aide générale seulement, sans accès à votre dossier. Ne partagez pas de numéro de carte, de mot de passe ni de document personnel ici.': 'General help only, without access to your file. Do not share card numbers, passwords or personal documents here.',
    'Explorer les sujets d’aide': 'Explore help topics',

    "Continuer avec Microsoft": "Continue with Microsoft",
    "À la première connexion, confirmez votre courriel pour lier votre compte. Microsoft accepte les comptes Outlook et Microsoft 365.": "On your first sign-in, verify your email to link your account. Microsoft supports Outlook and Microsoft 365 accounts.",
    "Connexion indisponible. Réessayez ou utilisez votre courriel.": "Sign-in is unavailable. Try again or use your email.",
    "Lier votre compte": "Link your account",
    "Confirmez le courriel de votre compte Nota. Ouvrez le lien reçu dans ce navigateur pour terminer la connexion.": "Verify your Nota account email. Open the emailed link in this browser to finish signing in.",
    "Envoyer le lien de confirmation": "Send confirmation link",
    "Un lien de confirmation a été envoyé. Ouvrez-le dans ce navigateur.": "A confirmation link has been sent. Open it in this browser.",
    "Connexion interrompue. Fermez cette fenêtre et recommencez la connexion.": "Sign-in was interrupted. Close this window and start signing in again.",
    "Connexion interrompue. Réessayez depuis le bouton de connexion.": "Sign-in was interrupted. Try again using the sign-in button.",

    'Statistiques d’utilisation.': 'Usage statistics.',
    'Pour améliorer le site, nous regroupons les événements par famille de navigateur et d’appareil, système, format d’écran, langue et source d’arrivée. Nous comptons aussi les chargements et les erreurs d’interface. Ces statistiques ne contiennent pas d’identifiant de visiteur, d’URL complète, de contenu de formulaire ni de message d’erreur.': 'To improve the site, we group events by browser and device family, operating system, screen size category, language and arrival source. We also count page loads and interface errors. These statistics contain no visitor identifier, full URL, form contents or error message.',
    'Offre valide jusqu’au': 'Offer valid through',
    'Offre expirée': 'Expired offer',
    'Cette offre a expiré. Publiez une nouvelle offre.': 'This offer has expired. Publish a new offer.',

    // Search landing pages: rendered in both languages at build time.
    "Notaire pour un refinancement hypothécaire à Québec": "Notary for mortgage refinancing in Quebec City",
    "Notaire pour un financement hypothécaire à Québec": "Notary for mortgage financing in Quebec City",
    "Vous refinancez votre propriété? Proposez votre date de signature et votre offre sur Nota. Un notaire décide de prendre votre demande.": "Refinancing your property? Propose your signing date and offer on Nota. A notary decides whether to take your request.",
    "Vous préparez un financement hypothécaire? Affichez votre date souhaitée et votre offre pour trouver un notaire dans la région de Québec.": "Preparing mortgage financing? Post your preferred date and offer to find a notary in the Quebec City area.",
    "Voir les dates et proposer mon offre": "View dates and make my offer",
    "Publier une demande est gratuit. La date reste à confirmer avec le notaire.": "Posting a request is free. Your date must still be confirmed with the notary.",
    "Comment trouver votre notaire": "How to find your notary",
    "Choisissez le service et votre date souhaitée dans le carnet.": "Choose the service and your preferred date on the public board.",
    "Consultez le prix présenté et proposez votre offre.": "Review the displayed price and make your offer.",
    "Un notaire peut accepter, faire une contre-offre ou passer. Vous préparez ensuite le dossier ensemble.": "A notary can accept, counter-offer or pass. You then prepare the file together.",
    "Quel budget prévoir?": "What should you budget?",
    "Consultez le devis dans le carnet : il distingue les honoraires du notaire du prix du service Nota. Vérifiez aussi les taxes, les débours et les conditions de paiement avant de poursuivre.": "Check the quote on the public board: it separates the notary’s fees from Nota’s service price. Also review taxes, disbursements and payment terms before proceeding.",
    "Préparer un refinancement": "Preparing to refinance",
    "Indiquez où en est votre approbation bancaire et la date visée. Le notaire précisera les pièces nécessaires à votre dossier et vérifiera les démarches liées à votre hypothèque actuelle.": "Indicate the status of your lender’s approval and your target date. The notary will specify the documents needed for your file and check the steps related to your existing mortgage.",
    "Préparer un financement": "Preparing mortgage financing",
    "Indiquez le montant du prêt, le prêteur et la date souhaitée. Si le financement accompagne un achat, confirmez avec le notaire quels actes et débours sont inclus dans son mandat.": "Indicate the loan amount, lender and preferred date. If financing accompanies a purchase, confirm with the notary which deeds and disbursements are included in the engagement.",
    "Faut-il avoir tous les documents avant de commencer?": "Do you need every document before starting?",
    "Vous pouvez commencer par votre demande. Le notaire vous indiquera ensuite les documents à fournir selon votre situation; ne publiez aucun document personnel dans le carnet public.": "You can start with your request. The notary will then tell you which documents to provide for your situation; do not post personal documents on the public board.",
    "La date est-elle garantie?": "Is the date guaranteed?",
    "Non. Une demande publiée ne constitue pas une réservation confirmée. La prise en charge dépend des disponibilités du notaire et de la préparation du dossier.": "No. A posted request is not a confirmed booking. Acceptance depends on the notary’s availability and the readiness of your file.",
    "À qui s’adresse Nota?": "Who is Nota for?",
    "Nota met en relation des clients et des notaires dans la région de Québec pour le financement et le refinancement hypothécaires. Nota n’est pas un notaire et ne fournit pas de conseils juridiques.": "Nota connects clients and notaries in the Quebec City area for mortgage financing and refinancing. Nota is not a notary and does not provide legal advice.",
    "Explorer les services": "Explore services",
    "Consulter le carnet": "View the public board",

    // L'arrivée montre le carnet (2026-09-12) : la promesse, la bande des
    // dates et la porte d'entrée. Les prix, eux, sont composés à l'exécution.
    "Votre date. Votre prix.": "Your date. Your price.",
    "Le carnet public des actes notari\u00e9s au Qu\u00e9bec.": "The public carnet of notarial acts in Qu\u00e9bec.",
    "La date d\u00e9cide du prix": "The date sets the price",
    "Voir le prix total avant de publier \u2192": "See the total price before publishing \u2192",
    "Vous \u00eates": "You are",

    // Responsive introduction films.
    "Votre projet. Votre notaire.": "Your project. Your notary.",
    "Nota met en relation clients et notaires.": "Nota connects clients and notaries.",
    "Faire avancer mon projet": "Move my project forward",
    "Trouver mon prochain dossier": "Find my next client",
    "Pour votre projet": "For your project",
    "Pour votre pratique": "For your practice",
    "Trouvez votre notaire avec Nota.": "Find your notary with Nota.",
    "Pour faire avancer votre projet.": "Move your project forward.",
    "Votre date. Votre prix.": "Your date. Your price.",
    "Publiez votre demande sur Nota.": "Post your request on Nota.",
    "Votre notaire, en contact direct.": "Connect directly with your notary.",
    "Dès qu’un notaire accepte, préparez la signature ensemble.": "Once a notary accepts, prepare for signing together.",
    "Votre projet commence ici.": "Your project starts here.",
    "Choisir ma date →": "Choose my date →",
    "Avec Nota, choisissez les demandes qui vous conviennent.": "With Nota, choose the requests that suit you.",
    "Votre agenda. Votre choix.": "Your schedule. Your choice.",
    "Consultez le service, la date et le prix proposé.": "Review the service, date and proposed price.",
    "Un nouveau client. Un contact direct.": "A new client. A direct connection.",
    "Acceptez une demande ou proposez votre prix.": "Accept a request or propose your price.",
    "Faites place à votre prochain client.": "Make room for your next client.",
    "Inscrivez-vous gratuitement sur Nota.": "Sign up for free on Nota.",
    "Voir les demandes →": "Browse requests →",
    "Les demandes": "Requests",
    "Trouvez un notaire avec Nota.": "Find a notary with Nota.",
    "Proposez votre date et votre prix.": "Propose your date and your price.",
    "Choisissez le service, la date et votre prix.": "Choose the service, date and your price.",
    "Le service": "The service",
    "Un notaire accepte votre demande.": "A notary accepts your request.",
    "Votre date confirmée": "Your date confirmed",
    "Préparez la signature avec votre notaire.": "Prepare for signing with your notary.",
    "Trouvez votre prochain dossier.": "Find your next client.",
    "Sur Nota, les clients proposent leur date et leur prix.": "On Nota, clients propose their date and price.",
    "Comparez les demandes.": "Compare requests.",
    "Voyez les détails avant de choisir.": "See the details before choosing.",
    "Acceptez une demande.": "Accept a request.",
    "Le montant proposé ne vous convient pas ? Faites une autre proposition.": "Prefer a different amount? Make a counteroffer.",
    "Vérifiez le prix total avant de publier.": "Review the total price before posting.",
    "Le service Nota se paie seulement à la signature.": "The Nota service is paid only at signing.",
    "Pause": "Pause",
    "Trouver un notaire": "Find a notary",
    "Votre date. Votre offre. Votre notaire.": "Your date. Your offer. Your notary.",
    "Nota met votre demande en ligne pour les notaires disponibles.": "Nota posts your request for available notaries to review.",
    "Choisissez une date": "Choose a date",
    "Publiez votre offre": "Post your offer",
    "Un notaire peut accepter": "A notary can accept",
    "Votre demande": "Your request",
    "Dites-nous ce qu’il vous faut.": "Tell us what you need.",
    "Choisissez votre acte, votre date et le montant que vous offrez.": "Choose your act, your date and the amount you offer.",
    "Votre acte": "Your act",
    "Votre date": "Your date",
    "La réponse": "The response",
    "Un notaire retient votre demande.": "A notary takes your request.",
    "Vous recevez une confirmation et ses coordonnées.": "You receive confirmation and their contact details.",
    "Une disponibilité confirmée": "Confirmed availability",
    "Un contact direct": "Direct contact",
    "Échangez au même endroit.": "Keep everything in one place.",
    "Messages, documents et suivi : préparez la signature avec votre notaire.": "Messages, documents and updates: prepare for signing with your notary.",
    "Messages": "Messages",
    "Documents": "Documents",
    "Suivi": "Updates",
    "À vous de jouer": "Your next step",
    "Publiez votre demande.": "Post your request.",
    "Commencez par choisir votre acte et votre date.": "Start by choosing your act and your date.",
    "Des demandes pour vos disponibilités.": "Requests that fit your availability.",
    "Nota vous présente les actes, les dates et les montants proposés par les clients.": "Nota shows you the acts, dates and amounts proposed by clients.",
    "Consultez les demandes": "Browse requests",
    "Choisissez un dossier": "Choose a file",
    "L’essentiel, avant de décider.": "The essentials, before you decide.",
    "Repérez les demandes qui correspondent à votre pratique et à votre horaire.": "Find requests that match your practice and your schedule.",
    "L’acte demandé": "The requested act",
    "La date de signature": "The signing date",
    "Le montant proposé": "The proposed amount",
    "Votre choix": "Your choice",
    "Retenez une demande.": "Take a request.",
    "Le client reçoit votre confirmation et vos coordonnées.": "The client receives your confirmation and contact details.",
    "Une date convenue": "An agreed date",
    "Votre pratique": "Your practice",
    "Vous gardez le choix.": "The choice stays yours.",
    "Acceptez le montant offert, proposez le vôtre ou passez à une autre demande.": "Accept the offered amount, propose your own or move on to another request.",
    "Accepter": "Accept",
    "Proposer": "Propose",
    "Inscrivez-vous gratuitement pour consulter les demandes.": "Sign up for free to browse requests.",
    "Votre prochain dossier commence ici.": "Your next file starts here.",
    "Reprendre": "Resume",
    "Entrez votre secteur postal pour voir les notaires à proximité.": "Enter your postal sector to see nearby notaries.",
    "Notaire dans votre zone": "Notary in your area",
    "Notaires dans votre zone": "Notaries in your area",
    "Selon le déplacement choisi": "Based on your travel selection",
    "Au moins ce nombre de notaires confirmés.": "At least this many confirmed geographic matches.",

    "Vos offres, au même endroit": "Your offers, in one place",
    "Choisissez une date au carnet pour publier votre première demande. Vous retrouverez ici son statut et les réponses des notaires.": "Choose a calendar date to post your first request. Its status and notary responses appear here.",
    "Vos coordonnées, une seule fois": "Your details, just once",
    "Ces renseignements préremplissent vos prochaines offres. Vérifiez votre courriel et votre téléphone pour faciliter la mise en relation.": "These details prefill future offers. Check your email and phone number so you can be contacted.",
    "Gardez le fil": "Stay up to date",
    "Choisissez vos notifications. Les préférences de courriel se règlent séparément avec le bouton de cette section.": "Choose your notifications. Email preferences are managed separately using the button in this section.",
    "Les documents, après la demande": "Documents come after your request",
    "Préparez seulement les pièces utiles à votre acte actif. Les documents ne bloquent pas la publication de votre offre.": "Prepare only the documents needed for your active service. Documents do not block posting your offer.",
    "Échangez avec votre notaire": "Talk to your notary",
    "Dès qu’un notaire retient votre demande, ouvrez votre offre pour retrouver ses coordonnées, vos messages et le suivi du dossier.": "Once a notary accepts your request, open your offer to find their contact details, your messages and file updates.",
    "Commencez par votre profil": "Start with your profile",
    "Complétez vos coordonnées et votre secteur de pratique. Les clients pourront vous joindre quand vous prendrez leur dossier.": "Complete your contact details and practice area so clients can reach you when you take on their file.",
    "Votre agenda, connecté": "Your calendar, connected",
    "Ajoutez vos signatures à votre agenda avec les liens proposés. Le carnet des demandes possède aussi son abonnement distinct.": "Add your signing appointments to your calendar using the links provided. The requests calendar also has its own separate subscription.",
    "Choisissez vos demandes": "Choose your requests",
    "Filtrez les demandes ouvertes. Consultez le service, la date, le lieu et le prix avant de retenir une offre ou de proposer un autre montant.": "Filter open requests. Review the service, date, location and price before accepting an offer or proposing another amount.",
    "Accompagnez votre client": "Support your client",
    "Vos dossiers retenus regroupent les échanges avec le client et les pièces à demander. Gardez la conversation et le suivi dans ce dossier.": "Accepted files bring together client conversations and document requests. Keep messages and follow-up in that file.",
    "Préparez vos paiements": "Set up payments",
    "Connectez votre compte de paiement et vérifiez son état. Consultez les montants affichés dans chaque dossier avant de confirmer une action.": "Connect your payment account and check its status. Review the amounts shown in each file before confirming an action.",
    "Revoir la visite guidée": "Replay the guided tour",
    "Passer la visite": "Skip tour",
    "Suivant": "Next",
    "Terminer la visite": "Finish tour",
    "Visite de votre espace": "Your account tour",

    "Fermer les préférences": "Close preferences",
  "Enregistrer": "Save",
  "Préférences de courriel": "Email preferences",
  "Choisissez les courriels à recevoir. Les liens de connexion restent disponibles.": "Choose which emails to receive. Sign-in links remain available.",
  "Préférences de courriel enregistrées.": "Email preferences saved.",
  "Impossible d’enregistrer les préférences. Réessayez.": "Unable to save preferences. Try again.",
  "Impossible de charger les préférences. Ouvrez le lien dans un courriel récent.": "Unable to load preferences. Open the link in a recent email.",
  "Vérification de la couverture…": "Checking coverage…",
    "Aucun notaire inscrit ne couvre actuellement ce secteur avec le déplacement choisi. Élargissez votre rayon ou changez le lieu de signature pour augmenter vos possibilités.": "No registered notary currently covers this area with your travel preference. Widen your radius or change the signing location to increase your options.",
    "Des notaires inscrits couvrent ce secteur. Leur disponibilité à la date choisie reste à confirmer.": "Registered notaries cover this area. Availability on your chosen date still needs to be confirmed.",
    "La couverture de ce secteur ne peut pas être confirmée pour le moment. Vous pouvez continuer, sans garantie de trouver un notaire.": "Coverage for this area cannot currently be confirmed. You can continue, with no guarantee of finding a notary.",
    "Modifier mon déplacement": "Change my travel preferences",

  "Écrivez-nous\u00a0: une personne de l’équipe vous répond à votre courriel.": "Write to us: someone on the team answers at your email address.",
  // La porte du courriel sous le composeur de la messagerie.
  "Recevoir aussi la réponse par courriel": "Also get the answer by email",
  // Les quatre écrans de la feuille de réservation (ADR 0040).
  "L’acte": "The act",
  "Vos réponses": "Your answers",
  "Votre prix": "Your price",
  "Vos coordonnées": "Your details",
  "Étapes": "Steps",
  "Retour": "Back",
  "Avancer": "Forward",
  "Navigation": "Navigation",
  "Continuer": "Continue",
  // Le catalogue annoncé de l'écran 1 (D.ACTES_A_VENIR) : le nom court sur la
  // carte grise, la description sur son infobulle.
  "Procuration": "Power of attorney",
  "Testament": "Will",
  "Testament notarié": "Notarial will",
  "Procuration notariée": "Notarial power of attorney",
  "Mandat notarié pour qu’une personne de confiance agisse en votre nom.": "A notarial mandate letting someone you trust act on your behalf.",
  "Testament reçu devant notaire et inscrit aux registres de la Chambre.": "A will received before a notary and entered in the Chambre’s registers.",
  "Les personnes": "People involved",
  "Les personnes concernées, leur situation et celles qui doivent intervenir.": "The people involved, their situation and who needs to take part.",
  "Votre acte": "Your act",
  "La portée et les particularités qui déterminent le travail du notaire.": "The scope and details that determine the notary’s work.",
  "Vos biens et instructions": "Your assets and instructions",
  "Les biens, volontés et documents qui donnent sa portée au dossier.": "The assets, wishes and documents that define the file.",
  "Nombre de testateurs": "Number of testators",
  "Situation familiale": "Family situation",
  "La situation familiale détermine les personnes à protéger et les vérifications à prévoir.": "Family situation determines who needs protection and which checks are needed.",
  "Célibataire": "Single",
  "Marié": "Married",
  "Uni civilement": "In a civil union",
  "Conjoint de fait": "Common-law partner",
  "Séparé ou divorcé": "Separated or divorced",
  "Famille recomposée ou situation à clarifier": "Blended family or situation needing clarification",
  "Contrat de mariage ou d’union civile": "Marriage or civil-union contract",
  "Un contrat, une modification ou une situation inconnue peut nécessiter une vérification distincte.": "A contract, amendment or unknown situation may require a separate verification.",
  "Aucun contrat connu": "No known contract",
  "Contrat ou modification disponible": "Contract or amendment available",
  "Nombre approximatif de bénéficiaires ou légataires": "Approximate number of beneficiaries or legatees",
  "Liquidateur ou fiduciaire": "Liquidator or trustee",
  "Le nombre de personnes et le recours à un professionnel changent la préparation des clauses.": "The number of people and use of a professional change clause preparation.",
  "Une personne": "One person",
  "Plusieurs personnes": "Several people",
  "Professionnel ou fiducie à structurer": "Professional or trust to structure",
  "Enfants ou personnes à charge": "Children or dependants",
  "Indiquez la situation qui doit être prise en compte dans vos volontés.": "Tell us which situation needs to be reflected in your wishes.",
  "Aucun": "None",
  "Enfants majeurs": "Adult children",
  "Enfants mineurs": "Minor children",
  "Personne à charge vulnérable": "Vulnerable dependant",
  "Avez-vous un testament existant ?": "Do you have an existing will?",
  "Le notaire doit savoir si un testament précédent peut devoir être révoqué ou comparé.": "The notary needs to know whether an earlier will may need to be revoked or compared.",
  "Non, à ma connaissance": "No, as far as I know",
  "Oui ou je ne sais pas": "Yes or I’m not sure",
  "Oui, j’en ai une copie ou un souvenir": "Yes, I have a copy or remember one",
  "Immeubles à prendre en compte": "Properties to consider",
  "Un immeuble": "One property",
  "Plusieurs immeubles": "Several properties",
  "Protection particulière d’un bénéficiaire": "Special beneficiary protection",
  "Une protection pour un mineur, une personne vulnérable ou une fiducie demande une analyse supplémentaire.": "Protection for a minor, vulnerable person or trust requires additional analysis.",
  "Aucune protection particulière": "No special protection",
  "Bénéficiaire mineur": "Minor beneficiary",
  "Bénéficiaire vulnérable": "Vulnerable beneficiary",
  "Fiducie à structurer": "Trust to structure",
  "Accessibilité et communication": "Accessibility and communication",
  "Indiquez le soutien matériel ou de communication à prévoir; le notaire évaluera les exigences applicables.": "Tell us what material or communication support may be needed; the notary will assess the applicable requirements.",
  "Aucun besoin particulier": "No special need",
  "Lecture ou vision à accommoder": "Reading or vision accommodation",
  "Audition ou communication à accommoder": "Hearing or communication accommodation",
  "Interprète à prévoir": "Interpreter needed",
  "Un témoin supplémentaire pourrait être requis": "An additional witness may be required",
  "Par exemple, certaines situations de communication ou de vision peuvent exiger une formalité supplémentaire; le notaire confirme.": "For example, some communication or vision situations may require an additional formality; the notary confirms.",
  "Volontés ou legs particuliers": "Specific wishes or legacies",
  "Choisissez la situation la plus proche; le notaire précisera la rédaction.": "Choose the closest situation; the notary will clarify the drafting.",
  "Volontés simples": "Simple wishes",
  "Legs particuliers ou conditions": "Specific legacies or conditions",
  "Fiducie, protection ou clauses complexes": "Trust, protection or complex clauses",
  "Je détiens une entreprise ou des actions": "I own a business or shares",
  "Le notaire devra coordonner les volontés avec les documents de société.": "The notary will need to coordinate the wishes with corporate documents.",
  "Je possède des biens importants hors Québec": "I own significant assets outside Québec",
  "Le notaire signalera les limites et la coordination nécessaires avec une autre juridiction.": "The notary will flag the limits and coordination needed with another jurisdiction.",
  "Langue de l’acte": "Language of the act",
  "Anglais": "English",
  "Bilingue": "Bilingual",
  "Document d’état civil pertinent": "Relevant civil-status document",
  "Certificat de mariage, d’union civile, de naissance ou autre document permettant au notaire de confirmer votre situation.": "Marriage, civil-union, birth or other document that lets the notary confirm your situation.",
  "Certificat de mariage ou d’union civile": "Marriage or civil-union certificate",
  "La preuve de votre mariage ou de votre union civile, lorsque cette situation est déclarée.": "Proof of your marriage or civil union when that situation is declared.",
  "Votre copie, si vous en avez une. Le notaire confirmera aussi les recherches à effectuer dans les registres.": "Your copy, if you have one. The notary will also confirm which registry searches are needed.",
  "Vous avez indiqué ne pas avoir de testament connu : le notaire vous dira quelles recherches sont requises.": "You indicated that you have no known will; the notary will tell you which searches are needed.",
  "Renseignements sur les enfants ou personnes à charge": "Information about children or dependants",
  "Noms, âge et situation des personnes à charge lorsque cela influence vos volontés.": "Names, ages and situations of dependants when they affect your wishes.",
  "Liste indicative des biens et volontés particulières": "Indicative list of assets and specific wishes",
  "Une liste simple de vos biens, legs ou souhaits à discuter; elle ne remplace pas les vérifications du notaire.": "A simple list of your assets, legacies or wishes to discuss; it does not replace the notary’s checks.",
  "Documents de société ou d’entreprise": "Corporate or business documents",
  "Statuts, conventions ou renseignements pertinents si vous détenez une entreprise ou des actions.": "Articles, agreements or relevant information if you own a business or shares.",
  "Personnes qui font le testament": "People making the will",
  "Noms complets, coordonnées et disponibilité de chaque testateur. Chaque personne signe son propre acte.": "Full names, contact details and availability for each testator. Each person signs their own act.",
  "Mariage, union civile, conjoint de fait, séparation ou famille recomposée; indiquez ce qui doit être clarifié avec le notaire.": "Marriage, civil union, common-law partnership, separation or blended family; say what needs clarification with the notary.",
  "Enfants et personnes à charge": "Children and dependants",
  "Noms, âge et situation des enfants ou personnes à charge, sans transmettre de numéro d’assurance sociale.": "Names, ages and situations of children or dependants; do not provide a social insurance number.",
  "Volontés principales": "Main wishes",
  "Bénéficiaires, legs particuliers, liquidateur de succession et souhaits à discuter; le notaire transforme ces instructions en acte.": "Beneficiaries, specific legacies, estate liquidator and wishes to discuss; the notary turns these instructions into an act.",
  "Actifs importants": "Significant assets",
  "Immeubles, entreprises, comptes ou biens particuliers à prendre en compte. Ne saisissez aucun numéro de compte.": "Properties, businesses, accounts or specific assets to consider. Do not enter an account number.",
  "Contraintes ou besoins particuliers": "Special constraints or needs",
  "Langue, mobilité, lecture, interprète ou autre besoin qui peut changer la préparation de la rencontre.": "Language, mobility, reading, interpreter or other need that may change meeting preparation.",
  "Votre contrat et ses modifications, si vous en avez un et qu’il peut influencer vos volontés.": "Your contract and amendments, if you have one and it may affect your wishes.",
  "Indiquez si un contrat existe, est modifié ou est introuvable; le notaire confirmera ce qui doit être vérifié.": "Say whether a contract exists, was amended or cannot be found; the notary will confirm what needs checking.",
  "Bénéficiaires et légataires": "Beneficiaries and legatees",
  "Noms, liens avec vous et nombre approximatif de bénéficiaires ou de legs; le notaire confirme la rédaction.": "Names, relationships and approximate number of beneficiaries or legacies; the notary confirms the drafting.",
  "Liquidateur ou fiduciaire souhaité": "Proposed liquidator or trustee",
  "Personne, personnes ou professionnel que vous envisagez pour administrer la succession ou une fiducie.": "Person or professional you are considering to administer the estate or a trust.",
  "Nombre de mandataires": "Number of attorneys",
  "Mode d’action des mandataires": "How the attorneys act",
  "Chacun peut agir séparément": "Each may act separately",
  "Ils doivent agir ensemble": "They must act together",
  "Avec remplacement ou suppléance": "With a substitute or successor",
  "Nature des pouvoirs demandés": "Nature of requested powers",
  "Les pouvoirs bancaires, immobiliers ou multiples demandent des limites et vérifications plus détaillées.": "Banking, property or multiple powers require more detailed limits and checks.",
  "Administration courante": "Routine administration",
  "Opérations bancaires ou financières": "Banking or financial transactions",
  "Vente, achat ou hypothèque d’un immeuble": "Sale, purchase or mortgage of a property",
  "Plusieurs catégories de pouvoirs": "Several categories of powers",
  "Nombre approximatif d’institutions ou de transactions": "Approximate number of institutions or transactions",
  "Prévoir une reddition de compte": "Include an accounting obligation",
  "Une obligation de rendre compte ou de documenter les actes du mandataire ajoute des clauses à structurer.": "An obligation to account for or document the attorney’s acts adds clauses to structure.",
  "Prévoir un remplaçant ou un mandataire subsidiaire": "Include a substitute or successor attorney",
  "Un remplaçant doit être identifié et ses pouvoirs doivent être coordonnés.": "A substitute must be identified and their powers coordinated.",
  "Pièces d’identité des mandataires": "Attorneys’ identity documents",
  "Pièces disponibles pour les personnes qui recevront les pouvoirs, lorsque le notaire les demande.": "Available documents for the people receiving authority, when the notary requests them.",
  "Exigences du tiers ou de l’institution": "Third-party or institutional requirements",
  "Formulaire, modèle ou instructions du prêteur, de l’institution ou du tiers qui demande la procuration.": "Form, template or instructions from the lender, institution or third party requesting the power of attorney.",
  "Relation et mode d’action des mandataires": "Attorneys’ relationship and mode of action",
  "Lien de confiance et indication claire : ensemble, séparément, avec remplacement ou sans remplacement.": "Relationship of trust and clear indication: jointly, separately, with a substitute or without one.",
  "Institutions et transactions concernées": "Institutions and transactions concerned",
  "Banque, prêteur, courtier, organisme public ou autre tiers qui recevra la procuration.": "Bank, lender, broker, public body or other third party that will receive the power of attorney.",
  "Type d’immeuble et situation particulière": "Property type and special situation",
  "Indiquez s’il s’agit d’une maison, d’une copropriété, d’un immeuble à revenus, d’un immeuble détenu par une société ou une fiducie, ou si vous ne savez pas. Le notaire ouvrira les vérifications applicables.": "Say whether it is a house, condominium, income property, property held by a corporation or trust, or whether you are unsure. The notary will open the applicable checks.",
  "Numéro de lot ou identification de l’immeuble": "Lot number or property identification",
  "Fournissez le numéro de lot, la désignation cadastrale ou toute autre référence disponible. L’adresse seule ne remplace pas la recherche officielle du titre.": "Provide the lot number, cadastral designation or any other available reference. An address alone does not replace an official title search.",
  "Type de mandat ou de procuration": "Type of mandate or power of attorney",
  "Indiquez s’il s’agit d’une procuration ordinaire, d’un possible mandat de protection ou d’une situation à clarifier. Le notaire décide du parcours juridique applicable.": "Say whether it is an ordinary power of attorney, a possible protection mandate or a situation needing clarification. The notary decides the applicable legal pathway.",
  "Situation familiale : Séparé ou divorcé": "Family situation: Separated or divorced",
  "Situation familiale : Marié": "Family situation: Married",
  "Situation familiale : Uni civilement": "Family situation: In a civil union",
  "Contrat de mariage ou d’union civile : Contrat ou modification disponible": "Marriage or civil-union contract: Contract or amendment available",
  "Contrat de mariage ou d’union civile : Je ne sais pas": "Marriage or civil-union contract: I’m not sure",
  "Liquidateur ou fiduciaire : Plusieurs personnes": "Liquidator or trustee: Several people",
  "Liquidateur ou fiduciaire : Professionnel ou fiducie à structurer": "Liquidator or trustee: Professional or trust to structure",
  "Avez-vous un testament existant : Oui, j’en ai une copie ou un souvenir": "Do you have an existing will: Yes, I have a copy or remember one",
  "Avez-vous un testament existant : Je ne sais pas": "Do you have an existing will: I’m not sure",
  "Immeubles à prendre en compte : Un immeuble": "Properties to consider: One property",
  "Immeubles à prendre en compte : Plusieurs immeubles": "Properties to consider: Several properties",
  "Protection particulière d’un bénéficiaire : Bénéficiaire mineur": "Special beneficiary protection: Minor beneficiary",
  "Protection particulière d’un bénéficiaire : Bénéficiaire vulnérable": "Special beneficiary protection: Vulnerable beneficiary",
  "Protection particulière d’un bénéficiaire : Fiducie à structurer": "Special beneficiary protection: Trust to structure",
  "Accessibilité et communication : Lecture ou vision à accommoder": "Accessibility and communication: Reading or vision accommodation",
  "Accessibilité et communication : Audition ou communication à accommoder": "Accessibility and communication: Hearing or communication accommodation",
  "Accessibilité et communication : Interprète à prévoir": "Accessibility and communication: Interpreter needed",
  "Mode d’action des mandataires : Ils doivent agir ensemble": "How the attorneys act: They must act together",
  "Mode d’action des mandataires : Avec remplacement ou suppléance": "How the attorneys act: With a substitute or successor",
  "Nature des pouvoirs demandés : Opérations bancaires ou financières": "Nature of requested powers: Banking or financial transactions",
  "Nature des pouvoirs demandés : Vente, achat ou hypothèque d’un immeuble": "Nature of requested powers: Sale, purchase or mortgage of a property",
  "Nature des pouvoirs demandés : Plusieurs catégories de pouvoirs": "Nature of requested powers: Several categories of powers",
  "Existe-t-il déjà une procuration ou un mandat : Oui, j’en ai une copie ou un souvenir": "Is there an existing power of attorney or mandate: Yes, I have a copy or remember one",
  "Existe-t-il déjà une procuration ou un mandat : Je ne sais pas": "Is there an existing power of attorney or mandate: I’m not sure",
  "Noms des testateurs": "Names of testators",
  "Situation familiale indiquée": "Stated family status",
  "Contrat familial indiqué": "Stated family contract",
  "Enfants ou personnes à charge indiqués": "Stated children or dependants",
  "Bénéficiaires ou legs indiqués": "Stated beneficiaries or legacies",
  "Liquidateur ou fiduciaire indiqué": "Stated liquidator or trustee",
  "Testament antérieur indiqué": "Stated earlier will",
  "Immeubles et actifs indiqués": "Stated properties and assets",
  "Besoins de communication indiqués": "Stated communication needs",
  "Formalités du testament indiquées": "Stated will formalities",
  "Entreprise ou actifs importants indiqués": "Stated business or significant assets",
  "Noms des mandants": "Names of principals",
  "Noms des mandataires": "Names of attorneys",
  "Nombre de mandataires indiqué": "Stated number of attorneys",
  "Type de mandat indiqué": "Stated mandate type",
  "Mode d’action indiqué": "Stated mode of action",
  "Pouvoirs sensibles indiqués": "Stated sensitive powers",
  "Mandat antérieur indiqué": "Stated earlier mandate",
  "Exigences du tiers indiquées": "Stated third-party requirements",
  "Objet ou portée indiquée": "Stated purpose or scope",
  "Immeuble ou transaction indiqué": "Stated property or transaction",
  "Durée ou fin indiquée": "Stated duration or end",
  "Mandat notarié pour qu’une personne de confiance agisse en votre nom, dans une portée définie.": "A notarial mandate allowing someone you trust to act for you within a defined scope.",
  "Nombre de mandants": "Number of principals",
  "Portée de la procuration": "Power of attorney scope",
  "La portée indique ce que le mandataire pourra faire; le notaire rédigera les pouvoirs et les limites.": "The scope says what the attorney may do; the notary will draft the powers and limits.",
  "Générale, pour plusieurs démarches": "General, for several matters",
  "Spécifique, pour une démarche précise": "Specific, for one matter",
  "Immeuble, vente ou financement": "Property, sale or financing",
  "Institution ou prêteur avec exigences particulières": "Institution or lender with special requirements",
  "Existe-t-il déjà une procuration ou un mandat ?": "Is there an existing power of attorney or mandate?",
  "Une version précédente peut devoir être comparée, révoquée ou signalée.": "An earlier version may need to be compared, revoked or flagged.",
  "Un interprète ou une mesure d’accessibilité est nécessaire": "An interpreter or accessibility measure is needed",
  "Le notaire confirmera la façon de respecter les exigences de compréhension et de signature.": "The notary will confirm how to meet understanding and signing requirements.",
  "Durée ou condition de fin": "Duration or ending condition",
  "Sans date de fin indiquée": "No end date specified",
  "Avec une date ou un événement de fin": "With an end date or event",
  "Avec plusieurs conditions à préciser": "With several conditions to clarify",
  "Copie de tout mandat ou procuration déjà signé qui touche le même sujet.": "A copy of any signed mandate or power of attorney on the same subject.",
  "Vous avez indiqué ne pas avoir de mandat connu : le notaire confirmera les vérifications utiles.": "You indicated that you have no known mandate; the notary will confirm useful checks.",
  "Documents de l’immeuble visé": "Documents for the property concerned",
  "Adresse et documents disponibles sur l’immeuble lorsque la procuration porte sur un immeuble.": "Address and available documents for the property when the power of attorney concerns real estate.",
  "Instructions ou projet de procuration": "Instructions or draft power of attorney",
  "Votre projet ou vos instructions écrites, même sous forme de notes, pour que le notaire puisse les clarifier.": "Your draft or written instructions, even as notes, so the notary can clarify them.",
  "Personnes qui donnent la procuration": "People granting the power of attorney",
  "Noms complets, coordonnées et disponibilité de chaque mandant.": "Full names, contact details and availability for each principal.",
  "Mandataire(s) proposé(s)": "Proposed attorney(s)",
  "Noms et coordonnées des personnes autorisées à agir; précisez si elles agissent ensemble ou séparément.": "Names and contact details of the people authorized to act; say whether they act jointly or separately.",
  "Objet et pouvoirs souhaités": "Purpose and requested powers",
  "Décrivez ce que le mandataire doit pouvoir faire et les limites souhaitées; le notaire confirme la portée juridique.": "Describe what the attorney should be able to do and the limits you want; the notary confirms the legal scope.",
  "Immeuble ou transaction visée": "Property or transaction concerned",
  "Adresse et transaction visée si la procuration concerne un immeuble ou un financement.": "Address and transaction when the power of attorney concerns property or financing.",
  "Durée ou fin du mandat": "Mandate duration or end",
  "Durée souhaitée, date de fin ou événement qui met fin au mandat, si applicable.": "Desired duration, end date or event ending the mandate, if applicable.",
  "Personne-ressource ou institution": "Contact person or institution",
  "Nom du courtier, prêteur, institution ou autre tiers qui demande la procuration, s’il y en a un.": "Name of the broker, lender, institution or other third party requesting the power of attorney, if any.",
  "Situation familiale : Marié ou uni civilement": "Family situation: Married or in a civil union",
  "Situation familiale : Conjoint de fait": "Family situation: Common-law partner",
  "Situation familiale : Famille recomposée ou situation à clarifier": "Family situation: Blended family or situation needing clarification",
  "Enfants ou personnes à charge : Enfants mineurs": "Children or dependants: Minor children",
  "Enfants ou personnes à charge : Personne à charge vulnérable": "Children or dependants: Vulnerable dependant",
  "Avez-vous un testament existant : Oui ou je ne sais pas": "Do you have an existing will: Yes or I’m not sure",
  "Volontés ou legs particuliers : Legs particuliers ou conditions": "Specific wishes or legacies: Specific legacies or conditions",
  "Volontés ou legs particuliers : Fiducie, protection ou clauses complexes": "Specific wishes or legacies: Trust, protection or complex clauses",
  "Langue de l’acte : Anglais": "Language of the act: English",
  "Langue de l’acte : Bilingue": "Language of the act: Bilingual",
  "Portée de la procuration : Générale, pour plusieurs démarches": "Power of attorney scope: General, for several matters",
  "Portée de la procuration : Immeuble, vente ou financement": "Power of attorney scope: Property, sale or financing",
  "Portée de la procuration : Institution ou prêteur avec exigences particulières": "Power of attorney scope: Institution or lender with special requirements",
  "Existe-t-il déjà une procuration ou un mandat : Oui ou je ne sais pas": "Is there an existing power of attorney or mandate: Yes or I’m not sure",
  "Durée ou condition de fin : Avec une date ou un événement de fin": "Duration or ending condition: With an end date or event",
  "Durée ou condition de fin : Avec plusieurs conditions à préciser": "Duration or ending condition: With several conditions to clarify",
  // Les documents de la conversation (ADR 0032).
  "Joindre un document": "Attach a document",
  "Aucun document échangé.": "No documents exchanged.",
  "Envoyé par le client": "Sent by the client",
  "Envoyé par le notaire": "Sent by the notary",
  "Préparation…": "Preparing…",
  "Envoi en cours…": "Uploading…",
  "Vérification…": "Verifying…",
  "Document envoyé.": "Document sent.",
  "Le téléversement a échoué. Réessayez.": "The upload failed. Try again.",
  "Document indisponible.": "Document unavailable.",
  "Vos clients ont payé": "Your clients paid",
  "à Nota pour le service de la plateforme, en plus de vos honoraires. Rien n’a été retranché de ce qui vous revient.": "to Nota for the platform service, on top of your fees. Nothing was deducted from what is yours.",
  "Sur cet acte, le client vous a payé directement à la signature : Nota n’a rien encaissé, et le prix de son service reste à percevoir.": "On this act the client paid you directly at signing: Nota collected nothing, and the price of its service is still owed.",
  "Sur ces actes, le client vous a payé directement à la signature : Nota n’a rien encaissé, et le prix de son service reste à percevoir.": "On these acts the client paid you directly at signing: Nota collected nothing, and the price of its service is still owed.",
  "vos honoraires, et ce que le client a payé à Nota": "your fees, and what the client paid Nota",
  "les honoraires du notaire": "the notary’s fees",
  "le prix du service de Nota": "Nota’s service price",
  "Vos honoraires vous reviennent en entier, quelle que soit votre cote. Cette mesure sert au service — jamais à ce que vous gagnez.": "Your fees come to you in full, whatever your score. This measure is about service — never about what you earn.",
  "Vos honoraires vous reviennent en entier. Le prix du service de Nota est payé par le client, en plus — il n’est jamais retranché de ce qui vous est dû.": "Your fees come to you in full. Nota’s service price is paid by the client, on top — it is never deducted from what you are owed.",
  "À cette étape, vos honoraires vous sont virés en entier. Nota facture son service au client, séparément.": "At this step, your fees are wired to you in full. Nota charges the client for its service, separately.",
  "Vos honoraires": "Your fees",
  "Payé à Nota par le client": "Paid to Nota by the client",
  "Service Nota à percevoir": "Nota service still owed",
  "vos honoraires vous sont virés en entier": "your fees are wired to you in full",
  "Vos honoraires s’afficheront ici dès votre premier acte complété.": "Your fees will appear here as soon as you complete your first act.",
  "les honoraires du notaire ": "the notary’s fees ",
  "Votre date est refusée ?": "Is your date being turned down?",
  "Payé à la signature — vos honoraires vous reviennent en entier": "Paid at signing — your fees come to you in full",
  "La récompense de référence est un coût de marketing de Nota, payée à même ses propres revenus — jamais ajoutée au prix du client, jamais retranchée des honoraires du notaire.": "The referral reward is a Nota marketing cost, paid out of its own revenue — never added to the client’s price, never taken from the notary’s fees.",
  "Nous ne vendons ni ne louons vos renseignements. Nota se rémunère en facturant son propre service au client, à un prix publié d’avance. Aucune donnée n’est monnayée.": "We neither sell nor rent your information. Nota earns its revenue by charging the client for its own service, at a price published in advance. No data is monetized.",
  "Deux lignes, annoncées d’avance": "Two lines, disclosed up front",
  // LE DEVIS (ADR 0031) — deux achats distincts, jamais un partage. « Service
  // Nota » plutôt que « frais » ou « commission » : le mot doit dire ce que le
  // client achète, pas ce qu'on retiendrait à quelqu'un d'autre.
  "Honoraires du notaire": "Notary’s fees",
  "Service Nota": "Nota service",
  "Porté à votre carte": "Charged to your card",
  "Taxes en sus.": "Taxes extra.",
  "Débours en sus (droits de publication, RDPRM).": "Disbursements extra (registration fees, RDPRM).",
  "Le prix du service de Nota s’ajoute à ce montant ; il vous est confirmé avant tout paiement.": "Nota’s service price is added to this amount; it is confirmed to you before any payment.",
  "Personnes qui doivent signer": "People who need to sign",
  "Personne-ressource chez le prêteur": "Lender contact",
  "Changements à l’immeuble": "Changes to the property",
  "Prêts et marges garantis par l’immeuble": "Loans and credit lines secured by the property",
  "Noms des propriétaires et des emprunteurs, situation conjugale et disponibilités. Signalez une procuration ou une personne absente; le notaire confirme qui doit intervenir.": "Names of owners and borrowers, marital status and availability. Mention a power of attorney or an absent person; the notary confirms who must participate.",
  "Nom et coordonnées professionnelles de votre conseiller. Indiquez si les instructions ont été envoyées au notaire; une approbation de prêt ne les remplace pas.": "Name and business contact details of your advisor. Indicate whether instructions have been sent to the notary; loan approval does not replace them.",
  "Travaux, agrandissement, piscine, occupation ou autre changement depuis le certificat de localisation. Sinon, inscrivez « aucun »; si vous ne savez pas, dites-le.": "Work, additions, a pool, occupancy or other changes since the certificate of location. Otherwise enter “none”; if you do not know, say so.",
  "Nommez les prêteurs et les prêts ou marges à rembourser, même si une marge affiche un solde nul. Ne saisissez aucun numéro de compte; le notaire obtient les relevés officiels de remboursement.": "List lenders and loans or credit lines to be paid off, even if a credit line has a zero balance. Do not enter account numbers; the notary obtains official payout statements.",
  "Les exigences varient selon le prêteur et les changements à l’immeuble. Le notaire vérifie si le certificat convient ou si une autre démarche est nécessaire.": "Requirements vary by lender and changes to the property. The notary checks whether the certificate is suitable or another step is needed.",
  "Un document indiqué comme transmis reste à vérifier par le notaire. Les instructions du prêteur, l’examen des titres et la disponibilité des fonds peuvent encore retarder la signature.": "A document marked as sent still needs to be checked by the notary. Lender instructions, title examination and availability of funds may still delay signing.",
  // Shared intake vocabulary — used by BOTH acts of the financing family.
  "Non": "No",
  "Oui": "Yes",
  "Pièce d’identité avec photo": "Photo ID",
  "Permis de conduire ou passeport valide (non expiré). N’utilisez pas votre carte d’assurance maladie : la loi en interdit l’usage comme pièce d’identité.": "A valid (unexpired) driver’s licence or passport. Do not use your health insurance card: the law prohibits its use as identification.",
  "Refinancement hypothécaire": "Mortgage refinancing",
  "Refinancement": "Refinancing",
  "Acte de prêt et publication de l’hypothèque lors d’un refinancement.": "Loan deed and publication of the hypothec during a refinancing.",
  "Montant du nouveau prêt": "Amount of the new loan",
  "La propriété fait-elle partie d’une succession ?": "Is the property part of an estate?",
  "Répondez oui si l’immeuble vient d’une succession qui n’est pas entièrement réglée — par exemple si le titre est encore au nom de la personne décédée.": "Answer yes if the property comes from an estate that is not fully settled — for example if the title is still in the deceased’s name.",
  "Approbation bancaire": "Bank approval",
  "Sans les instructions du prêteur, le notaire ne peut signer à la date visée.": "Without the lender’s instructions, the notary cannot sign on the target date.",
  "Obtenue": "Obtained",
  "En cours": "In progress",
  "Pas encore demandée": "Not yet requested",
  "Co-emprunteur / indivision": "Co-borrower / undivided co-ownership",
  "Deux emprunteurs ou plus, ou une propriété détenue en indivision (parts non divisées).": "Two or more borrowers, or a property held in undivided co-ownership.",
  "Assurance habitation à jour ?": "Home insurance up to date?",
  "Le prêteur exige une assurance habitation en vigueur. Sans elle, il ne débourse pas : prévoyez-la avant la signature.": "The lender requires home insurance in force. Without it, the lender does not disburse: arrange it before the signing.",
  "Oui, en vigueur": "Yes, in force",
  "À renouveler": "Needs renewal",
  "Aucune": "None",
  "Certificat de localisation": "Certificate of location",
  "La plupart des prêteurs exigent un certificat de moins de 10 ans, à jour si des travaux ont été faits depuis. Un certificat périmé ou absent retarde souvent le dossier.": "Most lenders require a certificate less than 10 years old, and up to date if work has been done since. An expired or missing certificate often delays the file.",
  "À jour": "Up to date",
  "Je ne sais pas": "I don’t know",
  "Périmé / absent": "Expired / missing",
  "Dossier prêt": "File ready",
  "Dossier en préparation": "File in preparation",
  "La propriété fait-elle partie d’une succession : Oui": "Is the property part of an estate: Yes",
  "Approbation bancaire : En cours": "Bank approval: In progress",
  "Approbation bancaire : Pas encore demandée": "Bank approval: Not yet requested",
  "Assurance habitation à jour : À renouveler": "Home insurance up to date: Needs renewal",
  "Assurance habitation à jour : Aucune": "Home insurance up to date: None",
  "Certificat de localisation : Je ne sais pas": "Certificate of location: I don’t know",
  "Certificat de localisation : Périmé / absent": "Certificate of location: Expired / missing",
  "Que finance ce prêt : L’achat d’une propriété": "What this loan finances: The purchase of a property",
  "Lettre d’engagement du prêteur (offre de financement)": "Lender’s commitment letter (financing offer)",
  "Le document d’engagement de la banque, avec le taux et le montant.": "The bank’s commitment document, with the rate and the amount.",
  "Relevé hypothécaire actuel": "Current mortgage statement",
  "Votre plus récent relevé du prêt à rembourser.": "Your most recent statement for the loan being paid off.",
  "Comptes de taxes municipales et scolaires": "Municipal and school tax bills",
  "Les comptes les plus récents de votre municipalité et de votre centre de services scolaire.": "The most recent bills from your municipality and your school service centre.",
  "Le rapport et le plan de l’arpenteur-géomètre. C’est souvent le document qui retarde un dossier — vérifiez qu’il est à jour.": "The land surveyor’s report and plan. It is often the document that delays a file — check that it is up to date.",
  "Adresse de l’immeuble": "Property address",
  "Adresse civique complète de la propriété refinancée.": "Full civic address of the property being refinanced.",
  "Prêteur": "Lender",
  "Le nom de l’institution qui accorde le nouveau prêt.": "The name of the institution granting the new loan.",
  "Échéance du taux": "Rate expiry",
  "La date avant laquelle le taux offert doit être signé, si connue.": "The date by which the offered rate must be signed, if known.",
  // Financement — the sibling act (ADR 0010 §1 amended): the NEW-hypothec loan
  // deed. Same agreement rule as refinancement: the EN of the service name and
  // short name MUST equal the domain's nomEn / nomCourtEn (pinned by test).
  "Financement hypothécaire": "Mortgage financing",
  "Financement": "Financing",
  "Acte de prêt et publication de l’hypothèque pour un nouveau financement.": "Loan deed and publication of the hypothec for a new financing.",
  "Montant du prêt": "Loan amount",
  "Que finance ce prêt ?": "What does this loan finance?",
  "Un achat exige de coordonner l’acte de prêt avec la vente chez le notaire instrumentant.": "A purchase requires coordinating the loan deed with the sale at the instrumenting notary.",
  "Une propriété que je possède": "A property I already own",
  "L’achat d’une propriété": "The purchase of a property",
  "Adresse civique complète de la propriété financée.": "Full civic address of the property being financed.",
  "Le nom de l’institution qui accorde le prêt.": "The name of the institution granting the loan.",
  // Prêteur hypothécaire — the lender question (domain LENDERS catalogue).
  // Proper names identical in English still get an entry: covered() is exact.
  "TA": "TA",
  "Prêteur hypothécaire": "Mortgage lender",
  "Un prêteur sans succursale (en ligne) demande plus de coordination au notaire.": "A lender with no branches (online) means more coordination for the notary.",
  "Banque Nationale": "National Bank",
  "Desjardins": "Desjardins",
  "RBC Banque Royale": "RBC Royal Bank",
  "TD Canada Trust": "TD Canada Trust",
  "BMO Banque de Montréal": "BMO Bank of Montreal",
  "Banque Scotia": "Scotiabank",
  "CIBC": "CIBC",
  "Banque Laurentienne": "Laurentian Bank",
  "Tangerine": "Tangerine",
  "Simplii Financial": "Simplii Financial",
  "Banque EQ": "EQ Bank",
  "nesto": "nesto",
  "First National": "First National",
  "MCAP": "MCAP",
  "Banque Manuvie": "Manulife Bank",
  "Prêteur privé": "Private lender",
  "Autre prêteur": "Other lender",
  // The free-text companion of « Autre prêteur » — the client adds their
  // lender by name when it is not in the catalogue.
  "Nom du prêteur": "Lender name",
  "Votre prêteur n’est pas dans la liste ? Inscrivez son nom.": "Your lender isn’t in the list? Write its name.",
  "Réponse requise : Nom du prêteur.": "Answer required: Lender name.",
  // Composed notary-card factors: only poids>0 lenders ever appear as factors.
  "Prêteur hypothécaire : Tangerine": "Mortgage lender: Tangerine",
  "Prêteur hypothécaire : Simplii Financial": "Mortgage lender: Simplii Financial",
  "Prêteur hypothécaire : Banque EQ": "Mortgage lender: EQ Bank",
  "Prêteur hypothécaire : nesto": "Mortgage lender: nesto",
  "Prêteur hypothécaire : First National": "Mortgage lender: First National",
  "Prêteur hypothécaire : MCAP": "Mortgage lender: MCAP",
  "Prêteur hypothécaire : Banque Manuvie": "Mortgage lender: Manulife Bank",
  "Prêteur hypothécaire : Prêteur privé": "Mortgage lender: Private lender",
  "Prêteur hypothécaire : Autre prêteur": "Mortgage lender: Other lender",
  "Réponse requise : Prêteur hypothécaire.": "Answer required: Mortgage lender.",
  // Déplacement pour la signature — who travels (ADR 0017, domain DEPLACEMENTS).
  "Déplacement pour la signature": "Travel for the signing",
  "L’acte se signe en personne, sauf en cas d’urgence déclarée. Plus vous acceptez de vous déplacer, plus de notaires peuvent vous servir — et moins le déplacement coûte.": "The act is signed in person, except for a declared urgency. The farther you are willing to travel, the more notaries can serve you — and the less the travel costs.",
  "J’accepte de me déplacer à l’étude — jusqu’à 50 km": "I’m willing to travel to the notary’s office — up to 50 km",
  "J’accepte de me déplacer à l’étude — jusqu’à 25 km": "I’m willing to travel to the notary’s office — up to 25 km",
  "J’accepte de me déplacer à l’étude — moins de 10 km": "I’m willing to travel to the notary’s office — under 10 km",
  "Le notaire se déplace chez moi — jusqu’à 25 km": "The notary travels to me — up to 25 km",
  "Le notaire se déplace chez moi — jusqu’à 50 km": "The notary travels to me — up to 50 km",
  "Urgence — signature 100 % en ligne": "Urgency — 100 % online signing",
  // The two segmented bars of the same catalogue (where it signs × radius);
  // the « ≤/< N km » radius labels are language-neutral and need no entry.
  "À l’étude": "At the office",
  "Chez moi": "At my home",
  "Urgence en ligne": "Online urgency",
  // Composed notary-card factors, one per band (finite compositions).
  "Déplacement pour la signature : J’accepte de me déplacer à l’étude — jusqu’à 50 km": "Travel for the signing: I’m willing to travel to the notary’s office — up to 50 km",
  "Déplacement pour la signature : J’accepte de me déplacer à l’étude — jusqu’à 25 km": "Travel for the signing: I’m willing to travel to the notary’s office — up to 25 km",
  "Déplacement pour la signature : J’accepte de me déplacer à l’étude — moins de 10 km": "Travel for the signing: I’m willing to travel to the notary’s office — under 10 km",
  "Déplacement pour la signature : Le notaire se déplace chez moi — jusqu’à 25 km": "Travel for the signing: The notary travels to me — up to 25 km",
  "Déplacement pour la signature : Le notaire se déplace chez moi — jusqu’à 50 km": "Travel for the signing: The notary travels to me — up to 50 km",
  "Déplacement pour la signature : Urgence — signature 100 % en ligne": "Travel for the signing: Urgency — 100 % online signing",
  "Réponse requise : Déplacement pour la signature.": "Answer required: Travel for the signing.",
  // The notary-card déplacement chip (six fixed compositions, ncDeplacementPill).
  "Urgence · 100 % en ligne": "Urgency · 100 % online",
  "À l’étude · ≤ 25 km": "At the office · ≤ 25 km",
  "À l’étude · ≤ 50 km": "At the office · ≤ 50 km",
  "À l’étude · moins de 10 km": "At the office · under 10 km",
  "Chez le client · ≤ 25 km": "At the client’s · ≤ 25 km",
  "Chez le client · ≤ 50 km": "At the client’s · ≤ 50 km",
  // The notary profile's travel fields (ADR 0017).
  "Rayon de déplacement — signature chez le client": "Travel radius — signing at the client’s",
  "Je ne me déplace pas": "I don’t travel",
  "Jusqu’à 25 km": "Up to 25 km",
  "Jusqu’à 50 km": "Up to 50 km",
  "J’accepte les urgences — signature 100 % en ligne": "I take urgencies — 100 % online signing",
  "Un rayon plus large fait apparaître plus de demandes dans votre fil — et le déplacement est payé par la demande.": "A wider radius surfaces more requests in your feed — and the travel is paid by the request.",
  "fiche CNQ, déplacement, urgences": "CNQ profile, travel, urgencies",
  "Le rayon de déplacement doit être 0, 25 ou 50 km.": "The travel radius must be 0, 25 or 50 km.",
  // The étude's sector and the measured distance (ADR 0025).
  "Secteur de votre étude": "Your office’s sector",
  "Les 3 premiers caractères du code postal de votre étude. Chaque demande affiche alors sa distance réelle (≈ km), et votre fil ne montre que ce qui est vraiment à votre portée.": "The first 3 characters of your office’s postal code. Each request then shows its real distance (≈ km), and your feed only surfaces what is genuinely within your reach.",
  "Distance approximative de votre étude": "Approximate distance from your office",
  // Live support chat (ADR 0026).
  "Une question ?": "A question?",
  // ADR 0046 — la messagerie assistée. Aucune de ces lignes ne promet un délai.
  "Explorez les sujets d’aide ou posez votre question. Une personne peut reprendre la conversation.": "Explore help topics or ask your question. A person can continue the conversation.",
  "Assistant Nota": "Nota assistant",
  "Vous": "You",
  "Visiteur": "Visitor",
  "Nota": "Nota",
  "L’assistant écrit…": "The assistant is typing…",
  "Cette question part à une personne — laissez votre courriel pour recevoir la réponse.": "This one goes to a person — leave your email to get the answer.",
  "Combien ça coûte ?": "How much does it cost?",
  "Comment ça marche ?": "How does it work?",
  "Quels documents me faut-il ?": "Which documents do I need?",
  "Et si j’annule ?": "What if I cancel?",
  "Messagerie Nota": "Nota chat",
  "Messagerie — posez votre question": "Chat — ask your question",
  "Fermer la messagerie": "Close the chat",
  "Écrivez votre question…": "Write your question…",
  "Votre message": "Your message",
  "Courriel (optionnel)": "Email (optional)",
  "Courriel (optionnel), pour recevoir la réponse aussi par courriel": "Email (optional), to also receive the answer by email",
  "Pour recevoir la réponse aussi par courriel": "To also receive the answer by email",
  "Envoyer": "Send",
  "Posez votre question — l’équipe Nota vous répond en direct.": "Ask your question — the Nota team answers live.",
  "La messagerie est momentanément indisponible. Réessayez, ou écrivez-nous par le formulaire « Nous joindre ».": "The chat is momentarily unavailable. Try again, or write to us through the “Contact us” form.",
  "Répondre au visiteur": "Reply to the visitor",
  "Votre réponse…": "Your reply…",
  "Votre réponse": "Your reply",
  "Envoyer la réponse": "Send the reply",
  "✓ Réponse envoyée — le visiteur la voit en direct dans la messagerie.": "✓ Reply sent — the visitor sees it live in the chat.",
  "Envoi impossible — le lien est peut-être expiré.": "Could not send — the link may have expired.",
  "Lien de réponse invalide ou expiré.": "Invalid or expired reply link.",
  "Écrivez-nous quelques mots.": "Write us a few words.",
  "Cette demande exige un déplacement ou une urgence en ligne que votre profil ne couvre pas.": "This request asks for travel or an online urgency your profile doesn’t cover.",
  "Choisir…": "Choose…",
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
  "Réponse requise : Montant du nouveau prêt.": "Answer required: Amount of the new loan.",
  "Réponse requise : Montant du prêt.": "Answer required: Loan amount.",
  "Réponse requise : Que finance ce prêt ?": "Answer required: What does this loan finance?",
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
  "Continuer →": "Continue →",
  "Entrez un courriel valide.": "Enter a valid email.",
  "Trouvez votre notaire en 3 étapes": "Find your notary in 3 steps",
  "Vous publiez votre demande ; un notaire de Québec la retient.": "You post your request; a Québec notary takes it on.",
  "Publier ma demande →": "Post my request →",
  "Explorer le carnet d’abord": "Explore the carnet first",
  "Explorer les demandes d’abord": "Explore the requests first",
  "Changer de profil": "Change profile",
  "Passer le guide": "Skip the guide",
  "Choisissez votre date": "Choose your date",
  "sur le calendrier public.": "on the public calendar.",
  "Proposez votre prix": "Propose your price",
  "plus la date est proche, plus il faut offrir.": "the closer the date, the more you need to offer.",
  "Un notaire vous retient": "A notary takes on your request",
  "Recevez des dossiers en 3 étapes": "Receive files in 3 steps",
  "Vous choisissez les demandes qui vous conviennent.": "You choose the requests that suit you.",
  "Voir les demandes →": "See the requests →",
  "Voyez les demandes ouvertes": "See the open requests",
  "à Québec, par date de signature.": "in Québec, by signing date.",
  "proposez votre prix ou demandez des documents ; le dossier s’ouvre dès que vous retenez.": "propose your price or ask for documents; the file opens as soon as you take it on.",
  "Retenez — ou négociez": "Take it on — or negotiate",
  "Complétez l’acte": "Complete the act",
  "Se déconnecter effacera de cet appareil vos coordonnées, vos offres publiées, votre dossier, vos échanges avec le notaire et vos notifications. Continuer ?": "Signing out will erase your contact details, published offers, file, your exchanges with the notary and your notifications from this device. Continue?",
  "Vous êtes déconnecté.": "You are signed out.",
  "Espace notaire": "Notary space",
  "Vos demandes et vos dossiers retenus": "Your requests and your taken files",
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
  ": la meilleure offre encore ouverte pour chaque acte, à la couleur ci-dessus, et le prix indicatif (« dès ») d’une offre à ce délai.": ": the best offer still open for each act, in the colour shown above, and the indicative price (“from”) of an offer at this notice.",
  "à partir de": "from",
  "médiane": "median",
  "aucune offre ce mois": "no offers this month",
  "anonyme": "anonymous",
  "Retenu": "Taken",
  "Retenue": "Taken",
  "aujourd’hui": "today",
  "demain": "tomorrow",
  "hier": "yesterday",
  "Afficher le détail": "Show details",
  "Masquer le détail": "Hide details",
  "Voir moins": "See less",
  "Voir l’autre offre": "See the other offer",
  "Ce que d’autres offrent ce jour-là": "What others are offering that day",
  "Offrir autant": "Offer as much",
  "Votre offre est au niveau de ce que d’autres offrent ce jour-là.": "Your offer matches what others are offering that day.",
  "Cette référence dépasse votre plage pour cet acte.": "This reference sits above your range for this act.",
  "Trop bas : peu de chances": "Too low: slim chances",
  "Dans la norme": "Within the norm",
  "Généreux : retenue vite": "Generous: taken quickly",
  "Même jour": "Same day",
  "Montant de l’offre en dollars": "Offer amount in dollars",
  "Les questions du notaire": "The notary’s questions",
  "(elles ajustent le prix)": "(they adjust the price)",
  // Step 2's live tally and the hint line's prefix (the labels after it are
  // T()'d at composition, so only the prefix reaches the DOM in French).
    "Répondez à :": "Answer:",
    "Répondez à ce que vous savez; si un point reste à confirmer, le notaire le reprendra avec vous.": "Answer what you know; if something still needs confirmation, your notary will review it with you.",
  "1 réponse attendue": "1 answer expected",
  "✓ complet": "✓ complete",
  "Ouverte — en attente d’un notaire": "Open — waiting for a notary",
  "Date passée": "Date passed",
  "Prochaine étape": "Next step",
  "Cette date est passée. Choisissez une nouvelle date au carnet.": "This date has passed. Choose a new date on the carnet.",
  "Le notaire vous contacte pour convenir du lieu. Ajoutez la date à votre agenda.": "The notary will contact you to agree on the location. Add the date to your calendar.",
  "Un notaire vous propose un autre prix : acceptez ou refusez ci-dessous.": "A notary is proposing a different price: accept or decline below.",
  "Un notaire attend des documents : complétez votre dossier ci-dessous.": "A notary is waiting for documents: complete your file below.",
  "Tout est prêt. Un notaire de Québec peut retenir votre demande à tout moment — vous serez prévenu ici.": "Your file is complete. A Québec notary can take on your request at any time — you will be notified here.",
  "Agenda": "Calendar",
  "Ajouter la date à Google Agenda": "Add the date to Google Calendar",
  "Télécharger le fichier .ics (Outlook, Apple)": "Download the .ics file (Outlook, Apple)",
  "Le notaire demande : ": "The notary is asking for: ",
  "✓ Acceptée": "✓ Accepted",
  "Refusée": "Declined",
  "Close": "Closed",
  "✓ Transmis": "✓ Sent",
  "Refuser": "Decline",
  "Acceptez ou refusez dans Mes offres.": "Accept or decline in My offers.",
  "Votre demande est déjà retenue par un autre notaire.": "Your request has already been taken on by another notary.",
  "Cette proposition n’est plus ouverte.": "This proposition is no longer open.",
  "Filtres réinitialisés.": "Filters reset.",
  "Tous les actes": "All acts",
  // Les sections de l'écran 2 (domaine CRITERIA_GROUPS) : leur intitulé, leur
  // raison d'être, le volet qui replie leurs précisions, et ce qu'une réponse
  // change à la liste des documents (composé en DEUX nœuds — le cadre ici, le
  // nom du document dans les entrées du catalogue).
  "Votre prêt": "Your loan",
  "Le montant, l’état de votre approbation et le prêteur à coordonner.": "The amount, where your approval stands, and the lender to coordinate with.",
  "L’immeuble": "The property",
  "Les titres et les documents que le prêteur exigera avant de débourser.": "The title and the documents your lender will require before releasing the funds.",
  "La signature": "Signing",
  "Où l’acte se signe, et qui se déplace pour cela.": "Where the act is signed, and who travels for it.",
  "Préciser (facultatif)": "Add details (optional)",
  // Les trois temps de l'écran 3 (index.html) : le montant, le marché, le devis.
  "Le montant": "The amount",
  "Pré-rempli au niveau qui se conclut à ce délai — ajustez-le si vous voulez.": "Pre-filled at the level that closes at this notice — adjust it if you like.",
  "Le marché ce jour-là": "The market that day",
  "Ce que d’autres offrent pour la même date, et ce que le délai y change.": "What others are offering for the same date, and what the notice changes.",
  "Votre devis": "Your quote",
  "Deux achats, deux lignes : les honoraires du notaire, et le service de Nota.": "Two purchases, two lines: the notary’s fees, and Nota’s service.",
  "Ajoute un document :": "Adds a document:",
  "Retire un document :": "Removes a document:",
  "Choisissez d’abord une date.": "Choose a date first.",
  "Choisissez une date et un montant.": "Choose a date and an amount.",
  "Sous la fourchette du marché, peu susceptible d’être retenue.": "Below the market range, unlikely to be taken.",
  "Dans la fourchette qui se conclut à ce délai.": "Within the range that closes at this notice.",
  "Offre généreuse, susceptible d’être retenue rapidement.": "Generous offer, likely to be taken quickly.",
  "Publier mon offre": "Post my offer",
  "Affichée comme « Client · secteur postal ».": "Displayed as “Client · postal sector”.",
  // ADR 0033 — the mise en relation is complete: the identity block of the
  // booking sheet, and the cancellation line of the intro.
  "Vous fixez la date, le montant et votre niveau d’anonymat. Tant qu’aucun notaire ne l’a retenue, vous retirez votre offre gratuitement ; une fois retenue, des frais peuvent s’appliquer selon le délai — ils vous sont affichés avant de confirmer.": "You set the date, the amount and your level of anonymity. Until a notary retains it, you withdraw your offer for free; once retained, a fee may apply depending on the notice — it is shown to you before you confirm.",
  "Annulation et désistement.": "Cancellation and withdrawal.",
  "Convenez du lieu et de l’heure avec votre notaire dans la conversation ci-dessous, et ajoutez la date à votre agenda. Le notaire peut encore se désister : votre demande reviendrait alors au carnet, publiée telle quelle, et vous en seriez prévenu.": "Agree on the place and time with your notary in the conversation below, and add the date to your calendar. The notary may still withdraw: your request would then return to the carnet, published as is, and you would be notified.",
  "Votre nom — transmis seulement au notaire qui retient votre demande": "Your name — shared only with the notary who retains your request",
  "Votre courriel — pour vous prévenir dès qu’un notaire retient votre demande": "Your email — to let you know as soon as a notary retains your request",
  "Jamais affiché sur le carnet.": "Never shown on the carnet.",
  // 2026-09-07 : la promesse a quitté le LIBELLÉ pour la ligne d'aide — un
  // libellé se reconnaît d'un coup d'œil, une phrase se lit.
  "Votre nom": "Your name",
  "Votre courriel": "Your email",
  "Transmis seulement au notaire qui retient votre demande.": "Shared only with the notary who retains your request.",
  "Pour vous prévenir dès qu’un notaire retient votre demande. Jamais affiché sur le carnet.": "So we can tell you as soon as a notary retains your request. Never shown on the carnet.",
  "Les 3 premiers caractères de votre code postal — votre secteur, jamais votre adresse. Le notaire y lit s’il peut s’y déplacer.": "The first 3 characters of your postal code — your sector, never your address. It tells the notary whether they can travel there.",
  "(recommandé)": "(recommended)",
  "Pour que le notaire qui vous retient puisse vous joindre. Jamais public.": "So the notary who retains you can reach you. Never public.",
  "Offre anonyme sur le carnet": "Anonymous offer on the carnet",
  "Affichée comme « Client · secteur postal ». Votre nom reste transmis au notaire qui vous retient.": "Displayed as “Client · postal sector”. Your name is still shared with the notary who retains you.",
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
  "Ces réglages contrôlent la cloche dans l’application. Utilisez « Préférences de courriel » pour choisir les courriels à recevoir.": "These settings control the in-app bell. Use Email preferences to choose which emails to receive.",
  "Confirmation de publication d’une offre": "Confirmation when an offer is published",
  "Rappels à l’approche de la date": "Reminders as the date approaches",
  "Avis quand un notaire retient votre offre": "Notice when a notary takes on your offer",
  "Propositions de prix des notaires": "Price propositions from notaries",
  "Demandes de documents du notaire": "Document requests from the notary",
  "Messages de votre notaire": "Messages from your notary",
  "Confirmation d’annulation d’une offre": "Confirmation when an offer is cancelled",
  "Acte signé — invitation à évaluer": "Act signed — invitation to evaluate",
  "Avis si le notaire se désiste": "Notice if the notary withdraws",
  "Avis si votre carte est refusée": "Notice if your card is declined",
  // 2026-09-11 — les titres que le serveur écrit dans la cloche (domain.NOTIF_KINDS).
  "Votre offre est publiée": "Your offer is published",
  "Le notaire demande des documents": "The notary requests documents",
  "Votre date approche": "Your date is approaching",
  "Offre annulée": "Offer cancelled",
  "Acte signé": "Act signed",
  "Réponse à votre proposition": "Answer to your proposal",
  "Carte refusée": "Card declined",
  "Nouveau message": "New message",
  "Document reçu": "Document received",
  "Votre demande est retenue": "Your request is retained",
  "Un notaire vous propose un prix": "A notary proposes a price",
  "Votre notaire s’est désisté": "Your notary withdrew",
  "Suite de votre annulation": "About your cancellation",
  "Acte signé — évaluez votre notaire": "Act signed — evaluate your notary",
  "Le notaire s’est désisté — votre demande est de retour au carnet": "The notary has withdrawn — your request is back on the carnet",
  "Mes documents": "My documents",
  "Téléversez ce que le notaire demandera. Ajoutez, retirez ou marquez « validé ». Tout reste sur votre appareil jusqu’à ce qu’un notaire retienne votre demande.": "Upload what the notary will ask for. Add, remove or mark « validated ». Everything stays on your device until a notary takes on your request.",
  "Seules les pièces nécessaires pour l’acte actif sont affichées. Les réponses de votre dossier déterminent la liste ; rien ne bloque votre demande.": "Only the documents needed for the active act are shown. Your file answers determine the list; nothing blocks your request.",
  "Seules les pièces nécessaires selon vos réponses apparaissent ici. Rien ne bloque votre demande ; chaque pièce peut être téléversée ou marquée déjà transmise au notaire.": "Only the documents needed for your answers appear here. Nothing blocks your request; each document can be uploaded or marked as already sent to the notary.",
  "Acte pour lequel préparer les documents": "Act to prepare documents for",
  "Aucun document requis pour cet acte.": "No documents required for this act.",
  "Validé": "Validated",
  "Remplacer le fichier": "Replace the file",
  "Choisir un fichier": "Choose a file",
  "Retirer": "Remove",
  "Format non accepté — utilisez un PDF ou une photo (JPG, PNG, HEIC).": "Format not accepted — use a PDF or a photo (JPG, PNG, HEIC).",
  "Reste sur votre appareil jusqu’à la mise en relation.": "Stays on your device until the match.",
  "ou glissez-le ici": "or drag it here",
  "Votre réponse": "Your answer",
  "Questions qui déterminent le prix": "Questions that determine the price",
  "Enregistrées dans votre profil. Elles ajustent le prix de départ de cet acte.": "Saved in your profile. They adjust this act's starting price.",
  "Consentement de partage": "Sharing consent",
  "Le notaire qui retient votre demande vérifiera votre identité à la signature. Rien n’est transmis avant.": "The notary who takes on your request will verify your identity at signing. Nothing is shared before then.",
  "J’autorise le partage de mon dossier avec le notaire retenu.": "I authorize sharing my file with the notary who takes it on.",
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
  "Créer mon compte gratuit →": "Create my free account →",
  "Montant de l’acte invalide.": "Invalid act amount.",
  "Envoi…": "Sending…",
  "Le résultat du paiement ne peut pas être vérifié. Réessayez avec le même montant.": "The payment outcome could not be verified. Try again with the same amount.",
  "Acte complété. Aucun paiement n’a été effectué par Nota.": "Act completed. No payment was made through Nota.",
  "Le paiement du client est reçu, mais le virement au notaire doit être repris. Réessayez avec le même montant.": "The client's payment was received, but the transfer to the notary needs to be retried. Try again with the same amount.",
  "Marquer complété": "Mark completed",
  "Action impossible (hors ligne).": "Action unavailable (offline).",
  "Session expirée. Reconnectez-vous.": "Session expired. Sign in again.",
  "Impossible de compléter l’acte.": "Unable to complete the act.",
  "Courriel invalide.": "Invalid email.",
  "Abonné — vous recevrez les nouvelles dates.": "Subscribed — you will receive new dates.",
  "Désabonné.": "Unsubscribed.",
  "Console indisponible hors ligne. Réessayez une fois en ligne.": "Console unavailable offline. Try again once you're back online.",
  "Connexion refusée.": "Sign-in refused.",
  "Impossible de charger les demandes. Réessayez.": "Unable to load requests. Try again.",
  "Impossible de charger les demandes (hors ligne). Réessayez.": "Unable to load requests (offline). Try again.",
  "Cette offre a déjà été retenue par un autre notaire.": "This offer has already been taken by another notary.",
  "Offre introuvable, elle a peut-être expiré.": "Offer not found — it may have expired.",
  "Impossible de retenir cette demande.": "Unable to take on this request.",
  "Demande retenue. Dossier du client débloqué — le règlement se fait à la signature.": "Request taken. Client file unlocked — settlement happens at signing.",
  "Impossible de décliner la demande.": "Unable to decline the request.",
  "Demande déclinée.": "Request declined.",
  "Inscrivez-vous pour tout voir": "Sign up to see everything",
  "Des demandes réelles — retenues en un clic": "Real requests — taken in one click",
  "Vous proposez — un notaire retient": "You propose — a notary takes it",
  "Ouverte — à retenir en un clic": "Open — take it on in one click",
  "Ouverte — les notaires de Québec la voient": "Open — Québec notaries can see it",
  "Une semaine sur Nota": "A week on Nota",
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
  "Filtrer les demandes": "Filter requests",
  "Filtrer par jour": "Filter by day",
  "Dossier prêt seulement": "Complete file only",
  "Tous": "All",
  "Dossier complet seulement": "Complete file only",
  // Feed disclosure (ADR 0019): essential rows by default, details on demand.
  "Niveau de détail": "Level of detail",
  "L’essentiel": "Essentials",
  "Tout afficher": "Show everything",
  "Détails": "Details",
  "Réduire": "Collapse",
  "Aucune demande ne correspond à ce filtre.": "No request matches this filter.",
  "demande": "request",
  "demandes": "requests",
  "Confirmer": "Confirm",
  "Annuler": "Cancel",
  "Déclinée": "Declined",
  "Proposer un prix": "Propose a price",
  "Proposer un prix au client": "Propose a price to the client",
  "Votre prix": "Your price",
  "Message au client (facultatif)": "Message to the client (optional)",
  "Envoyer la proposition": "Send the proposal",
  "Proposition envoyée": "Proposal sent",
  "Proposition envoyée au client.": "Proposal sent to the client.",
  "Échec de l’envoi de la proposition.": "Failed to send the proposal.",
  "en attente": "pending",
  "acceptée": "accepted",
  "refusée": "declined",
  "Demander des documents": "Request documents",
  "Demander des documents au client": "Request documents from the client",
  "manquant": "missing",
  "Envoyer la demande": "Send the request",
  "Documents demandés": "Documents requested",
  "Documents fournis": "Documents provided",
  "Demande de documents envoyée au client.": "Document request sent to the client.",
  "Échec de l’envoi de la demande.": "Failed to send the request.",
  // Retained-act conversation (client ↔ notaire) + the withdrawal.
  "Virtuel": "Virtual",
  "virtuel": "virtual",
  "Vos prêteurs habituels": "Your usual lenders",
  "Prêteurs hypothécaires": "Mortgage lenders",
  "Décochez les prêteurs avec lesquels vous ne fermez pas : leurs demandes n’apparaîtront plus dans votre fil. Les prêteurs virtuels (sans succursale) sont signalés.": "Uncheck the lenders you don’t close with: their requests will no longer appear in your feed. Virtual lenders (no branches) are flagged.",
  "Conversation avec le client": "Conversation with the client",
  "Aucun message pour l’instant. Écrivez le premier.": "No messages yet. Write the first one.",
  "Vu": "Seen",
  "Lu par votre correspondant": "Read by the other party",
  "Ouvrir la messagerie": "Open messaging",
  "Écrire au client…": "Write to the client…",
  "Écrire au client": "Write to the client",
  "Ouvrir la conversation": "Open conversation",
  "Vos honoraires vous sont virés à la signature, en entier.": "Your fees are transferred to you in full at signing.",
  "Détails du dossier": "File details",
  "Vue simple": "Simple view",
  "Messages avec votre notaire": "Messages with your notary",
  // ADR 0035 — la garantie de paiement, telle que le NOTAIRE la lit avant de
  // retenir : la pastille, ce qu'elle implique, et la règle générale.
  "Garantie de paiement": "Payment guarantee",
  "Somme réservée": "Amount held",
  "Carte validée": "Card validated",
  "Carte refusée": "Card declined",
  "Réservation expirée": "Hold expired",
  "posée le": "placed on",
  "la somme est bloquée sur la carte du client": "the amount is held on the client’s card",
  "somme réservée le": "amount held on",
  "la somme sera réservée avant la signature": "the amount will be held before the signing",
  "le client doit enregistrer une autre carte": "the client must save another card",
  "aucune somme n’est réservée pour cet acte": "no amount is being held for this act",
  "Aucune garantie en place": "No guarantee in place",
  // ADR 0035 — la caution refusée, et le seul geste qui la répare.
  "Votre carte a été refusée": "Your card was declined",
  "Rien n’a été débité. Votre demande reste en place et votre notaire est prévenu. Enregistrez une autre carte avant votre signature.": "Nothing was charged. Your request stands and your notary has been told. Save another card before your signing.",
  "Enregistrer une autre carte": "Save another card",
  "Le paiement est momentanément indisponible. Réessayez dans quelques minutes.": "Payment is momentarily unavailable. Try again in a few minutes.",
  "Écrire à votre notaire…": "Write to your notary…",
  "Écrire à votre notaire": "Write to your notary",
  "Écrivez un message.": "Write a message.",
  "Message impossible (hors ligne).": "Message failed (offline).",
  "Message impossible.": "Message failed.",
  "Votre notaire vous a écrit": "Your notary wrote to you",
  "Un détail rend ce dossier impossible ? Me désister": "A detail makes this file impossible? Withdraw",
  "L’acte retourne au carnet tel que publié (même date, même montant) et le client est prévenu. Vous ne verrez plus cette demande.": "The act returns to the carnet as published (same date, same amount) and the client is notified. You will no longer see this request.",
  "Motif (facultatif — transmis à l’équipe Nota, jamais publié)": "Reason (optional — sent to the Nota team, never published)",
  "Motif du désistement": "Reason for the withdrawal",
  "Confirmer le désistement": "Confirm the withdrawal",
  "Garder l’acte": "Keep the act",
  "Acte remis au carnet. Le client est prévenu.": "Act returned to the carnet. The client has been notified.",
  "Désistement impossible (hors ligne).": "Withdrawal failed (offline).",
  "Désistement impossible.": "Withdrawal failed.",
  "Agenda": "Calendar",
  ".ics": ".ics",
  "Prix accepté sur proposition": "Price accepted on proposal",
  "Dossier du client": "Client file",
  "Acte complété": "Act completed",
  "Acte signé ? Confirmez la valeur finale": "Act signed? Confirm the final value",
  "Valeur de l’acte": "Act value",
  "Actes complétés": "Acts completed",
  "Vos honoraires": "Your fees",
  "Payé par les clients": "Paid by clients",
  "Frais de service Nota": "Nota service fee",
  "Valeur réalisée": "Value realized",
  "Net à vous": "Net to you",
  // === ADR 0028 — la cote sur 100 et le partage qu'elle décide. ===========
  "Votre cote": "Your score",
  "Votre relevé d’actes": "Your act statement",
  "Ce que vous portez, service par service": "What you carry, service by service",
  "pas encore d’avis": "no reviews yet",
  "Aucun avis": "No reviews",
  "Satisfaction des clients": "Client satisfaction",
  "Services rendus": "Acts delivered",
  "Disponibilité": "Availability",
  "Présence sur Nota": "Presence on Nota",
  "Urgences en ligne : oui": "Online urgencies: yes",
  "Urgences en ligne : non": "Online urgencies: no",
  "Fiche CNQ : oui": "CNQ record: yes",
  "Fiche CNQ : non": "CNQ record: no",
  "Secteur postal : oui": "Postal sector: yes",
  "Secteur postal : non": "Postal sector: no",
  "Décliner compte comme une réponse ; seul le silence coûte des points.": "Declining counts as an answer; only silence costs points.",
  "Se spécialiser ne coûte rien : l’éventail n’entre pas dans la cote.": "Specializing costs nothing: breadth of catalogue does not count toward the score.",
  "Activité aujourd’hui": "Active today",
  "Membre depuis aujourd’hui": "Member since today",
  "Taux": "Rate",
  "Net": "Net",
  "Total": "Total",
  "Prix total": "Total price",
  "Votre relevé s’ouvrira ici dès votre premier acte réglé.": "Your statement will open here after your first settled act.",
  "Chaque ligne porte le taux que votre cote valait au règlement de l’acte.": "Every line carries the rate your score was worth when the act settled.",
  // ADR 0029 — un règlement hors plateforme est une créance, pas une recette.
  
  "Impossible de charger votre relevé. Réessayez.": "Could not load your statement. Try again.",
  "Impossible de charger votre relevé (hors ligne). Réessayez.": "Could not load your statement (offline). Try again.",
  "Déconnecté.": "Signed out.",
  "Quitter le plein écran": "Exit full screen",
  "Plein écran": "Full screen",
  "Redirection vers l’inscription…": "Redirecting to sign-up…",
    "Votre carte est acceptée. Votre offre est en cours de publication.": "Your card is accepted. Your offer is being published.",
  "Paiement annulé. Votre offre n’a pas été publiée.": "Payment cancelled. Your offer was not published.",
  "Nota — le carnet public des actes notariés à Québec": "Nota — the public carnet of notarized acts in Québec",
  "Trouvez un notaire à Québec pour votre financement ou refinancement hypothécaire, à la date voulue. Affichez votre date et votre offre ; un notaire de la région choisit de retenir votre demande. Publier est gratuit. Nota n’est pas un notaire.": "Find a notary in Quebec City for your mortgage financing or refinancing, on the date you need. Post your date and your offer; a notary in the region chooses whether to take on your request. Posting is free. Nota is not a notary.",
  "Choisissez votre date, nommez votre prix pour votre financement ou refinancement hypothécaire. Un notaire de Québec retient votre demande. Publier est gratuit ; le notaire et le service Nota se paient à la signature.": "Choose your date, name your price for your mortgage financing or refinancing. A Québec notary takes on your request. Posting is free; the notary and Nota’s service are paid at signing.",
  "Nota — carnet public des actes notariés à Québec": "Nota — public carnet of notarized acts in Québec",
  "Choisissez votre date, nommez votre prix. Un notaire de Québec retient votre demande.": "Choose your date, name your price. A Québec notary takes on your request.",
  "Carte Nota : le carnet public du financement hypothécaire à Québec.": "Nota card: the public carnet of mortgage financing in Québec City.",
  "Aller au contenu": "Skip to content",
  "Nota, accueil — retour au menu": "Nota, home — back to the menu",
  "Sections": "Sections",
  "Carnet": "Carnet",
  "Notaires": "Notaries",
  "Ouvrir le menu": "Open the menu",
  "Options": "Options",
  "Langue": "Language",
  "Thème": "Theme",
  "Thème sombre": "Dark theme",
  "Thème clair": "Light theme",
  "Préférences": "Preferences",
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
  "Plus d’options — Carnet": "More options — Carnet",
  "Plus d’options — Espace notaire": "More options — Notary space",
  "Choisissez la date et le prix — les notaires répondent.": "Pick the date and the price — notaries respond.",
  "Le guide pas à pas, du prix à la signature.": "The step-by-step guide, from price to signing.",
  "Les documents à réunir, expliqués simplement.": "The documents to gather, explained simply.",
  "Les demandes de Québec, triées par date de signature.": "Québec’s requests, sorted by signing date.",
  "Google, Outlook ou Apple — à jour automatiquement.": "Google, Outlook or Apple — updated automatically.",
  "Place de marché des services notariaux · Québec": "Notarial services marketplace · Québec",
  "Un notaire, à la date qu’il vous faut.": "A notary, on the date you need.",
  "Proposez votre date et votre prix. Un notaire de Québec retient votre demande.": "Propose your date and your price. A Québec notary takes on your request.",
  // The hero's price line (ADR 0031): the notary keeps the whole offer, Nota's
  // service is paid at signing. The priced variant is composed at runtime and
  // rides a RULE (the amount passes through to the money conversion).
  "Le notaire reçoit 100 % de votre offre. Le service Nota, à un prix publié d’avance, se paie seulement à la signature.": "The notary receives 100% of your offer. Nota’s service, at a price published in advance, is paid only at signing.",
  // ADR 0034 — le devis, ligne par ligne. La garantie de date est ce que NOTA
  // vend ; elle ne se confond pas avec le droit du notaire de tenir compte de
  // l'urgence dans SES honoraires (art. 49 4° C.déont.).
  "Garantie de date Nota": "Nota date guarantee",
  // Le devis avant que la grille ne soit connue (hors ligne, fixtures) : un mot,
  // jamais un tiret qui se lirait comme un montant nul.
  "à confirmer": "to be confirmed",
  // ADR 0041 — l'indemnité de résiliation : rien n'est prélevé à l'annulation,
  // le notaire réclame (sur justification, dans un délai, sous un plafond) ou
  // renonce. Les phrases fixes sont ici ; les composées (montant, %, jours)
  // ont leur règle plus bas.
  "Rien n’est retenu automatiquement.": "Nothing is kept automatically.",
  "Tant que votre offre est ouverte, la retirer est gratuit. Une fois qu’un notaire l’a retenue, annuler à 15 jours et plus de la date reste gratuit. Plus près de la date, rien n’est prélevé d’office : le notaire peut réclamer, sur justification et dans un délai, ses frais réels et la valeur du travail accompli (art. 2129 du Code civil du Québec), jusqu’à un plafond publié selon le préavis, soit 10 % du montant convenu de 4 à 14 jours et 30 % à 3 jours ou moins. Sans réclamation, rien n’est retenu. Une indemnité réclamée est versée au notaire en dédommagement de la journée réservée, jamais à Nota, et le plafond vous est affiché avant toute confirmation. Ces plafonds sont ceux du déploiement par défaut ; l’application affiche toujours ceux en vigueur avant que vous n’annuliez. Le notaire peut lui aussi se désister, sans frais pour lui : votre offre revient alors au carnet, publiée telle quelle, et vous en êtes prévenu.": "While your offer is open, withdrawing it is free. Once a notary has taken it, cancelling 15 days or more before the date stays free. Closer to the date, nothing is taken automatically: the notary may claim, with a written reason and within a deadline, their real costs and the value of work done (art. 2129 of the Civil Code of Québec), up to a published cap by notice, 10% of the agreed amount from 4 to 14 days and 30% at 3 days or less. Without a claim, nothing is kept. A claimed indemnity is paid to the notary as compensation for the reserved day, never to Nota, and the cap is shown to you before any confirmation. These caps are the deployment defaults; the app always shows the ones in force before you cancel. The notary may also withdraw, at no cost to them: your offer then returns to the carnet, published as is, and you are told.",
  "La somme réservée sur votre carte reste en place jusqu’à sa décision, puis vous est libérée.": "The amount held on your card stays in place until their decision, then is released to you.",
  "Un montant réclamé serait porté à la carte que vous avez enregistrée.": "A claimed amount would be charged to the card you registered.",
  "Une indemnité réclamée est versée au notaire en dédommagement de la journée réservée, jamais à Nota.": "A claimed indemnity is paid to the notary as compensation for the reserved day, never to Nota.",
  "Votre notaire n’a réclamé aucune indemnité : rien n’est retenu.": "Your notary claimed no indemnity: nothing is kept.",
  "Aucune indemnité n’a été réclamée dans le délai : rien n’est retenu.": "No indemnity was claimed within the period: nothing is kept.",
  "Annulation sans frais tant qu’aucun notaire n’a retenu votre demande.": "Cancellation is free until a notary takes your request.",
  "Rien n’est retenu sans réclamation, et l’indemnité va au notaire, jamais à Nota.": "Nothing is kept without a claim, and the indemnity goes to the notary, never to Nota.",
  "vous pourriez réclamer, sur justification, jusqu’à": "you could claim, with a written reason, up to",
  "Annulée par le client": "Cancelled by the client",
  "Le client a annulé après votre rétention. Vous pouvez réclamer vos frais réels et la valeur du travail accompli, sur justification, jusqu’à": "The client cancelled after you took the act. You may claim your real costs and the value of work done, with a written reason, up to",
  "d’ici le": "by",
  "Sans réclamation de votre part, rien n’est prélevé au client. L’indemnité vous est versée en entier.": "Without a claim from you, nothing is charged to the client. The indemnity is paid to you in full.",
  "Montant réclamé (en dollars)": "Amount claimed (in dollars)",
  "Montant réclamé, en dollars": "Amount claimed, in dollars",
  "Justification : frais engagés, travail accompli (au moins 20 caractères)": "Reason: costs incurred, work done (at least 20 characters)",
  "Justification de l’indemnité": "Reason for the indemnity",
  "Réclamer cette indemnité": "Claim this indemnity",
  "Renoncer à toute indemnité": "Waive any indemnity",
  "Réclamation impossible (hors ligne).": "Could not send the claim (offline).",
  "Réclamation impossible.": "Could not send the claim.",
  "La carte du client a refusé le prélèvement.": "The client’s card declined the charge.",
  "Vous avez renoncé à toute indemnité.": "You waived any indemnity.",
  "Ce sont des plafonds : vous pourrez réclamer, sur justification et dans le délai, vos frais réels et la valeur du travail accompli. Rien n’est prélevé sans votre réclamation, et l’indemnité vous est versée en entier, en dédommagement de la journée réservée.": "These are caps: you may claim, with a written reason and within the deadline, your real costs and the value of work done. Nothing is charged without your claim, and the indemnity is paid to you in full, as compensation for the reserved day.",
  "Le notaire garde 100 % de ses honoraires.": "The notary keeps 100% of their fee.",
  "Date de signature": "Signing date",
  // After a real publication — what happens next, no delay promise.
  "Votre demande est maintenant visible des notaires inscrits.": "Your request is now visible to registered notaries.",
  "Nous vous écrivons dès qu’un notaire la retient.": "We email you the moment a notary takes it on.",
  "Vous pouvez la retirer sans frais jusque-là.": "You can withdraw it free of charge until then.",
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
  "Préparer mon dossier": "Prepare my file",
  "Publier une demande": "Post a request",
  "Commencer": "Get started",
  "Pour les notaires, remplissez votre semaine.": "For notaries, fill your week.",
  /* Le chemin des menus Google / Outlook, écrit sous le lien. */
  "Google Agenda": "Google Calendar",
  "Autres agendas": "Other calendars",
  "À partir de l’URL": "From URL",
  "collez le lien.": "paste the link.",
  "Outlook": "Outlook",
  "Ajouter un calendrier": "Add calendar",
  "S’abonner à partir du web": "Subscribe from web",
  /* Vignettes montrées plutôt que décrites (2026-09-12). */
  "Dans votre agenda": "In your calendar",
  "en demandes ouvertes": "in open requests",
  "Vous collez le lien une fois. Ensuite, chaque nouvelle demande arrive toute seule dans votre agenda, à son jour de signature.": "You paste the link once. After that every new request lands in your calendar on its own, on its signing day.",
  /* ADR 0052 §A — les quatre promesses de la page des notaires. */
  "Ce que vous obtenez": "What you get",
  "Votre semaine se remplit, et l’urgence se paie.": "Your week fills up, and urgency pays.",
  "Dans l’agenda que vous regardez déjà": "In the calendar you already watch",
  "Google, Outlook ou Apple : un lien à coller, et les demandes ouvertes s’y tiennent à jour toutes seules. Rien à installer, aucun mot de passe à donner.": "Google, Outlook or Apple: paste one link, and the open requests keep themselves up to date there. Nothing to install, no password to hand over.",
  "Les trous de votre semaine se comblent": "The gaps in your week get filled",
  "Chaque demande porte une date précise, déjà choisie par le client. Vous ne prenez que celles qui tombent dans vos disponibilités.": "Every request carries a precise date, already chosen by the client. You take only the ones that land in your open time.",
  "Une date rapprochée paie davantage": "A closer date pays more",
  "C’est un marché d’urgence : le délai est la seule chose que le client ne peut pas déplacer, et le degré d’urgence est un facteur d’honoraires reconnu (art. 49 4° du Code de déontologie).": "This is an urgency market: the deadline is the one thing the client cannot move, and the degree of urgency is a recognized factor in a notary’s fees (s. 49(4), Code of ethics).",
  "Tout est là avant que vous décidiez": "Everything is there before you decide",
  "Montant, date, prêteur, déplacement, secteur : pour les actes simples du catalogue, la fiche est complète quand vous l’ouvrez. Vous retenez, ou vous passez.": "Amount, date, lender, travel, postal sector: for the simple acts in the catalogue, the request is complete when you open it. You take it on, or you pass.",
  /* ADR 0052 §B — l'échange de la préparation assistée. */
  "La préparation assistée n’est pas encore ouverte : aucun prix ni échéance n’est fixé.": "Assisted preparation is not open yet: no price and no date have been set.",
  "Notre IA propriétaire prépare le dossier avec vous : elle trie les documents, relève ce qui manque et signale les contradictions. Vous vérifiez chaque proposition — elle ne décide rien.": "Our proprietary AI prepares the file with you: it sorts the documents, flags what is missing and surfaces contradictions. You check every proposal — it decides nothing.",
  "Deux voies, une seule différence. Si vous payez, vous ne devez rien à l’apprentissage. Si vous ne payez pas, vos corrections servent à améliorer le système.": "Two lanes, one difference. If you pay, you owe the learning program nothing. If you do not pay, your corrections go toward improving the system.",
  "Vos corrections, c’est un champ accepté, un champ corrigé, une question escaladée. Jamais un document de votre client, jamais une valeur de son dossier : le secret professionnel ne vous appartient pas. Et refuser les deux ne vous retire rien du marché — les demandes, l’agenda et la console restent gratuits.": "Your corrections are an accepted field, a corrected field, an escalated question. Never a document belonging to your client, never a value from their file: professional secrecy is not yours to give. And refusing both takes nothing away from the marketplace — the requests, the calendar and the console stay free.",
  "Inscrivez-vous, gratuit": "Sign up, free",
  "Retenez ce qui vous convient": "Take on what suits you",
  "Ce que vous obtenez": "What you get",
  "Ajouter le carnet des demandes à votre agenda": "Add the carnet of requests to your calendar",
  "Votre outil de prospection": "Your prospecting tool",
  "Toutes les demandes ouvertes à Québec, à jour automatiquement dans Google, Outlook ou Apple.": "All the open requests in Québec, automatically up to date in Google, Outlook or Apple.",
  "demandes ouvertes": "open requests",
  "à retenir": "to take on",
  "Réservé aux notaires": "Notaries only",
  "Accédez aux demandes": "Access the requests",
  "Courriel professionnel": "Professional email",
  "vous@etude.ca": "you@firm.ca",
  "Continuer avec mon courriel professionnel →": "Continue with my professional email →",
  "Sans mot de passe.": "No password.",
  "Première visite": "First visit",
  "Bienvenue !": "Welcome!",
  "Créez votre compte gratuit pour": "Create your free account for",
  ", en deux étapes et sans engagement :": ", in two steps with no commitment:",
  "← Utiliser un autre courriel": "← Use another email",
  "Connexion en un clic": "One-click sign-in",
  "ou": "or",
  "À venir": "Soon",
  "Continuer avec Google": "Continue with Google",
  "Continuer avec Facebook": "Continue with Facebook",
  "Continuer avec LinkedIn": "Continue with LinkedIn",
  "Vous avez déjà publié une demande ?": "Already published a request?",
  "Vous avez déjà un compte notaire ?": "Already have a notary account?",
  "Première visite sur Nota ?": "First time on Nota?",
  "Pas encore inscrit comme notaire ?": "Not registered as a notary yet?",
  "Déjà partenaire et vous avez perdu votre code ?": "Already a partner and lost your code?",
  "Recevoir mon code par courriel": "Email me my code",
  "Vos honoraires sont momentanément indisponibles. Réessayez dans un instant — rien n’est perdu.": "Your fees are momentarily unavailable. Try again in a moment — nothing is lost.",
  "Aucune demande ouverte pour l’instant. Vous n’acceptez aucun déplacement : seuls les clients qui viennent à votre étude vous sont proposés. Augmentez votre rayon dans « Votre profil public » pour en voir davantage.": "No open requests right now. You accept no travel: only clients who come to your office are shown to you. Raise your radius in “Your public profile” to see more.",
  "Le client qui vous retient doit pouvoir vous joindre et trouver votre étude — et tant que votre profil est incomplet, les demandes qui vous conviennent ne vous sont pas proposées. Il manque :": "The client who retains you must be able to reach you and find your office — and while your profile is incomplete, the requests that suit you are not shown to you. Missing:",
  "Vous déposez votre inscription —": "You file your application —",
  "aucun paiement, aucune pièce à fournir": "no payment, no document to provide",
  "ici.": "here.",
  "Nous vérifions votre inscription au": "We check your registration with the",
  "Tableau de l’Ordre": "Roll of the Order",
  ", puis votre console s’ouvre. Vous recevez un courriel.": ", then your console opens. You get an email.",
  "L’inscription est gratuite et sans engagement. Vos versements se branchent plus tard, depuis votre console, quand vous le voulez.": "Signing up is free with no commitment. Your payouts are connected later, from your console, whenever you like.",
  "Inscription reçue": "Application received",
  "Merci ! Votre inscription est déposée pour": "Thank you! Your application is filed for",
  "Nous vérifions votre inscription au Tableau de l’Ordre des notaires du Québec. Dès que votre dossier est approuvé, vous recevez un courriel avec votre lien de connexion — votre console s’ouvre à ce moment-là.": "We are checking your registration with the Roll of the Ordre des notaires du Québec. As soon as your file is approved you will get an email with your sign-in link — that is when your console opens.",
  "Rien d’autre à faire de votre côté. Si vous ne voyez rien venir, vérifiez vos indésirables ou écrivez-nous.": "Nothing else to do on your side. If nothing arrives, check your spam folder or write to us.",
  "Première visite ? Créer un compte gratuit": "First time? Create a free account",
  "Vérifiez votre boîte courriel": "Check your inbox",
  "Nous venons d’envoyer un lien de connexion sécurisé à": "We’ve just sent a secure sign-in link to",
  "Ouvrez ce lien pour accéder à votre console. Il est valide 15 minutes et à usage unique. Pensez à vérifier vos indésirables.": "Open that link to reach your console. It is valid for 15 minutes and single-use. Remember to check your spam folder.",
  "Connecté": "Signed in",
    "Recevez vos demandes à votre rythme": "Receive your requests at your own pace",
  "Choisissez comment et à quelle fréquence Nota vous prévient des nouvelles demandes qui vous conviennent. Modifiable à tout moment.": "Choose how and how often Nota alerts you to new requests that suit you. Adjustable at any time.",
  "Comment vous prévenir": "How to reach you",
  "Dans l’application": "In the app",
  "toujours actif": "always on",
  "Par courriel": "By email",
  "Par texto (SMS)": "By text (SMS)",
  "Mobile pour les textos": "Mobile number for texts",
  "Alertes par texto": "Text alerts",
  "Envoyées au numéro de votre profil": "Sent to the number on your profile",
  "Me prévenir aussi par texto (SMS) aux moments clés — un notaire retient ma demande, un message, la veille de la signature.": "Also text me (SMS) at key moments — a notary takes my request, a message, the day before the signing.",
  "Aucun numéro de téléphone enregistré : le texto n’est pas offert.": "No phone number on record: texting is not available.",
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
  "Vos signatures dans votre agenda": "Your signings in your calendar",
  "S’abonner avec un lien": "Subscribe with a link",
  "Outlook ou Apple": "Outlook or Apple",
  "Copiez ce lien dans votre calendrier": "Copy this link into your calendar",
  "Les demandes se mettent à jour automatiquement.": "Requests update automatically.",
  "Vos signatures se mettent à jour automatiquement.": "Your signings update automatically.",
  "Un fichier .ics téléchargé est une copie ponctuelle. Ouvrez le lien d’une demande pour la consulter et la retenir dans Nota.": "A downloaded .ics file is a one-time copy. Open a request link to view it and take it on in Nota.",
  "Un fichier .ics téléchargé est une copie ponctuelle. Ouvrez le lien d’une signature pour retrouver le dossier dans Nota.": "A downloaded .ics file is a one-time copy. Open a signing link to return to the file in Nota.",
  "Lien d’abonnement": "Subscription link",
  "Télécharger .ics": "Download .ics",
  "Dans Outlook professionnel, ajoutez un calendrier à partir du Web et collez ce lien. Dans Apple, choisissez un abonnement à un calendrier.": "In work Outlook, add a calendar from the web and paste this link. In Apple, choose a calendar subscription.",
  "L’abonnement se met à jour au rythme de votre application. Un fichier .ics téléchargé est une copie ponctuelle. Ouvrez le lien dans un événement pour consulter la demande et la retenir dans Nota.": "The subscription updates on your calendar app’s schedule. A downloaded .ics file is a one-time copy. Open the link in an event to view and retain the request in Nota.",
  "Vos signatures se mettent à jour au rythme de votre application. Un fichier .ics téléchargé est une copie ponctuelle. Ouvrez le lien dans un événement pour retrouver le dossier dans Nota.": "Your signings update on your calendar app’s schedule. A downloaded .ics file is a one-time copy. Open the link in an event to return to the file in Nota.",
  "Vos dossiers retenus, à jour automatiquement (webcal).": "Your taken files, automatically up to date (webcal).",
  "Ouvertes en ce moment": "Open right now",
  "Pas d’offre": "No offer",
  "Pas d’offres": "No offers",
  "Les offres disponibles s’afficheront ici.": "Available offers will appear here.",
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
  "Sécurité et conformité": "Security and compliance",
  "Notre démarche de conformité est en cours.": "Our compliance program is in progress.",
  "Nous préparons actuellement notre démarche vers SOC 2 et ISO/IEC 27001, pour les Types I et II. Notre cible est le 1er trimestre 2027.": "We are currently preparing our path toward SOC 2 and ISO/IEC 27001, for both Type I and Type II. Our target is Q1 2027.",
  "En préparation": "In progress",
  "SOC 2": "SOC 2",
  "ISO/IEC 27001": "ISO/IEC 27001",
  "Types I et II": "Type I and Type II",
  "Cible": "Target",
  "1er trimestre 2027": "Q1 2027",
  "Ces certifications ne sont pas encore obtenues. La cible pourra évoluer selon la portée et les évaluations.": "These certifications have not yet been obtained. The target may change based on scope and assessments.",
  "Vos droits et nos engagements": "Your rights and our commitments",
  "Droit de suppression.": "Right to deletion.",
  "Vous pouvez demander l’accès, la rectification ou la suppression de vos renseignements en tout temps en écrivant à": "You can request access to, correction of, or deletion of your information at any time by writing to",
  ". Nous répondons dans un délai de 30 jours.": ". We respond within 30 days.",
  "Partage du dossier.": "File sharing.",
  "Le contenu de votre dossier n’est transmis à personne tant qu’un notaire n’a pas retenu votre demande, et seulement après votre consentement explicite. Les documents eux-mêmes sont échangés de façon sécurisée à cette étape.": "The contents of your file are shared with no one until a notary has taken on your request, and only after your explicit consent. The documents themselves are exchanged securely at that step.",
  "Vérification d’identité.": "Identity verification.",
  "Nota ne vérifie pas votre identité. C’est le notaire qui retient votre demande qui vérifie votre identité au moment de la signature, comme l’exige la loi.": "Nota does not verify your identity. The notary who takes on your request verifies your identity at signing, as the law requires.",
  "Aucune revente.": "No resale.",
  "Responsable.": "Accountability.",
  "Une personne responsable de la protection des renseignements personnels supervise ces pratiques :": "A person responsible for the protection of personal information oversees these practices:",
  "Les règles du service, en clair.": "The rules of the service, in plain language.",
  "En utilisant Nota, vous acceptez ces conditions. Nota est une place de marché qui met en relation des clients et des notaires du Québec. Nota n’est pas un notaire et ne pose aucun acte notarié.": "By using Nota, you accept these terms. Nota is a marketplace that connects clients with Québec notaries. Nota is not a notary and performs no notarized acts.",
  "Ce qu’est Nota": "What Nota is",
  "Un carnet public où vous proposez une date et un montant. Un notaire du Québec choisit de retenir votre demande. Nota facilite la mise en relation, rien de plus.": "A public carnet where you propose a date and an amount. A Québec notary chooses to take on your request. Nota facilitates the connection, nothing more.",
  "Vous restez maître": "You stay in charge",
  "Vous fixez la date, le montant et votre niveau d’anonymat. Aucune obligation : vous pouvez retirer une offre tant qu’aucun notaire ne l’a retenue.": "You set the date, the amount and your level of anonymity. No obligation: you can withdraw an offer as long as no notary has taken it.",
  "Les conditions": "The terms",
  "Rôle de Nota.": "Nota's role.",
  "Nota fournit une plateforme de mise en relation. Nous ne rédigeons pas d’actes, ne donnons aucun conseil juridique, fiscal ou financier, et ne sommes pas partie au mandat entre vous et le notaire.": "Nota provides a matchmaking platform. We do not draft acts, give no legal, tax or financial advice, and are not a party to the mandate between you and the notary.",
  "Indépendance du notaire.": "The notary's independence.",
  "Le notaire qui retient votre demande agit en toute indépendance : il fixe ses honoraires, vérifie votre identité et rédige l’acte selon la loi. Nota n’intervient jamais dans l’acte notarié.": "The notary who takes on your request acts fully independently: they set their fees, verify your identity and draft the act according to the law. Nota never intervenes in the notarized act.",
  "Vos engagements.": "Your commitments.",
  "Vous fournissez des renseignements exacts et n’utilisez pas le service à des fins illégales ou trompeuses. Une offre publiée est un engagement de bonne foi à procéder à la date convenue.": "You provide accurate information and do not use the service for illegal or misleading purposes. A published offer is a good-faith commitment to proceed on the agreed date.",
  // Art. 68 — le badge dit une DÉCLARATION du notaire, jamais un contrôle de Nota.
  "Fiche déclarée": "Listing declared",
  "Fiche déclarée à la Chambre": "Listing declared to the Chambre",
  "Fiche déclarée par le notaire dans l’annuaire de la Chambre des notaires du Québec. Nota ne vérifie pas cette déclaration.": "Listing declared by the notary in the Chambre des notaires du Québec directory. Nota does not verify this declaration.",
  "Vérifier un notaire dans l’annuaire de la Chambre des notaires du Québec ↗": "Look up a notary in the Chambre des notaires du Québec directory ↗",
  "Vérifier sa fiche à la Chambre ↗": "Check their listing at the Chambre ↗",
  "Ouvre la fiche déclarée par ce notaire dans l’annuaire de la Chambre des notaires du Québec.": "Opens the listing this notary declared in the Chambre des notaires du Québec directory.",
  // Données de démonstration : déclarées des deux côtés de la langue.
  "Données de démonstration": "Demonstration data",
  "Le carnet réel n’a pas pu être chargé. Ces offres et ces montants sont fictifs.": "The real carnet could not be loaded. These offers and amounts are fictional.",
  "démonstration": "demonstration",
  "Chiffres de démonstration : le carnet réel n’a pas pu être chargé.": "Demonstration figures: the real carnet could not be loaded.",
  "Rien n’a été publié. Le carnet réel est injoignable : cette offre n’existe que sur cet appareil, et aucun notaire ne la verra.": "Nothing was published. The real carnet is unreachable: this offer exists only on this device, and no notary will see it.",
  "Enregistrée sur cet appareil seulement.": "Saved on this device only.",
  // Affirmations corrigées (audit 2026-09-01) : ce que le code fait vraiment.
  "Première visite ou retour, c’est le même geste.": "First visit or return, it is the same gesture.",
  "Publiez une demande et suivez vos offres.": "Post a request and follow your offers.",
  "Plus la date est éloignée, plus de notaires ont la latitude de s’organiser pour la prendre ; une date rapprochée en laisse moins.": "The further out the date, the more notaries have room to arrange to take it; a nearer date leaves fewer.",
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
  "Un prix de départ clair par service et deux lignes annoncées d’avance : les honoraires du notaire — ce que vous offrez est ce qu’il reçoit — et le prix du service de Nota, publié d’avance. Aucun frais caché : les plafonds d’indemnité d’annulation sont publiés dans les": "A clear starting price per service and two lines announced in advance: the notary’s fees — what you offer is what they receive — and Nota’s service price, published in advance. No hidden fees: the cancellation indemnity caps are published in the",
  ", publié d’avance : il dépend du service demandé et du délai avant la signature, jamais du notaire ni du montant que vous offrez. Les deux vous sont affichés avant que votre carte ne soit autorisée.": ", published in advance: it depends on the service requested and on the notice before signing, never on the notary nor on the amount you offer. Both are shown to you before your card is authorized.",
  "s’ajoute au vôtre. Il est publié d’avance et dépend de deux choses que vous choisissez — le service demandé et le délai avant la signature — jamais du notaire, de sa cote ni du montant que vous offrez. Il vous est affiché avant l’autorisation de votre carte, et c’est celui-là qui vous est facturé.": "is added to yours. It is published in advance and depends on two things you choose — the service requested and the notice before signing — never on the notary, their cote, nor the amount you offer. It is shown to you before your card is authorized, and that is the one you are charged.",
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
  "Vidéos Nota": "Nota videos",
  "LinkedIn de Nota": "Nota on LinkedIn",
  "Explorer": "Explore",
  "Le carnet": "The carnet",
  "Légal": "Legal",
  "Nota · Fait à Québec": "Nota · Made in Québec",
  "Données hébergées au Canada · Loi 25": "Data hosted in Canada · Law 25",
  "Réserver cette date": "Reserve this date",
  "Fermer": "Close",
  "Quel acte\u00a0?": "Which act?",
  "Choisir l’acte": "Choose the act",
  "Standard": "Standard",
  "Votre offre": "Your offer",
  "(pré-remplie)": "(pre-filled)",
  "Montant de l’offre": "Offer amount",
  "Choisissez un acte.": "Choose an act.",
  "Options et confidentialité": "Options and privacy",
  "Offre anonyme": "Anonymous offer",
  "Nom affiché publiquement": "Name displayed publicly",
  "Secteur postal": "Postal sector",
  "Les 3 premiers caractères de votre code postal, le seul repère de lieu que voient les notaires. Il indique votre secteur sans révéler votre adresse.": "The first 3 characters of your postal code — the only location marker notaries see. It shows your sector without revealing your address.",
  "Les 3 premiers caractères de votre code postal — requis pour situer le déplacement du notaire. Il indique votre secteur sans révéler votre adresse.": "The first 3 characters of your postal code — required to place the notary's travel. It shows your sector without revealing your address.",
  "Le secteur postal est requis (les 3 premiers caractères de votre code postal).": "The postal sector is required (the first 3 characters of your postal code).",
  "Le secteur postal doit être une lettre, un chiffre, une lettre, comme « G1R ».": "The postal sector must be a letter, a digit, a letter, like “G1R”.",
  "Courriel (optionnel)": "Email (optional)",
  "Sert à vous prévenir. Jamais affiché.": "Used to notify you. Never displayed.",
  "Créer mon compte avec ce courriel": "Create my account with this email",
  "Facultatif, sans mot de passe. Pour retrouver vos offres et suivre les réponses.": "Optional, no password. To find your offers again and follow the replies.",
  "En publiant, la date, le service, le montant et le secteur postal deviennent publics. Aucun document n’est transmis à cette étape. Données au Canada, supprimées sur demande (Loi 25).": "When you publish, the date, the service, the amount and the postal sector become public. No document is shared at this step. Data kept in Canada, deleted on request (Law 25).",
  "Offre publiée.": "Offer published.",
  "Une dernière étape la fait retenir plus vite.": "One last step gets it taken faster.",
  "Ajouter la date à mon agenda": "Add the date to my calendar",
  "Télécharger .ics": "Download .ics",
  "Google Agenda": "Google Calendar",
  "Rendre votre offre publique ?": "Make your offer public?",
  "Rester anonyme": "Stay anonymous",
  "Afficher mon nom": "Show my name",
  "Bienvenue sur Nota": "Welcome to Nota",
  "Créer votre compte": "Create your account",
  "Connexion": "Sign in",
  "Sans mot de passe — votre courriel suffit.": "No password — your email is enough.",
  "Créer mon compte": "Create my account",
  "Me connecter": "Sign in",
  "Recevoir mon lien de connexion →": "Get my sign-in link →",
  "Un lien sécurisé arrive par courriel — un clic et vous êtes dans l’espace notaire.": "A secure link lands in your inbox — one click and you are in the notary space.",
  "Vous êtes": "You are",
  "Je suis client": "I’m a client",
  "Bientôt": "Coming soon",
  "vous@courriel.ca": "you@email.ca",
  "Comment souhaitez-vous utiliser Nota\u00a0?": "How would you like to use Nota?",
  "Comment souhaitez-vous utiliser Nota ?": "How would you like to use Nota?",
  "Étape 1 sur 2": "Step 1 of 2",
  "Publiez votre demande — date et prix\u00a0; un notaire la retient.": "Post your request — date and price; a notary takes it on.",
  "Voyez les demandes ouvertes à Québec.": "See the open requests in Québec.",
  "Changer": "Change",
  "Étape 2 sur 2": "Step 2 of 2",
  "Passer": "Skip",
  "Demandes réelles ouvertes en ce moment, placées à leur jour de signature.": "Real requests open right now, placed on their signing day.",
  "Le carnet s’ajoute à votre agenda en un clic.": "The carnet adds to your calendar in one click.",
  "Publiée au carnet": "Published to the carnet",
  "courriel, texto, fréquence, actes": "email, text message, frequency, acts",
  "Des clients de Québec ont fixé leur date et leur prix. Retenez ce qui vous convient.": "Québec clients have set their date and price. Take on what suits you.",

  // --- Price first, documents after (ADR 0010 §3) --------------------------
  "Le prix d’abord, les documents ensuite.": "Price first, documents after.",
  "Les questions ci-dessous fixent le prix ; les documents se préparent après la mise en relation — ils ne bloquent jamais votre demande.": "The questions below set the price; the documents are prepared after the match — they never block your request.",
  "Documents — à préparer après la mise en relation": "Documents — to prepare after the match",
  "À préparer — après la mise en relation": "To prepare — after the match",
  "Rien ici ne bloque votre demande. Chaque pièce peut être téléversée, ou marquée déjà transmise au notaire par un autre canal.": "Nothing here blocks your request. Each item can be uploaded, or marked as already sent to the notary through another channel.",
  "✓ Prête à être retenue : questions de prix répondues, partage consenti. Les documents se préparent après la mise en relation.": "✓ Ready to be taken on: price questions answered, sharing consented. The documents are prepared after the match.",
  "Autorisez le partage de votre dossier depuis la page « Mon dossier » — il sera transmis dès qu’un notaire retient votre demande.": "Authorize sharing your file from the “My file” page — it will be sent as soon as a notary takes your request.",
  "En attendant qu’un notaire la retienne, préparez vos documents — ils seront transmis après la mise en relation, rien ne bloque votre demande.": "While you wait for a notary to take it on, prepare your documents — they will be sent after the match; nothing blocks your request.",
  "Pendant l’attente, préparez vos documents.": "While you wait, prepare your documents.",
  "Préparez vos documents": "Prepare your documents",
  "À transmettre après la mise en relation — rien ne bloque votre demande.": "To send after the match — nothing blocks your request.",
  "Documents prêts ✓": "Documents ready ✓",
  "Tout est prêt pour la mise en relation.": "Everything is ready for the match.",
  // "Transmis autrement" (ADR 0010 §4)
  "✓ Transmis par un autre canal": "✓ Sent through another channel",
  "Déjà transmis au notaire": "Already sent to the notary",

  // --- Mise en relation: the private optional phone ------------------------
  "Téléphone (optionnel)": "Telephone (optional)",
  "Pour la mise en relation avec le notaire qui vous retient. Jamais public.": "For the match with the notary who takes you on. Never public.",
  "Téléphone (mise en relation)": "Telephone (for the match)",

  // --- Partenaires (ADR 0011) ----------------------------------------------
  "Votre client a besoin d’un notaire ? Partagez votre lien Nota. Il choisit sa date et propose son prix. Vous recevez une récompense une fois l’acte signé.": "Does your client need a notary? Share your Nota link. They choose their date and propose their price. You receive a reward once the act is signed.",
  "Choisissez votre métier pour découvrir quand recommander Nota à vos clients.": "Choose your profession to see when to recommend Nota to your clients.",
  "Choisissez votre métier pour commencer.": "Choose your profession to get started.",
  "Entrez votre courriel professionnel. Votre code sera suggéré automatiquement.": "Enter your professional email. We will suggest your code automatically.",
  "Vérifiez votre adresse courriel pour recevoir le lien d’activation.": "Check your email address so you can receive the activation link.",
  "Choisissez un code valide pour créer votre lien Nota.": "Choose a valid code to create your Nota link.",
  "Tout est prêt. Un lien par courriel vous permettra d’activer votre code.": "You are ready. We will email you a link to activate your code.",
  "Recevoir mon lien d’activation →": "Get my activation link →",
  "Envoi du lien d’activation…": "Sending your activation link…",
  "Ouvrez le lien reçu par courriel pour activer votre code.": "Open the link in your email to activate your code.",
  "Lien envoyé à": "Link sent to",
  "Corriger mon courriel": "Correct my email",
  "Partenaires": "Partners",
  /* Refonte du 2026-09-12 : la page ne dit plus qu'une chose. */
  "Un code. Deux récompenses.": "One code. Two rewards.",
  "Partagez votre lien Nota. Vous êtes récompensé une fois l’acte signé.": "Share your Nota link. You are rewarded once the act is signed.",
  "Acquise quand la demande est retenue ; versée une fois l’acte signé.": "Earned when the request is taken on; paid once the act is signed.",
  "Sans frais. Une minute.": "No cost. One minute.",
  "Retrouvez votre code et un message à copier.": "Your code and a message to copy.",
  "Le bon moment : dès que la promesse d’achat est acceptée. Votre client doit trouver un notaire pour son financement avant la date de signature.": "The right moment: as soon as the offer to purchase is accepted. Your client must find a notary for their financing before the signing date.",
  "Le bon moment : à l’approbation du prêt. La date de signature est fixée et il manque encore le notaire — c’est là que le prix d’une date compte.": "The right moment: when the loan is approved. The signing date is set and the notary is still missing — that is when the price of a date matters.",
  "Comptables, planificateurs financiers, avocats, évaluateurs : le bon moment, c’est dès qu’un client parle de refinancer ou d’acheter.": "Accountants, financial planners, lawyers, appraisers: the right moment is the minute a client mentions refinancing or buying.",
  "Les récompenses": "The rewards",
  "Référez un client": "Refer a client",
  "Sans limite": "No limit",
  "Référez un notaire": "Refer a notary",
  "Une fois par notaire": "Once per notary",
  /* Ce qui est gratuit, dit là où on décide (propriétaire, 2026-09-12). */
  "Gratuit dans votre agenda. Des offres à consulter. Vous décidez.": "Free, in your calendar. Requests to review. You decide.",
  "Rien à refuser": "Nothing to decline",
  "Une offre qui ne vous convient pas, vous la laissez passer : aucun refus à écrire, aucune pénalité, aucune relance. Répondre — oui ou non — compte pour votre disponibilité ; ne rien faire ne vous retire rien.": "A request that does not suit you, you simply let pass: no refusal to write, no penalty, no follow-up. Answering — yes or no — counts toward your availability; doing nothing takes nothing away from you.",
  "Publier votre date et votre prix ne coûte rien. Plus la date est rapprochée, plus le prix de départ monte.": "Posting your date and your price costs nothing. The closer the date, the higher the starting price.",
  "Partagez votre lien": "Share your link",
  /* Le circuit du code (2026-09-12 soir) : les deux voies, mot pour mot. */
  "Comment votre code vous paie": "How your code pays you",
  "Vous partagez votre lien": "You share your link",
  "Ou vous donnez votre code": "Or you give out your code",
  "Code de référence": "Referral code",
  "Déjà rempli par le lien": "Already filled in by the link",
  "Tapé au moment de publier": "Typed when the offer is posted",
  "Vous recevez": "You receive",
  "Le client paie en plus": "The client pays extra",
  "Réclamez votre code": "Claim your code",
  "Votre code partenaire": "Your partner code",
  "Code souhaité": "Desired code",
  "Suggéré depuis votre courriel — modifiable. 4 à 12 lettres ou chiffres.": "Suggested from your email — editable. 4 to 12 letters or digits.",
  "Réclamer mon code →": "Claim my code →",
  "Réclamation…": "Claiming…",
  "Lien envoyé ✓": "Link sent ✓",
  "Ce code accompagne votre demande. Il ne change pas votre prix.": "This code accompanies your request. It does not change your price.",
  "Retirer le code": "Remove code",
  "Code réclamé ✓": "Code claimed ✓",
  "Code réclamé.": "Code claimed.",
  // Email verification of a partner code claim (ADR 0011 fraud-hardening).
  "Vérifiez votre courriel.": "Check your email.",
  "Nous avons envoyé un lien à usage unique pour confirmer votre code — il devient actif dès que vous l’ouvrez.": "We sent a single-use link to confirm your code — it becomes active as soon as you open it.",
  "Rien reçu ? Vérifiez vos indésirables — ou corrigez votre courriel et soumettez à nouveau.": "Nothing received? Check your junk folder — or fix your email and submit again.",
  "Trop de tentatives. Réessayez dans quelques minutes.": "Too many attempts. Try again in a few minutes.",
  "Lien invalide ou expiré. Redemandez un lien.": "Invalid or expired link. Request a new one.",
  /* ADR 0036 — le plafond de redemption du lien magique : quinze minutes, pas « quelques ». */
  "Trop de tentatives. Réessayez dans quinze minutes.": "Too many attempts. Try again in fifteen minutes.",
  "Partagez ce lien — chaque demande publiée par lui vous est attribuée :": "Share this link — every request posted through it is credited to you:",
  "Copier le lien": "Copy the link",
  "Partager": "Share",
  "Lien copié.": "Link copied.",
  "Copie impossible — sélectionnez le lien.": "Copy failed — select the link.",
  "Code invalide — entre 4 et 12 lettres ou chiffres.": "Invalid code — 4 to 12 letters or digits.",
  "Code de référence (optionnel)": "Referral code (optional)",
  "Un professionnel vous a référé ? Entrez son code. Privé, et sans effet sur votre prix.": "Referred by a professional? Enter their code. Private, and it never affects your price.",
  "Code non reconnu — vérifiez-le avec la personne qui vous a référé. Votre offre part quand même.": "Code not recognized — check it with the person who referred you. Your offer still goes through.",
  "Ce code est déjà pris — essayez une variante.": "This code is already taken — try a variant.",
  "Inscription impossible pour le moment. Réessayez.": "Sign-up impossible right now. Please try again.",
  "Courtier immobilier": "Real-estate broker",
  "Courtier hypothécaire": "Mortgage broker",
  "Autre professionnel": "Other professional",
  "Le prix du client n’y touche jamais.": "The client’s price is never touched.",
  "vous@agence.ca": "you@agency.ca",
  "EVEROY": "EVEROY",

  // --- Profil: the Parrainage card (claimed code resurfaced) ----------------
  "Parrainage": "Referrals",
  "Référez des clients ou des notaires et soyez récompensé.": "Refer clients or notaries and be rewarded.",
  "Les récompenses vous parviennent par courriel — rien à surveiller ici.": "Your rewards reach you by email — nothing to track here.",
  "Votre code": "Your code",
  "Devenir partenaire": "Become a partner",

  // --- Legal: partner program + private referral data (ADR 0011) ------------
  "Programme partenaires.": "Partner program.",
  "Téléphone.": "Telephone.",
  "Le numéro que vous fournissez (optionnel) est privé : il n’est partagé qu’avec le notaire qui retient votre demande, puis supprimé selon le même calendrier de 12 mois que le reste.": "The number you provide (optional) is private: it is shared only with the notary who takes on your request, then deleted on the same 12-month schedule as the rest.",
  "Code de partenaire.": "Partner code.",
  "Si vous arrivez par le lien d’un partenaire, son code est conservé en privé avec votre demande — jamais affiché publiquement — et sert uniquement à créditer ce partenaire.": "If you arrive through a partner’s link, their code is kept privately with your request — never displayed publicly — and is used only to credit that partner.",

  // --- Nous joindre (contact dialog) + cancel-offer flow ---------------------
  "Nous joindre": "Contact us",
  "À quoi vous attendre": "What to expect",
  "Réponse humaine": "A human reply",
  "Votre message arrive directement à l’équipe.": "Your message goes directly to the team.",
  "Suivi ici ou par courriel": "Follow-up here or by email",
  "La réponse peut aussi apparaître dans la messagerie.": "The reply may also appear in the chat.",
  "Pas de données sensibles": "No sensitive information",
  "N’envoyez ni numéro de carte ni document personnel.": "Do not send a card number or personal document.",
  "Nom": "Name",
  "(facultatif)": "(optional)",
  "(requis)": "(required)",
  "Utilisé seulement pour vous répondre.": "Used only so we can reply.",
  "Sujet": "Subject",
  "Question générale": "General question",
  "Aide avec une offre": "Help with an offer",
  "Question de notaire": "Notary question",
  "Problème technique": "Technical issue",
  "Autre": "Other",
  "Message": "Message",
  "Envoi…": "Sending…",
  "Ex. ce que vous essayez de faire et la page où vous êtes bloqué…": "E.g. what you are trying to do and the page where you are stuck…",
  "Décrivez le résultat souhaité ou le message affiché, sans renseignements personnels.": "Tell us the result you want or the message shown, without personal information.",
  "Envoyer": "Send",
  "Message envoyé.": "Message sent.",
  "Ou écrivez-nous directement :": "Or write to us directly:",
  "Impossible d’envoyer pour le moment. Réessayez, ou écrivez-nous par courriel.": "Unable to send right now. Try again, or write to us by email.",
  "Un courriel valide est requis pour vous répondre.": "A valid email is required so we can reply.",
  "Écrivez-nous quelques mots.": "Write us a few words.",
  "Besoin d’aide ?": "Need help?",
  "Obtenir de l’aide": "Get help",
  "Obtenir de l’aide sur cette demande": "Get help with this request",
  "Annuler cette offre ?": "Cancel this offer?",
  "Annuler cette offre": "Cancel this offer",
  "Votre offre sera retirée du carnet. Plus aucun notaire ne pourra la retenir.": "Your offer will be removed from the carnet. No notary will be able to take it anymore.",
  "Garder mon offre": "Keep my offer",
  "Annuler mon offre": "Cancel my offer",
  "Annulée": "Cancelled",
  "Vous avez annulé cette offre. Si vous changez d’avis, choisissez une nouvelle date au carnet.": "You cancelled this offer. If you change your mind, pick a new date on the carnet.",
  "Offre annulée. Elle a été retirée du carnet.": "Offer cancelled. It has been removed from the carnet.",
  "Cet acte est signé et réglé — il ne peut plus être annulé.": "This act is signed and settled — it can no longer be cancelled.",
  "Acte signé — évaluez votre notaire": "Act signed — rate your notary",
  "Un mot sur votre expérience (optionnel)": "A word about your experience (optional)",
  "Envoyer mon évaluation": "Send my evaluation",
  "Merci ! Votre évaluation est enregistrée.": "Thank you! Your evaluation is saved.",
  "Impossible d’enregistrer l’évaluation. Réessayez.": "Unable to save the evaluation. Please try again.",
  "Merci — elle est transmise à votre notaire. Elle n’est publiée nulle part.": "Thank you — it goes to your notary. It is published nowhere.",
  "Note de 1 à 5": "Rating from 1 to 5",
  "Votre moyenne, lisible par vous seul. Aucun client ne la voit.": "Your average, readable by you alone. No client sees it.",
  "Vos évaluations": "Your evaluations",
  "notes et commentaires des clients": "clients’ ratings and comments",
  "Vos évaluations, telles que les clients les ont laissées.": "Your evaluations, as clients left them.",
  "Vos évaluations s’afficheront ici après vos premiers actes signés.": "Your evaluations will appear here after your first signed acts.",
  "Impossible de charger vos évaluations. Réessayez.": "Unable to load your evaluations. Please try again.",
  "Impossible de charger vos évaluations (hors ligne). Réessayez.": "Unable to load your evaluations (offline). Please try again.",
  "Votre profil public": "Your public profile",
  "fiche CNQ, notoriété": "CNQ listing, notoriety",
  "Ajoutez le lien de votre fiche officielle à la Chambre des notaires du Québec (cnq.org). Les clients voient un badge « CNQ » sur vos propositions et peuvent consulter votre fiche une fois votre étude retenue.": "Add the link of your official listing at the Chambre des notaires du Québec (cnq.org). Clients see a “CNQ” badge on your propositions and can open your listing once your firm is retained.",
  "Votre fiche officielle (cnq.org)": "Your official listing (cnq.org)",
  "https://www.cnq.org/trouver-un-notaire/…": "https://www.cnq.org/trouver-un-notaire/…",
  "Enregistrer mon profil": "Save my profile",
  "✓ Profil enregistré.": "✓ Profile saved.",
  "Profil enregistré.": "Profile saved.",
  "Échec de l’enregistrement du profil.": "The profile could not be saved.",
  "Le lien doit être votre fiche officielle sur cnq.org (adresse https de la Chambre des notaires du Québec).": "The link must be your official listing on cnq.org (an https address at the Chambre des notaires du Québec).",
  "Aucun notaire disponible ?": "No notary available?",
  "Messagerie vocale": "Voicemail",
  "« On vous rappelle… »": "“We’ll call you back…”",
  "Complet ce mois-ci": "Fully booked this month",
  "Exemple · publié en 2 minutes, payé à la signature": "Example · posted in 2 minutes, paid at signing",
  "Votre prix, selon votre urgence.": "Your price, set by your urgency.",
  "Urgence": "Urgent",
  "Signature": "Signing",
  "ven. 12 sept.": "Fri., Sept. 12",
  "mar. 16 sept.": "Tue., Sept. 16",
  "enchère": "bid",
  "Plus c’est urgent, plus votre offre pèse — et passe devant.": "The more urgent it is, the more your offer weighs — and jumps the line.",
  "Un notaire accepte votre offre.": "A notary accepts your offer.",
  "Offre acceptée — 2 200 $": "Offer accepted — $2,200",
  "Mise en relation immédiate sur la plateforme.": "Connected immediately on the platform.",
  "Il peut accepter ou refuser — vous décidez.": "They can accept or decline — you decide.",
  "Messages · Documents · Suivi": "Messages · Documents · Tracking",
  "Complétez tout sur la plateforme.": "Complete everything on the platform.",
  "Bonjour ! Votre dossier est reçu — tout est en ordre.": "Hello! Your file is in — everything is in order.",
  "Parfait. On signe toujours vendredi ?": "Perfect. Are we still signing on Friday?",
  "nota.quebec · Publiez votre offre en 2 minutes": "nota.quebec · Publish your offer in 2 minutes",
  "Refinancement · Financement": "Refinancing · Financing",
  "Vous êtes notaire": "You are a notary",
  "Des trous dans votre semaine ?": "Holes in your week?",
  "Lun": "Mon",
  "Mar": "Tue",
  "Mer": "Wed",
  "Jeu": "Thu",
  "Ven": "Fri",
  "Sur Nota, la demande vous attend": "On Nota, demand is waiting for you",
  "Des clients affichent date et prix.": "Clients post date and price.",
  "Exemple — d’autres demandes s’affichent la même semaine": "Example — other requests appear the same week",
  "Acceptez en un clic.": "Accept in one click.",
  "Accepter — 2 200 $": "Accept — $2,200",
  "Demande retenue": "Request taken",
  "Payé à la signature — et votre part grandit avec votre cote": "Paid at signing — and your share grows with your cote",
  "Remplissez votre semaine.": "Fill your week.",
  "nota.quebec · Inscription gratuite pour les notaires": "nota.quebec · Free sign-up for notaries",
  "Je cherche un notaire": "I’m looking for a notary",
  "Je suis partenaire": "I’m a partner",
  "Créer et partager mon code": "Create and share my code",
  "Partager mon code": "Share my code",
    "Je suis notaire": "I’m a notary",
    "Voir comment ça marche": "See how it works",
    "Remplir ma semaine": "Fill my week",
    "Explorer le carnet →": "Explore the carnet →",
    "Entrer sur le site →": "Enter the site →",
  "Passer →": "Skip →",
  "Nota": "Nota",
  "Elle a été retirée du carnet.": "It has been removed from the carnet.",
  /* W3 — live support widget (ADR 0033 §5) + the notaire film’s compliance scene. */
  "On vous répond en général en quelques minutes pendant les heures d’ouverture.": "We usually answer within a few minutes during opening hours.",
  "Cette conversation est terminée — écrivez-nous à nouveau.": "This conversation has ended — write to us again.",
  "Vous": "You",
  "Visiteur": "Visitor",
  "(optionnel)": "(optional)",
  "pour recevoir la réponse par courriel si vous quittez": "to receive the answer by email if you leave",
  "Courriel du visiteur :": "Visitor’s email:",
  "Messagerie — 1 nouvelle réponse": "Chat — 1 new reply",
  "Conformité": "Compliance",
  "Nota respecte les règles de votre profession.": "Nota follows the rules of your profession.",
  "Art. 32.1 — Loi sur le notariat": "S. 32.1 — Notaries Act",
  "Aucune réduction promise, aucune part abandonnée : vous recevez 100 % du montant offert.": "No discount promised, no share given up: you receive 100% of the amount offered.",
  "Art. 32 et 29.1 — Code de déontologie": "Ss. 32 and 29.1 — Code of ethics",
  "Nota facture son propre prix au client, à côté : aucun partage d’honoraires, aucune convention sur vos honoraires.": "Nota bills the client its own price, separately: no fee sharing, no agreement over your fees.",
  "Art. 49 — Code de déontologie": "S. 49 — Code of ethics",
  "Vos honoraires restent les vôtres : vous acceptez le montant offert, proposez le vôtre, ou passez. Rien n’est retranché.": "Your fees stay yours: you accept the amount offered, propose your own, or pass. Nothing is taken off.",
  "Une décision de l’Ordre s’applique toujours en premier.": "A decision of the Chambre always comes first.",
  "Lire nos engagements déontologiques →": "Read our ethics commitments →",
  /* /W3 */
  /* W1 — the notary console: the mise en relation is complete (ADR 0033). */
  // The contact gate — banner over the feed, the profile's identity fields.
  "Complétez votre profil pour retenir une demande": "Complete your profile to take on a request",
  "Le client qui vous retient doit pouvoir vous joindre et trouver votre étude. Il manque :": "The client who takes you on must be able to reach you and find your office. Missing:",
  "Compléter mon profil": "Complete my profile",
  "identité, fiche CNQ, déplacement, urgences": "identity, CNQ listing, travel, urgencies",
  "Le client qui vous retient reçoit votre nom, votre téléphone, l’adresse de votre étude et votre courriel — c’est ainsi qu’il vous joint. Sans ces trois premiers, vous ne pouvez ni retenir ni proposer un prix.": "The client who takes you on receives your name, your phone, your office address and your email — that is how they reach you. Without the first three, you can neither take on a request nor propose a price.",
  "Votre nom": "Your name",
  "Me Prénom Nom": "Me First Last",
  "Votre étude": "Your office",
  "Étude Nom & Associés": "Name & Associates",
  "Votre téléphone": "Your phone",
  "L’adresse de votre étude": "Your office address",
  "123, rue Saint-Jean, Québec (QC) G1R 1N4": "123 Saint-Jean Street, Québec (QC) G1R 1N4",
  "Complétez votre profil (nom, téléphone, adresse de l’étude) avant de retenir une demande.": "Complete your profile (name, phone, office address) before taking on a request.",
  "Le numéro de téléphone n’est pas valide.": "The phone number is not valid.",
  "Le nom ne peut dépasser 120 caractères.": "The name cannot exceed 120 characters.",
  "Le nom de l’étude ne peut dépasser 120 caractères.": "The office name cannot exceed 120 characters.",
  "L’adresse ne peut dépasser 200 caractères.": "The address cannot exceed 200 characters.",
  // Alert preferences — server data, email only.
  "fréquence des courriels, urgences, prêteurs": "email frequency, urgencies, lenders",
  "Choisissez à quelle fréquence Nota vous prévient par courriel des nouvelles demandes qui vous conviennent. Modifiable à tout moment.": "Choose how often Nota emails you about new requests that suit you. Change it any time.",
  "Aucun courriel": "No email",
  "Échec de l’enregistrement des préférences.": "Saving the preferences failed.",
  // The Retenir sheet.
  "Retenir cette demande ?": "Take on this request?",
  "versés en entier à la signature": "paid in full at signing",
  "Le client paie à Nota, à côté": "The client pays Nota, separately",
  "Déplacement": "Travel",
  "Dossier": "File",
  "Il manque :": "Missing:",
  "Non précisé": "Not specified",
  "un prix publié, le même pour tous les notaires": "a published price, the same for every notary",
  "Si le client annule": "If the client cancels",
  "jours avant la signature": "days before signing",
  "gratuit": "free",
  "Ces frais vous sont versés en dédommagement.": "These fees are paid to you as compensation.",
  "Vous pouvez vous désister": "You may withdraw",
  "Gratuit, mais compté à votre dossier. Le client garde sa date et son offre.": "Free, but counted on your record. The client keeps their date and their offer.",
  "Une fois retenu, le client reçoit votre nom, téléphone, adresse et courriel ; vous recevez les siens ; vous vous parlez dans la conversation Nota.": "Once taken on, the client receives your name, phone, address and email; you receive theirs; you talk in the Nota conversation.",
  "Pas maintenant": "Not now",
  // The retained card: « Votre client », unread, withdrawal terms, the prune toast.
  "Votre client": "Your client",
  "Ni courriel ni téléphone transmis — écrivez-lui dans la conversation.": "No email or phone was provided — write to them in the conversation.",
  "nouveau": "new",
  "nouveaux": "new",
  "Se désister est gratuit, mais compté à votre dossier. Le client garde sa date et son offre.": "Withdrawing is free, but counted on your record. The client keeps their date and their offer.",
  "Le client a annulé la demande du": "The client cancelled the request of",
  /* /W1 */
  /* F2 */
  // Audit of the booking journey (2026-09-02): the notary's questions and the
  // client's checklist — new questions, conditional documents, the déplacement
  // bands as a willingness. Every string below is domain data (SERVICES,
  // DEPLACEMENT_QUI, LENDERS); the composed « label : option » lines are the
  // notary-card factors of the poids>0 options.
  "Un prêteur privé donne ses instructions à la main : plus de vérifications, d’où le supplément.": "A private lender gives its instructions by hand: more checks, hence the surcharge.",
  "Situation conjugale et résidence familiale": "Marital status and family residence",
  "Si vous êtes marié ou uni civilement et que l’immeuble est votre résidence familiale, votre conjoint doit intervenir à l’acte, même s’il n’emprunte pas.": "If you are married or in a civil union and the property is your family residence, your spouse must intervene in the deed, even if they are not borrowing.",
  "Ni marié ni uni civilement": "Neither married nor in a civil union",
  "Marié ou uni civilement — autre immeuble": "Married or in a civil union — another property",
  "Marié ou uni civilement — résidence familiale": "Married or in a civil union — family residence",
  "Situation conjugale et résidence familiale : Marié ou uni civilement — autre immeuble": "Marital status and family residence: Married or in a civil union — another property",
  "Situation conjugale et résidence familiale : Marié ou uni civilement — résidence familiale": "Marital status and family residence: Married or in a civil union — family residence",
  "Assurance titres": "Title insurance",
  "L’assurance titres remplace souvent un certificat périmé — demandez au notaire.": "Title insurance often replaces an expired certificate — ask the notary.",
  "Certificat de localisation : Assurance titres": "Certificate of location: Title insurance",
  "Preuve d’assurance habitation": "Proof of home insurance",
  "L’attestation de votre assureur ; le prêteur demande d’y être inscrit comme créancier hypothécaire.": "Your insurer’s certificate; the lender asks to be named on it as mortgagee.",
  "Promesse d’achat acceptée": "Accepted promise to purchase",
  "La promesse d’achat signée par le vendeur et vous, avec ses annexes.": "The promise to purchase signed by the seller and you, with its annexes.",
  "Testament et déclaration de transmission": "Will and declaration of transmission",
  "Le testament (ou la recherche testamentaire) et la déclaration de transmission, si elle a été publiée.": "The will (or the will search) and the declaration of transmission, if it has been published.",
  "Certificat périmé, absent ou remplacé par une assurance titres : rien à téléverser pour l’instant. Le notaire vous dira s’il en faut un nouveau et quand le commander.": "Certificate expired, missing or replaced by title insurance: nothing to upload for now. The notary will tell you whether a new one is needed and when to order it.",
  "Jusqu’où acceptez-vous de vous déplacer ?": "How far are you willing to travel?",
  "Jusqu’où le notaire doit-il se déplacer ?": "How far must the notary travel?",
  /* /F2 */
  /* F3 */
  // Audit 2026-09-02 — booking form mechanics & dossier UI (web-owned copy).
  "Où signez-vous\u00a0?": "Where will you sign?",
  "(elles ajustent le prix et le temps de préparation)": "(they adjust the price and the preparation time)",
  "Qui se déplace": "Who travels",
  "Jusqu’où acceptez-vous de vous déplacer ?": "How far are you willing to travel?",
  "Jusqu’où le notaire doit-il se déplacer ?": "How far must the notary travel?",
  "Je ne peux ni me déplacer ni recevoir le notaire — signature 100 % en ligne": "I can neither travel nor host the notary — 100% online signing",
  "Peu de notaires se déplacent jusqu’à": "Few notaries travel as far as",
  "Votre offre ne sera visible que pour eux.": "Your offer will be visible only to them.",
  "La signature 100 % en ligne n’est offerte que par les notaires qui l’acceptent.": "100% online signing is offered only by the notaries who accept it.",
  "Réponse requise": "Answer required",
  "Corriger": "Fix",
  "Le montant que le prêteur vous avance — pas la valeur de la propriété.": "The amount the lender advances you — not the property’s value.",
  "Vos réponses précédentes — vérifiez-les.": "Your previous answers — check them.",
  "Sans les instructions du prêteur en main, une signature dans moins de deux semaines est rarement tenable. Choisissez une date plus éloignée, ou confirmez l’approbation avant de publier.": "Without the lender’s instructions in hand, a signing in under two weeks is rarely workable. Pick a later date, or confirm the approval before publishing.",
  "Enregistrées dans votre profil et réutilisées pour vos prochaines offres. Le prix d’une offre déjà publiée ne change pas.": "Saved in your profile and reused for your next offers. The price of an offer already published does not change.",
  "Les 3 premiers caractères de votre code postal.": "The first 3 characters of your postal code.",
  "Joindre": "Attach",
  "Autre document": "Other document",
  /* /F3 */
  /* F7 */
  // Audit 2026-09-03 — notary console + « Mes offres » fixes (ADR 0033).
  "Vos honoraires restent les vôtres : vous acceptez le montant offert, proposez le vôtre, ou passez. Rien n’est retranché.": "Your fees remain yours: you accept the amount offered, propose your own, or pass. Nothing is deducted.",
  "Votre espace": "Your space",
  "Mes offres": "My offers",
  "Vos offres, la conversation avec votre notaire, votre dossier et vos coordonnées — tout ce que vous avez publié depuis Nota, au même endroit.": "Your offers, the conversation with your notary, your file and your contact details — everything you have posted through Nota, in one place.",
  "Le client paie à Nota, en plus de vos honoraires, séparément": "The client pays Nota, on top of your fees, separately",
  "Aucune caution vivante sur cette demande — une annulation serait sans frais.": "No live hold on this request — a cancellation would be free of charge.",
  "Gratuit ; l’équipe Nota en est avisée. Le client garde sa date et son offre.": "Free; the Nota team is told. The client keeps their date and their offer.",
  "Se désister est gratuit ; l’équipe Nota en est avisée. Le client garde sa date et son offre.": "Withdrawing is free; the Nota team is told. The client keeps their date and their offer.",
  "Si le client annule aujourd’hui :": "If the client cancels today:",
  "vous sont versés": "are paid to you",
  "jour avant la signature": "day before signing",
  "le jour de la signature": "on the signing day",
  "et": "and",
  "autre": "other",
  "autres": "others",
  "nouveau message": "new message",
  "nouveaux messages": "new messages",
  "nouveau document": "new document",
  "nouveaux documents": "new documents",
  "nouveautés": "new items",
  "Ce lien a expiré — le lien du courriel le plus récent ouvre votre demande.": "This link has expired — the link in the most recent email opens your request.",
  "Impossible de vérifier ce lien pour l’instant. Réessayez une fois en ligne.": "This link cannot be checked right now. Try again once online.",
  "Nom non communiqué — ce notaire n’a pas encore complété sa fiche.": "Name not provided — this notary has not completed their profile yet.",
  "Nota ne facture pas son service sur une demande annulée.": "Nota does not charge for its service on a cancelled request.",
  "sur cet appareil": "on this device",
  "✓ Prêteurs enregistrés sur cet appareil.": "✓ Lenders saved on this device.",
  "Confirmer l’acte signé": "Confirm the signed act",
  /* /F7 */
  /* F4 — public site audit 2026-09-02: legal panes, dialogs, partners, gate. */
  "Version 0.1 — brouillon, non révisé par un juriste · dernière mise à jour 2026-09-03": "Version 0.1 — draft, not reviewed by a lawyer · last updated 2026-09-03",
  "Une offre et son dossier sont conservés au plus 13 mois après la date de signature (400 jours), plus 35 jours de sauvegarde continue, puis supprimés automatiquement.": "An offer and its file are kept at most 13 months after the signing date (400 days), plus 35 days of continuous backup, then deleted automatically.",
  ". Nous traitons votre demande dans les meilleurs délais prévus par la Loi 25.": ". We handle your request within the time limits set by Law 25.",
  "Documents échangés.": "Exchanged documents.",
  "Quand vous envoyez un document par la messagerie au notaire qui a retenu votre demande, Nota en est le dépositaire, jamais le destinataire : le fichier est chiffré en transit et au repos, conservé au Canada (région ca-central-1) et lisible uniquement par vous et ce notaire. La console d’administration de Nota n’y donne aucun accès, chaque ouverture est journalisée ; aucune analyse, aucune indexation. Il est effacé avec l’offre, et dès qu’un notaire se désiste.": "When you send a document through the chat to the notary who took on your request, Nota is its custodian, never its recipient: the file is encrypted in transit and at rest, kept in Canada (ca-central-1 region) and readable only by you and that notary. Nota’s admin console has no access to it and every opening is logged; no analysis, no indexing. It is erased with the offer, and as soon as a notary withdraws.",
  "Le numéro que vous fournissez (optionnel) est privé : il n’est partagé qu’avec le notaire qui retient votre demande, puis supprimé selon le même calendrier que le reste.": "The number you provide (optional) is private: it is shared only with the notary who takes on your request, then deleted on the same schedule as the rest.",
  "Stockage local.": "Local storage.",
  "Vos coordonnées, vos réponses de dossier, vos préférences (langue, thème) et les liens de suivi de vos offres sont enregistrés dans le stockage local de votre navigateur, sur cet appareil seulement — aucun témoin publicitaire. Effacer les données du site dans votre navigateur les supprime. Nota compte par ailleurs, sans compte ni témoin, les grandes étapes franchies (visite, formulaire, publication) pour mesurer son parcours.": "Your contact details, your file answers, your preferences (language, theme) and the tracking links of your offers are saved in your browser’s local storage, on this device only — no advertising cookie. Clearing the site’s data in your browser removes them. Nota also counts, with no account and no cookie, the main steps taken (visit, form, publication) to measure its funnel.",
  "Un prix de départ clair par service et deux lignes annoncées d’avance : les honoraires du notaire — ce que vous offrez est ce qu’il reçoit — et le prix du service de Nota, publié d’avance. Aucun frais caché : les plafonds d’indemnité d’annulation sont publiés dans les": "A clear starting price per service and two lines announced up front: the notary’s fees — what you offer is what they receive — and Nota’s service price, published in advance. No hidden fees: the cancellation indemnity caps are published in the",
  "conditions d’utilisation": "terms of use",
  "et le montant exact vous est affiché avant toute confirmation.": "and the exact amount is shown to you before any confirmation.",
  "Votre nom sera visible sur le carnet public, à côté du service, du montant et de la date. Par exemple : « votre nom · refinancement · dans 4 jours ». C’est une information que vous rendez publique.": "Your name will be visible on the public carnet, next to the service, the amount and the date. For example: “your name · refinancing · in 4 days”. This is information you are making public.",
  "Première visite ou retour, c’est le même geste. Votre courriel est transmis à Nota pour le lien de suivi et les avis. Vos documents, quand vous en envoyez, transitent chiffrés et ne sont lus que par le notaire qui vous retient — jamais par Nota.": "First visit or return, it is the same gesture. Your email address is sent to Nota for the tracking link and notices. Your documents, when you send any, travel encrypted and are read only by the notary who takes you on — never by Nota.",
  "Publiez une demande et suivez vos offres. Votre courriel est transmis à Nota pour le lien de suivi et les avis. Vos documents, quand vous en envoyez, transitent chiffrés et ne sont lus que par le notaire qui vous retient — jamais par Nota.": "Post a request and follow your offers. Your email address is sent to Nota for the tracking link and notices. Your documents, when you send any, travel encrypted and are read only by the notary who takes you on — never by Nota.",
  "Pas de compte ni de mot de passe : ce courriel est enregistré sur cet appareil, comme identité. Votre courriel est transmis à Nota pour le lien de suivi et les avis. Vos documents, quand vous en envoyez, transitent chiffrés et ne sont lus que par le notaire qui vous retient — jamais par Nota.": "No account, no password: this email address is saved on this device as your identity. Your email address is sent to Nota for the tracking link and notices. Your documents, when you send any, travel encrypted and are read only by the notary who takes you on — never by Nota.",
  "Enregistrer votre courriel": "Save your email address",
  "Enregistrer mon courriel": "Save my email address",
  "ou vous propose un prix — vous restez libre. Vous payez ses honoraires — le montant que vous avez offert — et, séparément, le prix du service de Nota, publié d’avance ; les deux vous sont affichés avant tout paiement.": "or proposes a price — you stay free to choose. You pay their fees — the amount you offered — and, separately, Nota’s service price, published in advance; both are shown to you before any payment.",
  "Une question, un pépin, besoin d’un coup de main\u00a0? Écrivez-nous\u00a0: une personne de l’équipe vous répond à votre courriel. Si vous restez sur le site, la réponse arrive aussi ici, dans la messagerie.": "A question, a snag, need a hand? Write to us: someone from the team replies to your email. If you stay on the site, the answer also lands right here, in the messaging.",
  "Une personne de l’équipe vous répond à votre courriel. Si vous restez sur le site, la réponse arrive aussi dans la messagerie, en direct.": "Someone from the team replies to your email. If you stay on the site, the answer also lands in the messaging, live.",
"clients par mois": "clients per month",
"Si chaque demande est retenue par un notaire — une récompense fixe par client, sans plafond.": "If every request is retained by a notary — a flat reward per client, no cap.",
"Un message prêt à envoyer": "A message ready to send",
"à votre client, tel quel :": "to your client, as is:",
"Copier le message": "Copy the message",
"Copié ✓": "Copied ✓",
"Message copié.": "Message copied.",
"Copie impossible — sélectionnez le message.": "Could not copy — select the message.",
"Bonjour ! Pour votre refinancement ou votre financement hypothécaire, vous pouvez choisir votre date de signature et voir le prix avant de vous engager, sur Nota. Le notaire reçoit 100 % de votre offre et vous ne payez qu’à la signature. Voici le lien :": "Hello! For your mortgage refinancing or financing, you can pick your signing date and see the price before committing, on Nota. The notary receives 100 % of your offer and you only pay at signing. Here is the link:",
  "Réservé aux professionnels qui ne sont pas notaires : le Code de déontologie des notaires (art. 33) interdit à un notaire de verser ou de recevoir un tel avantage.": "Reserved for professionals who are not notaries: the notaries’ Code of ethics (s. 33) forbids a notary from paying or receiving such an advantage.",
  "Le lien expire rapidement : ouvrez-le dès sa réception.": "The link expires quickly: open it as soon as it arrives.",
  "Trop de tentatives. Réessayez plus tard.": "Too many attempts. Try again later.",
  "Messagerie": "Chat",
  "repère du mois": "month’s reference",

  /* === LA SALLE DE SIGNATURE — ADR 0047 ==================================
     L'annonce, la salle elle-même, et tout ce que le module public/salle.js
     compose à l'exécution. Les noms des étapes et le texte de conduite du
     notaire viennent du DOMAINE : ils sont ici parce qu'ils s'affichent, et
     apps/web/test/i18n.test.mjs les exige comme le reste du catalogue. */
  "Bêta · bientôt": "Beta · coming soon",
  "Signer avec votre notaire, à distance, sans quitter Nota": "Sign with your notary, remotely, without leaving Nota",
  "Un face-à-face vidéo chiffré de bout en bout : Nota ne peut pas le lire, et un relais fourni par Nota peut l’acheminer lorsque la connexion directe est impossible. Le notaire vous identifie, vous lit l’acte, répond à vos questions, puis libère la signature. Chaque instant de la séance entre dans un procès-verbal scellé dont vous repartez avec une copie.": "A video meeting encrypted end to end: Nota cannot read it, and a relay provided by Nota may carry it when a direct connection is impossible. The notary verifies your identity, reads you the act, answers your questions, then releases the signature. Every moment of the session enters a sealed record, and you leave with a copy of it.",
  "La signature juridique passe par le flux admis par la Chambre des notaires du Québec. Pendant la bêta, aucun acte réel n’est reçu dans la salle.": "The legal signature goes through the workflow admitted by the Chambre des notaires du Québec. During the beta, no real act is received in the room.",
  "Ouvrir la salle de démonstration": "Open the demonstration room",
  "La salle de signature": "The signing room",
  "Vous conduisez la séance : identité, lecture, questions, signature. Le lien vidéo est chiffré de bout en bout — Nota ne peut pas l’écouter, même lorsqu’un relais fourni par Nota l’achemine faute de connexion directe.": "You lead the session: identity, reading, questions, signature. The video link is encrypted end to end — Nota cannot listen in, even when a relay provided by Nota carries it for want of a direct connection.",
  "La séance produit un procès-verbal en chaîne d’empreintes : une heure déplacée, une entrée retirée, et l’empreinte finale ne concorde plus. Vous en repartez avec une copie ; Nota garde la même empreinte dans un journal qu’il ne peut pas réécrire.": "The session produces a hash-chained record: move one timestamp, remove one entry, and the final fingerprint no longer matches. You leave with a copy; Nota keeps the same fingerprint in a log it cannot rewrite.",
  "La signature juridique et la minute passent par le flux admis par la Chambre des notaires du Québec. Pendant la bêta, aucun acte réel ne peut être reçu dans la salle.": "The legal signature and the minute go through the workflow admitted by the Chambre des notaires du Québec. During the beta, no real act can be received in the room.",
  "Ouvrir une séance de démonstration": "Open a demonstration session",

  "Bêta — démonstration.": "Beta — demonstration.",
  "Aucun acte notarié n’est reçu dans cette salle. La signature juridique passe par le flux admis par la Chambre des notaires du Québec.": "No notarial act is received in this room. The legal signature goes through the workflow admitted by the Chambre des notaires du Québec.",
  "Salle de signature": "Signing room",
  "L’autre partie": "The other party",
  "Votre caméra": "Your camera",
  "Conduite de la séance": "Leading the session",
  "Lisez cette chaîne à voix haute": "Read this string aloud",
  "Si les deux écrans n’affichent pas la même chaîne, arrêtez la séance.": "If the two screens do not show the same string, stop the session.",
  "Ce qui doit être établi": "What must be established",
  "Quitter la séance": "Leave the session",

  /* Les quatre portes (domain.SALLE_PORTE_LABELS). */
  "Comptes authentifiés": "Authenticated accounts",
  "Identité vérifiée": "Identity verified",
  "Lien privé confirmé": "Private link confirmed",
  "Présence continue": "Continuous presence",

  /* Les huit étapes et leur conduite (domain.CEREMONIE_ETAPES). */
  "Accueil": "Welcome",
  "Je me nomme, je nomme mon étude, et je nomme l’acte que nous allons recevoir aujourd’hui. Je confirme que vous me voyez et que vous m’entendez.": "I state my name, my firm, and the act we are about to receive today. I confirm that you can see and hear me.",
  "Les deux parties se voient et s’entendent.": "Both parties can see and hear each other.",
  "Vérification de l’identité": "Identity check",
  "Je vérifie votre identité et je note la méthode employée. Cette vérification ne se fait pas par la fenêtre vidéo seule.": "I verify your identity and record the method used. This verification is not done through the video window alone.",
  "Une attestation d’identité est au dossier, avec sa méthode et son heure.": "An identity attestation is on file, with its method and its time.",
  "Confirmation du lien privé": "Private link confirmation",
  "Nous lisons chacun à voix haute la chaîne affichée à l’écran. Si elles concordent, personne ne s’est interposé entre nous.": "We each read aloud the string shown on screen. If they match, no one has come between us.",
  "Les deux chaînes concordent et le notaire l’a confirmé.": "Both strings match and the notary has confirmed it.",
  "Portée et consentement": "Scope and consent",
  "Je vous explique ce qui est consigné, ce qui est enregistré et ce qui ne l’est pas, puis je recueille votre accord.": "I explain what is recorded in the register, what is being filmed and what is not, then I collect your consent.",
  "Les deux parties ont répondu, et leur réponse est horodatée.": "Both parties have answered, and their answer is timestamped.",
  "Lecture de l’acte": "Reading of the act",
  "Je vous lis l’acte et les obligations qui s’y rattachent.": "I read you the act and the obligations attached to it.",
  "La lecture est faite en entier, sans interruption du lien.": "The reading is done in full, with no interruption of the link.",
  "Questions": "Questions",
  "Je réponds à vos questions avant que vous signiez quoi que ce soit.": "I answer your questions before you sign anything.",
  "La partie n’a plus de question.": "The party has no further questions.",
  "Signature": "Signing",
  "Je libère la signature vers le flux admis par la Chambre des notaires. C’est là, et non ici, que l’acte prend sa forme définitive.": "I release the signature to the workflow admitted by the Chambre des notaires. It is there, not here, that the act takes its final form.",
  "Les quatre portes sont ouvertes et la signature est libérée.": "The four gates are open and the signature is released.",
  "Clôture": "Closing",
  "Je scelle le procès-verbal de la séance et je vous en remets l’empreinte.": "I seal the record of the session and hand you its fingerprint.",
  "Le procès-verbal est scellé et son empreinte est publiée.": "The record is sealed and its fingerprint is published.",

  /* Les modes de séance (domain.SALLE_MODES). */
  "Bout en bout, sans enregistrement": "End-to-end, no recording",
  /* Le mode « strict » ne promet plus un canal à deux : quand la connexion
     directe est impossible, un relais fourni par Nota achemine les paquets
     sans pouvoir les ouvrir. La phrase dit désormais les trois choses. */
  "Le lien vidéo est chiffré de bout en bout : Nota ne peut pas le lire, et un relais fourni par Nota peut l’acheminer lorsque la connexion directe est impossible. Rien n’est enregistré : la preuve de la séance est le procès-verbal scellé.": "The video link is encrypted end to end: Nota cannot read it, and a relay provided by Nota may carry it when a direct connection is impossible. Nothing is recorded: the proof of the session is the sealed record.",
  "Bout en bout, avec enregistrement chiffré": "End-to-end, with encrypted recording",
  "La séance est enregistrée dans le navigateur du notaire et chiffrée avant d’être déposée. Nota conserve les octets sans pouvoir les lire. Exige l’accord des deux parties.": "The session is recorded in the notary’s browser and encrypted before being stored. Nota keeps the bytes without being able to read them. Requires both parties’ consent.",
  "Répétition, sans valeur": "Rehearsal, no legal value",
  "Pour se pratiquer. Une séance en répétition ne peut pas atteindre l’étape de la signature.": "For practice. A rehearsal session cannot reach the signature step.",

  /* Les méthodes de vérification d'identité (domain.IDENTITE_METHODES). */
  "Pièce d’identité officielle présentée au notaire": "Official identity document shown to the notary",
  "Vérification par un fournisseur externe": "Verification by an external provider",
  "Connaissance personnelle du notaire": "Notary’s personal knowledge",
  "Attestation de démonstration — sans valeur": "Demonstration attestation — no legal value",

  /* Ce que la salle compose à l'exécution (public/salle.js). */
  "Connexion en cours…": "Connecting…",
  "Séance suspendue — le lien a été interrompu. La signature est impossible tant qu’elle n’a pas repris.": "Session suspended — the link was interrupted. The signature is impossible until it resumes.",
  "Enregistrement en cours, avec l’accord des deux parties.": "Recording in progress, with both parties’ consent.",
  "Aucun enregistrement. La preuve de la séance est le procès-verbal scellé.": "No recording. The proof of the session is the sealed record.",
  "Procès-verbal scellé. Empreinte :": "Record sealed. Fingerprint:",
  "J’accepte l’enregistrement et le procès-verbal": "I consent to the recording and the record",
  "J’accepte le procès-verbal": "I consent to the record",
  "Retirer mon accord": "Withdraw my consent",
  "Attester l’identité — notaire": "Attest identity — notary",
  "Attester l’identité — client": "Attest identity — client",
  /* La confirmation anti-interception : le SEUL geste qui ouvre la porte du
     lien, et il restait en français sur un écran anglais. */
  "Les deux chaînes concordent": "Both strings match",
  "Reprendre la séance": "Resume the session",
  "Libérer la signature": "Release the signature",
  "Sceller le procès-verbal": "Seal the record",
  /* Les libellés composés du rail : une entrée par étape atteignable, plutôt
     qu'une règle — une règle ne traduirait pas le nom qu'elle capture. */
  "Passer à « Vérification de l’identité »": "Move to “Identity check”",
  "Passer à « Confirmation du lien privé »": "Move to “Private link confirmation”",
  "Passer à « Portée et consentement »": "Move to “Scope and consent”",
  "Passer à « Lecture de l’acte »": "Move to “Reading of the act”",
  "Passer à « Questions »": "Move to “Questions”",
  "Passer à « Clôture »": "Move to “Closing”",
  "Revenir à « Accueil »": "Back to “Welcome”",
  "Revenir à « Vérification de l’identité »": "Back to “Identity check”",
  "Revenir à « Confirmation du lien privé »": "Back to “Private link confirmation”",
  "Revenir à « Portée et consentement »": "Back to “Scope and consent”",
  "Revenir à « Lecture de l’acte »": "Back to “Reading of the act”",
  "Revenir à « Questions »": "Back to “Questions”",
  "Revenir à « Signature »": "Back to “Signature”",

  /* Le matériel qui manque, et les deux portes d'entrée qui expliquent. */
  "Vous avez refusé l’accès à la caméra ou au micro. Le notaire doit vous voir et vous entendre : sans cela, la séance ne peut pas commencer.": "You declined access to the camera or the microphone. The notary must be able to see and hear you: without that, the session cannot begin.",
  "Aucune caméra ou aucun micro n’a été trouvé sur cet appareil.": "No camera or microphone was found on this device.",
  "Ce navigateur ne sait pas établir de lien vidéo chiffré. Essayez un navigateur à jour.": "This browser cannot establish an encrypted video link. Try an up-to-date browser.",
  "La caméra n’est accessible que sur une connexion sécurisée (https).": "The camera is only available over a secure connection (https).",
  "La séance n’a pas pu s’ouvrir. Vérifiez votre connexion et réessayez.": "The session could not open. Check your connection and try again.",
  "La salle de signature n’est pas disponible dans ce navigateur.": "The signing room is not available in this browser.",
  "La salle s’ouvre sur un acte qu’un notaire a retenu. Publiez votre demande et attendez qu’un notaire la prenne — vous recevrez alors l’invitation à la séance.": "The room opens on an act a notary has taken on. Post your request and wait for a notary to take it — you will then receive the invitation to the session.",
  "Connectez-vous à votre espace notaire pour ouvrir une séance.": "Sign in to your notary space to open a session.",
  "La salle s’ouvre sur un acte que vous avez retenu. Retenez une demande du carnet, puis revenez ici.": "The room opens on an act you have taken on. Take a request from the carnet, then come back here.",

  /* Les refus que le serveur renvoie et que la salle recopie tels quels. */
  "Aucune séance n’est ouverte pour cet acte.": "No session is open for this act.",
  "La séance a changé pendant l’envoi. Réessayez.": "The session changed while sending. Try again.",
  "La chaîne confirmée ne correspond pas au lien courant. Relisez-la.": "The confirmed string does not match the current link. Read it again.",
  "La séance n’est pas suspendue.": "The session is not suspended.",
  "Le lien n’est pas rétabli : la séance ne peut pas reprendre.": "The link is not restored: the session cannot resume.",
  "Cette séance est déjà scellée.": "This session is already sealed.",
  "Une séance se scelle après la signature, pas avant.": "A session is sealed after the signature, not before.",
  "Seul le notaire conduit la séance.": "Only the notary leads the session.",
  "Seul le notaire qui a retenu l’acte entre dans sa séance.": "Only the notary who took on the act enters its session.",
  "Une séance de signature s’ouvre sur un acte retenu par un notaire.": "A signing session opens on an act taken on by a notary.",
  "Aucun acte réel ne peut être signé tant que le fournisseur admis par la Chambre n’est pas configuré.": "No real act can be signed until the provider admitted by the Chambre is configured.",
  "Une répétition ne peut pas atteindre la signature.": "A rehearsal cannot reach the signature.",
  "Les deux parties doivent avoir donné leur accord avant la signature.": "Both parties must have given their consent before the signature.",
  "Un consentement a été retiré. La signature ne peut pas être libérée.": "A consent was withdrawn. The signature cannot be released.",
  "Le notaire n’a pas encore confirmé que les deux chaînes concordent.": "The notary has not yet confirmed that the two strings match.",
  "Le lien chiffré n’est pas encore établi entre les deux navigateurs.": "The encrypted link is not yet established between the two browsers.",
  "Le lien chiffré a changé depuis la confirmation. Relisez les chaînes.": "The encrypted link changed since the confirmation. Read the strings again.",
  /* Ce que la porte de présence dit quand le pair d'en face n'est plus là. La
     caméra de celui qui lit l'écran n'y est pour rien : le domaine nomme
     désormais le silence de l'autre, et l'anglais doit le nommer aussi. */
  "Le client a quitté la séance ou a perdu sa connexion.": "The client has left the session or lost their connection.",
  "Le notaire a quitté la séance ou a perdu sa connexion.": "The notary has left the session or lost their connection.",
  "Le lien vidéo entre les deux navigateurs est perdu. Aucune des deux parties ne reçoit plus l’autre.": "The video link between the two browsers is lost. Neither party is receiving the other any more.",
  "La caméra du notaire n’envoie plus d’image.": "The notary’s camera is no longer sending video.",
  "La caméra du client n’envoie plus d’image.": "The client’s camera is no longer sending video.",
  "Le micro du notaire n’envoie plus de son.": "The notary’s microphone is no longer sending audio.",
  "Le micro du client n’envoie plus de son.": "The client’s microphone is no longer sending audio.",
  /* La porte d'identité nomme les parties qui manquent : trois assemblages
     possibles, trois entrées — une règle traduirait le cadre et laisserait les
     noms en français. */
  "L’identité n’est pas encore vérifiée pour : notaire.": "Identity is not yet verified for: notary.",
  "L’identité n’est pas encore vérifiée pour : client.": "Identity is not yet verified for: client.",
  "L’identité n’est pas encore vérifiée pour : notaire, client.": "Identity is not yet verified for: notary, client.",
  "Le notaire n’est pas encore authentifié.": "The notary is not yet authenticated.",
  "Le client n’est pas encore authentifié.": "The client is not yet authenticated.",
  "Aucune des deux parties n’est encore authentifiée.": "Neither party is authenticated yet.",
  "Signature de démonstration. Aucun acte notarié n’a été reçu et aucune minute n’a été créée.": "Demonstration signature. No notarial act was received and no minute was created.",
  /* /F4 */
};
  var HTML = {
  "Publier une offre est gratuit, et le reste. Sur un acte complété, vous payez deux choses : <strong>les honoraires du notaire</strong> — le montant que vous avez offert, qui lui revient en entier — et <strong>le prix du service de Nota</strong>, publié d’avance : il dépend du service demandé et du délai avant la signature, jamais du notaire ni du montant que vous offrez. Les deux vous sont affichés avant que votre carte ne soit autorisée.": "Posting an offer is free, and stays free. On a completed act you pay two things: <strong>the notary’s fees</strong> — the amount you offered, which comes to them in full — and <strong>Nota’s service price</strong>, published in advance: it depends on the service requested and on the notice before signing, never on the notary nor on the amount you offer. Both are shown to you before your card is authorized.",
  "<strong>Le prix, en deux lignes.</strong> Le montant que vous offrez est celui des <strong>honoraires du notaire</strong> : il lui revient en entier, Nota n’en prélève rien. Le <strong>prix du service de Nota</strong> s’ajoute au vôtre. Il est publié d’avance et dépend de deux choses que vous choisissez — le service demandé et le délai avant la signature — jamais du notaire, de sa cote ni du montant que vous offrez. Il vous est affiché avant l’autorisation de votre carte, et c’est celui-là qui vous est facturé. <strong>Les taxes et les débours</strong> — droits de publication, RDPRM — <strong>ne sont pas compris</strong> dans ces montants.": "<strong>The price, in two lines.</strong> The amount you offer is the <strong>notary’s fees</strong>: it comes to them in full, Nota takes none of it. <strong>Nota’s service price</strong> is added to yours. It is published in advance and depends on two things you choose — the service requested and the notice before signing — never on the notary, their cote, or the amount you offer. It is shown to you before your card is authorized, and that is the one you are charged. <strong>Taxes and disbursements</strong> — registration fees, RDPRM — <strong>are not included</strong> in these amounts.",
  "Connectez un compte de paiement sécurisé (Stripe) pour recevoir vos versements. À la signature, <strong>vos honoraires vous sont virés en entier</strong>. Nota facture son service au client, séparément — rien n’est jamais retranché de vos honoraires. Jamais de frais fixes.": "Connect a secure payment account (Stripe) to receive your payouts. At signing, <strong>your fees are wired to you in full</strong>. Nota charges the client for its service, separately — nothing is ever deducted from your fees. Never any fixed fees.",
  "<span class=\"nc-soon-tag\">Bientôt</span>Vérification d’identité, inscription et <strong>réalisation complète de l’acte en ligne</strong> : recevez la demande, rencontrez le client et signez à distance. Tout le parcours notaire, de bout en bout, sans quitter Nota.": "<span class=\"nc-soon-tag\">Coming soon</span>Identity verification, onboarding and <strong>completing the entire act online</strong>: receive the request, meet the client and sign remotely. The whole notary journey, end to end, without leaving Nota.",
  "Au repos, vos données sont conservées sur des serveurs canadiens (Amazon Web Services, région <strong>ca-central-1</strong>, Montréal). En transit, elles passent par un réseau de diffusion dont les points de présence sont aussi aux États-Unis et en Europe, et par un prestataire tiers : Stripe pour le paiement. Les polices de caractères sont servies par Nota — aucune requête ne part vers un tiers avant que vous y consentiez.": "At rest, your data is stored on Canadian servers (Amazon Web Services, <strong>ca-central-1</strong> region, Montréal). In transit it passes through a content delivery network whose edge locations are also in the United States and Europe, and through one third-party provider: Stripe for payment. The typefaces are served by Nota itself — no request leaves for a third party before you consent to it.",
  "<strong>Conservation.</strong> Une offre et son dossier sont conservés au plus <strong>12 mois</strong> après la date de signature, puis supprimés automatiquement. Le courriel de notification est effacé dès que l’offre est close ou expirée.": "<strong>Retention.</strong> An offer and its file are kept at most <strong>12 months</strong> after the signing date, then deleted automatically. The notification email is erased as soon as the offer is closed or expired.",
  "Les réponses de votre <strong>Dossier</strong> accompagnent l’offre. Les documents ne sont partagés qu’après qu’un notaire a retenu votre demande.": "The answers in your <strong>File</strong> travel with the offer. Documents are only shared after a notary has taken on your request.",
  "<span class=\"nc-soon-tag\">Bientôt</span>Les notaires pourront réaliser l’acte <strong>entièrement en ligne</strong> sur Nota, signature à distance comprise, sans déplacement. Aujourd’hui, vous convenez du lieu avec le notaire qui vous retient.": "<span class=\"nc-soon-tag\">Coming soon</span>Notaries will soon complete the act <strong>entirely online</strong> on Nota, remote signing included, no travel needed. For now, you agree on the location with the notary who takes you on."
};
  var RULES = compileRules([
  // ADR 0052 §A — la promesse d'urgence est composée à l'exécution (deux
  // montants du domaine et le délai du palier) : une règle traduit le cadre et
  // laisse passer les trois segments, que moneyEn finit ensuite.
  {
    "pattern": "^Le m\u00eame acte : (.+?) d\u2019honoraires \u00e0 d\u00e9lai normal, (.+?) \u00e0 ([0-9]+) jours d\u2019avis\\.$",
    "flags": "",
    "replacement": "The same act: $1 in fees at standard notice, $2 at $3 days\u2019 notice."
  },
  {
    "pattern": "^La connexion avec (.+) arrive bient\u00f4t\\. D\u2019ici l\u00e0, votre courriel suffit\\.$",
    "flags": "",
    "replacement": "Signing in with $1 is coming soon. Until then, your email is enough."
  },
  // ADR 0041 — les phrases de l'indemnité COMPOSÉES avec leur cadre : le toast
  // (« Offre annulée. … ») et le reçu (« Vous avez annulé cette offre. … Si vous
  // changez d’avis… »). Une règle ne traduit pas ce qu'elle capture : chaque
  // assemblage a la sienne.
  {
    "pattern": "^Offre annulée\\. Votre notaire peut réclamer, sur justification et dans les ([0-9]+) jours, une indemnité allant jusqu’à (.+?) \\((.+?) du montant convenu\\)\\. Rien n’est retenu pour l’instant\\.$",
    "flags": "",
    "replacement": "Offer cancelled. Your notary may claim, with a written reason and within $1 days, an indemnity of up to $2 ($3 of the agreed amount). Nothing is kept for now."
  },
  {
    "pattern": "^Vous avez annulé cette offre\\. Votre notaire peut réclamer, sur justification et dans les ([0-9]+) jours, une indemnité allant jusqu’à (.+?) \\((.+?) du montant convenu\\)\\. Rien n’est retenu pour l’instant\\. Si vous changez d’avis, choisissez une nouvelle date au carnet\\.$",
    "flags": "",
    "replacement": "You cancelled this offer. Your notary may claim, with a written reason and within $1 days, an indemnity of up to $2 ($3 of the agreed amount). Nothing is kept for now. If you change your mind, pick a new date on the carnet."
  },
  {
    "pattern": "^Vous avez annulé cette offre\\. Une indemnité de (.+?), justifiée par le notaire, a été retenue sur la somme réservée pour cet acte et lui est versée en dédommagement\\. Si vous changez d’avis, choisissez une nouvelle date au carnet\\.$",
    "flags": "",
    "replacement": "You cancelled this offer. A $1 indemnity, justified by the notary, was kept from the amount held for this act and is paid to them as compensation. If you change your mind, pick a new date on the carnet."
  },
  {
    "pattern": "^Vous avez annulé cette offre\\. Une indemnité de (.+?), justifiée par le notaire, a été portée à la carte que vous avez enregistrée et lui est versée en dédommagement\\. Si vous changez d’avis, choisissez une nouvelle date au carnet\\.$",
    "flags": "",
    "replacement": "You cancelled this offer. A $1 indemnity, justified by the notary, was charged to the card you registered and is paid to them as compensation. If you change your mind, pick a new date on the carnet."
  },
  {
    "pattern": "^Vous avez annulé cette offre\\. Votre notaire a réclamé une indemnité de (.+?), mais votre carte a refusé le prélèvement : rien n’a été débité\\. Si vous changez d’avis, choisissez une nouvelle date au carnet\\.$",
    "flags": "",
    "replacement": "You cancelled this offer. Your notary claimed a $1 indemnity, but your card declined the charge: nothing was charged. If you change your mind, pick a new date on the carnet."
  },
  {
    "pattern": "^Vous avez annulé cette offre\\. Votre notaire n’a réclamé aucune indemnité : rien n’est retenu\\. Si vous changez d’avis, choisissez une nouvelle date au carnet\\.$",
    "flags": "",
    "replacement": "You cancelled this offer. Your notary claimed no indemnity: nothing is kept. If you change your mind, pick a new date on the carnet."
  },
  {
    "pattern": "^Vous avez annulé cette offre\\. Aucune indemnité n’a été réclamée dans le délai : rien n’est retenu\\. Si vous changez d’avis, choisissez une nouvelle date au carnet\\.$",
    "flags": "",
    "replacement": "You cancelled this offer. No indemnity was claimed within the period: nothing is kept. If you change your mind, pick a new date on the carnet."
  },
  // ADR 0041 — les phrases composées de l'indemnité de résiliation : le délai
  // (jours), le plafond (montant) et le taux traversent la règle.
  {
    "pattern": "^Votre notaire peut réclamer, sur justification et dans les ([0-9]+) jours, une indemnité allant jusqu’à (.+?) \\((.+?) du montant convenu\\)\\. Rien n’est retenu pour l’instant\\.$",
    "flags": "",
    "replacement": "Your notary may claim, with a written reason and within $1 days, an indemnity of up to $2 ($3 of the agreed amount). Nothing is kept for now."
  },
  {
    "pattern": "^Votre notaire a réclamé une indemnité de (.+?), mais votre carte a refusé le prélèvement : rien n’a été débité\\.$",
    "flags": "",
    "replacement": "Your notary claimed a $1 indemnity, but your card declined the charge: nothing was charged."
  },
  {
    "pattern": "^Une indemnité de (.+?), justifiée par le notaire, a été portée à la carte que vous avez enregistrée et lui est versée en dédommagement\\.$",
    "flags": "",
    "replacement": "A $1 indemnity, justified by the notary, was charged to the card you registered and is paid to them as compensation."
  },
  {
    "pattern": "^Une indemnité de (.+?), justifiée par le notaire, a été retenue sur la somme réservée pour cet acte et lui est versée en dédommagement\\.$",
    "flags": "",
    "replacement": "A $1 indemnity, justified by the notary, was kept from the amount held for this act and is paid to them as compensation."
  },
  {
    "pattern": "^Annuler maintenant permet au notaire de réclamer, sur justification et dans les ([0-9]+) jours, ses frais réels et la valeur du travail accompli, jusqu’à (.+?) \\((.+?) du montant convenu\\)\\.$",
    "flags": "",
    "replacement": "Cancelling now lets the notary claim, with a written reason and within $1 days, their real costs and the value of work done, up to $2 ($3 of the agreed amount)."
  },
  {
    "pattern": "^Ensuite, sur justification et dans les ([0-9]+) jours, le notaire peut réclamer ses frais réels et la valeur du travail accompli, jusqu’à :$",
    "flags": "",
    "replacement": "Then, with a written reason and within $1 days, the notary may claim their real costs and the value of work done, up to:"
  },
  {
    "pattern": "^(.+?) du montant à ([0-9]+) jours ou moins de la signature$",
    "flags": "",
    "replacement": "$1 of the amount at $2 days or less before the signing"
  },
  {
    "pattern": "^(.+?) du montant de ([0-9]+) à ([0-9]+) jours$",
    "flags": "",
    "replacement": "$1 of the amount from $2 to $3 days"
  },
  {
    "pattern": "^Indemnité réclamée : (.+?)\\.$",
    "flags": "",
    "replacement": "Indemnity claimed: $1."
  },
  {
    // ADR 0034 — le prix est une grille : le héros annonce un PLANCHER. La
    // règle est plus spécifique que la suivante et doit donc passer avant,
    // sans quoi « à partir de » resterait en français dans la phrase anglaise.
    "pattern": "^Le notaire reçoit 100 % de votre offre\\. Le service Nota, à partir de (.+), se paie seulement à la signature\\.$",
    "flags": "",
    "replacement": "The notary receives 100% of your offer. Nota’s service, from $1, is paid only at signing."
  },
  {
    "pattern": "^Le notaire reçoit 100 % de votre offre\\. Le service Nota, (.+), se paie seulement à la signature\\.$",
    "flags": "",
    "replacement": "The notary receives 100% of your offer. Nota’s service, $1, is paid only at signing."
  },
  {
    "pattern": "^Nous vous écrivons à (\\S+) dès qu’un notaire la retient\\.$",
    "flags": "",
    "replacement": "We email $1 the moment a notary takes it on."
  },
  {
    "pattern": "^le ([A-Za-z][A-Za-z.]* [0-9]{1,2})$",
    "flags": "",
    "replacement": "on $1"
  },
  {
    "pattern": "^Réglé hors plateforme — (.+) de service Nota à percevoir$",
    "flags": "",
    "replacement": "Settled off the platform — $1 of Nota service still owed"
  },
  {
    "pattern": "^1 acte signé via Nota$",
    "flags": "",
    "replacement": "1 act signed through Nota"
  },
  {
    "pattern": "^([0-9]+) actes signés via Nota$",
    "flags": "",
    "replacement": "$1 acts signed through Nota"
  },
  {
    "pattern": "^Cote ([0-9]+) sur 100$",
    "flags": "",
    "replacement": "Score $1 out of 100"
  },
  {
    "pattern": "^([0-9]+),([0-9]) / ([0-9]+)$",
    "flags": "",
    "replacement": "$1.$2 / $3"
  },
  {
    "pattern": "^1 acte$",
    "flags": "",
    "replacement": "1 act"
  },
  {
    "pattern": "^([0-9]+) actes$",
    "flags": "",
    "replacement": "$1 acts"
  },
  {
    "pattern": "^([01]) acte porté$",
    "flags": "",
    "replacement": "$1 act carried"
  },
  {
    "pattern": "^([0-9]+) actes portés$",
    "flags": "",
    "replacement": "$1 acts carried"
  },
  {
    "pattern": "^Cible ([0-9]+) actes$",
    "flags": "",
    "replacement": "Target $1 acts"
  },
  {
    "pattern": "^Cible ([0-9]+(?:,[0-9])?) sur 5$",
    "flags": "",
    "replacement": "Target $1 out of 5"
  },
  {
    "pattern": "^Note pondérée ([0-9]+(?:,[0-9])?) sur 5$",
    "flags": "",
    "replacement": "Weighted rating $1 out of 5"
  },
  {
    "pattern": "^([0-9]+) avis$",
    "flags": "",
    "replacement": "$1 reviews"
  },
  {
    "pattern": "^([0-9]+) service rendu sur ([0-9]+)$",
    "flags": "",
    "replacement": "$1 of $2 services delivered"
  },
  {
    "pattern": "^([0-9]+) services rendus sur ([0-9]+)$",
    "flags": "",
    "replacement": "$1 of $2 services delivered"
  },
  {
    "pattern": "^Aucune réponse donnée sur ([0-9]+) visées$",
    "flags": "",
    "replacement": "No answer given yet, out of $1 aimed for"
  },
  {
    "pattern": "^1 réponse donnée sur ([0-9]+) visées$",
    "flags": "",
    "replacement": "1 answer given out of $1 aimed for"
  },
  {
    "pattern": "^([0-9]+) réponses données sur ([0-9]+) visées$",
    "flags": "",
    "replacement": "$1 answers given out of $2 aimed for"
  },
  {
    "pattern": "^1 proposition ou acceptation$",
    "flags": "",
    "replacement": "1 proposal or acceptance"
  },
  {
    "pattern": "^([0-9]+) propositions ou acceptations$",
    "flags": "",
    "replacement": "$1 proposals or acceptances"
  },
  {
    "pattern": "^1 déclin$",
    "flags": "",
    "replacement": "1 decline"
  },
  {
    "pattern": "^([0-9]+) déclins$",
    "flags": "",
    "replacement": "$1 declines"
  },
  {
    "pattern": "^Rayon ([0-9]+) km$",
    "flags": "",
    "replacement": "Radius $1 km"
  },
  {
    "pattern": "^Activité il y a ([0-9]+) jours?$",
    "flags": "",
    "replacement": "Active $1 day(s) ago"
  },
  {
    "pattern": "^Membre depuis ([0-9]+) jours?$",
    "flags": "",
    "replacement": "Member for $1 day(s)"
  },
  {
    "pattern": "^★ ([0-9]+(?:,[0-9])?) \\(([0-9]+) avis\\)$",
    "flags": "",
    "replacement": "★ $1 ($2 reviews)"
  },
  {
    "pattern": "^Note moyenne ([0-9]+(?:,[0-9])?) sur 5, ([0-9]+) avis$",
    "flags": "",
    "replacement": "Average rating $1 out of 5, $2 reviews"
  },
  {
    "pattern": "^Note ([1-5](?:,[0-9])?) sur 5$",
    "flags": "",
    "replacement": "Rating $1 out of 5"
  },
  {
    "pattern": "^Votre évaluation : ([★☆]+)$",
    "flags": "",
    "replacement": "Your evaluation: $1"
  },
  {
    "pattern": "^([0-9]) étoiles?$",
    "flags": "",
    "replacement": "$1 star(s)"
  },
  {
    "pattern": "^Cette offre a été retenue par (.+)\\. L’annuler libère le rendez-vous et le notaire en sera avisé par courriel\\.$",
    "flags": "",
    "replacement": "This offer was taken by $1. Cancelling frees the appointment and the notary will be notified by email."
  },
  {
    "pattern": "^Votre offre du (.+) est annulée$",
    "flags": "",
    "replacement": "Your offer of $1 is cancelled"
  },
  // ADR 0035 — ce qu'une annulation a fait à l'argent se dit en TROIS phrases,
  // parce qu'il y a trois situations : une somme était réservée et on y a
  // retenu des frais ; rien n'était réservé et une charge neuve est portée à la
  // carte enregistrée ; la carte a refusé et rien n'a été prélevé. Ces trois-là
  // sont des FRAGMENTS : les cadres qui les portent (reçu, rôtie, avis) les
  // encadrent et les règles suivantes les finissent.
  {
    "pattern": "Des frais de (.+?) \\((.+?)\\) ont été retenus sur la somme réservée pour cet acte et versés au notaire en dédommagement\\.",
    "flags": "",
    "replacement": "A fee of $1 ($2) was kept from the amount held for this act and transferred to the notary as compensation."
  },
  {
    "pattern": "Des frais de (.+?) \\((.+?)\\) ont été portés à la carte que vous avez enregistrée et versés au notaire en dédommagement\\.",
    "flags": "",
    "replacement": "A fee of $1 ($2) was charged to the card you saved and transferred to the notary as compensation."
  },
  {
    "pattern": "Des frais de (.+?) \\((.+?)\\) s’appliquaient, mais votre carte les a refusés : rien n’a été débité\\.",
    "flags": "",
    "replacement": "A fee of $1 ($2) applied, but your card declined it: nothing was charged."
  },
  {
    "pattern": "^Offre annulée\\. ",
    "flags": "",
    "replacement": "Offer cancelled. "
  },
  {
    "pattern": "^Vous avez annulé cette offre\\. ",
    "flags": "",
    "replacement": "You cancelled this offer. "
  },
  {
    "pattern": " Si vous changez d’avis, choisissez une nouvelle date au carnet\\.",
    "flags": "",
    "replacement": " If you change your mind, pick a new date on the carnet."
  },
  {
    "pattern": "^Annuler maintenant retient des frais de (.+?) \\((.+?) du montant convenu\\) sur la somme réservée pour cet acte\\.",
    "flags": "",
    "replacement": "Cancelling now keeps a fee of $1 ($2 of the agreed amount) from the amount held for this act."
  },
  {
    "pattern": "^Aucune somme n’est réservée pour cet acte\\. Annuler maintenant porte des frais de (.+?) \\((.+?) du montant convenu\\) à la carte que vous avez enregistrée\\.",
    "flags": "",
    "replacement": "No amount is being held for this act. Cancelling now charges a fee of $1 ($2 of the agreed amount) to the card you saved."
  },
  {
    "pattern": " Ils sont versés au notaire en dédommagement de la journée réservée\\.",
    "flags": "",
    "replacement": " It is transferred to the notary as compensation for the reserved day."
  },
  {
    "pattern": "^La carte du client est validée par sa banque dès la publication, et la somme y est réservée 1 jour avant la signature\\.$",
    "flags": "",
    "replacement": "The client’s card is validated by their bank as soon as the offer is posted, and the amount is held on it 1 day before the signing."
  },
  {
    "pattern": "^La carte du client est validée par sa banque dès la publication, et la somme y est réservée ([0-9]+) jours avant la signature\\.$",
    "flags": "",
    "replacement": "The client’s card is validated by their bank as soon as the offer is posted, and the amount is held on it $1 days before the signing."
  },
  {
    "pattern": " Le reste vous est libéré immédiatement\\.",
    "flags": "",
    "replacement": " The rest is released to you immediately."
  },
  {
    "_note": "Restauré le 2026-09-04 : la fusion de l'ADR 0035 avait remplacé en bloc les motifs d'annulation et emporté celui-ci au passage, alors qu'il n'a rien à voir avec la caution. Sans lui, l'étiquette du badge de messages non lus ne se traduit plus — un lecteur d'écran anglophone entendait du français.",
    "pattern": "^([0-9]+) nouveaux? messages?$",
    "flags": "",
    "replacement": "$1 new message(s)"
  },
  {
    "pattern": "^À propos de votre (.+) du (.+)\\.$",
    "flags": "",
    "replacement": "About your $1 of $2."
  },
  {
    "pattern": "^Le message ne peut dépasser ([0-9 \\u00a0]+) caractères\\.$",
    "flags": "",
    "replacement": "The message cannot exceed $1 characters."
  },
  {
    "pattern": "^Code enregistré : ([A-Z0-9]{4,12})$",
    "flags": "",
    "replacement": "Code saved: $1"
  },
  {
    "pattern": "^(\\d+) demandes? publiées? ce mois-ci · (\\d+) retenues?$",
    "flags": "",
    "replacement": "$1 requests posted this month · $2 taken"
  },
  {
    "pattern": "^(\\d+) demandes? ouvertes? · (.+) à retenir$",
    "flags": "",
    "replacement": "$1 open requests · $2 to take on"
  },
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
    "pattern": "^(.+) — d\u00e8s (.+?) en (.+?)\\.$",
    "flags": "",
    "replacement": "$1 — from $2 for $3."
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
    "pattern": "^(.+?), à partir de (.+?), aucune offre ce mois\\. Retirer ce filtre\\.$",
    "flags": "",
    "replacement": "$1, from $2, no offers this month. Remove this filter."
  },
  {
    "pattern": "^(.+?), à partir de (.+?), aucune offre ce mois\\. Afficher le carnet pour cet acte\\.$",
    "flags": "",
    "replacement": "$1, from $2, no offers this month. Show the carnet for this act."
  },
  {
    "pattern": "^(.+?), à partir de (.+?), repère du mois (.+?)\\. Retirer ce filtre\\.$",
    "flags": "",
    "replacement": "$1, from $2, month’s reference $3. Remove this filter."
  },
  {
    "pattern": "^(.+?), à partir de (.+?), repère du mois (.+?)\\. Afficher le carnet pour cet acte\\.$",
    "flags": "",
    "replacement": "$1, from $2, month’s reference $3. Show the carnet for this act."
  },
  {
    "pattern": "^(.+?), à partir de (.+?), pas assez d’offres ce mois pour un repère\\. Retirer ce filtre\\.$",
    "flags": "",
    "replacement": "$1, from $2, not enough offers this month for a reference. Remove this filter."
  },
  {
    "pattern": "^(.+?), à partir de (.+?), pas assez d’offres ce mois pour un repère\\. Afficher le carnet pour cet acte\\.$",
    "flags": "",
    "replacement": "$1, from $2, not enough offers this month for a reference. Show the carnet for this act."
  },
  {
    "pattern": "^Réserver une (.+)$",
    "flags": "",
    "replacement": "Book a $1"
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
    "pattern": "^Les offres en (.+?) sont déjà retenues — fixez votre prix\\.$",
    "flags": "",
    "replacement": "The offers for $1 are already taken — set your price."
  },
  {
    "pattern": "^L’offre en (.+?) est déjà retenue — fixez votre prix\\.$",
    "flags": "",
    "replacement": "The offer for $1 is already taken — set your price."
  },
  {
    "pattern": "^Aucune offre en (.+?) pour cette date\\. Soyez le premier — fixez votre prix\\.$",
    "flags": "",
    "replacement": "No offers for $1 for this date. Be the first — set your price."
  },
  {
    "pattern": "^Ce que d’autres offrent ce jour-là · (.+)$",
    "flags": "",
    "replacement": "What others are offering that day · $1"
  },
  {
    "pattern": "^Proposez plus que (.+) pour passer devant\\.$",
    "flags": "",
    "replacement": "Offer more than $1 to move ahead."
  },
  {
    "pattern": "^D’autres clients offrent (.+) ce jour-là : c’est votre point de repère\\.$",
    "flags": "",
    "replacement": "Other clients are offering $1 that day: that is your reference point."
  },
  {
    "pattern": "^Offrir autant · (.+)$",
    "flags": "",
    "replacement": "Offer as much · $1"
  },
  {
    "pattern": "^dès (.+)$",
    "flags": "",
    "replacement": "from $1"
  },
  {
    "pattern": "^([+−])(\\d{1,3}(?:[\\u00a0 ]\\d{3})*)[\\u00a0 ]\\$$",
    "flags": "",
    "replacement": "$1$$$2"
  },
  {
    "pattern": "^([+−]\\$\\d{1,3})[\\u00a0 ](\\d{3})$",
    "flags": "",
    "replacement": "$1,$2"
  },
  {
    "pattern": "^(.+?)\\. À ce délai, une offre en (.+?) se conclut autour de (.+)\\.$",
    "flags": "",
    "replacement": "$1. At this notice, an offer for $2 closes around $3."
  },
  {
    "pattern": "^Signature (.+?) · à ce délai, les offres se concluent entre (.+?) et (.+?)\\.$",
    "flags": "",
    "replacement": "Signing $1 · at this notice, offers close between $2 and $3."
  },
  {
    "pattern": "^Signature (.+?) · à ce délai, les offres se concluent autour de (.+?)\\.$",
    "flags": "",
    "replacement": "Signing $1 · at this notice, offers close around $2."
  },
  {
    "pattern": "^Répondez à : (.+)$",
    "flags": "",
    "replacement": "Answer: $1"
  },
  {
    "pattern": "^(\\d+) réponses attendues$",
    "flags": "",
    "replacement": "$1 answers expected"
  },
  {
    "pattern": "^Voir le (.+) au carnet$",
    "flags": "",
    "replacement": "See $1 on the carnet"
  },
  {
    "pattern": "^Un notaire \\((.+?)\\) vous propose (.+)$",
    "flags": "",
    "replacement": "A notary ($1) is proposing $2"
  },
  {
    "pattern": "^Un notaire vous propose (.+?) pour votre (.+?) du (.+)$",
    "flags": "",
    "replacement": "A notary is proposing $1 for your $2 on $3"
  },
  {
    "pattern": "^Un notaire vous propose (.+)$",
    "flags": "",
    "replacement": "A notary is proposing $1"
  },
  {
    "pattern": "^Le notaire demande des documents pour votre (.+?) du (.+)$",
    "flags": "",
    "replacement": "The notary is asking for documents for your $1 on $2"
  },
  {
    "pattern": "^Accepter (.+)$",
    "flags": "",
    "replacement": "Accept $1"
  },
  {
    "pattern": "^Votre demande est retenue à (.+)$",
    "flags": "",
    "replacement": "Your request has been taken on at $1"
  },
  {
    "pattern": "^Proposition refusée\\. Votre offre reste ouverte à (.+)\\.$",
    "flags": "",
    "replacement": "Proposal declined. Your offer stays open at $1."
  },
  {
    "pattern": "^Prochaine dispo · (.+)$",
    "flags": "",
    "replacement": "Next availability · $1"
  },
  // FALLBACK — the bare « acte, à partir de montant » label. It swallows any
  // longer sentence built on the same frame, so every specific « …, à partir
  // de …, … » rule MUST sit above this one. (The pulse-row aria-labels sat
  // below it and reached English clients as « from $2,279, repère du mois ».)
  {
    "pattern": "^(.+), à partir de (.+)$",
    "flags": "",
    "replacement": "$1, from $2"
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
    "pattern": "^Fichier trop lourd — maximum ([0-9]+) Mo\\.$",
    "flags": "",
    "replacement": "File too large — maximum $1 MB."
  },
  {
    "pattern": "^Réutiliser : (.+)$",
    "flags": "",
    "replacement": "Reuse: $1"
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
    "pattern": "^questions de prix à répondre : (.+) · consentement de partage requis\\.$",
    "flags": "",
    "replacement": "price questions to answer: $1 · sharing consent required."
  },
  {
    "pattern": "^questions de prix à répondre : (.+)\\.$",
    "flags": "",
    "replacement": "price questions to answer: $1."
  },
  {
    "pattern": "^Votre lien : (.+)$",
    "flags": "",
    "replacement": "Your link: $1"
  },
  {
    "pattern": "^(.+) par client référé retenu, (.+) au premier acte d’un notaire référé\\.$",
    "flags": "",
    "replacement": "$1 per referred client whose request is taken on, $2 at a referred notary’s first act."
  },
  {
    "pattern": "^Un professionnel qui réfère reçoit une récompense fixe de Nota : (.+) quand la demande d’un client référé est retenue, et (.+), une seule fois, quand un notaire référé retient son premier acte\\. Payée par Nota à même ses propres fonds, elle ne change jamais le prix du client ni les honoraires du notaire\\. Le professionnel encadré \\(OACIQ notamment\\) demeure responsable de divulguer cette récompense à son client lorsque son code de déontologie l’exige\\.$",
    "flags": "",
    "replacement": "A referring professional receives a flat reward from Nota: $1 when a referred client’s request is taken on, and $2, once, when a referred notary takes on their first act. Paid by Nota from its own funds, it never changes the client’s price nor the notary’s fees. A regulated professional (notably OACIQ) remains responsible for disclosing this reward to their client when their code of ethics requires it."
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
    "pattern": "^le ([0-9]{1,2} .+)$",
    "flags": "",
    "replacement": "on $1"
  },
  {
    "pattern": "^(.+) · transmis à la signature$",
    "flags": "",
    "replacement": "$1 · shared at signing"
  },
  {
    "pattern": "^Vos honoraires (.+) · service Nota payé par le client (.+)$",
    "flags": "",
    "replacement": "Your fees $1 · Nota service paid by the client $2"
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
    "pattern": "^Dans ([0-9]+) jours$",
    "flags": "",
    "replacement": "In $1 days"
  },
  {
    "pattern": "^Dans 1 jour$",
    "flags": "",
    "replacement": "In 1 day"
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
    "pattern": "Prêteur privé(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Private lender"
  },
  {
    "pattern": "J’accepte de me déplacer à l’étude — jusqu’à 50 km(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "I’m willing to travel to the notary’s office — up to 50 km"
  },
  {
    "pattern": "J’accepte de me déplacer à l’étude — jusqu’à 25 km(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "I’m willing to travel to the notary’s office — up to 25 km"
  },
  {
    "pattern": "J’accepte de me déplacer à l’étude — moins de 10 km(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "I’m willing to travel to the notary’s office — under 10 km"
  },
  {
    "pattern": "Le notaire se déplace chez moi — jusqu’à 25 km(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "The notary travels to me — up to 25 km"
  },
  {
    "pattern": "Le notaire se déplace chez moi — jusqu’à 50 km(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "The notary travels to me — up to 50 km"
  },
  {
    "pattern": "Urgence — signature 100\\s*% en ligne(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Urgency — 100 % online signing"
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
    "pattern": "Financement hypothécaire(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Mortgage financing"
  },
  {
    "pattern": "Financement(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Financing"
  },
  {
    "pattern": "Procuration notariée(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Notarial power of attorney"
  },
  {
    "pattern": "Testament notarié(?![A-Za-zà-ÿ])",
    "flags": "g",
    "replacement": "Notarial will"
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
  },
  /* W3 */
  {
    "pattern": "^Messagerie — ([0-9]+) nouvelles réponses$",
    "flags": "",
    "replacement": "Chat — $1 new replies"
  },
  /* /W3 */
  /* F4 */
  {
    "pattern": "^Le lien expire dans (\\d+) minutes\\.$",
    "flags": "",
    "replacement": "The link expires in $1 minutes."
  },
  {
    "pattern": "^Trop de tentatives\\. Réessayez dans (\\d+) minutes\\.$",
    "flags": "",
    "replacement": "Too many attempts. Try again in $1 minutes."
  },
  /* /F4 */
  /* ADR 0047 — la salle. La porte de présence COMPOSE la durée de la coupure :
     seul un nombre entre dans la capture, donc la règle ne peut pas laisser de
     français dedans. (L'aria-label que `rendrePortes` compose — « Présence
     continue : fermée — <motif> » — n'a délibérément PAS de règle : une règle
     à capture large rendrait la phrase à moitié française tout en faisant
     répondre `covered()` par oui, ce qui est pire que le manque.) */
  {
    "pattern": "^Le lien est coupé depuis (\\d+) s\\.$",
    "flags": "",
    "replacement": "The link has been down for $1 s."
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
        var q = /[?&]lang=(en|fr)(?=&|$)/.exec(location.search || '');
        if (q) { try { localStorage.setItem(LS_LANG, q[1]); } catch (e) {} return q[1]; }
      }
    } catch (e) {}
    try { var v = localStorage.getItem(LS_LANG); if (v === 'en' || v === 'fr') return v; } catch (e) {}
    // Aucun choix posé : c'est le NAVIGATEUR qui décide, dans SON ordre de
    // préférence. On lit `navigator.languages` en entier (2026-09-06) et non le
    // seul `navigator.language` : un visiteur dont la première langue n'est ni
    // le français ni l'anglais — « es-MX, en-US, fr » — recevait le français
    // parce que la première entrée ne commençait pas par « en », alors que sa
    // deuxième préférence disait l'anglais. On retient la PREMIÈRE des deux
    // langues du site qu'il nomme ; s'il n'en nomme aucune, le Québec répond
    // en français.
    try {
      if (typeof navigator !== 'undefined') {
        var pref = navigator.languages && navigator.languages.length
          ? navigator.languages
          : [navigator.language];
        for (var i = 0; i < pref.length; i++) {
          var tag = String(pref[i] || '');
          if (/^fr\b/i.test(tag)) return 'fr';
          if (/^en\b/i.test(tag)) return 'en';
        }
      }
    } catch (e) {}
    return 'fr';
  }
  var current = detect();

  function lang() { return current; }
  function locale() { return current === 'en' ? 'en-CA' : 'fr-CA'; }
  function force(l) { current = l === 'en' ? 'en' : 'fr'; }
  function setLang(l) {
    l = l === 'en' ? 'en' : 'fr';
    var saved = false;
    try { localStorage.setItem(LS_LANG, l); saved = true; } catch (e) {}
    if (typeof window !== 'undefined' && window.NotaSaveLanguage) window.NotaSaveLanguage(l);
    // Preserve the choice even when storage is blocked, and replace URL overrides.
    if (typeof location !== 'undefined' && (!saved || /[?&]lang=/.test(location.search || ''))) {
      var query = new URLSearchParams(location.search || '');
      query.set('lang', l);
      location.replace(location.pathname + '?' + query.toString() + location.hash);
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
    // The canonical address and og:url follow the rendered language: an
    // English render must not canonicalise to the French page. ?lang=en is
    // the address the hreflang alternates already point at.
    var canon = d.querySelector('link[rel="canonical"]');
    var ogu = d.querySelector('meta[property="og:url"]');
    var base = (canon && canon.getAttribute('href')) || (ogu && ogu.getAttribute('content')) || '';
    if (base) {
      var enUrl = base.replace(/[?#].*$/, '') + '?lang=en';
      if (canon) canon.setAttribute('href', enUrl);
      if (ogu) ogu.setAttribute('content', enUrl);
    }
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
  // Each [data-lang-seg] group carries one button per language
  // ([data-set-lang="fr"|"en"]): BOTH stay visible, the CURRENT one is marked
  // pressed, clicking the other switches. The groups sit under data-i18n-skip
  // so the walker leaves their two-letter labels alone.
  function wireToggles() {
    var btns = document.querySelectorAll('[data-lang-seg] [data-set-lang]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        var l = btn.getAttribute('data-set-lang') === 'en' ? 'en' : 'fr';
        btn.setAttribute('aria-pressed', l === current ? 'true' : 'false');
        btn.setAttribute('aria-label', l === 'en' ? 'English' : 'Français');
        btn.addEventListener('click', function () { if (l !== current) setLang(l); });
      })(btns[i]);
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
