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
  declinePK,
  DECLINE_SK,
  retainedSK,
  RETAINED_PREFIX,
  STATS_GAUGE_PK,
  STATS_GAUGE_SK,
  actPK,
  ACT_SK,
  adminPK,
  ADMIN_SK,
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
} = require('./keys');
const { STATUS } = require('@nota/domain');

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
  const { PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

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

  function toItem(bid) {
    const item = { PK: bidPK(bid.dateISO), SK: bidSK(bid), type: 'bid', ...bid };
    // Sparse GSI1 membership: ONLY open (not-retained) bids are indexed, so the
    // daily reminder worker Queries just the open set instead of Scanning the
    // whole table. A retained bid omits these attributes — and because every bid
    // mutation rewrites the full item (PutCommand), retaining a bid drops it out
    // of the index automatically.
    if (bid.status !== STATUS.RETENUE) {
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
      const updated = { ...bid, paymentStatus: 'void', voidedAt: (patch && patch.voidedAt) || null };
      await doc.send(new PutCommand({ TableName: tableName, Item: toItem(updated) }));
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
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: notaryPK(notary.id), SK: NOTARY_SK, type: 'notary', ...notary },
        })
      );
      return notary;
    },
    async getNotary(id) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: notaryPK(id), SK: NOTARY_SK } })
      );
      if (!out.Item) return null;
      const { PK, SK, type, ...notary } = out.Item;
      return notary;
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

    // --- Audit log (append-only) --------------------------------------------
    async appendAudit(entry) {
      const day = String(entry.ts || '').slice(0, 10);
      await doc.send(
        new PutCommand({
          TableName: adminTable(),
          Item: { PK: auditPK(day), SK: auditSK(entry.ts, entry.id), type: 'audit', day, ...entry },
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
