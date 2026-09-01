/**
 * « Votre cote » — the whole share, published in the notary's console
 * (ADR 0028).
 *
 * One measure on 100 decides what Nota keeps (at most 15 %) and what the
 * notary keeps (85 % to 95 %). A lever a notary cannot recompute is a slogan,
 * so the console publishes the ENTIRE computation:
 *
 *   - the number on 100, big, and the sentence that ties it to money;
 *   - the four axes, each with its points / max AND its arithmetic in figures;
 *   - the next rung, with the points still missing;
 *   - the full barème as a PUBLIC scale, never a hidden rule;
 *   - the per-service record (GET /notary/evaluations → services);
 *   - the act-by-act statement (GET /notary/acts): amount, rate, Nota fee, net.
 *
 * Boot harness mirrors notary-evals.test.mjs: jsdom outside-only, domain then
 * app, real sign-in through a URL-routing fetch stub.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const DOMS = [];
after(() => { for (const d of DOMS) { try { d.window.close(); } catch {} } });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const firstOfMonth = (iso) => iso.slice(0, 7) + '-01';
const $ = (doc, id) => doc.getElementById(id);

// The contract's own example payload (CONTRAT-COTE.md), verbatim in shape.
const COTE = {
  cote: 87,
  axes: [
    { id: 'satisfaction', nom: 'Satisfaction des clients', nomEn: 'Client satisfaction', points: 35.6, max: 40, detail: { note: 4.7, avis: 30, notePonderee: 4.6, cible: 4.8 } },
    { id: 'services', nom: 'Services rendus', nomEn: 'Acts delivered', points: 18.1, max: 25, detail: { actes: 40, cible: 50, servicesRendus: 2, catalogue: 2 } },
    { id: 'disponibilite', nom: 'Disponibilité', nomEn: 'Availability', points: 19.2, max: 20, detail: { repondu: 14, declinees: 3, reponses: 17, cibleReponses: 20, rayonKm: 50, urgences: true } },
    { id: 'presence', nom: 'Présence sur Nota', nomEn: 'Presence on Nota', points: 14.1, max: 15, detail: { fiche: true, secteur: true, joursDepuisActivite: 1, joursMembre: 457 } },
  ],
};
const PALIERS = [
  { cote: 60, taux: 0.12, part: 0.88 },
  { cote: 70, taux: 0.10, part: 0.90 },
  { cote: 80, taux: 0.08, part: 0.92 },
  { cote: 90, taux: 0.05, part: 0.95 },
];
const COMMISSION = {
  taux: 0.15, plancher: 0.05, tauxEffectif: 0.08, part: 0.92, bonus: 0.07,
  cote: COTE.cote, axes: COTE.axes, paliers: PALIERS,
  prochain: { cote: 90, manque: 3, tauxEffectif: 0.05, part: 0.95 },
};

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
  win.localStorage.setItem('nota.bids.v1', JSON.stringify(D.makeFixtures(firstOfMonth(todayISO()))));
  win.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  win.eval(APP_SRC);
  await wait(50);
  return { win, doc: win.document, D, Nota: win.Nota };
}

/**
 * The notary session doors. `acts` = the /notary/acts payload; `actsStatus`
 * lets a test play the door that is not deployed yet (404) or broken (500).
 */
function stubNotaryApi(win, {
  cote = COTE, commission = COMMISSION, rating = null,
  services = null, evaluations = [], acts = null, actsStatus = 200, bidsStatus = 200,
} = {}) {
  const calls = { evals: [], acts: [], bids: [] };
  win.fetch = (url, init = {}) => {
    const path = String(url);
    const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (path.includes('/notary/session/request')) return json({ ok: true, devToken: 'chal.tok' });
    if (path.includes('/notary/session/verify')) return json({ token: 'sess.tok', feedToken: 'feed.tok', email: 'demo@etude.ca' });
    if (path.includes('/notary/evaluations')) {
      calls.evals.push({ path, headers: init.headers || {} });
      return json({ rating, cote, services: services || [], evaluations });
    }
    if (path.includes('/notary/acts')) {
      calls.acts.push({ path, headers: init.headers || {} });
      if (actsStatus !== 200) return json({ errors: [{ message: 'nope' }] }, actsStatus);
      return json(acts || { actes: [], totaux: { actes: 0, montant: 0, commission: 0, net: 0 } });
    }
    if (path.includes('/notary/bids')) {
      calls.bids.push({ path });
      if (bidsStatus !== 200) return json({ errors: [{ message: 'boom' }] }, bidsStatus);
      return json({ bids: [], retained: [], rating, profil: { lienCNQ: null }, cote, commission });
    }
    return Promise.reject(new Error('offline'));
  };
  return calls;
}

