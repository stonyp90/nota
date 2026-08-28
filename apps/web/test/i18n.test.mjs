/**
 * Bilingual (fr/en) guarantees for the web app.
 *
 * Two layers are tested:
 *   1. Engine behaviour — public/i18n.js translates exact strings, applies
 *      pattern rules for composed strings, converts money format, and falls
 *      back to French (never a blank) when a string is unknown.
 *   2. Coverage — every user-visible French string in index.html (text nodes,
 *      aria-labels, titles, placeholders, alts, SEO metas) and every
 *      user-facing string exported by @nota/domain has an English entry.
 *      This is what keeps "fully bilingual" true as copy evolves: new copy
 *      without a translation fails CI here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../../../packages/domain/index.js');

// apps/web is "type":"module", so require() would read the UMD i18n.js as ESM.
// Evaluate it the way the smoke suite evaluates app.js: as a plain script.
const I18N = (() => {
  const src = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
})();

const htmlPath = fileURLToPath(new URL('../public/index.html', import.meta.url));

// ---------------------------------------------------------------------------
// 1. Engine behaviour
// ---------------------------------------------------------------------------

test('exact dictionary lookups translate when the language is English', () => {
  I18N.force('en');
  assert.equal(I18N.t('Se connecter'), 'Sign in');
  assert.equal(I18N.t('S’inscrire'), 'Sign up');
  assert.equal(I18N.t('Aujourd’hui'), 'Today');
});

test('French mode is the identity — strings pass through untouched', () => {
  I18N.force('fr');
  assert.equal(I18N.t('Se connecter'), 'Se connecter');
  assert.equal(I18N.t('1 250 $'), '1 250 $');
});

test('amounts in Quebec French format become English format', () => {
  I18N.force('en');
  assert.equal(I18N.t('1 250 $'), '$1,250');
  assert.equal(I18N.t('500 $'), '$500');
  assert.equal(I18N.t('12 345 678 $'), '$12,345,678');
});

test('an unknown string falls back to the French original, never blank', () => {
  I18N.force('en');
  const s = 'Phrase inconnue du dictionnaire.';
  assert.equal(I18N.t(s), s);
});

test('normalization collapses ASCII whitespace but preserves NBSP', () => {
  assert.equal(I18N.normalize('  Se \n connecter '), 'Se connecter');
  assert.equal(I18N.normalize('1 250 $'), '1 250 $');
});

test('locale follows the language', () => {
  I18N.force('fr');
  assert.equal(I18N.locale(), 'fr-CA');
  I18N.force('en');
  assert.equal(I18N.locale(), 'en-CA');
});

// ---------------------------------------------------------------------------
// 2. Coverage of index.html
// ---------------------------------------------------------------------------

// Strings identical in both languages (brands, proper nouns, symbols) or
// intentionally untranslated. Keep this list SHORT — it is an escape hatch,
// not a dumping ground.
const ALLOW = new Set([
  'Nota', 'Québec', '· Québec', 'Québec / Canada', 'Google', 'Outlook',
  'Apple', 'iCal', 'Menu', 'Notifications', 'Standard', 'FR', 'EN',
  'Français', 'English', 'Stripe', 'Interac', 'Couple', 'Urgent',
  // Addresses and sample postal prefixes are not prose.
  'confidentialite@nota.ca', 'info@nota.ca', 'G1R',
]);

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function needsTranslation(s) {
  if (!s || s.length < 2) return false;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(s)) return false; // symbols, numbers, arrows
  if (ALLOW.has(s)) return false;
  return true;
}

function extractHtmlStrings(html) {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/g, '\u0000')
    .replace(/<style[\s\S]*?<\/style>/g, '\u0000')
    .replace(/<!--[\s\S]*?-->/g, '\u0000');

  const texts = [];
  // Text nodes: whatever sits between tags.
  for (const run of noScript.replace(/<[^>]+>/g, '\u0000').split('\u0000')) {
    texts.push(run);
  }
  // Translatable attributes.
  for (const m of noScript.matchAll(/(?<=\s)(?:aria-label|title|placeholder|alt)="([^"]*)"/g)) {
    texts.push(m[1]);
  }
  // SEO metas that the engine swaps in English mode.
  for (const tag of noScript.match(/<meta[^>]*>/g) || []) {
    const name = (tag.match(/(?:name|property)="([^"]*)"/) || [])[1] || '';
    if (/^(description|og:title|og:description|og:image:alt|twitter:title|twitter:description|twitter:image:alt)$/.test(name)) {
      texts.push((tag.match(/content="([^"]*)"/) || [])[1] || '');
    }
  }
  return texts
    .map((s) => I18N.normalize(decodeEntities(s)))
    .filter(needsTranslation);
}

test('every user-visible string in index.html has an English translation', () => {
  const html = readFileSync(htmlPath, 'utf8');
  const dict = I18N.dictionaries();
  // Fragments that are covered as part of a whole-element (innerHTML) entry.
  const excused = new Set();
  for (const key of Object.keys(dict.html)) {
    for (const frag of key.replace(/<[^>]+>/g, '\u0000').split('\u0000')) {
      const n = I18N.normalize(decodeEntities(frag));
      if (n) excused.add(n);
    }
  }
  const missing = extractHtmlStrings(html).filter(
    (s) => !I18N.covered(s) && !excused.has(s)
  );
  assert.deepEqual([...new Set(missing)], [], 'French strings with no English entry');
});

// ---------------------------------------------------------------------------
// 3. Coverage of @nota/domain user-facing strings
// ---------------------------------------------------------------------------

// Field names in domain data whose values reach the user's screen.
const USER_FACING_FIELDS = new Set([
  'nom', 'nomCourt', 'label', 'sublabel', 'aide', 'help', 'description',
  'titre', 'note', 'placeholder', 'hint', 'question', 'message', 'resume', 'short',
]);

function collectDomainStrings(node, out) {
  if (typeof node === 'string') return;
  if (Array.isArray(node)) { node.forEach((n) => collectDomainStrings(n, out)); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && USER_FACING_FIELDS.has(k) && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(v)) out.push(v);
      else collectDomainStrings(v, out);
    }
  }
}

test('every user-facing domain string has an English translation', () => {
  const out = [];
  collectDomainStrings(D.SERVICES, out);
  I18N.force('en');
  const missing = out
    .map((s) => I18N.normalize(s))
    .filter(needsTranslation)
    .filter((s) => !I18N.covered(s));
  assert.deepEqual([...new Set(missing)], [], 'domain strings with no English entry');
});

// The notary card composes two runtime lines the static DOM scan cannot see:
// the readiness badge and the complexity factors ("stripped label : option").
// Enumerate every factor the domain can produce — one answered criterion at a
// time, through the public complexity() door — and require an English entry
// for each, so an English boot never shows a French factor.
test('notary-card composed lines (readiness badge, factors) have English translations', () => {
  I18N.force('en');
  const missing = [];
  const check = (s) => {
    const n = I18N.normalize(s);
    if (needsTranslation(n) && !I18N.covered(n)) missing.push(n);
  };
  ['Dossier prêt', 'Dossier en préparation'].forEach(check);
  for (const svc of D.SERVICES) {
    for (const c of (svc.pricing && svc.pricing.criteria) || []) {
      const answersFor = [];
      if (c.type === 'choice') for (const o of c.options || []) answersFor.push(o.id);
      if (c.type === 'flag') answersFor.push(true);
      if (c.type === 'bracket') for (const b of c.brackets || []) answersFor.push(b.max == null ? 1e9 : b.max);
      for (const a of answersFor) {
        const answers = {}; answers[c.id] = a;
        for (const f of D.complexity(svc.id, answers).factors) check(f);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'composed notary-card strings with no English entry');

  // The act picker's option label is composed too ("nom — à partir de …"):
  // the frame rule translates "à partir de", and the service NAME inside the
  // capture must come out English as well — a fragment rule, not a leak.
  for (const svc of D.SERVICES) {
    const en = I18N.tEn(svc.nom + ' — à partir de ' + D.money(svc.prixDepart));
    assert.ok(en.startsWith(svc.nomEn + ' — from'),
      `composed act option should open with "${svc.nomEn} — from": ${en}`);
  }
});

// The Terms' « Programme partenaires » clause is composed at runtime
// (renderPartnerPane fills in the domain's reward amounts), so the exact-match
// dictionary can never carry it — a full-sentence rule must, with the amounts
// riding the captures into the trailing money conversion.
test('the composed Terms partner clause reads fully in English', () => {
  I18N.force('en');
  const fr = 'Un professionnel qui réfère reçoit une récompense fixe de Nota : '
    + D.money(D.REFERRAL.client) + ' quand la demande d’un client référé est retenue, et '
    + D.money(D.REFERRAL.notaire) + ', une seule fois, quand un notaire référé retient son premier acte. '
    + 'Payée par Nota à même ses propres fonds, elle ne change jamais le prix du client ni les honoraires du notaire. '
    + 'Le professionnel encadré (OACIQ notamment) demeure responsable de divulguer cette récompense à son client lorsque son code de déontologie l’exige.';
  const en = I18N.tEn(fr);
  assert.ok(!/référé|récompense|notaire retient/.test(en), 'no French residue: ' + en);
  assert.ok(en.includes(I18N.tEn(D.money(D.REFERRAL.client))), 'the client amount rides through, money-converted');
  assert.ok(en.includes(I18N.tEn(D.money(D.REFERRAL.notaire))), 'the notary amount rides through, money-converted');
  assert.match(en, /OACIQ/, 'the disclosure duty survives translation');
});

// The demande pill stamps its request date at runtime (« Documents demandés ·
// 4 · le 27 août »); under the English locale the date half comes out of Intl
// as "Aug 27", so the exact-match dictionary can never carry « le Aug 27 » —
// a rule must turn the French article into "on".
test('the composed « le <date> » demande stamp reads in English', () => {
  assert.equal(I18N.tEn('le Aug 27'), 'on Aug 27');
  assert.equal(I18N.tEn('le Sept. 5'), 'on Sept. 5');
  // French dates in French mode are untouched (the rule only fires on the
  // English-locale composition).
  assert.equal(I18N.tEn('le carnet'), 'le carnet');
});

test('web translations agree with the domain’s English labels', () => {
  I18N.force('en');
  for (const s of D.SERVICES) {
    assert.equal(I18N.tEn(s.nom), s.nomEn, `service ${s.id} nom`);
    assert.equal(I18N.tEn(s.nomCourt), s.nomCourtEn, `service ${s.id} nomCourt`);
  }
  for (const t of D.TIERS) {
    assert.equal(I18N.tEn(t.nom), t.nomEn, `tier ${t.id}`);
  }
});

test('offer validation errors have English translations', () => {
  I18N.force('en');
  const today = '2026-08-20';
  const bad = [
    D.validateOffer({ serviceId: 'nope', dateISO: '2026-09-01', montant: 100, todayISO: today }),
    D.validateOffer({ serviceId: (D.SERVICES[0] || {}).id, dateISO: 'invalid', montant: 100, todayISO: today }),
    D.validateOffer({ serviceId: (D.SERVICES[0] || {}).id, dateISO: '2020-01-01', montant: 100, todayISO: today }),
    D.validateOffer({ serviceId: (D.SERVICES[0] || {}).id, dateISO: '2026-09-01', montant: -5, todayISO: today }),
  ];
  const missing = [];
  for (const v of bad) {
    for (const e of (v && v.errors) || []) {
      const msg = I18N.normalize(e.message || '');
      if (needsTranslation(msg) && !I18N.covered(msg)) missing.push(msg);
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'validation messages with no English entry');
});
