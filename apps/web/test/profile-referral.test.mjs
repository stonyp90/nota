/**
 * Parrainage in the client profile (ADR 0011, follow-up):
 *
 *   1. A successful claim on the Partenaires pane PERSISTS the partner record
 *      (nota.partner.v1) — closing the tab no longer loses the code. Both the
 *      201 (created) and the owner's idempotent 200 persist.
 *   2. The profile grows a « Parrainage » card, after « Mes documents » —
 *      code shown prominently, the ?ref= share link, a working copy button.
 *   3. The reward amounts on the card come from the DOMAIN (D.REFERRAL via
 *      D.money), never hardcoded — same figures the Partenaires pane shows.
 *   4. No claimed code yet: the card pitches the program (both amounts) and
 *      its CTA routes to the Partenaires pane.
 *
 * Boot harness mirrors partners-referral.test.mjs (domain then app inside
 * jsdom, fetch stub keyed by URL), plus a clipboard capture stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});

async function boot({ seed = {}, routes = [] } = {}) {
  const copied = [];
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
      // Clipboard capture — jsdom ships none; the app must reach it through
      // navigator.clipboard.writeText like a real browser.
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } },
      });
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, seed[k]));
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, copied };
}

function fire(win, elmt, type) {
  elmt.dispatchEvent(new win.Event(type, { bubbles: true }));
}

// Drives the Partenaires claim form to a submit (first category chip,
// courriel, code) — shared by both persistence tests.
async function claim({ win, doc, Nota }, code) {
  Nota.setTab('partenaires');
  doc.querySelector('#partner-type .chip').click();
  const mail = $(doc, 'partner-courriel'); mail.value = 'eve@agence.ca'; fire(win, mail, 'input');
  const inp = $(doc, 'partner-code'); inp.value = code; fire(win, inp, 'input');
  fire(win, $(doc, 'partner-form'), 'submit');
  await wait(20);
}

// The Parrainage card, found by its title — the DOM contract is the card's
// content, not a specific id.
function parrCard(doc) {
  return [...doc.querySelectorAll('#profil-body .profil-card')].find(
    (c) => c.querySelector('.profil-card-title')?.textContent === 'Parrainage'
  );
}

const REC = JSON.stringify({
  code: 'EVEROY', type: 'agent_immobilier', courriel: 'eve@agence.ca',
  createdAt: '2026-08-01T12:00:00.000Z',
});

// ---------------------------------------------------------------------------
// 1. The claim persists nota.partner.v1
// ---------------------------------------------------------------------------

test('a verified claim persists the partner record in nota.partner.v1', async () => {
  // Email-verified (ADR 0011): POST only pends (200 + dev echo); the confirmed
  // record comes back from /partenaires/verify, and only THEN is it persisted.
  const ctx = await boot({
    routes: [
      {
        match: (u, init) => u.endsWith('/partenaires') && init.method === 'POST',
        reply: () => jsonRes(200, { ok: true, devToken: 'DEV' }),
      },
      {
        match: (u) => u.endsWith('/partenaires/verify'),
        reply: () => jsonRes(201, {
          partenaire: { code: 'EVEROY', type: 'agent_immobilier', courriel: 'eve@agence.ca', createdAt: '2026-08-26T09:00:00.000Z' },
        }),
      },
    ],
  });
  await claim(ctx, 'eve-roy');
  const rec = JSON.parse(ctx.win.localStorage.getItem('nota.partner.v1'));
  assert.ok(rec, 'the record survives the tab');
  assert.equal(rec.code, 'EVEROY');
  assert.equal(rec.type, 'agent_immobilier');
  assert.equal(rec.courriel, 'eve@agence.ca');
  assert.equal(rec.createdAt, '2026-08-26T09:00:00.000Z');
});

test('the owner\'s idempotent re-request (confirmed) persists too, from the API record', async () => {
  const ctx = await boot({
    routes: [{
      match: (u, init) => u.endsWith('/partenaires') && init.method === 'POST',
      reply: () => jsonRes(200, {
        confirmed: true,
        partenaire: { code: 'EVEROY', type: 'courtier_hypothecaire', courriel: 'eve@agence.ca', createdAt: '2026-07-01T08:00:00.000Z' },
      }),
    }],
  });
  await claim(ctx, 'everoy');
  const rec = JSON.parse(ctx.win.localStorage.getItem('nota.partner.v1'));
  assert.equal(rec.code, 'EVEROY');
  assert.equal(rec.createdAt, '2026-07-01T08:00:00.000Z', 'what is on file wins over the resubmit');
});

test('a pending claim persists nothing until it is confirmed', async () => {
  // Production shape: POST pends with no dev echo, so nothing is stored yet.
  const ctx = await boot({
    routes: [{
      match: (u, init) => u.endsWith('/partenaires') && init.method === 'POST',
      reply: () => jsonRes(200, { ok: true }),
    }],
  });
  await claim(ctx, 'eve-roy');
  assert.equal(ctx.win.localStorage.getItem('nota.partner.v1'), null, 'an unconfirmed claim is never persisted');
});

test('a failed claim persists nothing', async () => {
  const ctx = await boot({
    routes: [{
      match: (u, init) => u.endsWith('/partenaires') && init.method === 'POST',
      reply: () => jsonRes(409, { errors: [{ code: 'code_deja_pris', message: 'Code déjà pris.' }] }),
    }],
  });
  await claim(ctx, 'everoy');
  assert.equal(ctx.win.localStorage.getItem('nota.partner.v1'), null);
});

// ---------------------------------------------------------------------------
// 2. The Parrainage card with a claimed code
// ---------------------------------------------------------------------------

test('the profile shows the Parrainage card after Mes documents, with code and share link', async () => {
  const { doc, Nota } = await boot({ seed: { 'nota.partner.v1': REC } });
  Nota.setTab('profil');
  const card = parrCard(doc);
  assert.ok(card, 'a Parrainage card renders in the profile');
  // Placement: the referral card closes the profile, after « Mes documents ».
  const titles = [...doc.querySelectorAll('#profil-body .profil-card .profil-card-title')].map((t) => t.textContent);
  assert.ok(titles.indexOf('Mes documents') >= 0, 'the documents card is still there');
  assert.ok(titles.indexOf('Parrainage') > titles.indexOf('Mes documents'), 'Parrainage comes after Mes documents');
  // The code is shown prominently, and the link is the real share link.
  assert.match(card.textContent, /EVEROY/);
  const link = card.querySelector('code');
  assert.ok(link, 'the share link renders as code, like the Partenaires pane');
  assert.equal(link.textContent, 'https://nota.example/?ref=EVEROY');
  // The email-driven program is stated — there is deliberately no dashboard.
  assert.match(card.textContent, /courriel/);
});

test('the copy button writes the share link to the clipboard', async () => {
  const { doc, Nota, copied } = await boot({ seed: { 'nota.partner.v1': REC } });
  Nota.setTab('profil');
  const card = parrCard(doc);
  const copy = [...card.querySelectorAll('button')].find((b) => /Copier/.test(b.textContent));
  assert.ok(copy, 'a copy button sits beside the link');
  copy.click();
  await wait(10);
  assert.deepEqual(copied, ['https://nota.example/?ref=EVEROY']);
});

test('the reward amounts on the card are the domain\'s, via D.money', async () => {
  const { doc, Nota, D } = await boot({ seed: { 'nota.partner.v1': REC } });
  Nota.setTab('profil');
  const txt = parrCard(doc).textContent;
  assert.ok(txt.includes(D.money(D.REFERRAL.client)), 'client reward from the domain');
  assert.ok(txt.includes(D.money(D.REFERRAL.notaire)), 'notary reward from the domain');
});

// ---------------------------------------------------------------------------
// 3. No claimed code: the pitch and the door to the Partenaires pane
// ---------------------------------------------------------------------------

test('with no claimed code the card pitches both amounts and routes to Partenaires', async () => {
  const { doc, Nota, D } = await boot();
  Nota.setTab('profil');
  const card = parrCard(doc);
  assert.ok(card, 'the card renders even before a claim');
  const txt = card.textContent;
  assert.ok(txt.includes(D.money(D.REFERRAL.client)), 'the pitch carries the client reward');
  assert.ok(txt.includes(D.money(D.REFERRAL.notaire)), 'and the notary reward');
  assert.ok(!card.querySelector('code'), 'no share link to show yet');
  const cta = card.querySelector('button');
  assert.ok(cta, 'one CTA');
  cta.click();
  assert.equal(Nota.state.tab, 'partenaires', 'the CTA opens the Partenaires pane');
  assert.equal($(doc, 'pane-partenaires').hidden, false);
});

// ---------------------------------------------------------------------------
// 4. A corrupt record degrades to the pitch, never a broken card
// ---------------------------------------------------------------------------

test('a corrupt nota.partner.v1 falls back to the no-code state', async () => {
  const { doc, Nota } = await boot({ seed: { 'nota.partner.v1': '{"code":"a!"}' } });
  Nota.setTab('profil');
  const card = parrCard(doc);
  assert.ok(card);
  assert.ok(!card.querySelector('code'), 'an invalid code is never rendered as a link');
});
