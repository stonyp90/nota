import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const HTML = source('../public/index.html');
const APP = source('../public/app.js');
const DOMAIN = source('../../../packages/domain/index.js');
const I18N = source('../public/i18n.js');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const todayISO = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const fixture = () => ({
  id: 'analysis-1', createdAt: '2026-09-09T12:00:00Z',
  sourceOrigin: 'notary_supplied_text',
  preparation: {
    fields: [
      { fieldId: 'property_address', value: '123, rue Exemple' },
      { fieldId: 'lender_name', value: 'Prêteur Exemple' },
      { fieldId: 'lender_name', value: 'Autre prêteur' },
    ].map(field => ({ ...field, evidence: [{ documentId: 'manual-1', page: 7, quote: 'Source : ' + field.value }] })),
    missing: ['borrower_names', 'signing_parties', 'property_identifier', 'property_type', 'lender_contact',
      'loan_amount', 'purchase_price', 'loan_purpose', 'lender_instruction_version',
      'property_changes', 'rate_expiry', 'secured_debts', 'payout_valid_through'],
    conflicts: ['lender_name'], status: 'needs_notary_review',
  },
  provenance: { model: 'fixture-model', promptSha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64), knowledgeVersion: 'fixture-v1' },
});

// Same outside-only boot and real sign-in path as notary-focus.test.mjs.
// Every request is intercepted; these tests cannot reach an AI provider.
async function boot(t, { analysis = null, lang = 'fr', route, count = 1 } = {}) {
  const calls = [];
  const state = { analysis: structuredClone(analysis), route };
  const retained = Array.from({ length: count }, (_, i) => ({
    id: 'file?&' + i, dateISO: todayISO(), serviceId: 'refinancement',
    montant: 2000, tier: 'standard', prefixe: 'G1R', courriel: 'client@example.ca',
    dossier: {}, viaProposition: true,
  }));
  const dom = new JSDOM(HTML, {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://nota.example/?lang=' + lang,
    beforeParse(win) {
      win.scrollTo = () => {};
      win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      win.HTMLDialogElement.prototype.close = function () { this.open = false; };
      win.fetch = async (url, init = {}) => {
        const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
        const path = new URL(call.url, win.location.origin).pathname;
        calls.push(call);
        if (path.includes('/notary/financing/')) {
          if (state.route) return state.route(call, state);
          if (call.method === 'GET') return reply({ analysis: structuredClone(state.analysis) });
          if (path.endsWith('/preparation')) {
            state.analysis = fixture();
            return reply({ ok: true, analysis: structuredClone(state.analysis) });
          }
          state.analysis.review = { ...call.body, reviewedAt: '2026-09-09T12:05:00Z' };
          return reply({ ok: true, review: structuredClone(state.analysis.review) });
        }
        if (path.endsWith('/notary/session/request')) return reply({ ok: true, devToken: 'challenge' });
        if (path.endsWith('/notary/session/verify')) return reply({ token: 'session-token', feedToken: 'feed-token', email: 'notary@example.ca' });
        if (path.endsWith('/notary/bids')) return reply({ bids: [], retained,
          profil: { nom: 'Me Exemple', etude: 'Étude Exemple', telephone: '418 555 0100', adresse: '1, rue Exemple, Québec' } });
        throw new Error('offline fixture');
      };
    },
  });
  t.after(() => dom.window.close());
  const win = dom.window;
  win.eval(DOMAIN);
  win.localStorage.setItem('nota.bids.v1', JSON.stringify(win.NotaDomain.makeFixtures(todayISO())));
  win.localStorage.setItem('nota.bids.sig.v1', win.NotaDomain.seedSignature());
  win.eval(I18N);
  win.eval(APP);
  await tick();
  await win.Nota.notary.signIn('notary@example.ca');
  await tick();
  const panel = win.document.querySelector('#notary-retained-list .nc-preparation details');
  assert.ok(panel, 'retained financing has a nested document analysis disclosure');
  const apiCalls = () => calls.filter(call => call.url.includes('/notary/financing/'));
  return { win, doc: win.document, panel, calls, apiCalls, state, retained };
}

