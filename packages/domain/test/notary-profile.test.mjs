// A notary may attach the link of their official fiche in the Chambre des
// notaires du Québec directory (ADR 0016). The domain owns the validation —
// https and the cnq.org host, nothing else — so a « CNQ » badge can never be
// earned by a link to anywhere but the Chambre's own site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

test('the CNQ constant names the Chambre host and its public directory', () => {
  assert.equal(D.CNQ.host, 'cnq.org');
  assert.ok(D.CNQ.annuaire.startsWith('https://www.cnq.org/'));
});

test('validateNotaryProfile accepts a fiche on cnq.org (and subdomains), trimmed', () => {
  for (const url of [
    '  https://www.cnq.org/trouver-un-notaire/fiche/123/  ',
    'https://cnq.org/trouver-un-notaire/?id=abc',
  ]) {
    const out = D.validateNotaryProfile({ lienCNQ: url });
    assert.equal(out.ok, true, url + ' must pass: ' + JSON.stringify(out.errors));
    assert.equal(out.lienCNQ, url.trim());
  }
});

test('validateNotaryProfile refuses any host but the Chambre, and any scheme but https', () => {
  for (const bad of [
    'https://cnq.org.evil.ca/fiche',        // suffix spoof
    'https://notcnq.org/fiche',             // lookalike host
    'https://www.google.com/?q=cnq.org',    // host in the query only
    'http://www.cnq.org/fiche',             // downgrade to http
    'javascript:alert(1)',                  // not a web URL at all
    'www.cnq.org/fiche',                    // scheme-less
    'x'.repeat(1000),                       // garbage / over-long
  ]) {
    const out = D.validateNotaryProfile({ lienCNQ: bad });
    assert.equal(out.ok, false, bad + ' must be refused');
    assert.ok(out.errors.some((e) => e.code === 'lien_cnq_invalide'));
    assert.equal(out.lienCNQ, null);
  }
});

test('an empty link is valid and clears the fiche (null, no badge)', () => {
  for (const empty of [undefined, null, '', '   ']) {
    const out = D.validateNotaryProfile({ lienCNQ: empty });
    assert.equal(out.ok, true);
    assert.equal(out.lienCNQ, null);
  }
});
