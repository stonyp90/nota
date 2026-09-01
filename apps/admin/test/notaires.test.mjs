/**
 * Headless DOM tests for the « Notaires » section — le tableau d'honneur
 * (ADR 0028 : la cote sur 100 décide la part que le notaire garde). Même
 * harnais que commission.test.mjs : index.html dans jsdom, admin.js évalué,
 * fetch bouchonné en API admin, assertions sur le DOM rendu. Couvre : l'entrée
 * de rail (active pour le propriétaire, réservée pour l'analyste), le tableau
 * trié par cote, l'absence de fausse note, le dépli sur les quatre axes avec
 * leur détail chiffré, la porte fermée à l'analyste, et la bannière de reprise.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const I18N_SRC = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFetch(handler, calls) {
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { /* leave null */ } }
    calls.push({ method, url: String(url), body });
    const out = handler(method, String(url), body) || [404, null];
    const [status, json] = out;
    if (status === 0) return Promise.reject(new Error('network'));
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(json),
    });
  };
}

const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* already gone */ } } });

async function boot(handler, hash, lang) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/' + (hash || ''),
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = makeFetch(handler, calls);
      window.scrollTo = () => {};
      if (lang) window.localStorage.setItem('nota.lang', lang);
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  if (lang) win.eval(I18N_SRC);
  win.eval(ADMIN_SRC);
  await settle(win);
  return { win, calls, doc: win.document };
}

async function waitFor(win, sel, timeout = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (win.document.querySelector(sel)) return win.document.querySelector(sel);
    await wait(5);
  }
  throw new Error('timeout waiting for ' + sel);
}
async function settle(win) { for (let i = 0; i < 3; i++) await wait(5); }

const text = (node) => (node ? node.textContent : '');
const futureISO = () => new Date(Date.now() + 3600000).toISOString();
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true }));

// Le barème en vigueur + deux notaires : le sommet et le nouveau venu.
function sampleNotaries() {
  const axes = (over) => ([
    { id: 'satisfaction', nom: 'Satisfaction des clients', nomEn: 'Client satisfaction',
      points: 35.6, max: 40, detail: { note: 4.7, avis: 30, notePonderee: 4.6, cible: 4.8 } },
    { id: 'services', nom: 'Services rendus', nomEn: 'Services delivered',
      points: 22, max: 25, detail: { actes: 40, cible: 50, servicesRendus: 2, catalogue: 2 } },
    { id: 'disponibilite', nom: 'Disponibilité', nomEn: 'Availability',
      points: 19, max: 20,
      // Depuis l'ADR 0028 (complément) : plus de taux d'acceptation — on
      // compte les RÉPONSES, et les déclins en font partie.
      detail: { repondu: 60, declinees: 4, reponses: 64, cibleReponses: 20, rayonKm: 50, urgences: true } },
    { id: 'presence', nom: 'Présence sur Nota', nomEn: 'Presence on Nota',
      points: 15, max: 15, detail: { fiche: true, secteur: true, joursDepuisActivite: 1, joursMembre: 457 } },
  ].map((a, i) => Object.assign({}, a, (over || [])[i] || {})));
  return {
    bareme: {
      taux: 0.15, plancher: 0.05,
      paliers: [{ cote: 60, taux: 0.12 }, { cote: 70, taux: 0.10 }, { cote: 80, taux: 0.08 }, { cote: 90, taux: 0.05 }],
    },
    notaires: [
      { id: 'n1', email: 'm.tremblay@etude.ca', etude: 'Étude Tremblay & associés', statut: 'active',
        cote: 93, axes: axes(), tauxEffectif: 0.05, part: 0.95, actes: 40,
        actesParService: { refinancement: 25, financement: 15 },
        note: 4.7, avis: 30, commissionPercue: 4820, rayonKm: 50, urgences: true, cnq: true,
        depuis: '2025-06-01T12:00:00.000Z', vuLe: '2026-08-31T14:02:00.000Z' },
      { id: 'n2', email: 'j.roy@notaires.ca', etude: 'Notaires Roy', statut: 'onboarding',
        cote: 12, axes: axes([{ points: 0, detail: { note: 0, avis: 0, notePonderee: 4, cible: 4.8 } }]),
        tauxEffectif: 0.15, part: 0.85, actes: 0, actesParService: {},
        note: null, avis: 0, commissionPercue: 0, rayonKm: 0, urgences: false, cnq: false,
        depuis: '2026-08-20T12:00:00.000Z', vuLe: null },
    ],
  };
}