async function bootSignedIn(opts) {
  const ctx = await boot();
  const calls = stubNotaryApi(ctx.win, opts);
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(20);
  return { ...ctx, calls };
}

// ---------------------------------------------------------------------------
// (a) The panel ships in the console, between the money and the evaluations.
// ---------------------------------------------------------------------------
test('« Votre cote » ships in the authed console, right after « Vos revenus »', async () => {
  const { doc } = await boot();
  const box = $(doc, 'notary-cote');
  assert.ok(box, 'the cote panel exists');
  assert.ok($(doc, 'notary-authed').contains(box), 'it lives inside the authed console');
  const earnings = $(doc, 'notary-earnings');
  const evals = $(doc, 'notary-evals');
  assert.ok(earnings.compareDocumentPosition(box) & 4, 'the cote follows « Vos revenus » — money leads');
  assert.ok(box.compareDocumentPosition(evals) & 4, 'the cote precedes « Vos évaluations »');
  // « Vos honoraires » still leads the money tiles: the order the owner set.
  const heads = Array.from(doc.querySelectorAll('#notary-authed .nc-h')).map((h) => h.textContent.trim());
  assert.ok(heads.includes('Votre cote'), 'the panel is titled « Votre cote »: ' + heads);
  assert.ok(heads.indexOf('Vos revenus') < heads.indexOf('Votre cote'), 'revenus before cote');
});

// ---------------------------------------------------------------------------
// (b) The number, the money sentence, the four axes, the next rung, the scale.
// ---------------------------------------------------------------------------
test('the panel prints the cote, the share it earns, the four axes and the next rung', async () => {
  const { doc } = await bootSignedIn();
  const box = $(doc, 'notary-cote');

  // The number on 100, big and on its own.
  const n = box.querySelector('.nc-cote-n');
  assert.ok(n, 'the cote number is its own element');
  assert.match(n.textContent, /\b87\b/, 'the cote reads 87: ' + n.textContent);
  assert.match(n.textContent, /100/, 'and it is stated on 100: ' + n.textContent);

  // The sentence that ties the number to money — with what it beats.
  const lines = Array.from(box.querySelectorAll('.nc-commission')).map((x) => x.textContent);
  assert.ok(lines.some((t) => t.includes('92 %') && t.includes('au lieu de 85 %')),
    'the earned share reads against the base share: ' + lines);

  // The four axes, each with points / max AND its arithmetic in figures.
  const axes = Array.from(box.querySelectorAll('.nc-cote-axe'));
  assert.equal(axes.length, 4, 'one block per axis');
  assert.deepEqual(axes.map((a) => a.dataset.axe), ['satisfaction', 'services', 'disponibilite', 'presence']);
  assert.deepEqual(
    axes.map((a) => a.querySelector('.nc-cote-axe-nom').textContent),
    ['Satisfaction des clients', 'Services rendus', 'Disponibilité', 'Présence sur Nota'],
    'the axis names come from the payload, never re-declared in the UI'
  );
  assert.equal(axes[0].querySelector('.nc-cote-axe-pts').textContent, '35,6 / 40', 'points read fr-CA against the max');
  assert.equal(axes[1].querySelector('.nc-cote-axe-pts').textContent, '18,1 / 25');
  assert.equal(axes[2].querySelector('.nc-cote-axe-pts').textContent, '19,2 / 20');
  assert.equal(axes[3].querySelector('.nc-cote-axe-pts').textContent, '14,1 / 15');
  // The total is redoable by hand: 35,6 + 18,1 + 19,2 + 14,1 = 87.
  const sum = COTE.axes.reduce((t, a) => t + a.points, 0);
  assert.equal(Math.round(sum), COTE.cote, 'the fixture itself is a redoable total');

  // Every figure of every `detail` reaches the screen.
  const d0 = axes[0].querySelector('.nc-cote-detail').textContent;
  assert.match(d0, /4,7/, 'the observed note'); assert.match(d0, /30/, 'the number of reviews');
  assert.match(d0, /4,6/, 'the bayesian weighted note'); assert.match(d0, /4,8/, 'the target');
  const d1 = axes[1].querySelector('.nc-cote-detail').textContent;
  assert.match(d1, /40/, 'acts carried'); assert.match(d1, /50/, 'the target'); assert.match(d1, /2/, 'catalogue coverage');
  const d2 = axes[2].querySelector('.nc-cote-detail').textContent;
  assert.match(d2, /17/, 'answers given'); assert.match(d2, /20/, 'answers targeted');
  assert.match(d2, /14/, 'proposals or acceptances'); assert.match(d2, /3/, 'declines');
  assert.match(d2, /50\s?km/, 'the declared radius');
  const d3 = axes[3].querySelector('.nc-cote-detail').textContent;
  assert.match(d3, /457/, 'days as a member'); assert.match(d3, /CNQ/, 'the fiche');

  // The next rung: which cote, what it pays, how many points are missing.
  const next = box.querySelector('.nc-cote-next');
  assert.ok(next, 'the next rung is named');
  assert.match(next.textContent, /90/, 'the rung to reach');
  assert.match(next.textContent, /95 %/, 'what it would pay');
  assert.match(next.textContent, /3 points/, 'and exactly what is missing: ' + next.textContent);
});

