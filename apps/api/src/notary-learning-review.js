'use strict';

// Scheduled review of the notary feedback stream. This is an evaluation and
// triage job, not an online learning loop: it reads minimized metadata only,
// never calls a provider, never ingests customer documents and never changes
// model weights or production prompts.
const D = require('@nota/domain');

const MAX_DAYS = 31;
const MAX_EVENTS_PER_WINDOW = 20000;

function validDay(value) {
  const day = String(value == null ? '' : value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day + 'T00:00:00Z'));
}

function shiftDay(dayISO, amount) {
  if (!validDay(dayISO)) return null;
  return new Date(Date.parse(dayISO + 'T00:00:00Z') + amount * 86400000).toISOString().slice(0, 10);
}

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

function blankCounts() {
  return Object.fromEntries(D.NOTARY_LEARNING_EVENT_KINDS.map(kind => [kind, 0]));
}

function summarizeLearningSignals(entries, { days = [] } = {}) {
  const eventCounts = blankCounts();
  const reviewDecisions = { accepted: 0, corrected: 0, rejected: 0 };
  const questionDecisions = { confirmed: 0, resolved: 0, not_applicable: 0, escalated: 0 };
  let eventCount = 0;
  let truncated = false;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (eventCount >= MAX_EVENTS_PER_WINDOW) { truncated = true; break; }
    if (!D.NOTARY_LEARNING_EVENT_KINDS.includes(entry?.meta?.kind)) continue;
    eventCount += 1;
    const kind = entry.meta.kind;
    eventCounts[kind] += 1;
    if (kind === 'notary_review') {
      const decisions = Array.isArray(entry.meta?.data?.decisions) ? entry.meta.data.decisions : [];
      for (const decision of decisions) if (Object.prototype.hasOwnProperty.call(reviewDecisions, decision.decision)) reviewDecisions[decision.decision] += 1;
    }
    if (kind === 'notary_question') {
      const decision = entry.meta?.data?.decision;
      if (Object.prototype.hasOwnProperty.call(questionDecisions, decision)) questionDecisions[decision] += 1;
    }
  }
  const reviewedProposals = Object.values(reviewDecisions).reduce((sum, value) => sum + value, 0);
  return {
    version: D.NOTARY_LEARNING_POLICY_VERSION,
    learningProgram: D.NOTARY_LEARNING_PROGRAM,
    windowDays: Array.isArray(days) ? days.length : 0,
    eventCount,
    eventCounts,
    reviewDecisions,
    questionDecisions,
    reviewedProposals,
    truncated,
    training: {
      mode: D.NOTARY_LEARNING_PROGRAM.mode,
      candidateLabels: reviewedProposals,
      status: reviewedProposals ? 'requires_offline_authorized_export' : 'awaiting_notary_feedback',
      weightUpdate: 'not_started',
      automaticPromotion: false,
    },
  };
}

async function runNotaryLearningReview({ repo, now, days = 7 } = {}) {
  if (!repo || typeof repo.queryNotaryLearningByDay !== 'function') throw new Error('runNotaryLearningReview: narrow learning signal query is required');
  const today = typeof now === 'function' ? now() : now;
  if (!validDay(today)) throw new Error('runNotaryLearningReview: now must be YYYY-MM-DD');
  const window = completeDaysBefore(today, days);
  const entries = [];
  let remaining = MAX_EVENTS_PER_WINDOW;
  for (const day of [...window].reverse()) {
    if (!remaining) break;
    const allowance = remaining;
    const page = await repo.queryNotaryLearningByDay(day, allowance);
    for (const entry of page || []) entries.push(entry);
    const count = Array.isArray(page) ? page.length : 0;
    remaining -= count;
    if (count >= allowance) break;
  }
  const report = summarizeLearningSignals(entries, { days: window });
  return { ...report, day: today, days: window };
}

module.exports = { MAX_DAYS, MAX_EVENTS_PER_WINDOW, completeDaysBefore, summarizeLearningSignals, runNotaryLearningReview };
