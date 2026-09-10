'use strict';

// The learning log is an append-only, metadata-only signal stream. It is
// intentionally separate from the private AI analysis: the latter is needed
// to serve the notary, while this stream is used to measure and improve the
// system. Raw dossier values, page text and chat text are hashed in memory and
// never written to the audit record.
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const D = require('@nota/domain');

const EVENT_VERSION = '2026-09-09.1';
const DATASET_VERSION = '2026-09-09.1';
const SYSTEM_ACTOR = Object.freeze({ type: 'systeme', id: null });
const CLIENT_ACTOR = 'client';
const NOTARY_ACTOR = 'notaire';
const SYSTEM_ACTOR_TYPE = 'systeme';
const DIRECTIONS = new Set(['client_to_notary', 'notary_to_client']);
const BEHAVIOURS = new Set([
  'dossier_update', 'document_upload', 'read_receipt', 'follow_up_response',
  'processing_authorization', 'evaluation_submitted',
]);
const SAFE_STATUS = new Set(['completed', 'settled', 'paid', 'cancelled', 'reconciled', 'unknown']);
const SERVICE_IDS = new Set(['financement', 'refinancement', 'testament', 'procuration']);

function sha256(value) {
  return 'sha256:' + createHash('sha256').update(String(value)).digest('hex');
}

function hashJson(value) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { serialized = '[unserializable]'; }
  return sha256(serialized == null ? 'null' : serialized);
}

function textMeta(value, max = 10000) {
  const text = typeof value === 'string' ? value : '';
  return { sha256: sha256(text), length: Math.min(text.length, max), truncated: text.length > max };
}

function safeId(value, max = 120) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function safeIds(values, max = 64) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => safeId(value))
    .filter(Boolean))].slice(0, max);
}