function api(opts = {}) {
  const role = opts.role || 'super_admin';
  const permissions = opts.permissions || (role === 'super_admin'
    ? ['analytics:read', 'pii:read', 'moderation:write', 'settings:write', 'notifications:write']
    : ['analytics:read']);
  const state = { notaries: opts.notaries || sampleNotaries(), status: opts.status || 200 };
  const handler = (method, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role, permissions }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/notaries')) {
      if (state.status !== 200) return [state.status, { errors: [{ code: 'interdit', message: 'Réservé à l’administrateur principal.' }] }];
      return [200, state.notaries];
    }
    return [404, null];
  };
  handler.state = state;
  return handler;
}

// ---------------------------------------------------------------------------

test('the rail carries an enabled Notaires entry that routes to the tableau d’honneur', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const entry = [...doc.querySelectorAll('.admin-rail-link')].find((b) => text(b).includes('Notaires'));
  assert.ok(entry, 'rail entry « Notaires » is missing');
  assert.equal(entry.disabled, false, 'the entry is no longer a « Bientôt » placeholder');
  assert.ok(!text(entry).includes('Bientôt'), 'the « Bientôt » badge is gone');

  click(win, entry);
  await waitFor(win, '.ntable');
  assert.equal(win.location.hash, '#/notaires');
  assert.equal(text(doc.querySelector('.page-title')), 'Notaires');
  assert.ok(text(doc.querySelector('.admin-rail-link[aria-current="page"]')).includes('Notaires'));
});

test('the table reads as a tableau d’honneur — cote, the share kept, no invented rating', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/notaires';
  await waitFor(win, '.ntable');

  const heads = [...doc.querySelectorAll('.ntable thead th')].map(text);
  assert.deepEqual(heads, ['Étude', 'Statut', 'Cote', 'Le notaire garde', 'Actes', 'Note', 'Commission perçue', 'Dernière visite']);

  const rows = [...doc.querySelectorAll('.ntable tbody tr.nrow')];
  assert.equal(rows.length, 2, 'one row per notary, in the order the API served (cote desc)');
  const cells = (r) => [...r.querySelectorAll('td')].map(text);
  const first = cells(rows[0]);
  assert.match(first[0], /Étude Tremblay & associés/);
  assert.match(first[0], /m\.tremblay@etude\.ca/, 'the courriel rides under the étude');
  assert.match(first[1], /Actif/);
  assert.match(first[2], /93/);
  assert.match(first[3], /95 %/, 'the notary’s half is the one stated');
  assert.match(first[4], /40/);
  assert.match(first[5], /4,7/);
  assert.match(first[5], /30 avis/);
  assert.match(first[6], /4 820 \$/);
  assert.match(first[7], /2026-08-31/);

  // Le nouveau venu : aucune fausse note, aucune fausse visite.
  const second = cells(rows[1]);
  assert.match(second[1], /En intégration/);
  assert.match(second[5], /aucun avis/, 'note: null reads « aucun avis »');
  assert.ok(!/\b0\b/.test(second[5]), 'never a 0 out of 5');
  assert.match(second[7], /jamais/, 'vuLe: null reads « jamais »');

  // Le barème en vigueur est rappelé : c'est lui qui explique la colonne.
  assert.match(text(doc.querySelector('.admin-content')), /Barème en vigueur/);
});

