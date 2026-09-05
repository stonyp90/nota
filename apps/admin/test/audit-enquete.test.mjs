/**
 * LA BARRE D'ENQUÊTE DU JOURNAL (2026-09-05), côté console.
 *
 * L'écran « Audit » ne savait poser qu'une question : « qu'est-il arrivé ce
 * jour-là ». Les deux questions d'une enquête réelle — « tout ce que cette
 * personne a fait » et « tout ce qui a été fait à ce compte » — n'avaient
 * aucun champ, et rien ne permettait de dépasser une partition.
 *
 * Ce que ces tests gardent : les quatre champs composent UNE adresse (et le
 * jour seul continue de produire exactement l'appel d'avant), toute retouche
 * repart de la première page, « Charger la suite » n'apparaît que tant que
 * l'API rend un curseur, et la page suivante s'AJOUTE au lieu de remplacer.
 *
 * Même harnais que audit.test.mjs — la console est volontairement sans
 * dépendance d'exécution, donc chaque suite monte son propre jsdom.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* already gone */ } } });

function makeFetch(handler, calls) {
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ method, url: String(url) });
    const out = handler(method, String(url)) || [404, null];
    const [status, json] = out;
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(json) });
  };
}

async function boot(handler) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/#/auth?token=T',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = makeFetch(handler, calls);
      window.scrollTo = () => {};
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  win.eval(ADMIN_SRC);
  for (let i = 0; i < 3; i++) await wait(5);
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
async function waitGone(win, sel, timeout = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!win.document.querySelector(sel)) return true;
    await wait(5);
  }
  throw new Error('timeout waiting for ' + sel + ' to go');
}

const futureISO = () => new Date(Date.now() + 3600000).toISOString();
const TZ = 'America/Toronto';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const change = (win, node, value) => {
  node.value = value;
  node.dispatchEvent(new win.Event('change', { bubbles: true }));
};
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true }));

// Une entrée du journal, réduite à ce que l'écran lit.
const ligne = (id) => ({
  id, ts: today() + 'T12:00:00.000Z', day: today(), action: 'acte_retenu',
  adminId: null, email: null, ip: null, acteur: { type: 'notaire', id: 'me-tremblay' },
  meta: { bidId: 'b1', montant: 2800, notaryId: 'me-tremblay' },
});

// L'API feinte : elle rend `pages` dans l'ordre, une par appel au journal, et
// note les adresses demandées. C'est tout ce dont ces tests ont besoin — la
// vérité du filtrage est gardée côté serveur (audit-journal-enquete.test.mjs).
function api(pages) {
  const restantes = [...pages];
  return (method, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role: 'super_admin' }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: 'super_admin', permissions: ['audit:read'] }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/audit')) return [200, restantes.length > 1 ? restantes.shift() : restantes[0]];
    return [404, null];
  };
}

const urlsAudit = (calls) => calls.filter((c) => c.url.includes('/audit')).map((c) => c.url);

test('les quatre champs sont là, et le jour seul produit EXACTEMENT l’appel d’avant', async () => {
  const { win, doc, calls } = await boot(api([{ jour: today(), entrees: [ligne('e1')] }]));
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');

  assert.ok(doc.querySelector('.audit-du'), 'le champ « Depuis »');
  assert.ok(doc.querySelector('.audit-day'), 'le sélecteur de jour');
  assert.ok(doc.querySelector('.audit-acteur'), 'le champ « Acteur »');
  assert.ok(doc.querySelector('.audit-sujet'), 'le champ « Sujet »');
  // Le jour reste le champ qui s'ouvre sur aujourd'hui — trois champs neufs ne
  // doivent pas déplacer ce repère.
  assert.equal(doc.querySelector('.audit-day').value, today());
  assert.equal(doc.querySelector('.audit-du').value, '', 'la fenêtre ne s’ouvre pas toute seule');
  assert.deepEqual(urlsAudit(calls).map((u) => u.split('/audit')[1]), ['?jour=' + today()]);
});

test('« Acteur » et « Sujet » entrent dans l’adresse, et se composent', async () => {
  const { win, doc, calls } = await boot(api([{ jour: today(), entrees: [ligne('e1')] }]));
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');

  change(win, doc.querySelector('.audit-acteur'), 'me-tremblay');
  await waitFor(win, '.audit-entry');
  change(win, doc.querySelector('.audit-sujet'), 'b1');
  await waitFor(win, '.audit-entry');

  const urls = urlsAudit(calls);
  assert.match(urls[1], /acteur=me-tremblay/);
  assert.match(urls[2], /acteur=me-tremblay/);
  assert.match(urls[2], /sujet=b1/, 'les deux questions se posent ensemble');
});

