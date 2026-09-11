'use strict';

const {
  monthOf,
  STATS_GAUGE_PK,
  STATS_GAUGE_SK,
  audienceGroupSK,
  consentJournalPK,
  consentJournalSK,
  notifPK,
  notifSK,
  notifSubject,
  subjectJournalPK,
  subjectJournalSK,
  campaignRecipientsPK,
  campaignRecipientSK,
  clientIndexPK,
  clientBidSK,
  erasurePK,
  ordreCles,
  exigerInstantDeLecture,
  bidTtl,
  notifTtl,
  NOTIF_PAGE_MAX,
  SUBJECT_PAGE_MAX,
  CAMPAIGN_PAGE_MAX,
  CONSENT_PAGE_MAX,
  CLIENT_BID_PAGE_MAX,
  encodeCursor,
  decodeCursor,
  auditPK,
  auditSK,
  learningSignalPK,
  learningSignalSK,
} = require('./keys');
const { randomUUID } = require('node:crypto');
const { STATUS, normalizeReferralCode, auditRetentionTtl, isOfferExpired } = require('@nota/domain');
// ADR 0034 — la forme stockée d'une grille de prix, définie une seule fois pour
// les deux adaptateurs de persistance.
const prixNotaConfig = require('./prix-nota-config');

/**
 * In-memory implementation of the Repo port. Used by the test suite and by the
 * local dev server when no DynamoDB endpoint is configured. Same interface as
 * repo-dynamo.js — the handler cannot tell them apart.
 */
