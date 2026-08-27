/**
 * The stored dossier is CLEANED at both write doors (POST /bids snapshot and
 * POST /client/dossier): whatever the payload carries, the record a notary
 * later receives holds only the service's own items, the consent flag and the
 * known pricing answers — each value bounded (domain.cleanDossier). Local UI
 * state (__validated) and unknown keys never reach the bid record.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-12';

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  return { ...createApp(repo, { now: () => TODAY, newId: () => 'id-' + ++n, ...opts }), repo };
}

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale' };

async function seedBid(a, over = {}) {
  const res = await a.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement',
      dateISO: '2026-08-20',
      montant: 2800,
      courriel: 'client@example.ca',
      pricing: PRICING,
      ...over,
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res); // { bid, clientToken }
}

test('POST /client/dossier stores the CLEANED dossier — junk and local UI state never persist', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  const res = await a.handle({
    method: 'POST',
    path: '/client/dossier',
    headers: bearer(clientToken),
    body: JSON.stringify({
      id: bid.id,
      dateISO: bid.dateISO,
      dossier: {
        piece_identite: 'C:\\fakepath\\permis.pdf',
        offre_preteur: domain.DOSSIER_TRANSMIS,
        adresse: '10 rue des Érables, Québec',
        __consent: '1',
        __pricing: { ...PRICING, hacked: 'x'.repeat(5000) },
        __validated: { piece_identite: true },
        inconnue: 'x'.repeat(30000), // large but under the 64 KB transport cap — cleaning, not 413, is what bounds storage

      },
    }),
  });
  assert.equal(res.statusCode, 200, res.body);
  const stored = (await a.repo.get(bid.id, bid.dateISO)).dossier;
  assert.equal(stored.piece_identite, 'permis.pdf', 'declared names are sanitized');
  assert.equal(stored.offre_preteur, domain.DOSSIER_TRANSMIS);
  assert.equal(stored.adresse, '10 rue des Érables, Québec');
  assert.equal(stored.__consent, '1');
  assert.ok(!('inconnue' in stored), 'unknown keys never persist');
  assert.ok(!('__validated' in stored), 'local UI state never persists');
  assert.ok(!('hacked' in (stored.__pricing || {})));
  assert.ok(JSON.stringify(stored).length < 8000, 'the record stays bounded whatever arrives');
  // The answered readiness reflects the cleaned dossier.
  assert.equal(parse(res).readiness.ready, true);
});

test('POST /client/dossier still refuses a non-object dossier (422 dossier_invalide)', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  for (const dossier of ['nope', ['a'], null]) {
    const res = await a.handle({
      method: 'POST',
      path: '/client/dossier',
      headers: bearer(clientToken),
      body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, dossier }),
    });
    assert.equal(res.statusCode, 422, res.body);
    assert.equal(parse(res).errors[0].code, 'dossier_invalide');
  }
});

test('POST /bids cleans the dossier snapshot at creation too', async () => {
  const a = app();
  const { bid } = await seedBid(a, {
    dossier: { adresse: '10 rue des Érables', __validated: { adresse: true }, junk: 'x'.repeat(30000) },
  });
  const stored = (await a.repo.get(bid.id, bid.dateISO)).dossier;
  assert.equal(stored.adresse, '10 rue des Érables');
  assert.ok(!('junk' in stored));
  assert.ok(!('__validated' in stored));
});
