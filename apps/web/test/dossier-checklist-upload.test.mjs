/**
 * ADR 0032 × the dossier checklist (audit 2.1). The retained band's document
 * block used to be a flat « Joindre un document » under the thread, with no
 * link to the checklist the client had already seen in their Dossier — so a
 * client sent « scan.pdf » and the notary guessed what it was.
 *
 * Now the block OPENS ON THE ACT'S CHECKLIST: one row per document the act
 * asks for, each with its own « Joindre ». The association is kept on the
 * device (nota.docitems.v1 — the API's dépôt door only reads nom/taille/type,
 * an `item` field would be dropped on the floor, so it is never sent), the
 * row is marked sent once the server CONFIRMS the deposit, and the declared
 * name lands in the dossier too — which is what tells the notary's demande
 * that the piece is provided. The free « Autre document » row stays.
 *
 * Harness mirrors mise-en-relation-client.test.mjs (jsdom + fetch stub keyed
 * by URL, a retained offer seeded on the device).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch { /* already closed */ } } });

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

const DATE = addDays(todayISO(), 6);
const OFFER = { id: 'o1', dateISO: DATE, serviceId: 'refinancement', montant: 2400, clientToken: 'tok-o1', retained: true, etude: 'Étude Roy' };

// A tiny stand-in for the API's three document doors + the direct PUT to the
// storage. `documents` is the server's list — a confirmed deposit lands there
// and the next GET /client/bid returns it, exactly like the real flow.
function makeRoutes(initialDocs = []) {
  const documents = initialDocs.slice();
  const calls = { depot: [], put: [], confirme: [] };
  const routes = [
    { match: (u) => u.includes('/bids?month='), reply: (u) => jsonRes(200, { month: u.slice(-7), bids: [] }) },
    { match: (u) => u.includes('/client/bid?'), reply: () => jsonRes(200, {
      bid: { id: 'o1', serviceId: 'refinancement', dateISO: DATE, montant: 2400, status: 'retenue', etude: 'Étude Roy' },
      notaire: { nom: 'Me Anne Roy', etude: 'Étude Roy', courriel: 'anne@etuderoy.ca', actes: 3 },
      propositions: [], demandes: [], readiness: null, messages: [], documents: documents.slice(),
      acte: { complete: false }, evaluation: null, annulation: null,
    }) },
    { match: (u, init) => u.endsWith('/client/bid/documents') && init.method === 'POST', reply: (u, init) => {
      const b = JSON.parse(init.body); calls.depot.push(b);
      const id = 'doc' + calls.depot.length;
      return jsonRes(200, {
        document: { id, de: 'client', nom: b.nom, taille: b.taille, etat: 'en_attente' },
        depot: { url: 'https://depot.example/offres/o1/' + id + '.pdf', methode: 'PUT', entetes: { 'content-type': 'application/pdf' } },
      });
    } },
    { match: (u) => u.startsWith('https://depot.example/'), reply: (u, init) => { calls.put.push(init); return { ok: true, status: 200 }; } },
    { match: (u) => u.endsWith('/client/bid/documents/confirme'), reply: (u, init) => {
      const b = JSON.parse(init.body); calls.confirme.push(b);
      const d = { id: b.documentId, de: 'client', nom: calls.depot[calls.depot.length - 1].nom, taille: 1024, etat: 'pret', createdAt: new Date().toISOString() };
      documents.push(d);
      return jsonRes(200, { document: d });
    } },
    { match: (u) => u.endsWith('/client/dossier'), reply: () => jsonRes(200, { readiness: {}, demandes: [] }) },
  ];
  return { routes, calls, documents };
}

async function boot({ routes = [], seed = {} } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {} };
        const r = routes.find((x) => x.match(call.url, call.init));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
      window.scrollTo = () => {};
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, JSON.stringify(seed[k])));
    },
  });
  const win = dom.window;
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain };
}

const SEED = { 'nota.myoffers.v1': [OFFER] };
const ls = (win, k) => JSON.parse(win.localStorage.getItem(k) || 'null');

async function openBand(Nota, doc) {
  Nota.setTab('profil');
  await wait(60);
  const block = doc.querySelector('.my-offer-detail[data-for="o1"] .my-offer-chat .chat-docs');
  assert.ok(block, 'the document block sits under the thread of the retained band');
  return block;
}

function pick(win, input, file) {
  Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
}

// The accept list the domain validator actually honours — extension → MIME.
function expectedAccept(D) {
  const types = D.DOCUMENT_TYPES;
  const exts = Object.keys(types).map((e) => '.' + e);
  const mimes = [];
  Object.keys(types).forEach((e) => types[e].forEach((m) => { if (!mimes.includes(m)) mimes.push(m); }));
  return exts.concat(mimes).join(',');
}