test('a row unfolds onto the four axes, points and every figure behind them', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/notaires';
  await waitFor(win, '.ntable');

  const row = doc.querySelector('.ntable tbody tr.nrow');
  const toggle = row.querySelector('.nrow-toggle');
  assert.ok(toggle, 'each row offers the unfold control');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.querySelector('.naxes-row'), null, 'nothing is unfolded before the click');

  click(win, toggle);
  const detail = await waitFor(win, '.naxes-row');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');

  const axes = [...detail.querySelectorAll('.naxe')];
  assert.equal(axes.length, 4, 'the four axes of the cote');
  const nom = (a) => text(a.querySelector('.naxe-nom'));
  assert.deepEqual(axes.map(nom), ['Satisfaction des clients', 'Services rendus', 'Disponibilité', 'Présence sur Nota']);
  assert.match(text(axes[0].querySelector('.naxe-points')), /35,6 sur 40/, 'points out of max, recomputable by hand');

  // Chaque chiffre du `detail` est là, étiqueté — c'est la pièce qu'un
  // opérateur pose devant un notaire qui conteste sa cote.
  const kv = (a) => [...a.querySelectorAll('.naxe-line')].map((l) => text(l.querySelector('.naxe-k')) + '=' + text(l.querySelector('.naxe-v')));
  const sat = kv(axes[0]);
  assert.ok(sat.includes('Note moyenne=4,7'), sat.join(' | '));
  assert.ok(sat.includes('Avis reçus=30'));
  assert.ok(sat.includes('Note pondérée=4,6'));
  // `cible` vit dans DEUX axes avec deux sens : le libellé doit dire lequel.
  assert.ok(sat.includes('Note visée=4,8'), sat.join(' | '));
  const services = kv(axes[1]);
  assert.ok(services.includes('Actes complétés=40'), services.join(' | '));
  assert.ok(services.includes('Volume visé=50'), 'la même clé `cible` vaut ici un volume d’actes');
  // L'éventail du catalogue ne compte plus : le libellé ne doit plus laisser
  // croire que servir les deux services rapporte des points.
  assert.ok(services.includes('Services rendus (information)=2'), services.join(' | '));
  assert.ok(services.includes('Services au catalogue (information)=2'));
  assert.match(text(axes[1].querySelector('.naxe-note')), /se spécialiser ne retire aucun point/);

  const dispo = kv(axes[2]);
  // L'axe mesure les RÉPONSES ; décliner en est une, et ne coûte rien.
  assert.ok(dispo.includes('Réponses données=64'), dispo.join(' | '));
  assert.ok(dispo.includes('Réponses visées=20'));
  assert.ok(dispo.includes('Déclins (sans pénalité)=4'), 'un déclin n’est plus une sanction, et le libellé le dit');
  assert.ok(!dispo.some((l) => /Taux de réponse/.test(l)), 'le taux d’acceptation a disparu du domaine');
  assert.match(text(axes[2].querySelector('.naxe-note')), /décliner EST une réponse/);
  assert.ok(dispo.includes('Rayon=50 km'));
  assert.ok(dispo.includes('Urgences en ligne=oui'), 'a boolean reads oui/non, never true/false');
  const presence = kv(axes[3]);
  assert.ok(presence.includes('Fiche CNQ=oui'));
  assert.ok(presence.includes('Secteur postal=oui'));
  assert.ok(presence.includes('Jours depuis la dernière visite=1'));
  assert.ok(presence.includes('Jours sur Nota=457'));
  assert.ok(dispo.includes('Propositions et acceptations=60'));

  click(win, toggle); // et ça se replie
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.querySelector('.naxes-row'), null);
});

