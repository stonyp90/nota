/**
 * Live support chat (ADR 0026): the floating question door.
 *   • the FAB exists, opens/closes the panel, and the panel polls the thread;
 *   • the first message mints a thread (token kept on the device) and renders;
 *   • the operator's reply lands on refresh, styled as Nota's side;
 *   • the domain gate runs inline — an empty message never reaches the wire;
 *   • the emailed #reponse= link opens the operator reply box and POSTs.
 * Boot mirrors smoke.test.mjs: jsdom outside-only, domain then app, offline
 * store seeded deterministically; the support API is a URL-routing fetch stub.
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

// A tiny in-memory support API: threads keyed by token, calls recorded.
function supportStub() {
  const calls = [];
  const threads = new Map(); // token -> { id, messages }
  let n = 0;
  const handler = (url, init = {}) => {
    const path = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    calls.push({ path, method: init.method || 'GET', body, token });
    const json = (obj, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(obj) });
    if (path.includes('/support/messages')) {
      let t = token && threads.get(token);
      if (token && !t) return json({ errors: [{ code: 'non_autorise' }] }, 401);
      if (!t) { t = { id: 'th-' + ++n, messages: [] }; threads.set('tok-' + t.id, t); }
      const message = { id: 'm-' + ++n, de: 'visiteur', texte: body.texte, createdAt: 'now' };
      t.messages.push(message);
      return json({ threadId: t.id, token: 'tok-' + t.id, message }, 201);
    }
    if (path.includes('/support/thread')) {
      const t = threads.get(token);
      if (!t) return json({ errors: [{ code: 'non_autorise' }] }, 401);
      return json({ messages: t.messages });
    }
    if (path.includes('/support/reply')) {
      const t = threads.get(token);
      if (!t) return json({ errors: [{ code: 'non_autorise' }] }, 401);
      const message = { id: 'm-' + ++n, de: 'nota', texte: body.texte, createdAt: 'now' };
      t.messages.push(message);
      return json({ message });
    }
    return Promise.reject(new Error('offline'));
  };
  return { calls, threads, handler };
}

async function boot({ hash = '', stub = supportStub() } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/' + hash,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = stub.handler;
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
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, stub };
}

const $ = (doc, id) => doc.getElementById(id);
const submit = (form) => form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));

test('the chat door exists: a labelled FAB that opens and closes the panel', async () => {
  const { doc } = await boot();
  const fab = $(doc, 'chat-fab');
  assert.ok(fab, 'the floating chat button exists');
  assert.ok(fab.getAttribute('aria-label'), 'the FAB is labelled for assistive tech');
  assert.equal($(doc, 'chat-panel').hidden, true, 'closed by default');
  fab.click();
  assert.equal($(doc, 'chat-panel').hidden, false, 'the FAB opens the panel');
  assert.equal(fab.getAttribute('aria-expanded'), 'true');
  $(doc, 'chat-close').click();
  assert.equal($(doc, 'chat-panel').hidden, true, 'the ✕ closes it');
});

test('the first message mints a thread, keeps its token on the device, and renders as the visitor', async () => {
  const { win, doc, stub } = await boot();
  $(doc, 'chat-fab').click();
  $(doc, 'chat-text').value = 'Signez-vous en soirée ?';
  submit($(doc, 'chat-form'));
  await wait(20);
  const posts = stub.calls.filter((c) => c.path.includes('/support/messages'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.texte, 'Signez-vous en soirée ?');
  const saved = JSON.parse(win.localStorage.getItem('nota.support.v1'));
  assert.ok(saved && saved.token, 'the thread token lives on the device');
  const bubbles = doc.querySelectorAll('#chat-log .chat-msg');
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].dataset.de, 'visiteur');
  assert.equal($(doc, 'chat-text').value, '', 'the input clears after send');
});

test('the operator reply lands on refresh, styled as Nota', async () => {
  const { doc, Nota, stub } = await boot();
  $(doc, 'chat-fab').click();
  $(doc, 'chat-text').value = 'Allo ?';
  submit($(doc, 'chat-form'));
  await wait(20);
  // The operator answers out-of-band (through the emailed link).
  const t = [...stub.threads.values()][0];
  t.messages.push({ id: 'r1', de: 'nota', texte: 'Bonjour ! Oui.', createdAt: 'now' });
  await Nota.support.refresh();
  await wait(10);
  const bubbles = [...doc.querySelectorAll('#chat-log .chat-msg')];
  assert.deepEqual(bubbles.map((b) => b.dataset.de), ['visiteur', 'nota'], 'both sides render, in order');
});

test('the domain gate runs inline: an empty message never reaches the wire', async () => {
  const { doc, stub } = await boot();
  $(doc, 'chat-fab').click();
  $(doc, 'chat-text').value = '   ';
  submit($(doc, 'chat-form'));
  await wait(10);
  assert.equal(stub.calls.filter((c) => c.path.includes('/support/messages')).length, 0, 'no POST');
  assert.equal($(doc, 'chat-error').hidden, false, 'the domain message surfaces');
});

test('the emailed #reponse= link opens the operator reply box, clears the hash, and POSTs the reply', async () => {
  const stub = supportStub();
  // A live thread the operator token can read (same token namespace in the stub).
  stub.threads.set('op-token-1', { id: 'th-x', messages: [{ id: 'q', de: 'visiteur', texte: 'Combien ?', createdAt: 'now' }] });
  const { win, doc } = await boot({ hash: '#reponse=op-token-1', stub });
  await wait(30);
  const dlg = $(doc, 'chat-reply-dialog');
  assert.equal(dlg.open, true, 'the reply dialog opens from the emailed link');
  assert.ok(!/reponse=/.test(win.location.hash), 'the token never lingers in the address bar');
  assert.match($(doc, 'chat-reply-log').textContent, /Combien \?/, 'the visitor question is shown');
  $(doc, 'chat-reply-text').value = 'Dès 2 000 $ pour un refinancement simple.';
  submit($(doc, 'chat-reply-form'));
  await wait(20);
  const replies = stub.calls.filter((c) => c.path.includes('/support/reply'));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].token, 'op-token-1', 'the reply rides the link token');
  assert.equal($(doc, 'chat-reply-sent').hidden, false, 'the confirmation shows');
});
