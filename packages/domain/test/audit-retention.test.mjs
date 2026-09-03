/**
 * La conservation du journal d'audit est une règle d'affaires, pas un détail
 * d'adaptateur : `docs/legal/politique-conservation-des-donnees.md` §1 nomme
 * SEPT ANS pour le « journal d'audit administratif », au titre de la preuve
 * d'imputabilité. La Loi 25 exige une conservation BORNÉE — un journal éternel
 * n'est pas plus conforme qu'un journal absent — donc la durée vit ici, une
 * seule fois, et les deux adaptateurs de dépôt la posent en `ttl` DynamoDB.
 *
 * Ce que ces tests refusent : un compte en jours (7 × 365 = 2555 j) qui ferait
 * expirer la preuve DEUX JOURS TROP TÔT à cause des années bissextiles. Sur une
 * borne légale, arrondir vers le bas est la seule erreur qui coûte cher.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../index.js');

test('la politique nomme sept ans, et c’est cette durée qui est exportée', () => {
  assert.equal(domain.AUDIT_RETENTION_YEARS, 7);
});

test('l’échéance est une DATE de calendrier, pas un compte de jours', () => {
  // 2026-09-03 + 7 ans = 2033-09-03, à la seconde près.
  const ecrit = Date.UTC(2026, 8, 3, 19, 30, 0);
  const ttl = domain.auditRetentionTtl(ecrit);
  assert.equal(new Date(ttl * 1000).toISOString(), '2033-09-03T19:30:00.000Z');

  // Le compte naïf (7 × 365 jours) tomberait deux jours plus tôt : c'est
  // exactement l'erreur que la fonction existe pour ne pas commettre.
  const naif = Math.floor(ecrit / 1000) + 7 * 365 * 86400;
  assert.ok(ttl > naif, 'sept ans civils sont plus longs que 2555 jours');
  assert.equal(ttl - naif, 2 * 86400, 'deux jours bissextiles récupérés (2028, 2032)');
});

test('le 29 février repousse au 1er mars — jamais vers la veille', () => {
  const ttl = domain.auditRetentionTtl(Date.UTC(2028, 1, 29, 12, 0, 0));
  // 2035 n'est pas bissextile : la date roule vers le 1er mars, donc plus tard.
  assert.equal(new Date(ttl * 1000).toISOString(), '2035-03-01T12:00:00.000Z');
});

test('un instant illisible ne fabrique pas une échéance : la fonction rend null', () => {
  // Un `ttl` inventé sur une date absurde effacerait une preuve au hasard.
  // Mieux vaut aucune expiration qu'une expiration fausse.
  assert.equal(domain.auditRetentionTtl(NaN), null);
  assert.equal(domain.auditRetentionTtl(undefined), null);
  assert.equal(domain.auditRetentionTtl('pas une date'), null);
});

test('l’échéance est en SECONDES epoch — l’unité que DynamoDB attend', () => {
  const ttl = domain.auditRetentionTtl(Date.UTC(2026, 0, 1));
  assert.ok(Number.isInteger(ttl));
  // Un ttl en millisecondes serait ~1000× trop grand et n'expirerait jamais.
  assert.ok(ttl < 1e11, 'un ttl en millisecondes ne serait jamais collecté');
});
