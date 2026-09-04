'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');
const domain = require('@nota/domain');

// --- Session helper (same handshake as propositions.steps.js, cached) --------

async function notarySession(world, email) {
  world.notaryTokens = world.notaryTokens || {};
  if (world.notaryTokens[email]) return world.notaryTokens[email];
  const req = await world.app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email }) });
  assert.equal(req.statusCode, 200, 'demande de lien notaire: ' + req.body);
  const devToken = JSON.parse(req.body).devToken;
  assert.ok(devToken, 'le lien de connexion doit être renvoyé hors production: ' + req.body);
  const res = await world.app.handle({ method: 'POST', path: '/notary/session/verify', body: JSON.stringify({ token: devToken }) });
  assert.equal(res.statusCode, 200, 'ouverture de session notaire: ' + res.body);
  world.notaryTokens[email] = JSON.parse(res.body).token;
  return world.notaryTokens[email];
}

function lastBid(world) {
  assert.ok(world.lastBid, 'aucune offre publiée dans ce scénario');
  return world.lastBid;
}

// --- Given: the money rails --------------------------------------------------

// Turn the REAL billing use-cases on over the world's Stripe recorder — the
// pre-billing default of every other suite stays off unless a scenario says so.
Given('la facturation Stripe est configurée', function () {
  this.enableBilling();
});

// Le chemin de production, en deux temps depuis l'ADR 0035 : le client donne
// sa carte (webhook setup_intent.succeeded → carte ENREGISTRÉE), puis la
// caution est posée hors session sur cette carte — ce que fait le geste
// quotidien à J-CAUTION_LEAD_DAYS. Un scénario qui écrivait l'autorisation
// directement dans le dépôt ne prouvait plus rien du mécanisme réel.
Given('la caution du client est autorisée', async function () {
  const bid = lastBid(this);
  // Date déjà dans la fenêtre : la publication a ouvert une session de
  // PAIEMENT, et c'est le webhook checkout.session.completed qui lie
  // l'autorisation à l'offre. Rien à poser de plus.
  if (domain.cautionDue(bid.dateISO, this.today)) {
    await this.repo.authorizeBid(bid.id, bid.dateISO, { paymentIntentId: 'pi_' + bid.id, authorizedAt: this.today });
    return;
  }
  await this.repo.registerBidPaymentMethod(bid.id, bid.dateISO, {
    customerId: 'cus_' + bid.id, paymentMethodId: 'pm_' + bid.id, registeredAt: this.today,
  });
  const stored = await this.repo.get(bid.id, bid.dateISO);
  const out = await this.billing.placeCaution({ bid: stored, todayISO: this.today });
  assert.equal(out.ok, true, 'la caution devait être posée: ' + JSON.stringify(out));
});

// Settlement needs a payable notary: a Connect account with charges enabled.
Given('le notaire {string} est connecté à Stripe', async function (email) {
  const id = notaryIdForEmail(email);
  const profile = await this.repo.getNotary(id);
  assert.ok(profile, 'notaire inconnu: ' + email);
  await this.repo.putNotary({ ...profile, chargesEnabled: true, connectAccountId: 'acct_' + id, commissionCentsCollected: profile.commissionCentsCollected || 0 });
});

// The admin-decided barème (ADR 0023) — stored exactly as the console's write
// door would store it; the cancel route resolves it on the next call.
Given("le barème d'annulation stocké est:", async function (table) {
  const paliers = table.hashes().map((r) => ({ maxJours: Number(r.maxJours), taux: Number(r.taux) }));
  await this.repo.putCancellationConfig({ paliers }, this.today);
});

Given("le barème d'annulation stocké est vide", async function () {
  await this.repo.putCancellationConfig({ paliers: [] }, this.today);
});

// --- When: cancelling, settling, evaluating ----------------------------------

When('le client annule son offre', async function () {
  const bid = lastBid(this);
  assert.ok(this.clientToken, "aucun jeton client — l'offre doit être publiée avec un courriel");
  await this.request({
    method: 'POST',
    path: '/client/bid/cancel',
    headers: { authorization: 'Bearer ' + this.clientToken },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
});

// ADR 0033 — the retaining notary withdraws, without a motif: free, counted,
// and the operator is always told.
When('le notaire {string} se désiste', async function (email) {
  const token = await notarySession(this, email);
  const bid = lastBid(this);
  await this.request({
    method: 'POST',
    path: '/notary/bids/release',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
});

When("le notaire {string} marque l'acte complété à {int}", async function (email, montant) {
  const token = await notarySession(this, email);
  const bid = lastBid(this);
  await this.request({
    method: 'POST',
    path: '/notary/acts/complete',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ bidId: bid.id, dateISO: bid.dateISO, actAmount: montant }),
  });
});

When('le client évalue le notaire à {int} avec le commentaire {string}', async function (note, commentaire) {
  const bid = lastBid(this);
  await this.request({
    method: 'POST',
    path: '/client/evaluation',
    headers: { authorization: 'Bearer ' + this.clientToken },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, note, commentaire }),
  });
});

