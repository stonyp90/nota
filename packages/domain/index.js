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
  // vente was removed deliberately — see docs/decisions/0003-bounded-intake.md.
  // The catalogue is the FINANCING family: testament and procuration were
  // retired (docs/decisions/0010-financing-first-catalogue.md) — the urgency
  // ladder prices a deadline, and financing is the act that has one.
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
    { id: 'prive', nom: 'Prêteur privé', virtuel: false, add: 300, poids: 2 },
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
      id: LENDER_CRITERION_ID, type: 'choice', required: true, ui: 'select',
      label: 'Prêteur hypothécaire',
      aide: 'Un prêteur virtuel (sans succursale) demande plus de coordination au notaire.',
      options: LENDERS.map((l) => ({ id: l.id, label: l.nom, add: l.add, poids: l.poids })),
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
  const DEPLACEMENTS = [
    { id: 'client_50', nom: 'Je me déplace à l’étude — jusqu’à 50 km', nomCourt: '≤ 50 km', qui: 'client', km: 50, add: 0, poids: 0, urgence: false },
    { id: 'client_25', nom: 'Je me déplace à l’étude — jusqu’à 25 km', nomCourt: '≤ 25 km', qui: 'client', km: 25, add: 50, poids: 0, urgence: false },
    { id: 'client_10', nom: 'Je me déplace à l’étude — moins de 10 km', nomCourt: '< 10 km', qui: 'client', km: 10, add: 100, poids: 1, urgence: false },
    { id: 'notaire_25', nom: 'Le notaire se déplace chez moi — jusqu’à 25 km', nomCourt: '≤ 25 km', qui: 'notaire', km: 25, add: 150, poids: 1, urgence: false },
    { id: 'notaire_50', nom: 'Le notaire se déplace chez moi — jusqu’à 50 km', nomCourt: '≤ 50 km', qui: 'notaire', km: 50, add: 250, poids: 2, urgence: false },
    { id: 'urgence_en_ligne', nom: 'Urgence — signature 100 % en ligne', nomCourt: 'Urgence — 100 % en ligne', qui: 'en_ligne', km: 0, add: 400, poids: 2, urgence: true },
  ];

  // The « who travels » half of the same split. The list is data — adapters
  // render it, never re-declare it. An `urgence` direction has a single band,
  // so renderers need no radius row for it.
  // The labels answer « où se signe l'acte ? » in the client's own register —
  // the same words as the notary-card pill (« À l'étude · ≤ 50 km »).
  const DEPLACEMENT_QUI = [
    { id: 'client', nom: 'À l’étude', urgence: false },
    { id: 'notaire', nom: 'Chez moi', urgence: false },
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
      id: DEPLACEMENT_CRITERION_ID, type: 'choice', required: true, ui: 'select',
      label: 'Déplacement pour la signature',
      // Conversion default (`defaut`): the dominant answer costs nothing, so
      // renderers pre-declare it and the client only touches the exceptions.
      defaut: 'client_50',
      aide: 'L’acte se signe en personne. Plus vous êtes mobile, plus de notaires peuvent vous servir.',
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
      description:
        'Acte de prêt et publication de l’hypothèque lors d’un refinancement.',
      pricing: {
        base: 2000,
        criteria: [
          // Order is the layout: the three questions that genuinely vary
          // (montant, approbation, prêteur) come first; the two carrying a
          // zero-cost default (succession, déplacement) close the block
          // pre-answered — a typical client touches three controls, not five.
          {
            id: 'valeur_pret', type: 'bracket', required: true, label: 'Montant du nouveau prêt', unit: '$',
            brackets: [
              { max: 300000, add: 0, poids: 0 },
              { max: 600000, add: 150, poids: 0 },
              { max: 1000000, add: 350, poids: 1 },
              { max: null, add: 600, poids: 1 },
            ],
          },
          {
            id: 'approbation_bancaire', type: 'choice', required: true, label: 'Approbation bancaire',
            aide: 'Sans les instructions du prêteur, le notaire ne peut signer à la date visée.',
            options: [
              { id: 'obtenue', label: 'Obtenue', add: 0, poids: 0 },
              { id: 'en_cours', label: 'En cours', add: 100, poids: 1 },
              { id: 'non', label: 'Pas encore', add: 200, poids: 2 },
            ],
          },
          lenderCriterion(),
          {
            id: 'succession', type: 'choice', required: true, label: 'La propriété fait-elle partie d’une succession ?',
            defaut: 'non',
            aide: 'Héritiers, liquidateur : dossier nettement plus complexe.',
            options: [
              { id: 'non', label: 'Non', add: 0, poids: 0 },
              { id: 'oui', label: 'Oui', add: 400, poids: 2 },
            ],
          },
          deplacementCriterion(),
          { id: 'coemprunteur', type: 'flag', optional: true, label: 'Co-emprunteur / indivision', aide: 'Plus de deux propriétaires inscrits.', add: 150, poids: 1 },
          {
            id: 'assurance_habitation', type: 'choice', optional: true, label: 'Assurance habitation à jour ?',
            aide: 'Le prêteur exige une assurance habitation en vigueur.',
            options: [
              { id: 'oui', label: 'Oui, en vigueur', add: 0, poids: 0 },
              { id: 'a_renouveler', label: 'À renouveler', add: 0, poids: 1 },
              { id: 'non', label: 'Aucune', add: 0, poids: 2 },
            ],
          },
          {
            id: 'certificat_localisation', type: 'choice', optional: true, label: 'Certificat de localisation',
            aide: 'Un certificat périmé ou absent retarde souvent le dossier.',
            options: [
              { id: 'a_jour', label: 'À jour', add: 0, poids: 0 },
              { id: 'inconnu', label: 'Je ne sais pas', add: 0, poids: 1 },
              { id: 'perime', label: 'Périmé / absent', add: 100, poids: 1 },
            ],
          },
        ],
      },
      documents: [
        { id: 'piece_identite', nom: 'Pièce d’identité avec photo', aide: 'Permis de conduire, passeport ou carte d’assurance maladie valide.' },
        { id: 'offre_preteur', nom: 'Offre de financement du prêteur', aide: 'Le document d’engagement de la banque, avec le taux et le montant.' },
        { id: 'releve_hypotheque', nom: 'Relevé hypothécaire actuel', aide: 'Un relevé de moins de 30 jours du prêt à rembourser.' },
        { id: 'compte_taxes', nom: 'Compte de taxes municipales', aide: 'Le compte le plus récent de la municipalité.' },
        { id: 'certificat_localisation', nom: 'Certificat de localisation', aide: 'Le plan de l’arpenteur-géomètre. C’est souvent le document qui retarde un dossier — vérifiez qu’il est à jour.' },
      ],
      champs: [
        // Le prêteur n'est plus un champ libre : c'est le critère de prix
        // `preteur` (la question obligatoire du carnet), répondu dans __pricing.
        { id: 'adresse', label: 'Adresse de l’immeuble', aide: 'Adresse civique complète de la propriété refinancée.' },
        { id: 'date_echeance_taux', label: 'Échéance du taux', aide: 'La date avant laquelle le taux offert doit être signé, si connue.' },
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
      description:
        'Acte de prêt et publication de l’hypothèque pour un nouveau financement.',
      pricing: {
        base: 1800,
        criteria: [
          {
            id: 'valeur_pret', type: 'bracket', required: true, label: 'Montant du prêt', unit: '$',
            brackets: [
              { max: 300000, add: 0, poids: 0 },
              { max: 600000, add: 150, poids: 0 },
              { max: 1000000, add: 350, poids: 1 },
              { max: null, add: 600, poids: 1 },
            ],
          },
          {
            id: 'contexte', type: 'choice', required: true, label: 'Le prêt finance quoi ?',
            aide: 'Un achat exige de coordonner l’acte de prêt avec la vente chez le notaire instrumentant.',
            options: [
              { id: 'propriete_detenue', label: 'Une propriété que je possède', add: 0, poids: 0 },
              { id: 'achat', label: 'L’achat d’une propriété', add: 200, poids: 1 },
            ],
          },
          {
            id: 'approbation_bancaire', type: 'choice', required: true, label: 'Approbation bancaire',
            aide: 'Sans les instructions du prêteur, le notaire ne peut signer à la date visée.',
            options: [
              { id: 'obtenue', label: 'Obtenue', add: 0, poids: 0 },
              { id: 'en_cours', label: 'En cours', add: 100, poids: 1 },
              { id: 'non', label: 'Pas encore', add: 200, poids: 2 },
            ],
          },
          lenderCriterion(),
          deplacementCriterion(),
          { id: 'coemprunteur', type: 'flag', optional: true, label: 'Co-emprunteur / indivision', aide: 'Plus de deux propriétaires inscrits.', add: 150, poids: 1 },
          {
            id: 'assurance_habitation', type: 'choice', optional: true, label: 'Assurance habitation à jour ?',
            aide: 'Le prêteur exige une assurance habitation en vigueur.',
            options: [
              { id: 'oui', label: 'Oui, en vigueur', add: 0, poids: 0 },
              { id: 'a_renouveler', label: 'À renouveler', add: 0, poids: 1 },
              { id: 'non', label: 'Aucune', add: 0, poids: 2 },
            ],
          },
          {
            id: 'certificat_localisation', type: 'choice', optional: true, label: 'Certificat de localisation',
            aide: 'Un certificat périmé ou absent retarde souvent le dossier.',
            options: [
              { id: 'a_jour', label: 'À jour', add: 0, poids: 0 },
              { id: 'inconnu', label: 'Je ne sais pas', add: 0, poids: 1 },
              { id: 'perime', label: 'Périmé / absent', add: 100, poids: 1 },
            ],
          },
        ],
      },
      documents: [
        { id: 'piece_identite', nom: 'Pièce d’identité avec photo', aide: 'Permis de conduire, passeport ou carte d’assurance maladie valide.' },
        { id: 'offre_preteur', nom: 'Offre de financement du prêteur', aide: 'Le document d’engagement de la banque, avec le taux et le montant.' },
        { id: 'compte_taxes', nom: 'Compte de taxes municipales', aide: 'Le compte le plus récent de la municipalité.' },
        { id: 'certificat_localisation', nom: 'Certificat de localisation', aide: 'Le plan de l’arpenteur-géomètre. C’est souvent le document qui retarde un dossier — vérifiez qu’il est à jour.' },
      ],
      champs: [
        { id: 'adresse', label: 'Adresse de l’immeuble', aide: 'Adresse civique complète de la propriété financée.' },
        { id: 'date_echeance_taux', label: 'Échéance du taux', aide: 'La date avant laquelle le taux offert doit être signé, si connue.' },
      ],
    },
  ];

  function serviceById(id) {
    return SERVICES.find((s) => s.id === id) || null;
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
  function missingRequired(serviceId, answers) {
    const svc = serviceById(serviceId);
    if (!svc || !svc.pricing) return [];
    answers = answers || {};
    const missing = [];
    for (const c of svc.pricing.criteria || []) {
      if (!c.required) continue;
      const a = answers[c.id];
      let ok;
      if (c.type === 'choice') ok = (c.options || []).some((o) => o.id === a);
      else if (c.type === 'bracket') {
        // A blank/null/false/"" all coerce to a finite 0 via Number(); require a
        // real positive number so a crafted payload cannot skip the question.
        ok = (typeof a === 'number' || (typeof a === 'string' && a.trim() !== '')) && Number.isFinite(Number(a)) && Number(a) > 0;
      } else if (c.type === 'flag') ok = a === true;
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
  const TIERS = [
    { id: 'standard',    nom: 'Standard',    nomEn: 'Standard', maxJours: null, apercuMin: 1.0, apercuMax: 1.0, eleve: false },
    { id: 'rapide',      nom: 'Rapide',      nomEn: 'Fast',     maxJours: 14,   apercuMin: 1.8, apercuMax: 2.2, eleve: false },
    { id: 'prioritaire', nom: 'Prioritaire', nomEn: 'Priority', maxJours: 7,    apercuMin: 2.7, apercuMax: 3.3, eleve: true },
    { id: 'urgence',     nom: 'Urgent',      nomEn: 'Urgent',   maxJours: 1,    apercuMin: 3.3, apercuMax: 3.7, eleve: true },
    { id: 'extreme',     nom: 'Extrême',     nomEn: 'Extreme',  maxJours: 0,    apercuMin: 3.7, apercuMax: 4.3, eleve: true },
  ];

  // What a client is actually asked to pay at a given notice, as a multiple of
  // the starting price. With no history it is the middle of the tier's market
  // band — exactly what recommendedAmount pre-fills. Pass the carnet's bids and
  // it becomes the TUNED value learned from what actually cleared. One number,
  // one definition, so the price shown on a calendar cell can never disagree
  // with the price in the form.
  function tierMultiplier(id, bids) {
    const t = tierById(id);
    if (!t) return null;
    if (bids != null) return tunedTierMultipliers(bids)[t.id];
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

  function tunedTierMultipliers(bids) {
    const byTier = {};
    if (Array.isArray(bids)) {
      for (const b of bids) {
        if (!b || b.status !== STATUS.RETENUE) continue;
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
  const DOCUMENT_REQUEST_MESSAGE_MAX = 500;
  function requestableItems(serviceId) {
    const svc = serviceById(serviceId);
    if (!svc) return [];
    return svc.documents
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
    courriel: 'bonjour@nota.ca',
    confidentialite: 'confidentialite@nota.ca',
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
  const SUPPORT_FROM = { VISITEUR: 'visiteur', NOTA: 'nota' };
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
  const NOTARY_ALERTES_DEFAULT = Object.freeze({ pace: 'daily', urgentOnly: false });
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
    if (errors.length) return { ok: false, value: null, errors };
    return { ok: true, value: { pace, urgentOnly }, errors: [] };
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
      'v1',
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
      const montant = Math.min(base * PREMIUM_CAP, Math.max(base, Math.round((base * mult) / 5) * 5));
      const anonyme = rng() > 0.35;
      const retenue = rng() > 0.8;
      bids.push({
        id: 'fx-' + i,
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
      });
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
    const mult = tierMultiplier(t.id, bids);
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
  const DOSSIER_TRANSMIS = 'transmis_autrement';
  function leadReadiness(serviceId, saved) {
    saved = saved || {};
    const svc = serviceById(serviceId);
    if (!svc) return { total: 0, done: 0, missing: [], requis: [], consent: false, ready: false };
    const items = svc.documents
      .map((d) => ({ id: d.id, nom: d.nom }))
      .concat(svc.champs.map((c) => ({ id: c.id, nom: c.label })));
    const missing = items.filter((it) => !saved[it.id]).map((it) => it.nom);
    const consent = !!saved.__consent;
    const requis = missingRequired(serviceId, saved.__pricing || {}).map((m) => m.label);
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
    partners: [
      { id: 'agent_immobilier', nom: 'Agent immobilier', nomEn: 'Real-estate agent' },
      { id: 'courtier_hypothecaire', nom: 'Courtier hypothécaire', nomEn: 'Mortgage broker' },
      { id: 'autre_professionnel', nom: 'Autre professionnel', nomEn: 'Other professional' },
    ],
  };

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
    { id: 'publie',          nom: 'Offres publiées',              nomEn: 'Offers published' },
    { id: 'paiement_ok',     nom: 'Cartes autorisées',            nomEn: 'Cards authorized' },
    { id: 'paiement_annule', nom: 'Paiements abandonnés',         nomEn: 'Payments abandoned' },
    { id: 'notaire_porte',   nom: 'Espace notaire ouvert',        nomEn: 'Notary space opened' },
    { id: 'notaire_inscrit', nom: 'Notaires inscrits',            nomEn: 'Notaries signed up' },
  ]);
  function isFunnelEvent(id) {
    return typeof id === 'string' && FUNNEL_EVENTS.some((e) => e.id === id);
  }

  return {
    money,
    moneyEn,
    SERVICES,
    DEFAULT_SERVICE_ID,
    LENDERS,
    lenderById,
    LENDER_CRITERION_ID,
    LENDER_OTHER_ID,
    LENDER_OTHER_FIELD,
    lenderOtherName,
    bidLender,
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
    PREMIUM_CAP,
    STATUS,
    isISODate,
    isEmail,
    daysBetween,
    addDays,
    BUSINESS_TIMEZONE,
    businessDay,
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
    weekAgenda,
    CONTACT,
    CONTACT_MESSAGE_MAX,
    validateContactMessage,
    SUPPORT_FROM,
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
    leadReadiness,
    DOSSIER_TRANSMIS,
    DOSSIER_FILE,
    DOSSIER_VALUE_MAX,
    sanitizeFileName,
    validateDossierFile,
    cleanDossier,
    REFERRAL,
    FUNNEL_EVENTS,
    isFunnelEvent,
    normalizeReferralCode,
    isReferralCode,
    referralLedger,
    recommendedAmount,
    obtainChance,
    CAUTION_LEAD_DAYS,
    cautionDue,
    REMINDER_OFFSETS,
    REMINDER_KINDS,
    reminderKindForDays,
    dueReminders,
    FIXTURE_SEED,
  };
});