async function toggle(panel, open = true) { panel.open = open; await tick(); }
function input(control, value, event = 'input') {
  control.value = value;
  control.dispatchEvent(new control.ownerDocument.defaultView.Event(event, { bubbles: true }));
}
async function submit(form) {
  form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
}
function labelled(root, label) {
  const wrapper = [...root.querySelectorAll('label')].find(node => node.firstElementChild?.textContent === label);
  assert.ok(wrapper, 'labelled input: ' + label);
  return wrapper.querySelector('input, textarea, select');
}
function sourceForm(panel) { return panel.querySelector('form'); }
function reviewForm(panel) { return panel.querySelector('.nc-financing-ai-review'); }
function fillPage(panel) {
  const form = sourceForm(panel);
  input(form.elements.documentId, 'manual-1');
  input(form.elements.page, '7');
  input(form.elements.text, '  Texte de la page fourni par le notaire.\nDeuxième ligne.  ');
  form.elements.processingAuthorized.checked = true;
  return form;
}
function selectAll(form, decision = 'accepted') {
  for (const select of form.querySelectorAll('select')) input(select, decision, 'change');
}

test('opening retained cards is lazy; only the nested disclosure fetches, with bearer and encoded file identity', async t => {
  const ctx = await boot(t, { count: 3 });
  const { panel, apiCalls, retained } = ctx;
  assert.equal(apiCalls().length, 0);
  assert.equal(panel.open, false);
  assert.equal(panel.querySelector('summary').textContent, 'Dossier de travail et analyse assistée');
  await toggle(panel.parentElement);
  assert.equal(apiCalls().length, 0, 'opening the preparation inventory does not fetch analyses');
  await toggle(panel);
  assert.equal(apiCalls().length, 1);
  assert.equal(apiCalls()[0].url, '/api/notary/financing/preparation?id=' + encodeURIComponent(retained[0].id) + '&dateISO=' + retained[0].dateISO);
  assert.equal(apiCalls()[0].headers.authorization, 'Bearer session-token');
  assert.match(panel.textContent, /Aucune analyse enregistrée/);
  assert.match(panel.textContent, /OCR/);
  assert.match(panel.textContent, /fournies par le notaire/);
  assert.match(panel.textContent, /seulement des propositions/);
  await toggle(panel, false); await toggle(panel);
  assert.equal(apiCalls().length, 1, 'closing and opening the loaded panel keeps its current work');
});

test('analysis needs explicit document authorization and a positive integer page; paste alone never runs AI', async t => {
  const { panel, win, apiCalls, retained } = await boot(t);
  await toggle(panel);
  const form = sourceForm(panel);
  assert.equal(labelled(form, 'Identifiant du document').value, 'manual-1');
  assert.equal(labelled(form, 'Numéro de page').min, '1');
  assert.equal(labelled(form, 'Texte de la page').maxLength, win.NotaDomain.FINANCING_AI_LIMITS.maxPageChars);
  assert.equal(form.elements.processingAuthorized.checked, false);
  assert.match(form.elements.processingAuthorized.labels[0].textContent, /autorisé.*fournisseur d’IA configuré.*sans utilisation pour l’entraînement/);
  input(form.elements.text, 'Texte collé');
  await submit(form);
  assert.equal(apiCalls().length, 1);
  assert.match(panel.querySelector('[role="alert"]').textContent, /autorisation/);
  for (const page of ['0', '-1', '1.5']) {
    input(form.elements.page, page);
    form.elements.processingAuthorized.checked = true;
    await submit(form);
    assert.equal(apiCalls().length, 1);
  }
  fillPage(panel);
  input(form.elements.documentId, 'manual-2');
  assert.equal(form.elements.processingAuthorized.checked, false, 'changing the document requires renewed authorization');
  fillPage(panel);
  const submittedText = form.elements.text.value;
  await submit(form);
  const call = apiCalls()[1];
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.authorization, 'Bearer session-token');
  assert.equal(call.headers['content-type'], 'application/json');
  assert.deepEqual(call.body, { id: retained[0].id, dateISO: retained[0].dateISO,
    pages: [{ documentId: 'manual-1', page: 7, text: submittedText }], processingAuthorized: true });
  assert.equal(form.elements.text.value, '', 'discard local source text after successful generation');
  for (const key of Object.keys(win.localStorage)) assert.ok(!win.localStorage.getItem(key).includes(submittedText), 'source text never enters local storage');
  assert.equal(form.elements.processingAuthorized.checked, false);
  assert.equal(reviewForm(panel).querySelectorAll('select').length, 3);
  for (const select of reviewForm(panel).querySelectorAll('select')) assert.equal(select.value, '', 'no implicit acceptance');
  for (const field of win.NotaDomain.FINANCING_AI_FIELDS) assert.ok(panel.textContent.includes(field.label));
  assert.match(panel.textContent, /Contradictions à examiner/);
  assert.match(panel.textContent, /Source : 123, rue Exemple/);
});