test('the block opens on the act’s checklist — one row per document, each with its own « Joindre » — plus the free row', async () => {
  const { routes } = makeRoutes();
  const { doc, Nota, D } = await boot({ routes, seed: SEED });
  const block = await openBand(Nota, doc);

  const rows = [...block.querySelectorAll('.chat-doc-item')];
  // What the domain lists for a client with no answers yet (F2: a document
  // conditioned on an answer waits for it) — spread out of the jsdom realm.
  const expected = [...D.dossierItems('refinancement', {}).filter((it) => it.kind === 'doc').map((d) => d.id)];
  assert.deepEqual(rows.map((r) => r.dataset.item), expected, 'one row per checklist document, in the act’s order');
  for (const row of rows) {
    assert.equal(row.dataset.sent, 'false', 'nothing sent yet');
    assert.match(row.querySelector('.chat-doc-item-name').textContent, /\S/, 'the row names its document');
    const btn = row.querySelector('button.chat-doc-add');
    assert.ok(btn && btn.dataset.item === row.dataset.item, 'its own Joindre, bound to the item');
    assert.equal(btn.textContent, 'Joindre');
    const input = row.querySelector('input[type="file"]');
    assert.ok(input && input.dataset.item === row.dataset.item, 'its own file input, bound to the item');
  }
  // The free row survives: a document the checklist did not foresee.
  const free = block.querySelector('.chat-doc-free');
  assert.ok(free, 'the free « Autre document » row');
  assert.match(free.textContent, /Autre document/);
  const freeBtn = free.querySelector('button.chat-doc-add');
  assert.ok(freeBtn && !freeBtn.dataset.item, 'the free Joindre carries no item');
  assert.equal(block.querySelector('.chat-doc-vide'), null, 'the checklist is the empty state — no « Aucun document » line');
});

test('attaching from a row uploads, keeps the association on the device, marks the row sent and declares the piece in the dossier', async () => {
  const { routes, calls } = makeRoutes();
  const { win, doc, Nota } = await boot({ routes, seed: SEED });
  const block = await openBand(Nota, doc);

  const row = block.querySelector('.chat-doc-item[data-item="releve_hypotheque"]');
  pick(win, row.querySelector('input[type="file"]'), { name: 'releve.pdf', size: 1024, type: 'application/pdf' });
  await wait(120);

  // The three doors, in order — and no `item` on the wire: the API's dépôt
  // door reads nom/taille/type only, so the association is a device fact.
  assert.equal(calls.depot.length, 1, 'one dépôt authorization');
  assert.equal(calls.depot[0].nom, 'releve.pdf');
  assert.equal(calls.depot[0].taille, 1024);
  assert.ok(!('item' in calls.depot[0]), 'item stays on the device (the API would drop it)');
  assert.equal(calls.put.length, 1, 'the bytes went straight to the storage');
  assert.equal(calls.put[0].method, 'PUT');
  assert.deepEqual(calls.confirme, [{ id: 'o1', dateISO: DATE, documentId: 'doc1' }]);

  // The device remembers which checklist item the document answers.
  assert.deepEqual(ls(win, 'nota.docitems.v1'), { o1: { doc1: 'releve_hypotheque' } });
  // …and the dossier now declares the piece by its cleaned name — the same
  // fact the Dossier pane and the notary's demande read.
  assert.equal(ls(win, 'nota.dossier.v1').refinancement.releve_hypotheque, 'releve.pdf');

  // The band repainted from the server's list: the row is sent.
  const block2 = doc.querySelector('.my-offer-detail[data-for="o1"] .chat-docs');
  const sent = block2.querySelector('.chat-doc-item[data-item="releve_hypotheque"]');
  assert.equal(sent.dataset.sent, 'true');
  const open = sent.querySelector('button.chat-doc-open');
  assert.ok(open && open.textContent === 'releve.pdf', 'the sent document opens from its row');
  assert.match(sent.querySelector('.chat-doc-meta').textContent, /Envoyé/);
  assert.equal(sent.querySelector('button.chat-doc-add'), null, 'no second Joindre on a sent row');
  // The other rows still wait.
  const others = [...block2.querySelectorAll('.chat-doc-item')].filter((r) => r.dataset.item !== 'releve_hypotheque');
  assert.ok(others.length && others.every((r) => r.dataset.sent === 'false' && r.querySelector('button.chat-doc-add')));
});

test('a document the device cannot place — the notary’s, or a free upload — stays in the flat list', async () => {
  const notary = { id: 'n1', de: 'notaire', nom: 'instructions.pdf', taille: 900, etat: 'pret', createdAt: '2026-09-03T10:00:00.000Z' };
  const { routes } = makeRoutes([notary]);
  const { doc, Nota } = await boot({ routes, seed: SEED });
  const block = await openBand(Nota, doc);
  const li = block.querySelector('.chat-doc-list .chat-doc[data-doc="n1"]');
  assert.ok(li, 'the notary’s document is listed');
  assert.match(li.querySelector('.chat-doc-meta').textContent, /Envoyé par le notaire/);
  assert.ok([...block.querySelectorAll('.chat-doc-item')].every((r) => r.dataset.sent === 'false'), 'no checklist row claims it');
});

test('every picker in the block accepts exactly what the validator lets through — never image/*', async () => {
  const { routes } = makeRoutes();
  const { doc, Nota, D } = await boot({ routes, seed: SEED });
  const block = await openBand(Nota, doc);
  const inputs = [...block.querySelectorAll('input[type="file"]')];
  assert.ok(inputs.length >= 2);
  for (const input of inputs) {
    assert.equal(input.accept, expectedAccept(D));
    assert.ok(!/image\/\*/.test(input.accept), 'no wildcard broader than the validator');
  }
});
