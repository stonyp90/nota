import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const D = require('../../../packages/domain/index.js');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const HTML = read('../public/index.html');
const APP = read('../public/app.js');
const DOMAIN = read('../../../packages/domain/index.js');
const I18N = read('../public/i18n.js');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const bidFixture = () => ({
  id: 'packet-file', dateISO: '2026-09-12', serviceId: 'refinancement', notaryId: 'notary@example.ca',
  montant: 2000, tier: 'standard', prefixe: 'G1R', courriel: 'client@example.ca', viaProposition: true,
  dossier: { adresse: '123, rue Exemple', parties_signature: 'Propriétaire seulement', date_echeance_taux: '2026-09-01',
    [D.serviceById('refinancement').documents[0].id]: 'engagement.pdf',
    [D.serviceById('refinancement').documents[1].id]: D.DOSSIER_TRANSMIS },
  pricing: { valeur_pret: 100000, preteur: 'banque_nationale', approbation_bancaire: 'en_cours', succession: 'non' },
});
const makePacket = bid => D.financingWorkPacket(bid, { todayISO: '2026-09-09' });
const analysisFixture = () => ({
  id: 'analysis-packet', createdAt: '2026-09-09T12:00:00Z', sourceOrigin: 'notary_supplied_text',
  preparation: {
    fields: [{ fieldId: 'property_address', value: '125, rue Exemple', evidence: [{ documentId: 'manual-1', page: 2, quote: 'Adresse : 125, rue Exemple' }] },
      { fieldId: 'lender_name', value: 'Banque Exemple', evidence: [{ documentId: 'manual-1', page: 2, quote: 'Prêteur : Banque Exemple' }] }],
    missing: ['borrower_names'], conflicts: [], status: 'needs_notary_review',
  },
  provenance: { model: 'fixture-model', promptSha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64), knowledgeVersion: 'fixture-v1' },
});

// Real domain packets, real app sign-in and DOM boot; every fetch and clipboard
// write is stubbed. No provider, message delivery, or external calls are used.
async function boot(t, { lang = 'fr', bid = bidFixture(), packet, route, clipboard = 'ok' } = {}) {
  const calls = [], copied = [];
  const state = { bid: structuredClone(bid), packet, route };
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://nota.example/?lang=' + lang, beforeParse(win) {
      win.scrollTo = () => {};
      win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      win.HTMLDialogElement.prototype.close = function () { this.open = false; };
      if (clipboard !== 'missing') Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: {
        writeText: async text => {
          if (clipboard === 'rejected') throw new Error('permission denied');
          copied.push(text);
        },
      } });
      win.fetch = async (url, init = {}) => {
        const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
        calls.push(call);
        const path = new URL(call.url, win.location.origin).pathname;
        if (path.includes('/notary/financing/')) {
          if (state.route) return state.route(call, state);
          if (call.method === 'GET') return reply({ analysis: state.bid.financingAnalysis || null,
            workPacket: state.packet === undefined ? makePacket(state.bid) : state.packet });
          if (path.endsWith('/preparation')) {
            state.bid.financingAnalysis = analysisFixture();
            return reply({ ok: true, analysis: state.bid.financingAnalysis, workPacket: makePacket(state.bid) });
          }
          state.bid.financingAnalysis.review = { ...call.body, reviewerId: state.bid.notaryId, reviewedAt: '2026-09-09T12:01:00Z' };
          return reply({ ok: true, review: state.bid.financingAnalysis.review, workPacket: makePacket(state.bid) });
        }
        if (path.endsWith('/notary/session/request')) return reply({ ok: true, devToken: 'challenge' });
        if (path.endsWith('/notary/session/verify')) return reply({ token: 'packet-session', feedToken: 'feed-token', email: bid.notaryId });
        if (path.endsWith('/notary/bids')) return reply({ bids: [], retained: [state.bid],
          profil: { nom: 'Me Exemple', etude: 'Étude Exemple', telephone: '418 555 0100', adresse: '1, rue Exemple, Québec' } });
        throw new Error('offline fixture');
      };
    },
  });
  t.after(() => dom.window.close());
  const win = dom.window;
  win.eval(DOMAIN); win.eval(I18N); win.eval(APP);
  await tick(); await win.Nota.notary.signIn(bid.notaryId); await tick();
  const panel = win.document.querySelector('#notary-retained-list .nc-financing-ai');
  assert.ok(panel);
  return { win, doc: win.document, panel, state, calls, copied,
    apiCalls: () => calls.filter(call => call.url.includes('/notary/financing/')) };
}
async function open(panel) { panel.open = true; await tick(); }
async function submit(form) {
  form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
}
function input(control, value, type = 'input') {
  control.value = value;
  control.dispatchEvent(new control.ownerDocument.defaultView.Event(type, { bubbles: true }));
}
function packetPanel(ctx) { return ctx.panel.querySelector('.nc-financing-work-packet'); }
function copyButton(root, label) {
  const button = [...root.querySelectorAll('button')].find(node => node.textContent === label);
  assert.ok(button, label); return button;
}
function section(root, label) {
  const heading = [...root.querySelectorAll('h4')].find(node => node.textContent === label);
  assert.ok(heading, label); return heading.parentElement;
}