function boundedInteger(value, min = 0, max = 86400) {
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function boundedNumber(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function isoAt(nowMs) {
  const value = Number(typeof nowMs === 'function' ? nowMs() : nowMs);
  const date = new Date(Number.isFinite(value) ? value : Date.now());
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function serviceOf(bid, serviceId) {
  const candidate = bid?.serviceId || serviceId;
  return SERVICE_IDS.has(candidate) ? candidate : null;
}

function actor(type, id = null) {
  return { type, id: id == null ? null : String(id) };
}

function pagesSummary(input) {
  const pages = Array.isArray(input?.pages) ? input.pages : [];
  const documents = [...new Set(pages.map(page => safeId(page?.documentId)).filter(Boolean))];
  const totalChars = pages.reduce((sum, page) => sum + (typeof page?.text === 'string' ? page.text.length : 0), 0);
  return {
    inputSha256: hashJson(input || null),
    pageCount: pages.length,
    documentCount: documents.length,
    documentIdsSha256: hashJson(documents),
    totalChars: Math.min(totalChars, 1000000),
  };
}

function fieldSummary(preparation) {
  const fields = Array.isArray(preparation?.fields) ? preparation.fields : [];
  return {
    proposalCount: fields.length,
    fieldIds: safeIds(fields.map(field => field?.fieldId)),
    missingFieldIds: safeIds(preparation?.missing),
    conflictFieldIds: safeIds(preparation?.conflicts),
    evidenceCount: fields.reduce((sum, field) => sum + (Array.isArray(field?.evidence) ? field.evidence.length : 0), 0),
    outputSha256: hashJson(preparation || null),
  };
}

function readinessMeta(readiness) {
  if (!readiness || typeof readiness !== 'object') return null;
  return {
    total: boundedInteger(readiness.total, 0, 10000),
    done: boundedInteger(readiness.done, 0, 10000),
    missingCount: Array.isArray(readiness.missing) ? readiness.missing.length : null,
    requiredMissingCount: Array.isArray(readiness.requis) ? readiness.requis.length : null,
    consent: readiness.consent === true,
    ready: readiness.ready === true,
  };
}

function dossierKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value)
    .filter(key => key !== '__pricing' && key !== '__consent' && !key.startsWith('__'))
    .map(key => safeId(key))
    .filter(Boolean)
    .sort();
}

function diffKeys(before, after) {
  const oldKeys = new Set(dossierKeys(before));
  const newKeys = new Set(dossierKeys(after));
  const changedFieldIds = [...new Set([...oldKeys, ...newKeys])]
    .filter(key => hashJson(before?.[key]) !== hashJson(after?.[key]));
  return {
    addedFieldIds: [...newKeys].filter(key => !oldKeys.has(key)),
    removedFieldIds: [...oldKeys].filter(key => !newKeys.has(key)),
    changedFieldIds,
    retainedFieldCount: [...newKeys].filter(key => oldKeys.has(key)).length,
  };
}

function responseLatencySeconds(priorMessages, message) {
  const messages = Array.isArray(priorMessages) ? priorMessages : [];
  const direction = message?.de === D.CHAT_FROM?.CLIENT ? 'client_to_notary'
    : message?.de === D.CHAT_FROM?.NOTAIRE ? 'notary_to_client' : null;
  if (!direction || !message?.createdAt) return null;
  const opposite = direction === 'client_to_notary' ? D.CHAT_FROM?.NOTAIRE : D.CHAT_FROM?.CLIENT;
  const previous = [...messages].reverse().find(item => item?.de === opposite && typeof item.createdAt === 'string');
  if (!previous) return null;
  const delta = Date.parse(message.createdAt) - Date.parse(previous.createdAt);
  if (!Number.isFinite(delta) || delta < 0) return null;
  return boundedInteger(Math.round(delta / 1000), 0, 7 * 24 * 60 * 60);
}

function reviewSummary(analysis, review) {
  const fields = Array.isArray(analysis?.preparation?.fields) ? analysis.preparation.fields : [];
  const decisions = Array.isArray(review?.decisions) ? review.decisions : [];
  const normalized = decisions.map(decision => {
    const field = fields[decision?.index];
    return {
      index: Number.isInteger(decision?.index) ? decision.index : null,
      fieldId: safeId(field?.fieldId),
      decision: ['accepted', 'corrected', 'rejected'].includes(decision?.decision) ? decision.decision : 'unknown',
      ...(decision?.decision === 'corrected' ? { correctedValue: textMeta(decision.value, 1000) } : {}),
      ...(decision?.reason ? { reason: textMeta(decision.reason, 500) } : {}),
    };
  });
  const counts = normalized.reduce((out, item) => {
    if (item.decision === 'accepted') out.accepted += 1;
    if (item.decision === 'corrected') out.corrected += 1;
    if (item.decision === 'rejected') out.rejected += 1;
    return out;
  }, { accepted: 0, corrected: 0, rejected: 0 });
  const total = counts.accepted + counts.corrected + counts.rejected;
  const preferenceScore = total ? Number(((counts.accepted - counts.corrected - counts.rejected) / total).toFixed(4)) : 0;
  return {
    analysisId: safeId(analysis?.id), proposalCount: fields.length,
    decisions: normalized, counts,
    activeReviewSeconds: boundedInteger(review?.activeReviewSeconds, 0, 86400),
    preference: {
      label: 'notary_field_preference',
      labelScope: 'extraction_preference_only',
      score: preferenceScore,
    },
  };
}

function safeUsage(usage) {
  return {
    inputTokens: boundedInteger(usage?.in, 0, 10000000),
    outputTokens: boundedInteger(usage?.out, 0, 10000000),
    reported: usage?.reported === true,
  };
}

function safePerformance(performance) {
  return {
    provider: safeId(performance?.provider, 40),
    region: safeId(performance?.region, 80),
    latencyMs: boundedInteger(performance?.latencyMs, 0, 120000),
    usage: safeUsage(performance?.usage),
  };
}

function clonePolicy(kind) {
  const policy = D.notaryLearningPolicyFor(kind);
  return policy ? { ...policy, allowedUses: [...policy.allowedUses] } : null;
}

function normalizeOptions(options = {}) {
  return {
    authorizedDataUse: options.authorizedDataUse === true,
    deidentified: options.deidentified === true,
    approvedBy: typeof options.approvedBy === 'string' && options.approvedBy.trim().length > 0,
    frozenQualificationSet: options.frozenQualificationSet === true,
    qualificationPassed: options.qualificationPassed === true,
    rollbackPlan: options.rollbackPlan === true,
  };
}

function gateReasons(gates) {
  return Object.entries(gates).filter(([, value]) => !value).map(([key]) => key);
}

function extractionValidator(serviceId, input, extraction) {
  if (!SERVICE_IDS.has(serviceId)) return { ok: false, errors: [{ code: 'service_inconnu' }] };
  const source = extraction && typeof extraction === 'object' && Array.isArray(extraction.fields)
    ? { fields: extraction.fields } : extraction;
  return serviceId === 'financement' || serviceId === 'refinancement'
    ? D.validateFinancingAIExtraction(input, source)
    : D.validateActAIExtraction(input, source);
}

function inputValidator(serviceId, input) {
  return serviceId === 'financement' || serviceId === 'refinancement'
    ? D.validateFinancingAIInput(input)
    : D.validateActAIInput(input);
}

function reviewForCandidate(candidate, review) {
  if (!review || review.notaryVerified !== true ||
      typeof review.verifiedBy !== 'string' || !review.verifiedBy.trim()) return { ok: false, reasons: ['notary_verification_required'] };
  const decisions = Array.isArray(review.decisions) ? review.decisions : [];
  if (decisions.length !== candidate.fields.length) return { ok: false, reasons: ['complete_review_required'] };
  const seen = new Set();
  for (const decision of decisions) {
    if (!Number.isInteger(decision?.index) || decision.index < 0 || decision.index >= candidate.fields.length || seen.has(decision.index)) {
      return { ok: false, reasons: ['review_index_invalid'] };
    }
    seen.add(decision.index);
    if (!['accepted', 'corrected', 'rejected'].includes(decision.decision)) return { ok: false, reasons: ['review_decision_invalid'] };
  }
  return { ok: true, decisions };
}

function preferenceExample(record, candidate, verified, review, index) {
  const labels = [];
  const rejected = [];
  const verifiedByField = new Map();
  for (const field of verified.fields) {
    const list = verifiedByField.get(field.fieldId) || [];
    list.push(field);
    verifiedByField.set(field.fieldId, list);
  }
  for (const decision of review.decisions) {
    const field = candidate.fields[decision.index];
    const values = verifiedByField.get(field.fieldId) || [];
    if (decision.decision === 'accepted') {
      if (!values.some(value => value.value === field.value)) return { ok: false, reason: 'accepted_value_not_verified' };
    } else if (decision.decision === 'corrected') {
      if (!values.some(value => value.value !== field.value)) return { ok: false, reason: 'corrected_value_not_verified' };
    } else if (decision.decision === 'rejected') {
      if (values.length) return { ok: false, reason: 'rejected_value_present_in_verified_extraction' };
    }
    labels.push({ fieldId: field.fieldId, decision: decision.decision });
  }
  for (const field of verified.fields) {
    if (!candidate.fields.some(candidateField => candidateField.fieldId === field.fieldId)) {
      return { ok: false, reason: 'verified_field_not_in_candidate' };
    }
  }
  if (isDeepStrictEqual(candidate, verified)) return { ok: false, reason: 'no_preference_delta' };
  for (const field of candidate.fields) {
    rejected.push({ fieldId: field.fieldId, value: field.value, evidence: field.evidence });
  }
  const accepted = verified.fields.map(field => ({ fieldId: field.fieldId, value: field.value, evidence: field.evidence }));
  const counts = labels.reduce((out, label) => {
    out[label.decision] = (out[label.decision] || 0) + 1;
    return out;
  }, { accepted: 0, corrected: 0, rejected: 0 });
  const total = labels.length || 1;
  return {
    ok: true,
    example: {
      id: 'preference-' + sha256(JSON.stringify([record.serviceId, record.input, candidate, verified, index])).slice(-32),
      serviceId: record.serviceId,
      inputSha256: hashJson(record.input),
      provenanceSha256: hashJson(record.provenance || null),
      chosen: { fields: accepted },
      rejected: { fields: rejected },
      labels,
      reward: {
        label: 'notary_field_preference',
        scope: 'extraction_preference_only',
        acceptedRate: Number((counts.accepted / total).toFixed(4)),
        correctionRate: Number((counts.corrected / total).toFixed(4)),
        rejectionRate: Number((counts.rejected / total).toFixed(4)),
      },
    },
  };
}

/**
 * Builds a candidate offline preference dataset. This function does not call a
 * model or update weights. Every gate is explicit because a customer action or
 * a chat outcome is not a legal label; only a separately verified notary
 * extraction can become a field-level preference pair.
 */
function buildNotaryPreferenceDataset(records, options = {}) {
  const gates = normalizeOptions(options);
  const reasons = gateReasons(gates);
  const inputRecords = Array.isArray(records) ? records : [];
  const result = {
    datasetVersion: DATASET_VERSION,
    learningProgramVersion: D.NOTARY_LEARNING_POLICY_VERSION,
    learningMethod: 'offline_preference_optimization',
    reinforcementSignals: 'collected',
    weightUpdate: 'not_started',
    trainingEligible: reasons.length === 0 && inputRecords.length > 0,
    labelScope: 'extraction_preference_only',
    customerSignals: 'weak_auxiliary_only',
    authorization: {
      authorizedDataUse: gates.authorizedDataUse,
      deidentified: gates.deidentified,
      approvedByPresent: gates.approvedBy,
      approvedBySha256: gates.approvedBy ? sha256(options.approvedBy.trim()) : null,
      frozenQualificationSet: gates.frozenQualificationSet,
      qualificationPassed: gates.qualificationPassed,
      rollbackPlan: gates.rollbackPlan,
    },
    gateFailures: reasons,
    examples: [],
    rejectedRecords: [],
  };
  if (reasons.length || !inputRecords.length) {
    if (!inputRecords.length && !result.gateFailures.includes('records')) result.gateFailures.push('records');
    result.trainingEligible = false;
    result.status = 'blocked_until_authorized_offline_review';
    return result;
  }

  inputRecords.forEach((record, index) => {
    const serviceId = record?.serviceId;
    const input = record?.input;
    const candidateExtraction = record?.candidateExtraction;
    const verifiedExtraction = record?.verifiedExtraction;
    const rejected = { index, serviceId: SERVICE_IDS.has(serviceId) ? serviceId : null, recordSha256: hashJson(record), reasons: [] };
    const checkedInput = inputValidator(serviceId, input);
    if (!checkedInput.ok) rejected.reasons.push('input_invalid');
    const candidate = checkedInput.ok ? extractionValidator(serviceId, checkedInput.value, candidateExtraction) : { ok: false };
    const verified = checkedInput.ok ? extractionValidator(serviceId, checkedInput.value, verifiedExtraction) : { ok: false };
    if (!candidate.ok) rejected.reasons.push('candidate_invalid');
    if (!verified.ok) rejected.reasons.push('verified_invalid');
    const reviewed = candidate.ok ? reviewForCandidate(candidate.value, record.review) : { ok: false, reasons: [] };
    if (!reviewed.ok) rejected.reasons.push(...reviewed.reasons);
    if (!rejected.reasons.length) {
      const example = preferenceExample(record, candidate.value, verified.value, reviewed, index);
      if (!example.ok) rejected.reasons.push(example.reason);
      else result.examples.push(example.example);
    }
    if (rejected.reasons.length) result.rejectedRecords.push(rejected);
  });
  result.trainingEligible = result.examples.length > 0 && result.rejectedRecords.length === 0;
  result.status = result.trainingEligible ? 'eligible_for_offline_training_approval' : 'blocked_until_qualified_examples_only';
  if (!result.trainingEligible) result.gateFailures.push('all_records_must_be_valid_verified_preference_pairs');
  result.metrics = { inputRecords: inputRecords.length, examples: result.examples.length, rejected: result.rejectedRecords.length };
  return result;
}

function createNotaryLearning({ nowMs = Date.now, newId, append = async () => {} } = {}) {
  const idFactory = typeof newId === 'function' ? newId : () => require('node:crypto').randomUUID();

  async function record(kind, data, { bid = null, serviceId = null, actor: eventActor = SYSTEM_ACTOR, id = null } = {}) {
    if (!D.NOTARY_LEARNING_EVENT_KINDS.includes(kind) || !clonePolicy(kind)) return null;
    const event = {
      eventVersion: EVENT_VERSION,
      id: safeId(id, 160) || String(idFactory()),
      at: isoAt(nowMs),
      kind,
      serviceId: serviceOf(bid, serviceId),
      bidId: safeId(bid?.id),
      signalPolicy: clonePolicy(kind),
      training: {
        eligible: false,
        status: 'candidate',
        reason: 'requires_authorized_deidentified_notary_label',
      },
      data: data || {},
    };
    // Keep a malformed caller from turning the audit stream into an unbounded
    // data store. The values were already reduced above; this is a final guard.
    let size;
    try { size = JSON.stringify(event).length; } catch { return null; }
    if (size > 48000) return null;
    try {
      await append(event, eventActor || SYSTEM_ACTOR);
      return event;
    } catch {
      // Learning is strictly best-effort. A failed telemetry write must never
      // make an act, a message or a notary review fail.
      return null;
    }
  }

  return {
    record,
    async aiOutput({ bid, analysis, input, owner, reused = false } = {}) {
      const preparation = analysis?.preparation;
      return record('ai_output', {
        analysisId: safeId(analysis?.id),
        reused: reused === true,
        input: pagesSummary(input),
        output: fieldSummary(preparation),
        provenance: {
          model: safeId(analysis?.provenance?.model, 160),
          promptSha256: safeId(analysis?.provenance?.promptSha256, 100),
          inputSha256: safeId(analysis?.provenance?.inputSha256, 100),
          knowledgeVersion: safeId(analysis?.provenance?.knowledgeVersion, 80),
        },
        performance: safePerformance(analysis?.performance),
        preparedByPresent: typeof owner === 'string' && owner.length > 0,
      }, { bid, actor: typeof owner === 'string' && owner ? actor(NOTARY_ACTOR, owner) : SYSTEM_ACTOR });
    },
    async notaryReview({ bid, analysis, review, owner } = {}) {
      return record('notary_review', reviewSummary(analysis, review), { bid, actor: actor(NOTARY_ACTOR, owner) });
    },
    async uncertaintyFeedback({ bid, analysis, feedback, owner, eventId } = {}) {
      const value = feedback && typeof feedback === 'object' ? feedback : {};
      return record('notary_question', {
        analysisId: safeId(analysis?.id),
        questionId: safeId(value.questionId),
        fieldId: safeId(value.fieldId),
        questionKind: safeId(value.kind),
        decision: ['confirmed', 'resolved', 'not_applicable', 'escalated'].includes(value.decision) ? value.decision : 'unknown',
        ...(value.note ? { note: textMeta(value.note, 500) } : {}),
      }, { bid, actor: actor(NOTARY_ACTOR, owner), id: eventId });
    },
    async customerInput({ bid, before, after, readiness, beforeReadiness } = {}) {
      const diff = diffKeys(before, after);
      const beforeReady = readinessMeta(beforeReadiness || before?.__readiness);
      const afterReady = readinessMeta(readiness);
      return record('customer_input', {
        ...diff,
        beforeFieldCount: dossierKeys(before).length,
        afterFieldCount: dossierKeys(after).length,
        readiness: afterReady,
        completionDelta: beforeReady && afterReady && beforeReady.done != null && afterReady.done != null
          ? afterReady.done - beforeReady.done : null,
      }, { bid, actor: actor(CLIENT_ACTOR, bid?.id) });
    },
    async customerBehavior({ bid, behavior, metadata = {} } = {}) {
      const eventType = safeId(behavior, 60);
      if (!BEHAVIOURS.has(eventType)) return null;
      const data = {
        eventType,
        metadata: {
          documentCount: boundedInteger(metadata.documentCount, 0, 1000),
          responseLatencySeconds: boundedInteger(metadata.responseLatencySeconds, 0, 604800),
          completed: metadata.completed === true,
          authorized: metadata.authorized === true,
        },
      };
      return record('customer_behavior', data, { bid, actor: actor(CLIENT_ACTOR, bid?.id) });
    },
    async communication({ bid, direction, message, createdAt, priorMessages = [], locale } = {}) {
      if (!DIRECTIONS.has(direction)) return null;
      const turnNumber = (Array.isArray(priorMessages) ? priorMessages.length : 0) + 1;
      const messageText = typeof message === 'object' && message !== null ? (message.texte || message.text) : message;
      const messageMeta = textMeta(messageText, 10000);
      return record('communication', {
        direction,
        turnNumber: boundedInteger(turnNumber, 1, 10000),
        locale: safeId(locale, 20),
        message: messageMeta,
        responseLatencySeconds: responseLatencySeconds(priorMessages, {
          de: direction === 'client_to_notary' ? D.CHAT_FROM?.CLIENT : D.CHAT_FROM?.NOTAIRE,
          createdAt: createdAt || (typeof message === 'object' && message !== null ? message.createdAt : null) || new Date(typeof nowMs === 'function' ? nowMs() : Date.now()).toISOString(),
        }),
      }, { bid, actor: actor(direction === 'client_to_notary' ? CLIENT_ACTOR : NOTARY_ACTOR, direction === 'client_to_notary' ? bid?.id : bid?.notaryId) });
    },
    async officialOutcome({ bid, outcome, owner } = {}) {
      const status = SAFE_STATUS.has(outcome?.status) ? outcome.status : 'unknown';
      return record('official_outcome', {
        status,
        completed: outcome?.completed === true || status === 'completed',
        paid: outcome?.paid === true || status === 'paid',
        reconciled: outcome?.reconciled === true || status === 'reconciled',
        retryable: outcome?.retryable === true,
        ownerPresent: typeof owner === 'string' && owner.length > 0,
      }, { bid, actor: typeof owner === 'string' && owner ? actor(NOTARY_ACTOR, owner) : SYSTEM_ACTOR });
    },
    async clientFeedback({ bid, evaluation } = {}) {
      return record('client_feedback', {
        rating: boundedInteger(evaluation?.note, 1, 5),
        comment: textMeta(evaluation?.commentaire, 1000),
      }, { bid, actor: actor(CLIENT_ACTOR, bid?.id) });
    },
    buildNotaryPreferenceDataset,
  };
}

module.exports = {
  EVENT_VERSION,
  DATASET_VERSION,
  buildNotaryPreferenceDataset,
  createNotaryLearning,
  hashJson,
};
