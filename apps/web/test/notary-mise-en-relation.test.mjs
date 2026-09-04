/**
 * ADR 0033 — the mise en relation is complete, and the conversation is the
 * channel. The notary console's side of it:
 *
 *   1. the profile carries the notary's identity (nom, étude, téléphone,
 *      adresse), validated inline through the domain, round-tripped on save;
 *   2. an incomplete profile is said over the open feed, with a door into the
 *      form; Retenir / Proposer open the profile instead of acting, and the
 *      API's 403 profil_incomplet lands in the same place;
 *   3. Retenir is a confirm SHEET (one <dialog>, same shell as every popup)
 *      that reads back everything the notary commits to before the POST;
 *   4. the retained card leads with « Votre client » (tel:, mailto, secteur,
 *      déplacement, prêteur), and the accept keeps the client block;
 *   5. unread client messages badge the card and the heading, sort first, and
 *      are marked seen from the composer (localStorage nota.nc.seen.v1);
 *   6. cancelled acts are pruned from the local store through `fenetre`;
 *   7. the composer auto-grows, counts, sends on Enter, says « Envoi… »,
 *      shows its error inline; timestamps carry the time of day;
 *   8. « #notaires&acte=<id> » lands on the card and flashes it;
 *   9. the alert preferences are server data (POST /notary/profile alertes),
 *      and the SMS promise is gone;
 *  10. a live back-and-forth never stalls: the poll refreshes past a focused
 *      composer once 60 s have passed, keeping the draft and the focus.
 *
 * Harness mirrors notary-focus.test.mjs (jsdom outside-only, URL-routing
 * fetch stub, real sign-in path).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const DOMAIN_GRILLE = require('@nota/domain').prixNotaGrille();

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const DOMS = [];
after(() => { for (const d of DOMS) { try { d.window.close(); } catch {} } });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const firstOfMonth = (iso) => iso.slice(0, 7) + '-01';
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const $ = (doc, id) => doc.getElementById(id);
const click = (node) => node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
const input = (node, value) => { node.value = value; node.dispatchEvent(new node.ownerDocument.defaultView.Event('input', { bubbles: true })); };
const submit = (form) => form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
const key = (node, k, opts = {}) => node.dispatchEvent(new node.ownerDocument.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

async function boot({ url = 'https://nota.example/', seed = {}, pollMs = null, focusedMs = null } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      if (pollMs) window.__NOTA_POLL_MS__ = pollMs;
      if (focusedMs) window.__NOTA_POLL_FOCUSED_MS__ = focusedMs;
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, seed[k]));
    },
  });
  DOMS.push(dom);
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  const D = win.NotaDomain;
  const anchor = firstOfMonth(todayISO());
  const seedBids = D.makeFixtures(anchor);
  win.localStorage.setItem('nota.bids.v1', JSON.stringify(seedBids));
  win.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  win.eval(APP_SRC);
  await wait(50);
  return { win, doc: win.document, D, Nota: win.Nota };
}

const PROFIL_COMPLET = () => ({
  nom: 'Me Anne Roy', etude: 'Étude Roy', telephone: '418 555 0100',
  adresse: '1, rue de la Démo, Québec (QC) G1R 1A1', courriel: 'demo@etude.ca',
  lienCNQ: null, rayonKm: 25, urgences: false, prefixe: 'G1R',
  alertes: { pace: 'daily', urgentOnly: false }, complet: true, manquants: [],
});
const PROFIL_INCOMPLET = () => ({
  nom: null, etude: null, telephone: null, adresse: null, courriel: 'demo@etude.ca',
  lienCNQ: null, rayonKm: 0, urgences: false, prefixe: null,
  alertes: { pace: 'daily', urgentOnly: false }, complet: false,
  manquants: [{ id: 'nom', label: 'Votre nom' }, { id: 'telephone', label: 'Votre téléphone' }, { id: 'adresse', label: 'L’adresse de votre étude' }],
});
// ADR 0034 — le tarif servi est une GRILLE : le notaire doit voir le prix que
// le client paie POUR CETTE demande, pas une moyenne.
const GRILLE = () => {
  const g = JSON.parse(JSON.stringify(DOMAIN_GRILLE));
  return g;
};
const TARIF = () => ({
  grille: GRILLE(), prixNotaMinCents: DOMAIN_GRILLE.defaut,
  taxesIncluses: false, deboursInclus: false,
});
const CONDITIONS = () => ({
  paiement: 'signature',
  tarifNota: TARIF(),
  annulation: { paliers: [{ maxJours: 3, taux: 0.3 }, { maxJours: 14, taux: 0.1 }], beneficiaire: 'notaire' },
  desistement: { gratuit: true, compte: true },
});

function openBid(over = {}) {
  return {
    id: 'b-1', serviceId: 'refinancement', dateISO: addDays(todayISO(), 9), montant: 3000,
    tier: 'rapide', premium: 1.2, prefixe: 'G1R', ready: false, missing: ['Relevé hypothécaire'],
    proposition: null, demande: null,
    preteur: { id: 'desjardins', nom: 'Desjardins', virtuel: false },
    deplacement: { qui: 'client', km: 0, urgence: false },
    distanceKm: 4,
    complexity: { level: 'standard', score: 1, factors: [] },
    ...over,
  };
}

function retainedEntry(over = {}) {
  return {
    id: 'r-1', serviceId: 'refinancement', dateISO: addDays(todayISO(), 6), montant: 2900,
    tier: 'rapide', prefixe: 'G1V', courriel: 'client@example.ca',
    dossier: { adresse: '10 rue des Érables', __consent: true },
    client: { nom: 'Marie Roy', courriel: 'client@example.ca', telephone: '(418) 555-1234' },
    preteur: { id: 'tangerine', nom: 'Tangerine', virtuel: true },
    deplacement: { qui: 'notaire', km: 25, urgence: false },
    messages: [], documents: [], annulation: null, completed: false, viaProposition: false,
    ...over,
  };
}

// Stateful stub: the profile round-trips, a sent message lands on the thread,
// and the feed answers whatever `state` currently holds — so a second load
// observes exactly what the server would answer after a cancellation.
function stubApi(win, state) {
  const calls = [];
  state.profil = state.profil || PROFIL_COMPLET();
  state.bids = state.bids || [];
  state.retained = (state.retained || []).map((r) => ({ ...r, messages: (r.messages || []).slice() }));
  state.conditions = state.conditions === undefined ? CONDITIONS() : state.conditions;
  state.tarif = state.tarif === undefined ? TARIF() : state.tarif;
  win.fetch = (url, init = {}) => {
    const path = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || 'GET', body });
    const json = (b, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(b) });
    if (state.delayMs && path.includes('/notary/bids/message')) {
      return new Promise((resolve) => setTimeout(() => resolve(json(state.messageReply(body))), state.delayMs));
    }
    if (path.includes('/notary/session/request')) return json({ ok: true, devToken: 'chal.tok' });
    if (path.includes('/notary/session/verify')) return json({ token: 'sess.tok', feedToken: 'feed.tok', email: 'demo@etude.ca' });
    if (path.includes('/notary/profile')) {
      state.profil = { ...state.profil, ...body };
      return json({ profil: state.profil });
    }
    if (path.includes('/notary/bids/accept')) {
      if (state.gate) return json({ errors: [{ code: 'profil_incomplet', message: 'Complétez votre profil.', manquants: state.gate }] }, 403);
      const bid = state.bids.find((b) => b.id === body.id) || {};
      return json({ id: body.id, courriel: 'client@example.ca', dossier: {}, client: { nom: 'Marie Roy', courriel: 'client@example.ca', telephone: '418 555 9999' }, bid });
    }
    if (path.includes('/notary/bids/propose')) {
      if (state.gate) return json({ errors: [{ code: 'profil_incomplet', message: 'Complétez votre profil.', manquants: state.gate }] }, 403);
      return json({ proposition: { id: 'prop-1', montant: body.montant, delta: 0, message: null, status: 'en_attente', createdAt: '2026-08-12T10:00:00Z' } });
    }
    if (path.includes('/notary/bids/message')) {
      if (state.messageStatus) return json({ errors: [{ message: 'Message refusé par le serveur.' }] }, state.messageStatus);
      return json(state.messageReply(body));
    }
    if (path.includes('/notary/bids')) {
      state.feedPulls = (state.feedPulls || 0) + 1;
      const out = { bids: state.bids, retained: state.retained, profil: state.profil, rating: null, cote: null, tarif: state.tarif };
      if (state.conditions) out.conditions = state.conditions;
      if (state.fenetre) out.fenetre = state.fenetre;
      return json(out);
    }
    return Promise.reject(new Error('offline'));
  };
  state.messageReply = state.messageReply || ((body) => {
    const message = { id: 'msg-' + calls.length, de: 'notaire', texte: body.texte, createdAt: '2026-08-12T10:00:00Z' };
    const entry = state.retained.find((r) => r.id === body.id);
    if (entry) entry.messages.push(message);
    return { message };
  });
  return calls;
}

async function bootSignedIn(state = {}, bootOpts = {}) {
  const ctx = await boot(bootOpts);
  const calls = stubApi(ctx.win, state);
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  return { ...ctx, calls, state };
}

// --- 1. The profile carries the notary's identity ---------------------------

test('the profile form carries nom, étude, téléphone, adresse — prefilled, domain-validated, POSTed', async () => {
  const { doc, calls, D } = await bootSignedIn({ profil: PROFIL_COMPLET() });
  for (const [id, val] of [['nc-nom', 'Me Anne Roy'], ['nc-etude', 'Étude Roy'], ['nc-telephone', '418 555 0100'], ['nc-adresse', '1, rue de la Démo, Québec (QC) G1R 1A1']]) {
    const inp = $(doc, id);
    assert.ok(inp, id + ' must exist in #nc-profil-form');
    assert.ok($(doc, 'nc-profil-form').contains(inp), id + ' lives in the profile form');
    assert.equal(inp.value, val, id + ' prefills from the stored profile');
  }
  // A bad phone is refused by the DOMAIN before any network call, inline.
  const before = calls.filter((c) => c.path.includes('/notary/profile')).length;
  input($(doc, 'nc-telephone'), '123');
  const err = $(doc, 'nc-telephone-err');
  assert.ok(err && !err.hidden, 'the phone error shows inline as the notary types');
  assert.equal(err.textContent, D.validateTelephone('123').error.message);
  submit($(doc, 'nc-profil-form'));
  await wait(10);
  assert.equal(calls.filter((c) => c.path.includes('/notary/profile')).length, before, 'no POST with an invalid phone');
  assert.equal($(doc, 'nc-profil-errors').hidden, false, 'the submit refusal surfaces');
  // Fixed → one POST carrying the four fields, normalized.
  input($(doc, 'nc-telephone'), ' (418) 555-0101 ');
  assert.equal(err.hidden, true, 'a dialable number clears the inline error');
  input($(doc, 'nc-nom'), 'Me Anne Roy ');
  input($(doc, 'nc-etude'), 'Étude Roy & Fils');
  input($(doc, 'nc-adresse'), '2, rue Saint-Jean, Québec (QC) G1R 1N4');
  submit($(doc, 'nc-profil-form'));
  await wait(10);
  const posts = calls.filter((c) => c.path.includes('/notary/profile'));
  assert.equal(posts.length, before + 1, 'one POST per save');
  const b = posts[posts.length - 1].body;
  assert.equal(b.nom, 'Me Anne Roy');
  assert.equal(b.etude, 'Étude Roy & Fils');
  assert.equal(b.telephone, '(418) 555-0101');
  assert.equal(b.adresse, '2, rue Saint-Jean, Québec (QC) G1R 1N4');
  assert.equal($(doc, 'nc-profil-saved').hidden, false);
});

// --- 2. The incomplete profile is said, and opens the form ------------------

test('an incomplete profile shows a banner over the open feed with a door into the form; complete → no banner', async () => {
  const { doc } = await bootSignedIn({ profil: PROFIL_INCOMPLET(), bids: [openBid()] });
  const banner = $(doc, 'nc-profil-banner');
  assert.ok(banner, 'banner element missing');
  assert.equal(banner.hidden, false, 'the banner shows while the profile is incomplete');
  assert.ok(banner.compareDocumentPosition($(doc, 'notary-open-list')) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING, 'the banner sits over the open feed');
  for (const label of ['Votre nom', 'Votre téléphone', 'L’adresse de votre étude']) {
    assert.ok(banner.textContent.includes(label), 'banner names the missing field: ' + label);
  }
  const door = $(doc, 'nc-profil-door');
  assert.ok(door, 'the « Compléter mon profil » door is missing');
  click(door);
  assert.equal($(doc, 'notary-profil').open, true, 'the door opens the profile panel');
  assert.equal(doc.activeElement, $(doc, 'nc-nom'), 'focus lands on the first missing field');

  const complete = await bootSignedIn({ profil: PROFIL_COMPLET(), bids: [openBid()] });
  assert.equal($(complete.doc, 'nc-profil-banner').hidden, true, 'a complete profile shows no banner');
});

test('Retenir and Proposer while incomplete open the profile instead of acting; the API 403 lands in the same place', async () => {
  const ctx = await bootSignedIn({ profil: PROFIL_INCOMPLET(), bids: [openBid()] });
  const { doc, calls } = ctx;
  const card = doc.querySelector('#notary-open-list .nc-card[data-id="b-1"]');
  click(card.querySelector('.nc-accept'));
  await wait(10);
  assert.notEqual($(doc, 'nc-retenir-dialog').open, true, 'no confirm sheet while the profile is incomplete');
  assert.equal(calls.filter((c) => c.path.includes('/notary/bids/accept')).length, 0, 'nothing posted');
  assert.equal($(doc, 'notary-profil').open, true, 'the profile panel opened instead');
  assert.equal(doc.activeElement, $(doc, 'nc-nom'), 'focus on the first missing field');
  // Proposer un prix is gated the same way.
  $(doc, 'notary-profil').open = false;
  click(card.querySelector('.nc-propose-btn'));
  await wait(10);
  assert.equal(card.querySelector('form.nc-propose'), null, 'no proposition form while incomplete');
  assert.equal($(doc, 'notary-profil').open, true, 'the profile panel opened again');

  // The server is authoritative: a 403 profil_incomplet on accept opens the
  // profile too, and the banner names what the SERVER says is missing.
  const gated = await bootSignedIn({ profil: PROFIL_COMPLET(), bids: [openBid()], gate: [{ id: 'adresse', label: 'L’adresse de votre étude' }] });
  const c2 = gated.doc.querySelector('#notary-open-list .nc-card[data-id="b-1"]');
  click(c2.querySelector('.nc-accept'));
  await wait(10);
  assert.equal($(gated.doc, 'nc-retenir-dialog').open, true, 'complete locally → the sheet opens');
  click($(gated.doc, 'nc-retenir-go'));
  await wait(20);
  assert.equal(gated.calls.filter((c) => c.path.includes('/notary/bids/accept')).length, 1, 'the accept was attempted');
  assert.notEqual($(gated.doc, 'nc-retenir-dialog').open, true, 'the sheet closes on the refusal');
  assert.equal($(gated.doc, 'notary-profil').open, true, 'the profile opens on 403 profil_incomplet');
  assert.equal($(gated.doc, 'nc-profil-banner').hidden, false, 'the banner shows what the server wants');
  assert.match($(gated.doc, 'nc-profil-banner').textContent, /adresse de votre étude/);
  assert.equal(gated.Nota.notary.retainedFor('demo@etude.ca').length, 0, 'nothing retained locally');
});

// --- 3. Retenir is a confirm sheet -----------------------------------------

test('the Retenir sheet is a dialog on the shared shell that reads back the commitment before the POST', async () => {
  const bid = openBid();
  const { doc, calls, D, Nota } = await bootSignedIn({ profil: PROFIL_COMPLET(), bids: [bid] });
  const dlg = $(doc, 'nc-retenir-dialog');
  assert.ok(dlg && dlg.tagName === 'DIALOG', 'the sheet is a <dialog>');
  assert.equal(dlg.firstElementChild.className, 'dlg-x-form', 'first child is the shared close form');
  const card = doc.querySelector('#notary-open-list .nc-card[data-id="b-1"]');
  click(card.querySelector('.nc-accept'));
  await wait(10);
  assert.equal(dlg.open, true, 'Retenir opens the sheet');
  assert.equal(calls.filter((c) => c.path.includes('/notary/bids/accept')).length, 0, 'opening the sheet posts nothing');
  const txt = dlg.textContent;
  assert.match(txt, /Refinancement/, 'names the act');
  assert.ok(txt.includes(D.money(bid.montant)), 'the fee reads the montant');
  assert.match(txt, /versés en entier à la signature/);
  // Le prix que le CLIENT paie pour CETTE demande : la cellule de la grille
  // pour ce service et ce palier, jamais un nombre unique (ADR 0034).
  const prixClient = D.prixNota('refinancement', 'rapide', GRILLE()).totalCents / 100;
  assert.ok(txt.includes(D.money(prixClient)),
    'the client’s Nota price for THIS demand shows beside: ' + txt);
  assert.match(txt, /Desjardins/, 'names the lender');
  assert.match(txt, /Relevé hypothécaire/, 'lists what the dossier still lacks');
  assert.match(txt, /≈ 4 km/, 'shows the measured distance');
  // The barème on THIS montant: 30 % of 3000 and 10 % of 3000.
  const rows = [...dlg.querySelectorAll('#nc-retenir-bareme li')];
  assert.equal(rows.length, 3, 'two paid bands + the free one');
  assert.ok(rows[0].textContent.includes(D.money(900)), '30 % band computed on the montant: ' + rows[0].textContent);
  assert.ok(rows[1].textContent.includes(D.money(300)), '10 % band computed on the montant: ' + rows[1].textContent);
  assert.match(rows[2].textContent, /gratuit/i, 'beyond the last band the cancellation is free');
  assert.match(txt, /dédommagement/);
  assert.match(txt, /désister/);
  assert.match(txt, /conversation Nota/);
  const go = $(doc, 'nc-retenir-go');
  assert.ok(go.classList.contains('btn-primary'), 'the primary is Retenir');
  assert.ok(go.textContent.includes(D.money(bid.montant)), 'the primary reads the amount');
  // « Pas maintenant » closes without posting.
  click($(doc, 'nc-retenir-later'));
  assert.notEqual(dlg.open, true, 'Pas maintenant closes the sheet');
  assert.equal(calls.filter((c) => c.path.includes('/notary/bids/accept')).length, 0);
  // ESC closes too.
  click(card.querySelector('.nc-accept'));
  assert.equal(dlg.open, true);
  key(dlg, 'Escape');
  assert.notEqual(dlg.open, true, 'Escape closes the sheet');
  // Confirm → exactly one POST, the client block is kept on the entry.
  click(card.querySelector('.nc-accept'));
  click($(doc, 'nc-retenir-go'));
  await wait(20);
  const posts = calls.filter((c) => c.path.includes('/notary/bids/accept'));
  assert.equal(posts.length, 1, 'the confirmed click POSTs once');
  assert.deepEqual(posts[0].body, { id: bid.id, dateISO: bid.dateISO });
  assert.notEqual(dlg.open, true, 'the sheet closes after the accept');
  const entry = Nota.notary.retainedFor('demo@etude.ca').find((e) => e.id === bid.id);
  assert.ok(entry, 'the accept landed in the retained store');
  assert.equal(entry.client && entry.client.nom, 'Marie Roy', 'ncAccept keeps j.client');
  assert.equal(entry.client.telephone, '418 555 9999');
  assert.equal(entry.preteur && entry.preteur.nom, 'Desjardins', 'the lender rides the entry');
});

test('the poll pauses while the sheet is open', async () => {
  const { doc, state } = await bootSignedIn({ profil: PROFIL_COMPLET(), bids: [openBid()] }, { pollMs: 40 });
  await wait(120);
  assert.ok(state.feedPulls >= 2, 'the poll pulls on its own');
  click(doc.querySelector('#notary-open-list .nc-card .nc-accept'));
  assert.equal($(doc, 'nc-retenir-dialog').open, true);
  const at = state.feedPulls;
  await wait(150);
  assert.equal(state.feedPulls, at, 'no pull while the sheet is open');
  click($(doc, 'nc-retenir-later'));
});

// --- 4. The retained card leads with « Votre client » ----------------------

test('the retained card puts the client contact block first: tel:, mailto, secteur, déplacement, prêteur', async () => {
  const entry = retainedEntry();
  const { doc, D } = await bootSignedIn({ profil: PROFIL_COMPLET(), retained: [entry] });
  const card = doc.querySelector('#notary-retained-list .nc-card[data-id="r-1"]');
  const client = card.querySelector('.nc-client');
  assert.ok(client, 'the « Votre client » block is missing');
  const FOLLOWING = doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING;
  for (const sel of ['.nc-chat', '.nc-dossier', '.nc-complete', '.nc-release']) {
    const other = card.querySelector(sel);
    assert.ok(other, sel + ' missing');
    assert.ok(client.compareDocumentPosition(other) & FOLLOWING, 'the client block precedes ' + sel);
  }
  assert.match(client.textContent, /Marie Roy/);
  const tel = client.querySelector('a.nc-client-tel');
  assert.ok(tel, 'a tel: link');
  assert.equal(tel.getAttribute('href'), D.telHref('(418) 555-1234'));
  assert.ok(tel.querySelector('svg'), 'the phone icon rides the link');
  const mail = client.querySelector('a.nc-client-mail');
  assert.equal(mail.getAttribute('href'), 'mailto:client@example.ca');
  assert.match(client.textContent, /G1V/, 'secteur');
  assert.match(client.textContent, /Chez le client/, 'déplacement');
  assert.match(client.textContent, /Tangerine/, 'prêteur');
  assert.match(card.querySelector('.nc-release').textContent, /gratuit, mais compté à votre dossier/);
});

// --- 5. Unread ---------------------------------------------------------------

test('unread client messages badge the card and the heading, sort first, and are marked seen from the composer', async () => {
  const quiet = retainedEntry({ id: 'r-quiet', dateISO: addDays(todayISO(), 3), messages: [{ id: 'q1', de: 'notaire', texte: 'Bonjour', createdAt: '2026-08-10T09:00:00Z' }] });
  const loud = retainedEntry({ id: 'r-loud', dateISO: addDays(todayISO(), 8), messages: [
    { id: 'l1', de: 'client', texte: 'Instructions reçues.', createdAt: '2026-08-12T09:00:00Z' },
    { id: 'l2', de: 'client', texte: 'Et le relevé.', createdAt: '2026-08-12T09:30:00Z' },
  ] });
  const { win, doc } = await bootSignedIn({ profil: PROFIL_COMPLET(), retained: [quiet, loud] });
  const cards = [...doc.querySelectorAll('#notary-retained-list .nc-card')].map((c) => c.dataset.id);
  assert.deepEqual(cards, ['r-loud', 'r-quiet'], 'the card with unread messages sorts first, ahead of the sooner date');
  const badge = doc.querySelector('#notary-retained-list .nc-card[data-id="r-loud"] .nc-unread');
  assert.ok(badge, 'the unread badge is on the card head');
  assert.match(badge.textContent, /2/);
  assert.match(badge.textContent, /nouveaux/);
  assert.equal(doc.querySelector('#notary-retained-list .nc-card[data-id="r-quiet"] .nc-unread'), null, 'a read thread carries no badge');
  const head = $(doc, 'notary-retained-h');
  assert.ok(head, 'the « Dossiers retenus » heading needs an id');
  assert.match(head.textContent, /Dossiers retenus/);
  assert.ok(head.querySelector('.nc-unread'), 'the heading carries the unread count');
  assert.match(head.querySelector('.nc-unread').textContent, /2/);
  // Focusing the composer marks the thread seen.
  const ta = doc.querySelector('#notary-retained-list .nc-card[data-id="r-loud"] .chat-input');
  ta.focus();
  await wait(5);
  const seen = JSON.parse(win.localStorage.getItem('nota.nc.seen.v1') || '{}');
  assert.equal(seen['r-loud'], '2026-08-12T09:30:00Z', 'nota.nc.seen.v1 records the last client message');
  assert.equal(doc.querySelector('#notary-retained-list .nc-card[data-id="r-loud"] .nc-unread'), null, 'the badge clears in place');
  assert.equal(head.querySelector('.nc-unread'), null, 'the heading count clears');
  assert.equal(doc.activeElement, ta, 'marking seen never steals the focus');
});

// --- 6. Prune cancelled acts -------------------------------------------------

test('a retained act the server stopped returning inside `fenetre` is pruned, with one toast', async () => {
  const inWindow = retainedEntry({ id: 'r-gone', dateISO: addDays(todayISO(), 6) });
  const keep = retainedEntry({ id: 'r-keep', dateISO: addDays(todayISO(), 7) });
  const month = inWindow.dateISO.slice(0, 7);
  const state = { profil: PROFIL_COMPLET(), retained: [inWindow, keep], fenetre: [month] };
  const { doc, Nota } = await bootSignedIn(state);
  assert.equal(Nota.notary.retainedFor('demo@etude.ca').length, 2);
  // A local entry from a month OUTSIDE the window (older console cache) must
  // survive: the server said nothing about it.
  const farMonth = addDays(todayISO(), 120);
  const store = JSON.parse(doc.defaultView.localStorage.getItem('nota.notary.retained.v1'));
  store['demo@etude.ca'].push(retainedEntry({ id: 'r-far', dateISO: farMonth }));
  doc.defaultView.localStorage.setItem('nota.notary.retained.v1', JSON.stringify(store));
  // The client cancelled r-gone: the server no longer returns it.
  state.retained = state.retained.filter((r) => r.id !== 'r-gone');
  await Nota.notary.loadBids();
  await wait(10);
  // Array.from: the store lives in the jsdom realm (another Array prototype).
  const ids = Array.from(Nota.notary.retainedFor('demo@etude.ca'), (e) => e.id).sort();
  assert.deepEqual(ids, ['r-far', 'r-keep'], 'the cancelled act is gone, the others stay');
  assert.equal(doc.querySelector('#notary-retained-list .nc-card[data-id="r-gone"]'), null, 'and its card with it');
  assert.match($(doc, 'toast').textContent, /annulé/, 'one toast says the client cancelled');
});

// --- 7. The composer ---------------------------------------------------------

test('the composer auto-grows, counts past 400, sends on Enter (Shift+Enter breaks), and says Envoi… while sending', async () => {
  const state = { profil: PROFIL_COMPLET(), retained: [retainedEntry({ messages: [{ id: 'm1', de: 'client', texte: 'Bonjour', createdAt: '2026-08-12T09:05:00Z' }] })], delayMs: 60 };
  const { doc, calls } = await bootSignedIn(state);
  const card = doc.querySelector('#notary-retained-list .nc-card[data-id="r-1"]');
  const ta = card.querySelector('.chat-input');
  assert.equal(ta.rows, 1, 'one line to start — it grows with the text');
  assert.equal(ta.maxLength, 500);
  // The shared composer (client side, `chatComposer`) or the console's own
  // fallback — either way a counter and an inline error exist.
  const count = card.querySelector('.chat-count, .nc-chat-count');
  assert.ok(count, 'the counter element exists');
  assert.equal(count.hidden, true, 'hidden under 400');
  input(ta, 'a'.repeat(450));
  assert.equal(count.hidden, false, 'shown at 400+');
  assert.match(count.textContent, /450\s*\/\s*500/);
  // The time of day rides the timestamp.
  assert.match(card.querySelector('.chat-when').textContent, /\d{1,2}:\d{2}/, 'timestamps carry the time');
  // Shift+Enter is a newline, not a send.
  input(ta, 'Parfait,');
  key(ta, 'Enter', { shiftKey: true });
  await wait(5);
  assert.equal(calls.filter((c) => c.path.includes('/notary/bids/message')).length, 0, 'Shift+Enter never sends');
  // Enter sends: the button says Envoi… and is disabled until the answer.
  input(ta, 'Parfait, merci !');
  key(ta, 'Enter');
  await wait(5);
  const send = card.querySelector('.nc-chat-send');
  assert.equal(send.disabled, true, 'disabled while sending');
  assert.match(send.textContent, /Envoi…/);
  await wait(120);
  const sent = calls.filter((c) => c.path.includes('/notary/bids/message'));
  assert.equal(sent.length, 1, 'Enter sends once');
  assert.equal(sent[0].body.texte, 'Parfait, merci !');
  assert.ok([...doc.querySelectorAll('#notary-retained-list .chat-bubble')].some((b) => /Parfait, merci/.test(b.textContent)), 'the thread shows the sent message');
});

test('a refused message shows its error inline, not only as a toast', async () => {
  const state = { profil: PROFIL_COMPLET(), retained: [retainedEntry()], messageStatus: 422 };
  const { doc } = await bootSignedIn(state);
  const card = doc.querySelector('#notary-retained-list .nc-card[data-id="r-1"]');
  input(card.querySelector('.chat-input'), 'Bonjour');
  click(card.querySelector('.nc-chat-send'));
  await wait(20);
  const err = card.querySelector('.chat-error, .nc-chat-err');
  assert.ok(err && !err.hidden, 'the error renders inline in the composer');
  assert.match(err.textContent, /refusé/);
  assert.equal(card.querySelector('.nc-chat-send').disabled, false, 'the button re-arms');
  assert.equal(card.querySelector('.chat-input').value, 'Bonjour', 'the draft is kept for a retry');
});

// --- 8. Deep link ------------------------------------------------------------

test('#notaires&acte=<id> lands on the notary tab, scrolls to the card and flashes it', async () => {
  const entry = retainedEntry({ id: 'r-deep' });
  const ctx = await boot({
    url: 'https://nota.example/#notaires&acte=r-deep',
    seed: { 'nota.notary.token': JSON.stringify('sess.tok'), 'nota.notary.email': JSON.stringify('demo@etude.ca') },
  });
  // The restored session's first load runs at boot with the offline stub; the
  // deep link waits for a successful load, so stub then reload.
  stubApi(ctx.win, { profil: PROFIL_COMPLET(), retained: [entry] });
  await ctx.Nota.notary.loadBids();
  await wait(30);
  assert.equal(ctx.Nota.state.tab, 'notaires', 'the link opens the notary pane');
  const card = ctx.doc.querySelector('#notary-retained-list .nc-card[data-id="r-deep"]');
  assert.ok(card, 'the card renders');
  assert.ok(card.classList.contains('is-flash'), 'the card is flashed');
  assert.ok(!/acte=/.test(ctx.win.location.hash), 'the acte parameter is consumed from the URL');
  assert.match(CSS_SRC, /\.nc-card\.is-flash/, 'the flash has a stylesheet rule');
});

// --- 9. Alert preferences are server data; no SMS promise --------------------

test('the alert preferences render from profil.alertes and POST through /notary/profile; the SMS toggle and phone row are gone', async () => {
  const profil = PROFIL_COMPLET(); profil.alertes = { pace: 'weekly', urgentOnly: true };
  const { doc, calls } = await bootSignedIn({ profil, bids: [openBid()] });
  assert.equal($(doc, 'pref-ch-sms'), null, 'no SMS toggle — nothing sends texts');
  assert.equal($(doc, 'pref-phone'), null, 'no SMS phone row');
  assert.equal($(doc, 'pref-ch-email'), null, 'no dead email toggle either');
  assert.equal($(doc, 'pref-svc'), null, 'the per-service filter nothing read is gone');
  assert.ok(!/texto|SMS/i.test($(doc, 'notary-prefs').textContent), 'the block promises no SMS');
  const on = doc.querySelector('#pref-pace .seg-btn.is-on');
  assert.equal(on.dataset.pace, 'weekly', 'the seg reflects the server pace');
  assert.equal($(doc, 'pref-urgent').checked, true, 'the urgent switch reflects the server');
  assert.ok(doc.querySelector('#pref-pace .seg-btn[data-pace="off"]'), 'an « off » pace exists');
  const before = calls.filter((c) => c.path.includes('/notary/profile')).length;
  click(doc.querySelector('#pref-pace .seg-btn[data-pace="instant"]'));
  await wait(10);
  let posts = calls.filter((c) => c.path.includes('/notary/profile'));
  assert.equal(posts.length, before + 1, 'a pace click POSTs the profile');
  assert.deepEqual(posts[posts.length - 1].body.alertes, { pace: 'instant', urgentOnly: true });
  assert.equal(posts[posts.length - 1].body.nom, 'Me Anne Roy', 'the rest of the profile rides along, never blanked');
  $(doc, 'pref-urgent').checked = false;
  $(doc, 'pref-urgent').dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  await wait(10);
  posts = calls.filter((c) => c.path.includes('/notary/profile'));
  assert.deepEqual(posts[posts.length - 1].body.alertes, { pace: 'instant', urgentOnly: false });
  assert.equal($(doc, 'notary-prefs-saved').hidden, false, 'the saved note confirms');
  // The lender roster stays (it IS wired: it filters the feed).
  assert.ok($(doc, 'pref-lenders'), 'the lender roster stays');
});

// --- 10. The poll past a focused composer --------------------------------------

test('a focused composer pauses the poll only for a while: after the grace the feed refreshes and the draft + focus survive', async () => {
  const state = { profil: PROFIL_COMPLET(), retained: [retainedEntry()] };
  const { doc } = await bootSignedIn(state, { pollMs: 30, focusedMs: 120 });
  const ta = () => doc.querySelector('#notary-retained-list .nc-card[data-id="r-1"] .chat-input');
  ta().focus();
  input(ta(), 'brouillon en cours');
  const at = state.feedPulls;
  await wait(70);
  assert.equal(state.feedPulls, at, 'right after focusing, the poll waits');
  // Meanwhile the client writes.
  state.retained[0].messages.push({ id: 'c9', de: 'client', texte: 'Nouvelle question', createdAt: '2026-08-12T11:00:00Z' });
  await wait(220);
  assert.ok(state.feedPulls > at, 'past the grace the poll refreshes even with the composer focused');
  assert.ok([...doc.querySelectorAll('#notary-retained-list .chat-bubble')].some((b) => /Nouvelle question/.test(b.textContent)), 'the client’s message arrived');
  assert.equal(ta().value, 'brouillon en cours', 'the draft survived the re-render');
  assert.equal(doc.activeElement, ta(), 'the focus survived the re-render');
});
