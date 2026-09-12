/**
 * Live support chat (ADR 0026, hardened by ADR 0033 §5): the floating
 * question door.
 *   • the FAB exists, opens/closes the panel, Escape closes it and focus
 *     returns to the FAB; the open state persists on the device;
 *   • the widget wears its OWN class namespace (sup-*) — the retained-act
 *     `.chat-*` rules (styles.css) once made the visitor's bubbles fall left;
 *   • the empty state is one friendly line with the expected response time;
 *   • bubbles carry a « Nota » / « Vous » label and a local time; the log is
 *     diffed (new ids appended), never rebuilt;
 *   • Enter sends / Shift+Enter breaks a line; a counter from 1800/2000;
 *     « Envoi… » while in flight; the courriel row sits UNDER the composer;
 *   • a Nota reply arriving while the panel is closed lights an unread dot
 *     on the FAB (slow 30 s poll while a thread exists, off after 24 h idle);
 *   • #messagerie in the hash opens the widget; an expired token says so
 *     instead of silently emptying the log;
 *   • the emailed #reponse= link opens the operator reply box, which polls,
 *     shows the visitor's courriel when the API returns it, and takes a
 *     second reply.
 * Boot mirrors smoke.test.mjs: jsdom outside-only, domain then app, offline
 * store seeded deterministically; the support API is a URL-routing fetch stub.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const D = require('../../../packages/domain/index.js');

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const DOMS = [];
after(() => { for (const d of DOMS) { try { d.window.close(); } catch {} } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FLAT = (s) => s.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

// A tiny in-memory support API: threads keyed by token, calls recorded.
// Timestamps are real ISO strings, one second apart, so « newer than seen »
// has something to compare.
function supportStub() {
  const calls = [];
  const threads = new Map(); // token -> { id, courriel, messages }
  let n = 0;
  let clock = Date.now();
  const stamp = () => new Date((clock += 1000)).toISOString();
  // Optional gate on the message POST, so a test can hold a send in flight.
  let holdPost = null;
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
      if (!t) { t = { id: 'th-' + ++n, courriel: null, messages: [] }; threads.set('tok-' + t.id, t); }
      if (body.courriel) t.courriel = body.courriel;
      const message = { id: 'm-' + ++n, de: 'visiteur', texte: body.texte, createdAt: stamp() };
      t.messages.push(message);
      const out = json({ threadId: t.id, token: 'tok-' + t.id, message }, 201);
      return holdPost ? holdPost.then(() => out) : out;
    }
    if (path.includes('/support/thread')) {
      const t = threads.get(token);
      if (!t) return json({ errors: [{ code: 'non_autorise' }] }, 401);
      const view = { threadId: t.id, messages: t.messages };
      if (t.courriel) view.courriel = t.courriel;
      return json(view);
    }
    if (path.includes('/support/reply')) {
      const t = threads.get(token);
      if (!t) return json({ errors: [{ code: 'non_autorise' }] }, 401);
      const message = { id: 'm-' + ++n, de: 'nota', texte: body.texte, createdAt: stamp() };
      t.messages.push(message);
      return json({ message });
    }
    return Promise.reject(new Error('offline'));
  };
  return {
    calls, threads, handler, stamp,
    hold() { let release; holdPost = new Promise((r) => { release = r; }); return () => { holdPost = null; release(); }; },
  };
}

async function boot({ hash = '', stub = supportStub(), seed = {} } = {}) {
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
  for (const [k, v] of Object.entries(seed)) win.localStorage.setItem(k, v);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, stub };
}

const $ = (doc, id) => doc.getElementById(id);
const submit = (form) => form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
const key = (node, k, extra = {}) => node.dispatchEvent(new node.ownerDocument.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
const input = (node) => node.dispatchEvent(new node.ownerDocument.defaultView.Event('input', { bubbles: true }));

// Open the panel and send one message through the form; returns after the
// thread is minted and rendered.
async function ask(doc, text) {
  if ($(doc, 'chat-panel').hidden) $(doc, 'chat-fab').click();
  $(doc, 'chat-text').value = text;
  submit($(doc, 'chat-form'));
  await wait(30);
}

test('the chat door exists: a labelled FAB that opens and closes the panel, in its own sup-* namespace', async () => {
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
  // The namespace: not one element of the widget wears a retained-act
  // `.chat-*` class — that collision made the visitor's bubbles fall left.
  const leaks = [...$(doc, 'chat-wrap').querySelectorAll('*'), $(doc, 'chat-wrap'), ...$(doc, 'chat-reply-dialog').querySelectorAll('*')]
    .flatMap((n) => [...n.classList]).filter((c) => /^chat-/.test(c));
  assert.deepEqual(leaks, [], 'no chat-* class inside the widget or the reply dialog');
  assert.ok($(doc, 'chat-wrap').classList.contains('sup-wrap'));
  assert.ok($(doc, 'chat-panel').classList.contains('sup-panel'));
  assert.ok($(doc, 'chat-log').classList.contains('sup-log'));
  assert.equal($(doc, 'chat-log').getAttribute('aria-live'), 'polite', 'the log stays live for AT');
});

test('Escape closes the panel and focus returns to the FAB', async () => {
  const { doc } = await boot();
  const fab = $(doc, 'chat-fab');
  fab.click();
  assert.equal($(doc, 'chat-panel').hidden, false);
  key($(doc, 'chat-text'), 'Escape');
  assert.equal($(doc, 'chat-panel').hidden, true, 'Escape closes');
  assert.equal(doc.activeElement, fab, 'focus lands back on the FAB');
  fab.click();
  $(doc, 'chat-close').click();
  assert.equal(doc.activeElement, fab, 'the ✕ hands focus back too');
});

test('the open state persists on the device and comes back at the next boot', async () => {
  const { win, doc } = await boot();
  $(doc, 'chat-fab').click();
  assert.equal(win.localStorage.getItem('nota.support.open.v1'), '1', 'open is remembered');
  $(doc, 'chat-close').click();
  assert.equal(win.localStorage.getItem('nota.support.open.v1'), '0', 'closed is remembered');
  const again = await boot({ seed: { 'nota.support.open.v1': '1' } });
  assert.equal($(again.doc, 'chat-panel').hidden, false, 'a panel left open reopens');
  assert.equal($(again.doc, 'chat-fab').getAttribute('aria-expanded'), 'true');
});

test('#messagerie in the hash opens the widget and is stripped from the address bar', async () => {
  const { win, doc } = await boot({ hash: '#messagerie' });
  assert.equal($(doc, 'chat-panel').hidden, false, 'the emailed link opens the conversation');
  assert.ok(!/messagerie/.test(win.location.hash), 'the hash is consumed');
});

test('the intro is said once — and it no longer promises a response time (ADR 0046)', async () => {
  const { doc } = await boot();
  $(doc, 'chat-fab').click();
  const panel = $(doc, 'chat-panel');
  const txt = FLAT(panel.textContent);
  assert.equal(
    txt.split('Posez votre question ici, en tout temps. Un assistant IA peut vous guider; une personne peut prendre le relais dans cette conversation.').length - 1,
    1,
    'the header sub, once'
  );
  assert.ok(!/Posez votre question — l’équipe Nota vous répond en direct\./.test(txt), 'the duplicated intent is gone');
  // LA promesse que l'audit des affirmations a marquée invérifiable : aucune
  // surface de la messagerie n'annonce plus un délai de réponse.
  assert.ok(!/quelques minutes/.test(txt), 'no response-time promise anywhere in the panel');
  assert.ok(!/heures d’ouverture/.test(txt), 'no opening-hours promise either');
  // Le vide de 96 px a été remplacé par des questions qui mènent quelque part.
  assert.equal($(doc, 'chat-log').querySelectorAll('.sup-empty').length, 0, 'no floating empty-state line');
  const chips = $(doc, 'chat-suggest').querySelectorAll('.sup-chip');
  assert.equal(chips.length, 4, 'four quick starters');
  assert.equal($(doc, 'chat-topic-list').querySelectorAll('[data-topic]').length, D.SUPPORT_TOPICS.length, 'all topics stay available in the help browser');
  assert.equal($(doc, 'chat-suggest').hidden, false, 'the starters are visible on a fresh thread');
});

test('the first message mints a thread, keeps its token on the device, and renders as « Vous » with a time', async () => {
  const { win, doc, stub } = await boot();
  await ask(doc, 'Signez-vous en soirée ?');
  const posts = stub.calls.filter((c) => c.path.includes('/support/messages'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.texte, 'Signez-vous en soirée ?');
  const saved = JSON.parse(win.localStorage.getItem('nota.support.v1'));
  assert.ok(saved && saved.token, 'the thread token lives on the device');
  const bubbles = doc.querySelectorAll('#chat-log .sup-msg');
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].dataset.de, 'visiteur');
  assert.ok(bubbles[0].classList.contains('is-mine'), 'the visitor’s own side');
  assert.equal(FLAT(bubbles[0].querySelector('.sup-who').textContent), 'Vous');
  const when = bubbles[0].querySelector('time.sup-when');
  assert.ok(when && when.getAttribute('datetime'), 'a real <time> with its ISO stamp');
  assert.match(FLAT(when.textContent), /^\d{1,2}:\d{2}$/, 'today: local time only, « 14:32 »');
  assert.equal($(doc, 'chat-text').value, '', 'the input clears after send');
  assert.equal($(doc, 'chat-log').querySelectorAll('.sup-empty').length, 0, 'the empty line leaves');
});

test('the operator reply lands on refresh labelled « Nota », on its own side — and the log is diffed, not rebuilt', async () => {
  const { doc, Nota, stub } = await boot();
  await ask(doc, 'Allo ?');
  const first = doc.querySelector('#chat-log .sup-msg');
  // The operator answers out-of-band (through the emailed link).
  const t = [...stub.threads.values()][0];
  t.messages.push({ id: 'r1', de: 'nota', texte: 'Bonjour ! Oui.', createdAt: stub.stamp() });
  await Nota.support.refresh();
  await wait(10);
  const bubbles = [...doc.querySelectorAll('#chat-log .sup-msg')];
  assert.deepEqual(bubbles.map((b) => b.dataset.de), ['visiteur', 'nota'], 'both sides render, in order');
  assert.equal(bubbles[0], first, 'the existing bubble is the SAME node — appended, never re-rendered');
  assert.equal(FLAT(bubbles[1].querySelector('.sup-who').textContent), 'Nota');
  assert.ok(!bubbles[1].classList.contains('is-mine'), 'Nota’s side');
  await Nota.support.refresh();
  await wait(10);
  assert.equal(doc.querySelectorAll('#chat-log .sup-msg').length, 2, 'a second poll adds nothing twice');
});

test('a message from another day carries a date prefix before its time', async () => {
  const { doc, Nota, stub } = await boot();
  await ask(doc, 'Hier ?');
  const t = [...stub.threads.values()][0];
  t.messages.push({ id: 'old', de: 'nota', texte: 'Oui.', createdAt: '2026-01-05T19:32:00.000Z' });
  await Nota.support.refresh();
  await wait(10);
  const whens = [...doc.querySelectorAll('#chat-log .sup-when')].map((w) => FLAT(w.textContent));
  assert.match(whens[1], /^\D*\d.*·\s*\d{1,2}:\d{2}$/, 'date · time when not today: ' + whens[1]);
});

test('Enter sends; Shift+Enter breaks a line instead', async () => {
  const { doc, stub } = await boot();
  $(doc, 'chat-fab').click();
  const ta = $(doc, 'chat-text');
  ta.value = 'Ligne 1';
  const soft = key(ta, 'Enter', { shiftKey: true });
  assert.equal(soft, true, 'Shift+Enter is not prevented — the newline goes in');
  await wait(10);
  assert.equal(stub.calls.filter((c) => c.path.includes('/support/messages')).length, 0, 'no POST on Shift+Enter');
  const hard = key(ta, 'Enter');
  assert.equal(hard, false, 'Enter is consumed');
  await wait(20);
  assert.equal(stub.calls.filter((c) => c.path.includes('/support/messages')).length, 1, 'Enter sends');
});

test('the counter appears near the limit, from 200 characters before the domain’s maximum', async () => {
  const { doc } = await boot();
  $(doc, 'chat-fab').click();
  const ta = $(doc, 'chat-text'), count = $(doc, 'chat-count');
  assert.ok(count, 'a counter element exists');
  ta.value = 'a'.repeat(100); input(ta);
  assert.equal(count.hidden, true, 'quiet while far from the limit');
  const max = D.SUPPORT_MESSAGE_MAX;
  ta.value = 'a'.repeat(max - 150); input(ta);
  assert.equal(count.hidden, false, 'shows from 1800');
  assert.equal(FLAT(count.textContent), (max - 150) + ' / ' + max);
  assert.equal(ta.getAttribute('maxlength'), String(max), 'the hard cap is the domain’s');
});

test('« Envoi… » while the message is in flight, then « Envoyer » again', async () => {
  const stub = supportStub();
  const { doc } = await boot({ stub });
  $(doc, 'chat-fab').click();
  const release = stub.hold();
  $(doc, 'chat-text').value = 'Patientez';
  submit($(doc, 'chat-form'));
  await wait(10);
  const send = $(doc, 'chat-send');
  assert.equal(send.disabled, true);
  assert.equal(FLAT(send.textContent), 'Envoi…');
  release();
  await wait(30);
  assert.equal(send.disabled, false);
  assert.equal(FLAT(send.textContent), 'Envoyer');
});

test('the courriel row sits UNDER the composer — optional, one line, with its help', async () => {
  const { doc } = await boot();
  const form = $(doc, 'chat-form');
  const kids = [...form.children];
  const rowIx = kids.findIndex((k) => k.classList.contains('sup-row'));
  const mailIx = kids.findIndex((k) => k.classList.contains('sup-courriel-row'));
  assert.ok(rowIx >= 0 && mailIx >= 0, 'both rows exist');
  assert.ok(mailIx > rowIx, 'courriel after the composer');
  const mail = $(doc, 'chat-courriel');
  assert.equal(mail.required, false, 'optional');
  assert.equal(mail.getAttribute('type'), 'email');
  const help = $(doc, 'chat-courriel-help');
  assert.match(FLAT(help.textContent), /pour recevoir la réponse par courriel si vous quittez/);
  assert.ok((mail.getAttribute('aria-describedby') || '').split(/\s+/).includes(help.id), 'the help describes the field');
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

test('unread: a Nota reply arriving while the panel is closed lights the FAB; opening clears it; the poll slows while closed', async () => {
  const { doc, Nota, stub } = await boot();
  const fab = $(doc, 'chat-fab'), dot = $(doc, 'chat-fab-dot');
  assert.ok(dot && dot.hidden, 'the dot exists and starts dark');
  assert.equal(Nota.support.pollMs(), 0, 'no thread, no poll');
  await ask(doc, 'Une question');
  assert.equal(Nota.support.pollMs(), 3000, 'open: live cadence');
  $(doc, 'chat-close').click();
  assert.equal(Nota.support.pollMs(), 30000, 'closed with a thread: slow cadence');
  const t = [...stub.threads.values()][0];
  t.messages.push({ id: 'r1', de: 'nota', texte: 'Voici.', createdAt: stub.stamp() });
  await Nota.support.refresh();
  await wait(10);
  assert.equal(dot.hidden, false, 'the dot lights');
  assert.match(fab.getAttribute('aria-label'), /1 nouvelle réponse/);
  assert.equal(fab.dataset.unread, '1');
  fab.click();
  await wait(20);
  assert.equal(dot.hidden, true, 'opening reads it');
  assert.equal(fab.getAttribute('aria-label'), 'Messagerie — posez votre question');
  assert.equal(doc.querySelectorAll('#chat-log .sup-msg').length, 2, 'the reply is in the log');
  $(doc, 'chat-close').click();
  await Nota.support.refresh();
  assert.equal(dot.hidden, true, 'nothing new: stays dark');
});

test('idle polling: off after 24 h without activity, on within it', async () => {
  const stale = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  const old = await boot({ seed: { 'nota.support.v1': JSON.stringify({ threadId: 'th-z', token: 'tok-z', lastAt: stale }) } });
  assert.equal(old.Nota.support.pollMs(), 0, 'a day-old thread is left alone');
  const fresh = new Date(Date.now() - 3600 * 1000).toISOString();
  const live = await boot({ seed: { 'nota.support.v1': JSON.stringify({ threadId: 'th-y', token: 'tok-y', lastAt: fresh }) } });
  assert.equal(live.Nota.support.pollMs(), 30000, 'a recent thread keeps a slow watch');
});

test('an expired token says so instead of silently emptying the log; the next message starts fresh', async () => {
  const { win, doc, Nota, stub } = await boot();
  await ask(doc, 'Première');
  const tok = JSON.parse(win.localStorage.getItem('nota.support.v1')).token;
  stub.threads.delete(tok); // the server forgot the thread: 401 from now on
  await Nota.support.refresh();
  await wait(10);
  assert.equal(doc.querySelectorAll('#chat-log .sup-msg').length, 1, 'the log is NOT emptied');
  const ended = $(doc, 'chat-ended');
  assert.equal(ended.hidden, false);
  assert.match(FLAT(ended.textContent), /Cette conversation est terminée — écrivez-nous à nouveau\./);
  assert.equal(win.localStorage.getItem('nota.support.v1'), null, 'the dead token is forgotten');
  $(doc, 'chat-text').value = 'Nouvelle';
  submit($(doc, 'chat-form'));
  await wait(30);
  const bubbles = [...doc.querySelectorAll('#chat-log .sup-msg')];
  assert.equal(bubbles.length, 1, 'a fresh thread starts a fresh log');
  assert.match(bubbles[0].textContent, /Nouvelle/);
  assert.equal(ended.hidden, true, 'the ended line leaves');
});

test('the emailed #reponse= link opens the operator reply box, clears the hash, shows the visitor courriel, polls, and takes a second reply', async () => {
  const stub = supportStub();
  stub.threads.set('op-token-1', { id: 'th-x', courriel: 'lea@exemple.ca', messages: [{ id: 'q', de: 'visiteur', texte: 'Combien ?', createdAt: stub.stamp() }] });
  const { win, doc, Nota } = await boot({ hash: '#reponse=op-token-1', stub });
  await wait(30);
  const dlg = $(doc, 'chat-reply-dialog');
  assert.equal(dlg.open, true, 'the reply dialog opens from the emailed link');
  assert.ok(!/reponse=/.test(win.location.hash), 'the token never lingers in the address bar');
  assert.match($(doc, 'chat-reply-log').textContent, /Combien \?/, 'the visitor question is shown');
  const who = $(doc, 'chat-reply-log').querySelector('.sup-msg .sup-who');
  assert.equal(FLAT(who.textContent), 'Visiteur', 'in the operator’s box the visitor is « Visiteur »');
  const mail = $(doc, 'chat-reply-courriel');
  assert.equal(mail.hidden, false, 'the courriel shows when the API returns it');
  assert.match(mail.textContent, /lea@exemple\.ca/);
  $(doc, 'chat-reply-text').value = 'Dès 2 000 $ pour un refinancement simple.';
  submit($(doc, 'chat-reply-form'));
  await wait(20);
  const replies = stub.calls.filter((c) => c.path.includes('/support/reply'));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].token, 'op-token-1', 'the reply rides the link token');
  assert.equal($(doc, 'chat-reply-sent').hidden, false, 'the confirmation shows');
  // The visitor writes back; the box polls it up without a reload.
  stub.threads.get('op-token-1').messages.push({ id: 'q2', de: 'visiteur', texte: 'Et en soirée ?', createdAt: stub.stamp() });
  await Nota.support.refreshReply();
  await wait(10);
  assert.match($(doc, 'chat-reply-log').textContent, /Et en soirée \?/, 'the follow-up lands');
  assert.equal(Nota.support.replyPollMs(), 3000, 'the box polls live while open');
  // Second reply keeps working.
  $(doc, 'chat-reply-text').value = 'Oui, jusqu’à 19 h.';
  submit($(doc, 'chat-reply-form'));
  await wait(20);
  assert.equal(stub.calls.filter((c) => c.path.includes('/support/reply')).length, 2, 'a second reply goes through');
  const mine = [...$(doc, 'chat-reply-log').querySelectorAll('.sup-msg[data-de="nota"]')];
  assert.equal(mine.length, 2);
  assert.ok(mine.every((m) => m.classList.contains('is-mine') && FLAT(m.querySelector('.sup-who').textContent) === 'Nota'), 'Nota’s replies sit on the operator’s own side');
  $(doc, 'chat-reply-close').click();
  assert.equal(Nota.support.replyPollMs(), 0, 'closing the box stops its poll');
});

test('the reply box hides the courriel line when the API returns none', async () => {
  const stub = supportStub();
  stub.threads.set('op-token-2', { id: 'th-y', courriel: null, messages: [{ id: 'q', de: 'visiteur', texte: 'Allo', createdAt: stub.stamp() }] });
  const { doc } = await boot({ hash: '#reponse=op-token-2', stub });
  await wait(30);
  assert.equal($(doc, 'chat-reply-dialog').open, true);
  assert.equal($(doc, 'chat-reply-courriel').hidden, true);
});

test('CSS: the visitor’s own bubbles align right through the widget’s OWN rule, tokens only', () => {
  const mine = /\.sup-msg\.is-mine\s*\{[^}]*align-items:\s*flex-end/.exec(CSS_SRC);
  assert.ok(mine, '.sup-msg.is-mine aligns to the end');
  assert.match(CSS_SRC, /\.sup-msg\s*\{[^}]*flex-direction:\s*column/, 'a bubble is a column (bubble over its meta)');
  const block = CSS_SRC.slice(CSS_SRC.indexOf('.sup-wrap'), CSS_SRC.indexOf('.sup-wrap') + 6000);
  assert.ok(!/(?:background|color|border)[^;}]*(?:#[0-9a-fA-F]{3}|rgb\(|hsl\()/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the widget paints tokens only');
  // Square register: no pills, no circles on controls — the ≤ 8px unread dot
  // and the ≤ 8px typing dots are the only round marks the register allows.
  assert.ok(!/\.sup-(?!fab-dot|dot)[a-z-]*\s*\{[^}]*border-radius:\s*(?:50%|99|999)/.test(block), 'square register: no pills, no circles on controls');
  assert.match(block, /\.sup-dot\s*\{[^}]*width:\s*[1-8]px/, 'the typing dots stay inside the ≤ 8px exemption');
});

// Reliability regressions: exercise the actual composer and network boundary.
const response = (json, status = 200) => ({ status, json: async () => json });
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('a failed send restores its draft and removes only its optimistic echo', async () => {
  const { doc, win, stub } = await boot();
  win.fetch = (url, init) => String(url).includes('/support/messages') ? Promise.reject(new Error('offline')) : stub.handler(url, init);
  await ask(doc, 'Question à conserver');
  assert.equal($(doc, 'chat-text').value, 'Question à conserver');
  assert.equal($(doc, 'chat-log').querySelectorAll('[data-id^="local-"]').length, 0);
  assert.match($(doc, 'chat-error').textContent, /Envoi non confirmé/);
  assert.equal($(doc, 'chat-send').disabled, false);
  assert.equal($(doc, 'chat-log').querySelector('.sup-typing'), null);
  win.fetch = stub.handler;
  submit($(doc, 'chat-form')); await wait(30);
  assert.equal($(doc, 'chat-log').querySelectorAll('.sup-msg').length, 1);
  assert.equal($(doc, 'chat-text').value, '');
});

test('failure preserves a newer draft and offers explicit recovery without sending', async () => {
  const { doc, win, stub } = await boot();
  const pending = gate();
  win.fetch = (url, init) => String(url).includes('/support/messages') ? pending.promise : stub.handler(url, init);
  await ask(doc, 'Première question');
  $(doc, 'chat-text').value = 'Nouveau brouillon';
  pending.resolve(response({}, 503)); await wait(20);
  assert.equal($(doc, 'chat-text').value, 'Nouveau brouillon');
  const failed = $(doc, 'chat-log').querySelector('[data-delivery="unconfirmed"]');
  assert.match(failed.textContent, /Première question/);
  failed.querySelector('button').click();
  assert.equal($(doc, 'chat-text').value, 'Nouveau brouillon');
  $(doc, 'chat-text').value = '';
  failed.querySelector('button').click();
  assert.equal($(doc, 'chat-text').value, 'Première question');
  assert.equal($(doc, 'chat-log').querySelector('[data-delivery="unconfirmed"]'), null);
});

test('a later successful send does not delete an earlier unconfirmed message', async () => {
  const { doc, win, stub } = await boot();
  await ask(doc, 'Créer le fil');
  const pending = gate();
  win.fetch = (url, init) => String(url).includes('/support/messages') ? pending.promise : stub.handler(url, init);
  await ask(doc, 'Message incertain');
  $(doc, 'chat-text').value = 'Question suivante';
  pending.resolve(response({}, 500)); await wait(20);
  win.fetch = stub.handler;
  submit($(doc, 'chat-form')); await wait(30);
  assert.equal($(doc, 'chat-log').querySelectorAll('[data-delivery="unconfirmed"]').length, 1);
  const echoes = $(doc, 'chat-log').querySelectorAll('[data-id^="local-"]');
  assert.equal(echoes.length, 1);
  assert.match(echoes[0].textContent, /Message incertain/);
  assert.match($(doc, 'chat-log').textContent, /Question suivante/);
});

test('malformed success bodies cannot discard a draft or replace its session', async () => {
  const { doc, win, stub } = await boot();
  await ask(doc, 'Fil existant');
  const session = win.localStorage.getItem('nota.support.v1');
  win.fetch = async () => response({ message: null }, 201);
  await ask(doc, 'À conserver');
  assert.equal($(doc, 'chat-text').value, 'À conserver');
  assert.equal(win.localStorage.getItem('nota.support.v1'), session);
});

test('only one poll is in flight and a late expired-token poll cannot forget a renewed session', async () => {
  const { doc, win, Nota, stub } = await boot();
  await ask(doc, 'Fil existant');
  const pending = gate(); let reads = 0;
  win.fetch = (url, init) => {
    if (String(url).includes('/support/thread')) { reads++; return pending.promise; }
    return stub.handler(url, init);
  };
  const first = Nota.support.refresh();
  const second = Nota.support.refresh();
  await wait(5); assert.equal(reads, 1);
  const current = JSON.parse(win.localStorage.getItem('nota.support.v1'));
  win.localStorage.setItem('nota.support.v1', JSON.stringify({ ...current, token: 'renewed-token' }));
  pending.resolve(response({}, 401)); await Promise.all([first, second]);
  assert.equal(JSON.parse(win.localStorage.getItem('nota.support.v1')).token, 'renewed-token');
  assert.equal($(doc, 'chat-ended').hidden, true);
});

test('a slow poll started before a send cannot regress seenAt or erase the conversation', async () => {
  const { doc, win, Nota, stub } = await boot();
  await ask(doc, 'Fil existant');
  const pending = gate();
  win.fetch = (url, init) => String(url).includes('/support/thread') ? pending.promise : stub.handler(url, init);
  const read = Nota.support.refresh();
  await ask(doc, 'Nouvelle question');
  const session = JSON.parse(win.localStorage.getItem('nota.support.v1'));
  pending.resolve(response({}, 401)); await read;
  assert.deepEqual(JSON.parse(win.localStorage.getItem('nota.support.v1')), session);
  assert.match($(doc, 'chat-log').textContent, /Nouvelle question/);
});

test('polling suspends in hidden or offline tabs and resumes when available', async () => {
  const { doc, win, Nota } = await boot();
  await ask(doc, 'Fil existant');
  Object.defineProperty(doc, 'hidden', { configurable: true, value: true });
  doc.dispatchEvent(new win.Event('visibilitychange'));
  assert.equal(Nota.support.pollMs(), 0);
  Object.defineProperty(doc, 'hidden', { configurable: true, value: false });
  doc.dispatchEvent(new win.Event('visibilitychange')); await wait(10);
  assert.equal(Nota.support.pollMs(), 3000);
  Object.defineProperty(win.navigator, 'onLine', { configurable: true, value: false });
  win.dispatchEvent(new win.Event('offline'));
  assert.equal(Nota.support.pollMs(), 0);
  Object.defineProperty(win.navigator, 'onLine', { configurable: true, value: true });
  win.dispatchEvent(new win.Event('online')); await wait(10);
  assert.equal(Nota.support.pollMs(), 3000);
});

test('poll failures back off and success restores the normal cadence', async () => {
  const { doc, win, Nota, stub } = await boot();
  await ask(doc, 'Fil existant');
  win.fetch = async () => response({}, 503);
  await Nota.support.refresh(); assert.equal(Nota.support.pollMs(), 6000);
  await Nota.support.refresh(); assert.equal(Nota.support.pollMs(), 12000);
  win.fetch = stub.handler;
  await Nota.support.refresh(); assert.equal(Nota.support.pollMs(), 3000);
});

test('topic search ignores accents, filters locally, and has a recoverable empty state', async () => {
  const { doc, stub } = await boot();
  $(doc, 'chat-fab').click();
  const search = $(doc, 'chat-topic-search'), list = $(doc, 'chat-topic-list');
  search.value = 'preteur'; input(search);
  const visible = [...list.children].filter(n => !n.hidden);
  assert.equal(visible.length, 1); assert.equal(visible[0].dataset.topic, 'preteur');
  search.value = 'zzzzzz'; input(search);
  assert.equal($(doc, 'chat-topic-empty').hidden, false);
  search.value = ''; input(search);
  assert.equal([...list.children].filter(n => !n.hidden).length, D.SUPPORT_TOPICS.length);
  assert.equal($(doc, 'chat-topic-empty').hidden, true);
  assert.equal(stub.calls.filter(c => c.path.includes('/support/messages')).length, 0);
});

test('handoff state survives refresh and hides assistant typing on later messages', async () => {
  const { doc, win, Nota, stub } = await boot();
  await ask(doc, 'Fil existant');
  win.fetch = (url, init) => String(url).includes('/support/thread')
    ? Promise.resolve(response({ messages: [], escalade: true, humain: false })) : stub.handler(url, init);
  await Nota.support.refresh();
  assert.equal($(doc, 'chat-escalade').hidden, false);
  const release = stub.hold();
  await ask(doc, 'Précision pour la personne');
  assert.equal($(doc, 'chat-log').querySelector('.sup-typing'), null);
  assert.equal($(doc, 'chat-escalade').hidden, false);
  release(); await wait(20);
});

test('IME composition does not send and repeated submit sends only once', async () => {
  const { doc, stub } = await boot();
  $(doc, 'chat-fab').click();
  $(doc, 'chat-text').value = 'Question';
  key($(doc, 'chat-text'), 'Enter', { isComposing: true }); await wait(5);
  assert.equal(stub.calls.filter(c => c.path.includes('/support/messages')).length, 0);
  const release = stub.hold();
  submit($(doc, 'chat-form')); submit($(doc, 'chat-form')); await wait(5);
  assert.equal(stub.calls.filter(c => c.path.includes('/support/messages')).length, 1);
  release(); await wait(20);
});

test('operator double-submit is guarded and a newer reply draft survives', async () => {
  const stub = supportStub();
  stub.threads.set('op-token', { id: 'th-op', messages: [] });
  const { doc, win } = await boot({ hash: '#reponse=op-token', stub });
  const pending = gate(); let posts = 0;
  win.fetch = (url, init) => {
    if (String(url).includes('/support/reply')) { posts++; return pending.promise; }
    return stub.handler(url, init);
  };
  $(doc, 'chat-reply-text').value = 'Réponse';
  submit($(doc, 'chat-reply-form')); submit($(doc, 'chat-reply-form')); await wait(5);
  $(doc, 'chat-reply-text').value = 'Précision suivante';
  pending.resolve(response({ message: { id: 'op-answer', de: 'nota', texte: 'Réponse' } })); await wait(20);
  assert.equal(posts, 1);
  assert.equal($(doc, 'chat-reply-text').value, 'Précision suivante');
});

test('emailed operator retries keep the same message ID while newer replies remain independent', async () => {
  const stub = supportStub(); stub.threads.set('op-token', { id: 'th-op', messages: [] });
  const { doc, win } = await boot({ hash: '#reponse=op-token', stub });
  const pending = gate(), attempts = [];
  win.fetch = (url, init) => {
    if (String(url).includes('/support/reply')) { attempts.push(JSON.parse(init.body)); return pending.promise; }
    return stub.handler(url, init);
  };
  $(doc, 'chat-reply-text').value = 'Réponse incertaine'; submit($(doc, 'chat-reply-form')); await wait(5);
  $(doc, 'chat-reply-text').value = 'Précision suivante'; input($(doc, 'chat-reply-text'));
  pending.resolve(response({}, 503)); await wait(15);
  assert.equal($(doc, 'chat-reply-text').value, 'Précision suivante');
  assert.match($(doc, 'chat-reply-recovery').textContent, /Réponse incertaine/);
  win.fetch = (url, init) => {
    if (String(url).includes('/support/reply')) attempts.push(JSON.parse(init.body));
    return stub.handler(url, init);
  };
  submit($(doc, 'chat-reply-form')); await wait(20);
  assert.notEqual(attempts[1].messageId, attempts[0].messageId);
  $(doc, 'chat-reply-recovery').querySelector('button').click();
  assert.equal($(doc, 'chat-reply-text').value, 'Réponse incertaine');
  submit($(doc, 'chat-reply-form')); await wait(20);
  assert.deepEqual(attempts[2], attempts[0]);
  assert.equal($(doc, 'chat-reply-recovery').hidden, true);
});

test('an emailed operator reply completing after a thread change cannot alter the new conversation', async () => {
  const stub = supportStub();
  stub.threads.set('op-one', { id: 'th-one', messages: [] });
  stub.threads.set('op-two', { id: 'th-two', messages: [] });
  const { doc, win, Nota } = await boot({ hash: '#reponse=op-one', stub });
  const pending = gate();
  win.fetch = (url, init) => String(url).includes('/support/reply') ? pending.promise : stub.handler(url, init);
  $(doc, 'chat-reply-text').value = 'Réponse du premier fil'; submit($(doc, 'chat-reply-form')); await wait(5);
  await Nota.support.openReply('op-two');
  $(doc, 'chat-reply-text').value = 'Brouillon du second fil'; input($(doc, 'chat-reply-text'));
  pending.resolve(response({ message: { id: 'old-reply', de: 'nota', texte: 'Réponse du premier fil' } })); await wait(15);
  assert.equal($(doc, 'chat-reply-text').value, 'Brouillon du second fil');
  assert.equal($(doc, 'chat-reply-log').textContent.includes('Réponse du premier fil'), false);
  assert.equal($(doc, 'chat-reply-sent').hidden, true);
});

test('a hung request times out, aborts and restores the composer without retrying the POST', async () => {
  const { doc, win, stub } = await boot();
  const realTimeout = win.setTimeout.bind(win);
  win.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms === 45000 ? 15 : ms, ...args);
  let posts = 0, signal;
  win.fetch = (url, init) => {
    if (String(url).includes('/support/messages')) { posts++; signal = init.signal; return new Promise(() => {}); }
    return stub.handler(url, init);
  };
  await ask(doc, 'Question pendant la panne'); await wait(20);
  assert.equal(posts, 1);
  assert.equal(signal.aborted, true);
  assert.equal($(doc, 'chat-send').disabled, false);
  assert.equal($(doc, 'chat-text').value, 'Question pendant la panne');
});

test('a response arriving after the panel closes counts as unread', async () => {
  const { doc, win, stub } = await boot();
  const pending = gate();
  win.fetch = (url, init) => String(url).includes('/support/messages') ? pending.promise : stub.handler(url, init);
  await ask(doc, 'Question');
  $(doc, 'chat-close').click();
  const createdAt = new Date().toISOString();
  pending.resolve(response({ threadId: 'th-async', token: 'tok-async', message: { id: 'q1', de: 'visiteur', texte: 'Question', createdAt }, reponse: { id: 'a1', de: 'assistant', texte: 'Réponse', createdAt } }, 201));
  // Keep the created thread valid when the immediate follow-up poll runs.
  stub.threads.set('tok-async', { id: 'th-async', messages: [{ id: 'a1', de: 'assistant', texte: 'Réponse', createdAt }] });
  await wait(20);
  assert.equal($(doc, 'chat-fab-dot').hidden, false);
  $(doc, 'chat-fab').click(); await wait(10);
  assert.equal($(doc, 'chat-fab-dot').hidden, true);
});

test('closing the mobile chat returns focus to the visible menu button', async () => {
  const { doc, win } = await boot();
  win.matchMedia = () => ({ matches: true });
  $(doc, 'chat-fab').click();
  $(doc, 'chat-close').click();
  assert.equal(doc.activeElement, $(doc, 'nav-burger'));
});

test('an uncertain first message reuses its exact body and private recovery key until confirmed', async () => {
  const { doc, win, stub } = await boot();
  const attempts = [];
  win.fetch = (url, init) => {
    if (String(url).includes('/support/messages')) {
      attempts.push(JSON.parse(init.body));
      if (attempts.length === 1) return Promise.reject(new Error('response lost'));
    }
    return stub.handler(url, init);
  };
  $(doc, 'chat-courriel').value = 'original@example.com';
  await ask(doc, 'Première question à retrouver');
  assert.match(attempts[0].requestKey, /^[A-Za-z0-9_-]{43}$/);
  assert.match(attempts[0].messageId, /^[A-Za-z0-9_.:@-]+$/);
  $(doc, 'chat-courriel').value = 'modified@example.com'; input($(doc, 'chat-courriel'));
  submit($(doc, 'chat-form')); await wait(30);
  assert.deepEqual(attempts[1], attempts[0], 'a replay carries exactly the body the server originally received');
  assert.equal($(doc, 'chat-courriel-status').hidden, true, 'a later email edit must not be announced as saved');
  assert.equal(win.localStorage.getItem('nota.support.v1').includes(attempts[0].requestKey), false);
  await ask(doc, 'Message suivant');
  assert.equal(attempts[2].requestKey, undefined, 'the confirmed token replaces the first-request secret');
  assert.notEqual(attempts[2].messageId, attempts[0].messageId);
});

test('existing-thread retries and recovery buttons reuse their message ID', async () => {
  const { doc, win, stub } = await boot();
  await ask(doc, 'Fil existant');
  const pending = gate(), attempts = [];
  win.fetch = (url, init) => {
    if (String(url).includes('/support/messages')) { attempts.push(JSON.parse(init.body)); return pending.promise; }
    return stub.handler(url, init);
  };
  await ask(doc, 'Réponse de réseau incertaine');
  $(doc, 'chat-text').value = 'Nouveau brouillon';
  pending.resolve(response({}, 503)); await wait(20);
  const recovery = $(doc, 'chat-log').querySelector('[data-delivery="unconfirmed"] button');
  $(doc, 'chat-text').value = ''; recovery.click();
  win.fetch = (url, init) => {
    if (String(url).includes('/support/messages')) attempts.push(JSON.parse(init.body));
    return stub.handler(url, init);
  };
  submit($(doc, 'chat-form')); await wait(30);
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(attempts[0].requestKey, undefined);
  assert.equal($(doc, 'chat-log').querySelector('[data-delivery="unconfirmed"]'), null);
});

test('different first messages never reuse the same first-request recovery secret', async () => {
  const { doc, win, stub } = await boot(); const attempts = [];
  win.fetch = (url, init) => {
    if (String(url).includes('/support/messages')) { attempts.push(JSON.parse(init.body)); return Promise.reject(new Error('offline')); }
    return stub.handler(url, init);
  };
  await ask(doc, 'Première tentative');
  await ask(doc, 'Question différente');
  assert.notEqual(attempts[0].requestKey, attempts[1].requestKey);
  assert.notEqual(attempts[0].messageId, attempts[1].messageId);
});

test('a visitor email link restores the same conversation in a fresh browser', async () => {
  const stub = supportStub();
  stub.threads.set('visitor-email-token', { id: 'emailed-thread', courriel: 'client@example.com', messages: [
    { id: 'email-answer', de: 'nota', texte: 'Réponse déjà reçue par courriel', createdAt: stub.stamp() },
  ] });
  const { doc, win } = await boot({ hash: '#messagerie=visitor-email-token', stub });
  assert.equal(win.location.hash, '', 'the bearer must immediately leave the address bar');
  const stored = JSON.parse(win.localStorage.getItem('nota.support.v1'));
  assert.equal(stored.threadId, 'emailed-thread');
  assert.equal(stored.token, 'visitor-email-token');
  assert.equal($(doc, 'chat-panel').hidden, false);
  assert.match($(doc, 'chat-log').textContent, /Réponse déjà reçue par courriel/);
  assert.equal($(doc, 'chat-courriel').value, 'client@example.com');
  assert.equal(stub.calls.filter(c => c.path.includes('/support/thread')).length, 1, 'the verified transcript avoids an immediate duplicate read');
  assert.equal(stub.calls.filter(c => c.path.includes('/support/messages')).length, 0);
});

test('a visitor email link restores its conversation through a same-document hash change', async () => {
  const { doc, win, stub } = await boot();
  stub.threads.set('same-document-visitor', { id: 'same-document-thread', messages: [
    { id: 'same-document-answer', de: 'nota', texte: 'Réponse sur la page déjà ouverte', createdAt: stub.stamp() },
  ] });
  win.location.hash = '#messagerie=same-document-visitor'; await wait(30);
  assert.equal(win.location.hash, '');
  assert.equal($(doc, 'chat-panel').hidden, false);
  assert.match($(doc, 'chat-log').textContent, /Réponse sur la page déjà ouverte/);
  assert.equal(JSON.parse(win.localStorage.getItem('nota.support.v1')).threadId, 'same-document-thread');
  // Even a later hashchange callback sees the stripped URL and cannot replay.
  win.dispatchEvent(new win.HashChangeEvent('hashchange')); await wait(10);
  assert.equal(stub.calls.filter(c => c.path.includes('/support/thread')).length, 1);
  assert.equal(stub.calls.filter(c => c.path.includes('/support/messages')).length, 0);
});

test('an operator email link also opens through a same-document hash change', async () => {
  const { doc, win, stub } = await boot();
  stub.threads.set('same-document-operator', { id: 'operator-thread', messages: [
    { id: 'same-document-question', de: 'visiteur', texte: 'Question à traiter dans cet onglet', createdAt: stub.stamp() },
  ] });
  win.location.hash = '#reponse=same-document-operator'; await wait(30);
  assert.equal(win.location.hash, '');
  assert.equal($(doc, 'chat-reply-dialog').open, true);
  assert.match($(doc, 'chat-reply-log').textContent, /Question à traiter dans cet onglet/);
  assert.equal($(doc, 'chat-reply-dialog').dataset.token, 'same-document-operator');
  win.dispatchEvent(new win.HashChangeEvent('hashchange')); await wait(10);
  assert.equal(stub.calls.filter(c => c.path.includes('/support/thread')).length, 1);
  assert.equal(stub.calls.filter(c => c.path.includes('/support/reply')).length, 0);
});

test('an expired visitor email link preserves the current session and never creates a replacement thread', async () => {
  const session = JSON.stringify({ threadId: 'existing', token: 'existing-token', lastAt: '2026-09-09T10:00:00Z', seenAt: '2026-09-09T09:00:00Z' });
  const { doc, win, stub } = await boot({ hash: '#messagerie=expired-token', seed: { 'nota.support.v1': session } });
  assert.equal(win.location.hash, '');
  assert.equal(win.localStorage.getItem('nota.support.v1'), session);
  assert.match($(doc, 'toast').textContent, /Lien de conversation invalide ou expiré/);
  assert.equal(stub.calls.filter(c => c.path.includes('/support/messages')).length, 0);
});

test('a malformed visitor-link response cannot adopt its token or erase a draft', async () => {
  const stub = supportStub(), pending = gate();
  const original = stub.handler;
  stub.handler = (url, init) => String(url).includes('/support/thread') ? pending.promise : original(url, init);
  const { doc, win } = await boot({ hash: '#messagerie=invalid-shape', stub });
  assert.equal(win.location.hash, '', 'strip the secret before the network finishes');
  $(doc, 'chat-text').value = 'Brouillon pendant la vérification';
  pending.resolve(response({ messages: [] })); await wait(15);
  assert.equal(win.localStorage.getItem('nota.support.v1'), null);
  assert.equal($(doc, 'chat-text').value, 'Brouillon pendant la vérification');
  assert.match($(doc, 'toast').textContent, /Impossible d’ouvrir/);
});

test('a poll that finishes after the tab hides leaves its reply unread', async () => {
  const { doc, win, Nota, stub } = await boot();
  await ask(doc, 'Fil existant');
  const session = JSON.parse(win.localStorage.getItem('nota.support.v1'));
  const pending = gate();
  win.fetch = (url, init) => String(url).includes('/support/thread') ? pending.promise : stub.handler(url, init);
  const read = Nota.support.refresh();
  await wait(5);
  Object.defineProperty(doc, 'hidden', { configurable: true, value: true });
  doc.dispatchEvent(new win.Event('visibilitychange'));
  const reply = { id: 'hidden-poll-reply', de: 'nota', texte: 'Réponse arrivée ailleurs', createdAt: stub.stamp() };
  pending.resolve(response({ messages: [reply] }));
  await read;
  const updated = JSON.parse(win.localStorage.getItem('nota.support.v1'));
  assert.equal(updated.seenAt, session.seenAt, 'an unseen reply must not advance the read cursor');
  assert.equal(updated.lastAt, reply.createdAt);
  assert.equal($(doc, 'chat-fab-dot').hidden, false);
  assert.equal(Nota.support.pollMs(), 0);
});

test('an expired-token retry failure preserves the original question alongside a newer draft', async () => {
  const { doc, win, stub } = await boot();
  await ask(doc, 'Ancien fil');
  const pending = gate(); let posts = 0;
  win.fetch = (url, init) => {
    if (String(url).includes('/support/messages')) {
      posts++;
      return posts === 1 ? Promise.resolve(response({}, 401)) : pending.promise;
    }
    return stub.handler(url, init);
  };
  await ask(doc, 'Question à conserver après expiration');
  assert.equal(posts, 2, 'the rejected token should retry once without its token');
  $(doc, 'chat-text').value = 'Nouveau brouillon';
  pending.resolve(response({}, 503)); await wait(20);
  assert.equal($(doc, 'chat-text').value, 'Nouveau brouillon');
  const failed = $(doc, 'chat-log').querySelector('[data-delivery="unconfirmed"]');
  assert.ok(failed, 'the uncertain retry needs a recoverable bubble');
  assert.match(failed.textContent, /Question à conserver après expiration/);
  $(doc, 'chat-text').value = '';
  failed.querySelector('button').click();
  assert.equal($(doc, 'chat-text').value, 'Question à conserver après expiration');
  assert.equal(posts, 2, 'restoring the question must not send it');
});

test('a poll started before saving an email cannot restore the previous address', async () => {
  const { doc, win, Nota, stub } = await boot();
  await ask(doc, 'Fil existant');
  const pending = gate(); let patches = 0;
  win.fetch = (url, init = {}) => {
    if (String(url).includes('/support/thread')) {
      if (init.method === 'PATCH') {
        patches++;
        assert.equal(JSON.parse(init.body).courriel, 'nouveau@example.com');
        return Promise.resolve(response({ ok: true }));
      }
      return pending.promise;
    }
    return stub.handler(url, init);
  };
  const read = Nota.support.refresh(); await wait(5);
  $(doc, 'chat-courriel').value = 'nouveau@example.com'; input($(doc, 'chat-courriel'));
  $(doc, 'chat-courriel-save').click(); await wait(10);
  assert.equal(patches, 1);
  pending.resolve(response({ messages: [], courriel: 'ancien@example.com' }));
  await read;
  assert.equal($(doc, 'chat-courriel').value, 'nouveau@example.com');
  assert.match($(doc, 'chat-courriel-status').textContent, /Courriel enregistré/);
});

test('email can be saved after sending without another message or losing the composer draft', async () => {
  const { doc, win, stub } = await boot();
  assert.equal($(doc, 'chat-courriel-save').hidden, true);
  await ask(doc, 'Une question');
  assert.equal($(doc, 'chat-courriel-save').hidden, false);
  const before = stub.calls.filter(c => c.path.includes('/support/messages')).length;
  let patch;
  win.fetch = (url, init) => {
    if (String(url).includes('/support/thread') && init.method === 'PATCH') {
      patch = { token: init.headers.authorization, body: JSON.parse(init.body) };
      return Promise.resolve(response({ courriel: patch.body.courriel }));
    }
    return stub.handler(url, init);
  };
  $(doc, 'chat-courriel').value = ' CUSTOMER@EXAMPLE.TEST ';
  $(doc, 'chat-text').value = 'Mon prochain message';
  $(doc, 'chat-courriel-save').click(); await wait(10);
  assert.equal(patch.body.courriel, 'customer@example.test');
  assert.match(patch.token, /^Bearer tok-/);
  assert.equal($(doc, 'chat-text').value, 'Mon prochain message');
  assert.equal(stub.calls.filter(c => c.path.includes('/support/messages')).length, before);
  assert.match($(doc, 'chat-courriel-status').textContent, /Courriel enregistré/);
});

test('invalid emails never reach PATCH and save failure remains visible and retryable', async () => {
  const { doc, win } = await boot();
  await ask(doc, 'Une question');
  let calls = 0;
  win.fetch = async () => { calls++; return response({}, 503); };
  $(doc, 'chat-courriel').value = 'invalide';
  $(doc, 'chat-courriel-save').click(); await wait(5);
  assert.equal(calls, 0);
  assert.match($(doc, 'chat-courriel-status').textContent, /n’est pas valide/);
  $(doc, 'chat-courriel').value = 'customer@example.test';
  $(doc, 'chat-courriel-save').click(); await wait(10);
  assert.equal(calls, 1);
  assert.match($(doc, 'chat-courriel-status').textContent, /non enregistré/);
  assert.equal($(doc, 'chat-courriel-save').disabled, false);
  assert.equal($(doc, 'chat-courriel').value, 'customer@example.test');
});

test('poll restores the saved email without overwriting an email being edited', async () => {
  const { doc, win, Nota } = await boot();
  await ask(doc, 'Une question');
  win.fetch = async () => response({ messages: [], courriel: 'saved@example.test', escalade: false, humain: false });
  await Nota.support.refresh();
  assert.equal($(doc, 'chat-courriel').value, 'saved@example.test');
  $(doc, 'chat-courriel').value = 'new@example.test'; input($(doc, 'chat-courriel'));
  await Nota.support.refresh();
  assert.equal($(doc, 'chat-courriel').value, 'new@example.test');
});
