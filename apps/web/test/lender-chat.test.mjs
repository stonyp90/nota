/**
 * The lender axis + the retained-act conversation, in the DOM:
 *   • the booking flow asks the lender as a required <select> (domain ui hint),
 *     and answering a priced lender moves the live floor;
 *   • a notary's open card names the bid's lender and flags a virtual one;
 *   • the préférences lender roster is a standing refusal — unchecking a
 *     lender hides its demands from the open feed;
 *   • the retained card carries the conversation (thread + send) and the
 *     armed withdrawal (désistement) that returns the act to the market;
 *   • the client's Mes offres shows the same thread once their offer is
 *     retained, with its own send box.
 *
 * Boot mirrors notary-focus.test.mjs: jsdom outside-only, domain then app,
 * offline store seeded deterministically, URL-routing fetch stub.
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
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const firstOfMonth = (iso) => iso.slice(0, 7) + '-01';
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

async function boot() {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  const D = win.NotaDomain;
  const anchor = firstOfMonth(todayISO());
  const seed = D.makeFixtures(anchor);
  win.localStorage.setItem('nota.bids.v1', JSON.stringify(seed));
  win.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  win.eval(APP_SRC);
  await wait(50);
  return { win, doc: win.document, D, Nota: win.Nota, seed };
}

const $ = (doc, id) => doc.getElementById(id);
const click = (node) => node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));

// Two open demands on upcoming dates: one from a virtual lender, one from a
// branch bank — the pair the roster filter separates.
function openBids(D) {
  const d1 = addDays(todayISO(), 6);
  const d2 = addDays(todayISO(), 8);
  const base = { tier: 'rapide', premium: 1.2, prefixe: 'G1R', ready: true, proposition: null, demande: null, missing: [] };
  return [
    { ...base, id: 'b-virt', serviceId: 'refinancement', dateISO: d1, montant: 2600, preteur: { id: 'tangerine', nom: 'Tangerine', virtuel: true }, complexity: { level: 'standard', score: 1, factors: [] } },
    { ...base, id: 'b-bank', serviceId: 'refinancement', dateISO: d2, montant: 2500, preteur: { id: 'desjardins', nom: 'Desjardins', virtuel: false }, complexity: { level: 'simple', score: 0, factors: [] } },
  ];
}

// Stateful, like the real API: a sent message lands on the retained entry's
// thread, a release removes the entry — so the follow-up ncLoadBids observes
// exactly what the server would answer.
function stubApi(win, bids, extra = {}) {
  const calls = [];
  let retained = (extra.retained || []).map((r) => ({ ...r, messages: (r.messages || []).slice() }));
  win.fetch = (url, init = {}) => {
    const path = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || 'GET', body });
    const json = (b, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(b) });
    if (path.includes('/notary/session/request')) return json({ ok: true, devToken: 'chal.tok' });
    if (path.includes('/notary/session/verify')) return json({ token: 'sess.tok', feedToken: 'feed.tok', email: 'demo@etude.ca' });
    if (path.includes('/notary/bids/message')) {
      const message = { id: 'msg-' + calls.length, de: 'notaire', texte: body.texte, createdAt: '2026-08-12T10:00:00Z' };
      const entry = retained.find((r) => r.id === body.id);
      if (entry) entry.messages.push(message);
      return json({ message });
    }
    if (path.includes('/notary/bids/release')) {
      const bid = retained.find((r) => r.id === body.id) || {};
      retained = retained.filter((r) => r.id !== body.id);
      return json({ bid: { ...bid, status: 'ouverte', etude: null } });
    }
    if (path.includes('/notary/bids')) return json({ bids, retained });
    return Promise.reject(new Error('offline'));
  };
  return calls;
}

async function bootSignedIn(extra = {}) {
  const ctx = await boot();
  const bids = extra.bids || openBids(ctx.D);
  const calls = stubApi(ctx.win, bids, extra);
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  return { ...ctx, bids, calls };
}

// --- The booking flow asks the lender ----------------------------------------

test('the booking form renders the lender question as a required select with plain, unpriced labels', async () => {
  const { win, doc, D, Nota } = await boot();
  Nota.selectDate(addDays(todayISO(), 10));
  await wait(10);
  const sel = $(doc, 'crit-preteur');
  assert.ok(sel, 'the lender select is rendered among the mandatory questions');
  assert.equal(sel.tagName, 'SELECT');
  assert.equal(sel.options[0].value, '', 'a placeholder leads — no lender pre-chosen');
  assert.equal(sel.options.length, 1 + D.LENDERS.length, 'the options ARE the catalogue');
  // Choosing a lender is free: no option label carries a surcharge except the
  // private lender's deliberate one, and the floor does not move on a pick.
  for (const o of [...sel.options]) {
    if (o.value === 'prive') continue;
    assert.ok(!/\(\+/.test(o.textContent), `${o.value || 'placeholder'} shows a plain name: "${o.textContent}"`);
  }
  const before = Number($(doc, 'o-amount').min);
  sel.value = 'tangerine';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(Number($(doc, 'o-amount').min), before, 'a virtual lender no longer raises the floor');
  // The one exception: the private lender still prices its diligence.
  sel.value = 'prive';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(Number($(doc, 'o-amount').min), before + D.lenderById('prive').add);
});

test('« Autre prêteur » opens a name field the offer is gated on, and the name reaches the pricing answers', async () => {
  const { win, doc, D, Nota } = await boot();
  Nota.selectDate(addDays(todayISO(), 10));
  await wait(10);
  const sel = $(doc, 'crit-preteur');
  const nameBox = sel.closest('.crit-row').querySelector('.crit-other');
  const nameInp = $(doc, 'crit-preteur_autre');
  assert.ok(nameBox && nameInp, 'the free-text companion is rendered next to the select');
  assert.equal(nameBox.hidden, true, 'hidden while a catalogued lender is (or nothing is) chosen');

  sel.value = 'autre';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(nameBox.hidden, false, 'choosing « Autre prêteur » reveals the name field');
  // Fill everything else so the name is the ONLY gate left.
  for (const [id, value] of [['crit-valeur_pret', '250000']]) {
    const inp = $(doc, id); inp.value = value;
    inp.dispatchEvent(new win.Event('input', { bubbles: true }));
  }
  doc.querySelector('#crit-succession__non').click();
  doc.querySelector('#crit-approbation_bancaire__obtenue').click();
  await wait(5);
  let hint = $(doc, 'offer-hint');
  assert.equal(hint.hidden, false, 'the dead button says why');
  assert.match(hint.textContent, /Nom du prêteur/, 'the missing name is named in the hint');

  nameInp.value = 'Fiducie Familiale Roy';
  nameInp.dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(5);
  assert.ok(!/Nom du prêteur/.test($(doc, 'offer-hint').textContent || ''), 'the typed name satisfies the gate');
  assert.equal(Nota.state.offer.pricing.preteur_autre, 'Fiducie Familiale Roy', 'the name rides the pricing answers');
  // Switching back to a bank hides the field again (the typed name is kept).
  sel.value = 'desjardins';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(nameBox.hidden, true);
  void D;
});

// --- The notary sees, and can refuse, the lender ------------------------------

test('an open card names the lender and flags a virtual one', async () => {
  const { doc } = await bootSignedIn();
  const virt = doc.querySelector('.nc-card[data-id="b-virt"] .nc-lender');
  assert.ok(virt, 'the lender pill is on the card');
  assert.match(virt.textContent, /Tangerine/);
  assert.ok(virt.querySelector('.nc-lender-virt'), 'the virtual flag rides the pill');
  const bank = doc.querySelector('.nc-card[data-id="b-bank"] .nc-lender');
  assert.match(bank.textContent, /Desjardins/);
  assert.equal(bank.querySelector('.nc-lender-virt'), null, 'a branch bank is not flagged');
});

test('the préférences lender roster is a standing refusal: unchecking hides that lender’s demands', async () => {
  const { doc } = await bootSignedIn();
  const roster = $(doc, 'pref-lenders');
  assert.ok(roster.children.length >= 10, 'one chip per catalogued lender');
  assert.ok(doc.querySelector('.nc-card[data-id="b-virt"]'), 'the virtual-lender demand starts visible');
  // The notary does not close with Tangerine: one click, the demand is gone.
  const chip = roster.querySelector('[data-lender="tangerine"]');
  click(chip);
  assert.equal(doc.querySelector('.nc-card[data-id="b-virt"]'), null, 'refused lender → demand off the surface');
  assert.ok(doc.querySelector('.nc-card[data-id="b-bank"]'), 'other demands stay');
  // Re-accepting brings it back.
  click(roster.querySelector('[data-lender="tangerine"]'));
  assert.ok(doc.querySelector('.nc-card[data-id="b-virt"]'), 'accepted again → visible again');
});

// --- The retained card: conversation + withdrawal -----------------------------

function retainedEntry(D) {
  return {
    id: 'r-1', serviceId: 'refinancement', dateISO: addDays(todayISO(), 6), montant: 2900,
    tier: 'rapide', prefixe: 'G1R', courriel: 'client@example.ca',
    dossier: { adresse: '10 rue des Érables', __consent: true },
    client: { nom: 'Marie Roy', courriel: 'client@example.ca', telephone: null },
    preteur: { id: 'tangerine', nom: 'Tangerine', virtuel: true },
    messages: [{ id: 'm1', de: 'client', texte: 'Bonjour, les instructions arrivent demain.', createdAt: '2026-08-12T09:00:00Z' }],
    viaProposition: false,
  };
}

test('the retained card carries the thread and sends a message to the client', async () => {
  const ctx = await bootSignedIn({ retained: [retainedEntry(null)] });
  const { doc, calls } = ctx;
  const card = doc.querySelector('#notary-retained-list .nc-card');
  assert.ok(card, 'the retained card rendered');
  assert.match(card.querySelector('.nc-lender').textContent, /Tangerine/);
  const bubbles = card.querySelectorAll('.chat-bubble');
  assert.equal(bubbles.length, 1);
  assert.match(bubbles[0].textContent, /instructions arrivent demain/);
  // Type and send.
  card.querySelector('.chat-input').value = 'Parfait, merci !';
  click(card.querySelector('.nc-chat-send'));
  await wait(10);
  const sent = calls.find((c) => c.path.includes('/notary/bids/message'));
  assert.ok(sent, 'POST /notary/bids/message was called');
  assert.equal(sent.body.texte, 'Parfait, merci !');
  assert.equal(sent.body.id, 'r-1');
  // The thread repainted with the appended message.
  const after = doc.querySelectorAll('#notary-retained-list .nc-card .chat-bubble');
  assert.ok([...after].some((b) => /Parfait, merci/.test(b.textContent)), 'own message appears in the thread');
});

test('the withdrawal is armed (open → confirm) and returns the act to the market', async () => {
  const ctx = await bootSignedIn({ retained: [retainedEntry(null)] });
  const { doc, calls, Nota } = ctx;
  const card = doc.querySelector('#notary-retained-list .nc-card');
  const form = card.querySelector('.nc-release-form');
  assert.equal(form.hidden, true, 'the confirm starts closed');
  click(card.querySelector('.nc-release-open'));
  assert.equal(form.hidden, false, 'first click only opens the confirm');
  assert.equal(calls.some((c) => c.path.includes('/notary/bids/release')), false, 'nothing posted yet');
  // Reason + confirm.
  card.querySelector('.nc-release-motif').value = 'Prêteur hors de mes habitudes.';
  click(card.querySelector('.nc-release-confirm'));
  await wait(10);
  const posted = calls.find((c) => c.path.includes('/notary/bids/release'));
  assert.ok(posted, 'POST /notary/bids/release was called');
  assert.equal(posted.body.message, 'Prêteur hors de mes habitudes.');
  assert.equal(Nota.notary.retainedFor('demo@etude.ca').length, 0, 'the retained entry left this console');
  assert.equal(doc.querySelector('#notary-retained-list .nc-card'), null, 'the card is gone');
});

test('«Garder l’acte» closes the confirm without posting', async () => {
  const ctx = await bootSignedIn({ retained: [retainedEntry(null)] });
  const { doc, calls } = ctx;
  const card = doc.querySelector('#notary-retained-list .nc-card');
  click(card.querySelector('.nc-release-open'));
  click(card.querySelector('.nc-release-cancel'));
  assert.equal(card.querySelector('.nc-release-form').hidden, true);
  assert.equal(calls.some((c) => c.path.includes('/notary/bids/release')), false);
});

// --- The client side of the thread -------------------------------------------

test('Mes offres shows the thread on a retained offer and sends the client’s reply', async () => {
  const ctx = await boot();
  const { win, doc, Nota } = ctx;
  const dateISO = addDays(todayISO(), 6);
  // This browser owns a retained offer (token + cached status with a thread).
  win.localStorage.setItem('nota.myoffers.v1', JSON.stringify([
    { id: 'o-1', dateISO, serviceId: 'refinancement', montant: 2900, clientToken: 'cli.tok', retained: true, etude: 'Étude Laval' },
  ]));
  win.localStorage.setItem('nota.offerstatus.v1', JSON.stringify({
    'o-1': {
      bid: { id: 'o-1', status: 'retenue', etude: 'Étude Laval' },
      notaire: { etude: 'Étude Laval', courriel: 'n@etude.ca' },
      propositions: [], demandes: [], readiness: null,
      messages: [{ id: 'm1', de: 'notaire', texte: 'Bonjour — avez-vous les instructions ?', createdAt: '2026-08-12T09:00:00Z' }],
      fetchedAt: 1,
    },
  }));
  const calls = [];
  win.fetch = (url, init = {}) => {
    const path = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, body });
    if (path.includes('/client/bid/message')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ message: { id: 'm2', de: 'client', texte: body.texte, createdAt: '2026-08-12T10:00:00Z' } }) });
    }
    return Promise.reject(new Error('offline'));
  };
  Nota.setTab('profil');
  await wait(10);
  const chat = doc.querySelector('.my-offer-chat');
  assert.ok(chat, 'the thread renders under the retained offer');
  assert.match(chat.querySelector('.chat-bubble').textContent, /avez-vous les instructions/);
  chat.querySelector('.chat-input').value = 'Oui, reçues ce matin.';
  click(chat.querySelector('.client-chat-send'));
  await wait(10);
  const sent = calls.find((c) => c.path.includes('/client/bid/message'));
  assert.ok(sent, 'POST /client/bid/message was called');
  assert.equal(sent.body.texte, 'Oui, reçues ce matin.');
  assert.equal(sent.body.id, 'o-1');
  const bubbles = doc.querySelectorAll('.my-offer-chat .chat-bubble');
  assert.ok([...bubbles].some((b) => /reçues ce matin/.test(b.textContent)), 'the reply appears in the thread');
});