test('the whole barème is published as a public scale, with the rung in force marked', async () => {
  const { doc } = await bootSignedIn();
  const rows = Array.from($(doc, 'notary-cote').querySelectorAll('.nc-bareme-row'));
  // The base share plus one row per rung: nothing about the scale is hidden.
  assert.equal(rows.length, PALIERS.length + 1, 'the base share leads, then every rung');
  assert.equal(rows[0].dataset.cote, '0', 'the first row is the starting share');
  assert.match(rows[0].textContent, /85 %/, 'a notary with no history keeps 85 %');
  assert.match(rows[0].textContent, /15 %/, 'and Nota keeps at most 15 %');
  assert.deepEqual(rows.slice(1).map((r) => r.dataset.cote), ['60', '70', '80', '90']);
  assert.match(rows[4].textContent, /vous gardez 95 %/, 'the summit keeps 95 %');
  assert.match(rows[4].textContent, /frais Nota 5 %/, 'and leaves 5 % to Nota');
  // Cote 87 sits on the 80 rung — the one actually in force is marked.
  const current = rows.filter((r) => r.classList.contains('is-current'));
  assert.equal(current.length, 1, 'exactly one rung is in force');
  assert.equal(current[0].dataset.cote, '80', 'cote 87 sits on the 80 rung');
});

// ---------------------------------------------------------------------------
// (b2) The axes read the DOMAIN's own detail — every served figure, no NaN.
//
// This is the assertion that would have caught « Taux de réponse NaN % »: the
// panel is driven by real domain.notaryScore() output, so a key the domain
// stops serving (or one it starts serving) fails here instead of shipping.
// ---------------------------------------------------------------------------
const PROFILS = {
  neuf: {},
  debutant: { actes: { total: 2, parService: { refinancement: 2 } }, disponibilite: { repondu: 1, declinees: 2, rayonKm: 25 }, presence: { fiche: true, joursDepuisActivite: 3, joursMembre: 12 } },
  actif: { evaluations: { note: 4.7, avis: 30 }, actes: { total: 40, parService: { refinancement: 40 } }, disponibilite: { repondu: 14, declinees: 3, rayonKm: 50, urgences: true }, presence: { fiche: true, secteur: true, joursDepuisActivite: 1, joursMembre: 457 } },
  silencieux: { evaluations: { note: 3.2, avis: 4 }, actes: { total: 6, parService: { financement: 6 } }, disponibilite: { repondu: 0, declinees: 0, rayonKm: 0 }, presence: { fiche: true, secteur: true, joursDepuisActivite: 60, joursMembre: 200 } },
};

