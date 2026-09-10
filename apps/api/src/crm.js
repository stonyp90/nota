'use strict';

// CRM workflow vocabulary. Customer facts are never copied into this module;
// this is only the bounded, auditable operator state layered over a persisted
// bid. The admin API joins it with the main-table bid and act records.
const domain = require('@nota/domain');

const STAGES = Object.freeze([
  { id: 'nouveau', nom: 'Nouveau', nomEn: 'New' },
  { id: 'contacte', nom: 'Contacté', nomEn: 'Contacted' },
  { id: 'qualifie', nom: 'Qualifié', nomEn: 'Qualified' },
  { id: 'converti', nom: 'Converti', nomEn: 'Converted' },
  { id: 'perdu', nom: 'Perdu', nomEn: 'Lost' },
]);
const STAGE_IDS = new Set(STAGES.map((stage) => stage.id));
const NOTE_MAX = 2000;
const RANGE_MAX_DAYS = 366;

function stage(id) {
  return STAGES.find((item) => item.id === id) || null;
}

function defaultStage({ bid, completed }) {
  if (completed === true) return 'converti';
  if (bid && bid.status === domain.STATUS.RETENUE) return 'qualifie';
  return 'nouveau';
}

function validDate(value) {
  return value == null || value === '' || domain.isISODate(value);
}

// PUT is deliberately a revision-checked patch. Missing fields preserve the
// current workflow value, so an operator without PII access can move a stage or
// a follow-up date without accidentally erasing a private note.
function cleanPatch(input, current, fallbackStage) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = [];
  const currentRevision = Number(current && current.revision) || 0;
  const revision = Number(body.revision);
  if (!Number.isInteger(revision) || revision < 0) {
    errors.push({ code: 'revision_invalide', message: 'La révision CRM est invalide.' });
  }

  const chosenStage = body.stage == null || body.stage === ''
    ? ((current && current.stage) || fallbackStage)
    : String(body.stage).trim();
  if (!STAGE_IDS.has(chosenStage)) {
    errors.push({ code: 'etape_invalide', message: 'L’étape CRM est invalide.' });
  }

  const note = body.note == null ? (current && current.note) || '' : String(body.note);
  if (note.length > NOTE_MAX) {
    errors.push({ code: 'note_trop_longue', message: `La note CRM doit contenir au plus ${NOTE_MAX} caractères.` });
  }

  const nextFollowUpAt = body.nextFollowUpAt === '' || body.nextFollowUpAt == null
    ? null
    : String(body.nextFollowUpAt).trim();
  if (!validDate(nextFollowUpAt)) {
    errors.push({ code: 'relance_invalide', message: 'La date de relance doit être au format AAAA-MM-JJ.' });
  }

  if (errors.length) return { errors };
  return {
    value: { stage: chosenStage, note, nextFollowUpAt, revision },
    currentRevision,
  };
}

function dateWindow({ from, to, today }) {
  const end = domain.isISODate(to) ? to : domain.isISODate(today) ? today : domain.businessDay(null);
  const requestedFrom = domain.isISODate(from) ? from : domain.addDays(end, -89);
  return { from: requestedFrom, to: end };
}

function monthsBetween(from, to) {
  const months = [];
  let cursor = `${from.slice(0, 7)}-01`;
  while (cursor.slice(0, 7) <= to.slice(0, 7)) {
    months.push(cursor.slice(0, 7));
    cursor = domain.addDays(cursor, 32).slice(0, 7) + '-01';
  }
  return months;
}

module.exports = {
  STAGES,
  NOTE_MAX,
  RANGE_MAX_DAYS,
  stage,
  defaultStage,
  cleanPatch,
  dateWindow,
  monthsBetween,
};
