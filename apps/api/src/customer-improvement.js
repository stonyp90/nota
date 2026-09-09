'use strict';

/**
 * Bounded autonomous customer-experience improvement.
 *
 * This worker reads aggregate funnel counters and the already-minimized
 * notary-learning signal stream. It can change one reversible public UX mode
 * (`standard` / `guided`) after a minimum sample, and can roll that change
 * back when the comparison window regresses. It never trains weights, changes
 * legal rules, edits notary controls, changes prices or sends outreach.
 */
const domain = require('@nota/domain');
const { STATS_SHARDS, statsGlobalPK, statsDaySK } = require('./keys');
const { FUNNEL_COUNTER_PREFIX } = require('./stats');

const MAX_DAYS = 31;
const MAX_AUDIT_EVENTS_PER_WINDOW = 20000;
const IMPROVEMENT_ACTOR = { type: 'systeme', id: 'customer-improvement' };

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function integer(value) {
  return Math.min(Math.floor(number(value)), 1000000000);
}

function validDay(value) {
  const day = String(value == null ? '' : value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day + 'T00:00:00Z'));
}

function shiftDay(dayISO, amount) {
  if (!validDay(dayISO)) return null;
  return new Date(Date.parse(dayISO + 'T00:00:00Z') + amount * 86400000).toISOString().slice(0, 10);
}

// Returns complete days only. The current civil day is excluded because its
// counters and audit events are still arriving while the worker runs.
function completeDaysBefore(anchorISO, count, skip = 1) {
  const total = Math.max(0, Math.min(Math.floor(Number(count) || 0), MAX_DAYS));
  const gap = Math.max(1, Math.floor(Number(skip) || 1));
  const out = [];
  for (let i = total + gap - 1; i >= gap; i -= 1) {
    const day = shiftDay(anchorISO, -i);
    if (day) out.push(day);
  }
  return out;
}

function emptyRaw() {
  return { offers: 0, funnel: {}, funnelIds: new Set(), audits: [] };
}

function mergeStats(raw, item) {
  if (!item || typeof item !== 'object') return;
  raw.offers += integer(item.offers);
  for (const [key, value] of Object.entries(item)) {
    if (!key.startsWith(FUNNEL_COUNTER_PREFIX)) continue;
    const id = key.slice(FUNNEL_COUNTER_PREFIX.length);
    if (!id || !domain.isFunnelEvent(id)) continue;
    raw.funnel[id] = (raw.funnel[id] || 0) + integer(value);
    raw.funnelIds.add(id);
  }
}

function addLatency(state, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 604800) return;
  state.latencyTotal += n;
  state.latencyCount += 1;
}

function readLearningSignal(state, entry) {
  if (!entry || entry.action !== 'notary_learning_signal') return;
  const event = entry.meta && typeof entry.meta === 'object' ? entry.meta : null;
  const data = event && event.data && typeof event.data === 'object' ? event.data : {};
  switch (event && event.kind) {
    case 'customer_input':
      state.customerInputEvents += 1;
      break;
    case 'customer_behavior': {
      state.customerBehaviourEvents += 1;
      const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
      addLatency(state, metadata.responseLatencySeconds);
      break;
    }
    case 'communication':
      state.communicationEvents += 1;
      addLatency(state, data.responseLatencySeconds);
      break;
    case 'ai_output':
      state.aiOutputEvents += 1;
      break;
    case 'official_outcome':
      state.officialOutcomeEvents += 1;
      break;
    case 'client_feedback': {
      const rating = Number(data.rating);
      if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
        state.feedbackCount += 1;
        state.ratingTotal += rating;
        if (rating <= domain.CUSTOMER_IMPROVEMENT_POLICY.thresholds.lowRating) state.lowFeedbackCount += 1;
      }
      break;
    }
    default:
      break;
  }
}

function summarizeRaw(raw) {
  const formStarts = integer(raw.funnel.formulaire);
  const publicationAttempts = integer(raw.funnel.publication_tentee);
  // `offers` is the authoritative legacy counter. The funnel publication
  // counter is preferred when it exists; this keeps the worker useful while
  // older days are still present without the server-only funnel event.
  const publications = raw.funnelIds.has('publie') ? integer(raw.funnel.publie) : integer(raw.offers);
  const blockedAttempts = integer(raw.funnel.formulaire_bloque);
  const publicationFailures = integer(raw.funnel.publication_echouee);
  const signal = raw.signal || {
    customerInputEvents: 0, customerBehaviourEvents: 0, communicationEvents: 0,
    aiOutputEvents: 0, officialOutcomeEvents: 0, feedbackCount: 0,
    lowFeedbackCount: 0, ratingTotal: 0, latencyTotal: 0, latencyCount: 0,
  };
  const feedbackCount = integer(signal.feedbackCount);
  const metrics = domain.experienceMetrics({
    formStarts,
    publicationAttempts,
    publications,
    blockedAttempts,
    publicationFailures,
    customerInputEvents: signal.customerInputEvents,
    customerBehaviourEvents: signal.customerBehaviourEvents,
    communicationEvents: signal.communicationEvents,
    aiOutputEvents: signal.aiOutputEvents,
    officialOutcomeEvents: signal.officialOutcomeEvents,
    feedbackCount,
    lowFeedbackCount: signal.lowFeedbackCount,
    blockedRate: formStarts ? blockedAttempts / formStarts : 0,
    publicationProxy: formStarts ? publications / formStarts : null,
    publicationFailureRate: publicationAttempts ? publicationFailures / publicationAttempts : 0,
    averageRating: feedbackCount ? signal.ratingTotal / feedbackCount : null,
    responseLatencySeconds: signal.latencyCount ? signal.latencyTotal / signal.latencyCount : null,
    learningSignalEvents: signal.events,
    learningSignalsTruncated: signal.truncated,
  });
  return metrics;
}