function createMemoryRepo(seed = []) {
  const calendarConnections = new Map();
  const byId = new Map();
  for (const b of seed) byId.set(b.id, b);

  // Billing state lives in the same conceptual table (see keys.js): notary
  // subscription profiles keyed by id, and a set of processed webhook event ids
  // for idempotency.
  const byNotary = new Map();
  const events = new Map();
  const notaryAIPayments = new Map();
  const acts = new Map(); // bidId -> completed-act record (idempotency ledger)
  const partners = new Map(); // CODE -> registered referral partner (ADR 0011)
  const referralEarnings = new Map(); // `${CODE}#${TRACK}#${refId}` -> durable earning event
  const supportThreads = new Map(); // threadId -> live support thread (ADR 0026)
  const signingSessions = new Map(); // dedicated, bounded rehearsal records; never public bid data
  const salles = new Map(); // bidId -> séance de signature (ADR 0047)

  // Notification ledgers: sent (idempotency) and unsubscribe (suppression).
  const notificationPreferences = new Map();
  const emailLanguages = new Map();
  // ADR 0051 — le consentement au texto, par destinataire (clé = courriel).
  const smsConsents = new Map(); // lowercased email -> { telephone, consent, at }
  const notified = new Map(); // `${refId}#${kind}` -> timestamp
  const unsubscribed = new Set(); // lowercased emails

  // Admin-editable email subject overrides (ADR 0018): one record per template
  // key, mirroring the CONFIG#EMAIL / TPL#<key> partition on the main table.
  const emailOverrides = new Map(); // templateKey -> { key, enabled, subjectFr, subjectEn, updatedAt }

  // Groupes d'administrateurs (RBAC découplé) : les utilisateurs appartiennent
  // à des groupes, et les groupes attachent des groupes de permissions. Les
  // deux collections sont séparées pour qu'un paquet de permissions soit
  // réutilisable sans recopier les clés sur chaque groupe.
  const groupes = new Map(); // id -> { id, nom, description, groupesPermissions[], permissions[], updatedAt }
  const groupesPermissions = new Map(); // id -> { id, nom, description, permissions[], updatedAt }
  const cabinets = new Map(); // id -> { id, nom, planId, notaires[], ... }

  // Campagnes ciblées (segments.js). TROIS registres distincts, et la distinction
  // porte : `audienceGroupes` est une liste de DESTINATAIRES — rien à voir avec
  // `groupes` juste au-dessus, qui réunit des permissions d'administrateurs.
  const audienceGroupes = new Map(); // id -> { id, libelle, audience, nature, membres[] }
  const consentements = new Map(); // courriel -> { email, base, at, source }
  const campagnes = new Map(); // courriel -> { email, at, campagneId }
  const courriel = (e) => String(e == null ? '' : e).trim().toLowerCase();

  // Les sept registres de persistance (voir keys.js). Chacun est une Map de
  // partitions, dont chaque partition est elle-même une Map indexée par la CLÉ
  // DE TRI — pas un tableau : c'est la clé qui porte l'unicité côté DynamoDB,
  // et l'adaptateur mémoire doit refuser exactement les mêmes doublons.
  //
  // Et la Map de partitions est indexée par la CLÉ DE PARTITION elle-même
  // (`consentJournalPK(...)`, `notifPK(...)`, …), pas par l'adresse nue. Ce
  // n'est pas cosmétique : c'est ce qui fait que le REFUS porté par la clé —
  // une valeur vide vaudrait un seau commun — s'applique ici aussi. Une Map
  // indexée par l'adresse nue contournait la clé, et rangeait sous `''` ce que
  // l'autre adaptateur refusait d'écrire.
  const consentJournal = new Map(); // CONSENT#<courriel> -> Map(sk -> événement)
  const avis = new Map(); // NOTIF#<sujet> -> Map(sk -> avis en application)
  const sujetJournal = new Map(); // SUJET#<sujet> -> Map(sk -> événement)
  const campagneDestinataires = new Map(); // CAMPAGNE#<id> -> Map(sk -> destinataire)
  const clientOffres = new Map(); // CLIENT#<courriel> -> Map(sk -> pointeur d'offre)
  const effacements = new Map(); // ERASURE#<courriel> -> { courriel, at }

  // Une partition qui n'existe pas encore se lit vide — jamais `undefined`.
  const partition = (registre, cle) => {
    const k = String(cle);
    if (!registre.has(k)) registre.set(k, new Map());
    return registre.get(k);
  };
  // L'ordre d'une partition est celui des OCTETS (keys.ordreCles), pas celui de
  // `localeCompare` : c'est l'ordre de DynamoDB, et c'est aussi celui que la
  // reprise de curseur compare. Deux ordres différents ici, et la pagination
  // reprend au mauvais endroit — la même page indéfiniment, la fin de la
  // partition jamais rendue. Il suffit d'un « - », d'un « . » ou d'un « _ »
  // dans une adresse, c'est-à-dire de presque toutes.
  const triees = (registre, cle) =>
    [...(registre.get(String(cle)) || new Map()).entries()].sort((a, b) => ordreCles(a[0], b[0]));
  // Écriture unique : la seconde écriture de la même clé est REFUSÉE, elle
  // n'écrase rien — miroir exact de `attribute_not_exists` côté DynamoDB.
  const ajoutUnique = (registre, cle, sk, item) => {
    const part = partition(registre, cle);
    if (part.has(sk)) return false;
    part.set(sk, item);
    return true;
  };
  const borne = (limit, max) => {
    const n = Number(limit);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : max;
  };
  // La projection d'état courant du consentement. Une seule écriture pour deux
  // portes : `putEmailConsent` (l'état, écrit directement) et
  // `appendConsentEvent` (le journal, qui rafraîchit l'index de lecture).
  function majProjectionConsentement(email, consent) {
    const item = {
      email: courriel(email),
      base: (consent && consent.base) || null,
      at: (consent && consent.at) || null,
      source: (consent && consent.source) || null,
    };
    consentements.set(item.email, item);
    return item;
  }
  // La même écriture, mais GARDÉE PAR L'INSTANT : la projection doit suivre le
  // dernier ÉVÉNEMENT, pas la dernière écriture. Un rejeu tardif, un backfill
  // ou deux Lambdas concurrentes présentent les événements dans le désordre —
  // sans cette garde, un octroi arrivé après coup ressuscite un consentement
  // retiré, et `segments.js` (qui ne lit que la projection) démarche à nouveau
  // quelqu'un qui s'est retiré. Miroir exact de la ConditionExpression
  // `#at <= :at` côté DynamoDB.
  function projeterConsentement(email, consent) {
    const adresse = courriel(email);
    const actuel = consentements.get(adresse);
    const nouvelInstant = consent && consent.at ? String(consent.at) : null;
    if (actuel && actuel.at && nouvelInstant && String(actuel.at) > nouvelInstant) return actuel;
    return majProjectionConsentement(adresse, consent);
  }
  // Le dernier fait du journal : l'instant mène la clé de tri, donc c'est la
  // dernière entrée. Sert à la reprise — réconcilier une projection restée en
  // arrière demande de savoir ce que le journal, lui, porte déjà.
  function dernierEvenementConsentement(adresse) {
    const rangees = triees(consentJournal, consentJournalPK(adresse));
    return rangees.length ? rangees[rangees.length - 1][1] : null;
  }

  // Notary console: declines (per notary+bid) and retained pointers (per notary).
  const declines = new Set(); // `${notaryId}#${bidId}`
  const retained = new Map(); // `${notaryId}#${bidId}` -> { id, dateISO, serviceId, montant }

  // The notary's anonymized evaluation ledger (ADR 0021), mirroring the
  // NOTARY#<id> / EVAL#<createdAt>#<bidId> items on the main table.
  const notaryEvals = new Map(); // notaryId -> [{ bidId, dateISO, serviceId, note, commentaire, createdAt }]

  // Le prix de Nota décidé par Nota (ADR 0031), reflet de l'unique item
  // CONFIG#PRIX / PRIX. Null tant que Nota n'en a stocké aucun.
  let prixCfg = null;

  // The admin-decided cancellation fee barème (ADR 0023), mirroring the single
  // CONFIG#ANNULATION / BAREME item. Null until Nota stores one.
  let cancellationCfg = null;

  // The daily customer-experience controller's single bounded policy record.
  // It is intentionally separate from pricing and legal configuration: the
  // autonomous worker can change guidance without gaining a door to either.
  let experienceCfg = null;

  // Notary magic-link login: single-use challenges (main table) and a per-IP
  // login rate-limit counter, kept apart from the admin equivalents above so an
  // admin and a notary challenge can never be confused.
  const notaryChallenges = new Map(); // challengeId -> record
const clientChallenges = new Map(); // challengeId -> record (lien magique client)
  const notaryRateCounters = new Map(); // `${scope}#${key}#${windowStart}` -> count

  // Partner code claim (email verification): single-use claim challenges and a
  // per-IP request rate-limit counter — kept apart from the notary equivalents
  // so a notary and a partner challenge can never be confused (ADR 0011).
  const partnerClaims = new Map(); // challengeId -> pending claim record
  const partnerRateCounters = new Map(); // `${scope}#${key}#${windowStart}` -> count

  // Analytics rollups (STATS#): counter items keyed by `${pk}\x00${sk}`.
  const stats = new Map();
  const statKey = (pk, sk) => `${pk}\x00${sk}`;

  // Admin table: identities, single-use login challenges, revocable sessions,
  // the append-only audit log, and rate-limit counters.
  const admins = new Map(); // adminId -> profile
  const crmLeads = new Map(); // bidId -> operator workflow metadata
  const challenges = new Map(); // challengeId -> record
  const sessions = new Map(); // sessionId -> record
  // Les clés déjà écrites des flux append-only (audit, transactions, signaux
  // d'apprentissage), par table. repo-dynamo.js pose chacune de ces lignes
  // avec `ConditionExpression: 'attribute_not_exists(PK) OR
  // attribute_not_exists(SK)'` (appendTxAudit, appendAudit,
  // appendLearningSignal) et AVALE la ConditionalCheckFailedException dans
  // le `.catch` qui suit — « never let audit block » : la collision est
  // SILENCIEUSE pour l'appelant, et la PREMIÈRE ligne reste. C'est la promesse
  // append-only de l'ADR 0036. Un `push` nu ici la rendait invisible à toute
  // la pyramide de tests : une clé rejouée faisait deux lignes en mémoire, une
  // seule en production.
  //
  // La table fait partie de la clé parce que les trois flux vivent dans DEUX
  // tables là-bas (transactions et signaux dans la principale, gestes admin
  // dans la table admin) : une même (jour, ts, id) posée dans chacune n'y
  // entre pas en collision.
  const dejaEcrit = new Set();
  function poserUneFois(table, flux, pk, sk, entry) {
    // Le seau du journal est le JOUR OUVRABLE québécois quand l'appelant le
    // nomme (le handler public le fait : un règlement du soir appartient à la
    // journée d'affaires en cours, pas au lendemain UTC) ; sinon, la date de
    // l'horodatage. L'instant, lui, reste toujours vrai. Même règle que
    // repo-dynamo (`day = entry.day || ts.slice(0, 10)`) — le jour compose la
    // clé, donc deux entrées qui le nomment ou le déduisent visent la même.
    const day = entry.day || String(entry.ts || '').slice(0, 10);
    const cle = table + '|' + pk(day) + '|' + sk(entry.ts, entry.id);
    if (dejaEcrit.has(cle)) return; // collision avalée, comme là-bas
    dejaEcrit.add(cle);
    // La borne de conservation (sept ans — politique §1) est posée ICI comme
    // dans l'adaptateur DynamoDB : si elle ne vivait que là-bas, les tests
    // mentiraient sur la production. Rien n'est posé quand l'appelant a déjà
    // décidé, ni quand l'horodatage est illisible.
    const ttl = entry.ttl != null ? entry.ttl : auditRetentionTtl(Date.parse(entry.ts || ''));
    flux.push({ ...entry, day, ...(ttl == null ? {} : { ttl }) });
  }
  const audit = []; // { id, ts, action, adminId, email, ip, meta }
  const learningSignals = []; // minimized notary-learning events, separate from transaction audit
  const rateCounters = new Map(); // `${scope}#${key}#${windowStart}` -> count

  const oauthTickets = new Map();
  const oauthIdentities = new Map();
  return {
    // Memory mode exposes both surfaces through one process, so its admin
    // records are available to the local admin seed as well.
    adminTableConfigured: true,
    async getSigningSession(bidId) {
      const value = signingSessions.get(bidId);
      return value ? structuredClone(value) : null;
    },
    async compareAndSetSigningSession(bidId, expectedRevision, value) {
      const current = signingSessions.get(bidId);
      const bid = byId.get(bidId);
      if ((current ? current.revision : 0) !== expectedRevision || !bid || bid.dateISO !== value.dateISO ||
          bid.status !== STATUS.RETENUE || bid.notaryId !== value.notaryId) return false;
      signingSessions.set(bidId, structuredClone(value));
      return true;
    },
    async putOAuthTicket(id, value) { oauthTickets.set(id, structuredClone(value)); },
    async consumeOAuthTicket(id, purpose, binding, nowMs) {
      const value = oauthTickets.get(id);
      if (!value || value.consumed || value.expiresAt <= nowMs || value.purpose !== purpose || value.binding !== binding) return null;
      value.consumed = true;
      return structuredClone(value);
    },
    async getOAuthIdentity(subject) { return structuredClone(oauthIdentities.get(subject) || null); },
    async putOAuthIdentity(subject, value) {
      if (oauthIdentities.has(subject)) return false;
      oauthIdentities.set(subject, structuredClone(value)); return true;
    },
    async getCalendar(owner) { return structuredClone(calendarConnections.get(owner) || null); },
    async compareAndSetCalendar(owner, revision, value) {
      if ((calendarConnections.get(owner)?.revision || null) !== revision) return false;
      calendarConnections.set(owner, structuredClone(value));
      return true;
    },
    async listByMonth(month) {
      return [...byId.values()]
        .filter((b) => monthOf(b.dateISO) === month)
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || String(a.id).localeCompare(String(b.id)));
    },
    // Same contract as repo-dynamo.get(id, dateISO) — which THROWS without a
    // date (`if (!dateISO) throw new Error('dynamo get requires dateISO for
    // the key')`) because the date composes the key: PK = BID#<month>,
    // SK = BID#<dateISO>#<id>. A caller that forgets the date, or sends it
    // under another name, passed here and fell to a 500 in production (BDD
    // audit, 2026-09-11). And a date that is not the offer's reads ANOTHER
    // key over there — no Item, `fromItem(undefined)` → null — so it is null
    // here too, never a lookup by id alone.
    async get(id, dateISO) {
      if (!dateISO) throw new Error('memory get requires dateISO for the key');
      const b = byId.get(id);
      return b && b.dateISO === dateISO ? b : null;
    },
    async put(bid) {
      byId.set(bid.id, bid);
      return bid;
    },
    async saveFinancingPreparation(bid, owner, analysis, expectedId = null, expectedReviewAt = null) {
      const current = byId.get(bid.id);
      if (!current || current.dateISO !== bid.dateISO || current.status !== STATUS.RETENUE || current.notaryId !== owner ||
        (current.financingAnalysis?.id || null) !== expectedId ||
        (current.financingAnalysis?.review?.reviewedAt || null) !== expectedReviewAt) return null;
      const next = { ...current, financingAnalysis: structuredClone(analysis) };
      byId.set(bid.id, next);
      return next.financingAnalysis;
    },
    async reviewFinancingPreparation(bid, owner, analysisId, review) {
      const current = byId.get(bid.id);
      if (!current || current.dateISO !== bid.dateISO || current.status !== STATUS.RETENUE || current.notaryId !== owner ||
        current.financingAnalysis?.id !== analysisId || current.financingAnalysis.review) return null;
      const analysis = { ...current.financingAnalysis, review: structuredClone(review) };
      byId.set(bid.id, { ...current, financingAnalysis: analysis });
      return analysis;
    },
    async saveActPreparation(bid, owner, analysis, expectedId = null, expectedReviewAt = null) {
      const current = byId.get(bid.id);
      if (!current || current.dateISO !== bid.dateISO || current.status !== STATUS.RETENUE || current.notaryId !== owner ||
        (current.actAnalysis?.id || null) !== expectedId || (current.actAnalysis?.review?.reviewedAt || null) !== expectedReviewAt) return null;
      const next = { ...current, actAnalysis: structuredClone(analysis) };
      byId.set(bid.id, next);
      return next.actAnalysis;
    },
    async reviewActPreparation(bid, owner, analysisId, review) {
      const current = byId.get(bid.id);
      if (!current || current.dateISO !== bid.dateISO || current.status !== STATUS.RETENUE || current.notaryId !== owner ||
        current.actAnalysis?.id !== analysisId || current.actAnalysis.review) return null;
      const analysis = { ...current.actAnalysis, review: structuredClone(review) };
      byId.set(bid.id, { ...current, actAnalysis: analysis });
      return analysis;
    },
    // General overwrite of a mutated bid (propositions, demandes, dossier).
    // Same full-item semantics as put(); kept as its own method so the
    // handler's intent reads clearly. LIMITATION: last-writer-wins — two
    // notaries proposing on the same bid at the same instant could drop one
    // proposition. `retain()` est conditionnel, mais cela ne protège que
    // l'écriture : un appelant qui a lu l'offre avant la retenue peut encore
    // réécrire sa photo par-dessus (voir repo-dynamo.update).
    async update(bid) {
      byId.set(bid.id, bid);
      return bid;
    },
    // Poser UN horodatage de lecture, sans réécrire l'item. Un accusé « Vu »
    // part à chaque ouverture du fil, à partir d'une photo lue juste avant :
    // le repasser par update() rejouait cette photo par-dessus l'état courant
    // et pouvait dé-retenir un acte qu'un notaire venait de prendre. On lit
    // donc l'état COURANT et on n'y touche qu'au champ demandé. Miroir de
    // l'UpdateCommand de repo-dynamo.
    async markThreadRead(bid, side, at) {
      const id = bid && bid.id;
      const current = id ? byId.get(id) : null;
      if (!current) return null;
      const champ = side === 'notaire' ? 'luParNotaireAt' : 'luParClientAt';
      const next = { ...current, [champ]: at };
      byId.set(id, next);
      return next;
    },
    // Conditional retain: flip a bid to RETENUE for `notaryId` ONLY while it is
    // still OUVERTE, atomically storing the calendar pointer like DynamoDB. Returns the
    // stored bid on success, or null if another notary already retained it
    // (the TOCTOU loser). `bid` is the fully-formed retained item.
    async retain(bid, notaryId, todayISO) {
      const current = byId.get(bid.id);
      if (!current || current.status !== STATUS.OUVERTE || (todayISO && isOfferExpired(current, todayISO))) return null;
      byId.set(bid.id, bid);
      retained.set(`${notaryId}#${bid.id}`, {
        id: bid.id, dateISO: bid.dateISO, serviceId: bid.serviceId, montant: bid.montant,
      });
      return bid;
    },
    // Every open bid across all months — the reminder scheduler asks the
    // domain which of these are due for a reminder today. Open means neither
    // retained NOR cancelled (domain.isOpenBid): the dynamo adapter serves the
    // same set from a sparse GSI1 Query that drops both, and a cancelled offer
    // must never reach the notary digest; here it is a filter.
    async listOpenBids() {
      return [...byId.values()].filter((b) => b.status !== STATUS.RETENUE && b.status !== STATUS.ANNULEE);
    },

    // --- Pay-on-accept authorization ----------------------------------------
    // The Stripe webhook binds the client's authorized PaymentIntent to the bid
    // (offer goes live), or voids the hold if the authorization lapsed before any
    // notary accepted. `dateISO` matches the dynamo composite-key signature.
    async authorizeBid(bidId, dateISO, patch) {
      void dateISO;
      const b = byId.get(bidId);
      if (!b) return null;
      const updated = {
        ...b,
        paymentStatus: 'authorized',
        paymentIntentId: (patch && patch.paymentIntentId) || b.paymentIntentId || null,
        authorizedAt: (patch && patch.authorizedAt) || b.authorizedAt || null,
        // ADR 0035 — a caution that IS placed erases the memory of a refusal:
        // the fact was true yesterday and is not today.
        cautionRefus: null,
      };
      byId.set(bidId, updated);
      return updated;
    },

    // --- ADR 0035: the registered card ---------------------------------------
    // The client finished the SETUP checkout: their card is validated and saved
    // on a Stripe Customer, but NOTHING is held — the caution itself is placed
    // at J-CAUTION_LEAD_DAYS.
    async registerBidPaymentMethod(bidId, dateISO, patch) {
      void dateISO;
      const b = byId.get(bidId);
      if (!b) return null;
      const p = patch || {};
      // NEVER demote a more advanced state: a late delivery of the setup event
      // must not erase a caution already placed ('authorized'), a lapsed offer
      // ('void') or one awaiting re-authorization ('a_reautoriser').
      const avance = !!b.paymentStatus && b.paymentStatus !== 'pending' && b.paymentStatus !== 'enregistre';
      const updated = {
        ...b,
        paymentStatus: avance ? b.paymentStatus : 'enregistre',
        paymentCustomerId: p.customerId || b.paymentCustomerId || null,
        paymentMethodId: p.paymentMethodId || b.paymentMethodId || null,
        setupIntentId: p.setupIntentId || b.setupIntentId || null,
        registeredAt: p.registeredAt || b.registeredAt || null,
      };
      byId.set(bidId, updated);
      return updated;
    },

    // The caution could not be placed (card declined, needs authentication).
    // Recorded ON the offer so the daily gesture knows the parties were already
    // told, and so the console can say why the guarantee is missing.
    async markCautionRefusee(bidId, dateISO, refus) {
      void dateISO;
      const b = byId.get(bidId);
      if (!b) return null;
      const updated = { ...b, cautionRefus: refus || null };
      byId.set(bidId, updated);
      return updated;
    },
    async voidBidAuthorization(bidId, dateISO, patch) {
      void dateISO;
      const b = byId.get(bidId);
      if (!b) return null;
      // Never void a RETAINED bid: after a proposition accept the ORIGINAL hold
      // is canceled (or expires), and Stripe's payment_intent.canceled webhook
      // must not flip the live mise en relation to 'void' and hide it.
      if (b.status === STATUS.RETENUE) return null;
      const updated = { ...b, paymentStatus: 'void', voidedAt: (patch && patch.voidedAt) || null };
      byId.set(bidId, updated);
      return updated;
    },

    // --- Billing (notary subscriptions + webhook idempotency) ---------------
    // Completed-act ledger: write-once, so a re-submitted completion is a no-op
    // (mirrors the DynamoDB attribute_not_exists(PK) guard). markActCompleted
    // returns true only on the FIRST write; getActCompletion returns the record.
    async markActCompleted(bidId, record) {
      if (acts.has(bidId)) return false;
      acts.set(bidId, { ...record });
      return true;
    },
    async getActCompletion(bidId) {
      const a = acts.get(bidId);
      return a ? { ...a } : null;
    },

    // --- Live support threads (ADR 0026) ------------------------------------
    // One record per chat thread, addressed by the id its signed token
    // carries — mirrors the SUPPORT#<id> GetItem in the dynamo adapter.
    async putSupportThread(thread, { expectedRevision } = {}) {
      const current = supportThreads.get(String(thread.id));
      const revision = Number(current && current.supportRevision) || 0;
      if (expectedRevision !== undefined && expectedRevision !== revision) return false;
      const saved = { ...thread, supportRevision: revision + 1 };
      supportThreads.set(String(thread.id), saved);
      return { ...saved };
    },
    async getSupportThread(id) {
      const t = supportThreads.get(String(id));
      return t ? { ...t } : null;
    },
    // --- Salle de signature (ADR 0047) --------------------------------------
    // Same shape as the dynamo adapter, `rev` guard included: the handler
    // read-modify-writes a séance while two peers push ICE candidates at it,
    // and a silently lost candidate is a connection that never comes up.
    async getSalle(bidId) {
      const s = salles.get(String(bidId));
      return s ? JSON.parse(JSON.stringify(s)) : null;
    },
    async putSalle(salle, { ifRev } = {}) {
      const id = String(salle.bidId);
      const courante = salles.get(id);
      if (ifRev !== undefined && (courante ? courante.rev : 0) !== ifRev) {
        const err = new Error('salle_conflit');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      const rev = (courante ? courante.rev || 0 : 0) + 1;
      const stocke = JSON.parse(JSON.stringify({ ...salle, bidId: id, rev }));
      salles.set(id, stocke);
      return JSON.parse(JSON.stringify(stocke));
    },
    // The operator's inbox: the threads whose last message falls in `months`
    // (see keys.supportInboxMonths), newest first, bounded. Mirrors the
    // month-sharded GSI1 overload of the dynamo adapter.
    async listSupportThreads({ months, limit } = {}) {
      const set = new Set(Array.isArray(months) ? months : []);
      const max = Math.max(1, Math.min(500, Number(limit) || 100));
      return [...supportThreads.values()]
        .filter((t) => set.has(String(t.dernierAt || t.createdAt || '').slice(0, 7)))
        .sort((a, b) => String(b.dernierAt || b.createdAt || '').localeCompare(String(a.dernierAt || a.createdAt || '')) || String(b.id).localeCompare(String(a.id)))
        .slice(0, max)
        .map((t) => ({ ...t }));
    },

    // --- Partner referral registry (ADR 0011) -------------------------------
    // One record per NORMALIZED code; write-once, so claiming a taken code
    // returns false (mirrors the DynamoDB attribute_not_exists(PK) guard) and
    // the handler decides between "same owner, idempotent" and 409.
    async createPartner(partner) {
      const code = String(partner.code).trim().toUpperCase();
      if (partners.has(code)) return false;
      partners.set(code, { ...partner, code });
      return true;
    },
    async getPartner(code) {
      const p = partners.get(String(code).trim().toUpperCase());
      return p ? { ...p } : null;
    },
    // Every CLAIMED code, for the admin ledger — a partner with zero referrals
    // is still a row the operator must see. The dynamo adapter serves the same
    // set from the sparse PARTNER GSI1 overload; here it is the whole map.
    async listPartners() {
      return [...partners.values()]
        .map((p) => ({ ...p }))
        .sort((a, b) => a.code.localeCompare(b.code));
    },
    // Durable referral earnings (ADR 0011): the money owed is recorded at EVENT
    // time (the retain), write-once per (code, track, ref) — the key IS the
    // idempotency, mirroring the DynamoDB attribute_not_exists guard. Returns
    // true only on the FIRST write, so the caller knows a replay earned nothing.
    async recordReferralEarning({ code, track, refId, montant, at } = {}) {
      const clean = normalizeReferralCode(code);
      const key = `${clean}#${String(track).toUpperCase()}#${refId}`;
      if (referralEarnings.has(key)) return false;
      referralEarnings.set(key, { code: clean, track, refId, montant, at });
      return true;
    },
    // All earnings ever recorded — the ledger's durable truth. Bounded by the
    // number of real-money events, never a table walk (sparse GSI1 in dynamo).
    async listReferralEarnings() {
      return [...referralEarnings.values()]
        .map((e) => ({ ...e }))
        .sort((a, b) => a.code.localeCompare(b.code) || String(a.refId).localeCompare(String(b.refId)));
    },
    async putNotary(notary) {
      byNotary.set(notary.id, { ...notary });
      return notary;
    },
    // AI entitlement is a separate, revisioned sub-document on the notary
    // profile. Keeping the compare-and-set here makes a concurrent first-use
    // request consume one unit, never two.
    async updateNotaryAI(notaryId, aiAccess, expectedRevision = 0) {
      const current = byNotary.get(notaryId);
      if (!current) return false;
      const currentRevision = Number(current.aiAccess && current.aiAccess.revision) || 0;
      if (currentRevision !== Number(expectedRevision) || Number(aiAccess.revision) !== currentRevision + 1) return false;
      byNotary.set(notaryId, { ...current, aiAccess: structuredClone(aiAccess) });
      return true;
    },
    async applyNotaryAIPayment(notaryId, paymentId, aiAccess, expectedRevision = 0, at = null) {
      const current = byNotary.get(notaryId);
      if (!current) return { ok: false };
      const payment = String(paymentId || '');
      if (!payment) return { ok: false };
      if (notaryAIPayments.has(payment)) {
        const previous = notaryAIPayments.get(payment);
        return previous.notaryId === notaryId
          ? { ok: true, applied: false, aiAccess: structuredClone(current.aiAccess || {}) }
          : { ok: false };
      }
      const currentRevision = Number(current.aiAccess && current.aiAccess.revision) || 0;
      if (currentRevision !== Number(expectedRevision) || Number(aiAccess.revision) !== currentRevision + 1) return { ok: false };
      byNotary.set(notaryId, { ...current, aiAccess: structuredClone(aiAccess) });
      notaryAIPayments.set(payment, { notaryId, quantity: aiAccess.paidUses, at: at || null });
      return { ok: true, applied: true, aiAccess: structuredClone(aiAccess) };
    },
    // Mirrors the Dynamo sparse-GSI1 read: only ACTIVE notaries are enumerable.
    async listActiveNotaries() {
      // 2026-09-02: an operator-approved notary (`approuveLe`) is active on
      // the marketplace whatever Stripe says of their payouts.
      return [...byNotary.values()].filter((n) => n.status === 'active' || !!n.approuveLe).map((n) => ({ ...n }));
    },
    // Le registre de la console admin : TOUS les notaires, y compris ceux qui
    // n'ont pas fini leur inscription — un opérateur doit voir qui frappe à la
    // porte, pas seulement qui est déjà payable.
    async listNotaries() {
      return [...byNotary.values()].map((n) => ({ ...n }));
    },
    async getNotary(id) {
      const n = byNotary.get(id);
      return n ? { ...n } : null;
    },
    async markEventProcessed(stripeEventId, at) {
      events.set(stripeEventId, at || true);
    },
    async wasEventProcessed(stripeEventId) {
      return events.has(stripeEventId);
    },

    // --- Notifications (idempotency + unsubscribe suppression) --------------
    async markNotificationSent(refId, kind, at) {
      notified.set(`${refId}#${kind}`, at || true);
    },
    async wasNotificationSent(refId, kind) {
      return notified.has(`${refId}#${kind}`);
    },
    async putUnsubscribe(email, at) {
      unsubscribed.add(String(email).trim().toLowerCase());
      return at || true;
    },
    // Le réabonnement. Sans cette porte, `putUnsubscribe` était irréversible :
    // une personne qui redemandait à recevoir les avis restait supprimée pour
    // toujours, et la LCAP n'interdit rien de tel — elle exige le retrait, pas
    // son irrévocabilité. Effacer une adresse absente est un no-op.
    async deleteUnsubscribe(email) {
      unsubscribed.delete(String(email == null ? '' : email).trim().toLowerCase());
    },
    async isUnsubscribed(email) {
      return unsubscribed.has(String(email).trim().toLowerCase());
    },

    // --- Admin-editable email subject overrides (ADR 0018) -------------------
    // Same normalization contract as the dynamo adapter: empty-string subjects
    // are stored as null (the consumption side treats a half-configured pair as
    // not configured), `enabled` is a real boolean, and updatedAt is stamped by
    // the caller-supplied clock — never Date.now().
    async getEmailLanguage(email) {
      return emailLanguages.get(String(email).trim().toLowerCase()) || null;
    },
    async putEmailLanguage(email, language, onlyIfAbsent = false) {
      if (!['en', 'fr'].includes(language)) throw new Error('Invalid email language');
      const key = String(email).trim().toLowerCase();
      if (!onlyIfAbsent || !emailLanguages.has(key)) emailLanguages.set(key, language);
    },
    async getNotificationPreferences(email) {
      return { ...(notificationPreferences.get(String(email).trim().toLowerCase()) || {}) };
    },
    async putNotificationPreferences(email, preferences) {
      notificationPreferences.set(String(email).trim().toLowerCase(), { ...preferences });
    },
    // --- Le consentement au texto (ADR 0051) ---------------------------------
    // Un fait par personne, écrasable : la DERNIÈRE décision compte, et le
    // retrait (consent: false) s'écrit comme l'octroi — c'est un geste exprès,
    // pas une absence. Le journal de consentement porte l'histoire.
    async getSmsConsent(email) {
      const c = smsConsents.get(String(email).trim().toLowerCase());
      return c ? { ...c } : null;
    },
    async putSmsConsent(email, { telephone, consent, at } = {}) {
      const key = String(email).trim().toLowerCase();
      if (!key) throw new Error('putSmsConsent: email is required');
      const item = { telephone: telephone == null ? null : String(telephone), consent: consent === true, at: at || null };
      smsConsents.set(key, item);
      return { ...item };
    },
    async deleteSmsConsent(email) {
      smsConsents.delete(String(email).trim().toLowerCase());
    },
    async getEmailOverride(key) {
      const o = emailOverrides.get(String(key));
      return o ? { ...o } : null;
    },
    async putEmailOverride(override, nowISO) {
      // Un champ vide se STOCKE comme absent : une paire à moitié remplie n'est
      // pas une surcharge, et la lecture doit pouvoir le voir sans deviner.
      const txt = (v) => {
        const s = typeof v === 'string' ? v.trim() : '';
        return s || null;
      };
      const stored = {
        key: String(override.key),
        // `actif` est le nom du produit, `enabled` l'alias historique : les deux
        // portent la même décision, et un gabarit transactionnel ne peut pas
        // être éteint (la règle vit dans emails.validateOverride).
        actif: override.actif !== false && override.enabled !== false,
        enabled: override.actif !== false && override.enabled !== false,
        subjectFr: txt(override.subjectFr),
        subjectEn: txt(override.subjectEn),
        preheaderFr: txt(override.preheaderFr),
        preheaderEn: txt(override.preheaderEn),
        corpsFr: txt(override.corpsFr),
        corpsEn: txt(override.corpsEn),
        ctaFr: txt(override.ctaFr),
        ctaEn: txt(override.ctaEn),
        signatureFr: txt(override.signatureFr),
        signatureEn: txt(override.signatureEn),
        updatedAt: nowISO,
      };
      emailOverrides.set(stored.key, stored);
      return { ...stored };
    },
    async deleteEmailOverride(key) {
      emailOverrides.delete(String(key));
    },
    async listEmailOverrides() {
      return [...emailOverrides.values()]
        .map((o) => ({ ...o }))
        .sort((a, b) => a.key.localeCompare(b.key));
    },

    // --- Le prix de Nota, décidé par Nota (ADR 0031 / 0034) ------------------
    // Même contrat que l'adaptateur dynamo : un seul enregistrement, updatedAt
    // estampillé par l'horloge de l'appelant, absent se lit null (la
    // facturation retombe alors sur les défauts du déploiement).
    async getPrixNotaConfig() {
      return prixCfg ? { ...prixCfg } : null;
    },
    async putPrixNotaConfig(cfg, nowISO) {
      prixCfg = { ...prixNotaConfig.storedConfig(cfg), updatedAt: nowISO };
      return { ...prixCfg };
    },
    async deletePrixNotaConfig() {
      prixCfg = null;
    },

    // --- Admin-decided cancellation fee barème (ADR 0023) --------------------
    // Same contract as the dynamo adapter: one record, updatedAt stamped by the
    // caller-supplied clock, absent reads as null (the cancel route then falls
    // back to the environment defaults).
    async getCancellationConfig() {
      return cancellationCfg ? { ...cancellationCfg, paliers: cancellationCfg.paliers.map((p) => ({ ...p })) } : null;
    },
    async putCancellationConfig(cfg, nowISO) {
      cancellationCfg = {
        paliers: (cfg.paliers || []).map((p) => ({ ...p })),
        // ADR 0041 — le délai de réclamation voyage avec le barème, quand il est décidé.
        ...(Number.isInteger(cfg.delaiJours) ? { delaiJours: cfg.delaiJours } : {}),
        updatedAt: nowISO,
      };
      return { ...cancellationCfg, paliers: cancellationCfg.paliers.map((p) => ({ ...p })) };
    },
    async deleteCancellationConfig() {
      cancellationCfg = null;
    },

    // --- Autonomous customer-experience policy ------------------------------
    async getExperienceConfig() {
      return experienceCfg ? structuredClone(experienceCfg) : null;
    },
    async putExperienceConfig(cfg, nowISO, { expectedRevision } = {}) {
      if (expectedRevision != null) {
        const currentRevision = experienceCfg ? Number(experienceCfg.revision) || 0 : 0;
        if (currentRevision !== Number(expectedRevision)) return false;
      }
      experienceCfg = structuredClone({ ...(cfg || {}), updatedAt: nowISO });
      return structuredClone(experienceCfg);
    },

    // --- Notary evaluation ledger (ADR 0021) ---------------------------------
    async addNotaryEvaluation(notaryId, evaluation) {
      const list = notaryEvals.get(notaryId) || [];
      list.push({ ...evaluation });
      notaryEvals.set(notaryId, list);
    },
    // Newest first — the dynamo Query walks the EVAL# range backwards.
    async listNotaryEvaluations(notaryId) {
      return (notaryEvals.get(notaryId) || [])
        .map((e) => ({ ...e }))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.bidId).localeCompare(String(a.bidId)));
    },

    // --- Notary console (declines + retained calendar pointers) -------------
    async putDecline(notaryId, bidId) {
      declines.add(`${notaryId}#${bidId}`);
    },
    async wasDeclined(notaryId, bidId) {
      return declines.has(`${notaryId}#${bidId}`);
    },
    async putRetained(notaryId, event) {
      retained.set(`${notaryId}#${event.id}`, {
        id: event.id,
        dateISO: event.dateISO,
        serviceId: event.serviceId,
        montant: event.montant,
      });
    },
    // A client cancelled a retained bid: the signing no longer exists, so the
    // pointer leaves the notary's calendar feed with it.
    async removeRetained(notaryId, event) {
      retained.delete(`${notaryId}#${event.id}`);
    },
    async listRetainedByNotary(notaryId) {
      return [...retained.entries()]
        .filter(([k]) => k.startsWith(`${notaryId}#`))
        .map(([, v]) => v)
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || String(a.id).localeCompare(String(b.id)));
    },

    // --- Notary magic-link login (single-use challenges + rate limit) -------
    // Symmetric with the admin login challenge, but on the MAIN table (see
    // keys.js): the public API Lambda cannot reach the admin table, so the
    // notary console keeps its own challenge/rate-limit records here.
    async putNotaryLoginChallenge(challenge) {
      notaryChallenges.set(challenge.challengeId, { ...challenge });
    },
    // Atomic single-use consume: return the challenge only if it exists, is
    // unconsumed and unexpired; flip it consumed so a replay gets null.
    async consumeNotaryLoginChallenge(challengeId, nowMs) {
      const c = notaryChallenges.get(challengeId);
      if (!c || c.consumed) return null;
      if (typeof nowMs === 'number' && nowMs >= Number(c.expiresAt)) return null;
      c.consumed = true;
      notaryChallenges.set(challengeId, c);
      return { ...c };
    },
    // Le défi du lien CLIENT — même contrat d'usage unique, magasin séparé.
    async putClientLoginChallenge(challenge) {
      clientChallenges.set(challenge.challengeId, { ...challenge });
    },
    async consumeClientLoginChallenge(challengeId, nowMs) {
      const c = clientChallenges.get(challengeId);
      if (!c || c.consumed) return null;
      if (typeof nowMs === 'number' && nowMs >= Number(c.expiresAt)) return null;
      c.consumed = true;
      clientChallenges.set(challengeId, c);
      return { ...c };
    },
    // Fixed-window counter, same shape as incrRateCounter but on its own map so a
    // notary login attempt never shares a window with an admin one.
    async incrNotaryRateCounter(scope, key, windowSec, nowMs) {
      const windowStart = Math.floor(nowMs / 1000 / windowSec);
      const k = `${scope}#${String(key).toLowerCase()}#${windowStart}`;
      const count = (notaryRateCounters.get(k) || 0) + 1;
      notaryRateCounters.set(k, count);
      return count;
    },

    // --- Partner code claim (email verification, ADR 0011 fraud-hardening) ---
    // The two-step claim's single-use challenge + per-IP rate limit. Symmetric
    // with the notary login above (own maps, so a notary and a partner challenge
    // never share state), mirroring the DynamoDB conditional-consume + TTL.
    async putPartnerClaim(claim) {
      partnerClaims.set(claim.challengeId, { ...claim });
    },
    // Atomic single-use consume: return the claim only if it exists, is
    // unconsumed and unexpired; flip it consumed so a replay gets null.
    async consumePartnerClaim(challengeId, nowMs) {
      const c = partnerClaims.get(challengeId);
      if (!c || c.consumed) return null;
      if (typeof nowMs === 'number' && nowMs >= Number(c.expiresAt)) return null;
      c.consumed = true;
      partnerClaims.set(challengeId, c);
      return { ...c };
    },
    // Fixed-window per-IP counter for the claim request, on its own map.
    async incrPartnerRateCounter(scope, key, windowSec, nowMs) {
      const windowStart = Math.floor(nowMs / 1000 / windowSec);
      const k = `${scope}#${String(key).toLowerCase()}#${windowStart}`;
      const count = (partnerRateCounters.get(k) || 0) + 1;
      partnerRateCounters.set(k, count);
      return count;
    },

    // --- Analytics rollups (STATS#) -----------------------------------------
    // Atomic ADD semantics: each delta bumps counters on its (pk, sk) item,
    // mirroring DynamoDB's `UpdateItem ... ADD` (create-if-absent, then add).
    async applyStatsDeltas(deltas) {
      for (const d of deltas || []) {
        const key = statKey(d.pk, d.sk);
        const item = stats.get(key) || { pk: d.pk, sk: d.sk };
        for (const [k, n] of Object.entries(d.adds || {})) {
          item[k] = Number(item[k] || 0) + Number(n || 0);
        }
        stats.set(key, item);
      }
    },
    // Range Query over one STATS# partition: items with skStart <= sk <= skEnd.
    async queryStats(pk, skStart, skEnd) {
      return [...stats.values()]
        .filter((it) => it.pk === pk && it.sk >= skStart && it.sk <= skEnd)
        .sort((a, b) => String(a.sk).localeCompare(String(b.sk)))
        .map((it) => ({ ...it }));
    },
    async getGauge() {
      const it = stats.get(statKey(STATS_GAUGE_PK, STATS_GAUGE_SK));
      return it ? { ...it } : null;
    },

    // --- Admin identities ----------------------------------------------------
    async getAdmin(id) {
      const a = admins.get(id);
      return a ? { ...a } : null;
    },
    async putAdmin(admin) {
      admins.set(admin.id, { ...admin });
      return admin;
    },

    // --- CRM workflow metadata (separate admin table) ----------------------
    async getCrmLead(bidId) {
      const lead = crmLeads.get(String(bidId));
      return lead ? structuredClone(lead) : null;
    },
    async putCrmLead(lead, expectedRevision = null) {
      const id = String(lead && lead.bidId || '');
      const current = crmLeads.get(id);
      const currentRevision = Number(current && current.revision) || 0;
      if (expectedRevision !== null && currentRevision !== Number(expectedRevision)) {
        const error = new Error('crm_conflit');
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }
      crmLeads.set(id, structuredClone(lead));
      return structuredClone(lead);
    },

    // --- Groupes d'administrateurs (RBAC découplé) --------------------------
    async getGroup(id) {
      const g = groupes.get(String(id));
      return g ? { ...g } : null;
    },
    async putGroup(groupe, updatedAt) {
      const item = { ...groupe, updatedAt };
      groupes.set(String(groupe.id), item);
      return { ...item };
    },
    async deleteGroup(id) {
      groupes.delete(String(id));
    },
    async listGroups() {
      return [...groupes.values()].map((g) => ({ ...g })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    },
    async getPermissionGroup(id) {
      const g = groupesPermissions.get(String(id));
      return g ? { ...g, permissions: [...(g.permissions || [])] } : null;
    },
    async putPermissionGroup(groupe, updatedAt) {
      const item = { ...groupe, permissions: [...(groupe.permissions || [])], updatedAt };
      groupesPermissions.set(String(groupe.id), item);
      return { ...item, permissions: [...item.permissions] };
    },
    async deletePermissionGroup(id) {
      groupesPermissions.delete(String(id));
    },
    async listPermissionGroups() {
      return [...groupesPermissions.values()]
        .map((g) => ({ ...g, permissions: [...(g.permissions || [])] }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    },
    async getCabinet(id) {
      const cabinet = cabinets.get(String(id));
      return cabinet ? { ...cabinet, notaires: [...(cabinet.notaires || [])] } : null;
    },
    async putCabinet(cabinet, updatedAt) {
      const item = { ...cabinet, notaires: [...(cabinet.notaires || [])], updatedAt };
      cabinets.set(String(cabinet.id), item);
      return { ...item, notaires: [...item.notaires] };
    },
    async deleteCabinet(id) {
      cabinets.delete(String(id));
    },
    async listCabinets() {
      return [...cabinets.values()]
        .map((cabinet) => ({ ...cabinet, notaires: [...(cabinet.notaires || [])] }))
        .sort((a, b) => String(a.nom).localeCompare(String(b.nom)) || String(a.id).localeCompare(String(b.id)));
    },

    // --- Campagnes ciblées : audience, consentement, fréquence ---------------
    // Même contrat que l'adaptateur dynamo. Les adresses sont normalisées à
    // l'écriture ET à la lecture : une campagne ne doit pas rater un plafond de
    // fréquence parce que l'opérateur a tapé une majuscule.
    async getAudienceGroup(id) {
      const g = audienceGroupes.get(String(id));
      return g ? { ...g, membres: [...g.membres] } : null;
    },
    async putAudienceGroup(groupe, updatedAt) {
      const item = {
        id: String(groupe.id),
        libelle: groupe.libelle || null,
        audience: groupe.audience || null,
        nature: groupe.nature || null,
        membres: (groupe.membres || []).map(courriel).filter(Boolean),
        updatedAt,
      };
      audienceGroupes.set(item.id, item);
      return { ...item, membres: [...item.membres] };
    },
    async deleteAudienceGroup(id) {
      audienceGroupes.delete(String(id));
    },
    async listAudienceGroups() {
      // Ordre des OCTETS : c'est une partition unique lue par son SK
      // (`GROUP#<id>`) côté dynamo, et l'ordre d'une partition est celui de
      // DynamoDB — pas celui d'une locale.
      return [...audienceGroupes.values()]
        .map((g) => ({ ...g, membres: [...g.membres] }))
        .sort((a, b) => ordreCles(audienceGroupSK(a.id), audienceGroupSK(b.id)));
    },

    async getEmailConsent(email) {
      const c = consentements.get(courriel(email));
      return c ? { ...c } : null;
    },
    async putEmailConsent(email, consent) {
      return { ...majProjectionConsentement(email, consent) };
    },

    // Art. 56 1° — le registre qui donne sa force au plafond de fréquence. UN
    // item par adresse, écrasé : ce qui compte est la DERNIÈRE campagne reçue.
    async markCampaignSent(email, atISO, campaignId) {
      const clean = courriel(email);
      if (!clean) return null;
      const item = { email: clean, at: atISO, campagneId: campaignId || null };
      campagnes.set(clean, item);
      return { ...item };
    },
    async lastCampaignAt(email) {
      const c = campagnes.get(courriel(email));
      return c ? c.at : null;
    },
    // La porte préférée : UNE lecture pour toute l'audience. Toute adresse
    // demandée est présente dans la réponse — `null` DIT « jamais écrit », là
    // où une clé absente laisserait l'appelant deviner.
    async lastCampaignAtMany(adresses) {
      const out = {};
      for (const a of adresses || []) {
        const clean = courriel(a);
        const c = campagnes.get(clean);
        out[clean] = c ? c.at : null;
      }
      return out;
    },

    // --- Registre de consentement (Loi 25 / LCAP) ---------------------------
    // Le JOURNAL est la vérité, la projection d'état courant est un index de
    // lecture. Écriture unique par (adresse, instant, id) : un rejeu ne réécrit
    // pas un consentement déjà donné — miroir de la ConditionExpression dynamo.
    async appendConsentEvent(evenement = {}) {
      const adresse = courriel(evenement.courriel);
      const at = evenement.at || null;
      const id = evenement.id == null ? randomUUID() : String(evenement.id);
      const item = {
        id,
        courriel: adresse,
        audience: evenement.audience || null,
        type: evenement.type || null,
        base: evenement.base || null,
        version: evenement.version || null,
        source: evenement.source || null,
        ip: evenement.ip || null,
        lang: evenement.lang || null,
        at,
      };
      if (!ajoutUnique(consentJournal, consentJournalPK(adresse), consentJournalSK(at, id), item)) {
        // REJEU. Le journal refuse le doublon — c'est ce qu'on lui demande.
        // Mais un rejeu vient presque toujours d'une tentative précédente qui
        // s'est arrêtée EN CHEMIN : le journal écrit, la projection perdue. La
        // reprise doit donc réconcilier, sinon elle ne répare jamais rien.
        const dernier = dernierEvenementConsentement(adresse);
        if (dernier) projeterConsentement(adresse, dernier);
        return false;
      }
      // La projection suit le DERNIER événement : `segments.js` la lit sans
      // jamais connaître le journal.
      projeterConsentement(adresse, { base: item.base, at: item.at, source: item.source });
      return true;
    },
    // Du plus ancien au plus récent : une chaîne de preuve se lit dans l'ordre.
    // BORNÉE, comme toutes les lectures de ces registres, et la fenêtre se
    // prend par le bout RÉCENT : si une partition débordait, ce qui tombe est
    // le passé lointain, jamais le dernier fait — c'est lui qui décide.
    async listConsentEvents(email, { limit } = {}) {
      return triees(consentJournal, consentJournalPK(email))
        .slice(-borne(limit, CONSENT_PAGE_MAX))
        .map(([, e]) => ({ ...e }));
    },

    // --- Avis en application ------------------------------------------------
    // Le sujet est déjà dérivé par l'appelant (keys.notaryNotifSubject /
    // keys.clientNotifSubject) : le dépôt ne voit jamais un jeton porteur.
    async appendNotification(avisNeuf = {}) {
      // Le sujet est une CLÉ : il se normalise comme côté DynamoDB (et un
      // sujet vide y est refusé — une boîte d'avis COMMUNE n'existe pas).
      const sujet = notifSubject(avisNeuf.sujet);
      const at = avisNeuf.at || null;
      const id = avisNeuf.id == null ? randomUUID() : String(avisNeuf.id);
      const item = {
        id,
        sujet,
        audience: avisNeuf.audience || null,
        kind: avisNeuf.kind || null,
        titre: avisNeuf.titre || null,
        corps: avisNeuf.corps || null,
        lien: avisNeuf.lien || null,
        refId: avisNeuf.refId || null,
        at,
        luLe: avisNeuf.luLe || null,
        ttl: avisNeuf.ttl == null ? notifTtl(at) : avisNeuf.ttl,
      };
      return ajoutUnique(avis, notifPK(sujet), notifSK(at, id), item);
    },
    // Les plus récentes d'abord, bornées. `depuis` est INCLUSIF : « tout ce qui
    // s'est passé à partir de cet instant » — la clé de tri commence par
    // l'instant, donc comparer les clés suffit. Et on les compare comme la table
    // les range, EN OCTETS : une borne qui coupe dans un autre ordre que le tri
    // coupe ailleurs que là où l'autre adaptateur coupe.
    async listNotifications(sujet, { limit, depuis } = {}) {
      const rows = triees(avis, notifPK(sujet)).filter(([sk]) => (depuis ? ordreCles(sk, depuis) >= 0 : true));
      return rows
        .reverse()
        .slice(0, borne(limit, NOTIF_PAGE_MAX))
        .map(([, a]) => ({ ...a }));
    },
    // `ids` : un tableau d'identifiants, ou 'toutes'. Ne touche QUE le non-lu —
    // un avis déjà lu garde son instant de lecture, et n'est pas recompté.
    // Bornée à la MÊME fenêtre que la lecture : on ne marque lu que ce qu'on
    // pouvait voir, et aucune des deux portes ne rapatrie une partition
    // entière dans la mémoire d'une Lambda.
    async markNotificationsRead(sujet, ids, at) {
      exigerInstantDeLecture(at);
      const cible = ids === 'toutes' || ids === 'all' || ids == null
        ? null
        : new Set((Array.isArray(ids) ? ids : [ids]).map(String));
      let marques = 0;
      for (const [, a] of triees(avis, notifPK(sujet)).slice(-NOTIF_PAGE_MAX)) {
        if (a.luLe) continue;
        if (cible && !cible.has(String(a.id))) continue;
        a.luLe = at;
        marques += 1;
      }
      return marques;
    },

    // --- Journal par sujet --------------------------------------------------
    async appendSubjectEvent(evenement = {}) {
      const sujet = notifSubject(evenement.sujet);
      const at = evenement.at || null;
      const id = evenement.id == null ? randomUUID() : String(evenement.id);
      const item = {
        id,
        sujet,
        kind: evenement.kind || null,
        templateKey: evenement.templateKey || null,
        refId: evenement.refId || null,
        at,
        messageId: evenement.messageId || null,
      };
      return ajoutUnique(sujetJournal, subjectJournalPK(sujet), subjectJournalSK(at, id), item);
    },
    // Les plus récents d'abord : la question posée est « qu'a-t-on envoyé à
    // cette personne dernièrement », et une limite n'a de sens que par ce bout.
    async listSubjectEvents(sujet, { limit } = {}) {
      return triees(sujetJournal, subjectJournalPK(sujet))
        .reverse()
        .slice(0, borne(limit, SUBJECT_PAGE_MAX))
        .map(([, e]) => ({ ...e }));
    },

    // --- Registre des destinataires d'une campagne --------------------------
    // L'HISTOIRE, pas l'état : `markCampaignSent` garde la dernière date par
    // adresse (plafond de fréquence, art. 56 1°), celui-ci garde la ligne.
    async appendCampaignRecipient(ligne = {}) {
      const campagneId = String(ligne.campagneId == null ? '' : ligne.campagneId).trim();
      // La clé refuse l'identifiant réservé ET le vide, exactement comme en
      // dynamo — et c'est ELLE qui indexe la partition, pas l'identifiant nu :
      // un refus qu'on ne fait que constater finit par être contourné.
      const pk = campaignRecipientsPK(campagneId);
      const adresse = courriel(ligne.courriel);
      const item = {
        campagneId,
        courriel: adresse,
        templateKey: ligne.templateKey || null,
        nature: ligne.nature || null,
        at: ligne.at || null,
        statut: ligne.statut || null,
        erreur: ligne.erreur || null,
      };
      return ajoutUnique(campagneDestinataires, pk, campaignRecipientSK(adresse), item);
    },
    // Page bornée + curseur opaque : une campagne de masse ne rentre pas dans
    // la mémoire d'une Lambda, et le curseur doit survivre à un aller-retour
    // HTTP — d'où la même chaîne encodée que côté dynamo.
    async listCampaignRecipients(campagneId, { limit, cursor } = {}) {
      // La clé refuse l'identifiant réservé et le vide, et c'est elle qui
      // indexe la partition — donc l'identifiant se trime à la LECTURE comme à
      // l'écriture, sans que personne ait à y repenser.
      const pk = campaignRecipientsPK(campagneId);
      const rows = triees(campagneDestinataires, pk);
      const reprise = decodeCursor(cursor);
      // Un curseur d'une AUTRE partition n'est pas une page à rendre : DynamoDB
      // refuse une clé de départ qui ne correspond pas à la KeyCondition
      // (ValidationException), et rendre tranquillement le milieu d'une autre
      // campagne serait pire qu'une erreur. Le double de table lève pareil.
      if (reprise && String(reprise.PK) !== pk) {
        const err = new Error('The provided starting key is invalid');
        err.name = 'ValidationException';
        throw err;
      }
      // Reprise STRICTEMENT après la clé, comme `ExclusiveStartKey` : la clé
      // nommée peut avoir disparu (ligne purgée, curseur d'une autre page), et
      // un `findIndex` qui ne la trouve pas rendrait -1 — donc la page
      // repartirait du DÉBUT, et la boucle de l'appelant tournerait sans fin.
      // La comparaison est celle des OCTETS, la même que le tri juste au-dessus :
      // deux ordres différents ici, et la reprise vise une autre ligne que celle
      // qui suit — la page se répète, la fin de la partition n'arrive jamais.
      let debut = 0;
      if (reprise) {
        const apres = rows.findIndex(([sk]) => ordreCles(sk, reprise.SK) > 0);
        debut = apres === -1 ? rows.length : apres;
      }
      const taille = borne(limit, CAMPAIGN_PAGE_MAX);
      const page = rows.slice(debut, debut + taille);
      const reste = rows.length > debut + page.length;
      return {
        destinataires: page.map(([, d]) => ({ ...d })),
        // Le curseur porte la clé COMPLÈTE — la même forme que le
        // `LastEvaluatedKey` de DynamoDB, sinon les deux adaptateurs ne
        // rendent pas le même jeton pour la même page.
        cursor: reste && page.length ? encodeCursor({ PK: pk, SK: page[page.length - 1][0] }) : null,
      };
    },

    // --- Index client -------------------------------------------------------
    // Un pointeur, pas un journal : la clé porte déjà l'unicité, donc une
    // réindexation est la même ligne réécrite. Le ttl est celui de l'offre
    // indexée — l'appelant le passe s'il l'a, sinon il se recalcule de la date.
    async indexClientBid({ courriel: adresse, bidId, dateISO, at, ttl } = {}) {
      const clean = courriel(adresse);
      const item = {
        courriel: clean,
        bidId: String(bidId),
        dateISO: String(dateISO),
        at: at || null,
        ttl: ttl == null ? bidTtl(dateISO) : ttl,
      };
      partition(clientOffres, clientIndexPK(clean)).set(clientBidSK(item.dateISO, item.bidId), item);
      return { ...item };
    },
    // Chronologique : la date mène la clé de tri. Bornée comme les autres, et
    // la fenêtre se prend par les dates les plus proches — une personne se
    // retrouve par ce qu'elle a de vivant, pas par ce qui a expiré.
    async listClientBids(email, { limit } = {}) {
      return triees(clientOffres, clientIndexPK(email))
        .slice(-borne(limit, CLIENT_BID_PAGE_MAX))
        .map(([, o]) => ({ ...o }));
    },

    // --- Marque d'effacement (Loi 25, art. 28) ------------------------------
    async putErasure(email, at) {
      const item = { courriel: courriel(email), at: at || null };
      effacements.set(erasurePK(item.courriel), item);
      return { ...item };
    },
    async getErasure(email) {
      const e = effacements.get(erasurePK(email));
      return e ? { ...e } : null;
    },

    // --- Admin login challenges (single-use magic links) --------------------
    async putLoginChallenge(challenge) {
      challenges.set(challenge.challengeId, { ...challenge });
    },
    // Atomic single-use consume: return the challenge only if it exists, is
    // unconsumed and unexpired; flip it consumed so a replay gets null.
    async consumeLoginChallenge(challengeId, nowMs) {
      const c = challenges.get(challengeId);
      if (!c || c.consumed) return null;
      if (typeof nowMs === 'number' && nowMs >= Number(c.expiresAt)) return null;
      c.consumed = true;
      challenges.set(challengeId, c);
      return { ...c };
    },

    // --- Admin sessions (revocable, server-side) ----------------------------
    async putAdminSession(session) {
      sessions.set(session.sessionId, { ...session });
    },
    async getAdminSession(sessionId) {
      const s = sessions.get(sessionId);
      return s ? { ...s } : null;
    },
    async touchAdminSession(sessionId, lastSeenMs, absoluteExpiresAt) {
      const s = sessions.get(sessionId);
      if (!s) return;
      s.lastSeenAt = lastSeenMs;
      if (typeof absoluteExpiresAt === 'number') s.absoluteExpiresAt = absoluteExpiresAt;
      sessions.set(sessionId, s);
    },
    async revokeAdminSession(sessionId, at) {
      const s = sessions.get(sessionId);
      if (!s) return;
      s.revokedAt = at || true;
      sessions.set(sessionId, s);
    },

    // --- Audit log (append-only) --------------------------------------------
    // La paire « transactions » : même journal, écrite par la porte publique.
    // L'adaptateur DynamoDB, lui, les range dans la table PRINCIPALE — la
    // Lambda publique n'a aucun accès à la table admin.
    async appendTxAudit(entry) {
      return poserUneFois('main', audit, auditPK, auditSK, entry);
    },
    async queryTxAuditByDay(dayISO) {
      return this.queryAuditByDay(dayISO);
    },
    async appendAudit(entry) {
      return poserUneFois('admin', audit, auditPK, auditSK, entry);
    },
    async queryAuditByDay(dayISO) {
      return audit.filter((e) => e.day === dayISO).map((e) => ({ ...e }));
    },
    // Learning signals have their own append-only stream so the autonomous
    // worker never has to read transaction rows that may contain customer or
    // notary message metadata. The Dynamo adapter uses LEARNING#<day> for the
    // same boundary.
    async appendLearningSignal(entry) {
      return poserUneFois('main', learningSignals, learningSignalPK, learningSignalSK, entry);
    },
    async queryNotaryLearningByDay(dayISO, limit) {
      const max = limit == null ? learningSignals.length : Math.max(0, Math.floor(Number(limit) || 0));
      return learningSignals.filter((e) => e.day === dayISO).slice(0, max).map((e) => ({ ...e }));
    },

    // --- Rate limiting -------------------------------------------------------
    // Fixed-window counter: increments the count for the window `nowMs` falls in
    // and returns the running total, like a DynamoDB ADD with a TTL per window.
    async incrRateCounter(scope, key, windowSec, nowMs) {
      const windowStart = Math.floor(nowMs / 1000 / windowSec);
      const k = `${scope}#${String(key).toLowerCase()}#${windowStart}`;
      const count = (rateCounters.get(k) || 0) + 1;
      rateCounters.set(k, count);
      return count;
    },

    async _all() {
      return [...byId.values()];
    },
  };
}

module.exports = { createMemoryRepo };
