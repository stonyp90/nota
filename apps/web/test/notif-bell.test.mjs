/**
 * The in-app bell: complete + honest preferences, and the two missing
 * lifecycle events (acte signé, notary release).
 *
 *   1. EVERY notification kind addNotif() can ring has a declared default and
 *      its own toggle in the profile's Notifications card — including the two
 *      new kinds (acte, released). The card's copy is honest: the switches
 *      govern the in-app bell only; emails are transactional (unsubscribe
 *      link). Both languages carry the copy.
 *   2. « Acte signé — évaluez votre notaire » rings when GET /client/bid says
 *      acte.complete and no evaluation exists yet — even past the signing
 *      date (the settlement lands after the day). An existing evaluation
 *      retires the invite and stops the polling.
 *   3. A notary release (previous snapshot retained → now open again) rings
 *      « désisté », retires the stale « retenu » entry, and un-retains the
 *      device's offer. A cancellation is NOT a release.
 *   4. Bell invariants hold: anonymous suppression, the 40-entry cap.
 *
 * Boot harness mirrors account-optin.test.mjs (domain then app inside jsdom,
 * fetch stub keyed by URL, calls logged).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

// The i18n engine, evaluated like i18n.test.mjs does (UMD as plain script).
const I18N = (() => {
  const src = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }; // LOCAL date, like app.js
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});

async function boot({ seed = {}, routes = [] } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {} };
        calls.push(call);
        const r = routes.find((x) => x.match(call.url, call.init));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
      window.scrollTo = () => {};
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, JSON.stringify(seed[k])));
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, calls };
}

const notifs = (win) => JSON.parse(win.localStorage.getItem('nota.notifs.v1') || '[]');
const byKey = (win, key) => notifs(win).find((n) => n.key === key);

// A month route (empty carnet) + one /client/bid status route — the two
// fetches computeNotifications makes for a tokened offer.
function statusRoutes(status) {
  return [
    { match: (u, i) => u.includes('/bids?month=') && (!i.method || i.method === 'GET'), reply: () => jsonRes(200, { bids: [] }) },
    { match: (u) => u.includes('/client/bid?id='), reply: () => jsonRes(200, status) },
  ];
}

// One tokened offer of this browser, 2 days out unless shifted.
function myOffer(over = {}) {
  return Object.assign({
    id: 'b1', dateISO: addDays(todayISO(), 2), serviceId: 'refinancement',
    montant: 2000, clientToken: 'tok-b1',
  }, over);
}

// A full /client/bid body with overridable pieces.
function bidStatus(over = {}) {
  return Object.assign({
    bid: Object.assign({ id: 'b1', status: 'retenue', etude: 'Étude Tremblay', montant: 2000 }, over.bid || {}),
    notaire: null, propositions: [], demandes: [], readiness: null, messages: [],
    acte: { complete: false }, evaluation: null,
  }, over.body || {});
}

// The Notifications card in the profile, found by its title.
function notifCard(doc) {
  return [...doc.querySelectorAll('#profil-body .profil-card')].find(
    (c) => c.querySelector('.profil-card-title')?.textContent === 'Notifications'
  );
}

const HONEST_COPY = 'Ces réglages contrôlent la cloche dans l’application ; les courriels sont gérés par le lien de désabonnement de chaque courriel.';

// ---------------------------------------------------------------------------
// 1. Complete + honest preferences
// ---------------------------------------------------------------------------

test('every kind addNotif() rings has a toggle in the profile card, on by default', async () => {
  // The kinds the code actually uses — read from the source, so a new call
  // site cannot ship without its declared default + toggle.
  const usedKinds = [...new Set([...APP_SRC.matchAll(/addNotif\(\{[^}]*?kind: '([a-z]+)'/gs)].map((m) => m[1]))];
  assert.ok(usedKinds.length >= 9, 'the scan sees the call sites: ' + usedKinds.join(', '));
  for (const k of ['published', 'reminders', 'retained', 'proposition', 'documents', 'message', 'cancelled', 'acte', 'released']) {
    assert.ok(usedKinds.includes(k), `kind "${k}" is exercised by a call site`);
  }

  const { doc, Nota } = await boot();
  Nota.setTab('profil');
  const card = notifCard(doc);
  assert.ok(card, 'the Notifications card renders');
  for (const k of usedKinds) {
    const cb = $(doc, 'p-notif-' + k);
    assert.ok(cb, `a toggle exists for kind "${k}"`);
    assert.equal(cb.checked, true, `kind "${k}" is on by default`);
    assert.equal(cb.getAttribute('role'), 'switch');
  }
});

test('the card copy is honest: in-app bell only, emails via the unsubscribe link', async () => {
  const { doc, Nota } = await boot();
  Nota.setTab('profil');
  const help = notifCard(doc).querySelector('.help');
  assert.equal(help.textContent, HONEST_COPY);
  assert.ok(!/Par courriel et dans l’application/.test(notifCard(doc).textContent),
    'the false « by email and in the app » claim is gone');
});

test('the new copy and labels read in English too', () => {
  I18N.force('en');
  const strings = [
    HONEST_COPY,
    'Propositions de prix des notaires',
    'Demandes de documents du notaire',
    'Messages de votre notaire',
    'Confirmation d’annulation d’une offre',
    'Acte signé — invitation à évaluer',
    'Avis si le notaire se désiste',
    'Acte signé — évaluez votre notaire',
    'Le notaire s’est désisté — votre demande est de retour au carnet',
  ];
  for (const s of strings) {
    assert.ok(I18N.covered(s), `no English entry for: ${s}`);
    assert.notEqual(I18N.tEn(s), s, `translation is not the identity: ${s}`);
  }
  assert.equal(I18N.tEn(HONEST_COPY),
    'These settings control the in-app bell; emails are managed through the unsubscribe link in each email.');
  I18N.force('fr');
});

test('a toggle persists its choice and silences that kind', async () => {
  const off = { notifs: { acte: false } };
  // Flip in the UI: the profile stores it.
  const a = await boot();
  a.Nota.setTab('profil');
  const cb = $(a.doc, 'p-notif-acte');
  cb.checked = false; cb.dispatchEvent(new a.win.Event('change', { bubbles: true }));
  assert.equal(JSON.parse(a.win.localStorage.getItem('nota.profile.v1')).notifs.acte, false);

  // Silenced: an act completion never rings a disabled kind.
  const b = await boot({
    seed: { 'nota.myoffers.v1': [myOffer()], 'nota.profile.v1': off },
    routes: statusRoutes(bidStatus({ body: { acte: { complete: true } } })),
  });
  assert.equal(byKey(b.win, 'acte:b1'), undefined, 'the acte kind was toggled off');
});

// ---------------------------------------------------------------------------
// 2. « Acte signé » — the evaluation invite
// ---------------------------------------------------------------------------

test('acte.complete without an evaluation rings « Acte signé — évaluez votre notaire »', async () => {
  const { win, doc } = await boot({
    seed: { 'nota.myoffers.v1': [myOffer()] },
    routes: statusRoutes(bidStatus({ body: { acte: { complete: true } } })),
  });
  const n = byKey(win, 'acte:b1');
  assert.ok(n, 'the invite rings');
  assert.equal(n.title, 'Acte signé — évaluez votre notaire');
  assert.equal(n.read, false);
  // Anonymous suppression still holds: no courriel on this device → no badge.
  assert.equal($(doc, 'notif-badge').hidden, true, 'anonymous visitors see no badge');
});

test('an existing evaluation adds no invite and retires a stale one', async () => {
  const { win } = await boot({
    seed: {
      'nota.myoffers.v1': [myOffer()],
      'nota.notifs.v1': [{ key: 'acte:b1', title: 'Acte signé — évaluez votre notaire', body: '', dateISO: null, read: false }],
    },
    routes: statusRoutes(bidStatus({ body: { acte: { complete: true }, evaluation: { note: 5, commentaire: null } } })),
  });
  const all = notifs(win).filter((n) => n.key === 'acte:b1');
  assert.equal(all.length, 1, 'no duplicate');
  assert.equal(all[0].read, true, 'the stale invite is retired (read)');
});

test('a retained act past its date is still polled until the evaluation is on file', async () => {
  const past = myOffer({ dateISO: addDays(todayISO(), -3), retained: true, etude: 'Étude Tremblay' });
  const { win, calls } = await boot({
    seed: { 'nota.myoffers.v1': [past] },
    routes: statusRoutes(bidStatus({ body: { acte: { complete: true } } })),
  });
  assert.ok(calls.some((c) => c.url.includes('/client/bid?id=b1')), 'the past-date offer was polled');
  assert.ok(byKey(win, 'acte:b1'), 'the invite reaches the bell without opening Mes offres');

  // Once the evaluation is cached, the polling stops.
  const done = await boot({
    seed: {
      'nota.myoffers.v1': [past],
      'nota.offerstatus.v1': { b1: { bid: { id: 'b1', status: 'retenue' }, notaire: null, propositions: [], demandes: [], readiness: null, messages: [], acte: { complete: true }, evaluation: { note: 5 }, fetchedAt: 1 } },
    },
    routes: statusRoutes(bidStatus()),
  });
  assert.ok(!done.calls.some((c) => c.url.includes('/client/bid?id=b1')), 'an evaluated act is no longer polled');
});

// ---------------------------------------------------------------------------
// 3. Release detection — retained → open again
// ---------------------------------------------------------------------------

const RETAINED_SNAPSHOT = {
  b1: {
    bid: { id: 'b1', status: 'retenue', etude: 'Étude Tremblay', montant: 2000 },
    notaire: { etude: 'Étude Tremblay', courriel: 'n@x.ca' },
    propositions: [], demandes: [], readiness: null, messages: [],
    acte: { complete: false }, evaluation: null, fetchedAt: 1111,
  },
};

test('retained → open rings « désisté », retires the retenu entry, un-retains the offer', async () => {
  const { win, doc } = await boot({
    seed: {
      'nota.profile.v1': { courriel: 'client@exemple.ca' },
      'nota.myoffers.v1': [myOffer({ retained: true, etude: 'Étude Tremblay' })],
      'nota.offerstatus.v1': RETAINED_SNAPSHOT,
      'nota.notifs.v1': [{ key: 'retained:b1', title: 'Un notaire a retenu votre demande 🎉', body: '', dateISO: null, read: false }],
    },
    routes: statusRoutes(bidStatus({ bid: { status: 'ouverte', etude: null } })),
  });
  const rel = byKey(win, 'released:b1:1111');
  assert.ok(rel, 'the release rings, keyed by the previous snapshot');
  assert.equal(rel.title, 'Le notaire s’est désisté — votre demande est de retour au carnet');
  assert.equal(rel.read, false);
  assert.equal(rel.dateISO, myOffer().dateISO, 'clicking it opens the day — the offer is back there');
  assert.equal(byKey(win, 'retained:b1').read, true, 'the stale « retenu » entry is retired');
  const o = JSON.parse(win.localStorage.getItem('nota.myoffers.v1'))[0];
  assert.equal(o.retained, false, 'the device stops claiming the offer is retained');
  assert.equal(o.etude, undefined, 'the étude is gone with the retention');
  // With a signed-in client, the badge counts the one unread release.
  const badge = $(doc, 'notif-badge');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '1');
});

test('a second poll after the release does not ring again', async () => {
  // After the transition the stored snapshot is « ouverte » — polling again
  // finds no retained→open edge, and the same key would dedupe anyway.
  const { win, Nota } = await boot({
    seed: {
      'nota.myoffers.v1': [myOffer({ retained: true, etude: 'Étude Tremblay' })],
      'nota.offerstatus.v1': RETAINED_SNAPSHOT,
    },
    routes: statusRoutes(bidStatus({ bid: { status: 'ouverte', etude: null } })),
  });
  assert.equal(notifs(win).filter((n) => n.key.startsWith('released:b1')).length, 1);
  Nota.state.tab = 'carnet';
  win.dispatchEvent(new win.Event('focus'));
  await wait(60);
  assert.equal(notifs(win).filter((n) => n.key.startsWith('released:b1')).length, 1, 'still exactly one');
});

test('a cancellation is not a release: no « désisté » on retained → annulée', async () => {
  const { win } = await boot({
    seed: {
      'nota.myoffers.v1': [myOffer({ retained: true, etude: 'Étude Tremblay' })],
      'nota.offerstatus.v1': RETAINED_SNAPSHOT,
    },
    routes: statusRoutes(bidStatus({ bid: { status: 'annulee', etude: null } })),
  });
  assert.equal(notifs(win).filter((n) => n.key.startsWith('released:')).length, 0);
  const o = JSON.parse(win.localStorage.getItem('nota.myoffers.v1'))[0];
  assert.equal(o.cancelled, true, 'the cancellation is what the device records');
});

// ---------------------------------------------------------------------------
// 4. Bell invariants
// ---------------------------------------------------------------------------

test('the 40-entry cap holds when a new kind rings', async () => {
  const old = Array.from({ length: 40 }, (_, i) => ({
    key: 'old:' + i, title: 'Ancienne ' + i, body: '', dateISO: null, read: true,
  }));
  const { win } = await boot({
    seed: { 'nota.myoffers.v1': [myOffer()], 'nota.notifs.v1': old },
    routes: statusRoutes(bidStatus({ body: { acte: { complete: true } } })),
  });
  const a = notifs(win);
  assert.equal(a.length, 40, 'capped at 40');
  assert.equal(a[0].key, 'acte:b1', 'newest first — the invite made it in');
});
