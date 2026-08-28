/**
 * « Marquer complété » writes the write-once act ledger — so it earns the same
 * two-step register as Retenir, a domain bound on the value, and a server-fed
 * completed state that survives a fresh session.
 *
 *   1. First click ARMS: « Confirmer · X $ » + Annuler; second click settles.
 *   2. A value far outside the retained offer never arms (domain bound).
 *   3. A retained entry the SERVER says is completed renders « Acte complété »
 *      — the button is never re-offered to a fresh session.
 *
 * Boot harness mirrors notary-feed-simple.test.mjs: jsdom outside-only,
 * domain then app, real sign-in via a URL-routing fetch stub.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const DOMS = [];
after(() => { for (const d of DOMS) { try { d.window.close(); } catch {} } });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const firstOfMonth = (iso) => iso.slice(0, 7) + '-01';
const click = (node) => node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));

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
  DOMS.push(dom);
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  const D = win.NotaDomain;
  const seed = D.makeFixtures(firstOfMonth(todayISO()));
  win.localStorage.setItem('nota.bids.v1', JSON.stringify(seed));
  win.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  win.eval(APP_SRC);
  await wait(50);
  return { win, doc: win.document, D };
}

const RETAINED = {
  id: 'ret-1', dateISO: '2099-06-10', serviceId: 'refinancement', montant: 4600,
  tier: 'standard', prefixe: 'H2X', courriel: 'client@example.ca', dossier: null,
  client: { courriel: 'client@example.ca' }, preteur: null, deplacement: null,
  messages: [], viaProposition: false,
  completed: false, actAmount: null, commissionCents: null,
};

function stubNotaryApi(win, { retained, completions }) {
  win.fetch = (url, init = {}) => {
    const path = String(url);
    const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (path.includes('/notary/session/request')) return json({ ok: true, devToken: 'chal.tok' });
    if (path.includes('/notary/session/verify')) return json({ token: 'sess.tok', feedToken: 'feed.tok', email: 'demo@etude.ca' });
    if (path.includes('/notary/acts/complete')) {
      completions.push(JSON.parse(init.body));
      return json({ ok: true, actAmount: 4600, commissionCents: 46000 });
    }
    if (path.includes('/notary/bids')) return json({ bids: [], retained, rating: null, profil: { lienCNQ: null }, commission: null });
    return Promise.reject(new Error('offline'));
  };
}

async function bootRetained(entry = RETAINED) {
  const ctx = await boot();
  const completions = [];
  stubNotaryApi(ctx.win, { retained: [entry], completions });
  await ctx.win.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  const card = ctx.doc.querySelector(`#notary-retained-list .nc-card[data-id="${entry.id}"]`);
  assert.ok(card, 'the retained card renders');
  return { ...ctx, card, completions };
}

test('the settlement is two-step: arm reads the value back, Annuler disarms, confirm posts once', async () => {
  const { card, completions } = await bootRetained();
  const btn = card.querySelector('.nc-complete-btn');
  assert.ok(btn, 'a pending act offers the settlement button');

  // First click arms — nothing posted yet.
  click(btn);
  assert.equal(card.dataset.confirm, '1', 'the card is armed (poll-guarded)');
  assert.match(btn.textContent, /Confirmer/, 'the button reads back as a confirm');
  assert.match(card.querySelector('.nc-complete-amt').textContent, /4[  ]600/, 'the armed confirm reads the value back');
  assert.equal(completions.length, 0, 'nothing reaches the ledger on arm');

  // Annuler disarms and restores the button.
  click(card.querySelector('.nc-complete-cancel'));
  assert.equal(card.dataset.confirm, undefined);
  assert.equal(btn.textContent, 'Marquer complété');
  assert.equal(card.querySelector('.nc-complete-cancel'), null);

  // Arm again, confirm — exactly one settlement posts, the card completes.
  click(btn);
  click(btn);
  await wait(10);
  assert.equal(completions.length, 1, 'the confirm settles exactly once');
  assert.equal(completions[0].actAmount, 4600);
  const done = card.ownerDocument.querySelector(`#notary-retained-list .nc-card[data-id="${RETAINED.id}"] .nc-done-badge`);
  assert.ok(done, 'the card renders « Acte complété »');
});

test('a value far outside the retained offer never arms — the domain bound speaks first', async () => {
  const { card, completions } = await bootRetained();
  const input = card.querySelector('.nc-actval');
  // The append-typo: the prefilled 4600 with 4600 typed after it.
  input.value = '46004600';
  input.dispatchEvent(new card.ownerDocument.defaultView.Event('input', { bubbles: true }));
  const btn = card.querySelector('.nc-complete-btn');
  click(btn);
  assert.equal(card.dataset.confirm, undefined, 'an absurd value never arms');
  assert.equal(completions.length, 0, 'nothing reaches the ledger');
});

test('editing the value disarms a pending confirm — the armed figure is never stale', async () => {
  const { card } = await bootRetained();
  const btn = card.querySelector('.nc-complete-btn');
  click(btn);
  assert.equal(card.dataset.confirm, '1');
  const input = card.querySelector('.nc-actval');
  input.value = '4800';
  input.dispatchEvent(new card.ownerDocument.defaultView.Event('input', { bubbles: true }));
  assert.equal(card.dataset.confirm, undefined, 'editing disarms');
  assert.equal(btn.textContent, 'Marquer complété');
});

test('a server-completed act renders settled in a fresh session — the button is never re-offered', async () => {
  const { card } = await bootRetained({ ...RETAINED, completed: true, actAmount: 4600, commissionCents: 46000 });
  assert.equal(card.querySelector('.nc-complete-btn'), null, 'no settlement button on a settled act');
  assert.ok(card.querySelector('.nc-done-badge'), '« Acte complété » renders from the server state');
  assert.match(card.querySelector('.nc-done-fee').textContent, /4[  ]600[  ]\$/, 'the settled value renders');
});
