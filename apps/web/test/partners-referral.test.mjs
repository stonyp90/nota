/**
 * Partner referrals (ADR 0011) + the private mise-en-relation channel
 * (ADR 0010 §4), pinned end to end on the web side:
 *
 *   1. ?ref=CODE capture — normalized once, stored privately, URL cleaned,
 *      visible to the referring visitor; attached as `parrain` on POST /bids AND on the notary
 *      signup POST /notaries/signup.
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
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Every window this file boots is closed when the file is done: a signed-in
// client on the profil tab runs the 15 s status poll (app.js clientPollStart),
// and a jsdom timer left running keeps the test process alive forever.
const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch { /* already closed */ } } });

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
// The public origin the page declares (P1-8): share links are built on it, not on location.origin.
const SITE = (/<meta name="nota:site" content="([^"]+)"/.exec(HTML_SRC) || [null, 'https://nota.example'])[1];
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
  openWindows.push(win);
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

test('?ref=CODE is captured normalized, the URL is cleaned and a private indicator appears', async () => {
  // A code that no static copy uses as an example, so the display check is
  // meaningful ("EVEROY" is the claim form's own illustration text).
  const { win, doc, D } = await boot({ url: '?ref=zz-top-9' });
  assert.ok(D.isReferralCode('zz-top-9'), 'the fixture code is a valid domain code');
  assert.equal(win.localStorage.getItem('nota.ref.v1'), 'ZZTOP9', 'stored normalized');
  assert.equal(win.location.search, '', 'the param never lingers in the address bar');
  assert.equal($(doc, 'referral-status').hidden, false);
  assert.equal($(doc, 'referral-status-label').textContent, 'Code enregistré : ZZTOP9');
  assert.equal($(doc, 'o-parrain').value, 'ZZTOP9');
  assert.equal($(doc, 'o-parrain-preview').dataset.state, 'ok');
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
  const selDeplacement = $(doc, 'crit-deplacement'); selDeplacement.value = 'client_50'; fire(win, selDeplacement, 'change');
  const pre = $(doc, 'o-prefix'); pre.value = 'G1R'; fire(win, pre, 'input'); // REQUIRED sector
  // ADR 0033 — name + courriel are required at publish (the retaining notary
  // must be able to reach the client); the referral code is orthogonal to them.
  const nom = $(doc, 'o-name'); nom.value = 'Prénom Nom'; fire(win, nom, 'input');
  const em = $(doc, 'o-courriel'); em.value = 'client@exemple.ca'; fire(win, em, 'input');
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
    if (u.endsWith('/notaries/signup')) {
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
  assert.ok(captured, 'the CTA should call the FREE door /notaries/signup — never Stripe');
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
    if (u.endsWith('/notaries/signup')) {
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
  assert.ok(captured, 'the CTA should call the FREE door /notaries/signup — never Stripe');
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

test('each reward card states its cadence — the difference the amounts alone hide', async () => {
  const { doc, Nota } = await boot();
  Nota.setTab('partenaires');
  // 50 $ repeats forever; 250 $ pays once per referred notary. The cadence
  // tag sits on the amount row so the pair is comparable at a glance instead
  // of burying the distinction in a collapsed FAQ answer.
  assert.equal($(doc, 'pr-card-client').querySelector('.pr-freq').textContent, 'Sans limite');
  assert.equal($(doc, 'pr-card-notaire').querySelector('.pr-freq').textContent, 'Une fois par notaire');
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

// Le métier n'est demandé QU'UNE fois (2026-09-12) : le héros posait la même
// question que le formulaire, puis le formulaire se refermait sur un reçu et
// un bouton « Modifier ». Les puces restent visibles et restent la réponse.
test('the profession is asked once, in the form, and stays editable', async () => {
  const { doc, D, Nota } = await boot();
  Nota.setTab('partenaires');
  const [first, second] = D.REFERRAL.partners;
  assert.equal(doc.querySelector('#pr-audience'), null, 'the hero no longer asks it a second time');
  const chips = $(doc, 'partner-type');
  chips.querySelector('[data-type="' + first.id + '"]').click();
  assert.equal(chips.hidden, false, 'the choices stay on screen');
  assert.equal(chips.querySelector('[aria-pressed="true"]').dataset.type, first.id);
  chips.querySelector('[data-type="' + second.id + '"]').click();
  assert.equal(chips.querySelectorAll('[aria-pressed="true"]').length, 1);
  assert.equal(chips.querySelector('[aria-pressed="true"]').dataset.type, second.id);
});

test('the activation form explains what is missing and when it is ready', async () => {
  const { win, doc, Nota } = await boot();
  Nota.setTab('partenaires');
  const hint = $(doc, 'partner-next-step'), submit = $(doc, 'partner-submit');
  assert.equal(submit.getAttribute('aria-describedby'), hint.id);
  assert.match(hint.textContent, /métier/);
  doc.querySelector('#partner-type .chip').click();
  assert.match(hint.textContent, /courriel professionnel/);
  const mail = $(doc, 'partner-courriel');
  mail.value = 'eve.roy@'; fire(win, mail, 'input'); fire(win, mail, 'blur');
  assert.equal(submit.disabled, true);
  assert.equal(mail.getAttribute('aria-invalid'), 'true');
  assert.match(hint.textContent, /Vérifiez votre adresse/);
  mail.value = 'eve.roy@agence.ca'; fire(win, mail, 'input');
  assert.equal(mail.hasAttribute('aria-invalid'), false);
  assert.equal(submit.disabled, false, 'the suggested code completes the form');
  assert.equal(hint.dataset.ready, 'true');
  assert.match(hint.textContent, /activer votre code/);
  const code = $(doc, 'partner-code'); code.value = 'x'; fire(win, code, 'input');
  assert.equal(submit.disabled, true);
  assert.equal(hint.dataset.ready, 'false');
  assert.match(hint.textContent, /code valide/);
});

test('editing during activation cannot send a second request and the receipt names the submitted address', async () => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const { win, doc, Nota, calls } = await boot({ routes: [{
    match: (u, init) => u.endsWith('/partenaires') && init.method === 'POST',
    reply: () => response,
  }] });
  Nota.setTab('partenaires');
  doc.querySelector('#partner-type .chip').click();
  const mail = $(doc, 'partner-courriel');
  mail.value = 'eve.roy@agence.ca'; fire(win, mail, 'input');
  fire(win, $(doc, 'partner-form'), 'submit');
  mail.value = 'autre@agence.ca'; fire(win, mail, 'input');
  assert.equal($(doc, 'partner-submit').disabled, true, 'the in-flight request owns the button');
  fire(win, $(doc, 'partner-form'), 'submit');
  assert.equal(calls.filter(c => c.url.endsWith('/partenaires')).length, 1);
  finish(jsonRes(200, { ok: true }));
  await wait(20);
  assert.equal($(doc, 'partner-pending-email').textContent, 'eve.roy@agence.ca');
});

test('the claim form previews the normalized shareable link as the partner types', async () => {
  const { win, doc, Nota } = await boot();
  Nota.setTab('partenaires');
  const code = $(doc, 'partner-code');
  code.value = 'eve-roy'; fire(win, code, 'input');
  const prev = $(doc, 'partner-code-preview');
  assert.equal(prev.dataset.state, 'ok');
  assert.ok(prev.textContent.includes(SITE + '/?ref=EVEROY'),
    'origin + /?ref=CODE, normalized: ' + prev.textContent);
  code.value = 'x'; fire(win, code, 'input');
  assert.equal(prev.dataset.state, 'warn', 'a short code warns instead of previewing');
});

// Conversion: the code is SUGGESTED from the courriel, so the happy path is
// chip + courriel + submit — the partner never has to invent a valid code.
test('typing the courriel suggests a code; a typed code is never overwritten', async () => {
  const { win, doc, Nota } = await boot();
  Nota.setTab('partenaires');
  const mail = $(doc, 'partner-courriel'), code = $(doc, 'partner-code');

  mail.value = 'eve.roy@agence.ca'; fire(win, mail, 'input');
  assert.equal(code.value, 'EVEROY', 'the local part becomes the suggested code');
  assert.equal($(doc, 'partner-code-preview').dataset.state, 'ok', 'the suggestion previews its link');

  // Refining the courriel re-derives while the code is still the suggestion.
  mail.value = 'eve.roy22@agence.ca'; fire(win, mail, 'input');
  assert.equal(code.value, 'EVEROY22');

  // A hand-typed code wins — later courriel edits leave it alone.
  code.value = 'MONCODE'; fire(win, code, 'input');
  mail.value = 'autre@agence.ca'; fire(win, mail, 'input');
  assert.equal(code.value, 'MONCODE', 'a manual code survives courriel edits');
});

test('a too-short local part suggests nothing', async () => {
  const { win, doc, Nota } = await boot();
  Nota.setTab('partenaires');
  const mail = $(doc, 'partner-courriel'), code = $(doc, 'partner-code');
  mail.value = 'eve@agence.ca'; fire(win, mail, 'input');
  assert.equal(code.value, '', 'EVE (3 chars) is not a valid code — no suggestion');
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
  assert.equal($(doc, 'partner-link').textContent, SITE + '/?ref=EVEROY');
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
  assert.equal($(doc, 'partner-link').textContent, SITE + '/?ref=EVEROY');
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
  assert.equal(doc.activeElement, $(doc, 'partner-pending'), 'the activation receipt is brought into view');
  assert.equal($(doc, 'partner-pending-email').textContent, 'eve@agence.ca', 'the actual destination is visible');
  $(doc, 'partner-email-edit').click();
  assert.equal(doc.activeElement, mail, 'correction returns directly to the email');
  assert.equal($(doc, 'partner-submit').disabled, true, 'focusing alone does not resend');
  mail.value = 'eve.roy@agence.ca'; fire(win, mail, 'input');
  assert.equal($(doc, 'partner-pending').hidden, true, 'the previous receipt clears after correction');
  assert.equal(code.value, 'eve-roy', 'the chosen code survives the correction');
  assert.equal($(doc, 'partner-submit').disabled, false);
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
  assert.equal($(doc, 'partner-link').textContent, SITE + '/?ref=EVEROY');
});

// The pending state must not dead-end: the likeliest failures are a typo'd
// courriel and a junk-folder detour, and EDITING a field is what re-arms the
// form — so the box has to say exactly that. The success box, in turn, is
// revealed asynchronously (dev echo, or the #pauth boot with no user gesture
// at all), so it has to announce itself to assistive tech.
test('the pending state offers a recovery path, and the revealed link announces itself', async () => {
  const { doc } = await boot();
  assert.match($(doc, 'partner-pending').textContent, /indésirables/,
    'the junk-folder / fix-your-courriel recovery line is part of the pending state');
  assert.equal($(doc, 'partner-success').getAttribute('aria-live'), 'polite',
    'the success reveal is announced');
});

// Native share — the agent's real gesture is handing the link over in the
// conversation where the referral is happening, usually on a phone. The
// button only surfaces where the platform has a share sheet; everywhere else
// the copy button stands alone, exactly as before.
test('a claimed link offers the native share sheet where the platform has one', async () => {
  const { win, doc, Nota } = await boot({
    routes: claimRoutes(jsonRes(201, { partenaire: { code: 'EVEROY' } })),
  });
  const shares = [];
  win.navigator.share = (data) => { shares.push(data); return Promise.resolve(); };
  Nota.setTab('partenaires');
  doc.querySelector('#partner-type .chip').click();
  const mail = $(doc, 'partner-courriel'); mail.value = 'eve@agence.ca'; fire(win, mail, 'input');
  const code = $(doc, 'partner-code'); code.value = 'eve-roy'; fire(win, code, 'input');
  fire(win, $(doc, 'partner-form'), 'submit');
  await wait(20);
  const share = $(doc, 'partner-share');
  assert.ok(share, 'a share button exists in the success box');
  assert.equal(share.hidden, false, 'it surfaces when navigator.share exists');
  share.click();
  await wait(10);
  assert.equal(shares.length, 1, 'one share-sheet call');
  assert.equal(shares[0].url, SITE + '/?ref=EVEROY');
});

test('without navigator.share the copy button stands alone', async () => {
  const { win, doc, Nota } = await boot({
    routes: claimRoutes(jsonRes(201, { partenaire: { code: 'EVEROY' } })),
  });
  Nota.setTab('partenaires');
  doc.querySelector('#partner-type .chip').click();
  const mail = $(doc, 'partner-courriel'); mail.value = 'eve@agence.ca'; fire(win, mail, 'input');
  const code = $(doc, 'partner-code'); code.value = 'eve-roy'; fire(win, code, 'input');
  fire(win, $(doc, 'partner-form'), 'submit');
  await wait(20);
  assert.equal($(doc, 'partner-success').hidden, false, 'the claim still succeeds');
  assert.equal($(doc, 'partner-share').hidden, true, 'no share sheet, no button');
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

test('the arrival partner door opens the real activation form without a client guide or a claim', async () => {
  const { doc, win, Nota, calls } = await boot({ url: '?intro=1' });
  const door = $(doc, 'ig-door-partner');
  assert.match(door.textContent, /Créer et partager mon code/);
  door.click();
  await wait(400);
  assert.equal($(doc, 'intro-gate').hidden, true);
  assert.equal(Nota.state.tab, 'partenaires');
  assert.equal($(doc, 'partner-details').open, true);
  assert.equal(doc.activeElement, doc.querySelector('#partner-type .chip'));
  assert.equal($(doc, 'partner-success').hidden, true, 'nothing can be shared before confirmation');
  assert.equal($(doc, 'partner-submit').disabled, true, 'the actual required fields still apply');
  assert.equal($(doc, 'onboarding-dialog').open, false);
  assert.equal(doc.querySelector('#client-walkthrough'), null);
  assert.equal(win.localStorage.getItem('nota.role.v1'), 'partner');
  assert.equal(win.localStorage.getItem('nota.introSeen'), '1');
  assert.equal(Nota.onboarding.seen(), true, 'the client guide cannot reopen on the next visit');
  assert.ok(!calls.some(c => /\/partenaires(?:\/|$)/.test(c.url)), 'choosing a role never claims a code');
  assert.equal(win.localStorage.getItem('nota.partner.v1'), null);
});

test('a returning partner can share their verified code from the arrival door and the guide link', async () => {
  const { doc, Nota, calls } = await boot({ url: '?intro=1', seed: {
    'nota.partner.v1': CLAIMED, 'nota.role.v1': 'partner', 'nota.introSeen': '1',
  } });
  assert.equal($(doc, 'intro-gate').hidden, false, 'the review URL still opens the arrival');
  assert.equal(doc.activeElement, $(doc, 'ig-door-partner'), 'their remembered door is focused');
  assert.equal($(doc, 'ig-partner-action').textContent, 'Partager mon code');
  $(doc, 'ig-door-partner').click();
  await wait(400);
  assert.equal(Nota.state.tab, 'partenaires');
  assert.equal($(doc, 'partner-success').hidden, false);
  assert.equal($(doc, 'partner-details').open, false);
  assert.equal($(doc, 'partner-link').textContent, SITE + '/?ref=EVEROY');
  assert.equal(doc.activeElement, $(doc, 'partner-copy'));
  assert.match($(doc, 'partner-msg').textContent, /\?ref=EVEROY/);
  Nota.setTab('carnet');
  Nota.onboarding.open();
  assert.equal(Nota.state.tab, 'partenaires', 'reopening help returns to the partner’s action');
  assert.equal($(doc, 'onboarding-dialog').open, false);
  assert.equal(doc.activeElement, $(doc, 'partner-copy'));
  assert.ok(!calls.some(c => /\/partenaires(?:\/|$)/.test(c.url)), 'a return does not register the code again');
});

test('a returning partner lands on their code — never a blank claim form', async () => {
  const { doc, Nota } = await boot({ seed: { 'nota.partner.v1': CLAIMED } });
  Nota.setTab('partenaires');
  // The share box is already open, exactly as the claim left it.
  assert.equal($(doc, 'partner-success').hidden, false, 'the share box is open on arrival');
  assert.equal($(doc, 'partner-link').textContent, SITE + '/?ref=EVEROY');
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
  assert.equal($(doc, 'partner-submit').textContent.trim(), 'Recevoir mon lien d’activation →');
  assert.equal($(doc, 'partner-submit').disabled, false, 'type + courriel carry over — ready to resubmit');
});

// ---------------------------------------------------------------------------
// 3. The pane stays strict
// ---------------------------------------------------------------------------

test('the pane says one thing: two amounts and the form that gives the code', async () => {
  // Propriétaire, 2026-09-12, devant la page : « beaucoup trop de texte ».
  // Tout ce qui racontait le programme une deuxième fois est parti — le
  // sélecteur de métier du héros, l'estimateur annuel, la vignette en trois
  // temps, la bande d'étapes et la FAQ.
  const { doc } = await boot();
  const pane = doc.querySelector('#pane-partenaires');
  for (const sel of ['.pr-audience', '.pr-estimate', '.pr-vig', '.pr-steps', '.pr-faq', '.pr-pitch', '.pr-hero-cta']) {
    assert.equal(pane.querySelector(sel), null, sel + ' no longer exists on the pane');
  }
  // Le CSS part avec le balisage : pas de règle orpheline.
  for (const dead of ['pr-vignette', 'pr-scene', 'pr-w1', 'pr-aud', 'pr-moment', 'pr-estimate', 'pr-vig', 'pr-steps', 'pr-faq', 'pr-pitch', 'pr-when', 'pr-hero-cta']) {
    assert.ok(!CSS_SRC.includes('.' + dead), 'no dead CSS for .' + dead);
  }
  // Une carte = intitulé, montant, cadence. La règle d'acquisition est dite
  // UNE fois, sous la paire — elle vaut pour les deux voies.
  for (const id of ['pr-card-client', 'pr-card-notaire']) {
    const card = $(doc, id);
    assert.deepEqual([...card.children].map((c) => c.className), ['pr-kicker', 'pr-amount', 'pr-freq']);
  }
  const earned = pane.querySelector('.pr-offer .pr-earned');
  assert.ok(earned, 'the acquisition rule is stated once under the pair');
  assert.equal(pane.querySelectorAll('.pr-earned').length, 1);
  assert.ok(!/\d\s*\$/.test(earned.textContent), 'no hardcoded amount in that line');
  // La garantie reste dite UNE fois, en bas, jamais dans la promesse du héros.
  const pitch = pane.querySelector('.pr-hero-copy p').textContent;
  assert.ok(!/prix du client/.test(pitch), 'the hero pitch does not duplicate the guarantee');
  assert.equal(pane.querySelectorAll('.nota-guarantee').length, 1);
  assert.match(CSS_SRC, /\.pr-grid \.note \{[^}]*border-left:\s*0/,
    'the guarantee sheds the boxed .note chrome inside the pane');
});

test('the hero rides the site-wide drift — no private backdrop of its own', async () => {
  // Owner (2026-08-27): the hero's own clipped layer « cut rough » at the
  // band's edges. The marks now drift behind ALL content on one fixed
  // site-wide layer (#site-bg, smoke test 40b'') — never doubled, and never
  // sliced by a band boundary again.
  const { doc } = await boot();
  assert.equal(doc.querySelector('#pane-partenaires .pr-hero .mark-drift'), null,
    'one scene: no second layer clipped inside the hero');
  assert.ok($(doc, 'site-bg'), 'the site-wide layer carries this pane too');
});

test('the reward cards stay transparent and use a quiet outline', () => {
  // The reward cards remain part of the page background rather than becoming
  // two opaque slabs. A hairline groups each stat, while the notary card gets
  // the stronger brand edge.
  const block = (sel) => {
    const m = CSS_SRC.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}'));
    assert.ok(m, sel + ' rule exists');
    return m[0];
  };
  assert.ok(!/border:(?!\s*0)|border-color/.test(block('.pr-hero')), 'the hero band has no border');
  assert.match(block('.pr-card'), /background:\s*transparent/, 'a reward card does not fill its background');
  assert.match(block('.pr-card'), /border:\s*1px solid/, 'a reward card has a quiet outline');
  assert.match(block('.pr-card'), /box-shadow:\s*none/, 'a reward card does not float as a slab');
  assert.match(block('.pr-card--notaire'), /border-color:\s*var\(--brand\)/, 'the highlight uses the brand edge');
  assert.match(block('.pr-form-panel'), /border:\s*0/, 'the form strips the .panel ring and the top accent');
});

test('the hero dissolves: soft gradients, no boxed surface, no seam', () => {
  // Owner (2026-08-27): « add some gradient… no corner… smooth for the eyes ».
  // The hero stops being a rectangle on the page: no surface backing, no
  // shadow — only brand-tint glows that fade to transparent well inside the
  // band, so there is no edge for the eye to catch.
  const m = CSS_SRC.match(/\.pr-hero\s*\{[^}]*\}/);
  assert.ok(m, '.pr-hero rule exists');
  assert.match(m[0], /radial-gradient|var\(--wash-glow\)/, 'the band is painted with gradients');
  assert.ok(!/var\(--surface\)/.test(m[0]), 'no opaque surface backing — nothing to draw a seam');
  assert.ok(!/box-shadow/.test(m[0]), 'no shadow — a shadow re-draws the box');
});

test('under the hero there is the circuit, then the claim form', async () => {
  // Owner, 2026-09-12 evening: an animation « qui explique clairement comment
  // la section partenaire fonctionne ». It shows the mechanism between the
  // promise and the form — it does not RE-SAY either of them, which is what
  // the earlier three-beat strip did (and why it went).
  const { doc } = await boot();
  const bands = [...doc.querySelectorAll('#pane-partenaires .wrap > *')];
  assert.deepEqual(bands.map((e) => e.classList[0]), ['pr-hero', 'pr-flow', 'pr-grid'],
    'three regions in reading order: the promise, the circuit, the form');
  const grid = bands[2];
  assert.equal(grid.firstElementChild.id, 'partner-success', 'confirmed sharing precedes the signup');
  assert.equal(grid.firstElementChild.hidden, true, 'no empty success row before confirmation');
  const visible = [...grid.children].filter((child) => !child.hidden);
  assert.ok(visible[0].classList.contains('pr-form-panel'), 'the claim leads the grid');
  assert.deepEqual(visible.slice(1).map((e) => e.classList[0]), ['note'],
    'only the fine print follows it');
  assert.ok(!/\.pr-form-panel\s*\{[^}]*((?<!b)order:|position:\s*sticky)/.test(CSS_SRC),
    'no order swap, no sticky — the grid reads as written');
  assert.match(CSS_SRC, /\.pr-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*560px\)/,
    'one column, bounded to the measure of a form');
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

// ---------------------------------------------------------------------------
// 6. Audit 2026-09-02 — P1-3, P1-6, P1-7, P1-8, P2-14, P2-15, P2-16
// ---------------------------------------------------------------------------
// Fill and submit the claim form as a first-time partner; returns the errors text.
async function claimAs(ctx) {
  ctx.Nota.setTab('partenaires');
  ctx.doc.querySelector('#partner-type .chip').click();
  const mail = $(ctx.doc, 'partner-courriel'); mail.value = 'eve@agence.ca'; fire(ctx.win, mail, 'input');
  const code = $(ctx.doc, 'partner-code'); code.value = 'eve-roy'; fire(ctx.win, code, 'input');
  fire(ctx.win, $(ctx.doc, 'partner-form'), 'submit');
  await wait(20);
  return $(ctx.doc, 'partner-errors').textContent;
}
const claimRoute = (reply) => ({ match: (u, init) => u.endsWith('/partenaires') && init.method === 'POST', reply });

test('P1-3: the reward cards are plain stats — no pointer affordance, no hidden click door', async () => {
  const { doc } = await boot();
  assert.ok(!/\.pr-card\s*\{[^}]*cursor:\s*pointer/.test(CSS_SRC), 'a div that looks pressable but no keyboard can reach');
  assert.ok(!/\.pr-card::after/.test(CSS_SRC), 'no generated « → » door marker');
  assert.ok(!/\.pr-card:hover\s*\{[^}]*transform/.test(CSS_SRC), 'no hover lift');
  assert.ok(!/\['pr-card-client', 'pr-card-notaire'\]\.forEach/.test(APP_SRC), 'no click wiring on the cards');
  for (const id of ['pr-card-client', 'pr-card-notaire']) {
    assert.equal($(doc, id).getAttribute('role'), null, id + ' has no role');
    assert.equal($(doc, id).getAttribute('tabindex'), null, id + ' is not focusable');
  }
});

test('P1-6: the pending state says the link expires (the API’s TTL when it says so)', async () => {
  const timed = await boot({ routes: [claimRoute(() => jsonRes(200, { ok: true, ttlMinutes: 30 }))] });
  await claimAs(timed);
  assert.equal($(timed.doc, 'partner-pending').hidden, false);
  assert.match($(timed.doc, 'partner-pending').textContent, /30 minutes/, 'the API’s TTL is stated');
  const bare = await boot({ routes: [claimRoute(() => jsonRes(200, { ok: true }))] });
  await claimAs(bare);
  const t = $(bare.doc, 'partner-pending').textContent;
  assert.match(t, /expire/, 'without a figure, the copy still warns the link is short-lived: ' + t);
  assert.ok(!/\d+\s*minutes/.test(t), 'no invented number: ' + t);
});

test('P1-6: a failed boot-time verification lands on the error, not under the fold', async () => {
  const { doc, Nota } = await boot({
    url: '#pauth=EXPIRED',
    routes: [{ match: (u) => u.endsWith('/partenaires/verify'), reply: () => jsonRes(400, { errors: [{ code: 'lien_invalide', message: 'Lien invalide ou expiré.' }] }) }],
  });
  await wait(30);
  assert.equal(Nota.state.tab, 'partenaires');
  const errs = $(doc, 'partner-errors');
  assert.equal(errs.hidden, false);
  assert.match(errs.textContent, /invalide ou expiré/);
  assert.equal(doc.activeElement, errs, 'focus lands on the error list — a browser scrolls it into view, a screen reader reads it');
});

test('P1-7: the pane says notaries are excluded before anyone submits (art. 33)', async () => {
  const { doc } = await boot();
  const hero = doc.querySelector('#pane-partenaires .pr-hero');
  const line = hero.querySelector('.pr-eligibility');
  assert.ok(line, 'the caveat is in the hero');
  // 2026-09-12 — la FAQ qui reposait la question a disparu avec le reste du
  // texte : cette ligne est désormais le SEUL endroit où l'exclusion est dite,
  // et elle est dite sous la promesse, avant tout formulaire.
  assert.ok(line.closest('.pr-hero-copy'), 'it sits in the copy column');
  assert.ok(line.compareDocumentPosition(doc.querySelector('#pane-partenaires .pr-form-panel')) & 4,
    'said BEFORE the claim form');
  assert.match(line.textContent, /art\. 33/i);
  assert.match(line.textContent, /notaire/);
  assert.match(line.textContent, /Code de déontologie/);
});

test('P1-8: the share link is built on the declared public origin, and falls back to location.origin without it', async () => {
  const { doc, Nota } = await boot({ seed: { 'nota.partner.v1': CLAIMED } });
  Nota.setTab('partenaires');
  assert.notEqual(SITE, 'https://nota.example', 'the head declares a real origin');
  assert.equal($(doc, 'partner-link').textContent, SITE + '/?ref=EVEROY');
  const stripped = HTML_SRC.replace(/<meta name="nota:site"[^>]*>\s*/, '');
  assert.ok(!/nota:site/.test(stripped));
  const dom = new JSDOM(stripped, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      window.localStorage.setItem('nota.partner.v1', CLAIMED);
    },
  });
  openWindows.push(dom.window);
  dom.window.eval(DOMAIN_SRC); dom.window.eval(APP_SRC);
  await wait(60);
  dom.window.Nota.setTab('partenaires');
  assert.equal(dom.window.document.getElementById('partner-link').textContent, 'https://nota.example/?ref=EVEROY');
});

test('P2-14: a throttled claim never promises « quelques minutes » — it reads Retry-After, or says later', async () => {
  const plain = await boot({ routes: [claimRoute(() => jsonRes(429, { ok: true, throttled: true }))] });
  const t1 = await claimAs(plain);
  assert.ok(!/quelques minutes/.test(t1), 'the window is 15 minutes, not a few: ' + t1);
  assert.match(t1, /Trop de tentatives/);
  assert.match(t1, /plus tard/);
  const timed = await boot({ routes: [claimRoute(() => ({
    ...jsonRes(429, { ok: true, throttled: true }),
    headers: { get: (h) => (String(h).toLowerCase() === 'retry-after' ? '900' : null) },
  }))] });
  const t2 = await claimAs(timed);
  assert.match(t2, /15 minutes/, 'a Retry-After header is turned into minutes: ' + t2);
});

test('P2-15: the code field’s maxlength is the domain’s cap', async () => {
  const { doc, D } = await boot();
  // The longest run of letters the domain still accepts (REFERRAL_CODE_RE is
  // not exported — derived through the validator so the pin cannot drift).
  const cap = Math.max(...Array.from({ length: 64 }, (_, i) => i + 1).filter((n) => D.isReferralCode('A'.repeat(n))));
  assert.ok(cap >= 4, 'the validator accepts codes at all');
  assert.equal($(doc, 'partner-code').getAttribute('maxlength'), String(cap));
});

test('P2-16: the claim form carries the pane’s only action', async () => {
  // Le héros portait un bouton « Obtenir mon code → » qui ne faisait que
  // descendre jusqu'au formulaire. Le formulaire est maintenant juste là :
  // une seule action nommée sur toute la page.
  const { doc } = await boot();
  const pane = doc.querySelector('#pane-partenaires');
  assert.equal(pane.querySelector('.pr-hero button'), null, 'the hero proposes no button of its own');
  assert.equal($(doc, 'partner-submit').textContent.trim(), 'Recevoir mon lien d’activation →',
    'the action names the email activation step');
});

test('a confirmed claim hands the partner a ready-to-send message carrying their link', async () => {
  const { win, doc, Nota } = await boot({
    routes: claimRoutes(jsonRes(201, { partenaire: { code: 'EVEROY' } })),
  });
  Nota.setTab('partenaires');
  doc.querySelector('#partner-type .chip').click();
  const mail = $(doc, 'partner-courriel'); mail.value = 'eve@agence.ca'; fire(win, mail, 'input');
  const code = $(doc, 'partner-code'); code.value = 'EVEROY'; fire(win, code, 'input');
  fire(win, $(doc, 'partner-form'), 'submit');
  await wait(20);
  assert.equal($(doc, 'partner-success').hidden, false);
  const msg = $(doc, 'partner-msg');
  assert.ok(msg, 'a message block in the success box');
  assert.ok(msg.textContent.includes(SITE + '/?ref=EVEROY'), 'the message carries the share link');
  assert.ok(!/\d\s*\$/.test(msg.textContent), 'the client-facing message names no reward amount');
  assert.ok(/100 %/.test(msg.textContent), 'it tells the client the notary keeps the whole offer');
  assert.ok($(doc, 'partner-msg-copy'), 'a copy button for the message');
});

// The button itself confirms a copy — and ONLY a copy that happened.
function stubClipboard(win) {
  const copied = [];
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (t) => { copied.push(t); } },
  });
  return copied;
}

test('a copy that succeeds flashes « Copié ✓ » on the button, then restores its label', async () => {
  const { win, doc, Nota } = await boot({
    routes: claimRoutes(jsonRes(201, { partenaire: { code: 'EVEROY' } })),
  });
  const copied = stubClipboard(win);
  Nota.setTab('partenaires');
  doc.querySelector('#partner-type .chip').click();
  const mail = $(doc, 'partner-courriel'); mail.value = 'eve@agence.ca'; fire(win, mail, 'input');
  const code = $(doc, 'partner-code'); code.value = 'EVEROY'; fire(win, code, 'input');
  fire(win, $(doc, 'partner-form'), 'submit');
  await wait(20);
  const btn = $(doc, 'partner-msg-copy');
  const label = btn.textContent;
  btn.click();
  await wait(10);
  assert.equal(copied.length, 1, 'the message went to the clipboard');
  assert.ok(copied[0].includes(SITE + '/?ref=EVEROY'));
  assert.equal(btn.textContent, 'Copié ✓');
  assert.ok(btn.classList.contains('is-copied'));
  // The link button confirms the same way.
  $(doc, 'partner-copy').click();
  await wait(10);
  assert.equal($(doc, 'partner-copy').textContent, 'Copié ✓');
  await wait(1700);
  assert.equal(btn.textContent, label, 'the label comes back');
  assert.ok(!btn.classList.contains('is-copied'));
});

test('a copy that fails never claims success on the button', async () => {
  const { win, doc, Nota } = await boot({
    routes: claimRoutes(jsonRes(201, { partenaire: { code: 'EVEROY' } })),
  });
  // No clipboard at all (jsdom's default): the toast says so, the button stays itself.
  Nota.setTab('partenaires');
  doc.querySelector('#partner-type .chip').click();
  const mail = $(doc, 'partner-courriel'); mail.value = 'eve@agence.ca'; fire(win, mail, 'input');
  const code = $(doc, 'partner-code'); code.value = 'EVEROY'; fire(win, code, 'input');
  fire(win, $(doc, 'partner-form'), 'submit');
  await wait(20);
  const btn = $(doc, 'partner-msg-copy');
  const label = btn.textContent;
  btn.click();
  await wait(10);
  assert.equal(btn.textContent, label, 'no « Copié ✓ » without a copy');
  assert.ok(!btn.classList.contains('is-copied'));
});

// --- 2026-09-03, second pass: the hero speaks to each profession -------------
// A courtier immobilier, a courtier hypothécaire or an accountant must see in
// three seconds that the programme is for THEM and WHEN, in their own work,
// a referral happens. The audience row in the hero is the form's « Vous êtes »
// question asked early — the two stay in sync both ways.

test('the referral field is visible at conversion without opening privacy options', async () => {
  const { doc } = await boot();
  const field = $(doc, 'o-parrain');
  assert.equal(field.closest('details'), null);
  assert.equal(field.closest('[data-screen]').dataset.screen, '4');
  assert.equal($(doc, 'referral-status').hidden, true, 'no indicator without a code');
});

test('a typed referral persists before submission and survives navigation and a new visit', async () => {
  const { doc, win, Nota } = await boot();
  const field = $(doc, 'o-parrain');
  field.value = ' eve roy '; fire(win, field, 'input');
  assert.equal(win.localStorage.getItem('nota.ref.v1'), 'EVEROY');
  assert.equal($(doc, 'nc-signup-parrain').value, ' eve roy ');
  Nota.setTab('partenaires');
  assert.equal($(doc, 'referral-status').hidden, false);
  const next = await boot({ seed: { 'nota.ref.v1': win.localStorage.getItem('nota.ref.v1') } });
  assert.equal($(next.doc, 'o-parrain').value, 'EVEROY');
  assert.equal($(next.doc, 'referral-status-label').textContent, 'Code enregistré : EVEROY');
});

test('removing or replacing a code clears stale attribution from both conversion forms', async () => {
  const { doc, win } = await boot({ url: '?ref=EVEROY' });
  const signup = $(doc, 'nc-signup-parrain');
  signup.value = ' marc qc '; fire(win, signup, 'input');
  assert.equal($(doc, 'o-parrain').value, ' marc qc ');
  assert.equal(win.localStorage.getItem('nota.ref.v1'), 'MARCQC');
  assert.equal($(doc, 'referral-status-label').textContent, 'Code enregistré : MARCQC');
  const field = $(doc, 'o-parrain');
  field.value = 'x!'; fire(win, field, 'input');
  assert.equal(win.localStorage.getItem('nota.ref.v1'), null);
  assert.equal($(doc, 'referral-status').hidden, true);
  assert.equal($(doc, 'o-parrain-preview').dataset.state, 'warn');
  field.value = ''; fire(win, field, 'input');
  assert.equal(signup.value, '');
  assert.equal($(doc, 'o-parrain-preview').textContent, '');
  assert.equal(win.localStorage.getItem('nota.ref.v1'), null);
});
