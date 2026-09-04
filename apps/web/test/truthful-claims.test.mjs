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
  // ADR 0034 — le prix de Nota est une GRILLE (par service, par palier de
  // délai) : la troisième étape le nomme « publié d'avance », jamais « fixe ».
  assert.match(last, /prix du service de Nota, publié d’avance/, last);
  assert.ok(!/prix fixe/.test(last), 'le prix de Nota n’est pas fixe depuis l’ADR 0034 : ' + last);
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

// ---------------------------------------------------------------------------
// 5. COMMENT NOTA EST PAYÉE — les mots que le droit notarial lui interdit.
//
//    Audit du 2026-09-04 : la politique de confidentialité disait encore
//    « Nota se rémunère par une commission sur les actes complétés », le
//    dictionnaire portait quatre entrées et une règle bâties sur le même mot,
//    et deux phrases d'app.js — la troisième étape de l'accueil, la
//    description du catalogue JSON-LD — annonçaient « le prix FIXE du service
//    de Nota ».
//
//    Ce qui est livré, et la seule chose qu'une surface puisse dire : Nota
//    facture au CLIENT son propre service, à un prix publié par service auquel
//    s'ajoute la garantie de date ; le notaire garde 100 % de ses honoraires,
//    Nota n'en prélève rien (ADR 0031, ADR 0034, ADR 0035).
//
//    Le garde lit les CHAÎNES, jamais les commentaires : un commentaire qui
//    explique POURQUOI un mot est proscrit doit rester lisible — i18n.js en
//    porte un, et cette section aussi. Trois surfaces : les littéraux d'app.js,
//    ceux d'i18n.js (clés ET valeurs — l'anglais ne doit pas rentrer par la
//    fenêtre ce que le français a lâché par la porte) et le TEXTE rendu
//    d'index.html. llms.txt et le « prix fixe » d'index.html sont déjà gardés
//    par devis-deux-lignes.test.mjs ; la cote côté client, elle, est prouvée
//    au rendu par client-cote.test.mjs — ici on ferme le vocabulaire.
// ---------------------------------------------------------------------------

// Les chaînes d'un module, commentaires exclus. Le balayage ne modélise pas
// les littéraux d'expression régulière ; ni app.js ni i18n.js n'en contient un
// qui porte une apostrophe ou un guillemet, et « le balayage ne décroche pas »
// ci-dessous le vérifie à chaque exécution (une désynchronisation capturerait
// du code au lieu d'une phrase).
function chaines(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; let s = ''; let j = i + 1; let clos = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { s += src[j + 1]; j += 2; continue; }
        if (d === q) { clos = true; j++; break; }
        if (d === '\n' && q !== '`') break;
        s += d; j++;
      }
      if (clos) { out.push(s); i = j; continue; }
      i++; continue;
    }
    i++;
  }
  return out;
}

// Le texte qu'un lecteur (ou un robot d'indexation) reçoit d'index.html : le
// corps, les attributs visibles, les métas et les données structurées. Les
// commentaires HTML n'en font pas partie — textContent ne les rend pas.
function textesHtml() {
  const doc = staticDoc();
  const bouts = [doc.body.textContent];
  for (const m of doc.querySelectorAll('meta[content]')) bouts.push(m.getAttribute('content'));
  for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
    for (const e of doc.querySelectorAll('[' + attr + ']')) bouts.push(e.getAttribute(attr));
  }
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) bouts.push(s.textContent);
  return bouts.filter(Boolean);
}

// La phrase qui porte l'occurrence — c'est à cette échelle qu'on reconnaît une
// dénégation (« aucun partage d'honoraires ») d'une affirmation.
const phraseAutour = (s, i) => {
  const debut = Math.max(...['.', '!', '?', '\n', ';'].map((p) => s.lastIndexOf(p, i)), -1) + 1;
  const fins = ['.', '!', '?', '\n', ';'].map((p) => s.indexOf(p, i)).filter((k) => k >= 0);
  return s.slice(debut, fins.length ? Math.min(...fins) + 1 : s.length).trim();
};