test('every axis renders the domain’s real detail — no NaN, no undefined, nothing served but unshown', async () => {
  const ctx = await boot();
  const D = ctx.D;
  for (const [nom, stats] of Object.entries(PROFILS)) {
    const score = D.notaryScore(stats);
    stubNotaryApi(ctx.win, { cote: score, commission: null });
    await ctx.Nota.notary.signIn('demo@etude.ca');
    await wait(20);

    const box = $(ctx.doc, 'notary-cote');
    const whole = box.textContent;
    assert.ok(!/NaN/.test(whole), nom + ': the panel shows NaN — an axis reads a key the domain no longer serves: ' + whole);
    assert.ok(!/undefined/.test(whole), nom + ': the panel shows undefined: ' + whole);
    assert.ok(!/null/.test(whole), nom + ': the panel shows null: ' + whole);

    const axes = Array.from(box.querySelectorAll('.nc-cote-axe'));
    assert.equal(axes.length, score.axes.length, nom + ': one block per domain axis');
    score.axes.forEach((a, i) => {
      const txt = axes[i].querySelector('.nc-cote-detail').textContent;
      assert.equal(axes[i].dataset.axe, a.id);
      // Every NUMBER the domain serves for this axis must reach the screen —
      // a figure computed and then dropped is a figure the notary cannot use
      // to redo their own total. (Zero is exempt: it is phrased in words.)
      for (const [k, v] of Object.entries(a.detail)) {
        if (typeof v !== 'number' || v === 0) continue;
        const fr = String(Math.round(v * 10) / 10).replace('.', ',');
        assert.ok(txt.includes(fr),
          nom + ' / ' + a.id + ': detail.' + k + ' = ' + fr + ' never reaches the screen: ' + txt);
      }
    });
    ctx.Nota.notary.signOut();
    await wait(10);
  }
});

test('the disponibilité axis says that answering is what counts — declining is an answer, silence is the cost', async () => {
  const ctx = await boot();
  const score = ctx.D.notaryScore(PROFILS.actif);
  stubNotaryApi(ctx.win, { cote: score, commission: null });
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(20);
  const txt = ctx.doc.querySelector('.nc-cote-axe[data-axe="disponibilite"] .nc-cote-detail').textContent;

  // The count that actually earns the points, against the target that fills it.
  assert.match(txt, /17 réponses données sur 20 visées/, 'answers given against the target: ' + txt);
  // The honest breakdown of what those answers were.
  assert.match(txt, /14 propositions ou acceptations/, 'what was proposed or accepted: ' + txt);
  assert.match(txt, /3 déclins/, 'and what was declined: ' + txt);
  // The rule itself, in one glance: declining is free.
  assert.match(txt, /Décliner compte comme une réponse/, 'declining IS an answer: ' + txt);
  assert.match(txt, /seul le silence coûte des points/, 'and only silence costs: ' + txt);
  // The retired rule must not survive anywhere.
  assert.ok(!/[Tt]aux de réponse/.test(txt), 'the acceptance-rate framing is gone: ' + txt);
  assert.ok(!/%/.test(txt), 'no ratio at all on this axis: ' + txt);
});

test('the services axis no longer suggests that breadth of catalogue earns points', async () => {
  const ctx = await boot();
  // A specialist: one service of two, and a strong volume.
  const score = ctx.D.notaryScore(PROFILS.actif);
  stubNotaryApi(ctx.win, { cote: score, commission: null });
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(20);
  const txt = ctx.doc.querySelector('.nc-cote-axe[data-axe="services"] .nc-cote-detail').textContent;
  assert.match(txt, /40 actes portés/, 'the volume that DOES earn the points: ' + txt);
  assert.match(txt, /Cible 50 actes/, 'against its target: ' + txt);
  // The catalogue coverage stays as information, explicitly scoreless.
  assert.match(txt, /1 service rendu sur 2/, 'what the notary actually renders: ' + txt);
  assert.match(txt, /Se spécialiser ne coûte rien/, 'specializing is free: ' + txt);
  assert.match(txt, /n’entre pas dans la cote/, 'breadth is out of the score: ' + txt);
});

