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
} = require('./keys');
const { randomUUID } = require('node:crypto');
const { STATUS, normalizeReferralCode } = require('@nota/domain');

/**
 * In-memory implementation of the Repo port. Used by the test suite and by the
 * local dev server when no DynamoDB endpoint is configured. Same interface as
 * repo-dynamo.js — the handler cannot tell them apart.
 */
function createMemoryRepo(seed = []) {
  const byId = new Map();
  for (const b of seed) byId.set(b.id, b);

  // Billing state lives in the same conceptual table (see keys.js): notary
  // subscription profiles keyed by id, and a set of processed webhook event ids
  // for idempotency.
  const byNotary = new Map();
  const events = new Map();
  const acts = new Map(); // bidId -> completed-act record (idempotency ledger)
  const partners = new Map(); // CODE -> registered referral partner (ADR 0011)
  const referralEarnings = new Map(); // `${CODE}#${TRACK}#${refId}` -> durable earning event
  const supportThreads = new Map(); // threadId -> live support thread (ADR 0026)

  // Notification ledgers: sent (idempotency) and unsubscribe (suppression).
  const notified = new Map(); // `${refId}#${kind}` -> timestamp
  const unsubscribed = new Set(); // lowercased emails

  // Admin-editable email subject overrides (ADR 0018): one record per template
  // key, mirroring the CONFIG#EMAIL / TPL#<key> partition on the main table.
  const emailOverrides = new Map(); // templateKey -> { key, enabled, subjectFr, subjectEn, updatedAt }

  // Groupes d'administrateurs (RBAC découplé) : un groupe réunit des
  // permissions et s'attribue à des utilisateurs. Miroir de la partition
  // GROUPS / GROUP#<id> de la table admin.
  const groupes = new Map(); // id -> { id, nom, description, permissions[], updatedAt }

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

  // Notary magic-link login: single-use challenges (main table) and a per-IP
  // login rate-limit counter, kept apart from the admin equivalents above so an
  // admin and a notary challenge can never be confused.
  const notaryChallenges = new Map(); // challengeId -> record
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
  const challenges = new Map(); // challengeId -> record
  const sessions = new Map(); // sessionId -> record
  const audit = []; // { id, ts, action, adminId, email, ip, meta }
  const rateCounters = new Map(); // `${scope}#${key}#${windowStart}` -> count

  return {
    async listByMonth(month) {
      return [...byId.values()]
        .filter((b) => monthOf(b.dateISO) === month)
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || String(a.id).localeCompare(String(b.id)));
    },
    // `dateISO` is accepted (and ignored) so this adapter's signature matches
    // repo-dynamo's `get(id, dateISO)`, which needs it to build the composite key.
    async get(id, dateISO) {
      void dateISO;
      return byId.get(id) || null;
    },
    async put(bid) {
      byId.set(bid.id, bid);
      return bid;
    },
    // General overwrite of a mutated bid (propositions, demandes, dossier).
    // Same full-item semantics as put(); kept as its own method so the
    // handler's intent reads clearly. LIMITATION: last-writer-wins — two
    // notaries proposing on the same bid at the same instant could drop one
    // proposition. Retention itself stays on the conditional retain().
    async update(bid) {
      byId.set(bid.id, bid);
      return bid;
    },
    // Conditional retain: flip a bid to RETENUE for `notaryId` ONLY while it is
    // still OUVERTE, mirroring the DynamoDB ConditionExpression. Returns the
    // stored bid on success, or null if another notary already retained it
    // (the TOCTOU loser). `bid` is the fully-formed retained item.
    async retain(bid, notaryId) {
      void notaryId;
      const current = byId.get(bid.id);
      if (!current || current.status === STATUS.RETENUE) return null;
      byId.set(bid.id, bid);
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
      };
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
    async putSupportThread(thread) {
      supportThreads.set(String(thread.id), { ...thread });
      return thread;
    },
    async getSupportThread(id) {
      const t = supportThreads.get(String(id));
      return t ? { ...t } : null;
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

    // --- Le prix de Nota, décidé par Nota (ADR 0031) -------------------------
    // Même contrat que l'adaptateur dynamo : un seul enregistrement, updatedAt
    // estampillé par l'horloge de l'appelant, absent se lit null (la
    // facturation retombe alors sur les défauts du déploiement).
    async getPrixNotaConfig() {
      return prixCfg ? { ...prixCfg } : null;
    },
    async putPrixNotaConfig(cfg, nowISO) {
      prixCfg = { prixCents: cfg.prixCents, updatedAt: nowISO };
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
        updatedAt: nowISO,
      };
      return { ...cancellationCfg, paliers: cancellationCfg.paliers.map((p) => ({ ...p })) };
    },
    async deleteCancellationConfig() {
      cancellationCfg = null;
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
      return this.appendAudit(entry);
    },
    async queryTxAuditByDay(dayISO) {
      return this.queryAuditByDay(dayISO);
    },
    async appendAudit(entry) {
      // Le seau du journal est le JOUR OUVRABLE québécois quand l'appelant le
      // nomme (le handler public le fait : un règlement du soir appartient à la
      // journée d'affaires en cours, pas au lendemain UTC) ; sinon, la date de
      // l'horodatage. L'instant, lui, reste toujours vrai.
      audit.push({ ...entry, day: entry.day || String(entry.ts || '').slice(0, 10) });
    },
    async queryAuditByDay(dayISO) {
      return audit.filter((e) => e.day === dayISO).map((e) => ({ ...e }));
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
