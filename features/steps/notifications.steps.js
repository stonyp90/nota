'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

// --- Template identity ------------------------------------------------------
// A human-friendly label (used in the scenarios) maps to a stable, distinctive
// slice of the template's subject line. The captured message carries no "kind"
// field, so the subject is how we assert *which* template was rendered.
const TEMPLATE_SUBJECT = {
  'offer published': 'Votre offre est en ligne',
  'nouveau lead': 'Nouvelle offre',
  bienvenue: 'Bienvenue sur Nota',
  'nouveau notaire abonné': 'Nouveau notaire abonné',
  'date approche': 'Votre signature approche',
};

function subjectNeedle(label) {
  const needle = TEMPLATE_SUBJECT[label];
  if (!needle) throw new Error('gabarit de courriel inconnu: "' + label + '"');
  return needle;
}

function isKind(label) {
  const needle = subjectNeedle(label);
  return (m) => typeof m.subject === 'string' && m.subject.includes(needle);
}

// Compact recipient/subject summary for assertion messages.
function summary(msgs) {
  return JSON.stringify(msgs.map((m) => ({ to: m.to, subject: m.subject })));
}

// --- Given ------------------------------------------------------------------

Given('l\'adresse {string} s\'est désabonnée', async function (email) {
  await this.repo.putUnsubscribe(email, this.today);
});

// Seed an open, mailable offer via the real POST /bids path (so it is stored
// with status ouverte + courriel, exactly like a live publication). Used by the
// reminder scenarios, which then assert on the reminder specifically.
Given(
  'une offre ouverte avec le courriel {string} pour {string} à {int} dans {int} jours',
  async function (courriel, serviceId, montant, jours) {
    const dateISO = this.domain.addDays(this.today, jours);
    await this.request({ method: 'POST', path: '/bids', body: JSON.stringify({ serviceId, dateISO, montant, courriel }) });
    assert.equal(this.response.statusCode, 201, 'la publication de départ a échoué: ' + this.response.body);
    this.lastBidId = this.responseJson.bid.id;
  }
);

// --- When: publishing an offer ----------------------------------------------

When(
  'un client publie une offre avec le courriel {string} pour {string} à {int} dans {int} jours',
  async function (courriel, serviceId, montant, jours) {
    const dateISO = this.domain.addDays(this.today, jours);
    await this.request({ method: 'POST', path: '/bids', body: JSON.stringify({ serviceId, dateISO, montant, courriel }) });
    const j = this.responseJson;
    this.lastBidId = j.bid ? j.bid.id : null;
  }
);

When(
  'un client publie une offre sans courriel pour {string} à {int} dans {int} jours',
  async function (serviceId, montant, jours) {
    const dateISO = this.domain.addDays(this.today, jours);
    await this.request({ method: 'POST', path: '/bids', body: JSON.stringify({ serviceId, dateISO, montant }) });
    const j = this.responseJson;
    this.lastBidId = j.bid ? j.bid.id : null;
  }
);

// Replay the notification for the *same* stored offer — what a retry or a
// duplicate delivery of the fire-and-forget send would do. The SENT ledger must
// keep it idempotent.
When('la même offre est republiée', async function () {
  const bid = await this.repo.get(this.lastBidId);
  assert.ok(bid, 'aucune offre à republier');
  await this.notifier.onOfferCreated(bid);
  await this.flush();
});

// --- When: subscription webhook ---------------------------------------------

When(
  'un notaire {string} complète son abonnement via le webhook {string}',
  async function (email, eventType) {
    const body = JSON.stringify({
      id: 'evt_' + this.today + '_' + eventType,
      type: eventType,
      data: { object: { client_reference_id: 'notary-1', customer_email: email, subscription: 'sub_1' } },
    });
    await this.request({
      method: 'POST',
      path: '/stripe/webhook',
      headers: { 'stripe-signature': 'test-signature' },
      body,
    });
  }
);

// --- When: reminder scheduler -----------------------------------------------

When('le planificateur de rappels s\'exécute', async function () {
  this.reminderResult = await this.runReminders();
});

// --- Then: a recipient received a template ----------------------------------

function assertReceived(world, email, label) {
  const hits = world.mailsTo(email).filter(isKind(label));
  assert.ok(
    hits.length >= 1,
    `${email} n'a pas reçu « ${label} ». Envois: ` + summary(world.mailer.sent)
  );
}

Then('le client {string} reçoit le courriel {string}', function (email, label) {
  assertReceived(this, email, label);
});

Then('le notaire {string} reçoit le courriel {string}', function (email, label) {
  assertReceived(this, email, label);
});

Then('l\'opérateur reçoit le courriel {string}', function (label) {
  assertReceived(this, this.operatorEmail, label);
});

// --- Then: exact counts (idempotence) ---------------------------------------

Then('le client {string} reçoit exactement {int} courriel {string}', function (email, count, label) {
  const hits = this.mailsTo(email).filter(isKind(label));
  assert.equal(hits.length, count, `attendu ${count} « ${label} » pour ${email}, obtenu ${hits.length}`);
});

Then('l\'opérateur reçoit exactement {int} courriel {string}', function (count, label) {
  const hits = this.mailsTo(this.operatorEmail).filter(isKind(label));
  assert.equal(hits.length, count, `attendu ${count} « ${label} » pour l'opérateur, obtenu ${hits.length}`);
});

// --- Then: nothing was (wrongly) sent ---------------------------------------

Then('aucun courriel client n\'est tenté', function () {
  const nonOperator = this.mailer.sent.filter((m) => m.to !== this.operatorEmail);
  assert.equal(nonOperator.length, 0, 'un courriel client a été tenté: ' + summary(nonOperator));
});

Then('le client {string} ne reçoit aucun courriel', function (email) {
  const hits = this.mailsTo(email);
  assert.equal(hits.length, 0, `${email} a reçu ${hits.length} courriel(s): ` + summary(hits));
});

Then('le client {string} ne reçoit aucun courriel {string}', function (email, label) {
  const hits = this.mailsTo(email).filter(isKind(label));
  assert.equal(hits.length, 0, `${email} a reçu « ${label} » à tort: ` + summary(hits));
});