async function readWindow(repo, days) {
  if (typeof repo.queryNotaryLearningByDay !== 'function') {
    throw new Error('customer-improvement: narrow learning signal query is required');
  }
  const raw = emptyRaw();
  const stats = await Promise.all(
    Array.from({ length: STATS_SHARDS }, (_, shard) =>
      repo.queryStats(statsGlobalPK(shard), statsDaySK(days[0]), statsDaySK(days[days.length - 1]))
    )
  );
  for (const shardItems of stats) for (const item of shardItems || []) mergeStats(raw, item);

  const signals = {
    customerInputEvents: 0, customerBehaviourEvents: 0, communicationEvents: 0,
    aiOutputEvents: 0, officialOutcomeEvents: 0, feedbackCount: 0,
    lowFeedbackCount: 0, ratingTotal: 0, latencyTotal: 0, latencyCount: 0,
    events: 0, truncated: false,
  };
  let remaining = MAX_AUDIT_EVENTS_PER_WINDOW;
  // Read newest complete days first when the bounded learning budget is
  // exhausted. Funnel counters remain complete; learning signals are
  // auxiliary and the report records when this cap was reached.
  for (const day of [...days].reverse()) {
    if (!remaining) { signals.truncated = true; break; }
    const allowance = remaining;
    const page = await repo.queryNotaryLearningByDay(day, allowance);
    for (const entry of page || []) readLearningSignal(signals, entry);
    const count = Array.isArray(page) ? page.length : 0;
    signals.events += count;
    if (count >= allowance) { signals.truncated = true; break; }
    remaining -= count;
  }
  raw.signal = signals;
  return summarizeRaw(raw);
}

function daysSince(iso, nowISO) {
  if (!validDay(String(iso).slice(0, 10)) || !validDay(String(nowISO).slice(0, 10))) return Infinity;
  const left = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  const right = Date.parse(String(nowISO).slice(0, 10) + 'T00:00:00Z');
  return Math.max(0, Math.floor((right - left) / 86400000));
}

function hold(reason, primaryMetric = null, metrics = null) {
  return {
    action: 'hold', mode: 'standard', reason, primaryMetric,
    metrics: domain.experienceMetrics(metrics),
  };
}

/**
 * Decide from complete windows. The decision is deterministic and has no
 * model call, which makes it cheap to run daily and easy to replay in a test.
 */
function decide({ config, recent, previous, nowISO } = {}) {
  const current = domain.customerExperienceConfig(config);
  const r = domain.experienceMetrics(recent);
  const p = domain.experienceMetrics(previous);
  const policy = domain.CUSTOMER_IMPROVEMENT_POLICY;
  const minimum = policy.minimumObservations;
  const attempts = Math.max(r.publicationAttempts, r.publications);
  if (r.formStarts < minimum.formStarts || attempts < minimum.publicationAttempts) {
    return {
      ...hold('insufficient_observations', 'formStarts', r),
      required: { formStarts: minimum.formStarts, publicationAttempts: minimum.publicationAttempts },
      observed: { formStarts: r.formStarts, publicationAttempts: attempts },
    };
  }

  const baseline = current.baseline || p;
  if (current.mode === 'guided' && baseline) {
    const proxyRegressed = baseline.publicationProxy > 0 && r.publicationProxy != null &&
      r.publicationProxy < baseline.publicationProxy * (1 - policy.thresholds.maxPublicationProxyDrop);
    const failureRegressed = r.publicationFailureRate > baseline.publicationFailureRate + policy.thresholds.maxFailureRateIncrease;
    if (proxyRegressed || failureRegressed) {
      return {
        action: 'rollback_guided_intake', mode: 'standard',
        reason: proxyRegressed ? 'publication_proxy_regressed' : 'publication_failures_regressed',
        primaryMetric: proxyRegressed ? 'publicationProxy' : 'publicationFailureRate',
        metrics: r, baseline,
      };
    }
    return { ...hold('guided_guardrails_healthy', null, r), mode: 'guided', baseline };
  }

  // A rollback creates a cooldown so an oscillating segment cannot be toggled
  // every day while a small sample changes by one request.
  if (current.changedAt && daysSince(current.changedAt, nowISO) < policy.windows.comparisonDays) {
    return { ...hold('cooldown_after_change', null, r), mode: current.mode };
  }

  const reasons = [];
  if (r.blockedRate >= policy.thresholds.blockedRateToGuide) reasons.push(['blockedRate', 'intake_blocked_rate_high']);
  if (r.responseLatencySeconds != null && r.responseLatencySeconds >= policy.thresholds.responseLatencySeconds) {
    reasons.push(['responseLatencySeconds', 'customer_response_latency_high']);
  }
  if (r.feedbackCount >= (minimum.feedbackCount || 5) && r.averageRating != null && r.averageRating <= policy.thresholds.lowRating) {
    reasons.push(['averageRating', 'client_feedback_low']);
  }
  if (!reasons.length) return { ...hold('guardrails_healthy', null, r), mode: current.mode };
  return {
    action: 'enable_guided_intake', mode: 'guided',
    reason: reasons.map(([, reason]) => reason).join(','),
    primaryMetric: reasons[0][0], metrics: r,
  };
}