test('all proposals require decisions, corrections and reasons; saves complete indexed decisions and manual seconds once', async t => {
  const { panel, apiCalls, retained, win } = await boot(t, { analysis: fixture() });
  await toggle(panel);
  const form = reviewForm(panel);
  const decisions = [...form.querySelectorAll('select')];
  await submit(form);
  assert.equal(apiCalls().length, 1);
  input(decisions[0], 'accepted', 'change');
  input(decisions[1], 'corrected', 'change');
  input(decisions[2], 'rejected', 'change');
  assert.equal(form.elements['value-1'].disabled, false);
  assert.equal(form.elements['value-1'].maxLength, win.NotaDomain.FINANCING_AI_LIMITS.maxValueChars);
  assert.equal(form.elements['reason-1'].maxLength, win.NotaDomain.FINANCING_AI_LIMITS.maxReasonChars);
  assert.equal(form.elements['reason-2'].required, true);
  input(form.elements['value-1'], '');
  input(form.elements['reason-1'], 'Correction vérifiée');
  input(form.elements['reason-2'], 'Source contradictoire');
  await submit(form);
  assert.equal(apiCalls().length, 1, 'empty correction blocks the whole review');
  input(form.elements['value-1'], 'Prêteur corrigé');
  input(form.elements['reason-2'], '   ');
  await submit(form);
  assert.equal(apiCalls().length, 1, 'blank rejection reason blocks the whole review');
  input(form.elements['reason-2'], 'Source contradictoire');
  for (const seconds of ['-1', '1.5', String(win.NotaDomain.FINANCING_AI_LIMITS.maxReviewSeconds + 1)]) {
    input(form.elements.activeReviewSeconds, seconds);
    await submit(form);
    assert.equal(apiCalls().length, 1);
  }
  input(form.elements.activeReviewSeconds, '42');
  await submit(form);
  assert.deepEqual(apiCalls()[1].body, { id: retained[0].id, dateISO: retained[0].dateISO, analysisId: 'analysis-1',
    decisions: [{ index: 0, decision: 'accepted' },
      { index: 1, decision: 'corrected', value: 'Prêteur corrigé', reason: 'Correction vérifiée' },
      { index: 2, decision: 'rejected', reason: 'Source contradictoire' }], activeReviewSeconds: 42 });
  assert.equal(apiCalls()[1].headers.authorization, 'Bearer session-token');
  assert.equal(apiCalls()[1].url, '/api/notary/financing/review');
  assert.ok(decisions.every(control => control.matches(':disabled')), 'a recorded review is immutable');
  assert.equal(form.querySelector('button[type="submit"]').hidden, true);
  assert.match(form.textContent, /Révision enregistrée pour ce dossier/);
  assert.match(form.textContent, /ne sert pas à l’entraînement.*ne constitue pas une approbation juridique/);
  await submit(form);
  assert.equal(apiCalls().length, 2, 'no second save after success');
});

test('optional time stays null; a saved review reopens read-only, and a new analysis starts fresh decisions', async t => {
  const ctx = await boot(t, { analysis: fixture() });
  await toggle(ctx.panel);
  const form = reviewForm(ctx.panel);
  selectAll(form);
  await submit(form);
  assert.equal(ctx.apiCalls()[1].body.activeReviewSeconds, null);
  const reopened = await boot(t, { analysis: ctx.state.analysis });
  await toggle(reopened.panel);
  const saved = reviewForm(reopened.panel);
  assert.ok([...saved.querySelectorAll('select')].every(control => control.value === 'accepted' && control.matches(':disabled')));
  assert.equal(saved.elements.activeReviewSeconds.value, '');
  await submit(saved);
  assert.equal(reopened.apiCalls().length, 1);
  await submit(fillPage(reopened.panel));
  const fresh = reviewForm(reopened.panel);
  assert.ok([...fresh.querySelectorAll('select')].every(control => control.value === '' && !control.matches(':disabled')));
  assert.equal(fresh.querySelector('button[type="submit"]').hidden, false);
});