test('a brand-new notary reads a fair, actionable screen — never a wall of zeros', async () => {
  const ctx = await boot();
  const score = ctx.D.notaryScore(PROFILS.neuf);
  stubNotaryApi(ctx.win, {
    cote: score,
    commission: {
      taux: 0.15, plancher: 0.05, tauxEffectif: 0.15, part: 0.85, bonus: 0, cote: score.cote,
      axes: score.axes,
      paliers: PALIERS,
      prochain: { cote: 60, manque: 60 - score.cote, tauxEffectif: 0.12, part: 0.88 },
    },
  });
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(20);
  const box = $(ctx.doc, 'notary-cote');

  // The starting share is already 85 % — stated plainly, not as a punishment.
  const head = box.querySelector('.nc-commission').textContent;
  assert.match(head, /Vous gardez 85 %/, head);
  assert.ok(!head.includes('au lieu de'), 'nothing is being taken away from a newcomer: ' + head);

  // The next rung is reachable and counted, never a scolding.
  const next = box.querySelector('.nc-cote-next').textContent;
  assert.match(next, /Cote 60/, next);
  assert.match(next, /88 %/, next);
  assert.match(next, new RegExp(String(60 - score.cote) + ' points'), next);

  // The empty axes read in words, not as bare zeros the notary must decode.
  const dispo = box.querySelector('.nc-cote-axe[data-axe="disponibilite"] .nc-cote-detail').textContent;
  assert.match(dispo, /Aucune réponse donnée sur 20 visées/, dispo);
  assert.match(dispo, /Décliner compte comme une réponse/, 'the rule is told BEFORE the first decline: ' + dispo);
  assert.ok(!/0 propositions/.test(dispo) && !/0 déclins/.test(dispo), 'no wall of zeros: ' + dispo);
  const satis = box.querySelector('.nc-cote-axe[data-axe="satisfaction"] .nc-cote-detail').textContent;
  assert.match(satis, /Aucun avis/, 'no fake average for a notary with no reviews: ' + satis);
  const pres = box.querySelector('.nc-cote-axe[data-axe="presence"] .nc-cote-detail').textContent;
  assert.match(pres, /aujourd’hui/, 'day zero reads in words: ' + pres);
});

// ---------------------------------------------------------------------------
// (c) Billing off: the cote still stands, the rate never gets invented.
// ---------------------------------------------------------------------------
test('without a commission block the cote and its axes still render — and no rate is invented', async () => {
  const { doc } = await bootSignedIn({ commission: null });
  const box = $(doc, 'notary-cote');
  assert.match(box.querySelector('.nc-cote-n').textContent, /87/, 'a notary has a cote even without billing');
  assert.equal(box.querySelectorAll('.nc-cote-axe').length, 4, 'the four axes stand on their own');
  assert.equal(box.querySelector('.nc-commission'), null, 'no share sentence without a barème');
  assert.equal(box.querySelector('.nc-bareme-row'), null, 'no phantom scale');
  assert.equal(box.querySelector('.nc-cote-next'), null, 'no phantom next rung');
});

// ---------------------------------------------------------------------------
// (d) The per-service record: what this notary actually carries.
// ---------------------------------------------------------------------------
test('the evaluations panel lists the record service by service — acts carried and the note', async () => {
  const ctx = await boot();
  const services = [
    { serviceId: 'refinancement', nom: 'Refinancement hypothécaire', nomEn: 'Mortgage refinancing', actes: 25, avis: 18, note: 4.7 },
    { serviceId: 'financement', nom: 'Financement hypothécaire', nomEn: 'Mortgage financing', actes: 3, avis: 0, note: null },
  ];
  stubNotaryApi(ctx.win, { services, rating: { note: 4.7, avis: 18 } });
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  const panel = $(ctx.doc, 'notary-evals');
  panel.open = true;
  await wait(20);

  const rows = Array.from(ctx.doc.querySelectorAll('#notary-evals .nc-svc-row'));
  assert.equal(rows.length, 2, 'one row per catalogue service');
  assert.deepEqual(rows.map((r) => r.dataset.service), ['refinancement', 'financement']);
  assert.match(rows[0].textContent, /Refinancement hypothécaire/, 'the service is named');
  assert.match(rows[0].querySelector('.nc-svc-actes').textContent, /25 actes/, 'acts carried are counted');
  assert.ok(rows[0].querySelector('.rating-badge'), 'the note rides the same badge clients see');
  assert.match(rows[0].querySelector('.rating-badge').textContent, /4,7/, 'fr-CA decimal');
  // No reviews → the honest words, never a fake average.
  assert.equal(rows[1].querySelector('.rating-badge'), null, 'no star badge without a single review');
  assert.match(rows[1].textContent, /pas encore d’avis/, 'it says so plainly');
  assert.match(rows[1].querySelector('.nc-svc-actes').textContent, /3 actes/);
});