// --- Then: what the cancellation kept (or didn't) -----------------------------

Then("l'annulation est gratuite", function () {
  assert.equal(this.response.statusCode, 200, this.response.body);
  assert.equal(this.responseJson.bid.annulation, null, 'des frais ont été retenus: ' + this.response.body);
});

Then("l'annulation retient {int} % du montant, soit {int} $", function (taux, frais) {
  assert.equal(this.response.statusCode, 200, this.response.body);
  const a = this.responseJson.bid.annulation;
  assert.ok(a, 'aucuns frais retenus: ' + this.response.body);
  assert.equal(Math.round(a.taux * 100), taux);
  assert.equal(a.frais, frais);
});

Then('seule cette part est capturée sur la caution, le reste étant libéré par Stripe', function () {
  const a = this.responseJson.bid.annulation;
  const captures = this.stripe.calls.feeCaptures;
  assert.equal(captures.length, 1, 'exactement une capture partielle attendue');
  assert.equal(captures[0].amountCents, Math.round(a.frais * 100));
  // A partial capture releases the remainder on Stripe's side — cancelling
  // the intent on top of it would fail; the route must not try.
  assert.equal(this.stripe.calls.cancels.length, 0, 'la caution ne doit pas être annulée en plus de la capture');
});

Then('la caution du client est libérée', function () {
  const bid = lastBid(this);
  assert.ok(
    this.stripe.calls.cancels.some((c) => c.bidId === bid.id),
    "la caution n'a pas été libérée: " + JSON.stringify(this.stripe.calls.cancels)
  );
  assert.equal(this.stripe.calls.feeCaptures.length, 0, 'aucune capture attendue sur une annulation gratuite');
});

Then("la caution n'a été capturée qu'une seule fois", function () {
  const n = this.stripe.calls.feeCaptures.length + this.stripe.calls.transfers.length;
  assert.equal(n, 1, JSON.stringify(this.stripe.calls));
});

Then("aucune capture n'a eu lieu", function () {
  assert.equal(this.stripe.calls.feeCaptures.length, 0);
  assert.equal(this.stripe.calls.transfers.length, 0);
});

Then("le client voit des frais d'annulation de {int} $ avant de confirmer", async function (frais) {
  const bid = lastBid(this);
  await this.request({
    method: 'GET',
    path: '/client/bid',
    headers: { authorization: 'Bearer ' + this.clientToken },
    query: { id: bid.id, dateISO: bid.dateISO },
  });
  assert.equal(this.response.statusCode, 200, this.response.body);
  assert.ok(this.responseJson.annulation, 'aucune prévision de frais: ' + this.response.body);
  assert.equal(this.responseJson.annulation.frais, frais);
});

Then("le client ne voit aucuns frais d'annulation avant de confirmer", async function () {
  const bid = lastBid(this);
  await this.request({
    method: 'GET',
    path: '/client/bid',
    headers: { authorization: 'Bearer ' + this.clientToken },
    query: { id: bid.id, dateISO: bid.dateISO },
  });
  assert.equal(this.response.statusCode, 200, this.response.body);
  assert.equal(this.responseJson.annulation, null);
});

Then("l'offre n'apparaît plus dans le carnet du mois {string}", async function (month) {
  const bid = lastBid(this);
  const res = await this.app.handle({ method: 'GET', path: '/bids', query: { month } });
  const bids = JSON.parse(res.body).bids || [];
  assert.ok(!bids.some((b) => b.id === bid.id), "l'offre annulée est encore sur le carnet public");
});

Then("l'offre est toujours retenue par {string}", async function (email) {
  const bid = lastBid(this);
  const stored = await this.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.status, this.domain.STATUS.RETENUE);
  assert.equal(stored.notaryId, notaryIdForEmail(email));
});

// --- Then: the fee compensates the notary (ADR 0033) ---------------------------

