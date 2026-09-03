'use strict';

const {
  bidPK,
  bidSK,
  monthPK,
  notaryPK,
  NOTARY_SK,
  eventPK,
  EVENT_SK,
  sentPK,
  SENT_SK,
  unsubPK,
  UNSUB_SK,
  notaryLoginPK,
  NOTARY_LOGIN_SK,
  notaryRlPK,
  NOTARY_RL_SK,
  declinePK,
  DECLINE_SK,
  retainedSK,
  RETAINED_PREFIX,
  notaryEvalSK,
  NOTARY_EVAL_PREFIX,
  STATS_GAUGE_PK,
  STATS_GAUGE_SK,
  actPK,
  ACT_SK,
  supportPK,
  SUPPORT_SK,
  partnerPK,
  PARTNER_SK,
  PARTNER_GSI1PK,
  partnerClaimPK,
  PARTNER_CLAIM_SK,
  partnerRlPK,
  PARTNER_RL_SK,
  referralEarnSK,
  REFEARN_GSI1PK,
  referralEarnGSI1SK,
  emailOverridePK,
  emailOverrideSK,
  EMAIL_OVERRIDE_PREFIX,
  prixConfigPK,
  PRIX_CONFIG_SK,
  cancellationConfigPK,
  CANCELLATION_CONFIG_SK,
  audienceGroupsPK,
  audienceGroupSK,
  AUDIENCE_GROUP_PREFIX,
  emailConsentPK,
  emailConsentSK,
  campaignLogPK,
  campaignLogSK,
  adminPK,
  ADMIN_SK,
  groupsPK,
  groupSK,
  GROUP_PREFIX,
  adminLoginPK,
  ADMIN_LOGIN_SK,
  adminSessionPK,
  ADMIN_SESSION_SK,
  auditPK,
  auditSK,
  adminRlPK,
  ADMIN_RL_SK,
  GSI1_PK,
  GSI1_SK,
  OPENBID_GSI1PK,
  openBidGSI1SK,
  NOTARY_GSI1PK,
  notaryGSI1SK,
} = require('./keys');
const { STATUS, normalizeReferralCode, auditRetentionTtl } = require('@nota/domain');

// La borne de conservation du journal d'audit, posée à l'écriture sur les DEUX
// journaux (transactions dans la table principale, gestes d'administration dans
// la table admin) : c'est le seul point que leurs deux appelants traversent.
// La durée elle-même est une règle d'affaires et vit dans le domaine.
// Rend `{}` — donc AUCUN attribut ttl — quand l'appelant a déjà décidé, ou
// quand l'horodatage est illisible : mieux vaut une entrée qui survit qu'une
// preuve qui expire à une date inventée.
function auditTtl(entry) {
  if (entry && entry.ttl != null) return {};
  const ttl = auditRetentionTtl(Date.parse((entry && entry.ts) || ''));
  return ttl == null ? {} : { ttl };
}

/**
 * DynamoDB implementation of the Repo port.
 *
 * The AWS SDK is required lazily so the test suite and the domain package never
 * need it installed — only the code path that actually talks to DynamoDB pulls
 * it in. This is the one justified runtime dependency in apps/api.
 *
 * `endpoint` lets the local dev server point at DynamoDB Local (docker-compose);
 * in Lambda it is omitted and the SDK resolves the regional endpoint.
 */
