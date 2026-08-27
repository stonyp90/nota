import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// The signature is in person within a declared perimeter (ADR 0017): someone
// travels — the client to the étude, or the notary to the client — and the
// declared band prices the kilometres. The one exception is a DECLARED
// urgency, which goes 100 % online at a firm premium, and only reaches a
// notary who explicitly opted in.

test('DEPLACEMENTS: a catalogue of explicit bands, every band well-formed', () => {
  assert.ok(Array.isArray(D.DEPLACEMENTS) && D.DEPLACEMENTS.length >= 5, 'a real ladder of bands');
  const ids = new Set();
  for (const d of D.DEPLACEMENTS) {
    assert.match(d.id, /^[a-z0-9_]+$/, `${d.id} is a stable slug`);
    assert.ok(!ids.has(d.id), `${d.id} is unique`);
    ids.add(d.id);
    assert.ok(typeof d.nom === 'string' && d.nom.length > 0, `${d.id} has a display name`);
    assert.ok(['client', 'notaire', 'en_ligne'].includes(d.qui), `${d.id} says who moves`);
    assert.ok(Number.isFinite(d.km) && d.km >= 0, `${d.id} carries its kilometre band`);
    assert.ok(Number.isFinite(d.add) && d.add >= 0, `${d.id} has a flat add`);
    assert.ok(Number.isFinite(d.poids) && d.poids >= 0, `${d.id} has a complexity weight`);
    assert.equal(typeof d.urgence, 'boolean', `${d.id} declares urgency or not`);
  }
});

test('DEPLACEMENTS: the mobile client is the baseline — the price only rises as the pool shrinks', () => {
  // The « à partir de » price IS the most-mobile-client scenario: floors hold.
  const baseline = D.deplacementById('client_50');
  assert.equal(baseline.add, 0, 'a client travelling up to 50 km pays the catalogue floor');
  assert.equal(baseline.qui, 'client');
  assert.equal(baseline.urgence, false);
  // Less client mobility → smaller pool → higher add, monotonically.
  assert.ok(D.deplacementById('client_25').add > 0);
  assert.ok(D.deplacementById('client_10').add > D.deplacementById('client_25').add);
  // The notary travelling is paid work: above every client-travel band.
  assert.ok(D.deplacementById('notaire_25').add > D.deplacementById('client_10').add);
  assert.ok(D.deplacementById('notaire_50').add > D.deplacementById('notaire_25').add);
  assert.equal(D.deplacementById('notaire_25').qui, 'notaire');
  // The declared urgency is the firmest premium of the ladder.
  const u = D.deplacementById(D.DEPLACEMENT_URGENCE_ID);
  assert.ok(u, 'the online-urgency band exists');
  assert.equal(u.qui, 'en_ligne');
  assert.equal(u.urgence, true);
  assert.ok(u.add >= 400, 'the urgency premium is firm');
  assert.ok(D.DEPLACEMENTS.every((d) => u.add >= d.add), 'nothing outprices the declared urgency');
  assert.equal(D.deplacementById('inconnu'), null);
});

test('every financing act asks who travels, as a required select over the catalogue', () => {
  for (const svc of D.SERVICES) {
    const c = (svc.pricing.criteria || []).find((x) => x.id === D.DEPLACEMENT_CRITERION_ID);
    assert.ok(c, `${svc.id} asks for the déplacement`);
    assert.equal(c.type, 'choice');
    assert.equal(c.required, true, 'the perimeter is primordial — no band, no offer');
    assert.equal(c.ui, 'select', 'six sentence-length bands — renderers use a select');
    assert.deepEqual(c.options.map((o) => o.id), D.DEPLACEMENTS.map((d) => d.id), 'options ARE the catalogue');
    for (const o of c.options) assert.equal(o.add, D.deplacementById(o.id).add, `${o.id} option mirrors the catalogue add`);
  }
});

test('the band moves the floor; complexity names the travel', () => {
  const base = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'desjardins' };
  assert.equal(D.computeBasePrice('refinancement', { ...base, deplacement: 'client_50' }), 2000, 'the mobile client pays the advertised floor');
  assert.equal(D.computeBasePrice('refinancement', { ...base, deplacement: 'client_10' }), 2100);
  assert.equal(D.computeBasePrice('refinancement', { ...base, deplacement: 'notaire_50' }), 2250, 'the notary’s kilometres are paid');
  assert.equal(D.computeBasePrice('refinancement', { ...base, deplacement: 'urgence_en_ligne' }), 2400, 'the declared urgency carries its premium');
  assert.equal(D.complexity('refinancement', { ...base, deplacement: 'client_50' }).level, 'simple');
  const c = D.complexity('refinancement', { ...base, deplacement: 'notaire_50' });
  assert.ok(c.score >= 2, 'a travelling notary weighs on complexity');
  assert.ok(c.factors.some((f) => /Déplacement pour la signature : /.test(f)), 'the factor names the band');
});

