'use strict';
const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const S = require('../../packages/domain/signing');

Given('un exercice de signature admis avec deux participants connectés', function () {
  this.signingAt = 100000;
  this.signingSession = { status: 'admitted', admitted: true, expiresAt: this.signingAt + S.SESSION_MS,
    participants: { notary: { joined: true, connected: true, lastSeenAt: this.signingAt }, client: { joined: true, connected: true, lastSeenAt: this.signingAt } } };
});
When('le client tente de libérer la signature de démonstration', function () {
  this.signingDecision = S.decision(this.signingSession, 'client', 'release', this.signingAt);
});
Then("la progression de l'exercice est refusée", function () { assert.equal(this.signingDecision.ok, false); });
When('le notaire révise puis libère la signature de démonstration', function () {
  for (const action of ['review', 'release']) {
    const next = S.decision(this.signingSession, 'notary', action, this.signingAt);
    assert.equal(next.ok, true); this.signingSession.status = next.status;
  }
});
Then("la confirmation du client est disponible dans l'exercice", function () {
  assert.equal(S.decision(this.signingSession, 'client', 'acknowledge', this.signingAt).ok, true);
});
When('la présence vidéo du client devient périmée', function () {
  this.signingSession.status = 'reviewed';
  this.signingSession.participants.client.lastSeenAt = this.signingAt - S.PRESENCE_MS;
});
Then('le notaire ne peut pas libérer la signature de démonstration', function () {
  assert.equal(S.decision(this.signingSession, 'notary', 'release', this.signingAt).code, 'presence_requise');
});
Then("le document d'exercice indique qu'il ne constitue pas un acte notarié", function () {
  assert.match(S.DOCUMENT.text, /ne constitue pas un acte notarié/);
});
