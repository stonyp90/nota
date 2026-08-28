'use strict';

// Live support messaging (ADR 0026): the widget's thread, the operator's
// emailed reply link, and the watertight token scopes — driven through the
// real handler + notifier, with only the mailer (and the clock) faked.
const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

async function envoyer(world, body, token) {
  await world.request({
    method: 'POST',
    path: '/support/messages',
    headers: token ? { authorization: 'Bearer ' + token } : {},
    body: JSON.stringify(body),
  });
  if (world.response.statusCode === 201) {
    const j = world.responseJson;
    world.supportToken = j.token;
    world.supportThreadId = j.threadId;
  }
}

// The signed reply link the operator email carries: `${base}/#reponse=<token>`.
function replyTokenOf(world) {
  const ops = world.mailsTo(world.operatorEmail).filter((m) => m.subject.includes('Messagerie'));
  assert.ok(ops.length >= 1, "aucun courriel « Messagerie » n'a atteint l'opérateur");
  const last = ops[ops.length - 1];
  const m = /#reponse=([A-Za-z0-9_\-.%]+)/.exec(last.html + ' ' + (last.text || ''));
  assert.ok(m, 'le courriel doit porter le lien de réponse signé');
  return decodeURIComponent(m[1]);
}

When('un visiteur écrit {string} à la messagerie', async function (texte) {
  await envoyer(this, { texte });
});

When(
  'un visiteur écrit {string} à la messagerie en laissant le courriel {string}',
  async function (texte, courriel) {
    await envoyer(this, { texte, courriel });
  }
);

When("l'opérateur répond {string} par son lien", async function (texte) {
  const token = replyTokenOf(this);
  await this.request({
    method: 'POST',
    path: '/support/reply',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ texte }),
  });
  assert.equal(this.response.statusCode, 200, 'réponse opérateur: ' + this.response.body);
});

When('le visiteur tente de répondre par son propre jeton', async function () {
  await this.request({
    method: 'POST',
    path: '/support/reply',
    headers: { authorization: 'Bearer ' + this.supportToken },
    body: JSON.stringify({ texte: 'Je suis Nota.' }),
  });
});

Then("le courriel de l'opérateur porte un lien de réponse signé", function () {
  replyTokenOf(this); // asserts inside
});

Then('le fil de la messagerie compte {int} message(s)', async function (n) {
  await this.request({
    method: 'GET',
    path: '/support/thread',
    headers: { authorization: 'Bearer ' + this.supportToken },
  });
  assert.equal(this.response.statusCode, 200, 'lecture du fil: ' + this.response.body);
  assert.equal(this.responseJson.messages.length, n);
});

Then('le dernier message du fil vient de {string}', async function (de) {
  await this.request({
    method: 'GET',
    path: '/support/thread',
    headers: { authorization: 'Bearer ' + this.supportToken },
  });
  const msgs = this.responseJson.messages;
  assert.equal(msgs[msgs.length - 1].de, de);
});

Then("aucun courriel n'est envoyé sauf à l'opérateur", function () {
  const others = this.mailer.sent.filter((m) => m.to !== this.operatorEmail);
  assert.equal(others.length, 0, 'envois inattendus: ' + JSON.stringify(others.map((m) => m.to)));
});
