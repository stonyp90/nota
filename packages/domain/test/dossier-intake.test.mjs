/**
 * Dossier file intake rules (ADR 0010 §4: the file NEVER leaves the device —
 * what travels is its declared, cleaned name plus typed answers).
 *
 * Three doors, shared by web and API:
 *   - sanitizeFileName: a declared name is a bare, bounded filename — no path,
 *     no control characters, extension preserved when truncating.
 *   - validateDossierFile: the browser refuses early (format the notary could
 *     not open, oversize) with a human French message.
 *   - cleanDossier: the API's twin — whatever arrives, the STORED dossier only
 *     holds the service's own items, the consent flag and the known pricing
 *     answers, each value bounded. Local UI state (__validated) and unknown
 *     keys never reach the record a notary later receives.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

test('sanitizeFileName: bare bounded filename — no path, no control chars', () => {
  assert.equal(D.sanitizeFileName('C:\\fakepath\\permis.pdf'), 'permis.pdf');
  assert.equal(D.sanitizeFileName('../../etc/passwd.pdf'), 'passwd.pdf');
  assert.equal(D.sanitizeFileName(' permis\u0000\u001f de\tconduire.PDF '), 'permis de conduire.PDF');
  assert.equal(D.sanitizeFileName(null), '');
  const long = 'a'.repeat(500) + '.pdf';
  const cut = D.sanitizeFileName(long);
  assert.ok(cut.length <= D.DOSSIER_FILE.maxNameLength, 'bounded');
  assert.ok(cut.endsWith('.pdf'), 'extension survives truncation');
});

test('validateDossierFile: notarial exchange formats pass, with the cleaned name', () => {
  for (const name of ['permis.pdf', 'photo.JPG', 'scan.jpeg', 'id.png', 'IMG_1234.HEIC', 'plan.webp']) {
    const v = D.validateDossierFile({ name, size: 1024 });
    assert.equal(v.ok, true, name);
  }
  const v = D.validateDossierFile({ name: 'C:\\fakepath\\permis.pdf', size: 1024 });
  assert.equal(v.name, 'permis.pdf');
});

test('validateDossierFile: a format the notary could not open is refused, in French', () => {
  for (const name of ['virus.exe', 'note.docx', 'archive.zip', 'sansextension', 'permis.pdf.exe']) {
    const v = D.validateDossierFile({ name, size: 1024 });
    assert.equal(v.ok, false, name);
    assert.equal(v.code, 'format');
    assert.match(v.message, /Format/);
  }
});

test('validateDossierFile: oversize is refused and the limit is named from the rule', () => {
  const v = D.validateDossierFile({ name: 'permis.pdf', size: D.DOSSIER_FILE.maxBytes + 1 });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'taille');
  const mo = Math.round(D.DOSSIER_FILE.maxBytes / (1024 * 1024));
  assert.ok(v.message.includes(String(mo)), 'message names the configured limit');
  // At the boundary it passes.
  assert.equal(D.validateDossierFile({ name: 'permis.pdf', size: D.DOSSIER_FILE.maxBytes }).ok, true);
});

test('cleanDossier: keeps the service’s own items, consent and known pricing — bounded', () => {
  const dirty = {
    piece_identite: 'permis.pdf',
    offre_preteur: D.DOSSIER_TRANSMIS,
    adresse: '  10 rue des Érables, Québec  ',
    inconnue: 'jamais stockée',
    __validated: { piece_identite: true },
    __consent: '1',
    __pricing: { valeur_pret: 250000, succession: 'non', hacked: 'x'.repeat(9000), preteur_autre: 'Prêteur Untel' },
    __evil: { huge: 'x'.repeat(100000) },
  };
  const clean = D.cleanDossier('refinancement', dirty);
  assert.equal(clean.piece_identite, 'permis.pdf');
  assert.equal(clean.offre_preteur, D.DOSSIER_TRANSMIS, 'the sentinel survives');
  assert.equal(clean.adresse, '10 rue des Érables, Québec');
  assert.equal(clean.__consent, '1');
  assert.equal(clean.__pricing.valeur_pret, 250000);
  assert.equal(clean.__pricing.succession, 'non');
  assert.equal(clean.__pricing.preteur_autre, 'Prêteur Untel', 'the « autre » champ of a criterion is known');
  assert.ok(!('inconnue' in clean), 'unknown item dropped');
  assert.ok(!('__evil' in clean), 'unknown reserved key dropped');
  assert.ok(!('__validated' in clean), 'local UI state never reaches the record');
  assert.ok(!('hacked' in clean.__pricing), 'unknown pricing key dropped');
});

test('cleanDossier: every stored value is bounded, whatever arrives', () => {
  const clean = D.cleanDossier('refinancement', {
    piece_identite: 'p/a\\th\u0000' + 'n'.repeat(9000) + '.pdf',
    adresse: 'x'.repeat(9000),
    compte_taxes: { nested: 'object' },
    releve_hypotheque: 42,
    __consent: { truthy: 'object' },
    __pricing: { valeur_pret: Infinity, succession: ['non'] },
  });
  assert.ok(clean.piece_identite.length <= D.DOSSIER_FILE.maxNameLength, 'doc names go through sanitizeFileName');
  assert.ok(!clean.piece_identite.includes('/') && !clean.piece_identite.includes('\\'), 'no path');
  assert.ok(clean.adresse.length <= D.DOSSIER_VALUE_MAX);
  assert.ok(!('compte_taxes' in clean), 'non-string item value dropped');
  assert.ok(!('releve_hypotheque' in clean), 'non-string item value dropped');
  assert.equal(clean.__consent, '1', 'consent collapses to the flag');
  assert.ok(!('__pricing' in clean) || !('valeur_pret' in (clean.__pricing || {})), 'non-finite number dropped');
  // The whole record stays small no matter the payload.
  assert.ok(JSON.stringify(clean).length < 8000);
});

test('cleanDossier: hostile shapes collapse to an empty object', () => {
  assert.deepEqual(D.cleanDossier('refinancement', null), {});
  assert.deepEqual(D.cleanDossier('refinancement', ['a']), {});
  assert.deepEqual(D.cleanDossier('service_inconnu', { piece_identite: 'x.pdf' }), {});
});

test('cleanDossier composes with leadReadiness: a cleaned dossier keeps its readiness', () => {
  const saved = {
    __consent: '1',
    __pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale' },
    piece_identite: 'permis.pdf',
    __validated: { piece_identite: true },
  };
  const before = D.leadReadiness('refinancement', saved);
  const after = D.leadReadiness('refinancement', D.cleanDossier('refinancement', saved));
  assert.equal(after.ready, before.ready);
  assert.equal(after.done, before.done);
});
