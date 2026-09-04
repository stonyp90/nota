import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// The lender catalogue: the institutions that normally lend to Quebec
// borrowers. The lender INFORMS the notary (who may refuse an act on it) but
// no longer surcharges the price — only a private lender still does. A lender
// missing from the list is typed in by the client (« Autre prêteur » + name).

test('LENDERS: a non-empty catalogue where every lender is well-formed', () => {
  assert.ok(Array.isArray(D.LENDERS) && D.LENDERS.length >= 10, 'a real market list');
  const ids = new Set();
  for (const l of D.LENDERS) {
    assert.match(l.id, /^[a-z0-9_]+$/, `${l.id} is a stable slug`);
    assert.ok(!ids.has(l.id), `${l.id} is unique`);
    ids.add(l.id);
    assert.ok(typeof l.nom === 'string' && l.nom.length > 0, `${l.id} has a display name`);
    assert.equal(typeof l.virtuel, 'boolean', `${l.id} declares virtual or not`);
    assert.ok(Number.isFinite(l.add) && l.add >= 0, `${l.id} has a flat add`);
    assert.ok(Number.isFinite(l.poids) && l.poids >= 0, `${l.id} has a complexity weight`);
  }
});

test('LENDERS: choosing a lender is free — only the private lender surcharges', () => {
  for (const id of ['banque_nationale', 'desjardins', 'rbc', 'td', 'bmo', 'scotia', 'cibc', 'laurentienne']) {
    const l = D.lenderById(id);
    assert.ok(l, `${id} is in the catalogue`);
    assert.equal(l.virtuel, false, `${id} has branches`);
    assert.equal(l.add, 0, `${id} adds nothing`);
  }
  const virtual = D.LENDERS.filter((l) => l.virtuel);
  assert.ok(virtual.length >= 5, 'the virtual/branchless lenders are represented');
  for (const l of virtual) {
    assert.equal(l.add, 0, `${l.id} no longer surcharges the price`);
    assert.ok(l.poids >= 1, `${l.id} still weighs on complexity (the coordination is real work)`);
  }
  // A private lender stays the heaviest case — the one deliberate surcharge.
  assert.equal(D.lenderById('prive').add, 300, 'private lender keeps its surcharge');
  assert.equal(D.lenderById('prive').poids, 2);
  // The catch-all is free: the client NAMES their lender instead of paying more.
  assert.ok(D.lenderById('autre'), 'an "other" catch-all exists');
  assert.equal(D.lenderById('autre').add, 0, 'naming an unlisted lender costs nothing');
  assert.equal(D.lenderById('inconnu'), null);
});

test('every financing act asks the lender question, as a required select over the catalogue', () => {
  for (const svc of D.SERVICES) {
    const c = (svc.pricing.criteria || []).find((x) => x.id === D.LENDER_CRITERION_ID);
    assert.ok(c, `${svc.id} asks for the lender`);
    assert.equal(c.type, 'choice');
    assert.equal(c.required, true);
    assert.equal(c.ui, 'select', 'too many lenders for chips — renderers use a select');
    assert.deepEqual(c.options.map((o) => o.id), D.LENDERS.map((l) => l.id), 'options ARE the catalogue');
    for (const o of c.options) assert.equal(o.add, D.lenderById(o.id).add, `${o.id} option mirrors the catalogue add`);
    // The « Autre prêteur » affordance: one option opens a free-text name.
    assert.ok(c.autre, 'the criterion declares its free-text companion');
    assert.equal(c.autre.option, 'autre');
    assert.equal(c.autre.champ, 'preteur_autre');
    assert.equal(c.autre.label, 'Nom du prêteur');
  }
});

test('the lender no longer moves the price; complexity still names it', () => {
  const base = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' };
  assert.equal(D.computeBasePrice('refinancement', { ...base, preteur: 'desjardins' }), 2000);
  assert.equal(D.computeBasePrice('refinancement', { ...base, preteur: 'tangerine' }), 2000, 'a virtual lender is priced like any other');
  assert.equal(D.computeBasePrice('refinancement', { ...base, preteur: 'prive' }), 2300, 'only the private lender surcharges');
  assert.equal(D.complexity('refinancement', { ...base, preteur: 'desjardins' }).level, 'simple');
  const virt = D.complexity('refinancement', { ...base, preteur: 'tangerine' });
  assert.ok(virt.factors.some((f) => /Prêteur hypothécaire : Tangerine/.test(f)), 'the coordination signal survives as a factor');
  const c = D.complexity('refinancement', { ...base, preteur: 'prive' });
  assert.ok(c.score >= 2, 'a private lender weighs on complexity');
  assert.ok(c.factors.some((f) => /Prêteur hypothécaire : Prêteur privé/.test(f)), 'the factor names the lender');
});

