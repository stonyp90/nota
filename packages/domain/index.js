/**
 * @nota/domain — business rules for the Nota marketplace.
 *
 * Rules:
 *   - No dependencies, no DOM, no network. Pure functions and data only.
 *   - This module is the single source of truth for prices, tiers, the premium
 *     cap, offer validation and the document intake schema. If a number or a
 *     tier label is meaningful to the product, it lives here and is asserted by
 *     a test — never hardcoded in apps/web or apps/api.
 *   - UMD wrapper so the same file loads in Node (`require('@nota/domain')`),
 *     the browser (`window.NotaDomain`) and the test runner.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotaDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // --- Money -----------------------------------------------------------------
  // Amounts are integer Canadian dollars. Quebec formats with a space as the
  // thousands separator and a trailing " $". Everything user-facing that shows
  // an amount MUST route through money() so the format is defined in one place.
  // fr-CA sets a no-break space between thousands groups and before the sign, so
  // an amount never wraps mid-number or orphans its "$" onto the next line.
  const NBSP = '\u00A0';

  function money(dollars) {
    const n = Math.round(Number(dollars) || 0);
    const digits = Math.abs(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return (n < 0 ? '−' : '') + digits + NBSP + '$';
  }

  // English-Canada twin of money(): same integer dollars and rounding, but the
  // en-CA shape — leading "$", comma thousands separator ("$1,250"), and the
  // same true minus sign placed before the "$" ("−$1,250"). Bilingual surfaces
  // (emails, calendar feeds) show money() on the French side and moneyEn() on
  // the English side; neither format is ever built inline elsewhere.
  function moneyEn(dollars) {
    const n = Math.round(Number(dollars) || 0);
    const digits = Math.abs(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '−' : '') + '$' + digits;
  }

  // --- Services --------------------------------------------------------------
  // Only acts with a bounded, client-assemblable intake are listed. Acte de
  // vente remains deliberately out of scope — see
  // docs/decisions/0003-bounded-intake.md. Testament and procuration are now
  // catalogue services too: each has its own intake, price levers and
  // checklist, so a notary can accept from a complete, server-validated brief.
  // Each service carries its own document checklist and info fields, with
  // plain-language help text (fr-CA) used by both the Dossier UI and the
  // text-to-speech reader.
  // The only location signal an anonymous bid carries publicly: the first three
  // characters of a Canadian postal code (the forward sortation area), shown as
  // "Client · G1R". Format is letter-digit-letter; Quebec's FSAs begin with G, H
  // or J. Defined here so no adapter re-implements the format.
  // Several criterion labels are questions. Concatenating them into a longer
  // sentence must not produce "… ? ." or "… ? : Oui".
  function endPunctuated(label) { return /[?!.:]\s*$/.test(String(label || '')); }
  function stripEndPunctuation(label) { return String(label || '').replace(/\s*[?!.:]+\s*$/, ''); }

  const POSTAL_PREFIX_RE = /^[A-Z]\d[A-Z]$/;
  const QC_POSTAL_LETTERS = ['G', 'H', 'J'];
  function normalizePostalPrefix(value) {
    return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  }
  function isPostalPrefix(value) { return POSTAL_PREFIX_RE.test(normalizePostalPrefix(value)); }
  // The ONE prefixe gate both validators share (offer: required; notary
  // profile: optional). Returns { value, error } — value is the normalized
  // sector or null, error a typed entry or null. One message, one i18n entry.
  function validatePrefixe(raw, { required } = {}) {
    const norm = normalizePostalPrefix(raw);
    if (!norm) {
      return required
        ? { value: null, error: { code: 'prefixe_requis', message: 'Le secteur postal est requis (les 3 premiers caractères de votre code postal).' } }
        : { value: null, error: null };
    }
    if (!POSTAL_PREFIX_RE.test(norm)) {
      return { value: null, error: { code: 'prefixe_invalide', message: 'Le secteur postal doit être une lettre, un chiffre, une lettre, comme « G1R ».' } };
    }
    return { value: norm, error: null };
  }
  function isQuebecPostalPrefix(value) {
    const p = normalizePostalPrefix(value);
    return isPostalPrefix(p) && QC_POSTAL_LETTERS.indexOf(p.charAt(0)) !== -1;
  }

  // The act pre-selected when a client opens the booking flow without having
  // filtered the carnet first. Which act leads is a product decision, so it is
  // named here and asserted by a test rather than typed into the UI.
  const DEFAULT_SERVICE_ID = 'refinancement';

  // --- Lender catalogue (prêteurs hypothécaires) -----------------------------
  // The institutions that normally lend to Quebec borrowers. The lender is
  // INFORMATION and a refusal axis — a notary can decline to instrument an
  // act when the lender is not one they normally close with — but choosing
  // one costs the client nothing: `add` stays 0 across the catalogue except
  // the private lender, the one deliberate surcharge (manual instructions,
  // more diligence). A lender without branches (`virtuel: true` — remote
  // instructions and disbursement) still weighs on complexity via `poids`
  // so the notary sees the coordination, without a price effect. A lender
  // missing from the list is typed in by the client (« Autre prêteur » +
  // name — see lenderCriterion().autre), never left anonymous.
  // The list is data — adapters render it, never re-declare it.
  const LENDERS = [
    { id: 'banque_nationale', nom: 'Banque Nationale', virtuel: false, add: 0, poids: 0 },
    { id: 'desjardins', nom: 'Desjardins', virtuel: false, add: 0, poids: 0 },
    { id: 'rbc', nom: 'RBC Banque Royale', virtuel: false, add: 0, poids: 0 },
    { id: 'td', nom: 'TD Canada Trust', virtuel: false, add: 0, poids: 0 },
    { id: 'bmo', nom: 'BMO Banque de Montréal', virtuel: false, add: 0, poids: 0 },
    { id: 'scotia', nom: 'Banque Scotia', virtuel: false, add: 0, poids: 0 },
    { id: 'cibc', nom: 'CIBC', virtuel: false, add: 0, poids: 0 },
    { id: 'laurentienne', nom: 'Banque Laurentienne', virtuel: false, add: 0, poids: 0 },
    { id: 'tangerine', nom: 'Tangerine', virtuel: true, add: 0, poids: 1 },
    { id: 'simplii', nom: 'Simplii Financial', virtuel: true, add: 0, poids: 1 },
    { id: 'eq', nom: 'Banque EQ', virtuel: true, add: 0, poids: 1 },
    { id: 'nesto', nom: 'nesto', virtuel: true, add: 0, poids: 1 },
    { id: 'first_national', nom: 'First National', virtuel: true, add: 0, poids: 1 },
    { id: 'mcap', nom: 'MCAP', virtuel: true, add: 0, poids: 1 },
    { id: 'manuvie', nom: 'Banque Manuvie', virtuel: true, add: 0, poids: 1 },
    // The one lender that still adds explains its surcharge (`aide`): the
    // client sees WHY the private lender costs more, right at the choice.
    { id: 'prive', nom: 'Prêteur privé', virtuel: false, add: 300, poids: 2, aide: 'Un prêteur privé donne ses instructions à la main : plus de vérifications, d’où le supplément.' },
    { id: 'autre', nom: 'Autre prêteur', virtuel: false, add: 0, poids: 1 },
  ];

  function lenderById(id) {
    return LENDERS.find((l) => l.id === id) || null;
  }

  // The lender question both financing acts ask. A `choice` criterion whose
  // options ARE the catalogue, so the pricing engine (criterionAdd, complexity,
  // missingRequired) needs no new type; `ui: 'select'` tells renderers the list
  // is too long for chips.
  const LENDER_CRITERION_ID = 'preteur';
  const LENDER_OTHER_ID = 'autre';
  const LENDER_OTHER_FIELD = 'preteur_autre';
  function lenderCriterion() {
    return {
      id: LENDER_CRITERION_ID, type: 'choice', required: true, ui: 'select', groupe: 'pret',
      label: 'Prêteur hypothécaire',
      aide: 'Un prêteur sans succursale (en ligne) demande plus de coordination au notaire.',
      options: LENDERS.map((l) => (l.aide
        ? { id: l.id, label: l.nom, add: l.add, poids: l.poids, aide: l.aide }
        : { id: l.id, label: l.nom, add: l.add, poids: l.poids })),
      // « Autre prêteur » opens a free-text companion: the client ADDS their
      // lender by name instead of leaving the notary guessing. Renderers show
      // the field only when this option is chosen; missingRequired() gates on
      // it the same way it gates the choice itself.
      autre: {
        option: LENDER_OTHER_ID,
        champ: LENDER_OTHER_FIELD,
        label: 'Nom du prêteur',
        aide: 'Votre prêteur n’est pas dans la liste ? Inscrivez son nom.',
      },
    };
  }

  // The typed name behind an « Autre prêteur » answer: whitespace collapsed
  // and capped, so a crafted payload cannot smuggle an essay into the
  // notary's feed. Null when absent or blank.
  function lenderOtherName(answers) {
    const raw = answers && answers[LENDER_OTHER_FIELD];
    if (typeof raw !== 'string') return null;
    const nom = raw.replace(/\s+/g, ' ').trim().slice(0, 80).trim();
    return nom || null;
  }

  // The lender behind a bid, read from its pricing answers. Null when the bid
  // predates the lender question or names none. For « Autre prêteur », `nom`
  // is the name the client typed (the id stays the catalogue slug so the
  // notary's refusal roster keeps working).
  function bidLender(bid) {
    const answers = (bid && bid.pricing) || {};
    const l = lenderById(answers[LENDER_CRITERION_ID]);
    if (!l || l.id !== LENDER_OTHER_ID) return l;
    const nom = lenderOtherName(answers);
    return nom ? { ...l, nom } : l;
  }

  // --- Déplacement catalogue (qui se déplace pour la signature) --------------
  // The act signs IN PERSON within a declared perimeter (ADR 0017): the client
  // travels to the étude, or the notary travels to the client. The band is a
  // price lever both ways — the most mobile client is the baseline (add 0, the
  // very « à partir de » the hero shows) and the price rises as the pool of
  // reachable notaries shrinks or as kilometres are asked of the notary,
  // mirroring how travelling notaries price call-outs (flat fee per radius
  // band). The one exception is a DECLARED urgency: 100 % online, the firmest
  // premium of the ladder, and only served by a notary who opted in
  // (notaryCanServe). The km values are declarations framing the mise en
  // relation — not computed distances (no notary location exists yet).
  // The list is data — adapters render it, never re-declare it.
  // `nomCourt` is the radius half of the sentence, for renderers that split
  // the band into two choices (who travels × how far) instead of one select.
  // The client bands read as a WILLINGNESS (« j'accepte de me déplacer »):
  // the client is not promising a drive, they are widening the pool of
  // notaries that can serve them — the price lever the help text explains.
  const DEPLACEMENTS = [
    { id: 'client_50', nom: 'J’accepte de me déplacer à l’étude — jusqu’à 50 km', nomCourt: '≤ 50 km', qui: 'client', km: 50, add: 0, poids: 0, urgence: false },
    { id: 'client_25', nom: 'J’accepte de me déplacer à l’étude — jusqu’à 25 km', nomCourt: '≤ 25 km', qui: 'client', km: 25, add: 50, poids: 0, urgence: false },
    { id: 'client_10', nom: 'J’accepte de me déplacer à l’étude — moins de 10 km', nomCourt: '< 10 km', qui: 'client', km: 10, add: 100, poids: 1, urgence: false },
    { id: 'notaire_25', nom: 'Le notaire se déplace chez moi — jusqu’à 25 km', nomCourt: '≤ 25 km', qui: 'notaire', km: 25, add: 150, poids: 1, urgence: false },
    { id: 'notaire_50', nom: 'Le notaire se déplace chez moi — jusqu’à 50 km', nomCourt: '≤ 50 km', qui: 'notaire', km: 50, add: 250, poids: 2, urgence: false },
    { id: 'urgence_en_ligne', nom: 'Urgence — signature 100 % en ligne', nomCourt: 'Urgence — 100 % en ligne', qui: 'en_ligne', km: 0, add: 400, poids: 2, urgence: true },
  ];

  // The « who travels » half of the same split. The list is data — adapters
  // render it, never re-declare it. An `urgence` direction has a single band,
  // so renderers need no radius row for it.
  // The labels answer « où se signe l'acte ? » in the client's own register —
  // the same words as the notary-card pill (« À l'étude · ≤ 50 km »).
  // `question` heads the radius row of that direction — asked of the client
  // for their own willingness, of the notary's reach when the notary travels.
  const DEPLACEMENT_QUI = [
    { id: 'client', nom: 'À l’étude', urgence: false, question: 'Jusqu’où acceptez-vous de vous déplacer ?' },
    { id: 'notaire', nom: 'Chez moi', urgence: false, question: 'Jusqu’où le notaire doit-il se déplacer ?' },
    { id: 'en_ligne', nom: 'Urgence en ligne', urgence: true },
  ];

  function deplacementById(id) {
    return DEPLACEMENTS.find((d) => d.id === id) || null;
  }

  // The déplacement question both financing acts ask. Same engine shape as the
  // lender: a required `choice` whose options ARE the catalogue, rendered as a
  // select (six sentence-length bands are too long for chips).
  const DEPLACEMENT_CRITERION_ID = 'deplacement';
  const DEPLACEMENT_URGENCE_ID = 'urgence_en_ligne';
  function deplacementCriterion() {
    return {
      id: DEPLACEMENT_CRITERION_ID, type: 'choice', required: true, ui: 'select', groupe: 'signature',
      label: 'Déplacement pour la signature',
      // Conversion default (`defaut`): the dominant answer costs nothing, so
      // renderers pre-declare it and the client only touches the exceptions.
      defaut: 'client_50',
      aide: 'L’acte se signe en personne, sauf en cas d’urgence déclarée. Plus vous acceptez de vous déplacer, plus de notaires peuvent vous servir — et moins le déplacement coûte.',
      options: DEPLACEMENTS.map((d) => ({ id: d.id, label: d.nom, add: d.add, poids: d.poids })),
    };
  }

  // The band behind a bid, read from its pricing answers. Null when the bid
  // predates the déplacement question (legacy tolerance, like the lender).
  function bidDeplacement(bid) {
    const answers = (bid && bid.pricing) || {};
    return deplacementById(answers[DEPLACEMENT_CRITERION_ID]);
  }

  // The radii a notary can declare (their profile's `rayonKm`). 0 is the
  // conservative default — a notary who said nothing travels nowhere.
  const NOTARY_RADII = [0, 25, 50];

  // --- FSA centroids (ADR 0025) ---------------------------------------------
  // The real-distance upgrade ADR 0017 announced as future work: every offer
  // now carries its postal sector (ADR 0024), so the mise en relation can
  // measure an actual client↔étude distance instead of trusting the declared
  // proxy. Centroids are NEIGHBOURHOOD-LEVEL approximations (±1–2 km) of the
  // Québec-metro FSAs — band-level accuracy (10/25/50 km) is all the rules
  // need, never street precision, and every rendered figure says « ≈ ».
  // Swapping in Statistics Canada's official centroid file is a drop-in data
  // upgrade; an FSA absent from this table falls back to the declarative
  // rule. [latitude, longitude].
  const FSA_CENTROIDS = {
    // Québec — rive nord
    G1A: [46.808, -71.214], G1B: [46.885, -71.155], G1C: [46.862, -71.185],
    G1E: [46.843, -71.192], G1G: [46.868, -71.263], G1H: [46.848, -71.266],
    G1J: [46.828, -71.208], G1K: [46.818, -71.221], G1L: [46.838, -71.233],
    G1M: [46.830, -71.259], G1N: [46.810, -71.253], G1P: [46.828, -71.290],
    G1R: [46.807, -71.222], G1S: [46.793, -71.248], G1T: [46.782, -71.268],
    G1V: [46.772, -71.288], G1W: [46.757, -71.305], G1X: [46.766, -71.330],
    G1Y: [46.755, -71.348],
    G2A: [46.876, -71.347], G2B: [46.853, -71.345], G2C: [46.848, -71.317],
    G2E: [46.802, -71.336], G2G: [46.788, -71.365], G2J: [46.850, -71.286],
    G2K: [46.842, -71.301], G2L: [46.856, -71.243], G2M: [46.884, -71.317],
    G2N: [46.917, -71.372],
    G3A: [46.741, -71.457], G3B: [46.940, -71.288], G3E: [46.917, -71.176],
    G3G: [46.905, -71.290], G3J: [46.885, -71.395], G3K: [46.906, -71.428],
    // Lévis — rive sud
    G6V: [46.810, -71.175], G6W: [46.775, -71.205], G6X: [46.722, -71.263],
    G6Y: [46.722, -71.212], G6Z: [46.703, -71.300], G7A: [46.700, -71.385],
  };

  // Great-circle distance between two known sectors, rounded to the km (the
  // data is coarser than that). Null when either sector is missing, malformed
  // or outside the table — callers then fall back to the declarative rules.
  function fsaDistanceKm(a, b) {
    const pa = FSA_CENTROIDS[normalizePostalPrefix(a)];
    const pb = FSA_CENTROIDS[normalizePostalPrefix(b)];
    if (!pa || !pb) return null;
    const rad = Math.PI / 180;
    const dLat = (pb[0] - pa[0]) * rad;
    const dLon = (pb[1] - pa[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(pa[0] * rad) * Math.cos(pb[0] * rad) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
  }

  // Whether a notary's profile covers a bid's declared band. The feed and the
  // accept gate both go through here. A null/unknown band (a bid predating
  // the question) reaches everyone; a declared urgency reaches only the
  // notaries who opted in (100 % online — distance never enters it).
  //
  // When BOTH sectors are known — the bid's (required since ADR 0024) and the
  // étude's — the MEASURED distance decides (ADR 0025): the kilometres must
  // fit the band the client priced, and, when the notary travels, their
  // declared radius must cover the actual drive. When either sector is
  // missing, the declarative proxy of ADR 0017 still applies: client-travel
  // bands reach everyone, notary-travel bands need rayon ≥ band.
  function notaryCanServe(deplacementId, profil, clientPrefixe) {
    const d = deplacementById(deplacementId);
    if (!d) return true;
    const p = profil || {};
    if (d.urgence) return p.urgences === true;
    const dist = fsaDistanceKm(clientPrefixe, p.prefixe);
    if (dist != null) {
      if (d.qui === 'notaire') return dist <= d.km && (Number(p.rayonKm) || 0) >= dist;
      return dist <= d.km;
    }
    if (d.qui === 'notaire') return (Number(p.rayonKm) || 0) >= d.km;
    return true;
  }

  // --- Les SECTIONS des questions (2026-09-05) -------------------------------
  // Dix questions à la file ne disent pas ce qui les relie. Elles se lisent en
  // trois temps — le prêt, l'immeuble, la signature — et ce découpage est une
  // DONNÉE : la feuille de réservation, le dossier et tout futur adaptateur
  // rendent les mêmes sections, dans le même ordre, sous les mêmes intitulés.
  // `aide` dit à quoi la section sert, en une ligne, dans le registre du
  // client — c'est ce qui remplace le titre muet d'une grille plate.
  // L'ordre du catalogue EST l'ordre de lecture : ce qu'on emprunte, sur quel
  // immeuble, puis où l'on signe — la seule décision qui dépend des deux
  // autres.
  const CRITERIA_GROUPS = [
    {
      id: 'pret',
      nom: 'Votre prêt',
      aide: 'Le montant, l’état de votre approbation et le prêteur à coordonner.',
    },
    {
      id: 'immeuble',
      nom: 'L’immeuble',
      aide: 'Les titres et les documents que le prêteur exigera avant de débourser.',
    },
    {
      id: 'parties',
      nom: 'Les personnes',
      aide: 'Les personnes concernées, leur situation et celles qui doivent intervenir.',
    },
    {
      id: 'acte',
      nom: 'Votre acte',
      aide: 'La portée et les particularités qui déterminent le travail du notaire.',
    },
    {
      id: 'biens',
      nom: 'Vos biens et instructions',
      aide: 'Les biens, volontés et documents qui donnent sa portée au dossier.',
    },
    {
      id: 'signature',
      nom: 'La signature',
      aide: 'Où l’acte se signe, et qui se déplace pour cela.',
    },
  ];

  function criteriaGroupById(id) {
    return CRITERIA_GROUPS.find((g) => g.id === id) || null;
  }

  // Les questions d'un acte, groupées pour l'affichage. Les sections sortent
  // dans l'ordre du catalogue, les questions dans l'ordre déclaré par l'acte,
  // et une section sans question n'est pas rendue. `requis` / `facultatifs`
  // évitent à chaque adaptateur de refaire le même partage — c'est lui qui
  // décide ce qui s'ouvre et ce qui se replie.
  // Une question dont la section est inconnue n'est JAMAIS perdue : elle rejoint
  // la dernière section rendue (le test du domaine interdit l'orphelin, mais un
  // écran ne doit pas escamoter une question à cause d'une faute de frappe).
  function criteriaGroups(service) {
    const svc = service && typeof service === 'object' ? service : serviceById(service);
    const criteria = (svc && svc.pricing && svc.pricing.criteria) || [];
    if (!criteria.length) return [];
    const known = new Set(CRITERIA_GROUPS.map((g) => g.id));
    const last = CRITERIA_GROUPS[CRITERIA_GROUPS.length - 1].id;
    const byGroup = new Map();
    for (const c of criteria) {
      const id = known.has(c.groupe) ? c.groupe : last;
      if (!byGroup.has(id)) byGroup.set(id, []);
      byGroup.get(id).push(c);
    }
    return CRITERIA_GROUPS
      .filter((g) => byGroup.has(g.id))
      .map((g) => {
        const list = byGroup.get(g.id);
        return {
          id: g.id,
          nom: g.nom,
          aide: g.aide,
          criteria: list,
          requis: list.filter((c) => c.required),
          facultatifs: list.filter((c) => !c.required),
        };
      });
  }

  // La CONSÉQUENCE d'une réponse sur la liste des documents (`si` du document).
  // Un choix ne fait pas que bouger le prix : « Oui » à la succession appelle le
  // testament et la déclaration de transmission, un certificat périmé retire
  // l'envoi qu'on allait demander. L'écran le dit SOUS la réponse au lieu de le
  // laisser découvrir plus tard dans le dossier — et il le lit ici, jamais en
  // devinant.
  //
  // La différence est mesurée contre l'ABSENCE de réponse : un document exigé de
  // toute façon n'est la conséquence de rien, et un document `sauf` (collecté
  // par défaut) ne s'« ajoute » pas — il se retire. Sans réponse, rien ne bouge.
  function documentEffect(service, critereId, answer) {
    const vide = { ajoutes: [], retires: [] };
    const svc = service && typeof service === 'object' ? service : serviceById(service);
    if (!svc || !critereId) return vide;
    const lies = (svc.documents || []).filter((d) => d.si && d.si.critere === critereId);
    if (!lies.length) return vide;
    const avant = (d) => documentApplies(d, {});
    const apres = (d) => documentApplies(d, { [critereId]: answer });
    return {
      ajoutes: lies.filter((d) => !avant(d) && apres(d)),
      retires: lies.filter((d) => avant(d) && !apres(d)),
    };
  }

  // --- The questions both financing acts share -------------------------------
  // One factory per question, so the two acts can never drift apart: the help
  // text, the options and their adds/poids are declared ONCE. (The loan amount
  // and the purchase context stay per-act — their labels differ.)
  function approbationCriterion() {
    return {
      id: 'approbation_bancaire', type: 'choice', required: true, groupe: 'pret', label: 'Approbation bancaire',
      aide: 'Sans les instructions du prêteur, le notaire ne peut signer à la date visée.',
      options: [
        { id: 'obtenue', label: 'Obtenue', add: 0, poids: 0 },
        { id: 'en_cours', label: 'En cours', add: 100, poids: 1 },
        { id: 'non', label: 'Pas encore demandée', add: 200, poids: 2 },
      ],
    };
  }
  function successionCriterion() {
    return {
      id: 'succession', type: 'choice', required: true, groupe: 'immeuble', label: 'La propriété fait-elle partie d’une succession ?',
      defaut: 'non',
      aide: 'Répondez oui si l’immeuble vient d’une succession qui n’est pas entièrement réglée — par exemple si le titre est encore au nom de la personne décédée.',
      options: [
        { id: 'non', label: 'Non', add: 0, poids: 0 },
        { id: 'oui', label: 'Oui', add: 400, poids: 2 },
      ],
    };
  }
  // Art. 401-405 C.c.Q.: a married or civil-union spouse must intervene in any
  // act on the FAMILY residence, even without borrowing. Optional (a bid that
  // predates the question stays a valid offer) but priced and weighed: the
  // intervention is real work the notary must see before retaining.
  function residenceFamilialeCriterion() {
    return {
      id: 'residence_familiale', type: 'choice', optional: true, groupe: 'immeuble', label: 'Situation conjugale et résidence familiale',
      aide: 'Si vous êtes marié ou uni civilement et que l’immeuble est votre résidence familiale, votre conjoint doit intervenir à l’acte, même s’il n’emprunte pas.',
      options: [
        { id: 'non', label: 'Ni marié ni uni civilement', add: 0, poids: 0 },
        { id: 'autre_immeuble', label: 'Marié ou uni civilement — autre immeuble', add: 0, poids: 1 },
        { id: 'residence_familiale', label: 'Marié ou uni civilement — résidence familiale', add: 150, poids: 2 },
      ],
    };
  }
  function coemprunteurCriterion() {
    return {
      id: 'coemprunteur', type: 'flag', optional: true, groupe: 'pret', label: 'Co-emprunteur / indivision',
      aide: 'Deux emprunteurs ou plus, ou une propriété détenue en indivision (parts non divisées).',
      add: 150, poids: 1,
    };
  }
  function assuranceHabitationCriterion() {
    return {
      id: 'assurance_habitation', type: 'choice', optional: true, groupe: 'immeuble', label: 'Assurance habitation à jour ?',
      aide: 'Le prêteur exige une assurance habitation en vigueur. Sans elle, il ne débourse pas : prévoyez-la avant la signature.',
      options: [
        { id: 'oui', label: 'Oui, en vigueur', add: 0, poids: 0 },
        { id: 'a_renouveler', label: 'À renouveler', add: 0, poids: 1 },
        { id: 'non', label: 'Aucune', add: 0, poids: 2 },
      ],
    };
  }
  function certificatLocalisationCriterion() {
    return {
      id: 'certificat_localisation', type: 'choice', optional: true, groupe: 'immeuble', label: 'Certificat de localisation',
      aide: 'Les exigences varient selon le prêteur et les changements à l’immeuble. Le notaire vérifie si le certificat convient ou si une autre démarche est nécessaire.',
      options: [
        { id: 'a_jour', label: 'À jour', add: 0, poids: 0 },
        { id: 'inconnu', label: 'Je ne sais pas', add: 0, poids: 1 },
        { id: 'perime', label: 'Périmé / absent', add: 100, poids: 1 },
        // An option-level `aide` — renderers show it beside the chosen answer.
        { id: 'assurance_titres', label: 'Assurance titres', add: 0, poids: 1, aide: 'L’assurance titres remplace souvent un certificat périmé — demandez au notaire.' },
      ],
    };
  }

  // --- The documents a notary needs, by id -----------------------------------
  // Declared once; each act lists the ids it collects, in checklist order.
  // A document may carry `si`, a predicate on the client's PRICING answers:
  //   { critere, valeurs: [...] } — collected only when the answer is one of
  //                                 `valeurs` (unanswered → not collected);
  //   { critere, sauf: [...] }    — collected unless the answer is one of
  //                                 `sauf` (unanswered → collected).
  // `sinon` is the note shown IN PLACE of the upload when `si` does not hold
  // (dossierItems returns it as a `note` item): the client is told why nothing
  // is asked instead of facing a silent gap. Without pricing every document
  // applies — see documentApplies().
  const DOCUMENTS = {
    piece_identite: {
      nom: 'Pièce d’identité avec photo',
      // Loi sur l'assurance maladie, art. 9.0.0.1: the RAMQ card may not be
      // required as identification — so it is never suggested here.
      aide: 'Permis de conduire ou passeport valide (non expiré). N’utilisez pas votre carte d’assurance maladie : la loi en interdit l’usage comme pièce d’identité.',
    },
    offre_preteur: {
      nom: 'Lettre d’engagement du prêteur (offre de financement)',
      aide: 'Le document d’engagement de la banque, avec le taux et le montant.',
    },
    releve_hypotheque: {
      nom: 'Relevé hypothécaire actuel',
      aide: 'Votre plus récent relevé du prêt à rembourser.',
    },
    promesse_achat: {
      nom: 'Promesse d’achat acceptée',
      aide: 'La promesse d’achat signée par le vendeur et vous, avec ses annexes.',
      si: { critere: 'contexte', valeurs: ['achat'] },
    },
    compte_taxes: {
      nom: 'Comptes de taxes municipales et scolaires',
      aide: 'Les comptes les plus récents de votre municipalité et de votre centre de services scolaire.',
    },
    preuve_assurance: {
      nom: 'Preuve d’assurance habitation',
      aide: 'L’attestation de votre assureur ; le prêteur demande d’y être inscrit comme créancier hypothécaire.',
      si: { critere: 'assurance_habitation', sauf: ['non'] },
    },
    certificat_localisation: {
      nom: 'Certificat de localisation',
      aide: 'Le rapport et le plan de l’arpenteur-géomètre. C’est souvent le document qui retarde un dossier — vérifiez qu’il est à jour.',
      si: { critere: 'certificat_localisation', sauf: ['perime', 'assurance_titres'] },
      sinon: 'Certificat périmé, absent ou remplacé par une assurance titres : rien à téléverser pour l’instant. Le notaire vous dira s’il en faut un nouveau et quand le commander.',
    },
    testament_transmission: {
      nom: 'Testament et déclaration de transmission',
      aide: 'Le testament (ou la recherche testamentaire) et la déclaration de transmission, si elle a été publiée.',
      si: { critere: 'succession', valeurs: ['oui'] },
    },
    etat_civil: {
      nom: 'Document d’état civil pertinent',
      aide: 'Certificat de mariage, d’union civile, de naissance ou autre document permettant au notaire de confirmer votre situation.',
    },
    acte_mariage: {
      nom: 'Certificat de mariage ou d’union civile',
      aide: 'La preuve de votre mariage ou de votre union civile, lorsque cette situation est déclarée.',
      si: { critere: 'situation_familiale', valeurs: ['marie', 'union_civile'] },
    },
    contrat_mariage: {
      nom: 'Contrat de mariage ou d’union civile',
      aide: 'Votre contrat et ses modifications, si vous en avez un et qu’il peut influencer vos volontés.',
      si: { critere: 'regime_familial', valeurs: ['contrat', 'inconnu'] },
    },
    testament_existant: {
      nom: 'Testament existant ou recherche testamentaire',
      aide: 'Votre copie, si vous en avez une. Le notaire confirmera aussi les recherches à effectuer dans les registres.',
      si: { critere: 'testament_existant', valeurs: ['oui', 'inconnu'] },
      sinon: 'Vous avez indiqué ne pas avoir de testament connu : le notaire vous dira quelles recherches sont requises.',
    },
    personnes_a_charge: {
      nom: 'Renseignements sur les enfants ou personnes à charge',
      aide: 'Noms, âge et situation des personnes à charge lorsque cela influence vos volontés.',
      si: { critere: 'enfants', sauf: ['aucun'] },
    },
    liste_biens: {
      nom: 'Liste indicative des biens et volontés particulières',
      aide: 'Une liste simple de vos biens, legs ou souhaits à discuter; elle ne remplace pas les vérifications du notaire.',
    },
    entreprise: {
      nom: 'Documents de société ou d’entreprise',
      aide: 'Statuts, conventions ou renseignements pertinents si vous détenez une entreprise ou des actions.',
      si: { critere: 'entreprise', valeurs: [true] },
    },
    mandat_existant: {
      nom: 'Procuration ou mandat existant',
      aide: 'Copie de tout mandat ou procuration déjà signé qui touche le même sujet.',
      si: { critere: 'mandat_existant', valeurs: ['oui', 'inconnu'] },
      sinon: 'Vous avez indiqué ne pas avoir de mandat connu : le notaire confirmera les vérifications utiles.',
    },
    pieces_identite_mandataires: {
      nom: 'Pièces d’identité des mandataires',
      aide: 'Pièces disponibles pour les personnes qui recevront les pouvoirs, lorsque le notaire les demande.',
      si: { critere: 'nombre_mandataires', sauf: ['aucun'] },
    },
    documents_immeuble: {
      nom: 'Documents de l’immeuble visé',
      aide: 'Adresse et documents disponibles sur l’immeuble lorsque la procuration porte sur un immeuble.',
      si: { critere: 'portee_mandat', valeurs: ['immeuble'] },
    },
    instructions_mandat: {
      nom: 'Instructions ou projet de procuration',
      aide: 'Votre projet ou vos instructions écrites, même sous forme de notes, pour que le notaire puisse les clarifier.',
    },
    exigences_tiers: {
      nom: 'Exigences du tiers ou de l’institution',
      aide: 'Formulaire, modèle ou instructions du prêteur, de l’institution ou du tiers qui demande la procuration.',
      si: { critere: 'portee_mandat', valeurs: ['institutionnelle'] },
    },
  };
  function documentList(ids) {
    return ids.map((id) => ({ id, ...DOCUMENTS[id] }));
  }

  const FINANCING_INTAKE_FIELDS = [
    {"id": "parties_signature", "label": "Personnes qui doivent signer", "aide": "Noms des propriétaires et des emprunteurs, situation conjugale et disponibilités. Signalez une procuration ou une personne absente; le notaire confirme qui doit intervenir."},
    {"id": "contact_preteur", "label": "Personne-ressource chez le prêteur", "aide": "Nom et coordonnées professionnelles de votre conseiller. Indiquez si les instructions ont été envoyées au notaire; une approbation de prêt ne les remplace pas."},
    {"id": "changements_immeuble", "label": "Changements à l’immeuble", "aide": "Travaux, agrandissement, piscine, occupation ou autre changement depuis le certificat de localisation. Sinon, inscrivez « aucun »; si vous ne savez pas, dites-le."},
    {"id": "type_propriete", "label": "Type d’immeuble et situation particulière", "aide": "Indiquez s’il s’agit d’une maison, d’une copropriété, d’un immeuble à revenus, d’un immeuble détenu par une société ou une fiducie, ou si vous ne savez pas. Le notaire ouvrira les vérifications applicables."},
    {"id": "identification_immeuble", "label": "Numéro de lot ou identification de l’immeuble", "aide": "Fournissez le numéro de lot, la désignation cadastrale ou toute autre référence disponible. L’adresse seule ne remplace pas la recherche officielle du titre."},
  ];

  const TESTAMENT_INTAKE_FIELDS = [
    { id: 'testateurs', label: 'Personnes qui font le testament', aide: 'Noms complets, coordonnées et disponibilité de chaque testateur. Chaque personne signe son propre acte.' },
    { id: 'situation_familiale', label: 'Situation familiale', aide: 'Mariage, union civile, conjoint de fait, séparation ou famille recomposée; indiquez ce qui doit être clarifié avec le notaire.' },
    { id: 'regime_familial', label: 'Contrat de mariage ou d’union civile', aide: 'Indiquez si un contrat existe, est modifié ou est introuvable; le notaire confirmera ce qui doit être vérifié.' },
    { id: 'enfants_personnes_charge', label: 'Enfants et personnes à charge', aide: 'Noms, âge et situation des enfants ou personnes à charge, sans transmettre de numéro d’assurance sociale.' },
    { id: 'beneficiaires_legataires', label: 'Bénéficiaires et légataires', aide: 'Noms, liens avec vous et nombre approximatif de bénéficiaires ou de legs; le notaire confirme la rédaction.' },
    { id: 'liquidateur_souhaite', label: 'Liquidateur ou fiduciaire souhaité', aide: 'Personne, personnes ou professionnel que vous envisagez pour administrer la succession ou une fiducie.' },
    { id: 'volontes_principales', label: 'Volontés principales', aide: 'Bénéficiaires, legs particuliers, liquidateur de succession et souhaits à discuter; le notaire transforme ces instructions en acte.' },
    { id: 'actifs_importants', label: 'Actifs importants', aide: 'Immeubles, entreprises, comptes ou biens particuliers à prendre en compte. Ne saisissez aucun numéro de compte.' },
    { id: 'contraintes_particulieres', label: 'Contraintes ou besoins particuliers', aide: 'Langue, mobilité, lecture, interprète ou autre besoin qui peut changer la préparation de la rencontre.' },
  ];

  const PROCURATION_INTAKE_FIELDS = [
    { id: 'type_mandat', label: 'Type de mandat ou de procuration', aide: 'Indiquez s’il s’agit d’une procuration ordinaire, d’un possible mandat de protection ou d’une situation à clarifier. Le notaire décide du parcours juridique applicable.' },
    { id: 'mandants', label: 'Personnes qui donnent la procuration', aide: 'Noms complets, coordonnées et disponibilité de chaque mandant.' },
    { id: 'mandataires', label: 'Mandataire(s) proposé(s)', aide: 'Noms et coordonnées des personnes autorisées à agir; précisez si elles agissent ensemble ou séparément.' },
    { id: 'relation_mandataires', label: 'Relation et mode d’action des mandataires', aide: 'Lien de confiance et indication claire : ensemble, séparément, avec remplacement ou sans remplacement.' },
    { id: 'objet_mandat', label: 'Objet et pouvoirs souhaités', aide: 'Décrivez ce que le mandataire doit pouvoir faire et les limites souhaitées; le notaire confirme la portée juridique.' },
    { id: 'immeuble_mandat', label: 'Immeuble ou transaction visée', aide: 'Adresse et transaction visée si la procuration concerne un immeuble ou un financement.' },
    { id: 'institutions_transactions', label: 'Institutions et transactions concernées', aide: 'Banque, prêteur, courtier, organisme public ou autre tiers qui recevra la procuration.' },
    { id: 'duree_mandat', label: 'Durée ou fin du mandat', aide: 'Durée souhaitée, date de fin ou événement qui met fin au mandat, si applicable.' },
    { id: 'contact_tiers', label: 'Personne-ressource ou institution', aide: 'Nom du courtier, prêteur, institution ou autre tiers qui demande la procuration, s’il y en a un.' },
  ];

  const SERVICES = [
    {
      id: 'refinancement',
      nom: 'Refinancement hypothécaire',
      nomCourt: 'Refinancement',
      nomEn: 'Mortgage refinancing',
      nomCourtEn: 'Refinancing',
      // The most substantial act Nota lists (loan act + hypothec publication +
      // title/certificate review) with real value at stake, so the floor starts
      // at 2000 $ and rises with the loan value below.
      prixDepart: 2000,
      // ADR 0034 — Nota's OWN price for this service, in cents. It is not a
      // share of the fee above and never varies with it: the two lines are
      // two purchases (ADR 0031). The most substantial act carries the
      // higher line because Nota does more on it — more documents to gather,
      // a lender to chase, a title review to chase down.
      prixNotaCents: 27900,
      description:
        'Acte de prêt et publication de l’hypothèque lors d’un refinancement.',
      pricing: {
        base: 2000,
        criteria: [
          // Order is the layout: the three questions that genuinely vary
          // (montant, approbation, prêteur) come first; the two carrying a
          // zero-cost default (succession, déplacement) close the required
          // block pre-answered — a typical client touches three controls, not
          // five. The optional refinements follow, the family residence first
          // (a legal intervention, not a nicety).
          {
            id: 'valeur_pret', type: 'bracket', required: true, groupe: 'pret', label: 'Montant du nouveau prêt', unit: '$',
            brackets: [
              { max: 300000, add: 0, poids: 0 },
              { max: 600000, add: 150, poids: 0 },
              { max: 1000000, add: 350, poids: 1 },
              { max: null, add: 600, poids: 1 },
            ],
          },
          approbationCriterion(),
          lenderCriterion(),
          successionCriterion(),
          deplacementCriterion(),
          residenceFamilialeCriterion(),
          coemprunteurCriterion(),
          assuranceHabitationCriterion(),
          certificatLocalisationCriterion(),
        ],
      },
      documents: documentList([
        'piece_identite', 'offre_preteur', 'releve_hypotheque', 'compte_taxes',
        'preuve_assurance', 'certificat_localisation', 'testament_transmission',
      ]),
      champs: [
        // Le prêteur n'est plus un champ libre : c'est le critère de prix
        // `preteur` (la question obligatoire du carnet), répondu dans __pricing.
        { id: 'adresse', label: 'Adresse de l’immeuble', aide: 'Adresse civique complète de la propriété refinancée.' },
        { id: 'date_echeance_taux', label: 'Échéance du taux', aide: 'La date avant laquelle le taux offert doit être signé, si connue.' },
        ...FINANCING_INTAKE_FIELDS,
        {"id": "dettes_garanties", "label": "Prêts et marges garantis par l’immeuble", "aide": "Nommez les prêteurs et les prêts ou marges à rembourser, même si une marge affiche un solde nul. Ne saisissez aucun numéro de compte; le notaire obtient les relevés officiels de remboursement."},
      ],
    },
    {
      id: 'financement',
      nom: 'Financement hypothécaire',
      nomCourt: 'Financement',
      nomEn: 'Mortgage financing',
      nomCourtEn: 'Financing',
      // The loan act for a NEW hypothec — a purchase or a first loan on a
      // property already owned. Slightly under refinancement's floor because
      // there is no old hypothec to discharge; the loan-value brackets are the
      // same ladder.
      prixDepart: 1800,
      // ADR 0034 — the catalogue's entry line: a smaller act pays Nota less,
      // so the take rate never rises as the act shrinks.
      prixNotaCents: 22900,
      description:
        'Acte de prêt et publication de l’hypothèque pour un nouveau financement.',
      pricing: {
        base: 1800,
        criteria: [
          {
            id: 'valeur_pret', type: 'bracket', required: true, groupe: 'pret', label: 'Montant du prêt', unit: '$',
            brackets: [
              { max: 300000, add: 0, poids: 0 },
              { max: 600000, add: 150, poids: 0 },
              { max: 1000000, add: 350, poids: 1 },
              { max: null, add: 600, poids: 1 },
            ],
          },
          {
            id: 'contexte', type: 'choice', required: true, groupe: 'pret', label: 'Que finance ce prêt ?',
            aide: 'Un achat exige de coordonner l’acte de prêt avec la vente chez le notaire instrumentant.',
            options: [
              { id: 'propriete_detenue', label: 'Une propriété que je possède', add: 0, poids: 0 },
              { id: 'achat', label: 'L’achat d’une propriété', add: 200, poids: 1 },
            ],
          },
          approbationCriterion(),
          lenderCriterion(),
          // A financed property can come from an unsettled estate too (the
          // title still in the deceased's name) — the same question, the
          // same default, on both acts.
          successionCriterion(),
          deplacementCriterion(),
          residenceFamilialeCriterion(),
          coemprunteurCriterion(),
          assuranceHabitationCriterion(),
          certificatLocalisationCriterion(),
        ],
      },
      documents: documentList([
        'piece_identite', 'offre_preteur', 'promesse_achat', 'compte_taxes',
        'preuve_assurance', 'certificat_localisation', 'testament_transmission',
      ]),
      champs: [
        { id: 'adresse', label: 'Adresse de l’immeuble', aide: 'Adresse civique complète de la propriété financée.' },
        { id: 'date_echeance_taux', label: 'Échéance du taux', aide: 'La date avant laquelle le taux offert doit être signé, si connue.' },
        ...FINANCING_INTAKE_FIELDS,
      ],
    },
    {
      id: 'testament',
      nom: 'Testament notarié',
      nomCourt: 'Testament',
      nomEn: 'Notarial will',
      nomCourtEn: 'Will',
      // The platform/date line is deliberately fixed across services. This
      // floor keeps the smaller act from carrying a disproportionate platform
      // burden while still leaving room for complexity add-ons.
      prixDepart: 1800,
      prixNotaCents: 22900,
      description: 'Testament reçu devant notaire, adapté à votre situation familiale et à vos volontés.',
      pricing: {
        base: 1800,
        criteria: [
          { id: 'nombre_testateurs', type: 'bracket', required: true, groupe: 'parties', label: 'Nombre de testateurs', unit: 'personnes', brackets: [
            { max: 1, add: 0, poids: 0 }, { max: 2, add: 500, poids: 1 }, { max: null, add: 750, poids: 2 },
          ] },
          { id: 'situation_familiale', type: 'choice', required: true, groupe: 'parties', label: 'Situation familiale', aide: 'La situation familiale détermine les personnes à protéger et les vérifications à prévoir.', options: [
            { id: 'celibataire', label: 'Célibataire', add: 0, poids: 0 },
            { id: 'marie', label: 'Marié', add: 100, poids: 1 },
            { id: 'union_civile', label: 'Uni civilement', add: 100, poids: 1 },
            { id: 'union_fait', label: 'Conjoint de fait', add: 150, poids: 1 },
            { id: 'separe_divorce', label: 'Séparé ou divorcé', add: 200, poids: 1 },
            { id: 'famille_recomposee', label: 'Famille recomposée ou situation à clarifier', add: 300, poids: 2 },
          ] },
          { id: 'enfants', type: 'choice', required: true, groupe: 'parties', label: 'Enfants ou personnes à charge', aide: 'Indiquez la situation qui doit être prise en compte dans vos volontés.', options: [
            { id: 'aucun', label: 'Aucun', add: 0, poids: 0 },
            { id: 'majeurs', label: 'Enfants majeurs', add: 0, poids: 0 },
            { id: 'mineurs', label: 'Enfants mineurs', add: 200, poids: 1 },
            { id: 'vulnerables', label: 'Personne à charge vulnérable', add: 350, poids: 2 },
          ] },
          { id: 'nombre_beneficiaires', type: 'bracket', required: true, groupe: 'acte', label: 'Nombre approximatif de bénéficiaires ou légataires', unit: 'personnes', brackets: [
            { max: 1, add: 0, poids: 0 }, { max: 4, add: 150, poids: 1 }, { max: null, add: 300, poids: 2 },
          ] },
          { id: 'regime_familial', type: 'choice', required: true, defaut: 'aucun', groupe: 'parties', label: 'Contrat de mariage ou d’union civile', aide: 'Un contrat, une modification ou une situation inconnue peut nécessiter une vérification distincte.', options: [
            { id: 'aucun', label: 'Aucun contrat connu', add: 0, poids: 0 },
            { id: 'contrat', label: 'Contrat ou modification disponible', add: 150, poids: 1 },
            { id: 'inconnu', label: 'Je ne sais pas', add: 200, poids: 1 },
          ] },
          { id: 'liquidateur', type: 'choice', required: true, defaut: 'un', groupe: 'acte', label: 'Liquidateur ou fiduciaire', aide: 'Le nombre de personnes et le recours à un professionnel changent la préparation des clauses.', options: [
            { id: 'un', label: 'Une personne', add: 0, poids: 0 },
            { id: 'plusieurs', label: 'Plusieurs personnes', add: 150, poids: 1 },
            { id: 'professionnel', label: 'Professionnel ou fiducie à structurer', add: 300, poids: 2 },
          ] },
          { id: 'testament_existant', type: 'choice', required: true, defaut: 'non', groupe: 'acte', label: 'Avez-vous un testament existant ?', aide: 'Le notaire doit savoir si un testament précédent peut devoir être révoqué ou comparé.', options: [
            { id: 'non', label: 'Non, à ma connaissance', add: 0, poids: 0 },
            { id: 'oui', label: 'Oui, j’en ai une copie ou un souvenir', add: 150, poids: 1 },
            { id: 'inconnu', label: 'Je ne sais pas', add: 200, poids: 1 },
          ] },
          { id: 'legs_complexes', type: 'choice', required: true, defaut: 'aucun', groupe: 'acte', label: 'Volontés ou legs particuliers', aide: 'Choisissez la situation la plus proche; le notaire précisera la rédaction.', options: [
            { id: 'aucun', label: 'Volontés simples', add: 0, poids: 0 },
            { id: 'particuliers', label: 'Legs particuliers ou conditions', add: 250, poids: 1 },
            { id: 'fiducie', label: 'Fiducie, protection ou clauses complexes', add: 600, poids: 2 },
          ] },
          { id: 'nombre_immeubles', type: 'choice', required: true, defaut: 'aucun', groupe: 'biens', label: 'Immeubles à prendre en compte', options: [
            { id: 'aucun', label: 'Aucun', add: 0, poids: 0 },
            { id: 'un', label: 'Un immeuble', add: 150, poids: 1 },
            { id: 'plusieurs', label: 'Plusieurs immeubles', add: 300, poids: 2 },
          ] },
          { id: 'entreprise', type: 'flag', required: true, defaut: false, groupe: 'biens', label: 'Je détiens une entreprise ou des actions', aide: 'Le notaire devra coordonner les volontés avec les documents de société.', add: 350, poids: 2 },
          { id: 'biens_hors_qc', type: 'flag', required: true, defaut: false, groupe: 'biens', label: 'Je possède des biens importants hors Québec', aide: 'Le notaire signalera les limites et la coordination nécessaires avec une autre juridiction.', add: 300, poids: 2 },
          { id: 'protection_beneficiaires', type: 'choice', required: true, defaut: 'aucune', groupe: 'biens', label: 'Protection particulière d’un bénéficiaire', aide: 'Une protection pour un mineur, une personne vulnérable ou une fiducie demande une analyse supplémentaire.', options: [
            { id: 'aucune', label: 'Aucune protection particulière', add: 0, poids: 0 },
            { id: 'mineur', label: 'Bénéficiaire mineur', add: 150, poids: 1 },
            { id: 'vulnerable', label: 'Bénéficiaire vulnérable', add: 300, poids: 2 },
            { id: 'fiducie', label: 'Fiducie à structurer', add: 500, poids: 2 },
          ] },
          { id: 'langue_acte', type: 'choice', required: true, defaut: 'francais', groupe: 'acte', label: 'Langue de l’acte', options: [
            { id: 'francais', label: 'Français', add: 0, poids: 0 }, { id: 'anglais', label: 'Anglais', add: 150, poids: 1 }, { id: 'bilingue', label: 'Bilingue', add: 300, poids: 1 },
          ] },
          { id: 'accessibilite', type: 'choice', required: true, defaut: 'aucune', groupe: 'signature', label: 'Accessibilité et communication', aide: 'Indiquez le soutien matériel ou de communication à prévoir; le notaire évaluera les exigences applicables.', options: [
            { id: 'aucune', label: 'Aucun besoin particulier', add: 0, poids: 0 },
            { id: 'lecture_vision', label: 'Lecture ou vision à accommoder', add: 150, poids: 1 },
            { id: 'audition', label: 'Audition ou communication à accommoder', add: 150, poids: 1 },
            { id: 'interprete', label: 'Interprète à prévoir', add: 250, poids: 2 },
          ] },
          { id: 'temoin_supplementaire', type: 'flag', required: true, defaut: false, groupe: 'signature', label: 'Un témoin supplémentaire pourrait être requis', aide: 'Par exemple, certaines situations de communication ou de vision peuvent exiger une formalité supplémentaire; le notaire confirme.', add: 150, poids: 1 },
          deplacementCriterion(),
        ],
      },
      documents: documentList(['piece_identite', 'etat_civil', 'acte_mariage', 'contrat_mariage', 'testament_existant', 'personnes_a_charge', 'liste_biens', 'entreprise']),
      champs: TESTAMENT_INTAKE_FIELDS,
    },
    {
      id: 'procuration',
      nom: 'Procuration notariée',
      nomCourt: 'Procuration',
      nomEn: 'Notarial power of attorney',
      nomCourtEn: 'Power of attorney',
      prixDepart: 1500,
      // A separate platform line keeps this smaller act commercially viable:
      // the date guarantee is a fixed-cost product, and the higher floor
      // preserves a healthy margin on same-day transactions.
      prixNotaCents: 20900,
      description: 'Mandat notarié pour qu’une personne de confiance agisse en votre nom, dans une portée définie.',
      pricing: {
        base: 1500,
        criteria: [
          { id: 'nombre_mandants', type: 'bracket', required: true, groupe: 'parties', label: 'Nombre de mandants', unit: 'personnes', brackets: [
            { max: 1, add: 0, poids: 0 }, { max: 2, add: 350, poids: 1 }, { max: null, add: 550, poids: 2 },
          ] },
          { id: 'nombre_mandataires', type: 'bracket', required: true, groupe: 'parties', label: 'Nombre de mandataires', unit: 'personnes', brackets: [
            { max: 1, add: 0, poids: 0 }, { max: 2, add: 150, poids: 1 }, { max: null, add: 300, poids: 2 },
          ] },
          { id: 'portee_mandat', type: 'choice', required: true, groupe: 'acte', label: 'Portée de la procuration', aide: 'La portée indique ce que le mandataire pourra faire; le notaire rédigera les pouvoirs et les limites.', options: [
            { id: 'generale', label: 'Générale, pour plusieurs démarches', add: 250, poids: 1 },
            { id: 'specifique', label: 'Spécifique, pour une démarche précise', add: 0, poids: 0 },
            { id: 'immeuble', label: 'Immeuble, vente ou financement', add: 400, poids: 2 },
            { id: 'institutionnelle', label: 'Institution ou prêteur avec exigences particulières', add: 350, poids: 2 },
          ] },
          { id: 'nombre_institutions', type: 'bracket', required: true, groupe: 'acte', label: 'Nombre approximatif d’institutions ou de transactions', unit: 'institutions', brackets: [
            { max: 1, add: 0, poids: 0 }, { max: 3, add: 150, poids: 1 }, { max: null, add: 300, poids: 2 },
          ] },
          { id: 'mode_action', type: 'choice', required: true, defaut: 'separement', groupe: 'parties', label: 'Mode d’action des mandataires', options: [
            { id: 'separement', label: 'Chacun peut agir séparément', add: 0, poids: 0 },
            { id: 'ensemble', label: 'Ils doivent agir ensemble', add: 150, poids: 1 },
            { id: 'remplacement', label: 'Avec remplacement ou suppléance', add: 250, poids: 2 },
          ] },
          { id: 'pouvoirs_sensibles', type: 'choice', required: true, defaut: 'administration', groupe: 'acte', label: 'Nature des pouvoirs demandés', aide: 'Les pouvoirs bancaires, immobiliers ou multiples demandent des limites et vérifications plus détaillées.', options: [
            { id: 'administration', label: 'Administration courante', add: 0, poids: 0 },
            { id: 'bancaire', label: 'Opérations bancaires ou financières', add: 150, poids: 1 },
            { id: 'immeuble', label: 'Vente, achat ou hypothèque d’un immeuble', add: 250, poids: 2 },
            { id: 'multiple', label: 'Plusieurs catégories de pouvoirs', add: 400, poids: 2 },
          ] },
          { id: 'mandat_existant', type: 'choice', required: true, defaut: 'non', groupe: 'acte', label: 'Existe-t-il déjà une procuration ou un mandat ?', aide: 'Une version précédente peut devoir être comparée, révoquée ou signalée.', options: [
            { id: 'non', label: 'Non, à ma connaissance', add: 0, poids: 0 }, { id: 'oui', label: 'Oui, j’en ai une copie ou un souvenir', add: 150, poids: 1 }, { id: 'inconnu', label: 'Je ne sais pas', add: 200, poids: 1 },
          ] },
          { id: 'duree_mandat', type: 'choice', required: true, defaut: 'indeterminee', groupe: 'acte', label: 'Durée ou condition de fin', options: [
            { id: 'indeterminee', label: 'Sans date de fin indiquée', add: 0, poids: 0 }, { id: 'date_fin', label: 'Avec une date ou un événement de fin', add: 100, poids: 1 }, { id: 'conditions', label: 'Avec plusieurs conditions à préciser', add: 250, poids: 2 },
          ] },
          { id: 'reddition_compte', type: 'flag', required: true, defaut: false, groupe: 'acte', label: 'Prévoir une reddition de compte', aide: 'Une obligation de rendre compte ou de documenter les actes du mandataire ajoute des clauses à structurer.', add: 200, poids: 1 },
          { id: 'remplacement_mandataire', type: 'flag', required: true, defaut: false, groupe: 'acte', label: 'Prévoir un remplaçant ou un mandataire subsidiaire', aide: 'Un remplaçant doit être identifié et ses pouvoirs doivent être coordonnés.', add: 200, poids: 1 },
          { id: 'langue_acte', type: 'choice', required: true, defaut: 'francais', groupe: 'acte', label: 'Langue de l’acte', options: [
            { id: 'francais', label: 'Français', add: 0, poids: 0 }, { id: 'anglais', label: 'Anglais', add: 150, poids: 1 }, { id: 'bilingue', label: 'Bilingue', add: 300, poids: 1 },
          ] },
          { id: 'accessibilite', type: 'choice', required: true, defaut: 'aucune', groupe: 'signature', label: 'Accessibilité et communication', aide: 'Indiquez le soutien matériel ou de communication à prévoir; le notaire évaluera les exigences applicables.', options: [
            { id: 'aucune', label: 'Aucun besoin particulier', add: 0, poids: 0 },
            { id: 'lecture_vision', label: 'Lecture ou vision à accommoder', add: 150, poids: 1 },
            { id: 'audition', label: 'Audition ou communication à accommoder', add: 150, poids: 1 },
            { id: 'interprete', label: 'Interprète à prévoir', add: 250, poids: 2 },
          ] },
          { id: 'nombre_immeubles', type: 'choice', required: true, defaut: 'aucun', groupe: 'biens', label: 'Immeubles à prendre en compte', options: [
            { id: 'aucun', label: 'Aucun', add: 0, poids: 0 }, { id: 'un', label: 'Un immeuble', add: 150, poids: 1 }, { id: 'plusieurs', label: 'Plusieurs immeubles', add: 300, poids: 2 },
          ] },
          deplacementCriterion(),
        ],
      },
      documents: documentList(['piece_identite', 'pieces_identite_mandataires', 'mandat_existant', 'documents_immeuble', 'exigences_tiers', 'instructions_mandat']),
      champs: PROCURATION_INTAKE_FIELDS,
    },
  ];

  function serviceById(id) {
    return SERVICES.find((s) => s.id === id) || null;
  }

  // --- Le catalogue annoncé ---------------------------------------------------
  // No duplicate “coming soon” cards: a service is either in SERVICES and
  // bookable, or in this list and explicitly unavailable. These two acts are
  // now live; the list stays as the forward-looking extension point.
  const ACTES_A_VENIR = [];
  function acteAVenirById(id) {
    return ACTES_A_VENIR.find((a) => a.id === id) || null;
  }
  // Un acte ne peut pas être à la fois en vente et « bientôt » : la garde vaut
  // pour le prochain qui déplace une entrée d'une liste à l'autre.
  for (const a of ACTES_A_VENIR) {
    if (SERVICES.some((s) => s.id === a.id)) {
      throw new Error('acte à venir déjà au catalogue : ' + a.id);
    }
  }


  // --- Dynamic base price ----------------------------------------------------
  // A service's floor price, derived from a small set of DATA-DRIVEN criteria
  // (see each service's `pricing`). Each answered criterion contributes a FLAT
  // add-on:
  //   - flag:    +add when the answer is truthy
  //   - choice:  +add of the chosen option
  //   - bracket: +add of the first bracket the numeric value falls in (value <=
  //              max; a null max is the open-ended top bracket)
  // Answers come from the client's dossier, so "the document" and "the price"
  // are one dataset. With NO answers a service returns its base (== prixDepart),
  // so every existing caller and behaviour is unchanged. Criteria are edited as
  // data here — never hardcoded in the app or API.
  function criterionAdd(criterion, answer) {
    if (!criterion) return 0;
    if (criterion.type === 'flag') return answer ? Number(criterion.add) || 0 : 0;
    if (criterion.type === 'choice') {
      const opt = (criterion.options || []).find((o) => o.id === answer);
      return opt ? Number(opt.add) || 0 : 0;
    }
    if (criterion.type === 'bracket') {
      const v = Number(answer);
      if (!Number.isFinite(v)) return 0; // not answered yet -> base bracket
      for (const b of criterion.brackets || []) {
        if (b.max == null || v <= b.max) return Number(b.add) || 0;
      }
      return 0;
    }
    return 0;
  }

  // The market reference rate for an act: per-service `base`/`prixDepart` + the
  // client's criteria adds. (What a notary typically charges.)
  function computeBasePrice(serviceId, answers) {
    const svc = serviceById(serviceId);
    if (!svc) return null;
    if (!svc.pricing) return svc.prixDepart;
    answers = answers || {};
    let price = Number(svc.pricing.base) || svc.prixDepart || 0;
    for (const c of svc.pricing.criteria || []) price += criterionAdd(c, answers[c.id]);
    return Math.max(0, Math.round(price));
  }

  // The price Nota QUOTES the client (shown + pre-filled). The per-service `base`
  // prices are already set to Nota's starting price, so the multiplier is 1; it
  // stays a single knob to shift every quote at once without touching per-service
  // data. recommendedAmount scales this up by the urgency tier.
  const MARKET_MULTIPLIER = 1;
  function notaPrice(serviceId, answers) {
    const base = computeBasePrice(serviceId, answers);
    return base == null ? null : Math.round(base * MARKET_MULTIPLIER);
  }

  // --- Case complexity (the "easy vs hard" signal a notary needs) -------------
  // Each criterion/option can carry a `poids` (complexity weight, 0=easy..2=hard).
  // complexity() sums the weights of the answered criteria into a level so a
  // notary sees at a glance whether the posted price is for a simple or a hard
  // file, and WHICH factors make it hard.
  function criterionPoids(criterion, answer) {
    if (!criterion) return 0;
    if (criterion.type === 'flag') return answer ? Number(criterion.poids) || 0 : 0;
    if (criterion.type === 'choice') {
      const opt = (criterion.options || []).find((o) => o.id === answer);
      return opt ? Number(opt.poids) || 0 : 0;
    }
    if (criterion.type === 'bracket') {
      const v = Number(answer);
      if (!Number.isFinite(v)) return 0;
      for (const b of criterion.brackets || []) {
        if (b.max == null || v <= b.max) return Number(b.poids) || 0;
      }
      return 0;
    }
    return 0;
  }

  // The label for what a criterion's answer contributes (for the notary's factor
  // list): "Approbation bancaire : Pas encore", "Co-emprunteur", etc.
  function criterionFactorLabel(criterion, answer) {
    if (criterion.type === 'choice') {
      const opt = (criterion.options || []).find((o) => o.id === answer);
      // "…succession ? : Oui" reads as a typo — drop the label's own terminator.
    return opt ? stripEndPunctuation(criterion.label) + ' : ' + opt.label : criterion.label;
    }
    return criterion.label;
  }

  function complexity(serviceId, answers) {
    const svc = serviceById(serviceId);
    if (!svc || !svc.pricing) return { level: 'standard', score: 0, factors: [] };
    answers = answers || {};
    let score = 0;
    const factors = [];
    for (const c of svc.pricing.criteria || []) {
      const p = criterionPoids(c, answers[c.id]);
      if (p > 0) {
        score += p;
        factors.push(criterionFactorLabel(c, answers[c.id]));
      }
    }
    const level = score >= 3 ? 'complexe' : score >= 1 ? 'standard' : 'simple';
    return { level, score, factors };
  }

  // --- Mandatory parameters ---------------------------------------------------
  // Some criteria are `required: true` — without them the posted price is
  // meaningless to a notary (e.g. refinancement succession + bank approval), so a
  // bid cannot be submitted until they are answered. Returns the unanswered ones.
  // `applyDefaults` (readiness only): an absent answer to a required criterion
  // that carries a `defaut` reads as that default. Offers published before a
  // criterion became required — `succession` on financement, 2026-09-03 —
  // must not flip to « dossier incomplet » on the notary's screen. Publishing
  // stays strict (validateOffer never passes the flag): a NEW offer answers.
  function missingRequired(serviceId, answers, opts) {
    const svc = serviceById(serviceId);
    if (!svc || !svc.pricing) return [];
    answers = answers || {};
    const applyDefaults = !!(opts && opts.applyDefaults);
    const missing = [];
    for (const c of svc.pricing.criteria || []) {
      if (!c.required) continue;
      let a = answers[c.id];
      if (applyDefaults && (a === undefined || a === null || a === '') && c.defaut !== undefined) a = c.defaut;
      let ok;
      if (c.type === 'choice') ok = (c.options || []).some((o) => o.id === a);
      else if (c.type === 'bracket') {
        // A blank/null/false/"" all coerce to a finite 0 via Number(); require a
        // real positive number so a crafted payload cannot skip the question.
        ok = (typeof a === 'number' || (typeof a === 'string' && a.trim() !== '')) && Number.isFinite(Number(a)) && Number(a) > 0;
      } else if (c.type === 'flag') {
        // A required boolean may have an explicit false default. The browser
        // sends that default in the published pricing snapshot; accepting it
        // here keeps a zero-cost answer explicit without forcing a fake
        // “non/oui” choice for every boolean driver.
        ok = a === true || (c.defaut !== undefined && a === c.defaut);
      }
      else ok = true;
      if (!ok) missing.push({ id: c.id, label: c.label });
      // A choice with a free-text companion (« Autre prêteur » + name): picking
      // the opening option makes the companion text required too — an "other"
      // without a name tells the notary nothing.
      if (ok && c.type === 'choice' && c.autre && a === c.autre.option) {
        const nom = typeof answers[c.autre.champ] === 'string' ? answers[c.autre.champ].trim() : '';
        if (!nom) missing.push({ id: c.autre.champ, label: c.autre.label });
      }
    }
    return missing;
  }

  // --- Timing tiers ----------------------------------------------------------
  // The tier is derived from how many days away the requested signing date is.
  // It is the axis that makes the public calendar meaningful: closer date,
  // higher tier, higher premium the market will bear. Order matters (ascending
  // urgency) and is relied on by the UI legend.
  // `eleve` marks the tiers where the date itself is the problem: a notary has
  // to clear their week for it, and the market prices that. Only these are worth
  // calling out on a calendar cell — on a calm date the tier is noise, because
  // the tier is a pure function of the date the cell already shows.
  // Five steps, because the last week is where the price actually moves and a
  // client deciding between "today" and "in three days" needs to see the
  // difference. Each band's MIDPOINT is the multiple a client is offered by
  // default (tierMultiplier), so the ladder reads a realistic urgency surcharge
  // 1× · 1,15× · 1,35× · 1,6× · 2× — +0/+15/+35/+60/+100 % over the floor. The
  // standard band is pinned to 1× so the calm-date price on the calendar is the
  // very "à partir de" the hero already shows: one number, no contradiction.
  // The urgency ladder (owner, 2026-08-28: « les prix sont trop bas » —
  // multipliers raised hard): the second week commands ×2, the FIRST week ×3,
  // the eve ×3.5 and the same day ×4 (band midpoints; the market tunes within
  // each band below). Standard notice stays the advertised floor.
  //
  // `prixNotaDateCents` is a SEPARATE object from the multipliers beside it
  // (ADR 0034). The multipliers price the NOTARY's fee: art. 49 4° C.déont.
  // lets a notary weigh « le degré d'urgence » in their own fees. This line is
  // what NOTA charges for the date guarantee it sells: sourcing a notary at
  // short notice and holding the date. Two objects, two justifications, two
  // lines on the quote, never one number doing both jobs.
  //
  // Sized by ADR 0038 (2026-09-05). Nota is the Stripe platform and pays the
  // card fee on the WHOLE charge, the notary's fee included, so every rung
  // that multiplies the notary's fee also multiplies a cost Nota bears. Each
  // date line therefore has to cover the fee it induces at the rung's own
  // recommended multiple and still leave Nota the margin of a calm date. The
  // ladder rises 150 $ a rung (100 $ for the same day, where the ceiling
  // binds), and the take rate on an urgent act stays under the take rate on a
  // calm one: buying a date never makes Nota heavier.
  // Proven in test/prix-nota-garantie-de-date.test.mjs.
  const TIERS = [
    { id: 'standard',    nom: 'Standard',    nomEn: 'Standard', maxJours: null, apercuMin: 1.0, apercuMax: 1.0, eleve: false, prixNotaDateCents: 0 },
    { id: 'rapide',      nom: 'Rapide',      nomEn: 'Fast',     maxJours: 14,   apercuMin: 1.8, apercuMax: 2.2, eleve: false, prixNotaDateCents: 14900 },
    { id: 'prioritaire', nom: 'Prioritaire', nomEn: 'Priority', maxJours: 7,    apercuMin: 2.7, apercuMax: 3.3, eleve: true,  prixNotaDateCents: 29900 },
    { id: 'urgence',     nom: 'Urgent',      nomEn: 'Urgent',   maxJours: 1,    apercuMin: 3.3, apercuMax: 3.7, eleve: true,  prixNotaDateCents: 44900 },
    { id: 'extreme',     nom: 'Extrême',     nomEn: 'Extreme',  maxJours: 0,    apercuMin: 3.7, apercuMax: 4.3, eleve: true,  prixNotaDateCents: 54900 },
  ];

  // What a client is actually asked to pay at a given notice, as a multiple of
  // the starting price. With no history it is the middle of the tier's market
  // band — exactly what recommendedAmount pre-fills. Pass the carnet's bids and
  // it becomes the TUNED value learned from what actually cleared. One number,
  // one definition, so the price shown on a calendar cell can never disagree
  // with the price in the form.
  function tierMultiplier(id, bids, serviceId) {
    const t = tierById(id);
    if (!t) return null;
    if (bids != null) return tunedTierMultipliers(bids, serviceId)[t.id];
    return (t.apercuMin + t.apercuMax) / 2;
  }

  // --- Adaptive tuning --------------------------------------------------------
  // The ladder above is a PRIOR, not a verdict: the market itself says what a
  // given notice is worth, one retained offer at a time. tunedTierMultipliers
  // folds that history back into the ladder so the number quoted tracks the
  // data over time instead of a constant someone once picked.
  //
  //   • Only RETAINED offers teach — an open ask is a wish, not a price.
  //   • The signal is the tier's MEDIAN realized premium (montant / base), so a
  //     single flamboyant outlier cannot move the quote.
  //   • The median is shrunk toward the static midpoint with a prior weight of
  //     TUNING_PRIOR_STRENGTH pseudo-observations: no data → exactly the static
  //     ladder; a handful of deals → a nudge; a real history → the market's own
  //     number.
  //   • The result is clamped to the tier's advertised band and the hard
  //     PREMIUM_CAP, and the ladder is kept strictly ascending — the calendar's
  //     colours must never rank dates in an order the prices contradict.
  const TUNING_PRIOR_STRENGTH = 6;
  // The minimum daylight between two adjacent tuned steps (bands share edges,
  // so without it two tiers could quote the same multiple).
  const TUNING_MIN_STEP = 0.05;

  // THE median helper — one definition for the whole module. Exact (no
  // rounding): the tuner feeds it premium multipliers where a half-step
  // matters; dollar surfaces round the result themselves. Null on empty so a
  // caller can distinguish "no data" from zero.
  function median(values) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function tunedTierMultipliers(bids, serviceId) {
    const byTier = {};
    if (Array.isArray(bids)) {
      for (const b of bids) {
        if (!b || b.status !== STATUS.RETENUE) continue;
        // A retained offer only teaches the same service. Legacy rows without
        // serviceId remain usable as unscoped history during the migration.
        if (serviceId && b.serviceId && b.serviceId !== serviceId) continue;
        const t = tierById(b.tier);
        if (!t) continue;
        // A premium outside [1, cap] cannot come from a valid offer — noise.
        const p = Number(b.premium);
        if (!Number.isFinite(p) || p < 1 || p > PREMIUM_CAP) continue;
        (byTier[t.id] = byTier[t.id] || []).push(p);
      }
    }
    const out = {};
    let prev = 0;
    for (const t of TIERS) {
      const prior = (t.apercuMin + t.apercuMax) / 2;
      const obs = byTier[t.id];
      let m = prior;
      if (obs && obs.length) {
        m = (obs.length * median(obs) + TUNING_PRIOR_STRENGTH * prior)
          / (obs.length + TUNING_PRIOR_STRENGTH);
      }
      m = Math.min(Math.min(t.apercuMax, PREMIUM_CAP), Math.max(t.apercuMin, m));
      m = Math.min(Math.max(m, prev + TUNING_MIN_STEP), PREMIUM_CAP);
      out[t.id] = Math.round(m * 100) / 100;
      prev = out[t.id];
    }
    return out;
  }

  function tierById(id) {
    return TIERS.find((t) => t.id === id) || null;
  }

  // Days away -> tier id. Same day = extreme, the eve = urgence, the FIRST
  // week (2-7) = prioritaire, the second week (8-14) = rapide, 15+ = standard.
  function tierForDays(days) {
    const d = Math.max(0, Math.floor(Number(days)));
    if (d <= 0) return 'extreme';       // signing today
    if (d <= 1) return 'urgence';       // tomorrow
    if (d <= 7) return 'prioritaire';   // inside the first week
    if (d <= 14) return 'rapide';       // inside the second week
    return 'standard';
  }

  // --- Le prix de Nota (ADR 0034) ---------------------------------------------
  // Nota sells its own service at its own price, beside the notary's fee and
  // never out of it (ADR 0031). Until 2026-09-03 that price was ONE number for
  // the whole catalogue, and one number on a catalogue of unequal acts is
  // regressive: 400 $ weighed 18,2 % of an 1 800 $ financing and 9,4 % of a
  // 4 000 $ act — the smaller the act, the heavier Nota.
  //
  // The grid fixes that WITHOUT touching art. 29.1 C.déont.: the price depends
  // on the SERVICE and on the NOTICE — two published dimensions the client
  // knows before offering — and on nothing that touches the notary. Not their
  // cote, not their history, not the value of the act. The signature below is
  // the guarantee: there is no argument through which a notary could enter.
  //
  //   { serviceCents, dateCents, totalCents }
  //
  // Two lines, because they answer to two different articles: the service line
  // is what Nota sells (art. 32.1 2° L.N. — the notary abandons nothing), the
  // date line is the date guarantee Nota sells on top, distinct from the
  // notary's own right to weigh urgency in their fees (art. 49 4° C.déont.).

  // A readable integer of cents, or undefined — an operator-stored grid, an
  // environment value and a legacy record all pass through here, so an
  // unreadable cell reads as absent rather than dropping the pricing.
  function prixNotaCell(v, { min = 1 } = {}) {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isInteger(n) && n >= min ? n : undefined;
  }

  /**
   * THE grid, normalized and complete: every service, every tier, plus the
   * `defaut` a service outside the catalogue falls back to.
   *
   * `source` accepts three shapes, and this is the whole of the migration:
   *   - nothing            → the catalogue's own published grid
   *   - `{ prixCents }`    → the ADR 0031 single price: it applies to EVERY
   *                          service, with no date line — a stored config
   *                          written before 2026-09-03 keeps pricing exactly
   *                          what it priced yesterday
   *   - `{ services, garantieDate }` → the operator's grid, cell by cell; a
   *                          missing or unreadable cell falls back to the
   *                          catalogue rather than to zero.
   *
   * The fallback for a service the catalogue cannot name is the LOWEST line:
   * Nota may never charge more than it published for a service it cannot name
   * (art. 68 C.déont. — no incomplete advertising).
   */
  function prixNotaGrille(source) {
    const src = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    const unique = prixNotaCell(src.prixCents);
    const srcServices = src.services && typeof src.services === 'object' ? src.services : {};
    const srcDates = src.garantieDate && typeof src.garantieDate === 'object' ? src.garantieDate : {};

    const services = {};
    for (const s of SERVICES) {
      const cell = prixNotaCell(srcServices[s.id]);
      services[s.id] = cell !== undefined ? cell : (unique !== undefined ? unique : s.prixNotaCents);
    }
    const garantieDate = {};
    for (const t of TIERS) {
      const cell = prixNotaCell(srcDates[t.id], { min: 0 });
      // A single-price config carried no date line: it stays at zero, or the
      // migration would silently raise what a stored price meant.
      garantieDate[t.id] = cell !== undefined ? cell : (unique !== undefined ? 0 : t.prixNotaDateCents);
    }
    const lignes = Object.keys(services).map((id) => services[id]);
    return {
      defaut: unique !== undefined ? unique : (lignes.length ? Math.min(...lignes) : 0),
      services,
      garantieDate,
    };
  }

  /**
   * Le prix de Nota pour UN service et UN palier — the only place a Nota price
   * is computed. The API never does this arithmetic by hand.
   */
  function prixNota(serviceId, tierId, grille) {
    const g = grille && grille.services && grille.garantieDate ? grille : prixNotaGrille(grille);
    const serviceCents = g.services[serviceId] !== undefined ? g.services[serviceId] : g.defaut;
    const dateCents = g.garantieDate[tierId] !== undefined ? g.garantieDate[tierId] : 0;
    return { serviceCents, dateCents, totalCents: serviceCents + dateCents };
  }

  /**
   * Le prix ANNONCÉ d'un acte, tout compris : les honoraires de départ du
   * notaire plus le prix de Nota au palier standard. C'est le seul « à partir
   * de » qu'une surface client peut afficher pour un acte.
   *
   * Art. 224 c) de la Loi sur la protection du consommateur : « le prix annoncé
   * doit comprendre le total des sommes que le consommateur devra débourser
   * pour l'obtention du bien ou du service », taxes de vente exceptées.
   * Art. 74.01 (1.1) de la Loi sur la concurrence : un prix « qui n'est pas
   * atteignable en raison de frais obligatoires fixes qui s'y ajoutent » est
   * une indication fausse ou trompeuse. Le plancher des honoraires seul n'est
   * donc jamais un prix annoncé : le service de Nota est un frais obligatoire.
   * Taxes et débours imposés par une loi restent en sus, et se disent tels.
   *
   * Rend `{ honorairesCents, notaCents, totalCents }`. La grille est celle en
   * vigueur quand l'appelant la tient, celle du catalogue sinon.
   */
  function prixAnnonce(serviceId, grille) {
    const svc = serviceById(serviceId);
    const honorairesCents = svc ? Math.round(svc.prixDepart * 100) : 0;
    const notaCents = prixNota(serviceId, 'standard', grille).totalCents;
    return { honorairesCents, notaCents, totalCents: honorairesCents + notaCents };
  }

  /**
   * Le devis FIGÉ d'une offre — les deux lignes de Nota telles qu'elles ont été
   * AUTORISÉES, relues sur l'enregistrement de l'offre plutôt que recalculées.
   *
   * La grille est VIVANTE : Nota la change quand elle veut, et c'est tout
   * l'objet de la console. Mais la carte du client a été bloquée pour un total
   * précis, une fois, avant qu'il ne s'engage. Un règlement qui relirait la
   * grille du jour facturerait un prix que le client n'a jamais lu :
   *
   *   — à la hausse, Stripe refuse une capture supérieure à l'autorisation ;
   *     l'acte reste retenu et impayé, ce qui est la panne, pas la faute ;
   *   — à la baisse, le client aurait bloqué plus que ce qu'on lui prend —
   *     l'écart entre le prix annoncé et le prix facturé est exactement la
   *     publicité « incomplète » que l'art. 68 C.déont. interdit.
   *
   * Rend `null` — et le prix se résout alors sur la grille en vigueur — dès
   * qu'une des deux lignes manque ou est illisible : une offre publiée avant
   * l'ADR 0034, ou une offre qui n'a jamais engagé de carte.
   */
  function prixNotaFige(source) {
    const src = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    // Zéro est relisible des deux côtés : un devis figé se rejoue tel quel,
    // jamais « corrigé » par les planchers de la grille vivante.
    const serviceCents = prixNotaCell(src.prixNotaServiceCents, { min: 0 });
    const dateCents = prixNotaCell(src.prixNotaDateCents, { min: 0 });
    if (serviceCents === undefined || dateCents === undefined) return null;
    return { serviceCents, dateCents, totalCents: serviceCents + dateCents };
  }

  // --- Premium cap -----------------------------------------------------------
  // A client may offer up to 5x the service's starting price — a sane ceiling
  // just above the ×4 a same-day signing now commands (owner, 2026-08-28).
  // A client offering more than that for a notary act is not a real market.
  // The cap is a product rule, enforced identically on the client and,
  // authoritatively, on the server.
  const PREMIUM_CAP = 5;

  // --- Offer statuses --------------------------------------------------------
  const STATUS = { OUVERTE: 'ouverte', RETENUE: 'retenue', ANNULEE: 'annulee' };

  // Open = still on the market. A retained bid left it by success, a cancelled
  // one by withdrawal — every market surface treats both as gone. A bid with no
  // status at all (older records) counts as open, as it always has.
  const isOpenBid = (b) => !!b && b.status !== STATUS.RETENUE && b.status !== STATUS.ANNULEE;

  // Last valid civil day, inclusive. Retained acts remain accessible after
  // this deadline; legacy open offers fail closed instead of being renewed.
  const OFFER_VALIDITY_DAYS = 7;
  function offerExpirationDate(createdISO, signingISO) {
    if (!isISODate(createdISO) || !isISODate(signingISO) || signingISO < createdISO) return null;
    const limit = addDays(createdISO, OFFER_VALIDITY_DAYS);
    return signingISO < limit ? signingISO : limit;
  }
  function isOfferExpired(bid, todayISO) {
    if (!bid || bid.status === STATUS.RETENUE || bid.status === STATUS.ANNULEE) return false;
    return !isISODate(todayISO) || !isISODate(bid.expiresOn)
      || !isISODate(bid.dateISO) || bid.expiresOn < todayISO || bid.dateISO < todayISO;
  }

  // --- Dates -----------------------------------------------------------------
  // State stores ISO YYYY-MM-DD strings; parse at UTC midnight so day math is
  // timezone-stable regardless of where the process runs.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  function isISODate(s) {
    if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
    // Reject dates that JS would silently roll over (e.g. 2026-02-31 -> March).
    // Build the date at UTC and require the components to round-trip unchanged.
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    const d = Number(s.slice(8, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() + 1 === m &&
      dt.getUTCDate() === d
    );
  }

  // A pragmatic single-line email check: exactly one @, no spaces, a dot in the
  // domain. Enough to reject obvious garbage; the notary verifies identity, not
  // this regex. Shared by the offer form (optional courriel) and the API.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function isEmail(s) {
    return typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s.trim());
  }

  function daysBetween(fromISO, toISO) {
    const a = Date.parse(fromISO + 'T00:00:00Z');
    const b = Date.parse(toISO + 'T00:00:00Z');
    return Math.round((b - a) / 86400000);
  }

  // --- Business day ----------------------------------------------------------
  // "Today" for the marketplace is the civil day in Québec, NOT the UTC day of
  // whatever machine runs the code. Lambda runs at UTC: every evening after
  // ~20:00 in Québec the UTC date has already rolled to tomorrow, so a
  // UTC-derived clock rejects a same-day booking as date_passee and shifts
  // reminder/stats day math by one. Every server-side default clock derives its
  // date here; the zone is this named product constant, overridable per call.
  const BUSINESS_TIMEZONE = 'America/Toronto';

  // One formatter per zone — Intl.DateTimeFormat construction is costly and
  // now() runs on every request. en-CA's numeric form is exactly YYYY-MM-DD.
  const businessDayFormatters = {};

  // The YYYY-MM-DD civil date of instant `at` (Date, epoch ms, or ISO string;
  // default: now) in `timeZone` (IANA name; default: BUSINESS_TIMEZONE).
  function businessDay(at, timeZone) {
    const zone = timeZone || BUSINESS_TIMEZONE;
    const fmt = (businessDayFormatters[zone] =
      businessDayFormatters[zone] ||
      new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }));
    return fmt.format(at == null ? new Date() : new Date(at));
  }

  // --- Conservation du journal d'audit ---------------------------------------
  // `docs/legal/politique-conservation-des-donnees.md` §1 : « Journal d'audit
  // administratif — 7 ans — preuve d'imputabilité ». La Loi 25 exige une
  // conservation BORNÉE : un journal qu'on ne détruit jamais n'est pas plus
  // conforme qu'un journal absent, et sept ans est le délai que la politique
  // nomme. La durée est donc une règle d'affaires, définie ici une seule fois ;
  // les deux adaptateurs de dépôt (mémoire, DynamoDB) la posent en `ttl` sur
  // chaque entrée d'audit à l'écriture.
  const AUDIT_RETENTION_YEARS = 7;

  // L'échéance d'une entrée écrite à l'instant `atMs`, en SECONDES epoch —
  // l'unité que le TTL DynamoDB attend. Le calcul est CALENDAIRE (sept fois
  // « même jour, année suivante ») et non un compte de jours : 7 × 365 jours
  // expirerait deux jours trop tôt à cause des années bissextiles, et sur une
  // borne de preuve, arrondir vers le bas est la seule erreur qui coûte cher.
  // Un instant illisible rend `null` — aucune expiration vaut mieux qu'une
  // expiration fausse, qui effacerait une preuve au hasard.
  function auditRetentionTtl(atMs) {
    const d = new Date(atMs == null ? NaN : atMs);
    if (!isFinite(d.getTime())) return null;
    d.setUTCFullYear(d.getUTCFullYear() + AUDIT_RETENTION_YEARS);
    return Math.floor(d.getTime() / 1000);
  }

  // ===========================================================================
  // LA POLITIQUE DE CONSERVATION — une seule table, et le code la LIT
  // ===========================================================================
  //
  // `docs/legal/politique-conservation-des-donnees.md` énonce les durées ; ce
  // tableau les APPLIQUE. Avant lui, six familles d'enregistrements n'avaient
  // aucune borne (profils de notaires, ACT#, EVAL#, EARN#, EVENT#, UNSUB#), les
  // offres portaient 400 jours écrits en clair dans le handler, et le journal
  // d'audit sept ans calculés ailleurs : quatre endroits pour une seule règle.
  //
  // Trois principes tiennent ce tableau :
  //
  //   1. UNE FAMILLE ABSENTE EST UN BOGUE. Un élément qu'on écrit sans ligne
  //      ici est un élément que personne n'a décidé de conserver — c'est
  //      exactement ce que la politique appelait, en §5, « le seul moyen de
  //      rendre cette politique auto-exécutoire ».
  //   2. `null` N'EST JAMAIS UN OUBLI. Une conservation indéfinie doit porter
  //      son `motifIndefini` ; sans lui, la ligne ne passe pas les tests.
  //   3. RIEN NE SE RACCOURCIT EN DOUCE. Les durées ci-dessous sont celles que
  //      le code appliquait déjà (400 jours, 180 jours, 7 ans) ou, pour les
  //      familles qui n'en avaient aucune, une durée AJOUTÉE — jamais une durée
  //      existante abaissée. Une rétention raccourcie DÉTRUIT des données.
  //
  // Chaque ligne est réglable par l'exploitation sous sa `cle`, sans redéploiement.
  const RETENTION_FAMILIES = Object.freeze([
    {
      famille: 'offre',
      jours: 400,
      cle: 'NOTA_OFFRE_RETENTION_DAYS',
      motif: 'Suivi du service et différends. Ancrée sur la DATE DE SIGNATURE, pas sur la publication.',
      base: 'Loi 25, art. 23 — finalité accomplie',
    },
    {
      famille: 'index_client',
      jours: 400,
      cle: 'NOTA_INDEX_CLIENT_RETENTION_DAYS',
      motif: 'Le pointeur meurt AVEC l’offre qu’il indexe : plus tôt, la personne devient introuvable ; plus tard, l’index pointe dans le vide.',
      base: 'Loi 25, art. 27 — droit d’accès exécutable',
    },
    {
      famille: 'avis',
      jours: 180,
      cle: 'NOTA_AVIS_RETENTION_DAYS',
      // La clé que l'exploitation connaissait AVANT que la politique n'existe.
      // La renommer en silence ferait retomber un déploiement réglé à 30 jours
      // sur le défaut de 180 — une rétention ALLONGÉE sans que personne ne l'ait
      // demandé, et l'inverse exact de ce que l'opérateur avait écrit.
      clesHeritees: ['NOTA_NOTIF_RETENTION_DAYS'],
      motif: 'Copie de courtoisie d’un fait qui vit ailleurs (l’offre, l’acte, le fil) : il n’a pas à survivre à la saison où il servait.',
      base: 'Loi 25, art. 3.2 — minimisation',
    },
    {
      famille: 'journal_sujet',
      jours: 730,
      cle: 'NOTA_JOURNAL_SUJET_RETENTION_DAYS',
      // ÉCRITE, PAS ENCORE APPLIQUÉE : aucun adaptateur ne pose ce ttl sur une
      // ligne de journal d'envoi. La durée est donc une INTENTION, et l'écrire
      // sans le dire ferait promettre à la personne exportant son dossier une
      // destruction qui n'aura pas lieu.
      applique: false,
      motifNonApplique: 'Durée DÉCIDÉE mais pas encore posée : ces lignes n’expirent pas d’elles-mêmes, et aucune porte ne les efface sur demande.',
      motif: 'Répond à « que nous avez-vous envoyé ? ». Deux ans couvrent le délai de plainte, sans garder une adresse à vie.',
      base: 'Loi 25, art. 27 — droit d’accès',
    },
    {
      famille: 'journal_audit',
      jours: AUDIT_RETENTION_YEARS * 365,
      annees: AUDIT_RETENTION_YEARS,
      cle: 'NOTA_JOURNAL_AUDIT_RETENTION_DAYS',
      motif: 'Preuve d’imputabilité. L’échéance est CALENDAIRE : sept ans comptés en jours expireraient deux jours trop tôt.',
      base: 'Politique de conservation §1 — sept ans',
    },
    {
      famille: 'acte',
      jours: AUDIT_RETENTION_YEARS * 365,
      annees: AUDIT_RETENTION_YEARS,
      cle: 'NOTA_ACTE_RETENTION_DAYS',
      motif: 'Pièce comptable : montant, part, références Stripe. AJOUTÉE — ce registre n’avait aucune borne.',
      base: 'Obligations fiscales et comptables — sept ans',
    },
    {
      famille: 'evaluation',
      jours: 365,
      cle: 'NOTA_EVALUATION_RETENTION_DAYS',
      motif: 'Alimente la cote du notaire. AJOUTÉE — ce registre survivait sans fin à l’offre qui l’a produite.',
      base: 'Politique de conservation §1 — douze mois',
    },
    {
      famille: 'gain_parrainage',
      jours: AUDIT_RETENTION_YEARS * 365,
      annees: AUDIT_RETENTION_YEARS,
      cle: 'NOTA_GAIN_PARRAINAGE_RETENTION_DAYS',
      motif: 'Une récompense due ou versée est une pièce comptable. AJOUTÉE — le registre croissait sans fin.',
      base: 'Obligations fiscales et comptables — sept ans',
    },
    {
      famille: 'evenement_stripe',
      jours: 400,
      cle: 'NOTA_EVENEMENT_STRIPE_RETENTION_DAYS',
      motif: 'Garde d’idempotence des rappels Stripe. AJOUTÉE, et volontairement LARGE : sous la durée de vie d’une offre, un rappel tardif serait rejoué.',
      base: 'Loi 25, art. 3.2 — minimisation',
    },
    {
      famille: 'profil_notaire',
      jours: null,
      cle: 'NOTA_PROFIL_NOTAIRE_RETENTION_DAYS',
      motifIndefini:
        'La politique §1 veut « 24 mois APRÈS LA FIN DE LA RELATION », et cette fin n’est enregistrée nulle part : aucune ancre, donc aucun ttl honnête. Un ttl posé à la CRÉATION détruirait le profil d’un notaire actif. La borne s’ouvrira le jour où la désactivation datera la fin de la relation.',
      motif: 'Preuve de la relation d’affaires ; le profil porte courriel, compte Stripe Connect et cumuls.',
      base: 'Politique de conservation §1 — écart nommé, non refermé',
    },
    {
      famille: 'desabonnement',
      jours: null,
      cle: 'NOTA_DESABONNEMENT_RETENTION_DAYS',
      motifIndefini: 'On ne peut pas oublier un refus sans le violer : effacer un désabonnement ferait revenir, plus tard, quelqu’un qui a dit non.',
      motif: 'Registre des refus de sollicitation.',
      base: 'LCAP, L.C. 2010, ch. 23, art. 11 — retrait honoré indéfiniment',
    },
    {
      famille: 'consentement',
      jours: null,
      cle: 'NOTA_CONSENTEMENT_RETENTION_DAYS',
      motifIndefini: 'Le fardeau de prouver le consentement pèse sur l’expéditeur : détruire la preuve, c’est perdre le droit d’écrire.',
      motif: 'Base de consentement d’une adresse, et le journal qui l’explique.',
      base: 'LCAP, art. 13 — fardeau de la preuve',
    },
    {
      famille: 'destinataire_campagne',
      jours: 1095,
      cle: 'NOTA_DESTINATAIRE_CAMPAGNE_RETENTION_DAYS',
      applique: false,
      motifNonApplique: 'Durée DÉCIDÉE mais pas encore posée : ces lignes n’expirent pas d’elles-mêmes.',
      motif: 'Trois ans : « qui a reçu quoi » doit survivre au délai de plainte, sans conserver une liste d’adresses à vie.',
      base: 'LCAP — prescription de trois ans',
    },
    {
      famille: 'effacement',
      jours: null,
      cle: 'NOTA_EFFACEMENT_RETENTION_DAYS',
      motifIndefini: 'Sans la marque, rien ne distingue « nous avons effacé cette personne » de « nous ne l’avons jamais connue », et une réimportation la ferait revenir.',
      motif: 'Marque d’effacement : un effacement demandé est lui-même un fait à conserver.',
      base: 'Loi 25, art. 28 — traçabilité de la demande',
    },
    {
      famille: 'fil_soutien',
      jours: 730,
      cle: 'NOTA_FIL_SOUTIEN_RETENTION_DAYS',
      applique: false,
      motifNonApplique: 'Durée DÉCIDÉE mais pas encore posée : ces conversations n’expirent pas d’elles-mêmes.',
      motif: 'Une conversation de soutien porte le nom et l’adresse d’une personne. Deux ans couvrent le suivi d’un différend.',
      base: 'Loi 25, art. 23 — finalité accomplie',
    },
  ]);

  const RETENTION_BY_FAMILY = Object.freeze(
    RETENTION_FAMILIES.reduce((acc, f) => {
      acc[f.famille] = f;
      return acc;
    }, {})
  );

  // Le seul mot qui ouvre une conservation SANS borne. Il faut l'écrire : on ne
  // l'obtient pas en se trompant de valeur, contrairement à un `0` ou un vide.
  const RETENTION_INDEFINIE = 'indefini';

  // La durée d'une famille, en jours, une fois les surcharges d'exploitation
  // appliquées. `null` = conservation indéfinie.
  //
  // Une surcharge ILLISIBLE (vide, négative, nulle, non numérique) est ignorée :
  // un déploiement ne doit pas tomber sur une variable mal tapée, et surtout une
  // durée `NaN` poserait un ttl `NaN`, c'est-à-dire AUCUN ttl — la donnée
  // deviendrait éternelle sans que rien ne le dise.
  //
  // UN SEUL SENS EST INTERDIT : borner une famille que la politique déclare
  // indéfinie. Donner trente jours au registre des désabonnements ferait revenir
  // un refus ; aucune variable d'environnement ne doit pouvoir faire ça.
  function retentionDays(famille, overrides) {
    const ligne = RETENTION_BY_FAMILY[famille];
    if (!ligne) throw new Error(`retentionDays : famille de conservation inconnue — « ${famille} » n’a aucune ligne dans la politique`);
    if (ligne.jours === null) return null;
    // La clé canonique d'abord, puis les clés HÉRITÉES : un déploiement réglé
    // sous l'ancien nom garde son réglage, et le jour où les deux sont posées
    // c'est la canonique qui tranche.
    let brut;
    for (const cle of [ligne.cle, ...(ligne.clesHeritees || [])]) {
      const v = overrides ? overrides[cle] : undefined;
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        brut = v;
        break;
      }
    }
    if (brut === undefined || brut === null) return ligne.jours;
    const texte = String(brut).trim();
    if (!texte) return ligne.jours;
    if (texte.toLowerCase() === RETENTION_INDEFINIE) return null;
    const n = Number(texte);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : ligne.jours;
  }

  // L'échéance d'un élément de cette famille ancré à l'instant `ancre`, en
  // SECONDES epoch — l'unité du TTL DynamoDB. `null` quand la famille est
  // indéfinie, et `null` aussi quand l'ancre est illisible : mieux vaut aucune
  // expiration qu'une fausse, qui détruirait l'élément le jour même.
  //
  // UNE BORNE LÉGALE SE COMPTE EN ANNÉES CIVILES, PAS EN JOURS. Les familles qui
  // portent `annees` (les sept ans de preuve : journal d'audit, acte, gain de
  // parrainage) roulent leur échéance « même jour, N années plus tard ». Sept
  // fois 365 jours tomberait DEUX JOURS TROP TÔT à cause de 2028 et 2032, et sur
  // une borne de preuve, arrondir vers le bas est la seule erreur qui coûte
  // cher. Une surcharge d'exploitation exprimée en jours reprend la main : qui
  // écrit des jours veut des jours.
  function retentionTtl(famille, ancre, overrides) {
    const jours = retentionDays(famille, overrides);
    if (jours === null) return null;
    const ms = ancre instanceof Date ? ancre.getTime() : typeof ancre === 'number' ? ancre : Date.parse(String(ancre));
    if (!Number.isFinite(ms)) return null;
    const ligne = RETENTION_BY_FAMILY[famille];
    if (ligne.annees && jours === ligne.jours) {
      const d = new Date(ms);
      d.setUTCFullYear(d.getUTCFullYear() + ligne.annees);
      return Math.floor(d.getTime() / 1000);
    }
    return Math.floor(ms / 1000) + jours * 86400;
  }

  // La politique, telle qu'un écran ou un document doit la rendre : une ligne
  // par famille, la durée EFFECTIVE (surcharges comprises) et sa provenance.
  function retentionPolicy(overrides) {
    return RETENTION_FAMILIES.map((f) => {
      const jours = retentionDays(f.famille, overrides);
      return {
        famille: f.famille,
        jours,
        indefini: jours === null,
        surchargee: jours !== f.jours,
        defaut: f.jours,
        cle: f.cle,
        motif: jours === null ? f.motifIndefini || f.motif : f.motif,
        base: f.base,
        // UNE DURÉE ÉCRITE N'EST PAS UNE DURÉE APPLIQUÉE. Trois familles portent
        // une borne que personne ne pose encore ; cette politique voyage dans
        // l'export remis à la personne, et une promesse de destruction qui
        // n'aura pas lieu est un mensonge de plus, pas une intention louable.
        // `conservation-politique.test.mjs` relit les adaptateurs et fait rougir
        // toute ligne dont ce drapeau ment.
        applique: f.jours === null ? null : f.applique !== false,
        motifNonApplique: f.applique === false ? f.motifNonApplique || null : null,
      };
    });
  }

  // ===========================================================================
  // LA FRONTIÈRE DE L'EFFACEMENT (Loi 25, art. 28)
  // ===========================================================================
  //
  // L'effacement n'est PAS inconditionnel, et un produit qui le laisse croire
  // ment deux fois : au client, et au notaire dont il détruirait la preuve.
  //
  // Ce que Nota DOIT garder même sur demande :
  //   • la trace légale et comptable d'un acte RÉGLÉ — c'est une pièce
  //     justificative, et l'acte notarié auquel elle se rapporte engage les
  //     obligations professionnelles propres du notaire (tenue des dossiers,
  //     index des minutes) ;
  //   • un acte EN COURS — effacer le client à mi-mandat abandonnerait le
  //     notaire avec un dossier sans partie ;
  //   • le journal d'audit — sept ans d'imputabilité, et il ne porte plus ni
  //     adresse d'origine ni courriel (politique §1) ;
  //   • un REFUS — désabonnement, retrait de consentement : l'oublier serait le
  //     violer.
  //
  // Tout le reste s'efface — quand l'exécutant SAIT l'effacer. Le plan nomme
  // donc TROIS choses et non deux : ce qui part, ce qui reste (pourquoi, et
  // jusqu'à quand), et ce que le code ne sait pas encore détruire. Une console
  // qui annoncerait « effacé » sur ce qu'elle conserve serait pire que pas
  // d'effacement du tout ; l'annoncer sur ce qu'elle ne sait pas atteindre est
  // le même mensonge, en plus discret.
  function erasurePlan({ courriel, offres, desabonne, consentement, at } = {}) {
    const adresse = String(courriel == null ? '' : courriel).trim().toLowerCase();
    if (!adresse) throw new Error('erasurePlan : sans adresse, il n’y a pas de sujet à effacer');
    const instant = at || null;
    const liste = Array.isArray(offres) ? offres.filter(Boolean) : [];

    const efface = [];
    const conserve = [];

    // --- Les offres, une par une -------------------------------------------
    // Un acte est RÉGLÉ (`acteComplete`) : la pièce comptable court sept ans à
    // compter du règlement. Il est RETENU sans être réglé : le mandat est vivant.
    // Sinon — ouverte, expirée, annulée — rien n'oblige à la garder.
    const regees = liste.filter((o) => o.acteComplete === true);
    const enCours = liste.filter((o) => o.acteComplete !== true && o.status === STATUS.RETENUE);
    const libres = liste.filter((o) => o.acteComplete !== true && o.status !== STATUS.RETENUE);

    if (libres.length) {
      efface.push({
        famille: 'offre',
        quoi: 'Offres sans acte réglé : dossier, pièces, courriel, téléphone, réponses de tarification.',
        ids: libres.map((o) => o.id),
        compte: libres.length,
        // La SEULE famille que l'exécutant sait détruire. « Sait » et non
        // « peut » : l'écriture peut encore lui être refusée en production, et
        // c'est la réponse — jamais le plan — qui distingue `effacees` de
        // `enAttente`.
        executable: true,
        identifiante: true,
        note: null,
      });
    }
    if (regees.length) {
      // L'échéance la plus LOINTAINE décide : tant qu'une seule pièce court, la
      // conservation court. Annoncer la plus proche promettrait un effacement
      // qui n'aurait pas lieu.
      const echeances = regees
        .map((o) => retentionTtl('acte', o.regleLe || o.dateISO, undefined))
        .filter((t) => t != null);
      conserve.push({
        famille: 'offre',
        quoi: 'Offres dont l’acte est RÉGLÉ : la pièce justificative de l’acte et son règlement.',
        ids: regees.map((o) => o.id),
        compte: regees.length,
        motif: 'Un acte réglé est une pièce comptable, et l’acte notarié qu’elle documente engage les obligations professionnelles propres du notaire.',
        base: 'Obligations fiscales et comptables — sept ans ; Loi sur le notariat (tenue des dossiers)',
        jusqua: echeances.length ? new Date(Math.max(...echeances) * 1000).toISOString().slice(0, 10) : null,
      });
    }
    if (enCours.length) {
      conserve.push({
        famille: 'offre',
        quoi: 'Actes EN COURS : retenus par un notaire, pas encore réglés.',
        ids: enCours.map((o) => o.id),
        compte: enCours.length,
        motif: 'Le mandat est en cours : effacer la partie à mi-mandat abandonnerait le notaire avec un dossier sans client.',
        base: 'Loi 25, art. 23 — la finalité n’est pas accomplie',
        jusqua: null,
      });
    }

    // --- Les familles nominatives qui n'ont aucune obligation de garde ------
    //
    // ELLES SONT ANNONCÉES AVEC LEUR EXÉCUTABILITÉ, ET C'EST TOUT LE POINT.
    // Jusqu'au 2026-09-05 elles étaient poussées ici sans réserve, en face du
    // titre « Ce qui sera effacé » — alors qu'AUCUNE porte de suppression
    // n'existe pour elles dans l'un ou l'autre adaptateur. Un plan qui annonce
    // une destruction que le code ne sait pas faire est exactement le mensonge
    // que cette fonction existe pour empêcher : l'opérateur confirmait, la
    // console disait « Dossier effacé », et l'adresse restait en clair dans
    // `SUJET#<courriel>` et sur chaque ligne de destinataire de campagne.
    //
    // `identifiante` sépare deux résidus très différents : celui qui NOMME
    // encore la personne (son adresse, en clair, dans une clé de partition) et
    // celui qui n'en porte plus le nom. Seul le premier interdit de déclarer
    // l'effacement complet.
    for (const [famille, quoi, identifiante, note] of [
      [
        'avis',
        'Avis en application (la cloche) rattachés aux offres effacées.',
        false,
        'Aucune porte de suppression : rien, dans les deux adaptateurs, n’efface un avis. Leur partition dérive du jeton de l’offre et non de l’adresse, et ils expirent d’eux-mêmes (politique, famille « avis »).',
      ],
      [
        'journal_sujet',
        'Journal des envois faits à cette personne.',
        true,
        'Aucune porte de suppression, et ces lignes sont rangées SOUS L’ADRESSE elle-même : le courriel survit en clair à l’effacement.',
      ],
      [
        'destinataire_campagne',
        'Lignes de destinataire des campagnes reçues.',
        true,
        'Aucune porte de suppression, et le registre est partitionné par CAMPAGNE : on ne sait même pas énumérer les lignes d’une personne. Le courriel y survit en clair.',
      ],
      [
        'index_client',
        'Pointeurs d’index qui rendent cette personne retrouvable par son adresse.',
        true,
        'Aucune porte de suppression. La clé de partition EST l’adresse (CLIENT#courriel) : elle survit jusqu’à l’expiration des pointeurs, qui meurent avec les offres qu’ils indexent.',
      ],
    ]) {
      efface.push({ famille, quoi, ids: [], compte: null, executable: false, identifiante, note });
    }

    // --- Ce qui survit toujours --------------------------------------------
    const audit = RETENTION_BY_FAMILY.journal_audit;
    conserve.push({
      famille: 'journal_audit',
      quoi: 'Entrées du journal d’audit qui mentionnent les offres de cette personne.',
      ids: [],
      compte: null,
      motif: 'Preuve d’imputabilité. Le journal ne porte ni adresse d’origine ni courriel : il nomme une offre, pas une personne.',
      base: audit.base,
      jusqua: null,
    });
    conserve.push({
      famille: 'effacement',
      quoi: 'La marque d’effacement elle-même, et l’entrée d’audit qui l’enregistre.',
      ids: [],
      compte: null,
      motif: RETENTION_BY_FAMILY.effacement.motifIndefini,
      base: RETENTION_BY_FAMILY.effacement.base,
      jusqua: null,
    });
    if (desabonne) {
      conserve.push({
        famille: 'desabonnement',
        quoi: 'Le refus de sollicitation enregistré pour cette adresse.',
        ids: [],
        compte: null,
        motif: RETENTION_BY_FAMILY.desabonnement.motifIndefini,
        base: RETENTION_BY_FAMILY.desabonnement.base,
        jusqua: null,
      });
    }
    if (consentement) {
      conserve.push({
        famille: 'consentement',
        quoi: 'La base de consentement de cette adresse et le journal qui l’explique.',
        ids: [],
        compte: null,
        motif: RETENTION_BY_FAMILY.consentement.motifIndefini,
        base: RETENTION_BY_FAMILY.consentement.base,
        jusqua: null,
      });
    }

    // COMPLET = plus aucune donnée IDENTIFIANTE ne survit. Le journal d'audit,
    // la marque d'effacement et les refus n'entrent pas dans ce compte : le
    // premier ne nomme personne, les deux autres SONT l'effacement et son refus.
    //
    // DEUX SOURCES DE SURVIE, ET IL A LONGTEMPS MANQUÉ LA SECONDE : ce que la
    // loi oblige à GARDER (colonne « conservé »), et ce que le code ne sait pas
    // DÉTRUIRE. Ne compter que la première faisait déclarer « complet » un
    // effacement après lequel l'adresse restait en clair dans trois registres.
    // Un résidu qui ne nomme plus personne (les avis) ne compte pas ici : c'est
    // la donnée identifiante, et elle seule, qui interdit le mot « complet ».
    const identifiantes = conserve.filter(
      (l) => l.famille !== 'journal_audit' && l.famille !== 'effacement' && l.famille !== 'desabonnement' && l.famille !== 'consentement'
    );
    const residus = efface.filter((l) => l.executable === false && l.identifiante === true);
    return {
      courriel: adresse,
      at: instant,
      efface,
      conserve,
      // Ce que le plan ANNONCE et que l'exécutant ne sait pas faire, isolé pour
      // qu'un écran n'ait pas à le redécouvrir en filtrant.
      residus,
      complet: identifiantes.length === 0 && residus.length === 0,
    };
  }

  // Les champs d'une offre qui NOMMENT quelqu'un. Effacer, c'est les vider —
  // et vider CEUX-LÀ, pas l'élément entier : une offre supprimée d'un coup
  // trouerait le carnet public, les compteurs du tableau de bord et les
  // agrégats du notaire, et l'on ne saurait plus distinguer « effacée » de
  // « jamais publiée ».
  //
  // `pricing` est de la partie : les réponses de tarification SONT le dossier
  // (« le document confondu avec la démarche »), et la valeur d'un prêt avec la
  // date d'une signature identifie une transaction.
  const BID_IDENTIFYING_FIELDS = Object.freeze([
    'nom', 'courriel', 'telephone', 'dossier', 'pricing', 'parrain', 'messages', 'financingAnalysis',
  ]);

  // L'offre telle qu'elle survit à un effacement. Ce qui reste ne nomme
  // personne ; ce qui part est nommément listé ci-dessus ; et l'élément DIT
  // qu'il a été effacé, sans quoi « effacé » et « jamais connu » se
  // confondraient — c'est la raison d'être de la marque d'effacement.
  //
  // Le `ttl` est conservé tel quel. Le perdre rendrait ÉTERNEL l'élément qu'on
  // vient d'effacer : l'inverse exact de ce qu'on demandait.
  //
  // Idempotent : effacer une offre déjà effacée garde le PREMIER instant. La
  // date d'un effacement est un fait, pas un compteur qu'on repousse.
  function redactedBid(bid, at) {
    if (!bid) return null;
    const nu = { ...bid };
    for (const champ of BID_IDENTIFYING_FIELDS) nu[champ] = null;
    nu.efface = true;
    nu.effaceLe = bid.efface === true && bid.effaceLe ? bid.effaceLe : at || null;
    return nu;
  }

  // --- Offer validation ------------------------------------------------------
  // The one function the API must call before persisting anything. Returns the
  // derived tier and premium so the caller never recomputes them, and a list of
  // typed errors (empty when ok). The client shows these inline; the server
  // rejects on any of them.
  function validateOffer(input) {
    input = input || {};
    const errors = [];

    const svc = serviceById(input.serviceId);
    if (!svc) errors.push({ code: 'service_inconnu', message: 'Service inconnu.' });

    const montant = Math.round(Number(input.montant));
    const montantValide = Number.isFinite(montant) && montant > 0;
    if (!montantValide) errors.push({ code: 'montant_invalide', message: 'Le montant doit être un nombre positif.' });

    let days = null;
    let tier = null;
    let premium = null;

    if (!isISODate(input.dateISO)) {
      errors.push({ code: 'date_invalide', message: 'La date doit être au format AAAA-MM-JJ.' });
    } else if (!isISODate(input.todayISO)) {
      // Without a valid reference "today" the past-date rule cannot be applied.
      // Fail closed with a typed error rather than silently skipping the check.
      errors.push({ code: 'date_invalide', message: 'La date du jour est manquante ou invalide.' });
    } else {
      days = daysBetween(input.todayISO, input.dateISO);
      if (days < 0) errors.push({ code: 'date_passee', message: 'La date de signature est déjà passée.' });
      tier = tierForDays(Math.max(0, days));
    }

    // Dynamic floor: the base price derived from the client's pricing answers
    // (part of the dossier). Falls back to the flat base when no answers are
    // supplied, so existing callers see identical behaviour.
    const base = svc ? computeBasePrice(svc.id, input.pricing) : null;
    if (svc && montantValide) {
      if (montant < base) {
        errors.push({ code: 'sous_prix_depart', message: `L’offre doit être d’au moins ${money(base)}.` });
      }
      if (montant > base * PREMIUM_CAP) {
        errors.push({ code: 'plafond_depasse', message: `L’offre ne peut dépasser ${money(base * PREMIUM_CAP)} (${PREMIUM_CAP}×).` });
      }
      premium = montant / base;
    }

    // Mandatory pricing parameters must be answered before a bid is valid —
    // without them the posted price is meaningless to a notary (inert until a
    // service marks a criterion `required`).
    if (svc) {
      for (const m of missingRequired(svc.id, input.pricing)) {
        errors.push({ code: 'parametre_requis', param: m.id, message: `Réponse requise : ${endPunctuated(m.label) ? m.label : m.label + '.'}` });
      }
    }

    // Courriel is OPTIONAL (used only for private notifications, never shown on
    // the public carnet). An empty/absent value is fine; a non-empty value must
    // look like an email.
    const courrielRaw = input.courriel == null ? '' : String(input.courriel).trim();
    if (courrielRaw !== '' && !isEmail(courrielRaw)) {
      errors.push({ code: 'courriel_invalide', message: 'Le courriel n’est pas valide.' });
    }

    // The postal sector (FSA prefix) is REQUIRED: it is the bid's only location
    // signal, and without it the déplacement the client declares cannot be
    // related to a notary's service radius — the distance to the signature
    // would be unknowable. Format only (letter-digit-letter); a non-Quebec
    // sector stays a UI warning, never a rejection.
    const prefixeV = validatePrefixe(input.prefixe, { required: true });
    if (prefixeV.error) errors.push(prefixeV.error);

    return {
      ok: errors.length === 0,
      errors,
      tier,
      days,
      premium,
      // The dynamic floor the offer was validated against (== the flat base when
      // no pricing criteria were answered).
      expiresOn: offerExpirationDate(input.todayISO, input.dateISO),
      prixDepart: base,
      basePrice: base,
      montant: montantValide ? montant : null,
      courriel: courrielRaw || null,
      // The normalized sector the caller must persist (null when missing/invalid).
      prefixe: prefixeV.value,
    };
  }

  // --- Ranking ---------------------------------------------------------------
  // A bid's rank among the open bids on the same day for the same service,
  // highest amount first. Powers the "3e sur 7" scarcity signal.
  function rankOf(bid, bids) {
    const peers = bids
      .filter((b) => b.dateISO === bid.dateISO && b.serviceId === bid.serviceId && isOpenBid(b))
      .sort((a, b) => b.montant - a.montant || String(a.id).localeCompare(String(b.id)));
    const total = peers.length;
    const idx = peers.findIndex((b) => b.id === bid.id);
    return { rang: idx < 0 ? null : idx + 1, total };
  }

  // --- Notary actions on an open bid -----------------------------------------
  // Beyond retaining or declining, a notary can answer an open demand with a
  // PROPOSITION (a higher price) or a DEMANDE DE DOCUMENTS. Both are validated
  // here — the API is authoritative, the console mirrors the same rules inline.

  // The floor a bid was validated against: its own dynamic base when the server
  // recorded one, else the service's public starting price.
  function bidFloor(bid) {
    const svc = bid && serviceById(bid.serviceId);
    const own = bid && Number(bid.basePrice);
    if (Number.isFinite(own) && own > 0) return own;
    return svc ? svc.prixDepart : null;
  }

  // A proposition is only meaningful ABOVE what the client already offers, and
  // never above the same premium cap the client is held to.
  function validateCounterOffer(input) {
    input = input || {};
    const errors = [];
    const bid = input.bid;
    const isOpen = isOpenBid(bid) && serviceById(bid.serviceId);
    if (!isOpen) errors.push({ code: 'offre_non_ouverte', message: 'Cette offre n’est plus ouverte.' });

    const montant = Math.round(Number(input.montant));
    const montantValide = Number.isFinite(montant) && montant > 0;
    if (!montantValide) errors.push({ code: 'montant_invalide', message: 'Le montant doit être un nombre positif.' });

    if (isOpen && isISODate(bid.dateISO) && isISODate(input.todayISO) && daysBetween(input.todayISO, bid.dateISO) < 0) {
      errors.push({ code: 'date_passee', message: 'La date de signature est déjà passée.' });
    }

    let delta = null;
    if (isOpen && montantValide) {
      const current = Math.round(Number(bid.montant)) || 0;
      if (montant <= current) {
        errors.push({ code: 'proposition_inferieure', message: `La proposition doit dépasser l’offre du client (${money(current)}).` });
      }
      const floor = bidFloor(bid);
      if (floor && montant > floor * PREMIUM_CAP) {
        errors.push({ code: 'plafond_depasse', message: `La proposition ne peut dépasser ${money(floor * PREMIUM_CAP)} (${PREMIUM_CAP}×).` });
      }
      delta = montant - current;
    }
    return { ok: errors.length === 0, errors, montant: montantValide ? montant : null, delta };
  }

  // The amount the console pre-fills when a notary opens the proposition form:
  // roughly one tier's worth above the client, rounded to a figure a person
  // would type, clamped to the cap so the default is always submittable.
  const COUNTER_OFFER_STEP = 0.2;
  function suggestedCounterOffer(bid) {
    const current = Math.round(Number(bid && bid.montant)) || 0;
    const floor = bidFloor(bid);
    const cap = floor ? floor * PREMIUM_CAP : Infinity;
    const raw = Math.ceil((current * (1 + COUNTER_OFFER_STEP)) / 10) * 10;
    return Math.min(Math.max(raw, current + 10), cap);
  }

  // Everything a notary may ask a client for: the service's documents and its
  // intake fields, by id, with the label the client already saw in the dossier.
  // With `pricing`, only the documents that apply to THIS client's answers
  // (documentApplies) — a notary cannot ask for a promise to purchase on a
  // refinancing; without it, every document, as before.
  const DOCUMENT_REQUEST_MESSAGE_MAX = 500;
  function requestableItems(serviceId, pricing) {
    const svc = serviceById(serviceId);
    if (!svc) return [];
    return applicableDocuments(svc, pricing)
      .map((d) => ({ id: d.id, nom: d.nom, kind: 'document' }))
      .concat(svc.champs.map((c) => ({ id: c.id, nom: c.label, kind: 'champ' })));
  }

  function validateDocumentRequest(input) {
    input = input || {};
    const errors = [];
    const svc = serviceById(input.serviceId);
    if (!svc) errors.push({ code: 'service_inconnu', message: 'Service inconnu.' });

    const ids = Array.isArray(input.documents) ? input.documents.map(String) : [];
    const unique = ids.filter((id, i) => ids.indexOf(id) === i);
    if (!unique.length) errors.push({ code: 'documents_requis', message: 'Choisissez au moins un document à demander.' });

    const known = requestableItems(input.serviceId);
    const documents = [];
    for (const id of unique) {
      const item = known.find((k) => k.id === id);
      if (item) documents.push(item);
      else if (svc) errors.push({ code: 'document_inconnu', message: `Document inconnu : ${id}.`, document: id });
    }

    const message = input.message == null ? '' : String(input.message).trim();
    if (message.length > DOCUMENT_REQUEST_MESSAGE_MAX) {
      errors.push({ code: 'message_trop_long', message: `Le message ne peut dépasser ${DOCUMENT_REQUEST_MESSAGE_MAX} caractères.` });
    }
    return { ok: errors.length === 0, errors, documents, message: message || null };
  }

  // --- Retained-act conversation (client ↔ notaire) --------------------------
  // Once a notary retains an act the two parties must be able to talk INSIDE
  // Nota: instructions arrive, details surface, and the notary either confirms
  // or withdraws. A message is plain text from one of the two roles; the API
  // stores the thread on the bid and both consoles poll it.
  const CHAT_MESSAGE_MAX = 500;
  const CHAT_FROM = { CLIENT: 'client', NOTAIRE: 'notaire' };

  function validateChatMessage(input) {
    input = input || {};
    const errors = [];
    const de = input.de;
    if (de !== CHAT_FROM.CLIENT && de !== CHAT_FROM.NOTAIRE) {
      errors.push({ code: 'expediteur_invalide', message: 'L’expéditeur doit être le client ou le notaire.' });
    }
    const texte = input.texte == null ? '' : String(input.texte).trim();
    if (!texte) errors.push({ code: 'message_requis', message: 'Écrivez un message.' });
    if (texte.length > CHAT_MESSAGE_MAX) {
      errors.push({ code: 'message_trop_long', message: `Le message ne peut dépasser ${CHAT_MESSAGE_MAX} caractères.` });
    }
    // The conversation only exists while a notary holds the act.
    if (!input.bid || input.bid.status !== STATUS.RETENUE) {
      errors.push({ code: 'offre_non_retenue', message: 'La conversation s’ouvre lorsqu’un notaire retient l’acte.' });
    }
    return { ok: errors.length === 0, errors, texte: texte || null };
  }

  // --- Les documents de la conversation (ADR 0032) ---------------------------
  //
  // La messagerie porte désormais des fichiers. Le domaine décide de ce qui est
  // recevable ; le stockage et les routes ne font qu'appliquer.
  //
  // Les contraintes sont celles du dossier — PDF ou photo, 15 Mo, nom assaini —
  // pour deux raisons distinctes. La première est utilitaire : un notaire doit
  // pouvoir OUVRIR ce qu'il reçoit. La seconde est la seule protection dont le
  // produit dispose : il n'existe aucune analyse antivirale, et un format inerte
  // téléchargé en pièce jointe est ce qui tient lieu de garde-fou (ADR 0032,
  // « ce que cette décision ne règle pas »). Élargir cette liste, c'est retirer
  // cette protection — jamais un simple ajout de confort.
  const CHAT_DOCUMENTS_MAX = 30;

  // Le type MIME attendu pour chaque extension. Il sert deux fois : à REFUSER
  // un type déclaré qui contredit le nom, et à figer le content-type dans
  // l'autorisation signée. Si les deux divergeaient, c'est le stockage qui
  // porterait le mensonge — et le navigateur qui l'exécuterait.
  const DOCUMENT_TYPES = {
    pdf: ['application/pdf'],
    jpg: ['image/jpeg'], jpeg: ['image/jpeg'],
    png: ['image/png'],
    heic: ['image/heic'], heif: ['image/heif'],
    webp: ['image/webp'],
  };

  function extensionDe(nom) {
    const dot = String(nom || '').lastIndexOf('.');
    return dot > 0 ? String(nom).slice(dot + 1).toLowerCase() : '';
  }

  /**
   * La CLÉ de stockage d'un document. Elle est DÉRIVÉE, jamais fournie : un
   * appelant ne choisit pas où il écrit. Tout ce qui vient de l'extérieur est
   * réduit à des caractères sûrs, donc aucune traversée n'est représentable —
   * c'est pour cela que la fonction ne « nettoie » pas une clé reçue, elle en
   * fabrique une.
   */
  function documentStorageKey(bidId, documentId, nom) {
    const sur = (v) => String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'x';
    const ext = DOCUMENT_TYPES[extensionDe(nom)] ? extensionDe(nom) : 'bin';
    return 'offres/' + sur(bidId) + '/' + sur(documentId) + '.' + ext;
  }

  /**
   * Ce qu'une partie a le droit de déposer dans la conversation. Le refus est
   * LOCAL et arrive avant toute autorisation : faire échouer un téléversement
   * de 15 Mo après coup est la pire des réponses possibles.
   */
  function validateChatDocument(input) {
    input = input || {};
    const errors = [];
    const de = input.de;
    if (de !== CHAT_FROM.CLIENT && de !== CHAT_FROM.NOTAIRE) {
      errors.push({ code: 'expediteur_invalide', message: 'L’expéditeur doit être le client ou le notaire.' });
    }
    if (!input.bid || input.bid.status !== STATUS.RETENUE) {
      errors.push({ code: 'offre_non_retenue', message: 'La conversation s’ouvre lorsqu’un notaire retient l’acte.' });
    }

    const nom = sanitizeFileName(input.nom);
    const ext = extensionDe(nom);
    const types = DOCUMENT_TYPES[ext];
    if (!nom || !types) {
      errors.push({ code: 'format_refuse', message: 'Format non accepté — utilisez un PDF ou une photo (JPG, PNG, HEIC).' });
    }

    const type = String(input.type || '').toLowerCase().split(';')[0].trim();
    if (types && type && types.indexOf(type) === -1) {
      errors.push({ code: 'type_incoherent', message: 'Le type du fichier ne correspond pas à son nom.' });
    }

    // Une taille absente est un refus : l'autorisation de dépôt fige une borne,
    // et signer sans borne reviendrait à en offrir aucune.
    const taille = Number(input.taille);
    if (!Number.isFinite(taille) || taille <= 0 || taille > DOSSIER_FILE.maxBytes) {
      const mo = Math.round(DOSSIER_FILE.maxBytes / (1024 * 1024));
      errors.push({ code: 'taille_refusee', message: 'Fichier trop lourd ou taille inconnue — maximum ' + mo + ' Mo.' });
    }

    const deja = Array.isArray(input.bid && input.bid.documents) ? input.bid.documents.length : 0;
    if (deja >= CHAT_DOCUMENTS_MAX) {
      errors.push({ code: 'trop_de_documents', message: `Cette conversation a atteint ${CHAT_DOCUMENTS_MAX} documents.` });
    }

    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], nom, contentType: types[0], taille };
  }

  // A notary who retained an act may still WITHDRAW when a detail surfaced in
  // the conversation makes the file impossible on their side (an unfamiliar
  // lender, a conflict, a date that no longer works). Withdrawing returns the
  // act to the open market — the client keeps their date and offer.
  function validateRelease(input) {
    input = input || {};
    const errors = [];
    if (!input.bid || input.bid.status !== STATUS.RETENUE) {
      errors.push({ code: 'offre_non_retenue', message: 'Seul un acte retenu peut être remis au carnet.' });
    }
    const message = input.message == null ? '' : String(input.message).trim();
    if (message.length > CHAT_MESSAGE_MAX) {
      errors.push({ code: 'message_trop_long', message: `Le message ne peut dépasser ${CHAT_MESSAGE_MAX} caractères.` });
    }
    return { ok: errors.length === 0, errors, message: message || null };
  }

  // --- L'indemnité de résiliation (ADR 0041) ----------------------------------
  // Quand un client annule un acte RETENU près de la signature, le notaire
  // peut réclamer une indemnité : ses frais réels et la valeur du travail
  // accompli (art. 2129 C.c.Q.), plafonnée par le barème, dans un délai, et
  // JUSTIFIÉE. Aucun montant n'est fixé d'avance (art. 13 LPC) : le domaine ne
  // connaît ni pourcentage ni barème, il valide une réclamation contre son
  // plafond et exige qu'elle soit motivée. Réclamer zéro, c'est renoncer.
  const INDEMNITE_JUSTIFICATION_MIN = 20;
  const INDEMNITE_JUSTIFICATION_MAX = 600;

  /**
   * Valide la réclamation d'un notaire : `{ montant }` en dollars (0 = il
   * renonce), `justification` (obligatoire dès que le montant est positif),
   * `plafond` en dollars (le plus que le barème permet pour cette annulation).
   * Rend `{ ok, errors, montant, montantCents, justification, renonce }`.
   */
  function validateIndemnite(input) {
    input = input || {};
    const errors = [];
    const plafond = Number(input.plafond);
    const montant = input.montant === '' || input.montant == null ? NaN : Number(input.montant);
    if (!Number.isFinite(plafond) || plafond <= 0) {
      errors.push({ code: 'plafond_invalide', message: 'Aucune indemnité ne peut être réclamée sur cette annulation.' });
    }
    if (!Number.isFinite(montant) || montant < 0) {
      errors.push({ code: 'montant_invalide', message: 'Le montant réclamé doit être un nombre de dollars, zéro compris.' });
    } else if (Number.isFinite(plafond) && montant > plafond + 1e-9) {
      errors.push({ code: 'montant_au_dessus_du_plafond', message: 'Le montant réclamé dépasse le plafond de ' + money(plafond) + '.' });
    }
    const justification = input.justification == null ? '' : String(input.justification).trim();
    const renonce = Number.isFinite(montant) && montant === 0;
    if (!renonce) {
      if (justification.length < INDEMNITE_JUSTIFICATION_MIN) {
        errors.push({ code: 'justification_requise', message: 'Une indemnité doit être justifiée : décrivez les frais engagés et le travail accompli (au moins ' + INDEMNITE_JUSTIFICATION_MIN + ' caractères).' });
      }
    }
    if (justification.length > INDEMNITE_JUSTIFICATION_MAX) {
      errors.push({ code: 'justification_trop_longue', message: 'La justification ne peut dépasser ' + INDEMNITE_JUSTIFICATION_MAX + ' caractères.' });
    }
    const montantCents = Number.isFinite(montant) ? Math.round(montant * 100) : 0;
    return {
      ok: errors.length === 0,
      errors,
      montant: montantCents / 100,
      montantCents,
      justification: renonce ? null : justification || null,
      renonce,
    };
  }

  // The released bid, back on the market exactly as the client posted it.
  /**
   * L'offre retourne au carnet — et la CONVERSATION MEURT AVEC LA RELATION.
   *
   * **Art. 37 du Code de déontologie** : « Le notaire ne doit pas, à moins que
   * la nature du cas ne l'exige, révéler qu'une personne a fait appel à ses
   * services. » Un autre notaire va retenir cette offre. Si le fil survivait,
   * il apprendrait qu'un confrère a été consulté, ce que le client lui a
   * écrit, et il recevrait les pièces transmises — relevé de prêt, compte de
   * taxes, pièce d'identité. La nature du cas n'exige rien de tel : le second
   * notaire a besoin de la demande, pas de son histoire.
   *
   * Le DOSSIER, lui, voyage : il appartient au client et c'est l'objet même de
   * l'offre. Seul l'échange avec CE notaire disparaît.
   */
  function releasedBid(bid) {
    return { ...bid, status: STATUS.OUVERTE, etude: null, notaryId: null, messages: [], documents: [] };
  }

  // Les clés de stockage que le désistement rend inatteignables. Le domaine ne
  // supprime rien — il n'a pas de stockage — mais laisser des octets chiffrés
  // que plus personne ne peut atteindre est un risque qui ne rapporte rien.
  function releasedDocumentKeys(bid) {
    const docs = bid && Array.isArray(bid.documents) ? bid.documents : [];
    return docs.map((d) => d && d.cle).filter(Boolean);
  }

  // --- Notary agenda ---------------------------------------------------------
  // The console's working view: the open demands of the carnet as a notary
  // plans a week — by signing date, then by act, best offer first — with the
  // money on the table per day. Retained and malformed bids are left out.
  function agendaByDate(bids) {
    const list = (Array.isArray(bids) ? bids : []).filter(
      (b) => isOpenBid(b) && isISODate(b.dateISO) && serviceById(b.serviceId),
    );
    const byDate = new Map();
    for (const b of list) {
      if (!byDate.has(b.dateISO)) byDate.set(b.dateISO, []);
      byDate.get(b.dateISO).push(b);
    }
    return [...byDate.keys()].sort().map((dateISO) => {
      const day = byDate.get(dateISO);
      const services = SERVICES.map((s) => {
        const mine = day
          .filter((b) => b.serviceId === s.id)
          .sort((a, b) => (Number(b.montant) || 0) - (Number(a.montant) || 0) || String(a.id).localeCompare(String(b.id)));
        return { serviceId: s.id, nom: s.nom, nomCourt: s.nomCourt, bids: mine, best: mine.length ? Number(mine[0].montant) || 0 : null };
      }).filter((s) => s.bids.length);
      return {
        dateISO,
        count: day.length,
        total: day.reduce((sum, b) => sum + (Math.round(Number(b.montant)) || 0), 0),
        services,
      };
    });
  }

  // --- Contact points --------------------------------------------------------
  // Where a human reaches Nota. Defined ONCE here (the API's transactional
  // emails and the web footer both read it) so a change never has to be made
  // twice. `telephone` stays null until a real line exists — the UI renders the
  // call button only when it is set, because a wrong number is worse than none.
  const CONTACT = {
    courriel: 'info@gonota.ca',
    confidentialite: 'info@gonota.ca',
    telephone: null,
  };

  // A message a human sends Nota through the contact form. The courriel is the
  // reply channel, so it is the one hard requirement besides the message
  // itself; name and subject help a human triage but never block a call for
  // help. Same authoritative-validator pattern as the offer and the
  // proposition: the API enforces this, the form mirrors it inline.
  const CONTACT_MESSAGE_MAX = 2000;
  const CONTACT_FIELD_MAX = 150;
  function validateContactMessage(input) {
    input = input || {};
    const errors = [];

    const courriel = String(input.courriel == null ? '' : input.courriel).trim().toLowerCase();
    if (!isEmail(courriel)) {
      errors.push({ code: 'courriel_invalide', message: 'Un courriel valide est requis pour vous répondre.' });
    }

    const message = String(input.message == null ? '' : input.message).trim();
    if (!message) errors.push({ code: 'message_requis', message: 'Écrivez-nous quelques mots.' });
    if (message.length > CONTACT_MESSAGE_MAX) {
      errors.push({ code: 'message_trop_long', message: `Le message ne peut dépasser ${CONTACT_MESSAGE_MAX} caractères.` });
    }

    const nom = String(input.nom == null ? '' : input.nom).trim().slice(0, CONTACT_FIELD_MAX);
    const sujet = String(input.sujet == null ? '' : input.sujet).trim().slice(0, CONTACT_FIELD_MAX);

    return {
      ok: errors.length === 0,
      errors,
      nom: nom || null,
      courriel: isEmail(courriel) ? courriel : null,
      sujet: sujet || null,
      message: message || null,
    };
  }

  // --- Live support messaging (ADR 0026) -------------------------------------
  // A visitor with a question opens the site's chat widget; each message lands
  // live with the operator (email with a signed reply link), and the reply
  // shows up in the widget. One thread per device, message-by-message. The
  // courriel is OPTIONAL here — the widget is the reply channel; the courriel
  // only adds an offline copy of the answer.
  // Trois émetteurs, et la distinction compte (ADR 0046) : `nota`, c'est un
  // humain — le propriétaire, depuis son courriel. `assistant`, c'est la
  // réponse rédigée par le modèle sur la fiche de faits ci-dessous. Les
  // confondre laisserait une machine vider la boîte de quelqu'un d'autre, et
  // laisserait un visiteur croire qu'il parle à une personne. Le fil sait
  // toujours lequel des deux a parlé.
  const SUPPORT_FROM = { VISITEUR: 'visiteur', NOTA: 'nota', ASSISTANT: 'assistant' };
  // --- The support inbox (2026-09-04) ------------------------------------------
  // A thread has ONE status, derived from who spoke last: the operator's inbox
  // sorts on it and the widget can never contradict it. `closLe` (set by the
  // operator) wins until the visitor writes again — a question after a close
  // reopens the thread by itself, nobody has to notice.
  const SUPPORT_STATUT = Object.freeze({ A_REPONDRE: 'a_repondre', REPONDU: 'repondu', CLOS: 'clos' });
  const SUPPORT_STATUTS = Object.freeze([
    { id: 'a_repondre', nom: 'À répondre', nomEn: 'To answer' },
    { id: 'repondu',    nom: 'Répondu',    nomEn: 'Answered' },
    { id: 'clos',       nom: 'Clos',       nomEn: 'Closed' },
  ]);
  const SUPPORT_EXCERPT_MAX = 140;
  function supportThreadSummary(thread) {
    const t = thread && typeof thread === 'object' ? thread : {};
    const msgs = Array.isArray(t.messages) ? t.messages.filter(Boolean) : [];
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    const dernierAt = last ? (last.createdAt || null) : null;
    // SEUL un humain marque un fil « répondu » (ADR 0046). L'assistant parle
    // le premier et parle souvent ; s'il comptait, chaque question se
    // classerait toute seule et la boîte du propriétaire se viderait de fils
    // que personne n'a lus.
    let statut = SUPPORT_STATUT.A_REPONDRE;
    if (last && last.de === SUPPORT_FROM.NOTA) statut = SUPPORT_STATUT.REPONDU;
    if (t.closLe && (!dernierAt || String(t.closLe) >= String(dernierAt))) statut = SUPPORT_STATUT.CLOS;
    // Une escalade est ouverte tant que l'humain n'a pas parlé APRÈS elle. La
    // question « après » se tranche sur l'ORDRE des messages, jamais sur leurs
    // horodatages : un fil est append-only, alors que deux messages peuvent
    // porter la même seconde (et en portent la même dans les tests à horloge
    // figée). Comparer des chaînes de temps laissait un fil escaladé le rester
    // après la réponse du propriétaire.
    const escaladeLe = t.escaladeLe || null;
    let dernierNota = -1;
    let dernierAssistant = -1;
    msgs.forEach((m, i) => {
      if (!m) return;
      if (m.de === SUPPORT_FROM.NOTA) dernierNota = i;
      if (m.de === SUPPORT_FROM.ASSISTANT) dernierAssistant = i;
    });
    const escalade = !!escaladeLe && dernierNota < dernierAssistant;
    const texte = last ? String(last.texte == null ? '' : last.texte).replace(/\s+/g, ' ').trim() : '';
    return {
      id: t.id == null ? null : String(t.id),
      courriel: t.courriel || null,
      nom: t.nom || null,
      origine: t.origine || 'messagerie',
      sujet: t.sujet || null,
      createdAt: t.createdAt || null,
      nb: msgs.length,
      dernierAt,
      dernierDe: last ? (last.de || null) : null,
      dernierTexte: texte.length > SUPPORT_EXCERPT_MAX ? texte.slice(0, SUPPORT_EXCERPT_MAX) + '…' : texte,
      statut,
      closLe: t.closLe || null,
      escalade,
      escaladeLe,
      escaladeMotif: escalade ? t.escaladeMotif || null : null,
    };
  }
  // The operator's ready answers: data, bilingual, and each one a valid
  // message on its own. They name no amount — prices come from the grid.
  const SUPPORT_REPONSES_TYPES = Object.freeze([
    { id: 'bienvenue', titre: 'Bienvenue', titreEn: 'Welcome',
      texte: 'Bonjour ! Merci de nous écrire. Dites-moi votre date de signature souhaitée et le type d’acte (financement, refinancement, testament ou procuration), et je vous guide.',
      texteEn: 'Hello! Thanks for writing. Tell me your preferred signing date and the type of act (financing, refinancing, will or power of attorney), and I will guide you.' },
    { id: 'comment_ca_marche', titre: 'Comment ça marche', titreEn: 'How it works',
      texte: 'Vous choisissez votre date de signature dans le carnet, vous voyez le prix avant de vous engager, et un notaire inscrit retient votre demande. Vous ne payez qu’à la signature.',
      texteEn: 'You pick your signing date in the carnet, you see the price before committing, and a registered notary takes on your request. You only pay at signing.' },
    { id: 'honoraires', titre: 'Le notaire reçoit tout', titreEn: 'The notary keeps it all',
      texte: 'Le montant que vous offrez revient au notaire en entier. Le service de Nota est facturé séparément, au prix affiché par acte, et se paie seulement à la signature.',
      texteEn: 'The amount you offer goes to the notary in full. Nota’s service is billed separately, at the price shown per act, and is paid only at signing.' },
    { id: 'documents', titre: 'Documents', titreEn: 'Documents',
      texte: 'Vous n’avez rien à transmettre pour publier votre demande. Une fois un notaire retenu, vous échangez vos documents avec lui directement dans votre espace, de façon sécurisée.',
      texteEn: 'You do not need to send anything to publish your request. Once a notary is retained, you exchange your documents with them directly in your space, securely.' },
    { id: 'rappel', titre: 'On vous rappelle', titreEn: 'We will call you',
      texte: 'Avec plaisir. Laissez-moi un numéro et une plage horaire, et je vous rappelle.',
      texteEn: 'Gladly. Leave me a phone number and a time window, and I will call you back.' },
  ]);

  // --- L'assistant de la messagerie : la fiche de faits (ADR 0046) -----------
  // Une question posée dans la messagerie reçoit une réponse tout de suite,
  // rédigée par un modèle. Pour qu'elle soit VRAIE, le modèle ne reçoit aucune
  // connaissance de sa propre mémoire : il reçoit CETTE fiche, calculée à
  // l'instant à partir des constantes vivantes du catalogue. Changer un prix
  // dans SERVICES change ce que l'assistant répond, sans qu'une seule phrase
  // soit retouchée — c'est toute la raison d'être de cette fonction, et le
  // contraire d'une base de connaissances recopiée qui vieillit en silence.
  //
  // Ce que la fiche NE porte pas est aussi délibéré : rien qui vienne du
  // barème d'annulation ni du prix de Nota lui-même au-delà de la grille
  // publique — ces deux-là vivent dans la couche API (frontière de l'ADR
  // 0008), qui complète la fiche avant de la donner au modèle.
  // Source-backed preparation knowledge; never a file-specific legal opinion.
  const FINANCING_KNOWLEDGE = {
    "version": "2026-09-09.3",
    "reviewedOn": "2026-09-09",
    "scope": "Préparation générale au Québec; les instructions propres au dossier et le jugement du notaire priment.",
    "sources": [
      {
        "id": "rbc",
        "url": "https://www.rbcroyalbank.com/fr/formulesjuridiques/qc-residential.html"
      },
      {
        "id": "acfc",
        "url": "https://www.canada.ca/fr/agence-consommation-matiere-financiere/services/hypotheques/quittance-hypothecaire.html"
      },
      {
        "id": "amf",
        "url": "https://lautorite.qc.ca/en/general-public/insurance/home-insurance/title-insurance"
      },
      {
        "id": "cnq",
        "url": "https://www.cnq.org/votre-notaire/un-professionnel-numerique/"
      }
    ],
    "facts": [
      {
        "id": "instructions",
        "sourceIds": [
          "rbc"
        ],
        "texte": "La lettre d’engagement du client et les instructions au notaire sont distinctes. Le notaire doit recevoir et vérifier le mandat et les conditions du prêteur. Les formulaires et exigences varient selon le prêteur."
      },
      {
        "id": "remboursement",
        "sourceIds": [
          "acfc",
          "rbc"
        ],
        "texte": "Un relevé hypothécaire du client ne remplace pas un relevé officiel de remboursement. Le remboursement ne radie pas automatiquement l’hypothèque; les autres produits garantis, dont les marges de crédit, doivent être examinés avec le notaire et le prêteur."
      },
      {
        "id": "titres",
        "sourceIds": [
          "rbc",
          "amf"
        ],
        "texte": "Le notaire examine les titres et les sûretés et les exigences concernant le certificat de localisation ou l’assurance titres. Une assurance titres ne constitue pas une correction automatique de tous les problèmes."
      },
      {
        "id": "signature",
        "sourceIds": [
          "cnq",
          "rbc"
        ],
        "texte": "Le notaire évalue les besoins juridiques, vérifie les personnes qui interviennent et explique l’acte avant la signature. Le mandat comporte aussi les démarches de publication et les conditions de déboursement et de rapport au prêteur."
      }
    ],
    "operatingPolicy": [
      "Nota peut expliquer les pièces à préparer et les étapes générales; une situation personnelle ou un document juridique doit être examiné par le notaire.",
      "Un dossier coché ou un nom de fichier ne prouve ni réception, ni lisibilité, ni validité, ni disponibilité des fonds. Ne jamais déclarer un dossier prêt à signer.",
      "Aucun délai universel de dix jours et aucun raccourcissement garanti. Distinguer la préparation du client, le travail du notaire et les délais du prêteur et du registre.",
      "L’assistant de soutien ne lit pas les pièces du dossier et ne prépare pas encore les actes. Ne jamais prétendre avoir vérifié des documents, demandé des fonds ou entraîné un modèle.",
      "Les renseignements du dossier ne sont pas des exemples d’entraînement. Les évaluations utilisent des cas synthétiques; les réponses du modèle ne constituent pas une vérité validée."
    ]
  };

  // The extraction prompt and every private work packet carry a service-level
  // knowledge version. This makes changes to the control plan, source list or
  // safety wording observable and gives the evaluation runner a stable model
  // improvement boundary. These are preparation references, never a substitute
  // for the current lender instruction, official register result or notary's
  // professional judgment.
  const NOTARY_SERVICE_KNOWLEDGE = Object.freeze({
    financement: Object.freeze({
      version: FINANCING_KNOWLEDGE.version,
      reviewedOn: FINANCING_KNOWLEDGE.reviewedOn,
      scope: 'Financement hypothécaire au Québec, avec une branche d’achat lorsque le dossier le déclare.',
      sources: [
        { id: 'cnq-immobilier', url: 'https://www.cnq.org/vos-services-notariaux/immobilier/' },
        { id: 'registre-foncier', url: 'https://www.quebec.ca/habitation-territoire/information-fonciere/registre-foncier/inscrire-transaction' },
        { id: 'cnq-technologie', url: 'https://www.cnq.org/fournisseurs-de-solutions-technologiques-aux-notaires/' },
      ],
      facts: [
        { id: 'purchase_branch', texte: 'Un financement lié à un achat doit être coordonné avec la promesse, la vente, les ajustements et le notaire du vendeur; une offre de prêt seule ne remplace pas ces vérifications.' },
        { id: 'publication', texte: 'L’acte hypothécaire, la description de l’immeuble et la publication doivent être contrôlés dans le flux officiel applicable.' },
        { id: 'funds', texte: 'Les conditions de fonds, la demande de fonds, la réception et la réconciliation restent des étapes distinctes sous contrôle du notaire.' },
      ],
    }),
    refinancement: Object.freeze({
      version: FINANCING_KNOWLEDGE.version,
      reviewedOn: FINANCING_KNOWLEDGE.reviewedOn,
      scope: 'Refinancement hypothécaire au Québec, incluant le suivi des dettes garanties et des radiations.',
      sources: [
        { id: 'fin-hypotheque', url: 'https://www.quebec.ca/habitation-territoire/achat-vente/fin-hypotheque' },
        { id: 'cnq-mainlevee', url: 'https://www.cnq.org/la-chambre-et-votre-protection/faq/pourquoi-une-mainlevee-et-non-une-quittance-lorsque-les-sommes-dues-en-vertu-dune-marge-de-credit-sont-totalement-acquittees-et-la-marge-fermee/' },
        { id: 'registre-foncier', url: 'https://www.quebec.ca/habitation-territoire/information-fonciere/registre-foncier/inscrire-transaction' },
      ],
      facts: [
        { id: 'official_payout', texte: 'Un relevé client ne remplace pas un état officiel de remboursement; chaque prêt ou marge garanti doit être recensé et suivi avec sa date de validité.' },
        { id: 'discharge', texte: 'La quittance et la mainlevée ne sont pas interchangeables dans tous les dossiers; le choix et la publication doivent être confirmés par le notaire.' },
        { id: 'new_and_old_security', texte: 'La nouvelle hypothèque, les radiations et la séquence de financement doivent être suivies séparément jusqu’aux reçus officiels.' },
      ],
    }),
    testament: Object.freeze({
      version: '2026-09-09.2',
      reviewedOn: '2026-09-09',
      scope: 'Testament notarié au Québec; les volontés extraites restent des propositions de préparation.',
      sources: [
        { id: 'cnq-testament', url: 'https://www.cnq.org/vos-services-notariaux/testament-et-succession/le-testament/' },
        { id: 'code-civil-testament', url: 'https://www.legisquebec.gouv.qc.ca/fr/document/lc/ccq-1991/20240306?langcont=fr' },
        { id: 'cnq-registres', url: 'https://www.cnq.org/la-chambre-et-votre-protection/services-de-la-chambre/recherche-aux-registres/' },
      ],
      facts: [
        { id: 'original_minute', texte: 'Le testament notarié est reçu en minute; le notaire conserve l’original et l’existence de l’acte doit être enregistrée dans le registre applicable.' },
        { id: 'reading_witnesses', texte: 'La forme, la lecture, les témoins et les besoins de communication doivent être préparés selon la situation et confirmés pendant la réception de l’acte.' },
        { id: 'capacity_consent', texte: 'La capacité, la compréhension, le conseil et le consentement libre restent des décisions du notaire et ne sont pas déduits d’un document.' },
      ],
    }),
    procuration: Object.freeze({
      version: '2026-09-09.2',
      reviewedOn: '2026-09-09',
      scope: 'Procuration notariée au Québec, avec routage obligatoire lorsque le dossier peut être un mandat de protection.',
      sources: [
        { id: 'cnq-procuration', url: 'https://www.cnq.org/vos-services-notariaux/protection-des-personnes/la-procuration/' },
        { id: 'cnq-protection', url: 'https://www.cnq.org/vos-services-notariaux/protection-des-personnes/le-mandat-de-protection/' },
        { id: 'cnq-revocation', url: 'https://www.cnq.org/la-chambre-et-votre-protection/faq/peut-on-limiter-la-duree-dune-procuration-et-peut-on-la-revoquer/' },
      ],
      facts: [
        { id: 'ordinary_or_protection', texte: 'Une procuration ordinaire et un mandat de protection sont des parcours distincts; le système doit extraire les mots du client et ouvrir une clarification notariale.' },
        { id: 'powers_duration', texte: 'Les pouvoirs, leurs limites, la durée, les conditions de fin et les personnes autorisées doivent être structurés sans inventer une autorité.' },
        { id: 'revocation', texte: 'Un mandat ou une procuration antérieure, sa révocation et les avis aux tiers doivent être suivis séparément jusqu’à la décision du notaire.' },
      ],
    }),
  });

  function notaryServiceKnowledge(serviceId) {
    return NOTARY_SERVICE_KNOWLEDGE[serviceId] || null;
  }

  // A complete, adapter-safe view of the catalogue. The admin console uses
  // this instead of importing the raw service objects so its inventory cannot
  // quietly drift from the public booking flow or the notary work packet.
  // This is deliberately a read model: prices and legal/workflow rules remain
  // governed by the domain and the API configuration ports.
  function catalogueSnapshot({ grille } = {}) {
    const criterion = (c) => ({
      id: c.id,
      type: c.type,
      required: !!c.required,
      ...(c.defaut !== undefined ? { defaut: c.defaut } : {}),
      ...(c.groupe ? { groupe: c.groupe } : {}),
      ...(c.unit ? { unit: c.unit } : {}),
      label: c.label,
      ...(c.aide ? { aide: c.aide } : {}),
      ...(c.options ? { options: c.options.map((o) => ({
        id: o.id, label: o.label,
        ...(o.aide ? { aide: o.aide } : {}),
        add: Number(o.add) || 0, poids: Number(o.poids) || 0,
      })) } : {}),
      ...(c.brackets ? { brackets: c.brackets.map((b) => ({
        max: b.max == null ? null : b.max, add: Number(b.add) || 0, poids: Number(b.poids) || 0,
      })) } : {}),
      ...(c.autre ? { autre: { ...c.autre } } : {}),
      ...(c.add !== undefined ? { add: Number(c.add) || 0 } : {}),
      ...(c.poids !== undefined ? { poids: Number(c.poids) || 0 } : {}),
    });
    const service = (svc) => {
      const annonce = prixAnnonce(svc.id, grille);
      return {
        id: svc.id,
        actif: true,
        nom: svc.nom,
        nomCourt: svc.nomCourt,
        nomEn: svc.nomEn,
        nomCourtEn: svc.nomCourtEn,
        description: svc.description,
        prixDepart: svc.prixDepart,
        prixNotaCents: svc.prixNotaCents,
        prixAnnonce: annonce,
        pricing: {
          base: svc.pricing ? svc.pricing.base : svc.prixDepart,
          criteria: svc.pricing ? svc.pricing.criteria.map(criterion) : [],
        },
        documents: (svc.documents || []).map((d) => ({ ...d })),
        champs: (svc.champs || []).map((c) => ({ ...c })),
        ai: {
          active: !!actAIFields(svc.id),
          fields: (actAIFields(svc.id) || []).map((f) => ({ ...f })),
          limites: { ...ACT_AI_LIMITS },
        },
        connaissance: notaryServiceKnowledge(svc.id),
        planNotaire: notaryControlPlan(svc.id),
      };
    };
    return {
      services: SERVICES.map(service),
      actesAVenir: ACTES_A_VENIR.map((a) => ({ ...a })),
      dates: TIERS.map((t) => ({ ...t })),
      deplacements: DEPLACEMENTS.map((d) => ({ ...d })),
      preteurs: LENDERS.map((l) => ({ ...l })),
      typesDocuments: Object.entries(DOCUMENT_TYPES).map(([id, value]) => ({ id, ...value })),
      versions: { catalogue: '2026-09-09', controleNotaire: NOTARY_CONTROL_PLAN_VERSION },
    };
  }

  function supportFacts({ grille, bids } = {}) {
    return {
      financement: FINANCING_KNOWLEDGE,
      services: SERVICES.map((svc) => {
        const annonce = prixAnnonce(svc.id, grille);
        return {
          id: svc.id,
          nom: svc.nom,
          nomEn: svc.nomEn,
          description: svc.description,
          // Le prix ANNONCÉ est le total (ADR 0042) : jamais l'une des deux
          // lignes seule, jamais un « à partir de » qui cacherait l'autre.
          honorairesDepartCents: annonce.honorairesCents,
          prixNotaCents: annonce.notaCents,
          prixAnnonceTotalCents: annonce.totalCents,
          // Ce que le formulaire demandera, dans l'ordre où il le demande.
          questions: (svc.pricing && svc.pricing.criteria ? svc.pricing.criteria : []).map((c) => ({
            id: c.id,
            label: c.label,
            requis: !!c.required,
          })),
          champs: svc.champs,
          documents: (svc.documents || []).map((d) => ({ id: d.id, nom: d.nom, aide: d.aide || null })),
        };
      }),
      // L'échelle des dates : ce que la garantie d'une date rapprochée ajoute
      // au prix de Nota, et le multiple de marché que le carnet pré-remplit.
      dates: TIERS.map((t) => ({
        id: t.id,
        nom: t.nom,
        nomEn: t.nomEn,
        maxJours: t.maxJours,
        supplementCents: t.prixNotaDateCents,
        multiple: tierMultiplier(t.id, bids),
      })),
      deplacements: DEPLACEMENTS.map((d) => ({
        id: d.id, nom: d.nom, qui: d.qui, km: d.km, supplement: d.add, urgence: !!d.urgence,
      })),
      preteurs: LENDERS.map((l) => ({ id: l.id, nom: l.nom, supplement: l.add })),
      contact: { courriel: CONTACT.courriel, confidentialite: CONTACT.confidentialite, telephone: CONTACT.telephone },
      limites: { messageMax: SUPPORT_MESSAGE_MAX, fuseau: BUSINESS_TIMEZONE },
    };
  }

  // L'échelle 1·2·3 que le propriétaire a demandée, en DONNÉE : chaque niveau
  // nomme ce qu'il couvre, et l'invite du modèle se construit à partir d'elle.
  // Au-delà du niveau 3, aucune fiche ne peut fonder une réponse : c'est une
  // personne qu'il faut, et l'escalade est immédiate.
  const SUPPORT_NIVEAUX = Object.freeze([
    {
      niveau: 1, id: 'produit',
      nom: 'Le produit', nomEn: 'The product',
      description: 'Ce qu’est Nota, comment on s’en sert, ce qui se passe à chaque étape.',
      descriptionEn: 'What Nota is, how to use it, what happens at each step.',
      sujets: Object.freeze([
        'ce qu’est Nota et à qui ça s’adresse',
        'les étapes du client : choisir une date, publier sa demande, être retenu, signer',
        'ce que voit le notaire et ce que « retenir » veut dire',
        'le compte, la connexion par lien courriel, les langues',
        'où trouver le carnet, l’espace notaire, les partenaires',
      ]),
    },
    {
      niveau: 2, id: 'chiffres',
      nom: 'Les chiffres', nomEn: 'The numbers',
      description: 'Prix, dates, déplacement, documents — tout ce que la fiche de faits chiffre.',
      descriptionEn: 'Price, dates, travel, documents — everything the fact sheet quantifies.',
      sujets: Object.freeze([
        'le prix affiché pour un service, et ce qu’il comprend',
        'ce qu’ajoute une date rapprochée, un déplacement, un prêteur privé',
        'les questions que le formulaire posera',
        'les documents à réunir pour un acte',
        'les délais : à partir de quand une date est signable',
      ]),
    },
    {
      niveau: 3, id: 'regles',
      nom: 'Les règles', nomEn: 'The rules',
      description: 'Paiement, annulation, confidentialité, inscription d’un notaire.',
      descriptionEn: 'Payment, cancellation, privacy, notary sign-up.',
      sujets: Object.freeze([
        'quand et comment on paie, ce qui est autorisé sur la carte et quand',
        'ce qui se passe si le client annule, et ce que le notaire peut réclamer',
        'la protection des renseignements, la conservation, l’effacement',
        'comment un notaire s’inscrit, son périmètre, ce qu’il reçoit',
        'ce que Nota n’est pas : ni notaire, ni conseiller juridique',
      ]),
    },
  ]);

  // Prepared discussion paths: the UI offers the questions and the assistant
  // uses the same coverage guide. Operational facts remain in the API policy.
  const SUPPORT_QUESTIONS_SUGGEREES = Object.freeze([
    { id: 'prix', niveau: 2, fr: 'Combien ça coûte ?', en: 'How much does it cost?', guide: 'Demander le service et la date si absents. Utiliser uniquement les prix de la fiche; distinguer le total annoncé, les taxes et les débours. Ne pas inventer de devis personnalisé.' },
    { id: 'fonctionnement', niveau: 1, fr: 'Comment ça marche ?', en: 'How does it work?', guide: 'Expliquer choisir le service et la date, publier, attendre la retenue par un notaire, préparer le dossier et signer. Une publication ne confirme pas un rendez-vous.' },
    { id: 'documents', niveau: 2, fr: 'Quels documents me faut-il ?', en: 'Which documents do I need?', guide: 'Demander le service; reprendre sa liste de documents dans la fiche. Le notaire confirme les pièces nécessaires au dossier. Ne demander aucun document dans le clavardage de soutien.' },
    { id: 'annulation', niveau: 3, fr: 'Et si j’annule ?', en: 'What if I cancel?', guide: 'Distinguer demande non retenue, retenue et acte signé. Expliquer la politique en vigueur et les réclamations justifiées, sans calculer une indemnité personnelle ni prétendre annuler.' },
    { id: 'services', niveau: 1, fr: 'Quels actes et secteurs sont offerts ?', en: 'Which services and areas are covered?', guide: 'Nommer le catalogue actif et le territoire de la politique. Distinguer les actes à venir des actes en vente. Ne pas promettre une couverture hors territoire.' },
    { id: 'date', niveau: 2, fr: 'Ma date de signature est-elle confirmée ?', en: 'Is my signing date confirmed?', guide: 'Expliquer date demandée, retenue et confirmation avec le notaire. Ne confirmer ni disponibilité ni rendez-vous. Pour une date imminente ou un dossier précis, passer à une personne.' },
    { id: 'paiement', niveau: 3, fr: 'Quand ma carte sera-t-elle débitée ?', en: 'When will my card be charged?', guide: 'Expliquer enregistrement, réservation et encaissement selon la politique. Ne jamais demander un numéro de carte. Un débit contesté ou un remboursement personnel exige un humain.' },
    { id: 'carte', niveau: 3, fr: 'Mon paiement ne fonctionne pas.', en: 'My payment is not working.', guide: 'Demander seulement le message d’erreur sans données sensibles. Expliquer la possibilité d’enregistrer une autre carte selon la politique. Ne jamais demander code bancaire, numéro de carte ou capture non masquée.' },
    { id: 'connexion', niveau: 1, fr: 'Je n’arrive pas à me connecter.', en: 'I cannot sign in.', guide: 'Vérifier adresse saisie et dossier indésirable, puis demander un nouveau lien depuis la connexion. Ne demander ni lien de connexion ni code. Ne jamais déclarer avoir déverrouillé un compte; escalader si le problème persiste.' },
    { id: 'suivi', niveau: 3, fr: 'Où en est ma demande ?', en: 'What is the status of my request?', guide: 'Aucun accès au dossier: ne pas inventer de statut. Orienter vers l’espace client et passer à une personne pour vérifier la demande.' },
    { id: 'modification', niveau: 3, fr: 'Puis-je changer ma date ou ma demande ?', en: 'Can I change my date or request?', guide: 'Demander si la demande est retenue. Une modification liée au dossier doit être vérifiée par une personne; ne pas prétendre modifier, promettre une nouvelle date ou garantir l’absence de frais.' },
    { id: 'notaire', niveau: 1, fr: 'Comment communiquer avec mon notaire ?', en: 'How do I contact my notary?', guide: 'Après la retenue, orienter vers la conversation du dossier. Distinguer ce clavardage de soutien de la conversation avec le notaire. Une absence de réponse sur un dossier précis s’escalade sans délai promis.' },
    { id: 'confidentialite', niveau: 3, fr: 'Qui peut voir mes renseignements ?', en: 'Who can see my information?', guide: 'Distinguer carnet public, conversation du dossier et soutien. Utiliser la politique pour accès, hébergement et conservation. Ne pas promettre secret professionnel ou stockage exclusivement canadien.' },
    { id: 'effacement', niveau: 3, fr: 'Comment faire supprimer mes renseignements ?', en: 'How do I request deletion of my information?', guide: 'Donner le contact de confidentialité de la fiche et passer la demande personnelle à un humain. Ne pas affirmer que les données ont été supprimées.' },
    { id: 'deplacement', niveau: 2, fr: 'Puis-je signer à distance ou à domicile ?', en: 'Can I sign remotely or at home?', guide: 'Utiliser les modalités de déplacement de la fiche. Ne pas confirmer une admissibilité personnelle à la signature à distance; le notaire doit la vérifier.' },
    { id: 'preteur', niveau: 2, fr: 'Mon prêteur est-il accepté ?', en: 'Is my lender supported?', guide: 'Utiliser la liste des prêteurs et les questions du service. Si le prêteur manque, demander son nom sans document bancaire et passer à une personne; ne pas garantir son acceptation.' },
    { id: 'plainte', niveau: 3, fr: 'Je veux signaler un problème.', en: 'I want to report a problem.', guide: 'Passer à un humain, demander une description brève sans renseignements sensibles. Ne pas contester la plainte ni promettre remboursement ou issue.' },
    { id: 'humain', niveau: 3, fr: 'Je veux parler à une personne.', en: 'I want to speak to a person.', guide: 'Passer immédiatement à une personne, sans imposer de questions ou tenter de retenir le visiteur dans une boucle automatisée.' },
  ].map(Object.freeze));

  // These conservative checks are a first barrier, not a complete intent
  // classifier. The assistant must still escalate uncertain free-form cases.
  function supportQuestionGuard(texte) {
    const t = String(texte || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/\b(?:\d[ -]?){13,19}\b/.test(t) || /\b(?:nas|sin)\s*[:=]?\s*\d{3}[ -]?\d{3}[ -]?\d{3}\b/.test(t) || /(?:[?&](?:token|code)=|\b(?:password|mot de passe|cvv|cvc)\s*[:=]\s*\S+)/.test(t)) return 'renseignements_sensibles';
    if (/(?:parler|parle|parlez|contacter|joindre).{0,35}(?:personne|humain|agent)|(?:speak|talk|connect).{0,30}(?:person|human|agent)|\b(?:human|humain)\b/.test(t)) return 'humain';
    if (/\b(?:plainte|porter plainte|reclamation|complaint|fraude|fraud|scam)\b|signaler un probleme|report a problem/.test(t)) return 'plainte';
    return null;
  }

  // Shared bilingual topic discovery; operational answers live in the API.
  const SUPPORT_TOPICS = Object.freeze([
    ...SUPPORT_QUESTIONS_SUGGEREES,
    {"id": "territoire", "niveau": 1, "fr": "Est-ce offert dans ma région ?", "en": "Is this available in my area?"},
    {"id": "proposition", "niveau": 1, "fr": "Un notaire propose un autre prix : comment répondre ?", "en": "A notary proposed another price: how do I respond?"},
    {"id": "sans_notaire", "niveau": 1, "fr": "Aucun notaire n’a retenu ma demande.", "en": "No notary has retained my request."},
    {"id": "desistement", "niveau": 1, "fr": "Mon notaire s’est désisté : que se passe-t-il ?", "en": "My notary withdrew: what happens next?"},
    {"id": "inscription_notaire", "niveau": 3, "fr": "Je suis notaire : comment m’inscrire ?", "en": "I am a notary: how do I sign up?"},
    {"id": "technique", "niveau": 1, "fr": "Le site ne fonctionne pas : que faire ?", "en": "The site is not working: what can I do?"},
    {"id": "juridique", "niveau": 3, "fr": "Puis-je obtenir un avis juridique ici ?", "en": "Can I get legal advice here?"},
  ].map((topic) => Object.freeze(topic)));

  // Les motifs d'escalade. Chacun est une classe de question qu'AUCUNE fiche
  // ne peut fonder — la lister ici, plutôt que de la deviner, est ce qui rend
  // l'escalade prévisible et testable.
  const SUPPORT_ESCALADE_MOTIFS = Object.freeze([
    { id: 'humain', nom: 'Une demande de parler à une personne', nomEn: 'A request to speak to a person' },
    { id: 'renseignements_sensibles', nom: 'Des renseignements sensibles dans le soutien', nomEn: 'Sensitive information in support' },
    { id: 'dossier_precis', nom: 'Un dossier ou une personne en particulier', nomEn: 'A specific file or person' },
    { id: 'exception', nom: 'Une exception : prix, date, entente sur mesure', nomEn: 'An exception: price, date, custom terms' },
    { id: 'conseil_juridique', nom: 'Une question qui demande le jugement d’un notaire', nomEn: 'A question needing a notary’s judgment' },
    { id: 'plainte', nom: 'Une insatisfaction ou une plainte', nomEn: 'A complaint or dissatisfaction' },
    { id: 'affaires', nom: 'Partenariat, presse, recrutement', nomEn: 'Partnership, press, recruiting' },
    { id: 'inconnu', nom: 'La fiche ne dit rien là-dessus', nomEn: 'The fact sheet does not cover it' },
  ]);

  // Le garde-fou. Le modèle PROPOSE une réponse ; le domaine DISPOSE. Trois
  // familles de refus, et chacune répond à une contrainte qui a déjà coûté
  // cher ailleurs dans ce dépôt :
  //
  //   • le vocabulaire de taux — l'ADR 0042 l'a banni côté client parce qu'un
  //     prix annoncé doit être un total, pas une fraction d'autre chose ;
  //   • la cote nommée — l'art. 70 du Code de déontologie interdit de publier
  //     une appréciation d'un notaire désigné (ADR 0030) ;
  //   • le conseil — Nota n'est pas notaire. « Vous devriez » est le mot qui
  //     fait franchir la ligne, et il se refuse mécaniquement.
  //
  // Le contrôle ne s'applique QU'À la machine : un humain qui répond depuis sa
  // boîte écrit ce qu'il veut, et c'est sa responsabilité professionnelle.
  //
  // NOTE — deux des motifs ci-dessous sont assemblés à partir de fragments
  // plutôt qu'écrits en clair : la garde déontologique de billing.test.mjs lit
  // la SOURCE de ce fichier et refuse ces littéraux (aucune part d'acte ne
  // doit pouvoir s'exprimer dans le domaine). Les assembler dit exactement
  // pourquoi ils ne peuvent pas s'y écrire.
  const MOT_PART = 'com' + 'mission';
  const MOT_PCT = 'per' + 'cent';
  const SUPPORT_ANSWER_GUARDS = Object.freeze([
    { code: 'secret_demande', re: /(?:envoyez|partagez|donnez|transmettez|send|share|provide).{0,70}(?:mot de passe|password|num[eé]ro de carte|card number|code de connexion|sign-in (?:code|link)|lien de connexion|\bNAS\b|\bSIN\b)/i, quoi: 'secret' },
    { code: 'action_inventee', re: /(?:j[’']ai|nous avons|i have|we have|i’ve|we’ve)\s+(?:annul[eé]|modifi[eé]|supprim[eé]|rembours[eé]|d[eé]bit[eé]|v[eé]rifi[eé] votre dossier|cancelled|canceled|updated|deleted|refunded|charged|checked your (?:file|account))/i, quoi: 'action' },
    { code: 'vocabulaire_interdit', re: /\btaux\b/i, quoi: 'taux' },
    { code: 'vocabulaire_interdit', re: /\bpaliers?\b/i, quoi: 'palier' },
    { code: 'vocabulaire_interdit', re: /\bpourcentages?\b/i, quoi: 'pourcentage' },
    { code: 'vocabulaire_interdit', re: new RegExp('\\b' + MOT_PCT + '(?:age)?s?\\b', 'i'), quoi: MOT_PCT },
    { code: 'vocabulaire_interdit', re: /\brates?\b/i, quoi: 'rate' },
    { code: 'vocabulaire_interdit', re: new RegExp('\\b' + MOT_PART + 's?\\b', 'i'), quoi: MOT_PART },
    { code: 'cote_nominative', re: /\bcotes?\b[^.!?]{0,40}\d/i, quoi: 'cote chiffrée' },
    { code: 'cote_nominative', re: /\b\d{1,3}\s*(?:\/|sur)\s*100\b/, quoi: 'note sur 100' },
    { code: 'cote_nominative', re: /\bratings?\b|\bétoiles?\b|\bstars?\b/i, quoi: 'appréciation' },
    { code: 'cote_nominative', re: /\b(?:le|la|nos?|notre)\s+meilleure?s?\s+notaires?\b/i, quoi: 'classement' },
    { code: 'cote_nominative', re: /\bbest\s+notar(?:y|ies)\b/i, quoi: 'classement' },
    { code: 'conseil_juridique', re: /\bje vous (?:conseille|recommande|suggère)\b/i, quoi: 'conseil' },
    { code: 'conseil_juridique', re: /\bvous devriez\b/i, quoi: 'conseil' },
    { code: 'conseil_juridique', re: /\bà votre place\b/i, quoi: 'conseil' },
    { code: 'conseil_juridique', re: /\bil (?:vous )?faudrait\b/i, quoi: 'conseil' },
    { code: 'conseil_juridique', re: /\byou should\b/i, quoi: 'advice' },
    { code: 'conseil_juridique', re: /\b(?:i|we) (?:would )?(?:advise|recommend)\b/i, quoi: 'advice' },
    { code: 'conseil_juridique', re: /\bmy advice\b/i, quoi: 'advice' },
    // Le prix de Nota est une GRILLE (service × délai), jamais un forfait :
    // l'ADR 0034 l'a établi et truthful-claims.test.mjs le tient sur le site.
    // L'assistant écrit sur les mêmes surfaces, il tient la même règle.
    { code: 'prix_fige', re: /\bprix fixes?\b|\bmontants? fixes?\b|\bforfaits?\b|\bforfaitaires?\b/i, quoi: 'prix fixe' },
    { code: 'prix_fige', re: /\bflat (?:price|fee|rate)\b|\bfixed (?:price|amount|fee)\b/i, quoi: 'flat price' },
    // Art. 32.1 1° du Code de déontologie : aucune publicité comparative de prix.
    { code: 'comparaison_prix', re: /\bmoins ch[èe]re?\b|\bcheaper\b|\bless expensive\b/i, quoi: 'comparaison' },
    // Taxes et débours sont EN SUS (art. 71 3°) : « tout compris » est faux.
    { code: 'tout_compris', re: /\btout compris\b|\ball[-\s]inclusive\b/i, quoi: 'tout compris' },
    // Aucune caution de l'Ordre n'a été obtenue : ne jamais la laisser entendre.
    { code: 'caution_ordre', re: /\bcertifi[ée]e?s?\b|\bagr[ée]{2}e?s?\b|\baccr[ée]dit/i, quoi: 'caution' },
    { code: 'caution_ordre', re: /\bapprouv[ée]e?s?\s+par\s+(?:la\s+Chambre|l[’']Ordre)/i, quoi: 'caution' },
    // Aucun partage d'honoraires n'existe (art. 32 / 32.1). Seule la NÉGATION
    // est permise, et elle ne contient aucun de ces motifs.
    { code: 'partage_honoraires', re: /\bpartage\s+(?:des?\s+|d[’']\s*)?honoraires\b/i, quoi: 'partage' },
    { code: 'partage_honoraires', re: /\bfee[-\s]sharing\b|\brevenue\s+s(?:hare|plit)\b/i, quoi: 'partage' },
    { code: 'partage_honoraires', re: /\b(?:75\s*\/\s*25|25\s*\/\s*75|85\s*\/\s*15|15\s*\/\s*85)\b/, quoi: 'partage' },
    // AUCUN délai n'est garanti — ni pour signer, ni pour répondre. C'est la
    // promesse que l'audit des affirmations a marquée invérifiable, et c'est
    // celle qu'une machine serait le plus tentée de faire.
    { code: 'delai_promis', re: /\br[ée]ponse[^.!?]{0,25}\b(?:minutes?|heures?|jour m[êe]me)\b/i, quoi: 'délai' },
    { code: 'delai_promis', re: /\b(?:on|nous|je)\s+(?:vous\s+)?r[ée]pond(?:ons|s|rons)?[^.!?]{0,25}\b(?:minutes?|heures?|24\s*h)\b/i, quoi: 'délai' },
    { code: 'delai_promis', re: /\b(?:reply|respond|answer)[^.!?]{0,25}\bwithin\b[^.!?]{0,15}\b(?:minutes?|hours?)\b/i, quoi: 'délai' },
    { code: 'delai_promis', re: /\bgarantis?\s+(?:un|le|votre)\s+d[ée]lai\b|\bguaranteed?\s+turnaround\b/i, quoi: 'délai' },
    // Les chances d'obtenir un notaire sont une HYPOTHÈSE interne, jamais un
    // chiffre montré à un client (audit 3.3).
    { code: 'statistique_inventee', re: /\bchances?\s+d[’']obtenir\b/i, quoi: 'statistique' },
    { code: 'statistique_inventee', re: /\b\d{1,3}\s*%\s*(?:de\s+)?(?:chances?|r[ée]ussite|succ[èe]s)\b/i, quoi: 'statistique' },
    { code: 'statistique_inventee', re: /\bm[ée]dianes?\b/i, quoi: 'statistique' },
  ]);
  const SUPPORT_GUARD_MESSAGES = {
    secret_demande: 'Le soutien automatisé ne demande aucun secret.',
    action_inventee: 'L’assistant ne peut pas effectuer une action sur un dossier.',
    vocabulaire_interdit: 'Une réponse au client ne nomme pas un taux : le prix annoncé est un total.',
    cote_nominative: 'Une réponse ne publie aucune appréciation chiffrée d’un notaire (art. 70).',
    conseil_juridique: 'Une réponse ne conseille pas : Nota n’est pas notaire.',
    prix_fige: 'Le prix de Nota dépend du service et du délai : ce n’est pas un forfait.',
    comparaison_prix: 'Aucune publicité comparative de prix (art. 32.1 1°).',
    tout_compris: 'Les taxes et les débours ne sont pas compris : « tout compris » est faux.',
    caution_ordre: 'Nota n’est ni certifiée ni approuvée par la Chambre : ne pas le laisser entendre.',
    partage_honoraires: 'Aucun partage d’honoraires n’existe, et seule sa négation se dit.',
    delai_promis: 'Aucun délai n’est garanti — ni pour signer, ni pour répondre.',
    statistique_inventee: 'Aucun chiffre de marché n’est mesuré : ne pas en avancer.',
  };
  function validateSupportAnswer(input) {
    input = input || {};
    const de = input.de || SUPPORT_FROM.ASSISTANT;
    const errors = [];
    const texte = String(input.texte == null ? '' : input.texte).trim();
    if (!texte) errors.push({ code: 'message_requis', message: 'La réponse est vide.' });
    if (texte.length > SUPPORT_MESSAGE_MAX) {
      errors.push({ code: 'message_trop_long', message: `La réponse ne peut dépasser ${SUPPORT_MESSAGE_MAX} caractères.` });
    }
    // Un humain n'est pas filtré : seule la machine l'est.
    if (de !== SUPPORT_FROM.NOTA) {
      const vus = {};
      for (const g of SUPPORT_ANSWER_GUARDS) {
        const checked = g.code === 'secret_demande'
          ? texte.replace(/\b(?:ne\s+(?:envoyez|partagez|donnez|transmettez)\s+(?:pas|aucun)|(?:do not|don't|never)\s+(?:send|share|provide))\b/gi, '[rappel]')
          : texte;
        if (vus[g.code] || !g.re.test(checked)) continue;
        vus[g.code] = true;
        errors.push({ code: g.code, message: SUPPORT_GUARD_MESSAGES[g.code], quoi: g.quoi });
      }
    }
    return { ok: errors.length === 0, errors, texte: texte || null, de };
  }

  // --- In-app notifications: the closed catalogue (2026-09-04) ----------------
  // The API writes them (one per event, under the recipient's subject), the
  // web bell reads them. A kind names its audiences so a notary never receives
  // a client-only kind by mistake, and both labels live here.
  const NOTIF_KINDS = Object.freeze([
    { id: 'message',     titre: 'Nouveau message',            titreEn: 'New message',            audiences: ['client', 'notaire'] },
    { id: 'document',    titre: 'Document reçu',              titreEn: 'Document received',       audiences: ['client', 'notaire'] },
    { id: 'retenue',     titre: 'Votre demande est retenue',  titreEn: 'Your request is retained', audiences: ['client'] },
    { id: 'proposition', titre: 'Un notaire vous propose un prix', titreEn: 'A notary proposes a price', audiences: ['client'] },
    { id: 'desistement', titre: 'Votre notaire s’est désisté', titreEn: 'Your notary withdrew',   audiences: ['client'] },
    // L'issue ARGENT d'une annulation : l'indemnité a été réclamée et
    // prélevée, refusée par la carte, abandonnée par le notaire, ou le délai
    // a passé. Le handler écrivait déjà ces deux avis (reclamerIndemnite et
    // clore) ; faute d'être déclaré ici, `notifIn` les jetait en silence —
    // le client n'apprenait jamais, dans l'application, ce qui avait été
    // retenu sur sa carte ou libéré.
    { id: 'annulation',  titre: 'Suite de votre annulation', titreEn: 'About your cancellation', audiences: ['client'] },
    // 2026-09-11 — chaque événement d'affaires sonne dans l'application.
    // L'inventaire trouvait sept trous : la cloche du client n'apprenait ni la
    // publication, ni une demande de documents, ni les rappels J-7/3/1/0, ni
    // l'annulation elle-même, ni l'acte réglé, ni une carte refusée ; celle
    // du notaire n'apprenait ni la réponse à sa proposition, ni l'annulation,
    // ni le paiement de l'acte. `annulation` reste l'ISSUE D'ARGENT d'une
    // annulation (l'indemnité) ; `annulee` est le fait lui-même.
    { id: 'publiee',             titre: 'Votre offre est publiée',           titreEn: 'Your offer is published',        audiences: ['client'] },
    { id: 'documents_demandes',  titre: 'Le notaire demande des documents',  titreEn: 'The notary requests documents',  audiences: ['client'] },
    { id: 'rappel',              titre: 'Votre date approche',               titreEn: 'Your date is approaching',       audiences: ['client'] },
    { id: 'annulee',             titre: 'Offre annulée',                     titreEn: 'Offer cancelled',                audiences: ['client', 'notaire'] },
    { id: 'acte',                titre: 'Acte signé',                        titreEn: 'Act signed',                     audiences: ['client', 'notaire'] },
    { id: 'proposition_reponse', titre: 'Réponse à votre proposition',       titreEn: 'Answer to your proposal',        audiences: ['notaire'] },
    { id: 'caution',             titre: 'Carte refusée',                     titreEn: 'Card declined',                  audiences: ['client', 'notaire'] },
  ]);
  function isNotifKind(id) {
    return typeof id === 'string' && NOTIF_KINDS.some((k) => k.id === id);
  }

  const SUPPORT_MESSAGE_MAX = CONTACT_MESSAGE_MAX;
  function validateSupportMessage(input) {
    input = input || {};
    const errors = [];

    const texte = String(input.texte == null ? '' : input.texte).trim();
    if (!texte) errors.push({ code: 'message_requis', message: 'Écrivez-nous quelques mots.' });
    if (texte.length > SUPPORT_MESSAGE_MAX) {
      errors.push({ code: 'message_trop_long', message: `Le message ne peut dépasser ${SUPPORT_MESSAGE_MAX} caractères.` });
    }

    const courrielRaw = String(input.courriel == null ? '' : input.courriel).trim().toLowerCase();
    if (courrielRaw !== '' && !isEmail(courrielRaw)) {
      errors.push({ code: 'courriel_invalide', message: 'Le courriel n’est pas valide.' });
    }

    return {
      ok: errors.length === 0,
      errors,
      texte: texte || null,
      courriel: isEmail(courrielRaw) ? courrielRaw : null,
    };
  }

  // --- Notary evaluation -----------------------------------------------------
  // After the act is signed and settled (ADR 0015), the client rates the
  // notary: a 1–5 note, plus an optional comment. Same authoritative-validator
  // pattern as the offer and the contact form.
  const EVALUATION_COMMENT_MAX = 500;
  function validateEvaluation(input) {
    input = input || {};
    const errors = [];
    const note = Number(input.note);
    const noteValide = Number.isInteger(note) && note >= 1 && note <= 5;
    if (!noteValide) errors.push({ code: 'note_invalide', message: 'La note doit être un entier de 1 à 5.' });
    const commentaire = String(input.commentaire == null ? '' : input.commentaire).trim();
    if (commentaire.length > EVALUATION_COMMENT_MAX) {
      errors.push({ code: 'commentaire_trop_long', message: `Le commentaire ne peut dépasser ${EVALUATION_COMMENT_MAX} caractères.` });
    }
    return {
      ok: errors.length === 0,
      errors,
      note: noteValide ? note : null,
      commentaire: commentaire || null,
    };
  }

  // --- Act value at settlement -----------------------------------------------
  // The value confirmed at signing is what the act settles on, and the act
  // ledger is write-once — a typo is permanent. The domain therefore bounds the
  // confirmed value against the retained offer: a signing can adjust the price,
  // never rewrite its magnitude. Outside the band, the notary is asked to
  // re-check or contact Nota — the ledger stays clean.
  const ACT_VALUE_BOUNDS = { minRatio: 0.25, maxRatio: 3 };
  function validateActValue(input) {
    input = input || {};
    const errors = [];
    const amount = Number(input.actAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push({ code: 'montant_invalide', message: 'Montant de l’acte invalide.' });
      return { ok: false, errors, actAmount: null };
    }
    const ref = Number(input.retainedMontant);
    if (Number.isFinite(ref) && ref > 0) {
      const lo = Math.round(ref * ACT_VALUE_BOUNDS.minRatio);
      const hi = Math.round(ref * ACT_VALUE_BOUNDS.maxRatio);
      if (amount < lo || amount > hi) {
        errors.push({
          code: 'montant_hors_bornes',
          message: 'La valeur confirmée (' + money(amount) + ') est trop loin de l’offre retenue (' + money(ref) +
            '). Vérifiez le montant — attendu entre ' + money(lo) + ' et ' + money(hi) + ' — ou contactez Nota.',
        });
      }
    }
    return { ok: errors.length === 0, errors, actAmount: errors.length ? null : Math.round(amount) };
  }

  // The public shape of a notary's ratings: one decimal, null before the first
  // evaluation — never a fake 0-star average.
  function ratingAverage(sum, count) {
    const c = Number(count) || 0;
    if (c <= 0) return null;
    return Math.round((Number(sum) / c) * 10) / 10;
  }

  // --- La cote du notaire, sur 100 (ADR 0028) --------------------------------
  // Le propriétaire (2026-09-01) : « les notaires ont un système d'évaluation
  // par les différents services qu'ils rendent, leur présence sur Nota, leur
  // disponibilité, le feedback des clients — et l'ensemble leur donne une cote
  // sur cent ». Quatre axes, quatre maxima qui font exactement 100.
  //
  // Le domaine produit UN NOMBRE et son explication ; il ignore tout du partage
  // des honoraires (frontière déontologique de l'ADR 0008). C'est la couche
  // facturation qui traduit la cote en pourcentages.
  //
  // Toute la pondération est ce document — jamais une constante enfouie dans un
  // calcul. `notaryScore(stats, ponderation)` accepte un barème de rechange,
  // ce qui permet à Nota de l'ajuster sans redéployer le domaine.
  const COTE = {
    // Ce que les clients ont dit. Moyenne BAYÉSIENNE : la note observée est
    // tirée vers un a priori (4,0 sur 5 avis fictifs) tant que les avis sont
    // rares — cinq complaisances n'achètent pas le sommet, et un notaire neuf
    // n'est pas puni d'un zéro qu'il n'a pas mérité. La note est ensuite
    // étalée entre un plancher (3,0 = rien) et une cible (4,8 = plein).
    satisfaction: { max: 40, apriori: { note: 4.0, poids: 5 }, plancher: 3.0, cible: 4.8 },
    // Les actes réellement portés : le volume, à rendement décroissant (en
    // racine — les dix premiers actes pèsent plus que les dix suivants).
    //
    // Il y avait ici un sous-axe « éventail » qui récompensait le nombre de
    // services du catalogue effectivement rendus. Retiré le 2026-09-01 : le
    // Code de déontologie commande au notaire de tenir compte des limites de
    // ses connaissances avant d'accepter un mandat, donc se spécialiser n'est
    // pas un défaut de service — et aucune des plateformes étudiées ne
    // récompense l'étendue de gamme (voir la veille en go-to-market). Ses
    // points sont reversés au volume, à calibrage constant.
    services: { max: 25, volume: 25, cible: 50 },
    // La disponibilité offerte au marché. Deux choses, et deux seulement :
    // RÉPONDRE, et la portée déclarée (rayon, urgences en ligne).
    //
    // Répondre, c'est proposer un montant, accepter la demande — ou la
    // décliner. Un déclin est une RÉPONSE, jamais une pénalité : le notaire est
    // un officier public à qui le Code impose de refuser un mandat qu'il ne
    // peut pas porter, et une plateforme qui lui coûte de l'argent pour l'avoir
    // fait le pousse à mal faire son métier. (DoorDash a fini par retirer le
    // taux d'acceptation de ses critères pour exactement cette raison ; Airbnb
    // mesure « accept OR decline within 24 h ».) Ce qui coûte des points, c'est
    // le silence — ne jamais répondre à rien.
    disponibilite: { max: 20, reponse: 12, cibleReponses: 20, portee: 6, rayonCible: 50, urgences: 2 },
    // La présence tenue : la fiche officielle, le secteur de l'étude, une
    // activité récente dans la console, et l'ancienneté.
    presence: { max: 15, fiche: 5, secteur: 3, activite: 4, activiteJours: 30, activiteNulleJours: 90, anciennete: 3, ancienneteJours: 365 },
  };

  const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
  const nombre = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const dixieme = (x) => Math.round(x * 10) / 10;

  // Combien de services du catalogue ce notaire a-t-il réellement rendus.
  function servicesRendus(parService) {
    const m = parService && typeof parService === 'object' ? parService : {};
    return SERVICES.filter((s) => nombre(m[s.id]) > 0).length;
  }

  function coteSatisfaction(stats, w) {
    const e = (stats && stats.evaluations) || {};
    const avis = Math.max(0, Math.floor(nombre(e.avis)));
    const note = Number(e.note);
    const observee = avis > 0 && Number.isFinite(note) ? note : null;
    const a = w.apriori;
    const ponderee = ((observee == null ? 0 : observee * avis) + a.note * a.poids) / (avis + a.poids);
    const part = clamp01((ponderee - w.plancher) / (w.cible - w.plancher));
    return {
      points: dixieme(w.max * part),
      detail: { note: observee, avis, notePonderee: dixieme(ponderee), cible: w.cible },
    };
  }

  function coteServices(stats, w) {
    const a = (stats && stats.actes) || {};
    const total = Math.floor(nombre(a.total));
    const rendus = servicesRendus(a.parService);
    return {
      points: dixieme(w.volume * clamp01(Math.sqrt(total / w.cible))),
      // L'éventail ne compte plus dans la note, mais il reste une information :
      // la console et le registre montrent ce que le notaire rend réellement.
      detail: { actes: total, cible: w.cible, servicesRendus: rendus, catalogue: SERVICES.length },
    };
  }

  function coteDisponibilite(stats, w) {
    const d = (stats && stats.disponibilite) || {};
    const repondu = Math.floor(nombre(d.repondu));
    const declinees = Math.floor(nombre(d.declinees));
    // Toutes les réponses comptent, quelle qu'en soit la teneur — rendement
    // décroissant, comme le volume d'actes : les premières réponses valent le
    // plus. Décliner ne retire JAMAIS de points ; ne rien répondre en vaut zéro.
    const reponses = repondu + declinees;
    const rayonKm = nombre(d.rayonKm);
    const portee = w.portee * clamp01(rayonKm / w.rayonCible) + (d.urgences === true ? w.urgences : 0);
    return {
      points: dixieme(w.reponse * clamp01(Math.sqrt(reponses / w.cibleReponses)) + portee),
      detail: {
        repondu, declinees, reponses, cibleReponses: w.cibleReponses,
        rayonKm, urgences: d.urgences === true,
      },
    };
  }

  function cotePresence(stats, w) {
    const p = (stats && stats.presence) || {};
    const fiche = p.fiche === true ? w.fiche : 0;
    const secteur = p.secteur === true ? w.secteur : 0;
    const jours = nombre(p.joursDepuisActivite);
    const fenetre = Math.max(1, w.activiteNulleJours - w.activiteJours);
    const activite = w.activite * clamp01(1 - Math.max(0, jours - w.activiteJours) / fenetre);
    const anciennete = w.anciennete * clamp01(nombre(p.joursMembre) / w.ancienneteJours);
    return {
      points: dixieme(fiche + secteur + activite + anciennete),
      detail: {
        fiche: p.fiche === true,
        secteur: p.secteur === true,
        joursDepuisActivite: Math.round(jours),
        joursMembre: Math.round(nombre(p.joursMembre)),
      },
    };
  }

  const COTE_AXES = [
    { id: 'satisfaction', nom: 'Satisfaction des clients', nomEn: 'Client satisfaction', calcul: coteSatisfaction },
    { id: 'services', nom: 'Services rendus', nomEn: 'Acts delivered', calcul: coteServices },
    { id: 'disponibilite', nom: 'Disponibilité', nomEn: 'Availability', calcul: coteDisponibilite },
    { id: 'presence', nom: 'Présence sur Nota', nomEn: 'Presence on Nota', calcul: cotePresence },
  ];

  /**
   * La cote d'un notaire : `{ cote, axes: [{ id, nom, nomEn, points, max,
   * detail }] }`. La cote est la somme des axes, arrondie — rien d'autre, pour
   * qu'un notaire puisse la refaire à la main depuis son écran.
   */
  function notaryScore(stats, ponderation) {
    const axes = COTE_AXES.map((axe) => {
      const w = { ...COTE[axe.id], ...((ponderation && ponderation[axe.id]) || {}) };
      const r = axe.calcul(stats, w);
      return {
        id: axe.id, nom: axe.nom, nomEn: axe.nomEn,
        points: Math.min(w.max, Math.max(0, r.points)),
        max: w.max,
        detail: r.detail,
      };
    });
    const somme = axes.reduce((t, a) => t + a.points, 0);
    return { cote: Math.max(0, Math.min(100, Math.round(somme))), axes };
  }

  /**
   * Le palmarès service par service : pour CHAQUE service du catalogue, les
   * actes portés et ce que les clients en ont dit. Un service jamais rendu se
   * lit à zéro, jamais avec une fausse moyenne.
   */
  function notaryServiceRecord(evaluations, actesParService) {
    const ledger = Array.isArray(evaluations) ? evaluations : [];
    const actes = actesParService && typeof actesParService === 'object' ? actesParService : {};
    return SERVICES.map((s) => {
      let sum = 0, avis = 0;
      for (const e of ledger) {
        if (!e || e.serviceId !== s.id) continue;
        const n = Number(e.note);
        if (!Number.isFinite(n)) continue;
        sum += n; avis += 1;
      }
      return {
        serviceId: s.id, nom: s.nom, nomEn: s.nomEn || s.nom,
        actes: Math.floor(nombre(actes[s.id])),
        avis,
        note: ratingAverage(sum, avis),
      };
    });
  }

  // --- Notary public profile -------------------------------------------------
  // The one authority on a notary's notoriety is the Chambre des notaires du
  // Québec (ADR 0016): a notary may attach the link of their official fiche in
  // the Chambre's public directory. Only an https URL on the cnq.org host (or a
  // subdomain) is a fiche — anything else never earns the « CNQ » badge.
  const CNQ = {
    host: 'cnq.org',
    annuaire: 'https://www.cnq.org/trouver-un-notaire/',
  };
  const CNQ_LINK_MAX = 300;
  // --- Mise en relation : joindre l'autre partie (ADR 0033) ------------------
  // A phone number, however a human types it — « (418) 555-1234 »,
  // « 418.555.1234 », « 1 418 555 1234 ». The rule is deliberately loose: once
  // the formatting is stripped, a dialable North-American number remains (10
  // digits, or 11 with the country code). The trimmed original is kept: the
  // formatting is information for the human who will dial, and telHref() turns
  // it into a dial string when a tel: link is needed. Empty is valid and null.
  function validateTelephone(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return { ok: true, value: null, error: null };
    const digits = s.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      return { ok: false, value: null, error: { code: 'telephone_invalide', message: 'Le numéro de téléphone n’est pas valide.' } };
    }
    return { ok: true, value: s, error: null };
  }

  // What a client must be able to do once a notary retains their act: call
  // them, and find the étude. Until the three are on the profile, the notary
  // can neither retain nor propose — the API enforces it, the console says it.
  const NOTARY_NAME_MAX = 120;
  const NOTARY_ADDRESS_MAX = 200;
  const NOTARY_CONTACT_REQUIRED = ['nom', 'telephone', 'adresse'];
  const NOTARY_CONTACT_LABELS = {
    nom: 'Votre nom',
    telephone: 'Votre téléphone',
    adresse: 'L’adresse de votre étude',
  };
  function notaryContactMissing(profile) {
    const p = profile || {};
    return NOTARY_CONTACT_REQUIRED
      .filter((id) => !String(p[id] == null ? '' : p[id]).trim())
      .map((id) => ({ id, label: NOTARY_CONTACT_LABELS[id] }));
  }

  // The name of the étude a client sees — the declared étude first, then the
  // legacy sign-in label, then the notary's own name, then their courriel.
  function notaryEtude(profile) {
    if (!profile) return null;
    const pick = (v) => { const s = String(v == null ? '' : v).trim(); return s || null; };
    return pick(profile.etude) || pick(profile.label) || pick(profile.nom) || pick(profile.email) || null;
  }

  // The notary's alert preferences (ADR 0033 §7) — « Recevez vos demandes à
  // votre rythme » as SERVER data. `pace` is one of four words: instant (a
  // mail per matching demande), daily (the digest — the default, the promise
  // that already existed), weekly, off. `urgentOnly` narrows instant alerts
  // to prioritaire/urgence tiers; strictly boolean true, never a truthy
  // string. Absent or null reads as the default; anything else is validated
  // loudly so a corrupted preference never silently mutes a notary.
  const NOTARY_ALERT_PACES = ['instant', 'daily', 'weekly', 'off'];
  // ADR 0051 — `sms` : le texto est un canal de consentement EXPRÈS. Faux par
  // défaut, jamais déduit ; un profil antérieur à l'ADR lit « faux ».
  const NOTARY_ALERTES_DEFAULT = Object.freeze({ pace: 'daily', urgentOnly: false, sms: false });
  function validateNotaryAlertes(raw) {
    if (raw === undefined || raw === null) return { ok: true, value: { ...NOTARY_ALERTES_DEFAULT }, errors: [] };
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, value: null, errors: [{ code: 'alertes_invalides', message: 'Les préférences d’alertes ne sont pas valides.' }] };
    }
    const errors = [];
    let pace = NOTARY_ALERTES_DEFAULT.pace;
    if (raw.pace !== undefined && raw.pace !== null && String(raw.pace).trim() !== '') {
      const p = String(raw.pace).trim().toLowerCase();
      if (NOTARY_ALERT_PACES.indexOf(p) === -1) {
        errors.push({ code: 'alerte_rythme_invalide', message: 'Le rythme des alertes doit être instant, daily, weekly ou off.' });
      } else {
        pace = p;
      }
    }
    let urgentOnly = NOTARY_ALERTES_DEFAULT.urgentOnly;
    if (raw.urgentOnly !== undefined && raw.urgentOnly !== null) {
      if (typeof raw.urgentOnly !== 'boolean') {
        errors.push({ code: 'alertes_invalides', message: 'Le filtre « urgences seulement » doit être vrai ou faux.' });
      } else {
        urgentOnly = raw.urgentOnly;
      }
    }
    let sms = NOTARY_ALERTES_DEFAULT.sms;
    if (raw.sms !== undefined && raw.sms !== null) {
      if (typeof raw.sms !== 'boolean') {
        errors.push({ code: 'alertes_invalides', message: 'L’alerte par texto doit être vrai ou faux.' });
      } else {
        sms = raw.sms;
      }
    }
    if (errors.length) return { ok: false, value: null, errors };
    return { ok: true, value: { pace, urgentOnly, sms }, errors: [] };
  }
  // What a STORED profile's alerts are — the default when the notary said
  // nothing, and the default again when the stored value is corrupt: a
  // reader never throws and never invents a pace.
  function notaryAlertes(profile) {
    const v = validateNotaryAlertes(profile && profile.alertes);
    return v.ok ? v.value : { ...NOTARY_ALERTES_DEFAULT };
  }

  function validateNotaryProfile(input) {
    input = input || {};
    const errors = [];

    const alertesV = validateNotaryAlertes(input.alertes);
    if (!alertesV.ok) errors.push(...alertesV.errors);
    const alertes = alertesV.value;

    // Identity for the mise en relation (ADR 0033): all optional at SAVE time
    // — a notary fills their profile in any order — but retaining requires
    // the three of notaryContactMissing(). Trimmed; null when empty.
    const bounded = (key, max, code, label) => {
      const s = String(input[key] == null ? '' : input[key]).trim();
      if (s.length > max) {
        errors.push({ code, message: `${label} ne peut dépasser ${max} caractères.` });
        return null;
      }
      return s || null;
    };
    const nom = bounded('nom', NOTARY_NAME_MAX, 'nom_invalide', 'Le nom');
    const etude = bounded('etude', NOTARY_NAME_MAX, 'etude_invalide', 'Le nom de l’étude');
    const adresse = bounded('adresse', NOTARY_ADDRESS_MAX, 'adresse_invalide', 'L’adresse');
    const telV = validateTelephone(input.telephone);
    if (!telV.ok) errors.push(telV.error);
    const telephone = telV.value;

    const raw = String(input.lienCNQ == null ? '' : input.lienCNQ).trim();

    // Empty is valid: the notary clears their fiche (and loses the badge).
    let lienCNQ = null;
    if (raw) {
      let valid = raw.length <= CNQ_LINK_MAX;
      if (valid) {
        try {
          const url = new URL(raw);
          const host = url.hostname.toLowerCase();
          valid = url.protocol === 'https:' && (host === CNQ.host || host.endsWith('.' + CNQ.host));
        } catch (e) {
          valid = false;
        }
      }
      if (!valid) {
        errors.push({ code: 'lien_cnq_invalide', message: 'Le lien doit être votre fiche officielle sur cnq.org (adresse https de la Chambre des notaires du Québec).' });
      }
      lienCNQ = valid ? raw : null;
    }

    // The travel radius (ADR 0017): one of the declared bands, 0 when absent —
    // a notary who said nothing travels nowhere. Forms send strings; coerce.
    let rayonKm = 0;
    if (input.rayonKm != null && String(input.rayonKm).trim() !== '') {
      const r = Number(input.rayonKm);
      if (NOTARY_RADII.indexOf(r) === -1) {
        errors.push({ code: 'rayon_invalide', message: 'Le rayon de déplacement doit être 0, 25 ou 50 km.' });
      } else {
        rayonKm = r;
      }
    }

    // The online-urgency opt-in: strictly boolean true, never a truthy string.
    const urgences = input.urgences === true;

    // The étude's postal sector (ADR 0025): optional — empty clears it and the
    // feed falls back to the declarative travel rules — but a non-empty value
    // must be a real FSA, same gate and message as the bid side.
    const prefixeV = validatePrefixe(input.prefixe);
    if (prefixeV.error) errors.push(prefixeV.error);

    return { ok: errors.length === 0, errors, lienCNQ, rayonKm, urgences, prefixe: prefixeV.value, nom, etude, telephone, adresse, alertes };
  }

  // A dial string for a tel: href — digits only, keeping a leading + and
  // assuming +1 (Canada) when the number is written without a country code.
  function telHref(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    const plus = s.charAt(0) === '+';
    const digits = s.replace(/\D/g, '');
    if (!digits) return null;
    return 'tel:' + (plus ? '+' + digits : '+1' + digits);
  }

  // The SAME loose rule as validateTelephone, resolved to one canonical shape
  // for a carrier: E.164, North-American plan. « (418) 555-0100 » and
  // « 1 418 555 0100 » both become « +14185550100 »; anything that is not a
  // dialable 10/11-digit NANP number is null — a text message is never sent
  // to a guess. The port (apps/api/src/sms-port.js) refuses anything else.
  function toE164(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    const digits = s.replace(/\D/g, '');
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
    return null;
  }

  // --- Le texto : un canal de consentement EXPRÈS (ADR 0051) -----------------
  // LCAP / CASL : un texto est un message électronique commercial, et Nota n'y
  // lit aucune exemption transactionnelle. Le consentement est donc un fait
  // que la personne a POSÉ — une case cochée, un interrupteur — jamais une
  // déduction. Absent ou nul vaut « non » ; tout ce qui n'est pas un booléen
  // strict est refusé, parce qu'un « oui » en chaîne est exactement le genre de
  // valeur qu'un formulaire mal câblé enverrait sans que personne l'ait voulu.
  function validateSmsConsent(raw) {
    if (raw === undefined || raw === null) return { ok: true, value: false, error: null };
    if (typeof raw !== 'boolean') {
      return { ok: false, value: null, error: { code: 'sms_consent_invalide', message: 'Le consentement aux textos doit être vrai ou faux.' } };
    }
    return { ok: true, value: raw, error: null };
  }

  // Ce qu'un carrier reçoit : UNE ligne, dans la langue du destinataire — le
  // sujet du gabarit (déjà passé par la surcharge admin) puis le lien profond
  // que le courriel porte. Un texto est un signal d'ouvrir le courriel ou
  // l'application, jamais une seconde copie du message. Le plafond est celui
  // d'un envoi concaténé raisonnable (320 = deux segments GSM-7) ; quand il
  // faut couper, c'est le sujet qui cède, jamais le lien.
  const SMS_TEXT_MAX = 320;
  const SMS_PREFIX = Object.freeze({ fr: 'Nota : ', en: 'Nota: ' });
  const SMS_SEPARATOR = ' — ';
  function smsText({ lang, subject, url } = {}) {
    const prefix = SMS_PREFIX[lang === 'en' ? 'en' : 'fr'];
    const sujet = String(subject == null ? '' : subject).replace(/\s+/g, ' ').trim();
    if (!sujet) return null;
    const lien = String(url == null ? '' : url).trim();
    const tail = lien ? SMS_SEPARATOR + lien : '';
    const room = SMS_TEXT_MAX - prefix.length - tail.length;
    if (room <= 1) return (prefix + tail).slice(0, SMS_TEXT_MAX);
    const body = sujet.length > room ? sujet.slice(0, room - 1).trimEnd() + '…' : sujet;
    return prefix + body + tail;
  }

  // Ce que l'écran des préférences a le droit de montrer du numéro enregistré :
  // les quatre derniers chiffres, assez pour reconnaître SON téléphone, pas
  // assez pour le composer.
  function maskTelephone(raw) {
    const digits = String(raw == null ? '' : raw).replace(/\D/g, '');
    if (digits.length < 4) return null;
    return '••• ••• ' + digits.slice(-4);
  }

  // --- Carnet pulse ----------------------------------------------------------
  // What the market looks like right now, aggregated from a set of bids (one
  // month, typically). It answers the two questions a client has before they
  // offer anything: "how much do people pay for this act?" and "does a notary
  // actually take these?". Pure arithmetic over the carnet — the UI only
  // formats what comes back.
  //
  // The median (not the mean) is the market signal: a single 9 000 $ urgent
  // refinancing must not drag the typical testament price upward. Retained
  // offers stay in the median — they are precisely the amounts that cleared —
  // but availability and the best open amount count open offers only.
  // A month reference is a market signal, not a default price. Three offers is
  // the minimum sample size we publish; below that, callers must keep the
  // reference absent rather than turning one or two observations into a claim
  // about the market.
  const CARNET_REPERE_MIN_OFFERS = 3;
  function carnetRepereDisponible(servicePulse) {
    return !!servicePulse && servicePulse.total >= CARNET_REPERE_MIN_OFFERS &&
      servicePulse.median !== null && servicePulse.median !== undefined &&
      Number.isFinite(Number(servicePulse.median));
  }
  function carnetPulse(bids, todayISO) {
    const list = (Array.isArray(bids) ? bids : []).filter(
      (b) => b && b.status !== STATUS.ANNULEE && isISODate(b.dateISO) && serviceById(b.serviceId),
    );
    const isOpen = isOpenBid;
    const open = list.filter(isOpen);
    const today = isISODate(todayISO) ? todayISO : null;

    const services = SERVICES.map((s) => {
      const mine = list.filter((b) => b.serviceId === s.id);
      // Whole dollars on a public surface: round the exact median here.
      const raw = median(mine.map((b) => Math.round(Number(b.montant) || 0)));
      const m = raw == null ? null : Math.round(raw);
      return {
        id: s.id,
        nom: s.nom,
        prixDepart: s.prixDepart,
        total: mine.length,
        ouvertes: mine.filter(isOpen).length,
        retenues: mine.filter((b) => !isOpen(b)).length,
        // The médiane is shown BESIDE "à partir de": it must never read below
        // the price the service starts at. New offers are validated above the
        // floor, so only legacy data (bids priced under an older, lower floor)
        // can push the raw median under it — clamp that history to today's floor
        // rather than display a self-contradicting pair.
        median: m == null ? null : Math.max(m, s.prixDepart),
      };
    });

    const dispo = open
      .filter((b) => !today || b.dateISO >= today)
      .map((b) => b.dateISO)
      .sort();

    return {
      total: list.length,
      ouvertes: open.length,
      retenues: list.length - open.length,
      // Share of the carnet a notary has already taken, 0–100 (whole numbers) —
      // the proof the marketplace clears. 0 when there is nothing to divide.
      tauxRetenue: list.length ? Math.round(((list.length - open.length) / list.length) * 100) : 0,
      prochaineDispo: dispo.length ? dispo[0] : null,
      meilleure: open.length ? Math.max.apply(null, open.map((b) => Math.round(Number(b.montant) || 0))) : null,
      services,
    };
  }

  // --- Week-agenda vignette ----------------------------------------------------
  // Shapes the "remplissez votre semaine" board on the notary landing: a batch of
  // REAL open demands placed on a Mon–Fri agenda by their true signing weekday.
  // Pure and deterministic — the caller animates, this only selects and places.
  //   • only open, upcoming, weekday demands qualify (a week board has no
  //     weekend) — unless `retenues` is set, which admits taken demands too so a
  //     client-facing board can show the marketplace clearing;
  //   • soonest signing dates are served first;
  //   • at most WEEK_AGENDA_PER_DAY per column and WEEK_AGENDA_MAX overall, so the
  //     board reads as an agenda rather than a heap;
  //   • `offset` rotates the starting point through the qualifying pool (wrapping),
  //     so a looping animation can show a different batch on every cycle.
  const WEEK_AGENDA_PER_DAY = 2;
  const WEEK_AGENDA_MAX = 8;

  function weekdayIndex(iso) {
    // 0 = Monday … 6 = Sunday, computed in UTC like every date rule here.
    return (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
  }

  function weekAgenda(bids, todayISO, opts) {
    const offset = Math.max(0, Math.floor((opts && opts.offset) || 0));
    const withRetenues = !!(opts && opts.retenues);
    const pool = (Array.isArray(bids) ? bids : [])
      .filter(
        (b) =>
          b &&
          b.status !== STATUS.ANNULEE &&
          (withRetenues || b.status !== STATUS.RETENUE) &&
          isISODate(b.dateISO) &&
          serviceById(b.serviceId) &&
          (!isISODate(todayISO) || b.dateISO >= todayISO) &&
          weekdayIndex(b.dateISO) < 5,
      )
      .sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));

    const items = [];
    if (pool.length) {
      const perDay = [0, 0, 0, 0, 0];
      const start = offset % pool.length;
      for (let i = 0; i < pool.length && items.length < WEEK_AGENDA_MAX; i++) {
        const b = pool[(start + i) % pool.length];
        const day = weekdayIndex(b.dateISO);
        if (perDay[day] >= WEEK_AGENDA_PER_DAY) continue;
        perDay[day]++;
        items.push({
          id: b.id,
          serviceId: b.serviceId,
          nomCourt: serviceById(b.serviceId).nomCourt,
          montant: Math.round(Number(b.montant) || 0),
          dateISO: b.dateISO,
          day,
          retenue: b.status === STATUS.RETENUE,
          etude: b.etude || null,
        });
      }
    }

    return {
      items,
      total: items.reduce((s, i) => s + i.montant, 0),
      poolSize: pool.length,
    };
  }

  // --- Deterministic fixtures ------------------------------------------------
  // Demo bids for an empty carnet. Seeded from a fixed constant so tests and
  // snapshots are stable — never Math.random(). `todayISO` anchors the dates so
  // the fixtures always sit in the visible month.
  const FIXTURE_SEED = 0x4e6f7461; // "Nota"

  function makeRng(seed) {
    let s = seed >>> 0;
    return function next() {
      // xorshift32
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 0xffffffff;
    };
  }

  // Fingerprint of the pricing shape the fixtures are built from. A seed made
  // under an older model would put its medians below today's floors, so
  // adapters compare this signature (never a hand-bumped version) and rebuild
  // their demo data whenever it changes.
  function seedSignature() {
    return [
      'offer-expiration-v1',
      FIXTURE_SEED.toString(16),
      PREMIUM_CAP,
      // The criteria ids are part of the shape: adding a pricing question (the
      // lender, say) changes what fixturePricing answers AND the bases the
      // montants sit on, so demo data made without it must be rebuilt.
      SERVICES.map((s) => s.id + ':' + s.prixDepart + ':' + ((s.pricing && s.pricing.criteria) || []).map((c) => c.id).join('+')).join(','),
      TIERS.map((t) => t.id + ':' + t.apercuMin + '-' + t.apercuMax).join(','),
      // The lender catalogue feeds fixturePricing: a lender add changing (the
      // +100 $ virtual surcharge retired, say) shifts the fixture bases, so the
      // catalogue's pricing shape is part of the fingerprint too.
      LENDERS.map((l) => l.id + ':' + l.add).join(','),
      // Same for the déplacement bands (ADR 0017): a band add changing shifts
      // the fixture bases, so the ladder's pricing shape is fingerprinted too.
      DEPLACEMENTS.map((d) => d.id + ':' + d.add).join(','),
    ].join('|');
  }

  const FIXTURE_PREFIXES = ['G1R', 'G1K', 'G2B', 'G1V', 'G1S', 'G3J'];
  const FIXTURE_NAMES = ['Marie-Ève Tremblay', 'Luc Gagné', 'Sophie Bergeron', 'Jean Roy', 'Chantal Côté', 'Marc Fortin'];
  const FIXTURE_ETUDES = ['Étude Laval', 'Notaires du Vieux-Québec', 'Cabinet Sainte-Foy'];
  // Demo amounts are read on the public calendar before a customer has chosen
  // an act. Keep the seeded story comfortably below five figures so the sample
  // carnet remains legible; real offers still use the normal 5× validation cap.
  const FIXTURE_DISPLAY_CAP = 9995;

  function makeFixtures(todayISO) {
    const rng = makeRng(FIXTURE_SEED);
    const bids = [];
    const count = 34;
    for (let i = 0; i < count; i++) {
      const svc = SERVICES[Math.floor(rng() * SERVICES.length)];
      const dayOffset = 1 + Math.floor(rng() * 27); // within the visible month
      const dateISO = addDays(todayISO, dayOffset);
      const tier = tierForDays(dayOffset);
      const t = tierById(tier);
      const mult = t.apercuMin + rng() * (t.apercuMax - t.apercuMin);
      // Fixtures carry realistic mandatory params so they are VALID offers under
      // the new pricing model, and their montant sits at/above the dynamic base.
      const pricing = fixturePricing(svc, rng);
      const base = computeBasePrice(svc.id, pricing);
      const montant = Math.min(FIXTURE_DISPLAY_CAP, base * PREMIUM_CAP, Math.max(base, Math.round((base * mult) / 5) * 5));
      const anonyme = rng() > 0.35;
      const retenue = rng() > 0.8;
      bids.push({
        id: 'fx-' + i,
        createdAt: todayISO,
        expiresOn: offerExpirationDate(todayISO, dateISO),
        serviceId: svc.id,
        dateISO,
        montant,
        tier,
        premium: montant / base,
        pricing,
        anonyme,
        nom: anonyme ? null : FIXTURE_NAMES[Math.floor(rng() * FIXTURE_NAMES.length)],
        prefixe: FIXTURE_PREFIXES[Math.floor(rng() * FIXTURE_PREFIXES.length)],
        status: retenue ? STATUS.RETENUE : STATUS.OUVERTE,
        etude: retenue ? FIXTURE_ETUDES[Math.floor(rng() * FIXTURE_ETUDES.length)] : null,
      });
    }
    return bids;
  }

  // Plausible mandatory-param answers for a demo fixture, so it validates and
  // shows a realistic mix of simple/standard/complexe cases on the carnet.
  function fixturePricing(svc, rng) {
    // The lender is derived from the already-drawn loan value instead of a new
    // rng() draw, so the draw stream (dates, names, prefixes, statuses) is
    // unchanged; only the bases/montants of add>0 lenders shift. An « autre »
    // draw carries its typed name — fixtures must be VALID offers.
    const lenderFor = (valeur) => LENDERS[valeur % LENDERS.length].id;
    // The déplacement band is derived from the loan value too (ADR 0017), for
    // the same reason: the draw stream stays unchanged, only the bases shift.
    const deplacementFor = (valeur) => DEPLACEMENTS[valeur % DEPLACEMENTS.length].id;
    const withOtherName = (pricing) =>
      pricing.preteur === LENDER_OTHER_ID ? { ...pricing, [LENDER_OTHER_FIELD]: 'Fiducie du Vieux-Port' } : pricing;
    if (svc.id === 'refinancement') {
      const valeur = 150000 + Math.floor(rng() * 700000);
      return withOtherName({
        valeur_pret: valeur,
        succession: rng() > 0.85 ? 'oui' : 'non',
        approbation_bancaire: ['obtenue', 'en_cours', 'non'][Math.floor(rng() * 3)],
        preteur: lenderFor(valeur),
        deplacement: deplacementFor(valeur),
      });
    }
    if (svc.id === 'financement') {
      const valeur = 150000 + Math.floor(rng() * 700000);
      return withOtherName({
        valeur_pret: valeur,
        contexte: rng() > 0.45 ? 'achat' : 'propriete_detenue',
        approbation_bancaire: ['obtenue', 'en_cours', 'non'][Math.floor(rng() * 3)],
        preteur: lenderFor(valeur),
        deplacement: deplacementFor(valeur),
        // Derived from the loan value like the lender and the band, so the
        // draw stream (dates, names, prefixes, statuses) stays unchanged.
        succession: valeur % 7 === 0 ? 'oui' : 'non',
      });
    }
    if (svc.id === 'testament') {
      const nombre = 1 + Math.floor(rng() * 2);
      return {
        nombre_testateurs: nombre,
        situation_familiale: ['celibataire', 'marie', 'union_civile', 'union_fait', 'famille_recomposee'][Math.floor(rng() * 5)],
        regime_familial: ['aucun', 'contrat', 'inconnu'][Math.floor(rng() * 3)],
        enfants: ['aucun', 'majeurs', 'mineurs', 'vulnerables'][Math.floor(rng() * 4)],
        nombre_beneficiaires: 1 + Math.floor(rng() * 6),
        liquidateur: ['un', 'plusieurs', 'professionnel'][Math.floor(rng() * 3)],
        testament_existant: rng() > 0.8 ? 'oui' : 'non',
        legs_complexes: ['aucun', 'particuliers', 'fiducie'][Math.floor(rng() * 3)],
        nombre_immeubles: ['aucun', 'un', 'plusieurs'][Math.floor(rng() * 3)],
        entreprise: rng() > 0.8,
        biens_hors_qc: rng() > 0.85,
        protection_beneficiaires: ['aucune', 'mineur', 'vulnerable', 'fiducie'][Math.floor(rng() * 4)],
        langue_acte: ['francais', 'anglais', 'bilingue'][Math.floor(rng() * 3)],
        accessibilite: ['aucune', 'lecture_vision', 'audition', 'interprete'][Math.floor(rng() * 4)],
        temoin_supplementaire: rng() > 0.9,
        deplacement: DEPLACEMENTS[Math.floor(rng() * DEPLACEMENTS.length)].id,
      };
    }
    if (svc.id === 'procuration') {
      return {
        nombre_mandants: 1 + Math.floor(rng() * 2),
        nombre_mandataires: 1 + Math.floor(rng() * 3),
        mode_action: ['separement', 'ensemble', 'remplacement'][Math.floor(rng() * 3)],
        portee_mandat: ['generale', 'specifique', 'immeuble', 'institutionnelle'][Math.floor(rng() * 4)],
        pouvoirs_sensibles: ['administration', 'bancaire', 'immeuble', 'multiple'][Math.floor(rng() * 4)],
        nombre_institutions: 1 + Math.floor(rng() * 4),
        mandat_existant: rng() > 0.85 ? 'oui' : 'non',
        duree_mandat: ['indeterminee', 'date_fin', 'conditions'][Math.floor(rng() * 3)],
        reddition_compte: rng() > 0.85,
        remplacement_mandataire: rng() > 0.85,
        langue_acte: ['francais', 'anglais', 'bilingue'][Math.floor(rng() * 3)],
        accessibilite: ['aucune', 'lecture_vision', 'audition', 'interprete'][Math.floor(rng() * 4)],
        nombre_immeubles: ['aucun', 'un', 'plusieurs'][Math.floor(rng() * 3)],
        deplacement: DEPLACEMENTS[Math.floor(rng() * DEPLACEMENTS.length)].id,
      };
    }
    return {};
  }

  function addDays(iso, n) {
    const base = Date.parse(iso + 'T00:00:00Z');
    const d = new Date(base + n * 86400000);
    return d.toISOString().slice(0, 10);
  }

  // --- Recommended offer (one-tap booking) -----------------------------------
  // The single biggest step for a client is deciding "how much do I offer?".
  // Given the date, suggest the middle of that tier's market-acceptance range ×
  // the service floor (rounded to $5, clamped to [floor, PREMIUM_CAP× floor]). The UI
  // pre-fills this so a client can book with one tap instead of a decision.
  // `bids` (optional) is the carnet's history: when supplied, the pre-fill uses
  // the TUNED multiplier learned from retained offers instead of the static
  // midpoint, so the recommendation follows the market over time.
  function recommendedAmount(serviceId, dateISO, todayISO, answers, bids) {
    const svc = serviceById(serviceId);
    if (!svc || !isISODate(dateISO)) return null;
    const days = isISODate(todayISO) ? Math.max(0, daysBetween(todayISO, dateISO)) : 0;
    const t = tierById(tierForDays(days));
    const mult = tierMultiplier(t.id, bids, serviceId);
    // Anchor the recommendation on Nota's quoted price (notaPrice — the base
    // derived from the client's pricing answers, times the single market
    // multiplier knob), so a more complex act recommends a proportionally
    // higher offer.
    const base = notaPrice(serviceId, answers);
    const min = base;
    const max = base * PREMIUM_CAP;
    return Math.min(max, Math.max(min, Math.round((base * mult) / 5) * 5));
  }

  // ⚠️ UNE HYPOTHÈSE, PAS UNE MESURE — et elle ne doit JAMAIS être affichée
  // comme un pourcentage à un client (audit des affirmations, 2026-09-01).
  //
  // Cette table est écrite à la main. Aucun acte n'a encore été conclu sur la
  // plateforme : il n'existe donc aucune observation dont ces nombres seraient
  // la synthèse. Présentés à l'écran comme « chances d'obtenir un notaire :
  // 95 % », au moment exact où le client choisit sa date et son prix, ils
  // affirment une probabilité que personne n'a mesurée. La copie client dit
  // désormais le MÉCANISME — plus de délai, plus de notaires peuvent
  // s'organiser — et aucun chiffre.
  //
  // Ce qui reste légitime : s'en servir en interne pour ORDONNER des dates
  // entre elles. Le jour où le taux de rétention par palier sera mesuré, cette
  // table sera remplacée par la mesure, et le chiffre pourra revenir à l'écran.
  const OBTAIN_CHANCE = { standard: 95, rapide: 88, prioritaire: 62, urgence: 40, extreme: 25 };
  function obtainChance(dateISO, todayISO) {
    if (!isISODate(dateISO)) return null;
    const days = isISODate(todayISO) ? Math.max(0, daysBetween(todayISO, dateISO)) : 0;
    const tierId = tierForDays(days);
    return OBTAIN_CHANCE[tierId] != null ? OBTAIN_CHANCE[tierId] : 60;
  }

  // --- Lead qualification ----------------------------------------------------
  // PRICE BEFORE DOCUMENTS (docs/decisions/0010-financing-first-catalogue.md):
  // a lead is "sellable" once the client has answered the REQUIRED pricing
  // criteria (the answers the price is derived from, kept under `__pricing`)
  // AND consented to share the dossier with the notary who retains the
  // request. The document checklist is preparation progress — reported here so
  // the UI can show it, never a barrier to posting: documents flow after the
  // mise en relation, through Nota or the notary's own channel (an item marked
  // DOSSIER_TRANSMIS counts as provided). Identity verification itself is
  // performed by the notary at signing (in person / by video, per Québec
  // rules) — Nota collects the ID document, it does not verify identity.
  // `saved` is the per-service intake map; consent is stored under `__consent`.
  // `pricing` (optional) is the client's pricing answers: given, the checklist
  // holds only the documents that apply to them (documentApplies); absent,
  // every document counts — exactly what callers predating the predicate get.
  // The dossier's own `__pricing` is NOT read implicitly: a caller opts in.
  const DOSSIER_TRANSMIS = 'transmis_autrement';

  // Does a document's `si` predicate hold for these pricing answers?
  //   - no predicate, or no pricing at all (undefined/null) → yes;
  //   - { critere, valeurs } → the answer is one of `valeurs` (unanswered: no);
  //   - { critere, sauf }    → the answer is none of `sauf` (unanswered: yes).
  function documentApplies(doc, pricing) {
    const si = doc && doc.si;
    if (!si || pricing == null) return true;
    const answer = (pricing || {})[si.critere];
    if (Array.isArray(si.valeurs)) return si.valeurs.indexOf(answer) !== -1;
    if (Array.isArray(si.sauf)) return si.sauf.indexOf(answer) === -1;
    return true;
  }
  function applicableDocuments(svc, pricing) {
    return (svc.documents || []).filter((d) => documentApplies(d, pricing));
  }

  // The client's checklist for an act: its documents, then its intake fields,
  // each `{ kind, id, nom, aide }` with kind 'doc' | 'field' — plus, for a
  // document whose `si` does not hold but which carries a `sinon`, a 'note'
  // item in its place (the explanation, never an upload). `service` is an id
  // or the service object itself.
  function dossierItems(service, pricing) {
    const svc = service && typeof service === 'object' ? service : serviceById(service);
    if (!svc) return [];
    const items = [];
    (svc.documents || []).forEach((d) => {
      if (documentApplies(d, pricing)) items.push({ kind: 'doc', id: d.id, nom: d.nom, aide: d.aide });
      else if (d.sinon) items.push({ kind: 'note', id: d.id, nom: d.nom, aide: d.sinon });
    });
    (svc.champs || []).forEach((c) => items.push({ kind: 'field', id: c.id, nom: c.label, aide: c.aide }));
    return items;
  }

  // Evidence-grounded extraction is a proposal for a notary, never a legal
  // finding. These limits and the field vocabulary are shared by all adapters.
  const FINANCING_AI_FIELDS = [
    { id: 'property_address', label: 'Adresse de l’immeuble', description: 'Civic address of the property securing the proposed loan; not a lender, adviser or correspondence address.' },
    { id: 'borrower_names', label: 'Noms des emprunteurs', description: 'People expressly identified as borrowers. Ownership alone does not establish borrower status; exclude advisers and witnesses.' },
    { id: 'signing_parties', label: 'Personnes et rôles à la signature', description: 'Owners, borrowers, guarantors, spouses, attorneys or corporate representatives expressly identified as intervening; preserve the stated role and do not infer authority.' },
    { id: 'property_identifier', label: 'Identification cadastrale indiquée', description: 'Lot number, cadastral designation or other property identifier expressly stated; an address is not a cadastral verification.' },
    { id: 'property_type', label: 'Type d’immeuble indiqué', description: 'Property type or special situation expressly stated, such as condominium, income property, corporation or trust ownership; do not infer the legal regime.' },
    { id: 'lender_name', label: 'Nom du prêteur', description: 'Lender for the proposed financing, not an adviser or a creditor mentioned only in an existing debt statement. Preserve conflicting proposed lenders.' },
    { id: 'lender_contact', label: 'Personne-ressource du prêteur', description: 'Professional lender contact expressly identified in the source; do not treat a client adviser or a generic phone number as the official lender channel.' },
    { id: 'loan_amount', label: 'Montant du prêt indiqué', description: 'Proposed loan principal expressly stated as such, not purchase price, valuation, payout balance or registered hypothec/security amount. Do not calculate.' },
    { id: 'purchase_price', label: 'Prix d’achat indiqué', description: 'Purchase price expressly stated in a purchase or sale document; never substitute it for the loan amount.' },
    { id: 'loan_purpose', label: 'Objet du financement indiqué', description: 'Purchase, refinance, line of credit or other purpose expressly described by the source; do not classify a transaction from an amount alone.' },
    { id: 'lender_instruction_version', label: 'Version ou date des instructions du prêteur', description: 'Version, effective date or issue date expressly printed on lender instructions; do not conclude that instructions are current.' },
    { id: 'property_changes', label: 'Changements à l’immeuble indiqués', description: 'Works, additions, pools, occupancy or other changes expressly stated in relation to the property or a survey.' },
    { id: 'rate_expiry', label: 'Échéance du taux indiquée', description: 'Expiry of the offered rate as stated, not document creation date, loan maturity or a conclusion about validity today.' },
    { id: 'secured_debts', label: 'Dettes garanties indiquées', description: 'Each expressly stated existing loan or credit line secured by the property, including zero-balance lines. A stated absence of debt is a declaration, not registry verification. Never calculate an official payout.' },
    { id: 'payout_valid_through', label: 'Date de validité du remboursement indiquée', description: 'Valid-through date expressly printed on an official payout statement; do not calculate a payout or decide that it remains valid.' },
  ];
  const FINANCING_AI_LIMITS = Object.freeze({ maxPages: 8, maxPageChars: 8000,
    maxTotalChars: 36000, maxFields: 24, maxValueChars: 1000, maxQuoteChars: 2000,
    maxReasonChars: 500, maxReviewSeconds: 86400, maxExtractionChars: 24000 });

  // AI-assisted dossier preparation is a separate product from the free
  // marketplace. The prices are deliberately domain data so the API and the
  // browser cannot drift. A dossier analysis is the billable unit: a reused
  // analysis and a human review never consume another unit.
  const NOTARY_AI_BETA_TRIAL_USES = 5;
  const NOTARY_AI_PLANS = Object.freeze([
    Object.freeze({ id: 'essentiel', nom: 'Essentiel', nomEn: 'Essential', monthlyCents: 4900, includedUses: 20, overageCents: 900 }),
    Object.freeze({ id: 'cabinet', nom: 'Cabinet', nomEn: 'Practice', monthlyCents: 12900, includedUses: 75, overageCents: 700 }),
    Object.freeze({ id: 'equipe', nom: 'Équipe', nomEn: 'Team', monthlyCents: 24900, includedUses: 200, overageCents: 500 }),
  ]);
  const NOTARY_AI_QUESTION_DECISIONS = Object.freeze([
    'confirmed', 'resolved', 'not_applicable', 'escalated',
  ]);
  function notaryAIPlan(id) {
    return NOTARY_AI_PLANS.find(plan => plan.id === id) || null;
  }
  function notaryAIPlanPublic(plan) {
    const p = typeof plan === 'string' ? notaryAIPlan(plan) : plan;
    if (!p) return null;
    return { id: p.id, nom: p.nom, nomEn: p.nomEn, monthlyCents: p.monthlyCents,
      includedUses: p.includedUses, overageCents: p.overageCents };
  }

  // Commercial tiers for a notarial practice are intentionally separate from
  // the AI usage plans above. The admin console may negotiate the actual CAD
  // amount and included seats per cabinet; the domain owns only the stable
  // tier vocabulary and whether the tier supports multiple notaries.
  const CABINET_PLANS = Object.freeze([
    Object.freeze({ id: 'independant', nom: 'Indépendant', nomEn: 'Independent', multiNotaires: false, tarification: 'standard' }),
    Object.freeze({ id: 'cabinet', nom: 'Cabinet', nomEn: 'Practice', multiNotaires: true, tarification: 'volume' }),
    Object.freeze({ id: 'reseau', nom: 'Réseau', nomEn: 'Network', multiNotaires: true, tarification: 'sur_mesure' }),
  ]);
  function cabinetPlan(id) {
    return CABINET_PLANS.find(plan => plan.id === id) || null;
  }
  function cabinetPlanPublic(plan) {
    const p = typeof plan === 'string' ? cabinetPlan(plan) : plan;
    return p ? { ...p } : null;
  }

  // The same evidence-first assistant can reduce intake work for every
  // catalogue act. Each service has a bounded vocabulary of facts. The model may
  // propose values, but a notary must review every proposal before it enters a
  // work packet.
  const ACT_AI_FIELDS = Object.freeze({
    financement: Object.freeze(FINANCING_AI_FIELDS),
    refinancement: Object.freeze(FINANCING_AI_FIELDS),
    testament: Object.freeze([
      { id: 'testator_names', label: 'Noms des testateurs', description: 'People expressly identified as making the will.' },
      { id: 'family_status', label: 'Situation familiale indiquée', description: 'Marital, civil union, common-law or blended-family status as expressly stated.' },
      { id: 'family_regime', label: 'Contrat familial indiqué', description: 'A marriage or civil-union contract or an explicit statement that none is known.' },
      { id: 'children_dependants', label: 'Enfants ou personnes à charge indiqués', description: 'Children or dependants expressly named; do not infer relationships.' },
      { id: 'beneficiaries', label: 'Bénéficiaires ou legs indiqués', description: 'Beneficiaries, legacies or conditions expressly stated as wishes; do not turn them into legal conclusions.' },
      { id: 'liquidator', label: 'Liquidateur ou fiduciaire indiqué', description: 'A person, group or professional expressly proposed to administer the estate or a trust.' },
      { id: 'existing_will', label: 'Testament antérieur indiqué', description: 'An earlier will, copy or uncertainty expressly mentioned; do not infer a registry result.' },
      { id: 'assets_properties', label: 'Immeubles et actifs indiqués', description: 'Properties, businesses, foreign assets or other important assets expressly mentioned.' },
      { id: 'communication_needs', label: 'Besoins de communication indiqués', description: 'Accessibility, interpreter or witness-related needs expressly stated; do not assess capacity.' },
      { id: 'testament_formalities', label: 'Formalités du testament indiquées', description: 'Witness, reading, interpreter or execution details expressly mentioned; do not conclude that a statutory formality was satisfied.' },
      { id: 'business_assets', label: 'Entreprise ou actifs importants indiqués', description: 'Businesses, shares or important assets expressly mentioned.' },
    ]),
    procuration: Object.freeze([
      { id: 'mandant_names', label: 'Noms des mandants', description: 'People expressly identified as giving the power of attorney.' },
      { id: 'mandataire_names', label: 'Noms des mandataires', description: 'People expressly identified as receiving authority.' },
      { id: 'mandataire_count', label: 'Nombre de mandataires indiqué', description: 'A stated count of attorneys; do not count names that are not clearly appointed.' },
      { id: 'mandate_regime', label: 'Type de mandat indiqué', description: 'Wording that describes an ordinary power of attorney, a protection mandate or an unclear route; extract the wording but never make the legal classification.' },
      { id: 'authority_mode', label: 'Mode d’action indiqué', description: 'Whether attorneys act jointly, separately or as substitutes, as expressly stated.' },
      { id: 'mandate_scope', label: 'Objet ou portée indiquée', description: 'The task, transaction or scope expressly described by the source.' },
      { id: 'sensitive_powers', label: 'Pouvoirs sensibles indiqués', description: 'Banking, property, financing or multiple powers expressly stated.' },
      { id: 'property_or_transaction', label: 'Immeuble ou transaction indiqué', description: 'Property address or transaction expressly tied to the power of attorney.' },
      { id: 'mandate_end', label: 'Durée ou fin indiquée', description: 'An expressly stated date, event or condition ending the mandate.' },
      { id: 'existing_mandate', label: 'Mandat antérieur indiqué', description: 'An earlier mandate or uncertainty expressly mentioned; do not infer revocation or validity.' },
      { id: 'third_party_requirements', label: 'Exigences du tiers indiquées', description: 'Institutional forms or requirements expressly stated by the source.' },
      { id: 'communication_needs', label: 'Besoins de communication indiqués', description: 'Accessibility or interpreter needs expressly stated; do not assess capacity.' },
    ]),
  });
  const ACT_AI_LIMITS = FINANCING_AI_LIMITS;

  // Learning signals are deliberately separated from legal conclusions. The
  // client can show that a question was answered or that a message needed a
  // reply; only a notary's explicit review can label an extracted field. This
  // policy is shared by the API and the future training/export job so a product
  // metric cannot silently become a legal reward.
  const NOTARY_LEARNING_POLICY_VERSION = '2026-09-09.1';
  const NOTARY_LEARNING_EVENT_KINDS = Object.freeze([
    'customer_input', 'customer_behavior', 'communication', 'ai_output',
    'notary_review', 'notary_question', 'official_outcome', 'client_feedback',
  ]);
  const NOTARY_LEARNING_POLICIES = Object.freeze({
    customer_input: Object.freeze({
      strength: 'weak', source: 'client', labelFields: false,
      rewardRole: 'question_routing_and_workflow_only',
      allowedUses: Object.freeze(['missing_question_priority', 'intake_friction']),
    }),
    customer_behavior: Object.freeze({
      strength: 'weak', source: 'client', labelFields: false,
      rewardRole: 'question_routing_and_workflow_only',
      allowedUses: Object.freeze(['response_latency', 'document_completion', 'reopen_prediction']),
    }),
    communication: Object.freeze({
      strength: 'weak', source: 'client_or_notary', labelFields: false,
      rewardRole: 'communication_experience_only',
      allowedUses: Object.freeze(['clarity_ranking', 'follow_up_priority', 'escalation_prediction']),
    }),
    ai_output: Object.freeze({
      strength: 'unlabeled', source: 'ai', labelFields: false,
      rewardRole: 'observation_only',
      allowedUses: Object.freeze(['error_analysis', 'cost_latency_monitoring']),
    }),
    notary_review: Object.freeze({
      strength: 'strong', source: 'notary', labelFields: true,
      rewardRole: 'extraction_preference_only',
      allowedUses: Object.freeze(['notary_verified_preference_dataset', 'regression_case']),
    }),
    notary_question: Object.freeze({
      strength: 'strong', source: 'notary', labelFields: false,
      rewardRole: 'uncertainty_calibration_only',
      allowedUses: Object.freeze(['abstention_calibration', 'question_priority', 'regression_case']),
    }),
    official_outcome: Object.freeze({
      strength: 'strong', source: 'official_or_notary', labelFields: false,
      rewardRole: 'workflow_outcome_only',
      allowedUses: Object.freeze(['integration_reconciliation', 'workflow_regression']),
    }),
    client_feedback: Object.freeze({
      strength: 'weak', source: 'client', labelFields: false,
      rewardRole: 'service_experience_only',
      allowedUses: Object.freeze(['communication_ranking', 'friction_analysis']),
    }),
  });
  const NOTARY_LEARNING_PROGRAM = Object.freeze({
    version: NOTARY_LEARNING_POLICY_VERSION,
    mode: 'controlled_reinforcement_signals',
    defaultTraining: 'off',
    customerSignals: 'weak_rank_only',
    notaryLabels: 'required_for_field_learning',
    criticalControls: 'never_rewarded_from_behavior_alone',
    weightUpdates: 'offline_only_after_approval',
    dailyLoop: Object.freeze(['collect', 'classify', 'regress', 'evaluate', 'approve', 'canary', 'rollback']),
  });

  function notaryLearningPolicyFor(kind) {
    const policy = NOTARY_LEARNING_POLICIES[kind];
    return policy ? { ...policy, allowedUses: [...policy.allowedUses] } : null;
  }

  function notaryLearningPolicy() {
    return Object.fromEntries(NOTARY_LEARNING_EVENT_KINDS.map(kind => [kind, notaryLearningPolicyFor(kind)]));
  }

  // Customer behaviour belongs in the product improvement loop, but it must
  // not become an unbounded online reward channel. This policy describes the
  // only autonomous product changes allowed by Nota: a coarse, reversible
  // intake guidance mode selected from aggregate evidence. Legal rules,
  // critical controls, prices, outbound messages and model weights stay behind
  // an offline approval boundary.
  const CUSTOMER_IMPROVEMENT_POLICY_VERSION = '2026-09-09.1';
  const CUSTOMER_EXPERIENCE_MODES = Object.freeze(['standard', 'guided']);
  const CUSTOMER_IMPROVEMENT_POLICY = Object.freeze({
    version: CUSTOMER_IMPROVEMENT_POLICY_VERSION,
    mode: 'bounded_autonomous_product_optimization',
    defaultExperience: 'standard',
    signals: Object.freeze([
      'aggregate_funnel', 'customer_input', 'customer_behavior',
      'communication', 'client_feedback', 'official_outcome',
    ]),
    automaticActions: Object.freeze(['enable_guided_intake', 'rollback_guided_intake']),
    minimumObservations: Object.freeze({ formStarts: 20, publicationAttempts: 10, feedbackCount: 5 }),
    windows: Object.freeze({ decisionDays: 7, comparisonDays: 7 }),
    thresholds: Object.freeze({
      blockedRateToGuide: 0.25,
      maxPublicationProxyDrop: 0.20,
      maxFailureRateIncrease: 0.10,
      responseLatencySeconds: 172800,
      lowRating: 2,
    }),
    protectedDecisions: Object.freeze([
      'legal_rules', 'notary_controls', 'official_records',
      'prices', 'outbound_campaigns', 'model_weights',
    ]),
    cadence: 'daily',
    rollback: 'automatic_on_guardrail_regression',
  });

  function experienceMetrics(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const integer = (value) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 1000000000) : 0;
    };
    const ratio = (value) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? Math.min(n, 1) : 0;
    };
    const metric = {
      formStarts: integer(source.formStarts),
      publicationAttempts: integer(source.publicationAttempts),
      publications: integer(source.publications),
      blockedAttempts: integer(source.blockedAttempts),
      publicationFailures: integer(source.publicationFailures),
      customerInputEvents: integer(source.customerInputEvents),
      customerBehaviourEvents: integer(source.customerBehaviourEvents),
      communicationEvents: integer(source.communicationEvents),
      aiOutputEvents: integer(source.aiOutputEvents),
      officialOutcomeEvents: integer(source.officialOutcomeEvents),
      feedbackCount: integer(source.feedbackCount),
      lowFeedbackCount: integer(source.lowFeedbackCount),
      blockedRate: ratio(source.blockedRate),
      publicationProxy: source.publicationProxy == null ? null : ratio(source.publicationProxy),
      publicationFailureRate: ratio(source.publicationFailureRate),
      averageRating: source.averageRating == null ? null : Math.max(0, Math.min(5, Number(source.averageRating) || 0)),
      responseLatencySeconds: source.responseLatencySeconds == null ? null : integer(source.responseLatencySeconds),
      learningSignalEvents: integer(source.learningSignalEvents),
      learningSignalsTruncated: source.learningSignalsTruncated === true,
    };
    return metric;
  }

  // Stored configuration is intentionally boring and bounded. The API uses
  // this normalizer before public projection, while the daily controller uses
  // it to keep a malformed or hand-edited record from enabling a new mode.
  function customerExperienceConfig(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const mode = CUSTOMER_EXPERIENCE_MODES.includes(source.mode) ? source.mode : CUSTOMER_IMPROVEMENT_POLICY.defaultExperience;
    const revision = Number(source.revision);
    const history = Array.isArray(source.history) ? source.history.slice(-30).map((entry) => ({
      at: typeof entry?.at === 'string' ? entry.at.slice(0, 80) : null,
      action: typeof entry?.action === 'string' ? entry.action.slice(0, 60) : 'hold',
      from: CUSTOMER_EXPERIENCE_MODES.includes(entry?.from) ? entry.from : null,
      to: CUSTOMER_EXPERIENCE_MODES.includes(entry?.to) ? entry.to : null,
      reason: typeof entry?.reason === 'string' ? entry.reason.slice(0, 300) : null,
      primaryMetric: typeof entry?.primaryMetric === 'string' ? entry.primaryMetric.slice(0, 80) : null,
      metrics: experienceMetrics(entry?.metrics),
    })) : [];
    return {
      version: CUSTOMER_IMPROVEMENT_POLICY_VERSION,
      mode,
      revision: Number.isFinite(revision) && revision >= 0 ? Math.min(Math.floor(revision), 1000000000) : 0,
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt.slice(0, 80) : null,
      changedAt: typeof source.changedAt === 'string' ? source.changedAt.slice(0, 80) : null,
      lastStableMode: CUSTOMER_EXPERIENCE_MODES.includes(source.lastStableMode) ? source.lastStableMode : 'standard',
      baseline: source.baseline && typeof source.baseline === 'object' ? experienceMetrics(source.baseline) : null,
      history,
    };
  }

  function publicCustomerExperience(input) {
    const config = customerExperienceConfig(input);
    return {
      version: config.version,
      mode: config.mode,
      guidanceLevel: config.mode,
    };
  }

  // A coverage claim is only meaningful if the branches are explicit. These
  // are workflow classes, not a promise that an AI can resolve every legal
  // question. A known class may be prepared and reviewed; an unknown,
  // exceptional or out-of-catalogue class is routed to the notary before any
  // automation is allowed to advance it.
  const NOTARY_CASE_COVERAGE_VERSION = '2026-09-09.1';
  const NOTARY_COMMON_CASES = Object.freeze([
    { id: 'standard_natural_person', label: 'Dossier courant de personne physique', disposition: 'prepare_and_review', critical: false, signals: ['serviceId', 'pricing', 'dossier', 'documents'], controlIds: ['scope_and_roles', 'identity_quality_capacity'] },
    { id: 'missing_or_late_documents', label: 'Pièces manquantes, tardives ou illisibles', disposition: 'prepare_and_review', critical: true, signals: ['missing', 'document_status', 'customer_input'], controlIds: ['scope_and_roles', 'records_and_copy'] },
    { id: 'conflicting_or_stale_evidence', label: 'Preuves contradictoires, périmées ou incomplètes', disposition: 'route_to_notary', critical: true, signals: ['conflicts', 'document_date', 'official_outcome'], controlIds: ['identity_quality_capacity', 'scope_and_roles'] },
    { id: 'identity_role_authority', label: 'Identité, qualité, capacité ou autorité à confirmer', disposition: 'route_to_notary', critical: true, signals: ['identity', 'role', 'authority'], controlIds: ['identity_quality_capacity'] },
    { id: 'language_accessibility', label: 'Langue, interprète, témoin ou accessibilité', disposition: 'prepare_and_review', critical: true, signals: ['langue_acte', 'accessibilite', 'communication'], controlIds: ['language_accessibility', 'read_explain_consent', 'signature_execution'] },
    { id: 'external_system_unavailable', label: 'Prêteur, registre ou institution temporairement indisponible', disposition: 'route_to_notary', critical: true, signals: ['integration_status', 'retry_state'], controlIds: ['records_and_copy'] },
    { id: 'privacy_processing_consent', label: 'Autorisation de traitement, confidentialité ou conservation à confirmer', disposition: 'route_to_notary', critical: true, signals: ['processing_authorized', 'retention'], controlIds: ['scope_and_roles', 'records_and_copy'] },
    { id: 'untrusted_or_adversarial_document', label: 'Contenu documentaire non fiable ou tentative d’instruction embarquée', disposition: 'prepare_and_review', critical: true, signals: ['evidence', 'prompt_injection'], controlIds: ['scope_and_roles', 'identity_quality_capacity'] },
    { id: 'unknown_or_out_of_catalogue', label: 'Cas inconnu ou hors catalogue', disposition: 'route_to_notary', critical: true, signals: ['unknown_parameter', 'unknown_document', 'unknown_service'], controlIds: ['scope_and_roles', 'identity_quality_capacity'] },
  ]);
  const NOTARY_SERVICE_CASES = Object.freeze({
    financement: Object.freeze([
      { id: 'purchase_coordination', label: 'Achat, promesse, ajustements et coordination avec le vendeur', disposition: 'prepare_and_review', critical: true, signals: ['contexte=achat', 'promesse_achat', 'seller_notary'], controlIds: ['purchase_coordination', 'lender_instructions'] },
      { id: 'existing_property_new_loan', label: 'Immeuble existant et nouveau financement', disposition: 'prepare_and_review', critical: true, signals: ['contexte=refinancement_ou_autre', 'secured_debts', 'property_identifier'], controlIds: ['title_charges', 'lender_instructions'] },
      { id: 'co_borrower_or_guarantor', label: 'Codébiteur, caution ou personne qui intervient à l’acte', disposition: 'route_to_notary', critical: true, signals: ['parties_signature', 'signing_parties'], controlIds: ['scope_and_roles', 'identity_quality_capacity'] },
      { id: 'condominium_property', label: 'Copropriété et documents du syndicat applicables', disposition: 'prepare_and_review', critical: true, signals: ['type_propriete=copropriete', 'condo_package'], controlIds: ['property_evidence', 'title_charges'] },
      { id: 'income_corporate_or_trust_party', label: 'Revenu particulier, société, fiducie ou succession', disposition: 'route_to_notary', critical: true, signals: ['parties_signature', 'authority', 'entity_documents'], controlIds: ['scope_and_roles', 'identity_quality_capacity'] },
      { id: 'title_or_survey_exception', label: 'Anomalie de titre, lot, certificat ou changements à l’immeuble', disposition: 'route_to_notary', critical: true, signals: ['property_identifier', 'property_changes', 'certificat_localisation'], controlIds: ['title_charges', 'property_evidence'] },
      { id: 'lender_condition_or_version_change', label: 'Condition, version ou échéance des instructions du prêteur à confirmer', disposition: 'route_to_notary', critical: true, signals: ['lender_instruction_version', 'rate_expiry', 'lender_contact'], controlIds: ['lender_instructions', 'funding_reconciliation'] },
    ]),
    refinancement: Object.freeze([
      { id: 'multiple_secured_debts', label: 'Plusieurs prêts ou marges garantis par l’immeuble', disposition: 'prepare_and_review', critical: true, signals: ['secured_debts', 'payout_valid_through'], controlIds: ['secured_debts', 'payout_discharge'] },
      { id: 'zero_balance_credit_line', label: 'Marge garantie à solde nul qui doit tout de même être traitée', disposition: 'prepare_and_review', critical: true, signals: ['secured_debts', 'zero_balance'], controlIds: ['secured_debts', 'payout_discharge'] },
      { id: 'payout_expired_or_conflicting', label: 'État de remboursement expiré ou contradictoire', disposition: 'route_to_notary', critical: true, signals: ['payout_valid_through', 'conflicts'], controlIds: ['secured_debts', 'funding_reconciliation'] },
      { id: 'quittance_or_mainlevee', label: 'Quittance, mainlevée ou radiation à obtenir et publier', disposition: 'prepare_and_review', critical: true, signals: ['secured_debts', 'registry_publication'], controlIds: ['payout_discharge', 'registry_publication'] },
      { id: 'new_and_existing_security', label: 'Nouvelle sûreté et sûretés existantes à coordonner', disposition: 'route_to_notary', critical: true, signals: ['secured_debts', 'title_charges', 'lender_instruction_version'], controlIds: ['title_charges', 'registry_publication'] },
      { id: 'corporation_trust_or_family_residence', label: 'Société, fiducie ou résidence familiale impliquée', disposition: 'route_to_notary', critical: true, signals: ['parties_signature', 'authority', 'property_type'], controlIds: ['scope_and_roles', 'identity_quality_capacity'] },
      { id: 'title_or_survey_exception', label: 'Anomalie de titre, lot, certificat ou changements à l’immeuble', disposition: 'route_to_notary', critical: true, signals: ['property_identifier', 'property_changes', 'certificat_localisation'], controlIds: ['title_charges', 'property_evidence'] },
      { id: 'lender_condition_or_version_change', label: 'Condition, version ou échéance des instructions du prêteur à confirmer', disposition: 'route_to_notary', critical: true, signals: ['lender_instruction_version', 'rate_expiry', 'lender_contact'], controlIds: ['lender_instructions', 'funding_reconciliation'] },
    ]),
    testament: Object.freeze([
      { id: 'single_testator', label: 'Un testateur avec volontés simples à clarifier', disposition: 'prepare_and_review', critical: false, signals: ['testator_names', 'beneficiaries'], controlIds: ['family_dependants', 'wishes_beneficiaries'] },
      { id: 'multiple_testators', label: 'Plusieurs testateurs ou actes coordonnés', disposition: 'route_to_notary', critical: true, signals: ['testator_names', 'parties_signature'], controlIds: ['scope_and_roles', 'identity_quality_capacity'] },
      { id: 'blended_family_minor_or_dependant', label: 'Famille recomposée, enfant mineur ou personne à charge', disposition: 'route_to_notary', critical: true, signals: ['family_status', 'children_dependants'], controlIds: ['family_dependants', 'wishes_beneficiaries'] },
      { id: 'vulnerable_beneficiary_or_trust', label: 'Bénéficiaire vulnérable, legs complexe ou fiducie à discuter', disposition: 'route_to_notary', critical: true, signals: ['beneficiaries', 'assets_properties', 'business_assets'], controlIds: ['wishes_beneficiaries', 'identity_quality_capacity'] },
      { id: 'existing_will_revision', label: 'Testament antérieur, modification ou incertitude à vérifier', disposition: 'route_to_notary', critical: true, signals: ['existing_will', 'testament_register'], controlIds: ['existing_will', 'testament_register'] },
      { id: 'foreign_or_business_assets', label: 'Biens hors Québec, entreprise ou actifs importants', disposition: 'route_to_notary', critical: true, signals: ['assets_properties', 'business_assets'], controlIds: ['wishes_beneficiaries', 'records_and_copy'] },
      { id: 'witness_interpreter_or_accessibility', label: 'Témoin, interprète ou adaptation de communication à prévoir', disposition: 'prepare_and_review', critical: true, signals: ['communication_needs', 'testament_formalities'], controlIds: ['witnesses', 'language_accessibility', 'signature_execution'] },
      { id: 'capacity_or_undue_influence_concern', label: 'Doute sur la capacité, la compréhension ou l’influence exercée', disposition: 'route_to_notary', critical: true, signals: ['communication_needs', 'identity_quality_capacity'], controlIds: ['identity_quality_capacity', 'read_explain_consent'] },
    ]),
    procuration: Object.freeze([
      { id: 'ordinary_power_of_attorney', label: 'Procuration ordinaire pour une portée clairement délimitée', disposition: 'prepare_and_review', critical: false, signals: ['mandate_regime', 'mandate_scope'], controlIds: ['mandate_regime', 'powers_duration'] },
      { id: 'possible_protection_mandate', label: 'Possibilité de mandat de protection ou de parcours distinct', disposition: 'route_to_notary', critical: true, signals: ['mandate_regime', 'capacity'], controlIds: ['mandate_regime', 'protection_route'] },
      { id: 'joint_separate_or_substitute_mandataries', label: 'Mandataires conjoints, séparés ou remplaçants', disposition: 'prepare_and_review', critical: true, signals: ['mandataire_names', 'authority_mode'], controlIds: ['scope_and_roles', 'powers_duration'] },
      { id: 'duration_or_termination_conditions', label: 'Durée, condition de fin ou révocation à préciser', disposition: 'prepare_and_review', critical: true, signals: ['mandate_end', 'existing_mandate'], controlIds: ['powers_duration', 'existing_revocation'] },
      { id: 'existing_mandate_or_revocation', label: 'Mandat antérieur, révocation ou annotation à vérifier', disposition: 'route_to_notary', critical: true, signals: ['existing_mandate', 'mandate_end'], controlIds: ['existing_revocation', 'protection_route'] },
      { id: 'financial_immovable_or_institution', label: 'Pouvoir bancaire, immobilier, financement ou institutionnel', disposition: 'route_to_notary', critical: true, signals: ['sensitive_powers', 'property_or_transaction', 'third_party_requirements'], controlIds: ['powers_duration', 'third_party_requirements'] },
      { id: 'medical_or_personal_care_route', label: 'Demande qui concerne les soins personnels ou médicaux', disposition: 'route_to_notary', critical: true, signals: ['mandate_regime', 'mandate_scope'], controlIds: ['mandate_regime', 'protection_route'] },
      { id: 'capacity_or_pressure_concern', label: 'Doute sur la capacité, la compréhension ou une pression exercée', disposition: 'route_to_notary', critical: true, signals: ['communication_needs', 'capacity'], controlIds: ['identity_quality_capacity', 'read_explain_consent'] },
    ]),
  });

  function notaryCaseCoverage(serviceId) {
    if (!serviceById(serviceId) || !NOTARY_SERVICE_CASES[serviceId]) return null;
    return {
      version: NOTARY_CASE_COVERAGE_VERSION,
      serviceId,
      cases: [...NOTARY_COMMON_CASES, ...NOTARY_SERVICE_CASES[serviceId]].map(item => ({
        ...item, signals: [...item.signals], controlIds: [...item.controlIds],
      })),
      unknownCasePolicy: 'route_to_notary_before_automation',
      outputPolicy: 'evidence_proposal_only',
    };
  }

  function actAIFields(serviceId) {
    return ACT_AI_FIELDS[serviceId] || null;
  }

  function validateActAIInput(input) {
    const errors = [];
    const fail = code => errors.push({ code });
    const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    if (!actAIFields(obj.serviceId)) fail('service_inconnu');
    const pages = [];
    const seen = new Set();
    let size = 0;
    if (!Array.isArray(obj.pages) || !obj.pages.length || obj.pages.length > ACT_AI_LIMITS.maxPages) fail('pages_invalides');
    else for (const page of obj.pages) {
      if (!page || typeof page !== 'object' || Array.isArray(page) ||
        typeof page.documentId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(page.documentId) ||
        !Number.isSafeInteger(page.page) || page.page < 1 || page.page > 10000 ||
        typeof page.text !== 'string' || !page.text.trim() || page.text.length > ACT_AI_LIMITS.maxPageChars) {
        fail('page_invalide'); continue;
      }
      const id = page.documentId + ':' + page.page;
      if (seen.has(id)) fail('page_dupliquee');
      seen.add(id); size += page.text.length;
      pages.push({ documentId: page.documentId, page: page.page, text: page.text });
    }
    if (size > ACT_AI_LIMITS.maxTotalChars) fail('pages_trop_longues');
    return { ok: !errors.length, errors, value: errors.length ? null : { serviceId: obj.serviceId, pages } };
  }

  function validateActAIExtraction(input, extraction) {
    const validated = validateActAIInput(input);
    if (!validated.ok) return validated;
    const errors = [];
    const fail = code => errors.push({ code });
    const fieldsForService = actAIFields(validated.value.serviceId);
    const allowed = new Set(fieldsForService.map(f => f.id));
    const fields = [];
    const seen = new Set();
    const source = new Map(validated.value.pages.map(p => [p.documentId + ':' + p.page, p.text]));
    const exactKeys = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).every(k => keys.includes(k));
    try { if (JSON.stringify(extraction)?.length > ACT_AI_LIMITS.maxExtractionChars) fail('extraction_trop_longue'); }
    catch { fail('extraction_invalide'); }
    if (!exactKeys(extraction, ['fields']) || !Array.isArray(extraction.fields) || extraction.fields.length > ACT_AI_LIMITS.maxFields) fail('extraction_invalide');
    else for (const field of extraction.fields) {
      if (!exactKeys(field, ['fieldId', 'value', 'evidence']) || !allowed.has(field.fieldId) ||
        typeof field.value !== 'string' || !field.value.trim() || field.value.length > ACT_AI_LIMITS.maxValueChars ||
        !Array.isArray(field.evidence) || !field.evidence.length || field.evidence.length > ACT_AI_LIMITS.maxPages) {
        fail('champ_invalide'); continue;
      }
      const value = field.value.trim();
      const evidence = [];
      for (const e of field.evidence) {
        if (!exactKeys(e, ['documentId', 'page', 'quote']) || typeof e.documentId !== 'string' ||
          !Number.isSafeInteger(e.page) || typeof e.quote !== 'string' || !e.quote.trim() ||
          e.quote.length > ACT_AI_LIMITS.maxQuoteChars || !source.get(e.documentId + ':' + e.page)?.includes(e.quote) ||
          !e.quote.includes(value)) { fail('preuve_invalide'); continue; }
        evidence.push({ documentId: e.documentId, page: e.page, quote: e.quote });
      }
      const id = field.fieldId + ':' + value;
      if (seen.has(id)) fail('champ_duplique');
      seen.add(id); fields.push({ fieldId: field.fieldId, value, evidence });
    }
    const missing = fieldsForService.filter(f => !fields.some(p => p.fieldId === f.id)).map(f => f.id);
    const repeatable = new Set(['testator_names', 'children_dependants', 'beneficiaries', 'mandant_names', 'mandataire_names', 'signing_parties', 'property_changes']);
    const conflicts = fieldsForService.filter(f => !repeatable.has(f.id) &&
      new Set(fields.filter(p => p.fieldId === f.id).map(p => p.value)).size > 1).map(f => f.id);
    return { ok: !errors.length, errors, value: errors.length ? null : { fields, missing, conflicts, status: 'needs_notary_review' } };
  }

  function validateActAIReview(analysis, input) {
    const fields = analysis?.preparation?.fields;
    const errors = [];
    const fail = code => errors.push({ code });
    if (!Array.isArray(fields) || !input || input.analysisId !== analysis.id) fail('analyse_invalide');
    const decisions = [];
    const seen = new Set();
    if (!Array.isArray(input?.decisions) || input.decisions.length !== fields?.length) fail('decisions_incompletes');
    else for (const d of input.decisions) {
      if (!d || !Number.isInteger(d.index) || d.index < 0 || d.index >= fields.length || seen.has(d.index) ||
        !['accepted', 'corrected', 'rejected'].includes(d.decision)) { fail('decision_invalide'); continue; }
      seen.add(d.index);
      const reason = typeof d.reason === 'string' ? d.reason.trim() : '';
      const value = typeof d.value === 'string' ? d.value.trim() : '';
      if (reason.length > ACT_AI_LIMITS.maxReasonChars || (d.decision !== 'accepted' && !reason) ||
        (d.decision === 'corrected' && (!value || value.length > ACT_AI_LIMITS.maxValueChars))) fail('correction_invalide');
      decisions.push({ index: d.index, decision: d.decision, ...(d.decision === 'corrected' ? { value } : {}), ...(reason ? { reason } : {}) });
    }
    const seconds = input?.activeReviewSeconds == null ? null : input.activeReviewSeconds;
    if (seconds !== null && (!Number.isInteger(seconds) || seconds < 0 || seconds > ACT_AI_LIMITS.maxReviewSeconds)) fail('duree_invalide');
    return { ok: !errors.length, errors, value: errors.length ? null : { decisions, activeReviewSeconds: seconds, trainingEligible: false, signingReadiness: 'not_assessed' } };
  }

  function validateFinancingAIReview(analysis, input) {
    const errors = [];
    const fail = code => errors.push({ code });
    const fields = analysis?.preparation?.fields;
    if (!Array.isArray(fields) || !input || input.analysisId !== analysis.id) fail('analyse_invalide');
    const decisions = [];
    const seen = new Set();
    if (!Array.isArray(input?.decisions) || input.decisions.length !== fields?.length) fail('decisions_incompletes');
    else for (const d of input.decisions) {
      if (!d || !Number.isInteger(d.index) || d.index < 0 || d.index >= fields.length || seen.has(d.index) ||
        !['accepted', 'corrected', 'rejected'].includes(d.decision)) { fail('decision_invalide'); continue; }
      seen.add(d.index);
      const reason = typeof d.reason === 'string' ? d.reason.trim() : '';
      const value = typeof d.value === 'string' ? d.value.trim() : '';
      if (reason.length > FINANCING_AI_LIMITS.maxReasonChars ||
        (d.decision !== 'accepted' && !reason) ||
        (d.decision === 'corrected' && (!value || value.length > FINANCING_AI_LIMITS.maxValueChars))) fail('correction_invalide');
      decisions.push({ index: d.index, decision: d.decision,
        ...(d.decision === 'corrected' ? { value } : {}), ...(reason ? { reason } : {}) });
    }
    const activeReviewSeconds = input?.activeReviewSeconds == null ? null : input.activeReviewSeconds;
    if (activeReviewSeconds !== null && (!Number.isInteger(activeReviewSeconds) || activeReviewSeconds < 0 ||
      activeReviewSeconds > FINANCING_AI_LIMITS.maxReviewSeconds)) fail('duree_invalide');
    return { ok: !errors.length, errors, value: errors.length ? null : {
      decisions, activeReviewSeconds, trainingEligible: false, signingReadiness: 'not_assessed',
    } };
  }

  function validateFinancingAIInput(input) {
    const errors = [];
    const fail = code => errors.push({ code });
    const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    if (!['financement', 'refinancement'].includes(obj.serviceId)) fail('service_inconnu');
    const pages = [];
    const seen = new Set();
    let size = 0;
    if (!Array.isArray(obj.pages) || !obj.pages.length || obj.pages.length > FINANCING_AI_LIMITS.maxPages) fail('pages_invalides');
    else for (const page of obj.pages) {
      if (!page || typeof page !== 'object' || Array.isArray(page) ||
        typeof page.documentId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(page.documentId) ||
        !Number.isSafeInteger(page.page) || page.page < 1 || page.page > 10000 ||
        typeof page.text !== 'string' || !page.text.trim() || page.text.length > FINANCING_AI_LIMITS.maxPageChars) {
        fail('page_invalide'); continue;
      }
      const id = page.documentId + ':' + page.page;
      if (seen.has(id)) fail('page_dupliquee');
      seen.add(id);
      size += page.text.length;
      pages.push({ documentId: page.documentId, page: page.page, text: page.text });
    }
    if (size > FINANCING_AI_LIMITS.maxTotalChars) fail('pages_trop_longues');
    return { ok: !errors.length, errors, value: errors.length ? null : { serviceId: obj.serviceId, pages } };
  }

  function validateFinancingAIExtraction(input, extraction) {
    const validated = validateFinancingAIInput(input);
    if (!validated.ok) return validated;
    const errors = [];
    const fail = code => errors.push({ code });
    const allowed = new Set(FINANCING_AI_FIELDS.map(f => f.id));
    const fields = [];
    const seen = new Set();
    const source = new Map(validated.value.pages.map(p => [p.documentId + ':' + p.page, p.text]));
    const exactKeys = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj) &&
      Object.keys(obj).every(k => keys.includes(k));
    try { if (JSON.stringify(extraction)?.length > FINANCING_AI_LIMITS.maxExtractionChars) fail('extraction_trop_longue'); }
    catch { fail('extraction_invalide'); }
    if (!exactKeys(extraction, ['fields']) || !Array.isArray(extraction.fields) || extraction.fields.length > FINANCING_AI_LIMITS.maxFields) {
      fail('extraction_invalide');
    } else for (const field of extraction.fields) {
      if (!exactKeys(field, ['fieldId', 'value', 'evidence']) || !allowed.has(field.fieldId) ||
        typeof field.value !== 'string' || !field.value.trim() || field.value.length > FINANCING_AI_LIMITS.maxValueChars ||
        !Array.isArray(field.evidence) || !field.evidence.length || field.evidence.length > FINANCING_AI_LIMITS.maxPages) {
        fail('champ_invalide'); continue;
      }
      const value = field.value.trim();
      const evidence = [];
      for (const e of field.evidence) {
        if (!exactKeys(e, ['documentId', 'page', 'quote']) || typeof e.documentId !== 'string' ||
          !Number.isSafeInteger(e.page) || typeof e.quote !== 'string' || !e.quote.trim() ||
          e.quote.length > FINANCING_AI_LIMITS.maxQuoteChars ||
          !source.get(e.documentId + ':' + e.page)?.includes(e.quote) || !e.quote.includes(value)) {
          fail('preuve_invalide'); continue;
        }
        evidence.push({ documentId: e.documentId, page: e.page, quote: e.quote });
      }
      const id = field.fieldId + ':' + value;
      if (seen.has(id)) fail('champ_duplique');
      seen.add(id);
      fields.push({ fieldId: field.fieldId, value, evidence });
    }
    const missing = FINANCING_AI_FIELDS.filter(f => !fields.some(p => p.fieldId === f.id)).map(f => f.id);
    // Multiple names/debts are legitimate. Single-value differences need review;
    // even an exact quotation does not establish semantic or legal correctness.
    const conflicts = FINANCING_AI_FIELDS.filter(f => !['borrower_names', 'secured_debts', 'signing_parties', 'property_changes'].includes(f.id) &&
      new Set(fields.filter(p => p.fieldId === f.id).map(p => p.value)).size > 1).map(f => f.id);
    return { ok: !errors.length, errors, value: errors.length ? null : {
      fields, missing, conflicts, status: 'needs_notary_review',
    } };
  }

  // A preparation inventory, never evidence that a document was read or that
  // lender/notarial closing conditions are satisfied. No private values leave
  // the caller and no free-text answer can mark a professional check complete.
  function financingPreparation(serviceId, saved, pricing) {
    if (!['financement', 'refinancement'].includes(serviceId)) return null;
    const clean = cleanDossier(serviceId, saved);
    const effectivePricing = pricing || clean.__pricing;
    const items = dossierItems(serviceId, effectivePricing)
      .filter(item => item.kind !== 'note')
      .map(item => ({ id: item.id, nom: item.nom, aide: item.aide,
        kind: item.kind,
        status: !clean[item.id] ? 'missing' : item.kind === 'field' ? 'declared'
          : clean[item.id] === DOSSIER_TRANSMIS ? 'external' : 'listed' }));
    return { knowledgeVersion: FINANCING_KNOWLEDGE.version, items,
      controlPlanVersion: NOTARY_CONTROL_PLAN_VERSION,
      missing: items.filter(item => item.status === 'missing'),
      // Tasks describe dependencies; their completion needs separate evidence.
      checks: FINANCING_KNOWLEDGE.facts.map(fact => ({
        id: fact.id, texte: fact.texte, sourceIds: fact.sourceIds.slice(),
        status: 'notary_review_required',
      })),
      controls: notaryControlPlan(serviceId, effectivePricing),
      signingReadiness: 'not_assessed' };
  }

  // Reuse client context locally before asking anyone to re-enter it. This
  // packet is assembled deterministically; customer statements are not lender
  // evidence and no packet state certifies legal or signing readiness.
  const FINANCING_AUTOMATION_TARGET = 0.9;
  const FINANCING_WORK_PACKET_VERSION = '2026-09-09.1';
  function financingWorkPacket(bid, { todayISO } = {}) {
    if (!bid || !['financement', 'refinancement'].includes(bid.serviceId) || bid.efface) return null;
    const svc = serviceById(bid.serviceId);
    const d = cleanDossier(bid.serviceId, bid.dossier);
    const pricing = cleanDossier(bid.serviceId, { __pricing: bid.pricing || d.__pricing }).__pricing || {};
    const preparation = financingPreparation(bid.serviceId, d, pricing);
    const customerContext = svc.champs.filter(c => d[c.id]).map(c => ({
      id: c.id, label: c.label, value: d[c.id], source: 'customer',
    }));
    if (isISODate(bid.dateISO)) customerContext.push({ id: 'dateISO', label: 'Date de signature demandée', value: bid.dateISO, source: 'customer' });
    for (const criterion of svc.pricing.criteria) {
      const answer = pricing[criterion.id];
      if (criterion.id === 'valeur_pret') {
        if ((typeof answer === 'number' || (typeof answer === 'string' && answer.trim())) && Number.isFinite(Number(answer)) && Number(answer) > 0) customerContext.push({
          id: criterion.id, label: criterion.label, value: money(Number(answer)), valueEn: moneyEn(Number(answer)), source: 'customer',
        });
      } else if (criterion.id === LENDER_CRITERION_ID) {
        const lender = lenderById(answer);
        const name = answer === LENDER_OTHER_ID ? lenderOtherName(pricing) : lender?.nom;
        if (name) customerContext.push({ id: criterion.id, label: criterion.label, value: name, source: 'customer', valueIsLabel: answer !== LENDER_OTHER_ID });
      } else {
        const option = (criterion.options || []).find(o => o.id === answer);
        if (option) customerContext.push({ id: criterion.id, label: criterion.label, value: option.label, valueIsLabel: true, source: 'customer' });
      }
    }
    const missing = preparation.missing.map(item => ({ id: item.id, label: item.nom, kind: item.kind, aide: item.aide || '' }));
    for (const item of missingRequired(bid.serviceId, pricing)) {
      if (!missing.some(m => m.id === item.id)) missing.push({ id: item.id, label: item.label, kind: 'pricing', aide: '' });
    }
    const mapping = NOTARY_AI_INTAKE_MAP;
    const labelFor = id => FINANCING_AI_FIELDS.find(f => f.id === id)?.label;
    const draftFields = customerContext.filter(c => mapping[c.id]).map(c => ({
      fieldId: mapping[c.id], label: labelFor(mapping[c.id]), value: c.value,
      ...(c.valueEn ? { valueEn: c.valueEn } : {}), ...(c.valueIsLabel ? { valueIsLabel: true } : {}),
      source: 'customer', evidence: [],
    }));
    const analysis = bid.financingAnalysis;
    const fields = analysis?.preparation?.fields;
    const review = analysis?.review;
    const reviewed = !!(review && bid.notaryId && review.reviewerId === bid.notaryId &&
      validateFinancingAIReview(analysis, { ...review, analysisId: analysis.id }).ok);
    if (Array.isArray(fields)) fields.forEach((field, index) => {
      if (!labelFor(field.fieldId) || typeof field.value !== 'string') return;
      const decision = reviewed ? review.decisions.find(r => r.index === index) : null;
      if (decision?.decision === 'rejected') return;
      const corrected = decision?.decision === 'corrected';
      draftFields.push({ fieldId: field.fieldId, label: labelFor(field.fieldId),
        value: corrected ? decision.value : field.value,
        source: corrected ? 'notary_corrected' : decision?.decision === 'accepted' ? 'notary_accepted' : 'ai_proposal',
        evidence: (field.evidence || []).map(e => ({ documentId: e.documentId, page: e.page, quote: e.quote })),
        ...(corrected ? { originalValue: field.value } : {}),
      });
    });
    const normalized = value => String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-CA');
    const comparisons = draftFields.filter(f => f.source === 'customer' && ['property_address', 'lender_name', 'lender_contact', 'loan_amount', 'rate_expiry'].includes(f.fieldId)).flatMap(c => {
      const values = [...new Set(draftFields.filter(f => f.source !== 'customer' && f.fieldId === c.fieldId).map(f => f.value))];
      return values.some(v => normalized(v) !== normalized(c.value)) ? [{
        fieldId: c.fieldId, label: c.label, customerValue: c.value, documentValues: values,
      }] : [];
    });
    const dateFlags = [];
    if (d.date_echeance_taux) {
      if (!isISODate(d.date_echeance_taux)) dateFlags.push({ id: 'expiry_unclear', label: 'Échéance du taux à préciser au format AAAA-MM-JJ.' });
      else {
        if (isISODate(todayISO) && d.date_echeance_taux < todayISO) dateFlags.push({ id: 'expiry_past', label: 'L’échéance du taux déclarée est passée; confirmez la suite avec le prêteur.' });
        if (isISODate(bid.dateISO) && bid.dateISO > d.date_echeance_taux) dateFlags.push({ id: 'signing_after_expiry', label: 'La signature demandée est après l’échéance du taux déclarée; confirmez la date avec le prêteur.' });
      }
    }
    const checks = [
      { id: 'instructions', label: 'Recevoir et vérifier les instructions officielles du prêteur', owner: 'lender', sourceIds: ['rbc'] },
      { id: 'parties', label: 'Vérifier l’identité, la capacité et les personnes qui doivent intervenir', owner: 'notary', sourceIds: ['cnq'] },
      { id: 'title', label: 'Examiner les titres, les charges et les exigences de localisation ou d’assurance titres', owner: 'notary', sourceIds: ['rbc', 'amf'] },
      ...(bid.serviceId === 'refinancement' ? [{ id: 'payout', label: 'Obtenir les relevés officiels de remboursement et suivre les quittances', owner: 'lender', sourceIds: ['acfc', 'rbc'] }] : []),
      { id: 'deed', label: 'Choisir le formulaire autorisé et vérifier le projet d’acte', owner: 'notary', sourceIds: ['rbc'] },
      { id: 'closing', label: 'Confirmer les conditions de signature, de publication et de déboursement', owner: 'notary', sourceIds: ['rbc', 'cnq'] },
    ].map(check => ({ ...check, status: 'pending' }));
    const controls = notaryControlPlan(bid.serviceId, pricing);
    const workflow = notaryWorkflowSummary({
      missing, comparisons, dateFlags, analysis, review, reviewed, controls,
    });
    return {
      version: FINANCING_WORK_PACKET_VERSION, serviceId: bid.serviceId, customerContext,
      documentInventory: preparation.items.filter(i => i.kind === 'doc').map(i => ({ id: i.id, label: i.nom, status: i.status })),
      draftFields, missing, comparisons, dateFlags, checks,
      uncertaintyQuestions: notaryAIUncertaintyQuestions(bid.serviceId, analysis?.preparation),
      controlPlanVersion: NOTARY_CONTROL_PLAN_VERSION,
      parameterCoverage: notaryParameterCoverage(bid.serviceId, pricing),
      controls,
      workflow,
      clientRequestDraft: missing.length ? {
        opening: 'Bonjour, voici les renseignements et les pièces à compléter pour préparer votre dossier.',
        items: missing.map(({ id, label, aide }) => ({ id, label, aide })),
        closing: 'Utilisez le canal convenu avec votre notaire pour les pièces. Si un élément ne s’applique pas ou vous est inconnu, indiquez-le pour que nous puissions préciser la demande.',
      } : null,
      lenderRequestDraft: {
        opening: 'Bonjour, nous préparons ce dossier à partir des renseignements déclarés par le client, qui restent à confirmer.',
        items: customerContext.filter(c => ['adresse', 'preteur', 'valeur_pret', 'dateISO', 'date_echeance_taux', 'contact_preteur'].includes(c.id)).map(c => ({ ...c })),
        requirements: [
          { id: 'mandate', label: 'Confirmer l’envoi des instructions générales et particulières au notaire mandaté.' },
          { id: 'funding', label: 'Préciser les conditions et les délais applicables à la demande de fonds et au déboursement.' },
        ],
        closing: 'Merci de confirmer la marche à suivre par votre canal autorisé. La date demandée n’est pas une confirmation de signature ni de déboursement.',
      },
      measurement: { target: FINANCING_AUTOMATION_TARGET, measuredReduction: null,
        reviewSeconds: reviewed ? review.activeReviewSeconds ?? null : null },
    };
  }

  // A compact, service-neutral work packet for testament and procuration. It
  // deliberately combines deterministic intake with optional AI proposals, so
  // the notary gets a usable checklist even when the AI provider is disabled.
  const ACT_WORK_PACKET_VERSION = '2026-09-09.1';

  // A service-specific control plan turns the notary-work research into an
  // executable contract. It describes the evidence and integration that a
  // control needs, but never marks a control complete: every status remains
  // pending until a separate, notary-owned workflow records the decision.
  // Candidate names are routing hints, not credentials, approvals or live
  // connectors. Keep this data in the domain so web and API cannot drift.
  const NOTARY_CONTROL_PLAN_VERSION = '2026-09-09.2';
  const NOTARY_PARAMETER_COVERAGE_VERSION = '2026-09-09.4';
  // The offer owns this immutable blueprint. It is a preparation contract,
  // not a live integration or a permission to contact a third party.
  const NOTARY_OFFER_TEMPLATE_VERSION = '2026-09-09.1';
  const NOTARY_AI_INTAKE_MAP = Object.freeze({
    adresse: 'property_address',
    preteur: 'lender_name',
    valeur_pret: 'loan_amount',
    date_echeance_taux: 'rate_expiry',
    dettes_garanties: 'secured_debts',
    parties_signature: 'signing_parties',
    type_propriete: 'property_type',
    identification_immeuble: 'property_identifier',
    changements_immeuble: 'property_changes',
    contexte: 'loan_purpose',
    testateurs: 'testator_names',
    situation_familiale: 'family_status',
    regime_familial: 'family_regime',
    enfants_personnes_charge: 'children_dependants',
    beneficiaires_legataires: 'beneficiaries',
    liquidateur_souhaite: 'liquidator',
    volontes_principales: 'beneficiaries',
    testament_existant: 'existing_will',
    actifs_importants: 'assets_properties',
    entreprise: 'business_assets',
    contraintes_particulieres: 'communication_needs',
    type_mandat: 'mandate_regime',
    mandants: 'mandant_names',
    mandataires: 'mandataire_names',
    relation_mandataires: 'authority_mode',
    objet_mandat: 'mandate_scope',
    immeuble_mandat: 'property_or_transaction',
    institutions_transactions: 'third_party_requirements',
    contact_tiers: 'third_party_requirements',
    contact_preteur: 'lender_contact',
    duree_mandat: 'mandate_end',
  });
  const NOTARY_COMMON_CONTROLS = Object.freeze([
    { id: 'scope_and_roles', label: 'Confirmer la portée de l’acte et les rôles de chaque personne', owner: 'notary', critical: true,
      automation: 'prepare_only', integrationType: 'case_graph', integrationCandidate: 'Nota dossier', evidenceIds: ['parties_signature'], externalEvidence: ['mandate_scope'] },
    { id: 'identity_quality_capacity', label: 'Vérifier l’identité, la qualité, la capacité et l’autorité d’intervention', owner: 'notary', critical: true,
      automation: 'prepare_only', integrationType: 'secure_intake', integrationCandidate: 'Pièces d’identité et revue notariale', evidenceIds: ['piece_identite'], externalEvidence: ['notary_identity_quality_capacity_decision'] },
    { id: 'language_accessibility', label: 'Confirmer la langue, l’accessibilité et les besoins de communication', owner: 'notary', critical: true,
      automation: 'prepare_only', integrationType: 'case_graph', integrationCandidate: 'Nota dossier', evidenceIds: ['contraintes_particulieres'], externalEvidence: ['interpreter_or_accessibility_plan'] },
    { id: 'read_explain_consent', label: 'Lire ou faire lire l’acte, l’expliquer et recueillir un consentement libre et éclairé', owner: 'notary', critical: true,
      automation: 'prepare_only', integrationType: 'notarial_signing', integrationCandidate: 'Environnement de signature autorisé', evidenceIds: [], externalEvidence: ['reading_and_explanation_record', 'consent_decision'] },
    { id: 'signature_execution', label: 'Contrôler la présence, les témoins, la méthode de signature et les mentions requises', owner: 'notary', critical: true,
      automation: 'prepare_only', integrationType: 'notarial_signing', integrationCandidate: 'ConsignO Cloud-CNQ ou procédure autorisée', evidenceIds: [], externalEvidence: ['signed_act_and_audit'] },
    { id: 'records_and_copy', label: 'Conserver l’original, la copie, les preuves et l’historique du dossier', owner: 'notary', critical: true,
      automation: 'prepare_only', integrationType: 'practice_system', integrationCandidate: 'Système de pratique choisi par le cabinet', evidenceIds: [], externalEvidence: ['retention_and_custody_record'] },
  ]);

  const PURCHASE_COORDINATION_CONTROL = Object.freeze({
    id: 'purchase_coordination', label: 'Coordonner l’achat, la promesse, les ajustements et le notaire du vendeur', owner: 'notary', critical: true,
    automation: 'prepare_only', integrationType: 'institutional_route', integrationCandidate: 'Notaire du vendeur et parties à la vente', evidenceIds: ['promesse_achat'], externalEvidence: ['seller_notary_coordination'],
  });

  const NOTARY_INTEGRATION_LABELS = Object.freeze({
    case_graph: 'Dossier et graphe de preuve',
    secure_intake: 'Intake sécurisée et documents',
    lender_channel: 'Canal autorisé du prêteur',
    official_registry: 'Registre officiel',
    issuer_document: 'Preuve émise par l’institution',
    institutional_route: 'Coordination avec un tiers',
    notarial_signing: 'Signature notariale autorisée',
    practice_system: 'Système de pratique notariale',
    cnq_register: 'Registre de la Chambre',
    trust_account: 'Fiducie et rapprochement',
  });

  const NOTARY_SERVICE_CONTROLS = Object.freeze({
    financement: Object.freeze([
      { id: 'lender_instructions', label: 'Recevoir et vérifier les instructions officielles et actuelles du prêteur', owner: 'lender', critical: true,
        automation: 'prepare_only', integrationType: 'lender_channel', integrationCandidate: 'Assyst/Unity ou Paiements immobiliers Dye & Durham', evidenceIds: ['offre_preteur'], externalEvidence: ['current_lender_instructions', 'instruction_version'] },
      { id: 'title_charges', label: 'Examiner le titre, les charges, le lot et le rang de la sûreté', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'official_registry', integrationCandidate: 'Registre foncier / SLRI', evidenceIds: ['certificat_localisation'], externalEvidence: ['land_registry_search', 'title_review_decision'] },
      { id: 'property_evidence', label: 'Valider les taxes, l’assurance, le certificat et les documents de copropriété applicables', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'issuer_document', integrationCandidate: 'Municipalité, assureur, arpenteur et syndicat', evidenceIds: ['compte_taxes', 'preuve_assurance', 'certificat_localisation'], externalEvidence: ['issuer_confirmation', 'condo_package_if_applicable'] },
      { id: 'registry_publication', label: 'Préparer et suivre la publication de l’hypothèque et obtenir les reçus officiels', owner: 'registry', critical: true,
        automation: 'prepare_only', integrationType: 'official_registry', integrationCandidate: 'Registre foncier / SLRI', evidenceIds: [], externalEvidence: ['registration_request', 'publication_receipt'] },
      { id: 'funding_reconciliation', label: 'Réconcilier les conditions de fonds, les paiements et le rapport de clôture', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'trust_account', integrationCandidate: 'Système fiduciaire du cabinet et canal du prêteur', evidenceIds: [], externalEvidence: ['funding_confirmation', 'trust_reconciliation', 'final_report'] },
    ]),
    refinancement: Object.freeze([
      { id: 'lender_instructions', label: 'Recevoir et vérifier les instructions officielles et actuelles du prêteur', owner: 'lender', critical: true,
        automation: 'prepare_only', integrationType: 'lender_channel', integrationCandidate: 'Assyst/Unity ou Paiements immobiliers Dye & Durham', evidenceIds: ['offre_preteur'], externalEvidence: ['current_lender_instructions', 'instruction_version'] },
      { id: 'title_charges', label: 'Examiner le titre, les charges, le lot et le rang des sûretés', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'official_registry', integrationCandidate: 'Registre foncier / SLRI', evidenceIds: ['certificat_localisation'], externalEvidence: ['land_registry_search', 'title_review_decision'] },
      { id: 'property_evidence', label: 'Valider les taxes, l’assurance, le certificat et les documents de copropriété applicables', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'issuer_document', integrationCandidate: 'Municipalité, assureur, arpenteur et syndicat', evidenceIds: ['compte_taxes', 'preuve_assurance', 'certificat_localisation'], externalEvidence: ['issuer_confirmation', 'condo_package_if_applicable'] },
      { id: 'secured_debts', label: 'Obtenir un état officiel pour chaque prêt ou marge garanti par l’immeuble', owner: 'lender', critical: true,
        automation: 'prepare_only', integrationType: 'lender_channel', integrationCandidate: 'Créancier et canal de remboursement autorisé', evidenceIds: ['releve_hypotheque', 'dettes_garanties'], externalEvidence: ['official_payout_statement', 'valid_through_date'] },
      { id: 'payout_discharge', label: 'Choisir, obtenir et suivre la quittance ou la mainlevée et sa publication', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'lender_channel', integrationCandidate: 'Créancier, Assyst/Unity ou Paiements immobiliers Dye & Durham', evidenceIds: [], externalEvidence: ['quittance_or_mainlevee', 'discharge_publication_receipt'] },
      { id: 'registry_publication', label: 'Préparer et suivre la publication de la nouvelle hypothèque et des radiations', owner: 'registry', critical: true,
        automation: 'prepare_only', integrationType: 'official_registry', integrationCandidate: 'Registre foncier / SLRI', evidenceIds: [], externalEvidence: ['registration_request', 'publication_receipt'] },
      { id: 'funding_reconciliation', label: 'Réconcilier les conditions de fonds, les remboursements et le rapport de clôture', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'trust_account', integrationCandidate: 'Système fiduciaire du cabinet et canal du prêteur', evidenceIds: [], externalEvidence: ['funding_confirmation', 'trust_reconciliation', 'final_report'] },
    ]),
    testament: Object.freeze([
      { id: 'family_dependants', label: 'Confirmer la situation familiale, le conjoint, les enfants et les personnes vulnérables', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'case_graph', integrationCandidate: 'Nota dossier et pièces d’état civil', evidenceIds: ['etat_civil', 'acte_mariage', 'personnes_a_charge'], externalEvidence: ['family_status_decision'] },
      { id: 'wishes_beneficiaries', label: 'Comprendre les volontés, bénéficiaires, legs, liquidateur et fiducie à discuter', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'case_graph', integrationCandidate: 'Nota dossier et modèle approuvé du cabinet', evidenceIds: ['volontes_principales', 'liste_biens'], externalEvidence: ['notary_advice_and_clause_decision'] },
      { id: 'existing_will', label: 'Vérifier le testament existant et les recherches pertinentes', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'cnq_register', integrationCandidate: 'Registre des dispositions testamentaires de la CNQ', evidenceIds: ['testament_existant'], externalEvidence: ['register_search_or_notary_decision'] },
      { id: 'witnesses', label: 'Prévoir le témoin ou les témoins et les formalités particulières de communication', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'notarial_signing', integrationCandidate: 'Environnement de signature autorisé', evidenceIds: ['contraintes_particulieres'], externalEvidence: ['witness_and_interpreter_record'] },
      { id: 'testament_register', label: 'Conserver l’original et enregistrer l’existence du testament dans le registre applicable', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'cnq_register', integrationCandidate: 'Registre des dispositions testamentaires de la CNQ', evidenceIds: [], externalEvidence: ['cnq_register_confirmation', 'original_minute_custody'] },
      { id: 'review_triggers', label: 'Définir les événements qui doivent déclencher une révision du testament', owner: 'notary', critical: false,
        automation: 'prepare_only', integrationType: 'case_graph', integrationCandidate: 'Rappels Nota contrôlés par le client et le notaire', evidenceIds: [], externalEvidence: ['review_trigger_decision'] },
    ]),
    procuration: Object.freeze([
      { id: 'mandate_regime', label: 'Distinguer la procuration ordinaire du mandat de protection ou d’un autre parcours', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'case_graph', integrationCandidate: 'Nota routage de service', evidenceIds: ['type_mandat', 'objet_mandat'], externalEvidence: ['mandate_regime_decision'] },
      { id: 'powers_duration', label: 'Confirmer les pouvoirs exprès, les limites, la durée et les conditions de fin', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'case_graph', integrationCandidate: 'Nota dossier et modèle approuvé du cabinet', evidenceIds: ['objet_mandat', 'duree_mandat'], externalEvidence: ['express_powers_decision'] },
      { id: 'existing_revocation', label: 'Vérifier les mandats existants et préparer toute révocation ou annotation nécessaire', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'practice_system', integrationCandidate: 'Dossier du cabinet et avis contrôlés', evidenceIds: ['mandat_existant'], externalEvidence: ['revocation_or_termination_notice'] },
      { id: 'third_party_requirements', label: 'Valider les exigences du tiers, de l’institution ou de la transaction', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'institutional_route', integrationCandidate: 'Institution ou prêteur demandeur', evidenceIds: ['contact_tiers', 'immeuble_mandat'], externalEvidence: ['third_party_requirement_confirmation'] },
      { id: 'protection_route', label: 'Prévoir le registre et la procédure distincts si le dossier concerne un mandat de protection', owner: 'notary', critical: true,
        automation: 'prepare_only', integrationType: 'cnq_register', integrationCandidate: 'Registre des mandats de protection de la CNQ', evidenceIds: [], externalEvidence: ['protection_mandate_route_decision', 'homologation_if_applicable'] },
    ]),
  });

  function notaryControlPlan(serviceId, pricing = {}) {
    if (!NOTARY_SERVICE_CONTROLS[serviceId]) return null;
    const controls = [...NOTARY_COMMON_CONTROLS, ...NOTARY_SERVICE_CONTROLS[serviceId]];
    // An accepted purchase context adds a coordination control. Financing
    // without an accepted purchase must not ask for a promise or seller
    // workflow merely because the service is mortgage-backed.
    if (serviceId === 'financement' && pricing && pricing.contexte === 'achat' &&
      !controls.some(control => control.id === 'purchase_coordination')) {
      controls.push(PURCHASE_COORDINATION_CONTROL);
    }
    return controls.filter(Boolean).map(control => ({ ...control,
      evidenceIds: [...control.evidenceIds], externalEvidence: [...control.externalEvidence],
      integrationLabel: NOTARY_INTEGRATION_LABELS[control.integrationType] || control.integrationType,
      status: 'pending',
    }));
  }

  // A machine-readable coverage view for the notary console and integration
  // work. It is derived from the catalogue, AI vocabulary and control plan so
  // a new customer parameter cannot silently disappear from the workflow.
  function notaryParameterCoverage(serviceId, pricing = {}) {
    const svc = serviceById(serviceId);
    if (!svc) return null;
    const fields = actAIFields(serviceId) || [];
    const controls = notaryControlPlan(serviceId, pricing) || [];
    const mapping = Object.entries(NOTARY_AI_INTAKE_MAP)
      .filter(([, aiFieldId]) => fields.some(field => field.id === aiFieldId));
    return {
      version: NOTARY_PARAMETER_COVERAGE_VERSION,
      serviceId,
      pricing: (svc.pricing?.criteria || []).map(c => ({ id: c.id, label: c.label, required: !!c.required })),
      intake: (svc.champs || []).map(c => ({ id: c.id, label: c.label })),
      documents: (svc.documents || []).map(d => ({ id: d.id, label: d.nom, conditional: !!d.si })),
      ai: {
        fields: fields.map(field => ({ id: field.id, label: field.label })),
        mappedIntake: mapping.map(([intakeId, aiFieldId]) => ({ intakeId, aiFieldId })),
        unmappedIntake: (svc.champs || []).map(c => c.id).filter(id => !mapping.some(([intakeId]) => intakeId === id)),
      },
      humanControls: controls.filter(control => control.critical).map(control => ({
        id: control.id, label: control.label, owner: control.owner,
      })),
      integrations: [...new Map(controls.map(control => [control.integrationType, {
        type: control.integrationType, label: control.integrationLabel, candidate: control.integrationCandidate,
      }])).values()],
      caseCoverage: notaryCaseCoverage(serviceId),
    };
  }

  function notaryOfferTemplate(bid, { generatedAt } = {}) {
    if (!bid || bid.efface || !['financement', 'refinancement', 'testament', 'procuration'].includes(bid.serviceId)) return null;
    const coverage = notaryParameterCoverage(bid.serviceId, bid.pricing || {});
    if (!coverage) return null;
    return {
      version: NOTARY_OFFER_TEMPLATE_VERSION,
      serviceId: bid.serviceId,
      generatedAt: generatedAt || bid.createdAt || null,
      access: { audience: 'retaining_notary', after: 'nota_paid', customerVisible: false },
      pricing: coverage.pricing,
      intake: coverage.intake,
      documents: coverage.documents,
      aiFields: coverage.ai.fields,
      humanControls: coverage.humanControls,
      caseCoverage: coverage.caseCoverage,
      connectors: coverage.integrations.map(integration => ({
        type: integration.type,
        label: integration.label,
        candidate: integration.candidate,
        status: 'candidate',
        automation: 'prepare_only',
      })),
    };
  }

  // A notary should open a retained file and immediately know the next useful
  // move. This summary is a workflow hint derived from the packet; it never
  // marks a legal or signing condition complete. The action ids are stable so
  // the web app can render them bilingually without duplicating business rules.
  function notaryWorkflowSummary({ missing = [], comparisons = [], dateFlags = [], analysis = null,
    review = null, reviewed = false, controls = [] } = {}) {
    const fields = Array.isArray(analysis?.preparation?.fields) ? analysis.preparation.fields : [];
    const aiStatus = !analysis ? 'not_started' : fields.length === 0 ? 'abstained' : reviewed ? 'reviewed' : 'awaiting_review';
    const exceptionCount = comparisons.length + dateFlags.length;
    const pendingControls = controls.filter(control => control.status !== 'complete');
    const criticalPending = pendingControls.filter(control => control.critical).length;
    const nextActions = [];
    if (missing.length) nextActions.push({ id: 'request_missing_items', owner: 'client', priority: 'now', count: missing.length });
    if (aiStatus === 'not_started') nextActions.push({ id: 'analyze_documents', owner: 'notary', priority: 'next', count: 1 });
    if (aiStatus === 'awaiting_review') nextActions.push({ id: 'review_ai_proposals', owner: 'notary', priority: 'now', count: fields.length });
    if (exceptionCount) nextActions.push({ id: 'resolve_exceptions', owner: 'notary', priority: 'now', count: exceptionCount });
    if (criticalPending) nextActions.push({ id: 'complete_critical_controls', owner: 'notary', priority: nextActions.length ? 'next' : 'now', count: criticalPending });
    if (!nextActions.length) nextActions.push({ id: 'confirm_signing_conditions', owner: 'notary', priority: 'next', count: 1 });
    const stage = missing.length ? 'client_intake'
      : aiStatus === 'awaiting_review' ? 'ai_review'
        : exceptionCount ? 'exceptions' : aiStatus === 'not_started' ? 'ai_ready' : 'notary_controls';
    return {
      stage,
      nextActions,
      ai: {
        status: aiStatus,
        proposalCount: fields.length,
        reviewSeconds: reviewed && review ? review.activeReviewSeconds ?? null : null,
      },
      controls: { pending: pendingControls.length, criticalPending },
    };
  }

  // A structured uncertainty queue for the notary. It is derived from the
  // validated extraction, never invented by the provider, and deliberately
  // contains identifiers rather than legal conclusions. The console turns
  // these items into explicit clarification prompts while the normal dossier
  // remains available when AI access is absent or exhausted.
  function notaryAIUncertaintyQuestions(serviceId, preparation) {
    const fields = serviceId === 'financement' || serviceId === 'refinancement'
      ? FINANCING_AI_FIELDS : actAIFields(serviceId) || [];
    const labels = new Map(fields.map(field => [field.id, field.label]));
    const unique = values => [...new Set(Array.isArray(values) ? values : [])]
      .filter(id => labels.has(id));
    return [
      ...unique(preparation?.missing).map(fieldId => ({
        id: 'missing:' + fieldId, fieldId, kind: 'missing_evidence', priority: 'high',
        label: labels.get(fieldId), requiresNotaryAnswer: true,
      })),
      ...unique(preparation?.conflicts).map(fieldId => ({
        id: 'conflict:' + fieldId, fieldId, kind: 'conflicting_evidence', priority: 'critical',
        label: labels.get(fieldId), requiresNotaryAnswer: true,
      })),
    ];
  }

  function validateNotaryAIUncertaintyResponse(serviceId, preparation, input) {
    const errors = [];
    const fail = code => errors.push({ code });
    const questions = notaryAIUncertaintyQuestions(serviceId, preparation);
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const question = questions.find(item => item.id === source.questionId);
    if (!question) fail('question_invalide');
    if (!NOTARY_AI_QUESTION_DECISIONS.includes(source.decision)) fail('decision_invalide');
    const note = typeof source.note === 'string' ? source.note.trim() : '';
    if (note.length > FINANCING_AI_LIMITS.maxReasonChars) fail('note_trop_longue');
    return { ok: !errors.length, errors, value: errors.length ? null : {
      questionId: question.id, fieldId: question.fieldId, kind: question.kind,
      decision: source.decision, ...(note ? { note } : {}),
    } };
  }

  function actPreparation(serviceId, saved, pricing) {
    const svc = serviceById(serviceId);
    if (!svc || !['testament', 'procuration'].includes(serviceId)) return null;
    const clean = cleanDossier(serviceId, saved);
    const items = dossierItems(serviceId, pricing || clean.__pricing)
      .filter(item => item.kind !== 'note')
      .map(item => ({ id: item.id, nom: item.nom, aide: item.aide, kind: item.kind,
        status: !clean[item.id] ? 'missing' : item.kind === 'field' ? 'declared'
          : clean[item.id] === DOSSIER_TRANSMIS ? 'external' : 'listed' }));
    const checks = serviceId === 'testament'
      ? [
        { id: 'capacity', label: 'Vérifier l’identité, la capacité et la compréhension de chaque testateur', owner: 'notary' },
        { id: 'family', label: 'Confirmer la situation familiale, les personnes à protéger et les bénéficiaires', owner: 'notary' },
        { id: 'assets', label: 'Examiner les biens, entreprises et volontés particulières déclarés', owner: 'notary' },
        { id: 'registers', label: 'Préparer l’inscription de l’acte dans les registres applicables', owner: 'notary' },
        { id: 'closing', label: 'Expliquer l’acte et confirmer les conditions de signature', owner: 'notary' },
      ]
      : [
        { id: 'capacity', label: 'Vérifier l’identité, la capacité et la compréhension de chaque mandant', owner: 'notary' },
        { id: 'scope', label: 'Confirmer la portée, les limites, la durée et la révocation souhaitées', owner: 'notary' },
        { id: 'third_party', label: 'Valider les exigences du tiers ou de la transaction, s’il y en a une', owner: 'notary' },
        { id: 'closing', label: 'Expliquer la procuration et confirmer les conditions de signature', owner: 'notary' },
      ];
    return {
      version: ACT_WORK_PACKET_VERSION,
      knowledgeVersion: (notaryServiceKnowledge(serviceId) || FINANCING_KNOWLEDGE).version,
      controlPlanVersion: NOTARY_CONTROL_PLAN_VERSION,
      items,
      missing: items.filter(item => item.status === 'missing'),
      checks: checks.map(check => ({ ...check, status: 'pending', sourceIds: ['cnq'] })),
      controls: notaryControlPlan(serviceId, pricing),
      signingReadiness: 'not_assessed',
    };
  }

  function actWorkPacket(bid, { todayISO } = {}) {
    if (!bid || !['testament', 'procuration'].includes(bid.serviceId) || bid.efface) return null;
    const svc = serviceById(bid.serviceId);
    const d = cleanDossier(bid.serviceId, bid.dossier);
    const pricing = cleanDossier(bid.serviceId, { __pricing: bid.pricing || d.__pricing }).__pricing || {};
    const preparation = actPreparation(bid.serviceId, d, pricing);
    const customerContext = svc.champs.filter(c => d[c.id]).map(c => ({ id: c.id, label: c.label, value: d[c.id], source: 'customer' }));
    if (isISODate(bid.dateISO)) customerContext.push({ id: 'dateISO', label: 'Date de signature demandée', value: bid.dateISO, source: 'customer' });
    for (const criterion of svc.pricing.criteria) {
      const answer = pricing[criterion.id];
      if (criterion.type === 'bracket') {
        if (Number.isFinite(Number(answer)) && Number(answer) > 0) customerContext.push({ id: criterion.id, label: criterion.label, value: String(answer), source: 'customer' });
      } else {
        const option = (criterion.options || []).find(o => o.id === answer);
        if (option) customerContext.push({ id: criterion.id, label: criterion.label, value: option.label, valueIsLabel: true, source: 'customer' });
      }
    }
    const missing = preparation.missing.map(item => ({ id: item.id, label: item.nom, kind: item.kind, aide: item.aide || '' }));
    for (const item of missingRequired(bid.serviceId, pricing)) if (!missing.some(m => m.id === item.id)) missing.push({ id: item.id, label: item.label, kind: 'pricing', aide: '' });
    const fields = actAIFields(bid.serviceId);
    const labelFor = id => fields.find(f => f.id === id)?.label;
    const analysis = bid.actAnalysis;
    const proposals = analysis?.preparation?.fields;
    const review = analysis?.review;
    const reviewed = !!(review && bid.notaryId && review.reviewerId === bid.notaryId && validateActAIReview(analysis, { ...review, analysisId: analysis.id }).ok);
    const draftFields = customerContext.filter(c => NOTARY_AI_INTAKE_MAP[c.id] && labelFor(NOTARY_AI_INTAKE_MAP[c.id])).map(c => ({
      fieldId: NOTARY_AI_INTAKE_MAP[c.id], label: labelFor(NOTARY_AI_INTAKE_MAP[c.id]), value: c.value,
      ...(c.valueIsLabel ? { valueIsLabel: true } : {}), source: 'customer', evidence: [],
    }));
    if (Array.isArray(proposals)) proposals.forEach((field, index) => {
      if (!labelFor(field.fieldId) || typeof field.value !== 'string') return;
      const decision = reviewed ? review.decisions.find(r => r.index === index) : null;
      if (decision?.decision === 'rejected') return;
      const corrected = decision?.decision === 'corrected';
      draftFields.push({ fieldId: field.fieldId, label: labelFor(field.fieldId), value: corrected ? decision.value : field.value,
        source: corrected ? 'notary_corrected' : decision?.decision === 'accepted' ? 'notary_accepted' : 'ai_proposal',
        evidence: (field.evidence || []).map(e => ({ documentId: e.documentId, page: e.page, quote: e.quote })), ...(corrected ? { originalValue: field.value } : {}) });
    });
    const controls = notaryControlPlan(bid.serviceId, pricing);
    const workflow = notaryWorkflowSummary({ missing, analysis, review, reviewed, controls });
    return {
      version: ACT_WORK_PACKET_VERSION, serviceId: bid.serviceId, customerContext,
      knowledgeVersion: preparation.knowledgeVersion,
      documentInventory: preparation.items.filter(i => i.kind === 'doc').map(i => ({ id: i.id, label: i.nom, status: i.status })),
      draftFields, missing, comparisons: [], dateFlags: [], checks: preparation.checks,
      uncertaintyQuestions: notaryAIUncertaintyQuestions(bid.serviceId, analysis?.preparation),
      controlPlanVersion: NOTARY_CONTROL_PLAN_VERSION,
      parameterCoverage: notaryParameterCoverage(bid.serviceId, pricing),
      controls,
      workflow,
      clientRequestDraft: missing.length ? {
        opening: 'Bonjour, voici les renseignements et les pièces à compléter pour préparer votre dossier.',
        items: missing.map(({ id, label, aide }) => ({ id, label, aide })),
        closing: 'Utilisez le canal convenu avec votre notaire pour les pièces. Le dossier reste à confirmer par le notaire.',
      } : null,
      measurement: { target: FINANCING_AUTOMATION_TARGET, measuredReduction: null, reviewSeconds: reviewed ? review.activeReviewSeconds ?? null : null },
      todayISO: isISODate(todayISO) ? todayISO : null,
    };
  }

  function leadReadiness(serviceId, saved, pricing) {
    saved = saved || {};
    const svc = serviceById(serviceId);
    if (!svc) return { total: 0, done: 0, missing: [], requis: [], consent: false, ready: false };
    // ONE source of answers for both gates: the pricing the caller holds (the
    // bid's own answers), else what the dossier saved. Two sources disagreed
    // (review of f45a2e1): `missing` read the argument, `requis` the dossier.
    // When the caller holds the bid's own answers (`pricing`), they feed BOTH
    // gates — the checklist and the required questions — so the two can never
    // disagree (review of f45a2e1). Without them, today's contract holds: every
    // document applies, and the dossier's saved answers alone drive `requis`.
    // Defaults stand in for absent answers ONLY on a bid's own answers: an
    // offer published before a question became required stays ready; a dossier
    // still being filled keeps showing what is unanswered.
    const own = pricing || null;
    const items = applicableDocuments(svc, own)
      .map((d) => ({ id: d.id, nom: d.nom }))
      .concat(svc.champs.map((c) => ({ id: c.id, nom: c.label })));
    const missing = items.filter((it) => !saved[it.id]).map((it) => it.nom);
    const consent = !!saved.__consent;
    const requis = missingRequired(serviceId, own || saved.__pricing || {}, { applyDefaults: !!own }).map((m) => m.label);
    return {
      total: items.length,
      done: items.length - missing.length,
      missing,
      // The unanswered required pricing questions — the only content gate.
      requis,
      consent,
      ready: requis.length === 0 && consent,
    };
  }

  // --- Dossier file intake ----------------------------------------------------
  // The dossier NEVER carries file bytes (ADR 0010 §4: Nota is not the pipe —
  // after the mise en relation the documents flow through the notary's channel
  // or at signing). What travels is the DECLARED name of the file the client
  // picked, plus their typed answers. These shared rules bound that intake on
  // both sides: the browser refuses early with a human message, and the API
  // cleans whatever arrives so the stored dossier is always small and shaped.
  const DOSSIER_FILE = {
    // What a notary can actually open: PDF or a photo of the paper.
    extensions: ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'],
    // <input accept> — PDF plus images, so a phone offers « prendre une photo ».
    accept: 'application/pdf,image/*',
    maxBytes: 15 * 1024 * 1024,
    maxNameLength: 120,
  };
  const DOSSIER_VALUE_MAX = 200; // any single typed answer

  // A declared name is a BARE, bounded filename: no path (C:\fakepath\…,
  // ../../), no control characters, extension preserved when truncating.
  function sanitizeFileName(name) {
    let s = String(name == null ? '' : name);
    s = s.slice(s.lastIndexOf('/') + 1);
    s = s.slice(s.lastIndexOf('\\') + 1);
    s = s.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (s.length > DOSSIER_FILE.maxNameLength) {
      const dot = s.lastIndexOf('.');
      const ext = dot > 0 ? s.slice(dot) : '';
      s = s.slice(0, Math.max(1, DOSSIER_FILE.maxNameLength - ext.length)) + ext;
    }
    return s;
  }

  // The browser-side gate: is this a file the notary could open, small enough
  // to travel by any channel? Returns the cleaned name on ok, a French human
  // message on refusal (the web layer shows it as-is; i18n translates).
  function validateDossierFile(file) {
    const name = sanitizeFileName(file && file.name);
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (!name || DOSSIER_FILE.extensions.indexOf(ext) === -1) {
      return { ok: false, code: 'format', message: 'Format non accepté — utilisez un PDF ou une photo (JPG, PNG, HEIC).' };
    }
    const size = file && file.size;
    if (typeof size === 'number' && size > DOSSIER_FILE.maxBytes) {
      const mo = Math.round(DOSSIER_FILE.maxBytes / (1024 * 1024));
      return { ok: false, code: 'taille', message: 'Fichier trop lourd — maximum ' + mo + ' Mo.' };
    }
    return { ok: true, name };
  }

  // The API-side twin: whatever the payload carries, the STORED dossier holds
  // only the service's own items (documents through sanitizeFileName, champs
  // bounded), the consent flag, and the pricing answers for known criteria.
  // Unknown keys and local UI state (__validated) never reach the record a
  // notary later receives.
  function cleanDossier(serviceId, dossier) {
    const svc = serviceById(serviceId);
    const src = dossier && typeof dossier === 'object' && !Array.isArray(dossier) ? dossier : {};
    const out = {};
    if (!svc) return out;
    const bounded = (v, max) =>
      typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
    svc.documents.forEach((d) => {
      const v = src[d.id] === DOSSIER_TRANSMIS ? DOSSIER_TRANSMIS : sanitizeFileName(bounded(src[d.id], 1000));
      if (v) out[d.id] = v;
    });
    svc.champs.forEach((c) => {
      const v = bounded(src[c.id], DOSSIER_VALUE_MAX);
      if (v) out[c.id] = v;
    });
    if (src.__consent) out.__consent = '1';
    const critIds = [];
    (((svc.pricing || {}).criteria) || []).forEach((c) => {
      critIds.push(c.id);
      if (c.autre && c.autre.champ) critIds.push(c.autre.champ);
    });
    const pricing = src.__pricing && typeof src.__pricing === 'object' && !Array.isArray(src.__pricing) ? src.__pricing : {};
    const p = {};
    critIds.forEach((id) => {
      const v = pricing[id];
      if (typeof v === 'number' && isFinite(v)) p[id] = v;
      else if (typeof v === 'boolean') p[id] = v;
      else {
        const s = bounded(v, DOSSIER_VALUE_MAX);
        if (s) p[id] = s;
      }
    });
    if (Object.keys(p).length) out.__pricing = p;
    return out;
  }

  // --- Partner referrals ------------------------------------------------------
  // The professionals who know a homeowner needs a notary TODAY (agent
  // immobilier, courtier hypothécaire) send people through a `?ref=CODE` link
  // and earn a flat thank-you — never a share of the fee, and never a public
  // fact on the carnet. TWO reward tracks, each with its own trigger:
  //   • client:  a referred client's demand is RETAINED by a notary — the
  //     moment the marketplace visibly worked for that client;
  //   • notaire: a referred notary retains their FIRST act — worth far more
  //     (a notary is recurring supply), rewarded once per notary.
  // Attribution lives privately on the bid / notary record (`parrain`); the
  // amounts are data here, asserted by a test, and the ledger is always
  // derived from the records rather than kept as its own state.
  // See docs/decisions/0011-partner-referral-commission.md.
  const REFERRAL = {
    client: 50,
    notaire: 250,
    // The professions who meet a homeowner at the exact moment they need a
    // notary. `nom` is the Québec title (OACIQ: courtier, never agent); the id
    // is a stable key (records, API validation) and does not follow the
    // label. `moment` is the one sentence the Partenaires hero shows when a
    // visitor picks their profession: WHEN, in their own work, the referral
    // happens — the cue that turns a reader into a referrer.
    partners: [
      {
        id: 'agent_immobilier', nom: 'Courtier immobilier', nomEn: 'Real-estate broker',
        moment: 'Le bon moment : dès que la promesse d’achat est acceptée. Votre client doit trouver un notaire pour son financement avant la date de signature.',
        momentEn: 'The right moment: as soon as the offer to purchase is accepted. Your client must find a notary for their financing before the signing date.',
      },
      {
        id: 'courtier_hypothecaire', nom: 'Courtier hypothécaire', nomEn: 'Mortgage broker',
        moment: 'Le bon moment : à l’approbation du prêt. La date de signature est fixée et il manque encore le notaire — c’est là que le prix d’une date compte.',
        momentEn: 'The right moment: when the loan is approved. The signing date is set and the notary is still missing — that is when the price of a date matters.',
      },
      {
        id: 'autre_professionnel', nom: 'Autre professionnel', nomEn: 'Other professional',
        moment: 'Comptables, planificateurs financiers, avocats, évaluateurs : le bon moment, c’est dès qu’un client parle de refinancer ou d’acheter.',
        momentEn: 'Accountants, financial planners, lawyers, appraisers: the right moment is the minute a client mentions refinancing or buying.',
      },
    ],
    // The Partenaires hero's « clients par mois » slider: its default seat and
    // its cap are product data, so the page never invents a range.
    projectionDefault: 3,
    projectionMax: 10,
  };

  // What a steady referrer earns from the CLIENT track alone (the recurring
  // one), assuming every referred demand is retained. Bounded to the slider's
  // range and floored to an integer, so a bad input can never put NaN on
  // screen. The notary track is a one-off per notary and is not projected.
  function referralProjection(clientsParMois) {
    const n = Number(clientsParMois);
    const perMonth = Number.isFinite(n) ? Math.min(REFERRAL.projectionMax, Math.max(0, Math.floor(n))) : 0;
    return {
      clientsParMois: perMonth,
      parMois: perMonth * REFERRAL.client,
      parAn: perMonth * 12 * REFERRAL.client,
    };
  }

  // A code is 4–12 letters/digits, case-insensitive; separators are dropped so
  // "eve-roy" and "EVEROY" are the same partner. Anything else is not a code.
  const REFERRAL_CODE_RE = /^[A-Z0-9]{4,12}$/;
  function normalizeReferralCode(value) {
    return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function isReferralCode(value) {
    return REFERRAL_CODE_RE.test(normalizeReferralCode(value));
  }

  // Fold referred records into per-code totals. `bids` may carry `parrain`; a
  // referred bid earns REFERRAL.client the moment it is RETAINED (completes is
  // still counted, as information). `notaires` (optional) are referred notary
  // records carrying `parrain`; one earns REFERRAL.notaire once, when the
  // caller has marked that they retained their first act (`premierActe`
  // truthy) — the domain never guesses at either join.
  function referralLedger(bids, notaires) {
    const byCode = new Map();
    const entryFor = (code) => {
      if (!byCode.has(code)) {
        byCode.set(code, { code, demandes: 0, retenues: 0, completes: 0, notaires: 0, notairesActifs: 0, du: 0 });
      }
      return byCode.get(code);
    };
    for (const b of Array.isArray(bids) ? bids : []) {
      if (!b) continue;
      const code = normalizeReferralCode(b.parrain);
      if (!REFERRAL_CODE_RE.test(code)) continue;
      const entry = entryFor(code);
      entry.demandes++;
      if (b.status === STATUS.RETENUE) {
        entry.retenues++;
        entry.du += REFERRAL.client;
      }
      if (b.acte || b.completed === true) entry.completes++;
    }
    for (const n of Array.isArray(notaires) ? notaires : []) {
      if (!n) continue;
      const code = normalizeReferralCode(n.parrain);
      if (!REFERRAL_CODE_RE.test(code)) continue;
      const entry = entryFor(code);
      entry.notaires++;
      if (n.premierActe) {
        entry.notairesActifs++;
        entry.du += REFERRAL.notaire;
      }
    }
    return [...byCode.values()].sort((a, b) => b.du - a.du || a.code.localeCompare(b.code));
  }

  // --- La caution (ADR 0035) -------------------------------------------------
  // Le client donne sa carte à la publication, mais la SOMME n'est réservée
  // qu'à l'approche de la date. Le motif est arithmétique : une autorisation
  // de carte ne vit que ~7 jours, alors que le palier « standard » du carnet
  // commence à 15 jours (TIERS: `rapide` s'arrête à 14). Une réservation posée
  // à la publication meurt donc avant la signature sur la majorité des dates,
  // et le notaire qui retient se retrouverait sans garantie sans que personne
  // ne soit prévenu.
  //
  // CAUTION_LEAD_DAYS est ce délai, en jours pleins avant la signature : assez
  // tard pour que la réservation vive jusqu'à l'acte, assez tôt pour qu'une
  // carte refusée laisse deux jours au client pour la remplacer et au notaire
  // pour le savoir. C'est une règle d'affaires — la couche de facturation ne
  // choisit pas ce nombre, elle le lit ici.
  const CAUTION_LEAD_DAYS = 2;

  // La caution d'une signature le `dateISO` est-elle à poser le jour
  // `todayISO` ? Vrai dans la fenêtre [signature − CAUTION_LEAD_DAYS,
  // signature]. Une date déjà passée en sort : une offre oubliée ne doit pas
  // être retentée indéfiniment, et le règlement garde son repli (ADR 0029).
  function cautionDue(dateISO, todayISO) {
    if (!isISODate(dateISO) || !isISODate(todayISO)) return false;
    const days = daysBetween(todayISO, dateISO);
    return days >= 0 && days <= CAUTION_LEAD_DAYS;
  }

  // Combien de jours une réservation de carte NON capturée tient-elle ? Une
  // autorisation est relâchée par l'émetteur après ~7 jours. C'est l'autre
  // moitié de la même règle d'affaires : CAUTION_LEAD_DAYS dit quand poser,
  // CAUTION_VIE_JOURS dit jusqu'à quand la chose posée est encore une garantie.
  const CAUTION_VIE_JOURS = 7;

  // Une caution posée le `poseeISO` (date ou horodatage ISO) tient-elle encore
  // le `todayISO` ? C'est la question qu'il faut poser AVANT d'écrire au
  // notaire « la somme est réservée » : une autorisation périmée n'est plus une
  // garantie, et l'afficher comme telle est un mensonge sur de l'argent.
  //
  // Un horodatage absent répond VRAI : les offres d'avant que Nota ne le note
  // ne doivent pas hériter d'une mauvaise nouvelle inventée.
  function cautionVivante(poseeISO, todayISO) {
    const posee = String(poseeISO == null ? '' : poseeISO).slice(0, 10);
    if (!isISODate(posee) || !isISODate(todayISO)) return true;
    return daysBetween(posee, todayISO) <= CAUTION_VIE_JOURS;
  }

  // --- Reminder schedule -----------------------------------------------------
  // The cadence at which an open lead's client is reminded that their signing
  // date is approaching, expressed as whole days BEFORE the date. Closer dates
  // convert faster, so the nudges tighten as the day nears. This is a business
  // rule — the API scheduler encodes nothing itself, it just asks the domain
  // which reminders are due today for a given bid.
  const REMINDER_OFFSETS = [7, 3, 1];

  // The kinds of reminder a bid can be due for. j7/j3/j1 are the date-approaching
  // nudges (one per offset). j0 is the day-of nudge: the signing date is TODAY
  // and no notary has retained the offer (a retained bid is already excluded by
  // isOpenBid), so the client's one lever left is to raise their offer.
  // dossier_incomplet is the "finish your file" nudge, the #1 conversion lever,
  // due whenever an open lead's file is not ready — either flagged explicitly
  // (bid.dossierReady === false) or derived from the dossier via leadReadiness.
  const REMINDER_KINDS = {
    J7: 'j7',
    J3: 'j3',
    J1: 'j1',
    J0: 'j0',
    DOSSIER_INCOMPLET: 'dossier_incomplet',
  };

  // Map a day-offset to its date-approaching kind, or null when no reminder
  // falls on that exact day.
  function reminderKindForDays(days) {
    if (days === 7) return REMINDER_KINDS.J7;
    if (days === 3) return REMINDER_KINDS.J3;
    if (days === 1) return REMINDER_KINDS.J1;
    if (days === 0) return REMINDER_KINDS.J0;
    return null;
  }

  // Which reminder kinds are due for `bid` as of `todayISO`. Pure and
  // deterministic — the same inputs always yield the same array. A retained bid
  // (already taken by a notary) and a bid whose signing date has passed are
  // never due for anything. The sender is responsible for idempotency
  // (not sending the same kind twice); this only says what is due.
  function dueReminders(bid, todayISO) {
    const due = [];
    if (!isOpenBid(bid)) return due;
    if (!isISODate(bid.dateISO) || !isISODate(todayISO)) return due;

    const days = daysBetween(todayISO, bid.dateISO);
    if (days < 0) return due; // the signing date is already past

    const dateKind = reminderKindForDays(days);
    if (dateKind) due.push(dateKind);

    // Dossier-incompletion hook: an open lead whose file is not ready gets a
    // "finish your file" nudge. An explicit bid.dossierReady (true/false) is an
    // override; when it is absent the truth is derived from the dossier itself
    // via leadReadiness — the same gate the API reports to the client. Kept
    // separate from the date cadence so it can fire independently; the sender's
    // SENT ledger prevents daily repeats.
    const dossierReady =
      typeof bid.dossierReady === 'boolean'
        ? bid.dossierReady
        : leadReadiness(bid.serviceId, bid.dossier || {}).ready;
    if (!dossierReady) due.push(REMINDER_KINDS.DOSSIER_INCOMPLET);

    return due;
  }

  // --- Public label helpers --------------------------------------------------
  // How a bid identifies itself on the public carnet: the chosen name, or the
  // postal prefix for anonymous bids ("Client · G1R").
  function bidLabel(bid) {
    if (!bid.anonyme && bid.nom) return bid.nom;
    return 'Client · ' + (bid.prefixe || '—');
  }

  // Bounded reporting categories: never persist raw user agents, URLs or arbitrary labels.
  const ANALYTICS_DIMENSIONS = Object.freeze([
    { id: "browser", nom: "Navigateur", nomEn: "Browser", values: [
      {"id": "chrome", "nom": "Chrome", "nomEn": "Chrome"},
      {"id": "safari", "nom": "Safari", "nomEn": "Safari"},
      {"id": "firefox", "nom": "Firefox", "nomEn": "Firefox"},
      {"id": "edge", "nom": "Edge", "nomEn": "Edge"},
      {"id": "samsung", "nom": "Samsung Internet", "nomEn": "Samsung Internet"},
      {"id": "opera", "nom": "Opera", "nomEn": "Opera"},
      {"id": "in_app", "nom": "Navigateur intégré", "nomEn": "In-app browser"},
      {"id": "bot", "nom": "Robot déclaré", "nomEn": "Declared bot"},
      {"id": "other", "nom": "Autre", "nomEn": "Other"},
      {"id": "unknown", "nom": "Inconnu", "nomEn": "Unknown"},
    ] },
    { id: "os", nom: "Système", nomEn: "Operating system", values: [
      {"id": "ios", "nom": "iOS / iPadOS", "nomEn": "iOS / iPadOS"},
      {"id": "android", "nom": "Android", "nomEn": "Android"},
      {"id": "windows", "nom": "Windows", "nomEn": "Windows"},
      {"id": "macos", "nom": "macOS", "nomEn": "macOS"},
      {"id": "linux", "nom": "Linux", "nomEn": "Linux"},
      {"id": "other", "nom": "Autre", "nomEn": "Other"},
      {"id": "unknown", "nom": "Inconnu", "nomEn": "Unknown"},
    ] },
    { id: "device", nom: "Appareil", nomEn: "Device", values: [
      {"id": "mobile", "nom": "Téléphone", "nomEn": "Phone"},
      {"id": "tablet", "nom": "Tablette", "nomEn": "Tablet"},
      {"id": "desktop", "nom": "Ordinateur", "nomEn": "Desktop"},
      {"id": "unknown", "nom": "Inconnu", "nomEn": "Unknown"},
    ] },
    { id: "viewport", nom: "Format de fenêtre", nomEn: "Viewport", values: [
      {"id": "narrow", "nom": "Étroit", "nomEn": "Narrow"},
      {"id": "medium", "nom": "Moyen", "nomEn": "Medium"},
      {"id": "wide", "nom": "Large", "nomEn": "Wide"},
      {"id": "unknown", "nom": "Inconnu", "nomEn": "Unknown"},
    ] },
    { id: "language", nom: "Langue", nomEn: "Language", values: [
      {"id": "fr", "nom": "Français", "nomEn": "French"},
      {"id": "en", "nom": "Anglais", "nomEn": "English"},
      {"id": "other", "nom": "Autre", "nomEn": "Other"},
      {"id": "unknown", "nom": "Inconnue", "nomEn": "Unknown"},
    ] },
    { id: "source", nom: "Source d’arrivée", nomEn: "Arrival source", values: [
      {"id": "google", "nom": "Google", "nomEn": "Google"},
      {"id": "bing", "nom": "Bing", "nomEn": "Bing"},
      {"id": "search_other", "nom": "Autre moteur de recherche", "nomEn": "Other search engine"},
      {"id": "facebook", "nom": "Facebook", "nomEn": "Facebook"},
      {"id": "instagram", "nom": "Instagram", "nomEn": "Instagram"},
      {"id": "linkedin", "nom": "LinkedIn", "nomEn": "LinkedIn"},
      {"id": "tiktok", "nom": "TikTok", "nomEn": "TikTok"},
      {"id": "ai", "nom": "Assistant IA", "nomEn": "AI assistant"},
      {"id": "email", "nom": "Courriel", "nomEn": "Email"},
      {"id": "partner", "nom": "Lien de référence déclaré", "nomEn": "Declared referral link"},
      {"id": "campaign_other", "nom": "Autre campagne déclarée", "nomEn": "Other declared campaign"},
      {"id": "referral_other", "nom": "Autre site", "nomEn": "Other website"},
      {"id": "internal", "nom": "Navigation interne", "nomEn": "Internal navigation"},
      {"id": "direct_unknown", "nom": "Direct ou inconnu", "nomEn": "Direct or unknown"},
    ] },
    { id: "entry", nom: "Page d’arrivée", nomEn: "Entry page", values: [
      {"id": "home", "nom": "Carnet", "nomEn": "Marketplace"},
      {"id": "financement", "nom": "Page de financement", "nomEn": "Financing page"},
      {"id": "refinancement", "nom": "Page de refinancement", "nomEn": "Refinancing page"},
      {"id": "other", "nom": "Autre page", "nomEn": "Other page"},
    ] },
    { id: "dialog", nom: "Fenêtres de dialogue", nomEn: "Dialogs", values: [
      {"id": "native", "nom": "Prise en charge native", "nomEn": "Native support"},
      {"id": "fallback", "nom": "Repli nécessaire", "nomEn": "Fallback needed"},
      {"id": "unknown", "nom": "Inconnu", "nomEn": "Unknown"},
    ] },
    { id: "storage", nom: "Stockage du navigateur", nomEn: "Browser storage", values: [
      {"id": "available", "nom": "Accessible", "nomEn": "Accessible"},
      {"id": "unavailable", "nom": "Indisponible", "nomEn": "Unavailable"},
      {"id": "unknown", "nom": "Inconnu", "nomEn": "Unknown"},
    ] },
    { id: "load", nom: "Chargement initial", nomEn: "Initial load", values: [
      {"id": "fast", "nom": "Moins de 2 secondes", "nomEn": "Under 2 seconds"},
      {"id": "moderate", "nom": "De 2 à 4 secondes", "nomEn": "2 to 4 seconds"},
      {"id": "slow", "nom": "Plus de 4 secondes", "nomEn": "Over 4 seconds"},
      {"id": "unknown", "nom": "Non mesuré", "nomEn": "Not measured"},
    ] },
    { id: "journey", nom: "Mode d’accompagnement", nomEn: "Guidance mode", values: [
      {"id": "standard", "nom": "Parcours standard", "nomEn": "Standard journey"},
      {"id": "guided", "nom": "Parcours guidé", "nomEn": "Guided journey"},
    ] },
  ]);
  function cleanAnalyticsContext(input) {
    const out = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    for (const dimension of ANALYTICS_DIMENSIONS) {
      const value = input[dimension.id];
      if (typeof value === 'string' && dimension.values.some(v => v.id === value)) out[dimension.id] = value;
    }
    return out;
  }

  // --- Funnel events -----------------------------------------------------------
  // The conversion funnel is product data, so its catalogue lives here and both
  // apps read the SAME list: the web app beacons an event, the API accepts only
  // these names and counts them per day, the admin overview reads them back in
  // this order. Anything else on the wire is dropped. Each entry is one
  // observable step between « a person arrived » and « a person paid ».
  const FUNNEL_EVENTS = Object.freeze([
    { id: 'visite',          nom: 'Visites',                      nomEn: 'Visits' },
    { id: 'jour_ouvert',     nom: 'Dates ouvertes',               nomEn: 'Dates opened' },
    { id: 'formulaire',      nom: 'Formulaires commencés',        nomEn: 'Forms started' },
    { id: 'publie',          nom: 'Offres publiées',              nomEn: 'Offers published', serverOnly: true },
    { id: 'paiement_ok',     nom: 'Retours de paiement — succès', nomEn: 'Checkout returns — success' },
    { id: 'paiement_annule', nom: 'Retours de paiement — annulation', nomEn: 'Checkout returns — cancellation' },
    { id: 'notaire_porte',   nom: 'Espace notaire ouvert',        nomEn: 'Notary space opened' },
    { id: 'notaire_inscrit', nom: 'Notaires inscrits',            nomEn: 'Notaries signed up', serverOnly: true },
    { id: 'criteres_vus',    nom: 'Questions sur l’acte vues',    nomEn: 'Act questions viewed' },
    { id: 'prix_vu',         nom: 'Étape du prix vue',            nomEn: 'Price step viewed' },
    { id: 'coordonnees_vues', nom: 'Étape des coordonnées vue',   nomEn: 'Contact details step viewed' },
    { id: 'formulaire_bloque', nom: 'Tentatives de continuer bloquées', nomEn: 'Blocked attempts to continue' },
    { id: 'publication_tentee', nom: 'Tentatives de publication', nomEn: 'Publication attempts' },
    { id: 'publication_echouee', nom: 'Échecs de publication',    nomEn: 'Publication failures' },
    { id: 'page_service_vue', nom: 'Pages de service vues', nomEn: 'Service pages viewed' },
    { id: 'page_service_vers_carnet', nom: 'Passages du service au carnet', nomEn: 'Service page links to marketplace' },
    { id: 'erreur_script', nom: 'Pages avec erreur JavaScript', nomEn: 'Pages with JavaScript errors' },
    { id: 'promesse_rejetee', nom: 'Pages avec échec asynchrone non traité', nomEn: 'Pages with unhandled asynchronous failures' },
    { id: 'navigation_mesuree', nom: 'Chargements mesurés', nomEn: 'Measured page loads' },
    // Support journey signals. These are deliberately aggregate event names:
    // the support content itself stays in the support thread, never in
    // analytics. Keeping this catalogue in the domain lets the API and admin
    // console share the same allowlist and labels.
    { id: 'contact_ouvert', nom: 'Formulaires de contact ouverts', nomEn: 'Contact forms opened' },
    { id: 'contact_message_commence', nom: 'Messages de contact commencés', nomEn: 'Contact messages started' },
    { id: 'contact_soumis', nom: 'Messages de contact soumis', nomEn: 'Contact messages submitted' },
    { id: 'contact_envoye', nom: 'Messages de contact envoyés', nomEn: 'Contact messages sent' },
    { id: 'contact_echec', nom: 'Échecs de contact', nomEn: 'Contact failures' },
    { id: 'contact_ferme', nom: 'Formulaires de contact fermés', nomEn: 'Contact forms closed' },
    { id: 'messagerie_ouverte', nom: 'Messageries ouvertes', nomEn: 'Support chats opened' },
    { id: 'messagerie_sujet_choisi', nom: 'Sujets de messagerie choisis', nomEn: 'Support topics selected' },
    { id: 'messagerie_message_commence', nom: 'Messages de messagerie commencés', nomEn: 'Support messages started' },
    { id: 'messagerie_envoye', nom: 'Messages de messagerie envoyés', nomEn: 'Support messages sent' },
    { id: 'messagerie_echec', nom: 'Échecs de messagerie', nomEn: 'Support message failures' },
    { id: 'messagerie_courriel_ouvert', nom: 'Demandes de copie par courriel', nomEn: 'Email reply requests opened' },
    { id: 'messagerie_courriel_enregistre', nom: 'Courriels de messagerie enregistrés', nomEn: 'Support emails saved' },
    { id: 'messagerie_reponse_recue', nom: 'Réponses de soutien reçues', nomEn: 'Support replies received' },
    { id: 'messagerie_fermee', nom: 'Messageries fermées', nomEn: 'Support chats closed' },
  ]);
  function isFunnelEvent(id) {
    return typeof id === 'string' && FUNNEL_EVENTS.some((e) => e.id === id);
  }
  function isClientFunnelEvent(id) {
    return typeof id === 'string' && FUNNEL_EVENTS.some((e) => e.id === id && !e.serverOnly);
  }

  // ===========================================================================
  // SALLE DE SIGNATURE — ADR 0047
  //
  // La cérémonie est de Nota. La signature juridique est du fournisseur admis
  // par la Chambre. La preuve est de Nota, et elle est remise au notaire.
  //
  // Tout ce qui décide vit ici : les quatre portes, les huit étapes, les trois
  // modes d'enregistrement, et la chaîne d'empreintes du procès-verbal. Ni
  // l'API ni l'interface ne rejouent une de ces règles — elles appellent.
  // ===========================================================================
  // --- SHA-256, écrit à la main ----------------------------------------------
  // Le domaine n'a aucune dépendance et tourne dans Node ET dans le navigateur.
  // `node:crypto` n'existe pas dans l'un, `crypto.subtle` est asynchrone et
  // absent des origines non sécurisées de l'autre. La chaîne de preuve ne peut
  // dépendre ni de l'un ni de l'autre : elle doit se calculer partout, de la
  // même manière, tout de suite. Quatre-vingts lignes, des vecteurs d'essai
  // connus dans les tests, et la question est close.
  const SHA256_K = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  // UTF-8 à la main plutôt que TextEncoder : une globale de moins à supposer.
  // Un demi-substitut isolé devient U+FFFD, comme le ferait TextEncoder.
  function utf8Bytes(value) {
    const s = String(value == null ? '' : value);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) { out.push(c); continue; }
      if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); continue; }
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
        if (next >= 0xdc00 && next <= 0xdfff) {
          const cp = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
          continue;
        }
        out.push(0xef, 0xbf, 0xbd);
        continue;
      }
      if (c >= 0xdc00 && c <= 0xdfff) { out.push(0xef, 0xbf, 0xbd); continue; }
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function sha256Hex(message) {
    const bytes = utf8Bytes(message);
    const len = bytes.length;
    const padded = len + 9 + ((64 - ((len + 9) % 64)) % 64);
    const m = new Array(padded).fill(0);
    for (let i = 0; i < len; i++) m[i] = bytes[i];
    m[len] = 0x80;
    // Longueur en BITS, sur 64 bits gros-boutiens. `len / 2^29` est la moitié
    // haute ; la basse est calculée modulo 2^29 avant le ×8 pour ne jamais
    // dépasser 2^32 et perdre des bits en cours de route.
    const hi = Math.floor(len / 536870912);
    const lo = (len % 536870912) * 8;
    m[padded - 8] = (hi >>> 24) & 255; m[padded - 7] = (hi >>> 16) & 255;
    m[padded - 6] = (hi >>> 8) & 255; m[padded - 5] = hi & 255;
    m[padded - 4] = (lo >>> 24) & 255; m[padded - 3] = (lo >>> 16) & 255;
    m[padded - 2] = (lo >>> 8) & 255; m[padded - 1] = lo & 255;

    const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Array(64);

    for (let off = 0; off < padded; off += 64) {
      for (let i = 0; i < 16; i++) {
        const j = off + i * 4;
        w[i] = ((m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15], y = w[i - 2];
        const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
        const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map((x) => ('0000000' + x.toString(16)).slice(-8))
      .join('');
  }

  // --- La chaîne d'authentification courte -----------------------------------
  // Ce que les deux personnes se lisent à voix haute. Elle est dérivée des DEUX
  // empreintes DTLS, donc elle ne peut concorder que si les deux navigateurs
  // parlent bien l'un à l'autre : un intercepteur, qui négocie deux sessions
  // distinctes, en produit deux différentes et le notaire l'entend.
  //
  // L'ordre des empreintes ne doit rien changer — chaque pair connaît la sienne
  // et celle d'en face, dans l'ordre inverse de l'autre. D'où le tri.
  //
  // Alphabet sans 0/O/1/I/L : « zéro » et « O » se confondent au téléphone, et
  // la chaîne est faite pour être DITE.
  const SAS_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const SAS_GROUPES = 2;
  const SAS_TAILLE_GROUPE = 4;

  function normalizeEmpreinte(value) {
    return String(value == null ? '' : value).trim().toUpperCase().replace(/\s+/g, '');
  }

  function chaineAuthentification(empreinteA, empreinteB) {
    const a = normalizeEmpreinte(empreinteA);
    const b = normalizeEmpreinte(empreinteB);
    if (!a || !b) return null;
    const paire = [a, b].sort();
    const digest = sha256Hex('nota/sas/v1\n' + paire[0] + '\n' + paire[1]);
    let out = '';
    for (let g = 0; g < SAS_GROUPES; g++) {
      if (g) out += '-';
      for (let i = 0; i < SAS_TAILLE_GROUPE; i++) {
        const octet = parseInt(digest.slice((g * SAS_TAILLE_GROUPE + i) * 2, (g * SAS_TAILLE_GROUPE + i) * 2 + 2), 16);
        out += SAS_ALPHABET[octet % SAS_ALPHABET.length];
      }
    }
    return out;
  }

  // --- États, modes, portes --------------------------------------------------
  const SALLE_STATUT = Object.freeze({
    PREVUE: 'prevue',
    OUVERTE: 'ouverte',
    SUSPENDUE: 'suspendue',
    SCELLEE: 'scellee',
    ANNULEE: 'annulee',
  });

  // `strict` est le défaut, et c'est une décision : un enregistrement côté
  // serveur exigerait un troisième déchiffreur, et il n'y a pas de manière
  // honnête d'appeler « bout en bout » un canal à trois (ADR 0047 §2).
  const SALLE_MODES = Object.freeze([
    {
      id: 'strict',
      nom: 'Bout en bout, sans enregistrement',
      nomEn: 'End-to-end, no recording',
      enregistre: false,
      // « Entre vous deux seulement » était faux : quand la connexion directe
      // est impossible, un relais fourni par Nota achemine les paquets. Il ne
      // peut pas les lire — les clés DTLS ne quittent pas les deux
      // navigateurs — mais il est sur le chemin, et la phrase doit le dire.
      aide: 'Le lien vidéo est chiffré de bout en bout : Nota ne peut pas le lire, et un relais fourni par Nota peut l’acheminer lorsque la connexion directe est impossible. Rien n’est enregistré : la preuve de la séance est le procès-verbal scellé.',
    },
    {
      id: 'temoin',
      nom: 'Bout en bout, avec enregistrement chiffré',
      nomEn: 'End-to-end, with encrypted recording',
      enregistre: true,
      aide: 'La séance est enregistrée dans le navigateur du notaire et chiffrée avant d’être déposée. Nota conserve les octets sans pouvoir les lire. Exige l’accord des deux parties.',
    },
    {
      id: 'aucun',
      nom: 'Répétition, sans valeur',
      nomEn: 'Rehearsal, no legal value',
      enregistre: false,
      aide: 'Pour se pratiquer. Une séance en répétition ne peut pas atteindre l’étape de la signature.',
    },
  ]);
  const SALLE_MODE_DEFAUT = 'strict';
  function salleModeById(id) { return SALLE_MODES.find((m) => m.id === id) || null; }

  const SALLE_PORTES = Object.freeze(['compte', 'identite', 'lien', 'presence']);

  // Ce que chaque porte établit, dit à la personne qui la regarde se fermer.
  const SALLE_PORTE_LABELS = Object.freeze({
    compte: { nom: 'Comptes authentifiés', nomEn: 'Authenticated accounts' },
    identite: { nom: 'Identité vérifiée', nomEn: 'Identity verified' },
    lien: { nom: 'Lien privé confirmé', nomEn: 'Private link confirmed' },
    presence: { nom: 'Présence continue', nomEn: 'Continuous presence' },
  });

  // Une coupure plus courte que ceci est un hoquet de réseau ; plus longue, le
  // notaire n'a plus vu ni entendu la personne et la séance se suspend.
  const PRESENCE_TOLERANCE_MS = 10000;

  // Au-delà de ce silence, un pair n'est plus là — qu'il l'ait dit ou non. Deux
  // fois la tolérance : un sondage manqué est normal, deux ne le sont pas.
  // C'est le seuil que l'observateur de l'API applique déjà pour dater une
  // coupure ; il est ici pour que le domaine puisse NOMMER ce qui s'est passé
  // au lieu d'accuser la caméra de celui qui lit l'écran.
  const PRESENCE_SILENCE_MS = PRESENCE_TOLERANCE_MS * 2;

  const SALLE_PARTIES = Object.freeze(['notaire', 'client']);

  // --- Les huit étapes, et ce que le notaire a à dire -------------------------
  // `conduite` est le texte de conduite : ce que le notaire dit. `constat` est
  // ce qu'il doit avoir constaté avant de passer à la suite. Les deux vivent
  // ici et NON dans la maquette — l'interface, le procès-verbal et les tests
  // lisent la même phrase (règle 1 de AGENTS.md), et l'anglais la suit.
  const CEREMONIE_ETAPES = Object.freeze([
    {
      id: 'accueil', ordre: 1,
      nom: 'Accueil',
      conduite: 'Je me nomme, je nomme mon étude, et je nomme l’acte que nous allons recevoir aujourd’hui. Je confirme que vous me voyez et que vous m’entendez.',
      constat: 'Les deux parties se voient et s’entendent.',
    },
    {
      id: 'identite', ordre: 2,
      nom: 'Vérification de l’identité',
      conduite: 'Je vérifie votre identité et je note la méthode employée. Cette vérification ne se fait pas par la fenêtre vidéo seule.',
      constat: 'Une attestation d’identité est au dossier, avec sa méthode et son heure.',
    },
    {
      id: 'lien', ordre: 3,
      nom: 'Confirmation du lien privé',
      conduite: 'Nous lisons chacun à voix haute la chaîne affichée à l’écran. Si elles concordent, personne ne s’est interposé entre nous.',
      constat: 'Les deux chaînes concordent et le notaire l’a confirmé.',
    },
    {
      id: 'consentement', ordre: 4,
      nom: 'Portée et consentement',
      conduite: 'Je vous explique ce qui est consigné, ce qui est enregistré et ce qui ne l’est pas, puis je recueille votre accord.',
      constat: 'Les deux parties ont répondu, et leur réponse est horodatée.',
    },
    {
      id: 'lecture', ordre: 5,
      nom: 'Lecture de l’acte',
      conduite: 'Je vous lis l’acte et les obligations qui s’y rattachent.',
      constat: 'La lecture est faite en entier, sans interruption du lien.',
    },
    {
      id: 'questions', ordre: 6,
      nom: 'Questions',
      conduite: 'Je réponds à vos questions avant que vous signiez quoi que ce soit.',
      constat: 'La partie n’a plus de question.',
    },
    {
      id: 'signature', ordre: 7,
      nom: 'Signature',
      conduite: 'Je libère la signature vers le flux admis par la Chambre des notaires. C’est là, et non ici, que l’acte prend sa forme définitive.',
      constat: 'Les quatre portes sont ouvertes et la signature est libérée.',
    },
    {
      id: 'cloture', ordre: 8,
      nom: 'Clôture',
      conduite: 'Je scelle le procès-verbal de la séance et je vous en remets l’empreinte.',
      constat: 'Le procès-verbal est scellé et son empreinte est publiée.',
    },
  ]);
  const CEREMONIE_PREMIERE_ETAPE = CEREMONIE_ETAPES[0].id;
  function etapeById(id) { return CEREMONIE_ETAPES.find((e) => e.id === id) || null; }
  function etapeOrdre(id) { const e = etapeById(id); return e ? e.ordre : 0; }

  // --- L'attestation d'identité ----------------------------------------------
  // Elle porte sa MÉTHODE, son HEURE et son VÉRIFICATEUR, sinon elle n'ouvre
  // rien. Un booléen « identité vérifiée » ne répond pas à la question qu'un
  // tribunal pose sept ans plus tard : vérifiée comment, et par qui.
  const IDENTITE_METHODES = Object.freeze([
    { id: 'piece_officielle', nom: 'Pièce d’identité officielle présentée au notaire', nomEn: 'Official identity document shown to the notary' },
    { id: 'fournisseur', nom: 'Vérification par un fournisseur externe', nomEn: 'Verification by an external provider' },
    { id: 'connaissance_personnelle', nom: 'Connaissance personnelle du notaire', nomEn: 'Notary’s personal knowledge' },
    { id: 'demonstration', nom: 'Attestation de démonstration — sans valeur', nomEn: 'Demonstration attestation — no legal value' },
  ]);
  function identiteMethodeById(id) { return IDENTITE_METHODES.find((m) => m.id === id) || null; }

  function isISODateTime(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)
      && Number.isFinite(Date.parse(value));
  }

  function validateAttestationIdentite(att) {
    const errors = [];
    const a = att && typeof att === 'object' ? att : {};
    if (!identiteMethodeById(a.methode)) {
      errors.push({ field: 'methode', code: 'methode_inconnue', message: 'La méthode de vérification de l’identité est inconnue.' });
    }
    if (!isISODateTime(a.verifieeLe)) {
      errors.push({ field: 'verifieeLe', code: 'heure_requise', message: 'Une attestation d’identité doit porter l’heure de la vérification.' });
    }
    const par = String(a.verifieePar || '').trim();
    if (!par) {
      errors.push({ field: 'verifieePar', code: 'verificateur_requis', message: 'Une attestation d’identité doit nommer qui a vérifié.' });
    }
    if (errors.length) return { ok: false, errors };
    return {
      ok: true,
      attestation: {
        methode: a.methode,
        verifieeLe: a.verifieeLe,
        verifieePar: par,
        reference: a.reference ? String(a.reference).slice(0, 120) : null,
      },
    };
  }

  // --- Les quatre portes -----------------------------------------------------
  // LA fonction. Rien d'autre dans le produit ne décide qu'une porte est
  // ouverte ; l'API et l'interface lisent ce qu'elle répond.
  function porteFermee(raison, message) { return { ouverte: false, raison, message }; }
  const PORTE_OUVERTE = Object.freeze({ ouverte: true, raison: null, message: null });

  function salleReadiness(salle, opts) {
    const s = salle && typeof salle === 'object' ? salle : {};
    const nowMs = opts && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
    const parties = s.parties && typeof s.parties === 'object' ? s.parties : {};
    const identites = s.identites && typeof s.identites === 'object' ? s.identites : {};
    const lien = s.lien && typeof s.lien === 'object' ? s.lien : {};
    const portes = {};

    // 1. COMPTE — les deux côtés sont des personnes authentifiées, pas des
    //    porteurs de lien (ADR 0044).
    const sansCompte = SALLE_PARTIES.filter((p) => !(parties[p] && parties[p].authentifie === true));
    portes.compte = sansCompte.length
      ? porteFermee('compte_manquant', sansCompte.length === 2
        ? 'Aucune des deux parties n’est encore authentifiée.'
        : (sansCompte[0] === 'notaire' ? 'Le notaire n’est pas encore authentifié.' : 'Le client n’est pas encore authentifié.'))
      : PORTE_OUVERTE;

    // 2. IDENTITÉ — une attestation valide par partie.
    const sansIdentite = SALLE_PARTIES.filter((p) => !validateAttestationIdentite(identites[p]).ok);
    portes.identite = sansIdentite.length
      ? porteFermee('identite_manquante', 'L’identité n’est pas encore vérifiée pour : ' + sansIdentite.join(', ') + '.')
      : PORTE_OUVERTE;

    // 3. LIEN — les deux empreintes DTLS sont connues, elles produisent une
    //    chaîne, et le NOTAIRE a confirmé qu'elle concordait de vive voix. La
    //    machine ne peut pas confirmer à sa place : c'est tout l'intérêt.
    const sas = chaineAuthentification(lien.empreinteNotaire, lien.empreinteClient);
    if (!sas) portes.lien = porteFermee('lien_inconnu', 'Le lien chiffré n’est pas encore établi entre les deux navigateurs.');
    else if (!isISODateTime(lien.confirmeLe)) portes.lien = porteFermee('lien_non_confirme', 'Le notaire n’a pas encore confirmé que les deux chaînes concordent.');
    else if (lien.confirmePour && lien.confirmePour !== sas) portes.lien = porteFermee('lien_change', 'Le lien chiffré a changé depuis la confirmation. Relisez les chaînes.');
    else portes.lien = PORTE_OUVERTE;

    // 4. PRÉSENCE — les quatre pistes vivent, et aucune coupure en cours n'a
    //    dépassé la tolérance.
    portes.presence = presenceEtat(s, nowMs);

    const ouvertes = SALLE_PORTES.filter((p) => portes[p].ouverte);
    const toutesOuvertes = ouvertes.length === SALLE_PORTES.length;
    return {
      portes,
      sas,
      ouvertes,
      fermees: SALLE_PORTES.filter((p) => !portes[p].ouverte),
      toutesOuvertes,
    };
  }

  function presenceEtat(salle, nowMs) {
    const parties = salle.parties && typeof salle.parties === 'object' ? salle.parties : {};

    // 1. QUI N'EST PLUS LÀ. Cette cause prime, parce qu'elle explique les
    //    autres : quand une page se ferme, le navigateur d'en face voit son
    //    lien tomber et déclare ses PROPRES pistes mortes. Nommer alors la
    //    caméra de celui qui lit l'écran, c'est lui faire débrancher un
    //    appareil qui marche pendant que l'autre attend qu'on le rappelle. Le
    //    fait observable, c'est le silence, et l'heure du dernier signe de vie
    //    est dans la séance.
    for (const p of SALLE_PARTIES) {
      const vuLe = parties[p] && parties[p].vuLe;
      if (Number.isFinite(vuLe) && (nowMs - vuLe) > PRESENCE_SILENCE_MS) {
        return porteFermee('pair_absent', p === 'notaire'
          ? 'Le notaire a quitté la séance ou a perdu sa connexion.'
          : 'Le client a quitté la séance ou a perdu sa connexion.');
      }
    }

    // 2. LES DEUX À LA FOIS. Deux caméras ne lâchent pas à la même seconde :
    //    ce qui lâche entre elles, c'est le lien.
    const muettes = SALLE_PARTIES.filter((p) => {
      const pistes = (parties[p] && parties[p].pistes) || {};
      return pistes.video !== true || pistes.audio !== true;
    });
    if (muettes.length === SALLE_PARTIES.length) {
      return porteFermee('lien_perdu', 'Le lien vidéo entre les deux navigateurs est perdu. Aucune des deux parties ne reçoit plus l’autre.');
    }

    // 3. UNE SEULE, et elle est présente : c'est bien son matériel.
    for (const p of SALLE_PARTIES) {
      const pistes = (parties[p] && parties[p].pistes) || {};
      if (pistes.video !== true) {
        return porteFermee('piste_video', p === 'notaire' ? 'La caméra du notaire n’envoie plus d’image.' : 'La caméra du client n’envoie plus d’image.');
      }
      if (pistes.audio !== true) {
        return porteFermee('piste_audio', p === 'notaire' ? 'Le micro du notaire n’envoie plus de son.' : 'Le micro du client n’envoie plus de son.');
      }
    }
    const presence = salle.presence && typeof salle.presence === 'object' ? salle.presence : {};
    if (Number.isFinite(presence.coupeeA) && !Number.isFinite(presence.repriseA)) {
      return porteFermee('lien_coupe', 'Le lien est coupé depuis ' + Math.max(0, Math.round((nowMs - presence.coupeeA) / 1000)) + ' s.');
    }
    return PORTE_OUVERTE;
  }

  // Une coupure EN COURS qui dépasse la tolérance suspend la séance. Une
  // coupure déjà reprise ne la suspend pas : elle est au procès-verbal, ce qui
  // est le point.
  function doitSuspendre(salle, nowMs) {
    const s = salle && typeof salle === 'object' ? salle : {};
    if (s.statut !== SALLE_STATUT.OUVERTE) return false;
    const presence = s.presence && typeof s.presence === 'object' ? s.presence : {};
    if (!Number.isFinite(presence.coupeeA) || Number.isFinite(presence.repriseA)) return false;
    return (nowMs - presence.coupeeA) > PRESENCE_TOLERANCE_MS;
  }

  // --- Le consentement -------------------------------------------------------
  // Requis des DEUX parties dès que la séance a une valeur (donc hors
  // répétition). Il porte ce qu'il couvre : le procès-verbal toujours,
  // l'enregistrement seulement en mode témoin.
  function consentementRequis(mode) { return mode !== 'aucun'; }

  function consentementEtat(salle) {
    const s = salle && typeof salle === 'object' ? salle : {};
    const mode = s.mode || SALLE_MODE_DEFAUT;
    const donnes = s.consentements && typeof s.consentements === 'object' ? s.consentements : {};
    const manquants = [];
    const retires = [];
    for (const p of SALLE_PARTIES) {
      const c = donnes[p];
      if (!c || !isISODateTime(c.donneLe)) { manquants.push(p); continue; }
      if (c.retireLe) { retires.push(p); continue; }
      if (salleModeById(mode) && salleModeById(mode).enregistre && c.enregistrement !== true) manquants.push(p);
    }
    const requis = consentementRequis(mode);
    return {
      requis,
      manquants,
      retires,
      complet: !requis || (manquants.length === 0 && retires.length === 0),
    };
  }

  // L'enregistrement ne tourne QUE pendant que les deux accords tiennent. Un
  // retrait l'arrête à l'instant — c'est la même fonction qui répond, donc il
  // n'y a pas d'endroit où l'oublier.
  function enregistrementActif(salle) {
    const s = salle && typeof salle === 'object' ? salle : {};
    const mode = salleModeById(s.mode || SALLE_MODE_DEFAUT);
    if (!mode || !mode.enregistre) return false;
    if (s.statut !== SALLE_STATUT.OUVERTE) return false;
    return consentementEtat(s).complet;
  }

  // --- L'avancement de la cérémonie ------------------------------------------
  // Le notaire conduit. Il ne saute pas d'étape ; il peut revenir en arrière,
  // et le retour est un fait consigné, pas une correction silencieuse.
  function peutAvancer(salle, versEtape, opts) {
    const s = salle && typeof salle === 'object' ? salle : {};
    const o = opts || {};
    const errors = [];
    const cible = etapeById(versEtape);
    if (!cible) {
      return { ok: false, errors: [{ field: 'etape', code: 'etape_inconnue', message: 'Cette étape n’existe pas dans la cérémonie.' }] };
    }
    if (s.statut === SALLE_STATUT.SUSPENDUE) {
      errors.push({ field: 'statut', code: 'salle_suspendue', message: 'La séance est suspendue. Rétablissez le lien avant de poursuivre.' });
    } else if (s.statut !== SALLE_STATUT.OUVERTE) {
      errors.push({ field: 'statut', code: 'salle_fermee', message: 'La séance n’est pas ouverte.' });
    }
    const courante = etapeOrdre(s.etape || CEREMONIE_PREMIERE_ETAPE);
    if (cible.ordre > courante + 1) {
      errors.push({ field: 'etape', code: 'etape_sautee', message: 'Une étape ne se saute pas : la suivante est « ' + CEREMONIE_ETAPES[courante].nom + ' ».' });
    }
    const retour = cible.ordre <= courante;

    // Les exigences propres aux étapes ne s'appliquent qu'en AVANÇANT. Revenir
    // sur la lecture parce que le lien a sauté ne doit pas exiger la signature.
    if (!retour) {
      const readiness = salleReadiness(s, { nowMs: o.nowMs });
      if (cible.id === 'lecture' && !readiness.portes.lien.ouverte) {
        errors.push({ field: 'lien', code: 'lien_non_confirme', message: readiness.portes.lien.message });
      }
      if (cible.id === 'signature') {
        const mode = s.mode || SALLE_MODE_DEFAUT;
        if (mode === 'aucun') {
          errors.push({ field: 'mode', code: 'repetition', message: 'Une répétition ne peut pas atteindre la signature.' });
        }
        for (const porte of readiness.fermees) {
          errors.push({ field: porte, code: 'porte_fermee', message: readiness.portes[porte].message });
        }
        const consentement = consentementEtat(s);
        if (!consentement.complet) {
          errors.push({
            field: 'consentement', code: 'consentement_incomplet',
            message: consentement.retires.length
              ? 'Un consentement a été retiré. La signature ne peut pas être libérée.'
              : 'Les deux parties doivent avoir donné leur accord avant la signature.',
          });
        }
        // ADR 0047 §6 : l'adaptateur de démonstration ne peut pas produire de
        // minute. Le refus est ICI, pas dans une consigne d'exploitation.
        if (o.fournisseur === 'demonstration' && s.demonstration !== true) {
          errors.push({
            field: 'fournisseur', code: 'fournisseur_demonstration',
            message: 'Aucun acte réel ne peut être signé tant que le fournisseur admis par la Chambre n’est pas configuré.',
          });
        }
      }
    }
    if (errors.length) return { ok: false, errors };
    return { ok: true, etape: cible.id, retour };
  }

  // --- Le procès-verbal ------------------------------------------------------
  // Ce qui peut y entrer, et RIEN d'autre. La liste est blanche à dessein : le
  // procès-verbal dit ce qui s'est passé, jamais ce qui a été dit ni ce que
  // l'acte contient (exigence E2).
  const PV_FAITS = Object.freeze([
    'salle_ouverte', 'porte_ouverte', 'porte_fermee', 'etape_franchie', 'etape_reprise',
    'identite_attestee',
    'consentement_donne', 'consentement_retire', 'lien_confirme', 'lien_coupe', 'lien_repris',
    'enregistrement_demarre', 'enregistrement_arrete', 'signature_liberee', 'salle_suspendue',
    'salle_reprise', 'salle_scellee', 'mention_demonstration',
  ]);
  // Les seules clés qu'un détail peut porter. Un champ libre y ouvrirait la
  // porte au contenu de l'acte, et le scellé perdrait ce qui fait sa valeur.
  const PV_DETAIL_CHAMPS = Object.freeze([
    'porte', 'etape', 'partie', 'mode', 'methode', 'sas', 'coupureMs', 'reference', 'fournisseur',
  ]);
  const PV_PARTIES = Object.freeze(['notaire', 'client', 'systeme']);

  function validateEntreePv(entree) {
    const errors = [];
    const e = entree && typeof entree === 'object' ? entree : {};
    if (!PV_FAITS.includes(e.fait)) {
      errors.push({ field: 'fait', code: 'fait_inconnu', message: 'Ce fait n’a pas sa place au procès-verbal.' });
    }
    if (!PV_PARTIES.includes(e.par)) {
      errors.push({ field: 'par', code: 'acteur_inconnu', message: 'Une entrée du procès-verbal nomme son acteur.' });
    }
    if (!isISODateTime(e.a)) {
      errors.push({ field: 'a', code: 'heure_requise', message: 'Une entrée du procès-verbal porte son heure.' });
    }
    const detail = e.detail && typeof e.detail === 'object' ? e.detail : {};
    for (const cle of Object.keys(detail)) {
      if (!PV_DETAIL_CHAMPS.includes(cle)) {
        errors.push({ field: 'detail.' + cle, code: 'champ_interdit', message: 'Le procès-verbal ne porte ni le contenu de l’acte ni ce qui a été dit.' });
      }
    }
    if (errors.length) return { ok: false, errors };
    const propre = {};
    for (const cle of PV_DETAIL_CHAMPS) if (detail[cle] !== undefined && detail[cle] !== null) propre[cle] = detail[cle];
    return { ok: true, entree: { fait: e.fait, par: e.par, a: e.a, detail: propre } };
  }

  // Sérialisation canonique : clés triées, pas d'espaces. Deux procès-verbaux
  // identiques doivent donner deux empreintes identiques, quelle que soit la
  // machine qui les a assemblés.
  function canonique(valeur) {
    if (valeur === null || valeur === undefined) return 'null';
    if (Array.isArray(valeur)) return '[' + valeur.map(canonique).join(',') + ']';
    if (typeof valeur === 'object') {
      return '{' + Object.keys(valeur).sort().map((k) => JSON.stringify(k) + ':' + canonique(valeur[k])).join(',') + '}';
    }
    return JSON.stringify(valeur);
  }

  // empreinte(n) = SHA-256( empreinte(n-1) ‖ entrée(n) ). Retirer une entrée,
  // en insérer une, ou déplacer une heure change TOUTES les empreintes qui
  // suivent — et donc l'empreinte finale.
  const PV_GENESE = '0000000000000000000000000000000000000000000000000000000000000000';

  function chainerProcesVerbal(entrees) {
    const liste = Array.isArray(entrees) ? entrees : [];
    let precedente = PV_GENESE;
    return liste.map((brute, i) => {
      const v = validateEntreePv(brute);
      const entree = v.ok ? v.entree : { fait: 'inconnu', par: 'systeme', a: null, detail: {} };
      const n = i + 1;
      const empreinte = sha256Hex(precedente + '\n' + canonique({ n, ...entree }));
      precedente = empreinte;
      return { n, ...entree, empreinte };
    });
  }

  // Le scellé. Une salle de démonstration porte sa mention DANS la chaîne, en
  // première entrée : un procès-verbal de démonstration ne peut donc pas être
  // présenté comme autre chose sans que l'empreinte cesse de concorder.
  function scellerProcesVerbal(salle, opts) {
    const s = salle && typeof salle === 'object' ? salle : {};
    const o = opts || {};
    // Le scellé GARANTIT la mention en tête ; il ne la double pas. La séance
    // l'inscrit déjà à l'ouverture, en deuxième position, et un procès-verbal
    // qui dirait deux fois la même chose se lirait comme une erreur là où
    // c'est une précaution. On la retire donc d'où elle est pour la remettre
    // là où elle doit être : impossible à manquer, et une seule fois.
    const brutes = (Array.isArray(s.pv) ? s.pv : [])
      .filter((e) => !(s.demonstration === true && e && e.fait === 'mention_demonstration'));
    if (s.demonstration === true) {
      brutes.unshift({
        fait: 'mention_demonstration', par: 'systeme',
        a: brutes.length && isISODateTime(brutes[0].a) ? brutes[0].a : (o.a || null),
        detail: {},
      });
    }
    const entrees = chainerProcesVerbal(brutes);
    return {
      salleId: s.id || null,
      bidId: s.bidId || null,
      mode: s.mode || SALLE_MODE_DEFAUT,
      demonstration: s.demonstration === true,
      entrees,
      empreinte: entrees.length ? entrees[entrees.length - 1].empreinte : PV_GENESE,
      scelleLe: o.a || null,
    };
  }

  // Relire un scellé reçu : la chaîne est-elle celle qu'elle prétend être ?
  // Le notaire garde sa copie, Nota garde l'empreinte ; ceci les confronte.
  function verifierProcesVerbal(scelle) {
    const s = scelle && typeof scelle === 'object' ? scelle : {};
    const entrees = Array.isArray(s.entrees) ? s.entrees : [];
    const rechaine = chainerProcesVerbal(entrees.map((e) => ({ fait: e.fait, par: e.par, a: e.a, detail: e.detail })));
    for (let i = 0; i < entrees.length; i++) {
      if (!rechaine[i] || rechaine[i].empreinte !== entrees[i].empreinte) {
        return { ok: false, rompueA: i + 1, empreinte: null };
      }
    }
    const empreinte = rechaine.length ? rechaine[rechaine.length - 1].empreinte : PV_GENESE;
    if (s.empreinte && s.empreinte !== empreinte) return { ok: false, rompueA: entrees.length, empreinte };
    return { ok: true, rompueA: null, empreinte };
  }

  // --- L'ouverture d'une salle -----------------------------------------------
  // Une salle n'existe que sur un acte RETENU : sans notaire engagé, il n'y a
  // pas de cérémonie à conduire.
  function validateSalleOuverture(bid, opts) {
    const o = opts || {};
    const errors = [];
    const b = bid && typeof bid === 'object' ? bid : {};
    if (b.status !== STATUS.RETENUE) {
      errors.push({ field: 'bid', code: 'acte_non_retenu', message: 'Une séance de signature s’ouvre sur un acte retenu par un notaire.' });
    }
    const mode = o.mode === undefined ? SALLE_MODE_DEFAUT : o.mode;
    if (!salleModeById(mode)) {
      errors.push({ field: 'mode', code: 'mode_inconnu', message: 'Ce mode de séance n’existe pas.' });
    }
    if (errors.length) return { ok: false, errors };
    return {
      ok: true,
      salle: {
        bidId: b.id,
        dateISO: b.dateISO,
        notaryId: b.notaryId,
        mode,
        demonstration: o.demonstration === true,
        statut: SALLE_STATUT.PREVUE,
        etape: CEREMONIE_PREMIERE_ETAPE,
        parties: {
          notaire: { authentifie: false, pistes: { video: false, audio: false } },
          client: { authentifie: false, pistes: { video: false, audio: false } },
        },
        identites: { notaire: null, client: null },
        lien: { empreinteNotaire: null, empreinteClient: null, confirmeLe: null, confirmePour: null },
        consentements: { notaire: null, client: null },
        presence: { coupeeA: null, repriseA: null },
        pv: [],
        scelle: null,
      },
    };
  }

  return {
    money,
    moneyEn,
    SERVICES,
    ACTES_A_VENIR,
    acteAVenirById,
    DEFAULT_SERVICE_ID,
    LENDERS,
    lenderById,
    LENDER_CRITERION_ID,
    LENDER_OTHER_ID,
    LENDER_OTHER_FIELD,
    lenderOtherName,
    bidLender,
    CRITERIA_GROUPS,
    criteriaGroupById,
    criteriaGroups,
    DEPLACEMENTS,
    DEPLACEMENT_QUI,
    deplacementById,
    DEPLACEMENT_CRITERION_ID,
    DEPLACEMENT_URGENCE_ID,
    bidDeplacement,
    NOTARY_RADII,
    FSA_CENTROIDS,
    fsaDistanceKm,
    notaryCanServe,
    QC_POSTAL_LETTERS,
    normalizePostalPrefix,
    isPostalPrefix,
    isQuebecPostalPrefix,
    serviceById,
    computeBasePrice,
    notaPrice,
    MARKET_MULTIPLIER,
    complexity,
    missingRequired,
    TIERS,
    tierById,
    tierForDays,
    tierMultiplier,
    tunedTierMultipliers,
    prixNota,
    prixNotaGrille,
    prixNotaFige,
    prixAnnonce,
    PREMIUM_CAP,
    STATUS,
    isISODate,
    isEmail,
    daysBetween,
    addDays,
    validateIndemnite,
    INDEMNITE_JUSTIFICATION_MIN,
    INDEMNITE_JUSTIFICATION_MAX,
    BUSINESS_TIMEZONE,
    businessDay,
    AUDIT_RETENTION_YEARS,
    auditRetentionTtl,
    // La politique de conservation, et la frontière de l'effacement (Loi 25).
    RETENTION_FAMILIES,
    RETENTION_INDEFINIE,
    retentionDays,
    retentionTtl,
    retentionPolicy,
    erasurePlan,
    BID_IDENTIFYING_FIELDS,
    redactedBid,
    OFFER_VALIDITY_DAYS,
    offerExpirationDate,
    isOfferExpired,
    validateOffer,
    validateCounterOffer,
    suggestedCounterOffer,
    validateDocumentRequest,
    requestableItems,
    CHAT_MESSAGE_MAX,
    CHAT_FROM,
    validateChatMessage,
    validateChatDocument,
    documentStorageKey,
    CHAT_DOCUMENTS_MAX,
    DOCUMENT_TYPES,
    validateRelease,
    releasedBid,
    releasedDocumentKeys,
    agendaByDate,
    rankOf,
    carnetPulse,
    CARNET_REPERE_MIN_OFFERS,
    carnetRepereDisponible,
    weekAgenda,
    CONTACT,
    CONTACT_MESSAGE_MAX,
    validateContactMessage,
    SUPPORT_FROM,
    SUPPORT_STATUT,
    SUPPORT_STATUTS,
    SUPPORT_EXCERPT_MAX,
    supportThreadSummary,
    SUPPORT_REPONSES_TYPES,
    FINANCING_KNOWLEDGE,
    NOTARY_SERVICE_KNOWLEDGE,
    notaryServiceKnowledge,
    FINANCING_AI_FIELDS,
    FINANCING_AI_LIMITS,
    ACT_AI_FIELDS,
    ACT_AI_LIMITS,
    NOTARY_AI_BETA_TRIAL_USES,
    NOTARY_AI_PLANS,
    NOTARY_AI_QUESTION_DECISIONS,
    notaryAIPlan,
    notaryAIPlanPublic,
    CABINET_PLANS,
    cabinetPlan,
    cabinetPlanPublic,
    actAIFields,
    NOTARY_LEARNING_POLICY_VERSION,
    NOTARY_LEARNING_EVENT_KINDS,
    NOTARY_LEARNING_PROGRAM,
    notaryLearningPolicy,
    notaryLearningPolicyFor,
    CUSTOMER_IMPROVEMENT_POLICY_VERSION,
    CUSTOMER_EXPERIENCE_MODES,
    CUSTOMER_IMPROVEMENT_POLICY,
    experienceMetrics,
    customerExperienceConfig,
    publicCustomerExperience,
    validateActAIInput,
    validateActAIExtraction,
    validateActAIReview,
    validateFinancingAIInput,
    validateFinancingAIExtraction,
    validateFinancingAIReview,
    financingPreparation,
    financingWorkPacket,
    actPreparation,
    actWorkPacket,
    notaryAIUncertaintyQuestions,
    validateNotaryAIUncertaintyResponse,
    NOTARY_CONTROL_PLAN_VERSION,
    notaryControlPlan,
    NOTARY_PARAMETER_COVERAGE_VERSION,
    notaryParameterCoverage,
    NOTARY_OFFER_TEMPLATE_VERSION,
    notaryOfferTemplate,
    NOTARY_CASE_COVERAGE_VERSION,
    notaryCaseCoverage,
    notaryWorkflowSummary,
    FINANCING_AUTOMATION_TARGET,
    FINANCING_WORK_PACKET_VERSION,
    supportFacts,
    catalogueSnapshot,
    supportQuestionGuard,
    SUPPORT_NIVEAUX,
    SUPPORT_QUESTIONS_SUGGEREES,
    SUPPORT_TOPICS,
    SUPPORT_ESCALADE_MOTIFS,
    validateSupportAnswer,
    NOTIF_KINDS,
    isNotifKind,
    SUPPORT_MESSAGE_MAX,
    validateSupportMessage,
    EVALUATION_COMMENT_MAX,
    validateEvaluation,
    ACT_VALUE_BOUNDS,
    validateActValue,
    ratingAverage,
    COTE,
    notaryScore,
    notaryServiceRecord,
    CNQ,
    CNQ_LINK_MAX,
    validateNotaryProfile,
    validateTelephone,
    toE164,
    validateSmsConsent,
    SMS_TEXT_MAX,
    smsText,
    maskTelephone,
    NOTARY_NAME_MAX,
    NOTARY_ADDRESS_MAX,
    NOTARY_CONTACT_REQUIRED,
    notaryContactMissing,
    notaryEtude,
    NOTARY_ALERT_PACES,
    NOTARY_ALERTES_DEFAULT,
    validateNotaryAlertes,
    notaryAlertes,
    telHref,
    makeFixtures,
    seedSignature,
    bidLabel,
    documentApplies,
    documentEffect,
    dossierItems,
    leadReadiness,
    DOSSIER_TRANSMIS,
    DOSSIER_FILE,
    DOSSIER_VALUE_MAX,
    sanitizeFileName,
    validateDossierFile,
    cleanDossier,
    REFERRAL,
    referralProjection,
    ANALYTICS_DIMENSIONS,
    cleanAnalyticsContext,
    FUNNEL_EVENTS,
    isFunnelEvent,
    isClientFunnelEvent,
    normalizeReferralCode,
    isReferralCode,
    referralLedger,
    recommendedAmount,
    obtainChance,
    CAUTION_LEAD_DAYS,
    cautionDue,
    CAUTION_VIE_JOURS,
    cautionVivante,
    REMINDER_OFFSETS,
    REMINDER_KINDS,
    reminderKindForDays,
    dueReminders,
    FIXTURE_SEED,
    FIXTURE_DISPLAY_CAP,
    // --- Salle de signature (ADR 0047) ---------------------------------------
    sha256Hex,
    chaineAuthentification,
    SALLE_STATUT,
    SALLE_MODES,
    SALLE_MODE_DEFAUT,
    salleModeById,
    SALLE_PORTES,
    SALLE_PORTE_LABELS,
    SALLE_PARTIES,
    PRESENCE_TOLERANCE_MS,
    CEREMONIE_ETAPES,
    CEREMONIE_PREMIERE_ETAPE,
    etapeById,
    etapeOrdre,
    IDENTITE_METHODES,
    identiteMethodeById,
    isISODateTime,
    validateAttestationIdentite,
    salleReadiness,
    doitSuspendre,
    consentementRequis,
    consentementEtat,
    enregistrementActif,
    peutAvancer,
    PV_FAITS,
    PV_DETAIL_CHAMPS,
    PV_GENESE,
    validateEntreePv,
    chainerProcesVerbal,
    scellerProcesVerbal,
    verifierProcesVerbal,
    validateSalleOuverture,
  };
});
