const { Given, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const D = require('../../packages/domain');
Given('une offre publiée le {string} pour signer le {string}', function (created, dateISO) {
  this.expiringBid = { dateISO, status: 'ouverte', expiresOn: D.offerExpirationDate(created, dateISO) };
});
Given('une ancienne offre sans échéance', function () {
  this.expiringBid = { dateISO: '2026-12-30', status: 'ouverte' };
});
Then('son dernier jour de validité est le {string}', function (date) {
  assert.equal(this.expiringBid.expiresOn, date);
  assert.equal(D.isOfferExpired(this.expiringBid, date), false);
});
Then('elle est indisponible le {string}', function (date) {
  assert.equal(D.isOfferExpired(this.expiringBid, date), true);
});
