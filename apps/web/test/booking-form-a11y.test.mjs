/**
 * Booking form mechanics (audit §2, 2026-09-02): the sheet's question block
 * must be usable with a screen reader and legible in its errors.
 *
 *   2.3  every segmented answer group carries an accessible name
 *        (aria-labelledby → its own label); the déplacement rows are named.
 *   2.4  a question's help is wired to its control (aria-describedby).
 *   2.5  a required question still awaiting its answer says so: aria-invalid
 *        on the control and an inline « Réponse requise » — once the client
 *        has started the form (never on a fresh sheet).
 *   2.6  the server's refusal list takes focus and offers a door to the
 *        question it names.
 *   2.7  the postal sector is a numbered step (« Où signez-vous ? »), not an
 *        orphan between the offer and the identity.
 *   2.8  the Nota select's trigger is a combobox that controls its listbox.
 *   2.9  the loan amount field: a valid placeholder, min 1, a help line.
 *   2.13 a refused file is announced (role=alert), not merely displayed.
 *   2.14 the profile's sector field is named, explained and autocompleted.
 *   2.15 step 2 lays out on a grid (reading order = DOM order), never multicol.
 *   2.18 the sector fields capitalize as you type.
 *
 * Harness mirrors booking-defaults.test.mjs.
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
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const monthRoute = () => ({ match: (u) => u.includes('/bids?month='), reply: (u) => jsonRes(200, { month: u.slice(-7), bids: [] }) });

async function boot({ routes = [] } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const r = routes.find((x) => x.match(String(u), init || {}));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(String(u), init || {}));
      };
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    },
  });
  const win = dom.window;
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(70);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain };
}

async function openRefinancement(doc) {
  const iso = addDays(todayISO(), 6);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(20);
  return iso;
}
const row = (doc, crit) => doc.querySelector('#o-criteria .crit-row[data-crit="' + crit + '"]');
const byId = (doc, ids) => String(ids || '').split(/\s+/).filter(Boolean).map((id) => $(doc, id));

test('2.3 — every segmented answer group is named by its own label; the déplacement rows are named', async () => {
  const { doc, D } = await boot();
  await openRefinancement(doc);
  const ap = row(doc, 'approbation_bancaire');
  const grp = ap.querySelector('.seg.crit-choices[role="group"]');
  const [lbl] = byId(doc, grp.getAttribute('aria-labelledby'));
  assert.ok(lbl && lbl.classList.contains('crit-label'), 'the group is labelled by the question');
  assert.equal(lbl.textContent, D.serviceById('refinancement').pricing.criteria.find((c) => c.id === 'approbation_bancaire').label);

  const dep = row(doc, 'deplacement');
  const [quiLbl] = byId(doc, dep.querySelector('.crit-dep-qui[role="group"]').getAttribute('aria-labelledby'));
  assert.equal(quiLbl.textContent, 'Qui se déplace');
  const [kmLbl] = byId(doc, dep.querySelector('.crit-dep-km[role="group"]').getAttribute('aria-labelledby'));
  assert.match(kmLbl.textContent, /Jusqu’où/);
});

test('2.4 — a question’s help describes its control', async () => {
  const { doc } = await boot();
  await openRefinancement(doc);
  const ap = row(doc, 'approbation_bancaire');
  const help = ap.querySelector('.help');
  assert.ok(help.id, 'the help carries an id');
  assert.ok(byId(doc, ap.querySelector('[role="group"]').getAttribute('aria-describedby')).includes(help), 'the group is described by it');

  const pr = row(doc, 'preteur');
  const prHelp = pr.querySelector(':scope > .help');
  assert.ok(byId(doc, pr.querySelector('.nselect-btn').getAttribute('aria-describedby')).includes(prHelp), 'the select’s visible trigger is described by it');

  const lv = row(doc, 'valeur_pret');
  const lvHelp = lv.querySelector('.help');
  assert.ok(byId(doc, $(doc, 'crit-valeur_pret').getAttribute('aria-describedby')).includes(lvHelp), 'the amount input is described by its help');
});

test('2.5 — an awaited required answer is marked invalid and says « Réponse requise » once the form is started', async () => {
  const { win, doc } = await boot();
  await openRefinancement(doc);
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));
  // A fresh sheet: the dot stays quiet, no shouting before the client typed.
  const ap = row(doc, 'approbation_bancaire');
  assert.ok(ap.classList.contains('crit-missing'));
  const note0 = ap.querySelector('.crit-req');
  assert.ok(!note0 || note0.hidden, 'no inline note on a fresh sheet');
  // The client starts the form.
  const lv = $(doc, 'crit-valeur_pret'); lv.value = '300000'; fire(lv, 'input');
  await wait(10);
  const note = ap.querySelector('.crit-req');
  assert.ok(note && !note.hidden, 'the awaited question now says so inline');
  assert.equal(note.textContent, 'Réponse requise');
  assert.equal(ap.querySelector('[role="group"]').getAttribute('aria-invalid'), 'true');
  const pr = row(doc, 'preteur');
  assert.equal(pr.querySelector('.nselect-btn').getAttribute('aria-invalid'), 'true');
  // An answered question carries neither.
  const lvRow = row(doc, 'valeur_pret');
  assert.ok(!lvRow.classList.contains('crit-missing'));
  assert.equal(lv.getAttribute('aria-invalid'), null);
  const lvNote = lvRow.querySelector('.crit-req');
  assert.ok(!lvNote || lvNote.hidden);
  // Answering clears the mark.
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  await wait(10);
  assert.equal(ap.querySelector('[role="group"]').getAttribute('aria-invalid'), null);
  assert.ok(ap.querySelector('.crit-req').hidden);
});

test('2.6 — the server’s refusal takes focus and each named question gets a door', async () => {
  const routes = [monthRoute(), {
    match: (u, init) => u.endsWith('/bids') && init.method === 'POST',
    reply: () => jsonRes(422, { errors: [{ code: 'parametre_requis', param: 'preteur', message: 'Réponse requise : Prêteur hypothécaire.' }] }),
  }];
  const { win, doc } = await boot({ routes });
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));
  await openRefinancement(doc);
  const lv = $(doc, 'crit-valeur_pret'); lv.value = '300000'; fire(lv, 'input');
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  const p = $(doc, 'crit-preteur'); p.value = 'banque_nationale'; fire(p, 'change');
  const pre = $(doc, 'o-prefix'); pre.value = 'G1R'; fire(pre, 'input');
  const nom = $(doc, 'o-name'); nom.value = 'Prénom Nom'; fire(nom, 'input');
  const em = $(doc, 'o-courriel'); em.value = 'client@exemple.ca'; fire(em, 'input');
  assert.equal($(doc, 'offer-submit').disabled, false);
  fire($(doc, 'offer-form'), 'submit');
  await wait(40);
  const box = $(doc, 'offer-errors');
  assert.equal(box.hidden, false);
  assert.equal(box.getAttribute('tabindex'), '-1', 'focusable by script');
  assert.equal(doc.activeElement, box, 'the refusal takes focus');
  const door = box.querySelector('li button.offer-hint-link');
  assert.ok(door, 'the named question has a door');
  door.click();
  await wait(10);
  assert.ok(row(doc, 'preteur').contains(doc.activeElement), 'the door lands on the question');
});

test('2.7 — the postal sector is step 4, « Où signez-vous ? », ahead of the identity', async () => {
  const { doc } = await boot();
  const step = $(doc, 'prefix-row').closest('.book-step');
  assert.ok(step, 'the sector sits in a numbered step');
  assert.equal(step.querySelector('.step').textContent, '4');
  assert.match(step.querySelector('.book-step-lbl').textContent, /Où signez-vous/);
  assert.equal($(doc, 'identity-rows').closest('.book-step'), null, 'the identity rows are not folded into it');
  assert.ok(step.compareDocumentPosition($(doc, 'identity-rows')) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);
});

test('2.8 — the Nota select trigger is a combobox controlling its listbox', async () => {
  const { doc } = await boot();
  await openRefinancement(doc);
  const wrap = $(doc, 'crit-preteur').closest('.nselect');
  const btn = wrap.querySelector('.nselect-btn');
  assert.equal(btn.getAttribute('role'), 'combobox');
  const list = wrap.querySelector('.nselect-list');
  assert.ok(list.id, 'the listbox has an id');
  assert.equal(btn.getAttribute('aria-controls'), list.id);
  // The static contact select too — every enhanced select, not only the dynamic one.
  const ct = $(doc, 'ct-sujet').closest('.nselect');
  assert.equal(ct.querySelector('.nselect-btn').getAttribute('aria-controls'), ct.querySelector('.nselect-list').id);
});

test('2.9 — the loan amount field: a numeric placeholder, min 1, and a help line', async () => {
  const { doc } = await boot();
  await openRefinancement(doc);
  const inp = $(doc, 'crit-valeur_pret');
  assert.equal(inp.placeholder, '350000', 'a placeholder a number input accepts');
  assert.equal(inp.min, '1', 'the domain wants > 0');
  assert.match(row(doc, 'valeur_pret').querySelector('.help').textContent, /prêteur vous avance/);
});

test('2.13 — a refused file is announced: the message is an alert, in the dossier and in the profile', async () => {
  const { doc, Nota } = await boot();
  Nota.setTab('dossier');
  const dErr = doc.querySelector('#dossier-list .dossier-row .file-error');
  assert.equal(dErr.getAttribute('role'), 'alert');
  Nota.setTab('profil');
  doc.querySelector('.profil-doc-chips .chip[data-svc="financement"]').click();
  const pErr = doc.querySelector('.profil-doc-list .file-error');
  assert.equal(pErr.getAttribute('role'), 'alert');
});

test('2.14 — the profile’s sector field is « Secteur postal », explained, autocompleted, capitalized', async () => {
  const { doc } = await boot();
  const { Nota } = doc.defaultView;
  Nota.setTab('profil');
  const inp = $(doc, 'p-prefixe');
  assert.equal(doc.querySelector('label[for="p-prefixe"]').textContent, 'Secteur postal');
  assert.equal(inp.getAttribute('autocomplete'), 'postal-code');
  assert.equal(inp.getAttribute('autocapitalize'), 'characters');
  assert.equal(inp.maxLength, 3);
  const help = byId(doc, inp.getAttribute('aria-describedby'))[0];
  assert.ok(help && /3 premiers caractères/.test(help.textContent), 'the field explains itself');
});

test('2.15 — step 2 is a grid whose reading order is the DOM order; the déplacement row spans it', async () => {
  const rule = CSS_SRC.match(/#o-criteria, #o-criteria > \.crit-more \.o-criteria \{[^}]*\}/);
  assert.ok(rule, 'the step-2 layout rule exists');
  assert.match(rule[0], /display:\s*grid/);
  assert.ok(!/(?<!-)columns:/.test(rule[0]), 'no multicol: a column break scrambles the question order');
  assert.match(CSS_SRC, /\.crit-row--wide\s*\{[^}]*grid-column:\s*1 \/ -1/, 'a wide row spans the grid');
  const { doc } = await boot();
  await openRefinancement(doc);
  assert.ok(row(doc, 'deplacement').classList.contains('crit-row--wide'), 'the two-row déplacement control takes the full width');
});

test('2.18 — the sector fields capitalize as you type', async () => {
  const { doc } = await boot();
  assert.equal($(doc, 'o-prefix').getAttribute('autocapitalize'), 'characters');
});