test('an analyst never reaches the roster: rail entry reserved, route closed, no request', async () => {
  const { win, doc, calls } = await boot(api({ role: 'analyst' }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const entry = [...doc.querySelectorAll('.admin-rail-link')].find((b) => text(b).includes('Notaires'));
  assert.equal(entry.disabled, true, 'the entry is disabled for an analyst');
  assert.match(text(entry), /Réservé/, 'and says why');

  win.location.hash = '#/notaires';
  await waitFor(win, '.admin-denied');
  assert.match(text(doc.querySelector('.admin-denied')), /administrateur principal/);
  assert.equal(doc.querySelector('.ntable'), null, 'no table');
  assert.equal(calls.filter((c) => c.url.includes('/notaries')).length, 0, 'the closed door is never knocked on');
});

test('a 403 from the API lands on the same reserved note, never a broken table', async () => {
  // Les permissions du jeton et celles de /me peuvent diverger : l'écran doit
  // encaisser le refus du serveur aussi calmement que le sien.
  const { win, doc } = await boot(api({ status: 403 }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/notaires';
  await waitFor(win, '.admin-denied');
  assert.equal(doc.querySelector('.ntable'), null);
  assert.equal(doc.querySelector('.error-banner'), null, 'a refusal is not a technical failure');
});

test('a failed roster fetch shows the retry banner, and retry recovers', async () => {
  let fail = true;
  const base = api();
  const handler = (method, url, body) => {
    if (url.includes('/notaries')) return fail ? [500, null] : [200, sampleNotaries()];
    return base(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/notaires';
  const banner = await waitFor(win, '.error-banner');
  fail = false;
  click(win, banner.querySelector('button'));
  await waitFor(win, '.ntable');
  assert.ok(!doc.querySelector('.error-banner'), 'the banner clears after a successful retry');
});

test('the roster crosses into English — columns, statuses and axis labels', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T', 'en');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/notaires';
  await waitFor(win, '.ntable');
  await settle(win);

  const heads = [...doc.querySelectorAll('.ntable thead th')].map(text);
  assert.deepEqual(heads, ['Firm', 'Status', 'Cote', 'The notary keeps', 'Acts', 'Rating', 'Commission collected', 'Last visit']);
  const rows = [...doc.querySelectorAll('.ntable tbody tr.nrow')];
  assert.match(text(rows[1]), /no reviews/, 'the missing rating stays honest in English');
  assert.match(text(rows[1]), /Onboarding/);
  assert.match(text(rows[0]), /\$4,820/, 'money is reformatted, not just translated');

  click(win, rows[0].querySelector('.nrow-toggle'));
  const detail = await waitFor(win, '.naxes-row');
  await settle(win);
  // Le nom d'axe vient de l'API en deux langues : c'est nomEn qui doit sortir.
  assert.match(text(detail.querySelector('.naxe-nom')), /Client satisfaction/);
  assert.match(text(detail), /35.6 out of 40/);
  assert.match(text(detail), /Reviews received/);
  // Les deux renversements déontologiques se disent aussi en anglais.
  const notes = [...detail.querySelectorAll('.naxe-note')].map(text);
  assert.equal(notes.length, 2, 'services et disponibilité portent chacun leur note');
  assert.match(notes.join(' '), /specializing takes away no points/);
  assert.match(notes.join(' '), /declining IS an answer/);
});

// --- Le dépli, langue par langue -------------------------------------------
// Ouvre le premier notaire et rend les libellés du `detail`, axe par axe.
async function unfoldLabels(lang) {
  const { win, doc } = await boot(api(), '#/auth?token=T', lang);
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/notaires';
  await waitFor(win, '.ntable');
  click(win, doc.querySelector('.nrow-toggle'));
  await waitFor(win, '.naxes-row');
  await settle(win);
  return [...doc.querySelectorAll('.naxes-row .naxe')].map((a) =>
    [...a.querySelectorAll('.naxe-line')].map((l) => text(l.querySelector('.naxe-k'))));
}

test('every detail label of every axis crosses into English — none stays French', async () => {
  const fr = await unfoldLabels(null);
  const en = await unfoldLabels('en');

  assert.deepEqual(en.map((a) => a.length), fr.map((a) => a.length), 'same lines, same axes');
  // LE garde-fou : un libellé identique dans les deux langues est un libellé
  // oublié dans le dictionnaire (c'est ainsi que « Services rendus » a fui).
  fr.forEach((axe, i) => {
    axe.forEach((label, j) => {
      assert.notEqual(en[i][j], label,
        'le libellé « ' + label + ' » (axe ' + i + ') sort encore en français en mode anglais');
    });
  });

  // Et la traduction attendue, énoncée : `cible` change de mot selon l'axe.
  assert.deepEqual(en[0], ['Average rating', 'Reviews received', 'Weighted rating', 'Target rating']);
  assert.deepEqual(en[1], ['Acts completed', 'Target volume', 'Services delivered (information)', 'Services in the catalogue (information)']);
  assert.deepEqual(en[2], ['Proposals and acceptances', 'Declines (no penalty)', 'Responses given', 'Target responses', 'Radius', 'Online urgent acts']);
  assert.deepEqual(en[3], ['CNQ listing', 'Postal sector', 'Days since the last visit', 'Days on Nota']);
});

test('an unknown detail key falls back to its raw name, in both languages', async () => {
  // Le domaine peut ajouter une mesure demain : elle doit apparaître telle
  // quelle, jamais faire disparaître la ligne ni casser le dépli.
  const data = sampleNotaries();
  data.notaires[0].axes[3].detail = { fiche: true, nouvelleMesure: 7, tauxMachin: 42.5 };
  const { win, doc } = await boot(api({ notaries: data }), '#/auth?token=T', 'en');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/notaires';
  await waitFor(win, '.ntable');
  click(win, doc.querySelector('.nrow-toggle'));
  await waitFor(win, '.naxes-row');
  await settle(win);

  const presence = [...doc.querySelectorAll('.naxes-row .naxe')][3];
  const kv = [...presence.querySelectorAll('.naxe-line')]
    .map((l) => text(l.querySelector('.naxe-k')) + '=' + text(l.querySelector('.naxe-v')));
  // Et la convention du dépôt tient : une clé `taux…` porte son %, même
  // inconnue au dictionnaire (plus aucun axe n'en sert aujourd'hui).
  assert.deepEqual(kv, ['CNQ listing=yes', 'nouvelleMesure=7', 'tauxMachin=42.5%']);
});
