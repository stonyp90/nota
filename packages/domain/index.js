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
      pricing: {
        base: 650,
        criteria: [
          { id: 'couple', type: 'flag', label: 'Pour un couple (deux testaments miroirs)', aide: 'Deux testaments coordonnés plutôt qu’un seul.', add: 350 },
          { id: 'enfants_mineurs', type: 'flag', label: 'Enfants mineurs (clause de tutelle)', aide: 'Ajoute la désignation d’un tuteur au testament.', add: 75 },
          { id: 'entreprise_fiducie', type: 'flag', label: 'Actifs d’entreprise ou fiducie', aide: 'Parts d’entreprise, fiducie ou actifs à structurer.', add: 250 },
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
            id: 'portee', type: 'choice', label: 'Portée', aide: 'Une procuration générale couvre l’ensemble de vos biens.',
            options: [
              { id: 'speciale', label: 'Spéciale', add: 0 },
              { id: 'generale', label: 'Générale', add: 40 },
            ],
          },
          { id: 'protection', type: 'flag', label: 'Mandat de protection (inaptitude)', aide: 'Un mandat qui prend effet si vous devenez inapte.', add: 150 },
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
      prixDepart: 950,
      description:
        'Acte de prêt et publication de l’hypothèque lors d’un refinancement.',
      pricing: {
        base: 950,
        criteria: [
          {
            id: 'valeur_pret', type: 'bracket', label: 'Valeur du prêt', aide: 'Le montant du nouveau financement.', unit: '$',
            brackets: [
              { max: 300000, add: 0 },
              { max: 600000, add: 150 },
              { max: null, add: 350 },
            ],
          },
          { id: 'coemprunteur', type: 'flag', label: 'Co-emprunteur', aide: 'Une seconde personne inscrite au prêt.', add: 75 },
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
      const montant = clampMontant(svc, Math.round((svc.prixDepart * mult) / 5) * 5);
      const anonyme = rng() > 0.35;
      const retenue = rng() > 0.8;
      bids.push({
        id: 'fx-' + i,
        serviceId: svc.id,
        dateISO,
        montant,
        tier,
        premium: montant / svc.prixDepart,
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
