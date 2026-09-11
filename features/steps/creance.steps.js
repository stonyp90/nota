'use strict';

/**
 * Les steps de la CRÉANCE HORS PLATEFORME (ADR 0029).
 *
 * Un acte se règle par deux chemins, et un seul déplace de l'argent :
 *
 *   caution vivante — Nota capture la carte du client et vire les honoraires
 *                     au notaire. L'acte est PAYÉ.
 *   pas de caution  — le client a payé le notaire directement, à la signature.
 *                     Nota n'a rien à capturer : le prix de son service est
 *                     inscrit comme DÛ. L'acte est RÉGLÉ, pas payé.
 *
 * Rien ici ne lit le résultat de la route pour en déduire l'écriture : chaque
 * assertion rouvre le registre write-once (`ACT#`), le profil du notaire, le
 * relevé et la piste d'audit. C'est précisément l'écart entre « ce que la
 * réponse dit » et « ce que le registre porte » qui avait laissé passer le
 * paiement fantôme d'avant le 1er septembre 2026.
 */

const assert = require('node:assert/strict');
const { Then } = require('@cucumber/cucumber');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');
const { createAnalytics } = require('../../apps/api/src/analytics.js');

const cents = (dollars) => Math.round(Number(dollars) * 100);

function lastBid(world) {
  assert.ok(world.lastBid, 'aucune offre publiée dans ce scénario');
  return world.lastBid;
}

// Le registre write-once du règlement — l'autorité comptable. Ni la réponse
// HTTP ni le courriel ne font foi : c'est cette ligne-là qu'un auditeur lit.
async function registre(world) {
  const bid = lastBid(world);
  const regle = await world.repo.getActCompletion(bid.id);
  assert.ok(regle, 'aucun règlement inscrit au registre ACT# pour ' + bid.id);
  return regle;
}

// La session notaire, par la vraie poignée de main sans mot de passe. Mise en
// cache sur le monde, comme dans les autres suites.
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

// Les traces `acte_regle` du jour, relues dans le journal lui-même.
async function tracesDuReglement(world) {
  const bid = lastBid(world);
  const entrees = await world.repo.queryTxAuditByDay(world.today);
  return entrees.filter((e) => e.action === 'acte_regle' && e.meta && e.meta.bidId === bid.id);
}

// --- Ce que le registre porte ------------------------------------------------

// ADR 0029 — RÉGLÉ N'EST PAS ENCAISSÉ. Le registre write-once doit porter les
// trois marques ensemble : le prix de Nota, `paye: false`, et la créance. Deux
// sur trois suffiraient à faire mentir la console.
Then("l'acte est inscrit réglé mais NON payé, avec {int} $ dus à Nota", async function (du) {
  const regle = await registre(this);
  assert.equal(regle.paye, false, 'le registre doit dire « non payé »: ' + JSON.stringify(regle));
  assert.equal(regle.commissionCentsDue, cents(du), 'le montant DÛ inscrit au registre');
  assert.equal(regle.prixNotaCents, cents(du), 'la créance EST le prix du service de Nota, jamais une part des honoraires');
  // Et surtout : rien de ce qui atteste un encaissement n'a été écrit. C'est
  // exactement ce que l'ancien chemin remplissait à tort.
  assert.equal(regle.netCents, undefined, 'aucun net ne peut être inscrit quand rien n’a été viré');
  assert.ok(!regle.transferId, 'aucun virement ne peut être référencé: ' + regle.transferId);
  assert.ok(!regle.chargeId, 'aucune charge ne peut être référencée: ' + regle.chargeId);
});

// Le cœur de l'ADR : ZÉRO dollar. Le magnétophone Stripe du monde enregistre
// toute capture, tout virement et tout prélèvement de frais ; il doit rester
// muet sur cette offre — alors même que la facturation est branchée.
Then("aucun dollar n'a bougé : ni capture, ni virement, ni frais prélevés", function () {
  const bid = lastBid(this);
  const c = this.stripe.calls;
  const porte = (liste) => liste.filter((x) => x && x.bidId === bid.id);
  assert.deepEqual(porte(c.transfers), [], 'une capture-virement a eu lieu: ' + JSON.stringify(c.transfers));
  assert.deepEqual(porte(c.commissions), [], 'une commission a été prélevée au notaire: ' + JSON.stringify(c.commissions));
  assert.deepEqual(porte(c.feeCaptures), [], 'des frais ont été capturés: ' + JSON.stringify(c.feeCaptures));
  assert.deepEqual(porte(c.feeTransfers), [], 'des frais ont été virés: ' + JSON.stringify(c.feeTransfers));
  assert.deepEqual(porte(c.offSessionFees), [], 'des frais hors session ont été prélevés: ' + JSON.stringify(c.offSessionFees));
  assert.deepEqual(porte(c.holds), [], 'une caution a été posée: ' + JSON.stringify(c.holds));
});

