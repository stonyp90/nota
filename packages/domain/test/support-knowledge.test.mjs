import test from 'node:test';
import assert from 'node:assert/strict';
import D from '../index.js';
const pair = { question: 'Où changer la langue ?', answer: 'Le sélecteur est dans l’en-tête.' };
test('reviewed knowledge is bilingual, explicitly reviewed, bounded and subject to answer guards', () => {
  const value = { fr: pair, en: { question: 'Where can I change the language?', answer: 'The selector is in the header.' }, approved: true };
  assert.equal(D.validateSupportKnowledge(value).ok, true);
  assert.equal(D.SUPPORT_KNOWLEDGE_MAX, 40);
  for (const input of [{ ...value, approved: false }, { ...value, en: {} }, { ...value, fr: { ...pair, question: 'x'.repeat(D.SUPPORT_KNOWLEDGE_QUESTION_MAX + 1) } }, { ...value, fr: { ...pair, answer: 'x'.repeat(D.SUPPORT_MESSAGE_MAX + 1) } }]) assert.equal(D.validateSupportKnowledge(input).ok, false);
});
