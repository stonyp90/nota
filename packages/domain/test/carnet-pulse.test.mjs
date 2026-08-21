import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

const TODAY = '2026-08-12';

function bid(over) {
  return {
    id: 'b' + Math.random().toString(36).slice(2),
    serviceId: 'testament',
    dateISO: D.addDays(TODAY, 5),
    montant: 800,
    status: D.STATUS.OUVERTE,
    ...over,
  };
}

test('carnetPulse: empty carnet reports zeros, no median, no next date', () => {
  const p = D.carnetPulse([], TODAY);
  assert.equal(p.total, 0);
  assert.equal(p.ouvertes, 0);
  assert.equal(p.retenues, 0);
  assert.equal(p.tauxRetenue, 0);
  assert.equal(p.prochaineDispo, null);
  assert.equal(p.meilleure, null);
  // The three services are always present so the panel keeps a stable shape.
  assert.deepEqual(p.services.map((s) => s.id), D.SERVICES.map((s) => s.id));
  for (const s of p.services) {
    assert.equal(s.total, 0);
    assert.equal(s.median, null);
    assert.equal(s.prixDepart, D.serviceById(s.id).prixDepart);
  }
});

test('carnetPulse: junk input is tolerated', () => {
  const p = D.carnetPulse(null, TODAY);
  assert.equal(p.total, 0);
  const q = D.carnetPulse([null, {}, { dateISO: 'nope', montant: 1 }, bid({})], TODAY);
  assert.equal(q.total, 1);
});

test('carnetPulse: counts split open vs retained and the retention rate', () => {
  const p = D.carnetPulse(
    [
      bid({}),
      bid({}),
      bid({ status: D.STATUS.RETENUE }),
      bid({ serviceId: 'procuration', montant: 400, status: D.STATUS.RETENUE }),
    ],
    TODAY,
  );
  assert.equal(p.total, 4);
  assert.equal(p.ouvertes, 2);
  assert.equal(p.retenues, 2);
  assert.equal(p.tauxRetenue, 50);
});

test('carnetPulse: median is the middle proposed amount, averaged on an even count', () => {
  const odd = D.carnetPulse(
    [bid({ montant: 1700 }), bid({ montant: 1900 }), bid({ montant: 3000 })],
    TODAY,
  );
  assert.equal(odd.services.find((s) => s.id === 'testament').median, 1900);

  const even = D.carnetPulse(
    [bid({ montant: 1700 }), bid({ montant: 1900 }), bid({ montant: 2000 }), bid({ montant: 3000 })],
    TODAY,
  );
  // (1900 + 2000) / 2, rounded to a whole dollar
  assert.equal(even.services.find((s) => s.id === 'testament').median, 1950);
});

test('carnetPulse: retained offers count toward the median — they are what the market cleared at', () => {
  const p = D.carnetPulse(
    [bid({ montant: 1700 }), bid({ montant: 1900, status: D.STATUS.RETENUE }), bid({ montant: 2100 })],
    TODAY,
  );
  const t = p.services.find((s) => s.id === 'testament');
  assert.equal(t.median, 1900);
  assert.equal(t.total, 3);
  assert.equal(t.ouvertes, 2);
});

test('carnetPulse: a median never reads below the service price beside it', () => {
  // Legacy data (bids priced under an older, lower floor) must not surface a
  // médiane under the "à partir de" figure shown next to it — the pair would
  // contradict itself. Below-floor history clamps to today's floor.
  const p = D.carnetPulse(
    [
      bid({ montant: 700 }),
      bid({ montant: 900, status: D.STATUS.RETENUE }),
      bid({ serviceId: 'procuration', montant: 400 }),
    ],
    TODAY,
  );
  const t = p.services.find((s) => s.id === 'testament');
  const pr = p.services.find((s) => s.id === 'procuration');
  assert.equal(t.median, D.serviceById('testament').prixDepart);
  assert.equal(pr.median, D.serviceById('procuration').prixDepart);
  // The floor only guards the lower bound — a genuine market median above the
  // floor passes through untouched (covered by the arithmetic tests above).
});

test('carnetPulse: per-service rows carry their own counts', () => {
  const p = D.carnetPulse(
    [
      bid({ serviceId: 'testament' }),
      bid({ serviceId: 'procuration', montant: 800 }),
      bid({ serviceId: 'procuration', montant: 1000, status: D.STATUS.RETENUE }),
    ],
    TODAY,
  );
  const proc = p.services.find((s) => s.id === 'procuration');
  assert.equal(proc.total, 2);
  assert.equal(proc.ouvertes, 1);
  assert.equal(proc.median, 900);
  assert.equal(p.services.find((s) => s.id === 'refinancement').total, 0);
});

test('carnetPulse: prochaineDispo is the soonest upcoming date still open', () => {
  const p = D.carnetPulse(
    [
      bid({ dateISO: D.addDays(TODAY, -3) }), // past
      bid({ dateISO: D.addDays(TODAY, 2), status: D.STATUS.RETENUE }), // taken
      bid({ dateISO: D.addDays(TODAY, 9) }),
      bid({ dateISO: D.addDays(TODAY, 4) }),
    ],
    TODAY,
  );
  assert.equal(p.prochaineDispo, D.addDays(TODAY, 4));
  // Today itself counts as available.
  const now = D.carnetPulse([bid({ dateISO: TODAY })], TODAY);
  assert.equal(now.prochaineDispo, TODAY);
});

test('carnetPulse: meilleure is the highest amount still open to a notary', () => {
  const p = D.carnetPulse(
    [bid({ montant: 900 }), bid({ montant: 5000, status: D.STATUS.RETENUE }), bid({ montant: 1400 })],
    TODAY,
  );
  assert.equal(p.meilleure, 1400);
});

test('carnetPulse: the demo fixtures produce a populated, coherent pulse', () => {
  const p = D.carnetPulse(D.makeFixtures(TODAY), TODAY);
  assert.equal(p.total, p.ouvertes + p.retenues);
  assert.ok(p.total > 0);
  assert.ok(p.tauxRetenue >= 0 && p.tauxRetenue <= 100);
  for (const s of p.services) {
    // Strictly above: demo data must show a market that clears ABOVE the entry
    // price, never a médiane equal to (or under) the "à partir de" beside it.
    if (s.median != null) assert.ok(s.median > s.prixDepart, `${s.id} median above its floor`);
  }
});

// --- Contact points ---------------------------------------------------------

test('CONTACT: the support email is defined once, here, and is a valid address', () => {
  assert.ok(D.CONTACT, 'the domain exposes the contact points');
  assert.ok(D.isEmail(D.CONTACT.courriel), 'support email is valid');
});

test('CONTACT: the phone number is null until a real line exists — never invented', () => {
  // A wrong phone number is worse than no phone button, so the UI renders the
  // call button ONLY when this is a non-empty string.
  assert.ok(D.CONTACT.telephone === null || typeof D.CONTACT.telephone === 'string');
});

test('telHref: strips formatting to the dial string, null when there is no line', () => {
  assert.equal(D.telHref(null), null);
  assert.equal(D.telHref(''), null);
  assert.equal(D.telHref('418 555-0123'), 'tel:+14185550123');
  assert.equal(D.telHref('+1 (418) 555-0123'), 'tel:+14185550123');
  assert.equal(D.telHref('+33 1 23 45 67 89'), 'tel:+33123456789');
});