// ---------------------------------------------------------------------------
// (e) The act-by-act statement: the full commission disclosure.
// ---------------------------------------------------------------------------
const ACTS = {
  actes: [
    { bidId: 'b1', dateISO: '2026-08-20', serviceId: 'refinancement', service: 'Refinancement hypothécaire', montant: 2400, taux: 0.08, commission: 192, net: 2208, cote: 84, completedAt: '2026-08-20T14:02:00.000Z', paye: true },
    { bidId: 'b2', dateISO: '2026-07-11', serviceId: 'financement', service: 'Financement hypothécaire', montant: 1800, taux: 0.10, commission: 180, net: 1620, cote: 71, completedAt: '2026-07-11T14:02:00.000Z', paye: true },
  ],
  totaux: { actes: 2, montant: 4200, commission: 372, net: 3828 },
};

test('the relevé fetches /notary/acts on first open and prints montant, taux, frais and net per act', async () => {
  const ctx = await boot();
  const calls = stubNotaryApi(ctx.win, { acts: ACTS });
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  assert.equal(calls.acts.length, 0, 'nothing is fetched while the panel stays closed');

  const panel = $(ctx.doc, 'notary-actes');
  assert.ok(panel, 'the relevé panel exists');
  assert.equal(panel.tagName, 'DETAILS', 'history folds — the working surface does not');
  assert.equal(panel.open, false, 'it ships collapsed');
  panel.open = true;
  await wait(20);

  assert.equal(calls.acts.length, 1, 'one fetch on first open');
  const headers = calls.acts[0].headers;
  assert.equal(headers.authorization || headers.Authorization, 'Bearer sess.tok', 'the SESSION bearer authenticates it');

  const rows = Array.from(ctx.doc.querySelectorAll('#nc-actes-list .nc-acte-row'));
  assert.equal(rows.length, 2, 'one row per settled act — the line IS the disclosure');
  assert.deepEqual(rows.map((r) => r.dataset.bid), ['b1', 'b2']);
  const cells = Array.from(rows[0].querySelectorAll('td')).map((c) => c.textContent);
  assert.ok(cells.some((c) => /Refinancement/.test(c)), 'the act is named: ' + cells);
  assert.ok(cells.some((c) => /2 400\s?\$/.test(c)), 'what the client paid: ' + cells);
  assert.ok(cells.some((c) => /8 %/.test(c)), 'at which rate: ' + cells);
  assert.ok(cells.some((c) => /192\s?\$/.test(c)), 'what Nota kept: ' + cells);
  assert.ok(cells.some((c) => /2 208\s?\$/.test(c)), 'and the net: ' + cells);

  // The totals close the statement.
  const tot = ctx.doc.querySelector('#nc-actes-list .nc-acte-total');
  assert.ok(tot, 'the totals row exists');
  assert.match(tot.textContent, /4 200\s?\$/, 'total paid by clients');
  assert.match(tot.textContent, /372\s?\$/, 'total kept by Nota');
  assert.match(tot.textContent, /3 828\s?\$/, 'total net');

  // Cached for the session: reopening never re-fetches.
  panel.open = false; await wait(5);
  panel.open = true; await wait(20);
  assert.equal(calls.acts.length, 1, 'the second open reuses the session cache');
});

// --- ADR 0029: a settlement OFF the platform is a debt, never a receipt -----
// When no hold is capturable the client paid the notary directly at signing:
// Nota collected nothing and its service fee is still owed. The statement must
// say so per line and in the totals — and must NOT invent a way to pay it,
// because none exists in the product yet.
const ACTS_DU = {
  actes: [
    { bidId: 'b1', dateISO: '2026-08-20', serviceId: 'refinancement', service: 'Refinancement hypothécaire', montant: 2400, taux: 0.08, commission: 192, net: 2208, cote: 84, completedAt: '2026-08-20T14:02:00.000Z', paye: true, du: 0 },
    { bidId: 'b2', dateISO: '2026-07-11', serviceId: 'financement', service: 'Financement hypothécaire', montant: 1800, taux: 0.10, commission: 180, net: 1620, cote: 71, completedAt: '2026-07-11T14:02:00.000Z', paye: false, du: 180 },
  ],
  totaux: { actes: 2, montant: 4200, commission: 372, net: 3828, du: 180 },
};

