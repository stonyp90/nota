/**
 * Claims the product makes about itself must be true in the code that ships.
 *
 * Three were audited as false or misleading and are fixed here. Each test
 * locks BOTH directions: the retired wording must not come back, and the
 * replacement must actually say the true thing.
 *
 *  1. « Vos renseignements restent sur cet appareil » — false at the very
 *     moment it is displayed: the button under it calls clientWelcome(), which
 *     POSTs the courriel to /client/welcome, and the API stores it in a SENT#
 *     record keyed on the address.
 *  2. « Elles ne quittent pas le pays » — false: infra/cloudfront.tf declares
 *     PriceClass_100 (US + Europe edge locations), index.html preconnects and
 *     loads a stylesheet from rsms.me (a third-party font host that receives
 *     the visitor's IP), and payment runs through Stripe. Data AT REST is in
 *     ca-central-1; that is the defensible half.
 *  3. « Chances d’obtenir un notaire : 95 % » — invented: domain.OBTAIN_CHANCE
 *     is a hand-written table, never measured, shown exactly where the client
 *     picks a date and a price. Not one act has been completed on the platform.
 *
 * The rule for #3: no number, and no qualitative scale either — « élevées /
 * faibles » still mimics a measurement. Only the mechanism, which is true.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const I18N_SRC = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
const OG_SVG_SRC = readFileSync(fileURLToPath(new URL('../public/og.svg', import.meta.url)), 'utf8');

const I18N = (() => {
  const mod = { exports: {} };
  new Function('module', 'exports', I18N_SRC)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const FLAT = (s) => s.replace(/[  ]/g, ' ').replace(/\s+/g, ' ');

async function boot() {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, dom };
}

// ---------------------------------------------------------------------------
// 1. The courriel DOES leave the device — say so where it happens.
// ---------------------------------------------------------------------------
const DEVICE_LIE = /renseignements restent sur cet appareil/;

test('no surface claims the client’s information stays on the device', () => {
  for (const [name, src] of Object.entries({ 'index.html': HTML_SRC, 'app.js': APP_SRC, 'i18n.js': I18N_SRC })) {
    assert.ok(!DEVICE_LIE.test(src),
      name + ' still claims « vos renseignements restent sur cet appareil » — clientWelcome() POSTs the courriel to /client/welcome');
  }
  // And the English side cannot carry it either.
  assert.ok(!/information stays on this device|stay on this device/i.test(I18N_SRC),
    'i18n.js still carries the English form of the device-only claim');
});

test('the signup fine print says the courriel is transmitted, and claims only what the code honours', async () => {
  const { doc, Nota, dom } = await boot();
  // Static default, before any role is picked.
  const staticFine = FLAT($(doc, 'auth-fine').textContent);
  // …and the client-role copy the modal swaps in.
  Nota.openAuthModal ? Nota.openAuthModal('client', 'signup') : null;
  await wait(20);
  const clientFine = FLAT($(doc, 'auth-fine').textContent);

  for (const [label, txt] of [['the static fine print', staticFine], ['the client fine print', clientFine]]) {
    assert.ok(!DEVICE_LIE.test(txt), label + ' still claims device-only: ' + txt);
    assert.match(txt, /courriel est transmis à Nota/, label + ' must say the courriel is transmitted: ' + txt);
    assert.match(txt, /lien de suivi|avis/, label + ' must say what it is used for: ' + txt);
    // Since ADR 0032 the documents DO leave the device (envoyerDocument PUTs
    // the bytes to the signed upload URL). The truthful half: they travel
    // encrypted and only the retaining notary reads them — never Nota. No
    // surface may promise that file contents, answers or the dossier stay local.
    assert.ok(!/ne quitte jamais cet appareil|ne quittent jamais cet appareil/.test(txt),
      label + ' still promises the documents stay on the device — ADR 0032 uploads them: ' + txt);
    assert.match(txt, /transitent chiffrés/, label + ' must say the documents travel encrypted: ' + txt);
    assert.match(txt, /jamais par Nota/, label + ' must say who never reads them: ' + txt);
    assert.ok(!/vos réponses.{0,30}rest|dossier.{0,30}reste sur cet appareil/.test(txt),
      label + ' over-promises: the dossier answers and filenames DO travel with an offer: ' + txt);
  }
  dom.window.close();
});

test('the fine print is honest about two real calls: clientWelcome sends the courriel, envoyerDocument sends the bytes', () => {
  // Guard the premises themselves — if either call ever stops existing, the
  // copy should be revisited rather than left stale in the other direction.
  assert.match(APP_SRC, /function clientWelcome\([\s\S]{0,400}\/client\/welcome/,
    'clientWelcome must still POST the courriel — the copy is written for that fact');
  assert.match(APP_SRC, /async function envoyerDocument\([\s\S]{0,900}body: file/,
    'envoyerDocument must still PUT the file bytes (ADR 0032) — the copy is written for that fact');
  // And the retired device-only promise about documents is gone from every source.
  for (const [name, src] of Object.entries({ 'index.html': HTML_SRC, 'app.js': APP_SRC, 'i18n.js': I18N_SRC })) {
    assert.ok(!/documents?, lui, ne quitte jamais cet appareil|never leave this device/i.test(src),
      name + ' still promises document contents never leave the device');
  }
});

// ---------------------------------------------------------------------------
// 2. Data at rest is Canadian; transit is not. Say both.
// ---------------------------------------------------------------------------
const COUNTRY_LIE = /ne quittent pas le pays|never leaves the country/i;

test('no surface promises the data never leaves the country', () => {
  for (const [name, src] of Object.entries({ 'index.html': HTML_SRC, 'i18n.js': I18N_SRC })) {
    assert.ok(!COUNTRY_LIE.test(src),
      name + ' still promises the data never leaves the country — CloudFront is PriceClass_100 (US + EU edges)');
  }
});

test('the hosting card keeps its true title and names what actually crosses the border', () => {
  const flat = FLAT(HTML_SRC);
  assert.match(flat, /<h3>Hébergé au Canada<\/h3>/, 'the title is true and stays');
  const card = flat.slice(flat.indexOf('Hébergé au Canada'), flat.indexOf('Hébergé au Canada') + 700);
  // The defensible half, kept.
  assert.match(card, /ca-central-1/, 'the region is named');
  assert.match(card, /conservées|repos/, 'and it is scoped to data at rest');
  // The half that was missing.
  assert.match(card, /réseau de diffusion|points de présence/, 'the CDN is disclosed');
  assert.match(card, /États-Unis/, 'including that its edges are in the US');
  assert.match(card, /Stripe/, 'the payment processor is named');
  assert.match(card, /rsms\.me|police/, 'and the third-party font host');
});

test('the hosting card’s English side says the same thing', () => {
  I18N.force('en');
  const dict = I18N.dictionaries();
  const key = Object.keys(dict.html).find((k) => k.includes('ca-central-1'));
  assert.ok(key, 'the hosting sentence is an HTML entry (it contains <strong>)');
  const en = dict.html[key];
  assert.ok(!COUNTRY_LIE.test(en), 'the English side still promises the country claim: ' + en);
  assert.match(en, /United States/, en);
  assert.match(en, /Stripe/, en);
});

// ---------------------------------------------------------------------------
// 3. The invented probability is gone; the mechanism stays.
// ---------------------------------------------------------------------------
test('the day dialog no longer prints a probability of getting a notary', async () => {
  const { doc, dom } = await boot();
  const iso = addDays(todayISO(), 5);
  const cell = doc.querySelector('.cal-cell[data-date="' + iso + '"]');
  assert.ok(cell, 'a bookable day is on screen');
  cell.click();
  await wait(40);

  const line = FLAT($(doc, 'day-chance').textContent);
  assert.ok(line.length > 0, 'the explainer still exists at the decision point');
  // No number, of any shape, anywhere in it.
  assert.ok(!/\d/.test(line), 'a figure survives in the chance line: ' + line);
  assert.ok(!/%/.test(line), 'a percentage survives: ' + line);
  assert.ok(!/[Cc]hances? d’obtenir/.test(line), 'the retired framing is back: ' + line);
  // And no qualitative scale, which would still mimic a measurement.
  for (const scale of ['élevée', 'faible', 'moyenne', 'bonne', 'mauvaise', 'forte', 'probab']) {
    assert.ok(!line.toLowerCase().includes(scale), 'a scale that mimics a measurement (« ' + scale + ' »): ' + line);
  }
  // What it must say instead: the mechanism, which is true and checkable.
  assert.match(line, /éloignée/, 'the mechanism names the far date: ' + line);
  assert.match(line, /rapprochée/, 'and the near one: ' + line);
  assert.match(line, /notaires/, 'and who it is about: ' + line);
  dom.window.close();
});

test('the invented percentage is gone from the sources and from the dictionary', () => {
  // A comment may narrate the removal; a STRING LITERAL may not bring it back.
  assert.ok(!/['\u2019"«]\s*Chances d\u2019obtenir un notaire/.test(APP_SRC), 'app.js still composes the chance sentence');
  assert.ok(!/Chances d\u2019obtenir un notaire/.test(I18N_SRC), 'i18n.js still carries its rule');
  assert.ok(!/Chances of getting a notary/.test(I18N_SRC), 'i18n.js still carries the English side');
  assert.ok(!/D\.obtainChance\(/.test(APP_SRC), 'app.js still CALLS domain.obtainChance for display');
});

test('the three replacements are translated', () => {
  I18N.force('en');
  const covered = (s) => assert.ok(I18N.covered(s), 'no English entry for: ' + s);
  covered('Plus la date est éloignée, plus de notaires ont la latitude de s’organiser pour la prendre ; une date rapprochée en laisse moins.');
  const en = I18N.tEn('Plus la date est éloignée, plus de notaires ont la latitude de s’organiser pour la prendre ; une date rapprochée en laisse moins.');
  assert.ok(!/\d|%/.test(en), 'the English side must not reintroduce a figure: ' + en);
});

// ---------------------------------------------------------------------------
// 4. The public site, audited 2026-09-02 — head, structured data, legal panes,
//    onboarding and dialogs. Each finding locks both directions: the retired
//    wording must not come back, and the replacement must say the true thing.
// ---------------------------------------------------------------------------
const staticDoc = () => new JSDOM(HTML_SRC).window.document;
const ldScripts = () => [...staticDoc().querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent);

test('P0-2: neither the social description nor the structured data says the client pays nothing', () => {
  const og = staticDoc().querySelector('meta[property="og:description"]').getAttribute('content');
  assert.ok(!/gratuit pour le client|gratuit pour vous/i.test(og), og);
  assert.match(og, /gratuit/i, 'publishing IS free — say that half: ' + og);
  assert.match(og, /signature/, 'and where the money happens: ' + og);
  for (const s of ldScripts()) {
    // The FAQ may ASK « Est-ce gratuit pour le client ? » — its answer must
    // not state it. Only the question is excused.
    const answers = s.replace(/Est-ce gratuit pour le client\s*\?/g, '');
    assert.ok(!/free for the client|gratuit pour le client/i.test(answers), 'structured data still says free: ' + s.slice(0, 160));
  }
});

test('P1-17 / P2-22: no price literal in the static structured data — the catalogue and the contact are emitted from the domain at boot', async () => {
  for (const s of ldScripts()) {
    assert.ok(!/"price"/.test(s), 'a static price survives: ' + s.slice(0, 200));
    assert.ok(!/\b(2000|1800)\b/.test(s), 'a literal amount survives in structured data: ' + s.slice(0, 200));
  }
  const { doc, D, dom } = await boot();
  const ld = $(doc, 'ld-catalogue');
  assert.ok(ld && ld.getAttribute('type') === 'application/ld+json', 'boot emits a JSON-LD catalogue into the head');
  assert.equal(ld.parentNode, doc.head);
  const nodes = JSON.parse(ld.textContent)['@graph'];
  const cat = nodes.find((n) => n['@type'] === 'OfferCatalog');
  assert.ok(cat, 'an OfferCatalog node');
  // (D lives in the jsdom realm — round-trip through JSON so the arrays share a prototype.)
  assert.deepEqual(
    cat.itemListElement.map((o) => [o['@type'], o.itemOffered.name, o.price, o.priceCurrency]),
    JSON.parse(JSON.stringify(D.SERVICES.map((s) => ['Offer', s.nom, String(s.prixDepart), 'CAD']))),
    'one Offer per domain service, priced from prixDepart');
  for (const o of cat.itemListElement) assert.match(o.description, /honoraires du notaire/, 'the price is the notary’s starting fee, said so');
  const org = nodes.find((n) => n['@type'] === 'Organization');
  assert.equal(org.email, D.CONTACT.courriel, 'the organisation’s email is the domain’s (P2-22)');
  assert.match(org['@id'], /#organization$/, 'merges by @id into the static Organization node');
  dom.window.close();
});

test('P1-19 / P2-22: one og:image; the static Organization carries a postal address', () => {
  const doc = staticDoc();
  assert.equal(doc.querySelectorAll('meta[property="og:image"]').length, 1, 'the SVG duplicate after the PNG confused scrapers');
  const org = ldScripts().map((s) => JSON.parse(s)).find((j) => j['@type'] === 'Organization');
  assert.equal(org.address && org.address.addressLocality, 'Québec');
  assert.equal(org.address.addressRegion, 'QC');
  assert.equal(org.address.addressCountry, 'CA');
});

test('P0-5: the onboarding’s third client step names both lines, never « rien de plus »', async () => {
  const { doc, Nota, dom } = await boot();
  Nota.onboarding.open();
  await wait(10);
  doc.querySelector('#onboarding-dialog .onb-choice[data-role="client"]').click();
  await wait(10);
  const steps = [...doc.querySelectorAll('#onb-steps li')].map((li) => FLAT(li.textContent));
  assert.equal(steps.length, 3);
  const last = steps[2];
  assert.ok(!/rien de plus/.test(last), 'the client pays TWO lines since ADR 0031: ' + last);
  assert.match(last, /honoraires/, last);
  assert.match(last, /prix fixe du service de Nota/, last);
  assert.match(last, /affichés avant tout paiement/, last);
  dom.window.close();
});

test('P0-6 / P0-7: the privacy pane states the real retention, promises no erasure the code does not do, and names custody and local storage', () => {
  const pane = FLAT(staticDoc().getElementById('pane-confidentialite').textContent);
  assert.ok(!/12 mois/.test(pane), 'the TTL is 400 days (≈ 13 months) plus 35 days of PITR, not 12 months');
  assert.ok(!/30 jours/.test(pane), 'no 30-day DSAR mechanism exists in the code');
  assert.ok(!/effacé dès que l’offre/.test(pane), 'no code erases the courriel when an offer closes');
  assert.match(pane, /13 mois/);
  assert.match(pane, /35 jours/);
  assert.match(pane, /meilleurs délais prévus par la Loi 25/);
  // ADR 0032 — custody, not readership.
  assert.match(pane, /dépositaire/, 'Nota is the custodian of exchanged documents');
  // The promise is the one the CODE keeps (review of f45a2e1): no admin route
  // reaches a document and every opening is logged — not « no employee », a
  // claim the infrastructure does not back (default KMS key, no account deny).
  assert.ok(!/Aucun employé de Nota/.test(pane), 'never promise more than the infrastructure enforces');
  assert.match(pane, /console d’administration de Nota n’y donne aucun accès/);
  assert.match(pane, /chaque ouverture est journalisée/);
  assert.match(pane, /aucune analyse/i);
  assert.match(pane, /ca-central-1/);
  // The device side: what localStorage holds.
  assert.match(pane, /[Ss]tockage local/);
  assert.match(pane, /navigateur/);
});

test('P0-10: the legal panes publish only addresses the domain defines, filled at boot', async () => {
  for (const [name, src] of Object.entries({ 'index.html': HTML_SRC, 'app.js': APP_SRC })) {
    assert.ok(!/info@nota\.ca/.test(src), name + ' publishes info@nota.ca, which exists nowhere');
    assert.ok(!/confidentialite@nota\.ca/.test(src), name + ' hardcodes the privacy address instead of reading D.CONTACT');
  }
  const { doc, D, dom } = await boot();
  for (const [id, addr] of [
    ['tos-contact', D.CONTACT.courriel], ['charte-contact', D.CONTACT.courriel],
    ['priv-contact', D.CONTACT.confidentialite], ['priv-responsable', D.CONTACT.confidentialite],
  ]) {
    const a = $(doc, id);
    assert.ok(a, id + ' exists');
    assert.equal(a.tagName, 'A');
    assert.equal(a.textContent, addr, id);
    assert.equal(a.getAttribute('href'), 'mailto:' + addr, id);
  }
  dom.window.close();
});

test('legal panes: each carries a version stamp — an unreviewed draft, dated', () => {
  const doc = staticDoc();
  for (const id of ['pane-confidentialite', 'pane-conditions', 'pane-charte']) {
    const stamp = doc.querySelector('#' + id + ' .legal-stamp');
    assert.ok(stamp, id + ' carries a stamp');
    const t = FLAT(stamp.textContent);
    assert.match(t, /^Version \d+\.\d+/, t);
    assert.match(t, /brouillon/, t);
    assert.match(t, /non révisé par un juriste/, t);
    assert.match(t, /\d{4}-\d{2}-\d{2}/, 'dated: ' + t);
  }
});

test('charte: « aucun frais caché » names the two lines and points at the cancellation barème', () => {
  const doc = staticDoc();
  const li = [...doc.querySelectorAll('#pane-charte .privacy-list li')].find((l) => /aucun frais caché/i.test(l.textContent));
  assert.ok(li, 'the transparency commitment stays');
  const t = FLAT(li.textContent);
  assert.match(t, /barème/, t);
  assert.match(t, /annulation/, t);
  // ADR 0034 — le prix de Nota n'est plus « fixe » : c'est une grille par
  // service, publiée d'avance. La charte doit dire la nouvelle vérité.
  assert.match(t, /prix du service de Nota, publié d’avance/, t);
  assert.ok(li.querySelector('a.goto-link[data-goto="conditions"]'), 'a door to the conditions where the barème lives');
  // The retired one-liner cannot return.
  assert.ok(!/aucun frais caché\. Ce que vous offrez est ce que le notaire reçoit\.$/.test(t), t);
});

test('P1-5 / P1-14: no unbacked same-day SLA, no unmeasured « retenues plus vite »', () => {
  for (const [name, src] of Object.entries({ 'index.html': HTML_SRC, 'app.js': APP_SRC, 'i18n.js': I18N_SRC })) {
    assert.ok(!/normalement le jour même|normally the same day/i.test(src), name + ' promises a same-day answer nobody measured');
    assert.ok(!/nominatives sont souvent retenues plus vite|Named offers are often taken faster/.test(src), name + ' claims an unmeasured effect of revealing one’s name');
  }
  const doc = staticDoc();
  assert.match(FLAT(doc.querySelector('#contact-dialog').textContent), /vous répond à votre courriel\./);
  assert.match(FLAT(doc.querySelector('#reveal-dialog').textContent), /information que vous rendez publique/);
});

test('P2-11: the auth dialog’s comment no longer narrates a social-login plan that is not wired', () => {
  assert.ok(!/Social OAuth is not wired yet/.test(HTML_SRC));
  assert.ok(!/social provider or a courriel/.test(HTML_SRC));
});

// 4. L'IMAGE SOCIALE. Le garde ci-dessus ne lisait que du texte, et l'image
//    partagée n'en est pas : le 2026-09-04, og.png (rendu le 12 août) annonçait
//    encore « Testament · Procuration · Refinancement — gratuit pour le
//    client » — deux services retirés depuis le virage financement, et
//    exactement la revendication que le produit a rétractée. Elle voyageait sur
//    LinkedIn, iMessage et Slack à chaque partage, alors que la source, elle,
//    était propre. C'est le cas type de l'art. 68 (publicité incomplète ou
//    trompeuse).
//
//    Deux verrous, parce qu'aucun test ne peut lire des pixels :
//    (a) le TEXTE de og.svg est soumis au même garde que le reste ;
//    (b) og.png est un RENDU de og.svg, donc toute modification du svg doit
//        s'accompagner d'un nouveau rendu. L'empreinte ci-dessous fige le svg :
//        la changer sans re-rendre le png fait échouer ce test, et le message
//        dit quoi faire.
// La même formule que celle qui garde app.js / index.html / i18n.js / llms.txt
// dans smoke.test.mjs : « publier est gratuit » reste VRAI et reste permis ;
// c'est « gratuit pour le client » qui a été rétracté.
const FREE_LIE = /Gratuit pour (vous|le client)|gratuit pour (vous|le client)|It is free for the client|free for the client\.|Free for (you|the client)|se rémunère auprès du notaire|paid by the notary/;

const OG_SVG_SHA256 = 'eb88f37309e0c8966442b417cd9f67fc2ffa5ebad8aed6ecbf9368b9b7c1c827';

test('l’image sociale ne vend pas des services retirés, ni une gratuité rétractée', () => {
  const hit = OG_SVG_SRC.match(FREE_LIE);
  assert.ok(!hit, 'og.svg reprend une revendication rétractée : « ' + (hit && hit[0]) + ' »');
  for (const retire of ['Testament', 'Procuration']) {
    assert.ok(!OG_SVG_SRC.includes(retire),
      'og.svg annonce « ' + retire +' », un service retiré depuis le virage financement');
  }
  // Et il dit bien ce que Nota vend aujourd'hui.
  assert.match(OG_SVG_SRC, /Refinancement/);
  assert.match(OG_SVG_SRC, /Financement/);
});

test('og.png a bien été re-rendu depuis le og.svg courant', async () => {
  const { createHash } = await import('node:crypto');
  const somme = createHash('sha256').update(readFileSync(fileURLToPath(new URL('../public/og.svg', import.meta.url)))).digest('hex');
  assert.equal(somme, OG_SVG_SHA256,
    'og.svg a changé : re-rends og.png depuis le svg (1200x630) puis remplace OG_SVG_SHA256 par ' + somme
    + '. Sans cela, l’image partagée continue d’annoncer l’ancien message.');
});
