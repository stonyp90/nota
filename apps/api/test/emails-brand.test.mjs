import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const emails = require('../src/emails.js');
const domain = require('@nota/domain');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_TOKENS = path.join(HERE, '..', '..', 'web', 'public', 'styles.css');

const BASE = 'https://nota.example';
const NB = ' '; // fr-CA no-break space in money()
const TODAY = '2026-08-12';

// A single context that exercises every template's variables at once — the
// generic suites below render the whole registry with it.
const CTX = {
  serviceId: 'refinancement',
  dateISO: '2026-08-19',
  montant: 1500,
  tier: 'prioritaire',
  days: 7,
  bids: [{ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2400, tier: 'rapide' }],
  n: 2,
  notaryEmail: 'notaire@example.ca',
  email: 'client@example.ca',
  note: 4,
  commentaire: 'Merci.',
  code: 'EVEROY',
  etude: 'Étude Tremblay',
  notaire: { nom: 'Me Jeanne Tremblay', etude: 'Étude Tremblay', telephone: '418 555-0199', adresse: '12, rue Saint-Jean, Québec', courriel: 'jeanne@etude.ca', lienCNQ: 'https://www.cnq.org/fiche/jt' },
  bareme: [{ maxJours: 3, taux: 0.3, frais: 450 }, { maxJours: 14, taux: 0.1, frais: 150 }],
  annulation: { taux: 0.3, frais: 450, joursAvant: 2, dedommagement: { notaire: true, verse: true, transferId: 'tr_1' } },
  client: { nom: 'Marie Roy', courriel: 'marie@exemple.ca', telephone: '(418) 555-0100', secteur: 'G1R', deplacement: 'notaire_25', preteur: 'desjardins' },
  dossier: { ready: false, missing: ['Pièce d’identité'], requis: [] },
  proposition: { montant: 1600, delta: 100, message: 'Bonjour', etude: 'Étude Tremblay' },
  demande: { documents: [{ id: 'releve', nom: 'Relevé hypothécaire' }], message: 'Merci', etude: 'Étude Tremblay' },
  message: 'Bonjour, à mardi.',
  document: 'quittance.pdf',
  texte: 'Réponse',
  sujet: 'Question',
  nom: 'Marie',
  secteur: 'G1R',
  distanceKm: 6,
  link: BASE + '/#auth?token=t0k3n',
  bidId: 'b1',
  baseUrl: BASE,
  unsubscribeUrl: BASE + '/api/unsubscribe?token=abc123',
};
// The bare minimum a caller can hand a template (a campaign, an admin
// preview): every template must still render without a leak.
const MINIMAL = { baseUrl: BASE, unsubscribeUrl: BASE + '/api/unsubscribe?token=abc123' };

const names = Object.keys(emails.TEMPLATES);
const META = emails.TEMPLATE_META;
const byAudience = (a) => names.filter((n) => META[n] && META[n].audience === a);

// The text a human reads: the HTML without its tags, plus the alternative
// and the subject. Attribute values (an href, a width) are not copy.
function visible(out) {
  return out.html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ') + ' ' + out.text + ' ' + out.subject;
}
// The two CTA anchors of a message (the bulletproof buttons): [{ href, label }].
function ctas(html) {
  return [...html.matchAll(/<a href="([^"]*)" target="_blank"[^>]*>([^<]*)<\/a>/g)].map((m) => ({ href: m[1], label: m[2] }));
}
// The hidden inbox-preview line, split back into its FR and EN halves.
function preheader(html) {
  const m = html.match(/<div style="display:none;[^"]*">(.*?)&#847;/);
  return m ? m[1].split(' · ') : null;
}

// --- the palette IS the web's light theme --------------------------------------
// Inline styles are mandatory in email, so emails.js keeps ONE flattened copy
// of the web tokens (apps/web/public/styles.css). This reads the :root block
// and holds the copy to it — a colour changed on the site changes here or
// fails CI, never drifts.
function webTokens() {
  const css = readFileSync(WEB_TOKENS, 'utf8');
  const start = css.indexOf(':root {');
  const end = css.indexOf('\n}', start);
  const block = css.slice(start, end);
  const raw = {};
  for (const [, k, v] of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) raw[k] = v.trim();
  const resolve = (v) => {
    const m = v && v.match(/^var\((--[a-z0-9-]+)\)$/);
    return m ? resolve(raw[m[1]]) : v;
  };
  const out = {};
  for (const k of Object.keys(raw)) out[k] = resolve(raw[k]);
  return out;
}
const WEB = webTokens();
const BRAND = WEB['--brand'];