const AXES = [
  {
    id: 'commission',
    dit: 'que Nota touche une COMMISSION',
    vrai: 'Nota facture son propre service au client, à un prix publié (ADR 0031, ADR 0034)',
    // Art. 32 de la Loi sur le notariat et art. 32.1 du Code de déontologie des
    // notaires (N-3, r. 2) : les honoraires d'un notaire ne se partagent pas
    // avec un non-notaire, et l'intermédiaire ne peut pas en obtenir l'abandon
    // d'une partie. Dire « commission », c'est décrire exactement l'arrangement
    // interdit — même au passé, même en anglais. Le mot n'a plus d'emploi
    // légitime dans une phrase montrée à un lecteur ; le champ `commissionCents`
    // que l'API renvoie encore reste hors de portée (un identifiant, pas une
    // phrase), d'où les bornes qui excluent lettres et traits d'union.
    motifs: [/(?<![\w-])commissions?(?![\w-])/i],
  },
  {
    id: 'partage',
    dit: 'un PARTAGE des honoraires du notaire',
    vrai: 'le notaire garde 100 % de ses honoraires ; Nota vend son service à côté (ADR 0031)',
    // Même interdiction, l'autre formulation : les 75/25 et 85/15 retirés, le
    // « montant à 85 % », la part en pourcentage des honoraires. Art. 32.1 du
    // Code de déontologie ; ADR 0031 a fermé le partage, ADR 0034 a publié la
    // grille qui l'a remplacé.
    motifs: [
      /\b(?:75\s*\/\s*25|25\s*\/\s*75|85\s*\/\s*15|15\s*\/\s*85)\b/,
      /\bpartag\w*[^.!?]{0,60}\bhonoraires\b/i,
      /\bhonoraires\b[^.!?]{0,60}\bpartag/i,
      /\b(?:15|25|75|85|95)\s*%[^.!?]{0,40}\bhonoraires\b/i,
      /\bhonoraires\b[^.!?]{0,40}\b(?:15|25|75|85|95)\s*%/i,
      /\bmont\w*\s+à\s+(?:85|95)\s*%/i,
      /\b(?:share|split)\s+of\s+(?:the\s+)?(?:notary’s\s+|notary's\s+)?fees\b/i,
      /\bfee[-\s]?sharing\b|\brevenue\s+(?:share|split)\b/i,
    ],
    // NIER le partage est précisément ce que le produit doit écrire : « aucun
    // partage d'honoraires, aucune convention sur vos honoraires » est la
    // promesse faite au notaire, et la charte cite l'interdiction elle-même.
    // Seule l'AFFIRMATION est proscrite, d'où l'exception au niveau de la phrase.
    sauf: /\b(?:aucun|aucune|sans|jamais|ni|interdit\w*|interdiction|no|never|prohibit\w*)\b/i,
  },
  {
    id: 'prix fixe',
    dit: 'que le prix de Nota est FIXE',
    vrai: 'c’est une grille : un prix par service, plus le palier de garantie de date (ADR 0034)',
    // ADR 0034 : deux axes de variation vivants (le service demandé, le délai
    // avant la signature). « Fixe » est donc faux, et l'art. 68 du Code de
    // déontologie vise la publicité incomplète ou trompeuse. La formule juste :
    // « le prix du service de Nota, publié d'avance ».
    motifs: [
      /prix\s+fixe/i,
      /montant\s+fixe/i,
      /fixed\s+(?:price|amount|service\s+price)/i,
      /flat\s+(?:price|fee|service\s+price)/i,
    ],
  },
  {
    id: '400 $',
    dit: 'le prix forfaitaire retiré de 400 $',
    vrai: 'les montants viennent du domaine (D.SERVICES, garantie de date), jamais d’un littéral',
    // ADR 0034 a retiré le prix unique de 400 $. Un montant écrit en dur dans
    // une phrase est doublement faux : il ressuscite le forfait, et il cesse de
    // suivre la grille que l'admin peut changer. (La borne devant « 400 »
    // laisse passer « 2 400 $ » écrit avec une espace insécable — la forme que
    // produit D.money — et « 400 jours », qui n'est pas un montant.)
    motifs: [/(?<![\d  ])400\s*\$/, /\$\s?400(?![\d.,])/],
  },
  {
    id: 'comparatif',
    dit: 'que Nota coûte MOINS CHER qu’un notaire',
    vrai: 'les honoraires sont ceux que le client offre et que le notaire accepte — rien à comparer',
    // Art. 32.1 1° du Code de déontologie : pas de publicité comparative sur
    // les prix de la profession. Nota ne fixe pas les honoraires du notaire ;
    // elle ne peut donc rien affirmer sur leur niveau.
    motifs: [/moins\s+ch[eè]re?s?\b/i, /\bcheaper\b/i, /\bless\s+expensive\b/i],
  },
  {
    id: 'cote publiée',
    dit: 'une cote, une moyenne ou un témoignage rattaché à un notaire NOMMÉ',
    vrai: 'des faits seulement côté client : le numéro à la Chambre, le nombre d’actes (ADR 0030)',
    // Art. 70 du Code de déontologie : le notaire ne peut utiliser NI PERMETTRE
    // QUE SOIT UTILISÉ un témoignage d'appui ou de reconnaissance qui le
    // concerne. La cote sur 100 (ADR 0028) reste interne, et la console du
    // notaire lui montre ses propres évaluations — ce sont les formulations
    // publicitaires qui sont fermées ici ; le rendu, lui, est prouvé par
    // client-cote.test.mjs.
    motifs: [
      /t[ée]moignages?\b/i,
      /\b(?:cote|note|moyenne|évaluation)\s+(?:du|de ce|de votre)\s+notaire/i,
      /notaire[^.!?]{0,30}\b(?:noté|coté|évalué|recommandé)\b/i,
      /\b(?:avis|évaluations?)\s+(?:vérifiés?|de clients?)\b/i,
      /\b\d[,.]\d\s*(?:\/|sur)\s*5\b/,
      /(?:étoiles?|stars?)[^.!?]{0,40}notaire/i,
    ],
  },
];

const SURFACES = () => ({
  'app.js': chaines(APP_SRC),
  'i18n.js': chaines(I18N_SRC),
  'index.html': textesHtml(),
});

test('le balayage ne décroche pas : ce qu’on lit sont bien des phrases, pas du code', () => {
  for (const [nom, textes] of Object.entries(SURFACES())) {
    assert.ok(textes.length > 100, nom + ' : le balayage n’a presque rien trouvé (' + textes.length + ')');
    for (const t of textes) {
      assert.ok(!/\bfunction\s*\(|\bvar\s+\w+\s*=\s*|=>\s*\{/.test(t),
        nom + ' : le balayage a capturé du code — une chaîne non fermée l’a désynchronisé : ' + JSON.stringify(t.slice(0, 120)));
    }
  }
});

test('aucune surface livrée ne dit comment Nota est payée avec les mots que la loi lui interdit', () => {
  const fautes = [];
  for (const [nom, textes] of Object.entries(SURFACES())) {
    for (const axe of AXES) {
      for (const motif of axe.motifs) {
        for (const t of textes) {
          const m = t.match(motif);
          if (!m) continue;
          const phrase = phraseAutour(t, t.indexOf(m[0]));
          if (axe.sauf && axe.sauf.test(phrase)) continue; // une dénégation, pas une affirmation
          fautes.push(nom + ' affirme ' + axe.dit + ' — or ' + axe.vrai + '.\n      « ' + phrase.slice(0, 220) + ' »');
        }
      }
    }
  }
  assert.deepEqual(fautes, [], 'affirmations proscrites :\n    ' + fautes.join('\n    '));
});

test('le garde a des dents : chaque formulation retirée est bien reconnue par son axe', () => {
  // Sans ceci, une expression affaiblie passerait inaperçue — le test resterait
  // vert en ne gardant plus rien. Chaque phrase ci-dessous a réellement été
  // livrée, ou décrit exactement l'arrangement retiré.
  const retirees = [
    ['commission', 'Nous ne vendons rien. Nota se rémunère par une commission sur les actes complétés.'],
    ['commission', 'La commission n’est prélevée qu’à la signature, sur la valeur confirmée.'],
    ['commission', 'Nota earns a commission on completed acts.'],
    ['partage', 'Le partage des honoraires est de 75/25 en faveur du notaire.'],
    ['partage', 'Vos honoraires montent à 85 % au-delà d’une cote de 90.'],
    ['partage', 'Nota takes a 15 % share of the notary’s fees.'],
    ['prix fixe', 'Vous payez ses honoraires et, séparément, le prix fixe du service de Nota.'],
    ['prix fixe', 'Nota’s service price is a fixed amount.'],
    ['400 $', 'Le service de Nota coûte 400 $, quel que soit l’acte.'],
    ['comparatif', 'Signer par Nota revient moins cher qu’un notaire.'],
    ['cote publiée', 'Un témoignage de cliente sur ce notaire.'],
    ['cote publiée', 'La cote du notaire est de 4,5 sur 5.'],
  ];
  for (const [id, phrase] of retirees) {
    const axe = AXES.find((a) => a.id === id);
    assert.ok(axe, 'axe inconnu : ' + id);
    assert.ok(axe.motifs.some((re) => re.test(phrase)),
      'l’axe « ' + id + ' » ne reconnaît plus : ' + phrase);
  }
  // …et une dénégation ne doit JAMAIS être comptée comme une affirmation.
  const denegation = 'Nota facture son propre prix au client, à côté : aucun partage d’honoraires, aucune convention sur vos honoraires.';
  const partage = AXES.find((a) => a.id === 'partage');
  assert.ok(partage.motifs.some((re) => re.test(denegation)), 'la phrase est bien attrapée par le motif…');
  assert.ok(partage.sauf.test(phraseAutour(denegation, denegation.indexOf('partage'))), '…et rendue par l’exception de dénégation');
});

test('et les surfaces disent la vérité à la place — les deux directions, toujours', () => {
  // (a) La politique de confidentialité : d'où vient l'argent de Nota.
  const priv = FLAT(staticDoc().getElementById('pane-confidentialite').textContent);
  assert.match(priv, /facturant son propre service au client/, priv.slice(0, 200));
  assert.match(priv, /prix publié d’avance/, 'et que ce prix est publié : ' + priv.slice(0, 200));
  I18N.force('en');
  const privEn = I18N.tEn('Nous ne vendons ni ne louons vos renseignements. Nota se rémunère en facturant son propre service au client, à un prix publié d’avance. Aucune donnée n’est monnayée.');
  assert.match(privEn, /charging the client for its own service/, privEn);
  assert.match(privEn, /published in advance/, privEn);

  // (b) La récompense de référence sort des revenus de Nota — pas d'une part
  //     des honoraires du notaire, pas du prix du client.
  const notes = [...staticDoc().querySelectorAll('.nota-guarantee')].map((n) => FLAT(n.textContent));
  const partenaires = notes.find((t) => /récompense de référence/.test(t)) || '';
  assert.match(partenaires, /à même ses propres revenus/, partenaires);
  assert.match(partenaires, /jamais retranchée des honoraires du notaire/, partenaires);
  assert.match(I18N.tEn('La récompense de référence est un coût de marketing de Nota, payée à même ses propres revenus — jamais ajoutée au prix du client, jamais retranchée des honoraires du notaire.'),
    /paid out of its own revenue/);

  // (c) Le catalogue JSON-LD — la seule phrase de prix qu'un robot lit — dit la
  //     grille, pas un forfait. (Les scripts ne sont jamais traduits : le
  //     walker d'i18n.js saute <script>, donc rien à couvrir côté anglais.)
  const cat = APP_SRC.match(/description: '([^']*Prix de départ[^']*)'/);
  assert.ok(cat, 'le catalogue décrit toujours son offre');
  assert.match(cat[1], /publié d’avance/, cat[1]);
  assert.ok(!/fixe/.test(cat[1]), cat[1]);
});

test('le dictionnaire ne garde pas en dormance une entrée que plus aucune source ne produit', () => {
  // Une entrée orpheline est une copie prête à revenir : les six retirées le
  // 2026-09-04 (cinq entrées TEXT + une règle) n'avaient plus de source
  // française nulle part, et portaient toutes une affirmation retirée — le mot
  // « commission » pour cinq d'entre elles, la ligne unique de l'ADR 0031
  // (« rien de plus ») pour la sixième.
  for (const orpheline of [
    'commission seulement sur ce qui se conclut.',
    'Prix et commission.',
    'ou vous propose un prix — vous restez libre. Vous payez votre prix affiché à la signature, rien de plus.',
    'Nous ne vendons ni ne louons vos renseignements. Nota se rémunère par une commission sur les actes complétés. Aucune donnée n’est monnayée.',
    'La récompense de référence est un coût de marketing de Nota, payée à même sa propre commission — jamais ajoutée au prix du client, jamais retranchée des honoraires du notaire.',
  ]) {
    assert.ok(!I18N.covered(orpheline), 'le dictionnaire porte encore : ' + orpheline);
  }
  // Et les phrases vivantes, elles, restent traduites — retirer une entrée ne
  // doit jamais laisser une source française sans anglais.
  I18N.force('en');
  for (const vivante of [
    'Nous ne vendons ni ne louons vos renseignements. Nota se rémunère en facturant son propre service au client, à un prix publié d’avance. Aucune donnée n’est monnayée.',
    'ou vous propose un prix — vous restez libre. Vous payez ses honoraires — le montant que vous avez offert — et, séparément, le prix du service de Nota, publié d’avance ; les deux vous sont affichés avant tout paiement.',
    'La récompense de référence est un coût de marketing de Nota, payée à même ses propres revenus — jamais ajoutée au prix du client, jamais retranchée des honoraires du notaire.',
  ]) {
    assert.ok(I18N.covered(vivante), 'plus d’anglais pour : ' + vivante);
  }
});