test('known API failure codes are explained; unknown failures stay generic without echoing server text', async t => {
  const failures = [
    { status: 503, code: 'financing_ai_disabled', expected: /fournisseur est désactivé ou indisponible.*Aucune nouvelle analyse/ },
    { status: 503, code: 'financing_ai_unavailable', expected: /fournisseur est désactivé ou indisponible.*Aucune nouvelle analyse/ },
    { status: 502, code: 'financing_ai_invalid_output', expected: /n’a pas pu être validée.*Aucune nouvelle proposition/ },
    { status: 422, code: 'autorisation_traitement_requise', expected: /Confirmez votre autorisation/ },
    ...[503, 422, 502, 'offline'].map(status => ({ status, code: 'unknown', expected: /Impossible d’obtenir une analyse IA/ })),
  ];
  for (const { status, code, expected } of failures) await t.test(status + ' ' + code, async t => {
    const { panel, apiCalls } = await boot(t, { route: call => {
      if (call.method === 'GET') return reply({ analysis: null });
      if (status === 'offline') throw new Error('offline');
      return reply({ errors: [{ code, message: '<img src=x onerror=alert(1)>' }] }, status);
    } });
    await toggle(panel);
    const form = fillPage(panel);
    await submit(form);
    assert.equal(apiCalls().length, 2);
    assert.equal(reviewForm(panel), null);
    assert.equal(form.elements.text.matches(':disabled'), false);
    assert.ok(form.elements.text.value.includes('Texte de la page'), 'retain source for a deliberate retry');
    const alert = panel.querySelector('[role="alert"]').textContent;
    assert.match(alert, expected);
    if (code === 'autorisation_traitement_requise') assert.equal(form.elements.processingAuthorized.checked, false);
    assert.doesNotMatch(panel.textContent, /Analyse enregistrée\./);
    assert.equal(panel.querySelector('img'), null);
  });
});

test('a failed lazy load can be retried by reopening; no analysis can run before it resolves', async t => {
  let first = true;
  const { panel, apiCalls } = await boot(t, { route: () => {
    if (first) { first = false; throw new Error('offline'); }
    return reply({ analysis: fixture() });
  } });
  await toggle(panel);
  assert.match(panel.querySelector('[role="alert"]').textContent, /Impossible de charger/);
  await submit(fillPage(panel));
  assert.equal(apiCalls().length, 1);
  await toggle(panel, false); await toggle(panel);
  assert.equal(apiCalls().length, 2);
  assert.ok(reviewForm(panel));
});

test('an in-flight load and analysis cannot submit twice or race with review saving', async t => {
  let resolveRequest;
  const { panel, apiCalls, state } = await boot(t, { route: () => new Promise(resolve => { resolveRequest = resolve; }) });
  await toggle(panel);
  await submit(fillPage(panel));
  assert.equal(apiCalls().length, 1);
  resolveRequest(reply({ analysis: null })); await tick();
  const form = fillPage(panel);
  await submit(form); await submit(form);
  assert.equal(apiCalls().length, 2);
  resolveRequest(reply({ ok: true, analysis: fixture() })); await tick();
  const review = reviewForm(panel);
  selectAll(review);
  await submit(review);
  await submit(fillPage(panel)); await submit(review);
  assert.equal(apiCalls().length, 3);
  state.route = null;
  resolveRequest(reply({ ok: true, review: { decisions: apiCalls()[2].body.decisions, activeReviewSeconds: null } }));
  await tick();
  assert.match(review.textContent, /Révision enregistrée/);
});

