/**
 * The dossier's document rows — the intake a client actually touches.
 *
 * The file NEVER leaves the device (ADR 0010 §4): what the row does is declare
 * a cleaned name, and the UX contract here is:
 *   - the picker only offers what a notary can open (accept=…), and refuses
 *     early — wrong format, oversize — with a visible French message;
 *   - a picked document shows as a chip with Retirer (remove) and Remplacer;
 *   - cancelling the native dialog never erases an already-picked document;
 *   - a row is a drop target: dragging a file onto it picks it;
 *   - a document already provided for the OTHER act is offered for reuse in
 *     one click ("tenir compte des documents déjà téléversés");
 *   - the API push carries the dossier WITHOUT __validated (local UI state).
 *
 * Boot harness mirrors client-offers.test.mjs (domain then app inside jsdom).
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
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
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
        const call = { url: String(u), init: init || {}, headers: (init && init.headers) || {} };
        calls.push(call);
        const r = routes.find((x) => x.match(call.url, call.init));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
      window.scrollTo = () => {};
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, seed[k]));
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, calls };
}

const dossierLS = (win) => JSON.parse(win.localStorage.getItem('nota.dossier.v1') || '{}');

// The FIRST doc row of the open dossier pane (refinancement ⇒ piece_identite).
function firstDocRow(doc) {
  const input = doc.querySelector('#dossier-list .dossier-row input[type="file"]');
  assert.ok(input, 'a file input is rendered');
  return { input, row: input.closest('.dossier-row') };
}

// jsdom's FileList cannot be assigned — hand the handler a plain descriptor.
function pick(win, input, file) {
  Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
}

test('the picker only offers notarial exchange formats (accept from the domain rule)', async () => {
  const { doc, D, Nota } = await boot();
  Nota.setTab('dossier');
  const { input } = firstDocRow(doc);
  assert.equal(input.accept, D.DOSSIER_FILE.accept);
});

test('picking a valid file declares its CLEANED name, shows the chip, Retirer removes it', async () => {
  const { win, doc, Nota } = await boot();
  Nota.setTab('dossier');
  const { input } = firstDocRow(doc);
  pick(win, input, { name: 'C:\\fakepath\\permis.pdf', size: 1024 });
  await wait(10);
  assert.equal(dossierLS(win).refinancement.piece_identite, 'permis.pdf');
  const chip = doc.querySelector('#dossier-list .dossier-row .doc-file-name');
  assert.ok(chip && chip.textContent.includes('permis.pdf'), 'chip names the document');
  const rm = Array.from(doc.querySelectorAll('#dossier-list .dossier-row button'))
    .find((b) => b.textContent === 'Retirer');
  assert.ok(rm, 'Retirer is offered');
  rm.click();
  await wait(10);
  assert.ok(!(dossierLS(win).refinancement || {}).piece_identite, 'removed');
});

test('a wrong format is refused with a visible message and nothing is saved', async () => {
  const { win, doc, Nota } = await boot();
  Nota.setTab('dossier');
  const { input, row } = firstDocRow(doc);
  pick(win, input, { name: 'virus.exe', size: 10 });
  await wait(10);
  assert.ok(!(dossierLS(win).refinancement || {}).piece_identite, 'nothing saved');
  const err = row.querySelector('.file-error');
  assert.ok(err && !err.hidden && /Format/.test(err.textContent), 'the refusal is explained in place');
});

test('an oversize file is refused with the configured limit named', async () => {
  const { win, doc, D, Nota } = await boot();
  Nota.setTab('dossier');
  const { input, row } = firstDocRow(doc);
  pick(win, input, { name: 'permis.pdf', size: D.DOSSIER_FILE.maxBytes + 1 });
  await wait(10);
  assert.ok(!(dossierLS(win).refinancement || {}).piece_identite, 'nothing saved');
  const err = row.querySelector('.file-error');
  assert.ok(err && !err.hidden && /lourd/.test(err.textContent));
});

test('cancelling the native dialog keeps the already-picked document', async () => {
  const seed = { 'nota.dossier.v1': JSON.stringify({ refinancement: { piece_identite: 'permis.pdf' } }) };
  const { win, doc, Nota } = await boot({ seed });
  Nota.setTab('dossier');
  const { input } = firstDocRow(doc);
  pick(win, input, null); // the user cancelled — change fires with no file
  await wait(10);
  assert.equal(dossierLS(win).refinancement.piece_identite, 'permis.pdf', 'still there');
});

test('a document row is a drop target: dropping a file picks it', async () => {
  const { win, doc, Nota } = await boot();
  Nota.setTab('dossier');
  const { row } = firstDocRow(doc);
  const over = new win.Event('dragover', { bubbles: true, cancelable: true });
  row.dispatchEvent(over);
  assert.equal(row.dataset.drop, 'true', 'the target lights up');
  const drop = new win.Event('drop', { bubbles: true, cancelable: true });
  drop.dataTransfer = { files: [{ name: 'permis.pdf', size: 2048 }] };
  row.dispatchEvent(drop);
  await wait(10);
  assert.equal(dossierLS(win).refinancement.piece_identite, 'permis.pdf');
});

test('a document already provided for the other act is offered for one-click reuse', async () => {
  const seed = { 'nota.dossier.v1': JSON.stringify({ financement: { piece_identite: 'permis.pdf' } }) };
  const { win, doc, Nota } = await boot({ seed });
  Nota.setTab('dossier'); // refinancement (first act) — its piece_identite is empty
  const reuse = Array.from(doc.querySelectorAll('#dossier-list .doc-reuse-btn'))
    .find((b) => b.textContent.includes('permis.pdf'));
  assert.ok(reuse, 'the reuse affordance names the existing document');
  reuse.click();
  await wait(10);
  assert.equal(dossierLS(win).refinancement.piece_identite, 'permis.pdf');
  // The sentinel is a per-notary declaration — never offered for reuse.
  const seed2 = { 'nota.dossier.v1': JSON.stringify({ financement: { piece_identite: win.NotaDomain.DOSSIER_TRANSMIS } }) };
  const b2 = await boot({ seed: seed2 });
  b2.Nota.setTab('dossier');
  assert.equal(b2.doc.querySelectorAll('#dossier-list .doc-reuse-btn').length, 0);
});

test('the API push strips __validated — local UI state never goes on the wire', async () => {
  const DATE = addDays(todayISO(), 6);
  const OFFER = { id: 'o1', dateISO: DATE, serviceId: 'financement', montant: 1000, clientToken: 'tok-o1' };
  const { win, doc, Nota, calls } = await boot({
    seed: {
      'nota.myoffers.v1': JSON.stringify([OFFER]),
      'nota.dossier.v1': JSON.stringify({ financement: { __validated: { piece_identite: true } } }),
    },
    routes: [{ match: (u) => u.endsWith('/client/dossier'), reply: () => jsonRes(200, { readiness: {}, demandes: [] }) }],
  });
  $(win.document, 'd-service').value = 'financement';
  Nota.setTab('dossier');
  await wait(20);
  calls.length = 0;
  const { input } = firstDocRow(doc);
  pick(win, input, { name: 'permis.pdf', size: 1024 });
  await wait(700);
  const post = calls.find((x) => x.url.endsWith('/client/dossier'));
  assert.ok(post, 'POST /client/dossier');
  const body = JSON.parse(post.init.body);
  assert.equal(body.dossier.piece_identite, 'permis.pdf');
  assert.ok(!('__validated' in body.dossier), '__validated stays on the device');
});

test('the profile pane refuses a wrong format the same way', async () => {
  const { win, doc, Nota } = await boot();
  Nota.setTab('profil');
  const chip = doc.querySelector('.profil-doc-chips .chip[data-svc="financement"]');
  chip.click();
  const input = doc.querySelector('.profil-doc-list .doc-row input[type="file"]');
  assert.ok(input, 'profile file input');
  assert.equal(input.accept, win.NotaDomain.DOSSIER_FILE.accept);
  pick(win, input, { name: 'virus.exe', size: 10 });
  await wait(10);
  assert.ok(!(dossierLS(win).financement || {}).piece_identite, 'nothing saved');
  const err = doc.querySelector('.profil-doc-list .file-error');
  assert.ok(err && !err.hidden && /Format/.test(err.textContent));
});

test('the file CTA is square like every other action button — never a pill', () => {
  // Owner (2026-08-27): « make it more square ». « Choisir un fichier » was
  // the one pill among the app's rectangular verbs (.btn all sit on
  // var(--radius)); it joins the system. Pills stay for chips and badges.
  const css = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');
  const m = css.match(/\.file-cta\s*\{[^}]*\}/);
  assert.ok(m, '.file-cta rule exists');
  assert.match(m[0], /border-radius:\s*var\(--radius\)/, 'the CTA sits on the shared radius token');
  assert.ok(!/999px/.test(m[0]), 'no pill radius');
});