test('a line settled off the platform is marked, names what is still owed, and the paid line is not', async () => {
  const { doc } = await bootSignedIn({ acts: ACTS_DU });
  const panel = $(doc, 'notary-actes');
  panel.open = true;
  await wait(20);

  const rows = Array.from(doc.querySelectorAll('#nc-actes-list .nc-acte-row'));
  assert.equal(rows.length, 2);
  // The state is on the row itself — machine-readable, and the only thing a
  // future style needs to hook onto.
  assert.equal(rows[0].dataset.paye, 'true', 'the captured act is paid');
  assert.equal(rows[1].dataset.paye, 'false', 'the off-platform act is not');

  // Only the unpaid line carries the state label, and it tells the truth.
  assert.equal(rows[0].querySelector('.nc-acte-etat'), null, 'a paid line stays plain — no noise');
  const etat = rows[1].querySelector('.nc-acte-etat');
  assert.ok(etat, 'the unpaid line is marked');
  const t = etat.textContent;
  assert.match(t, /Réglé hors plateforme/, 'it says where the money went: ' + t);
  assert.match(t, /à percevoir/, 'and that the fee is still to be collected: ' + t);
  assert.match(t, /180\s?\$/, 'with the amount still owed: ' + t);
  // No new shape: the marker is text in the console's existing quiet register,
  // not a badge — and it STACKS under the act's name (the cell is nowrap).
  assert.equal(etat.tagName, 'DIV', 'a block, so the row never stretches sideways');
  assert.ok(etat.classList.contains('help'), 'it wears the existing quiet register');
  assert.ok(rows[1].querySelector('.nc-acte-svc').contains(etat), 'it belongs to the act it marks');
});

test('the amount still owed is totalled beside the other totals — and only when there is one', async () => {
  const ctx = await boot();
  stubNotaryApi(ctx.win, { acts: ACTS_DU });
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  $(ctx.doc, 'notary-actes').open = true;
  await wait(20);

  const foot = ctx.doc.querySelector('#nc-actes-list .nc-acte-total');
  assert.ok(foot, 'the settled totals still close the statement');
  assert.match(foot.textContent, /372\s?\$/, 'total charged by Nota');
  const due = ctx.doc.querySelector('#nc-actes-list [data-total="du"]');
  assert.ok(due, 'the amount still owed is a total of its own');
  assert.match(due.textContent, /180\s?\$/, 'the sum still owed: ' + due.textContent);
  assert.match(due.textContent, /percevoir/, 'labelled as owed to Nota, not as revenue: ' + due.textContent);
  // It lives in the table's foot, beside the other totals — not adrift below.
  assert.ok(ctx.doc.querySelector('#nc-actes-list tfoot').contains(due), 'it sits with the totals');
});

test('a fully paid statement shows no debt total and no debt sentence', async () => {
  const { doc } = await bootSignedIn({ acts: ACTS });
  $(doc, 'notary-actes').open = true;
  await wait(20);
  assert.equal(doc.querySelector('#nc-actes-list [data-total="du"]'), null, 'nothing owed → no debt total');
  assert.equal(doc.querySelector('#nc-actes-list .nc-acte-du-note'), null, 'nor the explanation');
  assert.equal(doc.querySelector('#nc-actes-list .nc-acte-etat'), null, 'nor a state label on any line');
});

test('one sentence explains the debt — and invents no way to settle it', async () => {
  const { doc } = await bootSignedIn({ acts: ACTS_DU });
  $(doc, 'notary-actes').open = true;
  await wait(20);

  const notes = Array.from(doc.querySelectorAll('#nc-actes-list .nc-acte-du-note'));
  assert.equal(notes.length, 1, 'said once, under the table — not per line');
  const t = notes[0].textContent;
  assert.match(t, /payé.{0,30}directement/, 'the client paid the notary directly: ' + t);
  assert.match(t, /Nota n’a rien encaissé/, 'Nota collected nothing: ' + t);
  assert.match(t, /rest(e|ent) d(us|û)/, 'and the service fee is still owed: ' + t);

  // ADR 0029 leaves recovery OPEN: nothing in the product can collect this
  // yet. The copy must not suggest an invoice, a deadline, a debit or a
  // reminder — a promise the product cannot keep is worse than the debt.
  for (const invented of [
    'facture', 'factur', 'échéance', 'délai', 'avant le', 'd’ici',
    'prélèv', 'virement', 'relance', 'payez', 'régler ci', 'recouvr',
    'compte connecté', 'sera déduit', 'déduit du prochain',
  ]) {
    assert.ok(!t.toLowerCase().includes(invented), 'invents a recovery mechanism (« ' + invented +' »): ' + t);
  }
});