test('a 409 review conflict freezes stale decisions until reopening loads the recorded review', async t => {
  const existing = fixture();
  const { panel, apiCalls } = await boot(t, { route: call => {
    if (call.method === 'GET') return reply({ analysis: structuredClone(existing) });
    existing.review = { decisions: existing.preparation.fields.map((_, index) => ({ index, decision: 'rejected', reason: 'Révision déjà faite' })), activeReviewSeconds: 12 };
    return reply({ errors: [{ code: 'analyse_modifiee' }] }, 409);
  } });
  await toggle(panel);
  const form = reviewForm(panel); selectAll(form);
  await submit(form);
  assert.match(form.querySelector('[role="alert"]').textContent, /Fermez ce panneau et rouvrez-le/);
  await submit(form);
  assert.equal(apiCalls().length, 2);
  await toggle(panel, false); await toggle(panel);
  const refreshed = reviewForm(panel);
  assert.ok([...refreshed.querySelectorAll('select')].every(control => control.value === 'rejected' && control.matches(':disabled')));
  assert.equal(refreshed.elements['reason-0'].value, 'Révision déjà faite');
  assert.equal(refreshed.elements.activeReviewSeconds.value, '12');
});

test('failed review saves preserve editable decisions and show no recorded-review claim', async t => {
  for (const failure of ['offline', 422, 503]) await t.test(String(failure), async t => {
    const { panel } = await boot(t, { route: call => {
      if (call.method === 'GET') return reply({ analysis: fixture() });
      if (failure === 'offline') throw new Error('offline');
      return reply({ ok: false }, failure);
    } });
    await toggle(panel);
    const form = reviewForm(panel); selectAll(form);
    await submit(form);
    assert.match(form.querySelector('[role="alert"]').textContent, /Impossible d’enregistrer la révision/);
    assert.doesNotMatch(form.textContent, /Révision enregistrée pour ce dossier/);
    assert.ok([...form.querySelectorAll('select')].every(control => control.value === 'accepted' && !control.matches(':disabled')));
    assert.equal(form.querySelector('button[type="submit"]').hidden, false);
  });
});

test('401 from lazy load, analysis, or review uses the existing session-expiry gate', async t => {
  for (const endpoint of ['GET', '/preparation', '/review']) await t.test(endpoint, async t => {
    const { panel, doc, win } = await boot(t, { route: call => {
      if (call.method === endpoint || (call.method === 'POST' && call.url.endsWith(endpoint))) return reply({}, 401);
      return reply({ analysis: fixture() });
    } });
    await toggle(panel);
    if (endpoint === '/preparation') await submit(fillPage(panel));
    if (endpoint === '/review') { fillPage(panel); const form = reviewForm(panel); selectAll(form); await submit(form); }
    assert.equal(win.localStorage.getItem('nota.notary.token'), null);
    assert.equal(doc.getElementById('notary-authed').hidden, true);
    assert.match(doc.body.textContent, /Session expirée/);
    assert.equal(sourceForm(panel).elements.text.value, '');
    assert.equal(sourceForm(panel).elements.processingAuthorized.checked, false);
    assert.equal(reviewForm(panel), null, 'expired sessions retain no analysis in the hidden card');
  });
});

test('card replacement and session teardown erase local source and ignore late API responses', async t => {
  for (const teardown of ['refresh', 'signOut', 'newSession']) {
    for (const endpoint of ['GET', '/preparation', '/review']) await t.test(teardown + ' ' + endpoint, async t => {
      let finish;
      const ctx = await boot(t, { route: call => {
        if (call.method === endpoint || (call.method === 'POST' && call.url.endsWith(endpoint))) {
          return new Promise(resolve => { finish = resolve; });
        }
        return reply({ analysis: fixture() });
      } });
      await toggle(ctx.panel);
      const source = fillPage(ctx.panel);
      if (endpoint === '/preparation') await submit(source);
      if (endpoint === '/review') { const review = reviewForm(ctx.panel); selectAll(review); await submit(review); }
      if (teardown === 'refresh') await ctx.win.Nota.notary.loadBids();
      if (teardown === 'signOut') ctx.win.Nota.notary.signOut();
      if (teardown === 'newSession') await ctx.win.Nota.notary.signIn('notary@example.ca');
      await tick();
      assert.equal(source.elements.text.value, '', 'clear even the detached textarea');
      assert.equal(source.elements.processingAuthorized.checked, false);
      assert.equal(reviewForm(ctx.panel), null);
      const review = { decisions: fixture().preparation.fields.map((_, index) => ({ index, decision: 'accepted' })), activeReviewSeconds: null };
      finish(reply({ ok: true, analysis: fixture(), review })); await tick();
      assert.equal(reviewForm(ctx.panel), null, 'late responses do not reconstruct a disposed analysis');
      assert.equal(ctx.panel.querySelector('.nc-financing-ai-results').textContent, '');
      const calls = ctx.apiCalls().length;
      await submit(source);
      assert.equal(ctx.apiCalls().length, calls, 'a disposed form cannot send using another session');
      if (teardown !== 'signOut') {
        const fresh = ctx.doc.querySelector('.nc-financing-ai');
        assert.equal(sourceForm(fresh).elements.text.value, '');
        assert.equal(reviewForm(fresh), null, 'new cards wait for a deliberate lazy load');
      }
    });
  }
});

