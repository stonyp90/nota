'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

// --- Attribution (domain: normalizeReferralCode / isReferralCode) ------------

When('un client arrive avec le code de parrainage {string}', function (code) {
  this.referralInput = code;
  this.result = this.domain.normalizeReferralCode(code);
});

Then('le code attribué est {string}', function (attendu) {
  assert.equal(this.result, attendu);
});

Then('le code est reconnu comme un code de parrainage valide', function () {
  assert.equal(this.domain.isReferralCode(this.referralInput), true);
});

Then('le code {string} n\'est pas reconnu comme un code de parrainage', function (code) {
  assert.equal(this.domain.isReferralCode(code), false);
});

// --- Booking with a referral code (real POST /bids) ---------------------------
// The code rides along with the publication exactly as the web app attaches it.
// Whatever the API does with it (store it privately, drop an invalid one), it
// must NEVER refuse the booking because of it, and never echo it publicly.

When(
  'je publie une enchère parrainée par {string} pour {string} le {string} à {int}',
  async function (code, serviceId, dateISO, montant) {
    await this.request({
      method: 'POST',
      path: '/bids',
      body: JSON.stringify({
        serviceId,
        dateISO,
        montant,
        parrain: code,
        prefixe: 'G1R',
        ref: code,
        pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
      }),
    });
  }
);

Given('le partenaire inscrit {string} avec le courriel {string}', async function (code, courriel) {
  // Claiming a code is now email-verified (ADR 0011 fraud-hardening): the
  // request only PENDS the claim; the confirmation link (echoed as devToken
  // outside production) must be redeemed at /partenaires/verify to become the
  // partner of record. Drive the whole two-step handshake here.
  await this.request({
    method: 'POST',
    path: '/partenaires',
    body: JSON.stringify({ type: 'agent_immobilier', courriel, code }),
  });
  assert.equal(this.response.statusCode, 200, 'demande de réclamation: ' + this.response.body);
  const devToken = this.responseJson.devToken;
  assert.ok(devToken, 'le lien de confirmation (devToken) doit être fourni hors production');
  await this.request({
    method: 'POST',
    path: '/partenaires/verify',
    body: JSON.stringify({ token: devToken }),
  });
  assert.equal(this.response.statusCode, 201, 'confirmation du partenaire: ' + this.response.body);
});

When(
  'je publie une enchère parrainée par {string} avec le courriel {string} pour {string} le {string} à {int}',
  async function (code, courriel, serviceId, dateISO, montant) {
    await this.request({
      method: 'POST',
      path: '/bids',
      body: JSON.stringify({
        serviceId,
        dateISO,
        montant,
        courriel,
        parrain: code,
        prefixe: 'G1R',
        pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
      }),
    });
  }
);

// The attribution is PRIVATE (never in the response), so these two look at the
// stored record through the repo — exactly what the admin ledger derives from.
Then('la demande publiée porte le parrainage {string}', async function (code) {
  const bid = this.responseJson.bid;
  const stored = await this.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.parrain, code, 'parrainage attribué sur la demande');
});

Then('la demande publiée ne porte aucun parrainage', async function () {
  const bid = this.responseJson.bid;
  const stored = await this.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.parrain, null, 'aucune attribution attendue');
});

Then('dans le carnet du mois {string}, aucune enchère n\'expose de parrainage', async function (month) {
  await this.request({ method: 'GET', path: '/bids', query: { month } });
  assert.equal(this.response.statusCode, 200, 'corps: ' + this.response.body);
  const bids = this.responseJson.bids;
  assert.ok(bids.length >= 1, 'au moins une enchère attendue dans le carnet');
  for (const bid of bids) {
    assert.ok(!('parrain' in bid), 'le carnet public expose un champ parrain: ' + JSON.stringify(bid));
    assert.ok(!('ref' in bid), 'le carnet public expose un champ ref: ' + JSON.stringify(bid));
  }
  assert.ok(!this.response.body.includes('EVEROY'), 'le code de parrainage fuit dans le carnet public');
});

// --- Ledger (domain: referralLedger over bids + referred notaries) ------------
// Domain-level on purpose: the ledger is derived from the records, so these
// scenarios must hold regardless of which API routes exist. Two reward
// tracks: REFERRAL.client per RETAINED referred demand (completion is
// information only), REFERRAL.notaire once per referred notary's first act.

Given('le carnet de parrainage suivant:', function (table) {
  this.referralBids = table.hashes().map((row, i) => ({
    id: 'ref-' + i,
    serviceId: 'refinancement',
    dateISO: this.domain.addDays(this.today, 10),
    montant: 2500,
    parrain: row.parrain,
    status: row.statut === 'retenue' ? this.domain.STATUS.RETENUE : this.domain.STATUS.OUVERTE,
    completed: row.acte === 'oui',
  }));
});

Given('les notaires parrainés suivants:', function (table) {
  this.referralNotaires = table.hashes().map((row) => ({
    parrain: row.parrain,
    premierActe: row.premier_acte === 'oui',
  }));
});

When('je consulte le registre de parrainage', function () {
  this.ledger = this.domain.referralLedger(this.referralBids || [], this.referralNotaires || []);
});

function ledgerEntry(world, code) {
  const entry = (world.ledger || []).find((e) => e.code === code);
  assert.ok(entry, `aucune entrée pour ${code}: ` + JSON.stringify(world.ledger));
  return entry;
}

Then('le code {string} compte {int} demande(s) et un dû de {int} $', function (code, demandes, du) {
  const entry = ledgerEntry(this, code);
  assert.equal(entry.demandes, demandes, 'nombre de demandes référées');
  assert.equal(entry.du, du, 'montant dû au parrain');
});

Then('le code {string} a un dû de {int} $', function (code, du) {
  assert.equal(ledgerEntry(this, code).du, du, 'montant dû au parrain');
});