test('an empty statement reads as an empty statement, not as a broken panel', async () => {
  const { doc } = await bootSignedIn({ acts: { actes: [], totaux: { actes: 0, montant: 0, commission: 0, net: 0 } } });
  const panel = $(doc, 'notary-actes');
  panel.open = true;
  await wait(20);
  assert.equal(panel.hidden, false, 'the panel stays');
  const help = doc.querySelector('#nc-actes-list .help');
  assert.ok(help && /premier acte/.test(help.textContent), 'a quiet empty state: ' + (help && help.textContent));
  assert.equal(doc.querySelectorAll('#nc-actes-list .nc-acte-row').length, 0, 'no ghost rows');
});

test('a missing /notary/acts door hides the whole panel — never a broken promise', async () => {
  const { doc } = await bootSignedIn({ actsStatus: 404 });
  const panel = $(doc, 'notary-actes');
  panel.open = true;
  await wait(20);
  assert.equal(panel.hidden, true, 'the panel removes itself when the door is not there');
});

test('a server error on the relevé reads as an error, never as « no acts »', async () => {
  const { doc } = await bootSignedIn({ actsStatus: 500 });
  const panel = $(doc, 'notary-actes');
  panel.open = true;
  await wait(20);
  assert.equal(panel.hidden, false, 'a 500 is not a missing door');
  const help = doc.querySelector('#nc-actes-list .help');
  assert.ok(help && /Impossible de charger votre relevé/.test(help.textContent), 'the failure is stated: ' + (help && help.textContent));
});

// ---------------------------------------------------------------------------
// (f) The session boundary: another notary never inherits this one's figures.
// ---------------------------------------------------------------------------
test('signing out empties the cote panel and the relevé cache', async () => {
  const ctx = await boot();
  const calls = stubNotaryApi(ctx.win, { acts: ACTS });
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  const panel = $(ctx.doc, 'notary-actes');
  panel.open = true;
  await wait(20);
  assert.equal(calls.acts.length, 1);

  ctx.Nota.notary.signOut();
  await wait(10);
  assert.equal($(ctx.doc, 'notary-cote').textContent.trim(), '', 'no cote left on screen');
  assert.equal(panel.open, false, 'the relevé folds shut');
  assert.equal(ctx.doc.getElementById('nc-actes-list').textContent.trim(), '', 'and empties');

  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  panel.open = true;
  await wait(20);
  assert.equal(calls.acts.length, 2, 'the next session re-fetches ITS OWN statement');
});

// A non-2xx on /notary/bids used to fall straight through: the body parsed to
// {}, so the console blanked — no open demands, no rating, no cote, no
// commission — and ncLoadBids returned TRUE, so callers reported success. Only
// 401 and a thrown fetch were handled.
test('a 500 on /notary/bids is a failure, not an empty console reported as success', async () => {
  const ctx = await boot();
  stubNotaryApi(ctx.win, { bidsStatus: 500 });
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(20);

  const ok = await ctx.Nota.notary.loadBids();
  assert.equal(ok, false, 'a 500 must report failure to its caller');

  // The region says it failed, instead of silently claiming there is no work.
  const empty = $(ctx.doc, 'notary-open-empty');
  assert.equal(empty.hidden, false, 'the empty region is shown');
  assert.match(empty.textContent, /Impossible de charger les demandes/,
    'it reads as an error, never as « aucune demande ouverte »: ' + empty.textContent);
  // And nothing invented is left standing in the money panels.
  assert.equal($(ctx.doc, 'notary-cote').textContent.trim(), '', 'no stale cote');
});

// ---------------------------------------------------------------------------
// (g) The style register: tokens only, square radii, no round badge.
// ---------------------------------------------------------------------------
test('the cote register is token-driven and square', () => {
  const block = (sel) => {
    const i = CSS_SRC.indexOf(sel + ' {');
    assert.ok(i > -1, 'missing rule ' + sel);
    return CSS_SRC.slice(i, CSS_SRC.indexOf('}', i));
  };
  // .cote-badge is deliberately absent: art. 70 retired the client-side cote
  // pill, so its rule is dead CSS awaiting removal — this guard covers the
  // console register, which is what still ships.
  for (const sel of ['.nc-cote-n', '.nc-cote-axe', '.nc-bareme-row']) {
    const rule = block(sel);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(rule), sel + ' must not hardcode a colour: ' + rule);
    assert.ok(!/border-radius:\s*(50%|999)/.test(rule), sel + ' must stay square: ' + rule);
  }
});
