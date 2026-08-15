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
  function money(dollars) {
    const n = Math.round(Number(dollars) || 0);
    const digits = Math.abs(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (n < 0 ? '−' : '') + digits + ' $';
  }

  // --- Services --------------------------------------------------------------
  // Only acts with a bounded, client-assemblable intake are listed. Acte de
  // vente was removed deliberately — see docs/decisions/0003-bounded-intake.md.
  // Each service carries its own document checklist and info fields, with
  // plain-language help text (fr-CA) used by both the Dossier UI and the
  // text-to-speech reader.
  const SERVICES = [
    {
      id: 'testament',
      nom: 'Testament et mandat de protection',
      // Floor reflects the two-act bundle (will + protection mandate), which the
      // Québec market prices at ~700–1000 $. See docs/decisions/0006.
      prixDepart: 650,
      description:
        'Testament notarié et mandat de protection en cas d’inaptitude.',
      // Dynamic base price = base + the flat add-on of each answered criterion.
      // Criteria are DATA (edit here, no code change) and are collected as part
      // of the dossier — the same questions the notary needs (see computeBasePrice).
      // 2 mandatory questions (scale + complexity-flip), the rest optional
      // behind an "affiner" expander (see the research model). Weights (poids)
      // drive the notary's complexity label.
      pricing: {
        base: 650,
        criteria: [
          {
            id: 'who_for', type: 'choice', required: true, label: 'Le testament est pour qui ?',
            aide: 'Un couple = deux testaments miroirs + deux mandats.',
            options: [
              { id: 'solo', label: 'Moi seul', add: 0, poids: 0 },
              { id: 'couple', label: 'Couple', add: 450, poids: 0 },
            ],
          },
          {
            id: 'fiducie_needed', type: 'choice', required: true, label: 'Un héritier a-t-il besoin d’être protégé ?',
            aide: 'Enfant mineur, proche à charge ou handicapé, ou remise de l’héritage à un âge précis.',
            options: [
              { id: 'non', label: 'Non', add: 0, poids: 0 },
              { id: 'oui', label: 'Oui', add: 600, poids: 2 },
            ],
          },
          {
            id: 'include_mandate', type: 'choice', optional: true, label: 'Inclure le mandat de protection ?',
            aide: 'Le forfait standard réunit le testament et le mandat d’inaptitude.',
            options: [
              { id: 'oui', label: 'Oui (forfait)', add: 0, poids: 0 },
              { id: 'non', label: 'Testament seul', add: -150, poids: 0 },
            ],
          },
          { id: 'famille_recomposee', type: 'flag', optional: true, label: 'Famille recomposée', aide: 'Conjoint et enfants d’unions différentes.', add: 150, poids: 1 },
          { id: 'business_assets', type: 'flag', optional: true, label: 'Entreprise, société ou ferme', aide: 'Actions, convention d’actionnaires, gel successoral.', add: 300, poids: 2 },
          { id: 'foreign_assets', type: 'flag', optional: true, label: 'Biens importants à l’étranger', aide: 'Immeuble ou comptes hors Canada.', add: 250, poids: 2 },
        ],
      },
      documents: [
        { id: 'piece_identite', nom: 'Pièce d’identité avec photo', aide: 'Permis de conduire, passeport ou carte d’assurance maladie valide.' },
        { id: 'liste_biens', nom: 'Liste sommaire des biens', aide: 'Immeubles, comptes, placements. Une estimation suffit à cette étape.' },
      ],
      champs: [
        { id: 'liquidateur', label: 'Liquidateur (exécuteur) pressenti', aide: 'La personne qui réglera la succession. Nom complet et lien avec vous.' },
        { id: 'beneficiaires', label: 'Bénéficiaires principaux', aide: 'Qui hérite, et dans quelles proportions approximatives.' },
        { id: 'mandataire', label: 'Mandataire en cas d’inaptitude', aide: 'La personne qui vous représenterait si vous perdiez vos capacités.' },
        { id: 'tuteur', label: 'Tuteur des enfants mineurs', aide: 'Si vous avez des enfants mineurs, qui en prendrait soin. Écrivez « aucun » s’il n’y a pas d’enfant mineur.' },
      ],
    },
    {
      id: 'procuration',
      nom: 'Procuration',
      prixDepart: 295,
      description:
        'Procuration générale ou spéciale pour agir en votre nom.',
      pricing: {
        base: 295,
        criteria: [
          {
            id: 'scope', type: 'choice', required: true, label: 'Étendue de la procuration',
            aide: 'Un acte précis, ou la gestion générale de vos biens.',
            options: [
              { id: 'specifique', label: 'Un acte précis', add: 0, poids: 0 },
              { id: 'generale', label: 'Gestion générale', add: 100, poids: 0 },
            ],
          },
          {
            id: 'realEstate', type: 'choice', required: true, label: 'Vise-t-elle un immeuble ?',
            aide: 'Pouvoir de vendre, acheter ou hypothéquer une propriété — encadré strictement par la loi.',
            options: [
              { id: 'non', label: 'Non', add: 0, poids: 0 },
              { id: 'oui', label: 'Oui', add: 200, poids: 2 },
            ],
          },
          {
            id: 'usage', type: 'choice', optional: true, label: 'Où sera-t-elle utilisée ?',
            aide: 'À l’étranger : apostille ou traduction requise.',
            options: [
              { id: 'qc_canada', label: 'Québec / Canada', add: 0, poids: 0 },
              { id: 'etranger', label: 'À l’étranger', add: 150, poids: 1 },
            ],
          },
          { id: 'langue', type: 'flag', optional: true, label: 'En anglais / traduction', aide: 'Version anglaise ou traduite requise.', add: 100, poids: 1 },
        ],
      },
      documents: [
        { id: 'piece_identite', nom: 'Pièce d’identité avec photo', aide: 'Permis de conduire, passeport ou carte d’assurance maladie valide.' },
      ],
      champs: [
        { id: 'mandataire', label: 'Personne mandatée', aide: 'Nom complet de la personne qui pourra agir en votre nom.' },
        { id: 'portee', label: 'Portée de la procuration', aide: 'Générale (tous vos biens) ou spéciale. Écrivez « aucune limite » si générale.' },
        { id: 'duree', label: 'Durée ou échéance', aide: 'Jusqu’à quand la procuration doit valoir. Écrivez « indéterminée » si sans fin prévue.' },
      ],
    },
    {
      id: 'refinancement',
      nom: 'Refinancement hypothécaire',
      // Refinancement is priced well above the other acts: it is the most work
      // (loan act + hypothec publication + title/certificate review) and carries
      // real value at stake, so the floor starts at 2000 $ and rises with the
      // loan value below.
      prixDepart: 2000,
      description:
        'Acte de prêt et publication de l’hypothèque lors d’un refinancement.',
      pricing: {
        base: 2000,
        criteria: [
          {
            id: 'valeur_pret', type: 'bracket', required: true, label: 'Montant du nouveau prêt', aide: 'Le montant du refinancement.', unit: '$',
            brackets: [
              { max: 300000, add: 0, poids: 0 },
              { max: 600000, add: 150, poids: 0 },
              { max: 1000000, add: 350, poids: 1 },
              { max: null, add: 600, poids: 1 },
            ],
          },
          {
            id: 'succession', type: 'choice', required: true, label: 'La propriété fait-elle partie d’une succession ?',
            aide: 'Héritiers, liquidateur : dossier nettement plus complexe.',
            options: [
              { id: 'non', label: 'Non', add: 0, poids: 0 },
              { id: 'oui', label: 'Oui', add: 400, poids: 2 },
            ],
          },
          {
            id: 'approbation_bancaire', type: 'choice', required: true, label: 'Approbation bancaire',
            aide: 'Où en êtes-vous avec le prêteur ? Sans instructions, le notaire ne peut signer à la date visée.',
            options: [
              { id: 'obtenue', label: 'Obtenue', add: 0, poids: 0 },
              { id: 'en_cours', label: 'En cours', add: 100, poids: 1 },
              { id: 'non', label: 'Pas encore', add: 200, poids: 2 },
            ],
          },
          { id: 'coemprunteur', type: 'flag', optional: true, label: 'Co-emprunteur / indivision', aide: 'Plus de deux propriétaires inscrits.', add: 150, poids: 1 },
          {
            id: 'assurance_habitation', type: 'choice', optional: true, label: 'Assurance habitation à jour ?',
            aide: 'Le prêteur exige une assurance en vigueur (feu, dégât d’eau, foudre…). Sans elle, le refinancement ne peut se conclure.',
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
        { id: 'adresse', label: 'Adresse de l’immeuble', aide: 'Adresse civique complète de la propriété refinancée.' },
        { id: 'preteur', label: 'Prêteur', aide: 'Le nom de l’institution qui accorde le nouveau prêt.' },
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

  function computeBasePrice(serviceId, answers) {
    const svc = serviceById(serviceId);
    if (!svc) return null;
    if (!svc.pricing) return svc.prixDepart;
    answers = answers || {};
    let price = Number(svc.pricing.base) || svc.prixDepart || 0;
    for (const c of svc.pricing.criteria || []) price += criterionAdd(c, answers[c.id]);
    return Math.max(0, Math.round(price));
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
      return opt ? criterion.label + ' : ' + opt.label : criterion.label;
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
    }
    return missing;
  }

  // --- Timing tiers ----------------------------------------------------------
  // The tier is derived from how many days away the requested signing date is.
  // It is the axis that makes the public calendar meaningful: closer date,
  // higher tier, higher premium the market will bear. Order matters (ascending
  // urgency) and is relied on by the UI legend.
  const TIERS = [
    { id: 'standard',    nom: 'Standard',    maxJours: null, apercuMin: 1.0, apercuMax: 1.2 },
    { id: 'rapide',      nom: 'Rapide',      maxJours: 14,   apercuMin: 1.2, apercuMax: 1.5 },
    { id: 'prioritaire', nom: 'Prioritaire', maxJours: 7,    apercuMin: 1.6, apercuMax: 2.2 },
    { id: 'urgence',     nom: 'Urgence',     maxJours: 3,    apercuMin: 2.5, apercuMax: 4.0 },
    { id: 'extreme',     nom: 'Extrême',     maxJours: 1,    apercuMin: 4.0, apercuMax: 10.0 },
  ];

  function tierById(id) {
    return TIERS.find((t) => t.id === id) || null;
  }

  // Days away -> tier id. 0-1 day = extreme (overnight/weekend rescue),
  // 2-3 = urgence, 4-7 = prioritaire, 8-14 = rapide, 15+ = standard.
  function tierForDays(days) {
    const d = Math.max(0, Math.floor(Number(days)));
    if (d <= 1) return 'extreme';
    if (d <= 3) return 'urgence';
    if (d <= 7) return 'prioritaire';
    if (d <= 14) return 'rapide';
    return 'standard';
  }

  // --- Premium cap -----------------------------------------------------------
  // A client may offer up to 10x the service's starting price. The cap is a
  // product rule, enforced identically on the client and, authoritatively, on
  // the server.
  const PREMIUM_CAP = 10;

  // --- Offer statuses --------------------------------------------------------
  const STATUS = { OUVERTE: 'ouverte', RETENUE: 'retenue' };

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
        errors.push({ code: 'parametre_requis', param: m.id, message: `Réponse requise : ${m.label}.` });
      }
    }

    // Courriel is OPTIONAL (used only for private notifications, never shown on
    // the public carnet). An empty/absent value is fine; a non-empty value must
    // look like an email.
    const courrielRaw = input.courriel == null ? '' : String(input.courriel).trim();
    if (courrielRaw !== '' && !isEmail(courrielRaw)) {
      errors.push({ code: 'courriel_invalide', message: 'Le courriel n’est pas valide.' });
    }

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
    };
  }

  // --- Ranking ---------------------------------------------------------------
  // A bid's rank among the open bids on the same day for the same service,
  // highest amount first. Powers the "3e sur 7" scarcity signal.
  function rankOf(bid, bids) {
    const peers = bids
      .filter((b) => b.dateISO === bid.dateISO && b.serviceId === bid.serviceId && b.status !== STATUS.RETENUE)
      .sort((a, b) => b.montant - a.montant || String(a.id).localeCompare(String(b.id)));
    const total = peers.length;
    const idx = peers.findIndex((b) => b.id === bid.id);
    return { rang: idx < 0 ? null : idx + 1, total };
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

  function clampMontant(svc, montant) {
    const min = svc.prixDepart;
    const max = svc.prixDepart * PREMIUM_CAP;
    return Math.min(max, Math.max(min, montant));
  }

  // Plausible mandatory-param answers for a demo fixture, so it validates and
  // shows a realistic mix of simple/standard/complexe cases on the carnet.
  function fixturePricing(svc, rng) {
    if (svc.id === 'testament') return { who_for: rng() > 0.6 ? 'couple' : 'solo', fiducie_needed: rng() > 0.82 ? 'oui' : 'non' };
    if (svc.id === 'procuration') return { scope: rng() > 0.5 ? 'generale' : 'specifique', realEstate: rng() > 0.72 ? 'oui' : 'non' };
    if (svc.id === 'refinancement') {
      return {
        valeur_pret: 150000 + Math.floor(rng() * 700000),
        succession: rng() > 0.85 ? 'oui' : 'non',
        approbation_bancaire: ['obtenue', 'en_cours', 'non'][Math.floor(rng() * 3)],
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
  // the service floor (rounded to $5, clamped to [floor, 10× floor]). The UI
  // pre-fills this so a client can book with one tap instead of a decision.
  function recommendedAmount(serviceId, dateISO, todayISO, answers) {
    const svc = serviceById(serviceId);
    if (!svc || !isISODate(dateISO)) return null;
    const days = isISODate(todayISO) ? Math.max(0, daysBetween(todayISO, dateISO)) : 0;
    const t = tierById(tierForDays(days));
    const mult = (t.apercuMin + t.apercuMax) / 2;
    // Anchor the recommendation on the DYNAMIC base (with the client's pricing
    // answers), so a more complex act recommends a proportionally higher offer.
    const base = computeBasePrice(serviceId, answers);
    const min = base;
    const max = base * PREMIUM_CAP;
    return Math.min(max, Math.max(min, Math.round((base * mult) / 5) * 5));
  }

  // --- Lead qualification ----------------------------------------------------
  // A lead is "sellable" to a notary only once the client has assembled every
  // required document and field for the service AND consented to share the
  // dossier with the notary who retains the request. Identity verification
  // itself is performed by the notary at signing (in person / by video, per
  // Québec rules) — Nota collects the ID document, it does not verify identity.
  // `saved` is the per-service intake map; consent is stored under `__consent`.
  function leadReadiness(serviceId, saved) {
    saved = saved || {};
    const svc = serviceById(serviceId);
    if (!svc) return { total: 0, done: 0, missing: [], consent: false, ready: false };
    const items = svc.documents
      .map((d) => ({ id: d.id, nom: d.nom }))
      .concat(svc.champs.map((c) => ({ id: c.id, nom: c.label })));
    const missing = items.filter((it) => !saved[it.id]).map((it) => it.nom);
    const consent = !!saved.__consent;
    return {
      total: items.length,
      done: items.length - missing.length,
      missing,
      consent,
      ready: missing.length === 0 && consent,
    };
  }

  // --- Reminder schedule -----------------------------------------------------
  // The cadence at which an open lead's client is reminded that their signing
  // date is approaching, expressed as whole days BEFORE the date. Closer dates
  // convert faster, so the nudges tighten as the day nears. This is a business
  // rule — the API scheduler encodes nothing itself, it just asks the domain
  // which reminders are due today for a given bid.
  const REMINDER_OFFSETS = [7, 3, 1];

  // The kinds of reminder a bid can be due for. j7/j3/j1 are the date-approaching
  // nudges (one per offset). dossier_incomplet is the "finish your file" nudge,
  // the #1 conversion lever, and is due whenever an open lead is known to be
  // incomplete (bid.dossierReady === false) — a hook the app can flip on.
  const REMINDER_KINDS = {
    J7: 'j7',
    J3: 'j3',
    J1: 'j1',
    DOSSIER_INCOMPLET: 'dossier_incomplet',
  };

  // Map a day-offset to its date-approaching kind, or null when no reminder
  // falls on that exact day.
  function reminderKindForDays(days) {
    if (days === 7) return REMINDER_KINDS.J7;
    if (days === 3) return REMINDER_KINDS.J3;
    if (days === 1) return REMINDER_KINDS.J1;
    return null;
  }

  // Which reminder kinds are due for `bid` as of `todayISO`. Pure and
  // deterministic — the same inputs always yield the same array. A retained bid
  // (already taken by a notary) and a bid whose signing date has passed are
  // never due for anything. The sender is responsible for idempotency
  // (not sending the same kind twice); this only says what is due.
  function dueReminders(bid, todayISO) {
    const due = [];
    if (!bid || bid.status === STATUS.RETENUE) return due;
    if (!isISODate(bid.dateISO) || !isISODate(todayISO)) return due;

    const days = daysBetween(todayISO, bid.dateISO);
    if (days < 0) return due; // the signing date is already past

    const dateKind = reminderKindForDays(days);
    if (dateKind) due.push(dateKind);

    // Dossier-incompletion hook: an open lead we know to be incomplete gets a
    // "finish your file" nudge. Kept separate from the date cadence so it can
    // fire independently; the sender's SENT ledger prevents daily repeats.
    if (bid.dossierReady === false) due.push(REMINDER_KINDS.DOSSIER_INCOMPLET);

    return due;
  }

  // --- Public label helpers --------------------------------------------------
  // How a bid identifies itself on the public carnet: the chosen name, or the
  // postal prefix for anonymous bids ("Client · G1R").
  function bidLabel(bid) {
    if (!bid.anonyme && bid.nom) return bid.nom;
    return 'Client · ' + (bid.prefixe || '—');
  }

  return {
    money,
    SERVICES,
    serviceById,
    computeBasePrice,
    complexity,
    missingRequired,
    TIERS,
    tierById,
    tierForDays,
    PREMIUM_CAP,
    STATUS,
    isISODate,
    isEmail,
    daysBetween,
    addDays,
    validateOffer,
    rankOf,
    makeFixtures,
    bidLabel,
    leadReadiness,
    recommendedAmount,
    REMINDER_OFFSETS,
    REMINDER_KINDS,
    reminderKindForDays,
    dueReminders,
    FIXTURE_SEED,
  };
});