test('dynamic English notices translate immediately and preserve original source text on failure', async t => {
  const { panel } = await boot(t, { lang: 'en', route: call => call.method === 'GET'
    ? reply({ analysis: null })
    : reply({ errors: [{ code: 'autorisation_traitement_requise' }] }, 422) });
  await toggle(panel);
  const form = fillPage(panel);
  form.elements.processingAuthorized.checked = false;
  form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  assert.match(panel.querySelector('[role="alert"]').textContent, /^Enter the document, a valid page/);
  form.elements.processingAuthorized.checked = true;
  await submit(form);
  assert.match(panel.querySelector('[role="alert"]').textContent, /^Confirm your authorization to transmit/);
  assert.match(form.elements.text.value, /Texte de la page fourni par le notaire/);
});

test('empty extraction shows abstention and missing labels with no review to approve', async t => {
  const analysis = fixture(); analysis.preparation.fields = []; analysis.preparation.conflicts = [];
  const { panel } = await boot(t, { analysis });
  await toggle(panel);
  assert.match(panel.textContent, /Aucune proposition extraite/);
  assert.match(panel.textContent, /Noms des emprunteurs/);
  assert.equal(reviewForm(panel), null);
});

test('English translates the workflow and domain labels while hostile evidence, values and provenance remain verbatim text', async t => {
  const hostile = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script> Refinancement hypothécaire 1 350 $';
  const analysis = fixture();
  analysis.preparation.fields[0].value = hostile;
  analysis.preparation.fields[0].evidence = [{ documentId: hostile, page: 9, quote: hostile }];
  analysis.preparation.fields[1].fieldId = hostile;
  analysis.preparation.missing.push(hostile);
  for (const key of Object.keys(analysis.provenance)) analysis.provenance[key] = hostile;
  analysis.id = hostile; analysis.createdAt = hostile;
  analysis.review = { decisions: analysis.preparation.fields.map((_, index) => ({ index, decision: 'corrected', value: hostile, reason: hostile })), activeReviewSeconds: 0 };
  const { panel, win, apiCalls } = await boot(t, { analysis, lang: 'en' });
  await toggle(panel);
  assert.equal(panel.querySelector('summary').textContent, 'Work packet and assisted analysis');
  assert.equal(apiCalls()[0].headers['Accept-Language'], 'en');
  assert.ok(labelled(panel, 'Document ID'));
  assert.match(panel.textContent, /Optical character recognition.*not yet available/);
  assert.match(panel.textContent, /Review recorded for this file.*does not constitute legal approval/);
  for (const field of win.NotaDomain.FINANCING_AI_FIELDS) {
    assert.notEqual(win.NotaI18N.t(field.label), field.label, 'English domain label: ' + field.id);
  }
  assert.equal(panel.querySelector('blockquote').textContent, hostile);
  const rawNodes = [...panel.querySelectorAll('[data-i18n-skip]')];
  assert.ok(rawNodes.filter(node => node.textContent === hostile).length >= 10);
  assert.equal(reviewForm(panel).elements['value-0'].value, hostile);
  assert.equal(reviewForm(panel).elements['reason-0'].value, hostile);
  assert.equal(panel.querySelector('img, script'), null);
  assert.equal(win.pwned, undefined);
});