test('lazy work packet uses customer context even with no AI analysis and survives disabled generation', async t => {
  const ctx = await boot(t, { route: (call, state) => call.method === 'GET'
    ? reply({ analysis: null, workPacket: makePacket(state.bid) })
    : reply({ errors: [{ code: 'financing_ai_disabled' }] }, 503) });
  assert.equal(packetPanel(ctx), null); assert.equal(ctx.apiCalls().length, 0);
  assert.equal(ctx.panel.querySelector('summary').textContent, 'Dossier de travail et analyse assistée');
  await open(ctx.panel);
  const packet = packetPanel(ctx);
  assert.equal(packet.open, false);
  assert.equal(packet.querySelector('summary').textContent, 'Dossier de travail préparé par Nota');
  assert.ok(packet.compareDocumentPosition(ctx.panel.querySelector('form')) & ctx.win.Node.DOCUMENT_POSITION_FOLLOWING,
    'assembled customer context comes before the AI input');
  await open(packet);
  assert.equal(ctx.apiCalls().length, 1, 'packet disclosure uses the already loaded response');
  assert.equal(ctx.apiCalls()[0].headers.authorization, 'Bearer packet-session');
  assert.match(packet.textContent, /123, rue Exemple/);
  assert.match(packet.textContent, /Propriétaire seulement/);
  assert.doesNotMatch(section(packet, 'Valeurs préparées pour le dossier').textContent, /Noms des emprunteurs/);
  assert.match(packet.textContent, /Document manquant/);
  assert.match(packet.textContent, /Document déclaré/);
  assert.match(packet.textContent, /Transmis par un autre canal/);
  assert.match(packet.textContent, /échéance du taux déclarée est passée/);
  assert.match(packet.textContent, /Vérifications en attente/);
  assert.match(packet.textContent, /ne constitue pas une approbation juridique/);
  assert.doesNotMatch(packet.textContent, /90\s*%|0[.,]9|pourcentage|réduction mesurée/);
  assert.equal(packet.querySelector('input[type="checkbox"], progress'), null);
  const form = ctx.panel.querySelector('form');
  input(form.elements.text, 'Texte de la page'); form.elements.processingAuthorized.checked = true;
  await submit(form);
  assert.equal(packetPanel(ctx), packet, 'disabled AI leaves the deterministic work packet available');
  assert.match(ctx.panel.querySelector('[role="alert"]').textContent, /fournisseur est désactivé/);
  for (const label of ['Copier le résumé du dossier', 'Copier le brouillon pour le client', 'Copier le brouillon pour le prêteur']) {
    copyButton(packet, label).click(); await tick();
  }
  assert.equal(ctx.copied.length, 3);
  assert.match(ctx.copied[1], /Brouillon à réviser par le notaire avant tout envoi/);
  assert.match(ctx.copied[2], /123, rue Exemple/);
  assert.equal(ctx.apiCalls().length, 2, 'copying drafts never sends messages or document requests');
  assert.equal(ctx.calls.filter(call => /\/message|\/documents/.test(call.url)).length, 0);
});

