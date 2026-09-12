'use strict';

const domain = require('@nota/domain');
const { inputGuard, sensitiveInput, unsafeOutput } = require('./support-playbook');
const PK = 'CONFIG#SUPPORT';
const SK = 'KNOWLEDGE';
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[?!.]+$/, '');

// This is a conservative publishing gate, not a claim to detect all PII.
// A human must also remove names and any case-specific facts. Dynamic prices,
// dates and policies belong to the authoritative fact sheet, not this store.
function validateKnowledge(input) {
  const result = domain.validateSupportKnowledge(input);
  if (!result.ok) return result;
  for (const pair of Object.values(result.value)) {
    if (inputGuard(pair.question) || sensitiveInput(pair.answer) || unsafeOutput(pair.answer) ||
        /(?:votre (?:dossier|demande|paiement) (?:est|a été)|your (?:file|request|payment) (?:is|has been))\s+(?:accept|approuv|confirm|refus|annul|rembours|approved|confirmed|declined|cancelled|refunded)/i.test(pair.answer) ||
        /[\d@$€£]|https?:|www\./i.test(pair.question + ' ' + pair.answer) || inputGuard(pair.answer)) {
      return { ok: false, errors: [{ code: 'connaissance_non_generale', message: 'Gardez uniquement des explications générales, sans coordonnées, liens, chiffres, renseignements personnels ni instructions à l’assistant.' }] };
    }
  }
  return result;
}

function matchKnowledge(entries, question, locale) {
  const lang = locale === 'en' ? 'en' : 'fr';
  // Complete question only. Conflicting reviewed answers fail closed.
  const matches = (entries || []).filter(entry => entry.active && validateKnowledge({ ...entry, approved: true }).ok &&
    ['fr', 'en'].some(l => normalize(entry[l].question) === normalize(question)));
  if (!matches.length || new Set(matches.map(entry => entry[lang].answer)).size !== 1) return null;
  return { texte: matches[0][lang].answer, knowledgeId: matches[0].id };
}

module.exports = { PK, SK, validateKnowledge, matchKnowledge };