// La réponse de la route ne doit pas non plus glisser un « payé » : la console
// du notaire s'en sert pour afficher le relevé de versement.
Then('la réponse ne prétend nulle part que l\'acte a été payé', function () {
  assert.equal(this.response.statusCode, 200, this.response.body);
  const j = this.responseJson;
  assert.ok(!('paid' in j), 'la réponse annonce un paiement: ' + this.response.body);
  assert.ok(!('netCents' in j), 'la réponse annonce un net viré: ' + this.response.body);
});

// --- Ce que la créance devient ----------------------------------------------

Then('le notaire {string} doit {int} $ à Nota', async function (email, du) {
  const profile = await this.repo.getNotary(notaryIdForEmail(email));
  assert.ok(profile, 'notaire inconnu: ' + email);
  assert.equal(Number(profile.commissionCentsDue) || 0, cents(du));
});

// Les DEUX cumuls ne doivent jamais se confondre : `commissionCentsCollected`
// est l'argent que Nota a réellement. Un règlement hors plateforme ne l'a pas
// fait bouger — c'était le bogue.
Then('le cumul des sommes réellement encaissées par Nota reste à {int} $', async function (encaisse) {
  const profils = await this.repo.listNotaries();
  for (const p of profils || []) {
    assert.equal(Number(p.commissionCentsCollected) || 0, cents(encaisse), 'le cumul ENCAISSÉ de ' + p.id + ' a bougé');
  }
});

// La console de l'exploitation lit le vrai module d'analytique, sur le vrai
// dépôt : une créance qui n'atteint pas l'écran n'existe pour personne.
Then('la console de Nota totalise {int} $ de créances', async function (total) {
  const analytics = createAnalytics({ repo: this.repo, now: () => this.today });
  const resume = await analytics.overview({ from: this.today, to: this.today });
  assert.ok(resume && resume.creances, 'le résumé ne porte aucune créance: ' + JSON.stringify(Object.keys(resume || {})));
  assert.equal(resume.creances.commissionCentsDue, cents(total));
});

// --- Ce que le notaire lit ---------------------------------------------------

Then('le relevé du notaire {string} porte {int} acte réglé hors plateforme, {int} $ à percevoir', async function (email, nb, du) {
  const token = await notarySession(this, email);
  await this.request({ method: 'GET', path: '/notary/acts', headers: { authorization: 'Bearer ' + token } });
  assert.equal(this.response.statusCode, 200, this.response.body);
  const j = this.responseJson;
  const horsPlateforme = j.actes.filter((a) => a.paye === false);
  assert.equal(horsPlateforme.length, nb, 'actes réglés hors plateforme: ' + JSON.stringify(j.actes));
  assert.equal(j.totaux.du, du, 'le relevé doit annoncer le montant à percevoir');
  // Le net du notaire EST ses honoraires : rien n'en est retranché, même
  // lorsque Nota reste impayée (art. 32.1 2° de la Loi sur le notariat).
  for (const a of horsPlateforme) assert.equal(a.net, a.honoraires, 'le net du notaire doit rester ses honoraires entiers');
});

// Un courriel « Acte payé » sur un acte impayé serait la version épistolaire du
// paiement fantôme.
Then('le notaire {string} ne reçoit aucun relevé « Acte payé »', function (email) {
  const releves = this.mailsTo(email).filter((m) => typeof m.subject === 'string' && m.subject.includes('Acte payé'));
  assert.deepEqual(releves, [], 'un relevé de versement a été envoyé: ' + JSON.stringify(releves.map((m) => m.subject)));
});

// --- Ce que la piste d'audit dit ---------------------------------------------

Then('la trace du règlement porte {int} $ d\'honoraires, {int} $ pour Nota, et la mention « non payé » avec {int} $ dus', async function (honoraires, prixNota, du) {
  const traces = await tracesDuReglement(this);
  assert.equal(traces.length, 1, 'exactement une trace de règlement attendue: ' + JSON.stringify(traces));
  const meta = traces[0].meta;
  assert.equal(meta.honoraires, honoraires);
  assert.equal(meta.prixNota, prixNota);
  assert.equal(meta.paye, false, 'la pièce d’audit doit dire « dû », jamais « encaissé »');
  assert.equal(meta.commissionCentsDue, cents(du));
  // Aucune référence Stripe ne peut figurer sur une trace où rien n'a bougé.
  assert.equal(meta.chargeId, null);
  assert.equal(meta.transferId, null);
});

// Une reprise idempotente ne doit doubler ni la créance, ni la preuve.
Then("la trace du règlement n'a été écrite qu'une seule fois", async function () {
  const traces = await tracesDuReglement(this);
  assert.equal(traces.length, 1, 'la piste d’audit a doublé le règlement: ' + JSON.stringify(traces));
});