test('a bid cannot be posted without declaring who travels', () => {
  const answers = { valeur_pret: 250000, contexte: 'propriete_detenue', approbation_bancaire: 'obtenue', preteur: 'desjardins' };
  const missing = D.missingRequired('financement', answers);
  assert.deepEqual(missing.map((m) => m.id), ['deplacement']);
  const r = D.validateOffer({
    serviceId: 'financement', dateISO: '2026-09-20', montant: 2500, todayISO: '2026-08-26',
    pricing: answers,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'parametre_requis' && e.param === 'deplacement'));
  const ok = D.validateOffer({
    serviceId: 'financement', dateISO: '2026-09-20', montant: 2500, todayISO: '2026-08-26',
    pricing: { ...answers, deplacement: 'client_50' },
  });
  assert.equal(ok.ok, true, 'banded, the offer is valid: ' + JSON.stringify(ok.errors));
});

test('bidDeplacement: reads the band off a bid’s pricing answers', () => {
  assert.equal(D.bidDeplacement({ pricing: { deplacement: 'notaire_25' } }).nom, D.deplacementById('notaire_25').nom);
  assert.equal(D.bidDeplacement({ pricing: { deplacement: 'urgence_en_ligne' } }).urgence, true);
  assert.equal(D.bidDeplacement({ pricing: {} }), null, 'a bid predating the question names no band');
  assert.equal(D.bidDeplacement(null), null);
});

test('notaryCanServe: the feed only offers what the notary can serve', () => {
  const sedentaire = { rayonKm: 0, urgences: false };
  const mobile25 = { rayonKm: 25, urgences: false };
  const mobile50 = { rayonKm: 50, urgences: false };
  const enLigne = { rayonKm: 0, urgences: true };
  // Client-travel bands reach every notary — the client comes to the étude.
  for (const p of [sedentaire, mobile25, mobile50, enLigne]) {
    for (const id of ['client_50', 'client_25', 'client_10']) {
      assert.equal(D.notaryCanServe(id, p), true, `${id} reaches every notary`);
    }
  }
  // Notary-travel bands require a declared radius that covers them.
  assert.equal(D.notaryCanServe('notaire_25', sedentaire), false, 'a notary who said nothing travels nowhere');
  assert.equal(D.notaryCanServe('notaire_25', mobile25), true);
  assert.equal(D.notaryCanServe('notaire_50', mobile25), false, '25 km does not cover a 50 km ask');
  assert.equal(D.notaryCanServe('notaire_50', mobile50), true, 'a wide radius sees demandes others never see');
  // The declared urgency reaches only the notaries who opted in.
  assert.equal(D.notaryCanServe('urgence_en_ligne', mobile50), false, 'urgency is opt-in, radius buys nothing');
  assert.equal(D.notaryCanServe('urgence_en_ligne', enLigne), true);
  // Legacy tolerance: a bid predating the question reaches everyone; an absent
  // profile is the conservative default.
  assert.equal(D.notaryCanServe(null, sedentaire), true);
  assert.equal(D.notaryCanServe('notaire_50', null), false);
  assert.equal(D.notaryCanServe('client_25', null), true);
});

test('validateNotaryProfile: the radius is one of the declared bands, the urgency opt-in a boolean', () => {
  assert.deepEqual(D.NOTARY_RADII, [0, 25, 50], 'the radii mirror the déplacement bands');
  const r = D.validateNotaryProfile({ rayonKm: 50, urgences: true });
  assert.equal(r.ok, true);
  assert.equal(r.rayonKm, 50);
  assert.equal(r.urgences, true);
  // Absent → the conservative default: travels nowhere, no urgencies.
  const d = D.validateNotaryProfile({});
  assert.equal(d.ok, true);
  assert.equal(d.rayonKm, 0);
  assert.equal(d.urgences, false);
  // A string radius from a form is coerced; garbage is rejected, typed.
  assert.equal(D.validateNotaryProfile({ rayonKm: '25' }).rayonKm, 25);
  const bad = D.validateNotaryProfile({ rayonKm: 12 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.code === 'rayon_invalide'));
  // The CNQ link keeps its own contract (ADR 0016) beside the new fields.
  const cnq = D.validateNotaryProfile({ lienCNQ: 'https://www.cnq.org/notaire/roy', rayonKm: 25 });
  assert.equal(cnq.ok, true);
  assert.equal(cnq.lienCNQ, 'https://www.cnq.org/notaire/roy');
  assert.equal(cnq.rayonKm, 25);
});

test('fixtures declare who travels, so demo bids stay valid offers', () => {
  const bids = D.makeFixtures('2026-08-26');
  for (const b of bids) {
    assert.ok(D.deplacementById(b.pricing.deplacement), `${b.id} declares a catalogued band`);
    assert.deepEqual(D.missingRequired(b.serviceId, b.pricing), [], `${b.id} answers every required question`);
  }
  assert.deepEqual(D.makeFixtures('2026-08-26'), bids, 'fixtures stay deterministic');
  assert.ok(D.seedSignature().includes('deplacement'), 'seedSignature carries the criteria shape');
  assert.ok(D.seedSignature().includes('urgence_en_ligne:'), 'seedSignature carries the déplacement pricing shape');
});