test('« Depuis » ouvre la fenêtre : l’adresse passe de `jour` à `du`/`au`', async () => {
  const { win, doc, calls } = await boot(api([{ jour: today(), entrees: [ligne('e1')] }]));
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');

  change(win, doc.querySelector('.audit-du'), '2026-01-02');
  await waitFor(win, '.audit-entry');

  const dernier = urlsAudit(calls).pop();
  assert.match(dernier, /du=2026-01-02/);
  assert.match(dernier, new RegExp('au=' + today()));
  assert.ok(!/[?&]jour=/.test(dernier), 'une fenêtre n’envoie plus « jour »');
});

test('« Charger la suite » n’apparaît qu’avec un curseur, et AJOUTE la page suivante', async () => {
  const { win, doc, calls } = await boot(api([
    { jour: today(), du: today(), au: today(), entrees: [ligne('e1'), ligne('e2')], curseur: 'CUR1' },
    { jour: today(), du: today(), au: today(), entrees: [ligne('e3')] },
  ]));
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');

  assert.equal(doc.querySelectorAll('.audit-entry').length, 2);
  const btn = await waitFor(win, '.audit-suite .btn');
  click(win, btn);
  await waitGone(win, '.audit-suite');

  // Les trois entrées coexistent : une pagination qui REMPLACE la page perd la
  // moitié de la réponse à chaque clic.
  assert.equal(doc.querySelectorAll('.audit-entry').length, 3);
  assert.match(urlsAudit(calls).pop(), /curseur=CUR1/);
});

test('une page vide qui rend un curseur ne dit PAS « aucune entrée »', async () => {
  // LE VIDE QUI MENT (revue du 2026-09-05). Le cas ordinaire d'une question
  // sélective sur un trimestre : le budget de partitions du serveur rend la
  // main avant d'avoir rien trouvé, donc zéro entrée ET un curseur. L'écran
  // annonçait « Aucune entrée pour ce jour. » — une affirmation que personne
  // n'avait vérifiée — juste au-dessus d'un bouton « Charger la suite » qui la
  // contredisait. Dans le seul écran dont le métier est de ne rien taire.
  const { win, doc } = await boot(api([
    { jour: today(), du: '2026-06-15', au: today(), entrees: [], curseur: 'CUR1' },
    { jour: today(), du: '2026-06-15', au: today(), entrees: [] },
  ]));
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  // On attend un repère de l'écran AUDIT, pas un `.empty-state` quelconque :
  // le tableau de bord en affiche un lui aussi, et l'attendre attraperait le
  // sien avant que le journal ne soit monté.
  await waitFor(win, '.audit-suite .btn');

  const provisoire = doc.querySelector('.empty-state-title').textContent;
  assert.ok(!/Aucune entrée/.test(provisoire), 'le vide provisoire ne conclut rien : ' + provisoire);
  assert.match(doc.querySelector('.empty-state-text').textContent, /jusqu’au bout/);
  assert.ok(doc.querySelector('.audit-suite .btn'), 'et il reste de quoi lire');

  // La fenêtre s'épuise sans rien rendre : le vide devient DÉFINITIF, et le
  // bouton s'en va. Laisser la phrase provisoire promettrait une suite que
  // plus rien ne peut tenir.
  click(win, doc.querySelector('.audit-suite .btn'));
  await waitGone(win, '.audit-suite');
  assert.match(doc.querySelector('.empty-state-title').textContent, /Aucune entrée/);
});

test('changer un filtre REPART de la première page — jamais au milieu de l’ancienne réponse', async () => {
  const { win, doc, calls } = await boot(api([
    { jour: today(), entrees: [ligne('e1')], curseur: 'CUR1' },
  ]));
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-suite .btn');

  change(win, doc.querySelector('.audit-sujet'), 'b1');
  await waitFor(win, '.audit-entry');

  const dernier = urlsAudit(calls).pop();
  assert.ok(!/curseur=/.test(dernier), 'un curseur de l’ancienne question n’a plus de sens');
  assert.match(dernier, /sujet=b1/);
});

test('une fenêtre refusée par le serveur affiche SA phrase, sous les champs qui la corrigent', async () => {
  const handler = (method, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role: 'super_admin' }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: 'super_admin', permissions: ['audit:read'] }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/audit')) {
      return /du=/.test(url)
        ? [422, { errors: [{ code: 'fenetre_trop_large', message: 'La fenêtre ne peut dépasser 92 jours.' }] }]
        : [200, { jour: today(), entrees: [ligne('e1')] }];
    }
    return [404, null];
  };
  const { win, doc } = await boot(handler);
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');

  change(win, doc.querySelector('.audit-du'), '2020-01-01');
  const box = await waitFor(win, '.tpl-error');
  assert.match(box.textContent, /92 jours/);
  // Les champs survivent à l'erreur : c'est par eux qu'on la corrige.
  assert.ok(doc.querySelector('.audit-du'), 'le champ reste');
  assert.equal(doc.querySelector('.audit-du').value, '2020-01-01');
});