test('the email palette mirrors the web light-theme tokens, key by key', () => {
  const P = emails.PALETTE;
  assert.match(BRAND, /^#[0-9a-f]{6}$/, 'the web brand token must resolve to a hex colour');
  assert.equal(P.brand, WEB['--brand'], 'brand = --brand (hunter-700)');
  assert.equal(P.brandDark, WEB['--brand-hover'], 'brandDark = --brand-hover (hunter-800)');
  assert.equal(P.brandInk, WEB['--brand-ink'], 'brandInk = --brand-ink');
  assert.equal(P.ink, WEB['--ink'], 'ink = --ink');
  assert.equal(P.muted, WEB['--ink-muted'], 'muted = --ink-muted');
  assert.equal(P.card, WEB['--surface'], 'card = --surface');
  assert.equal(P.bg, WEB['--bg'], 'bg = --bg (the page canvas the card floats on)');
  assert.equal(P.border, WEB['--border'], 'border = --border');
  assert.equal(P.tint, WEB['--hunter-50'], 'tint = hunter-50 (the callout wash)');
  // The web radius scale (owner: « tout garder le même style carré »).
  for (const k of ['--radius', '--radius-sm', '--radius-xs', '--radius-lg']) assert.match(WEB[k], /^\d+px$/, k);
});

test('the registry is the full lifecycle set', () => {
  assert.ok(names.length >= 40, 'expected the full lifecycle set of templates, got ' + names.length);
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

// --- bilingual contract (FR first, EN second, same message) ------------------

test('every template is bilingual: FR / EN subject, both footers, text separator', () => {
  for (const name of names) {
    const out = emails.TEMPLATES[name](CTX);

    // Subject reads 'FR / EN'.
    assert.ok(out.subject.includes(' / '), `${name}: subject is not bilingual (no ' / '): ${out.subject}`);

    // Unsubscribe is labeled in both languages, HTML and text.
    assert.ok(out.html.includes('Se désabonner'), `${name}: HTML missing French unsubscribe label`);
    assert.ok(out.html.includes('Unsubscribe'), `${name}: HTML missing English unsubscribe label`);
    assert.ok(out.text.includes('Se désabonner'), `${name}: text missing French unsubscribe label`);
    assert.ok(out.text.includes('Unsubscribe'), `${name}: text missing English unsubscribe label`);

    // Plain text carries the FR block, a '----' separator, then the EN block.
    assert.ok(out.text.includes('----'), `${name}: text missing the FR/EN separator`);
  }
});

test('offerPublished carries the full French block first, then the full English block', () => {
  const out = emails.offerPublished(CTX);

  const fr = out.html.indexOf('Votre offre est publiée');
  const en = out.html.indexOf('Your offer is posted');
  assert.ok(fr !== -1, 'HTML missing the French heading');
  assert.ok(en !== -1, 'HTML missing the English heading');
  assert.ok(fr < en, 'the French block must come before the English block');

  // Amounts: domain.money() on the French side, domain.moneyEn() on the English side.
  assert.ok(out.html.includes('1' + NB + '500' + NB + '$'), 'HTML missing the fr-CA amount');
  assert.ok(out.html.includes('$1,500'), 'HTML missing the en-CA amount');

  // Service names from the domain, per language — never hardcoded.
  assert.ok(out.html.includes('Refinancement'), 'HTML missing the French service name');
  assert.ok(out.html.includes('Mortgage refinancing'), 'HTML missing the English service name');

  // Two CTA buttons (one per language) pointing at the same URL.
  const fallback = emails.offerPublished({ ...CTX, bidId: null });
  const ctaCount = (fallback.html.match(new RegExp('href="' + BASE + '/#dossier"', 'g')) || []).length;
  assert.equal(ctaCount, 2, 'expected one FR and one EN CTA on the same URL');

  // Text alternative mirrors the order: FR, separator, EN.
  const tFr = out.text.indexOf('Votre offre est publiée');
  const tSep = out.text.indexOf('----');
  const tEn = out.text.indexOf('Your offer is posted');
  assert.ok(tFr !== -1 && tSep !== -1 && tEn !== -1, 'text missing FR block, separator, or EN block');
  assert.ok(tFr < tSep && tSep < tEn, 'text order must be FR, separator, EN');
});

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

    // The "N" logo mark square is rendered in brand green — no image of any
    // kind, external or inline, and no background-image either.
    assert.ok(!/<img/i.test(html), `${name}: relies on an external <img>`);
    assert.ok(!/<svg/i.test(html), `${name}: relies on an inline <svg>`);
    assert.ok(!/url\(/i.test(html), `${name}: relies on a background image`);

    // The card is deliberately light-only; the color-scheme metas tell Apple
    // Mail (and friends) not to auto-invert it in dark mode.
    assert.ok(html.includes('name="color-scheme" content="light"'), `${name}: missing color-scheme meta`);
    assert.ok(html.includes('name="supported-color-schemes" content="light"'), `${name}: missing supported-color-schemes meta`);

    // Screen readers: the document is fr-CA; the English block switches lang.
    assert.ok(html.includes('lang="fr-CA"'), `${name}: missing fr-CA document lang`);
    assert.ok(html.includes('lang="en-CA"'), `${name}: English block missing lang="en-CA"`);
  }
});

// --- brand invariants (2026-09-03 pass) ----------------------------------------

test('every colour in a rendered message is a palette value — no stray hex literal', () => {
  const allowed = new Set(Object.values(emails.PALETTE).map((c) => c.toLowerCase()));
  for (const name of names) {
    const { html } = emails.TEMPLATES[name](CTX);
    const seen = new Set((html.match(/#[0-9a-fA-F]{6}\b/g) || []).map((c) => c.toLowerCase()));
    for (const c of seen) assert.ok(allowed.has(c), `${name}: colour ${c} is not a PALETTE token`);
    // Brand ink on the brand fill, never white on white: the button pairs
    // brandInk with a brand bgcolor, and the card sits on the page canvas.
    assert.ok(html.includes('bgcolor="' + emails.PALETTE.brand + '"'), `${name}: CTA fill is not the brand`);
    assert.ok(html.includes('background-color:' + emails.PALETTE.bg), `${name}: page canvas missing`);
  }
});

test('every radius sits on the web square scale — no pills, no circles', () => {
  const scale = new Set(['--radius', '--radius-sm', '--radius-xs', '--radius-lg'].map((k) => WEB[k]));
  for (const name of names) {
    const { html } = emails.TEMPLATES[name](CTX);
    const radii = [...html.matchAll(/border-radius:\s*([^;"]+)/g)].map((m) => m[1].trim());
    assert.ok(radii.length >= 3, `${name}: expected the card, the mark and the button to carry a radius`);
    for (const r of radii) assert.ok(scale.has(r), `${name}: border-radius ${r} is off the web scale (${[...scale].join(', ')})`);
  }
});

test('the logo header: a brand-green mark hidden from screen readers, the Nota wordmark, the bilingual tagline', () => {
  for (const name of names) {
    const { html } = emails.TEMPLATES[name](CTX);
    assert.ok(/aria-hidden="true"[^>]*>N<\/td>/.test(html), `${name}: the N mark must be aria-hidden (the wordmark carries the name)`);
    assert.ok(/>Nota<\/div>/.test(html), `${name}: the wordmark`);
    assert.ok(html.includes('La place de marché notariale · The notarial marketplace'), `${name}: the tagline`);
  }
});

test('one preheader per message: FR ≤ 110 characters, then EN, and it adds to the subject instead of repeating it', () => {
  for (const name of names) {
    const out = emails.TEMPLATES[name](CTX);
    const parts = preheader(out.html);
    assert.ok(parts, `${name}: no hidden preheader`);
    assert.equal(parts.length, 2, `${name}: preheader must read 'FR · EN' (got ${JSON.stringify(parts)})`);
    const [fr, en] = parts;
    assert.ok(fr.trim().length > 0 && en.trim().length > 0, `${name}: an empty preheader side`);
    assert.ok(fr.length <= 110, `${name}: FR preheader is ${fr.length} chars (> 110): ${fr}`);
    assert.ok(en.length <= 110, `${name}: EN preheader is ${en.length} chars (> 110): ${en}`);
    const subjectFr = out.subject.split(' / ')[0];
    assert.notEqual(fr.trim(), subjectFr.trim(), `${name}: the preheader repeats the subject`);
  }
});

test('the subject reads FR / EN, fits an inbox line (≤ 78 characters) and never shouts', () => {
  for (const name of names) {
    const { subject } = emails.TEMPLATES[name](CTX);
    const sides = subject.split(' / ');
    assert.equal(sides.length, 2, `${name}: the subject must contain exactly one ' / ': ${subject}`);
    assert.ok(sides[0].trim() && sides[1].trim(), `${name}: an empty subject side: ${subject}`);
    assert.ok(subject.length <= 78, `${name}: subject is ${subject.length} chars (> 78): ${subject}`);
    assert.ok(!/[\r\n]/.test(subject), `${name}: newline in subject`);
    assert.ok(subject !== subject.toUpperCase(), `${name}: ALL-CAPS subject`);
  }
});

// The verbs a CTA may open with — one imperative per language, and the label
// stays a button, not a sentence. Extend the list when a new verb is needed;
// never let a label start with a noun (« Dossier »), a pronoun or a greeting.
const CTA_VERBS_FR = ['Publier', 'Compléter', 'Terminer', 'Vérifier', 'Ouvrir', 'Bonifier', 'Choisir', 'Évaluer', 'Suivre', 'Republier', 'Voir', 'Répondre', 'Retourner', 'Reconnecter', 'Confirmer'];
const CTA_VERBS_EN = ['Post', 'Complete', 'Finish', 'Check', 'Open', 'Raise', 'Pick', 'Rate', 'Track', 'Repost', 'See', 'View', 'Reply', 'Return', 'Reconnect', 'Confirm'];

test('exactly one CTA per language, both on the same URL, verb-first and ≤ 40 characters — in HTML and in text', () => {
  for (const name of names) {
    const out = emails.TEMPLATES[name](CTX);
    const buttons = ctas(out.html);
    assert.equal(buttons.length, 2, `${name}: expected one FR and one EN CTA, got ${buttons.length}`);
    const [fr, en] = buttons;
    assert.equal(fr.href, en.href, `${name}: the two CTAs must point at the same URL`);
    assert.ok(/^https?:\/\//.test(fr.href), `${name}: CTA href must be absolute: ${fr.href}`);
    for (const [b, verbs, lang] of [[fr, CTA_VERBS_FR, 'FR'], [en, CTA_VERBS_EN, 'EN']]) {
      assert.ok(b.label.length <= 40, `${name}: ${lang} CTA label is ${b.label.length} chars: ${b.label}`);
      const first = b.label.split(/\s/)[0];
      assert.ok(verbs.includes(first), `${name}: ${lang} CTA « ${b.label} » must open with an imperative verb (${verbs.join(', ')})`);
      // The text alternative carries the same label and URL.
      assert.ok(out.text.includes(b.label + ' : ' + b.href.replace(/&amp;/g, '&')), `${name}: text alternative missing the ${lang} CTA`);
    }
  }
});

test('the footer names Nota, the registered address, the contact and privacy addresses from the domain, and the unsubscribe link', () => {
  assert.equal(emails.SENDER.supportEmail, domain.CONTACT.courriel, 'support address comes from domain.CONTACT');
  assert.equal(emails.SENDER.privacyEmail, domain.CONTACT.confidentialite, 'privacy address comes from domain.CONTACT');
  for (const name of names) {
    const out = emails.TEMPLATES[name](CTX);
    for (const [where, body] of [['HTML', out.html], ['text', out.text]]) {
      assert.ok(body.includes(domain.CONTACT.courriel), `${name}: ${where} footer missing the contact address`);
      assert.ok(body.includes(domain.CONTACT.confidentialite), `${name}: ${where} footer missing the privacy address`);
    }
    assert.ok(out.html.includes('mailto:' + domain.CONTACT.courriel), `${name}: contact address is a mailto`);
    assert.ok(out.html.includes('mailto:' + domain.CONTACT.confidentialite), `${name}: privacy address is a mailto`);
  }
});

test('every language block signs off « L’équipe Nota » / « The Nota team », in HTML and in text', () => {
  for (const name of names) {
    const out = emails.TEMPLATES[name](CTX);
    for (const [where, body] of [['HTML', out.html], ['text', out.text]]) {
      assert.ok(body.includes('L’équipe Nota'), `${name}: ${where} missing the French sign-off`);
      assert.ok(body.includes('The Nota team'), `${name}: ${where} missing the English sign-off`);
      assert.ok(body.indexOf('L’équipe Nota') < body.indexOf('The Nota team'), `${name}: ${where} sign-offs out of order`);
    }
  }
});

test('no placeholder, token or empty value ever leaks into a message — rich context and bare context alike', () => {
  const LEAK = /lorem|ipsum|\bTODO\b|\bFIXME\b|\bTBD\b|\{\{|\}\}|undefined|\bnull\b|\bNaN\b|\[object/i;
  for (const name of names) {
    for (const [label, ctx] of [['rich', CTX], ['bare', MINIMAL]]) {
      const out = emails.TEMPLATES[name](ctx);
      const v = visible(out);
      const hit = v.match(LEAK);
      assert.ok(!hit, `${name} (${label} ctx): leaked « ${hit && hit[0]} »`);
      // An empty offer line reads as nothing, not as « · · 0 $ ».
      assert.ok(!/(^|\s)·\s+·/.test(v), `${name} (${label} ctx): an empty offer line leaked its separators`);
    }
  }
});

test('the plain-text alternative carries every http(s) link the HTML carries', () => {
  for (const name of names) {
    const out = emails.TEMPLATES[name](CTX);
    const hrefs = new Set([...out.html.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')));
    assert.ok(hrefs.size >= 2, `${name}: expected at least the CTA and the unsubscribe link`);
    for (const h of hrefs) assert.ok(out.text.includes(h), `${name}: text alternative missing ${h}`);
    // And the heading, so a text-only client still sees what happened.
    assert.ok(out.text.trim().length > 0, `${name}: empty text body`);
    assert.ok(out.text.includes(emails.SENDER.name), `${name}: text missing sender name`);
  }
});

test('dates render through fmtDate — a raw ISO date never reaches the copy', () => {
  for (const name of names) {
    const out = emails.TEMPLATES[name](CTX);
    // Attribute values (the deep link carries d=YYYY-MM-DD) are not copy.
    const copy = out.html.replace(/<[^>]*>/g, ' ');
    assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(copy), `${name}: a raw ISO date is visible`);
  }
  // And the formatter itself is the fr-CA / en-CA long form.
  assert.equal(emails.fmtDate('2026-08-19'), 'mercredi 19 août 2026');
  assert.equal(emails.fmtDateEn('2026-08-19'), 'Wednesday, August 19, 2026');
});

test('dynamic text is escaped exactly once — a document name with & and < reads as typed', () => {
  const doc = 'Relevé & quittance <2026>.pdf';
  for (const tpl of ['documentDuNotaire', 'documentDuClient']) {
    const out = emails[tpl]({ ...CTX, document: doc });
    assert.ok(out.html.includes('Relevé &amp; quittance &lt;2026&gt;.pdf'), `${tpl}: HTML escapes once`);
    assert.ok(!out.html.includes('&amp;amp;') && !out.html.includes('&amp;lt;'), `${tpl}: HTML must not double-escape`);
    assert.ok(out.text.includes(doc), `${tpl}: the text alternative shows the raw name`);
    assert.ok(!out.text.includes('&amp;'), `${tpl}: the text alternative must not carry entities`);
  }
});

// --- copy invariants per audience ----------------------------------------------

test('client-facing copy carries no platform jargon (lead, hold, capture, payout, webhook, Stripe)', () => {
  const JARGON = /\b(lead|leads|hold|capture|captured|payout|payouts|webhook|Stripe)\b/i;
  for (const name of byAudience('client')) {
    for (const tier of ['standard', 'rapide', 'prioritaire', 'urgence', 'extreme']) {
      const v = visible(emails.TEMPLATES[name]({ ...CTX, tier }));
      const hit = v.match(JARGON);
      assert.ok(!hit, `${name} (${tier}): client copy uses the jargon « ${hit && hit[0]} »`);
    }
  }
});

test('ADR 0030 — a client never reads a rating, an average or a cote value about a named notary', () => {
  const RATING = /\b\d\s*\/\s*5\b|\/\s*100\b|\bmoyenne\b|\baverage\b|★|\bétoiles?\b|\bstars?\b/i;
  for (const name of byAudience('client')) {
    const v = visible(emails.TEMPLATES[name](CTX));
    const hit = v.match(RATING);
    assert.ok(!hit, `${name}: shows a rating value to the client « ${hit && hit[0]} »`);
  }
});

test('art. 29.1 / 32 — notary-facing mail never states a percentage of honoraires; the only % is the cancellation barème « du montant »', () => {
  for (const name of byAudience('notaire')) {
    const v = visible(emails.TEMPLATES[name](CTX));
    for (const m of v.matchAll(/\d+(?:[.,]\d+)?\s*%/g)) {
      const after = v.slice(m.index + m[0].length, m.index + m[0].length + 20);
      assert.ok(/^\s*(du montant|of the amount)/.test(after), `${name}: a percentage outside the barème formula: « ${m[0]}${after} »`);
      // The sentence around it must not tie that rate to the notary's fees.
      const sentence = v.slice(Math.max(0, v.lastIndexOf('.', m.index)), v.indexOf('.', m.index) + 1);
      assert.ok(!/honoraires|\bfees?\b/i.test(sentence), `${name}: the barème rate is tied to honoraires: « ${sentence.trim()} »`);
    }
    assert.ok(!/\b(part|share|quote-part|pourcentage|percentage) (des|de vos|of (your|the)) (honoraires|fees)/i.test(v), `${name}: describes a share of honoraires`);
  }
});

// --- TEMPLATE_META coverage: every declared placeholder is set by its sender --
// The notifier is driven through EVERY send-point with a probing override
// whose subject prints each declared {{token}}; a token that renders empty
// means TEMPLATE_META promises the admin a value the ctx never carries. The
// three auth links bypass overrides by design and are excluded.
const BYPASS = new Set(['notaryMagicLink', 'partnerClaimLink', 'adminMagicLink']);

test('every placeholder TEMPLATE_META declares is carried by the ctx of the send-point that mails it', async () => {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  repo.getEmailOverride = async (key) => {
    const meta = META[key];
    if (!meta || !meta.placeholders.length) return null;
    const probe = meta.placeholders.map((p) => p + '=[' + '{{' + p + '}}' + ']').join(';');
    return { key, actif: true, subjectFr: key + '::' + probe, subjectEn: 'probe' };
  };
  const clientLink = (bid) => BASE + '/#offre=' + bid.id + '&d=' + bid.dateISO + '&cle=jeton';
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY, clientLink, adminUrl: 'https://admin.nota.example' });

  const pricing = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'desjardins', deplacement: 'client_50' };
  const notary = { id: 'n-1', email: 'jeanne@etude.ca', status: 'active', nom: 'Me Jeanne Tremblay', etude: 'Étude Tremblay', telephone: '418 555-0199', adresse: '12, rue Saint-Jean', lienCNQ: 'https://www.cnq.org/fiche/jt', prefixe: 'G1R', rayonKm: 25, urgences: false, parrain: 'EVEROY', alertes: { pace: 'instant', urgentOnly: false } };
  const bid = { id: 'b1', serviceId: 'refinancement', dateISO: '2026-08-19', montant: 1500, tier: 'prioritaire', status: 'retenue', courriel: 'client@example.ca', nom: 'Marie Roy', telephone: '(418) 555-0100', prefixe: 'G1R', parrain: 'EVEROY', notaryId: 'n-1', etude: 'Étude Tremblay', pricing, dossier: { __consent: true, __pricing: pricing }, annulation: { taux: 0.3, frais: 450, joursAvant: 2, dedommagement: { notaire: true, verse: true, transferId: 'tr_1' } }, createdAt: TODAY };
  await repo.putNotary(notary);
  await repo.createPartner({ code: 'EVEROY', courriel: 'eve@agence.ca', type: 'courtier_hypothecaire', confirmedAt: TODAY });

  await notifier.onClientSignup('client@example.ca');
  await notifier.onOfferCreated(bid);
  await notifier.onOfferRetained(bid);
  await notifier.onPartnerRegistered({ code: 'EVEROY', type: 'courtier_hypothecaire', courriel: 'eve@agence.ca' });
  await notifier.onCounterOfferProposed(bid, { id: 'p1', montant: 1600, delta: 100, message: 'Bonjour', etude: 'Étude Tremblay' });
  await notifier.onDocumentsRequested(bid, { id: 'd1', documents: [{ id: 'releve', nom: 'Relevé' }], message: '', etude: 'Étude Tremblay' });
  await notifier.onCounterOfferAnswered(bid, { id: 'p2', status: 'acceptee', montant: 1600, notaryId: 'n-1' });
  await notifier.onCounterOfferAnswered(bid, { id: 'p3', status: 'refusee', montant: 1600, notaryId: 'n-1' });
  await notifier.onOfferCancelled(bid, { notary, wasRetained: true });
  await notifier.onActReleased(bid, { notary, etude: 'Étude Tremblay', message: 'Conflit', paidOrHeld: true });
  await notifier.onContactMessage({ id: 'c1', nom: 'Marie', courriel: 'client@example.ca', sujet: 'Question', message: 'Bonjour' });
  await notifier.onSupportMessage({ message: { id: 's1', texte: 'Allo ?' }, courriel: 'client@example.ca', replyUrl: BASE + '/#reponse=t' });
  await notifier.onSupportReply({ message: { id: 's2', texte: 'Oui.' }, courriel: 'client@example.ca' });
  for (const kind of ['j7', 'j0', 'dossier_incomplet']) await notifier.onReminderDue(bid, kind, TODAY);
  await notifier.onNotaryDigest(notary, [bid], TODAY);
  await notifier.onChatMessage(bid, { id: 'm1', de: domain.CHAT_FROM.NOTAIRE, texte: 'Bonjour' }, { notary });
  await notifier.onChatMessage(bid, { id: 'm2', de: domain.CHAT_FROM.CLIENT, texte: 'Merci' }, { notary });
  await notifier.onChatDocument(bid, { id: 'f1', de: domain.CHAT_FROM.NOTAIRE, nom: 'q.pdf', etat: 'pret' }, { notary });
  await notifier.onChatDocument(bid, { id: 'f2', de: domain.CHAT_FROM.CLIENT, nom: 'r.pdf', etat: 'pret' }, { notary });
  await notifier.onEvaluationSubmitted(bid, { note: 2, commentaire: 'Bof.' });
  await notifier.onNotaryConnected('jeanne@etude.ca', 'https://connect.stripe.com/setup/s/abc');
  await notifier.onActPaid({ notaryId: 'n-1', bid, actAmount: 1500 });
  await notifier.onAccountEvent({ id: 'e1', type: 'account.updated', data: { object: {} } }, notary);
  await notifier.onAccountEvent({ id: 'e2', type: 'account.application.deauthorized', data: { object: {} } }, notary);
  await notifier.onAccountEvent({ id: 'e3', type: 'checkout.session.completed', data: { object: {} } }, null, bid);
  await notifier.onAccountEvent({ id: 'e4', type: 'checkout.session.expired', data: { object: {} } }, null, bid);
  await notifier.onNotarySignedUp({ email: 'nouveau@etude.ca', lienCNQ: 'https://www.cnq.org/fiche/x' });
  await notifier.sendCampaign({ to: 'jeanne@etude.ca', templateKey: 'notaryApproved', ctx: { email: 'jeanne@etude.ca', consoleUrl: BASE + '/#notaires' } });

  const seen = new Map();
  for (const m of mailer.sent) {
    const probe = m.subject.split(' / ')[0];
    const sep = probe.indexOf('::');
    if (sep < 0) continue;
    const key = probe.slice(0, sep);
    seen.set(key, (seen.get(key) || 0) + 1);
    for (const [, tok, val] of probe.slice(sep + 2).matchAll(/([a-z]+)=\[([^\]]*)\]/g)) {
      assert.ok(val.trim(), `${key}: declares {{${tok}}} but its send-point ctx leaves it empty (subject: ${m.subject})`);
    }
  }
  const expected = names.filter((n) => !BYPASS.has(n) && META[n].placeholders.length);
  const missing = expected.filter((n) => !seen.has(n));
  assert.deepEqual(missing, [], 'send-points not driven by this probe (add them above): ' + missing.join(', '));
});

// The API resolves @nota/domain through apps/api/node_modules/@nota/domain, a
// PHYSICAL copy the deploy step refreshes (`cp packages/domain/index.js …`). A
// stale copy shadows the workspace symlink and silently serves old business
// rules to every email, ICS file and analytics label — while the whole suite
// still passes. These assertions fail loudly when that copy drifts.
test('the domain the API actually resolves is current, not a stale copy', () => {
  const workspace = require('../../../packages/domain/index.js');

  // fr-CA money uses a NO-BREAK space; a stale pre-NBSP copy has ASCII spaces.
  const amount = domain.money(1234567);
  assert.ok(!amount.includes(' '), 'money() served to the API still has ASCII spaces: ' + JSON.stringify(amount));
  assert.ok(amount.includes(NB), 'money() must separate with a no-break space');
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

// L'audit des affirmations (2026-09-01) : l'adresse postale des 41 gabarits est
// un texte de remplacement — « 000, rue à confirmer » — et le test ci-dessus ne
// vérifiait que sa PRÉSENCE. Il verrouillait donc le défaut au lieu de le
// signaler. La LCAP exige l'identification complète de l'expéditeur : une
// adresse inventée ne l'est pas.
test('la production refuse l’adresse postale de remplacement', () => {
  // En développement, le repli reste toléré — sinon toute la suite exige une
  // configuration. C'est en production qu'il devient un défaut de conformité.
  assert.equal(
    emails.SENDER.address === emails.PLACEHOLDER_ADDRESS && process.env.NODE_ENV === 'production',
    false,
    'NOTA_SENDER_ADDRESS doit porter l’adresse postale réelle de l’entreprise avant tout envoi'
  );
  // Et le repli doit rester reconnaissable, pour que ce test puisse le voir.
  assert.match(emails.PLACEHOLDER_ADDRESS, /à confirmer/);
});

test('une adresse configurée voyage bien jusque dans le courriel', async () => {
  const { createRequire: cr } = await import('node:module');
  const req = cr(import.meta.url);
  const before = process.env.NOTA_SENDER_ADDRESS;
  process.env.NOTA_SENDER_ADDRESS = 'Gestion A.Paquet inc. — 1, rue Réelle, Québec (Québec) G1R 1A1, Canada';
  try {
    // Le module lit l'environnement au chargement : on le recharge isolément.
    delete req.cache[req.resolve('../src/emails.js')];
    const fresh = req('../src/emails.js');
    assert.equal(fresh.SENDER.address, process.env.NOTA_SENDER_ADDRESS);
    const out = fresh.offerPublished({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, baseUrl: 'https://nota.example', unsubscribeUrl: 'https://nota.example/api/unsubscribe?token=x' });
    assert.ok(out.html.includes(process.env.NOTA_SENDER_ADDRESS), 'l’adresse configurée doit apparaître dans le HTML');
  } finally {
    if (before === undefined) delete process.env.NOTA_SENDER_ADDRESS;
    else process.env.NOTA_SENDER_ADDRESS = before;
    delete req.cache[req.resolve('../src/emails.js')];
  }
});
