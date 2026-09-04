'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');

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
  'proposition reçue': 'Un notaire vous propose',
  'proposition acceptée': 'Proposition acceptée',
  'proposition déclinée': 'Proposition déclinée',
  'documents demandés': 'Un notaire vous demande des documents',
  'offre retenue': 'Un notaire a retenu votre demande',
  'offre annulée': 'Offre annulée',
  'demande annulée par le client': 'Demande annulée par le client',
  // ADR 0033 — la mise en relation est complète
  'demande retenue': 'Demande retenue',
  'nouvelle demande': 'Nouvelle demande',
  "annulation d'une demande retenue": 'Annulation d’une demande retenue',
  'acte payé': 'Acte payé',
  // Live support messaging (ADR 0026)
  'messagerie : nouvelle question': 'Messagerie : nouvelle question',
  'messagerie : réponse de Nota': 'Nota vous a répondu',
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

// Valid mandatory pricing answers per service (the ADR 0010 financing family),
// chosen so a seeded publication validates at each act's flat base
// (refinancement 2000 $, financement 1800 $).
const PRICING_VALIDE = {
  refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
  financement: { valeur_pret: 250000, contexte: 'propriete_detenue', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', succession: 'non', deplacement: 'client_50' },
};

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
    await this.request({ method: 'POST', path: '/bids', body: JSON.stringify({ serviceId, dateISO, montant, courriel, prefixe: 'G1R', pricing: PRICING_VALIDE[serviceId] }) });
    assert.equal(this.response.statusCode, 201, 'la publication de départ a échoué: ' + this.response.body);
    this.lastBidId = this.responseJson.bid.id;
  }
);

// --- When: publishing an offer ----------------------------------------------

When(
  'un client publie une offre avec le courriel {string} pour {string} à {int} dans {int} jours',
  async function (courriel, serviceId, montant, jours) {
    const dateISO = this.domain.addDays(this.today, jours);
    await this.request({ method: 'POST', path: '/bids', body: JSON.stringify({ serviceId, dateISO, montant, courriel, prefixe: 'G1R', pricing: PRICING_VALIDE[serviceId] }) });
    const j = this.responseJson;
    this.lastBidId = j.bid ? j.bid.id : null;
    this.lastBid = j.bid || null;
    this.clientToken = j.clientToken || null;
  }
);

