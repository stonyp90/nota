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
  "Activité du marché notarial — offres, rétention et commissions.": "Notarial marketplace activity — offers, retention and commissions.",
  "Période": "Period",
  "Offres publiées": "Offers posted",
  "sur la période": "over the period",
  "Taux de rétention": "Retention rate",
  "Actes complétés": "Acts completed",
  "Commission perçue": "Commission collected",
  "Offres ouvertes": "Open offers",
  "en ce moment": "right now",
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
  "Aucune offre, rétention ou commission n’a été enregistrée sur l’intervalle sélectionné. Essayez une période plus large.": "No offers, retention, or commission were recorded over the selected interval. Try a wider period.",
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
  "Videz les deux sujets pour revenir aux sujets par défaut. Le corps du courriel n’est pas modifiable.": "Clear both subjects to return to the default subjects. The email body is not editable.",
  "Enregistrer": "Save",
  "Réinitialiser": "Reset",
  "Modèle enregistré.": "Template saved.",
  "Modèle réinitialisé.": "Template reset.",
  "Impossible d’enregistrer le modèle.": "Unable to save the template.",
  "Facturation": "Billing",
  "Barème décidé par Nota — la cote sur 100 du notaire décide le partage.": "Schedule decided by Nota — the notary’s cote out of 100 decides the split.",
  "— la modification du barème est réservée à l’administrateur principal.": "— editing the schedule is reserved for the primary administrator.",
  "Taux de base": "Base rate",
  "la part de Nota sans historique": "Nota’s share with no track record",
  "Plancher": "Floor",
  "jamais franchi, quelle que soit la cote": "never crossed, whatever the cote",
  "Au mieux, le notaire garde": "At best the notary keeps",
  "à la cote la plus haute du barème": "at the highest cote in the schedule",
  "Paliers": "Tiers",
  "de cote qui abaissent la part de Nota": "of cote that lower Nota’s share",
  "Barème en vigueur": "Schedule in force",
  "Valeurs par défaut du déploiement — aucun barème enregistré.": "Deployment defaults — no schedule stored.",
  "Aucun palier — le taux de base s’applique toujours.": "No tiers — the base rate always applies.",
  "Cote atteinte": "Cote reached",
  "Part de Nota": "Nota’s share",
  "Le notaire garde": "The notary keeps",
  "Sous le premier palier, le taux de base s’applique — le notaire garde": "Below the first tier the base rate applies — the notary keeps",
  "Simulateur": "Simulator",
  "Une cote, et le partage qu’elle vaut sous le barème en vigueur.": "One cote, and the split it earns under the schedule in force.",
  "Cote du notaire (0 à 100)": "Notary’s cote (0 to 100)",
  "Nota garde": "Nota keeps",
  "Palier atteint : cote": "Tier reached: cote",
  "Aucun palier atteint — le taux de base s’applique.": "No tier reached — the base rate applies.",
  "Entrez une cote de 0 à 100.": "Enter a cote from 0 to 100.",
  "Modifier le barème": "Edit the schedule",
  "Les valeurs sont saisies en pourcentage — « 12 » signifie 12 %.": "Values are entered as percentages — “12” means 12%.",
  "Taux de base (%)": "Base rate (%)",
  "Plancher (%)": "Floor (%)",
  "Paliers de cote": "Cote tiers",
  "Part de Nota (%)": "Nota’s share (%)",
  "Ajouter un palier": "Add a tier",
  "Retirer": "Remove",
  "Enregistrer le barème": "Save the schedule",
  "Revenir aux valeurs par défaut": "Return to the default values",
  "Le barème enregistré sera supprimé — les valeurs par défaut reprendront effet dès le prochain acte.": "The stored schedule will be deleted — the default values take effect again at the next act.",
  "Confirmer la réinitialisation": "Confirm the reset",
  "Annuler": "Cancel",
  "Barème enregistré.": "Schedule saved.",
  "Barème réinitialisé.": "Schedule reset.",
  "Impossible d’enregistrer le barème.": "Unable to save the schedule.",
  "Le taux de base doit être un nombre entre 0 et 1 (ex. 0,15 pour 15 %).": "The base rate must be a number between 0 and 1 (e.g. 0.15 for 15%).",
  "Le plancher doit être un nombre entre 0 et le taux de base.": "The floor must be a number between 0 and the base rate.",
  "Une cote plus haute ne peut jamais coûter plus cher au notaire.": "A higher cote can never cost the notary more.",
  "Annulation": "Cancellation",
  "Barème décidé par Nota — frais d’annulation tardive selon les jours restants avant la signature.": "Schedule decided by Nota — late-cancellation fees by days left before the signing.",
  "Dernière minute": "Last minute",
  "retenu la veille de la signature": "retained on the eve of the signing",
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
  "Tableau d’honneur — la cote sur 100 décide la part que chaque notaire garde.": "Roll of honour — the cote out of 100 decides the share each notary keeps.",
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
  "Barème de commission modifié": "Commission schedule updated",
  "Barème de commission réinitialisé": "Commission schedule reset",
  "Barème d’annulation modifié": "Cancellation schedule updated",
  "Barème d’annulation réinitialisé": "Cancellation schedule reset",
  "Modèle de courriel modifié": "Email template updated",
  "Modèle de courriel réinitialisé": "Email template reset",
  "Lien de connexion demandé": "Sign-in link requested",
  "Lien demandé par une adresse inconnue": "Link requested by an unknown address",
  "Connexion freinée": "Sign-in throttled",
  "Connexion réussie": "Signed in",
  "Déconnexion": "Signed out",
  "Session prolongée": "Session extended"
};
  var HTML = {};
  var RULES = compileRules([
  {
    "pattern": "^Barème décidé par Nota — modifié le (.+)\\.$",
    "flags": "",
    "replacement": "Schedule decided by Nota — updated $1."
  },
  {
    "pattern": "^(.+) payés · (.+) · (.+) à Nota · (.+) au notaire · cote (\\d+)$",
    "flags": "",
    "replacement": "$1 paid · $2 · $3 to Nota · $4 to the notary · cote $5"
  },
  {
    "pattern": "^Barème en vigueur : Nota garde de (.+) à (.+) selon la cote\\.$",
    "flags": "",
    "replacement": "Schedule in force: Nota keeps from $1 to $2 by cote."
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
  }
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