test('prepare and immutable review responses refresh sources, comparisons, original evidence and recorded time', async t => {
  const ctx = await boot(t); await open(ctx.panel); await open(packetPanel(ctx));
  const form = ctx.panel.querySelector('form');
  input(form.elements.page, '2'); input(form.elements.text, 'Adresse : 125, rue Exemple. Prêteur : Banque Exemple.');
  form.elements.processingAuthorized.checked = true;
  await submit(form);
  let packet = packetPanel(ctx);
  assert.equal(packet.open, true, 'refresh preserves the packet disclosure');
  assert.match(packet.textContent, /Proposition de l’IA/);
  assert.match(section(packet, 'Déclarations et documents à comparer').textContent, /différences de format/);
  const review = ctx.panel.querySelector('.nc-financing-ai-review');
  input(review.elements['decision-0'], 'accepted', 'change');
  input(review.elements['decision-1'], 'corrected', 'change');
  input(review.elements['value-1'], 'Banque corrigée'); input(review.elements['reason-1'], 'Confirmation du prêteur');
  input(review.elements.activeReviewSeconds, '17');
  await submit(review);
  packet = packetPanel(ctx);
  assert.match(packet.textContent, /Accepté par le notaire/);
  assert.match(packet.textContent, /Corrigé par le notaire/);
  assert.doesNotMatch(section(packet, 'Valeurs préparées pour le dossier').textContent, /Proposition de l’IA/);
  const corrected = [...packet.querySelectorAll('.nc-work-packet-field')].find(node => node.textContent.includes('Corrigé par le notaire'));
  assert.match(corrected.textContent, /Banque corrigée/);
  assert.match(corrected.textContent, /Valeur d’origine dans le documentBanque Exemple/);
  assert.match(corrected.textContent, /Les extraits appuient la valeur d’origine, pas la correction/);
  assert.equal(corrected.querySelector('blockquote').textContent, 'Prêteur : Banque Exemple');
  assert.match(section(packet, 'Vérifications en attente').textContent, /Temps de révision consigné \(secondes\)17/);
  copyButton(packet, 'Copier le résumé du dossier').click(); await tick();
  assert.match(ctx.copied[0], /Banque corrigée \[Corrigé par le notaire\]/);
  assert.match(ctx.copied[0], /Valeur d’origine dans le document : Banque Exemple/);
  const previousPreview = packet.querySelector('textarea');
  await ctx.win.Nota.notary.loadBids(); await tick();
  assert.equal(previousPreview.value, '', 'teardown clears selectable private packet drafts');
  ctx.panel = ctx.doc.querySelector('.nc-financing-ai');
  await open(ctx.panel);
  assert.match(packetPanel(ctx).textContent, /Banque corrigée/);
  assert.equal(ctx.apiCalls().filter(call => call.method === 'GET').length, 2);
});

test('null client draft provides no client copy button; absent packet is backward compatible', async t => {
  const packet = makePacket(bidFixture()); packet.clientRequestDraft = null; packet.missing = [];
  const ctx = await boot(t, { packet }); await open(ctx.panel);
  assert.match(packetPanel(ctx).textContent, /Aucun élément à demander au client/);
  assert.ok(![...packetPanel(ctx).querySelectorAll('button')].some(button => /pour le client/.test(button.textContent)));
  const legacy = await boot(t, { route: () => reply({ analysis: null }) }); await open(legacy.panel);
  assert.equal(packetPanel(legacy), null);
  assert.match(legacy.panel.textContent, /Aucune analyse enregistrée/);
});

test('clipboard missing or denied exposes the complete selected draft without sending it', async t => {
  for (const clipboard of ['missing', 'rejected']) await t.test(clipboard, async t => {
    const ctx = await boot(t, { clipboard }); await open(ctx.panel);
    const button = copyButton(packetPanel(ctx), 'Copier le brouillon pour le prêteur');
    button.click(); await tick();
    const block = button.closest('details'), preview = block.querySelector('textarea');
    assert.equal(block.open, true);
    assert.equal(preview.readOnly, true);
    assert.equal(ctx.doc.activeElement, preview);
    assert.equal(preview.selectionStart, 0); assert.equal(preview.selectionEnd, preview.value.length);
    assert.match(block.querySelector('[role="status"]').textContent, /copiez-le manuellement/);
    assert.match(preview.value, /123, rue Exemple/);
    assert.match(preview.value, /instructions générales et particulières/);
    assert.equal(ctx.copied.length, 0); assert.equal(ctx.apiCalls().length, 1);
  });
});

