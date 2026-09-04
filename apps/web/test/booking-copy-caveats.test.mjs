/**
 * The booking sheet's copy and the déplacement control (audit §1 and §3,
 * the parts that live in the web layer):
 *
 *   §1.1  a direction that few notaries serve says so, right where it is
 *         chosen — static caveats (text, never a live count) under the rows.
 *   §1.9  bank approval not in hand + a date under two weeks = a note.
 *   §1.11 the step-2 sub-label says what the answers adjust.
 *   §1.6  the Dossier's price-question copy no longer claims to move the
 *         price of an offer already published.
 *   §1.13 the rate-expiry field is a date; §1.14 the address autocompletes.
 *   §3.2  the radius row asks the question the direction implies.
 *   §3.3  « Urgence en ligne » is an opt-in line, not a third « who travels ».
 *   2.11  answers older than a month are flagged; the loan amount is asked again.
 *   2.16  radius bands read cheapest-first in both directions.
 *   2.19  no stale « 1.5× » comment survives in the source.
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

async function boot({ routes = [], seed = {} } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {} };
        calls.push(call);
        const r = routes.find((x) => x.match(call.url, call.init));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, JSON.stringify(seed[k])));
    },
  });
  const win = dom.window;
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(70);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, calls };
}

async function openRefinancement(doc, days = 6) {
  const iso = addDays(todayISO(), days);
  doc.defaultView.Nota.selectDate(iso);
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(20);
  return iso;
}
const row = (doc, crit) => doc.querySelector('#o-criteria .crit-row[data-crit="' + crit + '"]');
const ls = (win, k) => JSON.parse(win.localStorage.getItem(k) || 'null');

test('§3.3 — « qui se déplace » offers the in-person directions only; online urgency is an opt-in line with its price', async () => {
  const { win, doc, D } = await boot();
  await openRefinancement(doc);
  const dep = row(doc, 'deplacement');
  const quiBtns = [...dep.querySelectorAll('.crit-dep-qui .seg-btn')];
  // (spread: D lives in the jsdom realm, and strict deepEqual compares prototypes)
  assert.deepEqual(quiBtns.map((b) => b.id), [...D.DEPLACEMENT_QUI.filter((q) => !q.urgence).map((q) => 'crit-deplacement__qui_' + q.id)]);
  const optin = $(doc, 'crit-deplacement__qui_en_ligne');
  assert.ok(optin && optin.type === 'checkbox', 'the urgency is a checkbox');
  const line = optin.closest('label.crit-urgence');
  assert.ok(line, 'on its own opt-in line');
  assert.match(line.textContent, /Je ne peux ni me déplacer ni recevoir le notaire/);
  const band = D.DEPLACEMENTS.find((d) => d.urgence);
  assert.equal(line.querySelector('.crit-add').textContent, '+' + D.money(band.add), 'the price rides the line, from the domain');
  assert.equal(optin.checked, false);

  optin.click();
  await wait(10);
  assert.equal($(doc, 'crit-deplacement').value, band.id);
  assert.equal(optin.checked, true);
  assert.ok(dep.querySelector('.crit-dep-km').hidden, 'no radius for an online signing');
  assert.ok(quiBtns.every((b) => b.getAttribute('aria-pressed') === 'false'), 'no direction pressed while online');

  optin.click();
  await wait(10);
  const crit = D.serviceById('refinancement').pricing.criteria.find((c) => c.id === 'deplacement');
  assert.equal($(doc, 'crit-deplacement').value, crit.defaut, 'opting out returns to the default band');
  assert.equal(dep.querySelector('.crit-dep-km').hidden, false);
  void win;
});

test('§3.2 + 2.16 — the radius row asks the direction’s question, bands cheapest-first in both directions', async () => {
  const { doc, D } = await boot();
  await openRefinancement(doc);
  const dep = row(doc, 'deplacement');
  const kmLbl = $(doc, dep.querySelector('.crit-dep-km').getAttribute('aria-labelledby'));
  assert.equal(kmLbl.textContent, 'Jusqu’où acceptez-vous de vous déplacer ?');
  assert.equal(kmLbl.hidden, false, 'the question is visible, not only announced');
  const order = (qui) => [...D.DEPLACEMENTS.filter((d) => d.qui === qui)].sort((a, b) => a.add - b.add).map((d) => 'crit-deplacement__' + d.id);
  assert.deepEqual([...dep.querySelectorAll('.crit-dep-km .seg-btn')].map((b) => b.id), order('client'));

  $(doc, 'crit-deplacement__qui_notaire').click();
  await wait(10);
  assert.equal(kmLbl.textContent, 'Jusqu’où le notaire doit-il se déplacer ?');
  assert.deepEqual([...dep.querySelectorAll('.crit-dep-km .seg-btn')].map((b) => b.id), order('notaire'));
});

test('§1.1 — static caveats under the rows: few notaries travel far, online signing only with those who accept it', async () => {
  const { doc, D } = await boot();
  await openRefinancement(doc);
  const dep = row(doc, 'deplacement');
  const far = dep.querySelector('.crit-caveat[data-caveat="notaire"]');
  const online = dep.querySelector('.crit-caveat[data-caveat="urgence"]');
  assert.ok(far && online, 'both caveats exist in the DOM — static text, never a live count');
  assert.equal(far.hidden, true, 'quiet while the client travels');
  assert.equal(online.hidden, true);

  $(doc, 'crit-deplacement__qui_notaire').click();
  await wait(10);
  assert.equal(far.hidden, false);
  const maxKm = Math.max(...D.DEPLACEMENTS.filter((d) => d.qui === 'notaire').map((d) => d.km));
  assert.match(far.textContent, /Peu de notaires se déplacent/);
  assert.ok(far.textContent.includes(maxKm + ' km'), 'names the far band, from the domain');
  assert.match(far.textContent, /visible que pour eux/);
  assert.equal(online.hidden, true);

  $(doc, 'crit-deplacement__qui_en_ligne').click();
  await wait(10);
  assert.equal(online.hidden, false);
  assert.match(online.textContent, /n’est offerte que par les notaires qui l’acceptent/);
  assert.equal(far.hidden, true);
});

test('§1.9 — bank approval not in hand and a date under two weeks: the note says it is rarely tenable', async () => {
  const { doc } = await boot();
  await openRefinancement(doc, 6);
  const note = () => $(doc, 'o-approbation-note');
  assert.ok(!note() || note().hidden, 'nothing before an answer');
  $(doc, 'crit-approbation_bancaire__en_cours').click();
  await wait(10);
  assert.ok(note() && !note().hidden, 'the note appears');
  assert.match(note().textContent, /moins de deux semaines/);
  assert.ok(row(doc, 'approbation_bancaire').contains(note()), 'under the approval question');
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  await wait(10);
  assert.equal(note().hidden, true, 'approval in hand: no note');
  // Same answer, comfortable notice: no note either.
  $(doc, 'crit-approbation_bancaire__non').click();
  await wait(10);
  assert.equal(note().hidden, false);
  doc.defaultView.Nota.selectDate(addDays(todayISO(), 21));
  await wait(40);
  assert.equal($(doc, 'o-approbation-note').hidden, true, 'three weeks out: the note stands down');
});

test('§1.11 — the step-2 sub-label names both effects of the answers', async () => {
  const { doc } = await boot();
  assert.match($(doc, 'o-criteria-step').querySelector('.book-opt').textContent, /elles ajustent le prix et le temps de préparation/);
});

test('§1.6 — the Dossier’s price-question copy: reused next time, never retroactive', async () => {
  const { doc, Nota } = await boot();
  Nota.setTab('dossier');
  const help = doc.querySelector('#dossier-list .dossier-pricing .help');
  assert.equal(help.textContent, 'Enregistrées dans votre profil et réutilisées pour vos prochaines offres. Le prix d’une offre déjà publiée ne change pas.');
});

test('§1.13 / §1.14 — the rate expiry is a date field, the address autocompletes (dossier and profile)', async () => {
  const { doc, Nota } = await boot();
  Nota.setTab('dossier');
  const dDate = doc.querySelector('#dossier-list .dossier-row input[aria-label="Échéance du taux"]');
  assert.equal(dDate.type, 'date');
  assert.equal(dDate.placeholder, '', 'a date input needs no « Votre réponse »');
  const dAddr = doc.querySelector('#dossier-list .dossier-row input[aria-label="Adresse de l’immeuble"]');
  assert.equal(dAddr.getAttribute('autocomplete'), 'street-address');
  Nota.setTab('profil');
  const pDate = doc.querySelector('.profil-doc-list input[aria-label="Échéance du taux"]');
  assert.equal(pDate.type, 'date');
  assert.equal(doc.querySelector('.profil-doc-list input[aria-label="Adresse de l’immeuble"]').getAttribute('autocomplete'), 'street-address');
});

test('2.11 — answers older than a month are flagged and the loan amount is asked again; fresh ones pass silently', async () => {
  const stale = { refinancement: { __pricing: { valeur_pret: 300000, approbation_bancaire: 'obtenue', preteur: 'desjardins' }, __pricingAt: addDays(todayISO(), -40) } };
  const a = await boot({ seed: { 'nota.dossier.v1': stale } });
  await openRefinancement(a.doc);
  const note = $(a.doc, 'o-criteria-stale');
  assert.ok(note && !note.hidden, 'the sheet warns');
  assert.match(note.textContent, /Vos réponses précédentes/);
  assert.equal($(a.doc, 'crit-valeur_pret').value, '', 'the amount is asked again');
  assert.equal($(a.doc, 'crit-approbation_bancaire__obtenue').getAttribute('aria-pressed'), 'true', 'the choices stay shown for checking');

  const fresh = { refinancement: { __pricing: { valeur_pret: 300000, approbation_bancaire: 'obtenue', preteur: 'desjardins' }, __pricingAt: todayISO() } };
  const b = await boot({ seed: { 'nota.dossier.v1': fresh } });
  await openRefinancement(b.doc);
  const note2 = $(b.doc, 'o-criteria-stale');
  assert.ok(!note2 || note2.hidden, 'fresh answers: no warning');
  assert.equal($(b.doc, 'crit-valeur_pret').value, '300000');
});

test('2.11 — the answers’ timestamp is device state: written on every answer, never on the wire', async () => {
  const DATE = addDays(todayISO(), 6);
  const OFFER = { id: 'o1', dateISO: DATE, serviceId: 'refinancement', montant: 2400, clientToken: 'tok-o1' };
  const { win, doc, Nota, calls } = await boot({
    seed: { 'nota.myoffers.v1': [OFFER] },
    routes: [{ match: (u) => u.endsWith('/client/dossier'), reply: () => jsonRes(200, { readiness: {}, demandes: [] }) }],
  });
  await openRefinancement(doc);
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  await wait(10);
  assert.equal(ls(win, 'nota.dossier.v1').refinancement.__pricingAt, todayISO());
  await wait(700);
  const post = calls.find((x) => x.url.endsWith('/client/dossier'));
  assert.ok(post, 'the dossier was pushed');
  assert.ok(!('__pricingAt' in JSON.parse(post.init.body).dossier), 'the timestamp stays on the device');
});

test('2.19 — no stale « 1.5× market » comment survives: the domain’s multiplier is what it is', () => {
  assert.ok(!/1\.5\s?×|1\.5x/.test(APP_SRC), 'app.js no longer claims a 1.5× quote');
});
