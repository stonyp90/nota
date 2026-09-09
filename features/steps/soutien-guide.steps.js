const assert = require('node:assert/strict');
const { Then } = require('@cucumber/cucumber');
const D = require('../../packages/domain');
Then(/^le soutien transfère « (.+) » pour « (.+) »$/, function (question, motif) {
  assert.equal(D.supportQuestionGuard(question), motif);
});
Then(/^le soutien refuse la réponse « (.+) »$/, function (texte) {
  assert.equal(D.validateSupportAnswer({ texte }).ok, false);
});
Then('chaque sujet du soutien reçoit une réponse préparée ou un relais sans appeler le modèle', async function () {
  const { createSupportAssistant } = require('../../apps/api/src/support-assistant');
  let calls = 0;
  const assistant = createSupportAssistant({ port: { async answer() { calls++; throw new Error('Unexpected model call'); } } });
  for (const topic of D.SUPPORT_TOPICS) {
    for (const locale of ['fr', 'en']) {
      const answer = await assistant.answer({ question: topic[locale], locale });
      assert.ok(answer.texte, topic.id);
      assert.equal(D.validateSupportAnswer({ texte: answer.texte }).ok, true, topic.id);
    }
  }
  assert.equal(calls, 0);
});