test('English uses domain money and catalogue labels while private values and evidence remain literal', async t => {
  const bid = bidFixture();
  const hostile = '<img src=x onerror="window.pwned=1"> Refinancement hypothécaire 1 350 $';
  bid.dossier.adresse = hostile;
  bid.financingAnalysis = analysisFixture();
  bid.financingAnalysis.preparation.fields[0].value = hostile;
  bid.financingAnalysis.preparation.fields[0].evidence = [{ documentId: hostile, page: 2, quote: hostile }];
  const ctx = await boot(t, { lang: 'en', bid }); await open(ctx.panel);
  const packet = packetPanel(ctx);
  assert.equal(packet.querySelector('summary').textContent, 'Work packet prepared by Nota');
  assert.match(section(packet, 'Customer-provided context').textContent, /In progress/);
  assert.ok(section(packet, 'Customer-provided context').textContent.includes(D.moneyEn(100000)));
  assert.ok(section(packet, 'Prepared file values').textContent.includes(D.moneyEn(100000)));
  assert.ok([...packet.querySelectorAll('[data-i18n-skip]')].some(node => node.textContent === hostile));
  assert.equal(packet.querySelector('blockquote').textContent, hostile);
  copyButton(packet, 'Copy lender draft').click(); await tick();
  assert.ok(ctx.copied[0].includes(hostile));
  assert.ok(ctx.copied[0].includes(D.moneyEn(100000)));
  assert.ok(ctx.copied[0].includes(ctx.win.NotaI18N.t('Banque Nationale')));
  assert.match(ctx.copied[0], /^Draft for the notary to review before sending/);
  assert.match(ctx.copied[0], /Confirm that general and specific instructions/);
  assert.match(ctx.copied[0], /not a confirmation of signing or disbursement/);
  copyButton(packet, 'Copy file summary').click(); await tick();
  assert.ok(ctx.copied[1].includes(hostile));
  assert.match(ctx.copied[1], /\[Customer declaration\]/);
  assert.match(ctx.copied[1], /\[AI proposal\]/);
  assert.equal(packet.querySelector('img, script'), null); assert.equal(ctx.win.pwned, undefined);
});

test('all exported packet static labels, helpers, draft copy, checks and date flags have English coverage', () => {
  const module = { exports: {} }; new Function('module', 'exports', I18N)(module, module.exports);
  const i18n = module.exports; i18n.force('en');
  const strings = new Set();
  function collect(node) {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (['label', 'aide', 'opening', 'closing'].includes(key) && typeof value === 'string' && value) strings.add(value);
      else if (value && typeof value === 'object') collect(value);
    }
  }
  for (const serviceId of ['financement', 'refinancement']) {
    for (const expiry of ['', 'à confirmer', '2026-09-01']) {
      collect(makePacket({ ...bidFixture(), serviceId, dossier: { date_echeance_taux: expiry }, pricing: {} }));
    }
  }
  assert.ok(strings.size > 30);
  const uncovered = [...strings].filter(copy => !i18n.covered(copy));
  assert.deepEqual(uncovered, [], 'missing packet translations');
});

test('delayed clipboard rejection cannot restore a private draft after session teardown', async t => {
  const ctx = await boot(t); await open(ctx.panel);
  let rejectCopy;
  ctx.win.navigator.clipboard.writeText = () => new Promise((_, reject) => { rejectCopy = reject; });
  const packet = packetPanel(ctx);
  const button = copyButton(packet, 'Copier le résumé du dossier');
  const preview = button.closest('details').querySelector('textarea');
  button.click(); await tick();
  ctx.win.Nota.notary.signOut();
  rejectCopy(new Error('denied')); await tick();
  assert.equal(preview.value, '');
  assert.equal(packetPanel(ctx), null);
  assert.notEqual(ctx.doc.activeElement, preview);
});