Then('les frais de {int} $ sont virés en entier au notaire {string}', function (frais, email) {
  const id = notaryIdForEmail(email);
  const bid = lastBid(this);
  const a = this.responseJson.bid.annulation;
  assert.ok(a, 'aucuns frais retenus: ' + this.response.body);
  assert.deepEqual(a.dedommagement, { notaire: true, verse: true, transferId: 'trfee_' + bid.id });

  // ADR 0035 — DEUX mécanismes possibles selon qu'une caution vive existe :
  // la capture partielle, ou le prélèvement hors session sur la carte
  // enregistrée. Lequel des deux est en jeu se dit dans sa propre phrase ; ce
  // qui se vérifie ICI est l'invariant commun : Nota n'en garde rien.
  const captures = [...this.stripe.calls.feeCaptures, ...this.stripe.calls.offSessionFees];
  assert.equal(captures.length, 1, 'exactement un prélèvement de frais attendu');
  assert.equal(captures[0].connectAccountId, 'acct_' + id, 'le virement doit viser le compte du notaire qui a retenu');
  const virements = this.stripe.calls.feeTransfers;
  assert.equal(virements.length, 1, 'exactement un virement attendu: ' + JSON.stringify(this.stripe.calls));
  assert.equal(virements[0].amountCents, frais * 100);
  // Nota n'en garde rien : ce qui est viré est exactement ce qui a été capturé.
  assert.equal(virements[0].amountCents, captures[0].amountCents, 'une part des frais est restée chez Nota');
});

Then('les frais de {int} $ sont dus au notaire {string}, faute de versements Stripe branchés', async function (frais, email) {
  const a = this.responseJson.bid.annulation;
  assert.ok(a, 'aucuns frais retenus: ' + this.response.body);
  assert.deepEqual(a.dedommagement, { notaire: true, verse: false, transferId: null });
  assert.equal(this.stripe.calls.feeTransfers.length, 0, 'aucun virement attendu sans compte Stripe branché');
  const profile = await this.repo.getNotary(notaryIdForEmail(email));
  assert.ok(profile, 'notaire inconnu: ' + email);
  assert.equal(profile.dedommagementCentsDue, frais * 100, 'la créance du notaire doit être inscrite à son dossier');
});

// --- Then: the withdrawal is free, counted, and never silent -------------------

Then('le désistement ne coûte rien au notaire {string}', async function (email) {
  assert.equal(this.stripe.calls.feeCaptures.length, 0);
  assert.equal(this.stripe.calls.transfers.length, 0);
  const profile = await this.repo.getNotary(notaryIdForEmail(email));
  assert.ok(profile, 'notaire inconnu: ' + email);
  assert.ok(!profile.dedommagementCentsDue && !profile.commissionCentsDue, 'aucune créance ne doit naître d’un désistement');
});

Then('le désistement est compté au dossier du notaire {string}', async function (email) {
  const profile = await this.repo.getNotary(notaryIdForEmail(email));
  assert.ok(profile, 'notaire inconnu: ' + email);
  assert.equal(profile.releasesCount, 1, 'le désistement doit être compté: ' + JSON.stringify(profile));
});

Then("l'opérateur est prévenu du désistement", function () {
  const hits = this.mailsTo(this.operatorEmail).filter((m) => /désistement/i.test(m.subject || ''));
  assert.ok(hits.length >= 1, "l'opérateur n'a pas été prévenu. Envois: " + JSON.stringify(this.mailer.sent.map((m) => ({ to: m.to, subject: m.subject }))));
});

// --- Then: settlement and evaluation ------------------------------------------

Then('la caution est capturée et le notaire reçoit {int} $ net, Nota gardant {int} $', async function (net, commission) {
  const bid = lastBid(this);
  const t = this.stripe.calls.transfers;
  assert.equal(t.length, 1, 'exactement une capture-et-transfert attendue: ' + JSON.stringify(t));
  assert.equal(t[0].paymentIntentId, 'pi_' + bid.id);
  assert.equal(t[0].amountCents - t[0].applicationFeeCents, net * 100);
  assert.equal(t[0].applicationFeeCents, commission * 100);
  const completion = await this.repo.getActCompletion(bid.id);
  assert.ok(completion, 'le registre ACT# doit témoigner du règlement');
});

Then('la note publique du notaire {string} est {float} sur {int} avis', async function (email, note, avis) {
  const profile = await this.repo.getNotary(notaryIdForEmail(email));
  assert.ok(profile, 'notaire inconnu: ' + email);
  assert.equal(profile.ratingCount, avis);
  assert.equal(this.domain.ratingAverage(profile.ratingSum, profile.ratingCount), note);
});

// --- @decision placeholders (excluded from the run) ---------------------------

Then("la récompense de parrainage de cette offre est reprise", function () {
  throw new Error('Décision produit en attente — le registre EARN est write-once (ADR 0011).');
});
