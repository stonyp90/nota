/**
 * Partner referrals (ADR 0011) + the private mise-en-relation channel
 * (ADR 0010 §4), pinned end to end on the web side:
 *
 *   1. ?ref=CODE capture — normalized once, stored privately, URL cleaned,
 *      never displayed; attached as `parrain` on POST /bids AND on the notary
 *      signup POST /notaries/connect.
 *   2. The Partenaires pane — reward amounts ALWAYS from the domain
 *      (D.REFERRAL), partner-type chips from D.REFERRAL.partners, the claim
 *      form's live D.normalizeReferralCode link preview, the POST /partenaires
 *      contract (201 + typed errors), and the copyable success link.
 *   3. The looping reward vignette — decorative CSS, frozen on its FINAL
 *      state under prefers-reduced-motion (never a blank strip).
 *   4. The optional private telephone — riding on POST /bids, and the
 *      retained notary's contact (GET /client/bid → notaire) surfacing in
 *      « Mes offres » with a mailto link.
 *   5. « Déjà transmis au notaire » — a document can be marked as handed over
 *      through another channel (D.DOSSIER_TRANSMIS): distinct rendering,
 *      undoable, and counted as provided by the domain's leadReadiness.
 *
 * Boot harness mirrors client-offers.test.mjs (domain then app inside jsdom,
 * fetch stub keyed by URL).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }; // LOCAL date, like app.js — the UTC slice rolls to tomorrow every evening in UTC-4/-5
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});

async function boot({ url = '', seed = {}, routes = [] } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/' + url,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {}, headers: (init && init.headers) || {} };
        calls.push(call);
        const r = routes.find((x) => x.match(call.url, call.init));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, seed[k]));
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, calls };
}

function fire(win, elmt, type) {
  elmt.dispatchEvent(new win.Event(type, { bubbles: true }));
}

// ---------------------------------------------------------------------------
// 1. ?ref=CODE capture
// ---------------------------------------------------------------------------

test('?ref=CODE is captured normalized, the URL is cleaned, nothing is displayed', async () => {
  // A code that no static copy uses as an example, so the display check is
  // meaningful ("EVEROY" is the claim form's own illustration text).
  const { win, doc, D } = await boot({ url: '?ref=zz-top-9' });
  assert.ok(D.isReferralCode('zz-top-9'), 'the fixture code is a valid domain code');
  assert.equal(win.localStorage.getItem('nota.ref.v1'), 'ZZTOP9', 'stored normalized');
  assert.equal(win.location.search, '', 'the param never lingers in the address bar');
  // Private means private: the code appears nowhere in the rendered page.
  assert.ok(!doc.body.textContent.includes('ZZTOP9'), 'the code is never displayed');
});

test('an invalid ?ref is ignored but still cleaned from the URL', async () => {
  const { win } = await boot({ url: '?ref=a!' });
  assert.equal(win.localStorage.getItem('nota.ref.v1'), null, 'nothing stored');
  assert.equal(win.location.search, '', 'the bad param is cleaned anyway');
});

// Fills a valid refinancement offer and submits it; returns the captured
// createBid payload (or null). Shared by every attribution test below.
async function submitOffer({ win, doc, D, Nota }, tweak) {
  let captured = null;
  Nota.store.createBid = async (payload) => {
    captured = payload;
    return { ok: true, bid: { id: 'x', serviceId: payload.serviceId, dateISO: payload.dateISO, montant: payload.montant, tier: 'standard' } };
  };
  const sel = $(doc, 'o-service'); sel.value = 'refinancement'; fire(win, sel, 'change');
  const date = $(doc, 'o-date'); date.value = D.addDays(todayISO(), 5); fire(win, date, 'change'); fire(win, date, 'input');
  $(doc, 'o-amount').value = '2000'; fire(win, $(doc, 'o-amount'), 'input');
  $(doc, 'crit-valeur_pret').value = '300000'; fire(win, $(doc, 'crit-valeur_pret'), 'input');
  $(doc, 'crit-succession__non').click();
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  const selPreteur = $(doc, 'crit-preteur'); selPreteur.value = 'banque_nationale'; fire(win, selPreteur, 'change');
  if (tweak) tweak();
  fire(win, $(doc, 'offer-form'), 'submit');
  await wait(10);
  return captured;
}

test('the captured code pre-fills the booking field and rides as `parrain` on the published offer', async () => {
  const ctx = await boot({ seed: { 'nota.ref.v1': 'EVEROY' } });
  const { win, doc } = ctx;
  // Transparent attribution: the link's code is VISIBLE in the field, where
  // the client can see, correct or remove it.
  assert.equal($(doc, 'o-parrain').value, 'EVEROY', 'the field is pre-filled from ?ref');
  const captured = await submitOffer(ctx, () => {
    // The private phone rides along too (ADR 0010 §4) — and only privately.
    $(doc, 'o-telephone').value = '(418) 555-0199'; fire(win, $(doc, 'o-telephone'), 'input');
  });
  assert.ok(captured, 'createBid was called');
  assert.equal(captured.parrain, 'EVEROY', 'the referral attribution rides privately');
  assert.equal(captured.telephone, '(418) 555-0199', 'the phone rides privately');
});

test('a code typed by hand (spoken referral) rides normalized — case and spaces never matter', async () => {
  const ctx = await boot();
  const { win, doc } = ctx;
  const captured = await submitOffer(ctx, () => {
    $(doc, 'o-parrain').value = ' eve roy '; fire(win, $(doc, 'o-parrain'), 'input');
  });
  assert.equal(captured.parrain, 'EVEROY', 'typed entry is normalized like a link');
  assert.equal(win.localStorage.getItem('nota.ref.v1'), 'EVEROY', 'the typed code is remembered for this device');
  // Soft confirmation while typing, CTA never gated on it.
  assert.equal($(doc, 'o-parrain-preview').dataset.state, 'ok');
});

test('clearing the pre-filled field is an explicit "no code": nothing rides on the offer', async () => {
  const ctx = await boot({ seed: { 'nota.ref.v1': 'EVEROY' } });
  const { win, doc } = ctx;
  const captured = await submitOffer(ctx, () => {
    $(doc, 'o-parrain').value = ''; fire(win, $(doc, 'o-parrain'), 'input');
  });
  assert.ok(captured, 'the offer still publishes');
  assert.ok(!('parrain' in captured), 'the client removed the attribution');
});

test('an invalid typed code warns softly and never blocks the booking', async () => {
  const ctx = await boot();
  const { win, doc } = ctx;
  const captured = await submitOffer(ctx, () => {
    $(doc, 'o-parrain').value = 'x!'; fire(win, $(doc, 'o-parrain'), 'input');
  });
  assert.equal($(doc, 'o-parrain-preview').dataset.state, 'warn', 'a soft inline warning');
  assert.ok(captured, 'the offer still publishes — a bad code never costs a booking');
  assert.ok(!('parrain' in captured), 'the invalid code is dropped');
});

test('the captured code rides as `parrain` on the notary signup too', async () => {
  const { win, doc, Nota } = await boot({ seed: { 'nota.ref.v1': 'EVEROY' } });
  let captured = null;
  win.fetch = (url, opts) => {
    const u = String(url);
    if (u.endsWith('/notary/session')) {
      return Promise.resolve(jsonRes(403, { errors: [{ code: 'compte_requis', message: 'Abonnement requis.' }] }));
    }
    if (u.endsWith('/notaries/connect')) {
      captured = JSON.parse(opts.body);
      return Promise.resolve(jsonRes(503, { errors: [{ message: 'Inscription indisponible pour le moment.' }] }));
    }
    return Promise.reject(new Error('offline'));
  };
  $(doc, 'nc-email').value = 'nouveau@etude.ca';
  $(doc, 'notary-signup-link').click(); // self-select the signup branch
  // Transparent here too: the signup prompt's referral field shows the code.
  assert.equal($(doc, 'nc-signup-parrain').value, 'EVEROY', 'the signup field is pre-filled from ?ref');
  $(doc, 'notary-signup-btn').click();
  await wait(20);
  assert.ok(captured, 'the CTA should call /notaries/connect');
  assert.equal(captured.parrain, 'EVEROY', 'a referred notary credits the partner');
});

test('a notary can type a spoken referral code on the signup prompt', async () => {
  const { win, doc, Nota } = await boot();
  let captured = null;
  win.fetch = (url, opts) => {
    const u = String(url);
    if (u.endsWith('/notary/session')) {
      return Promise.resolve(jsonRes(403, { errors: [{ code: 'compte_requis', message: 'Abonnement requis.' }] }));
    }
    if (u.endsWith('/notaries/connect')) {
      captured = JSON.parse(opts.body);
      return Promise.resolve(jsonRes(503, { errors: [{ message: 'Inscription indisponible pour le moment.' }] }));
    }
    return Promise.reject(new Error('offline'));
  };
  $(doc, 'nc-email').value = 'nouveau@etude.ca';
  $(doc, 'notary-signup-link').click(); // self-select the signup branch
  $(doc, 'nc-signup-parrain').value = ' marc qc ';
  $(doc, 'notary-signup-btn').click();
  await wait(20);
  assert.ok(captured, 'the CTA should call /notaries/connect');
  assert.equal(captured.parrain, 'MARCQC', 'typed entry is normalized like a link');
});

// ---------------------------------------------------------------------------
// 2. The Partenaires pane
// ---------------------------------------------------------------------------

test('the reward cards always read from the domain', async () => {
  const { doc, D, Nota } = await boot();
  Nota.setTab('partenaires');
  assert.equal($(doc, 'pr-amount-client').textContent, D.money(D.REFERRAL.client));
  assert.equal($(doc, 'pr-amount-notaire').textContent, D.money(D.REFERRAL.notaire));
  // The notary track is the bigger reward and carries the highlight card.
  assert.ok(D.REFERRAL.notaire > D.REFERRAL.client, 'domain: the notary reward pays more');
  assert.ok($(doc, 'pr-card-notaire').classList.contains('pr-card--notaire'), 'the bigger reward is highlighted');
  // The TOS clause carries the same domain figures — never a hardcoded amount.
  assert.ok($(doc, 'tos-partenaires').textContent.includes(D.money(D.REFERRAL.client)));
  assert.ok($(doc, 'tos-partenaires').textContent.includes(D.money(D.REFERRAL.notaire)));
});

test('one type chip per domain partner category', async () => {
  const { doc, D, Nota } = await boot();
  Nota.setTab('partenaires');
  const chips = [...doc.querySelectorAll('#partner-type .chip')];
  // join(): the domain array lives in the jsdom realm, whose Array.prototype
  // fails deepStrictEqual against a Node-realm array of the same content.
  assert.equal(chips.map((c) => c.dataset.type).join(','), D.REFERRAL.partners.map((p) => p.id).join(','));
  assert.equal(chips.map((c) => c.textContent).join(','), D.REFERRAL.partners.map((p) => p.nom).join(','));
});

test('the claim form previews the normalized shareable link as the partner types', async () => {
  const { win, doc, Nota } = await boot();
  Nota.setTab('partenaires');
  const code = $(doc, 'partner-code');
  code.value = 'eve-roy'; fire(win, code, 'input');
  const prev = $(doc, 'partner-code-preview');
  assert.equal(prev.dataset.state, 'ok');
  assert.ok(prev.textContent.includes('https://nota.example/?ref=EVEROY'),
    'origin + /?ref=CODE, normalized: ' + prev.textContent);
  code.value = 'x'; fire(win, code, 'input');
  assert.equal(prev.dataset.state, 'warn', 'a short code warns instead of previewing');
});

// The claim is EMAIL-VERIFIED (ADR 0011): POST /partenaires only pends (200 +
// dev echo), then the web finishes verification in place with the echoed token.
const claimRoutes = (verify) => [
  {
    match: (u, init) => u.endsWith('/partenaires') && (init.method === 'POST'),
    reply: () => jsonRes(200, { ok: true, devToken: 'DEV-EVEROY' }),
  },
  {
    match: (u) => u.endsWith('/partenaires/verify'),
    reply: () => verify,
  },
];

test('a verified claim shows the shareable link and a copy button; editing re-arms the form', async () => {
  const { win, doc, Nota, calls } = await boot({
    routes: claimRoutes(jsonRes(201, { partenaire: { code: 'EVEROY' } })),
  });
  Nota.setTab('partenaires');
  doc.querySelector('#partner-type .chip').click();
  const mail = $(doc, 'partner-courriel'); mail.value = 'eve@agence.ca'; fire(win, mail, 'input');
  const code = $(doc, 'partner-code'); code.value = 'eve-roy'; fire(win, code, 'input');
  assert.equal($(doc, 'partner-submit').disabled, false, 'type + courriel + code arm the CTA');
  fire(win, $(doc, 'partner-form'), 'submit');
  await wait(20);
  const post = calls.find((c) => c.url.endsWith('/partenaires') && c.init.method === 'POST');
  assert.ok(post, 'POST /partenaires');
  const body = JSON.parse(post.init.body);
  assert.equal(body.code, 'EVEROY', 'the claim posts the normalized code');
  assert.equal(body.courriel, 'eve@agence.ca');
  assert.equal(body.type, doc.querySelector('#partner-type .chip').dataset.type);
  // The echoed token was redeemed at /partenaires/verify.
  assert.ok(calls.find((c) => c.url.endsWith('/partenaires/verify')), 'POST /partenaires/verify');
  assert.equal($(doc, 'partner-success').hidden, false);
  assert.equal($(doc, 'partner-link').textContent, 'https://nota.example/?ref=EVEROY');
  assert.ok($(doc, 'partner-copy'), 'a copy button beside the link');
});

test("the owner re-requesting their own confirmed code still gets their link — never an error", async () => {
  // The API short-circuits an already-confirmed owner with { confirmed: true }.
  const { win, doc, Nota } = await boot({
    routes: [{
      match: (u, init) => u.endsWith('/partenaires') && init.method === 'POST',
      reply: () => jsonRes(200, { confirmed: true, partenaire: { code: 'EVEROY' } }),
    }],
  });
  Nota.setTab('partenaires');
  doc.querySelector('#partner-type .chip').click();
  const mail = $(doc, 'partner-courriel'); mail.value = 'eve@agence.ca'; fire(win, mail, 'input');
  const code = $(doc, 'partner-code'); code.value = 'everoy'; fire(win, code, 'input');
  fire(win, $(doc, 'partner-form'), 'submit');
  await wait(20);
  assert.equal($(doc, 'partner-errors').hidden, true, 'a re-request is not an error');
  assert.equal($(doc, 'partner-success').hidden, false);
  assert.equal($(doc, 'partner-link').textContent, 'https://nota.example/?ref=EVEROY');
});

test('a pending claim (production, no dev echo) shows the "check your email" state', async () => {
  const { win, doc, Nota } = await boot({
    routes: [{
      match: (u, init) => u.endsWith('/partenaires') && init.method === 'POST',
      reply: () => jsonRes(200, { ok: true }), // no devToken -> production shape
    }],
  });
  Nota.setTab('partenaires');
  doc.querySelector('#partner-type .chip').click();
  const mail = $(doc, 'partner-courriel'); mail.value = 'eve@agence.ca'; fire(win, mail, 'input');
  const code = $(doc, 'partner-code'); code.value = 'eve-roy'; fire(win, code, 'input');
  fire(win, $(doc, 'partner-form'), 'submit');
  await wait(20);
  assert.equal($(doc, 'partner-pending').hidden, false, 'the pending state is shown until the link is opened');
  assert.equal($(doc, 'partner-success').hidden, true, 'no shareable link before confirmation');
  assert.equal($(doc, 'partner-errors').hidden, true, 'pending is not an error');
});

test('a #pauth= confirmation link is consumed on boot: it verifies and reveals the link', async () => {
  const { win, doc, calls } = await boot({
    url: '#pauth=DEV-EVEROY',
    routes: [{
      match: (u) => u.endsWith('/partenaires/verify'),
      reply: () => jsonRes(201, { partenaire: { code: 'EVEROY' } }),
    }],
  });
  await wait(30);
  assert.ok(calls.find((c) => c.url.endsWith('/partenaires/verify')), 'the boot consumes the #pauth token');
  assert.ok(!/pauth/.test(win.location.hash), 'the token never lingers in the URL (a refresh cannot replay it)');
  assert.equal($(doc, 'partner-success').hidden, false, 'the shareable link is revealed');
  assert.equal($(doc, 'partner-link').textContent, 'https://nota.example/?ref=EVEROY');
});

test('a taken code surfaces the friendly typed error, and the CTA re-arms', async () => {
  const { win, doc, Nota } = await boot({
    routes: [{
      match: (u) => u.endsWith('/partenaires'),
      reply: () => jsonRes(409, { errors: [{ code: 'code_deja_pris', message: 'Code déjà pris.' }] }),
    }],
  });
  Nota.setTab('partenaires');
  doc.querySelector('#partner-type .chip').click();
  const mail = $(doc, 'partner-courriel'); mail.value = 'eve@agence.ca'; fire(win, mail, 'input');
  const code = $(doc, 'partner-code'); code.value = 'everoy'; fire(win, code, 'input');
  fire(win, $(doc, 'partner-form'), 'submit');
  await wait(20);
  const errs = $(doc, 'partner-errors');
  assert.equal(errs.hidden, false);
  assert.match(errs.textContent, /déjà pris — essayez une variante/);
  assert.equal($(doc, 'partner-submit').disabled, false, 'the partner can try a variant right away');
});

// ---------------------------------------------------------------------------
// 2b. The returning partner — the pane resurfaces the claimed code
// ---------------------------------------------------------------------------

// A confirmed claim persisted by a previous visit (nota.partner.v1).
const CLAIMED = JSON.stringify({
  code: 'EVEROY', type: 'agent_immobilier', courriel: 'eve@agence.ca',
  createdAt: '2026-08-01T12:00:00.000Z',
});

test('a returning partner lands on their code — never a blank claim form', async () => {
  const { doc, Nota } = await boot({ seed: { 'nota.partner.v1': CLAIMED } });
  Nota.setTab('partenaires');
  // The share box is already open, exactly as the claim left it.
  assert.equal($(doc, 'partner-success').hidden, false, 'the share box is open on arrival');
  assert.equal($(doc, 'partner-link').textContent, 'https://nota.example/?ref=EVEROY');
  // The panel reads as THEIR code now, not a fresh claim.
  assert.equal($(doc, 'partner-form-title').textContent, 'Votre code partenaire');
  assert.equal($(doc, 'partner-submit').textContent.trim(), 'Code réclamé ✓');
  assert.equal($(doc, 'partner-submit').disabled, true);
  // The form is pre-filled from the record, so an edit starts from it.
  assert.equal($(doc, 'partner-code').value, 'EVEROY');
  assert.equal($(doc, 'partner-courriel').value, 'eve@agence.ca');
  const on = doc.querySelector('#partner-type .chip[aria-pressed="true"]');
  assert.equal(on && on.dataset.type, 'agent_immobilier', 'their category chip is selected');
});

test('editing a field re-arms the returning partner’s form for a fresh claim', async () => {
  const { win, doc, Nota } = await boot({ seed: { 'nota.partner.v1': CLAIMED } });
  Nota.setTab('partenaires');
  const code = $(doc, 'partner-code'); code.value = 'eve-roy-2'; fire(win, code, 'input');
  assert.equal($(doc, 'partner-success').hidden, true, 'the share box folds away');
  assert.equal($(doc, 'partner-submit').textContent.trim(), 'Réclamer mon code →');
  assert.equal($(doc, 'partner-submit').disabled, false, 'type + courriel carry over — ready to resubmit');
});

test('the vignette plays the returning partner’s OWN code — EVEROY stays for prospects', async () => {
  const fresh = await boot();
  assert.equal($(fresh.doc, 'pr-vig-code').textContent, 'EVEROY', 'the prospect sees the sample code');
  const { doc } = await boot({
    seed: { 'nota.partner.v1': JSON.stringify({ code: 'MARCQC', type: 'courtier_hypothecaire', courriel: 'm@qc.ca' }) },
  });
  assert.equal($(doc, 'pr-vig-code').textContent, 'MARCQC', 'the partner sees their own code in the story');
});

// ---------------------------------------------------------------------------
// 3. The pane stays strict — and the air carries ONE clean vignette
// ---------------------------------------------------------------------------

test('the reward vignette fills the pitch air: decorative, domain-priced, motion-safe', async () => {
  // Owner's call (2026-08-26): the slack between the reward cards and the
  // fine print carries a clean animation instead of empty air — the referral
  // story played out (your code → the client's demand retained → the reward).
  const { doc, D } = await boot();
  const vig = doc.querySelector('#pane-partenaires .pr-pitch .pr-vig');
  assert.ok(vig, 'the vignette lives in the pitch column, under the reward cards');
  assert.equal(vig.getAttribute('aria-hidden'), 'true', 'decorative — invisible to AT');
  // The payoff figure is DOMAIN data (renderPartnerPane), never a markup literal.
  assert.equal($(doc, 'pr-vig-amt').textContent, D.money(D.REFERRAL.client));
  assert.ok(!/pr-vig-amt"[^>]*>[^<]*\d/.test(HTML_SRC), 'no literal amount baked in the markup');
  // Pure CSS, one pass that holds its FINAL state (base styles are the ending,
  // keyframes only add the hidden phases) — and frozen on that same finished
  // tableau under reduced motion: never a blank strip, payoff always lands.
  const rmBlocks = CSS_SRC.split('@media (prefers-reduced-motion: reduce)').slice(1);
  assert.ok(rmBlocks.some((b) => /\.pr-vig[^}]*animation: none/.test(b.slice(0, b.indexOf('}') + 1))),
    'the vignette sits still under prefers-reduced-motion');
  assert.match(CSS_SRC, /\.pr-vig\b/, 'the vignette is styled');
});

test('otherwise the pane stays strict: no per-card mechanics, one guarantee', async () => {
  // Owner's ask (2026-08-25): thin and focused. The pitch is the two amounts,
  // the action is the claim form — repetition stays gone; the vignette above
  // is the ONE decorative element the pane carries.
  const { doc } = await boot();
  assert.equal(doc.querySelector('#pane-partenaires .pr-how'), null,
    'a card is kicker + amount + when — the mechanics live in the three steps');
  // The guarantee is stated ONCE: the fine-print line, never again in the intro.
  const intro = doc.querySelector('#pane-partenaires .intro p').textContent;
  assert.ok(!/prix du client/.test(intro), 'the intro no longer duplicates the guarantee');
  assert.ok(doc.querySelector('#pane-partenaires .nota-guarantee'), 'the guarantee stays in the fine print');
  // The RETIRED 2026-08-25 vignette's classes never come back from the dead.
  assert.ok(!/pr-vignette|pr-scene|pr-w[1-4]/.test(CSS_SRC), 'no dead vignette CSS');
  // The fine-print note reads as a quiet line, not another boxed card.
  assert.match(CSS_SRC, /\.pr-more \.note\s*\{[^}]*border-left:\s*0/,
    'the guarantee sheds the boxed .note chrome inside the pane');
});

// ---------------------------------------------------------------------------
// 4. Retained offer → the notary's contact in « Mes offres »
// ---------------------------------------------------------------------------

test('a retained offer names the retaining notary with a mailto link', async () => {
  const DATE = addDays(todayISO(), 6);
  const OFFER = { id: 'o1', dateISO: DATE, serviceId: 'refinancement', montant: 2400, clientToken: 'tok-o1' };
  const { doc, Nota } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [{
      match: (u) => u.includes('/client/bid?'),
      reply: () => jsonRes(200, {
        bid: { id: 'o1', serviceId: 'refinancement', dateISO: DATE, montant: 2400, status: 'retenue', etude: 'Étude Tremblay' },
        notaire: { etude: 'Étude Tremblay', courriel: 'maitre@tremblay.ca' },
        propositions: [], demandes: [],
        readiness: { total: 8, done: 8, missing: [], consent: true, ready: true },
      }),
    }],
  });
  Nota.setTab('profil');
  await wait(40);
  const contact = doc.querySelector('.my-offer-contact');
  assert.ok(contact, 'the mise-en-relation block renders on a retained offer');
  assert.match(contact.textContent, /Étude Tremblay/);
  const mail = contact.querySelector('a.my-offer-contact-mail');
  assert.equal(mail.getAttribute('href'), 'mailto:maitre@tremblay.ca');
});

// ---------------------------------------------------------------------------
// 5. « Déjà transmis au notaire » (transmis autrement)
// ---------------------------------------------------------------------------

test('a dossier document can be marked transmitted through another channel, and undone', async () => {
  const { win, doc, D, Nota } = await boot();
  Nota.setTab('dossier');
  const svcId = $(doc, 'd-service').value;
  const firstDocId = D.serviceById(svcId).documents[0].id;

  const btn = doc.querySelector('#dossier-list .doc-transmis-btn');
  assert.ok(btn, 'every document row offers « Déjà transmis au notaire »');
  assert.equal(btn.textContent, 'Déjà transmis au notaire');
  btn.click();
  await wait(10);

  const saved = JSON.parse(win.localStorage.getItem('nota.dossier.v1'))[svcId];
  assert.equal(saved[firstDocId], D.DOSSIER_TRANSMIS, 'stored as the domain constant');
  // Distinct rendering: the state is named, and there is no file picker.
  const state = doc.querySelector('#dossier-list .doc-transmis');
  assert.ok(state, 'the transmitted state renders distinctly');
  assert.match(state.textContent, /Transmis par un autre canal/);
  // The domain counts it as provided — it advances the preparation count.
  const r = D.leadReadiness(svcId, saved);
  assert.ok(r.done >= 1, 'leadReadiness counts a transmitted item as provided');

  // Undoable: « Annuler » clears the value and the file picker returns.
  state.querySelector('button').click();
  await wait(10);
  const after = JSON.parse(win.localStorage.getItem('nota.dossier.v1'))[svcId] || {};
  assert.ok(!after[firstDocId], 'undo clears the stored value');
  assert.ok(doc.querySelector('#dossier-list .doc-transmis-btn'), 'the action is offered again');
});
