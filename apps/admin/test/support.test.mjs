import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const src = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const ADMIN = src('admin.js'), HTML = src('index.html'), I18N = src('i18n.js');
const OPEN = [];
after(() => OPEN.forEach(win => win.close()));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const $ = (win, id) => win.document.getElementById(id);
const input = (win, value) => { $(win, 'support-text').value = value; $(win, 'support-text').dispatchEvent(new win.Event('input', { bubbles: true })); };
const submit = win => $(win, 'support-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await wait(5); } assert.ok(fn(), 'expected UI state did not arrive'); }
function api(permissions = ['*']) {
  const threads = [
    { id: 'thread-one', courriel: 'client@example.com', statut: 'a_repondre', escalade: true, dernierAt: '2026-09-09T12:00:00Z', dernierTexte: 'Ma question', messages: [
      { id: 'visitor-one', de: 'visiteur', texte: 'Ma question', createdAt: '2026-09-09T11:59:00Z' },
      { id: 'assistant-one', de: 'assistant', texte: 'Je transmets la question.', createdAt: '2026-09-09T12:00:00Z' },
    ] },
    { id: 'thread-two', courriel: null, statut: 'repondu', dernierAt: '2026-09-08T12:00:00Z', dernierTexte: 'Déjà répondu', messages: [
      { id: 'nota-two', de: 'nota', texte: 'Déjà répondu', createdAt: '2026-09-08T12:00:00Z' },
    ] },
  ];
  const state = { threads, override: null, posts: [], calls: [] };
  state.handler = async (url, init = {}) => {
    const path = String(url).replace('/api/admin', ''), method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const call = { path, method, body, init }; state.calls.push(call);
    let out = state.override ? await state.override(call) : null;
    if (!out) {
      if (path === '/auth/verify') out = [200, { ok: true, session: 'session-token', role: 'super_admin', expiresAt: new Date(Date.now() + 3600000).toISOString() }];
      else if (path === '/me') out = [200, { email: 'admin@nota.local', permissions, role: 'super_admin' }];
      else if (path.startsWith('/metrics/overview')) out = [200, {}];
      else if (path.startsWith('/support?')) out = [200, { ok: true, threads: threads.map(({ messages, ...thread }) => ({ ...thread, nb: messages.length })), limites: { messageMax: 2000 }, statuts: [
        { id: 'a_repondre', nom: 'À répondre', nomEn: 'To answer' }, { id: 'repondu', nom: 'Répondu', nomEn: 'Answered' }, { id: 'clos', nom: 'Clos', nomEn: 'Closed' },
      ] }];
      else if (path.startsWith('/support/')) {
        const [, , id, action] = path.split('/'), thread = threads.find(t => t.id === id);
        if (!thread) out = [404, {}];
        else if (method === 'GET') out = [200, { ok: true, thread: structuredClone(thread) }];
        else if (action === 'reponse') {
          state.posts.push(call);
          let message = thread.messages.find(m => m.id === body.messageId);
          if (!message) { message = { id: body.messageId, de: 'nota', texte: body.texte, createdAt: '2026-09-09T12:01:00Z' }; thread.messages.push(message); }
          thread.statut = 'repondu'; thread.escalade = false; thread.dernierTexte = body.texte;
          out = [200, { ok: true, message, thread: structuredClone(thread) }];
        } else if (action === 'clos') { thread.statut = 'clos'; out = [200, { ok: true, thread: structuredClone(thread) }]; }
      } else if (path === '/auth/logout') out = [200, { ok: true }];
    }
    const [status, json] = out || [404, {}];
    if (status === 0) throw new Error('offline');
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  return state;
}
async function boot({ state = api(), lang, route = '#/support', resume = false } = {}) {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://admin.nota.example/#/auth?token=T' });
  const win = dom.window; OPEN.push(win); win.fetch = state.handler; win.scrollTo = () => {};
  win.matchMedia = () => ({ matches: false, addEventListener() {} });
  if (resume) win.localStorage.setItem('nota.admin.next', JSON.stringify({ hash: route, at: Date.now() }));
  if (lang) { win.localStorage.setItem('nota.lang', lang); win.eval(I18N); }
  win.eval(ADMIN); await until(() => win.document.querySelector('.admin-rail'));
  win.location.hash = route; await until(() => win.document.querySelector('.page-title')?.textContent === (lang === 'en' ? 'Messages' : 'Messagerie'));
  await wait(20); return { win, state };
}
async function select(win, id = 'thread-one') {
  win.document.querySelector('[data-thread="' + id + '"]').click();
  await until(() => $(win, 'support-log')?.querySelector('[data-message="' + (id === 'thread-one' ? 'visitor-one' : 'nota-two') + '"]'));
}

test('support is an existing-shell route with server-defined filters and the same transcripts', async () => {
  const { win, state } = await boot();
  assert.equal(win.document.querySelector('.admin-rail-link[aria-current="page"]').textContent, 'Messagerie');
  assert.equal(win.document.querySelectorAll('.support-thread').length, 2);
  assert.equal(win.document.querySelector('meta[name="robots"]').content, 'noindex,nofollow');
  $(win, 'support-filter').value = 'a_repondre'; $(win, 'support-filter').dispatchEvent(new win.Event('change'));
  assert.equal(win.document.querySelectorAll('.support-thread').length, 1);
  await select(win);
  assert.equal($(win, 'support-log').children.length, 2);
  assert.match($(win, 'support-log').textContent, /Assistant Nota/);
  assert.equal($(win, 'support-text').maxLength, 2000);
  assert.equal($(win, 'support-log').getAttribute('role'), 'log');
  assert.equal(win.location.hash, '#/support?thread=thread-one');
  assert.equal(state.posts.length, 0);
});

test('permission gates prevent reads and allow a read-only transcript without a composer', async () => {
  const blocked = await boot({ state: api(['support:read']) });
  assert.match(blocked.win.document.querySelector('.admin-denied').textContent, /permission/);
  assert.equal(blocked.state.calls.filter(c => c.path.startsWith('/support')).length, 0);
  const readonly = await boot({ state: api(['support:read', 'pii:read']) });
  await select(readonly.win);
  assert.equal($(readonly.win, 'support-form'), null);
  assert.match(readonly.win.document.querySelector('.support-conversation').textContent, /Lecture seule/);
});

test('replies use the selected existing thread and a stable attempt ID, without losing a newer draft', async () => {
  const { win, state } = await boot(); await select(win);
  const hold = gate();
  state.override = async call => { if (call.method === 'POST' && call.path.endsWith('/reponse')) await hold.promise; return null; };
  input(win, 'Notre réponse'); submit(win); submit(win);
  await wait(5); assert.equal($(win, 'support-send').disabled, true);
  input(win, 'Précision suivante'); hold.resolve();
  await until(() => state.posts.length === 1 && !$(win, 'support-send').disabled);
  assert.equal(state.posts[0].path, '/support/thread-one/reponse');
  assert.match(state.posts[0].body.messageId, /^[A-Za-z0-9_.:@-]+$/);
  assert.equal($(win, 'support-text').value, 'Précision suivante');
  assert.equal($(win, 'support-log').children.length, 3);
  assert.equal(state.calls.some(c => c.path === '/support/messages'), false);
});

test('an uncertain reply retries with the same ID and keeps the draft until confirmed', async () => {
  const { win, state } = await boot(); await select(win);
  let failed;
  state.override = call => { if (call.method === 'POST') { failed = call.body; return [0, null]; } return null; };
  input(win, 'Réponse à reprendre'); submit(win);
  await until(() => $(win, 'support-send-status').textContent.includes('non confirmé'));
  assert.equal($(win, 'support-text').value, 'Réponse à reprendre');
  state.override = null; submit(win);
  await until(() => state.posts.length === 1 && !$(win, 'support-send').disabled);
  assert.deepEqual(state.posts[0].body, failed);
  assert.equal($(win, 'support-text').value, '');
});

test('thread changes preserve drafts and cannot receive a previous thread’s delayed response', async () => {
  const { win, state } = await boot(); await select(win);
  const hold = gate();
  state.override = async call => { if (call.method === 'POST') await hold.promise; return null; };
  input(win, 'Réponse du premier fil'); submit(win); input(win, 'Brouillon du premier fil');
  await select(win, 'thread-two'); hold.resolve(); await wait(15);
  assert.doesNotMatch($(win, 'support-log').textContent, /Réponse du premier fil/);
  await select(win);
  assert.equal($(win, 'support-text').value, 'Brouillon du premier fil');
  assert.match($(win, 'support-log').textContent, /Réponse du premier fil/);
});

test('sending a newer draft retains every uncertain reply and restores its original retry ID', async () => {
  const { win, state } = await boot(); await select(win);
  const hold = gate(); let first;
  state.override = call => { if (call.method === 'POST') { first = call.body; return hold.promise; } return null; };
  input(win, 'Réponse incertaine'); submit(win); input(win, 'Question suivante');
  hold.resolve([503, {}]); await until(() => $(win, 'support-send-status').textContent.includes('non confirmé'));
  state.override = null; submit(win); await until(() => state.posts.length === 1 && !$(win, 'support-send').disabled);
  assert.match($(win, 'support-recover').textContent, /Réponse incertaine/);
  $(win, 'support-recover').querySelector('button').click();
  assert.equal($(win, 'support-text').value, 'Réponse incertaine');
  submit(win); await until(() => state.posts.length === 2);
  assert.deepEqual(state.posts[1].body, first);
});

test('a stale poll cannot replace the answered state after an operator sends', async () => {
  const { win, state } = await boot(); await select(win);
  const hold = gate(); const old = structuredClone(state.threads[0]); let held = false;
  state.override = call => { if (call.method === 'GET' && call.path === '/support/thread-one' && !held) { held = true; return hold.promise; } return null; };
  $(win, 'support-refresh').click(); await until(() => held);
  input(win, 'Réponse confirmée'); submit(win); await until(() => state.posts.length === 1);
  hold.resolve([200, { ok: true, thread: old }]); await wait(15);
  assert.equal(win.document.querySelector('.support-conversation > .support-state').textContent, 'Répondu');
  assert.match($(win, 'support-log').textContent, /Réponse confirmée/);
});

test('polling pauses when hidden and refresh remains single-flight', async () => {
  const { win, state } = await boot(); await select(win);
  const hold = gate(); let reads = 0;
  state.override = call => { if (call.method === 'GET' && call.path === '/support/thread-one') { reads++; return hold.promise; } return null; };
  $(win, 'support-refresh').click(); $(win, 'support-refresh').click(); await wait(10); assert.equal(reads, 1);
  Object.defineProperty(win.document, 'hidden', { configurable: true, value: true }); win.document.dispatchEvent(new win.Event('visibilitychange'));
  hold.resolve([200, { ok: true, thread: state.threads[0] }]); await wait(10);
  $(win, 'support-refresh').click(); await wait(10); assert.equal(reads, 1);
  state.override = null;
  Object.defineProperty(win.document, 'hidden', { configurable: true, value: false }); win.document.dispatchEvent(new win.Event('visibilitychange'));
  await wait(10); assert.ok(state.calls.filter(c => c.path === '/support/thread-one').length >= 3);
});

test('close preserves unfinished replies, then closes the same conversation without a new message', async () => {
  const { win, state } = await boot(); await select(win);
  input(win, 'Brouillon conservé'); $(win, 'support-close').click();
  assert.equal(state.calls.some(c => c.path.endsWith('/clos')), false);
  assert.match($(win, 'support-send-status').textContent, /Terminez/);
  input(win, ''); $(win, 'support-close').click();
  await until(() => $(win, 'support-close').hidden);
  assert.equal(state.threads[0].statut, 'clos');
  assert.equal(state.threads[0].messages.length, 2);
  assert.equal(state.posts.length, 0);
});

test('English UI leaves visitor content intact and renders message text without HTML', async () => {
  const state = api(); state.threads[0].messages[0].texte = 'Votre réponse <img src=x onerror="throw 1">';
  const { win } = await boot({ state, lang: 'en' }); await select(win);
  await until(() => $(win, 'support-send').textContent === 'Send reply');
  assert.match($(win, 'support-log').textContent, /Votre réponse <img/);
  assert.equal($(win, 'support-log').querySelector('img'), null);
  assert.equal(win.document.querySelector('.support-conversation > .support-state').textContent, 'To answer');
  assert.equal(win.document.querySelector('label[for="support-text"]').textContent, 'Your reply');
});

test('failed inbox loads expose a retry and direct links load their existing conversation', async () => {
  const state = api(); state.override = call => call.path.startsWith('/support?') ? [503, {}] : null;
  const { win } = await boot({ state, route: '#/support?thread=thread-one' });
  assert.match($(win, 'support-list-status').textContent, /Impossible/);
  await until(() => $(win, 'support-log'));
  state.override = null; $(win, 'support-refresh').click();
  await until(() => win.document.querySelectorAll('.support-thread').length === 2);
  assert.equal($(win, 'support-list-status').textContent, '');
});

test('a saved conversation destination resumes after sign-in without persisting messages or credentials', async () => {
  const { win, state } = await boot({ route: '#/support?thread=thread-one', resume: true });
  await until(() => $(win, 'support-log'));
  assert.equal(win.location.hash, '#/support?thread=thread-one');
  assert.equal(state.calls.some(c => c.path.startsWith('/metrics/overview')), false, 'sign-in should return directly to the conversation');
  assert.equal(win.localStorage.getItem('nota.admin.next'), null);
  input(win, 'Réponse privée non envoyée');
  const persisted = Array.from({ length: win.localStorage.length }, (_, i) => win.localStorage.getItem(win.localStorage.key(i))).join(' ');
  assert.doesNotMatch(persisted, /session-token|Réponse privée|Ma question/);
});

test('timed-out sends abort and remain retryable without automatically sending twice', async () => {
  const { win, state } = await boot(); await select(win);
  const realTimeout = win.setTimeout.bind(win); win.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms === 15000 ? 15 : ms, ...args);
  let signal, posts = 0;
  state.override = call => { if (call.method === 'POST') { posts++; signal = call.init.signal; return new Promise(() => {}); } return null; };
  input(win, 'Réponse conservée'); submit(win);
  await until(() => $(win, 'support-send-status').textContent.includes('non confirmé'));
  assert.equal(signal.aborted, true); assert.equal(posts, 1);
  assert.equal($(win, 'support-text').value, 'Réponse conservée');
  assert.equal($(win, 'support-send').disabled, false);
});

test('a saved reply with unconfirmed email exposes same-message delivery retry without touching the draft', async () => {
  const { win, state } = await boot(); await select(win);
  let first, sends = 0;
  state.override = call => {
    if (call.method !== 'POST' || !call.path.endsWith('/reponse')) return null;
    sends++;
    if (sends === 1) {
      first = call.body;
      state.threads[0].messages.push({ id: first.messageId, de: 'nota', texte: first.texte, createdAt: '2026-09-09T12:01:00Z', notificationPending: true });
      state.threads[0].statut = 'repondu';
    } else {
      assert.deepEqual(call.body, first);
      state.threads[0].messages.at(-1).notificationPending = false;
    }
    return [200, { ok: true, message: structuredClone(state.threads[0].messages.at(-1)), thread: structuredClone(state.threads[0]), notification: sends === 1 ? { ok: false, retryable: true } : { ok: true } }];
  };
  input(win, 'Réponse enregistrée'); submit(win);
  await until(() => win.document.querySelector('.support-email-state button'));
  assert.match($(win, 'support-send-status').textContent, /courriel non confirmé/);
  input(win, 'Brouillon indépendant'); win.document.querySelector('.support-email-state button').click();
  await until(() => !win.document.querySelector('.support-email-state'));
  assert.equal($(win, 'support-text').value, 'Brouillon indépendant');
  assert.equal(state.threads[0].messages.length, 3);
  assert.equal($(win, 'support-log').children.length, 3);
  assert.equal(sends, 2);
  assert.equal($(win, 'support-send-status').textContent, 'Courriel envoyé.');
});

test('failed delivery retries remain visible and read-only operators cannot trigger them', async () => {
  const state = api(); state.threads[0].messages.push({ id: 'pending-mail', de: 'nota', texte: 'Déjà enregistrée', notificationPending: true });
  const { win } = await boot({ state }); await select(win);
  state.override = call => call.method === 'POST' ? [503, {}] : null;
  input(win, 'À conserver'); win.document.querySelector('.support-email-state button').click();
  await until(() => !win.document.querySelector('.support-email-state button').disabled);
  assert.match(win.document.querySelector('.support-email-state').textContent, /courriel non confirmé/);
  assert.equal($(win, 'support-text').value, 'À conserver');
  const reader = api(['support:read', 'pii:read']); reader.threads[0].messages.push({ id: 'pending-mail', de: 'nota', texte: 'Déjà enregistrée', notificationPending: true });
  const readonly = await boot({ state: reader }); await select(readonly.win);
  assert.ok(readonly.win.document.querySelector('.support-email-state'));
  assert.equal(readonly.win.document.querySelector('.support-email-state button'), null);
});