test('a bid cannot be posted without naming the lender', () => {
  const missing = D.missingRequired('financement', { valeur_pret: 250000, contexte: 'propriete_detenue', approbation_bancaire: 'obtenue', succession: 'non', deplacement: 'client_50' });
  assert.deepEqual(missing.map((m) => m.id), ['preteur']);
  const r = D.validateOffer({
    serviceId: 'financement', dateISO: '2026-09-20', montant: 2500, todayISO: '2026-08-26',
    pricing: { valeur_pret: 250000, contexte: 'propriete_detenue', approbation_bancaire: 'obtenue', succession: 'non', deplacement: 'client_50' },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'parametre_requis' && e.param === 'preteur'));
});

test('« Autre prêteur » requires the name — an unlisted lender is added, not left blank', () => {
  const answers = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'autre', deplacement: 'client_50' };
  const missing = D.missingRequired('refinancement', answers);
  assert.deepEqual(missing.map((m) => m.id), ['preteur_autre'], 'the blank name is the one missing answer');
  assert.equal(missing[0].label, 'Nom du prêteur');
  assert.deepEqual(D.missingRequired('refinancement', { ...answers, preteur_autre: '   ' }).map((m) => m.id), ['preteur_autre'], 'whitespace is not a name');
  assert.deepEqual(D.missingRequired('refinancement', { ...answers, preteur_autre: 'Fiducie Familiale Roy' }), [], 'a named lender completes the question');

  const r = D.validateOffer({
    serviceId: 'refinancement', dateISO: '2026-09-20', montant: 2500, todayISO: '2026-08-26',
    pricing: answers,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'parametre_requis' && e.param === 'preteur_autre'));
  const ok = D.validateOffer({
    serviceId: 'refinancement', dateISO: '2026-09-20', montant: 2500, todayISO: '2026-08-26',
    pricing: { ...answers, preteur_autre: 'Fiducie Familiale Roy' }, prefixe: 'G1R',
  });
  assert.equal(ok.ok, true, 'named, the offer is valid: ' + JSON.stringify(ok.errors));
});

test('bidLender: reads the lender off a bid’s pricing answers', () => {
  assert.equal(D.bidLender({ pricing: { preteur: 'tangerine' } }).nom, 'Tangerine');
  assert.equal(D.bidLender({ pricing: { preteur: 'tangerine' } }).virtuel, true);
  assert.equal(D.bidLender({ pricing: {} }), null);
  assert.equal(D.bidLender(null), null);
});

test('bidLender: the typed name of an « autre » lender travels to the notary', () => {
  const l = D.bidLender({ pricing: { preteur: 'autre', preteur_autre: '  Fiducie   Familiale Roy  ' } });
  assert.equal(l.id, 'autre', 'the id stays the catalogue slug (the refusal roster keys on it)');
  assert.equal(l.nom, 'Fiducie Familiale Roy', 'the name is what the notary reads, whitespace collapsed');
  // Blank or missing name falls back to the generic label (old bids stay sane).
  assert.equal(D.bidLender({ pricing: { preteur: 'autre' } }).nom, 'Autre prêteur');
  assert.equal(D.bidLender({ pricing: { preteur: 'autre', preteur_autre: '   ' } }).nom, 'Autre prêteur');
  // A crafted payload cannot smuggle an essay into the feed.
  const long = D.bidLender({ pricing: { preteur: 'autre', preteur_autre: 'x'.repeat(500) } });
  assert.ok(long.nom.length <= 80, 'the name is capped');
});

test('fixtures answer the lender question, so demo bids stay valid offers', () => {
  const bids = D.makeFixtures('2026-08-26');
  for (const b of bids) {
    assert.ok(D.lenderById(b.pricing.preteur), `${b.id} names a catalogued lender`);
    // An « autre » fixture carries its typed name — fixtures are VALID offers.
    if (b.pricing.preteur === 'autre') {
      assert.ok(b.pricing.preteur_autre && b.pricing.preteur_autre.trim(), `${b.id} names its unlisted lender`);
    }
    assert.deepEqual(D.missingRequired(b.serviceId, b.pricing), [], `${b.id} answers every required question`);
  }
  // Determinism, and the signature reflects the catalogue's pricing shape so
  // adapters reseed when a lender add changes (the bases moved).
  assert.deepEqual(D.makeFixtures('2026-08-26'), bids);
  assert.ok(D.seedSignature().includes('preteur'), 'seedSignature carries the criteria shape');
  assert.ok(D.seedSignature().includes('prive:300'), 'seedSignature carries the lender pricing shape');
});