function createDynamoRepo({ tableName, adminTableName, endpoint, region, doc } = {}) {
  if (!tableName) throw new Error('createDynamoRepo: tableName is required');

  // Lazy import keeps the SDK out of the dependency graph for tests. The command
  // classes are always needed; the concrete client is built only when the caller
  // did not inject its own document client.
  // No ScanCommand: the reminder worker now reads open bids via a GSI1 Query,
  // so this repo performs no table Scans at all.
  const {
    PutCommand,
    GetCommand,
    QueryCommand,
    UpdateCommand,
    DeleteCommand,
    BatchGetCommand,
  } = require('@aws-sdk/lib-dynamodb');

  // The admin surface's identity/session/audit items live in a SEPARATE table
  // (blast-radius isolation). Only the admin Lambda passes adminTableName; the
  // public Lambda never does, so calling an admin method there fails loudly.
  function adminTable() {
    if (!adminTableName) throw new Error('admin table not configured on this repo');
    return adminTableName;
  }

  // `doc` is injectable so a test can drive the paginating reads (listByMonth /
  // listOpenBids) against a fake document client with no AWS. Production omits it
  // and we construct the real client here.
  if (!doc) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    const base = new DynamoDBClient({
      ...(region ? { region } : {}),
      ...(endpoint ? { endpoint } : {}),
    });
    doc = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  // Une adresse est une CLÉ ici (SK des items de campagne et de consentement) :
  // elle se range toujours sous la même forme, sinon une même personne occupe
  // deux items et le plafond de fréquence la manque.
  const lowerEmail = (email) => String(email == null ? '' : email).trim().toLowerCase();

  function toItem(bid) {
    const item = { PK: bidPK(bid.dateISO), SK: bidSK(bid), type: 'bid', ...bid };
    // Sparse GSI1 membership: ONLY open (not-retained) bids are indexed, so the
    // daily reminder worker Queries just the open set instead of Scanning the
    // whole table. A retained bid omits these attributes — and because every bid
    // mutation rewrites the full item (PutCommand), retaining a bid drops it out
    // of the index automatically.
    if (bid.status !== STATUS.RETENUE && bid.status !== STATUS.ANNULEE) {
      item[GSI1_PK] = OPENBID_GSI1PK;
      item[GSI1_SK] = openBidGSI1SK(bid);
    }
    return item;
  }
  function fromItem(item) {
    if (!item) return null;
    // Strip the storage keys AND the sparse-index attributes, so a bid handed to
    // the domain/notifier never carries GSI1PK/GSI1SK.
    const { PK, SK, type, [GSI1_PK]: _gpk, [GSI1_SK]: _gsk, ...bid } = item;
    return bid;
  }

  // Le balayage GSI1 des profils notaires — une seule définition, partagée par
  // les deux noms de lecture (le registre admin et la liste de diffusion).
  async function queryAllNotaries() {
    const notaries = [];
    let ExclusiveStartKey;
    do {
      const out = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: '#g = :n',
          ExpressionAttributeNames: { '#g': GSI1_PK },
          ExpressionAttributeValues: { ':n': NOTARY_GSI1PK },
          ExclusiveStartKey,
        })
      );
      (out.Items || []).forEach((i) => {
        const { PK, SK, type, [GSI1_PK]: _gpk, [GSI1_SK]: _gsk, ...notary } = i;
        notaries.push(notary);
      });
      ExclusiveStartKey = out.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return notaries;
  }

  return {
    async listByMonth(month) {
      // A month partition can exceed DynamoDB's 1MB page, so follow
      // LastEvaluatedKey to exhaustion — same contract as listOpenBids and the
      // memory adapter, which both return every matching item.
      const bids = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :b)',
            ExpressionAttributeValues: { ':pk': monthPK(month), ':b': 'BID#' },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((i) => bids.push(fromItem(i)));
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return bids;
    },
    async get(id, dateISO) {
      if (!dateISO) throw new Error('dynamo get requires dateISO for the key');
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: bidPK(dateISO), SK: `BID#${dateISO}#${id}` } })
      );
      return fromItem(out.Item);
    },
    async put(bid) {
      await doc.send(new PutCommand({ TableName: tableName, Item: toItem(bid) }));
      return bid;
    },
    // General overwrite of a mutated bid (propositions, demandes, dossier): a
    // full-item PutCommand on the same composite key as put()/get(). LIMITATION:
    // last-writer-wins — two notaries proposing on the same bid at the same
    // instant could drop one proposition (no ConditionExpression here; moving
    // propositions to their own items would fix it). Retention stays on the
    // conditional retain() so the retained state itself can never be clobbered
    // by a stale proposition write racing an accept.
    async update(bid) {
      await doc.send(new PutCommand({ TableName: tableName, Item: toItem(bid) }));
      return bid;
    },
    // Conditional retain: write the retained item ONLY while the stored bid is
    // still OUVERTE. The ConditionExpression is evaluated against the existing
    // item, so two concurrent accepts cannot both win — the second trips
    // ConditionalCheckFailedException and we surface that as `null` (the handler
    // maps it to 409 deja_retenue). Mirror of repo-memory's retain(). `bid` is
    // the fully-formed retained item.
    async retain(bid, notaryId) {
      void notaryId;
      try {
        await doc.send(
          new PutCommand({
            TableName: tableName,
            Item: toItem(bid),
            ConditionExpression: '#s = :ouverte',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':ouverte': STATUS.OUVERTE },
          })
        );
        return bid;
      } catch (err) {
        if (err && err.name === 'ConditionalCheckFailedException') return null;
        throw err;
      }
    },

    // --- Pay-on-accept authorization ----------------------------------------
    // The Stripe webhook binds the client's authorized PaymentIntent to the bid
    // (offer goes live) or voids the hold if it lapsed. Read-modify-write on the
    // bid item — no contention here (unlike retain), so no ConditionExpression.
    async authorizeBid(bidId, dateISO, patch) {
      if (!dateISO) return null;
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: bidPK(dateISO), SK: `BID#${dateISO}#${bidId}` } })
      );
      const bid = fromItem(out.Item);
      if (!bid) return null;
      const updated = {
        ...bid,
        paymentStatus: 'authorized',
        paymentIntentId: (patch && patch.paymentIntentId) || bid.paymentIntentId || null,
        authorizedAt: (patch && patch.authorizedAt) || bid.authorizedAt || null,
      };
      await doc.send(new PutCommand({ TableName: tableName, Item: toItem(updated) }));
      return updated;
    },
    async voidBidAuthorization(bidId, dateISO, patch) {
      if (!dateISO) return null;
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: bidPK(dateISO), SK: `BID#${dateISO}#${bidId}` } })
      );
      const bid = fromItem(out.Item);
      if (!bid) return null;
      // Never void a RETAINED bid: after a proposition accept the ORIGINAL hold
      // is canceled (or expires), and Stripe's payment_intent.canceled webhook
      // must not flip the live mise en relation to 'void' and hide it. The
      // conditional Put closes the read-write race against a concurrent retain.
      if (bid.status === STATUS.RETENUE) return null;
      const updated = { ...bid, paymentStatus: 'void', voidedAt: (patch && patch.voidedAt) || null };
      try {
        await doc.send(
          new PutCommand({
            TableName: tableName,
            Item: toItem(updated),
            ConditionExpression: '#s <> :retenue',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':retenue': STATUS.RETENUE },
          })
        );
      } catch (err) {
        if (err && err.name === 'ConditionalCheckFailedException') return null;
        throw err;
      }
      return updated;
    },

    // Every open (not-retained) bid, across all month partitions. Used only by
    // the daily reminder scheduler. Reads the sparse GSI1 (only open bids are
    // indexed) with a single paginated Query instead of a full-table Scan, so
    // cost is proportional to the number of OPEN bids, not the whole table.
    async listOpenBids() {
      const bids = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: 'GSI1',
            KeyConditionExpression: '#g = :open',
            ExpressionAttributeNames: { '#g': GSI1_PK },
            ExpressionAttributeValues: { ':open': OPENBID_GSI1PK },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((i) => bids.push(fromItem(i)));
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return bids;
    },

    // --- Billing (notary subscriptions + webhook idempotency) ---------------
    // Same single table, distinct key prefixes (see keys.js). Only GetItem and
    // PutItem are used, so the least-privilege IAM policy is unchanged.
    async putNotary(notary) {
      // GSI1 énumère TOUS les notaires — actifs, en inscription, restreints.
      // Avant le 2026-09-01, l'index était creux (actifs seulement) : le
      // registre admin ne voyait donc pas les notaires en inscription, ni la
      // créance de celui qui part. Le filtre par statut vit maintenant dans
      // `listActiveNotaries`, la seule lecture qui exige des actifs (le digest
      // quotidien) — un filtre est visible et testable, un index creux ne
      // l'est pas.
      const item = { PK: notaryPK(notary.id), SK: NOTARY_SK, type: 'notary', ...notary };
      {
        item[GSI1_PK] = NOTARY_GSI1PK;
        item[GSI1_SK] = notaryGSI1SK(notary);
      }
      await doc.send(new PutCommand({ TableName: tableName, Item: item }));
      return notary;
    },
    async getNotary(id) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: notaryPK(id), SK: NOTARY_SK } })
      );
      if (!out.Item) return null;
      const { PK, SK, type, [GSI1_PK]: _gpk, [GSI1_SK]: _gsk, ...notary } = out.Item;
      return notary;
    },
    // Every ACTIVE notary, via the sparse GSI1 — one Query/day for the carnet
    // digest, cost proportional to the roster, never a Scan. Profiles written
    // before this index existed appear after their next putNotary (any profile
    // update); the early-stage roster makes a backfill unnecessary.
    // Le registre complet de la console admin. Même balayage GSI1 que
    // listActiveNotaries — l'index porte déjà tous les profils notaires ; les
    // deux noms existent pour que l'appelant dise ce qu'il veut lire.
    async listNotaries() {
      return queryAllNotaries();
    },
    async listActiveNotaries() {
      // 2026-09-02: an operator-approved notary (`approuveLe`) is active on
      // the marketplace whatever Stripe says of their payouts.
      return (await queryAllNotaries()).filter((n) => n.status === 'active' || !!n.approuveLe);
    },
    async markEventProcessed(stripeEventId, at) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: eventPK(stripeEventId), SK: EVENT_SK, type: 'event', stripeEventId, processedAt: at },
        })
      );
    },
    async wasEventProcessed(stripeEventId) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: eventPK(stripeEventId), SK: EVENT_SK } })
      );
      return !!out.Item;
    },

    // --- Notifications (idempotency + unsubscribe suppression) --------------
    async markNotificationSent(refId, kind, at) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: sentPK(refId, kind), SK: SENT_SK, type: 'sent', refId, kind, sentAt: at },
        })
      );
    },
    async wasNotificationSent(refId, kind) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: sentPK(refId, kind), SK: SENT_SK } })
      );
      return !!out.Item;
    },
    async putUnsubscribe(email, at) {
      const clean = String(email).trim().toLowerCase();
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: unsubPK(clean), SK: UNSUB_SK, type: 'unsub', email: clean, unsubscribedAt: at },
        })
      );
    },
    async isUnsubscribed(email) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: unsubPK(email), SK: UNSUB_SK } })
      );
      return !!out.Item;
    },

    // --- Admin-editable email subject overrides (ADR 0018) -------------------
    // One small CONFIG#EMAIL partition on the MAIN table (see keys.js): the
    // notifier reads it through the repo it already owns; the admin Lambda's
    // scoped LeadingKeys grant (infra/admin.tf) is the only write door. Empty
    // subjects are stored as null so the consumption side's both-or-neither
    // contract reads unambiguously off the item itself.
    async getEmailOverride(key) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: emailOverridePK(), SK: emailOverrideSK(key) } })
      );
      if (!out.Item) return null;
      const { PK, SK, type, ...rec } = out.Item;
      return rec;
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
        // `actif` est le nom du produit, `enabled` l'alias historique : la même
        // décision sous deux noms, écrite une fois. Un gabarit transactionnel
        // ne peut pas être éteint — la règle vit dans emails.validateOverride,
        // et sendOnce la revérifie pour qu'un item écrit à la main ne l'éteigne
        // pas non plus.
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
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: emailOverridePK(), SK: emailOverrideSK(stored.key), type: 'email_override', ...stored },
        })
      );
      return stored;
    },
    async deleteEmailOverride(key) {
      await doc.send(
        new DeleteCommand({ TableName: tableName, Key: { PK: emailOverridePK(), SK: emailOverrideSK(key) } })
      );
    },
    // --- Le prix de Nota, décidé par Nota (ADR 0031) -------------------------
    // UN item sur la table PRINCIPALE — la facturation le lit par le repo
    // qu'elle possède déjà, à chaque tarification ; la porte d'écriture de la
    // Lambda admin, bornée par LeadingKeys (infra/admin.tf), est la seule qui
    // le change. Un entier de cents, jamais un taux : l'art. 29.1 du Code de
    // déontologie interdit au notaire une convention où son revenu dépendrait
    // d'une note que Nota lui attribue.
    async getPrixNotaConfig() {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: prixConfigPK(), SK: PRIX_CONFIG_SK } })
      );
      if (!out.Item) return null;
      const { PK, SK, type, ...cfg } = out.Item;
      return cfg;
    },
    async putPrixNotaConfig(cfg, nowISO) {
      const stored = { prixCents: cfg.prixCents, updatedAt: nowISO };
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: prixConfigPK(), SK: PRIX_CONFIG_SK, type: 'prix_nota_config', ...stored },
        })
      );
      return stored;
    },
    async deletePrixNotaConfig() {
      await doc.send(
        new DeleteCommand({ TableName: tableName, Key: { PK: prixConfigPK(), SK: PRIX_CONFIG_SK } })
      );
    },
    // --- Admin-decided cancellation fee barème (ADR 0023) --------------------
    // ONE item on the MAIN table — the cancel route reads it through the repo
    // it already owns; the admin Lambda's LeadingKeys-scoped write door
    // (infra/admin.tf) is the only way it changes.
    async getCancellationConfig() {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: cancellationConfigPK(), SK: CANCELLATION_CONFIG_SK } })
      );
      if (!out.Item) return null;
      const { PK, SK, type, ...cfg } = out.Item;
      return cfg;
    },
    async putCancellationConfig(cfg, nowISO) {
      const stored = {
        paliers: (cfg.paliers || []).map((p) => ({ maxJours: p.maxJours, taux: p.taux })),
        updatedAt: nowISO,
      };
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: cancellationConfigPK(), SK: CANCELLATION_CONFIG_SK, type: 'cancellation_config', ...stored },
        })
      );
      return stored;
    },
    async deleteCancellationConfig() {
      await doc.send(
        new DeleteCommand({ TableName: tableName, Key: { PK: cancellationConfigPK(), SK: CANCELLATION_CONFIG_SK } })
      );
    },

    // Every stored override — one Query over the single CONFIG#EMAIL partition
    // (bounded by the template registry size, a few dozen items at most).
    async listEmailOverrides() {
      const overrides = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :b)',
            ExpressionAttributeValues: { ':pk': emailOverridePK(), ':b': EMAIL_OVERRIDE_PREFIX },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((i) => {
          const { PK, SK, type, ...rec } = i;
          overrides.push(rec);
        });
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return overrides;
    },

    // --- Campagnes ciblées : audience, consentement, fréquence ---------------
    // Trois partitions FIXES sur la table principale (voir keys.js). Aucune de
    // ces portes ne Scanne : un groupe se lit par GetItem, la liste par une
    // Query sur SA partition, et le registre des campagnes par BatchGetItem sur
    // les seules adresses de l'audience. Le coût suit la campagne, pas
    // l'historique — et surtout, la Lambda admin n'a jamais besoin d'un droit
    // de parcours sur la table client.

    async getAudienceGroup(id) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: audienceGroupsPK(), SK: audienceGroupSK(id) } })
      );
      if (!out.Item) return null;
      const { PK, SK, type, ...groupe } = out.Item;
      return { ...groupe, membres: groupe.membres || [] };
    },
    async putAudienceGroup(groupe, updatedAt) {
      const stored = {
        id: String(groupe.id),
        libelle: groupe.libelle || null,
        audience: groupe.audience || null,
        nature: groupe.nature || null,
        membres: (groupe.membres || []).map(lowerEmail).filter(Boolean),
        updatedAt,
      };
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: audienceGroupsPK(), SK: audienceGroupSK(stored.id), type: 'audience_group', ...stored },
        })
      );
      return stored;
    },
    async deleteAudienceGroup(id) {
      await doc.send(
        new DeleteCommand({ TableName: tableName, Key: { PK: audienceGroupsPK(), SK: audienceGroupSK(id) } })
      );
    },
    async listAudienceGroups() {
      const groupes = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :b)',
            ExpressionAttributeValues: { ':pk': audienceGroupsPK(), ':b': AUDIENCE_GROUP_PREFIX },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((i) => {
          const { PK, SK, type, ...groupe } = i;
          groupes.push({ ...groupe, membres: groupe.membres || [] });
        });
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return groupes;
    },

    // La base de consentement LCAP d'une adresse. Le registre n'a pas encore de
    // porte d'écriture publique — quand il en aura une, c'est cet item qu'elle
    // écrira, et `segments.js` le préférera d'office à sa déduction.
    async getEmailConsent(email) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: emailConsentPK(), SK: emailConsentSK(email) } })
      );
      if (!out.Item) return null;
      const { PK, SK, type, ...consent } = out.Item;
      return consent;
    },
    async putEmailConsent(email, consent) {
      const stored = {
        email: lowerEmail(email),
        base: (consent && consent.base) || null,
        at: (consent && consent.at) || null,
        source: (consent && consent.source) || null,
      };
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: emailConsentPK(), SK: emailConsentSK(stored.email), type: 'email_consent', ...stored },
        })
      );
      return stored;
    },

    // Art. 56 1° : le registre du plafond de fréquence. UN item par adresse,
    // écrasé à chaque campagne — comme UNSUB#, ce qui compte est la DERNIÈRE
    // fois, jamais la collection de toutes les fois.
    async markCampaignSent(email, atISO, campaignId) {
      const clean = lowerEmail(email);
      if (!clean) return null;
      const stored = { email: clean, at: atISO, campagneId: campaignId || null };
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: campaignLogPK(), SK: campaignLogSK(clean), type: 'campaign_sent', ...stored },
        })
      );
      return stored;
    },
    async lastCampaignAt(email) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: campaignLogPK(), SK: campaignLogSK(email) } })
      );
      return out.Item ? out.Item.at || null : null;
    },
    // UNE lecture par campagne. BatchGetItem plafonne à 100 clés, donc une
    // audience plus large se découpe — le coût reste celui de l'audience, pas
    // celui de tout ce que Nota a déjà envoyé. Un lot inachevé (UnprocessedKeys)
    // est REPRIS : DynamoDB peut en rendre une partie sous charge, et l'oublier
    // ferait passer un destinataire déjà relancé pour un destinataire neuf —
    // exactement ce que l'art. 56 1° interdit.
    async lastCampaignAtMany(adresses) {
      const out = {};
      const wanted = [];
      for (const a of adresses || []) {
        const clean = lowerEmail(a);
        if (!clean || Object.prototype.hasOwnProperty.call(out, clean)) continue;
        out[clean] = null;
        wanted.push(clean);
      }
      for (let i = 0; i < wanted.length; i += 100) {
        let keys = wanted.slice(i, i + 100).map((e) => ({ PK: campaignLogPK(), SK: campaignLogSK(e) }));
        // Borne dure sur la reprise : un lot qui ne se viderait jamais doit
        // rendre la main plutôt que boucler à l'infini dans une Lambda.
        for (let essai = 0; essai < 5 && keys.length; essai += 1) {
          const res = await doc.send(new BatchGetCommand({ RequestItems: { [tableName]: { Keys: keys } } }));
          for (const item of (res.Responses && res.Responses[tableName]) || []) {
            const email = item.email || String(item.SK || '').replace(/^EMAIL#/, '');
            if (email) out[email] = item.at || null;
          }
          keys = ((res.UnprocessedKeys || {})[tableName] || {}).Keys || [];
        }
      }
      return out;
    },

    // --- Notary console (declines + retained calendar pointers) -------------
    // All Get/Put/Query — no Scan — so the API Lambda's least-privilege policy
    // (dynamodb:GetItem/PutItem/Query only) is unchanged.
    async putDecline(notaryId, bidId) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: declinePK(notaryId, bidId), SK: DECLINE_SK, type: 'decline', notaryId, bidId },
        })
      );
    },
    async wasDeclined(notaryId, bidId) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: declinePK(notaryId, bidId), SK: DECLINE_SK } })
      );
      return !!out.Item;
    },
    async putRetained(notaryId, event) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: notaryPK(notaryId),
            SK: retainedSK(event.dateISO, event.id),
            type: 'retained',
            notaryId,
            id: event.id,
            dateISO: event.dateISO,
            serviceId: event.serviceId,
            montant: event.montant,
          },
        })
      );
    },
    // A client cancelled a retained bid: the signing no longer exists, so the
    // pointer leaves the notary's calendar feed with it.
    async removeRetained(notaryId, event) {
      await doc.send(
        new DeleteCommand({ TableName: tableName, Key: { PK: notaryPK(notaryId), SK: retainedSK(event.dateISO, event.id) } })
      );
    },
    // One Query on the notary's partition for the SK RETAINED# range, paginated.
    async listRetainedByNotary(notaryId) {
      const events = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :b)',
            ExpressionAttributeValues: { ':pk': notaryPK(notaryId), ':b': RETAINED_PREFIX },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((i) =>
          events.push({ id: i.id, dateISO: i.dateISO, serviceId: i.serviceId, montant: i.montant })
        );
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return events;
    },

    // --- Notary evaluation ledger (ADR 0021) --------------------------------
    // The anonymized track record under the notary's own partition: one Put at
    // evaluation submit, one backwards Query (newest first) to list it all.
    async addNotaryEvaluation(notaryId, evaluation) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: notaryPK(notaryId),
            SK: notaryEvalSK(evaluation.createdAt, evaluation.bidId),
            type: 'evaluation',
            notaryId,
            bidId: evaluation.bidId,
            dateISO: evaluation.dateISO,
            serviceId: evaluation.serviceId,
            note: evaluation.note,
            commentaire: evaluation.commentaire || null,
            createdAt: evaluation.createdAt,
          },
        })
      );
    },
    async listNotaryEvaluations(notaryId) {
      const evaluations = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :b)',
            ExpressionAttributeValues: { ':pk': notaryPK(notaryId), ':b': NOTARY_EVAL_PREFIX },
            // createdAt leads the SK, so walking the range backwards IS
            // newest-first — no client-side sort.
            ScanIndexForward: false,
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((i) => {
          const { PK, SK, type, ...evaluation } = i;
          evaluations.push(evaluation);
        });
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return evaluations;
    },

    // --- Notary magic-link login (single-use challenges + rate limit) -------
    // On the MAIN table (see keys.js): the public API Lambda cannot reach the
    // admin table, so the notary console keeps its own challenge/rate-limit
    // records here. Same conditional-consume + TTL design as the admin login.
    async putNotaryLoginChallenge(challenge) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: notaryLoginPK(challenge.challengeId),
            SK: NOTARY_LOGIN_SK,
            type: 'notary_login',
            ...challenge,
          },
        })
      );
    },
    // Atomic single-use consume: SET consumed only while it is still false and
    // unexpired. A replay (or expired link) trips the condition -> null. Mirrors
    // consumeLoginChallenge — `consumed` is a reserved word, so alias it.
    async consumeNotaryLoginChallenge(challengeId, nowMs) {
      try {
        const out = await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: notaryLoginPK(challengeId), SK: NOTARY_LOGIN_SK },
            UpdateExpression: 'SET #consumed = :true',
            ConditionExpression: 'attribute_exists(PK) AND #consumed = :false AND #expiresAt > :now',
            ExpressionAttributeNames: { '#consumed': 'consumed', '#expiresAt': 'expiresAt' },
            ExpressionAttributeValues: { ':true': true, ':false': false, ':now': Number(nowMs) || 0 },
            ReturnValues: 'ALL_NEW',
          })
        );
        const { PK, SK, type, ...rec } = out.Attributes || {};
        return rec;
      } catch (err) {
        if (err && err.name === 'ConditionalCheckFailedException') return null;
        throw err;
      }
    },
    // Fixed-window per-IP login counter with a TTL per window, on the main table.
    async incrNotaryRateCounter(scope, key, windowSec, nowMs) {
      const windowStart = Math.floor(nowMs / 1000 / windowSec);
      const out = await doc.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: notaryRlPK(scope, key), SK: `${NOTARY_RL_SK}#${windowStart}` },
          UpdateExpression: 'ADD #c :one SET #ttl = :ttl',
          ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
          ExpressionAttributeValues: {
            ':one': 1,
            ':ttl': (windowStart + 1) * windowSec + 60,
          },
          ReturnValues: 'UPDATED_NEW',
        })
      );
      return (out.Attributes && out.Attributes.count) || 1;
    },

    // --- Partner code claim (email verification, ADR 0011 fraud-hardening) ---
    // On the MAIN table (see keys.js), under its own PARTNER_CLAIM#/PRL# prefix
    // so a partner claim and a notary login can never be confused. Same
    // conditional-consume + TTL design as the notary/admin login challenge.
    async putPartnerClaim(claim) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: partnerClaimPK(claim.challengeId),
            SK: PARTNER_CLAIM_SK,
            type: 'partner_claim',
            ...claim,
          },
        })
      );
    },
    // Atomic single-use consume: SET consumed only while it is still false and
    // unexpired. A replay (or expired link) trips the condition -> null. Mirrors
    // consumeNotaryLoginChallenge — `consumed` is a reserved word, so alias it.
    async consumePartnerClaim(challengeId, nowMs) {
      try {
        const out = await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: partnerClaimPK(challengeId), SK: PARTNER_CLAIM_SK },
            UpdateExpression: 'SET #consumed = :true',
            ConditionExpression: 'attribute_exists(PK) AND #consumed = :false AND #expiresAt > :now',
            ExpressionAttributeNames: { '#consumed': 'consumed', '#expiresAt': 'expiresAt' },
            ExpressionAttributeValues: { ':true': true, ':false': false, ':now': Number(nowMs) || 0 },
            ReturnValues: 'ALL_NEW',
          })
        );
        const { PK, SK, type, ...rec } = out.Attributes || {};
        return rec;
      } catch (err) {
        if (err && err.name === 'ConditionalCheckFailedException') return null;
        throw err;
      }
    },
    // Fixed-window per-IP counter for the claim request, with a TTL per window.
    async incrPartnerRateCounter(scope, key, windowSec, nowMs) {
      const windowStart = Math.floor(nowMs / 1000 / windowSec);
      const out = await doc.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: partnerRlPK(scope, key), SK: `${PARTNER_RL_SK}#${windowStart}` },
          UpdateExpression: 'ADD #c :one SET #ttl = :ttl',
          ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
          ExpressionAttributeValues: {
            ':one': 1,
            ':ttl': (windowStart + 1) * windowSec + 60,
          },
          ReturnValues: 'UPDATED_NEW',
        })
      );
      return (out.Attributes && out.Attributes.count) || 1;
    },

    // --- Completed-act ledger (idempotency) ---------------------------------
    // Write-once: the ConditionExpression rejects a second completion of the
    // same bid, so a retry never double-charges. Returns false when it already
    // existed (the caller then treats the completion as already done).
    async markActCompleted(bidId, record) {
      try {
        await doc.send(
          new PutCommand({
            TableName: tableName,
            Item: { PK: actPK(bidId), SK: ACT_SK, type: 'act', ...record },
            ConditionExpression: 'attribute_not_exists(PK)',
          })
        );
        return true;
      } catch (err) {
        if (err && err.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    },
    async getActCompletion(bidId) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: actPK(bidId), SK: ACT_SK } })
      );
      if (!out.Item) return null;
      const { PK, SK, type, ...rec } = out.Item;
      return rec;
    },

    // --- Partner referral registry (ADR 0011) -------------------------------
    // Write-once by NORMALIZED code: the code IS the partition key, so the
    // attribute_not_exists condition is the whole uniqueness story — claiming a
    // taken code fails the condition and surfaces as `false` for the handler
    // to arbitrate (same owner -> idempotent, someone else -> 409). NOTE: the
    // usual `type: '<entity>'` discriminator attribute is deliberately absent —
    // the partner's own field is literally named `type` (their professional
    // category, one of REFERRAL.partners) and must round-trip unclobbered; the
    // PARTNER sort key already discriminates the item shape.
    async createPartner(partner) {
      try {
        await doc.send(
          new PutCommand({
            TableName: tableName,
            // Sparse PARTNER GSI1 overload: every claimed code is enumerable by
            // the admin ledger (listPartners) even with zero referrals. Items
            // claimed before this overload lack the attributes until rewritten.
            Item: {
              PK: partnerPK(partner.code),
              SK: PARTNER_SK,
              [GSI1_PK]: PARTNER_GSI1PK,
              [GSI1_SK]: String(partner.code).trim().toUpperCase(),
              ...partner,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          })
        );
        return true;
      } catch (err) {
        if (err && err.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    },
    async getPartner(code) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: partnerPK(code), SK: PARTNER_SK } })
      );
      if (!out.Item) return null;
      const { PK, SK, [GSI1_PK]: _gpk, [GSI1_SK]: _gsk, ...partner } = out.Item;
      return partner;
    },
    // --- Live support threads (ADR 0026) ------------------------------------
    // One item per thread, addressed by the id its signed token carries — a
    // GetItem each way, no index. Last write wins: the thread is only ever
    // rewritten by appending a message to its own latest read.
    async putSupportThread(thread) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: supportPK(thread.id), SK: SUPPORT_SK, type: 'support', ...thread },
        })
      );
      return thread;
    },
    async getSupportThread(id) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: supportPK(id), SK: SUPPORT_SK } })
      );
      if (!out.Item) return null;
      const { PK, SK, ...thread } = out.Item;
      return thread;
    },
    // Every CLAIMED code — one paginated Query on the sparse PARTNER overload.
    // A pre-overload partner item is invisible here (no GSI attributes) until
    // its code is rewritten; the ledger then shows it from its activity only.
    async listPartners() {
      const partners = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: 'GSI1',
            KeyConditionExpression: '#g = :pk',
            ExpressionAttributeNames: { '#g': GSI1_PK },
            ExpressionAttributeValues: { ':pk': PARTNER_GSI1PK },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((it) => {
          const { PK, SK, [GSI1_PK]: _gpk, [GSI1_SK]: _gsk, ...partner } = it;
          partners.push(partner);
        });
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return partners;
    },

    // --- Durable referral earnings (ADR 0011) -------------------------------
    // The money owed is recorded at EVENT time (the retain) as a write-once
    // item in the partner's partition — the key IS the idempotency, so a
    // replayed accept trips the condition and earns nothing twice. Returns true
    // only on the FIRST write. See keys.js for the EARN#/REFEARN shapes.
    async recordReferralEarning({ code, track, refId, montant, at } = {}) {
      // Same normalization as the domain ("eve-roy" IS "EVEROY"), so the
      // earning always lands in the SAME partition as the registered code.
      const clean = normalizeReferralCode(code);
      try {
        await doc.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              PK: partnerPK(clean),
              SK: referralEarnSK(track, refId),
              type: 'refearn',
              [GSI1_PK]: REFEARN_GSI1PK,
              [GSI1_SK]: referralEarnGSI1SK(clean, track, refId),
              code: clean,
              track,
              refId,
              montant,
              at,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          })
        );
        return true;
      } catch (err) {
        if (err && err.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    },
    // All earnings ever recorded — one paginated Query on the sparse REFEARN
    // overload, bounded by the number of real-money events, never a table walk.
    async listReferralEarnings() {
      const events = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: 'GSI1',
            KeyConditionExpression: '#g = :pk',
            ExpressionAttributeNames: { '#g': GSI1_PK },
            ExpressionAttributeValues: { ':pk': REFEARN_GSI1PK },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((it) =>
          events.push({ code: it.code, track: it.track, refId: it.refId, montant: it.montant, at: it.at })
        );
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return events;
    },

    // --- Analytics rollups (STATS#) -----------------------------------------
    // Atomic ADD — commutative, no read-modify-write, so concurrent writers on
    // the hot bid/retain/act paths never race. Requires dynamodb:UpdateItem on
    // the table (granted additively in infra/lambda.tf).
    async applyStatsDeltas(deltas) {
      // Build every counter UpdateItem, then fire them CONCURRENTLY — a fact's
      // global + per-service ADDs are independent, so one round-trip instead of a
      // serial chain keeps the hot write path (POST /bids etc.) fast. Still
      // awaited so the writes land before a possible Lambda freeze.
      const cmds = [];
      for (const d of deltas || []) {
        const names = {};
        const values = {};
        const adds = [];
        let i = 0;
        for (const [k, n] of Object.entries(d.adds || {})) {
          names['#a' + i] = k;
          values[':a' + i] = Number(n || 0);
          adds.push(`#a${i} :a${i}`);
          i += 1;
        }
        if (!adds.length) continue;
        cmds.push(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: d.pk, SK: d.sk },
            UpdateExpression: 'ADD ' + adds.join(', '),
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          })
        );
      }
      await Promise.all(cmds.map((c) => doc.send(c)));
    },
    // Range Query over one STATS# partition, paginated. Items carry PK/SK; the
    // analytics layer reads SK to recover the day.
    async queryStats(pk, skStart, skEnd) {
      const items = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND SK BETWEEN :a AND :b',
            ExpressionAttributeValues: { ':pk': pk, ':a': skStart, ':b': skEnd },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((it) => items.push(it));
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items;
    },
    async getGauge() {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: STATS_GAUGE_PK, SK: STATS_GAUGE_SK } })
      );
      return out.Item || null;
    },

    // --- Admin identities (separate nota-admin table) -----------------------
    async getAdmin(id) {
      const out = await doc.send(new GetCommand({ TableName: adminTable(), Key: { PK: adminPK(id), SK: ADMIN_SK } }));
      if (!out.Item) return null;
      const { PK, SK, type, ...admin } = out.Item;
      return admin;
    },
    async putAdmin(admin) {
      await doc.send(
        new PutCommand({ TableName: adminTable(), Item: { PK: adminPK(admin.id), SK: ADMIN_SK, type: 'admin', ...admin } })
      );
      return admin;
    },

    // --- Groupes d'administrateurs (RBAC découplé) --------------------------
    // Une seule partition, un item par groupe : la liste se lit par UNE Query,
    // jamais par un Scan — la Lambda admin ne doit pas avoir la permission de
    // parcourir toute la table des identités pour afficher trois groupes.
    async getGroup(id) {
      const out = await doc.send(
        new GetCommand({ TableName: adminTable(), Key: { PK: groupsPK(), SK: groupSK(id) } })
      );
      if (!out.Item) return null;
      const { PK, SK, type, ...groupe } = out.Item;
      return groupe;
    },
    async putGroup(groupe, updatedAt) {
      const item = { ...groupe, updatedAt };
      await doc.send(
        new PutCommand({
          TableName: adminTable(),
          Item: { PK: groupsPK(), SK: groupSK(groupe.id), type: 'admin_group', ...item },
        })
      );
      return item;
    },
    async deleteGroup(id) {
      await doc.send(new DeleteCommand({ TableName: adminTable(), Key: { PK: groupsPK(), SK: groupSK(id) } }));
    },
    async listGroups() {
      const groupes = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: adminTable(),
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :b)',
            ExpressionAttributeValues: { ':pk': groupsPK(), ':b': GROUP_PREFIX },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((i) => {
          const { PK, SK, type, ...rec } = i;
          groupes.push(rec);
        });
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return groupes;
    },

    // --- Admin login challenges (single-use magic links) --------------------
    async putLoginChallenge(challenge) {
      await doc.send(
        new PutCommand({
          TableName: adminTable(),
          Item: { PK: adminLoginPK(challenge.challengeId), SK: ADMIN_LOGIN_SK, type: 'login', ...challenge },
        })
      );
    },
    // Atomic single-use consume: SET consumed only while it is still false and
    // unexpired. A replay (or expired link) trips the condition -> null.
    async consumeLoginChallenge(challengeId, nowMs) {
      try {
        const out = await doc.send(
          new UpdateCommand({
            TableName: adminTable(),
            Key: { PK: adminLoginPK(challengeId), SK: ADMIN_LOGIN_SK },
            // `consumed` is a DynamoDB RESERVED WORD — it MUST be aliased or the
            // whole magic-link verify throws ValidationException. Alias every
            // attribute referenced in an expression, defensively.
            UpdateExpression: 'SET #consumed = :true',
            ConditionExpression: 'attribute_exists(PK) AND #consumed = :false AND #expiresAt > :now',
            ExpressionAttributeNames: { '#consumed': 'consumed', '#expiresAt': 'expiresAt' },
            ExpressionAttributeValues: { ':true': true, ':false': false, ':now': Number(nowMs) || 0 },
            ReturnValues: 'ALL_NEW',
          })
        );
        const { PK, SK, type, ...rec } = out.Attributes || {};
        return rec;
      } catch (err) {
        if (err && err.name === 'ConditionalCheckFailedException') return null;
        throw err;
      }
    },

    // --- Admin sessions (revocable, server-side) ----------------------------
    async putAdminSession(session) {
      await doc.send(
        new PutCommand({
          TableName: adminTable(),
          Item: { PK: adminSessionPK(session.sessionId), SK: ADMIN_SESSION_SK, type: 'session', ...session },
        })
      );
    },
    async getAdminSession(sessionId) {
      const out = await doc.send(
        new GetCommand({ TableName: adminTable(), Key: { PK: adminSessionPK(sessionId), SK: ADMIN_SESSION_SK } })
      );
      if (!out.Item) return null;
      const { PK, SK, type, ...session } = out.Item;
      return session;
    },
    async touchAdminSession(sessionId, lastSeenMs, absoluteExpiresAt) {
      const values = { ':t': Number(lastSeenMs) };
      const names = { '#lastSeenAt': 'lastSeenAt' };
      let expr = 'SET #lastSeenAt = :t';
      if (typeof absoluteExpiresAt === 'number') {
        expr += ', #absoluteExpiresAt = :a';
        names['#absoluteExpiresAt'] = 'absoluteExpiresAt';
        values[':a'] = absoluteExpiresAt;
      }
      await doc.send(
        new UpdateCommand({
          TableName: adminTable(),
          Key: { PK: adminSessionPK(sessionId), SK: ADMIN_SESSION_SK },
          UpdateExpression: expr,
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        })
      ).catch((err) => {
        if (!(err && err.name === 'ConditionalCheckFailedException')) throw err;
      });
    },
    async revokeAdminSession(sessionId, at) {
      await doc.send(
        new UpdateCommand({
          TableName: adminTable(),
          Key: { PK: adminSessionPK(sessionId), SK: ADMIN_SESSION_SK },
          UpdateExpression: 'SET #revokedAt = :at',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#revokedAt': 'revokedAt' },
          ExpressionAttributeValues: { ':at': at || new Date().toISOString() },
        })
      ).catch((err) => {
        if (!(err && err.name === 'ConditionalCheckFailedException')) throw err;
      });
    },

    // --- Piste d'audit des TRANSACTIONS, sur la table PRINCIPALE -------------
    // Le journal administratif vit dans la table admin, à laquelle la Lambda
    // publique n'a — délibérément — aucun accès. Une trace de règlement écrite
    // là-bas ne s'écrit donc jamais en production : l'appel lève, le `catch`
    // best-effort l'avale, et l'audit n'existe que dans les tests. Les
    // événements d'argent vivent donc ici, dans la table principale, où la
    // Lambda publique a déjà `PutItem` — et la console admin, qui lit cette
    // table, les fusionne avec son propre journal.
    async appendTxAudit(entry) {
      const day = entry.day || String(entry.ts || '').slice(0, 10);
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: auditPK(day), SK: auditSK(entry.ts, entry.id), type: 'audit', day, ...entry, ...auditTtl(entry) },
          ConditionExpression: 'attribute_not_exists(PK) OR attribute_not_exists(SK)',
        })
      ).catch((err) => {
        if (!(err && err.name === 'ConditionalCheckFailedException')) throw err;
      });
    },
    async queryTxAuditByDay(dayISO) {
      const items = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': auditPK(dayISO) },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((i) => {
          const { PK, SK, type, ...entry } = i;
          items.push(entry);
        });
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items;
    },

    // --- Audit log (append-only) --------------------------------------------
    async appendAudit(entry) {
      // Même règle que l'adaptateur mémoire : le jour ouvrable nommé par
      // l'appelant fait foi, l'horodatage sinon.
      const day = entry.day || String(entry.ts || '').slice(0, 10);
      await doc.send(
        new PutCommand({
          TableName: adminTable(),
          Item: { PK: auditPK(day), SK: auditSK(entry.ts, entry.id), type: 'audit', day, ...entry, ...auditTtl(entry) },
          ConditionExpression: 'attribute_not_exists(PK) OR attribute_not_exists(SK)',
        })
      ).catch((err) => {
        // A colliding (ts,id) is astronomically unlikely; never let audit block.
        if (!(err && err.name === 'ConditionalCheckFailedException')) throw err;
      });
    },
    async queryAuditByDay(dayISO) {
      const items = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: adminTable(),
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': auditPK(dayISO) },
            ExclusiveStartKey,
          })
        );
        (out.Items || []).forEach((it) => {
          const { PK, SK, type, ...rec } = it;
          items.push(rec);
        });
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items;
    },

    // --- Rate limiting (fixed window, TTL'd counter) ------------------------
    async incrRateCounter(scope, key, windowSec, nowMs) {
      const windowStart = Math.floor(nowMs / 1000 / windowSec);
      const out = await doc.send(
        new UpdateCommand({
          TableName: adminTable(),
          Key: { PK: adminRlPK(scope, key), SK: `${ADMIN_RL_SK}#${windowStart}` },
          UpdateExpression: 'ADD #c :one SET #ttl = :ttl',
          ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
          ExpressionAttributeValues: {
            ':one': 1,
            ':ttl': (windowStart + 1) * windowSec + 60,
          },
          ReturnValues: 'UPDATED_NEW',
        })
      );
      return (out.Attributes && out.Attributes.count) || 1;
    },
  };
}

module.exports = { createDynamoRepo };