function safeNowISO(nowMs) {
  const value = new Date(typeof nowMs === 'function' ? nowMs() : nowMs).toISOString();
  return value;
}

/**
 * Run one daily decision. `enabled:false` is a dry run for local evaluation;
 * production enables this worker through infrastructure, and every write is
 * still limited to the single experience policy item.
 */
async function runCustomerImprovement({ repo, now, nowMs = Date.now, newId, enabled = true } = {}) {
  if (!repo) throw new Error('runCustomerImprovement: repo is required');
  const today = typeof now === 'function' ? now() : now;
  if (!validDay(today)) throw new Error('runCustomerImprovement: now must return YYYY-MM-DD');
  const policy = domain.CUSTOMER_IMPROVEMENT_POLICY;
  const decisionDays = policy.windows.decisionDays;
  const comparisonDays = policy.windows.comparisonDays;
  const recentDays = completeDaysBefore(today, decisionDays, 1);
  const previousDays = completeDaysBefore(today, comparisonDays, 1 + decisionDays);
  const [recent, previous, stored] = await Promise.all([
    readWindow(repo, recentDays),
    readWindow(repo, previousDays),
    typeof repo.getExperienceConfig === 'function' ? repo.getExperienceConfig() : null,
  ]);
  const current = domain.customerExperienceConfig(stored);
  const at = safeNowISO(nowMs);
  const plan = decide({ config: current, recent, previous, nowISO: at });
  let finalConfig = current;
  let applied = false;
  let auditRecorded = false;
  if (plan.action !== 'hold' && enabled === true && typeof repo.putExperienceConfig === 'function') {
    const historyEntry = {
      at,
      action: plan.action,
      from: current.mode,
      to: plan.mode,
      reason: plan.reason,
      primaryMetric: plan.primaryMetric,
      metrics: plan.metrics,
    };
    finalConfig = domain.customerExperienceConfig({
      ...current,
      mode: plan.mode,
      revision: current.revision + 1,
      updatedAt: at,
      changedAt: at,
      lastStableMode: plan.mode === 'standard' ? 'standard' : current.mode,
      baseline: plan.mode === 'guided' ? plan.metrics : null,
      history: [...current.history, historyEntry],
    });
    const written = await repo.putExperienceConfig(finalConfig, at, { expectedRevision: current.revision });
    if (written === false) {
      return {
        version: policy.version,
        day: today,
        recentDays,
        previousDays,
        recent,
        previous,
        decision: { ...plan, conflict: 'concurrent_policy_update' },
        applied: false,
        auditRecorded: false,
        config: current,
        publicExperience: domain.publicCustomerExperience(current),
      };
    }
    applied = true;
    if (typeof repo.appendTxAudit === 'function') {
      try {
        await repo.appendTxAudit({
          id: typeof newId === 'function' ? String(newId()) : require('node:crypto').randomUUID(),
          ts: at,
          day: today,
          action: 'customer_improvement_applied',
          acteur: IMPROVEMENT_ACTOR,
          meta: {
            version: policy.version,
            action: plan.action,
            from: current.mode,
            to: plan.mode,
            reason: plan.reason,
            primaryMetric: plan.primaryMetric,
            metrics: domain.experienceMetrics(plan.metrics),
          },
        });
        auditRecorded = true;
      } catch {
        // The policy item retains the bounded decision history. An audit sink
        // outage must not cause a second, conflicting UX write on retry.
      }
    }
  }
  return {
    version: policy.version,
    day: today,
    recentDays,
    previousDays,
    recent,
    previous,
    decision: plan,
    applied,
    auditRecorded,
    config: finalConfig,
    publicExperience: domain.publicCustomerExperience(finalConfig),
  };
}

module.exports = {
  MAX_AUDIT_EVENTS_PER_WINDOW,
  completeDaysBefore,
  readWindow,
  summarizeRaw,
  decide,
  runCustomerImprovement,
};