When(
  'un client publie une offre sans courriel pour {string} à {int} dans {int} jours',
  async function (serviceId, montant, jours) {
    const dateISO = this.domain.addDays(this.today, jours);
    await this.request({ method: 'POST', path: '/bids', body: JSON.stringify({ serviceId, dateISO, montant, prefixe: 'G1R', pricing: PRICING_VALIDE[serviceId] }) });
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

// --- When: Stripe account webhook --------------------------------------------

When(
  'le webhook Stripe {string} arrive pour le courriel {string}',
  async function (eventType, email) {
    const body = JSON.stringify({
      id: 'evt_' + this.today + '_' + eventType,
      type: eventType,
      data: { object: { customer_email: email, metadata: { notaryId: 'notary-1' } } },
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
  // « ce courriel » in a following step refers to the message just matched.
  world.lastAsserted = hits[hits.length - 1];
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

Then('le notaire {string} ne reçoit aucun courriel', function (email) {
  const hits = this.mailsTo(email);
  assert.equal(hits.length, 0, `${email} a reçu ${hits.length} courriel(s): ` + summary(hits));
});

Then('le client {string} ne reçoit aucun courriel {string}', function (email, label) {
  const hits = this.mailsTo(email).filter(isKind(label));
  assert.equal(hits.length, 0, `${email} a reçu « ${label} » à tort: ` + summary(hits));
});

// --- ADR 0033 — la mise en relation est complète -----------------------------

// A notary whose profile carries what the client must be able to do once the
// act is retained: call them and find the étude (domain.notaryContactMissing).
Given('un notaire actif et joignable {string}', async function (email) {
  await this.repo.putNotary({
    id: notaryIdForEmail(email), email, status: 'active',
    nom: 'Me Jeanne Tremblay', etude: 'Étude Tremblay', telephone: '418 555-0199',
    adresse: '12, rue Saint-Jean, Québec (QC) G1R 1N4', prefixe: 'G1R', rayonKm: 25, urgences: false,
  });
});

// The notary's alert preference — server data since ADR 0033 §7.
Given('le notaire {string} veut ses demandes {string}', async function (email, pace) {
  const profile = await this.repo.getNotary(notaryIdForEmail(email));
  assert.ok(profile, 'notaire inconnu: ' + email);
  await this.repo.putNotary({ ...profile, alertes: { pace, urgentOnly: false } });
});

When(
  'un client nommé {string} au téléphone {string} publie une offre avec le courriel {string} pour {string} à {int} dans {int} jours',
  async function (nom, telephone, courriel, serviceId, montant, jours) {
    const dateISO = this.domain.addDays(this.today, jours);
    await this.request({ method: 'POST', path: '/bids', body: JSON.stringify({ serviceId, dateISO, montant, courriel, nom, telephone, anonyme: true, prefixe: 'G1R', pricing: PRICING_VALIDE[serviceId] }) });
    assert.equal(this.response.statusCode, 201, 'la publication a échoué: ' + this.response.body);
    const j = this.responseJson;
    this.lastBidId = j.bid.id;
    this.lastBid = j.bid;
    this.clientToken = j.clientToken || null;
  }
);

// What the cancel route records on a late cancellation (ADR 0023/0033): the
// fee kept, and that it is the notary's compensation. Driven through the
// notifier with the stored bid, exactly as the route fires it.
When("l'offre retenue est annulée avec des frais de {int} $ au taux de {int} % versés au notaire", async function (frais, taux) {
  const bid = await this.repo.get(this.lastBidId);
  assert.ok(bid && bid.notaryId, "l'offre n'est pas retenue");
  const notary = await this.repo.getNotary(bid.notaryId);
  const cancelled = { ...bid, status: this.domain.STATUS.ANNULEE, cancelledAt: this.today, annulation: { taux: taux / 100, frais, joursAvant: 10, dedommagement: { notaire: true, verse: true, transferId: 'tr_' + bid.id } } };
  await this.repo.update(cancelled);
  await this.notifier.onOfferCancelled(cancelled, { notary, wasRetained: true });
  await this.flush();
});

// « ce courriel » = the one the previous « reçoit le courriel » step matched.
function lastMail(world) {
  assert.ok(world.lastAsserted, 'aucun courriel n’a été constaté par l’étape précédente');
  return world.lastAsserted;
}

Then('ce courriel porte les coordonnées {string}, {string} et {string}', function (nom, courriel, telephone) {
  const m = lastMail(this);
  for (const needle of [nom, courriel, telephone]) {
    assert.ok(m.html.includes(needle), `le courriel « ${m.subject} » ne porte pas « ${needle} »`);
  }
  const digits = telephone.replace(/\D/g, '');
  assert.ok(m.html.includes('href="tel:' + digits + '"'), 'le téléphone doit être un lien tel:');
});

Then('ce courriel dit que {int} $ lui sont versés en dédommagement', function (frais) {
  const m = lastMail(this);
  assert.ok(m.html.includes(this.domain.money(frais)), 'montant absent: ' + m.subject);
  assert.ok(/vous sont versés/.test(m.html), 'le notaire doit lire que la somme lui est versée');
  assert.ok(!/régulariser/.test(m.html), 'aucune promesse de régularisation');
});

Then('ce courriel dit que {int} $ sont retenus en dédommagement du notaire', function (frais) {
  const m = lastMail(this);
  assert.ok(m.html.includes(this.domain.money(frais)), 'montant absent: ' + m.subject);
  assert.ok(/dédommagement/.test(m.html), 'le client doit lire à qui va la somme');
});
