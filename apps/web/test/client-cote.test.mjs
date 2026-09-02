/**
 * The déontologie boundary on CLIENT views (art. 70, C. déont. notaires).
 *
 * « Le notaire ne peut, dans sa publicité, utiliser OU PERMETTRE QUE SOIT
 * UTILISÉ un témoignage d’appui ou de reconnaissance qui le concerne »
 * (N-3, r. 2, art. 70) — no exception for authentic reviews. A notary listed
 * on a platform that publishes evaluations about them is permitting their use;
 * and a displayed score turns a directory into a recommendation (the NYSBA
 * 1132 reasoning against Avvo). See docs/go-to-market/veille-notation-
 * plateformes.md §6.6 and §8.
 *
 * So every client-facing surface may state FACTS about a named notary — roll
 * of the Chambre, acts carried on Nota — and NOTHING evaluative: no stars, no
 * average, no review count, no cote.
 *
 * This suite was written the other way round (it once REQUIRED the cote on the
 * client side). The requirements are kept and inverted: what was demanded is
 * now forbidden, so the history of the rule stays readable.
 *
 * The notary’s OWN console is out of scope on purpose: their cote, axes,
 * per-service record and the comments clients left them are their own file,
 * not publicity. notary-cote.test.mjs guards that they survive intact.
 *
 * It also guards the public wording of the split: the amount offered is an
 * all-in total, Nota keeps AT MOST 15 %, the notary keeps 85 % to 95 %.
 *
 * Boot harness mirrors client-offers.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const I18N_SRC = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');

// i18n.js is UMD; apps/web is "type":"module" — evaluate it as a plain script.
const I18N = (() => {
  const mod = { exports: {} };
  new Function('module', 'exports', I18N_SRC)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

async function boot({ seed = {}, routes = [] } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {} };
        const r = routes.find((x) => x.match(call.url, call.init));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, seed[k]));
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, dom };
}

const DATE = addDays(todayISO(), 6);
const OFFER = { id: 'o1', dateISO: DATE, serviceId: 'financement', montant: 1000, clientToken: 'tok-o1' };
const statusRoute = (body) => ({ match: (u) => u.includes('/client/bid?'), reply: () => jsonRes(200, body) });

// ---------------------------------------------------------------------------
// 1. The proposition carries the cote — the number Nota itself prices on.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 1. Client views state facts about a notary — never an appreciation of one.
// ---------------------------------------------------------------------------

// Every evaluative shape art. 70 forbids on a client surface. Kept as one
// list so the two scans below (proposition, retained block) cannot drift.
const APPRECIATION = [
  { re: /★|☆/, why: 'a star' },
  { re: /\bcotes?\b/i, why: 'the word « cote »' },
  { re: /\bavis\b/i, why: 'a review count' },
  { re: /\bnotes?\b/i, why: 'a rating' },
  { re: /\bétoiles?\b/i, why: 'the word « étoile »' },
  { re: /\/\s?100|sur 100/, why: 'a score out of 100' },
  { re: /\b[0-5],[0-9]\b/, why: 'a decimal average' },
  { re: /\bscore\b/i, why: 'a score' },
  { re: /recommand|meilleur|excellent|réputé|expérimenté/i, why: 'a compliment' },
  // Art. 68 (renseignement faux ou trompeur): Nota verifies NOTHING about a
  // fiche beyond the shape of its URL, so no client surface may imply it did.
  { re: /vérifié par Nota|validé par Nota|certifié|agréé|garanti|de confiance|fiable/i, why: 'a claim of verification Nota never performed' },
];
const SELECTORS = ['.rating-badge', '.cote-badge', '.nc-eval-stars', '.my-offer-cote-help', '.eval-star'];

// The scan itself: a named notary’s block must survive all of it.
function assertNoAppreciation(node, label) {
  const txt = node.textContent;
  for (const { re, why } of APPRECIATION) {
    assert.ok(!re.test(txt), label + ' publishes ' + why + ' about a named notary (art. 70): ' + txt);
  }
  for (const sel of SELECTORS) {
    assert.equal(node.querySelector(sel), null, label + ' still renders ' + sel + ' (art. 70)');
  }
  // Attributes carry copy too — a tooltip is publication just the same.
  for (const el of node.querySelectorAll('[title], [aria-label]')) {
    const attrs = (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '');
    for (const { re, why } of APPRECIATION) {
      assert.ok(!re.test(attrs), label + ' hides ' + why + ' in an attribute (art. 70): ' + attrs);
    }
  }
}

test('a proposition states the facts — Chambre membership and acts carried — and nothing evaluative', async () => {
  const { doc, Nota, dom } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [statusRoute({
      bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 1000, status: 'ouverte', etude: null },
      propositions: [{ id: 'p1', etude: 'Étude Tremblay', montant: 1200, delta: 200, status: 'en_attente', createdAt: todayISO(), cnq: true, actes: 37 }],
      demandes: [], readiness: { total: 6, done: 2, missing: [], consent: false, ready: false },
    })],
  });
  Nota.setTab('profil');
  await wait(60);

  const block = doc.querySelector('.my-offer-prop');
  assert.ok(block, 'the proposition renders');
  // The facts the API serves, both on screen.
  assert.ok(block.querySelector('.cnq-badge'), 'membership of the Chambre is a fact, and it stays');
  const acts = block.querySelector('.my-offer-acts');
  assert.ok(acts, 'the acts carried on Nota are a fact, and they show');
  assert.equal(acts.textContent, '37 actes signés via Nota', 'phrased as a count, never as a compliment');
  // …and not one gram of appreciation.
  assertNoAppreciation(block, 'the proposition');
  dom.window.close();
});

test('the retained notary block states the same facts, and a notary with no acts gets no empty badge', async () => {
  const { doc, Nota, dom } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [statusRoute({
      bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 1000, status: 'retenue', etude: 'Étude Roy' },
      notaire: { etude: 'Étude Roy', courriel: 'roy@etude.ca', cnq: true, actes: 12, lienCNQ: 'https://www.cnq.org/trouver-un-notaire/fiche/42/' },
      // A notary who has carried nothing yet: the fact is absent, never a « 0 ».
      propositions: [{ id: 'p2', etude: 'Étude Neuve', montant: 1100, delta: 100, status: 'refusee', createdAt: todayISO(), cnq: false, actes: 0 }],
      demandes: [], readiness: { total: 6, done: 6, missing: [], consent: true, ready: true },
      messages: [], acte: { complete: false }, evaluation: null,
    })],
  });
  Nota.setTab('profil');
  await wait(60);

  const contact = doc.querySelector('.my-offer-contact');
  assert.ok(contact, 'the retained block renders');
  assert.match(contact.textContent, /Étude Roy/, 'the notary is named — that is the mise en relation');
  assert.equal(contact.querySelector('.my-offer-acts').textContent, '12 actes signés via Nota');
  assert.ok(contact.querySelector('.cnq-badge'), 'membership shows');
  assert.ok(contact.querySelector('.cnq-link'), 'and the official fiche stays reachable — verification, not praise');
  assertNoAppreciation(contact, 'the retained notary block');

  // Zero acts: the fact is simply absent. No empty pill, no « 0 acte » that
  // would read as a demerit — a demerit is an appreciation by the back door.
  const prop = doc.querySelector('.my-offer-prop');
  assert.equal(prop.querySelector('.my-offer-acts'), null, 'no acts fact at zero');
  assert.ok(!/0 acte/.test(prop.textContent), 'and no « 0 acte » anywhere: ' + prop.textContent);
  assertNoAppreciation(prop, 'a proposition from a notary with no acts');
  dom.window.close();
});

// The notary’s own console is NOT publicity: their cote, axes and the
// comments clients left them are their own file, and the API still serves
// them. This test states that boundary so the sweep above is never widened
// into the console by someone reading only half the rule.
test('the boundary is client-side only — the notary console keeps its own cote', async () => {
  const app = APP_SRC;
  assert.match(app, /function ncRenderCote/, 'the console still publishes the notary their own cote');
  assert.match(app, /nc-cote-axe/, 'and their four axes');
  assert.match(app, /function ratingSpan/, 'the rating badge survives — for the console');
  // …but no client renderer may call it any more.
  const clientBand = app.slice(app.indexOf('function fillMyOfferDetail'), app.indexOf('function evaluationBlock'));
  assert.ok(!/ratingSpan\(/.test(clientBand), 'fillMyOfferDetail must not render a rating');
  assert.ok(!/coteBadge/.test(clientBand), 'nor a cote badge');
  assert.ok(!/\.cote\b/.test(clientBand), 'nor read a cote off the payload');
});

// ---------------------------------------------------------------------------
// 1b. The CNQ signal says what it IS: a declaration, not a Nota verification.
//
// Removing the reviews and the cote (ADR 0030) left the fiche as one of only
// two signals a client sees — and nobody checks it. `validateNotaryProfile`
// only checks that the URL is https on the cnq.org host: Nota never confirms
// the fiche exists, belongs to that notary, or that they are in good standing.
// Art. 68 forbids a « renseignement faux ou trompeur »; a « ✓ » that reads as
// « vérifié par Nota » is exactly that. So the badge must name the declarer,
// and the client must be told where they can check for themselves.
// ---------------------------------------------------------------------------
test('the CNQ badge names a DECLARATION, never a verification by Nota', async () => {
  const { doc, Nota, dom } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [statusRoute({
      bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 1000, status: 'ouverte', etude: null },
      propositions: [{ id: 'p1', etude: 'Étude Tremblay', montant: 1200, delta: 200, status: 'en_attente', createdAt: todayISO(), cnq: true, actes: 37 }],
      demandes: [], readiness: { total: 6, done: 2, missing: [], consent: false, ready: false },
    })],
  });
  Nota.setTab('profil');
  await wait(60);

  const badge = doc.querySelector('.cnq-badge');
  assert.ok(badge, 'the fiche is still a fact worth showing');
  assert.match(badge.textContent, /déclarée/i, 'the label says it is declared: ' + badge.textContent);
  // A bare check mark reads as « Nota checked this ». It must be gone.
  assert.ok(!badge.textContent.includes('✓'), 'no check mark: ' + badge.textContent);
  // The full nuance rides the accessible name and the tooltip.
  for (const attr of ['title', 'aria-label']) {
    const v = badge.getAttribute(attr) || '';
    assert.match(v, /déclarée par le notaire/i, attr + ' names the declarer: ' + v);
    assert.match(v, /Nota ne vérifie pas/i, attr + ' disclaims the verification: ' + v);
  }
  dom.window.close();
});

// Two lengths, ONE warning. The dense proposition row and the roomy retained
// line carry different labels on purpose — frozen here so nobody reunifies
// them « for consistency » and loses either the brevity or the context. What
// must NEVER differ is the disclaimer: a shorter badge may not mean a shorter
// warning (art. 68).
test('the badge is short on a proposition, full on the retained line — and the disclaimer is identical', async () => {
  const { doc, Nota, dom } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [statusRoute({
      bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 1000, status: 'retenue', etude: 'Étude Roy' },
      notaire: { etude: 'Étude Roy', courriel: 'roy@etude.ca', cnq: true, actes: 12, lienCNQ: null },
      propositions: [{ id: 'p1', etude: 'Étude Tremblay', montant: 1200, delta: 200, status: 'en_attente', createdAt: todayISO(), cnq: true, actes: 37 }],
      demandes: [], readiness: { total: 6, done: 6, missing: [], consent: true, ready: true },
      messages: [], acte: { complete: false }, evaluation: null,
    })],
  });
  Nota.setTab('profil');
  await wait(60);

  const short = doc.querySelector('.my-offer-prop .cnq-badge');
  const full = doc.querySelector('.my-offer-contact .cnq-badge');
  assert.ok(short && full, 'both surfaces carry the badge');
  assert.equal(short.textContent, 'Fiche déclarée', 'the dense proposition row keeps the short label');
  assert.equal(full.textContent, 'Fiche déclarée à la Chambre', 'the retained line has room for the full one');
  assert.notEqual(short.textContent, full.textContent, 'the two lengths are deliberate, not a duplication to collapse');

  // The shortcut shortens the LABEL and nothing else.
  for (const attr of ['title', 'aria-label']) {
    assert.equal(short.getAttribute(attr), full.getAttribute(attr),
      'the ' + attr + ' must be word-for-word identical on both — a shorter badge is not a shorter warning');
    assert.match(short.getAttribute(attr) || '', /Nota ne vérifie pas cette déclaration/,
      'and it still carries the disclaimer in full');
  }
  assertNoAppreciation(doc.querySelector('.my-offer-prop'), 'the short-badge proposition');
  assertNoAppreciation(doc.querySelector('.my-offer-contact'), 'the full-badge retained line');
  dom.window.close();
});

test('every client band points at the Chambre’s own directory — the address comes from the domain', async () => {
  const { doc, Nota, D, dom } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [statusRoute({
      bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 1000, status: 'ouverte', etude: null },
      propositions: [{ id: 'p1', etude: 'Étude Tremblay', montant: 1200, delta: 200, status: 'en_attente', createdAt: todayISO(), cnq: true, actes: 37 }],
      demandes: [], readiness: { total: 6, done: 2, missing: [], consent: false, ready: false },
    })],
  });
  Nota.setTab('profil');
  await wait(60);

  const links = Array.from(doc.querySelectorAll('.my-offer-cnq-annuaire'));
  assert.equal(links.length, 1, 'said once per band, not once per proposition');
  assert.equal(links[0].getAttribute('href'), D.CNQ.annuaire, 'the address IS the domain’s — never hardcoded here');
  assert.equal(links[0].getAttribute('target'), '_blank');
  assert.equal(links[0].getAttribute('rel'), 'noopener');
  assert.match(links[0].textContent, /[Vv]érifier/, 'it reads as the means of checking: ' + links[0].textContent);
  assert.match(links[0].textContent, /annuaire/i, links[0].textContent);
  // The source must not carry the URL as a literal.
  assert.ok(!/cnq\.org\/trouver-un-notaire/.test(APP_SRC), 'the directory URL is hardcoded in app.js');
  dom.window.close();
});

test('once retained, the fiche link is presented as the way to verify — not as decoration', async () => {
  const FICHE = 'https://www.cnq.org/trouver-un-notaire/fiche/42/';
  const { doc, Nota, dom } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [statusRoute({
      bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 1000, status: 'retenue', etude: 'Étude Roy' },
      notaire: { etude: 'Étude Roy', courriel: 'roy@etude.ca', cnq: true, actes: 12, lienCNQ: FICHE },
      propositions: [], demandes: [], readiness: { total: 6, done: 6, missing: [], consent: true, ready: true },
      messages: [], acte: { complete: false }, evaluation: null,
    })],
  });
  Nota.setTab('profil');
  await wait(60);

  const link = doc.querySelector('a.cnq-link');
  assert.ok(link, 'the retained block still carries the fiche');
  assert.equal(link.getAttribute('href'), FICHE);
  assert.match(link.textContent, /[Vv]érifier/, 'the label is an invitation to check: ' + link.textContent);
  assert.match(link.getAttribute('title') || '', /Chambre/, 'and says where it leads');
  assertNoAppreciation(doc.querySelector('.my-offer-contact'), 'the retained notary block');
  dom.window.close();
});

// ---------------------------------------------------------------------------
// 2. The public wording of the split — the NEW economy, everywhere.
// ---------------------------------------------------------------------------
const PUBLIC_SOURCES = {
  'index.html': HTML_SRC,
  'app.js': APP_SRC,
  'i18n.js': I18N_SRC,
};

test('no public surface still promises the retired 75/25 split', () => {
  for (const [name, src] of Object.entries(PUBLIC_SOURCES)) {
    // « 75 % » / « 25 % » as a SHARE — narrow no-break space, no-break
    // space or a plain one. The CSS keyframes and max-widths live in styles.css.
    const flat = src.replace(/[\u202f\u00a0]/g, ' ');
    assert.ok(!/\b75 ?%/.test(flat), name + ' still promises the retired 75 % share');
    assert.ok(!/\b25 ?%/.test(flat), name + ' still promises the retired 25 % share');
  }
});

test('ART. 32 — aucune surface publique ne décrit plus un partage d’honoraires', () => {
  // L'ADR 0031 a retiré le partage : le notaire garde 100 % de ses honoraires
  // et Nota facture son propre service au client. Toute phrase qui décrit
  // encore une part retenue sur les honoraires décrit l'opération que
  // l'art. 32 du Code de déontologie interdit au notaire — et l'art. 32.1 2°
  // de la Loi sur le notariat frappe l'intermédiaire qui l'obtient. Une telle
  // phrase, publiée par Nota, est une pièce écrite contre elle-même.
  for (const [name, src] of Object.entries(PUBLIC_SOURCES)) {
    const flat = src.replace(/[\u202f\u00a0]/g, ' ');
    assert.ok(!/au plus 15 %/.test(flat), name + ' promet encore un plafond de 15 %');
    assert.ok(!/de 85 % à 95 %/.test(flat), name + ' promet encore une part de 85 à 95 %');
    assert.ok(!/se partage à la signature/.test(flat), name + ' décrit encore un partage');
    assert.ok(!/selon sa cote sur 100/.test(flat), name + ' indexe encore de l’argent sur la cote');
  }
});

test('ART. 68 — les surfaces publiques annoncent les DEUX lignes', () => {
  const flat = HTML_SRC.replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ');
  assert.match(flat, /honoraires du notaire/i, 'la première ligne est nommée');
  assert.match(flat, /prix du service de Nota/i, 'la seconde aussi');
  assert.match(flat, /qui lui revient en entier|vous reviennent en entier|lui revient en entier/,
    'et il est dit que le notaire garde tout');
  // ART. 71 3° — les taxes et débours ne sont pas compris, et il faut le dire.
  assert.match(flat, /ne sont pas compris/, 'les taxes et débours sont déclarés exclus');
  assert.match(flat, /RDPRM/, 'les débours sont nommés');
  // ART. 68 — le « tout compris » est faux depuis que le prix de Nota s'ajoute.
  assert.ok(!/tout compris ?: ?rien ne s’y ajoute/.test(flat),
    'plus aucune promesse de « tout compris »');
});

test('les nouvelles phrases publiques sont traduites', () => {
  I18N.force('en');
  // Les blocs <script> (JSON-LD) ne sont pas de la copie traduite : le
  // balisage structuré porte sa propre paire FR/EN de questions.
  const flat = HTML_SRC.replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/[\u202f\u00a0]/g, ' ');
  const sentences = [...flat.matchAll(/>([^<>]*(?:honoraires du notaire|prix du service de Nota)[^<>]*)</g)]
    .map((m) => I18N.normalize(m[1]))
    .filter(Boolean);
  assert.ok(sentences.length >= 1, 'les deux lignes sont énoncées quelque part');
  // Une phrase coupée par du balisage inline est traduite d'un bloc, par
  // l'entrée innerHTML : ses fragments sont donc couverts sans figurer seuls
  // au dictionnaire. Même règle que le garde-fou de i18n.test.mjs.
  const excuses = new Set();
  for (const cle of Object.keys(I18N.dictionaries().html)) {
    for (const frag of cle.replace(/<[^>]+>/g, '\u0000').split('\u0000')) {
      const n = I18N.normalize(frag);
      if (n) excuses.add(n);
    }
  }
  for (const s of sentences) {
    if (excuses.has(s)) continue;
    assert.ok(I18N.covered(s), 'aucune entrée anglaise pour : ' + s);
    const en = I18N.tEn(s);
    assert.ok(!/notaire|honoraires|partage/.test(en), 'résidu français dans : ' + en);
  }
});

// ADR 0029 — the debt vocabulary must survive translation, and must not grow
// a recovery mechanism on the way (English copy is copy too).
test('the off-platform debt reads in English, and still promises nothing', () => {
  I18N.force('en');
  const D = require('../../../packages/domain/index.js');
  const marker = I18N.tEn('Réglé hors plateforme — ' + D.money(180) + ' de service Nota à percevoir');
  assert.match(marker, /^Settled off the platform/, marker);
  assert.match(marker, /still owed/, marker);
  assert.match(marker, /\$180/, 'the amount is money-converted: ' + marker);

  assert.equal(I18N.tEn('Service Nota à percevoir'), 'Nota service still owed');
  const note = I18N.tEn('Sur cet acte, le client vous a payé directement à la signature : Nota n’a rien encaissé, et le prix de son service reste à percevoir.');
  assert.match(note, /paid you directly at signing/, note);
  assert.match(note, /collected nothing/, note);
  assert.match(note, /still owed/, note);
  for (const invented of ['invoice', 'bill you', 'due date', 'deadline', 'debit', 'reminder', 'within', 'deducted']) {
    assert.ok(!note.toLowerCase().includes(invented), 'invents a recovery mechanism (« ' + invented + ' »): ' + note);
  }
  assert.ok(I18N.covered('Sur ces actes, le client vous a payé directement à la signature : Nota n’a rien encaissé, et le prix de son service reste à percevoir.'), 'the plural form is covered too');
});

// ADR 0028 (révision du 2026-09-01) — the axis vocabulary changed with the
// domain: no acceptance rate, no catalogue breadth. Every fragment the console
// can compose must have an English side, and the retired framings must be gone.
test('the disponibilité and services fragments read in English', () => {
  I18N.force('en');
  const D = require('../../../packages/domain/index.js');
  // Drive the check off the DOMAIN, exactly like the console does.
  const cases = [
    { stats: {}, },
    { stats: { actes: { total: 40, parService: { refinancement: 40 } }, disponibilite: { repondu: 14, declinees: 3, rayonKm: 50, urgences: true } } },
    { stats: { disponibilite: { repondu: 1, declinees: 0, rayonKm: 25 } } },
  ];
  for (const { stats } of cases) {
    for (const a of D.notaryScore(stats).axes) {
      for (const [k, v] of Object.entries(a.detail)) {
        if (typeof v === 'number' && !Number.isFinite(v)) assert.fail(a.id + '.' + k + ' is not finite');
      }
    }
  }
  assert.equal(I18N.tEn('17 réponses données sur 20 visées'), '17 answers given out of 20 aimed for');
  assert.equal(I18N.tEn('1 réponse donnée sur 20 visées'), '1 answer given out of 20 aimed for');
  assert.match(I18N.tEn('Aucune réponse donnée sur 20 visées'), /^No answer given yet/);
  assert.equal(I18N.tEn('14 propositions ou acceptations'), '14 proposals or acceptances');
  assert.equal(I18N.tEn('1 proposition ou acceptation'), '1 proposal or acceptance');
  assert.equal(I18N.tEn('3 déclins'), '3 declines');
  assert.equal(I18N.tEn('1 déclin'), '1 decline');
  assert.equal(I18N.tEn('1 service rendu sur 2'), '1 of 2 services delivered');
  assert.equal(I18N.tEn('Activité aujourd’hui'), 'Active today');
  assert.equal(I18N.tEn('Membre depuis aujourd’hui'), 'Member since today');

  // The rule the notary must read at a glance survives translation whole.
  const declin = I18N.tEn('Décliner compte comme une réponse ; seul le silence coûte des points.');
  assert.match(declin, /Declining counts as an answer/, declin);
  assert.match(declin, /only silence costs/, declin);
  const spec = I18N.tEn('Se spécialiser ne coûte rien : l’éventail n’entre pas dans la cote.');
  assert.match(spec, /Specializing costs nothing/, spec);

  // The retired framings must not survive anywhere in the dictionary.
  const src = I18N_SRC.replace(/[\u202f\u00a0]/g, ' ');
  assert.ok(!/Taux de réponse/.test(src), 'the acceptance-rate line is retired');
  assert.ok(!/[Rr]esponse rate/.test(src), 'and so is its English side');
});

test('the composed console strings read in English — and the retired client ones are gone', () => {
  I18N.force('en');
  // The fact that replaced the cote on client surfaces.
  assert.equal(I18N.tEn('37 actes signés via Nota'), '37 acts signed through Nota');
  assert.equal(I18N.tEn('1 acte signé via Nota'), '1 act signed through Nota');
  // Dead entries must be REMOVED, not left dormant: the badge label and the
  // client-side explanation of the cote no longer exist (art. 70).
  assert.equal(I18N.tEn('Cote 84'), 'Cote 84', 'the client badge label is out of the dictionary');
  assert.ok(!I18N.covered('La cote sur 100 résume la satisfaction des clients, les services rendus, la disponibilité et la présence du notaire sur Nota.'),
    'the client-side cote explanation is out of the dictionary');
  // The console keeps its own: the big figure’s accessible label.
  assert.equal(I18N.tEn('Cote 84 sur 100'), 'Score 84 out of 100');

  // Art. 68 — the declaration vocabulary, and the retired « member » claim.
  assert.equal(I18N.tEn('Fiche déclarée'), 'Listing declared', 'the short badge label is translated');
  assert.equal(I18N.tEn('Fiche déclarée à la Chambre'), 'Listing declared to the Chambre', 'and so is the full one');
  const dis = I18N.tEn('Fiche déclarée par le notaire dans l’annuaire de la Chambre des notaires du Québec. Nota ne vérifie pas cette déclaration.');
  assert.match(dis, /declared by the notary/, dis);
  assert.match(dis, /Nota does not verify/, dis);
  assert.match(I18N.tEn('Vérifier un notaire dans l’annuaire de la Chambre des notaires du Québec ↗'), /directory ↗$/);
  assert.match(I18N.tEn('Vérifier sa fiche à la Chambre ↗'), /^Check their listing/);
  // « Membre de la Chambre » asserted a membership Nota never checked.
  assert.ok(!I18N.covered('Membre de la Chambre des notaires du Québec'), 'the unverified membership claim is out of the dictionary');
  assert.ok(!I18N.covered('Fiche Chambre des notaires ↗'), 'the decorative fiche label is out of the dictionary');
  // ADR 0031 — le barème a disparu de la console : la cote ne décide plus d'un
  // dollar (art. 29.1). Les règles qui traduisaient « vous gardez X % » ne
  // doivent pas rester en dormance — une entrée de dictionnaire est une copie
  // prête à revenir.
  // Le dictionnaire lui-même ne doit plus contenir une seule règle qui parle
  // d'une part gardée : `covered()` ne suffirait pas à le prouver (la règle de
  // format monétaire touche toute chaîne portant un « % »), donc on regarde
  // les motifs.
  const src = PUBLIC_SOURCES['i18n.js'];
  assert.ok(src, 'la source du dictionnaire est lisible');
  // « Vous gardez la main » reste légitime : ce qui doit disparaître, c'est
  // « vous gardez X % », la part d'honoraires.
  assert.ok(!/vous gardez [^.\n]*%/i.test(src), 'aucune entrée ne parle encore d’une part gardée');
  assert.ok(!/frais Nota/i.test(src), 'ni de « frais Nota » comme pourcentage');
  assert.ok(!/Commission Nota/i.test(src), 'ni d’une commission');

  assert.ok(!/Le barème/.test(src), 'ni du barème');
  assert.equal(I18N.tEn('pas encore d’avis'), 'no reviews yet');
  assert.equal(I18N.tEn('25 actes'), '25 acts');
});
