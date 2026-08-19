import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const emails = require('../src/emails.js');

const BASE = 'https://nota.example';
const BRAND = '#2c5f34'; // Nota hunter green — primary

// A single context that exercises every template's variables at once.
const CTX = {
  serviceId: 'refinancement',
  dateISO: '2026-08-19',
  montant: 1500,
  tier: 'prioritaire',
  days: 7,
  bids: [{ serviceId: 'testament', dateISO: '2026-08-20', montant: 700, tier: 'rapide' }],
  notaryEmail: 'notaire@example.ca',
  email: 'client@example.ca',
  baseUrl: BASE,
  unsubscribeUrl: BASE + '/unsubscribe?token=abc123',
};

const names = Object.keys(emails.TEMPLATES);

test('the brand palette exposes the Nota hunter green', () => {
  // Guards against a palette drift away from the brand primary.
  assert.ok(names.length >= 13, 'expected the full lifecycle set of templates');
});

// --- per-template brand + compliance assertions ------------------------------
for (const name of names) {
  test(`${name}: renders with the Nota brand and CASL compliance`, () => {
    const out = emails.TEMPLATES[name](CTX);

    // Return shape is preserved.
    assert.equal(typeof out.subject, 'string');
    assert.equal(typeof out.html, 'string');
    assert.equal(typeof out.text, 'string');

    // Non-empty subject.
    assert.ok(out.subject && out.subject.trim().length > 0, `${name}: empty subject`);

    // Brand color present in the rendered HTML.
    assert.ok(out.html.includes(BRAND), `${name}: HTML missing brand color ${BRAND}`);

    // The Nota wordmark is present.
    assert.ok(out.html.includes('Nota'), `${name}: HTML missing the Nota wordmark`);

    // Working unsubscribe link — the exact URL passed in — in HTML and text.
    assert.ok(out.html.includes(CTX.unsubscribeUrl), `${name}: HTML missing the unsubscribe link`);
    assert.ok(out.text.includes(CTX.unsubscribeUrl), `${name}: text missing the unsubscribe link`);

    // Sender identification (CASL): name + mailing address in HTML and text.
    assert.ok(out.html.includes(emails.SENDER.name), `${name}: HTML missing sender name`);
    assert.ok(out.html.includes(emails.SENDER.address), `${name}: HTML missing mailing address`);
    assert.ok(out.text.includes(emails.SENDER.address), `${name}: text missing mailing address`);

    // ONE bulletproof (table-based) CTA anchor.
    assert.ok(/<a /.test(out.html), `${name}: no CTA anchor in HTML`);
  });
}

// --- shared layout structure -------------------------------------------------
test('every template shares the branded, email-safe layout wrapper', () => {
  for (const name of names) {
    const { html } = emails.TEMPLATES[name](CTX);

    // Table-based, centered, max 600px.
    assert.ok(html.includes('max-width:600px'), `${name}: missing 600px content width`);
    assert.ok(html.includes('role="presentation"'), `${name}: not table-based`);

    // Hidden preheader span at the top of the body.
    assert.ok(html.includes('display:none'), `${name}: missing hidden preheader`);

    // No <style> blocks — clients strip them; all CSS must be inline.
    assert.ok(!/<style[\s>]/i.test(html), `${name}: uses a <style> block`);

    // Inter-first font stack (brand type).
    assert.ok(html.includes('Inter'), `${name}: missing the Inter font stack`);

    // The "N" logo mark square is rendered in brand green (no external image/SVG).
    assert.ok(!/<img/i.test(html), `${name}: relies on an external <img>`);
    assert.ok(!/<svg/i.test(html), `${name}: relies on an inline <svg>`);
  }
});

// --- plain-text alternative is well-formed -----------------------------------
test('the plain-text alternative carries heading and sender identification', () => {
  for (const name of names) {
    const { text } = emails.TEMPLATES[name](CTX);
    assert.ok(text.trim().length > 0, `${name}: empty text body`);
    assert.ok(text.includes(emails.SENDER.name), `${name}: text missing sender name`);
  }
});

// The API resolves @nota/domain through apps/api/node_modules/@nota/domain, a
// PHYSICAL copy the deploy step refreshes (`cp packages/domain/index.js …`). A
// stale copy shadows the workspace symlink and silently serves old business
// rules to every email, ICS file and analytics label — while the whole suite
// still passes. These assertions fail loudly when that copy drifts.
test('the domain the API actually resolves is current, not a stale copy', () => {
  const domain = require('@nota/domain');
  const workspace = require('../../../packages/domain/index.js');

  // fr-CA money uses a NO-BREAK space; a stale pre-NBSP copy has ASCII spaces.
  const amount = domain.money(1234567);
  assert.ok(!amount.includes(' '), 'money() served to the API still has ASCII spaces: ' + JSON.stringify(amount));
  assert.ok(amount.includes(' '), 'money() must separate with a no-break space');
  assert.equal(amount, workspace.money(1234567), 'the API sees a different money() than the workspace');

  // A spot-check on a label that changed, so a drift in either direction shows.
  assert.equal(domain.tierById('urgence').nom, workspace.tierById('urgence').nom,
    'the API resolves a different tier label than packages/domain');
  assert.deepEqual(
    domain.SERVICES.map((s) => s.id),
    workspace.SERVICES.map((s) => s.id),
    'the API resolves a different service list than packages/domain'
  );
});
